/** Offline only. Missing evidence is reported as INCOMPLETE; invalid parity cannot pass. */
import { readFileSync, writeFileSync } from 'node:fs';

import { releaseGates } from './migration-preservation';

const read = (path: string | undefined): unknown => {
  try { return JSON.parse(readFileSync(path ?? '', 'utf8')); } catch { return undefined; }
};

/** An attestation names retained evidence as "exact/path: description". A missing/unreadable
 * referenced file cannot satisfy a contract merely because its attestation says PASS.
 * The reviewer still judges the referenced evidence and its environment/scope. */
function readEvidence(path: string | undefined): unknown {
  const value = read(path);
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  return Object.fromEntries(Object.entries(value).map(([key, entry]) => {
    const item = entry as { evidence?: unknown } | null;
    const refs = item?.evidence;
    const readable = Array.isArray(refs) && refs.length > 0 && refs.every(ref => {
      if (typeof ref !== 'string' || !ref.includes(': ')) return false;
      try { return readFileSync(ref.split(': ')[0]).length > 0; } catch { return false; }
    });
    return [key, readable ? entry : { result: 'INCOMPLETE', evidence: [] }];
  }));
}

export function runReleaseGates(argv: string[]): number {
  const args = new Map<string, string>();
  const allowed = ['before', 'after', 'parity', 'functional', 'operational', 'out'];
  for (let i = 0; i < argv.length; i += 2) {
    const key = argv[i]?.replace(/^--/, '');
    if (!argv[i].startsWith('--') || !allowed.includes(key) || args.has(key) || !argv[i + 1] || argv[i + 1].startsWith('--')) throw new Error('Invalid or duplicate release-gates option');
    args.set(key, argv[i + 1]);
  }
  if (!args.has('out')) throw new Error('--out is required');
  const parity = read(args.get('parity'));
  const report = releaseGates({ before: read(args.get('before')), after: read(args.get('after')),
    parity,
    functional: readEvidence(args.get('functional')), operational: readEvidence(args.get('operational')) });
  writeFileSync(args.get('out')!, `${JSON.stringify(report, null, 2)}\n`, { flag: 'wx', mode: 0o600 });
  console.log(JSON.stringify(report, null, 2));
  return report.backendAcceptance === 'FAIL' ? 1 : report.backendAcceptance === 'INCOMPLETE' ? 2 : 0;
}

if (process.argv[1] && /release-gates\.ts$/.test(process.argv[1])) {
  try { process.exitCode = runReleaseGates(process.argv.slice(2)); }
  catch { console.error('Release gates refused: invalid arguments or output unavailable'); process.exitCode = 3; }
}
