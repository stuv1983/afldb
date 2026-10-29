/** Check retained task files against local cluster credentials without displaying either. */
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
const [baseline, output] = process.argv.slice(2);
const root = process.env.AFLDB_V2_PG_ROOT;
if (!root || !/^[a-f0-9]{8,40}$/.test(baseline ?? '') || !output) throw new Error('Local cluster root, baseline SHA and new report path required');
const secrets = [...Object.values(JSON.parse(readFileSync(join(root, 'secrets/roles.json'), 'utf8'))),
  readFileSync(join(root, 'secrets/superuser.pw'), 'utf8').trim()];
if (secrets.length !== 6 || secrets.some((s) => typeof s !== 'string' || s.length < 24)) throw new Error('Unexpected secret storage shape; no contents displayed');
const git = (...args) => execFileSync('git', args, { encoding: 'utf8', stdio: ['ignore','pipe','pipe'] });
const untracked = git('ls-files','--others','--exclude-standard').split('\n').filter(Boolean);
// Workspace tooling state appeared after task start; preserve it without reading it.
const preservedUntracked = untracked.filter((file) => file.startsWith('.codex/'));
const files = [...new Set([...git('diff','--name-only',baseline).split('\n'),
  ...untracked.filter((file) => !preservedUntracked.includes(file))])].filter(Boolean);
const findings = [];
for (const file of files) {
  const bytes = readFileSync(file);
  if (secrets.some((s) => bytes.includes(Buffer.from(s)) || bytes.includes(Buffer.from(encodeURIComponent(s))))) findings.push(file);
}
writeFileSync(output, JSON.stringify({ baseline, files: files.length, credentialsChecked: secrets.length,
  secretValuesDisplayed: false, preservedUntracked, findings }, null, 2) + '\n', { flag: 'wx' });
console.log(`Local credential scan: ${files.length} retained files, ${secrets.length} credentials, ${findings.length} leaks`);
process.exitCode = findings.length ? 1 : 0;
