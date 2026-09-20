#!/bin/sh
# AFLDB-ISSUE-228 S8 (§10, §16, §17) — the AFL.com.au (afl_api) Brownlow
# live-count settle chain.
#
# INDEPENDENT of the match/stats chain (deploy/afldb-settle-afl-api.sh) by
# design (§10 "Operational enablement"): its own unit, its own flag, never
# bundled behind that timer. Defaults to DISABLED outside the live count —
# this script itself checks AFLDB_AFL_API_BROWNLOW_ENABLED before doing
# anything, so an always-enabled TIMER stays a harmless no-op for the ~11
# months of the year the count is not running, exactly the same shape as
# afldb-settle-afltables.sh's "no in-progress season" exit-0 case. The
# underlying CLI (settle-afl-api-brownlow.ts) enforces the SAME flag itself
# and throws (exit 1) if it is missing — this pre-check exists purely so a
# scheduled, enabled-by-default TIMER does not report a "failed" unit every
# few minutes for most of the year; it is not a second, weaker gate.
#
# ONE run of the S7 chain, in order, failing closed:
#
#   acquire-afl-api-brownlow.ts --season <S>        (network; writes files, manifest LAST)
#     -> settle-afl-api-brownlow.ts --label <L> --apply
#        --auto-apply                                (the only step that opens PostgreSQL)
#
# Both steps are Node, like the match/stats chain; acquire-afl-api-brownlow.ts
# self-cleans its own partial snapshot on failure
# (`cleanupPartialBrownlowSnapshot()`), so no separate cleanup trap is needed
# here.
#
# BEFORE pointing this at the live AFL endpoint, the S7/S8 implementation must
# be exercised end to end against the local Brownlow simulator (§10;
# AFLDB_AFL_API_CFS_BASE_URL=http://127.0.0.1:22880) in both --observe-only
# and normal apply mode. This script always runs the normal apply path
# (--apply --auto-apply); an operator wanting --observe-only or
# --validate-only runs settle-afl-api-brownlow.ts directly (see
# docs/acquisition/AFLDB-2026-API-ACQUISITION.md and the operator runbook).

set -eu

PROJECT_ROOT=${AFLDB_PROJECT_ROOT:-$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)}
PYTHON=${AFLDB_PYTHON:-/usr/bin/python3}
NODE=${AFLDB_NODE:-/home/arm/.nvm/versions/node/v22.23.2/bin/node}
TSX=node_modules/tsx/dist/cli.mjs

cd "$PROJECT_ROOT"

# --- §10 operational enablement gate ----------------------------------------
# Read directly from .env (systemd's EnvironmentFile= already loads it into
# the process environment before this script runs; this second read is only
# for a manual/local invocation of this script outside the unit).
if [ "${AFLDB_AFL_API_BROWNLOW_ENABLED:-}" != "true" ]; then
  echo "AFLDB_AFL_API_BROWNLOW_ENABLED is not 'true' — Brownlow settle is disabled outside the" \
       "live count window (§10). Nothing to do."
  exit 0
fi

# --- the season --------------------------------------------------------------
season=$("$PYTHON" - <<'PY'
import json
with open('data/reference/seasons.json', encoding='utf-8') as fh:
    seasons = json.load(fh).get('in_progress_seasons') or []
print(seasons[0] if len(seasons) == 1 else f'AMBIGUOUS:{len(seasons)}')
PY
)

case "$season" in
  AMBIGUOUS:0)
    echo "no in-progress season in data/reference/seasons.json — nothing to settle"
    exit 0
    ;;
  AMBIGUOUS:*)
    echo "data/reference/seasons.json declares more than one in-progress season;" \
         "a Brownlow acquisition is exactly one season. Refusing." >&2
    exit 1
    ;;
esac

# Belt-and-braces failure marker for any non-zero exit past this point, same
# reasoning as afldb-settle-afl-api.sh's report_failure — neither acquisition
# tool needs a cleanup trap here (both self-clean their own partial snapshot).
report_failure() {
  status=$?
  if [ "$status" -ne 0 ]; then
    echo "AFLDB_SETTLE_FAILURE season=$season exit=$status" >&2
  fi
  exit "$status"
}
trap report_failure EXIT

print_monitoring_block() {
  echo "[monitor] exact launcher: /bin/sh $0"
  echo "[monitor] launcher PID: $$"
  echo '[monitor] log: journalctl -u afldb-settle-afl-api-brownlow -f'
  echo '[monitor] success marker: AFLDB_SETTLE_SUCCESS'
  echo '[monitor] failure marker: AFLDB_SETTLE_FAILURE (also inspect REFUSED|ERROR|FAILED|Traceback)'
  echo '[monitor] expected during a live count: frequent no-op/head-touch runs between genuine vote changes.'
}

echo "AFLDB afl_api Brownlow settle — season $season"

print_monitoring_block

# --- 1. acquire (network, files only; manifest last) ------------------------
echo "[1/2] acquire (AFL.com.au bfawards, direct HTTP)"
acquire_output=$("$NODE" "$TSX" tools/current-season/acquire-afl-api-brownlow.ts --season "$season" 2>&1) \
  || { printf '%s\n' "$acquire_output"; exit 1; }
printf '%s\n' "$acquire_output"

label=$(printf '%s\n' "$acquire_output" | sed -n 's/.*, label \([A-Za-z0-9_-]*\).*/\1/p' | head -n1)
if [ -z "$label" ]; then
  echo "could not determine the acquired snapshot label from acquire-afl-api-brownlow.ts output" >&2
  exit 1
fi
echo "acquired label: $label"

# --- 2. settle (the only step that opens PostgreSQL) -------------------------
# No --require-complete-source here: settle-afl-api-brownlow.ts does not
# accept that flag (§10 validation is per-vote-set all-or-none, not a
# season-enumeration completeness gate — see settle-afl-api-brownlow.ts's own
# KNOWN_FLAGS).
echo "[2/2] settle (apply, automatic canonical path)"
"$NODE" "$TSX" tools/current-season/settle-afl-api-brownlow.ts \
  --label "$label" --apply --auto-apply

echo "AFLDB_SETTLE_SUCCESS label=$label"
echo "afl_api Brownlow settle chain complete — label $label"
