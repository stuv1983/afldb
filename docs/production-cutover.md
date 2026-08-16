# AFLDB — Production Cutover Plan

> **STATUS: PARTIALLY EXECUTED — closed beta is live.**
>
> As of 16 August 2026 the production droplet exists, `afldb_prod` has been
> created and loaded, `beta.afldb.com` serves the application over Let's Encrypt
> TLS behind the beta gate, and `afldb.com` resolves to that host and serves the
> static coming-soon page. Certificates have been issued for both names.
>
> What remains is the cutover proper: serving the **application** from
> `afldb.com` and allowing it to be indexed. That is still gated on §1, and the
> open items there have not been re-verified against the production host — the
> checkboxes below were assessed on the development server.
>
> Do not complete the cutover until every item in §1 passes **on production**.

## 1. Readiness gate

### Data
- [x] Migration verified — 93/93 parity checks
- [x] Historical parity verified — exact Advanced Search ID sets
- [x] Release gates green — 55 assertions, immutable and snapshot separated
- [ ] **Data-quality blockers reviewed** — see §2

### Application
- [x] Production build stable
- [x] Pages stable — 33 E2E tests, desktop and mobile
- [x] Search stable
- [x] Advanced Search stable — 4 regression cases exact, driven through the real service

### Database
- [x] Indexes tuned — verified with `EXPLAIN`
- [ ] **Backups automated** — script exists, timer not installed
- [x] Restore tested — the successful path: target cleared first, every
      unexpected `pg_restore` error fatal, then 9 parity checks against
      `afldb_restore_test`
- [ ] **Restore failure paths untested** — a corrupt dump and a wrong target
      have not been exercised, only guarded against
- [x] Least privilege verified — `afldb_app` cannot write
- [x] Web process holds only the app credential — the unit drops the import,
      owner, test and backup DSNs from the service environment

### Security
- [x] Secrets externalised (`.env`, mode 600)
- [x] PostgreSQL private (localhost only)
- [x] Production headers configured
- [x] Public errors sanitised
- [ ] **HTTPS/HSTS** — only on a real certificate

### Performance
- [x] Load test passed — 213.6 req/s, p95 391 ms, 0 errors
- [x] Major slow queries fixed
- [x] Caching validated

### SEO
- [x] Canonical URLs
- [x] Metadata
- [x] Segmented sitemap, with a published index at `/sitemap.xml`
- [x] robots.txt gated on `AFLDB_INDEXING`, and smoke-tested per environment

### Reload safety
- [x] A partial `--groups` import cannot `CASCADE` into tables it will not
      rebuild
- [x] Clubs and their organizations commit together, so a null organization
      is never observable
- [ ] **Crash recovery and concurrent-update behaviour untested** — a
      successful full rebuild does not exercise either. There is still no
      advisory lock, shadow generation or atomic cutover: a reload is
      visible in stages to anything reading during it

### Operations
- [x] systemd unit — installed, `enabled`, running as a 4-worker cluster
- [x] Reverse proxy — Caddy active on :8090
- [x] Logs (journald)
- [x] Health endpoint — verified direct and proxied
- [x] Deployment documentation
- [x] Rollback documentation
- [ ] **Monitoring/alerting** — not configured

**Six gate items remain open.** Do not cut over until they are closed.

> **What "green" covers.** Every assertion above that is ticked passes on the
> successful development path. That is not the same as proven under failure:
> restore failure paths, reload crash recovery and concurrent-update
> behaviour are explicitly untested, and are listed as open rather than
> folded into the ticks around them.

> **Restarting the service needs root.** `sudo systemctl restart afldb` prompts for a password, so a deployment cannot complete unattended. The service does pick up a new build on its next restart, but do not assume a build alone has deployed it.

## 2. Outstanding data-quality items

None are correctness blockers; each is a documented gap, and the decision to launch with them is deliberate.

| Item | Extent | Current handling |
|---|---|---|
| Missing DOB | 883 of 13,361 (6.6%) | shown as "Not recorded" |
| Disputed DOB | 2 players | existing value kept, badged "Disputed", open `data_issue` |
| Display names lost apostrophes | 803 players | logged in `data_issues`; search unaffected |
| Draft matching backlog | 100 people | imported unlinked, flagged, 100 open `data_issues` |
| Awards / HOF / relationships | not migrated | tables exist; sections not exposed |
| Venue canonicalisation | 49 of 52 unexpanded | raw names displayed |
| Unknown attendance | 1,651 matches | `attendance_status = not_collected`; never rendered as 0 |
| 2026 incomplete | loaded to 9 Aug | labelled provisional; no premier, spoon or Brownlow |

Two of these have improved materially since the last review. **DOB coverage rose from 7.1% to 93.4%** by recovering dates from raw source rows the legacy scraper had failed to parse. **Draft data is now imported in full** — all 6,810 rows — with identity resolved per person rather than per row, which reduced the genuinely unlinked-but-played population to 100 people; the other 1,498 unlinked people never played a senior game, so having no AFLDB player is the correct outcome rather than a defect.

**Recommendation:** the draft section can now be exposed if desired, because unresolved links are visible as such rather than silently absent. Awards, Hall of Fame and relationships remain unmigrated and should stay unexposed. Requirement #42 — only expose sections backed by validated data.

## 3. Proposed staging step (recommended, needs approval)

Before touching the apex domain, prove the production configuration on a staging hostname:

```text
dev.afldb.com  →  <dev server public IP>
```

This exercises real DNS, a real certificate and real HSTS without risking `afldb.com`. **It requires a DNS record and an inbound 80/443 port-forward, neither of which has been created.** Explicit approval required.

If staging is skipped, the first real HTTPS test happens on the production domain.

## 4. Cutover steps

Each step is reversible until step 8.

### Step 1 — Production database

> **Superseded for the droplet deployment.** Steps 1–3 below were written on
> the assumption that production would run *alongside* development on
> streamanator, which is why they create `afldb_prod_*` roles, a separate
> `.env.production`, a second `afldb-prod.service` and `PORT=3200`. None of
> that applies now: production is its own DigitalOcean droplet
> (`afldb-prod`, 2 vCPU / 4 GB, SYD1), where nothing competes for the port
> and no development roles exist to collide with.
>
> On the droplet, run **[`tools/maintenance/00_install_postgres_prod.sh`](../tools/maintenance/00_install_postgres_prod.sh)**
> instead. It installs PostgreSQL, creates `afldb_prod` and the same five
> role names as development, enables `pg_trgm`/`unaccent`, and writes a
> production `.env` — with `AFLDB_ENV=production` (the host is on public
> HTTPS, so it needs Secure cookies and HSTS from the first request) and
> `AFLDB_INDEXING` left unset, so indexing stays off until §10. It refuses
> to run on a host that has an `afldb_dev` database, and refuses to
> overwrite an existing `.env` without `--force`.
>
> Steps 4 onward (reverse proxy, firewall, DNS, indexing) still apply as
> written.

Production roles are **separate roles**, not the development ones with new
passwords — see step 2. Create them first, then the database.

```bash
sudo -u postgres createdb -O afldb_prod_owner afldb_prod
sudo -u postgres psql -d afldb_prod -c 'CREATE EXTENSION pg_trgm; CREATE EXTENSION unaccent;'

# The migration runner resolves prod through AFLDB_PROD_DATABASE_URL and
# refuses to run if it is unset. It does NOT fall back to development.
AFLDB_PROD_DATABASE_URL=<prod-owner-dsn> AFLDB_MIGRATE_TARGET=prod npm run db:migrate

AFLDB_IMPORT_DATABASE_URL=<prod-import-dsn> python tools/migration/import_legacy_afl.py
AFLDB_IMPORT_DATABASE_URL=<prod-import-dsn> python tools/migration/enrich_birth_dates.py
AFLDB_IMPORT_DATABASE_URL=<prod-import-dsn> python tools/migration/import_draft.py
AFLDB_IMPORT_DATABASE_URL=<prod-import-dsn> python tools/migration/rebuild_derived.py
DATABASE_URL=<prod-dsn> python tools/validation/validate_migration.py
```

Do not proceed unless **every** validation check passes. Confirm the printed
failure count is zero rather than matching a number written here: the check
count grows as the schema gains guarantees.

### Step 2 — Production roles and secrets

Create **separate production roles**. Rotating the passwords of the roles
development uses would repoint the development deployment at credentials it
no longer holds, and would leave one compromised password affecting both
environments.

```bash
sudo -u postgres psql <<'SQL'
CREATE ROLE afldb_prod_owner  LOGIN PASSWORD '<new>';
CREATE ROLE afldb_prod_app    LOGIN PASSWORD '<new>';
CREATE ROLE afldb_prod_import LOGIN PASSWORD '<new>';
CREATE ROLE afldb_prod_backup LOGIN PASSWORD '<new>';
SQL
```

Grants belong in a migration, not a manual `GRANT`. Then write
`/home/arm/projects/afldb/.env.production` (mode 600) with those DSNs.

Set `AFLDB_ENV=production`, `AFLDB_BASE_URL=https://afldb.com` and a `PORT`
that is **not** 3100 — see step 3.

> `AFLDB_ENV=production` is **transport security**, not indexing: Secure session cookies, HSTS, and the CSP that drops `'unsafe-eval'`. Set it on any host reachable over public HTTPS, immediately. Indexing is `AFLDB_INDEXING`, which fails closed and is turned on separately at §10 — do not set that one until the site is publicly correct.

### Step 3 — Production service

The development service already owns 3100. Production must listen elsewhere,
or the two will fight over the port and whichever starts second will fail —
or worse, the proxy will serve development data on the production domain.

```bash
sudo cp deploy/afldb.service /etc/systemd/system/afldb-prod.service
sudo sed -i \
  -e 's|/afldb/.env|/afldb/.env.production|' \
  -e '/^Environment=AFLDB_WORKERS/a Environment=PORT=3200' \
  /etc/systemd/system/afldb-prod.service
sudo systemctl daemon-reload && sudo systemctl enable --now afldb-prod
```

Confirm the two are actually separate before going further:

```bash
curl -s http://127.0.0.1:3100/api/health   # development
curl -s http://127.0.0.1:3200/api/health   # production
sudo ss -ltnp | grep -E '3100|3200'        # two distinct processes
```

### Step 4 — Reverse proxy

The apex and `www` need **separate blocks**. Naming both on one block and
redirecting to the apex makes the apex redirect to itself — an infinite loop
that takes the site down the moment DNS resolves.

```caddy
# www redirects to the apex. This block serves nothing else.
www.afldb.com {
	redir https://afldb.com{uri} permanent
}

# The apex is the only origin that serves the application.
afldb.com {
	reverse_proxy 127.0.0.1:3200 {
		health_uri /api/health
		health_interval 30s
	}
	encode gzip zstd
	header {
		Strict-Transport-Security "max-age=31536000; includeSubDomains"
		X-Content-Type-Options nosniff
		X-Frame-Options DENY
		Referrer-Policy strict-origin-when-cross-origin
		-Server
	}
	log { output file /var/log/caddy/afldb.log { roll_size 50MiB roll_keep 10 } }
}
```

Serve `www` as a redirect, not a second indexable origin. Note the upstream
port is 3200, the production service from step 3 — not the development one.

Validate before reloading, which catches a redirect loop as a configuration
error rather than as an outage:

```bash
sudo caddy validate --config /etc/caddy/Caddyfile
```

> **HSTS is a commitment.** `max-age=31536000` means browsers refuse plain HTTP for a year. Deploy it only once HTTPS is confirmed working. `preload` is deliberately absent above: adding it on a first deployment is close to irreversible.

### Step 5 — Firewall

Open **only** 80 and 443. PostgreSQL stays on localhost; port 5432 is never forwarded.

### Step 6 — Pre-DNS verification

With DNS still unchanged, verify via a hosts-file override:

```bash
curl --resolve afldb.com:443:<server-ip> https://afldb.com/api/health
curl --resolve afldb.com:443:<server-ip> https://afldb.com/robots.txt   # must NOT disallow all
```

Confirm certificate validity, security headers, a player page, a season page and Advanced Search.

### Step 7 — DNS

**The first irreversible-ish step.** Lower TTL to 300 s *at least 24 hours beforehand*, so a rollback propagates in minutes rather than hours.

```text
afldb.com.      300  IN  A      <server-ip>
www.afldb.com.  300  IN  CNAME  afldb.com.
```

Raise TTL back to 3600 only after 48 hours of stability.

### Step 8 — Certificate

Caddy issues automatically on first HTTPS request. Confirm before announcing.

### Step 9 — Smoke tests

```bash
AFLDB_E2E_BASE_URL=https://afldb.com npx playwright test
```

Plus manual checks: home, search, a player, a club, a season, a match, records, Brownlow, Advanced Search, a 404, a canonical redirect, `/robots.txt`, `/sitemap.xml`.

### Step 10 — Search engines

Only after smoke tests pass. Set `AFLDB_INDEXING=on` in `.env`, then rebuild
and restart — it is read at build time, so a restart alone will not take:

```bash
npm run build && sudo systemctl restart afldb
curl -s https://afldb.com/robots.txt   # must no longer say Disallow: /
```

The beta gate overrides this flag, so turn the gate off first or the site
stays `noindex` with no other symptom. Then submit the sitemap to Google
Search Console and Bing Webmaster Tools.

## 5. Rollback

| Stage | Action | Recovery time |
|---|---|---|
| Before DNS | stop `afldb-prod` | immediate |
| After DNS, app broken | `systemctl stop afldb-prod` → Caddy 502 | immediate |
| After DNS, want full revert | revert the A record (TTL 300) | ~5 min |
| Data problem | `pg_restore` into `afldb_prod` | ~2 min |
| Total rebuild | re-run migration from legacy source | ~2.5 min |

Keep the development deployment running throughout: it is the fallback reference and the place to reproduce any production issue.

## 6. Post-cutover

Within 24 hours:
- [ ] Enable the backup timer against `afldb_prod`
- [ ] Schedule weekly restore verification
- [ ] Copy backups off-host
- [ ] Configure uptime monitoring on `/api/health`
- [ ] Confirm indexing has begun (`site:afldb.com`)
- [ ] Review slow-query logs against real traffic

Within a week:
- [ ] Review real load against the 213 req/s benchmark; tune `AFLDB_WORKERS`
- [ ] Review Search Console coverage for canonical or duplicate problems
- [ ] Consider `preload` for HSTS, once stable

## 7. Explicitly out of scope

Not part of cutover, deliberately: user accounts, monetisation, a public API, an admin CMS, and analytics beyond server logs. Requirements #82 and #83.
