/**
 * Rule-based extractor. Finds labelled table rows for dictionary metrics,
 * maps their numbers to year columns, detects units and context. Produces
 * PROPOSALS only (rule 7); every one goes through the evidence gate and
 * human review before it can reach the curated data.
 */
import { getMetric, METRICS, metricAppliesTo, type MetricDef } from "../../metrics/dictionary";
import type { Boundary, Consolidation, FiscalLabelConvention } from "../../schema/enums";
import { alignToYears, detectUnit, findNumbers, findYearHeader, isUnitCell, type NumberToken } from "./parse";

export interface PageInput {
  pageNumber: number;
  label: string;
  text: string;
  /** Spreadsheet cells by address, when the page is a sheet. */
  cells?: Record<string, string>;
  isScanned?: boolean;
}

export interface Candidate {
  metricId: string;
  year: number;
  value: number;
  unit: string;
  pageNumber: number;
  pageLabel: string;
  cell: string | null;
  reportedWording: string;
  boundary: Boundary;
  consolidation: Consolidation;
  scope2Method: "market" | "location" | null;
  confidence: number;
}

export interface ExtractContext {
  /** The company's SASB industry codes; decide which industry metrics are read. */
  industryCodes: string[];
  convention: FiscalLabelConvention;
  reportingYear: number | null;
  /** Columns for later years are targets, not reported values (default: the current calendar year). */
  maxYear?: number;
}

/** A metric/year the extractor saw but did not propose, and why (rule 1: ambiguity is a gap, not a guess). */
export interface Skipped {
  metricId: string;
  year: number;
  values: number[];
  reason: string;
}

/** Row-label patterns per metric. Tighter than raw synonyms to avoid "Scope 1 and 2" style rows. */
const LABELS: Record<string, RegExp> = {
  ghg_scope1: /\b(?:gross |total |direct )?(?:emissions? )?\(?scope[ -]?1\)?(?! *(?:and|&|\+|,|-|–) *(?:scope *)?2)(?![\d.])/i,
  ghg_scope2_market: /scope[ -]?2\b[^|]*market|market[- ]based(?![^|]*scope 1)/i,
  ghg_scope2_location: /scope[ -]?2\b[^|]*(?:location|region)|location[- ]based(?![^|]*scope 1)/i,
  ghg_scope3_total: /(?:total|gross|subtotal)[^|]*scope[ -]?3|scope[ -]?3 (?:ghg )?emissions(?:\s*\||\s*$| \(total\))|^scope[ -]?3(?:\s*\([^)|]*\))?\s*\|/i,
  energy_total: /total (?:energy consum|energy use)|energy consumption (?:within the organi[sz]ation|at business sites)\b|^total energy\b/i,
  renewable_electricity_share: /renewable (?:energy \(electricity\) transition rate|electricity (?:percentage|share|rate))|percentage of (?:direct )?renewable electricity|total [\w ]*renewable electricity/i,
  water_withdrawal: /(?:total )?(?:volume of )?water withdra(?:wal|wn)/i,
  water_consumption: /(?:total )?(?:volume of )?water consum(?:ption|ed)\b/i,
  waste_total: /total (?:weight of |amount of )?(?:hazardous and non-hazardous )?waste generated|amount of waste generated|^total waste\b/i,
  waste_diversion_rate: /(?:landfill )?diversion rate|percentage of waste recovered/i,
};

const SCOPE3_NAMES: Record<number, RegExp> = {
  1: /purchased (?:goods|products) and services/i,
  2: /capital goods/i,
  3: /fuel[- ]and[- ]energy[- ]related/i,
  4: /upstream transport(?:ation)? and distribution/i,
  5: /waste generated in operations/i,
  6: /business trav/i,
  7: /employee commut/i,
  8: /upstream leased assets/i,
  9: /downstream transport(?:ation)? and distribution/i,
  10: /processing of sold products/i,
  11: /use of sold products/i,
  12: /end[- ]of[- ]life treatment/i,
  13: /downstream leased assets/i,
  14: /franchises/i,
  15: /\binvestments\b/i,
};

function labelFor(def: MetricDef): RegExp | null {
  const cat = /^ghg_scope3_c(\d+)$/.exec(def.id);
  if (cat) {
    const n = Number(cat[1]);
    return new RegExp(`(?:\\b(?:category|cat\\.?)\\s*${n}\\b(?!\\d)|^\\s*${n}\\.?\\s+${SCOPE3_NAMES[n].source}|${SCOPE3_NAMES[n].source})`, "i");
  }
  if (LABELS[def.id]) return LABELS[def.id];
  // Industry metrics: fall back to English synonyms from the dictionary.
  const en = def.synonyms.filter((s) => /^[\x00-\x7f]+$/.test(s) && s.length > 4);
  return en.length ? new RegExp(en.map((s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|"), "i") : null;
}

/** Ratios ("per rupee of turnover", "GJ/million rupees", "intensity") are never absolute totals. */
const INTENSITY = /intensity|\bper (?:rupee|unit|employee|million|thousand|tonne|ton|\$|usd|eur|revenue|sales|square|m2|product)|\/\s*(?:revenue|turnover|sales|million|employee|unit)|\bratio\b/i;
/** Rows that add Scope 1 and Scope 2 together. */
const COMBINED_SCOPES = /scope[ -]?1\s*(?:and|&|\+|,|\/)\s*(?:scope[ -]?)?2\b/i;
/** Energy rows limited to renewable or non-renewable sources are subtotals, not total energy. */
const ENERGY_SUBTOTAL = /\b(?:non-?)?renewable\b|\bfossil\b|\bfrom (?:non-?)?renewable/i;
/** Per-gas breakdown rows ("Scope 1 – CH4") are parts of the total, not the total. */
const GAS_ROW = /scope[ -]?[123]\s*(?:[–—-]|:)?\s*(?:CO2|CO₂|CH4|CH₄|N2O|N₂O|HFCs?|PFCs?|SF6|SF₆|NF3|NF₃)\b|\btherein\b/i;
/** "Percentage of Scope 1 …", "share of …": a ratio row, never an absolute total. */
const SHARE_ROW = /\b(?:percentage|share|proportion|portion) of\b|%\s*of\b/i;
/** Water rows limited to water-stressed areas are subsets of the total. */
const WATER_SUBSET = /water[- ]stress|(?:regions?|areas?|sites?) with (?:high|extremely high|baseline)/i;
/** Rows totalling all scopes are not Scope 2. */
const ALL_SCOPES = /total (?:gross )?(?:ghg |greenhouse gas )?emissions/i;
/** Waste rows that are a disposal route or a waste type, not total waste generated. */
const WASTE_PART = /waste (?:prevented|avoided|diverted|recycled|reused|recovered|to landfill|landfilled|incinerated)|\b(?<!non-)hazardous waste\b(?! and)/i;
/** Division, segment or subsidiary context before a row. */
const SEGMENT = /\b(?:division|segment|subsidiar(?:y|ies)|business unit)\b/i;
/** Footnote lines: "1) …", "2. Emissions are calculated …". */
const FOOTNOTE = /^\s*\d{1,2}\)\s|^\s*\d{1,2}\.?\s+[A-Z][a-z]+(?:\s+[a-z]+){4,}/;

/** True when the row must not be read as this metric even though its label matched. */
export function rowExcluded(metricId: string, canonicalUnit: string, row: string): boolean {
  if (canonicalUnit !== "%" && INTENSITY.test(row)) return true;
  if (/^ghg_scope[12]/.test(metricId) && COMBINED_SCOPES.test(row)) return true;
  if (metricId === "energy_total" && ENERGY_SUBTOTAL.test(row)) return true;
  if (canonicalUnit !== "%" && SHARE_ROW.test(row)) return true;
  if (/^ghg_scope[123]_?(?:total)?$|^ghg_scope[12]/.test(metricId) && GAS_ROW.test(row)) return true;
  if (/^water_/.test(metricId) && WATER_SUBSET.test(row)) return true;
  if (/^ghg_scope2_/.test(metricId) && ALL_SCOPES.test(row) && !/scope[ -]?2\b/i.test(row)) return true;
  if (metricId === "waste_total" && WASTE_PART.test(row) && !/hazardous and non-hazardous|non-hazardous and hazardous/i.test(row)) return true;
  if (FOOTNOTE.test(row)) return true;
  return false;
}

export function detectBoundary(text: string): Boundary {
  if (/\bstandalone\b|\bstand-alone\b/i.test(text)) return "parent_only";
  if (/consolidated (?:subsidiaries|group|basis|financial statements)|and its consolidated subsidiaries/i.test(text)) return "consolidated_group";
  return "not_stated";
}

export function detectConsolidation(text: string): Consolidation {
  if (/operational control/i.test(text)) return "operational_control";
  if (/financial control/i.test(text)) return "financial_control";
  if (/equity[- ]share approach|equity share basis/i.test(text)) return "equity_share";
  return "not_stated";
}

interface Line {
  text: string;
  /** For sheets: cell address of each value token, by token index. */
  cellOf?: (token: NumberToken) => string | null;
}

function linesOf(page: PageInput): Line[] {
  if (!page.cells) return page.text.split("\n").map((text) => ({ text }));
  // Rebuild rows from cells so every number keeps its cell address.
  const rows = new Map<number, { col: number; addr: string; text: string }[]>();
  for (const [addr, text] of Object.entries(page.cells)) {
    const m = /^([A-Z]+)(\d+)$/.exec(addr);
    if (!m) continue;
    const col = [...m[1]].reduce((n, ch) => n * 26 + ch.charCodeAt(0) - 64, 0);
    const row = Number(m[2]);
    if (!rows.has(row)) rows.set(row, []);
    rows.get(row)!.push({ col, addr, text });
  }
  const sheetName = page.label.replace(/^Sheet: /, "");
  return [...rows.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([, cells]) => {
      cells.sort((a, b) => a.col - b.col);
      let text = "";
      const spans: { start: number; end: number; addr: string }[] = [];
      for (const c of cells) {
        if (text) text += " | ";
        spans.push({ start: text.length, end: text.length + c.text.length, addr: c.addr });
        text += c.text;
      }
      return {
        text,
        cellOf: (t: NumberToken) => {
          const s = spans.find((x) => t.index >= x.start && t.index < x.end);
          return s ? `${sheetName}!${s.addr}` : null;
        },
      };
    });
}

/** Unit phrases that contain digits ("1,000 tonnes CO2e", "('000 t)") are masked so their digits are not read as values. */
const UNIT_WITH_DIGITS = /\(?\b(?:in\s+)?1,000\s*(?:metric\s+)?(?:tonnes|tons|t|m3|m³|MWh|GJ|units)\b(?:\s*(?:of\s+)?CO[2₂]?\s?e?q?)?\)?|\(\s*'000[^)]*\)/gi;
const maskUnits = (line: string) => line.replace(UNIT_WITH_DIGITS, (m) => " ".repeat(m.length));
const isYearToken = (t: NumberToken) => /^\(?(?:19|20)\d{2}\)?$/.test(t.raw.trim());

/** Proposals plus the metric/years skipped as ambiguous. */
export function extractWithDiagnostics(pages: PageInput[], ctx: ExtractContext): { candidates: Candidate[]; skipped: Skipped[] } {
  const fullText = pages.map((p) => p.text).join("\n");
  const docBoundary = detectBoundary(fullText);
  const docConsolidation = detectConsolidation(fullText);
  const metrics = METRICS.filter((m) => metricAppliesTo(m, ctx.industryCodes));
  const maxYear = ctx.maxYear ?? new Date().getFullYear();
  const found: Candidate[] = [];

  for (const page of pages) {
    const ocr = page.label.endsWith("(OCR)");
    if (page.isScanned && !ocr) continue; // image only, no readable text
    const lines = linesOf(page);
    const texts = lines.map((l) => l.text);
    const pageBoundary = detectBoundary(page.text);
    for (const def of metrics) {
      const label = labelFor(def);
      if (!label) continue;
      const units = Object.keys(getMetric(def.id).units);
      lines.forEach((line, i) => {
        const m = label.exec(line.text);
        if (!m) return;
        if (/^ghg_scope3_c/.test(def.id) === false && /\bcategor(?:y|ies)\b/i.test(line.text) && def.id === "ghg_scope3_total") return;
        if (rowExcluded(def.id, def.canonicalUnit, line.text)) return;
        // Values are the numbers AFTER the label, up to the next label cell of a multi-column row.
        const after = m.index + m[0].length;
        const text = maskUnits(line.text);
        const cells = text.slice(after).split("|");
        let end = text.length;
        let pos = after;
        for (let k = 0; k < cells.length; k++) {
          const cell = cells[k];
          // A cell after the label's own cell that holds words but no number and is not a unit: another label.
          if (k > 0 && /[A-Za-z]{3,}/.test(cell) && !/\d/.test(cell) && !isUnitCell(cell)) {
            end = pos;
            break;
          }
          pos += cell.length + 1;
        }
        // The label is followed directly by another label: the numbers belong to that one.
        const firstNum = findNumbers(text).find((t) => t.index >= after);
        if (firstNum && firstNum.index > end) return;
        const tokens = findNumbers(text).filter((t) => t.index >= after && t.index < end);
        const isPct = def.canonicalUnit === "%";
        const values = tokens.filter((t) => (isPct ? true : !t.percent));
        if (values.length === 0) return;

        // Unit: this line, then the following line (wrapped labels), then the header area above.
        const headerAt = findYearHeader(texts, i, ctx.convention)?.lineIndex ?? i - 25;
        const context = [line.text, texts[i + 1] ?? "", ...texts.slice(Math.max(0, Math.min(i - 25, headerAt - 4)), i).reverse()];
        let unit: string | null = null;
        let unitNear = false;
        for (let k = 0; k < context.length && !unit; k++) {
          unit = detectUnit(context[k], units);
          if (unit && k <= 1) unitNear = true;
        }
        if (!unit) return; // ambiguous unit → do not propose (rule 1)

        const header = findYearHeader(texts, i, ctx.convention);
        let mapped: { year: number; token: NumberToken }[] | null = null;
        // Empty cells printed as "-" / "–" / "n/a" keep their column: align by cell position, or skip when unclear.
        // Only dashes inside the trailing run of cells count; a dash in a label ("Category 3 – Fuel") does not.
        const seg = text.slice(after, end);
        const tail = /(?:[\s|]+(?:\(-?[\d,]+(?:\.\d+)?\)\s?%?|-?[\d,]+(?:\.\d+)?\*?\s?%?|[-–—]|n\/a|n\.a\.))+[\s|*◆]*$/i.exec(seg);
        const tailStart = tail ? after + tail.index : end;
        const placeholders = tail
          ? [...tail[0].matchAll(/(?<=^|[\s|])(?:[-–—]|n\/a|n\.a\.)(?=$|[\s|])/gi)].map((m) => m.index! + tailStart)
          : [];
        // Percentages in a row of absolute values are their own columns (e.g. "change %"): they take a slot, never a value.
        const pctSlots = isPct ? [] : tokens.filter((t) => t.percent && t.index >= tailStart).map((t) => t.index);
        if (header && (placeholders.length || pctSlots.length)) {
          let slots = [
            ...values.filter((t) => t.index >= tailStart).map((t) => ({ at: t.index, token: t as NumberToken | null })),
            ...[...placeholders, ...pctSlots].map((at) => ({ at, token: null })),
          ].sort((a, b) => a.at - b.at);
          // One trailing non-year column (e.g. "Annual % target") after the year columns, when the header shows one.
          const headerText = texts[header.lineIndex];
          const lastYear = String(header.years[header.years.length - 1]);
          const extraColumn = /[A-Za-z%]/.test(headerText.slice(headerText.lastIndexOf(lastYear.slice(-2)) + 2));
          if (extraColumn && slots.length === header.years.length + 1 && slots[slots.length - 1].token === null) slots = slots.slice(0, -1);
          if (slots.length !== header.years.length) return; // ambiguous columns (rule 1)
          mapped = slots.flatMap((sl, k) => (sl.token ? [{ year: header.years[k], token: sl.token }] : []));
        } else if (header) mapped = alignToYears(values, header.years);
        else if (values.length === 1 && ctx.reportingYear) mapped = [{ year: ctx.reportingYear, token: values[0] }];
        if (!mapped) return;

        for (const { year, token } of mapped) {
          if (year > maxYear) continue; // a target column, not a reported value
          if (!isPct && isYearToken(token)) continue; // a year printed in the row, not a value
          let confidence = 0.45;
          if (header) confidence += 0.2;
          if (unitNear) confidence += 0.15;
          if (header && values.length === header.years.length) confidence += 0.1;
          if (def.core) confidence += 0.05;
          if (ocr) confidence -= 0.2; // OCR can misread digits: reviewers check the page image
          // Plausibility: footnote-like small integers and numbers followed by prose in the same cell.
          if (!isPct && Number.isInteger(token.value) && Math.abs(token.value) < 10 && !/[.,]/.test(token.raw)) confidence -= 0.3;
          const rest = text.slice(token.index + token.raw.length, token.index + token.raw.length + 30);
          if (/^\s?\*?\s?[A-Za-z]{3,}/.test(rest) && !isUnitCell(rest.split("|")[0])) confidence -= 0.15;
          // A row inside a division/segment/subsidiary table is not the group figure.
          if (SEGMENT.test(line.text.slice(0, m.index)) || SEGMENT.test(texts.slice(Math.max(0, i - 2), i).join(" "))) confidence -= 0.15;
          const cand: Candidate = {
            metricId: def.id,
            year,
            value: token.value,
            unit,
            pageNumber: page.pageNumber,
            pageLabel: page.label,
            cell: line.cellOf ? line.cellOf(token) : null,
            reportedWording: line.text.slice(0, 400),
            boundary: pageBoundary !== "not_stated" ? pageBoundary : docBoundary,
            consolidation: docConsolidation,
            scope2Method: def.id.endsWith("_market") ? "market" : def.id.endsWith("_location") ? "location" : null,
            confidence: Math.min(0.95, Math.round(confidence * 100) / 100),
          };
          found.push(cand);
        }
      });
    }
  }
  return choose(found);
}

/**
 * One proposal per metric and year. The same value printed in several places
 * supports itself (small bonus per extra occurrence); when two different
 * values remain equally likely, neither is proposed and the pair is reported
 * as skipped (ambiguity is a gap, not a guess).
 */
function choose(found: Candidate[]): { candidates: Candidate[]; skipped: Skipped[] } {
  const groups = new Map<string, Candidate[]>();
  for (const c of found) groups.set(`${c.metricId}|${c.year}`, [...(groups.get(`${c.metricId}|${c.year}`) ?? []), c]);
  const candidates: Candidate[] = [];
  const skipped: Skipped[] = [];
  for (const list of groups.values()) {
    const byValue = new Map<string, Candidate[]>();
    for (const c of list) {
      const canon = getMetric(c.metricId).units[c.unit] * c.value;
      const k = String(Math.round(canon * 1e6) / 1e6);
      byValue.set(k, [...(byValue.get(k) ?? []), c]);
    }
    const scored = [...byValue.values()]
      .map((same) => {
        const top = same.reduce((a, b) => (b.confidence > a.confidence ? b : a));
        return { c: top, score: top.confidence + Math.min(0.1, 0.05 * (same.length - 1)) };
      })
      .sort((a, b) => b.score - a.score);
    const [first, second] = scored;
    if (first.score < 0.3) {
      skipped.push({ metricId: first.c.metricId, year: first.c.year, values: scored.map((x) => x.c.value), reason: "only low-plausibility numbers (footnote-like or in prose)" });
      continue;
    }
    if (second && first.score - second.score < 0.02) {
      skipped.push({ metricId: first.c.metricId, year: first.c.year, values: scored.map((x) => x.c.value), reason: "different values equally likely" });
      continue;
    }
    candidates.push({ ...first.c, confidence: Math.min(0.95, Math.round(first.score * 100) / 100) });
  }
  candidates.sort((a, b) => a.metricId.localeCompare(b.metricId) || b.year - a.year);
  return { candidates, skipped };
}

export function extractCandidates(pages: PageInput[], ctx: ExtractContext): Candidate[] {
  return extractWithDiagnostics(pages, ctx).candidates;
}
