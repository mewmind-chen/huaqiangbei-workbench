import { createServerFn } from "@tanstack/react-start";
import { ITEM_TYPES, type RecognizeDraft } from "@/lib/types";

const PROMPT = `你正在识别一张微信/QQ聊天记录截图。
- 顶部标题栏是群名/好友名；消息是气泡；发送者昵称是彩色小字
- 屏幕左侧气泡通常是客户/对方发来的，右侧是自己发的
- 客户名字优先从截图左上角标题栏提取

提取【客户/对方发来的】所有业务消息，一条消息一条记录，不要合并。
只输出 JSON，不要其他文字：
{"items":[{"customer":"客户名称","type":"类型","content":"事项内容","amount":数字或null,"dueAt":"YYYY-MM-DDTHH:mm或null"}]}

规则：
- type 只能是：报价、下单、发货、对账、发票、催收款、其他
- 提到报价/价格/BOM/型号 → 报价；下单/订货/要货 → 下单；发货/物流 → 发货；对账/账单 → 对账；发票/开票 → 发票；付款/催款 → 催收款
- content 写业务要点；带文件名必须包含文件名
- amount 只有明确金额才填，否则 null
- dueAt 只有明确日期时间才填
- customer 不要带表情；实在没有才填"客户"`;

function extractItems(text: string): RecognizeDraft[] {
  let s = String(text).trim().replace(/```(?:json)?/gi, "").trim();
  const start = s.indexOf("{");
  const end = s.lastIndexOf("}");
  const arrStart = s.indexOf("[");
  let raw: unknown[] = [];
  if (start < 0 || (arrStart >= 0 && arrStart < start)) {
    const arrEnd = s.lastIndexOf("]");
    if (arrStart < 0 || arrEnd < 0) throw new Error("识别结果解析失败");
    const parsed = JSON.parse(s.slice(arrStart, arrEnd + 1)) as unknown;
    raw = Array.isArray(parsed) ? parsed : [];
  } else {
    const parsed = JSON.parse(s.slice(start, end + 1)) as { items?: unknown[] };
    raw = Array.isArray(parsed.items) ? parsed.items : [];
  }
  const items: RecognizeDraft[] = raw.map((row) => {
    const it = row as Record<string, unknown>;
    const type = ITEM_TYPES.includes(it.type as (typeof ITEM_TYPES)[number])
      ? (it.type as RecognizeDraft["type"])
      : "其他";
    const dueAt =
      typeof it.dueAt === "string" && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(it.dueAt)
        ? it.dueAt
        : null;
    const amount =
      typeof it.amount === "number" && Number.isFinite(it.amount) ? it.amount : null;
    return {
      customer: String(it.customer || "")
        .replace(/[^\u4e00-\u9fa5A-Za-z0-9（）()\-_.\s]/g, "")
        .trim()
        .slice(0, 40),
      type,
      content: String(it.content || "").slice(0, 160),
      amount,
      dueAt,
    };
  });
  if (!items.length || items.every((it) => !it.content && it.amount == null)) {
    throw new Error("未能识别出任何事项");
  }
  return items;
}

export const recognizeChatShot = createServerFn({ method: "POST" })
  .validator((input: { image: string; mime: string }) => input)
  .handler(async ({ data }) => {
    const apiKey = process.env.XAI_API_KEY;
    if (!apiKey) return { ok: false as const, error: "识别服务暂不可用" };
    if (!data.image || data.image.length > 2_500_000) {
      return { ok: false as const, error: "图片过大，请换一张更小的截图" };
    }
    const mime = data.mime === "image/png" ? "image/png" : "image/jpeg";
    let res: Response;
    try {
      res = await fetch("https://api.x.ai/v1/chat/completions", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          model: "grok-4.5",
          max_tokens: 1200,
          temperature: 0.1,
          messages: [
            {
              role: "user",
              content: [
                {
                  type: "image_url",
                  image_url: { url: `data:${mime};base64,${data.image}` },
                },
                { type: "text", text: PROMPT },
              ],
            },
          ],
        }),
        signal: AbortSignal.timeout(45_000),
      });
    } catch {
      return { ok: false as const, error: "识别超时，请换一张更清晰的截图再试" };
    }
    if (!res.ok) {
      return { ok: false as const, error: `识别失败（${res.status}）` };
    }
    const body = (await res.json()) as {
      choices?: { message?: { content?: string } }[];
    };
    const text = body.choices?.[0]?.message?.content ?? "";
    try {
      return { ok: true as const, items: extractItems(text) };
    } catch (err) {
      return {
        ok: false as const,
        error: err instanceof Error ? err.message : "识别结果无法解析",
      };
    }
  });
