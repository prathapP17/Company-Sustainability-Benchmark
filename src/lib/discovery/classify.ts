/** Classifies a discovered link (report type, year, language) from its URL and link text. */

export interface Classified {
  relevant: boolean;
  reportType: "sustainability_report" | "annual_report" | "esg_data_book" | "regulatory_filing" | "other";
  year: number | null;
  language: string;
  fileKind: "pdf" | "xlsx" | "html" | null;
}

const REPORT_WORDS =
  /sustainab|\besg\b|environment|climate|\bcsr\b|impact|brsr|non-financial|nonfinancial|data[ _-]?book|fact[ _-]?sheet|annual[ _-]?report|integrated[ _-]?report|tcfd|\bcdp\b|responsib|\bsdb\d|\bgri\b|carbon|emission/i;

export function decodeEntities(s: string): string {
  return s
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&nbsp;|&#160;/g, " ")
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)));
}

export function fileKindOf(url: string): Classified["fileKind"] {
  const p = new URL(url).pathname.toLowerCase();
  if (p.endsWith(".pdf")) return "pdf";
  if (p.endsWith(".xlsx")) return "xlsx";
  if (/\.(x?html?)$/.test(p)) return "html";
  return null;
}

export function classifyLink(url: string, text: string, currentYear: number): Classified {
  const u = new URL(url);
  const hay = `${decodeURIComponent(u.pathname)} ${text}`.replace(/[_+]/g, " ");
  const fileKind = fileKindOf(url);
  const years = [...hay.matchAll(/(?<!\d)(20[1-3]\d)(?!\d)/g)].map((m) => Number(m[1])).filter((y) => y >= 2015 && y <= currentYear + 1);
  const year = years.length ? Math.max(...years) : null;

  let reportType: Classified["reportType"] = "other";
  if (/data[ -]?book|fact[ -]?sheet|data[ -]?sheet|performance data|esg data|kpi/i.test(hay)) reportType = "esg_data_book";
  else if (/brsr|business responsibility/i.test(hay)) reportType = "regulatory_filing";
  else if (/sustainab|\besg\b|environment|climate|\bcsr\b|impact|non-?financial|tcfd|responsib|carbon|emission/i.test(hay)) reportType = "sustainability_report";
  else if (/annual[ -]?report|integrated[ -]?report|10-k|20-f/i.test(hay)) reportType = "annual_report";

  const path = u.pathname.toLowerCase();
  let language = "en";
  if (/(^|[/_.-])(jp|ja|jpn|japanese)([/_.-]|$)/.test(path)) language = "ja";
  else if (/(^|[/_.-])(kr|ko|kor|korean)([/_.-]|$)/.test(path)) language = "ko";
  else if (/(^|[/_.-])(zh|cn|chinese|zh-hant|zh-hans)([/_.-]|$)|-c\.pdf$/.test(path)) language = "zh";
  else if (/(^|[/_.-])(de|german)([/_.-]|$)/.test(path)) language = "de";

  return { relevant: fileKind !== null && REPORT_WORDS.test(hay) && reportType !== "other", reportType, year, language, fileKind };
}

export interface Link {
  url: string;
  text: string;
}

/** Extracts <a href> links (absolute, http/https, fragment removed) from an HTML page. */
export function extractLinks(html: string, baseUrl: string): Link[] {
  const out = new Map<string, Link>();
  for (const m of html.matchAll(/<a\b[^>]*?\bhref\s*=\s*(["'])(.*?)\1[^>]*>([\s\S]*?)<\/a>/gi)) {
    const href = decodeEntities(m[2].trim());
    if (!href || /^(javascript|mailto|tel):/i.test(href)) continue;
    let abs: URL;
    try {
      abs = new URL(href, baseUrl);
    } catch {
      continue;
    }
    if (abs.protocol !== "http:" && abs.protocol !== "https:") continue;
    abs.hash = "";
    const text = decodeEntities(m[3].replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ").trim().slice(0, 200);
    const key = abs.toString();
    if (!out.has(key) || (text && !out.get(key)!.text)) out.set(key, { url: key, text });
  }
  return [...out.values()];
}
