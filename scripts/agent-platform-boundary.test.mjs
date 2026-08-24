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

test("platform client posts to /v1/parts and /v1/companies, not Workbench SQL", () => {
  const src = readFileSync(join(root, "src/lib/search/agent-platform.ts"), "utf8");
  assert.match(src, /\/v1\/parts\/research/);
  assert.match(src, /\/v1\/companies\/research/);
  assert.match(src, /mode: "auto"/);
  assert.doesNotMatch(src, /mode: "agent"/);
  assert.doesNotMatch(src, /insert into/);
  assert.doesNotMatch(src, /getSql/);
});
