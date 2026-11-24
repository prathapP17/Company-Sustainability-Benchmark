/**
 * SQLite-backed job queue: atomic claim, heartbeats, retries with backoff,
 * and recovery of jobs whose worker died (stuck-job recovery).
 */
import type { DB } from "../db/connection";
import { audit, nowIso, type JobRow } from "./db";

export function enqueue(db: DB, documentId: number, kind: JobRow["kind"], runAfter = new Date()) {
  const dup = db
    .prepare("SELECT id FROM jobs WHERE document_id = ? AND kind = ? AND status IN ('queued','running')")
    .get(documentId, kind) as { id: number } | undefined;
  if (dup) return dup.id;
  const info = db
    .prepare("INSERT INTO jobs (document_id, kind, status, run_after, created_at) VALUES (?, ?, 'queued', ?, ?)")
    .run(documentId, kind, runAfter.toISOString(), nowIso());
  return Number(info.lastInsertRowid);
}

/** Atomically claims the next due job, or returns undefined. */
export function claim(db: DB, workerId: string, now = new Date()): JobRow | undefined {
  return db.transaction(() => {
    const job = db
      .prepare("SELECT * FROM jobs WHERE status = 'queued' AND run_after <= ? ORDER BY id LIMIT 1")
      .get(now.toISOString()) as JobRow | undefined;
    if (!job) return undefined;
    const res = db
      .prepare(
        "UPDATE jobs SET status = 'running', worker_id = ?, attempts = attempts + 1, started_at = ?, heartbeat_at = ? WHERE id = ? AND status = 'queued'",
      )
      .run(workerId, now.toISOString(), now.toISOString(), job.id);
    if (res.changes !== 1) return undefined;
    return db.prepare("SELECT * FROM jobs WHERE id = ?").get(job.id) as JobRow;
  }).immediate();
}

export function heartbeat(db: DB, jobId: number, now = new Date()) {
  db.prepare("UPDATE jobs SET heartbeat_at = ? WHERE id = ? AND status = 'running'").run(now.toISOString(), jobId);
}

export function complete(db: DB, jobId: number) {
  db.prepare("UPDATE jobs SET status = 'done', finished_at = ?, error = NULL WHERE id = ?").run(nowIso(), jobId);
}

/** Records a failure; requeues with exponential backoff until max_attempts. */
export function fail(db: DB, job: JobRow, error: string, now = new Date()) {
  const final = job.attempts >= job.max_attempts;
  if (final) {
    db.prepare("UPDATE jobs SET status = 'failed', finished_at = ?, error = ? WHERE id = ?").run(now.toISOString(), error.slice(0, 2000), job.id);
    if (job.kind === "extract_text") {
      db.prepare("UPDATE documents SET status = 'failed', error = ? WHERE id = ?").run(error.slice(0, 2000), job.document_id);
    }
  } else {
    const delayMs = 2_000 * 2 ** (job.attempts - 1);
    db.prepare("UPDATE jobs SET status = 'queued', run_after = ?, worker_id = NULL, error = ? WHERE id = ?").run(
      new Date(now.getTime() + delayMs).toISOString(),
      error.slice(0, 2000),
      job.id,
    );
  }
  audit(db, "worker", final ? "job_failed" : "job_retry", "job", job.id, { kind: job.kind, attempts: job.attempts, error: error.slice(0, 500) });
}

/**
 * Jobs still "running" with a heartbeat older than staleMs belong to a dead or
 * hung worker: requeue them (or fail them if out of attempts).
 */
export function recoverStuck(db: DB, staleMs: number, now = new Date()): number {
  const cutoff = new Date(now.getTime() - staleMs).toISOString();
  const stuck = db.prepare("SELECT * FROM jobs WHERE status = 'running' AND heartbeat_at < ?").all(cutoff) as JobRow[];
  for (const j of stuck) fail(db, j, `stuck: no heartbeat since ${j.heartbeat_at}`, now);
  return stuck.length;
}

export function requeueDocument(db: DB, documentId: number, actor: string) {
  const id = enqueue(db, documentId, "extract_text");
  audit(db, actor, "requeue", "document", documentId, { job: id });
  return id;
}
