#!/usr/bin/env bash
# run-4 leaks scope: per-file mode (AFLDB_TEST_PER_FILE_DB=all) audit of chosen files, using run2/tests363/run-integration-per-file.sh.
#   bash $IN/leaks-pf.sh <tag> <template db> <checkout> <files...>
# Each file gets its own database (a copy of $BASE, never modified); AUDIT appends one JSON line per file (residue vs the base).
set -u -o pipefail
source "$(dirname "$0")/leaks-lib.sh"
TAG=$1; TMPL=$2; CO=$3; shift 3
BASE=afldb_v2_rem4leaks_pf${TAG}_test
MK=$(mkcopy "$BASE" "$TMPL"); echo "$MK"; case "$MK" in *refused*|*rror*) echo "base copy not created: stopping"; exit 1;; esac
AUD=$E/pf-$TAG-audit.jsonl; : > "$AUD"
CAND=$CO BASE=$BASE MODE=all AUDIT=$AUD bash "$CO/docs/v2/evidence/remediation-20261114/run2/tests363/run-integration-per-file.sh" "$@" --reporter=default > "$E/pf-$TAG.log" 2>&1
echo "pf $TAG rc=$?"
sed 's/\x1b\[[0-9;]*m//g' "$E/pf-$TAG.log" | grep -a -E "Test Files|Tests " | tail -3
echo "per-file DBs left: $(IR list 2>/dev/null | grep -c "_pf_" || true)"
