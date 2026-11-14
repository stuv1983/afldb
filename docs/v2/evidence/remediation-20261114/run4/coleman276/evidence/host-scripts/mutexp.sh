#!/usr/bin/env bash
# Named mutation experiments. Usage: bash mutexp.sh <name> <rb|sn>
set -u -o pipefail
W=/mnt/ssd/afldb-rem4-coleman276-20261115
name="$1"; base="$2"
M="bash $W/mut.sh"
A=tests/integration/awards-reload-links.test.ts
I=tests/integration/settle-afl-api-issue276.test.ts
case "$name" in
  # ---- Part B: finals path mutations (a finals-only defect the home-and-away-only suite cannot see)
  fin-code)   # finals round code written wrong
    $M "m_fincode_$base" "$base" src/lib/acquisition/afl-api-rounds.ts "s/roundCode: FINALS_ROUND_CODES\[roundType\]/roundCode: 'QF'/" $I ;;
  fin-code-old)
    OLD_TEST=$I $M "m_fincodeold_$base" "$base" src/lib/acquisition/afl-api-rounds.ts "s/roundCode: FINALS_ROUND_CODES\[roundType\]/roundCode: 'QF'/" x ;;
  fin-played) # the writer's club_seasons recompute stops counting finals appearances
    $M "m_finplayed_$base" "$base" src/db/queries/player-derived.ts "s/^        COALESCE(f\.finals, 0),\$/        0,/" $I ;;
  fin-played-old)
    OLD_TEST=$I $M "m_finplayedold_$base" "$base" src/db/queries/player-derived.ts "s/^        COALESCE(f\.finals, 0),\$/        0,/" x ;;
  # ---- Part A: a later-season row left in the legacy scope makes the rekey refuse (mutation of the TEST's scoping)
  keep2026)
    $M "m_keep2026_$base" "$base" $A "s/^      await removeLaterRows();\$/      \/\/ MUTATION: later rows kept/" $A ;;
  # ---- Part A: the loader drifts from the contract (no winner for a completed 2026): the B4 pin (46) passes, the oracle refuses
  loader-no2026)
    $M "m_loaderno2026_$base" "$base" tools/migration/import_awards.py "s/^       AND s.status = 'complete'\$/       AND s.status = 'complete' AND m.season < 2026/" $A ;;
  loader-no2026-old)
    OLD_TEST=$A $M "m_loaderno2026old_$base" "$base" tools/migration/import_awards.py "s/^       AND s.status = 'complete'\$/       AND s.status = 'complete' AND m.season < 2026/" x ;;
  *) echo "unknown $name"; exit 2 ;;
esac
