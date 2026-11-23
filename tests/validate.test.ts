import { describe, expect, it } from "vitest";
import { validateCompany } from "@/lib/schema/validate";
import { loadCompanies, loadPeerGroups } from "@/lib/data/load";
import { baseCompany, REAL_DATA } from "./helpers";

const peers = loadPeerGroups(REAL_DATA);
const run = (c: unknown) => validateCompany("data/companies/testco.json", c, peers);
const errors = (c: unknown) => run(c).issues.filter((i) => i.level === "error").map((i) => i.message);

describe("curated data", () => {
  it("all company files validate without errors", () => {
    const { companies, issues } = loadCompanies(REAL_DATA);
    expect(issues.filter((i) => i.level === "error")).toEqual([]);
    expect(companies.length).toBeGreaterThanOrEqual(10);
  });

  it("covers at least four peer groups", () => {
    const { companies } = loadCompanies(REAL_DATA);
    expect(new Set(companies.map((c) => c.profile.peerGroup)).size).toBeGreaterThanOrEqual(4);
  });
});

describe("rule 1: every disclosed number traces to a source and page", () => {
  it("rejects a disclosed value without a page", () => {
    const c = baseCompany({ metrics: [{ metric: "ghg_scope1", year: 2025, state: "disclosed", value: 10, unit: "tCO2e" }] });
    expect(errors(c).join()).toMatch(/page/);
  });

  it("rejects a disclosed value pointing at an unknown source", () => {
    const c = baseCompany({
      metrics: [{ metric: "ghg_scope1", year: 2025, state: "disclosed", value: 10, unit: "tCO2e", page: "p.1", source: "nope" }],
    });
    expect(errors(c).join()).toMatch(/unknown source/);
  });

  it("rejects an unknown unit", () => {
    const c = baseCompany({ metrics: [{ metric: "ghg_scope1", year: 2025, state: "disclosed", value: 10, unit: "furlongs", page: "p.1" }] });
    expect(errors(c).join()).toMatch(/unit "furlongs" not accepted/);
  });
});

describe("rule 2: missing is not zero", () => {
  it("rejects a value on a not-found entry", () => {
    const c = baseCompany({ metrics: [{ metric: "ghg_scope1", year: 2025, state: "not_found", value: 0, unit: "tCO2e", page: "p.1" }] });
    expect(errors(c).join()).toMatch(/must not carry a value/);
  });

  it("accepts a not-disclosed entry with a note", () => {
    const c = baseCompany({ metrics: [{ metric: "ghg_scope3_total", year: 2025, state: "not_disclosed", note: "answered '-'" }] });
    expect(errors(c)).toEqual([]);
  });
});

describe("rule 3: comparability context", () => {
  it("requires the matching Scope 2 method", () => {
    const c = baseCompany({
      metrics: [{ metric: "ghg_scope2_market", year: 2025, state: "disclosed", value: 5, unit: "tCO2e", page: "p.1", scope2Method: "location" }],
    });
    expect(errors(c).join()).toMatch(/must state method "market"/);
  });

  it("requires a method note on derived values", () => {
    const c = baseCompany({
      metrics: [{ metric: "ghg_scope3_total", year: 2025, state: "disclosed", value: 5, unit: "tCO2e", page: "p.1", status: "derived" }],
    });
    expect(errors(c).join()).toMatch(/derived value must describe its method/);
  });
});

describe("rule 4/8: conflicts and boundaries", () => {
  it("rejects two values for the same metric, year and boundary", () => {
    const v = { metric: "ghg_scope1", year: 2025, state: "disclosed" as const, value: 5, unit: "tCO2e", page: "p.1" };
    const c = baseCompany({ metrics: [v, { ...v, value: 6 }] });
    expect(errors(c).join()).toMatch(/conflicts with/);
  });

  it("allows the same metric on two different boundaries (stored separately)", () => {
    const v = { metric: "ghg_scope1", year: 2025, state: "disclosed" as const, value: 5, unit: "tCO2e", page: "p.1" };
    const c = baseCompany({ metrics: [v, { ...v, value: 3, boundary: "parent_only" }] });
    expect(errors(c)).toEqual([]);
  });
});

describe("rule 7: low-confidence sources are flagged", () => {
  it("warns on search excerpts", () => {
    const c = baseCompany({
      metrics: [
        { metric: "ghg_scope1", year: 2025, state: "disclosed", value: 5, unit: "tCO2e", page: "snippet", verificationClass: "search_excerpt" },
      ],
    });
    const w = run(c).issues.filter((i) => i.level === "warning");
    expect(w.map((i) => i.message).join()).toMatch(/low-confidence/);
  });
});

describe("industry metrics", () => {
  it("rejects an industry metric outside its peer group", () => {
    const c = baseCompany({
      metrics: [{ metric: "au_bev_sales", year: 2025, state: "disclosed", value: 1, unit: "units", page: "p.1" }],
    });
    expect(errors(c).join()).toMatch(/does not apply to peer group/);
  });
});

describe("research status", () => {
  it("'detailed' requires every core metric to be assessed", () => {
    const c = baseCompany({
      researchStatus: "detailed",
      metrics: [{ metric: "ghg_scope1", year: 2025, state: "disclosed", value: 5, unit: "tCO2e", page: "p.1" }],
    });
    expect(errors(c).join()).toMatch(/requires core metric/);
  });
});
