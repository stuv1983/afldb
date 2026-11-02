#!/bin/bash
# Step A: read-only except one new mode-600 feed copy. Run as arm on afldb-prod.
set -u
R=ea98a35f20610e75c18e698bc0d9fe084c3c783d
CHK=/home/arm/projects/afldb
PKGROOT=/home/arm/blockc-pkg-${R:0:12}
PKGD=$PKGROOT/docs/v2/evidence/block-c-package-20261102
FEED=$PKGROOT/c4b-feed-2027.json
EVD=/home/arm/backups/afldb/c4b-ea98a35f-r1
echo "host=$(hostname) user=$(id -un) now=$(date -u +%FT%TZ)"
echo "HEAD=$(git -C $CHK rev-parse HEAD)"
echo "porcelain_lines=$(git -C $CHK status --porcelain | wc -l)"
echo "--- package"
ls -ld "$PKGROOT" "$PKGD" 2>&1
sha256sum "$PKGD/c-prod.sh" 2>&1
echo "--- feed"
if [ -e "$FEED" ]; then echo "FEED ALREADY EXISTS"; ls -l "$FEED"; else
  ( umask 077; git -C $CHK show $R:tests/fixtures/afl_api/seasons/01-season-matches-2027.raw.json > "$FEED" )
  chmod 600 "$FEED"; ls -l "$FEED"
fi
sha256sum "$FEED"
echo "--- evidence parent"
ls -ld /home/arm/backups/afldb; [ -w /home/arm/backups/afldb ] && echo parent_writable=yes || echo parent_writable=NO
[ -e "$EVD" ] && echo "EVIDENCE DIR EXISTS (BAD)" || echo "evidence_dir_absent=yes"
df -h /home/arm/backups/afldb /tmp /home/arm/projects/afldb | cat
echo "--- app"
systemctl show afldb.service -p MainPID -p NRestarts -p ActiveState -p SubState | cat
echo "--- units"
for u in afldb-settle-afl-api.service afldb-settle-afl-api-brownlow.service; do echo "$u active=$(systemctl is-active $u) enabled=$(systemctl is-enabled $u 2>&1)"; done
for u in afldb-settle-afl-api.timer afldb-settle-afl-api-brownlow.timer; do echo "$u active=$(systemctl is-active $u) enabled=$(systemctl is-enabled $u 2>&1)"; done
systemctl list-unit-files 'afldb*' --no-legend | cat
echo "--- tmux"; command -v tmux; tmux ls 2>&1 | head
