#!/usr/bin/env bash
# hostops ISSUE-352 / ISSUE-351 unit rehearsal (plan review H-4): systemd-analyze verify and calendar evaluation ONLY.
# No systemctl enable/start/daemon-reload, nothing under ~/.config/systemd or /etc, no linger. Files are copies under $W.
# Usage: W=/mnt/ssd/afldb-rem-hostops-20261114 bash verify-units.sh
set -u
: "${W:?}"
U="$W/rehearsal/units"; rm -rf "$U"; mkdir -p "$U"
for f in afldb-backup.service afldb-backup.timer afldb-backup-verify.service afldb-backup-verify.timer afldb-backup-failed.service; do
  cp "$W/cand/deploy/$f" "$U/$f"
done
echo "== systemd-analyze verify (files under $U; verify reads them, registers nothing)"
for f in afldb-backup.service afldb-backup-verify.service afldb-backup-failed.service afldb-backup.timer afldb-backup-verify.timer; do
  out=$(systemd-analyze verify "$U/$f" 2>&1); rc=$?
  echo "-- $f rc=$rc"; printf '%s\n' "$out" | grep -v -E "^$" | head -12
done
echo "== calendars"
systemd-analyze calendar '*-*-* 02:20' --iterations=3 2>&1 | grep -E "Original|Next elapse|Normalized" | head -6
systemd-analyze calendar 'Wed *-*-* 03:30' --iterations=3 2>&1 | grep -E "Original|Next elapse|Normalized" | head -6
echo "== shell syntax"
for s in tools/maintenance/scheduled-backup.sh tools/maintenance/offhost-pull.sh deploy/afldb-settle-afl-api.sh; do bash -n "$W/cand/$s" && echo "bash -n ok $s"; done
sh -n "$W/cand/deploy/afldb-settle-afl-api.sh" && echo "sh -n ok deploy/afldb-settle-afl-api.sh"
command -v shellcheck > /dev/null && shellcheck -S warning "$W/cand/tools/maintenance/scheduled-backup.sh" "$W/cand/tools/maintenance/offhost-pull.sh" | head -30 || echo "shellcheck: not installed"
echo "== DEV user manager untouched: no files created under ~/.config/systemd by this script"
ls -la --time-style=long-iso "$HOME/.config/systemd/user" 2>&1 | head -5
