# AFLDB-ISSUE-282 — Replace actions revalidate only the replaced row's public pages

## 0. Status

- **Status:** Open (2026-10-08). **Implemented and validated on `afldb_test` 2026-10-15** (`9baba193` on `sonnet/issue-282`, base `9fcefb9c`; §17). Not deployed.
- **Severity:** Low. **Area:** admin awards, Hall of Fame, honour teams and special records / public cache revalidation.
- **Key files:** `src/db/queries/admin-awards.ts` (`replaceAwardWinner`, `replaceHallOfFameInductee`, `replaceHonourTeamMember`), `src/db/queries/admin-special-records.ts` (`replaceFirstKickGoal`, `replaceAfterSirenKick`).
- **Origin:** full code review at `20a7a4bbdea835cdd3fc5520e65ad47d275bd881` (`issues/reviews/2026-10-08-full-code-review.md`, F-017; partition notes R2a-F01 and R2c-F02, grouped as one mechanism).
- **Classification:** code-proven.

## 1. Summary

Each of the five replace transactions returns `revalidatePaths: row.revalidatePaths`, where `row` is the locked OLD row. The replacement row's pages are never computed: a different award, season, recipient, club, match or team. So the correct person's or award's public page keeps its pre-replacement state until its ISR window expires, which is up to a day.

## 2. Evidence

- `src/db/queries/admin-awards.ts:1686`, `:2212`, `:2737`, where the old row comes from `lockAwardWinner :1063`.
- `src/db/queries/admin-special-records.ts:1686`, `:2243`, where the old row comes from `lockSpecialRecord :850`.
- Contrast: `createAwardWinner` (`admin-awards.ts:1564-1570`) and `createFirstKickGoal` (`admin-special-records.ts:1571-1577`, `:2140-2146`) compute the new row's paths. The draft relink revalidates both players (`src/app/admin/draft/actions.ts:357-358`).
- The actions forward the result unchanged (`src/app/admin/awards/actions.ts:126-151`; `src/app/admin/records/actions.ts:108-138`).
- ISR windows:
  - `awards/[slug]` and `awards/[slug]/[season]`: 86400.
  - `players/[slug]`: 3600.
  - `clubs/[slug]` and `honour-teams/[slug]`: 86400.
  - `seasons/[year]`: 3600.

## 3. Trigger

"Replace this record" with a different award, season, recipient, club, match or team. This is the panels' advertised purpose (`ReplacePanel.tsx:126-127`, `SpecialRecordReplacePanel.tsx:105-109`).

## 4. Expected invariant

The union of the old row's and the created row's paths is revalidated.

## 5. Actual behaviour

Only the old row's paths are revalidated.

## 6. First wrong layer

The `revalidatePaths` return in each of the five replace functions.

## 7. Impact

Stale public pages for up to 24 hours. No data effect. This is distinct from the known per-worker limitation (ISSUE-134): here a path is missing altogether.

## 8. Reproduction / witness

Not executed. The paths are computed inside the transaction, so DB-free testing is not possible.

## 9. Disproof attempts

- `settle()` does not augment the paths.
- `insertFirstKickGoal` returns no paths.
- The old and new rows share no pages in the advertised scenario.

## 10. Existing-issue search

- ISSUE-165 and ISSUE-167 runbooks (generic path contract only); ISSUE-176 (match-link validation).
- Classification: **new**.

## 11. Scope

The five replace functions.

## 12. Out of scope

Per-worker invalidation (ISSUE-134).

## 13. Proposed fix boundary

In each replace transaction, read the created row and return the de-duplicated union of old and new path sets. The allowlists already admit every shape.

## 14. Proposed validation

Integration: extend `tests/integration/admin-awards.test.ts:670` and `tests/integration/admin-special-records.test.ts:938-988` to assert the new player's path is in `revalidatePaths`.

## 15. Decisions / unresolved questions

None.

## 16. Next action

~~Implementation, grouped with AFLDB-ISSUE-283 (the same functions).~~ Superseded by §17. ISSUE-283 is a separate defect and is not fixed here.

## 17. Implementation and validation (2026-10-15)

### 17.1 Change

- `src/db/queries/admin-awards.ts`: new pure `replacementPaths(voided, created)` returns the de-duplicated union. `replaceAwardWinner`, `replaceHallOfFameInductee` and `replaceHonourTeamMember` now read the created row inside the transaction (`readAwardWinnerInTx`; new `readHallOfFameInTx`, which `createHallOfFameInductee` now also uses in place of its inline copy; new `readHonourTeamMemberInTx`) and return `replacementPaths(row.revalidatePaths, <created row's paths>)`. A created row that cannot be read contributes no paths (the old behaviour); it does not fail the replacement.
- `src/db/queries/admin-special-records.ts`: the same helper, and `replaceFirstKickGoal` and `replaceAfterSirenKick` read the created row with the existing `readFirstKickGoalInTx` / `readAfterSirenKickInTx`.
- No migration, no change to the actions (which forward the result unchanged), no change to the allowlists (every shape was already admitted). The mutations are unchanged; the only added statement in each replace is one read of the row just inserted.

### 17.2 Tests (`afldb_test`, fixture rows only)

- `tests/integration/admin-awards.test.ts`: the existing `replaces the wrong winner…` and `replaces a source-owned entry…` cases now assert the revalidation result; two new cases: a Hall of Fame entry moved from induction year 1998 to 2001 and linked to a player (both season pages, `/hall-of-fame` and the player page), and an honour-team selection moved to another team and another player (both team pages, both player pages). Honour-team replacement had no integration case before.
- `tests/integration/admin-special-records.test.ts`: the existing first-kick replace case asserts the union (public page, the new player's page, both admin detail pages, allowlist membership, no duplicate); a new case covers `replaceAfterSirenKick`, which also had none.
- Each asserts the created row's path, the voided row's path (or one only the voided row has), and that the list has no duplicates.

### 17.3 Results

- **Authority.** `D:\tmp\issue282\run-int.mjs` derives the owner, importer and auth DSNs in memory from the primary `.env`, points them at `afldb_test` on tunnel port 55432 and proves `current_database() = afldb_test` for each (`afldb_owner`, `afldb_import`, `afldb_auth`) before vitest starts; the suite's own `guard.ts` and importer-role parity check then run. No credential was printed or written. Only the suites' own prefix-keyed fixtures were written, through their own `purgeFixtures()` / `purgeStage6()`. No `afldb_dev`, PROD, migration, rebuild, restore, truncation or repair. The python replay tests of `admin-awards.test.ts`, which replay overrides across whole tables, were **not run**: the focused filter excluded them.
- **Fixed code.** `admin-awards` filter `replaces the wrong winner|replaces a source-owned entry|ISSUE-282`: **4 passed**, 31 skipped (35). `admin-special-records` filter `replace is one transaction|ISSUE-282`: **2 passed**, 35 skipped (37). Raw: `D:\tmp\issue282\int-awards-final.txt`, `int-special-final.txt` (earlier runs `-1`/`-2` preceded the fourth awards case).
- **Unfixed source** (`git show HEAD:` versions of the two query files, restored afterwards, sha-256 equal): the same filters give **4 failed** and **2 failed**, each on the missing created-row path (`base-awards.txt`, `base-special.txt`).
- **Mutants** (`D:\tmp\issue282\mutate.mjs`, one at a time, original bytes restored and hash-verified after each): a helper returning the voided set only, the created set only, or no de-duplication, in each file (6); each of the five replace functions dropping the created row's paths (5) or the voided row's paths (5). **All 16 killed** (`mutants-summary.txt`). The `admin-awards.ts` created-set-only helper mutant leaves the one Hall of Fame case that asserts only the new side passing, by design; the other three cases kill it.
- **Fixture residue.** A read-only census of 14 fixture selectors on `afldb_test` (`residue.mjs`) read 0 for every selector before the first run, after the first runs, after the unfixed-source and mutant runs, and after the final runs (`residue-before.txt` … `residue-final.txt`).
- **Static.** `tsc --noEmit` exit 0; ESLint of the four files exit 0; `git diff --check` exit 0.
- **DB-free neighbours.** `special-records-admin`, `data-overrides-source-contract`, `awards-replace-panel` and `admin-awards-hall-of-fame-years` pass; `awards-admin.test.ts` has one failure (ISSUE-027 migration 108 grant text) that is **identical on unchanged `main`** (`dbfree-base-awards-admin.txt`), a pre-existing Windows line-ending baseline, unrelated.

### 17.4 Limits

- Not deployed; no browser, DEV or PROD action. The assertions are on the returned path list; that Next.js then revalidates each path is the unchanged action layer's job and was not exercised. The whole `admin-awards` and `admin-special-records` integration files were not run (focused cases only; the python replay tests were excluded by design). ISSUE-283 (the administrative note) is not addressed.
