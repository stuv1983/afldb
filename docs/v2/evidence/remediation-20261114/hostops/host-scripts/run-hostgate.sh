#!/usr/bin/env bash
# hostops ISSUE-351: smoke the READ-ONLY host-gate / status-less commands against real systemd on this DEV-class host (plan review H-3:
# --root under $W and --no-live on every invocation; host-gate itself only runs systemctl show/is-active/list-timers, pgrep -x and
# reads two world-readable paths; it never runs apt, needrestart or unattended-upgrade). The facts it prints are THIS host's, not
# production's. Rollback mode must not refuse on state; strict must refuse here (no needrestart hold on this host).
W=/mnt/ssd/afldb-rem-hostops-20261114
export PATH="$HOME/.nvm/versions/node/v22.23.2/bin:$PATH"
R="$W/rehearsal/relroot"; mkdir -p "$R"
cd "$W/cand"
for args in "--mode promote" "--mode rollback" "--mode promote --strict" "--mode promote --window-min 1"; do
  echo "=== host-gate $args"
  node deploy/release.mjs host-gate $args --root "$R" --no-live; echo "exit $?"
done
echo "=== unit state read-only (DEV afldb unit is only SHOWN, never touched)"
systemctl show afldb.service -p MainPID -p ActiveEnterTimestamp -p NRestarts -p InvocationID 2>&1 | sed 's/InvocationID=.\{8\}.*/InvocationID=<elided>/'
