#!/usr/bin/env bash
# Packet 6R sitting, block P10 = packet 6 §7 / run6/public/PUBLIC-CHECKS.md §4 (S9b player-page checks). PRODUCTION, as arm, read-only:
# one read-only DB query (backup role) to confirm the player paths, then loopback requests with a 15-minute beta claim minted from .env
# (cookie file 600, removed at the end; never sent over the public route). MODE=baseline (optional, before the B1a commit: expect the
# OLD text) or after (S9b, after S8: expect the NEW text on all 16 samples of each URL).
# Run: tr -d '\r' < p10-s9b-pages.sh | ssh afldb bash -s -- <baseline|after>
main() {
set -euo pipefail; export LC_ALL=C
trap 'echo "STOP line $LINENO: $BASH_COMMAND"' ERR
C=/home/arm/projects/afldb; NODE=/home/arm/.nvm/versions/node/v22.23.2/bin/node; cd "$C"
MODE=${1:?mode}; [[ $MODE =~ ^(baseline|after)$ ]]
echo "== P10 $MODE $(date -u +%FT%TZ)"
PATHS=$( ( set -a && . ./.env && set +a
  pgconn() { local d="${!1}" re='^(postgres(ql)?://)([^:/@]+):([^@]*)@(.*)$'; [[ $d =~ $re ]] || { echo "bad DSN shape in $1" >&2; return 1; }
    printf -v PGPASSWORD '%b' "${BASH_REMATCH[4]//\%/\\x}"; export PGPASSWORD; DSN="${BASH_REMATCH[1]}${BASH_REMATCH[3]}@${BASH_REMATCH[5]}"; }
  pgconn AFLDB_BACKUP_DATABASE_URL
  PGOPTIONS='-c default_transaction_read_only=on' psql -X -v ON_ERROR_STOP=1 -At -d "$DSN" <<'SQL'
\set QUIET on
BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY;
SELECT 'cand', p.slug||'-'||p.id, s.brownlow_status::text,
       (SELECT count(*) FROM player_season_stats o WHERE o.player_id = p.id AND (o.season < 1924 OR o.season BETWEEN 1942 AND 1945))
  FROM player_season_stats s JOIN players p ON p.id = s.player_id
 WHERE s.season = 2026 AND p.id IN (11724, 9910, 9235, 12446, 10130) ORDER BY p.id;
SELECT 'debut', p.slug||'-'||p.id, s.brownlow_status::text, 0
  FROM player_season_stats s JOIN players p ON p.id = s.player_id
 WHERE s.season = 2026 AND NOT EXISTS (SELECT 1 FROM player_season_stats o WHERE o.player_id = s.player_id AND o.season < 2026)
 ORDER BY p.id LIMIT 1;
ROLLBACK;
SQL
) )
echo "$PATHS"
# Pendlebury (likeliest prerendered) first, then the next two eligible candidates, then the debutant.
SEL=$( (echo "$PATHS" | awk -F'|' '$1=="cand" && $4==0 && $2 ~ /-11724$/ {print $2}'; echo "$PATHS" | awk -F'|' '$1=="cand" && $4==0 && $2 !~ /-11724$/ {print $2}' | head -n 2; echo "$PATHS" | awk -F'|' '$1=="debut"{print $2}') | head -n 4)
echo "selected: $(echo $SEL)"; [ "$(echo "$SEL" | wc -l)" = 4 ]
P=$(sed -n 's/^PORT=//p' "$C/.env" | tail -1 | tr -d '"'); P=${P:-3100}
CK=$(mktemp); chmod 600 "$CK"; T=$(mktemp); chmod 600 "$T"
( set -a; . "$C/.env"; set +a; "$NODE" -e 'const{createHmac}=require("crypto");const e=process.env;
const p=Buffer.from(JSON.stringify({v:1,kind:"beta",sub:"b1a-check",exp:Math.floor(Date.now()/1000)+900,epoch:Number(e.AFLDB_BETA_EPOCH??1)}));
process.stdout.write("afldb_beta="+p.toString("base64url")+"."+createHmac("sha256",e.AFLDB_SESSION_SECRET).update(p).digest().toString("base64url"))' ) > "$CK"
hit() { curl -s -m 60 -H "Cookie: $(cat "$CK")" -o "$T" -w '%{http_code}' "http://127.0.0.1:$P$1" || true; }
cnt() { grep -o "$1" "$T" | wc -l || true; }
for s in $SEL; do for i in $(seq 1 12); do hit "/players/$s" >/dev/null; done; done   # warm-up pass
bad=0
for s in $SEL; do for i in $(seq 1 16); do c=$(hit "/players/$s")
  ny=$(cnt 'Not yet awarded'); pn=$(cnt 'still in progress; the Brownlow Medal has not been awarded'); nm=$(cnt 'No medal'); na=$(cnt 'No Brownlow Medal was awarded for this season')
  echo "/players/$s $c notyet=$ny pendnote=$pn nomedal=$nm nanote=$na"
  if [ "$MODE" = after ]; then { [ "$c" = 200 ] && [ "$ny" -ge 1 ] && [ "$pn" -ge 1 ] && [ "$nm" = 0 ] && [ "$na" = 0 ]; } || bad=$((bad+1))
  else { [ "$c" = 200 ] && [ "$nm" -ge 1 ] && [ "$na" -ge 1 ] && [ "$ny" = 0 ]; } || bad=$((bad+1)); fi
done; done
A1=$(echo "$SEL" | head -n 1)
echo "anon $(curl -s -o /dev/null -w '%{http_code} %{redirect_url}' "http://127.0.0.1:$P/players/$A1")"
echo "s2026 $(hit /seasons/2026) novotes=$(cnt 'No votes recorded for') b2026=$(hit /brownlow/2026)"
rm -f "$CK" "$T"
[ $bad = 0 ] && echo "P10 RESULT $MODE PASS (64 samples)" || echo "P10 RESULT $MODE: $bad sample(s) not as expected"
}
main "$@" < /dev/null
