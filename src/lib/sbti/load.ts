import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { defaultDataDir } from "../data/load";
import { SbtiFile, type SbtiCompany } from "./schema";

/** The SBTi extract, or null when data/sbti.json does not exist. Read per render (live after imports). */
export function loadSbti(dataDir: string = defaultDataDir()): SbtiFile | null {
  const file = path.join(/*turbopackIgnore: true*/ dataDir, "sbti.json");
  if (!existsSync(file)) return null;
  return SbtiFile.parse(JSON.parse(readFileSync(file, "utf8")));
}

export type SbtiEntry = { kind: "found"; company: SbtiCompany } | { kind: "not_found"; note: string } | { kind: "not_checked" };

export function sbtiFor(sbti: SbtiFile | null, companyId: string): SbtiEntry {
  const c = sbti?.companies[companyId];
  if (!c) return { kind: "not_checked" };
  return "notFound" in c ? { kind: "not_found", note: c.note } : { kind: "found", company: c };
}
