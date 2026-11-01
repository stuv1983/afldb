#!/bin/bash
# V2-GAP-006 editor protections: read-only release-state probe. Changes nothing.
#
#   bash state-probe.sh <OLD_ID> <NEW_ID|-> [--expect STATE]
#   bash state-probe.sh --self-test              # classifier against fixed cases; touches no host state
#
# It reads the `current` and `previous` links, the service's MainPID working directory (the same evidence
# `release.mjs status` uses), the unit's ActiveState and /api/health, and prints one STATE line:
#   OLD_SERVING             current is OLD_ID, the process runs OLD_ID, health ok/ok
#   NEW_SELECTED_OLD_RUNNING current is NEW_ID, the process still runs OLD_ID, health ok/ok (promoted, not restarted)
#   NEW_SERVING             current is NEW_ID, the process runs NEW_ID, health ok/ok
#   NEW_SELECTED_FAILED     current is NEW_ID and the unit is down, or runs NEW_ID but is unhealthy
#   OLD_SELECTED_NEW_RUNNING current is OLD_ID again but the process still runs NEW_ID (restart owed)
#   TRANSIENT               the unit is `activating` (still starting): change nothing, probe again in 15 s
#   UNCERTAIN               anything else: act on nothing; inspect links, process, health and journal
# With --expect the exit status is 0 only when the STATE equals it. Without it the exit status is 0.
set -u
ROOT=${ROOT:-/home/arm/afldb-releases}
UNIT=${UNIT:-afldb}
LOCAL=${LOCAL:-http://127.0.0.1:3100}

classify() { # cur running healthy old new
  local cur=$1 run=$2 healthy=$3 old=$4 new=${5:-}
  if [ "$cur" = "$old" ]; then
    if [ "$run" = "$old" ] && [ "$healthy" = yes ]; then echo OLD_SERVING
    elif [ -n "$new" ] && [ "$run" = "$new" ]; then echo OLD_SELECTED_NEW_RUNNING
    else echo UNCERTAIN; fi
  elif [ -n "$new" ] && [ "$cur" = "$new" ]; then
    if [ "$run" = "$old" ] && [ "$healthy" = yes ]; then echo NEW_SELECTED_OLD_RUNNING
    elif [ "$run" = "$new" ] && [ "$healthy" = yes ]; then echo NEW_SERVING
    elif [ "$run" = "$new" ] || [ "$run" = none ]; then echo NEW_SELECTED_FAILED
    else echo UNCERTAIN; fi
  else
    echo UNCERTAIN
  fi
}

if [ "${1:-}" = "--self-test" ]; then
  O=ad245d602f6f-m0M8pf121326vNSo2B759; N=fd48ace0c2cb-NEWBUILDID; X=61a95f7397da-JYIBkYn8ynPgYMn1e5nK-
  bad=0
  while IFS='|' read -r cur run healthy new want; do
    got=$(classify "$cur" "$run" "$healthy" "$O" "$new")
    if [ "$got" = "$want" ]; then echo "  ok    cur=${cur:0:12} run=${run:0:12} healthy=$healthy new=${new:+set} -> $got"
    else echo "  FAIL  cur=${cur:0:12} run=${run:0:12} healthy=$healthy new=${new:+set}: got $got, want $want"; bad=$((bad + 1)); fi
  done <<EOF
$O|$O|yes|$N|OLD_SERVING
$O|$O|yes||OLD_SERVING
$O|$O|no|$N|UNCERTAIN
$O|none|no|$N|UNCERTAIN
$O|$N|yes|$N|OLD_SELECTED_NEW_RUNNING
$O|$X|yes|$N|UNCERTAIN
$N|$O|yes|$N|NEW_SELECTED_OLD_RUNNING
$N|$N|yes|$N|NEW_SERVING
$N|$N|no|$N|NEW_SELECTED_FAILED
$N|none|no|$N|NEW_SELECTED_FAILED
$N|$O|no|$N|UNCERTAIN
$N|$X|yes|$N|UNCERTAIN
$X|$O|yes|$N|UNCERTAIN
$N|$N|yes||UNCERTAIN
EOF
  [ "$bad" -eq 0 ] && { echo "SELF-TEST PASS"; exit 0; }
  echo "SELF-TEST FAIL ($bad)"; exit 1
fi

OLD=${1:-}; NEW=${2:-}; EXPECT=""
[ "${3:-}" = "--expect" ] && EXPECT=${4:-}
valid() { [[ $1 =~ ^[0-9a-f]{12}-[A-Za-z0-9_-]{1,64}$ ]]; }
valid "$OLD" || { echo "usage: bash state-probe.sh <OLD_ID> <NEW_ID|-> [--expect STATE] | --self-test"; exit 2; }
[ "$NEW" = "-" ] && NEW=""
[ -z "$NEW" ] || valid "$NEW" || { echo "NEW_ID is not a release id: $NEW"; exit 2; }

link() { local t; t=$(readlink "$ROOT/$1" 2> /dev/null) || { echo "(absent)"; return; }; echo "${t#releases/}"; }
cur=$(link current); prev=$(link previous)
active=$(systemctl show -p ActiveState --value "$UNIT" 2> /dev/null); result=$(systemctl show -p Result --value "$UNIT" 2> /dev/null)
pid=$(systemctl show -p MainPID --value "$UNIT" 2> /dev/null)
run=none; cwd=""
if [ -n "$pid" ] && [ "$pid" != 0 ]; then
  cwd=$(readlink "/proc/$pid/cwd" 2> /dev/null) || cwd=""
  if [ -z "$cwd" ]; then run=unreadable
  elif [ "$(dirname "$cwd")" = "$(realpath "$ROOT/releases")" ]; then run=$(basename "$cwd")
  else run="other:$cwd"; fi
fi
health=$(curl -s -m 5 "$LOCAL/api/health" 2> /dev/null)
healthy=no
[ "$active" = active ] && [[ $health == *'"status":"ok"'* && $health == *'"database":"ok"'* ]] && healthy=yes

echo "state probe $(date -u +%FT%TZ)"
echo "  OLD_ID   $OLD"
echo "  NEW_ID   ${NEW:-(not set)}"
echo "  current  $cur"
echo "  previous $prev"
[ "$prev" = "$cur" ] && echo "  ANOMALY  previous equals current (an interrupted promote leaves this); serving is unaffected"
echo "  unit     $UNIT ActiveState=${active:-?} Result=${result:-?} MainPID=${pid:-?}"
echo "  process  runs ${run}${cwd:+ ($cwd)}"
echo "  health   ${health:-no answer}"
locks=$(ls "$ROOT"/*.lock 2> /dev/null); echo "  locks    ${locks:-none}"
state=$(classify "$cur" "$run" "$healthy" "$OLD" "$NEW")
# A unit that is still starting is not a failure yet: wait and probe again before acting on anything.
[ "$active" = activating ] && state=TRANSIENT
echo "STATE $state"
if [ -n "$EXPECT" ] && [ "$state" != "$EXPECT" ]; then echo "expected $EXPECT: do not proceed"; exit 1; fi
exit 0
