import { createServerFn } from "@tanstack/react-start";
import type { PartIntel } from "@/lib/types";

function parseIntel(text: string, query: string): PartIntel {
  const s = String(text).trim().replace(/```(?:json)?/gi, "").trim();
  const start = s.indexOf("{");
  const end = s.lastIndexOf("}");
  if (start < 0 || end < 0) throw new Error("情报解析失败");
  const parsed = JSON.parse(s.slice(start, end + 1)) as Record<string, unknown>;
  const kind = parsed.kind === "company" ? "company" : "part";
  const aliases = Array.isArray(parsed.aliases)
    ? parsed.aliases.map((a) => String(a)).filter(Boolean).slice(0, 6)
    : [];
  return {
    query,
    kind,
    name: String(parsed.name || query).slice(0, 80),
    manufacturer: String(parsed.manufacturer || "").slice(0, 80),
    aliases,
    description: String(parsed.description || "").slice(0, 280),
    typicalPackage: String(parsed.typicalPackage || "").slice(0, 40),
    notes: String(parsed.notes || "").slice(0, 200),
  };
}

export const lookupPart = createServerFn({ method: "POST" })
  .validator((input: { query: string }) => input)
  .handler(async ({ data }) => {
    const query = String(data.query || "").trim().slice(0, 80);
    if (!query) return { ok: false as const, error: "请输入型号或公司名" };
    const apiKey = process.env.XAI_API_KEY;
    if (!apiKey) return { ok: false as const, error: "查询服务暂不可用" };

    const res = await fetch("https://api.x.ai/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: "grok-4.5",
        max_tokens: 500,
        temperature: 0.1,
        messages: [
          {
            role: "user",
            content: `你是电子元器件贸易助手。根据用户输入判断是「型号」还是「公司」，给出公开常识情报。不要编造库存和实时价格。
用户输入：${query}

只输出 JSON：
{"kind":"part或company","name":"标准名称","manufacturer":"原厂/公司","aliases":["别名"],"description":"一句话用途/主营","typicalPackage":"封装或空","notes":"查货注意点"}`,
          },
        ],
      }),
    });
    if (!res.ok) return { ok: false as const, error: `查询失败（${res.status}）` };
    const body = (await res.json()) as {
      choices?: { message?: { content?: string } }[];
    };
    try {
      return { ok: true as const, intel: parseIntel(body.choices?.[0]?.message?.content ?? "", query) };
    } catch (err) {
      return {
        ok: false as const,
        error: err instanceof Error ? err.message : "结果无法解析",
      };
    }
  });

export function sourceLinks(query: string) {
  const q = encodeURIComponent(query);
  return [
    { id: "lcsc", name: "立创商城", href: `https://so.szlcsc.com/global.html?k=${q}` },
    { id: "hqew", name: "华强电子网", href: `https://www.hqew.com/search?keywords=${q}` },
    { id: "ic", name: "IC 交易网", href: `https://www.ic.net.cn/search/${q}.html` },
    { id: "findchips", name: "Findchips", href: `https://www.findchips.com/search/${q}` },
    { id: "wk", name: "维库", href: `https://www.dzsc.com/ic/${q}.html` },
    { id: "21ic", name: "21IC", href: `https://www.21icsearch.com/${q}.html` },
  ];
}
