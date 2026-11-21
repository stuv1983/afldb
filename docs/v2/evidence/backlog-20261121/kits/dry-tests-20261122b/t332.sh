#!/bin/sh
# ISSUE-332 dry tests of the kit wrapper against NON-production targets only. Every run overrides AFLDB_PROD_SSH to a
# .invalid host and AFLDB_SETTLE_KEY to a nonexistent key; stub runs put a stub ssh first on PATH that records its argv.
W=/mnt/ssd/afldb-backlog-20261122b-332
set -u
mkdir -p "$W/stub" "$W/out"; chmod 700 "$W"
cp "$W/afldb-settle-check.sh" "$W/stub/../wrapper.sh"
[ "$(sha256sum "$W/wrapper.sh" | cut -d' ' -f1)" = "$(sha256sum "$W/afldb-settle-check.sh" | cut -d' ' -f1)" ] || exit 9
cat > "$W/stub/ssh" <<'EOS'
#!/bin/sh
printf '%s\n' "$*" >> "$STUB_ARGV"
case "$STUB_MODE" in
  ok) echo "AFLDB_SETTLE_STATUS OK"; exit 0 ;;
  failed) echo "AFLDB_SETTLE_STATUS FAILED unit=afldb-settle-afl-api.service result=exit-code"; exit 1 ;;
  unknown) echo "AFLDB_SETTLE_STATUS UNKNOWN"; exit 2 ;;
  unreach) echo "ssh: connect to host x port 22: Connection timed out"; exit 255 ;;
  hang) sleep 75; exit 0 ;;
esac
EOS
chmod 755 "$W/stub/ssh"
cat > "$W/alarm-ok.sh" <<'EOS'
#!/bin/sh
{ echo "--- delivered $(date -u +%FT%TZ)"; cat; } >> "$ALARM_SINK"
EOS
printf '#!/bin/sh\ncat >/dev/null; exit 7\n' > "$W/alarm-fail.sh"
chmod 755 "$W/alarm-ok.sh" "$W/alarm-fail.sh"
run() { # name mode alarmcmd expect_rc
  st="$W/out/$1"; rm -rf "$st"; mkdir -p "$st"
  if [ "$2" = real ]; then P="$PATH"; else P="$W/stub:$PATH"; fi
  env -i HOME="$HOME" PATH="$P" STUB_MODE="$2" STUB_ARGV="$st/argv" ALARM_SINK="$st/sink" \
      AFLDB_OPS_STATE="$st/state" AFLDB_PROD_SSH=arm@afldb-settle-check.invalid AFLDB_SETTLE_KEY="$W/no-such-key" \
      ${3:+AFLDB_ALARM_CMD="$3"} sh "$W/wrapper.sh"
  rc=$?
  verdict=FAIL; [ "$rc" = "$4" ] && verdict=PASS
  echo "$verdict $1 mode=$2 rc=$rc expect=$4 log=[$(tail -n 1 "$st/state/settle-check.log" 2>/dev/null)] alarms=$(grep -c '^---$' "$st/state/alarms.log" 2>/dev/null || echo 0) sink=$(grep -c '^--- delivered' "$st/sink" 2>/dev/null || echo 0) argv=[$(cat "$st/argv" 2>/dev/null)]"
}
run T1-ok ok "" 0
run T2-failed-noalarm failed "" 3
run T3-failed-alarm failed "sh $W/alarm-ok.sh" 1
run T4-unknown-alarm unknown "sh $W/alarm-ok.sh" 1
run T5-unreach-alarm unreach "sh $W/alarm-ok.sh" 1
run T6-alarmcmd-fails failed "sh $W/alarm-fail.sh" 4
run T7-hang-timeout hang "sh $W/alarm-ok.sh" 1
run T8-real-ssh-invalid real "sh $W/alarm-ok.sh" 1
echo "--- T8 delivered message"; cat "$W/out/T8-real-ssh-invalid/sink"
echo "--- T7 log"; cat "$W/out/T7-hang-timeout/state/settle-check.log"
