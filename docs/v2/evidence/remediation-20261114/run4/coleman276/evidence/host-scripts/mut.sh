#!/usr/bin/env bash
# Mutation experiment: apply ONE sed substitution to a tracked file of the checkout, run the given test file on a fresh copy
# of the base (per-file mode), ALWAYS restore the file with git checkout. If OLD_TEST=<repo path> is set, the B4 version of
# that test file is written to tests/integration/zz-b4-<name> (untracked, removed afterwards) and OLD_TEST is what runs.
#   bash mut.sh <label> <rb|sn> <repo-relative file> <sed -e expression> <vitest args...>
set -u -o pipefail
W=/mnt/ssd/afldb-rem4-coleman276-20261115
CAND=${CAND:-$W/cand}
B4=7cfbe186e70ca91db67da1aa4e28325ccbc32a86
label="$1"; base="$2"; file="$3"; expr="$4"; shift 4
cd "$CAND" || exit 1
old=""
if [ -n "${OLD_TEST:-}" ]; then
  old="tests/integration/zz-b4-$(basename "$OLD_TEST")"
  git show "$B4:$OLD_TEST" > "$old" || exit 1
  set -- "$old"
fi
# Restore from a byte copy taken BEFORE the mutation, never `git checkout` (the checkout holds uncommitted work in the
# test files, and a checkout would silently revert it to B4 - the first version of this script did exactly that).
BAK="$W/mutbak-$label.$$"
cp -p "$file" "$BAK"
cleanup() { cp -p "$BAK" "$file"; rm -f "$BAK"; [ -z "$old" ] || rm -f "$CAND/$old"; echo "restored $file sha256=$(sha256sum "$file" | cut -d' ' -f1)"; }
trap cleanup EXIT
before=$(sha256sum "$file" | cut -d' ' -f1)
sed -i -e "$expr" "$file"
after=$(sha256sum "$file" | cut -d' ' -f1)
echo "MUTATION $label: $file sed '$expr' ${old:+(running the B4 test $old)}"
echo "sha256 before=$before after=$after"
[ "$before" != "$after" ] || { echo "MUTATION DID NOT CHANGE THE FILE"; exit 3; }
git diff -U0 -- "$file" | grep -E '^[+-][^+-]' | head -6
HEADN=${HEADN:-60} bash "$W/run.sh" "$label" "$base" all "$@"
