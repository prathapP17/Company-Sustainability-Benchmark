# Methodology

How the benchmark turns company disclosures into the values, scores and signals on the site. The public
`/methodology` page shows the same rules; constants named here live in the code paths given.

## Data rules (from the project brief)

1. **Every number traces to a source** document and page (or sheet cell, or URL section). Ambiguous values (unit,
   boundary, year, method) are not recorded; they become data gaps.
2. **Missing is not zero.** Each value has a state: *Disclosed*, *Not disclosed* (the company explicitly omits it),
   *Not found* (researched in full, absent) or *Not assessed* (not researched enough to say).
3. **Comparability context on every value:** boundary, consolidation approach, Scope 2 method, assurance level and
   provider, verification class, and whether it is reported or derived (derived = simple arithmetic, method in the
   note).
4. **Never add or compare values across boundaries or methods**; they are shown side by side with a warning.
5. **Subsidiary data never stands in for the group** (discovery also excludes listed subsidiaries' reports).
6. **Evidence-gated approval:** an extracted value can be approved only if its wording and number are found again on
   the stored page text or spreadsheet cell; exceptions need a reason and an approver.
7. **Automated sources are proposals.** Discovered reports and extracted values wait for review; search excerpts and
   secondary sources are low confidence. One recorded exception: AI summaries (below).
8. **Restatements are explicit**, with the previous value kept in the history and an audit entry.

## Fiscal years

Values carry the company's own fiscal-year label and its convention: `end_year` (the label is the year in which the
fiscal year ends; most companies) or `start_year` (Toyota: FY2025 = April 2025 to March 2026). Labels are shown with
the period end, e.g. "FY2025 (to Mar 2026)". Units are converted only with exact factors (`src/lib/metrics/dictionary.ts`).

## Scores (`src/lib/scoring/`)

Scores are computed only above a coverage threshold, and only from values that are comparable (consolidated group,
no partial-coverage note, not low confidence, no trend break).

- **Coverage:** the share of a company's core metrics (for its peer group) that are assessed in its latest year.
  Threshold `COVERAGE_THRESHOLD` = 80%.
- **Transparency score:** an 18-item checklist (disclosure, depth, assurance and boundary, targets, industry
  metrics). Shown only above the coverage threshold.
- **Performance score:** five indicators, each mapped to 0–100, averaged over those available; shown only when at
  least `MIN_INDICATORS` = 3 can be scored:
  - progress against the company's own GHG targets versus a straight-line path;
  - year-on-year change in Scope 1+2 (market-based): −4.2% or better → 100, 0% → 50, +10% or worse → 0, linear
    between (4.2% is the 1.5 °C linear pathway rate);
  - renewable electricity share; waste diverted from disposal; year-on-year change in water withdrawal.
- **Peer median:** only with at least `MIN_PEERS_FOR_MEDIAN` = 3 comparable values in one unit.

## Targets

- **Progress** against a target is compared with a straight line from base year to target year, only when the
  company reports progress in the target's own unit.
- **Pace check** (`src/lib/scoring/ambition.ts`): for absolute emissions targets stated as a % cut from a base year,
  the implied linear yearly reduction is compared with SBTi's near-term minimums: 4.2%/yr (1.5 °C) and 2.5%/yr
  (well-below 2 °C). Intensity and net-zero targets are "not assessable". This checks pace only, not coverage,
  base-year recency or time frame.
- **SBTi status** comes from SBTi's public Target Dashboard download, cited with its data date and file checksum.
  Each company is pinned to one SBTi record (`data/sbti-matches.json`, name and ISIN/LEI checked).

## Scope 3 and industry views

The heatmap shows each Scope 3 category's disclosure state in the latest year. A category's share of the company's own
Scope 3 total is derived and shown only when year and boundary match; shares are not compared across companies.
Industry KPIs (SASB/ISSB) are compared only within the peer group they apply to.

## Extraction and review

- **Rule-based extractor** (`src/lib/pipeline/extract/rules.ts`): labelled table rows, year-column headers, units, and
  context (boundary, consolidation). Ratios, renewable/non-renewable subtotals and combined Scope 1+2 rows are never
  read as totals; rows whose cells cannot be matched to year columns are skipped.
- **Claude extractor** (optional, `ANTHROPIC_API_KEY`): same output, same evidence gate and review.
- **OCR:** image-only PDF pages are read with Tesseract (at most 30 per document), labelled "(OCR)", given lower
  confidence, and reviewers are told to check values against the page image.
- Measured accuracy: see [EVALUATION.md](EVALUATION.md).

## Discovery and news

- Weekly discovery reads each company's official pages (robots.txt respected, 2 s per site), keeps reports by file
  name and link text, and leaves out product sheets, policies, certificates, legal statements, other countries' and
  subsidiaries' reports. Recent official English reports (at most 3 per company per run) are fetched automatically;
  everything else waits for a reviewer.
- News signals come from the GDELT index (headlines and links only), are shown only after a reviewer approves each
  with a note, and never affect values or scores.

## AI summaries (decision of 2026-11-25)

Claude writes 3–6 sentences from a company's curated facts only, citing a fact for every sentence. As an agreed
exception to rule 7, summaries are published without human review, labelled "Written by AI", but only if an automatic
check passes: every number appears in a cited fact, and comparisons, rankings, judgements, forecasts and spelled-out
quantities are refused. A summary is hidden as soon as the company's data changes.
