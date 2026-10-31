{
NEW_ID=${1:?release id}
N=/home/arm/.nvm/versions/node/v22.23.2/bin/node
cd /home/arm/projects/afldb || exit 1
echo "host $(hostname) user $(id -un) at $(date -u +%FT%TZ) checkout HEAD $(git rev-parse HEAD) porcelain $(git status --porcelain | wc -l)"
systemctl show afldb -p MainPID -p Result -p NRestarts -p WorkingDirectory -p ActiveState -p ActiveEnterTimestamp | sed 's/^/  /'
echo "  cwd $(readlink /proc/$(systemctl show afldb -p MainPID --value)/cwd)"
echo "=== status --expect $NEW_ID"
"$N" deploy/release.mjs status --expect "$NEW_ID" 2>&1 | sed 's/^/  /'; echo "status exit ${PIPESTATUS[0]}"
echo "=== post-install check (maintained, deploy/post-install-check.sh)"
bash deploy/post-install-check.sh "$NEW_ID"; echo "post-install exit $?"
echo "=== release.json"
cat "/home/arm/afldb-releases/releases/$NEW_ID/release.json" 2>/dev/null | head -40
echo "=== events.log tail"; tail -n 6 /home/arm/afldb-releases/events.log
ls -l /home/arm/afldb-releases | sed 's/^/  /'
}
