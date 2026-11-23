import "server-only";
import ExcelJS from "exceljs";
import { allIndicators, allScores, allSources, allTargets, allTransparencyItems, listCompanies, totals } from "../db/queries";
import { VALUE_COLUMNS, valueRows } from "./rows";

function sheet(wb: ExcelJS.Workbook, name: string, columns: string[], rows: Record<string, unknown>[]) {
  const ws = wb.addWorksheet(name, { views: [{ state: "frozen", ySplit: 1 }] });
  ws.columns = columns.map((c) => ({ header: c, key: c, width: Math.min(Math.max(c.length + 2, 12), 48) }));
  ws.getRow(1).font = { bold: true };
  for (const r of rows) ws.addRow(r);
  ws.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: columns.length } };
  return ws;
}

export async function benchmarkWorkbook(): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  wb.creator = "Corporate Sustainability Intelligence";
  const t = totals();

  const readme = wb.addWorksheet("Read me");
  readme.columns = [{ width: 110 }];
  [
    "Corporate Sustainability Intelligence: benchmark export",
    `Generated from the database seeded ${t.lastSeed ?? "unknown"}. ${t.companies} companies, ${t.disclosed} disclosed values.`,
    "",
    "Every value carries its source, page, boundary, consolidation approach, Scope 2 method, coverage, assurance and verification class.",
    "States: disclosed / not_disclosed (company explicitly omits) / not_found (researched, absent) / not_assessed. Missing is not zero.",
    "Never add or compare values on different boundaries, Scope 2 methods or partial coverage. trend_break = not comparable with prior year.",
    "status 'derived' = simple arithmetic on reported values; the method is in the note column.",
    "Scores: see the Scores, Checklist and Indicators sheets and the methodology page.",
  ].forEach((line, i) => {
    readme.addRow([line]);
    if (i === 0) readme.getRow(1).font = { bold: true, size: 14 };
  });

  sheet(wb, "Values", [...VALUE_COLUMNS], valueRows());

  sheet(
    wb,
    "Companies",
    ["id", "name", "legal_name", "peer_group", "region", "country", "city", "gics", "sasb", "fiscal_year_end", "fy_label_convention", "research_status", "last_reviewed", "website"],
    listCompanies().map((c) => ({
      id: c.id, name: c.name, legal_name: c.legal_name, peer_group: c.peer_group_name, region: c.region, country: c.country,
      city: c.city, gics: c.gics, sasb: c.sasb, fiscal_year_end: c.fy_end, fy_label_convention: c.fy_label_convention,
      research_status: c.research_status, last_reviewed: c.last_reviewed, website: c.website,
    })),
  );

  sheet(
    wb,
    "Sources",
    ["company_id", "id", "organisation", "title", "type", "url", "accessed", "reporting_year", "verification_class", "notes"],
    allSources() as unknown as Record<string, unknown>[],
  );

  sheet(
    wb,
    "Targets",
    ["company", "id", "category", "type", "description", "baseline_year", "baseline_value", "baseline_unit", "target_year", "target_value", "target_unit", "latest_year", "latest_value", "latest_unit", "validation", "source_id", "page", "note"],
    allTargets().map((x) => ({ ...x, company: x.company_name })),
  );

  const names = new Map(listCompanies().map((c) => [c.id, c.name]));
  sheet(
    wb,
    "Scores",
    ["company", "transparency_score", "transparency_met", "transparency_applicable", "transparency_reason", "performance_score", "performance_available", "performance_reason"],
    allScores().map((s) => ({ ...s, company: names.get(s.company_id) })),
  );
  sheet(
    wb,
    "Checklist",
    ["company", "item_group", "item_id", "label", "met", "evidence"],
    allTransparencyItems().map((i) => ({ ...i, company: names.get(i.company_id), met: i.met === null ? "not assessable" : i.met ? "yes" : "no" })),
  );
  sheet(
    wb,
    "Indicators",
    ["company", "indicator_id", "label", "raw_value", "raw_unit", "score", "detail"],
    allIndicators().map((i) => ({ ...i, company: names.get(i.company_id) })),
  );

  return Buffer.from(await wb.xlsx.writeBuffer());
}
