/** Read helpers for the review pages. */
import "server-only";
import { pipelineDb, type DocumentRow, type ExtractionRow, type JobRow, type PageRow } from "./db";

export interface DocumentSummary extends DocumentRow {
  pending: number;
  blocked: number;
  approved: number;
  rejected: number;
  conflicts: number;
  queued_jobs: number;
  running_jobs: number;
  failed_jobs: number;
}

export function listDocuments(): DocumentSummary[] {
  return pipelineDb()
    .prepare(
      `SELECT d.*,
        (SELECT count(*) FROM extractions e WHERE e.document_id = d.id AND e.status = 'pending') pending,
        (SELECT count(*) FROM extractions e WHERE e.document_id = d.id AND e.status = 'blocked') blocked,
        (SELECT count(*) FROM extractions e WHERE e.document_id = d.id AND e.status = 'approved') approved,
        (SELECT count(*) FROM extractions e WHERE e.document_id = d.id AND e.status = 'rejected') rejected,
        (SELECT count(*) FROM extractions e WHERE e.document_id = d.id AND e.status IN ('pending','blocked') AND e.conflict IS NOT NULL) conflicts,
        (SELECT count(*) FROM jobs j WHERE j.document_id = d.id AND j.status = 'queued') queued_jobs,
        (SELECT count(*) FROM jobs j WHERE j.document_id = d.id AND j.status = 'running') running_jobs,
        (SELECT count(*) FROM jobs j WHERE j.document_id = d.id AND j.status = 'failed') failed_jobs
       FROM documents d ORDER BY d.id DESC`,
    )
    .all() as DocumentSummary[];
}

export function getDocument(id: number): DocumentRow | undefined {
  return pipelineDb().prepare("SELECT * FROM documents WHERE id = ?").get(id) as DocumentRow | undefined;
}

export function jobsFor(id: number): JobRow[] {
  return pipelineDb().prepare("SELECT * FROM jobs WHERE document_id = ? ORDER BY id").all(id) as JobRow[];
}

export function extractionsFor(id: number): ExtractionRow[] {
  return pipelineDb()
    .prepare("SELECT * FROM extractions WHERE document_id = ? ORDER BY metric_id, year DESC, confidence DESC")
    .all(id) as ExtractionRow[];
}

export function pagesFor(id: number, numbers: number[]): PageRow[] {
  if (!numbers.length) return [];
  return pipelineDb()
    .prepare(`SELECT * FROM pages WHERE document_id = ? AND page_number IN (${numbers.map(() => "?").join(",")})`)
    .all(id, ...numbers) as PageRow[];
}

export interface AuditRow {
  id: number;
  at: string;
  actor: string;
  action: string;
  entity: string;
  entity_id: string | null;
  details: string | null;
}

export function recentAudit(limit = 200): AuditRow[] {
  return pipelineDb().prepare("SELECT * FROM audit_log ORDER BY id DESC LIMIT ?").all(limit) as AuditRow[];
}

export function queueStats() {
  return pipelineDb()
    .prepare("SELECT status, count(*) n FROM jobs GROUP BY status")
    .all() as { status: string; n: number }[];
}
