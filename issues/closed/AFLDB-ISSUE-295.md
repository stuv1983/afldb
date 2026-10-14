# AFLDB-ISSUE-295 — Settle exception report mixes both sources' apply-failure findings

## 0. Status

- **Status:** **Resolved (2026-10-15, merge-scoped; opened 2026-10-08).** Implemented and merged as `dba8b2d0` (fix, tests and records), validated on `afldb_test` (§17), merged and pushed (§18). **Not deployed.**
- **Severity:** Low. **Area:** acquisition / settle reporting.
- **Key file:** `src/lib/acquisition/settle-report.ts`.
- **Origin:** full code review at `20a7a4bbdea835cdd3fc5520e65ad47d275bd881` (`issues/reviews/2026-10-08-full-code-review.md`, F-030; partition note R4a-F05).
- **Classification:** code-proven.

## 1. Summary

The "`<sourceKey>` settle exceptions" section lists open `canonical_apply_failed` findings filtered by type and owner only, never by `details->>'source_key'`. The AFL API report therefore shows AFL Tables failures as its own, and vice versa. AFL API's per-run refusal findings can push AFL Tables' own failures past the 20-row cut.

## 2. Evidence

- `src/lib/acquisition/settle-report.ts:355-365` (`openFindingsOf`), `:401` (the `sourceKey` parameter), `:421` (the call), and `:152, :364-369` (`OPEN_FINDING_LIMIT = 20`).
- Every writer stamps `source_key`: `settle-afltables.ts:2570, :2627`; `settle-afl-api.ts:1160`; `settle-core.ts:806`.
- `settle-afl-api.ts:1073-1077` states the keys are source-scoped.

## 3. Trigger

Open findings of both sources exist when either report is rendered (`tools/current-season/settle-afl-api.ts:265-271, :362-369`).

## 4. Expected invariant

Each source's report lists only its own findings.

## 5. Actual behaviour

The findings are mixed, and a source's own failures can be hidden behind "… more than 20 open".

## 6. First wrong layer

`src/lib/acquisition/settle-report.ts:421`.

## 7. Impact

Operator misdiagnosis. Reporting only.

## 8. Reproduction / witness

Not executed.

## 9. Disproof attempts

The disagreement section is scoped correctly; only the apply-failure section is shared. The tests (`current-season-import.test.ts:5438, :5479`) do not assert scoping.

## 10. Existing-issue search

ISSUE-228 "known-gap-B" covered the disagreement pair only. Classification: **new**.

## 11. Scope

One query predicate.

## 12. Out of scope

The data_issues lifecycle.

## 13. Proposed fix boundary

Add `AND d.details->>'source_key' = ${sourceKey}`.

## 14. Proposed validation

Integration: open one finding per source and assert each report lists only its own.

## 15. Decisions / unresolved questions

None.

## 16. Next action

~~Implementation (trivial).~~ Superseded by §17.

## 17. Implementation and validation (2026-10-15)

### 17.1 Change

- `src/lib/acquisition/settle-report.ts`: `openFindingsOf` takes an optional `sourceKey` and adds `AND (sourceKey IS NULL OR details->>'source_key' = sourceKey)`. `buildSettleExceptionReport` passes its `sourceKey` for the apply-failure section, so each source's report lists only the `canonical_apply_failed` findings that source wrote and the 20-row cut applies to those. The disagreement section is unchanged (its issue type already differs per source). Every writer of the apply-failure type stamps `details.source_key` (AFL Tables' failure and rekey-refusal findings, and the AFL API settle through its apply-finding scope); AFL Tables has stamped it since the finding type was introduced.
- No migration, no write path, no change to the rendering.

### 17.2 Tests

- `tests/integration/settle-afltables.test.ts`: a new top-level block `AFLDB-ISSUE-295`, two cases on `afldb_test`. Open `canonical_apply_failed` rows are inserted directly under a private `issue295-` key prefix, because the report is a read and what it is proved against is the rows it reads. (1) One finding per source: the AFL Tables report lists its own and not the AFL API one, and the AFL API report the reverse. (2) Twenty-one AFL API findings plus one AFL Tables finding: the AFL Tables report still lists its own (an unscoped report was filled to its 20-row cut by the AFL API rows, which sort first, and hid it), and the AFL API report lists only AFL API rows and reports itself truncated. The block purges its own rows before and after.

### 17.3 Results

- **Authority.** `D:\tmp\issue295\run-int.mjs` (the ISSUE-282 launcher, with extra vitest arguments passed through) derived the owner, importer and auth DSNs in memory from the primary `.env`, pointed them at `afldb_test` on tunnel port 55432 and proved `current_database() = afldb_test` for each before vitest started. No credential was printed or written. Only the block's own `data_issues` rows were written and removed. No `afldb_dev`, PROD, migration, rebuild, restore, truncation or repair.
- **Fixed code.** Filter `AFLDB-ISSUE-295`: **2 passed**, 83 skipped. DB-free `current-season-import`, `settle-season-revalidation` and `admin-current-season-settle`: 485 passed, 1 failed (`reuses the four player-derived helpers`, the ISSUE-122 S6 derived-helper wiring, identical on unchanged `main`).
- **Unfixed source** (`git checkout HEAD -- src/`, the fixed file copied back and sha-256 verified): both cases fail.
- **Mutants** (`D:\tmp\issue295\mutate.mjs`, original bytes restored and hash-verified after each): the predicate removed (Y1), inverted (Y2), the key not passed (Y3), and a fixed key passed (Y4). **All 4 killed.**
- **Fixture census.** The same read-only census as ISSUE-293/294 (extended with the `issue295-` prefix) read identically before and after every run, baseline and mutant: 12 pre-existing S6 CLI batches (3 Oct 2026, untouched), 0 everywhere else.
- **Static.** `tsc --noEmit` exit 0; ESLint of the two changed files exit 0 (and 0 on unchanged `main`); `git diff --check` exit 0.

### 17.4 Limits

- Not deployed; no browser, DEV or PROD action. A finding written by a writer that stamped no `source_key` would now be excluded from both reports; no current writer does so. The report CLI itself and the rendered text were not run; only the report builder was exercised against real rows. The file was run by filter, not whole.

## 18. Readiness, merge and closure (2026-10-15)

- **Readiness: accepted under a scoped cleanliness exception, not a clean pass.** `npm run preflight -- --mode implementation --issue 295` on the committed worktree: READY (0 blockers, 3 warnings: `.env`, `psql`, `pg_restore`; raw `D:\tmp\issue295\preflight-1.txt`). `npm run merge:ready -- --issue 295` (raw, unchanged: `D:\tmp\issue295\merge-ready-raw-1.txt`): BLOCKED by exactly one blocker, the primary worktree not clean; every other check PASSed, with two metadata warnings (no runbook readiness JSON block; no automated unexpected-file classification). The five committed paths were compared with the declared scope by hand: `settle-report.ts`, the AFL Tables integration test, this runbook, `issues.md` and `IssuesIndex.md`.
- **Exception (fresh, this issue only).** The owner authorised an exception covering only that clean-tree FAIL under the exact **18**-path primary state: the nine `.agents/skills` files, the seven zero-byte stray-named files (`0)`, ``20` ``, ``` `path ```, `i`, `q(sequenceValueSql(qname))))[0]`, `t.kind`, `void`), the literal `$null)` and the zero-byte `2000)`. Immediately before the merge a script verified the 18 paths, their full sha-256 hashes (`$null)` `d9edb146…2500`, unchanged since the session start), no tracked and no staged primary change, and that fresh `main`, `origin/main` and the live remote agreed (`premerge-1.txt`); it read OK again after the push (`postmerge-1.txt`).
- **Merge.** `dba8b2d0` fast-forwarded onto `main` and was pushed (`2e3c050f..dba8b2d0`); local `main` and `git ls-remote origin refs/heads/main` both equalled `dba8b2d0` afterwards.
- **Resolution.** Resolved on the push of the documentation-only closure commit. §14 asks for an integration case that opens one finding per source and asserts each report lists only its own; it exists and passes on `afldb_test` (§17.2, §17.3), with the cut-hiding case added. The closure scope is **merge-scoped**: code on `main`, validated on `afldb_test`, **not deployed**.
- **Preserved limits.** Not deployed. No browser, DEV or PROD action. The report CLI and its rendered text were not run; only the report builder was exercised against real rows. The test file was run by filter, not whole.
