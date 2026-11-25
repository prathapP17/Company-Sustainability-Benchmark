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

- `/review` (signed-in accounts; see phase 5): upload PDF, XLSX or ESEF/XHTML reports; review proposals; audit log
- `npm run worker`: background worker (job queue, time-outs, retries, stuck-job recovery, memory guard)
- Rule-based extractor (`src/lib/pipeline/extract/`), plus optional Claude extraction when `ANTHROPIC_API_KEY` is set
- Evidence gate: a value can be approved only if its wording and number are found again in the stored page text
  (or spreadsheet cell); otherwise it is blocked and needs an override with a reason
- Conflicts with curated values must be approved as a restatement (history kept) or rejected
- Approval writes into `data/companies/<id>.json`, re-validates, re-seeds, and records the reviewer in the audit log
- Scanned (image-only) pages are flagged "needs OCR"; OCR comes in a later phase
- Setup: run `npm run dev` (or `build` + `start`) and `npm run worker`, then create an account (phase 5).
  Approvals refresh the prerendered public pages and the CSV download on their next visit; no rebuild needed.

## Phase 4 (automated discovery and scheduled refresh)

- `data/discovery.json`: per company, the official pages to crawl, the company's own domains, and an optional SEC CIK
  (checked against the filer name, so a wrong CIK is ignored). Optional `excludePatterns` (case-insensitive regexes) leave
  out links that belong to another entity or product line, e.g. Siemens Limited (India) for Siemens AG, or Apple's
  per-product environmental reports
- Report filter: report words are matched on the file name and link text only (never folder names); product sheets,
  policies, certificates, legal statements and minerals reports are left out, as are reports naming a country other than
  the company's headquarters country (country or subsidiary reports). Each run's notes count what was left out and why
- `npm run refresh`: crawls the configured pages (plus one level of same-site report pages) and SEC EDGAR, records report
  links, detects new or changed files (ETag / Last-Modified / size), then runs the worker for anything fetched
- Polite crawling: robots.txt checked on every request and redirect, 2 s per host, size caps, a generic bot name;
  bot-protection pages (Cloudflare, Imperva, plain 403) are recorded as blockers and never worked around
- **Auto-fetch rule (decided 2026-11-24):** reports on a company's own allow-listed domain, in English, from this year or
  last, at most 3 per company per run, are downloaded automatically. Everything else (other domains, SEC filings, older or
  non-English reports) waits on `/review/discovered` until a reviewer clicks Fetch. Extracted values still need review.
- A company's first run records a silent baseline; later runs raise alerts for new reports, changed reports, changed
  benchmark sources, possible restatements (extracted value differs from a curated value), blocked sites and failed fetches
  on `/review/alerts`
- Weekly schedule (macOS): `npm run launchd:print` shows the job; `npm run launchd:install` installs it (Mondays 07:00,
  log in `data/logs/refresh.log`); `npm run launchd:uninstall` removes it
- SEC EDGAR needs `SEC_USER_AGENT` (your organisation and a contact email) in `.env.local`

## Phase 5 (accounts, roles, hardening, hosting)

- Email + password accounts with three roles: **viewer** (read the review area), **reviewer** (upload, fetch,
  approve, reject), **admin** (also manage accounts at `/review/users`). Public dashboards stay open to everyone.
- First admin: `npm run users -- invite --email you@example.org --name "Your Name" --role admin` prints a one-time
  link to set the password. The app sends no email; admins pass invite and reset links on themselves.
- Security: scrypt password hashes; session and link tokens stored only as hashes; sessions end after 8 h idle or 7
  days; lockout after 8 wrong passwords; per-address throttling; same-origin checks on every change; CSP, frame,
  sniffing, referrer and permissions headers; `/review` and `/api/` kept out of search engines
- Local mode (no `APP_ORIGIN`): the review area still answers on localhost only. Hosted mode: Docker image +
  `compose.yaml` (Caddy HTTPS, web, worker, scheduler for weekly refresh and daily snapshot backups). See
  [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md); nothing is deployed until you run it on your own server.

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
npm run refresh       # discovery + extraction now (add -- --company apple to limit)
npm run refilter      # re-apply changed filters to queued links (dry run; add -- --apply, which backs up first)
npm run users -- list # accounts: list | invite | link | role | disable | enable (see docs/DEPLOYMENT.md)
npm run backup        # snapshot backup into data/backups/snapshot-<time>/ (keeps 14)
npm run extract-text -- <file.pdf>   # page-marked text for manual research
```

Tests always use a temporary data directory, never `data/benchmark.db`.
