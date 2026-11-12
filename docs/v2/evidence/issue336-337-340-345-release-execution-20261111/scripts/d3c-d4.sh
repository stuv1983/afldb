echo "== D3c"
( set -euo pipefail; cd "$CHK"
  NEW_ID=$(cat "$NEWFILE"); [[ $NEW_ID =~ ^c1c4b22ee150-[A-Za-z0-9_-]+$ ]]
  bash deploy/post-install-check.sh "$NEW_ID"        # waits up to 60 s for health; prints POST-INSTALL CHECK PASS or FAIL
  bash "$PKGG/state-probe.sh" "$OLD_ID" "$NEW_ID" --expect NEW_SERVING
  journalctl -u afldb --since '10 minutes ago' --no-pager | grep -F 'serving build' | tail -n 1 | grep -q "release $NEW_ID revision c1c4b22ee150"
  [ "$(grep -c '^AFLDB_SETTLE_TRIGGER=systemd$' .env)" = 1 ]
  bash /home/arm/c5-observe-20261102-r3.sh timer "$H"   # read-only: match timer enabled+active with a future elapse, Brownlow and AFL Tables timers off, setting still true
  echo "D3c PASS"
)
echo "D3c exit=$? at $(date -u +%FT%TZ)"
echo "== D4 (amendment D4-A, owner-approved 2026-11-11)"
( set -euo pipefail; cd "$CHK"; NEW_ID=$(cat "$NEWFILE"); [[ $NEW_ID =~ ^c1c4b22ee150-[A-Za-z0-9_-]+$ ]]
  "$N" deploy/release.mjs verify "$NEW_ID"                                    # serving bytes match the manifest built from R
  bash "$PKGG/state-probe.sh" "$OLD_ID" "$NEW_ID" --expect NEW_SERVING
  S="$ROOT/releases/$NEW_ID/.next/standalone/.next/server"
  grep -rlF 'Draft categories' "$S" | grep -q .                               # ISSUE-336 category navigation: only from R on
  grep -rlF 'Intl Schol' "$S" | grep -q .                                     # D-336-1 Grid Solver option: only from R on
  for p in /draft /draft/2025 '/draft/2014?view=rookie'; do                   # D4-A: anonymous loopback = the beta-gate redirect
    out=$(curl -s -o /dev/null -w '%{http_code} %{redirect_url}' --max-time 60 "http://127.0.0.1:3100$p"); echo "GET $p -> $out"
    [[ $out == "307 https://beta.afldb.com/beta?from="* ]]
  done
  [ "$(grep -c '^AFLDB_BETA_GATE=on$' .env)" = 1 ]                            # gate kept enabled (count only)
  B=$(ls /home/arm/afldb-releases/builds 2>/dev/null | grep c1c4b22ee150 | tail -n 1)
  L=$(ls -t /home/arm/i336-rel-d2-build-*.log | head -n 1)
  grep -F "RELEASE READY $NEW_ID" "$L" >/dev/null
  grep -F '"/draft":"200"' "$L" | grep -F '(beta claim)'                       # supporting: D2 boot smoke of this NEW_ID rendered /draft 200
  echo "D4 PASS (automated part, amendment D4-A; D4-P, D4-V and D4-O follow)"
)
echo "D4 exit=$? at $(date -u +%FT%TZ)"
