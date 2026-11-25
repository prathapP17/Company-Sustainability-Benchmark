/**
 * The whole research workflow in one temporary data folder (rule 9: never the
 * real data): classify a discovered report, take it in (with duplicate check),
 * extract text and tables, propose values, check evidence and conflicts,
 * review, write the curated JSON, validate, re-seed the read model, and check
 * what a public page would show and what the audit log recorded. Failure paths
 * must leave approved data untouched.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";
import { classifyLink } from "@/lib/discovery/classify";
import { closePipelineDbs, pipelineDb, type ExtractionRow } from "@/lib/pipeline/db";
import { storeUpload, type UploadMeta } from "@/lib/pipeline/ingest";
import { claim, complete, fail } from "@/lib/pipeline/queue";
import { runJob } from "@/lib/pipeline/jobs";
import { ReviewError, reviewExtraction } from "@/lib/pipeline/review";
import { loadCompanies } from "@/lib/data/load";
import { seed } from "@/lib/db/seed";
import { tempDataDir } from "./helpers";
import { makeGhgPdf } from "./pdf-fixture";

let dir: string;
let cleanup: () => void;
const meta: UploadMeta = {
  companyId: "apple",
  title: "Environmental Progress Report (test fixture)",
  sourceUrl: "https://www.example.com/reports/environmental-progress-report-2025.pdf",
  reportType: "sustainability_report",
  reportingYear: 2025,
  verificationClass: "primary_document",
  uploadedBy: "Rae Reviewer",
};

beforeEach(() => {
  const t = tempDataDir();
  dir = t.dir;
  cleanup = t.cleanup;
  seed(dir);
});
afterEach(() => {
  closePipelineDbs();
  cleanup();
});

async function drain() {
  const db = pipelineDb(dir);
  for (let i = 0; i < 10; i++) {
    const job = claim(db, "test");
    if (!job) return;
    try {
      await runJob(db, dir, job);
      complete(db, job.id);
    } catch (e) {
      fail(db, job, (e as Error).message);
    }
  }
}
const rows = (sql: string, ...p: unknown[]) => pipelineDb(dir).prepare(sql).all(...p) as Record<string, unknown>[];
const extraction = (metric: string, year: number) => pipelineDb(dir).prepare("SELECT * FROM extractions WHERE metric_id = ? AND year = ?").get(metric, year) as ExtractionRow;
const appleText = () => readFileSync(path.join(dir, "companies", "apple.json"), "utf8");

describe("end-to-end research workflow", () => {
  it("goes from a discovered report to a published, sourced value with a complete audit trail", async () => {
    // 1-2. Discover and classify.
    const c = classifyLink(meta.sourceUrl!, "Environmental Progress Report 2025", 2026);
    expect(c).toMatchObject({ fileKind: "pdf" });
    // 3-4. Take it in; the same file twice is a duplicate, not a second document.
    const pdf = await makeGhgPdf();
    const first = storeUpload(pipelineDb(dir), dir, "report.pdf", pdf, meta);
    const again = storeUpload(pipelineDb(dir), dir, "copy.pdf", pdf, meta);
    expect(again).toMatchObject({ duplicate: true });
    expect(again.document.id).toBe(first.document.id);
    // 5-9. Text, tables, candidates, units and context, evidence, conflicts.
    await drain();
    const e2023 = extraction("ghg_scope1", 2023);
    expect(e2023).toMatchObject({ value: 51000, unit: "tCO2e", evidence_status: "verified", status: "pending", boundary: "consolidated_group", consolidation: "operational_control" });
    expect(JSON.parse(extraction("ghg_scope1", 2025).conflict!)).toMatchObject({ type: "conflict" }); // possible restatement
    // 10-11. Review: approve one, resolve the restatement explicitly, reject one.
    const db = pipelineDb(dir);
    reviewExtraction(db, dir, e2023.id, "Rae Reviewer", { action: "approve" });
    expect(() => reviewExtraction(db, dir, extraction("ghg_scope1", 2025).id, "Rae Reviewer", { action: "approve" })).toThrow(ReviewError);
    reviewExtraction(db, dir, extraction("ghg_scope1", 2025).id, "Rae Reviewer", { action: "approve_restatement", reason: "Restated in the newer report" });
    reviewExtraction(db, dir, extraction("ghg_scope2_market", 2023).id, "Rae Reviewer", { action: "reject", reason: "Different table" });
    // 12-13. The curated file holds the values with provenance and still validates.
    const loaded = loadCompanies(dir);
    expect(loaded.issues.filter((i) => i.level === "error")).toEqual([]);
    const apple = loaded.companies.find((x) => x.profile.id === "apple")!;
    const v = apple.metrics.find((m) => m.metric === "ghg_scope1" && m.year === 2023)!;
    expect(v).toMatchObject({ state: "disclosed", value: 51000, unit: "tCO2e", page: "PDF p.1" });
    const src = apple.sources.find((s) => s.id === v.source)!;
    expect(src).toMatchObject({ url: meta.sourceUrl, verificationClass: "primary_document" });
    const restated = apple.metrics.find((m) => m.metric === "ghg_scope1" && m.year === 2025)!;
    expect(restated.restatements?.[0]).toMatchObject({ value: 55200, approver: "Rae Reviewer" });
    expect(apple.metrics.some((m) => m.metric === "ghg_scope2_market" && m.year === 2023)).toBe(false);
    // 14-16. The read model the public pages use shows the value with its source and page.
    const bench = new Database(path.join(dir, "benchmark.db"), { readonly: true });
    const pub = bench
      .prepare("SELECT mv.value, mv.page, s.url FROM metric_values mv JOIN sources s ON s.company_id = mv.company_id AND s.id = mv.source_id WHERE mv.company_id='apple' AND mv.metric_id='ghg_scope1' AND mv.year=2023")
      .get();
    bench.close();
    expect(pub).toEqual({ value: 51000, page: "PDF p.1", url: meta.sourceUrl });
    // 17. Every step is in the audit log, in order.
    const actions = rows("SELECT action FROM audit_log ORDER BY id").map((r) => r.action);
    const order = ["upload", "upload_duplicate", "text_extracted", "extracted_rule", "approve", "reseed", "approve_restatement", "reject"];
    const positions = order.map((a) => actions.indexOf(a));
    expect(positions.every((p) => p >= 0)).toBe(true);
    expect([...positions].sort((a, b) => a - b)).toEqual(positions);
  });

  it("a malformed report fails without touching curated data, and an interrupted job is retried", async () => {
    const before = appleText();
    storeUpload(pipelineDb(dir), dir, "broken.pdf", Buffer.from("%PDF-1.4 not really a pdf"), meta);
    await drain();
    await drain();
    await drain();
    const doc = rows("SELECT status FROM documents")[0];
    expect(["failed", "uploaded"]).toContain(doc.status);
    expect(rows("SELECT count(*) n FROM extractions")[0].n).toBe(0);
    expect(appleText()).toBe(before);
    expect(rows("SELECT action FROM audit_log WHERE action IN ('job_retry','job_failed')").length).toBeGreaterThan(0);
  });

  it("refuses files that are not reports and invalid approvals", async () => {
    expect(() => storeUpload(pipelineDb(dir), dir, "evil.pdf", Buffer.from("MZ\x90\x00 not a pdf"), meta)).toThrow();
    storeUpload(pipelineDb(dir), dir, "a.pdf", await makeGhgPdf(), meta);
    await drain();
    const db = pipelineDb(dir);
    const e = extraction("ghg_scope1", 2023);
    reviewExtraction(db, dir, e.id, "Rae", { action: "approve" });
    const after = appleText();
    expect(() => reviewExtraction(db, dir, e.id, "Rae", { action: "approve" })).toThrow(/already approved/);
    expect(() => reviewExtraction(db, dir, 999_999, "Rae", { action: "approve" })).toThrow();
    expect(appleText()).toBe(after); // a refused action never rewrites the file
  });
});
