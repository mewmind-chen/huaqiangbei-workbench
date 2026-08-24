/**
 * The only business data sent to the Agent Platform for a part lookup.
 * Quote rows are aggregated locally; customer names, content, IDs and price
 * details never cross this boundary.
 */
export type QuotationContext = {
  source: "workbench";
  openCount: number;
  recentCount: number;
  lastQuotedAt: string;
};

export type QuotationContextRow = {
  mpn: string;
  status: string;
  /** Inquiry creation time; status edits do not create new demand. */
  createdAt: string;
};

export function normalizeMpn(value: string): string {
  return value.normalize("NFKC").trim().toUpperCase();
}

export function buildQuotationContext(
  mpn: string,
  rows: QuotationContextRow[],
  now = new Date(),
): QuotationContext {
  const normalized = normalizeMpn(mpn);
  const cutoff = now.getTime() - 90 * 24 * 60 * 60 * 1000;
  let openCount = 0;
  let recentCount = 0;
  let lastQuotedAt = "";
  let latest = Number.NEGATIVE_INFINITY;

  for (const row of rows) {
    if (normalizeMpn(row.mpn) !== normalized) continue;
    const createdAt = new Date(row.createdAt).getTime();
    if (Number.isFinite(createdAt) && createdAt > latest) {
      latest = createdAt;
      lastQuotedAt = new Date(createdAt).toISOString();
    }
    if (Number.isFinite(createdAt) && createdAt >= cutoff) recentCount += 1;
    if (row.status === "已完成") continue;
    openCount += 1;
  }

  // recentCount and lastQuotedAt are demand timing (created_at), not workflow
  // activity (updated_at), so later status edits cannot manufacture heat.
  return { source: "workbench", openCount, recentCount, lastQuotedAt };
}
