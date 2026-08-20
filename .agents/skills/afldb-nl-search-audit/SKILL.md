---
name: afldb-nl-search-audit
description: Review, debug, expand and regression-test AFLDB's deterministic natural-language search against the real PostgreSQL data and the real /search UI. Use for parser, plan, SQL compiler, alias, coverage, answer-rendering and NL-search regression work.
disable-model-invocation: true
---

# AFLDB Natural-Language Search Audit

Use this skill when AFLDB natural-language search gives a wrong answer, declines an answerable question, ignores part of a question, returns the wrong grain, or needs a new supported query family.

The objective is **semantic correctness against AFLDB's real data**, not merely making a parser unit test pass.

A successful change must satisfy all of these:

1. The question is interpreted correctly.
2. The structured plan preserves every meaningful constraint.
3. `validatePlan` accepts only combinations the SQL layer can actually execute.
4. The grain compiler honours every field in the validated plan.
5. The SQL result agrees with an independently written PostgreSQL truth query.
6. The `/search` UI renders the same answer, ties and caveats correctly.
7. Existing NL regression tests and representative neighbouring phrasings do not regress.
8. Parser behaviour changes carry a `PARSER_VERSION` bump.
9. No unsupported scope, metric, qualifier or data gap is silently dropped.

## Safety and repository rules

- Work on the local working tree only.
- Expected Windows editing copy: `D:\dev\afldb`.
- Authoritative Linux/database-backed environment: `/home/arm/projects/afldb`.
- Development PostgreSQL database: `afldb_dev`.
- The Linux database-backed result is authoritative; a Windows-only result is not sufficient.
- Do not commit, push, merge, rebase, checkout, reset, stash or otherwise mutate Git state. The user reviews local changes first.
- Do not deploy production changes.
- Do not write to production data.
- Treat the development database as read-only for NL verification unless the user explicitly requests a data change.
- Do not change source data to make a search test pass.
- Do not weaken validation, confidence thresholds or coverage protections just to turn a decline into an answer.
- Do not replace deterministic NL search with an LLM.
- Never interpolate reader text into SQL identifiers. New metrics and operations must remain closed/allowlisted.
- Preserve AFLDB's rule that `NULL` means "not recorded", not zero.

## Current architecture to preserve

The NL pipeline is:

`question -> canonicalise -> parser -> NlQueryPlan -> validatePlan -> grain compiler -> PostgreSQL -> NlAnswer -> describe/render`

Important source areas:

- `src/search/nl/parser.ts`
- `src/search/nl/plan.ts`
- `src/search/nl/vocab.ts`
- `src/search/nl/entities.ts`
- `src/search/nl/answer-types.ts`
- `src/search/nl/describe.ts`
- `src/db/queries/nl/`
- `src/db/queries/nl/resolve.ts`
- NL answer/UI components under `src/components/` and `/search`
- `tests/`
- `tools/nl/`
- `docs/search.md`
- migrations and schema definitions when a query depends on stored/derived columns
- `nl_search_log` and NL review tables when available

The current plan vocabulary already includes:

- grains: `player_career`, `player_game`, `player_season`, `team_match`, `club_season`, `team_streak`, `achievement_summary`
- match scope: club for/against, venue, season range, match type, round number
- period splits: `Q1`, `Q2`, `Q3`, `Q4`, `H1`, `H2`, `FULL_MATCH`
- team streak definitions: win, loss, unbeaten
- team-match aggregation/HAVING support
- player stat allowlists
- tie policy and bounded limits

Do not invent a second representation when an existing plan field correctly models the question. Extend the existing field or compiler path where appropriate.

# Invocation modes

The first argument may be one of:

- `audit` — inspect and reproduce problems; do not edit source.
- `fix` — reproduce, patch the smallest correct layer, add regression tests, and verify.
- `verify` — run the acceptance set and report results without broad code changes.
- `full` — audit the NL system category by category, fix justified defects, expand tests and run the broader regression suite.

If no mode is supplied, use `full`.

A remaining argument may identify one query, category or defect. Prioritise that scope first, then run neighbouring regressions.

# Core principle: prove where the defect lives

For every failing question, classify the first incorrect layer.

Use this order:

1. **Canonicalisation**
   - Did punctuation, slang or filler change the intended meaning?
   - Did a number such as `50` become a year accidentally?
   - Did a qualifier survive as an unsupported token?

2. **Entity resolution**
   - Was the correct club, historical alias, nickname or venue selected?
   - Was a club inside a venue name incorrectly extracted?
   - For two clubs, are subject/opponent roles correct?
   - Does the resolved club organisation deliberately include historical lineage where the query semantics require it?

3. **Slot extraction**
   - aggregation
   - metric
   - match type
   - season
   - round
   - period split
   - streak
   - HAVING/count threshold
   - margin threshold
   - career conditions
   - player mention

4. **Grain election**
   - Is this one player-match performance, player-season total, career total, one team match, a grouped team result, a club season or a streak?
   - Never patch the compiler to compensate for a plan that chose the wrong grain.

5. **Plan validation**
   - Does `validatePlan` reject a valid combination?
   - More importantly: does it accept a combination a compiler ignores?

6. **SQL compiler**
   - Does the selected grain compiler use every plan field?
   - Are predicates applied before ranking?
   - Are ties retained?
   - Are historical aliases resolved by organisation identity rather than brittle display strings?
   - Are `NULL` historical stats excluded honestly?

7. **Database/data coverage**
   - Does the requested stat exist for the requested era and grain?
   - Is a "no result" genuinely historical truth, or missing coverage?
   - Do period/quarter fields exist for the era?
   - Is Brownlow data being read from the authoritative season-level source where required?

8. **Answer description/rendering**
   - Is the data correct but headline/interpretation wrong?
   - Does a tie name all record holders?
   - Is the answer claiming "highest" when the question asked "lowest"?
   - Is a list described as a single leader?

9. **UI/runtime**
   - Does `/search` show the same answer as direct execution?
   - Any stale navigation, hydration, timeout or rendering issue?

Fix the **first wrong layer**, not a downstream symptom.

# Baseline before editing

Before any source change:

1. Inspect the relevant parser, plan, vocabulary, compiler and tests.
2. Record the current `PARSER_VERSION`.
3. Run the target question through the real `/search` UI.
4. Capture:
   - question
   - outcome
   - displayed headline
   - interpretation
   - result rows
   - caveats/coverage note
   - parsed/normalised query if exposed
   - plan token or debug plan if available
   - any failure reason
5. Run or add a small parser-only diagnostic that prints the actual `NlParse`/`NlQueryPlan`.
6. Independently query PostgreSQL for the ground truth.
7. Only then edit code.

Do not call a question "fixed" because the AST looks correct. AFLDB has previously had cases where the parser produced the right plan but a metric/compiler path rejected or ignored it.

# Database-grounded truth checks

Use PostgreSQL on the development server as the source of truth.

Prefer the project's existing environment/configuration. If `DATABASE_URL` is available, a safe read-only pattern is:

```bash
cd /home/arm/projects/afldb
set -a
[ -f .env ] && . ./.env
set +a

psql "$DATABASE_URL" -v ON_ERROR_STOP=1
```

Inside `psql`, make verification explicitly read-only:

```sql
BEGIN READ ONLY;
-- truth queries here
ROLLBACK;
```

If the project uses another existing DB wrapper/script, use it rather than inventing credentials.

Before writing a truth query, inspect the real schema. Do not guess column names.

Useful inspection patterns:

```sql
SELECT table_schema, table_name
FROM information_schema.tables
WHERE table_schema NOT IN ('pg_catalog', 'information_schema')
ORDER BY 1, 2;

SELECT table_schema, table_name, column_name, data_type
FROM information_schema.columns
WHERE table_schema NOT IN ('pg_catalog', 'information_schema')
  AND table_name IN (
    'matches',
    'player_match_stats',
    'player_season_stats',
    'player_career_stats',
    'club_seasons',
    'clubs',
    'club_aliases',
    'venues',
    'venue_aliases',
    'brownlow_results'
  )
ORDER BY table_schema, table_name, ordinal_position;
```

For each sample query, write an **independent SQL truth query** that does not simply copy the NL compiler SQL. Its purpose is to catch compiler bugs.

Truth-query rules:

- Use stable IDs/organisation IDs once resolved.
- For exact games, identify the one match first, then rank player rows inside it.
- For team-match records, derive both team perspectives if the schema stores one canonical home/away match row.
- For round queries, verify round type plus round number; do not assume a number alone means home-and-away.
- For finals, verify the stored phase/round semantics before filtering.
- For historical aliases, verify whether the intended question is historical identity-specific or organisation-lineage-wide.
- For quarter/half calculations, prove the calculation from actual score progression columns.
- For streaks, sort chronologically by real match date/order and explicitly define what breaks the streak.
- For grouped "teams with N wins/losses" queries, use `GROUP BY ... HAVING`.
- For margin-threshold counts, apply the margin predicate before grouping/counting.
- For Brownlow season totals, use the authoritative Brownlow season/results data, not incomplete per-match votes.

When a user supplies an expected answer, treat it as a test hypothesis, not unquestionable truth. Confirm it against the database.

# Playwright/UI verification

Browser verification is mandatory for any user-visible NL fix.

Use the existing Playwright configuration and test helpers where possible. First inspect:

```bash
ls -la playwright*.config.*
find tests -maxdepth 3 -type f | sort | grep -Ei 'playwright|search|nl'
find tools/nl -maxdepth 3 -type f | sort
```

Start or use the existing dev service according to the repository's documented workflow. Do not create a parallel ad-hoc server if one already exists.

For each target query, Playwright should:

1. Navigate to `/search`.
2. Enter the exact query text.
3. Submit/search using the same control a reader uses.
4. Wait for the NL answer section, not an arbitrary sleep.
5. Assert there is no client error/hydration failure.
6. Capture the answer headline and interpretation.
7. Assert key result values/labels.
8. Assert ties where applicable.
9. Assert a correct decline when data/coverage is unavailable.
10. Save a screenshot or trace only when useful for diagnosis; do not rely on screenshots instead of text assertions.

Prefer semantic locators (`role`, label, visible text, test id) over brittle CSS.

Do not use arbitrary `waitForTimeout()` as a correctness mechanism.

A representative skeleton, adapted to the app's actual controls:

```ts
test('NL: exact Richmond v Essendon R5 1984 hitouts', async ({ page }) => {
  await page.goto('/search');
  // Use the real labelled input/combobox discovered in the page.
  await page.getByRole('searchbox').fill('most hit out Richmond v Essendon Round 5 1984');
  await page.keyboard.press('Enter');

  const answer = page.getByTestId('nl-answer');
  await expect(answer).toBeVisible();
  await expect(answer).toContainText('Mark Lee');
  await expect(answer).toContainText('29');
});
```

Do not copy this locator blindly. Inspect the rendered DOM and use the real accessible control.

# Parser and plan regression tests

Every parser fix needs direct plan-shape coverage.

Assert the complete semantic shape that matters, not merely `status === "plan"`.

For example:

```ts
expect(plan).toMatchObject({
  grain: 'player_game',
  metric: 'hitouts',
  agg: { kind: 'max' },
  scope: {
    clubFor: { slug: 'richmond' },
    clubAgainst: { slug: 'essendon' },
    roundNumber: 5,
    seasonMin: 1984,
    seasonMax: 1984,
  },
});
```

Also assert that fields that would change the answer are **not absent**.

When adding a new phrase, add neighbouring language variants and collision tests. Examples:

- `most` vs `at most`
- `win` vs `wins`
- `loss` vs `losses`
- `final` as match scope vs `finals` as a career count
- `inside 50` as a metric vs a season/year-looking number
- `Melbourne` vs `Melbourne Cricket Ground`
- `Brisbane` historical lineage vs `Brisbane Bears` identity-specific wording
- `Round 3` with and without a season
- `v`, `vs`, `versus`, `against`
- `highest`, `most`, `biggest`, `fewest`, `lowest`
- singular/plural stat forms
- nickname/official club name pairs
- venue current name/historical alias pairs

# Compiler regression tests

For every plan field involved in a fix, add a database-backed test proving the compiler consumes it.

At minimum, compare:

- baseline plan without the field
- plan with the field
- result difference expected from the real data

This catches silent-field bugs such as a validated `roundNumber`, `periodSplit`, `havingClause` or `streakDefinition` that never reaches SQL.

Where practical, test the SQL result against a known development-database truth row rather than a synthetic-only fixture.

# Required sample acceptance suite

Use these as the first acceptance corpus. Do not hardcode answers other than user-provided/DB-verified truths.

## A. Exact game, round and match type

- `most hit out Richmond v Essendon Round 5 1984`
  - expected interpretation: highest individual hitouts in the Richmond v Essendon Round 5, 1984 match
  - expected leader supplied by user: **Mark Lee — 29 hitouts**
- `most disposals Collingwood v Carlton Round 1 2010`
- `highest score by Geelong in Round 15 2008`
- `most goals in a Grand Final`
- `fewest points scored in a final at the MCG`
- `Hawthorn highest score in Round 3`

Primary checks:
- exact season+round scoping
- two-club role assignment
- singular match scope vs all matching rounds
- finals/grand-final scope
- venue+match-type intersection
- round number without season must remain a multi-season ranking, not invent a season

## B. Period and quarter splits

- `most goals in Q1 by a player`
- `highest team score in Q3`
- `highest H2 score by the Magpies`
- `biggest win margin in a first half`
- `most disposals in the fourth quarter in 2023`
- `lowest second half score by Essendon`

Primary checks:
- player stat split vs team scoring split
- Q1-Q4 and H1/H2 calculations
- season/club scope retained
- coverage declines when player quarter stats are not stored
- never infer quarter-level player stats from full-match totals

## C. Team streaks

- `longest winning streak against the Blues`
- `Swans longest losing streak at the SCG`
- `longest unbeaten streak in finals`
- `Hawthorn longest winning streak at Waverley`
- `longest losing streak against Collingwood`

Primary checks:
- chronological ordering
- opponent scope
- club scope
- venue scope
- finals scope
- draws continue `unbeaten` but break pure `win`
- draws break both winning and losing streaks unless the defined semantics explicitly say otherwise

## D. HAVING clauses, loss margins and grouped aggregation

- `teams with more than 3 wins against the Lions`
- `teams to lose 5 times by more than 100 points`
- `teams with at least 10 wins at the SCG`
- `teams with more than 5 losses against Geelong since 2000`

Primary checks:
- group by team before `HAVING`
- correct operator: `gt` vs `gte`
- opponent, venue and season filters apply to the counted matches
- margin threshold applies to the qualifying losses before the count
- a grouped list is not described as one match record

Important plan-model check:

The current `havingClause` shape is `{ metric, op, value }`. If a query such as "lose 5 times by more than 100 points" needs an additional per-match margin predicate, do not smuggle that threshold into an unrelated field or encode it in a metric string. Add an explicit, validated representation if the existing plan cannot express it cleanly, then update the compiler and tests together.

## E. Historical club aliases, slang and venues

- `Bloods biggest win at Marvel`
- `Dons biggest blowout win at Optus Stadium`
- `fewest points scored by the Bears at UTAS`
- `Pies highest score at Kardinia`
- `Suns biggest margin at the Gabba`

Primary checks:
- `Bloods` -> Sydney/South Melbourne lineage only if that is the intended organisation-level query
- `Dons` -> Essendon
- `Bears` must not be silently rewritten to modern Brisbane Lions if the wording asks specifically for Brisbane Bears historical identity
- `Pies` -> Collingwood
- `Suns` -> Gold Coast
- venue aliases resolve through DB alias tables
- `Marvel`, `Optus Stadium`, `UTAS`, `Kardinia`, `Gabba` must resolve to the real venue IDs/aliases present in the database

Historical identity is semantic, not just vocabulary. Verify whether each alias points at a specific historical club identity or an organisation lineage before deciding the SQL scope.

## F. Advanced player statistics and acronyms

- `most contested possessions in a game`
- `most uncontested possessions in a season`
- `most inside 50s in a match`
- `most clearances in a game by a Carlton player`
- `most brownlow votes in a season`
- `most rebound 50s in a final`
- `most goal assists in a match`

Primary checks:
- metric alias -> correct allowlisted key
- correct grain: game vs season
- club filter retained
- match-type filter retained
- era coverage is explicit
- Brownlow season totals use authoritative season-level data
- no `NULL -> 0` conversion

## G. Player career and milestone queries

- `players with more than 300 games and 500 goals`
- `most goals on debut`
- `most premierships with 3+ clubs`
- `most games without a final`

Primary checks:
- multiple career conditions remain in the same plan
- `more than` means strict `gt`, not `gte`
- `on debut` is a first-match boundary/scope, not a debut season
- `3+ clubs` remains a career condition while premierships remains the ranking metric
- `without a final` means finals = 0 and must not be confused with "not in a final" match scope

# User-supplied expected plan examples

Use these shapes as semantic targets, adapting only to the actual current type definitions.

## Exact Richmond v Essendon match

```json
{
  "grain": "player_game",
  "metric": "hitouts",
  "agg": { "kind": "max" },
  "scope": {
    "clubFor": { "name": "Richmond", "slug": "richmond" },
    "clubAgainst": { "name": "Essendon", "slug": "essendon" },
    "roundNumber": 5,
    "seasonMin": 1984,
    "seasonMax": 1984
  }
}
```

## Collingwood second-half team score

```json
{
  "grain": "team_match",
  "metric": "team_score",
  "periodSplit": "H2",
  "agg": { "kind": "max" },
  "scope": {
    "clubFor": { "name": "Collingwood", "slug": "collingwood" }
  }
}
```

## Teams with more than three wins against Brisbane Lions

```json
{
  "grain": "team_match",
  "havingClause": {
    "metric": "wins",
    "op": "gt",
    "value": 3
  },
  "agg": { "kind": "list" },
  "scope": {
    "clubAgainst": { "name": "Brisbane Lions", "slug": "brisbane-lions" }
  }
}
```

## Longest winning streak against Carlton

```json
{
  "grain": "team_streak",
  "streakDefinition": { "kind": "win" },
  "agg": { "kind": "max" },
  "scope": {
    "clubAgainst": { "name": "Carlton", "slug": "carlton" }
  }
}
```

## Essendon biggest win at Optus Stadium

```json
{
  "grain": "team_match",
  "metric": "win_margin",
  "agg": { "kind": "max" },
  "scope": {
    "clubFor": { "name": "Essendon", "slug": "essendon" },
    "venue": { "name": "Optus Stadium", "slug": "optus-stadium" }
  }
}
```

# Expansion strategy

When the sample suite is stable, expand systematically rather than adding random phrases.

For each semantic feature, generate a small matrix across:

- aggregation: max / min / top N / list / count
- grain: game / season / career / team match / streak
- club role: for / against / both clubs
- venue: none / named / alias
- time: all-time / exact season / since / range
- match type: H&A / final / grand final / specific final type
- period: full match / quarter / half where supported
- wording: formal / common slang / abbreviation
- operator: `>`, `>=`, `<`, `<=`, `=`
- singular/plural and punctuation variants

Prefer 3-8 strong variants per new rule over hundreds of mechanically duplicated strings.

Then run the existing larger NL corpus/stress tooling so local fixes are measured against broad behaviour.

# Metamorphic tests

Equivalent wording should produce the same canonical plan or the same semantic answer.

Examples:

- `Richmond v Essendon` == `Richmond vs Essendon` == `Richmond versus Essendon`
- `Dons` == `Essendon`
- `Pies` == `Collingwood`
- `Q4` == `fourth quarter`
- `H2` == `second half`
- `most` == `highest` when the metric semantics are the same
- `more than 3` == `> 3`
- `at least 10` == `>= 10`
- `rebound 50s` == `R50s`
- `inside 50s` == `I50s`

Non-equivalent wording must remain different:

- `at most 20` != `most 20`
- `win` != `wins` where one means one-match margin and the other a tally
- `Brisbane Bears` != `Brisbane Lions` when historical identity matters
- `a final` != `finals played`
- `on debut` != `in debut season`
- `most goals in a Grand Final` != `most Grand Finals`

# Parser-version rule

Any parser vocabulary or decision-logic change that alters outcomes must increment `PARSER_VERSION` in the same change.

Update the version-history comment with:

- old defect
- why it happened
- semantic fix
- meaningful regression/example
- whether outcome, plan shape or only failure classification changed

Do not bundle unrelated parser behaviours under one version.

# Performance checks

Correctness comes first, but do not introduce avoidable full-table work.

For new SQL/compiler paths:

- run `EXPLAIN (ANALYZE, BUFFERS)` on representative development queries
- confirm filters are pushed before ranking/grouping where possible
- inspect existing indexes before proposing new ones
- avoid per-row correlated work when a grouped CTE/window query is clearer
- preserve bounded result limits and tie policy
- do not add an index merely because a query "looks complex"; measure it

A query that is semantically correct but routinely times out is not complete.

# How to patch

Prefer the smallest coherent change.

Typical decision table:

| Finding | Correct place to change |
|---|---|
| New nickname/synonym only | `vocab.ts` or maintained alias table |
| Club/venue resolves to wrong entity | entity/alias resolution |
| Words understood but wrong roles | `parser.ts` |
| Needed semantic field absent | `plan.ts` + validation + parser + compiler |
| Plan correct but answer wrong | grain compiler |
| SQL result correct but headline wrong | `describe.ts` |
| Correct decline due to unavailable era | coverage metadata/message, not fake data |
| UI differs from direct answer | answer component/search page/runtime |
| Database truth itself wrong | report separately; do not hide with NL logic |

Do not solve a missing plan concept by encoding structured meaning into arbitrary strings.

# Minimum verification after a fix

Run, in this order:

1. focused unit tests for changed parser/plan/description logic
2. focused DB-backed compiler/integration tests
3. the exact failing query through `/search`
4. at least 3 neighbouring variants
5. at least 2 negative/collision cases
6. relevant NL test suite
7. existing larger NL regression/stress corpus if available
8. TypeScript/typecheck/lint/build checks used by the repository
9. Playwright search smoke test

Discover the repository's actual script names from `package.json`; do not assume them.

Example discovery:

```bash
node -e "console.log(require('./package.json').scripts)"
```

# Reporting format

At the end of an `audit`, `fix`, `verify` or `full` run, report:

## Summary

- queries tested
- correct
- wrong answer
- incorrect decline
- correct decline / unavailable coverage
- runtime/UI failures

## Defects found

For each defect:

- exact query
- observed result
- DB truth
- first incorrect layer
- root cause
- files involved
- severity
- fix status

## Changes made

List local files changed and the semantic reason for each.

Do not report Git commits because this skill does not commit.

## Verification

List the exact tests/commands run and their results.

For database-backed answers, include a compact truth statement such as:

`Richmond v Essendon, Round 5 1984 -> Mark Lee, 29 hitouts (verified directly in afldb_dev).`

## Remaining gaps

Separate:

- parser/feature gaps
- compiler gaps
- data coverage limitations
- data-quality defects
- performance concerns
- intentionally unsupported ambiguity

# Completion standard

Do not declare the work complete until:

- every user-supplied sample question has a classified result;
- every fixed question is verified against the development database;
- every fixed user-visible path is exercised through the real `/search` UI;
- all meaningful plan fields are compiler-tested;
- no fixed phrase leaves a known collision regression;
- parser versioning is correct;
- the broader NL suite shows no unexplained regression.

If a sample cannot be answered from stored data, say exactly which required field/grain/era is unavailable and make the parser decline honestly. A safe, precise refusal is better than a confident answer built from the wrong statistic.
