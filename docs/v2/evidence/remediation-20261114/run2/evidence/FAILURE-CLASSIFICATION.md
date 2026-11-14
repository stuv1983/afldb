# Failure-by-failure classification (run 2, scope `evidence`)

Covers every failing test id behind `QUALIFICATION.md` §1–§4 (candidate `e8666c17`; its code equals `3aa82166` and `6c8b02cd`, see
`TESTED-REVISIONS.md`). Nothing here re-ran a test: every row is derived from the committed vitest JSON reports (DSNs masked) and the
review baseline's JSON on the host. `QUALIFICATION.md` is not edited; the orchestrator adds a pointer. The full per-id data, untruncated, is in
`failure-ids.tsv` beside this file (165 rows, columns as below).

## Evidence used

| Code | Evidence | Revision |
|---|---|---|
| B-U | host `/mnt/ssd/afldb-review-20261114T0640Z/evidence/unit.json`, sha256 `ccb609d72bb1406eed3cd4c81518a062aa5b2f4bbbe9ebda137206f26bf7b282` (107 failed, 11,739 passed) | `de640826` |
| B-I | host `/mnt/ssd/afldb-review-20261114T0640Z/evidence/integration.json`, sha256 `cfaa96326a23f53c4873eadf585451b5ae031ceec3b8abe881b4f276e7ab37cb` (99 failed + 5 file-level, 3,048 passed) | `de640826` |
| B-R:`x` | review baseline alone reruns, host `/mnt/ssd/afldb-review-20261114T0640Z/agents/tests/evidence/rerun-<x>.log` (`int-release-gates` sha256 `9851853a…`, `int-database` `dc4912d7…`, `int-admin-brownlow` `ea824ed8…`, `int-settle-afl-api-file` `7ad3b277…`, `int-awards-reload-links-venv` `06406d5e…`, `venv-draftguru-acquisition` `6f825604…`) | `de640826` |
| Q-BU, Q-BI | `qualification/broad-a119a999/unit.json.gz`, `integration.json.gz` (hashes in `qualification/SHA256SUMS`) | `a119a999` |
| Q-FU | `qualification/final-6c8b02cd/unit.json.gz` | `6c8b02cd` |
| Q-ISO, Q-ISO2 | `qualification/iso-3aa82166/*.json.gz`, `qualification/iso2-3aa82166/*.json.gz` | `3aa82166` |

Extraction: a read-only node script (`extract.mjs`, in my scratch) run on the host over copies of the committed `.json.gz` files and, in place, over B-U/B-I; it prints
`failed` assertions and file-level failures (a hook error that makes vitest report every test of the file as skipped). Test ids are `file + full test name`. "Same id, same text"
means the assertion text before ` at ` is identical (paths removed). Counts reproduce QUALIFICATION: 8 and 6 unit failures; 99 test failures plus 7 file-level failures in the broad
integration run (baseline 99 + 5).

## Classes

| Class | Meaning here |
|---|---|
| real (fixed) | a defect a remediation commit introduced; fixed later |
| environment | missing retained input, refusal by design (dedicated clone, name-pinned rebuild target, interpreter) |
| snapshot-oracle | assertion pinned to a literal of the rebuilt `afldb_test`; the 2026-11-04 production snapshot differs. **"Not caused by the remediation" is supported (same value at baseline); "cause = data-state mismatch" is inferred from the test's own pinned literal. Not verified on a rebuilt `afldb_test`: none exists.** |
| load-timeout | statement/hook/perf-ceiling failure only under the shared-load full parallel run; passes alone |
| fixture-leak | a committed fixture row left in the shared database changes another suite's precondition |
| accepted limitation | documented, tracked, unchanged since baseline (Gridley corpus) |
| unclassified | no class is supported by the evidence; stated, never relabelled |

A "pass alone" cell means the id was in a file that ran in the isolated passes (`iso`/`iso2`, one fresh snapshot copy per suite) and is not among that run's failures.
"Not run alone" means no isolated run covered the file: the class then rests on the failure text and baseline identity only.

## Summary

| Source (rows) | real (fixed) | environment | snapshot-oracle | load-timeout | fixture-leak | accepted limitation | unclassified |
|---|---|---|---|---|---|---|---|
| U1 §1 unit at `a119a999` (8) | 1 | 7 | | | | | |
| U2 §2 unit at `6c8b02cd` (6) | | 6 | | | | | |
| I1 §3/§4 isolated at `3aa82166` (45) | | 3 | 41 | | | 1 | |
| I2 §1 broad integration at `a119a999` (106 = 99 tests + 7 file-level) | | 10 | 31 | 56 | 6 (+1 inferred) | 1 | 1 |

Reading it: across all runs exactly **one** failure was caused by a remediation change (U1 row 8, fixed in `fb6ac276`, green at `3aa82166`). Every failure still present in the
isolated passes at `3aa82166` (I1, 45 rows) and in the final unit run (U2, 6 rows) either fails with the same text at the unfixed baseline `de640826` or is the 2 DraftGuru
Stage B1 tests, which need a sample file that exists nowhere. One id (I2, `database`, "separates the war years") is **unclassified** for mechanism: it is baseline-identical but its
interfering state was not found. The broad run's 13 "new" failures are dispositioned below, none code-caused.

## Per-failure tables

Columns: baseline `de640826` (B-U/B-I), alone (Q-ISO/Q-ISO2), class, note id (`Nn`, defined after the tables). Test ids are shortened to 100 characters here; `failure-ids.tsv` holds them whole.

#### U1: `tests/draftguru-acquisition.test.ts`

| # | test id | failure text | baseline `de640826` | alone | class | note |
|---|---|---|---|---|---|---|
| 1 | frozen Stage B1 sample (local snapshot) rebuilds byte-identically from the accepted Stage A snapshot | AssertionError: Required frozen sample is missing: data/sources/draft… | same id, same text | n/a (unit; fails identically at baseline) | environment | N1 |
| 2 | frozen Stage B1 sample (local snapshot) is the frozen 120 / 8 / 68 / 30 / 14 contract over the acce… | Error: ENOENT: no such file or directory, open 'data/sources/draftgur… | same id, same text | n/a (unit; fails identically at baseline) | environment | N1 |
| 3 | DraftGuru bridge import gate (plan / verify, read-only) DSN guard, read-only discipline, hash pins,… | AssertionError: 1. Clean plan on the pre-import state PASS 1.1 the pl… | not failing in the review full run (python interpreter did not resolve); fails … | passes at 6c8b02cd with Stage A present | environment | N2 |

#### U1: `tests/fitzroy-core-import.test.ts`

| # | test id | failure text | baseline `de640826` | alone | class | note |
|---|---|---|---|---|---|---|
| 4 | fitzRoy source row corrections leaves exactly the two genuine Round 10 rows | Error: ENOENT: no such file or directory, open 'data/sources/afltable… | same id, same text | n/a (unit; fails identically at baseline) | environment | N3 |
| 5 | fitzRoy source row corrections leaves the younger player's other appearances untouched | Error: ENOENT: no such file or directory, open 'data/sources/afltable… | same id, same text | n/a (unit; fails identically at baseline) | environment | N3 |
| 6 | fitzRoy source row corrections corrects exactly two rows and nothing else in 1909 | Error: ENOENT: no such file or directory, open 'data/sources/afltable… | same id, same text | n/a (unit; fails identically at baseline) | environment | N3 |
| 7 | blank Player fallback covers the four real 2025 players, retaining all 79 rows | Error: ENOENT: no such file or directory, open 'data/sources/afltable… | same id, same text | n/a (unit; fails identically at baseline) | environment | N3 |

#### U1: `tests/special-records-public-filter-contract.test.ts`

| # | test id | failure text | baseline `de640826` | alone | class | note |
|---|---|---|---|---|---|---|
| 8 | AFLDB-ISSUE-167 Stage 5 — public special-record reads are filtered classifies every file in src/ th… | AssertionError: A new file reads player_achievements or after_siren_k… | not failing in the review full run | passes at 3aa82166 and 6c8b02cd | real (fixed) | N4 |

#### U2: `tests/draftguru-acquisition.test.ts`

| # | test id | failure text | baseline `de640826` | alone | class | note |
|---|---|---|---|---|---|---|
| 9 | frozen Stage B1 sample (local snapshot) rebuilds byte-identically from the accepted Stage A snapshot | AssertionError: Required frozen sample is missing: data/sources/draft… | same id, same text | n/a (unit; fails identically at baseline) | environment | N1 |
| 10 | frozen Stage B1 sample (local snapshot) is the frozen 120 / 8 / 68 / 30 / 14 contract over the acce… | Error: ENOENT: no such file or directory, open 'data/sources/draftgur… | same id, same text | n/a (unit; fails identically at baseline) | environment | N1 |

#### U2: `tests/fitzroy-core-import.test.ts`

| # | test id | failure text | baseline `de640826` | alone | class | note |
|---|---|---|---|---|---|---|
| 11 | fitzRoy source row corrections leaves exactly the two genuine Round 10 rows | Error: ENOENT: no such file or directory, open 'data/sources/afltable… | same id, same text | n/a (unit; fails identically at baseline) | environment | N3 |
| 12 | fitzRoy source row corrections leaves the younger player's other appearances untouched | Error: ENOENT: no such file or directory, open 'data/sources/afltable… | same id, same text | n/a (unit; fails identically at baseline) | environment | N3 |
| 13 | fitzRoy source row corrections corrects exactly two rows and nothing else in 1909 | Error: ENOENT: no such file or directory, open 'data/sources/afltable… | same id, same text | n/a (unit; fails identically at baseline) | environment | N3 |
| 14 | blank Player fallback covers the four real 2025 players, retaining all 79 rows | Error: ENOENT: no such file or directory, open 'data/sources/afltable… | same id, same text | n/a (unit; fails identically at baseline) | environment | N3 |

#### I1: `tests/integration/release-gates.test.ts`

| # | test id | failure text | baseline `de640826` | alone | class | note |
|---|---|---|---|---|---|---|
| 15 | gate: Brownlow authority agrees with the canonical round votes for every career inside their covera… | AssertionError: expected 183 to be +0 // Object.is equality | same id, same text; baseline alone: B-R:int-release-gates (8 failed, 51 passed,… | fails alone (this is the alone run) | snapshot-oracle | N5 |
| 16 | gate: Advanced Search regression cases 50-199 goals and zero Brownlow votes returns the exact 261 p… | AssertionError: expected 268 to be 261 // Object.is equality | same id, same text; baseline alone: B-R:int-release-gates (8 failed, 51 passed,… | fails alone (this is the alone run) | snapshot-oracle | N5 |
| 17 | gate: club organizations and identities attaches every ladder row to the identity trading that seas… | AssertionError: expected { slug: 'western-bulldogs', …(3) } to match … | same id, same text; baseline alone: B-R:int-release-gates (8 failed, 51 passed,… | fails alone (this is the alone run) | snapshot-oracle | N5 |
| 18 | gate: absence is never zero records why each attendance is missing | AssertionError: expected [ …(2) ] to deeply equal [ …(2) ] | same id, same text; baseline alone: B-R:int-release-gates (8 failed, 51 passed,… | fails alone (this is the alone run) | snapshot-oracle | N5 |
| 19 | gate: birth dates leaves the remaining players honestly without a date | AssertionError: expected 110 to be 18 // Object.is equality | same id, text differs; baseline alone: B-R:int-release-gates (8 failed, 51 pass… | fails alone (this is the alone run) | snapshot-oracle | N5 |
| 20 | gate: 2026 is provisional (snapshot-pinned) reports 2026 Brownlow as pending, never as zero | AssertionError: expected 'complete' to be 'in_progress' // Object.is … | same id, text differs; baseline alone: B-R:int-release-gates (8 failed, 51 pass… | fails alone (this is the alone run) | snapshot-oracle | N5 |
| 21 | gate: 2026 is provisional (snapshot-pinned) awards no premier and no wooden spoon for 2026 | AssertionError: expected 1 to be +0 // Object.is equality | same id, same text; baseline alone: B-R:int-release-gates (8 failed, 51 passed,… | fails alone (this is the alone run) | snapshot-oracle | N5 |
| 22 | gate: 2026 is provisional (snapshot-pinned) is the only season still in progress | AssertionError: expected [] to deeply equal [ 2026 ] | same id, text differs; baseline alone: B-R:int-release-gates (8 failed, 51 pass… | fails alone (this is the alone run) | snapshot-oracle | N5 |

#### I1: `tests/integration/awards-reload-links.test.ts`

| # | test id | failure text | baseline `de640826` | alone | class | note |
|---|---|---|---|---|---|---|
| 23 | Coleman legacy to derived ownership transition (AFLDB-ISSUE-111) | afldb_test holds 47 Coleman winner row(s); the tracked contract decla… | not in the review full run (file skipped: python); same two errors in B-R:int-a… | fails alone (this is the alone run) | snapshot-oracle | N6 |
| 24 | Coleman derived reload preserves human link decisions (AFLDB-ISSUE-111) | afldb_test holds 47 Coleman winner row(s); the tracked contract decla… | not in the review full run (file skipped: python); same two errors in B-R:int-a… | fails alone (this is the alone run) | snapshot-oracle | N6 |

#### I1: `tests/integration/gridley-corpus.test.ts`

| # | test id | failure text | baseline `de640826` | alone | class | note |
|---|---|---|---|---|---|---|
| 25 | Gridley corpus -- every cell through solveCellSummary writes the run report and has no failing cells | AssertionError: expected [ …(40) ] to deeply equal [] | same id, same text | fails alone (this is the alone run) | accepted limitation | N7 |

#### I1: `tests/integration/club-comparison.test.ts`

| # | test id | failure text | baseline `de640826` | alone | class | note |
|---|---|---|---|---|---|---|
| 26 | club comparison: head-to-head core summarises Adelaide vs Brisbane Lions to the canonical witness a… | AssertionError: expected 43 to be 41 // Object.is equality | same id, same text | fails alone (this is the alone run) | snapshot-oracle | N8 |
| 27 | club comparison: head-to-head core filters by match type so that home-and-away and finals partition… | AssertionError: expected 43 to be 41 // Object.is equality | same id, same text | fails alone (this is the alone run) | snapshot-oracle | N8 |
| 28 | club comparison: head-to-head core filters by era (Club Rivalry Explorer follow-up, FR-2) so the de… | AssertionError: expected 10 to be 8 // Object.is equality | same id, same text | fails alone (this is the alone run) | snapshot-oracle | N8 |
| 29 | club comparison: head-to-head core paginates the complete meetings list deterministically at 25 row… | AssertionError: expected [ { matchId: 13184, …(22) }, …(17) ] to have… | same id, same text | fails alone (this is the alone run) | snapshot-oracle | N8 |
| 30 | club comparison: head-to-head core groups venue records by canonical venue and agrees with an indep… | AssertionError: expected 43 to be 41 // Object.is equality | same id, same text | fails alone (this is the alone run) | snapshot-oracle | N8 |
| 31 | club comparison: head-to-head core reads streaks from chronological order, with a draw breaking a w… | AssertionError: expected 'b-win' to be 'a-win' // Object.is equality | same id, same text | fails alone (this is the alone run) | snapshot-oracle | N8 |
| 32 | club comparison: head-to-head core keeps Brisbane Bears and Fitzroy out of Brisbane Lions head-to-h… | AssertionError: expected [ …(43) ] to have a length of 41 but got 43 | same id, same text | fails alone (this is the alone run) | snapshot-oracle | N8 |
| 33 | club comparison: head-to-head core handles the Carlton vs Collingwood long rivalry, including Grand… | AssertionError: expected 270 to be 268 // Object.is equality | same id, same text | fails alone (this is the alone run) | snapshot-oracle | N8 |
| 34 | club comparison: crossover players lists everyone who represented both organisations, agreeing with… | AssertionError: expected [ { playerId: 2604, …(13) }, …(11) ] to have… | same id, same text | fails alone (this is the alone run) | snapshot-oracle | N8 |
| 35 | club comparison: crossover players reports Ben Keays as Brisbane Lions first, then Adelaide, in bot… | AssertionError: expected 156 to be 131 // Object.is equality | same id, same text | fails alone (this is the alone run) | snapshot-oracle | N8 |
| 36 | club comparison: crossover players summarises the first and most recent players to complete both re… | AssertionError: expected 12 to be 11 // Object.is equality | same id, same text | fails alone (this is the alone run) | snapshot-oracle | N8 |
| 37 | club comparison: head-to-head player leaders ranks H2H games leaders against independent SQL and th… | AssertionError: expected 22 to be 20 // Object.is equality | same id, same text | fails alone (this is the alone run) | snapshot-oracle | N8 |
| 38 | club comparison: head-to-head player leaders ranks H2H goals leaders without ever treating an unrec… | AssertionError: expected 57 to be 54 // Object.is equality | same id, same text | fails alone (this is the alone run) | snapshot-oracle | N8 |
| 39 | club comparison: head-to-head player leaders consolidates a player who represented both organisatio… | AssertionError: expected 16 to be 14 // Object.is equality | same id, same text | fails alone (this is the alone run) | snapshot-oracle | N8 |
| 40 | club comparison: head-to-head player leaders keeps every tied holder of the single-match goals and … | AssertionError: expected 42 to be 40 // Object.is equality | same id, same text | fails alone (this is the alone run) | snapshot-oracle | N8 |
| 41 | club comparison: head-to-head Brownlow counts eligible and covered meetings from home-and-away matc… | AssertionError: expected [ { matchId: 11178, …(4) }, …(39) ] to have … | same id, same text | fails alone (this is the alone run) | snapshot-oracle | N8 |
| 42 | club comparison: head-to-head by decade reproduces the Adelaide vs Brisbane Lions decade witness an… | AssertionError: expected [ [ 1990, 5, 2, 3, +0 ], …(3) ] to deeply eq… | same id, same text | fails alone (this is the alone run) | snapshot-oracle | N8 |
| 43 | club comparison: head-to-head by decade sums every Carlton vs Collingwood decade back to the comple… | AssertionError: expected 270 to be 268 // Object.is equality | same id, same text | fails alone (this is the alone run) | snapshot-oracle | N8 |
| 44 | club comparison: period-score rivalry records exposes pair-level period-score coverage for both wit… | AssertionError: expected 43 to be 41 // Object.is equality | same id, same text | fails alone (this is the alone run) | snapshot-oracle | N8 |
| 45 | club comparison: head-to-head player averages reuses the comparison metric registry rather than def… | AssertionError: expected 43 to be 41 // Object.is equality | same id, same text | fails alone (this is the alone run) | snapshot-oracle | N8 |
| 46 | club comparison: head-to-head player averages ranks the disposals average board on recorded games a… | AssertionError: expected [ [ 'Matt Crouch', 7, 30.71 ], …(2) ] to dee… | same id, same text | fails alone (this is the alone run) | snapshot-oracle | N8 |
| 47 | club comparison: head-to-head player averages applies the five-recorded-game minimum, per metric an… | AssertionError: expected 7 to be 5 // Object.is equality | same id, same text | fails alone (this is the alone run) | snapshot-oracle | N8 |
| 48 | club comparison: head-to-head player averages retains every tie at the rank-ten boundary and report… | AssertionError: expected 1 to be 2 // Object.is equality | same id, same text | fails alone (this is the alone run) | snapshot-oracle | N8 |
| 49 | club comparison: head-to-head player averages splits a crossover player average across both organis… | AssertionError: expected 16 to be 14 // Object.is equality | same id, same text | fails alone (this is the alone run) | snapshot-oracle | N8 |

#### I1: `tests/integration/settle-afl-api.test.ts`

| # | test id | failure text | baseline `de640826` | alone | class | note |
|---|---|---|---|---|---|---|
| 50 | AFLDB-ISSUE-235 OD-5: observeLiveReinstatement() against real PostgreSQL (post-COMMIT, pre-archive … | Error: Refusing to rebuild 'afldb_v2_remint2_settleapi_test': the onl… | same id, text differs; baseline alone: B-R:int-settle-afl-api-file (1 failed: R… | fails alone (this is the alone run) | environment | N9 |

#### I1: `tests/integration/admin-brownlow.test.ts`

| # | test id | failure text | baseline `de640826` | alone | class | note |
|---|---|---|---|---|---|---|
| 51 | migration 094 objects and backfill resolved every historical round row to exactly one match (prefli… | AssertionError: expected 9522 to be +0 // Object.is equality | same id, same text; baseline alone: B-R:int-admin-brownlow (1 failed, 45 passed) | fails alone (this is the alone run) | snapshot-oracle | N10 |

#### I1: `tests/integration/database.test.ts`

| # | test id | failure text | baseline `de640826` | alone | class | note |
|---|---|---|---|---|---|---|
| 52 | data integrity has the full player-match dataset | AssertionError: expected 695499 to be 685471 // Object.is equality | same id, same text; baseline alone: B-R:int-database (4 failed, 47 passed) | fails alone (this is the alone run) | snapshot-oracle | N11 |
| 53 | advanced search regression cases 200-249 games with 16 or more finals | AssertionError: expected 120 to be 114 // Object.is equality | same id, same text; baseline alone: B-R:int-database (4 failed, 47 passed) | fails alone (this is the alone run) | snapshot-oracle | N11 |
| 54 | advanced search regression cases 50-199 goals and no Brownlow votes | AssertionError: expected 268 to be 261 // Object.is equality | same id, same text; baseline alone: B-R:int-database (4 failed, 47 passed) | fails alone (this is the alone run) | snapshot-oracle | N11 |
| 55 | advanced search regression cases 200+ games, 100+ goals and 15+ finals | AssertionError: expected 223 to be 219 // Object.is equality | same id, same text; baseline alone: B-R:int-database (4 failed, 47 passed) | fails alone (this is the alone run) | snapshot-oracle | N11 |

#### I1: `tests/integration/draft-linkage.test.ts`

| # | test id | failure text | baseline `de640826` | alone | class | note |
|---|---|---|---|---|---|---|
| 56 | DraftGuru bridge on afldb_test — §6.1 reconciliation (read-only) persons partition exactly as the c… | AssertionError: expected 3559 to be 3465 // Object.is equality | same id, same text | fails alone (this is the alone run) | snapshot-oracle | N12 |
| 57 | DraftGuru bridge on afldb_test — §6.4 negative controls (read-only) withheld persons stay unlinked … | AssertionError: expected [ …(94) ] to deeply equal [] | same id, same text | fails alone (this is the alone run) | snapshot-oracle | N12 |

#### I1: `tests/draftguru-acquisition.test.ts`

| # | test id | failure text | baseline `de640826` | alone | class | note |
|---|---|---|---|---|---|---|
| 58 | frozen Stage B1 sample (local snapshot) rebuilds byte-identically from the accepted Stage A snapshot | AssertionError: Required frozen sample is missing: data/sources/draft… | same id, same text (review full run) | fails with Stage A present (QUALIFICATION §3 vitest 21… | environment | N13 |
| 59 | frozen Stage B1 sample (local snapshot) is the frozen 120 / 8 / 68 / 30 / 14 contract over the acce… | Error: ENOENT: no such file or directory, open 'data/sources/draftgur… | same id, same text (review full run) | fails with Stage A present (QUALIFICATION §3 vitest 21… | environment | N13 |

#### I2: `tests/integration/admin-brownlow.test.ts`

| # | test id | failure text | baseline `de640826` | alone | class | note |
|---|---|---|---|---|---|---|
| 60 | migration 094 objects and backfill resolved every historical round row to exactly one match (prefli… | AssertionError: expected 9522 to be +0 // Object.is equality | same id, same text | fails alone (same text) | snapshot-oracle | N14 |

#### I2: `tests/integration/admin-draft.test.ts`

| # | test id | failure text | baseline `de640826` | alone | class | note |
|---|---|---|---|---|---|---|
| 61 | (file-level: 53 tests reported) | need an empty draft year with active club identities: expected 0 to b… | same file-level error | passes alone (iso2-3aa82166 admindraft) | fixture-leak | N15 |

#### I2: `tests/integration/admin-season-lists.test.ts`

| # | test id | failure text | baseline `de640826` | alone | class | note |
|---|---|---|---|---|---|---|
| 62 | (file-level: 42 tests reported) | Committed fixture season(s) left in the test database by an interrupt… | not at baseline | passes alone (iso-3aa82166 gates) | fixture-leak | N16 |

#### I2: `tests/integration/afl-api-c7-observation.test.ts`

| # | test id | failure text | baseline `de640826` | alone | class | note |
|---|---|---|---|---|---|---|
| 63 | season opening (AFLDB-ISSUE-350) against PostgreSQL (rolled back) production-like state classifies … | AssertionError: expected [ 2026, 2027 ] to include 2076 | not failing (file at baseline: 3 passed / 0 failed / 0 skipped) | passes alone (iso-3aa82166 c7) | fixture-leak | N17 |
| 64 | season opening (AFLDB-ISSUE-350) against PostgreSQL (rolled back) a count mismatch between the plan… | AssertionError: expected [ 2026, 2027 ] to include 2076 | not failing (file at baseline: 3 passed / 0 failed / 0 skipped) | passes alone (iso-3aa82166 c7) | fixture-leak | N17 |
| 65 | season opening (AFLDB-ISSUE-350) against PostgreSQL (rolled back) the settle HALT precondition is t… | AssertionError: expected [ 2026, 2027 ] to include 2076 | not failing (file at baseline: 3 passed / 0 failed / 0 skipped) | passes alone (iso-3aa82166 c7) | fixture-leak | N17 |

#### I2: `tests/integration/awards-reload-links.test.ts`

| # | test id | failure text | baseline `de640826` | alone | class | note |
|---|---|---|---|---|---|---|
| 66 | awards importer production-role parity (AFLDB-ISSUE-083) imports the canonical Under 22 group as af… | Error: STACK_TRACE_ERROR | not failing (file at baseline: 0 passed / 0 failed / 107 skipped) | passes alone (iso-3aa82166 awards) | load-timeout | N18 |

#### I2: `tests/integration/club-comparison-route.test.ts`

| # | test id | failure text | baseline `de640826` | alone | class | note |
|---|---|---|---|---|---|---|
| 67 | Stage 7 route budget loads adelaide vs brisbane-lions inside the route budget | AssertionError: adelaide/brisbane-lions warm median 3301.8 ms: expect… | same id, text differs (AssertionError: adelaide/brisbane-lions warm medi…) | passes alone (iso2-3aa82166 clubcmp) | load-timeout | N19 |
| 68 | Stage 7 route budget loads carlton vs collingwood inside the route budget | AssertionError: carlton/collingwood warm median 4404.7 ms: expected 4… | same id, text differs (AssertionError: carlton/collingwood warm median 3…) | passes alone (iso2-3aa82166 clubcmp) | load-timeout | N19 |

#### I2: `tests/integration/club-comparison.test.ts`

| # | test id | failure text | baseline `de640826` | alone | class | note |
|---|---|---|---|---|---|---|
| 69 | club comparison: head-to-head core summarises Adelaide vs Brisbane Lions to the canonical witness a… | AssertionError: expected 43 to be 41 // Object.is equality | same id, same text | fails alone (same text) | snapshot-oracle | N20 |
| 70 | club comparison: head-to-head core filters by match type so that home-and-away and finals partition… | AssertionError: expected 43 to be 41 // Object.is equality | same id, same text | fails alone (same text) | snapshot-oracle | N20 |
| 71 | club comparison: head-to-head core filters by era (Club Rivalry Explorer follow-up, FR-2) so the de… | AssertionError: expected 10 to be 8 // Object.is equality | same id, same text | fails alone (same text) | snapshot-oracle | N20 |
| 72 | club comparison: head-to-head core paginates the complete meetings list deterministically at 25 row… | AssertionError: expected [ { matchId: 13184, …(22) }, …(17) ] to have… | same id, same text | fails alone (same text) | snapshot-oracle | N20 |
| 73 | club comparison: head-to-head core groups venue records by canonical venue and agrees with an indep… | AssertionError: expected 43 to be 41 // Object.is equality | same id, same text | fails alone (same text) | snapshot-oracle | N20 |
| 74 | club comparison: head-to-head core reads streaks from chronological order, with a draw breaking a w… | AssertionError: expected 'b-win' to be 'a-win' // Object.is equality | same id, same text | fails alone (same text) | snapshot-oracle | N20 |
| 75 | club comparison: head-to-head core keeps Brisbane Bears and Fitzroy out of Brisbane Lions head-to-h… | AssertionError: expected [ …(43) ] to have a length of 41 but got 43 | same id, same text | fails alone (same text) | snapshot-oracle | N20 |
| 76 | club comparison: head-to-head core handles the Carlton vs Collingwood long rivalry, including Grand… | AssertionError: expected 270 to be 268 // Object.is equality | same id, same text | fails alone (same text) | snapshot-oracle | N20 |
| 77 | club comparison: crossover players lists everyone who represented both organisations, agreeing with… | AssertionError: expected [ { playerId: 2604, …(13) }, …(11) ] to have… | same id, same text | fails alone (same text) | snapshot-oracle | N20 |
| 78 | club comparison: crossover players reports Ben Keays as Brisbane Lions first, then Adelaide, in bot… | AssertionError: expected 156 to be 131 // Object.is equality | same id, same text | fails alone (same text) | snapshot-oracle | N20 |
| 79 | club comparison: crossover players summarises the first and most recent players to complete both re… | AssertionError: expected 12 to be 11 // Object.is equality | same id, same text | fails alone (same text) | snapshot-oracle | N20 |
| 80 | club comparison: head-to-head player leaders ranks H2H games leaders against independent SQL and th… | AssertionError: expected 22 to be 20 // Object.is equality | same id, same text | fails alone (same text) | snapshot-oracle | N20 |
| 81 | club comparison: head-to-head player leaders ranks H2H goals leaders without ever treating an unrec… | AssertionError: expected 57 to be 54 // Object.is equality | same id, same text | fails alone (same text) | snapshot-oracle | N20 |
| 82 | club comparison: head-to-head player leaders consolidates a player who represented both organisatio… | AssertionError: expected 16 to be 14 // Object.is equality | same id, same text | fails alone (same text) | snapshot-oracle | N20 |
| 83 | club comparison: head-to-head player leaders keeps every tied holder of the single-match goals and … | AssertionError: expected 42 to be 40 // Object.is equality | same id, same text | fails alone (same text) | snapshot-oracle | N20 |
| 84 | club comparison: head-to-head Brownlow counts eligible and covered meetings from home-and-away matc… | AssertionError: expected [ { matchId: 11178, …(4) }, …(39) ] to have … | same id, same text | fails alone (same text) | snapshot-oracle | N20 |
| 85 | club comparison: maximum canonical season runs the complete selected season path for the maximum ca… | TypeError: Cannot read properties of null (reading 'clubId') | same id, same text | passes alone (iso2-3aa82166 clubcmp) | fixture-leak (inferred) | N21 |
| 86 | club comparison: head-to-head by decade reproduces the Adelaide vs Brisbane Lions decade witness an… | AssertionError: expected [ [ 1990, 5, 2, 3, +0 ], …(3) ] to deeply eq… | same id, same text | fails alone (same text) | snapshot-oracle | N20 |
| 87 | club comparison: head-to-head by decade sums every Carlton vs Collingwood decade back to the comple… | AssertionError: expected 270 to be 268 // Object.is equality | same id, same text | fails alone (same text) | snapshot-oracle | N20 |
| 88 | club comparison: period-score rivalry records exposes pair-level period-score coverage for both wit… | AssertionError: expected 43 to be 41 // Object.is equality | same id, same text | fails alone (same text) | snapshot-oracle | N20 |
| 89 | club comparison: head-to-head player averages reuses the comparison metric registry rather than def… | AssertionError: expected 43 to be 41 // Object.is equality | same id, same text | fails alone (same text) | snapshot-oracle | N20 |
| 90 | club comparison: head-to-head player averages ranks the disposals average board on recorded games a… | AssertionError: expected [ [ 'Matt Crouch', 7, 30.71 ], …(2) ] to dee… | same id, same text | fails alone (same text) | snapshot-oracle | N20 |
| 91 | club comparison: head-to-head player averages applies the five-recorded-game minimum, per metric an… | AssertionError: expected 7 to be 5 // Object.is equality | same id, same text | fails alone (same text) | snapshot-oracle | N20 |
| 92 | club comparison: head-to-head player averages retains every tie at the rank-ten boundary and report… | AssertionError: expected 1 to be 2 // Object.is equality | same id, same text | fails alone (same text) | snapshot-oracle | N20 |
| 93 | club comparison: head-to-head player averages splits a crossover player average across both organis… | AssertionError: expected 16 to be 14 // Object.is equality | same id, same text | fails alone (same text) | snapshot-oracle | N20 |
| 94 | club comparison: long rivalry performance keeps every warm H2H query under the query ceiling for bo… | AssertionError: adelaide/brisbane-lions getHeadToHeadBrownlow warm me… | same id, same text | passes alone (iso2-3aa82166 clubcmp) | load-timeout | N22 |
| 95 | club comparison: long rivalry performance keeps each independent parallel query group under the gro… | AssertionError: adelaide/brisbane-lions H2H group warm median 2843.3 … | same id, same text | passes alone (iso2-3aa82166 clubcmp) | load-timeout | N22 |
| 96 | club comparison: long rivalry performance keeps the route-equivalent composed data load under the r… | AssertionError: adelaide/brisbane-lions route-equivalent warm median … | same id, same text | passes alone (iso2-3aa82166 clubcmp) | load-timeout | N22 |

#### I2: `tests/integration/data-editor.test.ts`

| # | test id | failure text | baseline `de640826` | alone | class | note |
|---|---|---|---|---|---|---|
| 97 | Durable Match Sheet authority: rollback, replay and continuity (AFLDB-ISSUE-257 F-S9-03) (2a) repla… | AssertionError: afldb_test must hold no player_match_stats authority … | not failing (file at baseline: 43 passed / 0 failed / 13 skipped) | passes alone (iso-3aa82166 dataeditor) | environment | N23 |
| 98 | Durable Match Sheet authority: rollback, replay and continuity (AFLDB-ISSUE-257 F-S9-03) (2b) repla… | AssertionError: afldb_test must hold no player_match_stats authority … | not failing (file at baseline: 43 passed / 0 failed / 13 skipped) | passes alone (iso-3aa82166 dataeditor) | environment | N23 |
| 99 | Durable Match Sheet authority: rollback, replay and continuity (AFLDB-ISSUE-257 F-S9-03) (2c) repla… | AssertionError: afldb_test must hold no player_match_stats authority … | not failing (file at baseline: 43 passed / 0 failed / 13 skipped) | passes alone (iso-3aa82166 dataeditor) | environment | N23 |
| 100 | Durable Match Sheet authority: rollback, replay and continuity (AFLDB-ISSUE-257 F-S9-03) (3a) an ac… | AssertionError: afldb_test must hold no player_match_stats authority … | not failing (file at baseline: 43 passed / 0 failed / 13 skipped) | passes alone (iso-3aa82166 dataeditor) | environment | N23 |
| 101 | Durable Match Sheet authority: rollback, replay and continuity (AFLDB-ISSUE-257 F-S9-03) (3b) an ac… | AssertionError: afldb_test must hold no player_match_stats authority … | not failing (file at baseline: 43 passed / 0 failed / 13 skipped) | passes alone (iso-3aa82166 dataeditor) | environment | N23 |

#### I2: `tests/integration/database.test.ts`

| # | test id | failure text | baseline `de640826` | alone | class | note |
|---|---|---|---|---|---|---|
| 102 | data integrity has the full player-match dataset | AssertionError: expected 695499 to be 685471 // Object.is equality | same id, same text | fails alone (same text) | snapshot-oracle | N24 |
| 103 | Brownlow correctness separates the war years from merely uncollected seasons | AssertionError: expected [ 1942, 1943, 1944, 1945, 2026 ] to deeply e… | same id, same text | passes alone (iso2-3aa82166 misc) | unclassified | N25 |
| 104 | advanced search regression cases 200-249 games with 16 or more finals | AssertionError: expected 120 to be 114 // Object.is equality | same id, same text | fails alone (same text) | snapshot-oracle | N24 |
| 105 | advanced search regression cases 50-199 goals and no Brownlow votes | AssertionError: expected 268 to be 261 // Object.is equality | same id, same text | fails alone (same text) | snapshot-oracle | N24 |
| 106 | advanced search regression cases 200+ games, 100+ goals and 15+ finals | AssertionError: expected 223 to be 219 // Object.is equality | same id, same text | fails alone (same text) | snapshot-oracle | N24 |

#### I2: `tests/integration/draft-linkage.test.ts`

| # | test id | failure text | baseline `de640826` | alone | class | note |
|---|---|---|---|---|---|---|
| 107 | DraftGuru bridge on afldb_test — §6.1 reconciliation (read-only) persons partition exactly as the c… | AssertionError: expected 3559 to be 3465 // Object.is equality | same id, same text | fails alone (same text) | snapshot-oracle | N26 |
| 108 | DraftGuru bridge on afldb_test — §6.4 negative controls (read-only) withheld persons stay unlinked … | AssertionError: expected [ …(94) ] to deeply equal [] | same id, same text | fails alone (same text) | snapshot-oracle | N26 |

#### I2: `tests/integration/gridley-corpus.test.ts`

| # | test id | failure text | baseline `de640826` | alone | class | note |
|---|---|---|---|---|---|---|
| 109 | Gridley corpus -- criteria flags every criterion whose full eligible set takes over one second and … | AssertionError: expected [ 'clubs1' ] to deeply equal [] | not failing (file at baseline: 1211 passed / 1 failed / 0 skipped) | passes alone (iso-3aa82166 gridley) | load-timeout | N27 |
| 110 | Gridley corpus -- every cell through solveCellSummary writes the run report and has no failing cells | AssertionError: expected [ …(40) ] to deeply equal [] | same id, same text | fails alone (same text) | accepted limitation | N28 |
| 111 | Gridley corpus -- every cell through solveCellSummary conforms to the bounded approved-deferral pol… | AssertionError: expected [ …(11) ] to deeply equal [] | not failing (file at baseline: 1211 passed / 1 failed / 0 skipped) | passes alone (iso-3aa82166 gridley) | load-timeout | N27 |

#### I2: `tests/integration/player-link-concurrency.test.ts`

| # | test id | failure text | baseline `de640826` | alone | class | note |
|---|---|---|---|---|---|---|
| 112 | AFLDB-ISSUE-235 S6 (I8–I10): afl_api adjudication races I8 — two links for the same provider to dif… | PostgresError: canceling statement due to statement timeout | same id, same text | passes alone (iso2-3aa82166 matching) | load-timeout | N29 |
| 113 | AFLDB-ISSUE-235 S6 (I8–I10): afl_api adjudication races I9 — two providers linked to the same playe… | PostgresError: canceling statement due to statement timeout | same id, same text | passes alone (iso2-3aa82166 matching) | load-timeout | N29 |
| 114 | AFLDB-ISSUE-235 S6 (I8–I10): afl_api adjudication races I10 — an admin link racing a raw bridge-sty… | PostgresError: canceling statement due to statement timeout | same id, same text | passes alone (iso2-3aa82166 matching) | load-timeout | N29 |
| 115 | AFLDB-ISSUE-235 S6 (I8–I10): afl_api adjudication races I10 (revoke race; the brief's I10) — a revo… | PostgresError: canceling statement due to statement timeout | same id, same text | passes alone (iso2-3aa82166 matching) | load-timeout | N29 |

#### I2: `tests/integration/player-matching.test.ts`

| # | test id | failure text | baseline `de640826` | alone | class | note |
|---|---|---|---|---|---|---|
| 116 | source evidence extraction reads draft picks at draft_person grain, never per pick | PostgresError: canceling statement due to statement timeout | same id, same text | passes alone (iso2-3aa82166 matching) | load-timeout | N29 |
| 117 | source evidence extraction keeps the known player id out of the evidence the scorer sees | PostgresError: canceling statement due to statement timeout | same id, same text | passes alone (iso2-3aa82166 matching) | load-timeout | N29 |
| 118 | candidate blocking recalls the true player for confirmed links | PostgresError: canceling statement due to statement timeout | same id, same text | passes alone (iso2-3aa82166 matching) | load-timeout | N29 |
| 119 | club lineage and club text against real clubs carries the lineage on every source row and candidate… | PostgresError: canceling statement due to statement timeout | same id, same text | passes alone (iso2-3aa82166 matching) | load-timeout | N29 |
| 120 | club lineage and club text against real clubs gates lineage-aware club matching to the authorised s… | PostgresError: canceling statement due to statement timeout | same id, same text | passes alone (iso2-3aa82166 matching) | load-timeout | N29 |
| 121 | assessment over real rows raises no contradiction against links AFLDB already confirmed | PostgresError: canceling statement due to statement timeout | same id, same text | passes alone (iso2-3aa82166 matching) | load-timeout | N29 |

#### I2: `tests/integration/release-gates.test.ts`

| # | test id | failure text | baseline `de640826` | alone | class | note |
|---|---|---|---|---|---|---|
| 122 | (file-level: 67 tests reported) | Committed fixture season(s) left in the test database by an interrupt… | not at baseline | fails alone | fixture-leak | N30 |

#### I2: `tests/integration/settle-afl-api-issue276.test.ts`

| # | test id | failure text | baseline `de640826` | alone | class | note |
|---|---|---|---|---|---|---|
| 123 | (file-level: 4 tests reported) | ISSUE-276 cases cannot run: these existing canonical rows are not ISS… | same file-level error | not run alone | environment | N31 |

#### I2: `tests/integration/settle-afl-api.test.ts`

| # | test id | failure text | baseline `de640826` | alone | class | note |
|---|---|---|---|---|---|---|
| 124 | AFLDB-ISSUE-235 S6 (I2–I7, I6b–I6d): human afl_api adjudication against afldb_test I2 → I6 (revoke … | PostgresError: canceling statement due to statement timeout | same id, same text | passes alone (iso2-3aa82166 settleapi) | load-timeout | N32 |
| 125 | AFLDB-ISSUE-235 S6 (I2–I7, I6b–I6d): human afl_api adjudication against afldb_test I2 (D8 audit sha… | PostgresError: canceling statement due to statement timeout | same id, same text | passes alone (iso2-3aa82166 settleapi) | load-timeout | N32 |
| 126 | AFLDB-ISSUE-235 S6 (I2–I7, I6b–I6d): human afl_api adjudication against afldb_test I3 — atomicity: … | PostgresError: canceling statement due to statement timeout | same id, same text | passes alone (iso2-3aa82166 settleapi) | load-timeout | N32 |
| 127 | AFLDB-ISSUE-235 S6 (I2–I7, I6b–I6d): human afl_api adjudication against afldb_test I4/T2 (the brief… | PostgresError: canceling statement due to statement timeout | same id, same text | passes alone (iso2-3aa82166 settleapi) | load-timeout | N32 |
| 128 | AFLDB-ISSUE-235 S6 (I2–I7, I6b–I6d): human afl_api adjudication against afldb_test I4/T3 (the brief… | PostgresError: canceling statement due to statement timeout | same id, same text | passes alone (iso2-3aa82166 settleapi) | load-timeout | N32 |
| 129 | AFLDB-ISSUE-235 S6 (I2–I7, I6b–I6d): human afl_api adjudication against afldb_test I4/T4 — a link t… | PostgresError: canceling statement due to statement timeout | same id, same text | passes alone (iso2-3aa82166 settleapi) | load-timeout | N32 |
| 130 | AFLDB-ISSUE-235 S6 (I2–I7, I6b–I6d): human afl_api adjudication against afldb_test I4/T6 (the brief… | PostgresError: canceling statement due to statement timeout | same id, same text | passes alone (iso2-3aa82166 settleapi) | load-timeout | N32 |
| 131 | AFLDB-ISSUE-235 S6 (I2–I7, I6b–I6d): human afl_api adjudication against afldb_test I4/T7 — a link t… | PostgresError: canceling statement due to statement timeout | same id, same text | passes alone (iso2-3aa82166 settleapi) | load-timeout | N32 |
| 132 | AFLDB-ISSUE-235 S6 (I2–I7, I6b–I6d): human afl_api adjudication against afldb_test I4/T8 — every ac… | PostgresError: canceling statement due to statement timeout | same id, same text | passes alone (iso2-3aa82166 settleapi) | load-timeout | N32 |
| 133 | AFLDB-ISSUE-235 S6 (I2–I7, I6b–I6d): human afl_api adjudication against afldb_test I4/T9 — a surnam… | PostgresError: canceling statement due to statement timeout | same id, same text | passes alone (iso2-3aa82166 settleapi) | load-timeout | N32 |
| 134 | AFLDB-ISSUE-235 S6 (I2–I7, I6b–I6d): human afl_api adjudication against afldb_test I6b (Brownlow, O… | PostgresError: canceling statement due to statement timeout | same id, same text | passes alone (iso2-3aa82166 settleapi) | load-timeout | N32 |
| 135 | AFLDB-ISSUE-235 S6 (I2–I7, I6b–I6d): human afl_api adjudication against afldb_test I6d (lock) — whi… | PostgresError: canceling statement due to statement timeout | same id, same text | passes alone (iso2-3aa82166 settleapi) | load-timeout | N32 |
| 136 | AFLDB-ISSUE-235 S6 (I2–I7, I6b–I6d): human afl_api adjudication against afldb_test I6-LI (LINK_INDE… | PostgresError: canceling statement due to statement timeout | same id, same text | passes alone (iso2-3aa82166 settleapi) | load-timeout | N32 |
| 137 | AFLDB-ISSUE-235 S6 (I2–I7, I6b–I6d): human afl_api adjudication against afldb_test I7 — link and re… | PostgresError: canceling statement due to statement timeout | same id, same text | passes alone (iso2-3aa82166 settleapi) | load-timeout | N32 |
| 138 | AFLDB-ISSUE-235 S6 (I15, I16): the D15 replay fails closed and is idempotent against afldb_test I16… | Error: sources.key = 'afl_api' not found; migration 077 must be appli… | same id, same text | passes alone (iso2-3aa82166 settleapi) | environment | N33 |
| 139 | AFLDB-ISSUE-235 OD-5: observeLiveReinstatement() against real PostgreSQL (post-COMMIT, pre-archive … | PostgresError: canceling statement due to statement timeout | same id, same text | passes alone (iso2-3aa82166 settleapi) | load-timeout | N32 |
| 140 | AFLDB-ISSUE-235 OD-5: observeLiveReinstatement() against real PostgreSQL (post-COMMIT, pre-archive … | PostgresError: canceling statement due to statement timeout | same id, same text | fails alone (text differs: Error: Refusing to rebuild … | load-timeout | N32 |
| 141 | AFLDB-ISSUE-235 OD-5: observeLiveReinstatement() against real PostgreSQL (post-COMMIT, pre-archive … | PostgresError: canceling statement due to statement timeout | same id, same text | passes alone (iso2-3aa82166 settleapi) | load-timeout | N32 |
| 142 | AFLDB-ISSUE-235 OD-5: observeLiveReinstatement() against real PostgreSQL (post-COMMIT, pre-archive … | PostgresError: canceling statement due to statement timeout | same id, same text | passes alone (iso2-3aa82166 settleapi) | load-timeout | N32 |
| 143 | AFLDB-ISSUE-235 OD-5: observeLiveReinstatement() against real PostgreSQL (post-COMMIT, pre-archive … | PostgresError: canceling statement due to statement timeout | same id, same text | passes alone (iso2-3aa82166 settleapi) | load-timeout | N32 |

#### I2: `tests/integration/settle-afltables.test.ts`

| # | test id | failure text | baseline `de640826` | alone | class | note |
|---|---|---|---|---|---|---|
| 144 | AFLDB-ISSUE-099 settle — the transaction against PostgreSQL runs the whole write path in --dry-run … | Error: STACK_TRACE_ERROR | same id, same text | passes alone (iso-3aa82166 settle) | load-timeout | N34 |
| 145 | AFLDB-ISSUE-099 settle — the transaction against PostgreSQL applies observations, projections and c… | Error: STACK_TRACE_ERROR | same id, same text | passes alone (iso-3aa82166 settle) | load-timeout | N34 |
| 146 | AFLDB-ISSUE-099 settle — the transaction against PostgreSQL reruns idempotently: no payload, no ver… | Error: STACK_TRACE_ERROR | same id, same text | passes alone (iso-3aa82166 settle) | load-timeout | N34 |
| 147 | AFLDB-ISSUE-099 settle — the transaction against PostgreSQL marks a genuine omission absent inside … | Error: STACK_TRACE_ERROR | same id, same text | passes alone (iso-3aa82166 settle) | load-timeout | N34 |
| 148 | AFLDB-ISSUE-099 settle — the transaction against PostgreSQL keeps an observed-but-rejected record p… | Error: STACK_TRACE_ERROR | same id, same text | passes alone (iso-3aa82166 settle) | load-timeout | N34 |
| 149 | AFLDB-ISSUE-099 settle — the transaction against PostgreSQL clears absence on reappearance without … | Error: STACK_TRACE_ERROR | same id, same text | passes alone (iso-3aa82166 settle) | load-timeout | N34 |
| 150 | AFLDB-ISSUE-099 settle — the transaction against PostgreSQL keeps A -> B -> A as three ordered vers… | Error: STACK_TRACE_ERROR | same id, same text | passes alone (iso-3aa82166 settle) | load-timeout | N34 |
| 151 | AFLDB-ISSUE-099 settle — the transaction against PostgreSQL the data_issues disagreement lifecycle … | Error: STACK_TRACE_ERROR | same id, same text | passes alone (iso-3aa82166 settle) | load-timeout | N34 |
| 152 | AFLDB-ISSUE-099 settle — the transaction against PostgreSQL the data_issues disagreement lifecycle … | Error: STACK_TRACE_ERROR | same id, same text | passes alone (iso-3aa82166 settle) | load-timeout | N34 |
| 153 | AFLDB-ISSUE-099 settle — the transaction against PostgreSQL the data_issues disagreement lifecycle … | Error: STACK_TRACE_ERROR | same id, same text | passes alone (iso-3aa82166 settle) | load-timeout | N34 |
| 154 | AFLDB-ISSUE-099 settle — the transaction against PostgreSQL the data_issues disagreement lifecycle … | Error: STACK_TRACE_ERROR | same id, same text | passes alone (iso-3aa82166 settle) | load-timeout | N34 |
| 155 | AFLDB-ISSUE-099 settle — the transaction against PostgreSQL the data_issues disagreement lifecycle … | Error: STACK_TRACE_ERROR | same id, same text | passes alone (iso-3aa82166 settle) | load-timeout | N34 |
| 156 | AFLDB-ISSUE-099 settle — the transaction against PostgreSQL leaves every ISSUE-099-owned relation b… | Error: STACK_TRACE_ERROR | same id, same text | passes alone (iso-3aa82166 settle) | load-timeout | N34 |
| 157 | AFLDB-ISSUE-099 settle — the transaction against PostgreSQL obligation O1 left both projection sent… | Error: STACK_TRACE_ERROR | same id, same text | passes alone (iso-3aa82166 settle) | load-timeout | N34 |
| 158 | AFLDB-ISSUE-099 settle — the transaction against PostgreSQL opens no Brownlow target for an unlinke… | Error: STACK_TRACE_ERROR | same id, same text | passes alone (iso-3aa82166 settle) | load-timeout | N34 |
| 159 | AFLDB-ISSUE-099 settle — the transaction against PostgreSQL wrote no canonical fact row in any sett… | Error: STACK_TRACE_ERROR | same id, same text | passes alone (iso-3aa82166 settle) | load-timeout | N34 |
| 160 | AFLDB-ISSUE-099 settle — the transaction against PostgreSQL executes the whole write path under the… | Error: STACK_TRACE_ERROR | same id, same text | passes alone (iso-3aa82166 settle) | load-timeout | N34 |
| 161 | AFLDB-ISSUE-295 — the settle exception report lists only the apply failures of its own source shows… | Error: STACK_TRACE_ERROR | not failing (file at baseline: 3 passed / 17 failed / 65 skipped) | passes alone (iso-3aa82166 settle) | load-timeout | N34 |
| 162 | AFLDB-ISSUE-295 — the settle exception report lists only the apply failures of its own source does … | Error: STACK_TRACE_ERROR | not failing (file at baseline: 3 passed / 17 failed / 65 skipped) | passes alone (iso-3aa82166 settle) | load-timeout | N34 |

#### I2: `tests/integration/v2-brownlow-eligibility-2025-rehearsal.test.ts`

| # | test id | failure text | baseline `de640826` | alone | class | note |
|---|---|---|---|---|---|---|
| 163 | (file-level: 3 tests reported) | Dedicated 2025 twelve-ruling clone required | same file-level error | not run alone | environment | N35 |

#### I2: `tests/integration/v2-brownlow-production-correction.test.ts`

| # | test id | failure text | baseline `de640826` | alone | class | note |
|---|---|---|---|---|---|---|
| 164 | (file-level: 8 tests reported) | Dedicated Brownlow package clone required | same file-level error | not run alone | environment | N35 |

#### I2: `tests/integration/v2-coleman-publication.test.ts`

| # | test id | failure text | baseline `de640826` | alone | class | note |
|---|---|---|---|---|---|---|
| 165 | (file-level: 28 tests reported) | refusing to run: 1 Coleman 2001 row(s) already exist that this suite … | same file-level error | not run alone | environment | N36 |

## Notes (basis for each class)

| note | class | rows | basis (evidence) |
|---|---|---|---|
| N1 | environment | 4 | Reads `data/sources/draftguru/person-html-20260826/sample.json`, which exists in no retained location (QUALIFICATION §3). The read fails before any repository code runs. The test also reads `tools/rebuild/draftguru/import_draftguru.py` (changed by 773182ea) but the failure precedes that. |
| N2 | environment | 1 | Needs the gitignored Stage A snapshot `data/sources/draftguru/annual-html-20260826`. Passes at 6c8b02cd, where the workspace held a read-only copy of DEV's snapshot (Q-FU: absent from the 6 failures). QUALIFICATION §1 calls this 'a new test path'; the baseline rerun with the venv interpreter shows it failed there too. |
| N3 | environment | 8 | ENOENT on `data/sources/afltables/fitzroy_core/full-history-20260902/player_stats_{1909,2025}.csv`: retained snapshot not present in any fresh checkout or on the host. Test file and the importer it runs are untouched by every remediation commit (code-path check: 0 changed files). |
| N4 | real (fixed) | 1 | Introduced by the ISSUE-353 Match Sheet read (commit 85b73c53: a new read of a special-record table in `src/db/queries/match-sheet.ts` was not classified). Fixed in fb6ac276; passes at 3aa82166 (`delta/delta-3aa82166.out`: 2 files 50/50) and is absent from the 6c8b02cd failures. |
| N5 | snapshot-oracle | 8 | Assertion pinned to the rebuilt `afldb_test` (e.g. 2026 `in_progress`, 268 vs 261 players, 183 Brownlow careers). Alone at 3aa82166 the 8 values equal the review's alone rerun at de640826 (183, 268, ladder identity, 110, `complete`, 1, `[]`): the remediation changed none of them. Unverified on a rebuilt `afldb_test`. |
| N6 | snapshot-oracle | 2 | The snapshot holds 47 Coleman winner rows, `data/reference/coleman-derivation.json` pins 46. Identical text and counts in the baseline alone-rerun (`awards-reload-links` venv rerun). Unverified on a rebuilt `afldb_test` (none available). |
| N7 | accepted limitation | 1 | The documented unsupported/criterion cells of the Gridley corpus ("no failing cells" lists the first 40). `answers` scope compared base vs fixed `grid-solver.ts`: 10,209 solved cells, 25,422 findings, 839 criteria identical (`answers/gridley-compare.txt`). Not a pass; an accepted limitation recorded at baseline. |
| N8 | snapshot-oracle | 24 | Fixed-number witness pinned to an older data state (e.g. 43 vs 41 meetings). Identical assertion text at the review baseline for 24/24; no `src/db/queries/club-comparison.ts` change between de640826 and 3aa82166 (code-path check: 0 changed files). Unverified on a rebuilt `afldb_test`. |
| N9 | environment | 1 | `Refusing to rebuild 'afldb_v2_remint2_settleapi_test'`: rebuild targets are name-pinned to `afldb_test`/`code_test_db`. Baseline alone fails the same way (B-R:int-settle-afl-api-file); its full-run text was a statement timeout (load). |
| N10 | snapshot-oracle | 1 | The snapshot holds 9,522 `brownlow` round rows with NULL `match_id` (review A-05); `9522` and the same line (`admin-brownlow.test.ts:391`) at baseline and at 3aa82166, so the changed code (Match Sheet dependents) did not alter it. |
| N11 | snapshot-oracle | 4 | Pinned counts (695,499 vs 685,471 player-match rows; 120/268/223 vs 114/261/219) differ from the snapshot; same values at baseline full run and in the baseline alone rerun (B-R:int-database). |
| N12 | snapshot-oracle | 2 | DraftGuru production link counts (3,559 vs 3,465; 94 identities) differ from the snapshot; same values at baseline. The test file imports no remediation-changed file except `grid-solver.ts` for an unrelated query (code-path check). |
| N13 | environment | 2 | The frozen person-level sample `person-html-20260826/sample.json` exists neither in a fresh checkout nor on DEV; the Stage A snapshot itself was present. |
| N14 | snapshot-oracle | 1 | P2 asserts zero NULL-`match_id` round rows; the snapshot holds 9,522 (review A-05). Same value and line at baseline and alone at 3aa82166. |
| N15 | fixture-leak | 1 | `need an empty draft year with active club identities` derives its year from `max(matches.season)`; a committed fixture season pushes it past every club identity. Same file-level error at baseline; 103/103 passed alone with admin-special-records and match-admin-delete (`iso2-3aa82166/admindraft`). Mechanism (which fixture) not traced in this run. |
| N16 | fixture-leak | 1 | The ISSUE-363 TST-9 guard fired by design: leaked season 2076 (`settle-afltables`, killed by its hook timeout under load, so its `afterAll` also timed out). Not a test defect; the suite's 42 tests were reported skipped. Alone: admin-season-lists 42/42 pass; release-gates 8 snapshot-oracle failures (I1). |
| N17 | fixture-leak | 3 | `expected [2026, 2027] to include 2076`: the new ISSUE-350 season-opening cases read the register while the leaked 2076 season (above) was committed. Passes alone 6/6 (`iso-3aa82166/c7`). The ISSUE-350 cases do not exist at de640826 (the baseline file had 3 tests, all passing); they are new tests. |
| N18 | load-timeout | 1 | Vitest timeout (`STACK_TRACE_ERROR` = test timed out) in the full parallel run; passes alone (97 passed; the 2 alone errors are the Coleman oracle, listed in I1). Newly running (the file was skipped for want of a python interpreter at baseline). |
| N19 | load-timeout | 2 | Warm-median ceiling 1,500 ms exceeded under full-parallel load (3,302 / 4,405 ms); the same two ids exceed it at baseline (2,513 / 3,132 ms). Passes alone (`iso2-3aa82166/clubcmp`: no route failure). A remediation commit DID touch this route (ISSUE-361 gate, e4ec689b); the values are load-driven, the perf scope measured 336-358 ms warm. Not a proof the gate cost nothing under load. |
| N20 | snapshot-oracle | 24 | Fixed-number witness pinned to an older data state; fails alone with the same text (`iso2-3aa82166/clubcmp`) and at the review baseline. 0 remediation-changed files in the code path. |
| N21 | fixture-leak (inferred) | 1 | `Cannot read properties of null (reading 'clubId')` in "the maximum canonical season" case; passes alone and fails identically at baseline (where a leaked 2094 season existed). Inferred from the test selecting `max(season)`; the mechanism was not traced in this run. |
| N22 | load-timeout | 3 | Warm-median performance ceiling exceeded under full-parallel load; passes alone; the same id fails at baseline (text differs only in the measured milliseconds). |
| N23 | environment | 5 | The snapshot holds one active `player_match_stats` override, so the Durable Match Sheet authority replay cases refuse (`expected 1 to be +0`). Skipped at baseline (`canReplay` false: the host python lacked psycopg); the ISSUE-363 interpreter resolution makes them run. Pass 62/1 skipped with `prep-authority.mjs` on a fresh copy (`iso-3aa82166/dataeditor`). |
| N24 | snapshot-oracle | 4 | Pinned count differs from the snapshot; same value at baseline and in both alone runs. |
| N25 | unclassified | 1 | Fails in the full run at baseline and at a119a999 (`[1942..1945, 2026]` vs `[1942..1945]`) but passes alone at baseline (B-R:int-database: 4 failed) and at 3aa82166. Not introduced by the remediation (baseline-identical), but the interfering suite/state was not identified, so no mechanism class is supported. |
| N26 | snapshot-oracle | 2 | DraftGuru production link counts differ from the snapshot; same values at baseline and alone. |
| N27 | load-timeout | 2 | Timing/deferral-policy assertions (`clubs1` over 1 s; 11 deferral cells) failed only in the full parallel run; pass alone (`iso-3aa82166/gridley`: 1 failed, the accepted case). Not at baseline. |
| N28 | accepted limitation | 1 | The documented Gridley unsupported/criterion cells; fails identically alone and at baseline; solver output identical before/after the answers scope. |
| N29 | load-timeout | 10 | `canceling statement due to statement timeout` under full-parallel load; same ids at baseline; passes alone (31/31, `iso2-3aa82166/matching`; baseline alone 23/23 and 8/8). |
| N30 | fixture-leak | 1 | The ISSUE-363 TST-9 guard fired by design: leaked season 2076 (`settle-afltables`, killed by its hook timeout under load, so its `afterAll` also timed out). Not a test defect; the suite's 67 tests were reported skipped. Alone: admin-season-lists 42/42 pass; release-gates 8 snapshot-oracle failures (I1). |
| N31 | environment | 1 | Refuses to run: existing real 2026 canonical rows in the snapshot are not ISSUE-276 fixtures. Same file-level error at baseline. Not re-run alone: classified from the refusal text and baseline identity. |
| N32 | load-timeout | 19 | `canceling statement due to statement timeout` in the full run; same id at baseline; passes alone (73 of 74, `iso2-3aa82166/settleapi`). |
| N33 | environment | 1 | OD-5 reinstate: in the full run `sources.key = 'afl_api' not found` (another suite's state); alone it fails differently, `Refusing to rebuild` (name-pinned target). Same two behaviours at baseline (B-R:int-settle-afl-api-file). Not a pass in either mode. |
| N34 | load-timeout | 19 | Hook/test timeout (`STACK_TRACE_ERROR`) under full-parallel load; 85/85 alone at 3aa82166 and in the baseline alone rerun. 2 ids (the ISSUE-295 cases) were not among the 17 baseline failures: the baseline file had 3 passed / 17 failed / 65 skipped, and which tests hit the timeout differs run to run (same class). |
| N35 | environment | 2 | Refuses by design: needs a dedicated Brownlow clone. Same file-level error at baseline. Not run with the dedicated clone in this qualification. |
| N36 | environment | 1 | Refuses to run: 1 Coleman 2001 row already exists that the suite did not create (the snapshot holds 47 Coleman winner rows, see awards). Same file-level error at baseline. Not re-run alone: classified from the refusal text and baseline identity. |

## Whether a remediation commit touched files the test exercises

Method: the test file's transitive TS import closure (`@/` and relative imports) plus the files the test file itself names in string literals or `join(...)` segments, intersected with
`git diff --name-only de640826..<tested>` (`a119a999` for the broad-run rows, `3aa82166` for the isolated and final-unit rows). Python tools a test spawns are seen only when the test
names them. Files named only by a *different* file's literals (source-contract scans of many files) are not followed: this under-approximates for such tests and is stated per row.
A touch is not a cause; the last column says whether the failing assertion reads the touched code.

| failing test file | runs | remediation-changed files in its import closure (de640826..tested) | commits | relevance to the failing assertions |
|---|---|---|---|---|
| `tests/draftguru-acquisition.test.ts` | I1, U1, U2 | none; reads: `tools/rebuild/draftguru/import_draftguru.py` | - | None: the 3 failing tests fail at the missing snapshot read. (The file also reads `tools/rebuild/draftguru/import_draftguru.py`, changed by 773182ea, in other tests that pass.) |
| `tests/fitzroy-core-import.test.ts` | U1, U2 | none | - | None. |
| `tests/special-records-public-filter-contract.test.ts` | U1 | none; reads: `src/db/queries/admin-coaches.ts`, `src/db/queries/admin-special-records.ts`, `src/db/queries/grid-solver.ts`, `src/db/queries/match-sheet.ts`, `src/db/queries/players.ts`, `src/lib/format.ts`, `src/lib/match-sheet-dependents.ts`, `src/lib/override-merge.ts`, `src/lib/params.ts`, `src/search/nl/plan.ts` | - | This is the failure the remediation caused (fixed). |
| `tests/integration/release-gates.test.ts` | I1, I2 | `src/db/queries/match-search.ts`, `src/lib/params.ts`, `src/search/match-spec.ts`, `tests/integration/leaked-fixtures.ts`, `tests/integration/release-gates.test.ts` | 0f4856ed, 2797d8ad, dd21624f | The touched files (`match-search.ts`, `match-spec.ts`, `params.ts`, `leaked-fixtures.ts`) are not on the 8 failing assertions; their alone values equal the baseline alone values. `leaked-fixtures.ts` IS the guard that produced the file-level error in the broad run. |
| `tests/integration/awards-reload-links.test.ts` | I1, I2 | `src/db/queries/players.ts`, `src/lib/params.ts` | 2797d8ad, 6f6ddd14, 73c32c3e | `players.ts`/`params.ts` only; the timeout is vitest's; the alone errors are the Coleman 47-vs-46 oracle (unchanged by any remediation commit). |
| `tests/integration/gridley-corpus.test.ts` | I1, I2 | `src/db/queries/grid-solver.ts` | b3c3e303 | `grid-solver.ts` (b3c3e303, ISSUE-355): solver output identical before/after (`answers/gridley-compare.txt`). |
| `tests/integration/club-comparison.test.ts` | I1, I2 | none | - | None: no `club-comparison.ts` change. |
| `tests/integration/settle-afl-api.test.ts` | I1, I2 | `src/db/queries/match-sheet.ts`, `src/db/queries/players.ts`, `src/lib/acquisition/settle-afl-api.ts`, `src/lib/format.ts`, `src/lib/home-records.ts`, `src/lib/match-sheet-dependents.ts`, `src/lib/params.ts`, `tools/db/rebuild-test.ts`; reads: `src/db/queries/admin-coaches.ts`, `src/db/queries/data-edits.ts`, `src/lib/override-merge.ts`, `tests/integration/settle-afltables.test.ts` | 220e6522, 2797d8ad, 68f8c0da, 6f6ddd14, 73c32c3e, 85b73c53, e118e033 | `settle-afl-api.ts` (68f8c0da, ISSUE-350 halt) is imported; the 19 timeouts and the OD-5 refusal also occur at baseline; alone 73/74. |
| `tests/integration/admin-brownlow.test.ts` | I1, I2 | `src/db/queries/admin-coaches.ts`, `src/db/queries/match-sheet.ts`, `src/lib/match-sheet-dependents.ts`, `src/lib/override-merge.ts` | 85b73c53, cd371c0a, e905915a | `match-sheet.ts`/dependents/override-merge are in the closure; the failing assertion (migration 094 backfill count) reads none; 9,522 identical at baseline. |
| `tests/integration/database.test.ts` | I1, I2 | `src/db/queries/admin-coaches.ts`, `src/db/queries/grid-solver.ts`, `src/db/queries/match-search.ts`, `src/db/queries/match-sheet.ts`, `src/db/queries/nl/answer.ts`, `src/db/queries/nl/team-match.ts`, `src/db/queries/players.ts`, `src/lib/format.ts`, `src/lib/home-records.ts`, `src/lib/match-sheet-dependents.ts`, `src/lib/override-merge.ts`, `src/lib/params.ts`, `src/search/match-spec.ts`, `src/search/nl/describe.ts`, `src/search/nl/parser.ts`, `src/search/nl/plan.ts`, `src/search/nl/vocab.ts`, `src/search/query-intent.ts`, `tests/integration/database.test.ts` | 0f4856ed, 2797d8ad, 48286d7a, 6f6ddd14, 73c32c3e, 85b73c53, b3c3e303, b85393aa, c86a2e00, cd371c0a, e118e033, e905915a | Many changed files are imported (queries/nl/search); the 4 pinned counts equal baseline in both alone runs. |
| `tests/integration/draft-linkage.test.ts` | I1, I2 | `src/db/queries/grid-solver.ts` | b3c3e303 | `grid-solver.ts` (b3c3e303) only; the failing counts are DraftGuru link counts and equal baseline. |
| `tests/integration/admin-draft.test.ts` | I2 | `src/db/queries/admin-draft.ts`, `src/db/queries/players.ts`, `src/lib/override-merge.ts`, `src/lib/params.ts`, `tests/integration/admin-draft.test.ts`; reads: `src/app/admin/draft/actions.ts`, `src/app/admin/draft/revalidate-paths.ts`, `src/db/queries/grid-solver.ts`, `src/db/queries/nl/answer.ts`, `src/db/queries/nl/team-match.ts`, `src/lib/auth/session.ts`, `src/lib/format.ts`, `src/lib/home-records.ts`, `src/search/match-spec.ts`, `src/search/nl/describe.ts`, `src/search/nl/parser.ts`, `src/search/nl/plan.ts`, `src/search/nl/vocab.ts`, `src/search/query-intent.ts`, `tests/admin-draft-actions.test.ts` | 2797d8ad, 6f6ddd14, 73c32c3e, cd371c0a | Closure heavily changed (ISSUE-354, 353) but the file-level error is the setup precondition, before any of it runs; same error at baseline. |
| `tests/integration/admin-season-lists.test.ts` | I2 | `tests/integration/admin-season-lists.test.ts`, `tests/integration/leaked-fixtures.ts` | dd21624f | `leaked-fixtures.ts` (TST-9 guard, dd21624f) produced the file-level error; it is the intended fail-fast. |
| `tests/integration/afl-api-c7-observation.test.ts` | I2 | `src/lib/acquisition/settle-afl-api.ts`, `src/lib/rollover/season-opening.ts`, `tests/integration/afl-api-c7-observation.test.ts` | 68f8c0da, d974078c | The new ISSUE-350 cases (68f8c0da, d974078c) are the failing tests; they read the season register, which the leaked fixture polluted. |
| `tests/integration/club-comparison-route.test.ts` | I2 | `src/app/clubs/compare/state.ts`, `src/components/SortableTable.tsx`, `src/lib/concurrency-gate.ts`, `src/lib/format.ts`, `src/lib/params.ts`, `src/lib/sorting.ts`, `tests/integration/club-comparison-route.test.ts` | 2797d8ad, c517732a, e4ec689b | YES: ISSUE-361 gate (e4ec689b) wraps this route. Baseline fails the same two ids at 2,513/3,132 ms; this run 3,302/4,405 ms under load; alone passes. Load-driven, not a proof of zero cost. |
| `tests/integration/data-editor.test.ts` | I2 | `src/db/queries/admin-coaches.ts`, `src/db/queries/data-edits.ts`, `src/db/queries/match-sheet.ts`, `src/db/queries/players.ts`, `src/lib/match-sheet-dependents.ts`, `src/lib/override-merge.ts`, `src/lib/params.ts`, `tests/integration/data-editor.test.ts` | 2797d8ad, 6f6ddd14, 73c32c3e, 85b73c53, cd371c0a | Match Sheet / override-merge changes (85b73c53, cd371c0a) are in the closure; the 5 failures are the pre-run authority refusal, before any of that code runs. |
| `tests/integration/player-link-concurrency.test.ts` | I2 | `src/db/queries/players.ts`, `src/lib/format.ts`, `src/lib/params.ts`, `tools/db/rebuild-test.ts` | 220e6522, 2797d8ad, 6f6ddd14, 73c32c3e | As player-matching. |
| `tests/integration/player-matching.test.ts` | I2 | `src/db/queries/players.ts`, `src/lib/params.ts`, `tests/integration/player-matching.test.ts` | 2797d8ad, 4043b3ed, 6f6ddd14, 73c32c3e | `players.ts` changed (ISSUE-361 FE-5, 6f6ddd14/73c32c3e) and is imported; the failure is a statement timeout also seen at baseline; alone 31/31 pass. |
| `tests/integration/settle-afl-api-issue276.test.ts` | I2 | `src/lib/acquisition/settle-afl-api.ts` | 68f8c0da | `settle-afl-api.ts` only; refusal precondition precedes it; same at baseline. |
| `tests/integration/settle-afltables.test.ts` | I2 | `src/db/queries/match-sheet.ts`, `src/lib/match-sheet-dependents.ts`, `tests/integration/settle-afltables.test.ts` | 85b73c53, dd21624f | `match-sheet.ts` dependents (85b73c53) and the season renumbering (dd21624f) are in the closure; alone 85/85 pass, baseline had 17 timeouts of the same kind. |
| `tests/integration/v2-brownlow-eligibility-2025-rehearsal.test.ts` | I2 | `src/db/queries/admin-awards.ts`, `src/lib/auth/session.ts`, `src/lib/format.ts`, `src/lib/params.ts` | 2797d8ad, 5394aff8, a3238c96 | Refusal precondition only. |
| `tests/integration/v2-brownlow-production-correction.test.ts` | I2 | `src/lib/home-records.ts` | e118e033 | Refusal precondition only (`home-records.ts` imported). |
| `tests/integration/v2-coleman-publication.test.ts` | I2 | `src/app/admin/awards/revalidate-paths.ts`, `src/db/queries/admin-awards.ts`, `src/lib/format.ts`, `src/lib/params.ts`, `tests/integration/v2-coleman-publication.test.ts` | 2797d8ad, 5394aff8 | Refusal precondition only. |

## Disposition of the broad run's "new" and "absent" ids (QUALIFICATION §1)

I recount from the two JSON files, keying test failures by id and file-level failures by file: **86 test ids and 5 file-level failures common (91; QUALIFICATION says 92)**, 13 test ids
and 2 file-level failures new, 13 test ids absent (13 absent + 0 file-level absent). The one-off difference in the common count is not explained by the committed evidence (the review's
`settle-afltables` "hook timeout" appears in the JSON as 17 test-level failures, not a file-level error); it changes no class.

- **13 new test ids:** `afl-api-c7-observation` 3 (fixture-leak, N17), `awards-reload-links` Under 22 (load-timeout), `data-editor` 5 (environment: snapshot authority row, were skipped at baseline),
  `gridley-corpus` 2 (load-timeout), `settle-afltables` 2 (load-timeout). Each passes alone (`iso`), except the 5 `data-editor` ids, which pass alone only after `prep-authority.mjs` removes the
  snapshot's active `player_match_stats` override (a precondition, not a code change: the cases refuse without it, `expected 1 to be +0`).
- **2 new file-level:** `admin-season-lists` and `release-gates` (the TST-9 leak guard, fixture-leak).
- **13 absent:** `release-gates` 9 and `admin-season-lists` 1 did not run (the guard above), so "absent" is not "fixed"; alone the `release-gates` 8 still fail (I1) and the ninth and `admin-season-lists` pass.
  `nl-answers-relationships` 2 (their oracle is now read from the tracked rebuild input, ISSUE-358, `pins`) and `derived-rebuild-parity` 1 (reason not established here) genuinely pass.

## Points where QUALIFICATION.md's wording is stronger than the evidence

1. **§4 "No failure is attributable to a remediation change."** True of the isolated runs at `3aa82166` (each is identical at the baseline, in its full run or in the review's alone rerun, or is one of the 2 sample-file failures that need a file that exists nowhere), but not of the whole run:
   U1 row 8 was caused by `85b73c53` and fixed in `fb6ac276`. The statement should name that.
2. **§1 "the seventh (bridge import gate) is a new test path".** It fails at the baseline too once the python interpreter resolves (`B-R:venv-draftguru-acquisition`, 3 failed including this id).
   It was hidden at baseline by the interpreter failure, not new. It passes at `6c8b02cd` only because that workspace held the Stage A snapshot copy.
3. **§4 club-comparison "Every failure is a fixed-number witness".** True for the 24 that fail alone. In the full run the other 4 are 3 performance ceilings (load) and the "maximum canonical season"
   TypeError (inferred fixture-leak, not traced); none is a witness.
4. **Snapshot-oracle is not proved on a rebuilt `afldb_test`** (QUALIFICATION §6 says so; the 41 + 31 snapshot-oracle rows rest on "same value at baseline", which proves non-causation, not the cause).
5. **§3 DraftGuru "vitest 215 passed / 2 failed / 1 skipped"** has no JSON in `qualification/`; the 2 ids are taken from the unit run (same two Stage B1 tests). I did not verify the 215/2/1 counts.
6. **`awards-reload-links` alone** reports "2 describe-level errors" as one file-level failure in the JSON; the two ids are the Coleman tests named in I1.

## What this analysis could not establish

- The mechanism behind the full-run-only `database` "separates the war years" failure and the "maximum canonical season" `club-comparison` failure (class: unclassified / fixture-leak inferred).
- Which suite leaked the fixture that made `admin-draft` skip at baseline and at `a119a999` (alone 103/103 pass).
- `settle-afl-api-issue276`, `v2-coleman-publication` and the two dedicated-clone Brownlow files were not re-run alone or with their dedicated clones; their classes rest on the refusal text and baseline identity.
- Any pass or fail on a rebuilt `afldb_test`. No failure was relabelled a pass.
