import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import { extractTodoItems } from "../src/lib/todo-vision.ts";

const cases = [
  {
    name: "CASE1 quote keeps exact MPN",
    response: JSON.stringify({
      items: [
        {
          customer: "客户",
          type: "报价",
          content: "TPS54560DDAR 1000pcs 帮我报价",
          amount: null,
          dueAt: null,
        },
      ],
    }),
    check(items) {
      assert.equal(items.length, 1);
      assert.equal(items[0].type, "报价");
      assert.match(items[0].content, /TPS54560DDAR/);
      assert.equal(items[0].amount, null);
      assert.equal(items[0].dueAt, null);
    },
  },
  {
    name: "CASE3 shipping tomorrow",
    response: JSON.stringify({
      items: [
        {
          customer: "客户",
          type: "发货",
          content: "这单确认了，明天安排发货",
          amount: null,
          dueAt: null,
        },
      ],
    }),
    check(items) {
      assert.equal(items[0].type, "发货");
      assert.equal(items[0].dueAt, null);
    },
  },
  {
    name: "REGRESSION invoice today without invented date",
    response: JSON.stringify({
      items: [
        {
          customer: "客户",
          type: "发票",
          content: "发票麻烦今天开一下",
          amount: null,
          dueAt: null,
        },
      ],
    }),
    check(items) {
      assert.equal(items[0].type, "发票");
      assert.equal(items[0].amount, null);
      assert.equal(items[0].dueAt, null);
    },
  },
  {
    name: "CASE2 independent items stay separate",
    response: JSON.stringify({
      items: [
        { customer: "客户", type: "报价", content: "TPS54560DDAR 1000pcs 报价", amount: null, dueAt: null },
        { customer: "客户", type: "发货", content: "这单确认了，明天安排发货", amount: null, dueAt: null },
      ],
    }),
    check(items) {
      assert.equal(items.length, 2);
      assert.notEqual(items[0].content, items[1].content);
    },
  },
  {
    name: "CASE4 fuzzy image does not invent fields",
    response: JSON.stringify({
      items: [{ customer: "客户", type: "其他", content: "图片内容不清晰", amount: null, dueAt: null }],
    }),
    check(items) {
      assert.equal(items.length, 1);
      assert.equal(items[0].customer, "客户");
      assert.equal(items[0].amount, null);
      assert.equal(items[0].dueAt, null);
    },
  },
  {
    name: "CASE5 empty image returns no_todo_detected",
    response: JSON.stringify({ items: [] }),
    expectError: /no_todo_detected/,
  },
];

for (const fixture of cases) {
  test(fixture.name, () => {
    if (fixture.expectError) {
      assert.throws(() => extractTodoItems(fixture.response), fixture.expectError);
      return;
    }
    fixture.check(extractTodoItems(fixture.response));
  });
}

test("Todo recognition source has no Todo xAI dependency and preserves pending array", () => {
  const recognize = fs.readFileSync(new URL("../src/lib/recognize.ts", import.meta.url), "utf8");
  const panel = fs.readFileSync(new URL("../src/components/workbench/todo-panel.tsx", import.meta.url), "utf8");
  assert.doesNotMatch(recognize, /XAI_API_KEY|api\.x\.ai|grok-4/);
  assert.match(recognize, /deepseek-v4-flash-vision-exp/);
  assert.match(recognize, /items: extractTodoItems/);
  assert.match(panel, /useState<RecognizeDraft\[\]>/);
  assert.match(panel, /逐条确认/);
});
