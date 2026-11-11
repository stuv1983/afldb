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
  poll /api/health until its JSON health contract is ready

The script is designed to be run from a Windows workstation:

  powershell -ExecutionPolicy Bypass -File .\deploy\sync-dev.ps1

For AFLDB-ISSUE-107's controlled Linux-dev deployment, first ensure the dev
host has AFLDB_TRACE_REQUESTS=on, AFLDB_WORKERS=4 and AFLDB_POOL_MAX=10, then
add -Issue107Gate. That mode refuses skipped install/build/restart/health
steps and proves the built BUILD_ID equals the live x-afldb-build header.

It does not push local changes. Commit and push first, then run this.

-ExpectedRevision <40-hex commit> pins the deploy: instead of `git pull
--ff-only` (whatever the upstream tip is at that moment), the checked-out branch
is fast-forwarded to exactly that commit, which must already be published on the
branch's upstream; a detached HEAD, an unpublished pin or a diverged branch is
refused before install, migration or build (sync-dev-remote.sh,
afldb_checkout_pinned_revision). Combine with -RemoteRef <branch> to select the
branch first.

-RestartMethod selects how the service is restarted. 'auto' (default) tries
`sudo -n systemctl restart` and falls back to the respawn below when passwordless
sudo is unavailable. 'respawn' never invokes sudo: it requires the unit's
Restart=always, sends SIGTERM to the unit's MainPID (server-cluster.mjs stops its
workers and exits within 5 s; KillMode=mixed), and systemd starts the unit again
after RestartSec; a new MainPID must appear within 60 s, then readiness is polled.
The unit, its environment file and the timers are not touched.

DEPLOY GATE (AFLDB-ISSUE-339). Every run executes afldb_deploy_gate on the host
after `git fetch` and before any checkout change, install, migration, build or
restart. It reports every safely discoverable blocker at once and writes a
timestamped, secret-free record under -EvidenceDir. It checks: expected host,
repository and origin; the exact operational-file allowlist; target branch,
namespace collisions (dev versus dev/v2-main), upstream and a published pin
(a reviewed pin behind the published tip is allowed; local main is preserved,
never deployed); .env names (never values); disk, memory and the service's Node
runtime; running afldb-* jobs and writer timers inside the deploy window; the
owner approval window; acceptance-address reachability from this workstation;
database identity, ledger names and checksums against the target revision and
an explicitly approved migration transition (-ExpectedLedgerBefore/-After;
none pending by default); a verified backup (-BackupDir) and a recoverable
artifact of the serving build (-ArtifactArchive).

  -Phase assess   gate only; nothing changes. Exit 0 READY, 40 BLOCKED,
                  41 PREPARATION REQUIRED (backup, artifact, window, access).
  -Phase execute  (default) the gate must be READY; then checkout (42),
                  pre-migration (43), post-migration parity (44), pre-restart
                  (45) and preserved-state (46) revalidations stop the run.

MIGRATION-ONLY ROUTE (AFLDB-ISSUE-346). `-Phase execute -SkipBuild -SkipRestart` with a pin and an
approved transition applies exactly the approved migrations through the same gate, binding, child line
and parity check, and neither builds nor restarts. The checkout (and npm ci) still advance to the pin;
the old build keeps serving until a full deploy at the same pin follows. Never run db:migrate by hand.

The remote exit status is returned as this script's exit code. -WhatIf only
generates the payload; it never contacts the host and is not an inspection mode.
#>

[CmdletBinding(SupportsShouldProcess = $true)]
param(
  [string] $SshTarget = 'arm@10.0.40.100',
  [string] $ProjectDir = '/home/arm/projects/afldb',
  [string] $ServiceName = 'afldb',
  [string] $HealthUrl = 'http://127.0.0.1:3100/api/health',
  [string] $RemoteRef = '',
  [ValidatePattern('^([0-9a-f]{40})?$')]
  [string] $ExpectedRevision = '',
  [ValidateRange(1, 600)]
  [int] $ReadinessTimeoutSeconds = 120,
  [ValidateRange(1, 30)]
  [int] $ReadinessIntervalSeconds = 2,
  [switch] $SkipInstall,
  [switch] $SkipMigrate,
  [switch] $SkipBuild,
  [switch] $SkipRestart,
  [switch] $SkipHealth,
  [switch] $AllowDirtyServer,
  [switch] $NoPrune,
  [switch] $Issue107Gate,
  [ValidateSet('auto', 'respawn')]
  [string] $RestartMethod = 'auto',
  [ValidateSet('assess', 'execute')]
  [string] $Phase = 'execute',
  [string] $ExpectedHost = 'streamanator',
  [string] $ExpectedOrigin = 'git@github.com-afldb-deploy:stuv1983/afldb.git',
  [string] $ExpectedBranch = '',
  [string] $ExpectedUpstream = 'origin/main',
  [ValidateRange(-1, 9999)]
  [int] $ExpectedLedgerBefore = -1,
  [ValidateRange(-1, 9999)]
  [int] $ExpectedLedgerAfter = -1,
  [ValidatePattern('^[A-Z][A-Z0-9_]*$')]
  [string] $DsnName = 'AFLDB_OWNER_DATABASE_URL',
  [string] $ExpectedDatabase = 'afldb_dev',
  [string[]] $RequiredConfig = @('DATABASE_URL', 'AFLDB_OWNER_DATABASE_URL', 'AFLDB_AUTH_DATABASE_URL',
    'AFLDB_SESSION_SECRET', 'AFLDB_ENV', 'AFLDB_BASE_URL', 'PORT', 'AFLDB_WORKERS', 'AFLDB_POOL_MAX'),
  [ValidateRange(1, 500)]
  [int] $MinFreeGiB = 10,
  [ValidateRange(256, 65536)]
  [int] $MinMemAvailableMiB = 2100,
  [string[]] $ConflictTimers = @('afldb-settle-afl-api', 'afldb-settle-afltables', 'afldb-email-intake'),
  [ValidateRange(5, 720)]
  [int] $ConflictWindowMinutes = 45,
  [string] $ApprovalWindowStart = '',
  [string] $ApprovalWindowEnd = '',
  [string] $BackupDir = '',
  [ValidateRange(1, 72)]
  [int] $MaxBackupAgeHours = 12,
  [string] $ArtifactArchive = '',
  [string] $AcceptanceUrl = 'http://10.0.40.100:8090/beta',
  [string] $EvidenceDir = '/mnt/ssd/afldb/records/deploy-preflight'
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
if ($ReadinessIntervalSeconds -gt $ReadinessTimeoutSeconds) {
  throw '-ReadinessIntervalSeconds cannot exceed -ReadinessTimeoutSeconds.'
}

# --- AFLDB-ISSUE-339 gate arguments: refused on the workstation before anything is sent. ---
$targetBranch = $RemoteRef.Trim()
if ($ExpectedRevision -and -not $ExpectedBranch) {
  throw 'A pinned deploy (-ExpectedRevision) must name -ExpectedBranch.'
}
if ($targetBranch -and $ExpectedBranch -and $targetBranch -ne $ExpectedBranch) {
  throw "-RemoteRef '$targetBranch' and -ExpectedBranch '$ExpectedBranch' disagree."
}
if (-not $targetBranch -and $ExpectedBranch) { $targetBranch = $ExpectedBranch }
foreach ($branchName in @($targetBranch, $ExpectedBranch, $ExpectedUpstream) | Where-Object { $_ }) {
  if ($branchName -notmatch '^[A-Za-z0-9][A-Za-z0-9._/-]*$' -or $branchName -match '\.\.|//|/$|\.lock$') {
    throw "Not a plausible branch name: '$branchName'."
  }
}
if (($ExpectedLedgerBefore -lt 0) -ne ($ExpectedLedgerAfter -lt 0)) {
  throw 'An approved migration transition needs both -ExpectedLedgerBefore and -ExpectedLedgerAfter.'
}
if ($ExpectedLedgerAfter -ge 0 -and $ExpectedLedgerAfter -lt $ExpectedLedgerBefore) {
  throw '-ExpectedLedgerAfter cannot be lower than -ExpectedLedgerBefore.'
}
foreach ($name in $RequiredConfig + $ConflictTimers + @($ExpectedHost, $ExpectedDatabase, $ServiceName)) {
  if ($name -notmatch '^[A-Za-z0-9_.@-]+$') { throw "Not a plausible name: '$name'." }
}
foreach ($path in @($BackupDir, $ArtifactArchive, $EvidenceDir) | Where-Object { $_ }) {
  if (-not $path.StartsWith('/') -or $path -match '[\\\r\n]') { throw "Host paths must be absolute Linux paths: '$path'." }
}
function ConvertTo-WindowEpoch {
  param([string] $Value, [string] $Name)
  if (-not $Value) { return '' }
  $parsed = [DateTimeOffset]::MinValue
  if (-not [DateTimeOffset]::TryParse($Value, [Globalization.CultureInfo]::InvariantCulture,
      [Globalization.DateTimeStyles]::None, [ref] $parsed) -or $Value -notmatch '(Z|[+-]\d{2}:?\d{2})$') {
    throw "$Name must be an ISO 8601 time with an explicit offset, e.g. 2026-11-08T08:00:00+11:00."
  }
  return [string] $parsed.ToUnixTimeSeconds()
}
$windowStart = ConvertTo-WindowEpoch $ApprovalWindowStart '-ApprovalWindowStart'
$windowEnd = ConvertTo-WindowEpoch $ApprovalWindowEnd '-ApprovalWindowEnd'
if (([bool] $windowStart) -ne ([bool] $windowEnd)) { throw 'Supply both -ApprovalWindowStart and -ApprovalWindowEnd.' }

# Workstation-side fact for the one combined report: can this workstation reach the acceptance
# address (the VPN has captured 10.0.40.x before)? Any HTTP response counts; sign-in stays manual.
function Test-AcceptanceAccess {
  param([string] $Url)
  try {
    $request = [Net.HttpWebRequest]::Create($Url)
    $request.Method = 'GET'; $request.Timeout = 8000; $request.AllowAutoRedirect = $false
    $response = $request.GetResponse(); $code = [int] $response.StatusCode; $response.Close()
    return "ok:$code"
  } catch [Net.WebException] {
    if ($_.Exception.Response) { return "ok:$([int] $_.Exception.Response.StatusCode)" }
    return "fail:$($_.Exception.Status)"
  } catch {
    return 'fail:invalid-url'
  }
}
$acceptance = if ($WhatIfPreference) { 'unchecked:whatif' } elseif ($AcceptanceUrl) { Test-AcceptanceAccess $AcceptanceUrl } else { 'unchecked:no-url' }

# AFLDB-ISSUE-346: the mutation steps this run will generate, recorded by the gate in the evidence
# file. -SkipBuild -SkipRestart with migrations on is the gated migration-only DEV route.
$plannedSteps = if ($Phase -eq 'assess') { 'none (assessment)' } else {
  $stepNames = @('checkout')
  if (-not $SkipInstall) { $stepNames += 'install' }
  if (-not $SkipMigrate) { $stepNames += 'migrate' }
  if (-not $SkipBuild) { $stepNames += 'build' }
  if (-not $SkipRestart) { $stepNames += "restart:$RestartMethod" }
  if (-not $SkipHealth) { $stepNames += 'health' }
  ($stepNames -join ' ') + $(if (-not $SkipMigrate -and $SkipBuild -and $SkipRestart) { ' (migration-only route, AFLDB-ISSUE-346; build and restart skipped)' } else { '' })
}

$remoteHelperPath = Join-Path $PSScriptRoot 'sync-dev-remote.sh'
if (-not (Test-Path -LiteralPath $remoteHelperPath -PathType Leaf)) {
  throw "Remote deployment helper was not found: $remoteHelperPath"
}
$remoteHelper = [IO.File]::ReadAllText($remoteHelperPath) -replace "`r`n", "`n"

$quotedProjectDir = Escape-BashSingleQuoted $ProjectDir
$quotedServiceName = Escape-BashSingleQuoted $ServiceName
$quotedHealthUrl = Escape-BashSingleQuoted $HealthUrl
$quotedRemoteRef = if ($RemoteRef.Trim()) { Escape-BashSingleQuoted $RemoteRef.Trim() } else { "''" }

$remoteCommands = [System.Collections.Generic.List[string]]::new()
Add-RemoteCommand $remoteCommands 'set -Eeuo pipefail'
Add-RemoteCommand $remoteCommands 'trap ''code=$?; echo "[deploy] FAILED line ${LINENO}: ${BASH_COMMAND}" >&2; exit $code'' ERR'
Add-RemoteCommand $remoteCommands $remoteHelper
# Gate inputs: every value single-quoted, so nothing expands on either side.
$gateInputs = [ordered] @{
  AFLDB_PF_PHASE = $Phase
  AFLDB_PF_STEPS = $plannedSteps
  AFLDB_PF_EXPECTED_HOST = $ExpectedHost
  AFLDB_PF_PROJECT_DIR = $ProjectDir
  AFLDB_PF_EXPECTED_ORIGIN = $ExpectedOrigin
  AFLDB_PF_TARGET_BRANCH = $targetBranch
  AFLDB_PF_EXPECTED_BRANCH = $ExpectedBranch
  AFLDB_PF_EXPECTED_UPSTREAM = $ExpectedUpstream
  AFLDB_PF_EXPECTED_REVISION = $ExpectedRevision
  AFLDB_PF_LEDGER_BEFORE = $(if ($ExpectedLedgerBefore -ge 0) { [string] $ExpectedLedgerBefore } else { '' })
  AFLDB_PF_LEDGER_AFTER = $(if ($ExpectedLedgerAfter -ge 0) { [string] $ExpectedLedgerAfter } else { '' })
  AFLDB_PF_SKIP_MIGRATE = $(if ($SkipMigrate) { '1' } else { '0' })
  AFLDB_PF_ALLOW_DIRTY = $(if ($AllowDirtyServer) { '1' } else { '0' })
  AFLDB_PF_DSN_NAME = $DsnName
  AFLDB_PF_EXPECTED_DATABASE = $ExpectedDatabase
  AFLDB_PF_REQUIRED_CONFIG = ($RequiredConfig -join ' ')
  AFLDB_PF_MIN_FREE_GIB = [string] $MinFreeGiB
  AFLDB_PF_MIN_MEM_MIB = [string] $MinMemAvailableMiB
  AFLDB_PF_SERVICE = $ServiceName
  AFLDB_PF_CONFLICT_TIMERS = ($ConflictTimers -join ' ')
  AFLDB_PF_CONFLICT_MINUTES = [string] $ConflictWindowMinutes
  AFLDB_PF_WINDOW_START = $windowStart
  AFLDB_PF_WINDOW_END = $windowEnd
  AFLDB_PF_BACKUP_DIR = $BackupDir
  AFLDB_PF_MAX_BACKUP_AGE_HOURS = [string] $MaxBackupAgeHours
  AFLDB_PF_ARTIFACT = $ArtifactArchive
  AFLDB_PF_ACCEPTANCE = $acceptance
  AFLDB_PF_EVIDENCE_DIR = $EvidenceDir
}
# The helper's clock/meminfo overrides exist for its unit tests only; a deploy never honours them.
Add-RemoteCommand $remoteCommands 'unset AFLDB_PF_NOW AFLDB_PF_MEMINFO'
foreach ($entry in $gateInputs.GetEnumerator()) {
  $value = if ($entry.Value) { Escape-BashSingleQuoted ([string] $entry.Value) } else { "''" }
  Add-RemoteCommand $remoteCommands "$($entry.Key)=$value"
}
Add-RemoteCommand $remoteCommands 'trap ''afldb_pf_finish $?'' EXIT'
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

if ($Phase -eq 'assess') {
  # Assessment: refs are fetched (no prune), the gate runs, nothing else. Exit 0/40/41.
  Add-RemoteStep $remoteCommands 'fetch Git refs (assessment; no prune)' 'git fetch'
  Add-RemoteStep $remoteCommands 'deploy gate (assessment)' 'afldb_deploy_gate'
  Add-RemoteStep $remoteCommands 'assessment complete' 'echo "[deploy] assessment READY; nothing was changed"'
} else {
if (-not $NoPrune) {
  Add-RemoteStep $remoteCommands 'fetch Git refs with prune' 'git fetch --prune'
} else {
  Add-RemoteStep $remoteCommands 'fetch Git refs' 'git fetch'
}

# The gate precedes every mutation; under `set -e` a non-zero gate ends the run here.
Add-RemoteStep $remoteCommands 'deploy gate (readiness to mutate)' 'afldb_deploy_gate'
Add-RemoteStep $remoteCommands 'switch to the target branch if needed' 'if [ "$(git branch --show-current)" != "$AFLDB_PF_TARGET_BRANCH_RESOLVED" ]; then git switch --no-guess "$AFLDB_PF_TARGET_BRANCH_RESOLVED"; fi'
# Pinned or not, the branch fast-forwards to exactly the revision the gate assessed (an unpinned
# deploy's target is the upstream tip seen by the gate); `git pull` is never run.
Add-RemoteStep $remoteCommands 'fast-forward to the assessed revision' 'afldb_checkout_pinned_revision "$AFLDB_PF_TARGET_REV"'
Add-RemoteStep $remoteCommands 'revalidate the checkout' 'afldb_pf_revalidate_checkout'
Add-RemoteStep $remoteCommands 'show deployed revision' 'echo "[deploy] after: $(git rev-parse --short HEAD) $(git branch --show-current)"'

if (-not $SkipInstall) {
  Add-RemoteStep $remoteCommands 'install dependencies' 'npm ci'
}

if (-not $SkipMigrate) {
  Add-RemoteStep $remoteCommands 'revalidate before migration' 'afldb_pf_revalidate_before_migration'
  # AFLDB-ISSUE-339 R339-A: the migration child is pinned to the database the gate assessed. The
  # gate's afldb_pf_migration_binding already refused any exported target/DSN and any .env form
  # migrate.ts and the gate would read differently; removing both variables here and naming the
  # target explicitly means the child can only resolve dev -> AFLDB_OWNER_DATABASE_URL from .env.
  Add-RemoteStep $remoteCommands 'run database migrations' 'env -u AFLDB_MIGRATE_TARGET -u AFLDB_OWNER_DATABASE_URL npm run db:migrate -- --target dev'
}
Add-RemoteStep $remoteCommands 'post-migration parity' 'afldb_pf_migration_parity'

if (-not $SkipBuild) {
  Add-RemoteStep $remoteCommands 'build Next.js standalone output' 'npm run build'
}

if (-not $SkipBuild) {
  Add-RemoteStep $remoteCommands 'capture standalone build identity' 'test -s .next/standalone/.next/BUILD_ID; AFLDB_BUILT_BUILD_ID="$(tr -d ''\r\n'' < .next/standalone/.next/BUILD_ID)"; test -n "$AFLDB_BUILT_BUILD_ID"; echo "[deploy] built BUILD_ID: $AFLDB_BUILT_BUILD_ID"'
} else {
  # AFLDB-ISSUE-346: nothing was built; report the existing (serving) build without calling it built.
  Add-RemoteStep $remoteCommands 'capture serving build identity (build skipped)' 'test -s .next/standalone/.next/BUILD_ID; AFLDB_BUILT_BUILD_ID="$(tr -d ''\r\n'' < .next/standalone/.next/BUILD_ID)"; test -n "$AFLDB_BUILT_BUILD_ID"; echo "[deploy] serving BUILD_ID (not rebuilt): $AFLDB_BUILT_BUILD_ID"'
}

if (-not $SkipRestart) {
  Add-RemoteStep $remoteCommands 'revalidate before restart' 'afldb_pf_revalidate_before_restart'
  # `sudo` is password-protected on the development host, so `sudo -n` cannot
  # restart the unit over a non-interactive SSH session. The unit runs as the
  # deploying user with Restart=always, so terminating the main process makes
  # *systemd* respawn it from the unit — the environment file is re-read and
  # the restart is still systemd-managed. The respawn is then proven by a new
  # MainPID rather than assumed.
  # The respawn path: SIGTERM to MainPID, systemd's Restart=always starts the unit
  # again, proven by a new MainPID. Shared verbatim by both methods.
  $respawnCommand = @'
AFLDB_RESTART_POLICY="$(systemctl show --property Restart --value __SERVICE__)"
test "$AFLDB_RESTART_POLICY" = always || { echo "[deploy] cannot respawn: the unit has Restart=$AFLDB_RESTART_POLICY, not always" >&2; exit 23; }
AFLDB_OLD_PID="$(systemctl show --property MainPID --value __SERVICE__)"
test "$AFLDB_OLD_PID" -gt 0 || { echo "[deploy] service is stopped; a privileged start is required" >&2; exit 24; }
kill "$AFLDB_OLD_PID"
AFLDB_NEW_PID="$AFLDB_OLD_PID"
for _ in $(seq 1 60); do
  sleep 1
  AFLDB_NEW_PID="$(systemctl show --property MainPID --value __SERVICE__)"
  if [ "$(systemctl is-active __SERVICE__)" = active ] && [ "$AFLDB_NEW_PID" -gt 0 ] && [ "$AFLDB_NEW_PID" != "$AFLDB_OLD_PID" ]; then break; fi
  afldb_service_state __SERVICE__
  if [ "$AFLDB_SERVICE_ACTIVE" = failed ] || { [ "$AFLDB_SERVICE_ACTIVE" = inactive ] && [ "$AFLDB_SERVICE_SUB" = dead ]; }; then
    afldb_readiness_diagnostics __SERVICE__ __HEALTH_URL__ 0 "service failed before systemd respawn completed"
    exit 25
  fi
done
test "$AFLDB_NEW_PID" -gt 0 && test "$AFLDB_NEW_PID" != "$AFLDB_OLD_PID" || { echo "[deploy] systemd did not respawn the service" >&2; exit 25; }
echo "[deploy] systemd respawned the service: $AFLDB_OLD_PID -> $AFLDB_NEW_PID"
'@
  $respawnCommand = $respawnCommand -replace "`r`n", "`n"
  if ($RestartMethod -eq 'respawn') {
    # Explicit, sudo-free method: no sudo invocation is generated at all.
    $restartCommand = "echo `"[deploy] restart method: respawn (SIGTERM to MainPID; systemd Restart=always)`"`n" + $respawnCommand
  } else {
    $indented = (($respawnCommand.TrimEnd("`n") -split "`n") | ForEach-Object { '  ' + $_ }) -join "`n"
    $restartCommand = "if sudo -n systemctl restart __SERVICE__ 2>/dev/null; then`n" +
      "  echo `"[deploy] restarted through sudo systemctl`"`n" +
      "else`n" +
      "  echo `"[deploy] passwordless sudo unavailable; restarting through the unit Restart= policy`"`n" +
      $indented + "`nfi"
  }
  $restartCommand = $restartCommand -replace '__SERVICE__', $quotedServiceName
  $restartCommand = $restartCommand -replace '__HEALTH_URL__', $quotedHealthUrl
  Add-RemoteStep $remoteCommands 'restart systemd service' $restartCommand
  Add-RemoteStep $remoteCommands 'show systemd service status' "systemctl --no-pager --lines=20 status $quotedServiceName || true"
  if ($Issue107Gate) {
    Add-RemoteStep $remoteCommands 'verify development worker and pool controls' "AFLDB_MAIN_PID=`"`$(systemctl show --property MainPID --value $quotedServiceName)`"; test `"`$AFLDB_MAIN_PID`" -gt 0; AFLDB_RUNTIME_CONTROLS=`"`$(tr '\0' '\n' < /proc/`$AFLDB_MAIN_PID/environ | grep -E '^(AFLDB_WORKERS|AFLDB_POOL_MAX)=' | sort)`"; echo `"`$AFLDB_RUNTIME_CONTROLS`"; echo `"`$AFLDB_RUNTIME_CONTROLS`" | grep -qx 'AFLDB_POOL_MAX=10'; echo `"`$AFLDB_RUNTIME_CONTROLS`" | grep -qx 'AFLDB_WORKERS=4'"
  }
}

if (-not $SkipHealth) {
  $expectedBuildArgument = if ($Issue107Gate) { '"$AFLDB_BUILT_BUILD_ID"' } else { "''" }
  $readinessCommand = 'afldb_wait_for_readiness ' + $quotedServiceName + ' ' + $quotedHealthUrl + ' ' +
    $ReadinessTimeoutSeconds + ' ' + $ReadinessIntervalSeconds + ' ' + $expectedBuildArgument
  Add-RemoteStep $remoteCommands 'wait for healthy service readiness' $readinessCommand
}
Add-RemoteStep $remoteCommands 'verify preserved state' 'afldb_pf_verify_preserved'
}

# PowerShell writes a UTF-8 BOM into a native command's stdin pipe, so piping
# the script straight into `bash -s` makes the remote shell fail on its first
# line — which is `set -Eeuo pipefail`. The deployment would then keep running
# after a failed stage and could still exit 0. Base64 is plain ASCII, so the
# payload survives the pipe, CRLF normalisation and PowerShell's argument
# handling unchanged.
$remoteScript = ($remoteCommands -join "`n") -replace "`r`n", "`n"
# gzip before base64 keeps the gated payload well inside the SSH argument limit.
$scriptBytes = [System.Text.Encoding]::UTF8.GetBytes($remoteScript)
$compressed = New-Object System.IO.MemoryStream
$gzip = New-Object System.IO.Compression.GZipStream($compressed, [System.IO.Compression.CompressionMode]::Compress)
$gzip.Write($scriptBytes, 0, $scriptBytes.Length)
$gzip.Close()
$remotePayload = [Convert]::ToBase64String($compressed.ToArray())

if ($remotePayload.Length -gt 24000) {
  throw "The remote deployment script is too large to pass as an SSH argument ($($remotePayload.Length) base64 characters)."
}

Write-Host "Deploy target: $SshTarget"
Write-Host "Project dir:   $ProjectDir"
Write-Host "Service:       $ServiceName"
Write-Host "Health URL:    $HealthUrl"
Write-Host "Readiness:     $ReadinessTimeoutSeconds s timeout / $ReadinessIntervalSeconds s interval"
Write-Host "ISSUE-107 gate: $(if ($Issue107Gate) { 'on' } else { 'off' })"
if (-not $SkipRestart) {
  Write-Host "Restart:       $RestartMethod$(if ($RestartMethod -eq 'respawn') { ' (SIGTERM to MainPID, systemd Restart=always; no sudo)' } else { ' (sudo -n, else respawn)' })"
}
if ($RemoteRef.Trim()) {
  Write-Host "Remote ref:    $($RemoteRef.Trim())"
}
if ($ExpectedRevision) {
  Write-Host "Pinned to:     $ExpectedRevision (fast-forward only; no git pull)"
}
Write-Host ''

Write-Host "Phase:         $Phase$(if ($Phase -eq 'assess') { ' (gate only; nothing changes)' } else { ' (gate, then mutation)' })"
Write-Host "Steps:         $plannedSteps"
Write-Host "Acceptance:    $acceptance"
Write-Host "Evidence:      $EvidenceDir"
Write-Host ''

# AFLDB-ISSUE-339 R339-C: the remote outer shell decodes the WHOLE payload to a private temporary
# file, and runs it only if base64 and gunzip both succeeded (gzip's CRC/length trailer rejects a
# corrupt or truncated payload) and the result is non-empty. The old `echo | base64 -d | gunzip |
# bash -s` returned bash's status: a missing or failing decoder fed bash empty (or partial) input
# and SSH reported success with no gate run. No pipeline status decides anything here, so this
# holds under any POSIX login shell, with or without pipefail. Exit 47 = transport decode failure.
$transportPath = Join-Path $PSScriptRoot 'sync-dev-transport.sh'
$transportTemplate = ([IO.File]::ReadAllText($transportPath) -replace "`r", '').Trim()
if (-not $transportTemplate.Contains('__AFLDB_PAYLOAD__')) { throw "Transport template is malformed: $transportPath" }
$transportCommand = $transportTemplate.Replace('__AFLDB_PAYLOAD__', $remotePayload)

if ($PSCmdlet.ShouldProcess($SshTarget, "AFLDB dev deployment ($Phase)")) {
  ssh $SshTarget $transportCommand
  $remoteExit = $LASTEXITCODE
  if ($remoteExit -ne 0) {
    $meaning = switch ($remoteExit) {
      40 { 'deploy gate BLOCKED; nothing was changed' }
      41 { 'deploy gate PREPARATION REQUIRED; nothing was changed' }
      42 { 'checkout revalidation failed' }
      43 { 'pre-migration revalidation failed' }
      44 { 'post-migration parity failed' }
      45 { 'pre-restart revalidation failed' }
      46 { 'preserved-state check failed' }
      47 { 'the payload could not be decoded on the server; no gate or deployment step ran' }
      default { "look above for the '[deploy] FAILED' line" }
    }
    Write-Error "Remote deployment exited $remoteExit ($meaning)." -ErrorAction Continue
    # exit, not throw: the remote status survives pipelines, Tee-Object and powershell -File callers.
    exit $remoteExit
  }
}
