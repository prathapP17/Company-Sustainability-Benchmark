/**
 * Metric dictionary v1.
 *
 * - Cross-industry metrics apply to every company.
 * - Industry metrics follow SASB/ISSB industry standards and apply to the
 *   peer groups listed in `appliesTo`.
 * - `units` lists every accepted reported unit with an exact factor to the
 *   canonical unit. Conversion is pure unit scaling (e.g. MWh → GWh); it is
 *   never used to combine values on different boundaries or methods (rule 4).
 * - `synonyms` feed the phase-3 extractor (English, Japanese, Korean, German).
 */
export type MetricCategory = "emissions" | "energy" | "water" | "waste" | "materials" | "industry";

export interface MetricDef {
  id: string;
  label: string;
  category: MetricCategory;
  canonicalUnit: string;
  /** Accepted reported units → multiply by factor to get canonical unit. */
  units: Record<string, number>;
  /** "all" or a list of peer-group ids. */
  appliesTo: "all" | string[];
  /** Scope 2 values must state market or location method. */
  requiresScope2Method?: boolean;
  sasb?: string;
  /** Part of the transparency checklist core set. */
  core: boolean;
  synonyms: string[];
  description: string;
}

const T = { tCO2e: 1, ktCO2e: 1_000, MtCO2e: 1_000_000 };
const ENERGY = { MWh: 1, GWh: 1_000, TWh: 1_000_000, GJ: 1 / 3.6, TJ: 1_000 / 3.6 };
const WATER = {
  ML: 1,
  m3: 0.001,
  "thousand m3": 1,
  "million m3": 1_000,
  kL: 0.001,
  // 1 US gallon = 3.785411784 L (exact)
  "million gallons": 3.785411784,
  // Korean/Japanese reports state water in tonnes; reporting convention 1 t = 1 m3.
  "thousand tonnes": 1,
};
// 1 lb = 0.45359237 kg (exact)
const MASS = { t: 1, kt: 1_000, Mt: 1_000_000, lb: 0.00045359237 };
const PCT = { "%": 1 };

export const SCOPE3_NAMES: Record<number, string> = {
  1: "Purchased goods and services",
  2: "Capital goods",
  3: "Fuel- and energy-related activities",
  4: "Upstream transportation and distribution",
  5: "Waste generated in operations",
  6: "Business travel",
  7: "Employee commuting",
  8: "Upstream leased assets",
  9: "Downstream transportation and distribution",
  10: "Processing of sold products",
  11: "Use of sold products",
  12: "End-of-life treatment of sold products",
  13: "Downstream leased assets",
  14: "Franchises",
  15: "Investments",
};

const scope3Categories: MetricDef[] = Object.entries(SCOPE3_NAMES).map(([n, name]) => ({
  id: `ghg_scope3_c${n}`,
  label: `Scope 3 cat. ${n}: ${name}`,
  category: "emissions",
  canonicalUnit: "tCO2e",
  units: T,
  appliesTo: "all",
  core: false,
  synonyms: [`Category ${n}`, `Cat. ${n}`, `C${n}`, name, `カテゴリ${n}`, `카테고리 ${n}`],
  description: `GHG Protocol Scope 3 category ${n}: ${name}.`,
}));

export const METRICS: MetricDef[] = [
  {
    id: "ghg_scope1",
    label: "Scope 1 GHG emissions",
    category: "emissions",
    canonicalUnit: "tCO2e",
    units: T,
    appliesTo: "all",
    core: true,
    sasb: "TC-SC-110a.1 / EM-RM-110a.1 / RT-IG (via GRI 305-1)",
    synonyms: ["Scope 1", "direct emissions", "直接排出", "スコープ1", "직접 배출", "Scope-1-Emissionen"],
    description: "Gross direct GHG emissions from owned or controlled sources.",
  },
  {
    id: "ghg_scope2_market",
    label: "Scope 2 GHG emissions (market-based)",
    category: "emissions",
    canonicalUnit: "tCO2e",
    units: T,
    appliesTo: "all",
    requiresScope2Method: true,
    core: true,
    synonyms: ["Scope 2 market-based", "market-based", "マーケット基準", "시장 기반"],
    description: "Indirect emissions from purchased energy, market-based method.",
  },
  {
    id: "ghg_scope2_location",
    label: "Scope 2 GHG emissions (location-based)",
    category: "emissions",
    canonicalUnit: "tCO2e",
    units: T,
    appliesTo: "all",
    requiresScope2Method: true,
    core: true,
    synonyms: ["Scope 2 location-based", "location-based", "ロケーション基準", "지역 기반"],
    description: "Indirect emissions from purchased energy, location-based method.",
  },
  {
    id: "ghg_scope3_total",
    label: "Scope 3 GHG emissions (total)",
    category: "emissions",
    canonicalUnit: "tCO2e",
    units: T,
    appliesTo: "all",
    core: true,
    synonyms: ["Scope 3", "value chain emissions", "スコープ3", "기타 간접 배출"],
    description: "Total reported Scope 3 emissions. Category coverage differs by company; see notes.",
  },
  ...scope3Categories,
  {
    id: "energy_total",
    label: "Total energy consumption",
    category: "energy",
    canonicalUnit: "MWh",
    units: ENERGY,
    appliesTo: "all",
    core: true,
    synonyms: ["total energy consumption", "energy consumed", "エネルギー使用量", "에너지 사용량"],
    description: "Total energy consumed within the organisation (fuel + purchased energy).",
  },
  {
    id: "renewable_electricity_share",
    label: "Renewable electricity share",
    category: "energy",
    canonicalUnit: "%",
    units: PCT,
    appliesTo: "all",
    core: true,
    synonyms: ["renewable electricity", "renewable energy", "再生可能エネルギー", "재생에너지"],
    description: "Share of electricity consumption from renewable sources, as defined by the company.",
  },
  {
    id: "water_withdrawal",
    label: "Water withdrawal",
    category: "water",
    canonicalUnit: "ML",
    units: WATER,
    appliesTo: "all",
    core: true,
    synonyms: ["water withdrawal", "water intake", "取水量", "취수량", "Wasserentnahme"],
    description: "Total water withdrawn from all sources.",
  },
  {
    id: "water_consumption",
    label: "Water consumption",
    category: "water",
    canonicalUnit: "ML",
    units: WATER,
    appliesTo: "all",
    core: false,
    synonyms: ["water consumption", "water consumed", "水消費量", "용수 사용량"],
    description: "Water withdrawn and not returned (GRI 303-5).",
  },
  {
    id: "waste_total",
    label: "Total waste generated",
    category: "waste",
    canonicalUnit: "t",
    units: MASS,
    appliesTo: "all",
    core: true,
    synonyms: ["total waste", "waste generated", "廃棄物発生量", "폐기물 발생량"],
    description: "Total waste generated in operations.",
  },
  {
    id: "waste_diversion_rate",
    label: "Waste diverted from disposal",
    category: "waste",
    canonicalUnit: "%",
    units: PCT,
    appliesTo: "all",
    core: false,
    synonyms: ["diversion rate", "recycling rate", "リサイクル率", "재활용률"],
    description: "Share of operational waste diverted from landfill/incineration without energy recovery.",
  },

  // ---- Industry metrics (SASB) ----
  {
    id: "hw_recycled_material_share",
    label: "Recycled or renewable content in products",
    category: "industry",
    canonicalUnit: "%",
    units: PCT,
    appliesTo: ["tech_hardware_semis"],
    core: false,
    sasb: "TC-HW-410a (product lifecycle management)",
    synonyms: ["recycled content", "recycled or renewable", "再生材"],
    description: "Share of materials in shipped products from recycled or renewable sources.",
  },
  {
    id: "hw_ewaste_collected",
    label: "End-of-life products / e-waste collected",
    category: "industry",
    canonicalUnit: "t",
    units: MASS,
    appliesTo: ["tech_hardware_semis"],
    core: false,
    sasb: "TC-HW-410a.4",
    synonyms: ["e-waste collected", "take-back", "collected for recycling", "폐전자제품 회수"],
    description: "Weight of end-of-life products and e-waste recovered.",
  },
  {
    id: "sc_pfc_emissions",
    label: "Perfluorinated compound (PFC) emissions",
    category: "industry",
    canonicalUnit: "tCO2e",
    units: T,
    appliesTo: ["tech_hardware_semis"],
    core: false,
    sasb: "TC-SC-110a.1",
    synonyms: ["perfluorinated compounds", "PFC", "F-gas", "process gas"],
    description: "Scope 1 emissions from perfluorinated compounds (semiconductor fabs).",
  },
  {
    id: "sw_datacenter_pue",
    label: "Data centre PUE",
    category: "industry",
    canonicalUnit: "ratio",
    units: { ratio: 1 },
    appliesTo: ["software_it"],
    core: false,
    sasb: "TC-SI-130a.3",
    synonyms: ["PUE", "power usage effectiveness"],
    description: "Power usage effectiveness of owned data centres, as reported.",
  },
  {
    id: "au_bev_sales",
    label: "Battery-electric vehicle sales",
    category: "industry",
    canonicalUnit: "units",
    units: { units: 1, "thousand units": 1_000 },
    appliesTo: ["autos_industrials"],
    core: false,
    sasb: "TR-AU-410a.2",
    synonyms: ["BEV", "battery electric vehicles", "電気自動車"],
    description: "Number of battery-electric vehicles sold.",
  },
  {
    id: "au_electrified_sales",
    label: "Electrified vehicle sales (all powertrains)",
    category: "industry",
    canonicalUnit: "units",
    units: { units: 1, "thousand units": 1_000 },
    appliesTo: ["autos_industrials"],
    core: false,
    sasb: "TR-AU-410a.2",
    synonyms: ["electrified vehicles", "HEV PHEV BEV FCEV", "電動車"],
    description: "HEV + PHEV + BEV + FCEV units sold, as defined by the company.",
  },
  {
    id: "fb_deforestation_free_share",
    label: "Deforestation-free primary supply chains",
    category: "industry",
    canonicalUnit: "%",
    units: PCT,
    appliesTo: ["consumer_staples"],
    core: false,
    sasb: "FB-PF-430a / CG-HP-430a.1",
    synonyms: ["deforestation-free", "DCF", "deforestation and conversion-free"],
    description: "Share of primary supply chain volumes assessed deforestation(-and-conversion)-free.",
  },
  {
    id: "fb_virgin_plastic_packaging",
    label: "Virgin plastic packaging",
    category: "industry",
    canonicalUnit: "t",
    units: MASS,
    appliesTo: ["consumer_staples"],
    core: false,
    sasb: "FB-PF-410a.1 / CG-HP-410a.1",
    synonyms: ["virgin plastic", "virgin plastics packaging"],
    description: "Weight of virgin plastic used in packaging.",
  },
  {
    id: "fb_recyclable_packaging_share",
    label: "Plastic packaging designed for recycling",
    category: "industry",
    canonicalUnit: "%",
    units: PCT,
    appliesTo: ["consumer_staples"],
    core: false,
    sasb: "FB-PF-410a.1 / CG-HP-410a.1",
    synonyms: ["recyclable", "designed for recycling", "reusable, recyclable or compostable"],
    description: "Share of plastic packaging designed to be recyclable/reusable/compostable, per company definition.",
  },
  {
    id: "og_ghg_intensity_revenue_ppp",
    label: "GHG intensity per revenue (PPP-adjusted)",
    category: "industry",
    canonicalUnit: "tCO2e / USD mn PPP",
    // BRSR reports tCO2e per rupee of turnover divided by the IMF PPP rate, i.e. per PPP dollar.
    units: { "tCO2e / USD mn PPP": 1, "tCO2e / USD PPP": 1_000_000 },
    appliesTo: ["energy_conglomerates"],
    core: false,
    sasb: "EM-RM-110a (BRSR Core 1)",
    synonyms: ["intensity per rupee of turnover adjusted for PPP", "emission intensity"],
    description:
      "Scope 1+2 per USD million of turnover adjusted for purchasing power parity, as defined in India's BRSR Core.",
  },
];

export const METRIC_BY_ID = new Map(METRICS.map((m) => [m.id, m]));

export function getMetric(id: string): MetricDef {
  const m = METRIC_BY_ID.get(id);
  if (!m) throw new Error(`Unknown metric id: ${id}`);
  return m;
}

export function metricAppliesTo(m: MetricDef, peerGroup: string): boolean {
  return m.appliesTo === "all" || m.appliesTo.includes(peerGroup);
}

/** Exact unit scaling to the canonical unit. Returns null if the unit is not accepted. */
export function toCanonical(metricId: string, value: number, unit: string): number | null {
  const m = getMetric(metricId);
  const f = m.units[unit];
  return f === undefined ? null : value * f;
}
