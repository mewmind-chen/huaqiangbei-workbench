/**
 * Agent API — 方案B(DeepSeek Harness)的业务 Tool 后端。
 *
 * 设计要点(docs/agent-integration-design.md §3/§5):
 * - 纯 handler:(Request) => Promise<Response>,与传输解耦。
 *   dev 由 scripts/agent-api-plugin.mjs 以 Vite 中间件挂载(ssrLoadModule,
 *   与 dev server 共享同一 PGLite 内存实例);生产可后续以 nitro middleware 复用。
 * - 零凭据:Firecrawl/XAI key 仍只在 live-lookup.server 内部解析,这里不碰。
 * - 零侵入:只调用 runLookupStep / buildDossier / getSql,不改任何现有函数。
 * - 无任意 SQL:白名单端点 + zod 校验 + 参数化查询。
 */
import { z } from "zod";
import { getSql } from "@/lib/db";
import { runLookupStep } from "@/lib/search/live-lookup.server";
import { buildDossier, extraKnowledge } from "@/lib/search/part-dossier";
import type { IntelBrief, LiveOffer, LookupRecord, PartIdentity } from "@/lib/search/result-types";

const BASE = "/api/agent/";

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json; charset=utf-8" },
  });
}

function fail(error: string, status = 400): Response {
  return json({ ok: false, error }, status);
}

/** Handler 内的业务失败:抛出后由 router 转换为对应状态码的 JSON 响应。 */
class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

function nowIso(): string {
  return new Date().toISOString();
}

function newId(prefix: string): string {
  const rnd =
    typeof crypto !== "undefined" && "randomUUID" in crypto
      ? crypto.randomUUID().replace(/-/g, "").slice(0, 16)
      : Math.random().toString(36).slice(2, 10);
  return `${prefix}-${rnd}`;
}

/** 可选共享密钥:设置了 AGENT_API_TOKEN 时强制校验(本地闭环可不设)。 */
async function checkAuth(req: Request): Promise<boolean> {
  const expected = String(process.env.AGENT_API_TOKEN || "").trim();
  if (!expected) return true;
  const got = String(req.headers.get("authorization") || "").replace(/^Bearer\s+/i, "").trim();
  return got === expected;
}

/* ------------------------------- zod schemas ------------------------------ */

const TaskCreateInput = z.object({
  type: z.enum(["part_research", "company_research"]).default("part_research"),
  input: z.object({
    mpn: z.string().trim().max(80).optional(),
    company: z.string().trim().max(80).optional(),
    goal: z.string().trim().max(300).default(""),
    holderQty: z.number().finite().nonnegative().optional(),
    cost: z.number().finite().nonnegative().optional(),
  }),
  runner: z.string().trim().max(40).default("dsh"),
});

const TaskFinishInput = z.object({
  taskId: z.string().trim().min(1).max(64),
  status: z.enum(["done", "failed", "cancelled"]),
  error: z.string().trim().max(500).default(""),
});

const EventAppendInput = z.object({
  taskId: z.string().trim().min(1).max(64),
  phase: z.enum(["tool_call", "observation", "decision", "error", "degrade"]),
  name: z.string().trim().max(80).default(""),
  payload: z.record(z.string(), z.unknown()).default({}),
});

const LookupStepInput = z.object({
  query: z.string().trim().min(1).max(80),
  step: z.enum(["lcsc", "st", "hqew", "gys", "shop", "intel", "icnet", "findchips"]),
  shopUrl: z.string().trim().max(300).optional(),
  kind: z.enum(["part", "company"]).default("part"),
});

const LookupFullInput = z.object({
  taskId: z.string().trim().max(64).optional(),
  query: z.string().trim().min(1).max(80),
  steps: z.array(z.enum(["lcsc", "st", "hqew", "intel", "findchips", "icnet"])).min(1).max(6).default(["lcsc", "hqew", "intel"]),
});

const EvidenceItemSchema = z.object({
  sourceKey: z.enum(["lcsc", "hqew", "st", "intel", "internal", "shop", "gys", "icnet", "findchips"]),
  url: z.string().trim().max(500).default(""),
  title: z.string().trim().max(200).default(""),
  capturedAt: z.string().trim().max(40).optional(),
  trust: z.enum(["high", "medium", "low"]).default("medium"),
  fields: z.record(z.string(), z.unknown()).default({}),
});

const EvidenceSaveInput = z.object({
  taskId: z.string().trim().max(64).optional(),
  mpn: z.string().trim().max(80).default(""),
  items: z.array(EvidenceItemSchema).min(1).max(60),
});

const SnapshotSaveInput = z.object({
  mpn: z.string().trim().min(1).max(80),
  taskId: z.string().trim().max(64).optional(),
  metrics: z.object({
    lcscStock: z.number().int().nonnegative().nullable().optional(),
    lcscMinPrice: z.number().finite().nullable().optional(),
    hqewOfferCount: z.number().int().nonnegative().nullable().optional(),
    hqewSupplierCount: z.number().int().nonnegative().nullable().optional(),
    hqewYunPrice: z.number().finite().nullable().optional(),
    priceMin: z.number().finite().nullable().optional(),
    priceMax: z.number().finite().nullable().optional(),
  }),
  raw: z.record(z.string(), z.unknown()).default({}),
});

// 审查#2 必改1: verdict 结构程序级固化 —— state 有界、score 0-100、confidence 三档、
// claims 结构化且每条必须携带 evidenceId(内容真伪由证据引用链保证)。
const ClaimSchema = z.object({
  text: z.string().trim().min(1).max(600),
  evidenceId: z.string().trim().min(1).max(64),
});

const VerdictSchema = z.object({
  state: z.string().trim().min(1).max(30),
  score: z.number().min(0).max(100),
  confidence: z.enum(["high", "medium", "low"]),
  claims: z.array(ClaimSchema).max(50).default([]),
});

const ReportSaveInput = z.object({
  taskId: z.string().trim().max(64).optional(),
  query: z.string().trim().min(1).max(120),
  kind: z.enum(["part", "company"]).default("part"),
  verdict: VerdictSchema,
  report: z.record(z.string(), z.unknown()).default({}),
  evidenceIds: z.array(z.string().trim().min(1).max(64)).max(200).default([]),
});

/* ------------------------------ helpers ---------------------------------- */

type StepOutcome = Awaited<ReturnType<typeof runLookupStep>>;

function offersFrom(outcomes: StepOutcome[]): LiveOffer[] {
  return outcomes.flatMap((o) => (o.ok && o.offers ? o.offers : []));
}

function identityFrom(outcomes: StepOutcome[]): PartIdentity | null {
  let merged: PartIdentity | null = null;
  for (const o of outcomes) {
    if (!o.ok || !o.identity) continue;
    if (!merged) {
      merged = { ...o.identity };
      continue;
    }
    // 后跑的步骤只补空字段,不覆盖已有事实(lcsc 优先级最高,先跑)。
    merged = {
      ...merged,
      brand: merged.brand || o.identity.brand,
      category: merged.category || o.identity.category,
      package: merged.package || o.identity.package,
      desc: merged.desc || o.identity.desc,
      summary: merged.summary || o.identity.summary,
      features: merged.features || o.identity.features,
      applications: merged.applications.length ? merged.applications : o.identity.applications,
      longevity: merged.longevity || o.identity.longevity,
      active: merged.active || o.identity.active,
      lcscStock: merged.lcscStock ?? o.identity.lcscStock,
      priceBreaks: merged.priceBreaks.length ? merged.priceBreaks : o.identity.priceBreaks,
      lcscUrl: merged.lcscUrl || o.identity.lcscUrl,
      stUrl: merged.stUrl || o.identity.stUrl,
      specs: merged.specs.length ? merged.specs : o.identity.specs,
    };
  }
  return merged;
}

/** 从 offers 提取快照指标(数值缺失记 null,不做任何猜测)。 */
function metricsFromOffers(offers: LiveOffer[]) {
  const lcsc = offers.find((o) => o.sourceKey === "lcsc");
  const hqewOffers = offers.filter((o) => o.sourceKey === "hqew");
  const prices = offers.map((o) => o.price).filter((p): p is number => typeof p === "number" && p > 0);
  const suppliers = new Set(hqewOffers.map((o) => o.supplier).filter(Boolean));
  return {
    lcscStock: lcsc?.stock ?? null,
    lcscMinPrice: lcsc?.priceBreaks?.length
      ? Math.min(...lcsc.priceBreaks.map((pb) => pb.price))
      : (lcsc?.price ?? null),
    hqewOfferCount: hqewOffers.length,
    hqewSupplierCount: suppliers.size,
    hqewYunPrice: null as number | null,
    priceMin: prices.length ? Math.min(...prices) : null,
    priceMax: prices.length ? Math.max(...prices) : null,
  };
}

/** ok/empty 步骤 → 证据行(ok 带 url,trust 按来源定级)。 */
function evidenceFromSteps(query: string, outcomes: StepOutcome[]) {
  const trustByStep: Record<string, "high" | "medium" | "low"> = {
    st: "high",
    lcsc: "high",
    findchips: "high",
    hqew: "medium",
    icnet: "medium",
    gys: "medium",
    shop: "medium",
    intel: "low",
  };
  const items: z.infer<typeof EvidenceItemSchema>[] = [];
  for (const o of outcomes) {
    if (!o.ok) continue;
    if (o.step !== "intel" && !("identity" in o) && !("offers" in o) && !("companies" in o)) continue;
    items.push({
      sourceKey: o.step === "intel" ? "intel" : (o.step as "lcsc" | "hqew" | "st" | "gys" | "shop" | "findchips" | "icnet"),
      url: o.url || "",
      title: `${query} @ ${o.step}`,
      capturedAt: nowIso(),
      trust: trustByStep[o.step] ?? "medium",
      fields: {
        status: o.status,
        detail: o.detail ?? "",
        offerCount: o.ok && o.offers ? o.offers.length : 0,
      },
    });
  }
  return items;
}

/* ----------------------------- route handlers ---------------------------- */

async function createTask(data: z.infer<typeof TaskCreateInput>) {
  const sql = await getSql();
  const id = newId("task");
  await sql.query(
    "insert into agent_tasks (id, type, input, status, started_at, runner) values ($1,$2,$3,'running',$4,$5)",
    [id, data.type, JSON.stringify(data.input), nowIso(), data.runner],
  );
  return { ok: true as const, taskId: id };
}

async function finishTask(data: z.infer<typeof TaskFinishInput>) {
  const sql = await getSql();
  const res = await sql.query(
    "update agent_tasks set status=$2, error=$3, finished_at=$4 where id=$1 returning id",
    [data.taskId, data.status, data.error, nowIso()],
  );
  if (!res.length) throw new ApiError(`task not found: ${data.taskId}`, 404);
  return { ok: true as const };
}

async function appendEvent(data: z.infer<typeof EventAppendInput>) {
  const sql = await getSql();
  // 审查 E: 单语句原子取号(select max+insert 两语句在并发下会产生重复 seq)
  const id = newId("ev");
  await sql.query(
    `insert into agent_events (id, task_id, seq, ts, phase, name, payload)
     select $1, $2, coalesce(max(seq),0)+1, $3, $4, $5, $6::jsonb from agent_events where task_id = $2`,
    [id, data.taskId, nowIso(), data.phase, data.name, JSON.stringify(data.payload)],
  );
  const seqRow = await sql.query<{ seq: number }>("select seq from agent_events where id = $1", [id]);
  return { ok: true as const, seq: Number(seqRow[0]?.seq ?? 0) };
}

/** 审查 D-medium: shopUrl 仅允许已知元器件市场域名, 阻断用付费抓取配额代抓任意 URL。 */
const SHOP_ALLOWED_SUFFIXES = ["hqew.com", "szlcsc.com", "lcsc.com", "dzsc.com", "ic.net.cn"];

function shopUrlAllowed(shopUrl: string): boolean {
  if (!shopUrl) return true; // 空值走原有 skipped 路径
  try {
    const host = new URL(shopUrl).hostname.toLowerCase();
    return SHOP_ALLOWED_SUFFIXES.some((s) => host === s || host.endsWith(`.${s}`));
  } catch {
    return false;
  }
}

async function lookupStep(data: z.infer<typeof LookupStepInput>) {
  if (data.step === "shop" && !shopUrlAllowed(data.shopUrl ?? "")) {
    // 结构化降级而非硬错误(S2)
    return {
      ok: true as const,
      result: {
        ok: true,
        step: "shop" as const,
        status: "skipped" as const,
        url: "",
        detail: "商铺地址不在允许的域名列表(hqew/szlcsc/lcsc/dzsc/ic.net.cn)",
      },
    };
  }
  const result = await runLookupStep({
    query: data.query,
    step: data.step,
    shopUrl: data.shopUrl,
    kind: data.kind,
  });
  return { ok: true as const, result }; // LookupStepResult 原样透传(S1)
}

async function lookupFull(data: z.infer<typeof LookupFullInput>) {
  const { assessParseHealth } = await import("@/lib/search/parse-health.server");
  type HealthEntry = ReturnType<typeof assessParseHealth>;
  const outcomes: StepOutcome[] = [];
  const healthByStep = new Map<string, HealthEntry>();
  // 审查 H: 服务端总预算(每步最坏 ~60-80s, 全链可能超客户端 150s 超时)。
  // 超预算即截断并如实标注, 让模型拿到的结果与实际执行一致。
  const startedAt = Date.now();
  const BUDGET_MS = 120_000;
  let truncated = false;
  for (const step of data.steps) {
    if (Date.now() - startedAt > BUDGET_MS) {
      truncated = true;
      break;
    }
    const outcome = await runLookupStep({ query: data.query, step });
    // 数据准确性保险#1: 解析健康体检
    if (outcome.ok && outcome.offers?.length) {
      healthByStep.set(outcome.step, assessParseHealth(outcome.step, outcome.offers));
    }
    outcomes.push(outcome);
  }
  const offers = offersFrom(outcomes);
  const identity = identityFrom(outcomes);
  const alts = outcomes.find((o): o is Extract<StepOutcome, { ok: true }> => Boolean(o.ok && o.alts))?.alts ?? [];
  let intel: IntelBrief | null = null;
  for (const o of outcomes) {
    if (o.ok && o.intel) {
      intel = o.intel;
      break;
    }
  }

  // 自动落库:证据 + 快照(单一出口,保证 M5 可追溯)。
  const autoEvidence = evidenceFromSteps(data.query, outcomes);
  let evidenceIds: string[] = [];
  if (autoEvidence.length) {
    const saved = await saveEvidence({
      taskId: data.taskId,
      mpn: data.query,
      items: autoEvidence,
    });
    if ("evidenceIds" in saved) evidenceIds = saved.evidenceIds;
  }
  let snapshotId: string | null = null;
  // 数据准确性保险#1: 不健康的解析结果不写入市场快照(评分链路)
  const unhealthySteps = [...healthByStep.entries()].filter(([, h]) => !h.healthy).map(([k]) => k);
  const snapshotBlocked = unhealthySteps.length > 0;
  const trustedOffers = snapshotBlocked
    ? offers.filter((o) => healthByStep.get(o.sourceKey)?.healthy !== false)
    : offers;
  const metrics = metricsFromOffers(trustedOffers);
  if (offers.length || identity?.lcscStock != null) {
    const saved = await saveSnapshot({
      mpn: data.query,
      taskId: data.taskId,
      metrics: {
        lcscStock: metrics.lcscStock,
        lcscMinPrice: metrics.lcscMinPrice,
        hqewOfferCount: metrics.hqewOfferCount,
        hqewSupplierCount: metrics.hqewSupplierCount,
        priceMin: metrics.priceMin,
        priceMax: metrics.priceMax,
      },
      raw: { offers: trustedOffers },
    });
    if ("snapshotId" in saved) snapshotId = saved.snapshotId;
  }

  const record: Omit<LookupRecord, "id"> = {
    query: data.query,
    kind: "part",
    createdAt: nowIso(),
    yunPrice: metrics.hqewYunPrice,
    identity,
    alts,
    offers,
    companies: [],
    shopRows: [],
    steps: outcomes.map((o) =>
      o.ok
        ? { key: o.step, name: o.step, url: o.url, status: o.status, count: o.offers?.length ?? 0 }
        : { key: o.step, name: o.step, url: "", status: "error", count: 0, error: o.error },
    ),
    intel,
  };

  return {
    ok: true as const,
    record,
    dossier: identity ? buildDossier(identity, alts, intel) : null,
    extraKnowledge: extraKnowledge(data.query),
    evidenceIds,
    snapshotId,
    parseHealth: Object.fromEntries(healthByStep),
    snapshotDegraded: snapshotBlocked,
    degradedReason: snapshotBlocked
      ? `解析健康检查未通过: ${unhealthySteps.join(",")}(本次数据未写入市场快照)`
      : undefined,
    truncated,
    truncatedSteps: truncated
      ? data.steps.slice(outcomes.length)
      : [],
  };
}

async function dossierGet(input: { mpn: string }) {
  const sql = await getSql();
  const rows = await sql.query<{
    id: string; mpn: string; brand: string; category: string; notes: string; created_at: string;
  }>("select id, mpn, brand, category, notes, created_at from parts where mpn = $1 limit 1", [input.mpn]);
  const pooled = rows[0] ?? null;
  const lastSnapshots = await sql.query(
    "select captured_at, lcsc_stock, lcsc_min_price, hqew_offer_count, hqew_supplier_count from market_snapshots where mpn = $1 order by captured_at desc limit 5",
    [input.mpn],
  );
  return {
    ok: true as const,
    pooledPart: pooled,
    snapshots: lastSnapshots,
    knowledge: extraKnowledge(input.mpn),
  };
}

async function internalHistory(input: { mpn: string }) {
  const sql = await getSql();
  // 审查 A-low: 转义 like 通配符, 防止 "%" 匹配全表
  const pattern = `%${input.mpn.replace(/([%_\\])/g, "\\$1")}%`;
  const quotes = await sql.query(
    "select id, customer, mpn, status, content, created_at, updated_at from quote_lines where mpn ilike $1 escape '\\' order by updated_at desc limit 30",
    [pattern],
  );
  const partsRows = await sql.query(
    "select id, mpn, brand, category, notes, created_at from parts where mpn = $1 order by created_at desc limit 5",
    [input.mpn],
  );
  const reports = await sql.query(
    "select id, query, kind, created_at, summary from search_reports where query ilike $1 escape '\\' order by created_at desc limit 20",
    [pattern],
  );
  return { ok: true as const, quotes, parts: partsRows, reports };
}

async function saveEvidence(data: z.infer<typeof EvidenceSaveInput>) {
  const sql = await getSql();
  const ids: string[] = [];
  for (const item of data.items) {
    const id = newId("evi");
    await sql.query(
      "insert into evidence_items (id, task_id, mpn, source_key, url, title, captured_at, trust, fields) values ($1,$2,$3,$4,$5,$6,$7,$8,$9)",
      [
        id,
        data.taskId ?? null,
        data.mpn,
        item.sourceKey,
        item.url,
        item.title,
        item.capturedAt ?? nowIso(),
        item.trust,
        JSON.stringify(item.fields),
      ],
    );
    ids.push(id);
  }
  return { ok: true as const, evidenceIds: ids };
}

async function saveSnapshot(data: z.infer<typeof SnapshotSaveInput>) {
  const sql = await getSql();
  const id = newId("snap");
  await sql.query(
    `insert into market_snapshots
       (id, mpn, captured_at, task_id, lcsc_stock, lcsc_min_price,
        hqew_offer_count, hqew_supplier_count, hqew_yun_price, price_min, price_max, raw)
     values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
    [
      id,
      data.mpn,
      nowIso(),
      data.taskId ?? null,
      data.metrics.lcscStock ?? null,
      data.metrics.lcscMinPrice ?? null,
      data.metrics.hqewOfferCount ?? null,
      data.metrics.hqewSupplierCount ?? null,
      data.metrics.hqewYunPrice ?? null,
      data.metrics.priceMin ?? null,
      data.metrics.priceMax ?? null,
      JSON.stringify(data.raw),
    ],
  );
  return { ok: true as const, snapshotId: id };
}

/** 读回一次任务的完整链路(任务+事件+证据+快照+报告),供工作台展示与验收核验。 */
async function taskDetail(input: { taskId: string }) {
  const sql = await getSql();
  const task = await sql.query("select * from agent_tasks where id = $1", [input.taskId]);
  if (!task.length) throw new ApiError(`task not found: ${input.taskId}`, 404);
  const events = await sql.query(
    "select id, seq, ts, phase, name, payload from agent_events where task_id = $1 order by seq",
    [input.taskId],
  );
  const evidence = await sql.query(
    "select id, mpn, source_key, url, title, captured_at, trust, fields from evidence_items where task_id = $1 order by captured_at",
    [input.taskId],
  );
  const snapshots = await sql.query(
    "select id, mpn, captured_at, lcsc_stock, lcsc_min_price, hqew_offer_count, hqew_supplier_count, price_min, price_max from market_snapshots where task_id = $1 order by captured_at",
    [input.taskId],
  );
  const reports = await sql.query(
    "select id, query, kind, verdict, report, evidence_ids, created_at from research_reports where task_id = $1 order by created_at",
    [input.taskId],
  );
  return {
    ok: true as const,
    task: task[0],
    events,
    evidence,
    snapshots,
    reports,
    // M5 一键核验: 报告引用的证据是否全部存在
    evidenceChainValid:
      reports.length === 0 ||
      (() => {
        // 审查#2必改2: 双路径扫描 —— 顶层 evidence_ids + verdict.claims[].evidenceId
        const have = new Set(evidence.map((e) => e.id as string));
        return reports.every((r) => {
          const verdict = (r.verdict ?? {}) as { claims?: { evidenceId?: string }[] };
          const claimRefs = (verdict.claims ?? []).map((c) => c.evidenceId ?? "").filter(Boolean);
          const top = Array.isArray(r.evidence_ids) ? (r.evidence_ids as string[]) : [];
          return [...top, ...claimRefs].every((id) => have.has(id));
        });
      })(),
  };
}

/** market.analyze — 程序化评分引擎端点(§11, 根治 R5): 分数由确定性规则计算。 */
async function marketAnalyze(input: { mpn: string; offers?: unknown[] }) {
  const sql = await getSql();
  const snapshots = await sql.query<{
    captured_at: string; lcsc_stock: number | null; lcsc_min_price: number | null;
    hqew_offer_count: number | null; hqew_supplier_count: number | null;
  }>(
    "select captured_at, lcsc_stock, lcsc_min_price, hqew_offer_count, hqew_supplier_count from market_snapshots where mpn = $1 order by captured_at asc limit 60",
    [input.mpn],
  );
  const quotes = await sql.query<{ n: number }>(
    "select count(*) as n from quote_lines where mpn = $1 and created_at >= $2",
    [input.mpn, new Date(Date.now() - 90 * 86_400_000).toISOString()],
  );
  const analysis = await import("@/lib/search/market-analyze.server").then((m) =>
    m.computeMarketAnalysis({
      mpn: input.mpn,
      snapshots: snapshots.map((s) => ({
        capturedAt: s.captured_at,
        lcscStock: s.lcsc_stock == null ? null : Number(s.lcsc_stock),
        lcscMinPrice: s.lcsc_min_price == null ? null : Number(s.lcsc_min_price),
        hqewOfferCount: s.hqew_offer_count == null ? null : Number(s.hqew_offer_count),
        hqewSupplierCount: s.hqew_supplier_count == null ? null : Number(s.hqew_supplier_count),
      })),
      internalQuoteCount: Number(quotes[0]?.n ?? 0),
      currentOffers: (input.offers ?? []) as unknown as import("@/lib/search/market-analyze.server").AnalyzeOffer[],
    }),
  );
  return { ok: true as const, analysis };
}

async function saveReport(data: z.infer<typeof ReportSaveInput>) {
  const sql = await getSql();
  // 硬校验(M5, 审查#2必改1): 顶层 evidenceIds 与 verdict.claims[].evidenceId
  // 全部合并校验存在性; 有结论(state≠未知)时必须至少引用一条真实证据。
  const claimRefs = data.verdict.claims.map((c) => c.evidenceId);
  const allRefs = [...new Set([...data.evidenceIds, ...claimRefs])];
  if (data.verdict.state !== "未知" && allRefs.length === 0) {
    throw new ApiError("non-unknown verdict requires at least one evidence reference", 422);
  }
  if (allRefs.length) {
    const found = await sql.query<{ id: string }>(
      `select id from evidence_items where id = any($1::text[])`,
      [allRefs],
    );
    const have = new Set(found.map((r) => r.id));
    const missing = allRefs.filter((id) => !have.has(id));
    if (missing.length) {
      throw new ApiError(`unknown evidence_ids: ${missing.join(",")}`, 422);
    }
  }
  const id = newId("rep");
  await sql.query(
    "insert into research_reports (id, task_id, query, kind, verdict, report, evidence_ids, created_at) values ($1,$2,$3,$4,$5,$6,$7,$8)",
    [
      id,
      data.taskId ?? null,
      data.query,
      data.kind,
      JSON.stringify(data.verdict),
      JSON.stringify(data.report),
      JSON.stringify(data.evidenceIds),
      nowIso(),
    ],
  );
  return { ok: true as const, reportId: id };
}

/* -------------------------------- router --------------------------------- */

const ROUTES: Record<string, (req: Request) => Promise<Response>> = {};

/** 审查 B-medium: 入参序列化体积上限, 防止巨型 jsonb 撑爆内存库。 */
const MAX_PAYLOAD_BYTES = 512 * 1024;

function route<T>(name: string, schema: z.ZodType<T>, handler: (data: T) => Promise<object>) {
  ROUTES[name] = async (req: Request) => {
    let raw: unknown;
    try {
      raw = await req.json();
    } catch {
      return fail("invalid JSON body");
    }
    const parsed = schema.safeParse(raw);
    if (!parsed.success) {
      return fail(`schema: ${parsed.error.issues.map((i) => `${i.path.join(".")}:${i.message}`).join("; ")}`);
    }
    if (Buffer.byteLength(JSON.stringify(parsed.data), "utf8") > MAX_PAYLOAD_BYTES) {
      return fail(`payload too large (>${MAX_PAYLOAD_BYTES} bytes)`, 413);
    }
    try {
      return json(await handler(parsed.data));
    } catch (err) {
      if (err instanceof ApiError) return fail(err.message, err.status);
      throw err; // 外层统一兜底为 500
    }
  };
}

route("tasks.create", TaskCreateInput, createTask);
route("task.finish", TaskFinishInput, finishTask);
route("task.events.append", EventAppendInput, appendEvent);
route("lookup.step", LookupStepInput, lookupStep);
route("lookup.full", LookupFullInput, lookupFull);
route(
  "part.dossier.get",
  z.object({ mpn: z.string().trim().min(1).max(80) }),
  dossierGet,
);
route(
  "internal.history.search",
  z.object({ mpn: z.string().trim().min(1).max(80) }),
  internalHistory,
);
route("evidence.save", EvidenceSaveInput, saveEvidence);
route("snapshot.save", SnapshotSaveInput, saveSnapshot);
route("report.save", ReportSaveInput, saveReport);
route(
  "market.analyze",
  z.object({
    mpn: z.string().trim().min(1).max(80),
    offers: z
      .array(z.record(z.string(), z.unknown()))
      .max(80)
      .optional()
      .describe("可选: 当前 lookup 返回的 offers(用于现货溢价与多源覆盖)"),
  }),
  marketAnalyze,
);
route(
  "task.detail",
  z.object({ taskId: z.string().trim().min(1).max(64) }),
  taskDetail,
);

export function agentApiRoutes(): string[] {
  return Object.keys(ROUTES);
}

/** 唯一入口:处理 /api/agent/* 请求。非本 API 路径返回 null(交给 next 中间件)。 */
export async function handleAgentApiRequest(req: Request): Promise<Response | null> {
  const url = new URL(req.url);
  if (!url.pathname.startsWith(BASE)) return null;
  const name = url.pathname.slice(BASE.length).replace(/\/+$/, "");

  if (name === "health") {
    return json({ ok: true, service: "hqb-agent-api", routes: Object.keys(ROUTES) });
  }

  if (!(await checkAuth(req))) return fail("unauthorized", 401);

  const handler = ROUTES[name];
  if (!handler) return fail(`unknown route: ${name}`, 404);

  try {
    return await handler(req);
  } catch (err) {
    // 审查 C-low: 内部错误细节(DB 错误可含 SQL 片段)不外泄; ApiError 的业务消息保留
    console.error("[agent-api]", name, err);
    return json({ ok: false, error: "internal error" }, 500);
  }
}
