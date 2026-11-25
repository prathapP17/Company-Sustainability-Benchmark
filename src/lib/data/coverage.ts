/**
 * Coverage of the core metric checklist per company (rule 2: missing is not
 * zero). A metric with no entry for the year counts as "not_assessed".
 */
import type { CompanyFile } from "../schema/company";
import type { DisclosureState } from "../schema/enums";
import { METRICS, metricAppliesTo } from "../metrics/dictionary";
import { latestDisclosedYear } from "../schema/validate";
import { classify } from "../industry";

export interface Coverage {
  year: number | undefined;
  total: number;
  counts: Record<DisclosureState, number>;
  /** Metrics with a conclusion (disclosed, not disclosed or not found). */
  assessed: number;
  byMetric: { metric: string; state: DisclosureState }[];
}

/** Minimum share of core metrics that must be assessed before any score is shown (phase 2). */
export const COVERAGE_THRESHOLD = 0.8;

export function coreMetricsFor(sasbCodes: readonly string[]) {
  return METRICS.filter((m) => m.core && metricAppliesTo(m, sasbCodes));
}

export function coverageFor(c: CompanyFile, year = latestDisclosedYear(c)): Coverage {
  const core = coreMetricsFor(classify(c.profile.industry).codes);
  const counts: Record<DisclosureState, number> = { disclosed: 0, not_disclosed: 0, not_found: 0, not_assessed: 0 };
  const byMetric = core.map((def) => {
    const entries = year === undefined ? [] : c.metrics.filter((m) => m.metric === def.id && m.year === year);
    // If any entry for the year is disclosed, the metric is disclosed.
    const order: DisclosureState[] = ["disclosed", "not_disclosed", "not_found", "not_assessed"];
    const state = order.find((s) => entries.some((e) => e.state === s)) ?? "not_assessed";
    counts[state]++;
    return { metric: def.id, state };
  });
  return {
    year,
    total: core.length,
    counts,
    assessed: counts.disclosed + counts.not_disclosed + counts.not_found,
    byMetric,
  };
}
