# AFLDB-ISSUE-306 — Legacy intake duplicate detection compares raw club text

## 0. Status

- **Status:** **Resolved (2026-10-14, merge-scoped)**, on the push of the documentation-only closure commit (§18). Implemented as `3372667f` and `e060cb49` on `sonnet/issue-306` (base `18faa58e`), merged and pushed with its records as `cf58e03d`; DB-free validated (§17.1, §17.2). **Not deployed.**
- **Severity:** Low. **Area:** legacy CSV intake validation.
- **Key files:** `src/lib/ingest/datasets.ts` (`fileKey`), `src/lib/ingest/pipeline.ts`.
- **Origin:** full code review at `20a7a4bbdea835cdd3fc5520e65ad47d275bd881` (`issues/reviews/2026-10-08-full-code-review.md`, F-041; partition note R5a-F09).
- **Classification:** code-proven.

## 1. Summary

In-file duplicate detection keys on the raw payload text, while the database key uses resolved names. Two rows that name one match (or one player-match) under two club aliases both validate `ok`, and both are promoted. The second overwrites the first, and both are counted.

## 2. Evidence

- `src/lib/ingest/datasets.ts:619` and `:986-987` (`fileKey` from the raw payload), against `:806-809` and `:1047-1049` (database key from resolved names).
- `src/lib/ingest/pipeline.ts:220-231` (duplicate check on `fileKey`) and `:405` (counts).

## 3. Trigger

Two `match_results` rows for the same fixture, one naming `Carlton` and the other a recorded alias of Carlton.

## 4. Expected invariant

The duplicate is detected on the resolved key.

## 5. Actual behaviour

The later row silently wins.

## 6. First wrong layer

`datasets.ts:619, :986-987`.

## 7. Impact

A silent last-write-wins inside one file, invisible on the report.

## 8. Reproduction / witness

Not executed.

## 9. Disproof attempts

`preparePromotion` de-duplicates the lock set only (`:775-783`).

## 10. Existing-issue search

None. Classification: **new**.

## 11. Scope

Duplicate detection.

## 12. Out of scope

Round-code normalisation (AFLDB-ISSUE-272).

## 13. Proposed fix boundary

After validation, de-duplicate on the resolved key and mark the later row as an error, or refuse in `preparePromotion`.

## 14. Proposed validation

DB-free unit tests with a stub alias resolver.

## 15. Decisions / unresolved questions

None.

## 16. Next action

~~Implementation, alongside AFLDB-ISSUE-272.~~ Done 2026-10-14 (§17); merged and closed (§18).

## 17. Implementation record (2026-10-14)

- **Commits:** `3372667f` (fix and tests) and `e060cb49` (two further test cases) on `sonnet/issue-306`, base `18faa58e`. Source: `src/lib/ingest/datasets.ts`, `src/lib/ingest/pipeline.ts`. Tests: `tests/ingest-datasets.test.ts`, `tests/submission-review-actions.test.ts` (both existing suites; each already tests the code it extends).
- **Shape chosen (§13, first option).** `DatasetSpec.resolvedKey?(row, resolved)` is optional and defined only where the database key is built from resolved names or ids. `match_results`: `matchResultsKey(season, canonical round, match_date, resolved home name, resolved away name)`, the same string `preparePromotion` locks on and `promoteRow` writes. `player_match_stats`: `player #<player_id> in match #<match_id>`, the `ON CONFLICT (player_id, match_id)` key. `validateSubmission` keeps a second map of resolved keys; the first row that claims a key keeps its verdict, a later row becomes an `error` with `duplicate of row N: the same record once names are resolved (key "...")` and is counted once in `duplicates`. A row that is already a cell-text duplicate keeps that reason and is not counted twice; a row whose verdict is `error` claims nothing.
- **Promotion (§13, second option, as defence in depth).** `player_match_stats.preparePromotion` refuses the whole submission before any lock or query when two rows claim one `(player_id, match_id)`, even with identical values, naming up to ten collisions. This covers a submission validated before this fix, whose stored verdicts are `ok`. `match_results` already refused two rows on one canonical key (ISSUE-272), and now also reports it at validation.
- **Scope kept.** `all_australian`'s file key (`year:player:club` as typed) already matches its database record id (`season:player:club` as typed), so no resolved key is needed there; the other datasets key on ids or a source key. Round-code normalisation is ISSUE-272's and is reused, not changed.
- **Existing test changed.** `AFLDB-ISSUE-264 ... promotion re-check > admits identical and absent protected values at promotion` used two rows on one player-match only as a shortcut; it now runs its two cases as two submissions and keeps both assertions.

## 17.1 Validation (2026-10-14, assistant-run on the owner's explicit authorisation; Windows, DB-free)

- New cases: dataset-level (`resolvedKey` of both datasets for an alias, a round spelling, another date, round, season and swapped clubs; no key for an unresolved row; defined only on the two datasets), the `player_match_stats` promotion guard (identical values, up to ten collisions named with a count of the rest, distinct players and matches pass the check) and the real `validateSubmission` over a scripted database with the real `fileKey` and `resolvedKey` (alias duplicate, different fixtures untouched, double duplicate counted once, first claimant named for a third spelling, refused row claims nothing, a player-match under two club spellings, a dataset without a resolved key unchanged).
- Six related files (`ingest-datasets`, `submission-review-actions`, `email-intake-route`, `csv`, `afl-api-ingestion-control`, `afl-api-ingestion-safety`): **503 passed.** `npx tsc --noEmit`, `npx eslint` of the four changed files and `git diff --check`: exit 0. `npm run preflight -- --mode implementation --issue 306`: READY (0 blockers, 3 warnings: `.env`, `psql`, `pg_restore`; `D:\tmp\issue306\preflight-impl.txt`).
- **Against the pre-fix source** (`datasets.ts` and `pipeline.ts` restored to `18faa58e`, then back): **17 of the 291 cases in the two changed files fail.** The four pipeline cases fail on assertions (the alias duplicate is not flagged); the key cases fail because `resolvedKey` does not exist, and the guard cases because promotion does not refuse (`D:\tmp\issue306\vs-base-src.txt`).
- **Not run / limits:** PostgreSQL, the integration files (`tests/integration/{datasets,submission-promotion,match-results-promotion}.test.ts`; their multi-row fixtures use distinct fixtures and dates, so none is expected to meet the new rule, but they were read, not run), the full suite, any browser or DEV/PROD action. The scripted `validateRow` plays the alias resolver; the real resolver against `club_aliases` is the existing integration surface.

## 17.2 Mutation checks of the tests (2026-10-14, assistant-run; Windows, DB-free)

Each mutant changes the real fix, is applied alone to a clean tree and restored from Git (`D:\tmp\issue306\mutate.py`; outputs `mutation-<name>.txt`); the two changed test files are run against it. A kill counts only on an assertion failure.

| Mutant | Result against the final tests |
|---|---|
| M1 the pipeline never consults the resolved key | killed (4 cases) |
| M2 the duplicate is flagged but not counted | killed (4) |
| M3 a later row takes over the key | **survived the first tests**; killed (1) by the three-spellings case |
| M4 a refused row that carries a resolved value claims a key | **survived the first tests**; killed (1) by the refused-row case |
| M5 `match_results` keys on the typed clubs | killed (5) |
| M6 the canonical round is dropped from the `match_results` key | killed (4) |
| M7 the `player_match_stats` key ignores the player | killed (3) |
| M8 the `player_match_stats` key includes the typed club | killed (2) |
| M9 the promotion guard is removed | killed (2) |
| M10 the promotion guard keys on the match only | killed (3) |
| M11 the promotion guard keys on the club too | killed (1) |
| M12 a resolved key is registered on a dataset that should not have one | killed (1) |

All twelve fail on `AssertionError`. The two survivors were strengthened (a third spelling must name the first claimant; a refused row with a resolved value must claim nothing) and the full set re-run. The 291 cases pass unmutated.

## 18. Readiness, merge and closure (2026-10-14)

- **Readiness: accepted under a scoped cleanliness exception, not a clean pass.** `npm run preflight -- --mode implementation --issue 306`: READY (§17.1). `npm run merge:ready -- --issue 306` (raw output, unchanged: `D:\tmp\issue306\merge-ready-raw-1.txt`): every check PASS except **one blocker, "main worktree is clean"**, the primary checkout's **17** untracked paths (nine `.agents/skills` files, seven zero-byte stray-named files including `void`, and the literal `$null)`). Existing warnings: no `afldb-merge-readiness` block in this runbook; no unexpected-file classification (7 committed files); database parity not checked. The worktree was created with `git worktree add -b sonnet/issue-306 <path> 18faa58e` (the tip verified equal to the live remote by `git ls-remote`) and a `node_modules` junction, because `worktree:bootstrap` is blocked by the same strays.
- **Exception.** The owner authorised a fresh exception for this issue, covering only that clean-tree FAIL and the exact 17-path set, compared by full content hash, **verified immediately before each merge**. `D:\tmp\issue306\exception-check.py` (a copy of the read-only ISSUE-285 script) was run as `precheck-1`, as `premerge-1` immediately before the implementation merge and `postmerge-1` after its push, and again as `premerge-2` immediately before the closure merge and `postmerge-2` after it; every run RESULT OK. `$null)` (143 bytes, mtime 20:00:49) was hashed in full before each merge as `d9edb1467a9ddecc7ca89424e5b5597f3c6fae7e5e41b49bb279aa1f71f62500` and the check was run with that fresh value. Current equality with the saved 13 Oct snapshots, not continuous preservation. No stray was modified, moved or deleted.
- **Merge 1.** `3372667f`, `e060cb49` and the records commit `cf58e03d` fast-forwarded onto `main` (`18faa58e..cf58e03d`) and pushed; local `main`, the fetched `origin/main` and `git ls-remote origin refs/heads/main` all equalled it afterwards. Before the merge a fresh `git fetch` and `ls-remote` showed `main` still at `18faa58e`.
- **Resolution.** Resolved on the push of the documentation-only closure commit, under §14 ("DB-free unit tests with a stub alias resolver"), which is DB-free only and met (§17.1); §15 lists no open decision. The closure scope is **merge-scoped**: code on `main`, DB-free validated, **not deployed**.
- **Preserved limits.** Not deployed. No PostgreSQL or integration run: the real alias resolver against `club_aliases` and the promotion transaction are the existing integration surface, whose multi-row fixtures were read (distinct fixtures and dates) but not run. The scripted `validateRow` in the pipeline cases plays the resolver. An older validated `player_match_stats` submission that already holds two rows on one player-match is now refused at promotion and must be re-uploaded corrected. No historical data was assessed or repaired.
