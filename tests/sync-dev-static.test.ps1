param(
  [string] $ExportDir = '',
  [string] $GitBashPath = ''
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

$root = Split-Path -Parent $PSScriptRoot
$syncScript = Join-Path $root 'deploy\sync-dev.ps1'

# Git for Windows Bash only. A bare `bash` may resolve to C:\Windows\System32\bash.exe (the WSL launcher), which is
# out of scope and can open a WSL repair/install prompt, so Bash is never taken from PATH and is never launched until
# the file layout below has been checked. An explicit -GitBashPath is used as given (no fallback); otherwise a bounded
# set of Git for Windows locations is examined: the installer's registry InstallPath, each git.exe on PATH, then the
# standard install roots.
function Get-GitBashProblem([string] $Path) {
  if (-not $Path) { return 'no path' }
  if (-not (Test-Path -LiteralPath $Path -PathType Leaf)) { return 'not found' }
  $full = (Resolve-Path -LiteralPath $Path).Path
  if ((Split-Path -Leaf $full) -ne 'bash.exe') { return 'not bash.exe' }
  if ($env:SystemRoot -and $full.StartsWith($env:SystemRoot.TrimEnd('\') + '\', [StringComparison]::OrdinalIgnoreCase)) {
    return 'a Windows system (WSL) bash, not Git for Windows'
  }
  $dir = Split-Path -Parent $full
  # msys-2.0.dll identifies Git for Windows usr\bin (its bin\bash.exe launcher lacks it); the rest are the transport's
  # decoder tools, without which a damaged-payload case could pass for the wrong reason.
  foreach ($need in @('msys-2.0.dll', 'base64.exe', 'gzip.exe', 'gunzip', 'mktemp.exe')) {
    if (-not (Test-Path -LiteralPath (Join-Path $dir $need) -PathType Leaf)) { return "no $need beside it (expected Git for Windows usr\bin\bash.exe)" }
  }
  return ''
}

if ($GitBashPath) {
  $problem = Get-GitBashProblem $GitBashPath
  if ($problem) {
    throw "-GitBashPath '$GitBashPath' is not usable: $problem. Pass <Git for Windows root>\usr\bin\bash.exe."
  }
  $bash = (Resolve-Path -LiteralPath $GitBashPath).Path
  $bashSource = '-GitBashPath'
} else {
  $roots = New-Object 'System.Collections.Generic.List[object]'
  foreach ($key in @('HKLM:\SOFTWARE\GitForWindows', 'HKCU:\SOFTWARE\GitForWindows', 'HKLM:\SOFTWARE\WOW6432Node\GitForWindows')) {
    try {
      $installPath = (Get-ItemProperty -LiteralPath $key -Name InstallPath -ErrorAction Stop).InstallPath
      if ($installPath) { $roots.Add(@($installPath, "registry $key")) }
    } catch { }
  }
  $gitOnPath = @()
  try { $gitOnPath = @(Get-Command -Name git.exe -CommandType Application -All -ErrorAction Stop | ForEach-Object { $_.Path }) } catch { }
  foreach ($gitExe in $gitOnPath) {
    # <root>\cmd\git.exe, <root>\bin\git.exe or <root>\mingw64\bin\git.exe (also mingw32, clangarm64).
    $gitDir = Split-Path -Parent $gitExe
    $up = Split-Path -Parent $gitDir
    if ((Split-Path -Leaf $gitDir) -in @('cmd', 'bin')) {
      if ((Split-Path -Leaf $up) -in @('mingw64', 'mingw32', 'clangarm64')) { $up = Split-Path -Parent $up }
      $roots.Add(@($up, "git.exe on PATH ($gitExe)"))
    }
  }
  foreach ($base in @($env:ProgramFiles, $env:ProgramW6432, ${env:ProgramFiles(x86)})) {
    if ($base) { $roots.Add(@((Join-Path $base 'Git'), 'standard location')) }
  }
  if ($env:LOCALAPPDATA) { $roots.Add(@((Join-Path $env:LOCALAPPDATA 'Programs\Git'), 'standard per-user location')) }
  if ($env:USERPROFILE) { $roots.Add(@((Join-Path $env:USERPROFILE 'scoop\apps\git\current'), 'standard Scoop location')) }

  $bash = ''
  $examined = New-Object 'System.Collections.Generic.List[string]'
  $seen = @{}
  foreach ($installRootEntry in $roots) {
    $candidate = Join-Path $installRootEntry[0] 'usr\bin\bash.exe'
    if ($seen.ContainsKey($candidate.ToLowerInvariant())) { continue }
    $seen[$candidate.ToLowerInvariant()] = $true
    $problem = Get-GitBashProblem $candidate
    if (-not $problem) { $bash = (Resolve-Path -LiteralPath $candidate).Path; $bashSource = $installRootEntry[1]; break }
    $examined.Add("  $candidate [$($installRootEntry[1])]: $problem")
  }
  if (-not $bash) {
    $gitNote = 'none'
    if ($gitOnPath.Count -gt 0) { $gitNote = $gitOnPath -join ', ' }
    throw ("Git for Windows Bash was not found. git.exe on PATH: $gitNote. Examined:`n" + ($examined -join "`n") +
      "`nPass -GitBashPath <Git for Windows root>\usr\bin\bash.exe (the directory must also hold msys-2.0.dll, base64.exe, gzip.exe, gunzip and mktemp.exe). WSL bash is not supported by this harness.")
  }
}
Write-Output "Using Git Bash at $bash (from $bashSource)"

function Assert-True {
  param(
    [Parameter(Mandatory = $true)][bool] $Condition,
    [Parameter(Mandatory = $true)][string] $Message
  )
  if (-not $Condition) { throw $Message }
}

function Get-GeneratedRemoteScript {
  param([switch] $Issue107Gate)

  return & {
    if ($Issue107Gate) {
      . $syncScript -WhatIf -Issue107Gate *> $null
    } else {
      . $syncScript -WhatIf *> $null
    }
    $remoteScript
  }
}

$defaultScript = Get-GeneratedRemoteScript
$issue107Script = Get-GeneratedRemoteScript -Issue107Gate
$customScript = & {
  . $syncScript -WhatIf -AllowDirtyServer -ReadinessTimeoutSeconds 90 -ReadinessIntervalSeconds 3 *> $null
  $remoteScript
}

$pin = '0123456789abcdef0123456789abcdef01234567'
$pinnedScript = & {
  . $syncScript -WhatIf -RemoteRef 'dev/v2-main' -ExpectedBranch 'dev/v2-main' -ExpectedRevision $pin *> $null
  $remoteScript
}
$ffLine = 'afldb_checkout_pinned_revision "$AFLDB_PF_TARGET_REV"'
Assert-True ($defaultScript -notmatch "(?m)^git pull") 'an unpinned deploy must fast-forward to the assessed tip, never git pull'
Assert-True ($defaultScript.Contains($ffLine)) 'an unpinned deploy must fast-forward to the revision the gate assessed'
Assert-True ($pinnedScript -match "(?m)^AFLDB_PF_EXPECTED_REVISION='$pin'$") 'a pinned deploy must hand exactly the pin to the gate'
Assert-True ($pinnedScript.Contains($ffLine)) 'a pinned deploy must fast-forward to exactly the assessed pin'
Assert-True ($pinnedScript -notmatch "(?m)^git pull") 'a pinned deploy must not git pull'
Assert-True ($pinnedScript -notmatch "(?m)^git checkout") 'a deploy must never git checkout (no DWIM branch creation)'

# AFLDB-ISSUE-339: the gate precedes every mutation; assessment contains no mutation at all.
$gateAt = $pinnedScript.IndexOf("`nafldb_deploy_gate`n")
Assert-True ($gateAt -gt 0) 'the deploy gate must run as its own step'
Assert-True ($pinnedScript.IndexOf("`ngit fetch --prune`n") -lt $gateAt) 'the gate must run after the fetch'
# AFLDB-ISSUE-339 R339-A: the migration child is pinned (explicit target, no exported target/DSN).
$migrateLine = "`nenv -u AFLDB_MIGRATE_TARGET -u AFLDB_OWNER_DATABASE_URL npm run db:migrate -- --target dev`n"
Assert-True ($pinnedScript.Contains($migrateLine)) 'the migration must run pinned to --target dev with the target/DSN variables removed'
Assert-True ($pinnedScript -notmatch "(?m)^npm run db:migrate") 'no unpinned db:migrate may remain'
foreach ($mutation in @('git switch --no-guess', $ffLine, "`nnpm ci`n", $migrateLine, "`nnpm run build`n", 'kill "$AFLDB_OLD_PID"')) {
  Assert-True ($pinnedScript.IndexOf($mutation) -gt $gateAt) "the gate must precede: $mutation"
}
Assert-True ($pinnedScript.IndexOf('afldb_pf_revalidate_before_migration') -lt $pinnedScript.IndexOf($migrateLine)) 'migration must be revalidated first'
Assert-True ($pinnedScript.IndexOf("`nafldb_pf_migration_parity`n") -gt $pinnedScript.IndexOf($migrateLine)) 'post-migration parity must follow the migration'
Assert-True ($pinnedScript.IndexOf("`nafldb_pf_migration_parity`n") -lt $pinnedScript.IndexOf("`nnpm run build`n")) 'parity must be proven before the build'
Assert-True ($pinnedScript.IndexOf("`nafldb_pf_revalidate_before_restart`n") -lt $pinnedScript.IndexOf('kill "$AFLDB_OLD_PID"')) 'restart must be revalidated first'
Assert-True ($pinnedScript.IndexOf('unset AFLDB_PF_NOW AFLDB_PF_MEMINFO') -lt $pinnedScript.IndexOf("AFLDB_PF_PHASE='execute'")) 'test-only clock/meminfo hooks must be cleared'
Assert-True ($pinnedScript.Contains("`ntrap 'afldb_pf_finish `$?' EXIT`n")) 'the final exit status must be recorded'
$assessScript = & { . $syncScript -WhatIf -Phase assess -RemoteRef 'dev-v2-main' -ExpectedBranch 'dev-v2-main' -ExpectedRevision $pin *> $null; $remoteScript }
$assessSteps = ($assessScript -split "`n" | Where-Object { $_.StartsWith("echo '[deploy] >>> ") }) -join "`n"
Assert-True ($assessScript.Contains("`nafldb_deploy_gate`n") -and $assessScript.Contains("`ngit fetch`n")) 'assessment must fetch (no prune) and run the gate'
foreach ($forbidden in @('npm ci', 'npm run', 'git switch', 'afldb_checkout_pinned_revision "', 'kill "', 'git fetch --prune')) {
  Assert-True (-not ($assessScript -split "`n" | Where-Object { $_.StartsWith($forbidden) })) "assessment must not run: $forbidden"
}
Assert-True ($assessSteps -notmatch 'restart|install|migration|build') 'assessment must list no mutation step'
foreach ($refusal in @(
    @{ args = @{ ExpectedRevision = $pin }; why = 'a pin without -ExpectedBranch' },
    @{ args = @{ RemoteRef = 'dev'; ExpectedBranch = 'dev-v2-main' }; why = '-RemoteRef/-ExpectedBranch disagreement' },
    @{ args = @{ ExpectedLedgerBefore = 110 }; why = 'half a migration transition' },
    @{ args = @{ ExpectedLedgerBefore = 118; ExpectedLedgerAfter = 110 }; why = 'a backwards transition' },
    @{ args = @{ ApprovalWindowStart = '2026-11-07T08:00:00'; ApprovalWindowEnd = '2026-11-07T18:00:00' }; why = 'a window without an offset' },
    @{ args = @{ BackupDir = 'C:\backup' }; why = 'a non-Linux host path' })) {
  $refused = $false
  $splat = $refusal.args
  try { & { . $syncScript -WhatIf @splat *> $null } } catch { $refused = $true }
  Assert-True $refused "the workstation must refuse $($refusal.why)"
}
$badPinRefused = $false
try { & { . $syncScript -WhatIf -ExpectedRevision 'ABC123' *> $null } } catch { $badPinRefused = $true }
Assert-True $badPinRefused 'a short pin must be refused on the workstation'

Assert-True ($defaultScript -notmatch "`r") 'generated remote script must contain LF only'
Assert-True ($defaultScript -match [regex]::Escape('$(hostname)')) 'remote hostname expansion was lost'
Assert-True ($defaultScript -match [regex]::Escape('$(git rev-parse --short HEAD)')) 'remote Git expansion was lost'
Assert-True ($issue107Script -match [regex]::Escape('"$AFLDB_BUILT_BUILD_ID"')) 'ISSUE-107 build identity was expanded on the workstation'
Assert-True ($defaultScript -match "(?m)^AFLDB_PF_ALLOW_DIRTY='0'$") 'default dirty-tree classification (inside the gate) is missing'
Assert-True ($defaultScript -match 'afldb_wait_for_readiness.+ 120 2 ') 'default readiness bounds are missing'
Assert-True ($customScript -match "(?m)^AFLDB_PF_ALLOW_DIRTY='1'$") 'AllowDirtyServer was not made explicit remotely'
Assert-True ($customScript -match 'afldb_wait_for_readiness.+ 90 3 ') 'custom readiness bounds were not propagated'
Assert-True (([regex]::Matches($defaultScript, 'sudo -n systemctl restart')).Count -eq 1) 'remote script must attempt sudo restart exactly once'
Assert-True (([regex]::Matches($defaultScript, 'kill "\$AFLDB_OLD_PID"')).Count -eq 1) 'Restart= fallback must terminate MainPID exactly once'
Assert-True ($defaultScript -notmatch 'git\s+(?:clean|reset)') 'remote script must not clean or reset the checkout'

function ConvertFrom-Payload([string] $Payload) {
  $gz = New-Object IO.Compression.GZipStream((New-Object IO.MemoryStream(, [Convert]::FromBase64String($Payload))), [IO.Compression.CompressionMode]::Decompress)
  $reader = New-Object IO.StreamReader($gz, [Text.UTF8Encoding]::new($false)); $text = $reader.ReadToEnd(); $reader.Close(); return $text
}
$payload = & { . $syncScript -WhatIf *> $null; $remotePayload }
Assert-True ((ConvertFrom-Payload $payload) -ceq $defaultScript) 'gzip+base64 transport changed the remote script'
Assert-True ($payload.Length -le 24000) 'generated SSH payload exceeds the enforced safety limit'
# The largest variant actually used (AFLDB-ISSUE-336 DEV procedure step 6): pinned + ISSUE-107 gate.
$pinnedGatePayload = & {
  . $syncScript -WhatIf -RemoteRef 'dev/v2-main' -ExpectedBranch 'dev/v2-main' -ExpectedRevision $pin -Issue107Gate *> $null
  $remotePayload
}
Assert-True ($pinnedGatePayload.Length -le 24000) 'the pinned ISSUE-107-gated SSH payload exceeds the enforced safety limit'

# -RestartMethod respawn: one explicit restart method with no sudo invocation anywhere in the generated script.
$respawnScript = & {
  . $syncScript -WhatIf -RemoteRef 'dev/v2-main' -ExpectedBranch 'dev/v2-main' -ExpectedRevision $pin -Issue107Gate -RestartMethod respawn *> $null
  $remoteScript
}
Assert-True ($respawnScript -notmatch 'sudo') 'a respawn deploy must not invoke or mention sudo'
Assert-True (([regex]::Matches($respawnScript, '(?m)^kill "\$AFLDB_OLD_PID"$')).Count -eq 1) 'a respawn deploy must terminate MainPID exactly once'
Assert-True ($respawnScript.IndexOf('kill "$AFLDB_OLD_PID"') -gt $respawnScript.IndexOf('npm run build')) 'the respawn must come after the build'
Assert-True ($respawnScript.IndexOf('kill "$AFLDB_OLD_PID"') -lt $respawnScript.IndexOf('afldb_wait_for_readiness ')) 'readiness must be polled after the respawn'
Assert-True ($respawnScript -match [regex]::Escape('"$AFLDB_BUILT_BUILD_ID"')) 'a respawn deploy must keep the ISSUE-107 build identity'
$respawnPayload = & {
  . $syncScript -WhatIf -RemoteRef 'dev/v2-main' -ExpectedBranch 'dev/v2-main' -ExpectedRevision $pin -Issue107Gate -RestartMethod respawn *> $null
  $remotePayload
}
Assert-True ($respawnPayload.Length -le 24000) 'the respawn SSH payload exceeds the enforced safety limit'
$badMethodRefused = $false
try { & { . $syncScript -WhatIf -RestartMethod 'sudo' *> $null } } catch { $badMethodRefused = $true }
Assert-True $badMethodRefused 'an unknown restart method must be refused on the workstation'

# AFLDB-ISSUE-346: the migration-only DEV route is the same gated payload with no build and no restart.
$migrateOnlyArgs = @{ RemoteRef = 'dev-v2-main'; ExpectedBranch = 'dev-v2-main'; ExpectedRevision = $pin
  ExpectedLedgerBefore = 117; ExpectedLedgerAfter = 118; SkipBuild = $true; SkipRestart = $true }
$migrateOnlyScript = & { . $syncScript -WhatIf @migrateOnlyArgs *> $null; $remoteScript }
$moGate = $migrateOnlyScript.IndexOf("`nafldb_deploy_gate`n")
$moMigrate = $migrateOnlyScript.IndexOf($migrateLine)
$moParity = $migrateOnlyScript.IndexOf("`nafldb_pf_migration_parity`n")
Assert-True ($moGate -gt $migrateOnlyScript.IndexOf("`ngit fetch --prune`n")) 'migration-only: the gate must run after the fetch'
foreach ($mutation in @('git switch --no-guess', $ffLine, "`nnpm ci`n", $migrateLine)) {
  Assert-True ($migrateOnlyScript.IndexOf($mutation) -gt $moGate) "migration-only: the gate must precede: $mutation"
}
Assert-True (([regex]::Matches($migrateOnlyScript, [regex]::Escape($migrateLine))).Count -eq 1) 'migration-only: exactly one pinned migration child'
Assert-True ($migrateOnlyScript -notmatch '(?m)^(env [^\n]*)?npm run db:migrate(?! -- --target dev$)') 'migration-only: no other db:migrate form'
Assert-True ($migrateOnlyScript.IndexOf("`nafldb_pf_revalidate_before_migration`n") -lt $moMigrate -and $moMigrate -lt $moParity) 'migration-only: revalidate, migrate, parity in that order'
Assert-True ($migrateOnlyScript -notmatch '(?m)^npm run build') 'migration-only: no build'
foreach ($forbidden in @('kill "$AFLDB_OLD_PID"', 'sudo', "`nafldb_pf_revalidate_before_restart`n", 'systemctl restart', 'built BUILD_ID:')) {
  Assert-True (-not $migrateOnlyScript.Contains($forbidden)) "migration-only must not contain: $forbidden"
}
Assert-True ($migrateOnlyScript.IndexOf('serving BUILD_ID (not rebuilt)') -gt $moParity) 'migration-only: the serving build is reported, not called built'
Assert-True ($migrateOnlyScript.IndexOf('afldb_wait_for_readiness ') -gt $moParity) 'migration-only: the untouched service is still probed after the migration'
Assert-True ($migrateOnlyScript.IndexOf("echo '[deploy] >>> verify preserved state'`nafldb_pf_verify_preserved") -gt $moParity) 'migration-only: preserved state is still verified'
Assert-True ($migrateOnlyScript -match "(?m)^AFLDB_PF_LEDGER_BEFORE='117'$" -and $migrateOnlyScript -match "(?m)^AFLDB_PF_LEDGER_AFTER='118'$") 'migration-only: the approved transition reaches the gate'
Assert-True ($migrateOnlyScript -match "(?m)^AFLDB_PF_STEPS='checkout install migrate health \(migration-only route, AFLDB-ISSUE-346; build and restart skipped\)'$") 'migration-only: the planned steps must name the route'
# The existing build and restart paths keep their steps and labels.
Assert-True ($defaultScript -match "(?m)^AFLDB_PF_STEPS='checkout install migrate build restart:auto health'$") 'default deploy: planned steps changed'
Assert-True ($respawnScript -match "(?m)^AFLDB_PF_STEPS='checkout install migrate build restart:respawn health'$") 'respawn deploy: planned steps changed'
Assert-True ($assessScript -match "(?m)^AFLDB_PF_STEPS='none \(assessment\)'$") 'assessment: planned steps must be none'
Assert-True ($pinnedScript.Contains('built BUILD_ID:') -and -not $pinnedScript.Contains('serving BUILD_ID (not rebuilt)')) 'a building deploy keeps its built BUILD_ID step'
$migrateOnlyPayload = & { . $syncScript -WhatIf @migrateOnlyArgs *> $null; $remotePayload }
Assert-True ((ConvertFrom-Payload $migrateOnlyPayload) -ceq $migrateOnlyScript -and $migrateOnlyPayload.Length -le 24000) 'migration-only payload transport or size'
# The gate's migration-name pattern mirrors tools/db/migration-safety.ts:37; drift in either trips here.
$safetySource = [IO.File]::ReadAllText((Join-Path $root 'tools\db\migration-safety.ts'))
$remoteSource = [IO.File]::ReadAllText((Join-Path $root 'deploy\sync-dev-remote.sh'))
Assert-True ($safetySource.Contains('const MIGRATION_NAME = /^(\d+)_([a-z0-9][a-z0-9_-]*)\.sql$/i;')) 'migration-safety.ts MIGRATION_NAME changed; update the gate mirror (AFLDB-ISSUE-346)'
Assert-True ($remoteSource.Contains("AFLDB_PF_MIGRATION_NAME_RE='^([0-9]+)_([A-Za-z0-9][A-Za-z0-9_-]*)\.sql$'")) 'the gate migration-name mirror changed (AFLDB-ISSUE-346)'

$tempScript = Join-Path ([IO.Path]::GetTempPath()) ("afldb-sync-dev-{0}.sh" -f [guid]::NewGuid())
try {
  foreach ($generated in @($defaultScript, $pinnedScript, $assessScript, $respawnScript, $migrateOnlyScript)) {
    [IO.File]::WriteAllText($tempScript, $generated, [Text.UTF8Encoding]::new($false))
    & $bash -p -n $tempScript
    Assert-True ($LASTEXITCODE -eq 0) 'generated remote Bash script failed syntax validation'
  }
} finally {
  Remove-Item -LiteralPath $tempScript -Force -ErrorAction SilentlyContinue
}

# AFLDB-ISSUE-339: the remote exit status survives powershell -File, a pipeline and Tee-Object.
$fakeBin = Join-Path ([IO.Path]::GetTempPath()) ("afldb-fake-ssh-{0}" -f [guid]::NewGuid())
New-Item -ItemType Directory -Path $fakeBin | Out-Null
try {
  # A .ps1 shim: cmd.exe's 8191-character limit cannot carry the real payload (ssh.exe takes 32767).
  Set-Content -LiteralPath (Join-Path $fakeBin 'ssh.ps1') -Value 'exit 40' -Encoding ascii
  $log = Join-Path $fakeBin 'deploy.log'
  $childExit = & {
    $ErrorActionPreference = 'Continue'
    $env:PATH = "$fakeBin;$env:PATH"
    powershell -NoProfile -ExecutionPolicy Bypass -File $syncScript -AcceptanceUrl not-a-url 2>$null | Tee-Object -FilePath $log | Out-Null
    $LASTEXITCODE
  }
  Assert-True ($childExit -eq 40) "a blocked gate (40) must survive powershell -File | Tee-Object, got $childExit"
  Assert-True ((Get-Content -LiteralPath $log -Raw) -match 'Phase:\s+execute') 'the logged pipeline must carry the run header'

  # AFLDB-ISSUE-339 R339-C: the real transport command, run by bash, with the payload damaged in
  # transit. Decoding fails before anything executes, so the shim runs it in an empty directory
  # and the status must be 47 through powershell -File | Tee-Object. (The full decoder matrix,
  # including a missing decoder and a complete payload, is tests/sync-dev-remote.test.sh.)
  $transportTemplate = ([IO.File]::ReadAllText((Join-Path $root 'deploy\sync-dev-transport.sh')) -replace "`r", '').Trim()
  Assert-True ($transportTemplate -notmatch '"') 'the transport command must hold no double quote (Windows PowerShell 5.1 does not escape them for ssh.exe)'
  Assert-True ($transportTemplate -notmatch 'bash -s') 'the transport must not stream a decoder pipeline into bash -s'
  $shim = @'
param([string] $Target, [string] $Command)
$mode = $env:AFLDB_FAKE_SSH_MODE
$m = [regex]::Match($Command, "'([A-Za-z0-9+/=]{40,})'")
if (-not $m.Success) { exit 90 }
$p = $m.Groups[1].Value
$bad = switch ($mode) {
  'truncate' {
    $cut = [int]($p.Length / 2)
    $p.Substring(0, ($cut - ($cut % 4)))
  }
  'invalid'  { '!!!not-base64!!!' }
  'corrupt'  { [Convert]::ToBase64String([byte[]](31, 139, 8, 0, 1, 2, 3, 4, 5, 6, 7, 8, 9)) }
}
$Command = $Command.Replace($p, $bad)
$work = Join-Path ([IO.Path]::GetTempPath()) ([guid]::NewGuid())
New-Item -ItemType Directory -Path $work | Out-Null
Push-Location $work
try {
  # Replay the received command without a second long Windows command-line handoff.
  $transportFile = Join-Path $work 'transport.sh'
  [IO.File]::WriteAllText($transportFile, $Command, [Text.UTF8Encoding]::new($false))
  $env:PATH = Split-Path -Parent $env:AFLDB_FAKE_BASH
  & $env:AFLDB_FAKE_BASH -p $transportFile
  $code = $LASTEXITCODE
} finally {
  Pop-Location
  Remove-Item -LiteralPath $work -Recurse -Force
}
exit $code
'@
  Set-Content -LiteralPath (Join-Path $fakeBin 'ssh.ps1') -Value $shim -Encoding ascii
  $stderrLog = Join-Path $fakeBin 'transport.stderr.log'
  foreach ($mode in @('truncate', 'invalid', 'corrupt')) {
    $childExit = & {
      $ErrorActionPreference = 'Continue'
      $env:PATH = "$fakeBin;$env:PATH"; $env:AFLDB_FAKE_SSH_MODE = $mode; $env:AFLDB_FAKE_BASH = $bash
      powershell -NoProfile -ExecutionPolicy Bypass -File $syncScript -AcceptanceUrl not-a-url 2>$stderrLog | Tee-Object -FilePath $log | Out-Null
      $LASTEXITCODE
    }
    $diagnostic = Get-Content -LiteralPath $stderrLog -Raw
    if ($childExit -ne 47 -or $diagnostic -notmatch 'could\s+not\s+be\s+decoded\s+completely') {
      throw "a $mode payload must report a decode failure and exit 47 through powershell -File | Tee-Object, got $childExit`nBash: $bash`nChild stderr:`n$diagnostic"
    }
  }
} finally {
  Remove-Item -LiteralPath $fakeBin -Recurse -Force -ErrorAction SilentlyContinue
}

# Generated payloads for the end-to-end cases in tests/sync-dev-remote.test.sh (SYNC_DEV_GENERATED_DIR).
if ($ExportDir) {
  New-Item -ItemType Directory -Force -Path $ExportDir | Out-Null
  $common = @{ ProjectDir = '/__PROJECT__'; RemoteRef = 'dev-v2-main'; ExpectedBranch = 'dev-v2-main'; ExpectedRevision = $pin; RestartMethod = 'respawn' }
  $exec = & { . $syncScript -WhatIf @common *> $null; $remoteScript }
  $assess = & { . $syncScript -WhatIf -Phase assess @common *> $null; $remoteScript }
  [IO.File]::WriteAllText((Join-Path $ExportDir 'gen-execute.sh'), $exec, [Text.UTF8Encoding]::new($false))
  [IO.File]::WriteAllText((Join-Path $ExportDir 'gen-assess.sh'), $assess, [Text.UTF8Encoding]::new($false))
  # AFLDB-ISSUE-346: the migration-only route (ledger values are substituted per case).
  $migrateOnly = & { . $syncScript -WhatIf @common -SkipBuild -SkipRestart -ExpectedLedgerBefore 2 -ExpectedLedgerAfter 3 *> $null; $remoteScript }
  [IO.File]::WriteAllText((Join-Path $ExportDir 'gen-migrate-only.sh'), $migrateOnly, [Text.UTF8Encoding]::new($false))
  Write-Output "exported gen-execute.sh, gen-assess.sh and gen-migrate-only.sh to $ExportDir"
}

Write-Output 'PASS: sync-dev PowerShell/static integration (AFLDB-ISSUE-339 gate ordering, refusals, transport, exit status; AFLDB-ISSUE-346 migration-only route)'
