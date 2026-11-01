#!/usr/bin/env node
// Block B: a short, read-only, credential-free summary of a stage plan for the owner's review (never prints raw payload rows).
//   node plan-summary.mjs <plan.json>
import { readFileSync } from 'node:fs';

const plan = JSON.parse(readFileSync(process.argv[2], 'utf8'));
const clip = (v) => (typeof v === 'string' && v.length > 90 ? `${v.slice(0, 87)}...` : v);
function shape(v, depth) {
  if (Array.isArray(v)) return `[${v.length} items]`;
  if (v === null || typeof v !== 'object') return clip(v);
  if (depth <= 0) return `{${Object.keys(v).length} keys}`;
  const out = {};
  for (const [k, x] of Object.entries(v)) out[k] = shape(x, depth - 1);
  return out;
}
const r = plan.request ?? {};
const lines = {
  digest: plan.digest, operation: r.operation, stage: r.stage ?? null,
  seasons: Array.isArray(r.seasons) ? `${r.seasons.length} (${r.seasons[0]}..${r.seasons[r.seasons.length - 1]}; includes 2026: ${r.seasons.includes(2026)})` : null,
  rulings: Array.isArray(r.rulings) ? r.rulings.length : null, actorId: r.actorId ?? null,
  revision: plan.revision, baseline: plan.baseline, createdAt: plan.createdAt, expiresAt: plan.expiresAt,
  backup: plan.backup ? { sha256: plan.backup.sha256, capturedAt: plan.backup.capturedAt, restoredAt: plan.backup.restoredAt, baselineDigest: plan.backup.baselineDigest } : null,
  target: plan.target ? { database: plan.target.database, user: plan.target.user, systemIdentifier: plan.target.systemIdentifier, databaseOid: plan.target.databaseOid } : null,
  payload: shape(plan.payload, 2),
};
console.log(JSON.stringify(lines, null, 2));
