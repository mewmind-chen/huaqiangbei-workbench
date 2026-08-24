import type { CompanyCard, LcscAlt, ShopRow } from "@/lib/search/md-parse";

export type LiveOffer = {
  sourceKey: "lcsc" | "hqew" | "shop" | "icnet" | "findchips";
  sourceName: string;
  supplier: string;
  model: string;
  brand: string;
  batch: string;
  stock: number | null;
  price: number | null;
  priceBreaks?: { qty: number; price: number }[];
  package: string;
  warehouse: string;
  note: string;
  date: string;
  url: string;
  /** 报价币种; 缺省视为 CNY, 海外源显式标注 USD(汇率换算由消费方负责) */
  currency?: "CNY" | "USD";
};

export type SourceStatus = {
  key: string;
  name: string;
  url: string;
  status: "pending" | "searching" | "ok" | "empty" | "error" | "skipped";
  error?: string;
  count: number;
};

export type PartSpec = { label: string; value: string };

export type IntelHit = {
  title: string;
  url: string;
  snippet: string;
};

export type IntelBrief = {
  summary: string;
  notes: string[];
  hits: IntelHit[];
};

/** Internal business suggestion from Agent Platform; never public evidence. */
export type PlatformAdvice = {
  action: string;
  internalView: string;
  combined: string;
  usedInternal: boolean;
};

export type PlatformRecommendation = {
  action?: string;
  reasoning?: string;
};

/** Safe, user-visible reason that an optional Platform enrichment was skipped. */
export type PlatformDegradation = {
  code: "timeout" | "unauthorized" | "server_error" | "unavailable" | "invalid_response";
  message: "平台智能分析暂不可用，已改用本地数据。";
};

export type PartIdentity = {
  mpn: string;
  brand: string;
  category: string;
  package: string;
  desc: string;
  summary: string;
  features: string;
  lcscCode: string;
  specs: PartSpec[];
  applications: string[];
  longevity: string;
  active: boolean;
  lcscStock: number | null;
  priceBreaks: { qty: number; price: number }[];
  lcscUrl: string;
  stUrl: string;
  /** 立创商品图 URL（真实抓取；无则空串，前端不猜）。 */
  imageUrl?: string;
};

export type LookupStepKey = "lcsc" | "st" | "hqew" | "gys" | "shop" | "intel" | "icnet" | "findchips";

export type LookupStepOk = {
  ok: true;
  step: LookupStepKey;
  status: "ok" | "empty" | "skipped";
  url: string;
  detail?: string;
  identity?: PartIdentity;
  alts?: LcscAlt[];
  offers?: LiveOffer[];
  companies?: CompanyCard[];
  shopRows?: ShopRow[];
  intel?: IntelBrief;
};

export type LookupStepResult = LookupStepOk | { ok: false; step: LookupStepKey; error: string };

export type LookupRecord = {
  id: string;
  query: string;
  kind: "part" | "company";
  createdAt: string;
  yunPrice: number | null;
  identity: PartIdentity | null;
  alts: LcscAlt[];
  offers: LiveOffer[];
  companies: CompanyCard[];
  shopRows: ShopRow[];
  steps: SourceStatus[];
  intel?: IntelBrief | null;
  advice?: PlatformAdvice | null;
  recommendation?: PlatformRecommendation | null;
  platformDegradation?: PlatformDegradation | null;
};
