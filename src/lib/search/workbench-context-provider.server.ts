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
  // TypeScript repeats normalization defensively before aggregation.
  const rows = await sql.query<{ mpn: string; status: string; updated_at: string }>(
    "select mpn, status, updated_at from quote_lines where upper(trim(mpn)) = $1",
    [normalized],
  );
  return buildQuotationContext(
    mpn,
    rows.map((row) => ({ mpn: row.mpn, status: row.status, updatedAt: row.updated_at })),
  );
}
