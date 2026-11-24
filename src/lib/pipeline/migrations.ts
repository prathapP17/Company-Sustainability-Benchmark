/**
 * Pipeline database migrations (uploads, pages, jobs, extractions, audit).
 * Separate from the curated benchmark DB. Rule 9: additive only; a test
 * rejects destructive statements. Never reset this database: it holds the
 * audit trail.
 */
import type { Migration } from "../db/migrations";

export const PIPELINE_MIGRATIONS: Migration[] = [
  {
    version: 1,
    name: "pipeline: documents, pages, jobs, extractions, audit",
    sql: `
CREATE TABLE documents (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  sha256 TEXT NOT NULL UNIQUE,
  company_id TEXT NOT NULL,
  filename TEXT NOT NULL,
  mime TEXT NOT NULL,
  size_bytes INTEGER NOT NULL,
  stored_path TEXT NOT NULL,
  title TEXT NOT NULL,
  source_url TEXT,
  report_type TEXT NOT NULL,
  reporting_year INTEGER,
  verification_class TEXT NOT NULL,
  language TEXT,
  page_count INTEGER,
  scanned_pages TEXT,             -- JSON array of page numbers with no text layer
  status TEXT NOT NULL,           -- uploaded | text_extracted | extracted | failed
  error TEXT,
  uploaded_by TEXT NOT NULL,
  uploaded_at TEXT NOT NULL
);

CREATE TABLE pages (
  document_id INTEGER NOT NULL REFERENCES documents(id),
  page_number INTEGER NOT NULL,   -- PDF page, or 1-based sheet index for spreadsheets
  label TEXT NOT NULL,            -- "PDF p.12", "XHTML page 40", "Sheet: GHG"
  text TEXT NOT NULL,
  cells TEXT,                     -- JSON {"A1": "...", ...} for spreadsheet sheets
  is_scanned INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (document_id, page_number)
);

CREATE TABLE jobs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  document_id INTEGER NOT NULL REFERENCES documents(id),
  kind TEXT NOT NULL,             -- extract_text | extract_rules | extract_ai
  status TEXT NOT NULL,           -- queued | running | done | failed
  attempts INTEGER NOT NULL DEFAULT 0,
  max_attempts INTEGER NOT NULL DEFAULT 3,
  run_after TEXT NOT NULL,
  worker_id TEXT,
  started_at TEXT,
  heartbeat_at TEXT,
  finished_at TEXT,
  error TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX jobs_status ON jobs(status, run_after);

CREATE TABLE extractions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  document_id INTEGER NOT NULL REFERENCES documents(id),
  company_id TEXT NOT NULL,
  metric_id TEXT NOT NULL,
  year INTEGER NOT NULL,
  value REAL,
  text_value TEXT,
  unit TEXT,
  page_number INTEGER NOT NULL,
  page_label TEXT NOT NULL,
  cell TEXT,                      -- "Sheet!E12" for spreadsheets
  reported_wording TEXT NOT NULL,
  boundary TEXT NOT NULL,
  consolidation TEXT NOT NULL,
  scope2_method TEXT,
  method TEXT NOT NULL,           -- rule | ai
  confidence REAL NOT NULL,
  evidence_status TEXT NOT NULL,  -- verified | failed
  evidence_detail TEXT,
  status TEXT NOT NULL,           -- pending | blocked | approved | rejected | superseded
  conflict TEXT,                  -- JSON describing a clash with curated data
  reviewer TEXT,
  reviewed_at TEXT,
  review_reason TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX extractions_doc ON extractions(document_id, status);

-- Append-only audit trail (rule 8). Updates and deletes are refused by triggers.
CREATE TABLE audit_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  at TEXT NOT NULL,
  actor TEXT NOT NULL,
  action TEXT NOT NULL,
  entity TEXT NOT NULL,
  entity_id TEXT,
  details TEXT
);
CREATE TRIGGER audit_log_no_update BEFORE UPDATE ON audit_log
BEGIN SELECT RAISE(ABORT, 'audit_log is append-only'); END;
CREATE TRIGGER audit_log_no_delete BEFORE DELETE ON audit_log
BEGIN SELECT RAISE(ABORT, 'audit_log is append-only'); END;
`,
  },
];
