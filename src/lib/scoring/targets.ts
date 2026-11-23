/**
 * Progress against a company's own target, compared with a straight-line path
 * from the baseline year to the target year. Only computed when the company
 * reports the latest progress in the same unit as the target (a % reduction).
 * This is a derived assessment, labelled as such wherever it is shown.
 */
export interface TargetLike {
  type: string;
  category: string;
  baselineYear: number | null;
  targetYear: number;
  targetValue: number | null;
  targetUnit: string | null;
  latestYear: number | null;
  latestValue: number | null;
  latestUnit: string | null;
}

export type ProgressStatus = "ahead" | "on_track" | "behind" | "not_computable";

export interface Progress {
  status: ProgressStatus;
  /** Share of the target achieved so far (%). */
  achievedShare: number | null;
  /** Share expected by the latest year on a straight-line path (%). */
  expectedShare: number | null;
  /** achieved / expected, capped at 2 for display. */
  ratio: number | null;
  reason?: string;
}

const unitKind = (u: string | null) => (u ?? "").replace(/\(.*\)/, "").trim().toLowerCase();

export function targetProgress(t: TargetLike): Progress {
  const none = (reason: string): Progress => ({ status: "not_computable", achievedShare: null, expectedShare: null, ratio: null, reason });
  if (t.targetValue === null || t.latestValue === null || t.latestYear === null) return none("no reported progress value");
  if (t.baselineYear === null) return none("no baseline year");
  if (t.type === "net_zero" || t.type === "qualitative") return none("target has no interim quantity");
  const tu = unitKind(t.targetUnit);
  const lu = unitKind(t.latestUnit);
  // Progress must be in the same kind of unit as the target: % reduction vs % reduction, or % vs %.
  const sameKind = tu === lu || (tu.includes("% reduction") && lu.includes("reduction"));
  if (!sameKind) return none(`progress unit "${t.latestUnit}" differs from target unit "${t.targetUnit}"`);
  const span = t.targetYear - t.baselineYear;
  if (span <= 0) return none("target year is not after baseline year");
  const elapsed = Math.min(Math.max(t.latestYear - t.baselineYear, 0), span);

  let achievedShare: number;
  let expectedShare: number;
  if (tu.includes("reduction")) {
    achievedShare = (t.latestValue / t.targetValue) * 100;
    expectedShare = (elapsed / span) * 100;
  } else {
    // increase-to targets (e.g. 100% renewable): needs a baseline value to be meaningful.
    return none("increase-to target without a baseline value");
  }
  if (expectedShare === 0) return none("latest year equals baseline year");
  const ratio = Math.min(achievedShare / expectedShare, 2);
  const status: ProgressStatus = ratio >= 1.1 ? "ahead" : ratio >= 0.9 ? "on_track" : "behind";
  return { status, achievedShare, expectedShare, ratio };
}

/** Adapter for target rows as stored in the database. */
export function progressFromRow(t: {
  type: string;
  category: string;
  baseline_year: number | null;
  target_year: number;
  target_value: number | null;
  target_unit: string | null;
  latest_year: number | null;
  latest_value: number | null;
  latest_unit: string | null;
}): Progress {
  return targetProgress({
    type: t.type,
    category: t.category,
    baselineYear: t.baseline_year,
    targetYear: t.target_year,
    targetValue: t.target_value,
    targetUnit: t.target_unit,
    latestYear: t.latest_year,
    latestValue: t.latest_value,
    latestUnit: t.latest_unit,
  });
}
