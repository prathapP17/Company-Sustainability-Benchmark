/**
 * The comparability engine (rule 4: never add or compare values on different
 * boundaries, methods or periods). ONE set of rules, used by the comparison
 * table and chart, peer medians, performance indicators, peer ranks, the map
 * and the exports. A page never decides eligibility on its own: it shows the
 * status this module returns, and any number it calculates (a median) comes
 * from the same decision.
 *
 * Three questions, three functions:
 *  - compareSet():   may these values be shown side by side, and with which warnings?
 *  - benchmarkSet(): which values may enter a peer median, and what is it?
 *  - sameBasis():    may two years of one company's metric be compared (year-on-year)?
 *
 * Zod-free and dependency-free so client components can use it.
 */

export interface ComparableValue {
  boundary: string;
  consolidation: string;
  scope2Method?: string | null;
  coverage?: string | null;
  canonicalUnit?: string | null;
  lowConfidence?: boolean | number | null;
  /** Optional richer context; checks that need a field are applied only when it is given. */
  companyId?: string;
  metricId?: string;
  canonical?: number | null;
  /** ISO date the reporting period ends (fiscal year end). */
  periodEnd?: string | null;
  /** The company's confirmed primary SASB industry, or null when it needs review. */
  industry?: string | null;
  trendBreak?: boolean | number | null;
  status?: string | null;
}

export type ComparabilityLevel = "comparable" | "caution" | "not_comparable";

export interface ComparabilityResult {
  level: ComparabilityLevel;
  reasons: string[];
}

export const MIN_PEERS_FOR_MEDIAN = 3;

const human = (s: string) => s.replace(/_/g, " ");

/** Scope 2 values must carry the method their metric names. */
function scope2Mismatch(v: ComparableValue): string | null {
  if (!v.metricId) return null;
  const expected = v.metricId.endsWith("_market") ? "market" : v.metricId.endsWith("_location") ? "location" : null;
  if (expected && v.scope2Method !== expected) return `Scope 2 method is ${v.scope2Method ?? "not stated"}, metric needs ${expected}-based`;
  return null;
}

/**
 * Reasons a single value cannot enter any cross-company calculation (rankings,
 * scores, medians). Empty means the value itself is usable.
 */
export function valueIssues(v: ComparableValue): string[] {
  const r: string[] = [];
  if (v.boundary !== "consolidated_group") r.push(`boundary is ${human(v.boundary)}, not the consolidated group`);
  if (v.coverage) r.push(`covers only part of operations (${v.coverage})`);
  if (v.lowConfidence) r.push("low-confidence source");
  if (v.canonical === null) r.push("unit cannot be converted to the canonical unit");
  const s2 = scope2Mismatch(v);
  if (s2) r.push(s2);
  return r;
}

/** Can this single value enter a cross-company ranking or score? */
export function rankable(v: ComparableValue): { ok: boolean; reason?: string } {
  const r = valueIssues(v);
  return r.length ? { ok: false, reason: r[0] } : { ok: true };
}

const periodYear = (v: ComparableValue) => (v.periodEnd ? v.periodEnd.slice(0, 4) : null);
const distinct = <T>(xs: T[]) => new Set(xs).size;

/**
 * Comparability of a set of values for the same metric across companies, for
 * showing them side by side. Hard failures make the set "not_comparable";
 * softer differences make it "caution". Nothing is calculated from it.
 */
export function compareSet(values: ComparableValue[]): ComparabilityResult {
  const reasons: string[] = [];
  let level: ComparabilityLevel = "comparable";
  const hard = (why: string) => {
    level = "not_comparable";
    reasons.push(why);
  };
  const soft = (why: string) => {
    if (level === "comparable") level = "caution";
    reasons.push(why);
  };
  const by = <K extends keyof ComparableValue>(k: K) => values.map((v) => v[k] ?? null);

  if (values.some((v) => v.boundary !== "consolidated_group")) hard("some values are not on a consolidated-group boundary");
  if (values.some((v) => v.coverage)) hard("some values cover only part of operations");
  if (distinct(by("scope2Method")) > 1 || values.some((v) => scope2Mismatch(v))) hard("Scope 2 methods differ");
  if (distinct(by("canonicalUnit")) > 1) hard("units cannot be converted to a common unit");
  if (distinct(by("consolidation")) > 1 || values.some((v) => v.consolidation === "not_stated")) soft("consolidation approaches differ or are not stated");
  if (values.every((v) => v.periodEnd) && distinct(values.map(periodYear)) > 1) soft("reporting periods end in different years");
  else if (values.every((v) => v.periodEnd) && distinct(values.map((v) => v.periodEnd!.slice(5))) > 1) soft("fiscal years end in different months");
  if (values.some((v) => v.lowConfidence)) soft("some values come from low-confidence sources");
  if (values.some((v) => "industry" in v) && (values.some((v) => !v.industry) || distinct(by("industry")) > 1)) soft("companies are not in one confirmed industry");
  return { level, reasons };
}

export interface Exclusion<T> {
  value: T;
  reasons: string[];
}

export interface BenchmarkResult<T extends ComparableValue> {
  median: number | null;
  n: number;
  /** Values the median uses (or would use, when there are too few). */
  included: T[];
  /** Every value left out, with why. */
  excluded: Exclusion<T>[];
  /** Why there is no median, when there is none. */
  reason?: string;
  /** The reporting-period end year and consolidation approach the included values share. */
  basis: { periodYear: string | null; consolidation: string | null; unit: string | null };
  /** Softer differences among the included values (shown with the median). */
  cautions: string[];
}

/** Picks the most common key; ties go to the larger key (later year) or are reported as a tie. */
function majority<T>(items: T[], key: (t: T) => string): { key: string; tie: boolean } | null {
  const counts = new Map<string, number>();
  for (const it of items) counts.set(key(it), (counts.get(key(it)) ?? 0) + 1);
  const sorted = [...counts.entries()].sort((a, b) => b[1] - a[1] || b[0].localeCompare(a[0]));
  if (!sorted.length) return null;
  return { key: sorted[0][0], tie: sorted.length > 1 && sorted[1][1] === sorted[0][1] };
}

/**
 * Peer median for one metric within one SASB industry. A value enters only if
 * it is itself usable (valueIssues), its company's confirmed primary industry is
 * `industry`, its consolidation approach is stated, and it shares the
 * reporting-period end year, consolidation approach and unit of the other
 * values. Needs MIN_PEERS_FOR_MEDIAN values. The returned `excluded` list is
 * what the page shows next to the median: the same decision, never re-derived.
 */
export function benchmarkSet<T extends ComparableValue>(values: T[], ctx: { industry: string }): BenchmarkResult<T> {
  const excluded: Exclusion<T>[] = [];
  let pool: T[] = [];
  for (const v of values) {
    const r = valueIssues(v);
    if (v.industry === null || v.industry === undefined) r.unshift("industry classification needs review (no confirmed primary SASB industry)");
    else if (v.industry !== ctx.industry) r.unshift(`primary industry is ${v.industry}, not ${ctx.industry}`);
    if (v.consolidation === "not_stated") r.push("consolidation approach not stated");
    if (!v.periodEnd) r.push("reporting period unknown");
    if (r.length) excluded.push({ value: v, reasons: r });
    else pool.push(v);
  }
  const cautions: string[] = [];
  const keep = (pick: (v: T) => string, chosen: string, why: (v: T) => string) => {
    const next: T[] = [];
    for (const v of pool) {
      if (pick(v) === chosen) next.push(v);
      else excluded.push({ value: v, reasons: [why(v)] });
    }
    pool = next;
  };

  const unit = majority(pool, (v) => v.canonicalUnit ?? "");
  if (unit) keep((v) => v.canonicalUnit ?? "", unit.key, (v) => `unit ${v.canonicalUnit} differs from ${unit.key}`);
  const period = majority(pool, (v) => periodYear(v)!);
  if (period) keep((v) => periodYear(v)!, period.key, (v) => `reporting period ends in ${periodYear(v)}, the others in ${period.key}`);
  const cons = majority(pool, (v) => v.consolidation);
  let tie = false;
  if (cons) {
    tie = cons.tie;
    keep((v) => v.consolidation, cons.key, (v) => `consolidation approach is ${human(v.consolidation)}, the others ${human(cons.key)}`);
  }
  if (distinct(pool.map((v) => v.periodEnd!.slice(5))) > 1) cautions.push("fiscal years end in different months of the same year");
  if (pool.some((v) => v.status === "derived")) cautions.push("includes values derived from reported figures");

  const basis = { periodYear: period?.key ?? null, consolidation: cons?.key ?? null, unit: unit?.key || null };
  const n = pool.length;
  const result = (median: number | null, reason?: string): BenchmarkResult<T> => ({ median, n, included: pool, excluded, reason, basis, cautions });
  if (tie) return result(null, "comparable values split evenly between consolidation approaches");
  if (n < MIN_PEERS_FOR_MEDIAN) return result(null, `${n} comparable value${n === 1 ? "" : "s"} in ${ctx.industry} (needs ${MIN_PEERS_FOR_MEDIAN})`);
  const xs = pool.map((v) => v.canonical!).sort((a, b) => a - b);
  const mid = Math.floor(xs.length / 2);
  return result(xs.length % 2 ? xs[mid] : (xs[mid - 1] + xs[mid]) / 2);
}

/**
 * Whether two years of one company's metric may be compared (year-on-year
 * change). Same boundary (consolidated group), consolidation approach, Scope 2
 * method, unit and coverage; neither from a low-confidence source; and the
 * later year not marked as a trend break (method or scope change).
 */
export function sameBasis(current: ComparableValue, prior: ComparableValue): { ok: boolean; reason?: string } {
  for (const v of [current, prior]) {
    const r = valueIssues(v);
    if (r.length) return { ok: false, reason: r[0] };
  }
  if (current.trendBreak) return { ok: false, reason: "method or scope changed between years (trend break)" };
  if (current.consolidation !== prior.consolidation) return { ok: false, reason: `consolidation approach changed (${human(prior.consolidation)} → ${human(current.consolidation)})` };
  if ((current.scope2Method ?? null) !== (prior.scope2Method ?? null)) return { ok: false, reason: "Scope 2 method changed between years" };
  if ((current.canonicalUnit ?? null) !== (prior.canonicalUnit ?? null)) return { ok: false, reason: "units differ between years" };
  return { ok: true };
}
