/**
 * Presentation mapping for Part / Company intelligence.
 * Does not invent hot / shortage / price / authorization / brand claims.
 */
import { stockText, type MarketCard, type PartAnalysis } from "./analyze.ts";
import type {
  CompanyProfileView,
  IntelligenceOrigin,
  IntelHit,
  PlatformAdvice,
  PlatformDegradation,
  PlatformMarketCards,
  ResearchClaim,
  ResearchEvidenceItem,
  ResearchVerdict,
} from "./result-types.ts";

export type PresentedPartIntelligence = {
  origin: IntelligenceOrigin;
  publicState: string;
  confidence: "high" | "medium" | "low";
  claims: ResearchClaim[];
  cards: MarketCard[];
  evidence: ResearchEvidenceItem[];
  internalAdvice: PlatformAdvice | null;
};

export type PresentedCompanyClaim = ResearchClaim & {
  evidence: ResearchEvidenceItem;
};

export type PresentedCompanyIntelligence = {
  origin: IntelligenceOrigin;
  publicState: string;
  confidence: "high" | "medium" | "low";
  claims: PresentedCompanyClaim[];
  evidence: ResearchEvidenceItem[];
  mainBrands: { brand: string; evidenceId: string; hits?: number }[];
  topMpns: { mpn: string; evidenceId: string; hits?: number }[];
  contacts: never[];
  registeredCapital: null;
  authorization: null;
  extraClaimsFromSnippets: never[];
};

export function isUnknownMarketState(state: string | null | undefined): boolean {
  const value = String(state || "").trim();
  return !value || value === "未知" || value.toLowerCase() === "unknown";
}

/** Snippets are display text. They never become claims. */
export function claimsFromSnippets(_snippet: string | null | undefined): ResearchClaim[] {
  return [];
}

function unknownCards(origin: IntelligenceOrigin, analysis: PartAnalysis | null | undefined): MarketCard[] {
  const supplyDetail =
    analysis != null
      ? `立创现货 ${stockText(analysis.lcscStock)}；华强挂货 ${analysis.offerCount} 条。这是数字对照，不是缺货结论。`
      : "没有可展示的公开库存数字。";
  const fallbackNote = origin === "fallback" ? "降级信息，不是 Platform 智能结论。" : "公开证据不足，不判断热门、缺货或涨价。";
  return [
    {
      key: "hot",
      title: "热门",
      verdict: "未知",
      detail: fallbackNote,
      level: "unknown",
      origin,
    },
    {
      key: "supply",
      title: "货",
      verdict: "未知",
      detail: `${supplyDetail} ${fallbackNote}`,
      level: "unknown",
      origin,
    },
    {
      key: "price",
      title: "价",
      verdict: "未知",
      detail: `不判断涨跌。${fallbackNote}`,
      level: "unknown",
      origin,
    },
  ];
}

function cardLevel(raw: string | undefined): MarketCard["level"] {
  if (raw === "high" || raw === "mid" || raw === "low" || raw === "unknown") return raw;
  return "unknown";
}

function cardsFromPlatform(
  verdict: ResearchVerdict,
  platformCards: PlatformMarketCards | null | undefined,
  claims: ResearchClaim[],
): MarketCard[] {
  const claimText = claims.map((c) => c.text).filter(Boolean).join("；") || `公开市场状态：${verdict.state}`;
  const slice = (
    key: MarketCard["key"],
    fallbackTitle: string,
    data: PlatformMarketCards[keyof PlatformMarketCards],
  ): MarketCard => ({
    key,
    title: data?.title || fallbackTitle,
    verdict: data?.verdict || verdict.state,
    detail: data?.detail || claimText,
    level: cardLevel(data?.level),
    origin: "platform",
  });
  return [
    slice("hot", "热门", platformCards?.hot),
    slice("supply", "货", platformCards?.supply),
    slice("price", "价", platformCards?.price),
  ];
}

export function presentPartIntelligence(input: {
  origin: IntelligenceOrigin;
  analysis?: PartAnalysis | null;
  inquirers?: unknown;
  verdict?: ResearchVerdict | null;
  evidence?: ResearchEvidenceItem[];
  platformCards?: PlatformMarketCards | null;
  advice?: PlatformAdvice | null;
  platformDegradation?: PlatformDegradation | null;
}): PresentedPartIntelligence {
  void input.inquirers;
  const origin = input.origin === "platform" && !input.platformDegradation ? "platform" : "fallback";
  const evidence = input.evidence ?? [];
  const claims = (input.verdict?.claims || []).filter((c) => evidence.some((e) => e.id === c.evidenceId));
  const unknown =
    origin === "fallback" || isUnknownMarketState(input.verdict?.state) || claims.length === 0;
  if (unknown) {
    return {
      origin,
      publicState: "未知",
      confidence: origin === "platform" ? input.verdict?.confidence || "low" : "low",
      claims: [],
      cards: unknownCards(origin, input.analysis),
      evidence: origin === "platform" ? evidence : [],
      internalAdvice: input.advice?.usedInternal ? input.advice : null,
    };
  }
  const verdict = input.verdict!;
  return {
    origin: "platform",
    publicState: verdict.state,
    confidence: verdict.confidence,
    claims,
    cards: cardsFromPlatform(verdict, input.platformCards, claims),
    evidence,
    internalAdvice: input.advice?.usedInternal ? input.advice : null,
  };
}

function evidenceById(items: ResearchEvidenceItem[], id: string): ResearchEvidenceItem | undefined {
  return items.find((e) => e.id === id);
}

export function presentCompanyIntelligence(input: {
  origin: IntelligenceOrigin;
  verdict?: ResearchVerdict | null;
  evidence?: ResearchEvidenceItem[];
  profile?: CompanyProfileView | null;
  intelHits?: IntelHit[];
}): PresentedCompanyIntelligence {
  const origin = input.origin === "platform" ? "platform" : "fallback";
  void input.intelHits;
  const evidence = input.evidence ?? [];
  const unknown = origin === "fallback" || isUnknownMarketState(input.verdict?.state) || evidence.length === 0;
  const claims = unknown
    ? []
    : (input.verdict?.claims || []).flatMap((claim) => {
        const hit = evidenceById(evidence, claim.evidenceId);
        return hit ? [{ ...claim, evidence: hit }] : [];
      });
  const brands = unknown
    ? []
    : (input.profile?.mainBrands || []).filter((row) => evidence.some((e) => e.id === row.evidenceId));
  const mpns = unknown
    ? []
    : (input.profile?.topMpns || []).filter((row) => evidence.some((e) => e.id === row.evidenceId));
  return {
    origin,
    publicState: unknown ? "未知" : input.verdict?.state || "未知",
    confidence: unknown ? "low" : input.verdict?.confidence || "low",
    claims,
    evidence: unknown ? [] : evidence,
    mainBrands: brands,
    topMpns: mpns,
    contacts: [],
    registeredCapital: null,
    authorization: null,
    extraClaimsFromSnippets: [],
  };
}
