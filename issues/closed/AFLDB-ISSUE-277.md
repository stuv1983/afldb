# AFLDB-ISSUE-277 — Data Editor edits other than the name to a token-only player are not durable

## 0. Status

- **Status:** **Resolved (2026-10-15, merge-scoped; opened 2026-10-08).** D-277-1 decided by the owner (option a, with the save-time replay-compatibility guard). Implemented and merged as `8450134b`, validated on `afldb_test` including the real players replay (§17), merged and pushed (§18). **Not deployed.**
- **Severity:** Medium. **Area:** admin authority / Data Editor / override replay.
- **Key files:** `src/db/queries/data-edits.ts` (`getEntityNaturalKey`, `saveEdit`), `src/db/queries/player-identity.ts`, `tools/migration/common.py` (players replay).
- **Origin:** full code review at `20a7a4bbdea835cdd3fc5520e65ad47d275bd881` (`issues/reviews/2026-10-08-full-code-review.md`, F-012; partition note R3-F03). The main session re-read `data-edits.ts:125-259`.
- **Classification:** code-proven.

## 1. Summary

Some players have only a `manual_admin_edit` token: they were created in the Data Editor or through `/admin/draft` and have no AFL Tables identity yet, which is typical of a pre-debut draftee. For such a player `getEntityNaturalKey('players')` returns null, so a Data Editor save of `dob`, `birth_year`, `height_cm`, `weight_kg` or `notes` writes no `data_overrides` row. Only `name` is synced into the player's creation record. The players replay re-creates the row from that creation record, so the edit is lost and the old value comes back, while the `data_edits` audit row still names the change.

## 2. Evidence

- `src/db/queries/data-edits.ts:131-143`: the AFL Tables identity only, else `null`. `:234`: no override when null. `:214-229`: name-only sync (ISSUE-224 §21.3.2 A1).
- `src/db/queries/players.ts:399-416`: the creation record carries `dob`, `dob_confidence`, `birth_year`, `height_cm`, `weight_kg` and `notes`.
- `src/db/queries/player-identity.ts:115-129`: name-only by design, for the stated reason that an unresolvable `dob` record must be avoided. `:177-179` describes the same symptom for `name`.
- `tools/migration/common.py:1644-1673, :1799-1837`: the replay re-creates the player and applies the creation record. `:1568-1600`: the pre-check already refuses the bad state that motivated name-only.

## 3. Trigger

1. Correct the height of a manually created draftee in `/admin/data-editor?entity=players`.
2. Rebuild, or promote.

## 4. Expected invariant

Every Data Editor surface promises a durable correction (`data-edits.ts:22-31`). A correction survives a rebuild.

## 5. Actual behaviour

The value is reverted at replay, and the audit trail contradicts the restored row.

## 6. First wrong layer

`src/db/queries/data-edits.ts:131-143`, with no fallback to the manual token.

## 7. Impact

Silent loss of human corrections for exactly the players the editor exists to curate.

## 8. Reproduction / witness

Not executed (needs a replay). See §14.

## 9. Disproof attempts

- `getEntityNaturalKey` has no token-keyed branch (`readManualPlayerToken` exists but is unused here).
- `authority_rank` cannot rescue the edit, because no competing row exists.
- The replay UPDATE is unconditional.

## 10. Existing-issue search

- ISSUE-160 (draft key) and ISSUE-159 (lookup shape). ISSUE-224 A1 fixed `name` only.
- Classification: **new**, adjacent to resolved ISSUE-224.

## 11. Scope

Durability of non-name player edits for token-only players.

## 12. Out of scope

Players with an AFL Tables identity (they are durable today), and the nondeterministic key choice (AFLDB-ISSUE-292).

## 13. Proposed fix boundary

There are two options; choosing between them is a design decision.

- (a) Sync each edited group into the creation record, as `name` is synced.
- (b) Key a correction row `manual_admin_edit:<token>` with an authority rank above `identity`.

Option (b) needs care: an equal-rank row would trip the replay's disagreement refusal (`common.py:1770-1794`).

## 14. Proposed validation

1. Unit test on the key chooser.
2. Integration (`tests/integration/data-editor.test.ts`): for a manual player, edit `dob`, run the players replay, and assert the `dob`.

## 15. Decisions / unresolved questions

- D-277-1 (operator): option (a) or (b).

## 16. Next action

~~D-277-1, then implementation and tests.~~ Superseded by §17.

## 17. Implementation and validation (2026-10-15)

**Decision D-277-1 (owner, 2026-10-15): option (a)**, update the manual creation record, **with the save-time replay-compatibility guard.**

### 17.1 Change

- `src/db/queries/player-identity.ts` gains `MANUAL_IDENTITY_RECORD_GROUPS` (`dob`: `dob`, `dob_confidence`; `birth_year`: the four birth-year fields; `height_cm`; `weight_kg`; `notes`), the pure `manualIdentityRecordPatchFor`, the pure guard `manualIdentityRecordReplayProblem`, and `planManualIdentityRecordSync` / `applyManualIdentityRecordSync`. The `name` group keeps its own sync (`syncManualIdentityNameRecord`) and `MANUAL_IDENTITY_NAME_FIELDS` is unchanged.
- `src/db/queries/data-edits.ts`, `saveEdit`, in the one import-role transaction that carries the canonical UPDATE, the override upsert and the required audit: when `getEntityNaturalKey('players')` is null (no accepted AFL Tables identity, so the editor writes no override), the sync is PLANNED first, read-only and under `FOR UPDATE` on the active `manual_admin_edit:<token>` / `identity` record. The patch restates the whole group (a cleared date is stored as `dob: null` with `dob_confidence: 'unknown'`, as the editor writes the row; a cleared value is an explicit JSON null, which the replay applies as "clear"). After the canonical UPDATE the patch is merged into the record (`override_values || patch`) and audited as its own `data_edits` row, field group `manual_identity_record`, exactly as the name sync is.
- **The guard.** Before any write, the merged record is checked against the first arms of the replay's own pre-check (`replay_admin_overrides('players')` in `tools/migration/common.py`): a record with no `display_name`, or carrying a `dob` with no usable `dob_confidence` (`players_dob_confidence_ck`, migration 018). A save that would leave the record unreplayable is refused whole (`{ ok: false }` with a message naming the cause; the transaction rolls back, nothing is written). A record that was ALREADY unreplayable for the same reason is not refused for an unrelated edit, because the save does not make it worse and the replay refuses it on its own. The `afltables_profile_path` arm is a property of the whole database and is not the editor's to decide.
- Unchanged: a player who holds an AFL Tables identity (keyed under the source, durable today) is not touched; a player with no manual token or no active creation record is exactly as non-durable as before (§17.4). No migration, no `tools/migration/common.py` change, no existing record rewritten.
- Option (b) (a correction row `manual_admin_edit:<token>` ranked above `identity`) was not built.

### 17.2 Tests

- `tests/integration/data-editor.test.ts`, a new block `AFLDB-ISSUE-277` (PostgreSQL, 8 cases): each non-name group is written into the record with its own audit row, **and the REAL `replay_admin_overrides(conn, 'players')` then re-creates a deleted player with every edited value** (run in a transaction that is rolled back); a cleared value replays as cleared; an unchanged save adds no record audit row; the guard refuses a `dob` with confidence `unknown` before any write (record, row and audit unchanged); a legacy record that was already unreplayable does not block an unrelated edit and a `dob` save supplying the confidence repairs it; **the guard agrees with the real replay about which four record shapes it refuses**; a player holding an AFL Tables identity is unchanged (keyed under the source, record untouched); a player with no identity at all keeps the old behaviour.
- `tests/data-overrides-source-contract.test.ts` (DB-free, 70 to 74): the synced groups are exactly the other editor groups with the editor spec's own fields; the patch function; the guard's verdicts and the exact SQL arms of the replay it mirrors; the order in `saveEdit` (plan and refusal before the canonical UPDATE, record write after it, all inside the one transaction, only when the editor wrote no override of its own).

### 17.3 Results

- **Authority.** `D:\tmp\issue283\run-int.mjs` derived the owner, importer and auth DSNs in memory from the primary `.env`, pointed them at `afldb_test` on tunnel port 55432 and proved `current_database() = afldb_test` for each before vitest started. No credential was printed or written. The replay ran only inside rolled-back transactions. No `afldb_dev`, PROD, migration, rebuild or repair.
- **Fixed code.** Filter `AFLDB-ISSUE-277`: **8 passed**. The whole `data-editor` integration file: **52 passed** (199 s). DB-free source contract: **74 passed**; `match-sheet` (it pins the shape of `saveEdit`'s catch block): 91 passed.
- **Unfixed source** (`src/` stashed): 6 of the 8 new integration cases fail (the two that pass characterise behaviour this change leaves alone).
- **Mutants** (`D:\tmp\issue277\mutate.py`, original bytes restored and compared afterwards): the key test inverted (M1), the guard off (M2), the guard refusing an already-broken record (M3), no `unknown` on a cleared date (M4), no record write (M5), no record audit (M6), the refusal ignored (M7). **All 7 killed**, by the integration block and, for M1, M4 and M7, also by the DB-free contract file.
- **Fixture residue.** `D:\tmp\issue277\residue.mjs` (players named `Issue277%`, notes-tagged audit rows, fixture overrides and identities) read 0 after every run; `afldb_test` held 13,365 players and 92 player overrides before and after.
- **Static.** `tsc --noEmit` exit 0; `git diff --check` clean; ESLint of the four changed files reports only the two `no-explicit-any` errors already in unchanged code in `data-edits.ts`, which unchanged `main` also reports.
- **Real data (read-only, 15 Oct 2026, runbook of ISSUE-292 §19.2).** The same census that answered ISSUE-292 counted manual players: DEV 92, PROD 92, **token-only 0 on both**, 92 with a creation record on both. No DEV or PROD player is in the state this issue describes today.
- **Whole DB-free suite**: the files that fail on unchanged `main` in this environment fail the same way, plus the two a worktree cannot run (`admin-coach-actions` needs `DATABASE_URL`; a DraftGuru bridge-gate case needs a git-ignored snapshot), and `match-sheet` once (the finding below, since fixed); none else touches the Data Editor. Raw `D:\tmp\issue277\dbfree.txt` (taken before the `match-sheet` finding below was fixed; that file now passes).
- **A finding fixed in this work.** The first draft returned the guard's refusal from the top of `saveEdit`'s catch block; `tests/match-sheet.test.ts` pins that nothing returns before the 55P03 mapping, and failed. The mapping now follows it.

### 17.4 Limits

- **Not deployed**; no browser, DEV or PROD action.
- A player with a manual token but no active creation record, or with no identity at all, is still not durable and nothing says so; that is unchanged and was not in the decision.
- A player who holds an AFL Tables identity that is not yet `unique`/`resolved` at save time is treated as token-only and so is synced into the record; the record is then correct if the replay runs before that identity is accepted.
- The `afltables_profile_path` pre-check arm is not mirrored (§17.1).

## 18. Readiness, merge and closure (2026-10-15)

- **Readiness: accepted under a scoped cleanliness exception, not a clean pass.** `npm run preflight -- --mode implementation --issue 277` on the committed worktree: READY (0 blockers, 3 warnings: `.env`, `psql`, `pg_restore`; raw `D:\tmp\issue277\preflight-1.txt`). `npm run merge:ready -- --issue 277` (raw, unchanged: `D:\tmp\issue277\merge-ready-raw-1.txt`): BLOCKED by exactly one blocker, the primary worktree not clean; every other check PASSed, with two metadata warnings (no runbook readiness JSON block; no automated unexpected-file classification). The committed code paths were compared with the declared scope by hand.
- **Exception.** The owner retained the exact **18**-path primary-state exception for this batch (the nine `.agents/skills` files, the seven zero-byte stray-named files, the literal `$null)` and the zero-byte `2000)`), covering only that clean-tree FAIL. A 19th path, a zero-byte `0` created at 11:47 that day, appeared and made the exact-path check fail; the owner answered a direct question by authorising its deletion, and it was deleted (empty, untracked) before any merge. Immediately before the merge a script verified the 18 paths, their full sha-256 hashes (`$null)` `d9edb146...2500`, unchanged), no tracked and no staged primary change, and that fresh `main`, `origin/main` and the live remote agreed (`premerge-1.txt`); it read OK again after the push (`postmerge-1.txt`).
- **Merge.** `8450134b` fast-forwarded onto `main` and was pushed (`c54cbfec..8450134b`); local `main` and `git ls-remote origin refs/heads/main` were compared afterwards.
- **Resolution.** Resolved on the push of the documentation-only closure commit. The runbook's §14 integration case (edit a manual player's `dob`, run the players replay, assert the `dob`) exists and passes against PostgreSQL with the real replay. **Merge-scoped**: code on `main`, validated on `afldb_test`, **not deployed**.
