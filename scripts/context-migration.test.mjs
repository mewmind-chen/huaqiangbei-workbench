import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { test } from "node:test";
import { PGlite } from "@electric-sql/pglite";

const root = join(import.meta.dirname, "..");

test("normalized MPN migration is executable and supports the provider predicate", async () => {
  const db = new PGlite();
  try {
    await db.exec("create table quote_lines (mpn text not null)");
    await db.exec(await readFile(join(root, "migrations/0007_quote_lines_context_mpn_index.sql"), "utf8"));
    await db.exec("insert into quote_lines (mpn) select chr(65 + (i % 26)) || i::text from generate_series(1, 1000) as i");
    await db.exec("analyze quote_lines; set enable_seqscan = off");
    const plan = await db.query("explain select mpn from quote_lines where upper(trim(mpn)) = $1", ["A26"]);
    const text = plan.rows.map((row) => String(row["QUERY PLAN"])).join("\n");
    assert.match(text, /Index Scan using quote_lines_mpn_normalized_idx/);
  } finally {
    await db.close();
  }
});
