/**
 * IC 交易网(ic.net.cn)接入 — 登录会话 Tool(v2: 本地 Playwright 直连)。
 *
 * 技术侦察结论(2026-08-23 实测):
 * - Web 搜索页有 JS cookie 挑战(混淆 obfuscator), 裸 HTTP/裸 VM 均难过;
 * - 挑战对 "禁用 AutomationControlled + navigator.webdriver 隐藏" 的真 Chrome 放行;
 * - 结果列表为 JS 渲染(.result_son 条目), 需等渲染完成再取 DOM;
 * - 登录态由用户会员账号 cookie 提供(fetcher-config.json .icnetCookie),
 *   全程本地浏览器抓取, **cookie 不经过任何第三方云服务**。
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { LiveOffer } from "@/lib/search/result-types";

/** 登录态来源优先级: env ICNET_COOKIE > fetcher-config.json 文件 .icnetCookie > env HQB_FETCHER_CONFIG(JSON 串) */
export function getIcnetCookie(): string {
  const fromEnv = String(process.env.ICNET_COOKIE || "").trim();
  if (fromEnv) return fromEnv;
  // 主路径: 项目根 fetcher-config.json(icnet-setup.mjs 写入的位置; 与 Firecrawl key 同文件)
  try {
    for (const p of [join(process.cwd(), "fetcher-config.json"), "/workspace/fetcher-config.json"]) {
      try {
        const parsed = JSON.parse(readFileSync(p, "utf8")) as { icnetCookie?: string };
        if (parsed.icnetCookie?.trim()) return parsed.icnetCookie.trim();
      } catch {
        /* next path */
      }
    }
  } catch {
    /* ignore */
  }
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

const UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/151.0.0.0 Safari/537.36";

function normMpn(s: string): string {
  return s.trim().toUpperCase().replace(/\s+/g, "");
}

/** 从渲染后的结果页 HTML 提取挂货行(token 状态机版)。 */
export function parseIcnetHtml(html: string, mpn: string): LiveOffer[] {
  const out: LiveOffer[] = [];
  const seen = new Set<string>();
  const want = normMpn(mpn);
  const marks = [...html.matchAll(/class="(?:result_son|stair_tr)[^"]*"/g)].map((m) => m.index ?? 0);
  if (!marks.length) return out;
  const bodyStart = html.indexOf("<body");
  const slices: string[] = [];
  for (let i = 0; i < marks.length; i += 1) {
    if (marks[i] < bodyStart) continue;
    const end2 = i + 1 < marks.length ? marks[i + 1] : Math.min(html.length, marks[i] + 8000);
    slices.push(html.slice(marks[i], end2));
  }
  const YUAN = "\uFFE5";
  const isNum = (t?: string): boolean => !!t && /^\d[\d,]*$/.test(t);
  const numOf = (t: string): number => Number(t.replace(/,/g, ""));

  for (const block of slices) {
    const text = block
      .replace(/<script[\s\S]*?<\/script>/g, "")
      .replace(/<[^>]+>/g, " ")
      .replace(/\s+/g, " ");
    if (!text.toUpperCase().includes(want)) continue;
    const toks = text.split(" ").filter(Boolean);

    // 形态 A(ICGOO 双币阶梯): qty, "+", "$:", usd, "￥:", cny
    for (let i = 0; i + 5 < toks.length; i += 1) {
      if (!(isNum(toks[i]) && toks[i + 1] === "+" && toks[i + 2] === "$:" && toks[i + 4].startsWith(YUAN))) continue;
      const qty = numOf(toks[i]);
      const priceUsd = Number(toks[i + 3]);
      const priceCny = numOf(toks[i + 5]);
      if (!(qty > 0 && priceUsd > 0 && priceCny > 0)) continue;
      // 向前找型号与批号(品牌/批号紧邻型号之后)
      let batch = "";
      for (let k = i - 1; k >= Math.max(0, i - 8); k -= 1) {
        if (/^\d{4}$/.test(toks[k] ?? "")) { batch = toks[k]; break; }
      }
      const key = `ICGOO|${batch}|${priceCny}`;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({
        sourceKey: "icnet",
        sourceName: "IC交易网·ICGOO",
        supplier: "ICGOO商城",
        model: want,
        brand: "",
        batch,
        stock: null,
        price: priceCny,
        priceBreaks: [{ qty, price: priceCny }],
        package: "",
        warehouse: "icgoo",
        note: "CNY; ICGOO双币阶梯",
        date: new Date().toISOString().slice(0, 10),
        url: `https://www.ic.net.cn/search/${encodeURIComponent(want)}.html`,
        currency: "CNY",
      });
      break; // 该块取一档即可
    }

    // 形态 C(华强供应商行): ... 公司名 ... MPN 品牌 批号+ 库存 封装 地区 低至 ￥x 起
    const lowIdx = toks.indexOf("低至");
    if (lowIdx < 6) continue;
    let priceTok: string | null = null;
    for (let k = lowIdx + 1; k <= lowIdx + 3 && k < toks.length; k += 1) {
      const m = toks[k].match(new RegExp(YUAN + "?\\s*([\\d,.]+)"));
      if (m) { priceTok = m[1]; break; }
    }
    if (!priceTok) continue;
    const pkg = toks[lowIdx - 1];
    const region = toks[lowIdx - 2];
    const stockTok = toks[lowIdx - 3];
    const batchTok = toks[lowIdx - 4];
    const brand = toks[lowIdx - 5];
    const modelTok = toks[lowIdx - 6];
    if (normMpn(modelTok ?? "") !== want) continue;
    if (!/^\d{2,4}\+?$/.test(batchTok)) continue;
    if (!isNum(stockTok)) continue;
    const supplier = (() => {
      for (let k = lowIdx - 7; k >= Math.max(0, lowIdx - 40); k -= 1) {
        if (/公司|电子|科技|贸易|实业|微电子/.test(toks[k]) && toks[k].length >= 4) return toks[k];
      }
      return "IC交易网供应商";
    })();
    const key = `${supplier}|${batchTok}|${stockTok}|${priceTok}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({
      sourceKey: "icnet",
      sourceName: "IC交易网",
      supplier,
      model: want,
      brand,
      batch: batchTok,
      stock: numOf(stockTok),
      price: numOf(priceTok),
      package: pkg,
      warehouse: region,
      note: `CNY; 地区:${region || "未知"}`,
      date: new Date().toISOString().slice(0, 10),
      url: `https://www.ic.net.cn/search/${encodeURIComponent(want)}.html`,
      currency: "CNY",
    });
    if (out.length >= 40) break;
  }
  return out.slice(0, 40);
}

/**
 * 登录会话抓取: 本地 Playwright(系统 Chrome)+ 用户会员 cookie。
 * 流程: 注入 cookie → 首页过环境挑战 → 导航搜索页 → 等待列表渲染 → 解析。
 * cookie 全程仅存在于本机浏览器进程内存, 不经过任何第三方云服务。
 */
export async function fetchIcnetOffers(
  mpn: string,
  cookie: string,
): Promise<
  | { status: "ok"; offers: LiveOffer[] }
  | { status: "empty"; detail: string }
  | { status: "auth_required"; detail: string }
  | { status: "error"; detail: string }
> {
  if (!cookie) {
    return {
      status: "auth_required",
      detail:
        "IC交易网需会员登录。运行 node scripts/icnet-setup.mjs \"<浏览器复制的Cookie>\" 一键配置(凭据只存本机 fetcher-config.json)。",
    };
  }
  let chromium: typeof import("playwright").chromium;
  try {
    ({ chromium } = await import("playwright"));
  } catch {
    return { status: "error", detail: "playwright 未安装(devDependencies)" };
  }
  const browser = await chromium.launch({
    channel: "chrome",
    headless: true,
    args: ["--disable-blink-features=AutomationControlled", "--no-first-run"],
  });
  try {
    const ctx = await browser.newContext({ userAgent: UA, viewport: { width: 1366, height: 900 } });
    await ctx.addCookies(
      cookie.split(/;\s*/).filter(Boolean).map((p) => {
        const i = p.indexOf("=");
        return { name: p.slice(0, i), value: p.slice(i + 1), domain: ".ic.net.cn", path: "/" };
      }),
    );
    await ctx.addInitScript(() => {
      Object.defineProperty(navigator, "webdriver", { get: () => undefined });
    });
    const page = await ctx.newPage();
    // ① 首页过环境挑战
    await page.goto("https://www.ic.net.cn/", { waitUntil: "domcontentloaded", timeout: 45_000 });
    await page.waitForTimeout(1500); // 压缩首页等待(加速)
    // ② 导航到搜索结果页
    const target = `https://www.ic.net.cn/search/${encodeURIComponent(mpn)}.html`;
    await page
      .goto(target, { waitUntil: "domcontentloaded", timeout: 45_000 })
      .catch(() => undefined);
    // ③ 轮询等待列表渲染
    let html = "";
    let hits = 0;
    for (let i = 0; i < 4; i += 1) {
      await page.waitForTimeout(2000); // 压缩轮询窗口(加速)
      html = await page.content().catch(() => "");
      hits = (html.match(new RegExp(mpn.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "gi")) || []).length;
      if (hits > 5) break;
    }
    if (/member\.ic\.net\.cn\/login/.test(page.url())) {
      return { status: "auth_required", detail: "IC交易网会话已过期, 请重新复制 Cookie。" };
    }
    if (!hits) {
      return { status: "empty", detail: "页面未渲染出结果(可能无货、改版或被拦截)" };
    }
    const offers = parseIcnetHtml(html, mpn);
    if (!offers.length) return { status: "empty", detail: "结果页已加载但未解析到挂货行(需精调解析器)" };
    return { status: "ok", offers };
  } finally {
    await browser.close().catch(() => undefined);
  }
}
