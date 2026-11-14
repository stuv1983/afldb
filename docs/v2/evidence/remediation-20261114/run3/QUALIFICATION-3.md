# Remediation run 3 — final qualification (supersedes `../run2/QUALIFICATION-2.md` for the candidate)

**Executable revision Q′ = `692b1902cbcc321cea76a30857a03e15f02db6b7`** (branch `claude/remediation-20261114`). Every commit after
Q′ touches records only (`docs/`, `issues.md`, `IssuesIndex.md`, `blockers.md`, `CHANGELOG.md`); `APPROVAL-PACKET-3.md` §A proves it.
Since run 2's Q (`f10e47ad`) the only executable change is five integration test files (+264 / −23):
`tests/integration/{settle-afl-api-state-b,settle-afl-api,settle-afl-api-brownlow,settle-afl-api-issue276,database}.test.ts`, plus the
run-3 qualification scripts under `run3/qualification-3/`. **No application code, tool, migration, deploy file, package file or reference dataset changed.**

Detailed records (each with raw verdicts and `SHA256SUMS` verified against committed blobs):
`qualification-3/README.md` (integrated run), `stateb/README.md` (T363-1), `rebuild/README.md` (isolated rebuild),
`integ/README.md` and `integb/README.md` (the 53 ids under intended conditions). Plan: `RUN-PLAN-3.md`; plan review `PLAN-REVIEW-3.md`.

## 1. Integrated qualification at Q′ (fresh host workspace, HEAD = Q′, porcelain 0 before and after every phase)

Host `streamanator`, `/mnt/ssd/afldb-rem3-qual-20261114` (new), isolated PostgreSQL 16 on 55674; base copies from the 4 Nov snapshot
(`afldb_prod-20261104T021037Z.dump`, 30,141,895 bytes, sha256 `e77c307d…826d`, verified; ledger 118; 17,056 matches); `npm ci` at Q′;
Node 22.23.2, vitest 4.1.10.

| Check | Run 3 at Q′ | Run 2 at Q |
|---|---|---|
| typecheck | **rc 0** | rc 0 |
| `lint:gate` | **PASSED as a ratchet, not clean lint: 338 errors in 43 files** (= baseline) | same |
| unit without fixtures | 7 failed / 12,282 passed / 31 skipped (environment: missing gitignored fixtures) | same |
| unit with fitzRoy + `sample.json` | 2 failed / 12,287 passed / 31 skipped | same |
| unit with every fixture (Stage A + residual input added) | **0 failed / 12,295 passed / 25 skipped** | same |
| `tests/restore-test.test.sh` / `tests/sync-dev-remote.test.sh` | **24/0**, **42/0** | same |
| integration, 99 files, per-file disposable databases (`MODE=all`), snapshot base | **42 failed / 3,457 passed / 2 expected-fail / 123 skipped** (3,647); 1,855 s; **0 per-file databases left** | 46 / 3,448 |
| `next build --webpack` + `prepare-standalone` | **rc 0 / rc 0**, BUILD_ID `cnEy98lTDk5v5UlbJLNFH`; the existing Edge-runtime `process.cwd` warning | rc 0 |
| AFLW `%27` metadata, Caddy matrix | **not run, not required**: no build-affecting or Caddy file changed since Q (diff above) | correct |

Fixtures were copied read-only and hash-verified at source and copy: fitzRoy `full-history-20260902` 131/131 (`run2/fixtures/fh-expected.sha256`),
`sample.json` `d8d743fb…db28`, Stage A `annual-html-20260826` 42/42 against `docs/rebuild-manifests/draftguru/annual-html-20260826.json` (tree `ceea2d34…de2`),
residual input `df6c9a75…e841`.

**Integration failing ids against run 2's 52** (`qualification-3/integ-compare.txt`): **6 gone, 46 common, 0 new.** Gone: `database` ×4 (witnesses
re-pinned, `bb81cbc9`), `settle-afl-api-issue276` file-level (`532e234d`), `settle-afl-api-state-b` file-level (`18cbde7b`). Common: failure text identical on
45 of 46 (OD-5 differs only in the per-file database timestamp). **No regression.**

## 2. The accepted-baseline rebuild (isolated, not the shared `afldb_test`)

`isolated-pg run afldb_v2_rb_rem3_test -- node node_modules/tsx/dist/cli.mjs tools/db/rebuild-test.ts --target isolated --acknowledge-destroy afldb_v2_rb_rem3_test`
at R = `6d5388ea`, from a `.env`-free workspace, port 55672: **PASS, all 30 stages, FINAL VALIDATION 91 checks**, 571 s, one attempt.
Accepted baseline `c2-2026-final-core-v1` (selected by the tool from `data/reference/fitzroy-accepted-baselines.json`; `full-history-20260902` is retired),
ladder witness `c2-2026-final-ladder-v1` (1,640 rows), ledger 118, 17,056 matches, 695,499 player-match rows, DraftGuru **6,810 picks / 5,057 persons**
(no id in 6819–6853: production's 35 D-336-2 inserts are absent), Brownlow 1924–2025, Coleman 47 rows (1980–2026). All eight inputs verified against
their tracked manifests before and after copying (`rebuild/inputs.tsv`); nothing fabricated, re-acquired or substituted; no pin, contract or label changed.
`git diff 6d5388ea Q′ -- tools/db tools/migration tools/rebuild src/db/migrations data/reference` is empty, so R carries to Q′ (PLAN-REVIEW-3 F-008).
Dump for reuse: `/mnt/ssd/afldb-rem3-base/rebuilt/afldb_v2_rb_rem3-6d5388ea.dump`, sha256 `d8397aab…65c63`; bridge child sha256 `1200e702…b9d`.

## 3. The 53 integration ids under their intended conditions (`integb/README.md` §7)

Run at `8db4007d`, whose tests, src, tools, packages and deploy trees equal Q′ (`git diff 8db4007d Q′ -- tests src tools packages deploy` empty).

| Class | Count | Ids |
|---|---|---|
| 1 passes under intended conditions | **14** | admin-brownlow P2; data-editor 5; draft-linkage 2; release-gates "Brownlow authority", "birth dates leaves the remaining players"; settle-afl-api OD-5 (rebuild-named clone); v2-brownlow-eligibility-2025-rehearsal 3/3 and v2-brownlow-production-correction 8/8 (clones from their documented recipe and retained artefacts); v2-coleman-publication 28/28 (its documented schema-only base) |
| 2 actual defect, fixed with red/green | **2** | `database` war-years (`6edf4f99`); `settle-afl-api-issue276` (`532e234d`) |
| 3 stale assertion | **31** | 4 corrected (`database`, before/after 685,471→695,499, 114→120, 261→268, 219→223); **27 not corrected**: club-comparison 24, release-gates 3 |
| 4 deliberate refusal | 0 | |
| 5 limitation awaiting owner | **5** | awards-reload-links (Coleman contract 46 vs 47); gridley-corpus (N7); release-gates "2026 is provisional" ×3 |
| 6 not run in that scope | **1** | `settle-afl-api-state-b`, proved separately in `stateb` (below) |

**T363-1 (`stateb`):** red at `6d5388ea` alone in shared mode on a fresh snapshot copy: `a leftover fixture row exists; remove it deliberately, this file will not adopt it`,
after which its `afterAll` deleted the snapshot's real `(afl_api, CD_I297354)` row (19,319 → 19,318 identities). Green after: alone shared and per-file; both orders
with `settle-afl-api`; the 7-file settle family shared default, file-shuffled (seed 20261114), reversed and per-file (120 passed / 1 failed OD-5 by design / 4 skipped
each); its own leftover still refused; mutation proofs red. The snapshot row is unchanged in every run.

## 4. Evidence manifests

`run2/evidence/verify-manifests.sh` (unchanged) at `6575bc95`: COMMITTED-OK 763, **COMMITTED-MISMATCH 1**, HOST-OK 142, HOST-MISSING 94 (the same set
run 2 recorded), HOST-MISMATCH 0, UNRESOLVED 1,302. The one mismatch is a verifier false positive (basename match across run-3 scopes), proved by
hashing the real committed file (`RESIDUALS-3.md` §2.5). Every run-3 scope verified its own committed blobs against its `SHA256SUMS` (0 mismatches).
`.gitattributes` unchanged; the one CR-bearing log is committed gzipped (`qualification-3/build-next.log.gz`).

## 5. Gaps (not run or not proven)

- **Shared `afldb_test` not rebuilt** (forbidden); the rebuild is an isolated database. Integration in shared (default) mode was not run at Q′; per-file mode is
  the qualified mode. T363-2/T363-3 shared-mode effects are unchanged.
- **27 stale witnesses and 5 limitations** are classified, not passed (owner decisions, `APPROVAL-PACKET-3.md` §C).
- **ISSUE-365:** reproduced on isolated databases only; production's 2026 coverage rows not read.
- **Production pins** are carried from run 2 and **not re-read** (no production contact was authorised).
- **Never run on production:** systemd units, host-policy files, ssh/rrsync paths (unchanged from run 2).

## 6. DEV untouched

`DEV-STATE-BEFORE-3.txt` and `DEV-STATE-AFTER-3.txt`: `afldb`, `postgresql@16-main` and `caddy` have the same MainPID, InvocationID and NRestarts 0;
DEV listeners unchanged; DEV checkout `8b024098`; no run-3 listener on 55671–55677 and no run-3 process left.
