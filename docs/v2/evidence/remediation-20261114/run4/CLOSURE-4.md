# CLOSURE-4 — run 4, phase A, independent closure verification (afldb-closure; committed verbatim from its draft by the orchestrator)

Verifier: `afldb-closure` (Sonnet). Date: 2026-11-15. Output is a flag, not a fix: no repository file was edited.
Baseline refs: P = `a4b471c1915f462aef7c2683b4c6beeb1f5752ee` (local HEAD of `D:\dev\afldb-rem-20261114`); Q''' = `16027092e075d9064df8a3749c4b17805c2eaaeb`; B4 = `7cfbe186e70ca91db67da1aa4e28325ccbc32a86`; Q'' = `1f7b0d717b37e98432716d6b9170fbd45142ab63`; run start `c8ea9ef8`; Q' `692b1902`; origin/main `de640826d13489c58392563e7ae1ff62403ed293` (re-read by `git ls-remote`, unchanged). Host bundle `base-P.bundle` sha256 `6b5cb05eb01e98c31882a024f61aa64044c6039e4c18741da04c618a3cb5a11a` verified against SHA256SUMS.

## Verdicts

| Id | Verdict | Basis |
|---|---|---|
| A1 scope and counts | PASS | `de640826..P` = 168 commits (packet 169 = P plus C). Excluding `docs/v2/evidence/` and `issues/`: 215 files +17,715/-1,171 (matches packet). Since `692b1902`: 28 integration suites + 3 helpers + 1 unit = 32 as stated; zero change to migrations, deploy, package files, data, `src/app` since `c8ea9ef8`. (Brief's "since de640826" is true only for migrations/data; deploy/package/src/app differ from runs 1-3.) |
| A2 evidence-only after Q''' | PASS (INFO ambiguity) | `Q'''..P` = 206 files, all inside the allowlist; none under `run4/evidence/`; none matching nested `*/evidence/*.{sh,mjs,cjs,js,ts,py,tsv}`. See C-007. |
| A3 test changes not weakening | PASS (LOW/INFO observations) | `7cfbe186..Q'''` test diff read (6,794 lines). No added skip/todo/only; 8 removed `it(`s all renamed or replaced by oracle-based tests with mutation checks; frozen pins untouched. See C-001..C-004. |
| A4 `player-derived.ts` | PASS | Only `src/` change since `692b1902` (+99/-27). Declared ranges {1897-1923},{1942-1945} equal `stat-availability.json`; bound as parameters; function never SELECTs `stat_availability`; no schema/migration/data change. |
| A5 independent re-run | PASS with one anomaly record | See below. Own workspace, own cluster port 55688, heavy lock honoured. |
| A6 ledger / packet | PASS (LOW/INFO) | 50 ledger rows each matched to raw `*-failures.tsv` (0 only-ledger, 0 only-raw); gone/new/continuing recomputed. Nothing accepted on the owner's behalf. See C-005, C-006, C-008, C-009. |
| A7 manifests | PASS | Re-derived on a fresh clone at P, host-local round: see below. |
| A8 applied vs intended | PASS (INFO) | All 36 commits in `7cfbe186..P` map to a scope README or record; no undisclosed executable edit. See C-006. |
| A9 DEV untouched | PASS | Committed BEFORE/AFTER files identical in the service state; own one-time read-only re-read agrees (below). |

## A5 - commands and results (host `/mnt/ssd/afldb-rem4-closure-20261115`, `cand` = detached Q''', porcelain 0 before and after every phase)

- Setup: bundle, snapshot and Q'' dump sha256 verified; snapshot template restore (ledger 118) and rebuild template restore both give 83-table counts IDENTICAL to the committed `qualification-4/p1/*table-counts*`.
- `npm run typecheck` rc 0. `npm run lint:gate` rc 0 (PASSED ratchet, 338 errors in 43 files, baseline 338/43). I did not run `lint:gate --update` or `npm run build`.
- Unit: `v2-acquisition-pipeline` 24/24, `reference-data` 70/70, `dsn-policy` 73/73.
- Shared mode, rebuild copy: `awards-reload-links` 109/109, then `afl-api-c7-observation` 6/6; `awards.last_season=2027` rows 0; awards spans identical before/after; only `import_batches` changed (26 -> 148). Matches the qualification record.
- Per-file (=all), fresh copy of each template, one run each:

| File | Rebuild | Snapshot |
|---|---|---|
| `brownlow-pending-coverage` | 8/8 | 8/8 |
| `club-comparison` | 70/70 | 70/70 |
| `release-gates` | 68 passed / 7 skipped, 0 failed | 63 passed / 7 skipped / 5 failed (all 5 are ledger class-1 snapshot-only ids: Brownlow authority 183 vs 0, and four birth-date pins 14,110/13,275/13,255/110 vs 14,294/13,367/13,347/18) |

  The 5 snapshot failures equal the FAILURE-LEDGER-4 S-PF and S-SH rows for `release-gates` exactly (3 new, 2 continuing). Base table counts unchanged in every per-file run.
- Facts query on the templates (read-only): snapshot 2026 coverage is `pending` for all three Brownlow grains but `player_season_stats` 2026 `brownlow_status` is `not_applicable` x669 (the fix applies to the function; the snapshot rows are pre-fix data); rebuild 2026 is `pending` x669. `not_applicable` stat_availability rows: 93, all inside the declared ranges, none outside; no declared-range season is other than `not_applicable`.
- Probe (extra): shared `awards-reload-links` on a snapshot copy ends with `awards` id 47 (coleman) span 1980-2025 but `award_winners` max season 2026 (n 46 -> 47); `spans not covering winners=1`. See C-010.

## A7 - manifests (fresh clone at P, porcelain 0)

run2 `verify-manifests.sh` sha256 `0a48c77403038a2ee7732621b9f6088900becc5adb8d603591f12d7c23742810` is identical in B4, P and the working tree. New checker `78443813b090b210cbffa644628e84cbb24e4df135daf8190516c3e6a64c7b6d`, map `29a96e86a25dd1a9692d195a8ea052e9c2445b35029855b2e3e832298246894b`. `selftest.sh` 33 passed 0 failed. Checker (`EVIDENCE_LOCAL_HOST=1 REQUIRE_NO_UNRESOLVED=1`, rev P) rc 0: 70 manifests, 5,718 entries: COMMITTED-OK 3,752, ALIAS 15, HOST-OK 1,855, DECLARED-NOT-RETAINED 96, COMMITTED-MISMATCH 0, HOST-MISMATCH 0, AMBIGUOUS 0, HOST-MISSING 0, UNRESOLVED 0. Equals the packet's figures. Host round was local-host mode on the DEV host (the evidence host files), not a remote round.

## A9 - DEV (single read-only re-read, 2026-11-15 ~07:00Z)

`systemctl show`: afldb.service MainPID 1732 NRestarts 0 InvocationID `c15b39a7...`; postgresql@16-main MainPID 1531 InvocationID `f21f38b1...`; caddy MainPID 1683 InvocationID `e18d8123...`; all ActiveEnter 2026-11-14 03:01:41/42 AEDT; DEV checkout HEAD `8b024098a6771fc5e5be2f8bf006c9c3ca8ab55a`; listeners 127.0.0.1:2019/3000/5432. Identical to DEV-STATE-BEFORE-4 and AFTER-4.

## Findings (none CRIT, HIGH or MED)

| Id | Grade | Location | Finding |
|---|---|---|---|
| C-001 | LOW | `tests/integration/club-comparison.test.ts` (~:1870-1875) | The complete-branch oracle imports the implementation's own `BROWNLOW_DECLARED_NO_MEDAL_SEASONS`. Mitigated: `tests/reference-data.test.ts` pins it to literals and to `stat-availability.json`. |
| C-002 | LOW | `tests/integration/brownlow-pending-coverage.test.ts` (sweep test) | Hard-codes 2027 `pending`, range 1897-2027 and grid 2026 `pending`; goes stale when 2026/2027 Brownlow loads. Also borrows an existing `auth_users` row as actor (INFO). |
| C-003 | INFO | `tests/integration/database.test.ts` | No longer pins the all-season 695,499 total; only `all >= past` plus oracle equality (designed, item 4/F-013). Past-scope pins retained. |
| C-004 | INFO | `tests/integration/leaked-fixtures.ts` | Registry omits pre-existing committed seasons 2064 (venue-records) and 2073 (match-results-promotion). Also: class "1" (snapshot-only failure ids, three 363-B birth-date pins) is a stretch of "passes under intended conditions"; disclosed in the ledger. |
| C-005 | LOW | `issues.md` ISSUE-363 run-4 "Item 1" bullet (line 55149 at P) | States the checker at Q''' gave 5,488 entries; QUALIFICATION-4 and packet say 5,718 (70 manifests); my P run is 5,718. Possibly time-scoped (manifests added after Q''') but unreconciled in the text. IssuesIndex ISSUE-365 also cites a stale `~:736` line (INFO). |
| C-006 | LOW | `run4/RUN-PLAN-4.md` (step table ~:38-52), brief section 3a | Scopes `rbfail` (`430a3a4a`), `fixup` (`259df1c5`, `65fe171d`) and `leaks` (`6f580dca`) exist with READMEs and are in HANDOFF, but are absent from the plan step table and the allocation table; their edits touch files outside the 3a allocation (admin-season-lists, nl-answers-*, special-records-*, v2-coleman-publication, dob-enrichment-issues, draftguru-import, join-request-approval, match-admin-delete, match-results-promotion, sealed-editor-guard, submission-promotion). Their dispatch rationale lives only in gitignored `.phaneslight/returns/rem4-20261115/`. Each edit maps to a scope record, so not drift; a recovery-path gap. |
| C-007 | INFO | F-008 wording | "evidence/ checker directory" read as the directory holding the checker (`run4/evidence/`, `run2/evidence/`): nothing changed after Q'''. Under the wider nested-`evidence/` reading also nothing changed after Q'''. Post-Q''' `.sh` files (`run4/fixloop/scripts/*.sh`, 6) are record scripts outside any `evidence/` directory. |
| C-008 | INFO | APPROVAL-PACKET-4 "Incidents" | Says "none outside authority" while the records disclose two agents' broad `pkill -f` matching their own ssh shell, a permission-layer refusal, no-heavy-lock single-file runs, and a mutation script reverting its own uncommitted file. Wording is stricter than the disclosures. |
| C-009 | INFO | `DEV-STATE-AFTER-4.txt` | Includes a read-only `ls -la` of the RB-1 package directory (never opened). Within the listing rule; noted because RB-1 is a protected path. |
| C-010 | LOW | `tests/integration/awards-reload-links.test.ts` (span restore, ~:3270-3290, unwind ~:3161) | In shared mode on the snapshot the span restore returns `awards` id 47 to 1980-2025 while the real reload's `award_winners` 2026 row stays (max 2026): one span not covering its winners. Same effect recorded as R4-08/qual F-003 (present at B4, unconfirmed whether tied to `581a898b`). Disposable test copy only; the rebuild shows no change. |

## Drift

None material. All 36 commits map to scope records (gates `6778a4ec`; coleman276 `f0848638`; brownlow `88edaf43`, `5e4b38bb`, `ec308d74`; clubcmp `a1571ee5`; rbfail `430a3a4a`; shared `300e994f`, `c48de090`, `9c73adfb`; state-b `ffd7f2ed`; fixup `259df1c5`; orchestrator `65fe171d`, `581a898b`, `1f7b0d71`, `6eb90a3e`, `16027092`; RB-1 doc `ca806a7f`; leaks `6f580dca`; final records `a4b471c1`). Run-1/2/3 evidence unchanged since B4 except the granted `run2/evidence/ERRATA.md` (added) and `HANDOFF.md`.

## Duties not performed or not applicable

Duty 1 (`regen-registry`, `api-diff`): not performed, they write into the repository, forbidden by the brief; API drift covered by `git diff` (one added exported constant in `player-derived.ts`, planned by F-002; no route/action/migration change). Duty 2: performed as above; `npm run build` not run (not allowed; no client-import change in run 4). Duty 4 (`doc-index`/`doc-check`), 5 (archive digest), 6 (handover): not performed (write surface forbidden here; this draft is the record). Duty 7 (visual): N/A, no UI change (F-006).

## Cleanup proof (2026-11-15 07:02Z)

Cluster stopped by `isolated-pg stop`; listeners on port 55688: 0; no process whose command line names the workspace; `cand` HEAD `16027092...` porcelain 0; `pclone` HEAD `a4b471c1...` porcelain 0; workspace 2.1 GB and cluster 1.4 GB remain on `/mnt/ssd` (389 GB free) for the orchestrator to keep or remove; DEV checkout HEAD still `8b024098...`. Scratch under `D:\tmp\afldb-rem4-closure\` (raw extracts, `tests.diff`, scripts). No push, no production contact, no DEV operation, no shared `afldb_test`, no RB-1 read, no sudo/wsl.

## Orchestrator disposition (added when committing this record; the verification text above is unchanged except its title line)

| Finding | Grade | Disposition in candidate C (records only; nothing executable changes after Q‴ `16027092`) |
|---|---|---|
| C-001 | LOW | recorded, `RESIDUALS-4.md` §2.5 |
| C-002 | LOW | recorded, `RESIDUALS-4.md` §2.5 |
| C-003 | INFO | by design (item 4 / F-013); no action |
| C-004 | INFO | recorded, `RESIDUALS-4.md` §2.5 |
| C-005 | LOW | corrected: `issues.md` ISSUE-363 item 1 states both counts and why; `IssuesIndex.md` ISSUE-365 line reference updated |
| C-006 | LOW | recorded: `QUALIFICATION-4.md` "Scopes added during the run" |
| C-007 | INFO | noted; the orchestrator's reading (the directory holding the checker, `run4/evidence/`) is stated in `RESIDUALS-4.md` §2.5 |
| C-008 | INFO | corrected: packet §D incident wording now distinguishes hard stops (none breached) from disclosed process-rule deviations |
| C-009 | INFO | noted: the DEV-state script lists the RB-1 directories read-only (`ls`), before and after alike; nothing under RB-1 was opened, written or moved |
| C-010 | LOW | recorded, `RESIDUALS-4.md` §2.5 (same row as qual F-003) |

Duties 1, 4, 5, 6 (registry regeneration, API diff, doc index, archive digest, handover) were not performed by closure because its brief forbade
repository writes; API drift was checked by `git diff` instead (one added exported constant, planned). Phase B (post-commit verification of C) is
written outside the candidate.
