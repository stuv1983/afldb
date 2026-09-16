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
- `tools/nl/fix-issue-201-stale-boundary-expectations.ts` — guarded two-row corpus correction (§9).
- `tests/nl-issue-201-corpus-fix.test.ts` — unit tests for the correction script (§9).
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

## 9. Closeout: two stale corpus expectations corrected (2026-09-16, Sonnet 5)

After the operator's local validation of §1–§5 (774/774 focused unit tests, 33/33 DB-backed
`tests/integration/nl-answers.test.ts`, clean `tsc --noEmit`), the operator ran the stable V2-derived
corpus against parser v51 and compared it against v50:

```text
v50: 12000 scored, 10937 clean, 1063 soft, 0 failed
v51: 12000 scored, 11533 clean,  467 soft, 0 failed
```

Cross-referencing the exact 598 ids AFLDB-ISSUE-200 classified `PLANNER_VALIDATOR_BUG` against the
fresh v51 output: **596 cleared, 2 still soft** — id 9907 ("players whose first game was a Grand Final
before 1897") and id 10294 ("players whose debut was a Grand Final before 1897"). Both resolve to
`scope.seasonMax = 1896` (the parser's `before YEAR` → `seasonMax = YEAR - 1` convention), one season
before `NL_LIMITS.minSeason` (1897, the first VFL season) — v51's validator correctly declines both
with `coverage_unavailable` / "Season is out of range." (`plan.ts:2314-2320`), which is the same
season-bounds check every other grain is subject to, not a boundary-specific defect.

The corpus's own expectation for both rows (`expected_status=success`, `coverageBehaviour=full`,
`minConfidence=0.78`) predates this issue's fix and is the stale side, exactly as AFLDB-ISSUE-200's
`STALE_CORPUS_EXPECTATION` disposition already established for the separate 180-row pre-1965-coverage
family (`coverage_unavailable|fgf`, not touched by this closeout). AFLDB-ISSUE-200's human disposition
of these 2 ids as `PLANNER_VALIDATOR_BUG` (bundled into the 598-row `coverage_unavailable|boundary`
cluster before the validator fix existed to test against) is corrected here to
`STALE_CORPUS_EXPECTATION`.

**Do not weaken the coverage guard to make these two questions return success** — 1897 is a real,
already-relied-upon coverage boundary (`NL_LIMITS.minSeason`, and the `FIRST_SEASON` constant
`tools/nl/corpus.ts:130`), not an artefact of this fix.

### Correction mechanism

Following the AFLDB-ISSUE-199 precedent (`tools/nl/fix-issue-199-stale-expectations.ts` — an
auditable, self-verifying, fail-closed script, never a hand-edit of the canonical CSV), a new sibling
script was added: `tools/nl/fix-issue-201-stale-boundary-expectations.ts`.

It corrects exactly ids 9907 and 10294:

1. asserts each row's own question text matches this issue's audited text verbatim;
2. asserts each row's current `expected_status` is `success`;
3. asserts each row's translated (`toExpectation`) `seasonTo === 1896`, `boundaryEvent === 'debut'`,
   `matchType === 'grand_final'`;
4. rewrites `expected_status` → `decline`, `verification_level` → `EXPECTED_DECLINE`,
   `expected_failure_reason` → `coverage_unavailable`, and clears `expected_coverage_behavior` /
   `expected_min_confidence` (both described a successful answer and no longer apply);
5. **preserves** `expected_grain` (`player_career`), `expected_season_to` (`1896`),
   `expected_match_type` (`grand_final`), `expected_boundary` (`first`) unchanged — the plan still
   parses to exactly that shape, only the season range has no coverage;
6. self-checks that exactly these 2 rows changed and refuses (writing nothing) on any invariant
   failure, row-count mismatch, or unexpected change elsewhere in the file.

`verification_level: 'EXPECTED_DECLINE'` for a corrected decline row is this repository's own
established convention, not invented here — see the Ablett/Jones/streak/coach fixtures in
`tests/nl-issue-199-corpus-fix.test.ts`.

Unit tests: `tests/nl-issue-201-corpus-fix.test.ts` (new file, mirroring
`tests/nl-issue-199-corpus-fix.test.ts`'s structure) — successful correction and field-shape
assertions, row-ordering and byte-identical-non-target-row checks, and one refusal test per audited
invariant (question text, status, seasonTo, boundaryEvent, matchType, missing id, duplicate id, wrong
row count).

### Expected benchmark after the two-row correction

Re-running parser v51 against the corrected corpus should move the headline from 467 → 465 soft, with
0 hard and 0 newly-clean-then-failing rows:

```text
12000 scored
11535 clean
 465 soft
   0 failed
```

Soft classes:

```text
GRAIN_EQUIVALENT:    72
UNEXPECTED_DECLINE: 323
WRONG_FAILURE_REASON: 70
```

The 323 remaining `UNEXPECTED_DECLINE` rows are the three already-known, unresolved families —
stale pre-1965 FGF coverage expectations (180), the GWS unsupported-term parser bug (128), and the
`zero` word-form parser bug (15) — none of which this closeout touches.

`tools/nl/audit-issue-200-extract.ts` remains hard-coded to the original AFLDB-ISSUE-200 baseline
(`UNEXPECTED_DECLINE` 921) and is expected to keep failing closed against any post-v51 corpus; this is
by design (see its own module comment) and is not weakened here. Comparing v51 before/after this
closeout uses direct row-ID/class comparison against the recorded 598-id list instead.

### Corrected final accounting for AFLDB-ISSUE-200's `PLANNER_VALIDATOR_BUG` disposition

```text
598 originally attributed to PLANNER_VALIDATOR_BUG
596 genuine validator/compiler defects — fixed by this issue's §3 implementation
  2 stale corpus expectations — reclassified STALE_CORPUS_EXPECTATION, corrected by §9's guarded script
  0 genuine AFLDB-ISSUE-201 implementation defects remain
  0 new soft regressions
  0 hard failures
```

## 10. Operator validation commands (closeout)

Run from `D:\dev\afldb-issue-201`. §7's commands (focused unit/integration tests, `tsc --noEmit`, the
v51 corpus rerun) must already be green before these.

1. Unit tests for the guarded two-row correction script:
   ```
   npx vitest run tests/nl-issue-201-corpus-fix.test.ts
   ```
2. Typecheck (already covered by §7's `npx tsc --noEmit`; re-run only if this closeout's new files
   were not yet included):
   ```
   npx tsc --noEmit
   ```
3. Regenerate the corrected V2 corpus from the retained v2 file (never overwrite it in place):
   ```
   npx tsx tools/nl/fix-issue-201-stale-boundary-expectations.ts \
     --corpus /home/arm/nl-stress-corpus-v2.csv --out /home/arm/nl-stress-corpus-v3.csv
   ```
   Confirm the script's own summary reports `target rows modified: 2` and
   `non-target rows modified: 0` before proceeding.
4. Parser-v51 stress rerun against the corrected v3 corpus:
   ```
   npm run nl:stress -- --corpus /home/arm/nl-stress-corpus-v3.csv --parse-only --out /home/arm/nl-stress-v51-v3
   ```
5. Exact class-count verification against §9's expected benchmark (11535 clean / 465 soft / 0 failed;
   `GRAIN_EQUIVALENT` 72, `UNEXPECTED_DECLINE` 323, `WRONG_FAILURE_REASON` 70) — read
   `/home/arm/nl-stress-v51-v3/summary.json` and `report.md`.
6. Proof that ids 9907 and 10294 are now clean — confirm both are absent from
   `/home/arm/nl-stress-v51-v3/failures.csv`:
   ```
   grep -E '^(9907|10294),' /home/arm/nl-stress-v51-v3/failures.csv
   ```
   (expect no output).
7. Proof that no other row changed unexpectedly — compare the v51-on-v2 run already taken for §7
   against this v51-on-v3 run; the only ids whose verdict may move are 9907 and 10294:
   ```
   npm run nl:stress:compare -- /home/arm/nl-stress-v51-cleaned /home/arm/nl-stress-v51-v3
   ```
   Confirm the listed movements are exactly `{9907, 10294}` from soft to clean, nothing else.

## 8. Resolution

Not yet resolved. Record actual command output, pass/fail counts, and the before/after corpus
comparison here (and in `issues.md`) once the operator runs §7 and §10, then update `IssuesIndex.md`
and add the `CHANGELOG.md` entry. Per repo precedent (ISSUE-195/197/198/199), the `CHANGELOG.md` entry
is deferred to this resolution step, not added at implementation/closeout-authoring time.
