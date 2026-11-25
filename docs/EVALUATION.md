# Extraction evaluation

How well the extractors find the curated values in the original reports.

## Set-up

- **Gold answers** (`data/eval/gold.json`, `npm run eval:gold`): every reported numeric value in the curated data whose
  source is one of the 8 primary reports below. Each was checked by hand against its source page during research.
  Derived values are excluded (they are computed, not printed).
- **Source files** (`data/eval/sources.json`): URL, size and SHA-256 of each report. The files themselves are in
  `data/external/eval/` (not in git); a file whose checksum changed is skipped.
- **Scoring** (`src/lib/eval/score.ts`): a gold value is *found* if any proposal for the same metric and year matches
  it within 0.5% after unit conversion; *wrong* if proposals exist but none match; *missed* if there are none.
  Precision counts only proposals whose metric and year have a gold answer ("judged"), because the curated set covers
  chosen years, not every number in a report.

| Company | Source |
| --- | --- |
| Apple | Environmental Progress Report 2026 |
| Microsoft | Environmental Data Fact Sheet 2026 |
| Nestlé | Non-financial Statement 2025 |
| Reliance | Business Responsibility and Sustainability Report 2025-26 |
| Samsung | Sustainability Report 2026 |
| Siemens | Sustainability Statement FY2025 |
| Toyota | Sustainability Data Book 2026 |
| Unilever | Annual Report 2025 (ESEF XHTML) |

## Results: rule-based extractor, 2026-11-25

| | Gold | Found | Wrong | Missed | Recall | Judged proposals | Correct | Precision |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Apple | 18 | 8 | 2 | 8 | 44.4% | 17 | 8 | 47.1% |
| Microsoft | 28 | 22 | 2 | 4 | 78.6% | 51 | 22 | 43.1% |
| Nestlé | 29 | 8 | 3 | 18 | 27.6% | 16 | 8 | 50.0% |
| Reliance | 12 | 5 | 1 | 6 | 41.7% | 9 | 5 | 55.6% |
| Samsung | 33 | 14 | 5 | 14 | 42.4% | 41 | 14 | 34.1% |
| Siemens | 21 | 0 | 1 | 20 | 0.0% | 1 | 0 | – |
| Toyota | 32 | 10 | 1 | 21 | 31.3% | 16 | 10 | 62.5% |
| Unilever | 11 | 0 | 0 | 11 | 0.0% | 0 | 0 | – |
| **Total** | **184** | **67** | **15** | **102** | **36.4%** | **151** | **67** | **44.4%** |

Reading the numbers:

- The rule extractor finds about a third of the curated values. Most misses are layouts it deliberately skips as
  ambiguous (rule 1): Siemens' ESRS tables carry extra % and target columns that do not line up with the year
  header, and Unilever's ESEF XHTML prints values such as "0.43m" in narrative tables.
- Judged precision is 44%: most wrong proposals are a second value for the same metric and year taken from another
  table (for example a site subset or a different method). They are caught in review: conflicting proposals for one
  metric and year are shown side by side, and nothing reaches the benchmark without approval.
- This evaluation led to one fix: rows with empty cells printed as "-" are now aligned by cell or skipped. Before it,
  Siemens produced 21 proposals with the wrong year (e.g. FY2025 Scope 1 proposed as a 2050 value).

## Running it

```bash
npm run eval                    # rule-based (free)
npm run eval -- --claude        # estimates Claude's token use and stops
npm run eval -- --claude --yes  # runs Claude too (needs ANTHROPIC_API_KEY; costs API credits)
```

Each run writes `data/eval/results/<date>.json`. The Claude extractor has not been evaluated yet (no API key was
available when this was written).
