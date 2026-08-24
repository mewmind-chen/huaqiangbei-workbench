import test from "node:test";
import assert from "node:assert/strict";
import { normalizePlatformAdvice, normalizePlatformRecommendation } from "./platform-contract.ts";

test("malformed platform advice is rejected before persistence", () => {
  assert.equal(normalizePlatformAdvice(null), null);
  assert.equal(normalizePlatformAdvice({ usedInternal: false, action: "write" }), null);
  assert.equal(normalizePlatformAdvice({ usedInternal: true, action: 42 }), null);
  assert.equal(normalizePlatformAdvice({ usedInternal: true, action: "x".repeat(241) }), null);
});

test("platform advice retains only the documented bounded fields", () => {
  assert.deepEqual(
    normalizePlatformAdvice({
      usedInternal: true,
      action: " 人工复核 ",
      internalView: "库存快照",
      combined: "公开证据与内部事实分开",
      customer: "must be dropped",
      sql: "must be dropped",
    }),
    {
      usedInternal: true,
      action: "人工复核",
      internalView: "库存快照",
      combined: "公开证据与内部事实分开",
    },
  );
  assert.deepEqual(normalizePlatformRecommendation({ action: " 复核 ", reasoning: " 等待证据 ", extra: true }), {
    action: "复核",
    reasoning: "等待证据",
  });
  assert.equal(normalizePlatformRecommendation({ reasoning: "x".repeat(2_001) }), null);
});
