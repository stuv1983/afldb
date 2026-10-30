# AFLDB V2 release: transfers for the execution session (D-V2-PROD-EXEC-1 package, P-2). Derived from
# current-production-shadow/transfer.ps1. Windows PowerShell 5.1 and Windows OpenSSH; SHA-256 on both ends.
#   -Mode PinnedHash assemble the pinned rehearsal set in a temporary directory and print the hashes the
#                    approval pins (PINNED.SHA256 and the source tarball); nothing is transferred
#   -Mode Pull       host D/<label>.* -> protected local copy (HC-4); optional -SecondCopy root (O-5)
#   -Mode PushPinned the two read-only SQL files -> host D/pinned (the only host write this script makes)
#   -Mode PushIso    local copy -> NEW isolated root on streamanator (frozen: xfer/ plus the pinned rehearsal set;
#                    postschema: xfer2/), each verified there
#   -Mode PullIso    the rehearsal's decision files -> local copy
#   -Mode GateV2     pull host D/P.permissions.txt, compare with clone B's read-back (snapshot-compare permissions)
# Examples:
#   powershell -NoProfile -File transfer-session.ps1 -Mode Pull -Stamp <STAMP> -Label frozen -ArchiveSha <RESULT sha> [-SecondCopy E:\afldb]
#   powershell -NoProfile -File transfer-session.ps1 -Mode PushIso -Stamp <STAMP> -Label frozen -ArchiveSha <sha> -PinnedSha <PINNED.SHA256 sha> -SrcTarSha <sha>
param(
  [Parameter(Mandatory = $true)][ValidateSet('PinnedHash', 'Pull', 'PushPinned', 'PushIso', 'PullIso', 'GateV2')][string]$Mode,
  [Parameter(Mandatory = $true)][ValidatePattern('^\d{8}T\d{6}Z$')][string]$Stamp,
  [ValidateSet('frozen', 'postschema')][string]$Label = 'frozen',
  [ValidatePattern('^[0-9a-f]{64}$')][string]$ArchiveSha,
  [ValidatePattern('^[0-9a-f]{64}$')][string]$PinnedSha,
  [ValidatePattern('^[0-9a-f]{64}$')][string]$SrcTarSha,
  [string]$SecondCopy,
  [string]$IsoHost = 'arm@10.0.40.100',
  # Defaults are production; the preparation controls point these at a synthetic directory on the isolated host.
  [string]$ProdHost = 'afldb',
  [string]$ProdDirPrefix = '/home/arm/backups/afldb/release-v2-',
  [string]$LocalRoot = 'C:\Users\stuar\backups\afldb',
  [string]$IsoRootPrefix = '/home/arm/afldb-v2-prodexec-'
)
$ErrorActionPreference = 'Stop'
$pkg = $PSScriptRoot
$repo = (Resolve-Path (Join-Path $pkg '..\..\..\..')).Path
$hostDir = "$ProdDirPrefix$Stamp"
$local = Join-Path $LocalRoot "release-v2-$Stamp"
$isoRoot = "$IsoRootPrefix$Stamp"
$reviewed = '9ed9c9dd3e84682c43e96c46e98974b245eb54ed'

function Sha([string]$p) { (Get-FileHash -Algorithm SHA256 -LiteralPath $p).Hash.ToLower() }
function Need([string]$name, [string]$v) { if (-not $v) { throw "STOP: -$name is required for -Mode $Mode" } }
function Run([string]$what) { if ($LASTEXITCODE -ne 0) { throw "STOP: $what failed (exit $LASTEXITCODE)" } }
# LF-only, BOM-free text, so bash and sha256sum on Linux read exactly these bytes.
function WriteLf([string]$path, [string[]]$lines) { [IO.File]::WriteAllText($path, (($lines -join "`n") + "`n"), (New-Object Text.UTF8Encoding($false))) }
function ParseSums([string]$file) {
  $out = @()
  foreach ($l in [IO.File]::ReadAllLines($file)) {
    if ($l -notmatch '^([0-9a-f]{64})  ([A-Za-z0-9._-]+)$') { throw "STOP: malformed line in $file" }
    $out += , @($Matches[1], $Matches[2])
  }
  if ($out.Count -lt 2) { throw "STOP: $file lists fewer than 2 files" }
  $out
}
function CheckDir([string]$dir, [string]$sums) {
  foreach ($e in (ParseSums (Join-Path $dir $sums))) {
    if ((Sha (Join-Path $dir $e[1])) -ne $e[0]) { throw "STOP: hash mismatch for $($e[1]) in $dir" }
  }
}
function Protect([string]$dir) {
  New-Item -ItemType Directory -Path $dir | Out-Null
  icacls $dir /inheritance:r /grant:r "$($env:USERNAME):(OI)(CI)F" 'SYSTEM:(OI)(CI)F' 'Administrators:(OI)(CI)F' | Out-Null
  Run 'icacls'
}

# The pinned rehearsal set: every file P-3 reads from pinned/, listed in PINNED.SHA256 (LF).
function PinnedSet([string]$dest) {
  $files = [ordered]@{
    'isolated-rehearsal.sh' = "$pkg\isolated-rehearsal.sh"; 'drift-gate.mjs' = "$pkg\drift-gate.mjs"; 'gate-r.mjs' = "$pkg\gate-r.mjs"
    'snapshot-compare.mjs' = "$pkg\snapshot-compare.mjs"; 'permission-readback.sql' = "$pkg\permission-readback.sql"
    'arel-readback.sql' = "$pkg\lib\arel-readback.sql"; 'rehearsal-summary.mjs' = "$pkg\lib\rehearsal-summary.mjs"
    'restore-accepted.mjs' = "$pkg\lib\restore-accepted.mjs"; 'schema-dump.mjs' = "$pkg\lib\schema-dump.mjs"
    'psql-owner.mjs' = "$pkg\lib\psql-owner.mjs"; 'ledger-check.mjs' = "$pkg\lib\ledger-check.mjs"
    'ledger-tsv.mjs' = "$pkg\lib\ledger-tsv.mjs"; 'staged-seasons.mjs' = "$pkg\lib\staged-seasons.mjs"
    'expected-deltas.mjs' = "$pkg\..\current-production-shadow\expected-deltas.mjs"
    'artifact-manifest.mjs' = "$pkg\..\lock-build-20261029\artifact-manifest.mjs"
    'accepted/release-gates.json' = "$pkg\..\current-production-shadow\run-20261028T192336Z\release-gates.json"
    'accepted/migration.parity.json' = "$pkg\..\current-production-shadow\run-20261028T192336Z\migration.parity.json"
    'accepted/expected-deltas.json' = "$pkg\..\current-production-shadow\run-20261028T192336Z\expected-deltas.json"
  }
  Protect $dest; New-Item -ItemType Directory -Path (Join-Path $dest 'accepted') | Out-Null
  foreach ($k in $files.Keys) { Copy-Item -LiteralPath $files[$k] -Destination (Join-Path $dest ($k -replace '/', '\')) }
  # The private source: git archive of the reviewed commit, regenerated here and bound to its pinned hash.
  $tar = Join-Path $dest 'src-9ed9c9dd.tar'
  git -C $repo archive --format=tar -o $tar $reviewed; Run 'git archive'
  if ($Mode -ne 'PinnedHash' -and (Sha $tar) -ne $SrcTarSha) { throw "STOP: git archive $reviewed differs from the pinned -SrcTarSha" }
  $lines = @()
  foreach ($k in (@($files.Keys) + 'src-9ed9c9dd.tar' | Sort-Object)) { $lines += "$(Sha (Join-Path $dest ($k -replace '/', '\')))  $k" }
  WriteLf (Join-Path $dest 'PINNED.SHA256') $lines
  if ($Mode -eq 'PinnedHash') { return }
  if ((Sha (Join-Path $dest 'PINNED.SHA256')) -ne $PinnedSha) { throw 'STOP: the assembled PINNED.SHA256 differs from the pinned -PinnedSha' }
  "pinned set OK ($($lines.Count) files)"
}

switch ($Mode) {
  'PinnedHash' {
    $tmp = Join-Path $env:TEMP "afldb-v2-pinned-$([guid]::NewGuid().ToString('N'))"
    try {
      PinnedSet $tmp
      Get-Content -LiteralPath (Join-Path $tmp 'PINNED.SHA256')
      "PINNED.SHA256 sha256=$(Sha (Join-Path $tmp 'PINNED.SHA256'))"
      "src-9ed9c9dd.tar sha256=$(Sha (Join-Path $tmp 'src-9ed9c9dd.tar'))"
    } finally { Remove-Item -LiteralPath $tmp -Recurse -Force -ErrorAction SilentlyContinue }
  }
  'Pull' {
    Need 'ArchiveSha' $ArchiveSha
    "== T1 protected local directory $local"
    if (-not (Test-Path -LiteralPath $local)) { Protect $local }
    $sums = "$Label.SHA256SUMS"
    if (Test-Path -LiteralPath (Join-Path $local $sums)) { throw "STOP: $sums already pulled" }
    "== T2 copy $Label set from production (read-only scp)"
    scp -o BatchMode=yes -p "${ProdHost}:$hostDir/$sums" "$local\"; Run 'scp of the sums file'
    $set = ParseSums (Join-Path $local $sums)
    foreach ($e in $set) { scp -o BatchMode=yes -p "${ProdHost}:$hostDir/$($e[1])" "$local\"; Run "scp of $($e[1])" }
    CheckDir $local $sums
    $dumpLine = @($set | Where-Object { $_[1] -match '\.dump$' })
    if ($dumpLine.Count -ne 1 -or $dumpLine[0][0] -ne $ArchiveSha) { throw 'STOP: the archive hash differs from the host RESULT line' }
    "local hashes OK ($($set.Count) files)"
    if ($SecondCopy) {
      "== T3 second copy (O-5) under $SecondCopy"
      $second = Join-Path $SecondCopy "release-v2-$Stamp"
      if (-not (Test-Path -LiteralPath $second)) { New-Item -ItemType Directory -Path $second | Out-Null }
      Copy-Item -LiteralPath (Join-Path $local $sums) -Destination $second
      foreach ($e in $set) { Copy-Item -LiteralPath (Join-Path $local $e[1]) -Destination $second }
      CheckDir $second $sums
      "second copy hashes OK"
    }
    "TRANSFER PASS mode=Pull label=$Label archive_sha256=$ArchiveSha local=$local"
  }
  'PushPinned' {
    "== P1 the two read-only SQL files and the artifact manifest tool -> ${ProdHost}:$hostDir/pinned (init created it)"
    $am = "$pkg\..\lock-build-20261029\artifact-manifest.mjs"
    scp -o BatchMode=yes "$pkg\permission-readback.sql" "$pkg\lib\arel-readback.sql" $am "${ProdHost}:$hostDir/pinned/"; Run 'scp to the host'
    "copied; verify on the host with: host-session.sh pinned $Stamp"
    "TRANSFER PASS mode=PushPinned permission-readback.sql=$(Sha "$pkg\permission-readback.sql") arel-readback.sql=$(Sha "$pkg\lib\arel-readback.sql") artifact-manifest.mjs=$(Sha $am)"
  }
  'PushIso' {
    Need 'ArchiveSha' $ArchiveSha; Need 'PinnedSha' $PinnedSha
    # Every input is checked before anything is created, so a refused call leaves nothing behind.
    if ($Label -eq 'frozen') { Need 'SrcTarSha' $SrcTarSha }
    CheckDir $local "$Label.SHA256SUMS"
    $set = ParseSums (Join-Path $local "$Label.SHA256SUMS")
    $two = @($set | Where-Object { $_[1] -match '\.(dump|release\.json)$' })
    $d = @($two | Where-Object { $_[1] -match '\.dump$' }); $j = @($two | Where-Object { $_[1] -match '\.release\.json$' })
    if ($d.Count -ne 1 -or $j.Count -ne 1 -or $j[0][1] -ne ($d[0][1] -replace '\.dump$', '.release.json')) { throw 'STOP: the set must hold exactly one dump and its one release sidecar' }
    if (@($two | Where-Object { $_[1] -match '\.dump$' })[0][0] -ne $ArchiveSha) { throw 'STOP: archive hash differs from -ArchiveSha' }
    $xfer = if ($Label -eq 'frozen') { 'xfer' } else { 'xfer2' }
    $stage = Join-Path $local "iso-$xfer"
    if (Test-Path -LiteralPath $stage) { throw "STOP: $stage already exists" }
    Protect $stage
    foreach ($e in $two) { Copy-Item -LiteralPath (Join-Path $local $e[1]) -Destination $stage }
    WriteLf (Join-Path $stage 'SHA256SUMS') @($two | ForEach-Object { "$($_[0])  $($_[1])" })
    if ($Label -eq 'frozen') {
      $pinned = Join-Path $local 'iso-pinned'
      if (Test-Path -LiteralPath $pinned) { throw "STOP: $pinned already exists" }
      PinnedSet $pinned
      "== I1 NEW isolated root $isoRoot"
      ssh -o BatchMode=yes $IsoHost "test ! -e $isoRoot && mkdir -m 700 $isoRoot $isoRoot/xfer && df -B1 --output=avail /home/arm | tail -1"
      Run "creating $isoRoot (it must not exist)"
      # The remote pinned/ does not exist yet, so scp -r creates it as a copy of the local directory.
      scp -o BatchMode=yes -r -p "$pinned" "${IsoHost}:$isoRoot/pinned"; Run 'scp of the pinned set'
      ssh -o BatchMode=yes $IsoHost "cd $isoRoot/pinned && sha256sum --check --strict --quiet PINNED.SHA256 && test `$(sha256sum < PINNED.SHA256 | cut -c1-64) = $PinnedSha"
      Run 'pinned set check on streamanator'
    } else {
      ssh -o BatchMode=yes $IsoHost "test -d $isoRoot/evidence && test ! -e $isoRoot/xfer2 && mkdir -m 700 $isoRoot/xfer2"
      Run "creating $isoRoot/xfer2 (the rehearsal root must exist and xfer2 must not)"
    }
    foreach ($f in (@($two | ForEach-Object { $_[1] }) + 'SHA256SUMS')) { scp -o BatchMode=yes -p (Join-Path $stage $f) "${IsoHost}:$isoRoot/$xfer/"; Run "scp of $f to $xfer" }
    ssh -o BatchMode=yes $IsoHost "cd $isoRoot/$xfer && chmod 600 ./* && sha256sum --check --strict SHA256SUMS"
    Run "hash check of $xfer on streamanator"
    $runMode = if ($Label -eq 'frozen') { 'rehearse' } else { 'after' }
    "start with: ssh $IsoHost `"nohup bash $isoRoot/pinned/isolated-rehearsal.sh $runMode $Stamp $ArchiveSha $PinnedSha > $isoRoot/$runMode.out 2>&1 &`""
    "TRANSFER PASS mode=PushIso label=$Label isolated_root=$isoRoot"
  }
  'PullIso' {
    $dest = Join-Path $local 'iso-evidence'
    if (-not (Test-Path -LiteralPath $dest)) { Protect $dest }
    Need 'ArchiveSha' $ArchiveSha
    # Each mode's files are pulled only once its run has finished (<mode>.done), and each is verified against
    # that run's own evidence manifest. The digest is handed to A-REL only for a PASS* rehearsal of -ArchiveSha.
    $sets = [ordered]@{
      rehearse = @('rehearse.result', 'rehearse.summary.json', 'rehearse.input-sha256.txt', 'AM.ledger.digest', 'AM.ledger.tsv',
        'B.permissions.txt', 'gateD.json', 'gateD.compare.json', 'gateR.json', 'T.counts.json', 'timings.txt')
      after = @('after.result', 'after.summary.json', 'after.input-sha256.txt', 'gateV3.json', 'gateV3.compare.json', 'timings.txt')
    }
    $done = @{}
    foreach ($m in $sets.Keys) {
      ssh -o BatchMode=yes $IsoHost "test -s $isoRoot/evidence/$m.done -a -s $isoRoot/evidence/$m.evidence-sha256.txt"
      if ($LASTEXITCODE -ne 0) { if ($m -eq 'rehearse') { throw 'STOP: the rehearsal has not finished (no rehearse.done)' } else { continue } }
      $mdir = Join-Path $dest $m
      if (-not (Test-Path -LiteralPath $mdir)) { New-Item -ItemType Directory -Path $mdir | Out-Null }
      scp -o BatchMode=yes -p "${IsoHost}:$isoRoot/evidence/$m.evidence-sha256.txt" "$mdir\"; Run "scp of $m.evidence-sha256.txt"
      $manifest = @{}
      foreach ($l in [IO.File]::ReadAllLines((Join-Path $mdir "$m.evidence-sha256.txt"))) {
        if ($l -match '^([0-9a-f]{64})  \./(.+)$') { $manifest[$Matches[2]] = $Matches[1] }
      }
      # `after` appends to timings.txt, which the rehearse manifest sealed earlier: once after has finished, the
      # file is verified only against the after manifest (a finished after run always pulls it).
      $files = $sets[$m]
      if ($m -eq 'rehearse') {
        ssh -o BatchMode=yes $IsoHost "test -s $isoRoot/evidence/after.done -a -s $isoRoot/evidence/after.evidence-sha256.txt"
        if ($LASTEXITCODE -eq 0) { $files = @($files | Where-Object { $_ -ne 'timings.txt' }) }
      }
      foreach ($f in $files) {
        if (-not $manifest.ContainsKey($f)) { throw "STOP: $f is not in the $m evidence manifest" }
        scp -o BatchMode=yes -p "${IsoHost}:$isoRoot/evidence/$f" "$mdir\"; Run "scp of $f"
        if ((Sha (Join-Path $mdir $f)) -ne $manifest[$f]) { throw "STOP: $f differs from the $m evidence manifest" }
      }
      $result = [IO.File]::ReadAllText((Join-Path $mdir "$m.result")).Trim()
      $summary = Get-Content -Raw -LiteralPath (Join-Path $mdir "$m.summary.json") | ConvertFrom-Json
      if ($m -eq 'rehearse' -and $summary.gates.archiveSha256 -ne $ArchiveSha) { throw 'STOP: the rehearsal summary is not about -ArchiveSha' }
      "$m result: $result"
      $done[$m] = $result
    }
    if ($done['rehearse'] -notmatch '^PASS') { throw "STOP: rehearsal result is '$($done['rehearse'])'; no digest is handed to A-REL" }
    # Stage 11 ends on this line: a finished gate V3 run that did not pass never prints TRANSFER PASS.
    if ($done.ContainsKey('after') -and $done['after'] -notmatch '^PASS') { throw "STOP: after (gate V3) result is '$($done['after'])'" }
    # Flat copies for GateV2 and the record.
    Copy-Item -LiteralPath (Join-Path $dest 'rehearse\B.permissions.txt') -Destination $dest -Force
    "ledger 117 digest for host-session.sh arel: $([IO.File]::ReadAllText((Join-Path $dest 'rehearse\AM.ledger.digest')).Trim()) (frozen archive $ArchiveSha)"
    "TRANSFER PASS mode=PullIso dest=$dest results=$(($done.GetEnumerator() | ForEach-Object { "$($_.Key):$($_.Value)" }) -join ',')"
  }
  'GateV2' {
    $dest = Join-Path $local 'iso-evidence'
    $b = Join-Path $dest 'B.permissions.txt'
    if (-not (Test-Path -LiteralPath $b)) { throw 'STOP: run -Mode PullIso first (clone B read-back missing)' }
    scp -o BatchMode=yes -p "${ProdHost}:$hostDir/P.permissions.txt" "${ProdHost}:$hostDir/readback.SHA256SUMS" "$local\"; Run 'scp of the read-back'
    $line = [IO.File]::ReadAllText((Join-Path $local 'readback.SHA256SUMS')).Trim()
    if ($line -notmatch '^([0-9a-f]{64})  ' -or $Matches[1] -ne (Sha (Join-Path $local 'P.permissions.txt'))) { throw 'STOP: P.permissions.txt hash differs from the host record' }
    $report = Join-Path $local 'gateV2.permissions-compare.json'
    node "$pkg\snapshot-compare.mjs" permissions --a $b --b (Join-Path $local 'P.permissions.txt') --out $report
    $x = $LASTEXITCODE
    "gate V2 comparison exit=$x (0 IDENTICAL, 3 REVIEW: owner resolves each C| line, 1 DIFFERENT: stop before A-GO, 2 invalid: stop)"
    if ($x -ne 0 -and $x -ne 3) { throw "STOP: gate V2 exit $x" }
    if ($x -eq 3) { "TRANSFER REVIEW mode=GateV2 report=$($report): S/E identical and A ok, C| differs; clone equivalence NOT claimed, the owner resolves each C| line" }
    else { "TRANSFER PASS mode=GateV2 IDENTICAL report=$report" }
  }
}
