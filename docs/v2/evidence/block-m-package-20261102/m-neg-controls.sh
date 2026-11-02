#!/bin/bash
# Negative controls for m-static-check.sh, run ONLY inside a NEW disposable clone. (Replaces the controls that were wrongly run in the
# real repository on 2026-11-02 after a scratch `git clone --local` failed; see docs/v2/incident-2026-11-02-negative-control-wrong-repo.md.)
#   bash m-neg-controls.sh <absolute path of the real repository> <absolute path of a NEW, non-existent disposable directory>
# Safety contract (every item is asserted BEFORE the first mutation; any failure stops the script at once, nothing else runs):
#   - set -euo pipefail, no `;`-chained mutation, no `||` fallback that could run a mutation elsewhere;
#   - the disposable path is absolute, does not exist, and is neither inside nor an ancestor of the real repository;
#   - after the clone, the clone's `--show-toplevel` equals the disposable path and its `--absolute-git-dir` equals <path>/.git,
#     and both differ from the real repository's;
#   - every Git mutation uses `git -C "$DST"`; the check runs in a subshell after `cd "$DST"` is re-asserted;
#   - no `reset`, `clean`, `rm`, history rewrite or `commit -a`; controls are separate branches cut from the same base commit;
#   - the real repository's HEAD, branch refs and `status --porcelain` are captured first and must be identical at the end.
set -euo pipefail
export LC_ALL=C
SRC=${1:?absolute path of the real repository}
DST=${2:?absolute path of a NEW disposable directory}
norm() { if command -v cygpath > /dev/null 2>&1; then cygpath -m "$1"; else printf '%s' "$1"; fi; }
stop() { echo "STOP: $1" >&2; exit "${2:-1}"; }
[[ $SRC = /* && $DST = /* ]] || stop "both paths must be absolute" 2
[ ! -e "$DST" ] || stop "disposable path already exists; choose a new one (nothing is deleted or reused)" 2
[ -d "$SRC" ] || stop "real repository path is not a directory" 2
SRCN=$(norm "$(cd "$SRC" && pwd -P)")
case "$(norm "$DST")/" in "$SRCN"/*) stop "disposable path is inside the real repository" 2;; esac
case "$SRCN/" in "$(norm "$DST")"/*) stop "disposable path is an ancestor of the real repository" 2;; esac
[ "$(git -C "$SRC" rev-parse --show-toplevel)" = "$SRCN" ] || stop "real repository root mismatch" 2
REAL_HEAD=$(git -C "$SRC" rev-parse HEAD)
REAL_REFS=$(git -C "$SRC" for-each-ref --format='%(refname) %(objectname)' refs/heads | sha256sum | cut -c1-64)
REAL_STATUS=$(git -C "$SRC" status --porcelain | sha256sum | cut -c1-64)
echo "real repository: root=$SRCN HEAD=$REAL_HEAD refs=${REAL_REFS:0:12} status=${REAL_STATUS:0:12}"

BRANCH=$(git -C "$SRC" symbolic-ref --short HEAD) || stop "real repository HEAD is detached" 2
git -c core.longpaths=true clone -q --no-local --single-branch --branch "$BRANCH" "file://$SRC" "$DST" || stop "clone failed; nothing was mutated anywhere" 3
DSTN=$(norm "$DST")
[ "$(git -C "$DST" rev-parse --show-toplevel)" = "$DSTN" ] || stop "clone toplevel is not the disposable path" 3
[ "$(git -C "$DST" rev-parse --absolute-git-dir)" = "$DSTN/.git" ] || stop "clone git dir is not <disposable>/.git" 3
[ "$DSTN" != "$SRCN" ] && [ "$(git -C "$DST" rev-parse --absolute-git-dir)" != "$(git -C "$SRC" rev-parse --absolute-git-dir)" ] || stop "clone is not distinct from the real repository" 3
BASE=$(git -C "$DST" rev-parse HEAD)
[ "$BASE" = "$REAL_HEAD" ] || stop "clone base $BASE differs from the real HEAD" 3
echo "disposable clone: root=$DSTN gitdir=$DSTN/.git base=$BASE"

PKGREL=docs/v2/evidence/block-m-package-20261102
[ "$(sha256sum "$DST/$PKGREL/m-static-check.sh" | cut -c1-64)" = "$(sha256sum "$SRC/$PKGREL/m-static-check.sh" | cut -c1-64)" ] || stop "the check under test differs between the real working tree and the clone (commit it first)" 3

pass=0; total=0
control() { # name, expected exit, required FAIL rules (e.g. "A B"), forbidden FAIL rules, relative file, mutation (append|sed), arg
  local name=$1 want=$2 req=$3 forbid=$4 file=$5 how=$6 arg=${7:-}
  total=$((total + 1))
  [ "$(git -C "$DST" rev-parse --show-toplevel)" = "$DSTN" ] || stop "root changed before control $name" 4
  git -C "$DST" checkout -q -B "neg-$name" "$BASE"
  case $how in
    append) printf '%s\n' "$arg" >> "$DST/$file";;
    sed) sed -i "$arg" "$DST/$file";;
    *) stop "bad mutation kind" 4;;
  esac
  [ -n "$(git -C "$DST" status --porcelain -- "$file")" ] || stop "control $name changed nothing" 4
  git -C "$DST" add -- "$file"
  git -C "$DST" -c user.name=negctl -c user.email=negctl@invalid commit -q -m "neg: $name"
  local R out rc=0 ok=1
  R=$(git -C "$DST" rev-parse HEAD)
  [ "$R" != "$BASE" ] || stop "control $name produced no commit" 4
  out=$(cd "$DST" && [ "$(git rev-parse --show-toplevel)" = "$DSTN" ] && bash "$PKGREL/m-static-check.sh" "$R" 2>&1) || rc=$?
  [ "$rc" = "$want" ] || ok=0
  for r in $req; do grep -q "FAIL rule $r" <<< "$out" || ok=0; done
  for r in $forbid; do ! grep -q "FAIL rule $r" <<< "$out" || ok=0; done
  [ "$want" != 0 ] || grep -q "STATIC CHECK PASS" <<< "$out" || ok=0
  if [ "$ok" = 1 ]; then pass=$((pass + 1)); echo "ok   $name (exit $rc; required: ${req:-none}; forbidden: ${forbid:-none})"
  else echo "FAIL $name (exit $rc, wanted $want)"; echo "$out" | sed 's/^/     | /'; fi
}
control src-change         1 "A B" "C"  src/lib/acquisition/afl-api-acquisition-constants.ts append '// x'
control other-tool         1 "A B" "C"  tools/v2/isolated-pg.ts                                append 'x'
control doc-only           0 ""    "A B C" docs/v2/progress.md                                  append '-- ok'
control migration-118-edit 1 "A B C" "" src/db/migrations/118_fixtures_unconfirmed_participants.sql sed 's/ADD COLUMN confirmation /ADD COLUMN confirmation  /'
control label-tool-edit    1 "B"   "A C" tools/v2/gap029-label-checks.ts                        append '// x'
control evidence-file-edit 1 "C"   "A B" docs/v2/evidence/gap-029-match-event-correction-2026-11-01-r2.json sed '1s/^{/{ /'

git -C "$DST" checkout -q "$BASE"
[ "$(git -C "$SRC" rev-parse HEAD)" = "$REAL_HEAD" ] || stop "REAL HEAD CHANGED" 5
[ "$(git -C "$SRC" for-each-ref --format='%(refname) %(objectname)' refs/heads | sha256sum | cut -c1-64)" = "$REAL_REFS" ] || stop "REAL BRANCH REFS CHANGED" 5
[ "$(git -C "$SRC" status --porcelain | sha256sum | cut -c1-64)" = "$REAL_STATUS" ] || stop "REAL WORKING TREE STATUS CHANGED" 5
echo "NEGATIVE CONTROLS $pass/$total; real repository HEAD, branch refs and status unchanged; disposable clone retained at $DSTN"
[ "$pass" = "$total" ]
