<#
.SYNOPSIS
Sync AFLDB's development server from Git and redeploy the app.

.DESCRIPTION
Runs the routine deployment documented in docs/deployment.md on the dev
server over SSH:

  git pull --ff-only
  npm ci
  npm run db:migrate
  npm run build
  sudo systemctl restart afldb
  curl /api/health

The script is designed to be run from a Windows workstation:

  powershell -ExecutionPolicy Bypass -File .\deploy\sync-dev.ps1

For AFLDB-ISSUE-107's controlled Linux-dev deployment, first ensure the dev
host has AFLDB_TRACE_REQUESTS=on, AFLDB_WORKERS=4 and AFLDB_POOL_MAX=10, then
add -Issue107Gate. That mode refuses skipped install/build/restart/health
steps and proves the built BUILD_ID equals the live x-afldb-build header.

It does not push local changes. Commit and push first, then run this.
#>

[CmdletBinding(SupportsShouldProcess = $true)]
param(
  [string] $SshTarget = 'arm@10.0.40.100',
  [string] $ProjectDir = '/home/arm/projects/afldb',
  [string] $ServiceName = 'afldb',
  [string] $HealthUrl = 'http://127.0.0.1:3100/api/health',
  [string] $RemoteRef = '',
  [switch] $SkipInstall,
  [switch] $SkipMigrate,
  [switch] $SkipBuild,
  [switch] $SkipRestart,
  [switch] $SkipHealth,
  [switch] $AllowDirtyServer,
  [switch] $NoPrune,
  [switch] $Issue107Gate
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

function Assert-Command {
  param([Parameter(Mandatory = $true)][string] $Name)

  if (-not (Get-Command $Name -ErrorAction SilentlyContinue)) {
    throw "Required command '$Name' was not found on PATH."
  }
}

function Escape-BashSingleQuoted {
  param([Parameter(Mandatory = $true)][string] $Value)

  return "'" + ($Value -replace "'", "'\''") + "'"
}

function Add-RemoteCommand {
  param(
    [System.Collections.Generic.List[string]] $Commands,
    [Parameter(Mandatory = $true)][string] $Command
  )

  $Commands.Add($Command) | Out-Null
}

function Add-RemoteStep {
  param(
    [System.Collections.Generic.List[string]] $Commands,
    [Parameter(Mandatory = $true)][string] $Label,
    [Parameter(Mandatory = $true)][string] $Command
  )

  $safeLabel = $Label -replace "'", "'\''"
  Add-RemoteCommand $Commands "echo '[deploy] >>> $safeLabel'"
  Add-RemoteCommand $Commands $Command
}

Assert-Command ssh

if ($Issue107Gate -and ($SkipInstall -or $SkipBuild -or $SkipRestart -or $SkipHealth)) {
  throw '-Issue107Gate requires install, build, restart and health checks; do not combine it with their skip switches.'
}

$quotedProjectDir = Escape-BashSingleQuoted $ProjectDir
$quotedServiceName = Escape-BashSingleQuoted $ServiceName
$quotedHealthUrl = Escape-BashSingleQuoted $HealthUrl
$quotedRemoteRef = if ($RemoteRef.Trim()) { Escape-BashSingleQuoted $RemoteRef.Trim() } else { "''" }

$remoteCommands = [System.Collections.Generic.List[string]]::new()
Add-RemoteCommand $remoteCommands 'set -Eeuo pipefail'
Add-RemoteCommand $remoteCommands 'trap ''code=$?; echo "[deploy] FAILED line ${LINENO}: ${BASH_COMMAND}" >&2; exit $code'' ERR'
Add-RemoteStep $remoteCommands 'enter project directory' "cd $quotedProjectDir"
# These must be single-quoted PowerShell strings. A double-quoted string would
# expand $(...) on the *workstation*, so the deployment would report the local
# machine's host, directory, Node version and revision instead of the server's.
Add-RemoteStep $remoteCommands 'show host' 'echo "[deploy] host: $(hostname)"'
Add-RemoteStep $remoteCommands 'show directory' 'echo "[deploy] directory: $(pwd)"'

# Node is installed per-user through nvm on the development host and is not on
# a non-interactive SSH PATH, which resolves the distribution's older
# /usr/bin/node instead. Select the same nvm default the systemd unit pins so
# the build runs on the runtime that will serve it; hosts without nvm keep
# their PATH Node and are still held to the floor check below.
Add-RemoteStep $remoteCommands 'select nvm-managed Node when present' 'NVM_SH="${NVM_DIR:-$HOME/.nvm}/nvm.sh"; if [ -s "$NVM_SH" ]; then set +u; . "$NVM_SH" >/dev/null 2>&1; nvm use --silent default >/dev/null 2>&1 || true; set -u; fi; echo "[deploy] node binary: $(command -v node)"'

Add-RemoteStep $remoteCommands 'show node version' 'echo "[deploy] node: $(node --version)"'
Add-RemoteStep $remoteCommands 'enforce Next.js Node floor' "node -e `"const [major, minor] = process.versions.node.split('.').map(Number); if (major < 20 || (major === 20 && minor < 9)) { console.error('Next.js 16 requires Node >=20.9.0; found ' + process.versions.node); process.exit(1); }`""
Add-RemoteStep $remoteCommands 'show npm version' 'echo "[deploy] npm: $(npm --version)"'
Add-RemoteStep $remoteCommands 'show current revision' 'echo "[deploy] before: $(git rev-parse --short HEAD) $(git branch --show-current)"'

if (-not $AllowDirtyServer) {
  Add-RemoteStep $remoteCommands 'check server working tree' 'test -z "$(git status --porcelain)" || { echo "[deploy] server working tree is dirty; use -AllowDirtyServer to deploy anyway" >&2; git status --short; exit 20; }'
}

if (-not $NoPrune) {
  Add-RemoteStep $remoteCommands 'fetch Git refs with prune' 'git fetch --prune'
} else {
  Add-RemoteStep $remoteCommands 'fetch Git refs' 'git fetch'
}

Add-RemoteStep $remoteCommands 'checkout requested ref if supplied' "if [ -n $quotedRemoteRef ]; then git checkout $quotedRemoteRef; fi"
Add-RemoteStep $remoteCommands 'pull latest commit' 'git pull --ff-only'
Add-RemoteStep $remoteCommands 'show deployed revision' 'echo "[deploy] after: $(git rev-parse --short HEAD) $(git branch --show-current)"'

if (-not $SkipInstall) {
  Add-RemoteStep $remoteCommands 'install dependencies' 'npm ci'
}

if (-not $SkipMigrate) {
  Add-RemoteStep $remoteCommands 'run database migrations' 'npm run db:migrate'
}

if (-not $SkipBuild) {
  Add-RemoteStep $remoteCommands 'build Next.js standalone output' 'npm run build'
}

Add-RemoteStep $remoteCommands 'capture standalone build identity' 'test -s .next/standalone/.next/BUILD_ID; AFLDB_BUILT_BUILD_ID="$(tr -d ''\r\n'' < .next/standalone/.next/BUILD_ID)"; test -n "$AFLDB_BUILT_BUILD_ID"; echo "[deploy] built BUILD_ID: $AFLDB_BUILT_BUILD_ID"'

if (-not $SkipRestart) {
  # `sudo` is password-protected on the development host, so `sudo -n` cannot
  # restart the unit over a non-interactive SSH session. The unit runs as the
  # deploying user with Restart=always, so terminating the main process makes
  # *systemd* respawn it from the unit — the environment file is re-read and
  # the restart is still systemd-managed. The respawn is then proven by a new
  # MainPID rather than assumed.
  $restartCommand = @'
if sudo -n systemctl restart __SERVICE__ 2>/dev/null; then
  echo "[deploy] restarted through sudo systemctl"
else
  echo "[deploy] passwordless sudo unavailable; restarting through the unit Restart= policy"
  AFLDB_RESTART_POLICY="$(systemctl show --property Restart --value __SERVICE__)"
  test "$AFLDB_RESTART_POLICY" = always || { echo "[deploy] cannot restart: no passwordless sudo and Restart=$AFLDB_RESTART_POLICY" >&2; exit 23; }
  AFLDB_OLD_PID="$(systemctl show --property MainPID --value __SERVICE__)"
  test "$AFLDB_OLD_PID" -gt 0 || { echo "[deploy] service is stopped; a privileged start is required" >&2; exit 24; }
  kill "$AFLDB_OLD_PID"
  AFLDB_NEW_PID="$AFLDB_OLD_PID"
  for _ in $(seq 1 60); do
    sleep 1
    AFLDB_NEW_PID="$(systemctl show --property MainPID --value __SERVICE__)"
    if [ "$(systemctl is-active __SERVICE__)" = active ] && [ "$AFLDB_NEW_PID" -gt 0 ] && [ "$AFLDB_NEW_PID" != "$AFLDB_OLD_PID" ]; then break; fi
  done
  test "$AFLDB_NEW_PID" -gt 0 && test "$AFLDB_NEW_PID" != "$AFLDB_OLD_PID" || { echo "[deploy] systemd did not respawn the service" >&2; exit 25; }
  echo "[deploy] systemd respawned the service: $AFLDB_OLD_PID -> $AFLDB_NEW_PID"
fi
'@
  Add-RemoteStep $remoteCommands 'restart systemd service' ($restartCommand -replace '__SERVICE__', $quotedServiceName)
  Add-RemoteStep $remoteCommands 'show systemd service status' "systemctl --no-pager --lines=20 status $quotedServiceName"
  if ($Issue107Gate) {
    Add-RemoteStep $remoteCommands 'verify development worker and pool controls' "AFLDB_MAIN_PID=`"`$(systemctl show --property MainPID --value $quotedServiceName)`"; test `"`$AFLDB_MAIN_PID`" -gt 0; AFLDB_RUNTIME_CONTROLS=`"`$(tr '\0' '\n' < /proc/`$AFLDB_MAIN_PID/environ | grep -E '^(AFLDB_WORKERS|AFLDB_POOL_MAX)=' | sort)`"; echo `"`$AFLDB_RUNTIME_CONTROLS`"; echo `"`$AFLDB_RUNTIME_CONTROLS`" | grep -qx 'AFLDB_POOL_MAX=10'; echo `"`$AFLDB_RUNTIME_CONTROLS`" | grep -qx 'AFLDB_WORKERS=4'"
  }
}

if (-not $SkipHealth) {
  Add-RemoteStep $remoteCommands 'check health endpoint' "curl --fail --silent --show-error $quotedHealthUrl"
  Add-RemoteCommand $remoteCommands 'echo'

  if ($Issue107Gate) {
    $liveBuildCommand = 'AFLDB_LIVE_BUILD_ID="$(curl --fail --silent --show-error --dump-header - --output /dev/null ' + $quotedHealthUrl + ' | tr -d ''\r'' | sed -n ''s/^x-afldb-build: //Ip'' | tail -n 1)"; test -n "$AFLDB_LIVE_BUILD_ID" || { echo ''[deploy] x-afldb-build response header is missing'' >&2; exit 21; }; test "$AFLDB_LIVE_BUILD_ID" = "$AFLDB_BUILT_BUILD_ID" || { echo "[deploy] build mismatch: built=$AFLDB_BUILT_BUILD_ID live=$AFLDB_LIVE_BUILD_ID" >&2; exit 22; }; echo "[deploy] live BUILD_ID: $AFLDB_LIVE_BUILD_ID"'
    Add-RemoteStep $remoteCommands 'prove live standalone build identity' $liveBuildCommand
  }
}

# PowerShell writes a UTF-8 BOM into a native command's stdin pipe, so piping
# the script straight into `bash -s` makes the remote shell fail on its first
# line — which is `set -Eeuo pipefail`. The deployment would then keep running
# after a failed stage and could still exit 0. Base64 is plain ASCII, so the
# payload survives the pipe, CRLF normalisation and PowerShell's argument
# handling unchanged.
$remoteScript = ($remoteCommands -join "`n") -replace "`r`n", "`n"
$remotePayload = [Convert]::ToBase64String([System.Text.Encoding]::UTF8.GetBytes($remoteScript))

if ($remotePayload.Length -gt 24000) {
  throw "The remote deployment script is too large to pass as an SSH argument ($($remotePayload.Length) base64 characters)."
}

Write-Host "Deploy target: $SshTarget"
Write-Host "Project dir:   $ProjectDir"
Write-Host "Service:       $ServiceName"
Write-Host "Health URL:    $HealthUrl"
Write-Host "ISSUE-107 gate: $(if ($Issue107Gate) { 'on' } else { 'off' })"
if ($RemoteRef.Trim()) {
  Write-Host "Remote ref:    $($RemoteRef.Trim())"
}
Write-Host ''

if ($PSCmdlet.ShouldProcess($SshTarget, 'sync AFLDB dev deployment from Git')) {
  ssh $SshTarget "echo $remotePayload | base64 -d | bash -s"
  if ($LASTEXITCODE -ne 0) {
    throw "Remote deployment failed with exit code $LASTEXITCODE. Look above for the '[deploy] FAILED' line."
  }
}
