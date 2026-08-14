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

`player_season_stats`, `player_club_season_stats`, `player_career_stats`, `club_seasons` and record leaderboards are **always reproducible** from the authoritative tables by a single documented rebuild command. They are never hand-edited and never the only copy of a fact.

### 4.3 The Brownlow correctness rule

Per-game Brownlow votes exist only for **1931–1934** and **1984–2025**. The legacy `players.career_brownlow` column, derived from per-game votes, therefore understates career totals by **32,134 votes (40.6%)** and reports NULL for players such as Bob Skilton (actually 180 votes across three medals).

**Rule.** Career and season Brownlow totals come from `brownlow_season_votes`. Per-game votes are displayed only within the two covered windows, and the UI must render *"not recorded"* rather than `0` outside them.

### 4.4 Grain

A statistic must be stored at the grain at which it is decided.

| Table | Grain | Rows |
|---|---|---|
| `player_club_season_stats` | player · season · club | 59,092 |
| `player_season_stats` | player · season | 58,843 |

A season award is decided once, for a player, and the source cannot allocate it between the clubs a mid-season transfer played for. When Brownlow votes lived on the club-grained table, 44 polling player-seasons split across two clubs contributed their total twice: the table summed to **79,280** against an authoritative **79,113**.

**Rule.** `player_season_stats` is the only season-grain source of Brownlow votes, and `player_club_season_stats` has no award column at all — so no future query can reintroduce the double count. Season records and leading goalkickers read the player grain, so a transfer season is one entry rather than two part-seasons.

### 4.5 Historical identity

- **Players** are identified by a stable numeric ID, never by name — `peter brown` alone maps to 6 distinct players. URLs are `/players/{slug}-{id}`; the ID is authoritative and the slug cosmetic.
- **Clubs** are two layers. **24 historical identities** (`clubs`) carry matches, player stints, ladder rows and era pages; **21 organizations** (`club_organizations`) carry "clubs played", lineage totals and navigation. Three organizations span two identities each: South Melbourne/Sydney, Footscray/Western Bulldogs, North Melbourne/Kangaroos.
- A **merger is not a rename.** Fitzroy, Brisbane Bears and Brisbane Lions remain three separate organizations; `club_organization_relations` makes the 1997 merger navigable **without combining statistics**, so the Lions' record still starts in 1997 and Fitzroy keeps its 100 seasons.
- Ladder rows resolve through `afldb_identity_for_season()` to the identity trading that season. Without it the source ladder's modern-only names gave Sydney rows back to 1897 and Footscray none at all.
- **Venues** become entities with canonical names and aliases (`M.C.G.` → Melbourne Cricket Ground).
- **External sources** are joined on durable keys, never names: AFL Tables profile URLs for birth dates, DraftGuru person ids for draft rows.

### 4.6 NULL semantics

`NULL` means *not recorded*; `0` means *recorded as zero*. This distinction is preserved end-to-end — through the schema, the query layer, and the UI.

A boolean cannot carry that distinction, so `coverage_status` records **why** a value is absent:

| Status | Meaning |
|---|---|
| `complete` | collected for every eligible row; a `0` is a fact |
| `partial` | collected for some; absence is unknown |
| `not_collected` | it existed, nobody recorded it |
| `not_applicable` | there was nothing to collect |
| `pending` | expected to exist, not yet published |

Availability is recorded **per season, per grain**. The three Brownlow grains genuinely disagree — season totals run 1924–2025 bar the war years, round votes only from 1984, and match votes are `partial` even inside 1931–1934, because no season in that window has every home-and-away match fully polled. Conflating them into one `brownlow` key is what let the 40.6% shortfall pass unnoticed.

The same rule governs attendance: 1,651 matches have none, and `attendance_status` distinguishes *not recorded* from a genuine zero. A zero crowd must cite a source; several 2020–21 matches truly were played to empty stands, but "we have no figure" and "the figure was zero" are different claims.

### 4.7 Provisional seasons

`seasons.status` is `in_progress` or `complete`, with `data_through_date`, `last_loaded_round` and `completed_at`. Only the most recently loaded season can be in progress, and it stays so until a Grand Final has been decided — 1897 and 1924 have no Grand Final at all, so "no Grand Final" alone cannot mean "unfinished".

For an in-progress season every derived figure is provisional: no premier, no wooden spoon (the raw ladder flags whoever is currently last, which is a standing, not an honour), and Brownlow reads *"Not yet awarded"* rather than zero. The raw source flag is preserved untouched in `staging`.

**Grand Final replays.** 1948, 1977 and 2010 each have two Grand Final rows. Joining on `round_type` alone returns both, duplicating the season and leaving one copy with a null premier. Premier queries select the decisive, non-drawn match.

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
