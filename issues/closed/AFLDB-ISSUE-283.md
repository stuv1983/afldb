# AFLDB-ISSUE-283 — The administrative note is not recorded on creation audit rows

## 0. Status

- **Status:** **Resolved (2026-10-15, merge-scoped; opened 2026-10-08).** Implemented and merged as `f0a0c917` (fix, tests and records), validated on `afldb_test` (§17), merged and pushed (§18). **Not deployed.**
- **Severity:** Low. **Area:** admin awards and special records / audit trail.
- **Key files:** `src/app/admin/awards/actions.ts`, `src/db/queries/admin-awards.ts`, `src/db/queries/admin-special-records.ts`.
- **Origin:** full code review at `20a7a4bbdea835cdd3fc5520e65ad47d275bd881` (`issues/reviews/2026-10-08-full-code-review.md`, F-018; partition notes R2a-F02 and R2c-F03, grouped: the same field is dropped on the creation half of each write).
- **Classification:** code-proven.

## 1. Summary

The awards create forms offer an "Administrative note (kept with the audit entry)", and the replace panels promise the note is "kept with both audit entries". In practice:

- the three award create actions never read `adminNote`, and the creation `data_edits.note` is written from the row's public citation or biography field;
- in every replace (three award families and two special-record families) the admin note reaches only the voided or suppressed row's audit entry; the created row's entry carries the row's own notes.

## 2. Evidence

- Award create actions ignore `adminNote`: `src/app/admin/awards/actions.ts:302-319`, `:496-513`, `:668-685`.
- Creation audit writes the row note: `admin-awards.ts:1538` (`note: input.note`), `:2092` (`note: input.notes`, the inductee biography) and `:2627`.
- Replace inserts spread `...input.replacement` without the admin note: `admin-awards.ts:1639-1644`, `:2171-2176`, `:2696-2701`; `admin-special-records.ts:1633-1638`, `:2192-2197`. The creation audit uses `input.notes` (`admin-special-records.ts:1546`, `:2125`).
- Promises in the UI: `AwardWinnerForm.tsx:82-85`, `HallOfFameForm.tsx:54-57`, `HonourTeamForm.tsx:56-59`, `ReplacePanel.tsx:196-199`, `SpecialRecordReplacePanel.tsx:174-177`.

## 3. Trigger

Create an award, Hall of Fame or honour-team record with an administrative note. Or replace any of the five record families with one.

## 4. Expected invariant

The admin note is recorded on the creation audit entry, and on both halves of a replacement, as correct/void/reinstate already do (`awards/actions.ts:202, :225, :246`).

## 5. Actual behaviour

The note is dropped, or recorded on one half only. `data_edits.note` holds public record text instead.

## 6. First wrong layer

`awards/actions.ts:302-319, :496-513, :668-685` (create), and the replace call sites listed above.

## 7. Impact

The audit trail is incomplete or wrong for every manual creation and for half of every replacement. The mutations themselves are correct.

## 8. Reproduction / witness

Not executed (DB-backed).

## 9. Disproof attempts

- No other reader of `adminNote` exists.
- `recordDataEdit` has a single `note` channel.

## 10. Existing-issue search

The ISSUE-165 and ISSUE-167 runbooks and `issues.md` were searched for `adminNote`. The only hit is club leadership, which is unrelated. Classification: **new**.

## 11. Scope

The note plumbing in the create and replace paths.

## 12. Out of scope

Special-record create, which deliberately has no admin-note field.

## 13. Proposed fix boundary

Carry a distinct `adminNote` into the insert functions and use it for `recordDataEdit.note`, keeping the row note in `newValues`.

## 14. Proposed validation

Integration: create and replace with a note, then assert `data_edits.note` for the new row.

## 15. Decisions / unresolved questions

None.

## 16. Next action

~~Implementation, grouped with AFLDB-ISSUE-282.~~ Superseded by §17. ISSUE-282 (the revalidation paths) was resolved separately on 2026-10-15 and did not change the audit-note plumbing.

## 17. Implementation and validation (2026-10-15)

### 17.1 Change

- `src/db/queries/admin-awards.ts`: `CreateAwardWinnerInput`, `CreateHallOfFameInput` and `CreateHonourTeamMemberInput` gain an optional `adminNote`. `insertAwardWinner`, `insertHallOfFame` and `insertHonourTeamMember` record `input.adminNote` as the creation audit entry's `data_edits.note`; the row's own citation / biography / selection note stays in the entry's `new_values` and in the row. `replaceAwardWinner`, `replaceHallOfFameInductee` and `replaceHonourTeamMember` hand their `input.note` (the administrator's note, which already reached the voided half) to the insert as `adminNote`, placed after the `...input.replacement` spread so a replacement object cannot override it.
- `src/app/admin/awards/actions.ts`: the three create actions read the form's `adminNote` (2000 characters, as correct / void / reinstate already do) and pass it as `adminNote`. The replace actions already forwarded it as `note` and are unchanged.
- `src/db/queries/admin-special-records.ts`: `insertFirstKickGoal` and `insertAfterSirenKick` take an optional `adminNote`; the two replace functions pass `input.note ?? null`. When `adminNote` is absent (a plain create, which deliberately has no admin-note field, §12) the audit note stays the row's own `notes`, so special-record create is unchanged.
- **Behaviour change to note:** an award, Hall of Fame or honour-team create made without an administrative note now writes no audit note (it used to write the row's public text there); a special-record replacement made without a note likewise. The public text is not lost: it remains in the entry's `new_values` and in the row. No migration, no change to the forms or the allowlists.

### 17.2 Tests

- `tests/integration/admin-awards.test.ts`: a new `the administrative note is recorded on creation audit rows (ISSUE-283)` block, 7 cases on `afldb_test`: create with a note for each of the three families (the audit note is the admin note, `new_values` keeps the row note), a create without a note (audit note empty, not the row note), and a replacement for each family (both the voided and the created entry carry the admin note; the created `new_values` keeps the row note and the shared `replacement_id`). A small `auditEntries` helper reads the `note` column that `auditRows` leaves out.
- `tests/integration/admin-special-records.test.ts`: a new `Stage 6 — the replace panel's administrative note reaches both audit halves (ISSUE-283)` block, 4 cases: first-kick and after-the-siren replacements carry the note on both halves, a replacement without a note leaves the created entry's note empty, and a plain create still records the record text (the out-of-scope boundary, pinned). `purgeStage6` now also removes audit entries that name the suite's marker, because a plain create's entry names the marker but not the source key.
- `tests/awards-replace-panel.test.ts` (DB-free; the existing action harness): 5 new cases (25 in the file): each of the three create actions forwards `adminNote` apart from the record text, a create with no note forwards none, and the three replace actions forward the note as `note` outside the `replacement`.

### 17.3 Results

- **Authority.** `D:\tmp\issue283\run-int.mjs` (the ISSUE-282 launcher, copied) derived the owner, importer and auth DSNs in memory from the primary `.env`, pointed them at `afldb_test` on tunnel port 55432 and proved `current_database() = afldb_test` for each (`afldb_owner`, `afldb_import`, `afldb_auth`) before vitest started. No credential was printed or written. Only the suites' own prefix-keyed fixtures were written. No `afldb_dev`, PROD, migration, rebuild, restore, truncation or repair. The awards file's python replay tests were not run.
- **Fixed code.** `admin-awards` filter `ISSUE-283`: **7 passed**, 35 skipped. `admin-special-records` filter `ISSUE-283`: **4 passed**, 37 skipped. DB-free `awards-replace-panel`: **25 passed**. Neighbouring non-replay integration cases that exercise the changed insert paths also pass: awards 25 passed (correction / create-path refusals / Hall of Fame / honour-team blocks plus the new block), special records 6 passed.
- **Unfixed source** (`git checkout HEAD -- src/`, the fixed files copied back and sha-256 verified): awards **7 failed**; special records **3 failed**, 1 passed (the plain-create boundary case, which the fix does not change, by design); the DB-free file **3 failed** of 25 (the three create actions) when only `actions.ts` was unfixed.
- **Mutants** (`D:\tmp\issue283\mutate283.mjs`, one at a time, original bytes restored and hash-verified after each): the creation audit note reverting to the record text in each of the three award families (3) and the two special-record inserts (2), a null admin note falling back to the record text (1), each of the five replace functions not passing the note to the created half (5), each of the three create actions not forwarding the note (3), a create action reading the wrong form field (1), and each of the three replace actions not forwarding the note (3). **All 18 killed** (`mutants-summary.txt`).
- **Fixture residue, one incident.** The first run of the special-records cases left 3 `player_achievements` rows, 1 `after_siren_kicks` row and 1 `data_edits` row on `afldb_test`: those cases used record text other than the suite's marker, which `purgeStage6` matches exactly. A read-only census (`manual167` = 3) caught it; the rows were removed by id with a guarded one-off script (`cleanup-first-run.mjs`: database proved `afldb_test`, a dry run listing exactly those ids, refusal unless exactly 3 + 1 were found, one transaction deleting their audit rows and the rows: 1, 3, 1 deleted). The test text was changed to the marker and the purge extended (§17.2). A 14-selector census read 0 on every selector before the first run, and again after the corrected special-records run, the unfixed-source runs, all 18 mutants and the neighbouring runs; a further census found 0 audit rows naming either marker or the ISSUE-283 admin note. *(Evidence limits: §19, 2026-10-15.)*
- **Static.** `tsc --noEmit` exit 0; ESLint of the six changed files exit 0; `git diff --check` exit 0.
- **DB-free neighbours.** `special-records-admin`, `data-overrides-source-contract`, `admin-awards-hall-of-fame-years` and `awards-replace-panel` pass; `awards-admin.test.ts` has one failure (ISSUE-027 migration 108 grant text), the Windows line-ending baseline that ISSUE-282 §17.3 recorded as identical on unchanged `main` (not re-run on `main` here; no migration is touched).

### 17.4 Limits

- Not deployed; no browser, DEV or PROD action. The create actions are proved by the DB-free harness against a mocked query layer, and the query layer by the integration suites; no real Server Action was driven with a session and a database together. The whole integration files and the awards file's python replay tests were not run. Rows created before this change keep the audit note they were written with; nothing is repaired.

## 18. Readiness, merge and closure (2026-10-15)

- **Readiness: accepted under a scoped cleanliness exception, not a clean pass.** `npm run preflight -- --mode implementation --issue 283`: the first run, made after the edits and before the commit, was BLOCKED only by the issue worktree's own uncommitted changes (raw `D:\tmp\issue283\preflight-impl.txt`, unchanged); after the commit the same command was READY (0 blockers, 3 warnings: `.env`, `psql`, `pg_restore`; `preflight-impl-clean.txt`). `npm run merge:ready -- --issue 283` (raw, unchanged: `D:\tmp\issue283\merge-ready-raw-1.txt`): BLOCKED by exactly one blocker, the primary worktree not clean; every other check PASSed (issue worktree clean, local `main` equal to recorded `origin/main`, ahead 1 / behind 0, migration parity), with two metadata warnings (no runbook readiness JSON block; no automated unexpected-file classification). The nine committed paths were compared with the declared scope by hand: the three source files, three test files, this runbook, `issues.md` and `IssuesIndex.md`.
- **Exception (fresh, this issue only).** The owner authorised an exception covering only that clean-tree FAIL under the exact **18**-path primary state: the nine `.agents/skills` files, the seven zero-byte stray-named files (`0)`, ``20` ``, ``` `path ```, `i`, `q(sequenceValueSql(qname))))[0]`, `t.kind`, `void`), the literal `$null)` and the zero-byte `2000)`. Immediately before the merge a script verified the 18 paths, their full sha-256 hashes (`$null)` `d9edb146…2500`, unchanged since the session start), no tracked and no staged primary change (`premerge-1.txt`); it read OK again after the push (`postmerge-1.txt`).
- **Merge.** A fresh `git fetch` and `git ls-remote` showed `main` at `0c069484` immediately before the merge. `f0a0c917` fast-forwarded onto `main` and was pushed (`0c069484..f0a0c917`); local `main` and `git ls-remote origin refs/heads/main` both equalled `f0a0c917` afterwards.
- **Resolution.** Resolved on the push of the documentation-only closure commit. §14 asks for an integration test that creates and replaces with a note and asserts `data_edits.note` for the new row; it exists for all three award families and both special-record replace families and passes on `afldb_test` (§17.2, §17.3), with the action layer's forwarding proved separately DB-free. The closure scope is **merge-scoped**: code on `main`, validated on `afldb_test`, **not deployed**.
- **Preserved limits.** Not deployed. No browser, DEV or PROD action. No real Server Action was driven with a session and a database together. The whole integration files (and the awards file's python replay tests) were not run. Audit rows written before the change are not repaired. One fixture-residue incident during validation was cleaned by id and is recorded in §17.3.

## 19. Evidence reconciliation (2026-10-15; documentation only, no database action)

The dry run and the apply of `cleanup-first-run.mjs` were printed to the console, not saved as files. Their output is preserved verbatim from the implementing session's transcript in `D:\tmp\issue283\reconcile-20261015\transcript-cleanup-first-run.txt` (sha-256 `dbe377a436571f5328713c7947bb75a7bb3ca1122372ef7e21c3dcbaa4cca3b9`, in `SHA256SUMS.txt`; source transcript `91442ef6-….jsonl`, sha-256 at extraction `5227314632b5319103ff2f35a3f58de55ca86cd941fa6f678bea432c823f620a`). The residue censuses are the saved `residue-*.txt` files. Times are AEDT.

**Recorded.** The dry run (09:29:55) listed `player_achievements` 380, 382 and 383, `after_siren_kicks` 172, 1 `data_edits` row for those `player_achievements` ids, 0 for the `after_siren_kicks` id, and 0 marker overrides. The apply (09:29:59) printed the same ids and deleted, in one transaction, 1 audit row, 3 `player_achievements` rows and 1 `after_siren_kicks` row. The deletes were by those primary keys (the audit row by table name and those row ids), so they could not remove any other row of those tables. The script's dry run after the corrected run listed no rows.

**Ownership: what the evidence shows, and what it does not.**
- The three `player_achievements` rows: the `manual167` selector read 0 before the first run (`residue-before.txt`), 3 after it (`residue-after-1.txt`) and 0 after the cleanup.
- The `after_siren_kicks` row 172: **no before-run census covered it.** The `kicks` selector matches `notes` or `player_name_raw` equal to the marker; this row carried the marker in `club_name_raw` and `public record text` in `notes`. Its attribution to the first run rests on that fixture text, which appears in no committed revision under `tests/` (`git log -S`) and existed only in that run's uncommitted test, and on the suite marker. It is not shown by a before-and-after count.
- The audit row is attributed through its `row_id`, one of the three `player_achievements` ids above.
- The 14-selector census reading 0 counts selector matches. It does not by itself show that unrelated rows were preserved; for these tables that rests on the by-id statements and their counts. No foreign key in the migration text references `player_achievements` or `after_siren_kicks`, so the deletes cascaded nowhere (live constraints were not inspected).

Nothing in §17's or §18's validation verdict changes.
