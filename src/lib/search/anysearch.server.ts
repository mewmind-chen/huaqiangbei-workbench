import type { IntelBrief, IntelHit, PartIdentity } from "@/lib/search/result-types";

export type { IntelBrief, IntelHit };

type SearchItem = {
  query: string;
  tag?: string;
  params?: Record<string, string>;
  zone?: string;
  language?: string;
  max_results?: number;
};

function getAnysearchKey(): string {
  return String(process.env.ANYSEARCH_API_KEY || "").trim();
}

async function anysearchRequest(path: string, method: "GET" | "POST", body?: unknown, params?: string): Promise<unknown> {
  const url = `https://api.anysearch.com${path}${params ? `?${params}` : ""}`;
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    "X-Anysearch-Client": "workbench/1.0",
  };
  const key = getAnysearchKey();
  if (key) headers.Authorization = `Bearer ${key}`;
  const res = await fetch(url, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(20_000),
  });
  if (!res.ok) throw new Error(`公开资料失败（${res.status}）`);
  const json = (await res.json()) as { code?: number; message?: string; data?: unknown };
  if (json.code !== undefined && json.code !== 0) throw new Error(json.message || "公开资料失败");
  return json.data;
}

async function searchOnce(item: SearchItem): Promise<IntelHit[]> {
  const data = (await anysearchRequest("/v1/search", "POST", item)) as {
    results?: { title?: string; url?: string; content?: string; snippet?: string }[];
  };
  return (data.results || [])
    .map((r) => ({
      title: String(r.title || "").trim(),
      url: String(r.url || "").trim(),
      snippet: String(r.content || r.snippet || "")
        .replace(/\s+/g, " ")
        .trim()
        .slice(0, 280),
    }))
    .filter((h) => h.title || h.snippet);
}

function uniqHits(hits: IntelHit[]): IntelHit[] {
  const seen = new Set<string>();
  const out: IntelHit[] = [];
  for (const h of hits) {
    const key = (h.url || h.title).toLowerCase();
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(h);
    if (out.length >= 8) break;
  }
  return out;
}

function briefFromHits(query: string, hits: IntelHit[]): IntelBrief {
  const q = query.toUpperCase();
  const ranked = [...hits].sort((a, b) => {
    const score = (h: IntelHit) => {
      const t = `${h.title} ${h.url} ${h.snippet}`.toLowerCase();
      let n = 0;
      if (h.title.toUpperCase().includes(q) || h.snippet.toUpperCase().includes(q)) n += 2;
      if (/st\.com|ti\.com|datasheet|规格书|数据手册/.test(t)) n += 3;
      if (/szlcsc|hqew\.com/.test(t)) n += 2;
      if (/应用|application|pinout|引脚/.test(t)) n += 1;
      if (/工商|股东|成立|供应商/.test(t)) n += 2;
      return n;
    };
    return score(b) - score(a);
  });
  const summary =
    ranked.find((h) => h.snippet.length > 40)?.snippet ||
    ranked[0]?.snippet ||
    ranked[0]?.title ||
    "";
  const notes = ranked
    .map((h) => h.snippet)
    .filter((s) => s.length > 24)
    .filter((s, i, arr) => arr.findIndex((x) => x.slice(0, 40) === s.slice(0, 40)) === i)
    .slice(0, 6);
  return { summary: summary.slice(0, 280), notes, hits: ranked };
}

export async function fetchIntelBrief(query: string, kind: "part" | "company"): Promise<IntelBrief> {
  const q = query.trim().slice(0, 80);
  const jobs: Promise<IntelHit[]>[] =
    kind === "company"
      ? [
          searchOnce({
            query: `"${q}"`,
            language: "zh-CN",
            zone: "cn",
            max_results: 6,
          }),
          searchOnce({
            query: `"${q}" 官网`,
            language: "zh-CN",
            zone: "cn",
            max_results: 5,
          }),
        ]
      : [
          searchOnce({
            query: `${q} datasheet 规格书`,
            language: "zh-CN",
            zone: "cn",
            max_results: 6,
          }),
          searchOnce({
            query: `${q} 芯片 规格 应用 替代`,
            language: "zh-CN",
            zone: "cn",
            max_results: 6,
          }),
        ];
  const settled = await Promise.allSettled(jobs);
  const compactQ = q.replace(/\s+/g, "");
  const hits = uniqHits(
    settled.flatMap((s) => (s.status === "fulfilled" ? s.value : [])),
  ).filter((h) => {
    const blob = `${h.title} ${h.snippet} ${h.url}`.replace(/\s+/g, "");
    return kind === "company" ? blob.includes(compactQ) : blob.toUpperCase().includes(compactQ.toUpperCase());
  });
  if (!hits.length) throw new Error("没有公开资料");
  return briefFromHits(q, hits);
}

export function identityPatchFromIntel(query: string, brief: IntelBrief): PartIdentity {
  const stUrl = brief.hits.find((h) => /st\.com/i.test(h.url))?.url || "";
  return {
    mpn: query,
    brand: "",
    category: "",
    package: "",
    desc: "",
    summary: "",
    features: "",
    lcscCode: "",
    specs: [],
    applications: [],
    longevity: "",
    active: false,
    lcscStock: null,
    priceBreaks: [],
    lcscUrl: "",
    stUrl,
  };
}
