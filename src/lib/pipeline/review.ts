/**
 * Review: conflict detection (rule 8) and evidence-gated approval (rule 6)
 * that writes approved values into data/companies/<id>.json, re-validates,
 * and re-seeds the curated database. Every action is audited.
 */
import { readFileSync, renameSync, writeFileSync } from "node:fs";
import path from "node:path";
import type { DB } from "../db/connection";
import { CompanyFile, type MetricEntry, type Source } from "../schema/company";
import { resolveMetric, validateCompany } from "../schema/validate";
import { loadPeerGroups } from "../data/load";
import { formatCompanyJson } from "../data/format-json";
import { toCanonical } from "../metrics/dictionary";
import { seed } from "../db/seed";
import { audit, nowIso, type DocumentRow, type ExtractionRow, type PageRow } from "./db";
import { verifyEvidence } from "./evidence";
import { raiseAlert } from "../discovery/alerts";
import { formatReported } from "../format";
import type { Candidate } from "./extract/rules";
import type { SourceType, VerificationClass } from "../schema/enums";

export interface Conflict {
  type: "duplicate" | "conflict";
  existing: { value?: number; text?: string; unit?: string; state: string; source?: string; page?: string };
}

function companyFilePath(dataDir: string, companyId: string) {
  return path.join(dataDir, "companies", `${companyId}.json`);
}

export function readCompany(dataDir: string, companyId: string): CompanyFile {
  return CompanyFile.parse(JSON.parse(readFileSync(/*turbopackIgnore: true*/ companyFilePath(dataDir, companyId), "utf8")));
}

/** Finds the curated entry with the same metric/year/boundary/consolidation/method, and compares. */
export function detectConflict(
  company: CompanyFile,
  c: Pick<Candidate, "metricId" | "year" | "boundary" | "consolidation" | "scope2Method" | "value" | "unit">,
): Conflict | null {
  for (const raw of company.metrics) {
    const m = resolveMetric(company, raw);
    if (m.metric !== c.metricId || m.year !== c.year) continue;
    if (m.boundary !== c.boundary) continue; // different boundary: stored separately, not a conflict
    if (m.consolidation !== c.consolidation && m.consolidation !== "not_stated" && c.consolidation !== "not_stated") continue;
    if ((m.scope2Method ?? null) !== (c.scope2Method ?? null)) continue;
    const existing = { value: m.value, text: m.text, unit: m.unit, state: m.state, source: m.source, page: m.page };
    if (m.state !== "disclosed" || m.value === undefined || !m.unit) return { type: "conflict", existing };
    const a = toCanonical(c.metricId, c.value, c.unit);
    const b = toCanonical(c.metricId, m.value, m.unit);
    if (a !== null && b !== null && Math.abs(a - b) <= Math.max(Math.abs(b) * 0.005, 1e-9)) return { type: "duplicate", existing };
    return { type: "conflict", existing };
  }
  return null;
}

/** Stores proposals after running the evidence gate and conflict detection. */
export function saveCandidates(db: DB, dataDir: string, doc: DocumentRow, cands: Candidate[], method: "rule" | "ai") {
  const company = readCompany(dataDir, doc.company_id);
  const pages = new Map(
    (db.prepare("SELECT * FROM pages WHERE document_id = ?").all(doc.id) as PageRow[]).map((p) => [p.page_number, p]),
  );
  const ins = db.prepare(`INSERT INTO extractions (document_id, company_id, metric_id, year, value, unit, page_number, page_label, cell,
      reported_wording, boundary, consolidation, scope2_method, method, confidence, evidence_status, evidence_detail, status,
      conflict, created_at) VALUES (@document_id, @company_id, @metric_id, @year, @value, @unit, @page_number, @page_label, @cell,
      @reported_wording, @boundary, @consolidation, @scope2_method, @method, @confidence, @evidence_status, @evidence_detail,
      @status, @conflict, @created_at)`);
  let stored = 0;
  db.transaction(() => {
    db.prepare("DELETE FROM extractions WHERE document_id = ? AND method = ? AND status IN ('pending','blocked')").run(doc.id, method);
    for (const c of cands) {
      const page = pages.get(c.pageNumber);
      const ev = page
        ? verifyEvidence({
            value: c.value,
            reportedWording: c.reportedWording,
            pageText: page.text,
            cells: page.cells ? JSON.parse(page.cells) : null,
            cell: c.cell,
          })
        : { ok: false, detail: `page ${c.pageNumber} not in stored text` };
      const conflict = detectConflict(company, c);
      const info = ins.run({
        document_id: doc.id, company_id: doc.company_id, metric_id: c.metricId, year: c.year, value: c.value, unit: c.unit,
        page_number: c.pageNumber, page_label: c.pageLabel, cell: c.cell, reported_wording: c.reportedWording,
        boundary: c.boundary, consolidation: c.consolidation, scope2_method: c.scope2Method, method, confidence: c.confidence,
        evidence_status: ev.ok ? "verified" : "failed", evidence_detail: ev.detail, status: ev.ok ? "pending" : "blocked",
        conflict: conflict ? JSON.stringify(conflict) : null, created_at: nowIso(),
      });
      stored++;
      // Rule 8: a new document reporting a different value for a curated year is a possible restatement.
      if (conflict?.type === "conflict" && conflict.existing.state === "disclosed" && ev.ok) {
        raiseAlert(db, {
          companyId: doc.company_id,
          kind: "restatement",
          title: `Possible restatement: ${c.metricId} ${c.year} is ${formatReported(c.value, c.unit)} in "${doc.title}" vs ${formatReported(conflict.existing.value ?? null, conflict.existing.unit ?? null)} curated`,
          documentId: doc.id,
          extractionId: Number(info.lastInsertRowid),
          details: { metric: c.metricId, year: c.year, value: c.value, unit: c.unit, page: c.pageLabel, existing: conflict.existing },
          dedupeKey: `restatement:${doc.company_id}:${c.metricId}:${c.year}:${c.boundary}:${c.scope2Method ?? ""}:${c.value}:${c.unit}`,
        });
      }
    }
    audit(db, "worker", `extracted_${method}`, "document", doc.id, { candidates: stored });
  })();
  return stored;
}

export type ReviewAction =
  | { action: "approve"; reason?: string }
  | { action: "approve_restatement"; reason: string }
  | { action: "override_approve"; reason: string }
  | { action: "reject"; reason?: string };

export class ReviewError extends Error {}

function sourceIdFor(doc: DocumentRow) {
  return `upload-${doc.sha256.slice(0, 10)}`;
}

function ensureSource(company: CompanyFile, doc: DocumentRow): string {
  const id = sourceIdFor(doc);
  if (!company.sources.some((s) => s.id === id)) {
    const src: Source = {
      id,
      organisation: company.profile.legalName,
      title: doc.title,
      type: doc.report_type as SourceType,
      url: doc.source_url || `upload:sha256:${doc.sha256}`,
      accessed: doc.uploaded_at.slice(0, 10),
      reportingYear: doc.reporting_year ?? undefined,
      verificationClass: doc.verification_class as VerificationClass,
      notes: `Uploaded file "${doc.filename}" (sha256 ${doc.sha256.slice(0, 12)}…). Page citations refer to this file.`,
    };
    company.sources.push(src);
  }
  return id;
}

/**
 * Applies a review decision. Approval writes the value into the company file
 * (validated first, written atomically), records restatement history when
 * replacing a curated value, re-seeds, and audits. Nothing is written if
 * validation fails.
 */
export function reviewExtraction(db: DB, dataDir: string, extractionId: number, reviewer: string, act: ReviewAction) {
  if (!reviewer.trim()) throw new ReviewError("reviewer name required");
  const ex = db.prepare("SELECT * FROM extractions WHERE id = ?").get(extractionId) as ExtractionRow | undefined;
  if (!ex) throw new ReviewError("extraction not found");
  if (ex.status !== "pending" && ex.status !== "blocked") throw new ReviewError(`already ${ex.status}`);

  if (act.action === "reject") {
    db.transaction(() => {
      db.prepare("UPDATE extractions SET status = 'rejected', reviewer = ?, reviewed_at = ?, review_reason = ? WHERE id = ?").run(
        reviewer, nowIso(), act.reason ?? null, ex.id,
      );
      audit(db, reviewer, "reject", "extraction", ex.id, { reason: act.reason ?? null });
    })();
    return { status: "rejected" as const };
  }

  // Rule 6: blocked values need an explicit override with a reason.
  if (ex.status === "blocked" && act.action !== "override_approve") {
    throw new ReviewError(`evidence check failed (${ex.evidence_detail}); approving needs an override with a reason`);
  }
  if ((act.action === "override_approve" || act.action === "approve_restatement") && !act.reason?.trim()) {
    throw new ReviewError("a reason is required");
  }
  const conflict = ex.conflict ? (JSON.parse(ex.conflict) as Conflict) : null;
  if (conflict?.type === "conflict" && act.action !== "approve_restatement") {
    throw new ReviewError("conflicts with a curated value: approve as a restatement (with a reason) or reject");
  }

  const doc = db.prepare("SELECT * FROM documents WHERE id = ?").get(ex.document_id) as DocumentRow;
  const file = companyFilePath(dataDir, ex.company_id);
  const company = readCompany(dataDir, ex.company_id);

  if (conflict?.type === "duplicate") {
    db.transaction(() => {
      db.prepare("UPDATE extractions SET status = 'approved', reviewer = ?, reviewed_at = ?, review_reason = ? WHERE id = ?").run(
        reviewer, nowIso(), "confirms existing curated value (no change written)", ex.id,
      );
      audit(db, reviewer, "approve_duplicate", "extraction", ex.id, { existing: conflict.existing });
    })();
    return { status: "approved" as const, written: false };
  }

  const sourceId = ensureSource(company, doc);
  const entry: MetricEntry = {
    metric: ex.metric_id,
    year: ex.year,
    state: "disclosed",
    value: ex.value ?? undefined,
    text: ex.text_value ?? undefined,
    unit: ex.unit ?? undefined,
    boundary: ex.boundary as MetricEntry["boundary"],
    consolidation: ex.consolidation as MetricEntry["consolidation"],
    scope2Method: (ex.scope2_method ?? undefined) as MetricEntry["scope2Method"],
    assurance: { level: "not_stated" },
    verificationClass: doc.verification_class as VerificationClass,
    status: "reported",
    source: sourceId,
    page: ex.cell ?? ex.page_label,
    reportedWording: ex.reported_wording.slice(0, 300),
    note: `Extracted (${ex.method}) from upload #${doc.id}, approved by ${reviewer} on ${nowIso().slice(0, 10)}.${
      act.action === "override_approve" ? ` Evidence check overridden: ${act.reason}` : ""
    }`,
  };

  let replaced: MetricEntry | undefined;
  if (act.action === "approve_restatement") {
    const idx = company.metrics.findIndex((raw) => {
      const m = resolveMetric(company, raw);
      return (
        m.metric === ex.metric_id &&
        m.year === ex.year &&
        m.boundary === ex.boundary &&
        (m.scope2Method ?? null) === (ex.scope2_method ?? null)
      );
    });
    if (idx < 0) throw new ReviewError("no curated value to restate");
    replaced = company.metrics[idx];
    const old = resolveMetric(company, replaced);
    entry.restatements = [
      ...(replaced.restatements ?? []),
      {
        state: old.state,
        value: old.value,
        text: old.text,
        unit: old.unit,
        source: old.source,
        page: old.page,
        replacedOn: nowIso().slice(0, 10),
        approver: reviewer,
        reason: act.reason,
      },
    ];
    // History keeps the old value's resolved source and page, so later defaults changes cannot re-attribute it.
    company.metrics.splice(idx, 1, entry);
  } else {
    company.metrics.push(entry);
  }
  company.lastReviewed = nowIso().slice(0, 10);

  const res = validateCompany(`data/companies/${ex.company_id}.json`, company, loadPeerGroups(dataDir));
  const errors = res.issues.filter((i) => i.level === "error");
  if (errors.length) {
    throw new ReviewError(`approval would make the company file invalid: ${errors.map((e) => `${e.path}: ${e.message}`).join("; ")}`);
  }

  const tmp = `${file}.tmp-${process.pid}`;
  writeFileSync(/*turbopackIgnore: true*/ tmp, formatCompanyJson(company));
  renameSync(/*turbopackIgnore: true*/ tmp, file);

  db.transaction(() => {
    db.prepare("UPDATE extractions SET status = 'approved', reviewer = ?, reviewed_at = ?, review_reason = ? WHERE id = ?").run(
      reviewer, nowIso(), act.reason ?? null, ex.id,
    );
    audit(db, reviewer, act.action, "extraction", ex.id, {
      company: ex.company_id,
      metric: ex.metric_id,
      year: ex.year,
      value: ex.value,
      unit: ex.unit,
      source: sourceId,
      page: entry.page,
      replaced: replaced ? { value: replaced.value, unit: replaced.unit, source: replaced.source, page: replaced.page } : null,
      reason: act.reason ?? null,
    });
  })();

  const seeded = seed(dataDir);
  audit(db, reviewer, "reseed", "benchmark", null, { companies: seeded.companies, metricValues: seeded.metricValues });
  return { status: "approved" as const, written: true };
}
