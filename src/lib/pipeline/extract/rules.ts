/**
 * Rule-based extractor. Finds labelled table rows for dictionary metrics,
 * maps their numbers to year columns, detects units and context. Produces
 * PROPOSALS only (rule 7); every one goes through the evidence gate and
 * human review before it can reach the curated data.
 */
import { getMetric, METRICS, metricAppliesTo, type MetricDef } from "../../metrics/dictionary";
import type { Boundary, Consolidation, FiscalLabelConvention } from "../../schema/enums";
import { alignToYears, detectUnit, findNumbers, findYearHeader, type NumberToken } from "./parse";

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
  peerGroup: string;
  convention: FiscalLabelConvention;
  reportingYear: number | null;
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

/** True when the row must not be read as this metric even though its label matched. */
export function rowExcluded(metricId: string, canonicalUnit: string, row: string): boolean {
  if (canonicalUnit !== "%" && INTENSITY.test(row)) return true;
  if (/^ghg_scope[12]/.test(metricId) && COMBINED_SCOPES.test(row)) return true;
  if (metricId === "energy_total" && ENERGY_SUBTOTAL.test(row)) return true;
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

export function extractCandidates(pages: PageInput[], ctx: ExtractContext): Candidate[] {
  const fullText = pages.map((p) => p.text).join("\n");
  const docBoundary = detectBoundary(fullText);
  const docConsolidation = detectConsolidation(fullText);
  const metrics = METRICS.filter((m) => metricAppliesTo(m, ctx.peerGroup));
  const best = new Map<string, Candidate>();

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
        // Values are the numbers AFTER the label.
        const after = m.index + m[0].length;
        const tokens = findNumbers(line.text).filter((t) => t.index >= after);
        const isPct = def.canonicalUnit === "%";
        const values = tokens.filter((t) => (isPct ? true : !t.percent));
        if (values.length === 0) return;

        // Unit: this line, then the following line (wrapped labels), then the header area above.
        const context = [line.text, texts[i + 1] ?? "", ...texts.slice(Math.max(0, i - 25), i).reverse()];
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
        const tail = /(?:[\s|]+(?:\(?-?[\d,]+(?:\.\d+)?\)?\s?%?|[-–—]|n\/a|n\.a\.))+[\s|]*$/i.exec(line.text.slice(after));
        const tailStart = tail ? after + tail.index : line.text.length;
        const placeholders = tail
          ? [...tail[0].matchAll(/(?<=^|[\s|])(?:[-–—]|n\/a|n\.a\.)(?=$|[\s|])/gi)].map((m) => m.index! + tailStart)
          : [];
        if (header && placeholders.length) {
          const slots = [...values.filter((t) => t.index >= tailStart).map((t) => ({ at: t.index, token: t as NumberToken | null })), ...placeholders.map((at) => ({ at, token: null }))].sort((a, b) => a.at - b.at);
          if (slots.length !== header.years.length) return; // ambiguous columns (rule 1)
          mapped = slots.flatMap((sl, k) => (sl.token ? [{ year: header.years[k], token: sl.token }] : []));
        } else if (header) mapped = alignToYears(values, header.years);
        else if (values.length === 1 && ctx.reportingYear) mapped = [{ year: ctx.reportingYear, token: values[0] }];
        if (!mapped) return;

        for (const { year, token } of mapped) {
          let confidence = 0.45;
          if (header) confidence += 0.2;
          if (unitNear) confidence += 0.15;
          if (header && values.length === header.years.length) confidence += 0.1;
          if (def.core) confidence += 0.05;
          if (ocr) confidence -= 0.2; // OCR can misread digits: reviewers check the page image
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
          const key = `${cand.metricId}|${cand.year}|${cand.value}|${cand.unit}`;
          const prev = best.get(key);
          if (!prev || prev.confidence < cand.confidence) best.set(key, cand);
        }
      });
    }
  }
  return [...best.values()].sort((a, b) => a.metricId.localeCompare(b.metricId) || b.year - a.year);
}
