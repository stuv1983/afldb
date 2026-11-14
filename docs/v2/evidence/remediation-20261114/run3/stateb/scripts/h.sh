#!/usr/bin/env bash
# AFLDB remediation run 3, scope stateb: host helper. Usage: bash h.sh <phase> [args]
# Everything under $W on /mnt/ssd. No sudo. Own loopback cluster on port 55671, databases afldb_v2_rem3stateb*_test only.
set -u -o pipefail
W=/mnt/ssd/afldb-rem3-stateb-20261114
PORT=55671
export PATH="$HOME/.nvm/versions/node/v22.23.2/bin:$PATH"
export PYTHON=/home/arm/i250/afldb/.venv/bin/python AFLDB_PYTHON=/home/arm/i250/afldb/.venv/bin/python
export AFLDB_V2_PG_ROOT="$W-pg" AFLDB_V2_PG_PORT=$PORT AFLDB_V2_PG_BIN=/usr/lib/postgresql/16/bin
DUMP=/mnt/ssd/afldb/workspaces/afldb-issue333-o2-20261104/private/afldb_prod-20261104T021037Z.dump
DUMP_SHA=e77c307d3e0cddcb652e398a946e4c22c2063f13c70edadf96a975c92842826d
DUMP_BYTES=30141895
BUNDLE=/mnt/ssd/afldb-rem3-base/base-6d5388ea.bundle
BUNDLE_SHA=0a1b46d187a4173cef5bef0833fb8ad621d58116dcd5c4026b4dc494f9ccbf68
BASE_SHA=6d5388ea5305e73b0420fbccfa7b0cea4fe75927
TMPL=afldb_v2_rem3stateb_tmpl_test
CAND="${CAND:-$W/cand}"
EV="$W/evidence"
IR() { (cd "$CAND" && node --import tsx tools/v2/isolated-pg.ts "$@"); }
RUNDB() { local db="$1"; shift; (cd "$CAND" && node --import tsx tools/v2/isolated-pg.ts run "$db" -- "$@"); }
strip() { sed 's/\x1b\[[0-9;]*m//g' | grep -v -i 'postgres://'; }

ph="${1:-}"; shift || true
case "$ph" in
setup)
  mkdir -p "$W/in" "$EV"
  [ "$(sha256sum "$BUNDLE" | cut -d' ' -f1)" = "$BUNDLE_SHA" ] || { echo "bundle sha mismatch"; exit 1; }
  git clone -q /mnt/ssd/afldb-review-20261114T0640Z/cand "$W/cand" || exit 1
  cd "$W/cand" || exit 1
  git fetch -q "$BUNDLE" claude/remediation-20261114:refs/heads/base || exit 1
  git checkout -q base || exit 1
  [ "$(git rev-parse HEAD)" = "$BASE_SHA" ] || { echo "HEAD != base"; exit 1; }
  echo "HEAD=$(git rev-parse HEAD) porcelain=$(git status --porcelain | wc -l) env_file=$(ls -a | grep -c '^\.env' || true)"
  cp /mnt/ssd/afldb-review-20261114T0640Z/in/restore.mjs /mnt/ssd/afldb-review-20261114T0640Z/in/probe-dbs.mjs "$W/in/"
  npm ci --no-audit --no-fund 2>&1 | tail -5
  echo "porcelain after npm ci: $(git status --porcelain | wc -l)"
  ;;
cluster)
  if ss -ltn 2>/dev/null | awk '{print $4}' | grep -E ":$PORT$"; then echo "port $PORT in use"; exit 1; fi
  IR init || exit 1
  IR start > "$EV/pg-start.out" 2>&1 < /dev/null
  sleep 3
  IR roles && IR status || exit 1
  pmpid=$(head -1 "$AFLDB_V2_PG_ROOT/data/postmaster.pid")
  ss -ltnp 2>/dev/null | grep ":$PORT " | tee "$EV/listener.txt"
  echo "postmaster pid $pmpid"
  [ "$(grep -c "127.0.0.1:$PORT " "$EV/listener.txt")" = 1 ] && [ "$(grep -c "pid=$pmpid," "$EV/listener.txt")" = 1 ] || { echo "listener not exactly ours"; exit 1; }
  ;;
template)
  [ "$(stat -c %s "$DUMP")" = "$DUMP_BYTES" ] || { echo "snapshot size mismatch"; exit 1; }
  [ "$(sha256sum "$DUMP" | cut -d' ' -f1)" = "$DUMP_SHA" ] || { echo "snapshot sha256 mismatch"; exit 1; }
  echo "snapshot verified $DUMP_SHA"
  IR create-db "$TMPL" || exit 1
  RUNDB "$TMPL" node "$W/in/restore.mjs" "$DUMP" "$DUMP_SHA" || exit 1
  RUNDB "$TMPL" node --import tsx tools/db/migrate.ts --target test 2>&1 | strip | tail -6
  cp "$W/in/probe-dbs.mjs" "$CAND/.probe-dbs.mjs"
  RUNDB "$TMPL" node .probe-dbs.mjs "$TMPL" | tee "$EV/tmpl-probe.txt"
  rm -f "$CAND/.probe-dbs.mjs"
  grep '"ledger":"118_fixtures_unconfirmed_participants.sql"' "$EV/tmpl-probe.txt" >/dev/null || { echo "template ledger is not 118"; exit 1; }
  ;;
fresh)   # fresh template copy: h.sh fresh <db>
  IR create-db "$1" --template "$TMPL" ;;
drop)    # h.sh drop <db>
  IR drop-db "$1" --acknowledge-destroy "$1" ;;
list) IR list ;;
stop)
  IR stop || true
  sleep 2
  if ss -ltn | awk '{print $4}' | grep -E ":$PORT$"; then echo "port still listening"; exit 1; fi
  echo "no listener on $PORT"; pgrep -u arm -af "$W" || echo "no process matching $W"; du -sh "$W" "$W-pg" | tail -2
  ;;
*) echo "unknown phase '$ph'"; exit 2 ;;
esac
