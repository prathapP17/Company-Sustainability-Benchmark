/**
 * Performance indicators and composite score, built only from data already
 * curated (no revenue intensity yet). Each indicator uses values that are
 * rankable (consolidated group, full coverage, not low-confidence) and, for
 * year-on-year changes, the same unit and no trend break.
 *
 * Indicator scores are 0-100. The composite is the mean of available
 * indicator scores and is only shown when MIN_INDICATORS are available.
 */
import type { CompanyFile } from "../schema/company";
import { resolveMetric, latestDisclosedYear, type ResolvedMetric } from "../schema/validate";
import { toCanonical } from "../metrics/dictionary";
import { rankable } from "./comparability";
import { targetProgress } from "./targets";

export const MIN_INDICATORS = 3;

/** Annual reduction consistent with a 1.5°C pathway (~4.2%/yr, SBTi cross-sector absolute contraction). */
export const PATHWAY_ANNUAL_REDUCTION = 4.2;

export interface Indicator {
  id: "ghg_target_progress" | "ghg_s12_yoy" | "renewable_share" | "waste_diversion" | "water_yoy";
  label: string;
  raw: number | null;
  rawUnit: string;
  score: number | null;
  detail: string;
}

export interface PerformanceResult {
  indicators: Indicator[];
  available: number;
  score: number | null;
  reason?: string;
}

export const INDICATOR_LABELS: Record<Indicator["id"], string> = {
  ghg_target_progress: "Progress against own GHG targets",
  ghg_s12_yoy: "Change in Scope 1+2 (market) vs prior year",
  renewable_share: "Renewable electricity share",
  waste_diversion: "Waste diverted from disposal",
  water_yoy: "Change in water withdrawal vs prior year",
};

/** Maps a % change to 0-100: ≤ −4.2% → 100, 0% → 50, ≥ +10% → 0, linear in between. */
export function changeScore(changePct: number): number {
  if (changePct <= -PATHWAY_ANNUAL_REDUCTION) return 100;
  if (changePct <= 0) return 50 + (50 * -changePct) / PATHWAY_ANNUAL_REDUCTION;
  if (changePct >= 10) return 0;
  return 50 - (50 * changePct) / 10;
}

const round1 = (x: number) => Math.round(x * 10) / 10;

function canonical(m: ResolvedMetric): number | null {
  return m.value !== undefined && m.unit ? toCanonical(m.metric, m.value, m.unit) : null;
}

export function performance(c: CompanyFile): PerformanceResult {
  const year = latestDisclosedYear(c);
  const all = c.metrics.map((m) => resolveMetric(c, m)).filter((m) => m.state === "disclosed");
  const get = (id: string, y: number | undefined) => all.find((m) => m.metric === id && m.year === y);
  const indicators: Indicator[] = [];
  const push = (id: Indicator["id"], raw: number | null, rawUnit: string, score: number | null, detail: string) =>
    indicators.push({ id, label: INDICATOR_LABELS[id], raw: raw === null ? null : round1(raw), rawUnit, score: score === null ? null : round1(score), detail });

  // 1. Target progress (absolute emissions targets with a reported % reduction).
  const progress = c.targets
    .filter((t) => t.category === "emissions" && t.type === "absolute")
    .map((t) => ({
      t,
      p: targetProgress({
        type: t.type,
        category: t.category,
        baselineYear: t.baseline?.year ?? null,
        targetYear: t.target.year,
        targetValue: t.target.value ?? null,
        targetUnit: t.target.unit ?? null,
        latestYear: t.latest?.year ?? null,
        latestValue: t.latest?.value ?? null,
        latestUnit: t.latest?.unit ?? null,
      }),
    }))
    .filter((x) => x.p.ratio !== null);
  if (progress.length) {
    const ratio = progress.reduce((s, x) => s + x.p.ratio!, 0) / progress.length;
    push(
      "ghg_target_progress",
      ratio * 100,
      "% of straight-line path",
      Math.min(ratio, 1) * 100,
      progress.map((x) => `${x.t.id}: ${round1(x.p.achievedShare!)}% achieved vs ${round1(x.p.expectedShare!)}% expected`).join("; "),
    );
  } else {
    push("ghg_target_progress", null, "", null, "no absolute GHG target with reported % progress");
  }

  // 2 & 5. Year-on-year changes.
  const yoy = (ids: string[], id: Indicator["id"]) => {
    if (year === undefined) return push(id, null, "", null, "no disclosed year");
    const cur = ids.map((m) => get(m, year));
    const prev = ids.map((m) => get(m, year - 1));
    const missing = [...cur, ...prev].some((v) => !v);
    if (missing) return push(id, null, "", null, `needs ${ids.join(" + ")} for ${year} and ${year - 1}`);
    const blocked = [...cur, ...prev].map((v) => rankable(v!)).find((r) => !r.ok);
    if (blocked) return push(id, null, "", null, `excluded: ${blocked.reason}`);
    if (cur.some((v) => v!.trendBreak)) return push(id, null, "", null, "excluded: method or scope changed between years (trend break)");
    const sum = (vs: (ResolvedMetric | undefined)[]) => vs.reduce((s, v) => s + (canonical(v!) ?? NaN), 0);
    const a = sum(prev);
    const b = sum(cur);
    if (!Number.isFinite(a) || !Number.isFinite(b) || a === 0) return push(id, null, "", null, "values not convertible");
    const change = ((b - a) / a) * 100;
    push(id, change, "% change", changeScore(change), `${year - 1} → ${year}`);
  };
  yoy(["ghg_scope1", "ghg_scope2_market"], "ghg_s12_yoy");

  // 3 & 4. Shares taken as reported.
  const share = (metric: string, id: Indicator["id"]) => {
    const v = get(metric, year);
    if (!v || v.value === undefined) return push(id, null, "", null, "not disclosed for latest year");
    const r = rankable(v);
    if (!r.ok) return push(id, null, "", null, `excluded: ${r.reason}`);
    push(id, v.value, "%", Math.max(0, Math.min(100, v.value)), v.status === "derived" ? "derived from reported values" : "as reported");
  };
  share("renewable_electricity_share", "renewable_share");
  share("waste_diversion_rate", "waste_diversion");

  yoy(["water_withdrawal"], "water_yoy");

  // Keep a stable order.
  const order: Indicator["id"][] = ["ghg_target_progress", "ghg_s12_yoy", "renewable_share", "waste_diversion", "water_yoy"];
  indicators.sort((x, y) => order.indexOf(x.id) - order.indexOf(y.id));

  const scored = indicators.filter((i) => i.score !== null);
  if (scored.length < MIN_INDICATORS) {
    return {
      indicators,
      available: scored.length,
      score: null,
      reason: `insufficient comparable data: ${scored.length} of ${indicators.length} indicators (needs ${MIN_INDICATORS})`,
    };
  }
  return { indicators, available: scored.length, score: round1(scored.reduce((s, i) => s + i.score!, 0) / scored.length) };
}
