# AFLDB-ISSUE-103 — Grid Solver `won_a_final` / `never_won_a_final` statement timeout

## Status

Resolved on 2026-08-29.

## Boundary

- Worktree: `D:\dev\afldb-issue-103`
- Branch: `codex/issue-103`
- Database for all reproduction and diagnostics: `afldb_test` only
- Normal boundary: `AFLDB_STATEMENT_TIMEOUT_MS=5000`
- Do not reopen, modify or absorb AFLDB-ISSUE-076.
- ISSUE-076 was resolved separately by `6014b9e fix: complete ISSUE-076 Grid Solver timeout repair`.
- ISSUE-076's `won_final_at_venue` repair is not the implementation template for this issue.

## Established evidence

During four complete runs of `tests/integration/grid-solver.test.ts` under
`AFLDB_STATEMENT_TIMEOUT_MS=5000`:

- 127/130 tests passed;
- three repeatable failures remained involving the untouched `won_a_final` /
  `never_won_a_final` predicates;
- ISSUE-076's own historical regression remained green at 341 ms, 361 ms, 344 ms and 357 ms;
- `won_a_final` / `never_won_a_final` code was not changed by ISSUE-076;
- no timeout increase, schema change or index change was used.

This establishes a reproducible performance symptom, not its root cause.

## Questions to answer

1. Do both predicates share one pathological SQL shape/root cause?
2. Is `never_won_a_final` expensive because it negates or anti-joins the positive logic?
3. Are there two distinct defects?
4. Does timeout require a particular second-axis criterion?

## Investigation record

### 1. Exact targeted reproduction

The current test source identifies exactly three relevant cases:

1. `every grid builder compiles and solves > solves a cell using "won_a_final" without throwing`
   - row/first axis: `won_a_final`, no params;
   - column/partner axis: `career_games_min(games=1)`;
   - order: `games_asc`;
   - production-query bind implied by the fixture: integer `1` for `c.games >= $1`.
2. `every grid builder compiles and solves > solves a cell using "never_won_a_final" without throwing`
   - row/first axis: `never_won_a_final`, no params;
   - column/partner axis: `career_games_min(games=1)`;
   - order: `games_asc`;
   - production-query bind implied by the fixture: integer `1` for `c.games >= $1`.
3. `grid solver correctness > no won_a_final player is also flagged never_won_a_final`
   - row axis: `won_a_final`, no params;
   - column axis: `never_won_a_final`, no params;
   - order: `games_asc`;
   - no predicate parameters/binds.

Focused baseline run confirmed on 2026-08-29 against the guarded test path with
`AFLDB_STATEMENT_TIMEOUT_MS=5000`:

- `won_a_final` x `career_games_min(1)`: failed in 5,106 ms with SQLSTATE `57014`;
- `never_won_a_final` x `career_games_min(1)`: failed in 5,064 ms with SQLSTATE `57014`;
- `won_a_final` x `never_won_a_final`: failed in 5,063 ms with SQLSTATE `57014`;
- focused result: 3 failed / 127 skipped; whole run 16.48 s.

The first failure's serialized Postgres.js error exposed the actual generated positive-query SQL
and bind. A subsequent guarded diagnostic captured all three production statements, binds and
regular plans. No accidental SQL execution occurred after the run; a pasted SQL excerpt was
rejected by Git Bash as shell syntax.

### 2. Current semantic contract

Established from the distinct current catalogue entries and compiler branches:

- `won_a_final`: a player has at least one `player_match_stats` participation row whose joined
  match has `is_final = true` and whose `winner_club_id` equals that participation row's
  `club_id`.
- `never_won_a_final`: there is no such winning-side finals participation row for the player. It
  does **not** require the player to have appeared in a final.
- `played_finals_no_wins` is the separate stricter contract: `c.finals > 0` plus no winning-side
  finals participation row.
- `played_in_a_final` / `never_played_finals` use the career aggregate `c.finals > 0` / `= 0` and
  are distinct from win-side participation.
- `finals_wins_min` applies the same match/participation qualification as `won_a_final`, grouped
  by player with a minimum count.

The existing explicit invariant test proves only that `won_a_final` and `never_won_a_final` must
be disjoint. The ISSUE-103 regression oracle must be independent SQL and must not call or reuse
`compileAxis`, `solveCellSummary` or the generated production predicate.

### 3. Generated SQL and environment

Captured through the actual production query path using the Postgres.js debug callback:

- `current_database()`: `afldb_test`;
- `current_user`: `afldb_owner`;
- `statement_timeout`: `5s`;
- `won_a_final` x `career_games_min(1)`: positive winning-player membership plus
  `c.games >= $1`, bind `[1]`;
- `never_won_a_final` x `career_games_min(1)`: negative winning-player membership plus
  `c.games >= $1`, bind `[1]`;
- `won_a_final` x `never_won_a_final`: positive and negative winning-player membership, no binds.

The diagnostic retained the exact SQL text and Postgres.js parameter metadata for plan comparison.

### 4. Pre-fix plan evidence

Captured on guarded `afldb_test` as `afldb_owner` with `statement_timeout = 5s`. All three actual
production SQL/bind shapes received regular `EXPLAIN` without raising the timeout:

- positive membership planned as a `Nested Loop Semi Join` over a `Materialize` node containing
  the winning-side finals participation relation;
- negative membership planned as a `Nested Loop Anti Join` over the same materialized relation;
- PostgreSQL estimated about 1,737 qualifying participation rows;
- bounded actual analysis found 14,499 winning-side participation rows and 3,618 distinct players;
- the distinct winning-player set itself completed in 14.945 ms;
- the negative predicate over a bounded 1,000-player cohort completed in 14.145 ms;
- the combined positive-plus-negative shape over the same cohort completed in 25.758 ms and
  correctly returned zero rows.

The temporary diagnostic passed 1/1 in 15.61 s; its duration includes three deliberate production
statement cancellations at the normal five-second boundary. The evidence isolates repeated
semi/anti-join scanning of a materially underestimated materialized relation, not construction of
the winner set, as the expensive shape.

### 5. Root cause

Established pre-fix: `won_a_final` compiled to `IN (SELECT ...)` and `never_won_a_final` to a
correlated `NOT EXISTS` over the same winning-side finals participation relation. In the surrounding
player/career query PostgreSQL chose nested-loop semi/anti joins with a materialized inner relation,
underestimating it by roughly 8.3x (about 1,737 planned versus 14,499 actual participation rows).
The materialized relation was then repeatedly scanned for outer players until the statement timeout.
The shared distinct set is cheap (3,618 players in 14.945 ms), so neither an index nor a timeout
increase is supported by the evidence.

### 6. Fix

Small retained repair implemented and validated: derive the distinct winning-final
player IDs as a one-time scalar-array InitPlan for each compiled predicate. `won_a_final` uses `p.id = ANY(array)` and
`never_won_a_final` uses its exact complement `NOT (p.id = ANY(array))`. The qualifying match and
participation predicates are unchanged. `player_match_stats.player_id` is schema-level `NOT NULL`,
so complement semantics are preserved, including an empty winner array. No timeout, schema, index
or data change. Related finals predicates remain untouched because their full production shapes have
not been proven defective.

Focused regression passed on 2026-08-29 against guarded `afldb_test` with
`AFLDB_STATEMENT_TIMEOUT_MS=5000`: 1 passed / 130 skipped. The regression executes all three exact
ISSUE-103 cells, requires each production call below 1,000 ms, and compares eligible counts plus
`games_asc` top players with a structurally independent base-table SQL oracle. The complete test,
including environment assertions and the oracle, took 840 ms; whole Vitest duration was 1.15 s.
No SQLSTATE `57014` or correctness failure occurred. Post-fix production-plan evidence is recorded
below and the complete Grid Solver validation supports retaining the repair.

### 6.1 Post-fix production SQL and plan evidence

Captured on 2026-08-29 through the actual `solveCellSummary` path on `afldb_test` as
`afldb_owner`, with `statement_timeout = 5s`:

- `won_a_final` x `career_games_min(1)`
  - actual predicate: `p.id = ANY (ARRAY(SELECT DISTINCT ...)) AND c.games >= $1`;
  - binds `[1]`, Postgres.js parameter types `[0]`;
  - production call 57 ms; analyzed execution 35.386 ms; planning 0.732 ms;
  - one winner-set InitPlan, loops=1; 22,439 shared-buffer hits.
- `never_won_a_final` x `career_games_min(1)`
  - actual predicate: `NOT (p.id = ANY (ARRAY(SELECT DISTINCT ...))) AND c.games >= $1`;
  - binds `[1]`, Postgres.js parameter types `[0]`;
  - production call 504 ms; analyzed execution 501.698 ms; planning 0.839 ms;
  - one winner-set InitPlan, loops=1; 52,491 shared-buffer hits.
- `won_a_final` x `never_won_a_final`
  - actual predicate contains the positive scalar-array membership and its negative complement;
  - no binds or parameter types;
  - production call 105 ms; analyzed execution 103.791 ms; planning 1.074 ms;
  - two one-time winner-set InitPlans, each loops=1; 14,940 shared-buffer hits; zero result rows.

Each InitPlan produced the same 3,618 distinct player IDs from 14,499 winning-side finals
participation rows. The estimate remains 1,737 distinct players, but the underestimate is isolated
inside a one-time InitPlan. All three analyzed plans contain InitPlan nodes and no `Nested Loop Semi
Join` or `Nested Loop Anti Join`; the pre-fix repeated materialized-inner pathology is gone. No
SQLSTATE `57014` occurred. The negative complement is the slowest at about 0.5 seconds, still a
tenfold margin below the unchanged five-second timeout and within the preferred sub-second target.

No post-fix plan contains a `Materialize` node for the winner set. Each scalar-array InitPlan builds
the distinct set once, and the outer query applies scalar-array membership rather than rescanning a
materialized winner relation.

The temporary post-fix diagnostic passed 1/1 in 1.392 s (whole Vitest duration 1.69 s) and was then
removed. It is not retained regression coverage.

### 7. Regression and validation

Focused acceptance is green: the exact problematic combinations, independent SQL oracle, normal
5000 ms timeout, absence of SQLSTATE `57014`, sub-second performance guard and post-fix plan-shape
evidence have all passed.

Complete validation on 2026-08-29 also passed against guarded `afldb_test` under the unchanged
`AFLDB_STATEMENT_TIMEOUT_MS=5000` boundary:

- Test files: 1 / 1 passed.
- Tests: 131 / 131 passed.
- Total duration: 36.97 s.
- `won_a_final` predicate smoke test: 39 ms.
- `never_won_a_final` predicate smoke test: 502 ms.
- Positive/negative disjointness test: 114 ms.
- Exact three-cell ISSUE-103 independent-oracle regression: 802 ms.
- Resolved ISSUE-076 mapped regression: 380 ms.
- No SQLSTATE `57014` and no remaining unrelated Grid Solver failures.

This complete result, together with the focused semantic oracle and post-fix plan evidence,
supports resolving ISSUE-103.

## Baseline reconciliation

The initial dedicated branch did not contain resolved ISSUE-076 commit `6014b9e`. The operator
stashed the ISSUE-103 bookkeeping, fast-forwarded to the resolved baseline, reapplied and reconciled
the bookkeeping, and verified `6014b9e` is now an ancestor. Combined state is six open issues:
ISSUE-076 remains Resolved and absent from open listings; ISSUE-103 was subsequently resolved. The resolved
ISSUE-076 implementation/regression is present and untouched by ISSUE-103.

## Change log boundary

The retained and fully validated fix is recorded under the Unreleased section of `CHANGELOG.md`.
