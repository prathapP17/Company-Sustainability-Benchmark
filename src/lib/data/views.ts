/**
 * Server-side view models shared by comparison, peer and export pages.
 * Internal notes are never included here (they stay in the DB only).
 */
import "server-only";
import { allMetricValues, allSources, listCompanies, type CompanyRow, type MetricValueRow } from "../db/queries";
import { METRICS, metricAppliesTo } from "../metrics/dictionary";
import { fiscalLabel } from "../fiscal";
import { formatReported } from "../format";

export interface CellValue {
  companyId: string;
  metricId: string;
  year: number;
  fyLabel: string;
  state: MetricValueRow["state"];
  display: string;
  canonical: number | null;
  canonicalUnit: string | null;
  boundary: string;
  consolidation: string;
  scope2Method: string | null;
  coverage: string | null;
  status: "reported" | "derived";
  lowConfidence: boolean;
  trendBreak: boolean;
  sourceUrl: string | null;
  sourceId: string | null;
  page: string | null;
}

export interface CompanyMeta {
  id: string;
  name: string;
  peerGroup: string;
  peerGroupName: string;
  researchStatus: string;
}

export interface MetricMeta {
  id: string;
  label: string;
  category: string;
  canonicalUnit: string;
  appliesTo: "all" | string[];
  core: boolean;
}

export function companyMeta(c: CompanyRow): CompanyMeta {
  return { id: c.id, name: c.name, peerGroup: c.peer_group, peerGroupName: c.peer_group_name, researchStatus: c.research_status };
}

export function metricMeta(): MetricMeta[] {
  return METRICS.map((m) => ({ id: m.id, label: m.label, category: m.category, canonicalUnit: m.canonicalUnit, appliesTo: m.appliesTo, core: m.core }));
}

/** Latest-year entry per company and metric (consolidated-group value preferred within a year). */
export function latestCells(): { companies: CompanyMeta[]; metrics: MetricMeta[]; cells: CellValue[] } {
  const companies = listCompanies();
  const byId = new Map(companies.map((c) => [c.id, c]));
  const sources = new Map(allSources().map((s) => [`${s.company_id}/${s.id}`, s]));
  const best = new Map<string, MetricValueRow>();
  for (const v of allMetricValues()) {
    const key = `${v.company_id}/${v.metric_id}`;
    const cur = best.get(key);
    const better =
      !cur ||
      v.year > cur.year ||
      (v.year === cur.year && cur.boundary !== "consolidated_group" && v.boundary === "consolidated_group");
    if (better) best.set(key, v);
  }
  const cells: CellValue[] = [...best.values()].map((v) => {
    const c = byId.get(v.company_id)!;
    const src = v.source_id ? sources.get(`${v.company_id}/${v.source_id}`) : undefined;
    return {
      companyId: v.company_id,
      metricId: v.metric_id,
      year: v.year,
      fyLabel: fiscalLabel({ end: c.fy_end, labelConvention: c.fy_label_convention }, v.year),
      state: v.state,
      display: v.state === "disclosed" ? formatReported(v.value, v.unit, v.text) : "",
      canonical: v.canonical_value,
      canonicalUnit: v.canonical_unit,
      boundary: v.boundary,
      consolidation: v.consolidation,
      scope2Method: v.scope2_method,
      coverage: v.coverage,
      status: v.status,
      lowConfidence: v.low_confidence === 1,
      trendBreak: v.trend_break === 1,
      sourceUrl: src?.url ?? null,
      sourceId: v.source_id,
      page: v.page,
    };
  });
  return { companies: companies.map(companyMeta), metrics: metricMeta(), cells };
}

export function applicableMetrics(peerGroup: string) {
  return METRICS.filter((m) => metricAppliesTo(m, peerGroup));
}
