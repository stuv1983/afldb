# AFLDB-ISSUE-305 — Legacy intake validation accepts values promotion then rejects

## 0. Status

- **Status:** Resolved (2026-10-15, merge-scoped; opened 2026-10-08). Implementation §17; readiness, merge and closure §18.
- **Severity:** Low. **Area:** legacy CSV intake validation.
- **Key file:** `src/lib/ingest/datasets.ts`.
- **Origin:** full code review at `20a7a4bbdea835cdd3fc5520e65ad47d275bd881` (`issues/reviews/2026-10-08-full-code-review.md`, F-040; partition note R5a-F08).
- **Classification:** reproduced (DB-free witness W4).

## 1. Summary

- Dates are validated only against `^\d{4}-\d{2}-\d{2}$`, so `2024-02-30` validates.
- `player_bio` numeric fields use `Number()`, so `8e1`, `1.8e2`, `0x50` and `80.0` validate as integers.

After Super Admin approval of a clean report, promotion then fails on the `::date` / `::smallint` cast, and the whole submission rolls back to `failed` with a PostgreSQL message.

## 2. Evidence

- `src/lib/ingest/datasets.ts:664` and `:1246` (date regex only), `:1250-1255` (`Number()`), and `:821`, `:1275`, `:1279-1280` (casts).
- `src/lib/ingest/pipeline.ts:425-432` (rollback to `failed`).
- The stated contract: validation refuses what promotion cannot write (`datasets.ts:33-44`).

## 3. Trigger

A file containing `match_date=2024-02-30`, or `height_cm=1.8e2`.

## 4. Expected invariant

Validation refuses what promotion cannot write.

## 5. Actual behaviour

The row validates `ok`, and the promotion then fails.

## 6. First wrong layer

`datasets.ts:664, :1246, :1250-1255`.

## 7. Impact

A workflow defect only; it fails closed, with no corruption.

## 8. Reproduction / witness

W4 (DB-free), output `D:\tmp\review-20261008-full\witness\w2.out`:
- `player_bio {height_cm: '1.8e2'}` → `ok`.
- `player_bio {dob: '2024-02-30'}` → `ok`.

## 9. Disproof attempts

ISSUE-258 hardened only the count columns of two datasets.

## 10. Existing-issue search

ISSUE-258 (`issues.md:47399-47401`). Classification: **new**.

## 11. Scope

Date and integer parsing in the legacy validators.

## 12. Out of scope

`match_attendance` blank handling (AFLDB-ISSUE-268).

## 13. Proposed fix boundary

Use a strict `^\d+$` reader for integers, and validate dates by a `Date.UTC` round-trip.

## 14. Proposed validation

DB-free `validateRow` cases in `tests/ingest-datasets.test.ts`.

## 15. Decisions / unresolved questions

- Hypothesis H-305-1: `rising_star` votes and stat-line values may accept negative integers (`datasets.ts:365-368, :383`). Deciding evidence: whether the `award_nominations` DDL has a CHECK.

## 16. Next action

None. Resolved (§18). The H-305-1 follow-up (§17) waits for an operator decision.

## 17. Implementation record (2026-10-15)

- **Commits:** `d82e891e6dbf52891b4123924a777b40ea317424` (fix) and `5282322ba0ffd1f1ad701a13b3e924df55144bc7` (tests), on `sonnet/issue-305`, base `1185bad3`. Single agent, no subagents.
- **Shape (§13).** Two private helpers in `src/lib/ingest/datasets.ts`: `isRealIsoDate` (strict `YYYY-MM-DD` shape plus plain Gregorian arithmetic; not `Date.UTC`, which remaps years 0-99; year 0000 refused as PostgreSQL's date input does, the same rule as `coachDobError`) and `isWholeNumberCell` (`^\d+$` plus a range). `match_results` `match_date` and `player_bio` `dob` use the first; `player_bio` `height_cm` and `weight_kg` use the second. Reason texts keep their wording, with "a real date" added to the date ones. The boundary is exactly §13: a stricter reading than the cast (for example `+180`, which PostgreSQL would cast) is refused, which is the safe direction.
- **Not changed (reported).** `toIntOrNull` (`season`, `round_number`, scores) still reads `1e2` as 100; those values reach promotion as numbers (`resolved.*`), never as text cast in SQL, so they cannot fail a cast. `player_bio.player_id` likewise. `match_attendance` is ISSUE-268 and untouched.
- **H-305-1 determined (not a fix).** `award_nominations` (`src/db/migrations/005_brownlow_awards.sql:113-131`) has `votes smallint` with **no CHECK**, and no later migration adds one (the only `award_nominations` constraint after 005 is the `source_uq` unique key, migration 042). The `rising_star` `validateRow` never reads `votes` or the stat-line columns at all; `promoteRow` reads them through `toIntOrNull`, so a negative value is stored as given and an unreadable one is silently dropped to null. By reading (not executed), a `votes` above 32,767 would fail the `smallint` parameter at promotion, the same class as this issue. Deliberately **not** changed: which `rising_star` cells to refuse (negative? blank? unreadable?) alters what existing uploads are accepted and is a behaviour decision outside §13. Recorded as a follow-up for an operator decision, not a gate.

## 17.1 Validation (2026-10-15, assistant-run on the owner's explicit authorisation; Windows, DB-free)

- New cases: 39, in a new `describe('AFLDB-ISSUE-305 validation refuses what promotion cannot cast')` of `tests/ingest-datasets.test.ts` (the suite the runbook names): `match_date` refusals (impossible days in 30/31-day months, non-leap Feb 29 including the 1900 and 2100 century years, month 13 and 00, day 00, year 0000, short forms) and real dates still admitted (leap days 2024 and 2000, year-end, year 0001); `player_bio` dob refusals, `height_cm` and `weight_kg` refusals (`1.8e2`, `18e1`, `0xB4`, `180.0`, `+180`, embedded space, text, and for weight `8e1`, `8.0e1`, `0x50`, `80.0`), out-of-range and huge-digit heights still refused, every bad column named in one report, and plain real values (including a leading-zero weight and blank cells) still admitted.
- Result: `tests/ingest-datasets.test.ts` **299 passed (299)** (260 before). The six DB-free test files that import `@/lib/ingest/datasets`: 513 passed, **2 failed**: both in `tests/honours-lifecycle-public-contract.test.ts` ("filters every scan it makes", `src/db/queries/awards.ts`), identical on unchanged `main` `1185bad3` (re-run in the primary checkout: 2 failed), unrelated and untouched. `npx tsc --noEmit` exit 0, `npx eslint` of both files exit 0, `git diff --check` exit 0.
- **Against the pre-fix source** (`datasets.ts` restored to `1185bad3`, then back): **25 of the 39 `ISSUE-305` cases fail**; the 14 that pass either way are the "still admits" controls.

## 17.2 Mutation checks of the tests (2026-10-15, assistant-run; Windows, DB-free)

Each mutant changes the real fix, is applied alone and restored from the saved bytes (verified identical afterwards); only the `ISSUE-305` cases are run. Script and raw output: `D:\tmp\issue305\mutate.py`, `mutation.txt`.

| Mutant | Result |
|---|---|
| M1 day limit ignored (always 31) | killed (9) |
| M2 century rule dropped from the leap test | killed (2) |
| M3 year 0 allowed | killed (1) |
| M4 month upper bound dropped | **survived: equivalent mutant.** An out-of-range month indexes `monthDays` at `undefined`, so `day <= undefined` is false and the day bound already refuses it; the explicit bound is defence in depth |
| M5 height back to `Number()` | killed (6) |
| M6 weight back to `Number()` | killed (6) |
| M7 dob back to shape-only | killed (5) |
| M8 `match_date` back to shape-only | killed (9) |
| M9 whole-number reader loses its upper bound | killed (2) |
| M10 whole-number reader loses its digits-only shape | killed (11) |

9 of 10 killed; the one survivor is equivalent.

## 17.3 Limits

Not deployed. No PostgreSQL, integration, browser, DEV or PROD action: the `::date` and `::smallint` casts are PostgreSQL's, so "promotion cannot write it" is established from the cast rules and the review's account of the failure, not by a promotion run. The validators are exercised through a fake `sql` tag. The `rising_star` `votes` observation above is code reading, not executed.

## 18. Readiness, merge and closure (2026-10-15)

- **Readiness: accepted under a scoped cleanliness exception, not a clean pass.** `npm run preflight -- --mode implementation --issue 305`: READY (0 blockers, 3 warnings: `.env`, `psql`, `pg_restore`; raw `D:\tmp\issue305\preflight-impl-raw.txt`). `npm run merge:ready -- --issue 305` with eight `--expected-file` rules (raw output, unchanged: `D:\tmp\issue305\merge-ready-raw-1.txt`, sha-256 `e199b090c8354764c7c4bffb842595a4aeeec9e751213ba70954b683837ed3ac`): every check PASS (branch, clean issue worktree, `main` equals recorded `origin/main`, ahead 3 / behind 0, migration parity, declared scope 4 changed / 0 unexpected) except **one blocker, "main worktree is clean"**; one warning (no runbook readiness block); database parity not checked. The raw output ends `Merge readiness: BLOCKED (1 blocker(s), 1 warning(s))`.
- **Exception (fresh, this issue only).** The owner authorised an exception for ISSUE-305, covering only that clean-tree FAIL under the exact **18**-path primary state: the nine `.agents/skills` files, the seven zero-byte stray-named files (`0)`, ``20` ``, ``` `path ```, `i`, `q(sequenceValueSql(qname))))[0]`, `t.kind`, `void`), the literal `$null)` and the zero-byte `2000)`. No earlier ratification was reused. The path set, no tracked or staged change, and full content hashes were verified by `D:\tmp\issue305\exception-check.py` (an adaptation of the ISSUE-310 script): `precheck-1` and `premerge-1` before, and `postmerge-1` after, the first push, all RESULT OK. The nine skill files equal the 13 Oct manifests; the seven zero-byte files and `2000)` are regular, 0 bytes, sha-256 `e3b0c442...b855`; `$null)` is 143 bytes, mtime 2026-10-14 20:00:49 (not rewritten this session), full sha-256 `d9edb1467a9ddecc7ca89424e5b5597f3c6fae7e5e41b49bb279aa1f71f62500`, identical at every check. This is current equality, not continuous preservation. No additional path or changed content appeared.
- **Merge.** Fresh `git fetch` and `git ls-remote` showed `main` at `1185bad3` immediately before the merge. `d82e891e`, `5282322b` and the records commit `1ba75b06` fast-forwarded onto `main` and were pushed (`1185bad3..1ba75b06`); local `main`, the fetched `origin/main` and `git ls-remote origin refs/heads/main` all equalled `1ba75b06` afterwards.
- **Resolution.** Resolved on the push of the documentation-only closure commit, under §14: its one item (DB-free `validateRow` cases in `tests/ingest-datasets.test.ts`) is met by §17.1. §15's H-305-1 is a hypothesis whose deciding evidence (the `award_nominations` DDL) is now read and recorded in §17; it asked for no fix, and the change it would imply (which `rising_star` cells to refuse) is a behaviour decision, so it does not gate closure. The closure scope is **merge-scoped**: code on `main`, DB-free validated, **not deployed**.
- **Preserved limits.** Not deployed. No PostgreSQL, integration, browser, network-acquisition, DEV or PROD action; no promotion was run, so "promotion would have failed" rests on the cast rules and the review's account. **Open follow-up (operator decision, not a gate):** `rising_star` `votes` and stat-line cells are not validated (negative accepted, unreadable dropped, `votes` above 32,767 would fail at promotion by reading). Two pre-existing unrelated failures in `tests/honours-lifecycle-public-contract.test.ts` are untouched and identical on unchanged `main`.
