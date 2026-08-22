#!/usr/bin/env node
/**
 * golden-check — 黄金样本回归(数据准确性保险 #3)。
 *
 * 用人工核对过的基准值对照真实抓取结果, 防止"解析器改版漂移"静默破坏数据。
 * 用法:
 *   node scripts/golden-check.mjs            # 全部样本, 真实抓取(消耗 Firecrawl 配额)
 *   node scripts/golden-check.mjs --mpn=NE555P  # 只测一个型号
 * 断言失败 exit 1 —— 适合挂在 CI / 解析器改动后手动执行。
 */
import { readFileSync } from "node:fs";

const BASE = (process.env.WORKBENCH_URL || "http://127.0.0.1:8080").replace(/\/+$/, "");
const args = Object.fromEntries(
  process.argv.slice(2).map((a) => {
    const m = a.match(/^--([^=]+)(?:=(.*))?$/);
    return m ? [m[1], m[2] ?? true] : [a, true];
  }),
);
const only = args.mpn ? String(args.mpn).toUpperCase() : null;

const conf = JSON.parse(readFileSync(new URL("./golden-samples.json", import.meta.url), "utf8"));
// 按型号分组: 一个 mpn 只抓一次(lcsc+hqew+findchips 三步), 对照全部该型样本
const byMpn = new Map();
for (const s of conf.samples) {
  if (!byMpn.has(s.mpn)) byMpn.set(s.mpn, []);
  byMpn.get(s.mpn).push(s);
}

async function api(path, body) {
  const res = await fetch(`${BASE}/api/agent/${path}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body ?? {}),
    signal: AbortSignal.timeout(150_000),
  });
  return res.json();
}

function inRange(v, [lo, hi]) {
  return typeof v === "number" && v >= lo && v <= hi;
}

let failures = 0;
for (const [mpn, samples] of byMpn) {
  if (only && mpn !== only) continue;
  console.log(`\n▶ ${mpn}`);
  const r = await api("lookup.full", { query: mpn, steps: ["lcsc", "hqew", "findchips"] });
  if (!r.ok) {
    console.log("  ✗ lookup 失败:", String(r.error).slice(0, 100));
    failures += 1;
    continue;
  }
  const offers = r.record?.offers ?? [];
  const parseHealth = r.parseHealth ?? {};
  for (const s of samples) {
    const gt = s.groundTruth;
    const pool = offers.filter((o) => o.sourceKey === s.source);
    let verdict = "PASS";
    const why = [];
    if (gt.minOffers != null && pool.length < gt.minOffers) {
      verdict = "FAIL";
      why.push(`offers ${pool.length} < ${gt.minOffers}`);
    }
    if (gt.stockBetween) {
      const stock = pool.find((o) => o.stock != null)?.stock;
      if (!inRange(stock, gt.stockBetween)) {
        verdict = "FAIL";
        why.push(`stock ${stock} 不在 ${JSON.stringify(gt.stockBetween)}`);
      }
    }
    if (gt.priceBetween) {
      const price = pool.find((o) => inRange(o.price, gt.priceBetween))?.price;
      if (price == null) {
        verdict = "FAIL";
        why.push(`无价格落在 ${JSON.stringify(gt.priceBetween)}`);
      }
    }
    if (gt.brandContains) {
      const ok = pool.some((o) => (o.brand || "").toUpperCase().includes(gt.brandContains.toUpperCase()));
      if (!ok) {
        verdict = "FAIL";
        why.push(`brand 未含 ${gt.brandContains}`);
      }
    }
    if (gt.authorizedMinCount != null) {
      const authCount = new Set(
        pool.filter((o) => String(o.warehouse || "").startsWith("authorized")).map((o) => o.supplier),
      ).size;
      if (authCount < gt.authorizedMinCount) {
        verdict = "FAIL";
        why.push(`授权分销仅 ${authCount} 家 < ${gt.authorizedMinCount}`);
      }
    }
    if (gt.authorizedDistributors) {
      const names = pool.map((o) => o.supplier.toUpperCase()).join("|");
      const missing = gt.authorizedDistributors.filter((d) => !names.includes(d.toUpperCase()));
      if (missing.length) {
        verdict = "FAIL";
        why.push(`缺少授权分销 ${missing.join(",")}(现有: ${names.slice(0, 60)})`);
      }
    }
    // 健康自检联动: 该源若 degraded 直接 FAIL
    const h = parseHealth[s.source];
    if (h && !h.healthy) {
      verdict = "FAIL";
      why.push(`parse-health degraded: ${(h.issues || []).join(";")}`);
    }
    console.log(`  ${verdict === "PASS" ? "✓" : "✗"} [${s.source}] ${verdict}${why.length ? " — " + why.join("; ") : ""}`);
    if (verdict === "FAIL") failures += 1;
  }
}
console.log(`\n${failures === 0 ? "✅ 全部黄金样本通过" : `❌ ${failures} 项断言失败`}`);
process.exit(failures === 0 ? 0 : 1);
