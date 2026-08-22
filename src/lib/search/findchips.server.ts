/**
 * Findchips(ic.net.cn 同类海外聚合, Supplyframe 系)公开搜索页解析。
 * 数据形态(2026-08 实测 NE555P 样本):
 *   ## [![Xxx logo](..)\  \  Xxx ECIA (NEDA) Member • Authorized Distributor](track)
 *   #### Authorized Distributors / #### Independent Distributors
 *   | Details<br>[MPN](track)DISTI #.. | Manufacturer | Desc | 14129<br>Tube |
 *     - <br>  1<br>..<br> $0.5490<br> .. - See More | $0.2550 / $0.5900 | Buy |
 */
import type { LiveOffer } from "@/lib/search/result-types";

export type FindchipsPriceBreak = { qty: number; priceUsd: number };

export type FindchipsRow = {
  mpn: string;
  distiPart: string;
  manufacturer: string;
  description: string;
  stock: number | null;
  container: string;
  breaks: FindchipsPriceBreak[];
  priceMinUsd: number | null;
  priceMaxUsd: number | null;
  authorized: boolean;
  distributor: string;
};

function normalizeMpn(s: string): string {
  return s.trim().toUpperCase().replace(/[\s_]+/g, "");
}

/** 提取分销商名与授权标志: 标题文本本身携带 "Authorized Distributor"/"ECIA" 字样。 */
function distributorFromHeading(h: string): { name: string; authorized: boolean } {
  const cleaned = h
    .replace(/^#+\s*/, "")
    .replace(/!\[[^\]]*\]\([^)]*\)/g, "")
    .replace(/\\+/g, "")
    .replace(/\]\([^)]*\)/g, "")
    .replace(/[\[\]]/g, "")
    .replace(/\s+/g, " ")
    .trim();
  const authorized = /Authorized\s+Distributor|ECIA/i.test(cleaned);
  const name =
    cleaned.split(/(?:\s+ECIA\b|\s+Authorized\s+Distributor|\s*•|\s*\(NEDA\))/i)[0].trim() ||
    cleaned.slice(0, 40);
  return { name, authorized };
}

function num(s: string): number | null {
  const n = Number(s.replace(/[,$\s]/g, ""));
  return Number.isFinite(n) ? n : null;
}

/** 解析整页 markdown → 结构化行(不做型号过滤, 调用方按 exact/alts 分流)。 */
export function parseFindchipsPage(markdown: string): FindchipsRow[] {
  const rows: FindchipsRow[] = [];
  let authorized = true;
  let distributor = "";
  for (const rawLine of markdown.split("\n")) {
    const line = rawLine.trim();
    if (/^##\s+\[/.test(line)) {
      const h = distributorFromHeading(line);
      distributor = h.name;
      authorized = h.authorized;
      continue;
    }
    if (!line.startsWith("|") || !line.includes("$")) continue;
    const cells = line.split("|").map((c) => c.trim());
    if (cells.length < 7 || !cells[1]) continue;
    const detailCell = cells[1];
    const mpnMatch = detailCell.match(/\[([A-Za-z0-9][A-Za-z0-9./_-]*)\]/);
    if (!mpnMatch) continue;
    const disti = detailCell.match(/DISTI\s*#([A-Za-z0-9-]+)/i)?.[1] ?? "";
    const manufacturer = cells[2]?.replace(/<br[^>]*/g, " ").trim() ?? "";
    const description = cells[3]?.replace(/<br[^>]*/g, " ").replace(/Min Qty:\d+/i, "").trim() ?? "";
    // 库存: 第一格纯数字(可带 <br>容器)
    const stockNum = cells[4]?.match(/^\s*(\d[\d,]*)/)?.[1];
    const stock = stockNum != null ? Number(stockNum.replace(/,/g, "")) : null;
    const container = cells[4]?.split(/<br\s*\/?>/i)[1]?.trim() ?? "";
    // 价格阶梯: "- <br> QTY ... $P" 序列
    const breaks: FindchipsPriceBreak[] = [];
    const ladder = cells[5] ?? "";
    const re = /\$\s?([\d,]+\.\d{2,4})/g;
    // qty 与 price 成对出现: 先抓所有 数字 与 $价格 的序列
    const tokens = ladder.match(/-\s*<br>\s*(\d[\d,]*)|(?:^|<br>)\s*\$\s?([\d,]+\.\d{2,4})/g) ?? [];
    let pendingQty: number | null = null;
    for (const t of tokens) {
      const q = t.match(/-\s*<br>\s*(\d[\d,]*)/);
      const p = t.match(/\$\s?([\d,]+\.\d{2,4})/);
      if (q && !p) {
        pendingQty = Number(q[1].replace(/,/g, ""));
        continue;
      }
      if (p) {
        const priceUsd = Number(p[1].replace(/,/g, ""));
        const qty = pendingQty ?? 1;
        pendingQty = null;
        if (priceUsd > 0) breaks.push({ qty, priceUsd });
      }
    }
    // 汇总价 "$min / $max"
    const range = (cells[6] ?? "").match(/\$\s?([\d,.]+)\s*\/\s*\$\s?([\d,.]+)/);
    const priceMinUsd = range ? num(range[1]) : (breaks[0]?.priceUsd ?? null);
    const priceMaxUsd = range ? num(range[2]) : (breaks.length ? breaks[breaks.length - 1].priceUsd : null);
    rows.push({
      mpn: mpnMatch[1],
      distiPart: disti,
      manufacturer,
      description,
      stock,
      container,
      breaks: breaks.sort((a, b) => a.qty - b.qty),
      priceMinUsd,
      priceMaxUsd,
      authorized,
      distributor: distributor || "Findchips",
    });
  }
  return rows;
}

/** 只保留精确匹配行并映射为 LiveOffer(currency=USD 显式标注)。 */
export function parseFindchipsOffers(markdown: string, mpn: string): LiveOffer[] {
  const want = normalizeMpn(mpn);
  const rows = parseFindchipsPage(markdown).filter(
    (r) =>
      normalizeMpn(r.mpn) === want &&
      ((r.stock != null && r.stock > 0) || r.breaks.length > 0),
  );
  const seen = new Set<string>();
  const out: LiveOffer[] = [];
  for (const r of rows) {
    const key = `${r.distributor}|${r.distiPart}|${r.stock}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({
      sourceKey: "findchips",
      sourceName: `Findchips·${r.distributor}${r.authorized ? "(授权)" : "(独立)"}`,
      supplier: r.distributor,
      model: r.mpn,
      brand: r.manufacturer,
      batch: "",
      stock: r.stock,
      price: r.breaks[0]?.priceUsd ?? r.priceMinUsd,
      priceBreaks: r.breaks.map((b) => ({ qty: b.qty, price: b.priceUsd })),
      package: r.container,
      warehouse: r.authorized ? "authorized(US)" : "independent(US)",
      note: `USD; DISTI#${r.distiPart}; ${r.description.slice(0, 80)}`,
      date: new Date().toISOString().slice(0, 10),
      url: `https://www.findchips.com/search/${encodeURIComponent(r.mpn)}`,
      currency: "USD",
    });
  }
  // 授权分销优先, 各分销最多一条最优价, 总量截断
  out.sort((a, b) => Number(b.warehouse.startsWith("authorized")) - Number(a.warehouse.startsWith("authorized")));
  return out.slice(0, 20);
}

/** 抓取 + 解析一步到位: 复用注入的 scrapeMarkdown(Firecrawl)。 */
export async function fetchFindchipsOffers(
  mpn: string,
  scrapeMarkdown: (url: string, waitFor?: number) => Promise<string>,
): Promise<{ status: "ok"; offers: LiveOffer[] } | { status: "error"; detail: string }> {
  const url = `https://www.findchips.com/search/${encodeURIComponent(mpn)}`;
  let md = "";
  try {
    md = await scrapeMarkdown(url, 4000);
  } catch (err) {
    return { status: "error", detail: err instanceof Error ? err.message : "findchips fetch failed" };
  }
  if (!md || md.length < 200) {
    return { status: "error", detail: "Findchips 返回内容过短(可能被反爬拦截)" };
  }
  return { status: "ok", offers: parseFindchipsOffers(md, mpn) };
}
