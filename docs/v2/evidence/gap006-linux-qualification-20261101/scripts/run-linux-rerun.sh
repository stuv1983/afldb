#!/bin/bash
# GAP-006 Linux qualification, corrective rerun of the checks that failed for ENVIRONMENT reasons in the first pass:
#   - Python suites ran without the host's psycopg venv  -> use the existing venv read-only (no bytecode written)
#   - two suites need Git-ignored data inputs            -> the retained inputs.tar, hash-verified, extracted into MY workspace only
#   - deploy-release refused at 5.0 GB free (admission)  -> TMPDIR on tmpfs (/dev/shm), nothing deleted
# usage: run-linux-rerun.sh <phase>   phases: reclaim | inputs | core2 | coupled2 | coleman | unit | deploy
set -uo pipefail
export LC_ALL=C
umask 077
W=/home/arm/afldb-v2-gap006-linux-20261101
SRC=$W/src; E=$W/evidence
NODE=/home/arm/.nvm/versions/node/v22.23.2/bin/node
PGBIN=/usr/lib/postgresql/16/bin; PORT=55481; BASE=afldb_v2_rb_gap006lxbase_test
VENVPY=/home/arm/projects/afldb/.venv/bin/python
export PATH=/home/arm/.nvm/versions/node/v22.23.2/bin:/usr/bin:/bin
step() { echo "== $* $(date -u +%FT%TZ)"; }
die() { echo "STOP: $*"; exit "${2:-1}"; }
cd "$SRC" || die "no source"
for k in $(env | grep -oE '^(PG[A-Z_]*|[A-Z_]*DATABASE_URL[A-Z_]*|AFLDB_[A-Z_]*)=' | tr -d =); do unset "$k"; done
export AFLDB_V2_PG_ROOT=$W/pg AFLDB_V2_PG_BIN=$PGBIN AFLDB_V2_PG_PORT=$PORT
ISO=("$NODE" node_modules/tsx/dist/cli.mjs tools/v2/isolated-pg.ts)
free_gb() { df -BG --output=avail /home/arm | tail -1 | tr -dc 0-9; }
listener_proof() {
  local P; P=$(ss -H -ltnp "sport = :$PORT" | grep -oE 'pid=[0-9]+' | head -1 | cut -d= -f2)
  [ -n "$P" ] || die "nothing listening on $PORT" 4
  tr '\0' ' ' < /proc/$P/cmdline | grep -q -- "$W/pg/data" || die "listener is not this cluster" 4
  ss -H -ltn "sport = :$PORT" | grep -q "127.0.0.1:$PORT" || die "not loopback" 4
  echo "listener 127.0.0.1:$PORT pid $P data $W/pg/data"
}
pyenv() { export AFLDB_PYTHON=$VENVPY AFLDB_TEST_PYTHON=$VENVPY PYTHON=$VENVPY PYTHONDONTWRITEBYTECODE=1; }
summ() { "$NODE" -e 'const j=require(process.argv[1]);console.log(`${process.argv[2]}: files ${j.testResults.length} total ${j.numTotalTests} passed ${j.numPassedTests} failed ${j.numFailedTests} skipped ${j.numPendingTests+(j.numTodoTests||0)} success ${j.success}`);for(const f of j.testResults)for(const a of f.assertionResults)if(a.status==="failed"){console.log("  FAILED: "+f.name.replace(/^.*\/tests\//,"tests/")+" :: "+a.title);console.log("    "+a.failureMessages.join(" | ").split("\n").filter(l=>!/^\s+at /.test(l)).join(" ").slice(0,400))};for(const f of j.testResults)if(f.status==="failed"&&!f.assertionResults.some(a=>a.status==="failed"))console.log("  FILE FAILED: "+f.name+" "+String(f.message).slice(0,300))' "$1" "$2" 2>&1 || echo "$2: no JSON report"; }
clone() { "${ISO[@]}" drop-db "$1" --acknowledge-destroy "$1" >/dev/null 2>&1; "${ISO[@]}" create-db "$1" --template "$BASE" && "${ISO[@]}" verify "$1"; }

CORE=(admin-awards admin-brownlow admin-club-leadership admin-coaches admin-draft admin-fixtures admin-season-lists admin-special-records
  data-editor match-admin-create match-admin-delete player-link-concurrency sealed-editor-guard special-records-public-suppression
  v2-brownlow-eligibility v2-curated-awards v2-fixture-writer awards-reload-links first-kick-goal-reload-links brownlow-pending-populated
  brownlow-pending-projection)
COUPLED=(database draftguru-import player-compare player-family-and-coaching match-results-promotion settle-afl-api settle-afl-api-state-b
  settle-afltables v2-afl-api-settle-findings)
files() { local a=("$@") o=(); for n in "${a[@]}"; do o+=("tests/integration/$n.test.ts"); done; printf "%s
" "${o[@]}"; }
case "${1:-}" in
reclaim)
  step "reclaim: only this workspace's own scratch (build output and the build clone); nothing retained is touched"
  case "$SRC" in /home/arm/afldb-v2-gap006-linux-20261101/*) ;; *) die "unexpected path" ;; esac
  du -sh "$SRC/.next" 2>/dev/null; ls "$SRC/.next/standalone" >/dev/null 2>&1 && echo "standalone bundle present (BUILD_ID $(cat $SRC/.next/BUILD_ID))"
  listener_proof
  "${ISO[@]}" drop-db afldb_v2_rb_gap006lxd_test --acknowledge-destroy afldb_v2_rb_gap006lxd_test
  rm -rf "$SRC/.next"
  df -h /home/arm | tail -1
  ;;
inputs)
  step "inputs: hash-verify the retained archive, validate member paths, extract into this workspace's src only"
  X=/home/arm/afldb-v2-linuxverify-20261028T0020Z/xfer
  echo "42822c7590a05e4ff8dc2066d33fbee0d7bdbc48b626099c5603b363607dac42  $X/inputs.tar" | sha256sum -c - || die "inputs.tar hash" 3
  echo "b64c8a75cb2def63702549b803d7f8aedcad6c27f64eb30f76d125763e5e056d  $X/inputs.sha256" | sha256sum -c - || die "inputs.sha256 hash" 3
  tar -tf $X/inputs.tar | grep -c -E '^/|(^|/)\.\.(/|$)|\\' | sed 's/^/unsafe member paths: /'
  [ "$(free_gb)" -ge 2 ] || die "free disk $(free_gb) GB < 2 GB" 7
  tar -xf $X/inputs.tar -C "$SRC" --no-same-owner --skip-old-files || die "extract" 3
  (cd "$SRC" && sha256sum -c --quiet $X/inputs.sha256 && echo "inputs 785/785 verified" ) || die "inputs verify" 3
  df -h /home/arm | tail -1
  ;;
core2)
  step "core editor + publication suites AGAIN, with the host venv and inputs (importer replay/reload paths no longer skipped)"
  listener_proof; pyenv; DB=afldb_v2_rb_gap006lxa_test; clone $DB || die clone 5
  mapfile -t F < <(files "${CORE[@]}")
  "${ISO[@]}" run $DB -- "$NODE" node_modules/vitest/vitest.mjs run --no-cache "${F[@]}" --reporter=json --outputFile="$E/lx2-core.json" > "$E/lx2-core.stdout.log" 2> "$E/lx2-core.stderr.log"
  summ "$E/lx2-core.json" lx2-core
  "${ISO[@]}" drop-db $DB --acknowledge-destroy $DB
  ;;
coupled2)
  step "import/settle-coupled suites AGAIN, with the host venv and inputs"
  listener_proof; pyenv; DB=afldb_v2_rb_gap006lxb_test; clone $DB || die clone 5
  mapfile -t F < <(files "${COUPLED[@]}")
  "${ISO[@]}" run $DB -- "$NODE" node_modules/vitest/vitest.mjs run --no-cache "${F[@]}" --reporter=json --outputFile="$E/lx2-coupled.json" > "$E/lx2-coupled.stdout.log" 2> "$E/lx2-coupled.stderr.log"
  summ "$E/lx2-coupled.json" lx2-coupled
  "${ISO[@]}" drop-db $DB --acknowledge-destroy $DB
  ;;
coleman)
  step "Coleman publication on its own schema-only target, with the host venv"
  listener_proof; pyenv; DB=afldb_v2_gap006lxschema_test
  "${ISO[@]}" drop-db $DB --acknowledge-destroy $DB >/dev/null 2>&1
  "${ISO[@]}" create-db $DB || die create 5
  "${ISO[@]}" run $DB -- "$NODE" node_modules/tsx/dist/cli.mjs tools/db/migrate.ts --target test > "$E/schema2-migrate.log" 2>&1 || die migrate 6
  "${ISO[@]}" run $DB -- "$NODE" node_modules/tsx/dist/cli.mjs tools/db/privileges.ts --target test > "$E/schema2-privileges.log" 2>&1 || die privileges 6
  "${ISO[@]}" run $DB -- "$NODE" node_modules/vitest/vitest.mjs run --no-cache tests/integration/v2-coleman-publication.test.ts --reporter=json --outputFile="$E/lx2-coleman.json" > "$E/lx2-coleman.stdout.log" 2> "$E/lx2-coleman.stderr.log"
  summ "$E/lx2-coleman.json" lx2-coleman
  "${ISO[@]}" drop-db $DB --acknowledge-destroy $DB
  ;;
unit)
  step "full unit pass (everything outside tests/integration and tests/nl-ui), venv + inputs present, deploy-release excluded here"
  listener_proof; pyenv; DB=afldb_v2_rb_gap006lxc_test; clone $DB || die clone 5
  "${ISO[@]}" run $DB -- "$NODE" node_modules/vitest/vitest.mjs run --no-cache --exclude 'tests/integration/**' --exclude 'tests/nl-ui/**' --exclude 'tests/deploy-release.test.ts' --reporter=json --outputFile="$E/lx2-unit.json" > "$E/lx2-unit.stdout.log" 2> "$E/lx2-unit.stderr.log"
  summ "$E/lx2-unit.json" lx2-unit
  "${ISO[@]}" drop-db $DB --acknowledge-destroy $DB
  ;;
deploy)
  step "deploy-release route suite with TMPDIR on tmpfs (admission measures the temp root's filesystem)"
  listener_proof; pyenv; DB=afldb_v2_rb_gap006lxc_test; clone $DB || die clone 5
  T=/dev/shm/afldb-gap006-deploy-$$; mkdir -m 700 "$T"
  TMPDIR=$T "${ISO[@]}" run $DB -- "$NODE" node_modules/vitest/vitest.mjs run --no-cache tests/deploy-release.test.ts --reporter=json --outputFile="$E/lx2-deploy-release.json" > "$E/lx2-deploy-release.stdout.log" 2> "$E/lx2-deploy-release.stderr.log"
  summ "$E/lx2-deploy-release.json" lx2-deploy-release
  case "$T" in /dev/shm/afldb-gap006-deploy-*) rm -rf "$T" ;; esac
  "${ISO[@]}" drop-db $DB --acknowledge-destroy $DB
  ;;
*) echo "unknown phase"; exit 2 ;;
esac
step "phase ${1:-} done"
