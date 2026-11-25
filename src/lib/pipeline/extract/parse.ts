/**
 * Pure parsing helpers for the rule-based extractor: numbers, units and
 * year-column headers. Ambiguity is resolved by NOT extracting (rule 1).
 */
import type { FiscalLabelConvention } from "../../schema/enums";

export interface NumberToken {
  value: number;
  raw: string;
  index: number;
  percent: boolean;
}

// Order matters: Indian lakh/crore grouping, then western grouping, then plain.
const NUMBER_RE =
  /(?<![\w.,])\(?-?(?:\d{1,2}(?:,\d{2})+,\d{3}|\d{1,3}(?:,\d{3})+|\d+)(?:\.\d+)?\)?(?:\s?%)?(?![\w,]*\d)/g;

/**
 * Finds numbers in a line. Space-grouped thousands ("1 811 947") are NOT
 * parsed: in table rows they are indistinguishable from adjacent cells.
 * Parenthesised numbers are negatives ("(30)%" = -30%).
 */
export function findNumbers(line: string): NumberToken[] {
  const out: NumberToken[] = [];
  // Mask framework codes (GRI "305-1", SASB "TC-SI-130a.1") so they are not read as values.
  let masked = line
    .replace(/\b[A-Z]{2}-[A-Z]{2}-\d{3}[a-z]\.\d+\b/g, (m) => " ".repeat(m.length))
    .replace(/\b\d{3}-\d+(?:-[a-z])?\b/g, (m) => " ".repeat(m.length));
  // Space-grouped thousands ("1 811 947") are ambiguous next to table cells: mask them entirely.
  masked = masked.replace(/(?<![\d.,])\d{1,3}(?: \d{3})+(?![\d.,])/g, (m) => (/ \d{3}/.test(m) ? "#".repeat(m.length) : m));
  for (const m of masked.matchAll(NUMBER_RE)) {
    const raw = m[0].trim();
    const percent = raw.endsWith("%");
    let core = raw.replace(/%$/, "").trim();
    const negative = core.startsWith("(") && core.endsWith(")");
    core = core.replace(/[()]/g, "");
    if (!/\d/.test(core)) continue;
    const value = Number(core.replace(/,/g, ""));
    if (!Number.isFinite(value)) continue;
    out.push({ value: negative ? -value : value, raw, index: m.index ?? 0, percent });
  }
  return out;
}

/** Every common printed form of a number, used by the evidence gate. */
export function numberForms(v: number): string[] {
  const forms = new Set<string>();
  const abs = Math.abs(v);
  const intPart = Math.trunc(abs);
  const decimals = abs === intPart ? "" : String(abs).split(".")[1] ?? "";
  const western = intPart.toLocaleString("en-US");
  const s = String(intPart);
  let indian = s;
  if (s.length > 3) {
    let head = s.slice(0, -3);
    const groups: string[] = [];
    while (head.length > 2) {
      groups.unshift(head.slice(-2));
      head = head.slice(0, -2);
    }
    if (head) groups.unshift(head);
    indian = `${groups.join(",")},${s.slice(-3)}`;
  }
  for (const base of [western, s, indian, western.replace(/,/g, " ")]) {
    forms.add(decimals ? `${base}.${decimals}` : base);
  }
  // Trailing-zero variants of decimals (2.8 printed as 2.80).
  if (decimals) for (const f of [...forms]) forms.add(`${f}0`);
  return [...forms];
}

// ---------------------------------------------------------------- units

interface UnitRule {
  unit: string;
  re: RegExp;
}

/** Unit patterns; units must match the metric dictionary keys. Case matters for Mt vs mt. */
export const UNIT_RULES: UnitRule[] = [
  { unit: "MtCO2e", re: /\bMtCO[2₂]e?\b|[Mm]illion (?:metric )?(?:tonnes|tons)\b|\bMillion metric\b/ },
  { unit: "ktCO2e", re: /\bktCO[2₂]e?\b|\bkt CO[2₂]|1,000 (?:metric )?(?:tonnes|tons) (?:of )?CO[2₂]|thousand (?:metric )?(?:tonnes|tons) (?:of )?CO[2₂]/i },
  // "CO equivalent" covers PDFs whose text layer dropped the subscript 2.
  { unit: "tCO2e", re: /\b(?:mt|t)CO[2₂]e?\b|\bt CO[2₂]|(?:metric )?(?:tonnes|tons) (?:of )?CO(?:[2₂]|\s?e\b|\s?eq|\s?equivalent)|MT CO[2₂]? ?e/i },
  { unit: "TWh", re: /\bTWh\b/ },
  { unit: "GWh", re: /\bGWh\b|thousands? MWh/i },
  { unit: "MWh", re: /\bMWh\b|megawatt[- ]hours/i },
  { unit: "TJ", re: /\bTJ\b|terajoules/i },
  { unit: "GJ", re: /\bGJ\b|gigajoules/i },
  { unit: "million m3", re: /\bMm[3³]\b|million (?:m[3³]|cubic met(?:er|re)s)|millions? m[3³]/i },
  { unit: "thousand m3", re: /thousand (?:m[3³]|cubic)/i },
  { unit: "million gallons", re: /million gallons/i },
  { unit: "ML", re: /\bML\b|megalit(?:er|re)s/ },
  { unit: "kL", re: /\bkL\b|kilolit(?:er|re)s/i },
  { unit: "thousand tonnes", re: /1,000 tonnes(?! ?CO)/i },
  { unit: "m3", re: /\bm[3³]\b|cubic met(?:er|re)s/i },
  { unit: "kt", re: /\bkt\b(?! ?CO)|thousands? (?:metric )?tonnes(?! ?(?:of )?CO)/i },
  { unit: "lb", re: /\bpounds\b|\blbs?\b/i },
  { unit: "t", re: /\bmetric (?:tonnes|tons)\b(?! ?(?:of )?CO)|\btonnes\b(?! ?(?:of )?CO)|\bmt\b(?!CO)/i },
  { unit: "%", re: /%|\bpercent\b/i },
];

/** First unit found in `text` that the metric accepts. */
export function detectUnit(text: string, accepted: string[]): string | null {
  for (const r of UNIT_RULES) {
    if (!accepted.includes(r.unit)) continue;
    if (r.re.test(text)) {
      // Water reported in "1,000 tonnes" must not be read as kt of waste etc.; accepted list guards that.
      return r.unit;
    }
  }
  return null;
}

// ---------------------------------------------------------------- years

export interface YearHeader {
  years: number[];
  lineIndex: number;
}

/**
 * Parses a column-header line into fiscal-year labels in column order.
 * Handles "2023 | 2024 | 2025", "FY20 FY21 … FY25", "FY2024 FY2025", "FY 2025-26 | FY 2024-25",
 * "(2018) 2022 2023". "FY 2025-26" maps to 2026 for end-year labelling and
 * 2025 for start-year labelling.
 */
export function parseYearHeader(line: string, convention: FiscalLabelConvention): number[] | null {
  const years: number[] = [];
  // "FY 2025-26", "FY2025" (the company's own label), "FY25", "(2018) 2022".
  const re = /\bFY\s?(\d{4})\s?[-–/]\s?(\d{2,4})\b|\bFY\s?((?:19|20)\d{2})\b|\bFY\s?'?(\d{2})\b|\(?\b((?:19|20)\d{2})\b\)?/g;
  let other = line;
  for (const m of line.matchAll(re)) {
    if (m[1] && m[2]) {
      const start = Number(m[1]);
      years.push(convention === "start_year" ? start : start + 1);
    } else if (m[3]) {
      years.push(Number(m[3]));
    } else if (m[4]) {
      years.push(2000 + Number(m[4]));
    } else if (m[5]) {
      years.push(Number(m[5]));
    }
    other = other.replace(m[0], "");
  }
  if (years.length < 2) return null;
  // A header line is mostly years: little other numeric content.
  if (findNumbers(other).length > years.length) return null;
  if (years.some((y) => y < 1990 || y > 2100)) return null;
  return years;
}

/** Nearest year header above `lineIndex` (within `lookback` lines). */
export function findYearHeader(lines: string[], lineIndex: number, convention: FiscalLabelConvention, lookback = 40): YearHeader | null {
  for (let i = lineIndex - 1; i >= Math.max(0, lineIndex - lookback); i--) {
    const years = parseYearHeader(lines[i], convention);
    if (years) return { years, lineIndex: i };
  }
  return null;
}

/**
 * Maps the numbers of a data row onto year columns. Values align to the
 * RIGHT when a row has fewer values than columns (missing early years),
 * which is the common table layout. Returns null when there are more values
 * than columns (mixed table, ambiguous).
 */
export function alignToYears(values: NumberToken[], years: number[]): { year: number; token: NumberToken }[] | null {
  if (values.length === 0 || values.length > years.length) return null;
  const offset = years.length - values.length;
  return values.map((token, i) => ({ year: years[offset + i], token }));
}
