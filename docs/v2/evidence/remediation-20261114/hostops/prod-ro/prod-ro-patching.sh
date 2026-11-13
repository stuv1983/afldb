#!/bin/bash
# ISSUE-351 read-only production patching-control probe (remediation 2026-11-14, hostops).
# Run as arm via `ssh afldb 'bash -s' < prod-ro-patching.sh`. No sudo, no state change: systemctl show/cat/list-timers,
# world-readable /etc and /var files, dpkg -l, apt-config dump (reads config only). Never runs needrestart or apt.
set -u
sec() { printf '\n=== %s ===\n' "$1"; }
sec "identity"; hostname; id -un; date -Is; uname -r; uptime -s
sec "unattended-upgrades package + services"
dpkg -l unattended-upgrades needrestart apt 2>/dev/null | awk 'NR>5{print $1,$2,$3}'
systemctl is-enabled unattended-upgrades.service apt-daily.timer apt-daily-upgrade.timer 2>&1
systemctl is-active unattended-upgrades.service apt-daily.service apt-daily-upgrade.service 2>&1
sec "timers (apt + afldb)"
systemctl list-timers --all --no-pager 2>&1 | grep -E 'NEXT|apt|afldb|dpkg|needrestart|unattended' || true
sec "systemctl cat apt-daily-upgrade.timer (and drop-ins)"
systemctl cat apt-daily-upgrade.timer --no-pager 2>&1
systemctl show apt-daily-upgrade.timer -p NextElapseUSecRealtime -p LastTriggerUSec -p RandomizedDelayUSec -p OnCalendar 2>&1
sec "/etc/apt/apt.conf.d listing"
ls -la /etc/apt/apt.conf.d/ 2>&1
sec "20auto-upgrades"
cat /etc/apt/apt.conf.d/20auto-upgrades 2>&1
sec "50unattended-upgrades (non-comment lines)"
grep -v -E '^\s*(//|$)' /etc/apt/apt.conf.d/50unattended-upgrades 2>&1
sec "other apt.conf.d files mentioning Unattended/Periodic/needrestart"
grep -l -i -E 'Unattended|Periodic|needrestart' /etc/apt/apt.conf.d/* 2>/dev/null
sec "apt-config effective (Unattended-Upgrade, Periodic)"
apt-config dump 2>/dev/null | grep -E '^(Unattended-Upgrade|APT::Periodic)' 
sec "needrestart.conf (non-comment)"
grep -v -E '^\s*(#|$)' /etc/needrestart/needrestart.conf 2>&1
sec "needrestart conf.d"
ls -la /etc/needrestart/conf.d/ 2>&1
for f in /etc/needrestart/conf.d/*; do [ -f "$f" ] && { echo "--- $f"; grep -v -E '^\s*(#|$)' "$f"; }; done
sec "needrestart dpkg hook + apt hook"
ls -la /etc/needrestart/ /usr/lib/needrestart/ 2>&1 | head -40
grep -l needrestart /etc/apt/apt.conf.d/* /etc/dpkg/dpkg.cfg.d/* 2>/dev/null
cat /etc/apt/apt.conf.d/99needrestart 2>/dev/null
sec "reboot-required"
ls -la /var/run/reboot-required* 2>&1; cat /var/run/reboot-required.pkgs 2>&1 | head -20
sec "afldb + postgres unit state"
for u in afldb.service postgresql.service postgresql@16-main.service; do
  echo "--- $u"
  systemctl show "$u" -p Id -p ActiveState -p SubState -p MainPID -p InvocationID -p NRestarts -p ActiveEnterTimestamp -p Restart -p Requires -p RequiredBy -p BindsTo -p PartOf -p After 2>&1
done
sec "needrestart restart/ignore evaluation inputs: services listing config only"
grep -n -E 'override_rc|restart|\$nrconf' /etc/needrestart/needrestart.conf 2>&1 | grep -v '^\s*[0-9]*:\s*#' | head -20
sec "apt history tail (readable?)"
ls -la /var/log/apt/ 2>&1
grep -E '^(Start-Date|Commandline|Requested-By|Upgrade|End-Date)' /var/log/apt/history.log 2>&1 | tail -40
sec "unattended-upgrades log readable?"
ls -la /var/log/unattended-upgrades/ 2>&1
sec "apt periodic stamps"
ls -la --time-style=full-iso /var/lib/apt/periodic/ 2>&1
sec "dpkg needrestart-related: kernel/microcode/services"
dpkg -l 'linux-image-*' 2>/dev/null | awk '/^ii/{print $2,$3}'
echo END
