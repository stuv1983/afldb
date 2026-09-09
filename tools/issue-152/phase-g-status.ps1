<#
.SYNOPSIS
    Read-only status of everything Phase G depends on.

.DESCRIPTION
    Answers "is this window ready, and what is it pointed at?" without changing
    anything: no git writes, no process is started or stopped, no database is
    touched, no corpus is regenerated, and no credential is printed.

.PARAMETER Port
    Port to probe. Default 3100.

.EXAMPLE
    .\tools\issue-152\phase-g-status.ps1
#>
[CmdletBinding()]
param([int] $Port = 3100)

$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'phase-g-common.ps1')

$repoRoot = Get-PhaseGRepoRoot
$paths = Get-PhaseGPaths -RepoRoot $repoRoot

function Get-DataLineCount {
    <# Data lines, not parsed rows: this is a status report, not a gate. The
       authoritative counts come from build-phase-g-corpora.ts, which parses
       the files and refuses a merge whose totals moved. #>
    param([Parameter(Mandatory)][string] $Path)
    if (-not (Test-Path $Path)) { return $null }
    $lines = @([System.IO.File]::ReadAllLines($Path) | Where-Object { $_.Trim().Length -gt 0 })
    return [Math]::Max(0, $lines.Count - 1)
}

Write-Host ''
Write-Host 'AFLDB-ISSUE-152 Phase G -- status (read-only)' -ForegroundColor Cyan
Write-Host '============================================='
Write-Host ("  repo root  {0}" -f $repoRoot)

# ------------------------------------------------------------------- git
Write-Host ''
Write-Host '-- git (read-only) --'
Push-Location $repoRoot
try {
    $previous = $ErrorActionPreference
    $ErrorActionPreference = 'Continue'
    try {
        $branch = (& git rev-parse --abbrev-ref HEAD) | Select-Object -First 1
        $head = (& git rev-parse --short HEAD) | Select-Object -First 1
        $dirty = @(& git status --porcelain)
        Write-Host ("  branch             {0}" -f $branch)
        Write-Host ("  HEAD               {0}" -f $head)
        Write-Host ("  working tree       {0} modified/untracked path(s)" -f $dirty.Count)
    } finally {
        $ErrorActionPreference = $previous
    }
} finally {
    Pop-Location
}

# ------------------------------------------------------------------ build
Write-Host ''
Write-Host '-- standalone build --'
if (Test-Path $paths.Standalone) {
    $built = (Get-Item $paths.Standalone).LastWriteTime
    Write-Host ("  server.js          present  ({0})" -f $built)
    $buildIdPath = Join-Path (Join-Path $repoRoot '.next') 'BUILD_ID'
    if (Test-Path $buildIdPath) {
        Write-Host ("  BUILD_ID           {0}" -f ([System.IO.File]::ReadAllText($buildIdPath).Trim()))
    }
} else {
    Write-Host ("  server.js          MISSING at {0}" -f $paths.Standalone) -ForegroundColor Yellow
    Write-Host '                     run `npm run build` (Phase G P1) before starting the server'
}

# ----------------------------------------------------------- pg tunnel
$tunnelPort = Get-PhaseGTunnelPort -EnvFile $paths.EnvFile
Write-Host ''
Write-Host "-- PostgreSQL tunnel $tunnelPort --"
$tunnel = Get-PhaseGTunnelState -Port $tunnelPort
if (-not $tunnel.Listening) {
    Write-Host '  not listening      Phase G PostgreSQL tunnel is not running.' -ForegroundColor Red
    Write-Host '                     Start window 1: .\tools\issue-152\phase-g-tunnel.ps1'
} else {
    foreach ($owner in $tunnel.Owners) {
        Write-Host ("  listening          {0}:{1}  PID {2}  ({3})" -f `
            $owner.LocalAddress, $owner.Port, $owner.ProcessId, $owner.ProcessName)
    }
    # Listening is not the same as forwarding: `ssh -L` can hold the socket
    # while the far end is gone, and that shape answers /search with 500.
    if ($tunnel.Reachable) {
        Write-Host '  connect test       OK -- accepts connections' -ForegroundColor Green
    } else {
        Write-Host '  connect test       REFUSED -- listening but not forwarding' -ForegroundColor Red
    }
    Write-Host '  (nothing is terminated by any script here)'
}

# ------------------------------------------------------------------- port
Write-Host ''
Write-Host "-- port $Port --"
$owners = @(Get-PortListener -Port $Port)
if ($owners.Count -eq 0) {
    Write-Host '  not listening      (start window 1: .\tools\issue-152\phase-g-server.ps1)'
} else {
    foreach ($owner in $owners) {
        Write-Host ("  listening          {0}:{1}  PID {2}  ({3})" -f `
            $owner.LocalAddress, $owner.Port, $owner.ProcessId, $owner.ProcessName)
    }
    Write-Host '  (nothing is terminated by any script here)'
}

# ---------------------------------------------------------------- corpora
Write-Host ''
Write-Host '-- corpora (tracked sources) --'
$newFamily = @(
    'afldb-ui-questions-coaching-v1-20260908.csv',
    'afldb-ui-questions-coaching-decline-v1-20260908.csv',
    'afldb-ui-questions-after-siren-v1-20260908.csv',
    'afldb-ui-questions-after-siren-decline-v1-20260908.csv',
    'afldb-ui-questions-first-kick-goal-v1-20260908.csv',
    'afldb-ui-questions-first-kick-goal-decline-v1-20260908.csv'
)
$regression = @(
    'afldb-ui-questions-1440-real-user-v3-20260822.csv',
    'afldb-ui-questions-60-real-user-decline-v3-20260822.csv'
)

foreach ($group in @(
    @{ Label = 'new family (P3)'; Files = $newFamily },
    @{ Label = 'existing gate (P4)'; Files = $regression }
)) {
    $total = 0
    Write-Host ("  {0}:" -f $group.Label)
    foreach ($file in $group.Files) {
        $path = Join-Path $repoRoot (Join-Path 'tests' (Join-Path 'nl-ui' (Join-Path 'corpora' $file)))
        $count = Get-DataLineCount -Path $path
        if ($null -eq $count) {
            Write-Host ("    MISSING  {0}" -f $file) -ForegroundColor Red
        } else {
            $total += $count
            Write-Host ("    {0,5}    {1}" -f $count, $file)
        }
    }
    Write-Host ("    {0,5}    TOTAL" -f $total)
}

Write-Host ''
Write-Host '-- corpora (generated, gitignored) --'
if (Test-Path $paths.CorporaDir) {
    foreach ($file in Get-ChildItem $paths.CorporaDir -Filter '*.csv') {
        Write-Host ("  {0,5} rows  {1}" -f (Get-DataLineCount -Path $file.FullName), $file.FullName)
    }
} else {
    Write-Host '  none yet -- the sweep scripts regenerate them from the tracked sources on every run'
}

# ------------------------------------------------------------------ output
Write-Host ''
Write-Host '-- preserved output --'
if (Test-Path $paths.LiveOut) {
    $observations = @(Get-ChildItem $paths.LiveOut -Filter 'observations*.jsonl' -ErrorAction SilentlyContinue)
    Write-Host ("  nl-ui-out/         {0} observation file(s) -- LIVE, cleared by the next non-resumed run" -f $observations.Count)
} else {
    Write-Host '  nl-ui-out/         absent'
}
$preserved = @()
if (Test-Path $paths.PhaseGOut) {
    # 'server' holds window-1 logs, not sweep evidence -- reported below.
    $preserved = @(Get-ChildItem $paths.PhaseGOut -Directory |
        Where-Object { $_.Name -ne 'corpora' -and $_.Name -ne 'server' })
}
if ($preserved.Count -eq 0) {
    Write-Host '  nl-ui-out-152-phaseg/  no preserved runs yet'
} else {
    foreach ($dir in $preserved) {
        Write-Host ("  {0,-18} {1}" -f $dir.Name, $dir.LastWriteTime)
    }
}

$serverLog = Get-PhaseGServerLog -Paths $paths
if ($serverLog) {
    Write-Host ("  server log         {0}  ({1:N0} bytes, {2})" -f `
        $serverLog.Name, $serverLog.Length, $serverLog.LastWriteTime)
} else {
    Write-Host '  server log         none yet -- window 1 writes one per run to nl-ui-out-152-phaseg/server/'
}

# --------------------------------------------------------------- environment
Write-Host ''
Write-Host '-- environment (credentials redacted) --'
try {
    $database = Resolve-PhaseGDatabaseEnv -EnvFile $paths.EnvFile
    Write-Host ("  .env DATABASE_URL       -> {0}" -f (Get-RedactedDsn -Dsn $database.EnvValues['DATABASE_URL']))
    Write-Host ("  Phase G DATABASE_URL    -> {0}" -f $database.AppDsnRedacted)
    Write-Host ("  Phase G AUTH DSN        -> {0}" -f $database.AuthDsnRedacted)
    foreach ($key in @('AFLDB_ENV', 'AFLDB_BETA_GATE', 'AFLDB_BASE_URL')) {
        $value = '<unset>'
        if ($database.EnvValues.Contains($key)) { $value = $database.EnvValues[$key] }
        Write-Host ("  .env {0,-18} {1}" -f $key, $value)
    }
} catch {
    Write-Host ("  .env unreadable: {0}" -f $_.Exception.Message) -ForegroundColor Yellow
}

Write-Host ''
Write-Host '  this shell (a stale value here silently changes a run):'
foreach ($key in @(
    'AFLDB_NL_RUN_TAG', 'NL_UI_RUN_TAG', 'AFLDB_E2E_BASE_URL', 'NL_UI_CORPUS',
    'NL_UI_LIMIT', 'NL_UI_REQUEST_DELAY_MS', 'NL_UI_WORKERS', 'NL_UI_BATCH',
    'NL_UI_APPEND', 'NL_UI_FAST', 'PORT'
)) {
    $value = [Environment]::GetEnvironmentVariable($key, 'Process')
    if ([string]::IsNullOrEmpty($value)) { $value = '<unset>' }
    $colour = 'Gray'
    if ($key -eq 'NL_UI_LIMIT' -and $value -ne '<unset>') { $colour = 'Yellow' }
    Write-Host ("    {0,-24} {1}" -f $key, $value) -ForegroundColor $colour
}

Write-Host ''
Write-Host '  AFLDB_NL_RUN_TAG is the SERVER gate (must be exactly `accept`);'
Write-Host '  NL_UI_RUN_TAG is the CLIENT label written to nl_search_log.run_tag.'
Write-Host ''
Write-Host ("  Playwright storage state: {0}" -f $(if (Test-Path $paths.AuthState) { 'present' } else { 'MISSING -- the nl-stress project needs it' }))
Write-Host ''
