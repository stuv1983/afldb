#!/usr/bin/env bash
# AFLDB-ISSUE-366 §4 successor block P10 = run6/public/PUBLIC-CHECKS.md §4 (S9b player-page checks). PRODUCTION, as arm, read-only:
# one read-only DB query (backup role) to choose the player paths, then loopback requests with a 15-minute beta claim minted from
# .env (cookie file 600, removed at the end; never sent over the public route).
#   MODE=baseline (before the B1a commit: the OLD text) or after (S9b: the NEW text) on all 16 samples of each of 4 players.
# Unlike packet 6R P10, the three controls are part of the verdict, each recorded separately:
#   anonymous /players/<A>    307 with Location <origin>/beta?from=%2Fplayers%2F<A>
#   /seasons/2026 (admitted)  200 and the no-votes text
#   /brownlow/2026 (admitted) 404
# Any failed or missing check: P10 RESULT ... FAIL and exit 1. The owner's signed-in browser check is a separate MANUAL result that
# this block never records as passed.
# Run: tr -d '\r' < p10-pages.sh | ssh afldb bash -s -- <baseline|after>
main() {
set -euo pipefail; export LC_ALL=C
trap 'echo "STOP line $LINENO: $BASH_COMMAND"' ERR
C=${B1A_CHECKOUT:-/home/arm/projects/afldb}; NODE=${B1A_NODE_BIN:-/home/arm/.nvm/versions/node/v22.23.2/bin}/node; cd "$C"
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
for s in $SEL; do [[ $s =~ ^[a-z0-9-]+-[0-9]+$ ]]; done
P=$(sed -n 's/^PORT=//p' "$C/.env" | tail -1 | tr -d '"'); P=${P:-3100}
CK=$(mktemp); chmod 600 "$CK"; T=$(mktemp); chmod 600 "$T"
( set -a; . "$C/.env"; set +a; "$NODE" -e 'const{createHmac}=require("crypto");const e=process.env;
const p=Buffer.from(JSON.stringify({v:1,kind:"beta",sub:"b1a-check",exp:Math.floor(Date.now()/1000)+900,epoch:Number(e.AFLDB_BETA_EPOCH??1)}));
process.stdout.write("afldb_beta="+p.toString("base64url")+"."+createHmac("sha256",e.AFLDB_SESSION_SECRET).update(p).digest().toString("base64url"))' ) > "$CK"
hit() { curl -s -m 60 -H "Cookie: $(cat "$CK")" -o "$T" -w '%{http_code}' "http://127.0.0.1:$P$1" || true; }
cnt() { grep -o "$1" "$T" | wc -l || true; }
for s in $SEL; do for i in $(seq 1 12); do hit "/players/$s" >/dev/null; done; done   # warm-up pass
bad=0; n=0
for s in $SEL; do for i in $(seq 1 16); do c=$(hit "/players/$s"); n=$((n+1))
  ny=$(cnt 'Not yet awarded'); pn=$(cnt 'still in progress; the Brownlow Medal has not been awarded'); nm=$(cnt 'No medal'); na=$(cnt 'No Brownlow Medal was awarded for this season')
  echo "/players/$s $c notyet=$ny pendnote=$pn nomedal=$nm nanote=$na"
  if [ "$MODE" = after ]; then { [ "$c" = 200 ] && [ "$ny" -ge 1 ] && [ "$pn" -ge 1 ] && [ "$nm" = 0 ] && [ "$na" = 0 ]; } || bad=$((bad+1))
  else { [ "$c" = 200 ] && [ "$nm" -ge 1 ] && [ "$na" -ge 1 ] && [ "$ny" = 0 ]; } || bad=$((bad+1)); fi
done; done
A1=$(echo "$SEL" | head -n 1)
# Control 1: anonymous (no cookie) player page -> 307 to the beta gate with the encoded return path.
anon=$(curl -s -m 60 -o /dev/null -w '%{http_code} %{redirect_url}' "http://127.0.0.1:$P/players/$A1" || true)
ac=${anon%% *}; al=${anon#"$ac"}; al=${al# }
want="/beta?from=%2Fplayers%2F$A1"
[[ $al =~ ^https?://[^/]+(/.*)$ ]] && apath=${BASH_REMATCH[1]} || apath=
[ "$ac" = 307 ] && [ "$apath" = "$want" ] && aok=PASS || aok=FAIL
# Control 2: admitted /seasons/2026 -> 200 with the no-votes text (counted before the next request overwrites the body).
sc=$(hit /seasons/2026); nv=$(cnt 'No votes recorded for')
[ "$sc" = 200 ] && [ "$nv" -ge 1 ] && sok=PASS || sok=FAIL
# Control 3: admitted /brownlow/2026 -> 404.
bc=$(hit /brownlow/2026); [ "$bc" = 404 ] && bok=PASS || bok=FAIL
rm -f "$CK" "$T"
[ "$n" = 64 ] && [ "$bad" = 0 ] && pok=PASS || pok=FAIL
echo "P10 CHECK players     $pok samples=$n bad=$bad (expected 64 samples, 0 bad)"
echo "P10 CHECK anon        $aok code=$ac location=${al:-none} (expected 307 to <origin>$want)"
echo "P10 CHECK season2026  $sok code=$sc novotes=$nv (expected 200, novotes>=1)"
echo "P10 CHECK brownlow2026 $bok code=$bc (expected 404)"
echo "P10 CHECK manual-browser NOT-RECORDED (the owner's signed-in browser check is a separate manual result)"
pass=false; [ $pok$aok$sok$bok = PASSPASSPASSPASS ] && pass=true
printf 'P10 VERDICT {"mode":"%s","players":{"result":"%s","samples":%s,"bad":%s},"anon":{"result":"%s","code":"%s","location":"%s"},"season2026":{"result":"%s","code":"%s","novotes":%s},"brownlow2026":{"result":"%s","code":"%s"},"manualBrowser":"not-recorded","pass":%s}\n' \
  "$MODE" "$pok" "$n" "$bad" "$aok" "$ac" "$al" "$sok" "$sc" "${nv:-0}" "$bok" "$bc" "$pass"
if [ $pass = true ]; then echo "P10 RESULT $MODE PASS (64 samples, 3 controls)"; exit 0; fi
echo "P10 RESULT $MODE FAIL: players $pok, anon $aok, season2026 $sok, brownlow2026 $bok"; exit 1
}
main "$@" < /dev/null
