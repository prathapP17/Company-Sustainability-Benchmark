/**
 * The automatic check every AI summary must pass before it is shown (the
 * user-approved alternative to human review, decided 2026-11-25):
 *  - 2 to 6 sentences, each at most 45 words, each citing at least one fact;
 *  - every cited id exists;
 *  - every number in a sentence (including years and percentages) appears in
 *    one of the facts that sentence cites;
 *  - no spelled-out quantities, comparisons with other companies, rankings or
 *    superlatives (the facts cover one company only).
 * A summary that fails is never published.
 */
import type { Fact } from "./facts";

export interface Sentence {
  text: string;
  citations: string[];
}

export interface CheckResult {
  ok: boolean;
  problems: string[];
}

const NUMBER = /[-+]?\d[\d,]*(?:\.\d+)?/g;
const BANNED: [RegExp, string][] = [
  [/\b(best|worst|leading|leader|laggard|top|outperform\w*|underperform\w*|rank\w*|peers?|competitors?|industry average)\b/i, "comparison or ranking"],
  [/\b(half|double[ds]?|tripled?|quadrupled?|one|two|three|four|five|six|seven|eight|nine|ten|dozen|hundred|thousand|million|billion)\b/i, "spelled-out quantity"],
  [/\b(will|likely|expected to|should|must|impressive|disappointing|excellent|poor|strong|weak)\b/i, "forecast or judgement"],
];

/** Numbers as plain values: "55,200" -> "55200", "+3.5" -> "3.5", "2030" -> "2030". */
function numbersIn(s: string): string[] {
  return (s.match(NUMBER) ?? []).map((n) => n.replace(/[+,]/g, "").replace(/^-/, "")).map((n) => (n.includes(".") ? String(Number(n)) : n));
}

export function checkSummary(sentences: Sentence[], facts: Fact[]): CheckResult {
  const problems: string[] = [];
  const byId = new Map(facts.map((f) => [f.id, f]));
  if (sentences.length < 2 || sentences.length > 6) problems.push(`has ${sentences.length} sentences (2 to 6 allowed)`);
  sentences.forEach((s, i) => {
    const n = i + 1;
    const words = s.text.trim().split(/\s+/).length;
    if (words > 45) problems.push(`sentence ${n} has ${words} words (45 allowed)`);
    if (!s.citations.length) problems.push(`sentence ${n} cites nothing`);
    const cited = s.citations.map((c) => byId.get(c));
    s.citations.forEach((c, k) => {
      if (!cited[k]) problems.push(`sentence ${n} cites unknown fact ${c}`);
    });
    const allowed = new Set(cited.filter(Boolean).flatMap((f) => numbersIn(f!.text)));
    for (const num of numbersIn(s.text)) {
      if (!allowed.has(num)) problems.push(`sentence ${n}: "${num}" is not in the facts it cites`);
    }
    for (const [re, why] of BANNED) {
      const m = re.exec(s.text);
      if (m) problems.push(`sentence ${n}: "${m[0]}" (${why})`);
    }
  });
  return { ok: problems.length === 0, problems };
}
