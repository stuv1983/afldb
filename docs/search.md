# AFLDB — Search

Two distinct systems: **global search** (find an entity by name) and **Advanced Search** (find players by statistical criteria).

## 1. Normalisation

Matching runs against normalised companion columns. Canonical display names are never altered.

```sql
afldb_normalise_name(text) RETURNS text   -- IMMUTABLE, PARALLEL SAFE
```

| Input | Output | Rule |
|---|---|---|
| `Jack O'Brien` | `jack obrien` | apostrophes and full stops **removed** |
| `Anthony McDonald-Tipungwuti` | `anthony mcdonald tipungwuti` | hyphens, underscores, slashes become **spaces** |
| `  Nic   Naitanui  ` | `nic naitanui` | whitespace collapsed |
| `Zoë` | `zoe` | accents stripped via `unaccent` |

The punctuation split is deliberate. Migration 008 removed hyphens entirely, which produced `mcdonaldtipungwuti` and made a search for `tipungwuti` fail on prefix and match only weakly on trigrams. Migration 009 corrected this and reindexed every dependent index in the same transaction — changing an `IMMUTABLE` function used in an index expression without reindexing silently returns wrong results.

`players.search_name` is populated **in SQL** using this same function rather than reimplemented in the ETL, so the two can never drift.

## 2. Indexes

| Index | Type | Purpose |
|---|---|---|
| `ix_players_search_trgm` | GIN `gin_trgm_ops` | fuzzy and substring |
| `ix_players_search_prefix` | B-tree `text_pattern_ops` | `LIKE 'abl%'` range scan |
| `ix_players_search_rank` | B-tree | ranking by career games |
| `ix_clubs_name_trgm`, `ix_venues_name_trgm` | GIN | club and venue names |
| `ix_club_aliases_trgm`, `ix_venue_aliases_trgm` | GIN | historical and source spellings |

Index usage is asserted, not assumed — an integration test runs `EXPLAIN` on a prefix search and fails if it sees a `Seq Scan`.

## 3. Global search

`/search?q=…` searches players, clubs, venues and seasons concurrently.

### Ranking

```text
exact match         1000
prefix match         500
substring match      250
+ similarity(term) × 100
+ min(career_games, 400) / 10
```

Career games is the prominence signal, so a search for `ablett` returns Gary Ablett Jr (357 games) above Gary Ablett Sr (248) above Geoff Ablett. Both Garys are returned — they are distinct players with distinct IDs, and the ID in the URL disambiguates them even though they share a slug.

`players.search_rank` is denormalised by the derived-data rebuild so ranking needs no join.

### Aliases

`club_aliases` holds every string any source uses for a club — `club_hist`, `club_now`, short name and abbreviation — so `GWS`, `Greater Western Sydney` and `Footscray` all resolve. `venue_aliases` does the same for `M.C.G.` versus `Melbourne Cricket Ground`.

## 4. Autocomplete

`GET /api/search/autocomplete?q=…`, players only.

| Control | Value |
|---|---|
| Minimum query length | 2 characters |
| Debounce | 180 ms |
| Result limit | 8 |
| Query truncation | 100 characters |
| Cache | `max-age=60, stale-while-revalidate=300` |

Requests below the minimum length issue **no database query at all**. In-flight requests are aborted when superseded, so fast typing produces one useful query rather than one per keystroke.

The control is a `role="combobox"` with `aria-activedescendant`, arrow-key navigation and Escape to dismiss — usable without a mouse.

On error it returns `{"results": [], "error": "search_unavailable"}` with HTTP 503; the cause is logged server-side only.

## 5. Advanced Search

The differentiator: statistical questions without SQL.

### Security model

**Arbitrary SQL is never accepted.** A request is parsed into a typed specification (`src/search/advanced-spec.ts`) in which every field, operator and sort key is resolved through a fixed allowlist. Column names come from that table; user input reaches PostgreSQL only as a bound parameter.

```ts
FIELDS.games = { column: 'c.games', min: 0, max: 1000, … }
SORTS.goals  = { sql: 'c.goals DESC, p.sort_name' }
```

`sql.unsafe` is used **only** for fragments looked up in those tables, never for user input. An unknown sort key falls back to the default — verified by test, and by an end-to-end attempt to inject `ORDER BY` through the URL, which returned normal results with the schema intact.

### Available fields

| Group | Fields |
|---|---|
| Career | games, goals, finals, clubs played, seasons played, wins |
| Honours | premierships, Brownlow votes, Brownlow medals |
| Span | debut season, final season |

**Era-limited statistics are deliberately excluded.** Filtering on disposals or tackles would silently exclude every player from before the statistic was collected, which reads as a factual claim that they recorded none. This is enforced by a test asserting no such field is exposed.

### Abuse limits

| Limit | Value |
|---|---|
| Filters per query | 20 |
| Page size | 50 (hard cap 100) |
| Page depth | 200 |
| Club filters | 5 |
| Statement timeout | 5,000 ms |

Values outside a field's range are **clamped**, not rejected, so a hand-edited URL still returns something sensible. An inverted range (`min > max`) reports an error rather than silently returning nothing.

### Shareable state

All query state lives in the URL, so any search is a shareable, indexable link:

```text
/advanced-search?games_min=200&goals_min=100&finals_min=15
```

`buildQueryString` round-trips a parsed specification, verified by test.

### Performance

Career filters read `player_career_stats` (13,361 rows), never the 694,210-row fact table — asserted by an integration test that runs `EXPLAIN` and fails if `player_match_stats` appears in the plan. Measured p50 148 ms at concurrency 20.

## 6. Regression cases

Compared as **exact player-ID sets** with SHA-256 hashes, not merely counts, in both `tools/validation/validate_migration.py` and the integration tests.

| Case | Expected |
|---|---|
| Debuted 1960s AND exactly 2 clubs | 110 |
| Career games 200–249 AND ≥16 finals | 117 |
| Goals 50–199 AND 0 Brownlow votes | **269** |
| Games ≥200 AND goals ≥100 AND finals ≥15 | 222 |

The third case is a deliberate correction. The legacy derivation returned **750** because it summed per-game Brownlow votes, which do not exist for 1935–1983; the 481 extra players did poll votes. AFLDB counts from the authoritative season totals and returns 269.

The "exactly 2 clubs" case exposed a second definitional bug during development: counting distinct *historical* club identities made Brent Harvey a two-club player because North Melbourne was branded "Kangaroos" from 1999 to 2007. `clubs_played` now counts modern identities, and the case returns 110 rather than 109.
