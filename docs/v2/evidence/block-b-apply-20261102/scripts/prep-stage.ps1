param([Parameter(Mandatory)][string]$S)
$ErrorActionPreference='Continue'
$sp='C:\Users\stuar\AppData\Local\Temp\claude\D--dev-afldb\421fd690-64dd-43a6-8ad8-cb331511dc62\scratchpad'
$W='/mnt/ssd/afldb-v2-blockb-prod-20261102T024241Z'; $OPS='/home/arm/ops/blockb-ea98a35f2061'
function Stop-Seq($m){ Write-Output "SEQUENCE STOPPED: $m"; exit 9 }
# S1/S2
$out = ssh afldb "bash /home/arm/bb2-precap.sh $S" 2>&1 | Out-String
$out -split "`n" | Where-Object { $_ -match 'PRE PASS|prod session|SNAPSHOTS|receipts=|votes2026|facts total|RESULT|CAPTURE EXIT|pg_dump exit|STOP|CAPTURE_DIR|ledger rows|archive ' } | ForEach-Object { $_.TrimEnd() }
if ($out -notmatch 'CAPTURE EXIT 0') { Stop-Seq 'precap/capture failed' }
if ($out -notmatch 'RESULT PASS stamp=(\d{8}T\d{6}Z) archive_sha256=([0-9a-f]{64})') { Stop-Seq 'no RESULT PASS line' }
$BKS=$Matches[1]; $SHA=$Matches[2]; Write-Output "BKS=$BKS SHA=$SHA"
# transfers
$d="D:\tmp\blockb-private\$S"; New-Item -ItemType Directory -Force $d | Out-Null
scp "afldb:/home/arm/backups/afldb/blockb-$S-$BKS/afldb_prod-$BKS.dump" "afldb:/home/arm/backups/afldb/blockb-$S-$BKS/afldb_prod-$BKS.provenance.json" "afldb:/home/arm/backups/afldb/blockb-$S-$BKS/SHA256SUMS" "$d\" 2>&1 | Out-Null
$h=(Get-FileHash "$d\afldb_prod-$BKS.dump" -Algorithm SHA256).Hash.ToLower(); Write-Output "workstation sha match: $($h -eq $SHA)"; if ($h -ne $SHA) { Stop-Seq 'hash mismatch at workstation' }
ssh streamanator "mkdir -p -m 700 $W/in/prod-$S" 2>&1 | Out-Null
scp "$d\afldb_prod-$BKS.dump" "$d\afldb_prod-$BKS.provenance.json" "$d\SHA256SUMS" "streamanator:$W/in/prod-$S/" 2>&1 | Out-Null
$sh = (ssh streamanator "chmod 600 $W/in/prod-$S/*; sha256sum $W/in/prod-$S/afldb_prod-$BKS.dump | cut -c1-64") | Out-String
Write-Output "streamanator sha match: $($sh.Trim() -eq $SHA)"; if ($sh.Trim() -ne $SHA) { Stop-Seq 'hash mismatch at streamanator' }
# S3
$rv = ssh streamanator "bash /home/arm/bb2-rv.sh $S $BKS $SHA" 2>&1 | Out-String
$rv -split "`n" | Where-Object { $_ -match 'RV EXIT|restore-verify-b.sh sha|pg_restore exit|restored_at|ledgerRows|TimeZone|Read-only Brownlow|BASELINE EXIT|cluster stopped|MainPID|STOP|ALTER|receipts' } | ForEach-Object { $_.TrimEnd() }
if ($rv -notmatch 'RV EXIT 0' -or $rv -notmatch 'BASELINE EXIT 0' -or $rv -notmatch 'cluster stopped; no listener') { Stop-Seq 'restore verification failed' }
if ($rv -notmatch 'AFTER alignment: [\s\S]*?Australia/Melbourne') { Stop-Seq 'alignment not proven' }
# return evidence
$di="$d\in"; New-Item -ItemType Directory -Force $di | Out-Null
scp "streamanator:$W/evidence-private/$S/restore-facts.json" "streamanator:$W/evidence-private/$S/baseline-restored.json" "streamanator:$W/evidence-private/$S/baseline-restored-utc-session.json" "$di\" 2>&1 | Out-Null
ssh afldb "mkdir -p -m 700 $OPS/$S-in" 2>&1 | Out-Null
scp "$di\restore-facts.json" "$di\baseline-restored.json" "afldb:$OPS/$S-in/" 2>&1 | Out-Null
$l1 = (Get-FileHash "$di\baseline-restored.json" -Algorithm SHA256).Hash.ToLower(); $l2=(Get-FileHash "$di\restore-facts.json" -Algorithm SHA256).Hash.ToLower()
$r = (ssh afldb "chmod 600 $OPS/$S-in/*; sha256sum $OPS/$S-in/baseline-restored.json $OPS/$S-in/restore-facts.json | cut -c1-64") | Out-String
if ($r -notmatch $l1 -or $r -notmatch $l2) { Stop-Seq 'evidence hash mismatch at production' }
Write-Output "evidence hashes equal at all hops: baseline-restored $l1 restore-facts $l2"
# S4-S6
$pl = ssh afldb "bash /home/arm/bb2-plan.sh $S $BKS" 2>&1 | Out-String
$pl -split "`n" | Where-Object { $_ -notmatch '^(REQUEST|PAYLOAD)' } | ForEach-Object { $_.TrimEnd() }
if ($pl -match 'SEQUENCE STOPPED' -or $pl -notmatch 'Review plan [0-9a-f]{64}') { Stop-Seq 'S4-S6 failed' }
Write-Output "PREP DONE $S BKS=$BKS"
