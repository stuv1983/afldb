#!/usr/bin/env bash
# Same focused integration tests, same DEV dump, base revision eec192f2 vs candidate ea9bddf8, each on its own fresh restore.
set -u -o pipefail; umask 077
PW=/mnt/ssd/afldb/workspaces/i336-preview-20261106; EV=$PW/evidence; CO=$PW/checkout; IN=/mnt/ssd/afldb/workspaces/i336-preview-in-20261106
export PATH="$HOME/.nvm/versions/node/v22.23.2/bin:$PATH" AFLDB_V2_PG_ROOT=$PW/pg-root AFLDB_V2_PG_BIN=/usr/lib/postgresql/16/bin AFLDB_V2_PG_PORT=55499
DUMP=$(ls $PW/private/afldb_dev-*.dump); SHA=$(sha256sum "$DUMP" | cut -d' ' -f1)
strip() { sed 's/\x1b\[[0-9;]*m//g' | grep -viE 'postgres(ql)?://|password='; }
git -C "$CO" worktree add -q --detach $PW/base eec192f2498711954c566426c7cf05ee1468a80e && ln -s $CO/node_modules $PW/base/node_modules
for side in base cand; do
  [ $side = base ] && D=$PW/base || D=$CO; DB=afldb_v2_i336cmp${side}_test
  (cd $CO && node --import tsx tools/v2/isolated-pg.ts create-db $DB) 2>&1 | strip
  cp $IN/restore.mjs $D/.cmp-restore.mjs
  (cd $D && node --import tsx tools/v2/isolated-pg.ts run $DB -- node .cmp-restore.mjs "$DUMP" "$SHA" && node --import tsx tools/v2/isolated-pg.ts run $DB -- node --import tsx tools/db/migrate.ts --target test | tail -1) 2>&1 | strip | grep -v '^isolated-pg:'
  rm -f $D/.cmp-restore.mjs
  echo "== $side $(git -C $D rev-parse --short HEAD)"
  (cd $D && node --import tsx tools/v2/isolated-pg.ts run $DB -- node node_modules/vitest/vitest.mjs run tests/integration/admin-draft.test.ts tests/integration/draft-linkage.test.ts tests/integration/draftguru-import.test.ts tests/integration/grid-solver.test.ts --reporter=verbose) > $EV/cmp-$side.log 2>&1
  strip < $EV/cmp-$side.log | grep -E '^ +(Test Files|Tests) '
  strip < $EV/cmp-$side.log | grep -E '^ +× ' | sed -E 's/ [0-9]+ms$//' | sort > $EV/cmp-$side.fails
  (cd $CO && node --import tsx tools/v2/isolated-pg.ts drop-db $DB --acknowledge-destroy $DB) 2>&1 | strip
done
echo "== fails only in cand"; comm -13 $EV/cmp-base.fails $EV/cmp-cand.fails
echo "== fails only in base"; comm -23 $EV/cmp-base.fails $EV/cmp-cand.fails
echo "== shared: $(comm -12 $EV/cmp-base.fails $EV/cmp-cand.fails | wc -l)"
git -C "$CO" worktree remove --force $PW/base
echo CMP-DONE
