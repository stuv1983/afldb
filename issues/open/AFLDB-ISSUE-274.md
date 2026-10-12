# AFLDB-ISSUE-274 — A settle unit that writes only the `matches` row takes no row lock before its authority read

## 0. Status

- **Status:** Open (2026-10-08). **2026-10-11: fix and DB-free tests implemented LOCALLY (uncommitted, branch `opus/issue-274` from `416f5f27`); integration scenarios written but NOT run; no PostgreSQL evidence yet. See §17. 2026-10-12: final corrections before integration, §20 (late candidate refused unlocked; bounded controls; cleanup gate; revised probe). 2026-10-12 (§22-§23): the original probe FAILED at State A; the four cases do NOT need migration 110 (they only inherited it from the durable wrapper) and were moved to their own describe, with a separate matches-only probe MO-1 (not run).** **Current status (2026-10-12, after §30): R3 (whole `settle-afl-api.test.ts`) is COMPLETED, 72/72 passed once on `afldb_test` (State A; 1 NOT EXERCISED; `club_seasons` 2026 rewritten by the suite's hook). R2 remains a failed run attributed to ISSUE-315. Next: local commit, DEV installation and acceptance (all still ahead), sequenced with ISSUE-275 (separate, unfixed); State B, the overlapping-settle cycle and the late-candidate case on PostgreSQL remain unrun. ISSUE-265 PROD hold unchanged.** **Update 2026-10-12 (§31): the change was committed and fast-forwarded to main as `6f99b58d` with an owner-authorised merge-readiness EXCEPTION (not a clean pass); the DEV deployment and acceptance pack is PREPARED and NOT executed (DEV is still at `a34f0721`; no DEV evidence for this change exists yet).** **Update 2026-10-12 later (§32): `6f99b58d` is INSTALLED on DEV (BUILD `kKfU7VKifbsWyPAAurnUU`, installation checks PASS) and the synthetic behavioural acceptance gave VERDICT FIXED for both scenarios. The acceptance driver's first cleanup FAILED and rolled back (driver FK-order defect, §32.3); an FK investigation found two derived `club_seasons` rows (ids 1751/1752) that also blocked the season delete (§32.4); an owner-authorised cleanup revision 1 deleted them with the namespace and SUCCEEDED (§32.5-§32.6); S-1 versus S-0 gives compare exit 5 (all 99 table comparisons matched) with one review item, `club_seasons_id_seq`, an observed advance of four (1748 -> 1752) that the owner accepted as recorded, and `club_seasons` back to 1,640 rows with the identical content hash (§32.7, §32.12); the health check passed (§32.8). Next: the documentation commit now; the first-nightly check (13 Oct 05:02:27 AEDT) stays PENDING. Open; PROD not deployed (ISSUE-265 hold). UPDATE 13 Oct: the first scheduled nightly was OBSERVED clean at `6f99b58d` (section 33; one night; 64 refusals before and after with 0 canonical failures, inserts, updates and ledger writes; lock execution NOT PROVEN; the 14 Oct nightly will be a combined ISSUE-274 + ISSUE-276 observation; the other listed limits remain).**
- **Severity:** Medium. **Area:** acquisition / settle concurrency / manual authority.
- **Key file:** `src/lib/acquisition/canonical-apply.ts` (`lockUnitMatchRows`, `applyCanonicalUnit`, the writers).
- **Origin:** full code review at `20a7a4bbdea835cdd3fc5520e65ad47d275bd881` (`issues/reviews/2026-10-08-full-code-review.md`, F-009; partition note R4a-F01). The orchestrator re-read `canonical-apply.ts:490-506` and confirmed it.
- **Classification:** code-proven mechanism. The concurrent interleaving has not been executed.

## 1. Summary

`lockUnitMatchRows` locks the match row only when a retired-identity rekey candidate exists, or when the unit carries a `player_match_stats` target. A unit whose targets are `matches` and/or `match_period_scores` therefore reads manual authority (E4) and re-reads the row (E5) without any lock, and only then issues `UPDATE matches`. A Data Editor score edit that commits in between is overwritten by the source value, while its `data_overrides` row stays active.

## 2. Evidence

- `src/lib/acquisition/canonical-apply.ts`:
  - `:490-506`: the lock is taken only for a rekey candidate (`:491-501`) or a `player_match_stats` target (`:503-505`).
  - `:1026`: `loadManualAuthority`.
  - `:516-518`: an unlocked `SELECT * FROM matches`.
  - `:1106-1112`: E5. `:1165-1185`: E4.
  - `:807-811`: `UPDATE matches … WHERE id`. The writers return `rowsUpdated: 1` without checking the count (`:807-811`, `:891-895`, `:931-935`).
  - The module's own rule (`:14-17`, `:1021-1024`) says authority must be read under a lock that excludes a concurrent human write.
  - `applyAttendanceEnrichment` already does this: `FOR UPDATE` at `:1394-1401` before `loadManualAuthority` at `:1427`.
- `src/db/queries/data-edits.ts:205, :250, :314, :388, :428`: the editor takes `FOR UPDATE`, applies the edit, and upserts the override in one transaction.
- `issues.md:47708` (ISSUE-261 writer table) describes every settle unit as holding the match row `FOR SHARE`. That is true only for player and rekey units.

## 3. Trigger

1. The nightly settle (`--auto-apply`) carries a corrected score for match M.
2. A super admin's Data Editor score edit on M commits after the unit's authority load but before (or while blocking) the unit's UPDATE.

## 4. Expected invariant

A human edit committed during a settle is never overwritten. Authority and baseline are read under a lock as strong as the unit's own write.

## 5. Actual behaviour

Under READ COMMITTED the settle's UPDATE waits, re-evaluates only `id = $1`, and writes the source value over the human's. Later runs see no diff (`nothing_to_write`), so the human value is never restored. The `canonical_applications` row records stale `previous_values`. A concurrent `deleteMatch` in the same window makes the unit log and count an update to a row that no longer exists.

## 6. First wrong layer

`src/lib/acquisition/canonical-apply.ts:490-506`.

## 7. Impact

Silent loss of a human-pinned canonical value, leaving a self-inconsistent state (override active, canonical value from source) and a wrong ledger. The window is narrow, but it is the same race class ISSUE-257 §18.6 item 5 fixed for player rows.

## 8. Reproduction / witness

Not executed. It needs two sessions. See §14.

## 9. Disproof attempts

- E5 compares two reads that both precede the editor's commit.
- E4 is read before the wait.
- The ISSUE-265 settle/promotion gate is not taken by the Data Editor.
- No deadlock or timeout fires.

## 10. Existing-issue search

- ISSUE-257 scoped its lock to Match Sheet and player rows. ISSUE-261 covers the recompute deadlock.
- Classification: **new**, a scope gap adjacent to resolved ISSUE-257 (not a regression).

## 11. Scope

The lock taken by `lockUnitMatchRows` for `matches` and `match_period_scores` targets, and the writers' affected-row checks.

## 12. Out of scope

The Data Editor side, which already locks first.

## 13. Proposed fix boundary

- When the unit carries a `matches` or `match_period_scores` target that resolves to a row, lock that row (`FOR NO KEY UPDATE` or `FOR UPDATE`) before `loadManualAuthority`.
- Make the three writers return the driver's count and treat 0 as `write_failed`.
- Lock order matches the editor and `deleteMatch` (match row first).

## 14. Proposed validation

1. DB-free: a statement-recording `sp` asserting that a lock precedes the authority load for a `matches`-only unit.
2. Integration: editor transaction locks → settle unit → editor commits. Assert the canonical value equals the editor's and that no ledger row was written.

## 15. Decisions / unresolved questions

- Amend the ISSUE-261 writer table wording when this is fixed.

## 16. Next action

Code fix plus tests. Consider sequencing with AFLDB-ISSUE-275 (same function).

(Superseded by §17.)

## 17. Implementation record (2026-10-11, LOCAL, uncommitted)

### 17.1 What changed (`src/lib/acquisition/canonical-apply.ts`)

- `lockUnitMatchRows`: after the existing rekey branch (a retired candidate keeps `FOR UPDATE ... ORDER BY id`), a unit with a
  `matches` or `match_period_scores` target takes `SELECT id::int AS id FROM matches WHERE match_key = <incoming> FOR NO KEY UPDATE`
  and returns; a `player_match_stats` unit keeps `FOR SHARE`; a Brownlow-only unit takes no match lock. The call site is
  unchanged: the lock runs before `loadManualAuthority`, before the `existingMatch` read and before `readFreshTarget`.
  **Amended 2026-10-11 (§19.1):** `lockUnitMatchRows` now returns the ids of the retired candidates it locked, and
  `readFreshTarget` refuses (`stale_canonical_target`, nothing written) a retired candidate outside that set, so no row the
  unit modifies can have been first locked after the authority snapshot. **Amended again (§20):** that refusal's search is
  UNLOCKED, so a refused late candidate is not locked at all, and the lock-order statements below are scoped accordingly.
- `requireRowUpdated` (new): the three `UPDATE` writers (`matches`, `player_match_stats`, `brownlow_round_votes`) throw a
  contract error when the driver's `count` is 0, so the unit rolls back as `write_failed` (a `canonical_apply_failed`
  finding) with no ledger row. The check is `count === 0`, not `!== 1`: an update by primary key touches one row or none, and
  the unit-test fakes return plain arrays with no `count`.
- Lock order: the match row first, as the Data Editor, `deleteMatch` and the Match Sheet take it. One match row per
  non-rekey unit, so there is nothing to order within a unit. Across units the existing run order applies and differs by
  settle (§18.2): the AFL Tables settle runs every match-family unit, then every player unit; the AFL API settle runs
  each match's match unit, then that match's player units. In both, a unit's `FOR SHARE` after the same run's `FOR NO KEY
  UPDATE` on that match is not an upgrade. Across the two settles the visit orders are not shown to agree (§18.2).
- Lock strength: `FOR NO KEY UPDATE` is what the unit's own non-rekey `UPDATE matches` takes, because that UPDATE sets no
  column of a unique index (see §18.1; **corrected 2026-10-11**: this entry first said `match_key` was "the only unique
  column besides `id`"; migration 003 also makes `legacy_match_id` UNIQUE, and neither is in any non-rekey SET list). So
  nothing is upgraded later by the unit's own write. It conflicts with `FOR UPDATE` (editor, `deleteMatch`, Match Sheet) and with
  `FOR SHARE` (the other settle's player unit); it does not block child-row `FOR KEY SHARE` from FK checks.
- Refusal behaviour: unchanged vocabulary. After the lock, an edit committed by a human is in the unit's snapshot, so the
  unit refuses `stale_canonical_target` (the rendered fields moved) or `manual_authority_conflict` (only the override
  moved). A match deleted during the wait locks nothing, reads as `new_target` against a non-null expected baseline, and
  refuses `stale_canonical_target`; nothing is inserted or reported as updated.
- Not changed: `applyAttendanceEnrichment` already locks `FOR UPDATE` before `loadManualAuthority` (verified in code).

### 17.2 Paths checked

`applyCanonicalUnit` is the only writer of `matches` / `match_period_scores` besides `applyAttendanceEnrichment` (grep of
`src/lib/acquisition`). Callers: AFL Tables settle (`settle-afltables.ts` one call), AFL API settle (`settle-afl-api.ts`:
match family and player unit) and the Brownlow path (`afl-api-brownlow.ts`, Brownlow-only: no match lock, count backstop
only). A key with no row yet locks nothing (an INSERT adopts no row).

### 17.3 Validation

DB-free (this worktree, Windows): `tests/current-season-import.test.ts` new cases (all pass): lock statement order for
`matches`-only, `match_period_scores`-only and family units; one lock only; new fixture; rekey with and without a retired
candidate; two model interleavings of an editor commit while the unit waits (override alone, and the proposed field moved);
a deleted match; count-0 for each of the three writers; and (added 2026-10-11, §18.1) a guard that a non-rekey `UPDATE
matches` sets none of `id`, `match_key`, `legacy_match_id`. Mutation checks, one at a time in an isolated copy (§18.6): each
removal or injection makes exactly the cases that depend on it fail.
The existing source-scan test that pins "no UPDATE patch carries `source_id`" had its regex widened for `const updated = await sp`
(same assertion, same three tables).

Full DB-free suite (`vitest run --exclude 'tests/integration/**'`): 10 failed tests in 8 files plus 2 files that fail to load.
**Baselined 2026-10-11 (§18.4): the identical 12 fail on an unchanged export of `416f5f27`; none is introduced by this change.**
(The first version of this paragraph called them "environmental or stale pins" without a baseline; §18.4 replaces that with the
measured cause of each, and only some are environmental.) `npm run typecheck`: exit 0. ESLint on the three changed files:
clean (repo-wide `npm run lint` has 253 existing errors elsewhere). `git diff --check`: clean.

### 17.4 Integration (written, NOT executed)

> **Superseded in part by §19 (2026-10-11).** The harness described below was reworked (§19.2) and the command block at the
> end of this section is replaced by the guarded procedure in §19.3. The selection `-t "ISSUE-274"` now yields **4 passed
> + 1 todo** (a precondition test was added), not 3. Nothing here has been executed.

New in `tests/integration/settle-afltables.test.ts`, inside "Durable Match Sheet authority through the settle":

1. `ISSUE-274: a Data Editor score edit committed while a matches-only unit is in flight is not overwritten`. A side session
   holds the match row `FOR UPDATE` (the editor's protocol), the settle is started behind it, the blocked statement is read
   from `pg_stat_activity` and must contain `FOR NO KEY UPDATE` (before the fix it was the final `UPDATE matches`), then
   the holder commits an edit plus an active `score` override. Asserts: the editor's `home_score` (112) stands, the override
   is active, `canonicalRowsUpdated` 0, and the only `matches` ledger row is the seed's `insert`.
2. `ISSUE-274: a match deleted while a matches-only unit waits for its lock is not counted as updated`: same harness; the
   holder deletes the period scores and the match. Asserts no match row, 0 updated, and only the seed's ledger row.
3. `ISSUE-274: the driver reports count 0 for an UPDATE that matches no row` (added 2026-10-11): the one place the REAL driver's
   `count` is checked, because the writers' backstop reads it and the DB-free cases feed it a fake result.
4. `it.todo` for the ISSUE-275 acceptance case (kept visible; not part of this fix).

The helper behind 1 and 2 was reworked 2026-10-11 (§18.5): both background operations are tracked from the moment they start, the
holder is released first on every path, and both are awaited (bounded) before any assertion on, or cleanup of, the fixture.

Run these only against `afldb_test` (database name must end `_test`; the suite derives the real writer's DSN from it; do not
copy `.env` into the worktree). From `D:\dev\afldb-issue-274`, PowerShell, with the operator's own DSN already in the session:

```powershell
$env:AFLDB_TEST_DATABASE_URL = '<afldb_test owner DSN, normally via the 55432 tunnel>'
npx vitest run tests/integration/settle-afltables.test.ts -t "ISSUE-274"
# then the whole file (the lock changes every settle unit; R-01 and the rekey cases exercise it):
npx vitest run tests/integration/settle-afltables.test.ts
# other callers of the same applier and the lock-footprint tests:
npx vitest run tests/integration/settle-afl-api.test.ts tests/integration/settle-promotion-deadlock.test.ts
```

Expect: the first command 3 passed (+1 todo); the second no new failures against a baseline run of the same file on `main`
(§18.7 gives the exact, extended command list, including the baseline run from the isolated export).
If scenario 1 fails on its first assertion, the settle did not block on the lock (the blocked query is printed in the
failure); if it fails on `home_score`, the editor's value was overwritten.

### 17.5 Open and not claimed

- **D-274-1 (owner; APPROVED 2026-10-12, see §21; the PENDING/provisional wording below is history):** keep `FOR NO KEY UPDATE`,
  or take `FOR UPDATE` for symmetry with the editor. The factual consequences of the provisional choice are in §18.2-§18.3.
  In short: a match-family unit that refuses after the lock (stale baseline, foreign owner, authority conflict) now keeps the
  match row until the settle's single transaction commits, where before it took no lock; a unit that FAILS rolls back to its
  savepoint and releases it. A written row was already held to commit before this change, so only refused units widen the
  footprint. The earlier wording here ("the unit is the victim ... retried next run") is replaced by §18.3: a `40P01` inside a
  unit is absorbed by the unit savepoint, there is no in-run retry, and a later retry is possible only if a later run happens.
  The ISSUE-265 gate is deliberately SHARED and does not serialise the two settles. Not measured.
- The `existingMatch` read after a no-row lock can still see a row created in between (ISSUE-275's window).
- PostgreSQL behaviour of the two scenarios is unproven until §17.4 is run.
- No CHANGELOG entry yet: nothing is committed or validated. Add one when this is retained.
- ISSUE-261 writer-table row amended in `issues.md` (original wording kept above it).

## 18. Pre-integration review (2026-10-11, solo; local files only: no database, host, migration, commit, push or deploy)

D-274-1 stays PENDING; `FOR NO KEY UPDATE` is kept provisionally. Everything below is from reading code or from DB-free runs.
**Nothing here is PostgreSQL evidence.**

### 18.1 Does any non-rekey `UPDATE matches` need the stronger `FOR UPDATE`?

PostgreSQL takes `FOR UPDATE` (not `FOR NO KEY UPDATE`) for an UPDATE only when it changes a column of a unique index that a
foreign key could use (non-partial, no expressions); every other UPDATE takes `FOR NO KEY UPDATE`.

- **Unique columns of `matches`** (migrations read: 003, 020, 022, 032, 064, 085; repo-wide grep for any other
  unique/partial/expression index on `matches`: none): `id` (primary key), `legacy_match_id UNIQUE` and `match_key text NOT
  NULL UNIQUE` (`003_matches.sql:20-23`). Everything else in 003/020/022/085 is a plain index or a CHECK. The earlier text in
  §17.1 ("`match_key`, the only unique column besides `id`") was wrong about `legacy_match_id`; corrected above.
- **What a non-rekey UPDATE sets** (`writeMatch`: `plan.newValues` + `provenanceForUpdate` + `imported_at`):
  - AFL Tables: the changed subset of `proposedMatchValues` (`settle-afltables.ts:1206`): `round_code`, `round_number`,
    `round_type`, `is_final`, `match_date`, `match_time`, `venue_id`, `venue_raw`, `home_club_id`, `away_club_id`,
    `home/away_goals/behinds/score`, `result`, `winner_club_id`, `margin`, `attendance`, `attendance_status`,
    `attendance_source_id` (22 fields; pinned by the existing `MATCHES_PROPOSED_FIELDS` test).
  - AFL API: the same minus the three attendance fields (they are INSERT-only), and the applier is handed the
    identity-split subset (`splitMatchIdentityChange`, `settle-core.ts:999`), so it receives neither `match_key` nor the
    `MATCH_IDENTITY_FIELDS`.
  - Provenance: `source_record_id`, `import_batch_id`, `imported_at` (not in any unique index). `source_id` is never in an
    UPDATE (§19.1(e), pinned by an existing source scan).
- **`match_key` is in a proposal only on the rekey path** (`withRekeyRendering`, `settle-afltables.ts:2899`), which
  already locks `FOR UPDATE ... ORDER BY id`. The AFL API settle never rekeys (`matchRekey: null`, `settle-afl-api.ts:1590,
  :1803`). `id` and `legacy_match_id` are never written by the applier.
- **Verdict:** no non-rekey UPDATE changes a column that needs `FOR UPDATE`, so `FOR NO KEY UPDATE` is the lock the unit's own
  write takes and nothing is upgraded by it. New DB-free guard: `MATCHES_PROPOSED_FIELDS` contains none of the three, and the
  UPDATE statement a matches-only unit issues contains none of them (mutation-checked, §18.6).
- **Residual (first recorded here as "pre-existing, not fixed here"; REVERSED 2026-10-11, now fixed, §19.1):**
  `lockUnitMatchRows` searches for retired candidates UNLOCKED; if none is found it takes the incoming-key lock, and
  `readFreshTarget` then re-derived candidates under `FOR UPDATE` (**§20: it no longer locks; it re-derives unlocked and
  refuses a candidate outside the set locked first**). A candidate that appeared in between was locked only after
  the authority snapshot, so that rekey had the original ISSUE-274 window. It is the same defect, in a unit this issue
  covers, and is closed by refusing such a unit (§19.1).
- **To confirm on a real catalogue** (read-only, `afldb_test`): the catalogue query in §18.7 step 1 should list exactly
  `matches_pkey`, `matches_legacy_match_id_key` and `matches_match_key_key` as unique indexes.

### 18.2 Lock ordering across both settle transactions

Both settles are ONE `sql.begin`. Row locks are held to commit or rollback of the whole run; `RELEASE SAVEPOINT` keeps them;
`ROLLBACK TO SAVEPOINT` releases only those taken inside the savepoint.

AFL Tables (`runSettleAfltables`, `settle-afltables.ts:1835`), in order:
1. shared advisory gate (class 717275, key 4), bounded wait; 2. `loadRefs`, `INSERT import_batches`; 3. manual-authority
snapshot (read); 4. family `afltables.match`, each record in bundle order: observation and projection rows (this source's
staging rows), then ONE unit: **match row** (`FOR UPDATE ... ORDER BY id` on a rekey with a retired candidate, else `FOR NO KEY
UPDATE`) -> authority read -> `matches` / `match_period_scores` writes -> ledger row -> `data_issues`; 5. family
`afltables.player_match_stats`, each record: the same staging rows, then a unit: **match row `FOR SHARE`** -> `player_match_stats`
and `brownlow_round_votes` writes -> ledger; 6. absence marking, issue healing; 7. if any canonical row was written, the
derived recompute in its own savepoint (`seasons` first, then `club_seasons`, player derived rows; bounded `40P01` retry);
8. `UPDATE import_batches`, commit. `BUNDLE_FAMILIES` fixes match-then-player.

AFL API (`runSettleAflApi`, `settle-afl-api.ts:1905`), in order: gate, `loadRefs`, `INSERT import_batches`, match-absence sweep,
then per unit (`bundle.units`, in snapshot source order; `buildAflApiSettleBundle` does not sort): staging rows, an unlocked
authority pre-check, the match unit (**match row `FOR NO KEY UPDATE`** when it has a `matches` or `match_period_scores` target),
then that match's player units (**`FOR SHARE`** on the same row, no self-conflict); after all units, the attendance sweep
(`FOR UPDATE` per AFL-API-owned match in an unordered `staging.afltables_match` scan, each in its own savepoint, **errors
rethrown**), then the recompute and `finalizeSettleImportBatch`.

What this change alters in those orders: (a) a match-family unit now takes the match row BEFORE the E2/E3/E4/E5/E6 gates and keeps
it when it merely REFUSES (a unit that FAILS rolls back and releases it); a written row was already held to commit before this
change (its `UPDATE matches`). (b) Nothing else moves. Within a unit there is one match row, so there is no intra-unit order to
violate. The only multi-row lock statement is the rekey's `ORDER BY id`.

What is NOT shown: that the two settles visit matches in a common order. AFL Tables takes every match-family lock first, then the
player locks; AFL API interleaves per match; neither sorts by match id; the attendance sweep is unordered. Two overlapping
settles on the same season can therefore form a cycle (A holds M1 `NO KEY UPDATE`, waits `SHARE` on M2; B holds M2, waits
M1). Notes bounding it, all from code:
- Applier-level refusals are race or stale-state losers: AFL Tables offers only `candidate`, `pending_match` and `retry` targets
  (`invitationFor`, never a foreign-owned or conflicting one) and the AFL API applies only planned (owned or new) matches whose
  authority pre-check is clear. So the widened set (refused after the lock) is small by construction. Not counted.
- Scheduled overlap: timers fire at 04:30 and 05:00 with `RandomizedDelaySec=15min` (both `Persistent=true`), a start gap of at
  least 15 minutes, so a scheduled overlap needs the AFL Tables run to exceed 15 minutes; a `Persistent=true` catch-up after
  downtime or an operator-run settle can overlap them directly. The wrappers take the season from the in-progress register, so
  `season_not_in_progress` refusals after the lock are not expected in scheduled runs (manual runs not examined).
- The Brownlow poller (every 5 minutes) uses Brownlow-only units: no match lock.
- Editors (`data-edits.ts`, `deleteMatch`, Match Sheet) lock the match row FIRST, so an editor blocked behind a settle-held match
  holds nothing else at that point and cannot be in a cycle there; it waits for the settle's commit (no `lock_timeout` in
  `data-edits.ts` / `match-admin.ts`, 5 s in the Match Sheet). That wait now also applies to a match whose unit merely refused.
- One lock change inside the AFL API settle is pre-existing: the attendance sweep takes `FOR UPDATE` after the same run's units
  already hold `FOR SHARE` or `FOR NO KEY UPDATE` on that row (an upgrade). Its `40P01` is not absorbed (18.3).

### 18.3 The exact `40P01` path, whether earlier units survive, and retry

Inside a unit (`applyCanonicalUnit`, both settles):
1. `SAVEPOINT afldb_canonical_apply_unit` on the settle's `tx`, then `tx.savepoint(...)` opens postgres.js's own nested `sN`.
2. The lock statement (or any later one) waits. After `deadlock_timeout` (default 1 s; this host's value not verified) the
   waiting backend runs the deadlock check; if it finds a cycle containing itself it raises `40P01` on that statement. Victim
   choice depends on whose check runs first; the settle is not always the victim (ISSUE-261 D-261-4).
3. The error leaves the `sN` callback; postgres.js rolls back to `sN`; the unit's `catch` runs `ROLLBACK TO SAVEPOINT
   afldb_canonical_apply_unit` and `RELEASE SAVEPOINT`. Every lock and write taken after the anchor is released and undone.
4. The unit returns `write_failed` for each of its targets with `failure.message` (here "deadlock detected"; the SQLSTATE is not
   kept). It does not throw, so the run continues.
5. The caller counts `canonicalApplyFailures` and writes one `canonical_apply_failed` `data_issues` row per target
   (`settle-afltables.ts:2554`, `settle-afl-api.ts:1146`), then moves to the next record or match.

**Earlier units survive**: their writes, ledger rows and, importantly, their locks stay in the outer transaction until the run
commits. So after a unit-level `40P01` the other side of the cycle is still blocked on anything the earlier units hold (this is
why `DERIVED_RECOMPUTE_DEADLOCK_BACKOFF_MS` is sized as it is), and a later unit can wait on it again and be chosen again.

**Retry:** there is NO in-run retry of a failed unit (`runDerivedRecomputeWithDeadlockRetry` wraps the derived recompute only).
A later attempt exists only if a later run happens and the record is still presented: AFL Tables re-derives from target state
(`candidate` if the payload moved, or `retry` when the source is unchanged but the target still differs, `invitationFor`); the
AFL API re-plans every run and `closeMootApplyFinding` heals the finding once the diff is empty. The next scheduled run is the
next 04:30 or 05:00 timer. A failed unit does not fail the run, so it exits normally and surfaces as the counter and the finding.
The earlier wording "retried next run" (§17.5, `issues.md`) was therefore too strong; it is "possible on a later run".

A `40P01` OUTSIDE a unit is not absorbed this way: the derived recompute retries three times (1/2/3 s) then propagates; the
AFL API attendance sweep rethrows after rolling back its own savepoint; any statement on `tx` outside a unit (observations,
projections, `data_issues`, `finalizeSettleImportBatch`) propagates. In each case `sql.begin` rolls back the WHOLE run (no
earlier unit survives), the process exits non-zero, and the next attempt is the next timer.

Evidence level: code reading, plus the generic `canonical_apply_failed` integration tests (constraint failures). No test in the
repository drives a real `40P01` through the real applier; `match-results-promotion.test.ts` characterises it with hand-written
lock statements, not `applyCanonicalUnit`.

### 18.4 Baseline of the failing DB-free test files (item 3)

Method. `git checkout-index` of the index (equal to `HEAD` = `416f5f27`; `git diff --cached` empty) into
`D:\tmp\issue274\base-416f5f27`; `node_modules` copied from this worktree (22,245 files, same tree); the 1,855 tracked files
are byte-identical (SHA-256) to this worktree except the 7 changed ones. No `.env`, no `DATABASE_URL` or `AFLDB_*` variable
in the shell. Same command in both trees, one after the other: `npx vitest run --exclude "tests/integration/**"`. Main and the
existing issue worktrees were not touched (their only writes are the usual `node_modules` caches of this worktree).

| | base `416f5f27` | this worktree at 21:13 (all 13 new DB-free cases present) |
|---|---|---|
| test files failed | 10 of 171 | 10 of 171 |
| tests | 10 failed, 7,992 passed, 33 skipped | 10 failed, 8,005 passed, 33 skipped |

The failing sets are identical (12 entries: 10 tests + 2 files that fail to load); +13 passes are the new cases. **Introduced
by this change: 0.** Classification of each (all REPRODUCED ON BASE), with the cause found by two further runs of the BASE
tree only: (R1) a forced-LF export (`git -c core.autocrlf=false archive`), (R2) a dummy `DATABASE_URL` pointing at
`127.0.0.1:1` (the clients are lazy; nothing connects):

| failing at base | cause, from evidence |
|---|---|
| `admin-coach-actions` (load) | `DATABASE_URL is not set` (`src/db/client.ts:19`). Passes with a dummy DSN (R2). Environmental. |
| `register-issue224-s9-dev-write-gate` (load) | Same `DATABASE_URL` error; once supplied it fails on `ENOENT issues/open/AFLDB-ISSUE-251.md` (that runbook is in `issues/closed/`). Env **and** a stale path at base. |
| `awards-admin` 578, `finals-semantics-contract` 57, `correct-afl-api-identity-cli` 3195 | PASS on the LF export (R1). CRLF-checkout sensitive: Windows only. |
| `current-season-import` ("reuses the four player-derived helpers") | Fails on LF too. Stale pin: it scans for `recomputeSeasonMetadata(tx, ...)`, the code calls `(scope, ...)` (ISSUE-257/261). Test/code drift at base. |
| `site-settings` (defaults: 18 vs 16 keys), `honours-lifecycle-public-contract` x2 (20 vs 19, 23 vs 17 filters), `player-link-mutations` I14 | Fail on LF too; count/regex pins that no longer match the code at base. Test/code drift. |
| `draftguru-acquisition` 9.6 | `ERROR: snapshot directory not found: data/sources/draftguru/annual-html-20260826` (gitignored input; present in the main checkout, absent in worktrees and the export). Missing input. |
| `draftguru-acquisition` 41z | Pinned-hash mismatch of a derived Markdown file (expected `60c529df...`, got `2ce361f6...`); fails on LF too. **Cause unresolved.** |

So "environmental" is supported for 3 entries (the two loads, in part, and draftguru 9.6), "Windows checkout" for 3, "drift at
base" for 5, "unresolved" for 1. None involves `canonical-apply.ts`.

### 18.5 Integration harness (`settleBehindHolder`) review (item 4)

> **Superseded in part by §19.2.** The rework below still left an unbounded first wait, ran the settle on the suite's shared
> connection, and swallowed a timeout before cleanup. §19.2 replaces it.

Findings against the first version, all fixed in `tests/integration/settle-afltables.test.ts` with every assertion kept:
- The holder was a bare `.then(...)` chain whose rejection was only observed through `Promise.race`; it is now wrapped by `track()` at
  creation, so neither background operation (holder, settle) can be an unhandled rejection.
- The `finally` released the holder but then did `await settling` with no bound, so a hung settle would have hung the cleanup and
  the test until the 300 s limit. Both waits are now bounded (`within`, 60 s); on expiry `side.end({ timeout: 5 })` closes the
  holder's session, which rolls it back and unblocks the settle.
- The holder's own failure (for example a CHECK violation in its edit) used to surface as a bare rethrow in the middle of the
  helper; it now fails with "the holder's work failed: ...".
- Order is explicit: release the holder FIRST, then await holder and settle, then end the side connection, then the caller asserts
  and removes fixtures. Nothing is still running when the fixture rows are deleted; scenario 1 also clears its own `matches`
  override BEFORE seeding (the suite's `cleanupAuthority` covers `player_match_stats` overrides only).
- Kept: the blocked-statement check (`FOR NO KEY UPDATE`, not the final `UPDATE matches`), the editor's value stands (112), the
  override stays active, `canonicalRowsUpdated` 0, only the seed's ledger row; deleted-match: no row, 0 updated, only the seed's row.
- Added: one test that the real driver returns `count` 0 for an UPDATE that matches no row (the writers' backstop depends on it).

### 18.6 Why the `player_match_stats` and `brownlow_round_votes` zero-count checks are in ISSUE-274

They are in the approved scope and share the helper: the origin finding (F-009) lists all three writers as returning
`rowsUpdated: 1` without checking the driver's count (`:807-811`, `:891-895`, `:931-935`), runbook §11 scopes "the writers'
affected-row checks" and §13 says "Make the three writers return the driver's count and treat 0 as `write_failed`". The defect
class is the same in each: a unit reports an update, counts it and writes a ledger row for a row that is no longer there.
How much the lock protects differs, which is the honest reason to keep the backstop rather than rely on the lock:
- `matches`: the new lock makes a vanished row unreachable between the lock and the UPDATE; the check is the backstop.
- `player_match_stats`: a player unit's `FOR SHARE` on the match keeps `deleteMatch`, the Data Editor and the Match Sheet (all
  `FOR UPDATE`) out, so the check is defence in depth against any writer that deletes stats rows without the match lock.
- `brownlow_round_votes`: a Brownlow-only unit takes NO match lock, so the count is its only protection.
If you would rather keep the two out of this issue, the cost is a small split of `requireRowUpdated`'s callers into a follow-up
issue; I have not done that because the runbook scope names them.

Regression coverage (`tests/current-season-import.test.ts`, describe "ISSUE-274 ..."): `writers refuse to report an UPDATE that
matched no row` -> `matches`, `player_match_stats`, `brownlow_round_votes` (each: `failure.targetTable`, `write_failed`, no
`canonical_applications` INSERT). Mutation checks (one change at a time, isolated copy `D:\tmp\issue274\mutation`; the pristine
file was restored and compared after each):

| mutation | new cases that fail |
|---|---|
| none (control) | 0 of 13 |
| lock branch unreachable | 7: matches-only, period-only, family, new fixture, rekey without candidate, and both editor-interleaving cases |
| `requireRowUpdated` removed from `writeMatch` | exactly 1: "matches" |
| removed from `writePlayerMatchStats` | exactly 1: "player_match_stats" |
| removed from `writeBrownlowRoundVotes` | exactly 1: "brownlow_round_votes" |
| `match_key` injected into `provenanceForUpdate` | exactly 1: the unique-key guard (§18.1) |

(The earlier "8 fail with the lock and the `matches` check removed together" is consistent: 7 + 1.) The real driver's `count` is
checked only by the integration test added in §18.5.

### 18.7 Proposed commands (operator-run; none has been run by me)

> **SUPERSEDED by §19.3 — do not run this block.** Its flaws: step 1 put the DSN on a `psql` command line; steps 4-5 ran
> several files in one invocation; it had no fail-fast identity/role/visibility probe. Kept for history only.

PowerShell from `D:\dev\afldb-issue-274`, with the operator's own `afldb_test` OWNER DSN already in `$env:AFLDB_TEST_DATABASE_URL`
(database name must end `_test`; never copy `.env` into a worktree). Run them one at a time: the suites share one mutable database.

1. Read-only catalogue check (confirms §18.1):
   `psql -X -v ON_ERROR_STOP=1 -c "SELECT i.indexrelid::regclass AS idx, i.indpred IS NOT NULL AS partial, i.indexprs IS NOT NULL AS expr, (SELECT string_agg(a.attname, ',' ORDER BY k.ord) FROM unnest(i.indkey) WITH ORDINALITY k(attnum, ord) JOIN pg_attribute a ON a.attrelid = i.indrelid AND a.attnum = k.attnum) AS cols FROM pg_index i WHERE i.indrelid = 'public.matches'::regclass AND i.indisunique ORDER BY 1" $env:AFLDB_TEST_DATABASE_URL`
   Expect three rows (`id`; `legacy_match_id`; `match_key`), none partial, none expression.
2. Baseline FIRST, from the unchanged export, so any pre-existing failure is attributed correctly:
   `Set-Location D:\tmp\issue274\base-416f5f27; npx vitest run tests/integration/settle-afltables.test.ts`
   then `Set-Location D:\dev\afldb-issue-274`.
3. The new scenarios: `npx vitest run tests/integration/settle-afltables.test.ts -t "ISSUE-274"` (expect 3 passed, 1 todo).
4. The whole file: `npx vitest run tests/integration/settle-afltables.test.ts` (expect the same failing set as step 2, if any).
5. Other callers of the applier and the lock-footprint suites:
   `npx vitest run tests/integration/settle-afl-api.test.ts tests/integration/settle-promotion-deadlock.test.ts tests/integration/data-editor.test.ts tests/integration/match-results-promotion.test.ts`
   For each, run the same files from `D:\tmp\issue274\base-416f5f27` first if any of them fails here. `data-editor.test.ts` and
   `settle-promotion-deadlock.test.ts` hand-emulate lock modes (they never call the real applier), so they test the unchanged
   machinery; they are in the list to catch an accidental interaction, not to prove this change.
If step 3 fails on its first assertion the settle did not block on the lock (the blocked query is printed); on `home_score`,
the editor's value was overwritten.

## 19. Corrections after review (2026-10-11, solo; local files only: no database, host, integration run, commit, push or deploy)

D-274-1 stays PENDING and `FOR NO KEY UPDATE` stays PROVISIONAL. ISSUE-275 stays separately Open and unfixed. The ISSUE-265 PROD
hold is unchanged. Everything below is code reading or DB-free evidence; **none of it is PostgreSQL evidence.**

### 19.1 The late retired candidate (closes the §18.1 residual)

**Mechanism, before.** `lockUnitMatchRows` searched for retired candidates UNLOCKED. If it found none it locked only the
incoming-key row, `loadManualAuthority` took the snapshot, and only then did `readFreshTarget` re-derive candidates with
`FOR UPDATE OF m`. A candidate not visible at the first search but visible at the second was therefore locked AFTER the
snapshot. If a Data Editor transaction held that candidate with an override (or an edit that makes it a candidate), the locked
search waited for the editor, then resolved the candidate with the editor's committed row; the E5 baseline compared equal
whenever the edit moved no proposed field; E4 consulted the stale snapshot, found nothing, and `UPDATE matches` overwrote the
rekey candidate while the editor's override stayed active. Same defect as ISSUE-274, in a unit the issue covers.

**Fix** (`src/lib/acquisition/canonical-apply.ts`; **the "locked re-search" wording in this paragraph and the "Honest limit"
below are SUPERSEDED by §20: the re-search is unlocked and acquires no lock on the refused candidate**). `lockUnitMatchRows` returns the set of retired-candidate ids it locked
(empty when it locked none). `applyCanonicalUnit` passes that set to `readFreshTarget`. When the locked re-search yields exactly
one candidate whose id is not in the set, `readFreshTarget` returns `stale_canonical_target`: the target is refused unwritten,
no ledger row is written, `canonicalApplyRefusals` counts it, and the next run re-plans with the candidate in view. Two or more
candidates still refuse as `rekey_ambiguous`; an incoming-key row plus a candidate still refuses as `rekey_would_merge`.

**Why refuse, not restart.** A restart would lock a newly found id after higher ids the unit already holds, breaking the
deterministic `ORDER BY id` order the first lock statement establishes. A refusal takes no new lock decision, uses an existing
vocabulary entry (no new finding type, and `isRekeyRefusal` is false, so no rekey finding is written), and cannot overwrite
anything. The cost is one refused unit in a rare race.

**The invariant now.** Every match row a unit may modify is locked before the snapshot that permits the modification:
- the incoming-key row, when it exists at the lock: `FOR NO KEY UPDATE` (matches/period units), `FOR SHARE` (player units), or
  `FOR UPDATE` together with the candidates (rekey);
- every retired candidate: in the set locked by the single id-ordered `FOR UPDATE` statement, otherwise refused.
Not covered, and not claimed: a row that first appears under the INCOMING key after the lock phase. That is ISSUE-275's window
(`existingMatch` / `row` read after a no-row lock) and is deliberately left to it.

**Honest limit (SUPERSEDED by §20 - it was accepted here and is now removed).** On the refusal path the locked re-search still takes `FOR UPDATE OF m` on the late candidate, once, after the
unit's other locks (and waits for the editor). That is a lock taken out of id order, but only on a path that then refuses and
only after higher locks; a `40P01` there is absorbed by the unit savepoint like any other (§18.3). I kept the locked search
because an UNLOCKED search could miss a row that an in-flight editor transaction is about to turn into a candidate.

**Regression.** `tests/current-season-import.test.ts`, describe "a retired candidate that is absent at the lock phase and found
afterwards" (DB-free, deterministic model): search 1 (lock phase) returns nothing; search 2 (`readFreshTarget`'s locked one) is
where the editor's commit lands (margin edit plus an active `score` override on the candidate's old key) and returns the
candidate. Asserts the model really exercised the window (the editor committed, and AFTER the authority snapshot was read),
the editor's row is unchanged, no `UPDATE matches`, no `INSERT INTO canonical_applications`, outcome `stale_canonical_target`.
**Fails on the unfixed source**: run before the fix, assertions 1-2 (editor committed; committed after the snapshot) passed and
`expect(run.overwritten).toBe(false)` failed with `true`, i.e. `UPDATE matches` ran with the stale snapshot. Passes after the fix.
Not covered: a PostgreSQL integration case for this window (it would need a candidate that becomes visible mid-run; no
deterministic harness for that exists in the suite); the `FOR UPDATE` recheck semantics the model relies on are PostgreSQL
behaviour, not demonstrated here.

### 19.2 `settleBehindHolder`: bounded waits, no swallowed timeout, completion before cleanup

Orchestration moved to `tests/integration/behind-holder.ts` (pure; no driver) so its guarantees are unit-testable without a
database; `settleBehindHolder` in `tests/integration/settle-afltables.test.ts` is now the PostgreSQL glue around it.

- **Bound the initial held wait.** The wait for the holder to take its lock was unbounded (`Promise.race` of `held` and the
  holder ending). It is now `within(..., boundMs)`; the blocked-statement poll and both completion waits were already bounded.
- **The settle is independent and addressable.** It runs on its OWN connection (`apply122(..., { client })`; `max: 1`, same
  options as the suite's `sql`), not the suite's shared one. The holder, the settle and a control connection each carry a unique
  `application_name` (`afldb-i274-<pid>-<random>-holder|settle|control`). Observation and every stop are addressed by that name
  and `datname = current_database()`, so no unrelated session can be reached.
- **Completion before cleanup.** On every path (success, a failed assertion, a timeout) the order is: release the holder;
  await the holder, await the settle (each bounded); if either outlives its bound, stop THAT session with
  `pg_terminate_backend` by application name and await again; close the holder and settle clients; poll `pg_stat_activity`
  until no backend with either name remains; only then run the caller's `cleanup`.
- **A timeout is not swallowed.** It becomes the failure (reported after the work is stopped). If the work still cannot be
  confirmed gone, `cleanup` is SKIPPED and the scenario fails with `UnresolvedWorkError` (fixtures are left for the suite's own
  pre-clean; the probe in §19.3 refuses to start while `afldb-i274-*` sessions exist).
- **Early assertion.** The pre-fix discriminator (`blockedQuery` contains `FOR NO KEY UPDATE`, not the final `UPDATE matches`)
  moved to `whileBlocked`, so it fails while the settle is still parked, and the same termination path then runs. The other
  assertions (editor's `home_score` 112, override active, `canonicalRowsUpdated` 0, only the seed's ledger row; deleted match:
  no row, 0 updated, only the seed's ledger row) are unchanged and run in `assertions`, after both operations ended.
- **Cleanup ownership.** Scenario 1's override removal is its `cleanup`; it can no longer run under a live settle.
- **Vacuous pass closed.** `scenario()` returns early when migration 110 is absent (State A). A new test
  "ISSUE-274: precondition: the authority state admits player_match_stats ..." fails loudly in that state, so the two
  scenarios cannot pass without running. Never apply a migration to make them run.
- **Budget.** `boundMs` 20 s; worst case about eight sequential bounds plus the 5 s closes and the 15 s gone-check, inside the
  scenarios' 300 s limit. **Superseded by §20.2**: that budget left observation, termination and close/confirm unbounded; the
  worst case is now stated as a formula and asserted.

DB-free regression checks, `tests/behind-holder.test.ts` (11 tests, fakes with explicit timing): success; an assertion that
fails while the settle is parked (`whileBlocked`) still releases and completes both before cleanup; a failing post-run assertion;
a settle that outlives its bound is terminated by the test-owned control, awaited, then cleaned up with the timeout as the
failure; a settle that cannot be stopped SKIPS cleanup (`UnresolvedWorkError`); backends not confirmed gone SKIP cleanup; the
FIRST wait bounded (a holder that never gets the lock); holder failure; settle failure; a settle that never blocks; a cleanup
failure never masks the first failure. One mutation (removing the `terminateSettle` call) made exactly the two timeout tests fail.
(A second mutation, disabling the cleanup gate, was refused by the tool's permission classifier and was NOT performed.)

Not demonstrated: the PostgreSQL glue itself (the `pg_stat_activity` query, `pg_terminate_backend` by application name, the
gone-check, `application_name` reaching the server through the driver's `connection` option) has not been run.

### 19.3 Guarded integration procedure (replaces §17.4's commands and §18.7)

All commands are operator-run, from `D:\dev\afldb-issue-274` in PowerShell. Nothing here grants, migrates, creates roles or
touches PROD. The probe file is `D:\tmp\issue274\probe\issue274-probe.mjs` (outside the repository; hash in the hand-off).

**Credentials.** Enter the DSN once, without echo, so it is never on a command line, in history or in a log:

```powershell
$secure = Read-Host 'afldb_test afldb_owner DSN (via the 55432 tunnel)' -AsSecureString
$env:AFLDB_TEST_DATABASE_URL = [System.Net.NetworkCredential]::new('', $secure).Password
Remove-Item Env:AFLDB_TEST_IMPORT_DATABASE_URL -ErrorAction SilentlyContinue
```

Do not run `Start-Transcript`; if output is saved, save only the commands' own output (the guard prints host, port and database
name, never the password). No `.env` may exist in the worktree (the probe checks).

**Step 0: fail-fast probe (read-only).** `node D:\tmp\issue274\probe\issue274-probe.mjs`. It stops at the first failure and
requires: DSN names exactly `afldb_test` and role `afldb_owner` (checked before any connection); the server reports the same
database, `current_user`/`session_user` `afldb_owner`, database owner `afldb_owner`, not in recovery, session read-only; the
four relations exist; `data_overrides` admits `player_match_stats`; no `afldb-i274-*` session already exists; a private
advisory-lock rehearsal shows the observer can read the waiter's statement text and `pg_blocking_pids` (the visibility the
scenarios depend on); the unique indexes of `public.matches` are exactly `id`, `legacy_match_id`, `match_key`, none partial, none
expression (this is the read-only catalogue check behind §18.1; the DSN is not passed to `psql`); and no probe session remains.
It prints no DSN, host or port. **Expected last line: `probe: PROBE OK`.** Any `PROBE FAIL`: stop and report. Do not grant,
migrate or edit anything to make it pass.

**Steps 1-6: one vitest process per file, in this order, stopping at the first unexpected failure** (the suites share one
mutable database; never combine files in one invocation):

1. Baseline of the unchanged tree, only needed to attribute a failure: `Set-Location D:\tmp\issue274\base-416f5f27` then
   `npx vitest run tests/integration/settle-afltables.test.ts`, then `Set-Location D:\dev\afldb-issue-274`.
2. `npx vitest run tests/integration/settle-afltables.test.ts -t "ISSUE-274"` : expect **4 passed + 1 todo**.
3. `npx vitest run tests/integration/settle-afltables.test.ts`
4. `npx vitest run tests/integration/settle-afl-api.test.ts`
5. `npx vitest run tests/integration/settle-promotion-deadlock.test.ts`
6. `npx vitest run tests/integration/data-editor.test.ts`
7. `npx vitest run tests/integration/match-results-promotion.test.ts`

(`data-editor` and `settle-promotion-deadlock` hand-emulate lock modes and never call the real applier; they are run to catch an
accidental interaction, not to prove this change.) For a failing file, run the same file from the baseline export before
drawing any conclusion.

**Stop conditions (report, do not fix at the database).** Any SQLSTATE `42501`, "permission denied", "relation ... does not
exist" or "migration" message; any `UnresolvedWorkError`; a step-2 count other than 4 passed + 1 todo; the precondition test
failing (State A). After any `UnresolvedWorkError`, re-run step 0: it refuses to pass while an `afldb-i274-*` session exists.

**Finish.** `Remove-Item Env:AFLDB_TEST_DATABASE_URL`.

**Reading the result.** If step 2 fails on `whileBlocked`, the settle did not block on its own lock (the blocked statement is in
the message); on `home_score`, the editor's value was overwritten. A pass shows the two scenarios on this PostgreSQL only; it
does not decide D-274-1, does not exercise the late-candidate window (§19.1), and does not measure deadlock behaviour (§18.2).

### 19.4 Results (2026-10-11, local, DB-free; nothing executed against a database or host)

| check | result |
|---|---|
| New regression on the UNFIXED source | FAILS at `expect(run.overwritten).toBe(false)` (received `true`) |
| Same regression after the fix | passes |
| `tests/behind-holder.test.ts` | 11/11 pass |
| Focused run: `current-season-import`, `behind-holder`, `admin-match-mutations`, `afl-api-ingestion-safety`, `db-promotion-check`, `data-overrides-source-contract` | 1,053 passed, 4 skipped, **1 failed**: "reuses the four player-derived helpers" in `current-season-import`, already in the §18.4 baseline of 12 (stale `recomputeSeasonMetadata(tx, ...)` pin), not touched by this change |
| `npm run typecheck` | exit 0 |
| ESLint on the 5 touched code files (`canonical-apply.ts`, `current-season-import.test.ts`, `settle-afltables.test.ts` (integration), `behind-holder.ts`, `behind-holder.test.ts`) | exit 0, no output |
| `git diff --check` | exit 0 |
| Probe preflight branches (unset DSN; wrong database; wrong role), run with a fake non-secret DSN | each stops before any connection; no secret echoed |
| `node --check` on the probe | exit 0 |
| Broad DB-free baseline | NOT repeated (no new failure required it) |

Files changed by this pass: `src/lib/acquisition/canonical-apply.ts`, `tests/current-season-import.test.ts`,
`tests/integration/settle-afltables.test.ts`, `tests/integration/behind-holder.ts` (new), `tests/behind-holder.test.ts` (new),
this runbook, `issues.md`, `IssuesIndex.md`, `issues/open/AFLDB-ISSUE-275.md` (one note); outside the repository:
`D:\tmp\issue274\probe\issue274-probe.mjs` (new). An empty stray file named `` `matches` `` of unknown origin (created 21:40, zero bytes, absent from the session-start status) was removed.

## 20. Final corrections before integration (2026-10-12, solo; local files only: no database, host, integration run, migration, commit, push or deploy)

D-274-1 stays PENDING and `FOR NO KEY UPDATE` stays PROVISIONAL. ISSUE-275 stays separately Open and unfixed. The ISSUE-265 PROD
hold is unchanged. Migration 110 was **not** applied; the probe's State-A blocker (§19.3) stands. Everything below is code
reading or DB-free evidence; **none of it is PostgreSQL evidence.**

### 20.1 Refuse a late retired candidate WITHOUT locking it

**What was wrong in §19.1.** The refusal fired inside `readFreshTarget`, after `findRetiredMatchIdentities(..., true)` had
already taken `FOR UPDATE OF m` on the late candidate. So the unit waited, after the authority snapshot, for whoever held that
row (the Data Editor the refusal exists to respect), took a lock outside the id-ordered statement, and only then refused.
§19.1 recorded that as an "honest limit" and kept it; it should not have been kept.

**Fix** (`src/lib/acquisition/canonical-apply.ts`, `readFreshTarget`). The search is now UNLOCKED. Any candidate whose id is not in
the set `lockUnitMatchRows` locked returns `stale_canonical_target` immediately, before the `rekey_would_merge`,
`rekey_ambiguous`, rekey-resolve or insert decisions, so a refused late candidate is never locked. A candidate inside the set is
handled as before and needs no new lock: it is held `FOR UPDATE` from the pre-authority statement to the end of the
transaction (`RELEASE SAVEPOINT` keeps it), so the claim "two settles cannot both take one retired row" rests on that statement,
not on a second one. The `lock` parameter of `findRetiredMatchIdentities` now has no caller; it is kept (removing it is outside this change) and its doc comment, and the stale "re-derived under `FOR UPDATE`" comment in `settle-afltables.ts`, were corrected (comments only).

**Corrected lock-order claims** (these replace the statements in §17.1, §18.1 and §19.1 that said the re-derivation took
`FOR UPDATE`):
- A rekey unit with a retired candidate takes every retired candidate and any row already holding the incoming key in ONE
  statement, `ORDER BY id`, `FOR UPDATE`, before `loadManualAuthority`. That is the only multi-row lock of a unit. Nothing after
  the snapshot adds a retired-candidate lock, in id order or out of it.
- A unit with no retired candidate at that moment takes one row (`FOR NO KEY UPDATE`, or `FOR SHARE` for a player unit), also
  before the snapshot.
- **Not claimed:** "every lock the unit takes is before the snapshot." `findPlausibleCanonicalFixtures(..., true)` (the
  I244-F030 refusal of an INSERT) still locks the rows it returns, after the snapshot. They are refused, never modified. The
  unit's own writes also take locks as statements (child rows, FK checks, ledger insert). The invariant is the narrower one in
  §19.1: every match row a unit may MODIFY is locked before the snapshot that permits the modification, or is refused.
- Not covered, as before: a row that first appears under the INCOMING key after the lock phase (ISSUE-275's window), and a
  candidate that becomes visible after the unlocked search in `readFreshTarget` and before the write (no predicate lock exists;
  that sub-window is the same shape as ISSUE-275's and is not closed here).

**Behavioural change to note.** The outside-set check now precedes `rekey_would_merge` / `rekey_ambiguous`. A late candidate
therefore refuses `stale_canonical_target` where it previously could refuse as one of those two. All three write nothing; the
next run re-plans with the candidate in view.

**Regression** (`tests/current-season-import.test.ts`, describe "a retired candidate that is absent at the lock phase and found
afterwards", 4 tests, DB-free). The fake records a nested `FOR UPDATE OF m` fragment as its own statement, so a locking search is
visible. (1) the existing overwrite regression, kept: refused unwritten, editor values stand, no `UPDATE matches`, no ledger row,
and the model verifiably committed the editor AFTER the snapshot; (2) **new**: refusal acquires no late lock (no `FOR UPDATE OF
m` fragment, no `FOR UPDATE` statement, no `WHERE id = ANY` lock, no read of the candidate by id, exactly one lock statement:
the incoming-key `FOR NO KEY UPDATE`); (3) **new**: a known candidate 41 plus a late 42 is refused and the single id-ordered lock
statement names only 41; (4) **new**: a candidate that WAS locked at the lock phase is not refused and still takes no further
lock. Mutation checks in place, each reverted at once (confirmed by a clean re-run): making the search lock again fails
(2), (3), (4) with `expected [ 'FOR UPDATE OF m' ] to deeply equal []`; disabling the outside-set check fails (1), (2), (3).

### 20.2 Every control of `settleBehindHolder` is bounded and reported

**Before (§19.2).** Only the holder and settle completion waits were bounded. Unbounded: each `observeBlocked` call (a control
query), `terminateHolder` / `terminateSettle` (swallowed by `quietly`, so a failed or hung stop looked like nothing), and
`closeAndConfirmGone` (the client closes plus its own 15 s poll). A hung control query hung the test.

**Now** (`tests/integration/behind-holder.ts`):
- **Observation.** The whole phase is `within(boundMs + 2 * pollMs)`; a loop that is stuck inside a control call is a timeout,
  `test-owned control: observing the blocked statement did not finish within N ms`, and the loop is told to stop. A control query
  that throws is `test-owned control: observing the blocked statement failed: <cause>`. Either becomes the first failure; the
  common path then releases the holder, awaits both operations, stops what outlives its bound, closes and confirms.
- **Termination and close/confirm.** Each runs through one `control()` helper, bounded by `controlBoundMs`. A timeout or throw is
  appended to `controlProblems` (never swallowed), and the call reports only "did not confirm".
- **Unconfirmed means unresolved.** If the holder or settle is still running after its stop, or `closeAndConfirmGone` did not
  return `true` (timed out, threw, or returned `false`), cleanup is SKIPPED and `UnresolvedWorkError` is thrown, with the control
  problems in its message and in `controlProblems`. The first failure, if any, is still named in the message.
- **A control problem is never a pass.** If every operation is verifiably gone despite a control problem (e.g. a termination
  that stopped the settle but never returned), cleanup may run, and the run FAILS with the problems reported, kept alongside the
  earlier failure (message `<first> (also: <problems>)`, original as `cause`).
- **Documented budget** (`worstCaseBudgetMs`): main path 4 bounds (holder takes lock; observation `boundMs + 2*pollMs`; holder
  ends; settle ends) + cleanup path 4 bounds (holder and settle each awaited once, then again after their stop) + 3 control
  actions = `8*boundMs + 3*controlBoundMs + 2*pollMs`. The caller's `whileBlocked` and `assertions` are not counted: they run on
  the suite's `sql` client (statement_timeout 120 s) after the holder is released. Suite values: `boundMs` 15 s,
  `controlBoundMs` 14 s, `pollMs` 100 ms, so **162.2 s**, asserted DB-free to leave at least 120 s of the 300 s scenario timeout.
- **Control connection.** In `settleBehindHolder` the control client now sets `connect_timeout` 5 s and per-session
  `statement_timeout` 4 s and `lock_timeout` 2 s; the client closes use `end({ timeout: 3 })` and the "no backend remains" poll
  stops after 4 s. These live in `CONTROL_CONNECTION`; a DB-free test asserts the close-and-confirm sequence
  (3 s + max(4 s, 5 s) + 4 s = 12 s) and a stop (5 s + 4 s) fit inside the 14 s control bound, so the database or driver
  reports a stuck control before the harness's bound does. The settle's own connection is unchanged (`statement_timeout` 120 s).

**DB-free tests** (`tests/behind-holder.test.ts`, 31 tests, fakes with explicit timing; bounds 60 ms / control 40 ms / poll 5 ms,
budget 610 ms). Observation never resolves: explicit failure at 70 ms, completes both operations, cleans up only afterwards; with
an unstoppable settle: `UnresolvedWorkError`, no cleanup; observation that throws: reported. Termination never resolves: settle
and holder variants end as `UnresolvedWorkError` naming `terminating the settle|holder did not finish within 40 ms`, no cleanup;
termination that throws: reported, no cleanup; termination that stopped the settle but never returned: failure naming both, with
cleanup only after completion. Close/confirm never resolves, and throws: `UnresolvedWorkError`, no cleanup, both operations
shown ended; with a prior assertion failure the first failure is still named. Each asserts the elapsed time is within
`worstCaseBudgetMs`. The earlier 11 tests are unchanged and pass.

### 20.3 `UnresolvedWorkError` now prevents fixture removal in the wrapper and the hooks

**The gap.** `runBehindHolder` withheld only the CALLER's `cleanup`. The suite's own removals still ran: the `scenario()`
wrapper's `finally { await cleanupAuthority(); }` on every path, then the `afterAll` of the nested Match Sheet describe
(`cleanupAuthority`), the `afterAll` of "AFLDB-ISSUE-122 S5" (`cleanup122`: `DELETE FROM matches ...` and more) and the file's
`afterAll` (`cleanupIssue099`, shared `sources` rows). Those would delete fixtures under a still-running settle, or block
behind a holder that still held the row.

**Fix.** `createCleanupGate()` (`tests/integration/behind-holder.ts`) is created once at module level in
`tests/integration/settle-afltables.test.ts` (`cleanupGate`). `settleBehindHolder` records an `UnresolvedWorkError` in it (adding
the session names, `application_name LIKE 'afldb-i274-<pid>-<random>-%'`) before rethrowing, and the wrapper records it too.
Then:
- the wrapper is `cleanupGate.scenario(body, cleanupAuthority)`: it refuses to START a scenario while earlier work is
  unresolved, and runs `cleanupAuthority` after the body except when work is unresolved;
- each of the three `afterAll` hooks above runs its removal through `cleanupGate.removeFixtures(...)`, which skips it, reports it
  on `console.error` and returns `false` when work is unresolved. The environment-variable restore and `sql.end()` still run:
  they remove no fixture;
- the `beforeAll` pre-cleans are unchanged (they run before any scenario, and are the recovery path on the next run).

There is no `afterEach` in the file (checked by a DB-free test).

**Surrounding definitions, for review** (all in `tests/integration/settle-afltables.test.ts`): `cleanupGate` (module level, next
to `createdProviderSourceRow`); the file `afterAll` (starts "afterAll(async () => { try { await
cleanupGate.removeFixtures('the ISSUE-099 fixtures and the shared source rows'"); the S5 `afterAll`
(`'the ISSUE-122 fixtures and the created admin'`); the nested `afterAll` (`'the durable-authority rows and audit rows'`);
`scenario` (`await cleanupGate.scenario(body, cleanupAuthority)`, `SCENARIO_TIMEOUT_MS`); `settleBehindHolder` (control client,
`...SCENARIO_BUDGET`, catch-and-record, `finally { control.end }`). The complete diff is in the revised patch.

**DB-free tests** (same file): a scenario that ends unresolved skips its cleanup, rethrows, and records; afterwards three
simulated hooks are skipped and reported, and the next scenario refuses to start (body not run); the gate also takes the helper's
record, ignores ordinary errors, and an ordinary failure still cleans up; the harness and gate together with an unconfirmed
backend remove nothing. **Source pins** (read from the integration file, so a future edit that bypasses the gate fails here
without a database): no `afterEach`; exactly three hooks remove fixtures and each calls `cleanupGate.removeFixtures(` with the
removal after it; the wrapper calls `cleanupGate.scenario(body, cleanupAuthority)` with `SCENARIO_TIMEOUT_MS`; every direct
remover call is in a `beforeAll` or inside a gated hook (5 calls); `settleBehindHolder` records into the gate and sets the
control options.

### 20.4 Probe (outside the repository: `D:\tmp\issue274\probe\issue274-probe.mjs`, revised)

Additions, all read-only (default_transaction_read_only, no write): a 90 s watchdog (exit 1, `PROBE FAIL`) so nothing can hang;
the final `check` client gets `statement_timeout` 5 s; **4b** opens a client with the suite's control options and requires the
server to report `statement_timeout=4s`, `lock_timeout=2s` and the application name (proves the options reach the server through
the driver, previously "not demonstrated"); **4c** terminates a probe-owned victim session with exactly the suite's
`pg_terminate_backend ... WHERE application_name = ...` statement and requires success and disappearance from `pg_stat_activity`.
The probe still refuses to pass while an `afldb-i274-*` session exists, and still stops at the State-A check (migration 110
absent): do not apply a migration to clear it. **The probe has not been run**, only `node --check` and its two no-connection
preflight branches (unset DSN; wrong database name). Expected last line unchanged: `probe: PROBE OK: safe to start the
integration procedure`.

### 20.5 Results (2026-10-12, local; nothing executed against a database or host)

| check | result |
|---|---|
| `tests/current-season-import.test.ts -t ISSUE-274` | 17 passed |
| `tests/behind-holder.test.ts` | 31/31 pass |
| `current-season-import` + `behind-holder` in full | 372 passed, **1 failed**: "reuses the four player-derived helpers", already in the §18.4 baseline of 12, unchanged by this pass |
| Mutation: search locks again | 3 new late-candidate tests fail; reverted (clean re-run) |
| Mutation: outside-set check disabled | 3 late-candidate tests fail; reverted (clean re-run) |
| `tsc --noEmit` (`tsconfig.json`) | exit 0 |
| ESLint on the 5 touched code files (`canonical-apply.ts`, `current-season-import.test.ts`, `settle-afltables.test.ts` (integration), `behind-holder.ts`, `behind-holder.test.ts`) | exit 0, no output |
| `git diff --check` | exit 0 (tracked files); the two untracked files checked with `git diff --no-index --check`: no whitespace findings |
| Probe: `node --check`; two no-connection preflight branches | exit 0; each stops before any connection |
| Integration suites, build, broad DB-free run | NOT run |

Not demonstrated: any PostgreSQL behaviour. The integration scenarios, the probe's new steps, `pg_terminate_backend` by
application name, the startup parameters through the driver, and that a `FOR UPDATE`-held late candidate is never waited on,
are unrun. D-274-1 is undecided.

Files changed by this pass: `src/lib/acquisition/canonical-apply.ts`, `src/lib/acquisition/match-rekey.ts` and
`src/lib/acquisition/settle-afltables.ts` (comments only), `tests/current-season-import.test.ts`,
`tests/integration/settle-afltables.test.ts`, `tests/integration/behind-holder.ts`, `tests/behind-holder.test.ts`, this runbook,
`issues.md`, `IssuesIndex.md`; outside the repository: the probe and the patch (`D:\tmp\issue274\AFLDB-ISSUE-274-complete-r3.patch`).

## 21. D-274-1 approved; probe authorised but NOT run (2026-10-12, solo; no database contacted)

**D-274-1: APPROVED by the owner (2026-10-12).** Retain `FOR NO KEY UPDATE` for ordinary match-family units, with the existing
`FOR UPDATE` rekey locking. This approves the implementation choice only. It is not integration acceptance and not a deployment
approval; PostgreSQL behavioural acceptance stays PENDING (the §18.2 deadlock shape and the §17.5 widened footprint of refused
units are still unmeasured). Superseded wording above ("PENDING", "provisional") is history and is left as written.

Authorisation given for this step: run only the reviewed `issue274-probe.mjs` against exactly `afldb_test` as `afldb_owner`,
including its private advisory-lock rehearsal and termination of its own uniquely named throwaway session. No fixture or
application-data writes, no migration 110, no grants, no guard changes, no integration suites, no commit, push, deploy, or DEV/PROD
contact.

Reviewed files confirmed by SHA-256 before use (both match the owner's stated values):

| file | SHA-256 |
|---|---|
| `D:\tmp\issue274\AFLDB-ISSUE-274-complete-r3.patch` | `562bf7d2771bff6c26f9e894cec6819d9f6d066155befa5fbb97021174ef7c0a` |
| `D:\tmp\issue274\probe\issue274-probe.mjs` | `f5861a11de712b80ad76bafa1b0d7e140a583dafca06bf6467ca9f3fef2d0bdc` |

**Probe outcome: NOT RUN. Exit code: none (the process was never started).** Missing prerequisites, found by local checks only
(no connection attempted, no credential read or printed):

- `AFLDB_TEST_DATABASE_URL` is not set in this session's environment (also not at User or Machine scope), so the probe's
  preflight would stop at its first check.
- Nothing is listening on the tunnel port `127.0.0.1:55432` and no `ssh` process is running, so the DSN could not be reached
  even if supplied.
- The worktree has no `.env` (correct: the probe refuses to run if one exists), and `AFLDB_TEST_IMPORT_DATABASE_URL` is unset
  (correct). `node` v22.21.0 and `node_modules/postgres` are present.

Not done, deliberately: opening an SSH tunnel, and taking a DSN from `D:\dev\afldb\.env`; neither was named in the authorisation.
This is a missing prerequisite, not a probe failure: State A / migration-110 status of `afldb_test` remains UNKNOWN to this
record (the §19 blocker stands), and nothing about PostgreSQL behaviour is demonstrated.

To proceed: bring up the `afldb_test` tunnel on 55432 and export `AFLDB_TEST_DATABASE_URL` (database `afldb_test`, role
`afldb_owner`, port 55432) in the session that runs the probe, then from the worktree root: `node D:\tmp\issue274\probe\issue274-probe.mjs`.
Expected last line: `probe: PROBE OK: safe to start the integration procedure`. Stop at any other outcome, including State A.

Files changed by this step: this runbook, `issues.md`, `IssuesIndex.md`. No code, test, probe or patch file changed.

## 22. Probe run against `afldb_test`: STOPPED at State A (2026-10-12, solo)

Owner authorisation for this step: establish the tunnel and run only the reviewed probe. Nothing else (no integration suites,
fixture writes, grants, migrations, commit, push, deploy, DEV/PROD contact). The ISSUE-265 PROD hold is unchanged.

**Result: PROBE FAIL, exit code 1.** Verbatim output (the probe prints no DSN; the wrapper also masked the password, none appeared):

```
probe: DSN names database afldb_test and role afldb_owner (checked before any connection)
probe: server identity: database=afldb_test role=afldb_owner owner=afldb_owner superuser=false version=16.15 (Ubuntu 16.15-0ubuntu0.24.04.1) read_only=on
probe: PROBE FAIL: data_overrides does not admit player_match_stats (migration 110 state A): the suite scenario() helper returns early, so the ISSUE-274 scenarios would pass VACUOUSLY. Stop; do NOT apply a migration to make them run
```

**Meaning.** `afldb_test` is in State A: `public.data_overrides` does not admit `player_match_stats`, so migration 110 is not
applied there. Checks that ran and passed before the stop: identity as the server sees it (`afldb_test`, `afldb_owner`, database
owner `afldb_owner`, not superuser, not in recovery, session read-only), no leftover `afldb-i274-*` sessions, and relation presence.
Checks that did NOT run because the probe stops at the first failure: blocked-query visibility (advisory-lock rehearsal),
`matches` unique-index catalogue check (§18.1), control-option honouring, `pg_terminate_backend` by application name, and the
no-session-remains check. Those remained unproven by the original probe (MO-1 later ran its own versions, §24).

> **Correction (2026-10-12, §24).** The paragraph above originally listed "relation presence" among the checks that did NOT
> run. That was wrong. In `issue274-probe.mjs` the relation-presence check (`to_regclass` on `public.matches`,
> `public.data_overrides`, `public.canonical_applications`, `staging.source_records`; lines 127-132) runs BEFORE the State-A check
> (line 138) and stops on a missing relation, so it ran and passed (a missing relation would have stopped the probe with a
> different message). No output line reported it because the "relations present; data_overrides admits player_match_stats"
> line (line 140) is printed only after the State-A check. The State-A FAIL itself, its verbatim output and the file
> (`f5861a11…0bdc`, unmodified) are unchanged history. No integration scenario was run, so the vacuous-pass risk was not exercised.
The blocker is as predicted in §19; nothing was changed to obtain a pass (probe unmodified, migration 110 not applied, guard
unchanged).

**Prerequisites established, then released.**

- Probe SHA-256 re-verified before the run and again after: `f5861a11de712b80ad76bafa1b0d7e140a583dafca06bf6467ca9f3fef2d0bdc`.
- No listener on `127.0.0.1:55432` beforehand. Created one tunnel, `ssh -N -L 127.0.0.1:55432:127.0.0.1:5432` to the owner-named
  host with existing key authentication (`BatchMode=yes`, `ExitOnForwardFailure=yes`); PID 14228.
- Credential: only the `AFLDB_OWNER_DATABASE_URL` line of the main checkout `.env` was read (not sourced, copied or exported). It
  named role `afldb_owner` and carried no query options (so no SSL setting existed to preserve; any option would have been
  refused). The probe DSN was that value with only host port and database rewritten to `127.0.0.1:55432` / `afldb_test`, and
  was supplied only in the probe child process's environment (no argument, file, log or persistent setting).
  `AFLDB_TEST_IMPORT_DATABASE_URL` was removed from the child environment.
- Tunnel closed afterwards: PID 14228 stopped (only that PID), no listener on 55432, no `AFLDB_TEST_DATABASE_URL` in the shell.
  The temporary wrapper script and tunnel stderr file were deleted. The only database session opened was the probe's own,
  read-only (identity query plus the leftover-session count); no write, lock or termination happened server-side.

**Decision needed (new).** To run the integration scenarios non-vacuously, `afldb_test` must be brought to migration-110 state
by the operator's own procedure (not authorised here and not done). Until then the guarded procedure (§19.3) cannot start, and
PostgreSQL behavioural acceptance stays PENDING. After migration 110 is applied to `afldb_test` (a state-changing database
operation requiring its own authorisation and target check), re-run the probe unchanged from the worktree root.

Files changed by this step: this runbook, `issues.md`, `IssuesIndex.md`. No code, test, probe or patch file changed.

## 23. The matches-only cases do not need migration 110; separate probe MO-1 (2026-10-12, solo; local files only: no database, host, integration run, migration, grant, commit, push or deploy)

Scope given: investigate whether the four ISSUE-274 integration cases genuinely require migration 110 or only inherit it from the durable
Match Sheet wrapper; if not, move them, keep the discriminator/assertions/count check/cleanup gate, keep the `player_match_stats`
authority tests guarded by State B, keep the original probe and its State-A FAIL as history, and prepare a separately identified
probe. `afldb_test` stays in State A (not touched). D-274-1 stays approved. ISSUE-274 stays Open, ISSUE-275 separate, ISSUE-265 PROD hold unchanged.

### 23.1 Finding: the cases only INHERIT the requirement (established by reading the code; nothing executed)

| Dependency of the cases | What it actually needs | Needs migration 110? |
|---|---|---|
| Wrapper | They were `scenario(...)` calls inside `describe('Durable Match Sheet authority through the settle (ISSUE-257 F-S9-03)')`. That wrapper does `if (!storable) return;`, and its `beforeAll` seeded three players only `if (storable)`. The cases use no player. | **Inherited only.** In State A the two lock cases would pass without running (the vacuous pass §19 closed by adding a precondition `it` that FAILS in State A). |
| Fixtures / seed helpers | `seed(f, [])` = a bundle with `players: []`: `matches` (+ cascading `match_period_scores`), staging, ledger and spine rows, season 2093, `fixtures`/`ids122` from the **S5** `beforeAll` (not the durable one). No `player_match_stats` row, no identity, no durable authority, no Match Sheet writer. | No |
| Authority loader | `apply122` defaults to `loadManualAuthority(tx, 2093)`: reads the `data_overrides` CHECK, active `matches` overrides, manual-attendance matches, and `loadPlayerMatchStatsAuthority`, which returns `NO_PLAYER_MATCH_STATS_AUTHORITY` while no `player_match_stats` record exists (State A can hold none). `overrideScopeProvenFrom` is true in BOTH states: the editor spec (`src/lib/edit/spec.ts`) has no `player_match_stats`, so editor ⊆ CHECK holds in State A; the existing State-A-capable §8 suite already asserts it. | No |
| Constraint | The holder inserts `data_overrides('matches', <key>, 'score')`. Migration 102's CHECK (State A) lists `matches`; the existing §8 suite inserts the same entity/group in State A. | No |
| Cleanup | `cleanup122` sweeps `matches`, ledger and staging rows under `2093\|issue122-%`, but `matches` OVERRIDES only under the bare `issue122-` prefix, and `cleanupAuthority` deletes only `player_match_stats` overrides. The old cases relied on a per-scenario `clearOverride()` only; an interrupted or gated run left an override that no pre-clean removed. | No (but a real residue gap, now closed) |

Conclusion: migration 110 is **not** required. **Not verified by execution** (nothing may be run here); the live prerequisites are
checked by the new precondition test and by probe MO-1 below. I did not check whether the rest of the S5 describe currently passes on `afldb_test`.

### 23.2 Change (tests only; no production source touched)

`tests/integration/settle-afltables.test.ts`

- The ISSUE-274 block (harness `settleBehindHolder`, `matchLedger`, `scoreCorrection`, the two lock cases, the driver-count case, the 275 `it.todo`)
  moved out of the durable-authority describe into a new sibling describe inside the S5 describe, `'AFLDB-ISSUE-274 — a matches-only settle unit
  locks the match row (needs no migration 110)'`. It has **no `storable` probe and no early return**. Case bodies unchanged except
  `seed(f, [])` → `seed(f)`, wrapper `scenario274`, and fixtures `fixture('edit', 27)` / `fixture('del', 28)`.
- Preserved: the blocked-query discriminator (`FOR NO KEY UPDATE`, and `not.toMatch(/^\s*UPDATE matches/)` for the edit case); editor
  value/override/ledger assertions (`homeScore` 112, override still active, `canonicalRowsUpdated` 0, ledger `['insert']`); deletion
  assertions (row gone, 0 updated, ledger `['insert']`); the driver `count === 0` check; bounded controls; `createCleanupGate`.
- New local helpers (not shared with the durable describe): `at()` (2093-10-02…, later than every T122 value), `fixture()` (keys
  `2093|issue122-274-<tag>-1`, round `110+3n+1` as before, dates 2093-07-27/28), `seed()`, `cleanupMatchesOnly()` (DELETE of `matches`
  overrides under `2093|issue122-274-%`, in a `beforeAll` pre-clean, the gated `afterAll`, and the per-scenario wrapper via
  `cleanupGate.scenario(body, cleanupMatchesOnly)`).
- The State-B precondition `it` is replaced by a read-only **matches-only precondition**: the CHECK reads as one allowlist, admits
  `matches`, `overrideScopeProvenFrom` is true, and the real loader answers `clear` for a no-override matches proposal. It does not assert the
  `player_match_stats` state.
- The existing durable `player_match_stats` cases are unchanged and stay guarded by `storable` (State B).

`tests/behind-holder.test.ts` (DB-free source pins, 31 → 34 tests): the remover set now includes `cleanupMatchesOnly` (4 gated hooks,
6 direct pre-clean/in-gate calls); both wrappers go through the gate with the shared timeout; and three new pins read the integration source:
both describes exist once, the durable describe contains no `const settleBehindHolder` / `await settleBehindHolder(` / `ISSUE-274: ` / `FOR NO KEY UPDATE`,
and the matches-only describe (comments stripped) has no `storable`, no `playerMatchStatsAuthorityStorable`, no `if (!x) return;`, no
`player_match_stats`, and still holds the two scenarios, the count check, both discriminators and the editor/deletion assertions.
(The pins were not mutation-tested: that would mean editing the integration source, which this step does not do.)

### 23.3 Probe MO-1 (outside the repository: `D:\tmp\issue274\probe\issue274-matches-only-probe.mjs`)

SHA-256 `7c6c191138f0e7942d6747c1ce541fca412b4ee13f31b280f2a8cd71ddfc9735`. **A separate file with its own identity** (`probe-mo:` line
prefix, `MATCHES-ONLY PROBE OK/FAIL` verdicts, `afldb-i274-mo-probe-*` session names). It is **not** the original gate: the original
`issue274-probe.mjs` is byte-identical (`f5861a11…0bdc`), and its State-A FAIL (§22) stands as history. A pass of MO-1 is reported as "MO-1 passed",
never as a pass of the original probe, and says nothing about the durable `player_match_stats` cases.

Same safety envelope as the original (DSN from the environment only, never printed; every session read-only; 90 s watchdog; bounded
waits; only private advisory locks). Checks, in order, stopping at the first failure:

1. Preflight with no network: worktree root, no `.env`, `AFLDB_TEST_IMPORT_DATABASE_URL` unset, DSN names exactly `afldb_test` and role `afldb_owner`.
2. Server identity: `afldb_test`, `current_user`/`session_user` `afldb_owner`, database owner `afldb_owner`, not in recovery, read-only. No `afldb-i274-*` session exists.
3. **Matches-only prerequisites** (replaces the original's migration-110 check): 12 required relations; exactly one `entity_type` CHECK, admitting `matches` and
   admitting neither `match_period_scores` nor `brownlow_round_votes`; `player_match_stats` admitted or not is **reported, never required**; exactly one plain
   unique index on `data_overrides(entity_type, entity_key, field_group)` (the holder's `ON CONFLICT`); the 11 columns the holder/count check name; ≥ 2 clubs
   with `legacy_club_hist`; no `matches` row on the ISSUE-099 dedicated key or under the bare `issue122-` prefix (the suites' own fail-closed `beforeAll` checks);
   residue counts (informational).
4. Unchanged from the original: blocked-query visibility (advisory-lock rehearsal), the `matches` unique-index catalogue check (§18.1), the suite's control options honoured by the server,
   `pg_terminate_backend` by application name works and the backend disappears, no probe session remains.

**Expected last line: `probe-mo: MATCHES-ONLY PROBE OK (MO-1): safe to start the matches-only integration procedure …`.** Checked here (no database): `node --check` exit 0; three
no-connection preflight branches (unset DSN; database `afldb_dev`; role `afldb_import`) each stop with `MATCHES-ONLY PROBE FAIL`, exit 1. **Not run against a database.**

### 23.4 Matches-only procedure (operator-run; supersedes §19.3's step 0 and step-2 expectation for this run only)

Credentials, tunnel and "no transcript" rules as §19.3. Nothing grants, migrates or touches PROD; `afldb_test` stays State A.

0. `node D:\tmp\issue274\probe\issue274-matches-only-probe.mjs` → last line `MATCHES-ONLY PROBE OK`. Any `MATCHES-ONLY PROBE FAIL`: stop and report; change nothing to pass.
1. `npx vitest run tests/integration/settle-afltables.test.ts -t "ISSUE-274"` → expect **4 passed + 1 todo** (precondition, edit, delete, driver count; the 275 todo). Same count as §19.3 but the
   first test is now the matches-only precondition, and none of the four can pass vacuously.
2. Unchanged from §19.3 steps 1 and 3-7 (baseline attribution; then one vitest process per file). Stop conditions as §19.3, except that "the precondition test failing (State A)" no longer applies;
   any `UnresolvedWorkError` still does, and after one MO-1 refuses to pass while an `afldb-i274-*` session exists.
3. `Remove-Item Env:AFLDB_TEST_DATABASE_URL`.

Reading the result is as §19.3. State B behaviour of these cases is the same by construction and is not run either.

### 23.5 Proposed fixture writes and cleanup (for review; not executed)

`-t "ISSUE-274"` still runs the file-level `beforeAll`/`afterAll` and the S5 `beforeAll`/`afterAll` (a `-t` filter skips tests; hooks of suites that contain a selected test still run: vitest behaviour, not observed here). All writes are committed to `afldb_test` only, and are the suite's existing fixture protocol, unchanged by this step:

| When | Writes | Removed by |
|---|---|---|
| File-level `beforeAll` (ISSUE-099) | pre-clean `cleanupIssue099`; `seasons` 2094 (`ON CONFLICT DO NOTHING`); `sources` `afltables` / `squiggle_api` only if absent; player `issue099-fixture-player` + identity; `import_batches` (`issue099-settle-fixture`); `matches` `issue099-match-key-disagree` + `staging.external_current_matches`; three spine records (`staging.source_payloads/source_records/source_record_versions`); two `staging.afltables_*` sentinels | gated `afterAll`: `cleanupIssue099`, and the two `sources` rows only if this run created them |
| S5 `beforeAll` (ISSUE-122) | pre-clean `cleanup122` (season 2093 namespace); `seasons` 2093; two players + one identity; `auth_users` row only if none exists | gated `afterAll`: `cleanup122`, and the admin row only if created |
| Matches-only `beforeAll` | `DELETE` of `matches` overrides under `2093\|issue122-274-%` (pre-clean) | — |
| Each lock case, seed | first settle of `2093\|issue122-274-edit-1` / `…-del-1`: `staging.source_*` rows, `staging.afltables_match` projection, `import_batches`, `matches` (+ `match_period_scores`), one `canonical_applications` `insert` | `cleanup122` (key prefix `2093\|issue122-%`, label, notes) |
| Each lock case, holder / settle | holder: `matches` row `FOR UPDATE`; edit case `UPDATE matches` (home_goals 17 / score 112 / margin 40) and upsert `data_overrides('matches', key, 'score')`; delete case `DELETE match_period_scores` + `matches`; the blocked settle (own connection) writes nothing for the unit | edit case: `cleanupMatchesOnly` (and the case's own `clearOverride`); delete case: nothing remains of the match |
| Sessions | three per case (`afldb-i274-<pid>-<rand>-holder / -settle / -control`), terminated and confirmed gone before any removal | `UnresolvedWorkError` ⇒ the gate skips every removal; MO-1 then refuses until they are gone |

Files changed by this step: this runbook, `issues.md`, `IssuesIndex.md`, `tests/integration/settle-afltables.test.ts`, `tests/behind-holder.test.ts`. Outside the repository: `D:\tmp\issue274\probe\issue274-matches-only-probe.mjs` (new). The earlier patch (`D:\tmp\issue274\AFLDB-ISSUE-274-complete-r3.patch`) is now out of date and was not regenerated.

## 24. MO-1 and the focused matches-only integration run against `afldb_test` (2026-10-12, solo; both PASSED)

Authorisation (owner, this task only): MO-1, and only if it passed and the baseline was clear, ONE `-t "ISSUE-274"` invocation against exactly `afldb_test`;
the file-level, S5 and matches-only fixture writes and cleanup of §23.5 (including conditional source/admin creation and the two holder transactions);
no other cleanup, no migration 110, no grants, no commit, push or deployment. `afldb_test` stayed in State A. ISSUE-274 stays Open; ISSUE-275 separate; the ISSUE-265 PROD hold unchanged.

### 24.1 Files verified before any connection

| File | SHA-256 | Result |
|---|---|---|
| `D:\tmp\issue274\AFLDB-ISSUE-274-matches-only-r4.patch` | `9fda0737ac92d1e216fa150f1f99c39ff54d18c4079f81c5023568e5573b34b5` | matches the reviewed value |
| `D:\tmp\issue274\probe\issue274-matches-only-probe.mjs` (MO-1) | `7c6c191138f0e7942d6747c1ce541fca412b4ee13f31b280f2a8cd71ddfc9735` | matches before the run and again after it |

Limit: the patch was verified as a FILE. I did not prove that the working tree is byte-identical to it (no Git command was run). Its file list (11 files) equals
the modified/new files `git status` showed at the start of the session.

### 24.2 Connection method and target confirmation

- Tunnel: `ssh -N -L 127.0.0.1:55432:127.0.0.1:5432` to the `streamanator` alias (the DEV host that holds `afldb_test`; not the `afldb` PROD alias), existing key authentication,
  `BatchMode=yes`, `ExitOnForwardFailure=yes`; no listener on 55432 beforehand; created PID 27940; **only that PID stopped afterwards**, no listener remains.
- Credential: only the `AFLDB_OWNER_DATABASE_URL` line of the main checkout's `.env` was read (role `afldb_owner`, no query options; any option or other role would have been refused). The DSN was rebuilt in
  process with only host/port/database changed to `127.0.0.1:55432` / `afldb_test`, and handed to children only in their environment (never an argument, file or log). The child
  environment had every `*DATABASE_URL` / `PG*` variable of the shell removed first, so `AFLDB_TEST_IMPORT_DATABASE_URL`, `AFLDB_IMPORT_DATABASE_URL` and the DEV/PROD DSNs were not inherited. No `.env` exists in the worktree. Output was masked and
  teed to logs; a scan of every captured log/JSON found no `postgres://` string.
- Which connections: every connection in `settle-afltables.test.ts` (`sql`, `broken`, `side`, and the scenario's `holder`, `settle` and `control`) is built from `AFLDB_TEST_DATABASE_URL`; `src/db/client.ts` reads `DATABASE_URL`, which
  `tests/setup.ts` overwrites with the same value and refuses unless the database name ends `_test`; the file-level `beforeAll` also asserts `current_database()` ends `_test`. The server-side identity was observed for MO-1 and for the two
  censuses (`afldb_test` / `afldb_owner`), NOT for the vitest process's own sessions: that part is "by construction", not observed.

### 24.3 MO-1: PASSED (exit 0)

Last line: `probe-mo: MATCHES-ONLY PROBE OK (MO-1): safe to start the matches-only integration procedure (this is not a pass of the original migration-110 gate)`. Evidence it printed: identity `afldb_test` /
`afldb_owner`, owner `afldb_owner`, not superuser, read-only, PostgreSQL 16.15; the `entity_type` CHECK admits `matches` and neither source-owned settle target (13 entities), `player_match_stats` **not admitted (State A)**, informational;
12 relations, the `ON CONFLICT` index, the 11 named columns, `clubs=24` and the fixture-key collision checks all pass; residue (season-keyed matches, own matches-overrides, fixture seasons) all 0; blocked-query evidence visible
(`wait_event_type=Lock`, statement text readable); `matches` unique indexes `matches_legacy_match_id_key`, `matches_match_key_key`, `matches_pkey` (none partial or expression); suite control options honoured by the server; `pg_terminate_backend`
by application name works and the backend disappears; no probe session remains. **This is a pass of MO-1 only. The original probe's State-A FAIL (§22) stands as history and is not superseded.**

### 24.4 Baseline (read-only, before any fixture write; session `i274-census`, `default_transaction_read_only=on`)

51 selectors covering `cleanupIssue099`, `cleanup122`, `cleanupMatchesOnly` and the fixture seasons: 46 were 0. The non-zero ones, none of which a pre-clean selector can delete: `sources` `afltables` and `squiggle_api` both present
(borrowed; the suite removes a source row only if it created it), `auth_users` = 5 (no admin row is created), `clubs` with `legacy_club_hist` = 24, and **12 `import_batches` carrying the `issue122-s6-cli` label** (earlier S6 runs; neither `cleanup122` batch selector, label `issue122-apply-test` or the repair tool, matches them, both counted 0, and the S6 delete is
by recorded ids only). Seasons 2093 and 2094 were absent, with no dependent rows. **Pre-clean would delete nothing**, so the run proceeded. Totals before: matches 16 838, match_period_scores 134 704, player_match_stats 685 471,
brownlow_round_votes 320 861, data_overrides 92, canonical_applications 0, import_batches 729, data_issues 4, `public.auth_audit_log` 203; no user trigger on `matches`, `match_period_scores`, `data_overrides` or `canonical_applications`; 109 recorded migrations.

### 24.5 The focused run: PASSED, exit 0

Invocation (run once, from the worktree root): `node node_modules/vitest/vitest.mjs run tests/integration/settle-afltables.test.ts -t "ISSUE-274" --reporter=verbose`, the same as `npx vitest run … -t "ISSUE-274"` plus a reporter flag so per-test results were captured (no execution change).

```
 Test Files  1 passed (1)
      Tests  4 passed | 76 skipped | 1 todo (81)
   Duration  30.08s        run-child: EXIT_CODE=0
```

| Case | Result |
|---|---|
| precondition: the matches-only authority prerequisites hold | passed, 91 ms |
| a Data Editor score edit committed while a matches-only unit is in flight is not overwritten | passed, 8 528 ms |
| a match deleted while a matches-only unit waits for its lock is not counted as updated | passed, 7 948 ms |
| the driver reports count 0 for an UPDATE that matches no row | passed, 75 ms |
| AFLDB-ISSUE-275 acceptance case | `todo` (as recorded; not an ISSUE-274 pass) |

The 76 skipped are the other tests of the file (including every durable `player_match_stats` case) filtered out by `-t`. The four cases ran with no early return and no schema-state guard, so none passed vacuously. No discrepancy; no `UnresolvedWorkError`;
no automatic rerun. Logs: `D:\tmp\issue274\run-20261012-mo1\` (`mo1.log`, `vitest-274.log`, `baseline-pre.json`, `baseline-post.json`, and the three scratch helpers that built the DSN and ran the children).

### 24.6 After the run (same read-only census)

Selectors, fixture seasons, totals, `auth_audit_log` and the schema-state hashes (the `data_overrides` CHECK, the columns and indexes of the five touched tables, trigger count, grant-row count, 109 migrations) are **identical** to the baseline. No fixture row, matches override, season, source
or admin row is retained; the 12 pre-existing S6 batches are untouched. No `afldb-i274-*` session exists, no other session on the database, none idle in transaction. `data_overrides` still does not admit `player_match_stats` (State A unchanged); migration 110 was not applied and nothing was granted.
Not measured: sequence/identity counter values (the fixture inserts and rollbacks necessarily advanced them; that is not a retained row).

### 24.7 What this establishes, and what it does not

Establishes, on `afldb_test` in State A and for one run: the match-row lock behaves as the harness's discriminator requires for a matches-only unit, under real PostgreSQL blocking (the settle's blocked statement was read back from `pg_stat_activity`; an editor value and active
override survive; a deleted match is not counted as updated; the real driver reports `count` 0), and the harness's fixture protocol, termination and cleanup gate completed cleanly.

Does NOT establish: (1) the same cases failing against the UNFIXED source on PostgreSQL (the discriminator is designed to, and the DB-free mutation tests show the fix is load-bearing, but the integration run was not repeated on the base); (2) State B / the durable `player_match_stats` cases;
(3) the rest of the file, the other suites, or the baseline attribution of §19.3 (one vitest process per file), which remain PENDING; (4) the overlapping-run lock-cycle risk of §18.2 (not exercised); (5) repeatability (one run, no repeat); (6) the restricted import-role path (`AFLDB_TEST_IMPORT_DATABASE_URL` unset by design);
(7) anything about DEV or PROD behaviour.

Next action: the rest of §19.3 (broader suites, operator-authorised), then commit, DEV deploy and acceptance, sequenced with ISSUE-275. Files changed by this step: this runbook, `issues.md`, `IssuesIndex.md` only. No code, test, probe or patch file changed.

## 25. Provenance check against reviewed R4, and the validation plan for the rest of §19.3 (2026-10-12, solo; local files and read-only Git only: no database or host contact, migration, grant, commit, push or deployment)

Scope given (owner, this task): verify the current source/test files against the new-file blob hashes in reviewed R4 with read-only Git or a temporary index; prepare, do not run, the remaining integration validation; update tracking; return the plan and the current diff. ISSUE-274 stays Open, ISSUE-275 separate, the ISSUE-265 PROD hold unchanged. **Nothing in this section was run against a database.** The original logs and results under `D:\tmp\issue274\run-20261012-mo1\` were not touched.

### 25.1 Provenance check (performed now, AFTER the §24 run; it is NOT a fingerprint captured before that run)

Method: for every file in the `diff --git` headers of `D:\tmp\issue274\AFLDB-ISSUE-274-matches-only-r4.patch` (sha256 `9fda0737…34b5`, which carries full 40-hex blob ids), `git hash-object -- <path>` (reads the file, applies the repository's clean filters, prints the id; no `-w`, nothing written, no index involved) was compared with the patch's post-image id, and the patch's pre-image id with `git rev-parse HEAD:<path>`. The real index file was not opened for writing (sha256 before: `fc88a230…29a9`; the re-check is in the hand-off).

| File (R4) | R4 post-image | Working file now | Pre-image = `HEAD` |
|---|---|---|---|
| `src/lib/acquisition/canonical-apply.ts` | `458174b5…` | **match** | yes |
| `src/lib/acquisition/match-rekey.ts` | `f6cf2d4b…` | **match** | yes |
| `src/lib/acquisition/settle-afltables.ts` | `94df1e91…` | **match** | yes |
| `tests/current-season-import.test.ts` | `a6b4a457…` | **match** | yes |
| `tests/integration/settle-afltables.test.ts` | `2b4fe804…` | **match** | yes |
| `tests/behind-holder.test.ts` (new) | `51da6b7f…` | **match** | new file |
| `tests/integration/behind-holder.ts` (new) | `920508a6…` | **match** | new file |
| `issues/open/AFLDB-ISSUE-275.md` | `89079e1d…` | **match** | yes |
| `IssuesIndex.md`, `issues.md`, `issues/open/AFLDB-ISSUE-274.md` | `122d9296…`, `c7dc50c4…`, `ea1e6c10…` | differ (expected: §24's documentation edits, made after R4) | yes |

**Result: no source or test mismatch.** All seven source/test blobs are byte-identical (as Git hashes them) to R4's. Corroboration, weaker than a hash and recorded as such: the seven files' modification times are 07:18 to 09:20 on 12 Oct, R4 was written at 09:35, and the run's logs were last written at 10:23, so nothing in them was edited between R4 and the end of the run. What this does NOT establish: that the vitest process loaded exactly these bytes. That is inferred from the mtimes and from §24.1's patch-file hash, not observed.

An untracked zero-byte file named `ISSUE-274` exists at the repository root (mtime 10:21 on 12 Oct, inside the §24 session; present in the session-start status). It is not one of R4's eleven files, was not created by this step, and its origin is unknown (compare the stray `{` and `` `matches` `` files of earlier sessions). I left it in place and it is excluded from the patch. Removal is the operator's call.

### 25.2 Which unresolved concern each proposed run checks

| Id | Concern (from §24.7) | Run |
|---|---|---|
| U1 | The integration discriminator has never been shown to FAIL on PostgreSQL without the lock | R1 |
| U2 | Every other AFL Tables settle, rekey and repair case against the changed applier (new lock, unlocked late-candidate search and its `stale_canonical_target` refusal, `requireRowUpdated`) | R2 |
| U3 | The same for the AFL API caller (`settle-afl-api.ts` also goes through `applyCanonicalUnit`) | R3 |
| U4 | Whether the production `afldb_import` role may take the new lock | §25.6 (catalogue; no run of its own) |
| U5 | Accidental interaction with the editor and promotion protocols | R4, optional |
| U6 | Overlapping-settle lock cycle (§18.2) | **not tested by anything here** |
| U7 | Late-candidate refusal on PostgreSQL (§19.1/§20.1) | **not tested by anything here** (DB-free only) |
| U8 | State B / durable `player_match_stats` cases | **blocked** (migration 110 not applied; not to be applied) |

No broad rerun is proposed beyond R2 and R3, which are the two whole files the changed applier serves.

### 25.3 R1: the same tests with only the lock reverted (answers U1)

**Isolated copy**, not the worktree: new empty directory `D:\tmp\issue274\revert-lock-20261012\`, outside the repository, made from the worktree's tracked files plus the two new test files, excluding `.git`, every `.env*`, `.next` and the stray `ISSUE-274`; `node_modules` by the method used for `D:\tmp\issue274\base-416f5f27` (a junction, if used, is removed with `cmd /c rmdir`, never `Remove-Item -Recurse`). Then ONE edit: delete `src/lib/acquisition/canonical-apply.ts` lines 531-536, the `if (unit.targets.some(... 'matches' || ... 'match_period_scores')) { ... FOR NO KEY UPDATE ...; return new Set(); }` block of `lockUnitMatchRows`. Everything else stays: the retired-candidate `FOR UPDATE` branch, the `FOR SHARE` branch, `requireRowUpdated`, the late-candidate refusal. Before any connection, a per-file SHA-256 comparison of copy against worktree must show exactly one differing file (`canonical-apply.ts`), and a text diff of it exactly those six lines. The tests are the current files (blobs as in §25.1), unchanged.

**Run (once, from the copy):** `node node_modules/vitest/vitest.mjs run tests/integration/settle-afltables.test.ts -t "ISSUE-274" --reporter=verbose`. Step 0 is MO-1 from the worktree (it requires a worktree root with `package.json` name `afldb` and no `.env`), unchanged. Same tunnel, DSN construction, child environment, masking and logs as §24.2.

**Expected result: exit 1; 2 failed | 2 passed | 76 skipped | 1 todo.**

| Case | Expected | Assertion that fails |
|---|---|---|
| precondition (matches-only prerequisites) | passes (does not involve the lock) | none |
| Data Editor score edit not overwritten | **fails** | `whileBlocked`, `settle-afltables.test.ts:6207`: `expect(blockedQuery).toContain('FOR NO KEY UPDATE')`. The blocked statement should be the unit's final `UPDATE matches SET ...`. |
| match deleted while the unit waits | **fails** | `whileBlocked`, `:6235`, the same `toContain` |
| driver count 0 | passes (no lock involved) | none |
| ISSUE-275 | `todo` | none |

Not reached, because `whileBlocked` throws first: `:6208` (`not.toMatch(/^\s*UPDATE matches/)`), the editor-value, override, `canonicalRowsUpdated` and ledger assertions (`:6213-6220`), and the deletion assertions (`:6238-6240`). So R1 proves the discriminator is load-bearing; it does not by itself observe the overwrite, and the current tests cannot (the unfixed end state is destroyed by the cleanup). The statement actually blocked on is the evidence, recorded verbatim. It could instead be a `match_period_scores` statement if the unit writes period scores before `UPDATE matches` (a foreign-key check takes `FOR KEY SHARE` on the held row); the assertion fails either way. Any other outcome is a finding, not a pass: **4 passed** would mean the integration cases do not detect the missing lock (stop, report); a different assertion failing, a timeout or an `UnresolvedWorkError` is reported as observed.

**Failed-test teardown, from the code (not yet exercised under failure on PostgreSQL):**
1. `whileBlocked` throws inside `runBehindHolder`'s `try`; `fail()` records it and control falls to the always-run path, which releases the holder FIRST.
2. The holder commits (edit: `UPDATE matches` and the override upsert; delete: `DELETE match_period_scores` then `DELETE matches`), and the blocked settle proceeds. Edit case: the settle overwrites the value and writes an `update` ledger row (the defect, now in a fixture that is about to be removed). Delete case: its `UPDATE matches` affects 0 rows, `requireRowUpdated` (still in the copy) throws inside the unit's savepoint, the unit becomes `write_failed`, and the run opens a `canonical_apply_failed` finding; the settle returns normally.
3. Holder and settle are each awaited up to `boundMs` (15 s); `closeAndConfirmGone` ends the three sessions and polls `pg_stat_activity` up to 4 s; only then does `cleanup` run (the edit case's `clearOverride`) and the first failure is rethrown. The wrapper's `finally` runs `cleanupMatchesOnly`; the enclosing `afterAll` hooks run `cleanup122` and `cleanupIssue099` through the gate. `cleanup122` covers the rows the failure path adds: `data_issues` (`issue_key LIKE '%issue122-%'`), `canonical_applications`, `import_rejections`, `promotion_candidates`, the staging rows, `matches`, and `import_batches` by label.
4. No cycle is expected: the holder waits on nothing until released. Hedge: if the unit wrote a period-score row before `UPDATE matches`, the delete holder's `DELETE match_period_scores` could wait on the settle while the settle waits on the holder's `matches` lock. PostgreSQL aborts one after `deadlock_timeout` (default 1 s) with `40P01`, both sessions end, and teardown still completes; the failure message would then carry the `40P01`.
5. The only path that skips removal is `UnresolvedWorkError` (a session not confirmed gone). It names the sessions; MO-1 then refuses until they are gone. Stop and report; do not rerun.

**Target roles:** `afldb_owner` for the suite client, holder, settle and control (`AFLDB_TEST_IMPORT_DATABASE_URL` unset). **Fixture writes:** exactly §23.5 (file-level ISSUE-099, S5 ISSUE-122 season 2093, the matches-only block). **Cleanup selectors:** the 51 of §24.4 (`cleanupIssue099`, `cleanup122`, `cleanupMatchesOnly`). **Retained rows expected:** none; the permanent non-zeros of §24.4 stay (both `sources` rows borrowed, `auth_users` = 5, `clubs` with `legacy_club_hist` = 24, and the **12 `issue122-s6-cli` batches, which this run cannot touch: the S6 block is not selected by `-t "ISSUE-274"`**). **Skips:** 76 filtered by `-t`; no vacuous pass is possible (no schema-state guard in the block). **Known baseline failures:** none for these four cases. Pre- and post-run census with the §24.4 script; a post-run difference is a finding.

DB-free corroboration that already exists (older tree, not re-run): `D:\tmp\issue274\mutation\mut-lock.json` (§18.6, 11 Oct) shows that removing this same lock fails 7 cases in `tests/current-season-import.test.ts`.

### 25.4 R2: the whole AFL Tables settle file (answers U2)

`node node_modules/vitest/vitest.mjs run tests/integration/settle-afltables.test.ts --reporter=verbose`, from the worktree, after R1, one process, same envelope. It includes the four ISSUE-274 cases again (repeatability, a bonus not a goal). What it checks that nothing else has: the ISSUE-131 rekey and repair-match-rekeys blocks (the retired-candidate lock moved before the authority snapshot, the late search is unlocked, a new refusal exists), every S5 writer with the real driver's `count` (`requireRowUpdated` must see 1 on ordinary updates), and the S6 end-to-end run. It cannot check the durable rekey cases (R-01 and its siblings), which are State B.

- **Roles:** owner for everything (the suite's guarded client; the S6 block substitutes it for `AFLDB_IMPORT_DATABASE_URL`, and the durable describe points `AFLDB_IMPORT_DATABASE_URL` at the owner DSN). The restricted-role case, `it.skipIf(!importRole.isConfigured)` at `:1801`, is **skipped** while `AFLDB_TEST_IMPORT_DATABASE_URL` is unset, and in any case it passes `UNAVAILABLE_MANUAL_AUTHORITY` with no loader, so every unit is refused before the applier (its own assertion is `canonicalRowsInserted === 0`): it would not exercise the lock even if enabled (§25.6).
- **Fixture writes:** ISSUE-099 file-level fixtures; the S5 season-2093 namespace (`2093|issue122-*`, players `issue122-*`, derived rows for season 2093 and those players); ISSUE-131 and repair-tool blocks (`import_batches` with `tool = 'repair-match-rekeys.ts'` and `notes` containing `season=2093`); the matches-only block; and the S6 block's COMMITTED `--apply` batches (label `issue122-s6-cli`).
- **Cleanup selectors:** the 51 of §24.4, plus for S6 the recorded batch ids (deleted by id AND tool, target, status and exact notes). **The 12 pre-existing `issue122-s6-cli` batches are preserved by construction** (no selector matches them; `s6CommittedBatchIds` holds only this process's ids). The census must record the exact id list of the `issue122-s6-cli` batches before and after (the §24 census recorded the count): the same 12 ids, no more.
- **Retained rows expected:** none beyond the permanent non-zeros. If S6 teardown removes fewer batches than recorded, the suite throws `S6 teardown removed N of M ...`; that is a finding.
- **Expected skips and non-coverage:** the restricted-role case skipped (1); the ISSUE-275 `todo` (1). **The 11 scenarios of the durable Match Sheet describe (`:5479-5781`) `return` early in State A and vitest reports them PASSED. They are not coverage and are listed as NOT EXERCISED in the result.** By my count that leaves about 64 of the file's 80 tests genuinely exercised (80 = 4 + 76 from §24.5; minus 11 vacuous, minus 1 skipped), an expectation to be checked against the log, not a fact. **[CORRECTED 2026-10-12, §26.3: that subtracted from 76, which EXCLUDES the four ISSUE-274 cases. The right figure is 80 − 11 − 1 = 68 exercised (observed: 67 passed and 1 failed). It was never an acceptance target.]**
- **Known baseline failures:** none recorded for this file on `afldb_test`. This is the first full-file run on this tree, so a failure is attributed before it is judged: read the message first (42501, "permission denied", "relation ... does not exist", "migration", `UnresolvedWorkError` are stop conditions per §19.3); then, only for the failing file, repeat it from `D:\tmp\issue274\base-416f5f27` (an export of `416f5f27`; confirm it still equals `HEAD` before relying on it) in the same envelope.
- **Duration:** not measured (the 4-case run took 30 s including fixture setup; no extrapolation). The operator sets a watchdog; if it fires, the first action is the session census (any `afldb-i274-*`, idle-in-transaction), before anything else.

### 25.5 R3: the whole AFL API settle file (answers U3)

`node node_modules/vitest/vitest.mjs run tests/integration/settle-afl-api.test.ts --reporter=verbose`, after R2 has been censused. It checks the second caller of the applier: AFL API match inserts and updates, the I244-F009 refusals, I244-F010 identity corrections, I244-F030 plausible-fixture search (the one search that still locks after the snapshot, ISSUE-275's window) and the writers' `requireRowUpdated` with the real driver.

- **Roles:** owner for the suite client; the S6 adjudication blocks route the import DSN through `routeS6ImportDsn()`, which uses `afldb_import` only when `AFLDB_TEST_IMPORT_DATABASE_URL` is set (unset here, so owner). The ISSUE-257 §17.8 case sets `AFLDB_IMPORT_DATABASE_URL` to the owner DSN.
- **Difference from every earlier run: it uses REAL data.** It requires the real clubs Hawthorn and Brisbane Lions and the real venue M.C.G., writes a permanent keep-alive 2026 home-and-away anchor while it runs, and in `beforeAll`, before each later case and `afterAll` it calls `recomputeSeasonMetadata` and `recomputeClubSeasons` for **season 2026**. Those derived rows (`seasons` 2026, the season's `club_seasons`) are therefore **rewritten, not deleted**, and no cleanup selector can undo it. The recompute normalises them to canonical truth, so the likely change is none or a correction of stale values, but that is a prediction. **This is the one run whose retained state I cannot promise to be identical.**
- **Fixture writes:** the `CD_M2026ISSUE228*` namespace: `matches` by an exact key list (cases, home-and-away cases, the identity-corrected case, the F030 seeds, the keep-alive anchor), their `match_period_scores` and `player_match_stats`, `staging.afl_api_match` / `afl_api_player_match`, spine rows (`source_records`, `source_record_versions`, `source_payloads` named by captured hash), the afltables enrichment fixture, a synthetic bridged player with `external_identities` and `player_clubs`, `import_batches`, and the ISSUE-235/237 adjudication and identity blocks (append-only `afl_api_identity_adjudications` and related rows, removed by the owner).
- **Cleanup selectors:** `cleanup()` (`:610`): `canonical_applications` (`LIKE 'CD_M2026ISSUE228%'`, by afltables key, by `target_key`), `promotion_candidates` and `import_rejections` (`LIKE 'CD_M2026ISSUE228%'`), `data_issues` (`LIKE '%CD_M2026ISSUE228%'`), `import_batches` (`notes LIKE '%issue228-integration%'` or `'%issue228-enrichment-fixture%'`), the key-list `matches`, and the synthetic player. The file's two **fixture-leftover gates** (ISSUE-235 S6 at `:5489`, I237 at `:5503`) run last and fail on residue from this or any earlier run; their message, not my census, is authoritative for those blocks.
- **Census additions needed before this run** (the §24.4 script has none of them): the selectors above; per-table counts for `staging.afl_api_match`, `staging.afl_api_player_match`, `afl_api_identity_adjudications`; the exact id list of `issue122-s6-cli` batches; and a content hash of the season-2026 rows of `seasons`, `club_seasons` and `matches` (ordered by id) taken before and after, so any normalisation is shown and judged, not discovered.
- **Retained rows expected:** none by selector; the season-2026 derived rows as stated above. **Expected skips and non-coverage:** the ISSUE-257 §17.8 case `return`s early in State A (`:2877`) and is reported PASSED: NOT EXERCISED. The file has about 72 `it(` declarations. **Known baseline failures:** none recorded; the 2026-09-13 list in memory predates ISSUE-228..265 and does not name this file. Attribution on failure as in §25.4, using the base export.

### 25.6 The production `afldb_import` role and the new lock (answers U4)

Existing tests do **not** exercise the applier's lock under `afldb_import`:
- The settle restricted-role case (`settle-afltables.test.ts:1801`) is a dry run with `UNAVAILABLE_MANUAL_AUTHORITY` and no loader, which its own comment says "refuses everything"; it asserts `canonicalRowsInserted === 0`, whereas the S5 dry-run case at `:2719`, which does reach the writers, asserts `> 0`. I infer the units are refused before `applyCanonicalUnit`; I did not trace that line by line. Even if a unit were reached, `applyCanonicalUnit` converts any exception, a `42501` included, into `write_failed` plus a finding, and this test asserts on no finding. The case is also skipped unless `AFLDB_TEST_IMPORT_DATABASE_URL` is set.
- `tests/integration/privileges.test.ts` reads the catalogue as the owner (no second password): `has_table_privilege('afldb_import', 'matches', 'UPDATE')` and the other four privileges are asserted at `:1267-1275`. That proves the privilege, not the lock, and does not name `match_period_scores`.
- `tests/integration/data-editor.test.ts` ("issue-109 restricted override proof") runs `saveEdit` as `afldb_import`, and `saveEdit` takes the entity row `FOR UPDATE` (`src/db/queries/data-edits.ts:314`). That is the same PostgreSQL privilege class as `FOR NO KEY UPDATE` and the same table, but the stronger mode, through the editor and not the applier.

Argument, labelled as inference: PostgreSQL requires `UPDATE` privilege on at least one column for `FOR UPDATE`, `FOR NO KEY UPDATE`, `FOR SHARE` and `FOR KEY SHARE` alike; `afldb_import` holds table-level `UPDATE` on `matches` (asserted by `privileges.test.ts:1267-1275`; I did not verify the grant mechanism itself), the production settle already issues `UPDATE matches` and `FOR SHARE` on it under that role. Proposed evidence without new test code: add `has_table_privilege('afldb_import', 'public.matches', 'UPDATE')` and the same for `match_period_scores` to the read-only census (catalogue read, owner session). A direct proof would be a new test (skipped without the import DSN) that, as `afldb_import`, runs `BEGIN; SELECT id FROM matches WHERE match_key = '<absent key>' FOR NO KEY UPDATE; ROLLBACK`; it needs the derivable import DSN (memory: swap the database name) and a code change I have **not** made. **Decision requested (D-274-2): accept the catalogue evidence, or authorise the new test.**

### 25.7 The other §19.3 suites: what State A allows

| Suite | Meaningful in State A? | Blocked by State B | Notes for a run |
|---|---|---|---|
| `settle-afltables.test.ts` | **Yes**, R2 | 11 durable scenarios (vacuous pass, not coverage) | §25.4 |
| `settle-afl-api.test.ts` | **Yes**, R3 | the §17.8 case (vacuous pass) | §25.5; writes real 2026 derived rows |
| `data-editor.test.ts` | **Partly**: editor protocol cases and the State-A-capable restricted-role cases; the restricted match-sheet case asserts the State A refusal | State B branches inside tests; replay cases need Python with `psycopg` (skipped with a console warning if absent) | Hand-emulates the lock modes; never calls the real applier. Restricted-role cases need `AFLDB_TEST_IMPORT_DATABASE_URL` (derivable), otherwise `describe.skipIf`. 2026-09-13 baseline failure ("refuses to build a ladder for a season it has no matches for") may be stale. **R4, optional, U5 only.** |
| `match-results-promotion.test.ts` | **Partly**: ISSUE-185, 258, 268, 271/272 describes | the ISSUE-264 describe: its `beforeAll` THROWS in State A (`:1346`), a hard failure, not a skip | Does not call the settle applier; sets `AFLDB_IMPORT_DATABASE_URL` from the import DSN, falling back to the owner DSN, at load (`:84-85`). **Low relevance to ISSUE-274: not recommended.** If run, the ISSUE-264 failure is the expected, attributable one and is not counted. |
| `settle-promotion-deadlock.test.ts` | **No**, by design | not State B: it is phase-gated | Runs only when ISSUE-265's Phase B runner arms it (`AFLDB_ISSUE265_PHASE=B`, a fresh armed-at stamp, three DSNs including the auth role); otherwise every case is skipped and "a skipped run is not evidence". Phase B (season 2078) runs real settles and promotions and would exercise the lock incidentally, but it belongs to the ISSUE-265 gate and its hold. **Not proposed.** |

### 25.8 Order, envelope, stop conditions, decisions

Order: census → MO-1 → R1 → census → R2 → census → R3 (needs its extended census) → census; each a separate vitest process, none started until the previous census is read. Envelope for every run: as §24.2 (temporary tunnel to the `streamanator` alias, never `afldb`; owner DSN rebuilt in process and given only in the child environment with every `*DATABASE_URL`/`PG*` variable stripped; no `.env`; masked, teed logs under a new `D:\tmp\issue274\run-<date>-<tag>\`; no transcript; only my tunnel PID stopped afterwards). Stop and report, change nothing at the database, on: any `42501`/"permission denied"/"relation ... does not exist"/"migration"; any `UnresolvedWorkError`; a census difference; R1 producing anything other than 2 failed | 2 passed; an `afldb-i274-*` session left behind. No automatic rerun after any failure. Migration 110 is not applied and no grant is made by any of this.

Decisions requested: **A1** authorise R1 (copy + one run); **A2** authorise R2; **A3** authorise R3, knowing it rewrites season-2026 derived rows on `afldb_test` (alternative: a `-t`-focused subset, which still runs the same recompute hooks for the describes it selects); **D-274-2** (§25.6); whether R4 is wanted. Still untested after all of the above: U6, U7, U8, the import-role lock itself, repeatability beyond R2's repeat of the four cases, and anything about DEV or PROD. Candidates for tests of U6/U7 would need deterministic interleaving (two real settles stepped against each other; a candidate that becomes eligible between the lock and the re-search); the holder pattern gives a start, but neither is designed here.

Files changed by this step: this runbook, `issues.md`, `IssuesIndex.md`. Outside the repository: a regenerated patch `D:\tmp\issue274\AFLDB-ISSUE-274-matches-only-r5.patch` (hash in the hand-off; supersedes r4). No code, test, probe or earlier patch file changed.

## 26. R1 (lock-removal mutation) and R2 (whole `settle-afltables.test.ts`) against `afldb_test`; D-274-2 lock test prepared, NOT run (2026-10-12, solo)

Authorisation (owner, this task only): A1/R1 and A2/R2 as scoped in §25 with conditions; D-274-1 stays approved; no R3, optional suite or ISSUE-265 Phase B; no migration, grant, DEV/PROD contact, commit, merge, push or deployment; stop on any unexpected failure, timeout, deadlock or census difference, with no rerun and no manual clean-up. After R1/R2, a direct `afldb_import` lock test may be PREPARED but not executed. ISSUE-274 stays Open, ISSUE-275 separate, the ISSUE-265 PROD hold unchanged. All local times are AEDT (UTC+11). Logs and scripts: `D:\tmp\issue274\run-20261012-r1r2\`.

### 26.1 Before execution

- **Provenance, captured before any connection** (`pre-run-hashes.txt`, 11:25; reviewed patch R5 `27573e30…1c97`, sha256 and Git blob id per file). All seven source/test files matched R5's post-image ids (and so R4's):

| File | sha256 (first 16) | Blob id (first 12) |
|---|---|---|
| `src/lib/acquisition/canonical-apply.ts` | `0a018558fd6549cc` | `458174b52059` |
| `src/lib/acquisition/match-rekey.ts` | `09a63a7febb25f01` | `f6cf2d4b59b5` |
| `src/lib/acquisition/settle-afltables.ts` | `9163637ac72ba9ff` | `94df1e910974` |
| `tests/behind-holder.test.ts` | `b42cf0eca99a8a37` | `51da6b7f942e` |
| `tests/current-season-import.test.ts` | `140eee6a63fb70d7` | `a6b4a457ad86` |
| `tests/integration/behind-holder.ts` | `75621cfa8b275f58` | `920508a6d01c` |
| `tests/integration/settle-afltables.test.ts` | `3473baf0993c25ec` | `2b4fe80492f3` |

  The hashes were re-captured immediately before R2 (`pre-r2-hashes.txt`) and are identical, so the worktree was not changed between the two runs. MO-1 (`issue274-matches-only-probe.mjs`) was unchanged (`7c6c1911…9735`).
- **Connection (as §24.2).** No listener on 55432 beforehand; `ssh -N -L 127.0.0.1:55432:127.0.0.1:5432 streamanator` with `BatchMode=yes` and `ExitOnForwardFailure=yes`, PID 23596; the owner DSN built in process from `AFLDB_OWNER_DATABASE_URL` of the main `.env` only (host, port, database swapped), given only in each child's environment with every `*DATABASE_URL`/`PG*` variable removed (so `AFLDB_TEST_IMPORT_DATABASE_URL` was unset); no `.env` in the worktree or the copy; output masked and teed; a scan of every log found no `postgres://` string. **Only PID 23596 was stopped afterwards; no listener on 55432 remains.** Not observed: the vitest processes' own sessions server-side (by construction, as §24.2).
- **Fresh census before any fixture write** (`census-0-baseline.json`, read-only session `i274-census`): identical to §24.6 in selectors, totals, audits and schema state. Every pre-clean selector was 0 (`cleanupIssue099`, `cleanup122`, `cleanupMatchesOnly`; seasons 2093 and 2094 absent), so **the pre-clean would delete no existing row** and the run proceeded. New in this census: id-set fingerprints (count and md5 of the ordered ids) of 12 pre-existing tables, plus counts for 7 staging/identity tables (19 working fingerprints; `match_period_scores` has no `id` column, so its entry is an error in every census and its row count is in the totals), all of which are compared after each run. Non-zero by design: both `sources` rows present (borrowed), `auth_users` = 5, `clubs` with `legacy_club_hist` = 24. No `afldb-i274-*` session, no other session, none idle in transaction.
- **The 12 pre-existing `issue122-s6-cli` batches** (`tool = settle-afltables.ts`, `status = completed`; id and first 8 hex of the md5 of the whole row): 66 `8e7f477c`, 67 `27eabc8c`, 68 `461beefb`, 325 `95e66e63`, 326 `c29467ed`, 327 `6bdfda15`, 543 `94839d1f`, 544 `1c2443e5`, 545 `d8f6dc01`, 639 `97d9b774`, 640 `53ad6f9a`, 641 `5985b534`.
- **MO-1: PASSED** (exit 0, 00:26 UTC), unchanged probe; `mo1.log`.

### 26.2 R1: a LOCK-REMOVAL MUTATION of the ISSUE-274 selection (not a run of the complete original implementation)

- **Copy:** `D:\tmp\issue274\revert-lock-20261012\`, outside the repository, made with robocopy from the worktree excluding `.git`, `.next`, `node_modules` (a junction to the worktree's), every `.env` and `.env.*` (so `.env.example` too, which is not a credential file) and the stray `ISSUE-274`. A file-by-file SHA-256 comparison before the edit showed no difference among the 1,900 copied files; after the edit **exactly one file differs, `src/lib/acquisition/canonical-apply.ts`** (sha256 `fc68deb6…2fbf`), and a CRLF-insensitive diff against the worktree is **only lines 531-536**, the `if (unit.targets.some(... 'matches' || ... 'match_period_scores')) { await sp\`SELECT ... FOR NO KEY UPDATE\`; return new Set(); }` block. The retired-candidate `FOR UPDATE` branch, the `FOR SHARE` branch, `requireRowUpdated` and the late-candidate refusal remain. The worktree and every test file are unchanged (re-hashed, §26.1).
- **Disclosed extra step:** before the single R1 run I ran one unrelated DB-free test in the copy (`tests/query-intent.test.ts`, 46 passed, no DSN) only to prove the junctioned toolchain works, so the one authorised run would not be spent on an infrastructure fault.
- **Run (once, from the copy, 11:27:03, 28.73 s):** `node node_modules/vitest/vitest.mjs run tests/integration/settle-afltables.test.ts -t ISSUE-274 --reporter=verbose` (the same selection as §24.5). Log: `r1-vitest-274-lockremoved.log`.
- **Result: exit 1; `2 failed | 2 passed | 76 skipped | 1 todo (81)`, exactly as expected.**

| Case | Outcome | Time |
|---|---|---|
| precondition: the matches-only authority prerequisites hold | passed | 81 ms |
| a Data Editor score edit committed while a matches-only unit is in flight is not overwritten | **failed** at `whileBlocked`, `settle-afltables.test.ts:6207`, `expect(blockedQuery).toContain('FOR NO KEY UPDATE')` | 8,497 ms |
| a match deleted while a matches-only unit waits for its lock is not counted as updated | **failed** at `whileBlocked`, `:6235`, the same `toContain` | 7,351 ms |
| the driver reports count 0 for an UPDATE that matches no row | passed | 82 ms |
| AFLDB-ISSUE-275 | `todo` | n/a |

- **Actual blocked statement in both cases (verbatim from `pg_stat_activity`):** `UPDATE matches SET "home_goals"=$1,"home_score"=$2,"margin"=$3,"source_record_id"=$4,"import_batch_id"=$5, imported_at = now() WHERE id = $6`. So without the lock the unit reached its final `UPDATE matches` (after the authority read) before it waited, not a `match_period_scores` statement (§25.3 had left that open).
- **What this shows and does not show.** On PostgreSQL, with only that lock block removed, the two lock cases fail at their pre-fix discriminator and the other two do not depend on the lock: the discriminator is load-bearing (closes §24.7 limit 1 for these two assertions). It does **not** directly demonstrate an overwrite: `whileBlocked` throws before the editor-value, override, `canonicalRowsUpdated` and ledger assertions (`:6213-6220`) and the deletion assertions (`:6238-6240`) are reached, and the cleanup then removes the fixture.
- **Teardown:** completed. No `UnresolvedWorkError`, no `40P01`/deadlock, no timeout, no "SKIPPED" cleanup line in the log. Post-run census (`census-1-after-r1.json`): **identical to the baseline** in selectors, totals, audits, schema, all 19 working fingerprints and the 12 S6 batch ids and row hashes; no `afldb-i274-*` session, no other session, none idle in transaction. Nothing was cleaned up manually. The copy is retained (see §26.5).

### 26.3 R2: the whole `settle-afltables.test.ts`, unchanged worktree, once (11:27:58, 325.07 s)

`node node_modules/vitest/vitest.mjs run tests/integration/settle-afltables.test.ts --reporter=verbose`, started only after R1's census was read. Log: `r2-vitest-settle-afltables-full.log`.

**Result: exit 1; `1 failed | 78 passed | 1 skipped | 1 todo (81)`. One UNEXPECTED failure, so per the stop rule nothing further was run (no baseline export, no other suite).**

- **The failure:** `AFLDB-ISSUE-099 settle — the transaction against PostgreSQL > obligation O1 > extracts the real statement set, so the proof below is not vacuous`, `settle-afltables.test.ts:1652`: `AssertionError: expected '— a recovered' to match /^(SELECT|INSERT|UPDATE|WITH)\b/i`. It reads three source files and extracts "template bodies" with the regex `\b(?:tx|sql)(?:<[\s\S]*?>)?\`([^\`]*)\``; it touches no database.
- **Analysis (read-only; NOT a baseline run of the suite).** The regex also matches prose: `settle-afltables.ts:1918` is a comment, `` `scope`, never `tx` — a recovered `40P01` raised on `tx` would still be `` (continued on the next line), where `` tx` `` is read as a template opener and `` — a recovered `` as its body. That comment is in `HEAD` and this patch's `settle-afltables.ts` hunk is a different comment (line ~2986). A local text-only replica of the extractor (`o1_extract_check.mjs`, no vitest, no database) gives **identical results for `HEAD` and the working tree: 33 statements each, and the same two non-statement bodies, `— a recovered` and `would still be // re-thrown by`.** So the failure does not depend on this patch; it is a prose-versus-extractor defect in the test (or the comment). This is inference from text. It was not confirmed by running the suite on the base export, which the stop rule forbids without authorisation. Whether it was already failing when the comment was written is not known. It is a candidate tracked test-tooling issue (§5); **no issue was created or numbered**: owner's call. **[Annotated 2026-10-12, §27.1: the replica was a hand copy and its output was not retained; a targeted comparison with the extractor sliced from the real test file gives the same result, and the defect is now registered as AFLDB-ISSUE-315. The text above is kept as written.]**
- **Correction of §25.4's arithmetic (no acceptance target is used).** §25.4 subtracted the 11 vacuous scenarios and the 1 skip from 76, the count that EXCLUDES the four ISSUE-274 cases, and so said "about 64". The file has 80 tests plus 1 `todo`; 80 − 11 − 1 = **68 exercised**. Observed: **67 passed and 1 failed (68 exercised), 11 NOT EXERCISED, 1 skipped, 1 todo** (67 + 1 + 11 + 1 = 80). The original sentence is annotated in place and kept.

**Actual per-test coverage** (from the verbose log; `coverage.py`):

| Block | Passed | Other | Coverage |
|---|---|---|---|
| ISSUE-099 settle (top level) | 11 | 1 skipped | restricted `afldb_import` parity case SKIPPED (`AFLDB_TEST_IMPORT_DATABASE_URL` unset); exercised |
| ISSUE-099 `data_issues` disagreement lifecycle | 5 | | exercised |
| ISSUE-099 obligation O1 | 2 | **1 failed** (above) | exercised; the passing "sends no DELETE and no TRUNCATE" uses the same extracted list, so its strength is the extractor's (it passes with the two prose bodies in the list) |
| ISSUE-122 §8 manual authority | 5 | | exercised |
| ISSUE-122 S5 canonical applier | 14 | | exercised |
| S6 operational path end to end | 6 | | exercised (committed `--apply` batches created and removed by recorded ids) |
| ISSUE-131 upstream rekey | 16 | | exercised; the changed retired-candidate lock, unlocked late search and refusal sit on this path |
| ISSUE-131 §8 repair-match-rekeys | 4 | | exercised |
| **Durable Match Sheet authority (ISSUE-257 F-S9-03)** | **11 (reported passed)** | | **NOT EXERCISED**: State A, every scenario returns at the `storable` guard (0 ms each). Not coverage. This includes the durable rekey cases and R-01 |
| ISSUE-274 matches-only | 4 | 1 todo (ISSUE-275) | exercised; the two lock cases passed again, 7,640 ms and 7,141 ms (a repeat, not new evidence about repeatability beyond two runs) |

- **Post-run census** (`census-2-after-r2.json`): **identical to the baseline** in selectors, totals, audits, schema state, all 19 working fingerprints, and the **same 12 `issue122-s6-cli` batch ids with identical row hashes**; no `afldb-i274-*` session, no other session, none idle in transaction. The S6 block's own committed batches and every other fixture were therefore removed, and no new fixture residue remains. No manual clean-up was done.

### 26.4 What this does and does not establish, and the stop state

Establishes (for `afldb_test`, State A, one run each): the two ISSUE-274 lock cases discriminate the lock block; 67 of the 68 exercised AFL Tables settle, rekey, repair and S6 tests pass with the patch, and the one failure is a text-extraction test that behaves identically on `HEAD`'s source text.

Does **not** establish: any State-B or durable-authority behaviour (11 + the precondition-dependent cases NOT EXERCISED); the AFL API caller (R3 not run, and its recompute hooks rewrite season-2026 derived rows, which a before/after hash would detect but not undo); the optional suites; ISSUE-265 Phase B; the overlapping-settle lock cycle (§18.2); the late-candidate case on PostgreSQL; the `afldb_import` lock (test prepared below, not run); that the O1 failure is pre-existing in the sense of a suite run on the base tree; DEV or PROD. R1 is a mutation of the lock only; it does not run the complete original implementation.

Stop conditions in force and observed: unexpected failure ⇒ stopped after R2 (the only one that fired); no timeout, deadlock, `UnresolvedWorkError`, census difference, residue, or leftover session occurred.

### 26.5 Retained artefacts and disclosures

Retained: `D:\tmp\issue274\run-20261012-r1r2\` (logs, JSON censuses, scripts, hashes, tunnel PID), and the isolated copy `D:\tmp\issue274\revert-lock-20261012\` (contains no credential; its `node_modules` is a junction, so remove the copy with `cmd /c rmdir` on the junction first, never `Remove-Item -Recurse`). Disclosed local, DB-free actions beyond the two authorised runs: the `query-intent` smoke test in the copy (§26.2), the text-only O1 replica, and the coverage/census-comparison scripts. **Typecheck and ESLint were not run on the new test file below** (not authorised for this task); exact commands are in §26.6.

### 26.6 D-274-2: a direct `afldb_import` lock test, PREPARED and NOT executed

New file `tests/integration/import-role-match-lock.test.ts` (sha256 first 16 `20942a9622969da0`, blob `a345c41c…`). Label: **runtime lock-permission evidence only; not restricted-role applier acceptance.**

- **Selection and failure.** It runs only when `AFLDB_ISSUE274_IMPORT_LOCK=1`; it then requires `AFLDB_ISSUE274_IMPORT_LOCK_DSN` (a connection as `afldb_import` to `afldb_test`) and **fails with a sentence** if it is missing, names another role, another database or another server, with no fallback to the owner DSN, `AFLDB_TEST_IMPORT_DATABASE_URL` or any other role. Not selected, the describe is skipped (a skip is not a pass). The dedicated variable keeps `AFLDB_TEST_IMPORT_DATABASE_URL` unset, so no other restricted-role suite or case is enabled (the file does not use the parity harness).
- **Checks, in order.** (1) The server reports `afldb_test` / `afldb_owner` for the owner connection and `afldb_test`, `current_user` = `session_user` = `afldb_import`, not superuser, for the role connection. (2) Refuses a row already on the fixture key. (3) The owner creates the fixture. (4) The role, in a transaction, selects **exactly one existing test-owned row** `FOR NO KEY UPDATE` (its id must equal the fixture's), re-checks its identity inside the transaction, and while the lock is held the owner's `SELECT ... FOR UPDATE NOWAIT` on that row must be refused with `55P03` (so the row lock is real, and the probe cannot wait). (5) The transaction is rolled back on purpose; the same `NOWAIT` statement then succeeds (released). An absent-key query is not used.
- **Bounds.** Connect timeout 10 s; statement timeout 15 s, lock timeout 5 s and idle-in-transaction timeout 30 s on both connections; the competing probe uses `NOWAIT`; case timeout 90 s; the "session gone" poll is bounded at 4 s.
- **Writes (owner connection only).** One `seasons` row 2093 if absent (removed only if this test created it and no match then references the season); one `matches` row `2093|issue122-274-importlock-1` between two existing clubs (removed by its own id and key). `afldb_import` writes nothing logically (the tuple lock consumes a transaction id and may dirty a heap page). **Cleanup:** only after the `afldb_import` session is confirmed gone by `application_name`; if it cannot be confirmed, nothing is removed and the failure names the key and session tag. The key sits under the ISSUE-122 prefix, so the existing census selectors (`122 matches (key)`, season 2093, `122 club_seasons`) see any residue. **Retained rows expected: none.**
- **Proposed run (not authorised yet).** Same tunnel and envelope as §26.1; child environment only: `AFLDB_TEST_DATABASE_URL` (owner), `AFLDB_ISSUE274_IMPORT_LOCK=1`, `AFLDB_ISSUE274_IMPORT_LOCK_DSN` (built in process from the main `.env`'s `AFLDB_IMPORT_DATABASE_URL`, host/port/database swapped; that variable has NOT been read or verified yet; the test itself checks the role); census before and after; `node node_modules/vitest/vitest.mjs run tests/integration/import-role-match-lock.test.ts --reporter=verbose`; acceptance `1 passed` (a skip is a failure of the procedure).
- **Unverified (nothing was run):** the fixture `INSERT` copies the AFL API suite's known-good keep-alive row, but with season 2093, round 9002 and a 2093 date; it has not been executed. Types and lint are unchecked **[Annotated 2026-10-12: both were run on a revised file and are clean; see §27.3, which also lists the changes]**. Commands for the operator: `npx tsc --noEmit -p tsconfig.json` and `npx eslint tests/integration/import-role-match-lock.test.ts`. No DB-free source pin was added to `tests/behind-holder.test.ts`.

Files changed by this step: this runbook (§26, and an in-place annotation of §25.4), `issues.md`, `IssuesIndex.md`, and the new `tests/integration/import-role-match-lock.test.ts`. Outside the repository: the run directory, the isolated copy, and regenerated patch r6 (hash in the hand-off). No production source, existing test or probe changed; no database state changed (censuses identical).

## 27. 2026-10-12: O1 extractor comparison, ISSUE-315 registered, import-role test reviewed (local, DB-free; no tunnel, credential read, database or host contact)

Authorised for this step: a DB-free O1 comparison, `npm run typecheck`, ESLint on the new test, and reading `HEAD` bytes with read-only Git. Not done: any database, tunnel, `.env` or `AFLDB_IMPORT_DATABASE_URL` read, vitest or integration run, migration, grant, commit, push or deployment. R3 is still pending.

### 27.1 O1: targeted extractor comparison (NOT a baseline suite run)

- **Why existing evidence was not enough.** §26.3's replica (`o1_extract_check.mjs`) was a hand-typed copy of the extractor, and its output was never saved to a file (the numbers survive only in §26.3's prose). I compared it with the real code line by line: the regex, the `${…}` and whitespace replacements and the `SELECT|INSERT|UPDATE|WITH` shape regex are identical, so it was faithful in text; it did not check the other assertions of the test (count and positive controls).
- **Method.** `D:\tmp\issue274\o1-compare-20261012\o1_targeted_compare.mjs` (sha256 first 16 `0f193cade436a021`; log `o1_targeted_compare.log`, `23bfdfe87f5b0530`). It slices the `executableStatements` function (12 lines), the shape regex, the minimum count (20) and the four positive controls out of `tests/integration/settle-afltables.test.ts` **at run time** (not retyped), transpiles the function with the repository's own `typescript`, and applies the test's own assertions to the three source files it reads (`settle-afltables.ts`, `observation-store.ts`, `tools/current-season/settle-afltables.ts`), once from `git show HEAD:<path>` and once from the working tree, with raw utf8 and no newline normalisation, as the test does. No vitest, no `./guard` import, no database hook, no network. Read-only Git only (`git show`, `git diff -U0`).
- **Source bytes.** `observation-store.ts` and `tools/current-season/settle-afltables.ts` are unchanged by this patch: their LF-normalised sha256 are identical in `HEAD` and the working tree (`4ceeb8ab…`, `5ad0e63b…`); the raw hashes differ only because the working tree is CRLF and `HEAD` blobs are LF. `settle-afltables.ts`: `HEAD` `e89d598d…c385`, working tree `9163637a…0d81` (this is also the hash recorded before R2, so it is the file R2 ran), differing in exactly one `-U0` hunk at old line 2989 (+2 lines; the comment of §26.3). The O1 block of the test (extractor and assertions, `settle-afltables.test.ts:1612-1654` in the working tree) is byte-identical to `HEAD`'s (extractor slice hash equal), and none of the working tree's ten test-file hunks (`git diff -U0 --ignore-cr-at-eol`) is inside it.
- **Result (the same in `HEAD` and the working tree).** 33 statements (>= 20: passes); all four positive controls present (pass); **2 bodies fail the shape assertion: `"— a recovered"` and `"would still be // re-thrown by"`; the first is exactly the value R2 reported** (`expected '— a recovered' to match …`, `:1652`). The two statement lists are identical. The offending text is `src/lib/acquisition/settle-afltables.ts:1918-1919` in both: a `//` comment, `` `scope`, never `tx` — a recovered `40P01` raised on `tx` would still be`` / `` re-thrown by `sql.begin` …``. The extractor reads `` tx` — a recovered `` as a template opener with that prose as its body (and the next pair likewise).
- **Origin (read-only Git).** That comment was added by `ad1fd595` (ISSUE-261, 2026-10-08, an ancestor of `HEAD`), absent in its parent; the extractor was added in `9f549901` (2026-08-29) and its slice hash is identical at `ad1fd595` and `HEAD`. So by text the assertion cannot pass at any commit from `ad1fd595` to `HEAD` without a change (only those two endpoints were examined; commits in between were not). Whether the suite was ever run after `ad1fd595` is not known.
- **Conclusion.** Both versions reproduce the same defect; it does not depend on this patch and ISSUE-274 does not introduce it. This is an extractor comparison, not a suite run: it does not show how the whole file behaves on `HEAD`, and the base-export differential remains unrun (stop rule). **Registered as AFLDB-ISSUE-315 (Low, test maintenance).** Not fixed in this patch. Related weakness recorded there: the passing O1 "sends no DELETE and no TRUNCATE" test iterates the same list, so its two prose bodies are scanned too; it would also pass if the extractor missed a real statement the positive controls do not name.

### 27.2 R2 stays as recorded (not a clean pass)

R2's original result stands unedited: **exit 1, `1 failed | 78 passed | 1 skipped | 1 todo (81)`, 325.07 s.** Per test (80 tests + 1 todo): **67 exercised and passed, 1 failed (the O1 case above), 1 skipped (the restricted `afldb_import` parity case, `AFLDB_TEST_IMPORT_DATABASE_URL` unset), 11 durable Match Sheet scenarios reported passed but NOT EXERCISED (State A), 1 `todo` (ISSUE-275)**; 67 + 1 + 1 + 11 = 80. The 78 "passed" is 67 exercised + 11 not exercised. Nothing in §27 changes this, and the overall result is not a pass.

### 27.3 The prepared import-role test: checks, review, and changes since r6

**Checks run (this step, DB-free).**

| Check | Command | Result |
|---|---|---|
| Typecheck | `npm run typecheck` (`next typegen && tsc --noEmit`; `tsconfig` includes `**/*.ts`) | exit 0, no diagnostics (log `typecheck.log`); `next typegen` rewrote only generated route types |
| ESLint | `npx eslint tests/integration/import-role-match-lock.test.ts` | exit 0, no output (log `eslint-import-role.log`) |
| Whitespace | `git diff --check` (tracked files); hand check of the new file | exit 0; no trailing whitespace, consistent CRLF |

**Review findings (all fixed in this step, in the new file only).**

1. **The "session gone" confirmation could pass vacuously.** It polled `pg_stat_activity` by `application_name`. `afldb_owner` is not `afldb_import`, and PostgreSQL hides another role's `application_name` from a viewer without `pg_read_all_stats` (or superuser); the poll could then report 0 immediately, the fixture would be removed while the role session might still exist, and nothing would show it. **Now:** the role connection reports its `pg_backend_pid()`; the owner must see exactly 1 `pg_stat_activity` row for that pid **before any fixture is written** (positive control, fails with a sentence); the later confirmation polls that pid (`pid` is visible to every role). The bounded 4 s window and the 100 ms poll are unchanged. **[CORRECTION 2026-10-12, DEV-pack Revision 2: the premise of this finding was wrong and was never measured. PostgreSQL does NOT hide another role's `application_name`: in PostgreSQL 16 `pg_stat_get_activity` fills `application_name` among the values available to all callers, before the `HAS_PGSTAT_PERMISSIONS` check, and the documentation (28.2.2) says only that the existence of a session and its general properties (session user, database) are visible to everyone while many other columns (state, query text, wait events, timestamps, client address) are null for sessions the viewer may not see. So the `application_name` poll could not have "passed vacuously" for the reason given. Evidence: PostgreSQL 16 docs and `REL_16_STABLE` `pgstatfuncs.c` as read in this session; NOT measured on `afldb_test` or `afldb_dev`. What stands: the pid-based confirmation with its positive control is still sound and is kept; only its stated rationale is withdrawn. The code comment at `tests/integration/import-role-match-lock.test.ts` lines 150-151 (committed in `6f99b58d`) repeats the withdrawn premise and is deliberately NOT edited, because the deployed target stays `6f99b58d`; the §29 run evidence is unaltered. The pack explanation is `D:\tmp\issue274\dev-pack-20261012\PROCEDURE.md` §13.3.]**
2. **A misleading failure.** If a guard failed before anything was written, the test still waited and threw "fixture was NOT removed … remove the matches row". **Now:** when nothing was attempted (no INSERT sent, no season created) it closes the owner connection and rethrows the first failure as is.
3. **A lost INSERT reply left the fixture unreachable.** `fixtureId` was only known from `RETURNING`. **Now:** `insertAttempted` is set before the INSERT; cleanup deletes by `id AND match_key` when the id is known, and by `match_key` alone only when the reply was lost, a key the test proved absent immediately before inserting **[Annotated 2026-10-12: that reasoning was insufficient (another session can create the key between the check and the INSERT); superseded by §28, where every DELETE requires a per-run marker]**.
4. Cosmetic: one stray double blank line removed.

**Reviewed and found sound (no change).** The identity guards (DSN checked before any connection for role `afldb_import`, database `afldb_test`, same host:port as the owner DSN; then the SERVER's `current_database`/`current_user`/`session_user`/`rolsuper` for both connections, and again inside the transaction). The `NOWAIT` assertion: `FOR UPDATE` conflicts with the role's `FOR NO KEY UPDATE`, the competing statement is on a second connection and can never wait, and it must raise `55P03`; a success, a different SQLSTATE or an empty lock set fails; after the deliberate rollback the same statement must succeed. Rollback: `RollbackAfterProbe` thrown inside `begin`, any other error rethrown. Fixture validity against `003_matches.sql`: `margin` = |100-80|, `result` `home_win` with `winner_club_id` = home, `round_type` `home_and_away` with a round number, `is_final` false, distinct clubs; `attendance_status` `'not_collected'` is a `coverage_status` value; `seasons(year, league, status)` with `'in_progress'` is valid; `clubs.legacy_club_hist` exists (the INSERT is modelled on the AFL API suite's but has still not been executed).

**Changes since r6.** (a) `tests/integration/import-role-match-lock.test.ts` only, among source and test files: sha256 first 16 `20942a9622969da0` -> **`32d50fa8fbadc298`** (full `32d50fa8fbadc298492822a3273f342de5ce13110b5e34a465da4d2743a84bad`; blob `a345c41c…` -> `29a4c61c7887e6ce5376fd56f3a81bb878afaf5e`), 278 -> 306 lines. (b) Tracking text: this section and two in-place annotations in §26, the `AFLDB-ISSUE-274` entry, Open Issues row and `IssuesIndex.md` entry for ISSUE-274, and the new ISSUE-315 (entry, row, index, counts 51 -> 52). Unchanged since r6 (hashes equal to the pre-R2 record): `canonical-apply.ts`, `match-rekey.ts`, `settle-afltables.ts`, `tests/current-season-import.test.ts`, `tests/integration/settle-afltables.test.ts`, `tests/integration/behind-holder.ts`, `tests/behind-holder.test.ts`.

### 27.4 Exact credential, fixture and cleanup scope of the import-role test (NOT executed; `AFLDB_IMPORT_DATABASE_URL` has not been read)

- **Credentials, child process only.** `AFLDB_TEST_DATABASE_URL`: the owner connection to `afldb_test` as `afldb_owner` (used for every write, the `NOWAIT` probe and the pid/visibility checks; already used in §24/§26). `AFLDB_ISSUE274_IMPORT_LOCK_DSN`: a connection as `afldb_import` to `afldb_test` on the same host:port, to be built in process at run time from the main `.env`'s `AFLDB_IMPORT_DATABASE_URL` (host/port/database swapped; not read, not verified; the test checks the role itself). `AFLDB_ISSUE274_IMPORT_LOCK=1` selects. **No fallback** between them or to `AFLDB_TEST_IMPORT_DATABASE_URL` (which must stay unset: `./guard` would validate it and other restricted-role suites would enable). `./guard` also opens one owner `SELECT 1` connection on import, whether or not the case is selected, and throws if `AFLDB_TEST_DATABASE_URL` is unset (so "skipped when not selected" holds only with that variable set, as for every integration file).
- **What `afldb_import` does.** One transaction: two identity/`SELECT` statements and `SELECT … FOR NO KEY UPDATE` of **exactly one** `matches` row (`match_key` = the fixture key), then a deliberate rollback. No logical write (the tuple lock consumes a transaction id and may dirty a heap page). It needs `SELECT` and a column `UPDATE` privilege on `matches`; if it lacks them the test fails with `42501`, which is the evidence sought.
- **Fixture (owner connection).** `seasons` 2093 (`AFL`, `in_progress`) inserted with `ON CONFLICT (year) DO NOTHING`; `matches` `2093|issue122-274-importlock-1` (round `9002`, `home_and_away`, date `2093-08-01`, the two lowest-id clubs, 100 to 80). A row already on the match key is **refused, never adopted**. A pre-existing season 2093 is used and left alone (`createdSeason` is true only if this INSERT returned a row).
- **Cleanup (owner connection), only after the role session is confirmed gone by pid.** `DELETE FROM matches WHERE id = <created id> AND match_key = <key>` (or by key alone only if the INSERT reply was lost, §27.3 item 3); `DELETE FROM seasons WHERE year = 2093 AND NOT EXISTS (a matches row in 2093)` only if this test created the season. A foreign key from any other table to the season makes that DELETE fail and be reported, not forced. A final count must show 0 matches rows on the key (and 0 season rows if created). **If the session is not confirmed gone, nothing is removed** and the failure names the key, the season (if created), the pid and the tag. No other row, table, role, setting or grant is touched. Expected retained rows: none; a pre-existing season 2093 would remain.
- **Bounds.** Connect 10 s; statement 15 s, lock 5 s, idle-in-transaction 30 s on both connections; the competing probe is `NOWAIT`; the case 90 s; the gone-poll 4 s. A stalled network (a dead tunnel) is not bounded by the server-side timeouts: the case timeout fails the test, and any in-flight cleanup may then not complete (the census would show the key).
- **Residual risks.** Nothing here has run. A lost reply on the season INSERT is not handled (the season would remain; the census would show it) **[Annotated 2026-10-12: superseded by §28; a lost season reply is now tracked and reported as possible residue, and the cleanup bullet above (key-only delete) now requires a per-run marker in every DELETE]**. The fixture INSERT and the `afldb_import` privileges are unverified until the run. It remains runtime lock-permission evidence only, not restricted-role applier acceptance.

### 27.5 State after this step

ISSUE-274 stays **Open**. ISSUE-275 stays separate and unfixed. ISSUE-315 is registered (Low). R3, State B, the base-export differential, the overlapping-settle cycle, the late-candidate case on PostgreSQL and the import-role run are all pending; nothing has been committed, pushed or deployed; the ISSUE-265 PROD hold is unchanged. Artefacts (outside the repository): `D:\tmp\issue274\o1-compare-20261012\` (script, `o1_targeted_compare.log`, `typecheck.log`, `eslint-import-role.log`) and patch r7 (hash in the hand-off).

## 28. 2026-10-12: the import-role test's ownership proof, season uncertainty and error reporting corrected (local, DB-free; no credential read, tunnel, database or host contact)

Authorised for this step: correct the prepared test; focused DB-free checks, `npm run typecheck`, ESLint and a whitespace check. Not done: any database, tunnel, `.env` or `AFLDB_IMPORT_DATABASE_URL` read, integration run, migration, grant, commit, push or deployment; R1/R2 not repeated; R3 still pending. (The one vitest run was the new DB-free file only. `tests/setup.ts` reads a repo-root `.env` if one exists; none exists in this worktree, checked by listing the directory, not by reading anything, and the `AFLDB_*` database variables were removed from the child environment.)

### 28.1 Weaknesses found in the §27.3 version

1. **Absence before the INSERT does not prove ownership at the DELETE.** `matches.match_key` is `UNIQUE`: if another session creates the key between the absence check and this run's INSERT, the INSERT fails (23505) with no id, and the lost-reply fallback `DELETE ... WHERE match_key = <key>` would then delete the other session's row.
2. **A lost season INSERT reply entered the "nothing was written" branch.** `insertAttempted` was set only after the season INSERT returned, so a throw there left both flags false; the test rethrew the first failure and never mentioned that `seasons` 2093 may exist.
3. **Cleanup problems were discarded.** `if (failure) throw failure` came before `if (cleanupProblem) throw ...`, and the owner connection was closed with `.catch(() => {})`, so a close failure was invisible.

### 28.2 Changes (the integration file, one new helper module, one new DB-free test)

- **Marker.** Each run writes `ISSUE-274 import-role lock fixture <tag>` (`tag` = pid plus random, unique per run) into `notes` of the fixture `matches` row and of the season row it inserts (`notes` is an existing nullable text column on both; nothing else reads it here). **Every DELETE requires `notes = marker`:** by `id AND match_key AND notes`, by `match_key AND notes` when the reply was lost, and `seasons` by `year AND notes AND NOT EXISTS (a matches row in the year)`. A row on the key without the marker, including one with `NULL` notes, is never matched. A season that already existed is left alone by `ON CONFLICT DO NOTHING`, so it never carries the marker and is never matched.
- **Verification after removal** (owner connection): counts of `matches` on the key that carry the marker, that do not, and of `seasons` that carry it. A foreign row is **preserved and reported**; a marked row that remains, or a created season that remains, is reported as residue.
- **Season INSERT is a four-state value** (`not-sent`, `unconfirmed`, `created`, `pre-existing`), `unconfirmed` being set BEFORE the statement is sent. A throw leaves it `unconfirmed`: the run reports **possible season residue**, adds whether a marked season was found at the check (or that the check failed), and **does not remove the season**. A server error on that INSERT is treated the same way (deliberately conservative; the census settles it). "Nothing was written" is claimed only for `not-sent`. `matchInsertSent` is likewise set before the matches INSERT.
- **Reporting.** The closing sequence collects every problem (closing the role connection, confirming the session gone, each removal, the verification, closing the owner connection, the not-confirmed-gone refusal) and then throws: the primary failure first, `(also: ...)` the problems, the original as `cause`; only problems if there was no failure; the original unchanged if there were no problems.
- **Structure.** The closing sequence moved to the pure `tests/integration/import-role-lock-fixture.ts` (162 lines), because the integration file cannot be imported without a database (`./guard`); the test supplies the SQL operations. Behaviour kept: nothing is removed unless the role's pid is confirmed gone by the server, with the 4 s poll window and 100 ms interval unchanged.
- **Unchanged (lock proof and identity assertions).** Steps 1, 3 and 4 (server identities for both connections, the pid visibility control, exactly one locked test-owned row, the `FOR UPDATE NOWAIT` refusal `55P03` while the role holds the lock, success after the rollback) and the DSN guards are byte-identical apart from two mechanical renames: `rolePid` is `state.rolePid` (the visibility query uses `pidRow.pid`), and `fixtureId` is a `const` declared at its INSERT. The new DB-free test pins the assertions that matter from source.

### 28.3 DB-free regression checks

New `tests/import-role-lock-fixture.test.ts` (13 tests; a new file because no existing suite covers this helper and the integration file cannot be imported DB-free), fakes over an in-memory table that applies the same ownership predicate as the SQL, plus source pins that every INSERT writes the marker, all three DELETEs require it, the state flags are set before the statements, and the old shortcut and the swallowing `.catch` are gone:

| Required check | Test |
|---|---|
| another session wins the match-key race: its row survives | `another session wins the match-key race ...` (their row unchanged; the cause and the preservation both in the message; the season is kept because a matches row references it) and `a foreign row is preserved even when this run also lost its own id` |
| a lost season INSERT reply: uncertainty reported | `a lost season INSERT reply is reported as possible residue ...` (no season or match DELETE issued) and the variant where the state cannot be checked and there is no primary failure |
| primary failure plus cleanup failure: both visible | `the primary failure and a cleanup failure are both visible ...`, `connection-close failures are reported ...`, and the not-confirmed-gone refusal |

Mutation check (temporary, helper restored afterwards, `cmp` identical): disabling the unconfirmed-season report fails 2 tests; letting the primary failure replace the problems fails 5; disabling the foreign-row report fails 2.

| Check | Command | Result |
|---|---|---|
| Focused | `node node_modules/vitest/vitest.mjs run tests/import-role-lock-fixture.test.ts --reporter=verbose` | `1 passed` file, `13 passed (13)` |
| Typecheck | `npm run typecheck` | exit 0 (`next typegen` regenerated route types only) |
| ESLint | `npx eslint` on the three files | exit 0, no output |
| Whitespace | `git diff --check`; a byte check of the three untracked files | exit 0; no trailing whitespace, no tabs, no LF-only line, all CRLF |

Hashes (sha256 first 16 / git blob): `tests/integration/import-role-match-lock.test.ts` `32d50fa8fbadc298` -> **`16dc8c190edce1fe`** / `c78abbf4ddcf19c335e409bee153985959d67b11` (306 -> 295 lines); new `tests/integration/import-role-lock-fixture.ts` `86bb08562841e2aa` / `df41d989fa6ebdebd4699107f9842cec37ca988c`; new `tests/import-role-lock-fixture.test.ts` `844b900daf88517a` / `b4589ba972488d58997154feeada2d9e88c5cf39`. Production source, the other tests, the probes and `tests/behind-holder.test.ts` are unchanged since §27.

### 28.4 What this does not show

Nothing here ran against PostgreSQL. The new SQL (the `notes` columns in both INSERTs, the three marked DELETEs and the observation query) is unexecuted; the DB-free fakes apply the predicate but cannot prove the SQL, which the source pins check only textually. The §27.4 credential, fixture and bounds statements stand with these changes: the same two connections, the same rows (now also marked in `notes`), the same expected retained rows (none; a pre-existing season 2093 would remain). The test remains runtime lock-permission evidence only, not restricted-role applier acceptance, and its run is not yet authorised.

### 28.5 State after this step

ISSUE-274 stays **Open**; ISSUE-275 separate and unfixed; ISSUE-315 unchanged (Low). R3, State B, the base-export differential, the overlapping-settle cycle, the late-candidate case on PostgreSQL and the import-role run are all pending. Nothing committed, pushed or deployed; the ISSUE-265 PROD hold is unchanged. Next free ID remains 316.

## 29. 2026-10-12: the import-role lock test (D-274-2) run ONCE against `afldb_test`: PASSED (owner-authorised, solo)

Authorised for this step: ONE execution of the reviewed R8 `tests/integration/import-role-match-lock.test.ts` against `afldb_test`, as runtime lock-permission evidence for D-274-2 only (not restricted-role applier acceptance), under the pre-run checks below; reading only `AFLDB_IMPORT_DATABASE_URL` from main's `.env` in process; the temporary `streamanator` tunnel. Not done: R1/R2 repeated, R3, any other suite, a rerun, a grant, a migration, a schema change, DEV/PROD contact, deployment, commit, merge or push.

### 29.1 Provenance (before any write)

- Patch r8 `D:\tmp\issue274\AFLDB-ISSUE-274-matches-only-r8.patch`: sha256 `9625FC864A7C864D…ADC8` (equal to the recorded value). `git hash-object` of all 14 files it touches equalled the post-image blob ids in its `index` lines (all 14 True: 10 source/test files and the four tracking documents at that moment; `AFLDB-ISSUE-274.md`, `issues.md` and `IssuesIndex.md` differ now only by this record). The test, its fixture helper and `canonical-apply.ts` were hashed again immediately before the run: `c78abbf4…`, `df41d989…`, `458174b5…` (unchanged). Record: `fingerprint-pre.json`.
- MO-1 unchanged: probe sha256 `7C6C1911…9735` (equal to the recorded value), run through the tunnel with the owner DSN only: exit 0, "MATCHES-ONLY PROBE OK (MO-1)" (`mo1.log`). It is not a pass of the original migration-110 gate.

### 29.2 Credentials and connection handling

- Tunnel: `ssh -N -L 127.0.0.1:55432:127.0.0.1:5432` to the `streamanator` alias (the DEV host that holds `afldb_test`; not `afldb` = PROD), `BatchMode=yes`, `ExitOnForwardFailure=yes`, existing key authentication; no listener on 55432 and no `ssh` process beforehand; created PID 26384.
- Owner DSN: from main's `.env` `AFLDB_OWNER_DATABASE_URL`, as in §24/§26 (role `afldb_owner` checked, no query options allowed). Import DSN: from main's `.env` **`AFLDB_IMPORT_DATABASE_URL` only**, read by the in-process helper `lib-dsn.mjs` (exactly one line; role `afldb_import` checked; original host:port required to equal the owner DSN's; query options limited to an allowlist of `sslmode`, anything else refused; the option **names** found were: none). Host, port and database were rewritten to `127.0.0.1:55432` / `afldb_test`. No fallback credential, no copied `.env`, no credential file, no DSN printed (both the logs and the JSON outputs were scanned for `postgres://`: none; the run helper masks the DSNs and password).
- The test child received only `AFLDB_TEST_DATABASE_URL` (owner), `AFLDB_ISSUE274_IMPORT_LOCK=1` and `AFLDB_ISSUE274_IMPORT_LOCK_DSN`; the helper drops every `AFLDB_*`, `*DATABASE_URL` and `PG*` variable of its own environment first, so `AFLDB_TEST_IMPORT_DATABASE_URL` was unset (the run log states it). The interactive shell held none of these variables before or after.

### 29.3 Identity and catalogue (read-only sessions, `preflight.json`)

- Both connections report `current_database()` = `afldb_test`; owner connection `current_user`/`session_user` = `afldb_owner`, role connection = `afldb_import`, neither a superuser; **same server**: same `inet_server_port` (5432 behind the tunnel), same `pg_postmaster_start_time` (2026-10-11 03:01:11.59 +11), same `pg_database` oid (45428), PostgreSQL 16.15; distinct backend pids; not in recovery.
- `public.matches.notes` and `public.seasons.notes` are ordinary-table columns of type `text`, nullable, no default, not generated, not identity; both tables are owned by `afldb_owner`, which holds INSERT/UPDATE on `notes` and DELETE; no user trigger and no row security on either table. Every other column the reviewed INSERTs name exists with a compatible type (`matches`: `match_key`, `season smallint`, `round_code`, `round_type`, `round_number`, `is_final`, `match_date`, `venue_raw`, club ids, scores `smallint`, `result match_result`, `winner_club_id`, `margin`, `attendance_status coverage_status`; `seasons`: `year smallint`, `league`, `status season_status` with the label `in_progress`), and 24 clubs have `legacy_club_hist`. **No problem was found, so no stop condition applied.**
- Observation only: `afldb_import` holds table-level `SELECT` and `UPDATE` on `matches` (and on `seasons`) in `afldb_test`; the lock query requires `SELECT` privilege and `UPDATE` privilege on at least one column of the table. Grants on DEV and PROD were not examined.

### 29.4 Baseline census (`census-0-baseline.json`, 2026-10-12 about 12:50 AEDT, read-only session)

Fixture key `2093|issue122-274-importlock-1`: 0 rows; `2093|issue122-274-%`: 0; matches or seasons carrying the fixture marker prefix: 0 and 0; `seasons` year 2093: absent; `matches` in season 2093: 0; **no other session on `afldb_test`**, no `afldb_import` session anywhere, no `afldb-i274-*` application name, none idle in transaction. Schema state: migrations count 109, the `data_overrides` check hash `b9632471…`, columns/indexes hashes `f080127a…`/`0bd09131…`, and (new in this census) hashes of the `seasons` columns (`02acedd6…`), the `seasons` and `matches` constraints (`f8a86a60…`, `173e9ad8…`) and the `afldb_import`/`afldb_owner` public grants (`cd8c4e69…`). The 12 `issue122-s6-cli` batches: ids 66, 67, 68, 325, 326, 327, 543, 544, 545, 639, 640, 641, with their `md5(row)` hashes recorded. Every fingerprint, total and S6 hash also equals the §26 post-R2 census, so nothing on `afldb_test` changed between R2 and this run.

### 29.5 The run (once)

`AFLDB_ISSUE274_IMPORT_LOCK=1` and `AFLDB_ISSUE274_IMPORT_LOCK_DSN` in the child environment only, from the worktree root: `node node_modules/vitest/vitest.mjs run tests/integration/import-role-match-lock.test.ts --reporter=verbose`. Result (`vitest-importlock.log`, 824 bytes, sha256 `59F7B37A…`): **exit 0; `Test Files 1 passed (1)`, `Tests 1 passed (1)`; no skipped test**; the case took 1,844 ms (run 2.31 s, 01:50:59.9 to 01:51:02.6 UTC). The verbose reporter prints the test name and the pass; the observed values (ids, SQLSTATE) are asserted inside the test, not printed. It was run once and not repeated.

### 29.6 Post-run census (`census-1-after.json`) and comparison

`compare_census.py` baseline vs after: **CENSUS IDENTICAL**: every cleanup selector, the `seasons` rows, row totals, audit-table counts (`auth_audit_log` 203, unchanged), schema hashes (including the new ones), all id-set fingerprints, the 12 S6 batches (same ids and the same row hashes), the `afldb_import` and `afldb_owner` grants. **No fixture residue** (key rows 0, `2093|issue122-274-%` 0, marker matches 0, marker seasons 0, season 2093 absent, no match in 2093). **No test-owned sessions**: no other session on `afldb_test`, no `afldb_import` session, no `afldb-i274-*`, none idle in transaction. The fingerprints and S6 hashes also equal the post-R2 census.

### 29.7 What this shows, and what it does not

- **Shows (one run, `afldb_test` State A):** the real, non-superuser `afldb_import` role, connected through the tunnel, can run `SELECT ... FOR NO KEY UPDATE` on exactly one existing, test-owned `matches` row inside a transaction (the test asserts the locked id equals the fixture's); while it held the lock a competing owner `FOR UPDATE NOWAIT` was refused with `55P03`, so the row lock was real; after the deliberate rollback the same statement succeeded; and the closing sequence (role session confirmed gone by pid, then marker-gated DELETEs) removed both fixture rows, which the independent census confirms. That also executed, for the first time on PostgreSQL, the fixture `INSERT`s, the marker DELETEs and the observation query of the §28 version.
- **Does not show:** restricted-role applier acceptance (no applier code ran; `afldb_import` wrote nothing logically); whether the DEV or PROD `afldb_import` has the same grants (not examined); that the lock cures anything (the other ISSUE-274 cases and R1 own that); behaviour under State B (migration 110), R3, the base-export differential, the overlapping-settle cycle or the late-candidate case on PostgreSQL; the foreign-row and lost-reply paths of the closing sequence (DB-free tests only). One run is not a repeatability claim.
- **Not measured:** `matches.id` is `GENERATED BY DEFAULT AS IDENTITY`, so the fixture INSERT consumed one sequence value and the INSERT/DELETE left a dead heap tuple; the census does not read sequence values. No logical row remains.

### 29.8 Disclosures

- Credential reads: the helper read only the `AFLDB_OWNER_DATABASE_URL` and `AFLDB_IMPORT_DATABASE_URL` lines of `D:\dev\afldb\.env`, in process, to build the DSNs; no value was displayed or stored. Read-only Git (`git hash-object`, `git status`) was used for the fingerprints. One census command was first sent with a stray shell heredoc line and failed to parse before anything executed; it was re-sent without that line.
- Tunnel: PID 26384 stopped (only that PID); afterwards no process and no listener on 55432.
- Retained outside the repository: `D:\tmp\issue274\run-20261012-importlock\` (logs, JSON outputs, scripts, `tunnel.pid`; no credential in any of them). Zero-byte files `DEV`, `{})` and `owner.end({` at the repository root are artefacts of the session's read hook (their write times track my tool calls; `owner.end({` appeared at the Read of the test file); they are untracked, empty, not in any patch, and left in place with the earlier `ISSUE-274`.
- Repository files changed by this step: this runbook (§29), `issues.md` and `IssuesIndex.md` (ISSUE-274 entries). No source, test or probe changed (the 10 source/test files still equal the r8 post-image blobs). `CHANGELOG.md` is not changed: no retained behaviour changed.

### 29.9 State after this step

ISSUE-274 stays **Open**. D-274-2's runtime lock-permission evidence is obtained (one run, `afldb_test`); it is not restricted-role applier acceptance. ISSUE-275 stays separate and unfixed; ISSUE-315 unchanged (Low); next free ID 316. R3, State B, the base-export differential, the overlapping-settle cycle and the late-candidate case on PostgreSQL remain pending. Nothing committed, pushed, merged or deployed; the ISSUE-265 PROD hold is unchanged.

## 30. 2026-10-12: R3, the whole `settle-afl-api.test.ts`, run ONCE against `afldb_test`: PASSED 72/72 (owner-authorised, solo)

Authorised for this step (owner): ONE run of `tests/integration/settle-afl-api.test.ts` against `afldb_test`, including its existing `recompute2026SeasonDerivedState()` hooks, which update the season-2026 `seasons` and `club_seasons` rows (this superseded the earlier R3 hold for this run only); extended census; a stop on any unexpected failure or discrepancy with no rerun, baseline export, restore or waiver. Not done: R1/R2 or the import-role test repeated, any other suite, a migration, a grant, DEV/PROD contact, deployment, commit, merge or push. All times AEDT (UTC+11). Logs, scripts and censuses: `D:\tmp\issue274\run-20261012-r3\` (no credential in any file; the logs were scanned for `postgres://`: none).

### 30.1 Provenance (before any connection; `fingerprint-pre.json`)

- Reviewed patch R8 `D:\tmp\issue274\AFLDB-ISSUE-274-matches-only-r8.patch`: sha256 `9625FC86…ADC8` (equals the recorded value). `git hash-object` (read-only) of every file in it vs its post-image blob id: **all 10 source/test files match** (`canonical-apply.ts` `458174b5…`, `match-rekey.ts`, `settle-afltables.ts`, `current-season-import.test.ts`, `settle-afltables.test.ts`, `behind-holder.test.ts`, `behind-holder.ts`, `import-role-lock-fixture.test.ts`, `import-role-lock-fixture.ts`, `import-role-match-lock.test.ts`); `AFLDB-ISSUE-275.md` also matches; `IssuesIndex.md`, `issues.md` and `AFLDB-ISSUE-274.md` differ, as expected (documentation edited after R8).
- **Fingerprint result (corrected 2026-10-12; the original wording claimed everything the run loads was byte-identical to `HEAD`):** the listed unchanged files matched `HEAD` `416f5f27`'s Git blobs: `settle-afl-api.test.ts` (`41fca78c…`), `afl-api-fixture-ownership.ts`, `afl-api-adjudication-fixtures.ts`, `guard.ts`, `tests/setup.ts`, `vitest.config.mts`, `settle-afl-api.ts`, `settle-core.ts`, `player-derived.ts`, `match-sheet.ts`; the ten changed source/test files matched reviewed R8. **No complete dependency trace was made**, so this does not establish that every module the run loaded was fingerprinted. The R3 test file itself ran unmodified against the patched `canonical-apply.ts`.
- Probe MO-1 unchanged (sha256 `7C6C1911…9735`), run through the tunnel as `afldb_owner`: exit 0, "MATCHES-ONLY PROBE OK (MO-1)"; server identity `afldb_test` / `afldb_owner`, non-superuser, PostgreSQL 16.15 (`mo1.log`). It is not a pass of the original migration-110 gate.

### 30.2 Connection handling

Temporary tunnel `ssh -N -L 127.0.0.1:55432:127.0.0.1:5432 streamanator` (`ssh -G` confirms the alias is 10.0.40.100, not the PROD host of alias `afldb`; `BatchMode=yes`, `ExitOnForwardFailure=yes`); no listener or `ssh` process beforehand; PID 13688. Owner DSN built in process from the main checkout's `.env` `AFLDB_OWNER_DATABASE_URL` only (role `afldb_owner` checked, no query options), given to the child as `AFLDB_TEST_DATABASE_URL`; the child environment had every `AFLDB_*`, `*DATABASE_URL` and `PG*` variable of the shell dropped, so `AFLDB_TEST_IMPORT_DATABASE_URL`, `AFLDB_IMPORT_DATABASE_URL` and all import-role selectors/DSNs were unset (the shell held none). No `.env` in the worktree. Output masked and teed.

### 30.3 Extended census (`census-r3.mjs`, read-only session `i274-census-r3`, `default_transaction_read_only=on`) and the pre-clean review

The fixture selectors are parsed from the test and ownership sources, not retyped (31 case ids, 31 dates, 2 H&A dates, 9 F030 seeds, 44 exact match keys). Baseline (13:11:44) captured: 54 selectors; the 99 base tables of every non-system schema (exact count and an ordered content md5; for `player_match_stats` (685,471 rows) and `brownlow_round_votes` only count plus an md5 of the ordered ids, because of size); schema, constraint, index, trigger, function, view, enum, extension, role and every ACL fingerprint (relations, columns, schemas, default ACLs, functions, the database ACL and comment, `afldb_import` UPDATE on `matches`/`match_period_scores`); all 63 sequence values; id, tool, status and row hash of **all 729 `import_batches`**; ordered content fingerprints and a retained before-image (`image-0-baseline.json`, sha256 `48C78CF0…2ED48`) of season-2026 `seasons`, `club_seasons` and `matches`; sessions. A first baseline attempt errored in the census script (`match_period_scores` has no `id` column) before any test ran; the script was fixed and the baseline retaken. Nothing had been written.

**Pre-clean review: all 54 selectors counted 0 rows before the run**, so none of the suite's `beforeAll`/`seedBaseline` deletions could remove a pre-existing row: the root `cleanup()` (exact 44-key match list, `CD_M2026ISSUE228%` ledger/candidate/staging/spine rows, `%CD_M2026ISSUE228%` data_issues, `issue228-integration` / `issue228-enrichment-fixture` batch notes, the synthetic player and its two identities), `cleanupS6Fixtures` (anchored S6 patterns, legacy-id range, S6 tool, hash recipe, actor email), the literal-id I1/I14/I237/I18 cleanups, and the two ledger-isolation preconditions (`afl_api_identity_adjudications` = 0 rows). The baseline also showed: `matches` season 2026 = 0 rows; `seasons` 2026 = 1 row; `club_seasons` 2026 = 2 stale rows (ids 3304 and 3305: played 1, `finals_played` 1; the leftovers of an earlier run's keep-alive anchor); no other session on the database; 5 `auth_users`; 802 `afl_api` `external_identities`.

### 30.4 The run (once; started 13:12:34, ended 13:23:43)

Command, unchanged from the authorisation, from the worktree root (wrapped only by the masking logger): `node node_modules/vitest/vitest.mjs run tests/integration/settle-afl-api.test.ts --reporter=verbose`. Result (`vitest-r3.log`, 19,267 bytes, sha256 `ADAAB358…5F59`): **exit 0; `Test Files 1 passed (1)`, `Tests 72 passed (72)`, no failed, skipped or todo; duration 669.17 s.** No retry, no baseline export, no restoration. Post-run census 13:23:53 (`census-1-after.json`), compared by `compare_r3.py` (`compare-r3.txt`).

### 30.5 Result of the comparison (baseline vs after)

- **Fixture cleanup: all 54 selectors 0 after the run.** The suite's own two leftover gates (ISSUE-235 S6, I237) passed.
- **Pre-existing batches preserved:** `import_batches` 729 before and after; no id missing, none added, **no row hash changed** (including the 12 `issue122-s6-cli` batches).
- **Schema and grants unchanged:** columns, constraints, indexes, triggers, functions, views, enums, extensions, roles, relation/column/schema/default/function ACLs, database comment and ACL, `afldb_import` privileges, migration count 109: all equal.
- **Canonical `matches` unchanged:** the whole table (16,838 rows) has an identical content hash; `match_period_scores`, `canonical_applications` (0), `afl_api_identity_adjudications` (0), `external_identities`, `players`, `auth_users` and every other table's content hash are identical, with the one exception below. `player_match_stats` and `brownlow_round_votes` were compared by count and ordered ids only, not content (so `club_seasons` is the only table-content change *detected*; content changes in those two tables would not have been detected).
- **No test-owned sessions:** none on the database, none idle in transaction, no prepared transaction, no `afldb_import` session, no `afldb-i274-*`.
- **Authorised season-2026 derived rows: `seasons` 2026 byte-identical (one row, unchanged); `club_seasons` 2026 REWRITTEN.** The two stale rows were deleted and two rows inserted: before, id 3304 (club 3 Brisbane Lions; 0W 0D 1L, played 1, points for 80 / against 100, 80%, ladder rank 2, `finals_played` **1**) and id 3305 (club 13 Hawthorn; 1W, played 1, 100 / 80, 125%, rank 1, premiership points 4, `finals_played` **1**); after, id 4239 (club 3) and id 4240 (club 13) with every value identical except **`finals_played` 1 -> 0** and the surrogate id. The table content hash therefore changed (`4e124098…` -> `0dbb77cf…`) and so did the season-2026 slice (`bef7fbba…` -> `b8a5aa9e…`); row counts stayed 1,624 and 2. The database is **not unchanged**: this is the only table-content difference detected (with the count-and-ids-only limit for `player_match_stats` and `brownlow_round_votes` stated above), and it is a recompute of derived data, not a canonical change. No season-2026 match exists before or after.
- **Sequences advanced (informational; not rolled back by design):** 14 of 63 moved, e.g. `matches_id_seq` 18366 -> 18472, `club_seasons_id_seq` 4036 -> 4240, `import_batches_id_seq` 2135 -> 2240, `players_id_seq` 15617 -> 15752, `afl_api_identity_adjudications_id_seq` 180 -> 240 (the S6 cases insert and delete ledger rows; the OD-5 case restores the value only after its own rolled-back reinstatement), `player_match_stats_id_seq`, `canonical_applications`, `data_issues`, `external_identities`, `import_rejections`, `promotion_candidates`, `auth_users`, `brownlow_round_votes`, `player_height_evidence`. No logical row remains for these.

### 30.6 What was genuinely exercised (all 72 passed)

| Describe (tests) | Notes |
|---|---|
| ISSUE-228 S6 settle lifecycle (16) | real `runSettleAflApi()` writes through `applyCanonicalUnit` with the real driver: new match, rerun, contradiction, corroboration, enrichment, derived-table deltas, venue identity, rollback, batch lifecycle |
| ISSUE-255 (1), I244-F009 (2), I244-F010 (2), I244-F030 (8) | refusals, identity corrections, the plausible-fixture search (ISSUE-275's window) |
| ISSUE-235 I1 (3), I14 (1), I17 (1), S6 I2-I7 (15), I15/I16 (7), OD-5 (5) | identity/adjudication tests against real tables; OD-5 and P-M run destructive statements inside rolled-back transactions (below) |
| ISSUE-237 I237 (8) | includes the `RESET_SQL`-in-rolled-back-transaction case (P-M point 2) and ONE DB-free test (ownership overlap) |
| S6 and I237 leftover gates (2) | passed: no fixture rows left |

**NOT EXERCISED although reported passed:** the ISSUE-257 §17.8 case (1 test, 3.3 s): it `return`s at `settle-afl-api.test.ts:2877` because `playerMatchStatsAuthorityStorable()` is false in State A (migration 110 not applied), so its Match Sheet authority assertions never ran. **DB-free:** 1 (the I237/I235 ownership-overlap test). Therefore **70 of 72 tests exercised PostgreSQL**; 71 are not vacuous; no skips and no todos in this file. Destructive-looking statements that ran inside a transaction that the test always rolls back: `RESET_SQL` (P-M point 2; its own `sources` count tripwire passed) and the OD-5 delete of all `afl_api` `external_identities`; the census shows both rolled back (`external_identities`, `sources` and every table identical).

### 30.7 What this shows, and what it does not

- **Shows (one run, `afldb_test`, State A):** the AFL API caller of the patched `applyCanonicalUnit` (`settle-afl-api.ts` shares the applier) behaves as the existing 72-case suite expects, including the real driver's row counts under `requireRowUpdated` and the I244-F030 search; the suite cleans up after itself; schema, grants, canonical matches and the 729 batches are unchanged; the only table-content change detected is the authorised `club_seasons` 2026 recompute (surrogate ids replaced and `finals_played` 1 -> 0).
- **Does not show:** the new `FOR NO KEY UPDATE` branch of `lockUnitMatchRows` fired in these cases (no test here asserts a lock; whether the AFL API units' targets reach that branch was not traced); the §17.8 Match Sheet authority case or any State B behaviour; the overlapping-settle cycle or the late-candidate refusal on PostgreSQL; DEV or PROD; repeatability (one run); `player_match_stats` / `brownlow_round_votes` content equality (count and ids only). The R2 failure (ISSUE-099 O1, ISSUE-315) and its attribution are unchanged and were not repeated.
- **Retained change to disclose:** `club_seasons` season 2026 on `afldb_test` was rewritten (30.5). The suite's own hooks do this on every complete run, so it will recur; nothing was restored.

### 30.8 Disclosures

- Credential reads: the helper read only `AFLDB_OWNER_DATABASE_URL` from the main checkout's `.env`, in process; no value was displayed or stored. `AFLDB_IMPORT_DATABASE_URL` was not read.
- Read-only Git: `git hash-object`, `git rev-parse HEAD:<path>`, `git status --porcelain`, and the diff commands used for the patch below. Nothing was staged, committed, stashed or fetched.
- Tunnel PID 13688 stopped (only that PID); afterwards no `ssh` process and no listener on 55432.
- A Bash `cd` into the run directory moved the shell's primary directory for two calls; it was moved back before the run. The zero-byte root files `DEV`, `{})`, `owner.end({` and `ISSUE-274` remain untracked artefacts of the read hook, in no patch.
- Repository files changed by this step: this runbook (§30), `issues.md` and `IssuesIndex.md` (ISSUE-274 entries). No source, test, probe or earlier patch changed. `CHANGELOG.md` is not changed: no retained behaviour changed. New regenerated patch: see the hand-off.

### 30.9 State after this step

ISSUE-274 stays **Open**. R3 is now run (once) and passed 72/72 with 1 NOT EXERCISED (§17.8) and one authorised derived-row rewrite. ISSUE-275 stays separate and unfixed; ISSUE-315 unchanged (Low); next free ID 316. Pending (R3 is completed; local commit, DEV installation and acceptance remain ahead): owner review of the diff, commit, DEV deploy and acceptance; State B (migration 110), the overlapping-settle cycle, the late-candidate case on PostgreSQL and the optional base-export differential remain unrun. Nothing committed, pushed, merged or deployed; the ISSUE-265 PROD hold is unchanged.

## 31. 2026-10-12: merged to main with a readiness exception; DEV deployment and acceptance PREPARED, NOT executed (solo)

Authorised for this step: local preparation and read-only DEV prechecks. **Not authorised and not done:** deployment, restart, migration, acceptance writes, cleanup, rollback, commit, push, any PROD contact. DEV is still at `a34f0721` and **there is no DEV evidence for this change yet**; nothing below is installation or acceptance.

### 31.1 Merge record: readiness accepted WITH AN EXCEPTION, not a clean pass

Evidence: `D:\tmp\issue274\run-20261012-merge\` (`EXCEPTION-RECORD.md`, `merge-ready.log`, `preflight-merge.log`, `preflight-merge-from-worktree-MISDIRECTED.log`).

- Main was fast-forwarded `416f5f27..6f99b58d1f12362fbee40aa5d4ca18e3d7efa59c` (15 paths: 10 modified, 5 added). Re-verified 2026-10-12 about 13:58: local `main`, `origin/main`, live remote main (`git ls-remote`) and the `opus/issue-274` tip are all `6f99b58d`.
- `merge:ready` (run in the ISSUE-274 worktree), exit 1, two FAILs: `issue worktree is clean` (untracked `240`, `DEV`, `ISSUE-274`, `owner.end({`, `{})`) and `main worktree is clean` (`0)`, `60s`, `{}`, `{})`). Every other check passed (committed files match the declared scope: 15 changed, 15 expected rules, 0 unexpected; migration collision/checksum parity). **WARN: the runbook has no `afldb-merge-readiness` JSON block** (`issues/open/AFLDB-ISSUE-274.md`); it was not added and the warning is unresolved (the same warning is outstanding from ISSUE-273).
- `preflight --mode merge` was first run **from the ISSUE-274 worktree by mistake** (`preflight-merge-from-worktree-MISDIRECTED.log`, exit 1: extra FAILs "branch opus/issue-274 is valid for merge" and "merge uses the primary checkout"). Those two FAILs are an artefact of running merge mode outside the primary checkout, are **not** covered by the exception, and that log is superseded by the run in `D:\dev\afldb` (`preflight-merge.log`, exit 1), whose only FAIL is the clean-tree check naming `0)`, `60s`, `{}`, `{})`.
- **The owner-authorised exception is narrow:** clean-tree failures caused solely by those preserved, empty (0-byte), untracked, non-ignored files that collide with no committed path; nothing was deleted or moved. **It does not extend to the deploy gate.**

### 31.2 Read-only prechecks (2026-10-12 13:55 to 14:14; evidence `D:\tmp\issue274\dev-pack-20261012\precheck\`)

- **Host (`streamanator` only):** installed `a34f0721ddc7fc9e4f3e253c165c6aeaeb7abd67` (`main`, upstream `origin/main`), BUILD_ID `L22XfuX2nngl_51zwuzfH`, MainPID 786869, `active/running`, 4 of 4 workers serve that build (24/24 probes), health ok. No settle/test/build/migrate process; `afldb-settle-afl-api.service` inactive (last run 12 Oct 05:01:28 to 05:02:53, `AFLDB_SETTLE_SUCCESS`); next elapse **13 Oct 05:02:27**; the 5-minute Brownlow timer is inert; no AFL Tables timer. Host working tree: 0 tracked modifications, only known operational artefacts. DEV season 2026 is "in progress" in `data/reference/seasons.json`, so the first real use of the new lock on real data will be the 13 Oct 05:02 nightly.
- **Installed-to-target delta (`a34f0721..6f99b58d`): 16 files, 0 migrations, 0 dependency/deploy/tool files.** Runtime: `canonical-apply.ts`, `match-rekey.ts` (comment), `settle-afltables.ts` (comment). The changed modules are in the web bundle (via `src/app/admin/current-season/actions.ts`) and in the checkout-run settle jobs.
- **Database `afldb_dev` (guarded read-only sessions as `afldb_owner`):** migrations 110 files / 110 applied, none unapplied, none orphaned, checksum drift none. **State B** (the `data_overrides.entity_type` CHECK admits `player_match_stats`). No role is superuser or `BYPASSRLS`; no role/database `statement_timeout` or `lock_timeout` defaults. `afldb_import` (catalogue only, DEV): table-level S/I/U/D on `matches`, `match_period_scores`, `import_batches`, `seasons` and the five `staging.*` tables; S/I only on `canonical_applications`; on `data_overrides` S plus column-level I/U sufficient for the editor's upsert; `UPDATE` on at least one column of `matches`. Season 2093 absent; namespace `i274dev-` empty in all ten tables; one `afldb_app` session; none idle in transaction.
- **Statement check:** the 30 write statements of the acceptance/cleanup SQL were only PREPAREd in a read-only guarded session (parse and analyse; none executed) and parse against the real schema.
- **ISSUE-275 §15 census (informational), DEV only:** 0 of 136,448 `match_period_scores` rows have a source different from the parent's when both are set; 1,744 equal; 134,704 have a NULL child source with a set parent (not evidence of split ownership).
- **H-4 `preflight --mode deploy`, in the primary checkout `D:\dev\afldb` at `6f99b58d`** (temporary tunnel, child-only DSN override, closed afterwards): **BLOCKED, exit 1, one blocker: `FAIL working tree is clean` (4 untracked paths `0)`, `60s`, `{}`, `{})`), 0 warnings.** Every other check PASS, including migration parity 110/110. **Not waived** (decision D-274-DEV-1).

### 31.3 ISSUE-274 is independent of ISSUE-275

No code, schema, data or test dependency in either direction; 275 is unimplemented, 274 does not fix it (§17 of the 275 runbook), and 274's acceptance never depends on how a refused `matches` target treats its dependents. The one interaction is a design constraint on the future 275 fix: it must treat 274's new `stale_canonical_target` refusal as "withhold the dependents". ISSUE-274 can therefore be installed and accepted alone; the 275 acceptance case stays an `it.todo`.

### 31.4 Prepared procedure and scripts (outside the repository)

`D:\tmp\issue274\dev-pack-20261012\PROCEDURE.md` and its scripts: gates, the `sync-dev.ps1 -Issue107Gate` deployment, installation checks I-1..I-5, a behavioural acceptance driver (`acc\accept.ts` plus the byte-identical reviewed `behind-holder.ts`), rollback to `a34f0721`, the first-nightly observation, and a `MANIFEST.sha256` that the launcher verifies before every phase. The acceptance runs the REAL `runSettleAfltables` as `afldb_import` against isolated fixtures in season 2093 under the namespace `i274dev-<token>-`, with an emulated Data Editor holder (same protocol as `saveEdit`), observes the settle parked on `FOR NO KEY UPDATE`, asserts the editor's value and override survive and no update ledger row is written, repeats it for a match deleted during the wait, takes read-only censuses of every base table before and after, and removes the namespace in one owner transaction. An optional pre-fix differential (`--expect defect`) runs the same driver on the installed `a34f0721` before the deployment.

### 31.5 Local checks of the driver (no database, no network)

`tsc` against the worktree modules: exit 0. DB-free `--phase selftest`: 30 checks, SELFTEST PASS (loads the real settle modules from outside the repository, validates the fixture bundles through the real `validateSettleBundle`, DSN/argument/selector/compare rules). `bash -n` on every script: clean. These show the driver's pure parts only; **none of it has run against a database.**

### 31.6 What is not done, and the evidence limits to carry

Not exercised by the prepared acceptance: State B durable Match Sheet authority (no player records in the fixtures); overlapping AFL Tables and AFL API settles and the lock-order/deadlock claims of §18.2-§18.3; the late retired-candidate refusal and the rekey `FOR UPDATE ORDER BY id` path on PostgreSQL; the real web Data Editor (`saveEdit`, `applyMatchEdit`, the recompute, the `data_edits` audit); `40P01`/`55P03` behaviour; repeatability. `afldb_test` evidence does not transfer to DEV permissions (the pack measures DEV directly with a functional probe), and nothing transfers to PROD. The pre-fix defect shape is derived from §5 and §17.4 and has not been observed on PostgreSQL.

### 31.7 Decisions requested (details in PROCEDURE.md §4)

D-274-DEV-1 the deploy gate (relocate the four files, or a scoped exception; recommended: the scoped exception); D-274-DEV-2 the acting `auth_users` id for the override attribution (recommended 4); D-274-DEV-3 fixture disposition (recommended: remove, because fixture season 2093 would become `max(year)` on the home page, overview, db-health and the admin fixture/season-list pages); D-274-DEV-4 the optional pre-fix differential (recommended); D-274-DEV-5 the write authorisations (upload of three files to `/home/arm/i274-acc/`, the pre-fix run, the deployment and its one restart, the post-deploy run and cleanup); D-274-DEV-6 the acceptance scope and whether to wait for the first real nightly.

### 31.8 Disclosures

- DEV host contact (`streamanator` only; `ssh` alias for `arm@10.0.40.100`): bash scripts delivered over stdin (nothing written to the host); a `git ls-remote` on the host checkout (writes no ref); a `sudo -n true` test (no effect); read-only `psql` sessions as `afldb_owner` named `i274acc-precheck` and `i274acc-prepare-check` (`default_transaction_read_only=on`, guard first; PREPARE only, nothing executed). The owner DSN line was read in process on the host and by the H-4 child on the workstation; no value was printed or stored. The H-4 tunnel (PID 6472) was closed; no listener remains on 55432.
- `D:\dev\afldb` was used read-only (status, preflight); its four preserved files were not touched. No Git command that writes (fetch, add, commit, merge, push, checkout) was run.
- Repository files changed by this step: this runbook (§0 note and §31), `issues.md` and `IssuesIndex.md` (ISSUE-274 entries). `CHANGELOG.md` is not changed: no retained behaviour changed. At the time of that step these edits were UNCOMMITTED in this worktree by design (committed later, see §32.12); main's tree is left clean-but-for-the-four-files so the deploy gate is judged on the state H-4 saw. Zero-byte root files `240`, `DEV`, `ISSUE-274`, `owner.end({`, `{})` remain untracked artefacts.
- Outside the repository: `D:\tmp\issue274\dev-pack-20261012\` (the pack and its evidence).

### 31.9 State after this step

ISSUE-274 stays **Open**: merged, **not installed, not accepted on DEV**. ISSUE-275 separate and unfixed; ISSUE-315 unchanged (Low); next free ID 316. The ISSUE-265 PROD hold is unchanged. Nothing deployed, restarted, migrated, cleaned up, rolled back, committed or pushed by this step.

## 32. 2026-10-12: DEV installation and behavioural acceptance PASSED; the first cleanup FAILED and rolled back; cleanup revision 1 SUCCEEDED; S-1 compare exit 5 (one review item)

Target `streamanator` / `afldb_dev` only; no PROD contact. Evidence root `D:\tmp\issue274\dev-pack-20261012\run-20261012-1556\` (run token `202610121557-718d2e`); revision files in `...\dev-pack-20261012\cleanup-rev1\`. Times are AEDT. The subsections below are kept separate on purpose: 32.1 the deployment, 32.2 the acceptance run, 32.3 the original cleanup failure, 32.4 the FK investigation, 32.5 the authorised correction (cleanup revision 1), 32.6 the cleanup that succeeded, 32.7 the S-1 comparison, 32.8 the health check, 32.9 to 32.11 the limits, disclosures and state, and 32.12 the owner's acceptance and documentation corrections.

### 32.1 Authorisation, deployment and installation checks (D-274-DEV-1..6 approved)

- Gates 1-3 passed (`prepare-check` 34 statements). H-4 `preflight --mode deploy` exited 1 with exactly the clean-tree FAIL (the four preserved untracked files of `D:\dev\afldb`), accepted under the owner's scoped exception D-274-DEV-1 (raw output kept in `pre\h4\`); every other check PASS.
- `sync-dev.ps1 -Issue107Gate` exit 0 deployed `6f99b58d1f12362fbee40aa5d4ca18e3d7efa59c`: BUILD_ID `kKfU7VKifbsWyPAAurnUU` (was `L22XfuX2nngl_51zwuzfH`), MainPID 786869 -> 1873114, migrations "110 already applied, Nothing to apply" (`deploy\sync-dev.log`).
- `i-checks.sh` exit 0: I-1 revision PASS, I-2 build differs from the pre-deployment one PASS, I-3 `active/running`, I-4 24 of 24 requests HTTP 200 on the on-disk build, all 4 workers answered (`post\i-checks.txt`).

### 32.2 S-0 and the behavioural acceptance (ONE run, exit 0)

- DB-free selftest 76 checks passed; the gate shakedown passed on the real `systemctl`. **S-0** (15:58:15): 99 tables, 1,676,512 rows, 63 sequences, file sha256 `2c7d5f4ce37bcfd7ffc07704605b50c8856988fe66be7ca527eb57e4a5c5538b` (`acc\census-S0.json`); `public.club_seasons` 1,640 rows, content md5 `153174c325a69ba272ea1b173114d9f8`.
- The real `runSettleAfltables` as `afldb_import` against fixtures in season 2093 under `i274dev-202610121557-718d2e-` (`acc\run.txt`, exit 0): **edit** fixture (match id 17282): the settle blocked on `SELECT id::int AS id FROM matches WHERE match_key = $1 FOR NO KEY UPDATE`, the editor's `home_score` 112 survived, the override stayed active, `rowsInserted=0 rowsUpdated=0 applicationsLogged=0 applyRefusals=1 applyFailures=0`, ledger `insert` only: **VERDICT FIXED**. **Delete** fixture (match id 17283): same blocked statement, the match was gone afterwards, same counters: **VERDICT FIXED**.
- Limits (unchanged from §31.6): synthetic fixtures and an emulated Data Editor holder, not the real web editor; State B durable Match Sheet cases (the DEV run itself was in State B), overlapping settles, the late retired candidate and `40P01`/`55P03` behaviour were not exercised; one run, no repeatability; nothing transfers to PROD.

### 32.3 The ORIGINAL cleanup FAILED (exit 2, rolled back; `acc\cleanup.txt`)

- 15:59:10, `accept-wrapper.sh cleanup <token> confirm`: gates PASS; selected `canonical_applications=4, staging.afltables_player_match=0, staging.afltables_match=2, promotion_candidates=2, import_rejections=0, data_issues=0, data_overrides(matches)=1, matches=1, staging.source_record_versions=4, staging.source_records=2, staging.source_payloads=4, import_batches=4`, `match_period_scores` cascade 4, season 2093 one marked row. The single transaction aborted with `update or delete on table "source_record_versions" violates foreign key constraint "source_records_source_id_family_external_record_id_current_fkey" on table "source_records"` and **rolled back everything**.
- Cause: a defect in the acceptance driver's `cleanupSelectors()` (`staging.source_record_versions` deleted before `staging.source_records`, which references it). The driver's cleanup path had never run on PostgreSQL (PREPARE only parses). A dry run afterwards (`acc\cleanup-dry-after-failed-confirm.txt`) showed identical counts: nothing had been deleted. The fixtures stayed on DEV.

### 32.4 FK investigation (three read-only guarded sessions on `afldb_dev`, 16:08-16:12; no write)

Logs `acc\fk-catalogue-3.txt`, `acc\fk-footprint.txt`, `acc\season2093-residue.txt`. The failing FK is `source_records(source_id, family, external_record_id, current_version_seq) -> source_record_versions`, NO ACTION, not deferrable, validated, with no back-reference and no cycle among the 14 cleanup tables. Swapping the two staging selectors alone fixed the original order (1 violation of 21 FK edges -> 0). Cascades were confined to the footprint (`match_period_scores` 4; `match_coaches`, `import_rejections`, the SET NULL `brownlow_round_votes` and the RESTRICT `brownlow_vote_entry_state` 0; no delete triggers, rules or RLS; the `promotion_decisions` cycle 0/0/0). **Blocker found:** `public.club_seasons` ids **1751** and **1752** (season 2093, clubs 2 and 1, `played` 2, `source_id` 10, `import_batch_id` NULL, no marker) are **derived rows the settle recompute wrote during the acceptance** (S-0 had 1,640 rows, DEV then 1,642). `club_seasons_season_fkey` (season -> `seasons(year)`, NO ACTION, not deferrable) would have made the `seasons` DELETE fail and roll back, so the swap alone would have burned the single authorised attempt. A new DELETE target was outside the owner's authorisation, so cleanup was stopped and a proposal returned; no cleanup was attempted.

### 32.5 The ADDITIONAL derived-row deletion: owner-authorised cleanup revision 1

Owner authorisation (this session): selector order swap; deletion of exactly `club_seasons` ids 1751 and 1752, each also required to be season 2093, `import_batch_id IS NULL`, `source_id = 10` and a club of this run's fixtures; FK/cascade/trigger/rule/RLS checks extended to `club_seasons`; original season marker required; no foreign match in 2093; one transaction; originals preserved; no acceptance rerun, deployment, rollback, migration, grant, unrelated deletion or PROD contact.

- **Revision files (originals untouched, separate files):** `cleanup-rev1\accept-rev1.ts` (sha256 `13ed4a62279a780cdbc903d18316f06e635cefaeb7beb339fd48df841bfbcab3`), `accept-rev1.diff` (against `acc\accept.ts`, sha256 `a623b207c5f4d084ed167d732432582c58b609e247f340ac0e47d406e4398538`), `MANIFEST-rev1.sha256` (`f9e9c87cce7ffa2f22582198960ccd044f00bfa3b6a4124cf62d3c38ac448f1c`), `accept-wrapper-rev1.sh` (accepts only `selftest` and `cleanup` for this token, verifies the ORIGINAL and the revision manifests), `club-seasons-check.sh`, and `REV1-HASHES.sha256` (21 entries including the preserved driver, `behind-holder.ts` `63c872bd…8975`, original manifest `5bb44e06…0abd`, original wrapper, state.json, S-0, the failed-cleanup log and the FK logs). The original driver on the host is byte-identical to its manifest (verified by every wrapper run).
- **What the revision changes (cleanup phase only):** (1) `staging.source_records` before `staging.source_record_versions`; (2) the `club_seasons` delete: the two clubs are read from `matches` in this token's namespace (never from arbitrary season rows), season 2093 must hold exactly those two rows and nothing else, each must be season 2093, `import_batch_id IS NULL`, `source_id` 10 and a fixture club; the DELETE repeats every predicate and must remove exactly 2 rows; the facts are re-proved inside the transaction before the first delete; (3) the catalogue of `club_seasons` must show relkind `r`, 0 incoming FKs, 0 non-internal triggers, 0 rules, no RLS or policies, 0 inheritance links and 0 dependent materialized views, else refuse; (4) exactly one season 2093 row carrying this token's marker is now REQUIRED. The 12 selector predicates, the namespace rules and the per-selector deletion-count guards are unchanged; any mismatch throws and rolls back the single owner transaction.
- **Local checks:** `tsc` exit 0; DB-free selftest **97 checks passed (the 76 originals + 21 new)**; six scratch mutations each caught by the intended new check (order reverted; `import_batch_id` predicate removed; `source_id` predicate removed; trigger check disabled; fixture-club check disabled; ladder ids widened); `bash -n` clean on the wrapper and the precheck. Host selftest through the revision wrapper: 97 ok, exit 0 (`acc\rev1-selftest.txt`).
- **Read-only DEV precheck (`club-seasons-check.sh`):** the first log (`acc\rev1-club-seasons-check.txt`) FAILED on a mistake in my own supporting query (`pg_rules` has no `ev_type`; exit 2, nothing written) and is kept; after the one-word fix the rerun (`acc\rev1-club-seasons-check-2.txt`) exited 0: one marked season row, 1 match, 0 foreign matches; catalogue CLEAN (the only triggers are the 8 internal RI triggers for the table's own outgoing FKs); no rules, policies, dependent views, event triggers, publications or columns named like `club_season`; `afldb_owner` owns the table and can DELETE; fixture clubs {1, 2}; exactly ids 1751 and 1752 qualify (source 10 = `afltables`). Its last line "child rows holding 2093 outside club_seasons (must be 0): 5" is mislabelled: the 5 rows are the `matches` (1), `promotion_candidates` (2) and `staging.afltables_match` (2) footprint rows that the same transaction deletes first; no other table holds 2093.
- **Upload and gates:** `accept-rev1.ts` and `MANIFEST-rev1.sha256` uploaded to `/home/arm/i274-acc/` (outside the checkout; hashes verified). The revision wrapper re-ran the target, session and timer gates on each cleanup invocation (outside the 04:40-05:35 window, no settle/test/build process, Brownlow timer inert, next timer 755 min away). A read-only dry run of the revised driver (`acc\rev1-cleanup-dry.txt`, exit 0) reproduced the original counts exactly and printed the ladder facts.

### 32.6 The cleanup that succeeded (the one confirmed attempt; `acc\rev1-cleanup-confirm.txt`, exit 0)

Gates PASS, counts identical to the failed attempt, fixture clubs 1,2, catalogue clean, ids 1751 and 1752 qualify: **"transaction committed"**; after: **every selector 0; `seasons` 2093 rows 0; `club_seasons` 2093 rows 0; `club_seasons` total 1,640.** No retry was needed or made; acceptance was not rerun.

### 32.7 S-1 and the comparison against the original S-0 (exit 5, REVIEW REQUIRED; not a pass)

- **S-1** (16:27:27, original driver and wrapper, so the method matches S-0): 99 tables, 1,676,512 rows, 63 sequences, sha256 `ae8bb7f1e27fa4e4b6a27f7a225922cb2f2406eac8e7250bdc8afd0902ed4dc7` (`acc\census-S1.json`, downloaded and re-hashed).
- **Compare** (`acc\compare-S0-S1.txt`, `compare-S0-S1.json`): all 99 table comparisons matched; count changed 0; same-count content/id changed 0 (full-content hashes where collected; see the `player_match_stats` limitation below); tables in one census only: none; ACL hash unchanged; migration ledger unchanged; **0 failures**. `public.club_seasons` is **1,640 rows with the identical content md5 `153174c325a69ba272ea1b173114d9f8`**; `seasons` 130 rows (`a86e526f…`) and `matches` 17,056 rows (`93c6a102…`) are identical in both. The census limitation is unchanged: `public.player_match_stats` is compared by row count and an ordered id hash only.
- **Sequences advanced (6):** `canonical_applications_id_seq` 40023 -> 40027, `data_overrides_id_seq` 246 -> 247, `import_batches_id_seq` 116 -> 120, `matches_id_seq` 17281 -> 17283, `promotion_candidates_id_seq` 9983 -> 9985 (footprint tables, expected, not flagged) and **`club_seasons_id_seq` 1748 -> 1752**. **The single review item is `club_seasons_id_seq` ("not a footprint table's sequence"); exit 5 is preserved.** It is an observed advance of four during the fixture interval. Rows 1751/1752 were found and removed; the individual allocation history of 1749/1750 was not captured, so the four values are not attributed solely to the two deleted rows. The compare rules were not changed to hide it, nothing was reset, and no unrelated difference was accepted. The gap stays recorded.

### 32.8 Health check after cleanup (`post\health-after-cleanup.txt`, exit 0)

`health-check.sh`: one set of 24 requests, 24 of 24 HTTP 200 with a pid and the on-disk build `kKfU7VKifbsWyPAAurnUU`; all 4 workers answered 6 times each; H-4 PASS.

### 32.9 What this shows, and what it does not

Shown: `6f99b58d` is installed on DEV with a healthy service; the synthetic edit-versus-settle and delete-versus-settle scenarios behaved as FIXED; the fixtures and the derived ladder rows are gone and all 99 table comparisons against S-0 matched (full-content hashes where collected; `player_match_stats` by row count and ordered ids only, so its content is not proven unchanged). **Not shown:** the first real-data use (the 13 Oct 05:02 nightly), the real web Data Editor, State B durable Match Sheet cases (the DEV run itself used State B), overlapping-settle behaviour, repeatability, or anything on PROD. The acceptance driver's cleanup was wrong on its first PostgreSQL run and needed an owner-authorised correction; that is a defect of the acceptance tooling, not of the product change, and is recorded as such. While the fixtures existed (about 15:58 to 16:27) DEV had a season 2093 that would have been `max(year)` on the home page, overview and admin pages; no check of what was served in that window was made.

### 32.10 Disclosures

- DEV host writes in this step: uploads of `accept-rev1.ts` and `MANIFEST-rev1.sha256`; the revision selftest (writes nothing); one dry run; **one cleanup transaction on `afldb_dev` that deleted the namespace rows (`canonical_applications` 4, `staging.afltables_match` 2, `promotion_candidates` 2, `data_overrides` 1, `matches` 1 plus 4 cascaded `match_period_scores`, `staging.source_records` 2, `staging.source_record_versions` 4, `staging.source_payloads` 4, `import_batches` 4), `club_seasons` ids 1751 and 1752, and the marked `seasons` 2093 row**; `census` and `compare` outputs under `~/i274-acc/<token>/`; the read-only precheck and health check. No deployment, acceptance rerun, rollback, migration, grant, restart or PROD contact in this step.
- The earlier steps of 32.1-32.4 (deployment, acceptance run, failed cleanup, FK sessions) were performed by an earlier session of this task and are recorded here from their logs and run records, not re-performed.
- Local read-only Git (`git diff`) was used only to return this documentation diff; Git `--no-index` diffed pack files outside the repository. Repository files changed by this step: this runbook (§32), `issues.md`, `IssuesIndex.md` and `CHANGELOG.md` (ISSUE-274 entries). All UNCOMMITTED at the time of that step; the later commit is recorded in §32.12. Zero-byte root files `240`, `DEV`, `ISSUE-274`, `first-nightly`, `owner.end({`, `{})` and one whose name is `1` plus a backtick remain untracked artefacts (left in place).

### 32.11 State after this step

ISSUE-274 stays **Open**: installed on DEV and accepted on synthetic fixtures; **the first-nightly check stays PENDING until the scheduled run occurs (13 Oct 05:02:27 AEDT; `remote\nightly-check.sh`)**. DEV holds no fixtures and no season 2093. ISSUE-275 is separate and unfixed; ISSUE-315 unchanged (Low); next free ID 316. The ISSUE-265 PROD hold is unchanged; PROD is not deployed.

### 32.12 Owner acceptance of the sequence review item, and documentation corrections (local; no database, host, network or PROD contact)

- **Owner decision (2026-10-12):** the single recorded review item, `public.club_seasons_id_seq` advancing 1748 -> 1752, is **accepted as recorded**. The original compare exit 5, its zero failures and the sequence gap are preserved; **nothing is reset**; the compare rules are unchanged.
- **Corrections made to §32 and its tracking entries (nothing re-run):** (1) the advance is described as an observed advance of four during the fixture interval; rows 1751/1752 were removed and the individual allocation history of 1749/1750 was not captured, so the four values are not attributed solely to the two deleted rows; (2) "State B not exercised" is narrowed to "State B durable Match Sheet cases not exercised", the DEV synthetic run itself having used State B; (3) all 99 table comparisons matched, with full-content hashes where collected and `player_match_stats` compared only by row count and ordered ids, and blanket claims that every table's content was proven unchanged are removed; (4) the next action is this documentation commit, the first-nightly check staying PENDING for 13 Oct 05:02:27 AEDT, and the §32 subsection cross-references in the section introduction and in §32.10 are corrected.
- **Commit:** a local commit of exactly `CHANGELOG.md`, `IssuesIndex.md`, `issues.md` and `issues/open/AFLDB-ISSUE-274.md`, parent `6f99b58d1f12362fbee40aa5d4ca18e3d7efa59c`. Not merged, pushed or deployed. The commit SHA is in the hand-off, not here (a commit cannot contain its own hash). ISSUE-274 stays Open; ISSUE-275 separate and unfixed; the ISSUE-265 PROD hold is unchanged.

## 33. 2026-10-13: the first scheduled AFL API nightly observed at `6f99b58d` (read-only DEV checks and local Git; DEV unchanged; ISSUE-274 observation only)

**Scope.** The 13 Oct nightly ran BEFORE ISSUE-276 was installed on DEV, so this is an ISSUE-274 observation. It is not a combined 274 + 276 acceptance and must not be cited as one. No deployment, rollback, migration, acquisition, settle, database write, commit, merge or push was performed by this step.

### 33.1 Criteria used (read from the pack, not recalled)

The runbook defers the nightly judgement to the pack: `D:\tmp\issue274\dev-pack-20261012\PROCEDURE.md` section 11 and `remote\nightly-check.sh` (N-0..N-3). Section 11: run `nightly-check.sh` after the first 05:02 run; exit 0 means only "it ran"; compare with the recorded baseline (3 successes, 0 failures, `foreign_source_owner` 60 in 72 h, everything else 0); "a new `AFLDB_SETTLE_FAILURE`, `write_failed`, `deadlock`, `40P01`, `55P03`, `lock_timeout`, `canceling statement` or a run far over 85 s is a regression to investigate (rollback is then an operator decision)"; "repeat on later mornings". N-3 additionally requires the service and Brownlow timer to be active and health ok. Runbook sections 31.6 and 32.9 list what the nightly was never going to show.

### 33.2 Evidence

- Operator status file `D:\tmp\issue276\nightly-status-r2-20261013-054912.txt` (host time 05:49:13 AEDT; collected by the operator, not by this session).
- This session's read-only runs, 05:54:40-05:54:41 AEDT, through `Invoke-Remote.ps1` (sha256 `18c8adbb3097aecea09a4e23bdb16f56054eb1ccc8a3086371ff322ae14c193d`, verified): `D:\tmp\issue276\nightly-assess-20261013\nightly-check-274.txt` (the documented `nightly-check.sh`, exit 0) and `continuity-274.txt` (a supplement authored for this step: checkout reflog, web-service lifecycle, Brownlow history, web-journal error counts, 24 health probes; journal, systemd metadata, git reflog and `/api/health` only; exit 0).

### 33.3 Observed against the criteria

| Item | Observed |
|---|---|
| Run | start 05:08:42, end 05:10:27 AEDT (105 s wall, 44.145 s CPU); `Result=success`, `ExecMainStatus=0`; import batch 121; label `afl-api-2026-2026-10-12-180843` |
| Start time | the pre-run forecast was 05:02:27; the unit is `OnCalendar=*-*-* 05:00` with `RandomizedDelaySec=15min` (`deploy/afldb-settle-afl-api.timer`), so any start in 05:00-05:15 is expected. The forecast was not a commitment. |
| Markers, 72 h (window = runs of 11, 12, 13 Oct; `[monitor]` banner lines excluded) | `AFLDB_SETTLE_SUCCESS` 3, `AFLDB_SETTLE_FAILURE` 0, `write_failed` 0, `canonical_apply_failed` 0, `stale_canonical_target` 0, `manual_authority_conflict` 0, `foreign_source_owner` 60, `deadlock` 0, `40P01` 0, `55P03` 0, `lock_timeout` 0, `canceling statement` 0, `Traceback` 0 = the recorded baseline (the `foreign_source_owner` 60 is three capped 20-row listings, not a refusal count: see 33.8). This run alone: one actual success marker; no failure, lock-error or traceback marker. |
| Counters | 218 matches, `corroboratedForeignOwned` 218, `canonicalApplyRefusals` 64, `dataIssuesRefreshed` 64, `dataIssuesOpened` 0, `canonicalApplyFailures` 0, `canonicalRowsInserted`/`Updated` 0, `canonicalApplicationsLogged` 0, `buildFailures` 0, unresolved identities 0, source complete; 93 payloads created and 93 versions appended, 10,371 of 10,464 observations unchanged |
| Duration | 105 s against the 85 s reference run (12 Oct; 88 s on 11 Oct). The earlier run that also created payloads (10 Oct, 46 created) took 114 s and 44.2 s CPU, against 44.1 s CPU here with 93 created. Read as consistent with a payload-creating night, not "far over 85 s". This reading is a judgement; the pack gives no numeric threshold. |
| Web service | MainPID 1873114 and BUILD `kKfU7VKifbsWyPAAurnUU` (mtime 12 Oct 15:56:38) unchanged; `ActiveEnterTimestamp` 12 Oct 15:56:54; `NRestarts` 1 = the deployment's own respawn (the only lifecycle lines since 15:50 are that respawn's three); 24 of 24 probes HTTP 200, build equal to disk, all four workers (1873126-1873129) answered six times each; web journal 05:00-05:20 has 44 lines and no `deadlock`, `40P01`, `55P03`, `lock_timeout`, `canceling statement`, `Traceback`, `unhandled`, `ECONNRESET` or `ERROR` |
| Brownlow timer | `afldb-settle-afl-api-brownlow.timer` active and enabled, last trigger 05:50:23 `Result=success`; 169 firings since 12 Oct 15:50, every one logging that `AFLDB_AFL_API_BROWNLOW_ENABLED` is not `true` ("Nothing to do"); 0 success/failure/traceback/error markers in its journal; the enable-flag line is absent from `.env` (count 0, no value read). Inert, as at installation. |
| Processes and timers | no settle/test/build/migrate process; both timers active; next AFL API timer forecast Wed 14 Oct 05:05:07 AEDT; no AFL Tables timer |
| Health | `{"status":"ok","database":"ok"}` |

### 33.4 Provenance wording

The checkout HEAD seen now (`6f99b58d`) does not by itself prove which revision the nightly ran: the run does not record its revision. What supports it: the nightly executes `tsx` from the checkout; the host checkout reflog shows the last HEAD movement was `pull --ff-only` to `6f99b58d` at 12 Oct 15:54:10, about 13 hours before the run began; tracked modifications are 0 at check time; the build and web service are unchanged since 15:56. The reflog records HEAD movement only; it cannot show an edited-and-restored working tree. This is supporting evidence, not proof. Stack-frame filenames, had any appeared, would have been investigation clues only, not an attribution rule; none appeared.

### 33.5 What this shows, and what it does not

**Shown:** the first scheduled AFL API settle after the ISSUE-274 installation completed on real DEV data with no regression marker against the documented baseline, with the web service and Brownlow timer undisturbed.
**Not shown:** that the new match-row lock was executed in this run (the journal does not record lock verbs; 64 units were refused at the write as `foreign_source_owner` and no canonical row was inserted or updated, and which lock each unit took is unobserved); an edit or delete racing a settle on real data; the real web Data Editor; State B durable Match Sheet cases; overlapping settles; `40P01`/`55P03` behaviour under contention; repeatability beyond one night; anything on PROD.

### 33.6 Remaining requirements

1. **Repeat on later mornings** (PROCEDURE.md section 11): not met by one night. As first written this item was conditional on ISSUE-276 being installed before 14 Oct 05:00; 33.8 records that the host checkout is now at `3ec76f28` (`canonical-apply.ts`, `match-rekey.ts` and `settle-afltables.ts` blobs identical to `6f99b58d`), so the 14 Oct run is a **combined ISSUE-274 + ISSUE-276 observation** and must be annotated as such. **While ISSUE-276 remains installed on DEV, every future night is likewise a combined ISSUE-274 + ISSUE-276 observation**; none can isolate ISSUE-274, so repeatability of the ISSUE-274 lock beyond the observed 13 Oct night is not established by them alone. No further ISSUE-274-only night is expected.
2. The limits listed in 33.5 and in sections 31.6 and 32.9 stay open.
3. PROD is not deployed (ISSUE-265 hold); ISSUE-274 closure follows PROD acceptance (CLAUDE.md section 5). **ISSUE-274 stays Open.**

### 33.7 Disclosures

- DEV host contact: two read-only SSH sessions (`streamanator`, scripts delivered over stdin, nothing written to the host): the pack's `nightly-check.sh` and the supplement `continuity-274.sh`. No database session, `.env` value, restart, deployment or PROD contact.
- Local read-only commands in this worktree and in the ISSUE-276 worktree: file reads, `grep`, `git status`/`git log` on the 274 worktree. Untracked root artefacts already present in this worktree (`240`, `DEV`, `ISSUE-274`, `first-nightly`, `owner.end({`, `{})`, `0`, `0)`, `1` plus a backtick, `issue099_fixture`) were not touched.
- Repository files changed by this step: this runbook (section 33 and one sentence in the opening summary), `issues.md`, `IssuesIndex.md` and `CHANGELOG.md` (ISSUE-274 entries). Committed locally, together with 33.8, as one documentation-only commit (SHA in the hand-off, not here); not merged, pushed or deployed.

### 33.8 Follow-up 2026-10-13 (07:35 re-check, capped-listing finding, per-run refusal comparison, qualifications)

Read-only. No capture re-run, deployment, restart, timer change, database write, PROD contact, commit or push. Evidence directory `D:\tmp\issue274\refusal-compare-20261013\` (sha256 prefixes in parentheses).

**07:35 check.** The documented `nightly-check.sh` was re-run at 07:35 AEDT (`D:\tmp\issue274\nightly-review-20261013-0730\nightly-check.txt`, 81bbdf71; exit 0 / PASS). Same 13 Oct run (05:08:42-05:10:27, `Result=success`, `ExecMainStatus=0`) and the same 72 h marker counts as 33.3; web service and health `ok`. The host checkout HEAD is now `3ec76f28` (ISSUE-276), no longer `6f99b58d`: the 13 Oct run preceded that change, so 33.3 stands as an ISSUE-274-only observation, and the 14 Oct 05:xx run will execute under `3ec76f28` (combined 274 + 276 observation, per 33.6 item 1). The 07:35 check adds no new run.

**Capped-listing finding.** The `foreign_source_owner` count of 60 in `nightly-check.sh` N-2 is NOT a refusal count. It counts journal lines of the settle exception report's "Open canonical apply failures" section, which prints at most 20 open `data_issues` rows and then "... more than 20 open; query data_issues directly for the full list". Three runs in the 72 h window x 20 listed rows = 60 (100 = 5 x 20 across the 9-13 Oct journal fetched here). It is invariant by construction, so that marker cannot detect a change in the number of refusals; the per-run counters below can. Each night the identical 20 keys are listed (all `player_match_stats`, sorted, 11 first detected 1 Oct and 9 first detected 3 Oct).

**Per-run comparison (full journal, `journal-full.txt` 6b979d99, parsed by `analyse.py` 4abb0dbc -> `analysis-output.txt` dd8e00b9; persisted counters from `db-refusal-census.txt` 73fecdfc, section B-1).** Journal counters and the persisted `import_batches.validation_result` counters agree for every run.

| Run (start) | Label (snapshot) | Batch | Refusals | Failures | Inserted / Updated / Ledger | data_issues opened / refreshed / resolved | Payloads created | Wall / unit CPU / batch window |
|---|---|---|---|---|---|---|---|---|
| 9 Oct 05:15:12 (outside the requested range; baseline context) | `afl-api-2026-2026-10-08-181513` | 111 | 64 | 0 | 0 / 0 / 0 | 3 / 61 / 0 | 1840 | 124 s / 47.9 s / 65 s |
| 10 Oct 05:10:22 | `afl-api-2026-2026-10-09-181023` | 112 | 64 | 0 | 0 / 0 / 0 | 0 / 64 / 0 | 46 | 114 s / 44.2 s / 57 s |
| 11 Oct 05:09:35 | `afl-api-2026-2026-10-10-180936` | 115 | 64 | 0 | 0 / 0 / 0 | 0 / 64 / 0 | 0 | 88 s / 26.1 s / 28 s |
| 12 Oct 05:01:28 | `afl-api-2026-2026-10-11-180129` | 116 | 64 | 0 | 0 / 0 / 0 | 0 / 64 / 0 | 0 | 85 s / 25.7 s / 28 s |
| **13 Oct 05:08:42 (first run with the lock, `6f99b58d`)** | `afl-api-2026-2026-10-12-180843` | 121 | 64 | 0 | 0 / 0 / 0 | 0 / 64 / 0 | 93 | 105 s / 44.1 s / 57 s |

Every run: `AFLDB_SETTLE_SUCCESS`, 218 matches, `corroboratedForeignOwned` 218, `manualAuthorityRefusals` 0, `buildFailures` 0, `Applied as import batch N: 0 canonical row(s) inserted, 0 updated, 0 ledger row(s), 0 attendance enrichment(s), 64 refused at the write, 0 unit(s) rolled back.` Earlier AFL API batches (B-1): 106 and 109 had 60 refusals, 110 had 61, so the 64 was reached on 9 Oct (batch 111, 3 findings opened) and has not changed since. Batch ids 117-120 do not exist in `import_batches` (consistent with the four fixture batches of the ISSUE-274 acceptance run having been cleaned up, runbook 32; not verified here). Wall time = systemd start to finish; batch window = `import_batches.started_at` to `completed_at`.

**Result of the comparison.** The per-run refusal total is 64 in every run before (9-12 Oct) and after (13 Oct) the installation, with 0 failures and 0 canonical inserts, updates or ledger rows throughout. No change in refusal totals or in any other counter attributable to the lock change was observed.

**Reasons: what is established and what is not.**
- *Direct, per run, partial:* the capped listing at the end of each of the five runs shows the same 20 keys refused as `foreign_source_owner` (20 of 64 per run).
- *Direct, 13 Oct only, all 64 (current state):* the open `afl_api` `canonical_apply_failed` findings are 64 rows, all `foreign_source_owner`, all `player_match_stats`, spread over 37 matches (D-1, D-5). A finding's `details` is overwritten on every refresh (`writeSettleDataIssue`, `settle-core.ts` ON CONFLICT DO UPDATE) and no later `afl_api` settle run appears in the journal (to 07:42), so these rows carry the 13 Oct run's reason. The same rows are NOT proof of the reasons in earlier runs.
- *Inferred for 9-12 Oct, not proven:* from batch 112 on, `dataIssuesOpened` = 0 and `dataIssuesResolved` = 0 with `dataIssuesRefreshed` = 64 = `canonicalApplyRefusals` in every run; there are 64 open rows and no `issue_key` with more than one row (D-3), i.e. no finding was closed and reopened; detection dates reconcile with the batch counters (3 rows detected 9 Oct 05:16:12 = batch 111 opened 3; 2 rows 8 Oct and 1 row closed 8 Oct as `canonical_apply_not_needed` = batch 110 opened 2 / resolved 1). So the same 64 targets were refused and refreshed each night. That the reason for the 44 unlisted targets was `foreign_source_owner` on each of 9-12 Oct is consistent with this but is not recorded anywhere: no per-run reason, `refusalEvidence` census or per-target journal line is persisted (B-2: batch `validation_result` holds only counts and the `manualAuthorityRefusals` counter).
- *Remaining evidence gap (NOT PROVEN, not recoverable):* the per-target reason of the 44 unlisted refusals on 9-12 Oct, and the reason of the 20 listed keys at times other than end of run, cannot be established from the journals or the database, because no per-target reason was persisted for those runs. A new dry-run refusal census (the ISSUE-252 D-252-12 form) would show the reasons as of the day it runs; it would be new evidence only and cannot establish what the reasons were on 9-12 Oct. This step did not run one.

**Qualifications on the review wording.**
- **Lock execution: NOT PROVEN.** That every one of the 64 targets was refused (`foreign_source_owner`) does not show the lock was skipped, and equally does not show it was taken. The journal records no lock verbs, the counters are identical before and after, and which lock each unit took is unobserved. 33.5 already lists this as not shown; this sentence replaces any reading of the refusals as evidence either way.
- **Runtime: no observed regression; the payload/CPU explanation remains an inference.** Wall time 105 s (13 Oct) against 124 s, 114 s, 88 s and 85 s on 9-12 Oct, and the 57 s batch window of 13 Oct equals 10 Oct's 57 s (65 s on 9 Oct, 28 s on the two zero-payload nights). Unit CPU 44.1 s against 44.2 s on 10 Oct. The five nights are an uncontrolled sample; payload count does not explain the timings by itself (46 and 93 payloads cost the same 57 s, 1840 cost 65 s), so "a payload-creating night" is a plausible reading, not a measured cause. There is no numeric threshold in the pack. One night under the lock is not repeatability.

**Evidence of the SSH sessions.** Two read-only sessions to the DEV host through the pack's `Invoke-Remote.ps1` (sha256 18c8adbb3097aecea09a4e23bdb16f56054eb1ccc8a3086371ff322ae14c193d, re-verified): `journal-fetch.sh` (cca712b7; `journalctl` of `afldb-settle-afl-api` since 2026-10-09, exit 0) and `db-refusal-census.sh` (24ce407f; guarded `afldb_owner` session on `afldb_dev`, `default_transaction_read_only=on`, guard asserted identity, owner DSN read in process only and not printed; `SELECT` only: `import_batches` ids 105-125, `data_issues` aggregates, exit 0). No `.env` value was output.

**State.** ISSUE-274 stays **Open**. The ISSUE-265 PROD hold is unchanged. Still outstanding: the 14 Oct (combined 274 + 276) morning check, the limits in 33.5, and PROD acceptance.
