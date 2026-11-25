/**
 * Extraction evaluation (phase 7). Gold answers are curated values: each was
 * checked by hand against its source page. A proposal is judged only where
 * the gold set has an answer for the same metric and year; anything else is
 * "unjudged" (the curated set covers chosen years, not every number in a report).
 */
import { toCanonical } from "../metrics/dictionary";

export interface GoldValue {
  company: string;
  source: string;
  metric: string;
  year: number;
  value: number;
  unit: string;
  page: string | null;
  /** Context of the curated value (older gold files may lack these; those checks are then skipped). */
  boundary?: string;
  consolidation?: string;
  scope2Method?: string | null;
}

export interface Proposal {
  metric: string;
  year: number;
  value: number;
  unit: string;
  page: string;
  boundary?: string;
  consolidation?: string;
  scope2Method?: string | null;
  /** Read from an OCR page. */
  ocr?: boolean;
}

/** n correct of d checked, and the share. */
export interface Rate {
  correct: number;
  of: number;
  pct: number | null;
}

export interface Score {
  gold: number;
  found: number; // gold values matched by at least one proposal
  wrong: number; // gold values with proposals for that metric/year, none correct
  missed: number; // gold values with no proposal for that metric/year
  proposals: number;
  judged: number; // proposals whose metric/year has a gold answer
  correct: number; // judged proposals that match the gold value
  unjudged: number;
  recall: number | null; // found / gold
  precision: number | null; // correct / judged
  /** Wrong proposals whose value is the gold value of the same metric in ANOTHER year (wrong column). */
  wrongYear: number;
  /** Wrong proposals with the gold number but a different unit (unit misread). */
  wrongUnit: number;
  /** Among correct values: does the proposed context match the curated one? */
  boundary: Rate;
  consolidation: Rate;
  scope2Method: Rate;
  /** Proposals read from OCR pages, and how many of the judged ones were correct. */
  ocr: { proposals: number; judged: number; correct: number };
  details: { metric: string; year: number; gold: number; unit: string; got: number[]; outcome: "found" | "wrong" | "missed" }[];
}

/** Same value after unit conversion, within 0.5% (rounding in reports). */
export function sameValue(metric: string, a: { value: number; unit: string }, b: { value: number; unit: string }): boolean {
  let x: number | null;
  let y: number | null;
  try {
    x = toCanonical(metric, a.value, a.unit);
    y = toCanonical(metric, b.value, b.unit);
  } catch {
    return false;
  }
  if (x === null || y === null) return false;
  if (y === 0) return x === 0;
  return Math.abs(x - y) <= Math.abs(y) * 0.005;
}

const ratio = (n: number, d: number) => (d ? Math.round((n / d) * 1000) / 10 : null);

export function scoreProposals(gold: GoldValue[], proposals: Proposal[]): Score {
  const key = (m: string, y: number) => `${m}|${y}`;
  const byKey = new Map<string, Proposal[]>();
  for (const p of proposals) byKey.set(key(p.metric, p.year), [...(byKey.get(key(p.metric, p.year)) ?? []), p]);
  const goldKeys = new Set(gold.map((g) => key(g.metric, g.year)));
  const details: Score["details"] = [];
  for (const g of gold) {
    const got = byKey.get(key(g.metric, g.year)) ?? [];
    const hit = got.some((p) => sameValue(g.metric, p, g));
    details.push({ metric: g.metric, year: g.year, gold: g.value, unit: g.unit, got: got.map((p) => p.value), outcome: hit ? "found" : got.length ? "wrong" : "missed" });
  }
  const judged = proposals.filter((p) => goldKeys.has(key(p.metric, p.year)));
  const correct = judged.filter((p) => gold.some((g) => g.metric === p.metric && g.year === p.year && sameValue(g.metric, p, g)));
  const found = details.filter((d) => d.outcome === "found").length;
  const wrong = judged.filter((p) => !correct.includes(p));
  const wrongYear = wrong.filter((p) => gold.some((g) => g.metric === p.metric && g.year !== p.year && sameValue(g.metric, p, g))).length;
  const wrongUnit = wrong.filter((p) => gold.some((g) => g.metric === p.metric && g.year === p.year && g.value === p.value && g.unit !== p.unit)).length;
  const rate = (pairs: [unknown, unknown][]): Rate => {
    const ok = pairs.filter(([a, b]) => a === b).length;
    return { correct: ok, of: pairs.length, pct: ratio(ok, pairs.length) };
  };
  const matchedPairs = correct.map((p) => [p, gold.find((g) => g.metric === p.metric && g.year === p.year && sameValue(g.metric, p, g))!] as const);
  const ocr = proposals.filter((p) => p.ocr);
  return {
    wrongYear,
    wrongUnit,
    boundary: rate(matchedPairs.filter(([p, g]) => p.boundary !== undefined && g.boundary !== undefined).map(([p, g]) => [p.boundary, g.boundary])),
    consolidation: rate(matchedPairs.filter(([p, g]) => p.consolidation !== undefined && g.consolidation !== undefined).map(([p, g]) => [p.consolidation, g.consolidation])),
    scope2Method: rate(
      matchedPairs.filter(([p, g]) => /^ghg_scope2_/.test(p.metric) && g.scope2Method !== undefined).map(([p, g]) => [p.scope2Method ?? null, g.scope2Method ?? null]),
    ),
    ocr: { proposals: ocr.length, judged: ocr.filter((p) => goldKeys.has(key(p.metric, p.year))).length, correct: ocr.filter((p) => correct.includes(p)).length },
    gold: gold.length,
    found,
    wrong: details.filter((d) => d.outcome === "wrong").length,
    missed: details.filter((d) => d.outcome === "missed").length,
    proposals: proposals.length,
    judged: judged.length,
    correct: correct.length,
    unjudged: proposals.length - judged.length,
    recall: ratio(found, gold.length),
    precision: ratio(correct.length, judged.length),
    details,
  };
}
