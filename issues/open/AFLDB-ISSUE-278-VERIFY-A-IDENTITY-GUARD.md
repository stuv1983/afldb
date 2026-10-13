# AFLDB-ISSUE-278 — Procedure A: read-only verification of the identity guard and the pinned psql path

**Status:** **EXECUTED 2026-10-13 and PASSED (12/12 checks, exit 0; owner-authorised, `afldb_test` only; evidence `D:\tmp\issue278\evidence\run-A-20261013T043012Z\`; runbook §17.6), accepted by the owner without a re-run.** It describes the server run that was current then (postmaster start 2026-10-10 16:01:11.590541); the DEV host was rebooted afterwards (new postmaster 2026-10-13 04:51:00.640018+00; runbook §17.9). That is history, not an invalidation: Procedure B re-ties the two by database oid 45428. Originally: prepared 2026-10-13. Operator-run. Companion: `AFLDB-ISSUE-278-VERIFY-B-RESET-PROOF.md` (separate, run second).

## 1. What this procedure does to the database

**Nothing durable. It creates, alters, drops and writes no object.** Every statement it sends is a read-only `DO` block or `SELECT` over session functions (`current_database()`, `current_user`, `session_user`, `pg_postmaster_start_time()`, the current database's `oid`, `inet_server_port()`).

| It does | It does not |
|---|---|
| Open 1 postgres.js connection (closed before any psql starts) and 3–4 short psql connections to **`afldb_test`** | Run `RESET_SQL`, a rebuild, a migration, an import, `prove-reset` or promotion |
| Run the new identity guard once expecting success (V1) and once expecting a deliberate refusal (V2) | Write a row, a comment, a temp table or a sequence value |
| Optionally (`--with-unpinned-control`) make **one** deliberately failing connection attempt to `192.0.2.1` (TEST-NET-1, non-routable, dropped by the network) with a 3 s timeout, to prove the control discriminates | Contact `afldb_dev`, `afldb_prod`, `code_test_db`, or any host other than the one you name |

It does consume a few backend sessions and writes nothing but ordinary connection log lines on the server. psql runs through the **same pinned path** as the rebuild (`runPsql(..., { pinned: true })`: libpq routing variables removed from the child environment, `-X`, password via `PGPASSWORD` only).

## 2. What it proves, and what it cannot

- **Proves:** (V1) the guard text parses and passes under PostgreSQL on the intended target, as `afldb_owner`; (V2) it raises, naming both databases, when asked for a different target (a guard that cannot refuse proves nothing); (V3) the postgres.js observer and the pinned psql child reach the **same server and database** (same postmaster start time, database oid, server port); (V4) an ambient `PGHOSTADDR` does not move the pinned psql; (V4c) the same ambient value **does** break an unpinned psql.
- **Cannot prove:** the `current_user` / `session_user` refusal branches (no second role is available to provoke them; they are string-pinned by tests and mirror `prove-reset`'s block); that the guard works in front of the **reset** stream (that is procedure B's job and the reason B is separate); anything about `code_test_db` (V2 only borrows its *name*).

## 3. Preconditions (target checks — do them before running)

1. **The code is the code you reviewed.** In `D:\dev\afldb-issue-278`: `git status --short --branch` and `git rev-parse HEAD`. The script records HEAD, the status, and the sha256 of `tools/db/rebuild-test.ts`, `tools/db/psql.ts`, `tools/db/prove-reset.ts` in the evidence file. Do not edit any file between review and this run.
2. **You know which server you intend to reach.** Decide the `host:port` first (for the workstation tunnel this has been `localhost:55432`; on the DEV host `localhost:5432`). The script **refuses to proceed** unless the DSN's `host:port` equals `--expect-hostport`. Do not copy the value out of the DSN.
3. **Tunnel / host up, `afldb_test` is the target.** For a tunnel, confirm the listener is yours (`Test-NetConnection localhost -Port 55432`). Confirm you are not pointed at `afldb_dev` or `afldb_prod` (they are refused by name, but check the host anyway).
4. **Credential.** `AFLDB_TEST_DATABASE_URL` must be the `afldb_owner` DSN naming `afldb_test`, in the form `postgresql://afldb_owner:<pw>@<host>:<port>/afldb_test` — lower-case scheme, literal host, explicit port, **no query parameters in `dbname|host|hostaddr|port|service|user|options`** (the runner now refuses these; see `docs/deployment.md` §6a). Set it in your shell only; do not put it in a file the script will print.
5. **Note ambient `PG*` variables** (informational — the pinned path ignores them): `Get-ChildItem Env: | Where-Object Name -Match '^PG'`. The script prints the **names** that are set.
6. Optional but recommended: no integration tests or other jobs are using `afldb_test` (procedure A does not need exclusivity; procedure B does).

## 4. Run

```powershell
cd D:\dev\afldb-issue-278
$dir = "D:\tmp\issue278\evidence\run-A-$((Get-Date).ToUniversalTime().ToString('yyyyMMddTHHmmssZ'))"
New-Item -ItemType Directory -Force $dir | Out-Null
$env:AFLDB_TEST_DATABASE_URL = '<afldb_owner DSN for afldb_test>'      # your shell only; overrides any inherited value
$env:PATH = 'C:\Program Files\PostgreSQL\16\bin;' + $env:PATH           # only if psql is not already on PATH
$p = Start-Process node -NoNewWindow -Wait -PassThru -ArgumentList @('node_modules\tsx\dist\cli.mjs',
       'D:\tmp\issue278\verify-identity-guard.ts','--expect-hostport','127.0.0.1:55432','--evidence-dir',$dir) `
       -RedirectStandardOutput "$dir\stdout.txt" -RedirectStandardError "$dir\stderr.txt"
$p.ExitCode | Set-Content "$dir\exit-status.txt"
Remove-Item Env:AFLDB_TEST_DATABASE_URL
```
(Add `'--with-unpinned-control'` to the argument list only if you want the optional control.) The harness **stops at the first failed check** and writes `verify-A-evidence.json` into `--evidence-dir`. It records its own sha256 and the psql version.

**Pre-run record (recommended):** before the run, save `git rev-parse HEAD`, `git status --short`, and `Get-FileHash` of the changed files, the harness, this file and `psql.exe` next to the evidence; compare again afterwards.

**Ambient trap:** a shell may already carry an `AFLDB_TEST_DATABASE_URL` for a different role (the 13 Oct tool shell had one for user `arm`). Set the variable explicitly as above; T1 refuses a user other than `afldb_owner`. `prove-reset` and `fingerprint` only read `.env` when the variable is **unset**, so an inherited value silently wins there.

(Use `127.0.0.1`, not `localhost`, as the tunnel host: it avoids an IPv4/IPv6 resolution difference between libpq and Node.)

(In Windows PowerShell 5.1, `2>&1` on a native command decorates stderr lines as `NativeCommandError`; that is cosmetic and the content is intact. PowerShell 7 does not do this.)

Drop `--with-unpinned-control` if you do not want the single failing attempt to `192.0.2.1`. Without it, V4c is reported as skipped (that leaves V4 without its discriminating control; say so in the closure record).

## 5. Expected results

| Check | Expected | If not |
|---|---|---|
| T0 | prints HEAD and path count | — |
| V0 (each DSN variable set) | `PASS … accepted by assertDsnPinsTarget` | the message names the variable and the rule; fix the DSN form (no DSN is printed) |
| T1 ×3 | database `afldb_test`, user `afldb_owner`, `host:port` equals `--expect-hostport` | **stop**: nothing was sent. Wrong target or wrong intention. |
| T2 | lists ambient routing variable **names**; `PASS … pinned child environment carries none of them` | a FAIL here is a code defect; stop and report |
| V1 | `exit 0`; stderr line `AFLDB-REBUILD-IDENTITY database=afldb_test current_user=afldb_owner session_user=afldb_owner` | a syntax error means the guard text is wrong; a `connected to database …` refusal means the DSN reaches a different database than T1 said — **stop and investigate before any rebuild** |
| V2 | non-zero exit; `AFLDB-REBUILD-IDENTITY connected to database afldb_test, not code_test_db` | exit 0 means the guard cannot refuse: **defect, do not rebuild** |
| V3 | observer and psql report identical `start`, `dboid`, `port` | a difference means the two stacks reached different servers: **stop; do not rebuild** |
| V4 | exit 0 and the identity line, with `PGHOSTADDR=192.0.2.1` set in the script's own process | failure means the pinned path did not shield psql: defect |
| V4c (optional) | non-zero exit (connection failure/timeout) | exit 0 means the control is not discriminating on this host: V4 proves nothing there; record that |
| Final line | `ALL PASS   evidence: <dir>/verify-A-evidence.json`, process exit 0 | `INCOMPLETE …` or `N CHECK(S) FAILED`, exit non-zero (the run stopped at the first failure; later checks were not run) |

## 6. Evidence to capture and attach to the closure record

1. `<dir>\verify-A-evidence.json` (HEAD, status, file hashes, harness hash, psql version, host/port/database/user **without password**, ambient variable names, parity values, every check). It contains no DSN.
2. `<dir>\stdout.txt`, `stderr.txt`, `exit-status.txt`, plus the pre/post hash and git records. Confirm before sharing: `Select-String -Path <dir>\* -SimpleMatch -Pattern '<the password>'` returns nothing. (Redirected stdout shows the em dash as `â€”` when re-read in the wrong code page; cosmetic.)
3. One line: who ran it, when (UTC), which shell, and the `--expect-hostport` used.

## 7. After the run

- All pass → proceed to procedure B. Record "Procedure A PASS" in runbook §17.3 with the evidence file name.
- Any FAIL/INCOMPLETE → do **not** run procedure B or any `db:test:rebuild`. Keep ISSUE-278 Open and report the failing check id with its evidence file.
- The script holds no state; re-running is safe and read-only.
