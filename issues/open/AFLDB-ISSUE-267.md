# AFLDB-ISSUE-267 — Override replay writes NULL period scores from a partial `score` override

## 0. Status

- **Status:** Open (2026-10-08). **Implemented 2026-10-09 together with AFLDB-ISSUE-269 (worktree
  `D:\dev\afldb-issue-267-269`, branch `sonnet/issue-267-269`, base `259ee7c6`); uncommitted. Implementation validated
  on `afldb_test` 2026-10-09 (second fix pass: 6/6 integration cases passed, operator-run, §17.10).** Not committed,
  merged or deployed. **DEV exposure census complete 2026-10-09** (operator-run, before deployment: 0 active `matches`
  overrides, no rows in any section, no replay blockers; §17.11); the PROD census has not run. Historical corruption
  is not established; historical impact remains unassessed, and nothing was repaired. See §17.
- **Severity:** High. **Area:** data integrity / admin override replay (rebuild, reload, promotion).
- **Key file:** `tools/migration/common.py` (`replay_admin_overrides`, matches branch).
- **Origin:** full code review at `20a7a4bbdea835cdd3fc5520e65ad47d275bd881` (`issues/reviews/2026-10-08-full-code-review.md`, F-002; partition note R3-F02). The orchestrator re-read the cited lines and confirmed them.
- **Classification:** code-proven.
- **Provenance of this file.** §0–§16 were written by the 2026-10-08 review and were uncommitted in the review worktree
  (`D:\dev\afldb-review-20261008`). They were brought into this branch unchanged except for this §0 status, as
  AFLDB-ISSUE-266 was. Line numbers in §2–§9 refer to `20a7a4bb`.

## 1. Summary

When the `matches` replay re-applies a Data Editor `score` override, it also writes the final-period row of `match_period_scores` for both clubs from the override payload. The Data Editor stores only the fields that changed, so a typical `score` payload is partial (for example `{"home_goals": 12}`). The replay casts the absent fields to NULL and upserts them, which overwrites the recorded final-period goals, behinds and points with NULL.

## 2. Evidence

- `tools/migration/common.py:1911-1931`:
  - The period CTE reads `(o.override_values->>'home_behinds')::int` etc. straight from the payload (NULL when absent).
  - `INSERT … ON CONFLICT DO UPDATE SET goals = EXCLUDED.goals, behinds = …, points = …` runs for both clubs.
- `src/db/queries/data-edits.ts:240-245`: the override payload records only fields whose value changed.
- `src/db/migrations/003_matches.sql:92-94`: `match_period_scores.goals/behinds/points` are nullable, so nothing raises.
- Contrast: the first UPDATE of the same branch COALESCEs payload with `m.*` (`common.py:1882-1885`), and the TypeScript editor path writes complete values (`data-edits.ts:402-461`).

## 3. Trigger

1. A Data Editor score edit changes fewer than all four components (home goals, home behinds, away goals, away behinds).
2. Then any of the following runs:
   - a `matches` reload (`tools/migration/import_fitzroy_core.py:3618`);
   - a rebuild that replays `matches`;
   - the post-swap promotion replay (`docs/production-promotion.md` §8 step 1, `:1366-1372`, which includes `'matches'`).

## 4. Expected invariant

- A replay reproduces the state the human edit left: the match's final-period rows equal its corrected totals.
- A recorded figure never becomes "not recorded" (NULL-vs-zero rule, in the opposite direction).

## 5. Actual behaviour

With only `home_goals` present:
- the home final-period row becomes `goals = N, behinds = NULL, points = NULL`;
- the away row becomes all NULL.

Source cumulative figures are destroyed silently, with no refusal, report or audit.

## 6. First wrong layer

`tools/migration/common.py:1911-1931` (the period-score CTE reads the raw payload rather than the already-updated `matches` row).

## 7. Impact

- `match_period_scores` is corrupted on every rebuild or promotion for every match carrying a partial `score` override.
- Quarter-checkpoint answers (NL period queries, match pages) then lose data.
- The damage reaches PROD at promotion step §8.1. The pre-swap predictor `planPromotionMatchReplay` (`tools/db/promotion-inventory.ts:4435-4462`) checks only that each override key resolves, not the payload shape (R6b decision on hypothesis H1).

## 8. Reproduction / witness

Not executed. The behaviour turns on PostgreSQL NULL-cast and upsert semantics, so a DB-free witness cannot show it. The integration case in §14 decides it.

## 9. Disproof attempts

- A complete payload occurs only if all four components change in one save. Later saves merge into the existing payload but do not add unchanged fields.
- No NOT NULL constraint fails closed.
- `rebuild_derived.py` does not recompute `match_period_scores` (they are source facts).

## 10. Existing-issue search

- `issues.md` was searched for `replay_admin_overrides(matches)`, `match_period_scores` near `replay`, and `arbitrar`. Only the ISSUE-224 players-branch fix was found.
- Classification: **new**. It shares a function and fix window with AFLDB-ISSUE-269; ISSUE-022 fixed the live editor's final-period sync.

## 11. Scope

The period-score injection in the `matches` replay branch.

## 12. Out of scope

Choosing which override row applies when a match has several (AFLDB-ISSUE-269).

## 13. Proposed fix boundary

After the first UPDATE, compute the final-period rows from `m.home_goals / m.home_behinds / m.away_goals / m.away_behinds` (points derived), or COALESCE the payload with `m.*`. Python only.

## 14. Proposed validation

1. Integration (afldb_test, operator-run), in `tests/integration/data-editor.test.ts`:
   1. save a one-field `score` edit;
   2. run `replay_admin_overrides(conn, 'matches')`;
   3. assert both final-period rows equal the match totals and none is NULL.
2. Read-only census (operator-run): count active `matches`/`score` overrides whose payload lacks any of the four keys. This measures exposure.

## 15. Decisions / unresolved questions

- Whether a historical rebuild or promotion has already written NULL period rows. This needs the census in §14 on `afldb_dev` / PROD.

## 16. Next action

Fix together with AFLDB-ISSUE-269 (same function), then the integration case. Run the census before the next promotion.

## 17. Implementation (2026-10-09, with AFLDB-ISSUE-269; uncommitted, not database-validated)

### 17.1 What was inspected first

- The `players` replay merge and its equal-authority refusal (`common.py`, AFLDB-ISSUE-224 §21.3.2): rows merged per
  key with `jsonb_each` + `DISTINCT ON`; a field claimed by two same-authority rows with different values raises
  `RuntimeError` before any write.
- The live Data Editor score path (`applyMatchEdit`, `src/db/queries/data-edits.ts`): it writes all four components,
  derives `home_score = 6g + b` (and away), `result`, `winner_club_id` and `margin`, then upserts both clubs'
  final-period rows with `points = 6g + b`, where the final period is `GREATEST(COALESCE(max(period), 4), 4)`.
- `src/lib/edit/spec.ts`: the matches field groups are disjoint (`attendance`, `score`, `match_time`, `match_event`,
  `notes`), and the four score fields are `nullable: false` in the editor.
- Migrations 003 and 022: the four score components are NULLable on `matches` (an early match may not record its
  breakdown; the total stands alone); `home_score`, `away_score` and `margin` are NOT NULL.

### 17.2 Change (`tools/migration/common.py`, matches branch only)

In order, all on the caller's connection and transaction (the function does not commit):

1. **Refusal 1, equal-authority disagreement (read-only).** Over every active `matches` row whose key resolves to a
   match, `jsonb_each` per field; a field with more than one distinct value for one match raises
   `RuntimeError("replay_admin_overrides(matches): refusing to commit, N field(s) are claimed by equal-authority
   overrides that disagree: match <key> field '<f>' -- <group>=<value>, …")`. Every matches row has the same
   authority (all are keyed by `match_key`; there is no creation record to rank), so there is no precedence to apply.
2. **Refusal 2, underivable score (read-only).** For each match with an active `score` row (the unchanged rule), if any
   of the four components is NULL after the merge (the source does not record it and no override supplies it), it
   raises `RuntimeError("… lack a score component the override does not supply: match <key> -- <components>")`.
   Nothing is converted to zero. **Not a new refusal (verified 2026-10-09, §17.8):** the old code failed on the same
   state, as a NOT NULL violation from its derived-score UPDATE; the refusal names it instead, before any write.
3. **Merged UPDATE.** A `merged_overrides` CTE builds ONE object per `match_key` from every active row
   (`DISTINCT ON (entity_key, key) … ORDER BY entity_key, key, field_group`, then `jsonb_object_agg`). After refusal 1,
   the ordering only chooses between identical values, so it is deterministic and never decides a disagreement.
   Inactive rows never contribute. The per-field SET expressions are unchanged (score components COALESCE with the
   loaded value; `attendance`/`match_time`/`match_event`/`notes` honour an explicit JSON null via `jsonb_exists`).
4. **Derived fields** (`home_score`, `away_score`, `margin`, `result`, `winner_club_id`): the existing statement,
   unchanged, now running over the merged values, for the same set of matches (active `score` row).
5. **Final-period sync (ISSUE-267).** For the same set, both clubs' final-period rows are upserted from the UPDATED
   `matches` row: `goals = m.*_goals`, `behinds = m.*_behinds`, `points = 6·goals + behinds` (the editor's
   derivation). The final period rule is unchanged. The payload is no longer read here, so a partial payload cannot
   write NULL over a recorded figure.

Nothing outside this branch changed: no `match_coaches`, promotion predictor, migration or historical repair.

### 17.3 Tests (`tests/integration/data-editor.test.ts`, new final `describe`)

`AFLDB-ISSUE-267/269: the matches override replay merges every active row and syncs the final period`, **six
cases**, `it.runIf(canReplay)` (registered only when the chosen Python can `import psycopg`, as the ISSUE-257 F-S9-03
suite does). A skip is never silent: the probe's failure (missing interpreter, non-zero exit, 30 s timeout) is
printed as `AFLDB-ISSUE-267/269 replay cases SKIPPED: …`.

- **Fixture.** Synthetic, committed, season 2081, keys `2081|issue267-*`: one match, source 15.10 (100) v 12.8 (80),
  cumulative Q1–Q4 rows for both clubs. The file-level historical-row guard still runs.
- **Ownership (review fix, 2026-10-09).** `beforeAll` runs a read-only preflight FIRST and deletes nothing: any season
  2081 row, season-2081 or `2081|issue267-*` match, season-2081 `club_seasons` row, `2081|issue267-*` override, or
  matches edit noted `issue-267 replay` is foreign state (another suite, real data, or a crashed run's residue) and
  fails the suite with the counts. Until it passes, seeding throws and every cleanup hook is a no-op. Cleanup then
  deletes only what the run recorded creating: its match ids and keys (and their overrides, edits and period rows),
  and the season row only when the run's own `INSERT … ON CONFLICT DO NOTHING RETURNING` created it. `club_seasons`
  is never deleted (nothing here creates it), and "no match of the season remains" is never read as ownership. A
  residue assertion (`data_overrides`, `data_edits`, `match_period_scores`, `club_seasons`, `matches`, `seasons`) runs
  in `afterAll` only after a passed preflight.
- **Bounded subprocesses (review fix).** Probe: 30 s process timeout. Replay: `connect_timeout=10`, then
  `SET LOCAL lock_timeout = '5s'` and `SET LOCAL statement_timeout = '30s'` on the transaction both passes share
  (nothing commits), and a 90 s process timeout (`SIGKILL`) inside the 120 s test timeout. A database error, timeouts
  included, is caught, the transaction rolled back and the connection closed, and reported as
  `REPLAY267_ERROR {type, sqlstate, message}`; the test throws with the limits named. A killed process cannot roll
  back itself; the server aborts its uncommitted transaction when the connection drops, and the error says so.
- **Transaction boundary.** The Python replay is database-wide (every active matches override, every score-overridden
  match). The Python helper therefore never commits: on ONE connection it snapshots the fixture, runs the REAL
  `replay_admin_overrides(conn, "matches")` twice (snapshot after each), and ROLLS BACK. No real match is changed.
  Fixtures are committed before Python starts because a separate connection cannot see an uncommitted TypeScript
  transaction. A foreign active override in `afldb_test` that the fixed replay refuses would also make these cases
  refuse; the refusal text names it.
- **Reload simulation.** After a real `saveEdit`, the fixture is reset (committed) to its source values and source
  period rows, the state a `matches` reload leaves before it replays.

| Case | What it asserts | How the original code fails it |
|---|---|---|
| one-field score edit | `saveEdit` stores `{home_goals: 16}` only; after replay: 16.10 (106) v 12.8 (80), margin 26; Q1–Q3 unchanged; Q4 home `[16, 10, 106]`, away `[12, 8, 80]` | Q4 becomes home `[16, NULL, NULL]` and away `[NULL, NULL, NULL]` (ISSUE-267) |
| attendance + partial score | payloads `{attendance: 45000}` and `{away_goals: 16}`; after replay: attendance 45000 / `complete` / `manual_admin_edit`; 15.10 (100) v 16.8 (104), `away_win`, winner away, margin 4; Q4 matches the totals | `UPDATE … FROM` applies one row: either attendance is lost, or the score stays at source while Q4 gets `[NULL…]`/`[16, NULL, NULL]` (ISSUE-269 + 267) |
| equal-authority conflict | rows `score {home_goals: 16}` and `attendance {attendance: 45000, home_goals: 17}`: refused, message names the key and `'home_goals'`; the snapshot taken in the SAME transaction after the refusal equals the one before (nothing, not even the agreeing attendance, was written) | no refusal: an arbitrary row wins |
| identical overlap + inactive | `home_goals: 16` in two active rows merges; an inactive `notes` row that disagrees (`home_goals: 3`) neither contributes nor triggers a refusal | Q4 written from the payload (NULLs); one of the two active rows dropped |
| unrecorded component | source `home_behinds` NULL, override `{home_goals: 16}`: census section 4 lists it with `missing = home_behinds`; refused naming `home_behinds`, nothing written, NULL stays NULL (not 0) | psycopg NotNullViolation, not a refusal; the case fails on the exit status |
| component from another group | source `home_behinds` NULL, `score {home_goals: 16}`, active `attendance {attendance: 45000, home_behinds: 11}`: census section 4 does NOT list it; replay succeeds: 16.11 (107) v 12.8 (80), margin 27, attendance 45000; Q1–Q3 keep their NULL home behinds; Q4 equals the totals | `UPDATE … FROM` applies one row: the `score` row leaves `home_behinds` NULL (NotNullViolation), the `attendance` row leaves `home_goals` at 15. The previous census section 4 (score row only) listed this match as underivable |

Census section 4 is read from the census file itself (between its `== 4.` and `== 5.` markers) and run as written,
so the census and the Python preflight cannot drift apart unnoticed.

Every successful case also asserts that the second replay leaves exactly the state of the first (idempotence).
The idempotence and inactive-row assertions are regression guards; the original code also excluded inactive rows.

### 17.4 Checks run in this session (2026-10-09)

- `python -c "import ast; ast.parse(…common.py…)"`: **OK** (syntax only; Python 3 on the workstation).
- The test's embedded Python snippet, transcribed to the session scratchpad: `ast.parse` **OK** (syntax only).
- **Not run:** TypeScript typecheck and every vitest suite. This worktree has no `node_modules` and no `.venv`, and
  installing them was not authorised. No database, SQL, Git, deployment or test command was run.
- **Process note.** One read-only shell command (`wc -l` on the test file) was run in this session before native
  tools were used, contrary to CLAUDE.md §9. It changed nothing.

**Review-fix pass (2026-10-09, second session; the user authorised syntax checks, typecheck and the source-contract
suite, and nothing touching a database):**

- `python -m py_compile tools/migration/common.py`: **OK**.
- The replay helper's embedded Python, rebuilt from the test source with the same join and constants (scratchpad
  script) and `ast.parse`d: **OK**.
- `npx tsc --noEmit -p .`: **exit 0** (`tests/integration/data-editor.test.ts` is in the program; `node_modules` is now
  present in this worktree).
- `npx vitest run tests/data-overrides-source-contract.test.ts`: **69/69 passed**.
- **Not run:** the integration describe and the census (no database command was authorised). Read-only `git diff`
  of the branch's own files was used for inspection.

### 17.5 Operator validation (DB steps not run yet)

From `D:\dev\afldb-issue-267-269` in PowerShell (`node_modules` is present; there is still no `.venv`):

1. DB-free (already green in the review-fix pass; repeat only after further edits): `npx tsc --noEmit -p .` and
   `npx vitest run tests/data-overrides-source-contract.test.ts`.
2. Integration, on the `_test` database only, with a Python that has `psycopg` (this worktree has no `.venv`):

   ```powershell
   $env:AFLDB_TEST_DATABASE_URL = '<afldb_test DSN>'
   $env:AFLDB_PYTHON = '<path to a python.exe with psycopg>'
   npx vitest run tests/integration/data-editor.test.ts -t "AFLDB-ISSUE-267/269"
   ```

   Expected: **6 passed** (not skipped: a skip prints `AFLDB-ISSUE-267/269 replay cases SKIPPED: …` with the probe's
   reason), the describe's residue assertion and the file's historical-row guard pass. A preflight failure listing
   non-zero counts means season 2081 / `2081|issue267-*` already holds state: nothing was deleted; inspect it before
   removing anything. A `REPLAY267_ERROR` names the SQLSTATE (`55P03` lock timeout, `57014` statement timeout).
   Report failures with the vitest output; do not weaken an assertion.
3. Red/green (optional, recommended): with only the test file applied over `259ee7c6`'s `common.py`, cases 1–4 and 6
   should fail as the table in §17.3 says and case 5 on the exit status. Reasoned, not observed.
4. Exposure census, read-only: `issues/open/AFLDB-ISSUE-267-269-override-census.sql`. DEV (`psql` lives on the
   server; single quotes keep PowerShell from expanding `$…` locally):

   ```powershell
   scp D:\dev\afldb-issue-267-269\issues\open\AFLDB-ISSUE-267-269-override-census.sql dev:/tmp/issue267-census.sql
   ssh dev 'cd ~/projects/afldb && set -a && . ./.env && set +a && psql $AFLDB_IMPORT_DATABASE_URL -X -v ON_ERROR_STOP=1 -f /tmp/issue267-census.sql; echo psql exit status: $?; rm /tmp/issue267-census.sql'
   ```

   Section 0 must show `database = afldb_dev` and `transaction_read_only = on`; the last lines must be `== Done.` and
   `psql exit status: 0`. PROD, only if the operator chooses, with the ISSUE-265 §16.2 pattern (`scp` to
   `afldb:/tmp/issue267-census.sql`, `ssh -t afldb`, then on the host
   `sudo -u postgres psql -X -v ON_ERROR_STOP=1 -d afldb_prod -f - < /tmp/issue267-census.sql`, then remove the file).
   Sections: (1) partial `score` overrides (ISSUE-267 exposure); (2) keys with more than one active row (ISSUE-269
   exposure); (3) and (4) states on which the FIXED replay would refuse, which would stop a reload, rebuild or the
   post-swap promotion replay; (5) final-period rows that disagree with match totals (symptom only).
   **Exposure is not damage.** Sections 1–2 show what the unfixed code would mis-apply on its next run, not what a past
   run did; section 5 can show a legitimate "not recorded" NULL or a mismatch with another cause. Section 4 evaluates
   exactly what the fixed replay's underivable-score preflight evaluates (every active row merged, then
   `COALESCE(override, source)` per component), so a component supplied by any active group counts; section 3 still
   reports disagreements separately.

### 17.6 Remaining before resolution

1. ~~The operator recovers the failed run's residue (§17.9.4), then runs §17.5 step 2 and it passes (6/6 on
   `afldb_test`).~~ **Done 2026-10-09 (§17.10):** the fixture namespace was confirmed empty by a fresh read-only
   census. What removed the earlier residue is unknown. The second-pass run passed 6/6. The first run, 2026-10-09, FAILED (§17.9.1).
2. Operator review and commit (explicit paths, §17.7), `merge:ready`, merge and push.
3. ~~The census on DEV~~ **DEV done 2026-10-09 (§17.11): no rows in any section.** PROD before the next promotion
   remains. Any section-3/4 row must be resolved (deactivate or correct
   the override) before a promotion, because the fixed replay refuses it post-swap; the pre-swap predictor
   `planPromotionMatchReplay` does not check it (out of scope here; a follow-up if the census finds rows).
4. Whether a past rebuild or promotion already wrote NULL final-period rows is unanswered (§15). The census measures
   exposure only; any historical repair is a separate, operator-decided action.
5. DEV deployment is a tooling change only (the next reload/rebuild uses it); acceptance is the census plus a green
   integration run unless the operator asks for more.

### 17.7 Files (uncommitted)

Ten paths, to be staged explicitly:

- `CHANGELOG.md` — the Unreleased entry.
- `IssuesIndex.md` — the index entries.
- `issues.md` — ledger entries and the Open Issues table.
- `tools/migration/common.py` — matches replay branch (merge, two refusals, final-period sync from the updated row).
- `tests/integration/data-editor.test.ts` — the new describe and its fixture helpers.
- `issues/open/AFLDB-ISSUE-267.md` — this runbook (new in this branch).
- `issues/open/AFLDB-ISSUE-269.md` — the ISSUE-269 runbook (new in this branch).
- `issues/open/AFLDB-ISSUE-267-269-override-census.sql` — the read-only override census.
- `issues/open/AFLDB-ISSUE-267-269-fixture-residue-census.sql` — the read-only residue census (§17.9.4).
- `issues/open/AFLDB-ISSUE-267-269-fixture-residue-recovery.sql` — the guarded residue recovery (§17.9.4).
- **Merge note.** The review worktree still holds uncommitted copies of both runbooks and its own `issues.md` /
  `IssuesIndex.md` entries for 267 and 269. When the review deliverables are committed, keep this branch's versions
  of these two runbooks and entries (they are the review text plus §0 and §17).

### 17.8 Schema evidence: the old replay already rejected a missing score component (verified 2026-10-09)

The claim in §17.2 refusal 2 was checked against the original branch (`git show HEAD:tools/migration/common.py`,
lines 1864–1929 at `259ee7c6`) and every migration touching `matches`. It holds.

- **Columns** (`src/db/migrations/003_matches.sql:43-52`): `home_goals`, `home_behinds`, `away_goals`, `away_behinds`
  are **nullable**; `home_score smallint NOT NULL` (:45), `away_score smallint NOT NULL` (:48), `result match_result
  NOT NULL` (:50), `margin smallint NOT NULL` (:52). No later migration changes these columns' nullability (020 adds
  attendance provenance, 022 adds CHECKs, 085 adds a generated column); there are no triggers on `matches`. The old
  comment "home_goals, away_goals are NOT NULL" was wrong.
- **CHECKs** (`022_match_result_integrity.sql:48-55`, `matches_score_components_ck`): the breakdown must reconcile
  with the total only where both components are recorded; a NULL component with a stored total is valid source data.
- **Old statements.** (1) `UPDATE matches m SET … home_behinds = COALESCE((o.override_values->>'home_behinds')::smallint,
  m.home_behinds) … FROM data_overrides o WHERE … o.is_active = true` leaves a component NULL when neither the (one,
  arbitrary) joined row nor the source has it. (2) The derived-score UPDATE over every match with an active `score`
  row then sets `home_score = (home_goals * 6 + home_behinds)::smallint`, `away_score = …`, `margin = abs(…)::smallint`:
  NULL arithmetic gives NULL, which violates `home_score`/`away_score` NOT NULL (:45/:48) and `margin` NOT NULL (:52),
  SQLSTATE 23502, aborting the replay's transaction. (`result` would fall through to `'draw'` and `winner_club_id` to
  NULL, but the row is rejected, so no wrong label is ever stored.)
- **Equivalence.** Merging only ADDS values to a match, so a component NULL after the merge is NULL under any single
  row the old join could pick: every match the new code refuses, the old code failed on, deterministically. The new
  refusal raises `RuntimeError` before any write, names the match and component, and replaces an unnamed
  `NotNullViolation`. The reverse is not true: the old code could fail where the new code succeeds (the
  component-from-another-group case, depending on which row the join picked). **No behavioural tightening; the
  refusal policy stands unrevised.**

### 17.9 Operator integration run FAILED (2026-10-09); second fix pass (uncommitted, not database-validated)

#### 17.9.1 Evidence (operator-reported; not re-run here)

`npx vitest run tests/integration/data-editor.test.ts -t "AFLDB-ISSUE-267/269"` on `afldb_test`: **6 failed, 37
filtered/skipped.** Neither issue is validated by it.

- **Replay CHECK violation.** `2081|issue267-one-field` became `home_goals = 16, home_behinds = 10, home_score = 100`
  after the replay's first UPDATE, violating `matches_score_components_ck` (SQLSTATE 23514). The §17.2 code wrote the
  merged components in one UPDATE and re-derived `home_score`/`away_score`/`margin`/`result`/`winner_club_id` in a
  second; the CHECK is evaluated per statement, so the row between the two is rejected. The constraint is correct.
- **Cleanup FK failure.** §17.3 said nothing in the fixture created `club_seasons`. Wrong: the live score save did.
  Cleanup then failed on `club_seasons_season_fkey`, and the file's historical-baseline `club_seasons` count rose from
  **1,624 to 1,626**. The failed run's season-2081 residue is still on `afldb_test` (§17.9.4).

**Consequence for the original code (code-derived, NOT reproduced).** The failing first UPDATE has the same shape as
the pre-fix statement (§17.8, "Old statements" (1)): components set by `COALESCE`, totals left for a second UPDATE.
So the original replay should also have failed with 23514 for any active `score` override whose components differ
from the reloaded source while both of that side's components are recorded. Where that held, a reload, rebuild or
post-swap promotion replay would have stopped before the ISSUE-267 period-row write was reached. This narrows, but
does not remove, the ISSUE-267 exposure (an override that equals the reloaded source, or a side with a NULL
component, passes the CHECK). The override census remains the measure; no live data was read for this note.

#### 17.9.2 Replay fix (`tools/migration/common.py`, matches branch)

The two writes are now ONE `UPDATE matches … FROM derived`:

- `effective` CTE: for every match with a merged override row, or with an active `score` row, the four effective
  components `COALESCE(merged override, source)`, plus `rederive` = the key holds an active `score` row (the unchanged
  rule; `COALESCE(…, false)` so a NULL can never fall through a `CASE`).
- `derived` CTE: `home_total = hg*6 + hb`, `away_total = ag*6 + ab` from the effective values.
- SET: attendance/match_time/match_event/notes exactly as before; components from `effective`; `home_score`,
  `away_score`, `margin`, `result`, `winner_club_id` from `derived` when `rederive`, otherwise the loaded value
  (`m.*`, which is the old row, as wanted). No SET reads another SET's new value.
- Unchanged: the equal-authority and underivable preflights run first (the second guarantees the four effective
  components are non-NULL for every `rederive` row); the final-period sync runs after, from the updated row. A
  score-overridden match whose overrides merge to no key is still re-derived from its loaded components, as the old
  second UPDATE did. The CHECK is not disabled, dropped, weakened or deferred.

#### 17.9.3 Fixture ownership fix (`tests/integration/data-editor.test.ts`)

Call chain read in full: `saveEdit` → `applyMatchEdit('score')` (`src/db/queries/data-edits.ts`) → UPDATE `matches`,
upsert both final-period rows, then `recomputeSeasonMetadata` (UPDATE of the season row), `recomputeClubSeasons`
(DELETE + INSERT of the season's ladder: one row per club with a home-and-away match, so two for the fixture),
`recomputePlayerDerivedStats` (no-op: no `player_match_stats`), `recomputeSeasonBrownlowStatus` (UPDATE of
`player_season_stats` for the season: none) (`src/db/queries/player-derived.ts`); then the `data_overrides` upsert and
the `data_edits` audit row. No triggers on these tables (only `match_coaches` has one). Other groups write only the
match row, the override and the audit row.

- `saveEdit267` wraps the two editor saves. After a committed `score` save it records the season-2081 ladder rows'
  `club_id`s, only while `owned267.createdSeason` (this run's INSERT created the season; the preflight proved it held
  no ladder row) and no match of the season is outside this run's ids. A ladder that also counts a foreign match is
  never claimed. The one-field case asserts the recorded ids equal the fixture's two clubs.
- `cleanup267` is ONE transaction: overrides, audit rows, period rows, matches, then (season owned) the recorded
  ladder rows once no match of the season survives, then the season only when no match AND no ladder row remains. A
  failure part-way removes nothing. Ownership flags are released only after the commit.
- Unchanged: the ownership preflight (still refuses on any season-2081 `club_seasons` row), the seed guard, the
  residue assertion (`clubSeasons: 0`) and the file's historical baseline.

#### 17.9.4 Recovery of the failed run's residue (operator-run; nothing was read or written here)

Do not assume every season-2081 row is the fixture's. Run from the worktree root, as the suite's role
(`AFLDB_TEST_DATABASE_URL`, the table owner); the recovery refuses unless the database name ends in `_test`.

1. Read-only census (lists the season row, every season-2081 / `2081|issue267-*` match, ladder rows, overrides and
   audit rows, each with its fixture-signature test; enumerates every foreign key into `seasons` and `matches` from
   the catalogue; section 8 prints the `expect_*` values and the counts that must be zero):

   ```bash
   psql -X -v ON_ERROR_STOP=1 -d "$AFLDB_TEST_DATABASE_URL" \
     -f issues/open/AFLDB-ISSUE-267-269-fixture-residue-census.sql
   ```

   Proceed only if it ends in `== Done.`, every `foreign_*` / `noted_edits_on_foreign_matches` value in section 8 is
   0, sections 6 and 7 show no non-zero count outside `matches.season`, `club_seasons.season` and
   `match_period_scores.match_id`, and no NULL (multi-column) count. Expected from the reported failure, not assumed:
   `expect_club_seasons = 2`, `expect_season = 1`, `club_seasons_total = 1626`.

2. Dry run (one transaction, ends in ROLLBACK). Substitute section 8's values for every `N`:

   ```bash
   psql -X -v ON_ERROR_STOP=1 \
     -v expect_matches=N -v expect_period_rows=N -v expect_overrides=N \
     -v expect_edits=N -v expect_club_seasons=N -v expect_season=N \
     -d "$AFLDB_TEST_DATABASE_URL" \
     -f issues/open/AFLDB-ISSUE-267-269-fixture-residue-recovery.sql
   ```

   Expect the NOTICEs `ownership checks passed …` and `removed: …`, `club_seasons_total` = 1624 inside the
   transaction, and `== Done (ROLLED BACK: dry run).` Any `REFUSED:` exits 3 with nothing removed.

3. Commit: the same command with `-v recover_commit=1` added; expect `== Done (COMMITTED).`
4. Re-run step 1: every section empty, section 8 all zero, `club_seasons_total` 1624.
5. Then the integration run (§17.5 step 2): expect 6 passed, not skipped.

The recovery's checks: database name; row locks on the namespace; the fixture club pair and `afltables` source
resolve; every namespace match and ladder row carries the full fixture signature (`IS NOT TRUE`, so a NULL counts
as foreign); no override on a namespace match outside the key root; no unnoted audit row on a namespace match and no
noted row on a foreign match; the season row is AFL; no row in any other table referencing season 2081 or a
namespace match (catalogue-enumerated, multi-column keys refused); each live count equals its `expect_*`; each DELETE
removes exactly its `expect_*`; the namespace is empty afterwards.

#### 17.9.5 Checks run in this session (2026-10-09)

`python -m py_compile tools/migration/common.py`: OK. `npx tsc --noEmit`: exit 0.
`npx vitest run tests/data-overrides-source-contract.test.ts`: 69/69. The six integration cases, the residue census,
the recovery and the override census were **not run**. The new UPDATE, census and recovery SQL have not been parsed by
PostgreSQL. One read-only `git diff --stat` was run at session start, contrary to CLAUDE.md §12; it changed nothing.
(Superseded for `afldb_test` by §17.10: the residue census, the recovery dry run and the integration cases have since
run there. The override census has since run on DEV only, §17.11.)

### 17.10 Residue recovery and the second integration run on `afldb_test` (2026-10-09, operator-run)

Operator-reported evidence, recorded as given; nothing in this subsection was run by Claude. No implementation or test
file changed after the second fix pass (§17.9.2, §17.9.3).

#### 17.10.1 Recovery history (§17.9.4)

1. **Residue census and dry run.** The recovery ran as a dry run with the census's `expect_*` values. It **passed and
   explicitly rolled back** (`== Done (ROLLED BACK: dry run).`); nothing was removed by it.
2. **Commit attempt: REFUSED before any DELETE.** The same command with `-v recover_commit=1` refused at its live-count
   check: the two expected `club_seasons` ladder rows (`expect_club_seasons = 2`) were **already absent**. No DELETE
   ran; the commit attempt removed nothing.
3. **Fresh read-only census.** The whole fixture namespace was **empty** (season 2081, `2081|issue267-*` matches, their
   overrides, audit rows, period rows and ladder rows), every foreign count was **0**, and
   `club_seasons_total = 1624` (the file's historical baseline).

**The fixture namespace was confirmed empty by a fresh read-only census. What removed the earlier residue is
unknown.** The dry run passed its live-count checks against the same `expect_*` values, so the rows were present then;
they were gone by the commit attempt. The reported dry run rolled back and the reported commit attempt refused before
DELETE. Neither establishes what happened between them. The only evidence is the before/after state above.

#### 17.10.2 Integration run (§17.5 step 2)

- **Target:** verified as `afldb_test`, connected role `afldb_owner`.
- **Run:** 9 October 2026, 10:47:03.
  `npx vitest run tests/integration/data-editor.test.ts -t "AFLDB-ISSUE-267/269"`: **6 passed, 37 filtered skips**
  (the `-t` filter, not the `canReplay` probe), **no suite or hook failures**, duration **33.80 s**.
- **The six cases (§17.3) all passed**, covering: the equal-authority conflict refused before any write; the
  missing-component refusal; components merged across groups (component from another group); census section 4
  agreeing with the replay preflight; final-period rows equal to the corrected totals; and replay idempotence.
- **Fixture assertions:** the describe's residue assertion and the file's historical-baseline assertions passed
  (`club_seasons` back at 1,624 after the run).
- **Prior DB-free checks stand** (§17.9.5): `py_compile` OK, `npx tsc --noEmit` exit 0, source-contract 69/69.

#### 17.10.3 What this validates, and what it does not

- **Validated on `afldb_test`:** the second-pass replay (one atomic UPDATE, both preflights, final-period sync from
  the updated row; `matches_score_components_ck` no longer violated) and the second-pass fixture ownership (the
  derived ladder rows are removed in one transaction; no residue, baseline held). PostgreSQL has now parsed and
  executed the replay SQL, the residue census and the recovery's dry-run path. The recovery's commit path has never
  executed a DELETE.
- **Not validated or established:** the exposure on DEV or PROD (the override census has not run; superseded for DEV
  by §17.11); whether any past
  rebuild, reload or promotion wrote NULL final-period rows or dropped an override group (historical corruption is not
  established; historical impact remains unassessed; nothing was repaired); the optional red/green run against `259ee7c6` (§17.5 step 3, reasoned only).

#### 17.10.4 Remaining acceptance

1. Operator review and commit (explicit paths, §17.7); `npm run merge:ready -- --issue 267`; merge and push.
2. DEV: `deploy/sync-dev.ps1` (a tooling change; the next reload/rebuild uses it), then the read-only override census
   on `afldb_dev` (§17.5 step 4). Any section-3/4 row is resolved (deactivate or correct the override) before a
   promotion.
3. PROD: the census before the next promotion, operator's choice of window (§17.5 step 4).
4. Any historical repair the census suggests is a separate, operator-decided action.
5. Resolution of both issues after steps 1–3 (§17.6).

(The DEV census in step 2 has since run, before the deployment; §17.11. The DEV deployment is still pending.)

### 17.11 DEV exposure census (2026-10-09, operator-run, before the fix was deployed)

Operator-reported evidence, recorded as given; nothing in this subsection was run by Claude. No implementation, test
or SQL file changed.

- **Command:** the read-only override census `issues/open/AFLDB-ISSUE-267-269-override-census.sql` (§17.5 step 4).
- **Target (section 0):** exact database `afldb_dev`, role `afldb_import`, `transaction_read_only = on`.
- **Completion:** ran through `== Done.` with no command failure.
- **Active `matches` overrides (section 0):** **0**.
- **Section 1 (ISSUE-267 exposure):** partial `score` overrides **0**, resolving to a match **0**.
- **Sections 2–5:** no rows. Section 2 (ISSUE-269 exposure, multi-row keys) is empty. Sections 3 and 4 (states the
  fixed replay would refuse) report **no current replay blockers**. Section 5 (symptom only) is empty.
- **Order.** The census ran **before** `deploy/sync-dev.ps1`, not after it as §17.10.4 step 2 sequenced. The census
  reads data only, so the deployed code does not change what it measures; a `matches` override created on DEV after
  this run is not covered by it.

**What it shows.** On 9 October 2026 `afldb_dev` had no ISSUE-267 or ISSUE-269 exposure and nothing the fixed replay
would refuse: no current DEV override needs resolving before a reload, rebuild or promotion with the fixed code.

**What it does not show.** With no active `matches` overrides, the empty section 5 does not assess historical
corruption: section 5 examines only matches that carry an active `score` override, so it examined none. Whether a
past rebuild, reload or promotion wrote NULL final-period rows or dropped an override group on DEV is not
established. **Historical impact remains unassessed;** nothing was repaired.

**DEV exposure census: complete.** Remaining (§17.10.4): operator review and commit, `merge:ready`, merge and push;
the DEV deployment (`deploy/sync-dev.ps1`); the PROD census before the next promotion; resolution after those.
