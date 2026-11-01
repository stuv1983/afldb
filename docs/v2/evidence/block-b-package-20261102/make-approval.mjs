#!/usr/bin/env node
// Block B: build the execution-approval file for ONE stage from its plan, the executing revision, and the OWNER'S OWN WORDS.
//   node make-approval.mjs --plan <plan.json> --revision <40hex> --reference "<the owner's approval words, 20+ characters>" --expires <ISO UTC> --out <new file outside the checkout>
// It writes only the file the owner's written approval authorises: it is NOT an approval by itself. It refuses when the reference is short, the expiry is not in the
// future or is later than the plan's own expiry, the revision is not 40 lowercase hex, or the plan is not a Brownlow correction plan. The runner re-checks every field.
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const argv = process.argv.slice(2);
const flag = (n) => { const i = argv.indexOf(n); if (i < 0 || !argv[i + 1]) throw new Error(`${n} required`); return argv[i + 1]; };
function main() {
  const plan = JSON.parse(readFileSync(flag('--plan'), 'utf8'));
  const revision = flag('--revision'), reference = flag('--reference'), expires = flag('--expires'), out = resolve(flag('--out'));
  const problems = [];
  if (!/^[0-9a-f]{40}$/.test(revision)) problems.push('revision must be 40 lowercase hex');
  if (reference.trim().length < 20) problems.push("the reference must be the owner's own approval words (20+ characters)");
  if (!plan?.digest || !/^[0-9a-f]{64}$/.test(plan.digest) || !plan.request?.operation || !Array.isArray(plan.request?.seasons) || !plan.target || !plan.expiresAt) problems.push('not a Brownlow correction plan');
  const exp = Date.parse(expires);
  if (!Number.isFinite(exp) || !/Z$/.test(expires)) problems.push('expiry must be an ISO UTC time ending in Z');
  else {
    if (!(exp > Date.now())) problems.push('expiry is not in the future');
    if (plan?.expiresAt && exp > Date.parse(plan.expiresAt)) problems.push(`expiry is later than the plan's own expiry ${plan.expiresAt}`);
    if (exp - Date.now() > 12 * 3600 * 1000) problems.push('expiry is more than 12 hours away: approve a window, not a standing permission');
  }
  if (existsSync(out)) problems.push('output exists; approvals are never overwritten');
  if (problems.length) { console.error('REFUSED:\n  - ' + problems.join('\n  - ')); process.exit(1); }
  const op = String(plan.request.operation);
  const approval = { planDigest: plan.digest, target: plan.target, revision, operation: op, seasons: plan.request.seasons,
    source: op.endsWith('backfill') ? 'legacy' : 'afl_api', approvedAt: new Date().toISOString(), expiresAt: new Date(exp).toISOString(),
    reference: reference.trim(), rulings: plan.request.rulings, stage: plan.request.stage };
  writeFileSync(out, `${JSON.stringify(approval)}\n`, { flag: 'wx', mode: 0o600 });
  console.log(`APPROVAL FILE ${out}: plan ${plan.digest}, operation ${op}${plan.request.stage ? ` (${plan.request.stage})` : ''}, seasons ${plan.request.seasons.length}, expires ${approval.expiresAt}`);
}
try { main(); } catch (e) { console.error(e.message ?? e); process.exit(2); }
