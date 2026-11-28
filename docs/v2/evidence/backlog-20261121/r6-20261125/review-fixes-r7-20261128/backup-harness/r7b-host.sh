#!/usr/bin/env bash
# REHEARSAL ONLY (R6 r7, 28 Nov 2026). Host driver of the SEALED-BACKUP real-systemd harness (DESIGN.md section 6). Runs on
# streamanator (the DEV host) as arm, never on production. One disposable container per scenario; r7b-container.sh runs inside it.
# PID 1 is the real systemd 255.4 (the pinned image's Ubuntu 24.04 userland plus apt's systemd, PostgreSQL 16, rsync and strace,
# installed in the image build only, the one step that uses the network). Container flags (never --privileged): --network none
# --cgroupns=private --tmpfs /run --tmpfs /run/lock --cap-add SYS_ADMIN (systemd as PID 1: cgroup2 remount) --cap-add SYS_PTRACE
# (the harness's own root strace HOLD of the sealer, FIXTURE) --security-opt apparmor=unconfined. The entry script remounts the
# container's cgroup2 read-write, installs a FIXED-OFFSET Australia/Melbourne zone so the real timer's 02:20 lands on today's
# Melbourne date a little after the container starts, and execs /sbin/init.
# Input: RUN/fix = the transported files (r7b-run.sh). Output: RUN/logs/r7b-<scenario>.log and RUN/logs/r7b-summary.log.
# Labels: everything created carries r7b.run=<RID>: image r7b-sysd-<RID>:1 (unless --image), containers r7b-<RID>-<scenario>.
# The driver removes its containers always and its image unless --keep-image or --image. Nothing else on the host is touched.
# Usage: bash r7b-host.sh <RUN> <RID> [--image <tag>] [--keep-image] [scenario ...]   (default: every scenario, in parallel)
set -uo pipefail; export LC_ALL=C
[ "$(hostname)" != afldb-prod ] || { echo "REFUSED: rehearsal never runs on production"; exit 2; }
RUN=${1:?run directory}; RID=${2:?run id}; shift 2
[[ $RID =~ ^[A-Za-z0-9-]+$ ]] && [ -d "$RUN/fix" ] && [ -O "$RUN" ] || { echo "STOP not this run's private directory: $RUN ($RID)"; exit 2; }
KEEPIMG=0; IMG=
while [ $# -gt 0 ]; do case $1 in --keep-image) KEEPIMG=1; shift;; --image) IMG=${2:?tag}; KEEPIMG=1; shift 2;; *) break;; esac; done
ALL=(genuine perm review2 hand-start timer-then-hand restart rearm-in rearm-out pgdump-fails seal-interrupted genuine-rd rearm-in-rd post-pub-fail)
SCEN=("$@"); [ ${#SCEN[@]} -gt 0 ] || SCEN=("${ALL[@]}")
for sc in "${SCEN[@]}"; do [[ " ${ALL[*]} " == *" $sc "* ]] || { echo "STOP unknown scenario $sc"; exit 2; }; done
PIN=sha256:d71c0b286c54a7cc48645aa8d4d9d0c57e4260128cb91a6fb18c29d7589205ba   # grafana/alloy:latest on streamanator, Ubuntu 24.04.4
LBL=r7b.run=$RID; R7=docs/v2/evidence/backlog-20261121/r6-20261125/review-fixes-r7-20261128
LOGS=$RUN/logs; mkdir -p "$LOGS"
DAY=$(TZ=Australia/Melbourne date +%F)
[[ $DAY =~ ^2026-11-2[4-9]$ ]] || { echo "STOP today (Melbourne) is $DAY: outside 2026-11-24..29, the packet gates' accepted days"; exit 2; }
echo "== R7 sealed-backup real-systemd harness $(date -u +%FT%TZ) host=$(hostname) user=$(id -un) run=$RUN rid=$RID day=$DAY docker $(docker version -f '{{.Server.Version}}')"
[ -f "$RUN/presend.txt" ] && cat "$RUN/presend.txt"
if [ -z "$IMG" ]; then
  IMG=r7b-sysd-$RID:1
  mkdir -p "$RUN/build"
  printf 'FROM %s\nLABEL %s\nENV DEBIAN_FRONTEND=noninteractive\nRUN apt-get update && apt-get install -y --no-install-recommends systemd systemd-sysv dbus libpam-systemd util-linux coreutils procps postgresql-16 postgresql-client-16 rsync strace && rm -rf /var/lib/apt/lists/* && systemctl --version | head -1\n' \
    "$PIN" "$LBL" > "$RUN/build/Dockerfile"
  docker build --label "$LBL" -t "$IMG" "$RUN/build" > "$RUN/build/build.log" 2>&1 || { tail -5 "$RUN/build/build.log"; echo "STOP image build failed"; exit 1; }
fi
echo "image $IMG id $(docker image inspect -f '{{.Id}}' "$IMG") (base $PIN)"
cat > "$RUN/entry.sh" <<'EOF'
#!/bin/sh
# REHEARSAL ONLY: (1) systemd as PID 1 needs the container's cgroup2 writable. (2) FIXTURE: a fixed-offset Australia/Melbourne zone
# ($FAKE_STDOFF, hh:mm:ss) so the real wall clock reads the scenario's local time at the planned moment of today's date. (3) init.
mount -o remount,rw /sys/fs/cgroup || exit 97
printf 'Zone Australia/Melbourne %s - AEDT\n' "$FAKE_STDOFF" > /tmp/fake.zone
zic -d /usr/share/zoneinfo /tmp/fake.zone || exit 96
ln -sf /usr/share/zoneinfo/Australia/Melbourne /etc/localtime
exec /sbin/init
EOF
chmod 755 "$RUN/entry.sh"
hms() { local s=$1 sign=; [ "$s" -lt 0 ] && { sign=-; s=$((-s)); }; printf '%s%d:%02d:%02d' "$sign" $((s / 3600)) $((s % 3600 / 60)) $((s % 60)); }
# The local wall-clock time each scenario's planned moment (the dispatch, the re-arm or the start by hand) must read.
local_at() { case $1 in rearm-in|rearm-in-rd) echo 02:20:15;; rearm-out) echo 02:32:00;; hand-start) echo 02:20:30;; *) echo 02:20:00;; esac; }
run_one() { # scenario
  local sc=$1 name=r7b-$RID-$1 log=$LOGS/r7b-$1.log lead=120 td off rc
  # whole-minute offset (offhost-pull.sh reads zone offsets as +hhmm): td moves later by up to 59 s
  td=$(( $(date +%s) + lead )); off=$(( $(date -u -d "$DAY $(local_at "$sc")" +%s) - td )); off=$(( off - ((off % 60) + 60) % 60 ))
  td=$(( $(date -u -d "$DAY $(local_at "$sc")" +%s) - off ))
  { echo "== R7 sealed-backup scenario $sc"
    echo "host $(hostname) ($(id -un)); started $(date -u +%FT%TZ); container $name; image $IMG"
    echo "[FIXTURE] fake Melbourne offset $(hms "$off"): local $DAY $(local_at "$sc") is real $(date -u -d @$td +%FT%TZ)"
    [ -f "$RUN/presend.txt" ] && cat "$RUN/presend.txt"
    echo "inputs (sha256, as sent):"; (cd "$RUN/fix" && find . -type f | sort | while read -r f; do echo "   $(sha256sum < "$f" | cut -c1-64)  ${f#./}"; done)
    printf 'container id: '
  } > "$log"
  if ! docker run -d --name "$name" --label "$LBL" --network none --hostname r7b-rehearsal --cgroupns=private --tmpfs /run --tmpfs /run/lock \
      --cap-add SYS_ADMIN --cap-add SYS_PTRACE --security-opt apparmor=unconfined --stop-signal SIGRTMIN+3 \
      -e "FAKE_STDOFF=$(hms "$off")" -e "R7B_DAY=$DAY" -e "R7B_TD=$td" \
      -v "$RUN/entry.sh:/entry.sh:ro" -v "$RUN/fix:/in/fix:ro" --entrypoint /entry.sh "$IMG" >> "$log" 2>&1; then
    echo "SCENARIO $sc FAIL container did not start" >> "$log"; return 99
  fi
  docker exec "$name" bash "/in/fix/$R7/backup-harness/r7b-container.sh" "$sc" >> "$log" 2>&1; rc=$?
  echo "== controller exit $rc ($(date -u +%FT%TZ)); container removed" >> "$log"
  docker rm -f "$name" > /dev/null 2>&1
  return $rc
}
declare -A PID
for sc in "${SCEN[@]}"; do run_one "$sc" & PID[$sc]=$!; sleep 2; done
declare -A RC
for sc in "${SCEN[@]}"; do wait "${PID[$sc]}"; RC[$sc]=$?; done
BAD=0
{ for sc in "${SCEN[@]}"; do
    rc=${RC[$sc]}
    line=$(grep -h '^SCENARIO ' "$LOGS/r7b-$sc.log" | tail -1)
    [ -n "$line" ] || line="SCENARIO $sc FAIL no summary line (controller exit $rc)"
    printf '%s\n' "$line" | cut -c1-600
    [[ $line == "SCENARIO $sc PASS"* ]] && [ "$rc" = 0 ] || BAD=$((BAD + 1))
  done
  left=$(docker ps -aq --filter "label=$LBL" | wc -l)
  [ "$left" = 0 ] || { echo "removing $left leftover container(s)"; docker ps -aq --filter "label=$LBL" | xargs -r docker rm -f > /dev/null; }
  [ "$KEEPIMG" = 1 ] || { docker rmi "$IMG" > /dev/null 2>&1 && echo "image $IMG removed"; }
  echo "containers left with label $LBL: $(docker ps -aq --filter "label=$LBL" | wc -l); images with label $LBL: $(docker images -q --filter "label=$LBL" | wc -l)"
  [ "$BAD" = 0 ] && echo "R7 BACKUP HARNESS RESULT PASS" || echo "R7 BACKUP HARNESS RESULT FAIL ($BAD scenario(s) not as expected)"
} | tee "$LOGS/r7b-summary.log"
grep -q '^R7 BACKUP HARNESS RESULT PASS' "$LOGS/r7b-summary.log"
