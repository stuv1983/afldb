// REHEARSAL ONLY. Writes release.json and MANIFEST.sha256 for a sandbox release directory with the hashing functions of the
// candidate's own deploy/release.mjs, so `release.mjs verify|promote|rollback --root <sandbox>` accept it exactly as on the host.
// Usage: node make-release.mjs <checkout> <release-dir> <id> <revision> <buildId>
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
const [checkout, dir, id, revision, buildId] = process.argv.slice(2);
const { hashTree, formatManifest } = await import(pathToFileURL(join(checkout, 'deploy', 'release.mjs')).href);
const entries = hashTree(dir, { exclude: ['MANIFEST.sha256', 'release.json'] });
const text = formatManifest(entries);
writeFileSync(join(dir, 'MANIFEST.sha256'), text);
const info = {
  id, revision, buildId, afldbEnv: 'production', createdBy: 'r1-rehearsal', migrationHead: '118_fixtures_unconfirmed_participants.sql',
  manifest: { sha256: createHash('sha256').update(text).digest('hex'), files: entries.length },
};
writeFileSync(join(dir, 'release.json'), `${JSON.stringify(info, null, 2)}\n`);
console.log(`made ${id}: ${entries.length} files, manifest ${info.manifest.sha256.slice(0, 12)}, supervisor ${readFileSync(join(dir, 'deploy', 'server-cluster.mjs')).length} B`);
