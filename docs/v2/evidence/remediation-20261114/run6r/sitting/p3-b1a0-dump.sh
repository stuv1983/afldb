#!/usr/bin/env bash
# Packet 6R sitting, block P3 = packet 6R §5.2 (verify the four artifacts in $A, install runner + probe untracked into the checkout)
# then §5.1 (ONE fresh afldb_prod dump into a NEW directory with --keep 1000, sha256, header, DB-free 2026 proof, parity and acceptance
# BEFORE captures). PRODUCTION, as arm. Writes: the two untracked files under $REL, the new backup directory $D. Database: read-only
# (pg_dump and two read-only psql sessions as the backup role).
# Run: tr -d '\r' < p3-b1a0-dump.sh | ssh afldb bash -s -- <STAMP>     (after the four files were copied into $A)
main() {
set -euo pipefail; export LC_ALL=C
trap 'echo "STOP line $LINENO: $BASH_COMMAND"' ERR
export PATH=/home/arm/.nvm/versions/node/v22.23.2/bin:$PATH
CHK=/home/arm/projects/afldb; cd "$CHK"
CP=a2e6ea9995a44b6d5b7de7e820d17bb2e14986b5
STAMP=${1:?STAMP}; [[ $STAMP =~ ^[0-9]{8}T[0-9]{6}Z$ ]]; A=/home/arm/b1a-r6r-$STAMP; D=/home/arm/backups/afldb-b1a-$STAMP
REL=docs/v2/evidence/remediation-20261114/run6r/b1a
echo "== P3 §5.2 $(date -u +%FT%TZ)"
chmod 700 "$A"; chmod 600 "$A"/*
[ "$(ls -1 "$A" | wc -l)" = 4 ]
( cd "$A" && sha256sum -c - <<'EOF'
bcc4131171a08500cc3b4b64ee51d254a5f0608f450847f17e95a06f62f8c32c  b1a-repair-2026-r6r.mts
dc6211d7826d03712ab95a872889a562b86c5a86b72a4fc717431005b5033ec7  b1a-accept-r6r.sql
e8343ae635288781ff2e5b2957cafa40287f0bfce6dc77f1b87f555c2cd616f3  b1a-reverse-r6r.sql
7c2a7be0eca0ed1f7024ccc6197b333818caadb7727f2f3be49ae97eb70fcf5d  b1a0-parity.sql
EOF
)
[ "$(git rev-parse HEAD)" = "$CP" ] && [ -z "$(git status --porcelain)" ] && [ ! -e "$REL" ]
mkdir -p "$REL" && install -m 0644 "$A/b1a-repair-2026-r6r.mts" "$A/b1a-accept-r6r.sql" "$REL/"
sha256sum "$REL"/*
echo "PASS artifacts verified and installed untracked"

echo "== P3 §5.1 dump $(date -u +%FT%TZ)"
[ ! -e "$D" ]
bash tools/maintenance/backup.sh --dir "$D" --keep 1000
[ "$(ls -1 "$D"/*.dump | wc -l)" = 1 ]; F=$(ls -1 "$D"/afldb_prod-*.dump); B=$(basename "$F")
(cd "$D" && sha256sum "$B" > "$B.sha256" && chmod 600 "$B.sha256")
echo "DUMP $F"; echo "SHA256 $(cut -d' ' -f1 "$F.sha256")"; echo "BYTES $(stat -c %s "$F")"
pg_restore --list "$F" | sed -n '1,20p' | grep -E 'dbname: afldb_prod|Archive created|TOC Entries'
pg_restore --list "$F" | grep -E '^; +dbname: afldb_prod$' > /dev/null; echo "PASS header dbname afldb_prod"   # not grep -q: SIGPIPE under pipefail
echo "objects $(pg_restore --list "$F" | grep -cE '^[0-9]+;')"
pg_restore --list "$F" | grep -E 'TABLE DATA public (player_season_stats|stat_availability|brownlow_season_votes|auth_users|data_edits) '
pg_restore --data-only --table=player_season_stats --file=- "$F" | awk -F'\t' '
  /^COPY public.player_season_stats /{s=$0;sub(/^[^(]*\(/,"",s);sub(/\).*/,"",s);n=split(s,c,", ");
    for(i=1;i<=n;i++){if(c[i]=="season")si=i;if(c[i]=="brownlow_status")bi=i;if(c[i]=="brownlow_votes")vi=i};on=1;next}
  on&&/^\\\.$/{on=0;next} on&&$si==2026{k[$bi]++;if($vi!="\\N")nn++} END{for(x in k)print "dump2026",x,k[x];print "dump2026 votes_non_null",nn+0}'
du -h "$F"

echo "== P3 §5.1 captures $(date -u +%FT%TZ)"
( set -a && . ./.env && set +a
  pgconn() { local d="${!1}" re='^(postgres(ql)?://)([^:/@]+):([^@]*)@(.*)$'; [[ $d =~ $re ]] || { echo "bad DSN shape in $1" >&2; return 1; }
    printf -v PGPASSWORD '%b' "${BASH_REMATCH[4]//\%/\\x}"; export PGPASSWORD; DSN="${BASH_REMATCH[1]}${BASH_REMATCH[3]}@${BASH_REMATCH[5]}"; }
  pgconn AFLDB_BACKUP_DATABASE_URL
  PGOPTIONS='-c default_transaction_read_only=on' psql -X -v ON_ERROR_STOP=1 -At -d "$DSN" -f "$A/b1a0-parity.sql" > "$D/parity-prod.txt"
  PGOPTIONS='-c default_transaction_read_only=on' psql -X -v ON_ERROR_STOP=1 -At -v db=afldb_prod -v oid=66668 \
    -v sysid=7674454702926115004 -d "$DSN" -f "$A/b1a-accept-r6r.sql" > "$D/accept-before-prod.txt" )
chmod 600 "$D"/*.txt
echo "--- parity-prod.txt"; cat "$D/parity-prod.txt"
echo "--- accept-before-prod.txt (THE BEFORE CAPTURE)"; cat "$D/accept-before-prod.txt"
# Packet 6R §5.1 expected lines (any difference: STOP B1a; §4.2 decides S3). H1/H3 may legitimately differ from the 4 Nov snapshot.
X="$D/accept-before-prod.txt"; ok=1
for want in 'identity|afldb_prod|66668|7674454702926115004' 'pss2026|not_applicable|669|0' 'ids2026|669|e5ead8dbf3baf9a7b647b0f55b04c496' \
    'cov2026|brownlow_match_votes|pending|f|-|-' 'cov2026|brownlow_round_votes|pending|f|-|-' 'cov2026|brownlow_season_total|pending|f|-|-' 'na_cov|0|12'; do
  grep -qxF "$want" "$X" && echo "  ok   $want" || { echo "  DIFF $want"; ok=0; }; done
[ "$(grep -c '^pss2026|' "$X")" = 1 ] && echo "  ok   single pss2026 line" || { echo "  DIFF pss2026 has more than one status"; ok=0; }
grep -qE '^inputs2026\|complete/0/9522/.*/0$' "$X" && echo "  ok   $(grep '^inputs2026|' "$X")" || { echo "  DIFF $(grep '^inputs2026|' "$X")"; ok=0; }
grep -qE '^na_pss\|669\|[0-9]+$' "$X" && echo "  ok   $(grep '^na_pss|' "$X")" || { echo "  DIFF $(grep '^na_pss|' "$X")"; ok=0; }
[ $ok = 1 ] && echo "BEFORE-CHECK PASS" || echo "BEFORE-CHECK FAIL: do not run B1a (packet 6R §4.2)"
ls -la "$D"
echo "P3 RESULT done (read BEFORE-CHECK)"
}
main "$@" < /dev/null
