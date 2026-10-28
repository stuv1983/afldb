# AFLDB V2 current-production shadow: secure export and isolated-host transfer (D-V2-CURRENT-SHADOW-CAPTURE-1).
# Windows PowerShell 5.1, Windows OpenSSH. Reads from production with scp only; writes nothing there.
#   powershell -NoProfile -File transfer.ps1 -Stamp <STAMP> -ArchiveSha <archive_sha256 from "RESULT PASS" in capture.log> `
#     -RestoreSha <pinned shadow-restore.sh sha256> -ClassifierSha <pinned expected-deltas.mjs sha256>
param(
  [Parameter(Mandatory = $true)][ValidatePattern('^\d{8}T\d{6}Z$')][string]$Stamp,
  [Parameter(Mandatory = $true)][ValidatePattern('^[0-9a-f]{64}$')][string]$ArchiveSha,
  [Parameter(Mandatory = $true)][ValidatePattern('^[0-9a-f]{64}$')][string]$RestoreSha,
  [Parameter(Mandatory = $true)][ValidatePattern('^[0-9a-f]{64}$')][string]$ClassifierSha
)
$ErrorActionPreference = 'Stop'
foreach ($p in @(@("$PSScriptRoot\shadow-restore.sh", $RestoreSha), @("$PSScriptRoot\expected-deltas.mjs", $ClassifierSha))) {
  if ((Get-FileHash -Algorithm SHA256 -LiteralPath $p[0]).Hash.ToLower() -ne $p[1]) { throw "STOP: $($p[0]) differs from its pinned hash" }
}
$prodDir = "/home/arm/backups/afldb/current-shadow-$Stamp"
$local = "C:\Users\stuar\backups\afldb\current-shadow-$Stamp"
$dev = 'arm@10.0.40.100'
$root = "/home/arm/afldb-v2-currentshadow-$Stamp"
$dump = "afldb_prod-$Stamp.dump"
$sidecar = "afldb_prod-$Stamp.provenance.json"

function Check-Sums([string]$dir) {
  $lines = Get-Content -LiteralPath (Join-Path $dir 'SHA256SUMS')
  if ($lines.Count -ne 6) { throw "STOP: SHA256SUMS must list 6 files, found $($lines.Count)" }
  foreach ($l in $lines) {
    if ($l -notmatch '^([0-9a-f]{64})  (\S+)$') { throw "STOP: malformed SHA256SUMS line" }
    $h = (Get-FileHash -Algorithm SHA256 -LiteralPath (Join-Path $dir $Matches[2])).Hash.ToLower()
    if ($h -ne $Matches[1]) { throw "STOP: hash mismatch for $($Matches[2])" }
  }
  "local hashes OK ($($lines.Count) files)"
}

"== T1 protected local directory"
if (Test-Path -LiteralPath $local) { throw "STOP: $local already exists" }
New-Item -ItemType Directory -Path $local | Out-Null
icacls $local /inheritance:r /grant:r "$($env:USERNAME):(OI)(CI)F" 'SYSTEM:(OI)(CI)F' 'Administrators:(OI)(CI)F' | Out-Null
if ($LASTEXITCODE -ne 0) { throw 'STOP: icacls failed' }

"== T2 copy from production (read-only scp)"
scp -o BatchMode=yes -p "afldb:$prodDir/*" "$local\"
if ($LASTEXITCODE -ne 0) { throw 'STOP: scp from production failed; nothing else was done' }
Check-Sums $local
# Bind the copied archive to the hash production printed over the separate capture.log channel.
if (-not ((Get-Content -LiteralPath (Join-Path $local 'SHA256SUMS')) -contains "$ArchiveSha  $dump")) { throw 'STOP: archive hash differs from capture.log RESULT line' }

"== T3 new isolated root on streamanator"
ssh -o BatchMode=yes $dev "test ! -e $root && mkdir -m 700 $root $root/xfer && df -B1 --output=avail /home/arm | tail -1"
if ($LASTEXITCODE -ne 0) { throw "STOP: $root exists or could not be created" }
scp -o BatchMode=yes -p "$local\$dump" "$local\$sidecar" "$local\SHA256SUMS" "$local\archive.toc" "$local\ledger-before.tsv" "$local\ledger-after.tsv" "$local\pg-dump.stderr" "${dev}:$root/xfer/"
if ($LASTEXITCODE -ne 0) { throw 'STOP: scp to streamanator failed' }
ssh -o BatchMode=yes $dev "cd $root/xfer && chmod 600 ./* && sha256sum --check --strict SHA256SUMS"
if ($LASTEXITCODE -ne 0) { throw 'STOP: hash check on streamanator failed' }
# The two reviewed package scripts (LF, no BOM, as committed) go beside xfer/, not inside it.
scp -o BatchMode=yes "$PSScriptRoot\shadow-restore.sh" "$PSScriptRoot\expected-deltas.mjs" "${dev}:$root/"
if ($LASTEXITCODE -ne 0) { throw 'STOP: script copy failed' }
ssh -o BatchMode=yes $dev "cd $root && printf '%s  %s\n' $RestoreSha shadow-restore.sh $ClassifierSha expected-deltas.mjs | sha256sum --check --strict -"
if ($LASTEXITCODE -ne 0) { throw 'STOP: copied scripts differ from their pinned hashes on streamanator' }
"TRANSFER PASS stamp=$Stamp local=$local isolated_root=$root"
