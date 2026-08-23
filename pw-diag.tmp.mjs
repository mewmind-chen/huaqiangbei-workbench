import { chromium } from "playwright";
import { readFileSync, writeFileSync } from "node:fs";
const cookieStr = readFileSync("/tmp/icnet-cookie.txt", "utf8").trim();
const ua = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/151.0.0.0 Safari/537.36";
const cookies = cookieStr.split(/;\s*/).filter(Boolean).map((p) => { const i = p.indexOf("="); return { name: p.slice(0, i), value: p.slice(i + 1), domain: ".ic.net.cn", path: "/" }; });
const browser = await chromium.launch({ channel: "chrome", headless: true });
const ctx = await browser.newContext({ userAgent: ua });
await ctx.addCookies(cookies);
const page = await ctx.newPage();
page.on("response", (r) => console.log("[resp]", r.status(), r.url().slice(0, 80)));
page.on("requestfailed", (r) => console.log("[fail]", r.url().slice(0, 80), r.failure()?.errorText));
await page.goto("https://www.ic.net.cn/search/STM32F405RGT6.html", { waitUntil: "commit", timeout: 60000 }).catch(e => console.log("[goto]", e.message.slice(0,60)));
for (let i = 0; i < 4; i++) { await page.waitForTimeout(3000); const c = await page.content().catch(()=>""); console.log(`t=${(i+1)*3}s len=${c.length}`); }
const c = await page.content();
console.log("---121B content---"); console.log(c.slice(0, 200));
// 主框架 URL 与最终响应
console.log("final url:", page.url());
await browser.close();
