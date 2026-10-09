# AFLDB-ISSUE-289 — A cancelled fixture that is later played can never be reinstated

## 0. Status

- **Status:** Open (2026-10-08). Nothing implemented.
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

D-289-1.
