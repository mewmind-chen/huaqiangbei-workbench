import { ITEM_TYPES, type ItemType, type RecognizeDraft } from "./types.ts";

const TYPE_RULES: [RegExp, ItemType][] = [
  [/报价|请报价|可以报|报一下|报个价|询价|价格|多少钱|成本|单价|BOM|型号|怎么卖|怎么算|核算/, "报价"],
  [/下单|订货|要货|采购|给我安排|帮我安排|确认订/, "下单"],
  [/发货|物流|快递|单号|发出|寄出|还没到|收到货|货到哪/, "发货"],
  [/对账|账单|明细|核对|对一下/, "对账"],
  [/发票|开票|税票/, "发票"],
  [/付款|收款|催款|回款|转账|打款|货款/, "催收款"],
];

export function inferType(content: string): ItemType | null {
  const c = String(content || "");
  if (/【下单已完成】|下单完成|待发货|安排发货/.test(c)) return "发货";
  for (const [re, t] of TYPE_RULES) {
    if (re.test(c)) return t;
  }
  return null;
}

export function mergeRecognized(items: RecognizeDraft[]): RecognizeDraft {
  if (!items.length) throw new Error("未能识别出任何事项");
  const customer =
    items.map((r) => r.customer).find((c) => c && c !== "客户") || items[0].customer || "";
  const typeCount = new Map<ItemType, number>();
  for (const r of items) {
    if (ITEM_TYPES.includes(r.type) && r.type !== "其他") {
      typeCount.set(r.type, (typeCount.get(r.type) || 0) + 1);
    }
  }
  const ranked = [...typeCount.entries()].sort((a, b) => b[1] - a[1]);
  const contents: string[] = [];
  for (const r of items) {
    const c = r.content.trim();
    if (c && !contents.includes(c)) contents.push(c);
  }
  const content = contents.join("；");
  const amount = items.map((r) => r.amount).find((a) => a != null) ?? null;
  const dueAt = items.map((r) => r.dueAt).find((d) => d) ?? null;
  const guessed = ranked[0]?.[0] || inferType(content) || "其他";
  return {
    customer,
    type: guessed,
    content,
    amount,
    dueAt,
    priority: "普通",
  };
}
