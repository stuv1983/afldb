#!/bin/bash
# scope ops: read-only probe #4: syslog/journal retention CONFIG and file metadata (no content), SMTP key NAMES in .env.
set -u
echo "== .env key names matching SMTP/MAIL (names only)"
grep -oE '^[A-Za-z_][A-Za-z0-9_]*=' /home/arm/projects/afldb/.env | tr -d '=' | grep -iE 'SMTP|MAIL' | sort
echo "== /etc/rsyslog.d/50-default.conf (non-comment)"
grep -v -E '^\s*(#|$)' /etc/rsyslog.d/50-default.conf
echo "== /etc/logrotate.d/rsyslog"
cat /etc/logrotate.d/rsyslog
echo "== /etc/logrotate.d/postgresql-common"
cat /etc/logrotate.d/postgresql-common
echo "== syslog file metadata (no content)"
stat -c '%n|%U:%G|%a|%s bytes|%y' /var/log/syslog /var/log/syslog.1 /var/log/auth.log 2>&1
ls /var/log/syslog* 2>&1 | wc -l
echo "== journal directory metadata (persistent storage present?)"
ls -ld /var/log/journal /var/log/journal/* 2>&1
echo "== journald effective limits are defaults unless set above (no drop-ins found by probe #1)"
echo "== loginctl linger for arm (user timers need it for a pull-side or arm-side unit)"
loginctl show-user arm -p Linger 2>&1
