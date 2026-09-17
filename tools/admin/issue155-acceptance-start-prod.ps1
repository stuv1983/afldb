<#
.SYNOPSIS
  AFLDB-ISSUE-155 SS27.27 K disposition -- build once, then start a
  PRODUCTION-MODE (`next start`, NODE_ENV=production) local server with
  every runtime DB connection pointed at afldb_test, on a separate port from
  the acceptance dev server (3100).

.DESCRIPTION
  afldb_test ONLY. Never touches afldb_dev or production, never edits .env.
  Identical DSN-rebuild discipline to issue155-acceptance-start-dev.ps1:
  DATABASE_URL, AFLDB_IMPORT_DATABASE_URL and AFLDB_AUTH_DATABASE_URL each
  keep their own scheme/user/password/query string; only host:port/database
  is replaced with AFLDB_TEST_DATABASE_URL's. Hard-refuses unless every
  rebuilt DSN names exactly afldb_test, or if the target port is already
  listening. AFLDB_ENV is deliberately left untouched (development) -- this
  stays a plain-HTTP loopback host, and a Secure cookie would lock the
  acceptance session out.

  Runs `npm run build` (NODE_ENV=production, real production React/Next
  bundle) and then `next start -p 3101` with the rebuilt DSNs set only on
  this process and its child -- restored on exit either way.

  Run as:
    powershell -ExecutionPolicy Bypass -File .\tools\admin\issue155-acceptance-start-prod.ps1
#>

param(
    [switch] $SkipBuild
)

$ErrorActionPreference = 'Stop'

$repoRoot = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
Set-Location $repoRoot

$TargetPort = 3101

# --- 1. Load the four DSNs from .env, robust to CRLF and quoting ---

$envPath = Join-Path $repoRoot '.env'
if (-not (Test-Path $envPath)) {
    Write-Error "Refusing: .env not found at $envPath"
    exit 1
}

$rawEnv = Get-Content -Path $envPath -Raw
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

# --- 3. Rebuild DATABASE_URL / AFLDB_IMPORT_DATABASE_URL / AFLDB_AUTH_DATABASE_URL ---

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

foreach ($item in @(
    @{ Name = 'DATABASE_URL'; Dsn = $newDatabaseUrl },
    @{ Name = 'AFLDB_IMPORT_DATABASE_URL'; Dsn = $newImportUrl },
    @{ Name = 'AFLDB_AUTH_DATABASE_URL'; Dsn = $newAuthUrl }
)) {
    $m = [regex]::Match($item.Dsn, $dsnPattern)
    $db = $m.Groups['db'].Value
    if ($db -ne 'afldb_test') {
        Write-Error "Refusing: rebuilt $($item.Name) does not name exactly afldb_test (got '$db')."
        exit 1
    }
}

Write-Host 'DATABASE_URL -> afldb_test' -ForegroundColor Green
Write-Host 'AFLDB_IMPORT_DATABASE_URL -> afldb_test' -ForegroundColor Green
Write-Host 'AFLDB_AUTH_DATABASE_URL -> afldb_test' -ForegroundColor Green

# --- 5. Refuse if the target port is already occupied ---

$portInUse = Get-NetTCPConnection -LocalPort $TargetPort -State Listen -ErrorAction SilentlyContinue
if ($portInUse) {
    Write-Error "Refusing: port $TargetPort is already listening. Stop the existing process first (or confirm it is the server you intend to use) before running this script."
    exit 1
}

Write-Host "Port check OK: $TargetPort is free." -ForegroundColor Green

# --- 6. Preserve every env var this script is about to change, build then
# start the server with them overridden, and restore them once it exits. ---

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
    $env:PORT = "$TargetPort"

    if ($SkipBuild) {
        Write-Host "`nSkipping build (-SkipBuild): reusing the existing .next output.`n" -ForegroundColor Yellow
    }
    else {
        Write-Host "`nBuilding (npm run build) from $repoRoot ...`n" -ForegroundColor Cyan
        npm run build
        if ($LASTEXITCODE -ne 0) {
            Write-Error "Refusing to start: npm run build failed with exit code $LASTEXITCODE."
            exit 1
        }
    }

    Write-Host "`nStarting the standalone production server on port $TargetPort ...`n" -ForegroundColor Cyan
    # This repo builds with `output: standalone` (see
    # tools/build/prepare-standalone.mjs). `next start` warns
    # ("does not work with output: standalone") and only serves correctly
    # by accident if .next/static happens to be in the expected place for
    # the non-standalone layout; the standalone server.js is the real
    # production entry point (it self-chdir()s into .next/standalone and
    # reads PORT from the environment) -- the same one deploy/afldb.service
    # runs.
    node .next/standalone/server.js
}
finally {
    $env:DATABASE_URL = $originalDatabaseUrl
    $env:AFLDB_IMPORT_DATABASE_URL = $originalImportUrl
    $env:AFLDB_AUTH_DATABASE_URL = $originalAuthUrl
    $env:AFLDB_TEST_DATABASE_URL = $originalTestUrl
    $env:PORT = $originalPort
}
