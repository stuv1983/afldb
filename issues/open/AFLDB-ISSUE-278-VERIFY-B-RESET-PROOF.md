# AFLDB-ISSUE-278 — Procedure B: the transactional reset proof (`npm run db:test:prove-reset`)

**Status:** **EXECUTED: attempt 2 PASSED 2026-10-13** (`D:\tmp\issue278\evidence\run-B-20261013T053946Z\`; proof PASS and, separately, unchanged-observed-state MATCH; runbook §17.9). Revised 2026-10-13 (third preparation). **Attempt 1 (2026-10-13 05:08 UTC, `run-B-20261013T050801Z`) STOPPED at the baseline, before the proof:** the first Tier 2 SQL run against PostgreSQL failed in `definitions:checks` with `operator is not unique: text || "char"`. The proof never started, no after-census was taken, and **no state-comparison verdict was established**. The defect was corrected (§9) and a corrected attempt 2 then passed (§9, runbook §17.9). Operator-run, **after** procedure A passed (accepted 2026-10-13; owner confirmed it used `afldb_test` through the existing streamanator tunnel).

**Revision summary.** (1) The two Tier 1 fingerprints are now supplemented by a **Tier 2** fingerprint (row digests, sequence positions, definition digests, server identity), taken in read-only transactions. (2) Every child process gets an **explicit environment**: the `afldb_owner` DSN is supplied for it, the inherited `arm` DSN and the libpq routing variables are removed, psql is reached through a PATH entry that exists in the child only, and no password reaches an argument vector. (3) The proof runs **only if every baseline check passed**. (4) The after-census is attempted **whether or not the proof succeeded**; there is no retry and no cleanup. All of it is driven by one runner, `D:\tmp\issue278\run-procedure-B.ps1`.

## 1. What this procedure does to the database — read carefully

**The proof is NOT read-only.** It executes the real `RESET_SQL` — every `DROP SCHEMA … CASCADE`, `DROP TABLE … CASCADE`, view, sequence, routine and type drop — against **`afldb_test`**, inside one transaction that is **always aborted**. The expected end state is that nothing changed. That is a property of the transaction, not of the statements.

Audited against the exact stream (`buildProofSql()`, pinned by `tests/db-test-rebuild.test.ts`, "prove-reset stream audit"; the audit shows what the stream **contains**, not what PostgreSQL does with it):

| Aspect | Finding |
|---|---|
| Transaction envelope | psql runs `--single-transaction` with `ON_ERROR_STOP=1`. The stream contains no `BEGIN`/`COMMIT`/`ROLLBACK`/`SAVEPOINT`. psql sends `COMMIT` only after a clean end, and the stream **cannot** end cleanly (see below). |
| Abort | The last statement is `RAISE EXCEPTION 'AFLDB-RESET-PROOF-ROLLBACK …'`. A zero exit is treated as a **failure** by the tool. |
| Server-side commit trap | Before anything else: a temp table with a `DEFERRABLE INITIALLY DEFERRED` unique constraint and a duplicate row, so any `COMMIT` raises and rolls back — independent of psql flags. It also proves a transaction block exists (autocommit would leave fewer than 2 rows → stop before the reset). |
| Identity | Block "1. IDENTITY" runs **before** the exclusivity check, the temp snapshots, `COMMENT ON DATABASE` and `RESET_SQL`: `current_database() = afldb_test`, `current_user = session_user = afldb_owner`, neither a superuser. A mismatch is `RAISE EXCEPTION`; under `ON_ERROR_STOP` psql stops there and the reset text is never executed. Before identity the stream runs only `SET LOCAL`, `DO` warnings and the commit-trap temp table. (The JS layer also checks identity over postgres.js **before psql is probed**.) |
| Sequences | **No `nextval`/`setval`/`lastval`/`currval`/`ALTER SEQUENCE`/`CREATE SEQUENCE`** in the proof stream or `RESET_SQL`. Sequences are only **dropped**, and `DROP SEQUENCE` is transactional (it rolls back). `setval()`/`nextval()` are the operations that would *survive* a rollback; there are none. |
| Timeouts | All `SET LOCAL` (transaction-scoped, gone at abort): `lock_timeout 5s`, `statement_timeout 300s`, `idle_in_transaction_session_timeout 60s`, `client_min_messages warning`; set before the first catalog statement. A timeout is an error → rollback → the tool reports "failed before its deliberate abort". |
| Non-transactional constructs | None found: no `NOTIFY`/`LISTEN`, `COPY`, `VACUUM`/`CLUSTER`/`REINDEX`, advisory or large-object calls, `dblink`, `pg_terminate_backend`, `CREATE/DROP DATABASE|TABLESPACE|SUBSCRIPTION|PUBLICATION|EVENT TRIGGER`, `ALTER SYSTEM`, bare `SET`. The migrations define **no event triggers** (grep of `src/db/migrations`), so no DDL hook runs side effects. |
| Writes inside the transaction | 3 temp tables, 1 `COMMENT ON DATABASE afldb_test` (transactional; the tool compares the comment before and after from fresh sessions), and the `DROP`s. |
| Other sessions | The proof **refuses** if any other client session is connected to `afldb_test` (autovacuum workers are tolerated, bounded by `lock_timeout`). The postgres.js observer is closed before psql starts. |

**Effects that exist even though nothing is committed** (so "no durable effects" must be read as "no committed change"):
- The aborted transaction consumes a transaction id and writes WAL; its catalog tuple changes become dead tuples for autovacuum to clean.
- It holds `ACCESS EXCLUSIVE` locks on every relation `RESET_SQL` drops until the abort (elapsed time is printed: expect seconds, bounded by 300 s). Any other client connecting meanwhile would block; that is why exclusivity is required.
- Statistics counters and server logs record the activity. A killed process or lost connection also aborts the transaction.

**Not covered:** a server crash mid-transaction is safe by PostgreSQL's design but is not exercised here.

**The Tier 1 and Tier 2 fingerprints are read-only.** Each is one `READ ONLY` transaction (Tier 2: `REPEATABLE READ`, so every table and the catalogs come from one snapshot), preceded by `SET default_transaction_read_only = on` and rolled back, never committed. They send `SELECT` and `SET LOCAL` only, spawn nothing, and never reference `RESET_SQL` or psql (`tests/db-test-rebuild.test.ts`, "tier 2 fingerprint supplement"). Costs: one backend session each; Tier 2 reads **every row of every user table server-side** (CPU and I/O, nothing but hashes and counts crosses the tunnel) and holds `ACCESS SHARE` locks on those tables until it ends, which blocks only DDL; `lock_timeout 5s` and `statement_timeout 600s` bound it. How long Tier 2 takes on `afldb_test` is **unknown until the first baseline run** (the runner allows 30 minutes per Tier 2 stage).

## 2. What each fingerprint covers, and what a match means

| | Covers | Does not cover |
|---|---|---|
| **Tier 1** (`catalog-fingerprint.ts`, existing) | schemas, relations (kind, persistence, owner, ACL), columns, indexes (shape), constraints (shape), routines (signature, owner, ACL), types, enum values, sequence definitions (start/increment/min/max), extensions and members, default ACLs, migration bookkeeping | table contents, sequence positions, the bodies of everything |
| **Tier 2** (`fingerprint-tier2.ts`, new) | **Identity:** database, `current_user`, `session_user`, database oid, postmaster start time, server version and port. **Tier 1,** in the same snapshot. **Rows:** a count and a whole-row digest for every user table and populated materialized view (each row's sha256, split into four 64-bit limbs and **summed as exact numerics**: independent of row order, duplicates preserved because a repeated row is added again; `FROM ONLY` so inheritance parents do not double count). **Sequences:** `last_value` and `is_called` (a plain `SELECT` of the sequence relation, which does not advance it), plus the settings Tier 1 lacks: data type, cache, cycle and the owning column. **Definitions (digest + count each):** routines (whole `pg_proc` row incl. body, config, ACL), column defaults, check constraints, foreign keys (target table and columns), key constraints, indexes (expressions and predicates), triggers, policies, rules/views, user types, inheritance, event triggers, all object comments and the database comment, relation storage options (reloptions, tablespace, access method, persistence, replica identity, row-security flags, partition bound, TOAST options) and per-column storage/ACL options | index and TOAST physical contents, extended statistics, publications and subscriptions, foreign servers and user mappings, roles and memberships, database-level settings, large objects, security labels, planner statistics, foreign-table contents |

**Wording to use for a match:** *unchanged observed state* — identity, schema, every row count and row digest, every sequence position and every definition digest are equal between two read-only observations. It is **not** proof that no sequence operation occurred (a sequence moved and put back would match), nor proof about anything in the "does not cover" column. Two fingerprints taken by *different tools or different sessions* are comparable only because both are the same deterministic queries over a pinned text format.

**Evidence hygiene.** The Tier 2 evidence file holds hashes, counts, object names (schema, table, sequence), sequence values and catalog metadata. **Never row contents, credentials or connection strings.** Errors are recorded with URLs and `password=` masked and bounded to 500 characters.

**Fails closed.** An unreadable table, a table that row-level security could filter for `afldb_owner` (an incomplete digest), a failing section, a table or sequence count that disagrees with an independent catalog count, a transaction that is not read-only/repeatable-read, or a connection that is not `afldb_test` as `afldb_owner` aborts the collection: an `INCOMPLETE` record is written and the exit status is 2. `--compare` refuses any input that is not a `COMPLETE`, self-consistent record, so **two matching errors can never be a pass**.

**Status of the Tier 2 SQL.** The collection logic is tested DB-free against a scripted fake (33 tests, plus mutation checks); the scripted fake and the static text check are **not** PostgreSQL SQL validation. The SQL was first executed against PostgreSQL by attempt 1, which ran Tier 1 successfully and **failed the Tier 2 `definitions:checks` section** (a defect, now corrected, §9). Because the attempt stopped there, **no later Tier 2 section has been executed by PostgreSQL**; any of them may still fail on the next attempt. The runner will not start the proof unless the baseline succeeds, so a SQL defect costs a re-run of the baseline, not a risk to the database.

## 3. Preconditions (checked by the runner's preflight; no database contact)

1. **Procedure A passed** and the worktree is the reviewed one: HEAD `e7f84f14…`; the sha256 of the six tool files (`rebuild-test.ts`, `psql.ts`, `prove-reset.ts`, `fingerprint-test.ts`, `catalog-fingerprint.ts`, `fingerprint-tier2.ts`) equal the values pinned in the runner (the first three are Procedure A's own hashes). Any difference refuses the run.
2. **Target.** The tunnel must be up **before** the run: `ssh -N -L 127.0.0.1:55432:127.0.0.1:5432 arm@10.0.40.100`, left running in its own window. *When this was prepared, nothing was listening on `127.0.0.1:55432`, so the runner's check P9 refused.* The runner takes the credentials from main's `.env` (`D:\dev\afldb\.env`; its own `127.0.0.1:5432` is stale and is rewritten to the `-ExpectHostPort` you pass), and **only if** that `.env` names `afldb_owner` / `afldb_test` and a loopback host. State the host:port yourself; do not copy it out of the DSN.
3. **Exclusivity.** Nothing else may be connected to `afldb_test`: no `vitest`/integration run, `db:test:rebuild`, psql session or settle job. `prove-reset` checks and refuses.
4. **psql.** The existing `C:\Program Files\PostgreSQL\16\bin\psql.exe` (sha256 `53B009…5465`, 16.15) is reached through a PATH entry **in each child process only**. Nothing is installed, no variable is changed. The runner checks the hash and version.
5. **Time.** Allow a few minutes for the proof and an unknown time for Tier 2 (see §1). Keep the PowerShell window open. Run it in a normal, non-elevated window.
6. Do **not** run it if you have any doubt which server the tunnel reaches: re-run procedure A (V3).

## 4. Run

```powershell
# 1. PREFLIGHT ONLY: local checks, no database contact, writes nothing.
powershell -NoProfile -ExecutionPolicy Bypass -File D:\tmp\issue278\run-procedure-B.ps1 -ExpectHostPort 127.0.0.1:55432

# 2. THE RUN (executes the real RESET_SQL inside a transaction that always aborts).
powershell -NoProfile -ExecutionPolicy Bypass -File D:\tmp\issue278\run-procedure-B.ps1 -ExpectHostPort 127.0.0.1:55432 -Execute
```

The runner needs nothing set beforehand. It does **not** read or honour a `$env:AFLDB_TEST_DATABASE_URL` in your shell: every child gets an environment built from scratch (below). Evidence goes to `D:\tmp\issue278\evidence\run-B-<UTC stamp>\`.

**What `-Execute` does, in order** (each stage is one child `node …\tsx\dist\cli.mjs <tool>` with the explicit environment; no stage receives a DSN in its arguments):

| # | Stage | Database effect | Gate |
|---|---|---|---|
| 0 | Preflight P1–P9 (hashes, HEAD, psql, DSN derivation, tunnel listener) | none | any failure → exit 2, nothing sent |
| 1 | `tier1-before`: `tools\db\fingerprint-test.ts` | read-only | exit 0 and a 64-hex digest |
| 2 | `tier2-before-1`: `tools\db\fingerprint-tier2.ts --out 02-…json` | read-only | exit 0, `COMPLETE` |
| gates after 2 | Tier 2 #1 embeds the **same Tier 1 digest** as stage 1; identity is `afldb_test` as `afldb_owner` (current and session); **database oid = 45428** (the one procedure A saw) | none | evaluated **before** stage 3 is launched |
| 3 | `tier2-before-2`: same, `03-…json` | read-only | exit 0, `COMPLETE`, and embeds the stage-1 Tier 1 digest |
| 4 | `baseline-stability`: `fingerprint-tier2.ts --compare 02 03` (no database) | none | **MATCH** — proves the harness is deterministic and nothing else is writing (the compare includes the postmaster start time) |
| fail-fast | **The baseline is fail-fast.** Each gate is evaluated as soon as its stage has run; the **first failed gate stops the baseline**: no later baseline stage, no proof, and no after-census is launched. The verdict is `BASELINE FAILED (proof not run)` and says that no state-comparison verdict was established. | | **every gate must pass, else the proof is NOT run** |
| 5 | `prove-reset`: `tools\db\prove-reset.ts` | **real `RESET_SQL`, always aborted** | exit 0, `RESET_SQL PROVEN`, `psql exit : <non-zero>` |
| 6 | `tier1-after`: `fingerprint-test.ts --expect <stage-1 digest>` | read-only | exit 0 (MATCH) — **attempted even if stage 5 failed** |
| 7 | `tier2-after`: `fingerprint-tier2.ts --out 07-…json` | read-only | exit 0, `COMPLETE` — **attempted even if stage 5 failed** |
| 8 | `tier2-compare`: `--compare 02 07` (no database) | none | **MATCH** |
| end | secret scan of every evidence file; `summary.json`, `verdict.txt` | none | no credential form found |

**The child environment.** Removed from every child: `PGHOST`, `PGHOSTADDR`, `PGPORT`, `PGDATABASE`, `PGUSER`, `PGSERVICE`, `PGSERVICEFILE`, `PGSYSCONFDIR`, `PGOPTIONS`, `PGTARGETSESSIONATTRS`, `PGLOADBALANCEHOSTS`, `PGPASSWORD`, `DATABASE_URL`, and every `AFLDB_*DATABASE*|*DSN*|*URL*` variable — including the inherited `AFLDB_TEST_DATABASE_URL` for user `arm` and `AFLDB_TEST_IMPORT_DATABASE_URL`. Set explicitly: `AFLDB_TEST_DATABASE_URL` = the `afldb_owner` DSN for `afldb_test` at `-ExpectHostPort`. `PATH` is prefixed with the psql directory. Everything else (`AFLDB_ENV`, `NODE_*`, `PGSSL*`) is inherited unchanged. The names removed are printed and written to `child-environment.txt`; the inherited DSN is described by **user, host:port and database only**. `prove-reset` additionally removes the libpq routing variables again before it spawns psql, and passes the password to psql through `PGPASSWORD` in psql's own environment, so psql's argument vector is password-free (ISSUE-313).

### 4.1 After-census only (manual continuation; never automatic)

If a run ended with the census not completed (tunnel dropped, lock timeout, stage timeout), once the cause is understood:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File D:\tmp\issue278\run-procedure-B.ps1 -ExpectHostPort 127.0.0.1:55432 -Execute -CensusOnlyBaselineDir D:\tmp\issue278\evidence\run-B-<stamp>
```

It runs stages 6–8 only, against that run's `01-tier1-before.txt` and `02-tier2-before-1.json`, into a new `…-census` directory. It says nothing about whether the proof itself succeeded.

## 5. Expected results

**Preflight:** `PASS` for P1–P9, then `PREFLIGHT PASSED. No database was contacted and nothing was written.`, exit 0. `P9` fails while the tunnel is down.

**Baseline (stages 1–4):** `tier1-before` prints `database : afldb_test`, `role : afldb_owner`, a digest. `tier2-before-N` prints `database`, `role : current_user afldb_owner, session_user afldb_owner`, `server`, `postmaster : started …`, `tier 1 : <the stage-1 digest>`, `scope : <T> table(s), <M> materialized view(s), <S> sequence(s), <D> definition sections, <R> row(s) digested`, `tier 2 overall : <digest>`, `COMPLETE`. The two `tier 2 overall` digests are equal. The gate list is all `PASS`. `INFO postmaster start … equals procedure A (2026-10-10 16:01:11.590541)` is informational: a restart since procedure A is possible and is not a failure, but note it.

**Proof (stage 5):** exit **0**, with, in order (values vary):
```
AFLDB RESET_SQL proof (AFLDB-ISSUE-093 §20)
  mode          : ROLLBACK-ONLY — nothing is committed, nothing is rebuilt
  database      : afldb_test
  role          : current_user afldb_owner, session_user afldb_owner, superuser no
  server        : <addr>:<port> PostgreSQL <version>
  other sessions: 0 (exclusive access)            (or "0 client backends; n tolerated (autovacuum worker)")
  fingerprint   : <the stage-1 digest>
  observer      : closed before psql starts (no session spans the reset)
  psql          : reachable, and answered through the reset's own argv
  psql exit     : 3 (the deliberate abort — this is success)
  post-rollback : <same digest> (identical)
  db comment    : restored to the pre-existing value exactly (P-M point 2 proven)
  post-reset census (inside the aborted transaction):
    application schemas 0 tables 0 views 0 sequences 0 … public schema kept yes
RESET_SQL PROVEN through the real psql path … THIS WAS A ROLLBACK-ONLY PROOF. Nothing was committed. Nothing was rebuilt.
```
`psql exit : <non-zero>` is **correct**; `psql exit 0` is a failure the tool reports. `server : <addr>:<port>` must be the server you intended (`5432` behind the tunnel, as procedure A saw).

**After-census (stages 6–8):** `MATCH — the database is byte-identical, by catalog fingerprint …` (Tier 1) and `MATCH — unchanged observed state …` followed by the line `This does not prove that no sequence operation occurred …` (Tier 2).

**Verdict (last lines, also `verdict.txt` and `summary.json`):** `VERDICT: PASS`, exit 0.

## 6. Failure handling

No stage is retried and nothing is cleaned up, by the runner or by you. Every transcript is kept.

| Outcome | Meaning | Action |
|---|---|---|
| `REFUSED:` at preflight, `No database was contacted` | A pinned hash, HEAD, psql, the `.env` DSN form, or the tunnel failed | Fix the stated cause; re-run. P4 failing means the code is not the code that was reviewed: do not edit the runner to match. |
| `BASELINE FAILED. The proof was NOT run` | The first failed baseline gate stopped the run; nothing after it was launched. This tool changed nothing, but **no after-census was taken, so no state-comparison verdict exists**. | Read the failing gate's transcript. **Tier 2 `INCOMPLETE: <stage> failed: …`** names the stage: `definitions:<id>` / `tier1` / `counts` with a PostgreSQL error is a **harness SQL defect** (first execution against a real server) — report the stage and message; do not patch around it. `identity` with `not 'afldb_owner'` is the wrong DSN. `tables:rls` / `tables:privilege` means the digest would be incomplete. `table:<name>` with a timeout means something holds a lock on it (5 s) or the digest ran past 600 s. |
| baseline gate "the two Tier 2 baselines MATCH" fails | Something else is writing to `afldb_test`, or the harness is not deterministic | **Stop.** Find the writer (settle job, test run, application) before anything else. |
| baseline gate "database oid equals 45428" fails | This is not the database procedure A verified (dropped/recreated, or a different server) | **Stop.** Re-run procedure A (V3) and decide what changed. |
| `prove-reset` `REFUSED:` | A proof gate held (DSN form, target name, identity, exclusivity, superuser). "Nothing was committed." | Fix the stated cause. The after-census still ran; read its verdict. |
| `psql exited 3 … began but failed before its deliberate abort` + an `identity: connected to …` line | The in-stream identity assertion stopped the stream before `RESET_SQL`: the psql session reached a different database/role than the observer | **Stop. Do not rebuild.** Report the line and re-run procedure A (V3). |
| `psql exited 0 …` | Unexpected: the stream did not abort. The commit trap should make a commit impossible. | **Treat the state as UNKNOWN.** The after-census verdict is mandatory evidence; do not rebuild until it MATCHes and the cause is explained. |
| `prove-reset` timeout (stage killed) | The process tree is killed; the connection drop aborts the transaction | The after-census may hit `lock_timeout` while the server finishes the abort. If the census did not complete, wait, then use §4.1. |
| `VERDICT: PROOF FAILED, STATE UNCHANGED` | The proof did not complete as required, but both after-censuses match | Read `05-prove-reset.txt`. **No rebuild** until the cause is explained. |
| `VERDICT: STATE UNKNOWN OR CHANGED` | An after-census mismatched or could not complete | **Do NOT run the rebuild.** The MISMATCH output lists the drifted sections/objects (names and counts only). Establish what changed; restore from backup if needed. If it could not complete, use §4.1 once the cause (tunnel, lock, stray session) is understood. |
| `PASS (BUT THE EVIDENCE CONTAINS A CREDENTIAL)` / `LEAK:` lines | A credential form was found in a named evidence file | Do not share or attach that directory; tell the repository owner which file. |

## 7. Evidence to capture and attach to the closure record

From `run-B-<stamp>\`: `preflight.txt`, `hashes.txt` (the six tool hashes, `psql.exe`, the runner), `git-status.txt`, `child-environment.txt`, the stage transcripts `01…08`, the three Tier 2 JSON files `02`, `03`, `07`, `summary.json`, `verdict.txt`, `secret-scan.txt` (must say `occurrences: 0`). Plus one line: who ran it, when (UTC), `host:port`, and the elapsed seconds of the Tier 2 stage and of `reset stream completed in N ms`. The summary is the quickest read: Tier 1 before/after digests, Tier 2 before/after overall digests, each stage's exit code and duration.

## 8. After the run

`VERDICT: PASS` → record "Procedure B PASS" in runbook §17.3 (done: §17.9) with the run directory name, then proceed to the operator's commit and `merge:ready`. Anything else keeps ISSUE-278 Open and blocks any `db:test:rebuild`.

## 9. Attempt history

**Attempt 1 — 2026-10-13 05:08 UTC, owner-authorised, `run-B-20261013T050801Z` (preserved unchanged; runner exit 1).** Preflight passed; Tier 1 passed (digest `a39ad96b…4cee`, exit 0); `tier2-before-1` exited 2: `INCOMPLETE: definitions:checks failed: operator is not unique: text || "char"`. The old runner then launched `tier2-before-2` (same failure) and the stability compare (refused: not a `COMPLETE` record) and reported `BASELINE FAILED (proof not run)`. **`prove-reset` never started. No after-census was taken, so no state-comparison verdict was established** (the only thing known is that nothing but read-only fingerprint queries ran; the Tier 2 transaction was `READ ONLY` and failed inside it). The postmaster start time and database oid were not recorded (they come from the Tier 2 identity section, which never completed). Secret scan: 0 occurrences in 10 files. The six pinned tool hashes were identical before and after the run.

**Correction (local, no database contact; §17.8 of the runbook).** `co.contype` (twice) and `c.relkind` are `"char"` columns concatenated into `text`; each now has an explicit `::text`. Every other `||` in `fingerprint-tier2.ts` was reviewed by column type (`name`, `text`, `int2`, `int4` operands resolve; only `"char"` is ambiguous). The runner is now fail-fast. Its manifest is `D:\tmp\issue278\manifest-B-attempt2.txt`.

**Attempt 2 — 2026-10-13 05:39 UTC, owner-authorised, one attempt, `run-B-20261013T053946Z` (runner exit 0, `VERDICT: PASS`).** All pins verified first; DEV `/api/health` `ok`; every baseline gate passed (identity `afldb_test` / `afldb_owner`, oid 45428, stable baselines, Tier 1 `a39ad96b…4cee`, Tier 2 overall `4f11fda9…09d9`, 99 tables, 63 sequences, 1,454,440 rows); `prove-reset` exit 0, `RESET_SQL PROVEN`, `psql exit 3`; after-census Tier 1 and Tier 2 MATCH. **Proof verdict: PASS. Unchanged-observed-state verdict: MATCH** (kept separate; not proof that no sequence operation occurred; coverage limits in §2 stand). Postmaster start `2026-10-13 04:51:00.640018+00` identical in all three Tier 2 records; it differs from procedure A's `2026-10-10 16:01:11.590541` because the host rebooted after A (history, not an invalidation). Secret scan 0 in 15 files; executed hashes unchanged afterwards. Full record, evidence hashes and limitations: runbook §17.9.

**Residual after both procedures pass:** the proof's stream embeds `RESET_SQL` and its **own** identity block, not `rebuildIdentityGuardSql`; procedure A is what proves the rebuild's guard text. Embedding the guard in the proof stream too would make B exercise it directly (an option, not done: it would change a stream this audit pins). The Tier 2 harness is new tooling committed with this issue (`tools/db/fingerprint-tier2.ts`, `npm run db:test:fingerprint-tier2`); the runner lives outside the repository like procedure A's harness and is hashed in the evidence.
