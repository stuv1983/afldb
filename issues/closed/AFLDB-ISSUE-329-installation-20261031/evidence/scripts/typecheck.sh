#!/bin/bash
# Run as rehearsal. Off-host typecheck + focused deploy suites on the exact candidate merge tree.
R=/home/rehearsal/afldb-329-proof-20261030T233836Z
C=$R/candidate-6790983a
E=$R/final-proof-20261031
mkdir -p "$E"
export PATH=/opt/node-v22.21.0-linux-x64/bin:$PATH
export TMPDIR=$R/tmp
cd "$C" || exit 1
{
  echo "candidate merge 6790983ab3d3ae5292ad8a311c203e2584bd04a5 tree b1d95b24c6e53317458229e04f1b3b35b39c2ccf (git archive, no untracked files)"
  echo "host $(hostname) $(uname -sr) node $(node -v) npm $(npm -v) at $(date -u +%FT%TZ)"
  echo "package-lock.json $(sha256sum package-lock.json | cut -c1-64)"
} | tee "$E/typecheck.log"
t0=$(date +%s)
npm ci --no-audit --no-fund > "$E/npm-ci.log" 2>&1; rc=$?
echo "npm ci exit $rc in $(( $(date +%s) - t0 )) s" | tee -a "$E/typecheck.log"
[ $rc -eq 0 ] || exit 1
t0=$(date +%s)
npm run typecheck > "$E/typecheck-output.log" 2>&1; rc=$?
echo "npm run typecheck (next typegen && tsc --noEmit) exit $rc in $(( $(date +%s) - t0 )) s" | tee -a "$E/typecheck.log"
tail -5 "$E/typecheck-output.log"
t0=$(date +%s)
npx vitest run tests/deploy-release.test.ts tests/deploy-web-unit.test.ts > "$E/vitest-deploy.log" 2>&1; rc=$?
echo "vitest deploy-release + deploy-web-unit exit $rc in $(( $(date +%s) - t0 )) s" | tee -a "$E/typecheck.log"
grep -E 'Test Files|Tests ' "$E/vitest-deploy.log" | tee -a "$E/typecheck.log"
