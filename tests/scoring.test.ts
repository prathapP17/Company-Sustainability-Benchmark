import { describe, expect, it } from "vitest";
import { loadCompanies } from "@/lib/data/load";
import { transparency, CHECKLIST_LABELS } from "@/lib/scoring/transparency";
import { changeScore, performance, MIN_INDICATORS } from "@/lib/scoring/performance";
import { targetProgress } from "@/lib/scoring/targets";
import { compareSet, rankable } from "@/lib/scoring/comparability";
import { peerMedian } from "@/lib/scoring/peer";
import { findDuplicateKeys } from "@/lib/data/json-dupes";
import { CompanyFile } from "@/lib/schema/company";
import { baseCompany, REAL_DATA } from "./helpers";

const { companies } = loadCompanies(REAL_DATA);
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
    const v = (x: number, extra = {}) => ({ ...group, canonical: x, ...extra });
    expect(peerMedian([v(1), v(2)]).median).toBeNull();
    expect(peerMedian([v(1), v(2), v(9, { boundary: "parent_only" })]).median).toBeNull();
    expect(peerMedian([v(1), v(2), v(9)]).median).toBe(2);
    expect(peerMedian([v(1), v(2), v(3), v(10)]).median).toBe(2.5);
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
    expect(p.indicators.find((i) => i.id === "waste_diversion")!.detail).toMatch(/partial coverage/);
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
