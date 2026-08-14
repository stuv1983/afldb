# AFLDB

A public historical Australian Football (AFL/VFL) statistics database covering **1897 to the present** — players, clubs, seasons, matches, venues, records, awards, Brownlow history, drafts and relationships, with fast global and advanced statistical search.

> **Status: in development.** The production domain `afldb.com` is **not** configured, deployed or pointed at anything as part of this work. All testing happens on the development server.

## Stack

| Layer | Technology |
|---|---|
| Web | Next.js (App Router), TypeScript, React, Server Components |
| Database | PostgreSQL 16 |
| Query layer | Drizzle + parameterised SQL |
| Search | PostgreSQL `pg_trgm` |
| ETL | Python 3.12, psycopg 3 (`COPY`) |
| Testing | Vitest, Playwright |
| Deployment | systemd + Caddy |

## Environments

| | Development server (authoritative) | Workstation |
|---|---|---|
| Location | `arm@10.0.40.100:/home/arm/projects/afldb` | `D:\dev\afldb` |
| Purpose | **All meaningful testing** | Editing, source audit |

A feature is not complete because it works on Windows — the dev server is authoritative.

## Documentation

| Document | Contents |
|---|---|
| [docs/architecture.md](docs/architecture.md) | System design, technology decisions, data architecture, security |
| [docs/data-dictionary.md](docs/data-dictionary.md) | Full audit of all 44 legacy tables, classifications, known gaps |
| [docs/migration-inventory.md](docs/migration-inventory.md) | Legacy → target mapping, measured row counts, validation targets |
| [docs/project-brief.md](docs/project-brief.md) | Original project brief |

## Data provenance

Built from a legacy AFL SQLite database (694,210 player-games, 13,361 players, 17,027 matches, 1897–2026) sourced from AFL Tables via `fitzRoy`, plus independent scrapes for Brownlow votes, awards, drafts and family relationships. The legacy database is read **read-only**; AFLDB never writes to it.

### Two correctness rules worth knowing up front

1. **Brownlow votes.** Per-game votes exist only for 1931–1934 and 1984–2025. Career and season totals therefore come from the authoritative season-totals source (79,113 votes), not from summing per-game votes (which yields 46,979 and reports NULL for players such as three-time medallist Bob Skilton). See `docs/architecture.md` §4.3.
2. **`NULL` is not `0`.** Most statistics were not recorded before the 1960s–2000s. AFLDB renders *"not recorded"* rather than `0`, driven by a per-season stat-availability table.

## Development phases

- [x] **Phase 1 — Audit.** Legacy data inventory, data dictionary, migration inventory, validation oracles
- [ ] **Phase 2 — PostgreSQL.** Install, roles, dev/test databases, schema, migrations
- [ ] **Phase 3 — Migration.** Bulk import with per-group validation
- [ ] **Phase 4 — Derived data.** Season/career summaries, search projections
- [ ] **Phase 5 — Core site.** Home, search, players, clubs, seasons, matches
- [ ] **Phase 6 — Records & history.** Records, Brownlow, awards, venues, draft, relationships
- [ ] **Phase 7 — Advanced Search**
- [ ] **Phase 8 — Optimisation**
- [ ] **Phase 9 — Deployment simulation**
- [ ] **Phase 10 — Production readiness** (prepared, not executed)

## Licence and attribution

Statistical data is derived from publicly available sources including AFL Tables and Wikipedia. See `ACKNOWLEDGEMENTS` before any public launch.
