<#
.SYNOPSIS
    AFLDB-ISSUE-152 Phase D -- the 319-row CURRENT new-family rendered
    acceptance run.

.DESCRIPTION
    The Phase G P3 corpus (271 rows: coaching 99/25, after-the-siren 93/27,
    first-kick-goal 20/7) plus the two additive Phase D relationship corpora
    (48 rows, now 30 plan / 18 decline after four ISSUE-153 in-place
    reclassifications) -- 242 plan expectations and 77 decline expectations,
    319 rows, driven through a real browser against the local standalone build
    on afldb_test.

    This does NOT redefine Phase G. The accepted Phase G evidence is and
    stays "271 = 212 plan + 59 decline, green at P3-r2" (ISSUE-152 section
    21.3), and .\tools\issue-152\phase-g-new-corpus.ps1 still runs exactly
    that. The merged 319-row file appends: its first 271 rows are byte-for-
    byte the 271-row file, so every position-based statement in section 19.3
    survives. The Phase D rows are 272-319.

    Every guard from P3 is kept, for the reason P3 acquired it (section
    19.2 -- attempt 1 outran /search's rate limiter and scored 240 throttled
    loads as semantics):

      * 2,200 ms pacing at ONE worker, which admits at most 28 loads per
        60-second window against a limit of 30;
      * NL_UI_LIMIT refused rather than inherited, so a "full" run cannot
        quietly be 40 rows left over from a smoke test;
      * a throttled load records as page_error and fails the gates;
      * -OutName is claimed before the run and never overwritten.

    The rate limiter is NOT relaxed, disabled or worked around.

    No psql, and no database client of any kind: the tunnel is proved with a
    TCP probe and the server with an HTTP probe. The only telemetry claim
    this script makes is the SQL it PRINTS for the operator to run.

    Requires the tunnel and the server from windows 1 and 2:
        .\tools\issue-152\phase-g-tunnel.ps1
        .\tools\issue-152\phase-g-server.ps1

.PARAMETER BaseUrl
    Default http://127.0.0.1:3100.

.PARAMETER DelayMs
    Default 2200. Per-worker floor between navigations.

.PARAMETER Workers
    Default 1. Pacing is per worker; more workers void the guarantee.

.PARAMETER RunTag
    Default issue152-phased-p5. Unique to this run: it must not collide with
    issue152-phaseg-p3 or issue152-phaseg-p4, whose nl_search_log rows are
    preserved Phase G evidence. Client-side label; the server must have been
    started with AFLDB_NL_RUN_TAG=accept for it to reach
    nl_search_log.run_tag.

.PARAMETER OutName
    Default `p5-phase-d-current`. Preserved at nl-ui-out-152-phaseg/<OutName>/,
    claimed up front and never overwritten.

.PARAMETER ClearInheritedLimit
    Clears an inherited NL_UI_LIMIT instead of refusing to start.

.EXAMPLE
    .\tools\issue-152\phase-d-corpus.ps1
#>
[CmdletBinding()]
param(
    [string] $BaseUrl = 'http://127.0.0.1:3100',
    [int] $DelayMs = 2200,
    [int] $Workers = 1,
    [string] $RunTag = 'issue152-phased-p5',
    [string] $OutName = 'p5-phase-d-current',
    [switch] $ClearInheritedLimit
)

$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'phase-g-common.ps1')

# The pinned shape of the `current` set. Stated here as well as in
# build-phase-g-corpora.ts on purpose: the builder asserts what it merged,
# and this asserts that what it merged is the set this run claims to be.
#
# AFLDB-ISSUE-153 moved the SPLIT, never the size or the order: rows
# rel_dec_003/004/005/006 (FS1, FS2, FS3, FS6) are reclassified in place
# from decline to plan, so 238/81 became 242/77. The accepted P5-r2 run
# result "319 = 238 plan + 81 decline" (section 24.3) is historical and is
# preserved as run.
$EXPECTED_ROWS = 319
$EXPECTED_PLAN = 242
$EXPECTED_DECLINE = 77
$EXPECTED_BATCHES = 4   # ceil(319 / NL_UI_BATCH default 100)

$repoRoot = Get-PhaseGRepoRoot
$paths = Get-PhaseGPaths -RepoRoot $repoRoot
Assert-SweepRunTag -RunTag $RunTag
Assert-NoInheritedSweepLimit -Clear:$ClearInheritedLimit
# Claim the evidence directory up front: preserved output is never overwritten,
# and a run that cannot be preserved should fail now, not after 12 paced minutes.
Assert-PhaseGOutNameFree -Paths $paths -Name $OutName | Out-Null

if ($Workers -ne 1) {
    throw ("Phase D acceptance runs at one worker. Pacing is per worker, so $Workers workers would " +
           "multiply the request rate by $Workers and reproduce the throttled attempt 1 (section 19.2).")
}

if ($RunTag -eq 'issue152-phaseg-p3' -or $RunTag -eq 'issue152-phaseg-p4') {
    throw ("Run tag '$RunTag' belongs to preserved Phase G evidence. This run needs its own tag so " +
           "its nl_search_log rows can never be confused with P3's or P4's.")
}

Write-Host ''
Write-Host 'AFLDB-ISSUE-152 Phase D -- current new-family acceptance (319 rows)' -ForegroundColor Cyan
Write-Host '-------------------------------------------------------------------'

# Tunnel first. Without it every force-dynamic page answers 500 and the run
# reports transport failure as semantics -- and it costs a TCP connect, not a
# database client.
Assert-PhaseGTunnel -Port (Get-PhaseGTunnelPort -EnvFile $paths.EnvFile)

$corpus = Invoke-PhaseGCorpusBuild -RepoRoot $repoRoot -Set 'current'

# Static pins, before a single page is loaded. The builder already refuses a
# merge whose counts moved; this refuses a corpus that is not the one this
# script's gates, its evidence name and the issue record all describe.
if ([int]$corpus.rows -ne $EXPECTED_ROWS -or [int]$corpus.plan -ne $EXPECTED_PLAN `
        -or [int]$corpus.decline -ne $EXPECTED_DECLINE) {
    throw ("Corpus is {0} rows ({1} plan, {2} decline); this run is defined for {3} ({4}, {5}). " -f `
            $corpus.rows, $corpus.plan, $corpus.decline, $EXPECTED_ROWS, $EXPECTED_PLAN, $EXPECTED_DECLINE) +
           'Update PHASE_G_SETS.current, this script and the ISSUE-152 record together, not one of them.'
}

$batches = [int][Math]::Ceiling([double]$corpus.rows / 100.0)
if ($batches -ne $EXPECTED_BATCHES) {
    throw "Corpus of $($corpus.rows) rows slices into $batches Playwright batches, expected $EXPECTED_BATCHES."
}

Write-Host ("  corpus             {0}" -f $corpus.path)
Write-Host ("                     {0} rows -- {1} plan, {2} decline" -f $corpus.rows, $corpus.plan, $corpus.decline)
Write-Host ("                     = Phase G 271 (212/59) + Phase D 48 (30/18); rows 1-271 unchanged")
Write-Host ("  playwright batches {0}" -f $batches)
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
    NL_UI_BATCH             = $null   # the 100-row default $EXPECTED_BATCHES assumes
})

try {
    $sweepExit = Invoke-NlUiSweep -RepoRoot $repoRoot -CorpusPath $corpus.path
} finally {
    Pop-PhaseGEnv -Prior $prior
}

$report = Get-PhaseGSummary -OutDir $paths.LiveOut

$gates = @(Get-PhaseGTransportGates -Report $report -ExpectedObserved $corpus.rows)
$gates += New-PhaseGGate -Name 'plan expectations' -Ok ([int]$corpus.plan -eq $EXPECTED_PLAN) `
    -Detail ("{0} plan rows in the merged corpus, expected {1}" -f $corpus.plan, $EXPECTED_PLAN)
$gates += New-PhaseGGate -Name 'decline expectations' -Ok ([int]$corpus.decline -eq $EXPECTED_DECLINE) `
    -Detail ("{0} decline rows in the merged corpus, expected {1}" -f $corpus.decline, $EXPECTED_DECLINE)
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
    phase          = 'D'
    kind           = 'Phase D current new-family rendered acceptance (319 = Phase G 271 + Phase D 48)'
    startedUtc     = (Get-Date).ToUniversalTime().ToString('o')
    baseUrl        = $BaseUrl
    corpus         = $corpus.path
    corpusSources  = $corpus.sources
    corpusRows     = $corpus.rows
    planRows       = $corpus.plan
    declineRows    = $corpus.decline
    batches        = $batches
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
Assert-PhaseGGates -Gates $gates -Context 'Phase D acceptance'

Write-Host 'Phase D GREEN: 319/319 observed, no throttling, no crash, no semantic failure.' -ForegroundColor Green
Write-Host 'Phase G evidence is untouched: the pinned 271 and 1,495 runs stand as recorded.' -ForegroundColor Green
