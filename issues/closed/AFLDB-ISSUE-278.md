# AFLDB-ISSUE-278 — The destructive `db:test:rebuild` reset never asserts which database it is connected to

## 0. Status

- **Status: Resolved (2026-10-13; opened 2026-10-08)**, merge-scoped, on the push of the documentation-only closure commit; implementation commit `dd18adb93a0207eb2ed812ac56636a90e2c89239`, merged and pushed to `main` (§18). *History: until the integration the status here was "Open". Implemented locally 2026-10-13 on `sonnet/issue-278` (base `e7f84f14`) and committed locally (§17.9); DB-free validation passed (§17); the second pass added child-environment pinning and host/port requirements (§17.5). Procedure A PASSED 2026-10-13 and was accepted (§17.6). Procedure B: attempt 1 STOPPED at the baseline before the proof (§17.8); the Tier 2 SQL was corrected and attempt 2 PASSED 2026-10-13 (proof PASS; unchanged-observed-state MATCH), §17.9. Merge, push and the closure record followed (§18).*
- **Severity:** Medium. The reviewer graded it High; the main session regraded it Medium because the trigger needs a non-standard DSN form, although the consequence would be catastrophic.
- **Area:** database tooling / wrong-target safety.
- **Key files:** `tools/db/rebuild-test.ts` (`databaseOf`, `resolveTarget`, `RESET_SQL`, `runSql`), `tools/db/prove-reset.ts`.
- **Origin:** full code review at `20a7a4bbdea835cdd3fc5520e65ad47d275bd881` (`issues/reviews/2026-10-08-full-code-review.md`, F-013; partition note R6b-F01). The main session re-read `rebuild-test.ts:455-490`.
- **Classification:** the missing assertion is code-proven. The concrete trigger depends on libpq and was not executed.

## 1. Summary

The rebuild derives its target name from the DSN's URL path (`databaseOf`) and checks that name against an allowlist and the `--acknowledge-destroy` string. It then sends `RESET_SQL` through psql (libpq), and that SQL drops every schema object. Nowhere does it assert `current_database()` / `current_user` on the connection that destroys. The rollback-only proof stream does assert it (`prove-reset.ts:246-268`), yet the two are documented as sharing one execution path.

## 2. Evidence

- `tools/db/rebuild-test.ts`:
  - `:459-461`: `databaseOf` = `new URL(dsn).pathname`.
  - `:470-490`: the name allowlist ("A target is never inferred from a DSN").
  - `:522-533`, `:605-614`: name and acknowledgement equality.
  - `:2058-2120`: `RESET_SQL`. `:3305-3312`: `runSql`.
  - A whole-file grep for `current_database|session_user|current_user` finds nothing.
- `tools/db/prove-reset.ts:246-268` (in-stream assertion) and `:469-505`.
- `tools/db/psql.ts:43-45`: `-d <dsn>`, which libpq parses.
- The pre-reset capture child asserts identity only over postgres.js (`tools/migration/rebuild_afl_api_adjudications.ts:1144`).

## 3. Trigger (libpq-dependent)

`AFLDB_TEST_DATABASE_URL` whose URL path names the allowlisted target while libpq resolves a different database or server. Examples:

- `…/afldb_test?dbname=afldb_dev`: libpq lets a query-part keyword override the path. This is documented libpq behaviour, not executed here.
- `?host=` / `?hostaddr=`: no precedence question; the same name on another server.

## 4. Expected invariant

The destroying stream refuses unless `current_database()` equals the acknowledged target and `current_user` is `afldb_owner`, as the proof stream already checks.

## 5. Actual behaviour

The census and capture pass against the path-named database, then the reset destroys the libpq-resolved database. On the DEV host that could be `afldb_dev`, where `afldb_test` and `afldb_dev` coexist. The `/prod/i` name guard sees only the path.

## 6. First wrong layer

`tools/db/rebuild-test.ts:2058-2120` (no identity assertion in the reset stream), fed by `:459-461`.

## 7. Impact

A latent wrong-target hazard on the repository's most destructive tool. No incident is known.

## 8. Reproduction / witness

- Not executed. No DB-free libpq parser is available on this workstation (psycopg is not installed), and running psql is outside this task's command grant.
- DB-free witness W1 (proposed in the R6b notes): `databaseOf('postgresql://afldb_owner@localhost:5432/afldb_test?dbname=afldb_dev')` returns `afldb_test`, and `assertRebuildTargetName` accepts it.

## 9. Disproof attempts

- PRECHECK opens no connection.
- `runValidation` for the census inspects only the exit status, not the `database=` marker.
- The capture child asserts over postgres.js, which reads the path, not libpq.
- No test pins `databaseOf` with a query string.

## 10. Existing-issue search

- `issues.md` was searched for `dbname=`, `query param`, ISSUE-243/139/143 and ISSUE-093 §20.
- Classification: **new**.

## 11. Scope

Identity assertion in the reset and census streams, and DSN query-parameter refusal.

## 12. Out of scope

The `promotion-check` path, which is read-only and identity-gated.

## 13. Proposed fix boundary

- (1) Prepend an identity DO block to `RESET_SQL` (and to the census's enforce stream) asserting `current_database() = '<target>'` and `current_user = 'afldb_owner'`, modelled on `prove-reset.ts:246-268`.
- (2) In `resolveTarget`, refuse a DSN that carries `dbname`, `host`, `hostaddr`, `service` or `options` query parameters.
- Option (1) is the robust fix; option (2) is a cheap belt.

## 14. Proposed validation

1. DB-free: W1 (with fix (2), expect a refusal), and a string test that the stream `runSql` sends contains the assertion naming the target.
2. Then `npm run db:test:prove-reset` (operator-run).

## 15. Decisions / unresolved questions

- H-278-1: **RESOLVED 2026-10-13** from PostgreSQL 16 primary source (§17.1). The query string overrides the path. Fix (1) stood regardless.

## 16. Next action

None. Procedures A and B are done (§17.6, §17.9); the change is merged, pushed and closed (§18). A DEV sync was not part of this closure.

## 17. Implementation record (2026-10-13)

### 17.1 H-278-1: libpq precedence (primary source, `REL_16_STABLE` `src/interfaces/libpq/fe-connect.c`)

- `conninfo_uri_parse_options` stores the path `dbname` first, then calls `conninfo_uri_parse_params` on the `?` part. `conninfo_storeval` frees and replaces any earlier value for the keyword ("The existing value for the option is free'd before replacing"). **A query `dbname` (and `host`, `port`, `user`, ...) therefore replaces the path value.**
- Both keyword and value are percent-decoded, so `?%64bname=` is `dbname`.
- psql passes `-d <uri>` through `PQconnectdbParams` with `expand_dbname`: `conninfo_array_parse` parses the URI, then copies each parsed value in at the `dbname` slot. Array entries psql leaves NULL or empty are skipped, so they do not clear it. Defaults (`PG*` environment, service file) apply last and only to options still unset, so the environment cannot override a database or host the URL names.
- The libpq documentation page (34.1.1.2) states **no** precedence rule; the source is the evidence. Not executed: no libpq or psycopg on the workstation.
- **postgres.js differs** (`node_modules/postgres/src/index.js:469`): `database` comes from the options object or the URL path, never from the query string; the query supplies only the keys in its `defaults` table (`ssl`, `connect_timeout`, ...). `?dbname=` and `?host=` are ignored there. The capture child and the repository's own `databaseOf` therefore read a different target from psql.

### 17.2 Defect evidence and fix

- **Witness W1 (DB-free, passing):** `databaseOf('postgresql://afldb_owner:pw@localhost:5432/afldb_test?dbname=afldb_dev')` is `afldb_test` (the allowlist accepts it) while `searchParams.get('dbname')` is `afldb_dev`. Test: `tests/db-test-rebuild.test.ts`, `AFLDB-ISSUE-278`.
- **Runbook correction.** §13 treated fix (1) as covering every trigger. It does not cover `?host=` / `?port=` to another server that has a database of the same name: the guard names the database and role, not the server. Fix (2) is therefore required, not optional, and carries `port` and `user` beyond the five keywords listed in §13.
- **Fix (1)** `rebuildIdentityGuardSql(database)` in `tools/db/rebuild-test.ts`: one `DO` block asserting `current_database()`, `current_user`, `session_user` (the proof's contract, `prove-reset.ts` "1. IDENTITY"). `executeRebuild` prepends it to the reset stream and to every `validate` stream (the AFLDB-ISSUE-233 census and the final validation). `RESET_SQL` is unchanged (the proof embeds it verbatim).
- **Fix (2)** `assertDsnPinsTarget(dsn, name)`: refuses a non-lower-case-`postgres(ql)://` scheme, a multi-host authority, a query keyword in {`dbname`, `host`, `hostaddr`, `port`, `service`, `user`, `options`} (percent-decoded, case-insensitive), and a path whose libpq reading (percent-decoded) differs from `databaseOf`. Called from `resolveTarget` (admin and import DSN), `executeRebuild` (admin DSN, before stage 1) and `prove-reset.ts` (before any session or psql).
- **Residual after the first pass:** a host-less URL, or one that omits the port, took its server from `PGHOST` / `PGHOSTADDR` / `PGPORT` / a service file. **Closed in the second pass (§17.5).**
- **Changed existing tests** (they pinned the unguarded stream): six in `tests/db-test-rebuild.test.ts` now expect `rebuildIdentityGuardSql(db) + RESET_SQL`.

### 17.3 Remaining closure requirements

1. ~~**Procedure A**~~ **DONE: PASS 2026-10-13** (§17.6). Read-only; `AFLDB-ISSUE-278-VERIFY-A-IDENTITY-GUARD.md`, tool `D:\tmp\issue278\verify-identity-guard.ts`. The optional unpinned control was omitted, so V4 has no discriminating counterpart on this host.
2. ~~**Procedure B**~~ **DONE: PASS 2026-10-13 on attempt 2** (§17.8 attempt 1 history, §17.9 result). (`AFLDB-ISSUE-278-VERIFY-B-RESET-PROOF.md`, revised 2026-10-13, after A passed): `npm run db:test:prove-reset` bracketed by read-only Tier 1 **and Tier 2** fingerprints, driven by `D:\tmp\issue278\run-procedure-B.ps1` with an explicit child environment (§17.7). **Not read-only**: it executes the real `RESET_SQL` against `afldb_test` inside a transaction that always aborts (transient ACCESS EXCLUSIVE locks, one XID, WAL; nothing committed). Evidence: the run directory `run-B-<stamp>\` (stage transcripts, three Tier 2 JSON files, `summary.json`, `verdict.txt`, a clean `secret-scan.txt`).
3. ~~Operator commit of the reviewed change; `npm run merge:ready -- --issue 278`; operator push/merge.~~ **DONE 2026-10-13** (§18).
4. ~~Closure record (status, date, validation, evidence file names) and `CHANGELOG.md` `Unreleased` entry on merge; remove from `IssuesIndex.md` and the Open Issues table.~~ **DONE 2026-10-13** (§18, the documentation-only closure commit).

### 17.4 Validation so far (DB-free, 2026-10-13)

- `tests/db-test-rebuild.test.ts`: 637/637 (589 existing, 48 new). The five other DB-free consumer files passed with it (1,307 passed, 1 skipped in another file in total). `tsc --noEmit`: exit 0.
- Mutation checks (twice). First pass: keyword set emptied and guard removed from the reset stream: 13 of the 21 then-existing new tests failed. Second pass: env scrub disabled, `-X` dropped, host refusal and port refusal disabled, stage-child scrub reverted: 11 new tests failed. Mutants reverted (grep for the marker finds none).
- The operator script was dry-run with no database: missing `--expect-hostport` (exit 2), no DSN (`INCOMPLETE`, exit 2), a fake DSN whose host differs from the intended one (stops at T1, exit 1, nothing sent). Its evidence file contains no password.
- No database, host, psql, rebuild or promotion command was run.
- **Superseded count (2026-10-13, after §17.7):** `tests/db-test-rebuild.test.ts` is now **669/669** (637 + 32 for the Tier 2 harness); `tsc --noEmit` exit 0. **Superseded again by §17.8: 670/670.**

### 17.5 Second pass (2026-10-13): child environments, host-less and omitted-port routing

**Trace.** The reset and both validation streams, and the proof's probe and proof streams, are spawned by `runPsql`, whose child environment was a copy of the whole parent environment plus `PGPASSWORD` (`psql.ts` `psqlConnection`). The rebuild's stage children (`runCommand`: Python/psycopg importers, `npm run db:*`) inherited `process.env` entire. The observers (`prove-reset`, `fingerprint`, the capture child) use postgres.js.

**Why it matters (PostgreSQL 16 `fe-connect.c`, docs "Environment Variables").** libpq fills every parameter the URL leaves unset from the environment, then a service file (`conninfo_add_defaults` runs `parseServiceInfo` first; neither overrides a set value). `hostaddr` is such a parameter *even when the URI names a host*: `pqConnectOptions2` chooses `CHT_HOST_ADDRESS` first, so an inherited `PGHOSTADDR` sends the connection to that address and demotes `host` to an authentication name. An omitted port is `PGPORT`, then a service file, then the compiled-in default. A host-less URL is `PGHOST` / `PGHOSTADDR` / a service file / a local socket. psql also reads the system and user `psqlrc` for `-f -` unless `-X` (`startup.c`: `if (!options.no_psqlrc) process_psqlrc()`), after connecting and before the stream, so a `\connect` there reroutes it. postgres.js reads none of `PGHOSTADDR` / `PGSERVICE` and uses `PGHOST` / `PGPORT` only when the URL omits them, so observer and psql could be sent to different servers.

**Changes (all opt-in, so other psql users are unchanged).**
- `tools/db/psql.ts`: `LIBPQ_ROUTING_ENV` (`PGHOST`, `PGHOSTADDR`, `PGPORT`, `PGDATABASE`, `PGUSER`, `PGSERVICE`, `PGSERVICEFILE`, `PGSYSCONFDIR`, `PGOPTIONS`, `PGTARGETSESSIONATTRS`, `PGLOADBALANCEHOSTS`), `withoutLibpqRouting(env)` (copy, case-insensitive, parent untouched), `psqlConnection(dsn, env, { pinned })`, `psqlArgv(dsn, { pinned })` (adds `-X`), `PsqlDeps.pinned`. `PGPASSWORD` transport is unchanged (ISSUE-313): the DSN password still moves into the child's `PGPASSWORD` and never into argv; `PGPASSFILE` and `PGSSL*` are left alone.
- `rebuild-test.ts`: `createCliDeps` runs the reset and validation psql `pinned`, and gives stage children `withoutLibpqRouting(process.env)` plus the explicit overlay. `assertDsnPinsTarget` now also refuses no host, a non-literal host (percent-encoded host = Unix-socket path), no port, port outside 1–65535.
- `prove-reset.ts`: `pinned: true` on the shared psql deps (probe and proof). `first-kick-goal-rehearsal.ts`: its one direct `runPsql` against the resolved target is pinned.

**Compatibility restriction (also in `docs/deployment.md` §6a).** A rebuild / `db:test:prove-reset` DSN must be `postgres(ql)://user[:pw]@HOST:PORT/DB` with a literal host and an explicit port. Unix-socket, host-less and default-port DSNs are refused (write `localhost:5432`). Those two commands ignore the listed `PG*` variables and `psqlrc`. Other tools (`afl-api-ownership-census`, `privileges`, rehearsals) keep their ambient behaviour. Documented DSN forms in `.env.example` and `00_install_postgres.sh` already comply.

**Residual (stated, not claimed away).** The same host *name* could resolve differently for libpq and postgres.js (DNS, IPv4 against IPv6), and a different server could answer at the named address; the in-stream guard names the database and role, not the server. Procedure A's V3 (identical postmaster start time, database oid and server port from observer and psql) is the evidence for the target actually used. A stronger design (compare a server identifier in the destroying stream itself) would need the expected value supplied by the observer; not done, a decision for the owner if V3-style evidence is judged insufficient.

**Audit of the `prove-reset` stream (DB-free, pinned by tests; the live run is Procedure B).** Identity is asserted before the exclusivity check, the temp snapshots, `COMMENT ON DATABASE` and `RESET_SQL`; only `SET LOCAL`, `DO` warnings and the commit-trap temp table precede it. A mismatch is `RAISE EXCEPTION`; with `ON_ERROR_STOP` psql ends the stream there, the tool reports "failed before its deliberate abort" with psql's words, and no later marker or sentinel exists. No `nextval`/`setval`/`lastval`/`currval`/`ALTER SEQUENCE`/`CREATE SEQUENCE` appears in the stream or `RESET_SQL` (sequences are only dropped; `DROP SEQUENCE` is transactional). No `NOTIFY`, `COPY`, `VACUUM`, advisory/large-object call, `dblink`, database/tablespace/publication/subscription/event-trigger DDL, `ALTER SYSTEM` or bare `SET`; the migrations define no event triggers. Timeouts are `SET LOCAL` (5 s lock, 300 s statement, 60 s idle-in-transaction) and set before the first catalog statement. The only writes are three temp tables, one transactional `COMMENT ON DATABASE`, and the drops. **Wording to use:** "no committed change", not "no effects": the aborted transaction still consumes an XID, writes WAL, leaves dead catalog tuples for autovacuum, and holds ACCESS EXCLUSIVE locks until the abort.

### 17.6 Procedure A executed (2026-10-13, owner-authorised, `afldb_test` only): PASS

- **Run:** one run, 04:30:28–04:30:30 UTC, exit status 0, `ALL PASS`, 12 checks (V0, T1 x3, T2, V1 x2, V2 x2, V3 x2, V4). Evidence directory `D:\tmp\issue278\evidence\run-A-20261013T043012Z\` (stdout, empty stderr, exit status, sanitised `verify-A-evidence.json`, pre/post hash, git and untracked-inventory records). Password and full-DSN occurrences in it: 0.
- **Target (verified before connecting):** database `afldb_test`, user `afldb_owner`, `127.0.0.1:55432`. That is the live listener `ssh -N -L 127.0.0.1:55432:127.0.0.1:5432 arm@10.0.40.100` (the DEV host, started 10:33 that day). The credentials came from main's `.env` with only host:port rewritten (its stale `127.0.0.1:5432` has no listener); the password was never printed.
- **Results:** V1 guard on `afldb_test` exit 0, reporting `database=afldb_test current_user=afldb_owner session_user=afldb_owner`. V2 `guard(code_test_db)` on the same connection exit 3: `AFLDB-REBUILD-IDENTITY connected to database afldb_test, not code_test_db`. V3 postgres.js observer and pinned psql child identical: postmaster start `2026-10-10T16:01:11.590541`, database oid `45428`, server port `5432`. V4 with `PGHOSTADDR=192.0.2.1` set in the harness process: pinned psql exit 0 with identity reported.
- **Not shown:** V4c (unpinned control) was omitted by instruction, so V4 shows the pinned path reached the server, not that the same value would have broken an unpinned one (the DB-free test does show the unpinned path inherits it). The `current_user` / `session_user` refusal branches remain string-pinned only. The guard in front of the **reset** stream is Procedure B's.
- **Environment:** `psql` 16.15 at `C:\Program Files\PostgreSQL\16\bin\psql.exe` (sha256 `53B009…5465`), not on PATH; used through a PATH entry scoped to the run's own process; nothing installed. Ambient libpq routing variables: none.
- **Harness changed before the run** (hashed after the change): stop at the first failed check, `--evidence-dir`, harness hash and psql version recorded, observer connection errors recorded as a failed check. Procedure A's text was corrected after the run to match (the run used the earlier text; only file naming and the explicit-variable note differ).
- **Source integrity:** 13 hashed files (all changed code, tests, docs, procedures, harness, `psql.exe`) identical before and after; worktree HEAD `e7f84f14` and status unchanged; main's 7 untracked top-level paths (11 files) identical in hash and mtime.
- **Finding for Procedure B:** the tool shell carried an inherited `AFLDB_TEST_DATABASE_URL` for user **`arm`** (`127.0.0.1:55432/afldb_test`), process scope only. `prove-reset` / `fingerprint` read `.env` only when the variable is unset, so it would win and fail the identity gate. B must set the variable explicitly. The harness was unaffected: it overwrote the value in the child. **Closed in §17.7:** the runner removes the inherited value and supplies the `afldb_owner` DSN to every child.
- **Owner confirmation and acceptance (2026-10-13, in session):** the owner confirmed that Procedure A used the intended `afldb_test` target through the existing streamanator tunnel, and accepted its result as recorded above **without a re-run**. The record stands as written; nothing was re-executed to confirm it.

**Not done, by choice.** `prove-reset` does not embed `rebuildIdentityGuardSql` (it has its own identity block, and the audit pins the stream as is); Procedure A proves the rebuild's guard text. Embedding it would make B exercise it directly.

### 17.7 Procedure B prepared (2026-10-13, owner-authorised local preparation only): Tier 2 supplement and runner — NOT EXECUTED

**Authorised by the owner:** local preparation of the Tier 2 fingerprint harness and Procedure B updates. **Not authorised and not done:** running Procedure B, any database query or contact, commit, merge, push, deployment. Every untracked file and existing hold was left alone; the only edits are the files listed below.

**What was built.**
- `tools/db/fingerprint-tier2.ts` (new; `npm run db:test:fingerprint-tier2`): read-only, `REPEATABLE READ`, rolled back. Records identity (database, `current_user`, `session_user`, database oid, postmaster start time, version, port), Tier 1 in the same snapshot, a row count and multiset whole-row digest for every user table and populated materialized view (duplicates preserved), every sequence's `last_value` / `is_called` plus type, cache, cycle and owning column, and digests of routines, defaults, checks, foreign keys, key constraints, indexes (predicates), triggers, policies, rules, types, inheritance, event triggers, comments, the database comment, relation storage options and per-column options. Hashes, counts, names and sequence values only. Fails closed (unreadable table, row-level-security filtering, any failing section, count disagreement, wrong database or role). `--compare` refuses anything not `COMPLETE`, so two failures cannot match. Wording of a match: *unchanged observed state, not proof that no sequence operation occurred*.
- `D:\tmp\issue278\run-procedure-B.ps1` (outside the repository, like procedure A's harness): preflight (pinned file hashes, HEAD, `psql.exe` hash and version, `.env` DSN derivation with host:port rewritten to the stated tunnel, tunnel listener), then baseline (Tier 1, Tier 2 twice, stability compare, embedded-digest and identity and database-oid gates), then the proof **only if all baseline gates pass**, then the after-census **always**, then a credential scan of every evidence file. Every child gets an explicit environment (inherited `arm` DSN and libpq routing variables removed; `afldb_owner` DSN set; psql directory prefixed onto PATH in the child only); no retry, no cleanup; a manual `-CensusOnlyBaselineDir` continuation exists.
- `AFLDB-ISSUE-278-VERIFY-B-RESET-PROOF.md` rewritten around the runner (coverage table, stage/gate table, expected results, failure table, evidence list).
- `package.json`: one script, `db:test:fingerprint-tier2`. `tests/db-test-rebuild.test.ts`: 32 tests added.

**Validation performed (all without any database contact).** Full `tests/db-test-rebuild.test.ts` **669/669** with every `AFLDB_*`/`PG*`/`DATABASE_URL` variable removed from the test process; `tsc --noEmit` exit 0. Mutation check on the harness (row-level-security refusal disabled, `FROM ONLY` dropped, final rollback removed): 15 tests failed; restored byte-identical. Runner: PowerShell AST parse clean; preflight run with `git` stubbed (HEAD pin therefore not exercised for real) up to the tunnel check and, against a harmless local listener port, to its end; refusal paths (non-loopback host:port, census-only without `-Execute`, census-only with a missing baseline). The child-process plumbing was tested with `node -e` probes (the afldb_owner DSN overrides an inherited `arm` DSN; `PGHOST`/`PGHOSTADDR`/`PGPASSWORD`/`AFLDB_TEST_IMPORT_DATABASE_URL` absent in the child; unrelated variables kept; PATH prefixed; timeout kills the process tree; non-zero exit and stderr captured). The whole `-Execute` orchestration was rehearsed against a mock that replaces only `fingerprint-test.ts`, `fingerprint-tier2.ts --out` and `prove-reset.ts`: pass, proof refused, after-census mismatch, after-Tier-2 incomplete, unstable baseline, failed baseline, wrong database oid, mismatched embedded digest, credential leak, and census-only continuation each produced the intended verdict and exit status, and the real `--compare` accepted and compared the mock records. Rehearsal scratch directories were deleted.

**Not validated, and why.**
- **The Tier 2 SQL text has never been parsed or executed by PostgreSQL** (no database query was authorised). The DB-free tests prove the collection logic against a scripted fake and that every statement is `SELECT`/`SET`/the read-only envelope; they cannot prove the SQL is accepted by the server's version, or that row digests are what the SQL semantics intend (summed per-row hashes preserving duplicates is by construction). The first real execution is the read-only baseline, which the runner makes a hard gate before the proof. Known judgement points a first run could expose: `to_jsonb` of `pg_attribute` / `pg_proc` rows, `pg_node_tree` casts in `relation_options`, `bit(64)::bigint` limb extraction, and Tier 2 duration on `afldb_test` (unknown).
- Real `git` in the runner (`rev-parse HEAD`, `status`) was stubbed in every validation run; the real call is the user's.
- The runner's real stages against a real server, the real `prove-reset` through it, and Windows PowerShell 5.1 against a live tunnel: first exercised by the operator.

**Current state found while preparing:** nothing was listening on `127.0.0.1:55432` (the tunnel is down), so the runner's preflight check P9 refuses until it is restarted.

**(Superseded by §17.8: the Tier 2 `definitions:checks` SQL failed on its first PostgreSQL run; hashes below are the pre-correction set.)**

**Hashes (sha256) of what was prepared** (the three procedure-A-pinned tools and `docs/deployment.md` are unchanged since procedure A): `tools/db/fingerprint-tier2.ts` `CF15209B…2691`; `tests/db-test-rebuild.test.ts` `C8001E48…87D1`; `package.json` `24654971…0DE7`; `tools/db/fingerprint-test.ts` `11E76D52…01B6` and `tools/db/catalog-fingerprint.ts` `4D9859D7…FCB0` (unchanged from `HEAD`); `D:\tmp\issue278\run-procedure-B.ps1` `80E5F460…13FA`. The runner pins the six tool hashes and refuses the run if any differs.

### 17.8 Procedure B attempt 1 STOPPED at the baseline; Tier 2 SQL corrected locally (2026-10-13) — attempt 2 prepared here, executed and passed in §17.9

**Attempt 1 (owner-authorised, one attempt, `afldb_test` only; evidence `D:\tmp\issue278\evidence\run-B-20261013T050801Z\`, preserved unchanged).** DEV `afldb` active and `/api/health` `ok` after the reboot; preflight P1–P9 passed. Tier 1 passed (`a39ad96bda76647d0bba23b7d965941a95ab1ce4eefd5f2f40f72e3216f94cee`). The first Tier 2 execution against PostgreSQL failed: `INCOMPLETE: definitions:checks failed: operator is not unique: text || "char"`. The runner exited 1, `BASELINE FAILED (proof not run)`. **The reset proof never started. No after-census was taken, so Procedure B established no state-comparison verdict.** Postmaster start and database oid were not recorded (Tier 2 identity never completed). Secret scan 0/10; source hashes unchanged. No retry, cleanup, rebuild, commit, merge, push or deployment; PROD and DEV data were not touched.

**Correction (owner-authorised local preparation only; no database or host contact).**
- `tools/db/fingerprint-tier2.ts`: `co.contype` (`checks`, `key_constraints`) and `c.relkind` (`relation_options`) are `"char"` and now carry `::text`. Review of every `||` in the file by operand type: `name`, `text`, `int2` (`adnum`, `attnum`), `int4` (`inhseqno`) and `oidvector::text` resolve; only `"char"` (implicitly castable to `text`, outside the string category) is ambiguous. The other `"char"` uses (`relkind`, `relpersistence`, `relreplident`) sit in `format('%s')`, `jsonb_build_object`, `IN (…)` or already carry `::text`.
- `tests/db-test-rebuild.test.ts`: one test added (670/670): a **static text check** that no `"char"` catalogue column is concatenated without `::text` in any definition section. It is not PostgreSQL SQL validation and cannot reproduce the server error; the guard regex was shown to match the old text and not the new.
- `D:\tmp\issue278\run-procedure-B.ps1`: the baseline is **fail-fast**. Gates are evaluated as each stage completes; the first failure stops the baseline (no second baseline, no stability compare, no proof, no after-census) and the verdict/guidance say that no state-comparison verdict was established. The Tier 2 #1 gates (embedded Tier 1 digest, identity, oid 45428) run before the second baseline is launched. The old runner file was edited in place; its hash (`80E5F460…13FA`) is recorded in the preserved attempt-1 `hashes.txt`.
- `…-VERIFY-B-RESET-PROOF.md`: status, SQL-status paragraph, stage table, failure table and a new §9 attempt history.

**Validation (no database contact).** `tests/db-test-rebuild.test.ts` **670/670**; `tsc --noEmit` exit 0; runner AST parse clean; runner orchestration rehearsed against a mock that replaces only the three tools (`NODE_OPTIONS=--require`) with a harmless local listener as the target: Tier 2 failure → only tier 1 and tier2-before-1 launched, `BASELINE FAILED`; wrong oid → stops before the second baseline; full pass → `PASS`, exit 0. **The mocks are orchestration rehearsal only, not SQL validation.** Every Tier 2 section after `definitions:checks` has still never been executed by PostgreSQL; a further SQL defect is possible on attempt 2.

**New hashes (sha256).** `tools/db/fingerprint-tier2.ts` `4B21263E…20E1`; `tests/db-test-rebuild.test.ts` `F4D5D5D5…52C6`; `D:\tmp\issue278\run-procedure-B.ps1` `7140B7BA…D100`; unchanged: `rebuild-test.ts` `F274B9CB…018F`, `psql.ts` `E2E54679…35DA`, `prove-reset.ts` `4747284F…6854`, `fingerprint-test.ts` `11E76D52…01B6`, `catalog-fingerprint.ts` `4D9859D7…FCB0`, `package.json` `24654971…0DE7`, `docs/deployment.md` `2C463CE7…6C97`, `psql.exe` `53B00955…5465`. Full manifest: `D:\tmp\issue278\manifest-B-attempt2.txt`. **Attempt 2 requires a fresh owner authorisation.** ISSUE-278 stays Open.

### 17.9 Procedure B attempt 2 PASSED (2026-10-13, owner-authorised, one attempt, `afldb_test` only); records, review and local commit

**Two verdicts, kept separate.**
1. **Proof verdict: PASS.** `tools/db/prove-reset.ts` executed the real `RESET_SQL` through the real psql path inside a transaction that always aborts: exit 0, `RESET_SQL PROVEN`, `psql exit : 3` (the deliberate abort), `other sessions: 0 (exclusive access)`, `server: 127.0.0.1/32:5432 PostgreSQL 16.15 (Ubuntu 16.15-0ubuntu0.24.04.1)`, `post-reset census (inside the aborted transaction): application schemas 0 tables 0 views 0 sequences 0`, database comment (none) restored exactly, `reset stream completed in 1590 ms`, post-rollback Tier 1 fingerprint identical. Nothing was committed or rebuilt.
2. **Unchanged-observed-state verdict: MATCH.** Tier 1 `a39ad96bda76647d0bba23b7d965941a95ab1ce4eefd5f2f40f72e3216f94cee` before and after (migrations present: 109, `109_import_reads_player_match_period_stats.sql`). Tier 2 overall `4f11fda946e42c4cbe0590e7e6d911fe2e1e36180bdf12e93b2cf00d64a109d9` in baseline #1, baseline #2 and the after-census (99 tables, 0 materialized views, 63 sequences, 16 definition sections, **1,454,440 rows digested**). The two baselines MATCHed (stable), and `--compare` baseline #1 against the after-census MATCHed. Identity in all three records: `afldb_test` as `afldb_owner` (current and session user), database oid **45428**, port 5432, PostgreSQL 16.15.

**Postmaster and the reboot.** The DEV host rebooted after Procedure A (kernel boot 2026-10-13 15:50:51 host-local, i.e. about 04:50 UTC; Procedure A ran at 04:30 UTC). The new postmaster start time is **2026-10-13 04:51:00.640018+00**, identical in baseline #1, baseline #2 and the after-census, so the postmaster did not restart during this attempt. Procedure A saw the previous postmaster (**2026-10-10 16:01:11.590541**) and its result is a **historical** result about that server run; it is not invalidated or re-labelled. The database oid (45428) is unchanged across the reboot, which is what ties the two procedures to the same database. DEV `/api/health` was `ok` before and after; `afldb` was active; nothing was restarted or deployed by this work.

**Evidence (outside the repository; sha256 in full).** Run directory `D:\tmp\issue278\evidence\run-B-20261013T053946Z\` (15 files scanned, 0 credential occurrences): `02-tier2-before-1.json` `3C650713CE43EEA0559ED144061DD60909650CCD23EEF660B5A49A146D9B0EA6`; `03-tier2-before-2.json` `FB8360D80E370950FB5D20CD133B94EB170EEC74D498CFF6937DF4E664690D56`; `07-tier2-after.json` `D781F31CB2BCA8E14DEFE1CBFC28D8BB0C8567625D3A46A77EB6706BBE3D91F2` (the JSON hashes differ only by their collection timestamps; the overall digests are equal); `05-prove-reset.txt` `166BFCA1AB5C6D1E52F8570829CBDA4E7BA535458C600E6C6045B58D6DC6DA0E`; `summary.json` `57DE00BFE9C67EAD15E8847FA5296E25DAD4C660648A75B0BC41E70DDDA2378E`; `verdict.txt` `D85E658717FF2FD52F37AC9BC92D7FEA23DB755AF6127A889AB5810D21D30814`; `hashes.txt` `5275298A1BA1B2F8F406B3031A84E260121D9E383935DA53BABB9A142D9132D7`; `secret-scan.txt` `A35D1AFF236A6AE95920F74200E87978073AE8846EB6F25D9E26E3C6F205F5D0`. All eight stage exits 0 (tier1-before 1 s, tier2-before-1 20 s, tier2-before-2 22 s, baseline-stability 0 s, prove-reset 3 s, tier1-after 1 s, tier2-after 19 s, tier2-compare 0 s). Pre-run snapshot of the manifest, runner and the six executed tool sources, plus the post-run verification note: `D:\tmp\issue278\evidence\attempt2-prep-20261013T053932Z\`. Attempt 1 evidence (`run-B-20261013T050801Z\`) is preserved unchanged as history (§17.8).

**Executed code bytes (sha256, full) and the accepted evidence.** The runner's own `hashes.txt` and an independent re-hash after the run both give: `tools/db/rebuild-test.ts` `F274B9CB8BB23984443BC40A86346C2F9D34DA91F6AAB28722541B048C4D018F`; `tools/db/psql.ts` `E2E5467951CD36421DC85C8DCCA455956813978C4FE44DDCCDB9FC52050735DA`; `tools/db/prove-reset.ts` `4747284FEB09C298CE245FC7FCBD5731D28836BD9764EF851AD27ED88F316854`; `tools/db/fingerprint-test.ts` `11E76D52F632259A6805320EE20657C3C2A37A2EF9E1B368F050AC9C5A8701B6`; `tools/db/catalog-fingerprint.ts` `4D9859D72887D09C4EB24DC66623E283D350ED6CA027EFBCDC4032054312FCB0`; `tools/db/fingerprint-tier2.ts` `4B21263E339BE7EC262FFE9E93211F47A3968B89CD754164A54376BC429420E1`; `psql.exe` `53B009551F935194B98F2C53E490693B39B765FF59AEAE0CD0080281B1E55465`; runner `7140B7BAD21F591253A759F129C4A90C817D755F422E72ADA6D642A5EA40D100`. The working-tree copies of the tracked tool files are CRLF and the committed blobs LF (`core.autocrlf=true`); before the commit each working copy, normalised CRLF to LF, was compared with the staged blob and they are identical (see the commit message and the readiness record).

**Coverage limitations (retained).** A MATCH is *unchanged observed state*, not proof that no sequence operation occurred (a sequence moved and put back would match). Not covered: index and TOAST physical contents, extended statistics, publications and subscriptions, foreign servers and user mappings, roles and memberships, database-level settings, large objects, security labels, planner statistics, foreign-table contents. The proof stream embeds `RESET_SQL` and its **own** identity block, not `rebuildIdentityGuardSql`; the rebuild's guard text is proven by Procedure A and the DB-free tests, **not by a real rebuild, which has not been run**. One attempt on one host. The mocks used while preparing the runner were orchestration rehearsal, not SQL validation. Procedure B does not exercise the V4c unpinned control either.

**Full-delta review (2026-10-13, before the commit; no blocking finding, executed bytes unchanged).** Reviewed in full: `tools/db/fingerprint-tier2.ts` (read-only by construction: `SELECT`/`SET LOCAL` only, `default_transaction_read_only`, `READ ONLY REPEATABLE READ`, rollback; fails closed; `--compare` refuses anything not `COMPLETE`; no row content or credential in the record; the three `"char"` casts), `package.json` (one added script, `db:test:fingerprint-tier2`), the diffs of `rebuild-test.ts`, `psql.ts`, `prove-reset.ts`, `first-kick-goal-rehearsal.ts` (one `pinned: true`) and `docs/deployment.md`, and both procedure documents. **ISSUE-313 password-transport compatibility:** `withoutLibpqRouting` removes only the eleven routing variables and not `PGPASSWORD` or `PGPASSFILE`; `psqlConnection` copies the environment first and then moves the DSN password into `PGPASSWORD`, so the argument vector stays password-free; the `psqlArgv` password-free `-d` string is unchanged apart from a leading `-X` when pinned; the runner's explicit child environment sets the DSN and the password only in the child. Low-severity observations, not blocking and not changed: the new DSN form restriction (literal host and explicit port) also applies to the import DSN; the Tier 2 `--compare` ignores `collectedUtc` and `elapsedMs` by design; the procedure documents reference tools under `D:\tmp\issue278\` outside the repository, as Procedure A's already did.

**Status.** Locally implemented and validated; committed locally on `sonnet/issue-278` as one implementation commit (SHA in the session report and the closure record, not self-referentially here); pending integration (merge-readiness on fresh `main`, operator merge and push, DEV sync). **ISSUE-278 stays Open.** The observation window and the PROD hold are untouched.

## 18. Closure record (2026-10-13)

**Status: Resolved (2026-10-13)**, merge-scoped, on the push of the documentation-only closure commit. Nothing in §1–§17 is rewritten; the failed attempt 1 (§17.8) and every limitation (§17.9) stand as recorded.

**Integration.**
- Implementation commit `dd18adb93a0207eb2ed812ac56636a90e2c89239`, parent `e7f84f14ac14591dd929644e6ddf6c6d80a861cb` (= local `main` = `origin/main` = the live remote at every fresh check before the push), tree `bfbd6920062be9870d44e4552b9a4536cdc26b44`: 14 files, 2,536 insertions, 30 deletions. The `git ls-tree -r` listing digest was `0b98253ebfcc7c554a9aa1c65c1e2eb654a5fb0e166ed3e8a7a288096878f539` on the branch before and on `main` after the fast-forward, so the validated bytes are unchanged.
- `git merge --ff-only sonnet/issue-278` in the primary `main`, then `git push origin main:main` without force: `e7f84f14..dd18adb9  main -> main`. After a fresh fetch, local `main`, `origin/main` and the live remote were all `dd18adb9`.
- `npm run merge:ready -- --issue 278` with the 14 repeatable `--expected-file` rules, from the issue worktree: **exit 1, BLOCKED by exactly one blocker**, "main worktree is clean" (the 15 untracked paths below). Everything else passed: current branch, issue worktree clean, local `main` equals recorded `origin/main`, base/main relationship (ahead 1, behind 0), migration collision/checksum parity, committed files match the declared scope (changed 14, rules 14, unexpected 0). Warning: the runbook has no `afldb-merge-readiness` JSON block. Info: database migration parity not checked.
- `npm run preflight -- --mode merge --issue 278` from `D:\dev\afldb`, no DSN: **exit 1, BLOCKED by exactly one blocker**, "working tree is clean" (15 changed/untracked paths). Warnings: `psql` and `pg_restore` unavailable (not required for this mode).
- **Cleanliness exception (owner-authorised, scoped; not a clean pass).** The 15 untracked primary-checkout paths: `.agents/skills/javascript-testing-patterns/SKILL.md`, `.agents/skills/javascript-testing-patterns/references/advanced-testing-patterns.md`, `.agents/skills/nextjs-hydration-audit/SKILL.md`, `.agents/skills/nodejs-backend-patterns/SKILL.md`, `.agents/skills/nodejs-backend-patterns/references/advanced-patterns.md`, `.agents/skills/nodejs-backend-patterns/references/details.md`, `.agents/skills/postgresql-table-design/SKILL.md`, `.agents/skills/typescript-advanced-types/SKILL.md`, `.agents/skills/typescript-advanced-types/references/details.md`, and six zero-byte files named ``0)``, ``20` ``, `` `path ``, `i`, `q(sequenceValueSql(qname))))[0]`, `t.kind` (SHA-256 `e3b0c442…b855`). The first 14 were recorded in `D:\tmp\issue278\blocker-manifest-20261013T055036Z.txt`; the 15th (`` `path ``) appeared at 2026-10-13 05:58:14Z (the same Read-tool artefact as three earlier strays), halted the first close-out attempt (`STOPPED-unexpected-stray.txt`, retained), and was then added by the owner. A script (untracked set equal to the manifest, size, SHA-256, tracked state clean) was run before and after each integration step and at completion; the paths were never touched.
- Evidence outside the repository: `D:\tmp\issue278\closeout-20261013\` (15-path manifest, verifier and its log, ref checks, gate outputs and exit statuses, delta list, push output).

**Accepted evidence (unchanged from §17).** DB-free `tests/db-test-rebuild.test.ts` 670/670 and `tsc --noEmit` clean; Procedure A PASSED 12/12 (§17.6, accepted); Procedure B attempt 2 PASSED with a proof verdict of PASS and, kept separate, an unchanged-observed-state verdict of MATCH (§17.9); attempt 1 stopped at the baseline with no proof and no verdict (§17.8).

**Preserved limits.** A MATCH is not proof that no sequence operation occurred. Not covered: index and TOAST physical contents, extended statistics, publications and subscriptions, foreign servers and user mappings, roles and memberships, database-level settings, large objects, security labels, planner statistics, foreign-table contents. No real `db:test:rebuild` has been run; the rebuild-stream guard is proven by Procedure A and the DB-free tests. Procedure A is a historical result about the pre-reboot postmaster. The unpinned control V4c was omitted. One attempt on one host. Residual: one host name resolving differently for libpq and postgres.js (the guard names database and role, not the server). The literal-host and explicit-port DSN restriction (`docs/deployment.md` §6a) applies to the rebuild and reset-proof commands.

**Not done in this closure.** No test rerun, no database or host contact, no deployment or DEV sync, no cleanup. The observation window, the PROD hold and every other issue's status are unchanged. Open issues: 48 -> 47.
