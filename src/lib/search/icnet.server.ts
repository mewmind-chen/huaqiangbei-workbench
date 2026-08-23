/**
 * IC 交易网(ic.net.cn)接入 — 登录会话 Tool(v3: 会话复用 + 真人化 + 限频)。
 *
 * 风控对策(2026-08-23 实测 searchPnCode.php JSFuck 挑战页):
 * - 会话复用: 常驻单浏览器/上下文/页面, 查询间不重建 —— 消灭"每次新开
 *   Chrome"这一最强机器人特征;
 * - 真人化: 查询间随机 3-8s、随机鼠标轨迹、随机滚动、首页随机停留;
 * - 限频缓存: 同型号 5 分钟命中返回缓存, 不重复访问平台;
 * - 风控识别: 命中 searchPnCode/member 跳转即结构化返回受限 + 直达链接
 *   (前端渲染为"浏览器打开"按钮, 用户手动访问不受平台限制)。
 * cookie 全程仅存在于本机浏览器进程内存。
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { LiveOffer } from "@/lib/search/result-types";

/** 登录态来源优先级: env ICNET_COOKIE > fetcher-config.json 文件 .icnetCookie > env HQB_FETCHER_CONFIG(JSON 串) */
export function getIcnetCookie(): string {
  const fromEnv = String(process.env.ICNET_COOKIE || "").trim();
  if (fromEnv) return fromEnv;
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

/* ------------------------------- 限频缓存 ------------------------------- */

type CacheEntry = { offers: LiveOffer[]; at: number };
const CACHE_TTL_MS = 5 * 60_000;
const resultCache = new Map<string, CacheEntry>();

/* --------------------------- 常驻会话(单例) ----------------------------- */

type Session = {
  browser: import("playwright").Browser;
  ctx: import("playwright").BrowserContext;
  page: import("playwright").Page;
  lastUsed: number;
};

let session: Session | null = null;
const SESSION_IDLE_MS = 5 * 60_000;

/** 随机 [a,b] 毫秒休眠, 真人化节奏。 */
function humanWait(a_ms: number, b_ms: number): Promise<void> {
  const ms = a_ms + Math.floor(Math.random() * (b_ms - a_ms));
  return new Promise((r) => setTimeout(r, ms));
}

/** 随机鼠标轨迹(划几道弧线), 降低自动化特征。 */
async function humanMouse(page: import("playwright").Page): Promise<void> {
  const vp = page.viewportSize() ?? { width: 1366, height: 900 };
  for (let i = 0; i < 3; i += 1) {
    const x = 200 + Math.floor(Math.random() * (vp.width - 400));
    const y = 150 + Math.floor(Math.random() * (vp.height - 300));
    await page.mouse.move(x, y, { steps: 8 + Math.floor(Math.random() * 10) });
    await humanWait(180, 600);
  }
}

/** 随机小幅滚动(搜索列表页)。 */
async function humanScroll(page: import("playwright").Page): Promise<void> {
  try {
    await page.mouse.wheel(0, 120 + Math.floor(Math.random() * 260));
    await humanWait(300, 900);
    await page.mouse.wheel(0, -60 - Math.floor(Math.random() * 120));
  } catch {
    /* ignore */
  }
}

async function getSession(): Promise<Session> {
  await reapIdleSession();
  touchSessionIdle();
  if (session) return session;
  let chromium: typeof import("playwright").chromium;
  try {
    ({ chromium } = await import("playwright"));
  } catch {
    throw new Error("playwright 未安装(devDependencies)");
  }
  const browser = await chromium.launch({
    channel: "chrome",
    headless: true,
    args: ["--disable-blink-features=AutomationControlled", "--no-first-run", "--no-sandbox"],
  });
  const cookie = getIcnetCookie();
  const ctx = await browser.newContext({ userAgent: UA, viewport: { width: 1366, height: 900 } });
  if (cookie) {
    await ctx.addCookies(
      cookie
        .split(/;\s*/)
        .filter(Boolean)
        .map((p) => {
          const i = p.indexOf("=");
          return { name: p.slice(0, i), value: p.slice(i + 1), domain: ".ic.net.cn", path: "/" };
        }),
    );
  }
  await ctx.addInitScript(() => {
    Object.defineProperty(navigator, "webdriver", { get: () => undefined });
  });
  const page = await ctx.newPage();
  session = { browser, ctx, page, lastUsed: Date.now() };
  return session;
}

function touchSessionIdle(): void {
  if (session) session.lastUsed = Date.now();
}

/** 空闲回收: 上次使用超过阈值则关闭浏览器实例。 */
async function reapIdleSession(): Promise<void> {
  if (!session) return;
  if (Date.now() - session.lastUsed > SESSION_IDLE_MS) {
    try {
      await session.browser.close();
    } catch {
      /* ignore */
    }
    session = null;
  }
}

/* ------------------------------- 解析器 -------------------------------- */

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

/* ------------------------------- 抓取流程 ------------------------------- */

export type IcnetFetchResult =
  | { status: "ok"; offers: LiveOffer[]; cached?: boolean }
  | { status: "empty"; detail: string; url: string }
  | { status: "auth_required"; detail: string; url: string }
  | { status: "error"; detail: string };

const SEARCH_URL = (mpn: string): string =>
  `https://www.ic.net.cn/search/${encodeURIComponent(mpn)}.html`;

export async function fetchIcnetOffers(mpn: string, cookie: string): Promise<IcnetFetchResult> {
  const key = normMpn(mpn);
  if (!cookie) {
    return {
      status: "auth_required",
      detail: "IC交易网需会员登录。运行 node scripts/icnet-setup.mjs \"<Cookie>\" 一键配置(凭据只存本机)。",
      url: SEARCH_URL(mpn),
    };
  }
  // 1) 限频缓存: 同型号 5 分钟内直接返回
  const hit = resultCache.get(key);
  if (hit && Date.now() - hit.at < CACHE_TTL_MS) {
    return { status: "ok", offers: hit.offers, cached: true };
  }
  // 2) 会话复用(首次才启动浏览器)
  let sess: Session;
  try {
    sess = await getSession();
  } catch (err) {
    return { status: "error", detail: err instanceof Error ? err.message : "浏览器启动失败" };
  }
  try {
    const { page } = sess;
    // 真人化: 查询间随机间隔(首个查询也做, 让节奏自然)
    await humanWait(1500, 4500);
    await humanMouse(page);
    // 首页过环境挑战(首次已访问过就无感导航)
    try {
      await page.goto("https://www.ic.net.cn/", { waitUntil: "domcontentloaded", timeout: 45_000 });
    } catch {
      /* 已有就绪上下文 */
    }
    await humanWait(1200, 3200);
    await humanMouse(page);
    // 导航到搜索结果页
    try {
      await page.goto(SEARCH_URL(mpn), { waitUntil: "domcontentloaded", timeout: 45_000 });
    } catch {
      /* 页面可能在挑战中, 靠轮询判断 */
    }
    // 轮询等待列表渲染(更短的早期探测, 捕获风控页)
    let html = "";
    let hits = 0;
    let urls = "";
    for (let i = 0; i < 4; i += 1) {
      await humanWait(1200, 2400);
      html = await page.content().catch(() => "");
      urls = page.url();
      hits = (html.match(new RegExp(key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "gi")) || []).length;
      if (hits > 5) break;
    }
    // 3) 风控/登录墙识别
    if (/searchPnCode|member\.ic\.net\.cn\/login|login\.php/.test(urls)) {
      return {
        status: "auth_required",
        detail:
          "IC交易网正对该访问模式风控(js挑战页)。请" + "在浏览器手动打开" + SEARCH_URL(mpn) + "查看; 稍后再来自动查询(会话复用已降低触发)。",
        url: SEARCH_URL(mpn),
      };
    }
    if (/member\.ic\.net\.cn\/login/.test(html) || /name="(username|password)"/i.test(html)) {
      return { status: "auth_required", detail: "IC交易网会话已过期, 请重新复制 Cookie。", url: SEARCH_URL(mpn) };
    }
    if (!hits) {
      return {
        status: "empty" as const,
        detail: `未渲染出结果(可能无货或页面受限)。手动打开 ${urls.slice(0, 60)} 查看。`,
        url: SEARCH_URL(mpn),
      };
    }
    await humanScroll(page);
    const offers = parseIcnetHtml(html, mpn);
    if (!offers.length) {
      return {
        status: "empty" as const,
        detail: "结果页已加载但未解析到结构化挂货行(可能页面结构变化)。",
        url: SEARCH_URL(mpn),
      };
    }
    resultCache.set(key, { offers, at: Date.now() });
    return { status: "ok", offers };
  } finally {
    touchSessionIdle();
  }
}