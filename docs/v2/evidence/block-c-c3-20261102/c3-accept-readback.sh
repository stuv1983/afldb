#!/bin/bash
# C3 step 3: read-only acceptance + independent read-backs. Run as arm on afldb-prod. No sudo.
set -u -o pipefail
R=ea98a35f20610e75c18e698bc0d9fe084c3c783d
PKGD=/home/arm/blockc-pkg-${R:0:12}/docs/v2/evidence/block-c-package-20261102
CHK=/home/arm/projects/afldb
echo "host=$(hostname) user=$(id -un) now=$(date -u +%FT%TZ)"
echo "staged c-prod.sh sha256 vs R: $(sha256sum < $PKGD/c-prod.sh | cut -c1-64) / $(git -C $CHK show $R:docs/v2/evidence/block-c-package-20261102/c-prod.sh | sha256sum | cut -c1-64)"
echo "== c3-accept"
bash "$PKGD/c-prod.sh" c3-accept "$R"; acc=$?
echo "c3-accept exit=$acc"
echo "== independent read-backs"
for u in afldb-settle-afl-api.service afldb-settle-afl-api-brownlow.service; do printf '%s load=%s active=%s sub=%s\n' "$u" "$(systemctl show -p LoadState --value $u)" "$(systemctl is-active $u)" "$(systemctl show -p SubState --value $u)"; done
for u in afldb-settle-afl-api.timer afldb-settle-afl-api-brownlow.timer; do printf '%s load=%s enabled=%s active=%s next=[%s] nextmono=[%s]\n' "$u" "$(systemctl show -p LoadState --value $u)" "$(systemctl is-enabled $u)" "$(systemctl is-active $u)" "$(systemctl show -p NextElapseUSecRealtime --value $u)" "$(systemctl show -p NextElapseUSecMonotonic --value $u)"; done
echo "list-timers afl-api matches: $(systemctl list-timers --all --no-pager | grep -c 'afldb-settle-afl-api' || true)"
echo "timers.target.wants afl-api matches: $(ls -la /etc/systemd/system/timers.target.wants/ 2>/dev/null | grep -c 'afl-api' || true)"
echo "any wants/requires symlinks to the units anywhere under /etc/systemd/system: $(find /etc/systemd/system -type l -name 'afldb-settle-afl-api*' | wc -l)"
for f in afldb-settle-afl-api.service afldb-settle-afl-api.timer afldb-settle-afl-api-brownlow.service afldb-settle-afl-api-brownlow.timer; do
  if cmp "/etc/systemd/system/$f" "$CHK/deploy/$f"; then echo "cmp OK $f installed == checkout"; else echo "cmp DIFF $f"; fi
  echo "   git-object==installed: $( [ "$(git -C $CHK show $R:deploy/$f | sha256sum | cut -c1-64)" = "$(sha256sum < /etc/systemd/system/$f | cut -c1-64)" ] && echo yes || echo NO )"
done
echo "afldb.service MainPID after: $(systemctl show -p MainPID --value afldb.service)  NRestarts=$(systemctl show -p NRestarts --value afldb.service)  ActiveEnterTimestamp=$(systemctl show -p ActiveEnterTimestamp --value afldb.service)  ActiveState=$(systemctl is-active afldb.service)"
echo "trigger variable lines in .env (count only): $(grep -c '^AFLDB_SETTLE_TRIGGER' "$CHK/.env" || true)"
echo "HEAD=$(git -C $CHK rev-parse HEAD) porcelain lines=$(git -C $CHK status --porcelain | wc -l)"
echo "afltables timer: enabled=$(systemctl is-enabled afldb-settle-afltables.timer) active=$(systemctl is-active afldb-settle-afltables.timer)"
echo "failed afl-api units: $(systemctl list-units --all --state=failed --no-pager 'afldb-settle-afl-api*' | grep -c 'afldb-settle-afl-api' || true)"
exit $acc
