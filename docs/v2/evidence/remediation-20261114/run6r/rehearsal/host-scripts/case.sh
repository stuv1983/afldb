#!/usr/bin/env bash
# Packet 6R B1a rehearsal, one case on one fresh disposable copy of the 4 Nov snapshot template. Runs inside `isolated-pg run <db>`
# (cwd = the candidate checkout; DSNs in the environment, never printed). Called by rehearse.sh.
set -u -o pipefail
CASE=$1 DB=$2
W=/mnt/ssd/afldb-rem6r-b1a-20261116; EV=$W/ev; mkdir -p "$EV"
D=docs/v2/evidence/remediation-20261114/run6r/b1a
R=$D/b1a-repair-2026-r6r.mts
I=$AFLDB_TEST_IMPORT_DATABASE_URL
qi() { psql "$I" -XAtq -v ON_ERROR_STOP=1 -c "$1"; }
read -r OID SYS < <(qi "SELECT d.oid, c.system_identifier FROM pg_database d, pg_control_system() c WHERE d.datname = current_database()" | tr '|' ' ')
IDS=$(qi "SELECT md5(string_agg(player_id::text, ',' ORDER BY player_id)) FROM player_season_stats WHERE season = 2026")
MAXID=$(qi "SELECT max(player_id) FROM player_season_stats WHERE season = 2026")
MINID=$(qi "SELECT min(player_id) FROM player_season_stats WHERE season = 2026")
echo "copy: db=$DB oid=$OID sysid=$SYS role=$(qi 'SELECT current_user') ids2026(pre-drift)=$IDS"
runner() { node --import tsx "$R" "$@"; echo "exit=$?"; }
std() { runner --dsn-env AFLDB_TEST_IMPORT_DATABASE_URL --expect-db "$DB" --expect-oid "$OID" --expect-sysid "$SYS" --expect-ids-md5 "$IDS" "$@"; }
accept() { PGOPTIONS='-c default_transaction_read_only=on' psql "$I" -X -v ON_ERROR_STOP=1 -At -v db="$DB" -v oid="$OID" -v sysid="$SYS" -f "$D/b1a-accept-r6r.sql"; }
reverse() { # <commit|""> <db> <ids> <inputs> <h1> <h2> <h3>
  local c=()
  [ -n "$1" ] && c=(-v "commit=$1")
  psql "$I" -X -v ON_ERROR_STOP=1 -v db="$2" -v oid="$OID" -v sysid="$SYS" -v ids="$3" -v inputs="$4" -v h1="$5" -v h2="$6" -v h3="$7" "${c[@]}" \
    -f "$D/b1a-reverse-r6r.sql" 2>&1 | sed 's/^psql:[^ ]*: //'; echo "exit=${PIPESTATUS[0]}"; }
fp() { # one line: 2026 xmin + full rows, every player_season_stats row, every stat_availability row, 2026 medal rows
  qi "SELECT 'xmin2026=' || md5(string_agg(xmin::text, ',' ORDER BY player_id)) || ' row2026=' || md5(string_agg(p::text, E'\n' ORDER BY player_id))
            || ' pss_all=' || (SELECT md5(string_agg(q::text, E'\n' ORDER BY season, player_id)) FROM player_season_stats q)
            || ' sa_all=' || (SELECT md5(string_agg(s::text, E'\n' ORDER BY season, stat_key)) FROM stat_availability s)
            || ' bsv2026=' || (SELECT count(*) FROM brownlow_season_votes WHERE season = 2026)
            || ' status2026=' || (SELECT string_agg(st || ':' || n, ',' ORDER BY st) FROM (SELECT brownlow_status::text st, count(*) n
                                     FROM player_season_stats WHERE season = 2026 GROUP BY 1) g)
       FROM player_season_stats p WHERE season = 2026"; }
part() { grep -o "$1=[^ ]*" <<< "$2"; }
same() { if [ "$1" = "$2" ]; then echo "PASS $3: state byte-identical (xmin, rows, coverage, medal)"; else echo "FAIL $3"; echo "  before $1"; echo "  after  $2"; fi; }
twice() { echo "--- $1: dry run"; std; echo "--- $1: --commit"; std --commit; }

case "$CASE" in
exact)
  accept > "$EV/exact-accept-before.txt"; echo "accept BEFORE rc=$?"; sed 's/^/  /' "$EV/exact-accept-before.txt"
  F0=$(fp); echo "fp0 $F0"
  echo "--- dry run"; std
  same "$F0" "$(fp)" "dry run rolled back"
  echo "--- commit"; std --commit
  accept > "$EV/exact-accept-after.txt"; echo "accept AFTER rc=$?"
  echo "--- acceptance BEFORE -> AFTER (changed lines only)"; diff "$EV/exact-accept-before.txt" "$EV/exact-accept-after.txt" | grep '^[<>]'
  F2=$(fp); echo "fp2 $F2"
  [ "$(part sa_all "$F0")" = "$(part sa_all "$F2")" ] && echo "PASS commit left stat_availability byte-identical" || echo "FAIL stat_availability changed"
  echo "only-status check: $(qi "SELECT count(*) FROM player_season_stats WHERE season = 2026 AND (brownlow_status <> 'pending' OR brownlow_votes IS NOT NULL)") rows not pending/NULL"
  echo "--- repeat --commit"; std --commit
  same "$F2" "$(fp)" "repeat commit performed no mutation"
  echo "--- repeat dry run"; std
  same "$F2" "$(fp)" "repeat dry run performed no mutation"
  B=$EV/exact-accept-before.txt
  RI=$(awk -F'|' '$1=="ids2026"{print $3}' "$B"); RN=$(awk -F'|' '$1=="inputs2026"{print $2}' "$B")
  R1=$(awk -F'|' '$1=="fp_pss_other(H1)"{print $2}' "$B"); R2=$(awk -F'|' '$1=="fp_pss2026_nonstatus(H2)"{print $2}' "$B")
  R3=$(awk -F'|' '$1=="fp_stat_availability(H3)"{print $3}' "$B")
  echo "reversal inputs from BEFORE capture: ids=$RI inputs=$RN h1=$R1 h2=$R2 h3=$R3"
  echo "--- reversal without -v commit (must refuse)"; reverse "" "$DB" "$RI" "$RN" "$R1" "$R2" "$R3"
  echo "--- reversal, wrong H3 (must refuse)"; reverse true "$DB" "$RI" "$RN" "$R1" "$R2" 00000000000000000000000000000000
  same "$F2" "$(fp)" "refused reversals wrote nothing"
  echo "--- reversal dry run"; reverse false "$DB" "$RI" "$RN" "$R1" "$R2" "$R3"
  same "$F2" "$(fp)" "reversal dry run rolled back"
  echo "--- reversal commit"; reverse true "$DB" "$RI" "$RN" "$R1" "$R2" "$R3"
  F5=$(fp); echo "fp5 $F5"
  for k in row2026 pss_all sa_all bsv2026 status2026; do
    [ "$(part $k "$F0")" = "$(part $k "$F5")" ] && echo "PASS reversal restored $k exactly (= fp0)" || echo "FAIL reversal $k differs from fp0"; done
  accept > "$EV/exact-accept-reversed.txt"; echo "--- acceptance BEFORE vs after reversal (changed lines only; none expected)"
  diff "$EV/exact-accept-before.txt" "$EV/exact-accept-reversed.txt" | grep '^[<>]' || echo "  (identical)"
  echo "--- reversal repeated (must refuse: rows are not_applicable)"; reverse true "$DB" "$RI" "$RN" "$R1" "$R2" "$R3"
  echo "--- reversal, wrong identity (must refuse)"; reverse true afldb_prod "$RI" "$RN" "$R1" "$R2" "$R3"
  same "$F5" "$(fp)" "refused reversals wrote nothing"
  ;;
identity)
  F0=$(fp)
  echo "--- wrong database name, --commit"; runner --dsn-env AFLDB_TEST_IMPORT_DATABASE_URL --expect-db afldb_prod --expect-oid "$OID" --expect-sysid "$SYS" --expect-ids-md5 "$IDS" --commit
  echo "--- wrong OID, --commit"; runner --dsn-env AFLDB_TEST_IMPORT_DATABASE_URL --expect-db "$DB" --expect-oid "$((OID + 1))" --expect-sysid "$SYS" --expect-ids-md5 "$IDS" --commit
  echo "--- wrong system identifier, --commit"; runner --dsn-env AFLDB_TEST_IMPORT_DATABASE_URL --expect-db "$DB" --expect-oid "$OID" --expect-sysid 7674454702926115004 --expect-ids-md5 "$IDS" --commit
  echo "--- wrong 2026 id-set hash, --commit"; runner --dsn-env AFLDB_TEST_IMPORT_DATABASE_URL --expect-db "$DB" --expect-oid "$OID" --expect-sysid "$SYS" --expect-ids-md5 "$(printf x | md5sum | cut -c1-32)" --commit
  echo "--- --expect-sysid omitted, --commit"; runner --dsn-env AFLDB_TEST_IMPORT_DATABASE_URL --expect-db "$DB" --expect-oid "$OID" --expect-ids-md5 "$IDS" --commit
  echo "--- --expect-oid omitted, --commit"; runner --dsn-env AFLDB_TEST_IMPORT_DATABASE_URL --expect-db "$DB" --expect-sysid "$SYS" --expect-ids-md5 "$IDS" --commit
  echo "--- --expect-ids-md5 omitted, --commit"; runner --dsn-env AFLDB_TEST_IMPORT_DATABASE_URL --expect-db "$DB" --expect-oid "$OID" --expect-sysid "$SYS" --commit
  echo "--- unknown flag, --commit"; runner --dsn-env AFLDB_TEST_IMPORT_DATABASE_URL --expect-db "$DB" --expect-oid "$OID" --expect-sysid "$SYS" --expect-ids-md5 "$IDS" --expect-rows 669 --commit
  same "$F0" "$(fp)" "identity refusals wrote nothing"
  ;;
mixed)
  qi "UPDATE player_season_stats SET brownlow_status = 'pending' WHERE season = 2026 AND player_id = $MAXID"; echo "drift: player $MAXID set to pending (668 not_applicable + 1 pending)"
  F0=$(fp); twice mixed; same "$F0" "$(fp)" "mixed-state refusals wrote nothing" ;;
missing)
  qi "DELETE FROM player_season_stats WHERE season = 2026 AND player_id = $MAXID"; echo "drift: 2026 row of player $MAXID deleted (668 rows)"
  F0=$(fp); twice missing; same "$F0" "$(fp)" "missing-row refusals wrote nothing" ;;
additional|swap)
  [ "$CASE" = swap ] && { qi "DELETE FROM player_season_stats WHERE season = 2026 AND player_id = $MAXID"; echo "drift: 2026 row of player $MAXID deleted"; }
  NEW=$(qi "INSERT INTO player_season_stats
    SELECT (jsonb_populate_record(NULL::player_season_stats, to_jsonb(p) || jsonb_build_object('season', 2026, 'brownlow_status', 'not_applicable', 'brownlow_votes', NULL))).*
      FROM player_season_stats p WHERE p.season = 2025
       AND NOT EXISTS (SELECT 1 FROM player_season_stats q WHERE q.player_id = p.player_id AND q.season = 2026)
     ORDER BY p.player_id LIMIT 1 RETURNING player_id")
  echo "drift: 2026 row inserted for player $NEW ($(qi 'SELECT count(*) FROM player_season_stats WHERE season = 2026') rows, all not_applicable: $(qi "SELECT count(*) FILTER (WHERE brownlow_status = 'not_applicable') FROM player_season_stats WHERE season = 2026"))"
  F0=$(fp); twice "$CASE"; same "$F0" "$(fp)" "$CASE refusals wrote nothing" ;;
cov-partial)
  qi "UPDATE stat_availability SET coverage = 'partial' WHERE season = 2026 AND stat_key = 'brownlow_round_votes'"; echo "drift: 2026 brownlow_round_votes coverage -> partial"
  F0=$(fp); twice "$CASE"; same "$F0" "$(fp)" "$CASE refusals wrote nothing" ;;
cov-na)
  qi "UPDATE stat_availability SET coverage = 'not_applicable' WHERE season = 2026 AND stat_key = 'brownlow_season_total'"; echo "drift: 2026 brownlow_season_total coverage -> not_applicable"
  F0=$(fp); twice "$CASE"; same "$F0" "$(fp)" "$CASE refusals wrote nothing" ;;
medal)
  qi "INSERT INTO brownlow_season_votes (season, player_id, votes) VALUES (2026, $MINID, 0)"; echo "drift: one 2026 brownlow_season_votes row (medal result present)"
  F0=$(fp); twice "$CASE"; same "$F0" "$(fp)" "$CASE refusals wrote nothing" ;;
conc-timeout)
  F0=$(fp)
  echo "writer: holds ROW EXCLUSIVE on player_season_stats (no-op update of one 2025 row) for 8 s, then commits"
  ( psql "$I" -XAtq -v ON_ERROR_STOP=1 -c "BEGIN" -c "UPDATE player_season_stats SET brownlow_status = brownlow_status WHERE season = 2025 AND player_id = (SELECT min(player_id) FROM player_season_stats WHERE season = 2025)" -c "SELECT pg_sleep(8)" -c "COMMIT"; echo "writer exit=$?" ) &
  sleep 1; echo "--- runner --commit while the writer is open (t=1 s)"; T0=$(date +%s.%N); std --commit; echo "runner took $(awk -v a="$T0" -v b="$(date +%s.%N)" 'BEGIN{printf "%.1f", b-a}') s"
  wait
  echo "2026 after: $(part status2026 "$(fp)")  xmin2026 unchanged: $([ "$(part xmin2026 "$F0")" = "$(part xmin2026 "$(fp)")" ] && echo yes || echo NO)" ;;
conc-mixed)
  echo "writer: changes 2026 player $MAXID to pending, holds 2 s, commits"
  ( psql "$I" -XAtq -v ON_ERROR_STOP=1 -c "BEGIN" -c "UPDATE player_season_stats SET brownlow_status = 'pending' WHERE season = 2026 AND player_id = $MAXID" -c "SELECT pg_sleep(2)" -c "COMMIT"; echo "writer exit=$?" ) &
  sleep 0.5; echo "--- runner --commit while the writer is open (t=0.5 s)"; std --commit
  wait; F1=$(fp); echo "2026 after: $(part status2026 "$F1")  (writer's change only: the runner wrote nothing)" ;;
conc-blocked)
  echo "holder: SELECT ... FOR SHARE on 2026 player $MINID for 4 s (ROW SHARE: compatible with the runner's table locks; delays its FOR UPDATE)"
  ( psql "$I" -XAtq -v ON_ERROR_STOP=1 -c "BEGIN" -c "SELECT 1 FROM player_season_stats WHERE season = 2026 AND player_id = $MINID FOR SHARE" -c "SELECT pg_sleep(4)" -c "COMMIT" > /dev/null; echo "holder exit=$?" ) &
  sleep 0.5
  ( std --commit > "$EV/conc-blocked-runner.txt" 2>&1 ) &
  RP=$!
  sleep 1
  echo "--- locks held by the runner at t=1.5 s (granted=t) and its wait"
  qi "SELECT coalesce(l.relation::regclass::text, l.locktype) || ' ' || l.mode || ' granted=' || l.granted
        FROM pg_locks l JOIN pg_stat_activity a ON a.pid = l.pid
       WHERE a.application_name = 'issue365-b1a-r6r' AND (l.locktype = 'relation' AND l.relation::regclass::text IN
             ('seasons','stat_availability','brownlow_season_votes','brownlow_season_authority','brownlow_vote_entry_state','brownlow_round_votes','player_season_stats')
             OR NOT l.granted) ORDER BY 1" | sed 's/^/  /'
  echo "--- four writers and one reader start at t=1.5 s, each with lock_timeout 1 s"
  w() { local label=$1; shift; local out; out=$(psql "$I" -XAtq -v ON_ERROR_STOP=1 -c "SET lock_timeout = '1s'" -c "$*" 2>&1); echo "  $label: rc=$? ${out//$'\n'/ }" | sed 's/psql:[^ ]* //'; }
  w "W1 UPDATE 2026 player_season_stats row " "UPDATE player_season_stats SET brownlow_status = 'pending' WHERE season = 2026 AND player_id = $MAXID" > "$EV/w1" &
  w "W2 UPDATE 2026 coverage row           " "UPDATE stat_availability SET total_rows = 1 WHERE season = 2026 AND stat_key = 'brownlow_round_votes'" > "$EV/w2" &
  w "W3 INSERT 2026 medal row              " "INSERT INTO brownlow_season_votes (season, player_id, votes) VALUES (2026, $MINID, 0)" > "$EV/w3" &
  w "W4 UPDATE seasons 2026                " "UPDATE seasons SET status = status WHERE year = 2026" > "$EV/w4" &
  w "R1 SELECT count 2026 (reader)         " "SELECT count(*) FROM player_season_stats WHERE season = 2026" > "$EV/r1" &
  wait $RP; wait
  cat "$EV/w1" "$EV/w2" "$EV/w3" "$EV/w4" "$EV/r1"
  echo "--- runner output"; cat "$EV/conc-blocked-runner.txt"
  F1=$(fp); echo "after: $(part status2026 "$F1") $(part bsv2026 "$F1"); coverage: $(qi "SELECT string_agg(stat_key || '=' || coverage || '/' || coalesce(total_rows::text, 'null'), ',' ORDER BY stat_key) FROM stat_availability WHERE season = 2026 AND stat_key LIKE 'brownlow%'")" ;;
conc-twin)
  echo "two runners --commit started together"
  ( std --commit > "$EV/twin-a.txt" 2>&1 ) & ( std --commit > "$EV/twin-b.txt" 2>&1 ) & wait
  for f in a b; do echo "--- runner $f"; grep -E '^(LOCKED|OUTCOME|exit)' "$EV/twin-$f.txt"; done
  echo "after: $(part status2026 "$(fp)")" ;;
*) echo "unknown case $CASE"; exit 2 ;;
esac
