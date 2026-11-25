import { describe, expect, it } from "vitest";
import { loadCompanies } from "@/lib/data/load";
import { coordinateProblem, mapGeometry, placeOnMap } from "@/lib/map/geo";
import { pointInCountry } from "@/lib/map/country-check";
import { REAL_DATA } from "./helpers";

const { companies } = loadCompanies(REAL_DATA);

describe("headquarters locations", () => {
  it("every company's coordinates lie in the country its file names (checked, never corrected)", () => {
    for (const c of companies) {
      const { lat, lon, country } = c.profile.hq;
      expect(pointInCountry(lat, lon, country), `${c.profile.id}: ${lat},${lon} in ${country}`).toBe(true);
    }
  });
  it("does not place missing, out-of-range or placeholder coordinates", () => {
    expect(coordinateProblem(0, 0)).toMatch(/placeholder/);
    expect(coordinateProblem(91, 10)).toMatch(/out of range/);
    expect(coordinateProblem(undefined, 10)).toMatch(/missing/);
    expect(placeOnMap(Number.NaN, 1)).toEqual({ problem: "coordinates missing" });
    const p = placeOnMap(48.14, 11.58);
    expect("x" in p && p.x > 0 && p.y > 0).toBe(true);
  });
  it("builds a self-contained base map (no external tiles)", () => {
    const g = mapGeometry(["Japan", "Atlantis"]);
    expect(g.width).toBe(1000);
    expect(g.hqCountries.map((h) => h.name)).toEqual(["Japan"]); // unknown names are skipped, not approximated
  });
});
