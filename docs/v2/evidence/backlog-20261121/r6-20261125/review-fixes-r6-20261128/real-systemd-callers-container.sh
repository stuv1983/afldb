#!/usr/bin/env bash
# REHEARSAL ONLY (R6 r6, 28 Nov 2026). Runs INSIDE one disposable container whose PID 1 is the REAL systemd 255 (Ubuntu 24.04), started by
# real-systemd-callers.sh on streamanator (--network none, no --privileged; see that script). Never production.
# It runs the two ACTUAL gate callers, unmodified, through their real main, as arm (uid 1000, NO supplementary groups: not adm, not
# systemd-journal; `env -i` environment), against real systemd evidence:
#   G0   bash r1-g0-dump.sh <today>                     A-2  bash r6-pre-verify.sh <seven arguments, a valid set>
# A-2's date check (2026-11-25) prints a FAIL and the script continues to section 5, whose window uses today's date. Sections 1-4 and 6
# (kernel, grub, release, psql, invocation, capacity) and the restore/ledger half of section 5 FAIL in a container: they are listed
# separately as UNRELATED and never counted as, or against, the backup-origin verdict.
# Every input is labelled in the log:
#   [REAL-SYSTEMD]  the timer, its dispatch, the start job, the invocation, the journal, and the record written by the installed writer
#   [FIXTURE]       the stub backup.sh, the stub postgresql.service, the fake zone, the timer timing drop-in, any extra fixture drop-in,
#                   the timer stamp, any record planted / removed / chmodded by root to simulate damage, the off-host copy
#   [HARNESS]       computed by this script (its own judgement, never an input to the callers)
# The harness never writes an OFFHOST-COMPARE line. The off-host copy (astra scenario) is a separate directory the callers never read.
# Scenarios (argument 1):
#   genuine-attested                   genuine timer dispatch, writer installed; then the arm-cannot-replace suite
#   astra-manual-after-hidden-failure  the timer's job fails on a dependency (PID 1 alone logs it), root `systemctl start` at +3 s
#                                      succeeds, then an off-host copy of dump + sidecar exists
#   old-install-r5-trigger             genuine dispatch, NO writer, the r5 scheduled-backup.sh (bab61796, logs a valid trigger: line)
#   forged-trigger-manual              writer installed; arm-edited script forges "trigger: ... unit=afldb-backup.timer
#                                      realtime_usec=<LastTriggerUSec>"; hidden dependency failure + root manual start at +3 s;
#                                      CONTRAST: the 624bf721 gates on the same evidence
#   record-missing                     genuine dispatch with writer; root removes the record
#   record-ambiguous                   genuine dispatch with writer; root plants a second record with the same dispatch usec
#   record-groupwritable               genuine dispatch with writer; root makes the record group-writable (chmod g+w)
#   restart-hidden-first               FIXTURE drop-in ExecStartPre (as arm, logs nothing) sleeps 4 s in invocation #1 only; root
#                                      `systemctl restart` during that sleep; invocation #2 succeeds
#   timer-rearm                        timer stopped before 02:20, the 02:20 elapse missed, root starts the timer at 02:20:15:
#                                      Persistent= catch-up fires at once (no policy expectation: the facts are recorded)
#   arm-node-swap                      (independent review MED-1) genuine dispatch with writer; node at the gates' pinned path is an
#                                      ARM-OWNED copy (FIXTURE-ATTACK: production's arm owns ~/.nvm). After the run, as arm: delete the
#                                      timer's dump, plant afldb_prod-<day>-022130.dump with its own sidecar, replace ~/.nvm node with a
#                                      wrapper that rewrites the 'backup ok' line to name the planted dump. Must be refused.
#                                      CONTRAST: the bda102aa gates (git show bda102aa:<path>, sent as contrast-bda102aa/) on the same evidence
# Record format: /1 (DESIGN.md at 297175f9) or /2 (adds dump= and dump_sha256=, the MED-1 fix). When a record carries them they are
# checked against the dump the attested run wrote, as root captured it before any attack.
set -uo pipefail; export LC_ALL=C
SC=${1:?scenario}; FIX=/in/fix; DAY=${R6H_DAY:?}; SMOKE=${R6H_SMOKE:-0}; TD=${R6H_DISPATCH:?}; DAYC=${DAY//-/}
B=docs/v2/evidence/backlog-20261121; H6=$B/r6-20261125/review-fixes-r6-20261128
G0=$FIX/docs/v2/evidence/release-17822b29-20261124/scripts/r1-g0-dump.sh; PRE=$FIX/$B/r6-20261125/r6-pre-verify.sh
OG0=$FIX/$H6/orig-624bf721/r1-g0-dump.sh; OPRE=$FIX/$H6/orig-624bf721/r6-pre-verify.sh
BG0=$FIX/contrast-bda102aa/r1-g0-dump.sh; BPRE=$FIX/contrast-bda102aa/r6-pre-verify.sh
PRODSB=$FIX/tools/maintenance/scheduled-backup.sh; R5SB=$FIX/$H6/orig-624bf721/scheduled-backup.sh; BUNDLE=$FIX/$H6/attest
A2ARGS=(accepted 7d92042fd110-XWruOm_9nLCSMY8nGPqYU r3:yes r4:no 10:00 tue:deferred inv:342040625f6d4012a35d598dfbf9afe6)
NB=/home/arm/.nvm/versions/node/v22.23.2/bin   # the gates' pinned node directory (the gates use it; the harness never does)
RNODE=/opt/realnode/bin/node                     # the host's node, read-only: the harness's own journal printer (as root)
WD=/usr/local/libexec/afldb; W=$WD/afldb-backup-attest
DID=/etc/systemd/system/afldb-backup.service.d; DI=$DID/60-afldb-backup-attest.conf; RD=/var/lib/afldb-backup-attest
UNITF=/etc/systemd/system/afldb-backup.service; TIMERF=/etc/systemd/system/afldb-backup.timer; TDD=/etc/systemd/system/afldb-backup.timer.d
CHK=/home/arm/projects/afldb; BKD=/home/arm/backups/afldb-scheduled; STG=/opt/r6h-attest-staging; OUT=/root/r6h
TOBJ=/org/freedesktop/systemd1/unit/afldb_2dbackup_2etimer; SOBJ=/org/freedesktop/systemd1/unit/afldb_2dbackup_2eservice
as_arm() { setpriv --reuid=1000 --regid=1000 --clear-groups env -i HOME=/home/arm USER=arm LOGNAME=arm PATH=/usr/local/bin:/usr/bin:/bin LANG=C.UTF-8 "$@"; }
line() { printf '%s\n' "$*"; }
hdr() { printf '\n== %s\n' "$*"; }
L() { printf '[%s] %s\n' "$1" "${*:2}"; }   # labelled line: REAL-SYSTEMD | FIXTURE | HARNESS
now_us() { echo $(( $(date +%s%N) / 1000 )); }
mel() { TZ=Australia/Melbourne date -d "@$1" '+%F %T %Z'; }
bprop() { busctl get-property org.freedesktop.systemd1 "$1" "$2" "$3" 2>&1 | sed 's/^[a-z()]* //; s/^"//; s/"$//'; }
tprop() { bprop $TOBJ org.freedesktop.systemd1.Timer "$1"; }
sprop() { bprop $SOBJ "$2" "$1"; }      # prop iface
wait_systemd() { local i; for i in $(seq 1 120); do case $(systemctl is-system-running 2>/dev/null) in running|degraded) return 0;; esac; sleep 1; done; echo "STOP systemd did not come up"; return 1; }
sha() { sha256sum < "$1" | cut -c1-64; }
mkdir -p $OUT

# ------------------------------------------------------------------------------------------------------------------ scenario table
WRITER=1; SBK=prod; HIDDEN=0; POST=none; RESTART=0; REARM=0; CONTRAST=0; OFFHOST=0; SUITE=0; NODESWAP=0; EXPECT=refused
case $SC in
  genuine-attested)                   EXPECT=attributed; SUITE=1;;
  astra-manual-after-hidden-failure)  HIDDEN=1; OFFHOST=1;;
  old-install-r5-trigger)             WRITER=0; SBK=r5;;
  forged-trigger-manual)              SBK=forged; HIDDEN=1; CONTRAST=624bf721;;
  record-missing)                     POST=rm;;
  record-ambiguous)                   POST=plant;;
  record-groupwritable)               POST=chmod;;
  restart-hidden-first)               RESTART=1;;
  timer-rearm)                        REARM=1; EXPECT=record;;
  arm-node-swap)                      NODESWAP=1; CONTRAST=bda102aa;;
  *) echo "STOP unknown scenario $SC"; exit 2;;
esac

wait_systemd || exit 1
hdr "environment"
L REAL-SYSTEMD "systemd: $(systemctl --version | head -1); kernel $(uname -r); image $(. /etc/os-release; echo "$PRETTY_NAME"); PID 1: $(cat /proc/1/comm); hostname $(hostname)"
L FIXTURE "zone: $(readlink -f /etc/localtime) fixed offset; now UTC $(date -u +%FT%T), local $(TZ=Australia/Melbourne date '+%F %T %Z'); dispatch due real $(date -u -d @$TD +%T)Z = local $(mel $TD)"
userdel -r ubuntu > /dev/null 2>&1; id arm > /dev/null 2>&1 || useradd -M -u 1000 -s /bin/bash arm
install -d -o arm -g arm -m 755 /home/arm /home/arm/projects $CHK $CHK/tools $CHK/tools/maintenance /home/arm/backups "$BKD"
line "arm as the gates run: $(as_arm id) (adm members: '$(getent group adm | cut -d: -f4)', systemd-journal members: '$(getent group systemd-journal | cut -d: -f4)'); env: $(as_arm env | tr '\n' ' ')"
line "fs.protected_hardlinks=$(cat /proc/sys/fs/protected_hardlinks) fs.protected_symlinks=$(cat /proc/sys/fs/protected_symlinks); journal: $(ls -ld /var/log/journal 2>&1 | cut -c1-40)"
line "scenario $SC: writer=$WRITER checkout-script=$SBK hidden-failure=$HIDDEN post=$POST restart=$RESTART rearm=$REARM contrast=$CONTRAST offhost-copy=$OFFHOST arm-suite=$SUITE node-swap=$NODESWAP expect=$EXPECT"

# ------------------------------------------------------------------------------------------------------------------ checkout and units
case $SBK in
  prod) cp "$PRODSB" $CHK/tools/maintenance/scheduled-backup.sh;;
  r5)   cp "$R5SB" $CHK/tools/maintenance/scheduled-backup.sh;;
  forged) cp "$PRODSB" $CHK/tools/maintenance/scheduled-backup.sh
    # arm's edit (FIXTURE for the attack): log a forged origin line right after the target: line, in the exact r5 format.
    sed -i '/^log "target: mode=/a [[ "$MODE" == backup ]] \&\& log "trigger: invocation=$INVOCATION_ID job=$(systemctl show afldb-backup.service -p Job --value) unit=afldb-backup.timer realtime_usec=$(busctl get-property org.freedesktop.systemd1 /org/freedesktop/systemd1/unit/afldb_2dbackup_2etimer org.freedesktop.systemd1.Timer LastTriggerUSec | cut -d" " -f2)"' \
      $CHK/tools/maintenance/scheduled-backup.sh;;
esac
cat > $CHK/tools/maintenance/backup.sh <<'EOF'
#!/usr/bin/env bash
# FIXTURE: STUB for the rehearsal (no database in the container). Same interface and output line as tools/maintenance/backup.sh:
# --dir D --keep N; writes D/afldb_prod-<YYYYMMDD-HHMMSS>.dump (random bytes) and prints "==> Backing up afldb_prod to <path>".
# It sleeps 3 s first so the run's start job stays live long enough for root to read it (the job, not the workload, is the evidence).
dir=''; while [ $# -gt 0 ]; do case $1 in --dir) dir=$2; shift 2;; *) shift;; esac; done
sleep 3
target="$dir/afldb_prod-$(date +%Y%m%d-%H%M%S).dump"
echo "==> Backing up afldb_prod to $target"
head -c 4096 /dev/urandom > "$target"
echo "==> Done."
EOF
printf '#!/usr/bin/env bash\nexit 0\n' > $CHK/tools/maintenance/restore-test.sh
chown -R arm:arm /home/arm/projects; chmod 755 $CHK/tools/maintenance/*.sh
for u in afldb-backup.service afldb-backup.timer afldb-backup-failed.service; do install -o root -g root -m 0644 "$FIX/deploy/$u" /etc/systemd/system/$u; done
printf '[Unit]\nDescription=FIXTURE stub postgresql for the rehearsal\n[Service]\nType=oneshot\nRemainAfterExit=yes\nExecStart=/bin/sh -c "test -f /run/pg-ok"\n' > /etc/systemd/system/postgresql.service
[ "$HIDDEN" = 1 ] && rm -f /run/pg-ok || touch /run/pg-ok
install -d -o root -g root -m 0755 $TDD
printf '[Timer]\nRandomizedDelaySec=0\nAccuracySec=1s\n' > $TDD/50-r6h-fixture-timing.conf; chmod 644 $TDD/50-r6h-fixture-timing.conf
hdr "inputs"
L FIXTURE "checkout $CHK/tools/maintenance/scheduled-backup.sh = $SBK, sha256 $(sha $CHK/tools/maintenance/scheduled-backup.sh) (prod 234fca6a = the 17822b29 blob; r5 bab61796; forged = prod + one arm-written trigger line)"
[ "$SBK" = forged ] && { line "   forged line inserted:"; grep -n 'log "trigger:' $CHK/tools/maintenance/scheduled-backup.sh | cut -c1-300 | sed 's/^/   | /'; }
L FIXTURE "backup.sh STUB sha256 $(sha $CHK/tools/maintenance/backup.sh); restore-test.sh empty stub; postgresql.service stub (up=$([ -e /run/pg-ok ] && echo yes || echo 'NO: the timer job will fail on Requires='))"
L FIXTURE "timer drop-in $TDD/50-r6h-fixture-timing.conf: $(tr '\n' ' ' < $TDD/50-r6h-fixture-timing.conf)(the real timer has RandomizedDelaySec=10min AccuracySec=1min)"
L REAL-SYSTEMD "unit files from deploy/ installed root:root 0644: service $(sha $UNITF) timer $(sha $TIMERF) failed $(sha /etc/systemd/system/afldb-backup-failed.service)"
L REAL-SYSTEMD "callers (unmodified, run from the read-only export): G0 $(sha "$G0") A-2 $(sha "$PRE"); 624bf721 G0 $(sha "$OG0") A-2 $(sha "$OPRE")$([ -f "$BG0" ] && echo "; bda102aa G0 $(sha "$BG0") A-2 $(sha "$BPRE")")"
if [ "$NODESWAP" = 1 ]; then
  install -d -o arm -g arm -m 755 /home/arm/.nvm /home/arm/.nvm/versions /home/arm/.nvm/versions/node /home/arm/.nvm/versions/node/v22.23.2 $NB
  install -o arm -g arm -m 755 $RNODE $NB/node
  L FIXTURE-ATTACK "the gates' pinned node $NB/node is an ARM-OWNED copy of the real node ($(stat -c '%U:%G %a' $NB/node), sha256 $(sha $NB/node)), as on production where arm owns ~/.nvm"
else L FIXTURE "the gates' pinned node $NB/node is the host's node, bind-mounted read-only ($(stat -c '%U:%G %a' $NB/node 2>&1))"; fi

# ------------------------------------------------------------------------------------------------------------------ the protected writer
BUNDLE_OK=1
for f in afldb-backup-attest 60-afldb-backup-attest.conf install-attest.sh verify-attest-install.sh SHA256SUMS; do [ -f "$BUNDLE/$f" ] || BUNDLE_OK=0; done
if [ "$WRITER" = 1 ]; then
  hdr "install the protected writer from a root-owned staging directory (the prospective owner procedure)"
  if [ "$BUNDLE_OK" = 0 ] && [ "$SMOKE" = 1 ] && [ -f "$BUNDLE/afldb-backup-attest" ] && [ -f "$BUNDLE/60-afldb-backup-attest.conf" ]; then
    line "ATTEST BUNDLE INCOMPLETE in $H6/attest ($(ls "$BUNDLE" | tr '\n' ' ')): SMOKE-ONLY manual install of the writer and drop-in"
    line "per DESIGN.md section 6 (NOT the bundle's install-attest.sh; never used outside --smoke)"
    install -d -o root -g root -m 0755 $WD $RD $DID
    install -o root -g root -m 0755 "$BUNDLE/afldb-backup-attest" $W; install -o root -g root -m 0644 "$BUNDLE/60-afldb-backup-attest.conf" $DI
    systemctl daemon-reload; line "writer $(sha $W), drop-in $(sha $DI)"
  elif [ "$BUNDLE_OK" = 0 ]; then
    line "ATTEST BUNDLE ABSENT in $H6/attest ($(ls "$BUNDLE" 2>/dev/null | tr '\n' ' ')): the writer is NOT installed"
    [ "$SMOKE" = 1 ] || { echo "STOP the attest bundle is required outside --smoke"; exit 1; }
    WRITER=0; line "(smoke: continuing without the writer, to exercise the plumbing)"
  else
    install -d -o root -g root -m 0755 $STG
    for f in "$BUNDLE"/*; do [ -f "$f" ] && install -o root -g root -m 0644 "$f" "$STG/${f##*/}"; done
    chmod 755 $STG/*.sh $STG/afldb-backup-attest
    line "staging $STG: $(stat -c '%U:%G %a' $STG); files: $(cd $STG && ls -l | awk 'NR>1{print $1,$3":"$4,$9}' | tr '\n' ';')"
    line "SHA256SUMS check: $(cd $STG && sha256sum -c SHA256SUMS 2>&1 | tr '\n' ' ')"
    (cd / && bash $STG/install-attest.sh $STG) > $OUT/install.out 2>&1; IRC=$?
    line "install-attest.sh $STG (root): exit $IRC"; sed 's/^/   | /' $OUT/install.out
    (cd / && bash $STG/verify-attest-install.sh) > $OUT/verify-root.out 2>&1; VRR=$?
    (cd /home/arm && as_arm bash $STG/verify-attest-install.sh) > $OUT/verify-arm.out 2>&1; VRA=$?
    line "verify-attest-install.sh as root: exit $VRR"; sed 's/^/   | /' $OUT/verify-root.out
    line "verify-attest-install.sh as arm:  exit $VRA"; sed 's/^/   | /' $OUT/verify-arm.out
    [ "$IRC" = 0 ] && [ "$VRR" = 0 ] && [ "$VRA" = 0 ] || { [ "$SMOKE" = 1 ] || { echo "STOP the install procedure did not complete (install $IRC, verify root $VRR, arm $VRA)"; exit 1; }; }
  fi
else
  hdr "NO writer installed (scenario $SC: the prospective drop-in and record directory do not exist)"
fi
if [ "$RESTART" = 1 ]; then
  install -d -o root -g root -m 0755 $DID
  printf '[Service]\nExecStartPre=/bin/sh -c "test -e /run/r6h-restarted || exec /bin/sleep 4"\n' > $DID/10-r6h-fixture-sleep.conf; chmod 644 $DID/10-r6h-fixture-sleep.conf
  L FIXTURE "drop-in $DID/10-r6h-fixture-sleep.conf: $(tr '\n' ' ' < $DID/10-r6h-fixture-sleep.conf)(runs as arm, logs nothing; sleeps in invocation #1 only)"
fi
systemctl daemon-reload

# ------------------------------------------------------------------------------------------------------------------ effective unit, stat
MANI_PATHS=("$W" "$DI" "$RD" "$UNITF" "$TIMERF" "$TDD/50-r6h-fixture-timing.conf" /usr/bin/env /usr/bin/bash /usr/bin/systemctl /usr/bin/busctl
            /usr/bin/sha256sum /usr/bin/timeout /usr/bin/mv /etc/systemd/system/postgresql.service)
manifest() { # every installed path and every parent: type mode owner links size inode mtime (+ sha256 of files); the record dir's entries
  local p q
  { for p in "${MANI_PATHS[@]}"; do q=$p; while :; do [ -e "$q" ] || [ -L "$q" ] && echo "$q"; [ "$q" = / ] && break; q=$(dirname "$q"); done; done
    [ -d $RD ] && find $RD -mindepth 1 -maxdepth 1; [ -d $DID ] && find $DID -mindepth 1 -maxdepth 1; } | sort -u | while read -r p; do
    printf '%s %s\n' "$(stat -c '%F %a %U:%G links=%h size=%s ino=%i mtime=%Y' "$p")" "$p$([ -f "$p" ] && [ ! -L "$p" ] && printf ' sha256=%s' "$(sha "$p")")"
  done; }
hdr "effective unit (REAL-SYSTEMD, as root after daemon-reload)"
systemctl show afldb-backup.service -p FragmentPath -p DropInPaths -p EnvironmentFiles -p ExecStartPostEx -p ExecStart -p User --no-pager | cut -c1-400 | sed 's/^/   service: /'
systemctl show afldb-backup.timer -p FragmentPath -p DropInPaths -p Persistent -p TimersCalendar --no-pager | cut -c1-300 | sed 's/^/   timer: /'
line "stat of every installed path and parent:"; manifest | tee $OUT/manifest-before | sed 's/^/   /'

# ------------------------------------------------------------------------------------------------------------------ arm the timer
B0=$(TZ=Australia/Melbourne date -d "$DAY 02:20" +%s); B1=$(TZ=Australia/Melbourne date -d "$DAY 02:31" +%s)
[ "$B0" = "$TD" ] || line "NOTE the computed 02:20 ($B0) differs from the planned dispatch ($TD) by $((B0 - TD)) s"
if [ "$REARM" = 1 ]; then
  mkdir -p /var/lib/systemd/timers; touch -d "$(date -d "$DAY -1 day" +%F) 02:20:03" /var/lib/systemd/timers/stamp-afldb-backup.timer
  L FIXTURE "timer stamp /var/lib/systemd/timers/stamp-afldb-backup.timer set to the previous night's dispatch: $(stat -c %y /var/lib/systemd/timers/stamp-afldb-backup.timer)"
fi
systemctl start afldb-backup.timer
NX=$(systemctl show afldb-backup.timer -p NextElapseUSecRealtime --value)
L REAL-SYSTEMD "timer armed at $(date '+%T'): next elapse $NX; window $(mel $B0)..$(TZ=Australia/Melbourne date -d @$B1 +%T)"
[ "$(date +%s)" -le $((B0 - 8)) ] || { echo "STOP setup overran: only $((B0 - $(date +%s))) s before the 02:20 dispatch"; exit 1; }

# ------------------------------------------------------------------------------------------------------------------ live capture (root)
rm -f $OUT/poll-stop
poll_live() { # every change of (job, type, state, details, invocation, unit state), with the timer's LastTrigger*, as root
  local prev='' cur j jt js ad inv st
  while [ ! -e $OUT/poll-stop ]; do
    j=$(systemctl show afldb-backup.service -p Job --value 2>/dev/null); inv=$(systemctl show afldb-backup.service -p InvocationID --value 2>/dev/null)
    st=$(systemctl show afldb-backup.service -p ActiveState -p SubState --value 2>/dev/null | tr '\n' '/')
    if [[ $j =~ ^[0-9]+$ ]]; then
      jt=$(bprop /org/freedesktop/systemd1/job/$j org.freedesktop.systemd1.Job JobType)
      js=$(bprop /org/freedesktop/systemd1/job/$j org.freedesktop.systemd1.Job State)
      ad=$(busctl get-property org.freedesktop.systemd1 /org/freedesktop/systemd1/job/$j org.freedesktop.systemd1.Job ActivationDetails 2>&1)
      [[ $jt == *'Unknown object'* ]] && { jt=gone; js=gone; ad='job object gone'; }
    else j=none; jt=-; js=-; ad=-; fi
    cur="job=$j JobType=$jt JobState=$js ActivationDetails=[$ad] InvocationID=${inv:-none} unit=$st"
    if [ "$cur" != "$prev" ]; then
      printf '%s %s timer.LastTriggerUSec=%s LastTriggerUSecMonotonic=%s\n' "$(date '+%T.%N' | cut -c1-12)" "$cur" "$(tprop LastTriggerUSec)" "$(tprop LastTriggerUSecMonotonic)"
      prev=$cur
    fi
    sleep 0.05
  done; }
poll_live > $OUT/live.log 2>&1 & POLLPID=$!

# ------------------------------------------------------------------------------------------------------------------ the dispatch
if [ "$REARM" = 1 ]; then
  until [ "$(date +%s)" -ge $((B0 - 10)) ]; do sleep 0.2; done
  systemctl stop afldb-backup.timer; L FIXTURE "root: systemctl stop afldb-backup.timer at $(date +%T) (before 02:20)"
  until [ "$(date +%s)" -ge $((B0 + 15)) ]; do sleep 0.2; done
  L FIXTURE "the 02:20 elapse passed with the timer stopped; LastTriggerUSec now $(tprop LastTriggerUSec); service jobs: $(systemctl show afldb-backup.service -p Job --value)"
  systemctl start afldb-backup.timer; L FIXTURE "root: systemctl start afldb-backup.timer at $(date +%T) (re-arm inside the window)"
fi
WANT_FROM=$((B0 * 1000000)); LT=0
for i in $(seq 1 2500); do LT=$(tprop LastTriggerUSec); [[ $LT =~ ^[0-9]+$ ]] && [ "$LT" -ge "$WANT_FROM" ] && break; sleep 0.1; done
[[ $LT =~ ^[0-9]+$ ]] && [ "$LT" -ge "$WANT_FROM" ] || { touch $OUT/poll-stop; echo "STOP no dispatch inside the window (LastTriggerUSec=$LT, window from $WANT_FROM)"; exit 1; }
L REAL-SYSTEMD "DISPATCH: LastTriggerUSec $LT = $(mel $((LT / 1000000))) + $((LT % 1000000)) us; LastTriggerUSecMonotonic $(tprop LastTriggerUSecMonotonic)"
if [ "$HIDDEN" = 1 ]; then
  until [ "$(now_us)" -ge $((LT + 3000000)) ]; do sleep 0.05; done
  L REAL-SYSTEMD "the timer's own job: service $(systemctl show afldb-backup.service -p ActiveState -p Result -p InvocationID | tr '\n' ' ')"
  touch /run/pg-ok; systemctl start postgresql.service; L FIXTURE "root fixed the stub dependency (postgresql.service up)"
  L FIXTURE "root: systemctl start afldb-backup.service at +$(( ($(now_us) - LT) / 1000 )) ms after the dispatch"
  systemctl start afldb-backup.service; line "   systemctl start returned $?"
fi
if [ "$RESTART" = 1 ]; then
  until [ "$(now_us)" -ge $((LT + 1500000)) ]; do sleep 0.05; done
  L REAL-SYSTEMD "before the restart: job $(systemctl show afldb-backup.service -p Job --value) InvocationID $(systemctl show afldb-backup.service -p InvocationID --value) $(systemctl show afldb-backup.service -p ActiveState -p SubState | tr '\n' ' ')"
  touch /run/r6h-restarted
  L FIXTURE "root: systemctl restart afldb-backup.service at +$(( ($(now_us) - LT) / 1000 )) ms (during invocation #1's ExecStartPre sleep)"
  systemctl restart afldb-backup.service; line "   systemctl restart returned $?"
fi
for i in $(seq 1 600); do st=$(systemctl is-active afldb-backup.service); j=$(systemctl show afldb-backup.service -p Job --value)
  [ "$st" != active ] && [ "$st" != activating ] && [ -z "$j" ] && break; sleep 0.2; done
sleep 7   # journald receipt, and the gates' allowance after the exit
touch $OUT/poll-stop; wait $POLLPID 2>/dev/null
hdr "LIVE capture while the job existed (REAL-SYSTEMD, root; one line per change)"; sed 's/^/   /' $OUT/live.log | cut -c1-800

# ------------------------------------------------------------------------------------------------------------------ raw evidence
jsum() { "$RNODE" -e '
  const rl = require("readline").createInterface({ input: process.stdin });
  rl.on("line", l => { try { const e = JSON.parse(l); const m = Array.isArray(e.MESSAGE) ? "[binary]" : String(e.MESSAGE);
    console.log([new Date(Number(e.__REALTIME_TIMESTAMP) / 1000).toISOString(), "pid=" + e._PID, "uid=" + e._UID,
      "INVOCATION_ID=" + (e.INVOCATION_ID || "-"), "_SYSTEMD_INVOCATION_ID=" + (e._SYSTEMD_INVOCATION_ID || "-"), m.slice(0, 200)].join(" ")); } catch (x) {} });'; }
hdr "after the run (REAL-SYSTEMD)"
line "timer: LastTriggerUSec=$(tprop LastTriggerUSec) LastTriggerUSecMonotonic=$(tprop LastTriggerUSecMonotonic) ActiveEnterTimestampMonotonic=$(bprop $TOBJ org.freedesktop.systemd1.Unit ActiveEnterTimestampMonotonic) Result=$(systemctl show afldb-backup.timer -p Result --value)"
SINV=$(systemctl show afldb-backup.service -p InvocationID --value)
line "service: $(systemctl show afldb-backup.service -p InvocationID -p Result -p ExecMainStatus -p ExecMainCode -p ActiveState -p InactiveEnterTimestampMonotonic -p InactiveExitTimestampMonotonic -p ExecMainStartTimestampMonotonic -p NRestarts | tr '\n' ' ')"
line "root's journal for the service, timer and stub dependency (PID 1 lines included; arm cannot read PID 1's):"
journalctl -u afldb-backup.service -u afldb-backup.timer -u postgresql.service -u afldb-backup-failed.service -o json --no-pager -q | jsum | sed 's/^/   root| /'
line "arm's journal for afldb-backup.service:"
as_arm journalctl -u afldb-backup.service -o json --no-pager -q | jsum | sed 's/^/   arm | /'
line "invocation IDs, root view: $(journalctl -u afldb-backup.service -o json --no-pager -q | grep -o '"\(_SYSTEMD_\)\{0,1\}INVOCATION_ID":"[0-9a-f]*"' | sort | uniq -c | tr -s ' ' | tr '\n' ';')"
line "invocation IDs, arm view:  $(as_arm journalctl -u afldb-backup.service -o json --no-pager -q | grep -o '"\(_SYSTEMD_\)\{0,1\}INVOCATION_ID":"[0-9a-f]*"' | sort | uniq -c | tr -s ' ' | tr '\n' ';')"
line "the successful InvocationID (service, after the run): $SINV"
hdr "dump, sidecar, digest"
ls -la --time-style=+%T "$BKD" | sed 's/^/   /'
mapfile -t DUMPS < <(ls -1 "$BKD"/*.dump 2>/dev/null)
EXPN=''; EXPS=''
if [ ${#DUMPS[@]} = 1 ]; then EXPN=${DUMPS[0]##*/}; EXPS=$(sha "${DUMPS[0]}")
  L REAL-SYSTEMD "dump $EXPN $(stat -c %s "${DUMPS[0]}") B sha256 $EXPS; sidecar: $(cat "${DUMPS[0]}.sha256" 2>&1)"
  [ "$(cut -d' ' -f1 "${DUMPS[0]}.sha256" 2>/dev/null)" = "$EXPS" ] && line "   sidecar = re-hash" || line "   sidecar DIFFERS from the re-hash"
else line "dumps: ${#DUMPS[@]} ($(printf '%s ' "${DUMPS[@]##*/}")): no single expected dump"; fi
if [ "$OFFHOST" = 1 ] && [ -n "$EXPN" ]; then
  install -d -o arm -g arm -m 755 /home/arm/offhost-copy
  as_arm cp -p "$BKD/$EXPN" "$BKD/$EXPN.sha256" /home/arm/offhost-copy/ && L FIXTURE "a later successful off-host copy: /home/arm/offhost-copy/ holds $(ls /home/arm/offhost-copy | tr '\n' ' ')(callers never read it)"
fi

# ------------------------------------------------------------------------------------------------------------------ the record(s)
check_record() { # file: the DESIGN section 4 item-4 predicates, HARNESS-computed, against the gate-time LastTriggerUSec
  local f=$1 k v lt; declare -A R=()
  while IFS='=' read -r k v; do [ -n "$k" ] && R[$k]=$v; done < <(tail -n +2 "$f")
  lt=$(tprop LastTriggerUSec)
  n() { [[ ${R[$1]:-} =~ ^[0-9]+$ ]]; }
  p() { printf '   [HARNESS] %-72s %s\n' "$1" "$([ "$2" = 0 ] && echo holds || echo FAILS)"; }
  RECFMT=$(head -1 "$f")
  p "line 1 = afldb-backup-attest/1 or /2 ($RECFMT)" "$([[ $RECFMT =~ ^afldb-backup-attest/[12]$ ]]; echo $?)"
  if [ -n "${R[dump]+x}" ] || [ -n "${R[dump_sha256]+x}" ] || [ "$RECFMT" = afldb-backup-attest/2 ]; then
    p "dump = the attested run's dump (${R[dump]:-?} vs ${EXPN:-none})" "$([ -n "$EXPN" ] && [ "${R[dump]:-}" = "$EXPN" ]; echo $?)"
    p "dump_sha256 = its re-hash (${R[dump_sha256]:-?})" "$([ -n "$EXPS" ] && [ "${R[dump_sha256]:-}" = "$EXPS" ]; echo $?)"
    if [ -n "$EXPN" ] && [ "${R[dump]:-}" = "$EXPN" ] && [ "${R[dump_sha256]:-}" = "$EXPS" ]; then RECDUMP=bound-correct
    else RECDUMP="bound-WRONG(${R[dump]:-?} ${R[dump_sha256]:-?})"; fi
  else line "   [HARNESS] record carries no dump= / dump_sha256= ($RECFMT): the dump is NOT bound by the record"; RECDUMP=not-bound; fi
  p "invocation = the successful InvocationID ($SINV)" "$([ "${R[invocation]:-}" = "$SINV" ]; echo $?)"
  p "job_type=start (${R[job_type]:-?})" "$([ "${R[job_type]:-}" = start ]; echo $?)"
  p "active_state=activating sub_state=start-post (${R[active_state]:-?}/${R[sub_state]:-?})" "$([ "${R[active_state]:-}/${R[sub_state]:-}" = activating/start-post ]; echo $?)"
  p "exec_main_code=1 exec_main_status=0 (${R[exec_main_code]:-?}/${R[exec_main_status]:-?})" "$([ "${R[exec_main_code]:-}/${R[exec_main_status]:-}" = 1/0 ]; echo $?)"
  p "trigger_unit=afldb-backup.timer (${R[trigger_unit]:-?})" "$([ "${R[trigger_unit]:-}" = afldb-backup.timer ]; echo $?)"
  p "trigger_timer_realtime_usec = timer_last_trigger_usec = gate-time LastTriggerUSec $lt" "$([ "${R[trigger_timer_realtime_usec]:-}" = "$lt" ] && [ "${R[timer_last_trigger_usec]:-}" = "$lt" ]; echo $?)"
  if n inactive_enter_mono && n timer_last_trigger_mono && n inactive_exit_mono && n exec_main_start_mono; then
    p "inactive_enter_mono ${R[inactive_enter_mono]} < timer_last_trigger_mono ${R[timer_last_trigger_mono]}" "$(( R[inactive_enter_mono] < R[timer_last_trigger_mono] ? 0 : 1 ))"
    p "timer_last_trigger_mono <= inactive_exit_mono ${R[inactive_exit_mono]}" "$(( R[timer_last_trigger_mono] <= R[inactive_exit_mono] ? 0 : 1 ))"
    p "timer_last_trigger_mono <= exec_main_start_mono ${R[exec_main_start_mono]}" "$(( R[timer_last_trigger_mono] <= R[exec_main_start_mono] ? 0 : 1 ))"
    p "inactive_exit_mono - timer_last_trigger_mono = $(( R[inactive_exit_mono] - R[timer_last_trigger_mono] )) us <= 5000000" "$(( R[inactive_exit_mono] - R[timer_last_trigger_mono] <= 5000000 ? 0 : 1 ))"
    line "   [HARNESS] info: order of the two stamps (not a rule): exec_main_start_mono - inactive_exit_mono = $(( R[exec_main_start_mono] - R[inactive_exit_mono] )) us"
    p "exec_main_start_mono - timer_last_trigger_mono = $(( R[exec_main_start_mono] - R[timer_last_trigger_mono] )) us <= 5000000" "$(( R[exec_main_start_mono] - R[timer_last_trigger_mono] <= 5000000 ? 0 : 1 ))"
  else p "monotonic fields numeric" 1; fi
  n timer_last_trigger_mono && n timer_active_enter_mono && line "   [HARNESS] information: dispatch $(( (R[timer_last_trigger_mono] - R[timer_active_enter_mono]) / 1000 )) ms after the timer unit's last (re)activation"
  p "writer_sha256 = sha256 of the installed writer" "$([ -f $W ] && [ "${R[writer_sha256]:-}" = "$(sha $W)" ]; echo $?)"
}
RECDUMP=none; RECFMT=none
hdr "protected record(s) ($RD)"
if [ -d $RD ]; then
  for f in $RD/* $RD/.[!.]*; do [ -e "$f" ] || continue
    L REAL-SYSTEMD "record $f: $(stat -c '%F %a %U:%G links=%h size=%s' "$f")"; sed 's/^/   | /' "$f"; [ -f "$f" ] && check_record "$f"; done
  [ -n "$(ls -A $RD)" ] || line "   (empty: the writer wrote no record)"
else line "   (no record directory)"; fi
REC=$(ls -1 $RD/*.attest 2>/dev/null | head -1)
[ "$POST" != none ] && [ -z "$REC" ] && { line "NO RECORD to damage (post=$POST not applied)"; POST=none; }
case $POST in
  rm)    rm -f "$REC" && L FIXTURE "root removed the record $REC (damage simulation)";;
  plant) FAKEI=$(head -c 16 /dev/urandom | od -An -tx1 | tr -d ' \n'); sed "s/^invocation=.*/invocation=$FAKEI/" "$REC" > $RD/.$FAKEI.tmp && chmod 644 $RD/.$FAKEI.tmp \
           && mv $RD/.$FAKEI.tmp $RD/$FAKEI.attest && L FIXTURE "root planted $RD/$FAKEI.attest: a copy of the record with invocation=$FAKEI and the same trigger_timer_realtime_usec $(grep ^trigger_timer_realtime_usec= "$REC" | cut -d= -f2)";;
  chmod) chmod g+w "$REC" && L FIXTURE "root made the record group-writable: $(stat -c '%a %U:%G' "$REC") $REC";;
esac
[ "$POST" = none ] || { line "record directory now:"; ls -la $RD 2>&1 | sed 's/^/   /'; }

# ------------------------------------------------------------------------------------------------------------------ the callers
run_caller() { # tag script args... : verbatim stdout, stderr, exit into the log and $OUT/<tag>.{out,err,rc}
  local tag=$1; shift
  (cd /home/arm && as_arm bash "$@") > $OUT/$tag.out 2> $OUT/$tag.err; echo $? > $OUT/$tag.rc
  hdr "CALLER $tag: as arm (uid 1000, no supplementary groups, env -i): bash ${*##$FIX/}"
  line "exit status: $(cat $OUT/$tag.rc)"
  line "----- BEGIN $tag stdout (verbatim) -----"; cat $OUT/$tag.out; line "----- END $tag stdout -----"
  line "----- BEGIN $tag stderr (verbatim) -----"; cat $OUT/$tag.err; line "----- END $tag stderr -----"
}
judge() { # file -> J: attributed-correct | attributed-WRONG(...) | refused | refused-BUT-OFFHOST-PRINTED | other(...)
  local f=$1 oc ol be
  oc=$(grep -c '^OFFHOST-COMPARE ' "$f"); ol=$(grep '^OFFHOST-COMPARE ' "$f" | head -1); be=$(grep '^BACKUP-EVIDENCE ' "$f" | head -1)
  if grep -q 'scheduled origin unproven' "$f"; then
    [ "$oc" = 0 ] && J=refused || J="refused-BUT-OFFHOST-PRINTED($oc)"
  elif [ "$oc" = 1 ]; then
    if [ -n "$EXPN" ] && [ "$ol" = "OFFHOST-COMPARE $EXPN $EXPS" ] && [[ $be == *"$EXPN"* ]] && [[ $be == *"${EXPS:0:16}"* ]] && [[ $be == *"$SINV"* ]]; then J=attributed-correct
    else J="attributed-WRONG(offhost='$ol' evidence='$be' expected '$EXPN $EXPS' invocation $SINV)"; fi
  else J="other(OFFHOST-COMPARE lines $oc; no 'scheduled origin unproven')"; fi
}
report_callers() { # tagG0 tagA2 label
  local g=$1 a=$2 lab=$3 s5o
  awk '/^-- 5\./{s=1} /^-- 6\./{s=0} s' $OUT/$a.out > $OUT/$a.s5
  awk '/^-- 5\./{s=1} /^-- 6\./{s=0} !s && /^FAIL /' $OUT/$a.out > $OUT/$a.unrelated
  s5o='afldb-backup.service scheduled run|scheduled origin unproven|^BACKUP-EVIDENCE|^OFFHOST-COMPARE|02:2x dump|scheduled dump|dump not attributable'
  grep -vE "$s5o" $OUT/$a.s5 | grep '^FAIL ' > $OUT/$a.s5other
  judge $OUT/$g.out; JG=$J; judge $OUT/$a.s5; JA=$J
  OA=$(grep -c '^OFFHOST-COMPARE ' $OUT/$a.out); OS5=$(grep -c '^OFFHOST-COMPARE ' $OUT/$a.s5)
  hdr "judgement of the callers ($lab) [HARNESS]"
  line "RESULT-G0 ($lab): exit $(cat $OUT/$g.rc); result line: '$(grep '^G0 PROD RESULT' $OUT/$g.out | head -1)'; origin: $JG"
  line "   G0 origin lines: $(grep -E '^(PASS|FAIL) afldb-backup.service scheduled run|^BACKUP-EVIDENCE|^OFFHOST-COMPARE|^INFO .*(timer|dispatch|activat)' $OUT/$g.out | cut -c1-400 | tr '\n' '|')"
  line "RESULT-A2 ($lab) whole caller: exit $(cat $OUT/$a.rc); result line: '$(grep '^R6 PRE RESULT' $OUT/$a.out | head -1)'"
  line "RESULT-A2-S5 ($lab) section 5 backup origin: $JA (OFFHOST-COMPARE lines: section 5 $OS5, whole output $OA)"
  line "   section 5 origin lines: $(grep -E "$s5o|^INFO .*(timer|dispatch|activat)" $OUT/$a.s5 | cut -c1-400 | tr '\n' '|')"
  line "RESULT-A2-UNRELATED ($lab): $(wc -l < $OUT/$a.unrelated) FAIL line(s) outside section 5; $(wc -l < $OUT/$a.s5other) FAIL line(s) inside section 5 not about the backup origin (restore/ledger/status: no database here)"
  sed 's/^/   outside-s5: /' $OUT/$a.unrelated | cut -c1-300; sed 's/^/   inside-s5-not-origin: /' $OUT/$a.s5other | cut -c1-300
}
GENN=$EXPN; GENS=$EXPS
if [ "$NODESWAP" = 1 ]; then
  hdr "FIXTURE-ATTACK arm-node-swap (review MED-1): every step as arm (uid 1000, no groups, env -i); the root record is not touched"
  REC0=$(ls -1 $RD/*.attest 2>/dev/null | head -1); line "root record before: ${REC0:-none} sha256 $([ -n "$REC0" ] && sha "$REC0")"
  FN=afldb_prod-$DAYC-022130.dump
  cat > /tmp/r6h-node-wrapper <<'EOW'
#!/bin/bash
# arm's wrapper at the gates' pinned node path: run the real node (arm's own copy), rewrite the 'backup ok' line to name the planted dump.
read -r FN FH FB < /home/arm/.fake
/home/arm/.nvm/versions/node/v22.23.2/bin/node.real "$@" | sed -E "s/(scheduled-backup: backup ok: )[^ ]+ [0-9]+ bytes sha256 [0-9a-f]{16}/\1$FN $FB bytes sha256 $FH/"
exit ${PIPESTATUS[0]}
EOW
  cat > /tmp/r6h-arm-attack.sh <<'EOA'
set -e; BK=$1; FN=$2; NB=$3
printf 'arm-made bytes: this dump was NOT written by the timer-dispatched run\n' > "$BK/$FN"
H=$(sha256sum < "$BK/$FN" | cut -c1-64); (cd "$BK" && sha256sum "$FN" > "$FN.sha256"); chmod 600 "$BK/$FN.sha256"
for f in "$BK"/afldb_prod-*.dump; do [ "${f##*/}" = "$FN" ] || rm -f "$f" "$f.sha256"; done
printf '%s %s %s\n' "$FN" "${H:0:16}" "$(stat -c %s "$BK/$FN")" > /home/arm/.fake
mv "$NB/node" "$NB/node.real"; cp /tmp/r6h-node-wrapper "$NB/node"; chmod 755 "$NB/node"
EOA
  chmod 644 /tmp/r6h-node-wrapper /tmp/r6h-arm-attack.sh
  if as_arm bash /tmp/r6h-arm-attack.sh "$BKD" "$FN" "$NB"; then
    L FIXTURE-ATTACK "as arm: the timer's dump $GENN deleted, $FN planted with its own sidecar, $NB/node replaced by the rewriting wrapper (real node kept as node.real)"
  else echo "STOP the arm attack steps failed"; exit 1; fi
  ls -la --time-style=+%T "$BKD" | sed 's/^/   /'; line "wrapper $NB/node: $(stat -c '%U:%G %a' $NB/node)"; sed 's/^/   | /' $NB/node
  line "root record after: ${REC0:-none} sha256 $([ -n "$REC0" ] && sha "$REC0") (unchanged = genuine)"
  EXPN=$FN; EXPS=$(sha "$BKD/$FN")
  L FIXTURE-ATTACK "judgement target from here on: the PLANTED dump $EXPN $EXPS (a caller attributing it is the MED-1 bypass); the genuine dump was $GENN $GENS"
fi
run_caller G0 "$G0" "$DAY"
run_caller A2 "$PRE" "${A2ARGS[@]}"
report_callers G0 A2 "callers under test"
if [ "$CONTRAST" != 0 ]; then
  case $CONTRAST in 624bf721) CG0=$OG0; CPRE=$OPRE;; bda102aa) CG0=$BG0; CPRE=$BPRE;; esac
  [ -f "$CG0" ] && [ -f "$CPRE" ] || { echo "STOP contrast $CONTRAST gates are not in the export"; exit 1; }
  run_caller G0-$CONTRAST "$CG0" "$DAY"; run_caller A2-$CONTRAST "$CPRE" "${A2ARGS[@]}"
  report_callers G0-$CONTRAST A2-$CONTRAST "CONTRAST $CONTRAST"
  CG=$JG; CA=$JA; CGRC=$(cat $OUT/G0-$CONTRAST.rc)
  judge $OUT/G0.out; JG=$J; judge $OUT/A2.s5; JA=$J   # restore the judgement of the callers under test
fi
GRC=$(cat $OUT/G0.rc)

# ------------------------------------------------------------------------------------------------------------------ arm cannot replace
SUITE_BAD=0
if [ "$SUITE" = 1 ]; then
  hdr "arm cannot replace: every attempt as arm (uid 1000, no groups, env -i) must fail and leave the manifest unchanged"
  cat > /home/arm/arm-editor.sh <<'EOF'
#!/bin/sh
for f; do printf '[Service]\nExecStartPost=\nExecStartPost=/bin/true\n' > "$f"; done
EOF
  chown arm:arm /home/arm/arm-editor.sh; chmod 755 /home/arm/arm-editor.sh
  as_arm sh -c 'printf "#!/bin/sh\nexit 0\n" > /home/arm/arm-file; printf "[Service]\nExecStartPost=\n" > /home/arm/arm-dropin.conf'
  REC=$(ls -1 $RD/*.attest 2>/dev/null | head -1); [ -n "$REC" ] || REC=$RD/NO-RECORD.attest
  manifest > $OUT/manifest-presuite; line "   manifest before the suite: $(wc -l < $OUT/manifest-presuite) entries"
  try() { # description, shell command run as arm
    local d=$1 c=$2 out rc
    out=$(cd /home/arm && as_arm env SYSTEMD_EDITOR=/home/arm/arm-editor.sh bash -c "$c" < /dev/null 2>&1); rc=$?
    if [ "$rc" != 0 ]; then printf '   REFUSED  rc=%-3s %-58s %s\n' "$rc" "$d" "$(tr '\n' ' ' <<< "$out" | cut -c1-150)"
    else printf '   FINDING  rc=0   %-58s %s\n' "$d" "$(tr '\n' ' ' <<< "$out" | cut -c1-150)"; SUITE_BAD=$((SUITE_BAD + 1)); fi; }
  tgt() { [ -e "$1" ] || [ -L "$1" ] || { printf '   ABSENT   %s (not tested: the path does not exist)\n' "$1"; return 1; }; }
  for p in "$W" "$DI" "$UNITF" "$REC"; do
    tgt "$p" || continue
    try "write (append) $p" "printf x >> '$p'"
    try "truncate $p" "truncate -s 0 '$p'"
    try "rename $p" "mv '$p' '$p.arm'"
    try "delete $p" "rm -f '$p'"
    try "chmod 666 $p" "chmod 666 '$p'"
    try "replace $p (rename arm's file over it)" "cp /home/arm/arm-file /tmp/r6h-x && mv -f /tmp/r6h-x '$p'"
  done
  if tgt "$REC"; then try "hardlink the record into ~arm" "ln '$REC' /home/arm/rec-hardlink"; fi
  for d in "$WD" "$DID" "$RD"; do
    tgt "$d" || continue
    try "create a file in $d" "touch '$d/arm-planted'"
    try "create a symlink in $d" "ln -s /home/arm/arm-file '$d/arm-link'"
    try "rename $d" "mv '$d' '$d.arm'"
    try "delete $d" "rm -rf '$d'"
    try "chmod 777 $d" "chmod 777 '$d'"
  done
  tgt "$RD" && try "create a record-named file in $RD" "cp /home/arm/arm-file '$RD/00000000000000000000000000000000.attest'"
  try "new drop-in dir under /etc/systemd/system" "mkdir /etc/systemd/system/afldb-backup.service.d.arm"
  try "runtime drop-in under /run/systemd/system" "mkdir -p /run/systemd/system/afldb-backup.service.d && cp /home/arm/arm-dropin.conf /run/systemd/system/afldb-backup.service.d/"
  try "control drop-in under /etc/systemd/system.control" "mkdir -p /etc/systemd/system.control/afldb-backup.service.d && cp /home/arm/arm-dropin.conf /etc/systemd/system.control/afldb-backup.service.d/"
  # systemctl edit refuses without a tty before it touches anything; script(1) gives it a pty so the write itself is attempted.
  try "systemctl edit (drop-in, on a pty)" "script -qec 'systemctl edit --no-ask-password --drop-in=99-arm afldb-backup.service' /dev/null"
  try "systemctl edit --runtime (on a pty)" "script -qec 'systemctl edit --no-ask-password --runtime afldb-backup.service' /dev/null"
  try "systemctl set-property" "systemctl set-property --no-ask-password afldb-backup.service CPUWeight=1"
  try "systemctl set-property --runtime" "systemctl set-property --no-ask-password --runtime afldb-backup.service CPUWeight=1"
  try "systemctl daemon-reload" "systemctl daemon-reload --no-ask-password"
  try "systemctl revert" "systemctl revert --no-ask-password afldb-backup.service"
  try "systemctl start afldb-backup.service (arm's own start)" "systemctl start --no-ask-password afldb-backup.service"
  try "systemctl restart afldb-backup.timer (arm's own re-arm)" "systemctl restart --no-ask-password afldb-backup.timer"
  try "busctl StartUnit" "busctl call org.freedesktop.systemd1 /org/freedesktop/systemd1 org.freedesktop.systemd1.Manager StartUnit ss afldb-backup.service replace"
  try "busctl SetUnitProperties" "busctl call org.freedesktop.systemd1 /org/freedesktop/systemd1 org.freedesktop.systemd1.Manager SetUnitProperties sba\(sv\) afldb-backup.service true 1 CPUWeight t 1"
  manifest > $OUT/manifest-after
  if diff $OUT/manifest-presuite $OUT/manifest-after > /dev/null; then
    line "   manifest of every installed path, parent and record (taken before the suite, compared after): UNCHANGED"
  else line "   FINDING manifest changed:"; diff $OUT/manifest-presuite $OUT/manifest-after | sed 's/^/     /'; SUITE_BAD=$((SUITE_BAD + 1)); fi
  line "   record directory after the suite:"; ls -la $RD 2>&1 | sed 's/^/     /'
  [ -z "$(find /home/arm -maxdepth 1 -name 'rec-hardlink' 2>/dev/null)" ] || { line "   FINDING /home/arm/rec-hardlink exists"; SUITE_BAD=$((SUITE_BAD + 1)); }
  line "   effective unit after: $(systemctl show afldb-backup.service -p DropInPaths -p ExecStartPostEx --no-pager | tr '\n' ' ' | cut -c1-400)"
  line "   jobs after: $(systemctl list-jobs --no-legend --no-pager | tr '\n' ';')"
  if [ -f $STG/verify-attest-install.sh ]; then
    (cd / && bash $STG/verify-attest-install.sh) > $OUT/verify-root2.out 2>&1; line "   verify-attest-install.sh as root after the suite: exit $?"
    (cd /home/arm && as_arm bash $STG/verify-attest-install.sh) > $OUT/verify-arm2.out 2>&1; line "   verify-attest-install.sh as arm after the suite: exit $?"
  fi
  line "RESULT-ARM-SUITE: $SUITE_BAD finding(s)"
fi

# ------------------------------------------------------------------------------------------------------------------ verdict
hdr "verdict [HARNESS]"
bad=0
case $EXPECT in
  attributed)
    line "RESULT-RECORD-DUMP $SC: record $RECFMT, dump binding $RECDUMP"
    # A /2 record must bind the run's own dump; a /1 record (no binding) is reported, not failed, so the 297175f9 bundle stays comparable.
    if [ "$GRC" = 0 ] && grep -q '^G0 PROD RESULT PASS' $OUT/G0.out && [ "$JG" = attributed-correct ] && [ "$JA" = attributed-correct ] && [ "$SUITE_BAD" = 0 ] \
       && { [ "$RECDUMP" = bound-correct ] || [ "$RECDUMP" = not-bound ]; }; then
      line "VERDICT $SC: AS EXPECTED. G0 exit 0 'G0 PROD RESULT PASS' with its own OFFHOST-COMPARE = $EXPN $EXPS; A-2 section 5 attributed with its own BACKUP-EVIDENCE and OFFHOST-COMPARE correct; A-2 whole caller exit $(cat $OUT/A2.rc) for $(wc -l < $OUT/A2.unrelated)+$(wc -l < $OUT/A2.s5other) unrelated FAIL line(s) (NOT a full A-2 PASS); arm suite 0 findings; record dump binding: $RECDUMP"
    else line "VERDICT $SC: NOT AS EXPECTED (G0 exit $GRC origin $JG; A-2 section 5 $JA; arm suite findings $SUITE_BAD; record dump binding $RECDUMP)"; bad=1; fi;;
  refused)
    if [ "$GRC" != 0 ] && [ "$JG" = refused ] && [ "$JA" = refused ] && [ "$(grep -c '^OFFHOST-COMPARE ' $OUT/A2.out)" = 0 ]; then
      line "VERDICT $SC: AS EXPECTED. both callers 'scheduled origin unproven', no OFFHOST-COMPARE (G0 exit $GRC, A-2 exit $(cat $OUT/A2.rc))"
    else
      case $JG$JA in *attributed*) line "FINDING $SC: a caller attributed a run that must be refused (G0 $JG, A-2 section 5 $JA)";; esac
      line "VERDICT $SC: NOT AS EXPECTED (G0 exit $GRC origin $JG; A-2 section 5 $JA)"; bad=1; fi;;
  record)
    line "VERDICT $SC: RECORDED (no policy expectation). G0 exit $GRC origin $JG; A-2 section 5 $JA; this proves the timer UNIT dispatched the run (re-armed by root inside the window, Persistent= catch-up), not that the calendar elapsed unattended";;
esac
if [ "$CONTRAST" != 0 ]; then
  case $CONTRAST in 624bf721) what='the forged run (the r5 defect, on real systemd)';; *) what="arm's PLANTED dump $EXPN (review MED-1, on real systemd)";; esac
  [ "$CGRC" = 0 ] && [ "$CG" = attributed-correct ] && [ "$CA" = attributed-correct ] \
    && line "CONTRAST $SC: the $CONTRAST G0 exits 0 and its A-2 section 5 attributes $what, each with OFFHOST-COMPARE" \
    || line "CONTRAST $SC: the $CONTRAST gates did NOT pass $what (G0 exit $CGRC $CG; A-2 section 5 $CA)"
fi
exit $bad
