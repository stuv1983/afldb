# AFLDB-ISSUE-152 Phase G harness -- static/behavioural test for the evidence
# preservation contract and the verification script's exit status.
#
# Runs entirely in a temporary directory: no sweep, no server, no database, and
# nothing under nl-ui-out/ or nl-ui-out-152-phaseg/ is read or written.
#
#   powershell -NoProfile -ExecutionPolicy Bypass -File .\tests\phase-g-preserve-static.test.ps1

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

$root = Split-Path -Parent $PSScriptRoot
$phaseGDir = Join-Path $root 'tools\issue-152'
$common = Join-Path $phaseGDir 'phase-g-common.ps1'
$verify = Join-Path $phaseGDir 'phase-g-verify.ps1'

function Assert-True {
  param(
    [Parameter(Mandatory = $true)][bool] $Condition,
    [Parameter(Mandatory = $true)][string] $Message
  )
  if (-not $Condition) { throw $Message }
}

. $common

$sandbox = Join-Path ([IO.Path]::GetTempPath()) ("afldb-phaseg-preserve-{0}" -f [guid]::NewGuid())
$live = Join-Path $sandbox 'nl-ui-out'
$preserveRoot = Join-Path $sandbox 'nl-ui-out-152-phaseg'
$assertions = 0

try {
  New-Item -ItemType Directory -Path $live -Force | Out-Null
  New-Item -ItemType Directory -Path $preserveRoot -Force | Out-Null
  $paths = [ordered]@{ LiveOut = $live; PhaseGOut = $preserveRoot }

  # ---------------------------------------------- run 1: a free name is claimed
  [IO.File]::WriteAllText((Join-Path $live 'summary.json'), '{"run":"first"}')
  $first = Save-PhaseGRunOutput -Paths $paths -Name 'p3-new-family' -Manifest ([ordered]@{ run = 'first' })
  $assertions++; Assert-True (Test-Path $first) 'the first preserve did not create its target'
  $assertions++; Assert-True ((Get-Content (Join-Path $first 'summary.json') -Raw) -match '"first"') 'the first preserve did not copy the live output'
  $assertions++; Assert-True (Test-Path (Join-Path $first 'run-manifest.json')) 'the first preserve did not write run-manifest.json'

  $before = Get-ChildItem $first -Recurse | ForEach-Object { "$($_.Name)|$($_.Length)" } | Sort-Object

  # ------------------------------- run 2: the SAME name is refused, not deleted
  [IO.File]::WriteAllText((Join-Path $live 'summary.json'), '{"run":"second"}')
  [IO.File]::WriteAllText((Join-Path $live 'second-only.txt'), 'must never reach the preserved run')

  $threw = $false
  $message = ''
  try {
    Save-PhaseGRunOutput -Paths $paths -Name 'p3-new-family' -Manifest ([ordered]@{ run = 'second' }) | Out-Null
  } catch {
    $threw = $true
    $message = $_.Exception.Message
  }

  $assertions++; Assert-True $threw 'Save-PhaseGRunOutput overwrote an existing preserved run instead of refusing it'
  $assertions++; Assert-True ($message -match [regex]::Escape($first)) 'the refusal did not report the existing path'
  $assertions++; Assert-True ($message -match '-OutName') 'the refusal did not tell the operator to choose a different -OutName'
  $assertions++; Assert-True ($message -match 'p3-new-family-r2') 'the refusal did not suggest a concrete unique name'

  $after = Get-ChildItem $first -Recurse | ForEach-Object { "$($_.Name)|$($_.Length)" } | Sort-Object
  $assertions++; Assert-True (($before -join ',') -ceq ($after -join ',')) 'the refused run mutated the existing preserved directory'
  $assertions++; Assert-True ((Get-Content (Join-Path $first 'summary.json') -Raw) -match '"first"') 'the refused run overwrote preserved summary.json'
  $assertions++; Assert-True (-not (Test-Path (Join-Path $first 'second-only.txt'))) 'the refused run leaked new files into the preserved directory'
  $assertions++; Assert-True (Test-Path (Join-Path $live 'summary.json')) 'the refusal disturbed the live nl-ui-out working directory'

  # ------------------------------ run 3: an explicit unique name still succeeds
  $second = Save-PhaseGRunOutput -Paths $paths -Name 'p3-new-family-r2' -Manifest ([ordered]@{ run = 'second' })
  $assertions++; Assert-True ((Get-Content (Join-Path $second 'summary.json') -Raw) -match '"second"') 'the -r2 run did not preserve the second sweep'
  $assertions++; Assert-True ((Get-Content (Join-Path $first 'summary.json') -Raw) -match '"first"') 'the -r2 run disturbed the first preserved run'

  # ---------------------------------------------- the reusable pre-flight guard
  $free = Assert-PhaseGOutNameFree -Paths $paths -Name 'p4-regression'
  $assertions++; Assert-True ($free -ceq (Join-Path $preserveRoot 'p4-regression')) 'Assert-PhaseGOutNameFree did not return the target path for a free name'
  $assertions++; Assert-True (-not (Test-Path $free)) 'Assert-PhaseGOutNameFree created the directory it was only asked to check'

  $guardThrew = $false
  try { Assert-PhaseGOutNameFree -Paths $paths -Name 'p3-new-family' | Out-Null } catch { $guardThrew = $true }
  $assertions++; Assert-True $guardThrew 'Assert-PhaseGOutNameFree accepted a name that is already claimed'
} finally {
  Remove-Item -LiteralPath $sandbox -Recurse -Force -ErrorAction SilentlyContinue
}

# ------------------------------------------------------------- source contract
$commonText = [IO.File]::ReadAllText($common)
$assertions++; Assert-True ($commonText -notmatch 'if \(Test-Path \$target\) \{ Remove-Item') 'phase-g-common.ps1 still deletes an existing preserved target'
$assertions++; Assert-True ($commonText -match 'function Assert-PhaseGOutNameFree') 'the preservation guard is missing from phase-g-common.ps1'

foreach ($runner in @('phase-g-smoke.ps1', 'phase-g-new-corpus.ps1', 'phase-g-regression.ps1')) {
  $text = [IO.File]::ReadAllText((Join-Path $phaseGDir $runner))
  $assertions++
  Assert-True ($text -match 'Assert-PhaseGOutNameFree -Paths \$paths -Name \$OutName') "$runner does not claim its -OutName before sweeping"
}

# ------------------------------------------------------- verification exit code
$verifyText = [IO.File]::ReadAllText($verify)
$assertions++; Assert-True ($verifyText -match '\$global:LASTEXITCODE = 0') 'phase-g-verify.ps1 can still leak a child exit code from the negative probe'
$assertions++; Assert-True ($verifyText -match '(?m)^exit \$exitCode\s*$') 'phase-g-verify.ps1 does not set its own process exit code'
$assertions++; Assert-True ($verifyText -match '\$exitCode = 0') 'phase-g-verify.ps1 has no success path that exits 0'

# ------------------------------------------------------------- syntax validation
foreach ($file in @($common, $verify, (Join-Path $phaseGDir 'phase-g-smoke.ps1'),
                    (Join-Path $phaseGDir 'phase-g-new-corpus.ps1'),
                    (Join-Path $phaseGDir 'phase-g-regression.ps1'),
                    $PSCommandPath)) {
  $errors = $null
  [System.Management.Automation.Language.Parser]::ParseFile($file, [ref] $null, [ref] $errors) | Out-Null
  $assertions++
  Assert-True (@($errors).Count -eq 0) "$file failed PowerShell syntax validation: $(@($errors) -join '; ')"
}

Write-Output ("PASS: Phase G preservation and exit-code contract ({0} assertions)" -f $assertions)
