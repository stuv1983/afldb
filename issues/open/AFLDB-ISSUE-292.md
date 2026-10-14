# AFLDB-ISSUE-292 — Data Editor override key is chosen nondeterministically for a player with two AFL Tables paths

## 0. Status

- **Status:** Open (2026-10-08). Implemented and validated on `afldb_test` 2026-10-15 (§17); not deployed. **Stays open:** the §15 census has not been run (§17.5).
- **Severity:** Low. **Area:** Data Editor / override replay.
- **Key file:** `src/db/queries/data-edits.ts` (`getEntityNaturalKey`).
- **Origin:** full code review at `20a7a4bbdea835cdd3fc5520e65ad47d275bd881` (`issues/reviews/2026-10-08-full-code-review.md`, F-027; partition note R3-F04).
- **Classification:** the nondeterminism is code-proven; the operational trigger is a hypothesis.

## 1. Summary

`getEntityNaturalKey('players')` takes an accepted AFL Tables identity with `LIMIT 1` and no `ORDER BY`. For a player holding two accepted paths (a renumbered profile pair, ISSUE-136/137), two edits of the same field group at different times can be keyed under different paths. With differing values, the players replay then raises "equal-authority overrides that disagree" and the reload or promotion refuses.

## 2. Evidence

- `src/db/queries/data-edits.ts:133-141` (the main session re-read `:125-144`).
- `tools/migration/common.py:1758-1794` (the equal-authority refusal).
- Contrast: the continuing-URL rule in `src/lib/acquisition/match-sheet-authority.ts:204-229`, and `manual-authority.ts:679`.

## 3. Trigger

A folded-pair player. Two edits of one group with different values, with the physical row order changed in between (an UPDATE or VACUUM of `external_identities`).

## 4. Expected invariant

One deterministic key per player.

## 5. Actual behaviour

Two active rows under two keys are possible, and the replay then refuses.

## 6. First wrong layer

`src/db/queries/data-edits.ts:133-141`.

## 7. Impact

Operational: a fail-closed refusal of a rebuild or promotion, self-inflicted by two ordinary edits.

## 8. Reproduction / witness

Not executed.

## 9. Disproof attempts

`LIMIT 1` without `ORDER BY` carries no ordering guarantee.

## 10. Existing-issue search

`getEntityNaturalKey` appears in ISSUE-160 and ISSUE-159 only. Classification: **new**.

## 11. Scope

The key choice.

## 12. Out of scope

The durability of token-only players (AFLDB-ISSUE-277).

## 13. Proposed fix boundary

Reuse the ISSUE-257 identity rule, or `ORDER BY e.external_id` with `match_method = 'afltables_profile_url'`.

## 14. Proposed validation

A DB-free unit test of the key chooser.

## 15. Decisions / unresolved questions

- Whether any DEV or PROD player already carries overrides under two paths. Read-only census by `player_id` over the two keys.

## 16. Next action

~~Implementation (small). Consider doing it together with AFLDB-ISSUE-277.~~ Superseded by §17.

## 17. Implementation and validation (2026-10-15)

### 17.1 Change

- `src/db/queries/data-edits.ts` (`getEntityNaturalKey`, players branch): the AFL Tables identity query now ends `ORDER BY (e.match_method = 'afltables_profile_url') DESC NULLS LAST, e.external_id LIMIT 1`. The key is a function of the player's identity rows, not of their physical order. `afltables_profile_url` rows rank first because the players replay resolves a key only through those rows (`tools/migration/common.py` skips any other `afltables` identity), and the smallest path breaks the tie between the two paths of a renumbered pair. This is the runbook's second option. The first (reusing the ISSUE-257 continuing-URL rule) needs the continuity contract loaded inside the editor transaction and would key by the continuing path instead; it was not taken, and nothing in this change precludes it.
- A player whose only `afltables` identity is not a profile-URL row is keyed as before (no behaviour change for a single row).
- Existing overrides are not rewritten. No migration.

### 17.2 Tests

- `tests/integration/data-editor.test.ts`: a new block `AFLDB-ISSUE-292`, one case on `afldb_test`. A fixture player holds three `afltables` identity rows: two profile-URL paths (the larger inserted first) and a third that sorts before both but is not a profile-URL identity (no such row exists on `afldb_test` today, where every `afltables` identity is `afltables_profile_url`; the case builds one to pin the ranking). The player's `height_cm` group is edited, the larger path's row is rewritten so the physical order changes, and the group is edited again. Exactly one active override exists, under the smallest profile-URL path, carrying the second value.
- `tests/data-overrides-source-contract.test.ts` (DB-free): the players branch of `getEntityNaturalKey` contains that exact ORDER BY before its `LIMIT 1`.

### 17.3 Results

- **Authority.** `D:\tmp\issue292\run-int.mjs` (the ISSUE-282 launcher, with extra vitest arguments passed through) derived the owner, importer and auth DSNs in memory from the primary `.env`, pointed them at `afldb_test` on tunnel port 55432 and proved `current_database() = afldb_test` for each before vitest started. No credential was printed or written. Only the case's own fixture player, identity rows, overrides and audit rows were written, and the case removes them in a `finally`. No `afldb_dev`, PROD, migration, rebuild, restore, truncation or repair.
- **Fixed code.** Filter `AFLDB-ISSUE-292`: **1 passed**, 43 skipped; with the neighbouring `AFLDB-ISSUE-224` name-edit block and `Atomic required audit`: **4 passed**. DB-free `data-overrides-source-contract`: **70 passed**.
- **Unfixed source** (`git checkout HEAD -- src/`, the fixed file copied back and sha-256 verified): both fail. The integration case fails on the key: the unordered query answered with the first-inserted (larger) path both times in that run, not the smallest, so this run showed the order-dependence of the choice but not two keys for one player; two keys need the planner to flip between the two edits, which the fix removes whatever the planner does.
- **Mutants** (`D:\tmp\issue292\mutate.mjs`, each against both the integration case and the DB-free case, original bytes restored and hash-verified after each): no ORDER BY (Z1), path descending (Z2), no profile-URL preference (Z3), profile-URL rows ranked last (Z4). **All 4 killed by both.**
- **Fixture residue.** A read-only census (players named `Issue292%`, `issue292-` identities, overrides, audit rows and override text) read 0 before and after every run, baseline and mutant.
- **Static.** `tsc --noEmit` exit 0; `git diff --check` exit 0; ESLint of the three changed files exits 1 on this branch and on unchanged `main` with an identical problem set (compared by rule and message): none introduced.

### 17.4 Limits

- Not deployed; no browser, DEV or PROD action. Keys already written under either path are not rewritten, so a player who already carries overrides under both paths still makes the players replay refuse until someone repairs them (§17.5).

### 17.5 Why this issue stays open

§15 asks whether any DEV or PROD player already carries overrides under both paths, answered by a read-only census by `player_id` over the two keys. That needs DEV or PROD contact, which this work was not authorised to make, so the question is unanswered and any repair it implies is unscoped. The code fix is merged and validated; the issue closes when the census has been run and either found nothing or its findings have a repair plan. Not recorded in `blockers.md`, which this work did not edit.

## 18. Readiness and merge (2026-10-15; the issue stays open, §17.5)

- **Readiness: accepted under a scoped cleanliness exception, not a clean pass.** `npm run preflight -- --mode implementation --issue 292` on the committed worktree: READY (0 blockers, 3 warnings: `.env`, `psql`, `pg_restore`; raw `D:\tmp\issue292\preflight-1.txt`). `npm run merge:ready -- --issue 292` (raw, unchanged: `D:\tmp\issue292\merge-ready-raw-1.txt`): BLOCKED by exactly one blocker, the primary worktree not clean; every other check PASSed, with two metadata warnings (no runbook readiness JSON block; no automated unexpected-file classification). The six committed paths were compared with the declared scope by hand: `data-edits.ts`, the two test files, this runbook, `issues.md` and `IssuesIndex.md`.
- **Exception (fresh, this issue only).** The owner authorised an exception covering only that clean-tree FAIL under the exact **18**-path primary state (the nine `.agents/skills` files, the seven zero-byte stray-named files, the literal `$null)` and the zero-byte `2000)`). Immediately before the merge a script verified the 18 paths, their full sha-256 hashes (`$null)` `d9edb146…2500`, unchanged since the session start), no tracked and no staged primary change, and that fresh `main`, `origin/main` and the live remote agreed (`premerge-1.txt`); it read OK again after the push (`postmerge-1.txt`).
- **Merge.** `1d2ec9fb` (fix, tests and records) fast-forwarded onto `main` and was pushed (`7fbec965..1d2ec9fb`); local `main` and `git ls-remote origin refs/heads/main` both equalled `1d2ec9fb` afterwards. Merge-scoped only; not deployed. The issue is not resolved.
