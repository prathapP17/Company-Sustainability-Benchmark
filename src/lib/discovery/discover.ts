/**
 * Automated source discovery (phase 4).
 *
 *  1. Crawl each company's configured official pages (seed pages plus one
 *     level of same-site report pages), robots.txt and rate limits respected.
 *  2. Classify report links (type, year, language); HEAD them for size,
 *     ETag and Last-Modified (no download).
 *  3. Record them, detect new and changed reports, raise alerts.
 *  4. SEC EDGAR filings for companies with a CIK (only when SEC_USER_AGENT is
 *     set by the user); these always wait for a reviewer's Fetch.
 *  5. Auto-fetch: only reports on the company's own allow-listed domains,
 *     in English, recent, at most N per company per run. Everything else
 *     waits in the Discovered queue.
 * A company's first run records a silent baseline (no "new report" alerts).
 */
import type { DB } from "../db/connection";
import { audit, nowIso } from "../pipeline/db";
import { MAX_UPLOAD_BYTES, storeUpload } from "../pipeline/ingest";
import { loadCompanies } from "../data/load";
import { loadDiscoveryConfig, onAllowedDomain, type CompanyDiscovery, type DiscoveryConfig } from "./config";
import { classifyLink, extractLinks, fileKindOf, type Link } from "./classify";
import { PoliteHttp, type FetchLike } from "./http";
import { raiseAlert } from "./alerts";

const REPORT_PAGE_WORDS = /sustainab|esg|environment|report|disclosure|data|responsib|climate|impact|investor|download|library|archive/i;

export interface DiscoveredRow {
  id: number;
  company_id: string;
  url: string;
  final_url: string | null;
  origin: "crawl" | "sec";
  source_page: string | null;
  title: string;
  report_type: string;
  year: number | null;
  language: string;
  official: number;
  content_type: string | null;
  content_length: number | null;
  etag: string | null;
  last_modified: string | null;
  sha256: string | null;
  document_id: number | null;
  status: "new" | "awaiting_fetch" | "fetched" | "known" | "skipped" | "blocked" | "failed";
  first_seen: string;
  last_checked: string;
  last_changed: string | null;
  error: string | null;
}

export interface RunOptions {
  dataDir: string;
  companies?: string[];
  trigger: "schedule" | "manual" | "test";
  fetchImpl?: FetchLike;
  sleep?: (ms: number) => Promise<void>;
  now?: () => Date;
  secUserAgent?: string | null;
  log?: (msg: string) => void;
}

export interface RunSummary {
  runId: number;
  pagesRead: number;
  found: number;
  fetched: number;
  alerts: number;
  blocked: string[];
  notes: string[];
}

function titleFor(link: Link): string {
  const fromUrl = decodeURIComponent(new URL(link.url).pathname.split("/").pop() ?? link.url);
  const t = link.text && link.text.length > 3 && !/^(download|pdf|here|click here|read more)$/i.test(link.text) ? link.text : fromUrl;
  return t.slice(0, 200);
}

/** Crawls one company's seed pages; returns candidate report links. */
async function crawlCompany(http: PoliteHttp, companyId: string, cfg: CompanyDiscovery, maxPages: number, state: { pagesRead: number; blocked: string[]; db: DB }) {
  const queue = cfg.seedUrls.map((u) => ({ url: u, depth: 0 }));
  const seenPages = new Set<string>();
  const reports = new Map<string, Link & { sourcePage: string }>();
  while (queue.length && seenPages.size < maxPages) {
    const { url, depth } = queue.shift()!;
    if (seenPages.has(url)) continue;
    seenPages.add(url);
    const res = await http.request(url, { maxBytes: 5 * 1024 * 1024, accept: "text/html,application/xhtml+xml" });
    if (res.blocked) {
      state.blocked.push(`${companyId}: ${new URL(url).host} (${res.blocked})`);
      raiseAlert(state.db, {
        companyId,
        kind: "blocked",
        title: `${new URL(url).host} blocked automated access (${res.blocked})`,
        url,
        details: { page: url, reason: res.blocked },
        dedupeKey: `blocked:${companyId}:${new URL(url).host}`,
      });
      continue;
    }
    if (!res.ok || !res.body) continue;
    state.pagesRead++;
    const html = res.body.toString("utf8");
    for (const link of extractLinks(html, res.finalUrl)) {
      const host = new URL(link.url).hostname;
      if (fileKindOf(link.url) === "pdf" || fileKindOf(link.url) === "xlsx") {
        if (!reports.has(link.url)) reports.set(link.url, { ...link, sourcePage: res.finalUrl });
      } else if (depth === 0 && onAllowedDomain(host, cfg.allowedDomains) && REPORT_PAGE_WORDS.test(`${link.url} ${link.text}`)) {
        if (!seenPages.has(link.url) && !queue.some((q) => q.url === link.url)) queue.push({ url: link.url, depth: 1 });
      }
    }
  }
  return [...reports.values()];
}

interface SecFilings {
  name?: string;
  filings?: { recent?: { form: string[]; accessionNumber: string[]; primaryDocument: string[]; filingDate: string[]; reportDate: string[] } };
}

async function secFilings(http: PoliteHttp, cik: string, nameIncludes: string): Promise<{ links: (Link & { year: number | null })[]; error?: string }> {
  const res = await http.request(`https://data.sec.gov/submissions/CIK${cik}.json`, { maxBytes: 20 * 1024 * 1024, accept: "application/json" });
  if (!res.ok || !res.body) return { links: [], error: res.blocked ?? res.error ?? `HTTP ${res.status}` };
  const data = JSON.parse(res.body.toString("utf8")) as SecFilings;
  if (!data.name || !data.name.toUpperCase().includes(nameIncludes.toUpperCase())) {
    return { links: [], error: `CIK ${cik} belongs to "${data.name ?? "unknown"}", expected "${nameIncludes}"; ignored` };
  }
  const r = data.filings?.recent;
  if (!r) return { links: [] };
  const out: (Link & { year: number | null })[] = [];
  for (let i = 0; i < r.form.length && out.length < 2; i++) {
    if (!["10-K", "20-F", "40-F"].includes(r.form[i])) continue;
    const acc = r.accessionNumber[i].replace(/-/g, "");
    out.push({
      url: `https://www.sec.gov/Archives/edgar/data/${Number(cik)}/${acc}/${r.primaryDocument[i]}`,
      text: `${r.form[i]} filed ${r.filingDate[i]}${r.reportDate[i] ? ` (period ${r.reportDate[i]})` : ""}`,
      year: r.reportDate[i] ? Number(r.reportDate[i].slice(0, 4)) : null,
    });
  }
  return { links: out };
}

/** Downloads a discovered report into the extraction pipeline (manual Fetch or auto-fetch). */
export async function fetchDiscovered(db: DB, dataDir: string, http: PoliteHttp, row: DiscoveredRow, actor: string): Promise<{ ok: boolean; error?: string }> {
  const res = await http.request(row.url, { maxBytes: MAX_UPLOAD_BYTES, accept: "application/pdf,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,text/html,*/*" });
  const now = nowIso();
  if (!res.ok || !res.body) {
    const status = res.blocked ? "blocked" : "failed";
    db.prepare("UPDATE discovered_documents SET status = ?, error = ?, last_checked = ? WHERE id = ?").run(status, res.blocked ?? res.error ?? `HTTP ${res.status}`, now, row.id);
    raiseAlert(db, {
      companyId: row.company_id,
      kind: res.blocked ? "blocked" : "fetch_failed",
      title: `Could not fetch "${row.title}": ${res.blocked ?? res.error}`,
      url: row.url,
      details: { status: res.status },
      dedupeKey: `${status}:${row.url}`,
    });
    return { ok: false, error: res.blocked ?? res.error };
  }
  const name = decodeURIComponent(new URL(res.finalUrl).pathname.split("/").pop() || "download");
  try {
    const up = storeUpload(db, dataDir, name, res.body, {
      companyId: row.company_id,
      title: row.title,
      sourceUrl: res.finalUrl,
      reportType: row.report_type,
      reportingYear: null,
      verificationClass: "primary_document",
      uploadedBy: actor,
    });
    if (row.sha256 && row.sha256 !== up.document.sha256) {
      raiseAlert(db, {
        companyId: row.company_id,
        kind: "changed_report",
        title: `Report file changed: "${row.title}"`,
        url: row.url,
        documentId: up.document.id,
        details: { previousSha256: row.sha256, sha256: up.document.sha256 },
        dedupeKey: `changed:${row.url}:${up.document.sha256}`,
      });
    }
    db.prepare("UPDATE discovered_documents SET status = 'fetched', sha256 = ?, document_id = ?, final_url = ?, error = NULL, last_checked = ? WHERE id = ?").run(
      up.document.sha256, up.document.id, res.finalUrl, now, row.id,
    );
    audit(db, actor, "fetch_discovered", "discovered_document", row.id, { url: row.url, documentId: up.document.id, duplicate: up.duplicate });
    return { ok: true };
  } catch (e) {
    db.prepare("UPDATE discovered_documents SET status = 'failed', error = ?, last_checked = ? WHERE id = ?").run((e as Error).message, now, row.id);
    return { ok: false, error: (e as Error).message };
  }
}

export function makeHttp(db: DB, cfg: DiscoveryConfig, opts: Pick<RunOptions, "fetchImpl" | "sleep" | "now">, userAgent?: string) {
  return new PoliteHttp(db, {
    hostIntervalMs: cfg.defaults.hostIntervalMs,
    fetchImpl: opts.fetchImpl,
    sleep: opts.sleep,
    now: opts.now ? () => opts.now!().getTime() : undefined,
    userAgent,
  });
}

export async function runDiscovery(db: DB, opts: RunOptions): Promise<RunSummary> {
  const log = opts.log ?? (() => {});
  const now = opts.now ?? (() => new Date());
  const cfg = loadDiscoveryConfig(opts.dataDir);
  const curated = loadCompanies(opts.dataDir).companies;
  const ids = (opts.companies ?? Object.keys(cfg.companies)).filter((id) => cfg.companies[id]);
  const run = db
    .prepare("INSERT INTO crawl_runs (started_at, trigger, companies) VALUES (?, ?, ?)")
    .run(now().toISOString(), opts.trigger, JSON.stringify(ids));
  const runId = Number(run.lastInsertRowid);
  const alertsBefore = (db.prepare("SELECT count(*) n FROM alerts").get() as { n: number }).n;
  const http = makeHttp(db, cfg, opts);
  const secUa = opts.secUserAgent ?? null;
  const secHttp = secUa ? makeHttp(db, cfg, opts, secUa) : null;
  const state = { pagesRead: 0, blocked: [] as string[], db };
  const summary: RunSummary = { runId, pagesRead: 0, found: 0, fetched: 0, alerts: 0, blocked: [], notes: [] };
  const year = now().getUTCFullYear();

  for (const companyId of ids) {
    const c = cfg.companies[companyId];
    const company = curated.find((x) => x.profile.id === companyId);
    if (!company) {
      summary.notes.push(`${companyId}: not in data/companies; skipped`);
      continue;
    }
    log(`discovering ${companyId}`);
    const baseline = (db.prepare("SELECT count(*) n FROM discovered_documents WHERE company_id = ?").get(companyId) as { n: number }).n === 0;
    const curatedUrls = new Set(company.sources.map((s) => s.url));

    const links: (Link & { sourcePage: string | null; origin: "crawl" | "sec"; yearHint?: number | null })[] = (
      await crawlCompany(http, companyId, c, cfg.defaults.maxPagesPerCompany, state)
    ).map((l) => ({ ...l, origin: "crawl" as const }));

    if (c.sec) {
      if (!secHttp) summary.notes.push(`${companyId}: SEC EDGAR skipped (set SEC_USER_AGENT in .env.local to enable)`);
      else {
        const sec = await secFilings(secHttp, c.sec.cik, c.sec.nameIncludes);
        if (sec.error) summary.notes.push(`${companyId}: SEC ${sec.error}`);
        for (const l of sec.links) links.push({ url: l.url, text: l.text, sourcePage: null, origin: "sec", yearHint: l.year });
      }
    }

    const autoCandidates: DiscoveredRow[] = [];
    for (const link of links) {
      const cls = classifyLink(link.url, link.text, year);
      if (link.origin === "crawl" && !cls.relevant) continue;
      const head = await (link.origin === "sec" && secHttp ? secHttp : http).request(link.url, { method: "HEAD", maxBytes: MAX_UPLOAD_BYTES });
      const finalUrl = head.finalUrl;
      const official = link.origin === "crawl" && onAllowedDomain(new URL(finalUrl).hostname, c.allowedDomains) ? 1 : 0;
      const meta = {
        content_type: head.headers.get("content-type"),
        content_length: Number(head.headers.get("content-length")) || null,
        etag: head.headers.get("etag"),
        last_modified: head.headers.get("last-modified"),
      };
      const existing = db.prepare("SELECT * FROM discovered_documents WHERE url = ?").get(link.url) as DiscoveredRow | undefined;
      const ts = now().toISOString();
      summary.found++;

      if (!existing) {
        const isKnown = curatedUrls.has(link.url) || curatedUrls.has(finalUrl);
        const robotsSays = head.error === "disallowed by robots.txt";
        const status: DiscoveredRow["status"] = robotsSays ? "skipped" : head.blocked ? "blocked" : isKnown ? "known" : "new";
        const info = db
          .prepare(
            `INSERT INTO discovered_documents (company_id, url, final_url, origin, source_page, title, report_type, year, language, official,
               content_type, content_length, etag, last_modified, status, first_seen, last_checked, error)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          )
          .run(
            companyId, link.url, finalUrl, link.origin, link.sourcePage, titleFor(link),
            link.origin === "sec" ? "regulatory_filing" : cls.reportType, link.yearHint ?? cls.year, cls.language, official,
            meta.content_type, meta.content_length, meta.etag, meta.last_modified, status, ts, ts, head.blocked ?? (robotsSays ? head.error : null),
          );
        const row = db.prepare("SELECT * FROM discovered_documents WHERE id = ?").get(Number(info.lastInsertRowid)) as DiscoveredRow;
        if (status === "new") {
          if (!baseline) {
            raiseAlert(db, {
              companyId,
              kind: "new_report",
              title: `New ${row.report_type.replace(/_/g, " ")} found: "${row.title}"`,
              url: row.url,
              details: { year: row.year, language: row.language, official: !!official, origin: link.origin },
              dedupeKey: `new:${row.url}`,
            });
          }
          autoCandidates.push(row);
        }
        continue;
      }

      // Known URL: compare validators to detect a changed file without downloading it.
      const changed =
        !head.blocked &&
        head.ok &&
        ((meta.etag && existing.etag && meta.etag !== existing.etag) ||
          (meta.last_modified && existing.last_modified && meta.last_modified !== existing.last_modified) ||
          (meta.content_length && existing.content_length && meta.content_length !== existing.content_length));
      db.prepare(
        "UPDATE discovered_documents SET final_url = ?, content_type = COALESCE(?, content_type), content_length = COALESCE(?, content_length), etag = COALESCE(?, etag), last_modified = COALESCE(?, last_modified), last_checked = ?, last_changed = CASE WHEN ? THEN ? ELSE last_changed END WHERE id = ?",
      ).run(finalUrl, meta.content_type, meta.content_length, meta.etag, meta.last_modified, ts, changed ? 1 : 0, ts, existing.id);
      if (changed) {
        const used = existing.status === "known";
        raiseAlert(db, {
          companyId,
          kind: used ? "source_changed" : "changed_report",
          title: used ? `A source used in the benchmark changed: "${existing.title}"` : `Report changed on the website: "${existing.title}"`,
          url: existing.url,
          details: { before: { etag: existing.etag, lastModified: existing.last_modified, length: existing.content_length }, after: meta },
          dedupeKey: `changed:${existing.url}:${meta.etag ?? meta.last_modified ?? meta.content_length}`,
        });
        if (existing.status === "fetched" || existing.status === "known") {
          db.prepare("UPDATE discovered_documents SET status = 'new' WHERE id = ?").run(existing.id);
          autoCandidates.push({ ...existing, status: "new" });
        }
      }
    }

    // Auto-fetch policy: official domain, auto-fetch on, English, recent, capped per run.
    let fetchedHere = 0;
    for (const row of autoCandidates) {
      const eligible =
        c.autoFetch &&
        row.official === 1 &&
        row.language === "en" &&
        row.year !== null &&
        row.year >= year - cfg.defaults.autoFetchMinYearOffset &&
        fetchedHere < cfg.defaults.maxAutoFetchPerRun;
      if (!eligible) {
        db.prepare("UPDATE discovered_documents SET status = 'awaiting_fetch' WHERE id = ? AND status = 'new'").run(row.id);
        continue;
      }
      const r = await fetchDiscovered(db, opts.dataDir, http, row, "discovery");
      if (r.ok) {
        fetchedHere++;
        summary.fetched++;
      }
    }
  }

  summary.pagesRead = state.pagesRead;
  summary.blocked = state.blocked;
  summary.alerts = (db.prepare("SELECT count(*) n FROM alerts").get() as { n: number }).n - alertsBefore;
  db.prepare("UPDATE crawl_runs SET finished_at = ?, pages_read = ?, found = ?, fetched = ?, alerts = ?, error = ? WHERE id = ?").run(
    now().toISOString(), summary.pagesRead, summary.found, summary.fetched, summary.alerts, summary.notes.length ? summary.notes.join("\n") : null, runId,
  );
  audit(db, "discovery", "crawl_run", "crawl_run", runId, { ...summary });
  return summary;
}
