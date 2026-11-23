import { afterEach, describe, expect, it } from "vitest";
import Database from "better-sqlite3";
import { existsSync, readdirSync } from "node:fs";
import path from "node:path";
import { seed } from "@/lib/db/seed";
import { MIGRATIONS } from "@/lib/db/migrations";
import { migrate, openWritable } from "@/lib/db/connection";
import { baseCompany, REAL_DATA, tempDataDir, writeCompany } from "./helpers";

let cleanup: (() => void) | undefined;
afterEach(() => {
  cleanup?.();
  cleanup = undefined;
});

describe("seeding (temporary data directory only)", () => {
  it("never touches the real database", () => {
    const t = tempDataDir();
    cleanup = t.cleanup;
    const r = seed(t.dir);
    expect(r.dbFile.startsWith(t.dir)).toBe(true);
    expect(r.dbFile).not.toBe(path.join(REAL_DATA, "benchmark.db"));
  });

  it("seeds every company and is idempotent", () => {
    const t = tempDataDir();
    cleanup = t.cleanup;
    const a = seed(t.dir);
    const b = seed(t.dir);
    expect(b.metricValues).toBe(a.metricValues);
    const db = new Database(a.dbFile, { readonly: true });
    const n = (sql: string) => (db.prepare(sql).get() as { n: number }).n;
    expect(n("SELECT count(*) n FROM companies")).toBe(a.companies);
    expect(n("SELECT count(*) n FROM metric_values")).toBe(a.metricValues);
    expect(n("SELECT count(*) n FROM seed_runs")).toBe(2);
    expect((db.pragma("journal_mode", { simple: true }) as string).toLowerCase()).toBe("wal");
    db.close();
  });

  it("stores canonical values and the fiscal period end", () => {
    const t = tempDataDir();
    cleanup = t.cleanup;
    const r = seed(t.dir);
    const db = new Database(r.dbFile, { readonly: true });
    const toyota = db
      .prepare("SELECT canonical_value, period_end FROM metric_values WHERE company_id='toyota' AND metric_id='ghg_scope1' AND year=2025")
      .get() as { canonical_value: number; period_end: string };
    expect(toyota.canonical_value).toBe(2_466_000);
    expect(toyota.period_end).toBe("2026-03-31");
    db.close();
  });

  it("refuses to seed invalid data", () => {
    const t = tempDataDir();
    cleanup = t.cleanup;
    writeCompany(t.dir, baseCompany({ metrics: [{ metric: "ghg_scope1", year: 2025, state: "disclosed", value: 1, unit: "tCO2e" }] }));
    expect(() => seed(t.dir)).toThrow(/Refusing to seed/);
  });

  it("the database rejects a value on a non-disclosed state (missing is not zero)", () => {
    const t = tempDataDir();
    cleanup = t.cleanup;
    const r = seed(t.dir);
    const db = new Database(r.dbFile);
    expect(() =>
      db
        .prepare(
          `INSERT INTO metric_values (company_id, metric_id, year, period_end, state, value, boundary, consolidation,
           assurance_level, verification_class, status) VALUES ('apple','ghg_scope1',2030,'2030-09-27','not_found',0,
           'not_stated','not_stated','none','primary_document','reported')`,
        )
        .run(),
    ).toThrow(/CHECK constraint/);
    db.close();
  });
});

describe("migrations are additive only (rule 9)", () => {
  it("contain no destructive statements", () => {
    for (const m of MIGRATIONS) {
      expect(m.sql).not.toMatch(/\bDROP\b|\bRENAME\b|\bDELETE\s+FROM\b|\bTRUNCATE\b/i);
    }
  });

  it("versions are unique and increasing", () => {
    const v = MIGRATIONS.map((m) => m.version);
    expect([...v].sort((a, b) => a - b)).toEqual(v);
    expect(new Set(v).size).toBe(v.length);
  });

  it("backs up an existing database before applying a new migration", () => {
    const t = tempDataDir();
    cleanup = t.cleanup;
    const r = seed(t.dir);
    MIGRATIONS.push({ version: 9999, name: "test-only", sql: "CREATE TABLE test_only (x INTEGER);" });
    try {
      const db = openWritable(r.dbFile);
      const backup = migrate(db, r.dbFile);
      db.close();
      expect(backup).toBeDefined();
      expect(existsSync(backup!)).toBe(true);
      expect(readdirSync(path.join(t.dir, "backups")).length).toBe(1);
    } finally {
      MIGRATIONS.pop();
    }
  });
});
