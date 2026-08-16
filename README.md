# AFLDB

A read-oriented historical Australian football statistics site covering the
VFL/AFL from 1897 to the current season, plus AFLW from 2017. Player, club,
season, match, venue, records, Brownlow, draft, and awards pages, backed by
PostgreSQL.

## Status

**Closed beta.** Two hosts are live:

| Host | Serves | Indexable |
|---|---|---|
| `beta.afldb.com` | The application, behind the closed-beta gate | No |
| `afldb.com` | A static coming-soon page with an early-access form | Yes |

The application runs as a four-worker Next.js standalone service under systemd,
behind Caddy with Let's Encrypt TLS, against a self-managed PostgreSQL 16 on the
same droplet. A separate development server carries the same stack.

The public launch — the application itself on `afldb.com`, indexable — has not
happened. Readiness gates remain open around data quality, backup automation,
and untested restore-failure paths. See [Production cutover](docs/production-cutover.md).

The current data snapshot covers 1897–2026, loaded through 9 August 2026. The
2026 season is marked provisional.

Recent changes are recorded in the [changelog](CHANGELOG.md).

## Features

**Core**
- Player profiles, career and season totals, club history, and match logs
- Historical club identities and organization lineage across renames and relocations
- Season ladders, results, finals, premiers, and leading players
- Match scorecards, team lists, player statistics, attendance, and venue details
- Career, season, and single-match record leaderboards

**Competitions and honours**
- Brownlow Medal: season-by-season winners and vote history from 1924, plus career vote leaders
- Draft and recruitment from 1981, filterable by year, drafting club, feeder/state-league club, and type
- Coleman, Norm Smith, Rising Star, All-Australian, club best-and-fairests, and other awards, each with a winners history
- Australian Football Hall of Fame inductees and honour teams
- AFLW as a separate competition: players, clubs, seasons, ladders, matches, scoring progressions, match search, and its own scoped global search

**Search**
- Global search and autocomplete across players, clubs, venues, seasons, rounds, awards, and record categories
- Intent-aware routing — a query naming a club or season alongside a record, award, or draft class ("brownlow winner richmond", "most goals essendon") lands on that filtered view rather than a bare page
- Typed, shareable player and match searches with allowlisted filters and sorting
- Player comparison with played-with and played-against drill-down
- A collapsible filter panel on every table, with applied filters carried in the URL

**Administration**
- Role-based admin (`super_admin`, `admin`, `contributor`), all requiring TOTP MFA, with QR-code enrolment and delegable admin management
- CSV upload and an email-in intake channel for match results and player statistics
- Runtime site settings: home-page layout, record of the week, and the coming-soon page and footer, editable without a deploy
- Grid Solver and a hidden query builder for data QA
- Database health reporting

Family relationships exist in the legacy source but have not been migrated, and
are intentionally absent from the public site.

## Data

The latest clean migration recorded in [the migration report](docs/migration-report.md):

| Dataset | Count |
|---|---:|
| Seasons | 130 |
| Historical club identities | 24 |
| Players | 13,361 |
| Matches | 17,027 |
| Player-match rows | 694,210 |
| Venues | 52 |
| Brownlow season rows | 16,120 |
| Draft picks | 6,810 |

The migration completed with no rejected rows and 93/93 validation checks
passing. The legacy SQLite source is opened read-only; AFLDB never writes to it.

### Three rules govern the model

1. **Brownlow totals do not come from match rows.** Per-game votes exist only
   for 1931–1934 and 1984–2025, so season and career totals use the
   authoritative season-level source, preserving all 79,113 recorded votes.
2. **`NULL` is not zero.** A missing historical statistic means "not recorded",
   not a recorded zero. Availability is tracked by season, statistic, and grain,
   and the UI preserves the distinction.
3. **Historical identity is explicit.** Renames and relocations share an
   organization without rewriting historical club identities; mergers remain
   separate organizations, linked rather than combined. Player identity uses
   stable numeric IDs, never names.

Derived career, season, and club-season summaries are reproducible from
authoritative tables and are rebuilt rather than hand-edited.

**AFLW sits outside the normalised model.** It is served from a read-only `aflw`
schema of views over the staged scrape, because AFLW played two seasons in
calendar 2022 and the core model keys a season by year. See [AFLW](docs/aflw.md).

## Technology

| Area | Implementation |
|---|---|
| Application | Next.js 15 App Router, React 19, TypeScript 5 |
| Rendering | React Server Components by default |
| Database | PostgreSQL 16 with `pg_trgm` and `unaccent` |
| Query layer | `postgres.js` tagged templates and parameterized SQL |
| Data migration | Python 3.12, psycopg 3, and PostgreSQL `COPY` |
| Tests | Vitest and Playwright |
| Deployment | Next.js standalone output, Node cluster, systemd, Caddy |

There is no separate API service. Server Components use the server-only database
layer directly; Route Handlers provide only health, autocomplete, and intake
endpoints.

## Repository layout

```text
src/app/             Next.js pages and route handlers
src/components/      Shared UI components
src/db/queries/      Parameterized application queries
src/db/migrations/   Ordered PostgreSQL migrations
src/lib/             Auth, settings, email, SEO, and ingest helpers
src/search/          Typed search, query-builder, and grid-solver specifications
tools/db/            Migration runner
tools/migration/     Repeatable import, enrichment, and derived-data jobs
tools/aflw/          AFLW parse and staging load
tools/validation/    Migration parity checks
tools/maintenance/   Host setup, privileges, backup, restore, and load testing
tools/email_intake/  IMAP fetch and staging for the email upload channel
deploy/              systemd units, Caddyfiles, cluster supervisor, apex page
tests/               Unit, integration, release-gate, and end-to-end tests
docs/                Architecture, data, search, and operations documentation
```

## Development

The supported runtime is Linux. The Windows working copy is for editing and
inspection only; a result on Windows alone is not authoritative — the
integration and release-gate suites need a real database and will not run there.

Prerequisites: Node.js 22, npm, and a populated PostgreSQL 16. Python 3.12 and
psycopg 3 are additionally required for import and validation work.

Against an existing database-backed environment:

```bash
cp .env.example .env
# Fill in the environment-specific credentials and URLs.
npm ci
npm run dev
```

The dev server listens on port 3100. Most pages render from PostgreSQL, so
`DATABASE_URL` must be valid before starting or building. Never point local
development at production credentials.

Database provisioning, role creation, initial import, and service installation
change system and database state and are documented separately. Follow
[Deployment](docs/deployment.md) rather than treating `npm run dev` as
first-time setup.

### Commands

| Command | Purpose | Database |
|---|---|---|
| `npm run dev` | Development server on port 3100 | `DATABASE_URL` |
| `npm run build` | Build and prepare standalone output | `DATABASE_URL` while prerendering |
| `npm start` | Production server | `DATABASE_URL` |
| `npm run typecheck` | TypeScript checks | None |
| `npm test` | Unit, integration, and release-gate tests | Integration uses only `AFLDB_TEST_DATABASE_URL` |
| `npm run test:e2e` | Desktop and mobile browser journeys | Configured test deployment |
| `npm run db:status` | Show migration state | Owner connection |
| `npm run db:migrate` | Apply pending development migrations | Development database |
| `npm run db:migrate:test` | Apply pending test migrations | `_test` database only |
| `npm run db:privileges` | Reconcile role grants | Owner connection |

Integration tests refuse any database whose name does not end in `_test`.
Migrations are transactional, verify checksums for applied files, and require an
explicit production target and connection before they can touch production.

`npm run db:privileges` is **mandatory after a restore**: application read access
fails closed, so a new public table is invisible to `afldb_app` until it is
granted.

### Configuration

Copy [.env.example](.env.example) and fill in per-environment values.

**Environment and security**

| Variable | Purpose |
|---|---|
| `AFLDB_ENV` | `development`, `staging`, or `production`. Transport security only — HSTS, strict CSP, `Secure` cookies |
| `AFLDB_INDEXING` | `on` allows search indexing. Fails closed, and deliberately separate from `AFLDB_ENV` |
| `AFLDB_BASE_URL` | Canonical public base URL, used for metadata and redirects |
| `AFLDB_SESSION_SECRET` | Signing key for session and beta tokens |
| `AFLDB_BETA_GATE` | `on` enables the closed-beta gate |
| `AFLDB_BETA_EPOCH` | Beta revocation epoch; a non-integer fails closed |

**Database connections**

| Variable | Purpose |
|---|---|
| `DATABASE_URL` | Read-only application connection |
| `AFLDB_AUTH_DATABASE_URL` | Auth and session tables |
| `AFLDB_OWNER_DATABASE_URL` | Schema migration |
| `AFLDB_IMPORT_DATABASE_URL` | ETL and import |
| `AFLDB_TEST_DATABASE_URL` | Integration tests; the name must end in `_test` |
| `AFLDB_BACKUP_DATABASE_URL` | Read-only backup |
| `AFLDB_PROD_DATABASE_URL` | Production migration target; required explicitly |
| `AFLDB_LEGACY_SQLITE` | Path to the read-only legacy source |

**Runtime limits**

| Variable | Purpose |
|---|---|
| `PORT` | Application port; 3100 in project scripts |
| `AFLDB_WORKERS` | Cluster worker count |
| `AFLDB_POOL_MAX` | Pool size per worker (default 10) |
| `AFLDB_BUILD_WORKERS` | Caps `next build` static-generation workers |
| `AFLDB_MAX_PAGE_SIZE` | Maximum results per page |
| `AFLDB_MAX_FILTERS` | Maximum advanced-search filters |
| `AFLDB_STATEMENT_TIMEOUT_MS` | PostgreSQL statement timeout |

**Mail, intake, and paths**

| Variable | Purpose |
|---|---|
| `AFLDB_SMTP_*` | Outbound relay for magic links and notifications. Ports 25/465/587 are blocked on the host, so the relay runs on 2525 with `AFLDB_SMTP_SECURE=false` |
| `AFLDB_INTAKE_IMAP_*` | Mailbox polled by the email CSV intake |
| `AFLDB_EMAIL_INTAKE_SECRET` | Shared secret for the intake endpoint |
| `AFLDB_APEX_DIR` | Where the published coming-soon page is written |
| `AFLDB_BACKUP_DIR` | Backup destination |

Secrets belong in `.env` (mode 600) or protected service configuration, and must
never be committed.

## Documentation

| Document | Contents |
|---|---|
| [Changelog](CHANGELOG.md) | Dated record of what changed and why |
| [Architecture](docs/architecture.md) | System design, data rules, security, and environment boundaries |
| [Data dictionary](docs/data-dictionary.md) | Audit of the legacy source tables and known gaps |
| [Migration inventory](docs/migration-inventory.md) | Source-to-target mapping and validation baselines |
| [Migration report](docs/migration-report.md) | Migrated volumes, corrections, and validation results |
| [Search](docs/search.md) | Normalization, ranking, filters, limits, and performance |
| [AFLW](docs/aflw.md) | The AFLW read model, its identity rules, and source limits |
| [Admin and beta](docs/admin-and-beta.md) | Admin accounts and MFA, the beta gate, and the CSV pipeline |
| [Apex coming-soon](docs/apex-coming-soon.md) | The `afldb.com` holding page and its editor |
| [Deployment](docs/deployment.md) | Server setup, release workflow, and operations |
| [Backup and restore](docs/backup-restore.md) | Backup policy and tested restore procedure |
| [Production cutover](docs/production-cutover.md) | Readiness gates, launch procedure, and rollback |
| [Project brief](docs/project-brief.md) | Original scope and requirements |

## Attribution

The core historical dataset was assembled from AFL Tables via
[fitzRoy](https://jimmyday12.github.io/fitzRoy/)
([licence](https://jimmyday12.github.io/fitzRoy/LICENSE.html)), with additional
source material for Brownlow voting, birth dates, and draft records. Provenance
and unresolved quality issues are recorded in the data model and migration
documentation.

AFLDB is an independent, non-commercial reference and is not affiliated with the
AFL.

No repository licence is currently included. Confirm source attribution and
licensing requirements before any public release or redistribution.
