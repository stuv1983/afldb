// Read-only verification of the specifically authorised historical J2 package.
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const root = 'C:/tmp/afldb-c2-SUCCESSOR-PROPOSAL-J2-20261023T2346Z';
const sha = b => crypto.createHash('sha256').update(b).digest('hex');
const manifest = path.join(root, 'HASHES.sha256');
const bytes = fs.readFileSync(manifest);
const results = [];
for (const line of bytes.toString('utf8').split(/\r?\n/).filter(Boolean)) {
  const m = /^([a-f0-9]{64}) [ *](.+)$/.exec(line);
  if (!m) throw Error('Unrecognised pin line');
  const file = path.resolve(root, m[2]);
  if (!file.startsWith(path.resolve(root) + path.sep)) throw Error('Out-of-package pin');
  if (/(?:^|[\\/])(?:\.env(?:\..*)?|[^\\/]*\.(?:pem|key|pfx|p12)|credentials)(?:$|[\\/])/i.test(file)) throw Error('Unavailable secret-bearing input: ' + file);
  const actual = fs.existsSync(file) ? sha(fs.readFileSync(file)) : null;
  results.push({ path: file, expected_sha256: m[1], actual_sha256: actual, status: actual === m[1] ? 'PASS' : actual === null ? 'MISSING' : 'MISMATCH' });
}
const report = { verified_at: new Date().toISOString(), package: root, manifest_sha256: sha(bytes), members: results.length, passed: results.filter(r => r.status === 'PASS').length, findings: results.filter(r => r.status !== 'PASS'), files: results, external_material_modified: false };
fs.writeFileSync(path.join(__dirname, 'validation/retained-J2-integrity.json'), JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify({ ...report, files: undefined }));
process.exitCode = report.findings.length ? 1 : 0;
