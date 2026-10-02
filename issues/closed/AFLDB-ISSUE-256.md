# AFLDB-ISSUE-256 — NL career rankings for unsupported metrics can pass validation and fail internally

**Status:** RESOLVED 2026-10-02. **Severity:** Low. **Opened:** 2026-10-02.
**This runbook:** created 2026-10-02 on `sonnet/issue-256-nl-career-metrics` (base `main` `6a0891c1`).
Moved to `issues/closed/` on resolution.

**Final state (2026-10-02): RESOLVED.** Implementation committed as `3e98fb7b` ("fix(nl): reject
unsupported career metrics"), merged and pushed (`main` = `origin/main` = `3e98fb7b`), deployed to DEV,
and DEV acceptance COMPLETE (§7).

**State after pass 1 (2026-10-02, historical; at the time uncommitted): IMPLEMENTED / DB-FREE
VALIDATED.** The four unsupported metrics are no longer admitted, the compiler fails closed on an
unknown or non-GRID metric, and a structural test keeps every NL metric's `statKey` inside
`GRID_STATS`. At that point it was not committed and not deployed; see §7 for the commit and DEV
acceptance.

---

## 1. Defect

An NL plan that passes `validatePlan` must be safe to execute. For four career metrics that AFLDB does
not store, that invariant did not hold:

| Metric key | Aliases that reach it (`vocab.ts` `METRIC_WORDS`) |
|---|---|
| `time_on_ground` | `tog`, `time on ground` |
| `centre_bounce_attendances` | `cba`, `centre bounce attendance(s)` |
| `disposal_efficiency` | `de`, `de%`, `disposal efficiency` |
| `score_involvements` | `si` (the full phrase is declined earlier, see §3) |

Reproduced against `main` before the fix: "most career time on ground", "most career centre bounce
attendances", "most career disposal efficiency", "most si" and "most career si" each produced a
`player_career` plan that validated, then threw a `TypeError` in
`src/db/queries/nl/player-career.ts` at `GRID_STATS[def.statKey].grain`. A hand-built club-scoped plan
for the same metrics validated too and compiled SQL against `player_match_stats` columns that do not
exist.

## 2. Root cause (confirmed from current code)

- `NL_METRICS.player_career` in `src/search/nl/plan.ts` carried one entry per metric, each with
  `statKey` `'<metric>' as any`.
- `validatePlan` admits a metric when `isNlMetric(grain, metric)` finds the key in `NL_METRICS[grain]`,
  so all four validated.
- `GRID_STATS` is typed `Record<string, …>`, so `GridStatKey` (`keyof typeof GRID_STATS`) is plain
  `string`. The type system could never reject a bogus `statKey`, with or without `as any`.
- `metricValueExpr` then dereferenced `GRID_STATS[def.statKey].grain` (undefined → `TypeError`) on the
  unscoped path, and passed the key to `sql.unsafe` as a column on the club-scoped and period-split
  paths.

None of the four is stored anywhere in AFLDB. They are not `GRID_STATS` keys, not career columns and not
`player_match_stats` columns.

## 3. Fix (pass 1)

1. **`src/search/nl/plan.ts`:** the four `player_career` entries and their `as any` escapes are removed,
   with a comment naming why. `validatePlan` now refuses all four, unscoped or club-scoped, with
   "`<metric>` is not a recognised statistic for this kind of question." `answerNlQuestion` already
   renders that as "AFLDB can’t answer this" with the reason, logged as `coverage_unavailable`.
2. **`src/db/queries/nl/player-career.ts`:** `metricValueExpr` fails closed before any branch:
   - an unknown metric throws `player_career metric "<m>" is not recognised.`;
   - a `column` entry whose `statKey` fails `isGridStatKey` throws
     `player_career metric "<m>" has no stored statistic.`
   This matches the other NL compilers' explicit `throw new Error(... is not recognised.)` idiom.
3. **No parser change.** The aliases still parse to a `player_career` plan and then fail validation
   cleanly, which the brief allows. No `UNANSWERABLE_TOPICS` wording was added; bare `de`/`si`
   abbreviations were deliberately not added there, because topic matching runs before player-name
   recognition (De Goey). The full phrase "score involvements" keeps its existing decline ("Score
   involvements and fantasy/SuperCoach points are not recorded in AFLDB.").

**Why fail-closed is correct.** AFLDB does not store these statistics, and this issue is not a request
to start (ISSUE-234 closed feed expansion as deferred). The only correct answer is a refusal. A refusal
at validation is the user-facing contract, and the compiler guard is defence in depth, so a future
metric entry cannot turn a validated plan into a 500 or into SQL against a missing column.

**`PARSER_VERSION`: unchanged (66).** The parser's output and normalisation are byte-for-byte the same:
the same questions yield the same plans. Only validation and the compiler changed.

## 4. Validation (pass 1, DB-free, Windows worktree)

Post-fix probe of the parser + `validatePlan` (scratch test, deleted):

| Question | Parse | Validation |
|---|---|---|
| most career time on ground / most career tog | `player_career.time_on_ground` max | refused |
| fewest career tog | `player_career.time_on_ground` min | refused |
| most career centre bounce attendances / most career cba | `player_career.centre_bounce_attendances` max | refused |
| top 10 career cba | `player_career.centre_bounce_attendances` top_n 10 | refused |
| most career disposal efficiency / most career de | `player_career.disposal_efficiency` max | refused |
| most career si / most si | `player_career.score_involvements` max | refused |
| most career score involvements | `unanswerable` (topic decline) | n/a |

Tests:

- `tests/nl-plan.test.ts`: new `validatePlan: unsupported career metrics (AFLDB-ISSUE-256)` block.
  - Hand-built plans for all four keys (max/min/top_n) are refused, and so are club-scoped ones.
  - None of the four is admitted at any grain.
  - Seven supported live career metrics still validate with and without club scope.
  - The structural invariant: every `statKey` in every `NL_METRICS` grain is a `GRID_STATS` key.
- `tests/nl-parser.test.ts`: new `regression: unsupported career metrics never reach an executable plan
  (AFLDB-ISSUE-256)` block.
  - The ten brief questions never yield a validated plan.
  - "most career score involvements" stays `unanswerable`.
  - Inside 50s, clearances, goal assists, frees for, frees against, contested and uncontested
    possessions still parse to `player_career` and validate.
- `tests/nl-player-career-metric-guard.test.ts` (new; no existing unit suite mocks the NL compilers):
  - `answerPlayerCareer` with `@/db/client` mocked;
  - all four keys, unscoped, club-scoped and period-split, are refused with an explicit `Error`, not a
    `TypeError`, and the key never reaches `sql.unsafe`;
  - an injected entry with each bogus `statKey` is refused as "has no stored statistic";
  - the supported metrics still compile against their own column.

Results:

- Focused: `npx vitest run tests/nl-player-career-metric-guard.test.ts tests/nl-plan.test.ts` 239/239;
  `tests/nl-parser.test.ts -t "AFLDB-ISSUE-256"` 18/18 after one test-side correction (bare
  "most career frees" is pre-existing unrecognised vocabulary, so the case uses "frees for" and "frees
  against").
- Complete NL unit suites: every `tests/nl-*.test.ts` plus `tests/query-intent.test.ts`, 23 files,
  1,710/1,710.
- `tests/unit/qualifying-matches-gate.test.ts` (imports the planner) 3/3.
- `npx tsc --noEmit` exit 0.
- `eslint` on the five touched files: 0 errors and 4 pre-existing `no-unused-vars` warnings on
  untouched lines.
- No DB-backed integration test was run. The change is planner/compiler-only and the supported
  metrics' SQL is unchanged.

## 5. Scope boundaries held

No migration, schema, storage, acquisition, AFL API or ISSUE-234 change. No DEV or PROD mutation.
`player-season.ts` was not changed. Its metrics come only from `PLAYER_STAT_METRICS`, which is
generated from `GRID_STATS`, and the new structural test now guards it as well.

## 6. Next action (pass 1, historical — all three steps are done, see §7)

1. Operator review and commit, then `merge:ready` and merge.
2. Recommended acceptance after DEV sync: ask "most career tog" on DEV. It should return "AFLDB can’t
   answer this" with the "not a recognised statistic" reason, not an error page.
3. Resolve, and move this runbook to `issues/closed/`.

## 7. Resolution (2026-10-02)

### 7.1 Implementation

- Commit `3e98fb7b` ("fix(nl): reject unsupported career metrics") on
  `sonnet/issue-256-nl-career-metrics`, merged and pushed. `main` and `origin/main` are at `3e98fb7b`.
- The implementation is exactly the pass-1 fix in §3. No code changed after the §4 validation.
- **`PARSER_VERSION` remained 66**, because parsing did not change. Only validation (`plan.ts`) and the
  compiler (`player-career.ts`) changed.
- **No new AFL API feed, statistic ingestion or storage was added.** No migration or schema change. The
  four metrics remain unstored, and the only correct answer for them is a refusal.

### 7.2 Validation evidence (DB-free, before commit; §4)

- Focused plan/guard tests (`tests/nl-player-career-metric-guard.test.ts`, `tests/nl-plan.test.ts`):
  239/239.
- Focused parser tests (`tests/nl-parser.test.ts -t "AFLDB-ISSUE-256"`): 18/18.
- Complete NL/query-intent suite (every `tests/nl-*.test.ts` plus `tests/query-intent.test.ts`, 23
  files): 1,710/1,710.
- `tests/unit/qualifying-matches-gate.test.ts`: 3/3.
- `npx tsc --noEmit`: exit 0.
- eslint on the touched files: 0 errors, 4 pre-existing `no-unused-vars` warnings on untouched lines.
- `git diff --check`: clean.

### 7.3 DEV deployment (operator-run)

- DEV HEAD `3e98fb7b25917a22ecaeb5d9f583425bbd6facb7`.
- DEV `BUILD_ID` `8S0nR-A0WsMo-kEtRyucb`.
- `afldb.service` active, `MainPID=1169477`.
- `/api/health`: `status=ok`, `database=ok`.

### 7.4 DEV acceptance smoke (operator-run): COMPLETE

- Query: `most career tog`.
- Request: public `GET /search?q=most+career+tog` on DEV.
- User-facing result, exactly:

  > AFLDB can't answer this
  > "time_on_ground" is not a recognised statistic for this kind of question.

- HTTP 200; the normal "Search | AFLDB" page with the normal feedback form.
- No application error, no `TypeError`, no `internal_error`, and no answer substituted from another
  statistic.
- The entity-search results rendered below the NL answer are the normal, unrelated fallback search
  results, not a computed NL answer.

### 7.5 NL audit evidence

- `nl_search_log` id **7618**, timestamp `2026-10-02 17:07:05.84+10`.
- `outcome=unanswerable`, `failure_reason=coverage_unavailable`, `grain=player_career`,
  `metric=time_on_ground`, `parser_version=66`. No `run_tag`, no session.
- The row was written by normal application behaviour. It is retained audit evidence and **must not be
  deleted**.

### 7.6 Service-log evidence

- No `TypeError`, no "Cannot read properties of undefined", no `internal_error`, and no ISSUE-256 error
  attributable to the smoke.

### 7.7 Post-smoke state

- The service remained active with `MainPID` 1169477.
- HEAD remained `3e98fb7b`; `BUILD_ID` remained `8S0nR-A0WsMo-kEtRyucb`.
- No tracked changes in the DEV checkout.
- All five existing DEV settle manifests remained present, with byte content, mtime and size unchanged.
  They are operational evidence and **must not be removed or modified**.

### 7.8 Outcome

- Acceptance: **COMPLETE**. Issue: **RESOLVED 2026-10-02**.
- No DEV or PROD data was mutated by this issue. PROD deployment was not part of this issue's
  acceptance.
- No follow-up issue.
- This runbook moved from `issues/open/` to `issues/closed/AFLDB-ISSUE-256.md`.
