$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

# AFLDB-ISSUE-222 §7.4 fifth-pass regression: the first real attempt (evidence directory
# s74-20260919-issue222-final, preserved untouched) stopped safely -- before confirmation and
# before any import_draftguru.py invocation -- because Get-GateValue/Read-GatePlanValues passed
# the gate's own blank separator lines into a mandatory [string[]] parameter, which PowerShell
# rejects for any array containing an empty-string element. This test proves the fix without ever
# running the script's main body: it extracts ONLY the function definitions from the script's own
# AST and dot-sources just that text, so param()/the connection guards/backup/importer calls are
# never reached and no environment variable, database, or external process is required.

$root = Split-Path -Parent $PSScriptRoot
$scriptPath = Join-Path $root 'tools\rebuild\draftguru\s74-rollback-exercise.ps1'

function Assert-True {
  param(
    [Parameter(Mandatory = $true)][bool] $Condition,
    [Parameter(Mandatory = $true)][string] $Message
  )
  if (-not $Condition) { throw $Message }
}

function Assert-Throws {
  param(
    [Parameter(Mandatory = $true)][scriptblock] $ScriptBlock,
    [Parameter(Mandatory = $true)][string] $ExpectedMessagePattern,
    [Parameter(Mandatory = $true)][string] $Message
  )
  $threw = $false
  $actualMessage = $null
  try {
    & $ScriptBlock
  }
  catch {
    $threw = $true
    $actualMessage = $_.Exception.Message
  }
  Assert-True $threw "$Message (expected a throw; none occurred)"
  Assert-True ($actualMessage -match $ExpectedMessagePattern) `
    "$Message (thrown message did not match /$ExpectedMessagePattern/: '$actualMessage')"
}

# ---------------------------------------------------------------------------
# Extract ONLY the function definitions from the AST -- never the param() block or the top-level
# flow (connection guards, backup, importer calls, etc.), which this test must never execute.
# ---------------------------------------------------------------------------

$tokens = $null
$parseErrors = $null
$ast = [System.Management.Automation.Language.Parser]::ParseFile($scriptPath, [ref]$tokens, [ref]$parseErrors)
Assert-True ($parseErrors.Count -eq 0) "s74-rollback-exercise.ps1 has $($parseErrors.Count) parse error(s)"

$functionAsts = @($ast.FindAll({ $args[0] -is [System.Management.Automation.Language.FunctionDefinitionAst] }, $false))
Assert-True ($functionAsts.Count -gt 0) 'no function definitions were found in s74-rollback-exercise.ps1'
$requiredFunctions = 'Get-GateValue', 'Get-GateParseLines', 'Read-GatePlanValues'
foreach ($name in $requiredFunctions) {
  $matchCount = @($functionAsts | Where-Object { $_.Name -eq $name }).Count
  Assert-True ($matchCount -eq 1) "expected exactly one definition of $name, found $matchCount"
}

$functionsText = ($functionAsts | ForEach-Object { $_.Extent.Text }) -join "`n`n"
. ([scriptblock]::Create($functionsText))

Assert-True ($null -ne (Get-Command Read-GatePlanValues -ErrorAction SilentlyContinue)) 'Read-GatePlanValues was not loaded from the extracted function text'
Assert-True ($null -ne (Get-Command Get-GateValue -ErrorAction SilentlyContinue)) 'Get-GateValue was not loaded from the extracted function text'

# ---------------------------------------------------------------------------
# Realistic gate output -- the actual values reported from the first real §7.4 attempt (BASE
# plan, target=test), with blank AND whitespace-only lines interspersed exactly as
# bridge_import_gate.py really emits between report sections.
# ---------------------------------------------------------------------------

$EXPECTED_AFTER = '4f0a2cc567d03f2660132a1cdde66aa5e006c5e1e848a2dc5db724bd726b469d'
$EXPECTED_PICKS = 'ffa7fd60a02d8caee2d9fa22b9500725e9e12fc4ca8aba1d21e94675aa400c8d'
$EXPECTED_NEWLY = '3ff560472aa38b63a9ef28d57501e31da9cdb907cf44bcf304a42140a02471e3'
$EXPECTED_BASE = '71178a54376e911d1b374d534c7006ba3097ffd631635de405eaa424c878b4a4'
$EXPECTED_BEFORE = 193

function New-FakeGateLines {
  param([switch] $DropBaseline, [switch] $DuplicateAfter)
  $lines = New-Object System.Collections.Generic.List[string]
  [void]$lines.Add('AFLDB DraftGuru bridge import gate -- plan (read-only, afldb_test only) [target=test]')
  [void]$lines.Add('  snapshot : annual-html-20260826 (1 year pages, sha256 verified)')
  [void]$lines.Add('')
  [void]$lines.Add('1. plan: inputs')
  [void]$lines.Add('  PASS  1.1 child sha256 pinned')
  [void]$lines.Add('   ')                                    # whitespace-only
  [void]$lines.Add('2. read-only connection')
  [void]$lines.Add('  PASS  2.1 server confirms transaction_read_only=on')
  [void]$lines.Add("`t")                                     # tab-only
  [void]$lines.Add('3. target state')
  [void]$lines.Add("        import_batches_before: $EXPECTED_BEFORE (draftguru batches now; max id 1234)")
  [void]$lines.Add('')
  [void]$lines.Add('7. hashes and totals')
  if (-not $DropBaseline) {
    [void]$lines.Add("        baseline_sha256: $EXPECTED_BASE")
  }
  [void]$lines.Add("        after_state_sha256: $EXPECTED_AFTER")
  if ($DuplicateAfter) {
    [void]$lines.Add("        after_state_sha256: 0000000000000000000000000000000000000000000000000000000000000000")
  }
  [void]$lines.Add("        picks_after_sha256: $EXPECTED_PICKS")
  [void]$lines.Add("        newly_linked_sha256: $EXPECTED_NEWLY")
  [void]$lines.Add('')
  [void]$lines.Add('        changes (persons whose link state differs now vs after): 0')
  [void]$lines.Add('')
  [void]$lines.Add('summary_sha256: d4b1fbef305736ee8c0e70bd7cfc2fa60c48e0cbc3b6edd6af911ffd998782a9')
  [void]$lines.Add('PLAN: OK -- every check held; nothing was written')
  return , $lines.ToArray()
}

# ---------------------------------------------------------------------------
# 1. All four hashes and import_batches_before parse exactly, despite the blank/whitespace lines.
# ---------------------------------------------------------------------------

$goodResult = [pscustomobject]@{ Output = (New-FakeGateLines); ExitCode = 0 }
$values = Read-GatePlanValues -Result $goodResult
Assert-True ($values.after -eq $EXPECTED_AFTER) "after_state_sha256 mismatch: $($values.after)"
Assert-True ($values.picks -eq $EXPECTED_PICKS) "picks_after_sha256 mismatch: $($values.picks)"
Assert-True ($values.newly -eq $EXPECTED_NEWLY) "newly_linked_sha256 mismatch: $($values.newly)"
Assert-True ($values.base -eq $EXPECTED_BASE) "baseline_sha256 mismatch: $($values.base)"
Assert-True ($values.before -eq $EXPECTED_BEFORE) "import_batches_before mismatch: $($values.before)"
Assert-True ($values.before.GetType().Name -eq 'Int32') 'import_batches_before must parse as an int, not a string'

# ---------------------------------------------------------------------------
# 2. A missing required key fails closed with a clear message, not a binding crash.
# ---------------------------------------------------------------------------

$missingResult = [pscustomobject]@{ Output = (New-FakeGateLines -DropBaseline); ExitCode = 0 }
Assert-Throws -ScriptBlock { Read-GatePlanValues -Result $missingResult } `
  -ExpectedMessagePattern "could not find 'baseline_sha256'" `
  -Message 'a missing baseline_sha256 line must refuse clearly, not guess'

# ---------------------------------------------------------------------------
# 3. A duplicated required key fails closed rather than silently taking the first match.
# ---------------------------------------------------------------------------

$duplicateResult = [pscustomobject]@{ Output = (New-FakeGateLines -DuplicateAfter); ExitCode = 0 }
Assert-Throws -ScriptBlock { Read-GatePlanValues -Result $duplicateResult } `
  -ExpectedMessagePattern "'after_state_sha256' appears 2 times" `
  -Message 'a duplicated after_state_sha256 line must refuse, never silently pick one'

# ---------------------------------------------------------------------------
# 4. Output that is entirely blank/whitespace refuses clearly instead of crashing on binding.
# ---------------------------------------------------------------------------

$blankResult = [pscustomobject]@{ Output = @('', '   ', "`t", ''); ExitCode = 0 }
Assert-Throws -ScriptBlock { Read-GatePlanValues -Result $blankResult } `
  -ExpectedMessagePattern 'no non-blank output lines' `
  -Message 'entirely blank/whitespace gate output must refuse clearly'

# ---------------------------------------------------------------------------
# 5. The exact original PowerShell defect (a mandatory [string[]] parameter rejecting a blank
#    array element) is proven to reproduce on the UNFILTERED array, confirming the regression is
#    real -- i.e. Read-GatePlanValues's own fix (filtering before calling Get-GateValue) is load
#    bearing, not incidental.
# ---------------------------------------------------------------------------

Assert-Throws -ScriptBlock { Get-GateValue -Lines (New-FakeGateLines) -Key 'after_state_sha256' } `
  -ExpectedMessagePattern 'empty string' `
  -Message 'Get-GateValue must still reject an unfiltered array containing blank elements directly (proves the bug this fix addresses is real)'

Write-Output ('PASS: s74-rollback-exercise.ps1 gate-output parsing regression (5 checks: exact ' +
  'parse with blank/whitespace lines present, missing-key refusal, duplicate-key refusal, ' +
  'all-blank refusal, and the original unfiltered-array defect reproduced directly)')
