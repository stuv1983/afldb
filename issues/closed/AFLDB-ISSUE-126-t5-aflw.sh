#!/usr/bin/env bash
# AFLDB-ISSUE-126 T5 — reinstate staging_aflw.* on afldb_prod from the pre-cutover dump.
#
# Run on afldb-prod:
#   rehearsal (preconditions + dump listing only):  bash issues/open/AFLDB-ISSUE-126-t5-aflw.sh
#   real run:                                        bash issues/open/AFLDB-ISSUE-126-t5-aflw.sh --commit
# Eight tables, each its own pg_restore --single-transaction, in foreign-key order; a failure
# stops the script naming the table (earlier tables stay committed; rollback is the TRUNCATE
# in runbook §5 T5). Targets afldb_prod by name; refuses if any target table is non-empty.
set -euo pipefail
COMMIT=0; [ "${1:-}" = "--commit" ] && COMMIT=1
DUMP=/home/arm/afldb_prod_pre_rebuild_20260902-200355.dump
ORDER=(seasons fixtures matches ladders player_seasons player_match_stats scoring_events issues)
declare -A EXPECT=([seasons]=11 [fixtures]=818 [matches]=710 [ladders]=144 [player_seasons]=3972
                   [player_match_stats]=29878 [scoring_events]=15483 [issues]=2)
echo "host: $(hostname)  commit: $COMMIT"
[ "$(hostname)" = "afldb-prod" ] || { echo "REFUSED: not afldb-prod"; exit 1; }
[ -f "$DUMP" ] || { echo "REFUSED: dump missing: $DUMP"; exit 1; }
cd /home/arm/projects/afldb
set -a; . ./.env; set +a
OWNER_DSN="${AFLDB_OWNER_DATABASE_URL:?AFLDB_OWNER_DATABASE_URL unset}"
BASE="${OWNER_DSN%%\?*}"; QS=""; case "$OWNER_DSN" in *\?*) QS="?${OWNER_DSN#*\?}";; esac
PROD_DSN="${BASE%/*}/afldb_prod${QS}"
unset PGOPTIONS
P() { psql -X -v ON_ERROR_STOP=1 -At "$PROD_DSN" "$@"; }

echo "== identity"
[ "$(P -c 'SELECT current_database()')" = "afldb_prod" ] || { echo "REFUSED: not afldb_prod"; exit 1; }
[ "$(P -c "SELECT count(*) FROM pg_database WHERE datname='afldb_prod_auth_recovery'")" = "1" ] || { echo "REFUSED: recovery database missing"; exit 1; }

echo "== dump lists TABLE DATA for all eight tables, and each --schema/--table selection picks exactly one entry"
# Read the TOC once: grep -q on a live pipe closes it on the first match, pg_restore then dies on
# SIGPIPE, and pipefail reports the pipeline as failed (rehearsal 2026-09-04 20:19 refused on this).
TOC=$(pg_restore --list "$DUMP")
for t in "${ORDER[@]}"; do
  grep -qE "TABLE DATA staging_aflw $t " <<< "$TOC" || { echo "REFUSED: dump has no data for staging_aflw.$t"; exit 1; }
  sel=$(pg_restore --list --data-only --schema=staging_aflw --table="$t" "$DUMP" | grep -c 'TABLE DATA' || true)
  [ "$sel" = "1" ] || { echo "REFUSED: --schema=staging_aflw --table=$t selects $sel TABLE DATA entries (expected 1)"; exit 1; }
  echo "   staging_aflw.$t: TABLE DATA listed; selection = 1 entry"
done
echo "ok"

echo "== preconditions: every target table empty"
for t in "${ORDER[@]}"; do
  n=$(P -c "SELECT count(*) FROM staging_aflw.$t")
  [ "$n" = "0" ] || { echo "REFUSED: staging_aflw.$t has $n rows (expected 0)"; exit 1; }
done
echo "ok"

if [ "$COMMIT" != "1" ]; then
  echo "T5 REHEARSAL ONLY — nothing written (re-run with --commit to apply)"; exit 0
fi

echo "== restoring, one table per transaction, FK order"
for t in "${ORDER[@]}"; do
  echo "-- staging_aflw.$t"
  pg_restore --dbname="$PROD_DSN" --data-only --no-owner --no-privileges \
             --single-transaction --exit-on-error --schema=staging_aflw --table="$t" "$DUMP" \
    || { echo "FAILED at staging_aflw.$t — earlier tables are committed; see runbook §5 T5 rollback"; exit 1; }
  n=$(P -c "SELECT count(*) FROM staging_aflw.$t")
  [ "$n" = "${EXPECT[$t]}" ] || { echo "POST-CHECK FAILED: staging_aflw.$t has $n rows, expected ${EXPECT[$t]}"; exit 1; }
  echo "   $n rows (expected ${EXPECT[$t]})"
done
P -c "SELECT setval('staging_aflw.issues_id_seq', (SELECT max(id) FROM staging_aflw.issues), true)"

echo "== AFLW read model"
P -c "SELECT 'aflw.seasons='||(SELECT count(*) FROM aflw.seasons)||' aflw.matches='||(SELECT count(*) FROM aflw.matches)||' aflw.players='||(SELECT count(*) FROM aflw.players)"
[ "$(P -c 'SELECT count(*) FROM aflw.seasons')" = "11" ] || { echo "POST-CHECK FAILED: aflw.seasons <> 11"; exit 1; }
[ "$(P -c 'SELECT count(*) FROM aflw.matches')" = "710" ] || { echo "POST-CHECK FAILED: aflw.matches <> 710"; exit 1; }
echo "T5 COMMITTED"
