:
{
# Read-only: does the serving process expose the two signing keys (presence only, values never printed), and is the token helper in the
# serving release identical to the one in the ops checkout? No environment dump.
set -u
MP=$(systemctl show -p MainPID --value afldb.service)
echo "mainpid=$MP"
CH=$(ps -o pid= --ppid "$MP" | head -1 | tr -d ' ')
echo "first worker pid=$CH"
for p in "$MP" "$CH"; do
  for k in AFLDB_SESSION_SECRET AFLDB_BETA_EPOCH AFLDB_BETA_GATE; do
    if tr '\0' '\n' < /proc/$p/environ 2>/dev/null | grep -q "^$k="; then echo "pid $p $k=present"; else echo "pid $p $k=absent"; fi
  done
  tr '\0' '\n' < /proc/$p/environ 2>/dev/null | sed -n 's/^\(AFLDB_BETA_EPOCH\|AFLDB_BETA_GATE\)=/\1 value: /p'
done
R=/home/arm/afldb-releases/current
ls -d $R/src 2>&1 | head -1
sha256sum $R/src/lib/auth/tokens.ts /home/arm/ops/issue333-o2-50ed6e4f/cand/src/lib/auth/tokens.ts 2>&1
ls /home/arm/ops/issue333-o2-50ed6e4f/cand/node_modules/.bin/tsx
grep -c "" /dev/null
}
