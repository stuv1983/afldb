<#
.SYNOPSIS
    Read-only diagnosis of a failing Phase G window-1 server.

.DESCRIPTION
    Answers "what is actually serving port 3100, what does it say to three
    requests, and what did it print while saying it?" -- in one command, with
    no side effects at all:

      * no process is started, stopped, signalled or killed
      * no database is touched (every probe is an HTTP GET)
      * no git command runs
      * nothing is written anywhere; the server log is opened read-only, with
        FileShare.ReadWrite so the running server keeps appending to it
      * no credential is printed

    The three probes are chosen to bisect the failure, not to measure
    semantics:

      /                             a build-time prerender (1 of 1472 in
                                    prerender-manifest.json). 200 here proves
                                    the process, the bundle and the static
                                    assets -- and NOTHING about the database.

      /search                       force-dynamic, but with no `q` the page
                                    runs getSiteSettings() alone: no parser,
                                    no planner, no new-family tables. A 500
                                    here is upstream of every NL question.

      /search?q=who coached Richmond  the full pipeline on a Phase G question.

    Three requests is also deliberate: the limiter allows 30/60s per IP
    (src/app/search/rate-limit.ts), so this can be run repeatedly without
    measuring the limiter instead of the fault.

.PARAMETER Port
    Port to diagnose. Default 3100.

.PARAMETER BindHost
    Host to probe. Default 127.0.0.1.

.PARAMETER Tail
    Log lines to show when the probes produce no new output. Default 60.

.EXAMPLE
    .\tools\issue-152\phase-g-diagnose.ps1
#>
[CmdletBinding()]
param(
    [int] $Port = 3100,
    [string] $BindHost = '127.0.0.1',
    [int] $Tail = 60
)

$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'phase-g-common.ps1')

$repoRoot = Get-PhaseGRepoRoot
$paths = Get-PhaseGPaths -RepoRoot $repoRoot
$baseUrl = 'http://{0}:{1}' -f $BindHost, $Port

function Get-ProcessCommandLine {
    <# Win32_Process rather than Get-Process: only CIM carries the command
       line, which is the difference between "a node.exe" and "the standalone
       Phase G server". Read-only, and no elevation is needed for a process
       the current user owns. #>
    param([Parameter(Mandatory)][int] $ProcessId)
    try {
        return (Get-CimInstance Win32_Process -Filter "ProcessId = $ProcessId" -ErrorAction Stop).CommandLine
    } catch {
        return $null
    }
}

function Invoke-PhaseGProbe {
    <#
    .SYNOPSIS
        One GET, reported rather than thrown.
    .DESCRIPTION
        HttpWebRequest, not Invoke-WebRequest: Windows PowerShell 5.1's
        Invoke-WebRequest THROWS on 4xx/5xx and on a redirect when
        -MaximumRedirection 0, so the status code -- the entire point of this
        script -- arrives as an exception to be unwrapped. This asks directly
        and treats 500 and 307 as ordinary answers.

        AllowAutoRedirect is off so a beta-gate 307 is reported as a 307
        rather than silently followed to a login page that returns 200.
    #>
    param(
        [Parameter(Mandatory)][string] $Label,
        [Parameter(Mandatory)][string] $Url,
        [int] $TimeoutSec = 30
    )

    $result = [ordered]@{
        Label = $Label; Url = $Url; Status = $null; Note = ''
        ElapsedMs = 0; Location = $null; Digest = $null; Bytes = 0
    }

    $request = [System.Net.HttpWebRequest]::Create($Url)
    $request.Method = 'GET'
    $request.AllowAutoRedirect = $false
    $request.Timeout = $TimeoutSec * 1000
    $request.ReadWriteTimeout = $TimeoutSec * 1000
    $request.UserAgent = 'afldb-phase-g-diagnose'

    $watch = [System.Diagnostics.Stopwatch]::StartNew()
    $response = $null
    try {
        try {
            $response = $request.GetResponse()
        } catch [System.Net.WebException] {
            # A 4xx/5xx still carries a full response here.
            if ($_.Exception.Response) {
                $response = $_.Exception.Response
            } else {
                $result.Note = $_.Exception.Message
            }
        }

        if ($response) {
            $result.Status = [int]$response.StatusCode
            $result.Location = $response.Headers['Location']
            $reader = New-Object System.IO.StreamReader($response.GetResponseStream())
            try { $body = $reader.ReadToEnd() } finally { $reader.Dispose() }
            $result.Bytes = $body.Length

            # Next stamps the error boundary's digest into the 500 page. It is
            # the id that ties this response to one stack trace in the log.
            if ($body -match '"digest"\s*:\s*"([^"]+)"') { $result.Digest = $Matches[1] }
            elseif ($body -match 'digest:\s*&quot;([^&]+)&quot;') { $result.Digest = $Matches[1] }
        }
    } finally {
        # Close(), not Dispose(): WebResponse's public disposal member on the
        # .NET Framework that Windows PowerShell 5.1 runs on is Close().
        $watch.Stop()
        if ($response) { $response.Close() }
    }

    $result.ElapsedMs = [int]$watch.ElapsedMilliseconds
    return [pscustomobject]$result
}

function Read-LogFrom {
    <# Reads a log that another process is actively writing. FileShare
       ReadWrite is the whole trick: without it this throws "being used by
       another process" against the live server. #>
    param(
        [Parameter(Mandatory)][string] $Path,
        [long] $Offset = 0
    )

    $stream = [System.IO.File]::Open(
        $Path, [System.IO.FileMode]::Open,
        [System.IO.FileAccess]::Read, [System.IO.FileShare]::ReadWrite)
    try {
        if ($Offset -gt 0 -and $Offset -le $stream.Length) { $null = $stream.Seek($Offset, 'Begin') }
        $reader = New-Object System.IO.StreamReader($stream, (New-Object System.Text.UTF8Encoding($false)))
        try { return $reader.ReadToEnd() } finally { $reader.Dispose() }
    } finally {
        $stream.Dispose()
    }
}

Write-Host ''
Write-Host 'AFLDB-ISSUE-152 Phase G -- diagnose (read-only)' -ForegroundColor Cyan
Write-Host '==============================================='
Write-Host ("  repo root  {0}" -f $repoRoot)
Write-Host ("  base URL   {0}" -f $baseUrl)

# ------------------------------------------------------------------- tunnel
# First, because it was the answer last time: ECONNREFUSED on the forward
# renders as a 500 from a server that is otherwise perfectly healthy.
$tunnelPort = Get-PhaseGTunnelPort -EnvFile $paths.EnvFile
$tunnel = Get-PhaseGTunnelState -Port $tunnelPort
Write-Host ''
Write-Host "-- PostgreSQL tunnel $tunnelPort --"
if ($tunnel.Reachable) {
    Write-Host '  reachable' -ForegroundColor Green
} elseif ($tunnel.Listening) {
    Write-Host '  LISTENING BUT REFUSING CONNECTIONS -- a dead forward.' -ForegroundColor Red
} else {
    Write-Host '  NOT RUNNING -- every force-dynamic page will answer 500 with' -ForegroundColor Red
    Write-Host ("  'connect ECONNREFUSED 127.0.0.1:{0}'. Start window 1:" -f $tunnelPort) -ForegroundColor Red
    Write-Host '    .\tools\issue-152\phase-g-tunnel.ps1'
}
foreach ($owner in $tunnel.Owners) {
    Write-Host ("  PID {0}  ({1})" -f $owner.ProcessId, $owner.ProcessName)
}

# ------------------------------------------------------------------- listener
Write-Host ''
Write-Host "-- what is serving port $Port --"

$owners = @(Get-PortListener -Port $Port)
$serverProcess = $null
if ($owners.Count -eq 0) {
    Write-Host '  NOTHING IS LISTENING.' -ForegroundColor Red
    Write-Host '  Start window 2 first:  .\tools\issue-152\phase-g-server.ps1'
} else {
    foreach ($owner in $owners) {
        $commandLine = Get-ProcessCommandLine -ProcessId $owner.ProcessId
        $started = $null
        try { $started = (Get-Process -Id $owner.ProcessId -ErrorAction Stop).StartTime } catch { }
        if (-not $serverProcess) {
            $serverProcess = [pscustomobject]@{
                ProcessId = $owner.ProcessId; CommandLine = $commandLine; StartTime = $started
            }
        }

        Write-Host ("  {0}:{1}  PID {2}  ({3})" -f `
            $owner.LocalAddress, $owner.Port, $owner.ProcessId, $owner.ProcessName)
        if ($started) { Write-Host ("    started        {0}" -f $started) }
        Write-Host ("    command line   {0}" -f $(if ($commandLine) { $commandLine } else { '<unreadable>' }))

        # Which runtime this is decides whether the sweep measured the branch
        # at all: `next dev` and a cluster worker serve different code from
        # the standalone bundle Phase G is supposed to be measuring.
        if ($commandLine -and $commandLine -match 'standalone' -and $commandLine -match 'server\.js') {
            Write-Host '    identified as  the standalone Phase G server' -ForegroundColor Green
        } elseif ($commandLine -and $commandLine -match 'server-cluster') {
            Write-Host '    identified as  a CLUSTER supervisor/worker -- not the Phase G server' -ForegroundColor Yellow
        } elseif ($commandLine -and $commandLine -match 'next(\.js)?[\\/ ]+dev|next dev') {
            Write-Host '    identified as  `next dev` -- NOT the standalone build Phase G measures' -ForegroundColor Yellow
        } else {
            Write-Host '    identified as  unrecognised -- confirm before trusting any sweep' -ForegroundColor Yellow
        }
    }
    Write-Host '  (nothing is terminated by this script)'
}

# ----------------------------------------------------------------- server log
Write-Host ''
Write-Host '-- persisted server log --'

$log = Get-PhaseGServerLog -Paths $paths
$logOffset = 0L
$captureActive = $false

if (-not $log) {
    Write-Host ("  none under {0}" -f $paths.ServerLogs) -ForegroundColor Yellow
    Write-Host '  The running server was started before server-log capture existed, so its'
    Write-Host '  stderr is going to the console only. Stop it yourself and restart window 1'
    Write-Host '  with the updated .\tools\issue-152\phase-g-server.ps1 to capture it.'
} else {
    $logOffset = $log.Length
    Write-Host ("  file           {0}" -f $log.FullName)
    Write-Host ("  size           {0:N0} bytes" -f $log.Length)
    Write-Host ("  last written   {0}" -f $log.LastWriteTime)

    # A log older than the process that is serving means this log belongs to a
    # PREVIOUS run: the live server's output is not being captured, and any
    # trace found below would be evidence about the wrong process.
    if ($serverProcess -and $serverProcess.StartTime -and $log.CreationTime -lt $serverProcess.StartTime) {
        Write-Host ('  WARNING        this log predates PID {0} (started {1}).' -f `
            $serverProcess.ProcessId, $serverProcess.StartTime) -ForegroundColor Yellow
        Write-Host '                 The live server is NOT writing here. Restart window 1 with the'
        Write-Host '                 updated phase-g-server.ps1 before trusting anything below.'
    } else {
        $captureActive = $true
    }
}

# ---------------------------------------------------------------------- probes
Write-Host ''
Write-Host '-- probes (3 GETs; the limiter allows 30/60s, so this is safe to repeat) --'

$probes = @()
if ($owners.Count -gt 0) {
    foreach ($probe in @(
        @{ Label = '/';                Url = "$baseUrl/" },
        @{ Label = '/search (no q)';   Url = "$baseUrl/search" },
        @{ Label = '/search?q=coach';  Url = "$baseUrl/search?q=who+coached+Richmond" }
    )) {
        $result = Invoke-PhaseGProbe -Label $probe.Label -Url $probe.Url
        $probes += $result

        $colour = 'Green'
        if ($null -eq $result.Status) { $colour = 'Red' }
        elseif ($result.Status -ge 500) { $colour = 'Red' }
        elseif ($result.Status -ge 300) { $colour = 'Yellow' }

        $detail = '{0,-16} {1,-5} {2,6} ms  {3,8:N0} chars' -f `
            $result.Label, $(if ($null -ne $result.Status) { $result.Status } else { 'ERR' }), `
            $result.ElapsedMs, $result.Bytes
        Write-Host ("  " + $detail) -ForegroundColor $colour
        if ($result.Location) { Write-Host ("      -> Location: {0}" -f $result.Location) }
        if ($result.Digest)   { Write-Host ("      -> error digest: {0}" -f $result.Digest) }
        if ($result.Note)     { Write-Host ("      -> {0}" -f $result.Note) -ForegroundColor Red }
    }
} else {
    Write-Host '  skipped -- nothing is listening.'
}

# ------------------------------------------------------------------ log delta
Write-Host ''
Write-Host '-- server output --'

if ($log) {
    $current = (Get-Item $log.FullName).Length
    $delta = ''
    if ($captureActive -and $current -gt $logOffset) {
        $delta = Read-LogFrom -Path $log.FullName -Offset $logOffset
    }

    if ($delta.Trim().Length -gt 0) {
        Write-Host ("  {0:N0} new bytes written during the probes above:" -f ($current - $logOffset))
        Write-Host ''
        foreach ($line in ($delta -split "`r?`n")) {
            if ($line.Trim().Length -eq 0) { continue }
            $colour = if ($line -match 'Error|error:|Exception|at \w|code:|ECONN|FATAL|denied') { 'Red' } else { 'Gray' }
            Write-Host ("  " + $line) -ForegroundColor $colour
        }
    } else {
        Write-Host ("  The probes added nothing to the log; last {0} line(s) instead:" -f $Tail)
        Write-Host ''
        $all = @((Read-LogFrom -Path $log.FullName) -split "`r?`n" | Where-Object { $_.Trim().Length -gt 0 })
        foreach ($line in ($all | Select-Object -Last $Tail)) { Write-Host ("  " + $line) -ForegroundColor Gray }
        if ($all.Count -eq 0) { Write-Host '  (the log is empty)' -ForegroundColor Yellow }
    }
} else {
    Write-Host '  no log to read -- see above.'
}

Write-Host ''
Write-Host ("  full log: {0}" -f $(if ($log) { $log.FullName } else { '<none>' }))
Write-Host ''
Write-Host '  Reading the statuses:' -ForegroundColor Cyan
Write-Host '    /search (no q) 500  -> the fault is getSiteSettings(), i.e. connectivity,'
Write-Host '                           the DSN, or a grant on afldb_test. Not NL semantics.'
Write-Host '    /search (no q) 200,'
Write-Host '    /search?q=      500  -> the fault is inside the NL pipeline for that question.'
Write-Host '    307 anywhere         -> the beta gate answered, not the page.'
Write-Host ''
Write-Host '  Nothing was started, stopped, written or queried by this script.' -ForegroundColor DarkGray
Write-Host ''
