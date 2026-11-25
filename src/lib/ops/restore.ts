/**
 * Restore drill (phase 7): proves a snapshot is usable without touching the
 * live data. Copies the snapshot into a temporary folder, then checks:
 *  - both databases pass SQLite's integrity check and open with their tables;
 *  - the curated company files validate, and benchmark.db re-seeds from them;
 *  - every uploaded file still matches the SHA-256 in its name.
 */
import Database from "better-sqlite3";
import { createHash } from "node:crypto";
import { cpSync, existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { loadCompanies } from "../data/load";
import { seed } from "../db/seed";

export interface DrillResult {
  snapshot: string;
  ok: boolean;
  checks: { name: string; ok: boolean; detail: string }[];
}

export function latestSnapshot(dataDir: string): string | null {
  const root = path.join(dataDir, "backups");
  if (!existsSync(root)) return null;
  const snaps = readdirSync(root).filter((n) => /^snapshot-\d{4}-\d{2}-\d{2}T/.test(n)).sort();
  return snaps.length ? path.join(root, snaps.at(-1)!) : null;
}

function files(dir: string): string[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir).flatMap((n) => {
    const p = path.join(dir, n);
    return statSync(p).isDirectory() ? files(p) : [p];
  });
}

export function restoreDrill(snapshotDir: string): DrillResult {
  const checks: DrillResult["checks"] = [];
  const add = (name: string, ok: boolean, detail: string) => checks.push({ name, ok, detail });
  const target = mkdtempSync(path.join(tmpdir(), "csi-restore-"));
  try {
    cpSync(snapshotDir, target, { recursive: true });

    for (const [name, table] of [["pipeline.db", "audit_log"], ["benchmark.db", "companies"]] as const) {
      const file = path.join(target, name);
      if (!existsSync(file)) {
        add(name, false, "missing from snapshot");
        continue;
      }
      const db = new Database(file, { readonly: true });
      try {
        const integrity = (db.pragma("integrity_check") as { integrity_check: string }[]).map((r) => r.integrity_check).join("; ");
        const rows = (db.prepare(`SELECT count(*) n FROM ${table}`).get() as { n: number }).n;
        add(name, integrity === "ok", `integrity ${integrity}; ${rows} rows in ${table}`);
      } catch (e) {
        add(name, false, (e as Error).message);
      } finally {
        db.close();
      }
    }

    try {
      const { companies, issues } = loadCompanies(target);
      const errors = issues.filter((i) => i.level === "error").length;
      add("company files", errors === 0 && companies.length > 0, `${companies.length} companies, ${errors} validation errors`);
      // Re-seed into a fresh database to prove the curated data rebuilds.
      rmSync(path.join(target, "benchmark.db"), { force: true });
      const s = seed(target);
      add("re-seed", s.companies === companies.length, `${s.companies} companies, ${s.metricValues} values`);
    } catch (e) {
      add("company files", false, (e as Error).message);
    }

    const uploads = files(path.join(target, "uploads"));
    const bad = uploads.filter((f) => {
      const want = path.basename(f).split(".")[0];
      return /^[0-9a-f]{64}$/.test(want) && createHash("sha256").update(readFileSync(f)).digest("hex") !== want;
    });
    add("uploads", bad.length === 0, `${uploads.length} files${bad.length ? `, ${bad.length} do not match their checksum` : ", all match their checksum"}`);
  } finally {
    rmSync(target, { recursive: true, force: true });
  }
  return { snapshot: snapshotDir, ok: checks.every((c) => c.ok), checks };
}
