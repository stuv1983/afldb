#!/usr/bin/env bash
# REHEARSAL ONLY (R6 r5, 27 Nov 2026). Runs INSIDE one disposable container whose PID 1 is the REAL systemd 255 (Ubuntu 24.04), started
# by real-systemd-attribution.sh on streamanator (--network none, no --privileged; see that script's header). Not for production.
# Scenarios (argument 1):
#   evidence               what an unprivileged user can and cannot read about a timer start and a start by hand (probe units; no gate)
#   genuine-r5             the REAL afldb-backup.timer starts the REAL afldb-backup.service (the r5 scheduled-backup.sh): both gates must PASS
#   genuine-r5-second-night  the same one dispatch later in the same loaded unit (stale unit-level details): both gates must PASS
#   genuine-current        a genuine timer run of today's production script (f92d6e29): the corrected gates must STOP
#   astra-dep-r5 / astra-dep-current   Astra's case: the timer's start fails on a dependency (PID 1 logs it, arm cannot), root fixes the
#                          dependency and runs `systemctl start` 3 s after the dispatch and it succeeds: STOP; the f92d6e29 gates PASS it
#   astra-exec-r5          the same with an exec failure of the timer's run (the unit's environment and ActivationDetails now carry the
#                          timer's dispatch EXACTLY, so an environment-based check would PASS): STOP
# The real unit files from deploy/ (adapted only where this file says so), the real scheduled-backup.sh (r5 or the f92d6e29 original),
# a STUB tools/maintenance/backup.sh (no database exists here: it writes a random-byte dump named exactly as the real one names it, and
# prints the real "==> Backing up ... to <path>" line) and an empty restore-test.sh (scheduled-backup.sh only checks that it exists).
# TIME: the container shares the host clock. The gates' date guards need "today, Melbourne, 2026-11-24..29" and the window 02:20-02:31,
# so the container's Australia/Melbourne zone (and /etc/localtime) is replaced, by the entry script, with a fixed-offset zone that puts
# the real dispatch at 02:20:00 on 2026-11-28 local time. OnCalendar=*-*-* 02:20 then fires from the real timer at the real moment.
# The gates run through their REAL main, as arm (uid 1000, no supplementary groups: not adm, not systemd-journal).
# A-2 (r6-pre-verify.sh) cannot reach its section 5 honestly (it requires 2026-11-25); its seven shared functions are extracted
# verbatim from r6-pre-verify.sh and run with the same live reads and window bounds (printed as "A2-FUNCTIONS").
set -uo pipefail; export LC_ALL=C
SC=${1:?scenario}; FIX=/in/fix; ENVF=${2:-}
B=docs/v2/evidence/backlog-20261121; H5=$B/r6-20261125/review-fixes-r5-20261127
G0=$FIX/docs/v2/evidence/release-17822b29-20261124/scripts/r1-g0-dump.sh; PRE=$FIX/$B/r6-20261125/r6-pre-verify.sh
FG0=$FIX/$H5/orig-f92d6e29/r1-g0-dump.sh; FPRE=$FIX/$H5/orig-f92d6e29/r6-pre-verify.sh
NEWSB=$FIX/tools/maintenance/scheduled-backup.sh; OLDSB=$FIX/$H5/orig-f92d6e29/scheduled-backup.sh
NODE=/home/arm/.nvm/versions/node/v22.23.2/bin/node
DAY=2026-11-28; DAYC=20261128; BKD=/home/arm/backups/afldb-scheduled
as_arm() { setpriv --reuid=arm --regid=arm --init-groups env -i HOME=/home/arm USER=arm LOGNAME=arm PATH=/usr/local/bin:/usr/bin:/bin LANG=C.UTF-8 "$@"; }
line() { printf '%s\n' "$*"; }
hdr() { printf '\n== %s\n' "$*"; }
now_us() { echo $(( $(date +%s%N) / 1000 )); }
tusec() { busctl get-property org.freedesktop.systemd1 "/org/freedesktop/systemd1/unit/$1" org.freedesktop.systemd1.Timer LastTriggerUSec 2>&1 | awk '{print $2}'; }
details_unit() { busctl get-property org.freedesktop.systemd1 "/org/freedesktop/systemd1/unit/$1" org.freedesktop.systemd1.Unit ActivationDetails 2>&1; }
wait_systemd() { local i; for i in $(seq 1 120); do case $(systemctl is-system-running 2>/dev/null) in running|degraded) return 0;; esac; sleep 1; done; echo "STOP systemd did not come up"; return 1; }

wait_systemd || exit 1
hdr "environment"
line "systemd: $(systemctl --version | head -1); kernel $(uname -r); image $(. /etc/os-release; echo "$PRETTY_NAME"); PID 1: $(cat /proc/1/comm); hostname $(hostname)"
line "date now (UTC) $(date -u +%FT%T); zone file in use: $(readlink -f /etc/localtime); local $(TZ=Australia/Melbourne date '+%F %T %Z')"
userdel -r ubuntu > /dev/null 2>&1; id arm > /dev/null 2>&1 || useradd -M -u 1000 -s /bin/bash arm
install -d -o arm -g arm -m 755 /home/arm /home/arm/projects /home/arm/projects/afldb /home/arm/projects/afldb/tools /home/arm/projects/afldb/tools/maintenance \
  /home/arm/backups "$BKD"
line "arm: $(id arm) (journal-reading groups: none expected: adm=$(getent group adm | cut -d: -f4) systemd-journal=$(getent group systemd-journal | cut -d: -f4))"
line "journal storage: $(ls -ld /var/log/journal | cut -c1-60); journald files: $(ls /var/log/journal/*/ 2>/dev/null | tr '\n' ' ')"

# ------------------------------------------------------------------------------------------------------------------ evidence
if [ "$SC" = evidence ]; then
  PROBE=/home/arm/probe.sh
  cat > $PROBE <<'EOF'
#!/bin/bash
# $1 = unit name. Prints, from INSIDE the run, what systemd gave it.
u=$1; j=$(systemctl show "$u" -p Job --value 2>&1)
echo "probe($u): inv=$INVOCATION_ID env TRIGGER_UNIT=${TRIGGER_UNIT:-none} TRIGGER_TIMER_REALTIME_USEC=${TRIGGER_TIMER_REALTIME_USEC:-none}"
echo "probe($u): job=$j JOB ActivationDetails: $(busctl get-property org.freedesktop.systemd1 /org/freedesktop/systemd1/job/$j org.freedesktop.systemd1.Job ActivationDetails 2>&1)"
echo "probe($u): UNIT ActivationDetails: $(busctl get-property org.freedesktop.systemd1 /org/freedesktop/systemd1/unit/${u%.service}_2eservice org.freedesktop.systemd1.Unit ActivationDetails 2>&1)"
EOF
  chmod 755 $PROBE; chown arm:arm $PROBE
  mk() { # name: a oneshot service as arm that runs the probe, and a timer that fires 20 s after it is started
    printf '[Unit]\nDescription=%s\n[Service]\nType=oneshot\nUser=arm\nGroup=arm\nExecStart=%s %s.service\n' "$1" "${2:-/bin/bash $PROBE}" "$1" > /etc/systemd/system/$1.service
    printf '[Unit]\nDescription=%s timer\n[Timer]\nOnActiveSec=20s\nAccuracySec=1s\n' "$1" > /etc/systemd/system/$1.timer; }
  show_runs() { # unit: the probe lines of every run, as ARM reads them
    as_arm journalctl -u "$1.service" --no-pager -o cat -q | grep '^probe(' | cut -c1-330 | sed 's/^/   arm-reads: /'; }
  lt() { echo "   timer LastTriggerUSec (busctl, as arm): $(as_arm busctl get-property org.freedesktop.systemd1 /org/freedesktop/systemd1/unit/$1_2etimer org.freedesktop.systemd1.Timer LastTriggerUSec)"; }

  hdr "E1 two timer runs and a start by hand, one loaded unit (probe1.service / probe1.timer)"
  mk probe1; systemctl daemon-reload; systemctl start probe1.timer; sleep 24; lt probe1
  line "   -- timer run #1 done. Now a start by hand:"; systemctl start probe1.service
  line "   -- timer #2 (restart the timer; the service stays loaded):"; systemctl restart probe1.timer; sleep 24; lt probe1
  show_runs probe1
  line "   systemctl show probe1.service -p ActivationDetails -> $(systemctl show probe1.service -p ActivationDetails)  (unprintable through systemctl)"
  line "   as arm: busctl UNIT ActivationDetails after all three runs: $(as_arm busctl get-property org.freedesktop.systemd1 /org/freedesktop/systemd1/unit/probe1_2eservice org.freedesktop.systemd1.Unit ActivationDetails)"

  hdr "E2 exec failure of the timer's run, then a start by hand 3 s later (probe2: ExecStart binary missing, then restored)"
  mk probe2 "/usr/local/bin/probe2-bash"; rm -f /usr/local/bin/probe2-bash
  sed -i "s#^ExecStart=/usr/local/bin/probe2-bash#ExecStart=/usr/local/bin/probe2-bash $PROBE#" /etc/systemd/system/probe2.service
  systemctl daemon-reload; systemctl start probe2.timer; sleep 24; lt probe2
  line "   service after the timer's run: $(systemctl show probe2.service -p ActiveState -p Result -p ExecMainStatus | tr '\n' ' ')"
  line "   as ROOT the journal says: $(journalctl -u probe2.service --no-pager -o cat | tr '\n' '|' | cut -c1-300)"
  line "   as ARM the journal says: [$(as_arm journalctl -u probe2.service --no-pager -o cat -q | tr '\n' '|')] (nothing: PID 1 alone logged it)"
  LT=$(tusec probe2_2etimer); until [ "$(now_us)" -ge $((LT + 3000000)) ]; do sleep 0.1; done
  cp /bin/bash /usr/local/bin/probe2-bash; systemctl start probe2.service
  line "   -- start by hand $(( ($(now_us) - LT) / 1000000 )) s after the dispatch (LastTriggerUSec $LT):"; show_runs probe2
  line "   => the hand-started run's ENVIRONMENT and the unit's ActivationDetails carry the timer's dispatch exactly ($LT); its own start JOB carries none."

  hdr "E3 a failed dependency, and a skipped condition, at the timer's dispatch (probe3 / probe4): no details are kept for the manual run"
  printf '[Unit]\nDescription=probe3 dependency\n[Service]\nType=oneshot\nRemainAfterExit=yes\nExecStart=/bin/sh -c "test -f /run/probe3-ok"\n' > /etc/systemd/system/probe3-dep.service
  mk probe3; sed -i -e '/^\[Service\]/i After=probe3-dep.service' -e '/^\[Service\]/i Requires=probe3-dep.service' /etc/systemd/system/probe3.service
  mk probe4; sed -i '/^\[Service\]/i ConditionPathExists=/run/probe4-go' /etc/systemd/system/probe4.service
  rm -f /run/probe3-ok /run/probe4-go; systemctl daemon-reload; systemctl start probe3.timer probe4.timer; sleep 24
  line "   as ROOT (PID 1's lines): $(journalctl -u probe3.service -u probe3-dep.service --no-pager -o cat | tr '\n' '|' | cut -c1-420)"
  line "   as ROOT: $(journalctl -u probe4.service --no-pager -o cat | tr '\n' '|' | cut -c1-200)"
  line "   as ARM: probe3 [$(as_arm journalctl -u probe3.service --no-pager -o cat -q | tr '\n' '|')] probe4 [$(as_arm journalctl -u probe4.service --no-pager -o cat -q | tr '\n' '|')]"
  touch /run/probe3-ok /run/probe4-go; systemctl restart probe3-dep.service; systemctl start probe3.service probe4.service
  show_runs probe3; show_runs probe4

  hdr "E4 what arm can read of the genuine timer run in E1: the journal's entries by _PID and _UID, and whether PID 1's lines show"
  for who in root arm; do
    if [ $who = root ]; then o=$(journalctl -u probe1.service -o json --no-pager); else o=$(as_arm journalctl -u probe1.service -o json --no-pager -q); fi
    line "   $who: $(grep -c . <<< "$o") entries; by _PID/_UID: $(grep -o '"_PID":"[0-9]*"\|"_UID":"[0-9]*"' <<< "$o" | sort | uniq -c | tr -s ' ' | tr '\n' ';')"
  done
  line "   arm's journal files: $(ls -l /var/log/journal/*/user-1000.journal | awk '{print $1, $3, $4, $9}'); system.journal: $(ls -l /var/log/journal/*/system.journal | awk '{print $1, $3, $4}')"
  line "   arm without a user journal (volatile storage): switching journald to Storage=volatile and re-running a probe as arm:"
  mkdir -p /etc/systemd/journald.conf.d; printf '[Journal]\nStorage=volatile\n' > /etc/systemd/journald.conf.d/vol.conf
  rm -rf /var/log/journal/*; systemctl restart systemd-journald; sleep 1; mk probe5; systemctl daemon-reload; systemctl start probe5.service
  line "   as ROOT: $(journalctl -u probe5.service --no-pager -o cat | grep -c .) lines; as ARM: [$(as_arm journalctl -u probe5.service --no-pager -o cat 2>&1 | tr '\n' '|' | cut -c1-200)]"
  line "   (production's journal must be PERSISTENT with per-user files for arm to read its own service's lines; the existing gates already depend on it)"
  exit 0
fi

# ------------------------------------------------------------------------------------------------------------------ the real unit
case $SC in
  genuine-r5|genuine-r5-second-night|astra-dep-r5|astra-exec-r5) SB=$NEWSB; SBN=r5;;
  genuine-current|astra-dep-current) SB=$OLDSB; SBN=current;;
  *) echo "STOP unknown scenario $SC"; exit 2;;
esac
cp "$SB" /home/arm/projects/afldb/tools/maintenance/scheduled-backup.sh
cat > /home/arm/projects/afldb/tools/maintenance/backup.sh <<'EOF'
#!/usr/bin/env bash
# STUB for the rehearsal (no database exists in the container). Same interface and same output line as tools/maintenance/backup.sh:
# --dir D --keep N; writes D/afldb_prod-<YYYYMMDD-HHMMSS>.dump and prints "==> Backing up afldb_prod to <path>". It also prints the
# environment systemd gave this run, so the evidence shows what an environment-based check would have seen.
dir=''; while [ $# -gt 0 ]; do case $1 in --dir) dir=$2; shift 2;; *) shift;; esac; done
target="$dir/afldb_prod-$(date +%Y%m%d-%H%M%S).dump"
echo "==> Backing up afldb_prod to $target"
head -c 4096 /dev/urandom > "$target"
echo "stub-backup: environment TRIGGER_UNIT=${TRIGGER_UNIT:-none} TRIGGER_TIMER_REALTIME_USEC=${TRIGGER_TIMER_REALTIME_USEC:-none} INVOCATION_ID=$INVOCATION_ID"
echo "==> Done."
EOF
printf '#!/usr/bin/env bash\nexit 0\n' > /home/arm/projects/afldb/tools/maintenance/restore-test.sh
chown -R arm:arm /home/arm/projects; chmod 755 /home/arm/projects/afldb/tools/maintenance/*.sh
for u in afldb-backup.service afldb-backup.timer afldb-backup-failed.service; do cp "$FIX/deploy/$u" /etc/systemd/system/$u; done
# postgresql.service does not exist in the container and the real unit Requires= it: a stub that is up (or, for the Astra scenarios,
# down until root fixes it). This is the only change to the real unit's behaviour; its text is untouched.
printf '[Unit]\nDescription=stub postgresql for the rehearsal\n[Service]\nType=oneshot\nRemainAfterExit=yes\nExecStart=/bin/sh -c "test -f /run/pg-ok"\n' > /etc/systemd/system/postgresql.service
case $SC in astra-dep-*) rm -f /run/pg-ok;; *) touch /run/pg-ok;; esac
# The timer drop-in: the real timer has RandomizedDelaySec=10min and AccuracySec=1min; for the rehearsal the dispatch must be on time.
mkdir -p /etc/systemd/system/afldb-backup.timer.d
{ printf '[Timer]\nRandomizedDelaySec=0\nAccuracySec=1s\n'; [ "$SC" = genuine-r5-second-night ] && printf 'OnCalendar=*-*-* 02:18\n'; } > /etc/systemd/system/afldb-backup.timer.d/rehearsal.conf
systemctl daemon-reload
hdr "the unit as loaded ($SC; scheduled-backup.sh = $SBN)"
line "scheduled-backup.sh sha256 $(sha256sum < "$SB" | cut -c1-64) ($SBN); G0 $(sha256sum < "$G0" | cut -c1-16) A-2 $(sha256sum < "$PRE" | cut -c1-16) f92d6e29 G0 $(sha256sum < "$FG0" | cut -c1-16) A-2 $(sha256sum < "$FPRE" | cut -c1-16)"
line "afldb-backup.service on disk: $(sha256sum < "$FIX/deploy/afldb-backup.service" | cut -c1-16) timer $(sha256sum < "$FIX/deploy/afldb-backup.timer" | cut -c1-16); drop-in: $(tr '\n' ' ' < /etc/systemd/system/afldb-backup.timer.d/rehearsal.conf)"
systemctl cat afldb-backup.timer --no-pager | grep -E '^(OnCalendar|RandomizedDelaySec|AccuracySec|Persistent|\# /)' | sed 's/^/   timer: /'
systemctl show afldb-backup.service -p User -p ExecStart -p ProtectSystem -p ProtectHome -p PrivateTmp -p NoNewPrivileges -p Requires -p After -p OnFailure --no-pager | cut -c1-260 | sed 's/^/   service: /'
B0=$(TZ=Australia/Melbourne date -d "$DAY 02:20" +%s); B1=$(TZ=Australia/Melbourne date -d "$DAY 02:31" +%s)
[ "$SC" = astra-exec-r5 ] && chmod 644 /usr/bin/bash && line "   /usr/bin/bash made non-executable until the dispatch has failed (the real unit's ExecStart is /bin/bash)"
systemctl start afldb-backup.timer
line "timer armed: $(systemctl show afldb-backup.timer -p NextElapseUSecRealtime --value) (local); window $(TZ=Australia/Melbourne date -d @$B0 '+%T')-$(TZ=Australia/Melbourne date -d @$B1 '+%T') $DAY"

# ------------------------------------------------------------------------------------------------------------------ wait for the dispatch
WANT_FROM=$((B0 * 1000000)); LT=0
for i in $(seq 1 2000); do LT=$(tusec afldb_2dbackup_2etimer); [[ $LT =~ ^[0-9]+$ ]] && [ "$LT" -ge "$WANT_FROM" ] && break; sleep 0.2; done
[ "$LT" -ge "$WANT_FROM" ] 2>/dev/null || { echo "STOP no dispatch inside the window (LastTriggerUSec=$LT, window from $WANT_FROM)"; exit 1; }
line "DISPATCH observed: LastTriggerUSec $LT = $(TZ=Australia/Melbourne date -d @$((LT / 1000000)) '+%F %T %Z') + $((LT % 1000000)) us"
case $SC in
  astra-dep-*|astra-exec-r5)
    until [ "$(now_us)" -ge $((LT + 3000000)) ]; do sleep 0.05; done
    [ "$SC" = astra-exec-r5 ] && { chmod 755 /usr/bin/bash; line "   (the timer's run: $(systemctl show afldb-backup.service -p ActiveState -p Result -p ExecMainStatus | tr '\n' ' '); /usr/bin/bash restored)"; }
    [ "$SC" != astra-exec-r5 ] && { touch /run/pg-ok; systemctl start postgresql.service; line "   (the timer's start failed; postgresql stub brought up)"; }
    line "   root: systemctl start afldb-backup.service at +$(( ($(now_us) - LT) / 1000 )) ms after the dispatch"
    systemctl start afldb-backup.service; line "   systemctl start returned $?";;
esac
for i in $(seq 1 300); do st=$(systemctl is-active afldb-backup.service); [ "$st" != active ] && [ "$st" != activating ] && break; sleep 0.2; done
sleep 7   # journald receipt, and the gate's 5 s allowance after the exit

# ------------------------------------------------------------------------------------------------------------------ raw evidence
hdr "raw evidence (as ARM unless stated)"
line "timer: $(as_arm systemctl show afldb-backup.timer -p LastTriggerUSec -p TriggeredBy -p Result | tr '\n' ' ') busctl: $(as_arm busctl get-property org.freedesktop.systemd1 /org/freedesktop/systemd1/unit/afldb_2dbackup_2etimer org.freedesktop.systemd1.Timer LastTriggerUSec)"
line "service: $(as_arm systemctl show afldb-backup.service -p InvocationID -p Result -p ExecMainStatus -p ExecMainStartTimestamp -p ExecMainExitTimestamp -p TriggeredBy -p ActivationDetails | tr '\n' ' ')"
line "service UNIT ActivationDetails (busctl): $(as_arm busctl get-property org.freedesktop.systemd1 /org/freedesktop/systemd1/unit/afldb_2dbackup_2eservice org.freedesktop.systemd1.Unit ActivationDetails)"
line "arm's journal for afldb-backup.service (-o cat):"; as_arm journalctl -u afldb-backup.service --no-pager -o cat -q | cut -c1-260 | sed 's/^/   | /'
line "arm's journal entries by _PID: $(as_arm journalctl -u afldb-backup.service -o json --no-pager -q | grep -o '"_PID":"[0-9]*"' | sort | uniq -c | tr -s ' ' | tr '\n' ';')  (PID 1 = \"_PID\":\"1\": $(as_arm journalctl -u afldb-backup.service -o json --no-pager -q | grep -c '"_PID":"1"') entries)"
line "ROOT's journal for afldb-backup.service and the timer (what only PID 1 / root can see):"; journalctl -u afldb-backup.service -u afldb-backup.timer -u postgresql.service -u afldb-backup-failed.service --no-pager -o short-precise -q | cut -c1-240 | sed 's/^/   | /'
line "backup dir: $(ls -1 $BKD | tr '\n' ' ') FAILED markers: $(ls $BKD/.state 2>/dev/null | grep FAILED | tr '\n' ' ')"
if [ "$SC" = astra-exec-r5 ]; then
  ev=$(as_arm journalctl -u afldb-backup.service --no-pager -o cat -q | sed -n 's/^stub-backup: environment TRIGGER_UNIT=\([^ ]*\) TRIGGER_TIMER_REALTIME_USEC=\([0-9]*\) .*/\1 \2/p' | tail -1)
  line "ENVIRONMENT-BASED CHECK (rejected design): the hand-started run's own environment says '$ev'; the timer's LastTriggerUSec is $LT: $([ "$ev" = "afldb-backup.timer $LT" ] && echo 'EQUAL, it would have PASSED this hand-started run' || echo 'different')"
fi

# ------------------------------------------------------------------------------------------------------------------ the gates
run_gate() { # label script: sets GRC and GOUT
  GOUT=$(as_arm bash "$2" "$DAY" 2>&1); GRC=$?
  hdr "$1: exit $GRC"; grep -E '^(PASS afldb-backup\.service scheduled run|FAIL|BACKUP-EVIDENCE|OFFHOST-COMPARE|INFO the 02:2x|G0 PROD RESULT)' <<< "$GOUT" | cut -c1-420 | sed 's/^/   /'
  line "   (OFFHOST-COMPARE lines: $(grep -c '^OFFHOST-COMPARE ' <<< "$GOUT"))"
}
# A-2 section 5 cannot be reached by main on any day but 2026-11-25: its seven shared functions are extracted verbatim from the script and
# run with section 5's own calls and the same window bounds. Sets A2RC (0 = attributed and dump examined) and A2OUT.
cat > /tmp/a2run.sh <<'EOF'
. /tmp/a2fn.sh
if scheduled_backup_run "$B0" "$B1" "$NODE"; then
  echo "A2-FUNCTIONS PASS run attributed: $BR_EVID (timer $BR_TUSEC us)"
  if PICK=$(pick_overnight_dump "$BKD" "$DAYC" "$BR_JOURNAL"); then echo "A2-FUNCTIONS PASS dump $PICK"; echo "OFFHOST-COMPARE $PICK"; else echo "A2-FUNCTIONS FAIL dump: ${PICK#REASON }"; exit 1; fi
else echo "A2-FUNCTIONS FAIL not attributed to the backup timer: $BR_WHY"; echo "INFO the dump is not examined and no OFFHOST-COMPARE line is printed"; exit 1; fi
EOF
chmod 644 /tmp/a2run.sh
run_a2fn() { # label script
  local fn; : > /tmp/a2fn.sh
  for fn in ts timer_usec read_invocation backup_journal match_backup scheduled_backup_run pick_overnight_dump; do sed -n "/^$fn() {/,/^}/p" "$2" >> /tmp/a2fn.sh; done
  chmod 644 /tmp/a2fn.sh
  A2OUT=$(as_arm env B0=$B0 B1=$B1 NODE=$NODE BKD=$BKD DAYC=$DAYC bash /tmp/a2run.sh 2>&1); A2RC=$?
  hdr "$1: exit $A2RC"; sed 's/^/   /' <<< "$A2OUT" | cut -c1-420; line "   (OFFHOST-COMPARE lines: $(grep -c '^OFFHOST-COMPARE ' <<< "$A2OUT"))"
}
run_gate "G0 (corrected, real main)" "$G0"; G0RC=$GRC; G0OUT=$GOUT
run_a2fn "A-2 section 5 functions (corrected)" "$PRE"; A2C=$A2RC; A2COUT=$A2OUT
run_gate "G0 (f92d6e29, real main)" "$FG0"; F9RC=$GRC
run_a2fn "A-2 section 5 functions (f92d6e29)" "$FPRE"; F9A2=$A2RC
hdr "verdict"
bad=0
case $SC in
  genuine-r5|genuine-r5-second-night)
    [ "$G0RC" = 0 ] && grep -q '^OFFHOST-COMPARE ' <<< "$G0OUT" && [ "$A2C" = 0 ] && grep -q '^OFFHOST-COMPARE ' <<< "$A2COUT" \
      && line "VERDICT $SC: corrected G0 exit 0 with OFFHOST-COMPARE, and the A-2 section 5 functions PASS with OFFHOST-COMPARE: as required" \
      || { line "VERDICT $SC: UNEXPECTED (G0 exit $G0RC, A-2 functions exit $A2C)"; bad=1; };;
  *)
    [ "$G0RC" != 0 ] && grep -q 'scheduled origin unproven' <<< "$G0OUT" && ! grep -q '^OFFHOST-COMPARE ' <<< "$G0OUT" \
      && [ "$A2C" != 0 ] && grep -q 'scheduled origin unproven' <<< "$A2COUT" && ! grep -q '^OFFHOST-COMPARE ' <<< "$A2COUT" \
      && line "VERDICT $SC: corrected G0 exit $G0RC and the A-2 functions exit $A2C, both 'scheduled origin unproven', no OFFHOST-COMPARE: as required" \
      || { line "VERDICT $SC: UNEXPECTED (G0 exit $G0RC, A-2 functions exit $A2C)"; bad=1; }
    case $SC in astra-*) [ "$F9RC" = 0 ] && [ "$F9A2" = 0 ] \
      && line "CONTRAST $SC: the f92d6e29 G0 exits 0 and its A-2 functions PASS, each with OFFHOST-COMPARE (the defect, on real systemd)" \
      || { line "CONTRAST $SC: UNEXPECTED f92d6e29 G0 exit $F9RC, A-2 functions exit $F9A2"; bad=1; };; esac;;
esac
exit $bad
