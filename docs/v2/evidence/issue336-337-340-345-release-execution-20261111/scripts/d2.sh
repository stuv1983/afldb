( set -euo pipefail; [[ $R =~ ^[0-9a-f]{40}$ ]]; cd "$CHK"
  [ ! -e "$NEWFILE" ]
  [ "$(git rev-parse HEAD)" = "$H" ]; [ -z "$(git status --porcelain)" ]
  bash "$PKGG/state-probe.sh" "$OLD_ID" - --expect OLD_SERVING
  "$N" deploy/release.mjs build --checkout "$CHK" --revision "$R" \
    --afldb-env production --typecheck off-host --smoke-paths /players,/clubs,/seasons,/draft \
    --typecheck-evidence "next typegen && tsc --noEmit exit 0 on Linux (streamanator, node v22.23.2) for a verified shallow clone of c1c4b22ee150; 2026-11-09; docs/v2/issue336-337-340-345-release-approval-r2-2026-11-09.md section 3" \
    2>&1 | tee "/home/arm/i336-rel-d2-build-$(date -u +%Y%m%dT%H%M%SZ).log"
  LOG=$(ls -t /home/arm/i336-rel-d2-build-*.log | head -n 1)
  NEW_ID=$(sed -n 's/^release: RELEASE READY \([^ ]*\) .*$/\1/p' "$LOG" | tail -n 1)
  [[ $NEW_ID =~ ^c1c4b22ee150-[A-Za-z0-9_-]+$ ]]
  "$N" deploy/release.mjs verify "$NEW_ID"
  [ "$(readlink "$ROOT/current")"  = "releases/$OLD_ID" ]                     # a build never moves a link
  [ "$(readlink "$ROOT/previous")" = "releases/$OLD_PREV" ]
  bash "$PKGG/state-probe.sh" "$OLD_ID" "$NEW_ID" --expect OLD_SERVING
  echo "$NEW_ID" > "$NEWFILE"; echo "D2 PASS NEW_ID=$NEW_ID"
)
echo "D2 exit=$? at $(date -u +%FT%TZ)"
