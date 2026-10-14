<#
.SYNOPSIS
  AFLDB-ISSUE-265 Phase A runner (afldb_test only; base tree, Option 3 NOT applied).

.DESCRIPTION
  Derived from D:\tmp\issue264\Invoke-Issue264Window.ps1 (copied; the original and its evidence
  are unchanged). Same secret-safe connection handling: settings are read from the main
  checkout's .env, only host, port and database are rewritten (to the tunnel endpoint and
  afldb_test), nothing is printed or written to evidence unredacted, and the process environment
  is restored in `finally`.

  Phases (stop at the first refusal):
    SelfTest   NO database contact: preconditions, the probe's selftest, and the guarded skip
               check (tools\Invoke-Issue265SkipCheck.ps1: the harness skips and attempts no
               connection when it is not armed).
    Preflight  read-only: 1 target proof (owner, import, auth: exactly afldb_test, at the tunnel
               endpoint, intended roles, one server); 2 window preflight (isolation, migration
               state recorded: State A or B both accepted, nothing else pending, NO migration is
               applied or restored by this runner); 3 baseline (residue in 2078 / every ISSUE-265
               namespace refuses; historical fingerprints incl. club_seasons with ids).
    Full       Preflight, then an isolation re-check, then ONLY
               tests/integration/settle-promotion-deadlock.test.ts, armed for this one launch
               (AFLDB_ISSUE265_PHASE=A + a fresh AFLDB_ISSUE265_ARMED_AT), then ALWAYS (pass or
               fail) the post-run census against the baseline, reconciled with the harness's
               evidence file. PASS needs: 1 file passed, 3 tests passed, 0 skipped, 0 failed,
               census CLEAN with exactly 3 retained admin-upload batches.
    Census     read-only: -BaselineFile (and -EvidenceFile if the harness wrote one) — the
               residue/fingerprint check for after an interrupted or failed window.

  It never runs a migration, never rebuilds a database, never runs Git, never touches DEV, PROD
  or code_test_db, never runs the season-2026 settle suites, never terminates sessions, never
  changes grants. The harness itself writes only its own tracked fixture rows and deletes only
  those (runbook §17.5).
#>
[CmdletBinding()]
param(
  [string]$WorktreeRoot = 'D:\dev\afldb-issue-265',
  [string]$EnvFile = 'D:\dev\afldb\.env',
  [ValidatePattern('^[A-Za-z0-9][A-Za-z0-9.-]*$')][string]$TunnelHost,
  [ValidateRange(0, 65535)][int]$TunnelPort = 0,
  [string]$EvidenceRoot = 'D:\tmp\issue265',
  [ValidateSet('SelfTest', 'Preflight', 'Full', 'Census')][string]$Phase = 'Preflight',
  [string]$BaselineFile,
  [string]$EvidenceFile
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version 2.0

$ExpectDb = 'afldb_test'
$Roles = @{ owner = 'afldb_owner'; import = 'afldb_import'; auth = 'afldb_auth' }
# The ONE suite this runner may launch. Nothing else is ever added here.
$Suite = 'tests/integration/settle-promotion-deadlock.test.ts'
$ExpectTests = 3
$ExpectRetained = 3
$ProbeScript = Join-Path $PSScriptRoot 'issue265-db-probe.mjs'
$SkipCheckScript = Join-Path $PSScriptRoot 'tools\Invoke-Issue265SkipCheck.ps1'

# ---------------------------------------------------------------- state ----

$script:Secrets = New-Object System.Collections.Generic.List[string]
$script:SavedEnv = @{}
$script:SavedEncoding = $null
$script:Results = New-Object System.Collections.Generic.List[object]
$script:Stopped = $null

function Protect-Line([string]$Text) {
  if ($null -eq $Text) { return '' }
  $out = $Text
  foreach ($s in $script:Secrets) { if ($s) { $out = $out.Replace($s, '[REDACTED]') } }
  return $out
}

function Add-Secret([string]$Dsn) {
  if (-not $Dsn) { return }
  $script:Secrets.Add($Dsn)
  $m = [regex]::Match($Dsn, '^[A-Za-z]+://[^:/@]+:(?<pw>[^@]+)@')
  if ($m.Success -and $m.Groups['pw'].Value.Length -ge 4) {
    $pw = $m.Groups['pw'].Value
    $script:Secrets.Add($pw)
    try { $script:Secrets.Add([Uri]::UnescapeDataString($pw)) } catch { }
  }
}

function Save-Env([string]$Name) {
  if (-not $script:SavedEnv.ContainsKey($Name)) {
    $script:SavedEnv[$Name] = [Environment]::GetEnvironmentVariable($Name, 'Process')
  }
}

function Set-ManagedEnv([string]$Name, [string]$Value) {
  Save-Env $Name
  [Environment]::SetEnvironmentVariable($Name, $Value, 'Process')
}

function Restore-AllEnv {
  foreach ($name in @($script:SavedEnv.Keys)) {
    [Environment]::SetEnvironmentVariable($name, $script:SavedEnv[$name], 'Process')
  }
}

function Write-Step([string]$Text) {
  $line = "== $Text"
  Write-Host ''
  Write-Host $line -ForegroundColor Cyan
  $script:Summary.WriteLine('')
  $script:Summary.WriteLine($line)
  $script:Summary.Flush()
}

function Write-Note([string]$Text) {
  $safe = Protect-Line $Text
  Write-Host $safe
  $script:Summary.WriteLine($safe)
  $script:Summary.Flush()
}

# Runs a native command line through cmd.exe (stderr merged, PowerShell 5.1 safe), redacting every
# line before it reaches the console or the log. Returns the exit code.
function Invoke-Logged([string]$Label, [string]$CommandLine) {
  $logPath = Join-Path $script:RunDir ("$Label.log")
  $writer = New-Object System.IO.StreamWriter($logPath, $false, (New-Object System.Text.UTF8Encoding($false)))
  $previous = $ErrorActionPreference
  $ErrorActionPreference = 'Continue'
  try {
    & cmd.exe /d /s /c "$CommandLine 2>&1" | ForEach-Object {
      $line = Protect-Line ([string]$_)
      $writer.WriteLine($line)
      Write-Host $line
    }
    $code = $LASTEXITCODE
  } finally {
    $ErrorActionPreference = $previous
    $writer.Dispose()
  }
  Write-Note "   [$Label] exit $code (log: $logPath)"
  return $code
}

function Invoke-Probe([string]$Label, [string]$Mode) {
  return Invoke-Logged $Label ("`"$script:NodeExe`" `"$ProbeScript`" $Mode")
}

# Parses each source URL in the probe (no database contact) and returns the derived afldb_test URLs.
# The probe's stdout (the URLs) is captured here and never displayed; its stderr carries notes only.
function Get-DerivedDsns([hashtable]$Sources) {
  foreach ($pair in @(@('owner', 'I265_SRC_OWNER'), @('import', 'I265_SRC_IMPORT'), @('auth', 'I265_SRC_AUTH'))) {
    Set-ManagedEnv $pair[1] $Sources[$pair[0]]
  }
  Set-ManagedEnv 'I265_TUNNEL_HOST' $TunnelHost
  Set-ManagedEnv 'I265_TUNNEL_PORT' ([string]$TunnelPort)
  $logPath = Join-Path $script:RunDir '00-derive.log'
  $previous = $ErrorActionPreference
  $ErrorActionPreference = 'Continue'
  try {
    $captured = & cmd.exe /d /s /c "`"$script:NodeExe`" `"$ProbeScript`" derive 2>`"$logPath`""
    $code = $LASTEXITCODE
  } finally {
    $ErrorActionPreference = $previous
    foreach ($n in @('I265_SRC_OWNER', 'I265_SRC_IMPORT', 'I265_SRC_AUTH')) { Set-ManagedEnv $n $null }
  }
  if (Test-Path -LiteralPath $logPath) {
    foreach ($line in [System.IO.File]::ReadAllLines($logPath)) { Write-Note $line }
  }
  Write-Note "   [00-derive] exit $code (log: $logPath)"
  if ($code -ne 0) { throw "Deriving the afldb_test connection settings failed (probe exit $code); nothing was contacted." }
  try { $parsed = (@($captured) -join "`n") | ConvertFrom-Json } catch { throw 'Deriving the afldb_test connection settings returned unreadable output.' }
  $out = @{}
  foreach ($k in @('owner', 'import', 'auth')) {
    if ($parsed.PSObject.Properties.Name -contains $k) { $out[$k] = [string]$parsed.$k }
    if (-not $out[$k]) { throw "Deriving the afldb_test connection settings returned no $k URL." }
  }
  return $out
}

function Read-ConnectionSettings([string]$Path) {
  $wanted = @(
    'AFLDB_TEST_DATABASE_URL', 'AFLDB_IMPORT_DATABASE_URL', 'AFLDB_AUTH_DATABASE_URL',
    'AFLDB_TEST_IMPORT_DATABASE_URL', 'AFLDB_TEST_AUTH_DATABASE_URL'
  )
  $found = @{}
  foreach ($rawLine in [System.IO.File]::ReadAllLines($Path)) {
    $line = $rawLine.Trim()
    if (-not $line -or $line.StartsWith('#')) { continue }
    if ($line.StartsWith('export ')) { $line = $line.Substring(7).TrimStart() }
    $eq = $line.IndexOf('=')
    if ($eq -lt 1) { continue }
    $key = $line.Substring(0, $eq).Trim()
    if ($wanted -notcontains $key) { continue }
    $value = $line.Substring($eq + 1).Trim().TrimEnd("`r")
    if ($value.Length -ge 2 -and (($value.StartsWith('"') -and $value.EndsWith('"')) -or ($value.StartsWith("'") -and $value.EndsWith("'")))) {
      $value = $value.Substring(1, $value.Length - 2)
    }
    if ($value) { $found[$key] = $value }
  }
  return $found
}

# Reads vitest's summary lines out of a log: "Test Files  1 passed (1)", "Tests  3 passed (3)".
function Get-TestCounts([string]$Label) {
  $path = Join-Path $script:RunDir "$Label.log"
  $counts = @{ passed = 0; failed = 0; skipped = 0; total = 0; line = ''; filesPassed = 0; filesLine = '' }
  if (-not (Test-Path -LiteralPath $path)) { return $counts }
  $lines = Get-Content -LiteralPath $path
  $line = $lines | Where-Object { $_ -match '^\s*Tests\s+' } | Select-Object -Last 1
  $files = $lines | Where-Object { $_ -match '^\s*Test Files\s+' } | Select-Object -Last 1
  $counts.line = [string]$line
  $counts.filesLine = [string]$files
  if ($line) {
    foreach ($k in @('passed', 'failed', 'skipped')) {
      $m = [regex]::Match($line, "(\d+) $k")
      if ($m.Success) { $counts[$k] = [int]$m.Groups[1].Value }
    }
    $t = [regex]::Match($line, '\((\d+)\)\s*$')
    if ($t.Success) { $counts.total = [int]$t.Groups[1].Value }
  }
  if ($files) {
    $m = [regex]::Match($files, '(\d+) passed')
    if ($m.Success) { $counts.filesPassed = [int]$m.Groups[1].Value }
  }
  return $counts
}

function Test-Census([string]$Label, [string]$Baseline, [string]$Evidence, [string]$ExpectRetainedText) {
  Set-ManagedEnv 'I265_OUT_FILE' (Join-Path $script:RunDir "$Label.json")
  Set-ManagedEnv 'I265_BASELINE_FILE' $Baseline
  Set-ManagedEnv 'I265_EVIDENCE_FILE' $Evidence
  Set-ManagedEnv 'I265_EXPECT_RETAINED' $ExpectRetainedText
  $code = Invoke-Probe $Label 'snapshot'
  if ($code -eq 0) { return 'clean' }
  if ($code -eq 3) { return 'dirty' }
  return 'error'
}

# ----------------------------------------------------------------- main ----

$stamp = Get-Date -Format 'yyyyMMdd-HHmmss'
$script:RunDir = Join-Path $EvidenceRoot "run-$stamp-$Phase"
New-Item -ItemType Directory -Path $script:RunDir -Force | Out-Null
$script:Summary = New-Object System.IO.StreamWriter((Join-Path $script:RunDir 'summary.txt'), $false, (New-Object System.Text.UTF8Encoding($false)))
$exitCode = 1

try {
  $script:SavedEncoding = [Console]::OutputEncoding
  [Console]::OutputEncoding = New-Object System.Text.UTF8Encoding($false)

  Write-Step "AFLDB-ISSUE-265 Phase A runner, phase $Phase, $stamp"
  Write-Note "worktree: $WorktreeRoot"
  Write-Note "evidence: $script:RunDir"
  if ($Phase -ne 'SelfTest') {
    if (-not $TunnelHost -or $TunnelPort -lt 1) { throw "-TunnelHost and -TunnelPort are required for phase $Phase." }
    Write-Note "tunnel endpoint: ${TunnelHost}:$TunnelPort"
  }

  # --- preconditions (no database contact) ---------------------------------
  Write-Step 'Preconditions (no database contact)'
  if (-not (Test-Path -LiteralPath (Join-Path $WorktreeRoot 'package.json'))) { throw "No package.json in $WorktreeRoot." }
  if (Test-Path -LiteralPath (Join-Path $WorktreeRoot '.env')) {
    throw "$WorktreeRoot\.env exists. Remove it first: tests/setup.ts would load it, and the run must not depend on a copied .env."
  }
  if (-not (Test-Path -LiteralPath (Join-Path $WorktreeRoot 'node_modules\vitest\vitest.mjs'))) { throw 'node_modules\vitest is missing in the worktree.' }
  if (-not (Test-Path -LiteralPath (Join-Path $WorktreeRoot 'node_modules\postgres'))) { throw 'node_modules\postgres is missing in the worktree.' }
  $suitePath = Join-Path $WorktreeRoot $Suite
  if (-not (Test-Path -LiteralPath $suitePath)) { throw "Missing suite $Suite." }
  $suiteText = [System.IO.File]::ReadAllText($suitePath)
  if ($suiteText -notmatch 'AFLDB_ISSUE265_ARMED_AT' -or $suiteText -notmatch "const TARGET_DB = 'afldb_test'") {
    throw 'The suite is not the armed, exact-target harness this runner was written for (runbook §17.9).'
  }
  # A read or import of the season-2026 AFL API samples needs a quoted path; the header comment that says
  # they are NOT read does not quote one.
  if ($suiteText -match "['""``][^'""``\r\n]*fixtures[\\/]+afl_api") { throw 'The suite reads the season-2026 AFL API fixtures; refused.' }
  if (-not (Test-Path -LiteralPath $ProbeScript)) { throw "Missing helper $ProbeScript." }
  $script:NodeExe = (Get-Command node -ErrorAction Stop).Source
  Write-Note "node: $script:NodeExe"
  Write-Note "suite: $Suite (the only suite this runner launches)"
  Write-Note 'preconditions OK'

  # --- isolate the process environment ----------------------------------------
  $inherited = @(Get-ChildItem Env: | Where-Object { $_.Name -match '(DATABASE_URL$|^PG[A-Z]+$|^AFLDB_ISSUE265_|^I265_)' } | ForEach-Object { $_.Name })
  foreach ($n in $inherited) { Set-ManagedEnv $n $null }
  Write-Note ("cleared for this run (restored at the end): " + $(if ($inherited.Count) { $inherited -join ', ' } else { 'none' }))
  foreach ($n in @('I265_ROOT', 'I265_EXPECT_DB', 'I265_OWNER', 'I265_IMPORT', 'I265_AUTH',
      'I265_EXPECT_OWNER', 'I265_EXPECT_IMPORT', 'I265_EXPECT_AUTH', 'I265_EXPECT_ENDPOINT',
      'I265_OUT_FILE', 'I265_BASELINE_FILE', 'I265_EVIDENCE_FILE', 'I265_EXPECT_RETAINED',
      'I265_SRC_OWNER', 'I265_SRC_IMPORT', 'I265_SRC_AUTH', 'I265_TUNNEL_HOST', 'I265_TUNNEL_PORT',
      'NO_COLOR', 'FORCE_COLOR', 'NODE_OPTIONS',
      'DATABASE_URL', 'AFLDB_TEST_DATABASE_URL', 'AFLDB_TEST_IMPORT_DATABASE_URL',
      'AFLDB_IMPORT_DATABASE_URL', 'AFLDB_AUTH_DATABASE_URL',
      'AFLDB_ISSUE265_PHASE', 'AFLDB_ISSUE265_ARMED_AT', 'AFLDB_ISSUE265_EXPECT_ENDPOINT',
      'AFLDB_ISSUE265_EXPECT_OWNER_ROLE', 'AFLDB_ISSUE265_EXPECT_IMPORT_ROLE', 'AFLDB_ISSUE265_EXPECT_AUTH_ROLE',
      'AFLDB_ISSUE265_EVIDENCE_FILE')) {
    Save-Env $n
  }
  # A preload from the operator's shell must not alter the window (the skip check sets its own).
  Set-ManagedEnv 'NODE_OPTIONS' $null
  Set-ManagedEnv 'NO_COLOR' '1'
  Set-ManagedEnv 'FORCE_COLOR' '0'
  Set-ManagedEnv 'I265_ROOT' $WorktreeRoot
  Set-ManagedEnv 'I265_EXPECT_DB' $ExpectDb

  # --- phase: self-test (no database contact) --------------------------------------------
  if ($Phase -eq 'SelfTest') {
    Write-Step 'Probe selftest (no database contact)'
    $probeCode = Invoke-Probe '01-probe-selftest' 'selftest'
    Write-Step 'Guarded skip check (no database contact; TCP connects refused and logged)'
    $prev = $ErrorActionPreference; $ErrorActionPreference = 'Continue'
    & powershell.exe -NoProfile -ExecutionPolicy Bypass -File $SkipCheckScript -WorktreeRoot $WorktreeRoot -EvidenceRoot $script:RunDir 2>&1 |
      ForEach-Object { Write-Note ([string]$_) }
    $skipCode = $LASTEXITCODE
    $ErrorActionPreference = $prev
    $script:Results.Add([pscustomobject]@{ step = 'probe selftest'; exit = $probeCode; check = '-' })
    $script:Results.Add([pscustomobject]@{ step = 'skip check'; exit = $skipCode; check = '-' })
    if ($probeCode -ne 0 -or $skipCode -ne 0) { $script:Stopped = 'self-test failed'; throw $script:Stopped }
    $exitCode = 0
    return
  }

  # --- load and derive (values never printed) ---------------------------------
  Write-Step 'Connection settings (values never printed)'
  if (-not (Test-Path -LiteralPath $EnvFile)) { throw "Missing settings file $EnvFile." }
  $src = Read-ConnectionSettings $EnvFile
  Write-Note ("keys found: " + (($src.Keys | Sort-Object) -join ', '))
  if (-not $src.ContainsKey('AFLDB_TEST_DATABASE_URL')) { throw 'AFLDB_TEST_DATABASE_URL not found in the settings file.' }
  foreach ($v in $src.Values) { Add-Secret $v }
  $sources = @{ owner = $src['AFLDB_TEST_DATABASE_URL'] }
  Write-Note 'owner: AFLDB_TEST_DATABASE_URL'
  if ($src.ContainsKey('AFLDB_TEST_IMPORT_DATABASE_URL')) {
    $sources.import = $src['AFLDB_TEST_IMPORT_DATABASE_URL']; Write-Note 'import: AFLDB_TEST_IMPORT_DATABASE_URL'
  } elseif ($src.ContainsKey('AFLDB_IMPORT_DATABASE_URL')) {
    $sources.import = $src['AFLDB_IMPORT_DATABASE_URL']; Write-Note 'import: AFLDB_IMPORT_DATABASE_URL'
  } else { throw 'No import-role setting found.' }
  if ($src.ContainsKey('AFLDB_TEST_AUTH_DATABASE_URL')) {
    $sources.auth = $src['AFLDB_TEST_AUTH_DATABASE_URL']; Write-Note 'auth: AFLDB_TEST_AUTH_DATABASE_URL'
  } elseif ($src.ContainsKey('AFLDB_AUTH_DATABASE_URL')) {
    $sources.auth = $src['AFLDB_AUTH_DATABASE_URL']; Write-Note 'auth: AFLDB_AUTH_DATABASE_URL'
  } else { throw 'No auth-role setting found.' }
  $src = $null

  Write-Step "Derive afldb_test connections via ${TunnelHost}:$TunnelPort (no database contact)"
  $derived = Get-DerivedDsns $sources
  $sources = $null
  $ownerDsn = $derived['owner']; $importDsn = $derived['import']; $authDsn = $derived['auth']
  $derived = $null
  foreach ($d in @($ownerDsn, $importDsn, $authDsn)) { Add-Secret $d }
  $endpoint = "{0}:{1}" -f $TunnelHost.ToLowerInvariant(), $TunnelPort

  Set-ManagedEnv 'I265_EXPECT_ENDPOINT' $endpoint
  Set-ManagedEnv 'I265_OWNER' $ownerDsn;   Set-ManagedEnv 'I265_EXPECT_OWNER' $Roles.owner
  Set-ManagedEnv 'I265_IMPORT' $importDsn; Set-ManagedEnv 'I265_EXPECT_IMPORT' $Roles.import
  Set-ManagedEnv 'I265_AUTH' $authDsn;     Set-ManagedEnv 'I265_EXPECT_AUTH' $Roles.auth

  Push-Location -LiteralPath $WorktreeRoot
  try {
    # --- 1. targets, BEFORE anything else touches the database ------------------
    Write-Step 'Target proof (read-only): owner, import, auth'
    if ((Invoke-Probe '01-targets' 'targets') -ne 0) {
      $script:Stopped = 'target proof refused or failed; nothing was written'
      throw $script:Stopped
    }

    # --- phase: census only ---------------------------------------------------------
    if ($Phase -eq 'Census') {
      if (-not $BaselineFile -or -not (Test-Path -LiteralPath $BaselineFile)) { throw '-Phase Census needs -BaselineFile <baseline.json>.' }
      $ev = $(if ($EvidenceFile -and (Test-Path -LiteralPath $EvidenceFile)) { $EvidenceFile } else { $null })
      Write-Step "Census (read-only) against $BaselineFile$(if ($ev) { " with evidence $ev" } else { ' (no harness evidence: every new batch is unattributed)' })"
      $state = Test-Census '02-census' $BaselineFile $ev $null
      $script:Results.Add([pscustomobject]@{ step = 'census'; exit = 0; check = $state })
      if ($state -ne 'clean') { $script:Stopped = "census is $state"; throw $script:Stopped }
      $exitCode = 0
      return
    }

    # --- 2. window preflight ----------------------------------------------------------
    Write-Step 'Window preflight (read-only): isolation, migration state (recorded, never changed), settings'
    Set-ManagedEnv 'I265_OUT_FILE' (Join-Path $script:RunDir 'preflight.json')
    if ((Invoke-Probe '02-preflight' 'preflight') -ne 0) {
      $script:Stopped = 'window preflight refused or failed; nothing was written'
      throw $script:Stopped
    }

    # --- 3. baseline -------------------------------------------------------------------
    Write-Step 'Baseline (read-only): collision census and historical fingerprints'
    $baseline = Join-Path $script:RunDir 'baseline.json'
    Set-ManagedEnv 'I265_OUT_FILE' $baseline
    Set-ManagedEnv 'I265_BASELINE_FILE' $null
    Set-ManagedEnv 'I265_EVIDENCE_FILE' $null
    if ((Invoke-Probe '03-baseline' 'snapshot') -ne 0) {
      $script:Stopped = 'baseline refused (ISSUE-265 residue or collision before the run) or failed; nothing was written'
      throw $script:Stopped
    }
    if ($Phase -eq 'Preflight') { $exitCode = 0; return }

    # --- 4. isolation immediately before the launch ------------------------------------
    Write-Step 'Isolation re-check immediately before the launch'
    if ((Invoke-Probe '04-isolation' 'isolation') -ne 0) {
      $script:Stopped = 'isolation could not be proved immediately before the launch; nothing was written'
      throw $script:Stopped
    }

    # --- 5. Phase A, armed for this one launch only --------------------------------------
    $harnessEvidence = Join-Path $script:RunDir 'harness-evidence.json'
    Set-ManagedEnv 'AFLDB_TEST_DATABASE_URL' $ownerDsn
    Set-ManagedEnv 'AFLDB_TEST_IMPORT_DATABASE_URL' $importDsn
    Set-ManagedEnv 'AFLDB_AUTH_DATABASE_URL' $authDsn
    Set-ManagedEnv 'AFLDB_ISSUE265_EXPECT_ENDPOINT' $endpoint
    Set-ManagedEnv 'AFLDB_ISSUE265_EXPECT_OWNER_ROLE' $Roles.owner
    Set-ManagedEnv 'AFLDB_ISSUE265_EXPECT_IMPORT_ROLE' $Roles.import
    Set-ManagedEnv 'AFLDB_ISSUE265_EXPECT_AUTH_ROLE' $Roles.auth
    Set-ManagedEnv 'AFLDB_ISSUE265_EVIDENCE_FILE' $harnessEvidence
    Set-ManagedEnv 'AFLDB_ISSUE265_PHASE' 'A'
    Set-ManagedEnv 'AFLDB_ISSUE265_ARMED_AT' ([string]([DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds()))
    Write-Step "Phase A: $Suite (armed for this launch; disarmed immediately after)"
    $code = Invoke-Logged '05-phase-a' ("`"$script:NodeExe`" node_modules\vitest\vitest.mjs run $Suite --reporter=verbose")
    foreach ($n in @('AFLDB_ISSUE265_PHASE', 'AFLDB_ISSUE265_ARMED_AT', 'AFLDB_TEST_DATABASE_URL',
        'AFLDB_TEST_IMPORT_DATABASE_URL', 'AFLDB_AUTH_DATABASE_URL')) { Set-ManagedEnv $n $null }
    $counts = Get-TestCounts '05-phase-a'
    Write-Note "   files: $($counts.filesLine.Trim())"
    Write-Note "   tests: $($counts.line.Trim())"
    $suiteOk = ($code -eq 0) -and ($counts.filesPassed -eq 1) -and ($counts.passed -eq $ExpectTests) -and ($counts.failed -eq 0) -and ($counts.skipped -eq 0)

    # --- 6. ALWAYS: the post-run census, success or failure -------------------------------
    Write-Step 'Post-run census (read-only; runs after a failure too)'
    $ev = $(if (Test-Path -LiteralPath $harnessEvidence) { $harnessEvidence } else { $null })
    $expect = $(if ($suiteOk) { [string]$ExpectRetained } else { $null })
    $state = Test-Census '06-post-census' $baseline $ev $expect
    $script:Results.Add([pscustomobject]@{ step = $Suite; exit = $code; check = $state })
    if (-not $suiteOk) {
      $script:Stopped = "Phase A did not pass as expected (exit $code; expected 1 file and $ExpectTests tests passed, 0 skipped, 0 failed; got: $($counts.line.Trim())); post-run census: $state"
      throw $script:Stopped
    }
    if ($state -ne 'clean') { $script:Stopped = "post-run census is $state"; throw $script:Stopped }
    $exitCode = 0
  } finally {
    Pop-Location
  }
} catch {
  $msg = Protect-Line ($_.Exception.Message)
  if (-not $script:Stopped) { $script:Stopped = $msg }
  Write-Host ''
  Write-Host "STOPPED: $msg" -ForegroundColor Red
  $script:Summary.WriteLine("STOPPED: $msg")
} finally {
  Restore-AllEnv
  if ($null -ne $script:SavedEncoding) { [Console]::OutputEncoding = $script:SavedEncoding }
  $ownerDsn = $null; $importDsn = $null; $authDsn = $null; $sources = $null; $derived = $null
  $script:Secrets.Clear()

  $script:Summary.WriteLine('')
  $script:Summary.WriteLine('== Results')
  foreach ($r in $script:Results) { $script:Summary.WriteLine(("{0}: exit {1}, check {2}" -f $r.step, $r.exit, $r.check)) }
  $script:Summary.WriteLine('migrations applied or restored by this run: none (Phase A does not need migration 110)')
  if ($exitCode -eq 0) { $script:Summary.WriteLine("OVERALL: PASS ($Phase)") } else { $script:Summary.WriteLine("OVERALL: STOPPED - $script:Stopped") }
  $script:Summary.Dispose()

  Write-Host ''
  foreach ($r in $script:Results) { Write-Host ("{0}: exit {1}, check {2}" -f $r.step, $r.exit, $r.check) }
  if ($exitCode -eq 0) { Write-Host "OVERALL: PASS ($Phase)" -ForegroundColor Green } else { Write-Host "OVERALL: STOPPED - $script:Stopped" -ForegroundColor Red }
  Write-Host "Evidence: $script:RunDir"
  Write-Host 'Process environment restored.'
  exit $exitCode
}
exit $exitCode
