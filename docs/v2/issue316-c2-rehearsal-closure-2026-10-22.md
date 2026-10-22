# ISSUE-316 C2 isolated rehearsal — closure verification — 2026-10-22

**Verdict: complete isolated C2 rehearsal PASS at `5643f5c22025223916aa66cad6403a369a90c7cb`.**
Supported by retained evidence, subject to the limits in §4. The PASS is rehearsal-only. ISSUE-316
stays OPEN and production stays NO-GO. No rehearsal value (1,640, the DOB pins, Coleman 47, the
thirteen enrichment expectations, the 2026-inclusive census scope) becomes an active reference through
this closure. All three 2026 Brownlow keys stay pending, ET stays unresolved, and the AFL API
authority, eligibility and ownership restrictions are unchanged. The remaining owner decisions are in
the [successor decision package](issue316-c2-successor-decision-2026-10-21.md#current-state-and-remaining-decisions--2026-10-22).

## 1. Scope and method

One agent, no subagents. Inputs: the ISSUE-316 execution record, `C:\tmp\afldb-c2-rehearsal-attempt2-20261022\`
(attempt 2 evidence), `C:\tmp\afldb-c2-rehearsal-attempt1-20261022\` (attempt 1, read only), and the C: package
`C:\tmp\afldb-c2-REHEARSAL-ONLY-C-rehearsal-5643f5c2-20261022T074446Z`. Every hash below was recomputed from bytes
read here. Method: in-process Node hashing and parsing of the retained files, and read-only Git
(`rev-parse`, `ls-tree`, `diff --name-status`, `status`, `log`). The session also used the Bash tool for read-only
local listing and printing of retained files (`ls`, `find`, `cat`, `stat`, `sha256sum`, `grep`, `sed`). No host,
database, network, WSL, installation, test, build, census, package construction, rehearsal rerun or cleanup. No
implementation, contract, reference, accepted register, availability, network switch or source data changed.

Classes used in §2: **V** = recomputed or re-derived here from retained bytes; **R** = read from a retained producer
log or file here (the producer's output is the evidence; this session could not reproduce it without host or
database access); **P** = recorded only in the runbook's producer narrative, with no retained output to read.

## 2. Verification matrix

| # | Required fact | Result | Basis | Class |
|---|---|---|---|---|
| 1 | Implementation binding | HEAD is `5643f5c2…`, a commit that changes only `tests/db-test-rebuild.test.ts`, `tools/db/rebuild-test.ts` and `tools/migration/rebuild_afl_api_adjudications.ts` relative to `c6cdb37b`. The launch spec and the package bindings name this basis. No implementation file differs from HEAD in the working tree. | `git rev-parse`, `git diff --name-status`, `git status`, launch spec | V |
| 2 | Package binding | Inventory `SHA256SUMS.txt` = `60758e96…c858c3b` (equals the launch spec pin). 1,135 listed, 1,135 on disk, 0 unlisted, 0 missing, 0 hash mismatches. Bindings = `24e1ae0a…43fb71`. Against attempt 1's inventory exactly three paths differ (`REHEARSAL_BINDINGS.json`, `tools/db/rebuild-test.ts`, `tools/migration/rebuild_afl_api_adjudications.ts`); none added or removed. | Node hashing of all files | V |
| 3 | Tracked-blob provenance | 765 packaged files are git-origin and each equals the blob at `5643f5c2` (SHA-1 recomputed). Five more tracked paths are the reviewed rehearsal overlays (§3 C1); their packaged hashes equal the build summary and the inventory. 279 acquired c2 inputs and 85 recovered inputs are recorded by origin; the 2026 stats, details, results and `ladder_2026.csv` hashes equal the successor decision package bindings. | `git ls-tree`, `FILE_ORIGINS.json`, `BUILD_SUMMARY.json` | V |
| 4 | Runtime binding | `runtime-record.json` = `91c5cdb6…2577` in both retained copies and in the launch spec; schema 2; six roots with 2,445 file entries, 3 stdlib links, 1 `tsx` link; 9 absent landmarks; 3 executables with the recorded hashes; all equal `runtime-measure.json`. The record's `lockfile_sha256` is the packaged repository lock (`984b4422…`), not the DEV install's lock (see §4 L5). | parse and compare | V (record); R (DEV filesystem measurement) |
| 5 | Launch binding | Launch spec = `47c28cc5…a60de`. Its inventory pin, runtime pin and `launcher_sha256` (`dd487c2c…21ba9`) equal the recomputed values; the external launcher equals the packaged `tools/v2/rehearsal-package.mjs`. Its pair block (core `02bbcf93…`, artefact set `817d594e…`, witness `65c29907…`, 1897–2026, 1,640) equals the packaged contract's `rebuild_expectation` block and both manifests' recomputed hashes. Target `afldb_v2_rb_c2cand2_test`, 127.0.0.1:55463, cluster `afldb_v2_isolated`. | parse and compare | V |
| 6 | All 30 stages, required order, exit 0 | 30 `==>` banners, in the order of the 30 stage ids planned in `tools/db/rebuild-test.ts` (precheck, census, capture, recreate, migrations … fingerprints). Runner start 07:51:43Z, end 08:22:03Z, exit 0. 0 lines match error, failed, fatal, panic, refused, traceback or exception in `rebuild.log` or `rebuild.err`. | log parse; code read | V (order, absence); R (exit, times) |
| 7 | Census 1897–2026 | `scope first_season=1897 last_season=2026 excluded=` (2026 enforced), verdict pass, total 0. The line is `schema_absent`: the database was fresh, so the census proves the mechanism and the 2026-inclusive scope run in the real stage order, not that any production target is free of `afl_api`-owned matches. | `rebuild.err` | R |
| 8 | Capture, bound recheck, reset, reinstate, marker clearance | Capture (log line 152) printed file sha `1c2691a5…771f`; the archived `…reinstated.json` hashes to exactly that value and its `payloadSha256` field is the printed payload `384f495f…a2cb7` (0 ledger, 0 importer, 0 registration rows). The recreate recheck (line 159) logged `capture-bound rebuild marker (file sha256 1c2691a588eb…)`; reset follows (line 160). Reinstate (banner line 548) logged `marker : cleared inside this transaction` (line 553) and archived the same sha; the combined invariant (line 556) logged `no rebuild marker remains`; the `fingerprints` recheck (line 712) logged `marker present` (resting comment restored). Five `isolated server verified` lines in total. | log and archived file | V (hash), R (log) |
| 9 | Strict real D7 | Both WF fixtures are confirmed independently in the packaged core `results.csv` (hash `73769e3e…`): exactly two rows with Round `WF` in all 17,056 rows, both 2026 and `Round.Type` Regular — 2026-08-28 Footscray 96 v Collingwood 93 and 2026-08-29 Melbourne 55 v Carlton 74. The logged raw-versus-policy deltas for the four affected clubs reproduce arithmetically from those fixtures (Carlton 54→50, 2081→2007, 2033→1978; Western Bulldogs 58→54, 1997→1901, 2085→1992; Melbourne for 2356→2301, against 2173→2099; Collingwood for 2114→2021, against 2070→1974). The log shows PASS for the exact fixture set, the H&A-plus-WF reconstruction (18 clubs listed), both witness/`club_seasons` membership checks and `all 1640 comparable club-seasons agree on every compared field`; the witness validator also printed 1,640 rows, 130 files, 1897–2026, all historical identity resolutions. | `rebuild.log`, packaged `results.csv` | V (fixtures, arithmetic); R (checks) |
| 10 | 91 final checks, zero mismatches | `rebuild.err` holds 91 distinct `AFLDB-FINAL-VALIDATION name = actual (expected expected)` lines, every actual equal to its expected, then `PASSED: 91 checks`. The summary line is in `rebuild.err` (stderr), not `rebuild.log`, whose last lines are the `FINAL VALIDATION` banner and `Rebuild complete.`. | parse of 91 lines | V |
| 11 | Pending 2026 Brownlow, historical projections | `post-rebuild-checks.log` records `AFLDB-POST PASSED`: 17,056 matches, 695,499 player-match rows, 1,640 club-seasons, football 2026 `complete`; 2026 round, season and match votes 0; non-pending 2026 player-seasons 0; published authority 0; `player_season_stats` 2025 = 668 complete all with votes, 2026 = 669 pending none with votes; the three 2026 keys `pending`; projection `accepted=f status=pending`; exposed 2026 rows 0; accepted historical 98 seasons / 79,113 votes / 112 winners. The SQL is `BEGIN READ ONLY … ROLLBACK`, runs only against the resting marker and cluster, and its projection expressions equal `src/db/queries/brownlow-readiness.ts` (blob `7dbfc230…`, equal in HEAD and the working tree). | SQL read; helper blob; log | R (values); V (SQL, helper) |
| 12 | Shutdown, watchdog, limits | `shutdown-stop.log`: `server stopped`, exit 0, pidfile saved before stop. `watchdog.log`: start 07:51:41Z, deadline 09:51:41Z, done 08:27:23Z; no `WATCHDOG_TRIP` file. 107 samples: peak root size 2,067,798,307 bytes (1.93 GiB) against a 15 GiB tripwire; minimum free 54,719,270,912 bytes (50.96 GiB) against a 20 GiB floor; no sample at either limit. Pidfile absent, `pg_controldata` shut down, port free, no process referencing the root and the system PostgreSQL pid untouched are producer observations with no retained output. | local copies | V (limits); P (host state) |
| 13 | Preservation of attempt 1 | The local copy of attempt 1 is intact: capture `717ed125…da6` (database `afldb_v2_rb_c2cand_test`), launch spec `c99a0b30…27ae` (basis `c6cdb37b`), runtime record `91c5cdb6…2577`, `rebuild.err` ending `REFUSED: Live isolated-target recheck refused before recreate.` and the capture banner with `marker : set` as the last `rebuild.log` stage. Attempt 2 used a different database, port, root and capture root. DEV-side preservation (pidfile absent, shut down, not reused) is the producer's. | Node hashing | V (local); P (DEV) |
| 14 | 16-case lifecycle proof | `lifecycle-result.json` (`aa835d25…cc26`) holds 16 cases, all `ok: true`. `lifecycle-driver.mts` was read: it runs the real capture tool as a child, the real marker writer and facts query, the real `RESET_SQL` behind the identity guard, on database `afldb_v2_rb_lc_c2_test`. It proves: resting comment; ordinary check passes then rejects the pending marker with `database_marker`; a binding issued from the real stage result equals the marker's digests; the capture-bound check passes; a copied literal is refused; appending one byte to the capture file is refused and restoring the bytes passes; the reset runs, the marker survives it, the bound check still passes and the capture file is untouched. | file and driver source | R |
| 15 | Local test and typecheck results | 978 passed / 0 failed / 2 skipped (Windows-only: dangling symlink, `/usr/bin/python3.12` landmark); `tsc` exit 0; lint equal to the HEAD basis; Linux 958 / 0 / 0 skipped at `c6cdb37b`. Not rerun (tests are outside this task's authority) and no output is retained in the evidence directory. | runbook | P |

## 3. Corrections to the record

- **C1 — package composition.** The runbook said the 1,135 files are "770 tracked blobs at `5643f5c2` (git blob SHA-1 verified) + 279 + 85 + bindings". Corrected: 770 tracked paths are 765 files byte-equal to the `5643f5c2` blob and 5 reviewed rehearsal overlays that deliberately differ from it (`tools/rebuild/fitzroy/fitzroy-contract.json`, `tools/rebuild/afl_api/afl-api-contract.json`, `tools/rebuild/afltables/afltables-contract.json`, `data/reference/fitzroy-accepted-baselines.json`, `data/reference/seasons.json`).
- **C2 — stage number.** The attempt 1 paragraph says the resting comment is "restored only at Stage 18". In the executed order the `afl-api-adjudications-reinstate` stage is the 22nd of 30 (log line 548). Stage 18 is `manual-registrations-reinstate`, which logs `marker : kept`.
- **C3 — location of the 91-check line.** `AFLDB-FINAL-VALIDATION PASSED: 91 checks` is in `rebuild.err`, not `rebuild.log`.
- **C4 — resource figures.** The peak sampled root size is 2,067,798,307 bytes (2.07 GB decimal, 1.93 GiB). "54.77 GB free at the end" was the last sample; the minimum sampled free space was 54.72 GB.
- **C5 — CHANGELOG.** The runtime-record v2 entry still said no Linux execution existed and that four assertions were unrepaired. Both were superseded by `136e24d0` and `c6cdb37b`. The entry is corrected in the same commit.
- **C6 — "genuine census" and "zero exposed rows" are narrower than they read.** See L1 and L2.

No other discrepancy was found between the runbook's attempt 2 statements and the retained bytes. No material implementation defect was exposed, so no dependent closure was stopped.

## 4. Limits that the PASS does not remove

- **L1.** The census ran on a fresh database whose schema was absent (`schema_absent`, total 0). It is real in scope and stage order, but it cannot show ownership of a populated target. No production, DEV or other live target census exists.
- **L2.** The 2026 public projection has zero exposed rows partly because there are no 2026 `brownlow_season_votes` or round-vote rows at all (counts 0). The substantive evidence is `accepted=false`, `status=pending`, the three pending availability keys and no publication record; the row count alone is vacuous.
- **L3.** The 91 final checks, the DOB pins (13347 / 0 / 13347 / 0 / 2), the Coleman 47 and the thirteen enrichment expectations are rehearsal-only and conditional on the frozen inputs. The DOB derivation reuses the importer's own offline scan and fold rules. Coleman's 47 rows matched the independent derivation in count; the (season, key) pairs were not re-compared in this run.
- **L4.** The ladder expectation 1,640 holds only for the packaged core/witness pair and the rehearsal `seasons.json` overlay (`in_progress_seasons: []`, 2026 complete). The committed `data/reference/seasons.json` still lists 2026 as in progress.
- **L5.** The DEV dependency install carries a lock (`85809f26…`, producer-reported) that differs from the repository lock (`984b4422…`) in the record. Only `tsx`, `postgres`, `server-only` and `esbuild` are used, bound by measured file content.
- **L6.** The guard enforces module imports. Native-library files (libc, libssl, libpq inside `psycopg_binary.libs`, locale and `ld.so.cache` files and so on) were observed by the producer under `strace` (sha and package owner recorded in DEV logs that are not in the retained evidence directory), and they are OS and native-loader trust, not enforced closure. Nothing in attempt 2 upgrades an observation to enforcement.
- **L7.** The reinstate stage restored zero rows (no ledger table before migration 104; zero adjudications, importer identities, registrations). The capture/reinstate machinery was proven with real PostgreSQL on empty data; a populated ledger has not been round-tripped.
- **L8.** Coach raw HTML was absent from the consumed tree (parsed artefacts only). The ten coach-page total differences, the 737 AFL API and 24 Wikipedia height disagreements, the 479 unmapped AFL API providers, the 18 height rejections (including Collingwood Caps 162/182/615/649) and the jumper disagreements were reproduced by counts only and remain unadjudicated.
- **L9.** The `--recover-afl-api-adjudications` relaunch under rehearsal provenance still cannot proceed after a refused run, by design.

## 5. Failures, denials and skipped tests preserved

- **Attempt 1 REFUSED** at stage 3→4 (`Live isolated-target recheck refused before recreate`): the capture replaces the resting comment with the rebuild marker, so the unchanged recheck could never pass. Nothing was destroyed; its pending marker and files are retained; attempt 2 used a fresh root, cluster, port and database.
- **Approval-review denials** (runbook, not independently observable here): the marker-only repair was blocked as a relaxation of an isolation check and the owner then authorised the stricter capture-bound variant; a "disable the check" mutation experiment was denied and not applied (each negative test instead asserts its own refusal phrase); one package-build call was denied once and the same reviewed operation was then run as separate described calls; one read-only command that wrote to `/tmp` was denied and replaced.
- **Environment events:** `C:/tmp` mkdir EPERM during input recovery; an earlier Git Bash `ssh` was denied before any command ran; the lifecycle's first database `afldb_v2_lc_c2_test` was created and unused (the runner allowlist is `afldb_v2_rb_*_test`); a stray local `ssh.exe` client was stopped.
- **Skipped tests:** 2 Windows-only skips in the local run; 0 skips on Linux.

## 6. What the milestone is and is not

It is: one disposable, isolated, fully logged run of every rebuild stage at an exact commit, from a verified package, runtime record and launch specification, ending in the strict ladder witness comparison, the 91-check gate and the pending-Brownlow checks, with the capture/marker lifecycle exercised for real.
It is not: Brownlow publication, adoption of any successor contract, register or availability entry, a rollover date or status, a production ownership census, a freeze or recovery proof, or a deployment. Those are five separate approvals (see the decision package).

## 7. Retention and tracking

Retained unchanged: all DEV roots (attempt 1, lifecycle, attempt 2, runtime-proof roots, clones), all C: packages and evidence directories. No cleanup was performed or approved.

Evidence documents retained locally and **not** included in the closure commit (their content was not re-verified here beyond the sections cited by the decision table; SHA-256 prefixes are of the unmodified LF content):

| File | SHA-256 (first 16) |
|---|---|
| `docs/v2/issue316-c2-field-review-2026-10-21.md` | `325d8d3e794a5dad` |
| `docs/v2/issue316-c2-linkage-review-2026-10-21.md` | `e0aba8ecc47c48af` |
| `docs/v2/issue316-c2-quarter-review-2026-10-21.md` | `67fe0606cbdba0b2` |
| `docs/v2/issue316-c2-height-applicability-2026-10-21.md` | `905d1d2596cb38b0` |
| `docs/v2/issue316-c2-height-source-reconciliation-2026-10-21.md` | `a3f01308975476b4` |
| `docs/v2/issue316-c2-height-exception-evidence-2026-10-21.md` | `283465423f9743af` |
| `docs/v2/issue316-c2-height-goal-verification-2026-10-21.md` | `3e6d835b2a5dc95f` |
| `docs/v2/issue316-c2-supplement-free-proposal-2026-10-21.md` | `0f01480a9f51a565` |
| `docs/v2/issue316-c2-sequential-measurement-prerequisites-2026-10-22.md` | `998f9f62e824412d` |
| `docs/v2/issue316-c2-sequential-measurement-review-2026-10-22.md` | `7ecf4635df5b819e` |
| `docs/v2/issue316-c2-rehearsal-configuration-review-2026-10-22.md` | `2e183a651bdcd70a` |
| `docs/v2/issue316-c2-ladder-season-scope-proposal-2026-10-22.md` | `68f9663517614422` |

Links to these files from the committed tracking files resolve only in this working tree until they are committed; committing them is a separate documentation decision (decision package row N16). `.codex/` is untouched and uncommitted.

### Recomputed hashes of other consumed evidence

| Item | SHA-256 | Bytes |
|---|---|---|
| `host/external/launch-spec.json` | `47c28cc5c9d1a79b461d0624ec6d37a9ffcee71188bb5d583473c0be2a6a60de` | 2662 |
| `host/external/runtime-record.json` (and `host/runtime-record.json`) | `91c5cdb6fa14ee92a3d904e8418a7c546b7db3f971768b5f94867d77213c2577` | 305766 |
| `host/external/rehearsal-package.mjs` | `dd487c2c9cfa7d4e935b44037e334af12d6a5f32dec7cb4c5f5650fc3ea21ba9` | 37160 |
| package `SHA256SUMS.txt` | `60758e9609dabc03f154b55e25e96d1e8ebd1c8f90e09fcb14c20b901c858c3b` | 143380 |
| package `REHEARSAL_BINDINGS.json` | `24e1ae0ac611a504dc01e167fb5a0eae5015c76d5d0720235ce5e8f35d43fb71` | 903 |
| `host/logs/rebuild.log` | `b541b5ef257c14867872029fb08b517457159ff195ecbab61d55d840260e9c9e` | 44313 |
| `host/logs/rebuild.err` | `5f60dff7c43128d718ca19139c87a38ae9f133e2c9c836a7c901d1ec334b8e83` | 10441 |
| `host/logs/post-rebuild-checks.log` | `52cc7a4fca57c1cfb83d9635865cfad0d67335cd737fc3fdc59788d7ea3896b9` | 2698 |
| `post-rebuild-checks.sql` | `9f714da62f9e6ee767c23c335e390d4ccfc6efac13b1fc027aaac1601f682d16` | 7942 |
| `…20261022T080222083Z.384f495f923f.reinstated.json` | `1c2691a588eb55d5c607e05a9cabc46a3270c5b6bc7c0d5bddc197dff821771f` | 344 |
| `lifecycle/lifecycle-result.json` | `aa835d258744e874b0aebc6b8f1ae1bfe32524cedcfd48713e5f81a4f15ccc26` | 1893 |
| `lifecycle/lifecycle-driver.mts` | `1050edd5a2ac1ff0c9d56297f934fc3ffbc1a6496c1430161c0a9079dcfe54f9` | 5530 |
| `host/logs/watchdog-samples.log` | `3a5c7929f724bebb47330b0a6e3f7361a48998c29b92fdb00efe1a2ee7acc6dd` | 5733 |
| `host/logs/shutdown-stop.log` | `c209fbd5107ea59d7900d7c6e7471e9e7c90ed4cb92945b1a1c4e828ae1cafcf` | 113 |
| `host/runtime-measure.json` | `bfd68c0bf6d8dde06190108a6cf789f0d205e46d29a1515d7f683298866c3dd5` | 1620 |
| attempt 1 capture file | `717ed1251c7b11bfc9a2d221b51853855ccc91fad0a58f9f5a5fa04e3ede6da6` | 343 |
| attempt 1 launch spec | `c99a0b30c70ddbc2c0701d4a090bc5fdea619b46d2c904d79d757e5d540227ae` | 2660 |
| packaged `afltables-contract.json` | `59ffeb8431fc104549f1af9b19b353f641d46cb209b2029d8949ccc0435720cf` | 17569 |
| packaged `seasons.json` | `67f5e504ce90c561cfe461d8b10e991f6e8c06d3c89c2fa73a8d7bc3466667cd` | 1024 |
| packaged ladder witness manifest | `65c299072afb35f1b0ddce50c9c72728e03bcd1580d676ca63eaaafb86047c34` | 54293 |
| packaged core manifest | `02bbcf932ef71d411c5d5077ae85000ebdbc0896323cf3f57c0e9fa417cf9988` | 236674 |
| packaged core `results.csv` | `73769e3ef608103c6c4e7ac6f58ce82484f85bd8058955ec502a9d64cb834f52` | 1646918 |
