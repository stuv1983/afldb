#!/usr/bin/env bash
# ISSUE-351: r6-revalidate-accept.sh must pass only on exit 0 with two distinct worker ordinals. Stub CLIs; no production contact.
# Usage: bash t-352-revalidate-accept.sh <source root>
set -uo pipefail
ROOT=${1:?source root}; S=$ROOT/docs/v2/evidence/backlog-20261121/r6-20261125/r6-revalidate-accept.sh
W=$(mktemp -d "${TMPDIR:-/tmp}/afldb-fix351-XXXXXX"); trap 'rm -rf -- "$W"' EXIT
pass=0; fails=0
stub() { printf '#!/bin/sh\n%s\nexit %s\n' "$1" "$2" > "$W/stub"; chmod +x "$W/stub"; }
run() { R6_CHECKOUT=$W R6_REVALIDATE_CMD="$W/stub" bash "$S" "$@"; }
expect() { local want=$1 name=$2 rc=0; shift 2; "$@" > "$W/result" 2>&1 || rc=$?; cat "$W/result"; echo "$name actual_exit=$rc expected=$want"
  if [ "$rc" = "$want" ]; then pass=$((pass+1)); else fails=$((fails+1)); echo "***** FAIL $name"; fi; }
has() { if grep -qF -- "$1" "$W/result"; then pass=$((pass+1)); else fails=$((fails+1)); echo "***** FAIL missing output: $1"; fi; }
stub 'echo "[revalidate-season] REVALIDATED season 2026: 2/2 worker(s) reached (2,1) in 2 request(s)."' 0
expect 0 both-workers-distinct-ordinals run; has 'R6 REVALIDATE RESULT PASS season 2026 workers 2,1'
stub 'echo "REVALIDATED season 2026: 1/2 worker(s) reached (1) in 4 request(s)."' 0;       expect 1 one-of-two run;        has 'reached 1 of 2'
stub 'echo "INCOMPLETE season 2026: 1/2 worker(s) reached in 20 request(s): timeout."' 1;   expect 1 incomplete-exit-1 run;  has 'exited 1'
stub 'echo "INCOMPLETE season 2026: 1/2 worker(s) reached in 20 request(s)."' 0;            expect 1 incomplete-line-exit-0 run; has 'INCOMPLETE'
stub 'echo "REVALIDATED season 2026: 2/2 worker(s) reached (1,1) in 2 request(s)."' 0;      expect 1 repeated-ordinal run;  has 'not distinct'
stub 'echo "REVALIDATED season 2026: 3/3 worker(s) reached (1,2,3) in 3 request(s)."' 0;    expect 1 three-workers-when-two-expected run; has 'reached 3 of 3'
stub 'echo "REVALIDATED season 2026: 1 worker(s) reached (single) in 1 request(s)."' 0;     expect 1 single-process-answer run
stub 'echo "NOT CONFIGURED: neither AFLDB_REVALIDATE_URL nor AFLDB_REVALIDATE_SECRET is set; nothing was posted."' 2; expect 1 not-configured run; has 'exited 2'
stub 'echo "REVALIDATED season 2026: 2/2 worker(s) reached (2,1) in 2 request(s)."' 1;      expect 1 success-text-but-nonzero-exit run; has 'exited 1'
stub 'true' 0;                                                                               expect 1 no-output run; has 'found 0'
stub 'echo "REVALIDATED season 2025: 2/2 worker(s) reached (2,1) in 2 request(s)."' 0;      expect 1 other-season-output run; has 'found 0'
stub 'echo "REVALIDATED season 2026: 2/2 worker(s) reached (2,1) in 2 request(s)."' 0
expect 2 bad-season-argument run 26
expect 0 explicit-season-and-count run 2026 2
stub 'echo "REVALIDATED season 2026: 1/1 worker(s) reached (1) in 1 request(s)."' 0;        expect 0 one-worker-cluster-when-one-expected run 2026 1
bash -n "$S" && pass=$((pass+1)) || { fails=$((fails+1)); echo '***** FAIL syntax'; }
echo "T352-REVALIDATE RESULT $pass passed, $fails failed"
[ "$fails" = 0 ]
