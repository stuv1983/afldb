# ISSUE-316 C2 isolated rehearsal — closure verification — 2026-10-22

**Verdict: complete isolated C2 rehearsal PASS at `5643f5c22025223916aa66cad6403a369a90c7cb`.**
Supported by retained evidence, subject to the limits in §4. The PASS is rehearsal-only. ISSUE-316
stays OPEN and production stays NO-GO. No rehearsal value (1,640, the DOB pins, Coleman 47, the
thirteen enrichment expectations, the 2026-inclusive census scope) becomes an active reference through
this closure. All three 2026 Brownlow keys stay pending, ET stays unresolved, and the AFL API
authority, eligibility and ownership restrictions are unchanged. The remaining owner decisions are in
the [successor decision package](issue316-c2-successor-decision-2026-10-21.md#current-state-and-remaining-decisions--2026-10-22) and its [consolidated proposal](issue316-c2-successor-decision-2026-10-21.md#consolidated-successor-proposal--2026-10-22).

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

- **L1.** *(Update 2026-10-22, §8.4: planted-match refusal now proven under the candidate scope.)* The census ran on a fresh database whose schema was absent (`schema_absent`, total 0). It is real in scope and stage order, but it cannot show ownership of a populated target. No production, DEV or other live target census exists.
- **L2.** *(Update 2026-10-22, §8.4: row-level pending-Brownlow projection proof now exists, and it found and fixed a career-total leak.)* The 2026 public projection has zero exposed rows partly because there are no 2026 `brownlow_season_votes` or round-vote rows at all (counts 0). The substantive evidence is `accepted=false`, `status=pending`, the three pending availability keys and no publication record; the row count alone is vacuous.
- **L3.** The 91 final checks, the DOB pins (13347 / 0 / 13347 / 0 / 2), the Coleman 47 and the thirteen enrichment expectations are rehearsal-only and conditional on the frozen inputs. The DOB derivation reuses the importer's own offline scan and fold rules. Coleman's 47 rows matched the independent derivation in count; the (season, key) pairs were not re-compared in this run.
- **L4.** The ladder expectation 1,640 holds only for the packaged core/witness pair and the rehearsal `seasons.json` overlay (`in_progress_seasons: []`, 2026 complete). The committed `data/reference/seasons.json` still lists 2026 as in progress.
- **L5.** The DEV dependency install carries a lock (`85809f26…`, producer-reported) that differs from the repository lock (`984b4422…`) in the record. Only `tsx`, `postgres`, `server-only` and `esbuild` are used, bound by measured file content.
- **L6.** The guard enforces module imports. Native-library files (libc, libssl, libpq inside `psycopg_binary.libs`, locale and `ld.so.cache` files and so on) were observed by the producer under `strace` (sha and package owner recorded in DEV logs that are not in the retained evidence directory), and they are OS and native-loader trust, not enforced closure. Nothing in attempt 2 upgrades an observation to enforcement.
- **L7.** *(Update 2026-10-22, §8.4: populated synthetic round trip now proven on isolated DEV targets.)* The reinstate stage restored zero rows (no ledger table before migration 104; zero adjudications, importer identities, registrations). The capture/reinstate machinery was proven with real PostgreSQL on empty data; a populated ledger has not been round-tripped.
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

Twelve evidence documents were retained locally as uncommitted files when this closure was first written. They were reviewed in the 2026-10-22 evidence-retention session (§8) and are committed with it. The first hash column is the SHA-256 prefix of the unmodified LF content recorded when this closure was written; the second is the full SHA-256 of the committed file, which differs only by the dated "Retention review" note inserted under each title (historical text is unmodified).

| File | Original SHA-256 (first 16) | Committed SHA-256 (after note) |
|---|---|---|
| `docs/v2/issue316-c2-field-review-2026-10-21.md` | `325d8d3e794a5dad` | `2f29a80a199e4f1e2f8c1e41837d23be56920f299eefaf47b54777c7a23d8d7b` |
| `docs/v2/issue316-c2-linkage-review-2026-10-21.md` | `e0aba8ecc47c48af` | `3c664d3a905177d4bc0d03a2a35790cdb3a4bf93a654c099ca194de0f2151a77` |
| `docs/v2/issue316-c2-quarter-review-2026-10-21.md` | `67fe0606cbdba0b2` | `3e907753ca7e9f026cc21cd1d2fca24cb66d9fd661a0adfd9a64ff063a4719d2` |
| `docs/v2/issue316-c2-height-applicability-2026-10-21.md` | `905d1d2596cb38b0` | `905709af93d60e595ad35a5524053a5fe48f82c9a86da89eeaf837279b92c2fb` |
| `docs/v2/issue316-c2-height-source-reconciliation-2026-10-21.md` | `a3f01308975476b4` | `c939829e0ac0fd985008825081c2d423ecea7374b872824b3d49707bad766840` |
| `docs/v2/issue316-c2-height-exception-evidence-2026-10-21.md` | `283465423f9743af` | `0a00585e9b6aedc9ad6f0ad2484128e269bfe11c416982c5b27ff3d0db98f112` |
| `docs/v2/issue316-c2-height-goal-verification-2026-10-21.md` | `3e6d835b2a5dc95f` | `15f639731057a8bf43f5bc1631001cf04a033825370451cbf7db0da69d2d157a` |
| `docs/v2/issue316-c2-supplement-free-proposal-2026-10-21.md` | `0f01480a9f51a565` | `2b1c98b1afa0e67e3694398219ce1e3a4eb1c723bcf211b46c5ff87e37d71d95` |
| `docs/v2/issue316-c2-sequential-measurement-prerequisites-2026-10-22.md` | `998f9f62e824412d` | `fcf964e2637286571d59e0c0db9697df89c1fc443c6fdd2e3ef8b9125d3efd82` |
| `docs/v2/issue316-c2-sequential-measurement-review-2026-10-22.md` | `7ecf4635df5b819e` | `bf0ebb178706c0cdc9b9de711e89b8737b3c4ef04bf3b441d246607f1358c944` |
| `docs/v2/issue316-c2-rehearsal-configuration-review-2026-10-22.md` | `2e183a651bdcd70a` | `5aa733cc7a10bd3dc4fc763c41c6498ac3407abd9c241bee7f0ae97fc30b114a` |
| `docs/v2/issue316-c2-ladder-season-scope-proposal-2026-10-22.md` | `68f9663517614422` | `aa396c18fa2fa1912356aa31c52b42daeeae17838a6971daa8615eb92dc70c9c` |

Links to these files from the committed tracking files resolve once they are committed (decision package row N16: commit authorised, no cleanup). `.codex/` is untouched and uncommitted.

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

## 8. Retention review and dependency-lock findings (2026-10-22)

Scope: one agent, no subagents; native inspection, hashing and offline validation only. No install, lockfile edit, runtime-policy change, rehearsal rerun, host/database/network access or cleanup.

### 8.1 Evidence retention

- **Hashes.** All twelve documents' SHA-256 prefixes equal the §7 originals (LF, no CR bytes). Of 194 distinct 64-hex strings cited in them, 190 equal retained files; the other four are composite digests that were recomputed or located (artefact-set digest `817d594e…` recomputed from the manifest; `15ba5dc6…` in the tracked register, contract and runner; `b55f5789…` and `d265e9e9…` in tracked `issues.md`/`IssuesIndex.md`).
- **Links.** Every link from the committed closure, decision package and `IssuesIndex.md` to an untracked file targets one of the twelve; committing them resolves all of them.
- **Independent re-measurement from the rehearsal package CSVs** (the figures the documents rely on): 132 core files hash-match the manifest (729,288 rows; artefact-set `817d594e…`); 130 witness files hash-match (1,640 rows, 20 labels, 0 exact points-and-percentage ties, min 4 rows in 1916, max 18 rows in 2012–2026); 2026 stats 10,028 rows / 218 groups of 46, all 21 ordinary keys populated on every row; `Substitute` empty on all 10,028; the six ET columns empty (60,168 cells); quarter cells 240,672 with 0 failures of points = 6×goals + behinds, 0 non-monotone, 0 Q4 ≠ final; results 17,056 rows (218 in 2026); details 16,731 rows, `Goals` unquoted-empty 4,437, `date_accessed` 2026-10-21 on every row; identity scan 695,501 rows, 171 without ID (83 in 2025, 88 in 2026), 0 missing or malformed URL, 13,362 IDs, 13,367 URLs; blank `Player` on exactly 150 rows, all on the four renumbered profiles (52 / 31 / 42 / 25). The rehearsal `rebuild.log` shows the same importer snapshot summary, the continuity application at 52 / 31 / 42 / 25 and the accepted-baseline VERIFIED line (132 artefacts, 729,288 rows).
- **Corrections to current claims** (history preserved; each affected document carries a dated note):
  - **C7.** The 150-row display-name-fallback figure rested on arithmetic and the overlay; it is now measured directly from the package (blank `Player` = 150 rows on the four profiles). The rebuild log has no explicit fallback line, so this is a package measurement, not a log fact.
  - **C8.** The packaged rehearsal `fitzroy-contract.json` and `fitzroy-accepted-baselines.json` contain cp1252 mojibake (19 and 3 damaged strings, for example `â€”` for an em dash; none in semantic fields) and carry stale "Full runner configuration BLOCKED" text. They must not be copied into active files; the successor proposal derives from the active repository bytes.
  - **C9.** The 2026 ladder file (`ladder_2026.csv`, 18 rows) is an acquired, manifest-declared witness member. The overlay comment "Locally computed validation cross-check only" is accurate only for the D7 reconstruction; the witness itself is not locally computed and its independent authority is not established.
  - **C10.** The status headlines of five documents (field review, supplement-free proposal, sequential prerequisites, configuration review, ladder-scope proposal) describe states since superseded; each now says so in a note while keeping its text.

### 8.2 Dependency-lock discrepancy — what local evidence supports

**Bottom line: the discrepancy cannot be classified from retained evidence; the reproducibility gap is real but narrow. The rehearsal PASS stays qualified and its acceptance status is not upgraded.**

> *Later the same day (§8.3): the DEV lock was retained and compared, the discrepancy is classified (one repository-only devDependency), and the Linux esbuild package is tied to lock integrity through the npm cache. The statements below are kept as the record of what the earlier evidence supported; §8.3 supersedes them where it says so.*

- **The DEV lock is not retained.** Only an 8-hex prefix (`85809f26`, producer-reported, install at `/home/arm/projects/afldb`) is recorded. Its contents and full hash are in no retained evidence directory or repository path searched. Whether it differs in versions, integrity, platform metadata, resolution or only representation is therefore **unproven**; no compatibility is inferred from matching top-level versions.
- **What `runtime_record.lockfile_sha256` attests.** The recorded repository lock `984b4422…` (lockfileVersion 3, 553 packages) is byte-identical to `package-lock.json` in the packaged source. The package verifier only checks that the packaged lock hashes to that value (`tools/v2/rehearsal-package.mjs:340`): self-consistency of the package, never an attestation of the DEV install.
- **What the run actually loaded (measured, enforced by hash).** The Node closure in the runtime record is `tsx` (60 files), `postgres` (37), `server-only` (3), plus nested `tsx/node_modules/esbuild` and `@esbuild/linux-x64`. The repository lock names tsx 4.23.12 (depending only on esbuild), postgres 3.4.9, server-only 0.0.1, esbuild 0.28.2 and @esbuild/linux-x64 0.28.2. The guard refuses any resolved or loaded non-builtin file URL not in the policy with exact sha256 and nlink, so the **JavaScript module bytes that ran are exactly the recorded bytes**.
- **Comparison against the local Windows install** (whose hidden-lock integrity equals the repository lock for tsx, postgres, server-only and tsx/esbuild): `postgres` 37/37 and `server-only` 3/3 files are byte-equal to the run's recorded hashes; `tsx` 56/56 non-platform files are byte-equal. The four platform-specific files are not comparable: `esbuild/bin/esbuild` differs (Windows binary) and the three `@esbuild/linux-x64` files are absent locally. So the **Linux esbuild native binary (`e1698a3d…`) is not tied to the repository lock's integrity by any retained evidence**; no npm cache tarball exists locally.
- **Python is unpinned.** The venv at `/home/arm/projects/afldb/.venv` had pip 26.2.1, psycopg 3.3.4, psycopg_binary 3.3.4 and typing_extensions 4.16.0. The repository has no Python requirements, pyproject or lock, so the Python environment (which runs the importer and loaders) has no repository-side pin.
- **Other recorded runtime components:** node v22.23.2 (`3517c2df…`), python3.12 (`e50d468e…`), `ss` (`31124eb6…`). Native libraries stay observed only (L6).
- **Not claimed:** that the DEV lock equals the repository lock; that the Linux esbuild package matches lock integrity; that a clean install from the repository lock would reproduce the run; that the Python environment is reproducible.

Evidence classes stay distinct: the **empty-ledger lifecycle** (L7) and the **row-vacuous zero-public-row Brownlow evidence** (L2) are proofs about empty or vacuous state, not populated-state proof, and nothing in this section strengthens them.

**Exact reproducibility work required before the PASS could support more than a rehearsal-only result** (none done here; each is a separate authorisation):
1. Retain or re-obtain the DEV `package-lock.json` (full SHA-256 and bytes) and `npm ls --all` with integrity fields from the install the run used, then diff it semantically against the repository lock (versions, integrity, resolved URL, os/cpu metadata, representation).
2. Verify the installed `@esbuild/linux-x64` and `esbuild` packages against the lock's integrity values (or the registry tarball) rather than only recording file hashes.
3. Pin the Python dependencies (requirements with hashes or equivalent) and add a repository-side record of the interpreter and the psycopg binary wheel.
4. Decide whether native-library observation is sufficient or must become enforced closure (L6), and prove capture/reinstate on populated ledger data (L7), before any populated or production-adjacent run.

### 8.3 Read-only DEV runtime inspection — what it closed and what it did not (2026-10-22, later the same day)

Scope: one agent, no subagents; read-only SSH to `arm@10.0.40.100` (host `streamanator`, Linux 6.8.0-147-generic, identity verified before anything else, first observation 2026-10-22T09:46:23Z). No install, download, update, rebuild, `npm ls`, database or credential access and no write on DEV. Evidence stays on C: in `C:/tmp/afldb-c2-RUNTIME-REPRODUCIBILITY-EVIDENCE-20261022/` (`REPORT.md` sha256 `d815db8b…8af1`; `SHA256SUMS.txt` lists all retained files). **Evidence classes:** CURRENT = observed during this inspection; RUN = what the rehearsal enforced through `runtime-record.json` (`91c5cdb6…`). Content equality is never described as archive-integrity proof, and today's lock is not used to prove an unretained earlier one.

**Closed (the §8.2 findings below are superseded where noted; their history stays above):**
- **DEV lock retained in full.** `package-lock.json` `85809f26828e5b8b26fe80b97e9ddf63fcaf68410cc05d3b69bdcbc11891d537` (292,696 B, mtime 2026-09-04, before the 2026-10-15 install and the run); the installed-tree lock `node_modules/.package-lock.json` `ab8976f7…6276`; DEV `package.json` `9dc1da3d…af6b6`. The producer's 8-hex `85809f26` equals the current DEV lock: **consistent with, not proof of, the run-time bytes**.
- **The discrepancy is now classified.** Repository lock `984b4422…` against the DEV lock: exactly one entry differs, `node_modules/@electric-sql/pglite@0.2.17` (a repository-only devDependency); 0 of 552 shared entries differ in version, resolved URL, integrity, os, cpu, optional, dev, dependencies, engines, bin or license. The runtime closure (tsx 4.23.12, esbuild 0.28.2, @esbuild/linux-x64 0.28.2, postgres 3.4.9, server-only 0.0.1) is identical in both. The DEV lock against its installed-tree lock: 0 changed; 125 entries not installed (120 foreign-platform, 5 wasm fallbacks).
- **Linux esbuild is now tied to lock integrity.** The npm cache holds tarballs for tsx, esbuild, @esbuild/linux-x64, postgres and server-only; each was re-hashed here and its sha512 equals the lock integrity (archive integrity established for those five). Installed files are content-equal to the tarball members except `esbuild/bin/esbuild`, which npm replaces with a hard link to the platform binary (inode 3320951, nlink 2, sha256 `e1698a3d…4100`, equal to the runtime record and to the platform tarball's member).
- **Run record against current DEV:** 2,445 of 2,445 recorded files equal across six roots (stdlib 1,213; site-packages 1,099; tsx 60; postgres 37; server-only 3; pg_bin 33); node, python3.12 and `ss` hashes equal.
- **Python:** 3.12.3, pip 26.2.1, psycopg 3.3.4, psycopg-binary 3.3.4 (cp312 manylinux), typing_extensions 4.16.0; installed `RECORD` verifies with 0 mismatches. Cached wheels exist for all four and their members are content-equal to the installed files (except `RECORD`).
- **Native libraries:** 17 vendored files in site-packages are in the record and inventory-verified but not load-time enforced; system libraries map to dpkg packages (`dpkg -V` clean); the 45 strace-observed objects come from the earlier runtime proof, not the rehearsal. Observation only (L6).

**Still not established (each missing artifact named):**
1. **Python archive integrity.** No repository-side requirements or lock with hashes exists and no PyPI digest was retrieved (network is out of scope). The cached wheels hash to the values in the evidence report, but equality with the installed files is content equality, not integrity proof.
2. **Run-time lock bytes.** Nothing retained records the lock as it was during the run beyond the 8-hex prefix.
3. **Native-library closure enforcement.** An owner decision (enforce or only observe).
4. **A clean `npm ci` from the repository lock** was not run (installing is out of scope), so reproduction from the lock alone is not demonstrated.
5. **Populated-ledger capture/reinstate (L7)** and row-level Brownlow evidence (L2) are unchanged by anything here.

### 8.4 Populated-state proof on isolated DEV targets (2026-10-22, later still)

Synthetic data only; fresh mode-700 roots, dedicated unprivileged PostgreSQL 16 clusters on loopback, unique `_test` databases; pinned to local commits `93b21a18` (attempt 1) and `9b854f9c` (attempt 2); both clusters stopped and verified shut down; all roots retained. Results, hashes and the failed attempt are in package C (`EXECUTION_RECORD.md` §3).

- **L7 (populated ledger):** the real capture, reset, migrations, privileges, reference-data, registration-replay, reinstate and bijection stages round-trip 4 ledger rows, 1 importer row and 3 manual registrations under different `players.id`, exact by stable identity; six classes of wrong, forged, changed or mismatched capture/marker state refuse and lose nothing (17/17).
- **L1 (ownership):** the enforcing census block refuses a planted `afl_api` 2026 match under the candidate scope and the predecessor scope does not; a planted 2025 match is refused under both; an afltables-owned 2026 match is never counted.
- **L2 (row-level Brownlow):** with unaccepted source votes planted, no real projection exposes an authoritative total, winner, rank or publication. Attempt 1 was RED: `recomputeBrownlowCareerTotals` summed raw votes. Repaired in `81117391`; attempt 2 passed. This closes the synthetic case only; it says nothing about real 2026 data, which stays pending.
- **Unchanged:** L3–L6 and L8 (including the 479 unmapped provider ids and the ten coach-page differences, not re-measured).

## 9. Re-run at `dedba57f` and Brownlow regression closure (2026-10-23)

A second complete rehearsal from the same frozen inputs, pinned to `dedba57f3650c156ad012ebdec48d6d62f5a7070` in a new root, cluster, port and database, passed through the production launcher (exit 0, 30 stages, strict real D7, 91 checks, post-rebuild checks, clean shutdown). It does not remove L1 (the census again ran on a new database with the schema absent) or L2 (zero exposed rows at row level is still proven by the synthetic planted-vote test, now re-run on a clone of this rehearsal); the §4 limits L1–L4 otherwise stand. The 40 empty-database Brownlow failures are classified in the runbook; the eligibility fixtures were repaired (`dedba57f`) and the populated planted-vote test added (`96e0922a`). Evidence: `C:/tmp/afldb-c2-FINAL-TECHNICAL-VALIDATION-20261023-20261022T122727Z/`.
