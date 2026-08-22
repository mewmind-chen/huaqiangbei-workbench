#!/usr/bin/env node
/**
 * snapshot-cron — 主推池型号定时静默采集(方案 §11/§16, S6 可控)。
 *
 * 设计:
 * - 经 Workbench Agent API(/api/agent/lookup.full)采集 —— 复用既有校验/
 *   自动落证据与快照链路, 本脚本不直连数据库;
 * - 默认只跑 lcsc+hqew 两步(intel/st 不跑), 控制抓取配额;
 * - 型号池 = parts 表全部 mpn, 上限 --max(默认 20)/次;
 * - 需显式开启: env SNAPSHOT_CRON_ENABLE=1, 否则 dry-run 只打印计划;
 * - 调度交给外部 cron(launchd/crontab), 本脚本单次运行后退出。
 *   例: crontab 每天 07:30 -> 30 7 * * * cd <项目> && SNAPSHOT_CRON_ENABLE=1 node scripts/snapshot-cron.mjs
 */
const BASE = (process.env.WORKBENCH_URL || "http://127.0.0.1:8080").replace(/\/+$/, "");
const TOKEN = String(process.env.AGENT_API_TOKEN || "").trim();
const ENABLED = process.env.SNAPSHOT_CRON_ENABLE === "1";

const args = Object.fromEntries(
  process.argv.slice(2).map((a) => {
    const m = a.match(/^--([^=]+)(?:=(.*))?$/);
    return m ? [m[1], m[2] ?? true] : [a, true];
  }),
);
const MAX = Math.min(Math.max(Number(args.max ?? 20) || 20, 1), 50); // 钳制 1..50(审查#3)
const STEPS = String(args.steps ?? "lcsc,hqew")
  .split(",")
  .filter((s) => ["lcsc", "hqew"].includes(s));
const GAP_MS = Math.max(Number(args.gapMs ?? 8000) || 8000, 2000); // 下限 2s 保护配额(审查#3)

async function api(path, body) {
  const headers = { "content-type": "application/json" };
  if (TOKEN) headers.authorization = `Bearer ${TOKEN}`;
  const res = await fetch(`${BASE}/api/agent/${path}`, {
    method: "POST",
    headers,
    body: JSON.stringify(body ?? {}),
    signal: AbortSignal.timeout(180_000),
  });
  const text = await res.text();
  try {
    return JSON.parse(text);
  } catch {
    return { ok: false, error: `non-JSON (${res.status})` };
  }
}

async function main() {
  // 健康检查
  const health = await fetch(`${BASE}/api/agent/health`, { signal: AbortSignal.timeout(10_000) }).then((r) => r.json()).catch(() => null);
  if (!health?.ok) {
    console.error("[snapshot-cron] Workbench API 不可达, 退出");
    process.exit(1);
  }
  if (!ENABLED) {
    console.log("[snapshot-cron] DRY-RUN(设置 SNAPSHOT_CRON_ENABLE=1 才真正采集)");
  }

  // 型号池: parts 表(经 internal.history.search 无法列全表, 这里用 dossier 探测不可行,
  // 改为要求显式清单文件或走 parts 全量 —— 通过新增只读端点最干净, v1 用环境内清单文件)
  let mpns = [];
  const listFile = String(args.list ?? "scripts/snapshot-watchlist.json");
  try {
    const raw = JSON.parse((await import("node:fs")).readFileSync(listFile, "utf8"));
    mpns = (Array.isArray(raw) ? raw : raw.mpns ?? []).map((s) => String(s).trim()).filter(Boolean);
  } catch {
    console.error(`[snapshot-cron] 缺少清单 ${listFile}(格式: {"mpns":["NE555P",...]})`);
    process.exit(1);
  }
  const picked = mpns.slice(0, MAX);
  console.log(`[snapshot-cron] 计划采集 ${picked.length}/${mpns.length} 个型号, steps=${STEPS.join("+")}, 间隔 ${GAP_MS}ms`);

  for (const mpn of picked) {
    if (!ENABLED) {
      console.log(`  would-fetch ${mpn}`);
      continue;
    }
    const t0 = Date.now();
    const r = await api("lookup.full", { query: mpn, steps: STEPS });
    const ms = Date.now() - t0;
    if (r.ok) {
      const okSteps = (r.record?.steps ?? []).filter((s) => s.status === "ok").length;
      console.log(`  ${mpn}: ok(${okSteps}源, ev=${r.evidenceIds?.length ?? 0}, snap=${r.snapshotId ?? "-"}) ${ms}ms`);
    } else {
      console.log(`  ${mpn}: FAIL ${String(r.error).slice(0, 80)} ${ms}ms`);
    }
    await new Promise((res) => setTimeout(res, GAP_MS));
  }
  console.log("[snapshot-cron] 完成");
}

main().catch((e) => {
  console.error("[snapshot-cron] fatal:", e.message);
  process.exit(1);
});
