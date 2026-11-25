import type Anthropic from "@anthropic-ai/sdk";
import type { DB } from "../db/connection";
import { audit } from "../pipeline/db";
import { defaultDataDir } from "../data/load";
import { factsHash } from "./facts";
import { generateSummary, SUMMARY_MODEL } from "./generate";
import { currentFacts, writeSummary } from "./store";
import { storeCandidate } from "./candidates";

export interface RunResult {
  ok: boolean;
  /** Failed only on wording: waiting for a reviewer in the manual-review fallback. */
  reviewable: boolean;
  problems: string[];
  sentences: number;
  inputTokens: number;
  outputTokens: number;
}

/** Generates, checks and (only if the check passes) publishes one company's summary. Audited either way. */
export async function summarizeCompany(db: DB, id: string, actor: string, opts: { dataDir?: string; client?: Anthropic; now?: Date } = {}): Promise<RunResult> {
  const dataDir = opts.dataDir ?? defaultDataDir();
  const input = currentFacts(id, dataDir);
  if (!input) throw new Error(`unknown company ${id}`);
  if (input.facts.length < 2) throw new Error(`${id}: not enough curated facts to summarise`);
  const r = await generateSummary(input.name, input.facts, opts.client);
  const result: RunResult = { ok: r.check.ok, reviewable: r.check.reviewable, problems: r.check.problems, sentences: r.sentences.length, inputTokens: r.inputTokens, outputTokens: r.outputTokens };
  if (r.check.ok) {
    writeSummary(
      {
        $schemaVersion: 1,
        companyId: id,
        model: SUMMARY_MODEL,
        generatedAt: (opts.now ?? new Date()).toISOString(),
        generatedBy: actor,
        factsHash: factsHash(input.facts),
        facts: input.facts,
        sentences: r.sentences,
      },
      dataDir,
    );
  }
  let candidate: number | null = null;
  if (!r.check.ok) {
    candidate = storeCandidate(db, { companyId: id, actor, model: SUMMARY_MODEL, facts: input.facts, sentences: r.sentences, problems: r.check.details, reviewable: r.check.reviewable, now: opts.now });
  }
  audit(db, actor, r.check.ok ? "summary_published" : "summary_rejected_by_check", "company", id, {
    candidate,
    reviewable: r.check.reviewable,
    model: SUMMARY_MODEL,
    problems: r.check.problems,
    sentences: r.sentences,
    inputTokens: r.inputTokens,
    outputTokens: r.outputTokens,
  });
  return result;
}
