#!/usr/bin/env node
/**
 * icnet-setup — IC交易网会员登录态一键配置+验证(方案 §12 登录会话 Tool)。
 *
 * 用法:
 *   node scripts/icnet-setup.mjs "复制来的Cookie字符串"
 *   node scripts/icnet-setup.mjs --check        # 只验证已配置的 cookie
 *   node scripts/icnet-setup.mjs --clear        # 清除已配置的 cookie
 *
 * 它做三件事:
 *   1. 把 cookie 写入 fetcher-config.json 的 icnetCookie 字段(该文件在 .gitignore);
 *   2. 用一个真实型号(默认 NE555P)经 /api/agent/lookup.step?step=icnet 实测;
 *   3. 报告: 数据页(成功)/ 登录页(cookie 无效或过期)/ 服务不可达。
 *
 * Cookie 获取: Chrome 登录 ic.net.cn → F12 → Network → 任选 ic.net.cn 请求 →
 * Request Headers → 复制整行 Cookie 值。
 */
import { readFileSync, writeFileSync } from "node:fs";

const BASE = (process.env.WORKBENCH_URL || "http://127.0.0.1:8080").replace(/\/+$/, "");
const CONFIG = "fetcher-config.json";
const PROBE_MPN = process.argv[3] || "NE555P";

function readConfig() {
  try {
    return JSON.parse(readFileSync(CONFIG, "utf8"));
  } catch {
    return {};
  }
}

function writeCookie(cookie) {
  const conf = readConfig();
  conf.icnetCookie = cookie;
  writeFileSync(CONFIG, JSON.stringify(conf, null, 2) + "\n");
}

async function verify() {
  const res = await fetch(`${BASE}/api/agent/lookup.step`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ query: PROBE_MPN, step: "icnet" }),
    signal: AbortSignal.timeout(90_000),
  }).catch((e) => null);
  if (!res) return { verdict: "unreachable", detail: "Workbench dev server 不可达(先 npm run dev)" };
  const body = await res.json().catch(() => ({}));
  const r = body?.result ?? {};
  if (r.status === "ok") return { verdict: "ok", detail: `解析到 ${r.offers?.length ?? 0} 条挂货行` };
  if (r.status === "empty") return { verdict: "ok-empty", detail: "登录态有效, 但该型号当前无挂货行(可换型号再试)" };
  if (r.status === "skipped") return { verdict: "invalid", detail: r.detail ?? "仍被登录墙拦截" };
  return { verdict: "error", detail: r.error ?? body?.error ?? "unknown" };
}

const arg = process.argv[2];
if (arg === "--clear") {
  const conf = readConfig();
  delete conf.icnetCookie;
  writeFileSync(CONFIG, JSON.stringify(conf, null, 2) + "\n");
  console.log("✅ 已清除 icnetCookie");
  process.exit(0);
}
if (arg === "--check") {
  const has = Boolean(readConfig().icnetCookie);
  console.log(has ? "cookie 已配置, 开始验证…" : "❌ 尚未配置 cookie(先运行 node scripts/icnet-setup.mjs \"<cookie>\")");
  if (!has) process.exit(1);
} else if (arg && arg.startsWith("--")) {
  console.log("用法: node scripts/icnet-setup.mjs \"<cookie>\" | --check | --clear");
  process.exit(1);
} else if (arg) {
  const cookie = arg.trim();
  if (cookie.length < 20) {
    console.error("❌ cookie 看起来太短, 请确认复制的是完整的 Cookie 请求头值");
    process.exit(1);
  }
  writeCookie(cookie);
  console.log(`✅ 已写入 ${CONFIG}.icnetCookie(${cookie.length} 字符, 文件在 .gitignore 中)`);
}

const v = await verify();
if (v.verdict === "ok") console.log(`🎉 验证通过: ${v.detail} —— IC交易网源已点亮`);
else if (v.verdict === "ok-empty") console.log(`🟡 ${v.detail}`);
else {
  console.log(`❌ 验证未通过: ${v.detail}`);
  console.log("   排查: ① cookie 是否完整(整行 Cookie 头) ② 是否刚在浏览器重新登录过 ③ dev server 是否在跑");
  process.exit(1);
}
