<#
ISSUE-331 retirement of two quarantined WSL registrations. OWNER-RUN ONLY.

Decisions D-331-6..11 (owner, 2026-11-04). Runbook: issues/open/AFLDB-ISSUE-331.md section 13.
Unregistering removes the registered distribution and its accessible disk. It is not secure erasure,
not a password rotation and not proof of global credential invalidation.

What this script runs against WSL (and nothing else):
  wsl.exe --list --running --quiet          read-only; output captured privately, never printed
  wsl.exe --unregister <exact target name>  twice at most, one per target, never retried
It never stops, terminates or shuts down any distribution, repairs the registry, or deletes anything else.

Every gate is re-run after the RETIRE confirmation and immediately before each unregister. Any failed
gate, error or ambiguous output stops the script with a non-zero exit code.

Usage:  .\AFLDB-ISSUE-331-retire-wsl.ps1            (real run, asks you to type RETIRE)
        .\AFLDB-ISSUE-331-retire-wsl.ps1 -DryRun    (all gates, prints the unregister lines, changes nothing)
#>
param([switch]$DryRun)
$ErrorActionPreference = 'Stop'

#region constants
$lx       = 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Lxss'
$WslExe   = Join-Path $env:SystemRoot 'System32\wsl.exe'
$reh      = @{ Name='AFLDB-V2-Rehearsal-20261020';      Guid='{0cb6e2c4-5caa-4c0b-ba1e-25953010be02}'; Base='D:/afldb-v2-rehearsal-20261020' }
$exp      = @{ Name='AFLDB-V2-BrownlowExport-20261028'; Guid='{5d15f6f7-e202-48ea-883c-bd02b63bc84a}'; Base='\\?\C:\afldb-v2-brownlow-export-20261028' }
$expBases = @('C:\afldb-v2-brownlow-export-20261028', '\\?\C:\afldb-v2-brownlow-export-20261028')
$vhdx     = 'D:\afldb-v2-rehearsal-20261020\ext4.vhdx'
$baseDir  = 'D:\afldb-v2-rehearsal-20261020'
$vhdxLen  = 51433701376
$vhdxLw   = [datetime]::new(2026,11,3,12,59,20,[DateTimeKind]::Local)
$keep     = 'D:\afldb-retained\issue331-20261104'
$files    = @(
  @{ N='previous-reviewed.tar'; L=117606400; H='01305E34510AE60BBB3259542BF9B643185E440D54192D2A7435D6C620A5494B' },
  @{ N='v2-reviewed.tar';       L=207329280; H='60401CEC49F044D2EACC308DB8ADBF2523D44F0EA0D5376A5F07A6457E87EBB3' },
  @{ N='shortcut.ico';          L=5430;      H='E2FBBE078F5CECB21DAFA968CE3B4012F6F8C99752AAEDC1225100D6DF21293B' } )
$ConfirmRetire = { Read-Host 'Type RETIRE to proceed' }
#endregion constants

function Get-Reg {
  Get-ChildItem $lx | ForEach-Object {
    $p = Get-ItemProperty -LiteralPath $_.PSPath
    [pscustomobject]@{ Guid=$_.PSChildName; Name=$p.DistributionName; Base=$p.BasePath; State=$p.State; Version=$p.Version } }
}

function Assert-Registration($want) {
  $m = @(Get-Reg | Where-Object { $_.Name -eq $want.Name })
  if ($m.Count -ne 1)                  { throw "expected exactly one registration named $($want.Name), found $($m.Count)" }
  if ($m[0].Guid -ne $want.Guid)       { throw "$($want.Name): GUID $($m[0].Guid) is not $($want.Guid)" }
  if ($m[0].Base -ne $want.Base)       { throw "$($want.Name): BasePath '$($m[0].Base)' is not '$($want.Base)'" }
  if ($m[0].State -ne 1 -or $m[0].Version -ne 2) { throw "$($want.Name): State=$($m[0].State) Version=$($m[0].Version), expected 1 and 2" }
  "OK registration  $($want.Name)  $($want.Guid)  $($want.Base)"
}

# Names of running distributions, or a thrown error. Output is captured privately and never printed.
# Fails closed: a missing wsl.exe, a non-zero exit code, or anything that is not a plain list of names.
function Get-RunningDistros {
  if (-not (Test-Path -LiteralPath $WslExe)) { throw "wsl.exe not found at $WslExe; running state cannot be established" }
  $old = $null
  try { $old = [Console]::OutputEncoding; [Console]::OutputEncoding = [Text.Encoding]::Unicode } catch { $old = $null }
  try {
    $raw  = & $WslExe --list --running --quiet
    $code = $LASTEXITCODE
  } finally {
    if ($null -ne $old) { try { [Console]::OutputEncoding = $old } catch { } }
  }
  if ($code -ne 0) { throw "wsl.exe --list --running --quiet exited $code; running state cannot be established" }
  $names = @()
  foreach ($line in @($raw)) {
    $s = (([string]$line) -replace '[\u0000\uFEFF]', '').Trim()
    if ($s -eq '') { continue }
    if ($s -notmatch '^[A-Za-z0-9][A-Za-z0-9._-]*$') { throw "wsl.exe --list --running --quiet returned output that is not a plain list of distribution names; running state is ambiguous (output withheld)" }
    $names += $s
  }
  return $names
}

function Assert-NotRunning {
  $w = @(Get-Process wsl,wslhost -ErrorAction SilentlyContinue)
  if ($w.Count) { throw "wsl/wslhost process present: $(($w | ForEach-Object { "$($_.Name)#$($_.Id)" }) -join ', ')" }
  $running = @(Get-RunningDistros)
  $hit = @($running | Where-Object { $_ -ieq $reh.Name -or $_ -ieq $exp.Name })
  if ($hit.Count) { throw "a target distribution is running: $($hit -join ', ')" }
  "OK running state  neither target is running ($($running.Count) other distribution(s) running; names not shown)"
}

function Assert-Preserved {
  foreach ($f in $files) {
    $p = Join-Path $keep $f.N
    $i = Get-Item -LiteralPath $p -Force
    if ($i.Length -ne $f.L) { throw "$($f.N): length $($i.Length) is not $($f.L)" }
    $h = (Get-FileHash -LiteralPath $p -Algorithm SHA256).Hash
    if ($h -ne $f.H) { throw "$($f.N): SHA-256 $h does not match the recorded value" }
    if (Test-Path -LiteralPath (Join-Path $baseDir $f.N)) { throw "$($f.N) is still present in the base directory" }
  }
  "OK preserved  3 files in $keep match recorded length and SHA-256"
}

# Every gate, in one place. $ExpPresent: is the export registration still expected to exist?
# $Count: the expected total number of registrations. Run at start, after confirmation and before each unregister.
function Assert-Gates([string]$Label, [bool]$ExpPresent, [int]$Count) {
  "--- gates: $Label"
  $reg = @(Get-Reg)
  if ($reg.Count -ne $Count) { throw "registration count is $($reg.Count), expected $Count" }
  if ($ExpPresent) { Assert-Registration $exp }
  elseif (@($reg | Where-Object { $_.Name -eq $exp.Name -or $_.Guid -eq $exp.Guid }).Count) { throw "export registration is still present" }
  Assert-Registration $reh
  $def = (Get-ItemProperty $lx).DefaultDistribution
  if ($def -eq $reh.Guid -or $def -eq $exp.Guid) { throw "a target is the WSL default distribution" }
  foreach ($b in $expBases) { if (Test-Path -LiteralPath $b) { throw "export base directory exists: $b" } }
  "OK export base absent"
  $bd = Get-Item -LiteralPath $baseDir -Force
  if ($bd.Attributes -band [IO.FileAttributes]::ReparsePoint) { throw "base directory is a reparse point" }
  $vi = Get-Item -LiteralPath $vhdx -Force
  if ($vi.Attributes -band [IO.FileAttributes]::ReparsePoint) { throw "ext4.vhdx is a reparse point" }
  if ($vi.Length -ne $vhdxLen) { throw "ext4.vhdx length $($vi.Length) is not the pinned $vhdxLen" }
  if ([math]::Abs(($vi.LastWriteTime - $vhdxLw).TotalSeconds) -ge 1) { throw "ext4.vhdx last write $($vi.LastWriteTime) is not the pinned $vhdxLw" }
  $others = @(Get-ChildItem -LiteralPath $baseDir -Force | Where-Object { $_.Name -ne 'ext4.vhdx' })
  if ($others.Count) { throw "base directory holds other items: $(($others | ForEach-Object Name) -join ', ')" }
  "OK ext4.vhdx pinned identity  length=$($vi.Length)  lastWrite=$($vi.LastWriteTime)  sole item in base directory"
  Assert-Preserved
  Assert-NotRunning
}

function Show-State {
  try {
    "--- state snapshot (read-only)"
    $r = @(Get-Reg | Where-Object { $_.Name -in $reh.Name, $exp.Name })
    "export registration present:   $(@($r | Where-Object { $_.Name -eq $exp.Name }).Count -gt 0)"
    "original registration present: $(@($r | Where-Object { $_.Name -eq $reh.Name }).Count -gt 0)"
    "vhdx present: $(Test-Path -LiteralPath $vhdx)"
    if (Test-Path -LiteralPath $baseDir) { Get-ChildItem -LiteralPath $baseDir -Force | ForEach-Object { "base dir: $($_.Name) $($_.Length)" } }
  } catch { "state snapshot failed: $($_.Exception.Message)" }
}

$p1 = 'not run'
$p2 = 'not run'
try {
  $before = @(Get-Reg)
  "registrations present: $($before.Count)"
  Assert-Gates 'initial' $true $before.Count
  $freeBefore = (Get-Volume -DriveLetter D).SizeRemaining
  "D: free before: $freeBefore bytes"

  if (-not $DryRun) {
    "Irreversible: unregisters $($exp.Name) and $($reh.Name) and removes the accessible ext4.vhdx. Not a secure wipe."
    if ((& $ConfirmRetire) -cne 'RETIRE') { throw "not confirmed; nothing was run" }
    Assert-Gates 'after confirmation' $true $before.Count
  }

  "=== P-1  $($exp.Name) ==="
  Assert-Gates 'immediately before P-1' $true $before.Count
  if ($DryRun) { "DRY RUN: wsl.exe --unregister $($exp.Name)"; $p1 = 'dry run' }
  else {
    $p1 = 'attempted, outcome not confirmed'
    & $WslExe --unregister $exp.Name
    $c = $LASTEXITCODE
    if ($c -ne 0) { $p1 = "FAILED (exit $c)"; throw "wsl.exe --unregister $($exp.Name) exited $c; nothing further was run; no retry, no registry repair" }
    if (@(Get-Reg | Where-Object { $_.Name -eq $exp.Name }).Count) { $p1 = 'exit 0 but the registration is still present'; throw "$($exp.Name) is still registered after exit 0" }
    $p1 = 'succeeded'
    "OK P-1"
  }

  "=== P-2  $($reh.Name) ==="
  Assert-Gates 'immediately before P-2' $DryRun $(if ($DryRun) { $before.Count } else { $before.Count - 1 })
  if ($DryRun) { "DRY RUN: wsl.exe --unregister $($reh.Name)"; $p2 = 'dry run' }
  else {
    $p2 = 'attempted, outcome not confirmed'
    & $WslExe --unregister $reh.Name
    $c = $LASTEXITCODE
    if ($c -ne 0) { $p2 = "FAILED (exit $c)"; throw "wsl.exe --unregister $($reh.Name) exited $c; no retry, no registry repair, no deletion" }
    $p2 = 'exit 0'
  }

  "=== VERIFY ==="
  if ($DryRun) { "RESULT: DRY RUN complete, all gates passed; nothing was changed"; exit 0 }
  $after = @(Get-Reg)
  if (@($after | Where-Object { $_.Name -in $reh.Name, $exp.Name }).Count) { throw "a target is still registered" }
  if (Test-Path -LiteralPath "$lx\$($reh.Guid)") { throw "registry key $($reh.Guid) still exists" }
  if (Test-Path -LiteralPath "$lx\$($exp.Guid)") { throw "registry key $($exp.Guid) still exists" }
  $gone = @($before | Where-Object { $_.Guid -notin $after.Guid } | ForEach-Object Guid)
  if ($gone.Count -ne 2 -or @($gone | Where-Object { $_ -notin $reh.Guid, $exp.Guid }).Count) { throw "registrations removed are not exactly the two targets: $($gone -join ', ')" }
  "OK registry: both targets absent; registrations $($before.Count) -> $($after.Count); no other registration removed"
  if (Test-Path -LiteralPath $vhdx) { throw "ext4.vhdx still exists" }
  "OK ext4.vhdx absent"
  Assert-Preserved
  if (Test-Path -LiteralPath $baseDir) { "base directory remains (acceptable); contents: $((Get-ChildItem -LiteralPath $baseDir -Force | ForEach-Object Name) -join ', ')" } else { "base directory absent (acceptable)" }
  $freeAfter = (Get-Volume -DriveLetter D).SizeRemaining
  "D: free after: $freeAfter bytes (change $($freeAfter - $freeBefore); informational only, not a pass criterion)"
  $p2 = 'succeeded'
  "RESULT: RETIRED, all checks passed"
  exit 0
} catch {
  "STOPPED: $($_.Exception.Message)"
  "STATE: P-1 (export registration) = $p1 ; P-2 (original distribution) = $p2"
  if ($p1 -eq 'succeeded' -and $p2 -ne 'succeeded') { "PARTIAL: P-1 succeeded, so the export registration HAS been removed; the original distribution is NOT confirmed removed." }
  if ($p2 -like 'exit 0*' -or $p2 -eq 'succeeded') { "PARTIAL: the original's unregister returned exit 0 but a verification step failed; treat the retirement as unverified." }
  Show-State
  "RESULT: STOPPED (exit 1). Nothing further was run. No retry, no registry repair, no deletion. Paste this output."
  exit 1
}
