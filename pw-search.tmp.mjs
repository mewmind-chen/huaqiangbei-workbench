import { chromium } from "playwright";
import { readFileSync, writeFileSync } from "node:fs";
const cookieStr = readFileSync("/tmp/icnet-cookie.txt", "utf8").trim();
const ua = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/151.0.0.0 Safari/537.36";
const cookies = cookieStr.split(/;\s*/).filter(Boolean).map((p) => { const i = p.indexOf("="); return { name: p.slice(0, i), value: p.slice(i + 1), domain: ".ic.net.cn", path: "/" }; });
const MPN = process.argv[2] || "STM32F405RGT6";

const browser = await chromium.launch({ channel: "chrome", headless: true });
const ctx = await browser.newContext({ userAgent: ua, viewport: { width: 1366, height: 900 } });
await ctx.addCookies(cookies);
const page = await ctx.newPage();
await page.goto("https://www.ic.net.cn/", { waitUntil: "domcontentloaded", timeout: 45000 });
await page.waitForTimeout(2000);
await page.fill("#key", MPN);
const popupPromise = ctx.waitForEvent("page", { timeout: 30000 }).catch(() => null);
await page.click("#btn_topSearch");
let resultPage = await popupPromise;
if (resultPage) {
  console.log("[popup opened]");
  await resultPage.waitForLoadState("domcontentloaded", { timeout: 30000 }).catch(() => {});
  // 轮询等待挑战完成: 直到内容稳定且包含 MPN 或超时
  for (let i = 0; i < 10; i++) {
    await resultPage.waitForTimeout(3000);
    const c = await resultPage.content().catch(() => "");
    const hits = (c.match(new RegExp(MPN, "gi")) || []).length;
    console.log(`  t=${(i + 1) * 3}s len=${c.length} hits=${hits}`);
    if (hits > 0 && i >= 1) break;
  }
} else {
  await page.waitForLoadState("domcontentloaded", { timeout: 30000 }).catch(() => {});
  await page.waitForTimeout(4000);
  resultPage = page;
}
console.log("result url:", resultPage.url().slice(0, 90));
const html = await resultPage.content();
writeFileSync("/tmp/icn-result.html", html);
const hits = (html.match(new RegExp(MPN, "gi")) || []).length;
console.log(`bytes=${html.length} | ${MPN} hits=${hits}`);
for (const kw of ["库存", "批号", "报价", "供应商", "会员"]) console.log(` ${kw}:`, (html.match(new RegExp(kw, "g")) || []).length);
// 导出过挑战后的完整 cookie
const fc = await ctx.cookies(["https://www.ic.net.cn"]);
writeFileSync("/tmp/icn-full-cookie.txt", fc.map((c) => `${c.name}=${c.value}`).join("; "));
console.log("full cookies exported:", flat_len(fc));
function flat_len(c) { return c.join("; ").length; }
await browser.close();
