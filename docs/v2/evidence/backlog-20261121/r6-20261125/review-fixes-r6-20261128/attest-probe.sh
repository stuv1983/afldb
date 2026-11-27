#!/usr/bin/env bash
# REHEARSAL ONLY (R6 r6, 28 Nov 2026): the attestation MECHANISM probe on REAL systemd 255 (Ubuntu 24.04). Never production.
#   bash attest-probe.sh host <RUN> <RID>   on streamanator as arm: RUN = a private mktemp directory holding RUN/fix (an export of the
#                                           worktree: deploy/, docs/v2/evidence/, tools/maintenance/); builds ONE image r6a-sysd-<RID>:1
#                                           (the pinned base + apt systemd/dbus, as r5's real-systemd-attribution.sh), runs ONE container
#                                           r6a-<RID>-probe, writes RUN/logs/attest-probe-<RID>.log, removes the container and the image.
#   bash attest-probe.sh container          inside that container (PID 1 = real systemd), as root: the steps below.
# Container flags as r5 (no --privileged): --network none --cgroupns=private --tmpfs /run --tmpfs /run/lock --cap-add SYS_ADMIN
#   --security-opt apparmor=unconfined; the entry script remounts the container's cgroup2 read-write and execs /sbin/init.
# What it shows, with the REAL deploy/afldb-backup.service and .timer, the production scheduled-backup.sh (234fca6a) and a STUB
# backup.sh (no database; it prints its uid and sleeps while /run/afldb-probe-slow exists):
#   P1 install-attest.sh refusals (staging under /home, group-writable staging, a tampered bundle) and the real install + verify;
#   P2 the exact `systemctl show` format: ExecStartPostEx with the drop-in (root and arm), EnvironmentFiles with none;
#   P3b after P3: EnvironmentFiles with an EnvironmentFile=, ExecStartPostEx with TWO entries (a temporary second drop-in that also
#      prints the uid and NoNewPrivs of a "+" command while ExecStart runs as arm under NoNewPrivileges=true), and the gate refusing both;
#   P3 a genuine calendar dispatch of the timer: the record (job live, JobType=start, timer ActivationDetails, activating/start-post),
#      the monotonic properties, and the gates' attested_origin (extracted verbatim from r1-g0-dump.sh) as arm: PASS;
#   P4 a start by hand: record trigger_unit=none; attested_origin refuses;
#   P5 the RESTART case: a timer run whose ExecStart is still running, then `systemctl restart afldb-backup.service`: invocation #1
#      (killed in ExecStart) has no record; invocation #2's record vs a genuine one; attested_origin refuses #2;
#   P6 Astra's case: the timer's job fails on its dependency, a start by hand 3 s later succeeds: record trigger_unit=none; refused;
#   P7 a writer failure (record directory moved away): the backup still succeeds (the '-' prefix), no record, one journal line.
set -uo pipefail; export LC_ALL=C
MODE=${1:?host|container}
B=docs/v2/evidence/backlog-20261121; H6=$B/r6-20261125/review-fixes-r6-20261128

if [ "$MODE" = host ]; then
  [ "$(hostname)" != afldb-prod ] || { echo "REFUSED: never on production"; exit 2; }
  RUN=${2:?run directory}; RID=${3:?run id}
  [[ $RID =~ ^[A-Za-z0-9-]+$ ]] && [ -d "$RUN/fix" ] && [ -O "$RUN" ] && [ ! -L "$RUN" ] || { echo "STOP not this run's private directory"; exit 2; }
  PIN=sha256:d71c0b286c54a7cc48645aa8d4d9d0c57e4260128cb91a6fb18c29d7589205ba   # grafana/alloy:latest on streamanator, Ubuntu 24.04.4
  IMG=r6a-sysd-$RID:1; LBL=r6a.run=$RID; NAME=r6a-$RID-probe; LOG=$RUN/logs/attest-probe-$RID.log
  mkdir -p "$RUN/logs" "$RUN/build"
  {
    echo "== R6 r6 attestation probe $(date -u +%FT%TZ) host=$(hostname) user=$(id -un) run=$RUN docker $(docker version -f '{{.Server.Version}}')"
    printf 'FROM %s\nLABEL %s\nENV DEBIAN_FRONTEND=noninteractive\nRUN apt-get update && apt-get install -y --no-install-recommends systemd systemd-sysv dbus libpam-systemd util-linux coreutils procps && rm -rf /var/lib/apt/lists/* && systemctl --version | head -1\n' \
      "$PIN" "$LBL" > "$RUN/build/Dockerfile"
    docker build --label "$LBL" -t "$IMG" "$RUN/build" > "$RUN/build/build.log" 2>&1 || { tail -5 "$RUN/build/build.log"; echo "STOP image build failed"; exit 1; }
    echo "image $IMG id $(docker image inspect -f '{{.Id}}' "$IMG") from $PIN"
    printf '#!/bin/sh\nmount -o remount,rw /sys/fs/cgroup || exit 97\nexec /sbin/init\n' > "$RUN/entry.sh"; chmod 755 "$RUN/entry.sh"
    docker run -d --name "$NAME" --label "$LBL" --network none --hostname r6a-probe --cgroupns=private --tmpfs /run --tmpfs /run/lock \
      --cap-add SYS_ADMIN --security-opt apparmor=unconfined --stop-signal SIGRTMIN+3 -v "$RUN/entry.sh:/entry.sh:ro" -v "$RUN/fix:/in/fix:ro" \
      --entrypoint /entry.sh "$IMG" > /dev/null || { echo "STOP container did not start"; exit 1; }
    docker exec "$NAME" bash "/in/fix/$H6/attest-probe.sh" container; rc=$?
    echo "== controller exit $rc ($(date -u +%FT%TZ))"
    docker rm -f "$NAME" > /dev/null 2>&1; docker rmi "$IMG" > /dev/null 2>&1
    echo "== cleanup: containers labelled $LBL: $(docker ps -aq --filter "label=$LBL" | wc -l); images labelled $LBL: $(docker images -q --filter "label=$LBL" | wc -l)"
    exit "$rc"
  } 2>&1 | tee "$LOG"
  exit "${PIPESTATUS[0]}"
fi
[ "$MODE" = container ] && [ -f /.dockerenv ] && [ "$(cat /proc/1/comm)" = systemd ] || { echo "REFUSED: container mode needs a container whose PID 1 is systemd"; exit 2; }

FIX=/in/fix; ATT=$FIX/$H6/attest; G0=$FIX/docs/v2/evidence/release-17822b29-20261124/scripts/r1-g0-dump.sh
RD=/var/lib/afldb-backup-attest; BAD=0
line() { printf '%s\n' "$*"; }
hdr() { printf '\n== %s\n' "$*"; }
as_arm() { setpriv --reuid=arm --regid=arm --init-groups env -i HOME=/home/arm USER=arm LOGNAME=arm PATH=/usr/local/bin:/usr/bin:/bin LANG=C.UTF-8 "$@"; }
expect() { if [ "$1" = ok ]; then line "   CHECK OK: $2"; else line "   CHECK UNEXPECTED: $2"; BAD=$((BAD + 1)); fi; }
tusec() { busctl get-property org.freedesktop.systemd1 /org/freedesktop/systemd1/unit/afldb_2dbackup_2etimer org.freedesktop.systemd1.Timer LastTriggerUSec | awk '{print $2}'; }
settle() { local i st; for i in $(seq 1 300); do st=$(systemctl is-active afldb-backup.service); [ "$st" != active ] && [ "$st" != activating ] && [ "$st" != deactivating ] && return 0; sleep 0.2; done; }
for i in $(seq 1 120); do case $(systemctl is-system-running 2>/dev/null) in running|degraded) break;; esac; sleep 1; done
hdr "environment"
line "systemd: $(systemctl --version | head -1); kernel $(uname -r); $(. /etc/os-release; echo "$PRETTY_NAME"); PID 1 $(cat /proc/1/comm); bash $BASH_VERSION; coreutils $(dpkg-query -W -f '${Version}' coreutils)"
line "bundle: $(cd "$ATT" && sha256sum -c SHA256SUMS 2>&1 | tr '\n' ' ')"
line "gate G0 sha256 $(sha256sum < "$G0" | cut -c1-64); A-2 $(sha256sum < "$FIX/$B/r6-20261125/r6-pre-verify.sh" | cut -c1-64)"
line "pinned in G0: $(grep -o 'WS=[0-9a-f]*\|DS=[0-9a-f]*' "$G0" | tr '\n' ' ')"
userdel -r ubuntu > /dev/null 2>&1; useradd -M -u 1000 -s /bin/bash arm
CHK=/home/arm/projects/afldb; BKD=/home/arm/backups/afldb-scheduled
install -d -o arm -g arm -m 755 /home/arm /home/arm/projects "$CHK" "$CHK/tools" "$CHK/tools/maintenance" /home/arm/backups "$BKD"
cp "$FIX/tools/maintenance/scheduled-backup.sh" "$CHK/tools/maintenance/scheduled-backup.sh"
line "scheduled-backup.sh (the production bytes): $(sha256sum < "$CHK/tools/maintenance/scheduled-backup.sh" | cut -c1-64)"
cat > "$CHK/tools/maintenance/backup.sh" <<'EOF'
#!/usr/bin/env bash
# STUB (no database here): same interface and output line as tools/maintenance/backup.sh. Prints the uid it runs as; sleeps while
# /run/afldb-probe-slow exists (the restart case needs a run that is still in ExecStart).
dir=''; while [ $# -gt 0 ]; do case $1 in --dir) dir=$2; shift 2;; *) shift;; esac; done
target="$dir/afldb_prod-$(date +%Y%m%d-%H%M%S).dump"
echo "==> Backing up afldb_prod to $target"
echo "stub-backup: uid=$(id -u) NoNewPrivs=$(awk '/^NoNewPrivs/ {print $2}' /proc/self/status)"
[ -e /run/afldb-probe-slow ] && sleep 8
head -c 4096 /dev/urandom > "$target"
echo "==> Done."
EOF
printf '#!/usr/bin/env bash\nexit 0\n' > "$CHK/tools/maintenance/restore-test.sh"
chown -R arm:arm /home/arm/projects; chmod 755 "$CHK"/tools/maintenance/*.sh
for u in afldb-backup.service afldb-backup.timer afldb-backup-failed.service; do install -m 0644 "$FIX/deploy/$u" /etc/systemd/system/$u; done
printf '[Unit]\nDescription=stub postgresql for the probe\n[Service]\nType=oneshot\nRemainAfterExit=yes\nExecStart=/bin/sh -c "test -f /run/pg-ok"\n' > /etc/systemd/system/postgresql.service
touch /run/pg-ok
install -d -m 0755 /etc/systemd/system/afldb-backup.timer.d
printf '[Timer]\nRandomizedDelaySec=0\nAccuracySec=1s\n' > /etc/systemd/system/afldb-backup.timer.d/probe.conf
systemctl daemon-reload

# extract the gate's functions verbatim (as r5's run_a2fn does) and run attested_origin as arm against the live unit
: > /tmp/gfn.sh; for fn in timer_usec read_invocation trusted_path attested_origin; do sed -n "/^$fn() {/,/^}/p" "$G0" >> /tmp/gfn.sh; done; chmod 644 /tmp/gfn.sh
gate() { as_arm bash -c '. /tmp/gfn.sh; read_invocation afldb-backup.service || { echo "RI_WHY $RI_WHY"; exit 3; }; tu=$(timer_usec) || { echo "no timer usec"; exit 4; }
  if attested_origin "$RI_ID" "$tu"; then echo "attested_origin rc 0: $AO_INFO"; else rc=$?; echo "attested_origin rc $rc: $AO_WHY"; exit $rc; fi'; }
rec() { local f=$RD/$1.attest; if [ -e "$f" ]; then line "   record $f ($(stat -c '%U:%G %a links=%h %s B' "$f")):"; sed 's/^/     | /' "$f"; else line "   no record $f"; fi; }
svc() { systemctl show afldb-backup.service -p InvocationID -p Result -p ExecMainStatus -p InactiveEnterTimestampMonotonic -p InactiveExitTimestampMonotonic -p ExecMainStartTimestampMonotonic -p ActiveEnterTimestampMonotonic | tr '\n' ' '; }
tmr() { line "   timer: $(systemctl show afldb-backup.timer -p ActiveEnterTimestampMonotonic -p InactiveExitTimestampMonotonic | tr '\n' ' ')busctl LastTriggerUSec/Monotonic: $(busctl get-property org.freedesktop.systemd1 /org/freedesktop/systemd1/unit/afldb_2dbackup_2etimer org.freedesktop.systemd1.Timer LastTriggerUSec LastTriggerUSecMonotonic | tr '\n' ' ')"; }
jrnl() { line "   journal (root, this invocation $1):"; journalctl _SYSTEMD_INVOCATION_ID="$1" --no-pager -o short-monotonic -q | cut -c1-200 | sed 's/^/     | /'; }

hdr "P1 install-attest.sh: refusals, then the install"
ST=/opt/afldb-attest-r6; install -d -o root -g root -m 0755 "$ST"
for f in afldb-backup-attest 60-afldb-backup-attest.conf install-attest.sh verify-attest-install.sh SHA256SUMS; do install -o root -g root -m 0644 "$ATT/$f" "$ST/$f"; done
line "   staging $ST: SHA256SUMS sha256 $(sha256sum < "$ST/SHA256SUMS" | cut -c1-64)"
install -d -o arm -g arm -m 0755 /home/arm/stage; cp "$ST"/* /home/arm/stage/
o=$(bash "$ST/install-attest.sh" /home/arm/stage 2>&1); rc=$?; line "   from /home/arm/stage: exit $rc: $(tail -1 <<< "$o")"
[ "$rc" = 2 ] && grep -q 'under /home' <<< "$o" && expect ok "staging under /home refused" || expect bad "staging under /home refused"
chmod 0775 "$ST"; o=$(bash "$ST/install-attest.sh" "$ST" 2>&1); rc=$?; chmod 0755 "$ST"; line "   group-writable staging: exit $rc: $(tail -1 <<< "$o")"
[ "$rc" = 2 ] && grep -q 'group/other-writable' <<< "$o" && expect ok "group-writable staging refused" || expect bad "group-writable staging refused"
cp -p "$ST/afldb-backup-attest" /tmp/w.keep; printf '# tampered\n' >> "$ST/afldb-backup-attest"
o=$(bash "$ST/install-attest.sh" "$ST" 2>&1); rc=$?; install -o root -g root -m 0644 /tmp/w.keep "$ST/afldb-backup-attest"; line "   tampered writer: exit $rc: $(tail -1 <<< "$o")"
[ "$rc" = 2 ] && grep -q 'does not match SHA256SUMS' <<< "$o" && expect ok "tampered bundle refused" || expect bad "tampered bundle refused"
o=$(bash "$ST/install-attest.sh" "$ST" --check 2>&1); rc=$?; line "   --check before install: exit $rc: $(tail -1 <<< "$o")"
[ "$rc" = 1 ] && [ ! -e /usr/local/libexec/afldb ] && expect ok "--check before the install fails and changes nothing" || expect bad "--check before install"
bash "$ST/install-attest.sh" "$ST" 2>&1 | sed 's/^/   | /'; rc=${PIPESTATUS[0]}
[ "$rc" = 0 ] && expect ok "install-attest.sh exit 0 (installed, verified as root and as arm)" || expect bad "install-attest.sh exit $rc"

hdr "P2 the exact systemctl show format (formats only; the gate refusals they cause are in P3b, after a real run)"
line "   as root:"; systemctl show afldb-backup.service -p FragmentPath -p DropInPaths -p EnvironmentFiles -p ExecStartPostEx -p ExecStartPost | sed 's/^/     | /'
line "   as arm:";  as_arm systemctl show afldb-backup.service -p FragmentPath -p DropInPaths -p EnvironmentFiles -p ExecStartPostEx | sed 's/^/     | /'
line "   EnvironmentFiles lines when the unit has none: $(systemctl show afldb-backup.service -p EnvironmentFiles | grep -c .)"

hdr "P3 a genuine calendar dispatch of afldb-backup.timer"
at=$(date -d '+25 sec' '+%H:%M:%S')
printf '[Timer]\nOnCalendar=\nOnCalendar=*-*-* %s\nRandomizedDelaySec=0\nAccuracySec=1s\nPersistent=false\n' "$at" > /etc/systemd/system/afldb-backup.timer.d/probe.conf
systemctl daemon-reload; systemctl restart afldb-backup.timer
line "   timer armed for $at (container clock, UTC): next $(systemctl show afldb-backup.timer -p NextElapseUSecRealtime --value)"; tmr
LT0=$(tusec); for i in $(seq 1 300); do [ "$(tusec)" != "$LT0" ] && break; sleep 0.2; done; sleep 1; settle
I3=$(systemctl show afldb-backup.service -p InvocationID --value); LT=$(tusec)
line "   service: $(svc)"; tmr; jrnl "$I3"; rec "$I3"
o=$(gate 2>&1); rc=$?; line "   gate attested_origin (as arm): $o"
[ "$rc" = 0 ] && grep -q "^job_type=start$" "$RD/$I3.attest" && grep -q '^sub_state=start-post$' "$RD/$I3.attest" && grep -q "^trigger_timer_realtime_usec=$LT$" "$RD/$I3.attest" \
  && expect ok "genuine timer run: job live as JobType=start in start-post, trigger usec = LastTriggerUSec $LT, gate PASS" || expect bad "genuine timer run"
cp "$RD/$I3.attest" /tmp/genuine.attest
as_arm bash -c ": > $RD/arm-was-here" 2>/dev/null && expect bad "arm could create a file in $RD" || line "   (arm cannot create files in $RD: as expected; live write attempts are the harness's job)"

hdr "P3b the gate against a changed unit (temporary drop-ins, removed again), and who runs what"
printf '[Service]\nEnvironmentFile=-/home/arm/afldb-probe.env\n' > /etc/systemd/system/afldb-backup.service.d/70-probe-envfile.conf; systemctl daemon-reload
line "   with a temporary EnvironmentFile= drop-in: $(systemctl show afldb-backup.service -p EnvironmentFiles | tr '\n' ' ')"
o=$(gate 2>&1); rc=$?; line "   gate: $o"
[ "$rc" != 0 ] && grep -q 'EnvironmentFile= entries' <<< "$o" && expect ok "an EnvironmentFile= refuses the attested genuine run" || expect bad "EnvironmentFile refusal"
rm /etc/systemd/system/afldb-backup.service.d/70-probe-envfile.conf
cat > /etc/systemd/system/afldb-backup.service.d/70-probe-second.conf <<'EOF'
[Service]
ExecStartPost=+/usr/bin/bash -c 'echo second-post: uid=$$(id -u) $$(grep NoNewPrivs /proc/self/status)'
EOF
systemctl daemon-reload
line "   with a second ExecStartPost (+):"; systemctl show afldb-backup.service -p ExecStartPostEx -p DropInPaths | sed 's/^/     | /'
o=$(gate 2>&1); rc=$?; line "   gate: $o"
[ "$rc" != 0 ] && grep -q '2 ExecStartPost commands' <<< "$o" && expect ok "two ExecStartPost entries refuse the attested genuine run" || expect bad "two-entry refusal"
systemctl start afldb-backup.service; line "   systemctl start (by hand, with the second post): exit $?"; settle; I=$(systemctl show afldb-backup.service -p InvocationID --value)
jrnl "$I"
journalctl _SYSTEMD_INVOCATION_ID="$I" -o cat -q | grep -q '^stub-backup: uid=1000 NoNewPrivs=1' && journalctl _SYSTEMD_INVOCATION_ID="$I" -o cat -q | grep -q '^second-post: uid=0 NoNewPrivs:.0' \
  && expect ok "ExecStart runs as uid 1000 with NoNewPrivs=1; a '+' ExecStartPost of the same run runs as uid 0 without NoNewPrivs" || expect bad "uid/NoNewPrivs of ExecStart vs '+' ExecStartPost"
rec "$I"; [ "$(stat -c '%U %a %h' "$RD/$I.attest" 2>/dev/null)" = "root 644 1" ] && expect ok "the writer ran as root: record root 0644, one link" || expect bad "record root-owned"
rm /etc/systemd/system/afldb-backup.service.d/70-probe-second.conf; systemctl daemon-reload
line "   drop-ins now: $(systemctl show afldb-backup.service -p DropInPaths --value)"

hdr "P4 a start by hand"
systemctl start afldb-backup.service; settle; I4=$(systemctl show afldb-backup.service -p InvocationID --value)
rec "$I4"; o=$(gate 2>&1); rc=$?; line "   gate: $o"
[ "$rc" != 0 ] && grep -q '^trigger_unit=none$' "$RD/$I4.attest" && grep -q "trigger unit 'none'" <<< "$o" && expect ok "start by hand: record trigger_unit=none, gate refuses" || expect bad "start by hand"

hdr "P5 the restart case: systemctl restart afldb-backup.service while the timer's run is in ExecStart"
touch /run/afldb-probe-slow
at=$(date -d '+20 sec' '+%H:%M:%S')
printf '[Timer]\nOnCalendar=\nOnCalendar=*-*-* %s\nRandomizedDelaySec=0\nAccuracySec=1s\nPersistent=false\n' "$at" > /etc/systemd/system/afldb-backup.timer.d/probe.conf
systemctl daemon-reload; systemctl restart afldb-backup.timer; LT0=$(tusec)
for i in $(seq 1 300); do [ "$(tusec)" != "$LT0" ] && break; sleep 0.2; done
for i in $(seq 1 50); do [ "$(systemctl show afldb-backup.service -p SubState --value)" = start ] && break; sleep 0.1; done; sleep 2
I5a=$(systemctl show afldb-backup.service -p InvocationID --value); J5=$(systemctl show afldb-backup.service -p Job --value)
line "   invocation #1 $I5a in ExecStart: job $J5: $(busctl get-property org.freedesktop.systemd1 /org/freedesktop/systemd1/job/$J5 org.freedesktop.systemd1.Job JobType ActivationDetails | tr '\n' ' ')"
rm -f /run/afldb-probe-slow; systemctl restart afldb-backup.service; settle
I5b=$(systemctl show afldb-backup.service -p InvocationID --value); LT=$(tusec)
line "   after the restart: $(svc)"; tmr; jrnl "$I5a"; jrnl "$I5b"
rec "$I5a"; rec "$I5b"
line "   the restart record vs the genuine P3 record (field by field, values differ by dispatch; the decisive relation is inactive_enter_mono vs timer_last_trigger_mono):"
diff <(sed 's/=.*//' /tmp/genuine.attest) <(sed 's/=.*//' "$RD/$I5b.attest") > /dev/null && line "     same 20 keys"
for k in job job_type active_state sub_state exec_main_code exec_main_status trigger_unit inactive_enter_mono timer_last_trigger_mono inactive_exit_mono exec_main_start_mono; do
  g=$(sed -n "s/^$k=//p" /tmp/genuine.attest); r=$(sed -n "s/^$k=//p" "$RD/$I5b.attest"); line "     $k: genuine $g | restart #2 $r"; done
ie=$(sed -n 's/^inactive_enter_mono=//p' "$RD/$I5b.attest"); tm=$(sed -n 's/^timer_last_trigger_mono=//p' "$RD/$I5b.attest"); xs=$(sed -n 's/^exec_main_start_mono=//p' "$RD/$I5b.attest")
line "     restart #2: inactive_enter - dispatch = $((ie - tm)) us (genuine: negative); main start - dispatch = $((xs - tm)) us"
o=$(gate 2>&1); rc=$?; line "   gate on #2: $o"
[ ! -e "$RD/$I5a.attest" ] && [ "$rc" != 0 ] && grep -q '^job_type=start$' "$RD/$I5b.attest" && grep -q '^trigger_unit=afldb-backup.timer$' "$RD/$I5b.attest" \
  && grep -q "^trigger_timer_realtime_usec=$LT$" "$RD/$I5b.attest" && (( ie > tm )) && grep -q 'entered inactive' <<< "$o" \
  && expect ok "restart: #1 has no record; #2 carries the timer's job, JobType=start and the exact dispatch, but inactive_enter_mono > timer_last_trigger_mono, and the gate refuses it" \
  || expect bad "restart case"

hdr "P6 Astra's case: the timer's job fails on its dependency, a start by hand 3 s later succeeds"
rm -f /run/pg-ok; systemctl stop postgresql.service
at=$(date -d '+20 sec' '+%H:%M:%S')
printf '[Timer]\nOnCalendar=\nOnCalendar=*-*-* %s\nRandomizedDelaySec=0\nAccuracySec=1s\nPersistent=false\n' "$at" > /etc/systemd/system/afldb-backup.timer.d/probe.conf
systemctl daemon-reload; systemctl restart afldb-backup.timer; LT0=$(tusec)
for i in $(seq 1 300); do [ "$(tusec)" != "$LT0" ] && break; sleep 0.2; done; LT=$(tusec)
until [ $(( $(date +%s%N) / 1000 )) -ge $((LT + 3000000)) ]; do sleep 0.05; done
touch /run/pg-ok; systemctl start postgresql.service; systemctl start afldb-backup.service; settle
I6=$(systemctl show afldb-backup.service -p InvocationID --value)
line "   service: $(svc)"; rec "$I6"; o=$(gate 2>&1); rc=$?; line "   gate: $o"
[ "$rc" != 0 ] && grep -q '^trigger_unit=none$' "$RD/$I6.attest" && expect ok "Astra's case: the hand start's record says trigger_unit=none; refused" || expect bad "Astra's case"

hdr "P7 a writer failure: the record directory is moved away for one run"
mv "$RD" "$RD.away"; systemctl start afldb-backup.service; settle; I7=$(systemctl show afldb-backup.service -p InvocationID --value); mv "$RD.away" "$RD"
line "   service: $(svc)"; jrnl "$I7"; rec "$I7"
[ "$(systemctl show afldb-backup.service -p Result --value)" = success ] && [ ! -e "$RD/$I7.attest" ] && journalctl _SYSTEMD_INVOCATION_ID="$I7" -o cat -q | grep -q '^afldb-backup-attest: no record: no record directory' \
  && expect ok "writer failure: the backup still succeeds, no record, one journal line" || expect bad "writer failure"

hdr "verify-attest-install.sh after the runs (root, then arm)"
bash "$ST/verify-attest-install.sh" | sed 's/^/   | /'
as_arm bash "$ST/verify-attest-install.sh" | tail -3 | sed 's/^/   | /'
hdr "verdict"; line "unexpected checks: $BAD"
[ "$BAD" = 0 ] && line "ATTEST PROBE RESULT PASS" || { line "ATTEST PROBE RESULT FAIL ($BAD)"; exit 1; }
