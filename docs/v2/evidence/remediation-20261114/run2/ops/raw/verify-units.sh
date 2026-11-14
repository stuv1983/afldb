#!/bin/bash
# scope ops: systemd-analyze verify (user-level, read-only; copies under the workspace, nothing installed) for the new units.
set -u
W=/mnt/ssd/afldb-rem2-ops-20261114
U=$W/out/units
rm -rf "$U"; mkdir -p "$U/afldb-settle-failure@.service.d" "$U/ctl"
C=$W/cand/deploy
cp "$C/afldb-settle-failure@.service" "$C/afldb-settle-failure-transport@.service" "$U/"
cp "$C/afldb-settle-failure@.service.d/transport.conf.example" "$U/afldb-settle-failure@.service.d/transport.conf"
systemd-analyze --version | head -1
echo "== transport template (as written) =="
systemd-analyze verify --man=no "$U/afldb-settle-failure-transport@.service"; echo "rc=$?"
echo "== notifier template + OnSuccess drop-in =="
systemd-analyze verify --man=no "$U/afldb-settle-failure@.service"; echo "rc=$?"
echo "== instance (symlink named as systemd names it) =="
ln -s "$U/afldb-settle-failure-transport@.service" "$U/afldb-settle-failure-transport@afldb-settle-afl-api.service.service"
systemd-analyze verify --man=no "$U/afldb-settle-failure-transport@afldb-settle-afl-api.service.service"; echo "rc=$?"
echo "== negative control: misspelled key must warn =="
sed 's/^RestrictAddressFamilies=/RestrictAddressFamilie=/' "$C/afldb-settle-failure-transport@.service" > "$U/ctl/afldb-settle-failure-transport@.service"
systemd-analyze verify --man=no "$U/ctl/afldb-settle-failure-transport@.service"; echo "rc=$?"
echo "== effective properties of the instance: what the sandbox resolves to (cat-config is read-only) =="
grep -E '^(RestrictAddressFamilies|ProtectHome|BindReadOnlyPaths|ReadOnlyPaths|PrivateNetwork)=' "$U/afldb-settle-failure-transport@.service"
