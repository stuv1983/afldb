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

Clean matchup text such as `Richmond v Essendon 1984` is also recognised by global search. Season-only matchup searches offer a Match Search link with both clubs and the year applied, while exact-round variants such as `Richmond v Essendon round 5 1984` surface direct match results.

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
public, linked from the admin nav as **Data QA search**
(`src/app/admin/nav-model.ts`), gated by `requireSuperAdmin()`. It
exists for ad-hoc data QA — checking the underlying tables directly —
rather than answering a fixed statistical question.

Modelled on `sports_data_lab`'s `query_builder.py` "Table filters" mode:
pick a results anchor, pick a column, set an operator and value, add it
as a condition. A **card** holds any number of conditions combined by
its own ALL (AND) / ANY (OR) rule; each card after the first says how it
joins the accumulated result of the cards before it. That two-level
shape — cards of conditions — is deliberately narrower than the
reference's fully general nested-group AST or its drag-and-drop visual
tree: neither was what was asked for, and a flatter shape is easier to
review.

**Same security model as Advanced Search, extended across tables rather
than discovered from the catalogue.** `src/search/query-builder-spec.ts`
holds `QUERYABLE_TABLES`, a curated allowlist of anchor → column → kind,
analogous to `FIELDS` above but spanning players, player career stats,
clubs, matches and player match stats, and `RELATIONSHIPS`, a curated
catalogue of the related domains a card may reach from each anchor
(below). This is deliberately **not** built on live `information_schema`
introspection: a discovery-based tool would need an explicit denylist to
keep `auth_users.password_hash` out of reach, and an allowlist cannot
leak what was never listed. A foreign key in the schema is not a licence
to traverse either — only the catalogued relationships can be composed,
with no user-chosen join key or path. `src/db/queries/query-builder.ts`
compiles the card AST to SQL through the identical allowlist-then-bind
discipline as `advanced-search.ts` — `sql.unsafe` only for fragments the
catalogue itself supplied (anchor `from`, column expressions, a
relationship's fixed subquery `FROM` and correlation predicate), every
value a bound parameter, inside subqueries as much as outside — and runs
it through the same `afldb_app` client every public page uses, so even a
compiler bug can only read statistics (and, since migration 031, cannot
read the operational tables at all). A relationship whose target table
were ever unregistered for app read would fail closed at the database,
not only at the allowlist.

Query state lives in one `q` URL parameter (JSON, base64url — no
compression, unlike the reference's zlib step: a handful of conditions
does not need it), so a query built once is a shareable, reproducible
link like every other search on the site.

### Anchors, domains and relationships (AFLDB-ISSUE-115)

A query has one **anchor** and up to six cards, and each card filters
one **domain**: either the anchor's own row or one related domain
reachable from that anchor.

**The anchor determines the result grain and the columns.** The rows
returned are always rows of the anchor relation — one per player, one
per career-stats row, one per club, one per match, one per player-match
row — and the results table always reads the anchor's own column set.
A related card never adds rows, never adds columns, and never
multiplies the result: the compiler never joins a related relation into
the anchor's `FROM`, so no `DISTINCT` is needed and none may be added
(a `DISTINCT` appearing in that compiler would be evidence that this
invariant had been broken).

**A related card qualifies anchor rows through `any` / `none`.** Every
card compiles to one scalar boolean on the anchor row. An anchor-domain
card is the pre-existing predicate through the unchanged path — a
pre-ISSUE-115 share token carries no domain and emits byte-identical
SQL. A related-domain card compiles to a correlated subquery, the same
`EXISTS` idiom `advanced-search.ts` already uses for its club filter:

| quantifier | conditions | compiles to | meaning |
|---|---|---|---|
| any | some | `EXISTS (… WHERE <correlation> AND <conditions>)` | some related row satisfies the card |
| none | some | `NOT EXISTS (…)` | no related row satisfies the card |
| any | none | `EXISTS (relation)` | has at least one related row |
| none | none | `NOT EXISTS (relation)` | has no related row at all |

An **empty related card is a complete question** — existence or
non-existence of the relation — not the "filters nothing" convenience an
empty anchor card keeps. "Missing relation" is always `NOT EXISTS`,
never a nullable `LEFT JOIN … IS NULL`; that is the three-valued trap
the design exists to avoid, and an integration test proves the compiled
`NOT EXISTS` against an independently formulated absence oracle.

**One card's conditions apply to the same related row; separate cards
may be satisfied by different rows.** The card's own ALL/ANY rule
combines conditions *within one related row*, crossed with the
quantifier: `any` + ALL is "some related row satisfies A and B", `none`
+ OR is "no related row satisfies A or B". Two cards over the same
relation are independent subquery scopes, so they are genuinely
different questions from one card with two conditions — one card
`any`, `goals ≥ 8 AND brownlow_votes = 3` means one game with both;
two cards `EXISTS(goals ≥ 8) AND EXISTS(brownlow_votes = 3)` may be
satisfied by two different games. The UI hint says so.

**Cross-card AND/OR is unchanged**: the positional left fold
`((A op B) op C)` with the accumulator parenthesised at every step, now
with `EXISTS` in the operand position where a card is related. Because
both operands are booleans on the same anchor row, mixing domains
across an OR needs no special handling.

**No related aggregates or counts.** V1 emits no aggregate over a
related relation and no matched-row count; both would introduce
aggregation semantics whose meaning is unclear under OR composition.
Deferred, not planned.

**NULL semantics — "not recorded" is not zero.** Inside a subquery a
condition on a NULL column is UNKNOWN and the row does not qualify, so
`EXISTS` is false and `NOT EXISTS` is true. "No related row with
goals ≥ 5" therefore **includes** players whose per-game `goals` was
never recorded — the same hazard the era-limited exclusion in §5 guards
against, here left to the operator. The `is null` / `is not null`
operators exist to ask precisely; the UI hint states the rule.

**Relationships.** A relationship is declared from a **subject** an
anchor provides — `player`, `club` or `match` — rather than per anchor,
which is why `player_career_stats` (which already has the player in its
`FROM`) inherits every player-side relationship. Each is a fixed
one-hop subquery `FROM` plus a fixed correlation predicate against the
anchor's canonical alias; the relationship's own columns (qualified
with disjoint `r_` aliases, so a subquery can never shadow the anchor
row) are what a related card's conditions resolve against. Every
club-touching relationship correlates on `club_id`, the season-correct
historical identity; none uses `clubs.organization_id`.

| subject | relationship | related rows | notes |
|---|---|---|---|
| player | `player.career` | `player_career_stats` | 1:1; still compiled as `EXISTS`, never special-cased as a join |
| player | `player.match_stats` | `player_match_stats` + match + club | |
| player | `player.clubs` | `player_clubs` + club | historical club identities |
| player | `player.draft_picks` | `draft_picks` (+ club) | |
| player | `player.hall_of_fame` | `hall_of_fame` | linked rows only |
| player | `player.captaincies` | `captaincies` + club | |
| player | `player.awards` | `award_winners` + award | |
| player | `player.link_candidates` | `player_link_match_candidates` | |
| club | `club.club_seasons` | `club_seasons` | |
| club | `club.matches` | `matches` | home or away |
| match | `match.player_stats` | `player_match_stats` + player + club | includes the curated boolean `club_is_participant` — "club is one of the two competing clubs" |
| match | `match.clubs` | `clubs` | the two participants |

Which anchors host which relationships:

| anchor | subjects | related domains offered |
|---|---|---|
| Players | player | all eight `player.*` |
| Player career stats | player | seven — `player.career` is the anchor's own 1:1 row and is rejected as self-equivalent, not merely hidden |
| Clubs | club | `club.club_seasons`, `club.matches` |
| Matches | match | `match.player_stats`, `match.clubs` — deliberately *not* the club subject, since a match has two clubs |
| Player match stats | *none* | **no related-domain cards in V1** (below) |

`relationshipsForAnchor()` is the single source for both the UI's
domain select and `parseQueryState`'s reachability check, so a
hand-crafted URL naming an unreachable domain is rejected by the same
code path that hides it. All twelve relationships are available through
the anchors above.

**`player_match_stats` hosts no related cards — an evidence-driven V1
boundary, not a design choice.** It remains a valid results anchor with
its own columns, grain and anchor-domain filtering, unchanged. Every
related shape measured under that anchor was red against the cost
contract — four exceeded the 5 s statement ceiling outright and none
met the 1 s target — because the anchor's own pre-ISSUE-115 result
materialisation (`count(*) OVER ()` plus an ordered `LIMIT` walked over
685K rows) is already above 1 s with no card at all, and the planner
then executes each related subquery once per anchor row. The cure is
that baseline, which is separate follow-up work; related filtering at
the player-match grain waits on it. No relationship was removed
globally, no index was added, and the statement timeout was not raised.

**Coverage of the motivating QA questions — stated honestly:**

| # | question | V1 |
|---|---|---|
| 1 | players with 100+ career games but no player-match rows | ✅ Players · `player.career` any `games ≥ 100` · `player.match_stats` none |
| 2 | players with no career row, or zero career games, that nevertheless have match statistics | ✅ Players · `player.career` none (or any `games = 0`) · `player.match_stats` any. Proves a career-vs-match contradiction only; nothing here establishes *link status* |
| 3 | players with a draft record but no senior VFL/AFL games | ✅ Players · `player.draft_picks` any · `player.match_stats` none |
| 4 | Hall of Fame entries whose linked player has no VFL/AFL career | ⚠️ **partial** — the linked-player reading only (Players · `player.hall_of_fame` any · `player.career` none). HoF rows with no `player_id` are invisible from a player anchor; the row-side reading needs a `hall_of_fame` anchor, which does not exist |
| 5 | player-link records marked unmatched with a plausible matching player | ⚠️ **partial** — from the player side only (Players · `player.link_candidates` any `band = high`). The unresolved source row itself cannot be returned from a player anchor; that needs an honours-row anchor, which does not exist |
| 6 | players whose career club identity disagrees with their match history | ⚠️ **partial** — `player_clubs` is derived from `player_match_stats`, so those two cannot disagree by construction. The expressible disagreement is against an independently sourced club: Players · `player.clubs` any `club = X` · `player.awards` / `player.captaincies` any `club ≠ X` |
| 7 | matches with a player row whose club is neither participating club | ✅ Matches · `match.player_stats` any · `club_is_participant` is false |
| 8 | clubs with matches in a season but no club-season record | ⚠️ **partial by design** — per fixed season only (Clubs · `club.matches` any `season = 1995` · `club.club_seasons` none `season = 1995`). "Some season, that same season" is not expressible — see the boundary below |
| — | players with a bag-of-8 game and a separate 3-vote game | ✅ two `player.match_stats` cards |

**Card-independence boundary.** *Anchor = the returned row. Card = a
self-contained boolean predicate on that anchor row. Cross-card AND/OR
combines booleans, never related rows.* Cards correlate with the anchor
and never with each other: fixed-value correlation across cards works
(*matches in 1995* and *no club-season in 1995*), existential same-row
or same-season correlation across cards does not. Generic cross-card
shared-variable correlation is deferred capability, not implemented
and not planned under ISSUE-115.

**Limits** (`QB_LIMITS`; none may be weakened): 6 cards, 8 conditions
per card, at most **4** of the cards on a related domain (a limit the
Stage 5 evidence supported — four related `player.match_stats` cards
under Players ran in under 100 ms, planned as hashed subplans evaluated
once each), relationship depth exactly 1 (a card reaches one hop from
the anchor; chaining is not representable in the state model), 50 rows
per page, 50 pages, 8,192 decoded characters of share token. Every
query runs under the normal 5 s application statement timeout, which is
never raised; an integration cost gate holds every supported
anchor × relationship shape, in both `EXISTS` and `NOT EXISTS` form,
under 1 s against the test database.

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
holds `GRID_BUILDERS`: 108 fixed, parameterised questions across eleven
categories (clubs & journeys, career milestones, single-game feats,
season & era, finals & premierships, grounds & venues, rivalries &
marquee matches, teammates, captaincy, awards & honours, draft &
recruitment) — checked one category
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
`awards`/`award_winners` hold 40 real rows — Brownlow, Coleman, Norm
Smith, eight state-league medals, all 18 club best-and-fairests, the
All-Australian and AFLPA 22Under22 teams, National Draft Pick #1 — so three generic builders
(`award_winner`, `award_winner_min_times`, `award_winner_between_seasons`)
cover what would otherwise be a dozen-plus near-identical questions.
Picking a specific club's B&F award already scopes to that club's full
lineage, since the award keeps one id across renames. Brownlow and Hall
of Fame stay as dedicated builders reading their own authoritative
tables rather than going through this generic mechanism.

Representative-team selection is not labelled as an award win: the fixed
**Selected in AFLPA 22Under22 team** builder reads linked rows from the
`22-under-22` award series directly. Unlinked source names stay out of Grid
Solver answers until a super admin resolves them in `/admin/player-links`.

Not ported from the reference, deliberately: the daily board fetch from
an external trivia site, saved-grids-per-account (AFLDB has no
regular-user accounts), practice/auto-grid modes, and the obscurity/
star-rating system — AFLDB has no precomputed rarity score, so ranking
falls back to the honest, simple "fewest career games first." Also cut,
for lack of underlying data verified live rather than assumed: player
family relationships and physical attributes (both genuinely unpopulated
on the live database, not merely unexposed), and win-streak questions
(the only builder shape that would need a full per-player chronological
scan rather than a bound predicate on indexed or precomputed columns).
Derbies still have no schema definition, but the rivalries & marquee
matches category works around that: `matchup_played_min` takes the two
organizations as parameters (so a Showdown is just Adelaide × Port
Adelaide), and the `match_event` builders read `matches.match_event`,
whose complete tagged vocabulary is Anzac Day, Dreamtime at the 'G and
King's Birthday — Good Friday and Easter Monday fixtures are not tagged
in the source data, so they are reachable only as a matchup.

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

**The plan.** `NlQueryPlan` names one of seven grains (`player_career`, `player_game`, `player_season`, `team_match`, `club_season`, `team_streak`, `achievement_summary`), a closed metric where the grain ranks one, an aggregation, and every named scope. Clean `A v B` wording is stored as matchup scope, not as a subject/opponent side filter. Team-result lists carry a separate grouped threshold and optional per-match margin filter; validation requires the selected compiler to consume both. Career predicates continue to reuse the Grid Solver's named builders. Unsupported combinations decline instead of dropping fields.

**The parser.** `parseNlQuestion(question, ctx)` is synchronous except for player resolution. It canonicalises text, gates genuinely unsupported data such as coaching and positions, resolves club/venue aliases, extracts aggregation, metric, match type, round, period, checkpoint, streak, grouped threshold, per-match margin, season and negation slots, resolves any player mention, and then elects the grain.

Grain election resolves the genuine ambiguities in the vocabulary rather than guessing: a team-scoring word ("biggest win/loss") always means `team_match`, checked before any stat word can compete for the same sentence. A player named with a per-game stat and no season/career qualifier defaults to their single-game peak ("dusty most disposals" asks for his record game, not a career total). "Finals" is genuinely two different questions depending on whether a preposition governs it — "in finals" is a scope, "most finals played" is a career metric — and only a governing word (`in`, `during`, or a copula like `was`) resolves it one way; bare "finals" with nothing before it defaults to the career-metric reading.

**Confidence.** Every parse returns a report: consumed tokens, unsupported terms, entity-resolution certainty per mention, and a confidence score. Thresholds (`NL_CONFIDENCE`, kept as named constants for future tuning):

| Confidence | Outcome |
|---|---|
| ≥ 0.85 | Execute. |
| 0.60–0.85 | Execute only if every entity/metric resolved unambiguously (certainty 1.0, no unresolved mention); otherwise decline as `ambiguous`. |
| < 0.60 | Decline as `low_confidence`. |

A decline is never shown as an error — the question falls through to ordinary search results. A recognised-but-unanswerable topic or unavailable grain (for example player-quarter statistics, which have no authoritative populated source) gets an honest panel rather than a fabricated or silently partial answer.

**Validation runs twice.** `validatePlan` is called from `answer.ts` regardless of whether the plan came from the parser — defence in depth, and the one gate any future non-deterministic producer would have to pass. It rejects an unknown grain/metric/column/award/builder, clamps `top_n` and row limits to fixed caps, and — the era-coverage check — declines outright when a metric's first-recorded season (`NL_COVERAGE`, checked against the live `stat_availability` registry by an integration test so the two cannot silently drift) is entirely after the requested season range, with the reason stated plainly rather than an empty result that reads as "nobody ever did this."

**Ties are never dropped.** A `max`/`min` answer uses `rank() OVER (...)` and returns every row sharing the extreme value, the same discipline `records.ts`'s `getCareerRecord` already applies; a `top_n` answer includes ties that straddle the cutoff, so "top 10" can return more than ten rows when the tenth place is shared.

**All seven grains are compiled.** Career supports multi-condition trivia, allowlisted rankings, award counts and boundaries; the remaining grain-specific behaviour is described below.

**`player_game`** answers one of two questions with one row shape (`NlPlayerGameRow`, distinguished by whether `games` is null): mode `single` names one real match — "dusty's highest disposal game", "most goals in a grand final at the MCG since 1980" — scoped by any combination of player, club-for, club-against (the opponent side of the match, found the same `CASE WHEN home_club_id = club_id` way `players.ts`'s match log already resolves an opponent with no stored column for it), venue, season range and match type. Mode `sum` ranks a scoped career total instead — "most goals against Carlton" — since a cumulative total across many games has no single match to point at; `games` on the row says how many games it was accumulated over. A named player defaults to the single-game reading (`mode: 'single'`) even inside a season or scope, since "dusty's highest disposal game in 2017" is still asking for one game, just filtered to that year.

**`player_season`** reads `player_season_stats`, the true player+season grain migration 015 introduced specifically because a club-grained row cannot carry a season award total without double-counting a mid-season transfer. A club scope ("goals by a Richmond player in 2017") therefore only narrows *which players are eligible* — did they play at least one game for that club that season, checked against the club-grained sibling `player_club_season_stats` — without changing which total they are ranked on: the transfer portion is never split off and attributed to one club. The 13 live-only stats fall back to a correlated `SUM()` over `player_match_stats` grouped by player and season, the same shape the grid catalogue's `seasonStatAtLeast` already proves out.

**`team_match`** rewrites every match, twice — once from each club's own perspective, via a `UNION ALL` CTE — so `win_margin`/`loss_margin`/`team_score`/`opponent_score`/`total_score`/`attendance` all rank uniformly over one row set instead of six different `CASE` expressions. This is the same home/away-to-for/against reframing `players.ts`'s match log and `records.ts`'s `getMatchRecord` already use, done once as a real row set rather than repeated per query. `win_margin` and `loss_margin` are `NULL` — excluded from ranking, the same discipline every other grain here applies to an inapplicable value — for a side that didn't actually win or lose that game, so a drawn Grand Final counts as neither. Each of the six metrics is its own named SQL shape rather than a generic `margin` column with a sign flip, so "biggest win" and "biggest loss" can never be confused by construction.

Quarter and half team scores are derived from the cumulative checkpoint schema: Q2-Q4 subtract the preceding checkpoint, H1 is half-time, and H2 is final minus half-time. Missing checkpoints remain `NULL`. Checkpoint lead wording (`at quarter time`, `at half time`, `at three-quarter time`) is separate: it ranks the cumulative score state at that break, and `but won` filters the final winner after the checkpoint leader is calculated. A team-match `havingClause` changes the payload grain to organization-level grouped rows: result and margin predicates filter matches first, then the compiler counts per organization and applies the requested threshold.

**`team_streak`** builds chronological win, loss or unbeaten islands by club organization. Renames therefore do not split one lineage, mergers remain separate, draws continue only unbeaten streaks, and match ID breaks same-date ordering ties deterministically.

**`achievement_summary`** groups linked achievement occurrences by club, decade, season or occurrence instead of forcing a distribution into a player-ranking row shape.

**`club_season`** reads `club_seasons` directly and ranks by `wins`/`losses`/`draws`/`percentage`, plus four boolean conditions reading already-computed columns — `premier`, `wooden_spoon`, `made_finals`, `missed_finals` (the last two off `finals_played`, `NULL` treated as "not recorded" rather than zero, never `0` = missed) — so "fewest wins by a premier" and "worst team to miss finals" compose a condition with a ranking metric the same way career conditions do. A plan with conditions but no ranking metric ("teams that won the wooden spoon") answers as a plain list, the same list-vs-ranked split `player-career.ts`'s `answerPlayerCareer` already uses. Grain election requires an unambiguous club-season cue — a leading "teams"/"clubs" subject, or one of the four condition phrases — before "wins"/"losses"/"draws" are read as this grain's metric at all, since those words also name a player career column (`NL_CAREER_COLUMNS`); a bare club name alone is deliberately not enough of a cue, since it is just as often a player-scoped question ("richmond's most goals against Carlton").

**Two parser gaps this phase's own external reviews surfaced, both found via a failing test rather than guessed at:**

- A bare year ("most goals in 2025") was silently dropped. `BARE_YEAR_RE` existed in `vocab.ts` but nothing called it, and `meaningfulTokens()` deliberately excludes pure-digit tokens from the confidence ratio (so a genuine number like "2025" never drags confidence down) — the combination meant the dropped year cost the parse *nothing* in confidence, and the question silently answered the career-wide record instead. `extractSeasons` now captures a bare year as an exact one-season range, and grain election routes an otherwise-unclaimed season mention to `player_season` rather than falling through to `player_career` with the season quietly discarded.
- A genuine architectural bug: the team-metric branch of grain election assigned `text = teamMetricResult.text`, a snapshot computed *before* the career/club-season condition extraction stages ran, silently resurrecting whatever those stages had already stripped. "most losses by a premiership team" correctly stripped "premiership team" as a club-season condition, then had it reappear and get misread as a failed player-name guess, declining as ambiguous. Fixed to strip the team-metric word from the *current* text instead of overwriting it wholesale — the kind of latent bug that could have resurfaced anywhere a later extraction stage strips something meaningful before the team-metric branch runs.

**Precedence over the older question-answering.** `parsePlayerQuestion`/`parseClubQuestion` (§ above them in this file, unchanged) still run alongside the NL engine in `globalSearch`'s parallel fetch; when the NL engine answers, both are nulled out before rendering, so a question is never shown twice under two different UIs. They remain the fallback for whatever the NL engine's still-growing vocabulary doesn't yet cover.

**Deliberately deferred**, with an explicit decline rather than silent partial support: conversational follow-ups; youngest/oldest questions while dates of birth are incomplete; average rankings until qualification minima are modelled; and player-quarter rankings until an authoritative populated source and coverage registry exist.

**Search log.** Every `/search` render that reaches the NL engine writes exactly one row to `nl_search_log` (migration 046) — the question (truncated to 200 chars), an `outcome`, and, when a plan was built, its grain/metric/JSON and the parser's confidence and `unsupportedTerms`. `outcome` is wider than a plain answered/declined split: `answered` and `answered_caveat` split on whether the rendered answer carries a caveat or coverage note; `no_results` is a plan that parsed and validated fine but matched zero rows — a different signal from a parser gap, since it usually means the question is just genuinely obscure; the three decline paths (`declined_low_confidence`, `declined_ambiguous`, `unrecognised`) mirror `NlDeclineReason` exactly; `unanswerable` covers both the topic gate and a plan that failed `validatePlan` (most often an era-coverage rejection); `error` covers an unhandled exception. No IP or account identity is recorded — the table is not app-readable (it never calls `afldb_meta.grant_app_read`) and afldb_app cannot query it even by accident; `afldb_auth` holds append-only `SELECT, INSERT`, the same shape as `auth_audit_log`.

The write happens via `logNlSearch` (`db/queries/nl/log.ts`), scheduled with `after()` so a slow or failed log write can never add latency to the answer a reader is waiting on or turn into a failed search — a write failure is caught and logged to the server console, nothing more.

**Observability upgrade (migration 047).** A detailed external review of the search-log design argued that `outcome` alone tells an admin *that* a question failed but not *why*, and proposed a richer schema before any real tuning starts. Six additions, each stored purely for later human review — none of it changes what a reader sees:

- **`failure_reason`** — a closed, fine-grained taxonomy under `outcome` (`unsupported_topic`, `unsupported_term`, `ambiguous_player`, `low_confidence`, `unrecognised`, `coverage_unavailable`, `empty_result`, `query_timeout`, `database_error`, `internal_error`). Deliberately narrower than the reviewed proposal: `ambiguous_club`/`ambiguous_venue` are omitted because club/venue matching is exact-or-nothing (no fuzzy match ever produces certainty < 1 for them today, only a player can), `compiler_not_available` is omitted because every currently supported grain has a compiler, and `partial_coverage`/`suspicious_empty_result` are omitted because nothing in this codebase can distinguish them from noise yet — see log.ts's `NlFailureReason` comment for exactly what would unlock each.
- **`topic`** — the unanswerable-topic slug ("streaks", "coaching"), populated alongside `failure_reason = 'unsupported_topic'`; the input to a future "what should AFLDB build next" report.
- **`parser_version`** — `PARSER_VERSION` (`plan.ts`) at the time of the search, so a vocabulary change's effect can be measured by comparing outcomes either side of the version it shipped in, not guessed at from a deploy timestamp.
- **`confidence_components` / `entity_resolution`** — the parser already computes these (`NlParseReport`); 046 only kept the final scalar. A search that scored 0.71 now shows *why* (a low token ratio? a fuzzy player match? an unresolved mention?) rather than just that.
- **`plan_hash`** — SHA-256 of the plan's canonical (key-sorted) JSON, computed in `log.ts`. Distinct phrasings of the same semantic question ("dusty most disposals", "Dustin Martin's disposal record") collapse to one hash, so "428 raw searches" can become "97 unique things people asked for".
- **`session_id` / `parent_search_id`** — an anonymous, unsigned `nl_sid` cookie (`lib/nl-session.ts`, 30-minute lifetime, never tied to auth or IP) — minted by `middleware.ts`, but only for a visitor who has accepted the analytics banner, and *deleted* there on any request where an acceptance is not on record, so consent is re-checked on every request rather than only at the moment a button was pressed lets a search that follows another from the same session within 60 seconds record which one it likely refines, resolved via a correlated subquery inside the same `INSERT`. A user typing "dusty most goals carlton" and then, seconds later, "dusty total goals against carlton" is the strongest signal available that the first answer didn't match what they meant — an error log can never show this, since nothing about the first search actually failed.

**Human review** gets its own table, `nl_search_review` (one row per `nl_search_log` row, added on demand): a status (`unreviewed` → `reviewing` → `fixed`/`wont_fix`/…), a category (`parser_bug`, `new_alias`, `coverage_limitation`, …), free-text notes, and which parser version fixed it. Kept separate from the immutable telemetry for the same reason an issue tracker is separate from the error it was filed from — `afldb_auth` holds `SELECT, INSERT, UPDATE` on it, unlike `nl_search_log`'s append-only grant, since a review genuinely gets edited as it's worked.

**A jsonb-binding trap, worth knowing before adding another jsonb column.** Migrations 046/047 bound `plan`, `confidence_components` and `entity_resolution` with `JSON.stringify()`, which is the wrong way to bind jsonb through postgres.js: the driver JSON-encodes whatever JS value it is handed, so an already-stringified object is stored as a jsonb **string scalar** containing JSON text. The column then looks fine in the UI and is opaque to SQL — `plan->>'grain'` returns NULL for every row, defeating the whole reason for storing the plan. The intuitive fix does not work either: an explicit `${JSON.stringify(x)}::jsonb` cast still produces a string scalar, because the driver encodes the parameter before the cast is applied. Only `sql.json(x)` produces a real object. Migration 048 repairs the affected rows (`(col #>> '{}')::jsonb`) and adds `jsonb_typeof` CHECK constraints so a regression in the write path is caught by the database rather than by an admin wondering why every extraction is NULL. `lib/jsonb.ts` already existed for the read-side half of this same defect class, which it had been hit by three times over; `auth_audit_log.detail` still carries the old shape from `audit()` and is deliberately left alone, since nothing reads it structurally.

**`/admin/nl-search`** is the super-admin surface over all of this. An overview strip (searches, answered rate, declined rate, median confidence, median and p95 time, reformulation rate) sits above a problems-by-reason table — the taxonomy's whole payoff, since "458 failed searches" directs nobody whereas "187 unsupported terms, 61 ambiguous players, 19 coverage failures" is a work queue. Then the two mining reports: **unsupported terms** (what AFL words readers use that the parser doesn't know) and **unsupported topics** (what they ask for that AFLDB has chosen not to answer — the data roadmap rather than the parser one). Below those, the problem list, likely reformulation pairs, and questions grouped by `plan_hash`. Each search links to a detail page showing the confidence breakdown component by component, the entities resolved and how certain each was, the unsupported terms, the full query plan, the rest of that anonymous session, and a review form writing to `nl_search_review`.

**Clearing telemetry (AFLDB-ISSUE-119, migration 081).** A Super Admin can permanently delete disposable `nl_search_log` rows from `/admin/nl-search` — rows with no review, no matching feedback, and not an ancestor either needs. Every `nl_search_review` and `nl_search_feedback` row is retained regardless, and so is every log row they reference, to the full recursive `parent_search_id` depth; only `app_health_events.related_search_id` links pointing at a deleted row are detached (its schema-declared `ON DELETE SET NULL`), never the health row itself. Identity sequences are not reset. The operator must type the exact phrase `CLEAR SEARCH TELEMETRY`, checked again server-side before anything runs. The deletion itself happens inside `public.nl_search_telemetry_clear()`, a `SECURITY DEFINER` function owned by `afldb_owner` with a pinned `search_path`; `afldb_auth` holds only `EXECUTE` on it and still no direct `DELETE`/`TRUNCATE` on any of the three NL tables, so the shared application role never gains a general delete capability. Deletion and its `auth_audit_log` row (`nl_search.telemetry_cleared`, recording only the five resulting counts — no question, plan or id) commit in one transaction; an audit failure rolls the deletion back. Logging is not paused — a search answered mid-clear is blocked only until the clear's locks release, then recorded as ordinary post-cutoff telemetry.

Nothing here auto-promotes anything. A term appearing 187 times is evidence, not authority — "gazza" is two different players — so the loop is deliberately telemetry → human review → a parser test → a parser change, never telemetry → parser change.

**CSV export** (`/admin/nl-search/export?dataset=…&days=…`) hands the same data over for offline analysis, which is a far better way to read a few hundred real questions than paging through a web table. Seven datasets (`searches`, `problems`, `terms`, `topics`, `reasons`, `reformulations`, `plans`), each a fixed allowlisted builder — an unknown `dataset` is a 400, never a fallback to the largest export. Super-admin only and audited, because unlike the rest of the admin area this hands over raw reader-typed questions in bulk. `lib/csv.ts` handles the two things easy to get wrong: RFC 4180 quoting (an exported question containing a comma would otherwise split into two columns and shift every field after it) and spreadsheet formula injection — a reader who types `=1+1` into the search box would otherwise have that evaluated on the machine of whoever opens the export, so a cell beginning `=`, `+`, `-`, `@` or whitespace-control is prefixed with an apostrophe. Both are pinned by `tests/csv.test.ts`.
