/**
 * Rule 6, evidence-gated approval: an extracted value may only be approved
 * when it is found again in the STORED page text (or spreadsheet cell).
 * Failing values are blocked; overriding needs a reason and an approver.
 */
import { numberForms } from "./extract/parse";

export interface EvidenceInput {
  value: number | null;
  textValue?: string | null;
  reportedWording: string;
  pageText: string;
  cells?: Record<string, string> | null;
  cell?: string | null;
}

export interface EvidenceResult {
  ok: boolean;
  detail: string;
}

/** Collapse whitespace and table pipes so layout differences do not matter. */
export function normalizeForMatch(s: string): string {
  return s
    .replace(/[ \s|]+/g, " ")
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/[–—]/g, "-")
    .trim()
    .toLowerCase();
}

function containsNumber(haystack: string, v: number): boolean {
  const h = ` ${haystack} `;
  return numberForms(v).some((f) => {
    const esc = f.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    return new RegExp(`(?<![\\d.,])\\(?${esc}\\)?(?![\\d]|[.,]\\d)`).test(h);
  });
}

export function verifyEvidence(e: EvidenceInput): EvidenceResult {
  if (e.cell) {
    const addr = e.cell.split("!").pop()!;
    const raw = e.cells?.[addr];
    if (raw === undefined) return { ok: false, detail: `cell ${e.cell} not found in stored sheet` };
    if (e.value !== null) {
      const n = Number(String(raw).replace(/[,\s%]/g, ""));
      if (!Number.isFinite(n) || Math.abs(n - e.value) > Math.max(1e-9, Math.abs(e.value) * 1e-9)) {
        return { ok: false, detail: `cell ${e.cell} holds "${raw}", not ${e.value}` };
      }
    }
    return { ok: true, detail: `cell ${e.cell} = ${raw}` };
  }

  const page = normalizeForMatch(e.pageText);
  const wording = normalizeForMatch(e.reportedWording);
  if (!wording) return { ok: false, detail: "no reported wording to check" };
  if (!page.includes(wording)) return { ok: false, detail: "reported wording not found on the stored page" };
  if (e.value !== null && !containsNumber(wording, e.value) && !containsNumber(wording, Math.abs(e.value))) {
    return { ok: false, detail: `value ${e.value} not present in the reported wording` };
  }
  if (e.value === null && e.textValue && !page.includes(normalizeForMatch(e.textValue))) {
    return { ok: false, detail: "text value not found on the stored page" };
  }
  return { ok: true, detail: "wording and value found on the stored page" };
}
