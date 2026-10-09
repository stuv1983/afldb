# AFLDB-ISSUE-277 — Data Editor edits other than the name to a token-only player are not durable

## 0. Status

- **Status:** Open (2026-10-08). Nothing implemented.
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

D-277-1, then implementation and tests.
