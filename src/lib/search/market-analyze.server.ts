/**
 * market.analyze — 程序化市场评分引擎(方案文档 §11 的落地, 根治审查 R5)。
 *
 * 设计原则(第一性原理):
 * - 三项判断(热门/缺货/涨价)全部由「证据指标 + 固定规则」计算, 输入相同则输出逐位相同;
 * - 模型只负责解释分数, 不允许覆盖分数;
 * - 每个分数携带构成它的信号明细与置信度 —— 可解释, 可审计。
 *
 * 反直觉规则已内建:
 * - 供应商多 ≠ 热门: 热度以需求侧信号为主权重(内部询价 70%), 供给活跃度仅 30%;
 * - 单平台无货 ≠ 缺货: 缺货需授权库存低位或多快照下行趋势共同支撑;
 * - 单一报价 ≠ 涨价: 涨价需同口径时间序列或现货对授权价的系统性溢价。
 */
import type { LiveOffer } from "@/lib/search/result-types";

/** 引擎实际消费的最小 offer 形状(MCP 层传来的 JSON 宽松匹配此结构) */
export type AnalyzeOffer = {
  sourceKey?: string;
  currency?: string;
  price?: number | null;
};

export type SnapshotPoint = {
  capturedAt: string;
  lcscStock: number | null;
  lcscMinPrice: number | null;
  hqewOfferCount: number | null;
  hqewSupplierCount: number | null;
};

export type AnalyzeSignal = {
  name: string;
  value: string | number | null;
  score: number; // 该信号 0-100
  weight: number; // 权重(组内归一前)
};

export type MetricResult = {
  score: number; // 0-100
  level: "高" | "中" | "低";
  confidence: "high" | "medium" | "low";
  signals: AnalyzeSignal[];
  basis: string; // 一句话依据(供报告引用)
};

export type MarketAnalysis = {
  mpn: string;
  hotness: MetricResult;
  shortage: MetricResult;
  priceTrend: MetricResult;
  dataBasis: {
    snapshotCount: number;
    newestSnapshotAt: string | null;
    oldestSnapshotDays: number | null;
    internalQuoteCount: number;
    currentOfferCount: number;
    sourcesSeen: string[];
  };
  computedAt: string;
};

function clamp(n: number): number {
  return Math.max(0, Math.min(100, Math.round(n)));
}

function weighted(signals: AnalyzeSignal[]): { score: number; confidence: "high" | "medium" | "low" } {
  const active = signals.filter((s) => s.score >= 0);
  if (!active.length) return { score: 0, confidence: "low" };
  const wsum = active.reduce((a, s) => a + s.weight, 0);
  const score = clamp(active.reduce((a, s) => a + s.score * s.weight, 0) / (wsum || 1));
  // 置信度: 有多少信号真正参与(缺失信号的 weight 不参与归一, 但拉低置信度)
  const expected = Math.max(...[0.7, 0.5, 0.6]); // 各指标的满配权重和参考值
  const coverage = wsum / (wsum < expected ? expected : wsum);
  return { score, confidence: coverage >= 0.99 ? "high" : coverage >= 0.6 ? "medium" : "low" };
}

function levelOf(score: number, thresholds: [number, number] = [60, 35]): MetricResult["level"] {
  return score >= thresholds[0] ? "高" : score >= thresholds[1] ? "中" : "低";
}

function daysBetween(aIso: string, bIso: string): number {
  return Math.abs(new Date(bIso).getTime() - new Date(aIso).getTime()) / 86_400_000;
}

export type MarketAnalyzeInput = {
  mpn: string;
  /** 时间升序的市场快照(至少含最新一条) */
  snapshots: SnapshotPoint[];
  /** 内部询价记录条数(近 90 天) */
  internalQuoteCount: number;
  /** 当前抓到的 offers(可选; 用于多源覆盖与现货溢价) */
  currentOffers?: AnalyzeOffer[];
};

export function computeMarketAnalysis(input: MarketAnalyzeInput): MarketAnalysis {
  const { mpn, snapshots, internalQuoteCount } = input;
  const offers: AnalyzeOffer[] = input.currentOffers ?? [];
  const sorted = [...snapshots].sort((a, b) => a.capturedAt.localeCompare(b.capturedAt));
  const latest = sorted[sorted.length - 1] ?? null;
  const previous = sorted.length >= 2 ? sorted[sorted.length - 2] : null;

  const sourcesSeen = [
    ...(latest?.lcscStock != null ? ["lcsc"] : []),
    ...(latest?.hqewOfferCount != null ? ["hqew"] : []),
    ...(offers.some((o) => o.sourceKey === "findchips") ? ["findchips"] : []),
    ...(internalQuoteCount > 0 ? ["internal"] : []),
  ];

  /* ------------------------------- 热门 ---------------------------------- */
  // 需求侧为主(70%): 内部询价频次。供给侧(30%): 供应商规模 + 多源覆盖。
  let inquiryScore = 0;
  if (internalQuoteCount >= 6) inquiryScore = 85;
  else if (internalQuoteCount >= 3) inquiryScore = 60;
  else if (internalQuoteCount >= 1) inquiryScore = 30;
  const supplierCount = latest?.hqewSupplierCount ?? offers.filter((o) => o.sourceKey === "hqew").length;
  const supplierScore = supplierCount >= 40 ? 85 : supplierCount >= 20 ? 65 : supplierCount >= 8 ? 45 : 20;
  const sourceCoverage = sourcesSeen.length; // 最多 4
  const coverageScore = clamp(sourceCoverage * 25);
  const hotSignals: AnalyzeSignal[] = [
    { name: "内部询价频次(近90天)", value: internalQuoteCount, score: inquiryScore, weight: 0.7 },
    { name: "华强供应商数", value: supplierCount, score: supplierScore, weight: 0.2 },
    { name: "数据源覆盖数", value: sourceCoverage, score: coverageScore, weight: 0.1 },
  ];
  const hot = weighted(hotSignals);

  /* ------------------------------- 缺货 ---------------------------------- */
  // 授权库存水平(50%) + 快照库存趋势(30%) + 华强挂货规模(20%)
  const lcscStock = latest?.lcscStock ?? null;
  let authStockScore = 0;
  let authKnown = false;
  if (lcscStock != null) {
    authKnown = true;
    authStockScore = lcscStock === 0 ? 95 : lcscStock < 500 ? 80 : lcscStock < 2000 ? 55 : lcscStock < 10000 ? 30 : 10;
  }
  let trendScore = 0;
  let trendKnown = false;
  let trendDetail = "无历史快照, 无法评估趋势";
  if (previous && latest?.lcscStock != null && previous.lcscStock != null && previous.lcscStock > 0) {
    const drop = (previous.lcscStock - latest.lcscStock) / previous.lcscStock;
    trendKnown = true;
    trendScore = drop > 0.3 ? 85 : drop > 0.1 ? 55 : drop > 0 ? 30 : 10;
    trendDetail = `授权库存 ${previous.lcscStock} → ${latest.lcscStock}(${(drop * 100).toFixed(1)}%)`;
  }
  const hqewOffersNow = latest?.hqewOfferCount ?? offers.filter((o) => o.sourceKey === "hqew").length;
  const supplyScale = hqewOffersNow == null ? 0 : hqewOffersNow >= 30 ? 15 : hqewOffersNow >= 10 ? 40 : hqewOffersNow > 0 ? 65 : 90;
  const shortSignals: AnalyzeSignal[] = [
    { name: "授权库存水平", value: lcscStock, score: authKnown ? authStockScore : -1, weight: 0.5 },
    { name: "库存趋势(环比)", value: trendKnown ? trendDetail : null, score: trendKnown ? trendScore : -1, weight: 0.3 },
    { name: "华强挂货规模", value: hqewOffersNow ?? null, score: hqewOffersNow != null ? supplyScale : -1, weight: 0.2 },
  ];
  const shortActive = shortSignals.filter((s) => s.score >= 0);
  const short = weighted(shortActive.length ? shortActive : []);

  /* ------------------------------ 涨价 ----------------------------------- */
  // 同口径时间序列(60%) + 现货对授权价溢价(40%)
  let seriesScore = 0;
  let seriesKnown = false;
  let seriesDetail = "无同口径历史价格序列";
  const priceSeries = sorted
    .map((s) => s.lcscMinPrice)
    .filter((p): p is number => p != null);
  if (priceSeries.length >= 2) {
    const oldP = priceSeries[Math.max(0, priceSeries.length - 8)];
    const newP = priceSeries[priceSeries.length - 1];
    if (oldP > 0) {
      const chg = (newP - oldP) / oldP;
      seriesKnown = true;
      seriesScore = chg > 0.15 ? 90 : chg > 0.05 ? 65 : chg > -0.05 ? 30 : 10;
      seriesDetail = `授权最低价 ${oldP} → ${newP}(${(chg * 100).toFixed(1)}%)`;
    }
  }
  let premiumScore = 0;
  let premiumKnown = false;
  let premiumDetail = "缺少华强中位价或授权基准价";
  const grayPrices = offers
    .filter((o) => o.sourceKey === "hqew" && o.currency !== "USD" && o.price != null)
    .map((o) => o.price as number)
    .sort((a, b) => a - b);
  const lcscBase = latest?.lcscMinPrice ?? null;
  if (grayPrices.length >= 3 && lcscBase != null && lcscBase > 0) {
    const medianGray = grayPrices[Math.floor(grayPrices.length / 2)];
    const premium = (medianGray - lcscBase) / lcscBase;
    premiumKnown = true;
    premiumScore = premium > 0.3 ? 78 : premium > 0.1 ? 52 : premium > -0.1 ? 30 : 12;
    premiumDetail = `华强中位 ¥${medianGray} vs 授权 ¥${lcscBase}(溢价 ${(premium * 100).toFixed(1)}%)`;
  }
  const priceSignals: AnalyzeSignal[] = [
    { name: "授权价时间序列", value: seriesKnown ? seriesDetail : null, score: seriesKnown ? seriesScore : -1, weight: 0.6 },
    { name: "现货对授权价溢价", value: premiumKnown ? premiumDetail : null, score: premiumKnown ? premiumScore : -1, weight: 0.4 },
  ];
  const priceActive = priceSignals.filter((s) => s.score >= 0);
  const price = weighted(priceActive.length ? priceActive : []);

  // 数据基准时间 = 最新快照; 引擎不读时钟 —— 同输入必同输出(G2)
  const dataCutoff = latest?.capturedAt ?? "";
  const oldestDays =
    sorted.length >= 1 && dataCutoff ? Math.round(daysBetween(sorted[0].capturedAt, dataCutoff)) : null;

  return {
    mpn,
    hotness: {
      score: hot.score,
      level: levelOf(hot.score),
      confidence: hot.confidence,
      signals: hotSignals.map((s) => ({ ...s, score: Math.max(0, s.score) })),
      basis: internalQuoteCount > 0
        ? `需求信号: ${internalQuoteCount} 条内部询价`
        : "无需求侧证据, 供给活跃不等于热门",
    },
    shortage: {
      score: short.score,
      level: levelOf(short.score),
      confidence: short.confidence,
      signals: shortActive.map((s) => ({ ...s })),
      basis: trendKnown ? seriesOrAuth(trendDetail) : authKnown ? `仅授权库存单点: ${lcscStock}` : "缺货证据不足",
    },
    priceTrend: {
      score: price.score,
      level: levelOf(price.score),
      confidence: price.confidence,
      signals: priceActive.map((s) => ({ ...s })),
      basis: seriesKnown ? seriesDetail : premiumKnown ? premiumDetail : "无价格时间序列, 无法判断涨跌",
    },
    dataBasis: {
      snapshotCount: sorted.length,
      newestSnapshotAt: latest?.capturedAt ?? null,
      oldestSnapshotDays: oldestDays,
      internalQuoteCount,
      currentOfferCount: offers.length,
      sourcesSeen,
    },
    computedAt: dataCutoff,
  };

  function seriesOrAuth(detail: string): string {
    return detail;
  }
}
