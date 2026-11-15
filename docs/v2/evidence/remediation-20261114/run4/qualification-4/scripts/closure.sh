#!/usr/bin/env bash
# remediation run 4, scope `qual`, P0/P1: diff lists and the mechanical rebuild-reachability closure at Q'' (read-only; writes only $E).
#   bash $W/in/closure.sh
set -u -o pipefail
. "$(dirname "$0")/common.sh"
cd "$CAND" || exit 1
echo "HEAD=$(git rev-parse HEAD) want=$QPP porcelain=$(pc)"
[ "$(git rev-parse HEAD)" = "$QPP" ] || { echo "HEAD MISMATCH"; exit 1; }
C=$E/closure; mkdir -p "$C"
for base in 692b1902 6d5388ea 7cfbe186; do
  git diff --name-only "$base" "$QPP" > "$C/diff-$base-Qpp.txt"
  echo "git diff --name-only $base $QPP: $(wc -l < "$C/diff-$base-Qpp.txt") files"
done
echo "== TypeScript stage entries (tools/db/rebuild-test.ts ordinaryTsxArgv + the two npm scripts + the driver and harness) =="
node "$IN/closure.mjs" "$C/rebuild" "$C/diff-6d5388ea-Qpp.txt" \
  tools/db/rebuild-test.ts tools/db/migrate.ts tools/db/privileges.ts \
  tools/migration/rebuild_afl_api_adjudications.ts tools/records/import-first-kick-goal.ts tools/v2/isolated-pg.ts
echo "== Python/SQL/data stage paths and path prefixes (RUN-PLAN-4 section 3) intersected with git diff --name-only 6d5388ea $QPP =="
grep -E '\.(py|sql)$|^data/|^legacy/|^packages/|^tools/(migration|rebuild|records|db)/|^src/db/migrations/' "$C/diff-6d5388ea-Qpp.txt" | tee "$C/prefix-intersection.txt"
echo "prefix hits: $(wc -l < "$C/prefix-intersection.txt")"
echo "== diff list outside docs/v2/evidence, issues, tracking files (every code/test/doc path since 6d5388ea) =="
grep -v -E '^(docs/v2/evidence/|issues/|issues\.md$|IssuesIndex\.md$|blockers\.md$|CHANGELOG\.md$)' "$C/diff-6d5388ea-Qpp.txt" | tee "$C/diff-6d5388ea-Qpp-nonrecord.txt" | wc -l
echo "== AFLW %27 metadata route closure (page/layout files of src/app/aflw, root layout, middleware, next.config) =="
find src/app/aflw -type f \( -name 'page.tsx' -o -name 'layout.tsx' -o -name 'route.ts' \) | sort > "$C/aflw-entries.txt"
ls src/app/layout.tsx src/middleware.ts next.config.ts 2>/dev/null >> "$C/aflw-entries.txt"
sort -u -o "$C/aflw-entries.txt" "$C/aflw-entries.txt"
wc -l < "$C/aflw-entries.txt"
mapfile -t AE < "$C/aflw-entries.txt"
node "$IN/closure.mjs" "$C/aflw" "$C/diff-692b1902-Qpp.txt" "${AE[@]}"
echo "porcelain=$(pc)"
rm -rf "$CAND/closure-out-unused"
echo "porcelain-after=$(pc)"
