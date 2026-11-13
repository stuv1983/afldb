# Remediation 2026-11-14 — `pins` scope (ISSUE-358; ISSUE-363 TST-5, TST-6)

Branch `claude/rem-pins-20261114`, base `5035ed96`. Code commits `3524a1a3` .. `4d2234bc`; this README is a later,
evidence-only commit. Host workspace `/mnt/ssd/afldb-rem-pins-20261114`, port 55611 (cluster stopped, no listener,
`du -sh` 2.9G, left in place). No build, no production or DEV read.

## Findings

| Finding | Verdict | Evidence |
|---|---|---|
| TST-1 stale sibling pin | **validated** | `git show HEAD:data/players/sibling-relationships.csv` sha256 `b1f0ff4e…d318`; pin was `dc8d6180…` (`tools/db/rebuild-test.ts` `REVIEWED_INPUT_PINS`). Red: `red-new-R1.txt`, `pincheck.txt` (unfixed code refuses with "Reviewed input pin: … sha256 b1f0ff4ed0bf… does not match the reviewed pin dc8d61801512…"). 21 failures in baseline `red-base.txt` |
| TST-1 provenance | **established (both halves of P-2)** | Owner decision naming the pair: `docs/v2/evidence/gap029-s4-apply-20261103/approval-statement-20261103T090824209Z.txt` ("I approve D4-PROD … one sibling pair (McGovern) … afldb-sibling-supplement:015 … artefact b1f0ff4e…d318"); S4 apply `COMMITTED_VERIFIED` 2026-11-03T09:08:35Z (`docs/v2/gap-029-s4-outcome-and-closure-2026-11-03.md` §2). Presence in the production snapshot: `sibling-snapshot-probe.txt` (disposable copy of the 2026-11-04 snapshot: 499 sibling rows, one `siblings:afldb-sibling-supplement:015`, players 6937/9714). Rebuild intent: its expected counts derive from the tracked provenance measures (`siblingMeasures()`, 499 pairs), so only the pin was stale |
| Other pins | **checked, no further defect** | The other three `REVIEWED_INPUT_PINS` match their files; the four ladder manifests (`2bd66e3d…`, `604a8a16…`, `02bbcf93…`, `65c29907…`) hash to their `LADDER_PAIRS` values. Not recomputable here: artefact-set hashes and the pinned manifests whose bytes are gitignored (validated by the loaders in preflight); `ORDINARY_ESBUILD_SHA256` is host-specific |
| `nl-answers-relationships.test.ts:52` (658) | **validated, amended fix (P-3/R-4)** | Value is now read from the tracked rebuild input (`sibling-relationships.source.json` measures `players_with_brother` 658 -> 660), not a snapshot literal. Oracle: rebuilt `afldb_test` (which loads that file); the snapshot agrees. RED on a fresh snapshot copy with the old literal: "expected 660 to be 658" x2; GREEN 49/49 (`int-nl.txt`, again 49/49 on the final checkout) |
| TST-3 stage map | **validated** | one row: `settle-afl-api.ts:356` -> `:357`. Generator exists: `tools/v2/acquisition-stage-map.ts --write`. Regenerated on the host, one-line diff |
| TST-2 restore-order pin | **validated** | `tests/db-promotion-check.test.ts` searched `COMMENT ON DATABASE ${RESTORE_DB} IS NULL` (absent since ISSUE-341/342 `printf`); order still holds in `tools/maintenance/restore-test.sh` |
| TST-6 `AFLDB_PYTHON` | **validated** | baseline: only `AFLDB_PYTHON=venv` -> 78 failed / 34 passed of the six (`red-six-onlyAFLDB_PYTHON.txt`); only `PYTHON=venv` -> all pass |
| TST-5 seven uninvoked contracts | **validated; stale 1c amended** | named below. `fitzroy_profile_continuity_contract.py` 1c: `c7e17da2` (ISSUE-316 2026 rollover, State B) intentionally extended the four rules to 2026 and re-bound `renumbered_rows` 25/18/23/13 (=79) to 52/31/42/25 (=150); the check expected the old sum, so it was updated to the reviewed per-rule values, not loosened |

The seven contracts: `brownlow_afl_api_season_rehearsal_contract.py`, `draftguru_bridge_v2_contract.py`,
`draftguru_child_validation_v3_contract.py`, `draftguru_population_scan_contract.py`,
`fitzroy_profile_continuity_contract.py`, `issue333_o2_contract.py`, `settle_emit_contract.py` (all pass with the venv
interpreter; two import psycopg, so the host `python3` fails them, exactly like the six suites).

## Pinned files (P-4): any other scope editing one of these makes the new pin test red

`data/players/height-evidence-wikipedia.csv`, `data/players/father-son-selections.csv`,
`data/players/sibling-relationships.csv`, `data/records/after-siren-events.csv` (LF-normalised sha256 in
`REVIEWED_INPUT_PINS`). The new test names every stale pin with its recomputed digest.

## Red / green (host, `AFLDB_PYTHON` = venv only, no DB variables for unit suites)

Red logs: `red-base.txt` (unfixed `de640826`), `red-new.txt` + `red-new-R1.txt` (new tests against unfixed sources).

| Test | Red (unfixed) | Green |
|---|---|---|
| three suites `db-test-rebuild`, `v2-acquisition-pipeline`, `db-promotion-check` | 24 failed / 1635 passed (`red-base.txt`) | all pass (final: 10 files 1879 passed, 1 skipped) |
| new "every reviewed input pin is recomputed" (2 tests) | fails: `data/players/sibling-relationships.csv: pinned dc8d6180… but the tracked file is b1f0ff4e…` | pass |
| stage-map test | `settle-afl-api.ts:357` vs `:356` with the one-command hint | pass |
| restore-order pin, mutations of `restore-test.sh` | (a) guard removed from the clear stream: "expected -1 to be greater than 6858"; (b) bind written before restore: "expected 9341 to be less than 7043" | pass on the real script |
| wrapper row `fitzroy_profile_continuity` against the unfixed contract | `FAIL 1c … 79 …` | pass |
| inventory test with a fake unwired `zz_unwired_contract.py` | "contracts no suite runs … ['zz_unwired_contract.py']" | pass (removed) |
| six suites with only `AFLDB_PYTHON` | 78 failed / 34 passed | 150 passed, 1 skipped (coach raw bundle, gitignored: environment) |

## Final qualification

Checkout `/mnt/ssd/afldb-rem-pins-20261114/final`: `git rev-parse HEAD` = `4d2234bc38099a3e6ca6923dd14844211b0b9046`,
`git status --porcelain` empty before and after (`final-qual.txt`); `node_modules` hard-link copy of the candidate's
`npm ci` tree (same lockfile). Bundle sha256 `4bca6867546d0c9b68a952f41d12d917de8ce8a9bb40eeb06293dd4d543f0591`.

- Whole unit gate once (`--exclude 'tests/integration/**'`, only `AFLDB_PYTHON`): **7 failed, 11,899 passed, 31 skipped
  (11,937); 2 files failed** (baseline 107 failed). All 7 are environmental: the gitignored `data/sources/…` snapshots
  (`final-unit-failures.txt`): 4 fitzRoy 1909/2025 snapshot ENOENT, 2 DraftGuru frozen Stage B1 sample, 1 DraftGuru bridge
  import gate check 9.6 (`snapshot directory not found … draftguru/annual-html-20260826`; previously hidden behind the
  interpreter failures). None touches a pin or this scope.
- Focused: the three suites + `reference-data` (wrapper, resolver, inventory) + six Python suites: 10 files, 1879 passed, 1 skipped.
- `tests/integration/nl-answers-relationships.test.ts` on a fresh snapshot copy: 49/49.
- Host evidence (`/mnt/ssd/afldb-rem-pins-20261114/evidence/`, sha256): `final-unit.json`
  `073f1eed1b44caa6c08d3ac12dc04e02d4b896cfdff9507ba23664b9b58a8aa3`, `final-unit-verbose.log`
  `4d79dce9f16d5913ce5625e44144ba0aa2cd732ad65cc6357eeccffa8aa3a175`, `final-focused.log`
  `a060f0b06ccbd1bca6e86fe44443e40cb54a1f7ceb19363c9a07176f8a91cb0c`, `final-qual.log`
  `531db22a0d3c3c12876b1c1ef5ef6992e81029c0e2f36e27553ec34e6ac18c5a`, `red-base.log`
  `1d8da840ae76529f991699174121e20f8015675e4eeee0df591f0fbd428dde60`, `red-new.log`
  `2887013e2fc8d94d120a33693922b18c8893fca4f66b0da6653938e6a6092c74`, `int-nl.log`
  `4aa7990f86e299dad3c6022da12721fa718b4233ef0581cd78dd1c9f2cb6cfb8`, `rebuild-run.log`
  `8a577a132300af2c0ab355249bc466478a834e6ad264529aa76f6818e3b4e5c7`.

## Rebuild (P-1)

Target proven before anything ran (`rebuild-pre.txt`): `127.0.0.1:55611`, database `afldb_v2_rb_rempins_test`, isolated
launcher variables, no `.env`, `DATABASE_URL`/`AFLDB_TEST_DATABASE_URL` unset first; the isolated target admits only
`afldb_v2_hist_test` / `afldb_v2_rb_*_test` named, DSN- and marker-checked databases and refuses `afldb_test`. The
rebuild preflight (which runs before any destruction) then **refused**: `snapshot file missing: …/data/sources/afltables/
fitzroy_core/c2-2026-final-core-v1/player_stats_1897.csv … Nothing has been destroyed` (`rebuild-run.txt`). The retained
gitignored source snapshots are not in a clean checkout, and I did not copy them from other workspaces. **Not run: a
disposable rebuild.** Proven instead: `assertReviewedInputPins()` passes on the fixed code and refuses on the unfixed
code (`pincheck.txt`), and the 21 rebuild unit failures are gone. The preflight reaches the pin check only after the
snapshot checks, so a full preflight needs the retained snapshots (owner/host action).

## Notes for integration

- R-5: after any edit that shifts an export line of a cited file, run `npx tsx tools/v2/acquisition-stage-map.ts --write`
  (the test failure message says so) and commit `docs/v2/architecture.md`; `rollover`'s settle edit is the likely trigger.
- P-5: the wrapper is the `CONTRACTS` table at the end of `tests/reference-data.test.ts`; a new `tests/python/*_contract.py`
  (for example `draftguru`'s) needs one row `['<file>.py', /<closing line>/]`, and the inventory test fails until it has one.
- 14 further suites still read only `PYTHON` (`all-australian-source`, `award-definitions-source`, `captaincies-source`,
  `club-best-and-fairest-source`, `coleman-derivation`, `external-grids-import`, `hall-of-fame-source`,
  `honour-teams-source`, `named-medals-source`, `player-identity-source`, `rising-star-source`,
  `rising-star-winners-source`, `under-22-importer`, `under-22-source`); outside the brief, they pass on the host `python3`
  (stdlib). `resolveTestPython` is ready for them.
- `tests/db-promotion-check.test.ts` now pins the literal `printf` lines of `tools/maintenance/restore-test.sh`; `hostops`
  (backup/restore docs) or anyone editing that script must keep them or update the pin deliberately.
- The scratchpad file `setup.sh` (shared scratch directory) was overwritten by this agent at about 08:46 before it
  moved to its own subdirectory; if another scope's `setup.sh` vanished, that is why.
- Script provenance: every host script used (copies in `scripts/`) was written by this agent under `<scratchpad>\pins\`,
  copied to `/mnt/ssd/afldb-rem-pins-20261114/in/` (all reference this workspace path) and run from there. `setup.sh`
  was re-copied from `pins\` after the early overwrite; its output (`HEAD=de640826…`, `added 427 packages`, dump
  size/sha256) is consistent with this workspace. The bundle is `scratchpad\bundles\pins.bundle`. No recorded result
  came from another scope's script.
