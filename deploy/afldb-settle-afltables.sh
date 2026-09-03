#!/bin/sh
# AFLDB-ISSUE-122 S8 — the scheduled in-season AFL Tables settle chain.
#
# ONE run of the approved production chain, in order, failing closed:
#
#   acquire_core.R --acquire --in-season          (network; writes files, manifest LAST)
#     -> import_fitzroy_core.py --require-in-season --on-record-error reject
#        --emit-observations                       (offline; no database)
#     -> settle-afltables.ts --apply --auto-apply  (the only step that opens PostgreSQL)
#
# Invoked by deploy/afldb-settle-afltables.service. It exists rather than three
# ExecStart= lines because the three steps must agree on ONE snapshot label and
# ONE season, and because systemd variable-expands `$VAR` inside ExecStart
# before /bin/sh sees it — embedding shell there needs `$$`/`%%` escaping that
# cannot be tested without installing the unit. This file can be checked with
# `sh -n` on any host.
#
# Nothing here decides policy. The season comes from the repository's own
# in-progress register, the datasets from the contract's `in_season` block, and
# every gate is re-derived by the three tools themselves.

set -eu

PROJECT_ROOT=${AFLDB_PROJECT_ROOT:-/home/arm/projects/afldb}
RSCRIPT=${AFLDB_RSCRIPT:-/usr/bin/Rscript}
PYTHON=${AFLDB_PYTHON:-/usr/bin/python3}
# Node is installed per-user via nvm, so the path is pinned rather than relying
# on PATH — the same reasoning as afldb.service. tsx is invoked through its own
# module entry rather than node_modules/.bin/tsx, whose shim needs `node` on
# PATH.
NODE=${AFLDB_NODE:-/home/arm/.nvm/versions/node/v22.23.2/bin/node}
TSX=node_modules/tsx/dist/cli.mjs

SNAPSHOT_ROOT=data/sources/afltables/fitzroy_core
MANIFEST_ROOT=docs/rebuild-manifests/afltables_fitzroy_core

cd "$PROJECT_ROOT"

# --- the season -----------------------------------------------------------
# data/reference/seasons.json is the in-progress register acquire_core.R and
# import_fitzroy_core.py both re-read; taking the season from anywhere else
# would let this script and the gates disagree. An in-season snapshot is
# exactly one season (contract in_season.single_season), so anything other
# than one in-progress season is not something this job may guess at.
season=$("$PYTHON" - <<'PY'
import json
with open('data/reference/seasons.json', encoding='utf-8') as fh:
    seasons = json.load(fh).get('in_progress_seasons') or []
print(seasons[0] if len(seasons) == 1 else f'AMBIGUOUS:{len(seasons)}')
PY
)

case "$season" in
  AMBIGUOUS:0)
    # Out of season is the normal state for roughly five months a year. It is
    # not a failure: there is nothing to settle, so the unit succeeds quietly
    # rather than reporting a failed run every night until March.
    echo "no in-progress season in data/reference/seasons.json — nothing to settle"
    exit 0
    ;;
  AMBIGUOUS:*)
    echo "data/reference/seasons.json declares more than one in-progress season;" \
         "an in-season snapshot is exactly one season. Refusing." >&2
    exit 1
    ;;
esac

# --- the label ------------------------------------------------------------
# Snapshots are immutable (ISSUE-093 §4): acquire_core.R refuses a label whose
# manifest already exists. The minute is included so a supervised rerun on the
# same day is a NEW snapshot rather than a refusal, and so the label is fixed
# once here — a run that starts before midnight cannot have its three steps
# disagree about the date.
label="settle-${season}-$(date +%Y-%m-%d-%H%M)"
snapshot_dir="$SNAPSHOT_ROOT/$label"
manifest="$MANIFEST_ROOT/$label.json"
bundle="$snapshot_dir/observations.json"

# A failed acquisition must leave NO consumable partial snapshot. The manifest
# is written last, so its absence is exactly the "acquisition did not finish"
# signal; the raw CSVs beside it are then removed. A failure AFTER the manifest
# exists is left completely alone — that snapshot is complete, immutable and is
# the evidence for the failure.
cleanup_partial() {
  status=$?
  if [ "$status" -ne 0 ] && [ ! -f "$manifest" ] && [ -d "$snapshot_dir" ]; then
    echo "acquisition did not write a manifest; removing partial snapshot $snapshot_dir"
    rm -rf "$snapshot_dir"
  fi
  exit "$status"
}
trap cleanup_partial EXIT

echo "AFLDB in-season settle — season $season, label $label"

# --- 1. acquire -----------------------------------------------------------
# --datasets is deliberately NOT passed: in-season it defaults to the
# contract's own in_season.required_datasets, so the job cannot drift from the
# contract by carrying a stale list.
echo "[1/3] acquire (AFL Tables via fitzRoy)"
"$RSCRIPT" tools/rebuild/fitzroy/acquire_core.R \
  --acquire --in-season --label "$label" --from "$season" --to "$season"

# --- 2. adjudicate + emit the observation bundle (offline) ----------------
# --on-record-error reject is in-season only and keeps ONE bad record from
# aborting the round. Nothing below opens a database: this branch emits and
# returns.
echo "[2/3] adjudicate and emit observations (offline)"
"$PYTHON" tools/migration/import_fitzroy_core.py \
  --label "$label" \
  --require-in-season \
  --on-record-error reject \
  --emit-observations "$bundle"

# --- 3. settle ------------------------------------------------------------
# The only step that opens PostgreSQL, and it re-hashes the manifest from disk
# before it does. Idempotent: a rerun over identical source data writes no
# canonical row and no ledger row.
#
# AFLDB-ISSUE-128: --require-complete-source makes an incomplete source a
# FAILED unit. The flag is evaluated after the settle transaction commits, so
# every record AFLDB could represent still lands and the rerun stays
# idempotent; what it prevents is this unit reporting success for a pass that
# dropped rows AFL Tables supplied. Out of season and on a quiet week the
# source carries nothing to drop and the verdict is `complete`, so a red unit
# always means a real coverage gap rather than a calendar.
echo "[3/3] settle (apply, automatic canonical path)"
"$NODE" "$TSX" tools/current-season/settle-afltables.ts \
  --label "$label" --apply --auto-apply --require-complete-source

echo "settle chain complete — label $label"
