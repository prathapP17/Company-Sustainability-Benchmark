/**
 * End-to-end smoke test with playwright-core against a production build.
 *
 *   npm run build && npm run test:e2e
 *
 * Starts `next start` on a free port, drives the installed Chrome (set
 * CHROME_PATH to override), checks key content and that no page scrolls
 * horizontally at phone, tablet and desktop widths, and saves screenshots
 * to scratch/screenshots/ (git-ignored).
 */
import { spawn } from "node:child_process";
import { mkdirSync } from "node:fs";
import { auditPage } from "./a11y-lib";
import path from "node:path";
import { chromium, type Page } from "playwright-core";

const PORT = Number(process.env.E2E_PORT ?? 3107);
const BASE = `http://127.0.0.1:${PORT}`;
const CHROME = process.env.CHROME_PATH ?? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const OUT = path.join(process.cwd(), "scratch", "screenshots");
const WIDTHS = { phone: 390, tablet: 768, desktop: 1440 } as const;

const failures: string[] = [];
function check(cond: boolean, msg: string) {
  console.log(`${cond ? "PASS" : "FAIL"}  ${msg}`);
  if (!cond) failures.push(msg);
}

async function waitForServer() {
  for (let i = 0; i < 60; i++) {
    try {
      const r = await fetch(BASE);
      if (r.ok) return;
    } catch {}
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error("server did not start");
}

async function noHorizontalScroll(page: Page) {
  return page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth);
}

async function main() {
  mkdirSync(OUT, { recursive: true });
  const server = spawn("npx", ["next", "start", "-p", String(PORT), "-H", "127.0.0.1"], { stdio: "ignore" });
  try {
    await waitForServer();
    const browser = await chromium.launch({ executablePath: CHROME, headless: true });
    try {
      const page = await browser.newPage();

      // Dashboard: overview, map, sustainability overview, insights, activity
      await page.goto(BASE, { waitUntil: "networkidle" });
      check((await page.locator("h1").textContent())?.includes("Sustainability disclosure benchmark") ?? false, "dashboard heading");
      check((await page.getByText("in 9 SASB industries").count()) === 1, "dashboard counts SASB industries from the read model");
      check((await page.getByRole("application", { name: /Map of company headquarters/ }).count()) === 1, "dashboard: interactive map present");
      const mapSvg = await fetch(`${BASE}/map/world.svg`);
      check(mapSvg.ok && (await mapSvg.text()).includes('id="land"'), "base map served from this app (no third-party tiles)");
      const markers = await page.locator('[role=application] button[aria-label*="Scope 1 GHG emissions"], [role=application] button[aria-label*="companies here"]').count();
      check(markers >= 4, `map shows markers or clusters (got ${markers})`);
      await page.getByRole("button", { name: /^Reliance Industries, Mumbai/ }).click();
      check((await page.getByRole("complementary", { name: "Selected company" }).getByText("Boundary: parent only").count()) >= 1, "map panel shows Reliance's parent-only boundary");
      check((await page.getByRole("link", { name: "Open company profile" }).getAttribute("href")) === "/companies/reliance", "map panel links to the company profile");
      await page.getByLabel("Region").selectOption("Europe");
      check((await page.getByText("3 of 10 companies shown").count()) === 1, "map region filter (Europe: 3)");
      await page.getByLabel("Region").selectOption("");
      await page.getByLabel("Metric shown on the map").selectOption("au_bev_sales");
      check((await page.locator("#loc-list ~ * li, section[aria-labelledby=loc-list] li").filter({ hasText: "Does not apply" }).count()) >= 8, "industry metric marked 'does not apply' outside its industry");
      await page.getByLabel("Metric shown on the map").selectOption("ghg_scope1");
      await page.getByLabel("Search the map").fill("toyota");
      check((await page.getByText("1 of 10 companies shown").count()) === 1, "map search");
      check((await page.getByText("Not on the map").count()) === 0, "every company has valid coordinates (no unlocated list)");
      await page.goto(`${BASE}/companies`);
      const rows = await page.locator("#companies tbody tr").count();
      check(rows === 10, `companies page lists 10 companies (got ${rows})`);
      check((await page.getByText("Profile only").count()) === 2, "TSMC and Sony marked profile only");
      check((await page.getByText("Needs review").count()) === 2, "Samsung and Siemens classification flagged for review");

      // Company page with provenance
      await page.goto(`${BASE}/companies/reliance`);
      check((await page.locator("h1").textContent()) === "Reliance Industries", "company heading");
      check((await page.getByText("ril-brsr-fy2026, PDF p.36, P6 Q7").count()) >= 1, "value cites source and page");
      check((await page.getByText("FY2026 (to Mar 2026)").count()) >= 1, "Indian fiscal label");
      await page.goto(`${BASE}/companies/toyota`);
      check((await page.getByText("FY2025 (to Mar 2026)").count()) >= 1, "Japanese fiscal label");
      check((await page.getByText("Scope 3 by category").count()) === 1, "Scope 3 chart rendered");

      // Unknown company → not-found UI + noindex. With Cache Components the shell streams before
      // params resolve, so Next 16 keeps HTTP 200 for runtime params (documented in not-found.md).
      await page.goto(`${BASE}/companies/does-not-exist`);
      await page.waitForLoadState("networkidle");
      check((await page.getByRole("heading", { name: "Company not found" }).count()) === 1, "unknown company shows not-found UI");
      check((await page.locator('meta[name="robots"][content="noindex"]').count()) >= 1, "unknown company page is noindex");

      // Phase 2 pages
      await page.goto(`${BASE}/compare`);
      check((await page.locator("h1").textContent()) === "Compare companies", "compare page");
      await page.getByRole("button", { name: "Clear" }).click();
      check((await page.getByText("Select at least one company.").count()) === 1, "compare: clearing selection");
      await page.getByRole("button", { name: "Reliance Industries" }).click();
      await page.getByRole("button", { name: "Apple" }).click();
      check((await page.getByText("Not directly comparable").count()) >= 1, "compare: Reliance vs Apple flagged not comparable");

      await page.goto(`${BASE}/peers/tech_hardware_semis`);
      check((await page.getByText(/needs 3/).count()) >= 1, "peer median withheld below 3 comparable values");
      check((await page.getByText(/Benchmark: Hardware \(TC-HW\)/).count()) === 1 && (await page.getByText(/Benchmark: Semiconductors \(TC-SC\)/).count()) === 1, "peer group split into SASB industries");
      check((await page.getByText(/Not in median: industry classification needs review/).count()) >= 1, "Samsung shown but kept out of the median (classification needs review)");
      await page.goto(`${BASE}/peers/autos_industrials`);
      check((await page.getByText(/Benchmark: Automobiles \(TR-AU\)/).count()) === 1, "Toyota benchmarked as Automobiles, not with Siemens");

      await page.goto(`${BASE}/targets`);
      check((await page.getByText(/Ahead of straight-line path/).count()) >= 1, "targets: progress vs straight-line path");

      // Phase 6 pages
      await page.goto(`${BASE}/targets`);
      check((await page.getByText(/1\.5 °C pace · 5\.6%\/yr/).count()) >= 1, "targets: Apple's 62% by 2030 shown at 1.5 °C pace (5.6%/yr)");
      check((await page.getByText("Companies without targets recorded here").count()) === 1, "targets: companies without curated targets listed with SBTi status");
      await page.goto(`${BASE}/companies/microsoft`);
      check((await page.getByText(/SBTi lists a commitment as removed/).count()) === 1, "company page: SBTi removed commitment flagged");
      check((await page.getByText(/Data as of 20\d\d-\d\d-\d\d/i).count()) >= 1, "company page: SBTi data cited with its date");
      await page.goto(`${BASE}/scope3`);
      check((await page.locator("h1").textContent()) === "Scope 3 heatmap", "Scope 3 heatmap page");
      check((await page.locator("tbody th[scope=row]").count()) === 10, "heatmap has a row per company");
      await page.goto(`${BASE}/industry`);
      check((await page.getByText(/SASB/).count()) >= 5, "industry KPI page lists SASB indicators");

      await page.goto(`${BASE}/transparency`);
      check((await page.locator("tbody tr").count()) >= 18, "transparency checklist rows");

      await page.goto(`${BASE}/rankings`);
      check((await page.getByText(/insufficient coverage/).count()) >= 1, "rankings list unscored companies with reasons");

      await page.goto(`${BASE}/methodology`);
      check((await page.getByText("Transparency score").count()) >= 1, "methodology page");

      // Downloads need an account (brief section 7). Signed-in downloads are checked in test:e2e:pipeline.
      for (const url of ["/api/export/values.csv", "/api/export/benchmark.xlsx", "/api/export/report.pdf", "/api/export/report/nestle"]) {
        const r = await fetch(`${BASE}${url}`);
        check(r.status === 401, `guest download refused: ${url} (${r.status})`);
      }
      const reviewOverview = await fetch(`${BASE}/api/pipeline/overview`);
      check(reviewOverview.status === 204 && (await reviewOverview.text()) === "", `review counts not shown to guests (${reviewOverview.status})`);

      // Keyboard: the grouped navigation opens from the keyboard and closes with Escape.
      await page.setViewportSize({ width: 1440, height: 900 });
      await page.goto(BASE);
      await page.getByRole("button", { name: /^Explore/ }).focus();
      await page.keyboard.press("Enter");
      check(await page.getByRole("navigation", { name: "Main" }).getByRole("link", { name: /Peer benchmarks/ }).isVisible(), "Explore menu opens with Enter");
      await page.keyboard.press("Escape");
      check(!(await page.getByRole("navigation", { name: "Main" }).getByRole("link", { name: /Peer benchmarks/ }).isVisible()), "menu closes with Escape");
      await page.getByRole("combobox", { name: "Search companies" }).fill("nest");
      await page.keyboard.press("Enter");
      await page.waitForURL(/\/companies\/nestle$/);
      check(page.url().endsWith("/companies/nestle"), "header search opens a company with the keyboard");

      // Accessibility (axe-core, WCAG 2.1 A/AA), light and dark mode.
      for (const scheme of ["light", "dark"] as const) {
        const ctx = await browser.newContext({ colorScheme: scheme });
        const ap = await ctx.newPage();
        for (const route of ["/", "/companies", "/companies/apple", "/companies/toyota", "/compare", "/peers/consumer_staples", "/peers/tech_hardware_semis", "/targets", "/scope3", "/industry", "/transparency", "/rankings", "/methodology", "/downloads", "/review"]) {
          await ap.goto(`${BASE}${route}`, { waitUntil: "networkidle" });
          const v = await auditPage(ap);
          check(v.length === 0, `accessibility ${scheme} ${route}${v.length ? `: ${v.map((x) => `${x.id} @ ${x.nodes[0]}`).join("; ")}` : ""}`);
        }
        await ctx.close();
      }

      // Responsive checks + screenshots
      for (const [name, width] of Object.entries(WIDTHS)) {
        await page.setViewportSize({ width, height: 900 });
        for (const route of ["/", "/companies", "/companies/toyota", "/compare", "/peers/consumer_staples", "/peers/tech_hardware_semis", "/targets", "/scope3", "/industry", "/transparency", "/rankings", "/methodology", "/downloads"]) {
          await page.goto(`${BASE}${route}`, { waitUntil: "networkidle" });
          check(await noHorizontalScroll(page), `no horizontal page scroll at ${name} (${width}px) on ${route}`);
          if (route === "/" && width < 1024) {
            await page.getByRole("button", { name: "Menu" }).click();
            check(await page.locator("#mobile-nav").isVisible(), `navigation menu opens at ${name}`);
            await page.getByRole("button", { name: "Close" }).click();
          }
          const file = `${route === "/" ? "dashboard" : route.slice(1).replace(/\//g, "_")}-${name}.png`;
          await page.screenshot({ path: path.join(OUT, file), fullPage: true });
        }
      }
    } finally {
      await browser.close();
    }
  } finally {
    server.kill();
  }
  console.log(`\n${failures.length ? `${failures.length} FAILED` : "All e2e checks passed"}. Screenshots in ${OUT}`);
  process.exit(failures.length ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
