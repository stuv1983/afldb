#!/usr/bin/env bash
# REHEARSAL ONLY (R6 r7, 28 Nov 2026). Runs INSIDE one disposable container whose PID 1 is the REAL systemd 255 (Ubuntu 24.04), started
# by r7b-host.sh on streamanator (--network none, never --privileged). Never production. It installs the sealed backup with the
# bundle's own install-backup.sh from a root-owned staging directory, runs the REAL timer at the fake-zone 02:20 against a REAL
# PostgreSQL 16 database afldb_prod (peer authentication for afldb-backup), the REAL backup.sh (byte-identical), the real run wrapper
# and root sealer, and judges the result with the REAL gate library (sealed-origin.sh, as installed) run by a test user r7reader
# (uid 1500; groups r7reader + afldb-backup-read; neither arm nor root).
# Every input is labelled in the log:
#   [REAL-SYSTEMD] the timer, its dispatch, the start job, the invocation, the unit's state, the seal written by the installed sealer
#   [REAL]         PostgreSQL 16, pg_dump/pg_restore, backup.sh, offhost-pull.sh, scheduled-backup.sh, the install/verify scripts
#   [FIXTURE]      the fixed-offset zone, the timer timing drop-in (RandomizedDelaySec=0, AccuracySec=1s; production: 10min, 1min),
#                  the database contents (5000 rows + a per-run nonce row), the retention dumps planted before the run, the owner's
#                  pg_hba/pg_ident edit (install-backup.sh prints it), the timer stamp of a re-arm, the role made NOLOGIN (pg_dump
#                  failure), and the HOLDS: a root psql session holding ACCESS EXCLUSIVE on table fixture (pg_dump waits: holds the
#                  CREATION stage open) and a root strace that delays the sealer's first chown (holds the SEALING stage open between
#                  the seal and the publication; production has neither)
#   [FIXTURE-ATTACK] arm's actions: the permission suite and the review-2 watcher (arm processes outside the unit)
#   [HARNESS]      this script's own judgement (never an input to the gate)
# Scenarios (argument 1): genuine perm review2 hand-start timer-then-hand restart rearm-in rearm-out pgdump-fails seal-interrupted
# The last line printed is "SCENARIO <name> PASS|FAIL ...".
set -uo pipefail; export LC_ALL=C
SC=${1:?scenario}; FIX=/in/fix; DAY=${R7B_DAY:?}; TD=${R7B_TD:?}; DAYC=${DAY//-/}
R7=docs/v2/evidence/backlog-20261121/r6-20261125/review-fixes-r7-20261128; BUN=$FIX/$R7/backup
OUT=/root/r7b; mkdir -p $OUT/cap; STAGE=/opt/r7b-staging; PROBE=/opt/r7b
CODE=/usr/local/lib/afldb-backup; DR=/var/lib/afldb-backup; STGD=$DR/staging; SEALS=$DR/seals; PUB=$DR/published; STATE=$DR/state
DID=/etc/systemd/system/afldb-backup.service.d; DI=$DID/70-afldb-backup-sealed.conf; TDD=/etc/systemd/system/afldb-backup.timer.d
LIB=$CODE/sealed-origin.sh; DSN='postgresql://afldb_backup@/afldb_prod?host=/var/run/postgresql'
NONCE=r7b-$(od -An -N8 -tx1 /dev/urandom | tr -d ' \n')
BUNDLE=(afldb-backup-run afldb-backup-seal 70-afldb-backup-sealed.conf sealed-origin.sh install-backup.sh verify-backup-install.sh SHA256SUMS)
L() { printf '[%s] %s\n' "$1" "${*:2}"; }
hdr() { printf '\n== %s\n' "$*"; }
FAILS=()
hfail() { FAILS+=("$*"); printf '[HARNESS] FAIL %s\n' "$*"; }
hok() { printf '[HARNESS] ok %s\n' "$*"; }
as_arm() { setpriv --reuid=1000 --regid=1000 --init-groups env -i HOME=/home/arm USER=arm LOGNAME=arm PATH=/usr/bin:/bin LANG=C.UTF-8 "$@"; }
as_reader() { setpriv --reuid=1500 --regid=1500 --init-groups env -i HOME=/nonexistent PATH=/usr/bin "$@"; }
pg() { setpriv --reuid=postgres --regid=postgres --init-groups env -i PATH=/usr/bin HOME=/var/lib/postgresql psql -X -q -v ON_ERROR_STOP=1 -At "$@"; }
sha() { sha256sum < "$1" | cut -c1-64; }
mel() { TZ=Australia/Melbourne date -d "@$1" '+%F %T %Z'; }
svc() { systemctl show afldb-backup.service -p "$1" --value; }
wait_systemd() { local i; for i in $(seq 1 120); do case $(systemctl is-system-running 2>/dev/null) in running|degraded) return 0;; esac; sleep 1; done; return 1; }
wait_idle() { # seconds: the unit has no job and is inactive or failed
  local i; for i in $(seq 1 "$1"); do [ -z "$(svc Job)" ] && [[ $(svc ActiveState) =~ ^(inactive|failed)$ ]] && return 0; sleep 1; done; return 1; }
wait_until() { while [ "$(date +%s)" -lt "$1" ]; do sleep 0.2; done; }
lock_on() { (PGAPPNAME=r7b-lock setpriv --reuid=postgres --regid=postgres --init-groups env -i PATH=/usr/bin HOME=/var/lib/postgresql PGAPPNAME=r7b-lock \
    psql -X -q -d afldb_prod -c 'BEGIN' -c 'LOCK TABLE fixture IN ACCESS EXCLUSIVE MODE' -c 'SELECT pg_sleep(900)' > /dev/null 2>&1 &)
  local i; for i in $(seq 1 50); do [ "$(pg -d afldb_prod -c "SELECT count(*) FROM pg_locks l JOIN pg_stat_activity a USING (pid) WHERE a.application_name='r7b-lock' AND l.mode='AccessExclusiveLock' AND l.granted")" -ge 1 ] && return 0; sleep 0.2; done; return 1; }
lock_off() { pg -c "SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE application_name='r7b-lock'" > /dev/null; }
dump_waiting() { # seconds count: at least <count> pg_dump backends wait on the fixture lock (a killed run's backend lingers until then)
  local i; for i in $(seq 1 $(( $1 * 5 ))); do [ "$(pg -c "SELECT count(*) FROM pg_stat_activity WHERE application_name='pg_dump' AND wait_event_type='Lock'")" -ge "$2" ] && return 0; sleep 0.2; done; return 1; }

# ------------------------------------------------------------------------------------------------------------------ scenario table
EXPECT=refused; KIND=scheduled; TIMER=early; LOCK=0; HOLD=0; RET=0; REFUSAL=; ARMSUITE=0
case $SC in
  genuine)          EXPECT=attributed; RET=1;;
  perm)             EXPECT=attributed; LOCK=1; HOLD=1; ARMSUITE=1;;
  review2)          EXPECT=attributed;;
  hand-start)       TIMER=never; REFUSAL='0 seals .* a start by hand never counts';;
  timer-then-hand)  REFUSAL='another run of afldb-backup.service was sealed in the window';;
  restart)          LOCK=1; REFUSAL='entered inactive .* after the dispatch';;
  rearm-in)         EXPECT=attributed; KIND=catch-up; TIMER=at-td;;
  rearm-out)        TIMER=at-td; REFUSAL='0 seals .* in the .* 02:20-02:31 window';;
  pgdump-fails)     REFUSAL='0 seals .* in the .* 02:20-02:31 window';;
  seal-interrupted) LOCK=1; HOLD=1; REFUSAL='published dump: .* missing';;
  *) echo "SCENARIO $SC FAIL unknown scenario"; exit 2;;
esac

wait_systemd || { echo "SCENARIO $SC FAIL systemd did not come up"; exit 1; }
hdr "environment"
L REAL-SYSTEMD "systemd: $(systemctl --version | head -1); kernel $(uname -r); $(. /etc/os-release; echo "$PRETTY_NAME"); PID 1: $(cat /proc/1/comm)"
L FIXTURE "zone: $(readlink -f /etc/localtime) fixed offset ($(stat -c '%U:%G %a %F' /usr/share/zoneinfo/Australia/Melbourne)); now UTC $(date -u +%FT%T), local $(TZ=Australia/Melbourne date '+%F %T %Z'); planned moment real $(date -u -d @$TD +%T)Z = local $(mel $TD)"
L HARNESS "scenario $SC: expect=$EXPECT kind=$KIND timer=$TIMER lock-hold=$LOCK seal-hold=$HOLD retention-fixture=$RET arm-suite=$ARMSUITE refusal='$REFUSAL'"
echo "fs.protected_hardlinks=$(cat /proc/sys/fs/protected_hardlinks) fs.protected_symlinks=$(cat /proc/sys/fs/protected_symlinks) kernel.yama.ptrace_scope=$(cat /proc/sys/kernel/yama/ptrace_scope 2>&1)"
userdel -r ubuntu > /dev/null 2>&1
useradd -M -u 1000 -d /home/arm -s /bin/bash arm && useradd -M -u 1500 -d /nonexistent -s /usr/sbin/nologin r7reader || { echo "SCENARIO $SC FAIL useradd"; exit 1; }
install -d -o arm -g arm -m 755 /home/arm /home/arm/backups /home/arm/backups/afldb-scheduled
install -d -o arm -g arm -m 700 /home/arm/backups/afldb-scheduled/.state
printf 'arm-chosen bytes, not tonight'"'"'s pg_dump\n' > /home/arm/evil.dump; chown arm:arm /home/arm/evil.dump

hdr "PostgreSQL 16 fixture database afldb_prod [REAL server, FIXTURE contents]"
systemctl start postgresql@16-main || { echo "SCENARIO $SC FAIL postgresql did not start"; exit 1; }
pg -c "CREATE ROLE afldb_backup LOGIN" -c "CREATE DATABASE afldb_prod" && pg -d afldb_prod -c "CREATE TABLE fixture (id int PRIMARY KEY, payload text)" \
  -c "INSERT INTO fixture SELECT g, md5(g::text) FROM generate_series(1, 5000) g" -c "CREATE TABLE marker (nonce text)" \
  -c "INSERT INTO marker VALUES ('$NONCE')" -c "GRANT pg_read_all_data TO afldb_backup" || { echo "SCENARIO $SC FAIL fixture database"; exit 1; }
L FIXTURE "afldb_prod: fixture 5000 rows, marker nonce $NONCE; role afldb_backup LOGIN + pg_read_all_data (production: the existing read-only role); $(pg -c 'SELECT version()' | cut -c1-60)"

hdr "units [REAL deploy/ files] and the timer timing drop-in [FIXTURE]"
for u in afldb-backup.service afldb-backup.timer afldb-backup-failed.service; do install -o root -g root -m 0644 "$FIX/deploy/$u" /etc/systemd/system/$u; done
install -d -o root -g root -m 0755 $TDD
printf '[Timer]\nRandomizedDelaySec=0\nAccuracySec=1s\n' > $TDD/50-r7b-fixture-timing.conf; chmod 644 $TDD/50-r7b-fixture-timing.conf
systemctl daemon-reload
echo "service $(sha /etc/systemd/system/afldb-backup.service) timer $(sha /etc/systemd/system/afldb-backup.timer) failed $(sha /etc/systemd/system/afldb-backup-failed.service)"

hdr "owner install from a root-owned staging directory [REAL install-backup.sh]"
install -d -o root -g root -m 0755 $STAGE
for f in "${BUNDLE[@]}"; do install -o root -g root -m 0644 "$BUN/$f" $STAGE/$f; done
install -o root -g root -m 0644 "$FIX/tools/maintenance/backup.sh" $STAGE/backup.sh
echo "staging $STAGE: $(cd $STAGE && ls -l | awk 'NR > 1 { printf "%s %s:%s %s; ", $1, $3, $4, $9 }')"
echo "SHA256SUMS $(sha $STAGE/SHA256SUMS); check: $(cd $STAGE && sha256sum -c SHA256SUMS 2>&1 | tr '\n' ' ')"
if [ "$SC" = genuine ]; then
  refuse_case() { # label dir
    local o rc; o=$(cd / && bash "$2/install-backup.sh" "$2" 2>&1); rc=$?
    echo "   install-backup.sh from $2 ($1): exit $rc: $(printf '%s\n' "$o" | grep -m1 'INSTALL REFUSED' | cut -c1-220)"
    [ "$rc" = 1 ] && [[ $o == *"INSTALL REFUSED"* ]] && [ ! -e $DI ] && ! id afldb-backup > /dev/null 2>&1 && hok "install refused ($1), nothing installed" || hfail "install from $2 ($1) was not refused cleanly"
  }
  install -d -o root -g root -m 0755 /home/r7b-stage; cp -p $STAGE/* /home/r7b-stage/; refuse_case "staging under /home" /home/r7b-stage
  install -d -o root -g root -m 0775 /opt/r7b-gw; cp -p $STAGE/* /opt/r7b-gw/; refuse_case "group-writable staging" /opt/r7b-gw
  install -d -o root -g root -m 0755 /opt/r7b-tamper; cp -p $STAGE/* /opt/r7b-tamper/; echo '# tampered' >> /opt/r7b-tamper/afldb-backup-seal
  refuse_case "a bundle file not matching SHA256SUMS" /opt/r7b-tamper
  rm -rf /home/r7b-stage /opt/r7b-gw /opt/r7b-tamper
fi
(cd / && bash $STAGE/install-backup.sh $STAGE) > $OUT/install.out 2>&1; IRC=$?
echo "install-backup.sh $STAGE (root): exit $IRC"; sed 's/^/   | /' $OUT/install.out
[ "$IRC" = 0 ] || { hfail "install-backup.sh exited $IRC"; echo "SCENARIO $SC FAIL install failed"; exit 1; }
(cd / && bash $STAGE/verify-backup-install.sh) > $OUT/verify-pre.out 2>&1
echo "verify-backup-install.sh as root BEFORE the owner's PostgreSQL step: exit $? (expected FAIL: pg_hba/pg_ident lines absent)"; grep '^FAIL\|RESULT' $OUT/verify-pre.out | sed 's/^/   | /'
H=/etc/postgresql/16/main/pg_hba.conf; I=/etc/postgresql/16/main/pg_ident.conf
{ echo 'local afldb_prod afldb_backup peer map=afldbbackup'; cat $H; } > $H.r7b && cat $H.r7b > $H && rm -f $H.r7b
echo 'afldbbackup afldb-backup afldb_backup' >> $I
pg -c 'SELECT pg_reload_conf()' > /dev/null
L FIXTURE "owner step 1 applied as printed: pg_hba first line '$(grep -m1 -v '^#' $H)', pg_ident '$(grep afldbbackup $I)', pg_reload_conf()"
(cd / && bash $STAGE/verify-backup-install.sh) > $OUT/verify-root.out 2>&1; VRR=$?
(cd /home/arm && as_arm bash $STAGE/verify-backup-install.sh) > $OUT/verify-arm.out 2>&1; VRA=$?
echo "verify-backup-install.sh as root: exit $VRR"; sed 's/^/   | /' $OUT/verify-root.out
echo "verify-backup-install.sh as arm (new login, env -i): exit $VRA"; sed 's/^/   | /' $OUT/verify-arm.out
usermod -a -G afldb-backup-read r7reader
[ "$VRR" = 0 ] && [ "$VRA" = 0 ] && hok "verify-backup-install.sh PASS as root and as arm" || hfail "verify-backup-install.sh root $VRR arm $VRA"

hdr "effective unit and installed paths (REAL-SYSTEMD, as root)"
systemctl show afldb-backup.service -p User -p Group -p SupplementaryGroups -p FragmentPath -p DropInPaths -p EnvironmentFiles -p ExecStartEx -p ExecStartPostEx \
  -p ProtectHome -p ProtectSystem -p ReadWritePaths -p NoNewPrivileges -p PrivateTmp -p UMask -p WorkingDirectory -p Environment -p OnFailure | cut -c1-300 | sed 's/^/   service: /'
systemctl show afldb-backup.timer -p FragmentPath -p DropInPaths -p Persistent -p TimersCalendar -p RandomizedDelayUSec | cut -c1-300 | sed 's/^/   timer: /'
for p in $CODE $CODE/* $CODE/tools/maintenance/backup.sh $DI $DR $DR/*; do echo "   $(stat -c '%A %U:%G links=%h %F' "$p") $p"; done
echo "   arm: $(id arm); afldb-backup: $(id afldb-backup); r7reader: $(id r7reader)"

if [ "$RET" = 1 ]; then
  hdr "retention fixture: 15 older genuine archives planted in published/ [FIXTURE]"
  for i in $(seq 15 -1 1); do
    n=afldb_prod-$(date -d "$DAY -$i day" +%Y%m%d)-022000.dump
    setpriv --reuid=postgres --regid=postgres --init-groups env -i PATH=/usr/bin HOME=/var/lib/postgresql pg_dump -Fc -d afldb_prod -f /tmp/$n \
      && install -o root -g afldb-backup-read -m 0440 /tmp/$n $PUB/$n && printf '%s  %s\n' "$(sha /tmp/$n)" "$n" > /tmp/$n.sha256 \
      && install -o root -g afldb-backup-read -m 0440 /tmp/$n.sha256 $PUB/$n.sha256 && rm -f /tmp/$n /tmp/$n.sha256 || hfail "retention fixture $n"
  done
  echo "published: $(ls $PUB | grep -c '\.dump$') dumps, oldest $(ls $PUB | grep '\.dump$' | head -1)"
fi

# ------------------------------------------------------------------------------------------------------------------ the arm probe
cat > $PROBE.armprobe.sh <<'EOF'
#!/bin/bash
# [FIXTURE-ATTACK] arm's permission suite: each line of $2 is "<label>\t<target>\t<shell command>"; every command must FAIL.
stage=$1; n=0; allowed=0
errno() { case $1 in *"Permission denied"*) echo EACCES;; *"Operation not permitted"*) echo EPERM;; *"No such file"*) echo ENOENT;;
  *"Read-only file system"*) echo EROFS;; *"Access denied"*|*"Interactive authentication required"*) echo DBUS-ACCESS-DENIED;;
  *"authentication failed"*) echo PG-AUTH-FAILED;; *) echo OTHER;; esac; }
echo "ARMPROBE stage=$stage id: $(id); $(grep '^Groups' /proc/self/status); cgroup $(cat /proc/self/cgroup)"
while IFS=$'\t' read -r label target cmd; do
  [ -n "$label" ] || continue
  n=$((n + 1)); err=$(bash -c "$cmd" 2>&1 > /dev/null); rc=$?
  if [ "$rc" = 0 ]; then res=ALLOWED; allowed=$((allowed + 1)); else res=REFUSED; fi
  err=${err//$'\n'/ | }
  echo "ATTEMPT $stage $label rc=$rc result=$res errno=$(errno "$err") err=${err:0:200}"
  echo "   cmd: $cmd"
  p=$target; while :; do echo "   $(stat -c '%A %U:%G links=%h %F' -- "$p" 2>&1) $p"; [ "$p" = / ] && break; p=$(dirname "$p"); done
done < "$2"
echo "ARMPROBE-SUMMARY stage=$stage attempts=$n allowed=$allowed"
EOF
chmod 755 $PROBE.armprobe.sh
arm_suite() { # stage: build the attempt list from what exists now, run it as arm, judge it
  local st=$1 list=$OUT/probe-$1.list inv f p n=0; inv=$(svc InvocationID)
  : > $list
  add() { printf '%s\t%s\t%s\n' "$1" "$2" "$3" >> $list; }
  add read-staging-dir $STGD "ls -A $STGD"
  for f in $STGD/*; do [ -e "$f" ] || continue
    add read-staging-file "$f" "cat $f"; add replace-staging-file "$f" "mv -f /home/arm/evil.dump $f"; add unlink-staging-file "$f" "rm -f $f"; done
  add create-in-staging $STGD/x "touch $STGD/afldb_prod-${DAYC}-022001.dump"
  add chmod-staging $STGD "chmod 777 $STGD"
  for d in $DR $SEALS $PUB $STATE $CODE $CODE/tools/maintenance $DID /etc/systemd/system; do
    add create-in-$(basename $d) $d "touch $d/r7b-arm-file"; add link-into-$(basename $d) $d "ln /home/arm/evil.dump $d/r7b-arm-link"; done
  for f in $SEALS/*.seal $PUB/.*.tmp $PUB/afldb_prod-*.dump $PUB/afldb_prod-*.dump.sha256 $STATE/last-backup.json $CODE/afldb-backup-run $CODE/afldb-backup-seal \
      $CODE/tools/maintenance/backup.sh $CODE/sealed-origin.sh $DI /etc/systemd/system/afldb-backup.service /etc/systemd/system/afldb-backup.timer; do
    [ -e "$f" ] || continue; n=$((n + 1))
    if [ $n -gt 40 ]; then continue; fi
    add "write $(basename $f)" "$f" "echo x >> $f"; add "replace $(basename $f)" "$f" "mv -f /home/arm/evil.dump $f"
    add "overwrite $(basename $f)" "$f" "cp /home/arm/evil.dump $f"; add "unlink $(basename $f)" "$f" "rm -f $f"
    add "chmod $(basename $f)" "$f" "chmod 666 $f"; add "hardlink $(basename $f)" "$f" "ln $f /home/arm/r7b-hl-$n"
    add "rename-within $(basename $f)" "$f" "mv $f $f.r7b"
  done
  for f in $PUB/.*.tmp; do [ -e "$f" ] && add "read root-only temporary $(basename $f)" "$f" "cat $f > /dev/null"; done
  for p in $(pgrep -u afldb-backup) $(pgrep -f '^/usr/bin/bash --noprofile --norc /usr/local/lib/afldb-backup/afldb-backup-seal$'); do
    add "SIGSTOP pid $p ($(tr '\0' ' ' < /proc/$p/cmdline 2>/dev/null | cut -c1-60), uid $(stat -c %u /proc/$p))" /proc/$p "kill -STOP $p"; done
  add "systemctl kill SIGSTOP" /etc/systemd/system "systemctl kill --signal=SIGSTOP afldb-backup.service"
  add "systemctl set-property" /etc/systemd/system "systemctl set-property afldb-backup.service ReadWritePaths=/home/arm"
  add "systemctl daemon-reload" /etc/systemd/system "systemctl daemon-reload"
  add "peer login as afldb_backup" /var/run/postgresql "psql -X -At '$DSN' -c 'SELECT current_user'"
  L FIXTURE-ATTACK "arm permission suite at stage $st (invocation ${inv:-none}, unit $(svc ActiveState)/$(svc SubState)): $(wc -l < $list) attempts"
  (cd /home/arm && as_arm bash $PROBE.armprobe.sh "$st" /dev/stdin < $list) > $OUT/probe-$st.out 2>&1
  sed 's/^/   /' $OUT/probe-$st.out
  grep -q "^ARMPROBE-SUMMARY stage=$st attempts=[1-9][0-9]* allowed=0$" $OUT/probe-$st.out && hok "arm suite $st: $(grep -c '^ATTEMPT' $OUT/probe-$st.out) attempts, all refused" \
    || hfail "arm suite $st: $(grep '^ATTEMPT.*result=ALLOWED' $OUT/probe-$st.out | cut -c1-200 | tr '\n' ';') $(grep '^ARMPROBE-SUMMARY' $OUT/probe-$st.out)"
  [ "$st" = published ] || grep -q "^ATTEMPT $st SIGSTOP" $OUT/probe-$st.out && ! grep "^ATTEMPT $st SIGSTOP" $OUT/probe-$st.out | grep -qv 'errno=EPERM' \
    && hok "arm suite $st: every SIGSTOP refused with EPERM" || hfail "arm suite $st: a SIGSTOP attempt was missing or not EPERM"
}

# ------------------------------------------------------------------------------------------------------------------ before the dispatch
B0=$(TZ=Australia/Melbourne date -d "$DAY 02:20" +%s); B1=$(TZ=Australia/Melbourne date -d "$DAY 02:31" +%s)
[ "$SC" = pgdump-fails ] && { pg -c "ALTER ROLE afldb_backup NOLOGIN"; L FIXTURE "role afldb_backup made NOLOGIN: pg_dump will fail to connect"; }
if [ "$SC" = rearm-in ] || [ "$SC" = rearm-out ]; then
  mkdir -p /var/lib/systemd/timers; touch -d "$(date -d "$DAY -1 day" +%F) 02:20:03" /var/lib/systemd/timers/stamp-afldb-backup.timer
  L FIXTURE "timer stamp set to the previous night's dispatch: $(stat -c %y /var/lib/systemd/timers/stamp-afldb-backup.timer); the timer is NOT started before the 02:20 elapse"
fi
[ "$TIMER" = early ] && { systemctl start afldb-backup.timer; L REAL-SYSTEMD "timer started at $(TZ=Australia/Melbourne date '+%T'): next elapse $(systemctl show afldb-backup.timer -p NextElapseUSecRealtime --value)"; }
[ "$TIMER" = never ] && L HARNESS "the timer is never started in this scenario"
[ "$LOCK" = 1 ] && { lock_on && L FIXTURE "HOLD: root psql session r7b-lock holds ACCESS EXCLUSIVE on afldb_prod.fixture (pg_dump will wait)" || hfail "could not take the fixture lock"; }
if [ "$SC" = review2 ]; then
  cat > $PROBE.watcher.sh <<'EOF'
#!/bin/bash
# [FIXTURE-ATTACK] review round 2 (MED-3) re-run: an arm process OUTSIDE afldb-backup.service. For every process of the run it
# tries SIGSTOP (the r6 attack froze the arm-owned workload, renamed other bytes over the dump, then SIGCONT); it tries to put
# arm-chosen bytes where the dump is (staging) and, once published, over the published dump and its sidecar.
P=/var/lib/afldb-backup/published; S=/var/lib/afldb-backup/staging; seen=; done=0; end=$((SECONDS + 300))
t() { date +%T.%N | cut -c1-12; }
try() { local e rc; e=$(bash -c "$1" 2>&1 > /dev/null); rc=$?; echo "$(t) $([ $rc = 0 ] && echo ALLOWED || echo REFUSED) rc=$rc: $1 :: ${e//$'\n'/ | }"; }
echo "$(t) watcher $(id) pid $$ cgroup $(cat /proc/self/cgroup)"
before=$(ls $P 2>&1 | tr '\n' ' '); echo "$(t) published before: ${before:-empty}"
while [ $SECONDS -lt $end ] && [ $done = 0 ]; do
  for p in $(pgrep -u afldb-backup) $(pgrep -f '^/usr/bin/bash --noprofile --norc /usr/local/lib/afldb-backup/afldb-backup-seal$'); do
    case " $seen " in *" $p "*) continue;; esac; seen="$seen $p"
    echo "$(t) run process $p uid $(stat -c %u /proc/$p 2>&1): $(tr '\0' ' ' < /proc/$p/cmdline 2>/dev/null | cut -c1-120)"
    try "kill -STOP $p"
    try "mv -f /home/arm/evil.dump $S/afldb_prod-$(date +%Y%m%d-%H%M%S).dump"
    try "ls -A $S"
    try "kill -CONT $p"
  done
  for f in $P/afldb_prod-*.dump; do
    [ -e "$f" ] || continue; case " $before " in *" ${f##*/} "*) continue;; esac
    echo "$(t) published: ${f##*/} $(stat -c '%U:%G %a links=%h' $f)"
    try "mv -f /home/arm/evil.dump $f"; try "cp /home/arm/evil.dump $f"; try "echo x >> $f"; try "rm -f $f"; try "chmod 666 $f"
    try "ln -f /home/arm/evil.dump $f"; try "mv -f /home/arm/evil.dump $f.sha256"; try "cp /home/arm/evil.dump $f.sha256"
    done=1
  done
  sleep 0.005
done
echo "$(t) watcher end (published seen: $done; run processes seen:$seen)"
EOF
  chmod 755 $PROBE.watcher.sh
  (cd /home/arm && as_arm setsid bash $PROBE.watcher.sh > $OUT/watcher.log 2>&1 &)
  L FIXTURE-ATTACK "review-2 watcher started as arm OUTSIDE the unit (setsid), before the dispatch"
fi
if [ "$SC" = genuine ]; then   # root captures the staging dump the moment backup.sh renames it (the expected full digest)
  ( shopt -s nullglob; end=$((SECONDS + 240)); while [ $SECONDS -lt $end ] && [ ! -e $OUT/cap-stop ]; do
      for f in $STGD/afldb_prod-*.dump; do [ -e $OUT/cap/${f##*/} ] || cp --no-preserve=all "$f" $OUT/cap/ 2>/dev/null; done; sleep 0.003; done ) &
fi
[ "$(date +%s)" -le $((TD - 5)) ] || { echo "SCENARIO $SC FAIL setup overran the planned moment by $(( $(date +%s) - TD + 5 )) s"; exit 1; }
L HARNESS "setup done $((TD - $(date +%s))) s before the planned moment; window $(mel $B0) .. $(TZ=Australia/Melbourne date -d @$B1 +%T)"

# ------------------------------------------------------------------------------------------------------------------ the run
wait_until "$TD"
case $TIMER in
  at-td) systemctl start afldb-backup.timer; L REAL-SYSTEMD "root (attended re-arm) started afldb-backup.timer at $(TZ=Australia/Melbourne date '+%T.%N' | cut -c1-12)";;
  never) systemctl start --no-block afldb-backup.service; L REAL-SYSTEMD "root started afldb-backup.service BY HAND at $(TZ=Australia/Melbourne date '+%T.%N' | cut -c1-12)";;
esac
for i in $(seq 1 30); do [ -n "$(svc InvocationID)" ] && break; sleep 0.5; done
INV1=$(svc InvocationID); L REAL-SYSTEMD "invocation $INV1 job $(svc Job) state $(svc ActiveState)/$(svc SubState)"
if [ "$LOCK" = 1 ]; then
  dump_waiting 60 1 && L FIXTURE "HOLD engaged: pg_dump of invocation $INV1 is waiting on the fixture lock (CREATION stage held open)" || hfail "pg_dump never waited on the lock"
  echo "staging now (root): $(ls -la --time-style=+%T $STGD | tail -n +2 | tr '\n' ';')"
  [ "$ARMSUITE" = 1 ] && arm_suite creation
  if [ "$SC" = restart ]; then
    W1=$(pg -c "SELECT string_agg(pid::text, ' ') FROM pg_stat_activity WHERE application_name='pg_dump'")
    systemctl restart --no-block afldb-backup.service; L REAL-SYSTEMD "root ran systemctl restart afldb-backup.service during the timer's run"
    for i in $(seq 1 60); do [ "$(svc InvocationID)" != "$INV1" ] && break; sleep 0.5; done
    for i in $(seq 1 300); do w=$(pg -c "SELECT count(*) FROM pg_stat_activity WHERE application_name='pg_dump' AND wait_event_type='Lock' AND pid::text <> ALL (string_to_array('$W1', ' '))"); [ "$w" -ge 1 ] && break; sleep 0.2; done
    [ "$w" -ge 1 ] && L REAL-SYSTEMD "invocation #2 $(svc InvocationID) (job $(svc Job)) is running; its pg_dump waits on the lock" || hfail "invocation #2 not seen waiting"
  fi
  if [ "$HOLD" = 1 ]; then
    ( shopt -s nullglob; end=$((SECONDS + 120)); while [ $SECONDS -lt $end ]; do
        p=$(pgrep -n -f '^/usr/bin/bash --noprofile --norc /usr/local/lib/afldb-backup/afldb-backup-seal$')
        if [ -n "$p" ]; then echo "$p" > $OUT/sealer.pid
          exec strace -f -qq -tt -p "$p" -e trace=chown,fchown,lchown,fchownat -e inject=chown,fchown,lchown,fchownat:delay_enter=25000000 -o $OUT/strace.log; fi
        sleep 0.002; done ) &
    CATCH=$!
    L FIXTURE "HOLD armed: root strace will attach to the sealer and delay its first chown by 25 s (SEALING stage held open)"
  fi
  lock_off; L FIXTURE "fixture lock released at $(TZ=Australia/Melbourne date '+%T')"
  if [ "$HOLD" = 1 ]; then
    INV=$(svc InvocationID); held=0
    for i in $(seq 1 100); do [ -e $SEALS/$INV.seal ] && [ -e $PUB/.$INV.tmp ] && { held=1; break; }; sleep 0.2; done
    if [ "$held" = 1 ]; then
      L FIXTURE "HOLD engaged: sealer pid $(cat $OUT/sealer.pid 2>/dev/null) delayed at its first chown; seal written, root copy unpublished; unit $(svc ActiveState)/$(svc SubState)"
      echo "   seals: $(ls -l $SEALS | tail -n +2 | tr '\n' ';')"; echo "   published temporaries: $(ls -la $PUB | grep ' \.' | grep tmp | tr '\n' ';')"
      echo "   staging: $(ls -la $STGD | tail -n +2 | tr '\n' ';')"
      EXPSHA=$(sha $STGD/$(cd $STGD && ls afldb_prod-*.dump | head -1)); L HARNESS "root hash of the run's staging dump during the hold: $EXPSHA"
      [ "$ARMSUITE" = 1 ] && arm_suite sealing
      if [ "$SC" = seal-interrupted ]; then
        sp=$(cat $OUT/sealer.pid); kids=$(pgrep -P "$sp" | tr '\n' ' ')
        kill -9 $kids "$sp"; L FIXTURE "INTERRUPT: SIGKILL to the sealer pid $sp and its child(ren) $kids between the seal and the publication"
      fi
    else hfail "the sealing hold was not observed (seal $([ -e $SEALS/$INV.seal ] && echo present || echo absent), temporary $([ -e $PUB/.$INV.tmp ] && echo present || echo absent))"; fi
    kill "$CATCH" 2> /dev/null; wait "$CATCH" 2> /dev/null; echo "strace (root, FIXTURE) log, chown lines:"; grep chown $OUT/strace.log 2>/dev/null | cut -c1-200 | sed 's/^/   | /'
    grep -q 'chown' $OUT/strace.log 2>/dev/null && hok "strace recorded the sealer's delayed chown (the sealing stage was really held): $(grep -m1 chown $OUT/strace.log | cut -c1-160)" || hfail "strace shows no chown of the sealer: the sealing hold did not engage"
  fi
fi
wait_idle 180 || hfail "the unit did not finish within 180 s"
if [ "$SC" = timer-then-hand ]; then
  sleep 5; systemctl start afldb-backup.service; L REAL-SYSTEMD "root started afldb-backup.service BY HAND after the timer's run, at $(TZ=Australia/Melbourne date '+%T'): exit $?"
  wait_idle 120 || hfail "the hand start did not finish"
fi
touch $OUT/cap-stop
[ "$ARMSUITE" = 1 ] && arm_suite published

# ------------------------------------------------------------------------------------------------------------------ facts after the run
hdr "after the run (REAL-SYSTEMD, root)"
echo "timer: $(systemctl show afldb-backup.timer -p LastTriggerUSec -p LastTriggerUSecMonotonic -p ActiveEnterTimestampMonotonic -p Result | tr '\n' ' ') busctl LastTriggerUSec=$(busctl get-property org.freedesktop.systemd1 /org/freedesktop/systemd1/unit/afldb_2dbackup_2etimer org.freedesktop.systemd1.Timer LastTriggerUSec)"
echo "service: $(systemctl show afldb-backup.service -p Result -p InvocationID -p NRestarts -p ExecMainCode -p ExecMainStatus -p ActiveState -p SubState | tr '\n' ' ')"
echo "failed unit: $(systemctl show afldb-backup-failed.service -p Result -p ExecMainStartTimestamp | tr '\n' ' '); marker: $(cat /home/arm/backups/afldb-scheduled/.state/FAILED-unit 2>&1)"
echo "journal (root) of afldb-backup.service:"; journalctl -u afldb-backup.service -o short-precise --no-pager 2>&1 | tail -40 | cut -c1-260 | sed 's/^/   | /'
echo "seals:"; for s in $SEALS/*.seal; do [ -e "$s" ] || continue; echo "   $(stat -c '%A %U:%G links=%h size=%s' $s) $s"; sed 's/^/      /' "$s"; done
echo "published: $(ls -la $PUB | tail -n +2 | awk '{ print $1, $3":"$4, $9 }' | tr '\n' ';')"
echo "state: $(ls -la $STATE | tail -n +2 | awk '{ print $1, $3":"$4, $9 }' | tr '\n' ';') last-backup.json: $(cat $STATE/last-backup.json 2>&1)"
echo "staging (root): $(ls -la $STGD | tail -n +2 | awk '{ print $1, $3":"$4, $9 }' | tr '\n' ';')"

# ------------------------------------------------------------------------------------------------------------------ the gate rule
hdr "sealed_origin $DAY, run by r7reader (not arm, not root; groups $(id -Gn r7reader | tr ' ' ',')) from the INSTALLED library [REAL]"
cat > $PROBE.so.sh <<'EOF'
. /usr/local/lib/afldb-backup/sealed-origin.sh
sealed_origin "$1" > /tmp/r7b-so.out; rc=$?
while IFS= read -r l; do printf 'SODIAG %s\n' "$l"; done < /tmp/r7b-so.out
printf 'SO rc=%s\n' "$rc"
for v in SO_REASON SO_INVOCATION SO_DUMP SO_SHA SO_BYTES SO_DISPATCH_KIND SO_DISPATCH_DELAY_S SO_TIMER_USEC SO_SEAL; do printf 'SO %s=%s\n' "$v" "${!v}"; done
EOF
(cd / && as_reader /usr/bin/bash --noprofile --norc $PROBE.so.sh "$DAY") > $OUT/so.out 2>&1
sed 's/^/   /' $OUT/so.out
sov() { sed -n "s/^SO $1=//p" $OUT/so.out | head -1; }
SORC=$(sed -n 's/^SO rc=//p' $OUT/so.out); SOR=$(sov SO_REASON)
grep '^SODIAG' $OUT/so.out | grep -qv '^SODIAG   sealed-origin: ' && hfail "sealed_origin printed a stdout line without the '  sealed-origin: ' prefix"
grep -v '^SODIAG \|^SO ' $OUT/so.out | grep -q . && hfail "sealed_origin produced stray output: $(grep -v '^SODIAG \|^SO ' $OUT/so.out | head -3 | tr '\n' ';')"
if [ "$SC" = review2 ]; then echo "review-2 watcher log (arm, outside the unit):"; sed 's/^/   | /' $OUT/watcher.log; fi

# ------------------------------------------------------------------------------------------------------------------ judgement
hdr "verdict [HARNESS]"
INV=$(svc InvocationID); RES=$(svc Result)
[ -n "$INV" ] || { INV=$INV1; L REAL-SYSTEMD "the unit was garbage-collected after the run (no timer references it): using the invocation seen during the run, $INV1"; }
if [ "$EXPECT" = attributed ]; then
  if [ "$SORC" = 0 ]; then
    D=$(sov SO_DUMP); S=$(sov SO_SHA)
    [ "$(sov SO_INVOCATION)" = "$INV" ] && hok "invocation $INV (the service's last, root view)" || hfail "SO_INVOCATION $(sov SO_INVOCATION) != the service's $INV"
    [ "$(sov SO_DISPATCH_KIND)" = "$KIND" ] && hok "dispatch=$KIND, $(sov SO_DISPATCH_DELAY_S) s after timer activation" || hfail "dispatch kind $(sov SO_DISPATCH_KIND), expected $KIND"
    [ "$(sha $PUB/$D)" = "$S" ] && hok "root re-hash of $PUB/$D = SO_SHA" || hfail "root re-hash of $PUB/$D differs from SO_SHA"
    jl=$(journalctl -o cat --no-pager _SYSTEMD_INVOCATION_ID="$INV" | grep '^backup ok: ' | tail -1)
    [ "$jl" = "backup ok: $D $(sov SO_BYTES) bytes sha256 ${S:0:16} offhost=skipped" ] && hok "the run's own 'backup ok' line (root journal) names $D and ${S:0:16}" || hfail "the run's line '$jl' does not match $D ${S:0:16}"
    [[ $D =~ ^afldb_prod-${DAYC}-02[23][0-9]{3}\.dump$ ]] && hok "dump name $D is tonight's" || hfail "dump name $D is not afldb_prod-${DAYC}-02[23]xxx.dump"
    n=$(as_arm pg_restore -a -t marker -f - $PUB/$D 2>/dev/null | grep -c "$NONCE")
    [ "$n" = 1 ] && hok "the published dump holds tonight's nonce $NONCE (read by arm through afldb-backup-read)" || hfail "nonce $NONCE not found in $PUB/$D"
    if [ "$SC" = genuine ]; then
      c=$(ls $OUT/cap 2>/dev/null | head -1)
      [ "$c" = "$D" ] && [ "$(sha $OUT/cap/$c)" = "$S" ] && hok "full digest: SO_SHA = root's capture of the staging dump the moment backup.sh renamed it ($S)" \
        || hfail "root capture '$c' $( [ -n "$c" ] && sha $OUT/cap/$c) does not equal $D $S"
      k=$(ls $PUB | grep -c '\.dump$'); ks=$(ls $PUB | grep -c '\.dump\.sha256$'); first=$(date -d "$DAY -13 day" +%Y%m%d)
      [ "$k" = 14 ] && [ "$ks" = 14 ] && [ ! -e $PUB/afldb_prod-$(date -d "$DAY -15 day" +%Y%m%d)-022000.dump ] && [ ! -e $PUB/afldb_prod-$(date -d "$DAY -14 day" +%Y%m%d)-022000.dump ] \
        && [ -e $PUB/afldb_prod-$first-022000.dump ] && hok "retention keeps 14 dumps and 14 sidecars (the two oldest removed); seals kept: $(ls $SEALS | wc -l)" || hfail "retention: $k dumps $ks sidecars"
      o=$(as_arm pg_restore --list $PUB/$D 2>&1); [ $? = 0 ] && hok "arm: pg_restore --list $D exit 0 ($(grep -c '^[0-9]' <<< "$o") TOC entries)" || hfail "arm cannot pg_restore --list: ${o:0:200}"
      as_arm mkdir -m 700 /home/arm/offhost
      (cd /home/arm && as_arm bash $FIX/tools/maintenance/offhost-pull.sh $PUB/ /home/arm/offhost) > $OUT/pull.out 2>&1; prc=$?
      echo "offhost-pull.sh (REAL, unchanged) as arm, source $PUB/: exit $prc"; sed 's/^/   | /' $OUT/pull.out
      [ "$prc" = 0 ] && [ -e "/home/arm/offhost/.verified-$D" ] && [ "$(sha /home/arm/offhost/$D)" = "$S" ] && hok "arm's off-host pull copied and verified $D ($S)" || hfail "off-host pull exit $prc"
      o=$(as_arm psql -X -At "$DSN" -c 'SELECT current_user' 2>&1); [ $? != 0 ] && hok "arm cannot authenticate by peer as afldb_backup: ${o:0:120}" || hfail "arm authenticated as afldb_backup: $o"
      o=$(as_arm env AFLDB_BACKUP_DIR=/home/arm/backups/afldb-scheduled AFLDB_BACKUP_SEALED_STATE_DIR=$STATE bash $FIX/tools/maintenance/scheduled-backup.sh status 2>&1)
      echo "scheduled-backup.sh status as arm with AFLDB_BACKUP_SEALED_STATE_DIR=$STATE:"; sed 's/^/   | /' <<< "$o"
      grep -q "STATUS ok   backup: $D 0h ago" <<< "$o" && hok "status sees the sealed nightly ($D)" || hfail "status does not see the sealed nightly"
      [ -z "$(ls -A $STGD)" ] && [ -z "$(ls -A $PUB | grep '^\.')" ] && hok "staging empty, no temporary left in published/" || hfail "leftovers in staging or published"
    fi
    [ -n "${EXPSHA:-}" ] && { [ "$EXPSHA" = "$S" ] && hok "full digest: SO_SHA = root's hash of the staging dump taken during the sealing hold" || hfail "SO_SHA $S != root's hold-time hash $EXPSHA"; }
    if [ "$SC" = review2 ]; then
      grep -q 'REFUSED rc=[0-9]*: kill -STOP' $OUT/watcher.log && hok "the watcher reached the run's processes: $(grep -c 'kill -STOP' $OUT/watcher.log) SIGSTOP attempt(s)" || hfail "the watcher never saw a run process (attack not exercised)"
      grep -q '^.* ALLOWED ' $OUT/watcher.log && hfail "the watcher succeeded at: $(grep ' ALLOWED ' $OUT/watcher.log | head -3 | tr '\n' ';')" || hok "every watcher action was refused"
      grep 'kill -STOP' $OUT/watcher.log | grep -v 'Operation not permitted' | grep -qv 'No such process' && hfail "a SIGSTOP failed with something other than EPERM or ESRCH"         || hok "every SIGSTOP failed: $(grep 'kill -STOP' $OUT/watcher.log | grep -c 'Operation not permitted') with EPERM, $(grep 'kill -STOP' $OUT/watcher.log | grep -c 'No such process') with ESRCH (the process had already exited)"
      grep -q 'published: ' $OUT/watcher.log && hok "the watcher attacked the published dump too" || hfail "the watcher never saw the publication"
    fi
  else hfail "sealed_origin refused: $SOR"; fi
else
  [ "$SORC" != 0 ] && hok "sealed_origin refused: $SOR" || hfail "sealed_origin ACCEPTED (expected refusal): $(sov SO_DUMP) $(sov SO_SHA)"
  [ -n "$REFUSAL" ] && { [[ $SOR =~ $REFUSAL ]] && hok "refusal reason matches /$REFUSAL/" || hfail "refusal reason does not match /$REFUSAL/"; }
  case $SC in
    hand-start) s=$SEALS/$INV.seal; grep -qx 'trigger_unit=none' $s 2>/dev/null && [ "$RES" = success ] && hok "the hand start succeeded and was sealed with trigger_unit=none" || hfail "hand-start seal/result unexpected";;
    timer-then-hand) [ "$(ls $SEALS | wc -l)" = 2 ] && hok "two seals (timer, then by hand)" || hfail "expected two seals";;
    restart) s=$SEALS/$INV.seal; grep -qx 'trigger_unit=afldb-backup.timer' $s 2>/dev/null && [ "$INV" != "$INV1" ] && hok "invocation #2 $INV kept the timer's job and trigger (sealed), refused on inactive_enter" || hfail "restart facts unexpected";;
    rearm-out) s=$SEALS/$INV.seal; grep -qx 'dispatch_kind=catch-up' $s 2>/dev/null && grep -qx 'trigger_unit=afldb-backup.timer' $s && hok "the catch-up was sealed (trigger timer, catch-up) at 02:32, outside the window" || hfail "rearm-out seal unexpected";;
    pgdump-fails) [ "$RES" != success ] && [ -z "$(ls -A $SEALS)" ] && [ -z "$(ls $PUB)" ] && [ -s /home/arm/backups/afldb-scheduled/.state/FAILED-unit ] \
        && hok "the unit failed (Result=$RES), no seal, nothing published, OnFailure wrote FAILED-unit" || hfail "pgdump-fails: Result=$RES seals=$(ls $SEALS | wc -l) published=$(ls $PUB | wc -l)";;
    seal-interrupted) s=$SEALS/$INV.seal
      [ "$RES" != success ] && grep -q '^dump=afldb_prod-' $s 2>/dev/null && [ -z "$(ls $PUB | grep -v '^\.')" ] && [ -s /home/arm/backups/afldb-scheduled/.state/FAILED-unit ] \
        && hok "the unit failed (Result=$RES); the seal exists but nothing was published (seal-without-file is refused); OnFailure fired; left: $(ls -A $PUB | tr '\n' ' ')" \
        || hfail "seal-interrupted: Result=$RES published=$(ls -A $PUB | tr '\n' ' ')";;
  esac
fi
if [ ${#FAILS[@]} = 0 ]; then
  echo "SCENARIO $SC PASS expect=$EXPECT so_rc=$SORC $( [ "$SORC" = 0 ] && echo "inv=$(sov SO_INVOCATION) dump=$(sov SO_DUMP) sha256=$(sov SO_SHA) dispatch=$(sov SO_DISPATCH_KIND) delay=$(sov SO_DISPATCH_DELAY_S)s" || echo "reason=${SOR:0:240}")"
  exit 0
fi
echo "SCENARIO $SC FAIL expect=$EXPECT so_rc=$SORC: ${#FAILS[@]} harness failure(s): $(printf '%s; ' "${FAILS[@]}" | cut -c1-400)"
exit 1
