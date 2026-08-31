# AFLDB-ISSUE-110 — Problem Search semantic triage and club-career games

- **Status:** Open
- **Severity:** Medium
- **Area:** Natural-language search / deterministic semantics
- **Found:** 2026-08-30
- **Parser version:** 26 at investigation start → 27 club-career → 28 alias-aware resolution → 29 typed metric thresholds → 30 career-scope backstop → 31 season-scope backstop → 32 generic-season ownership / player-season tie-policy gate
- **Evidence export:** `artifacts/issue-110/problem-search/afldb-nl-problems-30d-2026-08-29.csv`
- **Codebase-memory project:** `D-dev-afldb-issue-110`
- **Latest checked graph generation:** `2026-08-30T01:26:53Z` (`full`, recording complete)

## Symptom

At investigation start, the latest Problem Search export contained two realistic club-career
games questions that parser v26 understood confidently but refused after producing a plan:

1. `most games for Geelong`
2. `players with at least 200 games for Collingwood`

The first elects the wrong grain. The second carries the intended club and career threshold in
the typed plan, but validation correctly refuses because the player-career condition compiler
can currently compare only whole-career columns.

## Expected

- `most games for Geelong` means the player or tied players with the most career appearances
  **for the Geelong organization lineage**.
- `players with at least 200 games for Collingwood` means players with at least 200 appearances
  **for the Collingwood organization lineage**, not whole-career games plus a played-for filter.
- Explicit single-match and season wording must retain their own grain or decline safely.
- Ambiguous player identities, historical coverage gaps, and genuinely empty results must keep
  their safe current behaviour.

## Actual

Current parser v26 reproduction, 2026-08-30:

| Question | Parse | Canonical plan | Validation/product boundary |
|---|---|---|---|
| `most games for Geelong` | `plan`, confidence 1.0, no unsupported terms | `player_game`, `games`, `sum`, `max`, `scope.clubFor=Geelong` | `"games" is not a recognised statistic for this kind of question.` |
| `players with at least 200 games for Collingwood` | `plan`, confidence 1.0, no unsupported terms | `player_career`, metric `null`, list, `games gte 200`, `scope.clubFor=Collingwood` | `This career statistic cannot currently be totalled for one club.` |
| `players with more than 200 games for Collingwood` | same | `games gt 200` | same refusal |
| `players with exactly 200 games for Collingwood` | same | `games eq 200` | same refusal |

Both current failures reproduce the export's `unanswerable / coverage_unavailable` product
classification. That telemetry label is broad: neither failure is caused by `NL_COVERAGE` or
`nlCoverageGap`; both are defence-in-depth `validatePlan` errors logged as
`coverage_unavailable` by `answerNlQuestion`.

## Problem Search export evidence

Direct CSV analysis established:

- physical lines: **544** (header plus 543 data rows);
- raw rows: **543**;
- unique exact questions: **225**;
- exact-question repeat rows beyond the first: **318**;
- observed UTC range: **2026-08-22T03:38:55.455Z** through
  **2026-08-29T16:35:32.917Z**;
- all `reviewStatus`, `reviewCategory`, and `reviewNotes` fields are blank;
- the export has no parser version, build/deployment id, run tag/source, or request/session
  correlation field.

Outcome totals:

| Outcome | Rows |
|---|---:|
| `unrecognised` | 254 |
| `declined_ambiguous` | 95 |
| `unanswerable` | 94 |
| `declined_low_confidence` | 73 |
| `no_results` | 27 |

Failure-reason totals:

| Failure reason | Rows |
|---|---:|
| `unrecognised` | 252 |
| `ambiguous_player` | 95 |
| `coverage_unavailable` | 94 |
| `unsupported_term` | 75 |
| `empty_result` | 27 |

The latest date, 2026-08-29, has 23 rows: 19 `no_results / empty_result`, two
`declined_ambiguous / ambiguous_player`, and the two club-career
`unanswerable / coverage_unavailable` rows.

## Deduplicated semantic-family triage

Every one of the 543 rows and 225 exact wordings is assigned below. Repetition is retained as
chronology evidence but is not counted as independent user incidents.

| Semantic family | Rows | Wordings | First → last | Classification | Evidence/current state |
|---|---:|---:|---|---|---|
| Head-to-head record | 162 | 54 | Aug 22 → Aug 24 | `HISTORICAL_FIXED` | Current representative parses to typed `head_to_head/record`. |
| Head-to-head draw count | 111 | 54 | Aug 22 → Aug 24 | `HISTORICAL_FIXED` | Historical `ambiguous_player`/`player_game coverage` modes; current representative parses to typed `draw_count`. |
| Head-to-head compare wins | 78 | 26 | Aug 22 → Aug 24 | `HISTORICAL_FIXED` | Current v26 regression contract covers typed `compare_wins`. |
| Latest head-to-head draw | 52 | 26 | Aug 22 → Aug 24 | `HISTORICAL_FIXED` | Current representative parses to typed `last_draw`. |
| Grouped opponent thresholds | 51 | 18 | Aug 22 → Aug 29 | `CORRECT_EMPTY_RESULT` | Transition: `declined_ambiguous/ambiguous_player`, no grain, 0.65 → `no_results/empty_result`, `team_match`, 1.0. Independent minima are 5 wins and 8 losses against Richmond and 4 wins against Geelong, so every requested `at most 2` set is empty. |
| Explicit club-career leader | 34 | 16 | Aug 22 → Aug 24 | `HISTORICAL_FIXED` | Current `most career games for Geelong` and `Geelong career leader for games` validate as club-scoped `player_career/games`. |
| Very high career thresholds | 12 | 4 | Aug 22 → Aug 29 | `CORRECT_EMPTY_RESULT` | Stable `no_results/empty_result`, `player_career`, 1.0. Independent distinct-match maximum is Brent Harvey with 432; every 500/1000 set is empty. |
| Bare surname lookup (`ablett`) | 8 | 1 | Aug 23 → Aug 24 | `CORRECT_DECLINE` | No NL semantic cue; repeated eight times. Typed/global search may still surface people independently. |
| Suffixed player career goals/games | 8 | 4 | Aug 22 → Aug 24 | `HISTORICAL_FIXED` | Current suffixed identity resolves at confidence 1.0 and validates at `player_career`. |
| Season-specific club-v-club shorthand | 4 | 4 | Aug 22 → Aug 24 | `NEEDS_SEMANTIC_DECISION` | Intended match-list/result shape is not specified by the current typed answer contract; typo control also present. |
| `First ... grand final` wording | 4 | 3 | Aug 24 | `NEEDS_SEMANTIC_DECISION` | Wording does not clearly distinguish debut, earliest match, or first Grand Final. |
| Suffixed player career kicks | 4 | 2 | Aug 22 → Aug 24 | `HISTORICAL_FIXED` | Old suffix failure; current v26 resolves and validates `player_career/kicks`. |
| Historical inside-50 coverage | 2 | 2 | Aug 27 | `CORRECT_COVERAGE_REFUSAL` | Current plan is `player_season/inside_50s/1900`; validation truthfully refuses because coverage begins in 1998. |
| Unsuffixed Gary Ablett | 2 | 2 | Aug 29 | `CORRECT_AMBIGUITY` | Current bare identity remains `none/ambiguous`, confidence 0.7; Jr and Sr controls resolve independently. |
| `most games in a game` for a player | 2 | 1 | Aug 22 → Aug 24 | `NEEDS_SEMANTIC_DECISION` | Semantically incoherent wording. Current v26 now consumes the single-game cue but validates a career-games plan; this unsafe collision is retained as an unresolved negative-control candidate, not patched with a literal regex. |
| Suffixed player single-game goals | 2 | 1 | Aug 22 → Aug 24 | `HISTORICAL_FIXED` | Current v26 resolves the suffix and validates `player_game/goals/single`. |
| Unclear goal/handball numeric wording | 2 | 2 | Aug 22 | `NEEDS_SEMANTIC_DECISION` | Metric, role of `21`, and role of `1996` are not safely inferable. |
| Ambiguous `most points` metric | 1 | 1 | Aug 22 | `NEEDS_SEMANTIC_DECISION` | Could mean score, fantasy points, premiership points, or another unsupported measure. |
| Club-scoped career threshold | 1 | 1 | Aug 29 | `CURRENT_WRONG_ANSWER` | v27 filters and counts the organization-lineage appearances exactly, but multi-row payload/UI output labels whole-career games as `Games`; projection/rendering remains wrong-scope. |
| `by a <club> player` phrasing | 1 | 1 | Aug 22 | `HISTORICAL_FIXED` | Current reproduction validates `player_game/disposals/max` with Brisbane organization scope. |
| Club-career games shorthand | 1 | 1 | Aug 29 | `HISTORICAL_FIXED` | Baseline first wrong layer was grain election; current v27 exact execution returns Tom Hawkins with the independently proven 359 Geelong appearances. |
| Bare unknown name (`Brady Rowles`) | 1 | 1 | Aug 22 | `CORRECT_DECLINE` | No resolvable identity or NL semantic cue was established. |

The 22 family totals are exactly 543 rows and 225 unique wordings.

## Chronology and replay assessment

- The record/compare/draw/club-leader groups occur in tightly ordered, repeated club matrices
  on Aug 22 and Aug 24. Their cadence and identical shapes strongly indicate benchmark or
  replay sweeps, not hundreds of independent incidents.
- The grouped opponent family materially transitions from ambiguity at 0.65 to a valid
  `team_match` plan at 1.0 followed by an empty result. The old ambiguity is not the current
  investigation.
- Exact-question deduplication removes 318 repeated observations. They are marked likely
  `BENCHMARK_OR_REPLAY_NOISE` for incident counting, but the export cannot prove their origin.
- Because parserVersion/buildId/runTag/source/session correlation are absent, reliable
  row-to-build and benchmark-to-user attribution is a `TELEMETRY_GAP`. Timestamp inference is
  used conservatively; current source reproduction is authoritative for current behaviour.

## Current collision and safety controls

- `most career games for Geelong` → valid `player_career/games`, organization scope.
- `Geelong career leader for games` → valid `player_career/games`, organization scope.
- `most games in a match for Geelong` → `player_game/games/single`, validation refusal.
- `most games in a season for Geelong` → valid `player_season/games`.
- bare `Gary Ablett career games` → safe ambiguity at 0.7.
- suffixed Jr and Sr career-games questions → distinct valid player refs.
- current head-to-head record, draw count, and last-draw representatives all validate.
- `Most Disposals in a Match by a brisbane player` now validates without leftovers.

## First wrong layer and root cause

### Club-career shorthand

The club is extracted correctly, `games` resolves correctly, `max` is correct, and confidence
is 1.0. Grain election treats any named club as match-level scope unless an explicit
`career`/`ever` cue is present. With no single-match or season cue, `most games for Geelong`
therefore becomes `player_game/sum`. The first wrong layer is **parser grain election**.

### Club-career threshold

The normalized query, club entity, grain, list aggregation, comparison operator, threshold,
and typed career condition are all correct. `validatePlan` deliberately refuses a
club-scoped unranked career plan because the current `conditionSql` compares
`player_career_stats.games` (whole career), while `conditionsWhere` adds only an organization
membership `EXISTS`. Allowing that plan unchanged would answer the wrong scope. The first wrong
layer is the **validated compiler contract**, not parsing or historical coverage.

The ranked metric compiler already has the correct organization-lineage expression:
`count(DISTINCT player_match_stats.match_id)` joined through `clubs.organization_id`. The
threshold path does not reuse or equivalent that expression.

## Rejected hypotheses

- **The export rows are historical only:** rejected; both exact candidates reproduce under
  current parser v26.
- **Club entity resolution is failing:** rejected; both clubs resolve with certainty 1.0.
- **`NL_COVERAGE` is refusing games:** rejected; the logged failure label wraps a validation
  error, and games has no historical coverage gap here.
- **The threshold parser loses the comparison or threshold:** rejected; `gte`, `gt`, and `eq`
  all survive in `careerConditions`.
- **The compiler has no organization-level career totals:** rejected in part; ranked
  `player_career` metrics already implement lineage-aware games/stat totals. The missing path
  is a club-scoped career **condition**.
- **Whole-career totals plus club membership are acceptable:** rejected; that is a different
  question and violates the established organization-scoped games contract.

## Implementation plan

1. Add focused failing parser/plan controls in `tests/nl-semantic-mapping.test.ts` before code.
2. Add DB-backed organization-lineage threshold controls to the closest existing integration
   semantic suite before compiler changes.
3. Route unscoped-by-match/season `most games for <club>` to the existing typed
   `player_career/games` plan without stealing explicit match/season wording.
4. Compile a `games` career condition against the named organization lineage when
   `scope.clubFor` is present, and relax validation only for a shape the compiler can fully
   honour. Do not use whole-career games plus membership.
5. Preserve parameterized SQL, ties, Jr/Sr ambiguity controls, historical coverage refusal,
   head-to-head/draw/operator regressions, and organization scoping.
6. Because parser plan behaviour changes, record parser version `26 -> 27` when the parser edit
   is made, following the version-history contract in `plan.ts`.

## Implementation

- `src/search/nl/parser.ts` adds a composable club-career-games shorthand cue. It requires a
  named subject club, `games`, max aggregation, no named player, and no match, season, venue,
  opponent, matchup, or match-type cue. It produces the existing `player_career/games` plan;
  there is no literal full-query special case and no new answer path.
- `src/search/nl/plan.ts` bumps parser version **26 → 27** and permits a club-scoped unranked
  career list only when it has at least one condition and every condition is the typed `games`
  column. Mixed or unsupported club-scoped conditions remain refused.
- `src/db/queries/nl/player-career.ts` centralizes the organization-lineage
  `count(DISTINCT player_match_stats.match_id)` expression and uses it for both ranked games and
  club-scoped games conditions. The organization id and threshold remain bound parameters;
  only the comparison operator comes from the existing closed allowlist.
- `tests/nl-semantic-mapping.test.ts` covers the exact wording, two club-entity metamorphic
  variants, all three requested comparators, match/season collisions, a mixed-condition safe
  refusal, and unsuffixed/suffixed Gary Ablett controls.
- `tests/integration/nl-semantic-mapping.test.ts` extends the existing lineage fixture. Its
  whole-career leader deliberately differs from its club-lineage leader, and the new `gte`,
  `gt`, and `eq` cases compare compiler output with independently written grouped SQL.

No NlQueryPlan field was added: the existing typed combination of `scope.clubFor` and
`careerConditions.games` already carries the intended semantic. The change completes the
compiler/validation contract for that existing shape.

## Validation

### Completed

- Full CSV row/wording/family/chronology analysis: complete.
- DB-free current parser/validation reproduction: complete.
- Current historical-family and collision-control parse checks: complete.
- Codebase-memory structural discovery plus direct-source verification: complete for the
  material parser, plan, answer, execute, and player-career paths.
- Focused red baseline before implementation: four intended failures (shorthand grain plus
  `gte`/`gt`/`eq` validation).
- Exact focused suite after implementation: **52/52 passed**.
- Consolidated DB-free NL matrix: **7 suites, 473/473 passed**
  (`nl-semantic-mapping`, parser, plan, describe, regression corpus, audit acceptance, and
  query intent).
- Typecheck: **passed** (`next typegen` and `tsc --noEmit`).
- Exact Problem Search parser rerun under v27: both selected wordings and all requested
  comparator variants produce valid typed plans at confidence 1.0 with no unsupported terms.
- Test database safety state: owner and restricted-import DSNs target
  `127.0.0.1:55432/afldb_test`; migrations are **78/78 applied, 0 pending**.
- Focused DB integration: **1 file, 9/9 tests passed**. The lineage fixture proves that
  club-scoped ranking and `gte`/`gt`/`eq` conditions do not fall back to whole-career games.

The graph reports source metadata changed relative to generation and partial parsing at
`src/db/queries/nl/player-career.ts:202,223` after the edit; direct source for both containing
functions and every edited implementation range was read and is authoritative. `artifacts/`
is intentionally not indexed, so the CSV was read
directly.

### Environment chronology

- The prior missing-DSN blocker is superseded by the validated `_test` configuration above.
- The first focused Vitest attempt inherited the stale `.env` port 5432 and failed with
  `ECONNREFUSED`; all nine tests were skipped, so it was not a semantic result.
- A second attempt using the redacted host/user form at port 55432 reached PostgreSQL but lacked
  the owner password and failed authentication; again all tests were skipped.
- The successful attempt reused the existing local owner credential without displaying or
  modifying it, changed only the process-local port to 55432, connected as `afldb_owner` to
  `afldb_test`, and passed 9/9. No production or `afldb_dev` connection was made.

## Independent DB truth

Read-only SQL was written independently of the NL compiler. Club appearances were calculated
as `count(DISTINCT player_match_stats.match_id)` after joining `player_match_stats.club_id` to
`clubs.organization_id`. Opponent records were independently expanded into home/away
perspectives and grouped at organization level. Global career games were independently counted
from distinct match rows rather than read from `player_career_stats`.

### Geelong organization (id 10)

- Tom Hawkins (player 12566): **359** Geelong appearances, the unique maximum.
- `most games for Geelong`, `most career games for Geelong`, and
  `Geelong career leader for games` all execute under v27 as `player_career/games/max` and
  return Tom Hawkins, 359, one result. Classification: **PASS_EXACT**.

### Collingwood organization (id 5)

- At least 200 Collingwood appearances: **39 players**.
- More than 200 Collingwood appearances: **38 players**.
- Exactly 200 Collingwood appearances: **Josh Fraser (player 7872), one player**.
- Maximum Collingwood appearances: Scott Pendlebury, **425**.
- The v27 compiler returns exactly 39, 38, and 1 qualifying rows respectively, so filtering,
  operators, result counts, and organization scope are **PASS_EXACT**.

The rendered payload contract is not fully correct. Unranked `player_career` rows retain the
whole-career `games` column even when qualification is club-scoped: Josh Fraser qualifies on
200 Collingwood appearances but his row carries 218 whole-career games; Len Thompson qualifies
on 268 Collingwood appearances but a multi-row result carries 301 whole-career games. The UI's
`PlayerCareerTable` labels this field `Games`. Multi-row `gte`/`gt` answers therefore display a
wrong-scope value despite selecting exactly the right players. Classification:
**CURRENT_WRONG_ANSWER / WRONG_SCOPE (presentation row value)**. The v27 parser and condition
filter are not contradicted; the remaining defect is projection/answer rendering.

### Grouped opponent thresholds

The complete set of organizations that played each opponent was included, including zero-event
possibilities. Independent minima are:

- wins against Richmond: **5**, University;
- losses against Richmond: **8**, Gold Coast;
- wins against Geelong: **4**, Brisbane Bears and Gold Coast.

Therefore all three `at most 2` sets are empty. Current v27 execution produces the correct
`team_match` organization-level plan and zero results for all three. Classification:
**CORRECT_EMPTY_RESULT**.

### High career thresholds

Brent Harvey (player 2164) has the independent all-player maximum of **432** distinct career
matches. Counts for `>= 500`, `> 500`, `>= 1000`, and `> 1000` are all zero; current v27
execution returns zero for all four. Classification: **CORRECT_EMPTY_RESULT**.

## Real Problem Search rerun

The parser/validation half is green under v27:

- `most games for Geelong` → `player_career`, `games`, `max`, Geelong organization, valid;
- `players with at least 200 games for Collingwood` → list, `games gte 200`, Collingwood
  organization, valid;
- `more than` → `gt`; `exactly` → `eq`;
- confidence 1.0 and `unsupportedTerms=[]` for every selected/adjacent wording;
- explicit match wording remains `player_game/single` and refuses the nonsensical per-game
  `games` metric; explicit season wording remains valid `player_season/games`.

The exact selected wording plus all opponent/high-threshold controls were rerun through the
current parser, validation, compiler, and SQL execution path without telemetry writes. All 13
questions parsed at confidence 1.0 with `unsupportedTerms=[]`; entity scope, operators, result
sets, and counts agree with independent SQL. Rendered `answerNlQuestion`/telemetry execution is
still pending, and the Collingwood multi-row `Games` presentation discrepancy above must be
fixed before that gate can pass.

## Benchmark impact

Not run by explicit scope: this continuation prioritized the focused integration and independent
truth gates and was instructed not to start the realistic UI or decline benchmarks unless all
DB truth work was complete with clearly sufficient time. The remaining presentation defect
also makes broad benchmark execution premature. Current discovered files are:

- focused parser/plan suites: `tests/nl-parser.test.ts`, `tests/nl-plan.test.ts`,
  `tests/nl-semantic-mapping.test.ts`;
- realistic product corpus:
  `tests/nl-ui/corpora/afldb-ui-questions-1440-real-user-v3-20260822.csv`;
- realistic decline corpus:
  `tests/nl-ui/corpora/afldb-ui-questions-60-real-user-decline-v3-20260822.csv`.

The historical 1435-row filename is superseded by the current 1440-row corpus. The previously
named `.claude/...480...csv` path does not exist in this worktree and was not recreated from the
stale name.

The runnable focused semantic corpus is represented by `tests/nl-regression-corpus.test.ts` and
is green within the 473-test matrix. The 1440-row corpus contains the existing explicit
club-career leader controls but not either new exact Problem Search wording; no expected outcome
was edited and no realistic question was removed.

## Remaining candidates

1. Club-scoped threshold result projection/rendering: expose organization-scoped appearances,
   not whole-career `games`, in multi-row answers.
2. `most games in a game` currently consumes a single-game cue but produces a career plan;
   retain as a semantic-decision/negative-control candidate, not a literal phrase patch.
3. Season-specific club-v-club shorthand needs a typed product/answer decision.
4. Parser/build/run identity is missing from the export; telemetry follow-up is justified but
   is not required for the selected semantic correction and is not being mixed into it.

## Follow-up

- Correct and regression-test the club-scoped threshold row value/presentation contract without
  weakening the now-proven organization-lineage filter.
- Rerun focused integration and exact rendered `answerNlQuestion`/telemetry wording, then run
  the realistic UI and decline benchmarks before resolving ISSUE-110.
- Do not update Problem Search review fields until the product's supported development/test
  mutation path is established; no direct telemetry-table write is authorized here.

## 2026-08-30 architecture milestone: Gary Ablett suffix identity

### Milestone scope and measured state

The refreshed 480-case UI validation completed with **440 passed and 40 absent**. All 40
absences are one defect family, `semantic_player_suffixes`, rather than 40 independent
failures. They cover the Jr/Jnr/Junior and Snr variants across the expected career metrics and
wording forms. They are expected to produce plans, so this is not a corpus-expectation repair
and expectations must not be changed merely to make the suite green.

The earlier ISSUE-110 implementation and focused baseline remain complete. Club-scoped
projection/rendering is correct and the latest focused integration result is **11/11 passed**.
The 1,435 realistic benchmark and 60-question decline benchmark remain pending until this
suffix family is corrected and the 480-case validation is refreshed.

### Root-cause classification

The 40 cases share a **combined resolver and authoritative alias-data defect**, with two
additional contract gaps at the parser and regression-fixture boundaries:

1. **Generic resolver defect.** `searchPlayers` searches only `players.search_name` even though
   `player_name_aliases.search_alias` is first-class indexed search data. `resolvePlayer`
   delegates directly to `searchPlayers`; no separate generic alias-aware player-search API
   exists.
2. **Authoritative alias-data defect.** The canonical importers currently write only each
   primary display/search name as a `source_string` alias. They do not load explicit Jnr/Snr
   identities for the two canonical Gary Ablett records.
3. **Parser matched-identity evidence gap.** Even an alias-aware ranker must expose the form
   that actually matched. The parser currently justifies and consumes player tokens against
   the canonical candidate name, so a suffix/alternate-name token can remain unjustified when
   the canonical display name intentionally differs from the matched alias.
4. **Production-shape regression-fixture gap.** Existing focused integration fixtures put
   `Jnr` and `Snr` directly in the primary player names. That bypasses the canonical production
   shape (identical primary names plus explicit aliases) and allowed focused validation to pass
   without exercising either the resolver or alias-data boundary.

### Production and database evidence

- `searchPlayers` currently matches and scores only `players.search_name`, using
  exact/prefix/substring/trigram relevance plus the existing career-games prominence signal.
- Migration 002 defines `player_name_aliases` for maiden/alternate spellings and source
  variants, with stored `search_alias`; migration 008 creates both exact and trigram alias
  indexes; migration 009 requires ETL to maintain stored alias normalisation.
- Other AFLDB identity workflows already consume `player_name_aliases`, including award import
  matching and birth-date enrichment. Alias-aware matching is therefore an established
  application pattern, not a new semantic model.
- The club and venue search paths already demonstrate matching aliases and deduplicating the
  owning entity. There is no existing alias-aware player-search function to reuse unchanged.
- Read-only `afldb_test` truth identifies player **4701** as Gary Ablett Senior: **248** career
  games, independently counted as 248, seasons **1982-1996**.
- Read-only `afldb_test` truth identifies player **4702** as Gary Ablett Junior: **357** career
  games, independently counted as 357, seasons **2002-2020**.
- Both canonical rows currently have `display_name = 'Gary Ablett'` and
  `search_name = 'gary ablett'` (and also share the current sort name and slug).
- Their only `player_name_aliases` rows repeat `Gary Ablett` / `gary ablett`; no Jnr/Snr
  aliases exist. Exact parser lookup forms `gary ablett jnr` and `gary ablett snr` therefore
  match no alias.
- Generic fuzzy scoring returns the same ordering for both suffixes, led by player 4702 due to
  `search_rank`, and both scores remain below the parser's acceptance threshold.
- Stable AFLTables identities distinguish the records without surrogate IDs:
  `players/G/Gary_Ablett0.html` identifies Senior and
  `players/G/Gary_Ablett1.html` identifies Junior. Both were matched by profile URL; their
  `external_name` values are null. No corresponding `player_relationships` evidence exists.
- No chronology-based, surrogate-ID-based, duplicate-order, or similar inferred suffix rule is
  acceptable. It could misclassify unrelated same-name players. The identity distinction must
  be explicit data.

### Approved generic resolver design

`searchPlayers` will:

- search both `players.search_name` and `player_name_aliases.search_alias`;
- score relevance against the actual primary name or alias form that matched;
- preserve the existing career-prominence contribution;
- retain the best matching form per player and return each player only once;
- preserve the canonical title/display-name contract for ordinary search results; and
- expose the matched identity separately (for example, `matchedName`) rather than replacing
  canonical player identity/display data with the alias.

`resolvePlayer` will propagate the matched identity evidence into the NL candidate contract.
The parser will use that matched form for alias/suffix token justification, plausibility, and
consumption while retaining the canonical `NlPlayerRef` for stable identity and display. No
Gary-Ablett-specific parser or resolver branch will be added.

This correction is deliberately generic. It makes existing and future maiden names, alternate
spellings, source variants, and generational aliases available to global player search,
autocomplete, and deterministic NL resolution through the shared `searchPlayers` path.

### Approved authoritative alias-reference design

Explicit identity aliases will be retained as tracked reference data, proposed at
`data/reference/player-name-aliases.json`. Entries will be keyed by stable source plus external
identity, never `players.id`. The initial established facts are:

- AFLTables `players/G/Gary_Ablett0.html` -> `Gary Ablett Snr`;
- AFLTables `players/G/Gary_Ablett1.html` -> `Gary Ablett Jnr`.

The canonical FitzRoy importer will resolve those source identities and load their aliases into
the existing `player_name_aliases` table generically. Loading must normalise through the
database name-normalisation contract, be idempotent, fail closed for a missing/ambiguous stable
identity, and preserve unrelated manual/source aliases. No schema migration is required: the
existing table, uniqueness contract, and indexes are sufficient. A data load is required
because the suffix facts cannot be inferred safely, but no database mutation was performed in
this architecture milestone.

### Required compatibility and focused regression coverage

Implementation must preserve ordinary canonical player search while proving all of the
following without weakening existing assertions:

- exact generic alias ranking uses the matched alias and preserves career prominence;
- the canonical result title/name remains intact while `matchedName` is returned separately;
- a player is returned once when both primary and alias forms match;
- the parser uses matched-name evidence to justify and consume suffix/alias tokens;
- unrelated leftover tokens still decline rather than disappearing behind a valid alias;
- the database integration fixture gives Junior and Senior identical primary display/search
  names and represents Jnr/Snr only through `player_name_aliases`;
- Jr, Jnr, and Junior resolve only the Junior fixture;
- Sr, Snr, and Senior resolve only the Senior fixture;
- bare `Gary Ablett` remains safely ambiguous;
- at least one non-Gary alternate alias resolves through the full database-backed NL path; and
- the importer/reference contract proves stable external identity, normalisation, idempotence,
  preservation of unrelated aliases, and fail-closed behavior.

### Expected implementation files

- `src/db/queries/search.ts`
- `src/db/queries/nl/resolve.ts`
- `src/search/nl/parser.ts`
- `data/reference/player-name-aliases.json` (new)
- `tools/migration/import_fitzroy_core.py`
- `tests/nl-semantic-mapping.test.ts`
- `tests/integration/nl-semantic-mapping.test.ts`
- `tests/fitzroy-core-import.test.ts`

Tracking updates after implementation/validation remain this runbook, `CHANGELOG.md`, and
`IssuesIndex.md` when its concise state/next-action entry changes materially.

### Runtime, files, and deviations at handoff

- Exactly one ISSUE-110 Next.js server is running at `http://127.0.0.1:3110`, listener PID
  **25844** (`node`). TCP verification succeeded and `/api/health` returned HTTP **200** with
  database status `ok`.
- The server uses `afldb_test`. Database access is through the existing local SSH tunnel at
  `127.0.0.1:55432`; PostgreSQL correctly reports its server endpoint as
  `127.0.0.1:5432`. The 55432 setting is a process-only runtime override, not the persisted
  `.env` port.
- No implementation files were changed during this architecture milestone. The only retained
  repository change for the milestone is this ISSUE-110 runbook update.
- No Git command, schema/migration change, database mutation, second server start, firewall
  change, or unrelated-worktree access occurred.
- The codebase-memory graph service returned transport errors during the latter architecture
  inspection. Bounded direct reads of the named source, migration, importer, and test files
  supplied the evidence above. This was an inspection-tool deviation, not a semantic/runtime
  failure.
- The earlier Node/tsx ENOMEM remains classified as an environment/resource failure; it did
  not recur during the read-only SQL/source classification path.
- Temporary task files still require review and cleanup after their evidence is no longer
  needed: `tools/nl/issue110-classify.ts`, `tools/nl/issue110-node-preload.cjs`, and
  `tests/nl-ui/.auth/state.json`.

### Subsequent measured validation and scope control

After focused implementation validation, the next validation stage must measure broader NL
benefit rather than assuming the change affects only Gary Ablett:

1. determine whether non-Gary failed questions improve through generic alias resolution;
2. rerun the refreshed 480-case UI validation;
3. run the measured 1,435-question realistic benchmark;
4. run the measured 60-question decline benchmark; and
5. cluster every remaining failure by common root cause, reporting totals, pass/fail,
   answered/absent/declined, timings, semantic mismatches, hydration failures, and runtime
   failures.

The 30-day Problem Search evidence remains context for that clustering:
**543 problem events / 225 unique questions**, approximately **252 unrecognised**,
**95 ambiguous_player**,
**94 coverage_unavailable**, **75 unsupported_term**, and **27 empty_result**. Unrelated
high-volume clusters should become focused follow-up issues rather than expanding ISSUE-110
indefinitely.

### Exact next action (superseded 2026-08-30 by Stage 1 completion below)

Start a fresh implementation session in `D:\dev\afldb-issue-110` on branch
`codex/issue-110`. Implement the approved generic alias-aware player resolution and
authoritative stable-identity alias-reference layer with the focused regression coverage above.
Do not start another server; reuse the existing healthy server on port 3110. After the focused
implementation milestone is validated, persist its actual files and measured results here and
stop before beginning the broader validation stage.

## 2026-08-30 Stage 1 COMPLETE: generic alias-aware player resolution

Stage 1 implemented only the generic resolver portion of the approved architecture. No
reference data, importer, database, schema, fixture-shape (Gary), or corpus work was done.

### Implementation

- **`searchPlayers` (`src/db/queries/search.ts`).** A `matched` CTE scores
  `players.search_name` and `player_name_aliases.search_alias` as two `UNION ALL` branches,
  each keeping its own indexed `LIKE` / trigram `%` predicate and the existing
  exact (1000) / prefix (500) / substring (250) / `similarity * 100` relevance. A `best` CTE
  takes `DISTINCT ON (player_id)` ordered by `form_rank DESC, is_primary DESC, matched_name`,
  so each player is returned exactly once with their strongest form. The career-prominence
  term (`LEAST(COALESCE(search_rank, 0), 400) / 10`) is added once per player after that
  choice. `title` remains `players.display_name`; the winning form is exposed as a new
  optional `SearchResult.matchedName`. Because the canonical importers already write the
  primary name as a `source_string` alias, the `is_primary` tie-break keeps
  `matchedName === title` and the previous ordering for ordinary canonical searches; an alias
  becomes the matched form only when it genuinely outscores the primary name. Final ordering
  (`rank DESC, games DESC, sort_name`) and `LIMIT` are unchanged.
- **`resolvePlayer` (`src/db/queries/nl/resolve.ts`).** Passes
  `matchedName: r.matchedName ?? r.title` alongside the unchanged canonical `ref`.
- **Parser (`src/search/nl/parser.ts`).** `NlPlayerCandidate` gains optional `matchedName`.
  New `candidateNameWords()` returns the canonical-name words **plus** the matched-form words.
  The three sites that previously split only `ref.name` (top-candidate token justification and
  consumption, the same-name ambiguity count, and the below-threshold plausibility filter) now
  use it. `resolvedTo`, `plan.player`, and display remain the canonical `NlPlayerRef`.
- **`PARSER_VERSION` (`src/search/nl/plan.ts`)** bumped **27 → 28** with a numbered changelog
  entry, because alias evidence can now justify tokens that version 27 left unjustified, so a
  player question can resolve where 27 declined; telemetry and corpus comparisons must be able
  to distinguish the two behaviours.

### Compatibility decisions

- `matchedName` is optional on `SearchResult` and `NlPlayerCandidate`: `searchClubs`,
  `searchVenues`, `globalSearch`, `autocomplete`, `PlayerPicker`, and injected test resolvers
  are unaffected and canonical `title`/`name` semantics are preserved.
- The alias form is additional identity/token evidence only. It never replaces the canonical
  player identity or display name, and a token contained in neither form remains an
  unjustified leftover for the decline gate.
- Player deduplication and the primary-name tie-break are enforced in SQL, not post-processed.
- No Gary-Ablett-specific resolver or parser logic exists. No Senior/Junior inference from
  chronology, surrogate IDs, age, games, or duplicate-name ordering was added.

### Files changed

Production:

- `src/db/queries/search.ts`
- `src/db/queries/nl/resolve.ts`
- `src/search/nl/parser.ts`
- `src/search/nl/plan.ts` (`PARSER_VERSION` only)

Tests:

- `tests/nl-semantic-mapping.test.ts` — Gary fixtures moved to production shape (identical
  canonical `Gary Ablett` refs, suffix carried only in `matchedName`; the suffix test now also
  asserts the plan name is canonical); new `AFLDB-ISSUE-110 matched-identity evidence` block
  with generic `Tom Fixture` / `Thomas Fixture` candidates proving alias-token justification,
  canonical ref retention when canonical differs from matched form, same-canonical-name
  ambiguity without a distinguishing alias, and leftover-token decline beside a valid alias.
- `tests/integration/nl-semantic-mapping.test.ts` — fixture adds
  `Semanticfixture Robert Aliasholder` (primary-as-alias plus alternate alias
  `Semanticfixture Bob Aliasholder`) and a no-alias control `Semanticfixture Bruce Plainname`;
  new `AFLDB-ISSUE-110 alias-aware player search` block proving exact alias match with
  canonical title and `matchedName`, single return when primary and primary-alias both match
  (primary form preferred), unchanged exact canonical ranking for a player with no aliases, an
  alternate alias resolving through the full database-backed NL path to the canonical player,
  and leftover-token decline. Cleanup relies on the existing
  `player_name_aliases ... ON DELETE CASCADE`.

### Focused validation (2026-08-30, operator-executed)

`npx vitest run tests/nl-semantic-mapping.test.ts tests/integration/nl-semantic-mapping.test.ts`
(vitest 4.1.10, `afldb_test` via the 55432 tunnel):

- `tests/integration/nl-semantic-mapping.test.ts` — **16/16 passed** (3420 ms)
- `tests/nl-semantic-mapping.test.ts` — **56/56 passed** (38 ms)
- **Total 72/72 passed, 2/2 files, 4.25 s**
- No PostgreSQL/tunnel failure, no runtime failure, no ENOMEM recurrence.

The validation above was run before the `PARSER_VERSION` 27 → 28 bump; that bump is a
constant and comment change only, with no assertion in `tests/` or `src/` pinning 27.

### Deviations

- None from the approved generic resolver design. The existing Gary integration fixtures still
  carry `Jnr`/`Snr` in their primary names; moving them to the production shape is deliberately
  deferred to the stage that loads authoritative alias data, so it is proven against that
  loader rather than a hand-inserted alias.
- `CHANGELOG.md` and `IssuesIndex.md` were not updated in Stage 1; the retained behaviour
  change will be recorded once the alias-data stage makes it user-visible for production data.

### Runtime state at handoff

- The existing ISSUE-110 Next.js server remains running on `http://127.0.0.1:3110`; no second
  server was started.
- The existing PostgreSQL SSH tunnel to `afldb_test` remains on `127.0.0.1:55432`.
- No Git, schema, migration, reference-data, database-mutation (outside the test suite's own
  self-cleaning fixtures), or unrelated-worktree action occurred.

### Exact next action (superseded 2026-08-30 by Stage 2 completion below)

Stage 2 — fresh Fable session in `D:\dev\afldb-issue-110` on branch `codex/issue-110`:
implement the stable-identity player alias reference layer
(`data/reference/player-name-aliases.json`, keyed by stable source plus external identity) and
canonical FitzRoy importer loading/validation (`tools/migration/import_fitzroy_core.py`) with
focused import/reference tests (`tests/fitzroy-core-import.test.ts`), proving stable external
identity, normalisation through the database contract, idempotence, preservation of unrelated
aliases, and fail-closed behaviour for a missing/ambiguous identity. Do not start another
server; do not run the large corpora; do not begin the broader validation stage.

## 2026-08-30 Stage 2 COMPLETE: stable-identity player alias reference layer

Stage 2 implemented the authoritative alias-reference layer and its canonical FitzRoy importer
loading/validation. Stage 1 behaviour (alias-aware `searchPlayers`, `matchedName`
propagation, `PARSER_VERSION` 28) is unchanged. No schema migration was required or written.

### Implementation

- `data/reference/player-name-aliases.json` (new). Tracked curated aliases, shape
  `aliases: [{ source, external_id, alias, note }]`. Initial authoritative entries:
  - `afltables` / `players/G/Gary_Ablett0.html` → `Gary Ablett Snr`;
  - `afltables` / `players/G/Gary_Ablett1.html` → `Gary Ablett Jnr`.
- `tools/migration/import_fitzroy_core.py`:
  - `PLAYER_ALIASES_JSON`, `PLAYER_ALIAS_TYPE = "alternate"`;
  - `load_player_alias_reference(path)` reads and validates the document;
  - `resolve_alias_identities(entries, rows)` is the pure fail-closed identity resolver;
  - `apply_player_name_aliases(pg, entries)` resolves then inserts (no commit);
  - `import_player_name_aliases(pg, rep, args)` wraps the load in an `import_batch`
    (`target_table = player_name_aliases`) and commits;
  - new import group `aliases` in `GROUPS`, ordered directly after `players`, so a full
    import loads it and `--groups aliases` loads it alone without re-importing players.
- `tests/fitzroy-core-import.test.ts`: new
  `curated player alias reference (AFLDB-ISSUE-110 Stage 2)` block (6 tests).

### Reference-data contract

- Entries are keyed by **source registry key + that source's stable external identity**,
  exactly as stored in `external_identities.external_id`. For `afltables` that is the
  canonical profile path (`players/A/Name.html`) under `match_method`
  `afltables_profile_url`.
- `players.id` is never accepted as a key: the loader refuses any entry carrying
  `player_id`/`players_id`/`id`.
- The loader refuses: `aliases` not a list; missing/blank `source`, `external_id`, or
  `alias`; leading/trailing/double whitespace; a non-canonical afltables `external_id`
  (for example a full URL); and a case-insensitive duplicate alias for one identity. A
  refusal rejects the whole file, mirroring how `ClubResolver` refuses an inconsistent
  tracked rule.
- Two different aliases for one identity, and one alias shared by two identities (the bare
  ambiguous name), are both legitimate and accepted.

### Importer safety and idempotence decisions

- Resolution is through `external_identities JOIN sources` with status `unique`/`resolved`
  and a non-null `player_id`, **before** any write. An identity that resolves to no player,
  an unresolved (`ambiguous`, null-player) registration, an unknown source key, or an
  identity resolving to more than one player refuses the whole batch with a `RuntimeError`
  and writes nothing (all-or-nothing).
- `search_alias` is derived in SQL by `afldb_normalise_name()`, the same function the
  search queries use, so it cannot drift from the database contract.
- Insert-only: `INSERT … ON CONFLICT (player_id, alias) DO NOTHING`. No `DELETE`, no
  `UPDATE` of any alias row; unrelated manual and `source_string` aliases are preserved and
  a repeated load inserts zero rows.
- No inference of Senior/Junior from chronology, age, games, IDs or duplicate ordering, and
  no name matching: the loader trusts only the registered external identity. The importer
  contains no player-specific (Gary) logic; the static test pins that no `Ablett` string
  exists in the importer source.

### Files changed

- `data/reference/player-name-aliases.json` (new)
- `tools/migration/import_fitzroy_core.py` (+140/−1, CRLF preserved)
- `tests/fitzroy-core-import.test.ts`
- `issues/open/AFLDB-ISSUE-110.md` (this record)

### Validation (operator-run, 2026-08-30)

`npx vitest run tests/fitzroy-core-import.test.ts -t "AFLDB-ISSUE-110 Stage 2"`

- `curated player alias reference (AFLDB-ISSUE-110 Stage 2)` — **6/6 passed, 0 skipped**
  within the targeted block (1 file passed; 81 other tests skipped only because `-t`
  selected the Stage 2 block; 1.73 s).
- Proved: stable source + external-identity keys with no `players.id`; `aliases` group is
  insert-only with no player-specific logic; the tracked reference file validates;
  malformed/surrogate-keyed/duplicate entries fail closed; a multiply-resolved identity fails
  closed on the resolver (`external_identities_uq` makes that state unreachable in the
  table); DB-backed loading resolves two players with **identical** canonical names to
  Snr/Jnr solely through external identity; `search_alias` normalisation; repeated load
  idempotent (second load 0 rows, table delta exactly 2); unrelated manual/`source_string`
  aliases preserved; missing/partially-missing/unresolved/unknown-source batches all refuse
  with nothing written.
- DB-backed case executed with psycopg 3.3.4 (`D:\dev\afldb\.venv\Scripts\python.exe`)
  against `afldb_test` only, through the existing local 55432 tunnel, inside one
  transaction under a fixture `sources` row and rolled back by the test.
- No runtime failure, no ENOMEM recurrence.

### Deviations

- None from the approved design. The alias load is a separately selectable `aliases` group
  rather than an inline step of `import_players`, so a synthetic-snapshot players import
  cannot fail on the absence of the real Gary Ablett identities and Stage 3 can load the
  aliases without re-importing players.
- `CHANGELOG.md` and `IssuesIndex.md` remain unchanged; the retained behaviour change is
  recorded once Stage 3 loads the authoritative aliases and proves the end-to-end NL path.
- The authoritative aliases have **not** yet been loaded into any database; Stage 2 proved
  the loader against rolled-back fixtures only.

### Runtime state at handoff

- The existing ISSUE-110 Next.js server remains running on `http://127.0.0.1:3110`; no
  second server was started.
- The existing PostgreSQL SSH tunnel to `afldb_test` remains on `127.0.0.1:55432`.
- No Git, schema, migration, production-database, or unrelated-worktree action occurred.

### Exact next action (superseded 2026-08-30 by Stage 3A completion below)

Stage 3 — fresh Fable session in `D:\dev\afldb-issue-110` on branch `codex/issue-110`,
using `afldb_test` only and the existing tunnel (55432) and server (3110):

1. load/validate the two authoritative Gary Ablett aliases in `afldb_test`
   (`tools/migration/import_fitzroy_core.py --groups aliases` against the test database,
   or the equivalent reviewed load), confirming the two `player_name_aliases` rows resolve
   through `external_identities`;
2. convert the integration coverage in `tests/integration/nl-semantic-mapping.test.ts` to
   production-shaped data: identical canonical name `Gary Ablett` for Senior and Junior,
   suffix identities only through `player_name_aliases`;
3. prove Jr/Jnr/Junior resolve Junior only, Sr/Snr/Senior resolve Senior only, and bare
   `Gary Ablett` remains ambiguous;
4. prove one generic non-Gary alias through the full DB-backed NL path.

Do not run the 480/1,435/60 corpora, do not run Git, do not start another server, and do
not make unrelated edits.

## 2026-08-30 Stage 3A COMPLETE / PARKED: authoritative aliases loaded into afldb_test

The two authoritative player aliases were successfully loaded into `afldb_test` using the
reviewed aliases-only importer path. Stage 3B (production-shaped integration coverage) was
deliberately **not** started; ISSUE-110 is parked at this boundary.

### Exact target

- `afldb_owner@127.0.0.1:55432/afldb_test`;
- existing SSH tunnel on local port 55432 (process-only port override; the persisted `.env`
  still says 5432, and `.env` `AFLDB_IMPORT_DATABASE_URL` points at `afldb_dev`, so the DSN
  was derived from `AFLDB_TEST_DATABASE_URL` and asserted to end in `/afldb_test` before
  connecting);
- production was not touched;
- no schema change.

### CLI deviation

- `import_fitzroy_core.py --groups aliases` cannot be used standalone in this worktree:
  `main()` requires `--label` and unconditionally runs fitzRoy snapshot validation/scan and
  `db_preflight` before reaching the group loop (`tools/migration/import_fitzroy_core.py`
  `:2844-2881`, `:2964-2965`), and no snapshot exists under
  `data/sources/afltables/fitzroy_core/` here.
- The runbook-permitted equivalent reviewed load therefore called the exact
  `import_player_name_aliases(pg, rep, args)` group function (`:2434`) directly with
  `source_key = afltables`. This performs the same alias-group DB operation (tracked
  `import_batch`, fail-closed identity resolution through `external_identities`, insert-only
  `ON CONFLICT DO NOTHING`, commit) without invoking the unavailable full snapshot path.

### Operator invocations

- First attempt: failed at Python parsing because PowerShell stripped quoting from
  `python -c`. The failure occurred before any DB connection; no database change resulted.
- Corrected invocation: the same Python source passed over stdin to
  `D:\dev\afldb\.venv\Scripts\python.exe`; successful.

### Exact successful evidence

`target: afldb_owner@127.0.0.1:55432/afldb_test`

`player_name_aliases`:

- records tracked: **2**; records inserted: **2**;
- count before: **13275**; count after: **13277**; delta: **2**.

`import_batches`:

- id **22**, status `completed`, `records_read` 2, `records_inserted` 2,
  `target_table = player_name_aliases`.

Authoritative identity evidence (joined `sources → external_identities → players →
player_name_aliases`):

| AFLTables external identity | status / method | player | canonical display / search | existing `source_string` alias | new `alternate` alias / `search_alias` |
|---|---|---|---|---|---|
| `players/G/Gary_Ablett0.html` | `unique` / `afltables_profile_url` | 4701 | `Gary Ablett` / `gary ablett` | `Gary Ablett` / `gary ablett` | `Gary Ablett Snr` / `gary ablett snr` |
| `players/G/Gary_Ablett1.html` | `unique` / `afltables_profile_url` | 4702 | `Gary Ablett` / `gary ablett` | `Gary Ablett` / `gary ablett` | `Gary Ablett Jnr` / `gary ablett jnr` |

Identity was established through source + stable external identity, not player-ID
inference. Both canonical rows keep identical `display_name`/`search_name`; the suffix
distinction now exists only in `player_name_aliases`, which is the production shape Stage 3B
must prove.

### Current implementation status

- Stage 1 COMPLETE: generic alias-aware resolver, `matchedName` evidence,
  `PARSER_VERSION` 28, focused validation 72/72 green.
- Stage 2 COMPLETE: stable-identity curated alias reference layer, generic importer support,
  focused Stage 2 validation 6/6 green including the DB-backed case.
- Stage 3A COMPLETE: real authoritative Gary Ablett Snr/Jnr aliases loaded and verified in
  `afldb_test`.
- **Stage 3 overall is NOT COMPLETE.** Stage 3B remains outstanding:
  - production-shaped DB-backed integration coverage in
    `tests/integration/nl-semantic-mapping.test.ts`;
  - identical canonical `Gary Ablett` names for Senior and Junior;
  - suffix distinction only via `player_name_aliases` / `matchedName`;
  - Jr/Jnr/Junior → Junior only; Sr/Snr/Senior → Senior only;
  - bare `Gary Ablett` remains ambiguous (no silent `search_rank` preference);
  - one realistic non-Gary alias through the full DB-backed NL path.

### Files changed in Stage 3A

- `issues/open/AFLDB-ISSUE-110.md` (this record) only. No source, test, reference-data,
  schema, or tracking-index file was changed; `CHANGELOG.md` and `IssuesIndex.md` remain
  unchanged until Stage 3 completes.

### Parking state

ISSUE-110 is deliberately parked here for the night. Do not begin Stage 3B out of band; do
not run the 480-case, 1,435 realistic, or 60 decline corpora; do not perform cleanup that
would remove evidence needed for Stage 3B (including the temporary task files listed under
the architecture milestone); do not run Git.

### Runtime state at handoff (as recorded in this runbook)

- Next server intended on `http://127.0.0.1:3110` (not re-verified in this session; no
  second server was started).
- PostgreSQL SSH tunnel to `afldb_test` on `127.0.0.1:55432`.

## 2026-08-31 telemetry schema correction and clean 100k rerun preparation

### Discovery during the interrupted 100k run

The interrupted 100,000-question NL run exposed a telemetry/schema contract defect rather
than an NL answer-semantic defect. The current application emitted the supported
`head_to_head` grain, but the database's `nl_search_log_grain_check` constraint still accepted
only the older six-grain vocabulary. PostgreSQL rejected the telemetry `INSERT` with SQLSTATE
`23514` against `nl_search_log_grain_check` when `grain = 'head_to_head'`.

The affected searches still returned HTTP 200 because `logNlSearch` deliberately catches
logging failures so telemetry cannot turn a successful search into a user-visible failure.
Consequently, head-to-head answers continued to work while their telemetry rows were silently
lost. This is a telemetry/schema contract correction, not a parser, head-to-head query, answer,
rendering, or telemetry-outcome semantic change.

### Repository correction and focused validation

- Forward migration `079_nl_search_log_head_to_head_grain.sql` widens
  `nl_search_log_grain_check` to the complete current eight-grain `NlGrain` vocabulary:
  `player_career`, `player_game`, `player_season`, `team_match`, `club_season`, `team_streak`,
  `head_to_head`, and `achievement_summary`.
- `npm run db:migrate:test` passed and applied migration 079 successfully to `afldb_test`.
- The focused database integration regression passed **1/1**. It inserted all eight supported
  grains inside one transaction and then rolled the transaction back.
- Existing `afldb_test` telemetry was preserved; the migration changes only the CHECK
  constraint, and the regression retained no inserted rows.
- No production database, parser semantics, head-to-head query semantics, `NlGrain` typing, UI
  rendering, or telemetry outcome semantics changed. No corpus, Git, or server operation was
  part of this correction.

### Superseded restart step and next planned action

The previous instruction to restart or resume the 100k run is **superseded** by clean-rerun
preparation. The interrupted run must not be resumed or treated as a complete telemetry sample,
because supported `head_to_head` observations were lost before migration 079 corrected the
schema contract.

**Next planned action (recorded only; not executed in this update):** reset
`afldb_test.nl_search_log` to zero, launch the clean 100k corpus against the current server, and
then analyse only the resulting fresh telemetry. Do not start a second server and do not touch
production.

### Exact next action (superseded 2026-08-31 by the clean-rerun preparation above)

Stage 3B — fresh Fable Medium session in `D:\dev\afldb-issue-110` on branch
`codex/issue-110`, using `afldb_test` only through the existing 55432 tunnel and the existing
3110 server: implement and validate the production-shaped DB-backed integration coverage
described above in `tests/integration/nl-semantic-mapping.test.ts`, using the already-loaded
`afldb_test` aliases for the authoritative Gary Ablett contract (players 4701/4702 validated
through their AFLTables external identities, not by ID alone) and a self-cleaning fixture for
the generic non-Gary alias proof. Do not start another server, do not run the corpora, and
do not run Git.

## 2026-08-31 next implementation pass — confirmed from 22k audit

### Audit status and authority

This section is the implementation contract produced by Codex's independent source review of
`AFLDB_NL_AUDIT_22k_2026-08-31.md`. It supersedes the immediately preceding instruction to
reset telemetry and begin a clean 100,000-question rerun. Preserve the preceding text as
chronology; do not execute its reset/rerun step before this implementation pass and review.

The intended 100,000-question baseline did **not** complete. The stress harness terminated
under resource pressure/timeouts after **22,607 logged searches** were available for audit.
Those rows are a useful incomplete diagnostic sample, not a completed 22k or 100k baseline and
not a substitute for a future clean 100k run. Sonnet supplied the audit; Codex then traced the
material findings through current parser, plan, validation, compiler/executor, answer, and
telemetry code. Where Sonnet's proposed cause or fix conflicts with this section, this section
controls the next implementation pass.

Four coding workstreams are confirmed. The `at most` decline, stranded comparator token,
goals-threshold grain error, and `answered_caveat` threshold loss are substantially one root
defect family and must be implemented coherently, not as four unrelated parser patches.

### Confirmed coding defects

#### A. Explicit-zero matcher correction

**Failure.** `extractCareerConditions` checks the explicit-zero `no|never|without ... <stat>`
form before its numeric comparator loop. Its broad span consumes `no more than N goals` and
`no fewer than N goals` as `{ op: 'eq', value: 0 }`. For example:

```text
players with no more than 4 goals in a game
```

must never produce `{ op: 'eq', value: 0 }`; it must reach the typed threshold path described
in B with `op = lte`, `value = 4`, and game grain.

**Existing path.** `src/search/nl/parser.ts::extractCareerConditions` explicit-zero matcher
executes before the numeric condition loop. `src/search/nl/vocab.ts::COMPARE_OP_WORDS` already
contains both `no more than -> lte` and `no fewer than -> gte`.

**Required behaviour and implementation direction.** Narrowly exclude the comparator phrases
`no more than` and `no fewer than` from the explicit-zero branch, then allow the existing
comparator parser to consume them. Do **not** add either phrase to comparator vocabulary and do
not delete the intentional zero-condition behaviour. Genuine `no goals`, `never kicked a
goal`, and `without a goal` conditions must remain equality-to-zero conditions.

**Required regression coverage.** Add focused parser/plan assertions for both comparator
phrases, digits and a representative number word where already supported, plus preservation
controls for `no goals`, `never ... goals`, and `without ... goals`. Include the game-grain
example above so a correct operator with the wrong grain cannot pass.

**Regression risks.** Over-broad negative lookahead or reordering could disable genuine zero
conditions, allow an unsupported negation to pass, or change multi-condition career queries.

#### B. End-to-end typed player-game/player-season metric thresholds

**Failure.** `NlQueryPlan` has no typed metric-threshold field for `player_game` or
`player_season`. Comparator wording can therefore be consumed or left behind without an
executable predicate. A leftover `most` from `at most` reaches `candidatePlayerSpan` and may be
reported as `ambiguous_player`; other comparators can disappear while an unfiltered `list` plan
reaches a compiler where `rankCutoff(list)` returns one leader. Goals thresholds can be claimed
as career conditions before grain election, causing explicit game or year meaning to be
ignored.

The high-volume `answered_caveat` threshold loss is **confirmed from code**. It does not need
answer-payload or caveat evidence before implementation: the serialized validated plan has no
threshold field, `executePlan` receives only that plan, the game/season compilers have no
hidden predicate input, `buildAnswer` cannot reconstruct the original comparator, and
`logNlSearch` serializes the same plan. A coverage note can independently explain the
`answered_caveat` label. The repeated `resultCount = 1` is explained by the current list-to-rank
cutoff, not by a legitimate post-plan threshold transformation.

**Existing path.** The material path is:

```text
parseNlQuestion / extractCareerConditions / extractPlayerMetric
-> grain election
-> NlQueryPlan
-> validatePlan
-> executePlan
-> answerPlayerGame | answerPlayerSeason
-> buildAnswer / describeAnswer
-> logNlSearch
```

`careerConditions` is valid only for `player_career`; `clubSeasonConditions` is valid only for
`club_season`. Neither may be repurposed for this work.

**Required behaviour.** Add one explicit, closed, typed representation for a threshold on the
selected player metric and carry it through every layer that can accept the plan:

- `player_game`, `mode = single`: compare the recorded metric on each individual performance;
- `player_game`, `mode = sum`: compare the player's aggregate metric across the fully scoped
  match set, after aggregation;
- `player_season`: compare the player's season aggregate, after aggregation;
- accept only the existing closed comparator operations (`gt`, `gte`, `lt`, `lte`, `eq`) and a
  validated finite/non-negative value appropriate to these statistics;
- consume the entire recognized comparator phrase atomically so words such as `most` do not
  reach player-name resolution;
- validate that the condition is present only on supported player game/season plans with a
  compatible metric and mode;
- make each compiler consume the field at the correct SQL layer; no validated field may be
  ignored;
- if parsing can recognize a threshold but any selected grain/compiler cannot represent it,
  fail closed with an honest decline instead of emitting an unfiltered plan;
- preserve `NULL` as not recorded; a `NULL` statistic must not qualify as zero.

**Grain precedence contract.** Explicit scope must control the grain before the goals-to-career
fallback:

```text
players with more than 2 goals in 1989
```

must produce `grain = player_season`, `seasonMin = 1989`, and `seasonMax = 1989`.

```text
players with fewer than 3 goals in a game
```

must produce `grain = player_game`, `mode = single`.

```text
players with at most 25 disposals against North Melbourne
```

must not decline because `most` was stranded. Under the existing scoped-total rule it is a
`player_game`, `mode = sum` threshold over the opponent-scoped aggregate.

An explicit `in a game` cue wins over a career default; an exact named year with no explicit
career/total cue elects the existing player-season leaderboard/aggregate grain. Conversely:

```text
unscoped players with more than 500 career goals
```

must remain `grain = player_career` and use the existing career-condition path. Do not perform
a broad grain-election rewrite.

**Smallest sensible implementation direction.** Extend the plan with a dedicated typed metric
condition (name to follow existing conventions), parse it only where the selected metric and
grain can honour it, add defence-in-depth validation, and compile it as a raw-row predicate or
post-aggregation predicate according to the three cases above. The list path must return the
qualifying result shape rather than reinterpret `list` as a rank-one superlative. If the
single-performance list's row identity remains undecided (qualifying performances versus
distinct players), retain a fail-closed boundary for that unresolved shape rather than ship a
silently different answer.

Do not solve this by:

- adding `at most`, `no more than`, or `no fewer than` to vocabulary; all already exist;
- adding `most`, `least`, or other quantifiers to a global player-name suppression rule;
- weakening ambiguity/player matching;
- hiding the comparator in an arbitrary string;
- placing player thresholds in `clubSeasonConditions`;
- treating four symptoms as four disconnected fixes.

**Required regression coverage.** Extend the closest existing suites rather than creating a
new test file by default:

- parser/plan: `tests/nl-regression-corpus.test.ts` and/or
  `tests/nl-semantic-mapping.test.ts` for every comparator, exact grain/scope/mode, the
  examples above, and career-preservation controls;
- plan validation: accepted supported combinations plus rejection of a condition on the wrong
  grain, missing/incompatible metric, missing game mode, invalid comparator/value, and any plan
  shape a compiler cannot consume;
- integration/answer: `tests/integration/nl-answers-game-season.test.ts` for individual-game,
  scoped-sum, and season aggregate thresholds against independently determined `_test` truth.

Integration assertions must prove the predicate is **actually applied**, not merely present in
the plan. At least one case must have multiple qualifying rows/results, and at least one must
prove a non-qualifying leader is excluded. The regression must fail under the current behaviour
that silently drops the threshold and returns one ranked leader. Where the existing product
contract defines result-row identity, assert qualifying identities/values and result count;
where it does not, resolve or fail closed as described under Evidence-gated below.

Preservation coverage must include the already-working career comparator forms and grouped
team-result forms for `at most`, `at least`, `no more than`, `no fewer than`, `more than`,
`less than`, `fewer than`, and `exactly`.

**Regression risks.** Preserve `NULL` semantics, result limits, deterministic ordering, tie
policy, single versus sum meaning, season grouping, club/opponent scope, and genuine career
goals. Low thresholds can produce large result sets; use existing caps and verify the filter is
applied before avoidable ranking/display work without changing the semantic set.

#### C. Two-club `wins against` / `losses against` to typed H2H

**Failure.** `extractHeadToHeadCue` supports `record against`, `who has won more`, draw forms,
and `head to head`, but not bare two-club `wins against` or `losses against`. For example,
`Eagles wins against Hawks` can fall into an invalid ranked-stat plan instead of the existing
head-to-head family.

**Existing path.** `src/search/nl/semantic-intents.ts::extractHeadToHeadCue` supplies a typed
`NlHeadToHeadKind`; `parseNlQuestion` requires two distinct resolved organizations before
building `scope.matchup`; `answerHeadToHead` already returns both clubs' wins, draws, and total
meetings for `record` semantics.

**Required behaviour and implementation direction.** When exactly two distinct clubs are
resolved and the wording is the relationship question `<Club> wins against <Club>` or
`<Club> losses against <Club>`, route to `grain = head_to_head`, `headToHead.kind = record`, and
typed matchup scope. Guard the cue so it does not steal:

- grouped thresholds such as `teams with more than 3 wins against Lions`;
- team-match extrema such as `biggest win against Carlton` or `biggest loss against Carlton`;
- one-club questions lacking a second resolved participant;
- existing `record against`, `who has won more`, draw, and explicit H2H forms.

**Required regression coverage.** Add parser/plan cases beside the existing typed H2H tests,
negative collision cases for all three guarded families, and a focused integration/answer case
showing the existing record payload/description is used.

**Regression risks.** A broad regex can change grouped HAVING questions, margin records, club
role assignment, or honest one-club declines. The two-resolved-club structural guard is part of
the contract, not an optional test convenience.

#### D. `Bulldogs` organization alias

**Failure.** The normal nickname seed contains `dogs` and `doggies`, but not bare `bulldogs`.
The reference identities are Footscray and Western Bulldogs; neither supplies bare `Bulldogs`
as its maintained short name in repository reference data.

**Existing path.** `src/search/nl/vocab.ts::CLUB_NICKNAMES` is merged by
`src/db/queries/nl/resolve.ts::buildClubDirectory` with club identities, short names,
abbreviations, and maintained `club_aliases`, all keyed to `club_organizations`. Footscray and
Western Bulldogs therefore already share the correct organization lineage.

**Required behaviour and implementation direction.** Add `bulldogs -> western bulldogs`
through `CLUB_NICKNAMES`. Do not add a parser special case. Bare `Bulldogs`, `Dogs`, Footscray,
and Western Bulldogs must resolve through the same ordinary organization/alias path.

**Required regression coverage.** Assert equivalent organization identity for all four names,
an ordinary answered query using `Bulldogs`, and a same-organization H2H control so aliases do
not manufacture two distinct clubs.

**Regression risks.** Low but non-zero: alias collision, longest-match behaviour, and same-club
H2H detection must remain correct.

### Minimum test and validation contract

Fable must add the smallest focused coverage that proves the implementation. Command execution
remains user-operated unless the user explicitly authorizes Fable to run it in that session.
The required evidence is separated as follows.

#### Parser/unit tests

- Exact examples from A-D, including operator/value, grain, mode, and scope assertions.
- Neighbouring comparator variants and preservation of existing career/grouped comparator
  behaviour.
- Genuine zero-negation controls.
- H2H positive and collision-negative cases.
- Bulldogs organization-resolution equivalence.
- No global quantifier/player-fallback change.

Use the closest existing homes, principally `tests/nl-regression-corpus.test.ts` and
`tests/nl-semantic-mapping.test.ts`.

#### Plan validation tests

- Accept every newly supported game/season metric-condition shape.
- Reject wrong-grain, incompatible-metric, missing-mode, malformed comparator/value, and
  otherwise unconsumable shapes.
- Prove no plan field can validate unless its selected compiler consumes it.
- Increment `PARSER_VERSION` and update its version-history comment because parser outcomes and
  plan shapes change.

Use the closest existing plan/semantic suite; do not create a new file when an existing suite
is a coherent home.

#### Integration/answer tests

- Prove individual-performance, scoped-sum, and season-aggregate thresholds against `_test`
  data and independently determined qualifying values.
- Assert qualifying identities/values and result count where the existing product contract
  defines them.
- Include a case that would currently return one rank leader with the predicate silently
  dropped, and prove the fixed answer instead returns only the qualifying set.
- Verify two-club wins/losses wording uses the typed H2H record answer.
- Verify `Bulldogs` reaches the normal organization-backed answer path.

Prefer `tests/integration/nl-answers-game-season.test.ts`, the existing H2H/team answer suite,
and `tests/integration/nl-semantic-mapping.test.ts` as appropriate. Guard
`AFLDB_TEST_DATABASE_URL` so the database name ends in `_test`. After focused suites pass,
request the smallest broader NL parser/plan/description and typecheck validation justified by
the touched surface. Do not run the 100k corpus during this implementation/review pass.

### Telemetry-only

The current player resolver knows the stable player ID and the `matchedName` that justified an
alias or generational suffix, but `NlEntityResolution` logs only mention, canonical display
name, and certainty. Add optional telemetry fields for:

- resolved stable player ID (or IDs for a deliberately multi-candidate resolution);
- matched alias/name form, preserving `Jr`, `Jnr`, `Junior`, `Sr`, `Snr`, or `Senior` evidence.

`logNlSearch` already serializes the supplied JSON. Keep this an observability-only contract:
do not alter candidate ranking, accepted identity, ambiguity thresholds, plan semantics, or
answer semantics merely to enrich the log. Implement it as a separate substage from the four
semantic coding workstreams so review can distinguish telemetry from search changes.

### Evidence-gated

- **Gary Ablett Snr/Jnr routing correctness:** alias-aware resolution is implemented and
  existing focused evidence is encouraging, but canonical `resolvedTo: "Gary Ablett"`
  telemetry cannot prove which stable identity each audited row selected. After telemetry
  enrichment, inspect representative suffix variants by resolved ID/matched alias. Do not
  classify or patch a semantic routing defect without that evidence.
- **`empty_result` versus `coverage_unavailable`:** current outcome labels primarily identify
  the pipeline stage—validation rejection versus executed zero rows. Known no-overlap coverage
  is validated before execution, and existing integration coverage asserts that distinction.
  Obtain exact allegedly mislabelled rows, plans, validation reasons, and answer/caveat evidence
  before changing taxonomy. This is not a confirmed NL semantic defect.
- **Threshold result-row product semantics:** `player_game/single` naturally identifies
  performances, while wording such as `players with ... in a game` may suggest distinct
  players. Use the existing answer/product contract if it is explicit. If it is not, record the
  decision before enabling that result shape; fail closed in the meantime. This uncertainty
  does not reopen whether the current predicate loss is a defect—it is confirmed.

### Explicitly deferred

- Broad parser or grain-election rewrites.
- Global changes that suppress `most`, `least`, or other quantifiers in player fallback.
- Weakening player ambiguity/confidence handling.
- Unsupported metric expansion such as metres gained or pressure acts.
- Production deployment, production data, production telemetry, or production configuration.
- Telemetry reset or a 100k rerun before this implementation and its focused/broader review.
- Changes to the separate result-reviewer project.
- Unrelated cleanup, refactoring, dependency work, documentation, or issue investigation.

### Fable handoff

This is the **fresh Fable session** handoff and the confirmed coding contract from Codex's
independent review of the Sonnet audit.

In a fresh Fable session rooted at `D:\dev\afldb-issue-110`, implement only confirmed items
A-D, treating B as one end-to-end plan/parser/validation/compiler defect family rather than
separate symptom patches. Keep telemetry enrichment separate and do not convert either
evidence-gated item into semantic code without its required evidence. Make the smallest
coherent edits, add the regression coverage specified above, bump `PARSER_VERSION`, and update
ISSUE-110/`CHANGELOG.md` only for changes actually retained.

Do **not** rerun the 100k corpus, reset telemetry, start or modify production, change the
result-reviewer project, run Git, or broaden scope. After focused parser/plan tests,
database-backed answer tests, the justified neighbouring NL suites, and typecheck have returned
their results, stop and hand the changed files, exact validation evidence, failures/blockers,
and remaining evidence-gated items back for review. Do not begin a corpus rerun or another
investigation automatically.

## 2026-08-31 Fable implementation pass — confirmed workstreams A-D implemented

Fable implemented the four confirmed coding workstreams plus the separate telemetry-only
substage, exactly against the contract above, as parser version **28 → 29**.

### A — explicit-zero matcher correction

`extractCareerConditions`' zero-negation trigger now excludes the four `no <comparative> than`
comparator openings via a negative lookahead
(`no(?!\s+(?:more|fewer|less|greater)\s+than\b)`), so `no more than N` / `no fewer than N`
reach the existing comparator loop instead of becoming `{ op:'eq', value:0 }`. Genuine
`no goals`, `never kicked a goal`, and `without a goal` zero conditions are untouched, as is
the rest of the zero-negation mechanism.

**Deviation noted:** the handoff prompt asserted `no less than` / `no greater than` already
existed in `COMPARE_OP_WORDS`; they did not (the runbook's own narrower claim was accurate).
Both were added to `COMPARE_OP_WORDS` (`gte` / `lte`), ordered before bare `less than` so the
loop's first-entry-wins order cannot invert the bound. This is a missing-phrase fix, not a
duplicate.

### B — end-to-end typed player game/season metric thresholds

One typed representation, `NlQueryPlan.metricCondition?: { op: NlCompareOp; value: number }`,
now carries a threshold on the plan's own selected metric through parser → plan → validation →
executor → compiler → answer → log:

- **Parser.** `extractPlayerMetricThreshold` consumes `[comparator][number][METRIC_WORDS
  stat]` atomically (clause-clipped lookback identical to the career-condition discipline, with
  `N+`/number-word support), so no fragment — above all the `most` of `at most` — can reach
  player-name resolution. Goals/games thresholds still claimed first by
  `extractCareerConditions` are converted at plan assembly when explicit scope elects the
  grain: an `in a game` cue produces `player_game/single`, a named season (with at most a
  `clubFor` scope, no debut window, no career cue, no player) produces `player_season` with the
  season range kept. A career-column stat with a career cue converts to an ordinary
  `careerConditions` entry; a stat with no representable home (e.g. `clangers`, which has no
  career column) keeps the condition on the plan so validation refuses it honestly. A max/list
  aggregation alongside an attached threshold coerces to `list`.
- **Validation.** `metricCondition` is accepted only on `player_game`/`player_season`, with the
  closed comparator set, a finite non-negative value, and `agg = list`; it is rejected on every
  other grain (including inside head-to-head plans). The complementary gate: a
  player game/season `list` with **no** threshold now fails closed ("Listing player results
  needs a qualifying threshold.") instead of being silently collapsed by `rankCutoff(list) = 1`
  into a rank-one leader — the confirmed `answered_caveat`/`resultCount=1` mechanism.
- **Compilers.** `player-game.ts` mode `single` applies the predicate per performance inside
  the ranked CTE (beside the existing `IS NOT NULL`, so NULL is never zero); mode `sum` applies
  it as `HAVING sum(metric) <op> value` after aggregation; `player-season.ts` applies it to the
  season aggregate (stored column, or the live-only summed total). The comparator reaches SQL
  only through the closed `COMPARE_SQL` allowlist; the value is always a bound parameter. With
  a threshold present the rank filter opens to the full qualifying set (display capped at the
  existing 100-row list limit, `total` reporting the true count).
- **Answer/describe.** Threshold answers describe as qualifying counts ("N qualifying
  performances" / "N players qualify" / "N qualifying player-seasons") with the bound restated,
  and `describePlan` records `Condition: <metric> <op-word> <value>.`

Grain-precedence contract verified by test: `players with more than 2 goals in 1989` →
`player_season`, seasonMin/seasonMax 1989, `gt 2`; `players with fewer than 3 goals in a game`
→ `player_game/single`, `lt 3`; `players with at most 25 disposals against North Melbourne` →
`player_game/sum`, `lte 25`, opponent scope, no stranded `most`; `players with more than 500
career goals` → unchanged `player_career` career-condition path; the club-scoped
`at least 200 games for Collingwood` contract is untouched. The debut-window composition
(`players who debuted in the 1990s with 300 games`) was caught stealing the season range in an
intermediate build and is guarded (`!debutPredicate`) with the existing regression staying
green.

**Result-row identity decision.** `player_game/single` threshold lists return qualifying
PERFORMANCES (the existing `NlPlayerGameRow` payload/table contract, the same row identity the
tie machinery already uses); sum/season lists return one row per player/player-season. No new
answer payload shape was invented.

### C — two-club wins/losses-against → typed head_to_head

`extractHeadToHeadCue` gains plural-only `wins against|versus|vs|v` and `losses against...`
families mapping to the existing `record` kind, guarded by a `RESULT_COUNT_GOVERNS` lookback
(digit, most/fewest/many/least/than/exactly/more/less/fewer/no/with/biggest/largest/highest/
lowest/top) so grouped thresholds, rankings, and counts are not stolen; singular `win/loss`
extrema never match; one-club wording keeps its pre-existing honest refusal through the
existing two-resolved-club structural guard. Existing record/compare-wins/draw/last-draw
families are unchanged and re-verified.

### D — Bulldogs organization alias

`CLUB_NICKNAMES` gains `bulldogs -> western bulldogs`, merged by the ordinary
`buildClubDirectory` path onto the same organization lineage as Dogs/Footscray/Western
Bulldogs. No parser special case. Same-organization H2H control: `Bulldogs record against
Footscray` still refuses with "A matchup needs two different clubs."

### Telemetry-only substage

`NlEntityResolution` gains optional `playerId`, `playerIds`, and `matchedName`. The parser
populates them for accepted single-player resolutions (stable id plus the exact matched
alias/suffix form) and for multi-candidate `playerIdIn` resolutions (the id set). Nothing
downstream of the log reads them; ranking, ambiguity thresholds, plan and answer semantics are
untouched. This provides the evidence the Gary Ablett Snr/Jnr evidence-gated item requires;
that item remains evidence-gated and was NOT converted into semantic code.

### Files changed in this pass

Production: `src/search/nl/vocab.ts`, `src/search/nl/semantic-intents.ts`,
`src/search/nl/parser.ts`, `src/search/nl/plan.ts`, `src/search/nl/describe.ts`,
`src/db/queries/nl/player-game.ts`, `src/db/queries/nl/player-season.ts`.

Tests: `tests/nl-semantic-mapping.test.ts` (A/B/C/D parser+plan blocks, telemetry assertion),
`tests/nl-plan.test.ts` (metric-condition validation block), `tests/nl-regression-corpus.test.ts`
(playerIds telemetry assertion only), `tests/integration/nl-answers-game-season.test.ts`
(five threshold-application cases against hand-written SQL, including a leader-exclusion case
and a multi-qualifier case that fail under the old rank-one collapse),
`tests/integration/nl-semantic-mapping.test.ts` (wins/losses-against parse→record-answer
against independent SQL truth; Bulldogs directory equivalence, answered organization query,
same-organization refusal, draw matchup).

Tracking: this runbook, `CHANGELOG.md` (Unreleased), `IssuesIndex.md` (ISSUE-110 row).

Also removed: four zero-byte stray files in the worktree root (`!consumedSet.has(t)`, `0`,
`consumedSet.has(t)`, `rest)`) — empty shell-redirect debris from an earlier session, named
after parser code fragments, not part of any change.

### Validation executed this pass (Fable-run, authorized by the handoff prompt)

- Focused and broader DB-free matrix in one final run — `nl-semantic-mapping` (incl. the new
  A-D blocks), `nl-plan` (incl. the new metric-condition validation block), `nl-parser`,
  `nl-describe`, `nl-regression-corpus`, `nl-audit-acceptance`, `query-intent`,
  `nl-head-to-head-describe`, `nl-ui-corpus`, `unit/NlAnswerSection`,
  `nl-answer-feedback-boundary`, `nl-stress-corpus`, `nl-stress-v2`:
  **13 suites, 677/677 passed**.
- Typecheck: `npm run typecheck` (`next typegen` + `tsc --noEmit`) **passed** (one intermediate
  fragment-typing error was fixed before completion).
- Two intermediate red states found and fixed during the pass: the debut-window guard above,
  and the enriched telemetry fields tightening two exact-object assertions (updated to expect
  the richer object — coverage extended, not weakened).

### Blocker: DB-backed integration is written but UNRUN

At execution time the `afldb_test` path was unavailable: local port **55432 (SSH tunnel)
closed**, 5432 closed, and the previously recorded 3110 server also down. Opening the tunnel is
an SSH/user-operated action, so per the command boundary the database-backed proof is handed to
the operator. With the tunnel restored (process-local port override to 55432 as in prior
stages), run:

```text
npx vitest run tests/integration/nl-answers-game-season.test.ts tests/integration/nl-semantic-mapping.test.ts
```

The new threshold cases are designed to fail under the pre-fix behaviour (rank-one collapse /
dropped predicate), so a green run is the required end-to-end proof that thresholds are
actually applied.

### Remaining uncertainty and regression risk

- The five DB-backed threshold cases and four Bulldogs/H2H integration cases are unexecuted;
  everything else is proven. No other known uncertainty was introduced.
- Behaviour change to note in review: questions that previously validated as a player
  game/season `list` with a silently dropped number (e.g. `players with 30 disposals in a
  game`) now either carry the threshold (bare number reads as the same `gte` floor the career
  convention uses) or, with no number at all, fail validation closed instead of returning the
  unfiltered leader. This is the intended fail-closed contract, not an accidental regression.
- Evidence-gated items unchanged: Gary Snr/Jnr routing (now observable via the new telemetry),
  `empty_result` vs `coverage_unavailable` taxonomy, and the `player_game` distinct-players
  result shape beyond the existing performance-row contract.

Fable implementation pass complete. Confirmed ISSUE-110 fixes implemented and validated
(DB-free + typecheck; DB-backed integration pending the tunnel). Ready for review before any
new large-scale NL corpus run. The 22,607-search run remains incomplete and recorded as such.

## 2026-08-31 Fable revision pass — Codex REVISE findings addressed (parser v30)

Codex's final review returned REVISE. This pass closed the review's findings as one coherent
fail-closed contract, as parser version **29 → 30**. No large corpus was run, no telemetry was
reset, and no production/Git action occurred.

### HIGH — career-vocabulary thresholds silently discarding explicit match scope

**Defect confirmed exactly as reported.** `players with more than 2 goals against Carlton`
parsed to `player_career` with `careerConditions = goals > 2` and `scope.clubAgainst`, and the
career compiler consumes only `scope.clubFor` — the opponent silently vanished and the answer
was whole-career goals.

**Fix (narrowest routing, two layers):**

1. **Parser routing** (`src/search/nl/parser.ts`, the existing grain-conversion block): a sole
   convertible career condition beside explicit venue/opponent/matchup scope (and no
   single-game cue, which the existing single-performance branch already owns, including
   match-type cues) now converts to the scoped `player_game/sum` typed `metricCondition` — the
   same scoped-total rule the ranked path already follows. Season scope rides along in match
   scope. The club-scoped `games for Collingwood` career contract, the pure season conversion,
   the career-cue path, and the clubFor-only refusals are all untouched.
2. **Validation backstop** (`src/search/nl/plan.ts`): any `player_career` plan still carrying
   venue/opponent/match-type/round scope is refused (`A career question cannot be scoped to a
   venue, opponent, match type, or round.`), and a season range beside career conditions (with
   no season-owning career predicate) is refused. No producer can validate a career plan whose
   scope the career compiler does not consume.

Unrepresentable shapes therefore fail closed: `more than 100 games against Carlton` (games has
no per-match grain) and `more than 500 career goals since 2000` both refuse honestly.

### Mixed game/career condition

`players with no more than 4 goals in a game and no premierships` no longer validates a plan
that silently drops "in a game". After the conversion attempt, a single-game cue beside
remaining career conditions hoists the game-representable condition (goals) onto the plan as a
`metricCondition`, which no career grain can validate — the question refuses honestly. The
existing test that blessed the silent discard was replaced with a fail-closed assertion.
Genuine zero conditions, the boundary/achievement match-type ownership, and the
`N disposal games` idiom are explicitly excluded from the hoist.

### H2H number-word governance

`RESULT_COUNT_GOVERNS` (`src/search/nl/semantic-intents.ts`) now includes the parser's existing
`NUMBER_WORDS` vocabulary (no second number list), so `exactly three wins against Carlton` and
`at least three wins against Carlton` are governed away from the head-to-head record route.
`extractHavingClause` additionally reads the same number words (digits still win), so those
questions produce the grouped `team_match` `havingClause` plan. Record, compare-wins, draw,
last-draw, biggest win/loss, and one-club refusal behaviours re-verified unchanged.

### Deterministic capped ordering

- `player-game.ts` single mode: `ORDER BY value, matchDate, matchId, playerId`.
- `player-game.ts` sum mode: `ORDER BY value, sort_name, players.id`.
- `player-season.ts` (both stored-column and live-only queries): `ORDER BY value, season,
  displayName, playerId`.

Intended ordering is preserved ahead of the new unique final tie-breakers; the 100-row cap is
unchanged.

### Tests added/changed

- `tests/nl-semantic-mapping.test.ts`: new revision block — opponent-scoped goals threshold
  (the exact HIGH wording), venue-scoped threshold (MCG fixture venue added to the test ctx),
  grand-final match-type threshold, season+opponent combined scope, games-vs-opponent
  fail-closed, career-cue+season fail-closed; mixed-condition test now proves refusal; C block
  gains four number-word governance cases.
- `tests/nl-plan.test.ts`: career-grain scope backstop block (opponent/venue/match-type/round
  rejections, season-beside-conditions rejection, unscoped and clubFor acceptance controls).
- `tests/nl-describe.test.ts`: direct threshold description coverage (single-game, game-sum,
  season) asserting exact headline and interpretation strings.
- `tests/integration/nl-answers-game-season.test.ts`: strict `lt` boundary case proving `<`
  excludes the boundary value that `<=` includes, against hand-written SQL; a 100-row-cap
  determinism regression (common tied value, two executions, identical row identities/order,
  total > 100); and an end-to-end block calling `answerNlQuestion` (run tag
  `issue-110-revision-e2e-test`) for two exact natural-language questions — `players with at
  least N goals in a game` and the review's exact `players with more than 2 goals against
  Carlton` — verifying payload rows, total, headline, and interpretation against hand-written
  SQL through parser → validatePlan → execute → answer → description.

### Validation executed this pass (Fable-run, authorized by the handoff prompt)

- Focused suites (`nl-semantic-mapping`, `nl-plan`, `nl-describe`): green.
- Full DB-free NL matrix (13 suites: the two above plus `nl-parser`, `nl-regression-corpus`,
  `nl-audit-acceptance`, `query-intent`, `nl-head-to-head-describe`, `nl-ui-corpus`,
  `unit/NlAnswerSection`, `nl-answer-feedback-boundary`, `nl-stress-corpus`, `nl-stress-v2`):
  **694/694 passed** (677 before this pass; +17 new assertions, none weakened or removed —
  the one replaced test now asserts strictly more).
- Typecheck (`next typegen` + `tsc --noEmit`): **passed**.
- One intermediate red state found and fixed: the fail-closed hoist initially took the first
  condition in wording order (premierships) rather than the game-representable one; it now
  prefers a per-match statistic and the mixed-condition test pins the exact remaining shape.

### Blocker: DB-backed integration UNRUN (tunnel down again)

At execution time local ports **55432** (SSH tunnel) and 5432 were both closed. Opening the
tunnel is an SSH/user-operated action. With the tunnel restored (process-local port override to
55432 as in prior stages), run:

```text
npx vitest run tests/integration/nl-answers-game-season.test.ts tests/integration/nl-semantic-mapping.test.ts
```

This is the required green gate before the revision can be declared complete: it covers the
five existing threshold-application cases, the new strict `lt` boundary, the determinism
regression, both end-to-end natural-language proofs, the wins/losses-against record answers,
and the Bulldogs organization path.

### Remaining evidence-gated work (unchanged)

- Gary Ablett Snr/Jnr routing correctness via the new telemetry fields.
- `empty_result` vs `coverage_unavailable` taxonomy.
- The `player_game` distinct-players result shape beyond the existing performance-row contract.

Behaviour changes to note in review: questions that previously validated a career plan while
silently dropping an opponent/venue/match-type/season scope now either answer the scoped
question (convertible threshold shapes) or decline with a validation refusal (unrepresentable
shapes). Award/boundary/named-player career questions carrying such scope, which previously
answered while ignoring it, now refuse — intended fail-closed behaviour, not a regression.

## 2026-08-31 Next 16 logging-boundary fix — after() outside a request scope

With the 55432 tunnel restored, the operator ran the DB gate:
`npx vitest run tests/integration/nl-answers-game-season.test.ts
tests/integration/nl-semantic-mapping.test.ts` → **44 passed, 2 failed**.
`nl-semantic-mapping` was 22/22; every threshold/scope/ordering/H2H/Bulldogs/alias regression
passed. The only two failures were the new end-to-end `answerNlQuestion` proofs, both with the
identical non-semantic error.

### Root cause

`logNlSearch` (`src/db/queries/nl/log.ts`) scheduled its telemetry INSERT unconditionally
through Next 16's request-scoped `after()`. Outside an App Router request scope — a Vitest
integration test or any other direct server-side caller of `answerNlQuestion` — `after()`
throws synchronously (`` `after` was called outside a request scope ``). The throw escaped
`logNlSearch` into `answerNlQuestion` (whose catch clause logs again, re-throwing), failing
both tests before any answer assertion. Parser, plan, SQL, scope routing, and description were
not implicated: the database was reachable and the other 44 integration tests were green.

### Exact fix

- **`src/db/queries/nl/log.ts`** — the INSERT body is extracted into a local `write` closure
  (its internal try/catch unchanged). `logNlSearch` now does `try { after(write) } catch
  { void write(); }`: inside a request scope the deferred non-blocking `after()` behaviour is
  byte-identical; outside one the same write runs detached, so legitimate non-request callers
  still record telemetry and a logging failure still cannot reach the answer. Telemetry was
  not disabled anywhere.
- **`tests/integration/nl-answers-game-season.test.ts`** — redirects
  `AFLDB_AUTH_DATABASE_URL` to `AFLDB_TEST_DATABASE_URL` at module top (the established
  `email-intake.test.ts` pattern) so the now-executing detached writes land in `afldb_test`;
  `afterAll` flushes the auth pool via `globalThis.__afldbAuthSql?.end({ timeout: 5 })`
  (NOT `authSql.end()` — `datasets.test.ts` documents the lazy-Proxy `this`-binding hazard)
  and deletes this suite's `run_tag = 'issue-110-revision-e2e-test'` rows so repeated runs do
  not accumulate telemetry. No end-to-end assertion was weakened; both tests are unchanged.
- **`tests/nl-search-log.test.ts`** (new, DB-free) — focused scheduling-boundary regression:
  inside a request scope the write is deferred through `after()` (not run inline) and executes
  when Next runs the callback; outside a request scope `logNlSearch` does not throw and the
  row is still written; a genuine write failure on the fallback path stays isolated
  (console.error only, nothing reaches the caller). Mocks `next/server` and `@/db/authClient`
  only; no production behaviour is mocked in the two integration e2e tests.

### Validation (Fable-run, authorized by the task prompt)

- Focused logging suite `tests/nl-search-log.test.ts`: **3/3 passed**.
- Full DB-free NL matrix (the revision's 13 suites plus the new logging suite —
  `nl-semantic-mapping`, `nl-plan`, `nl-parser`, `nl-describe`, `nl-regression-corpus`,
  `nl-audit-acceptance`, `query-intent`, `nl-head-to-head-describe`, `nl-ui-corpus`,
  `unit/NlAnswerSection`, `nl-answer-feedback-boundary`, `nl-stress-corpus`, `nl-stress-v2`,
  `nl-search-log`): **14 suites, 697/697 passed** (694 baseline + 3 new; nothing weakened,
  skipped, or removed).
- Typecheck (`next typegen` + `tsc --noEmit`): **passed** (run twice, after each edit wave).

### DB gate — PASSED 2026-08-31 (operator-run)

With the fix in place, the operator reran the required gate:

```text
npx vitest run tests/integration/nl-answers-game-season.test.ts tests/integration/nl-semantic-mapping.test.ts
```

Result: **2 files passed, 46/46 tests passed, 20.30 s** — the previously failing end-to-end
proofs now green alongside every semantic regression. Notable passing proofs: the exact
question through parser → validation → execution → description; the review's exact
opponent-scoped wording without discarding the opponent; the strict less-than boundary;
deterministic capped threshold ordering; scoped aggregate thresholds; live_only season
aggregation; club-scoped whole-season semantics; and Gary Ablett Jr/Jnr/Junior resolution.

Complete revision evidence now standing: DB-backed integration **46/46**, DB-free NL matrix
**14 suites, 697/697**, typecheck **passed**.

### Final-review readiness

All revision gates are green. ISSUE-110 remains **Open** — not finally resolved.

**Exact next action: FINAL CODE REVIEW — Codex.** The final review must occur before any
480-case UI corpus run or 1,435/1,440-question large corpus run (and before any telemetry
reset or 100k rerun). The 22,607-search run remains incomplete and recorded as such.

## 2026-08-31 Fable bounded revision — final Codex REVISE findings (parser v31)

Codex's final review returned **REVISE — NOT READY FOR LARGE-SCALE VALIDATION** with exactly
three bounded findings against the 46/46-green baseline. This pass addressed all three; nothing
else was changed, no corpus was started, no telemetry was reset, and no Git/production/database
action occurred.

### HIGH — player_season can silently discard match-level scope

**Root cause confirmed exactly as reported.** The explicit `in a season` cue elects
`player_season` in the parser's grain election (`src/search/nl/parser.ts`, the `inOneSeason`
branch) BEFORE opponent/venue/match-type/round scope is accounted for, and
`answerPlayerSeason` (`src/db/queries/nl/player-season.ts`) consumes only
`player`/`playerIdIn`/season range/`clubFor`/`metricCondition`. So
`players with more than 20 disposals in a season against Carlton` produced a
`player_season` threshold plan retaining `scope.clubAgainst`, validation accepted it, and the
executor computed whole-season disposals against every opponent — a plausible wrong answer.
Venue, match-type/finals, and round scope shared the class.

**Fix — FAIL CLOSED (validation backstop, no new aggregation feature).**
`validatePlan` (`src/search/nl/plan.ts`) now refuses any `player_season` plan carrying
`scope.venue`, `scope.clubAgainst`, `scope.matchType`, or `scope.roundNumber`:
`A season total cannot be scoped to a venue, opponent, match type, or round.` This mirrors the
v30 career-grain gate, so no producer (current parser or a future one) can validate a season
plan whose executor would silently ignore its scope. Parser version **30 → 31** with a
version-history entry, because previously-answering questions now refuse.

**Field-by-field executor audit.** Every other typed plan field is either consumed by
`answerPlayerSeason` (`player`, `playerIdIn`, `seasonMin`/`seasonMax`, `clubFor`,
`metricCondition`, agg/tie/limit) or already grain-gated by existing validation before this
change: `matchup` (match-level grains only), `mode` (player_game only), `debutGame`
(player_game/single only), `boundary` (career only), `careerConditions`/`careerPredicates`
(career only), `clubSeasonConditions` (club_season only), `havingClause`/`matchFilter`/
`resultFilter`/`scoreCheckpoint` (team_match only), non-`FULL_MATCH` `periodSplit`
(team_match only; `FULL_MATCH` is the explicit no-split value), `streakDefinition`
(team_streak only), `headToHead`/`achievementSummary` (their own grains only). The invariant —
a validated player_season plan contains no material scope the executor silently ignores — now
holds by construction.

**Regression coverage.**

- `tests/nl-semantic-mapping.test.ts` — new block: all four review wordings
  (`... in a season against Carlton`, `... at the MCG`, `... in grand finals`,
  `... in round 5`) parse to `player_season` with the scope PROVEN present on the plan and are
  refused with the exact backstop error; positive controls keep
  `players with more than 20 disposals in a season`, `players with more than 2 goals in 1989`,
  and the clubFor season leaderboard (`most goals for Richmond in 2017`) valid.
- `tests/nl-plan.test.ts` — direct validator block (defence-in-depth, independent of parser
  routing): opponent/venue/match-type/round each refused on a season threshold list AND on a
  ranked season leaderboard; unscoped, season-range, and clubFor season shapes still accepted.

Legitimate player_season support (season thresholds, `more than N goals in <year>`, clubFor
leaderboards, club-scoped whole-season semantics) is unchanged and re-verified.

**Residual observed while testing, NOT patched (out of this bounded scope):**
`players with more than 50 goals in a season` routes `goals` through
`extractCareerConditions` (no `metricCondition`), the unconditional cue-consumption loop eats
`in a season`, and grain election lands on `player_career` with `careerConditions goals > 50`
— an unscoped career-condition list that validates, so the season cue is silently discarded
and the career-total question is answered. The season meaning is lost at parse time; no plan
field survives for a validation backstop, so the fix is parser routing work. Recorded here as
a candidate for the next review rather than patched, per the no-parser-redesign boundary.
(`disposals` and other non-career-claimed stats are unaffected — they carry `metricCondition`
and stay `player_season`.)

### LOW — logNlSearch caught every synchronous after() error

The compatibility fix's bare `try { after(write) } catch { void write(); }` treated ANY
synchronous `after()` exception as legitimate non-request execution, which could hide an
unrelated Next scheduling/invariant failure inside a real request.

**Fix (`src/db/queries/nl/log.ts`).** The installed Next 16 implementation
(`node_modules/next/dist/server/after/after.js`) was inspected: the no-request-scope failure
is an `Error` with message prefix `` `after` was called outside a request scope `` and a
non-enumerable `__NEXT_ERROR_CODE` of `E468`. New `isOutsideRequestScope()` recognises exactly
that condition (either characteristic suffices: the code survives message edits, the prefix
survives a code renumbering; nothing else matches). The detached `write()` fallback now runs
ONLY for that recognised condition. Any other synchronous `after()` exception is reported via
`console.error('unexpected synchronous after() failure scheduling nl_search_log write', ...)`
and swallowed — never rethrown into `answerNlQuestion` (the telemetry-failure-isolation
contract) and never misread as permission to write detached. Request-scope behaviour is
byte-identical; telemetry is not disabled anywhere.

**Regression coverage (`tests/nl-search-log.test.ts`, now 5 tests).** (1) request-scope
scheduling still defers through `after()`; (2) the recognised outside-request-scope failure
(real message + E468 shape) writes detached without throwing; (3) a detached write failure
stays isolated from the caller; (4) an E468-coded error with a changed message is still
recognised; (5) an unrelated synchronous `after()` exception is NOT classified as the
fallback — no write, no throw, reported through the console.error mechanism. The two
DB-backed end-to-end tests remain unmocked.

### LOW — three zero-byte scratch artifacts removed

`0`, `consumedSet.has(t)`, and `rest)` in the worktree root were verified as exactly the
zero-byte, untracked shell-redirection artifacts Codex identified (0 bytes each, `file`
reports empty) and deleted. `git status` confirms none remain untracked; no other untracked
file was touched. (The earlier runbook note said four such files were removed; these three
had evidently been recreated by a later session — timestamps 2026-08-31 12:40–12:46.)

### Files changed in this pass

- `src/search/nl/plan.ts` — player_season scope backstop; `PARSER_VERSION` 30 → 31 + history.
- `src/db/queries/nl/log.ts` — narrowed after() fallback classification.
- `tests/nl-semantic-mapping.test.ts` — season-scope fail-closed block (+5 tests).
- `tests/nl-plan.test.ts` — direct season-grain validator backstop block (+4 tests).
- `tests/nl-search-log.test.ts` — recognition/misclassification coverage (+2 tests).
- Deleted: `0`, `consumedSet.has(t)`, `rest)` (untracked zero-byte artifacts).
- Tracking: this runbook, `issues.md`, `IssuesIndex.md`, `CHANGELOG.md`.

### Validation executed this pass (Fable-run, authorized by the task prompt)

- Focused suites (`nl-search-log`, `nl-plan`, `nl-semantic-mapping`): **162/162 passed**.
- Full DB-free NL matrix (the same 14 suites as the 697 baseline): **14 suites, 708/708
  passed** (697 baseline + 11 new; nothing weakened, skipped, or removed).
- Typecheck (`next typegen` + `tsc --noEmit`): **passed**.

### DB gate — PASSED 2026-08-31 (operator-run)

The operator ran the required gate:

```text
npx vitest run tests/integration/nl-answers-game-season.test.ts tests/integration/nl-semantic-mapping.test.ts
```

Result: **2 files passed, 46/46 tests passed, 20.07 s.** As expected, the bounded revision
(validation-backstop refusals plus the narrowed logging fallback) changed no integration
outcome: every threshold, scope-routing, ordering, H2H, Bulldogs, alias, and end-to-end
`answerNlQuestion` proof remains green against `afldb_test`.

Standing validation evidence for the bounded revision is therefore complete:

- DB-free NL matrix: **14 suites, 708/708 passed**;
- Typecheck (`next typegen` + `tsc --noEmit`): **passed**;
- DB-backed integration: **46/46 passed, 20.07 s** (operator-run).

### Residual for Codex adjudication — season cue lost before the backstop can see it

Explicitly preserved for the final review, NOT fixed in this pass:

`players with more than 50 goals in a season` routes `goals` through
`extractCareerConditions`, the unconditional cue-consumption loop eats `in a season`, and
grain election lands on `player_career` with `careerConditions goals > 50` — an unscoped
career-condition list that validates. The season meaning is lost at parse time, so the new
`player_season` validation backstop never sees a season plan to refuse; the career-total
question is answered instead of the best-season question that was asked. Stats that carry a
typed `metricCondition` (e.g. `disposals`) are unaffected and stay `player_season`.

**FINAL CODE REVIEW — Codex must adjudicate** whether this is a release-blocking semantic
defect of the same silent-discard family (requiring another bounded revision before
large-scale validation) or separate follow-up scope outside ISSUE-110's bounded revision. It
is a parser-routing question — no plan field survives for a validation backstop — so any fix
would touch grain election/cue consumption and was deliberately not attempted under the
no-parser-redesign boundary.

### Exact next action

**FINAL CODE REVIEW — Codex** of this bounded revision, including adjudication of the
season-cue residual above. ISSUE-110 remains **Open**. Do not start the 480-case UI corpus,
the 1,435/1,440-question corpus, the 100k corpus, any telemetry reset, or any large-scale
validation until Codex independently approves. The 22,607-search run remains incomplete and
recorded as such.

## 2026-08-31 Codex bounded implementation — generic-season ownership and tie policy (parser v32)

This implementation pass addressed only the release-blocking generic `in a season` ownership
defect identified by the immediately preceding final review and the player-season
`tiePolicy: "first"` validator/executor mismatch. It does not approve its own work and does not
resolve ISSUE-110.

### Blocker root cause and correction

`extractCareerConditions` claimed thresholds for career-vocabulary columns before grain
election. The parser had already detected and consumed generic `in a season`, but the
sole-career-condition conversion recognised only an explicit game cue or a named season/year.
With no `seasonMin`/`seasonMax` evidence left in the plan, a generic season threshold could
remain a valid `player_career` condition or be reinterpreted by later match-scope routing.
Validation could not recover the discarded season meaning.

The sole-career-condition conversion in `src/search/nl/parser.ts` now gives retained generic
`inOneSeason` first ownership, before single-game and scoped-total routing:

- a column present in the existing `player_season` metric allowlist becomes the plan metric
  plus the existing typed `metricCondition` with the comparator and value unchanged;
- the career-condition representation disappears because the resulting grain is
  `player_season`;
- no named year/range is invented;
- compatible `scope.clubFor` is retained;
- opponent, venue, match type/finals, round, and reachable matchup scope is retained so the
  existing player-season validation backstops refuse the unsupported combination honestly;
- a career column with no player-season metric retains an unconsumable `metricCondition` at
  career grain, forcing validation to fail closed instead of accepting a career answer.

Goals, games, and Brownlow votes are all existing player-season metrics and now execute with
per-season threshold semantics. The six required goals comparators (`gt`, `gte`, `eq`, `lt`,
`lte`, including `no more than`) preserve their exact operator and value. Named-year,
clubFor-season, explicit-game, and explicit-career controls remain valid.

`top 10 players with more than 50 goals in a season` now retains both the `top_n(10)` request
and the player-season `goals > 50` threshold. The current validator deliberately rejects that
unsupported combined shape rather than converting it into an unranked career list or inventing
ranking semantics.

### Player-season tie policy

`answerPlayerSeason` uses `rank()` and returns all ties. `validatePlan` previously accepted
`tiePolicy: "first"`, a contract the executor did not implement. Validation now rejects
`"first"` for `player_season` with an explicit error while keeping `"all"` valid. No first-tie
SQL was added.

Parser version changed **31 → 32** with the version-history contract updated.

### Files changed in this bounded pass

- `src/search/nl/parser.ts`
- `src/search/nl/plan.ts`
- `tests/nl-semantic-mapping.test.ts`
- `tests/nl-plan.test.ts`
- `issues/open/AFLDB-ISSUE-110.md`
- `IssuesIndex.md`
- `issues.md`
- `CHANGELOG.md`

### Validation (Codex-run, authorised by the implementation prompt)

- Red baseline after adding focused regressions: **2 files, 17 failed / 158 passed**. All six
  goals comparators, subject-less wording, games, Brownlow votes, four mixed scopes, reachable
  matchup, clubFor, top-N, and player-season `tiePolicy: "first"` exposed the current defects.
- Additional invariant red check after the first green pass: named-player ownership plus
  explicit career/season and mixed-condition conflicts produced **3/3 intended failures**.
- Focused parser/validator rerun after the final implementation:
  `tests/nl-semantic-mapping.test.ts tests/nl-plan.test.ts` — **2 files, 179/179 passed**.
- Complete established ISSUE-110 DB-free NL matrix: **14 suites, 730/730 passed** (previous
  baseline 708; 22 focused regressions added, none weakened or removed).
- Typecheck: `npm run typecheck` (`next typegen` + `tsc --noEmit`) — **passed**.
- An intermediate DB gate before the final named-player/conflict invariant extension passed
  **2 files, 46/46, 19.99 s**. After the tunnel was restored, the operator ran the required
  final post-change parser-v32 gate against `afldb_test`:

  ```text
  npx vitest run tests/integration/nl-answers-game-season.test.ts tests/integration/nl-semantic-mapping.test.ts
  ```

  Actual result: **2 test files passed, 46/46 tests passed, 19.30 s**.
  `tests/integration/nl-answers-game-season.test.ts` passed **24/24** and
  `tests/integration/nl-semantic-mapping.test.ts` passed **22/22**.
- No corpus, telemetry reset, production access, database rebuild, destructive database
  operation, or Git mutation was performed.

### Exact next action

**FRESH CODEX CHAT — FINAL INDEPENDENT CODE REVIEW**

The final reviewer must independently verify parser v32, particularly generic `in a season`
ownership; goals, games, and Brownlow season thresholds; every comparator variant; mixed
opponent, venue, finals, and round fail-closed behaviour; top-N plus generic-season handling;
the `player_season` tie-policy contract; and preservation of all previously fixed ISSUE-110
behaviour. The implementation chat must not approve its own work. Do not run the 480-case,
1,435/1,440-question, 100k, telemetry reset, or any other large-scale validation before
independent approval. ISSUE-110 remains Open; the incomplete 22,607-search run remains recorded
as incomplete.

## 2026-08-31 final bounded implementation — ranked career period backstop (parser remains v32)

The latest independent review returned **REVISE — NOT READY FOR LARGE-SCALE VALIDATION** for
one remaining HIGH silent-scope defect plus LOW temporary-artifact hygiene. This implementation
closes only those findings and does not approve or resolve ISSUE-110.

### Root cause and bounded validator correction

Explicit `career` wording selects `player_career`, while named-period extraction separately
retains `scope.seasonMin` and/or `scope.seasonMax`. The existing validator backstop checked
only career plans with `careerConditions`. Ranked career plans instead carry a non-null metric
and normally have no conditions, so `most career goals since 2000` and `most career goals in
2000` validated. `answerRanked()`/`metricValueExpr()` consume no season bounds and therefore
ranked unrestricted whole-career totals even though plan description could show the period.

`validatePlan` now applies one execution-path invariant: a `player_career` plan with no career
predicates cannot carry either season bound. It returns `A career question cannot be
restricted to a season range.` before execution. Career predicates remain exempt because their
builder parameters own the period. Parser output, ranked career SQL, generic `in a season`
ownership, and parser version 32 are unchanged; no ranked-period functionality was added.

Current outcomes:

- `most career goals since 2000` retains `player_career/goals/max` plus `seasonMin: 2000`, then
  validation refuses it;
- `most career goals in 2000` retains the same career ranking plus exact
  `seasonMin/seasonMax: 2000`, then validation refuses it;
- `most career goals` remains a valid unscoped all-time career ranking;
- existing unscoped career conditions, named-year and generic player-season questions, and
  supported club-scoped career rankings remain valid.

### Regression and validation evidence

- Focused red baseline after the regressions were added: **2 files, 4 failed / 178 passed**.
- Focused parser/validator final run: **2 files, 182/182 passed**.
- Expanded focused run with the affected coverage suite: **3 files, 345/345 passed**.
- The first 14-suite run exposed an obsolete Brownlow coverage fixture that attached 1950 to
  an all-time career ranking. Its real grain-specific coverage contract is now asserted
  directly, while the unscoped career ranking positive control remains green.
- Final established ISSUE-110 DB-free matrix: **14 suites, 733/733 passed**.
- Typecheck (`npm run typecheck`, `next typegen` + `tsc --noEmit`): **passed**.
- Authoritative post-final-revision operator DB gate: **2 test files, 46/46 passed in 20.65 s**,
  started at **18:52:45**. `tests/integration/nl-answers-game-season.test.ts` passed **24/24**
  in **9.460 s**; `tests/integration/nl-semantic-mapping.test.ts` passed **22/22** in
  **10.302 s**. Exact command:

  ```text
  npx vitest run tests/integration/nl-answers-game-season.test.ts tests/integration/nl-semantic-mapping.test.ts
  ```

  This is the authoritative DB gate for the final ranked-career season-range validator
  revision. It must not be confused with the earlier pre-revision 46/46 run at 17:47.

### Temporary artifact cleanup

Before deletion, all three paths were verified present. The two scripts matched the documented
ISSUE-110 Gary Ablett DB classifier and Windows Node preload; the ignored auth file had the
documented Playwright storage-state shape. The Gary identity/query evidence needed from the
classifier is already durable above (players 4701/4702, 248/357 games, canonical identity and
alias outcomes). Exactly these files were removed and then verified absent:

- `tools/nl/issue110-classify.ts`;
- `tools/nl/issue110-node-preload.cjs`;
- `tests/nl-ui/.auth/state.json`.

No other untracked or ignored file was deleted, and no broad cleanup command was used.

### Files changed in this bounded pass

- `src/search/nl/plan.ts`
- `tests/nl-plan.test.ts`
- `tests/nl-semantic-mapping.test.ts`
- `tests/nl-regression-corpus.test.ts`
- `issues/open/AFLDB-ISSUE-110.md`
- `IssuesIndex.md`
- `issues.md`
- `CHANGELOG.md`
- deleted: the three temporary files listed above

### Exact next action

**FRESH CODEX MEDIUM CHAT — FINAL INDEPENDENT CODE REVIEW** of the CURRENT final revision,
including the ranked `player_career` plus season-bound fail-closed invariant, its regressions,
and preservation of parser-v32 fixes. ISSUE-110 remains Open. Do not start the 480 UI corpus,
1,435/1,440 corpus, 100k corpus, telemetry reset, or any other large-scale validation unless
that review returns APPROVE.
