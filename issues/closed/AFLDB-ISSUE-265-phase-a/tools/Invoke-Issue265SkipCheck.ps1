<#
.SYNOPSIS
  AFLDB-ISSUE-265: database-free proof that the Phase A harness skips, and opens no
  connection, when it is not armed by the runner.

.DESCRIPTION
  Every *DATABASE_URL, PG* and AFLDB_ISSUE265_* variable inherited by this process is
  saved and cleared, NODE_OPTIONS preloads tools\block-network.cjs (which refuses and logs
  every TCP connect in vitest and its workers), and the file is run twice:

    run 1 "clean":   nothing set.
    run 2 "inherited": AFLDB_ISSUE265_PHASE=A left over in the shell, a STALE arming stamp
                     (two hours old) and syntactically valid but fake DSNs naming
                     afldb_test at 127.0.0.1:9 (no credential; nothing listens; the preload
                     refuses the connect before it is attempted anyway).

  Pass = both runs report the file skipped (0 passed, 0 failed) and the network log holds
  no BLOCKED line. The process environment is restored in `finally`.
#>
[CmdletBinding()]
param(
  [string]$WorktreeRoot = 'D:\dev\afldb-issue-265',
  [string]$EvidenceRoot = 'D:\tmp\issue265\offline-checks'
)
$ErrorActionPreference = 'Stop'
Set-StrictMode -Version 2.0

$stamp = Get-Date -Format 'yyyyMMdd-HHmmss'
$runDir = Join-Path $EvidenceRoot "skipcheck-$stamp"
New-Item -ItemType Directory -Path $runDir -Force | Out-Null
$preload = Join-Path $PSScriptRoot 'block-network.cjs'
$suite = 'tests/integration/settle-promotion-deadlock.test.ts'

$saved = @{}
function Set-Managed([string]$Name, [string]$Value) {
  if (-not $saved.ContainsKey($Name)) { $saved[$Name] = [Environment]::GetEnvironmentVariable($Name, 'Process') }
  [Environment]::SetEnvironmentVariable($Name, $Value, 'Process')
}

$results = @()
try {
  if (Test-Path -LiteralPath (Join-Path $WorktreeRoot '.env')) { throw "$WorktreeRoot\.env exists; tests/setup.ts would load it." }
  $inherited = @(Get-ChildItem Env: | Where-Object { $_.Name -match '(DATABASE_URL$|^PG|^AFLDB_ISSUE265_)' } | ForEach-Object { $_.Name })
  foreach ($n in $inherited) { Set-Managed $n $null }
  "cleared for this check (restored at the end): $(if ($inherited.Count) { $inherited -join ', ' } else { 'none' })" | Tee-Object -FilePath (Join-Path $runDir 'summary.txt') -Append
  foreach ($n in @('NODE_OPTIONS', 'I265_NETBLOCK_LOG', 'NO_COLOR', 'FORCE_COLOR', 'AFLDB_ISSUE265_PHASE', 'AFLDB_ISSUE265_ARMED_AT',
                   'AFLDB_TEST_DATABASE_URL', 'AFLDB_AUTH_DATABASE_URL', 'AFLDB_TEST_IMPORT_DATABASE_URL')) { Set-Managed $n ([Environment]::GetEnvironmentVariable($n, 'Process')) }
  $netLog = Join-Path $runDir 'network.log'
  Set-Managed 'I265_NETBLOCK_LOG' $netLog
  Set-Managed 'NODE_OPTIONS' ("--require=" + ($preload -replace '\\', '/'))
  Set-Managed 'NO_COLOR' '1'
  Set-Managed 'FORCE_COLOR' '0'
  $vitest = Join-Path $WorktreeRoot 'node_modules\vitest\vitest.mjs'

  Push-Location -LiteralPath $WorktreeRoot
  try {
    foreach ($variant in @('clean', 'inherited')) {
      if ($variant -eq 'inherited') {
        Set-Managed 'AFLDB_ISSUE265_PHASE' 'A'
        Set-Managed 'AFLDB_ISSUE265_ARMED_AT' ([string]([DateTimeOffset]::UtcNow.AddHours(-2).ToUnixTimeMilliseconds()))
        $fake = 'postgres://issue265_offline_check@127.0.0.1:9/afldb_test'
        Set-Managed 'AFLDB_TEST_DATABASE_URL' $fake
        Set-Managed 'AFLDB_AUTH_DATABASE_URL' $fake
        Set-Managed 'AFLDB_TEST_IMPORT_DATABASE_URL' $fake
      }
      $log = Join-Path $runDir "vitest-$variant.log"
      $prev = $ErrorActionPreference; $ErrorActionPreference = 'Continue'
      & cmd.exe /d /s /c "node `"$vitest`" run $suite --reporter=verbose 2>&1" | Tee-Object -FilePath $log | Out-Host
      $code = $LASTEXITCODE
      $ErrorActionPreference = $prev
      $testsLine = (Get-Content -LiteralPath $log | Where-Object { $_ -match '^\s*Tests\s' } | Select-Object -Last 1)
      $filesLine = (Get-Content -LiteralPath $log | Where-Object { $_ -match '^\s*Test Files\s' } | Select-Object -Last 1)
      $results += [pscustomobject]@{ variant = $variant; exit = $code; files = "$filesLine".Trim(); tests = "$testsLine".Trim() }
    }
  } finally { Pop-Location }

  $blocked = @()
  $active = 0
  if (Test-Path -LiteralPath $netLog) {
    $blocked = @(Get-Content -LiteralPath $netLog | Where-Object { $_ -match 'BLOCKED' })
    $active = @(Get-Content -LiteralPath $netLog | Where-Object { $_ -match 'preload active' }).Count
  }
  $lines = @()
  foreach ($r in $results) { $lines += "run $($r.variant): exit $($r.exit); $($r.files); $($r.tests)" }
  $lines += "preload active in $active process(es); BLOCKED connection attempts: $($blocked.Count)"
  foreach ($b in $blocked) { $lines += "  $b" }
  $pass = ($blocked.Count -eq 0) -and ($active -gt 0) -and (@($results | Where-Object { $_.tests -notmatch 'skipped' -or $_.tests -match 'passed|failed' }).Count -eq 0)
  $lines += "OVERALL: $(if ($pass) { 'PASS (skipped, no connection attempt)' } else { 'FAIL' })"
  $lines | Tee-Object -FilePath (Join-Path $runDir 'summary.txt') -Append
  if (-not $pass) { exit 1 }
} finally {
  foreach ($name in @($saved.Keys)) { [Environment]::SetEnvironmentVariable($name, $saved[$name], 'Process') }
  "process environment restored ($($saved.Count) variable(s))"
}
