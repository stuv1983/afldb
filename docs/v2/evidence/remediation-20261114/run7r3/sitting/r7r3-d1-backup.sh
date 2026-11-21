#!/usr/bin/env bash
# Release 7 revision 3 (R7R3), block D1 = verified-backup capture before the 2026 attachment. PRODUCTION, as arm.
# Writes ONLY a new backup directory /home/arm/backups/afldb-r7r3-<STAMP> (0700: one afldb_prod dump, its .sha256, the parity capture)
# and a new evidence directory /home/arm/r7r3-data-<STAMP> (0700). Reads afldb_prod through the read-only backup role. Prunes nothing.
#   1. tools/maintenance/backup.sh --dir <new dir> --keep 1000 (its own pg_restore --list readability check), exactly one dump;
#   2. sha256 recorded; the archive header names afldb_prod;
#   3. a DB-free proof that the dump holds the 2026 state this packet changes: player_season_stats 2026 = pending 669 with no votes;
#      brownlow_round_votes 2026 = 9522 rows, all match_id NULL;
#   4. the nine restore-test.sh parity aggregates in one read-only snapshot, right after the dump (no writer runs in the window).
# The backup is PROVEN only by D1v (dev/r7r3-dv-restore-verify.sh on streamanator): restore into a brand-new isolated cluster, parity,
# and the attachment plan on the restored copy producing the same digest as production's D2 plan. D3/D4 do not run before D1v PASS.
# Run: tr -d '\r' < r7r3-d1-backup.sh | ssh afldb bash -s -- <STAMP e.g. 20261124T000500Z>
main() {
set -euo pipefail; export LC_ALL=C; umask 077
trap 'echo "STOP line $LINENO: $BASH_COMMAND"' ERR
export PATH=/home/arm/.nvm/versions/node/v22.23.2/bin:$PATH
CHK=/home/arm/projects/afldb; cd "$CHK"
STAMP=${1:?STAMP}; [[ $STAMP =~ ^[0-9]{8}T[0-9]{6}Z$ ]]
D=/home/arm/backups/afldb-r7r3-$STAMP; A=/home/arm/r7r3-data-$STAMP
[ ! -e "$D" ] && [ ! -e "$A" ] || { echo "STOP $D or $A exists"; exit 1; }
echo "== R7R3 D1 $(date -u +%FT%TZ)"
W=$(pgrep -af 'settle|import_|rebuild|pg_dump|pg_restore|brownlow-season-attach' | grep -v pgrep || true); [ -z "$W" ]; echo "PASS no writer or dump process"
mkdir -m 700 "$A"
bash tools/maintenance/backup.sh --dir "$D" --keep 1000
[ "$(stat -c %a "$D")" = 700 ]
[ "$(ls -1 "$D"/*.dump | wc -l)" = 1 ]; F=$(ls -1 "$D"/afldb_prod-*.dump)
(cd "$D" && sha256sum "$(basename "$F")" > "$(basename "$F").sha256" && chmod 600 ./*.sha256 && cat ./*.sha256)
echo "BYTES $(stat -c %s "$F")"
pg_restore --list "$F" | sed -n '1,20p' | grep -E 'dbname: afldb_prod|Archive created|TOC Entries'
pg_restore --list "$F" | sed -n '1,20p' | grep -E '^; +dbname: afldb_prod$' > /dev/null; echo "PASS archive dbname afldb_prod"
P26=$(pg_restore --data-only --table=player_season_stats --file=- "$F" | awk -F'\t' '
  /^COPY public.player_season_stats /{s=$0;sub(/^[^(]*\(/,"",s);sub(/\).*/,"",s);n=split(s,c,", ");
    for(i=1;i<=n;i++){if(c[i]=="season")si=i;if(c[i]=="brownlow_status")bi=i;if(c[i]=="brownlow_votes")vi=i};on=1;next}
  on&&/^\\\.$/{on=0;next} on&&$si==2026{k[$bi]++;if($vi!="\\N")nn++} END{for(x in k)print "pss2026",x,k[x];print "pss2026 votes_non_null",nn+0}')
B26=$(pg_restore --data-only --table=brownlow_round_votes --file=- "$F" | awk -F'\t' '
  /^COPY public.brownlow_round_votes /{s=$0;sub(/^[^(]*\(/,"",s);sub(/\).*/,"",s);n=split(s,c,", ");
    for(i=1;i<=n;i++){if(c[i]=="season")si=i;if(c[i]=="match_id")mi=i;if(c[i]=="votes")vi=i};on=1;next}
  on&&/^\\\.$/{on=0;next} on&&$si==2026{r++;v+=$vi;if($mi!="\\N")a++} END{print "brv2026 rows",r+0,"votes",v+0,"attached",a+0}')
echo "$P26"; echo "$B26"
grep -qx 'pss2026 pending 669' <<< "$P26"; grep -qx 'pss2026 votes_non_null 0' <<< "$P26"
[ "$(grep -v '^pss2026 votes_non_null ' <<< "$P26" | grep -c '^pss2026 ')" = 1 ]   # exactly one 2026 status (pending)
[ "$B26" = 'brv2026 rows 9522 votes 1242 attached 0' ]
echo "PASS the dump holds the pre-attachment 2026 state"
( set -a && . ./.env && set +a
  re='^(postgres(ql)?://)([^:/@]+):([^@]*)@(.*)$'; d=$AFLDB_BACKUP_DATABASE_URL; [[ $d =~ $re ]] || { echo "bad DSN shape" >&2; exit 1; }
  printf -v PGPASSWORD '%b' "${BASH_REMATCH[4]//\%/\\x}"; export PGPASSWORD
  PGOPTIONS='-c default_transaction_read_only=on' psql -X -q -v ON_ERROR_STOP=1 -At -d "${BASH_REMATCH[1]}${BASH_REMATCH[3]}@${BASH_REMATCH[5]}" <<'SQL'
BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY;
SELECT 'player_match_stats rows', count(*) FROM player_match_stats;
SELECT 'players rows', count(*) FROM players;
SELECT 'matches rows', count(*) FROM matches;
SELECT 'clubs rows', count(*) FROM clubs;
SELECT 'career games total', sum(games) FROM player_career_stats;
SELECT 'career goals total', sum(goals) FROM player_career_stats;
SELECT 'Brownlow votes total', sum(votes) FROM brownlow_season_votes;
SELECT 'unrecorded disposals', count(*) FROM player_match_stats WHERE disposals IS NULL;
SELECT 'stat_availability rows', count(*) FROM stat_availability;
ROLLBACK;
SQL
) > "$D/parity-prod.txt"
chmod 600 "$D/parity-prod.txt"; cat "$D/parity-prod.txt"; [ "$(wc -l < "$D/parity-prod.txt")" = 9 ]
du -h "$F"
echo "D1 RESULT DUMP CAPTURED $F sha256 $(cut -c1-64 "$F.sha256") (unproven until D1v)"
}
main "$@" < /dev/null
