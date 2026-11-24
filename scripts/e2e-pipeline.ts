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
const TOKEN = "e2e-reviewer-token-0123456789";
const OUT = path.join(process.cwd(), "scratch", "screenshots");

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

async function main() {
  mkdirSync(OUT, { recursive: true });
  const dataDir = mkdtempSync(path.join(tmpdir(), "csi-e2e-"));
  cpSync("data/companies", path.join(dataDir, "companies"), { recursive: true });
  cpSync("data/peer-groups.json", path.join(dataDir, "peer-groups.json"));
  const env = { ...process.env, CSI_DATA_DIR: dataDir, REVIEWER_TOKEN: TOKEN, ANTHROPIC_API_KEY: "" };
  spawnSync("npx", ["tsx", "scripts/seed.ts"], { env, stdio: "ignore" });
  const pdf = path.join(dataDir, "fixture.pdf");
  writeFileSync(pdf, await makeGhgPdf({ scannedPage: true }));

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

      // Access control
      const anon = await fetch(`${BASE}/api/pipeline/upload`, { method: "POST" });
      check(anon.status === 401, `upload without sign-in refused (${anon.status})`);
      const remote = await rawGet("/review", "attacker.example");
      check(
        remote.body.includes("only available on this computer") && !remote.body.includes("Upload a document"),
        "review content withheld for a non-local Host",
      );
      const tunnel = await fetch(`${BASE}/api/pipeline/login`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Origin: BASE, "cf-connecting-ip": "1.2.3.4" },
        body: JSON.stringify({ name: "x", token: TOKEN }),
      });
      check(tunnel.status === 403, `login through a tunnel header refused (${tunnel.status})`);

      await page.goto(`${BASE}/review`);
      check((await page.getByText("Sign in with the reviewer token.").count()) === 1, "review page asks for sign-in");
      await page.getByLabel(/Your name/).fill("E2E Reviewer");
      await page.getByLabel(/Reviewer token/).fill("wrong-token-000000000");
      await page.getByRole("button", { name: "Sign in" }).click();
      await page.getByText("wrong token").waitFor();
      check(true, "wrong token rejected");
      await page.getByLabel(/Reviewer token/).fill(TOKEN);
      await page.getByRole("button", { name: "Sign in" }).click();
      await page.getByText("Signed in as").waitFor();
      check(true, "signed in with the reviewer token");

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

      await page.goto(`${BASE}/review/audit`);
      check((await page.getByText("E2E Reviewer").count()) >= 2, "audit log records the reviewer's actions");

      for (const [name, width] of [["phone", 375], ["tablet", 768], ["desktop", 1280]] as const) {
        await page.setViewportSize({ width, height: 900 });
        for (const route of ["/review", "/review/documents/1"]) {
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
    rmSync(dataDir, { recursive: true, force: true });
  }
  console.log(`\n${failures.length ? `${failures.length} FAILED` : "All pipeline e2e checks passed"}.`);
  process.exit(failures.length ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
