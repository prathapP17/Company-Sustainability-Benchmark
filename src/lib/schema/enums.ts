import { z } from "zod";

/** Rule 2: missing is not zero. Four distinct states, never collapsed. */
export const DisclosureState = z.enum([
  "disclosed", // evidence found in the sources reviewed
  "not_disclosed", // the company explicitly omits it
  "not_found", // researched in full, but absent
  "not_assessed", // not researched enough to conclude
]);
export type DisclosureState = z.infer<typeof DisclosureState>;

/** Rule 3 context fields. "not_stated" is an explicit answer, not a default. */
export const Boundary = z.enum(["consolidated_group", "parent_only", "subsidiary_only", "not_stated"]);
export type Boundary = z.infer<typeof Boundary>;

export const Consolidation = z.enum([
  "operational_control",
  "financial_control",
  "equity_share",
  "not_stated",
]);
export type Consolidation = z.infer<typeof Consolidation>;

export const Scope2Method = z.enum(["market", "location"]);
export type Scope2Method = z.infer<typeof Scope2Method>;

export const AssuranceLevel = z.enum(["none", "limited", "reasonable", "not_stated"]);
export type AssuranceLevel = z.infer<typeof AssuranceLevel>;

export const VerificationClass = z.enum([
  "primary_document",
  "official_webpage",
  "provider_website",
  "secondary_source",
  "search_excerpt",
]);
export type VerificationClass = z.infer<typeof VerificationClass>;

export const ValueStatus = z.enum(["reported", "derived"]);
export type ValueStatus = z.infer<typeof ValueStatus>;

export const ResearchStatus = z.enum(["detailed", "partial", "profile_only"]);
export type ResearchStatus = z.infer<typeof ResearchStatus>;

export const TargetType = z.enum(["absolute", "intensity", "increase_to", "net_zero", "qualitative"]);
export type TargetType = z.infer<typeof TargetType>;

export const TargetValidation = z.enum(["sbti_validated", "self_declared", "not_stated"]);
export type TargetValidation = z.infer<typeof TargetValidation>;

export const Framework = z.enum(["GRI", "ISSB", "TCFD", "ESRS", "SASB", "CDP", "BRSR", "SSBJ", "TNFD"]);
export type Framework = z.infer<typeof Framework>;

export const SourceType = z.enum([
  "sustainability_report",
  "integrated_report",
  "annual_report",
  "esg_data_book",
  "regulatory_filing",
  "webpage",
  "assurance_statement",
  "other",
]);
export type SourceType = z.infer<typeof SourceType>;

/** Fiscal-year labelling (lesson: India FY2025 ends Mar 2025; Japan FY2025 starts Apr 2025). */
export const FiscalLabelConvention = z.enum([
  "end_year", // label = calendar year in which the fiscal year ends (US, India "FY2025" = Apr24–Mar25)
  "start_year", // label = calendar year in which the fiscal year starts (Japan "FY2025" = Apr25–Mar26)
]);
export type FiscalLabelConvention = z.infer<typeof FiscalLabelConvention>;

// Display labels live in a zod-free module so client components can import them cheaply.
export { LABELS } from "../labels";
