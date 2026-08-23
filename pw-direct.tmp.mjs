import { chromium } from "playwright";
import { readFileSync, writeFileSync } from "node:fs";
const cookieStr = readFileSync("/tmp/icnet-cookie.txt", "utf8").trim();
const ua = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/151.0.0.0 Safari/537.36";
const cookies = cookieStr.split(/;\s*/).filter(Boolean).map((p) => { const i = p.indexOf("="); return { name: p.slice(0, i), value: p.slice(i + 1), domain: ".ic.net.cn", path: "/" }; });
const MPN = process.argv[2] || "STM32F405RGT6";

const browser = await chromium.launch({
  channel: "chrome",
  headless: true,
  args: [
    "--disable-blink-features=AutomationControlled",
    "--no-first-run",
    "--disable-features=IsolateOrigins,site-per-process",
  ],
});
const ctx = await browser.newContext({ userAgent: ua, viewport: { width: 1366, height: 900 } });
await ctx.addInitScript(() => {
  Object.defineProperty(navigator, "webdriver", { get: () => undefined });
  window.chrome = window.chrome || { runtime: {} };
  Object.defineProperty(navigator, "languages", { get: () => ["zh-CN", "zh"] });
  Object.defineProperty(navigator, "plugins", { get: () => [1, 2, 3] });
});
await ctx.addCookies(cookies);
const page = await ctx.newPage();
// 第一步: 首页过环境挑战
await page.goto("https://www.ic.net.cn/", { waitUntil: "domcontentloaded", timeout: 45000 });
await page.waitForTimeout(3000);
console.log("home bytes:", (await page.content()).length);
// 第二步: 同页面导航到搜索结果
await page.goto(`https://www.ic.net.cn/search/${MPN}.html`, { waitUntil: "domcontentloaded", timeout: 45000 }).catch(e => console.log("[nav]", e.message.slice(0, 50)));
for (let i = 0; i < 8; i++) {
  await page.waitForTimeout(2500);
  const c = await page.content().catch(() => "");
  const hits = (c.match(new RegExp(MPN, "gi")) || []).length;
  console.log(`t=${(i + 1) * 2.5}s len=${c.length} hits=${hits} url=${page.url().slice(0, 70)}`);
  if (hits > 0) break;
}
const html = await page.content();
writeFileSync("/tmp/icn-result.html", html);
console.log("final:", html.length, "bytes | url:", page.url().slice(0, 70));
await browser.close();
