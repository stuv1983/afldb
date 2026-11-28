#!/usr/bin/env bash
# p4-host.sh (R6 r10, 28 Nov 2026; r9 copy with r10 labels). REHEARSAL ONLY: runs on streamanator (the DEV host) as arm, never on production. Driven by p4-run.sh
# on the workstation over ONE ssh connection. It builds one image from the pinned base of the r6/r7/r8 harnesses (sha256:d71c0b28...,
# Ubuntu 24.04) plus the sudo package (the build is the only step with network), then runs every scenario in its OWN disposable
# container: --network none, never --privileged, no bind mount, no added capability; the scenario files reach it as a tar on stdin
# and are owned by root. Every account, group and sudoers change happens inside those containers; streamanator's own accounts,
# groups, sudoers and keys are never touched. On exit it removes the containers, the image and the workspace, and prints the residue.
# Usage: bash p4-host.sh <WS> <RID> <scenario>...
set -uo pipefail; export LC_ALL=C
[ "$(hostname)" != afldb-prod ] || { echo "REFUSED: rehearsal never runs on production"; exit 2; }
WS=${1:?workspace}; RID=${2:?rid}; shift 2
[[ $RID =~ ^[A-Za-z0-9-]{1,24}$ ]] && [ -d "$WS/fix" ] && [ -O "$WS" ] && [[ $WS == "$HOME"/r10p4-ws.* ]] || { echo "STOP not this run's private workspace: $WS ($RID)"; exit 2; }
PIN=sha256:d71c0b286c54a7cc48645aa8d4d9d0c57e4260128cb91a6fb18c29d7589205ba
IMG=r10p4-$RID:1; LBL=r10p4.run=$RID
cache() { docker system df 2>/dev/null | awk '/^Build Cache/ {print $2 " entries, " $4}'; }
cleanup() {
  docker ps -aq --filter "label=$LBL" | xargs -r docker rm -f > /dev/null
  docker rmi "$IMG" > /dev/null 2>&1
  rm -rf "$WS"
  echo "R10P4 RESIDUE containers=$(docker ps -aq --filter "label=$LBL" | wc -l) images=$(docker images -q --filter "label=$LBL" | wc -l) workspace=$([ -e "$WS" ] && echo present || echo removed) r10p4-workspaces=$(ls -d "$HOME"/r10p4-ws.* 2>/dev/null | wc -l) base-image=$(docker image inspect -f '{{.Id}}' "$PIN" 2>/dev/null | cut -c1-19) build-cache=[$(cache)]"
}
trap cleanup EXIT
echo "== p4-host $RID $(date -u +%FT%TZ) host=$(hostname) id=[$(id)] docker $(docker version -f '{{.Server.Version}}') build-cache-before=[$(cache)]"
docker image inspect "$PIN" > /dev/null 2>&1 || { echo "STOP the pinned base image $PIN is not present (it is never pulled by this harness)"; exit 1; }
mkdir -p "$WS/build"
printf 'FROM %s\nLABEL %s\nENV DEBIAN_FRONTEND=noninteractive\nRUN apt-get update && apt-get install -y --no-install-recommends sudo && rm -rf /var/lib/apt/lists/*\n' "$PIN" "$LBL" > "$WS/build/Dockerfile"
docker build --label "$LBL" -t "$IMG" "$WS/build" > "$WS/build/build.out" 2>&1 || { tail -20 "$WS/build/build.out"; echo "STOP image build failed"; exit 1; }
echo "image $IMG id $(docker image inspect -f '{{.Id}}' "$IMG" | cut -c1-19) from $PIN (tags $(docker image inspect -f '{{.RepoTags}} entrypoint {{.Config.Entrypoint}}' "$PIN"): an Ubuntu 24.04 userland; the entrypoint is replaced by /bin/bash)"
echo "files sent: $(cd "$WS/fix" && sha256sum -- * | awk '{printf "%s %s; ", substr($1, 1, 16), $2}')"
for n in "$@"; do
  [[ $n =~ ^[a-z0-9-]{1,32}$ ]] || { echo "STOP bad scenario name $n"; exit 2; }
  echo "== scenario $n $(date -u +%T)"
  tar -C "$WS/fix" -cf - . | docker run -i --rm --pull never --name "r10p4-$RID-$n" --label "$LBL" --network none --hostname afldb-prod --entrypoint /bin/bash "$IMG" \
    -c 'mkdir -m 700 /root/p4 && tar -C /root/p4 -xf - && chown -R root:root /root/p4 && exec /bin/bash /root/p4/p4-scen.sh "$0"' "$n" 2>&1
  echo "== scenario $n exit $? containers-left=$(docker ps -aq --filter "label=$LBL" | wc -l)"
done
