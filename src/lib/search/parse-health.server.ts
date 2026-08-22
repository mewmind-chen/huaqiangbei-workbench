/**
 * parse-health — 解析器健康自检(数据准确性保险 #1)。
 *
 * 背景: 网站改版会让解析器静默失效或错列。本模块对每次解析结果做完整性
 * 体检: 不健康的采集结果被标记 degraded, 由调用方决定不写入评分链路
 * (market_snapshots), 让"安静地坏掉"变成"显式地标坏"。
 */
import type { LiveOffer } from "@/lib/search/result-types";

export type ParseHealth = {
  sourceKey: string;
  healthy: boolean;
  offerCount: number;
  /** 关键字段非空率 0..1 */
  completeness: { model: number; stock: number; price: number };
  issues: string[];
};

const RATE = (n: number, total: number): number => (total === 0 ? 0 : n / total);

export function assessParseHealth(sourceKey: string, offers: LiveOffer[]): ParseHealth {
  const total = offers.length;
  const modelRate = RATE(offers.filter((o) => !!o.model).length, total);
  const stockRate = RATE(offers.filter((o) => o.stock != null).length, total);
  const priceRate = RATE(
    offers.filter((o) => o.price != null || (o.priceBreaks?.length ?? 0) > 0).length,
    total,
  );
  const issues: string[] = [];
  if (total === 0) issues.push("解析出 0 条 offers");
  // intel 类源没有结构化 model/stock 概念, 只对市场数据源执行严格阈值
  const structuredSource = ["lcsc", "hqew", "findchips", "icnet", "shop"].includes(sourceKey);
  // 按源差异化阈值: 华强挂货行大量不标价是行业常态, 不能套用授权渠道标准
  const thresholds =
    sourceKey === "hqew"
      ? { model: 0.9, stock: 0.4, price: 0.05 }
      : { model: 0.9, stock: 0.4, price: 0.4 };
  if (structuredSource && total > 0) {
    if (modelRate < thresholds.model)
      issues.push(`型号字段完整率 ${(modelRate * 100).toFixed(0)}% < ${(thresholds.model * 100).toFixed(0)}%(疑似页面改版)`);
    if (stockRate < thresholds.stock)
      issues.push(`库存字段完整率 ${(stockRate * 100).toFixed(0)}% < ${(thresholds.stock * 100).toFixed(0)}%`);
    if (priceRate < thresholds.price)
      issues.push(`价格字段完整率 ${(priceRate * 100).toFixed(0)}% < ${(thresholds.price * 100).toFixed(0)}%`);
  }
  return {
    sourceKey,
    healthy: issues.length === 0,
    offerCount: total,
    completeness: {
      model: Number(modelRate.toFixed(2)),
      stock: Number(stockRate.toFixed(2)),
      price: Number(priceRate.toFixed(2)),
    },
    issues,
  };
}
