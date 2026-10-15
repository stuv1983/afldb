# AFLDB-ISSUE-289 — A cancelled fixture that is later played can never be reinstated

## 0. Status

- **Status:** **Resolved (2026-10-15, merge-scoped; opened 2026-10-08).** D-289-1 decided by the owner (option a, narrowly). Implemented and merged as `39622149`, validated on `afldb_test` (§17), merged and pushed (§18). **Not deployed; `VISUAL: UNVERIFIED`.**
- **Severity:** Low. **Area:** admin fixtures (ISSUE-162 lifecycle).
- **Key file:** `src/db/queries/admin-fixtures.ts` (`isFixtureEditAllowed`, `editFixture`, `reinstateFixture`, `checkMoveTarget`).
- **Origin:** full code review at `20a7a4bbdea835cdd3fc5520e65ad47d275bd881` (`issues/reviews/2026-10-08-full-code-review.md`, F-024; partition note R2c-F05).
- **Classification:** code-proven.

## 1. Summary

A fixture is cancelled (postponed), and the game is later played in the same round and imported by the settle. Played resolution ignores fixture status other than `void`, so the fixture now reads "played", and the played-lock gate refuses every non-notes edit, including Reinstate. Even past the gate, `checkMoveTarget` would refuse `already_played` for the fixture's own match. The runbook says a cancelled game may be rescheduled and reinstated. The fixture stays `cancelled` + played with no diagnostic.

## 2. Evidence

- `src/db/queries/admin-fixtures.ts`:
  - `:1330-1353` (`isFixtureEditAllowed`: `isPlayedState` → `played_locked`; only `fixture_notes` is exempt).
  - `:1413-1416` (gate before `reinstateFixture`'s precheck `:1759-1777`).
  - `:1698-1705` (`checkMoveTarget`).
  - `:494-509` and `:525-537` (played resolution with no status predicate).
  - `:2059-2196` (diagnostics: no cancelled-but-played rule).
- `issues/closed/AFLDB-ISSUE-162.md:496` and `:518-519` (the documented workflow).

## 3. Trigger

Cancel → the game is played and settled → the admin presses Reinstate.

## 4. Expected invariant

The runbook's documented workflow is reachable, or the lock is a documented decision with a diagnostic.

## 5. Actual behaviour

"This fixture has been played… only its notes may be changed." The contradictory state persists.

## 6. First wrong layer

`src/db/queries/admin-fixtures.ts:1330-1353`.

## 7. Impact

A self-contradictory admin state with no repair path. No public consumer exists yet (D-7).

## 8. Reproduction / witness

Not executed.

## 9. Disproof attempts

No runbook decision says a cancelled+played fixture must stay cancelled; ISSUE-162 §15/§16 say the opposite.

## 10. Existing-issue search

`played_locked` in `issues.md` (Stage 1/2 narrative only). Classification: **new** (the gate shipped this way; this is not a regression).

## 11. Scope

The reinstate path for a cancelled fixture that was later played.

## 12. Out of scope

The fixture writer (AFLDB-ISSUE-229).

## 13. Proposed fix boundary

One of two options, chosen by an operator decision:

- (a) Exempt `fixture_reinstated` from the played gate and from `already_played` when the played candidate is the fixture's own pair and round.
- (b) Keep the lock, add a `cancelled_but_played` diagnostic, and amend the runbook.

## 14. Proposed validation

Integration: create → cancel → insert a played match → reinstate. Expect ok under option (a), or the diagnostic under option (b).

## 15. Decisions / unresolved questions

- D-289-1 (operator): option (a) or (b).

## 16. Next action

~~D-289-1.~~ Superseded by §17.

## 17. Implementation and validation (2026-10-15)

**Decision D-289-1 (owner, 2026-10-15): option (a), narrowly.** Permit reinstatement of the fixture's own played match; preserve every other lock.

### 17.1 Change

- `src/db/queries/admin-fixtures.ts`, `isFixtureEditAllowed`: one new arm ahead of the played lock. `fixture_reinstated` on a fixture whose status is `cancelled` and whose played resolution is `played` or `played_home_away_differs` is allowed. Nothing else is: every other field group on that fixture (schedule, venue, round, clubs, cancel, void, creation) is still `played_locked`; Reinstate on a `scheduled` played fixture is still `played_locked`; a `void` fixture is still `invalid_transition`; notes are still the one edit a played fixture accepts.
- `checkMoveTarget` gains an `ownPlayedMatch` input and `reinstateFixture` passes `isPlayedState(played.state)`, the resolution already computed under the fixture row lock and the season lock in the same transaction. When it is true the `already_played` rule is skipped, because the single played match is the fixture's own result and not a rival. The skip sits AFTER the duplicate-scheduled and club-already-scheduled rules, so both still run. An `ambiguous` resolution links nothing, so it is nobody's own match and still refuses `already_played`.
- No `matches` row is written, and the durable record and the `fixture_reinstated` audit row are written exactly as before.
- Operator surface: `/admin/fixtures/[season]/[fixtureKey]` rendered the lifecycle panel only for an unplayed fixture, so the Reinstate button was unreachable for exactly the state this issue is about. The page now renders `LifecyclePanel` for a played fixture only when it is `cancelled`; the panel takes `played` and then offers Reinstate alone (no Cancel, no Void block), with one added sentence, and the played notice says a cancelled fixture can still be reinstated. The schedule, venue, round and clubs panels stay hidden for every played fixture. The backend gate remains the boundary; the page is a convenience.
- Option (b) (a `cancelled_but_played` diagnostic) was not built; the owner chose (a).

### 17.2 Tests

- `tests/admin-fixture-actions.test.ts` (DB-free, 71 to 80): the gate matrix for both played states (reinstate allowed; the seven other groups `played_locked`; scheduled `played_locked`; void `invalid_transition`); the real `reinstateFixture` over a fake transaction (reinstates for an exact and for a swapped single result; refuses `already_played` for an ambiguous resolution; refuses `duplicate_fixture` and `club_already_scheduled` even when played; each refusal writes nothing); the real `LifecyclePanel` rendered to markup for a cancelled played fixture (Reinstate, no Cancel, no Void) and for an unplayed one (unchanged); the page wiring and the `schedulable` rule pinned in source.
- `tests/integration/admin-fixtures.test.ts` (PostgreSQL, 36 to 39): create, cancel, insert a played match, then reinstate (the runbook's §14 case): the other groups refuse `played_locked` first, Reinstate succeeds, the fixture reads `scheduled` against the same `playedMatchId`, the durable record says `scheduled`, the audit trail is `fixture_creation, fixture_cancelled, fixture_reinstated`, the played match row is byte-identical, and the played lock is back. Two refusals that must remain: a replacement scheduled fixture for the pair (`duplicate_fixture`) and two results making the resolution ambiguous (`already_played`).

### 17.3 Results

- **Authority.** `D:\tmp\issue283\run-int.mjs` derived the owner, importer and auth DSNs in memory from the primary `.env`, pointed them at `afldb_test` on tunnel port 55432 and proved `current_database() = afldb_test` for each before vitest started. No credential was printed or written. Only the cases' own fixtures were written. No `afldb_dev`, PROD, migration, rebuild, restore or repair.
- **Fixed code.** DB-free `admin-fixture-actions`: **80 passed**. The whole `admin-fixtures` integration file: **39 passed** (116 s). The four fixture-related DB-free files: 319 passed.
- **Unfixed source** (`src/` stashed): 7 of the 9 new DB-free cases fail (the other two characterise unchanged behaviour); the new Reinstate integration case fails with `already_played` (the two refusal cases that follow it failed only because that run left its played match behind until teardown).
- **Mutants** (`D:\tmp\issue289\mutate.py`, original bytes restored and byte-compared after the run): the status restriction dropped (M1), the field-group restriction dropped (M2), `already_played` skipped unconditionally (M3), never skipped (M4), the duplicate and clash rules skipped for a played fixture (M5, M6). **All 6 killed.**
- **Fixture residue.** `D:\tmp\issue289\residue.mjs` (marker matches, fixtures, fixture audit and override rows) read 0 after the runs.
- **Static.** `tsc --noEmit` exit 0; ESLint of the five changed files clean; `git diff --check` clean.
- **Whole DB-free suite** (`--exclude tests/integration`): the files that already fail on unchanged `main` in this environment fail the same way, plus two that need what a worktree does not carry (`admin-coach-actions` needs `DATABASE_URL`; a DraftGuru bridge-gate case needs a git-ignored snapshot); none touches fixtures. Raw `D:\tmp\issue289\dbfree.txt`.

### 17.4 Limits

- **Not deployed**; no browser, DEV or PROD action.
- **`VISUAL: UNVERIFIED`.** The page and panel change alters rendered UI, and no authenticated browser session was available, so no screenshot exists. What exists is structural: the real `LifecyclePanel` rendered to markup in a test, and the page wiring pinned in source. Nobody has seen the page.
- A fixture reinstated this way is `scheduled` and played at once. That is the ordinary state of any played fixture, so no diagnostic is added.
- A fixture already stuck `cancelled` and played on DEV or PROD becomes reinstatable by hand once deployed; none was looked for.

## 18. Readiness, merge and closure (2026-10-15)

- **Readiness: accepted under a scoped cleanliness exception, not a clean pass.** `npm run preflight -- --mode implementation --issue 289` on the committed worktree: READY (0 blockers, 3 warnings: `.env`, `psql`, `pg_restore`; raw `D:\tmp\issue289\preflight-1.txt`). `npm run merge:ready -- --issue 289` (raw, unchanged: `D:\tmp\issue289\merge-ready-raw-1.txt`): BLOCKED by exactly one blocker, the primary worktree not clean; every other check PASSed, with two metadata warnings (no runbook readiness JSON block; no automated unexpected-file classification). The committed code paths were compared with the declared scope by hand.
- **Exception.** The owner retained the exact **18**-path primary-state exception for this batch (the nine `.agents/skills` files, the seven zero-byte stray-named files, the literal `$null)` and the zero-byte `2000)`), covering only that clean-tree FAIL. A 19th path, a zero-byte `0` created at 11:47 that day, appeared and made the exact-path check fail; the owner answered a direct question by authorising its deletion, and it was deleted (empty, untracked) before any merge. Immediately before the merge a script verified the 18 paths, their full sha-256 hashes (`$null)` `d9edb146...2500`, unchanged), no tracked and no staged primary change, and that fresh `main`, `origin/main` and the live remote agreed (`premerge-1.txt`); it read OK again after the push (`postmerge-1.txt`).
- **Merge.** `39622149` fast-forwarded onto `main` and was pushed (`d9cd637a..39622149`); local `main` and `git ls-remote origin refs/heads/main` were compared afterwards.
- **Resolution.** Resolved on the push of the documentation-only closure commit. The runbook's §14 integration case exists and passes against PostgreSQL. The closure scope is **merge-scoped**: code on `main`, validated on `afldb_test`, **not deployed**, with `VISUAL: UNVERIFIED` for the page change (§17.4).

## 19. Build evidence (added 2026-10-15, after the merge)

`npm run build` on merged `main` (which contains this change, ISSUE-277, ISSUE-289 and ISSUE-303) reported `Compiled successfully` and `Finished TypeScript`, then stopped at "Collecting page data" with `ECONNREFUSED 127.0.0.1:5432`: this workstation has no database on that port. It is therefore **not a completed build**; it shows only that the change compiles and type-checks under Next 16.3.1. Raw `D:	mpatch1015uild-main.txt`.
