<#
Mocked-native tests for AFLDB-ISSUE-331-retire-wsl.ps1. MOCKS ONLY: it never runs the real wsl.exe.

How: the production script text is run unchanged except for the block between "#region constants" and
"#endregion constants", which is replaced so that
  - $WslExe is a compiled FAKE wsl.exe in $Work (it logs every call; its behaviour comes from FAKE_* env vars),
  - the registry root is a scratch key HKCU:\Software\AFLDB-Test-331\Lxss (removed at the end),
  - the VHDX, base directory and preserved files are small scratch files under $Work,
  - the RETIRE confirmation comes from $env:FAKE_CONFIRM.
The harness asserts that everything outside that block is byte-identical to the production script.
Nothing real is unregistered, started, moved, hashed or deleted.

Usage:  .\AFLDB-ISSUE-331-retire-wsl.tests.ps1 -Script <path to the .ps1> -Work <empty scratch dir>
#>
param([Parameter(Mandatory)][string]$Script, [Parameter(Mandatory)][string]$Work)
$ErrorActionPreference = 'Stop'
if (Test-Path -LiteralPath $Work) { throw "Work directory must not exist yet: $Work" }
New-Item -ItemType Directory -Path $Work | Out-Null
$Work = (Resolve-Path -LiteralPath $Work).Path
$fakeDir = Join-Path $Work 'fake'; New-Item -ItemType Directory -Path $fakeDir | Out-Null
$fakeExe = Join-Path $fakeDir 'wsl.exe'
$lxRel   = 'Software\AFLDB-Test-331\Lxss'
$lxPs    = "HKCU:\$lxRel"
$rehN = 'AFLDB-V2-Rehearsal-20261020';      $rehG = '{0cb6e2c4-5caa-4c0b-ba1e-25953010be02}'
$expN = 'AFLDB-V2-BrownlowExport-20261028'; $expG = '{5d15f6f7-e202-48ea-883c-bd02b63bc84a}'

Add-Type -OutputAssembly $fakeExe -OutputType ConsoleApplication -TypeDefinition @'
using System; using System.IO; using System.Text; using Microsoft.Win32;
public static class FakeWsl {
  static string E(string k) { return Environment.GetEnvironmentVariable(k) ?? ""; }
  static void Log(string s) { File.AppendAllText(E("FAKE_WSL_LOG"), s + "\n"); }
  static int Next(string key) { string p = E("FAKE_WSL_LOG") + "." + key; int n = 0; if (File.Exists(p)) n = int.Parse(File.ReadAllText(p)); n++; File.WriteAllText(p, n.ToString()); return n; }
  static void Out(string s) { byte[] b = Encoding.Unicode.GetBytes(s); Stream o = Console.OpenStandardOutput(); o.Write(b, 0, b.Length); o.Flush(); }
  static void Mutate(string m) {
    if (m == "reh-base") { using (RegistryKey k = Registry.CurrentUser.OpenSubKey(E("FAKE_LXSS") + "\\{0cb6e2c4-5caa-4c0b-ba1e-25953010be02}", true)) { k.SetValue("BasePath", "D:/somewhere-else"); } }
    else if (m == "vhdx-len") { File.AppendAllText(E("FAKE_VHDX"), "x"); }
    else if (m == "extra-file") { File.WriteAllText(Path.Combine(Path.GetDirectoryName(E("FAKE_VHDX")), "extra.txt"), "x"); }
  }
  static void RemoveByName(string name) {
    using (RegistryKey r = Registry.CurrentUser.OpenSubKey(E("FAKE_LXSS"), true)) {
      foreach (string sk in r.GetSubKeyNames()) {
        string dn; using (RegistryKey k = r.OpenSubKey(sk)) { dn = (string)k.GetValue("DistributionName"); }
        if (dn == name) r.DeleteSubKeyTree(sk);
      }
    }
  }
  public static int Main(string[] a) {
    string cmd = string.Join(" ", a); Log(cmd);
    if (cmd == "--list --running --quiet") {
      int n = Next("list");
      if (E("FAKE_MUTATE_AT_LIST") == n.ToString()) Mutate(E("FAKE_MUTATE"));
      Out(E("FAKE_LIST_OUT"));
      int ex = 0; int.TryParse(E("FAKE_LIST_EXIT"), out ex);
      if (ex != 0) Console.Error.WriteLine("simulated list failure");
      return ex;
    }
    if (a.Length == 2 && a[0] == "--unregister") {
      string name = a[1];
      if (E("FAKE_UNREG_FAIL") == name) { Console.Error.WriteLine("simulated unregister failure"); return 1; }
      RemoveByName(name);
      if (name == "AFLDB-V2-Rehearsal-20261020") File.Delete(E("FAKE_VHDX"));
      else if (E("FAKE_MUTATE_AFTER_EXP") != "") Mutate(E("FAKE_MUTATE_AFTER_EXP"));
      Console.WriteLine("Unregistering.");
      return 0;
    }
    return 99;
  }
}
'@

# --- test copy of the script: only the constants block differs
$src = [IO.File]::ReadAllText($Script)
$rx  = '(?s)#region constants.*?#endregion constants'
if (-not [regex]::IsMatch($src, $rx)) { throw 'constants region not found' }
$baseDir = Join-Path $Work 'base'; $vhdx = Join-Path $baseDir 'ext4.vhdx'; $keep = Join-Path $Work 'keep'
$content = @{ 'previous-reviewed.tar'='alpha-content'; 'v2-reviewed.tar'='bravo-content-longer'; 'shortcut.ico'='ico' }
$fileLines = foreach ($n in $content.Keys) {
  $b = [Text.Encoding]::ASCII.GetBytes($content[$n]); $sha = [Security.Cryptography.SHA256]::Create()
  $h = ([BitConverter]::ToString($sha.ComputeHash($b)) -replace '-','')
  "  @{ N='$n'; L=$($b.Length); H='$h' }"
}
$region = @"
#region constants
`$lx       = '$lxPs'
`$WslExe   = '$fakeExe'
`$reh      = @{ Name='$rehN'; Guid='$rehG'; Base='D:/afldb-v2-rehearsal-20261020' }
`$exp      = @{ Name='$expN'; Guid='$expG'; Base='\\?\C:\afldb-v2-brownlow-export-20261028' }
`$expBases = @('$Work\no-such-export-base')
`$vhdx     = '$vhdx'
`$baseDir  = '$baseDir'
`$vhdxLen  = 1000
`$vhdxLw   = [datetime]::new(2026,11,3,12,59,20,[DateTimeKind]::Local)
`$keep     = '$keep'
`$files    = @(
$($fileLines -join ",`n")
)
`$ConfirmRetire = { `$env:FAKE_CONFIRM }
#endregion constants
"@
$copy = Join-Path $Work 'script-under-test.ps1'
[IO.File]::WriteAllText($copy, [regex]::Replace($src, $rx, { param($m) $region }))
$outsideA = [regex]::Replace($src, $rx, 'X'); $outsideB = [regex]::Replace([IO.File]::ReadAllText($copy), $rx, 'X')
if ($outsideA -ne $outsideB) { throw 'test copy differs from production outside the constants region' }
'OK test copy identical to production outside the constants region'

$log = Join-Path $Work 'wsl.log'
$results = New-Object System.Collections.Generic.List[object]

function Reset-Fixture {
  foreach ($d in @($baseDir, $keep)) { if (Test-Path -LiteralPath $d) { Remove-Item -LiteralPath $d -Recurse -Force }; New-Item -ItemType Directory -Path $d | Out-Null }
  [IO.File]::WriteAllBytes($vhdx, (New-Object byte[] 1000))
  (Get-Item -LiteralPath $vhdx).LastWriteTime = [datetime]::new(2026,11,3,12,59,20,[DateTimeKind]::Local)
  foreach ($n in $content.Keys) { [IO.File]::WriteAllBytes((Join-Path $keep $n), [Text.Encoding]::ASCII.GetBytes($content[$n])) }
  if (Test-Path $lxPs) { Remove-Item $lxPs -Recurse -Force }
  New-Item $lxPs -Force | Out-Null
  $regs = @( @($rehG,$rehN,'D:/afldb-v2-rehearsal-20261020'), @($expG,$expN,'\\?\C:\afldb-v2-brownlow-export-20261028'), @('{11111111-2222-3333-4444-555555555555}','Unrelated-Test-Distro','C:/unrelated') )
  foreach ($r in $regs) {
    $k = "$lxPs\$($r[0])"; New-Item $k | Out-Null
    New-ItemProperty $k -Name DistributionName -Value $r[1] -PropertyType String | Out-Null
    New-ItemProperty $k -Name BasePath -Value $r[2] -PropertyType String | Out-Null
    New-ItemProperty $k -Name State -Value 1 -PropertyType DWord | Out-Null
    New-ItemProperty $k -Name Version -Value 2 -PropertyType DWord | Out-Null
  }
  Get-ChildItem "$log*" -ErrorAction SilentlyContinue | Remove-Item -Force
  Get-ChildItem Env:FAKE_* | ForEach-Object { Remove-Item "Env:$($_.Name)" }
  $env:FAKE_WSL_LOG = $log; $env:FAKE_LXSS = $lxRel; $env:FAKE_VHDX = $vhdx; $env:FAKE_CONFIRM = 'RETIRE'
}

function Invoke-Case([string]$Name, [hashtable]$EnvVars, [string[]]$ScriptArgs, [int]$WantExit, [int]$WantUnreg, [string[]]$Must, [string[]]$MustNot, [scriptblock]$Extra) {
  Reset-Fixture
  foreach ($k in $EnvVars.Keys) { Set-Item "Env:$k" $EnvVars[$k] }
  $o = Join-Path $Work 'out.txt'; $e = Join-Path $Work 'err.txt'
  $a = @('-NoProfile','-ExecutionPolicy','Bypass','-File',$copy) + $ScriptArgs
  $p = Start-Process powershell.exe -ArgumentList $a -Wait -PassThru -NoNewWindow -RedirectStandardOutput $o -RedirectStandardError $e
  $out = (Get-Content -LiteralPath $o -Raw) + (Get-Content -LiteralPath $e -Raw)
  $calls = if (Test-Path $log) { @(Get-Content $log) } else { @() }
  $fail = @()
  if ($p.ExitCode -ne $WantExit) { $fail += "exit $($p.ExitCode), wanted $WantExit" }
  $unreg = @($calls | Where-Object { $_ -like '--unregister *' })
  if ($unreg.Count -ne $WantUnreg) { $fail += "unregister calls $($unreg.Count), wanted $WantUnreg" }
  $bad = @($calls | Where-Object { $_ -ne '--list --running --quiet' -and $_ -notlike '--unregister *' })
  if ($bad.Count) { $fail += "unexpected native call(s): $($bad -join ' | ')" }
  foreach ($u in $unreg) { if ($u -notin "--unregister $expN","--unregister $rehN") { $fail += "unregister of non-target: $u" } }
  foreach ($s in $Must)    { if ($out -notlike "*$s*") { $fail += "output lacks: $s" } }
  foreach ($s in $MustNot) { if ($out -like "*$s*")    { $fail += "output must not contain: $s" } }
  if ($Extra) { $fail += @(& $Extra $unreg) }
  $results.Add([pscustomobject]@{ Case=$Name; Pass=($fail.Count -eq 0); Exit=$p.ExitCode; Unreg=$unreg.Count; Notes=($fail -join '; ') })
}
function Reg-Names { @(Get-ChildItem $lxPs | ForEach-Object { (Get-ItemProperty -LiteralPath $_.PSPath).DistributionName }) }

$none = ''
Invoke-Case 'A  success, nothing running'         @{ FAKE_LIST_OUT=$none } @() 0 2 @('RETIRED, all checks passed','OK P-1') @() {
  param($u) $f=@(); if ($u[0] -ne "--unregister $expN" -or $u[1] -ne "--unregister $rehN") { $f += 'order wrong' }
  if ((Reg-Names) -join ',' -ne 'Unrelated-Test-Distro') { $f += "registry left: $((Reg-Names) -join ',')" }
  if (@(Get-Content $log | Where-Object { $_ -eq '--list --running --quiet' }).Count -ne 4) { $f += 'expected 4 running-state queries (start, after confirm, before P-1, before P-2)' }; $f }
Invoke-Case 'B  dry run'                          @{ FAKE_LIST_OUT=$none } @('-DryRun') 0 0 @('DRY RUN complete') @()
Invoke-Case 'C1 original running (+ unrelated)'   @{ FAKE_LIST_OUT="other-distro`r`n$rehN`r`n" } @() 1 0 @('a target distribution is running') @('other-distro','RETIRED')
Invoke-Case 'C2 export running'                   @{ FAKE_LIST_OUT="$expN`r`n" } @() 1 0 @('a target distribution is running') @('RETIRED')
Invoke-Case 'C3 original running, other case'     @{ FAKE_LIST_OUT="$($rehN.ToLower())`r`n" } @() 1 0 @('a target distribution is running') @('RETIRED')
Invoke-Case 'D  unrelated distro running only'    @{ FAKE_LIST_OUT="Unrelated-Test-Distro`r`nother-distro`r`n" } @() 0 2 @('RETIRED, all checks passed','names not shown') @('Unrelated-Test-Distro','other-distro')
Invoke-Case 'E  query failure (exit 5)'           @{ FAKE_LIST_OUT=$none; FAKE_LIST_EXIT='5' } @() 1 0 @('exited 5') @('RETIRED')
Invoke-Case 'F1 malformed: prose message'         @{ FAKE_LIST_OUT="There are no running distributions.`r`n" } @() 1 0 @('ambiguous') @('There are no running','RETIRED')
Invoke-Case 'F2 malformed: junk characters'       @{ FAKE_LIST_OUT="###`r`n" } @() 1 0 @('ambiguous') @('###','RETIRED')
Invoke-Case 'G1 identity changed after confirm (registry)' @{ FAKE_LIST_OUT=$none; FAKE_MUTATE='reh-base'; FAKE_MUTATE_AT_LIST='2' } @() 1 0 @("BasePath") @('RETIRED')
Invoke-Case 'G2 VHDX length changed after confirm'         @{ FAKE_LIST_OUT=$none; FAKE_MUTATE='vhdx-len'; FAKE_MUTATE_AT_LIST='2' } @() 1 0 @('pinned') @('RETIRED')
Invoke-Case 'H  P-1 fails'                        @{ FAKE_LIST_OUT=$none; FAKE_UNREG_FAIL=$expN } @() 1 1 @('P-1 (export registration) = FAILED (exit 1)','P-2 (original distribution) = not run','export registration present:   True') @('RETIRED','PARTIAL')
Invoke-Case 'I  P-2 fails after P-1 succeeded'    @{ FAKE_LIST_OUT=$none; FAKE_UNREG_FAIL=$rehN } @() 1 2 @('P-1 (export registration) = succeeded','P-2 (original distribution) = FAILED (exit 1)','PARTIAL: P-1 succeeded','export registration present:   False','original registration present: True') @('RETIRED, all')
Invoke-Case 'J  extra file appears after P-1'     @{ FAKE_LIST_OUT=$none; FAKE_MUTATE_AFTER_EXP='extra-file' } @() 1 1 @('PARTIAL: P-1 succeeded','base directory holds other items','P-2 (original distribution) = not run') @('RETIRED, all')
Invoke-Case 'L  VHDX length changes after P-1'    @{ FAKE_LIST_OUT=$none; FAKE_MUTATE_AFTER_EXP='vhdx-len' } @() 1 1 @('PARTIAL: P-1 succeeded','pinned','P-2 (original distribution) = not run') @('RETIRED, all')
Invoke-Case 'K  confirmation declined'            @{ FAKE_LIST_OUT=$none; FAKE_CONFIRM='no' } @() 1 0 @('not confirmed') @('RETIRED')

Remove-Item "HKCU:\Software\AFLDB-Test-331" -Recurse -Force -ErrorAction SilentlyContinue
$results | Format-Table Case,Pass,Exit,Unreg,Notes -AutoSize | Out-String -Width 250
$failed = @($results | Where-Object { -not $_.Pass }).Count
"TOTAL $($results.Count)  PASSED $($results.Count - $failed)  FAILED $failed"
if ($failed) { exit 1 } else { exit 0 }
