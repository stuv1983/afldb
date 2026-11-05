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
  . $syncScript -WhatIf -RemoteRef 'dev/v2-main' -ExpectedRevision $pin *> $null
  $remoteScript
}
Assert-True ($defaultScript -match "(?m)^git pull --ff-only$") 'an unpinned deploy must still pull fast-forward only'
Assert-True ($pinnedScript -match "(?m)^afldb_checkout_pinned_revision '$pin'$") 'a pinned deploy must fast-forward to exactly the pin'
Assert-True ($pinnedScript -notmatch "(?m)^git pull") 'a pinned deploy must not git pull'
Assert-True ($pinnedScript.IndexOf("afldb_checkout_pinned_revision '$pin'") -lt $pinnedScript.IndexOf('npm ci')) 'the pin must be enforced before npm ci'
$badPinRefused = $false
try { & { . $syncScript -WhatIf -ExpectedRevision 'ABC123' *> $null } } catch { $badPinRefused = $true }
Assert-True $badPinRefused 'a short pin must be refused on the workstation'

Assert-True ($defaultScript -notmatch "`r") 'generated remote script must contain LF only'
Assert-True ($defaultScript -match [regex]::Escape('$(hostname)')) 'remote hostname expansion was lost'
Assert-True ($defaultScript -match [regex]::Escape('$(git rev-parse --short HEAD)')) 'remote Git expansion was lost'
Assert-True ($issue107Script -match [regex]::Escape('"$AFLDB_BUILT_BUILD_ID"')) 'ISSUE-107 build identity was expanded on the workstation'
Assert-True ($defaultScript -match 'afldb_classify_worktree 0') 'default dirty-tree classification is missing'
Assert-True ($defaultScript -match 'afldb_wait_for_readiness.+ 120 2 ') 'default readiness bounds are missing'
Assert-True ($customScript -match 'afldb_classify_worktree 1') 'AllowDirtyServer was not made explicit remotely'
Assert-True ($customScript -match 'afldb_wait_for_readiness.+ 90 3 ') 'custom readiness bounds were not propagated'
Assert-True (([regex]::Matches($defaultScript, 'sudo -n systemctl restart')).Count -eq 1) 'remote script must attempt sudo restart exactly once'
Assert-True (([regex]::Matches($defaultScript, 'kill "\$AFLDB_OLD_PID"')).Count -eq 1) 'Restart= fallback must terminate MainPID exactly once'
Assert-True ($defaultScript -notmatch 'git\s+(?:clean|reset)') 'remote script must not clean or reset the checkout'

$payload = [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes($defaultScript))
$decoded = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($payload))
Assert-True ($decoded -ceq $defaultScript) 'base64 transport changed the remote script'
Assert-True ($payload.Length -le 24000) 'generated SSH payload exceeds the enforced safety limit'
# The largest variant actually used (AFLDB-ISSUE-336 DEV procedure step 6): pinned + ISSUE-107 gate.
$pinnedGateScript = & {
  . $syncScript -WhatIf -RemoteRef 'dev/v2-main' -ExpectedRevision $pin -Issue107Gate *> $null
  $remoteScript
}
$pinnedGatePayload = [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes($pinnedGateScript))
Assert-True ($pinnedGatePayload.Length -le 24000) 'the pinned ISSUE-107-gated SSH payload exceeds the enforced safety limit'

# -RestartMethod respawn: one explicit restart method with no sudo invocation anywhere in the generated script.
$respawnScript = & {
  . $syncScript -WhatIf -RemoteRef 'dev/v2-main' -ExpectedRevision $pin -Issue107Gate -RestartMethod respawn *> $null
  $remoteScript
}
Assert-True ($respawnScript -notmatch 'sudo') 'a respawn deploy must not invoke or mention sudo'
Assert-True (([regex]::Matches($respawnScript, '(?m)^kill "\$AFLDB_OLD_PID"$')).Count -eq 1) 'a respawn deploy must terminate MainPID exactly once'
Assert-True ($respawnScript.IndexOf('kill "$AFLDB_OLD_PID"') -gt $respawnScript.IndexOf('npm run build')) 'the respawn must come after the build'
Assert-True ($respawnScript.IndexOf('kill "$AFLDB_OLD_PID"') -lt $respawnScript.IndexOf('afldb_wait_for_readiness ')) 'readiness must be polled after the respawn'
Assert-True ($respawnScript -match [regex]::Escape('"$AFLDB_BUILT_BUILD_ID"')) 'a respawn deploy must keep the ISSUE-107 build identity'
$respawnPayload = [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes($respawnScript))
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
  [IO.File]::WriteAllText($tempScript, $defaultScript, [Text.UTF8Encoding]::new($false))
  & $bash -n $tempScript
  Assert-True ($LASTEXITCODE -eq 0) 'generated remote Bash script failed syntax validation'
} finally {
  Remove-Item -LiteralPath $tempScript -Force -ErrorAction SilentlyContinue
}

Write-Output 'PASS: sync-dev PowerShell/static integration (27 assertions)'
