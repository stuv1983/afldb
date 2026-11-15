#!/usr/bin/env bash
set -u
. /mnt/ssd/afldb-rem4-qual-20261115/in/common.sh
echo "== databases in the cluster (name, size)"; IR list 2>&1 | strip | cut -c1-200
echo "== per-file databases remaining (afldb_v2_pf_*): $(IR list 2>/dev/null | grep -c 'afldb_v2_pf_' || true)"
echo "== code_test_db present: $(IR list 2>/dev/null | grep -c 'code_test_db' || true)"
