{
N=/home/arm/.nvm/versions/node/v22.23.2/bin/node
cd /home/arm/projects/afldb || exit 1
echo "promote at $(date -u +%FT%TZ)"
"$N" deploy/release.mjs promote ad245d602f6f-m0M8pf121326vNSo2B759 2>&1; echo "promote exit $?"
ls -l /home/arm/afldb-releases | sed 's/^/  /'
systemctl show afldb -p ActiveEnterTimestamp -p MainPID | sed 's/^/  /'
}
