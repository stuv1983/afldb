/** Compare changed-file lint with an explicit baseline, retaining inherited findings. */
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { ESLint } from 'eslint';

const baseline = process.argv[2];
const out = process.argv[3];
if (!/^[a-f0-9]{8,40}$/.test(baseline ?? '') || !out) throw new Error('baseline SHA and output path required');
const git = (...args) => execFileSync('git', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
const files = [...new Set([...git('diff', '--name-only', baseline).split('\n'), ...git('ls-files', '--others', '--exclude-standard').split('\n')])]
  .filter((file) => !file.startsWith('.codex/') && /\.(ts|tsx|mts|mjs)$/.test(file));
const eslint = new ESLint({ cache: false });
const records = [];
for (const file of files) {
  const current = readFileSync(file, 'utf8');
  let previous = '';
  try { previous = git('show', `${baseline}:${file}`); } catch { /* A new source file has no baseline findings. */ }
  const [now] = await eslint.lintText(current, { filePath: file });
  const [before] = previous ? await eslint.lintText(previous, { filePath: file }) : [{ messages: [] }];
  const key = (message, source) => JSON.stringify([message.ruleId, message.message, message.severity,
    source.split(/\r?\n/)[(message.line ?? 1) - 1]?.trim()]);
  const remaining = before.messages.map((message) => key(message, previous));
  const added = now.messages.filter((message) => {
    const index = remaining.indexOf(key(message, current));
    if (index < 0) return true;
    remaining.splice(index, 1);
    return false;
  });
  records.push({ file, errors: now.errorCount, warnings: now.warningCount, baseline: before.messages.length, added });
}
const summary = { files: records.length, errors: records.reduce((n, r) => n + r.errors, 0),
  warnings: records.reduce((n, r) => n + r.warnings, 0), newFindings: records.reduce((n, r) => n + r.added.length, 0) };
writeFileSync(out, `${JSON.stringify({ baseline, summary, records }, null, 2)}\n`, { flag: 'wx' });
console.log(JSON.stringify(summary));
process.exitCode = summary.newFindings ? 1 : 0;
