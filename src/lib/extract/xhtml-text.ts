/**
 * Converts an ESEF/iXBRL XHTML annual report to plain text with page markers.
 * ESEF reports render each printed page as a block whose class or id names
 * the page; we fall back to CSS `page-break` markers. Each page gets a
 * "=== XHTML page N ===" marker so values can cite a page in the filing.
 */
const ENTITIES: Record<string, string> = {
  "&amp;": "&",
  "&lt;": "<",
  "&gt;": ">",
  "&quot;": '"',
  "&apos;": "'",
  "&nbsp;": " ",
  "&#160;": " ",
};

function decode(s: string): string {
  return s
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
    .replace(/&[a-z]+;|&#160;/gi, (m) => ENTITIES[m] ?? m);
}

export interface XhtmlPage {
  pageNumber: number;
  text: string;
}

/** Splits an ESEF/iXBRL report into pages of plain text (1-based, skipping near-empty pages). */
export function xhtmlPages(xhtml: string): XhtmlPage[] {
  // Drop head, scripts, styles and hidden iXBRL header data.
  let body = xhtml
    .replace(/<head[\s\S]*?<\/head>/i, "")
    .replace(/<ix:header[\s\S]*?<\/ix:header>/gi, "")
    .replace(/<(script|style)[\s\S]*?<\/\1>/gi, "");

  // Mark page boundaries before stripping tags.
  const PAGE = "\u0000PAGE\u0000";
  // Seen in the wild: class="page", class="pageView" (Workiva-style ESEF),
  // and inline CSS page breaks.
  body = body.replace(
    /<div[^>]*(page-break-(before|after)|class="[^"]*\b(page|pageView)\b[^"]*")[^>]*>/gi,
    (m) => PAGE + m,
  );

  // Table cells often wrap their text in <p>/<div>: keep each cell, and so each table row, on one line.
  body = body.replace(/<t([dh])\b([^>]*)>([\s\S]*?)<\/t\1>/gi, (_m, k: string, attrs: string, inner: string) => `<t${k}${attrs}>${inner.replace(/<(br|\/p|\/div|\/li|\/h\d)[^>]*>/gi, " ")}</t${k}>`);

  const text = decode(
    body
      .replace(/<(br|\/p|\/div|\/tr|\/h\d|\/li)[^>]*>/gi, "\n")
      .replace(/<\/t[dh]>/gi, " | ")
      .replace(/<[^>]+>/g, ""),
  );

  return text
    .split(PAGE)
    .map((p, i) => ({
      pageNumber: i,
      text: p
        .split("\n")
        .map((l) => l.replace(/[ \t]+/g, " ").trim())
        .filter((l) => l && l !== "|")
        .join("\n"),
    }))
    .filter((p) => p.text.length > 25);
}

export function xhtmlToMarkedText(xhtml: string): string {
  return xhtmlPages(xhtml)
    .map((p) => `\n=== XHTML page ${p.pageNumber} ===\n${p.text}`)
    .join("\n");
}
