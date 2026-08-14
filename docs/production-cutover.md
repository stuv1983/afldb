# AFLDB — Production Cutover Plan

> **STATUS: PREPARED, NOT EXECUTED.**
>
> Nothing in this document has been run. `afldb.com` is untouched: its DNS is unchanged, it points nowhere near the development server, no certificate has been requested, and no production database exists.
>
> Do not begin until every item in §1 passes.

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
- [x] Restore tested — 9 parity checks, run against `afldb_restore_test`
- [x] Least privilege verified — `afldb_app` cannot write

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
- [x] Segmented sitemap
- [x] robots.txt gated on `AFLDB_ENV`

### Operations
- [x] systemd unit — installed, `enabled`, running as a 4-worker cluster
- [x] Reverse proxy — Caddy active on :8090
- [x] Logs (journald)
- [x] Health endpoint — verified direct and proxied
- [x] Deployment documentation
- [x] Rollback documentation
- [ ] **Monitoring/alerting** — not configured

**Three gate items remain open.** Do not cut over until they are closed.

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

```bash
sudo -u postgres createdb -O afldb_owner afldb_prod
sudo -u postgres psql -d afldb_prod -c 'CREATE EXTENSION pg_trgm; CREATE EXTENSION unaccent;'

AFLDB_MIGRATE_TARGET=prod npm run db:migrate
AFLDB_IMPORT_DATABASE_URL=<prod> python tools/migration/import_legacy_afl.py
AFLDB_IMPORT_DATABASE_URL=<prod> python tools/migration/rebuild_derived.py
DATABASE_URL=<prod> python tools/validation/validate_migration.py   # must be 88/88
```

Do not proceed unless validation is 88/88.

### Step 2 — Production secrets

Generate **new** passwords; never reuse development credentials.

```bash
sudo -u postgres psql -c "ALTER ROLE afldb_app PASSWORD '<new>';"
# ... repeat per role, then write /home/arm/projects/afldb/.env.production (mode 600)
```

Set `AFLDB_ENV=production` and `AFLDB_BASE_URL=https://afldb.com`.

> Setting `AFLDB_ENV=production` **enables search-engine indexing**. Do not set it until the site is publicly correct.

### Step 3 — Production service

```bash
sudo cp deploy/afldb.service /etc/systemd/system/afldb-prod.service
# point EnvironmentFile at .env.production; raise AFLDB_WORKERS to suit the host
sudo systemctl daemon-reload && sudo systemctl enable --now afldb-prod
```

### Step 4 — Reverse proxy

```caddy
afldb.com, www.afldb.com {
	redir https://afldb.com{uri} permanent    # single canonical host
	reverse_proxy 127.0.0.1:3100 {
		health_uri /api/health
		health_interval 30s
	}
	encode gzip zstd
	header {
		Strict-Transport-Security "max-age=31536000; includeSubDomains; preload"
		X-Content-Type-Options nosniff
		X-Frame-Options DENY
		Referrer-Policy strict-origin-when-cross-origin
		-Server
	}
	log { output file /var/log/caddy/afldb.log { roll_size 50MiB roll_keep 10 } }
}
```

Serve `www` as a redirect, not a second indexable origin.

> **HSTS is a commitment.** `max-age=31536000` means browsers refuse plain HTTP for a year. Deploy it only once HTTPS is confirmed working. Do **not** add `preload` on the first deployment.

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

Only after smoke tests pass: submit the sitemap to Google Search Console and Bing Webmaster Tools.

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
