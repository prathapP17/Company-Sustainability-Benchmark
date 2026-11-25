/**
 * What the dashboard map shows, built on the server from the curated
 * database only. Every value keeps its fiscal-year label, boundary, coverage,
 * source and page; a metric with no entry is "not assessed", never zero.
 * Whether a value could enter a cross-company calculation is decided by the
 * comparability engine, not here.
 */
import "server-only";
import { allSources, listCompanies, type CompanyRow } from "../db/queries";
import { latestCells, type CellValue } from "../data/views";
import { METRICS, metricAppliesTo } from "../metrics/dictionary";
import { fiscalLabel } from "../fiscal";
import { formatCompact } from "../format";
import { valueIssues } from "../scoring/comparability";
import { industryName } from "../industry";
import { placeOnMap } from "./geo";

export type MapState = "disclosed" | "not_disclosed" | "not_found" | "not_assessed";

export interface MapCell {
  state: MapState;
  /** Formatted canonical value (e.g. "55.2 kt CO2e"), only when disclosed. */
  display: string | null;
  reported: string | null;
  fyLabel: string | null;
  /** Calendar year the reporting period ends in. */
  periodYear: number | null;
  boundary: string | null;
  coverage: string | null;
  derived: boolean;
  lowConfidence: boolean;
  /** Reasons this value cannot enter cross-company calculations (comparability engine). Empty = usable. */
  issues: string[];
  sourceTitle: string | null;
  sourceUrl: string | null;
  page: string | null;
}

export interface MapCompany {
  id: string;
  name: string;
  city: string;
  country: string;
  region: string;
  /** Position on the map, or null with the reason (coordinates are never guessed). */
  pos: { x: number; y: number } | null;
  unplacedReason: string | null;
  gics: string;
  sasb: string;
  industries: { code: string; label: string }[];
  primaryIndustry: string | null;
  classificationReview: string | null;
  peerGroupId: string;
  peerGroupName: string;
  listings: { exchange: string; ticker: string }[];
  researchStatus: "detailed" | "partial" | "profile_only";
  latestYearLabel: string | null;
  lastReviewed: string;
  coverage: { disclosed: number; notDisclosed: number; notFound: number; notAssessed: number; total: number };
  /** Metric ids that apply to this company (its SASB industries). */
  applicable: string[];
  cells: Record<string, MapCell>;
}

export interface MapMetric {
  id: string;
  label: string;
  group: "Core" | "More" | "Industry-specific";
  unit: string;
  /** SASB codes for industry metrics; "all" otherwise. */
  appliesTo: "all" | string[];
}

const MAP_METRICS = METRICS.filter((m) => !/^ghg_scope3_c/.test(m.id));

export function mapMetrics(): MapMetric[] {
  return MAP_METRICS.map((m) => ({
    id: m.id,
    label: m.label,
    group: m.core ? "Core" : m.category === "industry" ? "Industry-specific" : "More",
    unit: m.canonicalUnit,
    appliesTo: m.appliesTo,
  }));
}

function cellOf(c: CellValue | undefined, sources: Map<string, { title: string; url: string }>): MapCell {
  if (!c) {
    return { state: "not_assessed", display: null, reported: null, fyLabel: null, periodYear: null, boundary: null, coverage: null, derived: false, lowConfidence: false, issues: [], sourceTitle: null, sourceUrl: null, page: null };
  }
  const src = c.sourceId ? sources.get(`${c.companyId}/${c.sourceId}`) : undefined;
  const disclosed = c.state === "disclosed";
  return {
    state: c.state,
    display: disclosed ? (c.canonical !== null ? formatCompact(c.canonical, c.canonicalUnit) : c.display) : null,
    reported: disclosed ? c.display : null,
    fyLabel: c.fyLabel,
    periodYear: Number(c.periodEnd.slice(0, 4)),
    boundary: c.boundary,
    coverage: c.coverage,
    derived: c.status === "derived",
    lowConfidence: c.lowConfidence,
    issues: disclosed ? valueIssues({ ...c, metricId: c.metricId }) : [],
    sourceTitle: src?.title ?? null,
    sourceUrl: src && /^https?:/.test(src.url) ? src.url : null,
    page: c.page,
  };
}

export function mapCompanies(): MapCompany[] {
  const rows = listCompanies();
  const { cells } = latestCells();
  const sources = new Map(allSources().map((s) => [`${s.company_id}/${s.id}`, { title: s.title, url: s.url }]));
  const byKey = new Map(cells.map((c) => [`${c.companyId}/${c.metricId}`, c]));
  return rows.map((r: CompanyRow) => {
    const codes: string[] = r.sasb_codes ? JSON.parse(r.sasb_codes) : [];
    const placed = placeOnMap(r.lat, r.lon);
    const applicable = MAP_METRICS.filter((m) => metricAppliesTo(m, codes)).map((m) => m.id);
    return {
      id: r.id,
      name: r.name,
      city: r.city,
      country: r.country,
      region: r.region,
      pos: "problem" in placed ? null : placed,
      unplacedReason: "problem" in placed ? placed.problem : null,
      gics: r.gics,
      sasb: r.sasb,
      industries: codes.map((code) => ({ code, label: industryName(code) })),
      primaryIndustry: r.primary_sasb,
      classificationReview: r.classification_review,
      peerGroupId: r.peer_group,
      peerGroupName: r.peer_group_name,
      listings: JSON.parse(r.listings),
      researchStatus: r.research_status,
      latestYearLabel: r.cov_year ? fiscalLabel({ end: r.fy_end, labelConvention: r.fy_label_convention }, r.cov_year) : null,
      lastReviewed: r.last_reviewed,
      coverage: { disclosed: r.cov_disclosed, notDisclosed: r.cov_not_disclosed, notFound: r.cov_not_found, notAssessed: r.cov_not_assessed, total: r.cov_total },
      applicable,
      cells: Object.fromEntries(applicable.map((id) => [id, cellOf(byKey.get(`${r.id}/${id}`), sources)])),
    };
  });
}
