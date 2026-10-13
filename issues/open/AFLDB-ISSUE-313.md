# AFLDB-ISSUE-313 — Database tooling passes the owner DSN, password included, on the `psql` command line

## 0. Status

- **Status:** Open (2026-10-08). **Implemented and committed locally 2026-10-13** (worktree `D:\dev\afldb-issue-313`, branch `sonnet/issue-313`, base `5ffbc563` = `main` = `origin/main`); DB-free validated on Windows; **real-psql pack run on `streamanator` 2026-10-13: RESULT PASS, exit 0 (§20.1); integration, push and closure records are outstanding; D-313-6 (§17.6) APPROVED 2026-10-13**; D-313-1 resolved (V6 plus DB-free capture accepted as the privileges credential-transport criterion; not end-to-end). Not merged, pushed or deployed. Detail: §17–§21.
- **Severity:** Low. **Area:** database tooling / credential handling.
- **Key files:** `tools/db/psql.ts` (`psqlArgv`, `runPsql`), `tools/db/privileges.ts`.
- **Origin:** full code review at `20a7a4bbdea835cdd3fc5520e65ad47d275bd881` (`issues/reviews/2026-10-08-full-code-review.md`, F-048; partition note R6a-F02).
- **Classification:** code-proven. The practical exposure depends on the host.

## 1. Summary

The full connection string is an argv element of the `psql` child for its whole run: `-d <dsn>` in `psqlArgv`, and `-d dsn` in `privileges.ts`. On Linux, argv is readable by every local user through `/proc/<pid>/cmdline` / `ps`, unless `/proc` is mounted with `hidepid`. The privileges run holds the owner DSN. The module promises "Nothing here ever prints a DSN or a password", but `redact()` is applied only to psql's output.

## 2. Evidence

- `tools/db/psql.ts:16-17` (the promise), `:43-45` (`psqlArgv`) and `:78-81` (spawn).
- `tools/db/privileges.ts:92-98`.
- The project rule: no inline secret on a command line (agent operating protocol; `issues.md:40952`, "A DSN is never accepted on argv").

## 3. Trigger

`npm run db:privileges*` or `npm run db:test:rebuild` on any host where another local user can list processes.

## 4. Expected invariant

The secret reaches `psql` through the child environment (`PGPASSWORD`, or a password-stripped DSN), a service file or `.pgpass`, never through argv.

## 5. Actual behaviour

The credential is visible for the duration of each psql run.

## 6. First wrong layer

`tools/db/psql.ts:44`; `tools/db/privileges.ts:92`.

## 7. Impact

Credential exposure to co-tenant local users. Low on a single-operator droplet; real on a shared host or CI runner.

## 8. Reproduction / witness

Not executed (no credentials were used in this review).

## 9. Disproof attempts

psql does not rewrite its argv, and `.pgpass` is not referenced in `tools/db`. `privileges.sql:7` documents the same exposure for a hand-run psql, so the pattern is operationally accepted, which is why this is graded Low.

## 10. Existing-issue search

ISSUE-107/220 (web service `/proc/<pid>/environ`, resolved) and ISSUE-251 (its own CLI). Classification: **new**.

## 11. Scope

The two argv builders.

## 12. Out of scope

Hand-run psql commands documented in runbooks.

## 13. Proposed fix boundary

Pass a password-stripped DSN with `-d` and set `PGPASSWORD` in the child environment (never logged). Keep the ISSUE-093 §20 flag order.

## 14. Proposed validation

Extend the `psqlArgv` / `runPsql` DB-free tests:
- no argv element carries a password or `user:pass@` authority;
- `env.PGPASSWORD` is set;
- the flag order is unchanged.

## 15. Decisions / unresolved questions

None.

## 16. Next action

~~Implementation.~~ Superseded: implemented locally (§17), validated DB-free (§18), reviewed (§19). Real-psql pack run PASSED 2026-10-13 (§20.1; D-313-6 approved). Committed locally (one commit on base `5ffbc563`). Next: `merge:ready`, then the operator merges and pushes, then the closure records (§21).


## 17. Implementation (2026-10-13; committed locally, not merged, pushed or deployed)

Worktree `D:\dev\afldb-issue-313`, branch `sonnet/issue-313`, created from `5ffbc5634eca993f124d972fe78236fc11c7f31e`. `main` and a fresh `origin/main` were both at that commit; no earlier ISSUE-313 branch or worktree existed.

### 17.1 What the defect was, re-confirmed in the code

- `tools/db/psql.ts` `psqlArgv(dsn)` put the whole DSN in `-d`; `runPsql` passed that vector to the child with no environment of its own.
- `tools/db/privileges.ts` built `['-v','ON_ERROR_STOP=1','-f',PRIVILEGES_SQL,'-d',dsn]`.
- **A third site the review did not list:** `tools/db/promotion-convergence-rehearsal.ts` `execute()` had `-d, dsn` in its own `psql` spawn (the `code_test_db` owner DSN).
- Callers of `runPsql` (all fixed by the one change): `rebuild-test.ts` (reset and validation streams), `prove-reset.ts`, `afl-api-ownership-census.ts`, `records/first-kick-goal-rehearsal.ts`, `tests/integration/afl-api-ownership-census.test.ts`.

### 17.2 The change

- `psql.ts` — new `psqlConnection(dsn, parentEnv = process.env)` returning `{ dsn, env }`: a password-free `-d` value, and a **copy** of the parent environment plus `PGPASSWORD` when the DSN held a secret. `psqlArgv` is built from the password-free value (so no caller can build an unsafe vector), `runPsql` passes `env` to the spawn, `SpawnSyncLike` gains an optional `env`. New `PsqlCredentialRefused` (a subclass of `PsqlUnavailable`, so the reset proof already fails closed on it) and `EnvLike`. The flag order of ISSUE-093 §20 is unchanged and `-d` is still an option, never a positional operand.
- `privileges.ts` — `-d` takes `connection.dsn`, the spawn takes `env: connection.env`; a refused DSN returns exit 1 with the variable name and no DSN. `main` is exported with injectable `args`, `env` and `spawn`; the entry guard is reviewed in §17.8.
- `promotion-convergence-rehearsal.ts` — `execute()` uses `psqlConnection`; its `PGCLIENTENCODING` overlay is kept. `main` also checks the owner DSN before connecting.
- `rebuild-test.ts` — `assertPsqlCanCarry(dsn, name)`, called by `resolveTarget` (admin DSN) **and at the top of `executeRebuild`**, so any caller of the plan refuses before its first stage.
- `prove-reset.ts` and `afl-api-ownership-census.ts` — the same check straight after their database-name check, before any session or psql.

### 17.3 What is stripped, and what is refused

Rule: a password *source* is the userinfo text after `:` and every `password` query parameter (keyword percent-decoded, `&` separated). No source holds text → the string is returned **untouched** (so `u:@h`, `?password=` and `?password` pass through byte for byte). Exactly one source holds text and it is the only source → the text is percent-decoded into `PGPASSWORD` and that source is cut out; every other character, parameter and its order is preserved. Everything else is refused. Messages name the problem and never the DSN, any part of it, or the secret (asserted); the parent `process.env` is never modified; on Windows a differently-cased parent `PGPASSWORD` is removed from the child's copy.

### 17.4 Decisions taken

- **D-313-2.** `PGPASSWORD` in the child environment, as §13 proposed, not a temporary `.pgpass` file.
- **D-313-3.** Refuse rather than guess: libpq's handling of duplicate or empty password sources is not asserted anywhere in this code.
- **D-313-4.** The convergence rehearsal's identical defect is fixed in the same change although §11 named only two builders; a structural test fails if any `tools/**/*.ts` passes a raw `…dsn`/`…url` variable after `'-d'`.
- **D-313-5.** (revised 2026-10-13) `privileges.ts` guard: see §17.8.
- **D-313-1 (resolved by the operator, 2026-10-13).** V6 plus the DB-free capture is **accepted as the privileges credential-TRANSPORT criterion**, provided the actual caller wiring is reviewed (§17.8, done). This is **not** an end-to-end privileges acceptance, and `db:privileges:test` is not to be run for this issue.

### 17.5 Residual exposure and observations (not claimed fixed, no issue opened)

- `PGPASSWORD` lives in the child's environment: readable by the process owner and root (`/proc/<pid>/environ` mode 400), not by other local users. That is the accepted channel (§4).
- Hand-run `psql "$CANDIDATE_DSN"` commands in runbooks and the `[monitor]` hint lines echoed by `deploy/afldb-settle-afltables.sh` / `afldb-settle-afl-api.sh` still put a DSN on a command line; §12 put hand-run commands out of scope.
- `tools/maintenance/backup.sh` and `restore-test.sh` have their own `dsn_scrub` (bash regex). From a reading only: it does not percent-decode the password and does not handle `?password=`. Not examined further or tested.
- `tools/gridley/export_corpus.py` accepts an optional `--dsn` on argv (default: environment).
- No deploy script runs `db:privileges` (searched `deploy/`, `package.json`, `tools/`): it is operator-run, so no deployment is needed or implied by this change.

### 17.6 Compatibility audit (2026-10-13, against base `5ffbc563` and the actual callers)

**What the tools supported.** At the base, `psqlArgv`/`privileges.ts` handed psql whatever string it was given, so *psql's* grammar was the only limit. The *tools'* limit was tighter, because every variable involved is also read elsewhere as a URL:

- `.env.example` documents only `scheme://user:password@host:port/database` for every DSN (`AFLDB_OWNER_DATABASE_URL`, `AFLDB_TEST_DATABASE_URL`, `AFLDB_CODE_TEST_DATABASE_URL`, …).
- `resolveTarget`, `databaseOf` (rebuild, proof, rehearsals), `afl-api-ownership-census.ts` and `migrate.ts` all `new URL()` them; a key=value string throws ("not a valid connection URL").
- postgres.js (the application, migrations, importers) reads the same variables: `parseUrl` does `new URL()`; its password is `o.pass || o.password || url.password` where `url.password` is the **userinfo** password decoded with `decodeURIComponent` (so an invalid UTF-8 escape throws); a `?password=` query parameter is **not** read as a password, and `sslpassword` is not a recognised option at all (ignored).
- Git history (`git log -S sslpassword`) and the tree show no use of `sslpassword`, a key=value password DSN, or `passfile` outside this change and a keyword list in one integration test.

| Input | Base | Now | Class |
|---|---|---|---|
| `scheme://user:pw@host:port/db[?sslmode…]`, percent-encoded password | worked everywhere | **kept** (password moved to `PGPASSWORD`; identity checked against `new URL()` for the documented forms and a seven-form corpus) | supported, preserved |
| lone `?password=SECRET` (no userinfo password) | psql honoured it; postgres.js ignored it | **kept** (moved) | supported by psql only, preserved |
| no password anywhere, bare database name, key=value **without** a password keyword | passed through | **kept**, byte for byte; ambient `PGPASSWORD`/`PGPASSFILE` still apply | preserved |
| empty userinfo password `u:@h`, `?password=`, `?password` | passed through | **kept**, byte for byte (nothing to hide) | preserved |
| userinfo password **and** `?password=`; two `password=` parameters; a secret beside an empty source | psql resolved it by libpq's rules; postgres.js used the userinfo only, so the two tools could authenticate differently | **refused** | **genuine ambiguity** |
| key=value string with a `password`/`sslpassword` keyword | reachable only via `db:privileges*` (no URL validation there); every other consumer of the variable rejects it | **refused** | newly unsupported; never supported by the tools |
| `sslpassword=` in a URL | psql honoured it; postgres.js ignores it; no SSL client key exists in the repo | **refused** (no environment variable can carry it) | newly unsupported; never supported by the tools |
| invalid or non-UTF-8 percent-escape in the password | libpq accepts any byte; postgres.js throws | **refused** | newly unsupported; never usable by the other tools |
| `%00` in a password | an environment value cannot hold NUL | **refused** | unsupported |
| `password=a=b` (extra `=`) | whatever libpq does (not verified) | **refused** | malformed; behaviour unverified |

**Compatibility restriction — D-313-6 (APPROVED by the operator, 2026-10-13, as a documented tooling restriction).** These forms are *deliberately unsupported by this helper*; they are **not** claimed to be invalid libpq syntax (libpq accepts them; the tools never used them). Valid percent-encoded URI passwords stay supported: the userinfo form and a lone `?password=` parameter, including a percent-encoded `=` in the value, are covered by `tests/db-test-rebuild.test.ts` `SUPPORTED` case "percent-encoded password keyword and value" (`postgres://u@h/afldb_test?pass%77ord=a%26b%3Dc` → `PGPASSWORD=a&b=c`, line ~3462), which the operator accepted on 2026-10-13 as sufficient coverage for percent-encoded equals in query-password values in place of the literal `?password=a%3Db` example (no such case exists; none was added). `db:privileges*` and the other psql callers refuse a connection string whose password is carried as (a) a key=value `password`/`sslpassword` keyword, (b) an `sslpassword` parameter, (c) a percent-escape that is not valid UTF-8, or (d) two or more password sources. Workaround for every case: the documented URL form with the password in the userinfo, or `PGPASSWORD` / a `.pgpass` file supplied by the operator. If the operator wants (a) preserved, the smallest extension is a strict parser for unquoted `key=value` tokens only (duplicates and quoted or escaped values still refused); it is not implemented because nothing in the repository or its history uses the form.

### 17.7 Every affected caller refuses before its first stage (asserted by tests, not by reading)

| Caller | Where it refuses | Evidence |
|---|---|---|
| `db:test:rebuild` (CLI) | `resolveTarget` → `assertPsqlCanCarry(adminDsn)`, before the plan is built or any stage runs | `resolveTarget` refuses for **both** rebuild targets, naming that target's own variable |
| any caller of `executeRebuild` (CLI, first-kick-goal rehearsal, tests) | top of `executeRebuild`, before stage 1 | plan with an unusable admin DSN: 0 commands, 0 SQL runs, 0 validations |
| PRIVILEGES stage (after the destructive reset) | already refused up front: its variable is the target's `adminEnv`; the stage has no `envOverlay`; `privileges.ts` refuses again (exit 1, no spawn) | test reads each rebuild target's `package.json` privileges script, runs `main` with only `adminEnv` set, and checks the stripped `-d` |
| first-kick-goal rehearsal | `resolveTarget` precedes every `connect(…)` and `runPsql(…)` (order asserted) and `executeRebuild` re-checks | source-order test |
| `db:privileges*` direct | exit 1 before spawning psql | child-process run |
| reset proof (`prove-reset.ts`) | straight after the database-name check, before any session, probe or psql | child-process run: `REFUSED: AFLDB_TEST_DATABASE_URL cannot be used with psql`, banner never printed |
| ownership census | after the name check, before reading its evidence or launching psql | child-process run: exit 2, `CENSUS NOT TAKEN` |
| convergence rehearsal | in `main`, before `runRehearsal` creates the output directory or connects to `code_test_db` | child-process run; output directory never created |

The child-process runs aim at `127.0.0.1:1`, so even a missing guard could reach no database. Removing each guard in turn (the five mutations) fails the corresponding test.

### 17.8 `privileges.ts` execution guard, reviewed against the base

- **Base:** `process.exit(main())` unconditionally at module scope, with `loadEnv()` as the first line of `main`. Importing the module ran it; it could not be imported for testing.
- **First draft (rejected on review):** `if (!process.env.VITEST) { loadEnv(); process.exit(main()); }`. `VITEST` is set in every vitest worker and inherited by whatever the worker spawns, so a real `npm run db:privileges:*` started from under vitest, or from a shell that exported it, would have exited 0 having done nothing — a silent skip of the PRIVILEGES stage.
- **Now:** the module runs exactly as at the base unless `AFLDB_PRIVILEGES_NO_AUTORUN` is exactly `'1'` (a purpose-named variable nothing else sets). If it **is** set on a direct run of `tools/db/privileges.ts` the process refuses with exit 1 and a message instead of exiting 0. `loadEnv()` still runs before `main`, so the order is as at the base.
- **Tests (real child processes via `tsx`):** a direct run with an unknown target exits 1 with the unknown-target message (it ran); a direct run with the opt-out set exits 1 with `Refusing to skip the privileges work silently`; a direct run with an unusable DSN exits 1 naming the variable. The DB-free suite sets the opt-out for its dynamic import only and removes it straight after, so nothing it spawns inherits it.
- **The verification pack never imports `privileges.ts`, `rebuild-test.ts`, `prove-reset.ts`, the census or either rehearsal.** It imports `node:*`, its own judge and the transpiled `psql.ts`; the pack's self-test asserts the exact import list (8 specifiers, one dynamic import).

## 18. Validation (DB-free, Windows, 2026-10-13)

- `tests/db-test-rebuild.test.ts`: **589 passed** (528 before; **61 new**, selected by `-t "ISSUE-313"` or by the new `describe` blocks). Seven files that import the changed modules (`db-test-rebuild`, `db-promotion-check`, `sibling-reconciliation`, `season-rollover`, `first-kick-goal-source`, `after-siren-normalisation`, `workflow-preflight`): **1296 passed | 1 skipped** (pre-existing). Two existing assertions were amended without weakening: the `-d` operand test now expects the password-free DSN and keeps its no-positional-operand walk; the `privileges.ts` source guard pins `['-d','connection.dsn']`.
- New cases: 17 supported forms and 16 refusals (each also proves `psqlArgv` throws, `runPsql` never spawns, and the message holds no secret, host or database), a seven-form corpus plus **every DSN in `.env.example`** compared against `new URL()` (user, host, port, path, query unchanged; only the password removed), parent-environment immutability, Windows-case handling, the probe carrying the password, a launch-failure message, `privileges.ts` `main` through a fake spawn, the caller table of §17.7 including five real child-process runs, and the structural `-d` guard.
- **Mutation checks:** restoring the raw DSN in `psqlArgv` fails 28 cases; neutralising each of the five caller guards and the privileges loud-refusal fails the matching test (5 failures, then restored).
- `tsc --noEmit` exit 0; `git diff --check` clean; ESLint on the seven touched files reports 8 errors and 15 warnings, all on lines this change did not touch (`no-explicit-any`, unused `_` parameters, anonymous default exports including `prove-reset.ts:829`).
- **Not run:** integration tests (they need a database), any real `psql`, the rebuild, privileges, promotion or reset commands, `db:privileges:test`. No database or host was contacted.

## 19. Review (self-review of the complete diff; not an independent review)

Verdict: **no CRIT, HIGH or MED finding open.** Found and fixed during review: (1) the first draft rewrote an empty `password=` / `u:@h` on a recalled belief about libpq's empty-value handling — now "no text, no change"; (2) the `VITEST` entry guard could silently skip a direct run (§17.8); (3) a refusal in the convergence rehearsal or the reset proof could first appear after seeding or a session was opened — now at the top of each; (4) a typecheck failure (`ProcessEnv` requires `NODE_ENV`; inputs are `EnvLike`); (5) a refusal message containing a literal `scheme://` URL that `redact()` would have mangled. Open LOW items: the residual `PGPASSWORD` channel (§17.5); D-313-6, the compatibility restriction (§17.6); and — the substantive limit — nothing here has touched a real `psql` yet (§20).

## 20. Real-psql verification (READ-ONLY; executed once 2026-10-13, RESULT PASS — see §20.1)

The procedure, the harness and its observer are a **self-contained pack** built outside the repository; its `README.md` is the authoritative, complete procedure and depends on nothing in this runbook.

- **Location (workstation):** `D:\tmp\issue313\verify-313-pack\` (14 files) and `D:\tmp\issue313\verify-313-pack.tar.gz`. Untracked and outside the repository; rebuild with `build-pack.mjs` if any file under `tools/` or the test file changes (the harness refuses a pack that does not match its own manifest).
- **Archive SHA-256:** `d22d7d4e2536d315fb587a083669de06168845d54154dd85f6e22b5c7cf3d2a5`. **Pack id** (SHA-256 of `MANIFEST.sha256`): `fafde227b3264db04fd40a0086cd6055b5574dc93abb857b49c5107fd81b8fd1`.

| File | SHA-256 |
|---|---|
| `psql.ts` (= tracked `tools/db/psql.ts`, LF) | `4438a5f7c21ec68c7d71409968da7ff8af7bd88896ff66be7bafb293bfa595bf` |
| `psql.mjs` (TypeScript 5.9.3 `transpileModule`) | `653aedbe8e8cd1b0dd0bd5b3d9f4e084230dd5017cc4337d2f53a17c426b4596` |
| `verify-313.mjs` | `3a8ad8aa766c672d4f50d9ceec86a2f6f73d67e2155b7f4dfaf9b6954a73ee54` |
| `observe-psql.sh` | `bdd1ed50ab10150b04d2abb1eac51c4841e0461a69472e1ddd5cd1cd68f9e0b2` |
| `observer-eval.mjs` | `1b9df9b17547f28f881942c0955095eb3999784cc646c03b0e8faa339e64bead` |
| `run.sh` | `192967028a19520fc8c7eae12d7f5343dfb3676f32c8b08249270b7047ea9e50` |
| `README.md` | `d87c459eafc1e972d53033b7c4522fa94427733a9cec4702445a931d738f8d65` |
| `code-under-test.patch` (`git diff -- tools`) / `SOURCE_HASHES.txt` | `a16c608c6d79161a33078d04884ecbeabc75cfa5e96cd4fdd0cb03fd5cec4778` / `f505eb91b1455266acfb3b526a58b7c35da0769990ea876c7d77cbcdafa95abb` |

**What it pins and does.** Target `afldb_test`, role `afldb_owner`, and the exact `--host`/`--port` named, all checked **before** any connection, with a short query-parameter allow-list. Every statement is audited beforehand (must begin `BEGIN READ ONLY` or `SET TRANSACTION READ ONLY`, no write keyword) and every identity row must show `transaction_read_only = on`; `PGOPTIONS=-c default_transaction_read_only=on` sits beneath. The environment is scrubbed (no ambient `PGPASSWORD`, `PGPASSFILE`/`PGSERVICEFILE` pointed at non-existent files, empty `psqlrc`). Checks: **V1** the helper's probe; **V2** identity through `runPsql`; **V3** the same session from a `?password=` form; **V4** negative control — a wrong password must be refused, and acceptance makes the result **INCONCLUSIVE** (exit 3); **V5** (Linux) an independent observer samples `psql` in `/proc` while `runPsql` runs `pg_sleep(6)`: no password in argv, `environ` mode 400 holding `PGPASSWORD`; **V6** the `privileges.ts` invocation shape with an explicit `BEGIN READ ONLY … ROLLBACK` stand-in file. Credentials are obtained by a hidden `read -rs` prompt (or one `grep`'d line of the host's `.env`), never on a command line; nothing is printed that could hold the DSN or password; V5's observer withholds any argv containing one.

**Commands** (full text with explanations in the pack's `README.md`): transfer once; `sha256sum` the archive and compare; extract; `sha256sum -c MANIFEST.sha256`; compare the pack id; `read -rs` the DSN; `bash run.sh --host localhost --port 5432`; `unset AFLDB_TEST_DATABASE_URL`; return `~/issue313-evidence/verify-313-<UTC>.{header.txt,log,sha256}`. **Pass = every line `PASS`, `RESULT PASS`, exit 0.**

**Pre-flight evidence gathered here (no database).** The harness self-test (`node selftest/selftest.mjs`, 38 checks: good run; trust-authentication → INCONCLUSIVE; eight pin refusals; a tampered pack file; an every-awkward-character password; the observer's judgement on canned output; the exact import list) passes. The observer was run against a real Linux `/proc` (WSL Ubuntu, stand-in processes named `psql`): it flags a password in argv, withholds it from its own output, and recognises `PGPASSWORD` in an `environ` of mode 400 (19 checks). The archive was extracted on Linux, `sha256sum -c` reported 14 OK, no CR bytes, `bash -n` clean, and `run.sh` aborts cleanly when a tool is missing. **Not exercised:** the harness's own V5 orchestration (it needs Node on Linux, which WSL here does not have) and any real `psql`.

**What this does not prove.** `privileges.ts` end to end (accepted as such by the operator, D-313-1); percent-decoding of exotic passwords against a real role; visibility to root; Windows process visibility; PROD.

### 20.1 Execution record (2026-10-13; one attempt, no retry)

- **Authorisation:** the operator, 2026-10-13: one run, `streamanator`, `afldb_test` as `afldb_owner` only; no privileges/rebuild/reset/promotion entrypoint; one deliberate V4 failed login; no database writes. Coverage for percent-encoded `=` in query-password values accepted as the existing `pass%77ord=a%26b%3Dc` case (§17.6); no code, test or pack change was made to obtain it.
- **Pins checked before connecting:** archive SHA-256 `d22d7d4e…f3d2a5` and pack id `fafde227…8fd1` as given; all 14 manifest lines OK locally and again on the host after extraction; the seven code/test files matched `SOURCE_HASHES.txt` (LF-normalised and raw) and `code-under-test.patch` matched `git diff -- tools`; `HEAD` still `5ffbc563`. The harness imports only `psql.mjs` and `observer-eval.mjs` (`psql.mjs` has no imports) and audited 4 statement sets read-only before any connection. The same seven files were re-hashed after the run: unchanged.
- **Host / client:** `arm@10.0.40.100`, hostname `streamanator`, uid 1000, Linux 6.8.0-146-generic x86_64, Node v22.23.2, `psql (PostgreSQL) 16.15 (Ubuntu 16.15-0ubuntu0.24.04.1)`, bash 5.2.21, `/proc` mounted `rw,nosuid,nodev,noexec,relatime`; server_version 16.15, `inet_server_port()` 5432.
- **Isolation:** fresh `/home/arm/issue313-verify-20261013T032229Z` (mode 700, created with `mkdir` that fails if it exists); pack extracted there, evidence in its `evidence/` (mode 700). The live checkout `~/projects/afldb` was only *read* (its `.env`). The credential was read in-process by a separate 40-line launcher (`launch-313.mjs`, in the run directory, outside the pack manifest, sha256 `a7403940…bb954`): no shell sourcing, no printing, no DSN or password on any command line; it took the existing `afldb_owner` password from `AFLDB_TEST_DATABASE_URL` and built `afldb_test` on `localhost:5432`, passing it to `run.sh` through the child environment only.
- **Result:** V1, V2, V3 (strip + identical identity to V2), V4 (wrong password refused by the server, exit 2, authentication failure, no leak), V5 (observer saw `psql` in 4 samples; every argv `-d postgres://afldb_owner@localhost:5432/afldb_test`, no `user:password@`, no `password=`, no password text; `/proc/<pid>/environ` mode 400 owned by the running user with `PGPASSWORD` present and the password in no other variable) and V6 (`-f` file / `-d` password-free DSN shape) **all PASS**; every identity row `afldb_test` / `afldb_owner` / `transaction_read_only=on`. `RESULT PASS`, exit 0.
- **Evidence:** remote `/home/arm/issue313-verify-20261013T032229Z/evidence/`; local copy `D:\tmp\issue313\evidence-20261013T032229Z\` (retrieved by `scp`, intact on the host). Hashes (log finalised before hashing; verified on the host and locally): `verify-313-20261013T032321Z.header.txt` `d785023c88c6fb58702ab5bb631e9bed9da9c5af85abe032d0db25d2bb556465`; `verify-313-20261013T032321Z.log` `98ae74cec1b0389a7a3e8a8e3914e3e6e9a16bf32dc93eaaaa5c4a86a1aeabcc`. A credential-shape grep of both found nothing. No `psql` process or `/tmp/verify-313-*` scratch directory remained. The remote directory was left intact.
- **Effect on the server:** one deliberate failed login (`FATAL: password authentication failed for user "afldb_owner"`, application_name not set for the control) expected in the PostgreSQL log at about 03:23 UTC (the server log itself was not read); otherwise one read-only session each for V1, V2, V3, V5 and V6. No writes.
- **Limits (unchanged):** this proves the helper's transport and process visibility for an unprivileged local observer on one Linux host, not `privileges.ts` end to end (V6 is the invocation shape only; D-313-1), not visibility to `root`, not Windows, not PROD, and the V5 samples number 4 (periodic sampling of one `pg_sleep(6)` run; no claim of continuous observation). The credential launcher `launch-313.mjs` was **outside the pack manifest and self-test**: its correctness is evidenced only by the run it drove, not by a pinned hash in the pack. The `?password=a%3Db` literal case remains untested by design (operator-accepted substitute above).

## 21. Closure requirements (ISSUE-313 stays Open)

1. ~~**Operator review and commit**~~ **Committed locally 2026-10-13** (operator-authorised, one commit on base `5ffbc563`; the seven code/test files byte-identical to the pack's `SOURCE_HASHES.txt`; SHA recorded in `D:\tmp\issue313\commit-record.txt`). Scope: the seven code and test files changed by this work (`tools/db/psql.ts`, `privileges.ts`, `rebuild-test.ts`, `promotion-convergence-rehearsal.ts`, `prove-reset.ts`, `afl-api-ownership-census.ts`, `tests/db-test-rebuild.test.ts`) and the four tracking files (`issues.md`, `IssuesIndex.md`, `CHANGELOG.md`, this runbook). The pack's `code-under-test.patch` and `SOURCE_HASHES.txt` identify the code state it was built from; rebuild the pack if that state changes.
2. ~~**Real-psql verification** (§20) run on Linux with every check PASS; result and evidence recorded here.~~ **Done 2026-10-13: every V1–V6 check PASS, RESULT PASS, exit 0** (§20.1). Limits in §20.1 still apply; it is not end-to-end privileges acceptance (D-313-1).
3. ~~**D-313-6** (§17.6): the operator accepts, amends or rejects the compatibility restriction.~~ **Approved by the operator, 2026-10-13** (documented tooling restriction; coverage reference in §17.6).
4. `npm run merge:ready -- --issue 313`, then the operator merges and pushes. No deployment is required or implied (§17.5).
5. Close per CLAUDE.md §5: move this runbook to `issues/closed/`, set Resolved in `issues.md`, remove it from the Open Issues table and `IssuesIndex.md`, and update the `CHANGELOG.md` entry from "open" to "resolved".

Resolved: **D-313-1** (§17.4). Not affected and to be preserved: the 14 Oct combined ISSUE-274/276 nightly observation (this change touches only operator-run database tooling, not the settle or deployed runtime) and the ISSUE-265 PROD hold (no PROD action here). `db:privileges:test` has not been and is not to be run for this issue.
