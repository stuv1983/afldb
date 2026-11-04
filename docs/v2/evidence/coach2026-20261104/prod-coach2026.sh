#!/bin/bash
# =====================================================================================================================================
# WITHDRAWN / SUPERSEDED 2026-11-04 (later the same day). THIS SCRIPT REFUSES TO RUN (exit 9). Kept unmodified below for the record.
# Why: it drove the broad importer tools/migration/import_match_coaches.py, whose write is NOT 436 additions only (it upserts all coaches
# rows, rewrites coach_id/source_record_id/import_batch_id of every existing assignment in its input, deletes source assignments missing
# from its input, replays admin overrides, and commits its batch row in a separate transaction); its "verify" proved counts and a
# three-column digest, not full rows; it offered a production importer dry run (not proven transaction-read-only); it reused an existing
# staging directory without re-verifying it file by file; it accepted any same-day non-empty dump filename as a backup; and several of its
# failed checks printed FAIL but exited 0.
# Replacement: tools/v2/issue333-coach-assignments-production.py (plan / apply / state) with the narrowly additive writer
# tools/migration/add_match_coaches_2026.py; procedure and approval: docs/v2/issue333-o2-consolidated-approval-2026-11-04.md.
# =====================================================================================================================================
echo "REFUSED: prod-coach2026.sh is WITHDRAWN (2026-11-04); use docs/v2/issue333-o2-consolidated-approval-2026-11-04.md" >&2
exit 9
# AFLDB-ISSUE-333 -- load the 2026 per-match coach assignments into PRODUCTION (OWNER-RUN ONLY; prepared 2026-11-04, NEVER RUN by the preparer).
#
#   bash prod-coach2026.sh preflight        read-only: state, inputs, guards (writes only the temp workspace)
#   bash prod-coach2026.sh dry-run          read-only: the importer's own --dry-run against production
#   COACH2026_BACKUP=<dump file> bash prod-coach2026.sh apply     ONE import batch (the only write)
#   bash prod-coach2026.sh verify           read-only: postconditions
#
# Run on afldb-prod as `arm`. No sudo. No restart. No build. No timer or setting change. The operator checkout is NOT modified:
# the pinned revision is extracted with `git archive` into a separate workspace and the core package is unpacked there.
# Source of the assignments: the retained, manifest-pinned fitzRoy core `c2-2026-final-core-v1` (tracked manifest, sha256
# 02bbcf93...9988), the same accepted input the ISSUE-316 rebuild candidate measured (match_coaches 32,470). Proven on a disposable
# clone of production: docs/v2/evidence/coach2026-20261104/clone-logs/.
set -euo pipefail
MODE=${1:-}
PROD=/home/arm/projects/afldb
REV=d00e07e37566e92b35a34e62a1ff03e173715e87
WS=/home/arm/ops/coach2026
CORE_TAR=$WS/in/core.tar
CORE_TAR_SHA=9a989fdcf7177cff24bbedcd0ee4559b772ebc452c05dab331e128859e4db080
LABEL_CORE=c2-2026-final-core-v1
LABEL_COACHES=coaches-20260905
EXPECT_BEFORE_MC=32034; EXPECT_AFTER_MC=32470; EXPECT_SIDES_BEFORE=436
export GIT_OPTIONAL_LOCKS=0
envval() { sed -n "s/^$1=//p" "$PROD/.env" | tail -1 | sed 's/^"\(.*\)"$/\1/'; }
IMPORT_DSN=$(envval AFLDB_IMPORT_DATABASE_URL); [ -n "$IMPORT_DSN" ] || { echo "REFUSED: no import credential"; exit 2; }
RO() { PGOPTIONS='-c default_transaction_read_only=on -c statement_timeout=60000 -c lock_timeout=3000' psql "$IMPORT_DSN" -X -v ON_ERROR_STOP=1 -At -F '|' -c "$1"; }
FACTS_SQL="select (select count(*) from match_coaches), (select count(*) from (select m.id, m.home_club_id c from matches m where season=2026 union all select m.id, m.away_club_id from matches m where season=2026) s left join match_coaches mc on mc.match_id=s.id and mc.club_id=s.c where mc.match_id is null), (select count(*) from matches where season=2026), (select count(*) from coaches)"
stage() {
  [ "$(git -C "$PROD" rev-parse HEAD)" = "$REV" ] || { echo "REFUSED: the checkout is not at $REV"; exit 3; }
  [ -f "$CORE_TAR" ] || { echo "REFUSED: $CORE_TAR missing (copy D:\\tmp\\coach2026\\core.tar there first)"; exit 3; }
  [ "$(sha256sum "$CORE_TAR" | cut -d' ' -f1)" = "$CORE_TAR_SHA" ] || { echo "REFUSED: core.tar hash differs from the reviewed one"; exit 3; }
  if [ ! -d "$WS/repo/tools" ]; then
    mkdir -p "$WS/repo"
    git -C "$PROD" archive "$REV" | tar -x -C "$WS/repo"
    mkdir -p "$WS/repo/data/sources/afltables/fitzroy_core/$LABEL_CORE"
    tar -x -C "$WS/repo/data/sources/afltables/fitzroy_core/$LABEL_CORE" -f "$CORE_TAR"
  fi
}
IMPORTER() { ( cd "$WS/repo" && AFLDB_IMPORT_DATABASE_URL="$IMPORT_DSN" PGOPTIONS='-c statement_timeout=120000' "$PROD/.venv/bin/python" tools/migration/import_match_coaches.py --label "$LABEL_COACHES" --fitzroy-label "$LABEL_CORE" "$@" ); }
echo "UTC=$(date -u +%FT%TZ) mode=$MODE"
echo "identity: $(RO "select current_database(), current_user, current_setting('transaction_read_only')")"
echo "facts (match_coaches | 2026 sides without a coach | 2026 matches | coaches): $(RO "$FACTS_SQL")"
case "$MODE" in
  preflight)
    stage
    echo "workspace staged at $WS/repo from $REV; core.tar hash verified"
    IMPORTER --validate-only | tail -4
    echo "writers inactive (read-only view):"; systemctl list-timers --all --no-pager 2>/dev/null | grep -i afldb | cut -c1-160 || true
    pgrep -af 'settle|acquire|import_' | grep -v 'pgrep' | cut -c1-120 || echo "no settle/acquire/import process"
    ;;
  dry-run)
    stage; IMPORTER --dry-run | tail -14 ;;
  apply)
    stage
    : "${COACH2026_BACKUP:?REFUSED: set COACH2026_BACKUP to a restore-verified production dump taken today}"
    [ -s "$COACH2026_BACKUP" ] || { echo "REFUSED: backup file missing or empty"; exit 4; }
    [ -n "$(find "$COACH2026_BACKUP" -newermt '2026-11-04 00:00:00' 2>/dev/null)" ] || { echo "REFUSED: backup is older than 2026-11-04"; exit 4; }
    F=$(RO "$FACTS_SQL"); [ "$F" = "$EXPECT_BEFORE_MC|$EXPECT_SIDES_BEFORE|218|386" ] || { echo "REFUSED: production is not in the reviewed pre-state ($F)"; exit 5; }
    echo "pre-state matches the reviewed one; running the importer (one import batch)"
    IMPORTER | tail -14
    echo "post facts: $(RO "$FACTS_SQL")"
    ;;
  verify)
    F=$(RO "$FACTS_SQL"); echo "expected: $EXPECT_AFTER_MC|0|218|386"; [ "$F" = "$EXPECT_AFTER_MC|0|218|386" ] && echo "VERIFY: PASS (counts)" || echo "VERIFY: FAIL (counts)"
    echo "digest of the pre-existing (season<=2025) assignments (clone digest before AND after was 9b83fe8e90e38fb4a131c1257e227cca|32034):"
    RO "select md5(string_agg(concat_ws('|',mc.match_id,mc.club_id,mc.coach_id),',' order by mc.match_id,mc.club_id)), count(*) from match_coaches mc join matches m on m.id=mc.match_id where m.season<=2025"
    echo "latest import batches:"; RO "select id, tool, status::text, records_read, records_inserted from import_batches order by id desc limit 3"
    echo "2026 distinct coaches (clone: 20):"; RO "select count(distinct mc.coach_id) from match_coaches mc join matches m on m.id=mc.match_id where m.season=2026"
    ;;
  *) echo "usage: $0 preflight|dry-run|apply|verify"; exit 1 ;;
esac
echo "== done ($MODE)"
