#!/usr/bin/env bash
# REHEARSAL ONLY (R6 r4, 27 Nov 2026). Shared fixture for suites f2 (scheduled backup attribution, gates G0 and A-2) and f3
# (A-2 / F-2 identity). Sourced by cases/f2-backup-attribution.sh and cases/f3-identity.sh; it does nothing when executed.
# Adapted from review-fixes-r3-20261124/in-container.sh (same shims, same host files), with these differences:
#   systemctl  LastTriggerUSec is always rendered as a date string in $TZ (systemd 255 ignores --timestamp=unix for it);
#              /fx/inv-mode and /fx/binv-mode change ONLY the single-property InvocationID read of afldb / afldb-backup.service
#              (fail|empty|malformed|multi|upper, and for afldb flip1|flip2: the first and later reads differ); every such read of
#              afldb is counted in /fx/inv-calls;
#   journalctl afldb-backup.service: -o json prints /fx/journal-backup.json, -o cat (the aa33f0fc scripts) prints the same
#              entries' MESSAGE text from /fx/journal-backup.txt; /fx/journal-mode = fail makes the query exit 1. The shim does
#              not filter by --since/--until: a fixture holds only entries of the window it describes;
#   the afldb service is a process tree owned by arm (a primary with two children carrying AFLDB_WORKER_ID, cwd = the release),
#   and deploy/release.mjs in the fixture checkout is a stub that prints /fx/stub-out and exits /fx/stub-rc (as r3 section S);
#   awk /proc/uptime, pg_isready and curl are shims so that F-2 (r6-post-verify.sh full) can pass in a container.
# R6 r5 (27 Nov 2026): the genuine state now carries the TRIGGER line the prospective scheduled-backup.sh writes (journal line
#   "trigger: invocation=<id> job=<n> unit=afldb-backup.timer realtime_usec=<n>" of the timer's invocation; unit=none for a start by
#   hand), and a fixture busctl prints the timer's LastTriggerUSec in microseconds ("t <n>", from the table row LastTriggerUSecRaw,
#   else seconds x 1e6; /fx/busctl-mode = fail|garbage|empty changes the read). F23_SCRIPT=current writes NO trigger line
#   at all: what today's production scheduled-backup.sh logs.
# R6 r6 (28 Nov 2026): the r5 trigger line is WITHDRAWN as origin evidence (the gates no longer read it), and scheduled-backup.sh is
#   back to the production bytes, so F23_SCRIPT now defaults to `current` (no trigger line); f23_trigger_line still writes the old
#   line when a scenario asks for it (it must count toward nothing). Origin now comes from the ROOT writer's record: f23_attest_install
#   puts the REAL reviewed writer and drop-in (review-fixes-r6-20261128/attest/ of <FIX>) and copies of the real unit files at their
#   real paths, root:root, plus root-owned placeholders for /usr/bin/systemctl and /usr/bin/busctl where the image lacks them (never
#   executed: the gates run the /usr/local/bin shims); the systemctl table gains the unit's FragmentPath, DropInPaths and
#   ExecStartPostEx rows in systemd 255's exact format (measured: review-fixes-r6-20261128/logs/attest-probe-*.log), /fx/espx
#   replaces the ExecStartPostEx output verbatim (two entries); f23_attest_record writes a record in the writer's exact format
#   (root:root 0644). Every scenario starts from f23_attest_reset (the trusted install, an empty record directory). Root-owned
#   trust cannot be shimmed: these are real files with real owners and modes, and the gates run as arm.
# Must run as root inside a disposable container whose hostname is afldb-prod (the scripts' host guard is never weakened);
# creates the users arm (uid 1000) and files at the absolute paths the gates read. Nothing here edits a script under test.
#
# Reusable by the ported r3 suite (in-container.sh), which keeps its own shims: f23_backup_rows and f23_backup_json print
# exactly what A-2 section 5 now needs for the 02:20 backup (see the hand-over notes of this round).
set -uo pipefail; export LC_ALL=C
F23_NODE=/home/arm/.nvm/versions/node/v22.23.2/bin/node
F23_CHK=/home/arm/projects/afldb; F23_ROOT=/home/arm/afldb-releases; F23_BK=/home/arm/backups/afldb-scheduled
F23_CUR=17822b29e6de-R6fixRehearsalBuild01x; F23_PREV=7d92042fd110-XWruOm_9nLCSMY8nGPqYU
F23_DAY=2026-11-25; F23_DAYC=20261125
F23_INV_TUE=3f1e5a0c9b7d4e2f8a6c1b0d9e8f7a6b      # the owner-attested Tuesday restart of the fixture (afldb InvocationID before the reboot)
F23_INV_NEW=6c5d4e3f2a1b40718a9b0c1d2e3f4a5b      # afldb InvocationID after the reboot (F-2)
F23_INV_OTHER=9a8b7c6d5e4f30211203f4e5d6c7b8a9    # a restart nobody attested
F23_BINV=b1b2b3b4b5b6b7b8b9b0babbbcbdbebf        # afldb-backup.service: the timer's invocation
F23_BINV2=c1c2c3c4c5c6c7c8c9c0cacbcccdcecf       # afldb-backup.service: an invocation started by hand
F23_VINV=0d1c2b3a4f5e60718293a4b5c6d7e8f9        # afldb-backup-verify.service: the 03:30 run
F23_SPID=
F23_SCRIPT=${F23_SCRIPT:-current}                  # current = production's scheduled-backup.sh (no trigger line); r5 = the withdrawn r5 script
F23_TRIG_US=                                       # the genuine dispatch in microseconds (set by f23_backup_genuine)

f23_ep() { TZ=Australia/Melbourne /usr/bin/date -d "$1" +%s; }
f23_as_arm() { setpriv --reuid=arm --regid=arm --init-groups env -i HOME=/home/arm USER=arm LOGNAME=arm \
  PATH=/usr/local/bin:/usr/bin:/bin LANG=C.UTF-8 "$@"; }

# ---- what A-2 section 5 / G0 need for the 02:20 backup (printing helpers; no file is written here)
f23_backup_rows() { # timer-epoch start-epoch exit-epoch invocation [Result [ExecMainStatus]]: rows of the systemctl fixture table
  printf '%s\n' "afldb-backup.timer|LastTriggerUSec|@$1" "afldb-backup.service|ExecMainStartTimestamp|@$2" \
    "afldb-backup.service|ExecMainExitTimestamp|@$3" "afldb-backup.service|InvocationID|$4" \
    "afldb-backup.service|Result|${5:-success}" "afldb-backup.service|ExecMainStatus|${6:-0}"
}
f23_backup_json() { # invocation epoch message: one `journalctl -o json` entry logged by the service's own process (uid 1000)
  printf '{"__REALTIME_TIMESTAMP":"%s000000","_UID":"1000","_PID":"4711","_SYSTEMD_UNIT":"afldb-backup.service","_SYSTEMD_INVOCATION_ID":"%s","MESSAGE":"%s"}\n' "$2" "$1" "$3"
}
f23_pid1_json() { # invocation epoch message: an entry PID 1 logged about the unit
  printf '{"__REALTIME_TIMESTAMP":"%s000000","_UID":"0","_PID":"1","_SYSTEMD_UNIT":"init.scope","UNIT":"afldb-backup.service","INVOCATION_ID":"%s","MESSAGE":"%s"}\n' "$2" "$1" "$3"
}

# ---- the systemctl fixture table
f23_set() { # unit property value: replace or add one row
  local t; t=$(awk -F'|' -v u="$1" -v p="$2" '!($1==u && $2==p)' /fx/sysd.tbl); printf '%s\n%s|%s|%s\n' "$t" "$1" "$2" "$3" > /fx/sysd.tbl; }
f23_unset() { local t; t=$(awk -F'|' -v u="$1" -v p="$2" '!($1==u && $2==p)' /fx/sysd.tbl); printf '%s\n' "$t" > /fx/sysd.tbl; }

# ---- the backup journal (both renderings are written together)
f23_journal_reset() { : > /fx/journal-backup.json; : > /fx/journal-backup.txt; echo ok > /fx/journal-mode; }
f23_jline() { # invocation "HH:MM:SS" message-after-the-prefix
  local e; e=$(f23_ep "$F23_DAY $2")
  f23_backup_json "$1" "$e" "$(TZ=UTC /usr/bin/date -d "@$e" +%FT%TZ) scheduled-backup: $3" >> /fx/journal-backup.json
  printf '%s scheduled-backup: %s\n' "$(TZ=UTC /usr/bin/date -d "@$e" +%FT%TZ)" "$3" >> /fx/journal-backup.txt
}
f23_jpid1() { f23_pid1_json "$1" "$(f23_ep "$F23_DAY $2")" "$3" >> /fx/journal-backup.json; }   # PID 1 lines: arm's `-o cat` view may lack them

# The r5 trigger line of an invocation: unit=afldb-backup.timer (realtime_usec = the genuine dispatch unless given) or unit=none.
# r6: always written when called; f23_backup_genuine and f23_manual_run call it only under F23_SCRIPT=r5.
f23_trigger_line() { # invocation "HH:MM:SS" unit|none [usec] [job]
  local us=${4:-none}; [ "$3" = afldb-backup.timer ] && us=${4:-$F23_TRIG_US}
  f23_jline "$1" "$2" "trigger: invocation=$1 job=${5:-4242} unit=$3 realtime_usec=$us"
}

# ---- the 02:2x dump
F23_SD=; F23_SS=
f23_dump() { # HHMMSS: exactly one scheduled-window dump with a correct one-line sidecar
  rm -f "$F23_BK"/afldb_prod-"$F23_DAYC"-02*.dump "$F23_BK"/afldb_prod-"$F23_DAYC"-02*.dump.sha256
  F23_SD=afldb_prod-$F23_DAYC-$1.dump
  head -c 4096 /dev/urandom > "$F23_BK/$F23_SD"; F23_SS=$(sha256sum < "$F23_BK/$F23_SD" | cut -c1-64)
  printf '%s  %s\n' "$F23_SS" "$F23_SD" > "$F23_BK/$F23_SD.sha256"; chown arm:arm "$F23_BK/$F23_SD" "$F23_BK/$F23_SD.sha256"
}

# ---- the genuine state: the backup timer dispatched at 02:20:00, its run started at 02:20:01, logged, and exited 0 at 02:20:19
f23_backup_genuine() {
  local r
  f23_dump 022001
  while IFS='|' read -r u p v; do f23_set "$u" "$p" "$v"; done < <(f23_backup_rows "$(f23_ep "$F23_DAY 02:20:00")" \
    "$(f23_ep "$F23_DAY 02:20:01")" "$(f23_ep "$F23_DAY 02:20:19")" "$F23_BINV")
  F23_TRIG_US=$(( $(f23_ep "$F23_DAY 02:20:00") * 1000000 + 123456 ))      # the dispatch's microseconds (a fraction, so equality is exact)
  f23_set afldb-backup.timer LastTriggerUSecRaw "$F23_TRIG_US"
  f23_journal_reset; : > /fx/binv-mode; echo > /fx/busctl-mode
  f23_jline "$F23_BINV" 02:20:01 "target: mode=backup dir=$F23_BK keep=14 offhost=none tools=$F23_CHK/tools/maintenance"
  [ "$F23_SCRIPT" != r5 ] || f23_trigger_line "$F23_BINV" 02:20:01 afldb-backup.timer
  f23_jline "$F23_BINV" 02:20:19 "backup ok: $F23_SD 4096 bytes sha256 ${F23_SS:0:16} offhost=skipped"
  rm -f "$F23_BK"/.state/FAILED-*
  # r6: the trusted install and the root writer's record of the timer's run
  f23_attest_reset; f23_attest_rows | while IFS='|' read -r u p v; do f23_set "$u" "$p" "$v"; done
  f23_unset afldb-backup.service EnvironmentFiles
  f23_attest_record "$F23_BINV" afldb-backup.timer "$F23_TRIG_US"
}

# ---- R6 r6: the root attestation (review-fixes-r6-20261128/DESIGN.md). Real root-owned files at the real paths.
F23_ATT_W=/usr/local/libexec/afldb/afldb-backup-attest
F23_ATT_D=/etc/systemd/system/afldb-backup.service.d/60-afldb-backup-attest.conf
F23_ATT_RD=/var/lib/afldb-backup-attest
F23_ATT_X='/usr/bin/env -i PATH=/usr/sbin:/usr/bin /usr/bin/bash --noprofile --norc /usr/local/libexec/afldb/afldb-backup-attest'
F23_ATT_FIX=
f23_attest_install() { # FIX: remember the tree whose reviewed bundle and unit files are installed; placeholders for absent helpers
  F23_ATT_FIX=$1; local h
  [ -f "$1/docs/v2/evidence/backlog-20261121/r6-20261125/review-fixes-r6-20261128/attest/afldb-backup-attest" ] || { echo "STOP fixture: no attestation bundle in $1"; return 1; }
  for h in /usr/bin/systemctl /usr/bin/busctl; do
    [ -e "$h" ] || { printf '#!/bin/sh\necho "fixture placeholder: never executed (the gates run the /usr/local/bin shims)" >&2\nexit 1\n' > "$h"; chown root:root "$h"; chmod 755 "$h"; }
  done
  f23_attest_reset
}
f23_attest_reset() { # the trusted install exactly; an empty record directory; every helper and parent restored to root, not g/o-writable
  local A=$F23_ATT_FIX/docs/v2/evidence/backlog-20261121/r6-20261125/review-fixes-r6-20261128/attest h
  for h in / /usr /usr/bin /usr/local /etc /etc/systemd /etc/systemd/system /var /var/lib; do chown root:root "$h"; chmod 755 "$h"; done
  for h in /usr/bin/env /usr/bin/bash /usr/bin/systemctl /usr/bin/busctl /usr/bin/sha256sum /usr/bin/timeout /usr/bin/mv; do chown root:root "$h"; chmod 755 "$h"; done
  rm -rf /usr/local/libexec/afldb /etc/systemd/system/afldb-backup.service.d /etc/systemd/system/afldb-backup.timer.d "$F23_ATT_RD" /var/lib/afldb-attest-elsewhere
  rm -f /etc/systemd/system/afldb-backup.service /etc/systemd/system/afldb-backup.timer /fx/espx
  install -d -o root -g root -m 0755 /usr/local/libexec /usr/local/libexec/afldb /etc/systemd/system/afldb-backup.service.d "$F23_ATT_RD"
  install -o root -g root -m 0755 "$A/afldb-backup-attest" "$F23_ATT_W"
  install -o root -g root -m 0644 "$A/60-afldb-backup-attest.conf" "$F23_ATT_D"
  install -o root -g root -m 0644 "$F23_ATT_FIX/deploy/afldb-backup.service" /etc/systemd/system/afldb-backup.service
  install -o root -g root -m 0644 "$F23_ATT_FIX/deploy/afldb-backup.timer" /etc/systemd/system/afldb-backup.timer
}
f23_attest_rows() { # the loaded unit's rows, as systemd 255 prints them with the drop-in installed (no EnvironmentFiles row: none)
  printf '%s\n' "afldb-backup.service|FragmentPath|/etc/systemd/system/afldb-backup.service" "afldb-backup.service|DropInPaths|$F23_ATT_D" \
    "afldb-backup.service|ExecStartPostEx|$(f23_attest_espx)" "afldb-backup.timer|FragmentPath|/etc/systemd/system/afldb-backup.timer" \
    "afldb-backup.timer|DropInPaths|"
}
f23_attest_espx() { # [argv [flags]]: one ExecStartPostEx value, after a run (as measured on systemd 255.4)
  printf '{ path=/usr/bin/env ; argv[]=%s ; flags=%s ; start_time=[Wed 2026-11-25 02:20:19 AEDT] ; stop_time=[Wed 2026-11-25 02:20:19 AEDT] ; pid=4712 ; code=exited ; status=0 }' \
    "${1:-$F23_ATT_X}" "${2:-ignore-failure privileged}"
}
# f23_attest_record <invocation> <trigger_unit|none> <trigger usec|none> [key=value | -key | +raw-line ...]: one record in the writer's
# exact format (format 2: dump= and dump_sha256= bind the run's dump; default: the fixture's current dump F23_SD / F23_SS, as the
# writer would find and hash it as arm), root:root 0644, at <RD>/<invocation>.attest. Defaults are a genuine run (the monotonic values of a real systemd 255.4 run:
# inactive-exit 245 us AFTER the main start, as PID 1 stamps them without an ExecStartPre); timer_last_trigger_usec = the given usec, or
# the fixture's dispatch when the job has none. key=value replaces a value, -key drops that line, +line appends a raw line.
f23_attest_record() {
  local inv=$1 tu=$2 tus=$3 a k i ws; local -a K V; shift 3
  ws=$(sha256sum < "$F23_ATT_FIX/docs/v2/evidence/backlog-20261121/r6-20261125/review-fixes-r6-20261128/attest/afldb-backup-attest" | cut -c1-64)
  K=(writer_sha256 unit invocation job job_type active_state sub_state exec_main_code exec_main_status inactive_enter_mono
    inactive_exit_mono exec_main_start_mono trigger_unit trigger_timer_realtime_usec timer_last_trigger_usec timer_last_trigger_mono
    timer_active_enter_mono dump dump_sha256 boot_id written_realtime_usec)
  V=("$ws" afldb-backup.service "$inv" 151 start activating start-post 1 0 616427771245 617083858683 617083858438 "$tu" "$tus"
    "$([ "$tus" = none ] && echo "${F23_TRIG_US:-1795807706054226}" || echo "$tus")" 617083613000 616422329687
    "${F23_SD:-none}" "${F23_SS:-none}" c3524e4759ab4e0f8050875471b56b12
    "$(( ${F23_TRIG_US:-1795807706054226} + 19000000 ))")
  local extra=()
  for a in "$@"; do case $a in
    +*) extra+=("${a#+}");;
    -*) for i in "${!K[@]}"; do [ "${K[i]}" = "${a#-}" ] && V[i]=__DROP__; done;;
    *=*) for i in "${!K[@]}"; do [ "${K[i]}" = "${a%%=*}" ] && V[i]=${a#*=}; done;;
  esac; done
  { echo afldb-backup-attest/2; for i in "${!K[@]}"; do [ "${V[i]}" = __DROP__ ] || printf '%s=%s\n' "${K[i]}" "${V[i]}"; done
    for a in "${extra[@]}"; do printf '%s\n' "$a"; done; } > "$F23_ATT_RD/$inv.attest"
  chown root:root "$F23_ATT_RD/$inv.attest"; chmod 644 "$F23_ATT_RD/$inv.attest"
}
# A start by hand at <start>, exit <exit> (HH:MM:SS), success, its own invocation and dump; the caller sets the timer and any
# earlier journal lines first (the journal is NOT reset here).
f23_manual_run() { # start exit
  f23_dump "$(tr -d : <<< "$1")"
  f23_set afldb-backup.service ExecMainStartTimestamp "@$(f23_ep "$F23_DAY $1")"; f23_set afldb-backup.service ExecMainExitTimestamp "@$(f23_ep "$F23_DAY $2")"
  f23_set afldb-backup.service InvocationID "$F23_BINV2"; f23_set afldb-backup.service Result success; f23_set afldb-backup.service ExecMainStatus 0
  f23_jline "$F23_BINV2" "$1" "target: mode=backup dir=$F23_BK keep=14 offhost=none tools=$F23_CHK/tools/maintenance"
  [ "$F23_SCRIPT" != r5 ] || f23_trigger_line "$F23_BINV2" "$1" none
  f23_jline "$F23_BINV2" "$2" "backup ok: $F23_SD 4096 bytes sha256 ${F23_SS:0:16} offhost=skipped"
  # r6: the timer's own run did not succeed, so the writer never ran for it; the hand start's own job carries no details
  rm -f "$F23_ATT_RD/$F23_BINV.attest"; f23_attest_record "$F23_BINV2" none none job=209
}

# ---- the afldb service: a real process tree owned by arm
f23_service_stop() { [ -n "$F23_SPID" ] || return 0; pkill -P "$F23_SPID" 2>/dev/null; kill "$F23_SPID" 2>/dev/null; wait "$F23_SPID" 2>/dev/null; F23_SPID=; }
f23_service_start() { # release-id
  local i c n
  ( cd "$F23_ROOT/releases/$1" && exec setpriv --reuid=arm --regid=arm --init-groups env -i PATH=/usr/bin:/bin \
      AFLDB_REVALIDATE_URL=http://127.0.0.1:3100/api/internal/revalidate-season AFLDB_REVALIDATE_SECRET=fixture-secret \
      bash -c 'AFLDB_WORKER_ID=1 sleep 7200 & AFLDB_WORKER_ID=2 sleep 7200 & wait' ) > /dev/null 2>&1 &
  F23_SPID=$!
  for i in $(seq 1 80); do
    # read as arm: root in a default container lacks CAP_SYS_PTRACE and cannot read another uid's environ
    n=0; for c in $(pgrep -P "$F23_SPID" 2>/dev/null); do setpriv --reuid=arm --regid=arm --init-groups cat "/proc/$c/environ" 2>/dev/null | tr '\0' '\n' | grep -q '^AFLDB_WORKER_ID=[12]$' && n=$((n+1)); done
    [ "$n" = 2 ] && return 0; sleep 0.25
  done
  echo "STOP fixture service did not come up"; return 1
}
f23_stub() { printf '%b' "$1" > /fx/stub-out; echo "$2" > /fx/stub-rc; chmod 644 /fx/stub-out /fx/stub-rc; }

# ---- everything else: users, clock, shims, host files, checkout, release root, 03:30 restore evidence, timers
f23_setup() { # FIX: prints a STOP line and returns 1 on any fixture failure
  local FX=$1 k f VD VS VT VSS VE JT VX THU THV THA WSE WAD
  [ -f /.dockerenv ] && [ "$(id -u)" = 0 ] && [ "$(hostname)" = afldb-prod ] || { echo "STOP fixture: root in a container named afldb-prod only"; return 1; }
  [ -x "$F23_NODE" ] || { echo "STOP fixture: no node at $F23_NODE (mount it read-only)"; return 1; }
  userdel -r ubuntu > /dev/null 2>&1; id arm > /dev/null 2>&1 || useradd -M -u 1000 -s /bin/bash arm || { echo "STOP fixture: users"; return 1; }
  mkdir -p /home/arm /fx && chown arm:arm /home/arm && chmod 755 /home/arm /fx
  f23_ep "$F23_DAY 09:25:00" > /fx/now                      # Wednesday 09:25 AEDT, A-2's slot
  cat > /usr/local/bin/date <<'SH'
#!/bin/bash
for a in "$@"; do case $a in -d|--date|-d*|--date=*|-r|--reference=*|-f|--file=*) exec /usr/bin/date "$@";; esac; done
exec /usr/bin/date -d "@$(cat /fx/now)" "$@"
SH
  cat > /usr/local/bin/uname <<'SH'
#!/bin/bash
[ "$*" = -r ] && { echo 6.8.0-137-generic; exit 0; }; exec /usr/bin/uname "$@"
SH
  cat > /usr/local/bin/dpkg-query <<'SH'
#!/bin/bash
case " $* " in
  *"linux-image-*"*) printf 'ii |linux-image-6.8.0-137-generic|6.8.0-137.147\nii |linux-image-6.8.0-149-generic|6.8.0-149.159\nii |linux-image-virtual|6.8.0.149.159\n';;
  *grub*) printf 'ii  grub-common 2.12-1ubuntu7.3\nii  grub-pc 2.12-1ubuntu7.3\n';;
  *) exec /usr/bin/dpkg-query "$@";;
esac
SH
  cat > /usr/local/bin/systemctl <<'SH'
#!/bin/bash
# Fixture systemctl: values from /fx/sysd.tbl ("unit|property|value"; "@epoch" values are rendered per --timestamp, except
# LastTriggerUSec, which systemd 255 always prints as a date string in the caller's time zone).
T=/fx/sysd.tbl; cmd=; unit=; props=(); value=0; ts=local
while [ $# -gt 0 ]; do case $1 in show|is-active|is-enabled|list-timers|list-unit-files) cmd=$1; shift; break;; *) shift;; esac; done
look() { awk -F'|' -v u="$1" -v p="$2" '$1==u && $2==p { sub(/^[^|]*\|[^|]*\|/, ""); print; f=1; exit } END { exit !f }' "$T"; }
case $cmd in
  is-active) v=$(look "$1" ActiveState) || v=inactive; echo "$v"; [ "$v" = active ];;
  is-enabled) v=$(look "$1" UnitFileState) || v=disabled; echo "$v"; [ "$v" = enabled ];;
  list-unit-files) cat /fx/list-unit-files.txt;;
  list-timers) case " $* " in *" -o json "*) cat /fx/list-timers.json;; *) cat /fx/list-timers.txt;; esac;;
  show)
    while [ $# -gt 0 ]; do case $1 in
      -p) props+=("$2"); shift 2;; --value) value=1; shift;; --timestamp=*) ts=${1#*=}; shift;; -*) shift;; *) unit=$1; shift;; esac; done
    mode=
    if [ "${props[*]}" = InvocationID ]; then case $unit in
      afldb) echo read >> /fx/inv-calls; mode=$(cat /fx/inv-mode 2>/dev/null);;
      afldb-backup.service) mode=$(cat /fx/binv-mode 2>/dev/null);;
    esac; fi
    if [ -n "$mode" ]; then
      real=$(look "$unit" InvocationID)
      case $mode in
        fail) echo "Failed to connect to bus: fixture failure" >&2; exit 1;;
        empty) real=;;
        malformed) real="not-an-id";;
        multi) real=$(printf '%s\n%s' "$real" "$real");;
        upper) real=$(printf '%s' "$real" | tr a-f A-F);;
        flip1) [ "$(wc -l < /fx/inv-calls)" -gt 1 ] || real=$(cat /fx/inv-other);;      # only the FIRST read differs
        flip2) [ "$(wc -l < /fx/inv-calls)" -le 1 ] || real=$(cat /fx/inv-other);;      # every LATER read differs
      esac
      if [ "$value" = 1 ]; then printf '%s\n' "$real"; else printf 'InvocationID=%s\n' "$real"; fi; exit 0
    fi
    for p in "${props[@]}"; do
      # r6: /fx/espx, when present, is the verbatim ExecStartPostEx output of the backup service (e.g. two entries)
      if [ "$unit/$p" = afldb-backup.service/ExecStartPostEx ] && [ -s /fx/espx ]; then cat /fx/espx; continue; fi
      v=$(look "$unit" "$p") || v=
      if [[ $v == @* ]]; then e=${v#@}
        if [ "$p" = LastTriggerUSec ]; then v=$(TZ=${TZ:-Australia/Melbourne} /usr/bin/date -d "@$e" '+%a %Y-%m-%d %H:%M:%S %Z')
        else case $ts in
          unix) v="@$e";; utc) v=$(TZ=UTC /usr/bin/date -d "@$e" '+%a %Y-%m-%d %H:%M:%S UTC');;
          *) v=$(TZ=Australia/Melbourne /usr/bin/date -d "@$e" '+%a %Y-%m-%d %H:%M:%S %Z');; esac; fi; fi
      if [ "$value" = 1 ]; then printf '%s\n' "$v"; else printf '%s=%s\n' "$p" "$v"; fi
    done;;
  *) exit 1;;
esac
SH
  cat > /usr/local/bin/journalctl <<'SH'
#!/bin/bash
u=; o=; while [ $# -gt 0 ]; do case $1 in -u) u=$2; shift 2;; -o) o=$2; shift 2;; *) shift;; esac; done
case "$u/$o" in
  afldb-backup.service/*) [ "$(cat /fx/journal-mode 2>/dev/null)" != fail ] || { echo "Failed to open journal: fixture failure" >&2; exit 1; }
    case $o in json) cat /fx/journal-backup.json;; cat) cat /fx/journal-backup.txt;; esac;;
  afldb-backup-verify.service/json) cat /fx/journal-verify.json;;
esac
SH
  cat > /usr/local/bin/busctl <<'SH'
#!/bin/bash
# Fixture busctl (R6 r5): the one read the gates make: `busctl get-property org.freedesktop.systemd1 <afldb-backup.timer path>
# org.freedesktop.systemd1.Timer LastTriggerUSec`, printed as the real tool does ("t <microseconds>").
# /fx/busctl-mode: fail (bus error, exit 1), garbage ("t not-a-number"), empty (exit 0, no output).
T=/fx/sysd.tbl; m=$(cat /fx/busctl-mode 2>/dev/null)
look() { awk -F'|' -v u="$1" -v p="$2" '$1==u && $2==p { sub(/^[^|]*\|[^|]*\|/, ""); print; f=1; exit } END { exit !f }' "$T"; }
[ "$*" = "get-property org.freedesktop.systemd1 /org/freedesktop/systemd1/unit/afldb_2dbackup_2etimer org.freedesktop.systemd1.Timer LastTriggerUSec" ] \
  || { echo "fixture busctl: unsupported: $*" >&2; exit 1; }
case $m in fail) echo "Failed to connect to bus: fixture failure" >&2; exit 1;; garbage) echo "t not-a-number"; exit 0;; empty) exit 0;; esac
if v=$(look afldb-backup.timer LastTriggerUSecRaw); then echo "t $v"
elif e=$(look afldb-backup.timer LastTriggerUSec); then echo "t $(( ${e#@} * 1000000 ))"
else echo "t 0"; fi
SH
  cat > /usr/local/bin/psql <<'SH'
#!/bin/bash
cat > /dev/null
echo "ledger|118|118_fixtures_unconfirmed_participants.sql"
echo "rt|afldb_restore_test|afldb.restore_test.v1 sha256=$(cat /fx/verify.sha)|0"
echo "pgstart|2026-11-24T23:02:11Z"
SH
  cat > /usr/local/bin/df <<'SH'
#!/bin/bash
case " $* " in *" -Pm "*) printf 'Filesystem 1048576-blocks Used Available Capacity Mounted on\n/dev/vda1 50000 20000 30000 40%% /\n';;
  *) printf 'Filesystem Size Used Avail Use%% Mounted on\n/dev/vda1 49G 20G 29G 40%% /\n/dev/vda16 881M 100M 720M 13%% /boot\n';; esac
SH
  cat > /usr/local/bin/awk <<'SH'
#!/bin/bash
# F-2 reads the uptime with `awk '{print int($1)}' /proc/uptime`; a container shows the host's. Everything else is the real awk.
[ "$#" = 2 ] && [ "$2" = /proc/uptime ] && { echo 600; exit 0; }
exec /usr/bin/awk "$@"
SH
  printf '#!/bin/bash\nexit 0\n' > /usr/local/bin/pg_isready
  printf '#!/bin/bash\nprintf 200\n' > /usr/local/bin/curl
  chmod 755 /usr/local/bin/date /usr/local/bin/uname /usr/local/bin/dpkg-query /usr/local/bin/systemctl /usr/local/bin/journalctl /usr/local/bin/busctl \
    /usr/local/bin/psql /usr/local/bin/df /usr/local/bin/awk /usr/local/bin/pg_isready /usr/local/bin/curl
  : > /fx/inv-mode; : > /fx/binv-mode; : > /fx/busctl-mode; : > /fx/inv-calls; echo "$F23_INV_OTHER" > /fx/inv-other; echo ok > /fx/journal-mode
  chmod 666 /fx/inv-calls; chmod 644 /fx/inv-mode /fx/binv-mode /fx/busctl-mode /fx/inv-other /fx/journal-mode /fx/now
  ln -sf /usr/share/zoneinfo/Australia/Melbourne /etc/localtime     # production's zone

  # host files A-2 reads by absolute path (as r3)
  mkdir -p /boot /lib/modules/6.8.0-149-generic /lib/modules/6.8.0-137-generic /etc/caddy /etc/needrestart/conf.d /etc/apt/apt.conf.d /var/run
  for k in 137 149; do printf 'fixture\n' > /boot/vmlinuz-6.8.0-$k-generic; printf 'fixture\n' > /boot/initrd.img-6.8.0-$k-generic; done
  : > /var/run/reboot-required
  cp "$FX/deploy/Caddyfile.production" /etc/caddy/Caddyfile && cp "$FX/deploy/host-policy/needrestart-afldb-hold.conf" /etc/needrestart/conf.d/50-afldb-hold.conf \
    && cp "$FX/deploy/host-policy/apt-52-afldb-unattended.conf" /etc/apt/apt.conf.d/52-afldb-unattended || { echo "STOP fixture: host files"; return 1; }
  case $(sha256sum < /etc/caddy/Caddyfile | cut -c1-64) in
    f00859d5c834be09f064d516ea4fa12612da379e377128e784b3523016a6086d) F23_R4=r4:yes;;
    4f6972ec119f5d33fff4c16cbbce15c50a36b883654dcffcabdb01776d7af036) F23_R4=r4:no;;
    *) echo "STOP fixture: deploy/Caddyfile.production is neither pinned Caddyfile"; return 1;;
  esac

  # checkout: the real status helpers, a stub release.mjs, .env
  mkdir -p "$F23_CHK/deploy/host-policy" "$F23_CHK/tools/maintenance"
  for f in deploy/afldb-settle-failure-status.sh deploy/host-policy/needrestart-afldb-hold.conf deploy/host-policy/apt-52-afldb-unattended.conf \
    tools/maintenance/scheduled-backup.sh; do cp "$FX/$f" "$F23_CHK/$f" || { echo "STOP fixture: $f"; return 1; }; done
  printf '%s\n' "import { readFileSync } from 'node:fs';" "process.stdout.write(readFileSync('/fx/stub-out', 'utf8'));" \
    "process.exit(Number(readFileSync('/fx/stub-rc', 'utf8')));" > "$F23_CHK/deploy/release.mjs"
  printf '%s\n' PORT=3100 AFLDB_WORKERS=2 "AFLDB_REVALIDATE_URL=http://127.0.0.1:3100/api/internal/revalidate-season" AFLDB_REVALIDATE_SECRET=fixture-secret \
    'AFLDB_BACKUP_DATABASE_URL=postgresql://afldb_backup:fixture%21pw@127.0.0.1:5432/afldb_prod' > "$F23_CHK/.env"; chmod 600 "$F23_CHK/.env"
  f23_stub "release: current  $F23_CUR\nrelease: STATUS PASS $F23_CUR\n" 0

  # release root: current -> the released build (Tuesday outcome `released`)
  mkdir -p "$F23_ROOT/releases/$F23_CUR" "$F23_ROOT/releases/$F23_PREV"
  ln -sfn "releases/$F23_CUR" "$F23_ROOT/current"; ln -sfn "releases/$F23_PREV" "$F23_ROOT/previous"

  # 03:30 restore verification evidence (unchanged from r3) and the backup directory
  mkdir -p "$F23_BK/.state"
  VD=afldb_prod-$F23_DAYC-033012.dump
  head -c 4096 /dev/urandom > "$F23_BK/$VD"; VS=$(sha256sum < "$F23_BK/$VD" | cut -c1-64); printf '%s  %s\n' "$VS" "$VD" > "$F23_BK/$VD.sha256"
  VT=$(f23_ep "$F23_DAY 03:30:00"); VSS=$(f23_ep "$F23_DAY 03:30:02"); VE=$(f23_ep "$F23_DAY 03:31:20"); JT=$(f23_ep "$F23_DAY 03:31:25"); VX=$(f23_ep "$F23_DAY 03:31:30")
  printf '{"epoch":%s,"file":"%s","sha256":"%s","attempts":1}\n' "$VE" "$VD" "$VS" > "$F23_BK/.state/last-verify.json"
  printf '{"epoch":%s,"file":"%s","sha256":"%s","offhost":"none"}\n' "$(f23_ep "$F23_DAY 03:30:20")" "$VD" "$VS" > "$F23_BK/.state/last-backup.json"
  echo "$VS" > /fx/verify.sha
  printf '{"MESSAGE":"2026-11-24T16:31:25Z scheduled-backup: verify ok: %s restored and proven (attempt 1)","_SYSTEMD_UNIT":"afldb-backup-verify.service","_SYSTEMD_INVOCATION_ID":"%s","__REALTIME_TIMESTAMP":"%s000000"}\n' "$VD" "$F23_VINV" "$JT" > /fx/journal-verify.json
  chown -R arm:arm /home/arm/projects /home/arm/afldb-releases /home/arm/backups

  # timers (next elapse: Thursday for the backups; Wednesday evening for the others, outside A-2's window, inside F-2's 24 h)
  THU=$(f23_ep "2026-11-26 02:20:00"); THV=$(f23_ep "2026-11-26 03:30:00"); THA=$(f23_ep "2026-11-26 06:30:00")
  WSE=$(f23_ep "2026-11-25 21:00:00"); WAD=$(f23_ep "2026-11-25 18:00:00")
  cat > /fx/list-unit-files.txt <<'TXT'
afldb-backup-verify.service static -
afldb-backup-verify.timer   enabled enabled
afldb-backup.service        static -
afldb-backup.timer          enabled enabled
afldb.service               enabled enabled
TXT
  printf '%s\n' "Wed 2026-11-25 18:00:00 AEDT 8h - - apt-daily.timer apt-daily.service" \
    "Wed 2026-11-25 21:00:00 AEDT 11h - - afldb-settle-afl-api.timer afldb-settle-afl-api.service" \
    "Thu 2026-11-26 02:20:00 AEDT 16h - - afldb-backup.timer afldb-backup.service" \
    "Thu 2026-11-26 03:30:00 AEDT 18h - - afldb-backup-verify.timer afldb-backup-verify.service" \
    "Thu 2026-11-26 06:30:00 AEDT 21h - - apt-daily-upgrade.timer apt-daily-upgrade.service" > /fx/list-timers.txt
  printf '[{"next":%s000000,"left":0,"last":0,"passed":0,"unit":"apt-daily.timer","activates":"apt-daily.service"},{"next":%s000000,"left":0,"last":0,"passed":0,"unit":"afldb-settle-afl-api.timer","activates":"afldb-settle-afl-api.service"},{"next":%s000000,"left":0,"last":0,"passed":0,"unit":"afldb-backup.timer","activates":"afldb-backup.service"},{"next":%s000000,"left":0,"last":0,"passed":0,"unit":"afldb-backup-verify.timer","activates":"afldb-backup-verify.service"},{"next":%s000000,"left":0,"last":0,"passed":0,"unit":"apt-daily-upgrade.timer","activates":"apt-daily-upgrade.service"}]\n' \
    "$WAD" "$WSE" "$THU" "$THV" "$THA" > /fx/list-timers.json

  f23_attest_install "$FX" || return 1
  f23_service_start "$F23_CUR" || return 1
  cat > /fx/sysd.tbl <<TBL
afldb|ActiveState|active
afldb|MainPID|$F23_SPID
afldb|InvocationID|$F23_INV_TUE
afldb|NRestarts|0
afldb|ActiveEnterTimestamp|@$(f23_ep "2026-11-24 11:33:10")
postgresql@16-main|ActiveState|active
caddy|ActiveState|active
apt-daily.service|ActiveState|inactive
apt-daily-upgrade.service|ActiveState|inactive
afldb-backup-verify.service|ExecMainStartTimestamp|@$VSS
afldb-backup-verify.service|ExecMainExitTimestamp|@$VX
afldb-backup-verify.service|Result|success
afldb-backup-verify.service|ExecMainStatus|0
afldb-backup-verify.timer|LastTriggerUSec|@$VT
TBL
  for k in afldb-backup afldb-backup-verify apt-daily apt-daily-upgrade afldb-settle-afl-api; do
    printf '%s\n' "$k.timer|ActiveState|active" "$k.timer|UnitFileState|enabled" "$k.timer|Triggers|$k.service" >> /fx/sysd.tbl; done
  chmod 644 /fx/sysd.tbl /fx/list-*.txt /fx/list-timers.json /fx/journal-verify.json /fx/verify.sha
  f23_backup_genuine
  chmod 644 /fx/journal-backup.json /fx/journal-backup.txt
}

# r5: the 03:10 off-host pull has copied the hand-started dump (and its sidecar and a pull stamp) to an off-host directory. The gates
# run on production and have no business with it; the files are made with an OLD atime and a NEW mtime so that a read bumps atime
# (relatime), and the suite asserts that no gate read them. A gate that consulted this copy would be the defect.
F23_OFF=/mnt/afldb-offhost
f23_offhost_copy() {
  mkdir -p "$F23_OFF"; cp "$F23_BK/$F23_SD" "$F23_BK/$F23_SD.sha256" "$F23_OFF/"
  printf 'pull 2026-11-24T16:10:07Z %s\n' "$F23_SD" > "$F23_OFF/.last-pull"
  touch -a -d '2020-01-01 00:00:00' "$F23_OFF/$F23_SD" "$F23_OFF/$F23_SD.sha256" "$F23_OFF/.last-pull"
  chown -R arm:arm "$F23_OFF"
}
# r5: a hand run of scheduled-backup.sh from an ssh session scope with TRIGGER_UNIT set: its lines carry a perfect-looking trigger
# line and a "backup ok" line, but not _SYSTEMD_UNIT=afldb-backup.service. journalctl -u would not return them; the fixture shim
# returns everything it holds, so the gate's own filter is what is tested.
f23_scope_run_lines() {
  local e=$(f23_ep "$F23_DAY 02:20:02") m
  for m in "trigger: invocation=$F23_BINV job=4242 unit=afldb-backup.timer realtime_usec=$F23_TRIG_US" "backup ok: $F23_SD 4096 bytes sha256 ${F23_SS:0:16} offhost=skipped"; do
    printf '{"__REALTIME_TIMESTAMP":"%s000000","_UID":"1000","_PID":"5150","_SYSTEMD_UNIT":"session-42.scope","_SYSTEMD_INVOCATION_ID":"%s","MESSAGE":"%s scheduled-backup: %s"}\n' \
      "$e" "$F23_BINV" "$(TZ=UTC /usr/bin/date -d "@$e" +%FT%TZ)" "$m" >> /fx/journal-backup.json
  done
}

# ---- suite f2: one named state of the 02:20 backup evidence, always built from the genuine state
f23_scenario() { # name
  local tgt="target: mode=backup dir=$F23_BK keep=14 offhost=none tools=$F23_CHK/tools/maintenance" okl
  f23_backup_genuine
  okl="backup ok: $F23_SD 4096 bytes sha256 ${F23_SS:0:16} offhost=skipped"
  local tm=617083613000 R=$F23_ATT_RD rec=$F23_ATT_RD/$F23_BINV.attest T=$F23_TRIG_US   # r6: the genuine record's dispatch (monotonic)
  case $1 in
    genuine) ;;
    genuine-pid1-lines)        # arm can read PID 1's lines about the same invocation: still the timer's run
      f23_jpid1 "$F23_BINV" 02:20:01 "Starting afldb-backup.service - AFLDB scheduled backup..."
      f23_jpid1 "$F23_BINV" 02:20:19 "Finished afldb-backup.service - AFLDB scheduled backup.";;
    manual-no-timer)           # the timer did not dispatch today (last trigger: Tuesday); someone started the service at 02:24:10
      f23_set afldb-backup.timer LastTriggerUSec "@$(f23_ep "2026-11-24 02:20:00")"; f23_unset afldb-backup.timer LastTriggerUSecRaw
      f23_journal_reset; f23_manual_run 02:24:10 02:24:30;;
    timer-failed-then-manual)  # the timer fired, its own run logged and failed; a start by hand four minutes later succeeded
      f23_journal_reset; f23_jline "$F23_BINV" 02:20:01 "$tgt"; f23_jline "$F23_BINV" 02:20:03 "AFLDB_BACKUP_FAILURE mode=backup step=backup exit=1"
      f23_manual_run 02:24:10 02:24:30;;
    manual-within-5s)          # as above, but the start by hand is 3 s after the dispatch: the timing links alone would hold
      f23_journal_reset; f23_jline "$F23_BINV" 02:20:00 "$tgt"; f23_jline "$F23_BINV" 02:20:01 "AFLDB_BACKUP_FAILURE mode=backup step=backup exit=1"
      f23_manual_run 02:20:03 02:20:25;;
    astra)                     # r5, Astra's case: the timer's invocation failed at 02:20:00 and left NOTHING arm can read (PID 1's
      f23_journal_reset        # lines only, e.g. a failed dependency); a start by hand at 02:20:03 then succeeded: one visible invocation
      F23_SCRIPT=r5 f23_manual_run 02:20:03 02:20:25;;    # (the r5 script: unit=none; r6: the writer's record says trigger_unit=none)
    astra-current-script)      # the same, with today's production script: the hand-started run logs no trigger line at all
      F23_SCRIPT=current f23_journal_reset; F23_SCRIPT=current f23_manual_run 02:20:03 02:20:25;;
    genuine-current-script)    # a genuine timer run of today's production script: it logs no trigger line, so nothing proves its origin
      f23_journal_reset; f23_jline "$F23_BINV" 02:20:01 "$tgt"; f23_jline "$F23_BINV" 02:20:19 "$okl";;
    astra-offhost-later)       # Astra's case, and the 03:10 off-host pull has already copied the hand-started dump: nothing may read it
      f23_journal_reset; f23_manual_run 02:20:03 02:20:25; f23_offhost_copy;;
    astra-with-hand-run-lines) # Astra's case, plus a session-scope hand run of the script with TRIGGER_UNIT set: its lines are not the service's
      f23_journal_reset; f23_manual_run 02:20:03 02:20:25; f23_scope_run_lines;;
    timer-trigger-then-fail-manual-3s) # the timer's run logged its trigger line, then failed; a start by hand 3 s later succeeded
      f23_journal_reset; f23_jline "$F23_BINV" 02:20:00 "$tgt"; f23_trigger_line "$F23_BINV" 02:20:00 afldb-backup.timer
      f23_jline "$F23_BINV" 02:20:01 "AFLDB_BACKUP_FAILURE mode=backup step=backup exit=1"; f23_manual_run 02:20:03 02:20:25;;
    trigger-stale-dispatch)    # the run's start job records an EARLIER dispatch (Tuesday), not the timer's LastTriggerUSec
      f23_journal_reset; f23_jline "$F23_BINV" 02:20:01 "$tgt"
      f23_trigger_line "$F23_BINV" 02:20:01 afldb-backup.timer "$(( $(f23_ep "2026-11-24 02:20:00") * 1000000 + 123456 ))"
      f23_jline "$F23_BINV" 02:20:19 "$okl";;
    trigger-off-by-1us)        # same second, one microsecond away: not equal
      f23_journal_reset; f23_jline "$F23_BINV" 02:20:01 "$tgt"; f23_trigger_line "$F23_BINV" 02:20:01 afldb-backup.timer "$((F23_TRIG_US + 1))"
      f23_jline "$F23_BINV" 02:20:19 "$okl";;
    trigger-seconds-only)      # the line carries whole seconds (not microseconds)
      f23_journal_reset; f23_jline "$F23_BINV" 02:20:01 "$tgt"; f23_trigger_line "$F23_BINV" 02:20:01 afldb-backup.timer "$((F23_TRIG_US / 1000000))"
      f23_jline "$F23_BINV" 02:20:19 "$okl";;
    trigger-two-lines)         # the same genuine trigger line twice
      f23_trigger_line "$F23_BINV" 02:20:02 afldb-backup.timer;;
    trigger-timer-and-none)    # a timer line and a unit=none line of the same invocation
      f23_trigger_line "$F23_BINV" 02:20:02 none;;
    trigger-other-invocation-field) # the line is the service's own, but names another invocation
      f23_journal_reset; f23_jline "$F23_BINV" 02:20:01 "$tgt"
      f23_jline "$F23_BINV" 02:20:01 "trigger: invocation=$F23_BINV2 job=4242 unit=afldb-backup.timer realtime_usec=$F23_TRIG_US"; f23_jline "$F23_BINV" 02:20:19 "$okl";;
    trigger-other-unit)        # a path or other timer, not afldb-backup.timer
      f23_journal_reset; f23_jline "$F23_BINV" 02:20:01 "$tgt"; f23_trigger_line "$F23_BINV" 02:20:01 afldb-backup-verify.timer
      f23_jline "$F23_BINV" 02:20:19 "$okl";;
    trigger-malformed)         # a trailing word: the anchored line does not match, so there is no trigger line
      f23_journal_reset; f23_jline "$F23_BINV" 02:20:01 "$tgt"
      f23_jline "$F23_BINV" 02:20:01 "trigger: invocation=$F23_BINV job=4242 unit=afldb-backup.timer realtime_usec=$F23_TRIG_US extra"; f23_jline "$F23_BINV" 02:20:19 "$okl";;
    trigger-note-only)         # the script could not read its start job: it logs a note and unit=none
      f23_journal_reset; f23_jline "$F23_BINV" 02:20:01 "$tgt"; f23_jline "$F23_BINV" 02:20:01 "trigger-note: the start job's ActivationDetails are unreadable"
      f23_trigger_line "$F23_BINV" 02:20:01 none; f23_jline "$F23_BINV" 02:20:19 "$okl";;
    trigger-after-run)         # the trigger line is outside the run (logged long after the exit)
      f23_journal_reset; f23_jline "$F23_BINV" 02:20:01 "$tgt"; f23_jline "$F23_BINV" 02:20:19 "$okl"; f23_trigger_line "$F23_BINV" 02:21:00 afldb-backup.timer;;
    busctl-fail|busctl-garbage|busctl-empty) echo "${1#busctl-}" > /fx/busctl-mode;;
    ok-line-other-invocation)  # the only "backup ok" line belongs to another invocation than the service reports
      f23_journal_reset; f23_jline "$F23_BINV2" 02:20:01 "$tgt"; f23_jline "$F23_BINV2" 02:20:19 "$okl";;
    two-invocations)           # a second invocation logged later in the window
      f23_jline "$F23_BINV2" 02:30:00 "$tgt";;
    pid1-other-invocation)     # only PID 1's line shows the second invocation
      f23_jpid1 "$F23_BINV2" 02:30:00 "Starting afldb-backup.service - AFLDB scheduled backup...";;
    binv-fail|binv-empty|binv-malformed|binv-multi) echo "${1#binv-}" > /fx/binv-mode;;
    journal-fail) echo fail > /fx/journal-mode;;
    journal-malformed) echo '{"MESSAGE":"truncated' >> /fx/journal-backup.json;;
    journal-no-invocation)
      printf '{"__REALTIME_TIMESTAMP":"%s000000","_SYSTEMD_UNIT":"afldb-backup.service","MESSAGE":"no invocation field"}\n' "$(f23_ep "$F23_DAY 02:20:05")" >> /fx/journal-backup.json;;
    no-timer-property) f23_unset afldb-backup.timer LastTriggerUSec;;
    timer-run-failed)          # the timer's own run failed
      f23_set afldb-backup.service Result exit-code; f23_set afldb-backup.service ExecMainStatus 1
      f23_journal_reset; f23_jline "$F23_BINV" 02:20:01 "$tgt"; f23_jline "$F23_BINV" 02:20:19 "AFLDB_BACKUP_FAILURE mode=backup step=offhost exit=1";;
    no-completion) f23_unset afldb-backup.service ExecMainExitTimestamp;;
    no-ok-line) f23_journal_reset; f23_jline "$F23_BINV" 02:20:01 "$tgt";;
    two-ok-lines) f23_jline "$F23_BINV" 02:20:19 "$okl";;
    ok-line-after-run) f23_journal_reset; f23_jline "$F23_BINV" 02:20:01 "$tgt"; f23_jline "$F23_BINV" 02:21:00 "$okl";;
    no-dump) rm -f "$F23_BK/$F23_SD" "$F23_BK/$F23_SD.sha256";;
    two-dumps) head -c 64 /dev/urandom > "$F23_BK/afldb_prod-$F23_DAYC-022500.dump"
      (cd "$F23_BK" && sha256sum "afldb_prod-$F23_DAYC-022500.dump" > "afldb_prod-$F23_DAYC-022500.dump.sha256");;
    bad-sidecar) printf 'x' >> "$F23_BK/$F23_SD";;
    journal-other-name) f23_journal_reset; f23_jline "$F23_BINV" 02:20:01 "$tgt"; f23_trigger_line "$F23_BINV" 02:20:01 afldb-backup.timer
      f23_jline "$F23_BINV" 02:20:19 "backup ok: afldb_prod-$F23_DAYC-022002.dump 4096 bytes sha256 ${F23_SS:0:16} offhost=skipped";;
    journal-other-hash) f23_journal_reset; f23_jline "$F23_BINV" 02:20:01 "$tgt"; f23_trigger_line "$F23_BINV" 02:20:01 afldb-backup.timer
      f23_jline "$F23_BINV" 02:20:19 "backup ok: $F23_SD 4096 bytes sha256 0000000000000000 offhost=skipped";;
    # ---- r6: the root record. PASS states (the trigger-* states above PASS too now: a trigger line counts toward nothing)
    genuine-r5-script)         # a genuine run of the withdrawn r5 script: its trigger line is ignored
      f23_trigger_line "$F23_BINV" 02:20:01 afldb-backup.timer;;
    attest-exit-after-start)   # the measured real order: inactive-exit 245 us AFTER the main start (no ExecStartPre)
      ar inactive_exit_mono=617083858683 exec_main_start_mono=617083858438;;
    attest-exit-before-start)  ar inactive_exit_mono=617083858000 exec_main_start_mono=617083858438;;
    attest-start-5s-exactly)   ar inactive_exit_mono=$((tm + 4999000)) exec_main_start_mono=$((tm + 5000000));;
    attest-first-run-since-boot) ar inactive_enter_mono=0;;
    attest-other-dispatch-records)   # earlier nights and hand starts are in the same directory
      f23_attest_record 0a0b0c0d0e0f40112233445566778899 afldb-backup.timer $((T - 86400000000)); f23_attest_record 1a1b1c1d1e1f40112233445566778899 none none;;
    attest-leftover-tmp)       printf 'partial\n' > "$R/.2a2b2c2d2e2f40112233445566778899.tmp";;
    attest-timer-rearmed)      ar timer_active_enter_mono=$((tm - 5000000));;   # information only: "the dispatch came 5.0 s after ..."
    # ---- r6: STOP states. Install and unit.
    attest-not-installed-r5-line)    # an older install: the r5 trigger line, no writer, no drop-in, no record
      f23_trigger_line "$F23_BINV" 02:20:01 afldb-backup.timer; rm -rf /usr/local/libexec/afldb /etc/systemd/system/afldb-backup.service.d "$R"
      f23_set afldb-backup.service ExecStartPostEx ""; f23_set afldb-backup.service DropInPaths "";;
    attest-forged-trigger-no-record) # writer installed, no record for the run; arm logged a perfect trigger line itself
      f23_trigger_line "$F23_BINV" 02:20:01 afldb-backup.timer; rm -f "$rec";;
    attest-astra-forged-trigger)     # Astra's case with an arm-edited script logging a perfect trigger line for the hand start
      f23_journal_reset; f23_manual_run 02:20:03 02:20:25; f23_trigger_line "$F23_BINV2" 02:20:03 afldb-backup.timer;;
    attest-envfile) f23_set afldb-backup.service EnvironmentFiles "/home/arm/projects/afldb/.env (ignore_errors=no)";;
    attest-execpost-missing) f23_set afldb-backup.service ExecStartPostEx "";;
    attest-execpost-two) printf 'ExecStartPostEx=%s\nExecStartPostEx=%s\n' "$(f23_attest_espx)" \
      "$(f23_attest_espx '/usr/bin/bash -c echo second' privileged)" > /fx/espx; chmod 644 /fx/espx;;
    attest-execpost-not-privileged) f23_set afldb-backup.service ExecStartPostEx "$(f23_attest_espx "" ignore-failure)";;
    attest-execpost-other-argv) f23_set afldb-backup.service ExecStartPostEx "$(f23_attest_espx '/usr/bin/bash /home/arm/projects/afldb/attest.sh')";;
    attest-dropin-not-loaded) f23_set afldb-backup.service DropInPaths "";;
    attest-fragment-under-home)      # the unit loaded from arm's checkout (a `systemctl link`)
      mkdir -p "$F23_CHK/deploy"; cp /etc/systemd/system/afldb-backup.service "$F23_CHK/deploy/"; chown -R arm:arm "$F23_CHK/deploy"
      f23_set afldb-backup.service FragmentPath "$F23_CHK/deploy/afldb-backup.service";;
    attest-extra-dropin-arm-owned)
      printf '[Service]\nNice=10\n' > /etc/systemd/system/afldb-backup.service.d/99-arm.conf; chown arm:arm /etc/systemd/system/afldb-backup.service.d/99-arm.conf
      f23_set afldb-backup.service DropInPaths "$F23_ATT_D /etc/systemd/system/afldb-backup.service.d/99-arm.conf";;
    attest-timer-dropin-writable)
      install -d -m 0755 /etc/systemd/system/afldb-backup.timer.d; printf '[Timer]\nAccuracySec=1s\n' > /etc/systemd/system/afldb-backup.timer.d/x.conf
      chmod 666 /etc/systemd/system/afldb-backup.timer.d/x.conf; f23_set afldb-backup.timer DropInPaths /etc/systemd/system/afldb-backup.timer.d/x.conf;;
    attest-helper-writable) chmod 777 /usr/bin/timeout;;
    attest-writer-digest) printf '# arm was here\n' >> "$F23_ATT_W";;
    attest-writer-arm-owned) chown arm:arm "$F23_ATT_W";;
    attest-writer-dir-writable) chmod 775 /usr/local/libexec/afldb;;
    attest-dropin-digest) printf '\n' >> "$F23_ATT_D";;
    # ---- r6: STOP states. The record's place and file.
    attest-record-of-other-invocation) rm -f "$rec"; f23_attest_record "$F23_BINV2" afldb-backup.timer "$T";;
    attest-record-arm-owned) chown arm:arm "$rec";;
    attest-record-group-writable) chmod 664 "$rec";;
    attest-record-other-writable) chmod 646 "$rec";;
    attest-record-symlink) mkdir -p /var/lib/afldb-attest-elsewhere; mv "$rec" /var/lib/afldb-attest-elsewhere/; ln -s "/var/lib/afldb-attest-elsewhere/$F23_BINV.attest" "$rec";;
    attest-record-nlink2) mkdir -p /var/lib/afldb-attest-elsewhere; ln "$rec" /var/lib/afldb-attest-elsewhere/copy.attest;;
    attest-record-dir-arm-owned) chown arm:arm "$R";;
    attest-record-dir-writable) chmod 777 "$R";;
    attest-record-parent-writable) chmod 777 /var/lib;;
    attest-record-dir-symlink) mkdir -p /var/lib/afldb-attest-elsewhere; mv "$R" /var/lib/afldb-attest-elsewhere/rd; ln -s /var/lib/afldb-attest-elsewhere/rd "$R";;
    attest-duplicate-dispatch) f23_attest_record "$F23_BINV2" afldb-backup.timer "$T" job=152;;
    # ---- r6: STOP states. The record's facts.
    attest-trigger-none) ar trigger_unit=none trigger_timer_realtime_usec=none;;
    attest-trigger-other-unit) ar trigger_unit=afldb-backup-verify.timer;;
    attest-wrong-invocation-field) ar invocation=$F23_BINV2;;
    attest-usec-plus-1) ar trigger_timer_realtime_usec=$((T + 1)) timer_last_trigger_usec=$((T + 1));;
    attest-usec-minus-1) ar trigger_timer_realtime_usec=$((T - 1)) timer_last_trigger_usec=$((T - 1));;
    attest-stale-dispatch) ar trigger_timer_realtime_usec=$((T - 86400000000)) timer_last_trigger_usec=$((T - 86400000000));;
    attest-timer-usec-at-write-differs) ar timer_last_trigger_usec=$((T - 1000000));;
    attest-restart-ordering)   # the measured restart case: same job and details, inactive-enter 1.8 s AFTER the dispatch
      ar inactive_enter_mono=$((tm + 1818455)) inactive_exit_mono=$((tm + 2287900)) exec_main_start_mono=$((tm + 2287607));;
    attest-inactive-enter-equal) ar inactive_enter_mono=$tm;;
    attest-exit-before-dispatch) ar inactive_exit_mono=$((tm - 1));;
    attest-start-before-dispatch) ar exec_main_start_mono=$((tm - 1));;
    attest-start-over-5s) ar exec_main_start_mono=$((tm + 5000001));;
    attest-exit-over-5s) ar inactive_exit_mono=$((tm + 5000001));;
    attest-job-restart) ar job_type=restart;;
    attest-state-active) ar active_state=active sub_state=exited;;
    attest-exec-status-1) ar exec_main_status=1;;
    attest-exec-code-killed) ar exec_main_code=2 exec_main_status=15;;
    attest-record-writer-sha) ar writer_sha256=00000000000000000000000000000000000000000000000000000000000000ff;;
    # ---- r6: STOP states. Malformed records.
    attest-malformed-extra-line) ar +extra=1;;
    attest-malformed-missing-line) ar -boot_id;;
    attest-malformed-reordered) sed -i '3{h;d};4{G}' "$rec";;                 # unit= and invocation= swapped
    attest-malformed-header) sed -i '1s/2$/3/' "$rec";;   # afldb-backup-attest/3
    attest-malformed-crlf) sed -i '5s/$/\r/' "$rec";;
    attest-malformed-trailing-space) sed -i '6s/$/ /' "$rec";;
    attest-malformed-value) sed -i '5s/=.*/=12a/' "$rec";;
    attest-malformed-no-final-newline) truncate -s -1 "$rec";;
    attest-malformed-nul) sed -i '7s/=/=\x00/' "$rec";;
    attest-malformed-duplicate-key) sed -i '21s/.*/timer_active_enter_mono=1/' "$rec";;
    attest-malformed-empty) : > "$rec";;
    # ---- r6 format 2 (independent review MED-1): the record binds the dump
    attest-format-1)            # a format-1 record (no dump binding) of the genuine run
      sed -i -e '1s/2$/1/' -e '/^dump=/d' -e '/^dump_sha256=/d' "$rec";;
    attest-dump-none) ar dump=none dump_sha256=none;;                 # the writer did not find exactly one dump of this run
    attest-dump-name-differs) ar dump=afldb_prod-$F23_DAYC-022130.dump;;
    attest-dump-sha16-differs) ar dump_sha256=$(tr '0-9a-f' '1-9a-f0' <<< "$F23_SS");;
    attest-dump-full-sha-differs)   # same first 16 hex, a different full sha256: only the callers' full re-hash comparison refuses it
      ar dump_sha256=${F23_SS:0:16}$(tr '0-9a-f' '1-9a-f0' <<< "${F23_SS:16}");;
    attest-node-lies-planted-dump)  # the reviewer's MED-1 bypass: genuine run and record; arm deletes the real dump, plants its own
      # (in the window, with its own sidecar), and its node prints a "backup ok" line naming the planted dump (here: the journal the
      # node parses says so; the gate sees only node's output either way)
      rm -f "$F23_BK/$F23_SD" "$F23_BK/$F23_SD.sha256"; head -c 4096 /dev/urandom > "$F23_BK/afldb_prod-$F23_DAYC-022130.dump"
      (cd "$F23_BK" && sha256sum "afldb_prod-$F23_DAYC-022130.dump" > "afldb_prod-$F23_DAYC-022130.dump.sha256"); chown arm:arm "$F23_BK"/afldb_prod-*
      f23_journal_reset; f23_jline "$F23_BINV" 02:20:01 "$tgt"
      f23_jline "$F23_BINV" 02:20:19 "backup ok: afldb_prod-$F23_DAYC-022130.dump 4096 bytes sha256 $(sha256sum < "$F23_BK/afldb_prod-$F23_DAYC-022130.dump" | cut -c1-16) offhost=skipped";;
    *) echo "STOP unknown scenario $1"; return 1;;
  esac
}
ar() { f23_attest_record "$F23_BINV" afldb-backup.timer "$F23_TRIG_US" "$@"; }   # r6: rewrite the genuine run's record with changes
# The reason (extended regex, matched inside one FAIL line) each non-genuine scenario must be refused for.
f23_reason() { # name
  case $1 in
    # r6: the hand start's ROOT record says trigger_unit=none (r5: its trigger line did; the expected text gained "record <path>: ")
    astra|astra-offhost-later|astra-with-hand-run-lines|astra-current-script|attest-astra-forged-trigger|attest-trigger-none)
      echo "not attributed to the backup timer: scheduled origin unproven: record /var/lib/afldb-backup-attest/[0-9a-f]{32}\\.attest: the run's start job names trigger unit 'none', not afldb-backup\\.timer";;
    timer-trigger-then-fail-manual-3s) echo 'not attributed to the backup timer: ambiguous: another invocation of afldb-backup\.service \([0-9a-f]{32}, epoch [0-9]+\)';;
    trigger-after-run) echo 'invocation [0-9a-f]{32} logged at epoch [0-9]+, outside its own run';;
    busctl-fail|busctl-garbage|busctl-empty) echo 'scheduled origin unproven: afldb-backup\.timer LastTriggerUSec could not be read in microseconds';;
    manual-no-timer) echo 'not attributed to the backup timer: no timer dispatch in the window: afldb-backup\.timer last triggered at epoch [0-9]+';;
    timer-failed-then-manual) echo 'not attributed to the backup timer: the service.s last start \(epoch [0-9]+\) is not within 5 s after the timer dispatch';;
    manual-within-5s|ok-line-other-invocation|two-invocations|pid1-other-invocation)
      echo 'not attributed to the backup timer: ambiguous: another invocation of afldb-backup\.service \([0-9a-f]{32}, epoch [0-9]+\)';;
    binv-fail) echo 'not attributed to the backup timer: afldb-backup\.service InvocationID: systemctl show afldb-backup\.service failed \(exit 1\)';;
    binv-empty) echo 'not attributed to the backup timer: afldb-backup\.service InvocationID: the live InvocationID is empty';;
    binv-malformed|binv-multi) echo 'not attributed to the backup timer: afldb-backup\.service InvocationID: the live InvocationID .* is malformed';;
    journal-fail) echo 'not attributed to the backup timer: journalctl failed';;
    journal-malformed) echo 'not attributed to the backup timer: a journal entry is not valid JSON';;
    journal-no-invocation) echo 'not attributed to the backup timer: a journal entry of afldb-backup\.service carries no valid invocation ID';;
    no-timer-property) echo 'not attributed to the backup timer: afldb-backup\.timer LastTriggerUSec is missing or unreadable';;
    timer-run-failed) echo 'not attributed to the backup timer: the timer.s run did not succeed: Result=exit-code ExecMainStatus=1';;
    no-completion) echo 'not attributed to the backup timer: the service.s last run has no completion';;
    no-ok-line) echo "not attributed to the backup timer: invocation [0-9a-f]{32} logged 0 'backup ok' lines";;
    two-ok-lines) echo "not attributed to the backup timer: invocation [0-9a-f]{32} logged 2 'backup ok' lines";;
    ok-line-after-run) echo 'not attributed to the backup timer: invocation [0-9a-f]{32} logged at epoch [0-9]+, outside its own run';;
    no-dump) echo 'dump not attributable: no afldb_prod-20261125-02\[23\]\*\.dump';;
    two-dumps) echo 'dump not attributable: ambiguous: 2 dumps in the 02:2x/02:3x window';;
    bad-sidecar) echo 'dump not attributable: afldb_prod-20261125-022001\.dump re-hash [0-9a-f]{64} != sidecar';;
    # r6 format 2: the root record binds the dump, so a "backup ok" line naming another dump or hash is refused by attested_origin
    # (r6 rev 1 expected pick_overnight_dump's "dump not attributable: the service reported ..."; the expected text changed by design)
    journal-other-name) echo "scheduled origin unproven: record [^ ]+ binds the dump afldb_prod-20261125-022001\.dump, but the run's 'backup ok' line \(read through node\) names afldb_prod-20261125-022002\.dump";;
    journal-other-hash) echo "scheduled origin unproven: record [^ ]+ binds afldb_prod-20261125-022001\.dump with sha256 [0-9a-f]{16}\.\.\., but the 'backup ok' line says 0000000000000000";;
    # r6
    attest-not-installed-r5-line|attest-execpost-missing) echo 'scheduled origin unproven: afldb-backup\.service has 0 ExecStartPost commands';;
    attest-execpost-two) echo 'scheduled origin unproven: afldb-backup\.service has 2 ExecStartPost commands';;
    attest-forged-trigger-no-record|attest-record-of-other-invocation) echo 'scheduled origin unproven: no root record /var/lib/afldb-backup-attest/[0-9a-f]{32}\.attest: the writer did not attest invocation [0-9a-f]{32}';;
    attest-envfile) echo 'scheduled origin unproven: afldb-backup\.service has 1 EnvironmentFile= entries';;
    attest-execpost-not-privileged) echo "scheduled origin unproven: afldb-backup\\.service ExecStartPost flags are 'ignore-failure', not 'ignore-failure privileged'";;
    attest-execpost-other-argv) echo "scheduled origin unproven: afldb-backup\\.service ExecStartPost is not the attestation writer's command line";;
    attest-dropin-not-loaded) echo 'scheduled origin unproven: afldb-backup\.service DropInPaths lacks /etc/systemd/system/afldb-backup\.service\.d/60-afldb-backup-attest\.conf';;
    attest-fragment-under-home) echo 'scheduled origin unproven: untrusted path: /home/arm is owned by uid 1000, not root';;
    attest-extra-dropin-arm-owned) echo 'scheduled origin unproven: untrusted path: /etc/systemd/system/afldb-backup\.service\.d/99-arm\.conf is owned by uid 1000';;
    attest-timer-dropin-writable) echo 'scheduled origin unproven: untrusted path: /etc/systemd/system/afldb-backup\.timer\.d/x\.conf has mode 666';;
    attest-helper-writable) echo 'scheduled origin unproven: untrusted path: /usr/bin/timeout has mode 777';;
    attest-writer-digest) echo 'scheduled origin unproven: the writer /usr/local/libexec/afldb/afldb-backup-attest has sha256 [0-9a-f]{16}\.\.\., not the pinned';;
    attest-writer-arm-owned) echo 'scheduled origin unproven: untrusted path: /usr/local/libexec/afldb/afldb-backup-attest is owned by uid 1000';;
    attest-writer-dir-writable) echo 'scheduled origin unproven: untrusted path: /usr/local/libexec/afldb has mode 775';;
    attest-dropin-digest) echo 'scheduled origin unproven: the drop-in /etc/systemd/system/afldb-backup\.service\.d/60-afldb-backup-attest\.conf has sha256';;
    attest-record-arm-owned) echo 'scheduled origin unproven: untrusted record: /var/lib/afldb-backup-attest/[0-9a-f]{32}\.attest is owned by uid 1000';;
    attest-record-group-writable) echo 'scheduled origin unproven: untrusted record: /var/lib/afldb-backup-attest/[0-9a-f]{32}\.attest has mode 664';;
    attest-record-other-writable) echo 'scheduled origin unproven: untrusted record: /var/lib/afldb-backup-attest/[0-9a-f]{32}\.attest has mode 646';;
    attest-record-symlink) echo 'scheduled origin unproven: untrusted record: /var/lib/afldb-backup-attest/[0-9a-f]{32}\.attest is a symbolic link';;
    attest-record-nlink2) echo 'scheduled origin unproven: untrusted record: /var/lib/afldb-backup-attest/[0-9a-f]{32}\.attest has 2 hard links';;
    attest-record-dir-arm-owned) echo 'scheduled origin unproven: untrusted record directory: /var/lib/afldb-backup-attest is owned by uid 1000';;
    attest-record-dir-writable) echo 'scheduled origin unproven: untrusted record directory: /var/lib/afldb-backup-attest has mode 777';;
    attest-record-parent-writable) echo 'scheduled origin unproven: untrusted record directory: /var/lib has mode 777';;
    attest-record-dir-symlink) echo 'scheduled origin unproven: untrusted record directory: /var/lib/afldb-backup-attest is a symbolic link';;
    attest-duplicate-dispatch) echo 'scheduled origin unproven: 2 records in /var/lib/afldb-backup-attest name the dispatch at [0-9]+ us';;
    attest-trigger-other-unit) echo "scheduled origin unproven: record [^ ]+: the run's start job names trigger unit 'afldb-backup-verify\\.timer'";;
    attest-wrong-invocation-field) echo 'scheduled origin unproven: record [^ ]+ names invocation [0-9a-f]{32}, not the run.s';;
    attest-usec-plus-1|attest-usec-minus-1|attest-stale-dispatch) echo 'scheduled origin unproven: record [^ ]+: the run.s start job records the dispatch at [0-9]+ us, but the timer.s LastTriggerUSec is [0-9]+ us';;
    attest-timer-usec-at-write-differs) echo 'scheduled origin unproven: record [^ ]+: the timer.s LastTriggerUSec was [0-9]+ us when attested';;
    attest-restart-ordering|attest-inactive-enter-equal) echo 'scheduled origin unproven: record [^ ]+: the unit entered inactive \(monotonic [0-9]+\) after the dispatch';;
    attest-exit-before-dispatch|attest-start-before-dispatch) echo 'scheduled origin unproven: record [^ ]+: inactive-exit [0-9]+ or main start [0-9]+ \(monotonic\) precedes the dispatch';;
    attest-start-over-5s|attest-exit-over-5s) echo 'scheduled origin unproven: record [^ ]+: the unit left inactive [0-9]+ us and its main process started [0-9]+ us after the dispatch \(more than 5 s\)';;
    attest-job-restart) echo 'scheduled origin unproven: record [^ ]+: the run.s job is a restart job, not a start job';;
    attest-state-active) echo 'scheduled origin unproven: record [^ ]+: the unit was active/exited when attested';;
    attest-exec-status-1) echo 'scheduled origin unproven: record [^ ]+: ExecStart ended with code 1 status 1, not exited 0';;
    attest-exec-code-killed) echo 'scheduled origin unproven: record [^ ]+: ExecStart ended with code 2 status 15';;
    attest-record-writer-sha) echo 'scheduled origin unproven: record [^ ]+ was written by writer 0000000000000000\.\.\., not the pinned';;
    attest-malformed-extra-line) echo 'scheduled origin unproven: record [^ ]+ is malformed \(23 lines';;
    attest-malformed-missing-line) echo 'scheduled origin unproven: record [^ ]+ is malformed \(21 lines';;
    attest-malformed-header) echo 'scheduled origin unproven: record [^ ]+ is malformed \(22 lines';;
    attest-format-1) echo 'scheduled origin unproven: record [^ ]+ is malformed \(20 lines, need the 22-line afldb-backup-attest/2 format';;
    attest-dump-none) echo 'scheduled origin unproven: record [^ ]+: the writer found no single dump of this run \(dump=none';;
    attest-dump-name-differs) echo "scheduled origin unproven: record [^ ]+ binds the dump afldb_prod-20261125-022130\.dump, but the run's 'backup ok' line \(read through node\) names afldb_prod-20261125-022001\.dump";;
    attest-dump-sha16-differs) echo "scheduled origin unproven: record [^ ]+ binds afldb_prod-20261125-022001\.dump with sha256 [0-9a-f]{16}\.\.\., but the 'backup ok' line says [0-9a-f]{16}";;
    attest-dump-full-sha-differs) echo 'scheduled 02:2x dump afldb_prod-20261125-022001\.dump sha256 [0-9a-f]{64} is not the dump the root record bound|scheduled dump afldb_prod-20261125-022001\.dump sha256 [0-9a-f]{64} is not the dump the root record bound';;
    attest-node-lies-planted-dump) echo "scheduled origin unproven: record [^ ]+ binds the dump afldb_prod-20261125-022001\.dump, but the run's 'backup ok' line \(read through node\) names afldb_prod-20261125-022130\.dump";;
    attest-malformed-reordered) echo 'scheduled origin unproven: record [^ ]+ line 3 is not unit=<value>';;
    attest-malformed-crlf|attest-malformed-value) echo 'scheduled origin unproven: record [^ ]+ line 5 is not job=<value>';;
    attest-malformed-trailing-space) echo 'scheduled origin unproven: record [^ ]+ line 6 is not job_type=<value>';;
    attest-malformed-no-final-newline) echo 'scheduled origin unproven: record [^ ]+ has [0-9]+ bytes, not the [0-9]+ of its 22 lines';;
    attest-malformed-nul) echo 'scheduled origin unproven: record [^ ]+ (line 7 is not active_state=<value>|has [0-9]+ bytes, not the)';;
    attest-malformed-duplicate-key) echo 'scheduled origin unproven: record [^ ]+ line 21 is not boot_id=<value>';;
    attest-malformed-empty) echo 'scheduled origin unproven: untrusted record: /var/lib/afldb-backup-attest/[0-9a-f]{32}\.attest is a regular empty file, not a regular file';;
    *) echo 'NO-SUCH-SCENARIO';;
  esac
}
# r6: the scenarios that must PASS at both gates (f2 runs them through each main with want_pass)
F23_PASS_SCENARIOS=(genuine genuine-pid1-lines genuine-current-script genuine-r5-script trigger-stale-dispatch trigger-off-by-1us trigger-seconds-only
  trigger-two-lines trigger-timer-and-none trigger-other-invocation-field trigger-other-unit trigger-malformed trigger-note-only
  attest-exit-after-start attest-exit-before-start attest-start-5s-exactly attest-first-run-since-boot attest-other-dispatch-records
  attest-leftover-tmp attest-timer-rearmed)
F23_ATTEST_STOP_SCENARIOS=(attest-not-installed-r5-line attest-forged-trigger-no-record attest-astra-forged-trigger attest-envfile
  attest-execpost-missing attest-execpost-two attest-execpost-not-privileged attest-execpost-other-argv attest-dropin-not-loaded
  attest-fragment-under-home attest-extra-dropin-arm-owned attest-timer-dropin-writable attest-helper-writable attest-writer-digest
  attest-writer-arm-owned attest-writer-dir-writable attest-dropin-digest attest-record-of-other-invocation attest-record-arm-owned
  attest-record-group-writable attest-record-other-writable attest-record-symlink attest-record-nlink2 attest-record-dir-arm-owned
  attest-record-dir-writable attest-record-parent-writable attest-record-dir-symlink attest-duplicate-dispatch attest-trigger-none
  attest-trigger-other-unit attest-wrong-invocation-field attest-usec-plus-1 attest-usec-minus-1 attest-stale-dispatch
  attest-timer-usec-at-write-differs attest-restart-ordering attest-inactive-enter-equal attest-exit-before-dispatch
  attest-start-before-dispatch attest-start-over-5s attest-exit-over-5s attest-job-restart attest-state-active attest-exec-status-1
  attest-exec-code-killed attest-record-writer-sha attest-malformed-extra-line attest-malformed-missing-line attest-malformed-reordered
  attest-malformed-header attest-malformed-crlf attest-malformed-trailing-space attest-malformed-value attest-malformed-no-final-newline
  attest-malformed-nul attest-malformed-duplicate-key attest-malformed-empty attest-format-1 attest-dump-none attest-dump-name-differs
  attest-dump-sha16-differs attest-dump-full-sha-differs attest-node-lies-planted-dump)

# ---- body of one function of a script, for the byte-identity assertions
f23_fn() { sed -n "/^$2() {/,/^}/p" "$1"; }
