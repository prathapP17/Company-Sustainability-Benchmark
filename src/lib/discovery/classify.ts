/** Classifies a discovered link (report type, year, language) from its URL and link text. */

export interface Classified {
  relevant: boolean;
  reportType: "sustainability_report" | "annual_report" | "esg_data_book" | "regulatory_filing" | "other";
  /** Year printed in the link: for a fiscal range ("2025-26") the END year. */
  year: number | null;
  /** True when `year` came from a fiscal range, so a start-year company labels it year - 1. */
  yearFromRange: boolean;
  language: string;
  fileKind: "pdf" | "xlsx" | "html" | null;
  /** Why a report-like link was left out (not a report, a country or subsidiary report). */
  excluded: string | null;
}

export interface ClassifyOptions {
  /** The company's headquarters country; reports naming any OTHER country are country/subsidiary reports. */
  hqCountry?: string;
  /** Company-specific patterns (e.g. a listed subsidiary's name) that mark a link as not the group's. */
  excludePatterns?: RegExp[];
}

const REPORT_WORDS =
  /sustainab|\besg\b|environment|climate|\bcsr\b|impact|brsr|non-financial|nonfinancial|data[ _-]?book|fact[ _-]?sheet|annual[ _-]?report|integrated[ _-]?report|tcfd|\bcdp\b|responsib|\bsdb\d|\bgri\b|carbon|emission/i;

/**
 * Documents that sit next to sustainability reports but carry no group-level
 * disclosure data: product sheets, policies, certificates, legal statements.
 */
const NOT_A_REPORT: [RegExp, string][] = [
  [/product environment|\blca results\b|life[ -]?cycle assessment/i, "product-level environmental sheet"],
  // Apple-style "iPhone_18_PER_Sept2026.pdf"; case-sensitive so the word "per" never matches.
  [/(?:^|[\s_-])PER(?:[\s_.-]|$)/, "product-level environmental sheet"],
  [/conflict[ -]?minerals|responsible[ -]?minerals/i, "minerals sourcing report"],
  [/certific|\biso ?\d{4,5}\b|declaration|\bkolas\b|\btuv\b/i, "certificate or declaration"],
  [/modern[ -]?slavery|transparency act|human[ -]?trafficking|\beeo-?1?\b|equal employment/i, "legal or workforce statement"],
  [/polic(?:y|ies)|principles|code of conduct|guidelines?|specification|requirements|white ?paper|framework proposal|commitment to/i, "policy, standard or white paper"],
  [/supplier list|digital defen[cs]e|csam|terrorist content|pro bono|\bdua\b|agreement|readme|press release|proxy|10-q|earnings/i, "not a sustainability report"],
];

const COUNTRIES = [
  "Argentina", "Australia", "Austria", "Bangladesh", "Belgium", "Brazil", "Canada", "Chile", "China", "Colombia", "Czech", "Denmark",
  "Egypt", "Finland", "France", "Germany", "Greece", "Hong Kong", "Hungary", "India", "Indonesia", "Ireland", "Israel", "Italy",
  "Japan", "Kenya", "Korea", "Malaysia", "Mexico", "Morocco", "Netherlands", "New Zealand", "Nigeria", "Norway", "Pakistan", "Peru",
  "Philippines", "Poland", "Portugal", "Romania", "Saudi", "Singapore", "Slovakia", "South Africa", "Spain", "Sri Lanka", "Sweden",
  "Switzerland", "Taiwan", "Thailand", "Turkey", "Türkiye", "UAE", "United Kingdom", "\\bUK\\b", "United States", "\\bUSA\\b", "Vietnam",
];

function countryRe(c: string): RegExp {
  return new RegExp(c.startsWith("\\b") ? c : `\\b${c}\\b`, "i");
}

/** Normalises a country name so "South Korea" / "Korea" and "Taiwan, China" style variants match. */
function sameCountry(listed: string, hq: string): boolean {
  const a = listed.replace(/\\b/g, "").toLowerCase();
  const b = hq.toLowerCase();
  return b.includes(a) || a.includes(b) || (a === "uk" && b.includes("united kingdom")) || (a === "usa" && b.includes("united states"));
}

const GENERIC_LINK_TEXT = /^(?:view|download|read|learn|find|get|explore|see|open|access|more|click|here|pdf|report)\b[\w\s()'’.-]{0,25}$/i;

/** Readable title from a file name: "Apple_Environmental_Progress_Report_2025.pdf" -> "Apple Environmental Progress Report 2025". */
export function titleFromFile(url: string): string {
  const name = decodeURIComponent(new URL(url).pathname.split("/").pop() ?? url);
  return name.replace(/\.(pdf|xlsx|x?html?)$/i, "").replace(/[_+]+|-(?=\D)|(?<=\D)-/g, " ").replace(/\s+/g, " ").trim() || name;
}

/** The link text when it describes the report; otherwise the cleaned file name. */
export function titleForLink(url: string, text: string): string {
  const t = text.trim();
  const looksLikeFileName = /\.(pdf|xlsx|x?html?)$/i.test(t);
  const useful = t.length > 3 && !looksLikeFileName && !GENERIC_LINK_TEXT.test(t) && (REPORT_WORDS.test(t) || /20\d{2}/.test(t));
  return (useful ? t.replace(/^(?:download|view|read)\s+/i, "") : titleFromFile(url)).slice(0, 200);
}

function yearOf(s: string, currentYear: number): { year: number; range: boolean } | null {
  const ok = (y: number) => y >= 2015 && y <= currentYear + 1;
  // Fiscal ranges: "2025-26", "2025-2026", "FY2025/26", "202526" (as in CSR202526).
  const ranges = [...s.matchAll(/(?<!\d)(20[1-3]\d)\s?[-–/]?\s?(20[1-3]\d|\d{2})(?!\d)/g)]
    .map((m) => {
      const start = Number(m[1]);
      const end = m[2].length === 2 ? Math.floor(start / 100) * 100 + Number(m[2]) : Number(m[2]);
      return end === start + 1 ? end : null;
    })
    .filter((y): y is number => y !== null && ok(y));
  if (ranges.length) return { year: Math.max(...ranges), range: true };
  const years = [...s.matchAll(/(?<!\d)(20[1-3]\d)(?!\d)/g)].map((m) => Number(m[1])).filter(ok);
  return years.length ? { year: Math.max(...years), range: false } : null;
}

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

export function classifyLink(url: string, text: string, currentYear: number, opts: ClassifyOptions = {}): Classified {
  const u = new URL(url);
  const fileName = decodeURIComponent(u.pathname.split("/").pop() ?? "");
  // Words come from the file name and link text only: folder names such as
  // "/environment/" or "/CSR/" describe the site section, not the document.
  const hay = `${fileName} ${text}`.replace(/[_+]/g, " ");
  const fileKind = fileKindOf(url);
  // Year: link text first, then file name. Folder dates ("/files/2022-08/") are upload dates, not report years.
  const y = yearOf(text, currentYear) ?? yearOf(fileName.replace(/[_+]/g, " "), currentYear);

  let reportType: Classified["reportType"] = "other";
  if (/data[ -]?book|fact[ -]?sheet|data[ -]?sheet|performance data|esg data|kpi/i.test(hay)) reportType = "esg_data_book";
  else if (/brsr|business responsibility/i.test(hay)) reportType = "regulatory_filing";
  else if (/sustainab|\besg\b|environment|climate|\bcsr\b|impact|non-?financial|tcfd|\bcdp\b|\bgri\b|responsib|carbon|emission/i.test(hay)) reportType = "sustainability_report";
  else if (/annual[ -]?report|integrated[ -]?report|10-k|20-f|\bAR\b/i.test(hay)) reportType = "annual_report";

  const path = u.pathname.toLowerCase();
  let language = "en";
  if (/(^|[/_.-])(jp|ja|jpn|japanese)([/_.-]|$)/.test(path)) language = "ja";
  else if (/(^|[/_.-])(kr|ko|kor|korean)([/_.-]|$)/.test(path)) language = "ko";
  else if (/(^|[/_.-])(zh|cn|chinese|zh-hant|zh-hans)([/_.-]|$)|-c\.pdf$/.test(path)) language = "zh";
  else if (/(^|[/_.-])(de|german)([/_.-]|$)/.test(path)) language = "de";

  const reportLike = fileKind !== null && (REPORT_WORDS.test(hay) || /\bAR\b/.test(hay)) && reportType !== "other";
  let excluded: string | null = null;
  if (reportLike) {
    const notReport = NOT_A_REPORT.find(([re]) => re.test(hay));
    const company = opts.excludePatterns?.find((re) => re.test(hay));
    const country = COUNTRIES.find((c) => countryRe(c).test(hay) && !(opts.hqCountry && sameCountry(c, opts.hqCountry)));
    if (notReport) excluded = notReport[1];
    else if (company) excluded = "company exclusion rule (subsidiary, product line or other entity)";
    else if (country) excluded = `country report (${country.replace(/\\b/g, "")})`;
  }

  return {
    relevant: reportLike && excluded === null,
    reportType,
    year: y?.year ?? null,
    yearFromRange: y?.range ?? false,
    language,
    fileKind,
    excluded,
  };
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
