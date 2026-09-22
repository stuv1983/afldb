#!/bin/sh
# AFLDB-ISSUE-228 S8 (§16, §17) — the scheduled in-season AFL.com.au (afl_api)
# match/stats settle chain.
#
# ONE run of the S2/S6 chain, in order, failing closed:
#
#   acquire-afl-api.ts --season <S>               (network; writes files, manifest LAST)
#     -> settle-afl-api.ts --label <L> --apply
#        --auto-apply --require-complete-source    (the only step that opens PostgreSQL)
#
# Two steps, not three: unlike deploy/afldb-settle-afltables.sh there is no
# separate R acquisition / Python adjudication step here — both AFL API tools
# are Node (`tools/current-season/acquire-afl-api.ts`,
# `tools/current-season/settle-afl-api.ts`), and `settle-afl-api.ts` builds its
# own observation bundle from the acquired snapshot in-process (§6.3 doc
# header: "acquisition and settle are separate stages; it only ever reads the
# already-acquired snapshot"). There is deliberately no separate
# `emit-afl-api-bundle.ts` step in this chain — that tool is the S3 DB-free
# BACKTEST harness over the tracked local samples, not a production per-label
# bundle emitter (see this pass's session report for the discrepancy against
# the runbook's original §17 sketch).
#
# `acquire-afl-api.ts` self-cleans its own partial snapshot directory on
# failure (its own `cleanupPartialSnapshot()`, mirroring the
# `deploy/afldb-settle-afltables.sh` `cleanup_partial` pattern in-process), so
# this script does not re-implement that trap.
#
# Co-source corroboration (Q1) means this chain is SAFE to run alongside the
# nightly `afldb-settle-afltables` chain: an `afltables`-owned match observed
# here is corroborated, never overwritten and never re-owned (§7.5).
#
# Nothing here decides policy. The season comes from the repository's own
# in-progress register (`data/reference/seasons.json`), same file
# `deploy/afldb-settle-afltables.sh` reads, so the two chains can never
# disagree about which season is current.

set -eu

# Same convention as afldb-settle-afltables.sh and afldb-r-preflight.sh: the
# project root is resolved from $0 unless overridden, so a worktree runs its
# own checkout's tools, never a different one's.
PROJECT_ROOT=${AFLDB_PROJECT_ROOT:-$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)}
PYTHON=${AFLDB_PYTHON:-/usr/bin/python3}
NODE=${AFLDB_NODE:-/home/arm/.nvm/versions/node/v22.23.2/bin/node}
TSX=node_modules/tsx/dist/cli.mjs

cd "$PROJECT_ROOT"

# --- AFLDB-ISSUE-244 I244-F029: keep the stripped credentials stripped -------
# By the time this script runs systemd has applied the unit's EnvironmentFile=
# and then its UnsetEnvironment=, so the environment we hold is the narrowed
# one the unit intends. Without this flag the Node CLIs below call their own
# loadEnv(), reopen the SAME $PROJECT_ROOT/.env and repopulate every variable
# that is currently unset — which is precisely the list UnsetEnvironment= had
# just removed. INVOCATION_ID is supplied by systemd and by nothing else, so a
# manual run of this script keeps its .env convenience unchanged. Set here,
# before the FIRST Node/tsx invocation below.
if [ -n "${INVOCATION_ID:-}" ]; then
  export AFLDB_SKIP_DOTENV=1
fi

# --- the season -------------------------------------------------------------
# The same in-progress register the AFL Tables chain reads (§ R7/Q7: one
# season-of-record, never a second one this source could disagree with).
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
         "an afl_api acquisition is exactly one season. Refusing." >&2
    exit 1
    ;;
esac

# Belt-and-braces failure marker for ANY non-zero exit past this point
# (including a settle-afl-api.ts failure, which the explicit `||` below the
# acquire step does not cover). Unlike afldb-settle-afltables.sh's
# cleanup_partial this trap removes nothing — acquire-afl-api.ts already
# self-cleans its own partial snapshot — it only guarantees the documented
# AFLDB_SETTLE_FAILURE marker is never silently skipped.
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
  echo "[monitor] process: watch -n 5 \"ps -o pid,ppid,etime,%cpu,%mem,stat,cmd -p $$ --ppid $$\""
  echo '[monitor] database (same role): while true; do psql "$AFLDB_IMPORT_DATABASE_URL" -XAtc "SELECT pid,state,wait_event_type,wait_event,now()-xact_start,now()-query_start,left(query,120) FROM pg_stat_activity WHERE datname=current_database() AND usename=current_user AND pid<>pg_backend_pid() ORDER BY query_start;"; sleep 5; done'
  echo '[monitor] log: journalctl -u afldb-settle-afl-api -f'
  echo '[monitor] success marker: AFLDB_SETTLE_SUCCESS'
  echo '[monitor] failure marker: AFLDB_SETTLE_FAILURE (also inspect REFUSED|ERROR|FAILED|Traceback)'
  echo '[monitor] co-source note: an afltables-owned row observed here is corroborated (Q1), never overwritten.'
}

echo "AFLDB afl_api in-season settle — season $season"

print_monitoring_block

# --- 1. acquire (network, files only; manifest last) ------------------------
# --status is deliberately NOT passed: it defaults to CONCLUDED (§2.1, §7.3),
# so a nightly run never promotes a match the source itself has not finished
# reporting; POSTGAME/SCHEDULED/LIVE observations are a live/on-demand concern,
# not this timer's.
echo "[1/2] acquire (AFL.com.au direct HTTP)"
acquire_output=$("$NODE" "$TSX" tools/current-season/acquire-afl-api.ts --season "$season" 2>&1) \
  || { printf '%s\n' "$acquire_output"; exit 1; }
printf '%s\n' "$acquire_output"

# The acquisition prints "... label <value>" on its first line (§ acquire-afl-api.ts
# runAcquisition()); parsed here rather than passed in, because the tool picks
# its own UTC-timestamped, collision-safe label (`claimSnapshotDir()`) and
# takes no --label input for acquisition.
label=$(printf '%s\n' "$acquire_output" | sed -n 's/.*, label \([A-Za-z0-9_-]*\).*/\1/p' | head -n1)
if [ -z "$label" ]; then
  echo "could not determine the acquired snapshot label from acquire-afl-api.ts output" >&2
  exit 1
fi
echo "acquired label: $label"

# --- 2. settle (the only step that opens PostgreSQL) -------------------------
# Builds and re-hashes the observation bundle from the acquired snapshot
# itself before opening a connection (§ settle-afl-api.ts verifyManifest()).
# --require-complete-source: an incomplete source refuses the transaction
# before commit, so no canonical, staging or import-batch row is retained.
echo "[2/2] settle (apply, automatic canonical path)"
"$NODE" "$TSX" tools/current-season/settle-afl-api.ts \
  --label "$label" --apply --auto-apply --require-complete-source

echo "AFLDB_SETTLE_SUCCESS label=$label"
echo "afl_api settle chain complete — label $label"
