# AFLDB-ISSUE-082 Implementation Report (FINAL)

* **Issue:** AFLDB-ISSUE-082
* **Current phase:** Documentation Closure
* **Session Model:** Gemini 3.1 Pro / High (Antigravity CLI `agy`)

### 1. Root Cause
`confirmUnlinked` recorded an audit-only decision and was written as though that made a concurrency check unnecessary. It did not: for draft picks, the decision acts on a person grain and can contradict a link applied between the page render and form submission.

### 2. Implementation Summary
Migrated `confirmUnlinked` from the `authSql` path to use the `afldb_import` transaction pool, explicitly taking the authoritative draft_person row lock at the draft_person_id grain via lockUnresolvedTarget. Draft identity logic was extracted and aligned with the importer. The form-supplied `previousStatus` has been removed from `confirmUnlinked`'s public query input and is no longer validated or forwarded by the server action. `previous_status` is derived from the locked database row.

### 3. Exact Files Changed
* `src/db/queries/player-links.ts`
* `src/app/admin/player-links/actions.ts`
* `tests/player-link-mutations.test.ts`
* `tests/integration/player-link-concurrency.test.ts`
* `tests/integration/awards-reload-links.test.ts`
* `tests/integration/draft-reload-links.test.ts`
* `tests/integration/first-kick-goal-reload-links.test.ts`
* `issues.md`
* `IssuesIndex.md`
* `CHANGELOG.md`

### 4. Transaction/Locking Design
All link-resolution actions now run through the explicit transaction sequence: lock target → extract semantics → check concurrency/contradictions → mutate target → write audit log. `resolveLockedLink` and `confirmLockedUnlinked` safely enforce these states. For draft entities, the authoritative lock is at the `draft_person` row / `draft_person_id` grain.

### 5. Logical-Decision Classification
Draft logical decisions are classified at the draft-person grain by mirroring the importer's effective latest-resolution-per-pick classification: `DISTINCT ON (target_id) ... ORDER BY created_at DESC, id DESC`. A contradiction is defined precisely as: effective sibling actions differ, or linked decisions point to different players.

### 6. `createPlayerAndResolveLink` Ordering
The `createPlayerAndResolveLink` mutation correctly sequences the unresolved-target lock and semantic classification *before* executing the player insertion, preventing dangling player records on stale submissions.

### 7. `confirmUnlinked` Authoritative `previous_status` Behaviour
`previous_status` is now fetched directly from the database under the row lock. The form-supplied `previousStatus` value has been removed entirely from the action and query API.

### 8. Duplicate-Confirmation Behaviour
An identical duplicate `confirmUnlinked` submission is safely rejected as a `stale form` rejection rather than creating a new `confirmed_unlinked` audit record, guaranteeing the one-action-one-row invariant.

### 9. Contradictory-State Behaviour
If the incoming action detects a contradiction (effective sibling actions differ, or linked decisions point to different players), the mutation gracefully fails closed, rejecting the operation without writing anything. A consistent existing linked or confirmed-unlinked decision is rejected safely as stale state, not described as a contradiction.

### 10. Database Concurrency-Test Design
A new integration test (`tests/integration/player-link-concurrency.test.ts`) orchestrates true determinism over real PostgreSQL transactions using `pg_blocking_pids`. No `sleep()` hacks were used. The observer pattern guarantees `T2` is blocked by `T1` before `T1` proceeds.

### 11. Test-Harness Corrections Made During Validation
- **Gate 1:** Mocks for `fakeTransaction.values` did not capture raw SQL strings (`'confirmed_unlinked'`). Test assertions were updated to match the query pattern properly.
- **Gate 2 (Fixture):** Fixed the integration test fixture to satisfy NOT NULL constraints across `draft_persons`, `draft_picks`, `players`, and added `auth_users` for foreign-key compliance.
- **Gate 2 (Deadlock):** Replaced the use of the locked `sql1` connection inside the wait loop with a third, independent `sqlObserver` connection. Added explicit `try/finally` test cleanup to prevent poisoning subsequent tests.
- **Server Action:** Corrected `src/app/admin/player-links/actions.ts` to fully decouple `confirmUnlinked` from the form-supplied status. Added regression coverage proving the server action ignores the field. Corrected the action test fixture to accurately reflect the colon-delimited wire format.
- **TypeScript Callsites:** Removed `previousStatus` from `confirmUnlinked`'s public query input type. This deliberately broke five obsolete test callsites which were then safely corrected to match the new API.
- **Test Fixture Isolation:** The initial concurrency test design mistakenly used a global `TRUNCATE auth_users, draft_persons, draft_picks, player_link_resolutions, players RESTART IDENTITY CASCADE` against the shared `afldb_test` database. This damaged shared baseline test fixtures. The user restored the `afldb_test` database from `afldb_dev`. The concurrency test was corrected to use targeted, test-owned ID cleanup before its final 3/3 passing validation.
- **Cross-Platform Execution:** The `first-kick-goal` test suite previously failed silently on Windows because its Node `spawnSync` invocation executed the extensionless Unix shim `node_modules/.bin/tsx` without a shell. The suite was updated to invoke `tsx.cmd` correctly via `shell: true` and to expose child process errors natively.
- **Semantic Test Compatibility:** Two semantic `first-kick-goal` tests (`keeps a confirmed-unlinked decision...` and `a decided retirement is a decision loss...`) originally fetched resolved rows via `takeSourceLinked()` and passed them to `confirmUnlinked` without returning them to the unresolved queue first. This only passed previously because the old `authSql` approach blindly trusted the test-provided `previousStatus: 'ambiguous'` without verifying database state. The new strict locking mechanism implemented in ISSUE-082 accurately identified the row as already linked and rejected the mutation. A legitimate `await returnToQueue(row.id)` reset was added to those tests, restoring the rows to the intended unresolved state before confirmation.
- **Rekey State Validation:** It was verified that the `afldb_test` baseline data does not require a manual `--rekey` prior to testing. The `first-kick-goal` integration suite intentionally runs a mass `UPDATE player_achievements SET source_record_id = ...` to forcibly degrade all 334 rows to the legacy key format at the beginning of the suite. This is by design, proving that the `--rekey` command works in place.

### 12. Final Successful Validation Results
* **Gate 1:** `tests/player-link-mutations.test.ts`: 34/34 passed
* **Gate 2:** `tests/integration/player-link-concurrency.test.ts`: 3/3 passed
* **Gate 3:**
  - Targeted ISSUE-078 first-kick-goal compatibility validation passed (2 passed / 12 skipped, exit 0). Note: a one-off `--testTimeout=120000` flag was used only for this validation because the existing importer-heavy test lacks the explicit timeout used by nearby tests.
  - `npx tsc --noEmit` passed (no TypeScript errors).
* **Gate 4:** `npm run build` passed, 1499/1499 static pages.

### 13. Privileges/Migration Conclusion
No new database grants were required; the implementation uses the existing `afldb_import` transaction path and existing privileges. No database migration was required.

### 14. ISSUE-080 Interaction
The `confirmUnlinked` operation is strictly audit-only. It does not update `player_id` on the source table, meaning it bypasses the transaction-scoped `(717275, 1)` advisory lock introduced by ISSUE-080. This separation is preserved successfully.

### 15. Known Risks
- ISSUE-083 test-role parity remains a separate known risk (importers are tested as `afldb_owner`, so missing-grant defects are invisible in tests).

### 16. Deployment Requirement
Normal application merge/deployment is still required.

### 17. Final ISSUE-082 Status
RESOLVED (Documentation Complete).
