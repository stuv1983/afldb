# AFLDB

AFLDB is a read-oriented historical Australian football statistics site covering the VFL/AFL from 1897 to the current season. It provides player, club, season, match, venue, records, Brownlow, and statistical search pages backed by PostgreSQL.

## Project status

The application and development database are operational on the project's authoritative Linux development server. The current data snapshot covers 1897-2026 and is loaded through 9 August 2026; the 2026 season is marked provisional.

The development deployment runs as a four-worker Next.js standalone service behind Caddy. The production launch has **not** happened: `afldb.com` has not been configured, no production database exists, and six readiness gates remain open. See [Production cutover](docs/production-cutover.md) for the current checklist and outstanding work.

## What is available

- Global search and autocomplete for players, clubs, venues, and seasons
- Player profiles, career and season totals, club history, and match logs
- Historical club identities and organization lineage across renames and relocations
- Season ladders, results, finals, premiers, and leading players
- Match scorecards, team lists, player statistics, attendance, and venue details
- Career, season, and single-match record leaderboards
- Brownlow leaderboards using authoritative season totals
- Typed, shareable player and match searches with allowlisted filters and sorting
- Responsive navigation, light/dark themes, canonical metadata, robots controls, and segmented sitemaps

Draft data has been imported, but draft pages are not yet exposed. Awards, Hall of Fame, and family relationships have not been migrated and are intentionally absent from the public site.

## Data snapshot

The latest clean migration recorded in [the migration report](docs/migration-report.md) contains:

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

The migration completed with no rejected rows and 93/93 validation checks passing. The legacy SQLite source is opened read-only by the import pipeline; AFLDB does not write to it.

## Technology

| Area | Implementation |
|---|---|
| Application | Next.js 15 App Router, React 19, TypeScript 5 |
| Rendering | React Server Components by default |
| Database | PostgreSQL 16 with `pg_trgm` and `unaccent` |
| Query layer | `postgres.js` tagged templates and parameterized SQL |
| Data migration | Python 3.12, psycopg 3, and PostgreSQL `COPY` |
| Tests | Vitest and Playwright |
| Deployment | Next.js standalone output, Node cluster, systemd, and Caddy |

There is no separate API service. Server Components use the server-only database layer directly; Route Handlers provide only health and autocomplete endpoints.

## Repository layout

```text
src/app/             Next.js pages and route handlers
src/components/      Shared UI components
src/db/queries/      Parameterized application queries
src/db/migrations/   Ordered PostgreSQL migrations
src/search/          Typed player and match search specifications
tools/db/            Migration runner
tools/migration/     Repeatable import, enrichment, and derived-data jobs
tools/validation/    Migration parity checks
tools/maintenance/   Server setup, backup, restore, and load-test tools
deploy/              systemd, Caddy, and cluster configuration
tests/               Unit, integration, release-gate, and end-to-end tests
docs/                Architecture, data, search, and operations documentation
```

## Development

The supported runtime is the Linux development server described in [Deployment](docs/deployment.md). The Windows copy at `D:\dev\afldb` is used for editing and source inspection; a result on Windows alone is not considered authoritative.

Prerequisites are Node.js 22, npm, and access to a populated PostgreSQL 16 database. Python 3.12 and psycopg 3 are additionally required for data import and validation work.

For an existing database-backed environment:

```bash
cp .env.example .env
# Fill in the environment-specific credentials and URLs.
npm ci
npm run dev
```

The development server listens on port 3100 by default. Most pages render from PostgreSQL, so `DATABASE_URL` must be valid before starting or building the application. Do not use real production credentials for local development.

Database provisioning, role creation, initial import, and service installation are intentionally documented separately because those commands change system and database state. Follow [Deployment](docs/deployment.md) rather than treating `npm run dev` as a complete first-time setup.

### Environment variables

Copy [.env.example](.env.example) and provide the values appropriate to the environment. The main settings are:

| Variable | Purpose |
|---|---|
| `AFLDB_ENV` | `development`, `staging`, or `production`; gates indexing, HSTS, and `Secure` session cookies |
| `AFLDB_BASE_URL` | Canonical public base URL (metadata and magic-link links) |
| `AFLDB_BETA_GATE` | `on` enables the closed-beta gate |
| `AFLDB_BETA_EPOCH` | Beta revocation epoch; must be an integer (a bad value fails closed) |
| `PORT` | Next.js port; defaults to 3100 in project scripts |
| `DATABASE_URL` | Read-only application connection |
| `AFLDB_OWNER_DATABASE_URL` | Development schema migration connection |
| `AFLDB_IMPORT_DATABASE_URL` | ETL/import connection |
| `AFLDB_TEST_DATABASE_URL` | Integration database; its name must end in `_test` |
| `AFLDB_BACKUP_DATABASE_URL` | Read-only backup connection |
| `AFLDB_LEGACY_SQLITE` | Path to the read-only legacy source |
| `AFLDB_WORKERS` | Production cluster worker count |
| `AFLDB_MAX_PAGE_SIZE` | Maximum results per page |
| `AFLDB_MAX_FILTERS` | Maximum advanced-search filters |
| `AFLDB_STATEMENT_TIMEOUT_MS` | PostgreSQL statement timeout |

Secrets belong in `.env` or protected service configuration and must not be committed.

### Commands

| Command | Purpose | Database behavior |
|---|---|---|
| `npm run dev` | Start Next.js development mode on port 3100 | Reads `DATABASE_URL` |
| `npm run build` | Build and prepare standalone output | Reads `DATABASE_URL` while prerendering |
| `npm start` | Start the standard production server | Reads `DATABASE_URL` |
| `npm run typecheck` | Run TypeScript checks | No database access |
| `npm test` | Run unit, integration, and release-gate tests | Integration tests use only `AFLDB_TEST_DATABASE_URL` |
| `npm run test:e2e` | Run desktop and mobile browser journeys | Uses the configured test deployment |
| `npm run db:status` | Show migration state | Reads the owner connection |
| `npm run db:migrate` | Apply pending development migrations | Writes to the development database |
| `npm run db:migrate:test` | Apply pending test migrations | Writes only to the `_test` database |

Integration tests deliberately refuse any database whose name does not end in `_test`. Migrations are transactional, verify checksums for applied files, and require an explicit production target and production connection before they can affect production.

## Data correctness

Three rules are central to the implementation:

1. **Brownlow totals do not come from match rows.** Per-game votes exist only for 1931-1934 and 1984-2025. Season and career totals use the authoritative season-level source, preserving all 79,113 recorded votes.
2. **`NULL` is not zero.** A missing historical statistic means "not recorded," not a recorded value of zero. Availability is tracked by season, statistic, and grain, and the UI preserves that distinction.
3. **Historical identity is explicit.** Renames and relocations share an organization without rewriting historical club identities; mergers remain separate organizations. Player identity uses stable numeric IDs rather than names.

Derived career, season, and club-season summaries are reproducible from authoritative tables and are rebuilt rather than hand-edited. See [Architecture](docs/architecture.md) and [Migration report](docs/migration-report.md) for the full model and validation evidence.

## Security hardening

A security review of the auth, beta-gate, and deployment surfaces produced the following changes. Public-facing pages, SQL builders (allowlisted identifiers, parameterised values), CSV upload, and the HMAC token core were reviewed and left unchanged.

**Authentication and sessions**

- Admin authorization is now a single `requireAdmin()` exported from `src/lib/auth/session.ts`, replacing a guard that was hand-copied into seven routes. This DB-session check is the only layer that honours session revocation, so centralising it prevents a new admin route from silently shipping without it.
- Admin and beta cookies derive their `Secure` attribute from `AFLDB_ENV === 'production'` (the single source of truth for production posture) rather than from `AFLDB_BASE_URL`, which could ship non-`Secure` cookies if that URL was misconfigured at cutover.
- The beta revocation epoch (`AFLDB_BETA_EPOCH`) is parsed and validated once in the edge-safe token module. A non-integer value now fails **closed** (a 503 at the gate) instead of becoming `NaN` and silently disabling the kill switch.

**Denial-of-service and abuse**

- A shared, bounded rate limiter (`src/lib/auth/rate-limit.ts`) is keyed on the real client IP and applied to admin login, beta code redemption, magic-link requests, magic-link verification, and autocomplete. It replaces per-worker maps that grew without bound and were keyed on attacker-supplied content. In particular the admin login now rate-limits **before** running scrypt (previously an unauthenticated request could pin every worker's CPU), and the beta limiter no longer collapses every real code into one shared bucket.
- The cluster supervisor (`deploy/server-cluster.mjs`) restarts crashed workers with exponential backoff and gives up after a burst, so a boot-time crash loop can no longer peg a core or bypass systemd's crash-loop protection.

**Redirects, headers, and logging**

- `safeDestination()` on the beta-gate return path now rejects the `/\` (backslash) form that browsers fold into a protocol-relative URL, closing an open redirect.
- Caddy overwrites `X-Forwarded-For` with the real client address and `requestIp()` reads the trusted hop, so a client-supplied header can no longer forge the IP recorded in `auth_sessions` and `auth_audit_log`. **The production reverse proxy must apply the same rule.**
- The Content-Security-Policy drops `'unsafe-eval'` in production. Removing `'unsafe-inline'` for scripts (a per-request nonce migration) is the remaining hardening step and is tracked separately, to be verified against a running build.
- Beta magic-link tokens (live 30-minute credentials) are no longer written to the production log.

**Operational scripts and data**

- `tools/maintenance/backup.sh` and `restore-test.sh` pass the database password via `PGPASSWORD` instead of on the command line, keeping it out of the world-readable process list on the shared host.
- Non-integer `maxUses`/`days` on the access-code form are rejected up front (via `parseIntInRange`) instead of reaching the SQL `INSERT` as `NaN`.
- Corrected a code comment that claimed a privilege test enforced the read-only `afldb_app` role; the invariant comes from the migration `GRANT`s, and adding an automated privilege check remains a recommended follow-up.

Verification: `npm run typecheck` passes and the 68 database-free unit tests pass. The integration and release-gate suites require `AFLDB_TEST_DATABASE_URL` and were not run in this environment; the changes do not touch schema, queries, or the data those suites exercise.

## Documentation

| Document | Contents |
|---|---|
| [Architecture](docs/architecture.md) | System design, data rules, security, and environment boundaries |
| [Data dictionary](docs/data-dictionary.md) | Audit of the legacy source tables and known gaps |
| [Migration inventory](docs/migration-inventory.md) | Source-to-target mapping and validation baselines |
| [Migration report](docs/migration-report.md) | Latest migrated volumes, corrections, and validation results |
| [Search](docs/search.md) | Search normalization, ranking, filters, limits, and performance |
| [Admin and beta](docs/admin-and-beta.md) | Administrator accounts (MFA), the closed-beta gate, and the vetted CSV upload pipeline |
| [Deployment](docs/deployment.md) | Development-server setup, release workflow, and operations |
| [Backup and restore](docs/backup-restore.md) | Backup policy and tested restore procedure |
| [Production cutover](docs/production-cutover.md) | Readiness gates, launch procedure, and rollback plan |
| [Project brief](docs/project-brief.md) | Original scope and requirements |

## Data sources and attribution

The core historical dataset was assembled from AFL Tables through `fitzRoy`, with additional source material for Brownlow voting, birth dates, and draft records. Source provenance and unresolved quality issues are recorded in the data model and migration documentation.

No repository license or standalone acknowledgements file is currently included. Confirm source attribution and licensing requirements before any public release or redistribution.
