<#
.SYNOPSIS
    Window 1 of the AFLDB-ISSUE-152 Phase G workflow: the PostgreSQL tunnel.

.DESCRIPTION
    Holds the SSH port forward every Phase G DSN depends on:

        127.0.0.1:<local>  ->  127.0.0.1:5432 on the database host

    There is no PostgreSQL server on this workstation, so without this window
    the whole run fails in the most misleading way available: the standalone
    server starts, serves its 1,472 prerendered routes with HTTP 200, and
    answers every force-dynamic page with a 500 whose only explanation --
    `connect ECONNREFUSED 127.0.0.1:55432` -- appears in the server's own
    stderr and nowhere else. That is what invalidated the r1 smoke
    (ISSUE-152 section 19.7).

    The local port is READ FROM .env's DATABASE_URL rather than assumed, so
    moving the forward stays a one-line .env edit. Only the SSH target itself
    is a parameter default, because nothing in the repository records it.

    NO CREDENTIAL IS INVOLVED. This runs the ordinary installed `ssh.exe` and
    lets it use the operator's own key, agent and config; no password, key
    path, passphrase or SSH option carrying a secret is read, written, printed
    or stored by this script. BatchMode is deliberately NOT set, so an
    interactive passphrase prompt still works in this window.

    Foreground and dedicated: Ctrl+C stops this tunnel and nothing else. No
    process is ever terminated by this script -- including one already holding
    the local port, which is reported by PID and left alone.

.PARAMETER SshTarget
    user@host for the database host. Default arm@10.0.40.100.

.PARAMETER LocalPort
    Local listening port. Defaults to the port in .env's DATABASE_URL (55432).

.PARAMETER RemoteHost
    Address PostgreSQL is reached at FROM the SSH host. Default 127.0.0.1 --
    the forward terminates on the remote loopback, so the database is never
    exposed on that host's LAN interface.

.PARAMETER RemotePort
    Default 5432.

.EXAMPLE
    .\tools\issue-152\phase-g-tunnel.ps1
#>
[CmdletBinding()]
param(
    [string] $SshTarget = 'arm@10.0.40.100',
    [int] $LocalPort = 0,
    [string] $RemoteHost = '127.0.0.1',
    [int] $RemotePort = 5432
)

$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'phase-g-common.ps1')

$repoRoot = Get-PhaseGRepoRoot
$paths = Get-PhaseGPaths -RepoRoot $repoRoot

if ($LocalPort -le 0) {
    $LocalPort = Get-PhaseGTunnelPort -EnvFile $paths.EnvFile
}

# ------------------------------------------------------------------- ssh.exe
$ssh = Get-Command ssh.exe -ErrorAction SilentlyContinue
if (-not $ssh) {
    throw ("ssh.exe was not found on PATH.`n" +
           "  Windows ships OpenSSH as an optional feature; install it, or open this window " +
           "from a shell that has ssh on PATH.")
}

# -------------------------------------------------------------- port in use
<#
  Not Assert-PortFree: on THIS port an existing listener is most likely a
  working tunnel from another window, which is a reason to use that window
  rather than a reason to start a second forward. Reported either way, and
  nothing is terminated.
#>
$state = Get-PhaseGTunnelState -Port $LocalPort
if ($state.Listening) {
    Write-Host ''
    Write-Host ("Local port {0} is already in use:" -f $LocalPort) -ForegroundColor Yellow
    foreach ($owner in $state.Owners) {
        Write-Host ("  {0}:{1}  PID {2}  ({3})" -f `
            $owner.LocalAddress, $owner.Port, $owner.ProcessId, $owner.ProcessName)
    }
    Write-Host ''
    if ($state.Reachable) {
        Write-Host '  It accepts connections, so a Phase G tunnel is very likely already running'
        Write-Host '  in another window. Use that one -- go straight to window 2:'
        Write-Host '    .\tools\issue-152\phase-g-server.ps1'
    } else {
        Write-Host '  It is listening but REFUSED a connection -- a dead forward, or an unrelated'
        Write-Host '  process holding the port. Stop the owner yourself (this script never will),'
        Write-Host '  or start this tunnel on another port with -LocalPort <n> and point .env at it.'
    }
    Write-Host ''
    throw "Local port $LocalPort is occupied; nothing was started and nothing was terminated."
}

# ----------------------------------------------------------------- the tunnel
<#
  -N                        no remote command; this is a forward, not a shell.
  -o ExitOnForwardFailure=yes
                            REQUIRED. Without it ssh happily stays connected
                            when the forward cannot be established, leaving a
                            window that looks like a working tunnel and a
                            server that answers every dynamic page with 500.
  -o ServerAliveInterval/CountMax
                            a dropped link ends this process instead of
                            silently becoming a black hole mid-sweep -- a
                            1,495-row P4 run takes long enough for that to
                            matter.
  127.0.0.1: in -L          bind the local loopback only. A bare port would
                            listen on every interface and publish the database
                            to the LAN.
#>
$forward = '{0}:{1}:{2}:{3}' -f '127.0.0.1', $LocalPort, $RemoteHost, $RemotePort
$sshArguments = @(
    '-N',
    '-o', 'ExitOnForwardFailure=yes',
    '-o', 'ServerAliveInterval=30',
    '-o', 'ServerAliveCountMax=3',
    '-L', $forward,
    $SshTarget
)

Write-Host ''
Write-Host 'AFLDB-ISSUE-152 Phase G -- PostgreSQL tunnel (window 1)' -ForegroundColor Cyan
Write-Host '-------------------------------------------------------'
Write-Host ("  repo root      {0}" -f $repoRoot)
Write-Host ("  forward        127.0.0.1:{0}  ->  {1}:{2}  via {3}" -f `
    $LocalPort, $RemoteHost, $RemotePort, $SshTarget)
Write-Host ("  local port     from .env DATABASE_URL ({0})" -f $paths.EnvFile)
Write-Host ("  ssh            {0}" -f $ssh.Source)
Write-Host ''
Write-Host ("  ssh {0}" -f ($sshArguments -join ' ')) -ForegroundColor DarkGray
Write-Host ''
Write-Host '  No credential is read, printed or stored: ssh uses your own key/agent/config.'
Write-Host '  ExitOnForwardFailure=yes -- if the forward cannot be established this exits'
Write-Host '  rather than leaving a window that looks like a working tunnel.'
Write-Host '  Ctrl+C stops this tunnel and nothing else.'
Write-Host ''
Write-Host 'Then, in window 2:' -ForegroundColor Cyan
Write-Host '  .\tools\issue-152\phase-g-server.ps1'
Write-Host ''

& $ssh.Source @sshArguments
$exit = $LASTEXITCODE

Write-Host ''
if ($exit -eq 0 -or $null -eq $exit) {
    Write-Host 'Tunnel closed.' -ForegroundColor DarkGray
} else {
    Write-Host ("Tunnel exited with code {0}." -f $exit) -ForegroundColor Yellow
    Write-Host '  255 is ssh''s own failure code: authentication, an unreachable host, or'
    Write-Host '  ExitOnForwardFailure refusing to continue without the forward.'
}
Write-Host ''
