#!/usr/bin/env bash
# Rehearsal of the DEV deployment's step 2 (dev-backup-verify.sh) exactly as written, plus the cookie-capable smoke script.
set -u -o pipefail
umask 077
W=/mnt/ssd/afldb/workspaces/i336-backup-rehearsal-20261106
P1=/mnt/ssd/afldb/workspaces/i336-preview-20261106
CO=/mnt/ssd/afldb/workspaces/i336-preview2-20261106/checkout
export PATH="$HOME/.nvm/versions/node/v22.23.2/bin:$PATH"
cd "$W" && tar -xf scripts.tar && sed -i 's/\r$//' scripts/*.sh scripts/*.mjs scripts/*.cjs
devhealth() { echo "afldb=$(systemctl is-active afldb) mainpid=$(systemctl show afldb -p MainPID --value) health=$(curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1:3100/api/health) head=$(git -C $HOME/projects/afldb rev-parse HEAD) porcelain=$(git -C $HOME/projects/afldb status --porcelain | wc -l) build_id=$(cat $HOME/projects/afldb/.next/BUILD_ID) timers=$(systemctl is-active afldb-settle-afl-api.timer)/$(systemctl is-active afldb-settle-afl-api-brownlow.timer)"; }
echo "== $(date -u +%FT%TZ) DEV health before"; devhealth
OUT=$W/out/dev-pre-v2-rehearsal
echo "== $(date -u +%FT%TZ) dump"
bash scripts/dev-backup-verify.sh dump "$OUT"; echo "dump rc=$?"
echo "== $(date -u +%FT%TZ) verify"
AFLDB_V2_PG_ROOT=$P1/pg-root AFLDB_V2_PG_BIN=/usr/lib/postgresql/16/bin AFLDB_V2_PG_PORT=55499 bash scripts/dev-backup-verify.sh verify "$OUT" "$CO"; echo "verify rc=$?"
[ -n "$(git -C "$CO" status --porcelain)" ] && echo "candidate checkout NOT clean" || echo "candidate checkout clean"
DB=$(grep -oE 'afldb_v2_devbk[0-9]+_test' "$OUT"/../../rehearsal.out 2>/dev/null | head -1)
echo "== $(date -u +%FT%TZ) smoke.sh (cookie-capable copy) against the candidate on 33362, no cookie"
bash scripts/smoke.sh 33362 > "$W/smoke-33362-newscript.txt" 2>&1
diff <(cut -d' ' -f1,3- /mnt/ssd/afldb/workspaces/i336-preview2-20261106/evidence/smoke-33362.txt) <(cut -d' ' -f1,3- "$W/smoke-33362-newscript.txt") && echo "smoke identical to the original script's"
echo "== $(date -u +%FT%TZ) DEV health after"; devhealth
echo REHEARSAL-DONE
