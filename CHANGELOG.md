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

### Birth-date enrichment from all-time club lists — 19 August 2026

DOB coverage rose from 12,472 to 13,356 of 13,361 players (100.0%) on the
dev database. The five clubs missing from the legacy club register —
Fitzroy (759 gaps), University (82), Brisbane Bears (44), Sydney/South
Melbourne (3) and North Melbourne (1) — had their AFL Tables all-time
player list pages captured as CSVs; a new pass
(`tools/migration/enrich_birth_dates_from_club_lists.py`) matches them by
name within each club's roster, corroborated by games/goals/seasons, and
fills only missing dates. 3,944 rows agreed with existing data, one
conflict (a 2-day discrepancy on an 1868 date) was flagged as a
data_issue rather than overwritten, and the 5 players still without a
date are blank in the source as well. Same-name pairs (two Fitzroy Tom
Meehans, two Sydney John Fogartys) disambiguate on exact games-at-club
with goals and span as non-blocking vetoes. Not yet run against prod.

### Grid solver: rivalries, marquee matches and more — 19 August 2026

Seven new builders (the catalogue is now 107 across 11 categories),
widening what a board can ask based on data already in the schema.

#### Added
- **Rivalries & marquee matches**, a new category. `match_event_played` /
  `match_event_min` read `matches.match_event`, whose complete tagged
  vocabulary is Anzac Day, Dreamtime at the 'G and King's Birthday.
  `matchup_played_min` ("X+ matches between two clubs") takes the two
  organizations as parameters, so any derby — Showdown, Western Derby,
  QClash — is expressible without a derby definition existing in the
  schema. Good Friday and Easter Monday fixtures are not tagged in the
  source data and are reachable only as a matchup.
- **`never_played_in_draw`** — the negation sibling of
  `drawn_matches_min`, following the `never_played_finals` pattern.
- **`debuted_in_decade`** — one-parameter convenience over
  `debuted_between`, matching `played_in_decade`'s shape.
- **`venue_stat_total_min`** ("X+ of a stat at venue, career") — the
  aggregated sibling of `venue_game_stat_min`, so "100+ goals at the MCG"
  is now askable.
- **`venue_goals_max`** ("X or fewer goals at venue, having played
  there") — goals only, because it is the one statistic recorded for
  every player-game; a career max over an era-limited stat would silently
  count unrecorded games as zero.
- **Natural-language wiring (parser v15).** "played on anzac day" /
  "3+ anzac day games", "played in 3 showdowns" (also western derby,
  qclash, sydney derby — organizations resolved through the club
  directory at parse time), and "debuted in the 1990s" / "debuted
  between 2000 and 2009" all compile to the new builders as
  `careerPredicates`. Guard rails: a superlative governing the phrase
  ("most anzac day games") declines rather than misreading as a 1+
  list; a marquee/rivalry predicate alongside a season range declines
  rather than silently dropping the seasons; and a max/min aggregation
  with no metric over structure-only content now normalises to a list,
  so "players WHO PLAYED on anzac day" (whose "who played" reads as the
  "who played the most…" idiom) returns the full list instead of a
  25-row truncation. `DECADE_RE` also accepts "during the 1990s".

### Schema and privilege review — 17 August 2026

A design review of the 43 migrations and the privilege reconciler. Nothing here
was a live defect; every item is a rule that existed only in prose, in a
comment, or in the habits of the one program that writes a table. Two
migrations: `044_schema_integrity.sql` and `045_import_write_is_fail_closed.sql`.

#### Fixed
- **Write privileges fail closed too.** Migration 039 inverted the schema-wide
  default privilege for `afldb_app` and left the identical mechanism running for
  `afldb_import`, so each new operational table was fully writable and
  `TRUNCATE`-able by the ETL role until someone ran the reconciler. Its scope is
  now `afldb_meta.import_writable_tables`, opted into with
  `afldb_meta.grant_import_write()` — the mirror of `grant_app_read()`. Both
  install scripts now revoke the defaults instead of re-granting them on every
  re-run.
- **`afldb_import` could reset the auth sequences.** 039 revoked the operational
  tables and not their identity sequences, and migration 011 had granted
  `UPDATE` on every sequence in `public` — which is what `setval()` needs. The
  ETL role could reset `auth_users_id_seq` and break every later insert on a
  duplicate key without touching the table itself.
- **`afldb_import` could truncate `site_settings`.** The reconciler inferred
  "operational" as the complement of what `afldb_app` may read, and
  `site_settings` is deliberately app-readable, so the ETL role held `DELETE`
  and `TRUNCATE` on the site's runtime configuration. Two registries, no
  inference.
- **The reconciler now reconciles `afldb_auth`.** It re-granted an enumerated
  spec and never revoked, so any grant added by hand or left behind by an
  abandoned migration survived every run. Anything outside the spec is now
  revoked, and its sequence grants are narrowed from the whole schema to the
  tables it writes.
- **Stale registry rows are cleared.** A registry entry outlived its dropped
  table, so a later table reusing the name would have been granted on the next
  reconcile with nothing deciding that afresh.
- **Source keys scoped by source.** `player_relationships` and
  `father_son_selections` keyed `source_record_id` on its own, which forbade a
  second source and — being a plain `UNIQUE` — exempted null-keyed rows
  entirely. Both now match migration 042's
  `UNIQUE NULLS NOT DISTINCT (source_id, source_record_id)`.
- **Case-insensitive email uniqueness** on `auth_users`, `beta_allowed_emails`
  and pending `beta_join_requests`. Seven application write paths lowercase
  before storing; the database knew about none of them.
- **Foreign-key indexes the integrity check can use.** Four `player_id` indexes
  were partial on link status, which a `DELETE` from `players` cannot imply, so
  each of those tables was scanned instead. Re-predicated on
  `player_id IS NOT NULL`, the shape migration 041 established.

#### Added
- `CHECK` constraints for `data_submission_rows.verdict` (the only status column
  with no vocabulary behind it, and it gates approval) and for
  `site_media.byte_size = octet_length(bytes)`.
- `afldb_meta.revoke_app_read()` and `revoke_import_write()`, so un-registering
  a table is not a hand-written `DELETE` plus `REVOKE`.
- `afldb_meta.owned_sequences()`, which finds a table's identity sequences
  through the catalogue dependency rather than by guessing at a name.

#### Changed
- Comments recording three decisions that were previously unstated or wrong: the
  provenance foreign keys are unindexed deliberately (append-only parents), the
  awards tables keep both unique indexes because the two keys are not
  interchangeable, and `clubs_org_span_ck` checks a season span rather than the
  organization rule the comment above it in migration 017 describes.

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
