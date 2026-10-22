# AFLDB-ISSUE-320 — Enforced native-library closure for guarded rehearsal/rebuild processes

**Status:** OPEN, registered 2026-10-23. Implemented in local commit `041bd5852f166be76c873fbc45d0c10208a3c3b2` and proven on DEV, but not yet proven end to end.
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
1. **A complete isolated rehearsal under v3 enforcement.** All 30 stages under the auditor have never run. The bounded proposal is `C:/tmp/afldb-c2-SUCCESSOR-PROPOSAL-E-20261023T1045Z/REHEARSAL_V3_PROPOSAL.md`. It is NOT run and needs owner authorisation.
2. **Records for other environments.** Only DEV records were derived. Every other environment that runs a guarded protected step needs its own derived, reviewed v3 record. The binding is per host because absolute paths and system libraries differ.
3. **Owner acknowledgement of the §3 boundary.** Owner acknowledgement is needed for the post-startup `PROT_EXEC`/syscall limit and for the static-child pre-exec-only binding.

## 6. Next action
Owner authorisation of the §5.1 rehearsal proposal. Then derive a record for each environment that will run the post-rollover rebuild, and acknowledge §3.
