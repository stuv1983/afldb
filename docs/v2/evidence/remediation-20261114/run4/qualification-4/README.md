# Run 4, scope `qual`: final integrated qualification at Q'' (`1f7b0d717b37e98432716d6b9170fbd45142ab63`)

Worker `afldb-worker`, 2026-11-15. Everything below was executed on the DEV host `streamanator` (user `arm`) in the run-owned workspace
`/mnt/ssd/afldb-rem4-qual-20261115` (cluster `/mnt/ssd/afldb-rem4-qual-20261115-pg`, PostgreSQL on **127.0.0.1:55687** only), under
`flock /mnt/ssd/afldb-rem4-base/heavy.lock` for every heavy phase. Nothing was pushed; production, DEV services, port 5432, the shared
`afldb_test` and RB-1 were not touched. Raw verdicts are reported as they came; classes are copied only where the owning scope record states
them, everything else is `to-classify` (the orchestrator classifies). Host originals are hashed in `HOST-SHA256SUMS` (absolute paths); committed
files in `SHA256SUMS` (relative to this directory).

## 1. Environment and identity

| Item | Value |
|---|---|
| Revision under test | Q'' = `1f7b0d717b37e98432716d6b9170fbd45142ab63` (branch `claude/remediation-20261114`) |
| Host checkout `$W/cand` and rebuild checkout `$W/rb` | `git rev-parse HEAD` = Q'' in both, `git status --porcelain` empty in both, before and after EVERY phase (`phase-porcelain.txt`: 74 `#####` lines, 33 phase starts, none with a non-zero count; final proof `misc/final-stop.txt`) |
| Bundle | `/mnt/ssd/afldb-rem4-base/base-Qpp.bundle`, sha256 `63727560f7511534fd355ec94044205b354cacbd9ab65da6ea40444707737427` (verified on the host; line 2 of the base `SHA256SUMS`) |
| Node / vitest | v22.23.2 / 4.1.10; `npm ci` 427 packages; package.json and package-lock.json byte-identical to 6d5388ea (`p0/reuse-diffs.txt`) |
| Snapshot base | the 4 Nov production-derived dump (30,141,895 bytes, sha256 `e77c307d...826d`, verified); never copied off the host; aggregates only in this record |
| Snapshot template | restored (pg_restore exit 0, 12 s), `migrate.ts` "118 already applied": ledger 118, matches 17,056, players 13,365, fixtures 218, seasons 1897..2026, 2026 `complete`, none in progress, 83 tables counted (`p1/setup.out`, `p1/snap-template-identity.txt`) |
| `.env` | none anywhere in `cand`/`rb` (the `next build` / `prepare-standalone` log confirms none under `.next/standalone`) |
| Stage A | ABSENT from `cand` during all four integration cells (exactly as run 3 and the B4 baseline), so the draftguru-import skip set is comparable. Bridge child import ran from the `rb` checkout, which holds Stage A. Fixtures + Stage A were installed into `cand` only AFTER the cells, for the unit run |

## 2. P0: diffs and the reuse table

Lists (committed in `p0/`): `git diff --name-only 692b1902 Q''` = **2,232 files** (`diff-692b1902-Qpp.txt`; 41 outside `docs/v2/evidence/remediation-20261114/`,
`diff-692b1902-Qpp-outside-evidence-tree.txt`); `git diff --name-only 6d5388ea Q''` = 2,787 (`.gz`); `git diff --name-only 7cfbe186 Q''` (B4 = `7cfbe186`) = 2,181 (`.gz`).
Host and workstation lists are byte-identical (`p1/closure/host-diff-lists.sha256` equals the sha256 of the committed lists).

**Outside the F-008 record allowlist (B4 to Q'')**: 37 files (`outside-allowlist-7cfbe186-Qpp.txt`): `docs/architecture.md`, `docs/data-dictionary.md`,
`docs/v2/isolated-rebuild.md`, `src/db/queries/player-derived.ts`, `tools/db/afl-api-identity-correction-rehearsal.ts`, `tests/reference-data.test.ts` and 32
`tests/integration/*` files. Separately, `executable-type-files-under-evidence-dirs-7cfbe186-Qpp.txt` lists the 133 `.sh`/`.tsv` files that sit under
`*/evidence/` directories. The F-008 wording ("any `evidence/` checker directory") is ambiguous: besides the checker directory `run4/evidence/`, other scopes keep
scripts and TSVs in `*/evidence/` sub-folders. Both lists are given; the orchestrator interprets.

Code-path diff since the earlier qualified revisions (`p0/reuse-diffs.txt`): `git diff --stat f10e47ad Q'' -- src tools packages deploy package.json package-lock.json next.config.ts`
and the same against `692b1902` show exactly two files: `src/db/queries/player-derived.ts` (126 changed lines) and `tools/db/afl-api-identity-correction-rehearsal.ts` (+18/-4).
`deploy/`, `next.config.ts`, `package.json`, `package-lock.json`, `packages/`, `src/app/`, `src/middleware.ts` are **identical** from `f10e47ad` and from `692b1902` to Q''.

| Check | Decision | Justification |
|---|---|---|
| Typecheck | RERUN | `src` changed (`player-derived.ts`): rc 0 (`static/typecheck.log`) |
| Lint gate | RERUN | PASSED, **338 errors in 43 files** = baseline allowance (no increase; baseline not touched, no `--update`) (`static/lint-gate.log`) |
| Unit (all, with fixtures + Stage A) | RERUN | section 5 |
| `next build --webpack` + prepare-standalone | RERUN | section 5 |
| Shell harnesses | RERUN | section 5 |
| AFLW `%27` metadata (direct and via `deploy/Caddyfile.production`) | **REUSED** from `run2/qualification-2/aflw-meta.txt` (also reused by run 3) | AFLW route closure (13 entries: `src/app/aflw/**/page.tsx`, root layout, middleware, `next.config.ts`; esbuild metafile union 58 files, `p1/closure/aflw-*`) intersects `git diff --name-only 692b1902 Q''` in **0** files; `deploy/`, `next.config.ts`, package files unchanged (`p0/reuse-diffs.txt`) |
| Caddy 35,340-path matrix | **REUSED / not repeated** | `deploy/` has an empty diff from `f10e47ad` and `692b1902` to Q''; no app route in the matrix imports the one changed `src` file |
| Visual capture | not applicable | no rendered UI changed in the code-path diff |

## 3. P1: rebuild reachability and the Q'' rebuild

Closure (`p1/closure.out`, `p1/closure/`): esbuild 0.28.2 metafile import closure of every TypeScript entry of the `tools/db/rebuild-test.ts` plan: `tools/db/rebuild-test.ts` (38 inputs),
`tools/db/migrate.ts` (3), `tools/db/privileges.ts` (2), `tools/migration/rebuild_afl_api_adjudications.ts` (38), `tools/records/import-first-kick-goal.ts` (34), `tools/v2/isolated-pg.ts` (13); union 57.
Intersection with `git diff --name-only 6d5388ea Q''` = **1 file: `src/db/queries/player-derived.ts`** (`p1/closure/rebuild-intersection.txt`). No `.py`, `.sql`, data, legacy, packages or migration file changed in any code path
(41 prefix hits, mostly evidence `.sql`; the only code hit `tools/db/afl-api-identity-correction-rehearsal.ts` is outside the closure). **Decision: REBUILD at Q''** (run 3's dump was not reused).

Rebuild (`p1/rebuild.out.gz`, `p1/rebuild-pre.out`, `p1/plan.out`, `p1/rebuild-times.txt`): `isolated-pg run afldb_v2_rb_rem4q_test -- node node_modules/tsx/dist/cli.mjs tools/db/rebuild-test.ts --target isolated --acknowledge-destroy afldb_v2_rb_rem4q_test`
from the `.env`-free `rb` checkout. Plan: 30 stages (no bridge dataset). Started 2026-11-15T01:49:01Z, **rc 0, 587 s**, heavy lock held. Inputs: 8/8 VERIFIED against Q'''s tracked pins by the committed `run3/rebuild/scripts/verify-inputs.mjs`
at the run-3 rebuild workspace source, copied read-only (`cp -a`, `chmod a-w`) into `rb/data`, **8/8 VERIFIED after copy and again after the rebuild** (`p1/inputs-*.txt`); the 752-line per-file list is IDENTICAL to `run3/rebuild/inputs-files.sha256` (`p1/inputs-files-vs-run3.diff` empty). RB-1 never read.
**FINAL VALIDATION: PASSED, 91 checks** (`p1/final-validation.txt`); its 90 `name = value (expected value)` lines are identical to run 3's `run3/rebuild/final-validation.txt`.

Dump: `pg_dump -Fc`, 20,662,027 bytes, sha256 `f3c7dca967ba9a0c7b3f8907af9cf00648aba879e25acc6da9770067a7715e5b` (`/mnt/ssd/afldb-rem4-qual-20261115/rebuilt/afldb_v2_rb_rem4q-1f7b0d71.dump`, host only; `p1/dump.out`, `p1/dump.toc.txt.gz`).
Restored into `afldb_v2_rem4qual_rb_tmpl_test` (exit 0).

Equivalence with the accepted run-3 dump `afldb_v2_rb_rem3-6d5388ea.dump` (sha256 `d8397aab...5c63`, verified; restored into `afldb_v2_rem4qual_rb3ref_test`):

| Proof | Result |
|---|---|
| exact `count(*)` of the **83 public tables**, Q'' restored vs published run-3 `table-counts.tsv` | **IDENTICAL** (`p1/rb-table-counts.diff` empty); rebuilt DB vs its own restore also identical |
| Brownlow `stat_availability`, 3 keys (`brownlow_season_total` / `round_votes` / `match_votes`), every season 1897..2026 (390 rows) | **IDENTICAL**: md5 `883b24199d4946093bbc67c1714c3763` in the rebuilt DB, the restored Q'' DB and the run-3 reference (`p1/brownlow-stat-availability.*`, both diffs empty) |
| per-table content digest (timestamp columns excluded; informational) | identical for 82 of 83 tables; **`venue_aliases` differs** (`p1/digest.r3-vs-q.diff`) |
| the one digest difference, explained | `venue_aliases` has 55 rows in both and the SAME set of (venue_id, alias, source_id) once the surrogate `id` is ignored (`p1/venue_aliases.explain.txt`); only the id order of two pairs is swapped (S.C.G. / Sydney Cricket Ground, venue 37; W.A.C.A. / WACA Ground, venue 45). The rebuild assigns those ids in a non-deterministic order. Nothing in the 83-table counts or the Brownlow proof depends on it |
| identity of the Q'' rebuild | ledger 118_fixtures_unconfirmed_participants.sql (count 118), matches 17,056, seasons 1897..2026, players 13,365, fixtures 0, 2026 `complete`, in-progress season 2027, 0 `player_match_stats` authority rows, draft_picks 6,810, draft_persons 5,057 |

Rebuild base for cells R-PF / R-SH = the Q'' rebuild restored from its own dump, then the DraftGuru bridge child import (`/mnt/ssd/afldb-rem3-base/rebuilt/afldb_v2_rb_rem3-draftguru-bridge-child-v3-6d5388ea.json`, sha256 `1200e702...6e9d`, verified) with the
`rb`-checkout importer, then `ANALYZE` (planner statistics only): rc 0, `draft_picks 6,810, draft_persons 5,057, bridge_identities 3,559`; bridged vs pristine restored counts differ only in `import_batches` +1 (`p1/post1.out`, `p1/post2.out`; the bridge output is at the top of `qualA.out`).

## 4. P2: static, unit, shell, build (all at Q'', `cand`)

| Check | Result |
|---|---|
| `npm run typecheck` | rc 0 |
| `npm run lint:gate` | PASSED (ratchet), 338 errors / 43 files = allowance |
| Unit, all files, fixtures installed (fitzRoy `full-history-20260902` 131 files re-verified against `run2/fixtures/fh-expected.sha256`; `sample.json` sha `d8d743fb...db28`; Stage A `annual-html-20260826` 42/42 vs the committed manifest and the 90-file tree IDENTICAL to `run3/qualification-3/stagea-src.sha256`; residual input `df6c9a75...e841` = `sample.json` residual_input) | **1 FAILED**, 214 files passed, 1 skipped; **12,296 tests passed, 1 failed**, 25 skipped; 643 s. The failure: `tests/v2-acquisition-pipeline.test.ts` > `(e) docs/v2/architecture.md §9 is the rendered stage map` > `equals renderAflApiStageMap output`: the committed stage map says `player-derived.ts:670` for `recomputeBrownlowCoverage`, the source now has it at `:730` (`unit/unit-allfix-failures.tsv`, `unit/unit-allfix.log`). **Finding F-001.** Not repaired (outside my scope) |
| Shell harnesses | `tests/restore-test.test.sh` rc 0: 24 passed, 0 failed. `tests/sync-dev-remote.test.sh` rc 0: 42 passed, 0 failed; it printed `NOT RUN: e2e generated-payload cases (set SYNC_DEV_GENERATED_DIR ...)` (those cases were not run) |
| `next build --webpack` + `prepare-standalone` | both rc 0; no `.env*` under `.next/standalone`; **BUILD_ID `6dRxZQwoAUGMbjI5f11G3`** (`build/`) |

## 5. P3: the four integration cells (`tests/integration`, 100 files, FRESH copy each, vitest JSON kept)

The tree has **100** integration files at Q'' against 99 in the B4 baseline: `tests/integration/brownlow-pending-coverage.test.ts` is new (it passed in all four cells). Per-cell ledgers: `<cell>/<cell>-failures.tsv`
(`file<TAB>full test name<TAB>first failure line`), `-counts.txt`, `-summary.txt`, `-order.txt` (execution order, JSON completion order), `-audit.jsonl` (per-file database audit, per-file cells), `.json.gz`, `.log.gz`.

| Cell | Base (fresh copy) | Mode | Files | Tests | Failing ids | Duration | Leftovers |
|---|---|---|---|---|---|---|---|
| **S-PF** | snapshot template | `AFLDB_TEST_PER_FILE_DB=all` | 9 failed, 85 passed, 6 skipped (100) | 15 failed, 3,518 passed, 2 expected fail, 113 skipped (3,671) | **18** (15 tests + 3 file-level) | 1,914.99 s (31.9 min) | per-file DBs 0; base counts unchanged |
| **R-PF** | Q'' rebuild + bridge | `all` | 5 failed, 89 passed, 6 skipped (100) | 4 failed, 3,529 passed, 2 expected fail, 113 skipped | **7** (4 tests + 3 file-level) | 1,813.04 s (30.2 min) | per-file DBs 0; base counts unchanged |
| **R-SH** | Q'' rebuild + bridge | shared (`AFLDB_TEST_PER_FILE_DB` unset) | 5 failed, 89 passed, 6 skipped (100) | 4 failed, 3,529 passed, 2 expected fail, 113 skipped | **7** | 1,557.95 s (26.0 min) | 1 table-count row changed: `import_batches` 27 -> 149 |
| **S-SH** | snapshot template | shared | 9 failed, 85 passed, 6 skipped (100) | 15 failed, 3,518 passed, 2 expected fail, 113 skipped | **18** | 1,580.35 s (26.3 min) | 2 table-count rows changed: `award_winners` 3,712 -> 3,713, `import_batches` 75 -> 197; `fixtures` 218 -> 218 |

"per-file DBs left" printed `1` (S-PF) and `2` (R-PF) by the harness: that counter greps `_pf_` and so also counted the cell BASE databases `afldb_v2_rem4qual_s_pf_base_test` / `..._r_pf_base_test`. The real per-file databases (`afldb_v2_pf_*`) at the end of all work: **0** (`final-db-list.txt`).
Shared-cell file orders: `s_sh/s_sh-order.txt`, `r_sh/r_sh-order.txt` (admin-fixtures 16th, after-siren 58th, nl-answers-after-siren 52nd; the baseline had 17th/67th/55th: the order moved because of the one additional file).

Failing ids (paths): `s_pf/s_pf-failures.tsv` (18), `r_pf/r_pf-failures.tsv` (7), `r_sh/r_sh-failures.tsv` (7), `s_sh/s_sh-failures.tsv` (18).

The R cells' 7 ids (identical in R-PF and R-SH, `cmp/cmp-r_sh-vs-r_pf-at-Qpp.tsv`: gone 0, new 0, continuing 7): three `gridley-corpus.test.ts` tests, the `settle-afl-api.test.ts` OD-5 reinstate test (`Refusing to rebuild 'afldb_v2_pf_..._test'`), and the three file-level refusals
(`v2-brownlow-eligibility-2025-rehearsal`, `v2-brownlow-production-correction`, `v2-coleman-publication`). The S cells' 18 ids are identical in S-PF and S-SH (gone 0, new 0, continuing 18): the R ids' counterparts plus `admin-brownlow` (1), `data-editor` (5), `draft-linkage` (2), `release-gates` (5).

### Comparisons (`cmp/`, TSV: status, file, id, class, text-changed, current line, baseline line; `status` = gone / new / continuing)

| Comparison | Baseline ids | Current ids | gone | new | continuing |
|---|---|---|---|---|---|
| S-PF vs run 3 (`cmp-s_pf-vs-run3.tsv`; `run3/qualification-3/integ-failures.tsv`) | 46 | 18 | 31 | 3 | 15 |
| R-PF vs B4 C1 (`cmp-r_pf-vs-b4c1.tsv`; `run4/baseline/raw/c1-failures.tsv`) | 73 | 7 | 66 | 0 | 7 |
| R-SH vs B4 C2 (`cmp-r_sh-vs-b4c2.tsv`) | 73 | 7 | 66 | 0 | 7 |
| S-SH vs B4 C3 (`cmp-s_sh-vs-b4c3.tsv`) | 46 | 18 | 31 | 3 | 15 |
| informational: S-SH vs S-PF, R-SH vs R-PF at Q'' | 18 / 7 | 18 / 7 | 0 | 0 | 18 / 7 |

Classes are copied from the baseline scope's `c1/c2/c3-classified.tsv` (themselves copies of run-3 `integb` section 7 rows): "gone" ids 27 x class 3 + 4 x class 5 (S) and 27 x class 3 + 4 x class 5 + 35 `to-classify` (R, the baseline's 37 unclassified minus two continuing).
Continuing S ids: 14 x class 1 + 1 x class 5 (the gridley "writes the run report" id). Continuing R ids: 4 x class 1, 1 x class 5, 2 x `to-classify` (two gridley ids, `unclassified-baseline`).
**The 3 "new" ids** are `release-gates.test.ts` "gate: birth dates ..." tests (`keeps the evidence behind every recovered date (14,110 historical, 14,294 on the accepted rebuild)`, `matches players on the profile URL rather than the name (13,275 historical, 13,367 on the accepted rebuild)`,
`populates the canonical dates with no conflicts (13,255 historical, 13,347 on the accepted rebuild)`): they are tests RENAMED and re-pinned by commit `6778a4ec` (ISSUE-363, 363-B) to the rebuild values; they fail on the snapshot (`expected 14110 to be 14294`, ...) and pass on the rebuild (absent from the R cells). Not classified by me: `to-classify`. One continuing id shows text "CHANGED"
in each comparison: only the per-file database name inside the `Refusing to rebuild '...'` message differs.

## 6. P4: dedicated clones and tools at Q''

Base recipe: `run3/integ/brownlow-clones.sh` adapted; retained artefacts copied read-only from the run-3 `integb` workspace and re-verified: dump `afldb_v2_rb_brownlow2025_test.dump` sha256 `5be45eab...ba4b` (29,920,966 bytes), `fixture-root.tar` `23cc8b76...ce23`,
`acquisition-014218.tar` `3ed1b46b...aa1b` (fixture acquisition byte-identical to the retained one), `template-identity.txt` (restored template identity == exported identity). Template restore with the 4 `pg_trgm`/`unaccent` extension TOC entries excluded, `vacuumdb --analyze-only`; clones named exactly as pinned, migrations 116-118 via the normal runner, then privileges.

| Suite / tool | Where | Result |
|---|---|---|
| `v2-brownlow-eligibility-2025-rehearsal` (`--no-cache`, shared) | `afldb_v2_brownlow_tristate_twelve_test` | **3/3 passed** |
| `v2-brownlow-production-correction` (`AFLDB_BROWNLOW_REHEARSAL_SOURCE_ROOT` = retained fixture root) | `afldb_v2_brownlow_policy_final_test` | **8/8 passed** (about 41 min) |
| `settle-afl-api` whole file, shared, OD-5 reinstatement | `afldb_v2_rb_rem4qod5rb_test` (Q'' rebuild base) | **74/74 passed** |
| `settle-afl-api` whole file, shared | `afldb_v2_rb_rem4qod5snap_test` (snapshot base) | **74/74 passed**; table counts unchanged on both |
| `v2-coleman-publication` | schema-only DB (`create-db` without template, `migrate.ts`, `privileges.ts`) | **28/28 passed** |
| ISSUE-238 rehearsal tool `tools/db/afl-api-identity-correction-rehearsal.ts` end to end | per case a fresh `code_test_db` created by the cluster superuser (this cluster, port 55687 asserted) from the Q'' rebuild restore; 84 cases/variants listed from the brownlow scope's `raw/ct-tip1/summary.tsv` | first pass `clones/ct/summary.tsv`: **62 PASS, 22 FAIL**: 21 of the failures are `react-server` writers (21 of the 22 `react-server` cases; the 22nd, `c94-no-audit`, passed) that ABORTED because MY launcher put `--conditions=react-server` before `tsx/dist/cli.mjs` instead of after it (harness error; incident I-1) and `c47`. Rerun of the 22 `react-server` cases with the corrected launcher (`clones/ct-rsc/summary.tsv`, `clones_b.sh`): **22/22 PASS** |

`c47` (the full-rebuild case) **ABORTED** with `the import DSN is not afldb_import@127.0.0.1:55432/code_test_db; the full rebuild is not run` (11/11 checks before the abort; the tool pins the literal port 55432 in its printed-target assertion, `tools/db/afl-api-identity-correction-rehearsal.ts:7130,7247`, and no connection to 55432 is made). Per the brief it stays class 6. Net: 83 of 84 cases PASS, c47 aborted by design (same as the brownlow scope's 83 + c47).
Summary lines in `clones/ct/summary.tsv` read `... -> PASS -> PASS` (cosmetic double verdict from my launcher; the first `-> PASS|FAIL` is the tool's own).

### P4 addendum (F-FX-1, commit 65fe171d): the `mnew` / `mnewsnap` mutation

The mutation is the one `run4/fixup/scripts/batch2.sh` builds (the brief names `batch3.sh`, which holds the state-b mutations M1/M2 and no `mnew`; `batch2.sh` is where `mnew`/`mnewsnap` live): `INSERT INTO brownlow_season_votes (season, player_id, club_id, votes) SELECT 2026, (SELECT min(id) FROM players), NULL, 1;
UPDATE stat_availability SET coverage = 'complete', is_recorded = true WHERE stat_key = 'brownlow_season_total' AND season = 2026`, on scratch copies of the Q'' rebuild restore and the snapshot template, `club-comparison.test.ts -t 'exposes selected-season Brownlow coverage'`, shared mode (`clones/m*`).

| Run | Result at Q'' |
|---|---|
| `mctlrb`, `mctlsnap` (unmutated controls) | pass (1 passed, 69 skipped) |
| **`mnew`** (rebuild, mutated) | **FAIL** (not the expected PASS): `AssertionError: expected 0 to be greater than 0` at `tests/integration/club-comparison.test.ts:1883:34` (`expect(pending.totalVotes).toBeGreaterThan(0)`) |
| **`mnewsnap`** (snapshot, mutated) | **FAIL**, the same assertion and line |
| `mnewfile`, `mnewfilesnap` (whole file, mutated) | 2 failed, 68 passed on each base: the same test and `club Brownlow history excludes ambiguous multi-club seasons and discloses them instead of forcing them` (`expected false to be true`) |

The failing line moved from the old `:1881` (`isAuthoritative` should be false) to `:1883`: the F-FX-1 fix now passes `:1882` (`pending.isAuthoritative` is `true` once 2026 votes load) and fails on the next assertion because the specified mutation's single row has `club_id` NULL, so no club (Adelaide here) gets a vote total (`getClubSeasonBrownlowSummary` sums `attributed` rows of the selected organisation).
Supplementary, my own addition (`clones_c.sh`, phase `mreal`, `clones/mreal*`): the same load made REALISTIC (one 3-vote row per club that played in 2026, attached to a real 2026 player of that club and that `club_id`; `stat_availability` 2026 `complete`): **the targeted test passes on both bases (1 passed, 69 skipped) and the WHOLE club-comparison file passes 70/70 on both bases.** I report both; whether the acceptance mutation should carry club attribution is the orchestrator's call (**Finding F-002**). All scratch copies were dropped.

## 7. Findings (none repaired by me)

* **F-001 (MED)** `tests/v2-acquisition-pipeline.test.ts` `(e)` fails at Q'': `docs/v2/architecture.md:179` still says ``src/db/queries/player-derived.ts:670`` for `recomputeBrownlowCoverage`; Q'''s +126-line change to `player-derived.ts` moved it to `:730`. The test's own message gives the fix: `npx tsx tools/v2/acquisition-stage-map.ts --write` (docs-only regeneration; `git diff 692b1902 Q'' -- docs/v2/architecture.md tools/v2/acquisition-stage-map.ts` is empty, so nothing regenerated it). This is the only unit failure (12,296 passed).
* **F-002 (MED)** The specified F-FX-1 mutation does not turn the Lions summary test green (fails at `:1883`, section 6); the club-attributed (realistic) mutation does, 70/70.
* **F-003 (LOW)** S-SH leaves one extra `award_winners` row on the snapshot: season 2026, award_id 47, source_id 10 (`misc/aw.diff.txt`). Not seen in R-SH (the rebuild already holds that row; snapshot template has 0). Not present in the B4 C3 diff. Likely the awards-reload-links restore added by `581a898b`; unconfirmed. `to-classify`.
* **F-004 (INFO)** Rebuild is not byte-deterministic for `venue_aliases.id` (two id pairs swap); set-equal, all 83 table counts identical.
* **F-005 (INFO)** Shared-mode residue is smaller than the B4 baseline's (B4 C2/C3 changed 7-11 table counts; Q'' R-SH 1, S-SH 2): consistent with the leaks scope, observation only.
* **F-006 (INFO)** The F-008 allowlist wording is ambiguous about `evidence/` sub-directories (section 2).

## 8. Incidents

* **I-1** My ISSUE-238 launcher placed `--conditions=react-server` before `node_modules/tsx/dist/cli.mjs`; `tsx` runs the script in a child process that does not inherit it, so 21 of the 22 server-only-module cases ABORTED with "the real writers are server-only modules". Corrected (`clones_b.sh`: flag after `cli.mjs`) and those cases rerun: 22/22 PASS. The first-pass `clones/ct/summary.tsv` is retained as it ran.
* **I-2** The harness counter "per-file DBs left" matches `_pf_` and so counts the cell base databases (section 5). Real per-file databases: 0.
* **I-3** `setup.out` begins with a harmless `fatal: cannot change to '.../cand'` (the phase driver ran `git -C` before the clone existed).
* No breach of a hard stop: nothing pushed, no production/DEV/5432/`afldb_test`/RB-1/live-Brownlow contact, no sudo/wsl, lint baseline untouched.

## 9. Scripts and cleanup

`scripts/` holds every host script as run (LF): `common.sh setup.sh closure.sh closure.mjs rebuild.sh digest.mjs qual.sh clones.sh clones_b.sh clones_c.sh post.sh compare.mjs collect_p1.sh collect_cells.sh va.sh probe.sh final_state.sh aw.sh aw2.sh final_stop.sh`
(`clones.sh` is the first pass; `clones_b.sh` = the corrected ISSUE-238 rerun, phase `ct_rsc`; `clones_c.sh` adds phase `mreal`). Cluster stopped; no listener on :55687; host `cand` and `rb` HEAD = Q'', porcelain empty (`misc/final-stop.txt`). The workspace is left in place (`du`: workspace 5.4 GB, cluster 5.0 GB).

## 10. Committed hash lists

Four payload hash lists are committed as `*.hashlist.txt`, not `*.sha256`: `p1/inputs-files-q.hashlist.txt` (752 rebuild-input files), `clones/fixture-root.hashlist.txt` (258 retained fixture files), `fixtures/stagea-src.hashlist.txt` (90) and
`fixtures/stagea-expected.hashlist.txt` (42). They list files that live only on the host (the run-3 copies); the run-4 manifest checker treats any `*sha256*` basename as a manifest and, with no host root declared for them in its map, reported their 1,142 entries
`UNRESOLVED`. Content is unchanged by the rename (listed with its hash in `SHA256SUMS`); the first commit of this directory (`656b2c62`) carried them under the old names.
