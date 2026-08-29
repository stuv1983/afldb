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
Add-RemoteStep $remoteCommands 'show host' "echo '[deploy] host:' `"$(hostname)`""
Add-RemoteStep $remoteCommands 'show directory' "echo '[deploy] directory:' `"$(pwd)`""
Add-RemoteStep $remoteCommands 'show node version' "echo '[deploy] node:' `"$(node --version)`""
Add-RemoteStep $remoteCommands 'enforce Next.js Node floor' "node -e `"const [major, minor] = process.versions.node.split('.').map(Number); if (major < 20 || (major === 20 && minor < 9)) { console.error('Next.js 16 requires Node >=20.9.0; found ' + process.versions.node); process.exit(1); }`""
Add-RemoteStep $remoteCommands 'show npm version' "echo '[deploy] npm:' `"$(npm --version)`""
Add-RemoteStep $remoteCommands 'show current revision' "echo '[deploy] before:' `"$(git rev-parse --short HEAD)`" `"$(git branch --show-current)`""

if (-not $AllowDirtyServer) {
  Add-RemoteStep $remoteCommands 'check server working tree' "test -z `"$(git status --porcelain)`" || { echo '[deploy] server working tree is dirty; use -AllowDirtyServer to deploy anyway' >&2; git status --short; exit 20; }"
}

if (-not $NoPrune) {
  Add-RemoteStep $remoteCommands 'fetch Git refs with prune' 'git fetch --prune'
} else {
  Add-RemoteStep $remoteCommands 'fetch Git refs' 'git fetch'
}

Add-RemoteStep $remoteCommands 'checkout requested ref if supplied' "if [ -n $quotedRemoteRef ]; then git checkout $quotedRemoteRef; fi"
Add-RemoteStep $remoteCommands 'pull latest commit' 'git pull --ff-only'
Add-RemoteStep $remoteCommands 'show deployed revision' "echo '[deploy] after:' `"$(git rev-parse --short HEAD)`" `"$(git branch --show-current)`""

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
  Add-RemoteStep $remoteCommands 'restart systemd service' "sudo -n systemctl restart $quotedServiceName"
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

$remoteScript = $remoteCommands -join "`n"

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
  $remoteScript | ssh $SshTarget 'bash -s'
  if ($LASTEXITCODE -ne 0) {
    throw "Remote deployment failed with exit code $LASTEXITCODE. Look above for the '[deploy] FAILED' line."
  }
}
