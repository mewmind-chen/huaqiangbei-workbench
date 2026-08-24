import assert from "node:assert/strict";
import { test } from "node:test";
import { buildQuotationContext, normalizeMpn } from "./workbench-context-provider.ts";

test("quotation context treats demand heat as new inquiries, not later status edits", () => {
  const context = buildQuotationContext("  stm32Ｆ103c8t6  ", [
    { mpn: "STM32F103C8T6", status: "待报价", createdAt: "2026-08-23T08:00:00.000Z" },
    // A historical inquiry updated today is not a new demand signal.
    { mpn: " stm32f103c8t6 ", status: "已完成", createdAt: "2026-04-01T08:00:00.000Z" },
    { mpn: "STM32F103C8T6", status: "跟进中", createdAt: "2026-08-24T08:00:00.000Z" },
    { mpn: "OTHER", status: "待报价", createdAt: "2026-08-24T08:00:00.000Z" },
  ], new Date("2026-08-24T12:00:00.000Z"));

  assert.equal(normalizeMpn("  stm32Ｆ103c8t6  "), "STM32F103C8T6");
  assert.deepEqual(context, {
    source: "workbench",
    openCount: 2,
    recentCount: 2,
    lastQuotedAt: "2026-08-24T08:00:00.000Z",
  });
  assert.deepEqual(Object.keys(context).sort(), ["lastQuotedAt", "openCount", "recentCount", "source"]);
});

test("quotation context returns zeroes without exposing quote details", () => {
  const context = buildQuotationContext("W25Q64JV", [
    { mpn: "W25Q64JV", status: "已完成", createdAt: "2026-08-24T08:00:00.000Z" },
  ], new Date("2026-08-24T12:00:00.000Z"));

  assert.deepEqual(context, { source: "workbench", openCount: 0, recentCount: 1, lastQuotedAt: "2026-08-24T08:00:00.000Z" });
});
