/**
 * Read-only queries used by server components. All reads are synchronous
 * (better-sqlite3), so pages prerender at build time from the seeded file.
 */
import "server-only";
import type { DB } from "./connection";
import { openReadOnly } from "./connection";

let cached: DB | undefined;
function db(): DB {
  cached ??= openReadOnly();
  return cached;
}

export interface CompanyRow {
  id: string;
  name: string;
  legal_name: string;
  peer_group: string;
  peer_group_name: string;
  region: string;
  country: string;
  city: string;
  gics: string;
  sasb: string;
  fy_end: string;
  fy_label_convention: "end_year" | "start_year";
  fy_note: string | null;
  website: string;
  sustainability_page: string | null;
  research_status: "detailed" | "partial" | "profile_only";
  research_notes: string | null;
  last_reviewed: string;
  listings: string;
  frameworks: string;
  comparability_notes: string;
  cov_year: number | null;
  cov_total: number;
  cov_disclosed: number;
  cov_not_disclosed: number;
  cov_not_found: number;
  cov_not_assessed: number;
}

const COMPANY_SELECT = `
  SELECT c.*, p.name AS peer_group_name,
    cc.year AS cov_year, cc.total AS cov_total, cc.disclosed AS cov_disclosed,
    cc.not_disclosed AS cov_not_disclosed, cc.not_found AS cov_not_found, cc.not_assessed AS cov_not_assessed
  FROM companies c
  JOIN peer_groups p ON p.id = c.peer_group
  LEFT JOIN company_coverage cc ON cc.company_id = c.id`;

export function listCompanies(): CompanyRow[] {
  return db().prepare(`${COMPANY_SELECT} ORDER BY c.name`).all() as CompanyRow[];
}

export function getCompany(id: string): CompanyRow | undefined {
  return db().prepare(`${COMPANY_SELECT} WHERE c.id = ?`).get(id) as CompanyRow | undefined;
}

export function listCompanyIds(): string[] {
  return (db().prepare("SELECT id FROM companies ORDER BY id").all() as { id: string }[]).map((r) => r.id);
}

export interface PeerGroupRow {
  id: string;
  name: string;
  description: string;
  sasb_industries: string;
}

export function listPeerGroups(): PeerGroupRow[] {
  return db().prepare("SELECT * FROM peer_groups ORDER BY name").all() as PeerGroupRow[];
}

export interface MetricValueRow {
  id: number;
  company_id: string;
  metric_id: string;
  year: number;
  period_end: string;
  state: "disclosed" | "not_disclosed" | "not_found" | "not_assessed";
  value: number | null;
  text: string | null;
  unit: string | null;
  canonical_value: number | null;
  canonical_unit: string | null;
  boundary: string;
  consolidation: string;
  scope2_method: string | null;
  coverage: string | null;
  assurance_level: string;
  assurance_provider: string | null;
  verification_class: string;
  status: "reported" | "derived";
  low_confidence: number;
  source_id: string | null;
  page: string | null;
  reported_wording: string | null;
  note: string | null;
}

export function metricValuesFor(companyId: string): MetricValueRow[] {
  return db()
    .prepare("SELECT * FROM metric_values WHERE company_id = ? ORDER BY metric_id, year DESC")
    .all(companyId) as MetricValueRow[];
}

/** Latest-year value of each listed metric for every company (for the overview table). */
export function latestValues(metricIds: string[]): MetricValueRow[] {
  const placeholders = metricIds.map(() => "?").join(",");
  return db()
    .prepare(
      `SELECT mv.* FROM metric_values mv
       JOIN company_coverage cc ON cc.company_id = mv.company_id AND cc.year = mv.year
       WHERE mv.metric_id IN (${placeholders})`,
    )
    .all(...metricIds) as MetricValueRow[];
}

export interface SourceRow {
  company_id: string;
  id: string;
  organisation: string;
  title: string;
  type: string;
  url: string;
  accessed: string;
  reporting_year: number | null;
  verification_class: string;
  notes: string | null;
}

export function sourcesFor(companyId: string): SourceRow[] {
  return db().prepare("SELECT * FROM sources WHERE company_id = ? ORDER BY id").all(companyId) as SourceRow[];
}

export interface ReportRow {
  year: number;
  type: string;
  source_id: string | null;
  assurance_level: string;
  assurance_provider: string | null;
  assurance_scope: string | null;
}

export function reportsFor(companyId: string): ReportRow[] {
  return db().prepare("SELECT * FROM reports WHERE company_id = ? ORDER BY year DESC").all(companyId) as ReportRow[];
}

export interface TargetRow {
  id: string;
  category: string;
  type: string;
  description: string;
  scopes: string | null;
  baseline_year: number | null;
  baseline_value: number | null;
  baseline_unit: string | null;
  target_year: number;
  target_value: number | null;
  target_unit: string | null;
  latest_year: number | null;
  latest_value: number | null;
  latest_unit: string | null;
  validation: string;
  source_id: string;
  page: string;
  note: string | null;
}

export function targetsFor(companyId: string): TargetRow[] {
  return db().prepare("SELECT * FROM targets WHERE company_id = ? ORDER BY target_year, id").all(companyId) as TargetRow[];
}

export interface DataGapRow {
  metric_id: string | null;
  year: number | null;
  kind: string;
  description: string;
  source_id: string | null;
  page: string | null;
}

export function dataGapsFor(companyId: string): DataGapRow[] {
  return db().prepare("SELECT * FROM data_gaps WHERE company_id = ?").all(companyId) as DataGapRow[];
}

export interface Totals {
  companies: number;
  disclosed: number;
  sources: number;
  gaps: number;
  lastSeed: string | null;
}

export function totals(): Totals {
  const d = db();
  const one = (sql: string) => (d.prepare(sql).get() as { n: number }).n;
  return {
    companies: one("SELECT count(*) n FROM companies"),
    disclosed: one("SELECT count(*) n FROM metric_values WHERE state = 'disclosed'"),
    sources: one("SELECT count(*) n FROM sources"),
    gaps: one("SELECT count(*) n FROM data_gaps"),
    lastSeed: (d.prepare("SELECT max(at) at FROM seed_runs").get() as { at: string | null }).at,
  };
}
