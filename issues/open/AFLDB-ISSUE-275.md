# AFLDB-ISSUE-275 — A settle can insert period scores under a match it refused because a foreign owner created it concurrently

## 0. Status

- **Status:** Open (2026-10-08). **Implemented locally 2026-10-13** on `opus/issue-275` (worktree `D:\dev\afldb-issue-275`, base `e315c1d3`): uncommitted, not merged, not deployed. DB-free validation passed (§19, §23). **Focused PostgreSQL validation PASSED on `afldb_test` 2026-10-13 (§26): 3 selected tests passed, exit 0, 79 cases excluded by the filter, `CENSUS IDENTICAL`**; it is a same-transaction planted-row witness, not two-session concurrency, and gives no DEV, PROD or State B evidence. The full-diff review (§27) found no CRIT/HIGH/MED defect. Remaining requirements: §28. §1-§17 are dated history; §18-§21 are current as amended in place; **§22-§25 (revision 2, 2026-10-13) supersede any §18-§21 sentence they contradict, and §26-§28 supersede every "NOT RUN" statement below**; the amended sentences say so.
- **Severity:** Medium. **Area:** acquisition / canonical ownership / provenance.
- **Key file:** `src/lib/acquisition/canonical-apply.ts` (`applyCanonicalUnit`, `readFreshTarget`).
- **Origin:** full code review at `20a7a4bbdea835cdd3fc5520e65ad47d275bd881` (`issues/reviews/2026-10-08-full-code-review.md`, F-010; partition note R4a-F02). The orchestrator re-read `canonical-apply.ts:1089-1099` and confirmed it.
- **Classification:** code-proven mechanism. The concurrent interleaving has not been executed.

## 1. Summary

`applyCanonicalUnit` binds `matchId` from the `matches` target's fresh read before that target's E3 (owner) and E5 (baseline) gates decide. If the `matches` target is then refused, `matchId` is not cleared. The same unit's `pending_match` `match_period_scores` target reads an empty set as `new_target` without consulting the parent's owner, passes, and inserts `afltables`-owned period rows under a match another source owns.

## 2. Evidence

- `src/lib/acquisition/canonical-apply.ts`:
  - `:1089-1091`: `if (target.targetTable === 'matches' && fresh.targetId !== null) matchId = fresh.targetId;` runs before E3 (`:1094-1099`) and E5 (`:1106-1112`).
  - Only the rekey / `possible_existing_match` branch (`:1079-1085`) withholds dependents (`fixtureBlocked`).
  - `:589-604`: an empty period set → `new_target`, with no parent-owner check.
- `src/lib/acquisition/settle-afltables.ts:2199-2230, :2414-2440`: the `pending_match` invitation with a null baseline.
- The module's own rules: "a match family is all or none" (`canonical-apply.ts:30-35`), and `settle-afltables.ts:3088-3092`, which forbids a period set under a foreign-owned or source-less match.
- Overlap evidence: both timers run nightly (`deploy/afldb-settle-afltables.timer` 04:30 + 15 min; `deploy/afldb-settle-afl-api.timer` 05:00 + 15 min). Both take the settle gate SHARED (`settle-core.ts:408`). ISSUE-265's runbook measured AFL Tables starts inside AFL API intervals (`issues/open/AFLDB-ISSUE-265.md:718-721`).

## 3. Trigger

1. A fixture neither source has settled yet.
2. The AFL Tables run loads its references with no row for key K, so it plans `matches` (`new_target`) plus `match_period_scores` (`pending_match`).
3. Before that unit runs, the AFL API run inserts K as an `afl_api`-owned match with no period rows.

## 4. Expected invariant

A period set is never written when the same unit's `matches` target was refused.

## 5. Actual behaviour

- `matches` → `foreign_source_owner` (refused).
- `match_period_scores` → `new_target` → insertable → four `afltables` rows and a ledger row are written under the `afl_api` match.
- Afterwards each source is refused on the other's rows on every run. The derived recompute does not include the match.

## 6. First wrong layer

`src/lib/acquisition/canonical-apply.ts:1089-1091`.

## 7. Impact

- Split ownership: child rows owned by a different source than their parent, contrary to the documented contract.
- Perpetual refusal findings on both sides.
- No value corruption.

## 8. Reproduction / witness

Not executed at the time of the review. The integration recipe is in §14. **(Superseded 2026-10-13: the same-transaction planted-row form was executed on `afldb_test`; §26.)**

## 9. Disproof attempts

- The non-concurrent paths hold (an existing row is never `pendingMatch`; the AFL API planner corroborates an existing row).
- The F030 ambiguity guard covers different-round/date rows only.
- The gate is SHARED by design, so it does not serialise the two settles.

## 10. Existing-issue search

- ISSUE-265 (lock deadlock; a different root cause), ISSUE-244 F030 (plausible-fixture INSERT refusal), ISSUE-131.
- Classification: **new**. Cross-references ISSUE-265 (overlap evidence).

## 11. Scope

Dependent-target withholding in `applyCanonicalUnit`.

## 12. Out of scope

Serialising the two settles (an ISSUE-265 design decision).

## 13. Proposed fix boundary

When the unit's `matches` target is refused for any reason, set `fixtureBlocked` / clear `matchId` so `match_period_scores` is withheld. Optionally, make an empty period set inherit the parent row's owner in `readFreshTarget`.

## 14. Proposed validation

Integration (`tests/integration/settle-afltables.test.ts`): after the run's `loadRefs`, pre-insert an `afl_api`-owned match through the `manualAuthorityLoader` hook. Assert that no `match_period_scores` row and no ledger row are written.

## 15. Decisions / unresolved questions

- Whether any DEV or PROD fixture already has split ownership. Read-only census: period rows whose `source_id` differs from the parent match's.

## 16. Next action

Code fix plus integration case. Sequence with AFLDB-ISSUE-274. **(Superseded 2026-10-13: the fix and cases are written; the next action is §20, then §21.)**

## 17. Interaction with AFLDB-ISSUE-274 (2026-10-11; review only, nothing implemented here)

ISSUE-274's local, uncommitted change (`lockUnitMatchRows` takes the unit's match row `FOR NO KEY UPDATE` before the
authority read when the unit targets `matches` or `match_period_scores`) **does not fix this defect** and must not be
reported as doing so:

- The foreign-owned row in the §3 trigger already exists when the unit runs, so the new lock simply locks it. `matchId` is
  still bound from the `existingMatch` read and again from `matchId = fresh.targetId`; the `matches` target is still refused
  by E3 (`foreign_source_owner`) and the `pending_match` period-score target still reads an empty set as `new_target` and
  inserts. Requirement §4 ("no period set when the unit's `matches` target was refused") is unmet.
- What the lock does give the eventual fix: the row's owner and values cannot change for the rest of the unit, so the
  decision "the `matches` target was refused, withhold the dependents" is made on stable state.
- What it cannot give: a row created after a no-row lock, or between the lock and the `existingMatch` read, is not locked
  (there is nothing to lock). Only withholding the dependent target closes that window, which is this issue's fix.
- Open design point for the fix (not decided here): which `matches` refusals withhold the period set. `foreign_source_owner`,
  `ownership_indeterminate` and `stale_canonical_target` plainly should; `nothing_to_write` must not (an unchanged match
  row must still receive its period set); `manual_authority_conflict` on a score override needs an owner decision.
- Acceptance is unchanged (§14): `tests/integration/settle-afltables.test.ts` records it as an `it.todo`; it needs the fix and
  a DB run. The §15 split-ownership census (period rows whose `source_id` differs from the parent match's) is still unrun.
- 2026-10-11 addendum: ISSUE-274 §19.1 adds one more `matches`-target refusal, `stale_canonical_target`, for a retired candidate
  that appears after the lock phase. It does not touch this defect (the foreign-owned incoming-key row is not a retired
  candidate); it is a further refusal this fix must treat as withholding dependents, already in the list above.
- Locking note for whoever implements it: the `match_period_scores` INSERT takes `FOR KEY SHARE` on the match row through its
  FK, which does not conflict with ISSUE-274's `FOR NO KEY UPDATE`; no ordering problem is introduced.

## 18. Implementation (2026-10-13; local, uncommitted)

**Where.** Worktree `D:\dev\afldb-issue-275`, branch `opus/issue-275`, created from `e315c1d354d1aa140fb4a5e8d98aae57bd5473a3`. Local `main` and a fresh `git fetch origin` `origin/main` both
equalled that revision before the worktree was created (0 ahead / 0 behind). The five untracked `.agents/skills/*` directories of `D:\dev\afldb` were left alone. No `.env` was copied;
`node_modules` in the worktree is a junction to `D:\dev\afldb\node_modules` (identical `package-lock.json` hash).

### 18.1 Defect re-confirmed against current code (not assumed from §5)

`canonical-apply.ts` has moved since §2 (ISSUE-274 added `lockUnitMatchRows`'s return value and the stale-candidate refusals); the mechanism has not. In `applyCanonicalUnit`:

1. `matchId` is bound from the unit's own re-read, `existingMatch` (`SELECT id FROM matches WHERE match_key`), and again from `matchId = fresh.targetId` for a `matches` target. Both happen before E3/E5 decide.
2. E3 (`autoApplyOwnership`) refuses a foreign or source-less `matches` row and `continue`s. Nothing cleared `matchId` or marked the unit. Only the rekey / `possible_existing_match` / `rekey_override_conflict` paths set `fixtureBlocked` and
   `matchId = null`.
3. The `match_period_scores` target then ran `readFreshTarget(..., matchId, ...)`: an empty period set is `new_target` with no parent-owner check, E3 returns `insertable`, E5 compares `null` with the `pending_match` target's `null` baseline, and
   `writePeriodScores` inserted four rows plus a ledger row.
4. The planner cannot prevent it: `resolveTarget` answers from `refs.matchIdsByKey`, which `loadRefs` fills before the run's units (`settle-afltables.ts:1643-1659`, `:2976`). A row created after `loadRefs` is invisible to it, so the unit is still
   `matches new_target` + `match_period_scores pending_match`. (Its own guard for an existing match with no period rows, `settle-afltables.ts:3090-3094`, is planner-side only and is not consulted by the applier.)
5. The AFL API direction is the same code (`settle-afl-api.ts:1551-1552` builds `pending_match` for a `new_target` match). Its `corroborated` branch writes nothing (`:1453-1473`), so no path there deliberately applies a period set beside a refused `matches` target.

**Confirmation by test, not by reading alone:** with the withholding branch disabled, the five DB-free refusal witnesses (§19) fail and the four controls pass (§19.2). The concurrent interleaving itself is still not executed against PostgreSQL (§20). **(2026-10-13: the same-transaction planted-row form passed on `afldb_test`, §26; a true two-session interleaving is still not executed.)**

### 18.2 Which refusals withhold (the §17 "open design point")

**SUPERSEDED by revision 2 (§22).** The first implementation withheld on a three-reason allow-list (`MATCH_PARENT_WITHHOLDING`: `foreign_source_owner`, `ownership_indeterminate`, `stale_canonical_target`) and deliberately left `manual_authority_*` unchanged pending D-275-1. The owner then
instructed that the invariant be completed for every genuine refusal, so the allow-list is gone and the rule is deny-by-default. The complete table is §22.1. The earlier table is not reproduced because it is wrong about `manual_authority_*`.

### 18.3 The change

`src/lib/acquisition/canonical-apply.ts` only (no migration, no caller, no schema, no settle ordering):

**Revision 2 (§22) replaced the mechanism described in the first version of this section** (a unit-local `parentRefusal` variable set at three sites). Current state:

- In the target loop, next to the existing `fixtureBlocked` check and before any read, a `match_period_scores` target is refused unread when the unit's own `matches` result is unapplied and is anything other than `nothing_to_write` (`MATCH_PARENT_NOOP`). The dependent carries the parent's reason, and the parent's
  `ownerSourceKey` exactly when the parent carried one (an E3 refusal alone). The rule is derived from the parent's actual result, so it is deny-by-default: a refusal reason added later withholds without being listed.
- **Deliberately not `fixtureBlocked`.** `fixtureBlocked` is returned to the caller, which reads it as a rekey statement (`settle-afltables.ts:2371-2411, :2499-2501`): it opens rekey findings, bumps `canonicalRekeyRefusals` and withholds the
  fixture's player rows for the rest of the run. An ownership, staleness or human-authority refusal is none of those, so nothing new is returned.
- Preserved: ISSUE-274's lock phase and statement order (the change adds no statement; the withheld dependent issues one fewer read), the authority snapshot, every existing refusal reason and its position, and the successful parent/period
  application. Not changed: serialising settles, ownership transfers, the planner, `readFreshTarget`, the optional "empty period set inherits the parent's owner" (§13), the `fixtureBlocked` return contract.
- The pinned E3 refusal line (`tests/db-promotion-check.test.ts` D-252-12 scans for it) is untouched: revision 2 adds no statement at any existing refusal site.

**Observable differences for a unit that hits the defect (corrected in revision 2):** `canonicalApplyRefusals` rises by one (the withheld period target) and `canonicalRowsInserted`, `canonicalApplicationsLogged` and the ledger do not move; previously those units wrote four rows and a ledger row.
**Findings differ by settle, and the first version of this section was wrong about AFL Tables.** `applyRecordCanonically` (`settle-afltables.ts:2506-2530`) writes a finding only for a rekey refusal and a rolled-back unit; every other applier refusal moves `canonicalApplyRefusals` alone. So an AFL Tables unit gains **no**
finding. The AFL API settle writes an F009 refusal finding and one refusal-evidence entry per refused target (`settle-afl-api.ts:1153-1215, :1578-1590`), so an AFL API unit gains one more of each.

## 19. Validation (2026-10-13; DB-free only; nothing contacted a database)

### 19.1 Tests written

- **DB-free, `tests/current-season-import.test.ts`** (inside the ISSUE-274 describe, reusing its `fakeUnitTx` harness): nine cases under "ISSUE-275" from the first pass, **plus six added in revision 2 (§23)**, 15 in all:
  - the runbook witness in both directions (`afltables` unit, row created by `afl_api`; `afl_api` unit, row created by `afltables`): `foreign_source_owner`, no period INSERT, no ledger INSERT, no `matches` write, no period-set read, `fixtureBlocked` null,
    `ownerSourceKey` carried to the dependent;
  - an unowned (`source_id` NULL) row: `ownership_indeterminate`;
  - an own row with a moved baseline: E5 `stale_canonical_target`;
  - a retired candidate that appears after the lock phase with the incoming-key row present: `readFreshTarget`'s `stale_canonical_target` (ISSUE-274 §19.1);
  - the season gate and an incomplete match still refuse both targets with their own reasons;
  - **positive controls:** an owned row updates and its period set is written with two ledger rows; a new fixture inserts the match and the period set against the new id; an unchanged `matches` target (`nothing_to_write`) does not withhold the period set.
- **PostgreSQL, `tests/integration/settle-afltables.test.ts`** (ISSUE-274 describe; the `it.todo` is **replaced**): two scenarios, "ISSUE-275: a refused foreign-owned matches target withholds ..." and "ISSUE-275 positive control ...". **Written and typechecked here; run once on `afldb_test` later the same day and passed (§26).**
  The witness plants the competing row inside the run's own transaction through `manualAuthorityLoader` (which `runSettleAfltables` calls after `loadRefs` and before any unit), asserts `canonicalApplyRefusals === 2` (so it cannot pass vacuously if
  the planner pre-empted the applier), no period rows, no ledger rows, and the match unchanged and still foreign-owned. **Corrected in revision 2 (§24.1):** the first version also asserted two `foreign_source_owner` findings; the AFL Tables settle opens none for this refusal, so that assertion would have failed
  on a correct fix. It now asserts `canonicalRekeyRefusals === 0` and no `canonical_apply_failed` finding for the record.

### 19.2 Results

| Check | Result |
|---|---|
*First-pass results (historical; superseded by §23 for the current tree):*

| Check | Result |
|---|---|
| `npx vitest run tests/current-season-import.test.ts -t "ISSUE-275"` | 9 passed, 342 skipped |
| Same, with the withholding branch temporarily disabled (`false &&`, reverted) | 5 failed (the refusal witnesses), 4 passed (controls and gate) |
| the five source-scanning files | 1054 passed, 1 failed (below), 4 skipped |
| `npx tsc --noEmit` (includes `tests/integration/**`) | exit 0 |

**The one failure is pre-existing and unrelated** — recorded on its own in §25. An earlier first-pass run also failed `db-promotion-check.test.ts` D-252-12; that was this change's own fault and is fixed.

**Not run (first pass; historical):** the PostgreSQL integration (§20; **run later the same day, §26**), the full DB-free suite, `settle-afl-api` and the other integration files, lint, a build.

## 20. Prepared PostgreSQL procedure (operator-run; NOT executed when written; EXECUTED in corrected form, §26)

> **2026-10-13 note.** The commands below are the procedure as prepared. They were not run as written: the census pack in `pack\` had a failing `match_period_scores` fingerprint, and invoking `npx` through a shell split the `-t` filter at `|` (§26.1). The accepted run used `pack-v2\` with a shell-free runner (§26.2-§26.3). Read this section for intent; read §26 for what was executed.

Operator-run per CLAUDE.md §9. PowerShell from `D:\dev\afldb-issue-275`, tunnel to `afldb_test` up on 55432, the operator's `afldb_test` OWNER DSN in `$env:AFLDB_TEST_DATABASE_URL` (database must be exactly `afldb_test`; never copy `.env` into the
worktree; `AFLDB_TEST_IMPORT_DATABASE_URL` unset). One suite at a time: `afldb_test` is shared and mutable. Tools are the ISSUE-274 instruments (read-only; DSN built in-process, never printed); the census pack is a copy of
`D:\tmp\issue274\run-20261012-r1r2\` with only the worktree constant changed: `D:\tmp\issue275\pack\` (`census.mjs`, `lib-dsn.mjs`, `compare_census.py`; `node --check` exit 0 on the two `.mjs` files; none executed).

0. Prechecks, in order, stopping at the first failure; nothing is changed to make one pass:
   - `git status --short` shows only: `src/lib/acquisition/canonical-apply.ts`, `tests/current-season-import.test.ts`, `tests/integration/settle-afltables.test.ts`, `issues/open/AFLDB-ISSUE-275.md`, `IssuesIndex.md`, `issues.md`.
   - `node D:\tmp\issue274\probe\issue274-matches-only-probe.mjs` (cwd-based, read-only) -> last line `MATCHES-ONLY PROBE OK`. It checks the worktree has no `.env`, the DSN names `afldb_test`/`afldb_owner`, the prerequisites, collisions and that no `afldb-i274-*` session exists.
   - Baseline census: `node D:\tmp\issue275\pack\census.mjs D:\tmp\issue275\pack\census-0-baseline.json baseline` -> exit 0. Every `099`/`122`/`274` cleanup selector must be **0** and seasons 2093/2094 absent (the 12 `issue122-s6-cli` batches are preserved evidence and
     expected). Any non-zero selector: stop; do not delete anything by hand. This case's keys are `2093|issue122-274-own-1` and `2093|issue122-274-ok-1`, inside `122 matches (key)` and the other `122 ... (key)` / `%issue122-%` selectors (§24.2 maps each artefact to its selector; **corrected in revision 2:** the first version also named
     `274 data_overrides matches`, which this case never touches because it creates no override).
1. The run, once: `npx vitest run tests/integration/settle-afltables.test.ts -t "ISSUE-274: precondition|ISSUE-275" --reporter=verbose` -> expect **3 passed, 0 failed, 0 todo** (the other cases skipped): the read-only 274 precondition (the real authority loader answers `clear` for a `matches` proposal, which the positive control needs and
   which a bare `-t "ISSUE-275"` would not check) plus the two ISSUE-275 cases. **Corrected in revision 2:** the first version used `-t "ISSUE-275"` alone and expected 2.
2. Residue: `node D:\tmp\issue275\pack\census.mjs D:\tmp\issue275\pack\census-1-after.json after`, then `python D:\tmp\issue275\pack\compare_census.py D:\tmp\issue275\pack\census-0-baseline.json D:\tmp\issue275\pack\census-1-after.json` -> **`CENSUS IDENTICAL`**, no leftover session.
   Sequences advance legitimately and are not compared. The witness commits a foreign-owned match row and, if the fix works, **nothing else keyed to it** (no period row, no ledger row, no finding); the positive control commits a match, four period rows and two ledger rows plus the season-2093 derived rows. All are keyed under `2093|issue122-` and are
   removed by `cleanup122` in the outer `afterAll` (including `DELETE FROM seasons` and `club_seasons` for 2093); the per-scenario cleanup removes only matches overrides, so the rows are expected to be present until the file's `afterAll`. A difference after the run means residue: stop and report; change nothing.
3. Only after step 1 passes and step 2 is identical, and only if the owner wants the wider guard: the whole file, `npx vitest run tests/integration/settle-afltables.test.ts`, then `settle-afl-api.test.ts` (shared applier; 669 s on the last recorded run), each as its own run with its own before/after census.
4. `Remove-Item Env:AFLDB_TEST_DATABASE_URL`; close the tunnel.

**Reading a failure.** `planted.id` null: the hook never ran (wrong entry point). `canonicalApplyRefusals` 0: the planner saw the planted row, so the case did not model the race (a modelling failure, not a product pass). `canonicalApplyRefusals` 1 with period rows present: the fix is not in effect.
`canonicalApplyFailures` non-zero: a constraint rejected the planted row (the fixture, not the product). `canonicalRekeyRefusals` non-zero or a `canonical_apply_failed` finding: the withholding was carried by `fixtureBlocked` or the unit rolled back. A positive-control failure on exact refusal or ledger counts was written without being run and should be read against the log before being trusted.

**What a pass would and would not show.** It shows the applier withholds the dependent in a real transaction with the real constraints, FKs and ledger. It would **not** show true two-session concurrency (the competing row is planted by the same transaction, which fixes the ordering but not the interleaving),
the `afl_api` owner itself (it uses the file's existing foreign `squiggle_api` source; E3 judges any non-`afltables` owner the same way), State B durable Match Sheet behaviour, or anything about DEV or PROD data.

## 21. Remaining requirements (the issue stays Open)

1. Run §20 (operator), then the operator commits the reviewed change, `npm run merge:ready -- --issue 275`, merge/push. **(Superseded 2026-10-13: §20 was executed in corrected form and passed, §26; the remaining steps are §28.)**
2. **Hold the DEV install.** The 14 October nightly is a combined ISSUE-274 + ISSUE-276 observation and every later night is combined while ISSUE-276 remains installed on DEV. `canonical-apply.ts` is shared by both settles, so installing this change before the observation window
   closes would muddy that attribution. DEV install and a nightly observation of its own belong after the owner closes that window. **PROD stays behind the ISSUE-265 hold** (this change, ISSUE-274 and ISSUE-276 included).
3. **D-275-1 — RESOLVED 2026-10-13 by the owner's instruction (revision 2, §22):** `manual_authority_conflict` / `manual_authority_indeterminate` on the `matches` target now withhold the period set, as does every other genuine `matches` refusal. The invariant is "a unit does not write dependent period scores when it
   refuses its own `matches` target", not a list of reasons. Recorded here because the first pass had left it open and the index/ledger said so.
4. The §15 split-ownership census (period rows whose `source_id` differs from the parent match's) on DEV and PROD is **unrun** (this task did not touch any database). The fix is forward-only: it does not repair rows already written.
5. **Period-only units: TRACED in revision 2 (§23.4); not part of this defect.** The AFL Tables `retry` invitation for an existing match with an empty period set is reachable, but the applier refuses it at E5 (baseline mismatch), so it writes nothing. The AFL API builds a period-only unit only for an `update_owned` match, which the planner has already
   classified as one it may write; a corroborated (foreign-owned) match builds no period target at all, and `matches.source_id` is never changed on an UPDATE, so the parent's classification cannot change between plan and apply. Neither path involves a refused `matches` target. No further fix is proposed. Unanalysed and outside scope:
   whether the AFL Tables retry's nightly E5 refusal recurs for a match whose published period set is empty.
6. CHANGELOG: not updated when this was written. **(Superseded 2026-10-13: an `Unreleased` entry describing the local implementation and validation, with no claim of merge, deployment or closure, is prepared in `CHANGELOG.md`.)**

## 22. Revision 2 (2026-10-13): the complete refusal-path table

**Instruction (owner, 2026-10-13):** the invariant is *a unit must not write dependent period scores when that same unit refuses its `matches` target*; complete it rather than limit it to three reasons. This supersedes the first pass's allow-list and resolves D-275-1.

**Rule as implemented** (`canonical-apply.ts`, the loop in `applyCanonicalUnit`, immediately after the `fixtureBlocked` check): a `match_period_scores` target is refused unread when this unit's `matches` result is `applied === false` and `refusal !== 'nothing_to_write'` (`MATCH_PARENT_NOOP`). It reuses the parent's reason; it carries `ownerSourceKey`
exactly when the parent did. It sets nothing the caller reads: `fixtureBlocked`, `insertedMatchId`, `rekeyedMatch` and `overridesCarried` are untouched. **Precondition:** the rule reads results of *earlier* targets only, so `matches` must precede `match_period_scores` in `unit.targets`. Both builders do (`MATCH_TARGET_TABLES` order in
`settle-afltables.ts:159`, then `invitationFor` per pass in that order; `settle-afl-api.ts:1519` before `:1550`). No test pins that order; a future builder that reversed it would bypass the rule.

### 22.1 Every path that can leave the `matches` target of a unit unapplied (current `canonical-apply.ts`, `applyCanonicalUnit`)

| # | Path (site) | Result for `matches` | Class | Dependent `match_period_scores` | How | DB-free test |
|---|---|---|---|---|---|---|
| 1 | E2 season gate (`:1145`) | `season_not_in_progress` | genuine refusal, unit-wide | refused, same reason | the new rule fires first; the dependent's own E2 would say the same | "a season gate or incomplete match still refuses both targets" |
| 2 | E6 completion predicate (`:1154`) | `match_incomplete` | genuine refusal, unit-wide | refused, same reason | as #1 | same test |
| 3 | `readFreshTarget`: a retired candidate outside the set locked before the authority snapshot (`:577`, ISSUE-274 §19.1) | `stale_canonical_target` | genuine refusal | refused, same reason | new rule | "a retired candidate found after the lock phase ... withholds" |
| 4 | `readFreshTarget`: incoming key has a row AND a retired one exists / >1 retired / a plausible fixture for an INSERT (`:580-633`) | `rekey_would_merge`, `rekey_ambiguous`, `possible_existing_match` | genuine refusal, **fixture-wide** | refused, same reason | **pre-existing `fixtureBlocked`** (also returned to the caller, which reads it as a rekey statement) | pre-existing; not re-tested here |
| 5 | E3 ownership (`:1187`) | `foreign_source_owner` (owner is another source), `ownership_indeterminate` (source-less row, unreadable owner id) | genuine refusal | refused, same reason, **`ownerSourceKey` carried** | new rule | both directions, plus the source-less row |
| 6 | E5 baseline (`:1202`) | `stale_canonical_target` | genuine refusal | refused, same reason | new rule | "stale at E5" |
| 7 | empty diff against the freshly-read row (`:1209`) | `nothing_to_write` | **successful no-op** | **NOT withheld**: an unchanged match row still receives its period set | `MATCH_PARENT_NOOP` exemption | POSITIVE control (and the first pass's) |
| 8 | E4 human authority (`:1270`) | `manual_authority_conflict`, `manual_authority_indeterminate` | genuine refusal | refused, same reason, **no `ownerSourceKey`** (not an ownership statement) | new rule (**the gap this revision closes**) | both reasons, plus a POSITIVE control on an untouched group |
| 9 | rekey override carry (`:1300-1309`) | `rekey_override_conflict` | genuine refusal, fixture-wide | refused, same reason | pre-existing `fixtureBlocked` | pre-existing |
| 10 | after `writeMatch` (`:1336`) | `nothing_to_write` | **unreachable for `matches`**: an INSERT returns one row, an UPDATE that touches no row throws (`requireRowUpdated`) | would not withhold if it ever fired | exemption | none (unreachable) |
| 11 | any thrown error in the unit | `write_failed` for every target, `failure` set | transaction failure | **nothing was written**: the unit rolls back to its savepoint | pre-existing | pre-existing |

Not `matches`-target paths, listed so the table can be audited against the source: `no_canonical_match` (period / player targets only, never `matches`); `player_match_stats` manual-authority refusals (`:1224` ff., a different table; a player unit has no period target); `applyAttendanceEnrichment` (a separate function writing
`matches.attendance` only; it builds no period target). An absent `matches` target (a period-only unit) makes the invariant vacuous; see §23.4.

**Counters and metadata for a withheld dependent.** `refusal` = the parent's; `applied` false, `verb` null, rows 0, **no ledger row, no period read**. `canonicalApplyRefusals` rises by one per withheld target in both settles. AFL Tables opens no finding (it opens one only for a rekey refusal or a failure; `settle-afltables.ts:2506-2530`); the AFL API
settle opens its F009 finding and records one refusal-evidence entry per refused target. `ownerSourceKey` is evidence only and present only when the parent's E3 refusal carried it. The AFL API `matchWriteApplied` (`settle-afl-api.ts:1698`) is now false for a withheld unit, so a match whose only "write" would have been the bogus period set no longer enters the derived recompute scope.

## 23. Revision 2 validation (DB-free only; nothing contacted a database)

### 23.1 Tests added (`tests/current-season-import.test.ts`, ISSUE-275 describe; 15 cases in all)

- `manual_authority_conflict` and `manual_authority_indeterminate` (a `describe.each`, two cases each): an active `matches` override row is supplied through the real `loadManualAuthority` SQL (`FROM data_overrides WHERE entity_type = 'matches' AND is_active`) so the real `manualAuthorityVerdict` answers; the group comes from the real
  `matchFieldGroupsFor(['home_goals'])` (asserted `['score']`), and the indeterminate case uses a group the editor does not define (asserted absent from `matchGroupKeys()`). Each asserts: both targets refused with the authority reason, `verb` null / rows 0, **no `ownerSourceKey` key**, no `matches`/period write, no ledger row, no period-set read, `fixtureBlocked` null, `insertedMatchId` null.
- **POSITIVE:** an override on a group the proposal does not touch (`notes`) is `clear`, and the family is written with two ledger rows. This discriminates "withhold on authority refusal" from "withhold whenever an override exists".
- **Period-only retry:** a `retry` period target carrying the baseline hash of `{ period_scores: [] }` (the shape the AFL Tables planner emits, §23.4) against an empty period set is refused `stale_canonical_target` with no write and no ledger row.
- The first pass's nine cases are unchanged (the unowned/source-less case still asserts a `null` owner; the stale dependents now carry no `ownerSourceKey` key at all, which the old `?? null` assertion tolerated).

### 23.2 Negative controls (each applied to the source, run, and reverted)

| Control | Result | Reading |
|---|---|---|
| rule narrowed back to the first pass's three reasons | **2 failed, 13 passed**; the failures are exactly the two `manual_authority_*` witnesses | the new cases discriminate the missing behaviour |
| rule disabled (`false &&`) | **7 failed, 8 passed**; failures are the 2 directions of the foreign-owner case, the source-less case, E5, the late retired candidate and the two authority witnesses; passes are the gate case, the 4 controls, the retry case and the `describe.each` fixture-mapping checks | every refusal path is exercised; the controls and the period-only case do not depend on the rule |

### 23.3 Results on the final tree

| Check | Result |
|---|---|
| `npx vitest run tests/current-season-import.test.ts -t "ISSUE-275"` | 15 passed, 342 skipped |
| `tests/current-season-import`, `afl-api-ingestion-safety`, `admin-match-mutations`, `data-overrides-source-contract`, `db-promotion-check` | 1064 passed, **1 failed** (the CRLF baseline, §25), 0 other |
| `npx tsc --noEmit` (includes `tests/integration/**`) | exit 0 |
| `TEMP-CONTROL` / `parentRefusal` / `MATCH_PARENT_WITHHOLDING` left in source | none (searched) |

Not run (at the time; the PostgreSQL cases were run later the same day, §26): the PostgreSQL cases (§20), the full DB-free suite, `settle-afl-api` and the other integration files, lint, a build.

### 23.4 The period-only retry invitation, traced

*Question:* can the planner hand the applier a unit with a `match_period_scores` target and no `matches` target, against a match whose period set is empty, so that the applier (which has no parent-owner check) inserts under a match it never examined?

**AFL Tables.** `invitationFor` (`settle-afltables.ts:2199-2230`) returns `retry` for a pass whose reconciliation outcome is `unchanged`/`history_only`, whose identity is not `unresolved`, and whose proposal still differs from `targetValues`. `resolveTarget` (`:3062-3143`) for an existing match (`matchId` non-null) with no period rows
returns a *resolved* target with `{ period_scores: [] }` and indeterminate ownership (the comment at `:3090-3094` says this is how a foreign-owned or source-less parent fails closed). So yes: when the source payload has not moved, `retry` **is** invited, with `renderedBaselineCanonicalHash = baselineCanonicalHash(fields, { period_scores: [] })`, a non-null
string. In the applier `readFreshTarget` reads the empty set as `new_target` with `currentValues` null, so `currentBaseline` is null and E5 (`canonical-apply.ts:1202`) refuses `stale_canonical_target` **before any write**. The planner's fail-closed intent is therefore honoured, by a baseline mismatch rather than an ownership check. A `candidate` outcome (payload moved) against
the same state is refused by `reconcile()` step 6 (ownership), so it is never invited. The only invited-and-unrefused path is `pending_match`, which requires `matchesInvited` (a `matches` target in the same unit), i.e. the case this issue fixes. *Evidence:* code reading of the functions above plus the DB-free retry case in §23.1; the planner functions are not exported, so the planner half is **not**
executed by a test.

**AFL API.** A period target is built only in the `planned` branch (`settle-afl-api.ts:1545-1563`); the `corroborated` branch (a co-source-owned match) builds none ("afl_api never writes a corroborated match's period scores", `:1453`), and a refused/halted match returns before any unit. So a period-only unit exists only for an `update_owned` match that
`classifyResolvedMatch` found writable (owned by `afl_api` or source-less), with `matches` absent because its fields did not differ. The applier never changes `matches.source_id` on an UPDATE (`canonical-apply.ts` §19.1(e); other writers such as a delete-and-recreate are outside the settle), so that classification cannot change between plan and apply by the applier's own doing; there is no refused `matches` target and no race.

**Disposition:** not part of this defect and not a second defect. No change. One residual observation, **not analysed**: whether the AFL Tables retry's E5 refusal recurs nightly (and moves `canonicalApplyRefusals`) for a match whose published period set is empty or all-NULL. It is out of scope; it is not claimed as a defect.

## 24. Revision 2: review of the prepared PostgreSQL procedure against the two cases

The first pass copied the ISSUE-274 census pack and changed only the worktree constant. That alone did not show the selectors cover these fixtures or this case's cleanup footprint, so each artefact was traced to its creator, its remover and its selector.

### 24.1 A defect in the written integration case (fixed)

The witness asserted two open findings under `foreign_source_owner`. `applyRecordCanonically` (`settle-afltables.ts:2506-2530`) opens a finding only for a rekey refusal (`isRekeyRefusal`) or a rolled-back unit; every other applier refusal moves `canonicalApplyRefusals` alone. On a correct fix that assertion would have failed (a false negative against the
product), and §18.3 had wrongly said a finding is added. Replaced with the property that does hold and that the design depends on: `canonicalRekeyRefusals === 0` and no `canonical_apply_failed` finding for the record (a `fixtureBlocked`-based fix, or a rolled-back unit, would make one of them non-zero). Typecheck exit 0; **still not run at that point (it ran and passed later the same day, §26)**.

### 24.2 Footprint to selector map (all verified against `cleanup122`, `census.mjs` and the cases)

| Artefact | Created by | Removed by | Census selector |
|---|---|---|---|
| planted foreign-owned match (witness) | hook `INSERT` in the run's transaction | `cleanup122`: `DELETE FROM matches WHERE match_key LIKE '2093\|issue122-%'` | `122 matches (key)`; `matches` total and id fingerprint |
| positive-control match, 4 period rows | settle | same; `match_period_scores` cascades | `122 matches (key)`; **no dedicated period selector**: covered by the `match_period_scores` total and id fingerprint |
| 2 ledger rows | settle | `canonical_applications ... external_record_id LIKE key/bare` | `122 canonical_applications (key)` and `(bare)` |
| staging rows for both records | settle | `staging.afltables_match`, `source_records`, `source_record_versions` by key and bare; payloads by `issue122_fixture` | the matching `(key)` / `(bare)` / `(issue122_fixture)` selectors |
| `promotion_candidates`, `import_rejections` | settle | by key and bare | `(key)` / `(bare)` selectors |
| any `data_issues` the run opens | settle | `issue_key LIKE '%issue122-%'` | `122 data_issues` |
| the run's `import_batches` | settle | `notes LIKE '%issue122-apply-test%'` (the bundle's `snapshot_label` is `LABEL122`) | `122 import_batches (label)` |
| season 2093 and its derived `club_seasons` | outer `beforeAll` / the positive control's recompute | `DELETE FROM club_seasons` / `seasons` for 2093 | `122 club_seasons season 2093`; `seasons` block |
| `data_overrides` | **nothing in this case creates one** | n/a | `274 data_overrides matches` is not exercised here (the first pass wrongly named it) |

No artefact falls outside a selector, and the id-set fingerprints (`census.mjs:146-160`) would show residue in any table regardless. Fixture numbers 29/30 are unused elsewhere in the file (the highest other is 28), so the rounds (198/201) and dates (`2093-07-29/30`) cannot trip the plausible-fixture guard against any other fixture. Both keys are inside `2093|issue122-274-%`.
The census session is read-only and its application name does not match `afldb-i274-%`; `compare_census.py` fails on any selector, total, fingerprint, schema or session difference.

### 24.3 What the corrections to §20 are

(a) the `-t` filter now includes the 274 precondition, because the positive control needs the real authority loader to answer `clear` and a bare `-t "ISSUE-275"` would have skipped the only test that proves it (expect **3** passed); (b) the residue paragraph no longer expects findings; (c) the wrong `274 data_overrides` selector reference is removed; (d) the failure table gained the rekey/finding reading.

### 24.4 Still not verified (needs the operator run) **(resolved 2026-10-13: the planted `INSERT` executed without a constraint rejection and the four-period-row expectation held; §26.3)**

The planted `INSERT` has never executed against PostgreSQL (its column list mirrors the existing foreign-row insert at `settle-afltables.test.ts:3174`, with `attendance_status = 'not_collected'` as in the source-less insert at `:3218`, but a constraint could still reject it: the §20 failure table reads that as `canonicalApplyFailures` non-zero or a thrown insert). The four-period-row expectation of the positive
control is read from the default projection (`:2216-2220`, the same shape an existing case asserts at `:2772-2777`), not executed **(both executed and held, §26.3)**.

## 25. The CRLF baseline failure (recorded separately; not part of this fix)

`tests/current-season-import.test.ts` > "AFLDB-ISSUE-122 S6 — the operational path contract > the derived recompute wiring (§13) > reuses the four player-derived helpers, in the admin order, once, gated on a write" fails with `recomputeSeasonMetadata(tx, bundle.season): expected -1 to be greater than -1`. Reproduced again on this tree on 2026-10-13 (the only failure in the five-file run, 1064 passed). The first pass recorded the same failure identically on the clean
`D:\dev\afldb` checkout at `e315c1d3`. Cause (by inspection): the test slices `settle-afltables.ts` on an LF literal (`'\n      }'`) and that file has CRLF line endings on this Windows checkout (`file` reports "with CRLF line terminators"), so the slice finds nothing. `canonical-apply.ts` is not involved, so ISSUE-275 neither causes nor fixes it. Nothing was changed to address it.
It is a repeatable test-environment problem on Windows; whether to register it is the owner's call (CLAUDE.md §5) and was not done here. The memory note on a different Windows CRLF contract test (finals-semantics) is a distinct case.

## 26. Focused PostgreSQL validation (2026-10-13; `afldb_test`): supersedes every "NOT RUN" statement above

Operator-authorised, executed by the session that holds this worktree. Evidence directory of the accepted run: `D:\tmp\issue275\run-20261013-105531-v2\`. Everything above that says the PostgreSQL cases are "NOT RUN" is dated history for the time it was written; it is not edited away.

### 26.1 Earlier attempts (preserved; none is acceptance evidence)

| Directory under `D:\tmp\issue275\` | What happened | Reading |
|---|---|---|
| `run-20261013-103753\` | The inherited `AFLDB_TEST_DATABASE_URL` named role `arm`. The matches-only probe refused in its pre-connection check (`the DSN must authenticate as afldb_owner; got "arm"`), exit 1. | No test, no database work. |
| `run-20261013-104201-owner\` | Owner DSN built privately in-process (`lib-dsn.mjs`). Probe OK; baseline census exit 0. The Vitest call went through `cmd.exe`, which split the `-t` filter at `\|`: exit 255, stderr `'ISSUE-275' is not recognized as an internal or external command`, stdout lost to the failed pipe. A different partial invocation (`-t ISSUE-274:` with `precondition` as an extra filter) **may** have started on the left of that pipe; its output is lost, so it can be neither shown nor ruled out. After-census taken; the v1 comparator printed `CENSUS IDENTICAL`. | Not a test result. **The v1 comparison is invalid:** the v1 census's `match_period_scores` fingerprint failed (`column "id" does not exist`; that table has no `id`) in both snapshots, and the v1 comparator treated two identical errors as identical. Under the v2 comparator the same two snapshots are `CENSUS NOT COMPARABLE`, exit 1 (shown offline). Not acceptance evidence. |
| `run-20261013-104901-argvcheck\` | Offline argv check with a stub standing in for Vitest: no credentials, no database, no Vitest. 10/10 checks, `ARGV CHECK OK`. | Instrument check only. |

All three directories, with their logs, are preserved untouched.

### 26.2 Instruments (`D:\tmp\issue275\pack-v2\`, outside the repository; originals in `pack\` untouched)

- `run-child.mjs` + `runner-lib.mjs`: builds the owner DSN in-process with `lib-dsn.mjs` (byte-identical to the one in `pack\`) from the existing credential source `D:\dev\afldb\.env` (owner-authorised for this run; no `.env` is copied, edited or printed; the worktree has none), asserts role `afldb_owner`, database `afldb_test`, host `127.0.0.1`, port `55432`
  and no query options before any child starts, drops every `DATABASE_URL`/`PG*`/`DATABASE*` variable from the child environment (so `AFLDB_TEST_IMPORT_DATABASE_URL` is never present), never prints the DSN, and spawns `process.execPath` with an argument array and `shell: false`. Vitest is resolved from its own `package.json` `bin` (4.1.10, via the worktree's `node_modules` junction to `D:\dev\afldb\node_modules`).
  The filter is one literal argument: `ISSUE-274: precondition|ISSUE-275`. stdout, stderr and the real status/signal/error are written to separate files; existing evidence is never overwritten.
- `census.mjs` v2: `match_period_scores` is fingerprinted by its real primary key `(match_id, club_id, period)` (asserted from the catalog) as `n`, `h` (key tuples) and `rh` (md5 of every whole row, provenance columns included), in key order. Any fingerprint failure is now fatal.
- `compare_census.py` v2: rejects (`CENSUS NOT COMPARABLE`, exit 1) a snapshot with an error, a wrong identity, or a missing/errored/malformed fingerprint (including two identical failures); exits 1 on any difference; exits 0 only for `CENSUS IDENTICAL`.
- **Limitation on these instruments:** no hash manifest of `pack-v2` was taken at preparation. `pack-v2-hashes.txt` in the run directory was taken *after* preparation and immediately before the run, so it records what ran but does **not retrospectively prove** the bytes the reviewer saw. What does support it: every `pack-v2` file's last-write time is at or before the preparation (10:48:53) and not after; `node --check` exit 0 on all six `.mjs` files; the unchanged `lib-dsn.mjs` hash equals the original's (`94AC0FB7...99C2`).

### 26.3 The accepted run (`run-20261013-105531-v2\`; 13 October 2026, AEDT)

| Step | Result |
|---|---|
| Prechecks | `git status --short`: exactly the six changed files plus the untracked, zero-byte `reuses` and `{})`. No `.env` in the worktree; `AFLDB_TEST_IMPORT_DATABASE_URL` unset; tunnel reachable on 127.0.0.1:55432. Sizes and SHA-256 of all eight files identical to the earlier runs' record. |
| Target (pre-connection, then server) | `role=afldb_owner db=afldb_test host=127.0.0.1 port=55432 query=none`. The probe's server-side read: `database=afldb_test role=afldb_owner owner=afldb_owner superuser=false`, PostgreSQL 16.15, read-only session. |
| Argv check | `ARGV CHECK OK` (10/10). |
| §20 matches-only probe | `MATCHES-ONLY PROBE OK (MO-1)`; status 0; empty stderr. (Not a pass of the migration-110 gate; it says so.) |
| Baseline census (10:55:51) | Exit 0, no error. Every 099/122/274 cleanup selector 0 (the 12 `issue122-s6-cli` batches are preserved evidence and expected); seasons 2093/2094 absent; no `afldb-i274-*` or idle-in-transaction sessions. `match_period_scores`: `n=134704`, `h=a18e74a5a3391fc8424c9663e0a45866`, `rh=820a402b9d3a9a6f5b948c894682c8d2`. |
| Vitest, once (start 10:56:05, 18.33 s) | `node D:\dev\afldb\node_modules\vitest\vitest.mjs run tests/integration/settle-afltables.test.ts -t "ISSUE-274: precondition\|ISSUE-275" --reporter=verbose`, `shell: false`. Status 0, signal null, empty stderr. `Test Files 1 passed (1)`; `Tests 3 passed \| 79 skipped (82)`. |
| After-census (10:56:35) | Exit 0, no error. Same selectors, seasons and sessions. `match_period_scores` `n`, `h`, `rh` **identical** to the baseline. |
| v2 comparator | `CENSUS IDENTICAL`, exit 0. |
| Recheck | All eight files' sizes and SHA-256, and `git status`, identical to before the run. No `.env`. Tunnel left intact. |

**The three passed tests (verbose lines):** `ISSUE-274: precondition: the matches-only authority prerequisites hold` (68 ms); `ISSUE-275: a refused foreign-owned matches target withholds the same unit's match_period_scores` (2587 ms); `ISSUE-275 positive control: a fresh fixture with no competing row still writes its match and period set` (3252 ms).
**Skips:** the 79 skipped lines are the cases the `-t` filter does not select (checked: none of them matches the filter; the log has 3 `✓`, 79 `↓`, and no failed, todo or selected-but-skipped case). The restricted-role case printed its own note that `AFLDB_TEST_IMPORT_DATABASE_URL` is not set; it is one of the 79 and was not selected.

**Source and test bytes under test (SHA-256 at the time of the run):** `canonical-apply.ts` `1C48778D...F914B` (75164 B); `tests/current-season-import.test.ts` `F905F688...C0417` (334087 B); `tests/integration/settle-afltables.test.ts` `E50D6B8E...CAAC` (295734 B). The DB-free results in §23 were not repeated this session.

**Evidence hashes (SHA-256, `run-20261013-105531-v2\`, taken 2026-10-13 after the run):**
`vitest.stdout.log` `D3F8CD5968C8A550B1107E2BE54FCBAAFABF9CE2CFB5C35379422051AD59395C`;
`census-0-baseline.json` `445BDFE47F0B22C48CA57EE10410A21FEA2498836619BA94689520D8B29401B5`;
`census-1-after.json` `FED9E53579C3794456C575FC8E670C0358D9219BF57631BE4A00D57B3B8B7A78`;
`compare.log` `C7C79A3AE64DF384499F0AFDFC2551F7102B9A3F15FEC654EC2DEB3214BF8694`;
`probe.stdout.log` `7D4088F762AB091C25E00E370C42FFEB8CB1CB91CD2E92552882D44F98229740`;
`pack-v2-hashes.txt` `3D38DDAFD289B999CB50D19FC8F019470F7F6702B99065DEF2790349A8E924A1`.

### 26.4 What this shows

In a real transaction with the real constraints, foreign keys, ledger and the `afldb_test` schema (110 migrations), on the ISSUE-275 fixtures: (1) when the competing foreign-owned row exists by the time the unit runs, the AFL Tables settle refuses `matches` and refuses the same unit's `match_period_scores` with exactly two refusals, no failure, no rows inserted or updated, no ledger row, no period row, the foreign-owned match untouched, no rekey counter and no `canonical_apply_failed` finding;
(2) a fresh fixture with no competing row still inserts its match and four period rows and two ledger rows, with the period rows owned by the match's source; (3) the read-only ISSUE-274 authority precondition still holds; (4) the cases left `afldb_test` byte-for-byte as found for every table the census fingerprints, including `match_period_scores` row content.

### 26.5 What this does not show (limitations; preserved)

- **Not two-session concurrency.** The competing row is planted by the hook inside the settle's own transaction. That fixes the ordering the defect needs but is a same-transaction planted-row witness, not an interleaving of two sessions.
- **No negative control on PostgreSQL.** The witness was shown to fail with the rule disabled only in the DB-free harness (§23.2); it was not run against `afldb_test` with the fix removed (not authorised, and not needed for the verdict above).
- **No DEV or PROD evidence, and no State B (durable Match Sheet) evidence.** No DEV or PROD host or database was contacted. The §15 split-ownership census is unrun.
- **Only 3 of 82 cases in the file ran.** The whole file, `settle-afl-api.test.ts` (the other settle sharing `canonical-apply.ts`), the restricted `afldb_import` role case and any other integration file were not run.
- **The `afl_api` owner is modelled** by the file's existing foreign `squiggle_api` source; E3 judges any non-`afltables` owner identically.
- **Instrument provenance:** no preparation-time `pack-v2` hash manifest (§26.2); the post-run hashes do not prove the reviewed helper bytes.
- **Known CRLF test failure remains separate** (§25): `tests/current-season-import.test.ts` "...reuses the four player-derived helpers...", independently reproduced on this tree and on a clean `D:\dev\afldb` checkout; ISSUE-275 neither causes nor fixes it, and it was not re-run in this session.
- **The earlier attempts' v1 census comparison is invalid** (§26.1) and is not part of this evidence.

## 27. Full review of the ISSUE-275 diff against its base `e315c1d3` (2026-10-13)

Scope: the whole six-file diff (650 insertions, 12 deletions): the source change, both test files, and the three documents. `git diff --check` exit 0 (re-run after these edits is recorded in the session report).

**Verdict: no CRIT, HIGH or MED finding.** The change does what §22 states, and the one PostgreSQL run in §26 agrees with the DB-free evidence.

- **Refusal invariant.** The new guard sits after the existing `fixtureBlocked` check and before E2, so every path that can leave a unit's `matches` target unapplied (§22.1) reaches it, or was already withheld by `fixtureBlocked` (rekey refusals, `possible_existing_match`, `rekey_override_conflict`). Every `continue` in the loop is preceded by a `results.push`, so a unapplied parent is always present when the dependent is reached. Deny-by-default: a refusal added later withholds without being listed.
- **Successful no-op.** Only `nothing_to_write` exempts the dependent, and the DB-free positive control (`matches` unchanged, period set still written with one ledger row) pins it. The only other `matches` `nothing_to_write` site (`:1337`) is unreachable for `matches` (§22.1 #10).
- **Metadata and counters.** The dependent carries the parent's reason, `applied` false, `verb` null, 0 rows, no ledger row, no period read; `ownerSourceKey` only when the parent's E3 refusal carried it (an E3 statement; the authority refusals carry none, and a test pins the absence). `fixtureBlocked`, `insertedMatchId`, `rekeyedMatch` and `overridesCarried` are untouched, so `settle-afltables.ts` opens no rekey finding and bumps no rekey counter (the witness asserts both stay 0). Consequence, by design and recorded in §22: `canonicalApplyRefusals` rises by one per withheld dependent in both settles; the AFL API settle also writes one F009 refusal finding and one refusal-evidence entry for it, so `evidence.length === canonicalApplyRefusals` still holds (both increment in the same loop). `matchWriteApplied` is now false for such a unit, so it no longer enters the derived recompute scope.
- **ISSUE-274 locking preserved.** The diff touches no statement before the guard: `lockUnitMatchRows`, the authority snapshot read and the `existingMatch` read are unchanged and in the same order, and the guard issues no statement (the withheld dependent issues one *fewer* read). The ISSUE-274 precondition case passes on PostgreSQL (§26.3). The pinned E3 refusal line scanned by `tests/db-promotion-check.test.ts` is untouched.
- **Ordering precondition (LOW, already disclosed in §22).** The guard reads only earlier results, so `matches` must precede `match_period_scores` in `unit.targets`. Re-verified: `MATCH_TARGET_TABLES = ['matches', 'match_period_scores']` (`settle-afltables.ts:159`) and `settle-afl-api.ts:1519` (`matches`) before `:1550` (`match_period_scores`). No test pins the order; a future builder that reversed it would bypass the rule silently. Not fixed here; recorded as the one residual risk.
- **Tests.** 15 DB-free cases (counted in the diff: 2 + 1 + 1 + 1 + 4 + 1 + 1 + 1 + 3) and 2 PostgreSQL cases. The `it.todo` is replaced. The witness is not vacuous (`canonicalApplyRefusals === 2`, planted id non-null) and the positive control asserts rows, owner and ledger. No existing test was deleted, skipped or weakened.
- **Documentation.** Consistent with §26 after this edit; the remaining "NOT RUN" wording in earlier sections is dated history and marked superseded.

## 28. Remaining requirements (current; supersedes §21 items 1 and 6)

1. **Commit** the reviewed change locally (operator; see the proposed scope in the session report), then `npm run merge:ready -- --issue 275`, then merge/push. Nothing is committed, merged, pushed or deployed.
2. **Hold the DEV install** until the ISSUE-274 + ISSUE-276 combined nightly observation window closes (14 October nightly and every later night while ISSUE-276 remains installed on DEV). On DEV, all 218 2026 matches are `afltables`-owned and the AFL API builds no period target for a corroborated match, so this change is not expected to alter a DEV nightly's counters, which is a further reason to keep the observation clean rather than a reason to install early. **PROD stays behind the ISSUE-265 hold.**
3. **DEV acceptance after install** (own nightly observation) and **State B durable Match Sheet** behaviour: unrun.
4. **§15 split-ownership census** (period rows whose `source_id` differs from the parent match's) on DEV and PROD: unrun; the fix is forward-only and repairs nothing already written.
5. **Optional wider guard** (§20 step 3, owner's call): the whole `settle-afltables.test.ts` and `settle-afl-api.test.ts`, each with its own before/after census using `pack-v2`.
6. **Optional:** a test that pins the `matches`-before-`match_period_scores` order, and a PostgreSQL negative control for the witness. Neither is required by the verdict; neither is scheduled.
7. The CRLF baseline test failure (§25) remains the owner's call to register.
8. **ISSUE-275 stays Open** until the change is merged and the DEV nightly observation and census are done.
