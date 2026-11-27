#!/usr/bin/env bash
# Release 17822b29, gate G0 (production half): identify Tuesday's scheduled 02:2x dump. PRODUCTION, as arm, READ-ONLY (glob,
# sha256sum, systemctl show, journalctl of afldb-backup.service; no write, no sudo, no database).
# PASS requires: afldb-backup.service last started today 02:20-02:31 (scheduled timer run) with Result=success, ExecMainStatus=0;
# exactly ONE afldb_prod-<today>-02[23]*.dump; its re-hash equals its one-line sidecar; the service journal reports exactly one
# "backup ok: <that name> ... sha256 <first 16 hex>" (ISSUE-352 attribution, pick_overnight_dump verbatim from
# r6-20261125/r6-pre-verify.sh, Astra-reviewed); no FAILED marker. Prints "OFFHOST-COMPARE <dump> <sha256>" for the streamanator
# half: r6-offhost-verify.sh <YYYY-MM-DD> <dump> <sha256>, which must exit 0 (SCHEDULED-COPY-VERIFIED). Any other result: G0 FAIL.
# Run (workstation Git Bash; never at minute :16-:18):
#   tr -d '\r' < r1-g0-dump.sh | C:/Windows/System32/OpenSSH/ssh.exe -o BatchMode=yes afldb bash -s -- 2026-11-24
# Test seam: R1_LIB_ONLY=1 when sourced.
pick_overnight_dump() { # backup-dir yyyymmdd service-journal-text
  local bk=$1 day=$2 jl=$3 f sd name ss a; local -a sds jb
  shopt -s nullglob; sds=("$bk"/afldb_prod-"$day"-02[23]*.dump); shopt -u nullglob
  [ "${#sds[@]}" -ge 1 ] || { echo "REASON no afldb_prod-$day-02[23]*.dump in $bk"; return 1; }
  [ "${#sds[@]}" -eq 1 ] || { echo "REASON ambiguous: ${#sds[@]} dumps in the 02:2x/02:3x window ($(printf '%s ' "${sds[@]##*/}")): refusing to choose one"; return 1; }
  sd=${sds[0]}; name=${sd##*/}
  [ -f "$sd.sha256" ] && [ "$(wc -l < "$sd.sha256")" = 1 ] || { echo "REASON $name has no one-line sidecar"; return 1; }
  ss=$(cut -d' ' -f1 "$sd.sha256"); a=$(sha256sum < "$sd" | cut -d' ' -f1)
  [[ $ss =~ ^[0-9a-f]{64}$ ]] && [ "$a" = "$ss" ] || { echo "REASON $name re-hash $a != sidecar '$ss'"; return 1; }
  awk -v h="$ss" -v n="$name" 'NF==2 && $1==h {sub(/^\*/, "", $2); if ($2==n) good=1} END {exit !(NR==1 && good)}' "$sd.sha256" \
    || { echo "REASON checksum sidecar does not name $name"; return 1; }
  mapfile -t jb < <(sed -n 's/.*scheduled-backup: backup ok: \([^ ]*\) [0-9]* bytes sha256 \([0-9a-f]*\).*/\1 \2/p' <<< "$jl")
  [ "${#jb[@]}" -eq 1 ] || { echo "REASON the afldb-backup.service journal reports ${#jb[@]} 'backup ok' lines (need exactly 1): dump attribution unproven"; return 1; }
  [ "${jb[0]%% *}" = "$name" ] && [ "${jb[0]#* }" = "${ss:0:16}" ] || { echo "REASON the service reported '${jb[0]}', not $name sha256 ${ss:0:16}: the same-window file is not the service's dump"; return 1; }
  echo "$name $ss"
}
main() {
set -uo pipefail; export LC_ALL=C
DAY=${1:?YYYY-MM-DD}; [[ $DAY =~ ^2026-11-2[4-9]$ ]] || { echo "STOP usage: <YYYY-MM-DD Melbourne date of the run>"; exit 2; }
[ "$(hostname)" = afldb-prod ] && [ "$(id -un)" = arm ] || { echo "STOP not afldb-prod as arm"; exit 2; }
BK=/home/arm/backups/afldb-scheduled; DC=${DAY//-/}; F=0
ep() { TZ=Australia/Melbourne date -d "$1" +%s; }
mel() { TZ=Australia/Melbourne date -d "@$1" '+%a %F %H:%M:%S %Z'; }
[ "$(TZ=Australia/Melbourne date +%F)" = "$DAY" ] || { echo "STOP today (Melbourne) is $(TZ=Australia/Melbourne date +%F), not $DAY"; exit 2; }
echo "== R1 G0 $(date -u +%FT%TZ) local $(mel "$(date +%s)") day $DAY"
B0=$(ep "$DAY 02:20"); B1=$(ep "$DAY 02:31")
bs=$(TZ=UTC systemctl show --timestamp=unix -p ExecMainStartTimestamp --value afldb-backup.service); bs=$(date -u -d "${bs:-invalid}" +%s 2>/dev/null || echo 0)
br=$(systemctl show afldb-backup.service -p Result --value); bx=$(systemctl show afldb-backup.service -p ExecMainStatus --value)
if [ "$bs" -ge "$B0" ] && [ "$bs" -le "$B1" ] && [ "$br" = success ] && [ "$bx" = 0 ]; then echo "PASS afldb-backup.service scheduled run $(mel "$bs") Result=$br status=$bx"
else echo "FAIL afldb-backup.service last start $([ "$bs" -gt 0 ] && mel "$bs" || echo never) Result=$br status=$bx (expected today 02:20-02:31, success, 0)"; F=1; fi
SJ=$(journalctl -u afldb-backup.service --since "@$B0" --until "@$((B1 + 900))" -o cat --no-pager 2>/dev/null)
if PICK=$(pick_overnight_dump "$BK" "$DC" "$SJ"); then
  echo "PASS scheduled dump unique, attributed to the service journal, re-hash = sidecar: ${PICK%% *} $(stat -c %s "$BK/${PICK%% *}") B"
  echo "OFFHOST-COMPARE $PICK"
else echo "FAIL dump not attributable: ${PICK#REASON }"; F=1; fi
M=$(ls -1 "$BK"/.state/FAILED-* 2>/dev/null | tr '\n' ' '); [ -z "$M" ] && echo "PASS no FAILED marker" || { echo "FAIL FAILED marker(s): $M"; F=1; }
echo "INFO afldb-backup-verify.service last: $(systemctl show afldb-backup-verify.service -p Result -p ExecMainStatus -p ExecMainStartTimestamp --value | tr '\n' ' ')(record; not a G0 criterion)"
[ $F = 0 ] && echo "G0 PROD RESULT PASS: now on streamanator: r6-offhost-verify.sh $DAY <dump> <sha256> must exit 0" || { echo "G0 PROD RESULT FAIL: STOP, the release is deferred, production unchanged"; exit 1; }
}
if [ "${R1_LIB_ONLY:-0}" = 1 ]; then return 0 2>/dev/null || exit 0; fi
main "$@" < /dev/null
