import Database from "better-sqlite3";
import { copyFileSync, existsSync, mkdirSync } from "node:fs";
import path from "node:path";
import { MIGRATIONS } from "./migrations";
import { defaultDataDir } from "../data/load";

export type DB = Database.Database;

export function dbPath(dataDir: string = defaultDataDir()): string {
  return path.join(dataDir, "benchmark.db");
}

/** Read-only connection for pages. Throws if the database has not been seeded. */
export function openReadOnly(file: string = dbPath()): DB {
  // The DB path is runtime config (CSI_DATA_DIR); it must not make the bundler trace the whole project.
  if (!existsSync(/*turbopackIgnore: true*/ file)) {
    throw new Error(`Database not found at ${file}. Run "npm run seed" first.`);
  }
  const db = new Database(file, { readonly: true, fileMustExist: true });
  return db;
}

/** Read-write connection in WAL mode (seeding only). */
export function openWritable(file: string): DB {
  mkdirSync(path.dirname(file), { recursive: true });
  const db = new Database(file);
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");
  db.exec(`CREATE TABLE IF NOT EXISTS schema_migrations (
    version INTEGER PRIMARY KEY,
    name TEXT NOT NULL,
    applied_at TEXT NOT NULL
  )`);
  return db;
}

export function pendingMigrations(db: DB) {
  const applied = new Set(
    (db.prepare("SELECT version FROM schema_migrations").all() as { version: number }[]).map((r) => r.version),
  );
  return MIGRATIONS.filter((m) => !applied.has(m.version));
}

/**
 * Applies pending migrations. Rule 9: back up before migrating. The backup is
 * taken only when the database already holds data and a migration is pending.
 * Returns the backup path, if one was written.
 */
export function migrate(db: DB, file: string, now = new Date()): string | undefined {
  const pending = pendingMigrations(db);
  if (pending.length === 0) return undefined;
  let backup: string | undefined;
  const hasTables = (db.prepare("SELECT count(*) n FROM sqlite_master WHERE type='table' AND name='companies'").get() as { n: number }).n > 0;
  if (hasTables) {
    const dir = path.join(path.dirname(file), "backups");
    mkdirSync(dir, { recursive: true });
    backup = path.join(dir, `benchmark-${now.toISOString().replace(/[:.]/g, "-")}.db`);
    db.pragma("wal_checkpoint(TRUNCATE)");
    copyFileSync(file, backup);
  }
  const insert = db.prepare("INSERT INTO schema_migrations (version, name, applied_at) VALUES (?, ?, ?)");
  for (const m of pending) {
    db.transaction(() => {
      db.exec(m.sql);
      insert.run(m.version, m.name, now.toISOString());
    })();
  }
  return backup;
}
