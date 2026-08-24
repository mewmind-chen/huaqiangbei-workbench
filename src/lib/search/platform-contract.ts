import type { PlatformAdvice, PlatformRecommendation } from "./result-types";

function safeText(value: unknown, maxLength: number): string | null {
  if (typeof value !== "string") return null;
  const text = value.trim();
  return text && text.length <= maxLength ? text : null;
}

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
