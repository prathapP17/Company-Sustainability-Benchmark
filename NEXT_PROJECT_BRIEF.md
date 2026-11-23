# Project brief: Corporate Sustainability Intelligence (template from "Holding Company Sustainability Benchmark")

Read this whole file before writing any code. It describes how the previous project was built, the rules that made it trustworthy, and how the new project should differ. Ask me before deviating from the rules in sections 2 and 7.

## 1. What we are building
A web platform that benchmarks the sustainability disclosures of large **operating companies** (e.g. Apple, Reliance Industries, Sony, Samsung Electronics, Toyota, Nestlé, Microsoft, Unilever, TSMC, Siemens), with:
- **Public dashboards:** company profiles, comparisons, peer/sector benchmarks, targets and progress, transparency checklist, rankings, downloads.
- **Automation (new):** the system finds sources on its own (company sustainability pages, reports, ESG data books, CDP/regulatory filings such as BRSR, 10-K, CSRD/ESRS, SSBJ, HKEX) **and** analyses documents the user uploads. Extracted values flow into a review queue, then into the dashboards.
- **More features than before** (to be specified as we go). Build in phases (section 8); confirm the scope of each phase with me first.

The predecessor targeted holding companies. The key differences:
- Operating companies have **sector-specific metrics.** Use SASB/ISSB industry metrics: e.g. product energy use for electronics, refinery emissions intensity for oil and gas, water in semiconductor fabs.
- **Scope 3 categories** matter more than portfolio emissions (Category 15).
- **Peer groups are by industry,** not holding-company type.

## 2. Non-negotiable rules (carried over)
1. **Never fabricate data.** Every number must trace to a source document + page/cell (or URL + section). If a value is ambiguous (unit, boundary, year, method), do not record it; log it as a data gap instead.
2. **Missing is not zero.** Use distinct states:
   - **Disclosed:** evidence found in the sources reviewed.
   - **Not disclosed:** the company explicitly omits it.
   - **Not found:** researched in full, but absent.
   - **Not assessed:** not researched enough to conclude.
   Scores are only calculated above a coverage threshold.
3. **Store comparability context on every value:**
   - **boundary:** consolidated group, parent only, subsidiary only, or not stated;
   - **consolidation:** operational control, financial control, equity share, or not stated;
   - **Scope 2 method:** market or location;
   - **assurance:** none, limited or reasonable, plus provider;
   - **verification class:** primary document, official webpage, provider website, secondary source, or search excerpt;
   - **status:** reported or derived (simple arithmetic, method written in the note).
4. **Never add or compare values on different boundaries or methods;** show them side by side with a warning.
5. **Subsidiary data never stands in for the group** in checklists, scores or history.
6. **Evidence-gated approval:** an extracted value can only be approved if it is found again in the stored page text or spreadsheet cell. If the check fails, the value stays blocked; exceptions need a reason and an approver name.
7. **Automated sources are proposals, not facts.**
   - Auto-discovered documents go to the review queue.
   - Search-engine snippets and third-party aggregators are flagged as low-confidence and never auto-approved.
8. **Restatements and conflicts** are detected and resolved explicitly, never silently overwritten. Keep the full history and an audit trail.
9. **Data safety:**
   - Schema changes are additive only.
   - Back up before migrations.
   - Never reset the database.
   - Tests use a temporary data directory, never the real database.

## 3. Recommended stack (worked well last time)
- **App:**
  - Next.js (App Router), React, TypeScript and Tailwind.
  - Recharts for charts.
  - Check `node_modules/next/dist/docs/` before coding, because the APIs change between versions.
- **Data:** curated company files in `data/companies/<id>.json`, validated with zod, then seeded into SQLite (better-sqlite3, WAL mode) at build time. Pipeline state (uploads, extractions, approvals, users, audit) lives in a separate SQLite database.
- **Extraction:**
  - pdfjs-dist for text with page markers, OCR fallback for scanned pages, and xlsx parsing for spreadsheets.
  - A metric dictionary with synonyms, including non-English ones such as Japanese and Korean.
  - Unit and boundary detection.
  - Optional AI extraction with Claude through the official Anthropic SDK, with structured output. Its results are always validated against the source text.
- **Background worker:** separate process with a job queue, time-outs, stuck-job recovery and a memory guard. Use macOS `vm_stat` or Linux `MemAvailable`, not `os.freemem`.
- **Tests:** vitest for unit tests, playwright-core for end-to-end tests, plus an extraction evaluation set of real reports with expected values (recall, precision, boundary accuracy).
- **Exports:** CSV, XLSX and PDF management reports, all carrying provenance and with internal notes stripped.

## 4. Data model (per company file)
- **Profile:** id, name, legal name, ticker/listing, HQ (city, country, lat/lon), region, industry (GICS/SASB), peer group, fiscal year end and label convention, website, sustainability page.
- **sources[]:** id, organisation, title, type, URL, accessed date, reporting year, notes.
- **reports[]:** year, type, assurance provider, level and scope.
- **metrics[]:** metric id, year, value or text, unit, plus every context field from rule 3; page, reported wording, note.
- **targets[]:**
  - category, type (absolute, intensity, increase-to, net-zero, qualitative);
  - baseline year and value, target year and value, latest year and value;
  - validation (SBTi validated or self-declared).
- **Other lists:** frameworks[] (GRI, ISSB/IFRS S2, TCFD, ESRS, SASB, CDP), ratings[], indices[], initiatives[], narratives[], dataGaps[], comparabilityNotes[].
- **researchStatus:** "detailed" means every checklist item was reviewed; "partial" means the main sources were unreadable or blocked.
- **defaults{}:** boundary, consolidation, source, and so on, so individual entries stay short. When adding a new source, pin older entries to their own source before changing the defaults.

## 5. Procedures
**Researching a company manually:**
1. Find the latest sustainability or integrated report and any ESG data file. Prefer the company's own site and regulators' filing systems:
   - SEC EDGAR, India BRSR on NSE, HKEXnews, EDINET, KAP, and the EU registries.
2. Download only with my approval. Save to a scratch folder, extract the text with page markers, search for terms, read only the relevant pages, then delete the files.
3. Record values with printed page numbers (or "PDF p.N"), the boundary, method, consolidation and assurance.
4. Run the data validation, the tests and a transparency or score check for that company.

**Automated source discovery (new):**
1. Search per company (official domains first).
2. Classify each document (report type, year, language).
3. Check for duplicates by hash.
4. Queue the document for extraction.
5. Rank confidence by source class.
6. Respect robots.txt, rate limits and site terms. Never bypass CAPTCHAs or bot protection. If a site blocks access, record it as a blocker and ask me for the file.

**Changing code:**
- Add a test for every critical fix.
- Run type-check, lint, unit tests, build and end-to-end tests before reporting done.
- Take screenshots at phone, tablet and desktop widths for UI changes.

## 6. Lessons learned (avoid these)
- **Chart labels:** compute label widths from the actual text; never use a fixed height; put screen-reader tables inside a wrapper with a width; switch vertical bars to horizontal on narrow screens.
- **Next.js:** layouts don't re-render on client navigation, so check access on each page or route on the server. Don't create components during render (move them to module level).
- **Server actions:** a double redirect causes reload loops.
- **Spreadsheets:** cite cells as "Sheet!E12". Comma-formatted numbers can split across cells.
- **Fiscal years:** label them carefully. India FY2025 ends in March 2025; Japan FY2025 starts in April 2025.
- **Blocked sites:** Imperva, Cloudflare and S3 403s. Use the official links on the company's own pages, the regulators' copies, or ask me.
- **Two-boundary companies:** store each boundary separately (e.g. standalone vs consolidated, equity share vs financial control).

## 7. Working conventions with me
- Commit only when I say **"push"** (then commit and push to GitHub). Say **"pull"** to pull. Never commit secrets.
- Ask before downloading files, creating accounts, or anything public-facing.
- **Hosting (free option):** a Mac script serves a production build through a Cloudflare quick tunnel. The address changes on every restart and is written to `data/public-url.txt`. Paid or permanent hosting comes later.
- **Roles:** guest (public dashboards) < viewer (exports and reports) < reviewer (uploads and review) < admin (users, audit and settings). Guests can browse; account requests need admin approval.
- Report honestly: say what was not verified, what failed, and what was skipped.

## 8. Suggested phases
1. **Scaffold:** schema, about 10 seed companies across 4–5 industries, validation, a basic dashboard and a company page.
2. **Dashboards:** comparisons, peer benchmarks, targets and progress, transparency checklist, scoring with coverage thresholds, exports.
3. **Upload and extraction pipeline:** queue, worker, evidence-gated review, conflict detection, audit.
4. **Automated source discovery** and scheduled refresh, with change detection and restatement alerts.
5. **Accounts and roles,** guest access, security hardening, hosting.
6. **Extra features:** to be defined. Possible ideas: industry-specific KPIs, Scope 3 category heatmaps, target-ambition checks against SBTi, controversy and news signals (flagged as secondary), and AI-generated summaries with citations.
7. **Evaluation and hardening:** extraction evaluation set, performance budgets, end-to-end tests, documentation (METHODOLOGY, DATA_MODEL, DEPLOYMENT).

Start by confirming the company list, industries, and the phase 1 scope with me.
