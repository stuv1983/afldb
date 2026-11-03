#!/usr/bin/env bash
# SIMULATION ONLY (installed as <SIM>/shimbin/node, and named by the simulation profile's NODE). A pass-through to the real node UNLESS the control file
# <SIM>/shimbin/mode names a failure to inject into the S1 stage tool's `apply`; this is how the wrapper's handling of tool failures is exercised against a real
# database. It changes nothing about the tool or the database: the REAL apply runs (or is killed before it can), and only the reported outcome is altered.
#   mode=kill        the tool is killed before it starts (exit 137, no outcome line, nothing applied)
#   mode=v3|v4       the real apply commits and verifies, then the outcome line is rewritten to COMMITTED_VERIFICATION_FAILED(3) / _UNAVAILABLE(4) and that exit is returned
#   mode=rolledback  the real apply commits, then the tool claims ROLLED_BACK (exit 2): a lying outcome the state probe must contradict
#   mode=lost        the real apply commits, then the process exits 5 with no outcome line (lost report)
REAL=/home/arm/.nvm/versions/node/v22.23.2/bin/node
HERE=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
MODE=$( [ -f "$HERE/mode" ] && tr -d ' \n' < "$HERE/mode" || true )
if [ -n "$MODE" ] && [[ " $* " == *" apply "* ]] && [[ "$*" == *gap029-captaincy-additions-production.ts* ]]; then
  echo "[node-shim] injecting mode=$MODE into the S1 apply" >&2
  if [ "$MODE" = kill ]; then kill -9 $$; fi
  OUT=$("$REAL" "$@" 2>&1); RC=$?
  echo "[node-shim] the real apply exited $RC" >&2
  case "$MODE" in
    v3)         printf '%s\n' "$OUT" | grep -v '^OUTCOME '; echo "OUTCOME COMMITTED_VERIFICATION_FAILED (exit 3)"; exit 3 ;;
    v4)         printf '%s\n' "$OUT" | grep -v '^OUTCOME '; echo "OUTCOME COMMITTED_VERIFICATION_UNAVAILABLE (exit 4)"; exit 4 ;;
    rolledback) printf '%s\n' "$OUT" | grep -v '^OUTCOME '; echo "OUTCOME ROLLED_BACK (exit 2)"; exit 2 ;;
    lost)       printf '%s\n' "$OUT" | grep -v '^OUTCOME '; exit 5 ;;
    *)          printf '%s\n' "$OUT"; exit "$RC" ;;
  esac
fi
exec "$REAL" "$@"
