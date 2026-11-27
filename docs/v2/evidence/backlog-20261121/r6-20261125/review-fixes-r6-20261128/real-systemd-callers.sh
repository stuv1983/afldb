#!/usr/bin/env bash
# REHEARSAL ONLY (R6 r6, 28 Nov 2026). Host driver for the REAL-SYSTEMD CALLER HARNESS. Runs on streamanator (the DEV host) as arm,
# never on production. Replaces the r5 extracted-function A-2 rehearsal (review-fixes-r5-20261127/real-systemd-attribution.sh): here the
# two ACTUAL gate callers run unmodified, through their real main, against a real systemd 255 timer, service, job and journal:
#   release G0  docs/v2/evidence/release-17822b29-20261124/scripts/r1-g0-dump.sh <today>
#   R6 A-2      docs/v2/evidence/backlog-20261121/r6-20261125/r6-pre-verify.sh <seven arguments>
# One disposable container per scenario (real-systemd-callers-container.sh runs inside it); PID 1 is the real systemd 255 (the pinned
# image's Ubuntu 24.04 userland plus apt's systemd packages, installed in the image build only, the one step that uses the network).
# Container flags (never --privileged): --network none --hostname afldb-prod --cgroupns=private --tmpfs /run --tmpfs /run/lock
#   --cap-add SYS_ADMIN --security-opt apparmor=unconfined; the entry script remounts the container's cgroup2 read-write, installs a
#   FIXED-OFFSET Australia/Melbourne zone (so the real 02:20 dispatch lands on today's Melbourne date) and execs /sbin/init.
# Input:  RUN/fix = a tar export of the worktree files listed in INPUTS below (unpacked by the caller). Output: RUN/logs/*.log.
# Labels: everything created carries r6h.run=<RID>: image r6h-sysd-<RID>:1, containers r6h-<RID>-<scenario>. The driver removes its
#   containers always and its image unless --keep-image. Nothing else on the host is touched (no sudo, no lxc, no package install).
# r6 review (28 Nov): scenario arm-node-swap (MED-1): arm replaces its own ~/.nvm node (the gates' journal parser) with a wrapper.
#   RUN/presend.txt, when the transport wrote one, is printed in every scenario header (pre-send verification against a git revision).
# Usage:  bash real-systemd-callers.sh <RUN> <RID> [--smoke] [--keep-image] [scenario ...]   (default: every scenario, in parallel)
#   --smoke  plumbing check: an absent attest bundle is noted instead of a STOP, and logs are named smoke-real-systemd-callers-*.log
# INPUTS (relative to RUN/fix): deploy/afldb-backup.service deploy/afldb-backup.timer deploy/afldb-backup-failed.service
#   tools/maintenance/scheduled-backup.sh docs/v2/evidence/release-17822b29-20261124/scripts/r1-g0-dump.sh
#   docs/v2/evidence/backlog-20261121/r6-20261125/r6-pre-verify.sh and review-fixes-r6-20261128/{attest/,orig-624bf721/,real-systemd-callers*.sh}
set -uo pipefail; export LC_ALL=C
[ "$(hostname)" != afldb-prod ] || { echo "REFUSED: rehearsal never runs on production"; exit 2; }
RUN=${1:?run directory}; RID=${2:?run id}; shift 2
[[ $RID =~ ^[A-Za-z0-9-]+$ ]] && [ -d "$RUN/fix" ] && [ -O "$RUN" ] || { echo "STOP not this run's private directory: $RUN ($RID)"; exit 2; }
SMOKE=0; KEEPIMG=0
while [ $# -gt 0 ]; do case $1 in --smoke) SMOKE=1; shift;; --keep-image) KEEPIMG=1; shift;; *) break;; esac; done
ALL=(genuine-attested astra-manual-after-hidden-failure old-install-r5-trigger forged-trigger-manual record-missing record-ambiguous
     record-groupwritable restart-hidden-first timer-rearm arm-node-swap)
SCEN=("$@"); [ ${#SCEN[@]} -gt 0 ] || SCEN=("${ALL[@]}")
for sc in "${SCEN[@]}"; do [[ " ${ALL[*]} " == *" $sc "* ]] || { echo "STOP unknown scenario $sc"; exit 2; }; done
PIN=sha256:d71c0b286c54a7cc48645aa8d4d9d0c57e4260128cb91a6fb18c29d7589205ba   # grafana/alloy:latest on streamanator, Ubuntu 24.04.4
IMG=r6h-sysd-$RID:1; LBL=r6h.run=$RID; NODED=/home/arm/.nvm/versions/node/v22.23.2
H6=docs/v2/evidence/backlog-20261121/r6-20261125/review-fixes-r6-20261128
PFX=real-systemd-callers; [ "$SMOKE" = 1 ] && PFX=smoke-real-systemd-callers
LOGS=$RUN/logs; mkdir -p "$LOGS"
# Today's Melbourne date (real zone, on the host): the gates accept 2026-11-24..29 only; the fake zone puts 02:20 on this date.
DAY=$(TZ=Australia/Melbourne date +%F)
[[ $DAY =~ ^2026-11-2[4-9]$ ]] || { echo "STOP today (Melbourne) is $DAY: outside 2026-11-24..29, the gates' accepted days"; exit 2; }
[ -x "$NODED/bin/node" ] || { echo "STOP no $NODED/bin/node on this host"; exit 2; }
echo "== R6 r6 real-systemd CALLER harness $(date -u +%FT%TZ) host=$(hostname) user=$(id -un) run=$RUN rid=$RID day=$DAY smoke=$SMOKE docker $(docker version -f '{{.Server.Version}}')"
if ! docker image inspect "$IMG" > /dev/null 2>&1; then
  mkdir -p "$RUN/build"
  printf 'FROM %s\nLABEL %s\nENV DEBIAN_FRONTEND=noninteractive\nRUN apt-get update && apt-get install -y --no-install-recommends systemd systemd-sysv dbus libpam-systemd util-linux coreutils procps && rm -rf /var/lib/apt/lists/* && systemctl --version | head -1\n' \
    "$PIN" "$LBL" > "$RUN/build/Dockerfile"
  docker build --label "$LBL" -t "$IMG" "$RUN/build" > "$RUN/build/build.log" 2>&1 || { tail -5 "$RUN/build/build.log"; echo "STOP image build failed"; exit 1; }
fi
echo "image $IMG id $(docker image inspect -f '{{.Id}}' "$IMG") ($(docker image inspect -f '{{.Os}}/{{.Architecture}}' "$IMG")) from $PIN"
cat > "$RUN/entry-real.sh" <<'EOF'
#!/bin/sh
# REHEARSAL ONLY: (1) the container's own cgroup2 mount is read-only; systemd as PID 1 needs it writable. (2) FIXTURE: a fixed-offset
# Australia/Melbourne zone ($FAKE_STDOFF, hh:mm:ss) so the real wall clock reads 02:20:00 on today's date at the real dispatch. (3) init.
mount -o remount,rw /sys/fs/cgroup || exit 97
printf 'Zone Australia/Melbourne %s - AEDT\n' "$FAKE_STDOFF" > /tmp/fake.zone
zic -d /usr/share/zoneinfo /tmp/fake.zone || exit 96
ln -sf /usr/share/zoneinfo/Australia/Melbourne /etc/localtime
exec /sbin/init
EOF
chmod 755 "$RUN/entry-real.sh"

hms() { local s=$1 sign=; [ "$s" -lt 0 ] && { sign=-; s=$((-s)); }; printf '%s%d:%02d:%02d' "$sign" $((s / 3600)) $((s % 3600 / 60)) $((s % 60)); }
run_one() { # scenario
  local sc=$1 name=r6h-$RID-$1 log=$LOGS/$PFX-$1.log now0 lead=100 td off rc ctl=/in/fix/$H6/real-systemd-callers-container.sh
  now0=$(date +%s); td=$((now0 + lead))
  off=$(( $(date -u -d "$DAY 02:20:00" +%s) - td ))
  {
    echo "== real-systemd caller scenario $sc (smoke=$SMOKE)"
    echo "host $(hostname) ($(id -un)); started $(date -u +%FT%TZ); container $name; image $IMG"
    echo "[FIXTURE] fake Melbourne offset $(hms "$off"): the 02:20:00 dispatch on $DAY is due at real $(date -u -d @$td +%FT%TZ)"
    [ -f "$RUN/presend.txt" ] && cat "$RUN/presend.txt"
    echo "inputs (sha256):"
    for f in docs/v2/evidence/release-17822b29-20261124/scripts/r1-g0-dump.sh docs/v2/evidence/backlog-20261121/r6-20261125/r6-pre-verify.sh \
             tools/maintenance/scheduled-backup.sh deploy/afldb-backup.service deploy/afldb-backup.timer deploy/afldb-backup-failed.service \
             "$H6"/orig-624bf721/r1-g0-dump.sh "$H6"/orig-624bf721/r6-pre-verify.sh "$H6"/orig-624bf721/scheduled-backup.sh \
             "$H6"/real-systemd-callers.sh "$H6"/real-systemd-callers-container.sh $(cd "$RUN/fix" && ls -1d "$H6"/attest/* contrast-*/* 2>/dev/null); do
      [ -f "$RUN/fix/$f" ] && echo "   $(sha256sum < "$RUN/fix/$f" | cut -c1-64)  $f" || echo "   ABSENT  $f"
    done
    [ -n "$(ls -A "$RUN/fix/$H6/attest" 2>/dev/null)" ] || echo "   (attest bundle directory empty or absent)"
    printf 'container id: '
  } > "$log"
  # Node: the host's real node is ALWAYS mounted read-only at /opt/realnode (the harness's own journal printer uses it, so root never
  # executes an arm-controlled binary). At the gates' pinned path it is a read-only bind mount too, EXCEPT in arm-node-swap, where the
  # controller copies it into an arm-owned ~/.nvm (FIXTURE-ATTACK: production's arm owns ~/.nvm).
  local nodemnt=(-v "$NODED:/opt/realnode:ro"); [ "$sc" = arm-node-swap ] || nodemnt+=(-v "$NODED:$NODED:ro")
  if ! docker run -d --name "$name" --label "$LBL" --network none --hostname afldb-prod --cgroupns=private --tmpfs /run --tmpfs /run/lock \
      --cap-add SYS_ADMIN --security-opt apparmor=unconfined --stop-signal SIGRTMIN+3 \
      -e "FAKE_STDOFF=$(hms "$off")" -e "R6H_DAY=$DAY" -e "R6H_SMOKE=$SMOKE" -e "R6H_DISPATCH=$td" \
      -v "$RUN/entry-real.sh:/entry.sh:ro" -v "$RUN/fix:/in/fix:ro" "${nodemnt[@]}" --entrypoint /entry.sh "$IMG" >> "$log" 2>&1; then
    echo "controller exit 99 (container did not start)" >> "$log"; return 99
  fi
  docker exec "$name" bash "$ctl" "$sc" >> "$log" 2>&1; rc=$?
  echo "== controller exit $rc ($(date -u +%FT%TZ)); container removed" >> "$log"
  docker rm -f "$name" > /dev/null 2>&1
  return $rc
}
declare -A PID
for sc in "${SCEN[@]}"; do run_one "$sc" & PID[$sc]=$!; sleep 1; done
BAD=0
for sc in "${SCEN[@]}"; do
  wait "${PID[$sc]}"; rc=$?
  echo "scenario $sc: controller exit $rc"
  grep -h '^VERDICT\|^CONTRAST\|^FINDING\|^RESULT-' "$LOGS/$PFX-$sc.log" | cut -c1-400 | sed 's/^/   /'
  [ "$rc" = 0 ] || BAD=$((BAD + 1))
done
left=$(docker ps -aq --filter "label=$LBL" | wc -l)
[ "$left" = 0 ] || { echo "removing $left leftover container(s)"; docker ps -aq --filter "label=$LBL" | xargs -r docker rm -f > /dev/null; }
[ "$KEEPIMG" = 1 ] || { docker rmi "$IMG" > /dev/null 2>&1 && echo "image $IMG removed"; }
echo "== done: $BAD scenario(s) not as expected; containers left with label $LBL: $(docker ps -aq --filter "label=$LBL" | wc -l); images: $(docker images -q --filter "label=$LBL" | wc -l)"
[ "$BAD" = 0 ] && echo "R6 r6 REAL-SYSTEMD CALLER HARNESS: every scenario as expected" || { echo "R6 r6 REAL-SYSTEMD CALLER HARNESS: $BAD scenario(s) NOT as expected (read the logs)"; exit 1; }
