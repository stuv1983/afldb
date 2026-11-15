# Run 4, scope `fixloop`: requalification of Q″ to Q‴ (`16027092e075d9064df8a3749c4b17805c2eaaeb`)

Worker `afldb-worker` (Sonnet), 2026-11-15. Everything ran on the DEV host `streamanator` (user `arm`) in the run-owned workspace `/mnt/ssd/afldb-rem4-fixloop-20261115`
(cluster `/mnt/ssd/afldb-rem4-fixloop-20261115-pg`, PostgreSQL on **127.0.0.1:55689** only; heavy phases under `flock /mnt/ssd/afldb-rem4-base/heavy.lock`).
Nothing was pushed; production, DEV services, port 5432, the shared `afldb_test`, the run-1/2/3 and qual workspaces (read-only inputs only) and RB-1 were not touched.
Verdicts are raw. Host originals are hashed in `HOST-SHA256SUMS` (absolute paths); committed files in `SHA256SUMS` (relative to this directory).
**This record commits only `run4/fixloop/**`.** Verdicts are not relabelled: the one acceptance expectation that was **not** met (F4, `mnew` whole file) is reported as found (section 3 F4 and section 4, finding F-001).

## 1. Environment and identity

| Item | Value |
|---|---|
| Revision under test (executable) | Q‴ = `16027092e075d9064df8a3749c4b17805c2eaaeb` (branch `claude/remediation-20261114`) |
| Host checkout `$W/cand` | `git rev-parse HEAD` = `9346605bd4cbd00465fd6a69d47ff3bf2ea064ed` (the integration tip; Q‴ is an ancestor, the only commit above Q‴ is `9346605b`, which adds `run4/FAILURE-LEDGER-4.{md,tsv}`), `git status --porcelain` empty before and after EVERY phase (`raw/fixA.out`, `fixB.out`, `fixC.out`, `setup1.out`, `setup2.out`: every `#####` line prints `porcelain-before=0` / `porcelain-after=0`), and at the end (`raw/final-stop.txt`) |
| Bundle | `/mnt/ssd/afldb-rem4-base/base-Q3.bundle`, sha256 `692120bbae25c11189abdcf8929a5a8eaf82f1a37a73816d65fa98b40e426c45` (verified on the host before use; line 3 of the base `SHA256SUMS`); head `refs/heads/claude/rem4-fixloop-20261115` = `9346605b…`; `git bundle verify`: complete history |
| Node / vitest | v22.23.2 / 4.1.10; `npm ci` 427 packages |
| Q″ rebuild dump (qual P1, read-only) | `/mnt/ssd/afldb-rem4-qual-20261115/rebuilt/afldb_v2_rb_rem4q-1f7b0d71.dump`, 20,662,027 bytes, sha256 `f3c7dca967ba9a0c7b3f8907af9cf00648aba879e25acc6da9770067a7715e5b` (verified before use; unchanged) |
| 4 Nov snapshot (read-only, production-derived, never copied) | `/mnt/ssd/afldb/workspaces/afldb-issue333-o2-20261104/private/afldb_prod-20261104T021037Z.dump`, 30,141,895 bytes, sha256 `e77c307d…826d` (both verified before use) |
| Snapshot template `afldb_v2_rem4fixloop_snap_tmpl_test` | restored with `/mnt/ssd/afldb-review-20261114T0640Z/in/restore.mjs` (pg_restore exit 0, 6 s), `migrate.ts`: "118 migration file(s), 118 already applied"; ledger 118, matches 17,056, seasons 1897..2026, players 13,365, fixtures 218, 2026 `complete`, none in progress; **83-table exact counts IDENTICAL to qual's committed `p1/snap-template.table-counts.tsv`** (`raw/snap-template-vs-qual.diff` empty) |
| Q″ rebuild template `afldb_v2_rem4fixloop_rb_tmpl_test` | restored exactly like RESTORE.md (`/mnt/ssd/afldb-rem3-base/rebuilt/restore-dump.mjs`, pg_restore exit 0, 28 s, `IR verify` ok), then `ANALYZE` (planner statistics only; qual's R cells used an analyzed template); ledger 118, matches 17,056, seasons 1897..2026, players 13,365, fixtures 0, 2026 `complete`, in-progress season 2027; **83-table exact counts IDENTICAL to qual's committed `p1/rb-table-counts.restored.tsv`** (`raw/rb-table-counts-vs-qual.diff` empty) |
| DraftGuru bridge | **not applied** to the rebuild template: `tests/integration/club-comparison.test.ts` has no `draft` or `bridge` reference (`grep -n -i "draft\|bridge"` prints nothing), so the bridge import (which needs the Stage-A checkout) cannot affect the file; qual's own `mnew`/`mreal` ran on the un-bridged restore as well |
| `.env` | none in `cand` (guard refuses one; Stage A absent from `cand` during F3 and F4, installed only after them for F2) |
| Scratch databases | every per-run copy `afldb_v2_rem4fixloop_<label>_test` created with `create-db --template` and dropped at the end of its run; the end state holds only the two templates (`raw/final-db-list.txt`) |

## 2. What changed Q″ → Q‴ (verified)

`git diff --stat 1f7b0d717b37e98432716d6b9170fbd45142ab63 16027092e075d9064df8a3749c4b17805c2eaaeb`: **277 files**, +19,474/−5. Lists committed: `p0/diff-Qpp-Qppp.txt` (all 277),
`p0/diff-Qpp-Qppp-outside-qualification-4.txt` (the 5 below). 272 of the 277 are `docs/v2/evidence/remediation-20261114/run4/qualification-4/**` (the qual run's own record, commits `f5281bae`, `40875e7f`, committed after Q″; records only).
The 5 others (the whole of the executable or checker difference; `git diff --stat` of exactly these: 5 files, +23/−5):

| File | Change |
|---|---|
| `docs/v2/architecture.md` | one stage-map line: `src/db/queries/player-derived.ts:670` → `:730` for `recomputeBrownlowCoverage` |
| `tests/integration/club-comparison.test.ts` | `+7/−2` in the `expected2026 === 'complete'` branch: `expect(pending.totalVotes).toBeGreaterThan(0)` replaced by `expect(pending.totalVotes).not.toBeNull(); expect(typeof pending.totalVotes).toBe('number')` (+ comment); `isAuthoritative === true` unchanged |
| `docs/v2/evidence/remediation-20261114/run4/evidence/manifest-map.tsv` | three `hroot` rows appended (baseline host evidence dir ×2, clubcmp host checkout) |
| `run4/evidence/README.md` | §8 amendment recording the map change |
| `run4/evidence/SHA256SUMS` | the two updated lines |

Nothing else: `git diff --name-only Q″ Q‴ -- src tools deploy packages package.json package-lock.json next.config.ts data docs/rebuild-manifests scripts public tests/restore-test.test.sh tests/sync-dev-remote.test.sh` prints **0 files**; under `tests/` only `club-comparison.test.ts` differs; the checker script `verify-manifests.sh`, `selftest.sh` and everything under `run2/` are unchanged (empty diff).
Above Q‴ to the tip: `git diff --name-only Q‴ 9346605b` = `run4/FAILURE-LEDGER-4.md`, `run4/FAILURE-LEDGER-4.tsv` (records only).
Anything else changed: **no** (stop condition not triggered).

## 3. Results

### F1 Static (`raw/typecheck.log`, `raw/lint-gate.log`)
`npm run typecheck`: **rc 0**. `npm run lint:gate`: **rc 0, PASSED (ratchet): 338 errors in 43 files now; baseline allows 338 in 43** (no increase; baseline untouched; no `--update`).

### F2 Unit (all files outside `tests/integration`, with every hash-verified fixture installed)
Fixtures were copied READ-ONLY from the qual workspace `/mnt/ssd/afldb-rem4-qual-20261115/cand/data/...` (themselves qual's verified copies of the run-3 originals) and re-verified at source and at copy before the unit run:
fitzRoy `full-history-20260902` 131/131 files against the committed `run2/fixtures/fh-expected.sha256`; `sample.json` sha `d8d743fb…db28`; Stage A `annual-html-20260826` 42/42 raw files against the committed manifest `docs/rebuild-manifests/draftguru/annual-html-20260826.json`,
the 90-file tree **IDENTICAL** to `run3/qualification-3/stagea-src.sha256` (tree sha256 `ceea2d34…64de2`), residual input `df6c9a75…e841` = `sample.json` `residual_input.sha256` (`raw/fixtures-provenance.txt`, `raw/stagea-provenance.txt`; the payload lists are `raw/stagea-{src,expected}.hashlist.txt`).

| Run | Result |
|---|---|
| `tests/v2-acquisition-pipeline.test.ts` alone (`raw/unit-focus.*`) | **24/24 passed**, including `(e) docs/v2/architecture.md §9 is the rendered stage map > equals renderAflApiStageMap output` (qual F-001 red at Q″, **green at Q‴**) |
| FULL unit, run 1 (`raw/unit-all.*`, 637.30 s) | **1 failed**, 214 files passed, 1 skipped; **12,296 passed, 1 failed**, 25 skipped. The failure is `tests/rate-limit.test.ts` > `RateLimiter.peek` > `is false again once the window has passed`: `AssertionError: expected false to be true` at `tests/rate-limit.test.ts:55:31`. `(e)` passed in this run (`raw/unit-all-e.txt`) |
| `tests/rate-limit.test.ts` alone ×10 (`raw/unit-rl.log`) | **10/10 passed (6/6 each)** |
| FULL unit, run 2 (`raw/unit-all2.*`, 639.47 s) | **0 failed**: 215 files passed, 1 skipped; **12,297 passed**, 25 skipped; `(e)` passed (`raw/unit-all2-e.txt`) |

Classification of the run-1 failure, evidence only: the test builds `new RateLimiter(1, 1)` (a **1 ms** window), calls `check` twice and asserts `peek('a') === true` immediately (`tests/rate-limit.test.ts:49-55`); on a loaded host a scheduling or GC pause of more than 1 ms between the calls moves the window and the assertion sees `false`. It is unrelated to the Q″→Q‴ diff (neither `tests/rate-limit.test.ts` nor `src/` changed, section 2), it passed in qual's Q″ unit run, it passed 10/10 alone and in run 2. Class: environment/timing flake, class 1 ("passes under intended conditions"); **not repaired or weakened** (out of scope; reported as F-002).

### F3 `club-comparison.test.ts`, whole file, at Q‴, fresh copy per run (`raw/f3_*`)

| Run | Base (fresh `--template` copy) | Mode | Files | Tests | Duration | Table counts before/after |
|---|---|---|---|---|---|---|
| `f3_rb_pf` | Q″ rebuild | per-file (`AFLDB_TEST_PER_FILE_DB=all`; the per-file database audit shows residue `[]`) | 1 passed | **70 passed, 0 failed** | 27.09 s | unchanged |
| `f3_rb_sh` | Q″ rebuild | shared (`AFLDB_TEST_PER_FILE_DB` unset) | 1 passed | **70 passed, 0 failed** | 24.41 s | unchanged |
| `f3_snap_pf` | 4 Nov snapshot | per-file | 1 passed | **70 passed, 0 failed** | 28.68 s | unchanged |
| `f3_snap_sh` | 4 Nov snapshot | shared | 1 passed | **70 passed, 0 failed** | 24.39 s | unchanged |

All four: the targeted `exposes selected-season Brownlow coverage without presenting a partial total` test passed; 2026 `season_total` = `pending`, 0 vote rows (the real state of both bases); per-file databases left 0.

### F4 F-FX-1 mutations at Q‴ (scratch copies of both bases, dropped after each run; shared mode; `raw/m*`)

`LOADED` (qual's/fixup's `mnew`, **byte-identical to `run4/fixup/scripts/batch2.sh`**; `INSERT INTO brownlow_season_votes (season, player_id, club_id, votes) SELECT 2026, (SELECT min(id) FROM players), NULL, 1; UPDATE stat_availability SET coverage = 'complete', is_recorded = true WHERE stat_key = 'brownlow_season_total' AND season = 2026`) and `REAL` (qual's `mreal`: one 3-vote row per club that played in 2026, attached to a real 2026 player of that club and that `club_id`; 18 rows) are in `scripts/fix.sh`.
Only `brownlow_season_votes` changed (+1 for LOADED, +18 for REAL; `*.table-counts.diff`); no other table count moved.

| Run | Base | Scope | Result at Q‴ | Expected | Met |
|---|---|---|---|---|---|
| `mctlrb`, `mctlsnap` (unmutated control, targeted) | rebuild, snapshot | `-t 'exposes selected-season Brownlow coverage'` | pass, 1 passed / 69 skipped, both | pass | yes |
| unmutated whole-file control | both bases, both modes | whole file | the four F3 runs, **70/70** | pass | yes |
| `mnew`, `mnewsnap` | rebuild, snapshot | targeted | **pass** (1 passed, 69 skipped each); Q″: `expected 0 to be greater than 0` at `:1883` | pass | yes |
| **`mnewfile`** | rebuild | WHOLE file | **1 failed, 69 passed**: `club Brownlow history excludes ambiguous multi-club seasons and discloses them instead of forcing them`: `AssertionError: expected false to be true` at `tests/integration/club-comparison.test.ts:1800:70` (`for (const row of unattributed) expect((row.clubCount ?? 0) > 1).toBe(true)`) | pass (70/70) | **NO** |
| **`mnewfilesnap`** | snapshot | WHOLE file | **1 failed, 69 passed**: the same test, the same line | pass (70/70) | **NO** |
| `mrealrb`, `mrealsnap` | rebuild, snapshot | targeted | pass (1 passed, 69 skipped each) | pass | yes |
| `mrealfile` | rebuild | WHOLE file | **70/70 passed** | pass | yes |
| `mrealfilesnap` | snapshot | WHOLE file | **70/70 passed** | pass | yes |

**Reading of the `mnew` whole-file result (finding F-001).** At Q″ the same two whole-file runs failed 2 tests (the targeted one at `:1883` and this one); at Q‴ only this one remains, so the Q‴ edit fixed what it set out to fix, and the targeted test is green under `mnew` on both bases. The remaining failure is a different, unchanged assertion (`:1800`) whose contract is
"every unattributed row is a genuine multi-club season, not a missing-data accident" (`oracleBrownlowRows` / `attribute`: a vote row is unattributed when `club_id` is NULL and `player_season_stats.club_count` for that player and season is not 1). The `mnew` row is by construction a `club_id` NULL row for `(SELECT min(id) FROM players)`.
Read-only probe on both templates (`raw/probe-mnew-player.txt`, `scripts/probe_mnew.sh`): that player has **0** `player_season_stats` rows for 2026 (so `clubCount` is null → 0 → not "> 1"), **0** `player_match_stats` matches in 2026, and **no player has a 2026 `club_count > 1` on either base**; so no club_id-NULL 2026 vote row can satisfy the invariant here.
The `REAL` mutation (explicit `club_id`, so the rows are attributed and not in the unattributed set) passes the whole file 70/70 on both bases. Conclusion (evidence, not a decision): the specified `mnew` mutation is not a valid model of "2026 Brownlow loaded" for a file that also asserts the multi-club invariant; the whole-file expectation "passes under each mutation" holds for `mreal` but **not** for `mnew`.
Whether `mreal` replaces `mnew` as the acceptance mutation, or the specification is narrowed to the targeted test, is the orchestrator's decision; no test or mutation was changed by me.

### F5 Reuse table (every qual result not re-run, with the exact justification)

Commands (workstation, `git -c core.longpaths=true`): `git diff --name-only 1f7b0d71 16027092 -- src tools deploy packages package.json package-lock.json next.config.ts data docs/rebuild-manifests scripts public tests/restore-test.test.sh tests/sync-dev-remote.test.sh` = **0 lines**;
`git diff --name-only 1f7b0d71 16027092 -- tests` = `tests/integration/club-comparison.test.ts` only; `git diff --name-only 1f7b0d71 16027092 | grep -v run4/qualification-4/` = the 5 files of section 2; migrations: `src/db/migrations` is under `src` (0 lines), highest is `118_fixtures_unconfirmed_participants.sql`.

| Qual result (`run4/qualification-4`) | Decision | Justification |
|---|---|---|
| Typecheck, lint gate | RE-RUN (F1) | cheap; rc 0; 338/43 |
| Unit (all) | RE-RUN (F2) | the stage-map file changed and the unit suite reads `docs/v2/architecture.md` |
| Integration cells S-PF, R-PF, R-SH, S-SH (100 files each) | **REUSED for every file except `club-comparison.test.ts`** | the diff contains no `src/`, `tools/`, `deploy/`, `data/`, package or migration file and exactly one test file; no other integration file or its imports changed. `club-comparison.test.ts` passed (`✓`) in all four qual cells at Q″ (`r_pf/r_pf-order.txt` etc., position 5; also `club-comparison-route` and `-view` ✓) and is re-run here (F3/F4). Limit: F3 runs the file on its own, not at its position inside the full-tree shared sequence; the edit only loosens one assertion in one branch (`> 0` → recorded number), so it cannot make the in-sequence result worse, but that is an argument, not a measurement |
| ISSUE-238 rehearsal tool (84 cases), Brownlow clone suites, OD-5 `settle-afl-api`, `v2-coleman-publication` | REUSED | `tools/` and `src/` are identical (0 lines); neither the tool, nor its pins, nor the suites, nor the clones' inputs changed |
| Shell harnesses (`restore-test.test.sh`, `sync-dev-remote.test.sh`) | REUSED | the scripts, `tools/maintenance` and `deploy/` are in the 0-line diff |
| `next build --webpack` + `prepare-standalone`, BUILD_ID `6dRxZQwoAUGMbjI5f11G3` | REUSED | no `src/`, `next.config.ts`, package or `deploy/` change; `docs/v2/architecture.md` is not imported by `src/`, `next.config.ts` or `package.json` (`grep -rln "docs/v2/architecture" src next.config.ts package.json` prints nothing; its only consumer is the unit test) |
| Rebuild reachability, the Q″ rebuild and its equivalence proofs | REUSED | the qual closure union of the rebuild plan (57 files, `p1/closure/rebuild-union.txt`) ∩ `git diff --name-only Q″ Q‴` = **0**; the dump is the same file (sha256 re-verified) and its restored 83-table counts again equal qual's (section 1) |
| AFLW `%27` metadata; Caddy 35,340-path matrix; visual capture | REUSED / not applicable | AFLW closure union (58 files, `p1/closure/aflw-union.txt`) ∩ diff = **0**; `deploy/` and `next.config.ts` identical; no rendered UI changed |
| Manifest checker over the record | RE-RUN (F6) | its map and README changed in Q‴ |

### F6 Manifest checker on a fresh clone of the final commit
`run4/evidence/verify-manifests.sh` with `REQUIRE_NO_UNRESOLVED=1` is run on a FRESH clone of this record's final commit on the host (`EVIDENCE_LOCAL_HOST=1`, an empty directory, `git rev-parse HEAD` printed, porcelain empty). Per the brief its output is **not committed** (it would change the commit it verifies); the class counts and rc are in the worker's final report.

## 4. Findings

* **F-001 (MED, in scope; needs an orchestrator decision, no code change by me)** F4: the specified `mnew` mutation passes the targeted test but still fails the whole `club-comparison.test.ts` on both bases (1 failed, 69 passed, `:1800`), because a club_id-NULL 2026 vote row for `min(players.id)` violates the unchanged "every unattributed row is a genuine multi-club season" invariant (that player has no 2026 `player_season_stats` row; no player has a 2026 `club_count > 1`). `mreal` passes the whole file 70/70 on both bases. Options: (1) adopt `mreal` as the acceptance mutation (recommended: it models loaded 2026 results with attributed rows, and is exactly the realistic case the Q‴ edit was written for); (2) restrict the `mnew` acceptance to the targeted test (it passes). I changed nothing.
* **F-002 (LOW)** `tests/rate-limit.test.ts` "peek is false again once the window has passed" failed once in a full unit run under host load (1 ms window), passed 10/10 alone and in a second full run (12,297 passed, 0 failed). Pre-existing timing sensitivity, not in the Q″→Q‴ diff.
* **F-003 (INFO)** The qual `final_stop`-style "processes naming the workspace" counter printed `1` in `raw/final-stop.txt`: it is the `tee` of that very command (its argument names the output file); a separate `pgrep -u arm -af $W` afterwards printed 0 matches.

## 5. Incidents

* No breach of a hard stop: nothing pushed, no production/DEV/5432/`afldb_test`/RB-1/live-Brownlow contact, no sudo/wsl, lint baseline untouched, no log deleted.
* `setup1.out` begins with a harmless `fatal: cannot change to '.../cand'` (the phase driver runs `git -C` before the clone exists; same as qual I-3).
* `scripts/fix.sh` was extended once after the first unit run with two phases (`unit_rl`, `unit_all2`) and its `seal` list; the earlier phases are unchanged. The committed copy is the final one.
* Two helper reads after the runs: `scripts/probe_mnew.sh` (first version referenced a non-existent table `player_seasons`, printed `relation does not exist`, then corrected to `player_season_stats`; read-only throughout).

## 6. Scripts, hash lists, cleanup

`scripts/`: `common.sh setup.sh fix.sh probe_mnew.sh final_state.sh final_stop.sh` as run (LF). Phases run: `setup.sh clone cluster`, `setup.sh tmpl_snap tmpl_rb`, `fix.sh static f3 f4`, `fix.sh fixtures_base fixtures_stagea unit_focus unit_all seal`, `fix.sh unit_rl unit_all2 seal`, `probe_mnew.sh`, `final_state.sh`, `final_stop.sh`.
Adapted from `run4/qualification-4/scripts/` (`common.sh`, `setup.sh`, `qual.sh`, `clones_c.sh`): the workspace, port 55689, database names, bundle (`base-Q3.bundle`), revision (tip / Q‴) and fixture source (the qual workspace) are the differences; the vitest invocation, guards, `vfail.js`/`counts.js` extraction, the per-file runner (`run2/tests363/run-integration-per-file.sh`) and both mutation SQL strings are qual's.
Committed payload hash lists are named `*.hashlist.txt` (`raw/stagea-src.hashlist.txt`, `raw/stagea-expected.hashlist.txt`), not `*sha256*`, so the manifest checker does not treat host-only payload lists as manifests.
Cluster stopped, no listener on :55689, no process naming the workspace (`raw/final-stop.txt`, F-003). The workspace is left in place (`du`: workspace 1.9 GB, cluster 1.4 GB).
