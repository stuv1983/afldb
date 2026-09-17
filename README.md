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
  fitzRoy) as the sole automatic, canonical-write provider, with other providers kept only as
  deprecated, manually-run fallbacks for comparison; and vetted data intake — a CSV upload
  workflow (`staged → validated → approved → promoted`) with a matching email-in channel, both
  landing in the same reviewed, audited pipeline.
- **People & access**: administrator invitation/management and beta-access control (access
  codes, allowlisted emails, early-access requests).
- **Site**: page content/publishing and site-wide settings (home page composition, Grid Solver
  audience, theme and layout).
- **Operations**: an ad-hoc, allowlisted data QA query builder, database and application health
  reporting, natural-language search telemetry and reader feedback, and the audit trail.

See `docs/admin-and-beta.md` for the full model.

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
[licence](https://jimmyday12.github.io/fitzRoy/LICENSE.html)). AFLW data is drawn from
aflwstats.com. Draft history is cross-referenced against DraftGuru. AFLDB is an independent,
non-commercial reference and is not affiliated with the AFL.
