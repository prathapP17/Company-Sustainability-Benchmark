/**
 * Pipeline database (data/pipeline.db): uploads, page text, jobs,
 * extractions and the append-only audit log. Opened read-write by the web
 * server's pipeline routes and by the worker (SQLite WAL handles both).
 */
import path from "node:path";
import { defaultDataDir } from "../data/load";
import { migrate, openWritable, type DB } from "../db/connection";
import { PIPELINE_MIGRATIONS } from "./migrations";

export function pipelinePath(dataDir: string = defaultDataDir()): string {
  return path.join(dataDir, "pipeline.db");
}

export function uploadsDir(dataDir: string = defaultDataDir()): string {
  return path.join(dataDir, "uploads");
}

const open = new Map<string, DB>();

/** Opens (once per process) and migrates the pipeline DB for a data dir. */
export function pipelineDb(dataDir: string = defaultDataDir()): DB {
  const file = pipelinePath(dataDir);
  let db = open.get(file);
  if (!db) {
    db = openWritable(file);
    db.pragma("busy_timeout = 5000");
    migrate(db, file, new Date(), PIPELINE_MIGRATIONS, "pipeline");
    open.set(file, db);
  }
  return db;
}

/** For tests: close cached connections. */
export function closePipelineDbs() {
  for (const db of open.values()) db.close();
  open.clear();
}

export const nowIso = () => new Date().toISOString();

export function audit(
  db: DB,
  actor: string,
  action: string,
  entity: string,
  entityId: string | number | null,
  details?: Record<string, unknown>,
) {
  db.prepare("INSERT INTO audit_log (at, actor, action, entity, entity_id, details) VALUES (?, ?, ?, ?, ?, ?)").run(
    nowIso(),
    actor,
    action,
    entity,
    entityId === null ? null : String(entityId),
    details ? JSON.stringify(details) : null,
  );
}

export interface DocumentRow {
  id: number;
  sha256: string;
  company_id: string;
  filename: string;
  mime: string;
  size_bytes: number;
  stored_path: string;
  title: string;
  source_url: string | null;
  report_type: string;
  reporting_year: number | null;
  verification_class: string;
  language: string | null;
  page_count: number | null;
  scanned_pages: string | null;
  status: string;
  error: string | null;
  uploaded_by: string;
  uploaded_at: string;
}

export interface PageRow {
  document_id: number;
  page_number: number;
  label: string;
  text: string;
  cells: string | null;
  is_scanned: number;
}

export interface JobRow {
  id: number;
  document_id: number;
  kind: "extract_text" | "extract_rules" | "extract_ai";
  status: "queued" | "running" | "done" | "failed";
  attempts: number;
  max_attempts: number;
  run_after: string;
  worker_id: string | null;
  started_at: string | null;
  heartbeat_at: string | null;
  finished_at: string | null;
  error: string | null;
  created_at: string;
}

export interface ExtractionRow {
  id: number;
  document_id: number;
  company_id: string;
  metric_id: string;
  year: number;
  value: number | null;
  text_value: string | null;
  unit: string | null;
  page_number: number;
  page_label: string;
  cell: string | null;
  reported_wording: string;
  boundary: string;
  consolidation: string;
  scope2_method: string | null;
  method: "rule" | "ai";
  confidence: number;
  evidence_status: "verified" | "failed";
  evidence_detail: string | null;
  status: "pending" | "blocked" | "approved" | "rejected" | "superseded";
  conflict: string | null;
  reviewer: string | null;
  reviewed_at: string | null;
  review_reason: string | null;
  created_at: string;
}
