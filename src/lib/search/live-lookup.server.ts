import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  parseGysCompanies,
  parseHqewOffers,
  parseLcscItem,
  parseLcscSearchItemUrl,
  parseLcscSearchListing,
  parseShopInventory,
  parseStApplications,
  stProductUrl,
  type HqewOffer,
  type LcscItem,
  type ShopRow,
} from "@/lib/search/md-parse";
import type {
  LiveOffer,
  LookupStepKey,
  LookupStepResult,
  PartIdentity,
} from "@/lib/search/result-types";

function getFirecrawlKey(override?: string): string {
  const fromArg = String(override || "").trim();
  if (fromArg) return fromArg;
  const fromEnv = String(process.env.FIRECRAWL_API_KEY || process.env.FC_API_KEY || "").trim();
  if (fromEnv) return fromEnv;
  const files = [
    "/workspace/fetcher-config.json",
    join(process.cwd(), "fetcher-config.json"),
    "/workspace/.env",
    join(process.cwd(), ".env"),
    join(process.cwd(), "artifacts/工作台研究/TodoApp-Mac版/fetcher-config.json"),
    "/workspace/artifacts/工作台研究/TodoApp-Mac版/fetcher-config.json",
  ];
  for (const p of files) {
    try {
      const raw = readFileSync(p, "utf8");
      if (p.endsWith(".env")) {
        const m = raw.match(/^(?:export\s+)?FIRECRAWL_API_KEY\s*=\s*["']?([^\r\n"']+)/m);
        if (m?.[1]?.trim()) return m[1].trim();
        continue;
      }
      const parsed = JSON.parse(raw) as { apiKey?: string };
      if (parsed.apiKey) return String(parsed.apiKey).trim();
    } catch {
      /* next */
    }
  }
  return "";
}

let requestKey = "";

async function scrapeMarkdown(url: string, waitFor = 2800): Promise<string> {
  const key = getFirecrawlKey(requestKey);
  if (!key) throw new Error("未配置抓取服务");
  const res = await fetch("https://api.firecrawl.dev/v2/scrape", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${key}`,
    },
    body: JSON.stringify({
      url,
      formats: ["markdown"],
      onlyMainContent: true,
      waitFor,
    }),
    signal: AbortSignal.timeout(60_000),
  });
  if (!res.ok) throw new Error(`抓取失败（${res.status}）`);
  const body = (await res.json()) as {
    success?: boolean;
    data?: { markdown?: string };
  };
  const md = body.data?.markdown || "";
  if (!body.success || !md) throw new Error("页面无内容");
  return md;
}

function enc(v: string) {
  return encodeURIComponent(v);
}

function yunPriceFromHqew(md: string): number | null {
  const m = md.match(/云价格[：:]\s*￥\s*([\d.]+)/);
  return m ? Number(m[1]) : null;
}

function lcscToOffer(item: LcscItem): LiveOffer {
  return {
    sourceKey: "lcsc",
    sourceName: "立创商城",
    supplier: "立创商城",
    model: item.mpn,
    brand: item.brand,
    batch: "",
    stock: item.stock,
    price: item.priceBreaks[0]?.price ?? null,
    priceBreaks: item.priceBreaks,
    package: item.package,
    warehouse: "立创自营",
    note: item.category,
    date: "",
    url: item.url,
  };
}

function hqewToOffer(o: HqewOffer, url: string): LiveOffer {
  return {
    sourceKey: "hqew",
    sourceName: "华强挂货",
    supplier: o.supplier,
    model: o.model,
    brand: o.brand,
    batch: o.batch,
    stock: o.stock,
    price: o.price,
    package: o.package,
    warehouse: o.warehouse,
    note: o.note,
    date: o.date,
    url,
  };
}

function shopToOffer(row: ShopRow, url: string, supplier: string): LiveOffer {
  return {
    sourceKey: "shop",
    sourceName: "商铺库存",
    supplier,
    model: row.model,
    brand: row.brand,
    batch: row.batch,
    stock: row.stock,
    price: null,
    package: row.package,
    warehouse: "",
    note: row.category,
    date: row.date,
    url,
  };
}

function identityFromLcsc(item: LcscItem): PartIdentity {
  return {
    mpn: item.mpn,
    brand: item.brand,
    category: item.category,
    package: item.package,
    desc: item.desc,
    summary: item.summary,
    features: item.features,
    lcscCode: item.lcscCode,
    specs: item.specs,
    applications: [],
    longevity: "",
    active: false,
    lcscStock: item.stock,
    priceBreaks: item.priceBreaks,
    lcscUrl: item.url,
    stUrl: "",
  };
}

async function stepLcsc(query: string): Promise<LookupStepResult> {
  const searchUrl = `https://so.szlcsc.com/global.html?k=${enc(query)}`;
  const searchMd = await scrapeMarkdown(searchUrl, 2500);
  const listing = parseLcscSearchListing(searchMd, query);
  const itemUrl = listing?.url || parseLcscSearchItemUrl(searchMd, query);
  if (!itemUrl && !listing) {
    return { ok: true, step: "lcsc", status: "empty", url: searchUrl, detail: "立创搜索未找到商品" };
  }
  let item = listing;
  if (itemUrl) {
    try {
      const itemMd = await scrapeMarkdown(itemUrl, 2500);
      item = parseLcscItem(itemMd, query, itemUrl);
      if (listing) {
        item = {
          ...item,
          brand: item.brand || listing.brand,
          category: item.category || listing.category,
          package: item.package || listing.package,
          stock: item.stock ?? listing.stock,
          priceBreaks: item.priceBreaks.length ? item.priceBreaks : listing.priceBreaks,
        };
      }
    } catch {
      /* listing 兜底 */
    }
  }
  if (!item) {
    return { ok: true, step: "lcsc", status: "empty", url: searchUrl };
  }
  return {
    ok: true,
    step: "lcsc",
    status: "ok",
    url: item.url || searchUrl,
    identity: identityFromLcsc(item),
    alts: item.alts,
    offers: [lcscToOffer(item)],
  };
}

async function stepSt(query: string): Promise<LookupStepResult> {
  const url = stProductUrl(query);
  if (!url) {
    return {
      ok: true,
      step: "st",
      status: "skipped",
      url: "",
      detail: "目前只自动打开 STM32 的 ST 原厂页",
    };
  }
  const md = await scrapeMarkdown(url, 2000);
  const parsed = parseStApplications(md);
  if (!parsed.applications.length && !parsed.active) {
    return { ok: true, step: "st", status: "empty", url, detail: "原厂页未解析到应用领域" };
  }
  return {
    ok: true,
    step: "st",
    status: "ok",
    url,
    identity: {
      mpn: query.toUpperCase(),
      brand: "",
      category: "",
      package: "",
      desc: parsed.desc,
      summary: "",
      features: "",
      lcscCode: "",
      specs: [],
      applications: parsed.applications,
      longevity: parsed.longevity,
      active: parsed.active,
      lcscStock: null,
      priceBreaks: [],
      lcscUrl: "",
      stUrl: url,
    },
  };
}

async function stepHqew(query: string): Promise<LookupStepResult> {
  const url = `https://s.hqew.com/${enc(query)}.html`;
  const md = await scrapeMarkdown(url, 3000);
  const rows = parseHqewOffers(md);
  const yun = yunPriceFromHqew(md);
  return {
    ok: true,
    step: "hqew",
    status: rows.length ? "ok" : "empty",
    url,
    detail: yun != null ? `云价格 ¥${yun}` : undefined,
    offers: rows.slice(0, 40).map((row) => hqewToOffer(row, url)),
  };
}

async function stepGys(query: string): Promise<LookupStepResult> {
  const url = `https://gys.hqew.com/search/${enc(query)}.html`;
  const md = await scrapeMarkdown(url, 3000);
  const companies = parseGysCompanies(md, query);
  return {
    ok: true,
    step: "gys",
    status: companies.length ? "ok" : "empty",
    url,
    companies,
  };
}

async function stepShop(shopUrl: string): Promise<LookupStepResult> {
  if (!shopUrl) {
    return { ok: true, step: "shop", status: "skipped", url: "", detail: "供应商搜索没有商铺链接" };
  }
  const base = shopUrl.replace(/^http:\/\//, "https://").replace(/\/$/, "");
  const productUrl = `${base}/product`;
  let used = productUrl;
  let md = "";
  try {
    md = await scrapeMarkdown(productUrl, 2500);
  } catch {
    used = base;
    md = await scrapeMarkdown(base, 2500);
  }
  let rows = parseShopInventory(md);
  if (!rows.length && used !== base) {
    used = base;
    md = await scrapeMarkdown(base, 2500);
    rows = parseShopInventory(md);
  }
  const supplier = base.replace(/^https?:\/\//, "").split(".")[0] || "";
  return {
    ok: true,
    step: "shop",
    status: rows.length ? "ok" : "empty",
    url: used,
    shopRows: rows.slice(0, 40),
    offers: rows.slice(0, 40).map((row) => shopToOffer(row, used, supplier)),
  };
}

export async function runLookupStep(input: {
  query: string;
  step: LookupStepKey;
  shopUrl?: string;
  kind?: "part" | "company";
  scrapeKey?: string;
}): Promise<LookupStepResult> {
  const query = String(input.query || "").trim().slice(0, 80);
  const step = input.step;
  requestKey = String(input.scrapeKey || "").trim();
  if (!query) return { ok: false, step, error: "请输入型号或公司名" };
  if (step === "intel") {
    try {
      const { fetchIntelBrief, identityPatchFromIntel } = await import("./anysearch.server");
      const kind = input.kind === "company" ? "company" : "part";
      const intel = await fetchIntelBrief(query, kind);
      return {
        ok: true,
        step: "intel",
        status: intel.hits.length ? "ok" : "empty",
        url: intel.hits[0]?.url || "",
        intel,
        identity: kind === "part" ? identityPatchFromIntel(query, intel) : undefined,
        detail: intel.summary,
      };
    } catch (err) {
      return { ok: false, step, error: err instanceof Error ? err.message : "公开资料失败" };
    }
  }
  if (!getFirecrawlKey(requestKey)) return { ok: false, step, error: "查询服务暂不可用" };
  try {
    if (step === "lcsc") return await stepLcsc(query);
    if (step === "st") return await stepSt(query);
    if (step === "hqew") return await stepHqew(query);
    if (step === "gys") return await stepGys(query);
    if (step === "icnet") {
      // IC交易网: 登录会话模式 —— 无 cookie 时结构化 auth_required(不硬闯登录墙)
      const { getIcnetCookie, fetchIcnetOffers } = await import("./icnet.server");
      const cookie = getIcnetCookie();
      const r = await fetchIcnetOffers(query, cookie);
      if (r.status === "ok") {
        return {
          ok: true,
          step,
          status: "ok",
          url: `https://www.ic.net.cn/search/${encodeURIComponent(query)}.html`,
          offers: r.offers,
        };
      }
      if (r.status === "auth_required" || r.status === "empty") {
        // C 方案: 受限/空结果也带上直达搜索链接, 前端步骤栏渲染为可点开的
        // "浏览器打开"入口(平台风控只拦自动化, 手动访问不受影响)。
        return {
          ok: true,
          step,
          status: r.status === "empty" ? "empty" : "skipped",
          url: r.url ?? `https://www.ic.net.cn/search/${encodeURIComponent(query)}.html`,
          detail: r.detail,
        };
      }
      return { ok: false, step, error: r.detail };
    }
    if (step === "findchips") {
      // Findchips(海外授权分销聚合, 公开可抓): 美元价显式标注 currency=USD
      const { fetchFindchipsOffers } = await import("./findchips.server");
      const r = await fetchFindchipsOffers(query, scrapeMarkdown);
      if (r.status === "ok" && !r.offers.length) {
        return { ok: true, step, status: "empty", url: `https://www.findchips.com/search/${encodeURIComponent(query)}`, detail: "Findchips 无精确匹配或全部无货" };
      }
      if (r.status === "error") return { ok: false, step, error: r.detail };
      return {
        ok: true,
        step,
        status: "ok",
        url: `https://www.findchips.com/search/${encodeURIComponent(query)}`,
        offers: r.offers,
      };
    }
    return await stepShop(String(input.shopUrl || ""));
  } catch (err) {
    return { ok: false, step, error: err instanceof Error ? err.message : "查询失败" };
  }
}
