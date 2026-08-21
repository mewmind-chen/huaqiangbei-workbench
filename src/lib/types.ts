export const ITEM_TYPES = [
  "报价",
  "下单",
  "发货",
  "对账",
  "发票",
  "催收款",
  "其他",
] as const;

export const STATUSES = ["待处理", "处理中", "已完成"] as const;

export const PRIORITIES = ["普通", "重要", "紧急"] as const;

export const QUOTE_STATUSES = ["待报价", "已报价", "已完成"] as const;

export type ItemType = (typeof ITEM_TYPES)[number];
export type ItemStatus = (typeof STATUSES)[number];
export type ItemPriority = (typeof PRIORITIES)[number];
export type QuoteStatus = (typeof QUOTE_STATUSES)[number];

export type TodoItem = {
  id: string;
  customer: string;
  type: ItemType;
  content: string;
  amount: number | null;
  status: ItemStatus;
  priority: ItemPriority;
  followUp: string;
  dueAt: string;
  dueDefault: boolean;
  createdAt: string;
  doneAt: string | null;
  carryCount: number;
  dueOrig: string | null;
};

export type RecognizeDraft = {
  customer: string;
  type: ItemType;
  content: string;
  amount: number | null;
  dueAt: string | null;
  priority?: ItemPriority;
};

export type QuoteLine = {
  id: string;
  customer: string;
  mpn: string;
  itemId: string | null;
  status: QuoteStatus;
  content: string;
  createdAt: string;
  updatedAt: string;
};

export type PooledPart = {
  id: string;
  mpn: string;
  brand: string;
  category: string;
  notes: string;
  createdAt: string;
};

export type CustomerRecord = {
  id: string;
  name: string;
  createdAt: string;
};

export type SearchTab = "lookup" | "history" | "quotes" | "parts" | "customers";
export type MainTab = "todo" | "search";

export type ReportSummary = {
  id: string;
  query: string;
  kind: "part" | "company";
  createdAt: string;
  summary: string;
};

export type PartIntel = {
  query: string;
  kind: "part" | "company";
  name: string;
  manufacturer: string;
  aliases: string[];
  description: string;
  typicalPackage: string;
  notes: string;
};
