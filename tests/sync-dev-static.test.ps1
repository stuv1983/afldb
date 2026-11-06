param([string] $ExportDir = '')

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

$root = Split-Path -Parent $PSScriptRoot
$syncScript = Join-Path $root 'deploy\sync-dev.ps1'

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
foreach ($mutation in @('git switch --no-guess', $ffLine, "`nnpm ci`n", "`nnpm run db:migrate`n", "`nnpm run build`n", 'kill "$AFLDB_OLD_PID"')) {
  Assert-True ($pinnedScript.IndexOf($mutation) -gt $gateAt) "the gate must precede: $mutation"
}
Assert-True ($pinnedScript.IndexOf('afldb_pf_revalidate_before_migration') -lt $pinnedScript.IndexOf("`nnpm run db:migrate`n")) 'migration must be revalidated first'
Assert-True ($pinnedScript.IndexOf("`nafldb_pf_migration_parity`n") -gt $pinnedScript.IndexOf("`nnpm run db:migrate`n")) 'post-migration parity must follow the migration'
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

$gitBash = if ($env:ProgramFiles) { Join-Path $env:ProgramFiles 'Git\usr\bin\bash.exe' } else { '' }
$bash = if ($gitBash -and (Test-Path -LiteralPath $gitBash)) {
  $gitBash
} else {
  (Get-Command bash -ErrorAction Stop).Source
}
$tempScript = Join-Path ([IO.Path]::GetTempPath()) ("afldb-sync-dev-{0}.sh" -f [guid]::NewGuid())
try {
  foreach ($generated in @($defaultScript, $pinnedScript, $assessScript, $respawnScript)) {
    [IO.File]::WriteAllText($tempScript, $generated, [Text.UTF8Encoding]::new($false))
    & $bash -n $tempScript
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
  Write-Output "exported gen-execute.sh and gen-assess.sh to $ExportDir"
}

Write-Output 'PASS: sync-dev PowerShell/static integration (AFLDB-ISSUE-339 gate ordering, refusals, transport, exit status)'
