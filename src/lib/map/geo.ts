/**
 * World map geometry for the dashboard, computed on the server (or at build
 * time) so the browser receives only SVG path strings and marker positions:
 * no map library, no tiles, no third-party requests, no API key.
 *
 * Country shapes: Natural Earth 1:110m (public domain) via the world-atlas
 * package. Projection: Equal Earth (equal-area, so no region looks larger than
 * it is). Antarctica is left out.
 */
import "server-only";
import { geoEqualEarth, geoPath } from "d3-geo";
import { feature, mesh } from "topojson-client";
import type { FeatureCollection, Geometry } from "geojson";
import type { GeometryCollection, Topology } from "topojson-specification";
import world110 from "world-atlas/countries-110m.json";

export const MAP_WIDTH = 1000;

export type Countries = Topology<{ countries: GeometryCollection<{ name: string }>; land: GeometryCollection }>;

/** Company files name some countries differently from Natural Earth. */
const COUNTRY_ALIASES: Record<string, string> = { "United States": "United States of America" };
export const naturalEarthName = (country: string) => COUNTRY_ALIASES[country] ?? country;

export function countriesOf(topo: Countries): FeatureCollection<Geometry, { name: string }> {
  return feature(topo, topo.objects.countries) as FeatureCollection<Geometry, { name: string }>;
}

let cached: ReturnType<typeof build> | undefined;

function build() {
  const topo = world110 as unknown as Countries;
  const all = countriesOf(topo);
  const shown = { ...all, features: all.features.filter((f) => f.properties.name !== "Antarctica") };
  const projection = geoEqualEarth().fitWidth(MAP_WIDTH, shown);
  const [[, y0], [, y1]] = geoPath(projection).bounds(shown);
  const height = Math.ceil(y1 - y0 + 2);
  projection.translate([projection.translate()[0], projection.translate()[1] - y0 + 1]);
  // Clipping to the frame drops Antarctica from the merged land shape.
  projection.clipExtent([[0, 0], [MAP_WIDTH, height]]);
  const path = geoPath(projection).digits(1);
  const coarse = geoPath(projection).digits(0); // borders are hairlines; whole units are enough
  const land = feature(topo, topo.objects.land);
  const borders = mesh(topo, topo.objects.countries, (a, b) => a !== b);
  return {
    projection,
    height,
    land: path(land) ?? "",
    borders: coarse(borders) ?? "",
    countryPath: (name: string) => {
      const f = shown.features.find((x) => x.properties.name === naturalEarthName(name));
      return f ? (path(f) ?? null) : null;
    },
  };
}

function geo() {
  cached ??= build();
  return cached;
}

export interface MapGeometry {
  width: number;
  height: number;
  /** Countries that host at least one headquarters, highlighted. */
  hqCountries: { name: string; d: string }[];
}

/** URL of the base map SVG (land and borders), served once and cached; the page references it with <use>. */
export const BASE_MAP_URL = "/map/world.svg";

export function mapGeometry(hqCountries: string[]): MapGeometry {
  const g = geo();
  return {
    width: MAP_WIDTH,
    height: g.height,
    hqCountries: [...new Set(hqCountries)].flatMap((name) => {
      const d = g.countryPath(name);
      return d ? [{ name, d }] : [];
    }),
  };
}

/** The base map as a standalone SVG document with #land and #borders. */
export function baseMapSvg(): string {
  const g = geo();
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${MAP_WIDTH} ${g.height}"><title>World map (Natural Earth 1:110m, public domain)</title><path id="land" d="${g.land}"/><path id="borders" fill="none" d="${g.borders}"/></svg>`;
}

/**
 * Why a coordinate cannot be placed (null when it can). Coordinates are never
 * guessed or corrected: an unusable one moves the company to the
 * "not on the map" list.
 */
export function coordinateProblem(lat: unknown, lon: unknown): string | null {
  if (typeof lat !== "number" || typeof lon !== "number" || !Number.isFinite(lat) || !Number.isFinite(lon)) return "coordinates missing";
  if (lat < -90 || lat > 90 || lon < -180 || lon > 180) return "coordinates out of range";
  if (lat === 0 && lon === 0) return "coordinates are 0,0 (placeholder)";
  return null;
}

/** Screen position on the map (MAP_WIDTH × height), or null with the reason. */
export function placeOnMap(lat: unknown, lon: unknown): { x: number; y: number } | { problem: string } {
  const problem = coordinateProblem(lat, lon);
  if (problem) return { problem };
  const p = geo().projection([lon as number, lat as number]);
  if (!p || !Number.isFinite(p[0]) || !Number.isFinite(p[1])) return { problem: "coordinates cannot be projected" };
  return { x: Math.round(p[0] * 10) / 10, y: Math.round(p[1] * 10) / 10 };
}
