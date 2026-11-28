#!/usr/bin/env bash
# r7v-host.sh (R6 r7, MED-2 verifier harness). REHEARSAL ONLY: runs on streamanator (the DEV host) as arm, never on production.
# Driven by r7v-run.sh on the workstation. Two disposable containers whose PID 1 is the REAL systemd 255 (pinned image of r6's harness,
# sha256:d71c0b28..., Ubuntu 24.04, plus apt packages installed in the image build only, the one step that uses the network):
#   r7v-<RID>-prod     --hostname afldb-prod     FIXED-OFFSET Melbourne zone   (r7v-container.sh setup-prod), so the REAL
#                      afldb-backup.timer (OnCalendar 02:20) fires about 2 minutes after the container starts, on today's date
#   r7v-<RID>-offhost  --hostname r7v-offhost    FIXED-OFFSET Melbourne zone   (r7v-container.sh setup-offhost), so arm's real
#                      `10 3 * * *` cron job fires about 2 minutes after the container starts, on today's Melbourne date
#                      (r9: was --hostname streamanator. The wrapper refuses to qualify any endpoint named streamanator, so the
#                      container the harness qualifies by FIXTURE carries a neutral name; `up` prints its fixed UTC offset as
#                      "R7V OFFHOST-UTC-OFFSET <s>" for the fixture's rehearsal-utc-offset)
# Container flags (never --privileged): --network none --cgroupns=private --tmpfs /run --tmpfs /run/lock --cap-add SYS_ADMIN (systemd
# as PID 1) --cap-add DAC_READ_SEARCH --cap-add SYS_PTRACE (the two capabilities the root facts reader's unit keeps; Docker's default
# set lacks them; production root has them) --security-opt apparmor=unconfined. Labels r7v.run=<RID> on the image and containers.
# r8: the image adds sudo, used only by r8-sudo-on (arm gets sudo INSIDE the prod container for scenario h; r8-sudo-off removes it).
# Usage: bash r7v-host.sh <WS> <RID> up|hostile|tamper|untamper|forge|unforge|r8-sudo-on|r8-sudo-off|r8-libsh|pull-log|r9-drop-end|r9-restore-end|r9-drop-dispatch|down [--keep-image]
set -uo pipefail; export LC_ALL=C
[ "$(hostname)" != afldb-prod ] || { echo "REFUSED: rehearsal never runs on production"; exit 2; }
WS=${1:?workspace}; RID=${2:?rid}; CMD=${3:?command}; KEEP=${4:-}
[[ $RID =~ ^[A-Za-z0-9-]+$ ]] && [ -d "$WS/fix" ] && [ -O "$WS" ] || { echo "STOP not this run's private workspace: $WS ($RID)"; exit 2; }
PIN=sha256:d71c0b286c54a7cc48645aa8d4d9d0c57e4260128cb91a6fb18c29d7589205ba
IMG=${R7V_IMAGE:-r7v-sysd-$RID:1}; LBL=r7v.run=$RID; A=r7v-$RID-prod; B=r7v-$RID-offhost
# R7V_IMAGE: reuse an image kept by an earlier run (development only; the final run builds its own)
CT=/in/fix/docs/v2/evidence/backlog-20261121/r6-20261125/review-fixes-r7-20261128/verify-harness/r7v-container.sh
DAY=$(TZ=Australia/Melbourne date +%F)
[[ $DAY =~ ^2026-11-2[4-9]$ ]] || { echo "STOP today (Melbourne) is $DAY: outside 2026-11-24..29"; exit 2; }
hms() { local s=$1 sign=; [ "$s" -lt 0 ] && { sign=-; s=$((-s)); }; printf '%s%d:%02d:%02d' "$sign" $((s / 3600)) $((s % 3600 / 60)) $((s % 60)); }
run_ctr() { # name hostname extra-env...
  local n=$1 h=$2; shift 2
  docker run -d --name "$n" --label "$LBL" --network none --hostname "$h" --cgroupns=private --tmpfs /run --tmpfs /run/lock \
    --cap-add SYS_ADMIN --cap-add DAC_READ_SEARCH --cap-add SYS_PTRACE --security-opt apparmor=unconfined --stop-signal SIGRTMIN+3 \
    -e "R7V_DAY=$DAY" "$@" -v "$WS/entry.sh:/entry.sh:ro" -v "$WS/fix:/in/fix:ro" --entrypoint /entry.sh "$IMG" > /dev/null
}
case $CMD in
up)
  echo "== r7v host up $(date -u +%FT%TZ) host=$(hostname) user=$(id -un) day=$DAY docker $(docker version -f '{{.Server.Version}}')"
  if ! docker image inspect "$IMG" > /dev/null 2>&1; then
    mkdir -p "$WS/build"
    printf 'FROM %s\nLABEL %s\nENV DEBIAN_FRONTEND=noninteractive\nRUN apt-get update && apt-get install -y --no-install-recommends systemd systemd-sysv dbus libpam-systemd util-linux coreutils procps postgresql-16 openssh-server openssh-client rsync netcat-openbsd python3 cron tzdata sudo && rm -rf /var/lib/apt/lists/* && systemctl --version | head -1\n' \
      "$PIN" "$LBL" > "$WS/build/Dockerfile"
    docker build --label "$LBL" -t "$IMG" "$WS/build" > "$WS/build/build.log" 2>&1 || { tail -20 "$WS/build/build.log"; echo "STOP image build failed"; exit 1; }
  fi
  echo "image $IMG id $(docker image inspect -f '{{.Id}}' "$IMG") from $PIN"
  cat > "$WS/entry.sh" <<'EOF'
#!/bin/sh
# REHEARSAL ONLY: (1) systemd as PID 1 needs the container's cgroup2 writable; (2) FIXTURE: when FAKE_STDOFF is set, a fixed-offset
# Australia/Melbourne zone (the off-host container's 03:10 cron job then fires minutes from now on today's date); (3) init.
mount -o remount,rw /sys/fs/cgroup || exit 97
if [ -n "${FAKE_STDOFF:-}" ]; then printf 'Zone Australia/Melbourne %s - AEDT\n' "$FAKE_STDOFF" > /tmp/fake.zone; zic -d /usr/share/zoneinfo /tmp/fake.zone || exit 96; fi
ln -sf /usr/share/zoneinfo/Australia/Melbourne /etc/localtime
exec /sbin/init
EOF
  chmod 755 "$WS/entry.sh"
  # prod: whole-minute fixed offset so local "$DAY 02:20:00" (afldb-backup.timer's OnCalendar) is real TA, about 90-150 s from now
  TA=$(( $(date +%s) + 90 )); offa=$(( $(date -u -d "$DAY 02:20:00" +%s) - TA )); offa=$(( offa - ((offa % 60) + 60) % 60 )); TA=$(( $(date -u -d "$DAY 02:20:00" +%s) - offa ))
  echo "[FIXTURE] $A: fake Melbourne offset $(hms "$offa"): local $DAY 02:20:00 = real $(date -u -d "@$TA" +%FT%TZ)"
  run_ctr "$A" afldb-prod -e "FAKE_STDOFF=$(hms "$offa")" -e "R7V_TD=$TA" || { echo "STOP container $A did not start"; exit 1; }
  echo "== $A setup-prod"; docker exec "$A" bash "$CT" setup-prod; rc=$?; [ "$rc" = 0 ] || { echo "STOP setup-prod exit $rc"; exit 1; }
  rm -rf "$WS/incoming"; mkdir -p "$WS/incoming"; docker cp "$A:/var/lib/afldb-backup/published/." "$WS/incoming/" > /dev/null || { echo "STOP docker cp"; exit 1; }
  echo "[HARNESS] carried to the off-host container (instead of rsync from production): $(cd "$WS/incoming" && ls | tr '\n' ' ')"
  TD=$(( $(date +%s) + 120 )); off=$(( $(date -u -d "$DAY 03:10:00" +%s) - TD ))
  run_ctr "$B" r7v-offhost -e "FAKE_STDOFF=$(hms "$off")" -e "R7V_DISPATCH=$TD" || { echo "STOP container $B did not start"; exit 1; }
  docker cp "$WS/incoming/." "$B:/opt/r7v-incoming" > /dev/null || { echo "STOP docker cp into $B"; exit 1; }
  echo "== $B setup-offhost (fake Melbourne offset $(hms "$off"): 03:10:00 local = real $(date -u -d "@$TD" +%FT%TZ))"
  docker exec "$B" bash "$CT" setup-offhost; rc=$?; [ "$rc" = 0 ] || { echo "STOP setup-offhost exit $rc"; exit 1; }
  echo "[HARNESS] waiting for arm's real 03:10 cron job in $B to finish"
  for i in $(seq 1 80); do docker exec "$B" bash "$CT" pull-log 2>/dev/null | grep -q ' END run=' && break; sleep 5; done
  docker exec "$B" bash "$CT" pull-log | sed 's/^/   pull-log | /'
  echo "R7V CTR prod $A"; echo "R7V CTR offhost $B"; echo "R7V DAY $DAY"; echo "R7V OFFHOST-UTC-OFFSET $off"
  echo "R7V HOSTKEY prod $(docker exec "$A" bash "$CT" hostkey)"; echo "R7V HOSTKEY offhost $(docker exec "$B" bash "$CT" hostkey)"
  echo "R7V READY";;
hostile) for c in "$A" "$B"; do echo "== $c hostile"; docker exec "$c" bash "$CT" hostile; done;;
tamper|untamper|forge|unforge|r8-sudo-on|r8-sudo-off|r8-libsh) docker exec "$A" bash "$CT" "$CMD";;
pull-log) docker exec "$B" bash "$CT" pull-log;;
r9-drop-end|r9-restore-end|r9-drop-dispatch) docker exec "$B" bash "$CT" "$CMD";;
down)
  n=$(docker ps -aq --filter "label=$LBL" | wc -l); [ "$n" = 0 ] || docker ps -aq --filter "label=$LBL" | xargs -r docker rm -f > /dev/null
  [ "$KEEP" = --keep-image ] || docker rmi "$IMG" > /dev/null 2>&1
  rm -rf "$WS"
  echo "removed $n container(s); left: containers $(docker ps -aq --filter "label=$LBL" | wc -l), images $(docker images -q --filter "label=$LBL" | wc -l), workspace $([ -e "$WS" ] && echo present || echo removed)";;
*) echo "STOP unknown command $CMD"; exit 2;;
esac
