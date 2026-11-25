/**
 * The automatic evidence gate every AI summary must pass before it is shown
 * (the user-approved alternative to human review, decided 2026-11-25). It is
 * deterministic: no model judges another model.
 *
 * Each sentence must be fully supported by the facts it cites:
 *  - citations exist; every number appears in a cited fact, next to the same
 *    year and with the same unit as in that fact;
 *  - every metric, method and target phrase it names appears in a cited fact
 *    (no "Scope 3" sentence backed by a Scope 1 fact);
 *  - trend words (rose, fell, reduced) need a cited year-on-year change fact
 *    with the same direction; one year's value is never a trend;
 *  - derived changes are called calculated/derived, never "reported";
 *  - gap wording matches the gap's state (not disclosed / not found / not assessed);
 *  - a value on another boundary or partial coverage keeps that qualifier;
 *  - no causation, comparisons, rankings, target-status judgements,
 *    forecasts, magnitude adjectives or spelled-out quantities.
 *
 * Problems are "hard" (a claim the facts do not support: never publishable,
 * not even by a reviewer) or "wording" (style rules a reviewer may accept in
 * the manual-review fallback). A summary with any problem is never published
 * automatically.
 */
import type { Fact } from "./facts";

export interface Sentence {
  text: string;
  citations: string[];
}

export type ProblemKind = "hard" | "wording";

export interface Problem {
  sentence: number | null;
  kind: ProblemKind;
  message: string;
}

export interface CheckResult {
  ok: boolean;
  /** Human-readable, one per problem (kept for the audit log and older callers). */
  problems: string[];
  details: Problem[];
  /** True when every problem is a wording problem (a reviewer may approve it). */
  reviewable: boolean;
}

const NUMBER = /[-+]?\d[\d,]*(?:\.\d+)?/g;
const isYear = (n: string) => /^(19|20)\d{2}$/.test(n);

/** Numbers as plain values: "55,200" -> "55200", "+3.5" -> "3.5", "2030" -> "2030". */
export function numbersIn(s: string): string[] {
  return (s.match(NUMBER) ?? []).map((n) => n.replace(/[+,]/g, "").replace(/^-/, "")).map((n) => (n.includes(".") ? String(Number(n)) : n));
}

const UNITS = ["tCO2e", "ktCO2e", "MtCO2e", "MWh", "GWh", "TWh", "GJ", "TJ", "ML", "m3", "kL", "kt", "Mt", "t", "%", "units"];
const UNIT_AFTER = new RegExp(`(\\d[\\d,]*(?:\\.\\d+)?)\\s?(${UNITS.map((u) => u.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|")})(?![A-Za-z0-9])`, "g");
/** "55,200 tCO2e" → ["55200|tCO2e"]. */
function numberUnits(s: string): string[] {
  return [...s.matchAll(UNIT_AFTER)].map((m) => `${numbersIn(m[1])[0]}|${m[2]}`);
}

/** Phrases a sentence may use only if a cited fact contains the same phrase (same regex). */
const GROUNDED: [RegExp, string][] = [
  [/\bscope\s?1\b/i, "Scope 1"],
  [/\bscope\s?2\b/i, "Scope 2"],
  [/\bscope\s?3\b/i, "Scope 3"],
  [/\bmarket[- ]based\b/i, "market-based"],
  [/\blocation[- ]based\b/i, "location-based"],
  [/\benergy\b/i, "energy"],
  [/\brenewable\b/i, "renewable"],
  [/\bwater withdrawal|withdr[ae]w\w* water\b/i, "water withdrawal"],
  [/\bwater consumption|consum\w* water\b/i, "water consumption"],
  [/\bwaste\b/i, "waste"],
  [/\bdiver(?:sion|ted)\b/i, "waste diversion"],
  [/\bnet[- ]zero\b/i, "net zero"],
  [/\bcarbon[- ]neutral\w*/i, "carbon neutral"],
  [/1\.5\s?°?\s?C/i, "1.5°C"],
  [/\bwell[- ]below\b/i, "well-below 2°C"],
  [/\bscience[- ]based\b|\bSBTi\b/i, "SBTi / science-based"],
  [/\bvalidat\w*/i, "validation"],
  [/\bassur\w*/i, "assurance"],
  [/\bnot disclos\w*|\b(?:does|did) not (?:disclose|report)\b|\bundisclosed\b/i, "not disclosed"],
  [/\bnot found\b|\bcould not be found\b/i, "not found"],
  [/\bnot assessed\b/i, "not assessed"],
  [/\bintensity\b/i, "intensity"],
  [/\bplastic\w*/i, "plastic"],
  [/\bdeforestation\b/i, "deforestation"],
];

const UP = /\b(increas\w*|rose|risen|rising|grew|grown|growth|climb\w*|went up|up by)\b/i;
const DOWN = /\b(decreas\w*|declin\w*|fell|fallen|falling|dropp?\w*|reduc\w*|lower(?:ed)?|went down|down by|cut)\b/i;

const RULES: [RegExp, ProblemKind, string][] = [
  [/\b(because|due to|driven by|thanks to|as a result|result(?:ed|ing)? (?:of|from|in)|owing to|attribut\w+ to|led to|lead to|caused?|leading to|reflect\w*|enabled by|contribut\w+ to)\b/i, "hard", "states a cause the facts do not contain"],
  [/\b(on track|off track|ahead of|behind (?:its|the|schedule)|achiev\w*|met (?:its|the)|missed|aligned with|consistent with|in line with|compliant)\b/i, "hard", "judges target status, which the facts do not state"],
  [/\b(best|worst|leading|leader|laggard|top|outperform\w*|underperform\w*|rank\w*|peers?|competitors?|industry average|average|typical|more than|less than|fewer than|higher than|lower than|exceed\w*|relative to)\b/i, "hard", "comparison or ranking"],
  [/\b(improv\w*|worsen\w*|deteriorat\w*|progress\w*|success\w*|fail\w*)\b/i, "hard", "interprets a change as better or worse"],
  [/\b(will|likely|expected to|should|must|could|may|plans? to|on course)\b/i, "wording", "forecast or speculation"],
  [/\b(impressive|disappointing|excellent|poor|strong|weak|significant\w*|substantial\w*|considerabl\w*|remarkabl\w*|notabl\w*|ambitious|robust|solid|commendabl\w*|concerning|alarming|modest\w*|marginal\w*|sharp\w*|dramatic\w*|slight\w*|steep\w*|huge|massive|tiny)\b/i, "wording", "judgement or magnitude adjective"],
  [/\b(half|double[ds]?|tripled?|quadrupled?|one|two|three|four|five|six|seven|eight|nine|ten|dozen|hundred|thousand|million|billion)\b/i, "hard", "spelled-out quantity"],
];

function changeDirection(f: Fact): "up" | "down" | "flat" | null {
  const m = /a change of ([+-]?)(\d+(?:\.\d+)?)%/.exec(f.text);
  if (!m) return null;
  if (Number(m[2]) === 0) return "flat";
  return m[1] === "-" ? "down" : "up";
}

/** Nearest year (1990-2100, or FYxxxx) to a position in the sentence. */
function nearestYear(s: string, at: number): string | null {
  let best: { y: string; d: number } | null = null;
  for (const m of s.matchAll(/\b(?:FY\s?)?((?:19|20)\d{2})\b/g)) {
    const d = Math.abs((m.index ?? 0) - at);
    if (!best || d < best.d) best = { y: m[1], d };
  }
  return best?.y ?? null;
}

export function checkSummary(sentences: Sentence[], facts: Fact[]): CheckResult {
  const details: Problem[] = [];
  const add = (sentence: number | null, kind: ProblemKind, message: string) => details.push({ sentence, kind, message });
  const byId = new Map(facts.map((f) => [f.id, f]));
  if (sentences.length < 2 || sentences.length > 6) add(null, "wording", `has ${sentences.length} sentences (2 to 6 allowed)`);

  sentences.forEach((s, i) => {
    const n = i + 1;
    const text = s.text.trim();
    const words = text.split(/\s+/).length;
    if (words > 45) add(n, "wording", `sentence ${n} has ${words} words (45 allowed)`);
    if (!s.citations.length) add(n, "hard", `sentence ${n} cites nothing`);
    const cited: Fact[] = [];
    for (const c of s.citations) {
      const f = byId.get(c);
      if (f) cited.push(f);
      else add(n, "hard", `sentence ${n} cites unknown fact ${c}`);
    }
    const factText = cited.map((f) => f.text).join("\n");

    // Numbers, each bound to its year and unit as written in one cited fact.
    const allowed = new Set(cited.flatMap((f) => numbersIn(f.text)));
    for (const m of text.matchAll(NUMBER)) {
      const num = numbersIn(m[0])[0];
      if (!allowed.has(num)) {
        add(n, "hard", `sentence ${n}: "${num}" is not in the facts it cites`);
        continue;
      }
      if (isYear(num)) continue;
      const year = nearestYear(text, m.index ?? 0);
      if (year && !cited.some((f) => numbersIn(f.text).includes(num) && numbersIn(f.text).includes(year))) {
        add(n, "hard", `sentence ${n}: "${num}" is not given for ${year} in the facts it cites`);
      }
    }
    const factUnits = new Set(cited.flatMap((f) => numberUnits(f.text)));
    for (const nu of numberUnits(text)) {
      if (!factUnits.has(nu)) add(n, "hard", `sentence ${n}: "${nu.replace("|", " ")}" does not match the unit in the facts it cites`);
    }

    // Named metrics, methods and target phrases must be in a cited fact.
    for (const [re, name] of GROUNDED) {
      if (re.test(text) && !re.test(factText)) add(n, "hard", `sentence ${n} mentions ${name}, which no cited fact contains`);
    }

    // Trends: only from cited year-on-year change facts, in the same direction.
    const changes = cited.filter((f) => f.kind === "change");
    const targets = cited.filter((f) => f.kind === "target");
    for (const [re, dir] of [
      [UP, "up"],
      [DOWN, "down"],
    ] as const) {
      const m = re.exec(text);
      if (!m) continue;
      // Target wording ("a 62% reduction target") is allowed when the cited target fact uses it.
      const word = m[0].toLowerCase().slice(0, 5);
      if (targets.some((t) => t.text.toLowerCase().includes(word))) continue;
      if (!changes.length) add(n, "hard", `sentence ${n}: "${m[0]}" describes a trend, but it cites no year-on-year change (one year's value is not a trend)`);
      else if (!changes.some((c) => changeDirection(c) === dir)) add(n, "hard", `sentence ${n}: "${m[0]}" contradicts the direction of the cited change`);
    }
    if (changes.length && changes.some((c) => numbersIn(text).some((x) => !isYear(x) && numbersIn(c.text.split("a change of")[1] ?? "").includes(x)))) {
      if (!/\b(calculat\w*|derived)\b/i.test(text)) add(n, "hard", `sentence ${n} uses a calculated change without saying it is calculated from reported figures`);
    }
    if (changes.length && /\breport\w*\b/i.test(text) && (UP.test(text) || DOWN.test(text)) && !/\b(calculat\w*|derived)\b/i.test(text)) {
      add(n, "hard", `sentence ${n} presents a calculated change as reported`);
    }

    // Boundary and coverage qualifiers travel with the value.
    for (const f of cited.filter((x) => x.kind === "value" || x.kind === "change")) {
      if (/\bparent only\b/i.test(f.text) && !/\bparent\b|\bstandalone\b/i.test(text)) add(n, "hard", `sentence ${n} drops the "parent only" boundary of ${f.id}`);
      if (/\bsubsidiary only\b/i.test(f.text) && !/\bsubsidiar/i.test(text)) add(n, "hard", `sentence ${n} drops the "subsidiary only" boundary of ${f.id}`);
      if (/\(not stated[;)]/i.test(f.text) && !/\bboundary\b|\bnot stated\b/i.test(text)) add(n, "hard", `sentence ${n} omits that the boundary of ${f.id} is not stated`);
      if (/coverage: /i.test(f.text) && !/\bcover\w*|\bonly\b|\bexclud\w*|\bpart of\b/i.test(text)) add(n, "hard", `sentence ${n} omits the partial coverage of ${f.id}`);
    }

    for (const [re, kind, why] of RULES) {
      const m = re.exec(text);
      if (m && !(kind === "hard" && why.startsWith("judges target") && re.test(factText))) add(n, kind, `sentence ${n}: "${m[0]}" (${why})`);
    }
  });

  const problems = details.map((d) => d.message);
  return { ok: details.length === 0, problems, details, reviewable: details.length > 0 && details.every((d) => d.kind === "wording") };
}
