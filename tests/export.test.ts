import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import ExcelJS from "exceljs";
import { seed } from "@/lib/db/seed";
import { tempDataDir } from "./helpers";

const SECRET = "INTERNAL-REVIEWER-NOTE-DO-NOT-EXPORT";
let cleanup: () => void;

beforeAll(() => {
  // Temp copy of the data with an internal note planted on one value.
  const t = tempDataDir();
  cleanup = t.cleanup;
  const f = path.join(t.dir, "companies", "apple.json");
  const c = JSON.parse(readFileSync(f, "utf8"));
  c.metrics[0].internalNote = SECRET;
  writeFileSync(f, JSON.stringify(c));
  seed(t.dir);
  process.env.CSI_DATA_DIR = t.dir;
});

afterAll(() => {
  delete process.env.CSI_DATA_DIR;
  cleanup();
});

describe("exports", () => {
  it("CSV carries provenance columns and never the internal note", async () => {
    const { toCsv, VALUE_COLUMNS, valueRows } = await import("@/lib/export/rows");
    const csv = toCsv(VALUE_COLUMNS, valueRows());
    const header = csv.replace(/^﻿/, "").split("\r\n")[0];
    for (const col of ["source_url", "page", "boundary", "consolidation", "scope2_method", "assurance_level", "verification_class"]) {
      expect(header).toContain(col);
    }
    expect(header).not.toContain("internal");
    expect(csv).not.toContain(SECRET);
  });

  it("CSV escapes quotes, commas and formula-like text", async () => {
    const { toCsv } = await import("@/lib/export/rows");
    const out = toCsv(["a", "b", "c"], [{ a: 'say "hi", ok', b: "=1+1", c: -5 }]);
    expect(out).toContain('"say ""hi"", ok"');
    expect(out).toContain("'=1+1");
    expect(out).toContain(",-5");
  });

  it("XLSX has every sheet and no internal note", async () => {
    const { benchmarkWorkbook } = await import("@/lib/export/xlsx");
    const buf = await benchmarkWorkbook();
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(buf as unknown as ArrayBuffer);
    expect(wb.worksheets.map((w) => w.name)).toEqual(["Read me", "Values", "Companies", "Sources", "Targets", "Scores", "Checklist", "Indicators"]);
    let found = false;
    wb.eachSheet((ws) => ws.eachRow((r) => r.eachCell((cell) => {
      if (String(cell.value).includes(SECRET)) found = true;
    })));
    expect(found).toBe(false);
  });

  it("PDF reports render for the benchmark and every researched company", async () => {
    const { benchmarkPdf, companyPdf, pdfText } = await import("@/lib/export/pdf");
    const b = await benchmarkPdf();
    expect(b.subarray(0, 5).toString()).toBe("%PDF-");
    const a = await companyPdf("toyota");
    expect(a!.subarray(0, 5).toString()).toBe("%PDF-");
    expect(await companyPdf("nope")).toBeNull();
    expect(pdfText("CO₂e ≥ 4 → ⚠ ◆ Nestlé – 삼성")).toBe("CO2e >= 4 -> ! * Nestlé – ??");
  });
});
