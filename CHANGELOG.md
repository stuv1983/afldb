# Changelog

All notable changes to AFLDB.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/). The
project is pre-1.0 and has not cut a numbered release, so entries are grouped by
date. Versioned releases begin at the public launch of `afldb.com`.

Git history starts on 15 August 2026, part-way through the build. Entries dated
earlier than that are reconstructed from the development record and are marked
accordingly — they describe work that is in the tree but predates its first
commit.

---

## [Unreleased]

### Housekeeping — 16 August 2026

#### Changed
- Trimmed the longest source docblocks to the constraint they exist to record,
  moving the incident narrative behind them into this changelog. Section
  dividers in the query and library modules compressed from three-line ASCII
  rules to one line.

#### Removed
- `tsconfig.tsbuildinfo` is no longer tracked. It is a host-specific
  incremental build cache, so a committed copy only ever reached the next host
  stale. Now ignored, along with `.claude/`.

---

## 16 August 2026 — Production infrastructure and the public apex

The day the project acquired real infrastructure: a dedicated host, a
production database, TLS, and a public front door.

### Added
- **Production droplet.** DigitalOcean `s-2vcpu-2gb` (2 vCPU, 2 GB, 60 GB) with
  PostgreSQL self-managed on the same host. A managed database cluster was
  costed and rejected: at roughly AUD 50/month more it bought failover and PITR
  for a workload whose writes all happen on dev before release, and which is
  backed up independently.
- **Host hardening.** SSH restricted to key auth for a single non-root user
  (`PermitRootLogin no`, `PasswordAuthentication no`, `AllowUsers arm`); `ufw`
  limited to 22/80/443; PostgreSQL bound to localhost only.
- **Production PostgreSQL bootstrap** (`tools/maintenance/00_install_postgres_prod.sh`)
  creating `afldb_prod`, the five roles, and `pg_trgm`/`unaccent`, writing
  credentials to a mode-600 `.env`.
- **`beta.afldb.com` live** behind Caddy with a Let's Encrypt certificate,
  served by `afldb.service` as a four-worker Next.js standalone cluster under
  systemd.
- **Coming-soon page at the apex** (`afldb.com`), static and indexable, served
  from disk by Caddy while the application itself stays `noindex` behind the
  beta gate. Carries an early-access request form.
- **`/admin/content`** — a super-admin editor for the coming-soon page and the
  site-wide footer: copy, images, cards, and search metadata, with media
  upload. The published apex page is rendered from the database; the files in
  `deploy/coming-soon/` are the reference copy it started from.
- **Runtime site settings** — home-page layout, record of the week, AFLW
  leaders panel, and grid-solver audience, all editable without a deploy.
- **Structured data and SEO** — JSON-LD, canonical URLs, and a segmented
  sitemap with a published index.
- **Admin password reset.** A super admin can issue a single-use temporary
  password that carries `must_change_password` and leaves the TOTP secret
  alone. Previously the only repair for a forgotten password was re-issuing an
  invite, which re-enrolled both factors.
- **Collapsible admin navigation.**
- **Email intake** for CSV submissions, polled by a systemd timer.

### Fixed
- **`AFLDB_INDEXING` split from `AFLDB_ENV`.** One flag had been deciding both
  search indexing and transport security. Holding the beta host out of search
  therefore also stripped `Secure` from its admin cookies on a live HTTPS site.
  Indexing is now its own flag and fails closed.
- **Read privileges fail closed.** `afldb_app` no longer inherits `SELECT` on
  new tables; a new public table must be granted explicitly via
  `afldb_meta.grant_app_read()`. `tools/maintenance/privileges.sql` reconciles
  the whole set and is mandatory after a restore.
- **Import privilege check** now uses `has_table_privilege` for `DELETE` and
  `TRUNCATE` rather than inferring them.
- **`.gitignore` was excluding `tools/build/prepare-standalone.mjs`.** An
  unanchored `build/` pattern matches at any depth, so the script `npm run
  build` invokes as its final step was never committed — and a fresh clone
  failed only there. Anchored to `/build/`.
- **`site_settings` jsonb read.** `postgres.js` returns jsonb as text, so the
  settings read had to parse rather than assume an object.
- Apex `ReadWritePaths` in the systemd unit now tolerates a host without that
  directory.
- Worker and pool sizing moved out of the unit file into per-host `.env`.

### Known issues
- Outbound SMTP on ports 25/465/587 is blocked by DigitalOcean. Titan can
  receive mail but cannot relay, so transactional mail goes through Brevo on
  port 2525.

---

## 15 August 2026 — Features, roles, and AFLW

### Added
- **AFLW as a separate competition.** Parsed and staged from the source scrape
  first so the real data could be inspected before committing to a schema, then
  exposed through a read-only `aflw` view schema (migration 026). AFLW is
  deliberately outside the normalised model: it played two seasons in calendar
  2022, and the core model keys a season by year. Seasons are identified by
  `season_key` and ordered by `ordinal`, never by year.
- **Grid Solver** — a 3x3 board of named questions, 93 builders across 10
  categories, modelled on the sports_data_lab original and checked against its
  generated criteria document. Family relationships, physical attributes, derby
  definitions and win-streaks are absent because the data does not exist.
- **Query builder** — a hidden super-admin tool for ad-hoc data QA. Table and
  column identifiers come from a curated allowlist rather than
  `information_schema` discovery, operators from a fixed vocabulary, and values
  are always bound as parameters.
- **Player comparison** with played-with and played-against drill-down.
- **Database Health** page for super admins.
- **Roles and delegation.** `super_admin` added above `admin`, plus a
  `contributor` role limited to CSV upload. Admin management is delegable via
  `can_manage_admins`. All roles require MFA.
- **Self-service admin invites** with QR-code TOTP enrolment, so a new admin
  scans rather than transcribes a secret.
- **CSV upload** for current and historical match results and player-match
  statistics, with sample files per dataset, plus an email-in channel as a
  second route.
- **Search-intent routing.** A query naming a club or season alongside a
  record, award or draft class now lands on that filtered view — "brownlow
  winner richmond" opens winners by season rather than career vote leaders.
- **AFLW-scoped global search and navigation.** Selecting AFLW switches the
  whole nav and the home-page search to that competition.
- **Collapsible tables and per-table filters** across the site, with applied
  filters carried in the URL.
- **Reorderable home-page sections**, dragged rather than stepped with arrows.
- **Brownlow Medal** queries, filters, and season/career views.
- **Draft origin filter** — filter the draft by drafting club and by
  feeder/state-league club.
- **Vitest** configuration and the first executable test suite; release-gate
  assertions separated into immutable and rolling-snapshot groups.

### Fixed
- `super_admin` could not actually log in.
- `afldb_app` had inherited read access to operational and auth tables;
  revoked, including `site_media`.
- Draft feeder club read from the raw query rather than the AFL club list, so
  state-league clubs resolve.
- `career_teammates_min` and the player-compare pair-discovery query were
  timing out against real data.
- Gate redirects were leaking the internal origin; middleware requires an
  absolute `Location`, so redirects are built from `AFLDB_BASE_URL`.
- Filtering a table below the first no longer jumps the page back to the top.
- Staged CSV row payloads were being double-encoded as JSON.
- `matches.attendance_status` is now set when promoting `match_results` rows.
- Single-use TOTP codes: a code cannot be replayed within its window.

---

## 14 August 2026 — Migration and foundations *(pre-git)*

### Added
- **Greenfield PostgreSQL 16 model** for VFL/AFL from 1897, replacing a legacy
  SQLite database that remains the read-only source. Bootstrap script creates
  `afldb_dev` and `afldb_test`, the `afldb_owner`/`app`/`import`/`backup` roles,
  and the `pg_trgm` and `unaccent` extensions.
- **Migration pipeline** in Python 3.12 with psycopg 3 and `COPY`, recording
  provenance and import batches, and a validation suite that reached 93/93
  parity checks with no rejected rows.
- **Next.js 15 application** — App Router, React 19, Server Components by
  default, with no separate API service.
- **Light and dark themes**, from the supplied mock UI.
- **Awards and honours** — Rising Star, All-Australian, club best-and-fairests
  and other competition awards, imported from the raw footywire and draftguru
  sources.
- **Global search beyond players** — rounds, years, grounds, awards and record
  categories.
- **Admin authentication** — `afldb_auth` role, `create-admin` tool, scrypt
  password hashing, and TOTP MFA.
- **Backup and tested restore procedure.**

### Changed
- **Brownlow totals do not come from match rows.** Per-game votes exist only
  for 1931–1934 and 1984–2025, so season and career totals use the
  season-level source. The legacy database's derived career totals were
  deliberately not copied forward.
- **`NULL` is not zero.** A missing historical statistic means "not recorded",
  tracked by season, statistic and grain, and preserved as such in the UI.
- **Historical club identity is explicit.** Renames and relocations share an
  organization without rewriting the historical club identity; mergers stay
  separate organizations and are linked, not combined. Neither club's
  statistics count toward a merged club.
- Deployment standardised on a single `main` branch, pulled from GitHub with a
  deploy key, rather than copying archives to hosts.

### Fixed
- `restore-test.sh` could leave the source DSN unchanged before `pg_restore
  --clean`, and a trailing `|| true` was suppressing every restore failure
  rather than only extension-owner warnings.

---

## Notes on scope

Family relationships are present in the legacy source but have not been
migrated, and are intentionally absent from the public site.

The core dataset was assembled from AFL Tables via
[fitzRoy](https://jimmyday12.github.io/fitzRoy/), with additional source
material for Brownlow voting, birth dates, and draft records.
