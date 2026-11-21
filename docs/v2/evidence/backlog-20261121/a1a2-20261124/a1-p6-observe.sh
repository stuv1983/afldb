#!/usr/bin/env bash
# Sitting A1, block P6: about 30 minutes of observation, READ-ONLY, in ONE connection: four ticks 10 minutes apart (unit state,
# InvocationID unchanged, NRestarts 0, loopback health, /seasons/2026 and /brownlow/2026 200 with a minted 15-minute beta claim,
# not-found title absent, journal error lines for afldb since the restart when readable), then release.mjs status.
# Runs while A2's R1/R2/R3 proceed (none touches the service or Caddy); R4 (Caddy reload) starts only after this block ends.
# A tick not OK = rollback trigger (crash restart, errors), decided with the owner.
# Run: tr -d '\r' < a1-p6-observe.sh | C:/Windows/System32/OpenSSH/ssh.exe -o BatchMode=yes afldb bash -s -- <NEW_ID>
main() {
set -euo pipefail; export LC_ALL=C
trap 'echo "STOP line $LINENO: $BASH_COMMAND"' ERR
N=/home/arm/.nvm/versions/node/v22.23.2/bin/node; C=/home/arm/projects/afldb; cd "$C"
NEW_ID=${1:?NEW_ID}; [[ $NEW_ID =~ ^7d92042fd110-[A-Za-z0-9_-]{1,64}$ ]]
P=$(sed -n 's/^PORT=//p' "$C/.env" | tail -1 | tr -d '"'); P=${P:-3100}
INV0=$(systemctl show afldb -p InvocationID --value); SINCE=$(systemctl show afldb -p ActiveEnterTimestamp --value)
bad=0; T=$(mktemp); chmod 600 "$T"
for t in 0 1 2 3; do
  [ $t = 0 ] || sleep 600
  CK=$(mktemp); chmod 600 "$CK"
  ( set -a; . "$C/.env"; set +a; "$N" -e 'const{createHmac}=require("crypto");const e=process.env;
  const p=Buffer.from(JSON.stringify({v:1,kind:"beta",sub:"a1-observe",exp:Math.floor(Date.now()/1000)+900,epoch:Number(e.AFLDB_BETA_EPOCH??1)}));
  process.stdout.write("afldb_beta="+p.toString("base64url")+"."+createHmac("sha256",e.AFLDB_SESSION_SECRET).update(p).digest().toString("base64url"))' ) > "$CK"
  S=$(systemctl show afldb -p ActiveState -p NRestarts -p InvocationID -p MemoryCurrent | tr '\n' ' ')
  H=$(curl -s -m 20 "http://127.0.0.1:$P/api/health" || true)
  G1=$(curl -s -m 60 -o "$T" -w '%{http_code}' -H "Cookie: $(cat "$CK")" "http://127.0.0.1:$P/seasons/2026" || true); NF1=$(grep -c 'Page not found' "$T" || true)
  G2=$(curl -s -m 60 -o "$T" -w '%{http_code}' -H "Cookie: $(cat "$CK")" "http://127.0.0.1:$P/brownlow/2026" || true); NF2=$(grep -c 'Page not found' "$T" || true)
  rm -f "$CK"
  J=$(journalctl -u afldb --since "$SINCE" -p err -q --no-pager 2>/dev/null | wc -l || echo unreadable)
  echo "tick $t $(date -u +%FT%TZ) $S health=$H seasons=$G1/nf$NF1 brownlow=$G2/nf$NF2 journal_err_lines=$J"
  { [[ $S == *ActiveState=active* ]] && [[ $S == *NRestarts=0* ]] && [[ $S == *"InvocationID=$INV0"* ]] && [[ $H == *'"status":"ok"'* ]] \
    && [ "$G1" = 200 ] && [ "$G2" = 200 ] && [ "$NF1" = 0 ] && [ "$NF2" = 0 ] && { [ "$J" = 0 ] || [ "$J" = unreadable ]; }; } || { echo "  TICK $t NOT OK"; bad=$((bad+1)); }
done
rm -f "$T"
echo "== final status $(date -u +%FT%TZ)"
"$N" deploy/release.mjs status
if [ $bad = 0 ]; then echo "P6 RESULT OBSERVATION PASS (4 ticks)"; else echo "P6 RESULT $bad tick(s) not OK"; exit 1; fi
}
main "$@" < /dev/null
