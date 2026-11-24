import { describe, expect, it } from "vitest";
import { alignToYears, detectUnit, findNumbers, numberForms, parseYearHeader } from "@/lib/pipeline/extract/parse";
import { extractCandidates } from "@/lib/pipeline/extract/rules";
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
  });
  it("aligns short rows to the latest years and rejects overlong rows", () => {
    expect(alignToYears(findNumbers("x | 1 | 2"), [2023, 2024, 2025])!.map((m) => m.year)).toEqual([2024, 2025]);
    expect(alignToYears(findNumbers("x | 1 | 2 | 3"), [2024, 2025])).toBeNull();
  });
});

describe("rule-based extractor", () => {
  it("extracts a Microsoft-style table with the right years and units", () => {
    const c = extractCandidates([page(MSFT)], { peerGroup: "software_it", convention: "end_year", reportingYear: null });
    const get = (m: string, y: number) => c.find((x) => x.metricId === m && x.year === y);
    expect(get("ghg_scope1", 2025)).toMatchObject({ value: 170887, unit: "tCO2e", consolidation: "operational_control" });
    expect(get("ghg_scope2_market", 2025)).toMatchObject({ value: 2707428, scope2Method: "market" });
    expect(get("ghg_scope2_location", 2025)?.value).toBe(12030556);
    expect(get("ghg_scope3_total", 2025)?.value).toBe(18243000);
  });
  it("reads an Indian BRSR row as standalone (parent only) with FY 2025-26 = 2026", () => {
    const c = extractCandidates([page(BRSR)], { peerGroup: "energy_conglomerates", convention: "end_year", reportingYear: null });
    expect(c.find((x) => x.year === 2026)).toMatchObject({ metricId: "ghg_scope1", value: 36350070, boundary: "parent_only" });
  });
  it("reads a wrapped unit and skips the ambiguous space-grouped waste row", () => {
    const c = extractCandidates([page(NESTLE)], { peerGroup: "consumer_staples", convention: "end_year", reportingYear: null });
    expect(c.find((x) => x.metricId === "ghg_scope1" && x.year === 2025)).toMatchObject({ value: 2.82, unit: "MtCO2e" });
    expect(c.some((x) => x.metricId === "waste_total")).toBe(false);
  });
  it("skips scanned pages and pages without a determinable unit", () => {
    expect(extractCandidates([{ ...page(MSFT), isScanned: true }], { peerGroup: "software_it", convention: "end_year", reportingYear: null })).toEqual([]);
    expect(extractCandidates([page("2024 | 2025\nScope 1 | 10 | 12")], { peerGroup: "software_it", convention: "end_year", reportingYear: null })).toEqual([]);
  });
  it("cites spreadsheet cells as Sheet!A1", () => {
    const cells = { A1: "tCO2e", B1: "2024", C1: "2025", A2: "Scope 1", B2: "100", C2: "120" };
    const c = extractCandidates([{ pageNumber: 1, label: "Sheet: GHG", text: "", cells }], { peerGroup: "software_it", convention: "end_year", reportingYear: null });
    expect(c.find((x) => x.year === 2025)).toMatchObject({ value: 120, cell: "GHG!C2" });
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
    expect(selectPages(pages, "software_it").map((p) => p.pageNumber)).toEqual([3]);
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
    const r = await extractWithClaude(pages, { peerGroup: "software_it", convention: "end_year", companyName: "Test" }, fake as never);
    expect(r.candidates).toHaveLength(1);
    expect(r.dropped).toBe(3);
    expect(r.candidates[0]).toMatchObject({ metricId: "ghg_scope1", pageLabel: "PDF p.3", consolidation: "operational_control" });
  });
  it("fails loudly on a refusal instead of returning partial data", async () => {
    const fake = { beta: { messages: { parse: async () => ({ stop_reason: "refusal", usage: { input_tokens: 1, output_tokens: 1 }, parsed_output: null }) } } };
    await expect(extractWithClaude([page(MSFT, 3)], { peerGroup: "software_it", convention: "end_year", companyName: "T" }, fake as never)).rejects.toThrow(/refusal/);
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
