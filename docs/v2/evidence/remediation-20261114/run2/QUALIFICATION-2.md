# Remediation run 2 — final qualification

**Executable revision Q = `f10e47adf9697d9a59a03dd627615e61e8213d30`** (branch `claude/remediation-20261114`). Commits after Q
touch records only; see `APPROVAL-PACKET-2.md`, which proves this with `git diff --stat Q..tip`.

## Environment

- **Host:** DEV host `streamanator`, fresh workspace `/mnt/ssd/afldb-rem2-int-20261114`.
  - Clone of the review candidate, plus the bundle `e8666c17..claude/remediation-20261114` (sha256 `03bdbff2…10aa`).
  - Checkout detached at Q, 0 porcelain lines before and after every phase.
  - `node_modules` from `npm ci` at `e8666c17`. `package.json` and `package-lock.json` are unchanged since then; checked by the script.
- **Database:** isolated PostgreSQL 16 on 127.0.0.1:55660, template `afldb_v2_rem2int_tmpl_test`.
  - Restored from the 4 Nov production snapshot: `afldb_prod-20261104T021037Z.dump`, sha256 `e77c307d…826d`, 30,141,895 bytes, verified.
  - Then migrated: ledger `118_fixtures_unconfirmed_participants.sql`, 17,056 matches.
  - Every database used was a fresh copy of that template.
- **Heavy phases:** run under the shared lock `/mnt/ssd/afldb-rem2-base/heavy.lock`. Node 22.23.2; Python `/home/arm/i250/afldb/.venv`.
- **Script and output:** `qual.sh` (copied here as `qualification-2/qual.sh.txt`). Raw output stays on the host under `evidence/q-f10e47ad/`; committed copies are in `qualification-2/` with `SHA256SUMS`.
- **DEV untouched:** service state `DEV-STATE-AFTER-2.txt`, compared with `DEV-STATE-BEFORE-2.txt`.

## Results at Q

| Check | Result | Evidence |
|---|---|---|
| `npm run typecheck` (`next typegen` + `tsc --noEmit`) | **rc 0** | `typecheck.log` |
| `npm run lint:gate` | **PASSED as a ratchet, not clean lint:** 338 errors in 43 files, equal to the baseline (unchanged since run 1, not expanded) | `lint-gate.log` |
| Unit, all files except `tests/integration/**`, **without** the retained fixtures | **7 failed** / 12,282 passed / 31 skipped (12,320; 216 files), 603 s | `unit-nofix.json.gz`, `unit-nofix-failures.txt` |
| Unit, same, **with** the fitzRoy `full-history-20260902` and DraftGuru `sample.json` fixtures | **2 failed** / 12,287 passed / 31 skipped | `unit-fix.json.gz` |
| `tests/draftguru-acquisition.test.ts` with Stage A and the residual input added (hash-verified, below) | **166 passed / 1 skipped, 0 failed** | `unit-stagea2.log` |
| Unit, all files, with **every** fixture present (fitzRoy, `sample.json`, Stage A, residual input) | **0 failed** / 12,295 passed / 25 skipped (12,320; 215 files passed, 1 skipped) | `unit-allfix.json.gz`, `unit-allfix.log` |
| `tests/restore-test.test.sh` | **24 passed, 0 failed** | `restore-test.test.sh.log` |
| `tests/sync-dev-remote.test.sh` | **42 passed, 0 failed** | `sync-dev-remote.test.sh.log` |
| Integration, all 99 files, **per-file disposable databases** (`AFLDB_TEST_PER_FILE_DB=all`, ISSUE-363 wrapper, fresh base) | **46 failed** / 3,448 passed / 2 expected-fail / 128 skipped (3,647); 14 files failed, 79 passed, 6 skipped; 1,852 s; **0 per-file databases left** | `integ.json.gz`, `integ-failures.tsv` |
| `next build --webpack` (production) + `prepare-standalone` | **rc 0**, BUILD_ID `dKd6UdRfV0Fg8LcJU13q1`; one existing Edge-runtime warning (`process.cwd` in Next's own `dynamic-rendering.js`) | `build-next.log`, `build-standalone.log` |
| AFLW `%27` metadata on that build, direct and through `deploy/Caddyfile.production` at Q (Caddy 2.11.4) | `/aflw/players/Aasta_O%2527Connor` **200**, title "Aasta O'Connor — AFLW Stats, Games & Career Record \| AFLDB", canonical `https://afldb.com/aflw/players/Aasta_O%2527Connor` (kept encoded), robots `index, follow`, both direct and via the beta host with the path-shape deny on. `…O%27Connor` and the raw apostrophe return **404** noindex, as on run 1's routes build. The apex host answers 404: it is the coming-soon holding site | `aflw-meta.txt` |

### Unit failures, classified

All failures are in two files, and every one is an environment class (a missing gitignored fixture). None is caused by a run-2 change.

| Id | Without fixtures | With the 2 fixtures | With Stage A and residual input |
|---|---|---|---|
| fitzRoy source row corrections ×3; blank Player fallback ×1 (`fitzroy-core-import`) | fail (ENOENT `full-history-20260902`) | pass | n/a |
| frozen Stage B1 sample: "is the frozen 120 / 8 / 68 / 30 / 14 contract" | fail (`sample.json` missing) | pass | pass |
| frozen Stage B1 sample: "rebuilds byte-identically from the accepted Stage A snapshot" | fail | fail (Stage A missing) | **pass** |
| DraftGuru bridge import gate (`draftguru-acquisition`) | fail | fail (Stage A missing; run 1 FAILURE-CLASSIFICATION N2) | **pass** |

### Fixture provenance (no snapshot fabricated, no approved baseline replaced)

Each fixture was copied read-only (`chmod -R a-w`) into the qualification checkout only, and re-verified after copying. Nothing was written to any source location.

- **fitzRoy `full-history-20260902`:** from `/home/arm/projects/afldb/data/sources/afltables/fitzroy_core/full-history-20260902` (DEV checkout data, read-only). All 131 files match the per-file hashes in the committed manifest (`run2/fixtures/fh-expected.sha256`). The test pins this retired label on purpose. The accepted baseline `c2-2026-final-core-v1` is not replaced (fixtures F-003).
- **DraftGuru `sample.json`:** from the retained workspace `i336-preview2-20261106`. sha256 `d8d743fb…db28`.
- **DraftGuru Stage A `annual-html-20260826`:** from the DEV checkout's data, 90 files.
  - All 42 raw files match the committed manifest `docs/rebuild-manifests/draftguru/annual-html-20260826.json`.
  - All 90 paths and hashes are identical to the second retained copy (`i336-preview2-20261106`). Tree hash `ceea2d34…de2` (`stagea-provenance.txt`).
- **DraftGuru `person-html-20260826/input/residual_player_urls.txt`:** from `i336-preview2-20261106`. sha256 `df6c9a75…e841`, equal to `sample.json` `residual_input.sha256` and to the test's own pin.

### Integration failures, classified (52 ids: 46 tests + 6 file-level)

**The failing-id set equals the ISSUE-363 scope's classified per-file run** (`tests363`, revision `ad073a72`, `full-all.json`): 52 = 52, 0 only-here, 0 only-there.
The fixes integrated since then (REVIEW-C MED-1, REVIEW-D LOW-3/LOW-4/MED-1/MED-2/LOW-5) changed no failing id.

| Class | Ids | Evidence |
|---|---|---|
| Snapshot-oracle (the test pins a rebuilt `afldb_test` value; the 4 Nov production snapshot differs) | club-comparison 24, database 4 (e.g. `695499` vs `685471`), draft-linkage 2, admin-brownlow 1 (P2 `9522`), gridley-corpus 1, release-gates 8 | Each fails identically at the baseline. **No rebuilt `afldb_test` was available, so these are classified, not passed** (QUALIFICATION §6, unchanged). |
| Environment / precondition | data-editor 5 (the snapshot holds an active `player_match_stats` authority row); settle-afl-api 1 (OD-5) | run 1 FAILURE-CLASSIFICATION |
| Refuses by design (needs a dedicated clone or an empty table) | file-level: v2-brownlow-eligibility-2025-rehearsal, v2-brownlow-production-correction, v2-coleman-publication, settle-afl-api-issue276 | refusal text names the requirement |
| Fixture-oracle | file-level: awards-reload-links (the same 2 describe-level Coleman errors as at baseline) | tests363 README |
| Hidden order dependence (real test defect, LOW, open follow-up under ISSUE-363) | file-level: settle-afl-api-state-b ("a leftover fixture row exists"; it also fails alone in shared mode on a snapshot copy) | tests363 F-1 |

Against run 1's broad run (106 ids):
- 64 ids are gone (61 now pass; 3 leak file-level errors are absent). The shared-mode control in tests363 shows the same, so the cause was load, not the mode.
- 42 ids are common.
- 10 ids are new to the list: release-gates 8 (the file now runs instead of being skipped by the leak guard), the awards file-level oracle, and state-b.
- The run-1 "unclassified" `database` "separates the war years" failure **did not recur**. It stays unexplained (run 1 FAILURE-CLASSIFICATION).

## Focused regressions (scope qualifications on clean checkouts, carried by file identity)

| Scope | Revision | Result |
|---|---|---|
| public (parser, MED-1 and LOW-3) | `f3acebab` (code identical to Q for these files) | tsc 0; eslint 0 errors; 9 unit files 1,173/1,173; 7 executing integration files 177/177; V5 parse-only corpus 0/12,000 changed (the corpus holds no "round" rows, so the tests are the proof) |
| tests363 (harness, REVIEW-D) | `20b4c9df` | `dsn-policy` 73/73, module-boundaries 53/53, isolated-test-target 27/27; 14 mutation cases red; real-server refusals; single-file `MODE=all` run rc 0 |
| caddy357 LOW-4 | `cdf2bce5` | real Next build behind Caddy 2.11.4 and 2.11.9: log lines carrying the token went from 4 before the fix to 0 after; contract test red 2/2 then green 86/86 (`caddy357/low4/`) |
| earlier scopes (lint364, admin, ops, evidence, caddy357 matrix) | their scope READMEs | carried by file identity; files unchanged since (`evidence/TESTED-REVISIONS.md` method) |

## Visual evidence

**VISUAL: no new capture needed.** No rendered UI changed after the scope captures:
- `busy.tsx` changed in a comment only;
- the parser changes are search answers, proved by the executing tests;
- the Caddy changes affect the access log only.

The scope captures stand: `public/visual`, `admin/visual`.

## Runs not counted

- A first final-qualification run at `acd3a8c9` was **stopped by the orchestrator** after typecheck (rc 0) and lint (ratchet PASSED), because REVIEW-D's MED findings changed the harness. Its partial output is on the host (`evidence/qual-acd3a8c9.out`, marked STOPPED). Nothing from it is counted.
- The orchestrator's stop command matched its own ssh shell. The vitest children were orphaned, then killed by PID; nothing else was affected.

## Gaps (not run or not proven)

- **No rebuilt `afldb_test`.** The snapshot-oracle ids above are classified, not passed. ISSUE-363 decision (3) waits on that rebuild.
- **Never run on production:** any unit under systemd, the host-policy files, and the ssh/rrsync paths. Root-only facts stay unverified.
- **Not repeated:** the 35,340-path Caddy matrix after LOW-4. The change touches the log `format filter` only; the responses were re-checked on the real app.
- **The dedicated-clone Brownlow suites** were not run with their clones.
- **The V5 corpus** cannot exercise the "round" changes, because it contains no "round" rows.

## Unit with every fixture

With every hash-verified fixture present, the whole unit suite passes at Q: **12,295 passed, 25 skipped, 0 failed** (rc 0, porcelain 0;
the fixture directories are gitignored). Without the fixtures, the 7 failures above are all missing-file environment failures.
