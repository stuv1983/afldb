#!/usr/bin/env bash
# AFLDB-ISSUE-347 qualification (streamanator, 2026-11-11). Fresh clone of origin/main (PKG 12aa6e29) + the local fix bundle; focused unit
# suite and typecheck at the fix commit; then a SIMULATION episode (e2) on the I336 simulated production host in which the FIXED workstation
# runner drives the whole I336 lifecycle (prepare -> approve -> apply -> accept) with the ops checkout still pinned at R = c1c4b22e.
# Usage: bash i347-qual.sh clone|unit|reset|runner
set -u -o pipefail
FIX=2207986f
R=c1c4b22ee15007111eab66f6d354e0b9ecbb2ade
Q=/mnt/ssd/afldb-i347-qual-20261111
SIM=/mnt/ssd/afldb-i336-sim-20261111
SRC=/mnt/ssd/afldb-i336rel-qual-20261108T201140Z/cand
DUMP=/mnt/ssd/afldb/workspaces/afldb-issue333-o2-20261104/private/afldb_prod-20261104T021037Z.dump
DUMP_SHA=e77c307d3e0cddcb652e398a946e4c22c2063f13c70edadf96a975c92842826d
TOOLS=/mnt/ssd/afldb-i336-simtools-20261111
PG=/usr/lib/postgresql/16/bin
export PATH="$HOME/.nvm/versions/node/v22.23.2/bin:$PATH" LC_ALL=C
NICE="nice -n 10 ionice -c2 -n7"
PHASE=${1:?phase}; mkdir -p "$Q/logs"
exec > >(tee -a "$Q/logs/$PHASE.log") 2>&1
say() { echo "$(date -u +%FT%TZ) $*"; }
case "$PHASE" in
clone)
  [ "$(sha256sum "$Q/in/i347.bundle" | cut -d' ' -f1)" = b9431798951c7b10c7c318b2185cc0aab1563022a9082f110b7edf77ebfa1787 ] || { echo "STOP bundle sha"; exit 3; }
  git clone -q --depth 30 https://github.com/stuv1983/afldb.git "$Q/cand" || exit 3
  cd "$Q/cand" && [ "$(git rev-parse HEAD)" = 12aa6e29d51099eb6d3fbc901bbe488c5dbd7ab3 ] || { echo "STOP origin/main moved: $(git rev-parse HEAD)"; exit 3; }
  git fetch -q "$Q/in/i347.bundle" "refs/heads/claude/records-catchup-20261111:refs/heads/i347" && git -c advice.detachedHead=false checkout -q "$FIX" || exit 3
  echo "HEAD $(git rev-parse HEAD)"; git log --oneline -2
  [ "$(sha256sum package-lock.json | cut -d' ' -f1)" = "$(sha256sum "$SRC/package-lock.json" | cut -d' ' -f1)" ] || { echo "STOP package-lock differs from the node_modules source"; exit 3; }
  ln -s "$SRC/node_modules" node_modules && echo node_modules >> .git/info/exclude && git status --porcelain | head -3
  ;;
unit)
  cd "$Q/cand" && [ "$(git rev-parse --short=8 HEAD)" = "$FIX" ] || exit 3
  say "vitest tests/gap029-ops.test.ts"; $NICE npx vitest run tests/gap029-ops.test.ts 2>&1 | tail -8
  say "typecheck"; $NICE npx tsc --noEmit -p . 2>&1 | tail -5; echo "tsc exit=${PIPESTATUS[0]}"
  ;;
reset)  # rebuild the baseline template from the original dump (the e1 database now holds the applied result), then episode e2 from it
  su=$(cat "$SIM/pg-sim/secrets/superuser.pw")
  SU() { PGPASSWORD="$su" "$PG/psql" -X -q -At -h 127.0.0.1 -p 55494 -U afldb_v2_super -v ON_ERROR_STOP=1 "$@"; }
  got=$(SU -d postgres -c "SELECT current_setting('listen_addresses')||'|'||current_setting('data_directory')"); echo "cluster $got"
  [[ "$got" == "127.0.0.1|$SIM/pg-sim/"* ]] || { echo "STOP cluster identity"; exit 9; }
  [ "$(sha256sum "$DUMP" | cut -d' ' -f1)" = "$DUMP_SHA" ] || { echo "STOP dump sha"; exit 3; }
  [ "$(SU -d postgres -c "SELECT count(*) FROM pg_database WHERE datname='afldb_simprod_base'")" = 0 ] || { echo "STOP base exists"; exit 2; }
  SU -d postgres -c "CREATE DATABASE afldb_simprod_base OWNER afldb_owner" || exit 5
  SU -d afldb_simprod_base -c "CREATE EXTENSION IF NOT EXISTS pg_trgm; CREATE EXTENSION IF NOT EXISTS unaccent; ALTER SCHEMA public OWNER TO afldb_owner;" || exit 5
  own=$(node -e 'process.stdout.write(JSON.parse(require("fs").readFileSync(process.argv[1],"utf8")).afldb_owner)' "$SIM/pg-sim/secrets/roles.json")
  PGPASSWORD="$own" $NICE "$PG/pg_restore" --no-password --no-comments --no-owner -j 2 -h 127.0.0.1 -p 55494 -U afldb_owner -d afldb_simprod_base "$DUMP" > "$Q/logs/base-restore.out" 2>&1; echo "pg_restore exit=$? stderr_lines=$(grep -c . "$Q/logs/base-restore.out")"
  unset own su
  SIM=$SIM EPISODE=e2 bash "$SRC/tools/v2/gap029-ops/sim/sim-episode.sh" || exit 6
  bash "$TOOLS/i336-sim.sh" facts   # e1 facts helper reads afldb_simprod: now the e2 baseline
  ;;
runner)
  export GAP029_PROFILE="$SIM/profile.sim-${EP:-e2}.env" GAP029_RESTORE_PROFILE="$SIM/profile.sim-${EP:-e2}.env" GAP029_REMOTE_ENV="GAP029_PROFILE=$SIM/profile.sim-${EP:-e2}.env"
  export GAP029_SSH="$TOOLS/lssh" GAP029_SCP="$TOOLS/lscp" GAP029_SSH_GAP_MS=0
  cd "$Q/cand" && [ "$(git rev-parse --short=8 HEAD)" = "$FIX" ] || exit 3
  RUNNER() { $NICE node --import tsx tools/v2/gap029-stage.ts "$@"; }
  TAR=/mnt/ssd/afldb-i336-simpack-20261111/pack-c1c4b22e/cand.tar.gz; H=$(sha256sum "$TAR" | cut -d' ' -f1)
  say "FIXED runner prepare (ops checkout pinned at R)"; RUNNER prepare --stage I336 --rev "$R" --tar "$TAR" --tar-sha256 "$H" --private-root "$SIM/ws-runs-${EP:-e2}" --restore-workspace "$SIM/rw" --restore-host dev; echo "prepare exit=$?"
  D=$(ls -d "$SIM"/ws-runs-${EP:-e2}/I336-* | head -1); [ -f "$D/run.json" ] || { echo "STOP no run.json"; exit 4; }
  DIG=$(node -e 'process.stdout.write(JSON.parse(require("fs").readFileSync(process.argv[1],"utf8")).digest)' "$D/plan.json")
  say "runner approve (simulated owner act)"; RUNNER approve --run-dir "$D" --digest "$DIG" --expires "$(date -u -d '+90 min' +%FT%TZ)"; echo "approve exit=$?"
  say "runner apply"; RUNNER apply --run-dir "$D"; echo "apply exit=$?"
  say "runner accept"; RUNNER accept --run-dir "$D"; echo "accept exit=$?"
  bash "$TOOLS/i336-sim.sh" facts
  ;;
episode)  # a further episode from the existing baseline template
  SIM=$SIM EPISODE=${EP:?} bash "$SRC/tools/v2/gap029-ops/sim/sim-episode.sh" || exit 6
  bash "$TOOLS/i336-sim.sh" facts
  ;;
*) echo "unknown phase"; exit 2 ;;
esac
# appended: episode e3 reset from the existing baseline template (no restore needed)
