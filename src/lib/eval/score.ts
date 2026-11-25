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
}

export interface Proposal {
  metric: string;
  year: number;
  value: number;
  unit: string;
  page: string;
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
  return {
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
