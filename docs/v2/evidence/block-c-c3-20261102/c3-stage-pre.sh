#!/bin/bash
# C3 step 0 + 1 (read-only apart from the one mode-700 staging dir if absent). Run as arm on afldb-prod.
set -u -o pipefail
R=ea98a35f20610e75c18e698bc0d9fe084c3c783d
PKG=docs/v2/evidence/block-c-package-20261102
STG=/home/arm/blockc-pkg-${R:0:12}
PKGD=$STG/$PKG
CHK=/home/arm/projects/afldb
echo "host=$(hostname) user=$(id -un) now=$(date -u +%FT%TZ)"
echo "HEAD=$(git -C $CHK rev-parse HEAD)"
echo "porcelain lines=$(git -C $CHK status --porcelain | wc -l)"
echo "R is ancestor of origin/main: $(git -C $CHK merge-base --is-ancestor $R origin/main && echo yes || echo no)"
if [ -e "$STG" ]; then
  echo "STAGING EXISTS (preserved, verifying only): $STG"
else
  echo "staging absent: creating"
  ( set -euo pipefail; mkdir -m 700 "$STG"; git -C "$CHK" archive "$R" "$PKG" | tar -x -C "$STG" ) || { echo "STOP: staging failed"; exit 11; }
fi
echo "-- package vs R git objects"
rc=0
for f in c-prod.sh c-selftest.sh; do
  a=$(sha256sum < "$PKGD/$f" | cut -c1-64); b=$(git -C $CHK show "$R:$PKG/$f" | sha256sum | cut -c1-64)
  [ "$a" = "$b" ] && echo "OK  $f $a" || { echo "DIFF $f staged=$a git=$b"; rc=1; }
done
echo "staging file list:"; ( cd $STG && find . -type f | sort )
echo "-- six deploy files at R (git object) vs checkout"
for f in afldb-settle-afl-api.service afldb-settle-afl-api.timer afldb-settle-afl-api-brownlow.service afldb-settle-afl-api-brownlow.timer afldb-settle-afl-api.sh afldb-settle-afl-api-brownlow.sh; do
  g=$(git -C $CHK show "$R:deploy/$f" | sha256sum | cut -c1-64); w=$(sha256sum < $CHK/deploy/$f | cut -c1-64)
  [ "$g" = "$w" ] && echo "OK  $f git=checkout $g" || { echo "DIFF $f git=$g checkout=$w"; rc=1; }
done
[ $rc = 0 ] || { echo "STOP: package/hash verification failed"; exit 12; }
echo "-- c3-pre"
bash "$PKGD/c-prod.sh" c3-pre "$R"; pre=$?
echo "c3-pre exit=$pre"
echo "-- before-state"
echo "afldb.service MainPID before: $(systemctl show -p MainPID --value afldb.service)  NRestarts=$(systemctl show -p NRestarts --value afldb.service)  ActiveEnterTimestamp=$(systemctl show -p ActiveEnterTimestamp --value afldb.service)"
echo "list-unit-files afldb-settle-afl-api*:"; systemctl list-unit-files 'afldb-settle-afl-api*' --no-pager
echo "etc/systemd/system matches: $(ls -la /etc/systemd/system/ | grep -c 'afldb-settle-afl-api' || true)"
echo "timers.target.wants afl-api matches: $(ls -la /etc/systemd/system/timers.target.wants/ 2>/dev/null | grep -c 'afl-api' || true)"
echo "list-timers afl-api matches: $(systemctl list-timers --all --no-pager | grep -c 'afldb-settle-afl-api' || true)"
echo "trigger variable lines in .env (count only): $(grep -c '^AFLDB_SETTLE_TRIGGER' "$CHK/.env" || true)"
echo "acquisition: see c3-pre setting line above"
exit $pre
