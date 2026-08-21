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
- Coleman, Norm Smith, Rising Star, All-Australian, AFLPA 22 Under 22, club best-and-fairests, and other awards, each with a winners or selection history
- Australian Football Hall of Fame inductees and honour teams
- AFLW as a separate competition: players, clubs, seasons, ladders, matches, scoring progressions, match search, and its own scoped global search

**Search**
- Global search and autocomplete across players, clubs, venues, seasons, rounds, awards, and record categories
- Natural-language questions answered inline on `/search` — "most goals against Carlton", "players with 200 games and no premiership", "most premierships" — a deterministic parser and a fixed, allowlisted set of SQL compilers, deliberately no LLM anywhere in the pipeline. A tied record names every holder, not just the first; an ambiguous surname ("Ablett most goals") ranks across every plausible candidate rather than declining. See [Search](docs/search.md)
- Intent-aware routing — a query naming a club or season alongside a record, award, or draft class ("brownlow winner richmond", "most goals essendon") lands on that filtered view rather than a bare page
- Typed, shareable player and match searches with allowlisted filters and sorting
- Player comparison with played-with and played-against drill-down
- A collapsible filter panel on every table, with applied filters carried in the URL

**Administration**
- Role-based admin (`super_admin`, `admin`, `contributor`), all requiring TOTP MFA, with QR-code enrolment and delegable admin management
- CSV upload and an email-in intake channel for match results and player statistics
- A player-link review queue for names the importer could not identify with confidence, fed by reader suggestions from the public "Unmatched" badges — see [Player identity review](#player-identity-review)
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
| Player-match rows | 694,209 |
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

### Player identity review

Every honours row — award winners, award nominations, Hall of Fame, honour
teams, captaincies, achievements, and draft picks — records how confidently its
source name was tied to an AFLDB player:

| Status | Meaning | Trusted link? |
|---|---|---|
| `unique` | Exactly one candidate matched | Yes |
| `resolved` | Several candidates; settled deliberately | Yes |
| `ambiguous` | Several candidates; none chosen | No |
| `unmatched` | No candidate found | No |
| `implausible` | A candidate existed but was rejected on evidence | No |

An untrusted row is never hidden and never guessed at: it renders with the
source's own spelling, no player link, and an **Unmatched** badge. Most such
names are state-league footballers with no VFL/AFL record, and for those the
absence of a link is correct — but some are real AFLDB players the importer
rightly refused to guess, and those are what the review exists for.

**How a row gets fixed.** Clicking an Unmatched badge on the public site opens
a small anonymous form ("Know who this is?") whose tips land in a review queue.
A super admin works that queue at `/admin/player-links`: every untrusted row
across all seven tables, with any reader tips shown inline. Each row has two
outcomes — **link** it to a player found via the site's own search, after
verifying against external sources, or **confirm** it is genuinely not a
VFL/AFL player, which leaves the row honestly `unmatched` but retires it from
the queue. Both decisions are recorded in an append-only audit table; a tip's
own words can never be edited, and a wrong decision gets a new row rather than
a rewrite. The statistical write itself runs as the import role, the same
single path every other statistical write takes.

The queue includes unresolved AFLPA 22Under22 selections under **Award
winners**. Its **22Under22** shortcut applies the table and source-name filters
in one click; a manual link is retained by later scoped source refreshes.

**Why a human is required** — two real rows from the queue:

- *The automation was right to refuse.* The 2014 Sandover Medal row for
  **Aaron Black** is `implausible`. AFLDB has two Aaron Blacks: one at Geelong
  and North Melbourne, 2011–2018 (57 games), and one at West Coast, 2022
  (1 game). The winner is the West Coast player — he won the WAFL's Sandover
  eight years **before** his single AFL game, so the award year sits outside
  any career the importer could see, and rejecting the match was the correct
  automated call. Only a human with external sources can know the link is real.
- *The lookalike.* Ten Carlton rows for **Craig Bradley** — three John
  Nicholls Medals and seven All-Australian selections — are `implausible`.
  Searching the picker for the name surfaces two candidates: **Craig Bradley
  (Carlton · 1986–2002)** and the near-spelling **Craig Braddy (Fitzroy,
  Sydney · 1980–1985)**. The club-and-era subtitle on each candidate is the
  disambiguator: every one of these honours belongs to Carlton's Bradley.

Neither judgement can be automated safely, which is why the queue exists and
why the resolution is always a person's, recorded as such.

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
src/search/          Typed search, query-builder, grid-solver, and NL search specs
tools/db/            Migration runner
tools/migration/     Repeatable import, enrichment, and derived-data jobs
tools/aflw/          AFLW parse and staging load
tools/validation/    Migration parity checks
tools/nl/            NL search stress-test corpora, runners, and comparisons
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
| `npm run nl:stress` | Run an NL search corpus through the real parser and compilers, no HTTP | `DATABASE_URL` |
| `npm run nl:ui` | Drive the NL corpus through the rendered `/search` page in a real browser | Configured test deployment |
| `npm run nl:stress:compare` | Diff two `nl:stress` runs | None |
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
| [Search](docs/search.md) | Normalization, ranking, filters, limits, performance, and the natural-language engine — parser, confidence scoring, era coverage, and the search log |
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
