# AFLDB-ISSUE-307 — Legacy promotion counts every promoted row as inserted

## 0. Status

- **Status:** **Resolved (2026-10-15, merge-scoped; opened 2026-10-08).** Implemented and merged as `0d7810d8` (fix, tests and records), validated on `afldb_test` (§17), merged and pushed (§18). **Not deployed.**
- **Severity:** Low. **Area:** legacy CSV intake / import batch accounting.
- **Key file:** `src/lib/ingest/pipeline.ts` (`promoteSubmission`).
- **Origin:** full code review at `20a7a4bbdea835cdd3fc5520e65ad47d275bd881` (`issues/reviews/2026-10-08-full-code-review.md`, F-042; partition note R5a-F10).
- **Classification:** code-proven.

## 1. Summary

The legacy promotion stamps `records_read = rows.length` and `records_inserted = rows.length`. `records_updated` stays 0. Every `ON CONFLICT DO UPDATE`, every `player_bio` UPDATE, and every `match_attendance` UPDATE that touched no row (because the match was deleted since validation) is counted as inserted.

## 2. Evidence

- `src/lib/ingest/pipeline.ts:402-407`.
- `src/db/migrations/001_foundations.sql:64`.
- `src/lib/ingest/datasets.ts:1328-1329` (the attendance UPDATE can touch no row).

## 3. Trigger

Any promotion that updates existing rows.

## 4. Expected invariant

Inserted, updated and no-op rows are distinguished.

## 5. Actual behaviour

Everything is counted as inserted.

## 6. First wrong layer

`pipeline.ts:402-407`.

## 7. Impact

Reporting only. The `records_rejected` handling is correct (0 with no rows, consistent with ISSUE-244 F008).

## 8. Reproduction / witness

Not executed.

## 9. Disproof attempts

None.

## 10. Existing-issue search

None. Classification: **new**. Related to AFLDB-ISSUE-294 (a different writer).

## 11. Scope

The promotion batch counters.

## 12. Out of scope

The settle counters (AFLDB-ISSUE-293/294).

## 13. Proposed fix boundary

`promoteRow` returns `'inserted' | 'updated' | 'noop'` (`RETURNING xmax = 0` or the driver count), summed into the three columns.

## 14. Proposed validation

Integration: promote a file with one new and one existing row and assert 1/1.

## 15. Decisions / unresolved questions

None.

## 16. Next action

~~Implementation (low priority).~~ Superseded by §17.

## 17. Implementation and validation (2026-10-15)

### 17.1 Change

- `src/lib/ingest/datasets.ts`: `promoteRow` now returns a `PromotedRowOutcome` (`'inserted' | 'updated' | 'noop'`). The four writers that are `INSERT ... ON CONFLICT DO UPDATE` (`rising_star`, `all_australian`, `match_results`, `player_match_stats`) end their statement with `RETURNING (xmax = 0) AS inserted` (`xmax` is 0 on a row the statement inserted and non-zero on one it updated in place) and report inserted, updated or, with no row back, no-op. The two plain `UPDATE`s (`player_bio`, `match_attendance`) end with `RETURNING id`: a row written is `updated`, none (the player or match was deleted since validation) is `no-op`. Two small helpers, `upsertOutcome` and `updateOutcome`, hold that mapping.
- `src/lib/ingest/pipeline.ts` (`promoteSubmission`): the loop tallies the outcomes, and the batch is closed with `records_read` = rows read, `records_inserted` = the inserts and `records_updated` = the updates (it was `records_inserted = rows.length` and `records_updated` 0). A no-op row is in `records_read` only, so `read` can exceed `inserted + updated`; no column exists for it and none was added. `applied` in the promotion result is unchanged (rows read). `completed_at = now()` on this statement is **not** changed: the runbook's scope is the counters (the equal start and completion instants are the ISSUE-294 defect class, left alone here and noted in §17.4).
- No migration, no change to validation or to any statement's write set; only the `RETURNING` clause and the return value are new.

### 17.2 Tests

- `tests/ingest-datasets.test.ts` (DB-free; a stand-in tagged `sql` that answers the way PostgreSQL does): `it.each` over the four upsert writers asserts `inserted` for `{inserted: true}`, `updated` for `{inserted: false}` and `noop` for no row, and that the write statement contains `RETURNING (xmax = 0) AS inserted`; over the two update writers, `updated` for a row and `noop` for none, with `RETURNING id` as the statement's end. That is 6 cases.
- `tests/integration/match-results-promotion.test.ts` (in the ISSUE-258 block, through the real `validateSubmission` and `promoteSubmission` on the import role): a new match is `read 1 / inserted 1 / updated 0`; the same file again with one genuinely new match beside it is `2 / 1 / 1`; the first `player_match_stats` row for a player on a match is `1 / 1 / 0` and its re-promotion `1 / 0 / 1`. Its fixtures use April days 27 and 28 (a later case counts rows on day 08 and the first version of this case collided with it).
- `tests/integration/submission-promotion.test.ts`: a `player_bio` submission of two rows where the second player is deleted after validation: `read 2 / inserted 0 / updated 1`, and the surviving row's date of birth is written.

### 17.3 Results

- **Authority.** `D:\tmp\issue307\run-int.mjs` (the ISSUE-282 launcher, with extra vitest arguments passed through) derived the owner, importer and auth DSNs in memory from the primary `.env`, pointed them at `afldb_test` on tunnel port 55432 and proved `current_database() = afldb_test` for each before vitest started. The importer role runs the promotion, so `RETURNING (xmax = 0)` and `RETURNING id` were exercised under its real privileges for `matches`, `player_match_stats` and `players`. No credential was printed or written. No `afldb_dev`, PROD, migration, rebuild, restore, truncation or repair.
- **Fixed code.** `ingest-datasets`: 305 passed (6 new). The new match-results case and the new bio case each pass. The full `submission-promotion` file: 18 passed, 2 expected-fail, 1 skipped. The full `match-results-promotion` file: 24 passed, 22 skipped, the file failing in the ISSUE-264 block's hook (`this database does not admit player_match_stats authority (migration 110)`: `afldb_test` is in the pre-110 state), **identically on unchanged `main`** (23 passed, 22 skipped, the same hook error; the one extra pass here is the new case). The 22 skipped tests did not run on either tree and are not counted as passes. *(Added 2026-10-15, §19: the first full run of that file on the fixed branch, `D:\tmp\issue307\int-mr-full.txt`, failed the existing case `271: validation reports the conflict under the canonical key, and the identical figures still promote` (`rowsOnDay('08')` returned 2 rows where 1 was expected; 1 failed, 23 passed, 22 skipped); the 24 passed above is a rerun on unchanged code, `int-mr-full-2.txt`. The cause was not investigated.)*
- **Unfixed source** (`git checkout HEAD -- src/`, the fixed files copied back and sha-256 verified): the 6 DB-free cases fail, the match-results case fails with `{ read: 2, inserted: 2, updated: 0 }` where `{ read: 2, inserted: 1, updated: 1 }` is expected, and the bio case with `{ read: 2, inserted: 2, updated: 0 }`: the defect as the runbook states it.
- **Mutants** (`D:\tmp\issue307\mutate.mjs`, one at a time, original bytes restored and hash-verified after each): every row counted as inserted (V1) or no updates recorded (V2) in the pipeline; a no-op counted as an update (V3); the upsert helper always `inserted` (V4); the `RETURNING` clause removed from `match_results` (V5), `player_bio` (V6), `all_australian` (V8), `rising_star` (V9) and `player_match_stats` (V10); `match_attendance` always `updated` (V7). **All 10 killed**, each by the DB-free cases and/or the integration cases that cover it.
- **Fixture and batch census.** A read-only census (season 2073 matches, seasons and club seasons, the ISSUE-258 fixture clubs, organisations, players and submissions, and the count of promotion batches) read 0 for every fixture counter after every run, and 690 promotion batches at the start. The promotion suites leave their `import_batches` rows behind by convention; this work created 147 (the new cases, the baseline, the mutants, the full-file runs and the `main` comparison) and removed exactly those with a guarded script (`cleanup-batches.mjs`: database `afldb_test`, tool `admin-upload`, notes `submission %`, a listed target table, started within the window, refused unless the count equals the dry run's, run as a dry run first), in four passes of 5, 1, 21 and 120. The census returned to 690. No earlier batch was touched. *(Qualified 2026-10-15, §19: each pass selected by predicate and time window, not by a recorded ID list, so "removed exactly those" and "no earlier batch was touched" are inferences from listings, counts and ID order, with the limits stated there.)*
- **Static.** `tsc --noEmit` exit 0; `git diff --check` exit 0; ESLint of the five changed files exits 0 on this branch and on unchanged `main`, with the same problem set.

### 17.4 Limits

- Not deployed; no browser, DEV or PROD action. Earlier promotion batches keep the old counts (`records_inserted` = rows, `records_updated` 0); nothing is repaired. `rising_star`, `all_australian` and `match_attendance` are proved by the stand-in `sql` and by the statement text; the `xmax` semantics were exercised against PostgreSQL for `matches` and `player_match_stats` (and `UPDATE ... RETURNING id` for `players`), through the same idiom, not for the award tables or `match_attendance` themselves. An upsert statement cannot return no row (a no-op there is a safeguard). The batch's `completed_at` still equals its start (`now()` inside the promotion transaction), the defect class ISSUE-294 fixed for three other writers; it is not part of this issue and was not changed.

## 18. Readiness, merge and closure (2026-10-15)

- **Readiness: accepted under a scoped cleanliness exception, not a clean pass.** `npm run preflight -- --mode implementation --issue 307` on the committed worktree: READY (0 blockers, 3 warnings: `.env`, `psql`, `pg_restore`; raw `D:\tmp\issue307\preflight-1.txt`). `npm run merge:ready -- --issue 307` (raw, unchanged: `D:\tmp\issue307\merge-ready-raw-1.txt`): BLOCKED by exactly one blocker, the primary worktree not clean; every other check PASSed, with two metadata warnings (no runbook readiness JSON block; no automated unexpected-file classification). The eight committed paths were compared with the declared scope by hand: the two ingest source files, the three test files, this runbook, `issues.md` and `IssuesIndex.md`.
- **Exception (fresh, this issue only).** The owner authorised an exception covering only that clean-tree FAIL under the exact **18**-path primary state (the nine `.agents/skills` files, the seven zero-byte stray-named files, the literal `$null)` and the zero-byte `2000)`). Immediately before the merge a script verified the 18 paths, their full sha-256 hashes (`$null)` `d9edb146…2500`, unchanged since the session start), no tracked and no staged primary change, and that fresh `main`, `origin/main` and the live remote agreed (`premerge-1.txt`); it read OK again after the push (`postmerge-1.txt`).
- **Merge.** `0d7810d8` fast-forwarded onto `main` and was pushed (`631b9c72..0d7810d8`); local `main` and `git ls-remote origin refs/heads/main` both equalled `0d7810d8` afterwards.
- **Resolution.** Resolved on the push of the documentation-only closure commit. §14 asks for an integration case that promotes a file with one new and one existing row and asserts 1/1; it exists and passes through the real promotion pipeline on the import role (`2/1/1`), with the player-stats and biography cases and six DB-free cases (§17.2, §17.3). The closure scope is **merge-scoped**: code on `main`, validated on `afldb_test`, **not deployed**.
- **Preserved limits.** Not deployed. No browser, DEV or PROD action. Earlier promotion batches keep their old counts. The `xmax` semantics were exercised on PostgreSQL for `matches` and `player_match_stats`, not for the award tables or `match_attendance` themselves. The batch's `completed_at` still equals its start. The match-results file's ISSUE-264 block does not run on `afldb_test` (pre-110 state), identically on `main`.

## 19. Evidence reconciliation (2026-10-15; documentation only, no database action)

Read from the saved files in `D:\tmp\issue307\` and, because each pass printed its dry run and apply to the console without saving them, from verbatim extracts of the implementing session's transcript, preserved in `D:\tmp\issue307\reconcile-20261015\` (`SHA256SUMS.txt`: `transcript-cleanup-batches.txt` `c06cd6e4c122bc0f60af50e8f5350aec3912d3a4b1620e4330bbb03319109296`, `transcript-int-mr-full.txt` `81801e6d7720f9ed607c6930d992660777e1996bf8b08a0dc6b5acec535634ab`; source transcript `91442ef6-….jsonl`, sha-256 at extraction `5227314632b5319103ff2f35a3f58de55ca86cd941fa6f678bea432c823f620a`). Times are AEDT.

| Pass | Window, expected | IDs shown in a listing | Apply |
|---|---|---|---|
| 1 (10:59) | 25 min, 5 | all 5: 2469–2473 (started 10:58:53–10:59:05) | found 5, deleted 5; census 690 |
| 2 (11:00) | 10 min, 1 (`player_bio` added to the target list after a dry run found 0) | 2474 (11:00:02) | found 1, deleted 1; census 690 |
| 3 (11:02) | 60 min, 21 | **3 of 21** (2475–2477, from 11:00:40; the listing was cut to its first three lines); the other 18 IDs were never shown or saved | found 21, deleted 21; census 690 |
| 4 (11:11) | 150 min, 120 | `cleanup-dry.txt` (11:10:54) found **114** (2496–2620) because `match_attendance` was not yet a listed target; `other-batches.mjs` (11:11:01, read-only) listed the 6 `match_attendance` batches (2523, 2528, 2566, 2571, 2607, 2612) and **690** submission batches older than the window; after the target was added the dry run printed only its count, 120 | found 120, deleted 120; census 690 (`census-final.txt`) |

**What the evidence supports.** 5 + 1 + 21 + 120 = 147. Each apply deleted `WHERE id = ANY(<the ids it had just selected>)`, refusing unless the count equalled the stated expectation. The promotion-batch count went 690 (`census-before.txt`, 10:58:47) to 810 (`census-after-full.txt`, 11:10:47) to 690. The earliest deleted batch (2469) started at 10:58:53, after the 690 baseline; pass 3's listing is ordered by ID and starts at 2475, so no lower ID was in its selection; at 11:11 exactly 690 submission batches were older than pass 4's window, so that window held exactly the 120 it deleted.

**Limits (not proven).**
1. No apply deleted a recorded ID list: each re-ran its selection, so the deleted set's equality with a listing is inferred from equal counts. Passes 1 and 2 have complete listings; pass 3's IDs after 2477 were never displayed; pass 4's final 120-row selection was never listed and is reconstructed from the 114 + 6 listings taken seconds earlier.
2. Exclusive ownership rests on the time window, the predicate (`tool = 'admin-upload'`, `notes LIKE 'submission %'`, a listed target table) and ID order. Nothing recorded excludes another writer of such batches on `afldb_test` between 10:58:47 and 11:11.
3. The restored 690 counts `notes LIKE 'submission %'` only. It does not show that unrelated rows (other batches, or rows in other tables) were preserved.
4. Deleting an `import_batches` row cascades to `import_rejections` (`src/db/migrations/001_foundations.sql:80`, `ON DELETE CASCADE`); every other reference in the migration text has no delete action, so a referenced batch could not have been deleted. Cascaded `import_rejections` rows, if any, were not counted. Live constraints were not inspected.
5. IDs 2496–2620 span 125 values and 120 were deleted. The other five values were not examined (a batch outside the predicate, or sequence values consumed without a committed row); any such row was neither deleted nor counted.

**First full match-results run.** Recorded in §17.3 (added above): one existing ISSUE-271 case failed on the first full run of the fixed branch and passed on the rerun of unchanged code; `main` passed it. Not investigated, not reproduced, and not counted as a pass.

**Skips.** The match-results file's 22 skipped tests (the ISSUE-264 block, which needs migration 110; `afldb_test` is in the pre-110 state) did not run on this branch or on `main`. They are not passes, and nothing in §17 or §18 counts them as passes.

Nothing in §17's or §18's validation verdict changes: the ISSUE-307 cases and mutants are unaffected by these limits, which concern the cleanup and the record only.
