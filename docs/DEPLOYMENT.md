# Deployment

The app runs as four containers from one image, on one server with a persistent disk:

| Service | What it does |
| --- | --- |
| `caddy` | HTTPS for your domain (automatic certificates), HSTS, forwards to `web`. The only service with open ports (80, 443). |
| `web` | The Next.js app: public dashboards and the signed-in review area. |
| `worker` | Extraction jobs from uploads and fetched reports. |
| `scheduler` | Weekly discovery refresh and daily snapshot backups. |

All three app services share the `data` volume (`/data`): SQLite databases, curated company files, uploads, logs and
backups. SQLite needs a local disk: do not put the volume on NFS or another network filesystem.

Nothing here has been run against a real server yet. The image could not be built on the development Mac (no Docker),
so treat the first deployment as a test.

## Requirements

- A Linux server with Docker Engine and the Compose plugin; 2 GB of memory is enough for the app plus the worker.
- A domain name whose DNS A (and AAAA, if you use IPv6) record points at the server.
- Ports 80 and 443 reachable from the internet (Caddy needs port 80 for the certificate challenge).

## First deployment

```bash
git clone https://github.com/prathapP17/Company-Sustainability-Benchmark.git
cd Company-Sustainability-Benchmark
cp deploy/.env.example deploy/.env
nano deploy/.env          # set DOMAIN; optional ANTHROPIC_API_KEY, SEC_USER_AGENT, schedules
docker compose --env-file deploy/.env up -d --build
docker compose --env-file deploy/.env logs -f web   # wait for "public pages refreshed from live data: 200"
```

On first start the `web` container copies the curated data from the image into the volume, validates it (it refuses
to start if a company file breaks the rules), and seeds `benchmark.db`.

### Create the first admin

```bash
docker compose --env-file deploy/.env exec web npm run users -- invite --email you@example.org --name "Your Name" --role admin
```

It prints a one-time link (valid 72 hours). Open it, set a password (at least 12 characters), then sign in at
`https://<your domain>/review`. Add other people from **Review → Users**; the app sends no email, so you pass each
invite link on yourself.

## Accounts and roles

| Role | Can |
| --- | --- |
| viewer | Read the review queue, documents, discovered reports, alerts and the audit log |
| reviewer | Also upload, fetch, approve, reject, re-run extraction and acknowledge alerts |
| admin | Also create accounts, change roles, disable accounts, issue password-reset links, end sessions |

- The public dashboards and downloads need no account.
- Passwords are stored as scrypt hashes. Sessions end after 8 hours idle or 7 days, and on password change, reset or
  disable.
- 8 wrong passwords lock an account for 15 minutes; one address gets at most 30 attempts per 15 minutes.
- The app always keeps at least one active admin. If every admin is locked out, use the CLI inside the container:
  `npm run users -- list`, `npm run users -- link --email …` (new reset link), `npm run users -- enable --email …`.

## Data in hosted mode (read this)

Approvals write into `/data/companies/*.json` **on the server**, not into the git repository. Two consequences:

1. **Bringing approved data back to git.** Copy the files out and commit them from a checkout:
   ```bash
   docker compose --env-file deploy/.env cp web:/data/companies ./data/
   git diff data/companies    # review, then commit and push
   ```
2. **Deploying a new version does not overwrite the server's company files.** The image's data seeds the volume only on
   the very first start. To push curated data from git to the server, copy it in and restart `web` (which validates and
   re-seeds):
   ```bash
   docker compose --env-file deploy/.env cp ./data/companies/. web:/data/companies/
   docker compose --env-file deploy/.env restart web
   ```
   Do this only when the server has no approvals you have not copied out yet.

## Updating the app

```bash
git pull
docker compose --env-file deploy/.env up -d --build
```

Database changes are additive migrations that back up the database first (into `/data/backups`).

## Backups

The scheduler writes a snapshot daily (default 03:00 in `SCHEDULE_TZ`) to `/data/backups/snapshot-<time>/`:
both databases (SQLite online backup), the curated JSON files, and the uploads (hard links). It keeps the newest 14
(`BACKUP_KEEP`). Run one now with:

```bash
docker compose --env-file deploy/.env exec web npm run backup
```

These snapshots are on the same disk as the data. **Also copy them off the server**, for example a nightly
`docker run --rm -v csi_data:/data:ro -v /srv/offsite:/out alpine tar czf /out/csi-$(date +%F).tgz -C /data backups/` to
storage you then sync elsewhere, or your provider's volume snapshots.

### Restore

1. `docker compose --env-file deploy/.env stop web worker scheduler`
2. Copy `pipeline.db`, `companies/`, `discovery.json`, `peer-groups.json` and `uploads/` from a snapshot over the
   ones in `/data` (for example with a temporary container mounting the volume). Delete `pipeline.db-wal` and
   `pipeline.db-shm` first.
3. `docker compose --env-file deploy/.env start web worker scheduler` (web re-seeds `benchmark.db`).

## Schedules and logs

- Discovery refresh: `REFRESH_SCHEDULE` (default `Mon 07:00`); extraction is picked up by the worker.
- Backups: `BACKUP_SCHEDULE` (default `daily 03:00`), both in `SCHEDULE_TZ` (default `UTC`).
- Logs: `docker compose --env-file deploy/.env logs web|worker|scheduler|caddy`.
- Health: `https://<your domain>/api/health` returns `{"ok":true}` when the app and its database answer.

## Security notes

- Only Caddy is exposed; the app listens on the internal network. Caddy replaces any client-supplied
  `X-Forwarded-For` with the real client address, which sign-in throttling relies on. If you put another proxy or
  CDN in front of Caddy, configure Caddy's `trusted_proxies` for it, or throttling sees the CDN's address.
- The review area only answers on `APP_ORIGIN` (set from `DOMAIN`); state-changing requests must come from that
  origin. Cookies are `HttpOnly`, `SameSite=Strict` and `Secure`.
- Every response carries a Content Security Policy (same-origin only), `X-Frame-Options: DENY`, `nosniff`, a strict
  referrer policy and a restrictive permissions policy; Caddy adds HSTS. The CSP allows inline scripts because the
  public pages are pre-built (Next.js nonces would force per-request rendering).
- Secrets live only in `deploy/.env` on the server; it is git-ignored and excluded from the Docker build context.
- The containers run as the unprivileged `node` user.

## Running locally (this Mac)

Without `APP_ORIGIN` the app is in local mode: the review area only answers on `localhost`, as before. Create your own
admin with `npm run users -- invite --email … --name … --role admin` and open the printed link while `npm run dev` or
`npm start` is running.
