#!/usr/bin/env bash
# hostops: (a) check-node-modules on the REAL npm ci tree (zero-false-positive proof) + negative controls on COPIES under $W/rehearsal,
# (b) typecheck under the heavy lock (queued, runs last).
W=/mnt/ssd/afldb-rem-hostops-20261114
export PATH="$HOME/.nvm/versions/node/v22.23.2/bin:$PATH"
cd "$W/cand"
{
  echo "== check-node-modules on the real npm ci tree (HEAD $(git rev-parse --short HEAD) + working changes)"
  node deploy/release.mjs check-node-modules --checkout "$W/cand"; echo "exit $?"
  node --input-type=module -e "import { checkNodeModules } from '$W/cand/deploy/release.mjs'; const r = checkNodeModules('$W/cand'); console.log(JSON.stringify({ status: r.status, checked: r.checked, changed: r.changed.length, extraneous: r.extraneous.length, missing: r.missing.length }))"
  echo "== negative control A: copy of the two lock files, one installed version altered (must exit 1)"
  C="$W/rehearsal/nm-ctl"; rm -rf "$C"; mkdir -p "$C/node_modules"
  cp package-lock.json "$C/package-lock.json"
  node -e "const fs=require('fs');const l=JSON.parse(fs.readFileSync('node_modules/.package-lock.json','utf8'));const k=Object.keys(l.packages).find(x=>x.startsWith('node_modules/')&&l.packages[x].version);l.packages[k].version='0.0.0-tampered';fs.writeFileSync('$C/node_modules/.package-lock.json',JSON.stringify(l));console.log('altered',k)"
  node deploy/release.mjs check-node-modules --checkout "$C"; echo "exit $?"
  echo "== negative control B: an extraneous package added (must exit 1)"
  node -e "const fs=require('fs');const l=JSON.parse(fs.readFileSync('node_modules/.package-lock.json','utf8'));l.packages['node_modules/zz-not-in-lock']={version:'1.0.0',resolved:'x',integrity:'sha512-x'};fs.writeFileSync('$C/node_modules/.package-lock.json',JSON.stringify(l))"
  node deploy/release.mjs check-node-modules --checkout "$C"; echo "exit $?"
  echo "== control C: no installed record (must exit 0, unknown)"
  rm -f "$C/node_modules/.package-lock.json"; node deploy/release.mjs check-node-modules --checkout "$C"; echo "exit $?"
} > "$W/evidence/node-modules-real.txt" 2>&1
cat "$W/evidence/node-modules-real.txt"
{ echo "== tsc --noEmit (heavy lock)"; flock /mnt/ssd/afldb-rem-20261114-heavy.lock nice -n 10 ionice -c3 npx tsc --noEmit; echo "exit $?"; } > "$W/evidence/tsc.txt" 2>&1
