#!/usr/bin/env bash
# A2 R3 (ISSUE-352) test of the corrected tools/maintenance/offhost-pull.sh: dump-name stamps are the SOURCE's local time
# (Australia/Melbourne), not UTC. Run on streamanator (Linux, GNU date + tzdata; Git Bash on the workstation has no zoneinfo).
#   bash t-offhost-stamp.sh <path to offhost-pull.sh under test>
# Scratch only: everything lives under a new 0700 directory in /mnt/ssd; no production contact, no real dump, no database.
# pg_restore is a PATH shim that exits 0: these tests prove the stamp and retention logic; the archive check is unchanged code.
# Part A calls the script's own stamp_to_epoch function (extracted verbatim) for AEDT, AEST and the DST transition hours.
# Part B runs whole pulls with the test clock override AFLDB_OFFHOST_TEST_NOW.
# Part C is the ISSUE-352 retention regression (flood hold, unchanged repeat pull, operator release, normal pruning).
set -uo pipefail
SCRIPT=${1:?path to offhost-pull.sh}; [ -f "$SCRIPT" ] || { echo "no such script"; exit 2; }
W=$(mktemp -d /mnt/ssd/afldb-a2-stamptest-XXXXXX); chmod 700 "$W"; echo "workspace $W; script sha256 $(sha256sum < "$SCRIPT" | cut -c1-16)"
mkdir "$W/bin"; printf '#!/bin/sh\nexit 0\n' > "$W/bin/pg_restore"; chmod +x "$W/bin/pg_restore"; export PATH="$W/bin:$PATH"
pass=0; fail=0
t() { # name, then a command (as args) that must succeed
  local n="$1"; shift
  if "$@"; then pass=$((pass+1)); echo "  PASS $n"; else fail=$((fail+1)); echo "  FAIL $n"; fi
}
eq() { [ "$1" = "$2" ]; }
utc() { date -u -d "$1" +%s; }

echo "== Part A: stamp_to_epoch (the script's own function)"
STAMP_TZ=Australia/Melbourne
eval "$(sed -n '/^stamp_to_epoch()/,/^}/p' "$SCRIPT")"
a() { # name, stamp "YYYYMMDD HH:MM:SS", expected UTC ISO or FAIL
  local got; got=$(stamp_to_epoch "$2") ; local rc=$?
  if [ "$3" = FAIL ]; then t "$1: $2 has no valid Melbourne instant" eq "$rc" 1
  else t "$1: $2 -> $3" eq "$got" "$(utc "$3")"; fi
}
a "AEDT (UTC+11)"        "20261122 15:03:27" 2026-11-22T04:03:27Z
a "AEDT night backup"    "20261123 02:21:25" 2026-11-22T15:21:25Z
a "AEST (UTC+10)"        "20260715 02:21:25" 2026-07-14T16:21:25Z
a "AEDT->AEST day, before repeat" "20270404 01:59:59" 2027-04-03T14:59:59Z
a "AEDT->AEST repeated hour, earliest" "20270404 02:00:00" 2027-04-03T15:00:00Z
a "repeated hour mid, earliest"        "20270404 02:30:00" 2027-04-03T15:30:00Z
a "repeated hour end, earliest"        "20270404 02:59:59" 2027-04-03T15:59:59Z
a "first unambiguous AEST after repeat" "20270404 03:00:00" 2027-04-03T17:00:00Z
a "AEST->AEDT before gap"  "20271003 01:59:59" 2027-10-02T15:59:59Z
a "AEST->AEDT gap start never existed" "20271003 02:00:00" FAIL
a "gap middle never existed"           "20271003 02:30:00" FAIL
a "gap end never existed"              "20271003 02:59:59" FAIL
a "first AEDT after gap"   "20271003 03:00:00" 2027-10-02T16:00:00Z
a "impossible date"        "20261340 25:61:61" FAIL
echo "  (repeated-hour candidates for 2027-04-04 02:30 are 15:30Z (AEDT) and 16:30Z (AEST); the pull uses the earlier)"

echo "== Part B: whole pulls with an overridden clock"
mkpull() { # <case dir> ; creates $1/src $1/dest
  mkdir -p "$1/src" "$1/dest"; chmod 700 "$1/dest"
}
mkdump() { # <src dir> <name>
  head -c 4096 /dev/urandom > "$1/$2"; ( cd "$1" && sha256sum "$2" > "$2.sha256" )
}
run() { # <case dir> <now ISO> [extra env assignments via env]; prints output to $1/out, rc in $1/rc
  ( cd "$1" && AFLDB_OFFHOST_TEST_NOW=$(utc "$2") bash "$SCRIPT" "$1/src" "$1/dest" --keep "${KEEP:-30}" > "$1/out" 2>&1; echo $? > "$1/rc" )
}
verified() { [ -e "$1/dest/.verified-$2" ]; }
quarantined() { [ -e "$1/dest/quarantine/$2" ]; }
reason() { grep -q "$2" "$1/out"; }

# B1 AEDT: the first real A2 dump name, at the real time of the failed pull
C=$W/b1; mkpull $C; mkdump $C/src afldb_prod-20261122-150327.dump; run $C 2026-11-22T04:06:26Z
t "B1 AEDT dump stamped 15:03:27 local, pulled 04:06:26Z: verified, rc 0" verified $C afldb_prod-20261122-150327.dump; t "B1 rc 0" eq "$(cat $C/rc)" 0
# B1b the old (UTC) reading would have quarantined it: prove the test would have caught the defect
t "B1b  (control) stamp read as UTC would be future: 15:03:27Z > 04:06:26Z + 1h" test "$(utc 2026-11-22T15:03:27Z)" -gt "$(( $(utc 2026-11-22T04:06:26Z) + 3600 ))"
# B2 AEST (winter)
C=$W/b2; mkpull $C; mkdump $C/src afldb_prod-20260715-021525.dump; run $C 2026-07-14T16:20:00Z
t "B2 AEST dump stamped 02:15:25 local, pulled 16:20Z: verified" verified $C afldb_prod-20260715-021525.dump
# B3 genuinely future-dated
C=$W/b3; mkpull $C; mkdump $C/src afldb_prod-20261123-150000.dump; run $C 2026-11-22T04:10:00Z
t "B3 genuine future dump (next day 15:00 local) quarantined as future" quarantined $C afldb_prod-20261123-150000.dump
t "B3 reason is 'stamped in the future'" reason $C "stamped in the future"; t "B3 rc 1" eq "$(cat $C/rc)" 1
# B4 skew boundary: stamp 15:03:27 local = 04:03:27Z. now+3600 must be >= that
C=$W/b4a; mkpull $C; mkdump $C/src afldb_prod-20261122-150327.dump; run $C 2026-11-22T03:05:00Z
t "B4a within the 1 h skew (now 03:05Z, stamp 04:03:27Z): verified" verified $C afldb_prod-20261122-150327.dump
C=$W/b4b; mkpull $C; mkdump $C/src afldb_prod-20261122-150327.dump; run $C 2026-11-22T02:50:00Z
t "B4b outside the skew (now 02:50Z): quarantined" quarantined $C afldb_prod-20261122-150327.dump
# B5 repeated hour (daylight saving ends 2027-04-04 03:00 AEDT -> 02:00 AEST); stamp 02:30 occurs at 15:30Z and 16:30Z
S=afldb_prod-20270404-023000.dump
C=$W/b5a; mkpull $C; mkdump $C/src $S; run $C 2027-04-03T15:40:00Z; t "B5a dump of the FIRST 02:30 (AEDT), pulled 15:40Z: verified" verified $C $S
C=$W/b5b; mkpull $C; mkdump $C/src $S; run $C 2027-04-03T16:40:00Z; t "B5b dump of the SECOND 02:30 (AEST), pulled 16:40Z: verified" verified $C $S
C=$W/b5c; mkpull $C; mkdump $C/src $S; run $C 2027-04-03T14:20:00Z; t "B5c same name seen at 14:20Z (before either 02:30): quarantined" quarantined $C $S
C=$W/b5d; mkpull $C; mkdump $C/src $S; run $C 2027-04-03T14:45:00Z; t "B5d at 14:45Z (earliest 15:30Z within the 1 h skew): verified" verified $C $S
# B6 a stamp that never existed (daylight saving starts 2027-10-03 02:00 AEST -> 03:00 AEDT)
S=afldb_prod-20271003-023000.dump
C=$W/b6; mkpull $C; mkdump $C/src $S; run $C 2027-10-03T00:00:00Z
t "B6 nonexistent local time 02:30 on 2027-10-03: quarantined" quarantined $C $S; t "B6 reason named" reason $C "not a Australia/Melbourne local time"
# B7 unchanged behaviours: bad name, bad sidecar
C=$W/b7; mkpull $C; mkdump $C/src notadump-20261122-150327.dump; mkdump $C/src afldb_prod-20261122-1503.dump; run $C 2026-11-22T04:10:00Z
t "B7 name without HHMMSS quarantined (unexpected name)" quarantined $C afldb_prod-20261122-1503.dump
C=$W/b8; mkpull $C; mkdump $C/src afldb_prod-20261122-150327.dump; echo "0000000000000000000000000000000000000000000000000000000000000000  afldb_prod-20261122-150327.dump" > $C/src/afldb_prod-20261122-150327.dump.sha256; run $C 2026-11-22T04:10:00Z
t "B8 wrong sidecar hash quarantined" quarantined $C afldb_prod-20261122-150327.dump
# B9 an invalid test clock is refused
C=$W/b9; mkpull $C; ( AFLDB_OFFHOST_TEST_NOW=abc bash "$SCRIPT" $C/src $C/dest > $C/out 2>&1; echo $? > $C/rc ); t "B9 non-numeric test clock refused, rc 2" eq "$(cat $C/rc)" 2

echo "== Part C: ISSUE-352 retention regression (flood hold, unchanged repeat pull, release, normal pruning)"
seed() { # <case> : 3 verified old dumps in dest AND source, markers aged
  local C=$1 i; mkpull $C
  for i in 1 2 3; do n=afldb_prod-2026010${i}-020000.dump; mkdump $C/src $n; cp -p $C/src/$n $C/src/$n.sha256 $C/dest/; : > $C/dest/.verified-$n; touch -d "2026-01-0${i} 00:00:00" $C/dest/.verified-$n; done
}
cnt() { ls -1 "$1/dest"/*.dump 2>/dev/null | wc -l; }
C=$W/c1; seed $C; KEEP=2
for i in 4 5 6 7; do mkdump $C/src afldb_prod-2026110${i}-020000.dump; done
KEEP=2 run $C 2026-11-22T04:10:00Z
t "C1 flood (4 new > limit 3): retention hold written" test -e $C/dest/.retention-hold
t "C1 nothing deleted (7 dumps held)" eq "$(cnt $C)" 7; t "C1 rc 1" eq "$(cat $C/rc)" 1
KEEP=2 run $C 2026-11-22T04:20:00Z
t "C2 UNCHANGED second pull (the ISSUE-352 regression): still nothing deleted (7)" eq "$(cnt $C)" 7; t "C2 rc 1 while the hold exists" eq "$(cat $C/rc)" 1
rm -f $C/dest/.retention-hold; KEEP=2 run $C 2026-11-22T04:30:00Z
t "C3 after the operator removes the hold: normal retention keeps 2" eq "$(cnt $C)" 2; t "C3 rc 0" eq "$(cat $C/rc)" 0
C=$W/c4; seed $C; mkdump $C/src afldb_prod-20261104-020000.dump; KEEP=2 run $C 2026-11-22T04:10:00Z
t "C4 normal day (1 new): keeps 2 newest, removes the 2 oldest" eq "$(cnt $C)" 2; t "C4 the new dump is kept" verified $C afldb_prod-20261104-020000.dump; t "C4 rc 0" eq "$(cat $C/rc)" 0

echo "== RESULT: $pass passed, $fail failed (workspace $W kept; remove with rm -rf after review)"
[ "$fail" = 0 ] && echo "OFFHOST-STAMP RESULT PASS" || echo "OFFHOST-STAMP RESULT FAIL"
