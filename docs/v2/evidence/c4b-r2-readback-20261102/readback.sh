#!/bin/bash
# ISSUE-316 C4b r2: independent READ-ONLY read-back on afldb-prod, as `arm`, no sudo. Replaces the failed last query of the pinned `run.sh step-c`
# (which asked a column, import_batches.created_at, that does not exist; the table's timestamp is started_at). It never edits the pinned scripts.
#   bash readback.sh main   <N> [<evidence-dir>]   the read-back; ends READBACK CONSISTENT (exit 0) or READBACK NOT CONSISTENT (exit 1)
#   bash readback.sh negctl <N>                    negative control: runs the invalid query through the SAME wrapper and must END as a FAILURE
# Anchors are the run's recorded identifiers and instants (RUN_ID, LABEL, T0, T1 below), never "now() - interval". Every query goes through a wrapper that
# CHECKS the psql exit status: a failed required query is a failure of the whole read-back, not a printed error followed by a success line.
# NULL semantics: timestamps that can be NULL (observed_to, resolved_at, absent_since, closed_by_batch_id, completed_at) are only ever compared with >=/IN
# (NULL is "not in range", never zero) and are DISPLAYED as <NULL>; a count of 0 means "no row satisfied the predicate", not "the column is 0".
set -u -o pipefail
export LC_ALL=C
umask 077
PHASE=${1:?phase (main|negctl)}; N=${2:?N (40 hex)}; EVD=${3:-/home/arm/backups/afldb/c4b-924ff273-r2}
[[ $N =~ ^[0-9a-f]{40}$ ]] || { echo "STOP: N must be 40 lowercase hex"; exit 2; }
CHK=/home/arm/projects/afldb
CPROD_REL=docs/v2/evidence/block-c-package-20261102/c-prod.sh
CPROD_SHA=ec839a47b645a61561ef885c1a5d1926be2e864fe3e557ec254553c6a031d496
P=$CHK/$CPROD_REL
[ "$(hostname)" = afldb-prod ] && [ "$(id -un)" = arm ] || { echo "STOP: unexpected host/user (afldb-prod, as arm)"; exit 3; }
[ "$(git -C "$CHK" rev-parse HEAD)" = "$N" ] || { echo "STOP: checkout HEAD is not $N"; exit 3; }
[ "$(sha256sum < "$P" | cut -c1-64)" = "$CPROD_SHA" ] || { echo "STOP: c-prod.sh is not the pinned bytes"; exit 3; }

# The packaged reader definitions only (same sed ranges as the pinned step-c): host/identity checks, DSN parse for afldb_backup, the read-only psql wrapper `q`.
set -- x
# shellcheck disable=SC1090
source <(sed -n '14,18p;20,75p' "$P")
type backup_identity > /dev/null 2>&1 && type q > /dev/null 2>&1 && type setting_raw > /dev/null 2>&1 || { echo "STOP: the packaged reader definitions did not load"; exit 3; }

trap 'unset PGPASSWORD' EXIT
RUN_ID=c4b-2026-11-02T083721874Z-3296445
LABEL=afl-api-2027-2026-11-02-083723
T0="'2026-11-02T08:37:21.874Z'::timestamptz"   # first line of run.log (run start); also the instant embedded in RUN_ID
T1="'2026-11-02T08:37:24.585Z'::timestamptz"   # result.json "at" / "C4B CLEAR" line (run end)
SETTING_KEY=acquisition.afl_api_current_season_enabled

FAILS=0; MISMATCH=0; V=
# wrapper: run one psql query; a non-zero exit OR an ERROR: line is a FAILURE (counted, printed, never swallowed)
sc() { # sc LABEL SQL -> V holds the scalar/row text
  local out s; out=$(q -c "$2" 2>&1); s=$?
  if [ $s -ne 0 ] || [[ $out == *"ERROR:"* ]]; then echo "QUERY FAILED [$1] exit=$s: $out"; FAILS=$((FAILS + 1)); V='<FAILED>'; return 0; fi
  V=$out
}
show() { sc "$1" "$2"; echo "$1:"; printf '%s\n' "$V" | sed 's/^/    /'; }               # informational listing (failure still counted)
expect() { sc "$1" "$2"; echo "$1 = [$V] (expected [$3])"; [ "$V" = "$3" ] || { echo "UNEXPECTED [$1]: expected [$3], got [$V]"; MISMATCH=$((MISMATCH + 1)); }; }
verdict() { # the single exit point: success only if nothing failed and nothing was unexpected
  echo "failed queries: $FAILS; unexpected values: $MISMATCH"
  if [ "$FAILS" -eq 0 ] && [ "$MISMATCH" -eq 0 ]; then echo "READBACK CONSISTENT (read-only; this proves what the listed checks prove and no more)"; return 0; fi
  echo "READBACK NOT CONSISTENT (a failed query or an unexpected value is a finding for review, never auto-corrected)"; return 1
}

case "$PHASE" in
negctl)
  echo "== negctl $(date -u +%FT%TZ): the invalid query of the pinned step-c, through the same wrapper"
  backup_identity
  sc "NEGATIVE CONTROL: max(created_at) on import_batches" "SELECT count(*), max(created_at) FROM import_batches WHERE started_at >= $T0"
  verdict; rc=$?
  if [ "$rc" -ne 0 ] && [ "$FAILS" -ge 1 ]; then echo "NEGATIVE CONTROL PASS (the invalid query was counted as a failure and the verdict was non-zero)"; exit 0; fi
  echo "NEGATIVE CONTROL FAILED (an invalid required query did not fail the read-back)"; exit 1
  ;;
main)
  echo "== readback $(date -u +%FT%TZ) host=$(hostname) user=$(id -un) N=$N"
  echo "run_id=$RUN_ID label=$LABEL window T0=2026-11-02T08:37:21.874Z T1=2026-11-02T08:37:24.585Z"
  backup_identity

  echo; echo "### A. the import_batches schema (why the pinned query failed)"
  show "import_batches columns (ordinal, name, type, nullable)" "SELECT ordinal_position, column_name, data_type, is_nullable FROM information_schema.columns WHERE table_schema='public' AND table_name='import_batches' ORDER BY ordinal_position"
  expect "columns named created_at" "SELECT count(*) FROM information_schema.columns WHERE table_schema='public' AND table_name='import_batches' AND column_name='created_at'" 0
  expect "columns named started_at" "SELECT count(*) FROM information_schema.columns WHERE table_schema='public' AND table_name='import_batches' AND column_name='started_at'" 1

  echo; echo "### B. import_batches (batch BOOKKEEPING): rows that exist for this run"
  expect "batches started inside [T0,T1]" "SELECT count(*) FROM import_batches WHERE started_at >= $T0 AND started_at <= $T1" 0
  expect "batches started at or after T0 (to date, fixed instant)" "SELECT count(*) FROM import_batches WHERE started_at >= $T0" 0
  expect "batches naming the snapshot label (notes/validation_result/error/tool)" "SELECT count(*) FROM import_batches WHERE COALESCE(notes,'') LIKE '%$LABEL%' OR COALESCE(validation_result::text,'') LIKE '%$LABEL%' OR COALESCE(error,'') LIKE '%$LABEL%' OR tool LIKE '%$LABEL%'" 0
  expect "batches naming the run id" "SELECT count(*) FROM import_batches WHERE COALESCE(notes,'') LIKE '%$RUN_ID%' OR COALESCE(validation_result::text,'') LIKE '%$RUN_ID%' OR COALESCE(error,'') LIKE '%$RUN_ID%' OR tool LIKE '%$RUN_ID%'" 0
  expect "unfinished batches (status <> completed) started at or after T0" "SELECT count(*) FROM import_batches WHERE status <> 'completed' AND started_at >= $T0" 0
  show "latest 5 batches (id, source, tool, started_at, completed_at, status); all expected to PREDATE T0" "SELECT b.id, COALESCE(s.key,'<NULL>'), b.tool, b.started_at, COALESCE(b.completed_at::text,'<NULL>'), b.status FROM import_batches b LEFT JOIN sources s ON s.id=b.source_id ORDER BY b.id DESC LIMIT 5"
  show "identity sequence vs max(id) (a gap = some insert was rolled back or deleted at some time; NOT attributable to one run)" "SELECT s.sequencename, COALESCE(s.last_value::text,'<NULL: no privilege or never called>'), (SELECT max(id) FROM import_batches) FROM pg_sequences s WHERE s.schemaname='public' AND s.sequencename LIKE 'import_batches%id%seq'"

  echo; echo "### C. rows that would hang off a batch started at or after T0 (staging observations, candidates, canonical applications)"
  expect "versions/records/candidates/canonical_applications/rejections referencing such batches" "WITH b AS (SELECT id FROM import_batches WHERE started_at >= $T0) SELECT concat_ws(',', (SELECT count(*) FROM staging.source_record_versions v WHERE v.opened_by_batch_id IN (SELECT id FROM b) OR v.closed_by_batch_id IN (SELECT id FROM b)), (SELECT count(*) FROM staging.source_records r WHERE r.last_batch_id IN (SELECT id FROM b)), (SELECT count(*) FROM promotion_candidates c WHERE c.created_by_batch_id IN (SELECT id FROM b)), (SELECT count(*) FROM canonical_applications a WHERE a.import_batch_id IN (SELECT id FROM b)), (SELECT count(*) FROM import_rejections j WHERE j.import_batch_id IN (SELECT id FROM b)))" "0,0,0,0,0"

  echo; echo "### D. durable acquisition / staging rows by their OWN timestamps (independent of batch linkage), at or after T0"
  expect "payloads(first_stored_at) versions(observed_from|observed_to) records(first_seen|last_seen|absent_since) candidates(created|resolved) decisions issues(detected|resolved) canonical_applications(applied_at)" "SELECT concat_ws(',', (SELECT count(*) FROM staging.source_payloads WHERE first_stored_at >= $T0), (SELECT count(*) FROM staging.source_record_versions WHERE observed_from >= $T0 OR observed_to >= $T0), (SELECT count(*) FROM staging.source_records WHERE first_seen_at >= $T0 OR last_seen_at >= $T0 OR absent_since >= $T0), (SELECT count(*) FROM promotion_candidates WHERE created_at >= $T0 OR resolved_at >= $T0), (SELECT count(*) FROM promotion_decisions WHERE decided_at >= $T0), (SELECT count(*) FROM data_issues WHERE detected_at >= $T0 OR resolved_at >= $T0), (SELECT count(*) FROM canonical_applications WHERE applied_at >= $T0))" "0,0,0,0,0,0,0"
  echo "(observed_to, absent_since, resolved_at and closed_by_batch_id may be NULL: a NULL never satisfies >= or IN, so it is never counted as inside the window)"
  expect "afl_api match projection rows for the 2027 season feed (CD_S2027014)" "SELECT count(*) FROM staging.afl_api_match WHERE provider_season_id = 'CD_S2027014'" 0
  expect "afl_api player-match projection rows, season 2027" "SELECT count(*) FROM staging.afl_api_player_match WHERE season = 2027" 0

  echo; echo "### E. CANONICAL rows (a different check from section B)"
  expect "canonical matches in season 2027" "SELECT count(*) FROM matches WHERE season = 2027" 0
  expect "canonical matches owned by source afl_api" "SELECT count(*) FROM matches m JOIN sources s ON s.id = m.source_id WHERE s.key = 'afl_api'" 0

  echo; echo "### F. the switch and its audit trail"
  show "site_settings row (key, value as stored, updated_at, updated_by or <NULL>)" "SELECT key, value::text, updated_at, COALESCE(updated_by::text,'<NULL>') FROM site_settings WHERE key = '$SETTING_KEY'"
  expect "site_settings rows for the key" "SELECT count(*) FROM site_settings WHERE key = '$SETTING_KEY'" 1
  expect "stored value" "SELECT value::text FROM site_settings WHERE key = '$SETTING_KEY'" false
  show "audit rows for this run id (id, at, step, attempt-or-<NULL>, enabled)" "SELECT id, at, detail->>'step', COALESCE(detail->>'attempt','<NULL>'), detail->>'enabled' FROM auth_audit_log WHERE detail->>'run_id' = '$RUN_ID' ORDER BY id"
  expect "audit rows for this run id" "SELECT count(*) FROM auth_audit_log WHERE detail->>'run_id' = '$RUN_ID'" 2
  expect "ingestion-switch audit rows with id > 304 (anything after this run's restore)" "SELECT count(*) FROM auth_audit_log WHERE action = 'current_season.afl_api_ingestion_set' AND id > 304" 0

  echo; echo "### G. files on disk (acquisition artefacts live on the filesystem, not in the database; the dry-run rollback does not cover them)"
  SNAP=$CHK/data/sources/afl_api/matches/$LABEL
  if [ -d "$SNAP" ]; then
    ls -la "$SNAP"
    ( cd "$SNAP" && for f in *; do if [ "$f" = token.meta.json ]; then echo "(token.meta.json: name, size and mode only) $(stat -c '%s bytes mode %a' "$f")"; else sha256sum "$f"; fi; done )
    echo "snapshot directory present: acquisition artefact RETAINED on disk by design (git-ignored)"
  else echo "UNEXPECTED: snapshot directory $SNAP missing"; MISMATCH=$((MISMATCH + 1)); fi
  echo "-- evidence directory $EVD against the hashes recorded by step-c at 2026-11-02T08:37:49Z"
  EXPECTED='432a826da72b1321abbff9ca4c33fc95e49ad7e975d9428a3488fca15df64a96  ./acquire.log
15cc09f9fbb43473e4e646118f3a95aba59a0be02b4432c1f3b8b923bd8a3849  ./after.json
15cc09f9fbb43473e4e646118f3a95aba59a0be02b4432c1f3b8b923bd8a3849  ./before.json
f3e3504958d0b9a3fa47d92058ef2bb35225f39fea9427fe452d98d5c331e9dd  ./readiness.txt
5e4746ab782e51199d0bae4b01321a68bc6ab9c5646c8d78ad53f0ad2f0e80f5  ./restore-verified.json
1571892cc538ac3d51fba3cd595436658ee4bd35fd78f9b950dc1e96cdf9d04b  ./result.json
0f6c4e62f4fa96f90b66d94fe39fc47f11958df73c3eb99fccf9a5d754dd944a  ./run.log
29118f8db0503311910c73d654b03bcc24e61ad149a96652b44c0a0ad6f3914e  ./settle-dry-run.log
cc66b30b09c8967cdda50c5df03e7898231651a0d21054afa011dbb2ff592f1f  ./watchdog-ready.json
b61202bd99a8093d1c14021091a464fab14221a16995c90404788fa2522eb899  ./watchdog.pid'
  ACTUAL=$(cd "$EVD" && find . -type f -print0 | sort -z | xargs -0 sha256sum)
  if [ "$ACTUAL" = "$EXPECTED" ]; then echo "evidence directory unchanged (10 files, every hash equal to the recorded value)"
  else echo "UNEXPECTED: evidence directory differs from the recorded hashes"; printf '%s\n' "$ACTUAL"; MISMATCH=$((MISMATCH + 1)); fi

  echo; verdict
  exit $?
  ;;
*) echo "STOP: unknown phase"; exit 2 ;;
esac
