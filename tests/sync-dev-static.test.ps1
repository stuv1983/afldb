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

Write-Output 'PASS: sync-dev PowerShell/static integration (14 assertions)'
