# AFLDB-ISSUE-272 — Legacy `match_results` builds the match key from the raw round code and creates duplicate matches

## 0. Status

- **Status:** Open (2026-10-08). Nothing implemented.
- **Severity:** Medium. **Area:** legacy CSV intake / match identity.
- **Key file:** `src/lib/ingest/datasets.ts` (`match_results`).
- **Origin:** full code review at `20a7a4bbdea835cdd3fc5520e65ad47d275bd881` (`issues/reviews/2026-10-08-full-code-review.md`, F-007; partition note R5a-F05).
- **Classification:** reproduced (DB-free witness W3).

## 1. Summary

Canonical match keys use the bare number for home-and-away rounds and upper-case codes for finals. `match_results` accepts any non-empty `round_code` and builds the key from the raw string. So `R1`, `gf` or `Round 1` produce a key that matches no existing match. The stored-row lookup and the lock find nothing, and `ON CONFLICT (match_key)` does not fire, so a second `matches` row is inserted for the same fixture.

## 2. Evidence

- `src/lib/ingest/datasets.ts`:
  - `:640-662`: any non-empty `round_code` is accepted when `round_number` is present; finals codes are upper-cased only for the type lookup (`:643`).
  - The raw `row.round_code` is used for the stored-breakdown lookup (`:716`), the lock set (`:778-783`) and the insert (`:806-809`, `:819`).
- The canonical recipe: `tools/migration/import_fitzroy_core.py:1213-1221` (`R(\d+)` → bare number) and `:1880-1884`. `public/samples/match-results.csv:2-3` uses the bare number.
- `src/db/migrations/003_matches.sql:23`: `matches` has no other natural-key uniqueness.

## 3. Trigger

A row such as `season=2024, round_code=R1, round_number=1, match_date=2024-03-15, home_club=Richmond, away_club=Carlton, …` (fitzRoy's own round spelling), or `round_code=gf` for an existing Grand Final.

## 4. Expected invariant

The round code is normalised to the canonical form at validation, or refused, and the normalised code is used for the key, lookup, lock and insert.

## 5. Actual behaviour

The row validates `ok`, and promotion inserts a duplicate canonical match. Downstream, `resolveMatch` (`datasets.ts:290-295`) matches `round_code` exactly, so a `player_match_stats` file with the same spelling attaches to the duplicate.

## 6. First wrong layer

`src/lib/ingest/datasets.ts:640-662` (no normalisation), used at `:716`, `:778-783` and `:806-809`.

## 7. Impact

- Duplicate canonical matches, which double-count season, ladder, head-to-head and club pages.
- Player statistics split between the two rows.
- Nothing appears on the review page.

## 8. Reproduction / witness

W3 (DB-free, the `lockSql` stub pattern from `tests/ingest-datasets.test.ts:751`), output `D:\tmp\review-20261008-full\witness\w2.out`: `W3 match_results lock keys -> [["2024|R1|2024-03-15|Richmond|Carlton"]]`. The expected key is `2024|1|…`.

## 9. Disproof attempts

- There is no DB uniqueness on the natural key.
- `resolveMatch` and `matchResultsKey` do no normalisation.

## 10. Existing-issue search

- ISSUE-185 (provenance on this upsert), ISSUE-258 F-258-I4 (a different INFO), ISSUE-264 F-002 (lock order).
- Classification: **new**.

## 11. Scope

`match_results` round-code normalisation and its four key-building call sites.

## 12. Out of scope

Duplicate detection by club alias (AFLDB-ISSUE-306).

## 13. Proposed fix boundary

- One helper in `validateRow`: strip a leading `R` from a home-and-away code, upper-case finals codes, refuse anything else.
- Carry it as `resolved.round_code` and use it everywhere the key is built.

## 14. Proposed validation

1. DB-free: W3 must yield `2024|1|…`; add `validateRow` cases for `R1` / `gf` / `Round 1`.
2. Integration: promote `R1` against an existing `1` match and assert there is still one row.

## 15. Decisions / unresolved questions

- Whether any DEV or PROD promotion has already created such a duplicate. Read-only census: `matches` grouped by `(season, match_date, home_club_id, away_club_id)` having `count > 1`.

## 16. Next action

Implement together with AFLDB-ISSUE-271, then run the census.
