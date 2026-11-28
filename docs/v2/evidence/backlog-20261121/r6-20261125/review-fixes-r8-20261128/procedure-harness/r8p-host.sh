#!/usr/bin/env bash
# r8p-host.sh (R6 r8, 28 Nov 2026). REHEARSAL ONLY: runs on streamanator (the DEV host) as arm, never on production. Driven by
# r8p-run.sh on the workstation. One disposable container whose PID 1 is the REAL systemd 255 (the pinned base image of the r6/r7
# harnesses, sha256:d71c0b28..., Ubuntu 24.04, plus apt packages installed in the image build only, the one step that uses the
# network). Container flags (never --privileged): --network none --cgroupns=private --tmpfs /run --tmpfs /run/lock --cap-add
# SYS_ADMIN (systemd as PID 1) --cap-add DAC_READ_SEARCH --cap-add SYS_PTRACE (the verifier's root facts unit keeps them)
# --security-opt apparmor=unconfined. NO bind mount: the harness files are copied in with `docker cp` and owned by root, so nothing
# in the container belongs to streamanator's uid 1000 (which would be arm's uid inside). Labels r8p.run=<RID> on image and container.
# Usage: bash r8p-host.sh <WS> <RID> up | exec <container command> [args...] | down
set -uo pipefail; export LC_ALL=C
[ "$(hostname)" != afldb-prod ] || { echo "REFUSED: rehearsal never runs on production"; exit 2; }
WS=${1:?workspace}; RID=${2:?rid}; CMD=${3:?command}; shift 3
[[ $RID =~ ^[A-Za-z0-9-]+$ ]] && [ -d "$WS/fix" ] && [ -O "$WS" ] || { echo "STOP not this run's private workspace: $WS ($RID)"; exit 2; }
PIN=sha256:d71c0b286c54a7cc48645aa8d4d9d0c57e4260128cb91a6fb18c29d7589205ba
IMG=r8p-sysd-$RID:1; LBL=r8p.run=$RID; C=r8p-$RID
CT=/root/r8in/r8p-container.sh
case $CMD in
up)
  read -r ARMPW || { echo "STOP no arm password on stdin"; exit 1; }   # read first: nothing below may consume it
  echo "== r8p host up $(date -u +%FT%TZ) host=$(hostname) id=[$(id)] docker $(docker version -f '{{.Server.Version}}') rootless=$(docker info -f '{{range .SecurityOptions}}{{.}} {{end}}' 2>/dev/null | grep -c rootless)"
  if ! docker image inspect "$IMG" > /dev/null 2>&1; then
    mkdir -p "$WS/build"
    printf 'FROM %s\nLABEL %s\nENV DEBIAN_FRONTEND=noninteractive\nRUN apt-get update && apt-get install -y --no-install-recommends systemd systemd-sysv dbus libpam-systemd util-linux coreutils procps passwd sudo acl postgresql-16 postgresql-client-16 openssh-server openssh-client netcat-openbsd python3 tzdata && rm -rf /var/lib/apt/lists/* && systemctl --version | head -1\n' \
      "$PIN" "$LBL" > "$WS/build/Dockerfile"
    docker build --label "$LBL" -t "$IMG" "$WS/build" > "$WS/build/build.log" 2>&1 || { tail -20 "$WS/build/build.log"; echo "STOP image build failed"; exit 1; }
  fi
  echo "image $IMG id $(docker image inspect -f '{{.Id}}' "$IMG") from $PIN"
  printf '#!/bin/sh\n# REHEARSAL ONLY: systemd as PID 1 needs the container cgroup2 writable; then init.\nmount -o remount,rw /sys/fs/cgroup || exit 97\nexec /sbin/init\n' > "$WS/entry.sh"; chmod 755 "$WS/entry.sh"
  docker create --name "$C" --label "$LBL" --network none --hostname afldb-prod --cgroupns=private --tmpfs /run --tmpfs /run/lock \
    --cap-add SYS_ADMIN --cap-add DAC_READ_SEARCH --cap-add SYS_PTRACE --security-opt apparmor=unconfined --stop-signal SIGRTMIN+3 \
    --entrypoint /entry.sh "$IMG" > /dev/null || { echo "STOP docker create"; exit 1; }
  docker cp "$WS/entry.sh" "$C:/entry.sh" > /dev/null && docker cp "$WS/fix/." "$C:/root/r8in" > /dev/null || { echo "STOP docker cp"; exit 1; }
  docker start "$C" > /dev/null || { echo "STOP docker start"; exit 1; }
  docker exec "$C" sh -c 'chown -R root:root /root/r8in /entry.sh && chmod -R go-w /root/r8in && chmod 0700 /root/r8in'
  echo "R8P CTR $C"
  printf '%s\n' "$ARMPW" | docker exec -i "$C" bash "$CT" setup;;
exec)
  docker exec -i "$C" bash "$CT" "$@";;
down)
  n=$(docker ps -aq --filter "label=$LBL" | wc -l); [ "$n" = 0 ] || docker ps -aq --filter "label=$LBL" | xargs -r docker rm -f > /dev/null
  docker rmi "$IMG" > /dev/null 2>&1
  rm -rf "$WS"
  echo "removed $n container(s); left: containers $(docker ps -aq --filter "label=$LBL" | wc -l), images $(docker images -q --filter "label=$LBL" | wc -l), workspace $([ -e "$WS" ] && echo present || echo removed), other r8p workspaces: $(ls -d "$HOME"/r8p-ws.* 2>/dev/null | wc -l)";;
*) echo "STOP unknown command $CMD"; exit 2;;
esac
