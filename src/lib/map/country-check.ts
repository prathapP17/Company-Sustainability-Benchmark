/**
 * Coordinate sanity check for data validation (tests and npm run validate):
 * does a headquarters point lie in the country the company file names? It
 * never changes a coordinate. Uses the 1:50m shapes, so it is kept out of the
 * page bundles (geo.ts uses 1:110m).
 */
import { geoContains } from "d3-geo";
import type { Feature, FeatureCollection, Geometry } from "geojson";
import world50 from "world-atlas/countries-50m.json";
import { countriesOf, naturalEarthName, type Countries } from "./geo";

let fine: FeatureCollection<Geometry, { name: string }> | undefined;

/** True when the point lies in (or within ~0.3° of) the named country; null when the country name is unknown. */
export function pointInCountry(lat: number, lon: number, country: string): boolean | null {
  fine ??= countriesOf(world50 as unknown as Countries);
  const f = fine.features.find((x) => x.properties.name === naturalEarthName(country)) as Feature<Geometry, { name: string }> | undefined;
  if (!f) return null;
  const d = 0.3;
  return [[0, 0], [d, 0], [-d, 0], [0, d], [0, -d]].some(([a, b]) => geoContains(f, [lon + a, lat + b]));
}
