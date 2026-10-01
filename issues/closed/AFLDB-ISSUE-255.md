# AFLDB-ISSUE-255 — AFL API unused-emergency `player_match_stats` suppression

**Status:** RESOLVED (2026-10-01). **Severity:** Medium (blocked AFLDB-ISSUE-232 D2). **Opened:**
2026-10-01, split out of AFLDB-ISSUE-232 §7 D1b by operator decision. **Branch/worktree:**
implemented in `D:\dev\afldb-issue-232` (`sonnet/issue-232`, base `6661eb66`) together with the
ISSUE-232 blocker record; committed as `f6d189d0`. **State:** implementation validation COMPLETE
(DB-free, typecheck, lint delta and the focused `afldb_test` integration case all pass), deployed to
DEV at `f6d189d0`, and accepted by a fresh authentic ISSUE-232 D1b plus the first observed systemd run
(§7). No PROD work was authorised or performed.

## 1. Defect (authentic, DEV, 2026-10-01)

- **Where found:** ISSUE-232 §7 D1b, snapshot `afl-api-2026-2026-10-01-094537`. That dry-run
  proposed `canonicalRowsInserted` 1, `canonicalRowsUpdated` 0 and `canonicalApplicationsLogged` 1.
- **The row:**
  - `external_record_id` `CD_M20260140305|CD_T50|CD_I993799`: Brayden Fiorini, Essendon v North
    Melbourne, 2026-03-28 (canonical match 17214), `player_id` 2121.
  - Roster position `EMERG`. `timeOnGroundPercentage` 0.0. Every statistic the AFL API projects
    into `player_match_stats` is 0.
- **Arithmetic:** 10,029 snapshot rows = 9,992 identical + 36 known `afltables`-owned refusals + this
  1 row.
- **Canonical truth:** the canonical database correctly has no row for him, because he did not play
  (ISSUE-233 §4.11.11).
- **Cause:** the AFL API settle had no non-participation distinction. Every player-stats entry became
  a `player_match_stats` proposal, and nothing read `timeOnGroundPercentage`.
- **Effect if applied:** an `afl_api`-owned row recording a game that was never played (a career game
  plus a `career_game_no` renumbering), inside an `afltables`-owned match.

## 2. Decisions (operator, 2026-10-01; implemented, not reopened)

- **D-255-1, the predicate.** A row is a non-participant only when ALL of these hold:
  1. the match roster names that provider player exactly once, on the stat row's own team, at
     position exactly `EMERG`;
  2. `playerStats.timeOnGroundPercentage` is exactly the number 0;
  3. every statistic projected into canonical `player_match_stats` is exactly the number 0.

  It does not use `EMERG` alone, zero TOG alone, an all-zero vector alone, `gamesPlayed`, or the
  player-stats payload's own copy of `position`. Anything absent, ambiguous, null or non-zero stays
  on the existing path.
- **D-255-2, representation.** The row stays in the raw snapshot and the observation spine. It does
  not propose, insert, write a ledger row, project a typed staging row, enter the derived
  recompute, or create a candidate, rejection or data issue. It is not deferred.
- **D-255-3, visibility.** A new counter, `nonParticipantPlayerRows`. Source completeness is unchanged.
- **D-255-4, controls.** Played `EMERG` rows (ISSUE-233: four rows, 34–85% TOG) stay normal. Cases
  A–E are covered.
- **D-255-5, scope.** Ownership, corroboration, foreign-owner refusals, ISSUE-233 rollover,
  ISSUE-232 units, Brownlow and identity resolution are all untouched.

## 3. Implementation

**Representation chosen: a fifth player-plan status, `non_participant`, decided in the read-only
planner.**
- `buildAflApiSettleRecords()` is unchanged, so the row remains an ordinary `player_match_stats`
  settle record (projection set, no deferral, no rejection).
- `settleMatchUnit()` persists every settle record to the spine (`persistSourceObservation`) and
  counts it in `snapshotPlayerMatchRows` BEFORE planning. So the observation and the completeness
  enumeration are retained by construction, never dropped before accounting.
- The planner then classifies the row, and `settlePlayerUnit()` returns after counting it.

**Order inside `planPlayerUnit()`:**
1. deferral and blocked-match handling (unchanged; a deferred roster still defers);
2. the structural `provider_team_id_unknown` gate (unchanged);
3. **the non-participant test**;
4. identity resolution.

Classifying before identity is deliberate. A row that can never be written needs no canonical
player. An unused emergency who has not debuted has no canonical row an AFL API identity could ever
be bridged from, so resolving first would leave a permanent `unresolvedIdentityPlayer`, a candidate
and a rejection for a row that is not a game. The resolver itself is unchanged.

**Files:**
- `src/lib/acquisition/afl-api-bundle.ts`:
  - `AflApiPlayerMatchStatsProjection.timeOnGroundPercentage` is read leniently: a finite number, or
    else `null`, so fractional percentages are kept and no new build failure is introduced. A
    structurally new shape, such as an object, is still refused by the existing family-contract gate.
  - New: `AFL_API_EMERGENCY_POSITION` and `isAflApiNonParticipant(stat, roster)`. The statistic set
    is every projection key except the five identity/evidence keys, so a statistic added later is
    covered in the conservative direction.
- `src/lib/acquisition/afl-api-settle-plan.ts`: the plan variant `{ status: 'non_participant',
  providerPlayerId }`, and `planPlayerUnit()` now receives `bundle.roster`.
- `src/lib/acquisition/settle-afl-api.ts`:
  - the counter `nonParticipantPlayerRows`, carried into `import_batches.validation_result`;
  - it is not a full-rollback durable counter, because it is a classification and survives a
    rollback like the input facts;
  - the early-return branch in `settlePlayerUnit()`, placed before every write call.
- `tools/current-season/settle-afl-api.ts`: the CLI prints the counter under
  "Participation (AFLDB-ISSUE-255 — informational, never a failure)".
- `tests/afl-api-settle-plan.test.ts`, `tests/afl-api-match.test.ts`,
  `tests/afl-api-ingestion-safety.test.ts`: DB-free coverage.
- `tests/integration/settle-afl-api.test.ts`: the new case id `CD_M2026ISSUE228N255` (2026-06-02).

**No migration, no registry change, no unit or timer change.**

## 4. Validation

**DB-free (2026-10-01): 498/498 across the focused suites.**

| Suite | Result |
|---|---|
| `afl-api-settle-plan` | 45/45 |
| `afl-api-match` | 206/206 |
| `afl-api-ingestion-safety` | 165/165 |
| `admin-current-season-settle` | 58/58 |
| `deploy-web-unit` | 24/24 |

`npx tsc --noEmit` is clean.

**What the DB-free tests cover:**
- **Fiorini-shape regression (planner).** An extra home row with roster `EMERG`, TOG 0.0, all
  statistics 0, `extendedStats` null and `gamesPlayed` null plans as `non_participant`.
  - No `external_identities` query is issued for it.
  - The played rows plan normally.
  - Its settle record still exists, with no deferral and no rejection.
- **Boundary cases (D-255-4):**
  - A (`EMERG` + TOG 0 + all 0) → non-participant;
  - B (`EMERG` + TOG 34/85/0.5, and `EMERG` + TOG 12 with all-zero statistics) → planned;
  - C (one non-zero statistic: tackles, one-percenters, clearances) → planned;
  - D (HBFL, INT, lowercase `emerg`, `"EMERG "`) → planned;
  - E (TOG null, missing, or the string "0") → planned.
- **Also planned (stricter edge cases):**
  - a null statistic;
  - `EMERG` only in the player-stats position copy;
  - the player absent from the roster, named twice, or named `EMERG` on the other team.
- **Deferral precedence:** a non-CONCLUDED roster still defers the row.
- **Predicate and emitter:**
  - each condition alone is insufficient;
  - the 21 projected statistic keys are each required to be 0;
  - jumper number is not a statistic;
  - TOG parsing (81, 85.5, null/"0"/NaN/missing → null; an object → the existing undeclared-column
    refusal).
- **Writer source contract:**
  - the branch is exactly `counters.nonParticipantPlayerRows += 1; return;`;
  - it precedes every write call (`projectAflApiPlayerMatch`, `applyCanonicalUnit`,
    `applyUnitOutcome`, `writePromotionCandidate`, `writeImportRejection`,
    `writeMatchIdentityIssue`, `closeMootApplyFinding`, `derived.playerIds.add`);
  - the spine is persisted before planning;
  - the completeness rejection expression is unchanged;
  - the counter is not zeroed by a full rollback;
  - the CLI prints the counter.
- **Batch evidence:** F004 (full rollback) and F008 (`validation_result`) carry the counter.

**Operator validation (final, operator-run).**

| Check | Result |
|---|---|
| Focused DB-free (`afl-api-settle-plan`, `afl-api-match`, `afl-api-ingestion-safety`) | 416/416 PASS |
| `npx tsc --noEmit` | PASS |
| `git diff --check` | PASS |
| Lint, `no-explicit-any` vs base `6661eb66` | `afl-api-match` 3 -> 3; `afl-api-settle-plan` 3 -> 3; `integration/settle-afl-api` 19 -> 19; zero new findings |

The earlier 498/498 figure also included `admin-current-season-settle` (58) and `deploy-web-unit`
(24); the 416 is the three suites above (45 + 206 + 165).

**Integration (`tests/integration/settle-afl-api.test.ts`): PASS 1/1.**
- **Target proof (before the run):** `AFLDB_TEST_DATABASE_URL` = `afldb_test` / `afldb_owner`;
  `AFLDB_TEST_IMPORT_DATABASE_URL` = `afldb_test` / `afldb_import`; `DATABASE_URL` = `afldb_test` /
  `afldb_owner`; `AFLDB_IMPORT_DATABASE_URL` = `afldb_test` / `afldb_import`.
- **Command:** `npx vitest run tests/integration/settle-afl-api.test.ts -t "AFLDB-ISSUE-255"`.
- **Result:** 1/1 ISSUE-255 test passed, 70 unrelated tests skipped, about 13.3 s.
- **Earlier attempt:** an earlier attempt collected 0 tests because the tunnel listener on
  `127.0.0.1:55432` was down; that was environmental, not an implementation failure.

The case asserts:
- an apply with the extra row gives `snapshotPlayerMatchRows` 3, `nonParticipantPlayerRows` 1,
  `unresolvedIdentityPlayer` 1 (the suite's deliberately unbridged away player only) and 0 apply
  failures;
- the spine row exists;
- for the row, there is no typed projection, `canonical_applications`, `promotion_candidates`,
  `import_rejections` or `data_issues` row;
- the match's `player_match_stats` is exactly the played bridged player (kicks 9);
- `validation_result` carries `nonParticipantPlayerRows` 1;
- an identical replay inserts and updates 0 and still writes nothing for the row.

**Lint:** no new finding in production code. The new test helpers (`rosterEntryOf`,
`statsEntryOf`, `zeroNumericLeaves`, `withUnusedEmergency`, the `projectionOf`/`zeroed` helpers and
the `stats` mutator parameter) use narrow raw-feed interfaces. Measured delta against base: zero new
`no-explicit-any` findings (table above).

**Not yet proved:** deployment to DEV and the authentic ISSUE-232 D1b rerun (§6). The integration
pass does not resolve this issue.

## 5. Findings

- **INFO: no residue to repair.** The fix prevents a future write but does not remove an
  `afl_api`-owned phantom row that an earlier apply might have committed. None is known:
  - DEV has zero AFL API settle batches (ISSUE-232 §7 B);
  - DEV and `afldb_test` hold zero `afl_api`-owned matches (ISSUE-233 pass 5, ISSUE-232 D1a);
  - PROD has never run the AFL API settle.
- **INFO: the ISSUE-228 design check needs restating.** Its check "Σ roster positions minus `EMERG`
  == stat-row `playerId` set" (`issues/closed/AFLDB-ISSUE-228.md`, validation item 7) assumed an
  unused emergency is absent from the stats feed. The authentic feed contradicts it, which is the
  shape this issue now handles.
- **LOW:** the lint note in §4.

## 6. Acceptance (after deployment; operator-run; not done)

1. The operator reviews and commits; then merge and `deploy/sync-dev.ps1`.
2. The integration case above, against `afldb_test`.
3. **A fresh ISSUE-232 §7 D1b** on DEV: a new acquisition and a new label, then
   `settle-afl-api.ts --dry-run --auto-apply --require-complete-source`. It must show:
   - `snapshotMatches` 218, `seasonFeedMatches` 218, `seasonFeedComplete` 1,
     `corroboratedForeignOwned` 218;
   - `unresolvedIdentityMatch` 0, `unresolvedIdentityPlayer` 0, `foreignOwnedCollision` 0,
     `sourceDisagreement` 0;
   - **`canonicalRowsInserted` 0, `canonicalRowsUpdated` 0**, `canonicalApplyFailures` 0;
   - **`nonParticipantPlayerRows` 1**;
   - source completeness COMPLETE.

   The 36 known `afltables`-owned `player_match_stats` refusals may remain, with an unchanged
   classified census.
4. Then ISSUE-255 can be resolved, and ISSUE-232 may proceed to D2.

## 7. Acceptance result (2026-10-01): PASSED, RESOLVED

Operator-run on DEV at `f6d189d0`. Every §6 criterion was met.

**Fresh D1b** (snapshot `afl-api-2026-2026-10-01-104329`; dry-run, rolled back fully):
- snapshot: `snapshotMatches` 218, `snapshotPlayerMatchRows` 10,029; season feed:
  `seasonFeedMatches` 218, `seasonFeedComplete` 1; source completeness COMPLETE;
- identity and ownership: `corroboratedForeignOwned` 218, `unresolvedIdentityMatch` 0,
  `unresolvedIdentityPlayer` 0, `foreignOwnedCollision` 0, `sourceDisagreement` 0;
- **`nonParticipantPlayerRows` 1** (the Fiorini row, `CD_M20260140305|CD_T50|CD_I993799`);
- writes: **`canonicalRowsInserted` 0, `canonicalRowsUpdated` 0**, `canonicalApplicationsLogged` 0,
  `canonicalApplyFailures` 0;
- derived: `derivedRecomputeRuns` 0, `derivedRecomputePlayers` 0 (the halted run showed 1/1, so the
  phantom row no longer reaches the recompute);
- `canonicalApplyRefusals` 36: the known `afltables`-owned `player_match_stats` foreign-owner class
  (ISSUE-232 §7 D1b result). **Classified and expected, not a failure;** the census is unchanged
  from the halted run.

**Confirmation by the first applying run** (ISSUE-232 D2, systemd, label
`afl-api-2026-2026-10-01-104846`): import batch 95 committed, 218 matches / 10,029 player rows,
`nonParticipantPlayerRows` 1, `canonicalRowsInserted` 0, `canonicalRowsUpdated` 0,
`canonicalApplicationsLogged` 0, `canonicalApplyRefusals` 36, `canonicalApplyFailures` 0, derived
recompute 0/0, source completeness COMPLETE. D3 then confirmed on `afldb_dev` that all 218 2026
matches are `afltables`-owned, `afl_api`-owned matches in any season are 0, and the Fiorini phantom
`player_match_stats` row count is 0.

**Resolution:** the root cause (the AFL API settle turned every player-stats entry into a proposal, so
an unused emergency's all-zero placeholder would be recorded as a game played) is fixed by the
`non_participant` plan status (§3). No residue existed to repair (§5). No follow-up issue.
