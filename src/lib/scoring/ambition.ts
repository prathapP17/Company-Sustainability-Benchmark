/**
 * Target ambition check (phase 6): the linear annual reduction a target
 * implies, compared with SBTi's near-term minimums for absolute targets:
 *   - 4.2% a year (linear) for 1.5 °C
 *   - 2.5% a year (linear) for well-below 2 °C
 * (SBTi Corporate Near-Term Criteria, absolute contraction approach.)
 *
 * This is a derived, simplified check of the target's PACE only. It does not
 * test boundary coverage, base-year recency or time frame, which SBTi
 * validation also requires; SBTi's own classification is shown beside it.
 */
export const PATHWAY_RATES = { "1.5C": 4.2, WB2C: 2.5 } as const;

export type AmbitionStatus = "pace_1_5" | "pace_wb2c" | "below_wb2c" | "not_assessable";

export interface Ambition {
  status: AmbitionStatus;
  /** Implied linear reduction, % of base-year emissions per year. */
  ratePerYear: number | null;
  reason?: string;
}

export interface AmbitionInput {
  category: string;
  type: string;
  baselineYear: number | null;
  targetYear: number | null;
  /** Reduction in percent of the base year (e.g. 62 for "62%"). */
  reductionPct: number | null;
  unit: string | null;
}

export function ambitionOf(t: AmbitionInput): Ambition {
  const no = (reason: string): Ambition => ({ status: "not_assessable", ratePerYear: null, reason });
  if (t.category !== "emissions") return no("not an emissions target");
  if (t.type === "intensity") return no("intensity target: the pace depends on growth, so it is not compared with absolute pathways");
  if (t.type === "net_zero") return no("net-zero goal: no interim reduction to compare");
  if (t.type !== "absolute") return no("not an absolute reduction target");
  if (t.reductionPct === null || !(t.unit ?? "").toLowerCase().includes("%")) return no("reduction not stated as a percentage of the base year");
  if (t.baselineYear === null || t.targetYear === null) return no("base year or target year not stated");
  const span = t.targetYear - t.baselineYear;
  if (span <= 0) return no("target year is not after the base year");
  if (t.reductionPct <= 0 || t.reductionPct > 100) return no("reduction outside 0–100%");
  const rate = Math.round((t.reductionPct / span) * 100) / 100;
  const status: AmbitionStatus = rate >= PATHWAY_RATES["1.5C"] ? "pace_1_5" : rate >= PATHWAY_RATES.WB2C ? "pace_wb2c" : "below_wb2c";
  return { status, ratePerYear: rate };
}

export const AMBITION_LABEL: Record<AmbitionStatus, string> = {
  pace_1_5: "1.5 °C pace",
  pace_wb2c: "Well-below 2 °C pace",
  below_wb2c: "Slower than 2 °C pace",
  not_assessable: "Pace not assessable",
};

/** Parses SBTi's printed target value ("62%", "50.4%"). */
export function percentOf(value: string | null): number | null {
  const m = /^(\d+(?:\.\d+)?)\s*%$/.exec((value ?? "").trim());
  return m ? Number(m[1]) : null;
}
