import { chromium } from "playwright";
import { readFileSync, writeFileSync } from "node:fs";

const cookieStr = readFileSync("/tmp/icnet-cookie.txt", "utf8").trim();
const ua = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/151.0.0.0 Safari/537.36";
const cookies = cookieStr.split(/;\s*/).filter(Boolean).map((p) => {
  const i = p.indexOf("=");
  return { name: p.slice(0, i), value: p.slice(i + 1), domain: ".ic.net.cn", path: "/" };
});
const browser = await chromium.launch({ channel: "chrome", headless: false });
const ctx = await browser.newContext({ userAgent: ua, viewport: { width: 1366, height: 900 } });
await ctx.addCookies(cookies);
const page = await ctx.newPage();
await page.goto("https://www.ic.net.cn/search/STM32F405RGT6.html", { waitUntil: "commit", timeout: 60000 });
let html = "";
for (let i = 0; i < 10; i++) {
  await page.waitForTimeout(3000);
  html = await page.content().catch(() => "");
  const hits = (html.match(/STM32F405RGT6/g) || []).length;
  console.log(`t=${(i + 1) * 3}s bytes=${html.length} mpnHits=${hits} title="${(await page.title().catch(() => "")).slice(0, 40)}"`);
  if (hits > 0) break;
}
writeFileSync("/tmp/icn-auth2.html", html);
const finalCookies = await ctx.cookies(["https://www.ic.net.cn"]);
const flat = finalCookies.map((c) => `${c.name}=${c.value}`).join("; ");
writeFileSync("/tmp/icn-full-cookie.txt", flat);
console.log("cookies:", finalCookies.length, "->", flat.length, "chars");
await browser.close();
