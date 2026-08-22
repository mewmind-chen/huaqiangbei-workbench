import type { CompanyCard, LcscAlt, ShopRow } from "@/lib/search/md-parse";

export type LiveOffer = {
  sourceKey: "lcsc" | "hqew" | "shop" | "icnet";
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
};

export type LookupStepKey = "lcsc" | "st" | "hqew" | "gys" | "shop" | "intel" | "icnet";

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
};
