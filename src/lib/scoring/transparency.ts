/**
 * Transparency checklist and score. Measures what a company DISCLOSES and how
 * well it is evidenced, not how it performs. Each item is met (true), not met
 * (false) or not assessable (null, excluded from the denominator).
 *
 * Rule 2: the score is only calculated when at least COVERAGE_THRESHOLD of the
 * core metrics have been assessed.
 */
import type { CompanyFile } from "../schema/company";
import { coreMetricsFor, coverageFor, COVERAGE_THRESHOLD } from "../data/coverage";
import { getMetric, METRICS, metricAppliesTo } from "../metrics/dictionary";
import { classify } from "../industry";
import { resolveMetric, latestDisclosedYear } from "../schema/validate";

export type ItemGroup = "Core metrics" | "Depth" | "Assurance & boundary" | "Targets" | "Industry";

export interface ChecklistItem {
  id: string;
  label: string;
  group: ItemGroup;
  met: boolean | null;
  evidence: string;
}

export interface TransparencyResult {
  items: ChecklistItem[];
  met: number;
  applicable: number;
  score: number | null;
  reason?: string;
}

export const CHECKLIST_LABELS: { id: string; label: string; group: ItemGroup }[] = [
  ...[
    "ghg_scope1",
    "ghg_scope2_market",
    "ghg_scope2_location",
    "ghg_scope3_total",
    "energy_total",
    "renewable_electricity_share",
    "water_withdrawal",
    "waste_total",
  ].map((id) => ({ id: `core:${id}`, label: `${getMetric(id).label} disclosed`, group: "Core metrics" as const })),
  { id: "scope3_categories", label: "At least 5 Scope 3 categories quantified", group: "Depth" },
  { id: "prior_year", label: "Prior-year comparatives for at least 3 core metrics", group: "Depth" },
  { id: "ghg_assurance", label: "Third-party assurance on Scope 1 emissions", group: "Assurance & boundary" },
  { id: "reasonable_assurance", label: "Reasonable (not only limited) assurance on Scope 1", group: "Assurance & boundary" },
  { id: "group_boundary", label: "Core values reported for the consolidated group", group: "Assurance & boundary" },
  { id: "consolidation_stated", label: "GHG consolidation approach stated", group: "Assurance & boundary" },
  { id: "quantified_target", label: "Quantified GHG target with a baseline year", group: "Targets" },
  { id: "sbti", label: "GHG target validated by SBTi", group: "Targets" },
  { id: "net_zero", label: "Net-zero or carbon-neutral long-term goal", group: "Targets" },
  { id: "industry_metric", label: "At least one SASB metric for its own industry disclosed", group: "Industry" },
];

const LABEL = new Map(CHECKLIST_LABELS.map((x) => [x.id, x]));

export function transparency(c: CompanyFile): TransparencyResult {
  const year = latestDisclosedYear(c);
  const cov = coverageFor(c, year);
  const resolved = c.metrics.map((m) => resolveMetric(c, m));
  const latest = (id: string) => resolved.find((m) => m.metric === id && m.year === year);
  const items: ChecklistItem[] = [];
  const add = (id: string, met: boolean | null, evidence: string) => {
    const l = LABEL.get(id)!;
    items.push({ id, label: l.label, group: l.group, met, evidence });
  };

  for (const { metric, state } of cov.byMetric) {
    const v = latest(metric);
    add(
      `core:${metric}`,
      state === "not_assessed" ? null : state === "disclosed",
      state === "disclosed" ? `${v?.source ?? ""} ${v?.page ?? ""}`.trim() : state.replace(/_/g, " "),
    );
  }

  const s3 = latest("ghg_scope3_total");
  const cats = resolved.filter((m) => /^ghg_scope3_c\d+$/.test(m.metric) && m.year === year && m.state === "disclosed");
  add(
    "scope3_categories",
    s3 === undefined && cats.length === 0 ? null : cats.length >= 5,
    `${cats.length} of 15 categories quantified`,
  );

  const codes = classify(c.profile.industry).codes;
  const core = new Set(coreMetricsFor(codes).map((m) => m.id));
  const withPrior = new Set(
    resolved.filter((m) => core.has(m.metric) && m.state === "disclosed" && year !== undefined && m.year < year).map((m) => m.metric),
  );
  add("prior_year", year === undefined ? null : withPrior.size >= 3, `${withPrior.size} core metrics with an earlier year`);

  const s1 = latest("ghg_scope1");
  const level = s1?.state === "disclosed" ? s1.assurance.level : undefined;
  const provider = s1?.assurance.provider ? ` (${s1.assurance.provider})` : "";
  if (level === undefined) {
    add("ghg_assurance", null, "Scope 1 not disclosed");
    add("reasonable_assurance", null, "Scope 1 not disclosed");
  } else if (level === "not_stated") {
    add("ghg_assurance", null, "assurance level could not be read");
    add("reasonable_assurance", null, "assurance level could not be read");
  } else {
    add("ghg_assurance", level !== "none", `${level}${provider}`);
    add("reasonable_assurance", level === "reasonable", `${level}${provider}`);
  }

  const disclosedCore = resolved.filter((m) => core.has(m.metric) && m.year === year && m.state === "disclosed");
  const nonGroup = disclosedCore.filter((m) => m.boundary !== "consolidated_group");
  add(
    "group_boundary",
    disclosedCore.length === 0 ? null : nonGroup.length === 0,
    nonGroup.length ? `${nonGroup.length} core values on boundary: ${[...new Set(nonGroup.map((m) => m.boundary))].join(", ")}` : "all consolidated group",
  );
  add(
    "consolidation_stated",
    s1?.state === "disclosed" ? s1.consolidation !== "not_stated" : null,
    s1?.state === "disclosed" ? s1.consolidation.replace(/_/g, " ") : "Scope 1 not disclosed",
  );

  const ghgTargets = c.targets.filter((t) => t.category === "emissions");
  const quantified = ghgTargets.filter((t) => t.baseline?.year !== undefined && t.target.value !== undefined);
  add("quantified_target", quantified.length > 0, quantified.map((t) => t.id).join(", ") || "none recorded");
  const sbti = ghgTargets.filter((t) => t.validation === "sbti_validated");
  add("sbti", sbti.length > 0, sbti.map((t) => t.id).join(", ") || "not stated");
  const nz = ghgTargets.filter((t) => t.type === "net_zero" || /net[- ]zero|carbon[- ]neutral|carbon negative/i.test(t.description));
  add("net_zero", nz.length > 0, nz.map((t) => t.id).join(", ") || "none recorded");

  // Only metrics defined for the company's own SASB industries count; an industry with none in the dictionary is not assessable.
  const industry = METRICS.filter((m) => m.category === "industry" && metricAppliesTo(m, codes)).map((m) => m.id);
  const ind = resolved.filter((m) => industry.includes(m.metric) && m.state === "disclosed");
  if (industry.length === 0) add("industry_metric", null, `no industry metric defined yet for ${codes.join(", ") || "an unclassified company"}`);
  else add("industry_metric", ind.length > 0, ind.map((m) => m.metric).join(", ") || `none of ${industry.length} applicable`);

  const applicable = items.filter((i) => i.met !== null).length;
  const met = items.filter((i) => i.met === true).length;
  const coverageShare = cov.total ? cov.assessed / cov.total : 0;
  if (coverageShare < COVERAGE_THRESHOLD) {
    return {
      items,
      met,
      applicable,
      score: null,
      reason: `insufficient coverage: ${cov.assessed} of ${cov.total} core metrics assessed (needs ${Math.round(COVERAGE_THRESHOLD * 100)}%)`,
    };
  }
  return { items, met, applicable, score: applicable ? Math.round((met / applicable) * 1000) / 10 : null };
}
