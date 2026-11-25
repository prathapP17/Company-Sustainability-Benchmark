/**
 * Snapshot backups of the data folder (hosted mode runs this daily).
 *
 * A snapshot is data/backups/snapshot-<time>/ containing:
 *  - pipeline.db and benchmark.db, copied with SQLite's online backup (safe
 *    while the app and worker are running),
 *  - companies/, peer-groups.json, discovery.json (the curated data),
 *  - uploads/ as hard links: uploaded files are content-addressed and never
 *    change, so this costs no extra disk space.
 * Only snapshot-* folders are ever pruned; migration backups are left alone.
 * Snapshots live on the same disk: copy the whole data volume off the server
 * as well (see docs/DEPLOYMENT.md).
 */
import Database from "better-sqlite3";
import { copyFileSync, cpSync, existsSync, linkSync, mkdirSync, readdirSync, rmSync, statSync } from "node:fs";
import path from "node:path";

export interface BackupResult {
  dir: string;
  files: number;
  pruned: string[];
}

function linkTree(src: string, dest: string): number {
  if (!existsSync(src)) return 0;
  mkdirSync(dest, { recursive: true });
  let n = 0;
  for (const name of readdirSync(src)) {
    const s = path.join(src, name);
    const d = path.join(dest, name);
    if (statSync(s).isDirectory()) n += linkTree(s, d);
    else {
      try {
        linkSync(s, d);
      } catch {
        copyFileSync(s, d); // different filesystem: fall back to a copy
      }
      n++;
    }
  }
  return n;
}

export async function backupDataDir(dataDir: string, opts: { keep: number; now?: Date }): Promise<BackupResult> {
  const now = opts.now ?? new Date();
  const root = path.join(dataDir, "backups");
  const dir = path.join(root, `snapshot-${now.toISOString().replace(/[:.]/g, "-")}`);
  mkdirSync(dir, { recursive: true });
  let files = 0;
  for (const name of ["pipeline.db", "benchmark.db"]) {
    const file = path.join(dataDir, name);
    if (!existsSync(file)) continue;
    const db = new Database(file, { readonly: true, fileMustExist: true });
    try {
      await db.backup(path.join(dir, name));
      files++;
    } finally {
      db.close();
    }
  }
  for (const name of ["peer-groups.json", "discovery.json"]) {
    if (existsSync(path.join(dataDir, name))) {
      copyFileSync(path.join(dataDir, name), path.join(dir, name));
      files++;
    }
  }
  if (existsSync(path.join(dataDir, "companies"))) {
    cpSync(path.join(dataDir, "companies"), path.join(dir, "companies"), { recursive: true });
    files += readdirSync(path.join(dataDir, "companies")).length;
  }
  files += linkTree(path.join(dataDir, "uploads"), path.join(dir, "uploads"));

  const snapshots = readdirSync(root).filter((n) => /^snapshot-\d{4}-\d{2}-\d{2}T/.test(n)).sort();
  const pruned = snapshots.slice(0, Math.max(0, snapshots.length - Math.max(1, opts.keep)));
  for (const n of pruned) rmSync(path.join(root, n), { recursive: true, force: true });
  return { dir, files, pruned };
}
