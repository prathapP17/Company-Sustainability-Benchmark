# Corporate Sustainability Intelligence

Benchmarks the sustainability disclosures of large operating companies. See
[NEXT_PROJECT_BRIEF.md](NEXT_PROJECT_BRIEF.md) for the rules and phases.

## Phase 1 (scaffold)

- `data/companies/<id>.json`: curated company files (zod-validated, every value cites a source and page)
- `data/peer-groups.json`: five industry peer groups
- `src/lib/metrics/dictionary.ts`: metric dictionary v1 (cross-industry, all 15 Scope 3 categories, SASB industry metrics)
- `src/lib/schema/`: schema, rule-3 context fields, four disclosure states, cross-field validation
- `src/lib/db/`: additive-only migrations, backup-before-migrate, seeding into `data/benchmark.db` (SQLite, WAL)
- Pages: dashboard (`/`) and company profile (`/companies/[id]`)

## Phase 2 (dashboards)

- `/compare`: pick companies and a topic; values side by side with comparability flags; one-metric chart
- `/peers`, `/peers/[group]`: peer benchmarks; median only with 3+ comparable values
- `/targets`: targets with progress vs a straight-line path (derived)
- `/transparency`: 18-item checklist; `/rankings`: transparency and performance rankings
- `/methodology`, `/downloads`: CSV, XLSX and PDF exports with provenance (internal notes stripped)
- Scoring code: `src/lib/scoring/`; scores are computed at seed time

## Phase 3 (upload and extraction pipeline)

- `/review` (this computer only): upload PDF, XLSX or ESEF/XHTML reports; review proposals; audit log
- `npm run worker`: background worker (job queue, time-outs, retries, stuck-job recovery, memory guard)
- Rule-based extractor (`src/lib/pipeline/extract/`), plus optional Claude extraction when `ANTHROPIC_API_KEY` is set
- Evidence gate: a value can be approved only if its wording and number are found again in the stored page text
  (or spreadsheet cell); otherwise it is blocked and needs an override with a reason
- Conflicts with curated values must be approved as a restatement (history kept) or rejected
- Approval writes into `data/companies/<id>.json`, re-validates, re-seeds, and records the reviewer in the audit log
- Scanned (image-only) pages are flagged "needs OCR"; OCR comes in a later phase
- Setup: copy `.env.example` to `.env.local`, set `REVIEWER_TOKEN`, run `npm run dev` (or `build` + `start`) and `npm run worker`.
  Public pages are prerendered: run `npm run build` again to publish approved values.

## Commands

```bash
npm install
npm run validate      # check data files against the rules
npm run seed          # build data/benchmark.db from the data files
npm run dev           # http://localhost:3000
npm run typecheck && npm run lint && npm test
npm run build         # runs validate + seed first
npm run test:e2e      # needs a build; uses installed Chrome (CHROME_PATH to override)
npm run test:e2e:pipeline   # review pipeline end to end, in a temporary data folder
npm run worker        # extraction worker (add -- --once to drain the queue and exit)
npm run extract-text -- <file.pdf>   # page-marked text for manual research
```

Tests always use a temporary data directory, never `data/benchmark.db`.
