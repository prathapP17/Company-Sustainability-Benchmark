import { describe, expect, it } from "vitest";
import { toCanonical, METRICS } from "@/lib/metrics/dictionary";
import { fiscalLabel, periodEnd } from "@/lib/fiscal";
import { formatCompact } from "@/lib/format";

describe("unit conversion is exact scaling", () => {
  it("converts emissions units", () => {
    expect(toCanonical("ghg_scope1", 2.82, "MtCO2e")).toBeCloseTo(2_820_000);
    expect(toCanonical("ghg_scope1", 4646, "ktCO2e")).toBe(4_646_000);
  });
  it("converts energy units", () => {
    expect(toCanonical("energy_total", 40249, "GWh")).toBe(40_249_000);
    expect(toCanonical("energy_total", 3.6, "GJ")).toBeCloseTo(1);
  });
  it("converts US gallons and pounds exactly", () => {
    expect(toCanonical("water_withdrawal", 1, "million gallons")).toBeCloseTo(3.785411784, 9);
    expect(toCanonical("waste_total", 1, "lb")).toBeCloseTo(0.00045359237, 12);
  });
  it("returns null for an unaccepted unit", () => {
    expect(toCanonical("ghg_scope1", 1, "kg")).toBeNull();
  });
  it("defines all 15 Scope 3 categories", () => {
    expect(METRICS.filter((m) => /^ghg_scope3_c\d+$/.test(m.id))).toHaveLength(15);
  });
});

describe("fiscal-year labels (lessons learned)", () => {
  it("India FY2025 (end-year label) ends March 2025", () => {
    expect(periodEnd({ end: "03-31", labelConvention: "end_year" }, 2025)).toBe("2025-03-31");
  });
  it("Japan FY2025 (start-year label) ends March 2026", () => {
    expect(periodEnd({ end: "03-31", labelConvention: "start_year" }, 2025)).toBe("2026-03-31");
    expect(fiscalLabel({ end: "03-31", labelConvention: "start_year" }, 2025)).toBe("FY2025 (to Mar 2026)");
  });
  it("calendar years print as the bare year", () => {
    expect(fiscalLabel({ end: "12-31", labelConvention: "end_year" }, 2025)).toBe("2025");
  });
});

describe("formatting", () => {
  it("formats compact canonical values", () => {
    expect(formatCompact(36_350_070, "tCO2e")).toBe("36.4 Mt CO2e");
    expect(formatCompact(159_144_000, "tCO2e")).toBe("159 Mt CO2e");
    expect(formatCompact(null, "tCO2e")).toBe("—");
  });
});
