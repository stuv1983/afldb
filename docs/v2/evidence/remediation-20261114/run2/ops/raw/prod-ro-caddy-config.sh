#!/bin/bash
# scope ops: read-only. The installed Caddyfile is world-readable configuration (root 0644); caddy.service unit text is `systemctl cat`.
# No log file is opened.
set -u
cat /etc/caddy/Caddyfile
echo "---SHA"
sha256sum /etc/caddy/Caddyfile
/usr/bin/caddy version 2>&1 | head -1
echo "---UNIT"
systemctl cat caddy.service --no-pager 2>&1 | grep -E '^(#|\[|User|Group|ExecReload|ExecStart|LogsDirectory|ReadWritePaths|ProtectSystem|AmbientCapabilities|Restart)' | grep -v '^#'
ls -l /etc/systemd/system/caddy.service.d 2>&1
