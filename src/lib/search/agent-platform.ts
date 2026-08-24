/**
 * Workbench → electronics-agent-platform HTTP client.
 * Official reports are still saved by Workbench itself.
 */
import { createServerFn } from "@tanstack/react-start";
import type { CompanyCard, LcscAlt, ShopRow } from "@/lib/search/md-parse";
import {
  normalizeCompanyProfile,
  normalizePlatformAdvice,
  normalizePlatformCards,
  normalizePlatformEvidence,
  normalizePlatformRecommendation,
  normalizePlatformVerdict,
} from "@/lib/search/platform-contract";
import type {
  CompanyProfileView,
  IntelBrief,
  IntelligenceOrigin,
  LiveOffer,
  LookupStepResult,
  PartIdentity,
  PlatformAdvice,
  PlatformDegradation,
  PlatformMarketCards,
  PlatformRecommendation,
  ResearchEvidenceItem,
  ResearchVerdict,
  SourceStatus,
} from "@/lib/search/result-types";

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
  advice: PlatformAdvice | null;
  recommendation: PlatformRecommendation | null;
  intelligenceOrigin: IntelligenceOrigin;
  verdict: ResearchVerdict | null;
  evidence: ResearchEvidenceItem[];
  platformCards: PlatformMarketCards | null;
  companyProfile: CompanyProfileView | null;
};

export type PlatformUnavailable = { platformDegradation: PlatformDegradation };
type PlatformResult = PlatformLookup | PlatformUnavailable;
type PostResult = { ok: true; responseBody: Record<string, unknown> } | { ok: false; platformDegradation: PlatformDegradation };

const PLATFORM_DEGRADED_MESSAGE = "平台智能分析暂不可用，已改用本地数据。" as const;

function unavailable(code: PlatformDegradation["code"]): PlatformUnavailable {
  return { platformDegradation: { code, message: PLATFORM_DEGRADED_MESSAGE } };
}

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

async function post(path: string, body: unknown): Promise<PostResult> {
  const headers: Record<string, string> = { "content-type": "application/json" };
  const token = String(process.env.ELECTRONICS_AGENT_PLATFORM_TOKEN || "").trim();
  if (token) headers.authorization = `Bearer ${token}`;
  try {
    const response = await fetch(`${AGENT_API_URL}${path}`, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(120_000),
    });
    if (response.status === 401) return { ok: false, ...unavailable("unauthorized") };
    if (response.status >= 500) return { ok: false, ...unavailable("server_error") };
    if (!response.ok) return { ok: false, ...unavailable("unavailable") };
    const responseBody: unknown = await response.json();
    if (!responseBody || typeof responseBody !== "object" || Array.isArray(responseBody)) return { ok: false, ...unavailable("invalid_response") };
    return { ok: true, responseBody: responseBody as Record<string, unknown> };
  } catch (error) {
    return { ok: false, ...unavailable(error instanceof DOMException && error.name === "TimeoutError" ? "timeout" : "unavailable") };
  }
}

export const researchViaPlatform = createServerFn({ method: "POST" })
  .validator((input: { query: string; kind: "part" | "company"; scrapeKey?: string }) => input)
  .handler(async ({ data }): Promise<PlatformResult> => {
    const ctx = { firecrawlKey: data.scrapeKey };
    if (data.kind === "part") {
      // The provider is server-only and reads Workbench data before this HTTP
      // boundary. The browser client never imports SQL or Harness code.
      let quotation: import("./workbench-context-provider").QuotationContext | null = null;
      try {
        const { getWorkbenchQuotationContext } = await import("./workbench-context-provider.server");
        quotation = await getWorkbenchQuotationContext(data.query);
      } catch {
        quotation = null;
      }
      const response = await post("/v1/parts/research", {
        mpn: data.query,
        steps: ["lcsc", "st", "hqew", "intel", "findchips", "icnet"],
        mode: "auto",
        context: quotation ? { quotation } : undefined,
        ...ctx,
      });
      if (!response.ok) return { platformDegradation: response.platformDegradation };
      const body = response.responseBody;
      if (body.ok === false) return unavailable("unavailable");
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
        advice: normalizePlatformAdvice(body.advice),
        recommendation: normalizePlatformRecommendation(body.recommendation),
        intelligenceOrigin: "platform",
        verdict: normalizePlatformVerdict(body.verdict),
        evidence: normalizePlatformEvidence(body.evidence),
        platformCards: normalizePlatformCards(body.cards),
        companyProfile: null,
        steps: ["lcsc", "st", "hqew", "intel", "findchips", "icnet"].map((key) =>
          stepStatus(
            steps.find((s) => s.ok && s.step === key) || steps.find((s) => !s.ok && s.step === key),
            key,
            names[key] || key,
          ),
        ),
      };
    }
    const response = await post("/v1/companies/research", { company: data.query, steps: ["gys", "shop", "intel"], mode: "auto", ...ctx });
    if (!response.ok) return { platformDegradation: response.platformDegradation };
    const body = response.responseBody;
    if (body.ok === false) return unavailable("unavailable");
    return {
      kind: "company",
      identity: null,
      alts: [],
      offers: [],
      companies: (body.companies as CompanyCard[]) || [],
      shopRows: (body.shopRows as ShopRow[]) || [],
      intel: null,
      yunPrice: null,
      advice: null,
      recommendation: normalizePlatformRecommendation(body.recommendation),
      intelligenceOrigin: "platform",
      verdict: normalizePlatformVerdict(body.verdict),
      evidence: normalizePlatformEvidence(body.evidence),
      platformCards: null,
      companyProfile: normalizeCompanyProfile(body.profile),
      steps: [
        { key: "gys", name: "华强供应商", url: "", status: (body.companies as unknown[])?.length ? "ok" : "empty", count: (body.companies as unknown[])?.length || 0 },
        { key: "shop", name: "商铺库存", url: "", status: (body.shopRows as unknown[])?.length ? "ok" : "empty", count: (body.shopRows as unknown[])?.length || 0 },
        { key: "intel", name: "公开资料", url: "", status: "empty", count: 0 },
      ],
    };
  });
