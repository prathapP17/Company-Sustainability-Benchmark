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

export const LABELS = {
  state: {
    disclosed: "Disclosed",
    not_disclosed: "Not disclosed",
    not_found: "Not found",
    not_assessed: "Not assessed",
  } satisfies Record<DisclosureState, string>,
  boundary: {
    consolidated_group: "Consolidated group",
    parent_only: "Parent only",
    subsidiary_only: "Subsidiary only",
    not_stated: "Not stated",
  } satisfies Record<Boundary, string>,
  consolidation: {
    operational_control: "Operational control",
    financial_control: "Financial control",
    equity_share: "Equity share",
    not_stated: "Not stated",
  } satisfies Record<Consolidation, string>,
  verification: {
    primary_document: "Primary document",
    official_webpage: "Official webpage",
    provider_website: "Provider website",
    secondary_source: "Secondary source",
    search_excerpt: "Search excerpt",
  } satisfies Record<VerificationClass, string>,
  assurance: {
    none: "None",
    limited: "Limited",
    reasonable: "Reasonable",
    not_stated: "Not stated",
  } satisfies Record<AssuranceLevel, string>,
};
