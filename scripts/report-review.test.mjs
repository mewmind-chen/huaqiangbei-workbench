import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const root = join(import.meta.dirname, "..");

test("Workbench report review persists accept/reject/correct locally with corrected_json", () => {
  const migration8 = readFileSync(join(root, "migrations/0008_report_review.sql"), "utf8");
  const migration9 = readFileSync(join(root, "migrations/0009_report_review_correction.sql"), "utf8");
  const server = readFileSync(join(root, "src/lib/data/desk.server.ts"), "utf8");
  const desk = readFileSync(join(root, "src/lib/data/desk.ts"), "utf8");
  const ui = readFileSync(join(root, "src/components/workbench/lookup-report.tsx"), "utf8");
  const client = readFileSync(join(root, "src/lib/search/agent-platform.ts"), "utf8");

  assert.match(migration8, /add column if not exists decision text/);
  assert.match(migration8, /review_note/);
  assert.match(migration9, /corrected_json/);
  assert.match(server, /set decision = \$2, reviewed_at = \$3, review_note = \$4, corrected_json = \$5/);
  assert.match(server, /select decision, reviewed_at, review_note, corrected_json/);
  assert.match(desk, /修正需要 correctedJson/);
  assert.match(desk, /correctedJson/);
  assert.match(ui, /submitReportReview/);
  assert.match(ui, /提交修正/);
  assert.match(ui, /修正需要填写修正后的 JSON/);
  assert.match(ui, /correctedJson: decision === "corrected"/);
  assert.doesNotMatch(client, /search_reports|submitReportReview|corrected_json|review_note/);
});

test("Workbench platform degradation keeps local lookup and never writes the review", () => {
  const panel = readFileSync(join(root, "src/components/workbench/search-panel.tsx"), "utf8");
  const report = readFileSync(join(root, "src/components/workbench/lookup-report.tsx"), "utf8");
  const client = readFileSync(join(root, "src/lib/search/agent-platform.ts"), "utf8");
  assert.match(panel, /platformDegradation/);
  assert.match(report, /已使用本地数据/);
  assert.match(client, /平台智能分析暂不可用，已改用本地数据/);
  assert.match(client, /status === 401/);
  assert.match(client, /AbortSignal\.timeout\(120_000\)/);
  const reviewFn = readFileSync(join(root, "src/lib/data/desk.ts"), "utf8");
  const start = reviewFn.indexOf("export const submitReportReview");
  const end = reviewFn.indexOf("export const getReportReview");
  const fn = reviewFn.slice(start, end);
  assert.match(fn, /reviewReportRow/);
  assert.doesNotMatch(fn, /researchViaPlatform|AGENT_API_URL|\/v1\//);
});
