import { getSql } from "@/lib/db";
import {
  buildQuotationContext,
  normalizeMpn,
  type QuotationContext,
} from "./workbench-context-provider";

/** Reads and aggregates Workbench data locally before an outbound part request. */
export async function getWorkbenchQuotationContext(mpn: string): Promise<QuotationContext> {
  const normalized = normalizeMpn(mpn);
  if (!normalized) return buildQuotationContext("", []);
  const sql = await getSql();
  // Query only the exact normalized subject and the three aggregation inputs.
  // It intentionally reads created_at: context heat counts new inquiries, not
  // workflow edits. The functional index migration uses this exact predicate.
  // TypeScript repeats normalization defensively before aggregation.
  const rows = await sql.query<{ mpn: string; status: string; created_at: string }>(
    "select mpn, status, created_at from quote_lines where upper(trim(mpn)) = $1",
    [normalized],
  );
  return buildQuotationContext(
    mpn,
    rows.map((row) => ({ mpn: row.mpn, status: row.status, createdAt: row.created_at })),
  );
}
