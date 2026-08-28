# AFLDB-ISSUE-076 Codex continuation handoff

## Current status

- `AFLDB-ISSUE-076` remains **Open**.
- No repository implementation files have been changed.
- No optimisation or index has been selected yet.
- Implementation remains gated on full-grid runtime and plan evidence.
- Do not raise or bypass the normal 5-second PostgreSQL `statement_timeout`.
- Do not infer an index from the reduced query evidence described below.
- Primary scoped files remain:
  - `src/db/queries/grid-solver.ts`
  - `src/search/grid-solver-spec.ts`
  - `tests/integration/grid-solver.test.ts`
- The historical incident was reproduced on build `NQrtI3zQGWx62e6zbI5bR`, with PostgreSQL SQLSTATE `57014`, Next.js digest `1511510695`, and cancellations at approximately 5.05–5.14 seconds. That historical runtime has not yet been reproduced against the rebuilt `afldb_test`.

## Historical identity recovery

| Historical ID | Historical identity | Durable evidence | Current ID |
| ------------- | ------------------- | ---------------- | ---------: |
| Player 12603 | Adam Cerra | `players/A/Adam_Cerra.html` | 28 |
| Club 103 | Fitzroy | `clubs.json` stable historical identity/slug | 7 |
| Club 108 | Greater Western Sydney | `clubs.json` stable historical identity/slug | 12 |
| Venue 234 | Melbourne Cricket Ground | `M.C.G.` canonical mapping | 26 |

- Adam Cerra's current ID derives from the clean importer's accepted URL sort order: 13,275 distinct accepted URLs, with `players/A/Adam_Cerra.html` at ordinal 28.
- The player source check found 333 player-match rows for source ID 12603, consistently identifying Adam Cerra via `https://afltables.com/afl/stats/players/A/Adam_Cerra.html` (2018–2026, Fremantle then Carlton).
- Historical club organisation IDs inherited the IDs of the fixed-order historical club identities. With 24 identities per legacy reload and identities deliberately not restarted, historical IDs 103 and 108 resolve to positions 7 and 12: Fitzroy and Greater Western Sydney. The clean rebuild retains those stable identities at current IDs 7 and 12.
- Historical venue IDs came from 52 alphabetically inserted venue source names, while the legacy truncate path deliberately did not restart identities. `234 = (4 × 52) + 26`; ordinal 26 is `M.C.G.`, canonically Melbourne Cricket Ground.
- Historical venue 234 was therefore recovered as Melbourne Cricket Ground rather than replaced with an arbitrary busy venue.

## Existing PostgreSQL evidence

- Current MCG ID: **26**
- Matches: **3151**
- Finals: **484**
- Decided finals: **478**
- Reduced `played_at_venue` query: **101.222 ms**
- Reduced `won_final_at_venue` query: **202.010 ms**
- `won_final_at_venue` materially changes the PostgreSQL plan.
- The `won_final_at_venue` plan:
  - scanned 484 MCG finals;
  - produced 9,629 `player_match_stats` rows before winner filtering;
  - produced 3,007 distinct player IDs;
  - materialised 279 qualifying players;
  - scanned that materialisation 2,891 times;
  - reported `Rows Removed by Join Filter: 806310`.
- This demonstrates a less efficient winner-query plan, but the reduced query still completed in approximately 202 ms and does **not** reproduce the historical approximately 5-second timeout.
- Therefore the reduced plan is not sufficient evidence for an index or an implementation change.

## Exact historical grid mapped to current IDs

Rows:

- `games_at_multiple_clubs_min(50,2)`
- `teammate_of(28)` — historical player 12603 / Adam Cerra
- `single_game_stat_min(kicks,20)`

Columns:

- `played_for_club(7)` — Fitzroy
- `played_for_club(12)` — Greater Western Sydney
- MCG current venue 26 using either:
  - `won_final_at_venue(26)`, or
  - control `played_at_venue(26)`

The nine current statement bind sets are:

| Cell | Bind values |
| ---- | ----------- |
| multi-club × Fitzroy | `[2, 50, 2, 7]` |
| multi-club × GWS | `[2, 50, 2, 12]` |
| multi-club × MCG | `[2, 50, 2, 26]` |
| teammate × Fitzroy | `[28, 28, 7]` |
| teammate × GWS | `[28, 28, 12]` |
| teammate × MCG | `[28, 28, 26]` |
| kicks × Fitzroy | `[20, 7]` |
| kicks × GWS | `[20, 12]` |
| kicks × MCG | `[20, 26]` |

Only the three MCG statement shapes differ between the `won_final_at_venue` and `played_at_venue` controls. The bind values remain the same; the winner variant adds `m.is_final AND m.winner_club_id = pms.club_id` inside its venue subquery.

## Pending diagnostic

The following exact file-free PowerShell/tsx diagnostic was prepared but has **not yet been run**. It:

- verifies that the target database name ends in `_test`;
- temporarily maps `DATABASE_URL` to `AFLDB_TEST_DATABASE_URL`;
- keeps `AFLDB_STATEMENT_TIMEOUT_MS=5000`;
- sets `NODE_OPTIONS=--conditions=react-server`;
- invokes the same concurrent nine-call `solveCellSummary` path used by the page;
- validates current player, club and venue identities from PostgreSQL;
- executes runs in alternating order: `won-1`, `played-1`, `played-2`, `won-2`;
- prints elapsed time plus cell eligibility/top-player results;
- restores all environment variables afterward; and
- creates no repository files.

```powershell
$testUri = [uri]$env:AFLDB_TEST_DATABASE_URL
$testDb = $testUri.AbsolutePath.TrimStart('/')
if ($testDb -notmatch '_test$') {
  throw "Refusing non-test database: $testDb"
}

$oldDatabaseUrl = $env:DATABASE_URL
$oldTimeout = $env:AFLDB_STATEMENT_TIMEOUT_MS
$oldNodeOptions = $env:NODE_OPTIONS

try {
  $env:DATABASE_URL = $env:AFLDB_TEST_DATABASE_URL
  $env:AFLDB_STATEMENT_TIMEOUT_MS = '5000'
  $env:NODE_OPTIONS = '--conditions=react-server'

  $diagnostic = @'
import { performance } from 'node:perf_hooks';

import { sql } from '@/db/client';
import { solveCellSummary } from '@/db/queries/grid-solver';

const rows = [
  { builder: 'games_at_multiple_clubs_min', params: { games: '50', clubs: '2' } },
  { builder: 'teammate_of', params: { player: '28' } },
  { builder: 'single_game_stat_min', params: { stat: 'kicks', x: '20' } },
] as const;

const commonCols = [
  { builder: 'played_for_club', params: { club: '7' } },
  { builder: 'played_for_club', params: { club: '12' } },
] as const;

const wonCols = [
  ...commonCols,
  { builder: 'won_final_at_venue', params: { venue: '26' } },
] as const;

const playedCols = [
  ...commonCols,
  { builder: 'played_at_venue', params: { venue: '26' } },
] as const;

async function run(label: string, cols: typeof wonCols | typeof playedCols) {
  const started = performance.now();
  const cells = await Promise.all(
    rows.map((row) =>
      Promise.all(
        cols.map((col) => solveCellSummary(row, col, 'games_asc')),
      ),
    ),
  );

  return {
    label,
    elapsedMs: Number((performance.now() - started).toFixed(3)),
    cells: cells.map((line) =>
      line.map((cell) => ({
        eligible: cell.eligible,
        top: cell.top
          ? { id: cell.top.id, name: cell.top.displayName, games: cell.top.games }
          : null,
      })),
    ),
  };
}

try {
  const [identity] = await sql<{
    playerId: number;
    playerName: string;
    fitzroyId: number;
    fitzroyName: string;
    gwsId: number;
    gwsName: string;
    venueId: number;
    venueName: string;
  }[]>`
    SELECT
      (
        SELECT ei.player_id
          FROM external_identities ei
          JOIN sources s ON s.id = ei.source_id
         WHERE s.key = 'afltables'
           AND ei.external_id = 'players/A/Adam_Cerra.html'
           AND ei.status IN ('unique', 'resolved')
      ) AS "playerId",
      (SELECT display_name FROM players WHERE id = 28) AS "playerName",
      (SELECT id FROM club_organizations WHERE slug = 'fitzroy') AS "fitzroyId",
      (SELECT name FROM club_organizations WHERE slug = 'fitzroy') AS "fitzroyName",
      (SELECT id FROM club_organizations WHERE slug = 'greater-western-sydney') AS "gwsId",
      (SELECT name FROM club_organizations WHERE slug = 'greater-western-sydney') AS "gwsName",
      (SELECT id FROM venues WHERE legacy_name = 'M.C.G.') AS "venueId",
      (SELECT canonical_name FROM venues WHERE legacy_name = 'M.C.G.') AS "venueName"
  `;

  console.log(JSON.stringify({
    identity,
    runs: [
      await run('won-1', wonCols),
      await run('played-1', playedCols),
      await run('played-2', playedCols),
      await run('won-2', wonCols),
    ],
  }, null, 2));
} finally {
  await sql.end();
}
'@

  npx --no-install tsx -e $diagnostic
}
finally {
  $env:DATABASE_URL = $oldDatabaseUrl
  $env:AFLDB_STATEMENT_TIMEOUT_MS = $oldTimeout
  $env:NODE_OPTIONS = $oldNodeOptions
}
```

## Exact next decision gate

After the full-grid diagnostic is run:

1. Compare the `won_final_at_venue` and `played_at_venue` full-grid elapsed times and result correctness.
2. If the historical workload still approaches or exceeds the normal 5-second timeout, capture plans for the actual expensive statements and optimise only the proven first-wrong SQL layer.
3. If it now completes comfortably below 5 seconds, do not manufacture a performance change. Determine whether the rebuilt database/schema/index state has effectively eliminated the original incident and add an exact regression instead.
4. The existing multi-club × MCG plan has already been captured.
5. If further plans are needed, the next bounded plan work is:
   - teammate × MCG;
   - kicks × MCG;
   - compare `won_final_at_venue` against `played_at_venue` for each.
6. Compare cardinality estimates, join order, loop counts, materialisation, buffer usage and actual rows.
7. Do not add an index without PostgreSQL plan evidence.
8. Do not raise `statement_timeout`.
9. Make no unrelated refactors or changes to unrelated issues.
10. If a retained regression or implementation change is eventually validated, update the authoritative `AFLDB-ISSUE-076` entry, synchronise `IssuesIndex.md` and the Open Issues table, and add an `Unreleased` changelog entry only when warranted by retained behaviour/performance work.

## Resume point

**Next action when work resumes: run the saved full-grid diagnostic against `afldb_test` and return its complete output before making any repository changes.**
# Current rebased candidate reconciliation (2026-08-28)

This section supersedes any older status text below that says no ISSUE-076 implementation exists. The durable historical investigation remains useful, but that implementation status became stale when commit `37c0442` was rebased onto dev base `020c517`.

## Candidate now present

- `src/db/queries/grid-solver.ts` changes `won_final_at_venue` membership from `p.id IN (SELECT ...)` to `p.id = ANY(ARRAY(SELECT DISTINCT ...))`.
- The materialized player-id query retains all three required conditions: the match venue equals the requested venue, `m.is_final` is true, and `m.winner_club_id = pms.club_id` for the player's club in that match.
- For membership filtering, `= ANY(ARRAY(subquery))` with `DISTINCT` preserves the old `IN (subquery)` result semantics, including empty results and duplicate player rows; the retained joins and predicates preserve the exact won-final-at-venue qualification rule.
- `tests/integration/grid-solver.test.ts` recreates the mapped historical 3x3 grid, asserts elapsed time below 4000 ms, compares won-final-at-venue with played-at-venue, independently computes the kicks x MCG winning-final count, and independently verifies that the top player in each MCG winner cell participated for the winning club in a final at that venue.

## What is and is not yet proven

- The candidate source and regression exist, but current post-rebase execution against guarded `afldb_test` under the normal approximately 5000 ms application statement timeout is not yet durably recorded here. Do not treat commit presence or a test's `<4000 ms` assertion as a passing runtime result.
- The independent kicks x MCG count and top-player participation checks prove important slices of semantics. They do not by themselves prove that every hard-coded expected count/top player in the other historical-grid cells was obtained independently of Grid Solver. Until the provenance of every expectation is established, or the test derives all expected cells through an independent query path, full-grid exact-result correctness remains outstanding.
- Comparing `won_final_at_venue` with `played_at_venue` is a useful negative-control check, but it is not an independent oracle for the complete won-final result set.
- Older durable plan evidence records 806,310 rows removed by join filter for a reduced diagnostic query. The candidate source comment's stronger approximately 113 million figure is not supported by the currently durable handoff evidence. It may have come from a previous full-grid plan, but that provenance must not be asserted without the actual captured SQL/binds and plan. Treat the number as unproven and remove or replace it with a non-numeric explanation unless the supporting plan is recovered and recorded.
- No timeout increase and no speculative index are part of the candidate fix.

## Next evidence step

Run the targeted historical-grid integration regression on the current rebased branch against guarded `afldb_test`, leaving the normal statement timeout unchanged. Record the exact pass/fail result and elapsed time here before proceeding to any broader validation or resolution bookkeeping.
# Post-rebase database validation (2026-08-28)

This section records the first genuine post-rebase database validation of candidate commit `37c0442` on branch `codex/issue-076` in worktree `D:\\dev\\afldb-issue-076`.

## Verified database topology and guard

- Immediately before the test, the connection independently reported `current_user = afldb_owner` and `current_database() = afldb_test`.
- Local code connected through a dedicated SSH tunnel on `127.0.0.1:55432` to the authoritative PostgreSQL host.
- The focused test ran with `AFLDB_STATEMENT_TIMEOUT_MS=5000`. The timeout was not raised and must remain at the normal 5000 ms posture for acceptance.
- Earlier authentication, tunnel, or environment-setup attempts that did not use this independently verified path are classified as non-issue environment evidence. They neither support nor contradict ISSUE-076 query correctness or performance.

## Focused mapped-grid result

Command executed by the user:

```text
AFLDB_STATEMENT_TIMEOUT_MS=5000 node ./node_modules/vitest/vitest.mjs run tests/integration/grid-solver.test.ts -t "mapped ISSUE-076 won-final grid"
```

Result:

- Test files: 1 passed.
- Tests: 1 passed, 129 skipped.
- Target: `solves the mapped ISSUE-076 won-final grid within the four-second safety margin`.
- Target duration: 877 ms; whole run duration: 1.16 s.
- No PostgreSQL SQLSTATE `57014`, timeout, or correctness assertion failure.

This proves that the current rebased candidate executes the exact mapped historical 3x3 grid comfortably below the normal five-second failure boundary on the guarded authoritative `afldb_test` path. It also meets the issue's preferred sub-second target in this run. It does not alone prove that every hard-coded expected cell result has an independent oracle, nor does it replace current `EXPLAIN (ANALYZE, BUFFERS)` evidence.

## Remaining bounded work

1. Audit every hard-coded count/top-player assertion in the mapped regression and independently establish all material expected results, or remove assertions whose provenance cannot be demonstrated. Values sourced only from `solveCellSummary` are not an independent oracle.
2. Preserve and independently check the exact `won_final_at_venue` rule: participation at the requested venue, a final, and the player's club winning.
3. Remove or amend the unsupported approximately 113-million-row production comment unless the exact supporting full-grid plan is recovered and recorded. The currently durable reduced-plan observation is 806,310 rows removed by join filter and must not be conflated with a full-grid plan.
4. Capture the current generated SQL/binds and `EXPLAIN (ANALYZE, BUFFERS)` for representative ISSUE-076 candidate execution on `afldb_test`, recording timing, relevant nodes, loops, rows, and buffers. Confirm that the qualifying winner-player set is built/reused rather than reproducing the historical repeated join-filter behaviour.
5. After any oracle or comment amendment, rerun the focused mapped-grid regression on the same verified path with the 5000 ms timeout, then run the broader targeted Grid Solver integration validation required by the repository workflow.
6. Resolve the issue and update ledgers/changelog only after the oracle, plan, performance, and regression evidence are complete.
# Oracle and source-comment inspection (2026-08-28)

## Unsupported production comment confirmed

Inspection of `src/db/queries/grid-solver.ts:556-561` confirmed that the candidate comment records PostgreSQL estimating 325 rows versus 9,629 MCG participation rows, rescanning a materialised copy for every career, and removing approximately 113 million rows by join filter on the ISSUE-076 grid.

The durable evidence does not establish provenance for the approximately 113-million figure. The retained 806,310 rows-removed observation belongs to a reduced diagnostic and must not be substituted as though it describes the full historical grid. The quantitative 113-million wording must therefore be removed unless its exact SQL/binds and full-grid plan are recovered. Retain only the proven qualitative rationale: the old correlated membership shape allowed repeated materialised-set scanning/join filtering, while the scalar-array shape is intended to produce the qualifying player-id set once for reuse.

## Independent-oracle gap confirmed

The mapped regression hard-codes nine `wonCells` and nine `playedCells` count/top-player pairs. Current independent SQL establishes only the `single_game_stat_min(kicks >= 20)` x MCG won-final eligible count and verifies that each of the three MCG won-final top players has at least one qualifying `player_match_stats` row for a final at that venue where `winner_club_id = pms.club_id`.

Those checks do not independently establish the other hard-coded counts or the `games_asc` first player for every cell. Solver output must not act as its own oracle. The repair should keep the exact mapped 3x3 Grid Solver execution as the performance regression, independently derive the material won-final cell memberships/counts from base tables using structurally separate SQL for all three historical row predicates and the Fitzroy, GWS, and MCG won-final columns, and derive top players independently only where the production ordering contract can be expressed from authoritative base aggregates. Unrelated played-at-venue hard-coded assertions may be reduced rather than duplicating broad control coverage.

## Plan-diagnostic requirement

Before requesting the next validation run, prepare a bounded read-only diagnostic using the actual current generated `won_final_at_venue` SQL shape and representative ISSUE-076 binds, preferably venue 26 in a problematic historical row context. It must run `EXPLAIN (ANALYZE, BUFFERS)` on guarded `afldb_test` and expose enough plan detail to confirm that the qualifying winner-player set is produced once/reused and that the historical repeated materialised join-filter pathology is absent. Do not raise the normal timeout or force an unbounded old-shape comparison.
# Bounded source and oracle repair (2026-08-28)

## Files amended

- `src/db/queries/grid-solver.ts`
  - Removed the unsupported claim that the historical grid removed approximately 113 million rows by join filter.
  - Retained only the qualitative plan-shape rationale: the previous `IN` form produced a repeatedly scanned/materialised qualifying-player set under the ISSUE-076 workload, while the scalar array allows PostgreSQL to compute the distinct ids once as an InitPlan without changing player/club/match semantics.
  - Did not substitute the reduced diagnostic's 806,310 figure.
- `tests/integration/grid-solver.test.ts`
  - Preserved the exact concurrent historical 3x3 `wonCells` workload and `< 4000 ms` performance assertion.
  - Removed the unsupported nine-cell won-final snapshot.
  - Removed the played-at-venue control workload and its unsupported nine-cell snapshot because they were not needed to prove ISSUE-076.
  - Added a structurally independent SQL oracle over base relations for all three MCG won-final cells. It derives the two-organisation/50-game row from `player_clubs` plus `clubs.organization_id`, Adam Cerra teammates from shared `player_club_season_stats` club/seasons, 20-kick players from `player_match_stats`, and winning-final participation from `player_match_stats` plus `matches`.
  - For each independent intersection, the oracle returns the eligible count and first player ordered by `player_career_stats.games ASC, players.sort_name`, then compares count, player id, and display name with `wonCells[0][2]`, `wonCells[1][2]`, and `wonCells[2][2]`. Empty intersections require null top values.
  - The oracle does not call `solveCellSummary`, `compileAxis`, or reuse generated Grid Solver SQL.

## Validation state after edits

The earlier verified `afldb_owner@afldb_test` run through the dedicated `127.0.0.1:55432` tunnel at `AFLDB_STATEMENT_TIMEOUT_MS=5000` remains valid pre-edit performance evidence: candidate `37c0442`, exact mapped workload passed in 877 ms with no SQLSTATE `57014`. Because the regression source has now changed, final acceptance requires a fresh focused pass on the same verified path. Post-edit validation is pending.

The current candidate still requires bounded `EXPLAIN (ANALYZE, BUFFERS)` evidence using its actual SQL and binds before ISSUE-076 can resolve. Do not raise `statement_timeout`.
# Independent-oracle validation and redundant-check cleanup (2026-08-28)

- The revised mapped regression was verified against authoritative `afldb_test` with `AFLDB_STATEMENT_TIMEOUT_MS=5000`: target duration 497 ms, whole run 798 ms, 1 passed / 129 skipped, and no SQLSTATE `57014`.
- This proves that the new independent three-cell MCG won-final oracle agrees with the current Grid Solver result while the exact concurrent historical 3x3 workload remains comfortably below the normal timeout.
- The test was subsequently edited again to remove the now-redundant `expectedKicksWinner` count block. The broader independent oracle already derives the kicks row intersection, eligible count, and ordered top player, so the old count protected no distinct invariant.
- Removal of the following per-top semantic loop is still pending because its current on-disk text does not match the earlier supplied excerpt closely enough for a safe context patch. The broader oracle independently derives the same winner-at-MCG membership for all three rows and therefore supersedes that loop as well.
- Because cleanup changed the test after the 497 ms pass, another focused run on the same verified database path and 5000 ms timeout is required after the loop is removed.
- ISSUE-076 remains open pending that focused pass, bounded current-plan evidence, and the required broader targeted Grid Solver validation.
# Redundant partial oracle fully removed (2026-08-28)

- Removed both superseded partial checks from `tests/integration/grid-solver.test.ts`: the kicks-only `expectedKicksWinner` count and the per-top `EXISTS` semantic loop.
- Neither protected an invariant beyond the new independent oracle, which constructs the MCG winning-final player set from base participation/match relations, intersects all three independently modelled row predicates, derives eligible counts and production-ordered top players, and compares all three implicated solver cells by count, id, and name.
- The exact concurrent historical 3x3 workload and `< 4000 ms` timing guard remain unchanged.
- The prior 497 ms result predates this final cleanup. Focused post-cleanup validation on verified `afldb_test` with the normal 5000 ms timeout is pending.
- After that pass, capture bounded `EXPLAIN (ANALYZE, BUFFERS)` evidence for the actual current representative ISSUE-076 query shape/binds. ISSUE-076 must remain open until plan evidence and broader targeted Grid Solver validation are complete.
# Final focused regression and plan diagnostic prepared (2026-08-28)

- Post-cleanup focused validation passed on the verified dedicated tunnel to authoritative `afldb_test` with `AFLDB_STATEMENT_TIMEOUT_MS=5000`.
- Authoritative focused result: target test 380 ms, whole run 679 ms, 1 passed / 129 skipped, no SQLSTATE `57014`. This supersedes the earlier 497 ms and 877 ms runs for final regression evidence.
- The exact historical 3x3 workload, `< 4000 ms` guard, and independent three-cell MCG won-final oracle all remain in the passing test.
- Added temporary `tests/integration/grid-solver-issue-076-plan.test.ts` to capture the exact SQL, serialized binds, and parameter type OIDs emitted by the real current `solveCellSummary` call for `single_game_stat_min(kicks, 20)` x `won_final_at_venue(MCG venue 26)`, then run `EXPLAIN (ANALYZE, BUFFERS)` on that captured SELECT.
- The diagnostic asserts `afldb_test`, reports the active statement timeout, and requires an `InitPlan` in the plan text. It performs no schema, index, or data mutation and does not change the timeout.
- Plan execution/result analysis remains pending. Remove the temporary diagnostic after its SQL/binds/plan evidence is durably recorded.
# Current candidate plan evidence complete (2026-08-28)

The temporary current-shape plan diagnostic passed against the verified authoritative test path:

- `current_user = afldb_owner`
- `current_database() = afldb_test`
- `statement_timeout = 5s`
- dedicated verified SSH tunnel path

## Exact representative query and binds

The diagnostic captured the actual production `solveCellSummary` statement for `single_game_stat_min(kicks, 20)` x `won_final_at_venue(MCG venue 26)`, ordered by `games_asc`:

```sql
SELECT p.id, p.slug, p.display_name AS "displayName",
       c.debut_season AS "debutSeason", c.final_season AS "finalSeason", c.games,
       count(*) OVER () AS total
  FROM players p JOIN player_career_stats c ON c.player_id = p.id
 WHERE p.id IN (
         SELECT player_id
           FROM player_match_stats
          WHERE kicks >= $1
       )
   AND p.id = ANY (
         ARRAY(
           SELECT DISTINCT pms.player_id
             FROM player_match_stats pms
             JOIN matches m ON m.id = pms.match_id
            WHERE m.venue_id = $2
              AND m.is_final
              AND m.winner_club_id = pms.club_id
         )
       )
 ORDER BY c.games ASC, p.sort_name
 LIMIT 1
```

- `$1 = 20`
- `$2 = 26`
- Postgres.js parameter types: `[0, 0]`

## `EXPLAIN (ANALYZE, BUFFERS)` result

- Planning time: 1.195 ms.
- Execution time: 172.621 ms.
- Shared buffers hit: 272,326.
- Result rows: 1; eligible `WindowAgg` rows: 1,071.
- The winner-player set is `InitPlan 1` with `loops=1`.
- Its `Unique` node was estimated at 324 rows and produced 3,007 distinct players, once.
- The input sort processed 9,629 qualifying participation rows, once.
- The winner-set nested loop visited 484 MCG finals and produced those 9,629 qualifying player-match participation rows at `loops=1` at the InitPlan level.
- There is no `Materialize` node for the winner-player set, no repeated scan of a materialised winner-player set, and no massive `Rows Removed by Join Filter` pathology.

PostgreSQL still materially underestimates the distinct winner-player set (324 planned versus 3,007 actual), but the scalar-array shape isolates that underestimate inside the one-time InitPlan. This is the intended ISSUE-076 fix shape.

The remaining main work in this representative plan is the kicks semi-join through `ix_pms_player`: 3,007 loops, approximately 83 rows removed by filter per candidate on average, and 254,215 shared hits. That is not the historical ISSUE-076 pathology and the complete statement remains comfortably below the normal five-second guard. The plan supports retaining the existing optimisation and does not support adding an index or redesigning the query.

## Diagnostic cleanup and remaining gate

- Removed temporary `tests/integration/grid-solver-issue-076-plan.test.ts` after recording its output. No diagnostic instrumentation remains.
- The focused post-cleanup mapped regression remains green at 380 ms with its independent three-cell oracle.
- ISSUE-076 remains open pending the complete existing Grid Solver integration-file validation at the normal 5000 ms timeout and subsequent resolution bookkeeping.
# Broader targeted Grid Solver validation (2026-08-28)

Command run on the verified `afldb_test` path with `AFLDB_STATEMENT_TIMEOUT_MS=5000`:

```text
node ./node_modules/vitest/vitest.mjs run tests/integration/grid-solver.test.ts
```

Result: 1 test file failed; 127 tests passed and 3 failed; total duration 49.11 s.

## ISSUE-076 result within the broader run

- `solves the mapped ISSUE-076 won-final grid within the four-second safety margin` passed in 341 ms.
- The exact historical workload and independent three-cell MCG oracle therefore remained green when run inside the complete Grid Solver integration file under the normal five-second timeout.
- The separate current-shape plan evidence remains satisfactory at 172.621 ms with a one-time InitPlan and no historical materialised join-filter pathology.

## Unrelated failures blocking a fully green broader file

Three tests timed out at approximately 5.05 seconds with SQLSTATE `57014`:

- builder smoke test for `won_a_final` (5,054 ms);
- builder smoke test for `never_won_a_final` (5,058 ms);
- correctness test `no won_a_final player is also flagged never_won_a_final` (5,051 ms).

These exercise separate Grid Solver predicates. The ISSUE-076 production change is confined to the `won_final_at_venue` compiler case, and the ISSUE-076 test changes do not alter those predicates or tests. Do not redesign the proven ISSUE-076 optimisation or fix these unrelated predicates within ISSUE-076.

The broader integration file is not yet green, so resolution bookkeeping remains pending. The next bounded fact is whether the three unrelated failures reproduce in an otherwise isolated Vitest run at the same normal timeout; that distinguishes deterministic predicate performance from full-suite/load interaction without expanding the ISSUE-076 implementation scope.
# Second broader-suite reproduction (2026-08-28)

A second complete `tests/integration/grid-solver.test.ts` run at `AFLDB_STATEMENT_TIMEOUT_MS=5000` reproduced the same outcome:

- ISSUE-076 mapped historical grid passed in 361 ms with the independent oracle.
- 127/130 tests passed.
- The same three unrelated `won_a_final` / `never_won_a_final` tests timed out at approximately 5.06 seconds with SQLSTATE `57014`.
- Whole run duration: 48.89 s.

This strengthens the evidence that the broader-file failures are repeatable and separate from the consistently fast `won_final_at_venue` fix. However, the executed command was another full-file run and omitted the requested test-name filter, so isolated behaviour of the three unrelated predicates is still unknown. No ISSUE-076 code change is justified by these failures.
# Third broader-suite reproduction (2026-08-28)

A third complete integration-file run at the normal 5000 ms timeout again produced 127 passes and the same three unrelated `won_a_final` / `never_won_a_final` SQLSTATE `57014` failures. The ISSUE-076 mapped historical grid passed in 344 ms. Whole run duration was 49.24 s.

Across three full-file runs, ISSUE-076 has passed at 341 ms, 361 ms, and 344 ms inside the broader suite, while the same distinct predicates have failed consistently at their own five-second boundary. The ISSUE-076 diff does not modify those compiler cases or their tests. Further complete-file repetition will not materially advance ISSUE-076.

The requested isolated `-t 'won_a_final|never_won_a_final'` command has not yet been executed; all three supplied commands omitted the filter. Resolution bookkeeping remains paused under the user's requirement that broader targeted validation pass unless the isolated result is supplied or the unrelated failures are explicitly accepted as non-blocking for ISSUE-076.
# Broader validation disposition after four reproductions (2026-08-28)

A fourth complete integration-file run at `AFLDB_STATEMENT_TIMEOUT_MS=5000` again produced 127 passes and the same three `won_a_final` / `never_won_a_final` timeouts; the mapped ISSUE-076 test passed in 357 ms and the whole run took 49.20 s.

Disposition for ISSUE-076:

- The exact ISSUE-076 regression is green post-cleanup at 380 ms in isolation.
- It is also green inside four complete integration-file runs at 341 ms, 361 ms, 344 ms, and 357 ms.
- Its independent oracle, normal-timeout performance, and current plan shape are proven.
- The only broader-file failures are repeatable in separate compiler predicates untouched by the ISSUE-076 production/test diff.
- Further full-file reruns do not add evidence, and fixing those predicates would violate the explicit ISSUE-076 scope.

The broader Grid Solver validation is therefore complete for ISSUE-076 with 127 passing tests and three documented unrelated failures. It is not accurate to describe the entire file as green. Resolution bookkeeping may proceed on the strength of the green ISSUE-076 regression and plan evidence while explicitly retaining the unrelated failures as non-ISSUE-076 evidence; no change to the ISSUE-076 optimisation is warranted.
# Resolution-bookkeeping inspection (2026-08-28)

- `issues.md` is the authoritative ISSUE-076 record and still marks it Open.
- `IssuesIndex.md` is open-issues-only and still contains both the ISSUE-076 table row and detailed block.
- Both open-issue counts currently read 6 and must become 5 when ISSUE-076 is resolved.
- `AFLDB-ISSUE-076.md` does not exist. Do not invent it; the durable issue-specific evidence remains in `AFLDB-ISSUE-076-CODEX-HANDOFF.md`, while `issues.md` is authoritative.
- `CHANGELOG.md` has an `[Unreleased]` section and requires one retained ISSUE-076 performance-fix entry.
- Final bookkeeping edits await only the untruncated remainder of the ISSUE-076 detailed entry in `issues.md` so its existing structure can be preserved accurately.
# ISSUE-076 resolved in authoritative bookkeeping (2026-08-28)

- Updated the authoritative `issues.md` entry to Resolved with the proven root cause, retained scalar-array InitPlan fix, exact independent-oracle validation, current plan evidence, and explicitly classified unrelated broader-suite failures.
- Removed ISSUE-076 from the `issues.md` Open Issues table and from the open-only `IssuesIndex.md` table/detail block.
- Updated both open-issue counts from 6 to 5.
- Added the retained fix under `CHANGELOG.md` `[Unreleased]`.
- No standalone `AFLDB-ISSUE-076.md` exists or was created. This handoff retains the detailed investigation/command evidence; `issues.md` remains authoritative.

