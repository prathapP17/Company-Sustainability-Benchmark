/**
 * Schema migrations for the curated benchmark database.
 *
 * Rule 9: schema changes are ADDITIVE ONLY. Never edit or remove an applied
 * migration; append a new one. Allowed: CREATE TABLE/INDEX/VIEW, ALTER TABLE
 * ... ADD COLUMN. A unit test rejects DROP, RENAME and DELETE statements here.
 */
export interface Migration {
  version: number;
  name: string;
  sql: string;
}

export const MIGRATIONS: Migration[] = [
  {
    version: 1,
    name: "initial curated schema",
    sql: `
CREATE TABLE peer_groups (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT NOT NULL,
  sasb_industries TEXT NOT NULL -- JSON array
);

CREATE TABLE companies (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  legal_name TEXT NOT NULL,
  peer_group TEXT NOT NULL REFERENCES peer_groups(id),
  region TEXT NOT NULL,
  country TEXT NOT NULL,
  city TEXT NOT NULL,
  lat REAL NOT NULL,
  lon REAL NOT NULL,
  gics TEXT NOT NULL,
  sasb TEXT NOT NULL,
  fy_end TEXT NOT NULL,
  fy_label_convention TEXT NOT NULL,
  fy_note TEXT,
  website TEXT NOT NULL,
  sustainability_page TEXT,
  research_status TEXT NOT NULL,
  research_notes TEXT,
  last_reviewed TEXT NOT NULL,
  listings TEXT NOT NULL,            -- JSON
  frameworks TEXT NOT NULL,          -- JSON
  comparability_notes TEXT NOT NULL, -- JSON
  file_hash TEXT NOT NULL
);

CREATE TABLE sources (
  company_id TEXT NOT NULL REFERENCES companies(id),
  id TEXT NOT NULL,
  organisation TEXT NOT NULL,
  title TEXT NOT NULL,
  type TEXT NOT NULL,
  url TEXT NOT NULL,
  accessed TEXT NOT NULL,
  reporting_year INTEGER,
  verification_class TEXT NOT NULL,
  notes TEXT,
  PRIMARY KEY (company_id, id)
);

CREATE TABLE reports (
  company_id TEXT NOT NULL REFERENCES companies(id),
  year INTEGER NOT NULL,
  type TEXT NOT NULL,
  source_id TEXT,
  assurance_level TEXT NOT NULL,
  assurance_provider TEXT,
  assurance_scope TEXT
);

CREATE TABLE metric_values (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id TEXT NOT NULL REFERENCES companies(id),
  metric_id TEXT NOT NULL,
  year INTEGER NOT NULL,          -- company's own fiscal-year label
  period_end TEXT NOT NULL,       -- ISO date the fiscal year ends
  state TEXT NOT NULL CHECK (state IN ('disclosed','not_disclosed','not_found','not_assessed')),
  value REAL,
  text TEXT,
  unit TEXT,
  canonical_value REAL,
  canonical_unit TEXT,
  boundary TEXT NOT NULL,
  consolidation TEXT NOT NULL,
  scope2_method TEXT,
  coverage TEXT,
  assurance_level TEXT NOT NULL,
  assurance_provider TEXT,
  verification_class TEXT NOT NULL,
  status TEXT NOT NULL,
  low_confidence INTEGER NOT NULL DEFAULT 0,
  source_id TEXT,
  page TEXT,
  reported_wording TEXT,
  note TEXT,
  -- Missing is not zero: non-disclosed states can never carry a value.
  CHECK (state = 'disclosed' OR (value IS NULL AND text IS NULL))
);
CREATE INDEX metric_values_company ON metric_values(company_id, metric_id, year);
CREATE INDEX metric_values_metric ON metric_values(metric_id, year);

CREATE TABLE targets (
  company_id TEXT NOT NULL REFERENCES companies(id),
  id TEXT NOT NULL,
  category TEXT NOT NULL,
  type TEXT NOT NULL,
  description TEXT NOT NULL,
  scopes TEXT,                    -- JSON
  baseline_year INTEGER, baseline_value REAL, baseline_unit TEXT,
  target_year INTEGER NOT NULL, target_value REAL, target_unit TEXT,
  latest_year INTEGER, latest_value REAL, latest_unit TEXT,
  validation TEXT NOT NULL,
  source_id TEXT NOT NULL,
  page TEXT NOT NULL,
  note TEXT,
  PRIMARY KEY (company_id, id)
);

CREATE TABLE data_gaps (
  company_id TEXT NOT NULL REFERENCES companies(id),
  metric_id TEXT,
  year INTEGER,
  kind TEXT NOT NULL,
  description TEXT NOT NULL,
  source_id TEXT,
  page TEXT
);

CREATE TABLE company_coverage (
  company_id TEXT PRIMARY KEY REFERENCES companies(id),
  year INTEGER,
  total INTEGER NOT NULL,
  disclosed INTEGER NOT NULL,
  not_disclosed INTEGER NOT NULL,
  not_found INTEGER NOT NULL,
  not_assessed INTEGER NOT NULL
);

CREATE TABLE seed_runs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  at TEXT NOT NULL,
  companies INTEGER NOT NULL,
  metric_values INTEGER NOT NULL,
  data_hash TEXT NOT NULL
);
`,
  },
  {
    version: 2,
    name: "phase 2: trend breaks, internal notes, scores",
    sql: `
ALTER TABLE metric_values ADD COLUMN trend_break INTEGER NOT NULL DEFAULT 0;
ALTER TABLE metric_values ADD COLUMN internal_note TEXT;

CREATE TABLE company_scores (
  company_id TEXT PRIMARY KEY REFERENCES companies(id),
  transparency_score REAL,
  transparency_met INTEGER NOT NULL,
  transparency_applicable INTEGER NOT NULL,
  transparency_reason TEXT,
  performance_score REAL,
  performance_available INTEGER NOT NULL,
  performance_reason TEXT
);

CREATE TABLE transparency_items (
  company_id TEXT NOT NULL REFERENCES companies(id),
  item_id TEXT NOT NULL,
  label TEXT NOT NULL,
  item_group TEXT NOT NULL,
  met INTEGER,                    -- 1 met, 0 not met, NULL not assessable
  evidence TEXT,
  PRIMARY KEY (company_id, item_id)
);

CREATE TABLE performance_indicators (
  company_id TEXT NOT NULL REFERENCES companies(id),
  indicator_id TEXT NOT NULL,
  label TEXT NOT NULL,
  raw_value REAL,
  raw_unit TEXT,
  score REAL,
  detail TEXT,
  PRIMARY KEY (company_id, indicator_id)
);
`,
  },
];
