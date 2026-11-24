/**
 * In-app alerts (phase 4): new or changed reports, possible restatements,
 * blocked sites and fetch failures. An open alert with the same dedupe key is
 * not raised twice. Every alert is also written to the audit log.
 */
import type { DB } from "../db/connection";
import { audit, nowIso } from "../pipeline/db";

export type AlertKind = "new_report" | "changed_report" | "restatement" | "blocked" | "fetch_failed" | "source_changed";

export interface AlertInput {
  companyId: string | null;
  kind: AlertKind;
  title: string;
  details?: Record<string, unknown>;
  url?: string | null;
  documentId?: number | null;
  extractionId?: number | null;
  dedupeKey: string;
}

export interface AlertRow {
  id: number;
  created_at: string;
  company_id: string | null;
  kind: AlertKind;
  title: string;
  details: string | null;
  url: string | null;
  document_id: number | null;
  extraction_id: number | null;
  dedupe_key: string;
  status: "open" | "acknowledged";
  acknowledged_by: string | null;
  acknowledged_at: string | null;
}

/** Returns the new alert id, or null when an identical open alert exists. */
export function raiseAlert(db: DB, a: AlertInput): number | null {
  const open = db.prepare("SELECT id FROM alerts WHERE dedupe_key = ? AND status = 'open'").get(a.dedupeKey);
  if (open) return null;
  const info = db
    .prepare(
      `INSERT INTO alerts (created_at, company_id, kind, title, details, url, document_id, extraction_id, dedupe_key, status)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'open')`,
    )
    .run(nowIso(), a.companyId, a.kind, a.title, a.details ? JSON.stringify(a.details) : null, a.url ?? null, a.documentId ?? null, a.extractionId ?? null, a.dedupeKey);
  const id = Number(info.lastInsertRowid);
  audit(db, "discovery", `alert_${a.kind}`, "alert", id, { title: a.title, url: a.url ?? null, company: a.companyId });
  return id;
}

export function acknowledgeAlert(db: DB, id: number, reviewer: string): boolean {
  const res = db
    .prepare("UPDATE alerts SET status = 'acknowledged', acknowledged_by = ?, acknowledged_at = ? WHERE id = ? AND status = 'open'")
    .run(reviewer, nowIso(), id);
  if (res.changes) audit(db, reviewer, "acknowledge_alert", "alert", id);
  return res.changes === 1;
}
