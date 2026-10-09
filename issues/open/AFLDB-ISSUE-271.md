# AFLDB-ISSUE-271 — Legacy `match_results` promotion overwrites Data Editor corrections on `matches`

## 0. Status

- **Status:** Open (2026-10-08). Nothing implemented.
- **Severity:** Medium. **Area:** legacy CSV intake / admin authority.
- **Key files:** `src/lib/ingest/datasets.ts` (`match_results` `validateRow`, `preparePromotion`, `promoteRow`).
- **Origin:** full code review at `20a7a4bbdea835cdd3fc5520e65ad47d275bd881` (`issues/reviews/2026-10-08-full-code-review.md`, F-006; partition note R5a-F04). The main session re-read `datasets.ts:805-861`.
- **Classification:** code-proven.

## 1. Summary

A Data Editor correction on a match (score, attendance, venue and so on) writes an active `data_overrides` row. Manual-authority treats that row as a human decision, so the settles honour it. The legacy `match_results` promotion overwrites the same columns with the file's values, unconditionally, and neither validation nor promotion reads `data_overrides`. Afterwards the override row stays active, and it now shields the CSV value from source correction.

## 2. Evidence

- `src/lib/ingest/datasets.ts:811-861`: `ON CONFLICT (match_key) DO UPDATE SET round_number, round_type, is_final, venue_id, venue_raw, home_score, away_score, result, winner_club_id, margin …` (goals, behinds and attendance when supplied).
- Neither `validateRow` (`:621-766`) nor `preparePromotion` (`:774-794`) reads `data_overrides`.
- `src/db/queries/data-edits.ts:235-258` writes the override "so importers can replay it".
- `src/lib/acquisition/manual-authority.ts:714-719` treats active `matches` overrides as manual authority.
- The established refusal pattern:
  - `award_winners`: ISSUE-165 D-12, `datasets.ts:473-490`.
  - `player_match_stats`: ISSUE-264, `datasets.ts:901-949, :1087-1162`.

## 3. Trigger

1. An administrator corrects a match score in the Data Editor.
2. A super admin later promotes a `match_results` file that carries the old score for that match.

## 4. Expected invariant

A supplied value that differs from an active human override is refused, at validation for the report and again under the match lock at promotion. An identical value passes.

## 5. Actual behaviour

The reviewed correction is reverted silently. The override stays active, and the settles then leave the reverted value alone.

## 6. First wrong layer

`src/lib/ingest/datasets.ts:811-861`, together with the absence of an override read in `:621-794`.

## 7. Impact

Silent reversal of durable admin corrections on canonical `matches`. The wrong value is then protected indefinitely. ISSUE-264 graded the same class Medium for `player_match_stats`.

## 8. Reproduction / witness

Not executed (DB-backed). See §14.

## 9. Disproof attempts

- `afldb_import` can read `data_overrides`, as the 264 path already does.
- No replay runs after promotion.
- ISSUE-264's exclusion of `match_results` was reasoned on Match Sheet authority only (`issues.md:48506`). Data Editor overrides on `matches` were not considered.

## 10. Existing-issue search

- ISSUE-264 scope (`issues.md:48502-48507`), ISSUE-258 (`:47400`), ISSUE-185 (provenance only).
- Classification: **new**. Cross-references AFLDB-ISSUE-264, ISSUE-165 D-12 and ISSUE-261.

## 11. Scope

The `match_results` dataset: validation report and promotion refusal.

## 12. Out of scope

The `player_match_stats` dataset (already ISSUE-264), and the `match_attendance` dataset (its override semantics are a separate decision).

## 13. Proposed fix boundary

- Under the existing match lock in `preparePromotion`, read the active `data_overrides` for the target `match_key`s and refuse any row whose supplied value for a field in an active group differs from the override.
- Mirror the check in `validateRow` for the report.
- Enumerate the `matches` field groups from `src/lib/edit/spec.ts`.

## 14. Proposed validation

1. DB-free: `preparePromotion` with a stub `sql` that returns an override → refusal naming the field.
2. Integration: edit a score, promote the old figure, then assert the score is unchanged and the submission failed with the refusal.

## 15. Decisions / unresolved questions

- None. The precedent is ISSUE-264 D-264-*.

## 16. Next action

Implement together with AFLDB-ISSUE-272 (the same dataset functions).
