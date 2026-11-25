/** Job handlers, shared by the worker process and tests. */
import type { DB } from "../db/connection";
import { audit, type DocumentRow, type JobRow, type PageRow } from "./db";
import { runExtractText } from "./ingest";
import { extractWithDiagnostics, type PageInput } from "./extract/rules";
import { aiEnabled, extractWithClaude } from "./extract/ai";
import { readCompany, saveCandidates } from "./review";
import { classify } from "../industry";

export const JOB_TIMEOUT_MS: Record<JobRow["kind"], number> = {
  extract_text: 5 * 60_000,
  extract_rules: 2 * 60_000,
  extract_ai: 15 * 60_000,
};

function pagesFor(db: DB, documentId: number): PageInput[] {
  return (db.prepare("SELECT * FROM pages WHERE document_id = ? ORDER BY page_number").all(documentId) as PageRow[]).map((p) => ({
    pageNumber: p.page_number,
    label: p.label,
    text: p.text,
    cells: p.cells ? JSON.parse(p.cells) : undefined,
    isScanned: p.is_scanned === 1,
  }));
}

export async function runJob(db: DB, dataDir: string, job: JobRow): Promise<string> {
  const doc = db.prepare("SELECT * FROM documents WHERE id = ?").get(job.document_id) as DocumentRow | undefined;
  if (!doc) throw new Error(`document ${job.document_id} missing`);

  if (job.kind === "extract_text") {
    const r = await runExtractText(db, doc.id, aiEnabled());
    return `${r.pages} pages, ${r.scanned.length} scanned`;
  }

  const company = readCompany(dataDir, doc.company_id);
  const pages = pagesFor(db, doc.id);

  if (job.kind === "extract_rules") {
    const { candidates: cands, skipped } = extractWithDiagnostics(pages, {
      industryCodes: classify(company.profile.industry).codes,
      convention: company.profile.fiscalYear.labelConvention,
      reportingYear: doc.reporting_year,
    });
    const n = saveCandidates(db, dataDir, doc, cands, "rule");
    // Ambiguous metric/years are not guessed: they are recorded for the reviewer as gaps to check by hand.
    if (skipped.length) audit(db, "worker", "extraction_skipped_ambiguous", "document", doc.id, { skipped });
    db.prepare("UPDATE documents SET status = 'extracted' WHERE id = ?").run(doc.id);
    return `${n} rule-based proposals${skipped.length ? `, ${skipped.length} metric/years skipped as ambiguous` : ""}`;
  }

  if (job.kind === "extract_ai") {
    if (!aiEnabled()) return "skipped: ANTHROPIC_API_KEY not set";
    const r = await extractWithClaude(pages, {
      industryCodes: classify(company.profile.industry).codes,
      convention: company.profile.fiscalYear.labelConvention,
      companyName: company.profile.name,
    });
    const n = saveCandidates(db, dataDir, doc, r.candidates, "ai");
    audit(db, "worker", "ai_usage", "document", doc.id, {
      requests: r.requests,
      inputTokens: r.inputTokens,
      outputTokens: r.outputTokens,
      dropped: r.dropped,
    });
    return `${n} AI proposals (${r.dropped} dropped by structural checks)`;
  }
  throw new Error(`unknown job kind ${job.kind}`);
}
