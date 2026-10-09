# AFLDB-ISSUE-292 — Data Editor override key is chosen nondeterministically for a player with two AFL Tables paths

## 0. Status

- **Status:** Open (2026-10-08). Nothing implemented.
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

Implementation (small). Consider doing it together with AFLDB-ISSUE-277.
