/**
 * Extracts the benchmark companies' rows from the downloaded SBTi Target
 * Dashboard files (data/external/sbti/, git-ignored) into data/sbti.json.
 *
 *   npm run sbti:import
 *
 * Downloading new files is a separate, deliberate step (ask first): fetch
 * companies-excel.xlsx and targets-excel.xlsx from the target dashboard page
 * into data/external/sbti/, then run this. Each company is pinned to one SBTi
 * record in data/sbti-matches.json; a name or ISIN/LEI mismatch stops the import.
 */
import ExcelJS from "exceljs";
import { createHash } from "node:crypto";
import { readFileSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
import { defaultDataDir } from "../src/lib/data/load";
import { SbtiFile, type SbtiCompany, type SbtiTarget } from "../src/lib/sbti/schema";

const BASE = "https://files.sciencebasedtargets.org/production/files";
type Match = { sbtiId: string; name: string; isin?: string; lei?: string } | null;

const cellText = (v: unknown): string | null => {
  if (v === null || v === undefined) return null;
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  if (typeof v === "object" && "richText" in (v as object)) return (v as { richText: { text: string }[] }).richText.map((r) => r.text).join("");
  if (typeof v === "object" && "text" in (v as object)) return String((v as { text: unknown }).text);
  const s = String(v).trim();
  return s === "" || s === "NA" ? null : s;
};
const int = (s: string | null) => (s && /^\d{4}$/.test(s.replace(/^FY/, "")) ? Number(s.replace(/^FY/, "")) : null);

async function sheetRows(file: string): Promise<Record<string, string | null>[]> {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(file);
  const ws = wb.worksheets[0];
  const header = (ws.getRow(1).values as unknown[]).slice(1).map((h) => String(h));
  const out: Record<string, string | null>[] = [];
  ws.eachRow((row, i) => {
    if (i === 1) return;
    const vals = (row.values as unknown[]).slice(1);
    out.push(Object.fromEntries(header.map((h, k) => [h, cellText(vals[k])])));
  });
  return out;
}

async function main() {
  const dataDir = defaultDataDir();
  const dir = path.join(dataDir, "external", "sbti");
  const matches = JSON.parse(readFileSync(path.join(dataDir, "sbti-matches.json"), "utf8")) as Record<string, Match | string>;
  const files = ["companies-excel.xlsx", "targets-excel.xlsx"].map((name) => {
    const p = path.join(dir, name);
    const buf = readFileSync(p);
    return { name, url: `${BASE}/${name}`, bytes: buf.length, sha256: createHash("sha256").update(buf).digest("hex") };
  });
  const companies = await sheetRows(path.join(dir, files[0].name));
  const targets = await sheetRows(path.join(dir, files[1].name));
  const latestUpdate = companies.map((c) => c.date_updated).filter(Boolean).sort().pop() ?? null;

  const out: SbtiFile["companies"] = {};
  for (const [id, m] of Object.entries(matches)) {
    if (id.startsWith("$")) continue;
    const match = m as Match;
    if (!match) {
      out[id] = { notFound: true, note: `Not in the SBTi Target Dashboard (latest record update ${latestUpdate}); searched by company name.` };
      continue;
    }
    const row = companies.find((c) => c.sbti_id === match.sbtiId);
    if (!row) throw new Error(`${id}: SBTi id ${match.sbtiId} not in the companies file`);
    if (row.company_name !== match.name) throw new Error(`${id}: SBTi id ${match.sbtiId} is now "${row.company_name}", expected "${match.name}"`);
    if (match.isin && row.isin !== match.isin) throw new Error(`${id}: ISIN ${row.isin} differs from pinned ${match.isin}`);
    if (match.lei && row.lei !== match.lei) throw new Error(`${id}: LEI ${row.lei} differs from pinned ${match.lei}`);
    const t: SbtiTarget[] = targets
      .filter((r) => r.sbti_id === match.sbtiId && r.action === "Target")
      .map((r) => ({
        rowId: r.row_entry_id ?? "",
        horizon: r.target ?? "unknown",
        scope: r.scope,
        value: r.target_value,
        type: r.type,
        subType: r.sub_type,
        classification: r.target_classification_short,
        baseYear: int(r.base_year),
        targetYear: int(r.target_year),
        yearType: r.year_type,
        status: r.status,
        wording: r.target_wording ? r.target_wording.slice(0, 600) : null,
        published: r.date_published,
      }))
      .sort((a, b) => a.horizon.localeCompare(b.horizon) || (a.targetYear ?? 0) - (b.targetYear ?? 0));
    const c: SbtiCompany = {
      sbtiId: match.sbtiId,
      name: row.company_name!,
      nearTerm: { status: row.near_term_status, classification: row.near_term_target_classification, year: row.near_term_target_year },
      longTerm: { status: row.long_term_status, classification: row.long_term_target_classification, year: row.long_term_target_year },
      netZero: { status: row.net_zero_status, year: row.net_zero_year },
      ba15: row.ba15_status,
      statusReason: row.status_reason,
      dateUpdated: row.date_updated,
      targets: t,
    };
    out[id] = c;
  }
  const file = SbtiFile.parse({
    $schemaVersion: 1,
    source: {
      organisation: "Science Based Targets initiative (SBTi)",
      title: "SBTi Target Dashboard: companies and targets downloads",
      url: "https://sciencebasedtargets.org/target-dashboard",
      downloaded: statSync(path.join(dir, files[0].name)).mtime.toISOString().slice(0, 10),
      dataAsOf: latestUpdate,
      files,
    },
    companies: out,
  });
  writeFileSync(path.join(dataDir, "sbti.json"), `${JSON.stringify(file, null, 2)}\n`);
  for (const [id, c] of Object.entries(file.companies)) {
    console.log("notFound" in c ? `${id.padEnd(10)} not in dashboard` : `${id.padEnd(10)} near-term ${c.nearTerm.status ?? "-"} (${c.nearTerm.classification ?? "-"}) · net-zero ${c.netZero.status ?? "-"} · ${c.targets.length} target rows`);
  }
}

main().catch((e) => {
  console.error(e.message ?? e);
  process.exit(1);
});
