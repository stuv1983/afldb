<#
.SYNOPSIS
    Phase G P4 -- the existing 1,495-row gate, re-run against this branch.

.DESCRIPTION
    The two pre-ISSUE-152 corpora merged, realistic then decline:

      afldb-ui-questions-1440-real-user-v3-20260822.csv      1,435 plan
      afldb-ui-questions-60-real-user-decline-v3-20260822.csv    60 decline
                                                             -----
                                                             1,495

    Neither file is modified by ISSUE-152 -- tests/nl-ui-corpus.test.ts asserts
    they are untouched and free of coaching, after-the-siren and first-kick-goal
    wording. section 9 gates Phase G on them being "unchanged and still green", so this
    run fails on ANY scored failure rather than comparing against a tolerance.

    Same pacing guarantees as P3: 2,200 ms at one worker, no inherited
    NL_UI_LIMIT, and a throttled load fails the run instead of being scored as
    an answer. At this size expect roughly an hour of wall clock (1,495 x ~2.5 s)
    against the config's two-hour global timeout.

    Requires the server from window 1:  .\tools\issue-152\phase-g-server.ps1

.PARAMETER Resume
    Continues an interrupted run: sets NL_UI_APPEND=1, so the observation files
    from the previous attempt are KEPT and merged (last write wins per row)
    instead of being cleared by the harness's global setup. Off by default --
    silently appending to an unknown earlier run is how a partial sweep comes to
    look complete.

    On its own, -Resume still re-runs every batch (Playwright has no memory of
    which finished); pair it with -Grep to re-run only what is missing, e.g.

      .\tools\issue-152\phase-g-regression.ps1 -Resume -Grep 'batch 01[1-5]/'

    Batch titles are `nl ui batch <n>/<of> (<firstId>-<lastId>)` -- 15 batches
    of 100 at this corpus size -- and both the run output and
    `playwright test --list` enumerate them. -Grep takes a regular expression.

.PARAMETER Grep
    Passed through to `playwright test --grep`. Only meaningful with -Resume;
    without it the observed count will fall short and the gates will fail, which
    is the correct outcome for a partial run presented as a whole one.

.PARAMETER BaseUrl
    Default http://127.0.0.1:3100.

.PARAMETER DelayMs
    Default 2200.

.PARAMETER Workers
    Default 1; anything else is refused.

.PARAMETER RunTag
    Default issue152-phaseg-p4.

.PARAMETER OutName
    Default `p4-regression`. Preserved at nl-ui-out-152-phaseg/<OutName>/.

.PARAMETER ClearInheritedLimit
    Clears an inherited NL_UI_LIMIT instead of refusing to start.

.EXAMPLE
    .\tools\issue-152\phase-g-regression.ps1
#>
[CmdletBinding()]
param(
    [string] $BaseUrl = 'http://127.0.0.1:3100',
    [int] $DelayMs = 2200,
    [int] $Workers = 1,
    [string] $RunTag = 'issue152-phaseg-p4',
    [string] $OutName = 'p4-regression',
    [switch] $Resume,
    [string] $Grep,
    [switch] $ClearInheritedLimit
)

$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'phase-g-common.ps1')

$repoRoot = Get-PhaseGRepoRoot
$paths = Get-PhaseGPaths -RepoRoot $repoRoot
Assert-SweepRunTag -RunTag $RunTag
Assert-NoInheritedSweepLimit -Clear:$ClearInheritedLimit
# Claim the evidence directory up front: preserved output is never overwritten,
# and a run that cannot be preserved should fail now, not after the full sweep.
Assert-PhaseGOutNameFree -Paths $paths -Name $OutName | Out-Null

if ($Workers -ne 1) {
    throw ("Phase G runs at one worker. Pacing is per worker, so $Workers workers would " +
           "multiply the request rate by $Workers and void the rate-limit margin (section 19.2).")
}
if ($Grep -and -not $Resume) {
    throw '-Grep selects a subset of batches, which only makes sense with -Resume. A filtered run without -Resume observes fewer rows than the gate requires.'
}

Write-Host ''
Write-Host 'AFLDB-ISSUE-152 Phase G -- P4 existing gate (1,495 rows)' -ForegroundColor Cyan
Write-Host '-------------------------------------------------------'

$corpus = Invoke-PhaseGCorpusBuild -RepoRoot $repoRoot -Set 'regression'
Write-Host ("  corpus             {0}" -f $corpus.path)
Write-Host ("                     {0} rows -- {1} plan, {2} decline" -f $corpus.rows, $corpus.plan, $corpus.decline)
Write-Host ("  base URL           {0}" -f $BaseUrl)
Write-Host ("  pacing             {0} ms at {1} worker  (~{2:N0} min expected)" -f `
    $DelayMs, $Workers, ($corpus.rows * ($DelayMs / 1000.0) / 60.0))
Write-Host ("  run tag            {0}" -f $RunTag)
if ($Resume) {
    Write-Host '  resume             NL_UI_APPEND=1 -- earlier observation files are KEPT and merged' -ForegroundColor Yellow
    if ($Grep) { Write-Host ("  batch filter       --grep '{0}'" -f $Grep) -ForegroundColor Yellow }
} else {
    Write-Host '  resume             off -- the harness clears previous observations before starting'
}
Write-Host ''

Assert-SweepPrerequisites -Paths $paths -BaseUrl $BaseUrl

$appendValue = $null
if ($Resume) { $appendValue = '1' }

$prior = Push-PhaseGEnv -Values ([ordered]@{
    AFLDB_E2E_BASE_URL      = $BaseUrl
    NL_UI_CORPUS            = $corpus.path
    NL_UI_LIMIT             = $null
    NL_UI_REQUEST_DELAY_MS  = "$DelayMs"
    NL_UI_WORKERS           = "$Workers"
    NL_UI_RUN_TAG           = $RunTag
    NL_UI_APPEND            = $appendValue
    NL_UI_FAST              = $null
})

try {
    $extra = @()
    if ($Grep) { $extra = @('--grep', $Grep) }
    $sweepExit = Invoke-NlUiSweep -RepoRoot $repoRoot -CorpusPath $corpus.path -ExtraPlaywrightArgs $extra
} finally {
    Pop-PhaseGEnv -Prior $prior
}

$report = Get-PhaseGSummary -OutDir $paths.LiveOut

$gates = @(Get-PhaseGTransportGates -Report $report -ExpectedObserved $corpus.rows)
$gates += New-PhaseGGate -Name 'corpus size' -Ok ([int]$corpus.rows -eq 1495) `
    -Detail ("{0} rows merged, expected 1495 (1435 + 60)" -f $corpus.rows)
$gates += New-PhaseGGate -Name 'semantic failures' -Ok ([int]$report.summary.fail -eq 0) `
    -Detail ("{0} scored failures -- the gate must stay completely green" -f $report.summary.fail)
$gates += New-PhaseGGate -Name 'unscored rows' -Ok ([int]$report.summary.unscored -eq 0) `
    -Detail ("{0} unscored" -f $report.summary.unscored)
$gates += New-PhaseGGate -Name 'filler disagreements' -Ok ([int]$report.summary.metamorphic -eq 0) `
    -Detail ("{0} metamorphic violations" -f $report.summary.metamorphic)

Write-PhaseGGates -Gates $gates

Write-Host ("Outcomes: answered {0}, unanswerable {1}, absent {2}, http_error {3}, page_error {4}" -f `
    $report.summary.byOutcome.answered, $report.summary.byOutcome.unanswerable, `
    $report.summary.byOutcome.absent, $report.summary.byOutcome.http_error, `
    $report.summary.byOutcome.page_error)
Write-Host ("Loads with a client-side error (reported, not failed): {0}" -f $report.summary.clientErrors)
Write-Host ''
if ($report.summary.fail -gt 0) { Write-PhaseGFailureDetail -Report $report -Limit 25 }

$preserved = Save-PhaseGRunOutput -Paths $paths -Name $OutName -Manifest ([ordered]@{
    issue          = 'AFLDB-ISSUE-152'
    phase          = 'G'
    kind           = 'P4 existing-gate regression (1,495)'
    startedUtc     = (Get-Date).ToUniversalTime().ToString('o')
    baseUrl        = $BaseUrl
    corpus         = $corpus.path
    corpusSources  = $corpus.sources
    corpusRows     = $corpus.rows
    requestDelayMs = $DelayMs
    workers        = $Workers
    runTag         = $RunTag
    resumed        = [bool]$Resume
    batchFilter    = $Grep
    playwrightExit = $sweepExit
    observed       = $report.observed
    summary        = $report.summary
})

Write-Host ("Preserved: {0}" -f $preserved)
Write-Host ''
Write-Host ("Telemetry check -- expect {0} rows:" -f $corpus.rows)
Write-Host ("  SELECT count(*) FROM nl_search_log WHERE run_tag = '{0}';" -f $RunTag)
Write-Host ''

if ($sweepExit -ne 0) {
    Write-Host "Playwright exited $sweepExit -- see the batch failures above." -ForegroundColor Yellow
    if (-not $Resume) {
        Write-Host 'To continue an interrupted run without re-observing what already completed:' -ForegroundColor Yellow
        Write-Host "  .\tools\issue-152\phase-g-regression.ps1 -Resume -Grep '<batch title fragment>'" -ForegroundColor Yellow
    }
}
Assert-PhaseGGates -Gates $gates -Context 'Phase G P4'

Write-Host 'Phase G P4 GREEN: the 1,435 + 60 gate is unchanged and still passing.' -ForegroundColor Green
