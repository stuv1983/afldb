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
  f23_journal_reset; : > /fx/binv-mode
  f23_jline "$F23_BINV" 02:20:01 "target: mode=backup dir=$F23_BK keep=14 offhost=none tools=$F23_CHK/tools/maintenance"
  f23_jline "$F23_BINV" 02:20:19 "backup ok: $F23_SD 4096 bytes sha256 ${F23_SS:0:16} offhost=skipped"
  rm -f "$F23_BK"/.state/FAILED-*
}
# A start by hand at <start>, exit <exit> (HH:MM:SS), success, its own invocation and dump; the caller sets the timer and any
# earlier journal lines first (the journal is NOT reset here).
f23_manual_run() { # start exit
  f23_dump "$(tr -d : <<< "$1")"
  f23_set afldb-backup.service ExecMainStartTimestamp "@$(f23_ep "$F23_DAY $1")"; f23_set afldb-backup.service ExecMainExitTimestamp "@$(f23_ep "$F23_DAY $2")"
  f23_set afldb-backup.service InvocationID "$F23_BINV2"; f23_set afldb-backup.service Result success; f23_set afldb-backup.service ExecMainStatus 0
  f23_jline "$F23_BINV2" "$1" "target: mode=backup dir=$F23_BK keep=14 offhost=none tools=$F23_CHK/tools/maintenance"
  f23_jline "$F23_BINV2" "$2" "backup ok: $F23_SD 4096 bytes sha256 ${F23_SS:0:16} offhost=skipped"
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
  chmod 755 /usr/local/bin/date /usr/local/bin/uname /usr/local/bin/dpkg-query /usr/local/bin/systemctl /usr/local/bin/journalctl \
    /usr/local/bin/psql /usr/local/bin/df /usr/local/bin/awk /usr/local/bin/pg_isready /usr/local/bin/curl
  : > /fx/inv-mode; : > /fx/binv-mode; : > /fx/inv-calls; echo "$F23_INV_OTHER" > /fx/inv-other; echo ok > /fx/journal-mode
  chmod 666 /fx/inv-calls; chmod 644 /fx/inv-mode /fx/binv-mode /fx/inv-other /fx/journal-mode /fx/now
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

# ---- suite f2: one named state of the 02:20 backup evidence, always built from the genuine state
f23_scenario() { # name
  local tgt="target: mode=backup dir=$F23_BK keep=14 offhost=none tools=$F23_CHK/tools/maintenance" okl
  f23_backup_genuine
  okl="backup ok: $F23_SD 4096 bytes sha256 ${F23_SS:0:16} offhost=skipped"
  case $1 in
    genuine) ;;
    genuine-pid1-lines)        # arm can read PID 1's lines about the same invocation: still the timer's run
      f23_jpid1 "$F23_BINV" 02:20:01 "Starting afldb-backup.service - AFLDB scheduled backup..."
      f23_jpid1 "$F23_BINV" 02:20:19 "Finished afldb-backup.service - AFLDB scheduled backup.";;
    manual-no-timer)           # the timer did not dispatch today (last trigger: Tuesday); someone started the service at 02:24:10
      f23_set afldb-backup.timer LastTriggerUSec "@$(f23_ep "2026-11-24 02:20:00")"; f23_journal_reset; f23_manual_run 02:24:10 02:24:30;;
    timer-failed-then-manual)  # the timer fired, its own run logged and failed; a start by hand four minutes later succeeded
      f23_journal_reset; f23_jline "$F23_BINV" 02:20:01 "$tgt"; f23_jline "$F23_BINV" 02:20:03 "AFLDB_BACKUP_FAILURE mode=backup step=backup exit=1"
      f23_manual_run 02:24:10 02:24:30;;
    manual-within-5s)          # as above, but the start by hand is 3 s after the dispatch: the timing links alone would hold
      f23_journal_reset; f23_jline "$F23_BINV" 02:20:00 "$tgt"; f23_jline "$F23_BINV" 02:20:01 "AFLDB_BACKUP_FAILURE mode=backup step=backup exit=1"
      f23_manual_run 02:20:03 02:20:25;;
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
    journal-other-name) f23_journal_reset; f23_jline "$F23_BINV" 02:20:01 "$tgt"
      f23_jline "$F23_BINV" 02:20:19 "backup ok: afldb_prod-$F23_DAYC-022002.dump 4096 bytes sha256 ${F23_SS:0:16} offhost=skipped";;
    journal-other-hash) f23_journal_reset; f23_jline "$F23_BINV" 02:20:01 "$tgt"
      f23_jline "$F23_BINV" 02:20:19 "backup ok: $F23_SD 4096 bytes sha256 0000000000000000 offhost=skipped";;
    *) echo "STOP unknown scenario $1"; return 1;;
  esac
}
# The reason (extended regex, matched inside one FAIL line) each non-genuine scenario must be refused for.
f23_reason() { # name
  case $1 in
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
    journal-other-name|journal-other-hash) echo "dump not attributable: the service reported '[^']*', not afldb_prod-20261125-022001\.dump sha256 [0-9a-f]{16}";;
    *) echo 'NO-SUCH-SCENARIO';;
  esac
}

# ---- body of one function of a script, for the byte-identity assertions
f23_fn() { sed -n "/^$2() {/,/^}/p" "$1"; }
