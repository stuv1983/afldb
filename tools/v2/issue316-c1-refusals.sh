#!/bin/sh
# ISSUE-316: DB-free C1 shell subset, never the deployed DEV/app rehearsal.
# Usage: sh issue316-c1-refusals.sh <reviewed-artifact-directory> <new-output-directory>
# Artifacts contain only the two launchers and this runner, never acquisition tools.
set -eu
[ "$#" -eq 2 ] || { echo "Usage: $0 <artifact-directory> <new-output-directory>" >&2; exit 2; }
ARTIFACT=$(CDPATH= cd -- "$1" && pwd)
PYTHON=${AFLDB_PYTHON:-/usr/bin/python3}
[ -x "$PYTHON" ] || { echo "Python interpreter unavailable" >&2; exit 2; }
(cd "$ARTIFACT" && sha256sum -c checksums.sha256)
# mkdir refuses an existing target; nothing is deleted or overwritten.
mkdir -- "$2"
OUTPUT=$(CDPATH= cd -- "$2" && pwd)
for launcher in historical v2; do
  for state in retired beyond; do
    fixture="$OUTPUT/$launcher-$state"
    mkdir -p "$fixture/data/reference"
    if [ "$state" = retired ]; then
      control=retired; season=2026; expected=0; marker=AFLDB_AFLTABLES_RETIRED
    else
      control=active; season=2027; expected=1; marker=AFLDB_AFLTABLES_OUT_OF_BOUNDS
    fi
    printf '{"status":"%s","last_season":2026}\n' "$control" > "$fixture/data/reference/afltables-network.json"
    printf '{"in_progress_seasons":[%s]}\n' "$season" > "$fixture/data/reference/seasons.json"
    if env -i PATH="$PATH" AFLDB_PROJECT_ROOT="$fixture" AFLDB_PYTHON="$PYTHON" \
      sh "$ARTIFACT/$launcher.sh" > "$fixture/result.log" 2>&1; then
      actual=0
    else
      actual=$?
    fi
    printf '%s\n' "$actual" > "$fixture/exit-code.txt"
    cat "$fixture/result.log"
    [ "$actual" -eq "$expected" ] || { echo "STOP: unexpected exit" >&2; exit 1; }
    grep -q "$marker" "$fixture/result.log" || { echo "STOP: missing refusal" >&2; exit 1; }
    if grep -q '\[1/3\]' "$fixture/result.log" || [ -e "$fixture/data/sources" ]; then
      echo "STOP: acquisition reached" >&2; exit 1
    fi
  done
done
echo "PASS: four shell refusals; no acquisition tools, R fragment, Node settle or database credentials in fixtures."
echo "Not deployed DEV C1 acceptance; no active historical acquisition control was run."
