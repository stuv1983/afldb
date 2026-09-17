<#
.SYNOPSIS
    Phase G pacing smoke test -- 40 rows of the ISSUE-152 new-family corpus.

.DESCRIPTION
    Answers ONE question: does 2,200 ms of pacing at one Playwright worker keep
    a rendered sweep under /search's rate limit (30 requests / 60 s per IP per
    process, src/app/search/rate-limit.ts)? Attempt 1 of Phase G P3 ran at no
    pacing, spent the limiter's entire budget in 26 seconds, and reported 240
    throttled loads as semantics (ISSUE-152 section 19.2).

    THIS IS SMOKE EVIDENCE ONLY, NOT P3 ACCEPTANCE. It observes the first 40
    rows of the 271 -- all coaching-family plan rows -- so it can prove the
    transport is honest and cannot prove the new families answer correctly.
    P3 is phase-g-new-corpus.ps1, and only the full 271 counts.

    Requires the server from window 1:  .\tools\issue-152\phase-g-server.ps1

.PARAMETER BaseUrl
    Default http://127.0.0.1:3100 -- the standalone server started by
    phase-g-server.ps1.

.PARAMETER Limit
    Default 40. Rows observed, from the top of the merged new-family corpus.

.PARAMETER DelayMs
    Default 2200. Per-worker floor between navigations. At one worker this
    admits at most floor(60000/2200)+1 = 28 loads in any 60-second window.

.PARAMETER Workers
    Default 1. Pacing is PER WORKER, so N workers multiply the request rate by
    N and the guarantee is lost. Raising this is how attempt 1 failed.

.PARAMETER RunTag
    Default issue152-phaseg-smoke. Sent as the x-afldb-run-tag header and
    written to nl_search_log.run_tag -- but only if the SERVER was started with
    AFLDB_NL_RUN_TAG=accept, which phase-g-server.ps1 does by default.

.PARAMETER OutName
    Default `smoke`. Preserved at nl-ui-out-152-phaseg/<OutName>/.

.EXAMPLE
    .\tools\issue-152\phase-g-smoke.ps1
#>
[CmdletBinding()]
param(
    [string] $BaseUrl = 'http://127.0.0.1:3100',
    [int] $Limit = 40,
    [int] $DelayMs = 2200,
    [int] $Workers = 1,
    [string] $RunTag = 'issue152-phaseg-smoke',
    [string] $OutName = 'smoke'
)

$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'phase-g-common.ps1')

$repoRoot = Get-PhaseGRepoRoot
$paths = Get-PhaseGPaths -RepoRoot $repoRoot
Assert-SweepRunTag -RunTag $RunTag
# Claim the evidence directory up front: preserved output is never overwritten.
Assert-PhaseGOutNameFree -Paths $paths -Name $OutName | Out-Null

if ($Workers -ne 1 -and $DelayMs -gt 0) {
    Write-Host ("WARNING: pacing is per worker. At $Workers workers the aggregate request rate is " +
                "$Workers x the paced rate and the rate-limit guarantee is void.") -ForegroundColor Yellow
}

Write-Host ''
Write-Host 'AFLDB-ISSUE-152 Phase G -- pacing SMOKE TEST (not acceptance)' -ForegroundColor Cyan
Write-Host '------------------------------------------------------------'

$corpus = Invoke-PhaseGCorpusBuild -RepoRoot $repoRoot -Set 'new'
Write-Host ("  corpus             {0}" -f $corpus.path)
Write-Host ("                     {0} rows available ({1} plan / {2} decline); observing the first {3}" -f `
    $corpus.rows, $corpus.plan, $corpus.decline, $Limit)
Write-Host ("  base URL           {0}" -f $BaseUrl)
Write-Host ("  pacing             {0} ms at {1} worker(s)  (~{2:N0} s expected)" -f `
    $DelayMs, $Workers, ($Limit * ($DelayMs / 1000.0)))
Write-Host ("  run tag            {0}   (client header; server needs AFLDB_NL_RUN_TAG=accept)" -f $RunTag)
Write-Host ''

Assert-SweepPrerequisites -Paths $paths -BaseUrl $BaseUrl

$prior = Push-PhaseGEnv -Values ([ordered]@{
    AFLDB_E2E_BASE_URL      = $BaseUrl
    NL_UI_CORPUS            = $corpus.path
    NL_UI_LIMIT             = "$Limit"
    NL_UI_REQUEST_DELAY_MS  = "$DelayMs"
    NL_UI_WORKERS           = "$Workers"
    NL_UI_RUN_TAG           = $RunTag
    # A smoke run always starts clean: appending would merge these 40
    # observations into whatever the last run left behind.
    NL_UI_APPEND            = $null
    # JavaScript stays on: the console-error and hydration signal is part of
    # what a rendered sweep buys over the in-process harness.
    NL_UI_FAST              = $null
})

try {
    $sweepExit = Invoke-NlUiSweep -RepoRoot $repoRoot -CorpusPath $corpus.path
} finally {
    Pop-PhaseGEnv -Prior $prior
}

$report = Get-PhaseGSummary -OutDir $paths.LiveOut
$gates = Get-PhaseGTransportGates -Report $report -ExpectedObserved $Limit

Write-PhaseGGates -Gates $gates

# Reported, never gated. 40 rows of one family cannot settle semantics, and a
# smoke test that failed on them would invite "fixing" the corpus to go green.
Write-Host ("Semantics (INFORMATIONAL ONLY): pass {0}, fail {1}, unscored {2}" -f `
    $report.summary.pass, $report.summary.fail, $report.summary.unscored)
Write-Host ("Outcomes: answered {0}, unanswerable {1}, absent {2}, http_error {3}, page_error {4}" -f `
    $report.summary.byOutcome.answered, $report.summary.byOutcome.unanswerable, `
    $report.summary.byOutcome.absent, $report.summary.byOutcome.http_error, `
    $report.summary.byOutcome.page_error)
if ($report.summary.fail -gt 0) { Write-PhaseGFailureDetail -Report $report -Limit 10 }

$preserved = Save-PhaseGRunOutput -Paths $paths -Name $OutName -Manifest ([ordered]@{
    issue          = 'AFLDB-ISSUE-152'
    phase          = 'G'
    kind           = 'pacing smoke test (NOT P3 acceptance)'
    startedUtc     = (Get-Date).ToUniversalTime().ToString('o')
    baseUrl        = $BaseUrl
    corpus         = $corpus.path
    corpusRows     = $corpus.rows
    observedLimit  = $Limit
    requestDelayMs = $DelayMs
    workers        = $Workers
    runTag         = $RunTag
    playwrightExit = $sweepExit
    observed       = $report.observed
    summary        = $report.summary
})

Write-Host ("Preserved: {0}" -f $preserved)
Write-Host ''
Write-Host 'REMINDER: this is SMOKE EVIDENCE ONLY -- pacing and transport, not Phase G P3' -ForegroundColor Yellow
Write-Host '          acceptance. P3 is the full 271-row run:' -ForegroundColor Yellow
Write-Host '            .\tools\issue-152\phase-g-new-corpus.ps1' -ForegroundColor Yellow
Write-Host ''
Write-Host ("Telemetry check (server must have had AFLDB_NL_RUN_TAG=accept), expect {0} rows:" -f $Limit)
Write-Host ("  SELECT count(*) FROM nl_search_log WHERE run_tag = '{0}';" -f $RunTag)
Write-Host ''

if ($sweepExit -ne 0) {
    Write-Host "Playwright exited $sweepExit -- see the batch failures above." -ForegroundColor Yellow
}
Assert-PhaseGGates -Gates $gates -Context 'Phase G smoke test'

Write-Host 'Smoke test PASSED: the pacing held and every load rendered.' -ForegroundColor Green
