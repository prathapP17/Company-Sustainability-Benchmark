import type { AssuranceLevel, Boundary, Consolidation, DisclosureState, VerificationClass } from "./schema/enums";

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
