/**
 * Snapshot backup of the data folder.
 *
 *   npm run backup                 # keeps the newest 14 snapshots (BACKUP_KEEP to change)
 */
import { defaultDataDir } from "../src/lib/data/load";
import { backupDataDir } from "../src/lib/ops/backup";

const keep = Number(process.env.BACKUP_KEEP ?? 14);
backupDataDir(defaultDataDir(), { keep: Number.isFinite(keep) && keep > 0 ? keep : 14 })
  .then((r) => {
    console.log(`[${new Date().toISOString()}] backup: ${r.files} files -> ${r.dir}`);
    if (r.pruned.length) console.log(`  removed ${r.pruned.length} old snapshot(s): ${r.pruned.join(", ")}`);
  })
  .catch((e) => {
    console.error(`backup failed: ${(e as Error).message}`);
    process.exit(1);
  });
