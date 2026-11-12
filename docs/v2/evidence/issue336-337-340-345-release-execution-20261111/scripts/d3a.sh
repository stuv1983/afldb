( set -euo pipefail; cd "$CHK"
  NEW_ID=$(cat "$NEWFILE"); [[ $NEW_ID =~ ^c1c4b22ee150-[A-Za-z0-9_-]+$ ]]
  bash "$PKGG/state-probe.sh" "$OLD_ID" "$NEW_ID" --expect OLD_SERVING
  "$N" deploy/release.mjs promote "$NEW_ID"          # previous becomes OLD_ID; the running service is unchanged until it restarts
  bash "$PKGG/state-probe.sh" "$OLD_ID" "$NEW_ID" --expect NEW_SELECTED_OLD_RUNNING
  [ "$(readlink "$ROOT/previous")" = "releases/$OLD_ID" ]
  echo "D3a PASS"
)
echo "D3a exit=$? at $(date -u +%FT%TZ)"
