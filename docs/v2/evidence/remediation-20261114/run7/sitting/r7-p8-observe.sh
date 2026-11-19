#!/usr/bin/env bash
# Release 7, block P8 = S10 observation (>= 30 min), read-only, in ONE connection: four ticks 10 minutes apart (unit state,
# InvocationID unchanged, NRestarts 0, loopback health, one player page with a minted 15-minute beta claim, the D-365-W label present
# and the interim label absent on it), then the final release.mjs status (no --expect). PRODUCTION, as arm. Run in the background.
# Run: tr -d '\r' < r7-p8-observe.sh | ssh afldb bash -s -- <NEW_ID> <player path e.g. scott-pendlebury-11724>
main() {
set -euo pipefail; export LC_ALL=C
trap 'echo "STOP line $LINENO: $BASH_COMMAND"' ERR
N=/home/arm/.nvm/versions/node/v22.23.2/bin/node; C=/home/arm/projects/afldb; cd "$C"
NEW_ID=${1:?NEW_ID}; [[ $NEW_ID =~ ^0a308e2a046b-[A-Za-z0-9_-]{1,64}$ ]]; PL=${2:?player}; [[ $PL =~ ^[a-z0-9-]+-[0-9]+$ ]]
P=$(sed -n 's/^PORT=//p' "$C/.env" | tail -1 | tr -d '"'); P=${P:-3100}
INV0=$(systemctl show afldb -p InvocationID --value); bad=0; T=$(mktemp); chmod 600 "$T"
for t in 0 1 2 3; do
  [ $t = 0 ] || sleep 600
  CK=$(mktemp); chmod 600 "$CK"
  ( set -a; . "$C/.env"; set +a; "$N" -e 'const{createHmac}=require("crypto");const e=process.env;
  const p=Buffer.from(JSON.stringify({v:1,kind:"beta",sub:"r7-observe",exp:Math.floor(Date.now()/1000)+900,epoch:Number(e.AFLDB_BETA_EPOCH??1)}));
  process.stdout.write("afldb_beta="+p.toString("base64url")+"."+createHmac("sha256",e.AFLDB_SESSION_SECRET).update(p).digest().toString("base64url"))' ) > "$CK"
  S=$(systemctl show afldb -p ActiveState -p NRestarts -p InvocationID -p MemoryCurrent | tr '\n' ' ')
  H=$(curl -s -m 20 "http://127.0.0.1:$P/api/health" || true)
  G=$(curl -s -m 60 -o "$T" -w '%{http_code}' -H "Cookie: $(cat "$CK")" "http://127.0.0.1:$P/players/$PL" || true); rm -f "$CK"
  NL=$(grep -o 'Results not loaded' "$T" | wc -l || true); IY=$(grep -o 'Not yet awarded' "$T" | wc -l || true)
  echo "tick $t $(date -u +%FT%TZ) $S health=$H page=$G notloaded=$NL interim=$IY"
  { [[ $S == *ActiveState=active* ]] && [[ $S == *NRestarts=0* ]] && [[ $S == *"InvocationID=$INV0"* ]] && [[ $H == *'"status":"ok"'* ]] && [[ $H == *'"database":"ok"'* ]] && [ "$G" = 200 ] && [ "$NL" -ge 1 ] && [ "$IY" = 0 ]; } || { echo "  TICK $t NOT OK"; bad=$((bad+1)); }
done
rm -f "$T"
echo "== final status $(date -u +%FT%TZ)"
"$N" deploy/release.mjs status
if [ $bad = 0 ]; then echo "P8 RESULT OBSERVATION PASS (4 ticks)"; else echo "P8 RESULT $bad tick(s) not OK"; exit 1; fi
}
main "$@" < /dev/null
