/**
 * Generate AI summaries from the command line (costs API credits per company).
 *
 *   npm run summaries -- --company apple     # one company
 *   npm run summaries -- --stale             # every company without a current summary
 *
 * A summary is published only if the automatic citation check passes.
 */
import { existsSync } from "node:fs";
import os from "node:os";
import { defaultDataDir, loadCompanies } from "../src/lib/data/load";
import { pipelineDb } from "../src/lib/pipeline/db";
import { aiEnabled } from "../src/lib/pipeline/extract/ai";
import { summarizeCompany } from "../src/lib/summaries/run";
import { summaryState } from "../src/lib/summaries/store";

if (existsSync(".env.local")) process.loadEnvFile(".env.local");

async function main() {
  if (!aiEnabled()) throw new Error("ANTHROPIC_API_KEY is not set (.env.local)");
  const args = process.argv.slice(2);
  const dataDir = defaultDataDir();
  const ids = args.includes("--stale")
    ? loadCompanies(dataDir).companies.map((c) => c.profile.id).filter((id) => summaryState(id, dataDir).kind !== "current")
    : args.flatMap((a, i) => (a === "--company" ? [args[i + 1]] : []));
  if (!ids.length) throw new Error("name a company with --company <id>, or use --stale");
  const db = pipelineDb(dataDir);
  for (const id of ids) {
    const r = await summarizeCompany(db, id, `cli:${os.userInfo().username}`, { dataDir });
    console.log(`${id.padEnd(10)} ${r.ok ? "published" : "REJECTED by the check"} · ${r.sentences} sentences · ${r.inputTokens} in / ${r.outputTokens} out tokens`);
    for (const p of r.problems) console.log(`    - ${p}`);
  }
}

main().catch((e) => {
  console.error(`Error: ${(e as Error).message}`);
  process.exit(1);
});
