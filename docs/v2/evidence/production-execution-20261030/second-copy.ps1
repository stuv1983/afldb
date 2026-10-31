# AFLDB V2 release: O-5 second copy over SSH (D-V2-PROD-EXEC-1, owner amendment 2026-10-31). Supplements
# transfer-session.ps1 (P-2, unchanged; its -SecondCopy is Windows-local and is not used): after -Mode Pull has
# verified the workstation set, this copies that set to the owner's second medium on streamanator and verifies
# every file there against the same <label>.SHA256SUMS.
#   -Mode Check   read-only: the destination filesystem is the expected one (UUID, type, mountpoint), the
#                 destination is an existing arm-owned mode-700 directory, the release child and label directory
#                 are in the state Copy needs, capacity covers the set plus -ReserveGiB
#   -Mode Copy    Check, then a NEW label directory, scp of every listed file, fsync, remote sha256sum --check and
#                 the exact file list; on success a <label>.VERIFIED record (created, never replaced) in the child
#   -Mode Verify  read-only: the same identity check, then re-verify the remote label directory (run it again
#                 later, after the page cache has turned over, for a check that reads the disk)
# Layout: <DestRoot>/release-v2-<STAMP>/<label>[-a<N>]/. Attempt 1 of frozen creates the child; a failed attempt is
# left exactly as it is (recorded, never deleted or reused) and -Attempt 2 or 3 writes a new <label>-a<N>/ beside
# it. postschema requires frozen.VERIFIED in the child. Never overwrites or deletes: every directory written into is
# created by this call with mkdir (no -p), and DestRoot and its parents are never created. No credentials are used
# or printed (the BatchMode key only).
# Example: powershell -NoProfile -File second-copy.ps1 -Mode Copy -Stamp <STAMP> -Label frozen -ArchiveSha <RESULT sha>
param(
  [Parameter(Mandatory = $true)][ValidateSet('Check', 'Copy', 'Verify')][string]$Mode,
  [Parameter(Mandatory = $true)][ValidatePattern('^[0-9]{8}T[0-9]{6}Z\z')][string]$Stamp,
  [ValidateSet('frozen', 'postschema')][string]$Label = 'frozen',
  [ValidateRange(1, 3)][int]$Attempt = 1,
  [ValidatePattern('^[0-9a-f]{64}\z')][string]$ArchiveSha,
  [ValidatePattern('^/[A-Za-z0-9._/()-]+\z')][string]$DestRoot = '/mnt/backup/backup(2026-10-31)',
  [ValidatePattern('^/[A-Za-z0-9._/-]*\z')][string]$MountPoint = '/mnt/backup',
  [ValidatePattern('^[0-9a-f-]{36}\z')][string]$ExpectUuid = '4bc4fb8d-b3eb-466a-b5f4-42806ec83d3c',
  [ValidatePattern('^[a-z0-9]+\z')][string]$ExpectFstype = 'ext4',
  [ValidateRange(1, 1024)][int]$ReserveGiB = 2,
  [ValidatePattern('^[a-z0-9_]+@[0-9.]+\z')][string]$IsoHost = 'arm@10.0.40.100',
  [string]$LocalRoot = 'C:\Users\stuar\backups\afldb'
)
$ErrorActionPreference = 'Stop'
if ("$DestRoot/" -match '/\.\.?/' -or $DestRoot.EndsWith('/')) { throw 'STOP: -DestRoot must be a normalised absolute path' }
if (-not $ArchiveSha) { throw "STOP: -ArchiveSha is required for -Mode $Mode" }
$local = Join-Path $LocalRoot "release-v2-$Stamp"
$sums = "$Label.SHA256SUMS"
$ldir = if ($Attempt -eq 1) { $Label } else { "$Label-a$Attempt" }
$remoteL = "$DestRoot/release-v2-$Stamp/$ldir"

function Sha([string]$p) { (Get-FileHash -Algorithm SHA256 -LiteralPath $p).Hash.ToLower() }
function WriteLf([string]$path, [string[]]$lines) { [IO.File]::WriteAllText($path, (($lines -join "`n") + "`n"), (New-Object Text.UTF8Encoding($false))) }
# Runs a bash body on the isolated host (streamed over stdin, so the path never passes through a remote command
# line); the values it needs are validated above and passed as single-quoted assignments. Sets $script:rc.
function Remote([string]$body) {
  $pre = "set -u`nexport LC_ALL=C`nfail() { echo `"STOP: `$*`"; exit 1; }`nD='$DestRoot'; M='$MountPoint'; C='$DestRoot/release-v2-$Stamp'; L='$remoteL'; LABEL='$Label'; ATTEMPT=$Attempt"
  $f = Join-Path $env:TEMP "afldb-o5-$([guid]::NewGuid().ToString('N')).sh"
  WriteLf $f @($pre, $body)
  try { $out = cmd /c "ssh -o BatchMode=yes $IsoHost bash -s < `"$f`" 2>&1"; $script:rc = $LASTEXITCODE }
  finally { Remove-Item -LiteralPath $f -Force }
  $out | ForEach-Object { "  remote: $_" }
}

# The local set: the workstation copy -Mode Pull verified, re-verified here before anything is sent. The SUMS file
# is read once: its hash and its entries come from the same bytes.
$sumsPath = Join-Path $local $sums
if (-not (Test-Path -LiteralPath $sumsPath)) { throw "STOP: $sumsPath is missing (run transfer-session.ps1 -Mode Pull first)" }
$raw = [IO.File]::ReadAllBytes($sumsPath)
$sumsSha = (-join ([Security.Cryptography.SHA256]::Create().ComputeHash($raw) | ForEach-Object { $_.ToString('x2') }))
$set = @()
foreach ($l in ([Text.Encoding]::UTF8.GetString($raw) -split "`n")) {
  if ($l -eq '') { continue }
  if ($l -notmatch '^([0-9a-f]{64})  ([A-Za-z0-9._-]+)\z') { throw "STOP: malformed line in $sumsPath" }
  $set += , @($Matches[1], $Matches[2])
}
if ($set.Count -lt 2) { throw "STOP: $sumsPath lists fewer than 2 files" }
$bytes = [int64]$raw.Length
foreach ($e in $set) {
  $p = Join-Path $local $e[1]
  if ((Sha $p) -ne $e[0]) { throw "STOP: local hash mismatch for $($e[1])" }
  $bytes += (Get-Item -LiteralPath $p).Length
}
$dump = @($set | Where-Object { $_[1] -match '\.dump$' })
if ($dump.Count -ne 1 -or $dump[0][0] -ne $ArchiveSha) { throw 'STOP: the set must hold exactly one dump with hash -ArchiveSha' }
"== O1 local $Label set re-verified ($($set.Count) files + $sums $sumsSha, $bytes bytes, archive $ArchiveSha)"

# The medium: the expected filesystem, by UUID and type, mounted at -MountPoint, and DestRoot on it.
$identity = @"
[ -d "`$D" ] && [ ! -L "`$D" ] || fail "`$D is not an existing directory (it is never created here)"
mountpoint -q "`$M" || fail "`$M is not a mountpoint"
[ "`$(findmnt -n -o TARGET -T "`$D")" = "`$M" ] || fail "`$D is not on the `$M filesystem"
[ "`$(findmnt -n -o UUID -T "`$D")" = '$ExpectUuid' ] || fail "filesystem UUID is `$(findmnt -n -o UUID -T "`$D"), expected $ExpectUuid"
[ "`$(findmnt -n -o FSTYPE -T "`$D")" = '$ExpectFstype' ] || fail "filesystem type is not $ExpectFstype"
[ "`$(stat -c %u:%a "`$D")" = "`$(id -u):700" ] || fail "`$D is not owned by `$(id -un) with mode 700 (`$(stat -c %U:%a "`$D"))"
echo "DEST `$D mount=`$M source=`$(findmnt -n -o SOURCE -T "`$D") fstype=$ExpectFstype uuid=$ExpectUuid owner=`$(stat -c %U:%a "`$D")"
"@
$destCheck = $identity + @"

if [ "`$LABEL" = frozen ] && [ "`$ATTEMPT" = 1 ]; then [ ! -e "`$C" ] || fail "`$C already exists"
else [ -d "`$C" ] && [ ! -L "`$C" ] && [ "`$(stat -c %u:%a "`$C")" = "`$(id -u):700" ] || fail "`$C is not an existing arm-owned mode-700 directory"; fi
[ ! -e "`$L" ] || fail "`$L already exists"
[ ! -e "`$C/`$LABEL.VERIFIED" ] || fail "`$C/`$LABEL.VERIFIED already exists (this label already has a verified copy)"
if [ "`$LABEL" = postschema ]; then [ -f "`$C/frozen.VERIFIED" ] || fail "`$C/frozen.VERIFIED is missing (copy the frozen set first)"; fi
a=`$(df -B1 --output=avail "`$D" | tail -1 | tr -d ' ')
[ "`$a" -ge $($bytes + [int64]$ReserveGiB * 1073741824) ] || fail "`$a bytes free, need $bytes plus $ReserveGiB GiB"
echo "capacity avail=`$a need=$bytes reserve=${ReserveGiB}GiB"
"@
$names = (@($set | ForEach-Object { "'$($_[1])'" }) + "'$sums'") -join ' '
$verify = @"
cd "`$L" 2>/dev/null || fail "`$L does not exist"
[ "`$(stat -c %u:%a .)" = "`$(id -u):700" ] || fail "`$L is not arm-owned mode 700"
[ "`$(ls -A | sort)" = "`$(printf '%s\n' $names | sort)" ] || fail "`$L does not hold exactly the $($set.Count + 1) listed files"
bad=`$(find . -mindepth 1 \( ! -type f -o ! -perm 600 -o ! -user "`$(id -un)" \) | head -3); [ -z "`$bad" ] || fail "not a mode-600 regular file: `$bad"
[ "`$(sha256sum < '$sums' | cut -c1-64)" = $sumsSha ] || fail "remote $sums differs from the local one"
sha256sum --check --strict --quiet '$sums' || fail "remote hash check failed"
echo "REMOTE VERIFIED `$L files=$($set.Count + 1)"
"@

switch ($Mode) {
  'Check' {
    "== O2 destination check (read-only) on $IsoHost"
    Remote $destCheck; if ($script:rc -ne 0) { throw "STOP: destination check failed (exit $script:rc)" }
    "SECONDCOPY CHECK PASS label=$Label attempt=$Attempt dest=$remoteL"
  }
  'Copy' {
    "== O2 destination check and new directory $remoteL on $IsoHost"
    $mk = if ($Label -eq 'frozen' -and $Attempt -eq 1) { 'mkdir -m 700 "$C" || fail "mkdir failed"' } else { ':' }
    Remote ($destCheck + "`n" + $mk + "`nmkdir -m 700 `"`$L`" || fail `"mkdir failed`"`necho `"created `$L`"")
    if ($script:rc -ne 0) { throw "STOP: destination check or mkdir failed (exit $script:rc)" }
    "== O3 copy ($($set.Count + 1) files, scp in SFTP mode: the remote path is never parsed by a shell)"
    foreach ($f in (@($set | ForEach-Object { $_[1] }) + $sums)) {
      $o = cmd /c "scp -s -q -o BatchMode=yes `"$(Join-Path $local $f)`" `"${IsoHost}:$remoteL/`" 2>&1"; $x = $LASTEXITCODE
      $o | ForEach-Object { "  scp: $_" }
      if ($x -ne 0) { throw "STOP: scp of $f failed (exit $x); $remoteL stays as it is, a new -Attempt writes beside it" }
    }
    "== O4 fsync and remote verification"
    Remote ("cd `"`$L`" && chmod 600 ./* || fail 'chmod failed'`nsync -- ./* && sync -f . || fail 'fsync failed'`n" + $identity + "`n" + $verify +
      "`n( set -o noclobber; printf '%s  %s\n' $sumsSha `"`$(basename `"`$L`")/$sums`" > `"`$C/`$LABEL.VERIFIED`" ) || fail 'VERIFIED record exists'`nchmod 600 `"`$C/`$LABEL.VERIFIED`" && sync -f `"`$C`" || fail 'record'")
    if ($script:rc -ne 0) { throw "STOP: remote verification failed (exit $script:rc); the backup gate does not pass" }
    "SECONDCOPY PASS label=$Label attempt=$Attempt archive_sha256=$ArchiveSha sums_sha256=$sumsSha dest=$remoteL"
  }
  'Verify' {
    "== O4 identity and remote verification (read-only)"
    Remote ($identity + "`n" + $verify); if ($script:rc -ne 0) { throw "STOP: remote verification failed (exit $script:rc)" }
    "SECONDCOPY VERIFY PASS label=$Label attempt=$Attempt sums_sha256=$sumsSha dest=$remoteL"
  }
}
