set -euo pipefail
export PATH="$HOME/.nvm/versions/node/v22.23.2/bin:$PATH"
W=/mnt/ssd/afldb-i349-20261112
test ! -e "$W"
mkdir -m 700 "$W"
git clone -q /mnt/ssd/issue349.bundle "$W/cand"
cd "$W/cand"
git checkout -q codex/issue349-utc
ln -s /mnt/ssd/afldb-i336rel-qual-20261108T201140Z/cand/node_modules node_modules
echo node_modules >> .git/info/exclude
npx vitest run tests/gap029-ops.test.ts > "$W/unit.log" 2>&1
npx tsc --noEmit > "$W/typecheck.log" 2>&1
git clone -q . "$W/red"
git -C "$W/red" checkout -q 595dc394
ln -s "$W/cand/node_modules" "$W/red/node_modules"
echo node_modules >> "$W/red/.git/info/exclude"
for colour in red green; do
  C="$W/cand"; [ "$colour" = red ] && C="$W/red"
  REV=$(git -C "$C" rev-parse HEAD)
  T="$W/$colour-tools"; mkdir "$T"
  cp /mnt/ssd/afldb-i336-simtools-20261111/lssh /mnt/ssd/afldb-i336-simtools-20261111/lscp "$T/"
  python3 - "$C" "$W" "$colour" "$REV" <<'PY'
import pathlib,sys
c,w,col,rev=sys.argv[1:]
s=pathlib.Path(c+'/docs/v2/evidence/issue336-i336-simulation-20261111/scripts/i336-sim.sh').read_text()
s=s.replace('R=c1c4b22ee15007111eab66f6d354e0b9ecbb2ade','R='+rev)
s=s.replace('SIM=/mnt/ssd/afldb-i336-sim-20261111','SIM='+w+'/'+col+'-sim')
s=s.replace('PACK=/mnt/ssd/afldb-i336-simpack-20261111','PACK='+w+'/'+col+'-pack')
s=s.replace('SRC=/mnt/ssd/afldb-i336rel-qual-20261108T201140Z/cand','SRC='+c)
s=s.replace('TOOLS=/mnt/ssd/afldb-i336-simtools-20261111','TOOLS='+w+'/'+col+'-tools')
pathlib.Path(w+'/'+col+'-tools/run.sh').write_text(s)
PY
  bash "$T/run.sh" setup > "$W/$colour-setup.log" 2>&1
  SIM="$W/$colour-sim"
  PW=$(cat "$SIM/pg-sim/secrets/superuser.pw")
  ID=$(PGPASSWORD="$PW" psql -XAt -h 127.0.0.1 -p 55494 -U afldb_v2_super -d postgres -c "SELECT current_setting('data_directory')")
  [[ "$ID" == "$SIM/pg-sim/"* ]]
  PGPASSWORD="$PW" psql -X -v ON_ERROR_STOP=1 -h 127.0.0.1 -p 55494 -U afldb_v2_super -d postgres -c "ALTER DATABASE afldb_simprod SET timezone TO 'Australia/Melbourne';" > "$W/$colour-timezone.log"
  unset PW
  bash "$T/run.sh" prepare > "$W/$colour-prepare.log" 2>&1
  if [ "$colour" = red ]; then
    grep -q 'baseline drift' "$W/$colour-prepare.log"
    echo 'RED reproduced baseline drift'
  else
    find "$SIM/ops" -name plan.json | grep -q .
    bash "$T/run.sh" rb-neg-pre > "$W/green-neg.log" 2>&1
    bash "$T/run.sh" rb-approve > "$W/green-approve.log" 2>&1
    bash "$T/run.sh" rb-apply > "$W/green-apply.log" 2>&1
    grep -q 'COMMITTED_VERIFIED' "$W/green-apply.log"
    bash "$T/run.sh" rb-post > "$W/green-post.log" 2>&1
    echo 'GREEN planned, committed verified, accepted'
  fi
  bash "$T/run.sh" teardown > "$W/$colour-stop.log" 2>&1
done
echo QUALIFICATION_PASS
