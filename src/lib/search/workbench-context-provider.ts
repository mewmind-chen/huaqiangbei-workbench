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
  updatedAt: string;
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
    const updatedAt = new Date(row.updatedAt).getTime();
    if (Number.isFinite(updatedAt) && updatedAt > latest) {
      latest = updatedAt;
      lastQuotedAt = new Date(updatedAt).toISOString();
    }
    if (Number.isFinite(updatedAt) && updatedAt >= cutoff) recentCount += 1;
    if (row.status === "已完成") continue;
    openCount += 1;
  }

  return { source: "workbench", openCount, recentCount, lastQuotedAt };
}
