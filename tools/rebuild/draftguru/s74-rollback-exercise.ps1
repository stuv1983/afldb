<#
.SYNOPSIS
  AFLDB-ISSUE-222 §7.4 -- the mandatory afldb_test rollback exercise (S0/S1/S2/S3), fail-closed.

.DESCRIPTION
  Implements AFLDB-ISSUE-222.md §7.4 end to end against afldb_test only:

    connection guards -> fresh backup -> baseline plan (BASE) -> [deliberate confirmation] ->
    REVERSE #1 -> capture S0 -> plan R1 -> LOAD #1 -> verify #1 (R1's own values) -> capture S1 ->
    REVERSE #2 -> capture S2 -> assert S2=S0 -> plan R2 -> assert R2=R1 -> LOAD #2 ->
    verify #2 (R2's own values) -> capture S3 -> assert S3=S1 -> final plan -> assert
    import_batches grew by exactly 4 and every captured hash still equals BASE's.

  Every import_draftguru.py invocation (reverse and load) carries --no-seed, preserving the
  accepted "nothing seeded" invariant. Every --expect-batches-before passed to bridge_import_gate
  verify is the value THAT RUN'S OWN preceding plan printed -- never computed, never guessed.
  S0=S2 and S1=S3 are proven by SHA-256 over the six raw §7.4 snapshot files
  (tools/rebuild/draftguru/s74-snapshot.sql), throwing on the first mismatch. import_batches is
  deliberately excluded from that file-level equality (see NOTES) and is checked separately as a
  count. Every snapshot, plan/verify transcript and the backup manifest are written OUTSIDE the
  repository, under a fresh directory this script refuses to reuse.

  This script performs REAL, mutating operations against afldb_test (import_draftguru.py without
  --bridge, then with it, each run twice). It never addresses afldb_dev. It never generates the
  DEV child, runs Git, touches the network beyond the already-open afldb_test connection, or
  deploys anything.

.PARAMETER EvidenceRoot
  Parent directory for this run's evidence subdirectory. Default D:\backups\afldb\issue-222. The
  script refuses to run if <EvidenceRoot>\<Label> already exists, and refuses if it resolves
  inside the repository.

.PARAMETER Label
  Name of this run's evidence subdirectory. Defaults to a timestamp (s74-yyyyMMdd-HHmmss) so two
  runs can never collide.

.PARAMETER Bridge
  Path (repository-relative or absolute) to the pinned afldb_test deployment child. Defaults to
  the same child the accepted 2026-09-19 import used.

.EXAMPLE
  powershell -ExecutionPolicy Bypass -File tools\rebuild\draftguru\s74-rollback-exercise.ps1

.EXAMPLE
  # Dry-run the confirmation gate only -- prints what would happen, touches nothing.
  powershell -ExecutionPolicy Bypass -File tools\rebuild\draftguru\s74-rollback-exercise.ps1 -WhatIf

.NOTES
  Preconditions this script does NOT establish for you -- confirm them first:
    * a working SSH tunnel/port-forward to the afldb_test host on 127.0.0.1:55432;
    * AFLDB_TEST_DATABASE_URL and AFLDB_IMPORT_DATABASE_URL both set to that tunnel, targeting
      afldb_test (never the default .env values, which target afldb_dev);
    * the pinned v2 afldb_test deployment child unchanged since the last accepted import;
    * a Python interpreter on PATH with psycopg importable.

  S0/S1/S2/S3, precisely: afldb_test starts this exercise in the POST-import (bridged) state --
  the real, already-accepted import. That starting state is NOT S0; it is what the step-2 backup
  protects, and what S1 (below) reconstructs.
    S0 = the reconstructed PRE-bridge state, captured only after REVERSE #1. Never the untouched
         starting database (AFLDB-ISSUE-222.md §7.4 line 879 explicitly allows capturing S0 "after
         the plain rebuild or after step 4 below" -- i.e. by undoing an existing load first).
    S1 = the post-load state, captured after LOAD #1. Because the same, already-accepted child is
         reloaded onto the same reversed rows, S1 reconstructs the exercise's own starting state.
    S2 = the second reconstructed pre-bridge state, captured after REVERSE #2. Must equal S0.
    S3 = the second post-load state, captured after LOAD #2. Must equal S1 (idempotent restore).
  import_batches legitimately gains one row per mutating call (4 total: reverse/load/reverse/load)
  and is therefore deliberately NOT one of the six hashed snapshot files; it is checked as a count
  (BASE.before + 4) via the gate's own printed import_batches_before, never substituted into an
  --expect-batches-before argument.

  On ANY failure this script throws and stops; it NEVER attempts an automatic restore. Recovery is
  the three-tier procedure already tracked in AFLDB-ISSUE-222.md §11.19.4 ("Rollback, three
  tiers"): tier 1 is an importer reversal (no restore -- likely already the last thing this script
  ran); tier 2 restores the step-2 backup into a separate `afldb_test_recovery` database on the
  DEV host, never over afldb_test; tier 3 is the last-resort restore over afldb_test itself,
  followed by `npm run db:privileges:test`. Read that section before touching anything by hand.
#>

[CmdletBinding(SupportsShouldProcess = $true, ConfirmImpact = 'High')]
param(
  [string] $EvidenceRoot = 'D:\backups\afldb\issue-222',
  [string] $Label = ('s74-' + (Get-Date -Format 'yyyyMMdd-HHmmss')),
  [string] $Bridge = 'data/reference/draftguru-person-bridge-20260918-v2.afldb_test.json',
  [string] $PgBin = 'C:\Program Files\PostgreSQL\16\bin',
  [string] $PythonExe = 'python',
  [string] $ExpectedHost = '127.0.0.1',
  [int]    $ExpectedPort = 55432,
  [string] $ExpectedDatabase = 'afldb_test',
  [string] $ExpectedImportRole = 'afldb_import'
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

# ---------------------------------------------------------------------------
# 0. Resolve every fixed path BEFORE any Push-Location, and refuse early if anything is missing.
# ---------------------------------------------------------------------------

$RepoRoot = (Resolve-Path (Join-Path $PSScriptRoot '..\..\..')).Path
$SnapshotSql = (Resolve-Path (Join-Path $PSScriptRoot 's74-snapshot.sql')).Path
$ImporterPy = Join-Path $PSScriptRoot 'import_draftguru.py'
$GatePy = Join-Path $PSScriptRoot 'bridge_import_gate.py'
$BackupScript = (Resolve-Path (Join-Path $RepoRoot 'tools\maintenance\backup-afldb-test.ps1')).Path
$PsqlExe = Join-Path $PgBin 'psql.exe'
$PgRestoreExe = Join-Path $PgBin 'pg_restore.exe'
foreach ($p in @($SnapshotSql, $ImporterPy, $GatePy, $BackupScript, $PsqlExe, $PgRestoreExe)) {
  if (-not (Test-Path -LiteralPath $p)) { throw "REFUSED: required file not found: $p" }
}

$BridgePath = $Bridge
if (-not [System.IO.Path]::IsPathRooted($BridgePath)) { $BridgePath = Join-Path $RepoRoot $Bridge }
if (-not (Test-Path -LiteralPath $BridgePath)) { throw "REFUSED: -Bridge not found: $BridgePath" }
$BridgePath = (Resolve-Path -LiteralPath $BridgePath).Path

$EvidenceRootFull = [System.IO.Path]::GetFullPath($EvidenceRoot)
$EvidenceDir = [System.IO.Path]::GetFullPath((Join-Path $EvidenceRootFull $Label))
if (Test-Path -LiteralPath $EvidenceDir) {
  throw "REFUSED: evidence directory already exists: $EvidenceDir -- pick a new -Label; never reuse or overwrite a prior exercise's evidence"
}
$repoRootWithSlash = $RepoRoot.TrimEnd('\') + '\'
if ($EvidenceDir.StartsWith($repoRootWithSlash, [System.StringComparison]::OrdinalIgnoreCase) -or
  $EvidenceDir.TrimEnd('\').Equals($RepoRoot.TrimEnd('\'), [System.StringComparison]::OrdinalIgnoreCase)) {
  throw "REFUSED: -EvidenceRoot/-Label resolves inside the repository ($RepoRoot); §7.4 evidence must live outside it"
}
New-Item -ItemType Directory -Path $EvidenceDir -Force | Out-Null
foreach ($stage in 'S0', 'S1', 'S2', 'S3') {
  New-Item -ItemType Directory -Path (Join-Path $EvidenceDir $stage) -Force | Out-Null
}
Write-Host "==> Evidence directory: $EvidenceDir"

$SnapshotFiles = 'persons.csv', 'picks_dg.csv', 'picks_manual_null.csv', 'identities.csv', 'resolutions.csv', 'overrides.csv'

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

function Test-TcpPort {
  param([Parameter(Mandatory)][string] $ComputerName, [Parameter(Mandatory)][int] $Port, [int] $TimeoutMs = 2000)
  $client = [System.Net.Sockets.TcpClient]::new()
  try {
    $task = $client.ConnectAsync($ComputerName, $Port)
    if (-not $task.Wait($TimeoutMs)) { return $false }
    return $client.Connected
  }
  catch {
    return $false
  }
  finally {
    $client.Dispose()
  }
}

function Assert-Dsn {
  # Confirms host/port/database WITHOUT ever printing or logging the DSN itself.
  param([Parameter(Mandatory)][string] $Name, [Parameter(Mandatory)][string] $Dsn)
  if ($Dsn -notmatch '^postgres(?:ql)?://[^@]+@(?<h>[^:/]+):(?<p>\d+)/(?<d>[^/?]+)') {
    throw "REFUSED: $Name is not a postgresql://user:pass@host:port/db DSN (shape only checked; value never logged)"
  }
  if ($Matches['h'] -ne $ExpectedHost -or [int]$Matches['p'] -ne $ExpectedPort -or $Matches['d'] -ne $ExpectedDatabase) {
    throw "REFUSED: $Name must target ${ExpectedHost}:${ExpectedPort}/${ExpectedDatabase} (observed host/port/db do not match; value never logged)"
  }
}

function Invoke-ReadOnlySql {
  # One -At SELECT through psql with the server-side session forced read-only, restoring
  # PGOPTIONS afterward no matter what. Never receives or returns the DSN itself.
  param([Parameter(Mandatory)][string] $Dsn, [Parameter(Mandatory)][string] $Sql)
  $previous = $env:PGOPTIONS
  try {
    $env:PGOPTIONS = '-c default_transaction_read_only=on'
    $out = & $PsqlExe -X -At -F '|' -v ON_ERROR_STOP=1 -c $Sql -d $Dsn
    if ($LASTEXITCODE -ne 0) { throw "REFUSED: psql read-only probe failed (exit $LASTEXITCODE)" }
    return $out
  }
  finally {
    $env:PGOPTIONS = $previous
  }
}

function Invoke-Snapshot {
  # Runs s74-snapshot.sql with cwd = $StageDir and the session forced read-only, restoring both
  # PGOPTIONS and the working directory afterward regardless of outcome.
  param([Parameter(Mandatory)][string] $StageDir, [Parameter(Mandatory)][string] $Dsn)
  $previousOptions = $env:PGOPTIONS
  Push-Location -LiteralPath $StageDir
  try {
    $env:PGOPTIONS = '-c default_transaction_read_only=on'
    & $PsqlExe -X -v ON_ERROR_STOP=1 -f $SnapshotSql -d $Dsn
    if ($LASTEXITCODE -ne 0) { throw "REFUSED: snapshot into $StageDir failed (exit $LASTEXITCODE)" }
  }
  finally {
    Pop-Location
    $env:PGOPTIONS = $previousOptions
  }
  foreach ($f in $SnapshotFiles) {
    if (-not (Test-Path -LiteralPath (Join-Path $StageDir $f))) {
      throw "REFUSED: snapshot into $StageDir did not produce $f"
    }
  }
}

function Assert-SnapshotsIdentical {
  # SHA-256 over the raw files -- never a text diff -- throwing on the FIRST mismatch found.
  param([Parameter(Mandatory)][string] $LeftDir, [Parameter(Mandatory)][string] $RightDir)
  foreach ($f in $SnapshotFiles) {
    $leftPath = Join-Path $LeftDir $f
    $rightPath = Join-Path $RightDir $f
    foreach ($p in @($leftPath, $rightPath)) {
      if (-not (Test-Path -LiteralPath $p)) { throw "REFUSED: expected snapshot file missing: $p" }
    }
    $leftHash = (Get-FileHash -LiteralPath $leftPath -Algorithm SHA256).Hash
    $rightHash = (Get-FileHash -LiteralPath $rightPath -Algorithm SHA256).Hash
    if ($leftHash -ne $rightHash) {
      throw ("STOP (AFLDB-ISSUE-222.md §7.4 line 899): $f differs between $LeftDir and $RightDir " +
        "($leftHash vs $rightHash) -- the reversal is not proven. See this script's NOTES for the " +
        "tracked §11.19.4 three-tier recovery; never attempt an automatic restore.")
    }
    Write-Host "    OK  $f  $leftHash"
  }
}

function Invoke-Importer {
  # import_draftguru.py, --no-seed always, PGOPTIONS explicitly cleared for the duration (a
  # forced-read-only session would make the importer's own writes fail closed for the wrong
  # reason). Streams to the console and tees stdout into the evidence directory.
  param([string[]] $ExtraArgs = @(), [Parameter(Mandatory)][string] $LogName)
  $previous = $env:PGOPTIONS
  try {
    $env:PGOPTIONS = $null
    $argsList = @($ImporterPy, '--no-seed') + $ExtraArgs
    & $PythonExe @argsList | Tee-Object -FilePath (Join-Path $EvidenceDir $LogName)
    if ($LASTEXITCODE -ne 0) { throw "REFUSED: import_draftguru.py exited $LASTEXITCODE ($($ExtraArgs -join ' '))" }
  }
  finally {
    $env:PGOPTIONS = $previous
  }
}

function Invoke-Gate {
  # bridge_import_gate.py plan|verify --target test. The tool forces its own read-only session
  # over its own connection regardless of this script's PGOPTIONS, so nothing is touched here.
  param([Parameter(Mandatory)][string[]] $GateArgs)
  $argsList = @($GatePy) + $GateArgs
  $out = & $PythonExe @argsList
  $exit = $LASTEXITCODE
  return [pscustomobject]@{ Output = $out; ExitCode = $exit }
}

function Get-GateValue {
  param([Parameter(Mandatory)][string[]] $Lines, [Parameter(Mandatory)][string] $Key)
  foreach ($line in $Lines) {
    if ($line -match "^\s*$([regex]::Escape($Key)):\s*(\S+)") { return $Matches[1] }
  }
  throw "REFUSED: could not find '$Key' in the gate's own output -- refusing to guess it"
}

function Save-GateLog {
  param([Parameter(Mandatory)] $Result, [Parameter(Mandatory)][string] $LogName)
  $Result.Output | Set-Content -LiteralPath (Join-Path $EvidenceDir $LogName) -Encoding utf8
}

function Assert-GateOk {
  param([Parameter(Mandatory)] $Result, [Parameter(Mandatory)][string] $StepLabel)
  $Result.Output | ForEach-Object { Write-Host $_ }
  if ($Result.ExitCode -ne 0) {
    throw "STOP: $StepLabel refused or errored (exit $($Result.ExitCode)) -- see the transcript above"
  }
}

function Read-GatePlanValues {
  param([Parameter(Mandatory)] $Result)
  [ordered]@{
    after  = Get-GateValue -Lines $Result.Output -Key 'after_state_sha256'
    picks  = Get-GateValue -Lines $Result.Output -Key 'picks_after_sha256'
    newly  = Get-GateValue -Lines $Result.Output -Key 'newly_linked_sha256'
    base   = Get-GateValue -Lines $Result.Output -Key 'baseline_sha256'
    before = [int](Get-GateValue -Lines $Result.Output -Key 'import_batches_before')
  }
}

function Assert-SameHashes {
  param(
    [Parameter(Mandatory)] $Left, [Parameter(Mandatory)][string] $LeftName,
    [Parameter(Mandatory)] $Right, [Parameter(Mandatory)][string] $RightName
  )
  foreach ($k in 'after', 'picks', 'newly', 'base') {
    if ($Left[$k] -ne $Right[$k]) {
      throw "STOP: $LeftName.$k does not equal $RightName.$k -- the reload does not reproduce the expected state"
    }
  }
}

# ---------------------------------------------------------------------------
# 1. Connection guards -- before ANYTHING touches the database.
# ---------------------------------------------------------------------------

Write-Host "`n==> 1. Connection guards"
if (-not $env:AFLDB_TEST_DATABASE_URL) { throw 'REFUSED: AFLDB_TEST_DATABASE_URL is not set' }
if (-not $env:AFLDB_IMPORT_DATABASE_URL) { throw 'REFUSED: AFLDB_IMPORT_DATABASE_URL is not set' }
Assert-Dsn -Name 'AFLDB_TEST_DATABASE_URL' -Dsn $env:AFLDB_TEST_DATABASE_URL
Assert-Dsn -Name 'AFLDB_IMPORT_DATABASE_URL' -Dsn $env:AFLDB_IMPORT_DATABASE_URL

$testProbe = Invoke-ReadOnlySql -Dsn $env:AFLDB_TEST_DATABASE_URL -Sql 'SELECT current_database();'
if (($testProbe | Select-Object -First 1) -ne $ExpectedDatabase) {
  throw "REFUSED: AFLDB_TEST_DATABASE_URL's current_database() is not $ExpectedDatabase"
}
$importProbe = Invoke-ReadOnlySql -Dsn $env:AFLDB_IMPORT_DATABASE_URL -Sql 'SELECT current_user, current_database();'
$importParts = ($importProbe | Select-Object -First 1) -split '\|'
if ($importParts[0] -ne $ExpectedImportRole -or $importParts[1] -ne $ExpectedDatabase) {
  throw "REFUSED: AFLDB_IMPORT_DATABASE_URL's current_user/current_database() is not $ExpectedImportRole/$ExpectedDatabase"
}
Write-Host "    both DSNs verified: current_database() = $ExpectedDatabase; import role = $ExpectedImportRole (values never printed)"

# ---------------------------------------------------------------------------
# 2. Fresh backup -- the recovery point for the STARTING post-import database (never S0).
# ---------------------------------------------------------------------------

Write-Host "`n==> 2. Fresh afldb_test backup"
$backupOutput = & pwsh -NoProfile -File $BackupScript
if ($LASTEXITCODE -ne 0) { throw "REFUSED: backup-afldb-test.ps1 exited $LASTEXITCODE" }
$backupOutput | ForEach-Object { Write-Host $_ }
$backupFileLine = $backupOutput | Where-Object { $_ -match '^\s*file\s+(.+)$' } | Select-Object -Last 1
$backupShaLine = $backupOutput | Where-Object { $_ -match '^\s*sha256\s+([0-9a-f]{64})$' } | Select-Object -Last 1
if (-not $backupFileLine -or -not $backupShaLine) {
  throw 'REFUSED: could not parse the backup file path/sha256 from backup-afldb-test.ps1 output'
}
$backupFile = ($backupFileLine -replace '^\s*file\s+', '').Trim()
$backupShaReported = ($backupShaLine -replace '^\s*sha256\s+', '').Trim()
if (-not (Test-Path -LiteralPath $backupFile)) { throw "REFUSED: reported backup file does not exist: $backupFile" }
if ((Get-Item -LiteralPath $backupFile).Length -le 0) { throw "REFUSED: backup file is zero-length: $backupFile" }
$backupShaRecomputed = (Get-FileHash -LiteralPath $backupFile -Algorithm SHA256).Hash.ToLower()
if ($backupShaRecomputed -ne $backupShaReported) {
  throw "REFUSED: recomputed backup sha256 ($backupShaRecomputed) does not match backup-afldb-test.ps1's own reported hash ($backupShaReported)"
}
$restoreListing = & $PgRestoreExe --list $backupFile
if ($LASTEXITCODE -ne 0) { throw "REFUSED: pg_restore --list could not read the backup: $backupFile" }
$objectCount = @($restoreListing | Where-Object { $_ -match '^\d' }).Count
if ($objectCount -lt 1) { throw "REFUSED: pg_restore --list reports zero objects in the backup: $backupFile" }
@"
backup_file: $backupFile
backup_sha256: $backupShaRecomputed
backup_objects: $objectCount
recovery_procedure: AFLDB-ISSUE-222.md section 11.19.4, "Rollback, three tiers" -- tier 1 is an
  importer reversal (no restore); tier 2 restores this dump into a SEPARATE afldb_test_recovery
  database on the DEV host, never over afldb_test; tier 3 is the last-resort restore over
  afldb_test itself, followed by npm run db:privileges:test. This script never runs any of them
  automatically.
"@ | Set-Content -LiteralPath (Join-Path $EvidenceDir 'backup-manifest.txt') -Encoding utf8
Write-Host "    backup verified: $backupFile ($objectCount objects, sha256 $backupShaRecomputed)"

# ---------------------------------------------------------------------------
# 3. Baseline plan (BASE) -- the untouched starting state, before any mutation.
# ---------------------------------------------------------------------------

Write-Host "`n==> 3. Baseline plan (BASE)"
$baseResult = Invoke-Gate -GateArgs @('plan', '--target', 'test', '--bridge', $BridgePath)
Assert-GateOk -Result $baseResult -StepLabel 'BASE plan'
Save-GateLog -Result $baseResult -LogName 'base-plan.log'
$BASE = Read-GatePlanValues -Result $baseResult
Write-Host "    BASE import_batches_before = $($BASE.before)"

# ---------------------------------------------------------------------------
# Deliberate pause before the first mutation. No placeholder substitution is required anywhere
# in this script (every value below is captured and threaded programmatically); this gate exists
# purely so a human deliberately authorises the mutating half of the run.
# ---------------------------------------------------------------------------

Write-Host "`n==> About to REVERSE afldb_test (mutating). Verified backup: $backupFile"
if (-not $PSCmdlet.ShouldProcess('afldb_test', 'REVERSE and RELOAD the DraftGuru bridge twice (AFLDB-ISSUE-222 section7.4)')) {
  Write-Host 'Aborted by -WhatIf/-Confirm:$false. Nothing was touched.'
  exit 0
}
$phrase = 'I have a fresh verified afldb_test backup and intend to reverse and reload the bridge'
$typed = Read-Host "Type the exact phrase to continue, or press Ctrl+C to abort:`n  $phrase`n"
if ($typed -ne $phrase) { throw 'REFUSED: confirmation phrase did not match exactly. Nothing was touched.' }

if (-not (Test-TcpPort -ComputerName $ExpectedHost -Port $ExpectedPort)) {
  throw "REFUSED: no TCP listener at ${ExpectedHost}:${ExpectedPort} immediately before the first mutation -- is the tunnel still up?"
}

# ---------------------------------------------------------------------------
# 4-5. REVERSE #1, capture S0.
# ---------------------------------------------------------------------------

Write-Host "`n==> 4. REVERSE #1 (mutating, --no-seed, no --bridge)"
Invoke-Importer -LogName 'reverse1.log'

Write-Host "`n==> 5. Capture S0"
Invoke-Snapshot -StageDir (Join-Path $EvidenceDir 'S0') -Dsn $env:AFLDB_TEST_DATABASE_URL

# ---------------------------------------------------------------------------
# 6. Read-only plan R1, predicting LOAD #1 against S0.
# ---------------------------------------------------------------------------

Write-Host "`n==> 6. Plan R1"
$r1Result = Invoke-Gate -GateArgs @('plan', '--target', 'test', '--bridge', $BridgePath)
Assert-GateOk -Result $r1Result -StepLabel 'R1 plan'
Save-GateLog -Result $r1Result -LogName 'r1-plan.log'
$R1 = Read-GatePlanValues -Result $r1Result

# ---------------------------------------------------------------------------
# 7-9. LOAD #1, verify #1 (R1's own values, never recomputed), capture S1.
# ---------------------------------------------------------------------------

Write-Host "`n==> 7. LOAD #1 (mutating, --no-seed --bridge)"
Invoke-Importer -ExtraArgs @('--bridge', $BridgePath) -LogName 'load1.log'

Write-Host "`n==> 8. Verify #1 (against R1's captured values)"
$v1Result = Invoke-Gate -GateArgs @(
  'verify', '--target', 'test', '--bridge', $BridgePath,
  '--expect-after-sha256', $R1.after, '--expect-picks-after-sha256', $R1.picks,
  '--expect-newly-linked-sha256', $R1.newly, '--expect-baseline-sha256', $R1.base,
  '--expect-batches-before', $R1.before
)
Assert-GateOk -Result $v1Result -StepLabel 'verify #1'
Save-GateLog -Result $v1Result -LogName 'verify1.log'
Assert-SameHashes -Left $R1 -LeftName 'R1' -Right $BASE -RightName 'BASE'

Write-Host "`n==> 9. Capture S1"
Invoke-Snapshot -StageDir (Join-Path $EvidenceDir 'S1') -Dsn $env:AFLDB_TEST_DATABASE_URL

# ---------------------------------------------------------------------------
# 10-11. REVERSE #2, capture S2, assert S2 = S0 exactly (SHA-256, all six files).
# ---------------------------------------------------------------------------

Write-Host "`n==> 10. REVERSE #2 (mutating, --no-seed, no --bridge)"
Invoke-Importer -LogName 'reverse2.log'

Write-Host "`n==> 11. Capture S2 and compare with S0"
Invoke-Snapshot -StageDir (Join-Path $EvidenceDir 'S2') -Dsn $env:AFLDB_TEST_DATABASE_URL
Assert-SnapshotsIdentical -LeftDir (Join-Path $EvidenceDir 'S0') -RightDir (Join-Path $EvidenceDir 'S2')

# ---------------------------------------------------------------------------
# 12. Read-only plan R2, predicting LOAD #2 against S2; assert R2 = R1 exactly.
# ---------------------------------------------------------------------------

Write-Host "`n==> 12. Plan R2"
$r2Result = Invoke-Gate -GateArgs @('plan', '--target', 'test', '--bridge', $BridgePath)
Assert-GateOk -Result $r2Result -StepLabel 'R2 plan'
Save-GateLog -Result $r2Result -LogName 'r2-plan.log'
$R2 = Read-GatePlanValues -Result $r2Result
Assert-SameHashes -Left $R2 -LeftName 'R2' -Right $R1 -RightName 'R1'

# ---------------------------------------------------------------------------
# 13-15. LOAD #2, verify #2 (R2's own values), capture S3, assert S3 = S1 exactly.
# ---------------------------------------------------------------------------

Write-Host "`n==> 13. LOAD #2 (mutating, --no-seed --bridge)"
Invoke-Importer -ExtraArgs @('--bridge', $BridgePath) -LogName 'load2.log'

Write-Host "`n==> 14. Verify #2 (against R2's captured values)"
$v2Result = Invoke-Gate -GateArgs @(
  'verify', '--target', 'test', '--bridge', $BridgePath,
  '--expect-after-sha256', $R2.after, '--expect-picks-after-sha256', $R2.picks,
  '--expect-newly-linked-sha256', $R2.newly, '--expect-baseline-sha256', $R2.base,
  '--expect-batches-before', $R2.before
)
Assert-GateOk -Result $v2Result -StepLabel 'verify #2'
Save-GateLog -Result $v2Result -LogName 'verify2.log'
Assert-SameHashes -Left $R2 -LeftName 'R2' -Right $BASE -RightName 'BASE'

Write-Host "`n==> 15. Capture S3 and compare with S1"
Invoke-Snapshot -StageDir (Join-Path $EvidenceDir 'S3') -Dsn $env:AFLDB_TEST_DATABASE_URL
Assert-SnapshotsIdentical -LeftDir (Join-Path $EvidenceDir 'S1') -RightDir (Join-Path $EvidenceDir 'S3')

# ---------------------------------------------------------------------------
# 16. Final checks: import_batches grew by exactly 4; never substituted for a gate value.
# ---------------------------------------------------------------------------

Write-Host "`n==> 16. Final checks"
$finalResult = Invoke-Gate -GateArgs @('plan', '--target', 'test', '--bridge', $BridgePath)
Assert-GateOk -Result $finalResult -StepLabel 'final plan'
Save-GateLog -Result $finalResult -LogName 'final-plan.log'
$finalBefore = [int](Get-GateValue -Lines $finalResult.Output -Key 'import_batches_before')
if ($finalBefore -ne ($BASE.before + 4)) {
  throw ("STOP: import_batches grew by $($finalBefore - $BASE.before), not exactly 4 " +
    "(reverse/load/reverse/load) -- investigate before trusting this exercise")
}
Write-Host "    import_batches: $($BASE.before) -> $finalBefore (+4, as expected)"

Write-Host ("`n§7.4 EXERCISE COMPLETE: S0=S2 and S1=S3 (SHA-256, all six files each); R1, R2, " +
  "verify #1 and verify #2 all reproduce BASE's four hashes; import_batches +4 exactly. " +
  "Evidence: $EvidenceDir")
