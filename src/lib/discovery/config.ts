/**
 * Discovery configuration (data/discovery.json, git-tracked).
 *
 * - seedUrls: official pages where the company lists its reports.
 * - allowedDomains: the company's own domains. Only reports whose final URL
 *   is on one of these (or a subdomain) may be auto-fetched; everything else,
 *   including regulator filings, waits for a reviewer to click Fetch.
 * - sec: SEC EDGAR CIK plus a name check, so a wrong CIK can never attach
 *   another company's filings.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { z } from "zod";
import { defaultDataDir } from "../data/load";

const CompanyDiscovery = z.strictObject({
  seedUrls: z.array(z.url()).min(1),
  allowedDomains: z.array(z.string().regex(/^[a-z0-9.-]+$/)).min(1),
  autoFetch: z.boolean(),
  sec: z.strictObject({ cik: z.string().regex(/^\d{10}$/), nameIncludes: z.string().min(2) }).optional(),
});
export type CompanyDiscovery = z.infer<typeof CompanyDiscovery>;

export const DiscoveryConfig = z.strictObject({
  $schemaVersion: z.literal(1),
  defaults: z.strictObject({
    maxAutoFetchPerRun: z.number().int().min(0).max(20),
    /** Auto-fetch only reports whose year is at least (current year - offset). */
    autoFetchMinYearOffset: z.number().int().min(0).max(10),
    maxPagesPerCompany: z.number().int().min(1).max(50),
    hostIntervalMs: z.number().int().min(250),
  }),
  companies: z.record(z.string(), CompanyDiscovery),
});
export type DiscoveryConfig = z.infer<typeof DiscoveryConfig>;

export function loadDiscoveryConfig(dataDir: string = defaultDataDir()): DiscoveryConfig {
  return DiscoveryConfig.parse(JSON.parse(readFileSync(/*turbopackIgnore: true*/ path.join(dataDir, "discovery.json"), "utf8")));
}

/** True when `host` is one of `domains` or a subdomain of one. */
export function onAllowedDomain(host: string, domains: string[]): boolean {
  const h = host.toLowerCase().replace(/\.$/, "");
  return domains.some((d) => h === d || h.endsWith(`.${d}`));
}
