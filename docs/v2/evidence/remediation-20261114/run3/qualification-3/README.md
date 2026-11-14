# Remediation run 3 — final integrated qualification

**Executable revision Q′ = `692b1902cbcc321cea76a30857a03e15f02db6b7`** (`ISSUE-363: run-3 final qualification scripts`), branch
`claude/rem3-qual-20261114`, created at integration commit `ed256295`. Q′ is the last commit that changes code, tests or scripts. The
commit that adds this directory changes records only (path allowlist: `git diff --stat Q′..tip` lists only files under
`docs/v2/evidence/remediation-20261114/run3/qualification-3/`; the agent report prints it).

## Proof that Q′ is the last executable change

```
$ git diff --stat f10e47ad Q′ -- . ':!docs' ':!issues.md' ':!IssuesIndex.md' ':!blockers.md' ':!CHANGELOG.md'
 tests/integration/database.test.ts                | 23 ++++--
 tests/integration/settle-afl-api-brownlow.test.ts | 87 ++++++++++++++++++++---
 tests/integration/settle-afl-api-issue276.test.ts | 26 ++++++-
 tests/integration/settle-afl-api-state-b.test.ts  | 82 +++++++++++++++++++--
 tests/integration/settle-afl-api.test.ts          | 69 +++++++++++++++++-
 5 files changed, 264 insertions(+), 23 deletions(-)
```

- Run 2's qualified revision Q = `f10e47ad`. Since Q the only non-record change is the five integration test files above. **Nothing under `src/`,
  `tools/`, `packages/`, `deploy/`, `package.json`, `package-lock.json` or `next.config.ts` changed** (`git diff --stat f10e47ad Q′ -- src tools packages deploy
  package.json package-lock.json next.config.ts` is empty; the same command against `6d5388ea` is empty too).
- `git diff 8db4007d Q′ -- tests src tools packages deploy` is **empty** (0 bytes): phase B's rebuilt-database runs (`run3/integb`, host checkout `8db4007d`)
  carry to Q′ by file identity.
- **Rebuild staleness (PLAN-REVIEW-3 F-008):** `git diff --stat 6d5388ea Q′ -- tools/db tools/migration tools/rebuild src/db/migrations data/reference` is empty,
  so the accepted-baseline rebuild (`run3/rebuild`, at `6d5388ea`) does not need repeating. It is carried by file identity.
- **Scripts used for this evidence are committed in Q′ itself** (`setup.sh`, `qual.sh`, `fixtures.sh` in this directory; blob sha256, equal to the
  host copies run: `setup.sh` `d6c5dec5…a2`, `qual.sh` `f2e04d4e…2c0`, `fixtures.sh` `b062da72…c78`; `scripts.sha256`). The only other scripts that ran are the already
  committed `run2/tests363/run-integration-per-file.sh` and `tools/…` code. The failing-id extraction and comparison are inside `qual.sh` (`vfail`, `CMP_JS`); before
  committing I proved `vfail` reproduces run 2's `integ-failures.tsv` key set exactly (52 = 52, 0 differences) when run over run 2's `integ.json.gz`.

## Environment

- **Host:** DEV host `streamanator`, **fresh** workspace `/mnt/ssd/afldb-rem3-qual-20261114` (did not exist before; plain `mkdir`), cluster root
  `/mnt/ssd/afldb-rem3-qual-20261114-pg`, **PostgreSQL 55674** (app 55676 and Caddy 55677 reserved, never started). No `.env` in the checkout.
- **Checkout:** `git clone` of the review candidate, then my bundle `de640826..claude/rem3-qual-20261114` (`qual.bundle`, 10,309,594 bytes, sha256
  `36ec338a17bb90097c363c19caa38aa460b89b151fa88df694f9794958d7efe7`, verified on the host, `git bundle verify` ok), `git checkout --detach Q′`,
  **`git rev-parse HEAD` = Q′ and 0 porcelain lines before and after every phase** (the driver stops on a non-zero count; `qual-692b1902.out.txt`).
  `npm ci` ran at Q′ (427 packages). `package.json` and `package-lock.json` are identical to `6d5388ea` (checked in setup and again in the checkout phase).
  Node 22.23.2, vitest 4.1.10, Python `/home/arm/i250/afldb/.venv`.
- **Database:** isolated PostgreSQL 16, template `afldb_v2_rem3qual_tmpl_test` restored from the 4 Nov production snapshot (`afldb_prod-20261104T021037Z.dump`,
  30,141,895 bytes, sha256 `e77c307d…826d`, both verified before use; `restore.mjs`), then migrated: ledger `118_fixtures_unconfirmed_participants.sql`,
  17,056 matches (`tmpl-probe.txt`). Every database used was a fresh `--template` copy.
- **Heavy phases** ran under `/mnt/ssd/afldb-rem3-base/heavy.lock`, detached (`setsid nohup`), polled with bounded calls.
- **Raw output** stays on the host under `evidence/q-692b1902/`; the committed copies are here with `SHA256SUMS`. No snapshot-derived rows are committed (ids and counts only).
- **DEV, production, `afldb_test` on :5432, sudo, wsl, push: not touched.**

## Results at Q′

| Check | Result | Evidence |
|---|---|---|
| `npm run typecheck` (`next typegen` + `tsc --noEmit`) | **rc 0** | `typecheck.log` |
| `npm run lint:gate` | **PASSED as a ratchet, not clean lint: 338 errors in 43 files**, equal to the baseline (338 in 43) and to run 2 | `lint-gate.log` |
| Unit (all files except `tests/integration/**`) **without** the retained fixtures | **7 failed** / 12,282 passed / 31 skipped (12,320; 216 files: 2 failed, 213 passed, 1 skipped), 601 s | `unit-nofix.json.gz`, `unit-nofix-failures.tsv` |
| Unit with the fitzRoy `full-history-20260902` and DraftGuru `sample.json` fixtures | **2 failed** / 12,287 passed / 31 skipped (1 file failed), 610 s | `unit-fix.json.gz`, `unit-fix-failures.tsv` |
| Unit with **every** fixture (fitzRoy, `sample.json`, Stage A `annual-html-20260826`, residual input) | **0 failed** / 12,295 passed / 25 skipped (12,320; 215 files passed, 1 skipped), 670 s, rc 0 | `unit-allfix.json.gz`, `unit-allfix.log.gz` |
| `tests/restore-test.test.sh` | **24 passed, 0 failed** (rc 0) | `restore-test.test.sh.log` |
| `tests/sync-dev-remote.test.sh` | **42 passed, 0 failed** (rc 0; "e2e generated-payload cases" NOT RUN, as the script states) | `sync-dev-remote.test.sh.log` |
| Integration, all 99 files, **per-file disposable databases** (`AFLDB_TEST_PER_FILE_DB=all`, fresh base `afldb_v2_rem3qual_base_692b1902_test` from the snapshot template), JSON reporter | **42 failed** / 3,457 passed / 2 expected-fail / 123 skipped (3,647); 11 files failed, 82 passed, 6 skipped; 1,855 s; **0 per-file databases left** | `integ.json.gz`, `integ-summary.txt`, `integ-failures.tsv`, `integ.log.gz` |
| `next build --webpack` (production) + `prepare-standalone` | **rc 0 / rc 0**, BUILD_ID `cnEy98lTDk5v5UlbJLNFH`; the one existing Edge-runtime warning (`process.cwd` in Next's own `dynamic-rendering.js`), as at Q | `build-next.log.gz`, `build-standalone.log` |
| AFLW `%27` metadata (direct and through `deploy/Caddyfile.production`) | **NOT RUN, not required.** No build-affecting or Caddy file changed since Q: the diff above is five test files only; `deploy/`, `src/`, `tools/`, `packages/`, `next.config.ts` and both package files are unchanged. Run 2's `qualification-2/aflw-meta.txt` stands | n/a |

Unit counts at Q′ are **identical** to run 2 at Q in every row (7 / 2 / 0 failed; 12,282 / 12,287 / 12,295 passed; 31 / 31 / 25 skipped).

### Unit failures, classified (all missing-fixture environment failures; same ids as run 2)

| Id | Without fixtures | With the 2 fixtures | With Stage A and residual input |
|---|---|---|---|
| fitzRoy source row corrections x3; blank Player fallback x1 (`fitzroy-core-import`) | fail (ENOENT `full-history-20260902`) | pass | n/a |
| `draftguru-acquisition`: "is the frozen 120 / 8 / 68 / 30 / 14 contract" | fail (`sample.json` missing) | pass | pass |
| `draftguru-acquisition`: "rebuilds byte-identically from the accepted Stage A snapshot" | fail | fail (Stage A missing) | pass |
| `draftguru-acquisition`: "DraftGuru bridge import gate" | fail | fail (Stage A missing) | pass |

### Fixture provenance (copied read-only, `chmod -R a-w`, hash-verified at source and again at the copy; nothing written to any source)

`fixtures.sh` copies from the same retained sources as run 2 (`QUALIFICATION-2` "Fixture provenance"). The `base` phase ran before the unit-with-fixtures
and integration runs; the `stagea` phase ran after the integration run, exactly as in run 2 (so the integration run is like for like).

- **fitzRoy `full-history-20260902`:** from `/home/arm/projects/afldb/data/sources/afltables/fitzroy_core/full-history-20260902` (DEV checkout data, read-only): **131/131** files
  match the committed per-file hashes `run2/fixtures/fh-expected.sha256` at the source and at the copy (`fixtures-provenance.txt`).
- **DraftGuru `sample.json`:** from the retained workspace `i336-preview2-20261106`; sha256 `d8d743fbcfca39a4c9e708a1198c7e34592270d32628d4fc0003aea88068db28` at source and copy.
- **DraftGuru Stage A `annual-html-20260826`:** from the DEV checkout's data. **42/42** raw files match the committed manifest
  `docs/rebuild-manifests/draftguru/annual-html-20260826.json` (`stagea-expected.sha256` is derived from it by `fixtures.sh`); all 90 paths and hashes are identical to the second retained
  copy (tree hash `ceea2d34…de2`, equal to run 2's); the 90-file copy was re-verified (`stagea-provenance.txt`, `stagea-src.sha256`).
- **`person-html-20260826/input/residual_player_urls.txt`:** from `i336-preview2-20261106`; sha256 `df6c9a75…e841`, **equal to `sample.json`'s `residual_input.sha256`** (read from the copied
  `sample.json` by the script) and to the test's pin; verified at source and copy.

## Integration failing ids: comparison with run 2

Run 2 at Q (`run2/qualification-2/integ-failures.tsv`): 52 ids (46 tests + 6 file-level). This run at Q′ (`integ-failures.tsv`): **46 ids (42 tests + 4 file-level)**.
Keyed on file plus full test name (`integ-compare.txt`, produced by `qual.sh`): **6 gone, 46 common, 0 new**. **No regression.**

### Gone (6): each is a run-3 fix, proved red on the unfixed code and green on a snapshot copy by the owning scope

| Id | Run 2 failure | Fix and evidence |
|---|---|---|
| `database` "data integrity has the full player-match dataset" | `expected 695499 to be 685471` | witness re-pinned from the retired baseline to the accepted c2 value 695,499 (`bb81cbc9`, `run3/integb` section 5: `database.test.ts` 69/69 on a fresh snapshot copy and on the rebuild) |
| `database` "200-249 games with 16 or more finals" | `expected 120 to be 114` | re-pinned 114 -> 120 (same commit and evidence) |
| `database` "50-199 goals and no Brownlow votes" | `expected 268 to be 261` | re-pinned 261 -> 268 (same) |
| `database` "200+ games, 100+ goals and 15+ finals" | `expected 223 to be 219` | re-pinned 219 -> 223 (same). The values equal what the application returns on the snapshot; this run shows `database.test.ts` 69/69 passed |
| `settle-afl-api-issue276` (file-level) | "ISSUE-276 cases cannot run: these existing canonical rows are not ISSUE-276 fixtures ... 2026\|PF\|2026-09-19\|Hawthorn\|Brisbane Lions" | fixtures use an ordinary home-and-away round so they cannot collide with the real 2026 final (`532e234d`, integb section 4): **4/4 passed here** |
| `settle-afl-api-state-b` (file-level) | "a leftover fixture row exists ... externalIdentities: 1" | the suite owns its identity rows (`CD_I2071275001`) and never reads, adopts or deletes the snapshot's `CD_I297354` row (`18cbde7b`; `settle-afl-api` likewise `69168858`; `run3/stateb`): **1/1 passed here**, per-file mode |

The `settle-afl-api-brownlow` hygiene fix (`6edf4f99`) removes no id from this list: its effect was on the `database` "separates the war years" id, which is not in run 2's
failing set either (it did not recur under per-file databases). The brownlow family is green here: `settle-afl-api-brownlow` 21/21, `-backtest` 6, `-reschedule` 3, `-fixtures` 16.

### Common (46): the failure text is the same as run 2 on 45 of 46; the 46th differs only in a timestamped per-file database name

| Class (run 2's classification, unchanged) | Ids | Run-3 evidence for the cause |
|---|---|---|
| Snapshot-oracle: the test pins a rebuilt-`afldb_test` value; the 4 Nov snapshot differs | club-comparison 24, draft-linkage 2, admin-brownlow 1, gridley-corpus 1, release-gates 8 | `run3/integb` section 7 classes: class 3 stale witnesses (club-comparison 24, release-gates 3, left uncorrected, owner decision), class 5 limitation (gridley, release-gates "2026 is provisional" x3), class 1 (draft-linkage 2, admin-brownlow 1, release-gates 2: **pass on the accepted-baseline rebuild**, fail on the snapshot as here) |
| Environment: the snapshot holds an active `player_match_stats` authority row | data-editor 5 | integb class 1: pass on the rebuild (0 authority rows) |
| Refuses by design: needs a dedicated clone or a schema-only base | file-level: v2-brownlow-eligibility-2025-rehearsal, v2-brownlow-production-correction, v2-coleman-publication | integb class 1: pass on the dedicated clones (B2 3/3, B1 8/8) and the Coleman schema-only base |
| Fixture oracle (Coleman contract 46 vs 47) | file-level: awards-reload-links (97 passed, 10 skipped) | integb class 5, owner decision |
| Per-file database name | settle-afl-api OD-5 (`Refusing to rebuild 'afldb_v2_pf_...'`): the rebuild guard accepts only `afldb_test` and a few fixed names, so a per-file database cannot run it. Text differs from run 2 only in the timestamp | integb: passes in single-file shared mode on a snapshot copy and on the rebuild |

Counts by file: club-comparison 24, release-gates 8, data-editor 5, draft-linkage 2, and 1 each for admin-brownlow, awards-reload-links, gridley-corpus, settle-afl-api,
v2-brownlow-eligibility-2025-rehearsal, v2-brownlow-production-correction, v2-coleman-publication = 46.

**These are classified, not passed.** As in run 2 this run used the snapshot template, not the accepted-baseline rebuild, so every snapshot-oracle id remains a classified
failure here. The rebuild-side verdicts are `run3/integb` (carried by file identity, see the proof above).

## Evidence manifests

`run2/evidence/verify-manifests.sh` (unchanged) was run from the workstation against the branch at `9cb06c53` (the commit that adds the raw evidence; this README and the
verifier output are added after it, records only), with the host hashed read-only over ssh. Output: `manifest-verify-9cb06c53.tsv`.

| Status | Count |
|---|---|
| COMMITTED-OK | 754 |
| **COMMITTED-MISMATCH** | **1** (a verifier false positive, below; **not 0**) |
| HOST-OK | 141 |
| HOST-MISSING | 94 |
| HOST-MISMATCH | 0 |
| UNRESOLVED | 1,300 (no host-path rule or prose hashes; none is a mismatch) |

- **The one COMMITTED-MISMATCH is not an evidence defect and predates this scope** (it is present at `ed256295`, before any commit of mine). Manifest
  `run3/integ/evidence/brownlow/retained-artefacts.SHA256SUMS` line 4 lists `template-identity.txt` = `4ec64b7b…3ea60`, a retained artefact of the Brownlow clone. The verifier finds
  candidate files by basename inside the first path component after the evidence base, which for run 3 is the single component `run3`, and so compares it with an unrelated committed file,
  `run3/integb/evidence/c1/template-identity.txt` (sha256 `81a6c2fb…a32`, the restored-template identity of integb). The real file is committed as
  `run3/integ/evidence/brownlow/template-identity.restored.txt` and hashes to `4ec64b7b…3ea60` (`run3/integ/evidence/SHA256SUMS:75`, `run3/integb/SHA256SUMS:132`). I did not edit the verifier or any other
  scope's file (a verifier change is a script change after Q′, and an existing evidence file is out of scope); the fix (scope by the first two components, or a rename) is the orchestrator's decision.
- **The 94 HOST-MISSING are the same set as run 2's recorded verification** (`run2/evidence/manifest-verify-b0c7e02d.tsv`, 94): 90 files of `qualification/iso-3aa82166/stagea-dst.sha`
  (a run-1 workspace copy no longer on the host) and 4 for `auth/`. **None belongs to this scope.**
- This scope's own manifests (`SHA256SUMS`, 35 entries; `SHA256SUMS-host.txt`): 57 rows COMMITTED-OK, 141 UNRESOLVED (names with no host-path rule: the Stage A listings, the host-side script
  hashes), **0** mismatch or missing. Every committed blob was also checked with `git cat-file blob HEAD:<path> | sha256sum` against `SHA256SUMS`: 35/35 equal.
- **`.gitattributes` was not changed and keeps the evidence bytes.** The one raw log holding CR bytes (`build-next.log`, 3 CRLF progress lines) is committed gzipped
  (`build-next.log.gz`; `gunzip | sha256sum` = the host's `0da9ecd5…bdc23`, listed in `SHA256SUMS-host.txt`), so `* text=auto eol=lf` cannot rewrite it. Every other committed text file has no CR.
  `SHA256SUMS-late` hashes this README and the verifier output, which cannot be listed in `SHA256SUMS` (it was fixed before they existed).

## Gaps (not run or not proven)

- The integration run is on the 4 Nov snapshot, not the accepted-baseline rebuild (as the brief instructed); its 46 failing ids are classified from the owning scopes' evidence, not passed.
- AFLW `%27` metadata, the Caddy matrix, the visual captures: not repeated (no change since Q; see the table).
- Never run here: units under systemd, host-policy files, the ssh/rrsync paths; the dedicated-clone Brownlow suites with their clones (integb ran them).
- `sync-dev-remote.test.sh` prints "NOT RUN: e2e generated-payload cases" by design (needs `SYNC_DEV_GENERATED_DIR`).
- Lint is a ratchet over 338 existing errors, not clean lint.

## Incidents and disclosures

1. My first detached launch of `setup.sh` failed before running anything: the log redirect pointed into `$W/evidence`, which `setup.sh` creates itself and which did not
   exist yet. I created it with `mkdir -p` and relaunched. Nothing had run; no partial state.
2. One foreground poll (a remote `sleep 150`) exceeded the tool timeout and was moved to the background; it only read a log and ended on its own.
3. The `pgrep -u arm -af $W` check run through my own ssh shell lists that shell (its command line contains the workspace path); the final check below excludes it.
4. `.probe-dbs.mjs` is copied into the checkout and removed within `setup.sh` (as in run 2); the porcelain count was 0 after.
5. Host `evidence/` (raw) is outside the checkout. The committed `*.log` files are `git add -f` copies; `integ.log`, `unit-*.log` are committed gzipped (`.log.gz`).
