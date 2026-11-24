/**
 * Re-applies the current discovery filters to links already in the queue.
 *
 *   npm run refilter            # dry run: lists what would change
 *   npm run refilter -- --apply # backs up data/pipeline.db, then applies
 */
import { mkdirSync } from "node:fs";
import path from "node:path";
import { defaultDataDir } from "../src/lib/data/load";
import { pipelineDb, pipelinePath } from "../src/lib/pipeline/db";
import { refilterDiscovered } from "../src/lib/discovery/refilter";

async function main() {
  const apply = process.argv.includes("--apply");
  const dataDir = defaultDataDir();
  const db = pipelineDb(dataDir);
  const changes = refilterDiscovered(db, dataDir, { apply: false });

  const skipped = changes.filter((c) => c.status);
  const byReason = new Map<string, number>();
  for (const c of skipped) byReason.set(`${c.companyId}: ${c.reason}`, (byReason.get(`${c.companyId}: ${c.reason}`) ?? 0) + 1);
  console.log(`${changes.length} link${changes.length === 1 ? "" : "s"} would change on ${dataDir}`);
  console.log(`\nleft out (${skipped.length}):`);
  for (const [k, n] of [...byReason].sort()) console.log(`  ${k}: ${n}`);
  const docs = skipped.filter((c) => c.documentId);
  if (docs.length) {
    console.log(`\nalready-fetched documents now left out (pending proposals removed; the files stay):`);
    for (const c of docs) console.log(`  document #${c.documentId}: ${c.url.split("/").pop()} (${c.proposalsRemoved} pending proposal${c.proposalsRemoved === 1 ? "" : "s"})`);
  }
  const retitled = changes.filter((c) => c.title || c.year);
  console.log(`\ntitle or year corrected: ${retitled.length}`);
  for (const c of retitled.slice(0, 15)) {
    const parts = [c.title && `"${c.title.from}" -> "${c.title.to}"`, c.year && `year ${c.year.from ?? "none"} -> ${c.year.to ?? "none"}`].filter(Boolean);
    console.log(`  #${c.id} ${parts.join(", ")}`);
  }
  if (retitled.length > 15) console.log(`  … and ${retitled.length - 15} more`);

  if (!apply) {
    console.log("\nDry run. Re-run with --apply to make these changes (the database is backed up first).");
    return;
  }
  if (!changes.length) return;
  const dir = path.join(dataDir, "backups");
  mkdirSync(dir, { recursive: true });
  const backup = path.join(dir, `pipeline-${new Date().toISOString().replace(/[:.]/g, "-")}-refilter.db`);
  await db.backup(backup);
  console.log(`\nbacked up ${pipelinePath(dataDir)} -> ${backup}`);
  const applied = refilterDiscovered(db, dataDir, { apply: true });
  console.log(`applied ${applied.length} change${applied.length === 1 ? "" : "s"}; each one is in the audit log`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
