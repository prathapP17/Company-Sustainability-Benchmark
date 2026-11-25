import { describe, expect, it } from "vitest";
import { loadCompanies } from "@/lib/data/load";
import { transparency, CHECKLIST_LABELS } from "@/lib/scoring/transparency";
import { changeScore, performance, MIN_INDICATORS } from "@/lib/scoring/performance";
import { targetProgress } from "@/lib/scoring/targets";
import { benchmarkSet, compareSet, rankable, sameBasis } from "@/lib/scoring/comparability";
import { classify } from "@/lib/industry";
import { getMetric, metricAppliesTo } from "@/lib/metrics/dictionary";
import { validateCompany } from "@/lib/schema/validate";
import { peerMedian } from "@/lib/scoring/peer";
import { findDuplicateKeys } from "@/lib/data/json-dupes";
import { CompanyFile } from "@/lib/schema/company";
import { baseCompany, REAL_DATA } from "./helpers";

const { companies, peerGroups } = loadCompanies(REAL_DATA);
const byId = (id: string) => companies.find((c) => c.profile.id === id)!;

const group = { boundary: "consolidated_group", consolidation: "operational_control", canonicalUnit: "tCO2e" };

describe("comparability (rule 4)", () => {
  it("only consolidated, full-coverage, non-low-confidence values are rankable", () => {
    expect(rankable(group).ok).toBe(true);
    expect(rankable({ ...group, boundary: "parent_only" }).ok).toBe(false);
    expect(rankable({ ...group, coverage: "Factories only" }).ok).toBe(false);
    expect(rankable({ ...group, lowConfidence: true }).ok).toBe(false);
  });
  it("flags mixed boundaries, methods and units", () => {
    expect(compareSet([group, group]).level).toBe("comparable");
    expect(compareSet([group, { ...group, boundary: "parent_only" }]).level).toBe("not_comparable");
    expect(compareSet([{ ...group, scope2Method: "market" }, { ...group, scope2Method: "location" }]).level).toBe("not_comparable");
    expect(compareSet([group, { ...group, consolidation: "not_stated" }]).level).toBe("caution");
  });
  it("peer median needs three comparable values", () => {
    const v = (x: number, extra = {}) => ({ ...peer, canonical: x, companyId: `c${x}`, ...extra });
    expect(peerMedian([v(1), v(2)], { industry: "TC-HW" }).median).toBeNull();
    expect(peerMedian([v(1), v(2), v(9, { boundary: "parent_only" })], { industry: "TC-HW" }).median).toBeNull();
    expect(peerMedian([v(1), v(2), v(9)], { industry: "TC-HW" }).median).toBe(2);
    expect(peerMedian([v(1), v(2), v(3), v(10)], { industry: "TC-HW" }).median).toBe(2.5);
  });
});

const peer = {
  boundary: "consolidated_group",
  consolidation: "operational_control",
  canonicalUnit: "tCO2e",
  metricId: "ghg_scope1",
  periodEnd: "2025-12-31",
  industry: "TC-HW",
  lowConfidence: false,
  coverage: null,
};

describe("comparability engine: one decision for the median and its status", () => {
  const v = (id: string, x: number, extra: Record<string, unknown> = {}) => ({ ...peer, companyId: id, canonical: x, ...extra });
  const reasonsOf = (r: ReturnType<typeof benchmarkSet>, id: string) => r.excluded.find((e) => e.value.companyId === id)?.reasons.join("; ") ?? "";

  it("excludes a different consolidation approach instead of warning and still calculating", () => {
    const r = benchmarkSet([v("a", 1), v("b", 2), v("c", 3), v("d", 100, { consolidation: "equity_share" })], { industry: "TC-HW" });
    expect(r.median).toBe(2);
    expect(r.included.map((x) => x.companyId)).toEqual(["a", "b", "c"]);
    expect(reasonsOf(r, "d")).toMatch(/consolidation approach is equity share/);
    // With only two on one approach there is no median at all.
    const r2 = benchmarkSet([v("a", 1), v("b", 2), v("d", 100, { consolidation: "equity_share" })], { industry: "TC-HW" });
    expect(r2.median).toBeNull();
    expect(r2.reason).toMatch(/2 comparable values/);
  });

  it("refuses a median when approaches split evenly", () => {
    const r = benchmarkSet(
      [v("a", 1), v("b", 2), v("c", 3), v("d", 4), v("e", 5, { consolidation: "equity_share" }), v("f", 6, { consolidation: "equity_share" }), v("g", 7, { consolidation: "equity_share" }), v("h", 8, { consolidation: "equity_share" })],
      { industry: "TC-HW" },
    );
    expect(r.median).toBeNull();
    expect(r.reason).toMatch(/split evenly/);
  });

  it("never mixes reporting periods, industries, Scope 2 methods or unstated consolidation", () => {
    const r = benchmarkSet(
      [
        v("a", 1),
        v("b", 2),
        v("c", 3),
        v("old", 50, { periodEnd: "2024-12-31" }),
        v("semi", 60, { industry: "TC-SC" }),
        v("review", 70, { industry: null }),
        v("ns", 80, { consolidation: "not_stated" }),
        v("partial", 90, { coverage: "Factories only" }),
        v("low", 95, { lowConfidence: true }),
        v("sub", 99, { boundary: "subsidiary_only" }),
      ],
      { industry: "TC-HW" },
    );
    expect(r.median).toBe(2);
    expect(r.basis).toEqual({ periodYear: "2025", consolidation: "operational_control", unit: "tCO2e" });
    expect(reasonsOf(r, "old")).toMatch(/ends in 2024/);
    expect(reasonsOf(r, "semi")).toMatch(/primary industry is TC-SC/);
    expect(reasonsOf(r, "review")).toMatch(/needs review/);
    expect(reasonsOf(r, "ns")).toMatch(/not stated/);
    expect(reasonsOf(r, "partial")).toMatch(/part of operations/);
    expect(reasonsOf(r, "low")).toMatch(/low-confidence/);
    expect(reasonsOf(r, "sub")).toMatch(/subsidiary only/);
    // Every input value is either included or excluded with a reason.
    expect(r.included.length + r.excluded.length).toBe(10);
    const s2 = benchmarkSet([v("a", 1, { metricId: "ghg_scope2_market", scope2Method: "location" })], { industry: "TC-HW" });
    expect(reasonsOf(s2, "a")).toMatch(/needs market-based/);
  });

  it("year-on-year needs the same basis in both years", () => {
    const a = { ...peer, canonical: 10 };
    expect(sameBasis(a, a).ok).toBe(true);
    expect(sameBasis({ ...a, trendBreak: true }, a).reason).toMatch(/trend break/);
    expect(sameBasis({ ...a, consolidation: "equity_share" }, a).reason).toMatch(/consolidation approach changed/);
    expect(sameBasis(a, { ...a, boundary: "parent_only" }).ok).toBe(false);
    expect(sameBasis({ ...a, scope2Method: "market" }, { ...a, scope2Method: "location" }).ok).toBe(false);
  });

  it("side-by-side display warns about periods and industries", () => {
    expect(compareSet([peer, { ...peer, periodEnd: "2024-12-31" }]).reasons.join()).toMatch(/periods end in different years/);
    expect(compareSet([peer, { ...peer, periodEnd: "2025-06-30" }]).reasons.join()).toMatch(/different months/);
    expect(compareSet([peer, { ...peer, industry: "TR-AU" }]).level).toBe("caution");
  });
});

describe("industry classification", () => {
  it("separates real industries inside a broad peer group", () => {
    const toyota = classify(byId("toyota").profile.industry);
    const siemens = classify(byId("siemens").profile.industry);
    expect(byId("toyota").profile.peerGroup).toBe(byId("siemens").profile.peerGroup);
    expect(toyota).toMatchObject({ codes: ["TR-AU"], primary: "TR-AU", needsReview: false });
    expect(siemens).toMatchObject({ codes: ["RT-IG", "RT-EE"], primary: null, needsReview: true });
    expect(classify(byId("nestle").profile.industry).primary).not.toBe(classify(byId("unilever").profile.industry).primary);
  });
  it("assigns industry metrics by SASB industry, not by peer group", () => {
    expect(metricAppliesTo(getMetric("au_bev_sales"), classify(byId("toyota").profile.industry).codes)).toBe(true);
    expect(metricAppliesTo(getMetric("au_bev_sales"), classify(byId("siemens").profile.industry).codes)).toBe(false);
    expect(metricAppliesTo(getMetric("sc_pfc_emissions"), classify(byId("apple").profile.industry).codes)).toBe(false);
    expect(metricAppliesTo(getMetric("sc_pfc_emissions"), classify(byId("samsung").profile.industry).codes)).toBe(true);
  });
  it("flags text-only or unknown classifications instead of guessing", () => {
    expect(classify({ sasb: "Hardware (TC-HW)" })).toMatchObject({ codes: ["TC-HW"], needsReview: true });
    expect(classify({ sasb: "Unknown" })).toMatchObject({ codes: [], primary: null, needsReview: true });
    const bad = baseCompany();
    bad.profile.industry = { gics: "x", sasb: "Hardware (TC-HW)", sasbCodes: ["TC-XX"] };
    const r = validateCompany("companies/testco.json", bad, peerGroups);
    expect(r.issues.map((i) => i.message).join("\n")).toMatch(/unknown SASB industry code "TC-XX"/);
  });
  it("the transparency industry item is not assessable when no metric exists for the industry", () => {
    const item = transparency(byId("siemens")).items.find((i) => i.id === "industry_metric")!;
    expect(item.met).toBeNull();
    expect(transparency(byId("toyota")).items.find((i) => i.id === "industry_metric")!.met).toBe(true);
  });
});

describe("target progress", () => {
  const base = { type: "absolute", category: "emissions", baselineYear: 2019, targetYear: 2030, targetValue: 90, targetUnit: "% reduction", latestYear: 2025, latestValue: 66, latestUnit: "% reduction" };
  it("compares achieved share with a straight-line path", () => {
    const p = targetProgress(base);
    expect(p.achievedShare).toBeCloseTo(73.33, 1);
    expect(p.expectedShare).toBeCloseTo(54.55, 1);
    expect(p.status).toBe("ahead");
  });
  it("is not computable without a reported progress value or with mismatched units", () => {
    expect(targetProgress({ ...base, latestValue: null }).status).toBe("not_computable");
    expect(targetProgress({ ...base, latestUnit: "MtCO2e" }).status).toBe("not_computable");
    expect(targetProgress({ ...base, type: "net_zero" }).status).toBe("not_computable");
  });
});

describe("performance scoring", () => {
  it("maps year-on-year change onto 0-100", () => {
    expect(changeScore(-10)).toBe(100);
    expect(changeScore(-4.2)).toBe(100);
    expect(changeScore(0)).toBe(50);
    expect(changeScore(5)).toBe(25);
    expect(changeScore(25)).toBe(0);
  });
  it("excludes non-group boundaries (Reliance is standalone)", () => {
    const p = performance(byId("reliance"));
    expect(p.score).toBeNull();
    expect(p.indicators.find((i) => i.id === "renewable_share")!.detail).toMatch(/parent only/);
  });
  it("excludes partial coverage (Toyota water and waste)", () => {
    const p = performance(byId("toyota"));
    expect(p.indicators.find((i) => i.id === "water_yoy")!.score).toBeNull();
    expect(p.indicators.find((i) => i.id === "waste_diversion")!.detail).toMatch(/covers only part of operations/);
  });
  it("skips year-on-year change across a trend break", () => {
    const c = CompanyFile.parse(
      baseCompany({
        metrics: [
          { metric: "ghg_scope1", year: 2025, state: "disclosed", value: 10, unit: "tCO2e", page: "p.1" },
          { metric: "ghg_scope1", year: 2024, state: "disclosed", value: 12, unit: "tCO2e", page: "p.1" },
          { metric: "ghg_scope2_market", year: 2025, state: "disclosed", value: 5, unit: "tCO2e", page: "p.1", scope2Method: "market", trendBreak: true },
          { metric: "ghg_scope2_market", year: 2024, state: "disclosed", value: 5, unit: "tCO2e", page: "p.1", scope2Method: "market" },
        ],
      }),
    );
    expect(performance(c).indicators.find((i) => i.id === "ghg_s12_yoy")!.detail).toMatch(/trend break/);
  });
  it(`withholds the composite below ${MIN_INDICATORS} indicators`, () => {
    for (const c of companies) {
      const p = performance(c);
      if (p.available < MIN_INDICATORS) expect(p.score).toBeNull();
      else expect(p.score).not.toBeNull();
    }
  });
});

describe("transparency scoring", () => {
  it("has one result per checklist item", () => {
    expect(transparency(byId("apple")).items).toHaveLength(CHECKLIST_LABELS.length);
  });
  it("withholds the score below the coverage threshold (rule 2)", () => {
    const t = transparency(byId("tsmc"));
    expect(t.score).toBeNull();
    expect(t.reason).toMatch(/insufficient coverage/);
  });
  it("treats an unreadable assurance level as not assessable, not as 'no assurance'", () => {
    const t = transparency(byId("samsung"));
    expect(t.items.find((i) => i.id === "ghg_assurance")!.met).toBeNull();
  });
  it("marks a standalone boundary as not meeting the group-boundary item", () => {
    expect(transparency(byId("reliance")).items.find((i) => i.id === "group_boundary")!.met).toBe(false);
  });
});

describe("data hygiene", () => {
  it("detects duplicate JSON keys that JSON.parse would silently drop", () => {
    expect(findDuplicateKeys('{"a":1,"m":[{"note":"x","note":"y"}]}')).toEqual(["$.m[0].note"]);
    expect(findDuplicateKeys('{"s":"\\"note\\": x","note":1}')).toEqual([]);
  });
});
