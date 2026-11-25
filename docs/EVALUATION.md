# Extraction evaluation

How well the extractors find the curated values in the original reports.

## Set-up

- **Gold answers** (`data/eval/gold.json`, `npm run eval:gold`): every reported numeric value in the curated data whose
  source is one of the 8 primary reports below. Each was checked by hand against its source page during research.
  Derived values are excluded (they are computed, not printed).
- **Source files** (`data/eval/sources.json`): URL, size and SHA-256 of each report. The files themselves are in
  `data/external/eval/` (not in git); a file whose checksum changed is skipped.
- **Gold context**: each gold value also carries the curated boundary, consolidation approach and Scope 2 method.
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

## Measures

`src/lib/eval/score.ts` reports, per report and in total:

- **Recall**: gold values found / gold values. **Judged precision**: correct / proposals whose metric and year have a
  gold answer.
- **Wrong year**: wrong proposals whose number is the gold value of the same metric in another year (column misread).
- **Wrong unit**: wrong proposals with the gold number but another unit.
- **Boundary, consolidation and Scope 2 method accuracy**: among correctly found values, how often the proposed
  context equals the curated one.
- **OCR**: proposals read from OCR pages (none of the 8 reports needed OCR, so this is not measured yet).
- **Skipped as ambiguous**: metric/years the extractor saw but refused to propose (two equally likely values).

## Results: before and after the precision pass (2026-11-25)

"Before" is the extractor at commit `08d430d` (`results/2026-11-25.json`). "After, like for like" runs the same way
(no reporting year given, `results/2026-11-25-after-no-year.json`). "After, as uploaded" passes each report's reporting
year, as the review upload form does, so header-less single values can be placed (`results/2026-11-25-after.json`).

| | Gold | Found | Wrong | Missed | Recall | Judged | Correct | Precision |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Before | 184 | 67 | 15 | 102 | 36.4% | 151 | 67 | 44.4% |
| After, like for like | 184 | 99 | 10 | 75 | 53.8% | 109 | 99 | 90.8% |
| **After, as uploaded** | **184** | **108** | **11** | **65** | **58.7%** | **119** | **108** | **90.8%** |

Per report, after (as uploaded):

| Company | Gold | Found | Wrong | Missed | Recall | Judged | Correct | Precision |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Apple | 18 | 8 | 3 | 7 | 44.4% | 11 | 8 | 72.7% |
| Microsoft | 28 | 25 | 0 | 3 | 89.3% | 25 | 25 | 100% |
| Nestlé | 29 | 15 | 3 | 11 | 51.7% | 18 | 15 | 83.3% |
| Reliance | 12 | 5 | 1 | 6 | 41.7% | 6 | 5 | 83.3% |
| Samsung | 33 | 19 | 2 | 12 | 57.6% | 21 | 19 | 90.5% |
| Siemens | 21 | 13 | 0 | 8 | 61.9% | 13 | 13 | 100% |
| Toyota | 32 | 14 | 1 | 17 | 43.8% | 15 | 14 | 93.3% |
| Unilever | 11 | 9 | 1 | 1 | 81.8% | 10 | 9 | 90% |

Breakdown (after, as uploaded): wrong year 1; wrong unit 0; Scope 2 method 19/19 (100%); consolidation 85/108
(78.7%); **boundary 47/108 (43.5%)**; 14 metric/years skipped as ambiguous; OCR not exercised.

### Against the goals

| Goal | Result |
| --- | --- |
| Judged precision ≥ 85% | **Met**: 90.8% |
| Recall ≥ 70% | **Not met**: 58.7% (53.8% like for like) |
| No known boundary or reporting-year misclassification in accepted values | One wrong-year proposal remains (Apple, a rounded GRI-index figure). Boundary is proposed as "not stated" for most values, which a reviewer must correct before approval: no value reaches the benchmark with a guessed boundary, but the proposals are not yet accurate on boundary. |
| All approved values pass the evidence gate | Unchanged: approval requires a verified page match or a recorded override with a reason (tested). |

### What changed, and why recall is still short

Changes, each found by reading the wrong and missed values, each with a unit test (`tests/extract.test.ts`): digits
inside unit cells ("1,000 tonnes CO₂e") were read as values (Samsung, all Scope 3 categories); per-gas rows, "% of"
rows, water-stress subsets and all-scope totals were read as totals; rows continued into the next label's numbers;
footnote lines and printed years were read as values; headers with a repeated year ("2023 | 2024 | 2025 | … | 2025")
mis-mapped columns; Siemens' tables have target-year columns and an "Annual %" column; unit look-up stopped 25 lines up
in long tables; ESEF/XHTML table cells wrapped in `<p>`/`<div>` were split over lines, so no Unilever row could be read;
several values per metric and year were proposed instead of one.

Remaining misses, by cause:

- **Multi-column page layouts** whose text interleaves two tables (Toyota pp. 65–67: energy, water, waste and vehicle
  sales are printed as "Total | …" rows with the label in another column). Rules cannot tell which table a "Total"
  belongs to.
- **Space-grouped thousands** ("78 784 554", Nestlé) are deliberately not read: in a row of such numbers the split
  between values is ambiguous.
- **Labels on one line, values on the next** (Toyota Scope 3 categories 3, 4, 9).
- **Values only in prose or rounded summaries** (Apple's GRI index "1,800" for 1,796 million gallons).
- **Numbers from text run into a row** (Reliance: "ISO 14001" on the same line as the waste row was read as 14,001 t).
- **Division tables** next to group tables can still win when the group table itself is not readable.

These are the cases the optional Claude extractor is meant for; it uses the same evidence gate and review, but it has
**not been evaluated** (no API key was available). Making the rules more aggressive would cost precision, which the
brief ranks higher.

## Running it

```bash
npm run eval                    # rule-based (free)
npm run eval -- --claude        # estimates Claude's token use and stops
npm run eval -- --claude --yes  # runs Claude too (needs ANTHROPIC_API_KEY; costs API credits)
npm run eval -- --no-year       # do not pass the reporting year (as the original baseline)
npm run eval -- --label=after   # writes results/<date>-after.json
```

Each run writes `data/eval/results/<date>[-label].json`. The Claude extractor has not been evaluated yet (no API key was
available when this was written).
