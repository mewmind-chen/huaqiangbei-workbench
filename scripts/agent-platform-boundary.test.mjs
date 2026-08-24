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
  assert.match(src, /context: quotation \? \{ quotation \} : undefined/);
  assert.match(src, /import\("\.\/workbench-context-provider\.server"\)/);
  assert.doesNotMatch(src, /mode: "agent"/);
  assert.doesNotMatch(src, /insert into/);
  assert.doesNotMatch(src, /getSql/);
  assert.doesNotMatch(src, /from\s+["'][^"']*harness/i);
});

test("platform boundary separates outbound and inbound tokens, and degrades without leaking remote details", () => {
  const client = readFileSync(join(root, "src/lib/search/agent-platform.ts"), "utf8");
  const api = readFileSync(join(root, "src/lib/agent/api.server.ts"), "utf8");
  const plugin = readFileSync(join(root, "scripts/agent-api-plugin.mjs"), "utf8");
  const middleware = readFileSync(join(root, "server/middleware/agent-api.ts"), "utf8");
  const cron = readFileSync(join(root, "scripts/snapshot-cron.mjs"), "utf8");
  const harness = readFileSync(join(root, "harness-tools/server.mjs"), "utf8");

  assert.match(client, /ELECTRONICS_AGENT_PLATFORM_TOKEN/);
  assert.doesNotMatch(client, /process\.env\.AGENT_API_TOKEN/);
  for (const src of [api, plugin, middleware, cron, harness]) {
    assert.match(src, /WORKBENCH_AGENT_API_TOKEN/);
    assert.doesNotMatch(src, /process\.env\.AGENT_API_TOKEN/);
  }
  assert.match(client, /AbortSignal\.timeout\(120_000\)/);
  assert.match(client, /status === 401/);
  assert.match(client, /status >= 500/);
  assert.match(client, /平台智能分析暂不可用，已改用本地数据/);
});

test("platform results are normalized before advice can be returned to the UI or report cache", () => {
  const client = readFileSync(join(root, "src/lib/search/agent-platform.ts"), "utf8");
  const contract = readFileSync(join(root, "src/lib/search/platform-contract.ts"), "utf8");
  const panel = readFileSync(join(root, "src/components/workbench/search-panel.tsx"), "utf8");
  const report = readFileSync(join(root, "src/components/workbench/lookup-report.tsx"), "utf8");

  assert.match(contract, /function normalizePlatformAdvice/);
  assert.match(contract, /function normalizePlatformRecommendation/);
  assert.match(client, /normalizePlatformAdvice\(body\.advice\)/);
  assert.match(client, /normalizePlatformRecommendation\(body\.recommendation\)/);
  assert.match(panel, /platformDegradation/);
  assert.match(report, /platformDegradation/);
  assert.match(report, /已使用本地数据/);
});

test("quotation context failures do not block the outbound platform request", () => {
  const src = readFileSync(join(root, "src/lib/search/agent-platform.ts"), "utf8");
  assert.match(src, /try\s*\{[\s\S]*quotation = await getWorkbenchQuotationContext/);
  assert.match(src, /context: quotation \? \{ quotation \} : undefined/);
  assert.match(src, /catch\s*\{\s*quotation = null/);
});

test("Workbench context provider performs an exact, parameterized, aggregate-only read", () => {
  const src = readFileSync(join(root, "src/lib/search/workbench-context-provider.server.ts"), "utf8");
  assert.match(src, /where upper\(trim\(mpn\)\) = \$1/i);
  assert.match(src, /\[normalized\]/);
  assert.match(src, /select mpn, status, updated_at/i);
  assert.doesNotMatch(src, /customer|content|amount|price|insert into|update quote_lines|delete from/i);
});
