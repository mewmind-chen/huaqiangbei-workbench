#!/usr/bin/env node
/**
 * hqb-harness-tools — 方案B MCP 薄壳(docs/agent-integration-design.md §3/§7)
 *
 * 职责边界(刻意保持极薄):
 *   - 把 Workbench Agent API(/api/agent/*)暴露为 MCP 工具;
 *   - 不含业务逻辑、不含凭据、不直连数据库 —— 一切经 WORKBENCH_URL HTTP 单点。
 * Workbench dev server 必须在跑(npm run dev, 默认 127.0.0.1:8080)。
 */
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

const BASE = (process.env.WORKBENCH_URL || "http://127.0.0.1:8080").replace(/\/+$/, "");
const API = `${BASE}/api/agent`;
const TOKEN = String(process.env.AGENT_API_TOKEN || "").trim();

async function call(path, body, { timeoutMs = 150_000 } = {}) {
  const headers = { "content-type": "application/json" };
  if (TOKEN) headers.authorization = `Bearer ${TOKEN}`;
  let res;
  try {
    res = await fetch(`${API}/${path}`, {
      method: "POST",
      headers,
      body: JSON.stringify(body ?? {}),
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (err) {
    // 对抗审查 F: 网络拒绝/超时返回结构化结果而非裸抛 —— 让模型能看到原因并改道,
    // 同时注明"服务端可能仍在执行", 避免盲目重试造成双份落库。
    const reason =
      err?.name === "AbortError" || err?.name === "TimeoutError"
        ? "timeout: Workbench 未在时限内响应(服务端可能仍在执行, 重试前先用 task_detail 核对)"
        : `unreachable: ${err?.code || err?.message || "network error"}(Workbench dev server 是否在跑?)`;
    return {
      content: [{ type: "text", text: JSON.stringify({ ok: false, error: reason }, null, 2) }],
      isError: true,
    };
  }
  const text = await res.text();
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    data = { ok: false, error: `non-JSON response (${res.status}): ${text.slice(0, 200)}` };
  }
  // 业务失败(4xx/5xx 或 ok:false)→ isError 内容返回,让模型看到并可改道,
  // 而不是抛异常(S2: 结构化降级优先于硬错误)。
  const degraded = !res.ok || data?.ok === false;
  return {
    content: [
      {
        type: "text",
        text: JSON.stringify(
          degraded ? { ...data, httpStatus: res.status } : data,
          null,
          2,
        ),
      },
    ],
    isError: degraded,
  };
}

const server = new McpServer({ name: "hqb-workbench", version: "0.1.0" });

/* ------------------------------ 任务生命周期 ------------------------------ */

server.tool(
  "task_create",
  "创建一次 AI 研究任务(part_research=型号市场研究 / company_research=公司画像)。返回 taskId,后续所有工具调用都应带上它以便过程与证据可追溯。",
  {
    type: z.enum(["part_research", "company_research"]).default("part_research"),
    mpn: z.string().max(80).optional().describe("型号(类型为 part_research 时)"),
    company: z.string().max(80).optional().describe("公司名(类型为 company_research 时)"),
    goal: z.string().max(300).optional().describe("本次研究要回答的业务问题"),
    holderQty: z.number().nonnegative().optional().describe("手里持有的数量(pcs)"),
    cost: z.number().nonnegative().optional().describe("持有成本(元/pcs)"),
  },
  async ({ type, mpn, company, goal, holderQty, cost }) =>
    call("tasks.create", {
      type,
      input: {
        ...(mpn ? { mpn } : {}),
        ...(company ? { company } : {}),
        goal: goal ?? "",
        ...(holderQty != null ? { holderQty } : {}),
        ...(cost != null ? { cost } : {}),
      },
    }),
);

server.tool(
  "event_append",
  "向任务追加一条过程事件(phase=decision/tool_call/observation/degrade/error)。数据源受限或降级时必须记录 degrade 事件。",
  {
    taskId: z.string(),
    phase: z.enum(["tool_call", "observation", "decision", "error", "degrade"]),
    name: z.string().max(80).optional().describe("事件名,如 market.hqew_search"),
    payload: z.record(z.string(), z.unknown()).optional(),
  },
  async (args) => call("task.events.append", args),
);

server.tool(
  "task_finish",
  "结束任务:done(报告已保存)/ failed / cancelled。",
  { taskId: z.string(), status: z.enum(["done", "failed", "cancelled"]), error: z.string().max(500).optional() },
  async (args) => call("task.finish", args),
);

/* -------------------------------- 市场查询 -------------------------------- */

server.tool(
  "part_research_full",
  "型号市场查询主力工具:依次执行 立创(授权库存/价格/规格) → 华强挂货 → AnySearch 公开线索,自动把每步结果写入证据库(evidence_items)并把市场指标写入快照(market_snapshots)。返回结构化 record(identity/offers/alts/intel)+ dossier 档案 + evidenceIds。耗时约 15-40 秒。",
  {
    query: z.string().min(1).max(80).describe("完整型号,如 TPS54560DDAR"),
    taskId: z.string().optional(),
    steps: z.array(z.enum(["lcsc", "st", "hqew", "intel"])).optional()
      .describe("默认 [lcsc,hqew,intel];ST 原厂页仅对 STM32 系列有意义"),
  },
  async ({ query, taskId, steps }) =>
    call("lookup.full", { query, ...(taskId ? { taskId } : {}), ...(steps ? { steps } : {}) }),
);

server.tool(
  "part_lookup_step",
  "单步补查:agent 自主编排用。step ∈ lcsc/st/hqew/gys(供应商)/shop(商铺库存)/intel(公开线索)。只返回该步结构化结果,不自动落库;需要留证时再调 evidence_save。",
  {
    query: z.string().min(1).max(80),
    step: z.enum(["lcsc", "st", "hqew", "gys", "shop", "intel"]),
    shopUrl: z.string().max(300).optional().describe("step=shop 时的商铺地址"),
    kind: z.enum(["part", "company"]).default("part"),
  },
  async (args) => call("lookup.step", args),
);

server.tool(
  "part_dossier_get",
  "取型号档案:型号池记录 + 最近 5 条市场快照(看趋势)+ 内置贸易知识(STM32/ESP32/W25Q 等系列注意事项)。",
  { mpn: z.string().min(1).max(80) },
  async (args) => call("part.dossier.get", args),
);

server.tool(
  "internal_history_search",
  "查内部商业事实:该型号的历史询价(quote_lines)、型号池记录、历史查询报告。报价决策前必查。",
  { mpn: z.string().min(1).max(80) },
  async (args) => call("internal.history.search", args),
);

/* ------------------------------ 证据 / 快照 / 报告 ------------------------- */

server.tool(
  "evidence_save",
  "显式留存证据:凡是支撑结论的事实(包括你用其他搜索/抓取工具拿到的网页线索)都应写入,report_save 会硬校验引用的证据 id 必须存在。trust 定级:high=原厂/授权渠道,medium=垂直市场(hqew/立创),low=论坛/二手线索。",
  {
    taskId: z.string().optional(),
    mpn: z.string().max(80).optional(),
    items: z
      .array(
        z.object({
          sourceKey: z.enum(["lcsc", "hqew", "st", "intel", "internal", "shop", "gys"]),
          url: z.string().max(500).optional(),
          title: z.string().max(200).optional(),
          capturedAt: z.string().max(40).optional(),
          trust: z.enum(["high", "medium", "low"]).default("medium"),
          fields: z.record(z.string(), z.unknown()).optional(),
        }),
      )
      .min(1)
      .max(60),
  },
  async (args) => call("evidence.save", args),
);

server.tool(
  "snapshot_save",
  "手动补录市场快照指标(通常 part_research_full 已自动写;用于你从别处获得的补充行情)。",
  {
    mpn: z.string().min(1).max(80),
    taskId: z.string().optional(),
    metrics: z.object({
      lcscStock: z.number().int().nonnegative().nullable().optional(),
      lcscMinPrice: z.number().nullable().optional(),
      hqewOfferCount: z.number().int().nonnegative().nullable().optional(),
      hqewSupplierCount: z.number().int().nonnegative().nullable().optional(),
      hqewYunPrice: z.number().nullable().optional(),
      priceMin: z.number().nullable().optional(),
      priceMax: z.number().nullable().optional(),
    }),
    raw: z.record(z.string(), z.unknown()).optional(),
  },
  async (args) => call("snapshot.save", args),
);

server.tool(
  "report_save",
  "保存最终研究报告(入库 research_reports 并被工作台消费)。verdict 结构:{state(热门/缺货/涨价/平稳/未知), score, confidence, claims[]};每个 claim 必须给出 evidenceIds 中对应的证据。硬校验:evidenceIds 引用不存在的证据将返回 422 且不入库。",
  {
    taskId: z.string().optional(),
    query: z.string().min(1).max(120),
    kind: z.enum(["part", "company"]).default("part"),
    verdict: z.record(z.string(), z.unknown()),
    report: z.record(z.string(), z.unknown()),
    evidenceIds: z.array(z.string()).max(200).default([]),
  },
  async (args) => call("report.save", args),
);

server.tool(
  "task_detail",
  "读回一次任务的完整链路:任务状态、过程事件、全部证据、市场快照、报告,以及 evidenceChainValid(报告引用的证据是否全部真实存在)。保存报告前自查、验收核验都用它。",
  { taskId: z.string() },
  async (args) => call("task.detail", args),
);

/* --------------------------------- 启动 ---------------------------------- */

const transport = new StdioServerTransport();
await server.connect(transport);
console.error(`[hqb-harness-tools] ready -> ${API}`);
