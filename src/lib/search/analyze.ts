import type { LiveOffer, LookupRecord, PartIdentity } from "@/lib/search/result-types";
import type { QuoteLine } from "@/lib/types";

export function money(n: number | null) {
  if (n == null) return "询价";
  return `¥${n.toLocaleString("zh-CN", {
    minimumFractionDigits: n % 1 ? 2 : 0,
    maximumFractionDigits: 3,
  })}`;
}

export function stockText(n: number | null) {
  if (n == null) return "—";
  return n.toLocaleString("zh-CN");
}

export type BatchBucket = { label: string; count: number; stock: number };
export type SupplierBucket = { name: string; stock: number; price: number | null; batch: string };

export type PartAnalysis = {
  exact: LiveOffer[];
  ads: number;
  offerCount: number;
  totalStock: number;
  priced: number;
  minPrice: number | null;
  medianPrice: number | null;
  maxPrice: number | null;
  lcscStock: number | null;
  lcscPrice: number | null;
  lcscBreaks: { qty: number; price: number }[];
  spread: number | null;
  yunPrice: number | null;
  batches: BatchBucket[];
  suppliers: SupplierBucket[];
};

function median(sorted: number[]) {
  if (!sorted.length) return null;
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

function batchLabel(raw: string) {
  const t = String(raw || "").trim();
  const y = t.match(/(?:20)?(\d{2})\s*\+/);
  if (y) return `${y[1]}+`;
  if (!t) return "未标批号";
  return t.slice(0, 8);
}

export function analyzePart(
  mpn: string,
  offers: LiveOffer[],
  identity: PartIdentity | null,
  yunPrice: number | null,
): PartAnalysis {
  const key = mpn.trim().toUpperCase();
  const hqew = offers.filter((o) => o.sourceKey === "hqew");
  const exact = hqew.filter((o) => o.model.toUpperCase() === key);
  const lcsc = offers.find((o) => o.sourceKey === "lcsc");
  const prices = exact
    .map((o) => o.price)
    .filter((n): n is number => n != null)
    .sort((a, b) => a - b);
  const lcscPrice = identity?.priceBreaks[0]?.price ?? lcsc?.price ?? null;
  const minPrice = prices[0] ?? null;
  const batchMap = new Map<string, BatchBucket>();
  const supplierMap = new Map<string, SupplierBucket>();
  for (const o of exact) {
    const label = batchLabel(o.batch);
    const b = batchMap.get(label) || { label, count: 0, stock: 0 };
    b.count += 1;
    b.stock += o.stock || 0;
    batchMap.set(label, b);
    const name = o.supplier || "未标供应商";
    const prev = supplierMap.get(name);
    const stock = o.stock || 0;
    if (!prev || stock > prev.stock) {
      supplierMap.set(name, { name, stock, price: o.price, batch: o.batch });
    }
  }
  return {
    exact,
    ads: hqew.length - exact.length,
    offerCount: exact.length,
    totalStock: exact.reduce((s, o) => s + (o.stock || 0), 0),
    priced: prices.length,
    minPrice,
    medianPrice: median(prices),
    maxPrice: prices.length ? prices[prices.length - 1] : null,
    lcscStock: identity?.lcscStock ?? lcsc?.stock ?? null,
    lcscPrice,
    lcscBreaks: identity?.priceBreaks?.length ? identity.priceBreaks : lcsc?.priceBreaks || [],
    spread: lcscPrice != null && minPrice != null ? lcscPrice - minPrice : null,
    yunPrice,
    batches: [...batchMap.values()].sort((a, b) => b.stock - a.stock || b.count - a.count),
    suppliers: [...supplierMap.values()].sort((a, b) => b.stock - a.stock).slice(0, 8),
  };
}

export function parseYunPrice(detail?: string) {
  const m = String(detail || "").match(/云价格\s*¥\s*([\d.]+)/);
  return m ? Number(m[1]) : null;
}

export function reportSummary(kind: "part" | "company", identity: PartIdentity | null, offers: LiveOffer[]) {
  if (kind === "company") {
    const shop = offers.filter((o) => o.sourceKey === "shop").length;
    return shop ? `商铺库存 ${shop} 条` : "供应商名片";
  }
  const lcsc = offers.find((o) => o.sourceKey === "lcsc");
  const hq = offers.filter((o) => o.sourceKey === "hqew").length;
  const bits = [];
  if (lcsc?.price != null) bits.push(`立创 ${money(lcsc.price)}`);
  if (identity?.lcscStock != null) bits.push(`现货 ${stockText(identity.lcscStock)}`);
  if (hq) bits.push(`挂货 ${hq} 条`);
  return bits.join(" · ") || "已查";
}

const APP_ZH: { test: RegExp; zh: string; who: string }[] = [
  { test: /motor/i, zh: "电机驱动", who: "电控、伺服、电动工具厂" },
  { test: /application control/i, zh: "应用控制", who: "控制器、方案商" },
  { test: /medical/i, zh: "医疗设备", who: "医疗电子" },
  { test: /handheld/i, zh: "手持设备", who: "手持终端、仪器" },
  { test: /gaming|PC and/i, zh: "PC / 游戏外设", who: "外设、消费电子" },
  { test: /GPS/i, zh: "定位终端", who: "车载、定位模组" },
  { test: /industrial/i, zh: "工业应用", who: "工控、自动化" },
  { test: /PLC/i, zh: "PLC", who: "PLC、工控整机" },
  { test: /inverter/i, zh: "变频器 / 逆变", who: "电力电子、逆变" },
  { test: /printer/i, zh: "打印机", who: "办公外设" },
  { test: /scanner/i, zh: "扫描设备", who: "识别、扫描" },
  { test: /alarm/i, zh: "安防报警", who: "安防厂" },
  { test: /intercom/i, zh: "可视对讲", who: "楼宇对讲" },
  { test: /HVAC/i, zh: "暖通空调", who: "暖通控制器" },
];

export function translateApps(raw: string[]) {
  return raw.map((item) => {
    const hit = APP_ZH.find((a) => a.test.test(item));
    return hit ? { zh: hit.zh, who: hit.who, raw: item } : { zh: item, who: "", raw: item };
  });
}

const SPEC_ORDER = [
  "商品目录",
  "CPU内核",
  "CPU最大主频",
  "CPU位数",
  "程序存储容量",
  "RAM容量",
  "I/O数量",
  "ADC",
  "工作电压",
  "工作温度",
];

export function orderedSpecs(specs: { label: string; value: string }[] | undefined) {
  const list = specs || [];
  const rest = list.filter((s) => !SPEC_ORDER.some((k) => s.label.includes(k)));
  const picked = SPEC_ORDER.map((k) => list.find((s) => s.label.includes(k))).filter(Boolean) as {
    label: string;
    value: string;
  }[];
  return [...picked, ...rest].slice(0, 12);
}

export function partPositioning(identity: PartIdentity | null) {
  if (!identity) return "";
  const spec = (k: string) => identity.specs?.find((s) => s.label.includes(k))?.value || "";
  const core = spec("CPU内核") || spec("内核");
  const freq = spec("主频");
  const flash = spec("程序存储容量") || spec("Flash");
  const ram = spec("RAM");
  const bits: string[] = [];
  if (identity.brand && identity.category) bits.push(`${identity.brand} 的${identity.category}`);
  else if (identity.category) bits.push(identity.category);
  if (core) bits.push(core);
  if (freq) bits.push(`主频 ${freq}`);
  if (flash) bits.push(`Flash ${flash}`);
  if (ram) bits.push(`RAM ${ram}`);
  if (identity.package) bits.push(identity.package);
  return bits.join(" · ");
}

export type MarketCard = {
  key: "hot" | "supply" | "price";
  title: string;
  verdict: string;
  detail: string;
  level: "high" | "mid" | "low" | "unknown";
};

export function previousPartReport(reports: LookupRecord[], query: string, currentId?: string) {
  const key = query.trim().toUpperCase();
  const matches = reports.filter(
    (r) => r.kind === "part" && r.query.toUpperCase() === key && r.id !== currentId,
  );
  return matches[1] ?? null;
}

export function buildMarketCards(opts: {
  analysis: PartAnalysis;
  identity: PartIdentity | null;
  inquirers: QuoteLine[];
  previous?: LookupRecord | null;
}): MarketCard[] {
  const { analysis, identity, inquirers, previous } = opts;
  const suppliers = analysis.suppliers.length || analysis.offerCount;
  const local = inquirers.filter((q) => q.status !== "已完成").length;
  let hotVerdict = "公开页挂得不多";
  let hotLevel: MarketCard["level"] = "low";
  if (local >= 2 && suppliers >= 12) {
    hotVerdict = "你手头在询，市场上也常挂";
    hotLevel = "high";
  } else if (suppliers >= 20) {
    hotVerdict = "挂货商家多，公开页上看着常走";
    hotLevel = "high";
  } else if (local >= 1) {
    hotVerdict = "至少有客户在询这颗料";
    hotLevel = "mid";
  } else if (suppliers >= 8) {
    hotVerdict = "有一定挂货，谈不上爆款";
    hotLevel = "mid";
  }
  const hot: MarketCard = {
    key: "hot",
    title: "热门",
    verdict: hotVerdict,
    detail: `华强本型号 ${analysis.offerCount} 家挂货；你这边未完成询价 ${local} 条。不是烽火搜索指数。`,
    level: hotLevel,
  };

  const lcsc = analysis.lcscStock;
  const hang = analysis.totalStock;
  let supplyVerdict = "公开页上看一般";
  let supplyLevel: MarketCard["level"] = "mid";
  if (lcsc != null && lcsc >= 50000) {
    supplyVerdict = "立创现货足，偏松";
    supplyLevel = "low";
  } else if (lcsc != null && lcsc < 1000 && hang < 5000) {
    supplyVerdict = "立创和挂货都不多，偏紧";
    supplyLevel = "high";
  } else if (lcsc != null && lcsc < 3000) {
    supplyVerdict = "立创现货不多，要注意交期";
    supplyLevel = "high";
  } else if (lcsc == null && hang === 0) {
    supplyVerdict = "这一页没取到库存数字";
    supplyLevel = "unknown";
  }
  const supply: MarketCard = {
    key: "supply",
    title: "货",
    verdict: supplyVerdict,
    detail: `立创现货 ${stockText(lcsc)}；华强挂货合计 ${stockText(hang)}（询价数量，不是成交库存）。`,
    level: supplyLevel,
  };

  const prevLcsc = previous?.identity?.priceBreaks?.[0]?.price ?? null;
  const nowLcsc = analysis.lcscPrice;
  let priceVerdict = "还不能判断涨跌";
  let priceLevel: MarketCard["level"] = "unknown";
  let priceDetail = `立创 1+ ${money(nowLcsc)}`;
  if (analysis.minPrice != null) priceDetail += `，挂货最低 ${money(analysis.minPrice)}（挂价）`;
  if (analysis.lcscBreaks.length >= 2) {
    const last = analysis.lcscBreaks[analysis.lcscBreaks.length - 1];
    priceDetail += `；量大 ${last.qty}+ ${money(last.price)}`;
  }
  if (prevLcsc != null && nowLcsc != null && prevLcsc > 0) {
    const pct = ((nowLcsc - prevLcsc) / prevLcsc) * 100;
    if (pct >= 5) {
      priceVerdict = `比上次立创 1+ 高 ${pct.toFixed(1)}%`;
      priceLevel = "high";
    } else if (pct <= -5) {
      priceVerdict = `比上次立创 1+ 低 ${Math.abs(pct).toFixed(1)}%`;
      priceLevel = "low";
    } else {
      priceVerdict = "和上次立创价差不多";
      priceLevel = "mid";
    }
    priceDetail += `。上次 ${money(prevLcsc)}。`;
  } else {
    priceDetail += "。本机还没有上次快照，不编「涨价快」。";
  }
  const price: MarketCard = {
    key: "price",
    title: "价",
    verdict: priceVerdict,
    detail: priceDetail,
    level: priceLevel,
  };

  return [hot, supply, price];
}
