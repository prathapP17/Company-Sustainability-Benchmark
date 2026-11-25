/**
 * Performance budgets (phase 7): loads each page of a production build in
 * Chrome and fails if its JavaScript, HTML or server response time is over
 * budget (perf-budgets.json). Uses the real data folder read-only.
 *
 *   npm run build && npm run perf
 */
import { spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import { chromium } from "playwright-core";

const PORT = 3125;
const BASE = `http://localhost:${PORT}`;
const CHROME = process.env.CHROME_PATH ?? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
type Budget = { maxJsKb: number; maxHtmlKb: number; maxTtfbMs: number };
const cfg = JSON.parse(readFileSync("perf-budgets.json", "utf8")) as { defaults: Budget; pages: Record<string, Partial<Budget>> };

const median = (xs: number[]) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)];

async function main() {
  const server = spawn("npx", ["next", "start", "-p", String(PORT)], { stdio: "ignore" });
  let failures = 0;
  try {
    for (let i = 0; i < 60; i++) {
      try {
        if ((await fetch(BASE)).ok) break;
      } catch {}
      await new Promise((r) => setTimeout(r, 500));
    }
    const browser = await chromium.launch({ executablePath: CHROME, headless: true });
    console.log(`${"page".padEnd(26)} ${"JS KB".padStart(8)} ${"HTML KB".padStart(8)} ${"TTFB ms".padStart(8)}`);
    for (const [route, over] of Object.entries(cfg.pages)) {
      const b: Budget = { ...cfg.defaults, ...over };
      const runs: { js: number; html: number; ttfb: number }[] = [];
      for (let k = 0; k < 3; k++) {
        const page = await browser.newPage();
        await page.goto(`${BASE}${route}`, { waitUntil: "load" });
        runs.push(
          await page.evaluate(() => {
            const nav = performance.getEntriesByType("navigation")[0] as PerformanceNavigationTiming;
            const js = (performance.getEntriesByType("resource") as PerformanceResourceTiming[])
              .filter((r) => r.initiatorType === "script")
              .reduce((n, r) => n + r.encodedBodySize, 0);
            return { js, html: nav.encodedBodySize, ttfb: nav.responseStart - nav.requestStart };
          }),
        );
        await page.close();
      }
      const js = Math.max(...runs.map((r) => r.js)) / 1024;
      const html = Math.max(...runs.map((r) => r.html)) / 1024;
      const ttfb = median(runs.map((r) => r.ttfb));
      const over_ = [js > b.maxJsKb && `JS ${js.toFixed(0)} > ${b.maxJsKb} KB`, html > b.maxHtmlKb && `HTML ${html.toFixed(0)} > ${b.maxHtmlKb} KB`, ttfb > b.maxTtfbMs && `TTFB ${ttfb.toFixed(0)} > ${b.maxTtfbMs} ms`].filter(Boolean);
      if (over_.length) failures++;
      console.log(`${route.padEnd(26)} ${js.toFixed(0).padStart(8)} ${html.toFixed(0).padStart(8)} ${ttfb.toFixed(0).padStart(8)}  ${over_.length ? `OVER: ${over_.join(", ")}` : "ok"}`);
    }
    await browser.close();
  } finally {
    server.kill();
  }
  console.log(failures ? `\n${failures} page(s) over budget.` : "\nAll pages within budget.");
  process.exit(failures ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
