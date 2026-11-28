#!/usr/bin/env bash
# REHEARSAL ONLY (R6 r4, 27 Nov 2026): the r3 suite (24 Nov) ported to the r4 scripts. Changes from r3, all in the FIXTURE:
#   * the fixture Tuesday records carry the complete result and binding lines the r4 handoff parser requires; the handoff
#     STOP cases moved to cases/f1-handoff.sh (70 cases), so section H here keeps only the valid records O and R consume;
#   * the fixture host has the 02:20 timer dispatch, the backup service InvocationID and exit time, and a JSON journal for
#     afldb-backup.service, which A-2 section 5 now requires (cases/f2-backup-attribution.sh holds the attribution cases).
# Runs as root INSIDE a disposable container started by rehearse-r4.sh (docker run --rm
# --network none, hostname set by docker; never on a real host). Exercises the STAGED R6 scripts byte for byte:
#   role prod (hostname afldb-prod):
#     H  r6-tuesday-handoff.sh on fixture Tuesday records written under /tmp of THIS container (never the real record);
#     U  A-2 argument rules (usage STOP, exit 2);
#     O  A-2 for the three Tuesday outcomes (released, rolledback, deferred) with the handoff helper's own output as arguments,
#        on a fixture that passes every other A-2 check: the real 17822b29 deploy/release.mjs against a sandbox release root
#        served by the real 17822b29 supervisor over the rehearsal stub server (2 workers);
#     R  per outcome, a later restart with events.log unreadable, malformed, or superseded by an unconfirmed status-pass: plain
#        status still reports PASS and the r2 A-2 (7af24a74) passes (the false PASS); the r4 A-2 STOPs on the InvocationID only;
#     I  InvocationID read failures; C  earlier contrast cases; S  stub release.mjs outputs incl. CRLF FAIL + LF PASS;
#     F  the F-4 entry point (valid, detectors, wrong user, changed helper).
#   role wronghost (hostname afldb-dev): the F-4 entry point as arm on the wrong host, and Sunday's bare helper for contrast.
# Production-only facts that are not under test (kernel list, systemd, journal, psql, df, the clock) are fixture shims in
# /usr/local/bin; files A-2 reads by absolute path are fixture files at those paths. The staged scripts are never edited.
# Every A-2 run compares events.log byte for byte. R6_REH_SABOTAGE=<label> (driver self-test only) inverts that one case's
# expectation, so the suite must fail.
set -uo pipefail; export LC_ALL=C
ROLE=${1:?role}; SAB=${R6_REH_SABOTAGE:-}
[ -f /.dockerenv ] || { echo "REFUSED: container only"; exit 2; }
ST=/in/stage; FX=/in/fix; B=docs/v2/evidence/backlog-20261121; RH=$FX/docs/v2/evidence/release-17822b29-20261124/rehearsal
HD=$FX/$B/r6-20261125/review-fixes-r3-20261124
PRE=$ST/$B/r6-20261125/r6-pre-verify.sh; ENTRY=$ST/$B/r6-20261125/r6-rawhead-check.sh; A1=$ST/$B/a1a2-20261124/a1-rawhead.sh
HAND=$ST/$B/r6-20261125/r6-tuesday-handoff.sh
OLDR2=$HD/orig-r6-pre-verify-r2-7af24a74.sh; OLD58=$FX/$B/r6-20261125/review-fixes-20261123/orig-r6-pre-verify-58e35ce8.sh
NODE=/home/arm/.nvm/versions/node/v22.23.2/bin/node
CHK=/home/arm/projects/afldb; ROOT=/home/arm/afldb-releases; BK=/home/arm/backups/afldb-scheduled; BL=/home/arm/a1-rawhead-baseline.json
CUR=17822b29e6de-R6fixRehearsalBuild01x; NEWB=R6fixRehearsalBuild01x
PREV=7d92042fd110-XWruOm_9nLCSMY8nGPqYU; PREVB=XWruOm_9nLCSMY8nGPqYU
SUNP=c8d4202a4cb3-aATnIlFOIQjq2z5oDdoHC; SUNPB=aATnIlFOIQjq2z5oDdoHC
SUN=342040625f6d4012a35d598dfbf9afe6                                   # Sunday's attested restart (A1, 22 Nov), the real value
INV_TUE=3f1e5a0c9b7d4e2f8a6c1b0d9e8f7a6b; INV_RB=5b4a39281706f5e4d3c2b1a098f7e6d5; INV_LATE=9a8b7c6d5e4f30211203f4e5d6c7b8a9
P=0; F=0
ok() { echo "REH PASS $1"; P=$((P+1)); }
no() { echo "REH FAIL $1"; F=$((F+1)); }
sab() { if [ -n "$SAB" ] && [ "$1" = "$SAB" ]; then echo "   SABOTAGE: expectation of [$1] inverted (driver self-test)" >&2
  case $2 in pass) echo stop;; *) echo pass;; esac; else echo "$2"; fi; }
mel_ep() { TZ=Australia/Melbourne /usr/bin/date -d "$1" +%s; }
as_user() { local u=$1; shift; setpriv --reuid="$u" --regid="$u" --init-groups env -i HOME="/home/$u" USER="$u" LOGNAME="$u" \
  PATH=/usr/local/bin:/usr/bin:/bin LANG=C.UTF-8 "$@"; }
echo "== R6 r4 in-container role=$ROLE $(/usr/bin/date -u +%FT%TZ) hostname=$(hostname) image-os=$(. /etc/os-release; echo "$PRETTY_NAME")"
echo "   staged sha256: $(sha256sum < "$PRE" | cut -c1-64) r6-pre-verify.sh; $(sha256sum < "$ENTRY" | cut -c1-64) r6-rawhead-check.sh"
echo "   staged sha256: $(sha256sum < "$HAND" | cut -c1-64) r6-tuesday-handoff.sh; $(sha256sum < "$A1" | cut -c1-64) a1-rawhead.sh"
echo "   staged modes: $(stat -c '%a %u' "$PRE") (staging umask 077); contrast copies: r2 $(sha256sum < "$OLDR2" | cut -c1-16) 58e35ce8 $(sha256sum < "$OLD58" | cut -c1-16)"

# ---------------------------------------------------------------- users, clock and shims
userdel -r ubuntu >/dev/null 2>&1; useradd -M -u 1000 -s /bin/bash arm && useradd -m -s /bin/bash ops || { echo "STOP users"; exit 1; }
chown arm:arm /home/arm; chmod 755 /home/arm
mkdir -p /fx && chmod 755 /fx
mel_ep "2026-11-25 09:25:00" > /fx/now                      # Wednesday 09:25 AEDT, A-2's slot in R6 section 8
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
# Fixture systemctl: values from /fx/sysd.tbl ("unit|property|value"; "@epoch" values are rendered per --timestamp).
# /fx/inv-mode (fail|empty|malformed|multi|upper) changes ONLY the single-property read `show afldb -p InvocationID`, which is
# A-2's own comparison read; release.mjs reads several properties at once and is not affected.
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
    if [ "$unit" = afldb ] && [ "${props[*]}" = InvocationID ] && [ -s /fx/inv-mode ]; then
      real=$(look afldb InvocationID)
      case $(cat /fx/inv-mode) in
        fail) echo "Failed to connect to bus: fixture failure" >&2; exit 1;;
        empty) real=;;
        malformed) real="not-an-id";;
        multi) real=$(printf '%s\n%s' "$real" "$real");;
        upper) real=$(printf '%s' "$real" | tr a-f A-F);;
      esac
      if [ "$value" = 1 ]; then printf '%s\n' "$real"; else printf 'InvocationID=%s\n' "$real"; fi; exit 0
    fi
    for p in "${props[@]}"; do
      v=$(look "$unit" "$p") || v=
      if [[ $v == @* ]]; then e=${v#@}; case $ts in
        unix) v="@$e";; utc) v=$(TZ=UTC /usr/bin/date -d "@$e" '+%a %Y-%m-%d %H:%M:%S UTC');;
        *) v=$(TZ=Australia/Melbourne /usr/bin/date -d "@$e" '+%a %Y-%m-%d %H:%M:%S %Z');; esac; fi
      if [ "$value" = 1 ]; then printf '%s\n' "$v"; else printf '%s=%s\n' "$p" "$v"; fi
    done;;
  *) exit 1;;
esac
SH
cat > /usr/local/bin/journalctl <<'SH'
#!/bin/bash
u=; o=; while [ $# -gt 0 ]; do case $1 in -u) u=$2; shift 2;; -o) o=$2; shift 2;; *) shift;; esac; done
case "$u/$o" in afldb-backup.service/cat) cat /fx/journal-backup.txt;; afldb-backup.service/json) cat /fx/journal-backup.json;; afldb-backup-verify.service/json) cat /fx/journal-verify.json;; esac
SH
cat > /usr/local/bin/busctl <<'SH'
#!/bin/bash
# Fixture busctl (R6 r5): the one read the gates make, `busctl get-property org.freedesktop.systemd1 <afldb-backup.timer path>
# org.freedesktop.systemd1.Timer LastTriggerUSec`, printed as the real tool does ("t <microseconds>") from the fixture table.
[ "$*" = "get-property org.freedesktop.systemd1 /org/freedesktop/systemd1/unit/afldb_2dbackup_2etimer org.freedesktop.systemd1.Timer LastTriggerUSec" ] \
  || { echo "fixture busctl: unsupported: $*" >&2; exit 1; }
v=$(awk -F'|' '$1=="afldb-backup.timer" && $2=="LastTriggerUSecRaw" { print $3; f=1; exit } END { exit !f }' /fx/sysd.tbl) || { echo "t 0"; exit 0; }
echo "t $v"
SH
cat > /usr/local/bin/psql <<'SH'
#!/bin/bash
cat > /dev/null
echo "ledger|118|118_fixtures_unconfirmed_participants.sql"
echo "rt|afldb_restore_test|afldb.restore_test.v1 sha256=$(cat /fx/verify.sha)|0"
SH
cat > /usr/local/bin/df <<'SH'
#!/bin/bash
case " $* " in *" -Pm "*) printf 'Filesystem 1048576-blocks Used Available Capacity Mounted on\n/dev/vda1 50000 20000 30000 40%% /\n';;
  *) printf 'Filesystem Size Used Avail Use%% Mounted on\n/dev/vda1 49G 20G 29G 40%% /\n/dev/vda16 881M 100M 720M 13%% /boot\n';; esac
SH
cat > /usr/local/bin/mktemp <<'SH'
#!/bin/bash
echo "mktemp $*" >> /fx/mktemp-calls; exec /usr/bin/mktemp "$@"
SH
chmod 755 /usr/local/bin/*; : > /fx/mktemp-calls; : > /fx/env-opened; : > /fx/inv-mode; chmod 666 /fx/mktemp-calls /fx/env-opened; chmod 644 /fx/inv-mode
ln -sf /usr/share/zoneinfo/Australia/Melbourne /etc/localtime     # production's zone

# ---------------------------------------------------------------- host files A-2 reads by absolute path
mkdir -p /boot /lib/modules/6.8.0-149-generic /lib/modules/6.8.0-137-generic /etc/caddy /etc/needrestart/conf.d /etc/apt/apt.conf.d /var/run
for k in 137 149; do printf 'fixture\n' > /boot/vmlinuz-6.8.0-$k-generic; printf 'fixture\n' > /boot/initrd.img-6.8.0-$k-generic; done
: > /var/run/reboot-required
cp "$FX/deploy/Caddyfile.production" /etc/caddy/Caddyfile
cp "$FX/deploy/host-policy/needrestart-afldb-hold.conf" /etc/needrestart/conf.d/50-afldb-hold.conf
cp "$FX/deploy/host-policy/apt-52-afldb-unattended.conf" /etc/apt/apt.conf.d/52-afldb-unattended
mkdir -p /var/log/afldb-r5-prefix-retained-20261124

# ---------------------------------------------------------------- checkout (real 17822b29 blobs) and .env
mkdir -p "$CHK/deploy/host-policy" "$CHK/tools/build" "$CHK/tools/maintenance"
for f in deploy/release.mjs deploy/server-cluster.mjs deploy/afldb-settle-failure-status.sh deploy/host-policy/needrestart-afldb-hold.conf \
  deploy/host-policy/apt-52-afldb-unattended.conf tools/build/env-in-standalone.mjs tools/maintenance/scheduled-backup.sh; do cp "$FX/$f" "$CHK/$f"; done
SEC1=$(head -c 32 /dev/urandom | od -An -tx1 | tr -d ' \n'); SEC2=$(head -c 32 /dev/urandom | od -An -tx1 | tr -d ' \n')
printf '%s\n' AFLDB_WORKERS=2 AFLDB_BETA_GATE=on AFLDB_BETA_EPOCH=1 "AFLDB_SESSION_SECRET=$SEC1" \
  "AFLDB_REVALIDATE_URL=http://127.0.0.1:3100/api/internal/revalidate-season" "AFLDB_REVALIDATE_SECRET=$SEC2" \
  'AFLDB_BACKUP_DATABASE_URL=postgresql://afldb_backup:fixture%21pw@127.0.0.1:5432/afldb_prod' > /fx/env.common
{ echo PORT=3101; cat /fx/env.common; } > /fx/env.probe        # the raw-head probe reaches the server through the counter
{ echo PORT=3100; cat /fx/env.common; } > /fx/env.server
cp /fx/env.probe "$CHK/.env"; chmod 600 /fx/env.*

# ---------------------------------------------------------------- release root: the three releases, real supervisor, stub server
mk() { local id=$1 bid=$2 d=$ROOT/releases/$1
  mkdir -p "$d/deploy" "$d/.next/standalone/.next" && cp "$FX/deploy/server-cluster.mjs" "$d/deploy/server-cluster.mjs" \
  && cp "$RH/stub-server.cjs" "$d/.next/standalone/server.js" && printf '%s' "$bid" > "$d/.next/standalone/.next/BUILD_ID" \
  && "$NODE" "$RH/make-release.mjs" "$CHK" "$d" "$id" 17822b29e6de2b6248cd7ada4221800fd81e0003 "$bid"; }
mkdir -p "$ROOT/releases"; mk "$CUR" "$NEWB" && mk "$PREV" "$PREVB" && mk "$SUNP" "$SUNPB" || { echo "STOP releases"; exit 1; }
chown -R arm:arm /home/arm/projects /home/arm/afldb-releases

# ---------------------------------------------------------------- backup state for A-2 section 5 (Wednesday 02:20 and 03:30)
mkdir -p "$BK/.state"
SD=afldb_prod-20261125-022001.dump; VD=afldb_prod-20261125-033012.dump
head -c 4096 /dev/urandom > "$BK/$SD"; SS=$(sha256sum < "$BK/$SD" | cut -c1-64); printf '%s  %s\n' "$SS" "$SD" > "$BK/$SD.sha256"
head -c 4096 /dev/urandom > "$BK/$VD"; VS=$(sha256sum < "$BK/$VD" | cut -c1-64); printf '%s  %s\n' "$VS" "$VD" > "$BK/$VD.sha256"
BT=$(mel_ep "2026-11-25 02:20:00"); BX=$(mel_ep "2026-11-25 02:20:06"); BJ=$(mel_ep "2026-11-25 02:20:05"); BINV=7a6b5c4d3e2f41a0b9c8d7e6f5a4b3c2
BTU=$((BT * 1000000 + 123456)); BS=$(mel_ep "2026-11-25 02:20:01"); VT=$(mel_ep "2026-11-25 03:30:00"); VSS=$(mel_ep "2026-11-25 03:30:02")
VE=$(mel_ep "2026-11-25 03:31:20"); JT=$(mel_ep "2026-11-25 03:31:25"); VX=$(mel_ep "2026-11-25 03:31:30")
printf '{"epoch":%s,"file":"%s","sha256":"%s","attempts":1}\n' "$VE" "$VD" "$VS" > "$BK/.state/last-verify.json"
printf '{"epoch":%s,"file":"%s","sha256":"%s","offhost":"none"}\n' "$(mel_ep "2026-11-25 03:30:20")" "$VD" "$VS" > "$BK/.state/last-backup.json"
echo "$VS" > /fx/verify.sha
echo "Wed 2026-11-25 02:20:01 afldb-prod scheduled-backup: trigger: invocation=$BINV job=4242 unit=afldb-backup.timer realtime_usec=$BTU" > /fx/journal-backup.txt
echo "Wed 2026-11-25 02:20:05 afldb-prod scheduled-backup: backup ok: $SD 4096 bytes sha256 ${SS:0:16}" >> /fx/journal-backup.txt
# r4: the same completion as the service's own JSON journal entry (timer dispatch 02:20:00, start :01, this line :05, exit :06)
# r5: the timer's run also logs the trigger line of its start job (journal line at :01, usec = the timer's LastTriggerUSec)
printf '{"__REALTIME_TIMESTAMP":"%s000000","_UID":"1000","_PID":"4711","_SYSTEMD_UNIT":"afldb-backup.service","_SYSTEMD_INVOCATION_ID":"%s","MESSAGE":"2026-11-25T02:20:01+11:00 scheduled-backup: trigger: invocation=%s job=4242 unit=afldb-backup.timer realtime_usec=%s"}\n' "$BS" "$BINV" "$BINV" "$BTU" > /fx/journal-backup.json
printf '{"__REALTIME_TIMESTAMP":"%s000000","_UID":"1000","_PID":"4711","_SYSTEMD_UNIT":"afldb-backup.service","_SYSTEMD_INVOCATION_ID":"%s","MESSAGE":"2026-11-25T02:20:05+11:00 scheduled-backup: backup ok: %s 4096 bytes sha256 %s"}\n' "$BJ" "$BINV" "$SD" "${SS:0:16}" >> /fx/journal-backup.json
printf '{"MESSAGE":"2026-11-25T03:31:25+11:00 scheduled-backup: verify ok: %s restored and proven (attempt 1)","_SYSTEMD_UNIT":"afldb-backup-verify.service","_SYSTEMD_INVOCATION_ID":"0d1c2b3a4f5e60718293a4b5c6d7e8f9","__REALTIME_TIMESTAMP":"%s000000"}\n' "$VD" "$JT" > /fx/journal-verify.json
chown -R arm:arm /home/arm/backups
# r6 (28 Nov): the trigger line above is ignored now (the r5 origin rule is withdrawn); the origin is the ROOT writer's record. The
# install (the real reviewed writer and drop-in, root-owned, at their real paths) and the record come from cases/lib-f23-fixture.sh.
. "$FX/$B/r6-20261125/review-fixes-r4-20261127/cases/lib-f23-fixture.sh" || { echo "REH STOP cannot load lib-f23-fixture.sh"; exit 1; }
f23_attest_install "$FX" || { echo "REH STOP the attestation install failed"; exit 1; }
f23_attest_record "$BINV" afldb-backup.timer "$BTU" "dump=$SD" "dump_sha256=$SS"   # format 2: the record binds the dump

# ---------------------------------------------------------------- systemd fixture table and timers
THU=$(mel_ep "2026-11-26 02:20:00"); THV=$(mel_ep "2026-11-26 03:30:00"); THA=$(mel_ep "2026-11-26 06:30:00")
cat > /fx/list-unit-files.txt <<'TXT'
afldb-backup-verify.service static -
afldb-backup-verify.timer   enabled enabled
afldb-backup.service        static -
afldb-backup.timer          enabled enabled
afldb.service               enabled enabled
TXT
printf '%s\n' "Thu 2026-11-26 02:20:00 AEDT 16h - - afldb-backup.timer afldb-backup.service" \
  "Thu 2026-11-26 03:30:00 AEDT 18h - - afldb-backup-verify.timer afldb-backup-verify.service" \
  "Thu 2026-11-26 06:30:00 AEDT 21h - - apt-daily-upgrade.timer apt-daily-upgrade.service" > /fx/list-timers.txt
printf '[{"next":%s000000,"left":0,"last":0,"passed":0,"unit":"afldb-backup.timer","activates":"afldb-backup.service"},{"next":%s000000,"left":0,"last":0,"passed":0,"unit":"afldb-backup-verify.timer","activates":"afldb-backup-verify.service"},{"next":%s000000,"left":0,"last":0,"passed":0,"unit":"apt-daily-upgrade.timer","activates":"apt-daily-upgrade.service"}]\n' "$THU" "$THV" "$THA" > /fx/list-timers.json
sysd() { # MainPID InvocationID ActiveEnter-epoch
  cat > /fx/sysd.tbl <<TBL
afldb|ActiveState|active
afldb|MainPID|$1
afldb|InvocationID|$2
afldb|NRestarts|0
afldb|ActiveEnterTimestamp|@$3
afldb|MemoryCurrent|524288000
postgresql@16-main|ActiveState|active
caddy|ActiveState|active
apt-daily.service|ActiveState|inactive
apt-daily-upgrade.service|ActiveState|inactive
afldb-backup.service|ExecMainStartTimestamp|@$BS
afldb-backup.service|Result|success
afldb-backup.service|ExecMainStatus|0
afldb-backup.service|ExecMainExitTimestamp|@$BX
afldb-backup.service|InvocationID|$BINV
afldb-backup.timer|LastTriggerUSec|@$BT
afldb-backup.timer|LastTriggerUSecRaw|$BTU
afldb-backup-verify.service|ExecMainStartTimestamp|@$VSS
afldb-backup-verify.service|ExecMainExitTimestamp|@$VX
afldb-backup-verify.service|Result|success
afldb-backup-verify.service|ExecMainStatus|0
afldb-backup-verify.timer|LastTriggerUSec|@$VT
afldb-backup.timer|ActiveState|active
afldb-backup.timer|UnitFileState|enabled
afldb-backup.timer|Triggers|afldb-backup.service
afldb-backup-verify.timer|ActiveState|active
afldb-backup-verify.timer|UnitFileState|enabled
afldb-backup-verify.timer|Triggers|afldb-backup-verify.service
apt-daily-upgrade.timer|ActiveState|active
apt-daily-upgrade.timer|UnitFileState|enabled
apt-daily-upgrade.timer|Triggers|apt-daily-upgrade.service
TBL
  f23_attest_rows >> /fx/sysd.tbl   # r6: the unit rows attested_origin reads (FragmentPath, DropInPaths, ExecStartPostEx)
  chmod 644 /fx/sysd.tbl; }

# ---------------------------------------------------------------- the service: real supervisor, 2 workers; connection counter
SPID=
start_server() { # working directory
  # exec all the way down, so $! is the supervisor primary itself (systemd's MainPID on production)
  ( exec setpriv --reuid=arm --regid=arm --init-groups env -i HOME=/home/arm USER=arm PATH=/usr/bin:/bin \
      bash -c "cd '$1' && set -a && . /fx/env.server.arm && set +a && exec '$NODE' deploy/server-cluster.mjs" ) > /fx/server.log 2>&1 &
  SPID=$!
  for _ in $(seq 1 80); do
    "$NODE" -e "require('http').get('http://127.0.0.1:3100/api/health',r=>process.exit(r.statusCode===200?0:1)).on('error',()=>process.exit(1))" 2>/dev/null \
      && [ "$(pgrep -P "$SPID" | wc -l)" = 2 ] && return 0; sleep 0.25; done
  echo "STOP server did not come up"; cat /fx/server.log; exit 1; }
stop_server() { [ -n "$SPID" ] || return 0; kill "$SPID" 2>/dev/null; wait "$SPID" 2>/dev/null
  for _ in $(seq 1 40); do pgrep -f server-cluster.mjs >/dev/null || { SPID=; return 0; }; sleep 0.25; done; SPID=; }
cp /fx/env.server /fx/env.server.arm; chown arm /fx/env.server.arm
cat > /fx/count-proxy.cjs <<'JS'
const net = require('net'), fs = require('fs'), f = '/fx/conn-count';   // counts since the last probe_reset (file = 0)
net.createServer((c) => { let n = 0; try { n = Number(fs.readFileSync(f, 'utf8')) || 0; } catch {} fs.writeFileSync(f, String(n + 1)); const u = net.connect(3100, '127.0.0.1');
  c.pipe(u); u.pipe(c); c.on('error', () => u.destroy()); u.on('error', () => c.destroy()); }).listen(3101, '127.0.0.1');
JS
"$NODE" /fx/count-proxy.cjs & PROXY=$!

# ---------------------------------------------------------------- the three Tuesday outcomes as host states
# events(): what each outcome leaves in events.log (Sunday's lines first, then Tuesday's).
ev() { printf '%s\n' "$@" >> "$ROOT/events.log"; }
events() { # outcome
  : > "$ROOT/events.log"
  ev "{\"ts\":\"2026-11-22T03:40:00.000Z\",\"op\":\"promote\",\"id\":\"$PREV\",\"previous\":\"$SUNP\",\"window\":{\"at\":\"2026-11-22T03:40:00.000Z\",\"afldb\":{\"invocationId\":\"11112222333344445555666677778888\",\"nRestarts\":0}}}" \
     "{\"ts\":\"2026-11-22T03:45:00.000Z\",\"op\":\"status-pass\",\"id\":\"$PREV\",\"invocationId\":\"$SUN\",\"nRestarts\":0,\"restartConfirmation\":{\"invocationId\":\"$SUN\"}}"
  case $1 in released|rolledback)
    ev "{\"ts\":\"2026-11-24T00:30:00.000Z\",\"op\":\"promote\",\"id\":\"$CUR\",\"previous\":\"$PREV\",\"window\":{\"at\":\"2026-11-24T00:30:00.000Z\",\"afldb\":{\"invocationId\":\"$SUN\",\"nRestarts\":0}}}" \
       "{\"ts\":\"2026-11-24T00:40:00.000Z\",\"op\":\"status-pass\",\"id\":\"$CUR\",\"invocationId\":\"$INV_TUE\",\"nRestarts\":0,\"restartConfirmation\":{\"invocationId\":\"$INV_TUE\"}}";; esac
  case $1 in rolledback)
    ev "{\"ts\":\"2026-11-24T01:05:00.000Z\",\"op\":\"rollback\",\"id\":\"$PREV\",\"from\":\"$CUR\",\"attended\":true,\"window\":{\"at\":\"2026-11-24T01:05:00.000Z\",\"afldb\":{\"invocationId\":\"$INV_TUE\",\"nRestarts\":0}}}" \
       "{\"ts\":\"2026-11-24T01:12:00.000Z\",\"op\":\"status-pass\",\"id\":\"$PREV\",\"invocationId\":\"$INV_RB\",\"nRestarts\":0,\"restartConfirmation\":{\"invocationId\":\"$INV_RB\"}}";; esac
  chown arm:arm "$ROOT/events.log"; chmod 644 "$ROOT/events.log"
}
link() { rm -f "$ROOT/$1"; ln -s "releases/$2" "$ROOT/$1"; chown -h arm:arm "$ROOT/$1"; }
STATE=
state() { # outcome [live-InvocationID]: links, events.log, and the service (re)started in the right release
  local o=$1 inv enter run
  case $o in
    released)   link current "$CUR";  link previous "$PREV"; run=$CUR;  inv=$INV_TUE; enter="2026-11-24 11:33:10";;
    rolledback) link current "$PREV"; link previous "$CUR";  run=$PREV; inv=$INV_RB;  enter="2026-11-24 12:08:40";;
    deferred)   link current "$PREV"; link previous "$SUNP"; run=$PREV; inv=$SUN;     enter="2026-11-22 14:42:40";;
  esac
  [ -n "${2:-}" ] && { inv=$2; enter="2026-11-25 06:41:00"; }
  events "$o"; : > /fx/inv-mode
  stop_server; start_server "$ROOT/releases/$run"; sysd "$SPID" "$inv" "$(mel_ep "$enter")"; STATE="$o live=$inv"
  echo "   state $STATE: current -> $(readlink "$ROOT/current"), previous -> $(readlink "$ROOT/previous"), primary $SPID cwd $(as_user arm readlink /proc/$SPID/cwd), workers $(pgrep -P "$SPID" | wc -l)"
}

# ---------------------------------------------------------------- probe-detection helpers (F-4)
ENVW=
env_fifo_on() { mv "$CHK/.env" /fx/env.regular; mkfifo -m 666 "$CHK/.env"; : > /fx/env-opened; chmod 666 /fx/env-opened
  ( while :; do cat /fx/env.probe > "$CHK/.env"; echo opened >> /fx/env-opened; done ) & ENVW=$!; }
env_fifo_off() { kill "$ENVW" 2>/dev/null; wait "$ENVW" 2>/dev/null; rm -f "$CHK/.env"; mv /fx/env.regular "$CHK/.env"; }
probe_reset() { echo 0 > /fx/conn-count; : > /fx/mktemp-calls; : > /fx/env-opened; }
probe_seen() { printf 'connections=%s mktemp-calls=%s env-opens=%s' "$(cat /fx/conn-count)" "$(wc -l < /fx/mktemp-calls)" "$(wc -l < /fx/env-opened)"; }
probe_none() { [ "$(cat /fx/conn-count)" = 0 ] && [ ! -s /fx/mktemp-calls ] && [ ! -s /fx/env-opened ]; }

# ---------------------------------------------------------------- A-2 runners
OUT=; RC=; E0=; E1=
runs() { # script args...: one A-2 run as arm; events.log hashed before and after (as root, so an unreadable log is hashed too)
  E0=$(sha256sum < "$ROOT/events.log" | cut -c1-64)
  OUT=$(as_user arm bash "$@" 2>&1); RC=$?
  E1=$(sha256sum < "$ROOT/events.log" | cut -c1-64)
}
show() { # label: the decisive lines
  local n; n=$(grep -c '^FAIL' <<< "$OUT")
  echo "   [$1] rc=$RC fail-lines=$n events.log ${E0:0:16} -> ${E1:0:16}"
  grep -E '^(STOP|FAIL|PASS live InvocationID|PASS release\.mjs|PASS current|PASS exactly 2|INFO release\.mjs status exit)|^     release: (STATUS|note|FAIL)|^R6 PRE RESULT' <<< "$OUT" | sed 's/^/     | /'
}
same_log() { [ "$E0" = "$E1" ] && ok "[$1] events.log byte-identical across A-2" || no "[$1] events.log changed"; }
a2() { # label want(pass|stop|usage) expected-FAIL-lines required-regex -- A-2 args...
  local label=$1 want nfail=$3 rx=$4 n verdict; want=$(sab "$1" "$2"); shift 5
  runs "$PRE" "$@"; show "$label"; same_log "$label"
  n=$(grep -c '^FAIL' <<< "$OUT"); verdict=$(grep '^R6 PRE RESULT' <<< "$OUT")
  case $want in
    pass) [ "$RC" = 0 ] && [ "$n" = 0 ] && [ "$verdict" = "R6 PRE RESULT PASS" ] && grep -q '^PASS live InvocationID = the owner-attested' <<< "$OUT" \
            && grep -q "^PASS release\.mjs status (read-only): exit 0" <<< "$OUT" && ok "[$label] A-2 exit 0, R6 PRE RESULT PASS" || no "[$label] expected PASS (rc $RC, $n FAIL)";;
    stop) [ "$RC" = 1 ] && [ "$n" = "$nfail" ] && [[ $verdict == "R6 PRE RESULT STOP"* ]] && grep -Eq -- "$rx" <<< "$OUT" \
            && ok "[$label] A-2 exit 1, STOP, $n FAIL line(s) incl. /$rx/" || no "[$label] expected STOP with $nfail FAIL line(s) matching /$rx/ (rc $RC, $n)";;
    usage) [ "$RC" = 2 ] && [[ $(head -1 <<< "$OUT") == STOP* ]] && ! grep -q '^== R6 PRE' <<< "$OUT" && grep -Eq -- "$rx" <<< "$OUT" \
            && ok "[$label] A-2 exit 2 before any check (usage STOP)" || no "[$label] expected usage exit 2 (rc $RC)";;
  esac
}
a2old() { # label script args...: an earlier A-2 on the same fixture; passing is the defect being shown
  local label=$1; shift
  runs "$@"; show "$label"; same_log "$label"
  [ "$RC" = 0 ] && grep -qx 'R6 PRE RESULT PASS' <<< "$OUT" && ok "[$label] the earlier A-2 exits 0 with R6 PRE RESULT PASS here: the false PASS reproduced" \
    || no "[$label] the earlier A-2 did not pass (rc $RC): the defect was not reproduced"
}

# ---------------------------------------------------------------- fixture Tuesday records (under /tmp of this container only)
RD=/tmp/fixture-records; mkdir -p "$RD"; chmod 755 "$RD"
# r4: the complete result and binding lines, as r1-p3b-build-check.sh, r1-p4-gate-promote.sh, r1-p5-accept.sh and r1-rollback.sh print them
L_P3B="P3b RESULT BUILD PASS $CUR"
L_P4P="P4 RESULT PROMOTED 2026-11-24T00:30:00Z: OWNER NOW: RESTART block (runbook section 4.2), no later than 11:35 AEDT"
L_INV5="PASS running invocation = the owner's restart $INV_TUE"; L_P5A="P5 RESULT ACCEPT PASS (1-4)"
L_RBL="ROLLBACK RESULT LINKS SWITCHED 2026-11-24T01:05:00Z: OWNER NOW: RESTART block (runbook section 4.2)"
L_INVR="PASS running invocation = the owner's rollback restart $INV_RB"
L_RBV="ROLLBACK RESULT VERIFIED (1-3): now r1-rawhead.sh check and S9 with $PREVB"
record() { # outcome file
  { echo "# Tuesday sitting record: REHEARSAL FIXTURE written by in-container.sh (fixture IDs; not the real record)"
    echo "G0 PROD RESULT PASS"
    case $1 in
      released)   printf '%s\n' "P1 RESULT PASS" "$L_P3B" "BUILD_ID $NEWB" "$L_P4P" \
                    "Owner restart 11:33: InvocationID $INV_TUE (owner attests this is their restart)" "$L_INV5" "$L_P5A" \
                    "R6-HANDOFF tuesday-outcome released" "R6-HANDOFF current-id $CUR" "R6-HANDOFF attested-invocation $INV_TUE";;
      rolledback) printf '%s\n' "P1 RESULT PASS" "$L_P3B" "$L_P4P" \
                    "Owner restart 11:33: InvocationID $INV_TUE" "$L_INV5" "$L_P5A" "P6 tick 2 NOT OK: rollback trigger" \
                    "$L_RBL" "Owner rollback restart 12:08: InvocationID $INV_RB (owner attests)" "$L_INVR" "$L_RBV" \
                    "R6-HANDOFF tuesday-outcome rolledback" "R6-HANDOFF current-id $PREV" "R6-HANDOFF attested-invocation $INV_RB";;
      deferred)   printf '%s\n' "G0b exit 10 COPY-VERIFIED-ORIGIN-UNPROVEN: STOP before P2; release deferred; production unchanged" \
                    "R6-HANDOFF tuesday-outcome deferred" "R6-HANDOFF current-id $PREV" "R6-HANDOFF attested-invocation $SUN";;
    esac; } > "$2"
  chmod 644 "$2"
}
HOUT=; HRC=
hrun() { HOUT=$(as_user arm bash "$HAND" "$@" 2>&1); HRC=$?; }
hand() { # label want(pass|stop|usage) file [expected-args-line]
  local label=$1 want rx; want=$(sab "$1" "$2"); hrun "$3"
  echo "   [$label] rc=$HRC $(grep -E '^(STOP|R6-A2-|R6 HANDOFF RESULT)' <<< "$HOUT" | tr '\n' '|')"
  case $want in
    pass)  [ "$HRC" = 0 ] && grep -qx 'R6 HANDOFF RESULT PASS' <<< "$HOUT" && [ "$(grep '^R6-A2-' <<< "$HOUT" | tr '\n' ' ')" = "${4:-}" ] \
             && ok "[$label] handoff PASS with the expected arguments" || no "[$label] expected handoff PASS '${4:-}' (rc $HRC)";;
    stop)  [ "$HRC" = 1 ] && grep -q '^R6 HANDOFF RESULT STOP' <<< "$HOUT" && ! grep -q '^R6-A2-' <<< "$HOUT" \
             && ok "[$label] handoff STOP (exit 1), no arguments printed" || no "[$label] expected handoff STOP exit 1 (rc $HRC)";;
    usage) [ "$HRC" = 2 ] && ! grep -q '^R6-A2-' <<< "$HOUT" && ok "[$label] handoff exit 2, no arguments printed" || no "[$label] expected exit 2 (rc $HRC)";;
  esac
}
ARGS=()
handoff_args() { # record -> ARGS for A-2 from the helper's own output
  hrun "$1"; [ "$HRC" = 0 ] || { ARGS=(); return 1; }
  ARGS=(accepted "$(sed -n 's/^R6-A2-CURRENT_ID //p' <<< "$HOUT")" r3:yes r4:yes 10:00 \
        "$(sed -n 's/^R6-A2-TUESDAY //p' <<< "$HOUT")" "$(sed -n 's/^R6-A2-ATTESTED //p' <<< "$HOUT")")
}

if [ "$ROLE" = prod ]; then
  state released
  # Sunday's helper writes the baseline exactly as at A1 (fixture setup, not a test).
  probe_reset; as_user arm bash "$A1" baseline > /fx/baseline.out 2>&1 && grep -q 'RAWHEAD RESULT baseline PASS' /fx/baseline.out \
    || { echo "STOP baseline"; cat /fx/baseline.out; exit 1; }
  echo "   baseline written by the staged a1-rawhead.sh ($(probe_seen))"

  echo "-- H. r6-tuesday-handoff.sh on the valid fixture records O and R consume (the STOP cases: cases/f1-handoff.sh)"
  for o in released rolledback deferred; do record "$o" "$RD/$o.md"; done
  hand H-released pass "$RD/released.md" "R6-A2-TUESDAY tue:released R6-A2-CURRENT_ID $CUR R6-A2-ATTESTED inv:$INV_TUE "
  hand H-rolledback pass "$RD/rolledback.md" "R6-A2-TUESDAY tue:rolledback R6-A2-CURRENT_ID $PREV R6-A2-ATTESTED inv:$INV_RB "
  hand H-deferred pass "$RD/deferred.md" "R6-A2-TUESDAY tue:deferred R6-A2-CURRENT_ID $PREV R6-A2-ATTESTED inv:$SUN "
  sed 's/$/\r/' "$RD/released.md" > "$RD/crlf.md";                                          hand H-crlf-record pass "$RD/crlf.md" "R6-A2-TUESDAY tue:released R6-A2-CURRENT_ID $CUR R6-A2-ATTESTED inv:$INV_TUE "

  echo "-- U. A-2 argument rules (usage STOP, exit 2; nothing checked)"
  a2 U-old-5-arg-form usage - 'STOP usage' -- accepted "$CUR" r3:yes r4:yes 10:00
  a2 U-no-inv usage - 'STOP usage' -- accepted "$CUR" r3:yes r4:yes 10:00 tue:released
  a2 U-extra-arg usage - 'STOP usage' -- accepted "$CUR" r3:yes r4:yes 10:00 tue:released "inv:$INV_TUE" extra
  a2 U-no-tue usage - 'STOP usage' -- accepted "$CUR" r3:yes r4:yes 10:00 "inv:$INV_TUE" tue:released
  a2 U-ambiguous-tue usage - 'STOP usage' -- accepted "$CUR" r3:yes r4:yes 10:00 tue:released,deferred "inv:$INV_TUE"
  a2 U-empty-tue usage - 'STOP usage' -- accepted "$CUR" r3:yes r4:yes 10:00 tue: "inv:$INV_TUE"
  a2 U-inv-31-hex usage - 'STOP usage' -- accepted "$CUR" r3:yes r4:yes 10:00 tue:released "inv:${INV_TUE:0:31}"
  a2 U-inv-uppercase usage - 'STOP usage' -- accepted "$CUR" r3:yes r4:yes 10:00 tue:released "inv:${INV_TUE^^}"
  a2 U-inv-no-prefix usage - 'STOP usage' -- accepted "$CUR" r3:yes r4:yes 10:00 tue:released "$INV_TUE"
  a2 U-outcome-stopped usage - 'STOP usage' -- stopped "$CUR" r3:yes r4:yes 10:00 tue:released "inv:$INV_TUE"
  a2 U-released-sunday-inv usage - 'do not fit' -- accepted "$CUR" r3:yes r4:yes 10:00 tue:released "inv:$SUN"
  a2 U-released-old-id usage - 'do not fit' -- accepted "$PREV" r3:yes r4:yes 10:00 tue:released "inv:$INV_TUE"
  a2 U-rolledback-new-id usage - 'do not fit' -- accepted "$CUR" r3:yes r4:yes 10:00 tue:rolledback "inv:$INV_RB"
  a2 U-rolledback-sunday-inv usage - 'do not fit' -- accepted "$PREV" r3:yes r4:yes 10:00 tue:rolledback "inv:$SUN"
  a2 U-deferred-other-inv usage - 'do not fit' -- accepted "$PREV" r3:yes r4:yes 10:00 tue:deferred "inv:$INV_TUE"
  a2 U-deferred-other-build usage - 'do not fit' -- accepted 7d92042fd110-OtherBuild r3:yes r4:yes 10:00 tue:deferred "inv:$SUN"

  echo "-- O. the three Tuesday outcomes, A-2 arguments from the handoff helper's output"
  for o in released rolledback deferred; do
    state "$o"; handoff_args "$RD/$o.md" || no "[O-$o] handoff did not PASS"
    echo "   A-2 arguments from the record: ${ARGS[*]}"
    a2 "O-$o" pass 0 '' -- "${ARGS[@]}"
  done

  echo "-- R. later restart (new MainPID, InvocationID $INV_LATE) that plain status cannot see"
  for o in released rolledback deferred; do
    handoff_args "$RD/$o.md"; cur=${ARGS[1]}
    for k in unreadable malformed superseded; do
      state "$o" "$INV_LATE"
      case $k in
        unreadable) chmod 000 "$ROOT/events.log";;
        malformed)  sed -i 's/}$//' "$ROOT/events.log";;
        superseded) ev "{\"ts\":\"2026-11-24T22:00:00.000Z\",\"op\":\"status-pass\",\"id\":\"$cur\",\"invocationId\":\"$INV_LATE\",\"nRestarts\":0,\"restartConfirmation\":null}";;
      esac
      echo "   events.log $k ($(stat -c '%a' "$ROOT/events.log"), $(wc -l < "$ROOT/events.log") lines)"
      a2old "R-$o-$k-r2" "$OLDR2" accepted "$cur" r3:yes r4:yes 10:00
      grep -q "^PASS release\.mjs status (read-only): exit 0, one result line 'STATUS PASS $cur', no unattested restart" <<< "$OUT" \
        && ok "[R-$o-$k] plain status reports PASS with no restart note: the status gate alone cannot see this restart" \
        || no "[R-$o-$k] plain status did not report a clean PASS"
      a2 "R-$o-$k" stop 1 "^FAIL InvocationID: live InvocationID $INV_LATE != owner-attested ${ARGS[6]#inv:}" -- "${ARGS[@]}"
      grep -q '^PASS release\.mjs status' <<< "$OUT" && ok "[R-$o-$k] the status gate still passes: the InvocationID comparison alone STOPs it" \
        || no "[R-$o-$k] status gate"
      chmod 644 "$ROOT/events.log"
    done
  done

  echo "-- I. A-2's own InvocationID read fails or is not one 32-hex ID (released state)"
  state released; handoff_args "$RD/released.md"
  for m in fail empty malformed multi upper; do
    echo "$m" > /fx/inv-mode
    case $m in fail) rx='^FAIL InvocationID: systemctl show afldb failed \(exit 1\)';; empty) rx='^FAIL InvocationID: the live InvocationID is empty';;
      *) rx='^FAIL InvocationID: the live InvocationID .* is malformed';; esac
    a2 "I-$m" stop 1 "$rx" -- "${ARGS[@]}"
  done
  : > /fx/inv-mode

  echo "-- C. earlier cases, now with the seven arguments"
  a2 C-wrong-build-id stop 2 '^FAIL release\.mjs status does not prove' -- accepted 17822b29e6de-WrongBuildId0000000000 r3:yes r4:yes 10:00 tue:released "inv:$INV_TUE"
  state released "$INV_LATE"
  a2 C-unattested-restart-events-intact stop 2 'restarted since the last attested PASS' -- "${ARGS[@]}"
  echo "   current = $CUR and two workers, but the service still runs the previous release (promoted, not restarted)"
  state released; stop_server; start_server "$ROOT/releases/$PREV"; sysd "$SPID" "$INV_TUE" "$(mel_ep "2026-11-24 11:33:10")"
  a2 C-promoted-not-restarted stop 1 '^FAIL release\.mjs status does not prove' -- "${ARGS[@]}"
  a2old C-promoted-not-restarted-58e35ce8 "$OLD58" accepted "$CUR" r3:yes r4:yes 10:00

  echo "-- S. stub release.mjs outputs (every other A-2 check passes; isolates the result-line rules)"
  state released; handoff_args "$RD/released.md"
  cp "$CHK/deploy/release.mjs" /fx/release.real.mjs
  printf '%s\n' "import { readFileSync } from 'node:fs';" "process.stdout.write(readFileSync('/fx/stub-out', 'utf8'));" \
    "process.exit(Number(readFileSync('/fx/stub-rc', 'utf8')));" > "$CHK/deploy/release.mjs"
  stub() { printf '%b' "$1" > /fx/stub-out; echo "$2" > /fx/stub-rc; chmod 644 /fx/stub-out /fx/stub-rc; }
  stub "release: current  $CUR\nrelease: STATUS PASS $CUR\n" 0;                       a2 S-exact-pass pass 0 '' -- "${ARGS[@]}"
  stub "release: current  $CUR\nrelease: STATUS PASS $CUR\n" 1;                       a2 S-pass-line-exit-1 stop 1 'does not prove.*exit 1' -- "${ARGS[@]}"
  stub "release: current  $CUR\nrelease: STATUS PASS 17822b29e6de-OtherBuild\n" 0;    a2 S-wrong-build-line stop 1 'does not prove' -- "${ARGS[@]}"
  stub "release: current  $CUR\nrelease: STATUS PASS ${CUR}x\n" 0;                    a2 S-longer-id-line stop 1 'does not prove' -- "${ARGS[@]}"
  stub "release: current  $CUR\n" 0;                                                  a2 S-missing-result-line stop 1 'does not prove' -- "${ARGS[@]}"
  stub "release: STATUS PASS $CUR\nrelease: STATUS PASS $CUR\n" 0;                    a2 S-duplicate-result-line stop 1 'does not prove' -- "${ARGS[@]}"
  stub "release: STATUS FAIL\nrelease: STATUS PASS $CUR\n" 0;                         a2 S-fail-and-pass-lines stop 1 'does not prove' -- "${ARGS[@]}"
  stub "release: note: the service restarted since the last attested PASS (InvocationID a -> b); x\nrelease: STATUS PASS $CUR\n" 0; a2 S-restart-note stop 1 'does not prove' -- "${ARGS[@]}"
  stub "release: STATUS FAIL\r\nrelease: STATUS PASS $CUR\n" 0;                       a2 S-crlf-fail-lf-pass stop 1 'does not prove.*carriage return.*2 result lines' -- "${ARGS[@]}"
  a2old S-crlf-fail-lf-pass-r2 "$OLDR2" accepted "$CUR" r3:yes r4:yes 10:00
  stub "release: STATUS PASS $CUR\r\n" 0;                                             a2 S-crlf-pass-line stop 1 'does not prove.*carriage return' -- "${ARGS[@]}"
  stub "release: current  $CUR\r\nrelease: STATUS PASS $CUR\n" 0;                     a2 S-cr-elsewhere stop 1 'does not prove.*carriage return' -- "${ARGS[@]}"
  cp /fx/release.real.mjs "$CHK/deploy/release.mjs"; chown arm:arm "$CHK/deploy/release.mjs"
  cmp -s "$CHK/deploy/release.mjs" "$FX/deploy/release.mjs" && ok "real release.mjs restored" || no "release.mjs restore"

  echo "-- F. F-4 entry point (r6-rawhead-check.sh)"
  b0=$(sha256sum < "$BL" | cut -c1-64)
  probe_reset; out=$(as_user arm bash "$ENTRY" 2>&1); rc=$?
  sed 's/^/     | /' <<< "$out" | grep -vE '^     \|  +' ; echo "   [F4-valid] rc=$rc $(probe_seen)"
  [ "$rc" = 0 ] && grep -qx 'RAWHEAD RESULT check PASS' <<< "$out" && grep -q '(executing the hashed bytes)' <<< "$out" && [ "$(cat /fx/conn-count)" = 24 ] \
    && ok "[F4-valid] arm@afldb-prod: probe ran (24 connections), RAWHEAD RESULT check PASS, exit 0" || no "[F4-valid] rc $rc"
  env_fifo_on; probe_reset
  out=$(as_user arm bash "$ENTRY" 2>&1); rc=$?
  echo "   [F4-valid, .env as a FIFO detector] rc=$rc $(probe_seen)"
  [ "$rc" = 0 ] && [ "$(wc -l < /fx/env-opened)" -ge 1 ] && [ -s /fx/mktemp-calls ] && [ "$(cat /fx/conn-count)" -gt 0 ] \
    && ok "[F4-valid] the three detectors see a real run (.env opened, temp file created, requests made)" || no "[F4-valid detectors]"
  # The staged root is 0700/0600 (umask 077), so ops cannot even read it; the wrong-user case runs the same bytes from an open copy.
  rm -rf /tmp/st-open && mkdir -p /tmp/st-open && cp -r "$ST/docs" /tmp/st-open/ && chmod -R a+rX /tmp/st-open
  cmp -s "/tmp/st-open/$B/r6-20261125/r6-rawhead-check.sh" "$ENTRY" && cmp -s "/tmp/st-open/$B/a1a2-20261124/a1-rawhead.sh" "$A1" || no "open copy differs"
  probe_reset
  out=$(as_user ops bash "/tmp/st-open/$B/r6-20261125/r6-rawhead-check.sh" 2>&1); rc=$?
  sed 's/^/     | /' <<< "$out"; echo "   [F4-wrong-user ops@afldb-prod] rc=$rc $(probe_seen)"
  [ "$rc" = 2 ] && grep -q '^STOP not arm@afldb-prod' <<< "$out" && ! grep -q 'A1 rawhead' <<< "$out" && probe_none \
    && ok "[F4-wrong-user] exit 2; .env never opened, no temp file, no request" || no "[F4-wrong-user] rc $rc"
  env_fifo_off
  rm -rf /tmp/st2 && mkdir -p /tmp/st2 && cp -r "$ST/docs" /tmp/st2/ && printf '# changed\n' >> "/tmp/st2/$B/a1a2-20261124/a1-rawhead.sh" && chmod -R a+rX /tmp/st2
  probe_reset; out=$(as_user arm bash "/tmp/st2/$B/r6-20261125/r6-rawhead-check.sh" 2>&1); rc=$?
  sed 's/^/     | /' <<< "$out"; echo "   [F4-changed-helper] rc=$rc $(probe_seen)"
  [ "$rc" = 2 ] && grep -q "not Sunday's pinned" <<< "$out" && probe_none && ok "[F4-changed-helper] exit 2, probe not started" || no "[F4-changed-helper] rc $rc"
  [ "$(sha256sum < "$BL" | cut -c1-64)" = "$b0" ] && ok "Sunday-shaped baseline unchanged by every F-4 run" || no "baseline changed"
else
  echo "-- F. F-4 entry point on the wrong host ($(hostname)) as arm"
  # The baseline file exists, as it would on any host that holds one: the guard, not a missing file, must stop the run.
  printf '{}\n' > "$BL"; chown arm:arm "$BL"
  state released
  env_fifo_on; probe_reset
  out=$(as_user arm bash "$ENTRY" 2>&1); rc=$?
  sed 's/^/     | /' <<< "$out"; echo "   [F4-wrong-host] rc=$rc $(probe_seen)"
  [ "$rc" = 2 ] && grep -q '^STOP not arm@afldb-prod' <<< "$out" && ! grep -q 'A1 rawhead' <<< "$out" && probe_none \
    && ok "[F4-wrong-host] exit 2; .env never opened, no temp file, no request" || no "[F4-wrong-host] rc $rc"
  probe_reset
  out=$(as_user arm bash "$A1" check 2>&1); rc=$?
  echo "   [contrast: Sunday's bare helper on the same wrong host] rc=$rc $(probe_seen)"
  [ "$(wc -l < /fx/env-opened)" -ge 1 ] && [ -s /fx/mktemp-calls ] && [ "$(cat /fx/conn-count)" -gt 0 ] \
    && ok "[contrast] the unguarded helper reads .env, creates its probe file and makes requests on the wrong host: the defect" || no "[contrast]"
  env_fifo_off
fi
stop_server; kill "$PROXY" 2>/dev/null
echo "== in-container role=$ROLE: $P passed, $F failed"
[ "$F" = 0 ]
