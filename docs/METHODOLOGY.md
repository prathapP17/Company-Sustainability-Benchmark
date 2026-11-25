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

## Industry classification (`src/lib/industry.ts`)

Two separate things:

- **Peer groups** (`data/peer-groups.json`) are broad groups for navigation. They can hold several real industries:
  Toyota (Automobiles) and Siemens (Industrial Machinery & Goods; Electrical & Electronic Equipment) share
  "Autos & industrials"; Nestlé (Processed Foods) and Unilever (Household & Personal Products) share "Consumer
  staples".
- **SASB industry codes** (`profile.industry.sasbCodes` in each company file, e.g. `["TR-AU"]`) are the analytical
  key. They come from the SASB names already recorded in each file; the validator checks that every code is a known
  SASB industry and appears in the file's own SASB text. They decide which industry metrics apply (the dictionary's
  `appliesTo` lists SASB codes), who is a peer, and peer ranks.
- A company listing two SASB industries without a confirmed `primarySasb` (Samsung: TC-HW and TC-SC; Siemens: RT-IG and
  RT-EE) is flagged **"classification needs review"**. Industry metrics of both industries apply to it, and it is shown
  beside both industries, but it is kept out of medians and peer ranks until a reviewer sets `primarySasb`. Nothing is
  guessed.
- Correction made in this pass: Siemens' "Electrical & Electronic Equipment" was recorded as `RR-EE`; the SASB code is
  `RT-EE` (Resource Transformation sector).

## Comparability (`src/lib/scoring/comparability.ts`)

One engine decides comparability for every use: the comparison table and chart, peer medians, performance indicators,
peer ranks, the map's flags, and the `cross_company_use` column of the exports. A page shows the status this engine
returns; a number calculated from a set (a median) comes from the same decision.

| Question | Function | Rules |
| --- | --- | --- |
| Can a value enter any cross-company calculation? | `valueIssues` / `rankable` | consolidated-group boundary; no partial-coverage note; not a low-confidence source (search excerpt or secondary source); unit convertible to the canonical unit; Scope 2 method matches the metric |
| Can values be shown side by side, and with which warning? | `compareSet` | **not comparable**: mixed boundaries, partial coverage, different Scope 2 methods or units. **Caution**: consolidation approaches differ or are not stated, reporting periods end in different years or months, low-confidence sources, companies not in one confirmed industry |
| Which values enter a peer median? | `benchmarkSet` | each value usable (above), company's confirmed primary SASB industry is the benchmark industry, consolidation approach stated; then the largest group sharing one unit, one reporting-period end year and one consolidation approach. Every value left out is returned with its reason. |
| Can two years of one company be compared? | `sameBasis` | both usable; same consolidation approach, Scope 2 method and unit; the later year not marked as a trend break |

**Peer medians** need `MIN_PEERS_FOR_MEDIAN` = 3 values that pass `benchmarkSet`; with fewer, values are shown
individually with the reason and the missing coverage. If the comparable values split evenly between two consolidation
approaches, no median is calculated. Fiscal years that end in different months of the same calendar year are allowed,
with a caution shown next to the median. With the current 10 companies no SASB industry has three researched
companies with a confirmed primary industry, so **no peer median is shown anywhere**; this is the correct outcome, not
a fault.

## Scores (`src/lib/scoring/`)

Scores are computed only above a coverage threshold, and only from values that pass the comparability engine.

- **Coverage:** the share of a company's core metrics (for its SASB industries) that are assessed in its latest year.
  Threshold `COVERAGE_THRESHOLD` = 80%.
- **Transparency score:** an 18-item checklist (disclosure, depth, assurance and boundary, targets, industry
  metrics). Shown only above the coverage threshold.
- **Performance score:** five indicators, each mapped to 0–100, averaged over those available; shown only when at
  least `MIN_INDICATORS` = 3 can be scored:
  - progress against the company's own GHG targets versus a straight-line path;
  - year-on-year change in Scope 1+2 (market-based): −4.2% or better → 100, 0% → 50, +10% or worse → 0, linear
    between (4.2% is the 1.5 °C linear pathway rate);
  - renewable electricity share; waste diverted from disposal; year-on-year change in water withdrawal.
- Year-on-year indicators use `sameBasis` (so a change of consolidation approach or Scope 2 method between years,
  not only a flagged trend break, stops the comparison).
- The transparency item "at least one SASB metric for its own industry" counts only metrics defined for the company's
  SASB industries, and is *not assessable* (left out of the denominator) when the dictionary has none for them. This
  raised Siemens' transparency score from 77.8 to 82.4; no other score changed in this pass.
- **Separation and fairness.** Transparency measures disclosure, never performance. A performance indicator that cannot
  be calculated is left out, not scored as zero; the average therefore covers different indicators for different
  companies, so every score is shown with its indicator list and reasons. Renewable-electricity and waste-diversion
  shares use the company's own definitions. Missing target progress makes that indicator unavailable. Scores are not
  industry-adjusted.

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
Industry KPIs (SASB/ISSB) are listed per SASB industry, only for companies in that industry; no medians are calculated
there.

## Dashboard and map

- **Locations** are the headquarters city coordinates already in each company file (`profile.hq.lat/lon`, approximate
  city centres). A test checks each point lies in the country the file names (Natural Earth 1:50m shapes); nothing is
  ever corrected or guessed. A company whose coordinates are missing, out of range or 0,0 is listed under "Not on the
  map" instead of being placed.
- **Map rendering** is self-hosted: Natural Earth 1:110m country shapes (public domain, `world-atlas` package) projected
  on the server with d3-geo's Equal Earth projection and served once as `/map/world.svg`. No tiles, no third-party
  requests from visitors' browsers, no API key, no change to the Content Security Policy.
- **Markers show disclosure status, not magnitude**: a filled circle (disclosed), diamond (disclosed but not usable
  across companies: boundary, coverage or source), ring (not disclosed), dashed ring (not found), hatched square (not
  assessed), small dot (metric does not apply to the company's industry). Shapes differ so status never depends on
  colour. Values appear only in the panel and the list, each with fiscal-year label, boundary tags and source.
- **Filters**: metric, search, region, SASB industry, peer group, disclosure state, and the calendar year the reporting
  period ends in (fiscal labels differ between companies, period ends do not). Nearby markers are grouped by screen
  distance at the current zoom; selecting a group zooms in.
- **Alternatives**: the "Companies by location" list below the map holds the same filtered companies and values and is
  the primary view on phones; the map is keyboard operable (+/−, arrows, 0) and every marker is a labelled button.
- **Overview figures** count companies, values, sources and disclosure states. No total or average of company values
  is calculated anywhere on the dashboard.

## Extraction and review

- **Rule-based extractor** (`src/lib/pipeline/extract/rules.ts`): labelled table rows, year-column headers, units, and
  context (boundary, consolidation). Never read as totals: ratios and intensities, "percentage of …" rows,
  renewable/non-renewable subtotals, combined Scope 1+2 rows, per-gas rows ("Scope 1 – CH4"), water-stress subsets,
  all-scope totals as Scope 2, waste disposal routes, footnote lines. Digits inside units ("1,000 tonnes CO₂e") are not
  values; a printed year is never a value; columns for years after the current year are targets; a row stops at the next
  label cell. Rows whose cells cannot be matched to year columns are skipped.
- **One proposal per metric and year.** Candidates are scored (header alignment, unit nearby, footnote-like small
  numbers and numbers followed by prose score lower, rows in division/segment tables score lower, the same value printed
  twice scores higher). If two different values remain equally likely, **neither is proposed**: the pair is recorded as
  "skipped as ambiguous" on the document's review page and in the audit log.
- **Review states** on each document: pending (evidence verified), blocked (evidence check failed), low confidence,
  read by OCR, possible duplicate (matches the curated value), possible restatement (differs from it), approved,
  rejected, superseded. Nothing is approved automatically, whatever the confidence.
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
exception to rule 7, summaries are published without human review, labelled "Written by AI", but only if the automatic
evidence gate (`src/lib/summaries/check.ts`, deterministic, no second model) passes for every sentence:

- citations exist; every number appears in a cited fact **with the same year nearby and the same unit**;
- every metric, method, target or gap phrase it uses (Scope 1/2/3, market/location-based, energy, water, waste,
  renewable, net zero, 1.5 °C, SBTi/science-based, validated, assured, not disclosed / not found / not assessed …)
  appears in a cited fact, so a Scope 3 claim cannot rest on a Scope 1 fact and a "not found" gap cannot be called
  "not disclosed";
- words of rise or fall need a cited year-on-year **change** fact in the same direction (one year's value is never a
  trend), the sentence must say the change is calculated, and a calculated change may not be presented as reported;
- "parent only", "subsidiary only", "boundary not stated" and partial-coverage qualifiers must be kept;
- refused outright: causes ("due to", "driven by"), comparisons and rankings, target-status judgements ("on track",
  "achieved", "aligned with"), interpretations ("improved", "worsened"), forecasts, magnitude adjectives and
  spelled-out quantities.

Problems are *hard* (an unsupported claim) or *wording* (style). Any problem stops automatic publication. **Manual-review
fallback:** a summary whose problems are all wording waits on the review page; a reviewer can publish it with a public
note of at least 15 characters (it is then labelled "Written by AI · reviewed", with the flagged wording and the note),
or reject it. A summary with a hard problem is stored as `rejected_auto` and can never be approved. A summary is hidden
as soon as the company's data changes. 19 adversarial cases plus fallback tests (`tests/summary-gate.test.ts`) pin these rules.
