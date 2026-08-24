/**
 * Workbench → electronics-agent-platform HTTP client.
 * Official reports are still saved by Workbench itself.
 */
import { createServerFn } from "@tanstack/react-start";
import type { CompanyCard, LcscAlt, ShopRow } from "@/lib/search/md-parse";
import type { IntelBrief, LiveOffer, LookupStepResult, PartIdentity, SourceStatus } from "@/lib/search/result-types";

export const AGENT_API_URL = (process.env.AGENT_API_URL || "http://127.0.0.1:8787").replace(/\/+$/, "");

export type PlatformLookup = {
  kind: "part" | "company";
  identity: PartIdentity | null;
  alts: LcscAlt[];
  offers: LiveOffer[];
  companies: CompanyCard[];
  shopRows: ShopRow[];
  intel: IntelBrief | null;
  steps: SourceStatus[];
  yunPrice: number | null;
};

function stepStatus(r: LookupStepResult | undefined, key: string, name: string): SourceStatus {
  if (!r) return { key, name, url: "", status: "empty", count: 0 };
  if (!r.ok) return { key, name, url: "", status: "error", error: r.error, count: 0 };
  return {
    key,
    name,
    url: r.url || "",
    status: r.status,
    error: r.detail,
    count: r.offers?.length || r.companies?.length || r.shopRows?.length || r.intel?.hits.length || (r.identity ? 1 : 0),
  };
}

async function post(path: string, body: unknown): Promise<Record<string, unknown> | null> {
  const headers: Record<string, string> = { "content-type": "application/json" };
  const token = String(process.env.AGENT_API_TOKEN || "").trim();
  if (token) headers.authorization = `Bearer ${token}`;
  try {
    const res = await fetch(`${AGENT_API_URL}${path}`, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(120_000),
    });
    if (!res.ok) return null;
    return (await res.json()) as Record<string, unknown>;
  } catch {
    return null;
  }
}

export const researchViaPlatform = createServerFn({ method: "POST" })
  .validator((input: { query: string; kind: "part" | "company"; scrapeKey?: string }) => input)
  .handler(async ({ data }): Promise<PlatformLookup | null> => {
    const ctx = { firecrawlKey: data.scrapeKey };
    if (data.kind === "part") {
      const body = await post("/v1/parts/research", { mpn: data.query, steps: ["lcsc", "st", "hqew", "intel", "findchips", "icnet"], mode: "auto", ...ctx });
      if (!body || body.ok === false) return null;
      const steps = Array.isArray(body.steps) ? (body.steps as LookupStepResult[]) : [];
      const names: Record<string, string> = {
        lcsc: "立创商品页",
        st: "原厂应用",
        hqew: "华强挂货",
        intel: "公开资料",
        findchips: "海外分销",
        icnet: "IC交易网",
      };
      return {
        kind: "part",
        identity: (body.identity as PartIdentity) || null,
        alts: ((body.dossier as { replacements?: LcscAlt[] } | undefined)?.replacements ?? []) as LcscAlt[],
        offers: (body.offers as LiveOffer[]) || [],
        companies: [],
        shopRows: [],
        intel: null,
        yunPrice: null,
        steps: ["lcsc", "st", "hqew", "intel", "findchips", "icnet"].map((key) =>
          stepStatus(
            steps.find((s) => s.ok && s.step === key) || steps.find((s) => !s.ok && s.step === key),
            key,
            names[key] || key,
          ),
        ),
      };
    }
    const body = await post("/v1/companies/research", { company: data.query, steps: ["gys", "shop", "intel"], mode: "auto", ...ctx });
    if (!body || body.ok === false) return null;
    return {
      kind: "company",
      identity: null,
      alts: [],
      offers: [],
      companies: (body.companies as CompanyCard[]) || [],
      shopRows: (body.shopRows as ShopRow[]) || [],
      intel: null,
      yunPrice: null,
      steps: [
        { key: "gys", name: "华强供应商", url: "", status: (body.companies as unknown[])?.length ? "ok" : "empty", count: (body.companies as unknown[])?.length || 0 },
        { key: "shop", name: "商铺库存", url: "", status: (body.shopRows as unknown[])?.length ? "ok" : "empty", count: (body.shopRows as unknown[])?.length || 0 },
        { key: "intel", name: "公开资料", url: "", status: "empty", count: 0 },
      ],
    };
  });
