#!/usr/bin/env bash
# REHEARSAL ONLY. Runs as root INSIDE a disposable container started by rehearse-r6-fixes.sh (docker run --rm --network none,
# hostname set by docker, never on a real host). Exercises the STAGED R6 scripts byte-for-byte:
#   role prod      (hostname afldb-prod): A-2 (r6-pre-verify.sh) on a fixture that passes every other A-2 check, with the real
#                  17822b29 deploy/release.mjs against a real sandbox release root served by the real 17822b29 supervisor over
#                  the rehearsal stub server (2 workers); then stub release.mjs outputs; then the F-4 entry point as arm (valid
#                  fixture), as another user, and with a changed helper.
#   role wronghost (hostname afldb-dev): the F-4 entry point as arm on the wrong host, and Sunday's bare helper for contrast.
# Production-only facts that are not under test (kernel list, systemd, journal, psql, df, the clock) are fixture shims in
# /usr/local/bin; the files A-2 reads by absolute path are fixture files at those paths. The staged scripts are never edited.
set -uo pipefail; export LC_ALL=C
ROLE=${1:?role}
[ -f /.dockerenv ] || { echo "REFUSED: container only"; exit 2; }
ST=/in/stage; FX=/in/fix; B=docs/v2/evidence/backlog-20261121; RH=$FX/docs/v2/evidence/release-17822b29-20261124/rehearsal
PRE=$ST/$B/r6-20261125/r6-pre-verify.sh; ENTRY=$ST/$B/r6-20261125/r6-rawhead-check.sh; A1=$ST/$B/a1a2-20261124/a1-rawhead.sh
NODE=/home/arm/.nvm/versions/node/v22.23.2/bin/node
CHK=/home/arm/projects/afldb; ROOT=/home/arm/afldb-releases; BK=/home/arm/backups/afldb-scheduled; BL=/home/arm/a1-rawhead-baseline.json
CUR=17822b29e6de-R6fixRehearsalBuild01x; NEWB=R6fixRehearsalBuild01x
PREV=7d92042fd110-XWruOm_9nLCSMY8nGPqYU; PREVB=XWruOm_9nLCSMY8nGPqYU
INV_TUE=3f1e5a0c9b7d4e2f8a6c1b0d9e8f7a6b; INV_LATE=9a8b7c6d5e4f30211203f4e5d6c7b8a9
P=0; F=0
ok() { echo "REH PASS $1"; P=$((P+1)); }
no() { echo "REH FAIL $1"; F=$((F+1)); }
mel_ep() { TZ=Australia/Melbourne /usr/bin/date -d "$1" +%s; }
as_user() { local u=$1; shift; setpriv --reuid="$u" --regid="$u" --init-groups env -i HOME="/home/$u" USER="$u" LOGNAME="$u" \
  PATH=/usr/local/bin:/usr/bin:/bin LANG=C.UTF-8 "$@"; }
echo "== R6 FIX in-container role=$ROLE $(/usr/bin/date -u +%FT%TZ) hostname=$(hostname) image-os=$(. /etc/os-release; echo "$PRETTY_NAME")"
echo "   staged sha256: $(sha256sum < "$PRE" | cut -c1-64) r6-pre-verify.sh; $(sha256sum < "$ENTRY" | cut -c1-64) r6-rawhead-check.sh; $(sha256sum < "$A1" | cut -c1-64) a1-rawhead.sh"

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
case "$u/$o" in afldb-backup.service/cat) cat /fx/journal-backup.txt;; afldb-backup-verify.service/json) cat /fx/journal-verify.json;; esac
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
chmod 755 /usr/local/bin/*; : > /fx/mktemp-calls; : > /fx/env-opened; chmod 666 /fx/mktemp-calls /fx/env-opened
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

# ---------------------------------------------------------------- release root: CUR and PREV, real supervisor, stub server
mk() { local id=$1 bid=$2 d=$ROOT/releases/$1
  mkdir -p "$d/deploy" "$d/.next/standalone/.next" && cp "$FX/deploy/server-cluster.mjs" "$d/deploy/server-cluster.mjs" \
  && cp "$RH/stub-server.cjs" "$d/.next/standalone/server.js" && printf '%s' "$bid" > "$d/.next/standalone/.next/BUILD_ID" \
  && "$NODE" "$RH/make-release.mjs" "$CHK" "$d" "$id" 17822b29e6de2b6248cd7ada4221800fd81e0003 "$bid"; }
mkdir -p "$ROOT/releases"; mk "$CUR" "$NEWB" && mk "$PREV" "$PREVB" || { echo "STOP releases"; exit 1; }
ln -s "releases/$CUR" "$ROOT/current"; ln -s "releases/$PREV" "$ROOT/previous"
printf '%s\n' \
  "{\"ts\":\"2026-11-24T00:30:00.000Z\",\"op\":\"promote\",\"id\":\"$CUR\",\"window\":{\"at\":\"2026-11-24T00:30:00.000Z\",\"afldb\":{\"invocationId\":\"342040625f6d4012a35d598dfbf9afe6\",\"nRestarts\":0}}}" \
  "{\"ts\":\"2026-11-24T00:40:00.000Z\",\"op\":\"status-pass\",\"id\":\"$CUR\",\"invocationId\":\"$INV_TUE\",\"nRestarts\":0,\"restartConfirmation\":{\"invocationId\":\"$INV_TUE\"}}" \
  > "$ROOT/events.log"
chown -R arm:arm /home/arm/projects /home/arm/afldb-releases

# ---------------------------------------------------------------- backup state for A-2 section 5 (Wednesday 02:20 and 03:30)
mkdir -p "$BK/.state"
SD=afldb_prod-20261125-022001.dump; VD=afldb_prod-20261125-033012.dump
head -c 4096 /dev/urandom > "$BK/$SD"; SS=$(sha256sum < "$BK/$SD" | cut -c1-64); printf '%s  %s\n' "$SS" "$SD" > "$BK/$SD.sha256"
head -c 4096 /dev/urandom > "$BK/$VD"; VS=$(sha256sum < "$BK/$VD" | cut -c1-64); printf '%s  %s\n' "$VS" "$VD" > "$BK/$VD.sha256"
BS=$(mel_ep "2026-11-25 02:20:01"); VT=$(mel_ep "2026-11-25 03:30:00"); VSS=$(mel_ep "2026-11-25 03:30:02")
VE=$(mel_ep "2026-11-25 03:31:20"); JT=$(mel_ep "2026-11-25 03:31:25"); VX=$(mel_ep "2026-11-25 03:31:30")
printf '{"epoch":%s,"file":"%s","sha256":"%s","attempts":1}\n' "$VE" "$VD" "$VS" > "$BK/.state/last-verify.json"
printf '{"epoch":%s,"file":"%s","sha256":"%s","offhost":"none"}\n' "$(mel_ep "2026-11-25 03:30:20")" "$VD" "$VS" > "$BK/.state/last-backup.json"
echo "$VS" > /fx/verify.sha
echo "Wed 2026-11-25 02:20:05 afldb-prod scheduled-backup: backup ok: $SD 4096 bytes sha256 ${SS:0:16}" > /fx/journal-backup.txt
printf '{"MESSAGE":"2026-11-25T03:31:25+11:00 scheduled-backup: verify ok: %s restored and proven (attempt 1)","_SYSTEMD_UNIT":"afldb-backup-verify.service","_SYSTEMD_INVOCATION_ID":"0d1c2b3a4f5e60718293a4b5c6d7e8f9","__REALTIME_TIMESTAMP":"%s000000"}\n' "$VD" "$JT" > /fx/journal-verify.json
chown -R arm:arm /home/arm/backups

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
stop_server() { kill "$SPID" 2>/dev/null; wait "$SPID" 2>/dev/null; for _ in $(seq 1 40); do pgrep -f server-cluster.mjs >/dev/null || return 0; sleep 0.25; done; }
cp /fx/env.server /fx/env.server.arm; chown arm /fx/env.server.arm
cat > /fx/count-proxy.cjs <<'JS'
const net = require('net'), fs = require('fs'), f = '/fx/conn-count';   // counts since the last probe_reset (file = 0)
net.createServer((c) => { let n = 0; try { n = Number(fs.readFileSync(f, 'utf8')) || 0; } catch {} fs.writeFileSync(f, String(n + 1)); const u = net.connect(3100, '127.0.0.1');
  c.pipe(u); u.pipe(c); c.on('error', () => u.destroy()); u.on('error', () => c.destroy()); }).listen(3101, '127.0.0.1');
JS
"$NODE" /fx/count-proxy.cjs & PROXY=$!
TUE=$(mel_ep "2026-11-24 11:33:10")
start_server "$ROOT/current"; sysd "$SPID" "$INV_TUE" "$TUE"
echo "   service: primary $SPID cwd $(as_user arm readlink /proc/$SPID/cwd), workers $(pgrep -P "$SPID" | tr '\n' ' ')"

# ---------------------------------------------------------------- probe-detection helpers (F-4)
ENVW=
env_fifo_on() { mv "$CHK/.env" /fx/env.regular; mkfifo -m 666 "$CHK/.env"; : > /fx/env-opened; chmod 666 /fx/env-opened
  ( while :; do cat /fx/env.probe > "$CHK/.env"; echo opened >> /fx/env-opened; done ) & ENVW=$!; }
env_fifo_off() { kill "$ENVW" 2>/dev/null; wait "$ENVW" 2>/dev/null; rm -f "$CHK/.env"; mv /fx/env.regular "$CHK/.env"; }
probe_reset() { echo 0 > /fx/conn-count; : > /fx/mktemp-calls; : > /fx/env-opened; }
probe_seen() { printf 'connections=%s mktemp-calls=%s env-opens=%s' "$(cat /fx/conn-count)" "$(wc -l < /fx/mktemp-calls)" "$(wc -l < /fx/env-opened)"; }
probe_none() { [ "$(cat /fx/conn-count)" = 0 ] && [ ! -s /fx/mktemp-calls ] && [ ! -s /fx/env-opened ]; }

if [ "$ROLE" = prod ]; then
  # Sunday's helper writes the baseline exactly as at A1 (fixture setup, not a test).
  probe_reset; as_user arm bash "$A1" baseline > /fx/baseline.out 2>&1 && grep -q 'RAWHEAD RESULT baseline PASS' /fx/baseline.out \
    || { echo "STOP baseline"; cat /fx/baseline.out; exit 1; }
  echo "   baseline written by the staged a1-rawhead.sh ($(probe_seen))"

  echo "-- 1. A-2 (r6-pre-verify.sh accepted $CUR r3:yes r4:yes 10:00), events.log compared byte for byte"
  a2() { # label expected(pass|stop) expected-FAIL-lines cur [script] [show-full]
    local label=$1 want=$2 nfail=$3 cur=$4 s=${5:-$PRE} full=${6:-} out rc e0 e1 n verdict
    e0=$(sha256sum < "$ROOT/events.log" | cut -c1-64)
    out=$(as_user arm bash "$s" accepted "$cur" r3:yes r4:yes 10:00 2>&1); rc=$?
    e1=$(sha256sum < "$ROOT/events.log" | cut -c1-64)
    n=$(grep -c '^FAIL' <<< "$out"); verdict=$(grep '^R6 PRE RESULT' <<< "$out")
    echo "   [$label] rc=$rc fail-lines=$n events.log ${e0:0:16} -> ${e1:0:16}"
    grep -E '^(FAIL|PASS release\.mjs|PASS current|PASS exactly 2)|^     release: (STATUS|note|FAIL)|^R6 PRE RESULT' <<< "$out" | sed 's/^/     | /'
    [ -n "$full" ] && { echo "   ---- full A-2 output [$label]"; sed 's/^/     # /' <<< "$out"; }
    [ "$e0" = "$e1" ] && ok "[$label] events.log byte-identical" || no "[$label] events.log changed"
    if [ "$want" = pass ]; then
      [ "$rc" = 0 ] && [ "$n" = 0 ] && [ "$verdict" = "R6 PRE RESULT PASS" ] && grep -q "^PASS release\.mjs status (read-only): exit 0, one result line 'STATUS PASS $cur'" <<< "$out" && ok "[$label] A-2 exit 0, R6 PRE RESULT PASS" || no "[$label] expected PASS (rc $rc)"
    else
      [ "$rc" != 0 ] && [ "$n" = "$nfail" ] && [[ $verdict == "R6 PRE RESULT STOP"* ]] && grep -q '^FAIL release\.mjs status does not prove' <<< "$out" \
        && ok "[$label] A-2 exit $rc, STOP, $n FAIL line(s) incl. the serving-release check" || no "[$label] expected STOP with $nfail FAIL line(s) (rc $rc, $n)"
    fi
  }
  a2 P1-attested-release pass 0 "$CUR" "" full
  a2 F-wrong-build-id stop 2 "17822b29e6de-WrongBuildId0000000000"

  echo "   later unattested restart: the service restarts (new MainPID and InvocationID) after Tuesday's attested PASS"
  stop_server; start_server "$ROOT/current"; sysd "$SPID" "$INV_LATE" "$(mel_ep "2026-11-25 06:41:00")"
  a2 F-unattested-restart stop 1 "$CUR"

  echo "   current symlink = $CUR and two workers, but the service still runs the previous release (promoted, not restarted)"
  stop_server; start_server "$ROOT/releases/$PREV"; sysd "$SPID" "$INV_TUE" "$TUE"
  echo "   service: primary $SPID cwd $(as_user arm readlink /proc/$SPID/cwd), workers $(pgrep -P "$SPID" | wc -l); current -> $(readlink "$ROOT/current")"
  a2 F-status-exit-nonzero stop 1 "$CUR" "" full
  echo "   the same fixture through the previously staged A-2 (58e35ce8; INFO-only status), to show the finding"
  a2o() { local out rc; out=$(as_user arm bash "$FX/$B/r6-20261125/review-fixes-20261123/orig-r6-pre-verify-58e35ce8.sh" accepted "$CUR" r3:yes r4:yes 10:00 2>&1); rc=$?
    grep -E '^INFO release\.mjs status exit|^R6 PRE RESULT' <<< "$out" | sed 's/^/     | /'
    [ "$rc" = 0 ] && ok "[old A-2] passes the promoted-not-restarted fixture (rc 0): the defect the review found" || no "[old A-2] rc $rc"; }
  a2o

  echo "   stub release.mjs outputs (all other A-2 checks still pass; isolates the result-line rules)"
  stop_server; start_server "$ROOT/current"; sysd "$SPID" "$INV_TUE" "$TUE"
  cp "$CHK/deploy/release.mjs" /fx/release.real.mjs
  printf '%s\n' "import { readFileSync } from 'node:fs';" "process.stdout.write(readFileSync('/fx/stub-out', 'utf8'));" \
    "process.exit(Number(readFileSync('/fx/stub-rc', 'utf8')));" > "$CHK/deploy/release.mjs"
  stub() { printf '%b' "$1" > /fx/stub-out; echo "$2" > /fx/stub-rc; chmod 644 /fx/stub-out /fx/stub-rc; }
  stub "release: current  $CUR\nrelease: STATUS PASS $CUR\n" 0;                          a2 S-exact-pass pass 0 "$CUR"
  stub "release: current  $CUR\nrelease: STATUS PASS $CUR\n" 1;                          a2 S-pass-line-exit-1 stop 1 "$CUR"
  stub "release: current  $CUR\nrelease: STATUS PASS 17822b29e6de-OtherBuild\n" 0;       a2 S-wrong-build-line stop 1 "$CUR"
  stub "release: current  $CUR\nrelease: STATUS PASS ${CUR}x\n" 0;                       a2 S-longer-id-line stop 1 "$CUR"
  stub "release: current  $CUR\n" 0;                                                     a2 S-missing-result-line stop 1 "$CUR"
  stub "release: STATUS PASS $CUR\nrelease: STATUS PASS $CUR\n" 0;                       a2 S-duplicate-result-line stop 1 "$CUR"
  stub "release: STATUS FAIL\nrelease: STATUS PASS $CUR\n" 0;                            a2 S-fail-and-pass-lines stop 1 "$CUR"
  stub "release: note: the service restarted since the last attested PASS (InvocationID a -> b); x\nrelease: STATUS PASS $CUR\n" 0; a2 S-restart-note stop 1 "$CUR"
  cp /fx/release.real.mjs "$CHK/deploy/release.mjs"; chown arm:arm "$CHK/deploy/release.mjs"
  cmp -s "$CHK/deploy/release.mjs" "$FX/deploy/release.mjs" && ok "real release.mjs restored" || no "release.mjs restore"

  echo "-- 3. F-4 entry point (r6-rawhead-check.sh)"
  b0=$(sha256sum < "$BL" | cut -c1-64)
  probe_reset; out=$(as_user arm bash "$ENTRY" 2>&1); rc=$?
  sed 's/^/     | /' <<< "$out" | grep -vE '^     \|  +' ; echo "   [F4-valid] rc=$rc $(probe_seen)"
  [ "$rc" = 0 ] && grep -qx 'RAWHEAD RESULT check PASS' <<< "$out" && [ "$(cat /fx/conn-count)" = 24 ] \
    && ok "[F4-valid] arm@afldb-prod: probe ran (24 connections), RAWHEAD RESULT check PASS, exit 0" || no "[F4-valid] rc $rc"
  env_fifo_on; probe_reset
  out=$(as_user arm bash "$ENTRY" 2>&1); rc=$?
  echo "   [F4-valid, .env as a FIFO detector] rc=$rc $(probe_seen)"
  [ "$rc" = 0 ] && [ "$(wc -l < /fx/env-opened)" -ge 1 ] && [ -s /fx/mktemp-calls ] && [ "$(cat /fx/conn-count)" -gt 0 ] \
    && ok "[F4-valid] the three detectors see a real run (.env opened, temp file created, requests made)" || no "[F4-valid detectors]"
  probe_reset
  out=$(as_user ops bash "$ENTRY" 2>&1); rc=$?
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
  echo "-- 3. F-4 entry point on the wrong host ($(hostname)) as arm"
  # The baseline file exists, as it would on any host that holds one: the guard, not a missing file, must stop the run.
  printf '{}\n' > "$BL"; chown arm:arm "$BL"
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
