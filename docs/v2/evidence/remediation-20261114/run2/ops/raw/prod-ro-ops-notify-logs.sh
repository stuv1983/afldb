#!/bin/bash
# Remediation run 2, scope ops: READ-ONLY production probe (AGENT-PROTOCOL section 6; no sudo, no state change).
# (A-07) how could a failure signal leave the host today: local MTA/sendmail/mail spool, monitoring agents, journal forwarding.
# (ISSUE-362 O-1) metadata and configuration of access-log files and rotation. NEVER reads a log's content:
#   only `stat`/`ls -l` of paths (owner, mode, size, mtime), world-readable /etc config files, `systemctl show/list-units`.
# Run as arm via: Get-Content this | ssh afldb 'bash -s'
set -u
sec() { printf '\n=== %s ===\n' "$1"; }
sec "identity"; hostname; id; date -Is; uname -r
sec "mail transport: binaries on PATH and well-known paths"
for c in sendmail mail mailx mutt msmtp ssmtp exim4 postfix opensmtpd s-nail curl wget logger; do
  printf '%-10s ' "$c"; command -v "$c" || echo "(absent)"
done
ls -l /usr/sbin/sendmail /usr/lib/sendmail /etc/alternatives/mta 2>&1
sec "dpkg: mail / MTA / monitoring packages"
dpkg -l 2>/dev/null | awk 'NR>5{print $1,$2,$3}' | grep -iE 'postfix|exim|msmtp|ssmtp|opensmtpd|nullmailer|esmtp|bsd-mailx|mailutils|s-nail|do-agent|droplet-agent|datadog|netdata|prometheus|node-exporter|telegraf|zabbix|nagios|monit|collectd|newrelic|grafana|filebeat|fluent|vector|rsyslog|syslog-ng|logwatch|fail2ban|cron-apt|apticron|unattended|needrestart' || echo "(none matched)"
sec "mail-related and monitoring services: units (installed and active)"
systemctl list-unit-files --no-pager --no-legend 2>/dev/null | grep -iE 'postfix|exim|msmtp|ssmtp|smtp|sendmail|opensmtpd|nullmailer|do-agent|droplet-agent|datadog|netdata|prometheus|exporter|telegraf|zabbix|nagios|monit|collectd|newrelic|grafana|filebeat|fluent|vector|rsyslog|syslog-ng|logwatch|fail2ban|apticron|healthcheck|uptime' || echo "(none matched)"
systemctl list-units --type=service --state=running --no-pager --no-legend 2>/dev/null | awk '{print $1}'
sec "mail spool and aliases (metadata)"
ls -ld /var/mail /var/spool/mail /var/spool/postfix /var/spool/exim4 2>&1
ls -l /var/mail 2>&1
ls -l /etc/aliases /etc/mailname /etc/postfix/main.cf /etc/exim4/update-exim4.conf.conf /etc/msmtprc /etc/ssmtp/ssmtp.conf 2>&1
sec "/etc/aliases (world-readable config; root forwarding target)"
grep -v -E '^\s*(#|$)' /etc/aliases 2>&1
sec "cron mail behaviour (MAILTO in world-readable crontabs; no spool read)"
grep -n -E '^\s*MAILTO' /etc/crontab /etc/cron.d/* 2>/dev/null || echo "(no MAILTO set)"
crontab -l 2>&1 | head -5
sec "journald configuration (forwarding, storage, rate limit)"
for f in /etc/systemd/journald.conf /etc/systemd/journald.conf.d/*.conf /usr/lib/systemd/journald.conf.d/*.conf; do
  [ -f "$f" ] && { echo "--- $f"; grep -v -E '^\s*(#|$)' "$f"; }
done
ls -l /var/log/journal 2>&1 | head -3
sec "journal readability for arm (group membership only; no journal read)"
id -nG
getent group adm systemd-journal 2>&1
sec "rsyslog configuration (forward targets: lines with @ / @@ / omfwd)"
ls -l /etc/rsyslog.conf /etc/rsyslog.d/ 2>&1
grep -rnE '(@@?[A-Za-z0-9._-]+|omfwd|omrelp|ommail|action\()' /etc/rsyslog.conf /etc/rsyslog.d/ 2>/dev/null | grep -vE '^\S+:[0-9]+:\s*#' | head -20 || true
sec "outbound-alert helpers that exist for the app (names only)"
ls -l /usr/local/bin /usr/local/sbin 2>&1 | head -30
sec "settle units: state, OnFailure wiring (systemctl show/cat; installed state, not the repo)"
for u in afldb-settle-afl-api.service afldb-settle-afl-api-brownlow.service afldb-settle-afl-api.timer afldb-backup.timer afldb-backup-verify.timer afldb-settle-failure@afldb-settle-afl-api.service; do
  echo "--- $u"
  systemctl show "$u" -p LoadState,ActiveState,SubState,Result,ExecMainStatus,OnFailure,Persistent,NextElapseUSecRealtime,LastTriggerUSec 2>&1
done
ls -l /etc/systemd/system/afldb-settle-afl-api.service.d/ /etc/systemd/system/afldb-settle-failure@.service 2>&1
ls -ld /var/lib/afldb-settle-failure 2>&1
sec "systemd failed units (all)"
systemctl --failed --no-pager --no-legend 2>&1
sec "unit hooks that could page: OnFailure of afldb units on this host"
systemctl show afldb.service afldb-settle-afl-api.service -p Id,OnFailure,Restart,RestartUSec,NRestarts 2>&1
sec "network egress capability test: NOT performed (no connection is opened by this probe)"
echo "skipped by design"
sec "caddy: world-readable configuration, and log FILE METADATA ONLY"
ls -l /etc/caddy 2>&1
systemctl show caddy.service -p User,Group,ActiveState,MainPID,ExecStart --no-pager 2>&1 | cut -c1-300
echo "--- /etc/caddy/Caddyfile: log blocks and output lines only (config text, not log content)"
grep -nE '^\s*(log|output|format|level|roll_|redact|filter|}|[A-Za-z0-9_.*:-]+\s*\{)' /etc/caddy/Caddyfile 2>&1 | grep -iE 'log|output|roll|format|filter|redact|snippet|\(' | head -60
echo "--- log directory and file metadata (name, owner, mode, size, mtime); content is never opened"
ls -ld /var/log/caddy 2>&1
stat -c '%n|%U:%G|%a|%s bytes|%y' /var/log/caddy/* 2>&1 | head -60
sec "logrotate config for caddy (world-readable)"
ls -l /etc/logrotate.d/ 2>&1
for f in /etc/logrotate.d/caddy /etc/logrotate.d/afldb* ; do [ -f "$f" ] && { echo "--- $f"; cat "$f"; }; done
echo "--- global logrotate.conf (non-comment)"
grep -v -E '^\s*(#|$)' /etc/logrotate.conf 2>&1
echo "--- logrotate timer"
systemctl show logrotate.timer -p ActiveState,NextElapseUSecRealtime,LastTriggerUSec --no-pager 2>&1
echo "--- logrotate status file entries for caddy (name + last rotated date only)"
grep -i caddy /var/lib/logrotate/status 2>&1 | head -20
sec "other log classes that may hold tokens or query text: metadata only"
stat -c '%n|%U:%G|%a|%s bytes|%y' /var/log/nginx /var/log/apache2 /var/log/afldb* /home/arm/logs /home/arm/afldb-logs 2>&1 | head -20
ls -ld /var/log/postgresql 2>&1
ls -l /var/log/postgresql 2>&1 | head -10
echo "--- postgresql logging settings (world-readable config, not log content)"
grep -hnE '^\s*(log_statement|log_min_duration_statement|log_connections|log_line_prefix|logging_collector|log_destination|log_directory)' /etc/postgresql/16/main/postgresql.conf /etc/postgresql/16/main/conf.d/*.conf 2>&1 | head
echo "--- app logging: afldb unit output goes to the journal"
systemctl show afldb.service -p StandardOutput,StandardError,SyslogIdentifier,LogLevelMax --no-pager 2>&1
sec "disk free on log and backup volumes (aggregate)"
df -h /var/log /home/arm 2>&1
sec "end"
date -Is
