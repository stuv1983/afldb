#!/usr/bin/env bash
# caddy357 cleanup + proof. SCOPE-TAG: caddy357-afldb-rem2-20261114
source /mnt/ssd/afldb-rem2-caddy357-20261114/env.sh
cd "$W"
bash serve.sh stop 2>&1 | tail -1
bash in/caddyapp.sh stop 2>&1 | tail -2
IR stop 2>&1 | strip | tail -3
sleep 2
{
echo "== listeners on my ports (none expected)"
ss -ltnH | awk '{print $4}' | grep -E ':(55653|55663|55673)$' || echo none
echo "== processes whose command line mentions my workspace (none expected)"
pgrep -u arm -af "$W" | grep -v 'pgrep' || echo none
echo "== ss -ltnp AFTER"
ss -ltnp 2>/dev/null | sed 's/users:/ users:/'
echo "== du -sh workspace"; du -sh "$W" 2>/dev/null
} | tee "$EV/cleanup-proof.txt"
