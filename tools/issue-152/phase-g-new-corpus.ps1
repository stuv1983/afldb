<#
.SYNOPSIS
    Phase G P3 -- the full 271-row ISSUE-152 new-family rendered acceptance run.

.DESCRIPTION
    The B + C + E corpora merged in phase order and driven through a real
    browser against the local standalone build: coaching (99 plan / 25 decline),
    after-the-siren (93 / 27) and first-kick-goal (20 / 7) -- 212 plan
    expectations and 59 decline expectations, 271 rows.

    The corpus was 270 until the P3-r1 close-out (section 20): fkg_005 named an
    unsuffixed "Gary Ablett", which the resolver's own contract makes ambiguous,
    so the plan row now names "Gary Ablett Jr" and the bare form was added to
    the decline corpus. Plan stayed 212; decline went 58 -> 59.

    This is the run that decides Phase G P3. Attempt 1 was INADMISSIBLE, not
    failed: it outran /search's rate limiter and scored 240 throttled loads as
    semantics (ISSUE-152 section 19.2). Every guard here exists because of that:

      * 2,200 ms pacing at ONE worker, which admits at most 28 loads per
        60-second window against a limit of 30;
      * NL_UI_LIMIT refused rather than inherited, so a "full" run cannot
        quietly be 40 rows left over from the smoke test;
      * a throttled load now records as page_error, and the gates fail on it.

    The rate limiter is NOT relaxed, disabled or worked around. The only honest
    way under a real production limit is to ask more slowly.

    Requires the server from window 1:  .\tools\issue-152\phase-g-server.ps1

.PARAMETER BaseUrl
    Default http://127.0.0.1:3100.

.PARAMETER DelayMs
    Default 2200. Per-worker floor between navigations.

.PARAMETER Workers
    Default 1. Pacing is per worker; more workers void the guarantee.

.PARAMETER RunTag
    Default issue152-phaseg-p3. Client-side label; the server must have been
    started with AFLDB_NL_RUN_TAG=accept for it to reach nl_search_log.run_tag.

.PARAMETER OutName
    Default `p3-new-family`. Preserved at nl-ui-out-152-phaseg/<OutName>/.

.PARAMETER ClearInheritedLimit
    Clears an inherited NL_UI_LIMIT instead of refusing to start.

.EXAMPLE
    .\tools\issue-152\phase-g-new-corpus.ps1
#>
[CmdletBinding()]
param(
    [string] $BaseUrl = 'http://127.0.0.1:3100',
    [int] $DelayMs = 2200,
    [int] $Workers = 1,
    [string] $RunTag = 'issue152-phaseg-p3',
    [string] $OutName = 'p3-new-family',
    [switch] $ClearInheritedLimit
)

$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'phase-g-common.ps1')

$repoRoot = Get-PhaseGRepoRoot
$paths = Get-PhaseGPaths -RepoRoot $repoRoot
Assert-SweepRunTag -RunTag $RunTag
Assert-NoInheritedSweepLimit -Clear:$ClearInheritedLimit
# Claim the evidence directory up front: preserved output is never overwritten,
# and a run that cannot be preserved should fail now, not after 10 paced minutes.
Assert-PhaseGOutNameFree -Paths $paths -Name $OutName | Out-Null

if ($Workers -ne 1) {
    throw ("Phase G P3 runs at one worker. Pacing is per worker, so $Workers workers would " +
           "multiply the request rate by $Workers and reproduce the throttled attempt 1 (section 19.2).")
}

Write-Host ''
Write-Host 'AFLDB-ISSUE-152 Phase G -- P3 new-family acceptance (271 rows)' -ForegroundColor Cyan
Write-Host '-------------------------------------------------------------'

$corpus = Invoke-PhaseGCorpusBuild -RepoRoot $repoRoot -Set 'new'
Write-Host ("  corpus             {0}" -f $corpus.path)
Write-Host ("                     {0} rows -- {1} plan, {2} decline" -f $corpus.rows, $corpus.plan, $corpus.decline)
Write-Host ("  base URL           {0}" -f $BaseUrl)
Write-Host ("  pacing             {0} ms at {1} worker  (~{2:N0} min expected)" -f `
    $DelayMs, $Workers, ($corpus.rows * ($DelayMs / 1000.0) / 60.0))
Write-Host ("  run tag            {0}" -f $RunTag)
Write-Host ''

Assert-SweepPrerequisites -Paths $paths -BaseUrl $BaseUrl

$prior = Push-PhaseGEnv -Values ([ordered]@{
    AFLDB_E2E_BASE_URL      = $BaseUrl
    NL_UI_CORPUS            = $corpus.path
    NL_UI_LIMIT             = $null   # the whole point: no truncation, ever
    NL_UI_REQUEST_DELAY_MS  = "$DelayMs"
    NL_UI_WORKERS           = "$Workers"
    NL_UI_RUN_TAG           = $RunTag
    NL_UI_APPEND            = $null
    NL_UI_FAST              = $null
})

try {
    $sweepExit = Invoke-NlUiSweep -RepoRoot $repoRoot -CorpusPath $corpus.path
} finally {
    Pop-PhaseGEnv -Prior $prior
}

$report = Get-PhaseGSummary -OutDir $paths.LiveOut

$gates = @(Get-PhaseGTransportGates -Report $report -ExpectedObserved $corpus.rows)
$gates += New-PhaseGGate -Name 'plan expectations' -Ok ([int]$corpus.plan -eq 212) `
    -Detail ("{0} plan rows in the merged corpus, expected 212" -f $corpus.plan)
$gates += New-PhaseGGate -Name 'decline expectations' -Ok ([int]$corpus.decline -eq 59) `
    -Detail ("{0} decline rows in the merged corpus, expected 59" -f $corpus.decline)
$gates += New-PhaseGGate -Name 'semantic failures' -Ok ([int]$report.summary.fail -eq 0) `
    -Detail ("{0} scored failures" -f $report.summary.fail)
# Every row here carries a plan or decline expectation -- there are no `unknown`
# edge probes in these corpora -- so an unscored row means an observation went
# missing, not that the corpus withheld judgement.
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
    kind           = 'P3 new-family rendered acceptance (271)'
    startedUtc     = (Get-Date).ToUniversalTime().ToString('o')
    baseUrl        = $BaseUrl
    corpus         = $corpus.path
    corpusSources  = $corpus.sources
    corpusRows     = $corpus.rows
    planRows       = $corpus.plan
    declineRows    = $corpus.decline
    requestDelayMs = $DelayMs
    workers        = $Workers
    runTag         = $RunTag
    playwrightExit = $sweepExit
    observed       = $report.observed
    summary        = $report.summary
})

Write-Host ("Preserved: {0}" -f $preserved)
Write-Host ''
Write-Host ("Telemetry check -- expect {0} rows, one per question that reached the NL pipeline:" -f $corpus.rows)
Write-Host ("  SELECT count(*) FROM nl_search_log WHERE run_tag = '{0}';" -f $RunTag)
Write-Host '  (a lower count means throttling or a rejected header, NOT declines)'
Write-Host ''

if ($sweepExit -ne 0) {
    Write-Host "Playwright exited $sweepExit -- see the batch failures above." -ForegroundColor Yellow
}
Assert-PhaseGGates -Gates $gates -Context 'Phase G P3'

Write-Host 'Phase G P3 GREEN: 271/271 observed, no throttling, no crash, no semantic failure.' -ForegroundColor Green
Write-Host 'Next: .\tools\issue-152\phase-g-regression.ps1  (P4, the 1,495-row existing gate)'
