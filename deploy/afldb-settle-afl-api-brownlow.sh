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
# ONE run of the chain, in order, failing closed (any non-zero step stops the
# run; `set -e` plus the EXIT trap below emit AFLDB_SETTLE_FAILURE):
#
#   acquire-afl-api.ts --season <S> --fixtures-only (network; season feed only, manifest LAST)
#     -> settle-afl-api-fixtures.ts --label <F> --apply
#                                                    (match-family spine observations ONLY)
#     -> acquire-afl-api-brownlow.ts --season <S>   (network; writes files, manifest LAST)
#     -> settle-afl-api-brownlow.ts --label <L> --apply --auto-apply
#        --use-fixture-identity
#
# AFLDB-ISSUE-232 D-232-1 = B (operator decision, 2026-09-26): the settle
# passes --use-fixture-identity. This is the OPERATOR-APPROVED REVERSAL of
# AFLDB-ISSUE-244 §40, which kept this wrapper fail-closed. A vote set whose
# match is owned by another source (every 2026 match is AFL Tables-owned) has
# no staging.afl_api_match row and resolves only through the match family's
# fixture observation: SELECT-only, (season, home, away, exact venue-local
# date) against EXISTING matches rows; 0 rows -> unknown_match, >1 ->
# fixture_identity_ambiguous, never guessed, never a match write. A vote set
# WITH a typed row keeps the provider-id-first path and its
# provider_identity_contradiction HALT; the flag is not consulted for it.
#
# AFLDB-ISSUE-232 ordering O1 (operator decision, 2026-09-26): the fixture
# observations that fallback reads are refreshed by THIS run, steps 1-2,
# before the Brownlow acquisition. The chain does not rely on the daily match
# timer (whose --require-complete-source rolls a whole night back on one
# incomplete record, and which selects only CONCLUDED matches), nor on
# systemd After=/Requires= (which cannot make a 5-minute timer wait for a
# daily one). Step 2's only write is the match family's spine observation plus
# its own import_batches row: no matches, no staging.afl_api_match, no
# promotion candidate. It needs no CFS token.
#
# Consequence: steps 1-2 are gated by the AFL API current-season ingestion
# switch (site_settings) as well, so the Brownlow chain now needs BOTH that
# switch and the Brownlow switches. With the current-season switch off, step
# 1 refuses and the unit fails visibly; it never falls through to a Brownlow
# settle without fresh fixture identity.
#
# Every step is Node, like the match/stats chain; both acquisition tools
# self-clean their own partial snapshot on failure (`cleanupPartialSnapshot()`,
# `cleanupPartialBrownlowSnapshot()`), so no separate cleanup trap is needed
# here. Revalidation is unchanged (D-232-3): nothing here calls
# revalidateSeason().
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

# --- AFLDB-ISSUE-244 I244-F029: keep the stripped credentials stripped -------
# Same reasoning as deploy/afldb-settle-afl-api.sh: systemd has already applied
# EnvironmentFile= and then UnsetEnvironment=, and without this flag the two
# Node CLIs below would reopen $PROJECT_ROOT/.env and hand themselves back the
# owner/auth/test/backup DSNs and the session, SMTP, intake and revalidation
# secrets the unit deliberately dropped. INVOCATION_ID comes from systemd and
# nothing else, so a manual run is unaffected. Set before the FIRST Node/tsx
# invocation below — and before the §10 gate, which reads only the process
# environment and is therefore unaffected either way.
if [ -n "${INVOCATION_ID:-}" ]; then
  export AFLDB_SKIP_DOTENV=1
fi

# --- §10 operational enablement gate ----------------------------------------
# Read from the process environment only. Under systemd, EnvironmentFile= has
# already loaded the flag into it before this script runs; this wrapper never
# opens or parses .env itself (and, per I244-F029, under systemd the Node CLIs
# do not reopen it either). A manual/local invocation must export the flag
# itself.
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

# --- 1. acquire the season fixture feed (network, files only; manifest last) --
# AFLDB-ISSUE-232 O1. --fixtures-only writes the whole season feed
# (00-season-matches.json) plus one fixture.json per selected match under
# data/sources/afl_api/fixtures/<label>/, derived from that feed; no CFS token,
# no playerStats/matchRoster. --status is not passed: it defaults to
# CONCLUDED, which is every match a Brownlow vote can name.
echo "[1/4] acquire fixture identity (AFL.com.au season feed, --fixtures-only)"
fixtures_output=$("$NODE" "$TSX" tools/current-season/acquire-afl-api.ts --season "$season" --fixtures-only 2>&1) \
  || { printf '%s\n' "$fixtures_output"; exit 1; }
printf '%s\n' "$fixtures_output"

# Same "..., label <value>" first line as the match/stats chain parses
# (acquire-afl-api.ts runAcquisition()); the --fixtures-only suffix follows a
# space, which ends the character class.
fixtures_label=$(printf '%s\n' "$fixtures_output" | sed -n 's/.*, label \([A-Za-z0-9_-]*\).*/\1/p' | head -n1)
if [ -z "$fixtures_label" ]; then
  echo "could not determine the fixtures-only snapshot label from acquire-afl-api.ts output" >&2
  exit 1
fi
echo "fixtures-only label: $fixtures_label"

# --- 2. persist the fixture observations (opens PostgreSQL) ------------------
# settle-afl-api-fixtures.ts reads data/sources/afl_api/fixtures/<label>/,
# re-verifies the manifest hashes, and refuses a manifest that is not a
# --fixtures-only acquisition. A non-zero exit stops the chain here, so the
# Brownlow settle never runs against fixture identity this run failed to
# refresh.
echo "[2/4] settle fixture identity (apply; match-family spine observations only)"
"$NODE" "$TSX" tools/current-season/settle-afl-api-fixtures.ts \
  --label "$fixtures_label" --apply

# --- 3. acquire the Brownlow feed (network, files only; manifest last) -------
echo "[3/4] acquire (AFL.com.au bfawards, direct HTTP)"
acquire_output=$("$NODE" "$TSX" tools/current-season/acquire-afl-api-brownlow.ts --season "$season" 2>&1) \
  || { printf '%s\n' "$acquire_output"; exit 1; }
printf '%s\n' "$acquire_output"

label=$(printf '%s\n' "$acquire_output" | sed -n 's/.*, label \([A-Za-z0-9_-]*\).*/\1/p' | head -n1)
if [ -z "$label" ]; then
  echo "could not determine the acquired snapshot label from acquire-afl-api-brownlow.ts output" >&2
  exit 1
fi
echo "acquired label: $label"

# --- 4. settle Brownlow ------------------------------------------------------
# No --require-complete-source here: settle-afl-api-brownlow.ts does not
# accept that flag (§10 validation is per-vote-set all-or-none, not a
# season-enumeration completeness gate — see settle-afl-api-brownlow.ts's own
# KNOWN_FLAGS). --use-fixture-identity: D-232-1 = B, see the header.
echo "[4/4] settle (apply, automatic canonical path, fixture identity fallback)"
"$NODE" "$TSX" tools/current-season/settle-afl-api-brownlow.ts \
  --label "$label" --apply --auto-apply --use-fixture-identity

echo "AFLDB_SETTLE_SUCCESS label=$label fixtures_label=$fixtures_label"
echo "afl_api Brownlow settle chain complete — label $label (fixture identity $fixtures_label)"
