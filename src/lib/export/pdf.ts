/**
 * PDF management reports (pdfkit, standard Helvetica). Carries provenance for
 * every value; internal notes are never read here.
 */
import "server-only";
import PDFDocument from "pdfkit";
import {
  allScores,
  dataGapsFor,
  getCompany,
  latestValues,
  listCompanies,
  metricValuesFor,
  scoreFor,
  sourcesFor,
  targetsFor,
  totals,
  type MetricValueRow,
} from "../db/queries";
import { METRICS, metricAppliesTo } from "../metrics/dictionary";
import { fiscalLabel } from "../fiscal";
import { formatCompact, formatReported, titleCase } from "../format";
import { LABELS } from "../labels";
import { progressFromRow } from "../scoring/targets";
import type { AssuranceLevel, Boundary, Consolidation } from "../schema/enums";

type Doc = PDFKit.PDFDocument;

const INK = "#0b0b0b";
const MUTED = "#6f6d68";
const RULE = "#e1e0d9";
const MARGIN = 48;

/** Standard PDF fonts only cover WinAnsi; map common symbols and drop the rest. */
const WINANSI_EXTRA = new Set("€‚ƒ„…†‡ˆ‰Š‹ŒŽ‘’“”•–—˜™š›œžŸ");
export function pdfText(s: string): string {
  return s
    .replace(/[₀-₉]/g, (d) => String(d.charCodeAt(0) - 0x2080))
    .replace(/≥/g, ">=")
    .replace(/≤/g, "<=")
    .replace(/→/g, "->")
    .replace(/−/g, "-")
    .replace(/⚠/g, "!")
    .replace(/◆/g, "*")
    .replace(/[^\x00-\xff]/g, (ch) => (WINANSI_EXTRA.has(ch) ? ch : "?"));
}

function newDoc(title: string): Doc {
  return new PDFDocument({ size: "A4", margin: MARGIN, info: { Title: title, Author: "Corporate Sustainability Intelligence" }, bufferPages: true });
}

function finish(doc: Doc): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    doc.on("data", (c: Buffer) => chunks.push(c));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);
    // Footer with page numbers on every page.
    const range = doc.bufferedPageRange();
    for (let i = range.start; i < range.start + range.count; i++) {
      doc.switchToPage(i);
      const y = doc.page.height - MARGIN + 16;
      doc.fontSize(7).fillColor(MUTED).text(
        pdfText(`Corporate Sustainability Intelligence · every value cites a source and page · page ${i + 1} of ${range.count}`),
        MARGIN,
        y,
        { width: doc.page.width - 2 * MARGIN, align: "center", lineBreak: false },
      );
    }
    doc.end();
  });
}

function heading(doc: Doc, text: string, size = 13) {
  if (doc.y > doc.page.height - MARGIN - 80) doc.addPage();
  doc.moveDown(0.6).fontSize(size).font("Helvetica-Bold").fillColor(INK).text(pdfText(text), MARGIN);
  doc.font("Helvetica").moveDown(0.3);
}

function para(doc: Doc, text: string, size = 9, color = INK) {
  doc.fontSize(size).fillColor(color).font("Helvetica").text(pdfText(text), MARGIN, doc.y, { width: doc.page.width - 2 * MARGIN });
}

interface Col {
  header: string;
  width: number; // fraction of content width
  align?: "left" | "right";
}

function table(doc: Doc, cols: Col[], rows: string[][], size = 7.5) {
  const content = doc.page.width - 2 * MARGIN;
  const widths = cols.map((c) => c.width * content);
  const pad = 3;
  const rowHeight = (cells: string[], bold = false) => {
    doc.font(bold ? "Helvetica-Bold" : "Helvetica").fontSize(size);
    return Math.max(...cells.map((c, i) => doc.heightOfString(pdfText(c), { width: widths[i] - 2 * pad }))) + 2 * pad;
  };
  const draw = (cells: string[], bold: boolean, color: string) => {
    const h = rowHeight(cells, bold);
    if (doc.y + h > doc.page.height - MARGIN - 10) {
      doc.addPage();
      draw(cols.map((c) => c.header), true, MUTED);
    }
    const y = doc.y;
    let x = MARGIN;
    doc.font(bold ? "Helvetica-Bold" : "Helvetica").fontSize(size).fillColor(color);
    cells.forEach((c, i) => {
      doc.text(pdfText(c), x + pad, y + pad, { width: widths[i] - 2 * pad, align: cols[i].align ?? "left" });
      x += widths[i];
    });
    doc.moveTo(MARGIN, y + h).lineTo(MARGIN + content, y + h).lineWidth(0.5).strokeColor(RULE).stroke();
    doc.y = y + h;
  };
  draw(cols.map((c) => c.header), true, MUTED);
  for (const r of rows) draw(r, false, INK);
  doc.x = MARGIN;
}

function flags(v: MetricValueRow): string {
  const f: string[] = [];
  if (v.boundary !== "consolidated_group") f.push(`! ${LABELS.boundary[v.boundary as Boundary]}`);
  if (v.coverage) f.push(`! ${v.coverage}`);
  if (v.status === "derived") f.push("derived");
  if (v.trend_break) f.push("trend break");
  return f.join("; ");
}

export async function benchmarkPdf(): Promise<Buffer> {
  const doc = newDoc("Sustainability disclosure benchmark");
  const t = totals();
  const companies = listCompanies();
  const scores = new Map(allScores().map((s) => [s.company_id, s]));

  doc.fontSize(20).font("Helvetica-Bold").fillColor(INK).text("Sustainability disclosure benchmark");
  doc.font("Helvetica").fontSize(9).fillColor(MUTED).text(pdfText(`Management report · data as seeded ${t.lastSeed?.slice(0, 10) ?? ""} · ${t.companies} companies · ${t.disclosed} disclosed values · ${t.sources} sources`));
  doc.moveDown(0.6);
  para(
    doc,
    "Every value traces to a source document and page. Missing is not zero: values are Disclosed, Not disclosed, Not found or Not assessed. Values on different boundaries, Scope 2 methods or partial coverage are shown side by side and never combined or ranked together. Transparency scores need 80% coverage of core metrics; performance scores need 3 of 5 comparable indicators.",
  );

  heading(doc, "Scores and coverage");
  table(
    doc,
    [
      { header: "Company", width: 0.2 },
      { header: "Peer group", width: 0.24 },
      { header: "Core coverage", width: 0.14, align: "right" },
      { header: "Transparency", width: 0.13, align: "right" },
      { header: "Performance", width: 0.13, align: "right" },
      { header: "Note", width: 0.16 },
    ],
    companies.map((c) => {
      const s = scores.get(c.id);
      return [
        c.name,
        c.peer_group_name,
        `${c.cov_disclosed}/${c.cov_total} disclosed`,
        s?.transparency_score !== null && s?.transparency_score !== undefined ? String(Math.round(s.transparency_score)) : "n/a",
        s?.performance_score !== null && s?.performance_score !== undefined ? String(Math.round(s.performance_score)) : "n/a",
        c.research_status === "profile_only" ? "profile only" : s?.performance_score === null ? "performance: insufficient comparable data" : "",
      ];
    }),
  );

  heading(doc, "Headline emissions, latest reported year");
  const headline = ["ghg_scope1", "ghg_scope2_market", "ghg_scope3_total"];
  const vals = latestValues(headline);
  const cell = (id: string, m: string) => {
    const v = vals.find((x) => x.company_id === id && x.metric_id === m);
    if (!v) return "Not assessed";
    if (v.state !== "disclosed") return LABELS.state[v.state];
    const f = flags(v);
    return `${formatCompact(v.canonical_value, v.canonical_unit)}${f ? `\n${f}` : ""}`;
  };
  table(
    doc,
    [
      { header: "Company", width: 0.2 },
      { header: "Year", width: 0.17 },
      { header: "Scope 1", width: 0.21, align: "right" },
      { header: "Scope 2 (market)", width: 0.21, align: "right" },
      { header: "Scope 3", width: 0.21, align: "right" },
    ],
    companies.map((c) => [
      c.name,
      c.cov_year ? fiscalLabel({ end: c.fy_end, labelConvention: c.fy_label_convention }, c.cov_year) : "-",
      cell(c.id, "ghg_scope1"),
      cell(c.id, "ghg_scope2_market"),
      cell(c.id, "ghg_scope3_total"),
    ]),
  );
  para(doc, "Side by side, not ranked. Flags (!) mark values that are not directly comparable. Per-company sources and pages are in each company report and in the XLSX export.", 7.5, MUTED);

  return finish(doc);
}

export async function companyPdf(id: string): Promise<Buffer | null> {
  const c = getCompany(id);
  if (!c) return null;
  const doc = newDoc(`${c.name} sustainability profile`);
  const fy = { end: c.fy_end, labelConvention: c.fy_label_convention };
  const s = scoreFor(id);
  const sources = sourcesFor(id);
  const srcTitle = new Map(sources.map((x) => [x.id, x.title]));

  doc.fontSize(20).font("Helvetica-Bold").fillColor(INK).text(pdfText(c.name));
  doc.font("Helvetica").fontSize(9).fillColor(MUTED).text(pdfText(`${c.legal_name} · ${c.peer_group_name} · ${c.sasb} · ${c.city}, ${c.country}`));
  doc.text(pdfText(`Fiscal year ends ${c.fy_end} (${c.fy_label_convention === "start_year" ? "labelled by start year" : "labelled by end year"}) · last reviewed ${c.last_reviewed}`));
  doc.moveDown(0.5);
  para(
    doc,
    `Core coverage: ${c.cov_disclosed}/${c.cov_total} disclosed${c.cov_year ? ` (${fiscalLabel(fy, c.cov_year)})` : ""}. Transparency score: ${
      s?.transparency_score !== null && s?.transparency_score !== undefined ? `${Math.round(s.transparency_score)}/100 (${s.transparency_met} of ${s.transparency_applicable} items)` : `not scored (${s?.transparency_reason ?? ""})`
    }. Performance score: ${s?.performance_score !== null && s?.performance_score !== undefined ? `${Math.round(s.performance_score)}/100` : `not scored (${s?.performance_reason ?? ""})`}.`,
  );

  const notes = JSON.parse(c.comparability_notes) as string[];
  if (notes.length) {
    heading(doc, "Comparability notes", 11);
    for (const n of notes) para(doc, `- ${n}`);
  }

  heading(doc, "Metrics (latest year; earlier years in the XLSX export)");
  const values = metricValuesFor(id);
  const rows: string[][] = [];
  for (const m of METRICS.filter((x) => metricAppliesTo(x, c.peer_group))) {
    const entries = values.filter((v) => v.metric_id === m.id);
    if (!entries.length) {
      if (m.core) rows.push([m.label, "-", "Not assessed", "", ""]);
      continue;
    }
    const v = entries[0];
    const ctx =
      v.state === "disclosed"
        ? [
            LABELS.boundary[v.boundary as Boundary],
            LABELS.consolidation[v.consolidation as Consolidation],
            v.scope2_method ? `${v.scope2_method}-based` : "",
            `assurance: ${LABELS.assurance[v.assurance_level as AssuranceLevel]}`,
            flags(v),
          ]
            .filter(Boolean)
            .join("; ")
        : v.note ?? "";
    rows.push([
      m.label,
      fiscalLabel(fy, v.year),
      v.state === "disclosed" ? formatReported(v.value, v.unit, v.text) : LABELS.state[v.state],
      ctx,
      v.source_id ? `${srcTitle.get(v.source_id) ?? v.source_id}, ${v.page ?? ""}` : "",
    ]);
  }
  table(
    doc,
    [
      { header: "Metric", width: 0.24 },
      { header: "Year", width: 0.12 },
      { header: "Value", width: 0.16, align: "right" },
      { header: "Context", width: 0.24 },
      { header: "Source, page", width: 0.24 },
    ],
    rows,
  );

  const targets = targetsFor(id);
  if (targets.length) {
    heading(doc, "Targets");
    table(
      doc,
      [
        { header: "Target", width: 0.42 },
        { header: "Validation", width: 0.14 },
        { header: "Progress (derived)", width: 0.24 },
        { header: "Source, page", width: 0.2 },
      ],
      targets.map((t) => {
        const p = progressFromRow(t);
        return [
          t.description,
          t.validation === "sbti_validated" ? "SBTi validated" : titleCase(t.validation),
          p.achievedShare !== null && p.expectedShare !== null
            ? `${titleCase(p.status)}: ${Math.round(p.achievedShare)}% achieved vs ${Math.round(p.expectedShare)}% expected`
            : `Not computable${p.reason ? ` (${p.reason})` : ""}`,
          `${srcTitle.get(t.source_id) ?? t.source_id}, ${t.page}`,
        ];
      }),
    );
  }

  const gaps = dataGapsFor(id);
  if (gaps.length) {
    heading(doc, "Data gaps");
    for (const g of gaps) para(doc, `- [${titleCase(g.kind)}] ${g.description}${g.page ? ` (${g.page})` : ""}`);
  }

  heading(doc, "Sources");
  for (const x of sources) {
    para(doc, `${x.id}: ${x.title} (${x.organisation}), accessed ${x.accessed}`);
    para(doc, x.url, 7.5, MUTED);
  }

  return finish(doc);
}
