import { rankable, type ComparableValue } from "./comparability";

export const MIN_PEERS_FOR_MEDIAN = 3;

export interface PeerStat {
  median: number | null;
  n: number;
  reason?: string;
}

/**
 * Peer median over rankable values only (consolidated group, full coverage,
 * not low-confidence), requiring MIN_PEERS_FOR_MEDIAN values in one unit.
 */
export function peerMedian(values: (ComparableValue & { canonical: number | null })[]): PeerStat {
  const ok = values.filter((v) => v.canonical !== null && rankable(v).ok);
  const units = new Set(ok.map((v) => v.canonicalUnit));
  if (units.size > 1) return { median: null, n: ok.length, reason: "units differ" };
  if (ok.length < MIN_PEERS_FOR_MEDIAN) {
    return { median: null, n: ok.length, reason: `${ok.length} comparable value${ok.length === 1 ? "" : "s"} (needs ${MIN_PEERS_FOR_MEDIAN})` };
  }
  const xs = ok.map((v) => v.canonical!).sort((a, b) => a - b);
  const mid = Math.floor(xs.length / 2);
  return { median: xs.length % 2 ? xs[mid] : (xs[mid - 1] + xs[mid]) / 2, n: ok.length };
}
