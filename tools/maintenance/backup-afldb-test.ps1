<#
.SYNOPSIS
  AFLDB -- timestamped custom-format backup of afldb_test taken from the workstation.

.DESCRIPTION
  The workstation twin of tools/maintenance/backup.sh for the one database that script cannot
  be pointed at: backup.sh sources .env unconditionally after any exported override, and .env's
  AFLDB_BACKUP_DATABASE_URL names afldb_dev. This script mirrors its contract exactly --
  pg_dump --format=custom --compress=6 --no-owner, written under a .partial name and renamed
  only after pg_restore --list has read the archive back, password moved out of argv into
  PGPASSWORD for the child processes only -- and adds the SHA-256 the AFLDB-ISSUE-222 runbook
  records.

  DSN: AFLDB_TEST_DATABASE_URL from the environment, else from the repository .env. The
  database name in the DSN must be exactly afldb_test or the script refuses. The DSN is never
  printed. The archive is written OUTSIDE the repository (default D:\backups\afldb\issue-222).

  A backup is not proven until it has been restored; docs/backup-restore.md section 2 and the
  AFLDB-ISSUE-222 runbook section 11.19 describe the recovery-database restore.

.EXAMPLE
  powershell -ExecutionPolicy Bypass -File tools\maintenance\backup-afldb-test.ps1

.EXAMPLE
  powershell -ExecutionPolicy Bypass -File tools\maintenance\backup-afldb-test.ps1 -Dir D:\backups\afldb\issue-222
#>
param(
  [string]$Dir = 'D:\backups\afldb\issue-222',
  [string]$PgBin = 'C:\Program Files\PostgreSQL\16\bin',
  [string]$EnvFile = ''
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version 2

$repoRoot = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
if (-not $EnvFile) { $EnvFile = Join-Path $repoRoot '.env' }

# --- 1. DSN: environment first, then .env; never echoed -------------------------------------
$dsn = $env:AFLDB_TEST_DATABASE_URL
if (-not $dsn) {
  if (-not (Test-Path $EnvFile)) { throw "AFLDB_TEST_DATABASE_URL is not set and $EnvFile does not exist." }
  foreach ($line in (Get-Content $EnvFile)) {
    if ($line -match '^\s*AFLDB_TEST_DATABASE_URL\s*=\s*(.*)$') { $dsn = $Matches[1].Trim(); break }
  }
}
if (-not $dsn) { throw 'AFLDB_TEST_DATABASE_URL is not set (environment or .env).' }
$dsn = $dsn.Trim().Trim('"').Trim("'")

# --- 2. Refuse anything but afldb_test ----------------------------------------------------
$noQuery = ($dsn -split '\?', 2)[0]
$dbName = $noQuery.Substring($noQuery.LastIndexOf('/') + 1)
if ($dbName -ne 'afldb_test') { throw "Refusing: the DSN's database is not afldb_test (it is '$dbName')." }

# --- 3. Password out of argv (backup.sh's dsn_scrub) ---------------------------------------
$safeDsn = $dsn
if ($dsn -match '^([a-zA-Z][a-zA-Z0-9+.-]*://)([^:/@]+):([^@]*)@(.*)$') {
  $env:PGPASSWORD = [System.Uri]::UnescapeDataString($Matches[3])
  $safeDsn = "$($Matches[1])$($Matches[2])@$($Matches[4])"
}

$pgDump = Join-Path $PgBin 'pg_dump.exe'
$pgRestore = Join-Path $PgBin 'pg_restore.exe'
foreach ($exe in @($pgDump, $pgRestore)) {
  if (-not (Test-Path $exe)) { throw "Not found: $exe (pass -PgBin)." }
}

# --- 4. Write under a partial name, verify, rename -----------------------------------------
New-Item -ItemType Directory -Force -Path $Dir | Out-Null
$stamp = Get-Date -Format 'yyyyMMdd-HHmmss'
$target = Join-Path $Dir "afldb_test-$stamp.dump"
$partial = "$target.partial"

Write-Host "==> Backing up afldb_test to $target"
$started = Get-Date
try {
  & $pgDump "--dbname=$safeDsn" --format=custom --compress=6 --no-owner "--file=$partial"
  if ($LASTEXITCODE -ne 0) { throw "pg_dump failed (exit $LASTEXITCODE); keeping nothing." }

  $listing = & $pgRestore --list $partial
  if ($LASTEXITCODE -ne 0) { throw 'archive is not readable by pg_restore; keeping nothing.' }
  $objects = @($listing | Where-Object { $_ -match '^\d' }).Count
  if ($objects -lt 1) { throw 'archive lists no objects; keeping nothing.' }

  Move-Item -Path $partial -Destination $target
}
catch {
  if (Test-Path $partial) { Remove-Item -Force $partial }
  throw
}
finally {
  if (Test-Path Env:PGPASSWORD) { Remove-Item Env:PGPASSWORD }
}

$hash = (Get-FileHash -Algorithm SHA256 -Path $target).Hash.ToLower()
$size = [math]::Round((Get-Item $target).Length / 1MB, 1)
$elapsed = [int]((Get-Date) - $started).TotalSeconds

Write-Host "    wrote $size MB in ${elapsed}s"
Write-Host "    archive readable, $objects objects"
Write-Host "    sha256  $hash"
Write-Host "    file    $target"
Write-Host '    a dump is not proven until restored: see docs/backup-restore.md section 2'
