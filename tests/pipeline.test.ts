import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { isDeepStrictEqual } from "node:util";
import Database from "better-sqlite3";
import { closePipelineDbs, pipelineDb, type ExtractionRow } from "@/lib/pipeline/db";
import { sniffMime, storeUpload, type UploadMeta } from "@/lib/pipeline/ingest";
import { claim, complete, enqueue, fail, recoverStuck } from "@/lib/pipeline/queue";
import { runJob } from "@/lib/pipeline/jobs";
import { ReviewError, reviewExtraction } from "@/lib/pipeline/review";
import { PIPELINE_MIGRATIONS } from "@/lib/pipeline/migrations";
import { formatCompanyJson } from "@/lib/data/format-json";
import { seed } from "@/lib/db/seed";
import { REAL_DATA, tempDataDir } from "./helpers";
import { makeGhgPdf } from "./pdf-fixture";

let dir: string;
let cleanup: () => void;
const meta: UploadMeta = {
  companyId: "apple",
  title: "Test report",
  sourceUrl: null,
  reportType: "sustainability_report",
  reportingYear: 2025,
  verificationClass: "primary_document",
  uploadedBy: "tester",
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
    await runJob(db, dir, job);
    complete(db, job.id);
  }
}

const extraction = (metric: string, year: number) =>
  pipelineDb(dir).prepare("SELECT * FROM extractions WHERE metric_id = ? AND year = ?").get(metric, year) as ExtractionRow;

describe("pipeline schema (rule 9)", () => {
  it("migrations are additive only", () => {
    for (const m of PIPELINE_MIGRATIONS) expect(m.sql).not.toMatch(/\bDROP\b|\bRENAME\b|\bDELETE\s+FROM\b/i);
  });
  it("the audit log is append-only", () => {
    const db = pipelineDb(dir);
    db.prepare("INSERT INTO audit_log (at, actor, action, entity) VALUES ('t','a','b','c')").run();
    expect(() => db.prepare("UPDATE audit_log SET actor = 'x'").run()).toThrow(/append-only/);
    expect(() => db.prepare("DELETE FROM audit_log").run()).toThrow(/append-only/);
  });
});

describe("upload intake", () => {
  it("sniffs content instead of trusting the file name", () => {
    expect(sniffMime(Buffer.from("%PDF-1.7 ..."), "x.pdf")).toBe("application/pdf");
    expect(sniffMime(Buffer.from("MZ\x90\x00 not a pdf"), "report.pdf")).toBeNull();
  });
  it("detects duplicates by hash and queues text extraction once", async () => {
    const buf = await makeGhgPdf();
    const db = pipelineDb(dir);
    const a = storeUpload(db, dir, "a.pdf", buf, meta);
    const b = storeUpload(db, dir, "b.pdf", buf, meta);
    expect(a.duplicate).toBe(false);
    expect(b.duplicate).toBe(true);
    expect(b.document.id).toBe(a.document.id);
    expect((db.prepare("SELECT count(*) n FROM jobs").get() as { n: number }).n).toBe(1);
  });
});

describe("worker jobs", () => {
  it("extracts text, flags scanned pages, and stores evidence-checked proposals", async () => {
    storeUpload(pipelineDb(dir), dir, "a.pdf", await makeGhgPdf({ scannedPage: true }), meta);
    await drain();
    const doc = pipelineDb(dir).prepare("SELECT * FROM documents").get() as { status: string; scanned_pages: string };
    expect(doc.status).toBe("extracted");
    expect(JSON.parse(doc.scanned_pages)).toEqual([2]);
    const e = extraction("ghg_scope1", 2023);
    expect(e).toMatchObject({ value: 51000, unit: "tCO2e", evidence_status: "verified", status: "pending", boundary: "consolidated_group" });
    // 2025 clashes with Apple's curated Scope 1 (55,200).
    expect(JSON.parse(extraction("ghg_scope1", 2025).conflict!)).toMatchObject({ type: "conflict" });
  });

  it("retries with backoff, then fails; recovers stuck jobs", () => {
    const db = pipelineDb(dir);
    storeUpload(db, dir, "x.pdf", Buffer.from("%PDF-1.4 broken"), meta);
    const now = new Date();
    let job = claim(db, "w1", now)!;
    expect(claim(db, "w2", now)).toBeUndefined(); // claim is atomic
    fail(db, job, "boom", now);
    expect((db.prepare("SELECT status, run_after FROM jobs WHERE id = ?").get(job.id) as { status: string }).status).toBe("queued");
    const later = new Date(now.getTime() + 60_000);
    job = claim(db, "w1", later)!;
    // Simulate a dead worker: no heartbeat for 10 minutes.
    expect(recoverStuck(db, 2 * 60_000, new Date(later.getTime() + 10 * 60_000))).toBe(1);
    job = claim(db, "w1", new Date(later.getTime() + 20 * 60_000))!;
    fail(db, job, "boom again");
    expect((db.prepare("SELECT status FROM jobs WHERE id = ?").get(job.id) as { status: string }).status).toBe("failed");
    expect((db.prepare("SELECT status FROM documents").get() as { status: string }).status).toBe("failed");
  });

  it("does not enqueue the same job twice", () => {
    const db = pipelineDb(dir);
    const doc = storeUpload(db, dir, "x.pdf", Buffer.from("%PDF-1.4 x"), meta).document;
    expect(enqueue(db, doc.id, "extract_text")).toBe(enqueue(db, doc.id, "extract_text"));
  });
});

describe("review and write-back", () => {
  const appleFile = () => path.join(dir, "companies", "apple.json");
  const apple = () => JSON.parse(readFileSync(appleFile(), "utf8"));

  it("approval writes the value with provenance, re-validates, re-seeds and audits", async () => {
    storeUpload(pipelineDb(dir), dir, "a.pdf", await makeGhgPdf(), meta);
    await drain();
    const e = extraction("ghg_scope1", 2023);
    reviewExtraction(pipelineDb(dir), dir, e.id, "Alex Reviewer", { action: "approve" });

    const entry = apple().metrics.find((m: { metric: string; year: number }) => m.metric === "ghg_scope1" && m.year === 2023);
    expect(entry).toMatchObject({ value: 51000, unit: "tCO2e", page: "PDF p.1", boundary: "consolidated_group" });
    expect(entry.source).toMatch(/^upload-/);
    expect(apple().sources.find((s: { id: string }) => s.id === entry.source).url).toMatch(/^upload:sha256:/);

    const bench = new Database(path.join(dir, "benchmark.db"), { readonly: true });
    expect(bench.prepare("SELECT value FROM metric_values WHERE company_id='apple' AND metric_id='ghg_scope1' AND year=2023").get()).toEqual({ value: 51000 });
    bench.close();
    const actions = (pipelineDb(dir).prepare("SELECT action FROM audit_log").all() as { action: string }[]).map((a) => a.action);
    expect(actions).toEqual(expect.arrayContaining(["upload", "text_extracted", "extracted_rule", "approve", "reseed"]));
  });

  it("refuses to silently overwrite a curated value; restatement keeps history (rule 8)", async () => {
    storeUpload(pipelineDb(dir), dir, "a.pdf", await makeGhgPdf(), meta);
    await drain();
    const e = extraction("ghg_scope1", 2025);
    expect(() => reviewExtraction(pipelineDb(dir), dir, e.id, "Alex", { action: "approve" })).toThrow(ReviewError);
    reviewExtraction(pipelineDb(dir), dir, e.id, "Alex", { action: "approve_restatement", reason: "Restated in later report" });
    const entries = apple().metrics.filter((m: { metric: string; year: number }) => m.metric === "ghg_scope1" && m.year === 2025);
    expect(entries).toHaveLength(1);
    expect(entries[0].value).toBe(55900);
    expect(entries[0].restatements[0]).toMatchObject({ value: 55200, approver: "Alex", reason: "Restated in later report" });
  });

  it("blocked values need an override with a reason (rule 6)", async () => {
    storeUpload(pipelineDb(dir), dir, "a.pdf", await makeGhgPdf(), meta);
    await drain();
    const db = pipelineDb(dir);
    const e = extraction("ghg_scope2_market", 2023);
    db.prepare("UPDATE extractions SET status = 'blocked', evidence_status = 'failed', evidence_detail = 'test' WHERE id = ?").run(e.id);
    expect(() => reviewExtraction(db, dir, e.id, "Alex", { action: "approve" })).toThrow(/override/);
    expect(() => reviewExtraction(db, dir, e.id, "Alex", { action: "override_approve", reason: " " })).toThrow(/reason/);
    reviewExtraction(db, dir, e.id, "Alex", { action: "override_approve", reason: "Checked the PDF by eye" });
    const entry = apple().metrics.find((m: { metric: string; year: number }) => m.metric === "ghg_scope2_market" && m.year === 2023);
    expect(entry.note).toMatch(/Evidence check overridden: Checked the PDF by eye/);
  });

  it("rejection writes nothing", async () => {
    storeUpload(pipelineDb(dir), dir, "a.pdf", await makeGhgPdf(), meta);
    await drain();
    const before = readFileSync(appleFile(), "utf8");
    reviewExtraction(pipelineDb(dir), dir, extraction("ghg_scope1", 2023).id, "Alex", { action: "reject", reason: "wrong table" });
    expect(readFileSync(appleFile(), "utf8")).toBe(before);
    expect(() => reviewExtraction(pipelineDb(dir), dir, extraction("ghg_scope1", 2023).id, "Alex", { action: "approve" })).toThrow(/already rejected/);
  });

  it("leaves the company file untouched when the result would be invalid", async () => {
    storeUpload(pipelineDb(dir), dir, "a.pdf", await makeGhgPdf(), meta);
    await drain();
    const db = pipelineDb(dir);
    const e = extraction("ghg_scope1", 2023);
    db.prepare("UPDATE extractions SET unit = 'furlongs' WHERE id = ?").run(e.id);
    const before = readFileSync(appleFile(), "utf8");
    expect(() => reviewExtraction(db, dir, e.id, "Alex", { action: "approve" })).toThrow(/invalid/);
    expect(readFileSync(appleFile(), "utf8")).toBe(before);
  });
});

describe("company file formatting", () => {
  it("keeps every curated file byte-stable and content-identical", () => {
    for (const f of readdirSync(path.join(REAL_DATA, "companies"))) {
      const text = readFileSync(path.join(REAL_DATA, "companies", f), "utf8");
      const obj = JSON.parse(text);
      expect(formatCompanyJson(obj)).toBe(text);
      expect(isDeepStrictEqual(JSON.parse(formatCompanyJson(obj)), obj)).toBe(true);
    }
  });
  it("writes one record per line", () => {
    expect(formatCompanyJson({ metrics: [{ a: 1 }, { b: [1, 2] }] })).toBe('{\n  "metrics": [\n    { "a": 1 },\n    { "b": [1, 2] }\n  ]\n}\n');
  });
});

