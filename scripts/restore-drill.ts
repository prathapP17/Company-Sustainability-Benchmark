/**
 * Restore drill: verifies the newest snapshot (or one given) restores cleanly
 * into a temporary folder. The live data is never touched.
 *
 *   npm run restore:drill
 *   npm run restore:drill -- data/backups/snapshot-2026-11-25T03-00-00-000Z
 */
import { defaultDataDir } from "../src/lib/data/load";
import { latestSnapshot, restoreDrill } from "../src/lib/ops/restore";

const snap = process.argv[2] ?? latestSnapshot(defaultDataDir());
if (!snap) {
  console.error("No snapshot found. Run npm run backup first.");
  process.exit(1);
}
const r = restoreDrill(snap);
console.log(`restore drill: ${snap}`);
for (const c of r.checks) console.log(`  ${c.ok ? "ok  " : "FAIL"} ${c.name.padEnd(14)} ${c.detail}`);
console.log(r.ok ? "Snapshot restores cleanly." : "Snapshot FAILED the drill.");
process.exit(r.ok ? 0 : 1);
