<#
.SYNOPSIS
    Runs an AFLDB-ISSUE-152 read-only evidence script against afldb_test, and
    refuses to run it against anything else.

.DESCRIPTION
    Phase D's first evidence pass was executed against afldb_dev by accident.
    `SELECT current_database()` said `afldb_dev`, so every D0.1-D4.4 number in
    it is observational only: afldb_dev lags the canonical rebuild, and no Phase
    D acceptance number may be taken from it. Nothing about that run announced
    the wrong target -- it simply produced plausible rows.

    So the target is no longer trusted, it is PROVEN. This window does the parts
    only PowerShell can do, and tools/issue-152/phase-d-evidence.ts does the
    execution over the repository's own PostgreSQL runtime (postgres.js, the
    dependency every tools/db script already uses). There is NO psql on this
    workstation and none is required.

      1. the DSN is DERIVED, not typed. The host, port, role and password come
         from .env's DATABASE_URL (or -EnvKey) and only the database segment is
         replaced, using the same ConvertTo-DatabaseDsn the Phase G runners use.
         A `-Database` that does not end in `_test` is refused outright.
      2. the SSH forward is a checked precondition (Assert-PhaseGTunnel). There
         is no PostgreSQL server on this workstation; without window 1 the run
         would fail with ECONNREFUSED rather than silently reaching anything.
      3. the DSN is handed over in the ENVIRONMENT, never in argv, so it is not
         visible in a process listing.
      4. the executor holds ONE reserved connection for the whole run, proves
         `current_database()` on it -- in JS and again with a server-side DO
         block that RAISEs -- before the first evidence statement, and checks
         the backend pid on every result and again at the end. A guard on a
         different connection would prove nothing about this one.
      5. the file is scanned for \c / \connect here as well, so an obvious
         reconnect is refused before Node is even started.

    READ ONLY, three ways: the session runs with
    default_transaction_read_only=on and that setting is read back and asserted;
    the script is a `BEGIN TRANSACTION READ ONLY ... ROLLBACK`; and any
    statement that would undo either is refused statically before a connection
    is opened. Nothing here writes to the database, to git, or to the repository
    outside its own gitignored transcript.

    Output is written UTF-8 without a BOM through New-PhaseGLogWriter, and the
    console decoder is switched to UTF-8 for the run. That is not cosmetic:
    `ISSUE-152-nl-evidence-output.txt` was captured with a plain `>` redirect,
    which in Windows PowerShell 5.1 produced UTF-16 and mangled the null display
    -- an evidence file that greps and diffs as mojibake.

    No credential is printed. Every DSN that reaches the console or the output
    file goes through Get-RedactedDsn, and the executor redacts anything
    DSN-shaped out of its error messages.

.PARAMETER SqlFile
    The evidence script, executed unmodified. Relative paths resolve against the
    repository root. Default: ISSUE-152-phase-d-evidence.sql.

.PARAMETER Database
    Target database. Must end in `_test` (CLAUDE.md 10: integration databases
    end in _test). Default afldb_test.

.PARAMETER EnvKey
    Which .env DSN supplies host/port/role/password. Default DATABASE_URL, i.e.
    afldb_app -- the role the Phase D builders will actually run as, so a
    missing read grant shows up here as evidence rather than hiding until the
    feature ships (app read has been fail-closed since migration 039). Switch to
    AFLDB_OWNER_DATABASE_URL only to distinguish "no rows" from "no grant".

.PARAMETER OutFile
    Transcript path. Default nl-ui-out-152-phaseg/evidence/<name>-<stamp>.txt,
    which .gitignore already excludes as `nl-ui-out-*/`. Never overwritten.

.PARAMETER DryRun
    Parse and check the script and stop. No connection is opened, so the tunnel
    is not required and no transcript is written.

.EXAMPLE
    .\tools\issue-152\phase-d-evidence.ps1
#>
[CmdletBinding()]
param(
    [string] $SqlFile = 'ISSUE-152-phase-d-evidence.sql',
    [string] $Database = 'afldb_test',
    [string] $EnvKey = 'DATABASE_URL',
    [string] $OutFile = '',
    [switch] $DryRun
)

$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'phase-g-common.ps1')

$repoRoot = Get-PhaseGRepoRoot
$paths = Get-PhaseGPaths -RepoRoot $repoRoot
$executor = Join-Path $PSScriptRoot 'phase-d-evidence.ts'

# ------------------------------------------------------------ target database
<#
  The whole point of this script. afldb_dev is a legitimate database that
  answers every query in the evidence pack with plausible rows, so "not dev"
  cannot be left to the operator's attention at 1am.
#>
if ($Database -notmatch '^[a-z0-9_]+_test$') {
    throw ("Refusing to run evidence against '$Database'. This runner targets an integration " +
           "database whose name ends in _test (afldb_test). The Phase D pass that hit afldb_dev " +
           "is exactly what it exists to prevent.")
}

# ----------------------------------------------------------------- evidence sql
$sqlPath = if ([System.IO.Path]::IsPathRooted($SqlFile)) { $SqlFile } else { Join-Path $repoRoot $SqlFile }
if (-not (Test-Path $sqlPath)) { throw "Evidence script not found at $sqlPath." }
$sqlPath = (Resolve-Path $sqlPath).Path
if (-not (Test-Path $executor)) { throw "Executor not found at $executor." }

<#
  A \connect inside the file would open a SECOND connection, after the guard has
  already passed on the first one -- the one hole the same-session guard cannot
  see. The executor refuses every unsupported meta-command anyway; this refuses
  the dangerous one before Node is even started.
#>
$reconnects = @(Select-String -Path $sqlPath -Pattern '^\s*\\(c|connect)\b')
if ($reconnects.Count -gt 0) {
    $where = ($reconnects | ForEach-Object { "line $($_.LineNumber): $($_.Line.Trim())" }) -join "`n    "
    throw ("$sqlPath contains a psql \connect, which would open a new connection AFTER the " +
           "current_database() guard has passed:`n    $where")
}

# --------------------------------------------------------------------- runtime
$npx = Get-Command npx -ErrorAction SilentlyContinue
if (-not $npx) {
    throw ("npx was not found on PATH. This runner uses the repository's own Node runtime " +
           "(tsx + postgres.js) precisely so that no PostgreSQL client needs installing. " +
           "Open this window from a shell whose PATH includes node.")
}
if (-not (Test-Path (Join-Path $repoRoot 'node_modules'))) {
    throw ("node_modules is missing from $repoRoot. A fresh worktree has none; junction or " +
           "install it before running evidence (see the worktree note in the ISSUE-152 runbook).")
}

# ------------------------------------------------------------------------ DSN
<#
  Read-DotEnvFile / ConvertTo-DatabaseDsn rather than Resolve-PhaseGDatabaseEnv:
  same derivation, same redaction, but that wrapper also demands
  AFLDB_AUTH_DATABASE_URL, which a read-only evidence run never opens.
#>
$envValues = Read-DotEnvFile -Path $paths.EnvFile
if (-not $envValues.Contains($EnvKey) -or [string]::IsNullOrWhiteSpace($envValues[$EnvKey])) {
    throw "$EnvKey is missing or empty in $($paths.EnvFile); the $Database DSN cannot be derived from it."
}

$dsn = ConvertTo-DatabaseDsn -Dsn $envValues[$EnvKey] -Database $Database
$dsnParts = Split-Dsn -Dsn $dsn
$dsnRedacted = Get-RedactedDsn -Dsn $dsn

# Belt and braces: the derivation is trivial, but a wrong database segment here
# would be a wrong target, and this check costs nothing.
if ($dsnParts.Database -ne $Database) {
    throw "Derived DSN names database '$($dsnParts.Database)', not '$Database'. Nothing was executed."
}

# --------------------------------------------------------------------- tunnel
$tunnelPort = Get-PhaseGTunnelPort -EnvFile $paths.EnvFile
if ($dsnParts.HostPort -match ':(\d+)$') { $tunnelPort = [int]$Matches[1] }
if (-not $DryRun) { Assert-PhaseGTunnel -Port $tunnelPort }

# ------------------------------------------------------------------ dry run
<#
  Static only: the executor parses the script, checks every meta-command and
  refuses a non-_test target, then stops without opening a connection. Safe with
  no tunnel and safe on any branch.
#>
if ($DryRun) {
    Push-Location $repoRoot
    try {
        $priorDryEnv = Push-PhaseGEnv -Values ([ordered]@{ AFLDB_EVIDENCE_DATABASE = $Database })
        try {
            & npx --no-install tsx $executor $sqlPath --dry-run
            $dryExit = $LASTEXITCODE
        } finally {
            Pop-PhaseGEnv -Prior $priorDryEnv
        }
    } finally {
        Pop-Location
    }
    Write-Host ''
    if ($dryExit -eq 0) {
        Write-Host 'Static check passed. No connection was opened and no transcript was written.' -ForegroundColor Green
    } else {
        Write-Host ("Static check failed (exit {0}). Nothing was executed." -f $dryExit) -ForegroundColor Red
    }
    Write-Host ''
    exit $dryExit
}

# ------------------------------------------------------------------ transcript
if ([string]::IsNullOrWhiteSpace($OutFile)) {
    $evidenceDir = Join-Path $paths.PhaseGOut 'evidence'
    if (-not (Test-Path $evidenceDir)) { New-Item -ItemType Directory -Path $evidenceDir -Force | Out-Null }
    $stem = [System.IO.Path]::GetFileNameWithoutExtension($sqlPath)
    $OutFile = Join-Path $evidenceDir ("{0}-{1}-{2}.txt" -f $stem, $Database, (Get-Date).ToString('yyyyMMdd-HHmmss'))
}
if (Test-Path $OutFile) {
    throw "Transcript already exists at $OutFile. Evidence is never overwritten; pass a different -OutFile."
}
$outParent = Split-Path -Parent $OutFile
if ($outParent -and -not (Test-Path $outParent)) {
    New-Item -ItemType Directory -Path $outParent -Force | Out-Null
}

# ------------------------------------------------------------------ the run
$header = @(
    '',
    'AFLDB-ISSUE-152 -- read-only evidence run',
    '-----------------------------------------',
    ("  repo root      {0}" -f $repoRoot),
    ("  evidence sql   {0}" -f $sqlPath),
    ("  executor       {0} (tsx + postgres.js; no psql on this workstation)" -f $executor),
    ("  target         {0}" -f $dsnRedacted),
    ("  derived from   {0} in {1}" -f $EnvKey, $paths.EnvFile),
    ("  tunnel         127.0.0.1:{0} reachable" -f $tunnelPort),
    ("  transcript     {0}" -f $OutFile),
    ("  started        {0}" -f (Get-Date).ToString('yyyy-MM-dd HH:mm:ss')),
    '',
    '  READ ONLY: default_transaction_read_only=on, asserted on the connection,',
    '  and the script is a READ ONLY transaction ending in ROLLBACK. No DDL, no',
    '  loader. The run aborts before any evidence statement unless',
    ("  current_database() is {0}, and every statement is checked against the" -f $Database),
    '  backend pid the guard ran on.',
    ''
)

$writer = New-PhaseGLogWriter -Path $OutFile
$priorEnv = $null
$priorConsoleEncoding = [Console]::OutputEncoding
$priorErrorAction = $ErrorActionPreference
$exit = 1

Push-Location $repoRoot
try {
    foreach ($line in $header) { Write-Host $line; $writer.WriteLine($line) }

    <#
      The DSN goes in the ENVIRONMENT, not in argv: a command line is visible to
      anything that can list processes, and this one carries a password.
      Push/Pop-PhaseGEnv scopes it to this run -- a .ps1 executes inside the
      caller's session, so an unscoped assignment would outlive the script.
    #>
    $priorEnv = Push-PhaseGEnv -Values ([ordered]@{
        AFLDB_EVIDENCE_DATABASE_URL = $dsn
        AFLDB_EVIDENCE_DATABASE     = $Database
    })

    [Console]::OutputEncoding = New-Object System.Text.UTF8Encoding($false)
    # 2>&1 on a native command raises NativeCommandError under 'Stop'; the exit
    # code is the signal that matters here, so stderr is merged as plain text.
    $ErrorActionPreference = 'Continue'

    & npx --no-install tsx $executor $sqlPath 2>&1 | ForEach-Object {
        $text = if ($_ -is [System.Management.Automation.ErrorRecord]) { $_.ToString() } else { [string]$_ }
        Write-Host $text
        $writer.WriteLine($text)
    }
    $exit = $LASTEXITCODE
} finally {
    $ErrorActionPreference = $priorErrorAction
    [Console]::OutputEncoding = $priorConsoleEncoding
    if ($priorEnv) { Pop-PhaseGEnv -Prior $priorEnv }
    if ($writer) { $writer.Flush(); $writer.Dispose() }
    Pop-Location
}

# ---------------------------------------------------------------------- report
Write-Host ''
if ($exit -eq 0) {
    Write-Host ("Evidence complete against {0}." -f $dsnRedacted) -ForegroundColor Green
    Write-Host ("  transcript  {0}" -f $OutFile)
    Write-Host '  The first table in the transcript is the proof of target: connected_database must'
    Write-Host ("  read {0}, and the closing line repeats the backend pid it ran on. Cite the" -f $Database)
    Write-Host '  transcript, not the console scrollback.'
} else {
    Write-Host ("The executor exited {0} -- the evidence is INCOMPLETE." -f $exit) -ForegroundColor Red
    Write-Host ("  transcript  {0}" -f $OutFile)
    Write-Host '  1   refused before any connection was opened (parse, meta-command, or target).'
    Write-Host '  2   the connection failed: check window 1 (.\tools\issue-152\phase-g-tunnel.ps1).'
    Write-Host ("  3   a SQL error, a guard refusal, or session drift. If it names the guard, this")
    Write-Host ("      connection was not {0} and no evidence statement ran." -f $Database)
    Write-Host '  If it says "permission denied for table", that is a real fail-closed grant result'
    Write-Host '  for afldb_app -- record it, then re-run with -EnvKey AFLDB_OWNER_DATABASE_URL to'
    Write-Host '  separate "no rows" from "no grant".'
}
Write-Host ''

exit $exit
