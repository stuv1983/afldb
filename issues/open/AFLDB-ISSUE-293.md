# AFLDB-ISSUE-293 — Settle runs under-report `dataIssuesResolved`

## 0. Status

- **Status:** Open (2026-10-08). Implemented and validated on `afldb_test` 2026-10-15 with ISSUE-294 (§17); not deployed.
- **Severity:** Low. **Area:** acquisition / settle run accounting.
- **Key files:** `src/lib/acquisition/settle-afltables.ts`, `src/lib/acquisition/settle-afl-api.ts`.
- **Origin:** full code review at `20a7a4bbdea835cdd3fc5520e65ad47d275bd881` (`issues/reviews/2026-10-08-full-code-review.md`, F-028; partition note R4a-F03).
- **Classification:** code-proven.

## 1. Summary

- The AFL Tables run sums healed `canonical_apply_failed` findings into `counters.dataIssuesResolved` during the run, then assigns (`=`) the end-of-run `resolveRestoredDisagreements` count, discarding the earlier sum.
- The AFL API run discards the returned counts of two resolve calls.

`import_batches.validation_result.dataIssuesResolved` and the CLI counters therefore under-report.

## 2. Evidence

- `src/lib/acquisition/settle-afltables.ts:1900` (assignment); the increments at `:3445-3455` and `:3497-3502`.
- `src/lib/acquisition/settle-afl-api.ts:1389` and `:1430-1433` (discarded); `:626` counts.
- Stamped at `settle-afltables.ts:1954` and `settle-core.ts:1215`.

## 3. Trigger

An AFL Tables run that heals an apply failure and restores no disagreement, which reports 0.

## 4. Expected invariant

Honest run counters (ISSUE-244 F008: `validation_result` is the durable record).

## 5. Actual behaviour

Healed findings are under-counted.

## 6. First wrong layer

`settle-afltables.ts:1900`; `settle-afl-api.ts:1389, :1430`.

## 7. Impact

Reporting only. The `data_issues` rows themselves are resolved correctly.

## 8. Reproduction / witness

Not executed.

## 9. Disproof attempts

The tests (`settle-afltables.test.ts:1498, :1518`; `settle-afl-api.test.ts:3072, :3197`) do not cover a mixed run.

## 10. Existing-issue search

`dataIssuesResolved` has no entry. Classification: **new**.

## 11. Scope

The three counter sites.

## 12. Out of scope

The other counters (AFLDB-ISSUE-294).

## 13. Proposed fix boundary

`+=` at all three sites.

## 14. Proposed validation

Integration: after an apply-failure heal, assert `dataIssuesResolved === 1`.

## 15. Decisions / unresolved questions

None.

## 16. Next action

~~Implementation (trivial).~~ Superseded by §17.

## 17. Implementation and validation (2026-10-15)

### 17.1 Change

- `src/lib/acquisition/settle-afltables.ts`: the end-of-run restored-disagreement count is added to `counters.dataIssuesResolved` (`+=`) instead of assigned, so the healed `canonical_apply_failed` findings summed during the run are kept.
- `src/lib/acquisition/settle-afl-api.ts`: the counts returned by the three `resolveRestoredDisagreements` calls that were discarded are added to `counters.dataIssuesResolved`: the match-score disagreement restored on the corroborated path, the venue-identity finding restored when the venue resolves, and the period-scores contradiction (the shared helper `resolvePeriodScoresFindingOnPositiveEvidence` now takes the counters and is called from the corroborated and the planned branch). The runbook, written against the review commit, names two discarded calls at `:1389` and `:1430-1433`; those line numbers had moved and the current code has the three sites above.
- Only the counting changed: which findings are resolved, and when, is untouched. No migration.

### 17.2 Tests

- `tests/integration/settle-afltables.test.ts`: a new case in the ISSUE-131 block. A rekey refused for `rekey_override_conflict` opens a finding (`dataIssuesResolved` 0); the conflicting decision is removed and the same observation is applied again: the rekey proceeds, the finding is closed and `dataIssuesResolved` is 1 (it was 0, the heal's `+=` overwritten by the final assignment). Three observation times were added to `T122`.
- `tests/integration/settle-afl-api.test.ts`: the venue self-heal case asserts `dataIssuesResolved` 1 on the healing run; a new `§19.1 (AFLDB-ISSUE-293)` case on the previously unused `corroborateDisagree` id: a foreign-owned match whose score disagrees opens one finding (`dataIssuesOpened` 1, resolved 0), and after the owner is corrected the same observation closes it with `source_agreement_restored` and `dataIssuesResolved` 1.
- `tests/integration/settle-afl-api-issue276.test.ts`: the three runs that close the period-scores finding now assert the count (1, 2 and 1). The second closes two findings in one run, pinned by name: the match-identity refusal the blocked run had opened (resolution `match_identity_resolved`) and the period-scores contradiction (`source_agreement_restored`); the first-written expectation of 1 was wrong and was corrected after the run showed which two close.

### 17.3 Results

- **Authority.** `D:\tmp\issue293-294\run-int.mjs` (the ISSUE-282 launcher, with extra vitest arguments passed through) derived the owner, importer and auth DSNs in memory from the primary `.env`, pointed them at `afldb_test` on tunnel port 55432 and proved `current_database() = afldb_test` for each (`afldb_owner`, `afldb_import`, `afldb_auth`) before vitest started. No credential was printed or written. Only the suites' own namespaced fixtures were written, through their own setup and cleanup. No `afldb_dev`, PROD, migration, rebuild, restore, truncation or repair. The files' vitest `beforeAll` hooks run over the tunnel, so the runs pass `--hookTimeout=900000 --testTimeout=300000`.
- **Fixture census.** A read-only census (`D:\tmp\issue293-294\census.mjs`: import batches, data issues, matches, seasons, source records, candidates, applications, rejections, overrides, players and lineup rows for the four suites' namespaces) read the same before the first run and after every run, baseline run and mutant: 12 import batches (all `settle-afltables.ts`, snapshot `issue122-s6-cli`, 3 Oct 2026, ids 66-68, 325-327, 543-545, 639-641), which pre-date this work and were left untouched, and 0 everywhere else.
- **Season-2026 derived rows (disclosure).** The AFL API suites' own baseline step recomputes season 2026's derived rows on `afldb_test`. `club_seasons` for 2026 holds two rows (clubs 3 and 13, one played, 80-100) that no 2026 match supports (the table has no 2026 matches); the first fingerprint taken here was of the whole row including its id and differed after the first run, which is what a delete-and-reinsert of the same values does. From the run that followed, the fingerprint excludes `id` and read identically; the contents of the rows before the first run were not captured, so "same values" is the inference, not a recorded fact. The `seasons` row and the 2026 player and match counts were identical throughout.

- **Fixed code.** `settle-afltables` (the `the transaction against PostgreSQL` block plus the new case): **21 passed**, 62 skipped. `settle-afl-api` (`AFLDB-ISSUE-293|I244-F003 §11.4`): **2 passed**, 71 skipped. `settle-afl-api-issue276`, whole file: **4 passed**. DB-free `afl-api-ingestion-safety`, `admin-current-season-settle`, `settle-season-revalidation` and `afl-api-match`: 508 passed.
- **Unfixed source** (`git checkout HEAD -- src/`, the fixed files copied back and sha-256 verified): the heal case fails; both AFL API cases fail; three of the four ISSUE-276 cases fail.
- **Mutants** (`D:\tmp\issue293-294\mutate.mjs`, one at a time, original bytes restored and hash-verified after each): the final AFL Tables count assigned instead of added (X1), and each of the three AFL API counts discarded again (X4 venue, X5 score, X6 period scores). **All 4 killed.**
- **Static.** `tsc --noEmit` exit 0; `git diff --check` exit 0. ESLint of the nine changed files exits 1 with 20 problems (19 errors, 1 warning), the identical set on unchanged `main` (compared by rule and message): none introduced.

### 17.4 Limits

- Not deployed; no browser, DEV or PROD action. Earlier runs' `validation_result` and CLI counters stay under-reported; nothing is repaired. The files were run by filter, not whole: the AFL Tables file's S6 CLI block (which commits and removes its own batches) was not run, and the AFL API file ran only the two cases above. A mixed AFL Tables run (a heal plus a restored disagreement in one apply) is covered by the heal case alone plus the existing restore case, not by one run that does both.
