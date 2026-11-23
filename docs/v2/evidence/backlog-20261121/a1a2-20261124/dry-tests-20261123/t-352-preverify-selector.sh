#!/usr/bin/env bash
# ISSUE-352 follow-up (independent review, 22 Nov 2026): r6-pre-verify.sh chose the scheduled overnight dump as the FIRST file
# matching 02[23]*, so a second same-window dump could be compared (and its pair printed as OFFHOST-COMPARE) instead of the
# afldb-backup.service invocation's own dump. The production selector is now pick_overnight_dump(); this harness extracts that
# exact function from the script and runs it against disposable fixtures. No production contact; read-only on the fixtures.
# Usage: bash t-352-preverify-selector.sh <source root>
set -uo pipefail
ROOT=${1:?source root}; SCRIPT=$ROOT/docs/v2/evidence/backlog-20261121/r6-20261125/r6-pre-verify.sh
W=$(mktemp -d "${TMPDIR:-/tmp}/afldb-fix352sel-XXXXXX"); trap 'rm -rf -- "$W"' EXIT
export LC_ALL=C
source <(sed -n '/^pick_overnight_dump()/,/^main() {/p' "$SCRIPT" | sed '$d')
declare -F pick_overnight_dump > /dev/null || { echo 'FAIL: pick_overnight_dump not found in the script'; exit 1; }
pass=0; fails=0
expect() { local want=$1 name=$2 rc=0; shift 2; "$@" > "$W/result" 2>&1 || rc=$?; cat "$W/result"; echo "$name actual_exit=$rc expected=$want"
  if [ "$rc" = "$want" ]; then pass=$((pass+1)); else fails=$((fails+1)); echo "***** FAIL $name"; fi; }
has() { if grep -qF -- "$1" "$W/result"; then pass=$((pass+1)); else fails=$((fails+1)); echo "***** FAIL missing output: $1"; fi; }
DAY=20261125; G=afldb_prod-$DAY-022145.dump; DECOY=afldb_prod-$DAY-022030.dump; VER=afldb_prod-$DAY-033635.dump
mk() { local n=$1; printf 'bytes of %s' "$n" > "$W/bk/$n"; (cd "$W/bk" && sha256sum "$n" > "$n.sha256"); }
journal() { printf '2026-11-25T02:21:50+11:00 scheduled-backup: target: mode=backup dir=/x keep=14 offhost=none\n%s scheduled-backup: backup ok: %s %s bytes sha256 %s offhost=skipped\n' '2026-11-24T15:21:50Z' "$1" "$(stat -c %s "$W/bk/$1")" "$(sha256sum < "$W/bk/$1" | cut -c1-16)"; }
reset() { rm -rf "$W/bk"; mkdir -p "$W/bk"; mk "$G"; JL=$(journal "$G"); }
pick() { pick_overnight_dump "$W/bk" "$DAY" "$JL"; }

reset; expect 0 unique-dump-attributed pick; has "$G $(cut -d' ' -f1 "$W/bk/$G.sha256")"
reset; printf '%s  wrong.dump\n' "$(cut -d' ' -f1 "$W/bk/$G.sha256")" > "$W/bk/$G.sha256"
expect 1 correct-digest-wrong-sidecar-basename pick
reset; sed -i 's/  afldb/ *afldb/' "$W/bk/$G.sha256"; expect 0 exact-basename-binary-sidecar pick
reset; mk "$VER"; mk "afldb_prod-$DAY-090000.dump"
HS=$(cut -d' ' -f1 "$W/bk/$VER.sha256")
MANUAL="afldb_prod-$DAY-090000.dump"; MH=$(cut -d' ' -f1 "$W/bk/$MANUAL.sha256")
J="aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa 1795538210 $VER 1"
JOURNAL=$W/verify-journal.json
printf '%s\n' \
  "{\"_SYSTEMD_UNIT\":\"afldb-backup-verify.service\",\"_SYSTEMD_INVOCATION_ID\":\"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa\",\"__REALTIME_TIMESTAMP\":\"1795538210123456\",\"MESSAGE\":\"2026-11-24T16:36:50Z scheduled-backup: verify ok: $VER restored and proven (attempt 1)\"}" \
  "{\"_SYSTEMD_UNIT\":\"session-1.scope\",\"_SYSTEMD_INVOCATION_ID\":\"bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb\",\"__REALTIME_TIMESTAMP\":\"1795550400123456\",\"MESSAGE\":\"2026-11-24T22:00:00Z scheduled-backup: verify ok: $MANUAL restored and proven (attempt 1)\"}" > "$JOURNAL"
journalctl() { cat "$JOURNAL"; }
expect 0 collect-only-verification-unit-proof restore_journal 1795538190 1795538211 "$(command -v node)"
has "$J"
unset -f journalctl
systemctl() {
  [ "$TZ" = UTC ] || return 1
  case $4 in
    LastTriggerUSec) echo 'Tue 2026-11-24 16:36:30 UTC';;
    ExecMainStartTimestamp) echo '@1795538190';;
    *) echo 'n/a';;
  esac
}
expect 0 systemd-formatted-timer-dispatch ts fixture.timer LastTriggerUSec
has 1795538190
expect 0 systemd-unix-service-start ts fixture.service ExecMainStartTimestamp
has 1795538190
expect 0 missing-systemd-timestamp-is-zero ts fixture.service ExecMainExitTimestamp
has 0
unset -f systemctl
restore() { match_restore "$W/bk" "$DAY" 1795538190 1795538211 "$@"; }
expect 0 scheduled-restore-dump-and-state-match restore "$J" 1795538209 "$VER" "$HS" 1
expect 1 later-manual-restore-overwrote-state restore "$J" 1795550400 "$MANUAL" "$MH" 1
expect 1 same-dump-late-manual-state restore "$J" 1795550400 "$VER" "$HS" 1
expect 1 ambiguous-restore-invocation restore "$J"$'\n'"$J" 1795538209 "$VER" "$HS" 1
printf changed >> "$W/bk/$VER"
expect 1 changed-restored-dump restore "$J" 1795538209 "$VER" "$HS" 1
reset; mk "$VER"; expect 0 verification-service-dump-beside-overnight pick; has "$G "
echo 'Old selector (ls | head -1) on the ambiguous fixture picks the decoy; the new selector refuses.'
reset; mk "$DECOY"
old=$(ls -1 "$W/bk"/afldb_prod-"$DAY"-02[23]*.dump | head -n 1); echo "old selector picked: ${old##*/}"
if [ "${old##*/}" = "$DECOY" ]; then pass=$((pass+1)); else fails=$((fails+1)); echo '***** FAIL fixture does not reproduce the first-match defect'; fi
expect 1 same-window-second-dump-refused pick; has 'ambiguous: 2 dumps'
reset; mk "$DECOY"; JL=$(journal "$DECOY"); rm -f "$W/bk/$G" "$W/bk/$G.sha256"; expect 0 only-the-service-dump-present pick
reset; mk "$DECOY"; rm -f "$W/bk/$DECOY"; expect 0 orphan-sidecar-is-not-a-dump pick
reset; JL=$(journal "$G"); mk "$DECOY"; rm -f "$W/bk/$G" "$W/bk/$G.sha256"; expect 1 service-reported-another-dump pick; has 'not'
reset; JL=''; expect 1 empty-service-journal pick; has 'dump attribution unproven'
reset; JL=$(printf '%s\n%s\n' "$(journal "$G")" "$(journal "$G")"); expect 1 two-backup-ok-lines pick; has 'reports 2'
reset; JL=$(journal "$G" | sed 's/sha256 [0-9a-f]*/sha256 0000000000000000/'); expect 1 journal-hash-prefix-differs pick; has 'not'
reset; printf corrupt >> "$W/bk/$G"; expect 1 dump-bytes-differ-from-sidecar pick; has 're-hash'
reset; rm "$W/bk/$G.sha256"; expect 1 no-sidecar pick; has 'one-line sidecar'
reset; cat "$W/bk/$G.sha256" "$W/bk/$G.sha256" > "$W/two"; mv "$W/two" "$W/bk/$G.sha256"; expect 1 multiline-sidecar pick; has 'one-line sidecar'
reset; rm -f "$W/bk/$G" "$W/bk/$G.sha256"; expect 1 no-overnight-dump pick; has 'no afldb_prod'
reset; mv "$W/bk/$G" "$W/bk/afldb_prod-20261124-022145.dump"; mv "$W/bk/$G.sha256" "$W/bk/afldb_prod-20261124-022145.dump.sha256"; expect 1 yesterday-dump-only pick
bash -n "$SCRIPT" && pass=$((pass+1)) || { fails=$((fails+1)); echo '***** FAIL r6-pre-verify.sh syntax'; }
echo "T352-SELECTOR RESULT $pass passed, $fails failed"
[ "$fails" = 0 ]
