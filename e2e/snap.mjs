// quick screenshot helper: node snap.mjs <url> <out> [device]
import { chromium, devices } from "playwright";
import os from "node:os";
const [url, out, dev] = process.argv.slice(2);
const b = await chromium.launch({ ...(process.env.CHROME ? { executablePath: process.env.CHROME } : {}), args: ["--host-resolver-rules=MAP fonts.googleapis.com ~NOTFOUND, MAP fonts.gstatic.com ~NOTFOUND"] });
const ctx = await b.newContext(dev ? devices[dev] : { viewport: { width: 1280, height: 800 } });
const p = await ctx.newPage();
const errs = [];
p.on("pageerror", (e) => errs.push(String(e)));
await p.goto(url, { waitUntil: "networkidle", timeout: 90000 });
await p.waitForTimeout(Number(process.env.WAIT ?? 1500));
await p.screenshot({ path: out, fullPage: process.env.FULL === "1" });
console.log("errors", errs.length, errs.slice(0, 3).join(" | "));
await b.close();
