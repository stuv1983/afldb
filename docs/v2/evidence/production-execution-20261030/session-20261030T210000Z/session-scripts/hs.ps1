# Runs one pinned host-session.sh stage over `ssh afldb bash -s` (byte-exact via cmd redirection) into the session
# log folder, refusing to overwrite a log, and prints the log.
param([Parameter(Mandatory = $true)][string]$Stage, [string[]]$Rest = @(), [string]$Tag = '')
$ErrorActionPreference = 'Stop'
$STAMP = '20261030T210000Z'
$pkg = 'D:\dev\afldbV2\docs\v2\evidence\production-execution-20261030'
$logs = "C:\Users\stuar\backups\afldb\exec-$STAMP"
if ((Get-FileHash -Algorithm SHA256 "$pkg\host-session.sh").Hash.ToLower() -ne '0fe897f856c039a33a3c178c57af789c58001681b50eea75316e8e27597b2067') { throw 'STOP: host-session.sh differs from the approved pin' }
$log = Join-Path $logs ("hs-$Stage" + $(if ($Tag) { "-$Tag" } else { '' }) + '.log')
if (Test-Path -LiteralPath $log) { throw "STOP: $log exists" }
$args2 = (@($Stage, $STAMP) + $Rest) -join ' '
"[$((Get-Date).ToString('HH:mm:ss')) AEDT] host-session.sh $args2"
cmd /c "ssh -o BatchMode=yes afldb bash -s -- $args2 < `"$pkg\host-session.sh`" > `"$log`" 2>&1"
$x = $LASTEXITCODE
Get-Content -LiteralPath $log
"[$((Get-Date).ToString('HH:mm:ss')) AEDT] exit=$x log=$log"
exit $x
