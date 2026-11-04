:
{
# Runs the ISSUE-333 second (-r2) beta visibility probe inside the production host (owner-authorised temporary beta-admission cookie, kind=beta only,
# one token, TTL 6 minutes, /clubs/port-adelaide only, at most 10 public GETs). The signing secret and token exist only in the node process's memory;
# this wrapper passes only the main pid and an output path.
set -u -o pipefail
export LC_ALL=C
umask 077
OPS=/home/arm/ops/issue333-o2-50ed6e4f
[ "$(hostname)" = afldb-prod ] && [ "$(id -un)" = arm ] || { echo "STOP: unexpected host/user"; exit 3; }
export PATH=/home/arm/.nvm/versions/node/v22.23.2/bin:$PATH
MP=$(systemctl show -p MainPID --value afldb.service)
echo "main pid $MP; $(date -u +%FT%TZ)"
OUT=${1:?out.json}
[ -e "$OUT" ] && { echo "STOP: output exists"; exit 3; }
cd "$OPS/cand" || exit 3
[ -e visibility-beta-probe-r2.mts ] || [ -e coach-row-selector.mts ] && { echo "STOP: leftover probe files"; exit 3; }
cp "$OPS/in/visibility-beta-probe-r2.mts" visibility-beta-probe-r2.mts
cp "$OPS/in/coach-row-selector.mts" coach-row-selector.mts
node --import tsx --conditions=react-server visibility-beta-probe-r2.mts "$MP" "$OUT"; RC=$?
rm -f visibility-beta-probe-r2.mts coach-row-selector.mts
echo "probe exit $RC; ops checkout status lines: $(git status --porcelain | wc -l); $(date -u +%FT%TZ)"
exit $RC
}
