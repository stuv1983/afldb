# ISSUE-336 DEV deploy 2026-11-07, steps 0 and 1 (read-only). Prints STEP01-OK or STOP-*.
set -u
cd ~/projects/afldb
echo "now $(date '+%F %T %Z')"
A=$(systemctl is-active afldb-settle-afl-api.service afldb-settle-afl-api-brownlow.service | tr '\n' ' ')
echo "step0 services: $A"
[ "$A" = "inactive inactive " ] || { echo "STOP-step0 (re-check if activating)"; exit 1; }
H=$(git rev-parse HEAD); B=$(git branch --show-current); S=$(git stash list | wc -l); U=$(git status --porcelain | wc -l)
E=$(sha256sum .env | cut -d' ' -f1); B1=$(cat .next/BUILD_ID); B2=$(cat .next/standalone/.next/BUILD_ID)
P=$(systemctl show afldb -p MainPID --value)
TE=$(systemctl is-enabled afldb-settle-afl-api.timer afldb-settle-afl-api-brownlow.timer | tr '\n' ' ')
TA=$(systemctl is-active afldb-settle-afl-api.timer afldb-settle-afl-api-brownlow.timer | tr '\n' ' ')
echo "HEAD $H"; echo "branch $B"; echo "stashes $S"; echo "untracked/changed $U"; echo ".env sha256 $E"
echo "BUILD_ID $B1 / standalone $B2"; echo "MainPID $P children $(pgrep -P "$P" | wc -l)"
echo "timers enabled: $TE active: $TA"
systemctl list-timers afldb-settle-afl-api.timer afldb-settle-afl-api-brownlow.timer --no-pager | head -3
echo "unit definitions sha256 (systemctl cat):"
for u in afldb.service afldb-settle-afl-api.service afldb-settle-afl-api.timer afldb-settle-afl-api-brownlow.service afldb-settle-afl-api-brownlow.timer; do
  echo "  $u $(systemctl cat "$u" 2>/dev/null | sha256sum | cut -c1-16)"
done
git status --porcelain
bad=0
[ "$H" = 242fa276b7b0fcb2613918984e82791faa1143d6 ] || { echo "DIFF HEAD"; bad=1; }
[ "$B" = main ] || { echo "DIFF branch"; bad=1; }
[ "$S" = 2 ] || { echo "DIFF stashes"; bad=1; }
[ "$U" = 10 ] || { echo "DIFF untracked"; bad=1; }
[ "$B1" = 8sFpWkolwF1yKuKbFkOir ] && [ "$B2" = 8sFpWkolwF1yKuKbFkOir ] || { echo "DIFF BUILD_ID"; bad=1; }
[ "$TE" = "enabled enabled " ] || { echo "DIFF timers enabled"; bad=1; }
[ -z "$(git branch --list dev/v2-main)" ] || { echo "DIFF dev/v2-main already exists"; bad=1; }
[ $bad = 0 ] && echo STEP01-OK || echo STOP-step1
