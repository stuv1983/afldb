# AFLDB — Search

Two distinct systems: **global search** (find an entity by name) and **player search** (find players by statistical criteria).

Player search lives on `/players`, the player index itself. It used to be a second page, `/advanced-search`, until the two had converged: `playerFilterFields` declared the same field set against the same career columns, and the index added a name search, a sort row and paging on top. The index absorbed the standalone form's remaining differences (a premierships column, a premierships sort, the example searches) and `/advanced-search` is now a 308 that carries every parameter across unchanged — the two pages always read `<field>_min` / `<field>_max`, `club`, `sort` and `page`, so a published link still resolves to the same result set. The one narrowing: `club` accepted up to five comma-separated slugs and the index offers a single-club select, so a multi-club link keeps its first slug.

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

## 5. Player search (`/players`)

The differentiator: statistical questions without SQL. Served by the filter panel on the player index; `src/search/advanced-spec.ts` remains the field registry both it and `src/search/list-filters.ts` read.

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
/players?games_min=200&goals_min=100&finals_min=15
```

`buildQueryString` round-trips a parsed specification, verified by test.

### Performance

Career filters read `player_career_stats` (13,361 rows), never the 694,210-row fact table — asserted by an integration test that runs `EXPLAIN` and fails if `player_match_stats` appears in the plan. Measured p50 148 ms at concurrency 20.

## 6. Data QA search (internal, super-admin only)

`/admin/query-builder` is a separate tool from everything above: not
public, not linked from the admin nav, gated by `requireSuperAdmin()`.
It exists for ad-hoc data QA — checking the underlying tables directly
— rather than answering a fixed statistical question.

Modelled on `sports_data_lab`'s `query_builder.py` "Table filters" mode:
pick a table, pick a column, set an operator and value, add it as a
condition. A **card** holds any number of conditions combined by its own
ALL (AND) / ANY (OR) rule; each card after the first says how it joins
the accumulated result of the cards before it. That two-level shape —
cards of conditions — is deliberately narrower than the reference's
fully general nested-group AST or its drag-and-drop visual tree: neither
was what was asked for, and a flatter shape is easier to review.

**Same security model as Advanced Search, extended across tables rather
than discovered from the catalogue.** `src/search/query-builder-spec.ts`
holds `QUERYABLE_TABLES`, a curated allowlist of table → column → kind,
analogous to `FIELDS` above but spanning players, player career stats,
clubs, matches and player match stats. This is deliberately **not**
built on live `information_schema` introspection: a discovery-based tool
would need an explicit denylist to keep `auth_users.password_hash` out
of reach, and an allowlist cannot leak what was never listed.
`src/db/queries/query-builder.ts` compiles the card AST to SQL through
the identical allowlist-then-bind discipline as `advanced-search.ts` —
`sql.unsafe` only for fragments the catalogue itself supplied, every
value a bound parameter — and runs it through the same `afldb_app`
client every public page uses, so even a compiler bug can only read
statistics (and, since migration 031, cannot read the operational
tables at all).

Query state lives in one `q` URL parameter (JSON, base64url — no
compression, unlike the reference's zlib step: a handful of conditions
does not need it), so a query built once is a shareable, reproducible
link like every other search on the site. Limits: 6 cards, 8 conditions
per card, 50 rows per page.

## 7. Grid solver (`/grid-solver`, audience configurable)

`/grid-solver` is a sibling to Data QA search above, not a
replacement of it: a 3×3 board of named questions instead of raw
column/operator/value conditions — the "grid squares" shape modelled on
`sports_data_lab`'s Grid Solver (`app_pages/11_Grid_Solver.py`,
`afl/constraints.py`). Pick a question for each of three rows and three
columns; every square is solved as soon as both its row and column are
set, showing an eligible-player count and a top-ranked answer, with a
drill-down to the full ranked list.

**Named builders, not user-chosen columns.** `src/search/grid-solver-spec.ts`
holds `GRID_BUILDERS`: 94 fixed, parameterised questions across ten
categories (clubs & journeys, career milestones, single-game feats,
season & era, finals & premierships, grounds & venues, teammates,
captaincy, awards & honours, draft & recruitment) — checked one category
at a time against the reference's own generated criteria doc
(`afl_grid_criteria.md`, ~133 questions across 13 categories) and against
AFLDB's live data, not ported wholesale. Each compiles in
`src/db/queries/grid-solver.ts` to a fixed SQL shape with bound
parameters; there is no request-selected column or operator at all here,
so most of the catalogue needs no allowlist check beyond "is this a known
builder key" — the exception is the `stat`/`statA`/`statB` family of
params (every stat-based builder, not just the original two), checked
against `GRID_STATS` before it can reach `sql.unsafe`. Runs through the
same `afldb_app` client as everything above.

**Who may reach it is a setting, not a route.** `grid_solver.audience` in
`site_settings` (migration 034) names the least privileged session
admitted — `super_admin` (the default), `admin`, `contributor` or
`public` — and a super admin changes it at `/admin/settings`. That is why
the page sits on a public path rather than under `/admin`, which
middleware gates unconditionally: `src/lib/auth/audience.ts` is the gate
instead, and at the default setting it is exactly as strict as
`requireAdmin()`, re-checking the database session rather than trusting
the cookie. A signed-out visitor gets the login form; a signed-in account
that ranks too low gets a 404. An unparseable setting value falls back to
super-admin-only, so a bad row can never open the page up. The page is
`noindex` at every setting.

**`GRID_STATS` covers all 21 real per-game statistics** (every
`player_match_stats` column plus goals), each tagged with how far it's
precomputed: `career_stat_total_min`/`season_stat_total_min` and their
siblings use the real `player_career_stats`/`player_season_stats` column
for the 8 stats that have one, and fall back to a live `SUM()` over
`player_match_stats` for the other 13 — migration 007 precomputes exactly
*because* aggregating 694K rows per request is expensive, so builders use
that precomputation wherever it exists.

**A generic `award` parameter replaces one-off builders per medal.**
`awards`/`award_winners` hold 39 real rows — Brownlow, Coleman, Norm
Smith, eight state-league medals, all 18 club best-and-fairests, the
All-Australian squad, National Draft Pick #1 — so three generic builders
(`award_winner`, `award_winner_min_times`, `award_winner_between_seasons`)
cover what would otherwise be a dozen-plus near-identical questions.
Picking a specific club's B&F award already scopes to that club's full
lineage, since the award keeps one id across renames. Brownlow and Hall
of Fame stay as dedicated builders reading their own authoritative
tables rather than going through this generic mechanism.

Not ported from the reference, deliberately: the daily board fetch from
an external trivia site, saved-grids-per-account (AFLDB has no
regular-user accounts), practice/auto-grid modes, and the obscurity/
star-rating system — AFLDB has no precomputed rarity score, so ranking
falls back to the honest, simple "fewest career games first." Also cut,
for lack of underlying data verified live rather than assumed: player
family relationships and physical attributes (both genuinely unpopulated
on the live database, not merely unexposed), any derby/rivalry pairing
(no such definition exists in the schema), and win-streak questions
(the only builder shape that would need a full per-player chronological
scan rather than a bound predicate on indexed or precomputed columns).

Board state lives in one `g` URL parameter (same JSON/base64url encoding
as `q` above, now shared via `src/lib/urlState.ts`), so a built board is
a shareable link. Limits: 200 rows per cell drill-down, 25 per page.

## 8. Regression cases

Compared as **exact player-ID sets** with SHA-256 hashes, not merely counts, in both `tools/validation/validate_migration.py` and the integration tests.

| Case | Expected |
|---|---|
| Debuted 1960s AND exactly 2 clubs | 110 |
| Career games 200–249 AND ≥16 finals | 117 |
| Goals 50–199 AND 0 Brownlow votes | **269** |
| Games ≥200 AND goals ≥100 AND finals ≥15 | 222 |

The third case is a deliberate correction. The legacy derivation returned **750** because it summed per-game Brownlow votes, which do not exist for 1935–1983; the 481 extra players did poll votes. AFLDB counts from the authoritative season totals and returns 269.

The "exactly 2 clubs" case exposed a second definitional bug during development: counting distinct *historical* club identities made Brent Harvey a two-club player because North Melbourne was branded "Kangaroos" from 1999 to 2007. `clubs_played` now counts modern identities, and the case returns 110 rather than 109.

## 9. Natural-language search

`/search` answers a question typed in plain English — "players with 200 games and no premiership", "most brownlow votes without winning one" — with a real answer rendered inline, not a link to another tool. Deliberately **no LLM anywhere in the pipeline**:

```
Question → Deterministic parser → Structured query plan (JSON)
        → Validation → Grain compiler → PostgreSQL → Answer
```

Everything is `src/search/nl/` (DB-free, the parser and the plan type) and `src/db/queries/nl/` (server-only, the compilers). A seam is left for an optional future LLM fallback — see the header comment on `plan.ts` — but nothing in this codebase calls one, and no builder here can ever emit raw SQL: a plan reaches the database only through the same allowlist-then-bind discipline the grid solver and query builder already use.

**The plan.** `NlQueryPlan` names a *grain* (`player_career`, `player_game`, `player_season`, `team_match`, `club_season`), a *metric* from that grain's fixed allowlist (`NL_METRICS`), an *aggregation* (`max`/`min`/`top_n`/`list`/`count`), and whatever scope the question named — a player, a club (for and/or against), a venue, a season range, a match type. Career-grain questions additionally carry `careerConditions` (numeric thresholds, including `eq 0` for a negative — "no premiership") and `careerPredicates`: `GridAxisState` entries compiled by the grid solver's own `compileAxis`, reused directly rather than duplicated, so a recognised phrase like "played a grand final" becomes exactly the predicate the grid solver already knows how to run.

**The parser.** `parseNlQuestion(question, ctx)` runs entirely synchronously except for one step — resolving a player name, which delegates to `searchPlayers`' existing trigram/prominence ranking. Stages: canonicalise (lowercase, strip possessives, protect number-like stat names such as "inside 50s" from being read as the digits 50) → an unanswerable-topic gate (coaching, positions, streaks — recognised and declined with a reason, before entity matching can partially misfire on them) → club/venue extraction against a directory merging every historical identity's name and alias with a seed nickname dictionary (`dusty` → Dustin Martin, `pies` → Collingwood, `mcg` → Melbourne Cricket Ground) → slot extraction (aggregation words, stat words, match type, season range, comparison operators, negation) → the async player lookup → grain election.

Grain election resolves the genuine ambiguities in the vocabulary rather than guessing: a team-scoring word ("biggest win/loss") always means `team_match`, checked before any stat word can compete for the same sentence. A player named with a per-game stat and no season/career qualifier defaults to their single-game peak ("dusty most disposals" asks for his record game, not a career total). "Finals" is genuinely two different questions depending on whether a preposition governs it — "in finals" is a scope, "most finals played" is a career metric — and only a governing word (`in`, `during`, or a copula like `was`) resolves it one way; bare "finals" with nothing before it defaults to the career-metric reading.

**Confidence.** Every parse returns a report: consumed tokens, unsupported terms, entity-resolution certainty per mention, and a confidence score. Thresholds (`NL_CONFIDENCE`, kept as named constants for future tuning):

| Confidence | Outcome |
|---|---|
| ≥ 0.85 | Execute. |
| 0.60–0.85 | Execute only if every entity/metric resolved unambiguously (certainty 1.0, no unresolved mention); otherwise decline as `ambiguous`. |
| < 0.60 | Decline as `low_confidence`. |

A decline is never shown as an error — the question just falls through to ordinary player/club/venue search results, the same graceful degradation `answerPlayerQuestion`/`answerClubQuestion` already established. A recognised-but-unanswerable topic (no coaching data, streaks not yet computed) gets its own honest panel instead: "AFLDB can't answer this because…", not a bare empty state.

**Validation runs twice.** `validatePlan` is called from `answer.ts` regardless of whether the plan came from the parser — defence in depth, and the one gate any future non-deterministic producer would have to pass. It rejects an unknown grain/metric/column/award/builder, clamps `top_n` and row limits to fixed caps, and — the era-coverage check — declines outright when a metric's first-recorded season (`NL_COVERAGE`, checked against the live `stat_availability` registry by an integration test so the two cannot silently drift) is entirely after the requested season range, with the reason stated plainly rather than an empty result that reads as "nobody ever did this."

**Ties are never dropped.** A `max`/`min` answer uses `rank() OVER (...)` and returns every row sharing the extreme value, the same discipline `records.ts`'s `getCareerRecord` already applies; a `top_n` answer includes ties that straddle the cutoff, so "top 10" can return more than ten rows when the tenth place is shared.

**What's compiled so far:** `player_career` only — multi-condition trivia ("300 games, no premiership, played a grand final"), career rankings for any allowlisted metric including the 13 stats with no precomputed total (a live `SUM()` over `player_match_stats`, the same shape `careerStatValueExpr` proves out for the grid catalogue) and award-count metrics like All-Australian selections (counted from linked `award_winners` rows, since there is no precomputed total for that), and career-boundary questions ("first/last game was a grand final", read off `career_game_no = 1` / `match_date = last_match_date` rather than a fragile game-count comparison). `player_game` (single-game and player records), `player_season`, `team_match` and `club_season` are designed and validated by the parser corpus but have no compiler yet — a plan of that grain throws a named "no compiler yet" error that `answer.ts` catches and degrades from, the same shape `query-builder.ts` and `grid-solver.ts` already use for an unrecognised builder.

**Precedence over the older question-answering.** `parsePlayerQuestion`/`parseClubQuestion` (§ above them in this file, unchanged) still run alongside the NL engine in `globalSearch`'s parallel fetch; when the NL engine answers, both are nulled out before rendering, so a question is never shown twice under two different UIs. They remain the fallback for whatever the NL engine's still-growing vocabulary doesn't yet cover.

**Deliberately deferred**, each with its own reason rather than silently unsupported: conversational follow-ups ("only finals" refining a prior answer) — the plan-token encoding (`encodePlanToken`/`decodePlanToken`, the same base64url `urlState.ts` scheme `q`/`g` already use) is the seam a later build hangs a refinement UI on; youngest/oldest questions — `players.dob` is only ~93% populated, and a superlative over an incomplete column is exactly the kind of silently-wrong answer this codebase refuses elsewhere; averages as a ranking metric — the grid solver's average builders are threshold checks, not rankings, and a qualification-minimum ("average with at least 50 games") needs its own design; streaks and quarter-by-quarter comebacks — no precomputation exists yet.
