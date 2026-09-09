<#
.SYNOPSIS
    Shared helpers for the AFLDB-ISSUE-152 Phase G rendered-acceptance runners.

.DESCRIPTION
    Dot-sourced by phase-g-*.ps1. Holds the parts that must not drift between
    the smoke run, the P3 new-family run and the P4 regression run: repository
    resolution, .env reading, the afldb_test DSN derivation, credential
    redaction, the port check, corpus generation and the summary gates.

    Nothing here starts a server, kills a process, writes to git, or prints a
    password. Every DSN that reaches the console goes through Get-RedactedDsn.

    TWO RUN-TAG VARIABLES, DELIBERATELY (this is the distinction the workflow
    kept confusing):

      AFLDB_NL_RUN_TAG   SERVER side, and a gate, not a label. Its only
                         accepted value is the literal string `accept`
                         (src/lib/nl-run-tag.ts, nlRunTagAccepted). Unless the
                         server process has it, /search ignores the header
                         entirely and every sweep row is logged as REAL reader
                         traffic with run_tag NULL. Set by phase-g-server.ps1.

      NL_UI_RUN_TAG      CLIENT side, and the label itself. The Playwright
                         sweep sends it as the `x-afldb-run-tag` request header
                         (tests/nl-ui/nl-stress.spec.ts); the server validates
                         it against a 64-character slug pattern and writes it
                         to nl_search_log.run_tag (migration 051). Set by the
                         sweep runners, never by the server.

    So the telemetry query is only reliable when BOTH are set, in the right
    processes. Verify a run reached the NL pipeline with:

      SELECT run_tag, count(*)
        FROM nl_search_log
       WHERE run_tag LIKE 'issue152-phaseg%'
       GROUP BY run_tag ORDER BY run_tag;

    A count below the corpus size means requests were throttled or the header
    was not accepted -- not that questions were declined.
#>

# --------------------------------------------------------------- repository

function Get-PhaseGRepoRoot {
    <# Resolved from this file's own location, so every script runs correctly
       from any current directory and no worktree path is hard-coded. #>
    $root = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
    foreach ($marker in @('package.json', 'playwright.nl-stress.config.ts')) {
        if (-not (Test-Path (Join-Path $root $marker))) {
            throw "Repository root resolved to '$root' but $marker is missing. Are these scripts still under tools/issue-152/?"
        }
    }
    return $root
}

function Get-PhaseGPaths {
    param([Parameter(Mandatory)][string] $RepoRoot)

    $phaseG = Join-Path $RepoRoot 'nl-ui-out-152-phaseg'
    return [ordered]@{
        RepoRoot   = $RepoRoot
        EnvFile    = Join-Path $RepoRoot '.env'
        Standalone = Join-Path (Join-Path $RepoRoot '.next') (Join-Path 'standalone' 'server.js')
        LiveOut    = Join-Path $RepoRoot 'nl-ui-out'
        PhaseGOut  = $phaseG
        CorporaDir = Join-Path $phaseG 'corpora'
        ServerLogs = Join-Path $phaseG 'server'
        AuthState  = Join-Path $RepoRoot (Join-Path 'tests' (Join-Path 'nl-ui' (Join-Path '.auth' 'state.json')))
        PwConfig   = 'playwright.nl-stress.config.ts'
    }
}

# ---------------------------------------------------------------------- .env

function Read-DotEnvFile {
    <#
    .SYNOPSIS
        Reads .env into an ordered hashtable. Values are never logged.
    .DESCRIPTION
        Deliberately literal: `KEY=value`, optional `export ` prefix, `#`
        comments, and one level of surrounding single or double quotes. Inline
        comments are NOT stripped, because a password may legitimately contain
        `#` and silently truncating one would produce an authentication failure
        that looks like a wrong credential.
    #>
    param([Parameter(Mandatory)][string] $Path)

    if (-not (Test-Path $Path)) { throw ".env not found at $Path" }

    $values = [ordered]@{}
    foreach ($line in [System.IO.File]::ReadAllLines($Path)) {
        $trimmed = $line.Trim()
        if ($trimmed.Length -eq 0 -or $trimmed.StartsWith('#')) { continue }
        if ($trimmed -notmatch '^(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=(.*)$') { continue }

        $key = $Matches[1]
        $value = $Matches[2].Trim()
        if ($value.Length -ge 2) {
            if (($value.StartsWith('"') -and $value.EndsWith('"')) -or
                ($value.StartsWith("'") -and $value.EndsWith("'"))) {
                $value = $value.Substring(1, $value.Length - 2)
            }
        }
        $values[$key] = $value
    }
    return $values
}

# ----------------------------------------------------------------------- DSN

function Split-Dsn {
    <# Splits a postgres DSN without a URI parser: a password may contain
       characters [System.Uri] refuses, and this must never fail in a way that
       tempts anyone to print the DSN to debug it. #>
    param([Parameter(Mandatory)][string] $Dsn)

    if ($Dsn -notmatch '^(postgres(?:ql)?://)(.+)$') {
        throw 'DSN is not a postgres:// or postgresql:// URL.'
    }
    $scheme = $Matches[1]
    $rest = $Matches[2]

    $slash = $rest.LastIndexOf('/')
    if ($slash -lt 0) { throw 'DSN carries no /database segment.' }

    $authority = $rest.Substring(0, $slash)
    $tail = $rest.Substring($slash + 1)

    $query = ''
    $question = $tail.IndexOf('?')
    if ($question -ge 0) {
        $query = $tail.Substring($question)
        $tail = $tail.Substring(0, $question)
    }

    $user = ''
    $hostPort = $authority
    $at = $authority.LastIndexOf('@')
    if ($at -ge 0) {
        $userInfo = $authority.Substring(0, $at)
        $hostPort = $authority.Substring($at + 1)
        $colon = $userInfo.IndexOf(':')
        if ($colon -ge 0) { $user = $userInfo.Substring(0, $colon) } else { $user = $userInfo }
    }

    return [ordered]@{
        Scheme    = $scheme
        Authority = $authority   # carries the password -- never print this
        User      = $user
        HostPort  = $hostPort
        Database  = $tail
        Query     = $query
    }
}

function ConvertTo-DatabaseDsn {
    <# Same host, port, role and password; different database. This is how
       afldb_test is derived from the .env DSNs rather than typed out with a
       credential in a command block. #>
    param(
        [Parameter(Mandatory)][string] $Dsn,
        [Parameter(Mandatory)][string] $Database
    )
    $parts = Split-Dsn -Dsn $Dsn
    return '{0}{1}/{2}{3}' -f $parts.Scheme, $parts.Authority, $Database, $parts.Query
}

function Get-RedactedDsn {
    <# The ONLY form of a DSN that may reach the console or a manifest. #>
    param([Parameter(Mandatory)][string] $Dsn)
    $parts = Split-Dsn -Dsn $Dsn
    $user = if ($parts.User) { $parts.User } else { '<no-user>' }
    return '{0}{1}:***@{2}/{3}' -f $parts.Scheme, $user, $parts.HostPort, $parts.Database
}

function Resolve-PhaseGDatabaseEnv {
    <#
    .SYNOPSIS
        Derives the afldb_test application and auth DSNs from the tracked .env.
    .DESCRIPTION
        Phase G renders against a local production build of this branch backed
        by afldb_test -- DEV serves main, which has no coach_record grain, no
        after_siren grain and no Phase E wording (ISSUE-152 section 19.1). The role
        and password stay exactly as .env has them: afldb_app's read grants on
        the new tables are part of what the sweep proves (section 19.3), so switching
        to an owner role here would hide a fail-closed grant defect.
    #>
    param(
        [Parameter(Mandatory)][string] $EnvFile,
        [string] $Database = 'afldb_test'
    )

    $env0 = Read-DotEnvFile -Path $EnvFile
    foreach ($key in @('DATABASE_URL', 'AFLDB_AUTH_DATABASE_URL')) {
        if (-not $env0.Contains($key) -or [string]::IsNullOrWhiteSpace($env0[$key])) {
            throw "$key is missing from $EnvFile; Phase G cannot derive the $Database DSN from it."
        }
    }

    $appDsn = ConvertTo-DatabaseDsn -Dsn $env0['DATABASE_URL'] -Database $Database
    $authDsn = ConvertTo-DatabaseDsn -Dsn $env0['AFLDB_AUTH_DATABASE_URL'] -Database $Database

    return [ordered]@{
        EnvValues        = $env0
        AppDsn           = $appDsn
        AuthDsn          = $authDsn
        AppDsnRedacted   = Get-RedactedDsn -Dsn $appDsn
        AuthDsnRedacted  = Get-RedactedDsn -Dsn $authDsn
        Database         = $Database
    }
}

function Assert-PhaseGDatabaseEnv {
    <#
    .SYNOPSIS
        Preflight for the object Resolve-PhaseGDatabaseEnv returns.
    .DESCRIPTION
        Guards the failure that stopped Phase G window 1 on 2026-09-09.
        phase-g-server.ps1 assigned the result to $database, which is the SAME
        variable as its own `[string] $Database` parameter -- PowerShell
        variable names are case-insensitive, and a parameter's type constraint
        outlives the parameter binding. The ordered hashtable was therefore
        silently coerced to the string
        "System.Collections.Specialized.OrderedDictionary", every member read
        back as $null, and the first method call on one raised the useless
        "You cannot call a method on a null-valued expression".

        The quiet half was worse than the crash. With a $null AppDsn,
        Push-PhaseGEnv REMOVES DATABASE_URL instead of setting it, and the
        standalone bundle then falls back to its own build-time .env copy --
        which points at afldb_dev. That is the wrong database for Phase G
        (section 19.1) and would have produced a plausible-looking sweep against
        code and data the branch never changed. This fails by name instead.
    #>
    param(
        [Parameter(Mandatory)][AllowNull()] $Resolved,
        [string] $Database = 'afldb_test'
    )

    $how = ("Resolve-PhaseGDatabaseEnv returned {0}. Assign it to a variable whose name does NOT " +
            "collide with a [string]-typed parameter such as -Database (use `$dbEnv).")

    if ($null -eq $Resolved) {
        throw ("Phase G $Database environment is unresolved: " + ($how -f 'nothing'))
    }
    if ($Resolved -isnot [System.Collections.IDictionary]) {
        $actual = '[{0}] "{1}"' -f $Resolved.GetType().Name, $Resolved
        throw ("Phase G $Database environment resolved to $actual instead of a dictionary: " +
               ($how -f 'a coerced value'))
    }

    foreach ($member in @('EnvValues', 'AppDsn', 'AuthDsn', 'AppDsnRedacted', 'AuthDsnRedacted')) {
        if (-not $Resolved.Contains($member) -or $null -eq $Resolved[$member]) {
            throw "Phase G $Database environment is missing '$member'; the DSNs cannot be exported."
        }
    }
    if ($Resolved['EnvValues'] -isnot [System.Collections.IDictionary]) {
        throw "Phase G $Database environment has a non-dictionary 'EnvValues'; .env was not read."
    }
    foreach ($member in @('AppDsn', 'AuthDsn')) {
        if ([string]::IsNullOrWhiteSpace([string]$Resolved[$member])) {
            throw ("Phase G $Database '$member' is empty. Exporting an empty value REMOVES the " +
                   "variable, and the standalone server would fall back to its build-time .env " +
                   "copy (afldb_dev) -- the wrong database for Phase G.")
        }
    }
}

# ---------------------------------------------------------------------- port

function Get-PortListener {
    <# Reports the owner of a listening port. Never terminates anything: on a
       workstation port 3100 is as likely to be a `next dev` the operator is
       using as a stale Phase G server, and only they can tell. #>
    param([Parameter(Mandatory)][int] $Port)

    $owners = @()
    $connections = @()
    try {
        # Throws rather than returning empty when nothing is listening, so the
        # "port is free" case arrives here as an error and must be absorbed.
        $connections = @(Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction Stop)
    } catch {
        $connections = @()
    }

    foreach ($connection in $connections) {
        $name = '<unknown>'
        try { $name = (Get-Process -Id $connection.OwningProcess -ErrorAction Stop).ProcessName } catch { }
        $owners += [pscustomobject]@{
            Port         = $Port
            ProcessId    = $connection.OwningProcess
            ProcessName  = $name
            LocalAddress = $connection.LocalAddress
        }
    }
    return $owners
}

function Assert-PortFree {
    param([Parameter(Mandatory)][int] $Port)

    $owners = Get-PortListener -Port $Port
    if ($owners.Count -gt 0) {
        Write-Host ''
        Write-Host "Port $Port is already in use:" -ForegroundColor Red
        foreach ($owner in $owners) {
            Write-Host ("  {0}:{1}  PID {2}  ({3})" -f $owner.LocalAddress, $owner.Port, $owner.ProcessId, $owner.ProcessName)
        }
        Write-Host ''
        Write-Host 'Nothing was terminated. Stop the owning process yourself, or start this server on'
        Write-Host 'another port with -Port <n> (and pass the same -BaseUrl to the sweep scripts).'
        throw "Port $Port is occupied."
    }
}

# -------------------------------------------------------------- pg tunnel

<#
  Every Phase G DSN points at 127.0.0.1:55432, which is an SSH port forward to
  PostgreSQL on another host -- there is no PostgreSQL server on this
  workstation. Without it the standalone server starts happily, serves the
  1,472 prerendered routes with HTTP 200, and answers every force-dynamic page
  with a 500 whose only explanation is `connect ECONNREFUSED 127.0.0.1:55432`
  in its own stderr. That is exactly how the r1 smoke produced 40/40 HTTP 500
  and looked, for a while, like a semantic defect (ISSUE-152 section 19.7).

  So the tunnel is now a checked precondition rather than folklore.
#>

function Get-PhaseGTunnelPort {
    <# The local port Phase G actually needs, read from .env's DATABASE_URL
       rather than assumed, so moving the forward is a one-line .env edit. #>
    param(
        [Parameter(Mandatory)][string] $EnvFile,
        [int] $Fallback = 55432
    )

    try {
        $values = Read-DotEnvFile -Path $EnvFile
        if (-not $values.Contains('DATABASE_URL')) { return $Fallback }
        $parts = Split-Dsn -Dsn $values['DATABASE_URL']
        if ($parts.HostPort -match ':(\d+)$') { return [int]$Matches[1] }
    } catch {
        # A .env this script cannot parse is a separate failure, reported by
        # whichever caller actually needs the DSNs.
    }
    return $Fallback
}

function Test-TcpEndpoint {
    <#
    .SYNOPSIS
        Can something be connected to on this port, right now?
    .DESCRIPTION
        A real connect, not a listener enumeration: `ssh -L` can hold a
        listening socket open while the forward behind it is dead, and that
        distinction is the whole point of the check. Test-NetConnection is
        avoided because it prints a progress bar and is slow enough to be
        annoying in a preflight.
    #>
    param(
        [string] $HostName = '127.0.0.1',
        [Parameter(Mandatory)][int] $Port,
        [int] $TimeoutMs = 2000
    )

    $client = New-Object System.Net.Sockets.TcpClient
    try {
        $async = $client.BeginConnect($HostName, $Port, $null, $null)
        if (-not $async.AsyncWaitHandle.WaitOne($TimeoutMs, $false)) { return $false }
        $client.EndConnect($async)
        return $client.Connected
    } catch {
        return $false
    } finally {
        $client.Close()
    }
}

function Get-PhaseGTunnelState {
    <# Read-only. Reports both halves -- who holds the socket, and whether it
       actually accepts a connection -- and terminates nothing. #>
    param(
        [Parameter(Mandatory)][int] $Port,
        [string] $HostName = '127.0.0.1'
    )

    $owners = @(Get-PortListener -Port $Port)
    return [ordered]@{
        Port      = $Port
        HostName  = $HostName
        Owners    = $owners
        Listening = ($owners.Count -gt 0)
        Reachable = (Test-TcpEndpoint -HostName $HostName -Port $Port)
    }
}

function Assert-PhaseGTunnel {
    <#
    .SYNOPSIS
        Refuses to continue when the PostgreSQL forward is not up.
    .DESCRIPTION
        The message is deliberately the same sentence everywhere, because the
        failure it prevents (forty HTTP 500s that look like semantics) is worth
        exactly one recognisable line.
    #>
    param(
        [Parameter(Mandatory)][int] $Port,
        [string] $HostName = '127.0.0.1'
    )

    if (Test-TcpEndpoint -HostName $HostName -Port $Port) { return }

    throw ("Phase G PostgreSQL tunnel is not running. " +
           "Start .\tools\issue-152\phase-g-tunnel.ps1`n" +
           "  Nothing on ${HostName}:${Port} accepted a connection, so every force-dynamic page " +
           "would answer 500 with 'connect ECONNREFUSED ${HostName}:${Port}' while the prerendered " +
           "routes still returned 200.")
}

# ------------------------------------------------------------- server logs

function New-PhaseGServerLogPath {
    <#
    .SYNOPSIS
        A fresh, uniquely named log file for one window-1 server run.
    .DESCRIPTION
        One file per run, named for the second it started
        (server-20260909-134501.log). Nothing is ever overwritten and nothing
        is ever deleted: the standalone server's stderr is the only place a
        rendered 500 explains itself, and the run that produced it may be the
        one nobody thought to keep. The directory sits under
        nl-ui-out-152-phaseg/, which .gitignore already excludes as
        `nl-ui-out-*/`, so no log can be committed by accident.
    #>
    param([Parameter(Mandatory)][System.Collections.IDictionary] $Paths)

    if (-not (Test-Path $Paths.ServerLogs)) {
        New-Item -ItemType Directory -Path $Paths.ServerLogs -Force | Out-Null
    }

    $stamp = (Get-Date).ToString('yyyyMMdd-HHmmss')
    $path = Join-Path $Paths.ServerLogs ("server-$stamp.log")

    # Two starts inside one second is close to impossible with the port check
    # in front, but a collision would silently append one run's output to
    # another's -- the exact confusion this whole change exists to end.
    $suffix = 1
    while (Test-Path $path) {
        $path = Join-Path $Paths.ServerLogs ("server-$stamp-$suffix.log")
        $suffix++
    }
    return $path
}

function Get-PhaseGServerLog {
    <# The log the running server is writing: newest by last-write time, not
       by name, so a run started before midnight is still found after it. #>
    param([Parameter(Mandatory)][System.Collections.IDictionary] $Paths)

    if (-not (Test-Path $Paths.ServerLogs)) { return $null }
    return Get-ChildItem $Paths.ServerLogs -Filter 'server-*.log' -File -ErrorAction SilentlyContinue |
        Sort-Object LastWriteTime -Descending |
        Select-Object -First 1
}

function New-PhaseGLogWriter {
    <#
    .SYNOPSIS
        An append-mode, auto-flushing UTF-8 (no BOM) writer for a server log.
    .DESCRIPTION
        Deliberately NOT Tee-Object: Windows PowerShell 5.1's Tee-Object has no
        -Encoding parameter and writes UTF-16, which turns every later `grep`,
        `Select-String -Raw` and editor diff of the evidence into mojibake (the
        ISSUE-152 psql evidence pack has exactly that problem).

        AutoFlush is on because the interesting case is a server that is still
        running -- or one that was Ctrl+C'd mid-stack-trace. An unflushed
        buffer would lose precisely the lines being looked for.
    #>
    param([Parameter(Mandatory)][string] $Path)

    $writer = New-Object System.IO.StreamWriter(
        $Path, $true, (New-Object System.Text.UTF8Encoding($false)))
    $writer.AutoFlush = $true
    return $writer
}

# -------------------------------------------------------------------- corpus

function Invoke-PhaseGCorpusBuild {
    <# Regenerates a merged corpus from the TRACKED corpora under
       tests/nl-ui/corpora/. Deterministic, gitignored, and inside the
       repository -- no scratch or temp path is involved. #>
    param(
        [Parameter(Mandatory)][string] $RepoRoot,
        [Parameter(Mandatory)][ValidateSet('new', 'regression')][string] $Set
    )

    Push-Location $RepoRoot
    try {
        $json = & npx --no-install tsx tools/issue-152/build-phase-g-corpora.ts $Set
        if ($LASTEXITCODE -ne 0) { throw "build-phase-g-corpora.ts failed for set '$Set' (exit $LASTEXITCODE)." }
    } finally {
        Pop-Location
    }

    $line = @($json | Where-Object { $_ -and $_.Trim().StartsWith('{') })[-1]
    if (-not $line) { throw "build-phase-g-corpora.ts produced no result for set '$Set'." }
    return $line | ConvertFrom-Json
}

# ----------------------------------------------------------------- env scope

function Push-PhaseGEnv {
    <#
    .SYNOPSIS
        Sets process environment variables and returns their previous values.
    .DESCRIPTION
        A .ps1 runs INSIDE the calling PowerShell session, so anything set here
        outlives the script. That is how a smoke run's NL_UI_LIMIT=40 survives
        into the next command in the same window and truncates a "full" sweep
        without saying so. Every runner pairs this with Pop-PhaseGEnv in a
        finally block, so the window is left exactly as it was found.
    #>
    param([Parameter(Mandatory)][System.Collections.IDictionary] $Values)

    $prior = [ordered]@{}
    foreach ($key in $Values.Keys) {
        $prior[$key] = [Environment]::GetEnvironmentVariable($key, 'Process')
        [Environment]::SetEnvironmentVariable($key, $Values[$key], 'Process')
    }
    return $prior
}

function Pop-PhaseGEnv {
    param([Parameter(Mandatory)][System.Collections.IDictionary] $Prior)
    # A $null value removes the variable, which is the correct restoration for
    # one that was not set before.
    foreach ($key in $Prior.Keys) { [Environment]::SetEnvironmentVariable($key, $Prior[$key], 'Process') }
}

# ------------------------------------------------------------- sweep plumbing

function Assert-NoInheritedSweepLimit {
    <#
    .SYNOPSIS
        Refuses to start a full sweep under an inherited NL_UI_LIMIT.
    .DESCRIPTION
        NL_UI_LIMIT truncates the corpus to its first N rows. Left over from a
        smoke run in the same shell it would silently produce a 40-row "full"
        run whose summary still reports a clean pass -- the exact shape of
        fiction section 19.2 was written about. Refused rather than cleared, because
        the operator should know their shell was carrying it.
    #>
    param([switch] $Clear)

    if ([string]::IsNullOrEmpty($env:NL_UI_LIMIT)) { return }

    if ($Clear) {
        Write-Host "Clearing inherited NL_UI_LIMIT=$($env:NL_UI_LIMIT) for this run." -ForegroundColor Yellow
        Remove-Item Env:NL_UI_LIMIT
        return
    }
    throw ("NL_UI_LIMIT=$($env:NL_UI_LIMIT) is set in this shell and would truncate the corpus. " +
           "Remove it (Remove-Item Env:NL_UI_LIMIT) and re-run, or pass -ClearInheritedLimit.")
}

function Assert-SweepRunTag {
    param([Parameter(Mandatory)][string] $RunTag)
    # Mirrors RUN_TAG_RE in src/lib/nl-run-tag.ts: anything else is dropped by
    # the server, and the run then has no telemetry provenance at all.
    if ($RunTag -notmatch '^[a-z0-9][a-z0-9._-]{0,63}$') {
        throw "Run tag '$RunTag' is not a valid nl_search_log run_tag (slug, 1-64 chars). The server would discard it."
    }
}

function Assert-SweepPrerequisites {
    param(
        [Parameter(Mandatory)][System.Collections.IDictionary] $Paths,
        [Parameter(Mandatory)][string] $BaseUrl
    )

    if (-not (Test-Path $Paths.AuthState)) {
        throw ("Playwright storage state is missing at $($Paths.AuthState). " +
               "The nl-stress project requires it even with the beta gate off. " +
               "See ISSUE-152 section 19.1 -- it holds only afldb_consent=declined.")
    }

    try {
        $response = Invoke-WebRequest -Uri $BaseUrl -UseBasicParsing -TimeoutSec 15 -MaximumRedirection 0 -ErrorAction Stop
        Write-Host "Server reachable at $BaseUrl (HTTP $($response.StatusCode))." -ForegroundColor DarkGray
    } catch {
        throw ("No usable response from $BaseUrl -- start the server in another window first:`n" +
               "    .\tools\issue-152\phase-g-server.ps1`n" +
               "  ($($_.Exception.Message))")
    }
}

function Invoke-NlUiSweep {
    <# Runs the Playwright sweep and the summary, then returns the exit code
       rather than throwing: the report must be built and preserved even when
       the sweep failed, because that is when it matters most. #>
    param(
        [Parameter(Mandatory)][string] $RepoRoot,
        [Parameter(Mandatory)][string] $CorpusPath,
        [string[]] $ExtraPlaywrightArgs = @()
    )

    Push-Location $RepoRoot
    try {
        $arguments = @(
            '--no-install', 'playwright', 'test',
            '--config', 'playwright.nl-stress.config.ts',
            '--project', 'nl-stress',
            '--no-deps'
        ) + $ExtraPlaywrightArgs

        Write-Host ''
        Write-Host "npx $($arguments -join ' ')" -ForegroundColor DarkGray
        & npx @arguments
        $sweepExit = $LASTEXITCODE

        Write-Host ''
        Write-Host 'Building the summary report...' -ForegroundColor DarkGray
        & npx --no-install tsx tools/nl/ui-summary.ts $CorpusPath
        if ($LASTEXITCODE -ne 0) { throw "tools/nl/ui-summary.ts failed (exit $LASTEXITCODE)." }

        return $sweepExit
    } finally {
        Pop-Location
    }
}

function Assert-PhaseGOutNameFree {
    <# Preserved run output is cited acceptance evidence, so a name is claimed
       exactly once and is never deleted, rotated or merged into. Call this
       BEFORE a sweep starts as well -- failing after a 10-minute paced run
       would be technically safe but operationally useless. #>
    param(
        [Parameter(Mandatory)][System.Collections.IDictionary] $Paths,
        [Parameter(Mandatory)][string] $Name
    )

    $target = Join-Path $Paths.PhaseGOut $Name
    if (Test-Path $target) {
        throw ("Preserved output already exists at '$target'. " +
               "Phase G evidence is never overwritten: re-run with a different -OutName " +
               "(for example -OutName '$Name-r2'), or move the existing directory aside yourself.")
    }
    return $target
}

function Save-PhaseGRunOutput {
    <# Preserves nl-ui-out/ under a deterministic Phase G name, so nobody has
       to rename a directory by hand between runs and no run overwrites
       another's evidence. Refuses an existing target rather than replacing it
       (see Assert-PhaseGOutNameFree); nl-ui-out/ itself is untouched. #>
    param(
        [Parameter(Mandatory)][System.Collections.IDictionary] $Paths,
        [Parameter(Mandatory)][string] $Name,
        [System.Collections.IDictionary] $Manifest
    )

    if (-not (Test-Path $Paths.LiveOut)) { throw "nl-ui-out/ does not exist -- the sweep produced no output." }

    $target = Assert-PhaseGOutNameFree -Paths $Paths -Name $Name
    New-Item -ItemType Directory -Path $target -Force | Out-Null
    Copy-Item (Join-Path $Paths.LiveOut '*') -Destination $target -Recurse -Force

    if ($Manifest) {
        $json = ($Manifest | ConvertTo-Json -Depth 8)
        [System.IO.File]::WriteAllText(
            (Join-Path $target 'run-manifest.json'),
            $json,
            (New-Object System.Text.UTF8Encoding($false)))
    }
    return $target
}

# --------------------------------------------------------------------- gates

function Get-PhaseGSummary {
    param([Parameter(Mandatory)][string] $OutDir)

    $path = Join-Path $OutDir 'summary.json'
    if (-not (Test-Path $path)) { throw "No summary.json in $OutDir." }
    return (Get-Content $path -Raw | ConvertFrom-Json)
}

function Get-RateLimitedObservations {
    <# The throttled branch records `page_error` plus this exact message
       (tests/nl-ui/nl-stress.spec.ts). Counted separately from other page
       errors because it means "this run measured the rate limiter, not the
       parser" -- a different diagnosis entirely. #>
    param([Parameter(Mandatory)] $Report)

    $hits = @()
    foreach ($entry in @($Report.clientErrors)) {
        foreach ($message in @($entry.errors)) {
            if ($message -like 'rate limited:*') { $hits += $entry; break }
        }
    }
    return $hits
}

function New-PhaseGGate {
    param(
        [Parameter(Mandatory)][string] $Name,
        [Parameter(Mandatory)][bool] $Ok,
        [Parameter(Mandatory)][string] $Detail
    )
    return [pscustomobject]@{ Name = $Name; Ok = $Ok; Detail = $Detail }
}

function Write-PhaseGGates {
    param([Parameter(Mandatory)] $Gates)

    Write-Host ''
    Write-Host '--- gates ---'
    foreach ($gate in $Gates) {
        if ($gate.Ok) {
            Write-Host ("  PASS  {0,-28} {1}" -f $gate.Name, $gate.Detail) -ForegroundColor Green
        } else {
            Write-Host ("  FAIL  {0,-28} {1}" -f $gate.Name, $gate.Detail) -ForegroundColor Red
        }
    }
    Write-Host ''
}

function Get-PhaseGTransportGates {
    <# The gates every Phase G run shares: the run happened, it was not
       throttled, and nothing crashed. Semantic gates are added per script. #>
    param(
        [Parameter(Mandatory)] $Report,
        [Parameter(Mandatory)][int] $ExpectedObserved
    )

    $rateLimited = @(Get-RateLimitedObservations -Report $Report)
    $pageErrors = [int]$Report.summary.byOutcome.page_error
    $httpErrors = [int]$Report.summary.byOutcome.http_error

    return @(
        (New-PhaseGGate -Name 'observed rows' -Ok ([int]$Report.observed -eq $ExpectedObserved) `
            -Detail ("{0} observed, expected {1}" -f $Report.observed, $ExpectedObserved)),
        (New-PhaseGGate -Name 'rate-limit detections' -Ok ($rateLimited.Count -eq 0) `
            -Detail ("{0} rows rendered 'Too many searches'" -f $rateLimited.Count)),
        (New-PhaseGGate -Name 'page_error' -Ok ($pageErrors -eq 0) -Detail ("{0}" -f $pageErrors)),
        (New-PhaseGGate -Name 'http_error' -Ok ($httpErrors -eq 0) -Detail ("{0}" -f $httpErrors))
    )
}

function Write-PhaseGFailureDetail {
    param(
        [Parameter(Mandatory)] $Report,
        [int] $Limit = 15
    )

    $failures = @($Report.failures)
    if ($failures.Count -eq 0) { return }

    Write-Host "First $([Math]::Min($Limit, $failures.Count)) of $($failures.Count) scored failures:" -ForegroundColor Yellow
    foreach ($failure in $failures | Select-Object -First $Limit) {
        Write-Host ("  {0,-16} expected {1,-8} outcome {2,-12} {3}" -f `
            $failure.id, $failure.expected, $failure.outcome, $failure.question)
    }
    Write-Host ''
}

function Assert-PhaseGGates {
    param(
        [Parameter(Mandatory)] $Gates,
        [Parameter(Mandatory)][string] $Context
    )
    $failed = @($Gates | Where-Object { -not $_.Ok })
    if ($failed.Count -gt 0) {
        throw "$Context : $($failed.Count) gate(s) failed -- $(($failed | ForEach-Object { $_.Name }) -join ', ')."
    }
}
