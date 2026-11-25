# Data model

Two kinds of data: **curated files** (git-tracked JSON, the source of truth for published values) and **local
databases** (rebuilt or operational, never committed). The data folder is `data/` locally and the `/data` volume in
Docker (`CSI_DATA_DIR`).

## Curated files (git)

| File | Contents | Schema |
| --- | --- | --- |
| `data/companies/<id>.json` | Profile, sources, metric values (with state, context, source, page, restatements), targets, reports, data gaps | `src/lib/schema/company.ts` |
| `data/peer-groups.json` | Peer groups (industry) | `src/lib/schema/company.ts` |
| `data/discovery.json` | Per company: official pages to crawl, own domains, exclusion patterns, SEC CIK | `src/lib/discovery/config.ts` |
| `data/sbti.json` | SBTi Target Dashboard extract for the benchmark companies, with file checksums and data date | `src/lib/sbti/schema.ts` |
| `data/sbti-matches.json` | Each company pinned to one SBTi record (id, name, ISIN/LEI), or `null` (not listed) | `scripts/sbti-import.ts` |
| `data/news.json` | GDELT query settings: company names, topic words, spacing | `src/lib/news/gdelt.ts` |
| `data/summaries/<id>.json` | Published AI summaries with their facts and facts hash | `src/lib/summaries/store.ts` |
| `data/eval/gold.json`, `sources.json`, `results/` | Extraction evaluation gold answers, source checksums, scored runs | `src/lib/eval/score.ts` |

`npm run validate` checks every company file and the SBTi extract against the rules; the build refuses invalid data.
Key metric value fields: `metric`, `year` (company's own label), `state`, `value`/`text`, `unit`, `boundary`,
`consolidation`, `scope2Method`, `assurance`, `verificationClass`, `status` (reported/derived), `source`, `page`,
`reportedWording`, `coverage`, `trendBreak`, `restatements[]`, `note`, `internalNote` (never shown or exported).
Defaults for context fields come from each file's `defaults`.

## `benchmark.db` (curated database, rebuilt)

Built by `npm run seed` (and on every build and container start) from the curated files; it is a read model for the
pages and never edited directly. Migrations are additive only and back up the file first (`src/lib/db/migrations.ts`).

Tables: `peer_groups`, `companies`, `sources`, `reports`, `metric_values` (with canonical value and unit),
`targets`, `data_gaps`, `company_coverage`, `company_scores`, `transparency_items`, `performance_indicators`,
`seed_runs`.

## `pipeline.db` (operational database, never reset)

Holds uploads, review work, accounts and the audit trail (`src/lib/pipeline/migrations.ts`, additive only, backed up
before each migration).

| Table | Purpose |
| --- | --- |
| `documents`, `pages` | Uploaded or fetched files (content-addressed by SHA-256 in `data/uploads/`) and their page text; OCR pages are labelled "(OCR)" |
| `jobs` | Worker queue: atomic claims, heartbeats, retries with backoff |
| `extractions` | Proposed values with evidence status, conflict and review outcome |
| `audit_log` | Append-only record of every action (enforced by triggers) |
| `discovered_documents`, `crawl_runs`, `alerts`, `robots_cache` | Discovery: found report links, runs, in-app alerts, robots.txt cache |
| `users`, `sessions`, `account_links`, `login_throttle` | Accounts and roles; passwords as scrypt hashes, session and link tokens as SHA-256 hashes |
| `news_items` | GDELT news items: pending, approved (with note) or rejected |

## Files that are never committed

`data/*.db`, `data/backups/` (migration backups and `snapshot-*` backups), `data/uploads/`, `data/logs/`,
`data/external/` (downloaded SBTi and evaluation reports), `.env.local`, `deploy/.env`.

## Backups

`npm run backup` writes `data/backups/snapshot-<time>/` (both databases via SQLite online backup, curated files, and
uploads as hard links); `npm run restore:drill` proves the newest snapshot restores cleanly into a temporary folder.
See [DEPLOYMENT.md](DEPLOYMENT.md) for off-server copies and restore steps.
