:
{
# ISSUE-333 (O1) + O2 production-side READ-ONLY operations: prep (private pinned ops checkout), plan-i333, plan-o2. NO apply mode exists here.
# DERIVED from the reviewed docs/v2/evidence/gap029-block-l-20261102/scripts/prod-ops.sh (prep unchanged apart from the directory and the core.tar
# check; the plan phases call the two python ceremonies with the production venv).
#   bash prod-ops-i333-o2.sh prep     <R> <cand-tar-sha256>
#   bash prod-ops-i333-o2.sh plan-i333 <R> <stamp>        (in/backup-I333.json, in/restore-evidence.json, the dump in the backup directory)
#   bash prod-ops-i333-o2.sh plan-o2   <R> <stamp>        (in/backup-O2.json, ...)
# The primary production checkout is only READ (its node_modules is linked read-only into the private ops checkout; nothing in it, the serving
# release, the environment file, units or services is changed). DB access is the existing credential channel in the checkout .env, parsed into
# environment variables for the child process only (never argv, never printed). The plan connection is afldb_backup (read-only); the plan
# writes only its exclusive plan file (and, for I333, a fresh staging directory) under the ops workspace.
set -u -o pipefail
export LC_ALL=C
umask 077
step() { echo "== $* $(date -u +%FT%TZ)"; }
stop() { echo "STOP: $1"; exit "${2:-1}"; }
PHASE=${1:?phase}; R=${2:?revision}
[[ "$R" =~ ^[0-9a-f]{40}$ ]] || stop "revision must be 40 hex" 2
PROD=/home/arm/projects/afldb
PGBIN=/usr/lib/postgresql/16/bin
PY=$PROD/.venv/bin/python
OPS=/home/arm/ops/issue333-o2-${R:0:8}
CAND=$OPS/cand; EV=$OPS/evidence
CORE_SHA=9a989fdcf7177cff24bbedcd0ee4559b772ebc452c05dab331e128859e4db080
export PATH=/home/arm/.nvm/versions/node/v22.23.2/bin:$PATH PYTHONDONTWRITEBYTECODE=1
[ "$(hostname)" = afldb-prod ] && [ "$(id -un)" = arm ] || stop "unexpected host/user" 3
envval() { sed -n "s/^$1=//p" "$PROD/.env" | tail -1 | sed 's/^"\(.*\)"$/\1/'; }

case "$PHASE" in
prep)
  TAR_SHA=${3:?tar sha256}
  step "prep: verify upload, extract, pin"
  [ -f "$OPS/in/cand.tar.gz" ] || stop "upload missing" 3
  [ "$(sha256sum "$OPS/in/cand.tar.gz" | cut -d' ' -f1)" = "$TAR_SHA" ] || stop "cand.tar.gz sha256 mismatch" 3
  [ "$(sha256sum "$OPS/in/core.tar" | cut -d' ' -f1)" = "$CORE_SHA" ] || stop "core.tar sha256 mismatch" 3
  [ ! -e "$CAND" ] || stop "ops checkout already exists" 3
  mkdir -p -m 700 "$EV"
  tar xzf "$OPS/in/cand.tar.gz" -C "$OPS" || stop "extract failed" 3
  cd "$CAND" || stop "no checkout" 3
  [ "$(git rev-parse HEAD)" = "$R" ] || stop "HEAD is not $R" 3
  [ "$(git status --porcelain | wc -l)" = 0 ] || stop "ops checkout dirty" 3
  [ "$(sha256sum package-lock.json | cut -d' ' -f1)" = "$(sha256sum $PROD/package-lock.json | cut -d' ' -f1)" ] || stop "package-lock differs from the production checkout (node_modules not reusable)" 3
  [ "$(sha256sum package.json | cut -d' ' -f1)" = "$(sha256sum $PROD/package.json | cut -d' ' -f1)" ] || stop "package.json differs from the production checkout" 3
  ln -s "$PROD/node_modules" "$CAND/node_modules"
  echo node_modules >> "$CAND/.git/info/exclude"
  [ "$(git status --porcelain | wc -l)" = 0 ] || stop "node_modules link dirtied the tree" 3
  echo "ops_checkout=$CAND HEAD=$(git rev-parse HEAD) tracked=$(git ls-files | wc -l) dirty=0 node=$(node -v) python=$($PY -c 'import sys,psycopg;print(sys.version.split()[0],psycopg.__version__)')"
  echo "prod_checkout_unchanged: head=$(GIT_OPTIONAL_LOCKS=0 git -C $PROD rev-parse HEAD) status_lines=$(GIT_OPTIONAL_LOCKS=0 git -C $PROD status --porcelain | wc -l)"
  for t in tools/v2/issue333-coach-assignments-production.py tools/v2/o2-converged-findings-production.py; do echo "$t tool-hashes: $($PY $t tool-hashes | sha256sum | cut -c1-16)"; done
  ;;
plan-i333|plan-o2)
  STAMP=${3:?backup stamp}
  BDIR=/home/arm/backups/afldb/issue333-o2-$STAMP
  DUMP=$BDIR/afldb_prod-$STAMP.dump
  [ -f "$DUMP" ] || stop "backup dump missing" 3
  cd "$CAND" || stop "no ops checkout (run prep)" 3
  [ "$(git rev-parse HEAD)" = "$R" ] && [ "$(git status --porcelain | wc -l)" = 0 ] || stop "ops checkout not clean at $R" 3
  RE='^([a-z]+)://([^:@/]+)(:([^@]*))?@([^/:?]+)(:([0-9]+))?/([^?]+).*$'
  DSN=$(envval AFLDB_BACKUP_DATABASE_URL); [ -n "$DSN" ] || stop "backup credential missing" 2
  [[ "$DSN" =~ $RE ]] || stop "backup credential has an unexpected form (value not printed)" 2
  PGUSER=${BASH_REMATCH[2]}; PGHOST=${BASH_REMATCH[5]}; PGPORT=${BASH_REMATCH[7]:-5432}; PGDATABASE=${BASH_REMATCH[8]}; PWENC=${BASH_REMATCH[4]}
  PGPASSWORD=$(printf '%b' "${PWENC//\%/\\x}"); unset PWENC BASH_REMATCH DSN
  [ "$PGUSER" = afldb_backup ] && [ "$PGDATABASE" = afldb_prod ] && [ "$PGHOST" = localhost ] && [ "$PGPORT" = 5432 ] || stop "credential is not afldb_backup@localhost:5432/afldb_prod" 2
  export PGUSER PGHOST PGPORT PGDATABASE PGPASSWORD PGCONNECT_TIMEOUT=10
  RO='-c default_transaction_read_only=on -c statement_timeout=60000 -c lock_timeout=2000'
  LABEL=${PHASE#plan-}
  step "target identity from independent facts (read-only session)"
  [ -e "$EV/target-$LABEL.json" ] && stop "target file exists (evidence is never overwritten)" 3
  PGOPTIONS="$RO" PGAPPNAME=afldb-issue333-o2-target "$PGBIN/psql" -X -q -At -P pager=off -v ON_ERROR_STOP=1 -c "SELECT json_build_object('host', 'localhost', 'port', inet_server_port(), 'database', current_database(), 'user', current_user,
    'systemIdentifier', (SELECT system_identifier::text FROM pg_control_system()), 'databaseOid', (SELECT oid::text FROM pg_database WHERE datname=current_database()),
    'clusterName', current_setting('cluster_name'), 'databaseComment', shobj_description((SELECT oid FROM pg_database WHERE datname=current_database()),'pg_database'), 'transactionReadOnly', current_setting('transaction_read_only'))" > "$EV/target-$LABEL.raw.json" || stop "target query failed" 5
  cat "$EV/target-$LABEL.raw.json"
  node -e '
const fs=require("fs"); const t=JSON.parse(fs.readFileSync(process.argv[1],"utf8"));
if(t.transactionReadOnly!=="on"){console.error("the identity session was not read-only");process.exit(1);} delete t.transactionReadOnly;
const want={host:"localhost",port:5432,database:"afldb_prod",user:"afldb_backup",systemIdentifier:"7674454702926115004",databaseOid:"66668",clusterName:"16/main",databaseComment:null};
const bad=Object.keys(want).filter(k=>JSON.stringify(t[k])!==JSON.stringify(want[k]));
if(bad.length){console.error("target differs from the probe facts:",bad.join(","));process.exit(1);}
fs.writeFileSync(process.argv[2], JSON.stringify(t)+"\n", {flag:"wx", mode:0o600}); console.log("target equals the probe facts (sysid, oid, cluster, user)");' "$EV/target-$LABEL.raw.json" "$EV/target-$LABEL.json" || stop "target identity differs from the reviewed probe" 5
  unset PGPASSWORD
  export AFLDB_GAP029_DSN=$(envval AFLDB_BACKUP_DATABASE_URL)
  OUT="$EV/plan-$LABEL-$(date -u +%Y%m%dT%H%M%SZ).json"
  if [ "$PHASE" = plan-i333 ]; then
    step "I333 plan (read-only; writes only the plan file and a fresh staging directory)"
    "$PY" tools/v2/issue333-coach-assignments-production.py plan --target "$EV/target-$LABEL.json" --core-tar "$OPS/in/core.tar" \
      --staging-dir "$OPS/staging-$(date -u +%Y%m%dT%H%M%SZ)" --backup "$OPS/in/backup-I333.json" --backup-file "$DUMP" \
      --restore-evidence "$OPS/in/restore-evidence.json" --out "$OUT" || stop "plan refused" 6
  else
    step "O2 plan (read-only; writes only the plan file)"
    "$PY" tools/v2/o2-converged-findings-production.py plan --target "$EV/target-$LABEL.json" --backup "$OPS/in/backup-O2.json" --backup-file "$DUMP" \
      --restore-evidence "$OPS/in/restore-evidence.json" --out "$OUT" || stop "plan refused" 6
  fi
  unset AFLDB_GAP029_DSN
  chmod 600 "$OUT"; sha256sum "$OUT"
  "$PY" -c 'import json,sys; p=json.load(open(sys.argv[1])); print("PLAN", p["operation"], "digest", p["digest"], "createdAt", p["createdAt"], "expiresAt", p["expiresAt"], "revision", p["revision"], "readSession", json.dumps(p["readSession"], sort_keys=True))' "$OUT"
  step "post-run: ops checkout still clean"
  echo "head=$(git rev-parse HEAD) status_lines=$(git status --porcelain | wc -l)"
  ;;
*) stop "unknown phase" 2 ;;
esac
step DONE
}
