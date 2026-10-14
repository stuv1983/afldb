# AFLDB-ISSUE-291 — Admin player creation persists unvalidated biographical fields

## 0. Status

- **Status:** Open (2026-10-08). **Implemented 2026-10-14 (§17); DB-free validated (§17.1); not yet merged.**
- **Severity:** Low. **Area:** admin player creation (Data Editor; player-links create-and-link).
- **Key files:** `src/app/admin/data-editor/actions.ts` (`createPlayerAction`), `src/app/admin/player-links/actions.ts` (`createAndLinkPlayer`), `src/db/queries/players.ts` (`createPlayerInTransaction`).
- **Origin:** full code review at `20a7a4bbdea835cdd3fc5520e65ad47d275bd881` (`issues/reviews/2026-10-08-full-code-review.md`, F-026; partition notes R3-F05 and R5b-F05, grouped because both reach the one shared primitive).
- **Classification:** code-proven.

## 1. Summary

Both admin player-creation actions forward `dob`, `dobConfidence`, `heightCm` and `weightKg` without server-side validation. `createPlayerInTransaction` validates none of them either. Out-of-range heights and weights (for example `-5` or `999`) are stored in `players` and in the durable `manual_admin_edit` creation record, which is replayed on every rebuild. A bad enum or impossible date surfaces as a raw PostgreSQL error. The Data Editor's edit surface refuses the same values (`spec.ts`: height 120-230, weight 40-160).

## 2. Evidence

- `src/app/admin/data-editor/actions.ts:68-75`.
- `src/app/admin/player-links/actions.ts:162-169` (the `dobConfidence` cast at `:163`).
- `src/db/queries/players.ts:334-338` (no validation) and `:399-416` (durable record).
- `src/lib/edit/spec.ts:86-87` (ranges) and `:209-255` (`validateFieldValue`).
- `src/db/migrations/002_core_entities.sql:139-140` (`smallint`, no CHECK).
- The principle is stated in `src/lib/match-sheet.ts:94-96`.

## 3. Trigger

`/admin/data-editor` "Add new player", or player-links "Create and link", with height 999 or -5, or a hand-edited `dobConfidence`.

## 4. Expected invariant

Server-side validation with the same bounds as the editor, before the import transaction.

## 5. Actual behaviour

Implausible values become durable. Bad enums and dates produce raw errors.

## 6. First wrong layer

`src/db/queries/players.ts:334-338` (the shared primitive), reached from both actions.

## 7. Impact

Implausible public biographical data that survives rebuilds.

## 8. Reproduction / witness

Not executed.

## 9. Disproof attempts

`createPlayerInTransaction` has no range checks, and there is no DB CHECK.

## 10. Existing-issue search

`createPlayerAction`, `createAndLinkPlayer` and `dobConfidence` hit only ISSUE-013 (atomicity). Classification: **new**.

## 11. Scope

Validation in the shared creation primitive.

## 12. Out of scope

Manual draft pick fields (AFLDB-ISSUE-290).

## 13. Proposed fix boundary

Validate in `createPlayerInTransaction` with `validateFieldValue` and the enum membership check, and return typed errors to both actions.

## 14. Proposed validation

DB-free: `createPlayerInTransaction(tx, { displayName: 'X', heightCm: -5 }, actor)` throws before any INSERT.

## 15. Decisions / unresolved questions

None.

## 16. Next action

Implementation.

## 17. Implementation record (2026-10-14)

- **Commit:** `sonnet/issue-291`, base `4277d017`. Files: `src/db/queries/players.ts`, `tests/player-link-mutations.test.ts`.
- **Fix.** New exported `validateNewPlayerFacts` in `src/db/queries/players.ts` runs `validateFieldValue` over `EDITABLE_ENTITIES.players.fields` for `dob` (real `YYYY-MM-DD` date, round-tripped), `dob_confidence` (`sourced|estimated|derived|unknown`), `height_cm` (120-230) and `weight_kg` (40-160), so creation and the Data Editor's edit surface share one rule and one set of messages. `createPlayerInTransaction` calls it before any statement and throws the first refusal. This is the runbook §13 boundary (validate in the shared primitive); the two actions are unchanged because both already turn a thrown message into a typed error: `createPlayerAction` returns `Could not create player: <message>`, and `createAndLinkPlayer` returns `The player and link could not be created: <message>` via `createPlayerAndResolveLink`'s catch. The transaction therefore rolls back before the player, its identity, its durable record or the link exist.
- **Other callers.** `createPlayerAndDraftPick` (already range-checked by ISSUE-290) now also gets the date and enumeration refusals as a `failed` draft refusal instead of a raw PostgreSQL error. The rebuild/registration tools (`register_issue224_s9_players.ts`, `manual_registration_rebuild_rehearsal_fixture.ts`) pass only names and notes, so they are unaffected.
- **Not changed.** The actions still turn a non-integer height or weight (for example `abc`) into an absent value rather than a refusal; nothing is stored from it, so it is outside this issue. No birth-year range check was added (the Data Editor's `birth_year` fields are derived separately).
- **Tests (DB-free, `tests/player-link-mutations.test.ts`, "player creation facts").** Seven `createPlayer` refusals (height below/above, weight below/above, unknown confidence, impossible date, malformed date) each assert the exact message and that no statement ran; boundary acceptance (120/230, 40/160, blanks); the Data Editor action returns the typed error with no statement and no audit; create-and-link returns the typed error with no `INSERT INTO players`, no `UPDATE draft_picks` and no audit.

## 17.1 Validation (2026-10-14, assistant-run on the operator's explicit authorisation; Windows, DB-free)

- `npx vitest run tests/player-link-mutations.test.ts -t "player creation facts"`: **17 passed** (12 new). **Negative control:** with the validation call disabled, 9 of the new cases fail (8 passed); the file was restored byte-for-byte afterwards.
- `npx tsc --noEmit`: exit 0. `git diff --check`: exit 0. ESLint of the two files reports 22 problems (20 errors, 2 warnings), **identical to the unchanged tree** (`any` uses in the test file); none are new.
- Wider DB-free files run: `admin-draft-actions`, `data-overrides-source-contract` and `catalogue-lookups` pass. Two failures are pre-existing and unrelated, and are not rerun here: `player-link-mutations` "AFLDB-ISSUE-235 S6 ... I14 owns its actor" (Windows CRLF source-text assertion, fails identically at base) and `register-issue224-s9-dev-write-gate` (fails to load: `DATABASE_URL is not set`, identical at base).
- **Not run:** `tests/integration/data-editor.test.ts`, `admin-draft.test.ts` and other integration files (need `afldb_test`); any DEV/PROD action; any browser check. The runbook's §14 asks only for the DB-free refusal test.
