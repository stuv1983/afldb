# AFLDB-ISSUE-201 — Career-boundary season ranges rejected by the player_career validator

Status: **Implemented 2026-09-16, awaiting operator validation** (planning 2026-09-16, implementation
2026-09-16, both Sonnet 5). First of AFLDB-ISSUE-200's three candidate defect follow-ons (Stage 2
next-task item 5a, `PLANNER_VALIDATOR_BUG` / `coverage_unavailable|boundary`, 598 rows). Do not treat
as resolved until the operator has run the commands in §7 and the stable corpus shows the 598 → 0
movement with no collateral change to the other five ISSUE-200 clusters. See `issues.md` for the full
planning-session root-cause record this runbook implements; this file adds the implementation and
validation record.

## 1. Confirmed root cause (planning session, re-verified before editing)

Two defects combine to produce the 598 manifestations:

1. **Validator** (`src/search/nl/plan.ts:2239-2244`, inside `validatePlan`): a `player_career` plan
   carrying a season range is rejected unless `careerPredicatesOwnSeasonRange(raw.careerPredicates)`
   is true. `raw.boundary` (`NlBoundary = {event: 'debut'|'last_game', where: 'grand_final'|'final'}`,
   defined `plan.ts:1198-1201`, independently validated `plan.ts:2037-2041`) is a separate top-level
   plan field, not a `GridAxisState` career predicate, so it is invisible to that ownership check. A
   boundary plan with a season range therefore always hit the rejection, even though the range names
   *when the boundary event happened*, not a career-aggregation window.
2. **Compiler** (`src/db/queries/nl/player-career.ts`): `conditionsWhere`/`boundarySql` never read
   `plan.scope.seasonMin`/`seasonMax` at all for boundary plans. Relaxing the validator alone would
   have let the plan through and then silently ignored the requested year/range — the same class of
   silent-scope defect AFLDB-ISSUE-110 fixed for other grains.

Evidence: AFLDB-ISSUE-200 real-audit row `coverage_unavailable|boundary`, id 9908, "players whose
first game was a Grand Final in 1897" — parses to grain `player_career`,
`boundary: {event: 'debut', where: 'grand_final'}`, `seasonMin = seasonMax = 1897`, then declines
`coverage_unavailable`: "A career question cannot be restricted to a season range."

## 2. Required semantics (unchanged from planning)

The season range applies to the player's TRUE career boundary, never to "search matches in this
range, then pick the first/last one":

1. determine the real career debut/last game (`pms.career_game_no = 1` / `m.match_date =
   c.last_match_date` — already correct, unchanged);
2. confirm that game meets the boundary predicate (`grand_final`/`final` — already correct,
   unchanged);
3. require that game's OWN season to satisfy the requested range.

`player_career_stats c` already carries precomputed, single-valued `c.debut_season` and
`c.final_season` columns for every player (already selected in `careerRowSelect`,
`player-career.ts:191`, and already trusted the same way by `debuted_between` in
`src/db/queries/grid-solver.ts:450-452`). ANDing a range onto one of these columns cannot change
which game is the boundary — it can only additionally require the already-fixed true boundary to
fall in range.

## 3. Implementation

### `src/search/nl/plan.ts`

`validatePlan`'s season-range gate (was `plan.ts:2239-2244`) narrowed to exempt a plan carrying
`raw.boundary`, alongside the existing `careerPredicatesOwnSeasonRange` exemption:

```ts
if (
  raw.grain === 'player_career' && !careerPredicatesOwnSeasonRange(raw.careerPredicates)
  && !raw.boundary
  && (raw.scope.seasonMin !== undefined || raw.scope.seasonMax !== undefined)
) {
  return { error: 'A career question cannot be restricted to a season range.' };
}
```

`raw.boundary` is independently locked to `event ∈ {debut, last_game}`, `where ∈ {grand_final,
final}`, `grain === player_career` by the check a few lines above — this cannot be used to smuggle a
season range onto an unrelated career predicate/condition, and a plan with no boundary still falls
through to the rejection exactly as before (`careerPredicatesOwnSeasonRange`/its builder list
unchanged).

`PARSER_VERSION` bumped **50 → 51** with a version-history comment, per AFLDB-ISSUE-110 precedent
(that issue bumped this same constant repeatedly for validator-only changes to this exact
season-ownership mechanism — see `issues/closed/AFLDB-ISSUE-110.md:1214-1215`, "parser outcomes and
plan shapes change").

### `src/db/queries/nl/player-career.ts`

`conditionsWhere` now compiles the boundary's season range against the boundary-appropriate
precomputed column, added as a new `boundarySeasonWhere` helper:

```ts
function boundarySeasonWhere(boundary: NlBoundary, scope: NlQueryPlan['scope']): SqlFragment[] {
  const seasonColumn = boundary.event === 'debut' ? sql`c.debut_season` : sql`c.final_season`;
  const clauses: SqlFragment[] = [];
  if (scope.seasonMin !== undefined) clauses.push(sql`${seasonColumn} >= ${scope.seasonMin}`);
  if (scope.seasonMax !== undefined) clauses.push(sql`${seasonColumn} <= ${scope.seasonMax}`);
  return clauses;
}
```

called from `conditionsWhere` right after `boundarySql`:

```ts
if (plan.boundary) {
  clauses.push(boundarySql(plan.boundary));
  clauses.push(...boundarySeasonWhere(plan.boundary, plan.scope));
}
```

`>=`/`<=` matches the convention every other grain already uses for `seasonMin`/`seasonMax` (e.g.
`src/db/queries/nl/player-game.ts:67-68`); `since YEAR` → `seasonMin = YEAR`, `before YEAR` →
`seasonMax = YEAR - 1` (parser convention, unchanged, `parser.ts:391-393`), `in YEAR` →
`seasonMin = seasonMax = YEAR`. No new convention introduced. `boundarySql`'s own signature and its
`EXISTS` subqueries are unchanged — the season clauses are separate, ANDed siblings via `foldAnd`
(`player-career.ts:172-175`), not folded into the `EXISTS`.

### `describePlan` (`plan.ts:2464-2468`, `plan.ts:2490-2493`)

No change needed or made. It already prints a generic `Seasons: X-Y.` line whenever
`seasonMin`/`seasonMax` are set, followed by the `Boundary: …` line — both now render once validation
passes. Judgement call from planning (a bespoke label like father-son-selection's "Draft years:" vs
the generic "Seasons:") was left as-is: the immediately-following `Boundary:` line already makes the
pairing unambiguous, and no test or product requirement calls for a different label.

## 4. Files changed

- `src/search/nl/plan.ts` — validator gate (§3), `PARSER_VERSION` 50 → 51 + history comment.
- `src/db/queries/nl/player-career.ts` — `boundarySeasonWhere` + `conditionsWhere` wiring (§3).
- `tests/nl-parser.test.ts` — parser-shape regressions (§5).
- `tests/nl-plan.test.ts` — validator-acceptance regressions (§5).
- `tests/integration/nl-answers.test.ts` — DB-backed regressions (§5).
- `issues.md` — this issue's ledger entry (root cause + runbook cross-reference), Open Issues table
  row.
- `IssuesIndex.md` — open-issue summary.
- `AFLDB-ISSUE-201.md` (this file).

`CHANGELOG.md` is **not** updated yet — per repo precedent (ISSUE-195/197/198/199 entries were all
added at resolution, not at implementation), the entry is deferred until operator validation confirms
the fix and the issue is marked resolved.

## 5. Regression tests added

All added to existing suites; no new test file created.

**`tests/nl-parser.test.ts`**, new `describe('AFLDB-ISSUE-201: boundary plus a season range')` inside
the existing `'7. career-boundary queries'` block:
- debut + exact year ("...in 1897") → `seasonMin = seasonMax = 1897`.
- debut + since ("...since 2000") → `seasonMin = 2000`, `seasonMax` undefined.
- debut + before ("...before 1950") → `seasonMax = 1949` (existing `before` convention).
- last_game + exact year and + since, proving both date forms reach `last_game` too.
- the plain `final` boundary target (not just `grand_final`) also carries the range.
- negative: "most career goals since 2000" carries no `boundary` (parser-shape half of the negative
  regression; validator half is below).

**`tests/nl-plan.test.ts`**, new `describe('AFLDB-ISSUE-201: a boundary owns its own season range')`
next to the existing boundary-rejection test:
- `it.each` over exact-year/since/before for `debut`/`grand_final` — all accepted.
- `last_game`/`grand_final` with a season range — accepted.
- `debut`/`final` (non-grand) with a season range — accepted.
- **negative regression:** the same plan shape with no `boundary` still returns exactly `{ error: 'A
  career question cannot be restricted to a season range.' }` — proves the exemption is boundary-only.
  (The pre-existing tests at `tests/nl-semantic-mapping.test.ts:626-632` and `:638-649` — "players
  with more than 500 career goals since 2000", "most career goals since 2000/in 2000" — were
  re-inspected and are untouched by this change: none carry `raw.boundary`, so `!raw.boundary` is
  true and the rejection path is unaffected. These remain the standing negative-regression evidence.)

**`tests/integration/nl-answers.test.ts`**, new
`describe('AFLDB-ISSUE-201: boundary questions carry a season range against the true boundary')`,
DB-backed against `afldb_test`:
- debut/grand_final "since 2000" and last_game/grand_final "before 1950": total compared against
  hand-written SQL filtering `c.debut_season`/`c.final_season` directly (the same shape the fix
  compiles); PLUS an existence-checked counter-example query that looks for a real player whose TRUE
  boundary season is outside the requested range but who has *some other* match inside it — if such a
  player exists in the fixture, the test asserts they are excluded from the plan's result. This is
  what distinguishes "filter on the true boundary" (correct) from "filter matches, then pick
  first/last" (incorrect) using real, non-deterministic fixture data, following the same
  existence-guarded pattern (`if (rows.length > 0) { ... }`) already used by the surrounding boundary
  tests in this file.
- debut/`final` (non-grand) exact-year case, to keep both boundary-location predicates covered
  end-to-end through real SQL, not just through the parser/validator.

## 6. Risks / residual notes

- `describePlan`'s generic `Seasons: X-Y.` label is a judgement call, not a defect (see §3); revisit
  only if product feedback says the pairing reads ambiguously.
- The DB-backed counter-example assertions are existence-guarded: if `afldb_test` happens to contain
  no player matching the counter-example shape for the chosen years, that specific assertion is a
  no-op for this run (consistent with the file's existing convention) — the primary hand-written-SQL
  total comparison in the same test is not guarded and is the primary proof either way.
- Not touched, per scope: `NL_CAREER_SEASON_OWNING_BUILDERS`/`careerPredicatesOwnSeasonRange` (the
  plain "debuted in the 1990s" wording, which already worked), the GWS/`zero` parser bugs, the stale
  pre-1965 coverage corpus rows, and the two `_LEGITIMATE`/`TAXONOMY_DRIFT` clusters.

## 7. Operator validation commands

Run from `D:\dev\afldb-issue-201`.

Focused unit tests (DB-free):
```
npx vitest run tests/nl-parser.test.ts tests/nl-plan.test.ts tests/nl-semantic-mapping.test.ts
```

Integration test (DB-backed, needs `AFLDB_TEST_DATABASE_URL` pointed at an `_test`-suffixed
database):
```
npx vitest run tests/integration/nl-answers.test.ts
```

Typecheck:
```
npx tsc --noEmit
```

Stable V2-derived corpus rerun (parser v51) — use whichever invocation last produced
`nl-stress-v50-cleaned`/the v50 rerun referenced in `issues.md`, updating the output directory name
for v51, e.g.:
```
npm run nl:stress -- --corpus /home/arm/nl-stress-corpus-v2.csv --parse-only --out /home/arm/nl-stress-v51-cleaned
```

Before/after comparison of the 598 boundary manifestations — re-run the ISSUE-200 audit tooling
against the fresh v51 output and confirm the `coverage_unavailable|boundary` /
`PLANNER_VALIDATOR_BUG` cluster is now empty, with the other five clusters' counts unchanged
(`STALE_CORPUS_EXPECTATION` 180, `PARSER_BUG` 128 GWS + 15 zero, `GRAIN_EQUIVALENT_LEGITIMATE` 72,
`TAXONOMY_DRIFT` 70):
```
npx tsx tools/nl/audit-issue-200-extract.ts --in /home/arm/nl-stress-v51-cleaned --out /home/arm/issue-201-recheck.csv
npx tsx tools/nl/audit-issue-200-cluster.ts --in /home/arm/issue-201-recheck.csv
```
(confirm exact flags against `tools/nl/README.md`/the scripts' own `--help` before running — this
runbook does not invent flags beyond what ISSUE-200 already used).

## 8. Resolution

Not yet resolved. Record actual command output, pass/fail counts, and the before/after corpus
comparison here (and in `issues.md`) once the operator runs §7, then update `IssuesIndex.md` and add
the `CHANGELOG.md` entry.
