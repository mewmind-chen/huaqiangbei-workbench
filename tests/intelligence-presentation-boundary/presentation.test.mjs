/**
 * Workbench must not re-infer Part/Company intelligence after Platform
 * already returned verdict / evidence / claims.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { analyzePart } from "../../src/lib/search/analyze.ts";
import {
  claimsFromSnippets,
  presentCompanyIntelligence,
  presentPartIntelligence,
} from "../../src/lib/search/intelligence-presentation.ts";

const root = join(dirname(fileURLToPath(import.meta.url)), "../..");

function fatSupplyAnalysis() {
  const offers = Array.from({ length: 25 }, (_, i) => ({
    sourceKey: "hqew",
    sourceName: "华强挂货",
    supplier: `供应商${i}`,
    model: "TPS54560DDAR",
    brand: "TI",
    batch: "24+",
    stock: 8000,
    price: 1.1,
    package: "SO-8",
    warehouse: "HK",
    note: "",
    date: "",
    url: "",
  }));
  offers.push({
    sourceKey: "lcsc",
    sourceName: "立创商城",
    supplier: "立创商城",
    model: "TPS54560DDAR",
    brand: "TI",
    batch: "",
    stock: 120000,
    price: 1.2,
    package: "SO-8",
    warehouse: "立创自营",
    note: "",
    date: "",
    url: "",
  });
  return analyzePart("TPS54560DDAR", offers, {
    mpn: "TPS54560DDAR",
    brand: "TI",
    category: "电源",
    package: "SO-8",
    desc: "",
    summary: "",
    features: "",
    lcscCode: "C1",
    specs: [],
    applications: [],
    longevity: "",
    active: true,
    lcscStock: 120000,
    priceBreaks: [{ qty: 1, price: 1.2 }],
    lcscUrl: "",
    stUrl: "",
  });
}

const manyInquirers = [
  { id: "1", customer: "A", mpn: "TPS54560DDAR", itemId: null, status: "待报价", content: "", createdAt: "", updatedAt: "" },
  { id: "2", customer: "B", mpn: "TPS54560DDAR", itemId: null, status: "待报价", content: "", createdAt: "", updatedAt: "" },
  { id: "3", customer: "C", mpn: "TPS54560DDAR", itemId: null, status: "待报价", content: "", createdAt: "", updatedAt: "" },
];

test("CASE 1: Platform evidence-backed claim is the only public conclusion", () => {
  const analysis = fatSupplyAnalysis();
  assert.ok(analysis.offerCount >= 20 && analysis.lcscStock >= 50000, "fixture is locally 'hot'");

  const presented = presentPartIntelligence({
    origin: "platform",
    analysis,
    inquirers: manyInquirers,
    verdict: {
      state: "平稳",
      confidence: "medium",
      claims: [{ text: "立创有现货", evidenceId: "evi-1" }],
    },
    evidence: [{ id: "evi-1", sourceKey: "lcsc", title: "立创商品页", url: "https://item.szlcsc.com/1.html", trust: "high" }],
    platformCards: {
      hot: { title: "热门", verdict: "公开交叉后判定平稳", level: "mid" },
      supply: { title: "货", verdict: "立创现货可见", level: "mid" },
      price: { title: "价", verdict: "还不能判断涨跌", level: "unknown" },
    },
  });
  assert.equal(presented.origin, "platform");
  assert.equal(presented.publicState, "平稳");
  assert.ok(presented.claims.some((c) => c.text === "立创有现货"));
  assert.ok(presented.cards.some((c) => c.verdict === "公开交叉后判定平稳"));
  assert.equal(
    presented.cards.some((c) => /挂货商家多|手头在询|常挂/.test(c.verdict)),
    false,
    "must not replace Platform claim with local hotness if/else",
  );
});

test("CASE 2: Platform market.status unknown stays unknown", () => {
  const presented = presentPartIntelligence({
    origin: "platform",
    analysis: fatSupplyAnalysis(),
    inquirers: manyInquirers,
    verdict: { state: "未知", confidence: "low", claims: [] },
    evidence: [],
    platformCards: {
      hot: { title: "热门", verdict: "挂货商家多", level: "high" },
    },
  });
  assert.equal(presented.publicState, "未知");
  assert.equal(presented.claims.length, 0);
  for (const card of presented.cards) {
    assert.equal(card.level, "unknown");
    assert.match(card.verdict, /未知/);
  }
});

test("CASE 3: high inventory / many quotations cannot mint 热门/缺货/涨价", () => {
  const presented = presentPartIntelligence({
    origin: "platform",
    analysis: fatSupplyAnalysis(),
    inquirers: manyInquirers,
    verdict: { state: "未知", confidence: "low", claims: [] },
    evidence: [],
    advice: {
      usedInternal: true,
      action: "有询价要跟",
      internalView: "未完成询价 3 条",
      combined: "公开证据不足；内部仅提示跟询价。",
    },
  });
  const publicText = `${presented.publicState} ${presented.cards.map((c) => c.verdict).join(" ")}`;
  assert.doesNotMatch(publicText, /热门|缺货|涨价/);
  assert.equal(presented.internalAdvice?.usedInternal, true);
  assert.match(presented.internalAdvice?.internalView || "", /询价/);
});

test("CASE 4: Platform unavailable fallback is marked and is not evidence-backed", () => {
  const presented = presentPartIntelligence({
    origin: "fallback",
    analysis: fatSupplyAnalysis(),
    inquirers: manyInquirers,
    platformDegradation: { code: "unavailable", message: "平台智能分析暂不可用，已改用本地数据。" },
  });
  assert.equal(presented.origin, "fallback");
  assert.equal(presented.publicState, "未知");
  assert.ok(presented.cards.every((c) => c.origin === "fallback"));
  assert.ok(presented.cards.some((c) => /降级/.test(c.detail)));
  assert.equal(presented.cards.some((c) => /挂货商家多|偏紧|偏松/.test(c.verdict)), false);
});

test("CASE 5: empty company evidence does not invent contacts / capital / brands / hot mpns", () => {
  const view = presentCompanyIntelligence({
    origin: "platform",
    verdict: { state: "未知", confidence: "low", claims: [] },
    evidence: [],
    profile: { mainBrands: [], topMpns: [] },
    intelHits: [
      {
        title: "About us",
        url: "https://example.test/about",
        snippet: "Authorized distributor of TI, ADI, ST. Contact: 张经理 13800000000. Registered capital 5000万.",
      },
    ],
  });
  assert.equal(view.claims.length, 0);
  assert.equal(view.mainBrands.length, 0);
  assert.equal(view.topMpns.length, 0);
  assert.equal(view.contacts.length, 0);
  assert.equal(view.registeredCapital, null);
  assert.equal(view.authorization, null);
});

test("CASE 6: company evidence is shown with source and confidence", () => {
  const view = presentCompanyIntelligence({
    origin: "platform",
    verdict: {
      state: "画像完成",
      confidence: "medium",
      claims: [{ text: "已汇总商铺库存 12 行", evidenceId: "evi-gys" }],
    },
    evidence: [
      { id: "evi-gys", sourceKey: "gys", title: "华强供应商名片", url: "https://gys.hqew.com/a", trust: "medium" },
    ],
    profile: {
      mainBrands: [{ brand: "TI", evidenceId: "evi-gys", hits: 4 }],
      topMpns: [{ mpn: "TPS54560DDAR", evidenceId: "evi-gys", hits: 3 }],
    },
  });
  assert.equal(view.confidence, "medium");
  assert.equal(view.claims[0].text, "已汇总商铺库存 12 行");
  assert.equal(view.claims[0].evidence.title, "华强供应商名片");
  assert.equal(view.claims[0].evidence.url, "https://gys.hqew.com/a");
  assert.equal(view.mainBrands[0].brand, "TI");
  assert.equal(view.mainBrands[0].evidenceId, "evi-gys");
});

test("orphan Platform claims without evidence stay unknown", () => {
  const presented = presentPartIntelligence({
    origin: "platform",
    analysis: fatSupplyAnalysis(),
    verdict: {
      state: "平稳",
      confidence: "high",
      claims: [{ text: "立创有现货", evidenceId: "missing" }],
    },
    evidence: [],
    platformCards: {
      hot: { title: "热门", verdict: "挂货商家多", level: "high" },
    },
  });
  assert.equal(presented.publicState, "未知");
  assert.equal(presented.claims.length, 0);
  assert.ok(presented.cards.every((c) => c.level === "unknown"));
});

test("CASE 7: strong snippets cannot add claims Platform did not make", () => {
  const snippet =
    "We are an authorized distributor of TI, ADI, ST. Hot runners STM32F103C8T6.";
  assert.deepEqual(claimsFromSnippets(snippet), []);
  const view = presentCompanyIntelligence({
    origin: "platform",
    verdict: { state: "未知", confidence: "low", claims: [] },
    evidence: [],
    intelHits: [{ title: "Distributor", url: "https://example.test", snippet }],
  });
  assert.equal(view.authorization, null);
  assert.equal(view.mainBrands.length, 0);
  assert.equal(view.topMpns.length, 0);
  assert.deepEqual(view.extraClaimsFromSnippets, []);
  const intelPatch = readFileSync(join(root, "src/lib/search/anysearch.server.ts"), "utf8");
  const fn = intelPatch.slice(intelPatch.indexOf("export function identityPatchFromIntel"));
  assert.match(fn, /applications:\s*\[\]/);
  assert.match(fn, /summary:\s*""/);
  assert.doesNotMatch(fn, /应用\|用于\|电机/);
  const dossier = readFileSync(join(root, "src/lib/search/part-dossier.ts"), "utf8");
  assert.doesNotMatch(dossier, /intel\?\.summary/);
  assert.doesNotMatch(dossier, /intelNotes/);
});

test("CASE 8: human corrected_json is not overwritten by research save or sent to Platform", () => {
  const desk = readFileSync(join(root, "src/lib/data/desk.server.ts"), "utf8");
  const upsert = desk.slice(desk.indexOf("export async function upsertReportRow"), desk.indexOf("export async function deleteReportRow"));
  const review = desk.slice(desk.indexOf("export async function reviewReportRow"), desk.indexOf("export type ReportReviewRow"));
  assert.match(review, /corrected_json/);
  assert.doesNotMatch(upsert, /corrected_json|decision|review_note/);
  const client = readFileSync(join(root, "src/lib/search/agent-platform.ts"), "utf8");
  assert.doesNotMatch(client, /corrected_json|submitReportReview|review_note/);
  const deskApi = readFileSync(join(root, "src/lib/data/desk.ts"), "utf8");
  const fn = deskApi.slice(deskApi.indexOf("export const submitReportReview"), deskApi.indexOf("export const getReportReview"));
  assert.doesNotMatch(fn, /researchViaPlatform|AGENT_API_URL|\/v1\//);
});

test("lookup UI presents Platform intelligence instead of local buildMarketCards inference", () => {
  const report = readFileSync(join(root, "src/components/workbench/lookup-report.tsx"), "utf8");
  const client = readFileSync(join(root, "src/lib/search/agent-platform.ts"), "utf8");
  assert.match(report, /presentPartIntelligence/);
  assert.match(report, /presentCompanyIntelligence/);
  assert.match(report, /公司证据/);
  assert.match(report, /搜索片段/);
  assert.match(report, /不是已验证结论/);
  assert.doesNotMatch(report, /buildMarketCards\(\{\s*analysis, identity, inquirers/);
  assert.match(client, /normalizePlatformVerdict|body\.verdict/);
  assert.match(client, /body\.evidence/);
  assert.match(client, /normalizeCompanyProfile\(body\.profile\)/);
});
