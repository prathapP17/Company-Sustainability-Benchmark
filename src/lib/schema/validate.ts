/**
 * Cross-field validation for company files. Zod checks shape; this checks the
 * non-negotiable rules (section 2 of the brief) that need context:
 *  - disclosed values carry a source, page and every rule-3 context field;
 *  - non-disclosed states carry no value (missing is not zero);
 *  - derived values explain their method;
 *  - Scope 2 metrics state the matching method;
 *  - no two values for the same metric/year/boundary/consolidation/method
 *    (conflicts must be resolved explicitly, never silently).
 */
import { CompanyFile, type MetricEntry, type PeerGroup } from "./company";
import { getMetric, METRIC_BY_ID, metricAppliesTo } from "../metrics/dictionary";
import type { Boundary, Consolidation, Scope2Method, ValueStatus, VerificationClass } from "./enums";
import type { Assurance } from "./company";

export interface Issue {
  file: string;
  path: string;
  message: string;
  level: "error" | "warning";
}

export interface ResolvedMetric extends MetricEntry {
  boundary: Boundary;
  consolidation: Consolidation;
  assurance: Assurance;
  verificationClass: VerificationClass;
  status: ValueStatus;
  scope2Method?: Scope2Method;
  /** Search excerpts and secondary sources are never auto-approved (rule 7). */
  lowConfidence: boolean;
}

export function resolveMetric(company: CompanyFile, m: MetricEntry): ResolvedMetric {
  const d = company.defaults;
  const sourceId = m.source ?? d.source;
  const src = company.sources.find((s) => s.id === sourceId);
  const verificationClass = m.verificationClass ?? src?.verificationClass ?? d.verificationClass ?? "primary_document";
  return {
    ...m,
    source: sourceId,
    boundary: m.boundary ?? d.boundary ?? "not_stated",
    consolidation: m.consolidation ?? d.consolidation ?? "not_stated",
    scope2Method: m.scope2Method ?? d.scope2Method,
    assurance: m.assurance ?? d.assurance ?? { level: "not_stated" },
    verificationClass,
    status: m.status ?? d.status ?? "reported",
    lowConfidence: verificationClass === "search_excerpt" || verificationClass === "secondary_source",
  };
}

export function validateCompany(
  file: string,
  raw: unknown,
  peerGroups: PeerGroup[],
): { company?: CompanyFile; issues: Issue[] } {
  const issues: Issue[] = [];
  const err = (path: string, message: string) => issues.push({ file, path, message, level: "error" });
  const warn = (path: string, message: string) => issues.push({ file, path, message, level: "warning" });

  const parsed = CompanyFile.safeParse(raw);
  if (!parsed.success) {
    for (const i of parsed.error.issues) err(i.path.join("."), i.message);
    return { issues };
  }
  const c = parsed.data;

  const expectedId = file.replace(/^.*\//, "").replace(/\.json$/, "");
  if (c.profile.id !== expectedId) err("profile.id", `id "${c.profile.id}" must match file name "${expectedId}"`);
  if (!peerGroups.some((p) => p.id === c.profile.peerGroup)) err("profile.peerGroup", `unknown peer group "${c.profile.peerGroup}"`);

  const sourceIds = new Set<string>();
  c.sources.forEach((s, i) => {
    if (sourceIds.has(s.id)) err(`sources.${i}.id`, `duplicate source id "${s.id}"`);
    sourceIds.add(s.id);
  });
  const checkSource = (path: string, id: string | undefined) => {
    if (id !== undefined && !sourceIds.has(id)) err(path, `unknown source "${id}"`);
  };
  checkSource("defaults.source", c.defaults.source);
  c.reports.forEach((r, i) => checkSource(`reports.${i}.source`, r.source));

  const seen = new Map<string, number>();
  c.metrics.forEach((raw, i) => {
    const p = `metrics.${i}`;
    const def = METRIC_BY_ID.get(raw.metric);
    if (!def) {
      err(`${p}.metric`, `unknown metric "${raw.metric}"`);
      return;
    }
    if (!metricAppliesTo(def, c.profile.peerGroup)) {
      err(`${p}.metric`, `metric "${raw.metric}" does not apply to peer group "${c.profile.peerGroup}"`);
    }
    const m = resolveMetric(c, raw);
    checkSource(`${p}.source`, m.source);

    if (m.state === "disclosed") {
      if (m.value === undefined && m.text === undefined) err(p, "disclosed entry needs a value or text");
      if (m.value !== undefined) {
        if (!m.unit) err(`${p}.unit`, "numeric value needs a unit");
        else if (getMetric(m.metric).units[m.unit] === undefined)
          err(`${p}.unit`, `unit "${m.unit}" not accepted for ${m.metric} (accepted: ${Object.keys(def.units).join(", ")})`);
        if (def.canonicalUnit === "%" && (m.value < 0 || m.value > 100)) err(`${p}.value`, "percentage out of range");
      }
      if (!m.source) err(`${p}.source`, "disclosed entry needs a source (rule 1)");
      if (!m.page) err(`${p}.page`, "disclosed entry needs a page / cell / section (rule 1)");
      if (m.status === "derived" && !m.note) err(`${p}.note`, "derived value must describe its method in the note");
      if (m.lowConfidence) warn(p, `low-confidence source class "${m.verificationClass}" (never auto-approved)`);
    } else {
      if (m.value !== undefined || m.text !== undefined) err(p, `state "${m.state}" must not carry a value (missing is not zero)`);
      if (m.state !== "not_assessed" && !m.note && !m.page) warn(p, `state "${m.state}" should say where it was checked`);
    }

    if (def.requiresScope2Method) {
      const expected = m.metric.endsWith("_market") ? "market" : "location";
      if (m.state === "disclosed" && m.scope2Method !== expected)
        err(`${p}.scope2Method`, `Scope 2 entry must state method "${expected}" (got "${m.scope2Method ?? "none"}")`);
    }

    const key = [m.metric, m.year, m.boundary, m.consolidation, m.scope2Method ?? ""].join("|");
    const prev = seen.get(key);
    if (prev !== undefined) err(p, `conflicts with metrics.${prev} (same metric/year/boundary/method). Resolve explicitly (rule 8).`);
    else seen.set(key, i);
  });

  c.targets.forEach((t, i) => checkSource(`targets.${i}.source`, t.source));
  c.frameworks.forEach((f, i) => checkSource(`frameworks.${i}.source`, f.source));
  c.dataGaps.forEach((g, i) => {
    checkSource(`dataGaps.${i}.source`, g.source);
    if (g.metric && !METRIC_BY_ID.has(g.metric)) err(`dataGaps.${i}.metric`, `unknown metric "${g.metric}"`);
  });
  for (const key of ["ratings", "indices", "initiatives", "narratives"] as const) {
    c[key].forEach((x, i) => checkSource(`${key}.${i}.source`, x.source));
  }

  if (c.researchStatus === "detailed") {
    const latest = latestDisclosedYear(c);
    const core = [...METRIC_BY_ID.values()].filter((d) => d.core && metricAppliesTo(d, c.profile.peerGroup));
    for (const d of core) {
      const assessed = c.metrics.some((m) => m.metric === d.id && m.year === latest && m.state !== "not_assessed");
      if (!assessed) err("researchStatus", `"detailed" requires core metric ${d.id} to be assessed for ${latest}`);
    }
  }

  return { company: c, issues };
}

export function latestDisclosedYear(c: CompanyFile): number | undefined {
  const years = c.metrics.filter((m) => m.state === "disclosed").map((m) => m.year);
  return years.length ? Math.max(...years) : undefined;
}
