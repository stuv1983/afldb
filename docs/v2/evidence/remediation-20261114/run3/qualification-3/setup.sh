#!/usr/bin/env bash
# remediation run 3, scope qual: workspace setup for the final integrated qualification of Q' (clone, npm ci, cluster, template).
# Adapted from run2/qualification-2/setup.sh.txt (workspace, ports, lock, template and bundle names are run 3's).
#
#   mkdir /mnt/ssd/afldb-rem3-qual-20261114 /mnt/ssd/afldb-rem3-qual-20261114/in     (plain mkdir: it must NOT exist yet)
#   scp this script and the bundle (qual.bundle = `git bundle create de640826..claude/rem3-qual-20261114`) into $W/in/
#   Q=<Q' sha> BUNDLE_SHA=<sha256 of qual.bundle> bash $W/in/setup.sh clone cluster template
#
# Every phase refuses on any failed guard and prints what it verified. Never prints a password or a DSN.
set -u -o pipefail
export W=/mnt/ssd/afldb-rem3-qual-20261114
export PATH="$HOME/.nvm/versions/node/v22.23.2/bin:$PATH"
export PYTHON=/home/arm/i250/afldb/.venv/bin/python AFLDB_PYTHON=/home/arm/i250/afldb/.venv/bin/python
export AFLDB_V2_PG_ROOT=${W}-pg AFLDB_V2_PG_BIN=/usr/lib/postgresql/16/bin AFLDB_V2_PG_PORT=55674
: "${Q:?set Q to the full qualification commit sha}" "${BUNDLE_SHA:?set BUNDLE_SHA to the bundle sha256}"
DUMP=/mnt/ssd/afldb/workspaces/afldb-issue333-o2-20261104/private/afldb_prod-20261104T021037Z.dump
DUMP_SHA=e77c307d3e0cddcb652e398a946e4c22c2063f13c70edadf96a975c92842826d
DUMP_BYTES=30141895
BUNDLE=$W/in/qual.bundle
PORT=55674
LOCK=/mnt/ssd/afldb-rem3-base/heavy.lock
CAND=$W/cand
TMPL=afldb_v2_rem3qual_tmpl_test
BASE_PKG_REV=6d5388ea5305e73b0420fbccfa7b0cea4fe75927
mkdir -p "$W/evidence"
IR() { (cd "$CAND" && node --import tsx tools/v2/isolated-pg.ts "$@"); }
RUNDB() { local db="$1"; shift; (cd "$CAND" && node --import tsx tools/v2/isolated-pg.ts run "$db" -- "$@"); }
strip() { sed 's/\x1b\[[0-9;]*m//g' | grep -a -v -i 'postgres://'; }

phase_clone() {
  [ "$(stat -c %s "$DUMP")" = "$DUMP_BYTES" ] || { echo "snapshot size mismatch"; return 1; }
  [ "$(sha256sum "$DUMP" | cut -d' ' -f1)" = "$DUMP_SHA" ] || { echo "snapshot sha256 mismatch"; return 1; }
  echo "snapshot verified: $DUMP_BYTES bytes sha256 $DUMP_SHA"
  [ "$(sha256sum "$BUNDLE" | cut -d' ' -f1)" = "$BUNDLE_SHA" ] || { echo "bundle sha256 mismatch"; return 1; }
  echo "bundle verified: sha256 $BUNDLE_SHA"
  if ss -ltnH 2>/dev/null | awk '{print $4}' | grep -E ":($PORT|55676|55677)$"; then echo "port in use"; return 1; fi
  [ ! -e "$CAND" ] || { echo "checkout already exists: workspace is not fresh"; return 1; }
  git clone -q /mnt/ssd/afldb-review-20261114T0640Z/cand "$CAND" || return 1
  cd "$CAND" || return 1
  git bundle verify "$BUNDLE" 2>&1 | tail -2
  git fetch -q "$BUNDLE" claude/rem3-qual-20261114:refs/heads/qual || return 1
  git checkout -q --detach "$Q" || return 1
  echo "HEAD=$(git rev-parse HEAD) want=$Q"
  [ "$(git rev-parse HEAD)" = "$Q" ] || { echo "HEAD MISMATCH"; return 1; }
  [ ! -e "$CAND/.env" ] || { echo ".env present: refusing"; return 1; }
  git diff --quiet "$BASE_PKG_REV" "$Q" -- package.json package-lock.json && echo "package.json and package-lock.json unchanged since $BASE_PKG_REV" \
    || { echo "PACKAGE FILES DIFFER from $BASE_PKG_REV"; git diff --stat "$BASE_PKG_REV" "$Q" -- package.json package-lock.json; }
  timeout 900 npm ci --no-audit --no-fund 2>&1 | tail -4
  echo "porcelain lines: $(git status --porcelain | wc -l)"
  [ "$(git status --porcelain | wc -l)" = 0 ] || return 1
}
phase_cluster() {
  [ ! -e "$AFLDB_V2_PG_ROOT" ] || { echo "cluster root already exists: not fresh"; return 1; }
  IR init || return 1
  IR start > "$W/evidence/pg-start.out" 2>&1 < /dev/null
  sleep 3
  IR roles && IR status || return 1
  ss -ltnp 2>/dev/null | grep ":$PORT "
}
phase_template() {
  IR create-db "$TMPL" || return 1
  flock "$LOCK" nice -n 10 bash -c "cd $CAND && node --import tsx tools/v2/isolated-pg.ts run $TMPL -- node /mnt/ssd/afldb-review-20261114T0640Z/in/restore.mjs $DUMP $DUMP_SHA" || return 1
  RUNDB "$TMPL" node --import tsx tools/db/migrate.ts --target test 2>&1 | strip | tail -6
  cp /mnt/ssd/afldb-review-20261114T0640Z/in/probe-dbs.mjs "$CAND/.probe-dbs.mjs"
  RUNDB "$TMPL" node .probe-dbs.mjs "$TMPL" | tee "$W/evidence/tmpl-probe.txt"
  rm -f "$CAND/.probe-dbs.mjs"
  grep '"ledger":"118_fixtures_unconfirmed_participants.sql"' "$W/evidence/tmpl-probe.txt" > /dev/null || { echo "ledger is not 118"; return 1; }
  echo "ledger 118 confirmed; porcelain lines: $(git -C "$CAND" status --porcelain | wc -l)"
}
for ph in "$@"; do echo "== $ph $(date -u +%FT%TZ)"; "phase_$ph" || { echo "FAILED $ph"; exit 1; }; done
echo SETUP-DONE
