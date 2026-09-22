# AFLDB-ISSUE-227 — `club_seasons` no-match integration test has no valid fixture

Status: **Open — recorded 2026-09-22 (final validation pass over AFLDB-ISSUE-224 §22, worktree
`afldb-issue-224-s9`, HEAD `0549a637`). Discovered as an unrelated pre-existing failure while
running the full `tests/integration/data-editor.test.ts` suite to validate the ISSUE-224 §22
replay/identity-sync fix. Not caused by, and not evidence against, that fix.**

## 1. Objective

Make `tests/integration/data-editor.test.ts` → *"refuses to build a ladder for a season it has no
matches for"* (AFLDB-ISSUE-015 fail-closed guard) self-contained, so it no longer depends on
`afldb_test` happening to contain a season with zero canonical non-final matches.

## 2. Symptom

The test's own precondition query:

```sql
SELECT s.year FROM seasons s
 WHERE NOT EXISTS (SELECT 1 FROM matches m
                    WHERE m.season = s.year AND NOT m.is_final)
 ORDER BY s.year DESC LIMIT 1
```

returns **zero rows** against the current `afldb_test`, so the test fails its own `expect(row,
'a canonical rebuild leaves the in-progress season without matches').toBeDefined()` assertion
**before** `recomputeClubSeasons()` is ever called. The guard under test — refusing the DELETE
inside `recomputeClubSeasons` when no canonical H&A source rows exist for a season — is never
exercised by this run; it is a fixture failure, not a guard failure.

## 3. Evidence

Read-only `afldb_test` proof (2026-09-22): `database = afldb_test`, `role = afldb_owner`,
`transaction_read_only = on`. The candidate query above returns 0 rows. Recent per-season match
counts on `afldb_test`:

| Season | Total | H&A | Finals |
|---|---|---|---|
| 2026 | 213 | 207 | 6 |
| 2025 | 216 | 207 | 9 |
| 2024 | 216 | 207 | 9 |
| 2023 | 216 | 207 | 9 |
| 2022 | 207 | 198 | 9 |
| 2021 | 207 | 198 | 9 |
| 2020 | 162 | 153 | 9 |
| 2019 | 207 | 198 | 9 |
| 2018 | 207 | 198 | 9 |
| 2017 | 207 | 198 | 9 |

Every season carries H&A rows. The comment at `tests/integration/data-editor.test.ts:584-592`
records that the intended trigger is "a season with no canonical home-and-away matches, which is
exactly the in-progress season's state after a canonical rebuild" (AFLDB-ISSUE-098/-099 boundary)
— that state no longer exists in the current baseline (2026 now carries 207 H&A rows), so the
fixture assumption is stale, not the guard.

## 4. Scope

- Make the ISSUE-015 no-canonical-H&A fail-closed test self-contained: construct and roll back its
  own test state (e.g. an isolated season/club row set inside the same `inRolledBackTransaction`)
  rather than relying on `afldb_test` naturally containing an empty season.
- Preserve the actual invariant under test: `recomputeClubSeasons` refuses **before** the DELETE
  when no canonical H&A source rows exist for the season.
- No production behaviour change unless a real defect in `recomputeClubSeasons` itself is
  separately found and proven — none is claimed here.
- Do not weaken or remove the assertion; do not blanket-skip the test.

## 5. Key files

`tests/integration/data-editor.test.ts:593-` (the test itself, AFLDB-ISSUE-015 origin), whatever
guard in `recomputeClubSeasons` the test exercises (`src/db/queries/` club-seasons rebuild path).

## 6. Next action

Design a self-contained fixture (isolated season/club rows constructed and rolled back within the
test's own transaction) that reproduces "no canonical H&A matches for a season" without depending
on live `afldb_test` state, then re-run the test in isolation and as part of the full
`data-editor.test.ts` suite.

## 7. Non-scope

Not fixed here. This record does not authorise any implementation change; AFLDB-ISSUE-224 §22
must not be blocked on it, and its validation evidence (typecheck, focused-suite, AFL API
regression and ISSUE-224 integration-test passes) stands independently of this pre-existing
fixture defect.
