import { ITEM_TYPES, PRIORITIES, type RecognizeDraft } from "./types.ts";
import { inferType } from "./todo-infer.ts";

export const TODO_VISION_PROMPT = `你正在识别一张微信/QQ聊天记录截图。
- 顶部标题栏是群名/好友名；消息是气泡；发送者昵称是彩色小字
- 屏幕左侧气泡通常是客户/对方发来的，右侧是自己发的
- 客户名字优先从截图左上角标题栏提取：格式「公司名（昵称）」；昵称含公司/地名时拆开，如「不到长城非好汉 东莞 晶冠」→「东莞晶冠（不到长城非好汉）」

提取【客户/对方发来的】所有独立业务事项。一条独立事项一条记录；不同事项必须分别放在 items 中，不要合并。
只输出 JSON，不要其他文字：
{"items":[{"customer":"客户名称","type":"类型","content":"事项内容","amount":数字或null,"dueAt":"YYYY-MM-DDTHH:mm或null","priority":"普通"}]}

规则：
- type 只能是：报价、下单、发货、对账、发票、催收款、其他
- 提到报价/价格/BOM/型号 → 报价；下单/订货/要货 → 下单；发货/物流 → 发货；对账/账单 → 对账；发票/开票 → 发票；付款/催款 → 催收款
- content 写业务要点；型号、料号、文件名必须逐字保留，不要改写或补全
- amount 只有截图明确出现的金额才填，否则 null
- dueAt 只有截图明确出现的日期时间才填，否则 null
- customer 不确定时填“客户”，不要猜具体公司
- priority 只有截图明确表达紧急/重要时才填对应值，否则填“普通”`;

export function extractTodoItems(text: string): RecognizeDraft[] {
  const cleaned = String(text)
    .trim()
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/i, "")
    .trim();
  const start = cleaned.indexOf("{");
  const arrStart = cleaned.indexOf("[");
  let raw: unknown[];
  if (start < 0 || (arrStart >= 0 && arrStart < start)) {
    const arrEnd = cleaned.lastIndexOf("]");
    if (arrStart < 0 || arrEnd < arrStart) throw new Error("invalid_model_response");
    const parsed = JSON.parse(cleaned.slice(arrStart, arrEnd + 1)) as unknown;
    raw = Array.isArray(parsed) ? parsed : [];
  } else {
    const end = cleaned.lastIndexOf("}");
    if (end < start) throw new Error("invalid_model_response");
    const parsed = JSON.parse(cleaned.slice(start, end + 1)) as { items?: unknown[] };
    raw = Array.isArray(parsed.items) ? parsed.items : [];
  }

  const items = raw.map((row): RecognizeDraft => {
    const it = row && typeof row === "object" ? (row as Record<string, unknown>) : {};
    const modelType = ITEM_TYPES.includes(it.type as (typeof ITEM_TYPES)[number])
      ? (it.type as RecognizeDraft["type"])
      : "其他";
    const priority = PRIORITIES.includes(it.priority as (typeof PRIORITIES)[number])
      ? (it.priority as RecognizeDraft["priority"])
      : "普通";
    const dueAt =
      typeof it.dueAt === "string" && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(it.dueAt)
        ? it.dueAt
        : null;
    const amount =
      typeof it.amount === "number" && Number.isFinite(it.amount) ? it.amount : null;
    const content = String(it.content || "").slice(0, 160);
    return {
      customer: String(it.customer || "")
        .replace(/[^\u4e00-\u9fa5A-Za-z0-9（）()\-_.\s]/g, "")
        .trim()
        .slice(0, 40),
      type: inferType(content) || modelType,
      content,
      amount,
      dueAt,
      priority,
    };
  });

  if (!items.length || items.every((item) => !item.content.trim() && item.amount == null)) {
    throw new Error("no_todo_detected");
  }
  return items;
}
