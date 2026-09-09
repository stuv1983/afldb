<#
.SYNOPSIS
    Phase G static verification -- no browser navigation, no server, no database.

.DESCRIPTION
    Everything that can be proven about the Phase G harness without asking a
    single question of a deployment:

      1. npx tsc --noEmit                      -- the branch type-checks
      2. npx vitest run tests/nl-ui-corpus.test.ts
                                               -- corpus reader, scoring rules,
                                                 and the shape assertions for
                                                 all six ISSUE-152 corpora
      3. the merged 271-row corpus builds from the tracked sources
      4. playwright --list against that corpus -- the spec module loads, the
                                                 corpus parses, and the batches
                                                 are enumerated
      5. NL_UI_REQUEST_DELAY_MS=2.2s is REJECTED, 2200 is ACCEPTED

    (5) is the guard that matters most. `Number('2.2s')` is NaN, and before the
    validation existed it would have silently disabled pacing and reproduced the
    throttled run of ISSUE-152 section 19.2 -- a sweep that looks like it is pacing,
    measures the rate limiter, and reports the result as semantics.

    Safe to run at any time, including while the window-1 server is running.

    Exit code is the script's own verdict: 0 only when every gate passed,
    non-zero otherwise. Step 5's child process is EXPECTED to fail, and its
    exit code is deliberately not allowed to become the script's.

.EXAMPLE
    .\tools\issue-152\phase-g-verify.ps1

.PARAMETER SkipTypecheck
    Skips step 1 only. The type-check is the slowest step and is unaffected by
    anything the sweep does.

.PARAMETER Set
    Which merged corpus to verify.

      new      (default) the pinned Phase G P3 corpus -- 271 = 212 + 59,
               3 Playwright batches. The accepted historical evidence
               (AFLDB-ISSUE-152 section 21.3); this is what the script has
               always checked and its expectations do not move.
      current  the Phase D acceptance corpus -- 319 = 238 + 81, 4 batches:
               the same 271 rows in the same order plus the 48 relationship
               rows. Verify this before .\tools\issue-152\phase-d-corpus.ps1.

    Both sets are pinned INDEPENDENTLY here, in build-phase-g-corpora.ts and
    in tests/nl-ui-corpus.test.ts, so a corpus edit has to be made three times
    on purpose before a sweep can quietly change size.
#>
[CmdletBinding()]
param(
    [switch] $SkipTypecheck,
    [ValidateSet('new', 'current')][string] $Set = 'new'
)

# The pinned shape of each set, restated here rather than read from the
# builder: a single source of truth cannot catch an edit made in that source.
$EXPECTED = @{
    new     = @{ Rows = 271; Plan = 212; Decline = 59; Batches = 3 }
    current = @{ Rows = 319; Plan = 238; Decline = 81; Batches = 4 }
}
$pins = $EXPECTED[$Set]

$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'phase-g-common.ps1')

$repoRoot = Get-PhaseGRepoRoot
$paths = Get-PhaseGPaths -RepoRoot $repoRoot
$results = @()

function Invoke-Captured {
    <# Runs a native command, returning its exit code and combined output.
       $ErrorActionPreference is relaxed for the call because Windows
       PowerShell turns a native command's stderr into error records, which
       would abort the script on a step whose FAILURE is the expected result. #>
    param([Parameter(Mandatory)][string[]] $Arguments)

    $previous = $ErrorActionPreference
    $ErrorActionPreference = 'Continue'
    try {
        $output = & npx @Arguments 2>&1 | Out-String
        $code = $LASTEXITCODE
        # The caller now owns this exit code. Clear the automatic variable so a
        # step whose FAILURE is the expected result -- step 5's "2.2s" probe --
        # cannot leak its child's non-zero code into the script's own exit
        # status, which is what $LASTEXITCODE would otherwise decide.
        $global:LASTEXITCODE = 0
        return [pscustomobject]@{ ExitCode = $code; Output = $output }
    } finally {
        $ErrorActionPreference = $previous
    }
}

Write-Host ''
Write-Host 'AFLDB-ISSUE-152 Phase G -- static verification (no server required)' -ForegroundColor Cyan
Write-Host '-------------------------------------------------------------------'
Write-Host ("  repo root  {0}" -f $repoRoot)
Write-Host ''

$exitCode = 1
try {

Push-Location $repoRoot
try {
    # ------------------------------------------------------------- 1. tsc
    if ($SkipTypecheck) {
        Write-Host '[1/5] npx tsc --noEmit -- SKIPPED' -ForegroundColor Yellow
    } else {
        Write-Host '[1/5] npx tsc --noEmit'
        & npx --no-install tsc --noEmit
        if ($LASTEXITCODE -ne 0) { throw "tsc --noEmit failed (exit $LASTEXITCODE)." }
        $results += New-PhaseGGate -Name 'tsc --noEmit' -Ok $true -Detail 'no type errors'
        Write-Host '      PASS' -ForegroundColor Green
    }

    # ---------------------------------------------------------- 2. vitest
    Write-Host '[2/5] npx vitest run tests/nl-ui-corpus.test.ts'
    & npx --no-install vitest run tests/nl-ui-corpus.test.ts
    if ($LASTEXITCODE -ne 0) { throw "vitest tests/nl-ui-corpus.test.ts failed (exit $LASTEXITCODE)." }
    $results += New-PhaseGGate -Name 'nl-ui-corpus.test.ts' -Ok $true -Detail 'corpus shape and scoring rules pass'
    Write-Host '      PASS' -ForegroundColor Green

    # ----------------------------------------------------------- 3. corpus
    Write-Host ("[3/5] building the merged {0}-row '{1}' corpus" -f $pins.Rows, $Set)
    $corpus = Invoke-PhaseGCorpusBuild -RepoRoot $repoRoot -Set $Set
    $ok = ([int]$corpus.rows -eq $pins.Rows -and [int]$corpus.plan -eq $pins.Plan `
           -and [int]$corpus.decline -eq $pins.Decline)
    $results += New-PhaseGGate -Name 'merged corpus' -Ok $ok `
        -Detail ("{0} rows, {1} plan, {2} decline" -f $corpus.rows, $corpus.plan, $corpus.decline)
    if (-not $ok) {
        throw ("Merged corpus is $($corpus.rows)/$($corpus.plan)/$($corpus.decline), " +
               "expected $($pins.Rows)/$($pins.Plan)/$($pins.Decline) for set '$Set'.")
    }
    Write-Host ("      PASS  {0}" -f $corpus.path) -ForegroundColor Green

    $listArguments = @(
        '--no-install', 'playwright', 'test',
        '--config', $paths.PwConfig,
        '--project', 'nl-stress',
        '--no-deps', '--list'
    )

    # --------------------------------------------- 4. playwright --list
    Write-Host '[4/5] playwright --list against the merged corpus (no navigation)'
    $prior = Push-PhaseGEnv -Values ([ordered]@{
        NL_UI_CORPUS           = $corpus.path
        NL_UI_LIMIT            = $null
        NL_UI_REQUEST_DELAY_MS = '2200'
        NL_UI_WORKERS          = '1'
    })
    try {
        $listed = Invoke-Captured -Arguments $listArguments
    } finally {
        Pop-PhaseGEnv -Prior $prior
    }

    if ($listed.ExitCode -ne 0) {
        Write-Host $listed.Output
        throw "playwright --list failed (exit $($listed.ExitCode))."
    }

    $expectedBatches = [Math]::Ceiling([double]$corpus.rows / 100.0)
    if ($expectedBatches -ne $pins.Batches) {
        throw "$($corpus.rows) rows slice into $expectedBatches batches, but set '$Set' is pinned at $($pins.Batches)."
    }
    $detail = "listed successfully"
    if ($listed.Output -match 'Total:\s+(\d+)\s+test') {
        $listedCount = [int]$Matches[1]
        $detail = "$listedCount batch test(s); $($corpus.rows) rows at the default batch size of 100 expects $expectedBatches"
        if ($listedCount -ne $expectedBatches) {
            throw "playwright listed $listedCount tests, expected $expectedBatches. Is NL_UI_BATCH set in this shell?"
        }
    }
    $results += New-PhaseGGate -Name 'playwright --list' -Ok $true -Detail $detail
    Write-Host ("      PASS  {0}" -f $detail) -ForegroundColor Green

    # ------------------------------------------------------- 5. pacing guard
    Write-Host '[5/5] pacing validation: "2.2s" must be rejected, 2200 accepted'
    $prior = Push-PhaseGEnv -Values ([ordered]@{
        NL_UI_CORPUS           = $corpus.path
        NL_UI_LIMIT            = $null
        NL_UI_REQUEST_DELAY_MS = '2.2s'
        NL_UI_WORKERS          = '1'
    })
    try {
        $bad = Invoke-Captured -Arguments $listArguments
    } finally {
        Pop-PhaseGEnv -Prior $prior
    }

    $rejected = ($bad.ExitCode -ne 0) -and
                ($bad.Output -match 'NL_UI_REQUEST_DELAY_MS must be a non-negative integer')
    $results += New-PhaseGGate -Name 'rejects "2.2s"' -Ok $rejected `
        -Detail ("exit {0}{1}" -f $bad.ExitCode, $(if ($rejected) { ', with the expected message' } else { ', WITHOUT the expected message' }))
    if (-not $rejected) {
        Write-Host $bad.Output
        throw 'NL_UI_REQUEST_DELAY_MS="2.2s" was NOT rejected. Unpaced sweeps would be scored as semantics (section 19.2).'
    }
    # 2200 was already proven acceptable by step 4, which listed under it.
    $results += New-PhaseGGate -Name 'accepts 2200' -Ok $true -Detail 'step 4 enumerated the sweep under 2200 ms'
    Write-Host '      PASS' -ForegroundColor Green
} finally {
    Pop-Location
}

Write-PhaseGGates -Gates $results
Assert-PhaseGGates -Gates $results -Context 'Phase G static verification'

Write-Host 'Static verification PASSED. Nothing was navigated, started or written to a database.' -ForegroundColor Green
if ($Set -eq 'current') {
    Write-Host 'Next: .\tools\issue-152\phase-d-corpus.ps1  (needs the window-1 tunnel and window-2 server)'
} else {
    Write-Host 'Next: .\tools\issue-152\phase-g-smoke.ps1  (needs the window-1 server)'
}
    $exitCode = 0
} catch {
    Write-Host ''
    Write-Host ("Static verification FAILED: {0}" -f $_.Exception.Message) -ForegroundColor Red
    $exitCode = 1
}

# Explicit, so the script's own verdict is the process exit code. Without this
# the exit status would be inherited from whichever native command ran last --
# which in a fully green run is the deliberately rejected "2.2s" probe.
exit $exitCode
