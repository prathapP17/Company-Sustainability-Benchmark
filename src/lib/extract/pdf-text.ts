/**
 * Extracts text from a PDF with explicit page markers, so every value
 * recorded later can cite "PDF p.N" (rule 1: every number traces to a page).
 *
 * Lines are rebuilt from pdf.js text items by grouping items that share
 * a baseline (y coordinate), then sorting left-to-right. This keeps table
 * rows together, which matters for ESG data tables.
 */
import { readFile } from "node:fs/promises";

export interface PdfPage {
  /** 1-based physical page index in the PDF file ("PDF p.N"). */
  pageNumber: number;
  text: string;
}

interface TextItemLike {
  str: string;
  transform: number[];
  width?: number;
}

const PAGE_MARKER = (n: number) => `\n=== PDF p.${n} ===\n`;

export async function extractPdfPages(filePath: string): Promise<PdfPage[]> {
  // The legacy build runs in plain Node without DOM globals.
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const data = new Uint8Array(await readFile(filePath));
  const task = pdfjs.getDocument({
    data,
    useSystemFonts: false,
    verbosity: 0,
  });
  const doc = await task.promise;

  const pages: PdfPage[] = [];
  try {
    for (let n = 1; n <= doc.numPages; n++) {
      const page = await doc.getPage(n);
      const content = await page.getTextContent();
      pages.push({ pageNumber: n, text: itemsToLines(content.items as TextItemLike[]) });
      page.cleanup();
    }
  } finally {
    // pdf.js v6 moved destroy() from the document proxy to the loading task.
    await task.destroy();
  }
  return pages;
}

/** Groups text items into lines by y coordinate (2pt tolerance). */
export function itemsToLines(items: TextItemLike[]): string {
  const rows: { y: number; parts: { x: number; s: string; w: number }[] }[] = [];
  for (const it of items) {
    if (!("str" in it) || it.str === "") continue;
    const x = it.transform[4];
    const y = it.transform[5];
    let row = rows.find((r) => Math.abs(r.y - y) < 2);
    if (!row) {
      row = { y, parts: [] };
      rows.push(row);
    }
    row.parts.push({ x, s: it.str, w: it.width ?? 0 });
  }
  rows.sort((a, b) => b.y - a.y);
  return rows
    .map((r) => {
      r.parts.sort((a, b) => a.x - b.x);
      let line = "";
      let prevEnd: number | null = null;
      for (const p of r.parts) {
        // Insert a column separator for wide horizontal gaps (table cells).
        if (prevEnd !== null) {
          const gap = p.x - prevEnd;
          line += gap > 12 ? " | " : gap > 1 ? " " : "";
        }
        line += p.s;
        prevEnd = p.x + p.w;
      }
      return line.replace(/\s+/g, " ").trim();
    })
    .filter(Boolean)
    .join("\n");
}

export function pagesToMarkedText(pages: PdfPage[]): string {
  return pages.map((p) => PAGE_MARKER(p.pageNumber) + p.text).join("\n");
}
