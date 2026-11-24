/**
 * Scheduled refresh: discovery for every configured company, then the worker
 * drains extraction jobs for anything auto-fetched.
 *
 *   npm run refresh                       # all companies, trigger "manual"
 *   npm run refresh -- --company apple    # one company (repeatable)
 *   npm run refresh -- --trigger schedule # used by the launchd job
 *   npm run refresh -- --no-extract       # discovery only
 */
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { defaultDataDir } from "../src/lib/data/load";
import { pipelineDb } from "../src/lib/pipeline/db";
import { runDiscovery } from "../src/lib/discovery/discover";

if (existsSync(".env.local")) process.loadEnvFile(".env.local");

const args = process.argv.slice(2);
const companies: string[] = [];
let trigger: "manual" | "schedule" = "manual";
for (let i = 0; i < args.length; i++) {
  if (args[i] === "--company") companies.push(args[++i]);
  if (args[i] === "--trigger") trigger = args[++i] === "schedule" ? "schedule" : "manual";
}

async function main() {
  const dataDir = defaultDataDir();
  const started = new Date();
  console.log(`[${started.toISOString()}] refresh (${trigger}) on ${dataDir}`);
  const summary = await runDiscovery(pipelineDb(dataDir), {
    dataDir,
    companies: companies.length ? companies : undefined,
    trigger,
    secUserAgent: process.env.SEC_USER_AGENT?.trim() || null,
    log: (m) => console.log(`  ${m}`),
  });
  console.log(
    `  run #${summary.runId}: ${summary.pagesRead} pages read, ${summary.found} report links, ${summary.fetched} auto-fetched, ${summary.alerts} new alerts`,
  );
  for (const b of summary.blocked) console.log(`  blocked: ${b}`);
  for (const n of summary.notes) console.log(`  note: ${n}`);

  if (!args.includes("--no-extract")) {
    const r = spawnSync("npx", ["tsx", "scripts/worker.ts", "--once"], { stdio: "inherit", env: process.env });
    if (r.status !== 0) process.exitCode = r.status ?? 1;
  }
  console.log(`[${new Date().toISOString()}] refresh finished in ${Math.round((Date.now() - started.getTime()) / 1000)} s`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
