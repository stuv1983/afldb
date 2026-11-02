# D-316-12 UI release candidate: Linux qualification record (2026-11-02)

**Qualified revision R = `a0b1080f5b98aee7191894c138be27bb524c7b1b`** (local `main`, not pushed). Only actual results are recorded. Production was not used. No provider request, push, deployment, restart or timer change happened.

## 1. Environment (disposable, nothing outside it created or deleted)

| Item | Value |
|---|---|
| Host | `streamanator` (the authorised DEV/Linux host; one bounded SSH retry via Windows OpenSSH succeeded), Linux 6.8.0-147, 24 cores, 31 GB, node v22.23.2, PostgreSQL 16.15 |
| Disk | `/` was 98% full (5.1 GB free), so the **workspace was `/dev/shm`** (RAM-backed, `/dev/shm/afldb-c316-ui-qual`) and `TMPDIR` for the release-route suite was on it; nothing on `/` was written |
| Source | `git archive` of R streamed to the host; **4146/4146 blobs verified against `git ls-tree`**, 0 bad, 0 missing, 0 extra, 0 mode mismatches (archive sha256 prefix `2d99e20019343410`) |
| Dependencies | a private copy of the host checkout's `node_modules`; `package-lock.json` sha256 prefix `984b44221f8f7256` (equal to the workstation's). **Lock check: 426 ok, 125 optional-absent, 1 bad**: `@electric-sql/pglite@0.2.17` is absent from the host's older `node_modules`. It is a devDependency imported only by unrelated test suites and `packages/testing`; the script allowed that single named mismatch and would have stopped on any other. **Nothing was installed from any registry;** later in the run the matching package was copied from the workstation's lock-installed copy into the private workspace only (see the typecheck row). |
| Database | an isolated cluster on 127.0.0.1:55482 (guarded launcher, loopback only, listener proven to be this cluster), a schema-only database `afldb_v2_c316ui_schema_test` migrated to ledger 118 with privileges |
| Not touched | DEV services and ports 5432, 3000, 3100, the host's own checkout, any retained baseline, the quarantined rehearsal distro |

## 2. Results on R

| Check | Result |
|---|---|
| Focused suites: `admin-current-season-settle`, `v2-admin-operations-ui`, `v2-module-boundaries`, `afl-api-ingestion-safety`, `afl-api-c7-observation` | **420/420 passed** (5 files) |
| C7 observer reader against real PostgreSQL (rolled-back transaction) | **3/3 passed** (counts, round filter, `read only` transaction refuses a write) |
| `tests/deploy-release.test.ts` (release route; `TMPDIR` on tmpfs because admission measures the temp root and `/` has 5.1 GB) | **33/33 passed** |
| `next typegen` | exit 0 |
| `tsc --noEmit` | **First run: exit 2 with exactly one error**, `packages/testing/src/pglite.ts(41,35) TS2307 Cannot find module '@electric-sql/pglite'` (the disclosed missing devDependency; the log of that run was overwritten by the rerun and only this description remains). **After the matching devDependency was placed in the private workspace** (the workstation's lock-installed `@electric-sql/pglite` 0.2.17, tarred and copied; lock check then **427 ok, 125 optional-absent, 0 bad**): `next typegen` exit 0 and **`tsc --noEmit` exit 0** (16.4 s, peak RSS 1.22 GB). This is the exact-candidate Linux typecheck evidence for the off-host switch. |
| Production-mode build (`AFLDB_ENV=production AFLDB_BUILD_TYPECHECK=off-host AFLDB_BUILD_WORKERS=1`, 3072 MB heap cap, via the isolated runner) | **exit 0**, 1 min 34.6 s, peak RSS 1.50 GB (1,576,056 KB), minimum MemAvailable 24,117 MB, `.next` 494 MB, `BUILD_ID` `8cOw9f9cWlZ7VOWRAVxGz`; standalone bundle ready, no `.env*` in it |
| Boot smoke of the built bundle (loopback 127.0.0.1:3198, one worker, the disposable DB) | `/api/health` 200 `{"status":"ok","database":"ok"}`; `_buildManifest.js` 200; `/` 200; `/beta` 307 to `/`; `/admin/current-season` **307 to `/admin/login`** (the page requires a session); 0 error lines in the server log. The listener released the port after the supervisor was stopped. |
| C5 process guard: table test | **17/17 PASS** |
| C5 process guard: **real-process test** on a real procps table | **PASS**: operator transport excluded with no writer present (0); one genuine process naming a writer detected (1) and it is the probe; back to 0 after the probe was killed |

Earlier run on the previous commit `9560b84e` (before the integration test created its own clubs): the same focused (420/420), release-route (33/33) and typecheck results, and the integration test failed 2 of 3 because a schema-only database holds no clubs (a test-fixture defect, fixed in `a0b1080f`). It is shown so the history is complete; the table above is the final run on R.

## 3. What this does and does not qualify

- **Qualified on Linux:** the changed UI tests, the module boundaries, the release route (`deploy/release.mjs`) test suite, the production-mode build of R with the off-host typecheck switch, a built-bundle boot, the C7 observer's SQL, and the real-process guard test.
- **Not run (and therefore not claimed):** the full unit suite, the other integration suites, NL UI, the authenticated live page. The Python-dependent suites and the `pglite` suites were not run (they are unrelated to R's changes).
- **Visual: `VISUAL: UNVERIFIED` for the live page.** The boot smoke shows `/admin/current-season` redirects to login; the authenticated render needs the owner's session. The static render of the real panel and subtitle ([capture](evidence/d31612-wording-20261102/capture/)) is not the live page.
- The workspace on `/dev/shm` holds R's source and build until removed (RAM-backed; it vanishes on reboot). Evidence copied into [evidence/d31612-linux-qualification-20261102/](evidence/d31612-linux-qualification-20261102/); the script is `scripts/run-qual.sh` in the same folder.
- Operational note: a SIGTERM to the smoke supervisor's child caused a one-second worker restart before the listener closed; the port was confirmed free afterwards and only processes with a working directory inside the workspace were ever signalled.
