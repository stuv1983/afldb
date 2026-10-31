# Controls for second-copy.ps1 (O-5 adapter). Non-secret synthetic sets only. Remote writes go to a test
# directory under the preparation root on streamanator (its path also contains parentheses); the real destination
# is only checked read-only (R1). Prints one line per control and "CONTROLS PASS n/n" or "CONTROLS FAIL".
param([string]$Out = (Join-Path $env:TEMP "afldb-o5-controls-$([guid]::NewGuid().ToString('N'))"))
$ErrorActionPreference = 'Stop'
$sc = Join-Path $PSScriptRoot '..\second-copy.ps1'
$iso = 'arm@10.0.40.100'
$troot = "/home/arm/afldb-v2-prodexec-20261030T020000Z/o5-test-$((Get-Date).ToUniversalTime().ToString('yyyyMMddTHHmmssZ'))"
$tdest = "$troot/backup(2026-10-31)"
New-Item -ItemType Directory -Path $Out | Out-Null
$lr = Join-Path $Out 'local'
function WriteLf([string]$path, [string[]]$lines) { [IO.File]::WriteAllText($path, (($lines -join "`n") + "`n"), (New-Object Text.UTF8Encoding($false))) }
function Sha([string]$p) { (Get-FileHash -Algorithm SHA256 -LiteralPath $p).Hash.ToLower() }
function MakeSet([string]$stamp, [string]$label) {
  $d = Join-Path $lr "release-v2-$stamp"; if (-not (Test-Path $d)) { New-Item -ItemType Directory -Path $d | Out-Null }
  $b = New-Object byte[] 1048576; (New-Object Random).NextBytes($b)
  [IO.File]::WriteAllBytes((Join-Path $d "afldb_$label.dump"), $b)
  WriteLf (Join-Path $d "afldb_$label.release.json") @("{`"synthetic`":`"$label`"}")
  WriteLf (Join-Path $d "$label.restore.txt") @('synthetic, non-secret')
  $names = "afldb_$label.dump", "afldb_$label.release.json", "$label.restore.txt"
  WriteLf (Join-Path $d "$label.SHA256SUMS") @($names | ForEach-Object { "$(Sha (Join-Path $d $_))  $_" })
  Sha (Join-Path $d "afldb_$label.dump")
}
function Ssh([string]$body) {
  $f = Join-Path $Out "r-$([guid]::NewGuid().ToString('N')).sh"; WriteLf $f @("set -u", $body)
  $o = cmd /c "ssh -o BatchMode=yes $iso bash -s < `"$f`" 2>&1"; $script:src = $LASTEXITCODE; $o
}
function Run([string[]]$a) {
  $ErrorActionPreference = 'Continue'
  $o = & powershell -NoProfile -File $sc @a -LocalRoot $lr 2>&1 | ForEach-Object { "$_" }; $script:x = $LASTEXITCODE; $o
}
$n = 0; $pass = 0
function Expect([string]$id, [string]$what, [bool]$ok, [string[]]$o) {
  $script:n++; if ($ok) { $script:pass++ }
  "$(if ($ok) { 'PASS' } else { 'FAIL' }) $id $what :: $((@($o) | Where-Object { $_ -match 'STOP|PASS|VERIFIED|DEST ' } | Select-Object -Last 1))"
}
# Paths, modes, sizes, inodes, mtimes and every file's sha256: a same-size overwrite changes it.
function Listing([string]$dir = $tdest) { Ssh "cd '$dir' && { find . -printf '%p %m %s %i %T@\n'; find . -type f -exec sha256sum {} +; } | LC_ALL=C sort | sha256sum | cut -c1-64" }

"== setup: $tdest (mode 700) and synthetic sets in $lr"
Ssh "test ! -e '$troot' && mkdir -m 700 '$troot' '$tdest' && mkdir -m 755 '$troot/open(755)' && ln -s '$tdest' '$troot/link(sym)' && echo ok"
if ($script:src -ne 0) { throw 'setup failed' }
# The test destination is on the root filesystem: its UUID stands in for the backup disk's.
$rootUuid = (Ssh "findmnt -n -o UUID /").Trim()
"root filesystem uuid=$rootUuid"
New-Item -ItemType Directory -Path $lr | Out-Null
$S1 = '20261031T000001Z'; $fz = MakeSet $S1 'frozen'; $ps = MakeSet $S1 'postschema'
$S2 = '20261031T000002Z'; $fz2 = MakeSet $S2 'frozen'
$S3 = '20261031T000003Z'; $fz3 = MakeSet $S3 'frozen'; $ps3 = MakeSet $S3 'postschema'
$S4 = '20261031T000004Z'; $fz4 = MakeSet $S4 'frozen'; $ps4 = MakeSet $S4 'postschema'
$common = @('-DestRoot', $tdest, '-MountPoint', '/', '-ExpectUuid', $rootUuid, '-ExpectFstype', 'ext4')

$o = Run (@('-Mode', 'Check', '-Stamp', $S1, '-ArchiveSha', $fz) + $common); Expect 'A1' 'Check frozen on a fresh destination' ($x -eq 0 -and ($o -match 'SECONDCOPY CHECK PASS')) $o
$o = Run (@('-Mode', 'Copy', '-Stamp', $S1, '-ArchiveSha', $fz) + $common); Expect 'A2' 'Copy frozen' ($x -eq 0 -and ($o -match "SECONDCOPY PASS label=frozen attempt=1 archive_sha256=$fz")) $o
$o = Ssh "cd '$tdest/release-v2-$S1' && stat -c '%a %n' . frozen frozen.VERIFIED frozen/*"; Expect 'A2m' 'modes: child and label 700, record and files 600' (($o -join ' ') -match '^700 \. 700 frozen 600 frozen\.VERIFIED 600 frozen/\S+ 600 frozen/\S+ 600 frozen/\S+ 600 frozen/\S+$') $o
$o = Ssh "cat '$tdest/release-v2-$S1/frozen.VERIFIED'"; Expect 'A2v' 'frozen.VERIFIED names the verified SUMS hash' (($o -join '') -eq "$(Sha (Join-Path $lr "release-v2-$S1\frozen.SHA256SUMS"))  frozen/frozen.SHA256SUMS") $o
$o = Run (@('-Mode', 'Verify', '-Stamp', $S1, '-ArchiveSha', $fz) + $common); Expect 'A3' 'Verify frozen' ($x -eq 0 -and ($o -match 'SECONDCOPY VERIFY PASS')) $o
$before = Listing
$o = Run (@('-Mode', 'Copy', '-Stamp', $S1, '-ArchiveSha', $fz) + $common); $after = Listing
Expect 'A4' 'second frozen Copy refused, destination unchanged' ($x -ne 0 -and ($o -match 'already exists') -and $before -eq $after) $o
$o = Run (@('-Mode', 'Copy', '-Stamp', $S1, '-Label', 'postschema', '-ArchiveSha', $ps) + $common); Expect 'A5' 'Copy postschema into the existing child' ($x -eq 0 -and ($o -match 'SECONDCOPY PASS label=postschema')) $o
$before = Listing
$o = Run (@('-Mode', 'Copy', '-Stamp', $S1, '-Label', 'postschema', '-ArchiveSha', $ps) + $common); $after = Listing
Expect 'A6' 'second postschema Copy refused, destination unchanged' ($x -ne 0 -and ($o -match 'already exists') -and $before -eq $after) $o
$o = Run (@('-Mode', 'Copy', '-Stamp', $S3, '-Label', 'postschema', '-ArchiveSha', $ps3) + $common); Expect 'A7' 'postschema without a frozen child refused' ($x -ne 0 -and ($o -match 'not an existing arm-owned')) $o

# A failed attempt 1 (simulated: child and frozen/ holding a truncated dump) stays untouched; attempt 2 writes beside it.
Ssh "mkdir -m 700 '$tdest/release-v2-$S4' '$tdest/release-v2-$S4/frozen' && head -c 1000 /dev/zero > '$tdest/release-v2-$S4/frozen/afldb_frozen.dump'" | Out-Null
$partial = Listing "$tdest/release-v2-$S4/frozen"
$o = Run (@('-Mode', 'Copy', '-Stamp', $S4, '-ArchiveSha', $fz4) + $common); Expect 'P1' 'after a failed attempt, attempt 1 again is refused' ($x -ne 0 -and ($o -match 'already exists')) $o
$o = Run (@('-Mode', 'Copy', '-Stamp', $S4, '-Label', 'postschema', '-ArchiveSha', $ps4) + $common); Expect 'P2' 'postschema refused without frozen.VERIFIED' ($x -ne 0 -and ($o -match 'frozen.VERIFIED is missing')) $o
$o = Run (@('-Mode', 'Copy', '-Stamp', $S4, '-Attempt', '2', '-ArchiveSha', $fz4) + $common); Expect 'P3' 'attempt 2 copies into frozen-a2' ($x -eq 0 -and ($o -match 'SECONDCOPY PASS label=frozen attempt=2') -and ($o -match 'frozen-a2')) $o
Expect 'P4' 'the failed attempt is unchanged' ((Listing "$tdest/release-v2-$S4/frozen") -eq $partial) @('checked')
$o = Run (@('-Mode', 'Verify', '-Stamp', $S4, '-Attempt', '2', '-ArchiveSha', $fz4) + $common); Expect 'P5' 'Verify attempt 2' ($x -eq 0) $o
$o = Run (@('-Mode', 'Copy', '-Stamp', $S4, '-Attempt', '3', '-ArchiveSha', $fz4) + $common); Expect 'P6' 'attempt 3 refused once frozen is verified' ($x -ne 0 -and ($o -match 'already has a verified copy')) $o
$o = Run (@('-Mode', 'Copy', '-Stamp', $S4, '-Label', 'postschema', '-ArchiveSha', $ps4) + $common); Expect 'P7' 'postschema after the verified attempt 2' ($x -eq 0 -and ($o -match 'SECONDCOPY PASS label=postschema attempt=1')) $o
$o = Run (@('-Mode', 'Copy', '-Stamp', $S4, '-Attempt', '4', '-ArchiveSha', $fz4) + $common); Expect 'P8' 'attempt 4 rejected' ($x -ne 0) $o

# Local failures stop before anything remote is created.
[IO.File]::AppendAllText((Join-Path $lr "release-v2-$S2\frozen.restore.txt"), 'x')
$o = Run (@('-Mode', 'Copy', '-Stamp', $S2, '-ArchiveSha', $fz2) + $common); $e = Ssh "test ! -e '$tdest/release-v2-$S2'"
Expect 'F1' 'local file differs from its manifest: STOP, nothing created' ($x -ne 0 -and ($o -match 'local hash mismatch') -and $script:src -eq 0) $o
$o = Run (@('-Mode', 'Copy', '-Stamp', $S3, '-ArchiveSha', ('0' * 64)) + $common); $e = Ssh "test ! -e '$tdest/release-v2-$S3'"
Expect 'F2' 'ArchiveSha differs from the dump: STOP, nothing created' ($x -ne 0 -and ($o -match 'exactly one dump') -and $script:src -eq 0) $o
$o = Run (@('-Mode', 'Copy', '-Stamp', '20261031T000009Z', '-ArchiveSha', $fz) + $common); Expect 'F3' 'missing local set: STOP' ($x -ne 0 -and ($o -match 'is missing')) $o

# Remote verification detects tampering (test directory only), each followed by restoring the byte state.
$fd = "$tdest/release-v2-$S1/frozen"
Ssh "printf x >> '$fd/frozen.restore.txt'" | Out-Null
$o = Run (@('-Mode', 'Verify', '-Stamp', $S1, '-ArchiveSha', $fz) + $common); Expect 'F4' 'remote content changed: STOP' ($x -ne 0 -and ($o -match 'remote hash check failed')) $o
Ssh "truncate -s -1 '$fd/frozen.restore.txt'" | Out-Null
$o = Run (@('-Mode', 'Verify', '-Stamp', $S1, '-ArchiveSha', $fz) + $common); Expect 'F4r' 'restored: Verify passes again' ($x -eq 0) $o
Ssh "install -m 600 /dev/null '$fd/extra.txt'" | Out-Null
$o = Run (@('-Mode', 'Verify', '-Stamp', $S1, '-ArchiveSha', $fz) + $common); Expect 'F5' 'extra remote file: STOP' ($x -ne 0 -and ($o -match 'exactly the 4 listed files')) $o
Ssh "rm '$fd/extra.txt'; rm '$fd/frozen.restore.txt'" | Out-Null
$o = Run (@('-Mode', 'Verify', '-Stamp', $S1, '-ArchiveSha', $fz) + $common); Expect 'F6' 'missing remote file: STOP' ($x -ne 0 -and ($o -match 'exactly the 4 listed files')) $o
scp -s -q -o BatchMode=yes (Join-Path $lr "release-v2-$S1\frozen.restore.txt") "${iso}:$fd/"; Ssh "chmod 644 '$fd/frozen.restore.txt'" | Out-Null
$o = Run (@('-Mode', 'Verify', '-Stamp', $S1, '-ArchiveSha', $fz) + $common); Expect 'F7' 'remote file mode 644: STOP' ($x -ne 0 -and ($o -match 'not a mode-600')) $o
Ssh "chmod 600 '$fd/frozen.restore.txt'" | Out-Null
$o = Run (@('-Mode', 'Verify', '-Stamp', $S1, '-ArchiveSha', $fz) + $common); Expect 'F7r' 'restored: Verify passes again' ($x -eq 0) $o

Ssh "printf '\n' >> '$fd/frozen.SHA256SUMS'" | Out-Null
$o = Run (@('-Mode', 'Verify', '-Stamp', $S1, '-ArchiveSha', $fz) + $common); Expect 'F7s' 'remote SUMS changed: STOP' ($x -ne 0 -and ($o -match 'remote frozen.SHA256SUMS differs from the local one')) $o
Ssh "truncate -s -1 '$fd/frozen.SHA256SUMS'" | Out-Null
$o = Run (@('-Mode', 'Verify', '-Stamp', $S1, '-ArchiveSha', $fz) + $common); Expect 'F7sr' 'restored: Verify passes again' ($x -eq 0) $o
$o = Run (@('-Mode', 'Verify', '-Stamp', $S1, '-ArchiveSha', $fz, '-DestRoot', $tdest, '-MountPoint', '/', '-ExpectUuid', ('0' * 8 + '-0000-0000-0000-' + '0' * 12))); Expect 'F7u' 'Verify on a filesystem with another UUID: STOP' ($x -ne 0 -and ($o -match 'filesystem UUID is')) $o
$o = Run (@('-Mode', 'Copy', '-Stamp', $S3, '-ArchiveSha', $fz3, '-DestRoot', $tdest, '-MountPoint', '/', '-ExpectUuid', $rootUuid, '-ExpectFstype', 'xfs')); Expect 'F7t' 'Copy on a filesystem of another type: STOP' ($x -ne 0 -and ($o -match 'filesystem type is not xfs')) $o
$o = Run (@('-Mode', 'Verify', '-Stamp', $S1, '-ArchiveSha', $fz, '-DestRoot', $tdest, '-MountPoint', '/mnt/backup')); Expect 'F7m' 'Verify with the destination off the named mount: STOP' ($x -ne 0 -and ($o -match 'not on the /mnt/backup filesystem')) $o

# Destination refusals; none creates anything.
$o = Run (@('-Mode', 'Copy', '-Stamp', $S3, '-ArchiveSha', $fz3, '-DestRoot', "$troot/missing(x)", '-MountPoint', '/', '-ExpectUuid', $rootUuid)); $e = Ssh "test ! -e '$troot/missing(x)'"
Expect 'F8' 'missing destination: STOP, not created' ($x -ne 0 -and ($o -match 'never created here') -and $script:src -eq 0) $o
$o = Run (@('-Mode', 'Copy', '-Stamp', $S3, '-ArchiveSha', $fz3, '-DestRoot', "$troot/open(755)", '-MountPoint', '/', '-ExpectUuid', $rootUuid)); $e = Ssh "test -z `"`$(ls -A '$troot/open(755)')`""
Expect 'F9' 'destination mode 755: STOP, nothing created' ($x -ne 0 -and ($o -match 'mode 700') -and $script:src -eq 0) $o
$o = Run (@('-Mode', 'Copy', '-Stamp', $S3, '-ArchiveSha', $fz3, '-DestRoot', "$troot/link(sym)", '-MountPoint', '/', '-ExpectUuid', $rootUuid)); Expect 'F10' 'destination is a symlink: STOP' ($x -ne 0 -and ($o -match 'not an existing directory')) $o
$o = Run (@('-Mode', 'Copy', '-Stamp', $S3, '-ArchiveSha', $fz3, '-DestRoot', $tdest, '-MountPoint', '/mnt/backup')); Expect 'F11' 'destination not on the named mount: STOP' ($x -ne 0 -and ($o -match 'not on the /mnt/backup filesystem')) $o
$o = Run (@('-Mode', 'Copy', '-Stamp', $S3, '-ArchiveSha', $fz3, '-DestRoot', $tdest, '-MountPoint', '/home/arm')); Expect 'F12' 'named mount is not a mountpoint: STOP' ($x -ne 0 -and ($o -match 'is not a mountpoint')) $o
$o = Run (@('-Mode', 'Copy', '-Stamp', $S3, '-ArchiveSha', $fz3, '-ReserveGiB', '1024') + $common); Expect 'F13' 'capacity below set plus reserve: STOP' ($x -ne 0 -and ($o -match 'bytes free, need')) $o
$o = Run (@('-Mode', 'Copy', '-Stamp', $S3, '-ArchiveSha', $fz3, '-DestRoot', "$troot/a b", '-MountPoint', '/', '-ExpectUuid', $rootUuid)); $e = Ssh "test ! -e '$troot/a b'"; Expect 'F14' 'path with a space rejected, nothing created' ($x -ne 0 -and $script:src -eq 0) $o
$o = Run (@('-Mode', 'Copy', '-Stamp', $S3, '-ArchiveSha', $fz3, '-DestRoot', "$troot/a'b", '-MountPoint', '/', '-ExpectUuid', $rootUuid)); $e = Ssh "test ! -e '$troot/a'\''b'"; Expect 'F15' 'path with a quote rejected, nothing created' ($x -ne 0 -and $script:src -eq 0) $o
$o = Run (@('-Mode', 'Copy', '-Stamp', $S3, '-ArchiveSha', $fz3, '-DestRoot', "$troot/../o5-test/backup(2026-10-31)", '-MountPoint', '/', '-ExpectUuid', $rootUuid)); Expect 'F16' 'path with .. rejected' ($x -ne 0 -and ($o -match 'normalised')) $o
$e = Ssh "test ! -e '$tdest/release-v2-$S3'"; Expect 'F17' 'no refused control created a release child' ($script:src -eq 0) @('checked')

# The real destination, read-only.
$o = Run @('-Mode', 'Check', '-Stamp', $S3, '-ArchiveSha', $fz3); Expect 'R1' 'Check on /mnt/backup/backup(2026-10-31) (read-only)' ($x -eq 0 -and ($o -match 'source=/dev/sdg1 fstype=ext4')) $o
$o | Where-Object { $_ -match 'DEST ' }
$e = Ssh "test -z `"`$(ls -A '/mnt/backup/backup(2026-10-31)')`""; Expect 'R2' 'real destination still empty' ($script:src -eq 0) @('checked')

"second-copy.ps1 sha256=$(Sha $sc)"
if ($pass -eq $n) { "CONTROLS PASS $pass/$n" } else { "CONTROLS FAIL $pass/$n" }
