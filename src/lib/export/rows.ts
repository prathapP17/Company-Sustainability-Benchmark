/**
 * Flat export rows with full provenance. `internal_note` is deliberately
 * absent: reviewer-only notes never leave the database (tested).
 */
import "server-only";
import { allMetricValues, allSources, listCompanies } from "../db/queries";
import { getMetric } from "../metrics/dictionary";
import { fiscalLabel } from "../fiscal";

export const VALUE_COLUMNS = [
  "company_id",
  "company",
  "peer_group",
  "metric_id",
  "metric",
  "year_label",
  "fiscal_year",
  "period_end",
  "state",
  "value",
  "text",
  "unit",
  "canonical_value",
  "canonical_unit",
  "boundary",
  "consolidation",
  "scope2_method",
  "coverage",
  "status",
  "trend_break",
  "assurance_level",
  "assurance_provider",
  "verification_class",
  "low_confidence",
  "source_id",
  "source_title",
  "source_url",
  "page",
  "reported_wording",
  "note",
] as const;

export type ValueRow = Record<(typeof VALUE_COLUMNS)[number], string | number | null>;

export function valueRows(): ValueRow[] {
  const companies = new Map(listCompanies().map((c) => [c.id, c]));
  const sources = new Map(allSources().map((s) => [`${s.company_id}/${s.id}`, s]));
  return allMetricValues().map((v) => {
    const c = companies.get(v.company_id)!;
    const s = v.source_id ? sources.get(`${v.company_id}/${v.source_id}`) : undefined;
    return {
      company_id: v.company_id,
      company: c.name,
      peer_group: c.peer_group_name,
      metric_id: v.metric_id,
      metric: getMetric(v.metric_id).label,
      year_label: v.year,
      fiscal_year: fiscalLabel({ end: c.fy_end, labelConvention: c.fy_label_convention }, v.year),
      period_end: v.period_end,
      state: v.state,
      value: v.value,
      text: v.text,
      unit: v.unit,
      canonical_value: v.canonical_value,
      canonical_unit: v.canonical_unit,
      boundary: v.boundary,
      consolidation: v.consolidation,
      scope2_method: v.scope2_method,
      coverage: v.coverage,
      status: v.status,
      trend_break: v.trend_break ? "yes" : "no",
      assurance_level: v.assurance_level,
      assurance_provider: v.assurance_provider,
      verification_class: v.verification_class,
      low_confidence: v.low_confidence ? "yes" : "no",
      source_id: v.source_id,
      source_title: s?.title ?? null,
      source_url: s?.url ?? null,
      page: v.page,
      reported_wording: v.reported_wording,
      note: v.note,
    };
  });
}

/** RFC 4180 CSV with spreadsheet formula-injection protection on text cells. */
export function toCsv(columns: readonly string[], rows: Record<string, string | number | null>[]): string {
  const esc = (x: string | number | null) => {
    if (x === null || x === undefined) return "";
    if (typeof x === "number") return String(x);
    let s = x;
    if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
    return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const lines = [columns.join(","), ...rows.map((r) => columns.map((c) => esc(r[c])).join(","))];
  // BOM so Excel opens UTF-8 (é, ₂) correctly.
  return "﻿" + lines.join("\r\n") + "\r\n";
}
