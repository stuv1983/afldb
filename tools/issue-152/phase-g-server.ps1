<#
.SYNOPSIS
    Window 2 of the AFLDB-ISSUE-152 Phase G workflow: the server under test.

.DESCRIPTION
    Starts the SUPPORTED standalone runtime -- `node .next/standalone/server.js`
    -- against afldb_test, with the run-tag gate open, and blocks in the
    foreground until Ctrl+C.

    Everything the server prints is shown live AND appended to a per-run log
    under nl-ui-out-152-phaseg/server/. A rendered 500 explains itself only in
    this process's stderr: the Playwright sweep records `http_error` and the
    browser console line, and nothing else anywhere captures the exception.
    Losing that output to a closed console window cost ISSUE-152 a diagnosis
    on 2026-09-09.

    Not `npx next start`: next.config.ts sets `output: 'standalone'`, and Next
    warns that `next start` does not use it. The standalone bundle is what the
    droplet runs (deploy/server-cluster.mjs forks this same server), so it is
    also what rendered acceptance should measure.

    afldb_test, not DEV: DEV serves `main`, which has no coach_record grain, no
    after_siren grain and no Phase E wording, so a DEV sweep would measure the
    wrong code (ISSUE-152 section 19.1). The DSNs are derived from the existing .env by
    swapping ONLY the database segment, keeping the same host, port, role and
    password -- so no credential is ever typed into a command block, and the
    afldb_app read grants on the new tables stay part of what is under test.

    The standalone server chdir's into .next/standalone/ and reads the .env COPY
    sitting there, which is a build-time snapshot pointing at afldb_dev. That
    copy cannot win: @next/env never overwrites a variable already present in
    the process, and this script exports the real values before starting node.

.PARAMETER Port
    Default 3100. Refuses to start if the port is already listening, and names
    the owning PID -- it never terminates anything.

.PARAMETER BindHost
    Default 127.0.0.1. The sweep is local and the rate limiter is per client IP,
    so there is no reason to expose this build on the LAN.

.PARAMETER Database
    Default afldb_test.

.PARAMETER NoRunTag
    Starts WITHOUT AFLDB_NL_RUN_TAG=accept. Only for a run whose rows should be
    indistinguishable from real traffic; a Phase G sweep started this way logs
    every question with run_tag NULL and cannot be verified in nl_search_log.

.EXAMPLE
    .\tools\issue-152\phase-g-server.ps1
#>
[CmdletBinding()]
param(
    [int] $Port = 3100,
    [string] $BindHost = '127.0.0.1',
    [string] $Database = 'afldb_test',
    [switch] $NoRunTag
)

$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'phase-g-common.ps1')

$repoRoot = Get-PhaseGRepoRoot
$paths = Get-PhaseGPaths -RepoRoot $repoRoot

if (-not (Test-Path $paths.Standalone)) {
    throw ("No standalone build at $($paths.Standalone).`n" +
           "  Build it first (P1 of Phase G):  npm run build")
}

Assert-PortFree -Port $Port

<#
  $dbEnv, NOT $database: `[string] $Database` in the param block above is the
  same variable (PowerShell names are case-insensitive) and keeps its type
  constraint for the whole script, so `$database = <hashtable>` would coerce the
  result to a string and every member would read back $null. Assert-PhaseGDatabaseEnv
  names that failure if it ever returns.
#>
$dbEnv = Resolve-PhaseGDatabaseEnv -EnvFile $paths.EnvFile -Database $Database
Assert-PhaseGDatabaseEnv -Resolved $dbEnv -Database $Database

<#
  BEFORE node, not after. Every Phase G DSN reaches PostgreSQL through the SSH
  forward held by window 1, and a server started without it does not fail --
  it serves the 1,472 prerendered routes with HTTP 200 and answers every
  force-dynamic page with a 500 that the sweep scores as forty failed
  questions. Refusing here costs one line; not refusing cost ISSUE-152 a smoke
  run and a day (section 19.7).
#>
$tunnelPort = Get-PhaseGTunnelPort -EnvFile $paths.EnvFile
Assert-PhaseGTunnel -Port $tunnelPort

<#
  The whole .env first, then the Phase G overrides on top.

  The standalone bundle is not the repository: it has no next.config.ts, no
  src/, and its own stale .env. Exporting the operator's real .env keeps the
  session secret, beta-gate setting and base URL identical to `npm run dev`,
  and the overrides below are then the only difference between this process
  and an ordinary local run.
#>
$exports = [ordered]@{}
foreach ($key in $dbEnv.EnvValues.Keys) { $exports[$key] = $dbEnv.EnvValues[$key] }

$exports['DATABASE_URL'] = $dbEnv.AppDsn
$exports['AFLDB_AUTH_DATABASE_URL'] = $dbEnv.AuthDsn
$exports['PORT'] = "$Port"
$exports['HOSTNAME'] = $BindHost

if ($NoRunTag) {
    $exports['AFLDB_NL_RUN_TAG'] = $null
} else {
    # SERVER-side gate. Without the literal value `accept`, /search discards the
    # sweep's x-afldb-run-tag header and the run has no telemetry provenance.
    $exports['AFLDB_NL_RUN_TAG'] = 'accept'
}

# Deliberately NOT set here: NL_UI_RUN_TAG is the client-side label the sweep
# sends as a header. It belongs to the Playwright process, not to the server.

$null = Push-PhaseGEnv -Values $exports

$logPath = New-PhaseGServerLogPath -Paths $paths

Write-Host ''
Write-Host 'AFLDB-ISSUE-152 Phase G -- server (window 1)' -ForegroundColor Cyan
Write-Host '--------------------------------------------'
Write-Host ("  repo root          {0}" -f $repoRoot)
Write-Host ("  runtime            node .next/standalone/server.js  (output: standalone)")
Write-Host ("  listening on       http://{0}:{1}" -f $BindHost, $Port)
Write-Host ("  DATABASE_URL       {0}" -f $dbEnv.AppDsnRedacted)
Write-Host ("  AFLDB_AUTH_DB_URL  {0}" -f $dbEnv.AuthDsnRedacted)
Write-Host ("  pg tunnel          127.0.0.1:{0}  reachable" -f $tunnelPort)
if ($NoRunTag) {
    Write-Host ("  AFLDB_NL_RUN_TAG   <unset>  -- nl_search_log.run_tag will be NULL for this run") -ForegroundColor Yellow
} else {
    Write-Host ("  AFLDB_NL_RUN_TAG   accept   -- the sweep's x-afldb-run-tag header is honoured")
}
Write-Host ("  AFLDB_BETA_GATE    {0}" -f $(if ($dbEnv.EnvValues.Contains('AFLDB_BETA_GATE')) { $dbEnv.EnvValues['AFLDB_BETA_GATE'] } else { '<unset>' }))
Write-Host ("  AFLDB_ENV          {0}" -f $(if ($dbEnv.EnvValues.Contains('AFLDB_ENV')) { $dbEnv.EnvValues['AFLDB_ENV'] } else { '<unset>' }))
Write-Host ("  server log         {0}" -f $logPath)
Write-Host ''
Write-Host '  Passwords are never printed, to the console or the log.'
Write-Host '  Ctrl+C stops the server; nothing else is stopped.'
Write-Host ''
Write-Host 'Next, in window 3:' -ForegroundColor Cyan
Write-Host '  .\tools\issue-152\phase-g-verify.ps1'
Write-Host '  .\tools\issue-152\phase-g-smoke.ps1 -RunTag issue152-phaseg-smoke-r2'
Write-Host ''

<#
  HOW THE LOG IS CAPTURED, and why it looks like this under Windows PowerShell 5.1.

  `cmd /c "... 2>&1"`, not `& node ... 2>&1`:
      5.1 turns a native command's stderr into ErrorRecords when PowerShell
      itself does the redirect. Under this script's $ErrorActionPreference =
      'Stop' the FIRST stderr line would abort the script -- and the first
      stderr line from a Next server is precisely the stack trace being hunted.
      Merging inside cmd hands PowerShell one ordinary stdout stream instead,
      so nothing is wrapped, decorated, reordered or fatal.

  A pipeline, not Start-Process -RedirectStandardOutput:
      Start-Process writes the file but shows nothing live, and -NoNewWindow
      cannot do both. Requirement 1 (visible in window 1) and requirement 2
      (persisted) have to be satisfied by the same stream.

  A StreamWriter, not Tee-Object:
      5.1's Tee-Object has no -Encoding and writes UTF-16.

  [Console]::OutputEncoding:
      5.1 decodes native output with the OEM code page, so a name like
      "Ablett-O'Connor" or an em dash inside an exception message would reach
      the log as mojibake. Restored in the finally block.
#>
$previousOutputEncoding = [Console]::OutputEncoding
$writer = New-PhaseGLogWriter -Path $logPath

Push-Location $repoRoot
try {
    # Throws when this session has no real console (output redirected to a
    # file, or started by a scheduler). Mojibake in one edge case is not worth
    # refusing to start the server over.
    try { [Console]::OutputEncoding = New-Object System.Text.UTF8Encoding($false) } catch { }

    # Header: run provenance only. Every DSN here has been through
    # Get-RedactedDsn, and no other environment value is written.
    $writer.WriteLine('=== AFLDB-ISSUE-152 Phase G standalone server ===')
    $writer.WriteLine(('started       {0:yyyy-MM-ddTHH:mm:ss.fffK}' -f (Get-Date)))
    $writer.WriteLine(('repo root     {0}' -f $repoRoot))
    $writer.WriteLine(('listening on  http://{0}:{1}' -f $BindHost, $Port))
    $writer.WriteLine(('DATABASE_URL  {0}' -f $dbEnv.AppDsnRedacted))
    $writer.WriteLine(('AUTH DSN      {0}' -f $dbEnv.AuthDsnRedacted))
    $writer.WriteLine(('run-tag gate  {0}' -f $(if ($NoRunTag) { '<unset>' } else { 'accept' })))
    $writer.WriteLine('=================================================')

    & cmd /c 'node .next\standalone\server.js 2>&1' | ForEach-Object {
        $line = [string]$_
        # -Object explicitly: a server line that begins with a dash (a `----`
        # separator, a `--flag` in a usage message) would otherwise be parsed
        # as a parameter and stop the server on its own output.
        Write-Host -Object $line
        $writer.WriteLine(('{0:HH:mm:ss.fff} {1}' -f (Get-Date), $line))
    }
    $exit = $LASTEXITCODE

    $writer.WriteLine(('{0:HH:mm:ss.fff} === server exited with code {1} ===' -f (Get-Date), $exit))
} finally {
    # AutoFlush means nothing is lost even when Ctrl+C skips this block.
    if ($writer) { $writer.Dispose() }
    try { [Console]::OutputEncoding = $previousOutputEncoding } catch { }
    Pop-Location
}

Write-Host ''
Write-Host ("Server output was preserved at {0}" -f $logPath) -ForegroundColor DarkGray

if ($exit -ne 0) { throw "The standalone server exited with code $exit." }
