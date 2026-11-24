import { z } from "zod";
import {
  AssuranceLevel,
  Boundary,
  Consolidation,
  DisclosureState,
  FiscalLabelConvention,
  Framework,
  ResearchStatus,
  Scope2Method,
  SourceType,
  TargetType,
  TargetValidation,
  ValueStatus,
  VerificationClass,
} from "./enums";

const IsoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "expected YYYY-MM-DD");
const Id = z.string().regex(/^[a-z0-9][a-z0-9_-]*$/, "lowercase id");

export const Assurance = z.strictObject({
  level: AssuranceLevel,
  provider: z.string().optional(),
  scope: z.string().optional(),
});
export type Assurance = z.infer<typeof Assurance>;

/** Context fields from rule 3. Every field is optional here because `defaults{}` may supply it. */
const ContextFields = {
  boundary: Boundary.optional(),
  consolidation: Consolidation.optional(),
  scope2Method: Scope2Method.optional(),
  assurance: Assurance.optional(),
  verificationClass: VerificationClass.optional(),
  status: ValueStatus.optional(),
  source: Id.optional(),
};

export const Defaults = z.strictObject({ ...ContextFields });
export type Defaults = z.infer<typeof Defaults>;

export const Source = z.strictObject({
  id: Id,
  organisation: z.string().min(1),
  title: z.string().min(1),
  type: SourceType,
  /** Public URL, or "upload:sha256:<hex>" for a user-uploaded file with no public link. */
  url: z.union([z.url(), z.string().regex(/^upload:sha256:[0-9a-f]{64}$/)]),
  accessed: IsoDate,
  reportingYear: z.number().int().optional(),
  verificationClass: VerificationClass,
  notes: z.string().optional(),
});
export type Source = z.infer<typeof Source>;

export const Report = z.strictObject({
  year: z.number().int(),
  type: SourceType,
  source: Id.optional(),
  assurance: Assurance,
});
export type Report = z.infer<typeof Report>;

/** A value this entry replaced (rule 8: restatements are explicit and keep history). */
export const Restatement = z.strictObject({
  state: DisclosureState,
  value: z.number().optional(),
  text: z.string().optional(),
  unit: z.string().optional(),
  source: Id.optional(),
  page: z.string().optional(),
  replacedOn: IsoDate,
  approver: z.string().min(1),
  reason: z.string().min(1),
});
export type Restatement = z.infer<typeof Restatement>;

export const MetricEntry = z.strictObject({
  metric: z.string().min(1),
  /** Company's own fiscal-year label (see profile.fiscalYear.labelConvention). */
  year: z.number().int().min(1990).max(2100),
  state: DisclosureState,
  value: z.number().optional(),
  text: z.string().optional(),
  unit: z.string().optional(),
  ...ContextFields,
  /**
   * Partial operational coverage inside the boundary (e.g. "Factories only").
   * Shown as a comparability warning; such values are never ranked as if complete.
   */
  coverage: z.string().optional(),
  /** Printed page number, or "PDF p.N", or sheet cell "Sheet!E12", or URL section. */
  page: z.string().optional(),
  /** Short verbatim excerpt of the line the value was read from. */
  reportedWording: z.string().optional(),
  /** Public methodology note; exported. */
  note: z.string().optional(),
  /** Reviewer-only note; never shown publicly and stripped from every export. */
  internalNote: z.string().optional(),
  /**
   * True when this value is not comparable with the prior year (method, factor
   * or scope change). Year-on-year indicators skip it.
   */
  trendBreak: z.boolean().optional(),
  /** Earlier values for the same metric/year/boundary that this entry restated. */
  restatements: z.array(Restatement).optional(),
});
export type MetricEntry = z.infer<typeof MetricEntry>;

const TargetPoint = z.strictObject({
  year: z.number().int(),
  value: z.number().optional(),
  unit: z.string().optional(),
});

export const Target = z.strictObject({
  id: Id,
  category: z.enum(["emissions", "energy", "water", "waste", "materials", "nature", "other"]),
  type: TargetType,
  description: z.string().min(1),
  scopes: z.array(z.enum(["1", "2", "3"])).optional(),
  baseline: TargetPoint.optional(),
  target: TargetPoint,
  latest: TargetPoint.optional(),
  validation: TargetValidation,
  source: Id,
  page: z.string(),
  note: z.string().optional(),
});
export type Target = z.infer<typeof Target>;

const SimpleItem = z.strictObject({
  name: z.string().min(1),
  detail: z.string().optional(),
  source: Id.optional(),
  page: z.string().optional(),
});

export const DataGap = z.strictObject({
  metric: z.string().optional(),
  year: z.number().int().optional(),
  kind: z.enum(["ambiguous", "missing", "blocked_source", "boundary_mismatch", "other"]),
  description: z.string().min(1),
  source: Id.optional(),
  page: z.string().optional(),
});
export type DataGap = z.infer<typeof DataGap>;

export const Profile = z.strictObject({
  id: Id,
  name: z.string().min(1),
  legalName: z.string().min(1),
  listings: z.array(z.strictObject({ exchange: z.string(), ticker: z.string() })).min(1),
  hq: z.strictObject({
    city: z.string(),
    country: z.string(),
    /** Approximate city-centre coordinates, for placement only. */
    lat: z.number().min(-90).max(90),
    lon: z.number().min(-180).max(180),
  }),
  region: z.enum(["Americas", "Europe", "Asia-Pacific", "South Asia", "Middle East & Africa"]),
  industry: z.strictObject({ gics: z.string(), sasb: z.string() }),
  peerGroup: Id,
  fiscalYear: z.strictObject({
    /** Last day of the fiscal year, MM-DD (approximate for 52/53-week years). */
    end: z.string().regex(/^\d{2}-\d{2}$/),
    labelConvention: FiscalLabelConvention,
    note: z.string().optional(),
  }),
  website: z.url(),
  sustainabilityPage: z.url().optional(),
});
export type Profile = z.infer<typeof Profile>;

export const CompanyFile = z.strictObject({
  $schemaVersion: z.literal(1),
  profile: Profile,
  researchStatus: ResearchStatus,
  researchNotes: z.string().optional(),
  lastReviewed: IsoDate,
  defaults: Defaults.default({}),
  sources: z.array(Source),
  reports: z.array(Report).default([]),
  metrics: z.array(MetricEntry).default([]),
  targets: z.array(Target).default([]),
  frameworks: z.array(z.strictObject({ name: Framework, detail: z.string().optional(), source: Id.optional(), page: z.string().optional() })).default([]),
  ratings: z.array(SimpleItem).default([]),
  indices: z.array(SimpleItem).default([]),
  initiatives: z.array(SimpleItem).default([]),
  narratives: z.array(SimpleItem).default([]),
  dataGaps: z.array(DataGap).default([]),
  comparabilityNotes: z.array(z.string()).default([]),
});
export type CompanyFile = z.infer<typeof CompanyFile>;
export type CompanyFileInput = z.input<typeof CompanyFile>;

export const PeerGroup = z.strictObject({
  id: Id,
  name: z.string(),
  description: z.string(),
  sasbIndustries: z.array(z.string()),
});
export type PeerGroup = z.infer<typeof PeerGroup>;
