/**
 * Seeds the curated SQLite database from validated company files.
 *
 * - Refuses to seed if validation reports any error.
 * - Applies pending (additive) migrations, backing up first.
 * - Replaces each company's derived rows inside one transaction. The curated
 *   database is a build artefact of the git-tracked JSON files; tables are
 *   never dropped and the file is never deleted.
 */
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import { loadCompanies } from "../data/load";
import { coverageFor } from "../data/coverage";
import { resolveMetric } from "../schema/validate";
import { getMetric, toCanonical } from "../metrics/dictionary";
import { periodEnd } from "../fiscal";
import { dbPath, migrate, openWritable } from "./connection";
import { transparency } from "../scoring/transparency";
import { performance } from "../scoring/performance";

export interface SeedResult {
  dbFile: string;
  backup?: string;
  companies: number;
  metricValues: number;
  removedCompanies: string[];
}

export function seed(dataDir: string, now = new Date()): SeedResult {
  const { companies, peerGroups, issues } = loadCompanies(dataDir);
  const errors = issues.filter((i) => i.level === "error");
  if (errors.length) {
    throw new Error(`Refusing to seed: ${errors.length} validation error(s). Run "npm run validate".`);
  }

  const file = dbPath(dataDir);
  const db = openWritable(file);
  try {
    const backup = migrate(db, file, now);
    const hash = createHash("sha256");
    let metricValues = 0;
    const removed: string[] = [];

    const tx = db.transaction(() => {
      const childTables = [
        "metric_values",
        "targets",
        "data_gaps",
        "sources",
        "reports",
        "company_coverage",
        "company_scores",
        "transparency_items",
        "performance_indicators",
      ];
      const ids = new Set(companies.map((c) => c.profile.id));
      const existing = (db.prepare("SELECT id FROM companies").all() as { id: string }[]).map((r) => r.id);
      for (const id of existing.filter((x) => !ids.has(x))) {
        for (const t of childTables) db.prepare(`DELETE FROM ${t} WHERE company_id = ?`).run(id);
        db.prepare("DELETE FROM companies WHERE id = ?").run(id);
        removed.push(id);
      }

      const upPeer = db.prepare(
        `INSERT INTO peer_groups (id, name, description, sasb_industries) VALUES (@id, @name, @description, @sasb)
         ON CONFLICT(id) DO UPDATE SET name=excluded.name, description=excluded.description, sasb_industries=excluded.sasb_industries`,
      );
      for (const p of peerGroups) upPeer.run({ id: p.id, name: p.name, description: p.description, sasb: JSON.stringify(p.sasbIndustries) });

      const upCompany = db.prepare(`
        INSERT INTO companies (id, name, legal_name, peer_group, region, country, city, lat, lon, gics, sasb, fy_end,
          fy_label_convention, fy_note, website, sustainability_page, research_status, research_notes, last_reviewed,
          listings, frameworks, comparability_notes, file_hash)
        VALUES (@id, @name, @legal_name, @peer_group, @region, @country, @city, @lat, @lon, @gics, @sasb, @fy_end,
          @fy_label_convention, @fy_note, @website, @sustainability_page, @research_status, @research_notes, @last_reviewed,
          @listings, @frameworks, @comparability_notes, @file_hash)
        ON CONFLICT(id) DO UPDATE SET name=excluded.name, legal_name=excluded.legal_name, peer_group=excluded.peer_group,
          region=excluded.region, country=excluded.country, city=excluded.city, lat=excluded.lat, lon=excluded.lon,
          gics=excluded.gics, sasb=excluded.sasb, fy_end=excluded.fy_end, fy_label_convention=excluded.fy_label_convention,
          fy_note=excluded.fy_note, website=excluded.website, sustainability_page=excluded.sustainability_page,
          research_status=excluded.research_status, research_notes=excluded.research_notes,
          last_reviewed=excluded.last_reviewed, listings=excluded.listings, frameworks=excluded.frameworks,
          comparability_notes=excluded.comparability_notes, file_hash=excluded.file_hash`);
      const insSource = db.prepare(`INSERT INTO sources VALUES (@company_id, @id, @organisation, @title, @type, @url, @accessed, @reporting_year, @verification_class, @notes)`);
      const insReport = db.prepare(`INSERT INTO reports VALUES (@company_id, @year, @type, @source_id, @level, @provider, @scope)`);
      const insMetric = db.prepare(`
        INSERT INTO metric_values (company_id, metric_id, year, period_end, state, value, text, unit, canonical_value,
          canonical_unit, boundary, consolidation, scope2_method, coverage, assurance_level, assurance_provider,
          verification_class, status, low_confidence, source_id, page, reported_wording, note, trend_break, internal_note)
        VALUES (@company_id, @metric_id, @year, @period_end, @state, @value, @text, @unit, @canonical_value,
          @canonical_unit, @boundary, @consolidation, @scope2_method, @coverage, @assurance_level, @assurance_provider,
          @verification_class, @status, @low_confidence, @source_id, @page, @reported_wording, @note, @trend_break, @internal_note)`);
      const insTarget = db.prepare(`
        INSERT INTO targets VALUES (@company_id, @id, @category, @type, @description, @scopes, @by, @bv, @bu, @ty, @tv, @tu,
          @ly, @lv, @lu, @validation, @source_id, @page, @note)`);
      const insGap = db.prepare(`INSERT INTO data_gaps VALUES (@company_id, @metric_id, @year, @kind, @description, @source_id, @page)`);
      const insScore = db.prepare(`INSERT INTO company_scores VALUES (@company_id, @ts, @tm, @ta, @tr, @ps, @pa, @pr)`);
      const insItem = db.prepare(`INSERT INTO transparency_items VALUES (@company_id, @item_id, @label, @grp, @met, @evidence)`);
      const insInd = db.prepare(`INSERT INTO performance_indicators VALUES (@company_id, @id, @label, @raw, @unit, @score, @detail)`);
      const insCoverage = db.prepare(`INSERT INTO company_coverage VALUES (@company_id, @year, @total, @disclosed, @not_disclosed, @not_found, @not_assessed)`);

      for (const c of companies) {
        const p = c.profile;
        const fileText = readFileSync(path.join(dataDir, "companies", `${p.id}.json`), "utf8");
        const fileHash = createHash("sha256").update(fileText).digest("hex");
        hash.update(fileHash);

        for (const t of childTables) db.prepare(`DELETE FROM ${t} WHERE company_id = ?`).run(p.id);
        upCompany.run({
          id: p.id, name: p.name, legal_name: p.legalName, peer_group: p.peerGroup, region: p.region,
          country: p.hq.country, city: p.hq.city, lat: p.hq.lat, lon: p.hq.lon, gics: p.industry.gics,
          sasb: p.industry.sasb, fy_end: p.fiscalYear.end, fy_label_convention: p.fiscalYear.labelConvention,
          fy_note: p.fiscalYear.note ?? null, website: p.website, sustainability_page: p.sustainabilityPage ?? null,
          research_status: c.researchStatus, research_notes: c.researchNotes ?? null, last_reviewed: c.lastReviewed,
          listings: JSON.stringify(p.listings), frameworks: JSON.stringify(c.frameworks),
          comparability_notes: JSON.stringify(c.comparabilityNotes), file_hash: fileHash,
        });
        for (const s of c.sources) {
          insSource.run({
            company_id: p.id, id: s.id, organisation: s.organisation, title: s.title, type: s.type, url: s.url,
            accessed: s.accessed, reporting_year: s.reportingYear ?? null, verification_class: s.verificationClass,
            notes: s.notes ?? null,
          });
        }
        for (const r of c.reports) {
          insReport.run({
            company_id: p.id, year: r.year, type: r.type, source_id: r.source ?? null, level: r.assurance.level,
            provider: r.assurance.provider ?? null, scope: r.assurance.scope ?? null,
          });
        }
        for (const raw of c.metrics) {
          const m = resolveMetric(c, raw);
          const def = getMetric(m.metric);
          const canonical = m.value !== undefined && m.unit ? toCanonical(m.metric, m.value, m.unit) : null;
          insMetric.run({
            company_id: p.id, metric_id: m.metric, year: m.year, period_end: periodEnd(p.fiscalYear, m.year),
            state: m.state, value: m.value ?? null, text: m.text ?? null, unit: m.unit ?? null,
            canonical_value: canonical, canonical_unit: canonical === null ? null : def.canonicalUnit,
            boundary: m.boundary, consolidation: m.consolidation, scope2_method: m.scope2Method ?? null,
            coverage: m.coverage ?? null, assurance_level: m.assurance.level, assurance_provider: m.assurance.provider ?? null,
            verification_class: m.verificationClass, status: m.status, low_confidence: m.lowConfidence ? 1 : 0,
            source_id: m.source ?? null, page: m.page ?? null, reported_wording: m.reportedWording ?? null,
            note: m.note ?? null, trend_break: m.trendBreak ? 1 : 0, internal_note: m.internalNote ?? null,
          });
          metricValues++;
        }
        for (const t of c.targets) {
          insTarget.run({
            company_id: p.id, id: t.id, category: t.category, type: t.type, description: t.description,
            scopes: t.scopes ? JSON.stringify(t.scopes) : null,
            by: t.baseline?.year ?? null, bv: t.baseline?.value ?? null, bu: t.baseline?.unit ?? null,
            ty: t.target.year, tv: t.target.value ?? null, tu: t.target.unit ?? null,
            ly: t.latest?.year ?? null, lv: t.latest?.value ?? null, lu: t.latest?.unit ?? null,
            validation: t.validation, source_id: t.source, page: t.page, note: t.note ?? null,
          });
        }
        for (const g of c.dataGaps) {
          insGap.run({
            company_id: p.id, metric_id: g.metric ?? null, year: g.year ?? null, kind: g.kind,
            description: g.description, source_id: g.source ?? null, page: g.page ?? null,
          });
        }
        const cov = coverageFor(c);
        insCoverage.run({ company_id: p.id, year: cov.year ?? null, total: cov.total, ...cov.counts });

        const t = transparency(c);
        const perf = performance(c);
        insScore.run({
          company_id: p.id, ts: t.score, tm: t.met, ta: t.applicable, tr: t.reason ?? null,
          ps: perf.score, pa: perf.available, pr: perf.reason ?? null,
        });
        for (const i of t.items) {
          insItem.run({ company_id: p.id, item_id: i.id, label: i.label, grp: i.group, met: i.met === null ? null : i.met ? 1 : 0, evidence: i.evidence });
        }
        for (const i of perf.indicators) {
          insInd.run({ company_id: p.id, id: i.id, label: i.label, raw: i.raw, unit: i.rawUnit, score: i.score, detail: i.detail });
        }
      }

      db.prepare("INSERT INTO seed_runs (at, companies, metric_values, data_hash) VALUES (?, ?, ?, ?)").run(
        now.toISOString(), companies.length, metricValues, hash.digest("hex"),
      );
    });
    tx();
    db.pragma("wal_checkpoint(TRUNCATE)");
    return { dbFile: file, backup, companies: companies.length, metricValues, removedCompanies: removed };
  } finally {
    db.close();
  }
}
