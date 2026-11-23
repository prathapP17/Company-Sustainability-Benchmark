/**
 * Loads and validates the curated company files in data/companies/*.json.
 * Used by the validation CLI, the seeder and tests. Never writes.
 */
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { PeerGroup, type CompanyFile } from "../schema/company";
import { validateCompany, type Issue } from "../schema/validate";
import { z } from "zod";
import { findDuplicateKeys } from "./json-dupes";

export interface LoadResult {
  companies: CompanyFile[];
  peerGroups: PeerGroup[];
  issues: Issue[];
}

export function defaultDataDir(): string {
  return process.env.CSI_DATA_DIR ?? path.join(process.cwd(), "data");
}

export function loadPeerGroups(dataDir: string): PeerGroup[] {
  const raw = JSON.parse(readFileSync(path.join(dataDir, "peer-groups.json"), "utf8"));
  return z.array(PeerGroup).parse(raw);
}

export function loadCompanies(dataDir: string = defaultDataDir()): LoadResult {
  const peerGroups = loadPeerGroups(dataDir);
  const dir = path.join(dataDir, "companies");
  const files = readdirSync(dir)
    .filter((f) => f.endsWith(".json"))
    .sort();
  const companies: CompanyFile[] = [];
  const issues: Issue[] = [];
  for (const f of files) {
    const rel = `data/companies/${f}`;
    let raw: unknown;
    try {
      const text = readFileSync(path.join(dir, f), "utf8");
      for (const d of findDuplicateKeys(text)) {
        issues.push({ file: rel, path: d, message: "duplicate key (JSON keeps only the last one)", level: "error" });
      }
      raw = JSON.parse(text);
    } catch (e) {
      issues.push({ file: rel, path: "", message: `invalid JSON: ${(e as Error).message}`, level: "error" });
      continue;
    }
    const res = validateCompany(rel, raw, peerGroups);
    issues.push(...res.issues);
    if (res.company) companies.push(res.company);
  }
  return { companies, peerGroups, issues };
}
