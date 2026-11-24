/**
 * Discovery tests run against a LOCAL test web server only (never real sites).
 */
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import http from "node:http";
import type { AddressInfo } from "node:net";
import { writeFileSync } from "node:fs";
import path from "node:path";
import { closePipelineDbs, pipelineDb } from "@/lib/pipeline/db";
import { claim, complete, fail } from "@/lib/pipeline/queue";
import { runJob } from "@/lib/pipeline/jobs";
import { runDiscovery, type DiscoveredRow } from "@/lib/discovery/discover";
import { classifyLink, extractLinks, titleForLink } from "@/lib/discovery/classify";
import { robotsFrom } from "@/lib/discovery/robots";
import { detectChallenge, PoliteHttp } from "@/lib/discovery/http";
import { onAllowedDomain } from "@/lib/discovery/config";
import { refilterDiscovered } from "@/lib/discovery/refilter";
import { seed } from "@/lib/db/seed";
import { tempDataDir } from "./helpers";
import { makeGhgPdf } from "./pdf-fixture";

// ---------------------------------------------------------------- local site

let server: http.Server;
let base: string;
const requested: string[] = [];
const site: { etag: string; pdf2026: Buffer; extraLink: string } = {
  etag: '"v1"',
  pdf2026: Buffer.alloc(0),
  extraLink: "",
};
let originalPdf: Buffer = Buffer.alloc(0);

beforeAll(async () => {
  originalPdf = await makeGhgPdf();
  site.pdf2026 = originalPdf;
  server = http.createServer((req, res) => {
    requested.push(`${req.method} ${req.url}`);
    const url = req.url ?? "/";
    if (url === "/robots.txt") {
      res.writeHead(200, { "content-type": "text/plain" });
      return res.end("User-agent: *\nDisallow: /private/\n");
    }
    if (url === "/sustainability/") {
      res.writeHead(200, { "content-type": "text/html" });
      return res.end(`<html><body>
        <a href="/reports/sustainability-report-2026.pdf">Sustainability Report 2026</a>
        <a href="/reports/jp/sustainability-report-2026_jp.pdf">サステナビリティレポート 2026</a>
        <a href="/reports/environmental-report-2019.pdf">Environmental Report 2019</a>
        <a href="/private/esg-report-2026.pdf">ESG report 2026 (private)</a>
        <a href="http://localhost:${(server.address() as AddressInfo).port}/reports/climate-report-2026.pdf">Climate report 2026 (other host)</a>
        <a href="/about/careers.pdf">Careers brochure</a>
        <a href="/sustainability/reports-archive">Report archive</a>
        ${site.extraLink}
      </body></html>`);
    }
    if (url === "/sustainability/reports-archive") {
      res.writeHead(200, { "content-type": "text/html" });
      return res.end(`<a href="/reports/esg-data-book-2025.pdf">ESG Data Book 2025</a>`);
    }
    if (url.startsWith("/blockedfiles/")) {
      res.writeHead(403, { "content-type": "text/html", "cf-mitigated": "challenge" });
      return res.end("<title>Just a moment...</title>");
    }
    if (url === "/blocked/") {
      res.writeHead(403, { "content-type": "text/html", "cf-mitigated": "challenge" });
      return res.end("<title>Just a moment...</title>");
    }
    if (url.endsWith(".pdf")) {
      const body = url.includes("sustainability-report-2026.pdf") ? site.pdf2026 : Buffer.from("%PDF-1.4\n% placeholder\n");
      res.writeHead(200, { "content-type": "application/pdf", "content-length": body.length, etag: site.etag });
      return res.end(req.method === "HEAD" ? undefined : body);
    }
    res.writeHead(404);
    res.end();
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", () => r()));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterAll(() => new Promise<void>((r) => server.close(() => r())));

let dir: string;
let cleanup: () => void;
const NOW = new Date("2026-11-24T08:00:00Z");
const noSleep = async () => {};

beforeEach(() => {
  const t = tempDataDir();
  dir = t.dir;
  cleanup = t.cleanup;
  requested.length = 0;
  site.etag = '"v1"';
  site.extraLink = "";
  site.pdf2026 = originalPdf; // tests must not leak fixture changes into each other
  writeFileSync(
    path.join(dir, "discovery.json"),
    JSON.stringify({
      $schemaVersion: 1,
      defaults: { maxAutoFetchPerRun: 3, autoFetchMinYearOffset: 1, maxPagesPerCompany: 10, hostIntervalMs: 250 },
      companies: { apple: { seedUrls: [`${base}/sustainability/`, `${base}/blocked/`], allowedDomains: ["127.0.0.1"], autoFetch: true } },
    }),
  );
  seed(dir);
});
afterEach(() => {
  closePipelineDbs();
  cleanup();
});

const run = () => runDiscovery(pipelineDb(dir), { dataDir: dir, trigger: "test", sleep: noSleep, now: () => NOW });
const rows = () => pipelineDb(dir).prepare("SELECT * FROM discovered_documents ORDER BY url").all() as DiscoveredRow[];
const byName = (name: string) => rows().find((r) => r.url.includes(name))!;
const alerts = () => pipelineDb(dir).prepare("SELECT kind, title, dedupe_key FROM alerts ORDER BY id").all() as { kind: string; title: string }[];

describe("discovery against a local site", () => {
  it("baseline run: classifies links, respects robots.txt, auto-fetches only eligible official reports", async () => {
    const s = await run();
    expect(s.pagesRead).toBe(2); // seed page + one same-site report archive page
    expect(byName("sustainability-report-2026.pdf")).toMatchObject({ status: "fetched", official: 1, language: "en", year: 2026 });
    expect(byName("esg-data-book-2025.pdf")).toMatchObject({ status: "fetched", report_type: "esg_data_book" });
    expect(byName("_jp.pdf")).toMatchObject({ status: "awaiting_fetch", language: "ja" });
    expect(byName("environmental-report-2019.pdf").status).toBe("awaiting_fetch"); // too old to auto-fetch
    expect(byName("climate-report-2026.pdf")).toMatchObject({ status: "awaiting_fetch", official: 0 }); // other host
    expect(byName("esg-report-2026.pdf")).toMatchObject({ status: "skipped", error: "disallowed by robots.txt" });
    expect(rows().some((r) => r.url.includes("careers"))).toBe(false); // not a report
    // robots.txt: the disallowed file was never requested.
    expect(requested.some((r) => r.includes("/private/"))).toBe(false);
    // Baseline: no "new report" flood; the bot-protected page is recorded as a blocker.
    expect(alerts().map((a) => a.kind)).toEqual(["blocked"]);
    expect(s.blocked[0]).toMatch(/Cloudflare challenge/);
    // Fetched files entered the extraction pipeline.
    expect((pipelineDb(dir).prepare("SELECT count(*) n FROM documents").get() as { n: number }).n).toBe(2);
  });

  it("second run: alerts on new and changed reports, re-fetches the changed file, and does not repeat open alerts", async () => {
    await run();
    site.extraLink = `<a href="/reports/sustainability-report-2027.pdf">Sustainability Report 2027</a>`;
    site.etag = '"v2"';
    site.pdf2026 = await makeGhgPdf({ scope1: ["51,000", "53,300", "56,400"] });
    await run();
    const kinds = alerts().map((a) => a.kind);
    expect(kinds).toContain("new_report");
    expect(kinds.filter((k) => k === "changed_report").length).toBeGreaterThanOrEqual(1);
    expect(kinds.filter((k) => k === "blocked")).toHaveLength(1); // deduplicated while open
    expect(byName("sustainability-report-2027.pdf").status).toBe("fetched");
    expect(byName("sustainability-report-2026.pdf").last_changed).not.toBeNull();
  });

  it("raises a restatement alert when a fetched report disagrees with a curated value", async () => {
    await run();
    const db = pipelineDb(dir);
    for (let i = 0; i < 20; i++) {
      const job = claim(db, "test");
      if (!job) break;
      try {
        await runJob(db, dir, job);
        complete(db, job.id);
      } catch (e) {
        fail(db, { ...job, attempts: job.max_attempts }, (e as Error).message); // the placeholder data book is not a valid PDF
      }
    }
    const restatements = alerts().filter((a) => a.kind === "restatement");
    // The fixture reports Apple Scope 1 FY2025 as 55,900 tCO2e; the curated value is 55,200.
    expect(restatements.some((a) => /ghg_scope1 2025 is 55,900 tCO2e/.test(a.title))).toBe(true);
  });
});

describe("discovery filtering (lessons from the first real run)", () => {
  const config = (companies: Record<string, unknown>) =>
    writeFileSync(
      path.join(dir, "discovery.json"),
      JSON.stringify({ $schemaVersion: 1, defaults: { maxAutoFetchPerRun: 3, autoFetchMinYearOffset: 1, maxPagesPerCompany: 10, hostIntervalMs: 250 }, companies }),
    );

  it("refilter: re-applies new rules to queued links, removes only pending proposals, and audits every change", async () => {
    await run(); // old rules: the 2026 report is fetched
    const db = pipelineDb(dir);
    const doc = byName("sustainability-report-2026.pdf").document_id!;
    const insert = db.prepare(
      `INSERT INTO extractions (document_id, company_id, metric_id, year, value, unit, page_number, page_label, reported_wording, boundary, consolidation, method, confidence, evidence_status, status, created_at)
       VALUES (?, 'apple', 'ghg_scope1', 2025, ?, 'tCO2e', 1, 'PDF p.1', 'Scope 1', 'not_stated', 'not_stated', 'rule', 0.8, 'verified', ?, '2026-11-24T08:00:00Z')`,
    );
    insert.run(doc, 1, "pending");
    insert.run(doc, 2, "approved");
    // New rule: that report belongs to another entity.
    config({ apple: { seedUrls: [`${base}/sustainability/`], allowedDomains: ["127.0.0.1"], autoFetch: true, excludePatterns: ["sustainability-report-2026"] } });

    const dry = refilterDiscovered(db, dir, { apply: false, now: NOW });
    const c = dry.find((x) => x.url.includes("sustainability-report-2026.pdf"))!;
    expect(c).toMatchObject({ status: { from: "fetched", to: "skipped" }, proposalsRemoved: 1 });
    expect(byName("sustainability-report-2026.pdf").status).toBe("fetched"); // dry run changes nothing

    refilterDiscovered(db, dir, { apply: true, now: NOW });
    expect(byName("sustainability-report-2026.pdf")).toMatchObject({ status: "skipped", error: expect.stringMatching(/company exclusion rule/) });
    expect(db.prepare("SELECT status FROM extractions WHERE document_id = ? ORDER BY value").all(doc)).toEqual([{ status: "approved" }]);
    expect((db.prepare("SELECT count(*) n FROM audit_log WHERE action = 'refilter_discovered'").get() as { n: number }).n).toBeGreaterThanOrEqual(1);
    expect(refilterDiscovered(db, dir, { apply: false, now: NOW }).filter((x) => x.status)).toEqual([]); // idempotent
  });

  it("leaves out product sheets and country reports, titles generic links from the file name, and notes unreadable seed pages", async () => {
    site.extraLink = `
      <a href="/environment/pdf/products/iPhone_Duo_PER_Sept2026.pdf">View (PDF)</a>
      <a href="/reports/sustainability-report-2026-peru.pdf">Sustainability Report 2026 Peru</a>
      <a href="/reports/Apple_Environmental_Progress_Report_2025.pdf">View (PDF)</a>`;
    config({ apple: { seedUrls: [`${base}/sustainability/`, `${base}/missing-page/`], allowedDomains: ["127.0.0.1"], autoFetch: true } });
    const s = await run();
    expect(rows().some((r) => r.url.includes("_PER_"))).toBe(false);
    expect(rows().some((r) => r.url.includes("peru"))).toBe(false);
    expect(byName("Apple_Environmental_Progress_Report_2025.pdf").title).toBe("Apple Environmental Progress Report 2025");
    expect(s.notes.join("\n")).toMatch(/1 link left out: country report \(Peru\)/);
    expect(s.notes.join("\n")).toMatch(/seed page not read: .*missing-page.*HTTP 404/);
  });

  it("applies company exclusion rules (a listed subsidiary is not the group)", async () => {
    site.extraLink = `<a href="/reports/Sustainability-at-Siemens-Limited-2026.pdf">Learn more</a><a href="/reports/Siemens-2026-BRSR.pdf">BRSR</a>`;
    config({ apple: { seedUrls: [`${base}/sustainability/`], allowedDomains: ["127.0.0.1"], autoFetch: true, excludePatterns: ["siemens[ _-]?limited", "\\bBRSR\\b"] } });
    const s = await run();
    expect(rows().some((r) => /Siemens/.test(r.url))).toBe(false);
    expect(s.notes.join()).toMatch(/2 links left out: company exclusion rule/);
  });

  it("raises one blocked alert per host when report files are refused", async () => {
    site.extraLink = `<a href="/blockedfiles/sustainability-report-2025.pdf">Sustainability Report 2025</a><a href="/blockedfiles/esg-data-book-2024.pdf">ESG Data Book 2024</a>`;
    config({ apple: { seedUrls: [`${base}/sustainability/`], allowedDomains: ["127.0.0.1"], autoFetch: true } });
    const s = await run();
    expect(byName("blockedfiles/sustainability-report-2025.pdf").status).toBe("blocked");
    expect(alerts().filter((a) => a.kind === "blocked")).toHaveLength(1);
    expect(s.blocked).toHaveLength(1);
    expect(s.blocked[0]).toMatch(/report files \(Cloudflare challenge/);
  });
});

describe("polite HTTP behaviour", () => {
  it("follows robots.txt redirects (RFC 9309) and treats a final 404 as no restrictions", async () => {
    const h = new PoliteHttp(pipelineDb(dir), {
      hostIntervalMs: 250,
      sleep: noSleep,
      fetchImpl: async (u) => {
        if (u === "https://site.test/robots.txt") return new Response(null, { status: 301, headers: { location: "https://site.test/robots.txt/" } });
        if (u === "https://site.test/robots.txt/") return new Response("<html>not found</html>", { status: 404 });
        if (u === "https://loop.test/robots.txt") return new Response(null, { status: 302, headers: { location: "https://loop.test/robots.txt" } });
        return new Response("ok", { status: 200 });
      },
    });
    expect((await h.request("https://site.test/sustainability/", { maxBytes: 1000 })).ok).toBe(true);
    // A redirect loop never yields a robots file: treated as unreachable, so nothing is fetched.
    expect((await h.request("https://loop.test/page", { maxBytes: 1000 })).error).toBe("disallowed by robots.txt");
  });

  it("spaces requests to the same host", async () => {
    let clock = 0;
    const waits: number[] = [];
    const h = new PoliteHttp(pipelineDb(dir), {
      hostIntervalMs: 2000,
      now: () => clock,
      sleep: async (ms) => {
        waits.push(ms);
        clock += ms;
      },
      fetchImpl: async () => new Response("ok", { status: 200 }),
    });
    await h.request("https://example.test/a", { maxBytes: 1000 });
    await h.request("https://example.test/b", { maxBytes: 1000 });
    // robots.txt, /a, /b: the 2nd and 3rd requests waited for the host interval.
    expect(waits).toEqual([2000, 2000]);
  });

  it("refuses oversized responses and recognises bot protection", async () => {
    const h = new PoliteHttp(pipelineDb(dir), {
      hostIntervalMs: 250,
      sleep: noSleep,
      fetchImpl: async (u) =>
        u.endsWith("robots.txt") ? new Response("", { status: 404 }) : new Response("x".repeat(5000), { status: 200, headers: { "content-length": "5000" } }),
    });
    expect((await h.request("https://example.test/big.pdf", { maxBytes: 1000 })).error).toMatch(/larger than/);
    expect(detectChallenge(403, new Headers({ "cf-mitigated": "challenge" }), "")).toMatch(/Cloudflare/);
    expect(detectChallenge(503, new Headers(), "<title>Just a moment...</title>")).toMatch(/bot protection/);
    expect(detectChallenge(404, new Headers(), "not found")).toBeNull();
  });

  it("checks SEC filings against the expected company name and needs a user-set User-Agent", async () => {
    writeFileSync(
      path.join(dir, "discovery.json"),
      JSON.stringify({
        $schemaVersion: 1,
        defaults: { maxAutoFetchPerRun: 3, autoFetchMinYearOffset: 1, maxPagesPerCompany: 2, hostIntervalMs: 250 },
        companies: { apple: { seedUrls: [`${base}/robots.txt`], allowedDomains: ["127.0.0.1"], autoFetch: false, sec: { cik: "0000320193", nameIncludes: "APPLE" } } },
      }),
    );
    const noUa = await runDiscovery(pipelineDb(dir), { dataDir: dir, trigger: "test", sleep: noSleep, now: () => NOW });
    expect(noUa.notes.join()).toMatch(/SEC_USER_AGENT/);

    const sec = {
      name: "Apple Inc.",
      filings: { recent: { form: ["8-K", "10-K"], accessionNumber: ["0000320193-26-000001", "0000320193-25-000079"], primaryDocument: ["x.htm", "aapl-20250927.htm"], filingDate: ["2026-01-01", "2025-10-31"], reportDate: ["", "2025-09-27"] } },
    };
    const seen: string[] = [];
    const fake = async (u: string) => {
      seen.push(u);
      if (u.endsWith("robots.txt")) return new Response("", { status: 404 });
      if (u.includes("data.sec.gov")) return new Response(JSON.stringify(sec), { status: 200 });
      return new Response(null, { status: 200, headers: { "content-type": "text/html" } });
    };
    await runDiscovery(pipelineDb(dir), { dataDir: dir, trigger: "test", sleep: noSleep, now: () => NOW, fetchImpl: fake, secUserAgent: "Test Org admin@example.org" });
    const filing = rows().find((r) => r.origin === "sec")!;
    expect(filing).toMatchObject({ report_type: "regulatory_filing", year: 2025, official: 0, status: "awaiting_fetch" });
    expect(filing.url).toBe("https://www.sec.gov/Archives/edgar/data/320193/000032019325000079/aapl-20250927.htm");

    sec.name = "SOMEONE ELSE INC";
    const wrong = await runDiscovery(pipelineDb(dir), { dataDir: dir, trigger: "test", sleep: noSleep, now: () => NOW, fetchImpl: fake, secUserAgent: "x" });
    expect(wrong.notes.join()).toMatch(/belongs to "SOMEONE ELSE INC"/);
  });
});

describe("parsing helpers", () => {
  it("extracts absolute links and decodes entities", () => {
    const links = extractLinks(`<a href="/a.pdf?x=1&amp;y=2#top">Report <b>2026</b></a><a href="mailto:x@y">m</a>`, "https://site.test/dir/");
    expect(links).toEqual([{ url: "https://site.test/a.pdf?x=1&y=2", text: "Report 2026" }]);
  });
  it("classifies report type, year and language", () => {
    expect(classifyLink("https://x.test/sdb26_en.pdf", "Sustainability Data Book 2026", 2026)).toMatchObject({ relevant: true, reportType: "esg_data_book", year: 2026, language: "en" });
    expect(classifyLink("https://x.test/BRSR202526.pdf", "BRSR", 2026)).toMatchObject({ relevant: true, reportType: "regulatory_filing" });
    expect(classifyLink("https://x.test/2025-TSMC-Sustainability-Report-c.pdf", "", 2026).language).toBe("zh");
    expect(classifyLink("https://x.test/menu.pdf", "Canteen menu", 2026).relevant).toBe(false);
  });
  it("ignores folder names, reads fiscal ranges, and leaves out non-reports", () => {
    // Microsoft keeps every document under /CSR/: the folder name must not make a report.
    expect(classifyLink("https://x.test/documents/CSR/Microsoft-Digital-Defense-Report-2025.pdf", "2025 Microsoft Digital Defense Report", 2026).relevant).toBe(false);
    expect(classifyLink("https://x.test/CSR/Microsoft-RY2025-Conflict-Minerals-Report.pdf", "2025 Conflict Minerals Report", 2026).relevant).toBe(false);
    expect(classifyLink("https://x.test/Responsible-Minerals-Sustainability-Report-2025.pdf", "", 2026).excluded).toBe("minerals sourcing report");
    expect(classifyLink("https://x.test/CSR/Microsoft-ISO50001-Certification-Redmond-ED2026.pdf", "ISO50001 Certification - Redmond", 2026).relevant).toBe(false);
    expect(classifyLink("https://x.test/a/Emissions-per-employee-2025.pdf", "Climate report 2025", 2026).relevant).toBe(true); // "per" is not "PER"
    expect(classifyLink("https://x.test/CSR/Microsoft-2026-CDP-Response.pdf", "CDP Response", 2026)).toMatchObject({ relevant: true, reportType: "sustainability_report", year: 2026 });
    // Upload-folder dates are not report years; ranges give the end year.
    const ar = classifyLink("https://x.test/files/2022-08/RIL-AR-2021.pdf", "Annual Report for the year 2020-2021", 2026);
    expect(ar).toMatchObject({ relevant: true, reportType: "annual_report", year: 2021, yearFromRange: true });
    expect(classifyLink("https://x.test/files/reports/CSR202526.pdf", "", 2026)).toMatchObject({ year: 2026, yearFromRange: true });
    expect(classifyLink("https://x.test/Apple_Environmental_Progress_Report_2026.pdf", "View (PDF)", 2026)).toMatchObject({ year: 2026, yearFromRange: false });
    // Country reports are left out unless the country is the company's home country.
    expect(classifyLink("https://x.test/Microsoft-Impact-Report-Spain-2023.pdf", "Learn more", 2026, { hqCountry: "United States" }).excluded).toBe("country report (Spain)");
    expect(classifyLink("https://x.test/RIL-India-Sustainability-Report-2026.pdf", "", 2026, { hqCountry: "India" }).relevant).toBe(true);
    expect(classifyLink("https://x.test/Samsung-Korea-Sustainability-Report-2026.pdf", "", 2026, { hqCountry: "South Korea" }).relevant).toBe(true);
  });
  it("titles links from their text only when the text describes the report", () => {
    expect(titleForLink("https://x.test/2025-TSMC-Climate-and-Nature-Report-e.pdf", "Download Report")).toBe("2025 TSMC Climate and Nature Report e");
    expect(titleForLink("https://x.test/RIL-Integrated-Annual-Report-2025-26.pdf", "Learn more")).toBe("RIL Integrated Annual Report 2025-26");
    expect(titleForLink("https://x.test/a.pdf", "Download 2025 Sustainability Report")).toBe("2025 Sustainability Report");
    expect(titleForLink("https://x.test/a.pdf", "Annual Report for the year 2025-2026")).toBe("Annual Report for the year 2025-2026");
    expect(titleForLink("https://x.test/Samsung_Electronics_Sustainability_Report_2026_ENG.pdf", "Samsung_Electronics_Sustainability_Report_2026_ENG.pdf")).toBe(
      "Samsung Electronics Sustainability Report 2026 ENG",
    );
  });
  it("evaluates robots.txt groups and wildcards", () => {
    const r = robotsFrom("User-agent: *\nDisallow: /a/\nAllow: /a/public\nDisallow: /*.xlsx$\n\nUser-agent: CorporateSustainabilityIntelligence\nDisallow: /bot-only/", 200, "CorporateSustainabilityIntelligence/0.4");
    expect(r.isAllowed("/bot-only/x")).toBe(false);
    expect(r.isAllowed("/a/secret")).toBe(true); // specific group replaces "*"
    const star = robotsFrom("User-agent: *\nDisallow: /a/\nAllow: /a/public\nDisallow: /*.xlsx$", 200, "OtherBot");
    expect(star.isAllowed("/a/secret")).toBe(false);
    expect(star.isAllowed("/a/public/report.pdf")).toBe(true);
    expect(star.isAllowed("/data/file.xlsx")).toBe(false);
    expect(robotsFrom(null, 404, "x").isAllowed("/anything")).toBe(true);
    expect(robotsFrom(null, 503, "x").isAllowed("/anything")).toBe(false);
  });
  it("matches allowed domains including subdomains, not look-alikes", () => {
    expect(onAllowedDomain("cdn-dynmedia-1.microsoft.com", ["microsoft.com"])).toBe(true);
    expect(onAllowedDomain("microsoft.com.evil.test", ["microsoft.com"])).toBe(false);
    expect(onAllowedDomain("notmicrosoft.com", ["microsoft.com"])).toBe(false);
  });
});
