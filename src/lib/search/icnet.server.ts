/**
 * IC 交易网(ic.net.cn)接入 — 登录会话 Tool 骨架。
 *
 * 技术侦察结论(docs/agent-integration-design.md §7.1 同源记录):
 * - Web 搜索页 302 强制登录(member.ic.net.cn/login.php);
 * - 移动版为混淆加密 SPA, 逆向成本高;
 * - 开源社区无现成实现(GitHub/Gitee 均零命中)。
 * 故采用「登录会话」模式: 服务端持有用户自己会员账号的 cookie,
 * 无 cookie 时结构化返回 auth_required(方案第 12 章), 绝不硬闯。
 */
import type { LiveOffer } from "@/lib/search/result-types";

/** 登录态来源优先级: env ICNET_COOKIE > fetcher-config.json .icnetCookie */
export function getIcnetCookie(): string {
  const fromEnv = String(process.env.ICNET_COOKIE || "").trim();
  if (fromEnv) return fromEnv;
  try {
    const raw = String(process.env.HQB_FETCHER_CONFIG || "");
    if (raw.trim()) {
      const parsed = JSON.parse(raw) as { icnetCookie?: string };
      if (parsed.icnetCookie?.trim()) return parsed.icnetCookie.trim();
    }
  } catch {
    /* ignore */
  }
  return "";
}

export type IcnetResult =
  | { status: "auth_required"; detail: string }
  | { status: "ok"; offers: LiveOffer[] }
  | { status: "empty"; detail: string }
  | { status: "error"; detail: string };

/**
 * 抓取并解析 ic.net.cn 搜索页。cookie 由调用方注入;
 * 解析器为保守的通用表格提取 —— 待真实登录态样本到位后精调列映射。
 */
export async function fetchIcnetOffers(
  mpn: string,
  cookie: string,
  scrapeMarkdown: (url: string, waitFor?: number) => Promise<string>,
): Promise<IcnetResult> {
  if (!cookie) {
    return {
      status: "auth_required",
      detail:
        "IC交易网搜索需会员登录(整站微信扫码墙)。请登录后在浏览器 DevTools 复制 Cookie, 配置到 env ICNET_COOKIE 或 fetcher-config.json 的 icnetCookie 字段(勿提交仓库)。",
    };
  }
  const url = `https://www.ic.net.cn/search/${encodeURIComponent(mpn)}.html`;
  let md = "";
  try {
    md = await scrapeMarkdown(url, 3000);
  } catch (err) {
    const msg = err instanceof Error ? err.message : "fetch failed";
    // fetch 已失败时 md 必为空串, 直接上报错误(审查#3: 移除恒假的正则死检查)
    return { status: "error", detail: msg };
  }
  if (/member\.ic\.net\.cn\/login/.test(md) || /name="(username|password)"/i.test(md)) {
    return { status: "auth_required", detail: "IC交易网会话已过期, 请重新复制 Cookie。" };
  }
  const offers = parseIcnetOffers(md, url);
  if (!offers.length) return { status: "empty", detail: "IC交易网未解析到挂货行(可能无货或页面改版)" };
  return { status: "ok", offers };
}

/**
 * 保守的通用表格提取: ic.net.cn 结果表每行通常含
 * 型号 | 批号 | 数量 | 价格(¥) | 供应商。逐行尝试, 解析不出价格/数量的行丢弃,
 * 宁可少报不错报 —— 待真实登录态样本再精调选择器。
 */
export function parseIcnetOffers(markdown: string, pageUrl: string): LiveOffer[] {
  const out: LiveOffer[] = [];
  const seen = new Set<string>();
  for (const line of markdown.split("\n")) {
    if (!line.includes("|")) continue;
    const cells = line.split("|").map((c) => c.trim()).filter(Boolean);
    if (cells.length < 4) continue;
    // 行内必须出现 ¥ 或纯数字价格, 且有一格像数量
    const priceCell = cells.find((c) => /^[¥￥]\s*[\d,]+(?:\.\d+)?$/.test(c));
    if (!priceCell) continue;
    const price = Number(priceCell.replace(/[¥￥,\s]/g, ""));
    if (!(price > 0)) continue;
    const stockCell = cells.find((c) => /^\d{2,}$/.test(c.replace(/[, ]/g, "")));
    const stock = stockCell ? Number(stockCell.replace(/[, ]/g, "")) : null;
    const supplier = cells.find((c) => /公司|电子|科技|贸易/.test(c)) || cells[cells.length - 1];
    const model = cells.find((c) => /^[A-Za-z0-9][A-Za-z0-9\/_.-]{2,}$/.test(c)) || "";
    const batch = cells.find((c) => /^\d{2,4}\+?$/.test(c)) || "";
    const key = `${model}|${supplier}|${stock}|${price}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({
      sourceKey: "icnet",
      sourceName: "IC交易网",
      supplier,
      model,
      brand: "",
      batch,
      stock,
      price,
      package: "",
      warehouse: "",
      note: "",
      date: batch,
      url: pageUrl,
    });
  }
  return out.slice(0, 40);
}
