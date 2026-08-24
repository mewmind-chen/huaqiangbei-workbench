import type {
  CompanyProfileView,
  PlatformAdvice,
  PlatformMarketCardSlice,
  PlatformMarketCards,
  PlatformRecommendation,
  ResearchEvidenceItem,
  ResearchVerdict,
} from "./result-types";

function safeText(value: unknown, maxLength: number): string | null {
  if (typeof value !== "string") return null;
  const text = value.trim();
  return text && text.length <= maxLength ? text : null;
}

const CONFIDENCES = new Set(["high", "medium", "low"]);

/**
 * Runtime boundary for optional Platform advice. Unknown fields and malformed
 * values are discarded before UI rendering or report persistence.
 */
export function normalizePlatformAdvice(value: unknown): PlatformAdvice | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const row = value as Record<string, unknown>;
  if (row.usedInternal !== true) return null;
  const action = safeText(row.action, 240);
  const internalView = safeText(row.internalView, 1_500);
  const combined = safeText(row.combined, 2_000);
  if (!action && !internalView && !combined) return null;
  return { action: action ?? "", internalView: internalView ?? "", combined: combined ?? "", usedInternal: true };
}

export function normalizePlatformRecommendation(value: unknown): PlatformRecommendation | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const row = value as Record<string, unknown>;
  const action = safeText(row.action, 240);
  const reasoning = safeText(row.reasoning, 2_000);
  return action || reasoning ? { ...(action ? { action } : {}), ...(reasoning ? { reasoning } : {}) } : null;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

export function normalizePlatformVerdict(value: unknown): ResearchVerdict | null {
  const row = asRecord(value);
  if (!row) return null;
  const state = safeText(row.state, 30);
  const confidence = typeof row.confidence === "string" && CONFIDENCES.has(row.confidence) ? row.confidence : null;
  if (!state || !confidence) return null;
  const claims = Array.isArray(row.claims)
    ? row.claims.flatMap((item) => {
        const claim = asRecord(item);
        const text = claim ? safeText(claim.text, 600) : null;
        const evidenceId = claim ? safeText(claim.evidenceId, 64) : null;
        return text && evidenceId ? [{ text, evidenceId }] : [];
      })
    : [];
  const score = row.score == null ? null : Number(row.score);
  return {
    state,
    confidence: confidence as ResearchVerdict["confidence"],
    score: Number.isFinite(score) ? score : null,
    claims,
  };
}

export function normalizePlatformEvidence(value: unknown): ResearchEvidenceItem[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    const row = asRecord(item);
    if (!row) return [];
    const id = safeText(row.id, 64);
    const sourceKey = safeText(String(row.sourceKey ?? ""), 40);
    if (!id || !sourceKey) return [];
    return [
      {
        id,
        sourceKey,
        title: safeText(row.title, 200) || "",
        url: safeText(row.url, 500) || "",
        trust: typeof row.trust === "string" && CONFIDENCES.has(row.trust) ? row.trust : "medium",
      },
    ];
  });
}

function normalizeCardSlice(value: unknown): PlatformMarketCardSlice | undefined {
  const row = asRecord(value);
  if (!row) return undefined;
  const verdict = safeText(row.verdict, 240);
  const title = safeText(row.title, 40);
  const level = safeText(String(row.level ?? ""), 20);
  const detail = safeText(row.detail, 600);
  if (!verdict && !title && !detail) return undefined;
  return {
    ...(title ? { title } : {}),
    ...(verdict ? { verdict } : {}),
    ...(level ? { level } : {}),
    ...(detail ? { detail } : {}),
  };
}

export function normalizePlatformCards(value: unknown): PlatformMarketCards | null {
  const row = asRecord(value);
  if (!row) return null;
  const hot = normalizeCardSlice(row.hot);
  const supply = normalizeCardSlice(row.supply);
  const price = normalizeCardSlice(row.price);
  if (!hot && !supply && !price) return null;
  return { ...(hot ? { hot } : {}), ...(supply ? { supply } : {}), ...(price ? { price } : {}) };
}

export function normalizeCompanyProfile(value: unknown): CompanyProfileView | null {
  const row = asRecord(value);
  if (!row) return null;
  const mainBrands = Array.isArray(row.mainBrands)
    ? row.mainBrands.flatMap((item) => {
        const brandRow = asRecord(item);
        if (!brandRow) return [];
        const brand = safeText(String(brandRow.brand ?? ""), 80);
        const evidenceId = safeText(brandRow.evidenceId, 64);
        if (!brand || !evidenceId) return [];
        const hits = typeof brandRow.hits === "number" ? brandRow.hits : undefined;
        return [{ brand, evidenceId, ...(hits != null ? { hits } : {}) }];
      })
    : [];
  const topMpns = Array.isArray(row.topMpns)
    ? row.topMpns.flatMap((item) => {
        const mpnRow = asRecord(item);
        if (!mpnRow) return [];
        const mpn = safeText(String(mpnRow.mpn ?? ""), 80);
        const evidenceId = safeText(mpnRow.evidenceId, 64);
        if (!mpn || !evidenceId) return [];
        const hits = typeof mpnRow.hits === "number" ? mpnRow.hits : undefined;
        return [{ mpn, evidenceId, ...(hits != null ? { hits } : {}) }];
      })
    : [];
  const identity = asRecord(row.identity);
  const companyType =
    safeText(String(row.companyType ?? identity?.companyType ?? ""), 40) || undefined;
  if (!mainBrands.length && !topMpns.length && !companyType) return { mainBrands: [], topMpns: [] };
  return { ...(companyType ? { companyType } : {}), mainBrands, topMpns };
}
