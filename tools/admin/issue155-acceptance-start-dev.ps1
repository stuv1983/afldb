<#
.SYNOPSIS
  AFLDB-ISSUE-155 SS27.27 -- start the dev server with every runtime DB
  connection pointed at afldb_test, for browser acceptance.

.DESCRIPTION
  afldb_test ONLY. Never touches afldb_dev or production, never edits .env.

  Loads DATABASE_URL, AFLDB_IMPORT_DATABASE_URL, AFLDB_AUTH_DATABASE_URL and
  AFLDB_TEST_DATABASE_URL from .env (read-only). AFLDB_TEST_DATABASE_URL is
  treated as authoritative for host, port and database name; each of the
  other three keeps its OWN scheme, user, password and any query string --
  only its host:port/database is replaced with AFLDB_TEST_DATABASE_URL's.
  This changes WHERE each role connects, never WHO it connects as.

  The three rebuilt DSNs are set as environment variables on THIS PowerShell
  process only (and therefore its child `npm run dev` process) -- .env is
  never written, and the parent shell's variables are restored once the
  server process exits.

  Hard-refuses before starting the server if any of the three rebuilt DSNs
  does not name exactly afldb_test, or if port 3100 is already listening
  (never silently starts a second server on top of one already running).

  Run as:
    powershell -ExecutionPolicy Bypass -File .\tools\admin\issue155-acceptance-start-dev.ps1
#>

$ErrorActionPreference = 'Stop'

$repoRoot = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
Set-Location $repoRoot

# --- 1. Load the four DSNs from .env, robust to CRLF and quoting ---

$envPath = Join-Path $repoRoot '.env'
if (-not (Test-Path $envPath)) {
    Write-Error "Refusing: .env not found at $envPath"
    exit 1
}

$rawEnv = Get-Content -Path $envPath -Raw
# PowerShell's automatic mandatory-parameter validation rejects a
# [string[]] argument if ANY element is an empty string ("Cannot bind
# argument ... because it is an empty string" /
# ParameterArgumentValidationErrorEmptyStringNotAllowed) -- not just if the
# whole array is empty. A real .env file is full of blank separator lines,
# so -split alone produces an array Get-EnvValue can never be called with.
# Filter blank lines out right here, once, before anything is bound to a
# Mandatory [string[]] parameter. Comment lines are left in (they are not
# blank) and are simply ignored by the key-match pattern below.
$envLines = ($rawEnv -split "`r?`n") | Where-Object { $_.Trim() -ne '' }

function Get-EnvValue {
    param(
        [Parameter(Mandatory = $true)][string[]] $Lines,
        [Parameter(Mandatory = $true)][string] $Key
    )
    $pattern = '^\s*' + [regex]::Escape($Key) + '\s*='
    $line = $Lines | Where-Object { $_ -match $pattern } | Select-Object -First 1
    if (-not $line) { return $null }
    $value = $line -replace $pattern, ''
    $value = $value.Trim()
    $value = $value -replace '^"(.*)"$', '$1'
    $value = $value -replace "^'(.*)'$", '$1'
    $value = $value.TrimEnd("`r").Trim()
    return $value
}

# --- 1b. Read-only self-test: proves the parser above handles blank lines,
# comments, quoting and a stray CR WITHOUT crashing, before it is ever
# trusted against the real .env. This is exactly the bug class that broke
# the previous version (a blank-line element bound to a Mandatory
# [string[]] parameter), reproduced here deliberately on fixed sample data
# with no dependency on this repository's own .env contents. ---

function Test-EnvValueParser {
    $sample = @(
        '',
        '# a comment line',
        '   ',
        'DATABASE_URL=postgresql://user:pass@localhost:5432/afldb_dev',
        'QUOTED_VALUE="hello world"',
        "SINGLE_QUOTED='hi there'",
        ('TRAILING_CR=value1' + "`r")
    ) | Where-Object { $_.Trim() -ne '' }

    $checks = @(
        @{ Key = 'DATABASE_URL'; Expected = 'postgresql://user:pass@localhost:5432/afldb_dev' },
        @{ Key = 'QUOTED_VALUE'; Expected = 'hello world' },
        @{ Key = 'SINGLE_QUOTED'; Expected = 'hi there' },
        @{ Key = 'TRAILING_CR'; Expected = 'value1' }
    )
    foreach ($check in $checks) {
        $actual = Get-EnvValue -Lines $sample -Key $check.Key
        if ($actual -ne $check.Expected) {
            throw "Self-test FAILED: $($check.Key) parsed as '$actual', expected '$($check.Expected)'."
        }
    }
    $missing = Get-EnvValue -Lines $sample -Key 'MISSING_KEY'
    if ($null -ne $missing) {
        throw "Self-test FAILED: a missing key did not return `$null (got '$missing')."
    }
    Write-Host 'Self-test OK: .env line parser handles blank/comment lines, quoting and CRLF correctly.' -ForegroundColor Green
}

Test-EnvValueParser

$rawDatabaseUrl = Get-EnvValue -Lines $envLines -Key 'DATABASE_URL'
$rawImportUrl = Get-EnvValue -Lines $envLines -Key 'AFLDB_IMPORT_DATABASE_URL'
$rawAuthUrl = Get-EnvValue -Lines $envLines -Key 'AFLDB_AUTH_DATABASE_URL'
$rawTestUrl = Get-EnvValue -Lines $envLines -Key 'AFLDB_TEST_DATABASE_URL'

foreach ($pair in @(
    @{ Name = 'DATABASE_URL'; Value = $rawDatabaseUrl },
    @{ Name = 'AFLDB_IMPORT_DATABASE_URL'; Value = $rawImportUrl },
    @{ Name = 'AFLDB_AUTH_DATABASE_URL'; Value = $rawAuthUrl },
    @{ Name = 'AFLDB_TEST_DATABASE_URL'; Value = $rawTestUrl }
)) {
    if (-not $pair.Value) {
        Write-Error "Refusing: $($pair.Name) not found in .env"
        exit 1
    }
}

# --- 2. Parse each DSN: scheme, user, password, host, port, database, query ---

$dsnPattern = '^(?<scheme>postgres(?:ql)?)://(?<user>[^:@/]+):(?<password>[^@/]*)@(?<host>[^:/]+):(?<port>\d+)/(?<db>[^?]+)(?<query>\?.*)?$'

function Parse-Dsn {
    param([Parameter(Mandatory = $true)][string] $Dsn, [Parameter(Mandatory = $true)][string] $Name)
    $m = [regex]::Match($Dsn, $dsnPattern)
    if (-not $m.Success) {
        Write-Error "Refusing: $Name is not a recognisable postgres(ql)://user:pass@host:port/db DSN."
        exit 1
    }
    return $m
}

$testMatch = Parse-Dsn -Dsn $rawTestUrl -Name 'AFLDB_TEST_DATABASE_URL'
$testHost = $testMatch.Groups['host'].Value
$testPort = $testMatch.Groups['port'].Value
$testDb = $testMatch.Groups['db'].Value

if ($testDb -ne 'afldb_test') {
    Write-Error "Refusing: AFLDB_TEST_DATABASE_URL itself does not name afldb_test (got '$testDb')."
    exit 1
}

# --- 3. Rebuild DATABASE_URL / AFLDB_IMPORT_DATABASE_URL / AFLDB_AUTH_DATABASE_URL:
# same scheme/user/password/query as each ORIGINAL DSN (preserving role identity),
# host/port/database taken from AFLDB_TEST_DATABASE_URL (afldb_test, authoritative). ---

function Rebuild-DsnForTest {
    param([Parameter(Mandatory = $true)][string] $OriginalDsn, [Parameter(Mandatory = $true)][string] $Name)
    $m = Parse-Dsn -Dsn $OriginalDsn -Name $Name
    $scheme = $m.Groups['scheme'].Value
    $user = $m.Groups['user'].Value
    $password = $m.Groups['password'].Value
    $query = $m.Groups['query'].Value
    return "${scheme}://${user}:${password}@${testHost}:${testPort}/${testDb}${query}"
}

$newDatabaseUrl = Rebuild-DsnForTest -OriginalDsn $rawDatabaseUrl -Name 'DATABASE_URL'
$newImportUrl = Rebuild-DsnForTest -OriginalDsn $rawImportUrl -Name 'AFLDB_IMPORT_DATABASE_URL'
$newAuthUrl = Rebuild-DsnForTest -OriginalDsn $rawAuthUrl -Name 'AFLDB_AUTH_DATABASE_URL'

# --- 4. Hard refuse unless every rebuilt DSN names exactly afldb_test ---

$toValidate = @(
    @{ Name = 'DATABASE_URL'; Dsn = $newDatabaseUrl },
    @{ Name = 'AFLDB_IMPORT_DATABASE_URL'; Dsn = $newImportUrl },
    @{ Name = 'AFLDB_AUTH_DATABASE_URL'; Dsn = $newAuthUrl }
)

foreach ($item in $toValidate) {
    $m = [regex]::Match($item.Dsn, $dsnPattern)
    $db = $m.Groups['db'].Value
    if ($db -ne 'afldb_test') {
        Write-Error "Refusing: rebuilt $($item.Name) does not name exactly afldb_test (got '$db')."
        exit 1
    }
}

# Safe validation only -- variable names and the resulting database name,
# never a password or a full DSN.
Write-Host 'DATABASE_URL -> afldb_test' -ForegroundColor Green
Write-Host 'AFLDB_IMPORT_DATABASE_URL -> afldb_test' -ForegroundColor Green
Write-Host 'AFLDB_AUTH_DATABASE_URL -> afldb_test' -ForegroundColor Green

# --- 5. Refuse if port 3100 is already occupied -- never silently launch a
# second server on top of one already running. ---

$portInUse = Get-NetTCPConnection -LocalPort 3100 -State Listen -ErrorAction SilentlyContinue
if ($portInUse) {
    Write-Error 'Refusing: port 3100 is already listening. Stop the existing process first (or confirm it is the server you intend to use) before running this script.'
    exit 1
}

Write-Host 'Port check OK: 3100 is free.' -ForegroundColor Green

# --- 6. Preserve every env var this script is about to change, start the
# server with them overridden, and restore them once it exits (Ctrl+C or
# otherwise). Nothing outside this process/its child is ever modified. ---

$originalDatabaseUrl = $env:DATABASE_URL
$originalImportUrl = $env:AFLDB_IMPORT_DATABASE_URL
$originalAuthUrl = $env:AFLDB_AUTH_DATABASE_URL
$originalTestUrl = $env:AFLDB_TEST_DATABASE_URL
$originalPort = $env:PORT

try {
    $env:DATABASE_URL = $newDatabaseUrl
    $env:AFLDB_IMPORT_DATABASE_URL = $newImportUrl
    $env:AFLDB_AUTH_DATABASE_URL = $newAuthUrl
    $env:AFLDB_TEST_DATABASE_URL = $rawTestUrl
    $env:PORT = '3100'

    Write-Host "`nStarting npm run dev on port 3100 from $repoRoot ...`n" -ForegroundColor Cyan
    npm run dev
}
finally {
    $env:DATABASE_URL = $originalDatabaseUrl
    $env:AFLDB_IMPORT_DATABASE_URL = $originalImportUrl
    $env:AFLDB_AUTH_DATABASE_URL = $originalAuthUrl
    $env:AFLDB_TEST_DATABASE_URL = $originalTestUrl
    $env:PORT = $originalPort
}
