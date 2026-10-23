# AFLDB-ISSUE-320 — Enforced native-library closure for guarded rehearsal/rebuild processes

**Status:** OPEN, registered 2026-10-23. Implemented in local commit `041bd5852f166be76c873fbc45d0c10208a3c3b2`. The launcher image binding was added in `15e435620571910d522f12b933f89de917daeca0`.
* **2026-10-23:** a complete isolated rehearsal ran under v3 enforcement at `15e43562` and PASSED (§7).
* Still open: v3 records for every other environment, and the owner's acknowledgement of §3.
**Severity:** High, as an ISSUE-316 successor gate. **Area:** V2 rehearsal/rebuild runtime trust boundary.
**Linked:** AFLDB-ISSUE-316 (gate G2 of successor package E).

## 1. Requirement (owner decision, 2026-10-23)
"Native-library trust: enforced closure is required before proceeding." Observation does not satisfy it.
The implementation must:
* enforce the agreed native dependency set, not merely list it or observe it at startup;
* bind the identity and content of every executable and library, including transitive loading and the relevant child processes;
* prove that valid loads succeed;
* prove that unbound, substituted or changed libraries refuse before protected application activity;
* keep every existing package, import and target safeguard;
* not widen allowed roots and not trust ambient loader search paths.

## 2. Mechanism (`041bd585`)
* **Auditor.** `tools/v2/native-audit/afldb-native-audit.c` is a glibc rtld-audit module, loaded with `LD_AUDIT` into every guarded process before any program code runs.
* **Policy.** `afldb-native-closure-policy 1` is a sorted list of `auditor <sha> <path>` and `object <sha> <path>` lines. The launcher writes it from a verified runtime record; it is pinned by `AFLDB_NATIVE_POLICY_SHA256`.
* **What the auditor enforces** (refusals exit 127 at load, or fail exec with EACCES; there is no override):
  * `la_version`: the policy equals its pin; the module is the bound auditor; LD_PRELOAD and LD_LIBRARY_PATH are absent.
  * `la_objsearch`: any existing unbound candidate refuses. Ambient search paths are never trusted.
  * `la_objopen`: the main executable, the loader and every DT_NEEDED or `dlopen`ed object must be bound, hash-equal, and mapped from the hashed inode.
  * `la_preinit`: every executable mapping in `/proc/self/maps` is bound.
  * Exec family, `posix_spawn`, `system` and `popen` (through `la_symbind64`):
    * the target must be bound before exec, which covers static children such as esbuild;
    * the child environment is forced to carry the auditor and its pinned policy.
* **Verifier.** Runtime record schema v3 (`tools/v2/rehearsal-package.mjs`) adds `native_closure`.
  * Its objects are sorted, unique, canonical, pinned and non-setuid.
  * The loader and auditor are members, as are every bound executable and every ELF file in a runtime root.
  * The runtime-root digests agree.
  * It refuses before any spawn.
* **The verifying launcher itself** (added 2026-10-23 after the proposal review; `assertLauncherNativeImage`). It starts every guarded child, so the auditor cannot already be in it. Before any spawn it refuses any `LD_*` variable in its own environment and, on Linux, any file-backed executable mapping in its own `/proc/self/maps` that is not a bound closure object mapped from the verified inode. Version 1/2 records are unchanged.
* **Guards.**
  * The Node guard (`rehearsal-resolution-guard.mjs` `assertNativeEnforcement`) and the Python guard self-check LD_AUDIT, the pin, the auditor bytes and the `/proc/self/maps` inode.
  * They refuse when not enforced.
* **Derivation per environment.**
  * `tools/v2/native-audit/derive-closure.py` takes the transitive DT_NEEDED closure (`ld.so --list`). Its seeds are:
    * the bound executables;
    * the runtime-root ELF files;
    * `/bin/sh`;
    * the PG16 server lib directory (llvmjit included);
    * the NSS modules;
    * the auditor.
  * It writes a new v3 record.
  * `build-auditor.sh` builds reproducibly: the enforcing build is `32d5f6feee08d1e89ffd63ac507e0605e050dbfca3ad4d70ce185eb49490956a`.

## 3. Threat model and boundary
**In scope:** drift, substitution or addition of native code in the guarded process tree.

**Out of scope:** anything able to:
* rewrite a bound file concurrently between verification and mapping;
* ptrace a guarded process;
* run as root;
* map code through direct syscalls or later `PROT_EXEC` mappings made by already-bound code after startup.

The vDSO and JIT code are not files.

**Other boundaries:**
* Static children (esbuild) cannot carry the auditor. They are bound before exec only.
* Each guarded process start costs about 1 s: `node -e 0` takes 43 ms unenforced and 1,046 ms enforced. Hashing the 125 MB node binary takes about 0.6 s, and AF_ALG is no faster.

## 4. Proof (DEV `streamanator`; new disposable roots; no application or database connection)
* **Mechanism experiment (attempt 4), 33/33 PASS.** Root `/home/arm/afldb-i316-NATIVE-CLOSURE-EXPERIMENT-4-20261022T2226Z`.
  * Positives P0–P10; negatives N1–N18 with controls.
  * Closure: 250 objects, 385 MB.
  * Attempt 3's N16c false refusal (`os.system`) was a real defect: `__environ` was read from libc, but executables COPY-relocate it. It was fixed before commit by looking the symbol up in the main executable first.
* **Real-launcher integration, 10/10 PASS.** Root `/home/arm/afldb-i316-NATIVE-INTEGRATION-PROBE-2-20261023T0955Z`, package `2dc6b6931cb5becec5d8fa5ba4ea6cd5cf41800c9c09a351eea9fcade43d6575`, v3 record `10ee9ea1…5538`.
  * I1: auditor mapped; psql child 0; unbound `/usr/bin/id` → EACCES.
  * I2: tsx/esbuild census CLI ran ("CENSUS NOT TAKEN", exit 2, as designed with no target).
  * I3: guarded Python with psycopg/sqlite3 exits 0.
  * I4/I5: the Node and Python guards refuse without the auditor.
  * I6: unbound dlopen → 127.
  * I7: LD_PRELOAD → 127.
  * I8: tampered pin → 127.
  * I9: a closure without libsqlite3 → 127.
  * I10: a closure without python → refused before spawn.
  * launchRehearsal returned 0, with terminal re-verification.
  * Run 1 failed only on the harness's expected-path pattern; it is kept.
* **PostgreSQL fixture, PASS.** Root `/home/arm/afldb-i316-NATIVE-PG-FIXTURE-2-20261023T1005Z`.
  * An empty initdb cluster under the auditor, on a unix socket only.
  * initdb, pg_ctl (the `/bin/sh` chain), the postmaster and backends all ran; `pg_jit_available()` true; auditor mapped in the postmaster.
  * `LOAD` of an unbound .so → the backend refused (127); the postmaster reinitialised and still answered.
  * Clean stop.
* **Repository tests.** Focused v3 tests in `tests/db-test-rebuild.test.ts`; that file passed 986 / skipped 2 on Windows. `tsc --noEmit --incremental false` is clean.
* **Evidence.** `C:/tmp/afldb-c2-SUCCESSOR-READINESS-E-20261023/native/` (`EXECUTION_RECORD.md` at the parent).

## 5. Not yet proven (why this issue stays OPEN)
1. ~~**A complete isolated rehearsal under v3 enforcement.**~~
   * DONE 2026-10-23 at `15e43562`; see §7. It ran under the bounded proposal `C:/tmp/afldb-c2-SUCCESSOR-PROPOSAL-E-20261023T1045Z/REHEARSAL_V3_PROPOSAL.md`, owner-authorised.
2. **Records for other environments (per-machine gaps).**
   * The only derived, reviewed v3 record is for DEV `streamanator` with the clean-install runtime `/home/arm/afldb-c2-CLEANINSTALL-20261022T195338Z/`. That record is `b4a24773…c539`: 250 objects, policy `0c24b431…7fa6`.
   * The binding is per host. It names absolute paths and the bytes of the system libraries.
   * Every other machine that would run a guarded protected step has no record. That includes the applying runtime and whichever host runs the post-rollover rebuild.
   * Each such machine needs its own derivation, review and enforced proof.
   * On DEV, any OS package update to a closure object changes the bytes. The record then refuses until it is re-derived. e9 found 0 of 250 objects changed after this run.
   * The mechanism is a glibc rtld-audit module, and the launcher's maps check is Linux-only (§2). A Windows run therefore carries no native enforcement. It is not enforced evidence.
3. **Owner acknowledgement of the §3 boundary.** Owner acknowledgement is needed for:
   * the post-startup `PROT_EXEC`/syscall limit;
   * the static-child pre-exec-only binding: esbuild, 22 processes in §7;
   * the verifying launcher, which is unenforced by design and self-checked (§2).

## 6. Next action
* The owner names the environments that will run guarded protected steps.
* Derive, review and prove a v3 record for each of them.
* The owner acknowledges §3.
* No rollover, adoption or production write follows from §7.

## 7. Complete isolated rehearsal under v3 enforcement at `15e43562` (2026-10-23) — PASS
Evidence is in `C:/tmp/afldb-c2-REHEARSAL-V3-15e43562-20261023T0017Z/`, with `EXECUTION_RECORD.md` and `HASHES.sha256`.
* The tar `collected/v3-rehearsal-evidence.tar` has sha256 `2707020576e255bb272aff6eae7a7893cf1e56f859d8767bbacbd90639f9987c`.
* The DEV root `/home/arm/afldb-c2-rehearsal-v3-15e43562-20261023T0026Z` is retained, cluster data included.
* No subagents. Isolated only.

**Basis.**
* HEAD is `15e43562`, parent `b084273e`. `tsc` exit 0. vitest: 3 files, 1,360 passed / 2 skipped (Windows, local).
* New package: 1,146 files, inventory `e07bcfe1…6472`, bindings `aab9c386…803d`. All 1,146 were hash-verified before and after the run.

**Runtime.**
* The clean-install v2 record was re-measured equal to `6c4ea3ea…1add3`, before and after the run.
* The auditor was built from the packaged source byte-equal to `32d5f6fe…956a`.
* The v3 record was derived with the packaged `derive-closure.py`: `b4a24773…c539`, 250 objects, 385,089,521 B.
* Launch spec: `6727d97e…04a4`.

**Target.**
* A new mode-700 root.
* A cluster started through the guard, so the postmaster carries the auditor: system id `7699653836114564799`, 127.0.0.1:55773.
* A new database, `afldb_v2_rb_c2cand5_test`.

**Pre-launch controls** (`local/e3-negative.log`, `nc-auditor-removed.log`). Nothing was written under the writable roots.
* Refused at the launcher, exit 2:
  * nc1: an unbound `.so` in a runtime root (runtime membership);
  * nc1b: a runtime ELF file outside the closure;
  * nc2: loader/auditor unbound;
  * nc4: a loader override.
* nc3, the v3 record with one object removed:
  * It was refused at the **verifier** (exit 2, "verifying process maps native code outside the closure").
  * The harness had expected 127 and printed `AT LEAST ONE UNEXPECTED RESULT`.
  * The proposal §4 accepts a refusal at either the auditor or the verifier, so this is a recorded difference, not a pass by the harness.
  * A separate auditor-level control with the same kind of removal (libstdc++) refused with 127: "unbound loader search candidate".
* Auditor level: a tampered pin, changed policy bytes, LD_PRELOAD and LD_LIBRARY_PATH each refused with 127.
* Smokes:
  * The first psql smoke used `bash`, and the auditor refused it (`unbound executable: /usr/bin/bash`; this is the only REFUSED line under `logs/`).
  * The `/bin/sh` replacement `post-inner.sh` (late-staged, hashes recorded) had 0 refusals.
  * The psycopg smoke and the JIT smoke (5 JIT functions) passed.

**Run.**
* The verified production launcher ran from 2026-10-23T00:34:56Z to 01:17:50Z. `runner.exit` 0.
* The original deadline, 02:34:54Z, was untouched. No tripwire fired. Peak root sample was 2.11 GB; minimum free was 30.7 GB.
* All 30 stages completed:
  * census 1897–2026 `verdict=pass total=0` (`schema_absent`, fresh database: mechanism only);
  * strict real D7, all 1,640;
  * `AFLDB-FINAL-VALIDATION PASSED: 91 checks`;
  * `AFLDB-POST PASSED` (2026 pending on all three keys, 0 exposed, historical 98 / 79,113 / 112).

**Enforced coverage** (the claim):
* The run's logs carry 0 `AFLDB native closure REFUSED` lines.
* The server and collector logs carry 0 ERROR/FATAL/PANIC lines.
* After the run, all 250 closure objects were re-hashed equal to the record.

**Observed (not the claim).**
* The read-only sampler (1 s interval, 2,951 samples) saw 140 protected processes with 0 anomalies. The auditor was mapped from the bound inode in each of these:
  * node 25/25;
  * python3.12 30/30;
  * postgres 37/37, client backends included;
  * psql 7/7;
  * dash 4/4;
  * initdb 1/1;
  * pg_ctl 1/1.
* esbuild 22/22 carried the env auditor and pin. Those processes are bound pre-exec only.
* SAMPLED `/proc/<pid>/maps` (5 bound-inode maps each): the postmaster, the logger, two guarded node children and one Python stage.
* The verifying launcher node had 0 maps, by design.

**Shutdown** (through the guard).
* `iso-v3 stop` exit 0. `postmaster.pid` absent; `shut down`; ports 55770–55779 free; old postmaster gone.
* The watchdog and sampler finished (`WATCHDOG_DONE`, `ENFORCEMENT_DONE`). Nothing references the root.
* The system postgres was untouched.
