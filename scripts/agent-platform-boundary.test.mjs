import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const root = join(import.meta.dirname, "..");

test("Workbench research UI tries Agent API before local lookup", () => {
  const panel = readFileSync(join(root, "src/components/workbench/search-panel.tsx"), "utf8");
  assert.match(panel, /researchViaPlatform/);
  assert.match(panel, /lookupStep/);
});

test("platform client injects local context into parts research without SQL or Harness types", () => {
  const src = readFileSync(join(root, "src/lib/search/agent-platform.ts"), "utf8");
  assert.match(src, /\/v1\/parts\/research/);
  assert.match(src, /\/v1\/companies\/research/);
  assert.match(src, /mode: "auto"/);
  assert.match(src, /context: \{ quotation \}/);
  assert.match(src, /import\("\.\/workbench-context-provider\.server"\)/);
  assert.doesNotMatch(src, /mode: "agent"/);
  assert.doesNotMatch(src, /insert into/);
  assert.doesNotMatch(src, /getSql/);
  assert.doesNotMatch(src, /from\s+["'][^"']*harness/i);
});

test("Workbench context provider performs an exact, parameterized, aggregate-only read", () => {
  const src = readFileSync(join(root, "src/lib/search/workbench-context-provider.server.ts"), "utf8");
  assert.match(src, /where upper\(trim\(mpn\)\) = \$1/i);
  assert.match(src, /\[normalized\]/);
  assert.match(src, /select mpn, status, updated_at/i);
  assert.doesNotMatch(src, /customer|content|amount|price|insert into|update quote_lines|delete from/i);
});
