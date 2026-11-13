
echo "=== apt list --upgradable (reads the local cache only)"
apt list --upgradable 2>/dev/null | head -40
echo "=== held packages"; apt-mark showhold 2>&1
echo "=== postgresql packages installed"; dpkg -l 'postgresql*' 2>/dev/null | awk '/^ii/{print $2,$3}'
echo "=== caddy package"; dpkg -l caddy 2>/dev/null | awk '/^ii/{print $2,$3}'
echo "=== policy-rc.d"; ls -la /usr/sbin/policy-rc.d 2>&1
echo "=== systemctl show timestamps utc format"; systemctl show apt-daily-upgrade.timer --timestamp=utc -p NextElapseUSecRealtime -p LastTriggerUSec 2>&1
systemctl show afldb --timestamp=utc -p ActiveEnterTimestamp -p InvocationID -p NRestarts 2>&1
echo "=== apt history entry format (local tz) tz:"; date +%Z; cat /etc/timezone 2>&1
echo END