import { cpSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import type { CompanyFileInput } from "@/lib/schema/company";

export const REAL_DATA = path.resolve(import.meta.dirname, "..", "data");

/** Rule 9: tests use a temporary data directory, never the real database. */
export function tempDataDir(withCompanies = true): { dir: string; cleanup: () => void } {
  const dir = mkdtempSync(path.join(tmpdir(), "csi-test-"));
  cpSync(path.join(REAL_DATA, "peer-groups.json"), path.join(dir, "peer-groups.json"));
  cpSync(path.join(REAL_DATA, "discovery.json"), path.join(dir, "discovery.json"));
  if (withCompanies) cpSync(path.join(REAL_DATA, "companies"), path.join(dir, "companies"), { recursive: true });
  return { dir, cleanup: () => rmSync(dir, { recursive: true, force: true }) };
}

export function writeCompany(dir: string, c: CompanyFileInput) {
  writeFileSync(path.join(dir, "companies", `${c.profile.id}.json`), JSON.stringify(c, null, 2));
}

/** A minimal valid company file, used as a base for rule tests. */
export function baseCompany(overrides: Partial<CompanyFileInput> = {}): CompanyFileInput {
  return {
    $schemaVersion: 1,
    profile: {
      id: "testco",
      name: "TestCo",
      legalName: "TestCo Ltd",
      listings: [{ exchange: "TEST", ticker: "TST" }],
      hq: { city: "Testville", country: "Nowhere", lat: 0, lon: 0 },
      region: "Europe",
      industry: { gics: "Test", sasb: "Processed Foods (FB-PF)", sasbCodes: ["FB-PF"] },
      peerGroup: "consumer_staples",
      fiscalYear: { end: "12-31", labelConvention: "end_year" },
      website: "https://example.com",
    },
    researchStatus: "partial",
    lastReviewed: "2026-11-23",
    defaults: { source: "src1", boundary: "consolidated_group", consolidation: "operational_control" },
    sources: [
      {
        id: "src1",
        organisation: "TestCo",
        title: "Report",
        type: "sustainability_report",
        url: "https://example.com/report.pdf",
        accessed: "2026-11-23",
        verificationClass: "primary_document",
      },
    ],
    metrics: [],
    ...overrides,
  };
}
