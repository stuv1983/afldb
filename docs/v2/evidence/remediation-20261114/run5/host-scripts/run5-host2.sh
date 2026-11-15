#!/usr/bin/env bash
# Run 5 third host batch: requalify awards-reload-links at the final executable revision, then the B1a rehearsal (which stops the cluster).
set -u
W=/mnt/ssd/afldb-rem5-t2-20261115
export NEW=f6af6da93551aed9dbd5658319346d7ecdd96ea3
cd "$W" && bash t2-qual.sh fetch static start pf_rb pf_sn sh_rb sh_sn
echo "=== b1a $(date -u +%T)"; bash "$W/b1a-rehearsal.sh"
ss -ltn | grep ":55684 " || echo "port 55684 closed (final)"
echo "=== HOST2-DONE $(date -u +%T)"
