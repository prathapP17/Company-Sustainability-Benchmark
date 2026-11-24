/**
 * Upload intake and text extraction.
 *
 * - Duplicates are detected by SHA-256 (procedure: "check for duplicates by hash").
 * - Page text is stored in the pipeline DB so every extracted value can be
 *   re-found later (rule 6, evidence-gated approval).
 * - Image-only pages are flagged as scanned ("needs OCR") instead of being
 *   silently skipped.
 */
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import ExcelJS from "exceljs";
import { extractPdfPages, looksScanned } from "../extract/pdf-text";
import { xhtmlPages } from "../extract/xhtml-text";
import type { DB } from "../db/connection";
import { audit, nowIso, uploadsDir, type DocumentRow } from "./db";
import { enqueue } from "./queue";

export const MAX_UPLOAD_BYTES = 50 * 1024 * 1024;

export const ACCEPTED: Record<string, { ext: string; kind: "pdf" | "xlsx" | "xhtml" }> = {
  "application/pdf": { ext: "pdf", kind: "pdf" },
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": { ext: "xlsx", kind: "xlsx" },
  "application/xhtml+xml": { ext: "xhtml", kind: "xhtml" },
  "text/html": { ext: "html", kind: "xhtml" },
};

/** Content sniffing: never trust the browser's MIME type alone. */
export function sniffMime(buf: Buffer, filename: string): string | null {
  if (buf.subarray(0, 5).toString("latin1") === "%PDF-") return "application/pdf";
  if (buf[0] === 0x50 && buf[1] === 0x4b && /\.xlsx$/i.test(filename)) {
    return "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
  }
  const head = buf.subarray(0, 2048).toString("utf8").toLowerCase();
  if (/\.x?html?$/i.test(filename) && (head.includes("<html") || head.includes("<?xml"))) {
    return /\.xhtml$/i.test(filename) ? "application/xhtml+xml" : "text/html";
  }
  return null;
}

export interface UploadMeta {
  companyId: string;
  title: string;
  sourceUrl: string | null;
  reportType: string;
  reportingYear: number | null;
  verificationClass: string;
  uploadedBy: string;
}

export interface UploadResult {
  document: DocumentRow;
  duplicate: boolean;
}

export function storeUpload(db: DB, dataDir: string, filename: string, buf: Buffer, meta: UploadMeta): UploadResult {
  if (buf.length === 0) throw new Error("empty file");
  if (buf.length > MAX_UPLOAD_BYTES) throw new Error(`file exceeds ${MAX_UPLOAD_BYTES / 1024 / 1024} MB`);
  const mime = sniffMime(buf, filename);
  if (!mime || !ACCEPTED[mime]) throw new Error("unsupported file type (PDF, XLSX or XHTML/HTML only)");

  const sha256 = createHash("sha256").update(buf).digest("hex");
  const existing = db.prepare("SELECT * FROM documents WHERE sha256 = ?").get(sha256) as DocumentRow | undefined;
  if (existing) {
    audit(db, meta.uploadedBy, "upload_duplicate", "document", existing.id, { filename, sha256 });
    return { document: existing, duplicate: true };
  }

  const dir = uploadsDir(dataDir);
  mkdirSync(/*turbopackIgnore: true*/ dir, { recursive: true });
  const stored = path.join(/*turbopackIgnore: true*/ dir, `${sha256}.${ACCEPTED[mime].ext}`);
  writeFileSync(/*turbopackIgnore: true*/ stored, buf);

  const safeName = path.basename(filename).replace(/[^\w.\- ()]/g, "_").slice(0, 200);
  const doc = db.transaction(() => {
    const info = db
      .prepare(
        `INSERT INTO documents (sha256, company_id, filename, mime, size_bytes, stored_path, title, source_url, report_type,
          reporting_year, verification_class, status, uploaded_by, uploaded_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'uploaded', ?, ?)`,
      )
      .run(
        sha256, meta.companyId, safeName, mime, buf.length, stored, meta.title, meta.sourceUrl, meta.reportType,
        meta.reportingYear, meta.verificationClass, meta.uploadedBy, nowIso(),
      );
    const id = Number(info.lastInsertRowid);
    audit(db, meta.uploadedBy, "upload", "document", id, { filename: safeName, sha256, size: buf.length, companyId: meta.companyId });
    enqueue(db, id, "extract_text");
    return db.prepare("SELECT * FROM documents WHERE id = ?").get(id) as DocumentRow;
  })();
  return { document: doc, duplicate: false };
}

export interface ParsedPage {
  pageNumber: number;
  label: string;
  text: string;
  cells?: Record<string, string>;
  isScanned: boolean;
}

function cellText(v: ExcelJS.CellValue): string {
  if (v === null || v === undefined) return "";
  if (typeof v === "object") {
    if ("result" in v && v.result !== undefined) return String(v.result);
    if ("richText" in v) return v.richText.map((r) => r.text).join("");
    if ("text" in v) return String(v.text);
    if (v instanceof Date) return v.toISOString().slice(0, 10);
    return "";
  }
  return String(v);
}

export async function parseFile(file: string, mime: string): Promise<ParsedPage[]> {
  const kind = ACCEPTED[mime]?.kind;
  if (kind === "pdf") {
    const pages = await extractPdfPages(file);
    return pages.map((p) => ({ pageNumber: p.pageNumber, label: `PDF p.${p.pageNumber}`, text: p.text, isScanned: looksScanned(p) }));
  }
  if (kind === "xhtml") {
    return xhtmlPages(readFileSync(/*turbopackIgnore: true*/ file, "utf8")).map((p) => ({
      pageNumber: p.pageNumber,
      label: `XHTML page ${p.pageNumber}`,
      text: p.text,
      isScanned: false,
    }));
  }
  if (kind === "xlsx") {
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.readFile(file);
    const out: ParsedPage[] = [];
    wb.worksheets.forEach((ws, i) => {
      const cells: Record<string, string> = {};
      const lines: string[] = [];
      ws.eachRow({ includeEmpty: false }, (row) => {
        const parts: string[] = [];
        row.eachCell({ includeEmpty: false }, (cell) => {
          const t = cellText(cell.value).trim();
          if (!t) return;
          cells[cell.address] = t;
          parts.push(t);
        });
        if (parts.length) lines.push(parts.join(" | "));
      });
      out.push({ pageNumber: i + 1, label: `Sheet: ${ws.name}`, text: lines.join("\n"), cells, isScanned: false });
    });
    return out;
  }
  throw new Error(`cannot parse ${mime}`);
}

/** Job handler: extract and store page text, then queue value extraction. */
export async function runExtractText(db: DB, documentId: number, aiEnabled: boolean) {
  const doc = db.prepare("SELECT * FROM documents WHERE id = ?").get(documentId) as DocumentRow | undefined;
  if (!doc) throw new Error(`document ${documentId} not found`);
  const pages = await parseFile(doc.stored_path, doc.mime);
  const scanned = pages.filter((p) => p.isScanned).map((p) => p.pageNumber);
  db.transaction(() => {
    db.prepare("DELETE FROM pages WHERE document_id = ?").run(documentId); // re-run safe: page text is derived from the stored file
    const ins = db.prepare("INSERT INTO pages (document_id, page_number, label, text, cells, is_scanned) VALUES (?, ?, ?, ?, ?, ?)");
    for (const p of pages) ins.run(documentId, p.pageNumber, p.label, p.text, p.cells ? JSON.stringify(p.cells) : null, p.isScanned ? 1 : 0);
    db.prepare("UPDATE documents SET status = 'text_extracted', page_count = ?, scanned_pages = ?, error = NULL WHERE id = ?").run(
      pages.length,
      JSON.stringify(scanned),
      documentId,
    );
    audit(db, "worker", "text_extracted", "document", documentId, { pages: pages.length, scannedPages: scanned });
    enqueue(db, documentId, "extract_rules");
    if (aiEnabled) enqueue(db, documentId, "extract_ai");
  })();
  return { pages: pages.length, scanned };
}
