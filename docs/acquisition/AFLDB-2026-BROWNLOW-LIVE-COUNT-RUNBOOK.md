# AFLDB-2026 Brownlow live-count operator runbook (`AFLDB-ISSUE-228` §10/S7/S8)

**Status: manual, operator-run, real-event evidence gathering. Nothing in this
document authorises a DEV or PROD deployment.** It exists solely to run the
already-implemented, already-reviewed S7 Brownlow settle by hand tonight, once,
against the real AFL.com.au feed, targeting `afldb_test` only.

## 0. What each name below actually means — read this before running anything

| Term | What it is | What it is NOT |
|---|---|---|
| **Real AFL public feed** | `aflapi.afl.com.au` / `api.afl.com.au/cfs` `bfawards/*`, the actual live Brownlow count, reachable over the open internet with no operator credential | Not a AFLDB-controlled system; AFLDB has no write access to it and cannot affect the count |
| **Local ISSUE-228 tooling** | `tools/current-season/acquire-afl-api-brownlow.ts` / `settle-afl-api-brownlow.ts`, run from this workstation/worktree | Not a server process; nothing scheduled runs it automatically tonight (§10 default-disabled, §"Operational enablement") |
| **`afldb_test` acceptance database** | The disposable integration database this runbook targets exclusively | Not DEV, not PROD. A row written here proves the pipeline works; it changes nothing any real user of the site can see |
| **Later DEV deployment** | `deploy/afldb-settle-afl-api-brownlow.{service,timer}` installed on the DEV host | **Not done by this runbook.** Those files exist (`AFLDB-ISSUE-228` S8) but are not installed, enabled or started by anything here |
| **Later PROD deployment** | The same units on the production host, after DEV validation (S9) and operator sign-off | **Not done by this runbook, and not close to being authorised by it.** Running tonight's real-feed capture does not imply, request or perform a production write of any kind |

Running this runbook against the real feed does **not** write to DEV or PROD.
The only database credential this runbook ever uses is the `afldb_test`
integration DSN.

## 1. Before you start

- This is a **manual, one-off, real-event capture**: the 2026 Brownlow count is
  imminent (Grand Final week) and does not repeat. The purpose is to prove the
  already-implemented S7 pipeline against the real feed, and to capture raw
  timestamped snapshots for the still-open §9.9 assertion-9 evidence gap
  (`issues/closed/AFLDB-ISSUE-228.md` §9, §19.5) — see that runbook for what
  "assertion 9" means; this document does not re-derive it. **Tonight's real
  Brownlow captures, however clean, do NOT close assertion 9 / the
  `monitor-CD_M20260142801` follow-up** — keep those two facts separate; this
  runbook does not imply otherwise anywhere below.
- Do **not** enable `afldb-settle-afl-api-brownlow.timer` or `.service`
  tonight. This is a foreground, watched, manual run.
- **Known blocker, fixed by §2 below:** `tools/current-season/settle-afl-api.ts`
  and `tools/current-season/settle-afl-api-brownlow.ts` both open their
  database connection from `AFLDB_IMPORT_DATABASE_URL`
  (`process.env.AFLDB_IMPORT_DATABASE_URL` — see each file's
  `createImportClient()`), **not** from `AFLDB_TEST_DATABASE_URL` or
  `AFLDB_TEST_IMPORT_DATABASE_URL`. Verifying only the `AFLDB_TEST_*`
  variables does **not** prove tonight's `--apply` path targets `afldb_test` —
  §2 below adds the positive guard that actually covers the variable the CLIs
  read.
- The Brownlow settle CLI itself refuses to do anything past `--validate-only`
  unless `AFLDB_AFL_API_BROWNLOW_ENABLED=true` is set for THIS shell session
  only (§10 "Operational enablement"). Do not add it to the repository's
  tracked `.env` — export it in the terminal you are running this from, for
  tonight, and unset it afterwards. `--validate-only` itself does not check
  this variable (it returns before the check); `--observe-only`, `--dry-run`
  and `--apply` all do, as does the Brownlow acquisition CLI.
- Rehearse against the local Brownlow simulator
  (`AFLDB_AFL_API_CFS_BASE_URL=http://127.0.0.1:22880`) in both
  `--observe-only` and apply mode BEFORE pointing at the real feed, if that
  has not already been done this session (§10). Before the real-feed run,
  clear that override and the other two base-URL overrides — §2 below adds an
  explicit clear-and-verify step for this; do not rely on remembering to
  unset the shell variable by hand.

## 2. PowerShell environment + database-target preflight

This reuses the established "verify without ever printing the DSN" guard
(`tools/rebuild/draftguru/s74-rollback-exercise.ps1`'s `Assert-Dsn` /
`Invoke-ReadOnlySql` pattern), adapted to this runbook's control-plus-writer
binding. It
does **not** invent a new database check: same shape, same `psql -X -At`
read-only probe, same "value never logged" contract.

Dynamic environment-variable lookups below use
`[Environment]::GetEnvironmentVariable($name)` — **never** `$env:$name` or
`$env:$v` (that syntax does not do variable-name interpolation in PowerShell;
it looks up a literal environment variable named `$v`/`$name` and returns
nothing). `$env:NAME` is correct only when `NAME` is written out literally at
the call site, not held in another variable.

```powershell
# --- AFLDB-ISSUE-228 §10 live Brownlow count preflight ---------------------
$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

$RepoRoot = (Resolve-Path (Join-Path $PSScriptRoot '.')).Path   # run from the repo root
$PgBin    = 'C:\Program Files\PostgreSQL\16\bin'
$PsqlExe  = Join-Path $PgBin 'psql.exe'
$ExpectedDatabase = 'afldb_test'

function Test-RequiredEnvVar {
  param([Parameter(Mandatory)][string] $Name)
  # Correct dynamic lookup — see the note above on why $env:$Name is wrong.
  $value = [Environment]::GetEnvironmentVariable($Name, 'Process')
  if ([string]::IsNullOrWhiteSpace($value)) {
    throw "REFUSED: $Name is not set in this shell session."
  }
  return $value
}

function Invoke-ReadOnlySql {
  # One -At SELECT through psql with the server-side session forced
  # read-only. Never receives, prints or returns the DSN itself — only the
  # query result.
  param([Parameter(Mandatory)][string] $Dsn, [Parameter(Mandatory)][string] $Sql)
  $previous = $env:PGOPTIONS
  try {
    $env:PGOPTIONS = '-c default_transaction_read_only=on'
    $out = & $PsqlExe -X -At -F '|' -v ON_ERROR_STOP=1 -c $Sql -d $Dsn
    if ($LASTEXITCODE -ne 0) { throw "REFUSED: psql read-only probe failed (exit $LASTEXITCODE)" }
    return $out
  } finally {
    $env:PGOPTIONS = $previous
  }
}

Write-Host "==> 1. Required environment variables (values never printed)"
$null = Test-RequiredEnvVar -Name 'AFLDB_TEST_DATABASE_URL'
$null = Test-RequiredEnvVar -Name 'AFLDB_TEST_IMPORT_DATABASE_URL'
$brownlowEnabled = [Environment]::GetEnvironmentVariable('AFLDB_AFL_API_BROWNLOW_ENABLED', 'Process')
if ($brownlowEnabled -ne 'true') {
  throw "REFUSED: AFLDB_AFL_API_BROWNLOW_ENABLED is not exactly 'true' in this shell (§10). " +
        "Set it for THIS session only before running the real-feed settle."
}
Write-Host "    AFLDB_TEST_DATABASE_URL, AFLDB_TEST_IMPORT_DATABASE_URL set; Brownlow settle enabled for this session"

Write-Host "==> 2. Fail-safe database-target check — afldb_test only"
$testDsn = [Environment]::GetEnvironmentVariable('AFLDB_TEST_DATABASE_URL', 'Process')
$importDsn = [Environment]::GetEnvironmentVariable('AFLDB_TEST_IMPORT_DATABASE_URL', 'Process')
$testProbe = (Invoke-ReadOnlySql -Dsn $testDsn -Sql 'SELECT current_database();' | Select-Object -First 1)
if ($testProbe -ne $ExpectedDatabase) {
  throw "REFUSED: AFLDB_TEST_DATABASE_URL's current_database() is '$testProbe', not '$ExpectedDatabase'. " +
        "This runbook targets afldb_test ONLY — refusing to proceed against anything else."
}
$importProbe = (Invoke-ReadOnlySql -Dsn $importDsn -Sql 'SELECT current_database();' | Select-Object -First 1)
if ($importProbe -ne $ExpectedDatabase) {
  throw "REFUSED: AFLDB_TEST_IMPORT_DATABASE_URL's current_database() is '$importProbe', not '$ExpectedDatabase'."
}
Write-Host "    both DSNs verified: current_database() = $ExpectedDatabase (values never printed)"

Write-Host "==> 3. Positive control + write-target guard — bind AND verify both variables the settle CLIs actually read"
# tools/current-season/settle-afl-api.ts and settle-afl-api-brownlow.ts read
# their control gate through `process.env.DATABASE_URL` and open their
# canonical writer through `process.env.AFLDB_IMPORT_DATABASE_URL`. Neither
# reads AFLDB_TEST_DATABASE_URL or AFLDB_TEST_IMPORT_DATABASE_URL directly.
# §1-2 prove those test DSNs name afldb_test; this step process-locally binds
# both variables the CLIs actually use, then independently re-proves each
# live database name rather than trusting either assignment.
$requiredControlDsn = Test-RequiredEnvVar -Name 'AFLDB_TEST_DATABASE_URL'
$requiredImportDsn = Test-RequiredEnvVar -Name 'AFLDB_TEST_IMPORT_DATABASE_URL'
$env:DATABASE_URL = $requiredControlDsn
$env:AFLDB_IMPORT_DATABASE_URL = $requiredImportDsn
$controlProbe = (Invoke-ReadOnlySql -Dsn ([Environment]::GetEnvironmentVariable('DATABASE_URL', 'Process')) -Sql 'SELECT current_database();' | Select-Object -First 1)
if ($controlProbe -ne $ExpectedDatabase) {
  throw "REFUSED: DATABASE_URL's current_database() is '$controlProbe', not '$ExpectedDatabase'. " +
        "settle-afl-api.ts / settle-afl-api-brownlow.ts would read the ingestion gate there — refusing to proceed."
}
$boundProbe = (Invoke-ReadOnlySql -Dsn ([Environment]::GetEnvironmentVariable('AFLDB_IMPORT_DATABASE_URL', 'Process')) -Sql 'SELECT current_database();' | Select-Object -First 1)
if ($boundProbe -ne $ExpectedDatabase) {
  throw "REFUSED: AFLDB_IMPORT_DATABASE_URL's current_database() is '$boundProbe', not '$ExpectedDatabase'. " +
        "settle-afl-api.ts / settle-afl-api-brownlow.ts would write there — refusing to proceed."
}
Write-Host "    DATABASE_URL control DB and AFLDB_IMPORT_DATABASE_URL writer DB both independently re-verified as afldb_test"
Write-Host "    (process-local only: NOT written to .env; no DEV/PROD deployment happens as a result of this)"

Write-Host "==> 4. Real-feed override clearing — remove any simulator base-URL overrides for THIS shell"
# §1's rehearsal step points AFLDB_AFL_API_CFS_BASE_URL at the local
# simulator (http://127.0.0.1:22880). Before the real-feed run, all three
# base-URL overrides must be absent so the client falls back to its
# DEFAULT_AFL_API_BASES (the real aflapi.afl.com.au / api.afl.com.au/cfs
# hosts) — src/lib/acquisition/afl-api-client.ts.
Remove-Item Env:\AFLDB_AFL_API_BASE_URL -ErrorAction SilentlyContinue
Remove-Item Env:\AFLDB_AFL_API_CFS_BASE_URL -ErrorAction SilentlyContinue
Remove-Item Env:\AFLDB_AFL_API_SAPI_BASE_URL -ErrorAction SilentlyContinue
foreach ($overrideName in @('AFLDB_AFL_API_BASE_URL', 'AFLDB_AFL_API_CFS_BASE_URL', 'AFLDB_AFL_API_SAPI_BASE_URL')) {
  $remaining = [Environment]::GetEnvironmentVariable($overrideName, 'Process')
  if (-not [string]::IsNullOrEmpty($remaining)) {
    throw "REFUSED: $overrideName is still set to a non-empty value after Remove-Item. Real-feed acquisition must not run against a simulator override."
  }
}
Write-Host "    all three AFL API base-URL overrides confirmed absent — real public feed will be used"
Write-Host "    (Brownlow acquisition itself hits the real CFS endpoint and obtains its WMCTok at runtime;"
Write-Host "     no operator token is entered or printed anywhere in this runbook)"

Write-Host "==> Preflight PASSED. Proceed to §3 below."
```

If any check throws, **stop** — do not proceed to §3. A failure here means
either the session is not configured for tonight's run, a DSN in this shell
resolves somewhere other than `afldb_test`, or a leftover simulator override
would silently point the real-feed acquisition at localhost — each is exactly
the mistake this preflight exists to catch before any acquisition or settle
command runs.

**Step 3 is process-local for this shell only.** Do not add
`DATABASE_URL=...` or `AFLDB_IMPORT_DATABASE_URL=...` to the repository's tracked `.env`. These
process-local bindings are acceptance-only, prove both the control and write paths for tonight's manual
run, and has no bearing on — and does not perform — any DEV or PROD
deployment (see §0's table above).

## 3. Operator commands, in order

Run these from the repository root, in the same shell §2's preflight passed
in (`AFLDB_AFL_API_BROWNLOW_ENABLED=true` and the §2-step-3
`DATABASE_URL` / `AFLDB_IMPORT_DATABASE_URL` guards must both still hold). Substitute the season
and whatever label each acquire step actually prints — do not guess a label.

### 3.1 Safety banner — read this before running anything below

```text
  REAL AFL FEED  +  LOCAL ISSUE-228 TOOLING  +  AFLDB_TEST DATABASE ONLY

  This is NOT a DEV deployment.  This is NOT a PROD deployment.
```

Everything from here down talks to the real `aflapi.afl.com.au` /
`api.afl.com.au/cfs` feed over the open internet, and writes only to the
`afldb_test` acceptance database via the process-local
`DATABASE_URL` control binding and `AFLDB_IMPORT_DATABASE_URL` writer binding §2 proved. See §0's table if any of those
three terms is unclear before proceeding.

### 3.2 2026 match-family prerequisite (match observations; NOT a complete `staging.afl_api_match`)

> **AFLDB-ISSUE-244 I244-F006 — read this before §3.4.** `staging.afl_api_match`
> is **not** a mirror of every AFL API match. It is a typed projection written
> only for matches the AFL API settle *plans* (an `afl_api`-owned or new
> match). A match that merely **corroborates** an existing canonical match
> owned by another source — for 2026, almost every home-and-away match is
> `afltables`-owned — is recorded on the observation spine and counted
> `corroboratedForeignOwned`, but receives **no** typed row. That is by design,
> not a defect, and the settle in this section does not change it.
>
> Evidence from the real 2026 acquisition (evidence, **not** an invariant —
> re-measure, never assume): **217** source match heads, **4**
> `staging.afl_api_match` rows. The difference is the corroborated
> foreign-owned matches.
>
> Consequence for Brownlow: those corroborated matches can be identified only
> through canonical fixture identity, i.e. **`--use-fixture-identity` is
> required for the 2026 home-and-away match identity under the current data
> state**, and §3.4 passes it. Whether a *future* season needs it depends on
> which source owns its matches when Brownlow is settled; do not assume either
> way. A `--dry-run` / `--apply` without the flag **refuses before any write**
> when any vote set would need it (§3.4); `--use-fixture-identity` is never
> enabled for you.

What this step is still needed for: the fixture-identity path reads each
match's **match-family observation** (spine) and resolves it to exactly one
existing canonical `matches` row by season, home/away club and venue-local
date. That observation is written by the settle below (`--apply`, no
`--auto-apply` needed). It also stages `staging.afl_api_match` rows for the
few matches the settle plans; Brownlow uses a typed row when one exists and the
fixture path otherwise. Acquire and settle the real 2026 match family
**first**, using dynamic label extraction — never a guessed or hand-typed
label:

```powershell
# --- 2026 match-family acquisition (network; real feed) --------------------
$matchAcq = & npx tsx .\tools\current-season\acquire-afl-api.ts `
  --season 2026 `
  --status CONCLUDED 2>&1
$matchAcq

$matchLabel = [regex]::Match(
    ($matchAcq -join "`n"),
    'label\s+(afl-api-2026-[^\s]+)'
).Groups[1].Value
if ([string]::IsNullOrWhiteSpace($matchLabel)) {
  throw 'Could not extract the 2026 AFL API match-family acquisition label.'
}
"Captured match-family label: $matchLabel"
```

Then settle that exact snapshot, validate first:

```powershell
# 1. Validate-only — no DB connection
npx tsx tools/current-season/settle-afl-api.ts --label $matchLabel --validate-only

# 2. Dry-run — full write path against real constraints/privileges, rolled back
npx tsx tools/current-season/settle-afl-api.ts --label $matchLabel --dry-run --auto-apply

# 3. Apply WITHOUT --auto-apply — persists the match-family observations (and a
#    typed staging.afl_api_match row only for the matches this settle plans);
#    "No canonical row was written: the automatic path runs only with --auto-apply."
#    (settle-afl-api.ts's own log line). This is the established
#    corroboration/staging path: it does NOT transfer or re-own the foreign
#    AFL Tables canonical match rows, and it does NOT create a typed
#    staging.afl_api_match row for them (I244-F006).
npx tsx tools/current-season/settle-afl-api.ts --label $matchLabel --apply
```

Do not add `--auto-apply` to step 3 above for this prerequisite: the whole
point is staging/observation-only persistence against `afldb_test`, not a
canonical match-record write. Confirm the §2-step-3 guard already passed in
this same session before running step 2 or step 3 (both are apply-capable).

### 3.3 Live Brownlow acquisition

Acquisition stays one-shot per snapshot. Extract the label dynamically from
stdout, the same way as §3.2 — never guess it:

```powershell
$brownAcq = & npx tsx .\tools\current-season\acquire-afl-api-brownlow.ts --season 2026 2>&1
$brownAcq

$brownlowLabel = [regex]::Match(
    ($brownAcq -join "`n"),
    'label\s+(afl-api-brownlow-2026-[^\s]+)'
).Groups[1].Value
if ([string]::IsNullOrWhiteSpace($brownlowLabel)) {
  throw 'Could not extract the 2026 AFL API Brownlow acquisition label.'
}
"Captured Brownlow label: $brownlowLabel"
```

Every invocation of this command captures its own immutable snapshot under
`data/sources/afl_api/brownlow/<label>/`. Re-run it as many times as needed
during the count; each run gets its own label and its own settle sequence
below.

### 3.4 Brownlow settle order, for each snapshot label

Confirm the §2-step-3 `DATABASE_URL` / `AFLDB_IMPORT_DATABASE_URL` guards already passed in this
same session before running B, C or D below — each is apply-capable.

```powershell
# A. Validate-only — manifest re-hash + registry + record parse; no DB connection
#    (no connection, so the fixture-identity requirement is NOT assessed here)
npx tsx tools/current-season/settle-afl-api-brownlow.ts --label $brownlowLabel --validate-only

# B. Observe — persists source/spine observation; prevents any canonical vote write
npx tsx tools/current-season/settle-afl-api-brownlow.ts --label $brownlowLabel --observe-only --apply --use-fixture-identity

# C. Dry-run — full write path against real constraints/privileges, then rolled back
npx tsx tools/current-season/settle-afl-api-brownlow.ts --label $brownlowLabel --dry-run --auto-apply --use-fixture-identity

# D. Apply — the operational path, against afldb_test only
npx tsx tools/current-season/settle-afl-api-brownlow.ts --label $brownlowLabel --apply --auto-apply --use-fixture-identity
```

`--use-fixture-identity` (I244-F006) is part of B, C and D for the 2026
home-and-away count under the current data state — see §3.2: most 2026 matches
corroborate an `afltables`-owned canonical match and have no typed
`staging.afl_api_match` row, so canonical fixture identity is their only
identity source. The CLI **never enables it automatically**. The scheduled
wrapper (`deploy/afldb-settle-afl-api-brownlow.sh`) passes it explicitly since
AFLDB-ISSUE-232 D-232-1 = B (2026-09-26), after refreshing fixture identity in
the same run (O1). What each mode does
when the flag is omitted and some vote sets would need it (the CLI measures
this from the snapshot's own vote sets, before any write):

| Mode | Without `--use-fixture-identity` |
|---|---|
| `--validate-only` | Not assessed (no connection is opened). |
| `--observe-only` (any other flags) | **Advisory log line only** — no canonical write is attempted and its spine observations do not depend on match identity; the affected vote sets are counted `unknown_match`. |
| `--dry-run`, `--apply` (with or without `--auto-apply`), or no mode flag | **Refuses before any write** (no import batch, observation, projection or data_issues row) with the vote-set count, a bounded sample of provider match ids, and the flag to re-run with. `--dry-run` is the rehearsal of `--apply`, so it fails identically. |

A vote set that cannot be resolved by *either* path (no match observation,
ambiguous, unmapped club) is not affected by the flag: it stays an ordinary
per-set `unknown_match`/`fixture_identity_ambiguous` refusal in the run's
counters. The gate, live-database-identity and completed-season-backtest
protections are unchanged and run first.

Do **not** add `--allow-completed-season-backtest` to any of the above for
live 2026 — that flag exists for the S10 completed-season backtest authority,
not tonight's in-progress count, and using it here would be the wrong
authority path for an in-progress season.

A repeat `--apply --auto-apply` over an unchanged snapshot is an idempotent
no-op (§10); a changed vote value is an in-place correction, atomically
applied per vote set.

**AFLDB-ISSUE-244 I244-F007 (match_id + coverage).** Every canonical
`brownlow_round_votes` write above — an insert, a votes correction or an
I244-F002 demotion — now also proposes that vote set's resolved canonical
`match_id` (staged or `--use-fixture-identity`, same field). A pre-F007 row
that already carries the correct votes but `match_id IS NULL` is healed to the
resolved id on its next `--apply --auto-apply` replay with no vote change
required — this is expected, appears as an ordinary `canonicalRowsUpdated`,
and is safe to run once per season to backfill existing rows. A row that
already carries a **different, non-null** `match_id` **refuses the entire
provider vote set before any write** (`voteSetsRefused.match_identity_conflict`,
plus one `data_issues` row per provider match whose `details` name the
conflicting players, the existing `match_id` and the newly resolved one): no
demotion, no vote change, no `match_id` heal, no ledger row, and no coverage
recompute caused by that set. The refusal covers every existing row the set
would mutate — the current recipients' rows and the AFL-API-owned stale
recipients' rows of the same provider match — and only those. Correcting an
existing non-null `match_id` (X -> Y) is never done automatically: I244-F010
reviewed it and left it fail-closed — the refusal above stands and the
conflict is operator-reviewed (a `match_id` is a foreign-key identity claim, and
no rule proves Y rather than X is the right match). A conflicting row is also
**not** "pinned while its other fields update". After any run whose Brownlow canonical writes actually changed
durable state, `recomputeBrownlowCoverage()` runs once, in the SAME
transaction, for the settled season — `--dry-run` still exercises it but rolls
it back with everything else, so `result.applied` (not the
`coverageRecomputeRuns` counter, which reports what was attempted) is what
tells you whether it committed.

**Vote permutations are a two-phase update.** `brownlow_round_votes` carries
`UNIQUE (match_id, votes) WHERE match_id IS NOT NULL AND votes > 0` (migration
094), and every write now carries `match_id`. A provider correction that
re-awards values among the SAME recipients (A3 B2 C1 -> A2 B3 C1, or the
3-cycle C3 A2 B1) cannot be written one row at a time in any order without a
transient duplicate, so inside the vote set's single savepoint the apply first
writes `votes = 0` for every current recipient whose existing positive value
differs from its target (a published zero is outside the index), then claims
the final 3/2/1. Expect the ledger to show both writes: those temporary
releases raise `canonicalRowsUpdated` / `canonicalApplicationsLogged` by one per
released recipient, but they are **not** stale demotions —
`staleRecipientsDemoted` counts only players who left the positive set. The
whole set (stale demotions, releases, claims) rolls back together if any step
fails.

**The run's `import_batches` row is closed in the same transaction (I244-F008).**
Every Brownlow run that commits — `--apply`, `--apply --auto-apply`, and
`--observe-only` alike — leaves a `completed` batch with `completed_at` set, and a
`--dry-run`, run-level HALT or thrown error leaves **none** (the batch row rolls
back with everything else). Read a committed batch like this:

- `records_read` = vote sets in the snapshot; `records_inserted` = new
  `brownlow_match_votes` observation versions; `records_updated` is always `0`
  (that table is append-only, so an unchanged replay is `0` / `0`).
- `records_rejected` = the number of `import_rejections` rows the run wrote — one
  per vote set refused at planning (`unknown_match`, `round_unmapped`, …). It is
  **not** `voteSetsRefused`: an apply-time `match_identity_conflict` refusal
  writes a `data_issues` row but no rejection row, and `--observe-only` writes
  neither, so its `records_rejected` is `0` while `voteSetsRefused` may not be.
- `validation_result` = the run's counters verbatim (including
  `canonicalRowsInserted`/`canonicalRowsUpdated`, `voteSetsNoOp`,
  `staleRecipientsDemoted`, `coverageRecomputeRuns` and the leaderboard
  comparison counters).

A `running` batch left behind therefore means a crashed process, not a finished
count.

### 3.5 Leaderboard reconciliation — read the CLI's own verdict

The settle CLI prints `leaderboardPlayersCompared` / `leaderboardMismatches`
(or the equivalent reconciliation summary line) after every dry-run and
apply. Its severity depends on the feed's own leaderboard status, which the
CLI already distinguishes:

- **LIVE** (count still in progress): leaderboard mismatches are **advisory**
  — expected while votes are still being revealed.
- **CONCLUDED**: leaderboard mismatches are **blocking** — the CLI itself
  treats this as a hard stop (`result.reconciliation.blocking`).

Retain the printed `leaderboardPlayersCompared` / `leaderboardMismatches` (or
equivalent) output as acceptance evidence for each snapshot alongside the
label in §4's evidence record.

### 3.6 Replay evidence

**Keep every acquired snapshot.** These are exactly the "capture the raw
season and leaderboard feeds every few minutes during the live count"
timestamped files §10 asks for and the still-open assertion-9 evidence
(`issues/closed/AFLDB-ISSUE-228.md` §9.9/§19.5) needs a genuine second pair of.
Do not delete `data/sources/afl_api/brownlow/*` afterwards.

Across tonight's captures, the evidence record should show:

- repeated real captures during the count (§3.3, one label per capture);
- every snapshot preserved on disk;
- at least one replay of an already-processed, unchanged snapshot (re-run
  §3.4 step D against a prior `$brownlowLabel`) to demonstrate the idempotent
  no-op behaviour described above;
- settlement of later, changed/advanced snapshots as votes are revealed;
- a genuine correction capture, preserved as-is, **only if the real AFL feed
  actually issues one** — do not manufacture or require a correction that
  did not happen;
- a final `CONCLUDED` capture/reconciliation once the count actually
  concludes, if that happens within tonight's session.

## 4. After the count

- Do not import anything into DEV or PROD from tonight's run. `afldb_test` is
  the only target this runbook authorises.
- Record the real result (vote sets seen/applied, leaderboard reconciliation,
  §3.5's `leaderboardPlayersCompared` / `leaderboardMismatches`, any
  refusals, and §3.6's replay evidence) in `issues.md` under
  `AFLDB-ISSUE-228`, per CLAUDE.md §5 — this document is a procedure, not the
  evidence ledger.
- **Assertion 9 stays separate.** Tonight's real Brownlow captures — however
  clean — do NOT close assertion 9 / `monitor-CD_M20260142801`
  (`issues/closed/AFLDB-ISSUE-228.md` §9.9/§19.5). Record tonight's evidence on
  its own terms; do not write it up as closing that follow-up.
- Unset `AFLDB_AFL_API_BROWNLOW_ENABLED`, `DATABASE_URL` and `AFLDB_IMPORT_DATABASE_URL` in
  the shell before closing it, and confirm neither is present in the
  repository's tracked `.env`.
