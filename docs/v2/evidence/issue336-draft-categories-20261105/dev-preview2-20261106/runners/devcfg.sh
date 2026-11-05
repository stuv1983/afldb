#!/usr/bin/env bash
# READ-ONLY inspection of DEV for the ISSUE-336 deployment recommendation. Prints variable NAMES only, plus the values of a
# whitelist of non-secret operational flags. Changes nothing.
set -u -o pipefail
D=$HOME/projects/afldb
strip() { sed 's/\x1b\[[0-9;]*m//g' | grep -viE 'postgres(ql)?://|password=|secret=|token='; }
echo "== now $(date -u +%FT%TZ) host $(hostname)"
echo "== checkout: head=$(git -C "$D" rev-parse HEAD) branch=$(git -C "$D" branch --show-current) upstream=$(git -C "$D" rev-parse --abbrev-ref '@{u}' 2>/dev/null) origin/main(last fetched)=$(git -C "$D" rev-parse origin/main)"
echo "== untracked/modified (porcelain v1):"; git -C "$D" status --porcelain=v1 --untracked-files=normal
echo "== .env variable names (values withheld):"
grep -oE '^[A-Za-z_][A-Za-z0-9_]*=' "$D/.env" | tr -d = | sort | tr '\n' ' '; echo
echo "== whitelisted non-secret flag values:"
for k in AFLDB_AFL_API_BROWNLOW_ENABLED AFLDB_BETA_GATE AFLDB_WORKERS AFLDB_POOL_MAX AFLDB_TRACE_REQUESTS NODE_ENV PORT HOSTNAME AFLDB_SITE_URL AFLDB_AFL_API_CFS_BASE_URL AFLDB_RUNTIME_ENV AFLDB_ENVIRONMENT AFLDB_SKIP_DOTENV AFLDB_PYTHON AFLDB_NODE; do
  v=$(grep -E "^$k=" "$D/.env" | tail -1 | cut -d= -f2- | tr -d '"'"'"); [ -n "$(grep -E "^$k=" "$D/.env")" ] && echo "$k=$v" || echo "$k <absent>"
done
echo "== installed units vs repository copies at HEAD (diff of non-comment lines)"
for u in afldb.service afldb-settle-afl-api.service afldb-settle-afl-api.timer afldb-settle-afl-api-brownlow.service afldb-settle-afl-api-brownlow.timer afldb-settle-afltables.service afldb-settle-afltables.timer afldb-email-intake.service afldb-email-intake.timer; do
  f=$(systemctl show -p FragmentPath --value "$u" 2>/dev/null); dr=$(systemctl show -p DropInPaths --value "$u" 2>/dev/null)
  st=$(systemctl is-active "$u" 2>/dev/null); en=$(systemctl is-enabled "$u" 2>/dev/null)
  echo "-- $u fragment=${f:-<none>} active=$st enabled=$en dropins=${dr:-<none>}"
  if [ -n "$f" ] && [ -f "$f" ] && [ -f "$D/deploy/$u" ]; then
    diff <(grep -vE '^\s*#|^\s*$' "$f") <(grep -vE '^\s*#|^\s*$' "$D/deploy/$u") >/dev/null && echo "   matches deploy/$u at DEV HEAD" || { echo "   DIFFERS from deploy/$u at DEV HEAD:"; diff <(grep -vE '^\s*#|^\s*$' "$f") <(grep -vE '^\s*#|^\s*$' "$D/deploy/$u") | strip | head -20; }
  fi
done
for d in /etc/systemd/system/afldb.service.d; do [ -d "$d" ] && { echo "-- $d:"; ls -l "$d"; for x in "$d"/*; do echo "   [$x]"; grep -vE '^\s*#|^\s*$' "$x" | strip; done; }; done
echo "== timers"
systemctl list-timers --all --no-pager | grep -E 'afldb|NEXT' | sed -E 's/ +/ /g'
for s in afldb-settle-afl-api afldb-settle-afl-api-brownlow; do
  echo "== $s.service: $(systemctl show "$s.service" -p ActiveState -p Result -p ExecMainStatus -p ExecMainExitTimestamp --no-pager | tr '\n' ' ')"
  echo "   last journal lines:"; journalctl -u "$s.service" -n 25 --no-pager -o short-iso 2>&1 | strip | sed 's/^/   /'
done
echo "== nightly settle outcomes, last 14 days (markers only)"
journalctl -u afldb-settle-afl-api.service --since -14d --no-pager -o short-iso 2>&1 | grep -E 'AFLDB_SETTLE_(SUCCESS|FAILURE)|nothing to settle|REFUSED|Refusing|in-season settle — season' | strip | tail -30
echo "== brownlow outcomes, last 2 days (distinct messages)"
journalctl -u afldb-settle-afl-api-brownlow.service --since -2d --no-pager -o cat 2>&1 | strip | sort | uniq -c | sort -rn | head -15
echo "== afl_api snapshot dirs (counts, newest)"
for x in "$D"/data/sources/afl_api/*/; do echo "   $x $(ls "$x" 2>/dev/null | wc -l) newest=$(ls -t "$x" 2>/dev/null | head -1)"; done
echo DEVCFG-DONE
