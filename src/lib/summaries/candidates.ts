/**
 * Manual-review fallback for AI summaries. The automatic evidence gate stays
 * the publication rule (decision of 2026-11-25); when it fails only on
 * wording, a reviewer may read each sentence against its cited facts and
 * approve it with a note. A candidate with an unsupported claim ("hard"
 * problem) can never be approved: it must be regenerated.
 */
import type { DB } from "../db/connection";
import { audit } from "../pipeline/db";
import { defaultDataDir } from "../data/load";
import { checkSummary, type Problem, type Sentence } from "./check";
import { factsHash, type Fact } from "./facts";
import { currentFacts, writeSummary } from "./store";

export class SummaryReviewError extends Error {}

export interface CandidateRow {
  id: number;
  company_id: string;
  created_at: string;
  created_by: string;
  model: string;
  facts_hash: string;
  facts: string;
  sentences: string;
  problems: string;
  status: "pending" | "approved" | "rejected" | "rejected_auto" | "superseded";
  reviewer: string | null;
  reviewed_at: string | null;
  note: string | null;
}

export function storeCandidate(
  db: DB,
  c: { companyId: string; actor: string; model: string; facts: Fact[]; sentences: Sentence[]; problems: Problem[]; reviewable: boolean; now?: Date },
): number {
  const at = (c.now ?? new Date()).toISOString();
  return db.transaction(() => {
    db.prepare("UPDATE summary_candidates SET status = 'superseded' WHERE company_id = ? AND status = 'pending'").run(c.companyId);
    const r = db
      .prepare(
        `INSERT INTO summary_candidates (company_id, created_at, created_by, model, facts_hash, facts, sentences, problems, status)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(c.companyId, at, c.actor, c.model, factsHash(c.facts), JSON.stringify(c.facts), JSON.stringify(c.sentences), JSON.stringify(c.problems), c.reviewable ? "pending" : "rejected_auto");
    return Number(r.lastInsertRowid);
  })();
}

export function listCandidates(db: DB, status: CandidateRow["status"] = "pending"): CandidateRow[] {
  return db.prepare("SELECT * FROM summary_candidates WHERE status = ? ORDER BY id DESC").all(status) as CandidateRow[];
}

/** Approve (publish, labelled as reviewed) or reject a pending candidate. */
export function reviewCandidate(db: DB, id: number, reviewer: string, action: "approve" | "reject", note: string, opts: { dataDir?: string; now?: Date } = {}) {
  const dataDir = opts.dataDir ?? defaultDataDir();
  const row = db.prepare("SELECT * FROM summary_candidates WHERE id = ?").get(id) as CandidateRow | undefined;
  if (!row) throw new SummaryReviewError("candidate not found");
  if (row.status !== "pending") throw new SummaryReviewError(`candidate is ${row.status.replace("_", " ")}, not pending`);
  const at = (opts.now ?? new Date()).toISOString();
  if (action === "reject") {
    db.prepare("UPDATE summary_candidates SET status = 'rejected', reviewer = ?, reviewed_at = ?, note = ? WHERE id = ?").run(reviewer, at, note.trim() || null, id);
    audit(db, reviewer, "summary_candidate_rejected", "company", row.company_id, { candidate: id, note });
    return;
  }
  if (note.trim().length < 15) throw new SummaryReviewError("say in at least 15 characters why the flagged wording is acceptable");
  const facts = JSON.parse(row.facts) as Fact[];
  const sentences = JSON.parse(row.sentences) as Sentence[];
  const now = currentFacts(row.company_id, dataDir);
  if (!now || factsHash(now.facts) !== row.facts_hash) throw new SummaryReviewError("the company's data changed since this summary was written; generate a new one");
  // Re-run the gate: only wording problems may be accepted by a person.
  const check = checkSummary(sentences, facts);
  if (check.details.some((d) => d.kind === "hard")) throw new SummaryReviewError("this summary has unsupported claims and cannot be approved");
  writeSummary(
    {
      $schemaVersion: 1,
      companyId: row.company_id,
      model: row.model,
      generatedAt: row.created_at,
      generatedBy: row.created_by,
      factsHash: row.facts_hash,
      facts,
      sentences,
      humanReview: { by: reviewer, at, note: note.trim(), problems: check.problems },
    },
    dataDir,
  );
  db.prepare("UPDATE summary_candidates SET status = 'approved', reviewer = ?, reviewed_at = ?, note = ? WHERE id = ?").run(reviewer, at, note.trim(), id);
  audit(db, reviewer, "summary_published_after_review", "company", row.company_id, { candidate: id, note, problems: check.problems });
}
