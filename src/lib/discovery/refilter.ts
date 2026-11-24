/**
 * Re-applies the current discovery filters to links already in the queue.
 *
 * When the classifier or a company's exclusion rules change, links recorded
 * by earlier runs keep their old status. This pass:
 *  - marks links the filters now leave out as "skipped" (with the reason),
 *  - removes PENDING or BLOCKED proposals extracted from such a link's
 *    fetched document (never approved or rejected ones, which are review
 *    decisions),
 *  - refreshes titles and years with the current rules.
 * Links used by the benchmark ("known") are never touched. Every change is
 * written to the audit log.
 */
import type { DB } from "../db/connection";
import { audit, nowIso } from "../pipeline/db";
import { loadCompanies } from "../data/load";
import { loadDiscoveryConfig } from "./config";
import { classifyLink, titleForLink } from "./classify";
import type { DiscoveredRow } from "./discover";

export interface RefilterChange {
  id: number;
  companyId: string;
  url: string;
  status: { from: string; to: string } | null;
  title: { from: string; to: string } | null;
  year: { from: number | null; to: number | null } | null;
  reason: string | null;
  documentId: number | null;
  proposalsRemoved: number;
}

export function refilterDiscovered(db: DB, dataDir: string, opts: { apply: boolean; actor?: string; now?: Date }): RefilterChange[] {
  const actor = opts.actor ?? "refilter";
  const year = (opts.now ?? new Date()).getUTCFullYear();
  const cfg = loadDiscoveryConfig(dataDir);
  const companies = loadCompanies(dataDir).companies;
  const rows = db.prepare("SELECT * FROM discovered_documents WHERE origin = 'crawl' ORDER BY id").all() as DiscoveredRow[];
  const pendingCount = db.prepare("SELECT count(*) n FROM extractions WHERE document_id = ? AND status IN ('pending','blocked')");
  const changes: RefilterChange[] = [];

  for (const row of rows) {
    if (row.status === "known") continue;
    const company = companies.find((c) => c.profile.id === row.company_id);
    const ccfg = cfg.companies[row.company_id];
    if (!company || !ccfg) continue;
    const cls = classifyLink(row.url, row.title, year, {
      hqCountry: company.profile.hq.country,
      excludePatterns: (ccfg.excludePatterns ?? []).map((p) => new RegExp(p, "i")),
    });
    const title = titleForLink(row.url, row.title);
    const newYear = cls.year !== null && cls.yearFromRange && company.profile.fiscalYear.labelConvention === "start_year" ? cls.year - 1 : cls.year;
    const leaveOut = !cls.relevant && row.status !== "skipped";
    const reason = leaveOut ? (cls.excluded ?? "no report words in the file name or link text") : null;
    const change: RefilterChange = {
      id: row.id,
      companyId: row.company_id,
      url: row.url,
      status: leaveOut ? { from: row.status, to: "skipped" } : null,
      title: title !== row.title ? { from: row.title, to: title } : null,
      year: newYear !== row.year ? { from: row.year, to: newYear } : null,
      reason,
      documentId: row.document_id,
      proposalsRemoved: leaveOut && row.document_id ? (pendingCount.get(row.document_id) as { n: number }).n : 0,
    };
    if (change.status || change.title || change.year) changes.push(change);
  }

  if (opts.apply && changes.length) {
    const ts = nowIso();
    db.transaction(() => {
      for (const c of changes) {
        db.prepare(
          `UPDATE discovered_documents SET status = COALESCE(?, status), title = COALESCE(?, title),
             year = CASE WHEN ? THEN ? ELSE year END, error = COALESCE(?, error), last_checked = ? WHERE id = ?`,
        ).run(
          c.status?.to ?? null,
          c.title?.to ?? null,
          c.year ? 1 : 0,
          c.year?.to ?? null,
          c.reason ? `left out by the refined filter: ${c.reason}` : null,
          ts,
          c.id,
        );
        if (c.documentId && c.title) db.prepare("UPDATE documents SET title = ? WHERE id = ?").run(c.title.to, c.documentId);
        if (c.proposalsRemoved) db.prepare("DELETE FROM extractions WHERE document_id = ? AND status IN ('pending','blocked')").run(c.documentId);
        audit(db, actor, "refilter_discovered", "discovered_document", c.id, { ...c });
      }
    })();
  }
  return changes;
}
