:
{
# Runs the ISSUE-333 beta visibility probe inside the production host (owner-authorised temporary beta-admission cookie, kind=beta only).
# The signing secret and token exist only in the node process's memory; this wrapper passes only the main pid, the worker pids and an output path.
set -u -o pipefail
export LC_ALL=C
umask 077
OPS=/home/arm/ops/issue333-o2-50ed6e4f
[ "$(hostname)" = afldb-prod ] && [ "$(id -un)" = arm ] || { echo "STOP: unexpected host/user"; exit 3; }
export PATH=/home/arm/.nvm/versions/node/v22.23.2/bin:$PATH
MP=$(systemctl show -p MainPID --value afldb.service)
WP=$(ps -o pid= --ppid "$MP" | tr -d ' ' | paste -sd, -)
echo "main pid $MP; worker pids $WP; $(date -u +%FT%TZ)"
[ "$(tr ',' '\n' <<<"$WP" | wc -l)" = 2 ] || { echo "STOP: expected exactly two workers"; exit 3; }
OUT=${1:?out.json}
cd "$OPS/cand" || exit 3
[ -e .visibility-probe.mts ] && { echo "STOP: leftover probe file"; exit 3; }
cp "$OPS/in/visibility-beta-probe.mts" .visibility-probe.mts
node --import tsx --conditions=react-server .visibility-probe.mts "$MP" observe "$OUT" "$WP"; RC=$?
rm -f .visibility-probe.mts
echo "probe exit $RC; ops checkout status lines: $(git status --porcelain | wc -l); $(date -u +%FT%TZ)"
exit $RC
}
