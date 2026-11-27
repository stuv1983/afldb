#!/usr/bin/env bash
# REHEARSAL ONLY (R6 r5, 27 Nov 2026). Host driver, run on streamanator (the DEV host) as arm in ONE ssh connection; never production.
# Runs real-systemd-container.sh once per scenario in its own disposable container whose PID 1 is the real systemd 255 (Ubuntu 24.04,
# the pinned image's Ubuntu 24.04.4 userland plus apt's systemd 255.4-1ubuntu8.x), so a REAL timer starts a REAL service and the gates
# read the REAL systemctl / journalctl / busctl as a real non-adm user arm.
# Input: RUN/fix (an export of the worktree: deploy/, docs/v2/evidence/..., tools/maintenance, tools/build). Output: RUN/logs/.
# Everything created is labelled r5f2.run=<RID>: the image r5f2-sysd-<RID>:1 (one image, built here from the pinned image + apt systemd
# packages; the only step that uses the network, through docker build), the containers r5f2-<RID>-<scenario>. The driver removes the
# containers; it removes the image only with the argument `--rmi`. Nothing else on the host is touched.
# Container flags (no --privileged): --network none, --hostname afldb-prod, --cgroupns=private, --tmpfs /run, --tmpfs /run/lock,
#   --cap-add SYS_ADMIN, --security-opt apparmor=unconfined (docker's default AppArmor profile forbids the one mount below),
#   and an entry script that remounts the container's own cgroup2 mount read-write (docker mounts it read-only; systemd needs it
#   writable), installs a fixed-offset Australia/Melbourne zone, then execs /sbin/init. The first try with only the first four flags
#   failed: "Failed to create /init.scope control group: Read-only file system".
# Usage: bash real-systemd-attribution.sh <RUN> <RID> [--rmi] [scenario ...]    (default: all scenarios, in parallel)
set -uo pipefail; export LC_ALL=C
[ "$(hostname)" != afldb-prod ] || { echo "REFUSED: rehearsal never runs on production"; exit 2; }
RUN=${1:?run directory}; RID=${2:?run id}; shift 2
[[ $RID =~ ^[A-Za-z0-9-]+$ ]] && [ -d "$RUN/fix" ] && [ -O "$RUN" ] || { echo "STOP not this run's private directory: $RUN ($RID)"; exit 2; }
RMI=0; [ "${1:-}" = --rmi ] && { RMI=1; shift; }
SCEN=("$@"); [ ${#SCEN[@]} -gt 0 ] || SCEN=(evidence genuine-r5 genuine-r5-second-night genuine-current astra-dep-r5 astra-dep-current astra-exec-r5)
PIN=sha256:d71c0b286c54a7cc48645aa8d4d9d0c57e4260128cb91a6fb18c29d7589205ba   # grafana/alloy:latest on streamanator, Ubuntu 24.04.4
IMG=r5f2-sysd-$RID:1; NODED=/home/arm/.nvm/versions/node/v22.23.2
H5=docs/v2/evidence/backlog-20261121/r6-20261125/review-fixes-r5-20261127; LBL=r5f2.run=$RID
LOGS=$RUN/logs; mkdir -p "$LOGS"
echo "== R6 r5 real-systemd rehearsal $(date -u +%FT%TZ) host=$(hostname) user=$(id -un) run=$RUN image=$IMG docker $(docker version -f '{{.Server.Version}}')"
if ! docker image inspect "$IMG" > /dev/null 2>&1; then
  mkdir -p "$RUN/build"
  printf 'FROM %s\nLABEL %s\nENV DEBIAN_FRONTEND=noninteractive\nRUN apt-get update && apt-get install -y --no-install-recommends systemd systemd-sysv dbus libpam-systemd util-linux coreutils procps && rm -rf /var/lib/apt/lists/* && systemctl --version | head -1\n' \
    "$PIN" "$LBL" > "$RUN/build/Dockerfile"
  docker build --label "$LBL" -t "$IMG" "$RUN/build" > "$RUN/build/build.log" 2>&1 || { tail -5 "$RUN/build/build.log"; echo "STOP image build failed"; exit 1; }
fi
echo "image $IMG id $(docker image inspect -f '{{.Id}}' "$IMG") ($(docker image inspect -f '{{.Os}}/{{.Architecture}}' "$IMG"))"
cat > "$RUN/entry-real.sh" <<'EOF'
#!/bin/sh
# REHEARSAL ONLY: (1) the container's own cgroup2 mount is read-only; systemd as PID 1 needs it writable. (2) a fixed-offset
# Australia/Melbourne zone ($FAKE_STDOFF, hh:mm:ss) so the real wall clock reads 02:20 on 2026-11-28 at the real dispatch. (3) become systemd.
mount -o remount,rw /sys/fs/cgroup || exit 97
printf 'Zone Australia/Melbourne %s - AEDT\n' "$FAKE_STDOFF" > /tmp/fake.zone
zic -d /usr/share/zoneinfo /tmp/fake.zone || exit 96
ln -sf /usr/share/zoneinfo/Australia/Melbourne /etc/localtime
exec /sbin/init
EOF
chmod 755 "$RUN/entry-real.sh"

hms() { local s=$1 sign=; [ "$s" -lt 0 ] && { sign=-; s=$((-s)); }; printf '%s%d:%02d:%02d' "$sign" $((s / 3600)) $((s % 3600 / 60)) $((s % 60)); }
run_one() { # scenario
  local sc=$1 name=r5f2-$RID-$1 log=$LOGS/real-systemd-$1.log now0 lead=75 td off rc ctl=/in/fix/$H5/real-systemd-container.sh
  now0=$(date +%s); td=$((now0 + lead)); [ "$sc" = genuine-r5-second-night ] && td=$((td + 120))   # the 02:20 dispatch; the 02:18 one is 120 s earlier
  off=$(( $(date -u -d '2026-11-28 02:20:00' +%s) - td ))
  {
    echo "== real-systemd scenario $sc"
    echo "host $(hostname) ($(id -un)); started $(date -u +%FT%TZ); container $name; fake Melbourne offset $(hms "$off") (the 02:20:00 dispatch is due at real $(date -u -d @$td +%FT%TZ))"
    echo "gate scripts: G0 $(sha256sum < "$RUN/fix/docs/v2/evidence/release-17822b29-20261124/scripts/r1-g0-dump.sh" | cut -c1-64)"
    echo "              A-2 $(sha256sum < "$RUN/fix/docs/v2/evidence/backlog-20261121/r6-20261125/r6-pre-verify.sh" | cut -c1-64)"
    echo "              scheduled-backup.sh (r5) $(sha256sum < "$RUN/fix/tools/maintenance/scheduled-backup.sh" | cut -c1-64)"
    echo "              f92d6e29 G0 $(sha256sum < "$RUN/fix/$H5/orig-f92d6e29/r1-g0-dump.sh" | cut -c1-64), A-2 $(sha256sum < "$RUN/fix/$H5/orig-f92d6e29/r6-pre-verify.sh" | cut -c1-64), scheduled-backup.sh $(sha256sum < "$RUN/fix/$H5/orig-f92d6e29/scheduled-backup.sh" | cut -c1-64)"
  } > "$log"
  if ! docker run -d --name "$name" --label "$LBL" --network none --hostname afldb-prod --cgroupns=private --tmpfs /run --tmpfs /run/lock \
      --cap-add SYS_ADMIN --security-opt apparmor=unconfined --stop-signal SIGRTMIN+3 -e "FAKE_STDOFF=$(hms "$off")" \
      -v "$RUN/entry-real.sh:/entry.sh:ro" -v "$RUN/fix:/in/fix:ro" -v "$NODED:$NODED:ro" --entrypoint /entry.sh "$IMG" >> "$log" 2>&1; then
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
for sc in "${SCEN[@]}"; do wait "${PID[$sc]}"; rc=$?; echo "scenario $sc: controller exit $rc ($(grep -h '^VERDICT\|^CONTRAST' "$LOGS/real-systemd-$sc.log" | tr '\n' ' ' | cut -c1-300))"; [ "$rc" = 0 ] || BAD=$((BAD + 1)); done
left=$(docker ps -aq --filter "label=$LBL" | wc -l)
[ "$left" = 0 ] || { echo "removing $left leftover container(s)"; docker ps -aq --filter "label=$LBL" | xargs -r docker rm -f > /dev/null; }
[ "$RMI" = 1 ] && { docker rmi "$IMG" > /dev/null 2>&1 && echo "image $IMG removed"; }
echo "== done: $BAD scenario(s) unexpected; containers left with label $LBL: $(docker ps -aq --filter "label=$LBL" | wc -l)"
[ "$BAD" = 0 ] && echo "R6 r5 REAL-SYSTEMD REHEARSAL PASS" || { echo "R6 r5 REAL-SYSTEMD REHEARSAL FAIL ($BAD)"; exit 1; }
