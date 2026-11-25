/**
 * SBTi Target Dashboard extract (data/sbti.json): the dashboard rows for the
 * benchmark's companies, cited to the downloaded files (URL, date, checksum).
 * Reference data from SBTi, not company disclosures: shown beside the
 * companies' own target statements, never merged into them.
 */
import { z } from "zod";

const Str = z.string().nullable();

export const SbtiTarget = z.strictObject({
  rowId: z.string(),
  horizon: z.string(), // Near-term | Long-term | Net-zero
  scope: Str,
  value: Str, // as printed, e.g. "62%"
  type: Str, // Absolute | Intensity | Renewable electricity | …
  subType: Str,
  classification: Str, // 1.5°C | Well-below 2°C | …
  baseYear: z.number().int().nullable(),
  targetYear: z.number().int().nullable(),
  yearType: Str,
  status: Str,
  wording: Str,
  published: Str,
});

export const SbtiCompany = z.strictObject({
  sbtiId: z.string(),
  name: z.string(),
  nearTerm: z.strictObject({ status: Str, classification: Str, year: Str }),
  longTerm: z.strictObject({ status: Str, classification: Str, year: Str }),
  netZero: z.strictObject({ status: Str, year: Str }),
  ba15: Str,
  statusReason: Str,
  dateUpdated: Str,
  targets: z.array(SbtiTarget),
});

export const SbtiFile = z.strictObject({
  $schemaVersion: z.literal(1),
  source: z.strictObject({
    organisation: z.string(),
    title: z.string(),
    url: z.url(),
    downloaded: z.string(),
    /** Newest "date_updated" among all dashboard records: the data's as-of date. */
    dataAsOf: z.string().nullable(),
    files: z.array(z.strictObject({ name: z.string(), url: z.url(), bytes: z.number().int(), sha256: z.string().length(64) })),
  }),
  companies: z.record(z.string(), z.union([SbtiCompany, z.strictObject({ notFound: z.literal(true), note: z.string() })])),
});
export type SbtiFile = z.infer<typeof SbtiFile>;
export type SbtiCompany = z.infer<typeof SbtiCompany>;
export type SbtiTarget = z.infer<typeof SbtiTarget>;
