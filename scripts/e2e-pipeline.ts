/**
 * End-to-end test of the review pipeline against a production build, using
 * a TEMPORARY data directory (never the real database or company files).
 *
 *   npm run build && npm run test:e2e:pipeline
 */
import { spawn, spawnSync } from "node:child_process";
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import http from "node:http";
import { tmpdir } from "node:os";
import path from "node:path";
import { chromium } from "playwright-core";
import { makeGhgPdf } from "../tests/pdf-fixture";

const PORT = 3108;
const BASE = `http://localhost:${PORT}`;
const CHROME = process.env.CHROME_PATH ?? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const ADMIN_PW = "orchid lantern harbour 2026";
const VIEWER_PW = "maple quartz river 2026";
const OUT = path.join(process.cwd(), "scratch", "screenshots");
/** Pages Next.js regenerates at runtime. Cleared before and after, so test data never reaches a later local server. */
const ROUTE_CACHE = path.join(process.cwd(), ".next", "server", "route-cache");

const failures: string[] = [];
function check(cond: boolean, msg: string) {
  console.log(`${cond ? "PASS" : "FAIL"}  ${msg}`);
  if (!cond) failures.push(msg);
}

/** Raw request with a forged Host header (fetch forbids setting Host). */
function rawGet(pathname: string, host: string, extra: Record<string, string> = {}): Promise<{ status: number; body: string }> {
  return new Promise((resolve, reject) => {
    http
      .get({ host: "127.0.0.1", port: PORT, path: pathname, headers: { host, ...extra } }, (res) => {
        let body = "";
        res.setEncoding("utf8");
        res.on("data", (c) => (body += c));
        res.on("end", () => resolve({ status: res.statusCode ?? 0, body }));
      })
      .on("error", reject);
  });
}

function runAsync(cmd: string, args: string[], env: NodeJS.ProcessEnv): Promise<{ status: number | null; stdout: string }> {
  return new Promise((resolve) => {
    const p = spawn(cmd, args, { env });
    let stdout = "";
    p.stdout.on("data", (d) => (stdout += d));
    p.stderr.on("data", (d) => (stdout += d));
    p.on("close", (status) => resolve({ status, stdout }));
  });
}

/** Local stand-in for a company website (discovery must never hit real sites in tests). */
async function startSite(pdf: Buffer): Promise<{ url: string; close: () => void }> {
  const srv = http.createServer((req, res) => {
    if (req.url === "/robots.txt") return res.writeHead(200).end("User-agent: *\nAllow: /\n");
    if (req.url === "/sustainability/") {
      res.writeHead(200, { "content-type": "text/html" });
      return res.end('<a href="/r/sustainability-report-2026.pdf">Sustainability Report 2026</a><a href="/r/environmental-report-2019.pdf">Environmental Report 2019</a>');
    }
    if (req.url?.endsWith(".pdf")) {
      res.writeHead(200, { "content-type": "application/pdf", "content-length": pdf.length, etag: '"e2e"' });
      return res.end(req.method === "HEAD" ? undefined : pdf);
    }
    res.writeHead(404).end();
  });
  await new Promise<void>((r) => srv.listen(0, "127.0.0.1", () => r()));
  const port = (srv.address() as { port: number }).port;
  return { url: `http://127.0.0.1:${port}`, close: () => srv.close() };
}

async function main() {
  mkdirSync(OUT, { recursive: true });
  const dataDir = mkdtempSync(path.join(tmpdir(), "csi-e2e-"));
  cpSync("data/companies", path.join(dataDir, "companies"), { recursive: true });
  cpSync("data/peer-groups.json", path.join(dataDir, "peer-groups.json"));
  const env = { ...process.env, CSI_DATA_DIR: dataDir, ANTHROPIC_API_KEY: "", APP_ORIGIN: "" };
  spawnSync("npx", ["tsx", "scripts/seed.ts"], { env, stdio: "ignore" });
  const pdf = path.join(dataDir, "fixture.pdf");
  writeFileSync(pdf, await makeGhgPdf({ scannedPage: true }));
  const siteServer = await startSite(await makeGhgPdf({ scope1: ["51,000", "53,300", "56,100"] }));
  writeFileSync(
    path.join(dataDir, "discovery.json"),
    JSON.stringify({
      $schemaVersion: 1,
      defaults: { maxAutoFetchPerRun: 3, autoFetchMinYearOffset: 1, maxPagesPerCompany: 3, hostIntervalMs: 250 },
      companies: { apple: { seedUrls: [`${siteServer.url}/sustainability/`], allowedDomains: ["127.0.0.1"], autoFetch: true } },
    }),
  );

  rmSync(ROUTE_CACHE, { recursive: true, force: true });
  const server = spawn("npx", ["next", "start", "-p", String(PORT)], { env, stdio: "ignore" });
  try {
    for (let i = 0; i < 60; i++) {
      try {
        if ((await fetch(BASE)).ok) break;
      } catch {}
      await new Promise((r) => setTimeout(r, 500));
    }
    const browser = await chromium.launch({ executablePath: CHROME, headless: true });
    try {
      const page = await browser.newPage();

      // Hardening: security headers on public pages.
      const home = await fetch(BASE);
      check(/frame-ancestors 'none'/.test(home.headers.get("content-security-policy") ?? ""), "Content-Security-Policy set");
      check(home.headers.get("x-frame-options") === "DENY" && home.headers.get("x-content-type-options") === "nosniff", "frame and sniffing protection set");
      check(home.headers.get("x-powered-by") === null, "no X-Powered-By header");
      check(/Disallow: \/review/.test(await (await fetch(`${BASE}/robots.txt`)).text()), "robots.txt keeps crawlers out of /review");
      const appleBefore = await (await fetch(`${BASE}/companies/apple`)).text();

      // Access control
      const anon = await fetch(`${BASE}/api/pipeline/upload`, { method: "POST", headers: { Origin: BASE } });
      check(anon.status === 401, `upload without sign-in refused (${anon.status})`);
      const crossSite = await fetch(`${BASE}/api/pipeline/upload`, { method: "POST", headers: { Origin: "https://evil.example" } });
      check(crossSite.status === 403, `cross-site POST refused (${crossSite.status})`);
      const remote = await rawGet("/review", "attacker.example");
      check(
        remote.body.includes("only available on this computer") && !remote.body.includes("Upload a document"),
        "review content withheld for a non-local Host",
      );
      const tunnel = await fetch(`${BASE}/api/pipeline/login`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Origin: BASE, "cf-connecting-ip": "1.2.3.4" },
        body: JSON.stringify({ email: "x@example.org", password: "whatever-password" }),
      });
      check(tunnel.status === 403, `login through a tunnel header refused (${tunnel.status})`);

      // First admin: no accounts yet, then the CLI prints a one-time link.
      await page.goto(`${BASE}/review`);
      check((await page.getByText("No accounts exist yet").count()) === 1, "review page explains how to create the first admin");
      const cli = spawnSync("npx", ["tsx", "scripts/users.ts", "invite", "--email", "admin@e2e.test", "--name", "E2E Admin", "--role", "admin"], { env, encoding: "utf8" });
      const adminLink = /(http:\/\/\S+\/review\/set-password#\S+)/.exec(cli.stdout)?.[1];
      check(cli.status === 0 && !!adminLink, "CLI created the first admin and printed a one-time link");
      await page.goto(adminLink!.replace("http://localhost:3000", BASE));
      await page.getByText("Welcome").waitFor();
      check(!page.url().includes("#"), "the link's token is removed from the address bar");
      await page.getByLabel(/New password/).fill("short");
      await page.getByLabel(/Repeat it/).fill("short");
      await page.getByRole("button", { name: "Set password" }).click();
      check(await page.locator("input[name=password]:invalid").count() === 1, "too-short password refused by the form");
      await page.getByLabel(/New password/).fill(ADMIN_PW);
      await page.getByLabel(/Repeat it/).fill(ADMIN_PW);
      await page.getByRole("button", { name: "Set password" }).click();
      await page.getByText("Password set.").waitFor();
      check(true, "admin set a password with the invite link");
      await page.goto(`${BASE}/`); // a fresh load: same-page "#" changes do not reload
      await page.goto(adminLink!.replace("http://localhost:3000", BASE));
      await page.getByText(/invalid, used or expired/).waitFor();
      check(true, "the invite link works only once");

      await page.goto(`${BASE}/review`);
      await page.getByLabel("Email").fill("admin@e2e.test");
      await page.getByLabel("Password").fill("not the password at all");
      await page.getByRole("button", { name: "Sign in" }).click();
      await page.getByText("email or password is wrong").waitFor();
      check(true, "wrong password rejected");
      await page.getByLabel("Password").fill(ADMIN_PW);
      await page.getByRole("button", { name: "Sign in" }).click();
      await page.getByText("Signed in as").waitFor();
      check((await page.getByText("(admin)").count()) === 1, "signed in as admin");
      const cookie = (await page.context().cookies()).find((c) => c.name === "csi_session");
      check(!!cookie?.httpOnly && cookie?.sameSite === "Strict", "session cookie is HttpOnly and SameSite=Strict");

      // Admin adds a viewer; the viewer signs in in a separate browser and cannot change anything.
      await page.goto(`${BASE}/review/users`);
      await page.getByLabel("Email").fill("viewer@e2e.test");
      await page.getByLabel(/Name/).fill("E2E Viewer");
      await page.locator('form select[name="role"]').selectOption("viewer");
      await page.getByRole("button", { name: "Create account and link" }).click();
      const viewerLink = await page.getByLabel("One-time link").inputValue();
      check(/\/review\/set-password#/.test(viewerLink), "admin got a one-time link for the new account");
      const other = await browser.newContext();
      const vp = await other.newPage();
      await vp.goto(viewerLink);
      await vp.getByLabel(/New password/).fill(VIEWER_PW);
      await vp.getByLabel(/Repeat it/).fill(VIEWER_PW);
      await vp.getByRole("button", { name: "Set password" }).click();
      await vp.getByText("Password set.").waitFor();
      await vp.goto(`${BASE}/review`);
      await vp.getByLabel("Email").fill("viewer@e2e.test");
      await vp.getByLabel("Password").fill(VIEWER_PW);
      await vp.getByRole("button", { name: "Sign in" }).click();
      await vp.getByText("Signed in as").waitFor();
      check((await vp.getByText("Upload a document").count()) === 0, "viewer sees no upload form");
      const viewerUpload = await vp.evaluate(async () => (await fetch("/api/pipeline/upload", { method: "POST", body: new FormData() })).status);
      check(viewerUpload === 403, `viewer upload refused by the server (${viewerUpload})`);
      await vp.goto(`${BASE}/review/users`);
      check((await vp.getByText(/needs the admin role/).count()) === 1, "viewer cannot open the users page");
      await other.close();

      await page.goto(`${BASE}/review`);
      // Upload
      await page.setInputFiles('input[name="file"]', pdf);
      await page.selectOption('select[name="companyId"]', "apple");
      await page.fill('input[name="title"]', "E2E fixture report");
      await page.fill('input[name="reportingYear"]', "2025");
      await page.getByRole("button", { name: "Upload" }).click();
      await page.getByText(/Uploaded as document #1/).waitFor();
      check(true, "upload accepted");
      await page.setInputFiles('input[name="file"]', pdf);
      await page.getByRole("button", { name: "Upload" }).click();
      await page.getByText(/Already uploaded/).waitFor();
      check(true, "duplicate upload detected by hash");

      // Worker
      const w = spawnSync("npx", ["tsx", "scripts/worker.ts", "--once"], { env, encoding: "utf8" });
      check(w.status === 0 && /rule-based proposals/.test(w.stdout), "worker processed the document");

      await page.goto(`${BASE}/review/documents/1`);
      check((await page.getByText(/1 page\(s\) have no text layer/).count()) === 1, "scanned page flagged for OCR");
      check((await page.getByText(/Pending review/).count()) === 1, "proposals awaiting review");
      check((await page.getByText("Conflicts with curated value").count()) >= 1, "conflict with curated Apple value shown");

      // Approve a non-conflicting value (2023 Scope 1).
      const item = page.locator("li", { hasText: "Scope 1 GHG emissions" }).filter({ hasText: "FY2023" }).first();
      await item.getByRole("button", { name: "Approve", exact: true }).click();
      await page.getByText(/Approved \(1\)/).waitFor();
      const apple = JSON.parse(readFileSync(path.join(dataDir, "companies", "apple.json"), "utf8"));
      const written = apple.metrics.find((m: { metric: string; year: number }) => m.metric === "ghg_scope1" && m.year === 2023);
      check(written?.value === 51000 && /^upload-/.test(written?.source), "approved value written to the company file with its source");

      // Conflict: restatement needs a reason.
      const conflictItem = page.locator("li", { hasText: "Scope 1 GHG emissions" }).filter({ hasText: "FY2025" }).first();
      check(await conflictItem.getByRole("button", { name: "Approve as restatement" }).isDisabled(), "restatement disabled until a reason is given");

      // Discovery (phase 4): refresh against the local site, then review discovered reports and alerts.
      // Async spawn: the local test site runs in this process and must keep serving.
      const refresh = await runAsync("npx", ["tsx", "scripts/refresh.ts"], env);
      if (refresh.status !== 0 || !/1 auto-fetched/.test(refresh.stdout)) console.log(refresh.stdout);
      check(refresh.status === 0 && /1 auto-fetched/.test(refresh.stdout), "refresh discovered and auto-fetched the recent official report");
      await page.goto(`${BASE}/review/discovered`);
      check((await page.getByText("Sustainability Report 2026").count()) >= 1, "discovered page lists the found report");
      const old = page.locator("li", { hasText: "Environmental Report 2019" });
      check((await old.getByText("Awaiting fetch").count()) === 1, "older report waits for a manual fetch");
      await old.getByRole("button", { name: "Fetch" }).click();
      await page.locator("li", { hasText: "Environmental Report 2019" }).getByText("Fetched").waitFor();
      check(true, "manual Fetch downloaded the report into the pipeline");
      await page.goto(`${BASE}/review/alerts`);
      const restatement = page.locator("li", { hasText: "Possible restatement" }).first();
      check((await restatement.count()) === 1, "restatement alert raised for the auto-fetched report");
      await restatement.getByRole("button", { name: "Acknowledge" }).click();
      await page.getByText("Recently acknowledged").waitFor();
      check(true, "alert acknowledged");

      // Phase 6 review pages (no API key in tests: generation is offered only when one is set).
      await page.goto(`${BASE}/review/summaries`);
      check((await page.getByText("ANTHROPIC_API_KEY is not set").count()) === 1, "summaries page says generation needs an API key");
      await page.goto(`${BASE}/review/news`);
      check((await page.getByText("Nothing waiting.").count()) === 1, "news review queue renders");

      await page.goto(`${BASE}/review/audit`);
      check((await page.getByText("E2E Admin").count()) >= 2, "audit log records the signed-in user's actions");

      // Approvals refresh the pre-built public pages (next visit regenerates; allow one stale response).
      let appleAfter = "";
      for (let i = 0; i < 10 && !appleAfter.includes("51,000"); i++) {
        appleAfter = await (await fetch(`${BASE}/companies/apple`)).text();
        if (!appleAfter.includes("51,000")) await new Promise((r) => setTimeout(r, 500));
      }
      check(!appleBefore.includes("51,000") && appleAfter.includes("51,000"), "approved value appears on the public company page without a rebuild");
      if (!appleAfter.includes("51,000")) {
        const strip = (h: string) => h.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");
        console.log("  before:", /Earlier years.{0,200}/.exec(strip(appleBefore))?.[0]);
        console.log("  after: ", /Earlier years.{0,200}/.exec(strip(appleAfter))?.[0]);
        console.log("  scope1 in JSON:", JSON.stringify(JSON.parse(readFileSync(path.join(dataDir, "companies", "apple.json"), "utf8")).metrics.filter((m: { metric: string }) => m.metric === "ghg_scope1").map((m: { year: number; value: number; boundary?: string }) => [m.year, m.value, m.boundary])));
        const db = spawnSync("sqlite3", [path.join(dataDir, "benchmark.db"), "select metric_id, year, value from metric_values where company_id='apple' and metric_id='ghg_scope1'"], { encoding: "utf8" });
        console.log("  scope1 in benchmark.db:", db.stdout.trim().replace(/\n/g, "; "), db.stderr.trim());
      }

      for (const [name, width] of [["phone", 375], ["tablet", 768], ["desktop", 1280]] as const) {
        await page.setViewportSize({ width, height: 900 });
        for (const route of ["/review", "/review/documents/1", "/review/discovered", "/review/alerts", "/review/users", "/review/account", "/review/news", "/review/summaries"]) {
          await page.goto(`${BASE}${route}`, { waitUntil: "networkidle" });
          await page.locator("h1").first().waitFor();
          const ok = await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth);
          check(ok, `no horizontal page scroll at ${name} on ${route}`);
          await page.screenshot({ path: path.join(OUT, `${route.slice(1).replace(/\//g, "_")}-${name}.png`), fullPage: true });
        }
      }
    } finally {
      await browser.close();
    }
  } finally {
    server.kill();
    await new Promise((r) => setTimeout(r, 500));
    rmSync(ROUTE_CACHE, { recursive: true, force: true });
    siteServer.close();
    rmSync(dataDir, { recursive: true, force: true });
  }
  console.log(`\n${failures.length ? `${failures.length} FAILED` : "All pipeline e2e checks passed"}.`);
  process.exit(failures.length ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
