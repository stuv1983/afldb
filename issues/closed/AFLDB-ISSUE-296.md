# AFLDB-ISSUE-296 — Deprecated fallback importer sets `records_rejected` without rejection rows

## 0. Status

- **Status:** Resolved (2026-10-15, merge-scoped; opened 2026-10-08). Implementation §17; readiness, merge and closure §18.
- **Severity:** Low. **Area:** acquisition / deprecated fallback staging refresh.
- **Key file:** `src/lib/external-afl/current-season-import.ts`.
- **Origin:** full code review at `20a7a4bbdea835cdd3fc5520e65ad47d275bd881` (`issues/reviews/2026-10-08-full-code-review.md`, F-031; partition note R4a-F06).
- **Classification:** code-proven.

## 1. Summary

The fallback importer writes `records_rejected = canonicalPlan.rejectedOrConflicted`, a planning count, while writing no `import_rejections` rows. That contradicts the column's contract: it must equal the number of rejection rows for the batch (ISSUE-244 F008).

## 2. Evidence

- `src/lib/external-afl/current-season-import.ts:853`; no `import_rejections` insert in `:736-886`; `:865` already keeps the count in `validation_result`.
- `src/db/migrations/001_foundations.sql:71` (column comment) and `src/lib/acquisition/settle-core.ts:1134-1139` (the contract).

## 3. Trigger

Admin "Run fallback staging refresh" with Persist on (`CurrentSeasonControls.tsx:233`), or `update-current-season.ts --apply`.

## 4. Expected invariant

`records_rejected` equals the count of `import_rejections` rows.

## 5. Actual behaviour

A non-zero count with zero rows.

## 6. First wrong layer

`current-season-import.ts:853`.

## 7. Impact

Contradicts consumers that join the two. Deprecated path; low value.

## 8. Reproduction / witness

Not executed.

## 9. Disproof attempts

F008 scoped the settle engines only.

## 10. Existing-issue search

`issues/closed/AFLDB-ISSUE-244.md:3851-3975` does not mention this writer. Classification: **new**.

## 11. Scope

One column write.

## 12. Out of scope

Retiring the fallback path.

## 13. Proposed fix boundary

Write `records_rejected = 0` and keep the planning count in `validation_result`.

## 14. Proposed validation

A unit or integration assertion on the batch row.

## 15. Decisions / unresolved questions

Whether the fallback path should simply be retired. Operator.

## 16. Next action

None. Resolved (§18). The retirement question (§15) waits for an operator decision and is not a gate.

## 17. Implementation record (2026-10-15)

- **Commits:** `03fb5bcd703040dfd7a3eefcda1987f54f7b1e94` (fix) and `074667eb1ca6a095f09701f290c0ade81d56bce5` (test), on `sonnet/issue-296`, base `981ba5a1`. Single agent, no subagents.
- **Shape (§13).** In `writeMatches` (`src/lib/external-afl/current-season-import.ts`) the closing `UPDATE import_batches` now sets `records_rejected = 0`, with a comment citing migration 001 and ISSUE-244 F008. The planning count (`canonicalPlan.rejectedOrConflicted`) is unchanged in `validation_result` and in the function's return value, so the CLI and admin reports still show it. The importer writes no `import_rejections` row (no such statement exists in the file), so 0 is the value the contract requires. This is the same treatment `src/lib/acquisition/lineup-store.ts` already gives its batch.
- **Not changed.** The retire-or-fix question (§15) is not decided or affected: the path still exists and is now consistent. Existing `import_batches` rows written by this tool before the fix keep their non-zero `records_rejected`; no historical row was inspected or repaired.

## 17.1 Validation (2026-10-15, assistant-run on the owner's explicit authorisation; Windows, DB-free)

- New case: one, in the existing `describe('current-season external source import contracts')` of `tests/current-season-import.test.ts` (the suite that already holds the importer's source-contract assertions): the importer contains no `INSERT INTO`, `UPDATE` or `DELETE FROM` of `import_rejections`; has exactly one `UPDATE import_batches`; every `records_rejected =` assignment in the file is the literal `0`; and that statement's `validation_result` still carries `rejectedOrConflicted: canonicalPlan.rejectedOrConflicted`.
- Result: `tests/current-season-import.test.ts` **357 passed, 1 failed (358)**. The failure is `AFLDB-ISSUE-122 S6 ... the derived recompute wiring (§13) > reuses the four player-derived helpers, in the admin order, once, gated on a write` (`recomputeSeasonMetadata(tx, bundle.season)` not found in the sliced block of `settle-afltables.ts`), **identical on unchanged `main`** `981ba5a1` (356 passed, 1 failed; raw `D:\tmp\issue296\baseline-main.txt`), unrelated and untouched. The new case alone: 1 passed. `npx tsc --noEmit` exit 0, `npx eslint` of both files exit 0, `git diff --check` exit 0.
- **Against the pre-fix source** (mutant M1 below is the pre-fix line): the new case fails.

## 17.2 Mutation checks of the test (2026-10-15, assistant-run; Windows, DB-free)

Each mutant changes the real source, is applied alone and restored from the saved bytes (diff verified afterwards); only the `ISSUE-296` case is run. Script and raw output: `D:\tmp\issue296\mutate.py`, `mutation.txt`.

| Mutant | Result |
|---|---|
| M1 revert to `${canonicalPlan.rejectedOrConflicted}` (the pre-fix line) | killed |
| M2 literal `1` | killed |
| M3 `${observationsStaged}` | killed |
| M4 `rejectedOrConflicted` dropped from `validation_result` | killed |
| M5 an `INSERT INTO import_rejections` added to the file | killed |
| M6 a second `UPDATE import_batches` added | killed |

6 of 6 killed.

## 17.3 Limits

Not deployed. The assertion is a **source contract on the SQL text**, the established unit style of this importer's suite and of the F008 assertions in `tests/afl-api-ingestion-safety.test.ts`; it is not an assertion on a real `import_batches` row. `writeMatches` is private and needs a database, so it was not executed: no PostgreSQL, integration, browser, network-acquisition, DEV or PROD action. The 0 is established from the column contract and from the absence of any rejection-row write in the file, by reading.

## 18. Readiness, merge and closure (2026-10-15)

- **Readiness: accepted under a scoped cleanliness exception, not a clean pass.** `npm run preflight -- --mode implementation --issue 296`: READY (0 blockers, 3 warnings: `.env`, `psql`, `pg_restore`; raw `D:\tmp\issue296\preflight-impl-raw.txt`). `npm run merge:ready -- --issue 296` with eight `--expected-file` rules (raw output, unchanged: `D:\tmp\issue296\merge-ready-raw-1.txt`, sha-256 `fb0242a4a29787050b8123394e3da318449a9e90fb9f1f20a4858b141080ec6d`): every check PASS (branch, clean issue worktree, `main` equals recorded `origin/main`, ahead 3 / behind 0, migration parity, declared scope 4 changed / 0 unexpected) except **one blocker, "main worktree is clean"**; one warning (no runbook readiness block); database parity not checked. The raw output ends `Merge readiness: BLOCKED (1 blocker(s), 1 warning(s))`.
- **Exception (fresh, this issue only).** The owner authorised an exception for ISSUE-296, covering only that clean-tree FAIL under the exact **18**-path primary state: the nine `.agents/skills` files, the seven zero-byte stray-named files (`0)`, ``20` ``, ``` `path ```, `i`, `q(sequenceValueSql(qname))))[0]`, `t.kind`, `void`), the literal `$null)` and the zero-byte `2000)`. No earlier ratification was reused. The path set, no tracked or staged change, and full content hashes were verified by `D:\tmp\issue296\exception-check.py` (an adaptation of the ISSUE-305 script): `precheck-1` and `premerge-1` before, and `postmerge-1` after, the first push, all RESULT OK. The nine skill files equal the 13 Oct manifests; the seven zero-byte files and `2000)` are regular, 0 bytes, sha-256 `e3b0c442...b855`; `$null)` is 143 bytes, mtime 2026-10-14 20:00:49 (not rewritten this session), full sha-256 `d9edb1467a9ddecc7ca89424e5b5597f3c6fae7e5e41b49bb279aa1f71f62500`, captured fresh at `precheck-1` and identical at every later check. This is current equality, not continuous preservation. No additional path or changed content appeared.
- **Merge.** Fresh `git fetch` and `git ls-remote` showed `main` at `981ba5a1` immediately before the merge. `03fb5bcd`, `074667eb` and the records commit `10548157` fast-forwarded onto `main` and were pushed (`981ba5a1..10548157`); local `main`, the fetched `origin/main` and `git ls-remote origin refs/heads/main` all equalled `10548157` afterwards.
- **Resolution.** Resolved on the push of the documentation-only closure commit, under §14: its one item (a unit assertion on the batch's `records_rejected` write) is met by §17.1 as a source-contract assertion, with 6 of 6 mutants killed (§17.2). §15's question (retire the fallback path) is an operator decision that the fix neither answers nor needs; it does not gate closure. The closure scope is **merge-scoped**: code on `main`, DB-free validated, **not deployed**.
- **Preserved limits.** Not deployed. The assertion is on the SQL text, not on a live `import_batches` row, and `writeMatches` was not executed: no PostgreSQL, integration, browser, network-acquisition, DEV or PROD action. Existing batch rows written by this tool keep their earlier `records_rejected`; none was inspected or repaired. One pre-existing unrelated failure in `tests/current-season-import.test.ts` (ISSUE-122 S6 derived-helper wiring) is untouched and identical on unchanged `main`.
