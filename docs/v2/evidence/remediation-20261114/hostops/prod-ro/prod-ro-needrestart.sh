#!/bin/bash
# ISSUE-351 read-only: which restart mode would needrestart use from the apt hook, and which services restarted at the
# 2026-11-14 06:35 unattended upgrade. Reads /usr/sbin/needrestart (world-readable Perl), /etc, systemctl show. No sudo,
# does not run needrestart.
set -u
echo "=== needrestart restart-mode resolution (/usr/sbin/needrestart 258-282)"
sed -n '258,282p' /usr/sbin/needrestart
echo "=== needrestart.conf comments on restart mode"
sed -n '1,57p' /etc/needrestart/needrestart.conf | grep -v '^\s*$' | grep -n -i -E 'restart mode|ATTENTION|UBUNTU|nrconf\{restart\}'
echo "=== running services and ActiveEnterTimestamp"
for u in $(systemctl list-units --type=service --state=running --no-legend --plain | awk '{print $1}'); do
  echo "$u | $(systemctl show "$u" -p ActiveEnterTimestamp --value)"
done
echo "=== apt unit files"
systemctl list-unit-files --no-pager 2>/dev/null | grep -i -E 'needrestart|unattended|apt-daily'
echo END
