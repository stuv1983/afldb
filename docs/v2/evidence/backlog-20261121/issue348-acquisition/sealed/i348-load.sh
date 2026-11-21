#!/usr/bin/env bash
# AFLDB-ISSUE-348 F-348-1: sealed DraftGuru reload of annual-html-20261122 (SEALED-PLAN.md in this folder).
#
#   bash i348-load.sh verify          inputs: transfer tar digest, per-file sums, tool blob digests, python + psycopg
#   bash i348-load.sh digest pre      read-only surface digest; must equal expected-pre.txt (the R0 state) or STOP
#   bash i348-load.sh load            the ONE write: import_draftguru.py with the sealed reconciliation (no dry run)
#   bash i348-load.sh digest post     read-only surface digest; must equal expected-post.txt (the rehearsed after-state)
#
# Defaults are the production facts (tools/v2/gap029-ops/profile.production.env, R0-SITTING-20261122.md). A rehearsal
# overrides I348_ENV_FILE / I348_EXPECT_DB / I348_ROOT / I348_PYTHON / I348_EXPECT_HOST. Connection strings are read from
# the env file into the child environment only: never argv, never printed. Nothing here retries, rolls back or restores.
set -u -o pipefail
export LC_ALL=C
umask 077
ROOT=${I348_ROOT:-/home/arm/ops/i348}
ENV_FILE=${I348_ENV_FILE:-/home/arm/projects/afldb/.env}
EXPECT_DB=${I348_EXPECT_DB:-afldb_prod}
EXPECT_HOST=${I348_EXPECT_HOST:-afldb-prod}
PY=${I348_PYTHON:-/home/arm/projects/afldb/.venv/bin/python}
PGBIN=${I348_PGBIN:-/usr/lib/postgresql/16/bin}
SEAL=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
CAND=$ROOT/cand
TAR_SHA=478d4f809204f329251e9f58d03f1ab8a7491cb51f710c90a5b27f51aea77afb
SUMS_SHA=632aefe9024253acd86e967d9285f3f81656788cc20bdbc5a893d3d3de951326
RECON_SHA=cf49f6a5671155c174d60497372fbf9c1fd15fce01bd9f0d3f3dab8619e0de4e
CHILD_SHA=d6251609b12f48ad1c48a8bd33482820e606e123f9b12fa16a3769e6b7f15d6e
LABEL=annual-html-20261122
# The reviewed tool, by content (the commit id may change on publication; these blobs may not).
TOOLS="fd7b0abba14bba5de2f2436e60c5ddc6cc52a703204905075fe9750a980e19a2  tools/rebuild/draftguru/import_draftguru.py
af3874e77b9e0c7ebb0ee2fc6a9905c53df217aa802c9a194788b60b8968b21e  tools/rebuild/draftguru/reload_guard.py
6f2faa37ad44e0b8d548d71672ec33da49ba1df7f5c9e4cc1af5f7080621a046  tools/rebuild/draftguru/parse_draft_snapshot.py
cc5e0858c60499c61330363c82996b48ad52034b9e0b0177d638d99e1ee44296  tools/rebuild/draftguru/draftguru-contract.json
26ca190b3f0f9c7120c506289319b75118a79305c55767f9db7540d6ef22a27c  docs/rebuild-manifests/draftguru/annual-html-20261122.json"

step() { echo "== $* $(date -u +%FT%TZ)"; }
stop() { unset PGPASSWORD AFLDB_IMPORT_DATABASE_URL; echo "STOP: $1"; exit "${2:-20}"; }
envval() { sed -n "s/^$1=//p" "$ENV_FILE" | tail -1 | sed 's/^"\(.*\)"$/\1/'; }
RE='^([a-z]+)://([^:@/]+)(:([^@]*))?@([^/:?]+)(:([0-9]+))?/([^?]+).*$'
creds() {   # creds VAR ROLE: PG* for psql from the env file; refuses any other role or database
  local v; v=$(envval "$1"); [ -n "$v" ] || return 2
  [[ "$v" =~ $RE ]] || { unset v; return 3; }
  PGUSER=${BASH_REMATCH[2]}; PGHOST=${BASH_REMATCH[5]}; PGPORT=${BASH_REMATCH[7]:-5432}; PGDATABASE=${BASH_REMATCH[8]}
  PGPASSWORD=$(printf '%b' "${BASH_REMATCH[4]//\%/\\x}"); unset v BASH_REMATCH
  [ "$PGUSER" = "$2" ] && [ "$PGDATABASE" = "$EXPECT_DB" ] || return 4
  export PGUSER PGHOST PGPORT PGDATABASE PGPASSWORD PGCONNECT_TIMEOUT=10
}

[ "$(hostname)" = "$EXPECT_HOST" ] || stop "host is $(hostname), not $EXPECT_HOST" 3
[ -r "$ENV_FILE" ] || stop "env file unreadable" 3
PHASE=${1:?phase}

case "$PHASE" in
verify)
  step "verify sealed inputs"
  [ "$(sha256sum "$ROOT/in/i348-transfer.tar" | cut -d' ' -f1)" = "$TAR_SHA" ] || stop "transfer tar sha256 mismatch" 3
  [ "$(sha256sum "$SEAL/i348-transfer.SHA256SUMS" | cut -d' ' -f1)" = "$SUMS_SHA" ] || stop "transfer SHA256SUMS mismatch" 3
  [ -d "$ROOT/stage" ] || { mkdir -p "$ROOT/stage" && tar -xf "$ROOT/in/i348-transfer.tar" -C "$ROOT/stage"; } || stop "extract failed" 3
  (cd "$ROOT/stage" && sha256sum --quiet -c "$SEAL/i348-transfer.SHA256SUMS") || stop "a transferred file differs from the sealed sums" 3
  [ "$(find "$ROOT/stage" -type f | wc -l)" = 92 ] || stop "transfer holds files beyond the sealed 92" 3
  [ -d "$CAND" ] || stop "no candidate checkout at $CAND (extract the published revision there first)" 3
  (cd "$CAND" && printf '%s\n' "$TOOLS" | sha256sum --quiet -c -) || stop "candidate tool files are not the reviewed blobs" 3
  D=$CAND/data/sources/draftguru/$LABEL
  if [ ! -d "$D" ]; then mkdir -p "$(dirname "$D")" && cp -a "$ROOT/stage/data/sources/draftguru/$LABEL" "$D" || stop "page copy failed" 3; fi
  (cd "$CAND" && sed 's#  \./#  #' "$SEAL/i348-transfer.SHA256SUMS" | grep "  data/" | sha256sum --quiet -c -) || stop "candidate pages differ from the sealed sums" 3
  [ "$(sha256sum "$ROOT/stage/in/reconciliation-$LABEL.json" | cut -d' ' -f1)" = "$RECON_SHA" ] || stop "reconciliation sha256 mismatch" 3
  [ "$(sha256sum "$ROOT/stage/in/s2-child.json" | cut -d' ' -f1)" = "$CHILD_SHA" ] || stop "bridge child sha256 mismatch" 3
  PYTHONDONTWRITEBYTECODE=1 "$PY" -c 'import psycopg,sys;print("python", sys.version.split()[0], "psycopg", psycopg.__version__)' || stop "python has no psycopg" 3
  (cd "$CAND" && PYTHONDONTWRITEBYTECODE=1 "$PY" tools/rebuild/draftguru/import_draftguru.py --label "$LABEL" --validate-only) \
    || stop "offline validation of the pinned acquisition failed" 3
  echo "VERIFY OK"
  ;;
digest)
  TAG=${2:?pre|post}; [ "$TAG" = pre ] || [ "$TAG" = post ] || stop "tag must be pre or post" 2
  step "digest $TAG"
  creds AFLDB_BACKUP_DATABASE_URL afldb_backup || stop "backup DSN missing or not afldb_backup@$EXPECT_DB" 3
  PGOPTIONS='-c default_transaction_read_only=on -c statement_timeout=120000 -c lock_timeout=2000' PGAPPNAME=afldb-i348-digest \
    "$PGBIN/psql" -X -q -At -F '|' -v ON_ERROR_STOP=1 -f "$SEAL/draftguru-surface-digest.sql" > "$ROOT/digest-$TAG.txt" \
    || stop "digest query failed" 4
  unset PGPASSWORD
  cat "$ROOT/digest-$TAG.txt"
  if diff -u "$SEAL/expected-$TAG.txt" "$ROOT/digest-$TAG.txt"; then
    echo "DIGEST $TAG MATCHES"
    if [ "$TAG" = pre ]; then date -u +%FT%TZ > "$ROOT/pre.ok"; fi
  else
    rm -f "$ROOT/pre.ok"; stop "digest $TAG differs from the sealed expectation" 5
  fi
  ;;
load)
  step "load (the single write)"
  [ -f "$ROOT/pre.ok" ] || stop "no matching pre digest in this sitting: run 'digest pre' first" 5
  [ ! -e "$ROOT/load.done" ] || stop "load already ran in this sitting ($(cat "$ROOT/load.done")); never re-run" 5
  V=$(envval AFLDB_IMPORT_DATABASE_URL); [[ "$V" =~ $RE ]] && [ "${BASH_REMATCH[2]}" = afldb_import ] && [ "${BASH_REMATCH[8]}" = "$EXPECT_DB" ] \
    || { unset V BASH_REMATCH; stop "import DSN missing or not afldb_import@$EXPECT_DB" 3; }
  unset BASH_REMATCH
  date -u +%FT%TZ > "$ROOT/load.done"
  (cd "$CAND" && AFLDB_IMPORT_DATABASE_URL="$V" PYTHONDONTWRITEBYTECODE=1 "$PY" tools/rebuild/draftguru/import_draftguru.py \
      --label "$LABEL" --bridge "$ROOT/stage/in/s2-child.json" --no-seed \
      --guard-report "$ROOT/guard-load.json" \
      --reconciliation "$ROOT/stage/in/reconciliation-$LABEL.json" --reconciliation-sha256 "$RECON_SHA") 2>&1 \
    | sed -e 's#postgres\(ql\)\?://[^ ]*#<dsn>#g' | tee "$ROOT/load.log"
  RC=${PIPESTATUS[0]}; unset V
  echo "import rc=$RC"
  [ "$RC" = 0 ] || stop "import failed (rc $RC): the data transaction rolled back; do NOT re-run, report" 6
  ;;
*) stop "unknown phase $PHASE" 2 ;;
esac
