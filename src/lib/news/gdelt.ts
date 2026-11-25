/**
 * News and controversy signals from the GDELT DOC 2.0 API (free, no account).
 *
 * - One query per company: its names AND any of the topic words, recent
 *   articles only (data/news.json). Headlines, links and metadata only; no
 *   article text is fetched or stored.
 * - GDELT asks for at most one request every 5 seconds; requests to its host
 *   are spaced 10 seconds apart (robots.txt included), and a "too fast" answer
 *   is retried once after 30 seconds, then reported.
 * - Every item starts as 'pending'. Only reviewer-approved items are shown,
 *   labelled as secondary sources, and they never enter scores (rule 7).
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { z } from "zod";
import type { DB } from "../db/connection";
import { audit, nowIso } from "../pipeline/db";
import { PoliteHttp, type FetchLike } from "../discovery/http";
import { nodeFetch } from "./https-fetch";

export const NewsConfig = z.strictObject({
  $schemaVersion: z.literal(1),
  defaults: z.strictObject({
    timespan: z.string().regex(/^\d+(min|h|d|w|m|months?)$/),
    maxRecords: z.number().int().min(1).max(250),
    language: z.string().regex(/^[a-z]+$/),
    hostIntervalMs: z.number().int().min(5000),
  }),
  topics: z.array(z.string().min(3)).min(1),
  companies: z.record(z.string(), z.strictObject({ names: z.array(z.string().min(3)).min(1) })),
});
export type NewsConfig = z.infer<typeof NewsConfig>;

export function loadNewsConfig(dataDir: string): NewsConfig {
  return NewsConfig.parse(JSON.parse(readFileSync(path.join(/*turbopackIgnore: true*/ dataDir, "news.json"), "utf8")));
}

const API = "https://api.gdeltproject.org/api/v2/doc/doc";
const RETRY_AFTER_MS = 30_000;

export function buildQuery(names: string[], topics: string[], language: string): string {
  const n = names.length > 1 ? `(${names.join(" OR ")})` : names[0];
  return `${n} (${topics.join(" OR ")}) sourcelang:${language}`;
}

export interface Article {
  url: string;
  title: string;
  domain: string | null;
  language: string | null;
  sourceCountry: string | null;
  seenAt: string | null;
}

const GdeltResponse = z.object({
  articles: z
    .array(z.object({ url: z.string(), title: z.string(), seendate: z.string().optional(), domain: z.string().optional(), language: z.string().optional(), sourcecountry: z.string().optional() }))
    .optional(),
});

/** GDELT answers errors and rate limits as plain text with HTTP 200. */
export function parseGdelt(body: string): Article[] {
  const t = body.trim();
  if (!t.startsWith("{")) throw new Error(`GDELT: ${t.slice(0, 160).replace(/\s+/g, " ")}`);
  const data = GdeltResponse.parse(JSON.parse(t));
  return (data.articles ?? [])
    .filter((a) => /^https?:\/\//.test(a.url))
    .map((a) => ({
      url: a.url,
      title: a.title.replace(/\s+/g, " ").trim().slice(0, 300),
      domain: a.domain ?? null,
      language: a.language ?? null,
      sourceCountry: a.sourcecountry ?? null,
      seenAt: a.seendate && /^\d{8}T\d{6}Z$/.test(a.seendate) ? `${a.seendate.slice(0, 4)}-${a.seendate.slice(4, 6)}-${a.seendate.slice(6, 8)}T${a.seendate.slice(9, 11)}:${a.seendate.slice(11, 13)}:${a.seendate.slice(13, 15)}Z` : null,
    }));
}

/** Topic words (unquoted) that appear in a headline. */
export function topicsIn(title: string, topics: string[]): string[] {
  const t = title.toLowerCase();
  return topics.map((x) => x.replace(/"/g, "").toLowerCase()).filter((x) => t.includes(x));
}

export interface NewsRunSummary {
  found: number;
  added: number;
  errors: string[];
}

export async function fetchNews(
  db: DB,
  dataDir: string,
  opts: { companies?: string[]; fetchImpl?: FetchLike; sleep?: (ms: number) => Promise<void>; log?: (m: string) => void } = {},
): Promise<NewsRunSummary> {
  const cfg = loadNewsConfig(dataDir);
  const http = new PoliteHttp(db, { hostIntervalMs: cfg.defaults.hostIntervalMs, timeoutMs: 120_000, fetchImpl: opts.fetchImpl ?? nodeFetch, sleep: opts.sleep });
  const ins = db.prepare(
    `INSERT OR IGNORE INTO news_items (company_id, url, title, domain, language, source_country, seen_at, topics, origin, status, first_seen)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'gdelt', 'pending', ?)`,
  );
  const summary: NewsRunSummary = { found: 0, added: 0, errors: [] };
  for (const [id, c] of Object.entries(cfg.companies)) {
    if (opts.companies && !opts.companies.includes(id)) continue;
    const q = buildQuery(c.names, cfg.topics, cfg.defaults.language);
    const url = `${API}?${new URLSearchParams({ query: q, mode: "ArtList", format: "json", maxrecords: String(cfg.defaults.maxRecords), timespan: cfg.defaults.timespan, sort: "DateDesc" })}`;
    opts.log?.(`news: ${id}`);
    let articles: Article[] | null = null;
    // GDELT signals "too fast" with HTTP 429 or a plain-text notice: wait and retry once, then report it.
    for (let attempt = 0; attempt < 2 && articles === null; attempt++) {
      if (attempt > 0) await (opts.sleep ?? ((ms: number) => new Promise((r) => setTimeout(r, ms))))(RETRY_AFTER_MS);
      const res = await http.request(url, { maxBytes: 5 * 1024 * 1024, accept: "application/json" });
      const text = res.body?.toString("utf8") ?? "";
      const rateLimited = res.status === 429 || /^please limit requests/i.test(text.trim());
      if (rateLimited && attempt === 0) continue;
      if (rateLimited) {
        summary.errors.push(`${id}: GDELT rate limit (try again later)`);
        break;
      }
      if (!res.ok || !res.body) {
        summary.errors.push(`${id}: ${res.blocked ?? res.error ?? `HTTP ${res.status}`}`);
        break;
      }
      try {
        articles = parseGdelt(text);
      } catch (e) {
        summary.errors.push(`${id}: ${(e as Error).message}`);
        break;
      }
    }
    if (articles === null) continue;
    summary.found += articles.length;
    const ts = nowIso();
    for (const a of articles) {
      const r = ins.run(id, a.url, a.title, a.domain, a.language, a.sourceCountry, a.seenAt, JSON.stringify(topicsIn(a.title, cfg.topics)), ts);
      summary.added += r.changes;
    }
  }
  audit(db, "news", "news_fetch", "news", null, { ...summary });
  return summary;
}

export interface NewsRow {
  id: number;
  company_id: string;
  url: string;
  title: string;
  domain: string | null;
  language: string | null;
  source_country: string | null;
  seen_at: string | null;
  topics: string | null;
  status: "pending" | "approved" | "rejected";
  reviewer: string | null;
  reviewed_at: string | null;
  note: string | null;
  first_seen: string;
}

export function listNews(db: DB, status: NewsRow["status"], companyId?: string, limit = 200): NewsRow[] {
  return (
    companyId
      ? db.prepare("SELECT * FROM news_items WHERE status = ? AND company_id = ? ORDER BY seen_at DESC, id DESC LIMIT ?").all(status, companyId, limit)
      : db.prepare("SELECT * FROM news_items WHERE status = ? ORDER BY seen_at DESC, id DESC LIMIT ?").all(status, limit)
  ) as NewsRow[];
}

export class NewsError extends Error {}

/** Approve (with a one-line note shown publicly), reject, or withdraw an earlier approval. */
export function reviewNews(db: DB, id: number, reviewer: string, action: "approve" | "reject", note?: string) {
  const row = db.prepare("SELECT * FROM news_items WHERE id = ?").get(id) as NewsRow | undefined;
  if (!row) throw new NewsError("no such news item");
  const clean = (note ?? "").replace(/\s+/g, " ").trim().slice(0, 280);
  if (action === "approve" && clean.length < 10) throw new NewsError("add a short note (at least 10 characters) on why this is relevant");
  db.prepare("UPDATE news_items SET status = ?, reviewer = ?, reviewed_at = ?, note = ? WHERE id = ?").run(
    action === "approve" ? "approved" : "rejected",
    reviewer,
    nowIso(),
    action === "approve" ? clean : clean || null,
    id,
  );
  audit(db, reviewer, action === "approve" ? "news_approved" : row.status === "approved" ? "news_withdrawn" : "news_rejected", "news_item", id, { company: row.company_id, url: row.url, note: clean || null });
}
