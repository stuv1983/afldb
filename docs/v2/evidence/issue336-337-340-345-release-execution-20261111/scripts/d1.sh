( set -euo pipefail; [[ $PKG =~ ^[0-9a-f]{40}$ ]]; cd "$CHK"
  [ "$(git rev-parse HEAD)" = "$PROD_HEAD" ]
  git fetch origin
  [ "$(git rev-parse refs/remotes/origin/main)" = "$PKG" ]
  git cat-file -e "$R^{commit}"
  git show "$PKG:$PKGD/static-delta-check.sh" | bash -s -- "$PKG"             # enforced on production
  git merge --ff-only "$R"
  [ "$(git rev-parse HEAD)" = "$H" ]; [ -z "$(git status --porcelain)" ]
  "$N" deploy/release.mjs status                                              # still STATUS PASS
  bash "$PKGG/state-probe.sh" "$OLD_ID" - --expect OLD_SERVING
  echo "D1 PASS"
)
echo "D1 exit=$? HEAD=$(git -C "$CHK" rev-parse HEAD) at $(date -u +%FT%TZ)"
