#!/bin/bash
# Remediation run 2, scope ops: READ-ONLY production probe #2 (AGENT-PROTOCOL section 6; no sudo, no state change).
# Facts the procedures (season opening, reboot, backups/off-host, pull check) depend on. Config and metadata only:
# .env KEY NAMES (never values), file metadata, world-readable /etc config, package lists, aggregates (du of a directory).
# No log content, no journal, no database connection.
set -u
sec() { printf '\n=== %s ===\n' "$1"; }
sec "identity"; hostname; id -un; date -Is; uname -r; uptime -s
sec "serving checkout: HEAD and tracked-file state (no diff content)"
git -C /home/arm/projects/afldb rev-parse HEAD 2>&1
git -C /home/arm/projects/afldb status --porcelain 2>&1 | wc -l
ls -l /home/arm/projects/afldb/tools/maintenance/ 2>&1 | awk '{print $1,$3,$5,$6,$7,$8,$9}' | head -30
ls -l /home/arm/projects/afldb/deploy/ 2>&1 | awk '{print $1,$5,$9}' | grep -E 'afldb-backup|settle-failure|release.mjs|host-policy' || echo "(no backup/notifier/host-policy files in the serving checkout)"
sec "node on PATH and the unit's pinned node"
command -v node; node -v 2>&1
systemctl show afldb.service -p ExecStart --no-pager 2>&1 | cut -c1-260
sec ".env: KEY NAMES ONLY (values are never read into this output)"
ls -l /home/arm/projects/afldb/.env 2>&1 | awk '{print $1,$3,$4,$5}'
grep -oE '^[A-Za-z_][A-Za-z0-9_]*=' /home/arm/projects/afldb/.env 2>/dev/null | tr -d '=' | sort | grep -E 'DATABASE_URL|^AFLDB_(BETA_EPOCH|ENV|INDEXING|OFFHOST|BACKUP)|PG' | sed 's/^/  /'
sec "backup directories: metadata and aggregate size"
ls -ld /home/arm/backups /home/arm/backups/afldb /home/arm/backups/afldb-scheduled 2>&1
du -sh /home/arm/backups/afldb 2>&1
ls /home/arm/backups/afldb 2>/dev/null | wc -l
df -h /home/arm | tail -1
sec "ssh: server config (non-comment) and arm authorized_keys metadata (count only)"
grep -hv -E '^\s*(#|$)' /etc/ssh/sshd_config /etc/ssh/sshd_config.d/*.conf 2>&1 | head -30
ls -l /home/arm/.ssh/ 2>&1 | awk '{print $1,$3,$5,$9}'
grep -c -v -E '^\s*(#|$)' /home/arm/.ssh/authorized_keys 2>&1
echo "forced-command or restrict options already present on any key (option names only):"
grep -v -E '^\s*(#|$)' /home/arm/.ssh/authorized_keys 2>/dev/null | grep -oE '^(command|restrict|no-[a-z-]+|from)=?' | sort | uniq -c
sec "pending reboot: kernels, reboot-required packages, GRUB defaults (world-readable)"
cat /var/run/reboot-required.pkgs 2>&1 | head -20
dpkg -l 'linux-image-[0-9]*' 2>/dev/null | awk 'NR>5{print $1,$2,$3}'
ls -l /boot 2>&1 | awk '{print $1,$5,$9}' | grep -E 'vmlinuz|initrd' | head -20
grep -hv -E '^\s*(#|$)' /etc/default/grub /etc/default/grub.d/*.cfg 2>&1 | head -30
ls -l /boot/grub/grub.cfg 2>&1
cat /proc/cmdline | sed -E 's/(root=UUID=)[^ ]+/\1<uuid>/'
sec "console access evidence on the host (not the cloud console): serial getty and droplet-agent state"
systemctl is-active serial-getty@ttyS0.service getty@tty1.service droplet-agent.service do-agent.service 2>&1
sec "services restarted by a libc upgrade (config only): needrestart hold files already installed?"
ls -l /etc/needrestart/conf.d/ /etc/apt/apt.conf.d/52-afldb-unattended 2>&1
sec "sudo group membership is a fact of /etc/group (no sudo is run)"
getent group sudo
sec "systemd: failed units, timers"
systemctl --failed --no-pager --no-legend 2>&1
systemctl list-timers --all --no-pager 2>&1 | grep -E 'NEXT|afldb|apt|logrotate|dpkg|e2scrub' | cut -c1-200
sec "the 2027 season facts the opening procedure rests on are in the rollover evidence (not re-read here: no database access in this probe)"
sec "end"; date -Is
