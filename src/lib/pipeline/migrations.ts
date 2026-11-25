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
  {
    version: 2,
    name: "phase 4: discovery, crawl runs, alerts, robots cache",
    sql: `
CREATE TABLE discovered_documents (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id TEXT NOT NULL,
  url TEXT NOT NULL UNIQUE,
  final_url TEXT,
  origin TEXT NOT NULL,            -- crawl | sec
  source_page TEXT,
  title TEXT NOT NULL,
  report_type TEXT NOT NULL,       -- guessed: sustainability_report | annual_report | esg_data_book | regulatory_filing
  year INTEGER,                    -- year printed in the link or file name, if any
  language TEXT NOT NULL,
  official INTEGER NOT NULL,       -- final URL on the company's allow-listed domains
  content_type TEXT,
  content_length INTEGER,
  etag TEXT,
  last_modified TEXT,
  sha256 TEXT,
  document_id INTEGER REFERENCES documents(id),
  status TEXT NOT NULL,            -- new | awaiting_fetch | fetched | skipped | blocked | failed
  first_seen TEXT NOT NULL,
  last_checked TEXT NOT NULL,
  last_changed TEXT,
  error TEXT
);
CREATE INDEX discovered_company ON discovered_documents(company_id, status);

CREATE TABLE crawl_runs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  started_at TEXT NOT NULL,
  finished_at TEXT,
  trigger TEXT NOT NULL,           -- schedule | manual | test
  companies TEXT NOT NULL,         -- JSON array
  pages_read INTEGER NOT NULL DEFAULT 0,
  found INTEGER NOT NULL DEFAULT 0,
  fetched INTEGER NOT NULL DEFAULT 0,
  alerts INTEGER NOT NULL DEFAULT 0,
  error TEXT
);

CREATE TABLE alerts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  created_at TEXT NOT NULL,
  company_id TEXT,
  kind TEXT NOT NULL,              -- new_report | changed_report | restatement | blocked | fetch_failed | source_changed
  title TEXT NOT NULL,
  details TEXT,
  url TEXT,
  document_id INTEGER,
  extraction_id INTEGER,
  dedupe_key TEXT NOT NULL,
  status TEXT NOT NULL,            -- open | acknowledged
  acknowledged_by TEXT,
  acknowledged_at TEXT
);
CREATE INDEX alerts_status ON alerts(status, created_at);
CREATE INDEX alerts_dedupe ON alerts(dedupe_key, status);

CREATE TABLE robots_cache (
  origin TEXT PRIMARY KEY,
  fetched_at TEXT NOT NULL,
  status INTEGER NOT NULL,
  body TEXT
);
`,
  },
  {
    version: 3,
    name: "accounts: users, sessions, one-time links, login throttle",
    sql: `
-- Phase 5: email + password accounts with roles. Passwords are stored as
-- scrypt hashes; session and link tokens only as SHA-256 hashes.
CREATE TABLE users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  email TEXT NOT NULL UNIQUE COLLATE NOCASE,
  name TEXT NOT NULL UNIQUE COLLATE NOCASE,   -- shown in the audit trail and approvals
  role TEXT NOT NULL CHECK (role IN ('admin', 'reviewer', 'viewer')),
  password_hash TEXT,                         -- NULL until the invite link is used
  created_at TEXT NOT NULL,
  created_by TEXT NOT NULL,
  disabled_at TEXT,
  failed_logins INTEGER NOT NULL DEFAULT 0,
  locked_until TEXT,
  last_login_at TEXT,
  password_changed_at TEXT
);
CREATE TABLE sessions (
  token_hash TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id),
  created_at TEXT NOT NULL,
  last_seen_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,                   -- absolute limit
  ip TEXT,
  user_agent TEXT
);
CREATE INDEX sessions_user ON sessions(user_id);
CREATE TABLE account_links (
  token_hash TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id),
  purpose TEXT NOT NULL CHECK (purpose IN ('invite', 'reset')),
  created_by TEXT NOT NULL,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  used_at TEXT
);
CREATE INDEX account_links_user ON account_links(user_id);
CREATE TABLE login_throttle (
  key TEXT PRIMARY KEY,                       -- "ip:<address>"
  window_start TEXT NOT NULL,
  attempts INTEGER NOT NULL
);
`,
  },
  {
    version: 4,
    name: "news and controversy signals (GDELT), reviewed before display",
    sql: `
-- Phase 6: news items are secondary, low-confidence sources (rule 7). Found
-- items wait as 'pending'; only reviewer-approved items are shown publicly,
-- always labelled, and never used in scores.
CREATE TABLE news_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id TEXT NOT NULL,
  url TEXT NOT NULL,
  title TEXT NOT NULL,
  domain TEXT,
  language TEXT,
  source_country TEXT,
  seen_at TEXT,                  -- GDELT "seendate", ISO
  topics TEXT,                   -- JSON array of matched topic words
  origin TEXT NOT NULL,          -- 'gdelt'
  status TEXT NOT NULL CHECK (status IN ('pending', 'approved', 'rejected')),
  reviewer TEXT,
  reviewed_at TEXT,
  note TEXT,                     -- reviewer's one-line context, shown publicly with approved items
  first_seen TEXT NOT NULL,
  UNIQUE (company_id, url)
);
CREATE INDEX news_items_company ON news_items(company_id, status);
`,
  },
];
