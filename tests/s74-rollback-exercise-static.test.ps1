$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

$root = Split-Path -Parent $PSScriptRoot
$scriptPath = Join-Path $root 'tools\rebuild\draftguru\s74-rollback-exercise.ps1'

function Assert-True {
  param(
    [Parameter(Mandatory = $true)][bool] $Condition,
    [Parameter(Mandatory = $true)][string] $Message
  )
  if (-not $Condition) { throw $Message }
}

$tokens = $null
$parseErrors = $null
$ast = [System.Management.Automation.Language.Parser]::ParseFile($scriptPath, [ref]$tokens, [ref]$parseErrors)
Assert-True ($parseErrors.Count -eq 0) "s74-rollback-exercise.ps1 has $($parseErrors.Count) parse error(s): $($parseErrors -join '; ')"

$commandAsts = $ast.FindAll({ $args[0] -is [System.Management.Automation.Language.CommandAst] }, $true)

# 1. No bare `pwsh` command invocation anywhere in the script (AFLDB-ISSUE-222 §11.19.15/16:
#    pwsh is not guaranteed installed -- Windows PowerShell 5.1 has no pwsh.exe).
$barePwsh = @($commandAsts | Where-Object { $_.GetCommandName() -eq 'pwsh' })
Assert-True ($barePwsh.Count -eq 0) 'a bare "pwsh" command invocation was found; it must go through $PowerShellExe'

# 2. The backup is invoked through $PowerShellExe (a variable-headed command, never a literal
#    executable name), carrying -NoProfile -ExecutionPolicy Bypass -File $BackupScript.
$powerShellExeInvocations = @($commandAsts | Where-Object {
  $_.CommandElements.Count -gt 0 -and
  $_.CommandElements[0] -is [System.Management.Automation.Language.VariableExpressionAst] -and
  $_.CommandElements[0].VariablePath.UserPath -eq 'PowerShellExe'
})
Assert-True ($powerShellExeInvocations.Count -eq 1) `
  "expected exactly one invocation of `$PowerShellExe, found $($powerShellExeInvocations.Count)"
$backupInvocation = $powerShellExeInvocations[0]
$backupArgText = ($backupInvocation.CommandElements | ForEach-Object { $_.Extent.Text })
Assert-True ($backupArgText -contains '-NoProfile') '$PowerShellExe invocation is missing -NoProfile'
Assert-True ($backupArgText -contains '-ExecutionPolicy') '$PowerShellExe invocation is missing -ExecutionPolicy'
Assert-True ($backupArgText -contains 'Bypass') '$PowerShellExe invocation is missing Bypass'
Assert-True ($backupArgText -contains '-File') '$PowerShellExe invocation is missing -File'
Assert-True ($backupArgText -contains '$BackupScript') '$PowerShellExe invocation does not pass $BackupScript'

# 3. A $WhatIfPreference check exists, and it occurs BEFORE the backup invocation in source order
#    (an earlier version invoked the backup first, so -WhatIf still ran it for real when pwsh
#    happened to exist -- and crashed on this workstation when it did not).
$whatIfRefs = @($ast.FindAll({
    $args[0] -is [System.Management.Automation.Language.VariableExpressionAst] -and
    $args[0].VariablePath.UserPath -eq 'WhatIfPreference'
  }, $true))
Assert-True ($whatIfRefs.Count -ge 1) 'no reference to $WhatIfPreference was found'
$firstWhatIfOffset = ($whatIfRefs | Sort-Object { $_.Extent.StartOffset } | Select-Object -First 1).Extent.StartOffset
$backupOffset = $backupInvocation.Extent.StartOffset
Assert-True ($firstWhatIfOffset -lt $backupOffset) `
  '$WhatIfPreference must be checked BEFORE $PowerShellExe/backup-afldb-test.ps1 is invoked, not after'

# 4. The if-statement conditioned on $WhatIfPreference actually returns/exits, and its own body
#    never invokes the backup (i.e. the early exit is real, not merely present in the file).
$whatIfIfStatement = $ast.FindAll({ $args[0] -is [System.Management.Automation.Language.IfStatementAst] }, $true) |
  Where-Object {
    $_.Clauses[0].Item1.FindAll({
        $args[0] -is [System.Management.Automation.Language.VariableExpressionAst] -and
        $args[0].VariablePath.UserPath -eq 'WhatIfPreference'
      }, $true).Count -gt 0
  } | Select-Object -First 1
Assert-True ($null -ne $whatIfIfStatement) 'no if-statement conditioned on $WhatIfPreference was found'
$whatIfBodyText = $whatIfIfStatement.Clauses[0].Item2.Extent.Text
Assert-True ($whatIfBodyText -match '\breturn\b|\bexit\b') 'the $WhatIfPreference branch does not return or exit'
Assert-True ($whatIfBodyText -notmatch [regex]::Escape('$PowerShellExe')) `
  'the $WhatIfPreference branch itself invokes $PowerShellExe -- the early exit is not real'
Assert-True ($whatIfBodyText -notmatch [regex]::Escape('$ImporterPy')) `
  'the $WhatIfPreference branch references the importer -- the early exit is not real'

Write-Output 'PASS: s74-rollback-exercise.ps1 static regression (4 assertions: no bare pwsh, $PowerShellExe backup invocation, WhatIf-before-backup ordering, real early exit)'
