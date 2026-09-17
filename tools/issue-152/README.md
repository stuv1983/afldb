# AFLDB-ISSUE-152 Phase G runners

Reusable PowerShell entry points for Phase G rendered acceptance, so the run is
described once here instead of being reassembled from long environment-variable
command blocks each time.

Everything is derived: the repository root comes from the scripts' own location,
the `afldb_test` DSNs come from the existing `.env`, and the sweep corpora are
regenerated from the tracked corpora under `tests/nl-ui/corpora/`. No path in
this directory is hard-coded to a worktree, a temporary directory or a scratch
directory, and no script prints a password, kills a process, writes to git, or
deploys.

## Three-window workflow

**Window 1 — the PostgreSQL tunnel**

```powershell
.\tools\issue-152\phase-g-tunnel.ps1
```

**Window 2 — the server under test**

```powershell
.\tools\issue-152\phase-g-server.ps1
```

**Window 3 — verification, then the sweeps**

```powershell
.\tools\issue-152\phase-g-verify.ps1        # static; safe any time
.\tools\issue-152\phase-g-smoke.ps1 -RunTag issue152-phaseg-smoke-r2
.\tools\issue-152\phase-g-new-corpus.ps1    # P3: the pinned Phase G 271
.\tools\issue-152\phase-d-corpus.ps1       # P5: the current 319 (271 + Phase D 48)
.\tools\issue-152\phase-g-regression.ps1    # P4: the existing 1,495 gate
.\tools\issue-152\phase-g-status.ps1        # read-only, any time
.\tools\issue-152\phase-g-diagnose.ps1      # read-only, when the server 500s
```

Window 1 is not optional and is not folklore. There is no PostgreSQL server on
this workstation: every Phase G DSN reaches the database through
`127.0.0.1:55432`, an SSH forward. Without it the server still starts, still
serves its 1,472 prerendered routes with HTTP 200, and answers every
force-dynamic page with a 500 whose only explanation — `connect ECONNREFUSED
127.0.0.1:55432` — is in the server's own stderr. `phase-g-server.ps1` now
refuses to start in that state; `phase-g-status.ps1` and `phase-g-diagnose.ps1`
both report the forward.

## When the server returns 500

A rendered 500 explains itself **only** in the window-1 process's stderr: the
sweep records `http_error` plus the browser console line and nothing more. So
window 1 tees everything it prints to a per-run log:

```
nl-ui-out-152-phaseg/server/server-<yyyyMMdd-HHmmss>.log
```

One file per run, never overwritten, never deleted, gitignored, and containing
no credential — the header carries only redacted DSNs, and the rest is whatever
the server itself printed. Then, from window 2:

```powershell
.\tools\issue-152\phase-g-diagnose.ps1
```

It names the process on port 3100 (PID **and** command line, so a cluster
worker or a `next dev` cannot be mistaken for the standalone build), issues
three GETs — `/`, `/search` with no query, and one coaching question — prints
their statuses, and prints exactly the log lines those three requests produced.

The three probes bisect the fault rather than measuring semantics. `/` is a
build-time prerender, so a 200 there proves the process and the bundle and
nothing about the database. `/search` with no query runs `getSiteSettings()`
alone — no parser, no planner, no new-family tables — so a 500 there is
upstream of every NL question. Only the third probe involves the pipeline.

## Read-only SQL evidence against `afldb_test`

Window 1's tunnel is also what a SQL evidence pack needs, so the same helpers
run one:

```powershell
.\tools\issue-152\phase-d-evidence.ps1            # the real run
.\tools\issue-152\phase-d-evidence.ps1 -DryRun    # parse + plan only, no connection
```

**There is no psql on this workstation and none is needed.** The PowerShell
script derives the `afldb_test` DSN from `.env` (host, port, role and password
from `DATABASE_URL`; only the database segment is replaced), requires the
forward to be up, hands the DSN over in the *environment* rather than argv, and
`tools/issue-152/phase-d-evidence.ts` executes the pack over the repository's
own PostgreSQL runtime — `postgres.js`, the dependency every `tools/db` script
already uses. Nothing new was added to `package.json`.

The evidence scripts are psql scripts and run **unmodified**. `\echo`,
`\pset null` and `\timing` are interpreted by the executor; every other
backslash command is a hard refusal rather than a skip, because a silently
skipped `\c` (a second connection, past the guard), `\i` (unseen SQL) or `\copy`
is exactly the hole worth closing. `-DryRun` prints the parsed execution plan —
one line per statement with its source line — so a swallowed meta-command or a
statement split in the wrong place is visible before anything runs.

The target is proven, not trusted, and proven on the connection the evidence
runs on: one reserved connection for the whole run, `current_database()`
asserted in JS *and* by a server-side `DO` block that raises, and
`pg_backend_pid()` checked before the first statement, on every result as it
arrives, and again at the end. That guard exists because Phase D's first pass
was executed against `afldb_dev` by accident and produced entirely plausible
rows; `afldb_dev` lags the canonical rebuild, so none of them were admissible.
A separate probe connection could not have prevented it.

Read-only three ways: the session runs `default_transaction_read_only=on` and
that setting is read back and asserted, the pack itself is a `BEGIN TRANSACTION
READ ONLY … ROLLBACK`, and any statement that would undo either is refused
statically before a connection is opened. `-Database` must end in `_test`. The
transcript is UTF-8 without a BOM (a plain `>` redirect under Windows PowerShell
5.1 writes UTF-16, which is why `ISSUE-152-nl-evidence-output.txt` greps as
mojibake) and is never overwritten.

The default role is `afldb_app`, not an owner: it is the role the query builders
will run as, and app read has been fail-closed since migration 039, so a missing
grant is a result worth seeing. `-EnvKey AFLDB_OWNER_DATABASE_URL` separates
"no rows" from "no grant" once that has been recorded.

## The two run-tag variables

Both names have been used interchangeably in this workflow. They are different
variables, in different processes, doing different jobs, and a run needs both.

| Variable | Side | Set by | Meaning |
|---|---|---|---|
| `AFLDB_NL_RUN_TAG` | **server** | `phase-g-server.ps1` | A **gate**, not a label. The only accepted value is the literal `accept` (`src/lib/nl-run-tag.ts`, `nlRunTagAccepted`). Without it `/search` ignores the sweep's header entirely and every row logs as real reader traffic with `run_tag` NULL. |
| `NL_UI_RUN_TAG` | **client** | the sweep scripts | The **label** itself. Sent by Playwright as the `x-afldb-run-tag` request header (`tests/nl-ui/nl-stress.spec.ts`), validated server-side against a 1–64 character slug, and written to `nl_search_log.run_tag` (migration 051). |

So the telemetry check is only meaningful when the server was started with the
gate open **and** the sweep sent a label:

```sql
SELECT run_tag, count(*)
  FROM nl_search_log
 WHERE run_tag LIKE 'issue152-phaseg%'
 GROUP BY run_tag ORDER BY run_tag;
```

Default tags: `issue152-phaseg-smoke` (40), `issue152-phaseg-p3` (271),
`issue152-phaseg-p4` (1,495). **A count below the corpus size means requests
were throttled or the header was rejected — not that questions were declined.**

The smoke run is tagged `issue152-phaseg-smoke-r2` from now on. **r1 is
inadmissible**: it ran with no PostgreSQL tunnel, so all 40 rows were HTTP 500
(`connect ECONNREFUSED 127.0.0.1:55432`) and it wrote no `nl_search_log` rows
at all. Its pacing result — 0 rate-limit detections — is the only thing it
established. No semantic conclusion may be drawn from r1.

## Why the pacing exists

`/search` enforces 30 requests per 60 seconds per IP **per process**
(`src/app/search/rate-limit.ts`, AFLDB-ISSUE-120). A throttled request renders
"Too many searches" without calling `globalSearch()` and without writing an
`nl_search_log` row — and that page is byte-for-byte what a correct decline
looks like to the harness. Phase G attempt 1 spent the entire budget in 26
seconds and reported 240 throttled loads as semantics (ISSUE-152 §19.2).

Every sweep here therefore runs at `NL_UI_REQUEST_DELAY_MS=2200` with
`NL_UI_WORKERS=1`: at most `floor(60000/2200)+1 = 28` navigations in any
60-second window, against a limit of 30. Pacing is **per worker**, so the
runners refuse more than one worker rather than letting the margin disappear
silently.

The rate limiter is never relaxed, disabled, spoofed or worked around, and no
forwarded-header or IP trickery is used.

## Files

| File | Role |
|---|---|
| `phase-g-tunnel.ps1` | Window 1. Holds `ssh -N -o ExitOnForwardFailure=yes -L 127.0.0.1:55432:127.0.0.1:5432 arm@10.0.40.100` in the foreground. Local port read from `.env`; no credential read, printed or stored; an occupied port is reported by PID and left alone. |
| `phase-g-common.ps1` | Shared helpers: repo/`.env` resolution, DSN derivation and redaction, port owner lookup, corpus build, scoped environment, summary gates. Dot-sourced, never run directly. |
| `phase-g-server.ps1` | Window 1. Starts `node .next/standalone/server.js` (the supported `output: standalone` runtime — not `npx next start`) on port 3100 against `afldb_test`, with `AFLDB_NL_RUN_TAG=accept`. Shows the server's output live and tees it to `nl-ui-out-152-phaseg/server/`. |
| `phase-g-diagnose.ps1` | Read-only fault triage: identifies the process on port 3100 by command line, probes `/`, `/search` and one coaching question, prints the statuses, and prints the server-log lines those probes produced. Starts, stops and kills nothing; touches no database. |
| `phase-g-smoke.ps1` | 40 paced rows. Gates transport only: observed count, zero rate-limit detections, zero `page_error`, zero `http_error`. **Smoke evidence, not acceptance.** |
| `phase-g-new-corpus.ps1` | Phase G P3. The full 271 (212 plan / 59 decline), with the transport gates plus zero semantic failures, zero unscored rows and zero filler disagreements. |
| `phase-d-corpus.ps1` | Phase D acceptance (P5). The CURRENT 319 (238 plan / 81 decline) = the pinned Phase G 271 plus the two additive relationship corpora, same gates and same 2,200 ms / one-worker pacing, its own run tag (`issue152-phased-p5`) and its own `-OutName`. Refuses a corpus that is not 319/238/81 or that does not slice into 4 Playwright batches, and refuses the P3/P4 run tags. Does **not** redefine Phase G: `phase-g-new-corpus.ps1` still runs exactly the accepted 271. |
| `phase-g-regression.ps1` | Phase G P4. The unchanged 1,435 + 60 gate, same pacing guarantees, with `-Resume` (`NL_UI_APPEND=1`) for an interrupted run. |
| `phase-g-verify.ps1` | Static only: `tsc --noEmit`, `vitest tests/nl-ui-corpus.test.ts`, corpus build, `playwright --list`, and proof that `NL_UI_REQUEST_DELAY_MS=2.2s` is rejected while `2200` is accepted. No server, no navigation. |
| `phase-g-status.ps1` | Read-only: branch/HEAD, port 3100 owner, standalone build, corpus counts, preserved runs, redacted environment. |
| `phase-d-evidence.ps1` | Operator entry point for a read-only SQL evidence run against `afldb_test`: derived DSN (passed in the environment, never argv), tunnel precondition, `_test`-only target, UTF-8 transcript under `evidence/`, `-DryRun` for a static check. Starts no server, writes nothing to the database or git. |
| `phase-d-evidence.ts` | The executor. Runs a psql script unmodified over `postgres.js` on one reserved connection: interprets `\echo` / `\pset null` / `\timing`, refuses every other meta-command, asserts `current_database()` in JS and in a server-side `DO`, checks the backend pid on every result, and holds the session in `default_transaction_read_only`. No new dependency. |
| `build-phase-g-corpora.ts` | Merges the tracked corpora into the three sweep corpora (`new` 271, `current` 319, `regression` 1,495), in a fixed order, asserting the row/plan/decline counts and re-reading the result through `readUiCorpus`. The `current` set APPENDS to `new`: its first 271 rows are byte-for-byte the 271-row file, which is what keeps section 19.3's position-based statements checkable. Sizes are pinned a second time, independently, in `tests/nl-ui-corpus.test.ts`. |

## Generated locations

All gitignored (`nl-ui-out-*/`), all inside the repository:

```
nl-ui-out-152-phaseg/corpora/phase-g-new-family-271.csv
nl-ui-out-152-phaseg/corpora/phase-d-current-new-family-319.csv
nl-ui-out-152-phaseg/corpora/phase-g-regression-1495.csv
nl-ui-out-152-phaseg/smoke/            preserved smoke run + run-manifest.json
nl-ui-out-152-phaseg/p3-new-family/    preserved P3 run
nl-ui-out-152-phaseg/p4-regression/    preserved P4 run
nl-ui-out-152-phaseg/p5-phase-d-current/  preserved Phase D acceptance run
nl-ui-out-152-phaseg/server/           one stdout+stderr log per window-1 run
nl-ui-out-152-phaseg/evidence/         one psql transcript per evidence run
```

`nl-ui-out/` remains the harness's live working directory and is cleared at the
start of every non-resumed run; the preserved copies are what evidence should
cite. `nl-ui-out-152-new/` is attempt 1's inadmissible run and is left alone.

**Preserved output is never overwritten.** An `-OutName` is claimed exactly
once: if `nl-ui-out-152-phaseg/<OutName>/` already exists the runner refuses
before the sweep starts, names the existing path and stops. Nothing is deleted,
rotated or merged into. A repeat run takes an explicit new name — e.g.
`-OutName p3-new-family-r2` — and moving an old directory aside is the
operator's decision, never the harness's. The contract is covered by
`tests/phase-g-preserve-static.test.ps1`:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\tests\phase-g-preserve-static.test.ps1
```

## Prerequisites

- A production build of this branch: `npm run build` (Phase G P1).
- `tests/nl-ui/.auth/state.json` — required by the `nl-stress` project even
  with the beta gate off; it carries only `afldb_consent=declined`.
- `afldb_test` reachable on the DSN host in `.env` **through window 1's
  tunnel** (`.\tools\issue-152\phase-g-tunnel.ps1`). This workstation has no
  local PostgreSQL server; `127.0.0.1:55432` is the forward, not a database.
- `ssh.exe` on PATH, with the operator's own key or agent already usable
  against the database host. No credential is stored anywhere in this
  directory.
