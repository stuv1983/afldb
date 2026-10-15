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
- **Fixed code.** `ingest-datasets`: 305 passed (6 new). The new match-results case and the new bio case each pass. The full `submission-promotion` file: 18 passed, 2 expected-fail, 1 skipped. The full `match-results-promotion` file: 24 passed, 22 skipped, the file failing in the ISSUE-264 block's hook (`this database does not admit player_match_stats authority (migration 110)`: `afldb_test` is in the pre-110 state), **identically on unchanged `main`** (23 passed, 22 skipped, the same hook error; the one extra pass here is the new case).
- **Unfixed source** (`git checkout HEAD -- src/`, the fixed files copied back and sha-256 verified): the 6 DB-free cases fail, the match-results case fails with `{ read: 2, inserted: 2, updated: 0 }` where `{ read: 2, inserted: 1, updated: 1 }` is expected, and the bio case with `{ read: 2, inserted: 2, updated: 0 }`: the defect as the runbook states it.
- **Mutants** (`D:\tmp\issue307\mutate.mjs`, one at a time, original bytes restored and hash-verified after each): every row counted as inserted (V1) or no updates recorded (V2) in the pipeline; a no-op counted as an update (V3); the upsert helper always `inserted` (V4); the `RETURNING` clause removed from `match_results` (V5), `player_bio` (V6), `all_australian` (V8), `rising_star` (V9) and `player_match_stats` (V10); `match_attendance` always `updated` (V7). **All 10 killed**, each by the DB-free cases and/or the integration cases that cover it.
- **Fixture and batch census.** A read-only census (season 2073 matches, seasons and club seasons, the ISSUE-258 fixture clubs, organisations, players and submissions, and the count of promotion batches) read 0 for every fixture counter after every run, and 690 promotion batches at the start. The promotion suites leave their `import_batches` rows behind by convention; this work created 147 (the new cases, the baseline, the mutants, the full-file runs and the `main` comparison) and removed exactly those with a guarded script (`cleanup-batches.mjs`: database `afldb_test`, tool `admin-upload`, notes `submission %`, a listed target table, started within the window, refused unless the count equals the dry run's, run as a dry run first), in four passes of 5, 1, 21 and 120. The census returned to 690. No earlier batch was touched.
- **Static.** `tsc --noEmit` exit 0; `git diff --check` exit 0; ESLint of the five changed files exits 0 on this branch and on unchanged `main`, with the same problem set.

### 17.4 Limits

- Not deployed; no browser, DEV or PROD action. Earlier promotion batches keep the old counts (`records_inserted` = rows, `records_updated` 0); nothing is repaired. `rising_star`, `all_australian` and `match_attendance` are proved by the stand-in `sql` and by the statement text; the `xmax` semantics were exercised against PostgreSQL for `matches` and `player_match_stats` (and `UPDATE ... RETURNING id` for `players`), through the same idiom, not for the award tables or `match_attendance` themselves. An upsert statement cannot return no row (a no-op there is a safeguard). The batch's `completed_at` still equals its start (`now()` inside the promotion transaction), the defect class ISSUE-294 fixed for three other writers; it is not part of this issue and was not changed.

## 18. Readiness, merge and closure (2026-10-15)

- **Readiness: accepted under a scoped cleanliness exception, not a clean pass.** `npm run preflight -- --mode implementation --issue 307` on the committed worktree: READY (0 blockers, 3 warnings: `.env`, `psql`, `pg_restore`; raw `D:\tmp\issue307\preflight-1.txt`). `npm run merge:ready -- --issue 307` (raw, unchanged: `D:\tmp\issue307\merge-ready-raw-1.txt`): BLOCKED by exactly one blocker, the primary worktree not clean; every other check PASSed, with two metadata warnings (no runbook readiness JSON block; no automated unexpected-file classification). The eight committed paths were compared with the declared scope by hand: the two ingest source files, the three test files, this runbook, `issues.md` and `IssuesIndex.md`.
- **Exception (fresh, this issue only).** The owner authorised an exception covering only that clean-tree FAIL under the exact **18**-path primary state (the nine `.agents/skills` files, the seven zero-byte stray-named files, the literal `$null)` and the zero-byte `2000)`). Immediately before the merge a script verified the 18 paths, their full sha-256 hashes (`$null)` `d9edb146…2500`, unchanged since the session start), no tracked and no staged primary change, and that fresh `main`, `origin/main` and the live remote agreed (`premerge-1.txt`); it read OK again after the push (`postmerge-1.txt`).
- **Merge.** `0d7810d8` fast-forwarded onto `main` and was pushed (`631b9c72..0d7810d8`); local `main` and `git ls-remote origin refs/heads/main` both equalled `0d7810d8` afterwards.
- **Resolution.** Resolved on the push of the documentation-only closure commit. §14 asks for an integration case that promotes a file with one new and one existing row and asserts 1/1; it exists and passes through the real promotion pipeline on the import role (`2/1/1`), with the player-stats and biography cases and six DB-free cases (§17.2, §17.3). The closure scope is **merge-scoped**: code on `main`, validated on `afldb_test`, **not deployed**.
- **Preserved limits.** Not deployed. No browser, DEV or PROD action. Earlier promotion batches keep their old counts. The `xmax` semantics were exercised on PostgreSQL for `matches` and `player_match_stats`, not for the award tables or `match_attendance` themselves. The batch's `completed_at` still equals its start. The match-results file's ISSUE-264 block does not run on `afldb_test` (pre-110 state), identically on `main`.
