# AFLDB-ISSUE-294 — AFL Tables, lineup and fallback import batches record `completed_at = started_at` and no inserted count

## 0. Status

- **Status:** **Resolved (2026-10-15, merge-scoped; opened 2026-10-08).** Implemented and merged as `8e49a9da` with ISSUE-293 (fix, tests and records), validated on `afldb_test` (§17), merged and pushed (§18). **Not deployed.**
- **Severity:** Low. **Area:** acquisition / import batch accounting.
- **Key files:** `src/lib/acquisition/settle-afltables.ts`, `src/lib/acquisition/lineup-store.ts`, `src/lib/external-afl/current-season-import.ts`.
- **Origin:** full code review at `20a7a4bbdea835cdd3fc5520e65ad47d275bd881` (`issues/reviews/2026-10-08-full-code-review.md`, F-029; partition note R4a-F04).
- **Classification:** code-proven.

## 1. Summary

The AFL Tables settle closes its batch with `completed_at = now()` inside the run transaction. `now()` is the transaction start instant, so it equals `started_at`. It also leaves `records_inserted` / `records_updated` at their default 0, although `versionsAppended` is the defined value. `settle-core.ts` fixed both for AFL API (`clock_timestamp()`, explicit counts). The lineup store and the deprecated fallback importer use the same `now()`.

## 2. Evidence

- `src/lib/acquisition/settle-afltables.ts:1950-1956`.
- `src/db/migrations/001_foundations.sql:59, :63-64` (`started_at DEFAULT now()`, count defaults).
- `src/lib/acquisition/settle-core.ts:1140-1142, :1196-1198, :1211` (the AFL API fix).
- `src/lib/acquisition/lineup-store.ts:482-490` and `src/lib/external-afl/current-season-import.ts:848-850`.
- Shown to operators in `src/app/admin/current-season/SettleRunPanel.tsx:230`.

## 3. Trigger

Every AFL Tables settle, lineup persist or fallback refresh.

## 4. Expected invariant

`completed_at` is the real completion instant, and the record counts are honest.

## 5. Actual behaviour

Completion time equals start time; the admin panel shows the start as the completion. The inserted count is 0.

## 6. First wrong layer

`settle-afltables.ts:1950-1956` (and the two sibling writers).

## 7. Impact

Reporting and operations only. Run durations cannot be measured from the ledger: `issues/closed/AFLDB-ISSUE-265.md:769-772` recorded this as an evidence limitation of the 265 overlap analysis.

## 8. Reproduction / witness

Not executed.

## 9. Disproof attempts

PostgreSQL `now()` is transaction-start time by definition.

## 10. Existing-issue search

Recorded as an observation in the ISSUE-265 runbook only, with no tracked fix. Classification: **new** as a tracked defect.

## 11. Scope

The three batch-closing writers.

## 12. Out of scope

The legacy CSV promotion counts (AFLDB-ISSUE-307) and the fallback `records_rejected` (AFLDB-ISSUE-296).

## 13. Proposed fix boundary

Route the AFL Tables close through `finalizeSettleImportBatch`, or use `clock_timestamp()` plus `records_inserted = versionsAppended`. Make the same change in the other two writers.

## 14. Proposed validation

Integration: after an apply, `completed_at > started_at` and `records_inserted = counters.versionsAppended`.

## 15. Decisions / unresolved questions

None.

## 16. Next action

~~Implementation.~~ Superseded by §17.

## 17. Implementation and validation (2026-10-15)

### 17.1 Change

- `src/lib/acquisition/settle-afltables.ts`: the batch close sets `completed_at = clock_timestamp()` (the transaction-start `now()` equalled `started_at`), `records_inserted = counters.versionsAppended` and `records_updated = 0`. `staging.source_record_versions` is append-only, so an unchanged replay is neither an insert nor an update, the same reading `finalizeSettleImportBatch` applies to AFL API.
- `src/lib/acquisition/lineup-store.ts` and `src/lib/external-afl/current-season-import.ts`: `completed_at = clock_timestamp()`. Both already wrote their record counts (projections inserted and updated; observation versions inserted and heads refreshed), so the runbook title's "no inserted count" applied to the AFL Tables settle only; the counts of the other two are unchanged.
- No migration; existing batch rows are not repaired. The legacy CSV promotion batch in `src/lib/ingest/pipeline.ts` also closes with `now()` and is deliberately left alone: ISSUE-307 owns that writer.

### 17.2 Tests

- `tests/integration/settle-afltables.test.ts`: the first apply case now also reads `records_inserted`, `records_updated` and `completed_at > started_at` from the batch it closed: inserted equals `versionsAppended` (greater than 0), updated is 0, and the completion instant is later than the start.
- `tests/integration/afl-api-lineup-store.test.ts`: the batch case asserts `completed_at > started_at`.
- `tests/current-season-import.test.ts` (DB-free): a source-contract case that the fallback importer, the lineup store and the AFL Tables settle each close their batch with `clock_timestamp()` and never `now()`, and that the settle records `versionsAppended`. The fallback importer's `writeMatches` needs a live source, so its close is proved by its SQL text only (as ISSUE-296 was); the other two are also proved against PostgreSQL.

### 17.3 Results

- **Authority.** `D:\tmp\issue293-294\run-int.mjs` (the ISSUE-282 launcher, with extra vitest arguments passed through) derived the owner, importer and auth DSNs in memory from the primary `.env`, pointed them at `afldb_test` on tunnel port 55432 and proved `current_database() = afldb_test` for each (`afldb_owner`, `afldb_import`, `afldb_auth`) before vitest started. No credential was printed or written. Only the suites' own namespaced fixtures were written, through their own setup and cleanup. No `afldb_dev`, PROD, migration, rebuild, restore, truncation or repair. The files' vitest `beforeAll` hooks run over the tunnel, so the runs pass `--hookTimeout=900000 --testTimeout=300000`.
- **Fixture census.** A read-only census (`D:\tmp\issue293-294\census.mjs`: import batches, data issues, matches, seasons, source records, candidates, applications, rejections, overrides, players and lineup rows for the four suites' namespaces) read the same before the first run and after every run, baseline run and mutant: 12 import batches (all `settle-afltables.ts`, snapshot `issue122-s6-cli`, 3 Oct 2026, ids 66-68, 325-327, 543-545, 639-641), which pre-date this work and were left untouched, and 0 everywhere else.
- **Season-2026 derived rows (disclosure).** The AFL API suites' own baseline step recomputes season 2026's derived rows on `afldb_test`. `club_seasons` for 2026 holds two rows (clubs 3 and 13, one played, 80-100) that no 2026 match supports (the table has no 2026 matches); the first fingerprint taken here was of the whole row including its id and differed after the first run, which is what a delete-and-reinsert of the same values does. From the run that followed, the fingerprint excludes `id` and read identically; the contents of the rows before the first run were not captured, so "same values" is the inference, not a recorded fact. The `seasons` row and the 2026 player and match counts were identical throughout.

- **Fixed code.** `settle-afltables` (the `the transaction against PostgreSQL` block plus ISSUE-293's case): **21 passed**, 62 skipped. `afl-api-lineup-store`, whole file: **11 passed**. DB-free `current-season-import`: **358 passed**, 1 failed (`reuses the four player-derived helpers`, the ISSUE-122 S6 derived-helper wiring, identical on unchanged `main`).
- **Unfixed source:** the AFL Tables batch assertions fail, the lineup case fails and the new DB-free case fails.
- **Mutants** (`D:\tmp\issue293-294\mutate.mjs`, original bytes restored and hash-verified after each): `now()` in the AFL Tables close (X2, integration; X9, DB-free), no inserted count (X3 integration; X10 DB-free), `now()` in the lineup store (X7 integration; X7b DB-free) and in the fallback importer (X8, DB-free). **All 7 killed.**
- **Static.** `tsc --noEmit` exit 0; `git diff --check` exit 0; ESLint of the changed files reports the same 20 problems as unchanged `main` and none new.

### 17.4 Limits

- Not deployed; no browser, DEV or PROD action. The fallback importer's close is proved by source text, not by a live batch row. Earlier batches keep `completed_at = started_at`; nothing is repaired. Operators will see real completion times only for batches closed after deployment. The AFL Tables file's S6 CLI block was not run.

## 18. Readiness, merge and closure (2026-10-15)

- **Readiness: accepted under a scoped cleanliness exception, not a clean pass.** ISSUE-294 was implemented, tested, committed and merged together with ISSUE-293 (shared files and harness); readiness was run once for the group, as `--issue 293`. `npm run preflight -- --mode implementation --issue 293` on the committed worktree: READY (0 blockers, 3 warnings: `.env`, `psql`, `pg_restore`; raw `D:\tmp\issue293-294\preflight-1.txt`). `npm run merge:ready -- --issue 293` (raw, unchanged: `D:\tmp\issue293-294\merge-ready-raw-1.txt`): BLOCKED by exactly one blocker, the primary worktree not clean; every other check PASSed, with two metadata warnings (no runbook readiness JSON block; no automated unexpected-file classification). The thirteen committed paths were compared with the declared scope by hand: four source files, five test files, the two runbooks, `issues.md` and `IssuesIndex.md`.
- **Exception (fresh, for this group only).** The owner authorised an exception covering only that clean-tree FAIL under the exact **18**-path primary state: the nine `.agents/skills` files, the seven zero-byte stray-named files (`0)`, ``20` ``, ``` `path ```, `i`, `q(sequenceValueSql(qname))))[0]`, `t.kind`, `void`), the literal `$null)` and the zero-byte `2000)`. Immediately before the merge a script verified the 18 paths, their full sha-256 hashes (`$null)` `d9edb146…2500`, unchanged since the session start), no tracked and no staged primary change, and that fresh `main`, `origin/main` and the live remote agreed (`premerge-1.txt`); it read OK again after the push (`postmerge-1.txt`).
- **Merge.** `8e49a9da` fast-forwarded onto `main` and was pushed (`359d403c..8e49a9da`); local `main` and `git ls-remote origin refs/heads/main` both equalled `8e49a9da` afterwards.
- **Resolution.** Resolved on the push of the documentation-only closure commit. §14 asks for an integration assertion after an apply that `completed_at > started_at` and `records_inserted = counters.versionsAppended`; it exists for the AFL Tables settle, the lineup store is asserted for the completion instant, and the fallback importer is covered by its SQL text (§17.2, §17.3). The closure scope is **merge-scoped**: code on `main`, validated on `afldb_test`, **not deployed**.
- **Preserved limits.** Not deployed. No browser, DEV or PROD action. The fallback importer's close is proved by source text, not by a live batch row. Batches closed before deployment keep `completed_at = started_at`; nothing is repaired. The legacy CSV promotion batch (ISSUE-307) is unchanged. The test files were run by filter, not whole.
