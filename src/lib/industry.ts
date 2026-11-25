/**
 * Industry classification used for ANALYSIS (peer medians, industry metrics,
 * peer ranks). Broad peer groups (data/peer-groups.json) are for navigation
 * only: they can hold several real industries (Toyota and Siemens share
 * "Autos & industrials" but are not industry peers).
 *
 * The analytical key is the company's SASB (SICS) industry code. A company
 * whose files list more than one SASB industry and no confirmed primary one is
 * flagged for review and kept out of industry medians and peer ranks; it is
 * still shown, individually, beside each industry it lists.
 *
 * Zod-free so client components can import it.
 */

export interface SasbIndustry {
  code: string;
  name: string;
  sector: string;
}

/** SASB industries used by the companies in the dataset (code → name). Extend when a company needs a new one. */
export const SASB_INDUSTRIES: Record<string, SasbIndustry> = Object.fromEntries(
  (
    [
      ["TC-HW", "Hardware", "Technology & Communications"],
      ["TC-SC", "Semiconductors", "Technology & Communications"],
      ["TC-SI", "Software & IT Services", "Technology & Communications"],
      ["TR-AU", "Automobiles", "Transportation"],
      ["RT-IG", "Industrial Machinery & Goods", "Resource Transformation"],
      ["RT-EE", "Electrical & Electronic Equipment", "Resource Transformation"],
      ["RT-CH", "Chemicals", "Resource Transformation"],
      ["FB-PF", "Processed Foods", "Food & Beverage"],
      ["CG-HP", "Household & Personal Products", "Consumer Goods"],
      ["EM-RM", "Oil & Gas – Refining & Marketing", "Extractives & Minerals Processing"],
    ] as const
  ).map(([code, name, sector]) => [code, { code, name, sector }]),
);

export const SASB_CODE_RE = /\b[A-Z]{2}-[A-Z]{2}\b/g;

export interface IndustryInput {
  sasb: string;
  sasbCodes?: string[];
  primarySasb?: string;
  classificationNote?: string;
}

export interface IndustryClass {
  /** Every SASB industry the company's files list. Industry metrics of any of them apply. */
  codes: string[];
  /** The one industry used for peer medians and ranks; null when not confirmed. */
  primary: string | null;
  /** True when the classification must be checked by a person before it is used analytically. */
  needsReview: boolean;
  reason: string | null;
}

export function classify(industry: IndustryInput): IndustryClass {
  const recorded = industry.sasbCodes && industry.sasbCodes.length > 0;
  const codes = recorded ? [...industry.sasbCodes!] : [...new Set(industry.sasb.match(SASB_CODE_RE) ?? [])];
  const primary = industry.primarySasb ?? (codes.length === 1 ? codes[0] : null);
  let reason: string | null = null;
  if (!recorded) reason = "SASB codes not recorded in the company file (read from the industry text)";
  else if (codes.length === 0) reason = "no SASB industry recorded";
  else if (!primary) reason = industry.classificationNote ?? `lists ${codes.length} SASB industries and no confirmed primary one`;
  return { codes, primary, needsReview: reason !== null, reason };
}

export function industryName(code: string | null): string {
  if (!code) return "Unclassified";
  const s = SASB_INDUSTRIES[code];
  return s ? `${s.name} (${code})` : code;
}
