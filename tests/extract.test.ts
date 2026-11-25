import { describe, expect, it } from "vitest";
import { alignToYears, detectUnit, findNumbers, numberForms, parseYearHeader } from "@/lib/pipeline/extract/parse";
import { extractCandidates, extractWithDiagnostics } from "@/lib/pipeline/extract/rules";
import { verifyEvidence } from "@/lib/pipeline/evidence";
import { selectPages, extractWithClaude } from "@/lib/pipeline/extract/ai";
import { parseMemInfo, parseVmStat } from "@/lib/pipeline/memory";

// Table lines below reproduce the layout of real report pages (Microsoft data fact sheet,
// Reliance BRSR, Nestlé KPI appendix, Toyota data book) as our PDF text extractor emits them.
const MSFT = `Table 1A – GHG emissions by scope (mtCO2e)
FY20 | FY21 | FY22 | FY23 | FY24 | FY25
Scope 1 | 118,100 | 123,704 | 139,413 | 144,960 | 143,510 | 170,887
Scope 2
Location-based | 4,328,916 | 5,010,667 | 6,381,250 | 8,077,403 | 9,955,368 12,030,556
Market-based | 456,119 | 429,405 | 288,029 | 393,134 | 259,090 | 2,707,428
Subtotal emissions (Scope 3) | 12,487,000 14,358,000 16,743,000 | 17,123,000 16,290,000 18,243,000
Microsoft uses an operational control approach`;
const BRSR = `Parameter | Unit | FY 2025-26 | FY 2024-25
Total Scope 1 emissions (Break-up of the GHG in | Metric tonnes of CO equivalent | 3,63,50,070 | 3,64,59,294
Thus, all the data reported in this report pertains to RIL Standalone entity.`;
const NESTLE = `Indicator Unit | (2018) 2022 2023 2024 2025 GRI index SASB index
Gross Scope 1 greenhouse gas | Million metric | 3.21 3.23 3.06 3.02 2.82 305-1, 305-2,
(GHG) emissions | tonnes of CO₂ | 305-3
Total weight of waste generated | Metric tonnes 1 811 947 1 564 810 1 771 759 1 839 067 306-3-a`;

const page = (text: string, n = 1) => ({ pageNumber: n, label: `PDF p.${n}`, text });

describe("number parsing", () => {
  it("reads western and Indian digit grouping, decimals and parenthesised negatives", () => {
    expect(findNumbers("a | 3,63,50,070 | 118,100 | 2.82 | (30)%").map((n) => n.value)).toEqual([36350070, 118100, 2.82, -30]);
  });
  it("refuses space-grouped thousands (ambiguous next to table cells)", () => {
    expect(findNumbers("Metric tonnes 1 811 947 1 564 810")).toEqual([]);
  });
  it("ignores GRI and SASB disclosure codes", () => {
    expect(findNumbers("| 3.02 2.82 305-1, 305-2, TC-SI-130a.1").map((n) => n.value)).toEqual([3.02, 2.82]);
  });
  it("lists printed forms for the evidence gate", () => {
    expect(numberForms(36350070)).toEqual(expect.arrayContaining(["36,350,070", "3,63,50,070"]));
  });
});

describe("units and years", () => {
  const ghg = ["tCO2e", "ktCO2e", "MtCO2e"];
  it("distinguishes mtCO2e (metric tons) from MtCO2e (megatonnes)", () => {
    expect(detectUnit("GHG emissions by scope (mtCO2e)", ghg)).toBe("tCO2e");
    expect(detectUnit("Scope 1 | MtCO2e", ghg)).toBe("MtCO2e");
    expect(detectUnit("1,000 tonnes CO₂e", ghg)).toBe("ktCO2e");
    expect(detectUnit("Metric tonnes of CO equivalent", ghg)).toBe("tCO2e");
  });
  it("parses fiscal-year headers by labelling convention", () => {
    expect(parseYearHeader("FY20 | FY21 | FY25", "end_year")).toEqual([2020, 2021, 2025]);
    expect(parseYearHeader("Parameter | FY 2025-26 | FY 2024-25", "end_year")).toEqual([2026, 2025]);
    expect(parseYearHeader("Parameter | FY 2025-26 | FY 2024-25", "start_year")).toEqual([2025, 2024]);
    expect(parseYearHeader("Total | 3,63,50,070 | 2024", "end_year")).toBeNull();
    expect(parseYearHeader("GHG emissions (tCO2e) FY2024 FY2025", "start_year")).toEqual([2024, 2025]); // the company's own label, as printed
  });
  it("aligns short rows to the latest years and rejects overlong rows", () => {
    expect(alignToYears(findNumbers("x | 1 | 2"), [2023, 2024, 2025])!.map((m) => m.year)).toEqual([2024, 2025]);
    expect(alignToYears(findNumbers("x | 1 | 2 | 3"), [2024, 2025])).toBeNull();
  });
});

describe("rule-based extractor", () => {
  it("extracts a Microsoft-style table with the right years and units", () => {
    const c = extractCandidates([page(MSFT)], { industryCodes: ["TC-SI"], convention: "end_year", reportingYear: null });
    const get = (m: string, y: number) => c.find((x) => x.metricId === m && x.year === y);
    expect(get("ghg_scope1", 2025)).toMatchObject({ value: 170887, unit: "tCO2e", consolidation: "operational_control" });
    expect(get("ghg_scope2_market", 2025)).toMatchObject({ value: 2707428, scope2Method: "market" });
    expect(get("ghg_scope2_location", 2025)?.value).toBe(12030556);
    expect(get("ghg_scope3_total", 2025)?.value).toBe(18243000);
  });
  it("reads an Indian BRSR row as standalone (parent only) with FY 2025-26 = 2026", () => {
    const c = extractCandidates([page(BRSR)], { industryCodes: ["EM-RM"], convention: "end_year", reportingYear: null });
    expect(c.find((x) => x.year === 2026)).toMatchObject({ metricId: "ghg_scope1", value: 36350070, boundary: "parent_only" });
  });
  it("reads a wrapped unit and skips the ambiguous space-grouped waste row", () => {
    const c = extractCandidates([page(NESTLE)], { industryCodes: ["FB-PF"], convention: "end_year", reportingYear: null });
    expect(c.find((x) => x.metricId === "ghg_scope1" && x.year === 2025)).toMatchObject({ value: 2.82, unit: "MtCO2e" });
    expect(c.some((x) => x.metricId === "waste_total")).toBe(false);
  });
  it("skips scanned pages and pages without a determinable unit", () => {
    expect(extractCandidates([{ ...page(MSFT), isScanned: true }], { industryCodes: ["TC-SI"], convention: "end_year", reportingYear: null })).toEqual([]);
    expect(extractCandidates([page("2024 | 2025\nScope 1 | 10 | 12")], { industryCodes: ["TC-SI"], convention: "end_year", reportingYear: null })).toEqual([]);
  });
  it("cites spreadsheet cells as Sheet!A1", () => {
    const cells = { A1: "tCO2e", B1: "2024", C1: "2025", A2: "Scope 1", B2: "100", C2: "120" };
    const c = extractCandidates([{ pageNumber: 1, label: "Sheet: GHG", text: "", cells }], { industryCodes: ["TC-SI"], convention: "end_year", reportingYear: null });
    expect(c.find((x) => x.year === 2025)).toMatchObject({ value: 120, cell: "GHG!C2" });
  });
});

// Real layouts from the first live refresh (Siemens Limited BRSR, TSMC climate report, Reliance prose).
const BRSR_ENERGY = `Parameter | FY 2026 | FY 2024
From Renewable Sources (in gigajoules)
Total energy consumption (A+B+C) from renewable sources | 64,550 | 56,229
From non-renewable Sources (in gigajoules)
Total energy consumed from non-renewable sources (D+E+F) | 178,268 | 153,863
Total Energy consumed (A+B+C+D+E+F) | 242,818 | 210,092
Energy intensity per rupee of turnover
(Total energy consumed / Revenue from operations) GJ/million rupees of | 0.93 | 1.03
Total volume of water consumption (in kiloliters) | 313,579 | 282,315
Water intensity per rupee of turnover (Total water consumption Revenue from | 1.2 | 1.38
Waste intensity per rupee of turnover (Total waste generated / Revenue from operations) (in metric tonnes) | 0.11 | 0.08
Details related to the standalone entity`;
const TSMC = `Key Indicators | 2021 | 2022 | 2023 | 2024 | 2025
GHG Emissions (MTCO2e) ( Scope 1 and Scope 2 market-based ) | 10,304,344 | 11,558,554 | 11,783,418 | 12,783,269 | 13,327,087
Scope 1 (MTCO2e) | 2,151,937 | 2,018,789 | 1,596,031 | 1,825,872 | 2,196,516
Scope 2 (MTCO2e) (market-based) | 8,152,497 | 9,539,765 | 10,187,387 | 10,957,397 | 11,130,571
Scope 3 (MTCO2e) | 6,049,256 | 7,429,158 | 7,616,655 | 8,223,173 | 36,299,005`;
const RELIANCE_PROSE = `Key Indicators | 2024 | 2025
academic and research institutions | energy hubs on wastelands, combining | For this year, Scope 1 and Scope 2 with location-based method is 46.13 MMT CO2e.`;

describe("rule-based extractor: empty cells printed as dashes", () => {
  it("keeps each value in its own column, and skips rows whose cells do not line up with the years", () => {
    const aligned = `(in ktCO2e) | 2019 | 2025 | 2030 | 2050
Gross Scope 1 GHG emissions - 288 - -`;
    const c = extractCandidates([page(aligned)], { industryCodes: ["TR-AU"], convention: "end_year", reportingYear: null });
    expect(c.map((x) => [x.metricId, x.year, x.value])).toEqual([["ghg_scope1", 2025, 288]]); // not 2050
    const misaligned = `(in ktCO2e) | 2019 | 2025 | 2030 | 2050
Gross Scope 1 GHG emissions - 288 - - -`;
    expect(extractCandidates([page(misaligned)], { industryCodes: ["TR-AU"], convention: "end_year", reportingYear: null })).toEqual([]);
    // A dash inside the label is not an empty cell.
    const label = `GHG emissions (mtCO2e) | FY24 | FY25
Category 3 – Fuel- and energy-related activities | 708,000 | 1,075,000`;
    const l = extractCandidates([page(label)], { industryCodes: ["TC-SI"], convention: "end_year", reportingYear: null });
    expect(l.find((x) => x.metricId === "ghg_scope3_c3" && x.year === 2025)?.value).toBe(1075000);
  });
});

describe("rule-based extractor: rows that are not the metric", () => {
  it("skips intensity ratios and renewable / non-renewable energy subtotals", () => {
    const c = extractCandidates([page(BRSR_ENERGY)], { industryCodes: ["TR-AU"], convention: "end_year", reportingYear: null });
    const energy = c.filter((x) => x.metricId === "energy_total");
    expect(energy.map((x) => [x.year, x.value])).toEqual([[2026, 242818], [2024, 210092]]); // the year header really says FY 2024
    expect(c.filter((x) => x.metricId === "water_consumption").map((x) => x.value)).toEqual([313579, 282315]);
    expect(c.some((x) => x.metricId === "waste_total")).toBe(false);
    expect(c.every((x) => x.boundary === "parent_only")).toBe(true);
  });
  it("does not read a combined Scope 1 + 2 row as Scope 2, and reads 'Scope 3 (unit) |' rows", () => {
    const c = extractCandidates([page(TSMC)], { industryCodes: ["TC-HW", "TC-SC"], convention: "end_year", reportingYear: null });
    expect(c.filter((x) => x.metricId === "ghg_scope2_market" && x.year === 2025).map((x) => x.value)).toEqual([11130571]);
    expect(c.find((x) => x.metricId === "ghg_scope1" && x.year === 2025)?.value).toBe(2196516);
    expect(c.find((x) => x.metricId === "ghg_scope3_total" && x.year === 2025)?.value).toBe(36299005);
  });
  it("ignores combined-scope figures in running prose", () => {
    const c = extractCandidates([page(RELIANCE_PROSE)], { industryCodes: ["EM-RM"], convention: "end_year", reportingYear: null });
    expect(c).toEqual([]);
  });
});

describe("evidence gate (rule 6)", () => {
  const text = "Scope 1 | 118,100 | 123,704 | 170,887\nOther line";
  it("passes when wording and value are on the stored page", () => {
    expect(verifyEvidence({ value: 170887, reportedWording: "Scope 1 | 118,100 | 123,704 | 170,887", pageText: text }).ok).toBe(true);
  });
  it("tolerates pipe/whitespace layout differences", () => {
    expect(verifyEvidence({ value: 170887, reportedWording: "Scope 1  118,100 123,704   170,887", pageText: text }).ok).toBe(true);
  });
  it("blocks wording that is not on the page", () => {
    expect(verifyEvidence({ value: 170887, reportedWording: "Scope 1 | 170,887 (restated)", pageText: text }).ok).toBe(false);
  });
  it("blocks a value that is not in the wording", () => {
    expect(verifyEvidence({ value: 170888, reportedWording: "Scope 1 | 118,100 | 123,704 | 170,887", pageText: text }).ok).toBe(false);
    expect(verifyEvidence({ value: 70887, reportedWording: "Scope 1 | 118,100 | 123,704 | 170,887", pageText: text }).ok).toBe(false);
  });
  it("checks spreadsheet cells by address", () => {
    const cells = { C2: "120" };
    expect(verifyEvidence({ value: 120, reportedWording: "x", pageText: "", cells, cell: "GHG!C2" }).ok).toBe(true);
    expect(verifyEvidence({ value: 121, reportedWording: "x", pageText: "", cells, cell: "GHG!C2" }).ok).toBe(false);
  });
});

describe("Claude extractor (no network: fake client)", () => {
  it("selects keyword-rich pages and drops structurally invalid answers", async () => {
    const pages = [page("Cover page"), page(MSFT, 3), { ...page("", 4), isScanned: true }];
    expect(selectPages(pages, ["TC-SI"]).map((p) => p.pageNumber)).toEqual([3]);
    const fake = {
      beta: {
        messages: {
          parse: async () => ({
            stop_reason: "end_turn",
            usage: { input_tokens: 100, output_tokens: 50 },
            parsed_output: {
              values: [
                { metric_id: "ghg_scope1", year: 2025, value: 170887, unit: "tCO2e", page_number: 3, reported_wording: "Scope 1 | 118,100", boundary: "not_stated" },
                { metric_id: "ghg_scope1", year: 2025, value: 1, unit: "furlongs", page_number: 3, reported_wording: "x", boundary: "not_stated" },
                { metric_id: "au_bev_sales", year: 2025, value: 1, unit: "units", page_number: 3, reported_wording: "x", boundary: "not_stated" },
                { metric_id: "ghg_scope1", year: 2025, value: 1, unit: "tCO2e", page_number: 99, reported_wording: "x", boundary: "not_stated" },
              ],
            },
          }),
        },
      },
    };
    const r = await extractWithClaude(pages, { industryCodes: ["TC-SI"], convention: "end_year", companyName: "Test" }, fake as never);
    expect(r.candidates).toHaveLength(1);
    expect(r.dropped).toBe(3);
    expect(r.candidates[0]).toMatchObject({ metricId: "ghg_scope1", pageLabel: "PDF p.3", consolidation: "operational_control" });
  });
  it("fails loudly on a refusal instead of returning partial data", async () => {
    const fake = { beta: { messages: { parse: async () => ({ stop_reason: "refusal", usage: { input_tokens: 1, output_tokens: 1 }, parsed_output: null }) } } };
    await expect(extractWithClaude([page(MSFT, 3)], { industryCodes: ["TC-SI"], convention: "end_year", companyName: "T" }, fake as never)).rejects.toThrow(/refusal/);
  });
});

describe("memory guard probes", () => {
  it("parses macOS vm_stat (free + inactive + speculative + purgeable)", () => {
    const out = `Mach Virtual Memory Statistics: (page size of 16384 bytes)
Pages free:                               1000.
Pages active:                             9999.
Pages inactive:                           2000.
Pages speculative:                         500.
Pages purgeable:                           100.`;
    expect(parseVmStat(out)).toBe((1000 + 2000 + 500 + 100) * 16384);
  });
  it("parses Linux MemAvailable", () => {
    expect(parseMemInfo("MemTotal: 8000 kB\nMemAvailable:    2048 kB\n")).toBe(2048 * 1024);
  });
});

describe("OCR for image-only pages", () => {
  it("reads a scanned table, labels the page (OCR), and lowers the proposals' confidence", async () => {
    const { createCanvas } = await import("@napi-rs/canvas");
    const PDFDocument = (await import("pdfkit")).default;
    const { mkdtempSync, rmSync, writeFileSync } = await import("node:fs");
    const { tmpdir } = await import("node:os");
    const path = await import("node:path");
    const { parseFile } = await import("@/lib/pipeline/ingest");

    const canvas = createCanvas(1400, 320);
    const g = canvas.getContext("2d");
    g.fillStyle = "#ffffff";
    g.fillRect(0, 0, 1400, 320);
    g.fillStyle = "#000000";
    g.font = "40px sans-serif";
    g.fillText("GHG emissions (tCO2e)      FY2024      FY2025", 30, 90);
    g.fillText("Scope 1 emissions               53,300        55,900", 30, 190);
    const png = await canvas.encode("png");
    const dir = mkdtempSync(path.join(tmpdir(), "csi-ocr-"));
    try {
      const file = path.join(dir, "scan.pdf");
      const pdf = await new Promise<Buffer>((resolve) => {
        const d = new PDFDocument({ size: [700, 160] });
        const chunks: Buffer[] = [];
        d.on("data", (c: Buffer) => chunks.push(c));
        d.on("end", () => resolve(Buffer.concat(chunks)));
        d.image(png, 0, 0, { width: 700 });
        d.end();
      });
      writeFileSync(file, pdf);
      const pages = await parseFile(file, "application/pdf");
      expect(pages[0]).toMatchObject({ label: "PDF p.1 (OCR)", isScanned: true });
      expect(pages[0].text).toMatch(/55,900/);
      const c = extractCandidates(pages, { industryCodes: ["TC-SI"], convention: "end_year", reportingYear: null });
      const v = c.find((x) => x.metricId === "ghg_scope1" && x.year === 2025)!;
      expect(v).toMatchObject({ value: 55900, pageLabel: "PDF p.1 (OCR)" });
      expect(v.confidence).toBeLessThan(0.75);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }, 60_000);
});

describe("rule-based extractor: precision rules (measured on the evaluation set)", () => {
  const ctx = { industryCodes: ["TC-HW", "TC-SC"], convention: "end_year" as const, reportingYear: null, maxYear: 2026 };
  const run = (text: string, extra = {}) => extractWithDiagnostics([page(text)], { ...ctx, ...extra });
  it("does not read digits inside a unit ('1,000 tonnes CO2e') as a value", () => {
    const c = run(`Category | Unit | 2023 | 2024 | 2025\nPurchased products and services | 1,000 tonnes CO₂e | 11,514 | 10,827 | 10,945`).candidates;
    expect(c.filter((x) => x.metricId === "ghg_scope3_c1").map((x) => [x.year, x.value, x.unit])).toEqual([
      [2025, 10945, "ktCO2e"],
      [2024, 10827, "ktCO2e"],
      [2023, 11514, "ktCO2e"],
    ]);
  });
  it("skips per-gas rows, share rows, water-stress subsets and all-scope totals", () => {
    const t = `(mtCO2e) | 2024 | 2025\nScope 1 – CH4 | 57 | 75\nPercentage of Scope 1 GHG emissions from regulated schemes | 6.6 | 7.1\nTotal GHG emissions location-based | 70.1 | 71.31`;
    expect(run(t).candidates).toEqual([]);
    expect(run(`(ML) | 2024 | 2025\nWater withdrawn in regions with high water stress | 44.8 | 44.4`).candidates).toEqual([]);
  });
  it("stops at the next label cell and refuses a label followed by another label", () => {
    const energy = run(`Item | Unit | 2023 | 2024 | 2025\nEnergy consumption at business sites | GWh | 36,399 | 38,772 | 40,249 | Cumulative amount of e-waste collected | Tonnes | 6,297,161 | 6,908,516 | 7,544,747`).candidates;
    expect(energy.filter((x) => x.metricId === "energy_total").map((x) => x.value)).toEqual([40249, 38772, 36399]);
    expect(run(`(tCO2e) | 2024 | 2025\nScope 1 | Revenue ($M) | 245,122 | 281,724`).candidates).toEqual([]);
  });
  it("uses only the first run of distinct years in a header and never reports target-year columns", () => {
    expect(parseYearHeader("2023 | 2024 | 2025 | Key calculation items | Main activity data | 2025", "end_year")).toEqual([2023, 2024, 2025]);
    const siemens = `Fiscal year Fiscal year Annual %\n2019 | 2025 2030 2050 target/\n(in ktCO₂e)\nGross Scope 1 GHG emissions - 288 - - -\nTotal Gross indirect (Scope 3) GHG emissions 179,222 159,144 (30)% - (2.7)%`;
    const c = run(siemens).candidates;
    expect(c.map((x) => [x.metricId, x.year, x.value])).toEqual([
      ["ghg_scope1", 2025, 288],
      ["ghg_scope3_total", 2025, 159144],
      ["ghg_scope3_total", 2019, 179222],
    ]);
  });
  it("never reads a printed year as a value, and skips footnote lines", () => {
    expect(run(`(tCO2e) | 2024 | 2025\nScope 2 market-based emissions | 2017 | 2025`).candidates).toEqual([]);
    expect(run(`(tCO2e) | 2024 | 2025\n4) Based on Scope 1 emissions + Scope 2 emissions (market-based) | 3 | 2`).candidates).toEqual([]);
  });
  it("proposes one value per metric and year, and logs equally likely values as skipped", () => {
    const two = [page(`(tCO2e) | 2024 | 2025\nScope 1 | 100,000 | 110,000`, 1), page(`(tCO2e) | 2024 | 2025\nScope 1 | 100,000 | 120,000`, 2)];
    const r = extractWithDiagnostics(two, ctx);
    expect(r.candidates.filter((x) => x.year === 2024).map((x) => x.value)).toEqual([100000]); // printed twice: supports itself
    expect(r.candidates.some((x) => x.year === 2025)).toBe(false);
    expect(r.skipped).toEqual([{ metricId: "ghg_scope1", year: 2025, values: expect.arrayContaining([110000, 120000]), reason: "different values equally likely" }]);
  });
  it("prefers the group row over a division table", () => {
    const group = page(`(in kilolitres) | FY 2025-26 | FY 2024-25\nTotal volume of water withdrawal (in kilolitres) | 20,45,55,068 | 20,84,65,383`, 1);
    const division = page(`(in kilolitres) | FY 2025-26 | FY 2024-25\nManufacturing Division (JMD) | Total volume of water withdrawal (in kilolitres) | 2,262 | 3,116`, 2);
    const c = extractWithDiagnostics([group, division], { ...ctx, industryCodes: ["EM-RM"] }).candidates;
    expect(c.filter((x) => x.metricId === "water_withdrawal").map((x) => x.value)).toEqual([204555068, 208465383]);
  });
});
