# AFLDB-ISSUE-236 — `club_seasons` no-match integration test has no valid fixture

**Status: Resolved.**
**Opened:** 2026-09-22 (found while validating AFLDB-ISSUE-224; temporarily numbered
`AFLDB-ISSUE-227`, renumbered 2026-09-23 — see `issues.md`).
**Resolved:** 2026-09-23 (Opus 5.5), branch `sonnet/issue-236`, base `61eb9e98`.
**Classification:** test infrastructure. No production defect; no production code changed.

---

## Symptom

`tests/integration/data-editor.test.ts` → *Targeted club_seasons rebuild (AFLDB-ISSUE-015)* →
*refuses to build a ladder for a season it has no matches for* failed against `afldb_test`.

Reproduced 2026-09-23 with only that test selected:

```text
AssertionError: a canonical rebuild leaves the in-progress season without matches:
expected undefined to be defined
 ❯ tests/integration/data-editor.test.ts:601:8
Tests  1 failed | 12 skipped (13)
```

The failure is the test's precondition assertion. `recomputeClubSeasons()` was never called.

A read-only probe (`current_user = afldb_owner`, `current_database() = afldb_test`,
`transaction_read_only = on`) ran the test's own candidate query:

```sql
SELECT s.year FROM seasons s
 WHERE NOT EXISTS (SELECT 1 FROM matches m WHERE m.season = s.year AND NOT m.is_final)
 ORDER BY s.year DESC LIMIT 1
```

It returned **0 rows**. The latest real season is 2026.

## Root cause

A stale natural-fixture assumption. The test relied on `afldb_test` holding a season with no
canonical home-and-away match. Its comment named that season: the in-progress one, empty after a
canonical rebuild (the AFLDB-ISSUE-098/-099 boundary). Once the current season carried H&A rows, no
season in `afldb_test` qualified, so the test could not set up its own precondition. The guard was
not at fault.

## Production guard review (unchanged)

`recomputeClubSeasons(tx, season)` (`src/db/queries/player-derived.ts:413`):

1. counts `matches WHERE season = $1 AND NOT is_final`, so **finals are excluded**;
2. if the count is 0, throws
   `recomputeClubSeasons: no canonical home-and-away matches for season N; refusing to rebuild club_seasons from nothing`;
3. only after that runs `DELETE FROM club_seasons WHERE season = $1` and the rebuild `INSERT`.

The refusal therefore precedes every destructive statement. This is the ISSUE-015 fail-closed
intent, re-pointed by ISSUE-095 from "no staging ladder rows" to "no canonical H&A matches".
`tests/admin-match-mutations.test.ts` still pins the guard-before-DELETE ordering statically.

## Fix — test-owned transactional fixture (commit `6c55af0d`)

The test now builds its fixture inside the suite's existing `inRolledBackTransaction()` harness.
That harness always throws a private `Rollback` marker at the end of the body, so the transaction
cannot commit. A failed assertion also aborts it, and that error is re-thrown.

Inside the transaction the test:

1. **Refuses a collision.** It asserts that `seasons` and `matches` hold nothing for the reserved
   year **2083**. Committed integration fixtures use 2084–2099 (see
   `tests/integration/wildcard-final-fixture.ts`, `brownlow-fixture.ts`,
   `match-results-promotion.test.ts`), and this fixture is never committed.
2. **Adds rows rather than deleting canonical data.** It inserts `seasons(2083)`, one Grand Final
   (`round_type = 'grand_final'`, `is_final = true`, match key `issue236-2083-gf`) between the two
   lowest-id clubs, and one stood-up `club_seasons` row.
3. **Checks the fixture shape.** 1 match for the season, 0 of them home-and-away. Because canonical
   match rows exist but none are H&A, the test also proves the `NOT is_final` exclusion. The old
   fixture never proved this.
4. **Checks the refusal contract.** `recomputeClubSeasons(tx, 2083)` rejects with the **exact** full
   message, not just any error.
5. **Checks that nothing was deleted.** The stood-up `club_seasons` row is still present and
   unchanged (`[{ clubId, played: 0 }]`).

After the transaction the test checks, on the same connection, that no `seasons`, `matches` or
`club_seasons` row for 2083 persists.

The test no longer depends on the current season's number, on what `afldb_test` happens to contain,
or on the order other tests run in. Nothing is mocked.

## Validation (2026-09-23)

Environment: `afldb_test` over the workstation's 55432 tunnel. The worktree had no `.env`; the
four test DSNs (`AFLDB_TEST_DATABASE_URL`, `AFLDB_TEST_IMPORT_DATABASE_URL`,
`AFLDB_IMPORT_DATABASE_URL`, `AFLDB_AUTH_DATABASE_URL`) were set in memory with the database set to
`afldb_test`. Dependencies were installed with `npm ci`.

| Check | Result |
|---|---|
| Original failure reproduced (single test, base `61eb9e98`) | FAIL at `:601`, precondition, as above |
| Repaired target test | **PASS** (1 passed, 12 skipped by `-t` filter) |
| Full `tests/integration/data-editor.test.ts` | **13/13 PASS**, 0 skipped (import-role parity cases ran) |
| `tests/admin-match-mutations.test.ts` (guard ordering, DB-free) | **16/16 PASS** |
| `npm run typecheck` | **PASS** (`tsc --noEmit` exit 0) |
| Post-run read-only probe of `afldb_test` | 2083: `seasons 0`, `matches 0`, `club_seasons 0`; `issue236-%` match keys 0 |

No DEV, PROD or other database was touched.

## Acceptance

| Criterion | Status |
|---|---|
| Original failure reproduced | Yes |
| Root cause confirmed as stale fixture assumption | Yes |
| Self-contained transactional fixture implemented | Yes |
| Production guard unchanged | Yes |
| Target test PASS | Yes |
| Full data-editor integration file PASS | Yes, 13/13, no skips |
| Fixture rollback/isolation confirmed | Yes: guaranteed by the harness, asserted in the test, and confirmed by a separate probe |
| Typecheck PASS | Yes |
| No DEV/production mutation | Yes |

**Technical acceptance: COMPLETE.**

## Files

- `tests/integration/data-editor.test.ts`: the test fixture (commit `6c55af0d`).
- `issues.md`, `IssuesIndex.md`, `CHANGELOG.md`, this record: closure bookkeeping.
