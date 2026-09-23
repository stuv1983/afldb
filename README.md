# AFLDB

A historical Australian football statistics reference covering the VFL/AFL from 1897 to the
current season, plus AFLW from 2017 as a separately scoped model. AFLDB is an independent,
non-commercial project backed by PostgreSQL, built around player, club, coach, venue, match,
Brownlow, draft and awards data, with statistical search, comparison and record tools on top.
It is not affiliated with the AFL.

The project is currently in closed beta, gated behind an access-code/allowlist mechanism ahead
of a public launch (see [Status](#project-status)).

## What AFLDB provides

**Browsing and records**
- Player, club, coach and venue profile pages, season pages, match scorecards and club-vs-club
  and coach-vs-coach comparison pages.
- Draft history, the Brownlow Medal, awards and honours (All-Australian, Rising Star, Coleman
  Medal, club best-and-fairests, AFLPA 22Under22, state-league medals), Hall of Fame and honour
  teams.
- Curated special records: after-the-siren kicks, first-kick goals, and family/father–son
  playing links.
- AFLW seasons, clubs, players and matches under `/aflw`, modelled and rendered separately from
  the VFL/AFL data.

**Search**
- Global search across players, clubs, venues and seasons, including free-text club matchups
  (`Richmond v Essendon 1984`), with autocomplete.
- Statistical player search (`/players`) over career totals — games, goals, finals, clubs,
  seasons, wins, premierships and Brownlow votes — via a typed, allowlisted filter model (no
  arbitrary SQL is ever accepted from a request).
- Natural-language search (`/search`): a typed question such as "most brownlow votes without
  winning one" is answered inline. This is a **deterministic parser and compiler pipeline** —
  canonicalise → parse → plan → validate → compile → PostgreSQL → answer — with no LLM anywhere
  in it. Unsupported or ambiguous questions decline honestly rather than guessing.
- Grid Solver (`/grid-solver`): a 3×3 board of named statistical questions (career milestones,
  single-game feats, finals, venues, rivalries, awards, draft history and more) resolved against
  fixed, parameterised builders.

**Appearance**
- A Super Admin–controlled theme and layout: `classic` (today's default) or `sidebar`
  (persistent left-hand navigation), independent of the light/dark appearance setting.

## Data model and philosophy

- **`NULL` is not zero.** A missing historical statistic means "not recorded", not a recorded
  zero — enforced end-to-end through the schema, query layer and UI. Coverage/availability is
  tracked per season and per statistical grain, so a field is never filterable in a way that
  would silently exclude every player from before it was collected.
- **Historical identity is explicit.** Players are identified by a stable numeric ID, never by
  name alone. Clubs exist at two layers: historical identities (which carry matches, stints and
  ladder rows) and organisations (which carry lineage and "clubs played" totals) — a rename or
  relocation shares an organisation, a merger does not.
- **Authoritative sources, not the most convenient column.** For example, Brownlow career and
  season totals are always read from the dedicated vote-count table, never derived by summing
  per-game votes, because per-game votes only exist for part of AFL history.
- **Derived data is always reproducible.** Career/season aggregates and leaderboards are rebuilt
  from authoritative source tables by a documented process; they are never hand-edited and never
  the only copy of a fact.
- **Provenance-aware acquisition.** Data enters through bulk historical migration, scheduled
  current-season updates, or vetted admin/email CSV intake — each path is tracked with its own
  batch and audit record, and nothing reaches the statistical tables outside the import role.
- **Rebuild and promotion, not hand edits.** The canonical dataset can be rebuilt from source
  into a disposable test database and, following a documented, checked procedure, promoted to a
  live environment without disturbing that environment's own operational data (accounts, beta
  access, settings, audit history). See `docs/production-promotion.md`.

## Application stack

- **Framework**: Next.js 16 (App Router), React 19, TypeScript 5
- **Database**: PostgreSQL 16, with `pg_trgm` and `unaccent`
- **Query layer**: `postgres.js` (parameterised SQL; no ORM)
- **Data acquisition/ETL**: Python 3.12 with `psycopg` 3
- **Tests**: Vitest (unit/integration) and Playwright (browser/E2E)
- **Runtime**: standalone Next.js output behind a Node cluster supervisor, deployed with systemd
  and Caddy

## Local development

### Prerequisites

- Node.js 22 and npm
- PostgreSQL 16
- Python 3.12 (only needed for data acquisition/validation tooling)
- Linux is the production runtime and is required for Linux-specific deployment, runtime and
  performance acceptance. Day-to-day development and the Vitest/integration test suite also run
  on Windows.

### Install and configure

```bash
npm ci
cp .env.example .env
```

Fill in `.env` with local database roles and secrets — see the comments in `.env.example`, which
documents every variable in detail. Key ones:

| Variable | Purpose |
|---|---|
| `AFLDB_ENV` | Transport-security posture (`development`/`staging`/`production`). Does **not** control search indexing. |
| `AFLDB_INDEXING` | Search-engine indexing gate; fails closed. |
| `DATABASE_URL` | Read-only application connection (`afldb_app`). |
| `AFLDB_IMPORT_DATABASE_URL` | Elevated role used only by ETL/import tooling (`afldb_import`). |
| `AFLDB_OWNER_DATABASE_URL` | Schema owner, used only by migrations (`afldb_owner`). |
| `AFLDB_AUTH_DATABASE_URL` | Role used only by login, beta gate and data-submission tables (`afldb_auth`). |
| `AFLDB_TEST_DATABASE_URL` | Integration test database; must end in `_test`. |
| `PORT` | Application port (defaults to 3100). |
| `AFLDB_WORKERS` / `AFLDB_POOL_MAX` | Cluster worker count and per-worker connection pool size. |

The application connects with a least-privilege set of PostgreSQL roles rather than one shared
credential: the public site is read-only, the auth path can write only operational tables, and
statistical tables are writable only by the import role.

### Run

```bash
npm run dev        # dev server on :3100
npm run build       # production build (standalone output)
npm start           # run a production build
```

## Database and migrations

Ordered, checksummed SQL migrations live in `src/db/migrations/`, applied with a small runner:

```bash
npm run db:migrate          # apply pending migrations
npm run db:status           # show migration status
npm run db:migrate:test     # apply against the test database
npm run db:privileges       # reconcile role grants from the app/import-readable registries
```

Newly added public tables are unreadable/unwritable by the application and import roles by
default; a table opts in explicitly from its own migration. An integration test asserts the
live grants match the registry exactly.

Integration tests refuse to run against any database whose name does not end in `_test`, as a
safeguard against pointing them at development or production data.

## Testing

```bash
npm run typecheck     # TypeScript checks
npm test              # Vitest: unit, integration and release-gate tests
npm run test:e2e       # Playwright end-to-end tests
npm run nl:stress      # run the natural-language search corpus through the parser directly
npm run nl:ui          # drive the natural-language corpus through the rendered page
```

## Admin and data management

Three roles: `super_admin`, `admin` and `contributor`. Every admin page, route handler and
Server Action is gated by a named capability (`src/lib/auth/capabilities.ts`), rather than a
bare role check, so access can be delegated per capability. A contributor's admin access is
limited to the CSV upload form and changing their own password. Sign-in requires a password and
a TOTP code; sessions are individually
revocable database rows, and every administrative action is written to an append-only audit log.

Broad areas covered by the admin area:

- **Data editing**: a general data editor plus dedicated surfaces for coaches, the draft, season
  lists, fixtures, club leadership, Brownlow votes, awards and honours (including a lifecycle
  workflow), and the special-record families (after-the-siren, first-kick-goal).
- **Player-link review**: a queue for resolving ambiguous or unmatched player references
  produced by imports and CSV submissions.
- **Acquisition**: scheduled current-season score/fixture updates, sourced from AFL Tables (via
  fitzRoy) as the scheduled automatic canonical-write provider. The official AFL.com.au feeds are
  an implemented, guarded co-source for match data and Brownlow votes. Their Super Admin switches
  default off, and their timers are not enabled; see
  [AFL API integration](#afl-api-integration-current-season-data-and-brownlow-votes).
  Other providers are kept only as deprecated, manually-run fallbacks for comparison. There is also
  vetted data intake — a CSV upload
  workflow (`staged → validated → approved → promoted`) with a matching email-in channel, both
  landing in the same reviewed, audited pipeline.
- **People & access**: administrator invitation/management and beta-access control (access
  codes, allowlisted emails, early-access requests).
- **Site**: page content/publishing and site-wide settings (home page composition, Grid Solver
  audience, theme and layout).
- **Operations**: an ad-hoc, allowlisted data QA query builder, database and application health
  reporting, natural-language search telemetry and reader feedback, and the audit trail.

See `docs/admin-and-beta.md` for the full model.

## AFL API integration (current-season data and Brownlow votes)

AFLDB can take current-season match data and Brownlow Medal votes from the official AFL.com.au
JSON feeds (source key `afl_api`). AFL Tables stays AFLDB's primary canonical source; the AFL API
is a guarded co-source alongside it. The detailed architecture, identity model and command
reference are in `docs/acquisition/AFLDB-2026-API-ACQUISITION.md` §14. The Brownlow operator runbook
is `docs/acquisition/AFLDB-2026-BROWNLOW-LIVE-COUNT-RUNBOOK.md`. Acceptance evidence is in the
AFLDB-ISSUE-228 runbook under `issues/`.

### Pipeline

```text
Official AFL.com.au feed
        ↓  acquire: network → files only, raw bytes verbatim, manifest.json written LAST
raw retained snapshot     data/sources/afl_api/{matches|brownlow}/<label>/  (immutable, gitignored)
        ↓  settle: manifest re-hash + registry + bundle checks BEFORE any database connection
source/staging observations   staging.source_records / source_record_versions / source_payloads
                              + typed projections staging.afl_api_match, afl_api_player_match,
                                afl_api_brownlow_vote
        ↓
match + player identity resolution   (never created from AFL API data; see below)
        ↓
guarded canonical settle   applyCanonicalUnit → matches, match_period_scores,
                           player_match_stats, brownlow_round_votes; ledger canonical_applications;
                           counters in import_batches.validation_result
        ↓
independent validation / replay   (identical re-run = zero canonical writes)
```

Acquisition and settle are separate steps: a settle never calls the network, and it reads only an
already-acquired snapshot named by `--label`. A snapshot with no `manifest.json` is incomplete. A
failed acquisition deletes its own partial directory.

### Where AFL Tables remains involved

The AFL API has **not** replaced AFL Tables provenance.

- **Ownership.** Every canonical row records its owning source. Most matches in a season are
  AFL Tables-owned (via fitzRoy). When the AFL API observes an AFL Tables-owned match, it only
  **corroborates** it:
  - agreeing values: no write (counted `corroboratedForeignOwned`);
  - disagreeing values: no write, and an open `source_disagreement` data issue.

  A settle never changes `matches.source_id` on an existing row. The AFL API owns only matches it
  promotes first. Attendance is never sourced from the AFL API; AFL Tables attendance may enrich an
  AFL API-owned match.
- **Player identity.** Canonical players come from the AFL Tables/fitzRoy lineage and the sanctioned
  registration paths. The AFL API never creates a `players` row. It only links its provider ids
  (`CD_I…`) to existing players.
- **Fixture identity.** Brownlow votes for an AFL Tables-owned match resolve through that canonical
  fixture (see `--use-fixture-identity` below).

### Game / current-season data

What is acquired, per concluded match:
- the season match feed: fixture, result, final score, round, venue and status;
- CFS `playerStats`: player-match statistics;
- CFS `matchRoster`: period (quarter) scores, converted to AFLDB's cumulative form, and roster
  context.

Only `CONCLUDED` matches are applied. A non-concluded (e.g. `POSTGAME`) record is *deferred*, not
rejected, and applies when a later poll sees it concluded. Round numbers go through one translation
module (`afl-api-rounds.ts`). From 2024 the AFL's "Opening Round" is round 0, so provider rounds are
offset against AFLDB's canonical rounds; finals need their published labels.

| Step | Command |
|---|---|
| Acquire a season snapshot | `npm run acquire:afl-api -- --season <YYYY> [--status CONCLUDED] [--since YYYY-MM-DD] [--match CD_M…]` |
| Acquire fixtures only (Brownlow fixture identity) | `npm run acquire:afl-api -- --season <YYYY> --fixtures-only`, then `npm run settle:afl-api-fixtures -- --label <label> (--validate-only \| --dry-run \| --apply)` |
| Offline contract check (no DB) | `npm run settle:afl-api -- --label <label> --validate-only` |
| Rehearse (full write path, rolled back) | `npm run settle:afl-api -- --label <label> --dry-run --auto-apply --require-complete-source` |
| Apply | `npm run settle:afl-api -- --label <label> --apply --auto-apply --require-complete-source` |
| Exception report (read-only) | `npm run settle:afl-api -- --label <label> --report` |

`--apply` without `--auto-apply` records observations, projections and candidates, and writes no
canonical rows. The scheduled chain (`deploy/afldb-settle-afl-api.sh`) always uses `--apply
--auto-apply --require-complete-source`.

`npm run emit:afl-api` is **not** the full-season path. It is the DB-free backtest over a fixed set
of captured samples: 14 matches plus four Brownlow seasons. It writes
`docs/rebuild-manifests/afl_api/backtest-20260919.json`.

### The AFL API player bridge

Settle resolves AFL API players **only** through `external_identities` rows for source `afl_api`.
An unbridged `CD_I` leaves that player's row unresolved (`unresolved_identity`); it is never
guessed from a name.

- **Only writer.** The bridge importer, `tools/migration/import_afl_api_player_bridge.py`, is the only
  tool that writes those rows. Manual identity SQL is not a supported path.
- **Name corrections.** A wrong name part on a canonical player is corrected through the admin data
  editor (the audited `saveEdit` writer), never by `UPDATE`.

| Purpose | Tool | Target |
|---|---|---|
| Full-season evidence (read-only), DEV | `npm run emit:afl-api-player-bridge -- --label <snapshot> (--validate-only \| --out <path>)` | pinned to `afldb_dev` |
| Full-season evidence (read-only), TEST | `npm run emit:afl-api-player-bridge-test -- --label <snapshot> (--validate-only \| --out <path>)` | pinned to `afldb_test` |
| Import links | `python tools/migration/import_afl_api_player_bridge.py [--target afldb_test\|dev] (--validate-only \| --dry-run \| --apply) --artefact <path>` | named target only; no production target exists |
| Audit persisted links (read-only), DEV | `npx tsx tools/current-season/audit-afl-api-player-bridge-persisted.ts --artefact <path>` | `afldb_dev` |
| 14-match bootstrap sample (historical S5) | `tools/migration/build_afl_api_player_bridge.py` | `afldb_test`; **not** the full-season path |

Evidence emitters:
- They open a read-only session (`default_transaction_read_only` set at connection startup). Before
  reading evidence, they prove the live `current_database()` and read-only state.
- They accept no DSN on the command line, and each can reach only its own pinned database.
- They refuse to overwrite an existing `--out` file whose content differs.
- A provider links only on exact stat-vector evidence from that database's own
  `player_match_stats`. Surname disagreements and conflicting candidates are reported, not linked.

**Bridge artefacts are database-specific.** An artefact's `candidate_player_id` values are that
database's numeric `players.id` values. `afldb_test` and `afldb_dev` ids are not interchangeable,
and parity between them has never been proven. The importer enforces this with a target-bound
provenance gate:
- `--target afldb_test` accepts only an artefact built from `afldb_test` by
  `emit-afl-api-player-bridge-test.ts`;
- `--target dev` accepts only one built from `afldb_dev` by `emit-afl-api-player-bridge.ts`.

Build the bridge separately in each database. Never copy one across.

Import semantics are append-only:
- a new provider id is inserted;
- a provider already linked to the same player is a no-op (`already_linked`);
- a provider already linked to a **different** player is withheld, and an
  `afl_api_identity_contradiction` data issue is opened. The existing link is never updated or
  deleted.

`--validate-only` writes nothing. `--dry-run` runs the full write path and rolls back.

### Guards on the settle path

- **Two-key enablement.**
  - Each unit has a Super Admin site setting (`acquisition.afl_api_current_season_enabled`,
    `acquisition.afl_api_brownlow_enabled`), both default off.
  - Brownlow also requires a deployment-level `AFLDB_AFL_API_BROWNLOW_ENABLED=true` in the process
    environment.
  - Before any write, a preflight proves that the database the switches were read from and the
    canonical writer's database are the same live database.
- **Offline before online.** The manifest is re-hashed, and the registry, identities and bundle
  contract are validated, before PostgreSQL is opened.
- **Source completeness.** `--require-complete-source` refuses to commit when the source is
  incomplete. It is the production-intended path for match data. Leaving it off is not an accepted
  shortcut.
- **Season gate.** Canonical writes are accepted only for a season listed as in progress in
  `data/reference/seasons.json`.
- **Ownership, identity and match safety.**
  - A foreign-owned row is corroborated, never overwritten.
  - An AFL API row never rewrites an existing match's round, date, club or season.
  - A plausible existing fixture is never inserted a second time.
  - Contradictions and refusals are persisted as `data_issues` / `import_rejections`, not dropped.
- **Idempotence.** An identical re-settle of the same snapshot makes zero canonical inserts or updates
  and appends no versions. Re-polls only refresh observation heads.

### Brownlow Medal votes

The flow:
1. **Acquire.** `npm run acquire:afl-api-brownlow -- --season <YYYY>` fetches two feeds:
   - `bfawards/season/<CD_S…>`: the match-by-match vote sets;
   - `bfawards/leaderboard/season/<CD_S…>`: the official leaderboard.

   They are written to `data/sources/afl_api/brownlow/<label>/`, manifest last.
2. **Settle.** Run:
   ```text
   npm run settle:afl-api-brownlow -- --label <label> --validate-only
   npm run settle:afl-api-brownlow -- --label <label> --dry-run --auto-apply [--use-fixture-identity]
   npm run settle:afl-api-brownlow -- --label <label> --apply --auto-apply [--use-fixture-identity]
   ```
   `--observe-only` records observations only and never writes canonical rows.

Settle behaviour:
- **Vote sets.** Each represented match carries exactly one 3-vote, one 2-vote and one 1-vote player:
  six votes, with no duplicate position or player. A match's vote set is applied **all or nothing**
  in its own savepoint, so a partial 3/2/1 is never stored. Canonical storage is the match-level
  `brownlow_round_votes` table (season, player, round), with full provenance. Only home-and-away
  rounds carry votes.
- **Identity.** Players resolve only through the `afl_api` bridge.
  - Matches resolve through the typed `staging.afl_api_match` row when the AFL API match settle
    planned that match.
  - If the canonical match is **AFL Tables-owned** (most matches), no typed row exists by design.
    The vote set must then resolve through the canonical fixture instead, using the explicit
    `--use-fixture-identity` flag. That route:
    - reads the match's fixture observation already persisted on the observation spine (by
      `settle:afl-api` or `settle:afl-api-fixtures`);
    - matches its season, both clubs and exact venue-local date against `matches`, using SELECTs
      only;
    - refuses zero or several hits rather than guessing, and never re-owns the AFL Tables row.
  - A write-capable run that needs this route but lacks the flag stops **before** any write and
    names the flag. It is never enabled implicitly.
- **Partial application, then recovery.**
  - A vote set whose player or match cannot be resolved is refused, not guessed. It is recorded as
    a data issue, while every resolvable set still applies.
  - Once the missing identities are legitimately resolved (players registered, bridge rebuilt and
    imported), re-settling the **same** snapshot fills the refused sets.
  - Sets already applied are no-ops, so nothing needs deleting.
- **Reconciliation.** Each settle reconciles the vote sets against the official leaderboard
  (`leaderboardPlayersCompared` / `leaderboardMismatches`). Acceptance also includes an independent
  read-only reconciliation of the canonical rows against the leaderboard.
- **Completed counts.** The feed reports `status: CONCLUDED` once the count is complete. A completed
  count can be acquired and ingested **after** the ceremony; live capture is not required.
  - The season gate still applies, so ingest while the season is in progress in AFLDB, before
    rollover.
  - `--allow-completed-season-backtest` is an `afldb_test`-only exception for historical backtests.
    It is refused on any other database.

Worked example, the 2026 acceptance on `afldb_test`:
- **First apply.** It stored 180 of 207 vote sets and refused 27, whose 23 players were not yet
  linked.
- **After the identity repair.** The same completed-count snapshot was re-settled with
  `--use-fixture-identity` and added exactly the 81 missing rows (27 × 3).
- **Identical replay.** It made zero canonical changes.

```text
207 vote sets
621 canonical vote-allocation rows
1,242 total votes
183 leaderboard players compared: 0 missing, 0 extra, 0 vote-total mismatches
```

### Payload stability (backtest assertion 9)

AFLDB versions a source record by a hash of its **parsed, canonicalised** payload (sorted keys,
array order kept), not of the raw bytes. `hash_exclusions` is empty for every AFL API family, so a
changing field is never silently ignored.

Backtest assertion 9 checks that this is safe. It compares two genuine captures of the same
concluded match (`CD_M20260142801`, 2026-09-19), taken 72 minutes apart by different scripts in
different serialisations. It runs them through the production emitters with no exclusions.
- **Result.** The match, roster and all 46 player-stat records are canonically unchanged.
- **What it establishes.** Re-polling a concluded match does not create spurious versions, and
  serialisation differences do not matter.
- **What it does not establish.** It does not guarantee every future payload is stable. If a
  genuine difference appears, it is recorded as evidence, and an exclusion needs three evidence
  pairs and a regression test.

### Boundaries and follow-ups

- **Supported architecture.** Acquisition, settle, bridge emitters and importer, guards and replay
  as described above. The match-data path has been applied and smoke-tested on DEV. The Brownlow
  completed-count path, with bridge, recovery and replay, has been proven end to end on
  `afldb_test`.
- **Not yet enabled (AFLDB-ISSUE-232).** The systemd units (`deploy/afldb-settle-afl-api.*`,
  `deploy/afldb-settle-afl-api-brownlow.*`) ship but are not installed or enabled on any host.
  The admin current-season panel does not yet show the AFL API units' last run.
  - The Brownlow chain script does not pass `--use-fixture-identity`. This is deliberately
    fail-closed: for a season whose matches are AFL Tables-owned, it refuses, safely, before writing.
    Whether the scheduled chain should supply the flag is an open operator decision under
    AFLDB-ISSUE-232. The match-data chain must also run before the Brownlow settle.
  - The completed-count path is currently run by an operator.
- **Tracked successors.**
  - AFLDB-ISSUE-229: fixture ingestion.
  - AFLDB-ISSUE-231: the retired-identity rekey search for `afl_api` and the match-family absence
    sweep. Both are hardening; today's code fails safely without them.
  - AFLDB-ISSUE-233: season discovery and the season-rollover runbook changes.
  - AFLDB-ISSUE-234: optional extra feeds (extended statistics, umpires, play-by-play).
  - AFLDB-ISSUE-235: `afl_api` player-link adjudication in `/admin/player-links`.
- **TEST-only accommodation, not normal operation.** During acceptance, `afldb_test` was settled on
  an artificial observation clock. This was to continue its pre-existing future-dated benchmark
  residue, a test-database hygiene problem tracked as AFLDB-ISSUE-230. Real runs always observe at
  the real clock, and no such clock exists on DEV or production.

## Deployment and operations

AFLDB deploys as a standalone Next.js service managed by a Node cluster supervisor under
systemd, behind Caddy for TLS termination. Scheduled current-season data settlement and email
intake each run as their own systemd service/timer. Detailed, host-specific procedures
(deployment, backup/restore, and database rebuild/promotion) are kept in `docs/` rather than
duplicated here:

- `docs/architecture.md` — system architecture and data-model rules
- `docs/deployment.md` — deployment mechanics
- `docs/backup-restore.md` — backup and restore verification
- `docs/production-promotion.md` — promoting a rebuilt database to a live environment
- `docs/admin-and-beta.md` — administration, beta access and data intake
- `docs/search.md` — search, Grid Solver and natural-language search internals
- `docs/aflw.md` — the AFLW data model
- `docs/data-dictionary.md` — schema reference

## Repository layout

```text
src/app/             Next.js routes (Server Components by default) and route handlers
src/components/      Shared UI components
src/db/              Query layer (postgres.js, parameterised SQL) and migrations
src/search/          Global search, statistical player search, Grid Solver and NL search
src/lib/             Auth, capabilities, site settings, email, SEO and shared helpers
tools/db/            Migration runner, privilege reconciliation, test-database rebuild
tools/migration/     Bulk historical import and enrichment jobs
tools/aflw/          AFLW parsing and staging load
tools/current-season/ Current-season updates and in-season settlement
tools/validation/    Migration/data-parity validation
tools/email_intake/  Email-in CSV intake poller
tools/maintenance/   Host setup, backup/restore, privileges
deploy/              systemd units, Caddyfiles, cluster supervisor
tests/               Unit, integration and end-to-end tests
docs/                Architecture, data, search, admin and operations documentation
```

## Project status

AFLDB is in closed beta: `AFLDB_BETA_GATE` restricts the whole public site to visitors admitted
via an access code, allowlisted email, or admin session, and search-engine indexing is off until
a deliberate cutover. A public launch has not occurred.

## Data sources and acknowledgements

The core historical dataset was originally assembled from AFL Tables via
[fitzRoy](https://jimmyday12.github.io/fitzRoy/) (see their
[licence](https://jimmyday12.github.io/fitzRoy/LICENSE.html)). Current-season match data and
Brownlow votes can also be taken from the official AFL.com.au feeds (see
[AFL API integration](#afl-api-integration-current-season-data-and-brownlow-votes)). AFLW data is drawn from
aflwstats.com. Draft history is cross-referenced against DraftGuru. AFLDB is an independent,
non-commercial reference and is not affiliated with the AFL.
