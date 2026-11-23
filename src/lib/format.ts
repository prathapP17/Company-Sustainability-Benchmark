/** Display helpers. Pure functions, safe on server and client. */

const nf = (max: number) => new Intl.NumberFormat("en-US", { maximumFractionDigits: max });

export function formatNumber(v: number): string {
  const abs = Math.abs(v);
  if (abs !== 0 && abs < 0.001) return v.toExponential(2);
  if (abs < 1) return nf(4).format(v);
  if (abs < 100) return nf(2).format(v);
  return nf(0).format(v);
}

/** Value with its reported unit, e.g. "36,350,070 tCO2e". */
export function formatReported(value: number | null, unit: string | null, text?: string | null): string {
  if (value === null || value === undefined) return text ?? "—";
  return `${formatNumber(value)}${unit ? ` ${unit}` : ""}`;
}

/** Compact canonical display for emissions/energy/water/mass, e.g. "36.4 Mt CO2e". */
export function formatCompact(value: number | null, canonicalUnit: string | null): string {
  if (value === null || value === undefined) return "—";
  const abs = Math.abs(value);
  const scale = (base: string, steps: [number, string][]) => {
    for (const [div, label] of steps) if (abs >= div) return `${nf(abs / div >= 100 ? 0 : 1).format(value / div)} ${label}`;
    return `${nf(1).format(value)} ${base}`;
  };
  switch (canonicalUnit) {
    case "tCO2e":
      return scale("t CO2e", [[1e6, "Mt CO2e"], [1e3, "kt CO2e"]]);
    case "MWh":
      return scale("MWh", [[1e6, "TWh"], [1e3, "GWh"]]);
    case "ML":
      return scale("ML", [[1e3, "GL"]]);
    case "t":
      return scale("t", [[1e6, "Mt"], [1e3, "kt"]]);
    case "%":
      return `${nf(1).format(value)}%`;
    default:
      return `${formatNumber(value)}${canonicalUnit ? ` ${canonicalUnit}` : ""}`;
  }
}

export function titleCase(s: string): string {
  return s.replace(/_/g, " ").replace(/^\w/, (c) => c.toUpperCase());
}
