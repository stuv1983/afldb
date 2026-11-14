#!/usr/bin/env bash
# coleman276 host setup: checkout at B4, npm ci, cluster, two templates (accepted rebuild, 4 Nov snapshot).
set -uo pipefail
export PATH="$HOME/.nvm/versions/node/v22.23.2/bin:$PATH"
export PYTHON=/home/arm/i250/afldb/.venv/bin/python AFLDB_PYTHON=/home/arm/i250/afldb/.venv/bin/python
W=/mnt/ssd/afldb-rem4-coleman276-20261115
PGR=/mnt/ssd/afldb-rem4-coleman276-20261115-pg
PORT=55684
export AFLDB_V2_PG_ROOT=$PGR AFLDB_V2_PG_PORT=$PORT AFLDB_V2_PG_BIN=/usr/lib/postgresql/16/bin
B4=7cfbe186e70ca91db67da1aa4e28325ccbc32a86
RBD=/mnt/ssd/afldb-rem3-base/rebuilt
RB_DUMP=$RBD/afldb_v2_rb_rem3-6d5388ea.dump
RB_SHA=d8397aab92e3ce0cf2a640bb5daeac6594fb0e2c723dc410d82d8e718f165c63
SN_DUMP=/mnt/ssd/afldb/workspaces/afldb-issue333-o2-20261104/private/afldb_prod-20261104T021037Z.dump
SN_SHA=e77c307d3e0cddcb652e398a946e4c22c2063f13c70edadf96a975c92842826d
SN_BYTES=30141895
RBT=afldb_v2_rem4coleman276_rbtmpl_test
SNT=afldb_v2_rem4coleman276_sntmpl_test
LOCK=/mnt/ssd/afldb-rem4-base/heavy.lock
EV=$W/ev
IR() { node --import tsx tools/v2/isolated-pg.ts "$@"; }
mkdir -p "$W" "$EV"

phase_checkout() {
  mkdir -p "$W" "$EV" || return 1
  (cd /mnt/ssd/afldb-rem4-base && sha256sum -c SHA256SUMS) || return 1
  git clone -q /mnt/ssd/afldb-review-20261114T0640Z/cand "$W/cand" || return 1
  cd "$W/cand" || return 1
  git fetch -q /mnt/ssd/afldb-rem4-base/base-B4.bundle claude/remediation-20261114:refs/heads/base || return 1
  git checkout -q base || return 1
  [ "$(git rev-parse HEAD)" = "$B4" ] || { echo "HEAD != B4"; return 1; }
  git rev-parse HEAD
  npm ci --no-audit --no-fund 2>&1 | tail -5
  ls .env 2>/dev/null && { echo ".env present"; return 1; }
  return 0
}
phase_cluster() {
  cd "$W/cand" || return 1
  IR init || return 1
  IR start > "$EV/pg-start.out" 2>&1 < /dev/null
  sleep 3
  IR roles && IR status || return 1
  ss -ltnp 2>/dev/null | grep ":$PORT "
}
phase_rb() {
  cd "$W/cand" || return 1
  [ "$(sha256sum "$RB_DUMP" | cut -d' ' -f1)" = "$RB_SHA" ] || { echo "rb sha mismatch"; return 1; }
  flock "$LOCK" bash -c "cd $W/cand && export PATH=$PATH AFLDB_V2_PG_ROOT=$PGR AFLDB_V2_PG_PORT=$PORT AFLDB_V2_PG_BIN=$AFLDB_V2_PG_BIN && node --import tsx tools/v2/isolated-pg.ts create-db $RBT && node --import tsx tools/v2/isolated-pg.ts run $RBT -- node $RBD/restore-dump.mjs $RB_DUMP $RB_SHA" || return 1
  IR verify $RBT
}
phase_sn() {
  cd "$W/cand" || return 1
  [ "$(stat -c %s "$SN_DUMP")" = "$SN_BYTES" ] || { echo "sn size mismatch"; return 1; }
  [ "$(sha256sum "$SN_DUMP" | cut -d' ' -f1)" = "$SN_SHA" ] || { echo "sn sha mismatch"; return 1; }
  cp /mnt/ssd/afldb-review-20261114T0640Z/in/restore.mjs "$W/restore-snapshot.mjs"
  flock "$LOCK" bash -c "cd $W/cand && export PATH=$PATH AFLDB_V2_PG_ROOT=$PGR AFLDB_V2_PG_PORT=$PORT AFLDB_V2_PG_BIN=$AFLDB_V2_PG_BIN && node --import tsx tools/v2/isolated-pg.ts create-db $SNT && node --import tsx tools/v2/isolated-pg.ts run $SNT -- node $W/restore-snapshot.mjs $SN_DUMP $SN_SHA && node --import tsx tools/v2/isolated-pg.ts run $SNT -- node --import tsx tools/db/migrate.ts --target test" || return 1
  IR verify $SNT
}
for ph in "$@"; do
  echo "=== $ph $(date -u +%T)"
  "phase_$ph" 2>&1 | sed 's#postgres\(ql\)\?://[^ ]*#<dsn>#g' | tee -a "$EV/setup-$ph.log"
  rc=${PIPESTATUS[0]}
  echo "=== $ph rc=$rc $(date -u +%T)"
  [ $rc = 0 ] || exit $rc
done
