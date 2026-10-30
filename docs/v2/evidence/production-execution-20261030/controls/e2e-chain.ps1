# AFLDB V2 release preparation: the session's transfer and V2/V3 chain, end to end, without production
# (D-V2-PROD-EXEC-1 package §4.1). Runs after isolated-rehearsal.sh `rehearse` and rehearsal-controls.sh on
# the same root. rehearsal-controls.sh H10/H11 ran host-session.sh `backup postschema` and `readback` (library
# mode) on isolated clones, under this STAMP; this script treats that directory as "the host" and drives the
# unmodified transfer-session.ps1 and isolated-rehearsal.sh `after` exactly as the session does.
#   powershell -NoProfile -File e2e-chain.ps1 -Stamp <STAMP> -PinnedSha <PINNED.SHA256 sha256> -FrozenSha <frozen archive sha256>
param(
  [Parameter(Mandatory = $true)][ValidatePattern('^\d{8}T\d{6}Z$')][string]$Stamp,
  [Parameter(Mandatory = $true)][ValidatePattern('^[0-9a-f]{64}$')][string]$PinnedSha,
  [Parameter(Mandatory = $true)][ValidatePattern('^[0-9a-f]{64}$')][string]$FrozenSha,
  [string]$IsoHost = 'arm@10.0.40.100'
)
$ErrorActionPreference = 'Stop'
$t = Join-Path $PSScriptRoot '..\transfer-session.ps1'
$root = "/home/arm/afldb-v2-prodexec-$Stamp"
$prefix = "$root/controls/hs/backups/release-v2-"
function Run([string]$what) { if ($LASTEXITCODE -ne 0) { throw "E2E STOP: $what failed (exit $LASTEXITCODE)" } }
function T([string[]]$a) { & powershell -NoProfile -File $t @a; Run "transfer-session.ps1 $($a[1])" }

"== E1 the post-schema set host-session.sh wrote (H10)"
$line = ssh -o BatchMode=yes $IsoHost "grep '\.dump`$' $prefix$Stamp/postschema.SHA256SUMS"; Run 'reading postschema.SHA256SUMS'
if ($line -notmatch '^([0-9a-f]{64})  ') { throw 'E2E STOP: no dump line in postschema.SHA256SUMS' }
$sha = $Matches[1]
"== E2 Pull (as from the host), PushIso to xfer2"
T @('-Mode', 'Pull', '-Stamp', $Stamp, '-Label', 'postschema', '-ArchiveSha', $sha, '-ProdHost', $IsoHost, '-ProdDirPrefix', $prefix)
T @('-Mode', 'PushIso', '-Stamp', $Stamp, '-Label', 'postschema', '-ArchiveSha', $sha, '-PinnedSha', $PinnedSha)
"== E3 isolated-rehearsal.sh after (gate V3), in the foreground"
ssh -o BatchMode=yes $IsoHost "bash $root/pinned/isolated-rehearsal.sh after $Stamp $sha $PinnedSha > $root/after.out 2>&1; x=`$?; tail -4 $root/after.out; exit `$x"
$after = $LASTEXITCODE
$afterResult = ssh -o BatchMode=yes $IsoHost "cat $root/evidence/after.result"
"after exit=$after result=$afterResult (0 PASS, 3 PASS-PENDING-OWNER-GO; anything else stops)"
if (($after -ne 0 -and $after -ne 3) -or "$afterResult" -notmatch '^PASS') { throw "E2E STOP: after exited $after with result '$afterResult'" }
"== E4 PullIso, then GateV2 against the read-back host-session.sh wrote (H11): a clone of B against B must be IDENTICAL"
T @('-Mode', 'PullIso', '-Stamp', $Stamp, '-ArchiveSha', $FrozenSha)
$v2 = & powershell -NoProfile -File $t -Mode GateV2 -Stamp $Stamp -ProdHost $IsoHost -ProdDirPrefix $prefix; Run 'transfer-session.ps1 GateV2'
$v2
if (-not ($v2 | Where-Object { $_ -match '^TRANSFER PASS mode=GateV2 IDENTICAL ' })) { throw 'E2E STOP: GateV2 is not IDENTICAL for a clone of B' }
"E2E PASS stamp=$Stamp postschema_sha256=$sha"
