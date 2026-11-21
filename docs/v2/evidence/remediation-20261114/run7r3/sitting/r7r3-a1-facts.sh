#!/usr/bin/env bash
# Release 7 revision 3 (R7R3), block A1 = database facts for the 2026 Brownlow, READ-ONLY (backup role, one REPEATABLE READ READ ONLY
# snapshot). PRODUCTION, as arm (or a restored copy on the DEV host: R7R3_DSN_ENV / R7R3_ENV_FILE / R7R3_DATA). Writes only
# <data dir>/facts-<phase>.txt (0600). Phases and their expectations:
#   before     right after D1: 2026 round grain 9522 rows / 621 positive / 1242 votes, none attached; no match mirror; no season rows;
#              669 player seasons pending with NULL votes; not published.
#   attached   after D4: every 2026 round row attached (9522; 207 distinct matches, each with exactly one 3/2/1 set = 6 votes); the
#              match mirror holds 9522 cells, 621 positive, 1242 votes, and agrees with the round grain per player and per match;
#              STILL no season rows, still pending, still unpublished (nothing public changes).
#   published  after the owner's publication: as attached, plus 183 season rows totalling 1242 votes with 1 winner and the given
#              number of ineligible rows; 669 player seasons complete with 1242 votes; three 2026 coverage rows complete; published;
#              round = match = season totals for every player.
# Every phase after `before` must reproduce, byte for byte, the `before` fingerprints of every OTHER season (round grain, match
# mirror, season rows, player-season Brownlow columns, coverage), so nothing outside 2026 changed.
# reversed   after R1 reverse-commit (pre-publication recovery only): the `before` expectations again, other seasons unchanged.
# Run: tr -d '\r' < r7r3-a1-facts.sh | ssh afldb bash -s -- <STAMP> <before|attached|published|reversed> [<ineligible count>]
main() {
set -euo pipefail; export LC_ALL=C; umask 077
trap 'echo "STOP line $LINENO: $BASH_COMMAND"' ERR
C=${R7R3_CHECKOUT:-/home/arm/projects/afldb}; ENVF=${R7R3_ENV_FILE:-$C/.env}; DSNVAR=${R7R3_DSN_ENV:-AFLDB_BACKUP_DATABASE_URL}
STAMP=${1:?STAMP}; [[ $STAMP =~ ^[0-9]{8}T[0-9]{6}Z$ ]]; PHASE=${2:?phase}; [[ $PHASE =~ ^(before|attached|published|reversed)$ ]]
NI=${3:-}; if [ "$PHASE" = published ]; then [[ $NI =~ ^[0-9]{1,3}$ ]]; fi
A=${R7R3_DATA:-/home/arm/r7r3-data-$STAMP}; [ -d "$A" ]; O=$A/facts-$PHASE.txt; [ ! -e "$O" ] || { echo "STOP $O exists"; exit 1; }
echo "== R7R3 A1 $PHASE $(date -u +%FT%TZ)"
( set -a && . "$ENVF" && set +a
  re='^(postgres(ql)?://)([^:/@]+):([^@]*)@(.*)$'; d=${!DSNVAR}; [[ $d =~ $re ]] || { echo "bad DSN shape" >&2; exit 1; }
  printf -v PGPASSWORD '%b' "${BASH_REMATCH[4]//\%/\\x}"; export PGPASSWORD
  PGOPTIONS='-c default_transaction_read_only=on' psql -X -q -v ON_ERROR_STOP=1 -At -F '|' -d "${BASH_REMATCH[1]}${BASH_REMATCH[3]}@${BASH_REMATCH[5]}" <<'SQL'
BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY;
SELECT 'identity', current_database(), d.oid, c.system_identifier FROM pg_control_system() c CROSS JOIN pg_database d WHERE d.datname = current_database();
SELECT 'brv2026', count(*), count(*) FILTER (WHERE votes > 0), coalesce(sum(votes), 0), count(match_id), count(DISTINCT match_id) FROM brownlow_round_votes WHERE season = 2026;
SELECT 'brv2026_match_sets', count(*), count(*) FILTER (WHERE v = 6 AND n3 = 1 AND n2 = 1 AND n1 = 1) FROM (
  SELECT match_id, sum(votes) v, count(*) FILTER (WHERE votes = 3) n3, count(*) FILTER (WHERE votes = 2) n2, count(*) FILTER (WHERE votes = 1) n1
    FROM brownlow_round_votes WHERE season = 2026 AND match_id IS NOT NULL GROUP BY match_id) x;
SELECT 'pms2026', count(s.brownlow_votes), count(*) FILTER (WHERE s.brownlow_votes > 0), coalesce(sum(s.brownlow_votes), 0)
  FROM player_match_stats s JOIN matches m ON m.id = s.match_id WHERE m.season = 2026;
SELECT 'recon_round_vs_match_player_diffs', count(*) FROM
  (SELECT player_id, sum(votes) v FROM brownlow_round_votes WHERE season = 2026 GROUP BY 1) r FULL JOIN
  (SELECT s.player_id, sum(s.brownlow_votes) v FROM player_match_stats s JOIN matches m ON m.id = s.match_id WHERE m.season = 2026 AND s.brownlow_votes IS NOT NULL GROUP BY 1) p
  USING (player_id) WHERE coalesce(r.v, 0) IS DISTINCT FROM coalesce(p.v, 0);
SELECT 'recon_round_vs_match_cell_diffs', count(*) FROM brownlow_round_votes b JOIN player_match_stats s ON s.match_id = b.match_id AND s.player_id = b.player_id
  WHERE b.season = 2026 AND s.brownlow_votes IS DISTINCT FROM b.votes;
SELECT 'bsv2026', count(*), coalesce(sum(votes), 0), count(*) FILTER (WHERE is_winner), count(*) FILTER (WHERE is_ineligible) FROM brownlow_season_votes WHERE season = 2026;
SELECT 'bsv2026_winner', string_agg(p.display_name || ':' || b.votes, ',' ORDER BY p.id) FROM brownlow_season_votes b JOIN players p ON p.id = b.player_id WHERE b.season = 2026 AND b.is_winner;
SELECT 'bsv2026_ineligible', coalesce(string_agg(b.player_id::text || ':' || b.votes, ',' ORDER BY b.player_id), '-') FROM brownlow_season_votes b WHERE b.season = 2026 AND b.is_ineligible;
SELECT 'recon_round_vs_season_diffs', count(*) FROM (SELECT player_id, sum(votes) v FROM brownlow_round_votes WHERE season = 2026 GROUP BY 1 HAVING sum(votes) > 0) r
  FULL JOIN (SELECT player_id, votes FROM brownlow_season_votes WHERE season = 2026) b USING (player_id) WHERE r.v IS DISTINCT FROM b.votes;
SELECT 'recon_pss_vs_season_diffs', count(*) FROM player_season_stats s LEFT JOIN brownlow_season_votes b ON b.season = s.season AND b.player_id = s.player_id
  WHERE s.season = 2026 AND s.brownlow_status = 'complete' AND s.brownlow_votes IS DISTINCT FROM coalesce(b.votes, 0);
SELECT 'pss2026', brownlow_status, count(*), count(brownlow_votes), coalesce(sum(brownlow_votes), 0) FROM player_season_stats WHERE season = 2026 GROUP BY 2 ORDER BY 2;
SELECT 'cov2026', stat_key, coverage FROM stat_availability WHERE season = 2026 AND stat_key LIKE 'brownlow%' ORDER BY 2;
SELECT 'pub2026', count(*) FILTER (WHERE published_revision IS NOT NULL) FROM brownlow_season_authority WHERE season = 2026;
SELECT 'season2026', status FROM seasons WHERE year = 2026;
SELECT 'pendlebury2026', coalesce(string_agg(m.id || ':' || s.brownlow_votes, ',' ORDER BY m.id), '-') FROM player_match_stats s JOIN matches m ON m.id = s.match_id
  WHERE m.season = 2026 AND s.player_id = 11724 AND s.brownlow_votes > 0;
SELECT 'daicos2026', coalesce(sum(votes), 0) FROM brownlow_round_votes WHERE season = 2026 AND player_id = 9910;
SELECT 'other_brv', count(*), coalesce(sum(votes), 0), md5(string_agg(id || ':' || player_id || ':' || coalesce(match_id::text, '-') || ':' || votes, ',' ORDER BY id)) FROM brownlow_round_votes WHERE season <> 2026;
SELECT 'other_pms', count(s.brownlow_votes), coalesce(sum(s.brownlow_votes), 0), md5(string_agg(s.match_id || ':' || s.player_id || ':' || s.brownlow_votes, ',' ORDER BY s.match_id, s.player_id))
  FROM player_match_stats s JOIN matches m ON m.id = s.match_id WHERE m.season <> 2026 AND s.brownlow_votes IS NOT NULL;
SELECT 'other_bsv', count(*), coalesce(sum(votes), 0), md5(string_agg(to_jsonb(b)::text, ',' ORDER BY season, player_id)) FROM brownlow_season_votes b WHERE season <> 2026;
SELECT 'other_pss', count(*), md5(string_agg(season || ':' || player_id || ':' || brownlow_status || ':' || coalesce(brownlow_votes::text, '-'), ',' ORDER BY season, player_id)) FROM player_season_stats WHERE season <> 2026;
SELECT 'other_cov', count(*), md5(string_agg(season || ':' || stat_key || ':' || coverage, ',' ORDER BY season, stat_key)) FROM stat_availability WHERE season <> 2026;
SELECT 'other_pub', count(*) FILTER (WHERE published_revision IS NOT NULL), md5(string_agg(season || ':' || coalesce(published_revision::text, '-'), ',' ORDER BY season)) FROM brownlow_season_authority WHERE season <> 2026;
ROLLBACK;
SQL
) > "$O"
chmod 600 "$O"; cat "$O"
L() { grep "^$1|" "$O" | cut -d'|' -f2- | paste -sd';'; }
fails=0; want() { if [ "$(L "$1")" = "$2" ]; then echo "PASS $1 = $2"; else echo "FAIL $1 = $(L "$1") (expected $2)"; fails=$((fails+1)); fi; }
IDW=${R7R3_IDENTITY:-afldb_prod|66668|7674454702926115004}
want identity "$IDW"
case $PHASE in
  before|reversed)
    want brv2026 '9522|621|1242|0|0'; want pms2026 '0|0|0'; want bsv2026 '0|0|0|0'; want pss2026 'pending|669|0|0'; want pub2026 '0'
    want season2026 'complete'; want pendlebury2026 '-'; want daicos2026 '47' ;;&
  attached|published|reversed)
    if [ "$PHASE" != reversed ]; then
    want brv2026 '9522|621|1242|9522|207'; want brv2026_match_sets '207|207'; want pms2026 '9522|621|1242'
    want recon_round_vs_match_player_diffs '0'; want recon_round_vs_match_cell_diffs '0'; want season2026 'complete'
    want pendlebury2026 '17151:2,17247:3'; want daicos2026 '47'
    fi
    B=$A/facts-before.txt; [ -s "$B" ] || { echo "STOP no facts-before.txt"; exit 1; }
    for k in identity other_brv other_pms other_bsv other_pss other_cov other_pub; do
      if [ "$(grep "^$k|" "$B")" = "$(grep "^$k|" "$O")" ]; then echo "PASS $k unchanged since before"; else echo "FAIL $k changed since before"; fails=$((fails+1)); fi
    done ;;
esac
case $PHASE in
  attached) want bsv2026 '0|0|0|0'; want pss2026 'pending|669|0|0'; want pub2026 '0' ;;
  published)
    want bsv2026 "183|1242|1|$NI"; want bsv2026_winner 'Nick Daicos:47'; want recon_round_vs_season_diffs '0'; want recon_pss_vs_season_diffs '0'
    want pss2026 'complete|669|669|1242'; want pub2026 '1'
    want cov2026 'brownlow_match_votes|complete;brownlow_round_votes|complete;brownlow_season_total|complete' ;;
esac
if [ $fails = 0 ]; then echo "A1 RESULT $PHASE PASS"; else echo "A1 RESULT $PHASE FAIL ($fails)"; exit 1; fi
}
main "$@" < /dev/null
