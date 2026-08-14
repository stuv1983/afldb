# AFLDB — Architecture

## 1. Overview

AFLDB is a new, independent public historical AFL/VFL statistics database. It is **not** a modification of Sports Data Lab. Sports Data Lab is used only as a read-only source of data, reusable AFL logic, and statistical validation.

```text
                       afldb.com  (NOT configured during development)
                           │
                         HTTPS
                           ▼
                  ┌─────────────────┐
                  │  Reverse Proxy  │   Caddy (dev-server testing)
                  └────────┬────────┘
                           ▼
                  ┌─────────────────┐
                  │     Next.js     │   App Router, TypeScript
                  │  Server Comps   │   systemd service
                  └────────┬────────┘
                           ▼
                  ┌─────────────────┐
                  │  Query layer    │   src/db/queries, src/services
                  └────────┬────────┘
                           ▼
                  ┌─────────────────┐
                  │   PostgreSQL    │   afldb_dev / afldb_test
                  │   (localhost)   │   never exposed publicly
                  └────────▲────────┘
                           │
                  ┌────────┴────────┐
                  │   ETL (Python)  │   tools/migration, tools/import
                  └────────▲────────┘
                           │
              legacy afl.db (read-only) + future AFL sources
```

## 2. Environments

| | Development server (authoritative) | Windows workstation |
|---|---|---|
| Host | `10.0.40.100` (`streamanator`), user `arm` | `D:\dev\afldb` |
| Role | **All meaningful testing happens here** | Editing and source audit only |
| Project path | `/home/arm/projects/afldb` | working copy |
| Hardware | 24 cores, 31 GB RAM, 114 GB free | — |
| Node | 22.23.2 via nvm (user-local, no sudo) | 22.21.0 |
| Python | 3.12.3 | 3.12.10 |
| PostgreSQL | *pending install (requires sudo)* | not used |

A feature is **not** complete because it works on Windows. The dev server is authoritative (requirement #4).

### Port allocation

Ports already in use on the dev server: 3000, 8080, 8081, 8082, 8085, 8086, 6881, 6969, 2283, 9090, 9100, 9101, 9115, 9633, 35557.

**AFLDB reserves port 3100** for the Next.js service and **3101** for the production-mode build test. The reverse proxy will bind a dedicated port rather than 80/443 during development to avoid disturbing existing services.

## 3. Technology decisions

| Layer | Choice | Rationale |
|---|---|---|
| Web framework | Next.js (App Router) + TypeScript | Server Components suit a read-heavy public reference site |
| Rendering | Server Components by default | Data-dense pages need no client JS; Client Components only for search, filters, charts |
| Database | PostgreSQL 16 | Single authoritative datastore |
| Query layer | Drizzle + parameterised raw SQL | Type safety for CRUD; raw SQL for CTE/window/aggregation-heavy analytics |
| Search | PostgreSQL `pg_trgm` + normalised search columns | Exact, prefix, partial and fuzzy search without a separate engine |
| ETL | Python 3.12 + psycopg 3 (`COPY`) | Reuses existing AFL expertise; `COPY` for the 694K-row fact table |
| Process management | systemd | Survives reboot; no tmux/manual startup |
| Reverse proxy | Caddy | Simple config, automatic HTTPS at cutover |
| Testing | Vitest + Playwright | Unit/integration against `afldb_test`; E2E for user journeys |

**No separate API service.** Browser → Next.js → query layer → PostgreSQL. Next.js Route Handlers cover the few HTTP endpoints needed (`/api/health`, autocomplete).

## 4. Data architecture

### 4.1 Source of truth

| Domain | Authoritative source | Note |
|---|---|---|
| Player-match stats | `games` (694,210) | Primary fact table |
| Matches | `matches` + `match_details` | Quarter scores/attendance from `match_details` |
| **Brownlow season/career totals** | **`brownlow_results` (79,113 votes)** | **Never `games.brownlow`** — see §4.3 |
| Brownlow per-game votes | `games.brownlow` | 1931–1934 and 1984–2025 **only** |
| Brownlow per-round votes | `brownlow_round_votes` | 1984–2025 only |
| Career/season summaries | Derived in PostgreSQL | Rebuilt, never migrated |
| Ladders | `team_seasons` | |
| Awards | `awards`, `all_australian` | Joined via `dg_person_id` → `person_links` |

### 4.2 Derived data

`player_season_stats`, `player_career_stats`, `club_seasons` and record leaderboards are **always reproducible** from the authoritative tables by a single documented rebuild command. They are never hand-edited and never the only copy of a fact.

### 4.3 The Brownlow correctness rule

Per-game Brownlow votes exist only for **1931–1934** and **1984–2025**. The legacy `players.career_brownlow` column, derived from per-game votes, therefore understates career totals by **32,134 votes (40.6%)** and reports NULL for players such as Bob Skilton (actually 180 votes across three medals).

**Rule.** Career and season Brownlow totals come from `brownlow_results`. Per-game votes are displayed only within the two covered windows, and the UI must render *"not recorded"* rather than `0` outside them.

### 4.4 Historical identity

- **Players** are identified by a stable numeric ID, never by name — `peter brown` alone maps to 6 distinct players. URLs are `/players/{slug}-{id}`; the ID is authoritative and the slug cosmetic.
- **Clubs** keep all 24 historical identities (Fitzroy, South Melbourne, Footscray, Kangaroos, University, Brisbane Bears, …) with alias and successor relationships, rather than being flattened to the 18 modern clubs.
- **Venues** become entities with canonical names and aliases (`M.C.G.` → Melbourne Cricket Ground).

### 4.5 NULL semantics

`NULL` means *not recorded*; `0` means *recorded as zero*. This distinction is preserved end-to-end — through the schema, the query layer, and the UI — and is driven by the `stat_availability` table. Because `stat_coverage`'s min/max ranges hide the Brownlow gap, AFLDB records **per-season** availability.

## 5. Application structure

```text
afldb/
├── src/
│   ├── app/            # routes (Server Components by default)
│   ├── components/
│   ├── db/
│   │   ├── client.ts   # server-only PostgreSQL client
│   │   ├── schema/     # Drizzle schema
│   │   ├── migrations/
│   │   └── queries/    # players, clubs, matches, seasons, records, search
│   ├── services/       # shared statistical definitions
│   ├── search/         # global + advanced search engine
│   ├── lib/            # formatting (dates, scores, rounds, finals)
│   ├── types/
│   └── styles/
├── tools/              # Python ETL: migration, validation, import, maintenance
├── tests/              # Vitest + Playwright, fixtures incl. oracle baselines
└── docs/
```

**Data access boundary.** Only server-side modules import the database client; `src/db/client.ts` carries `server-only`. Credentials never reach a browser bundle.

**Shared statistical definitions.** Career games, finals, premierships, club count and Brownlow votes are defined once in `src/services` and reused by pages, records and search, so the three can never disagree (requirement #95).

## 6. Security

- PostgreSQL bound to localhost; port 5432 never exposed publicly or port-forwarded.
- Four least-privilege roles: `afldb_owner` (schema/migrations), `afldb_app` (read-only, used by the site), `afldb_import` (ETL writes), `afldb_backup`. The application never runs as superuser.
- Advanced Search accepts a **typed query specification**, never SQL. Fields, operators and sort keys are allowlisted and mapped to fixed identifiers; all values are parameterised.
- Query abuse limits: page size, filter count, boolean depth, IN-list size, statement timeout.
- Public errors are sanitised — no SQL, hostnames, paths, stack traces or environment values.
- Secrets live in environment variables; `.env` is never committed.

## 7. Production domain safety

`afldb.com` is **not** touched during development: no DNS changes, no redirects, no production traffic, no indexing of development pages. Testing uses the dev server's private address. A `dev.afldb.com` staging hostname is *proposed only* in `docs/production-cutover.md` and will not be created without explicit approval.
