# AFLDB

A read-oriented historical Australian football statistics site covering the VFL/AFL from 1897 to the current season, plus AFLW from 2017. Player, club, season, match, venue, records, Brownlow, draft, and awards pages, backed by PostgreSQL.

## What it covers

- VFL/AFL seasons, matches, player profiles, club history, and match logs (1897 to current).
- Historical club identities.
- AFLW competitions as a separate scoped model.
- Brownlow Medal, draft, and awards.
- Hall of Fame and honour teams.

## Key features

- **Core**: Player profiles, club history, season ladders, match scorecards, records, draft, and awards.
- **Search**: Global autocomplete, typed filters, player comparison, and natural-language search.
- **Administration**: Role-based admin (`super_admin`, `admin`, `contributor`), CSV upload, email-in intake channel, and player-link review queue.
- **Tools**: Grid Solver, database health reporting, and runtime site settings.

## Natural-language search

A deterministic parser with a fixed, allowlisted set of SQL compilers. There is no LLM anywhere in the pipeline.

The search flow follows this pipeline:
`canonicalise -> parse -> plan -> validate -> compile -> PostgreSQL -> answer -> describe/render`

## Tech stack

- **Application**: Next.js 15 App Router, React 19, TypeScript 5
- **Database**: PostgreSQL 16 (with `pg_trgm` and `unaccent`)
- **Query layer**: `postgres.js`
- **Data migration**: Python 3.12, psycopg 3
- **Tests**: Vitest and Playwright

## Architecture

A standalone Next.js service that connects directly to PostgreSQL. React Server Components handle the majority of rendering using server-only database calls. Route Handlers are limited to health, autocomplete, and intake endpoints. A separate `aflw` schema handles the distinct AFLW data model.

## Repository structure

```text
src/app/             Next.js pages and route handlers
src/components/      Shared UI components
src/db/              Parameterized application queries and migrations
src/lib/             Shared libraries and helpers
src/search/          Search, filters, and the NL pipeline
tools/               Import, validation, maintenance, and NL stress-test tools
deploy/              systemd units, Caddyfiles, and cluster supervisor
tests/               Unit, integration, and end-to-end tests
docs/                Architecture, data, search, and operations documentation
```

## Requirements

- Node.js 22 and npm
- PostgreSQL 16
- Python 3.12 (for import and validation work)
- Linux (required for running tests and production; Windows supported for code editing only)

## Configuration

Copy `.env.example` to `.env` and configure per-environment values. Secrets and real database credentials should not be committed.

Important variables:
- `AFLDB_ENV`: `development`, `staging`, or `production`. Controls transport security.
- `AFLDB_INDEXING`: Controls search indexing.
- `DATABASE_URL`: Read-only application connection.
- `AFLDB_OWNER_DATABASE_URL`: Used for schema migration.
- `AFLDB_TEST_DATABASE_URL`: Used for integration tests (must end in `_test`).
- `PORT`: Application port (defaults to 3100).
- `AFLDB_WORKERS`: Cluster worker count.
- `AFLDB_SMTP_*`: Outbound relay settings.

## Development

Set up a local database and configure `.env` before starting development.

```bash
npm ci
npm run dev
```

## Testing

Commands include:
- `npm run typecheck`: TypeScript checks.
- `npm test`: Unit, integration, and release-gate tests (requires `AFLDB_TEST_DATABASE_URL`).
- `npm run test:e2e`: Playwright UI tests against a configured deployment.
- `npm run nl:stress`: Run the NL corpus through the parser (no HTTP).
- `npm run nl:ui`: Drive the NL corpus through the rendered page via Playwright.

Integration tests contain a safeguard and will refuse any database whose name does not end in `_test`.

## Database and data notes

- **`NULL` is not zero**: Missing historical statistics mean "not recorded", not a recorded zero.
- **Historical identity is explicit**: Mergers remain separate organizations, while renames and relocations share an organization.

## Deployment

The application deploys as a standalone Next.js service managed by a Node cluster supervisor and systemd, behind Caddy for TLS. Email intake operates via a separate systemd service and timer. 

## Data sources / acknowledgements

The core historical dataset was originally assembled from AFL Tables via [fitzRoy](https://jimmyday12.github.io/fitzRoy/) (see their [licence](https://jimmyday12.github.io/fitzRoy/LICENSE.html)). AFLDB is an independent, non-commercial reference and is not affiliated with the AFL.

## Status / limitations

AFLDB is currently in closed beta. A public launch has not occurred, pending resolution of data quality gates, backup automation, and restore-failure path testing.
