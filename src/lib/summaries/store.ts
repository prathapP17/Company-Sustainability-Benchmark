/**
 * Published AI summaries: data/summaries/<company>.json. Only summaries that
 * passed the automatic check are written. A summary is shown only while the
 * company's facts are unchanged (same hash); otherwise it is hidden as outdated.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { z } from "zod";
import { defaultDataDir, loadCompanies } from "../data/load";
import { loadSbti, sbtiFor } from "../sbti/load";
import { buildFacts, factsHash, type Fact } from "./facts";

export const StoredSummary = z.strictObject({
  $schemaVersion: z.literal(1),
  companyId: z.string(),
  model: z.string(),
  generatedAt: z.string(),
  generatedBy: z.string(),
  factsHash: z.string().length(64),
  facts: z.array(z.strictObject({ id: z.string(), kind: z.string(), text: z.string(), sourceId: z.string().nullable(), page: z.string().nullable(), url: z.string().nullable() })),
  sentences: z.array(z.strictObject({ text: z.string(), citations: z.array(z.string()) })),
  /** Present only when the automatic gate flagged wording and a reviewer approved it (manual-review fallback). */
  humanReview: z
    .strictObject({ by: z.string(), at: z.string(), note: z.string(), problems: z.array(z.string()) })
    .optional(),
});
export type StoredSummary = z.infer<typeof StoredSummary>;

const file = (dataDir: string, id: string) => path.join(/*turbopackIgnore: true*/ dataDir, "summaries", `${id}.json`);

export function readSummary(id: string, dataDir: string = defaultDataDir()): StoredSummary | null {
  if (!/^[a-z0-9-]+$/.test(id)) return null;
  const f = file(dataDir, id);
  if (!existsSync(f)) return null;
  const r = StoredSummary.safeParse(JSON.parse(readFileSync(f, "utf8")));
  return r.success ? r.data : null;
}

export function writeSummary(s: StoredSummary, dataDir: string = defaultDataDir()) {
  mkdirSync(path.join(dataDir, "summaries"), { recursive: true });
  writeFileSync(file(dataDir, s.companyId), `${JSON.stringify(StoredSummary.parse(s), null, 2)}\n`);
}

/** The facts a summary for this company would be written from today. */
export function currentFacts(id: string, dataDir: string = defaultDataDir()): { name: string; facts: Fact[] } | null {
  const company = loadCompanies(dataDir).companies.find((c) => c.profile.id === id);
  if (!company) return null;
  return { name: company.profile.name, facts: buildFacts(company, sbtiFor(loadSbti(dataDir), id)) };
}

export type SummaryState = { kind: "none" } | { kind: "current"; summary: StoredSummary } | { kind: "outdated"; summary: StoredSummary };

export function summaryState(id: string, dataDir: string = defaultDataDir()): SummaryState {
  const s = readSummary(id, dataDir);
  if (!s) return { kind: "none" };
  const now = currentFacts(id, dataDir);
  return now && factsHash(now.facts) === s.factsHash ? { kind: "current", summary: s } : { kind: "outdated", summary: s };
}
