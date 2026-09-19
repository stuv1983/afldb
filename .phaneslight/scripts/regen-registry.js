// phaneslight-generated v3.7.2 regen-registry
// Regenerates the API baseline at .phaneslight/registry/<module>.json from current source.
//
// generatedNotFetched: the extractors are language-specific, so no language-independent
// template can exist for this. Authored for THIS project: TypeScript/TSX via the compiler
// API (already a devDependency), an ordered SQL migration ledger, and a network-contract
// slice covering Next.js route handlers and 'use server' action modules.
//
// The baseline is <projectSlug>-closure's diff substrate and list-apis' data source. It is
// NOT documentation: no agent reads these files directly, and it lives outside
// documentation/ so it escapes every doc-discipline rule.
//
// Usage: node .phaneslight/scripts/regen-registry.js [module]

'use strict';

const fs = require('fs');
const path = require('path');
const lib = require(path.join(__dirname, 'registry-lib.js'));

const root = lib.findRoot();
if (!root) {
  console.error('regen-registry: .phaneslight/config.json not found from this directory');
  process.exit(1);
}

let config;
try {
  config = lib.loadConfig(root);
} catch (e) {
  // Refuse rather than regenerate against a config we cannot trust: a baseline built from
  // a half-read config would silently omit whole modules and then read as clean.
  console.error('regen-registry: .phaneslight/config.json unreadable or malformed: ' + e.message);
  process.exit(1);
}

const modules = Array.isArray(config.modules) ? config.modules : [];
const only = process.argv[2] || null;
if (only && only !== 'api-contract' && !modules.includes(only)) {
  console.error("regen-registry: unknown module '" + only + "'. Known: " + modules.join(' ') + ' api-contract');
  process.exit(1);
}

const ts = lib.loadTypeScript(root);
const source = lib.workingTreeSource(root, config.modulePaths);
const { slices, stats, degraded } = lib.buildSlices(source, config, ts);

const registryDir = path.join(root, '.phaneslight', 'registry');
fs.mkdirSync(registryDir, { recursive: true });

const stamp = new Date().toISOString();
let wrote = 0;

for (const [name, entries] of slices) {
  if (only && only !== name) continue;
  const st = stats.get(name) || { fileCount: 0, parsedCount: 0, unextracted: {} };
  const unx = st.unextracted || {};
  const unxTotal = Object.values(unx).reduce((a, b) => a + b, 0);
  const payload = {
    module: name,
    generatedAt: stamp,
    extractor: ts ? 'tsc-api' : 'regex-fallback',
    degraded,
    paths: (config.modulePaths || {})[name] || [],
    fileCount: st.fileCount,
    parsedCount: st.parsedCount,
    unextractedCount: unxTotal,
    unextractedByExtension: unx,
    coverageNote: unxTotal
      ? 'This slice covers .ts/.tsx/.sql only. ' + unxTotal + ' file(s) in this module were NOT examined (' +
        Object.entries(unx).map(([k, v]) => v + ' .' + k).join(', ') +
        '). A low or zero export count here does NOT mean the module has no surface.'
      : 'Every file in this module was examined.',
    exportCount: entries.length,
    exports: entries
  };
  if (name === 'api-contract') {
    payload.kind = 'next-route-handlers + server-actions';
    payload.note = 'No OpenAPI or GraphQL SDL exists in this repository, so the network contract is extracted from the route and action definitions themselves.';
    payload.httpRoutes = entries.filter(e => e.k === 'http-route').length;
    payload.serverActions = entries.filter(e => e.k === 'server-action').length;
  }
  fs.writeFileSync(path.join(registryDir, name + '.json'), JSON.stringify(payload, null, 1) + '\n', 'utf8');
  wrote++;
  console.log(name + ': ' + entries.length + ' entries from ' + st.parsedCount + '/' + st.fileCount + ' files' +
    (unxTotal ? '  [' + unxTotal + ' not extracted: ' + Object.entries(unx).map(([k, v]) => v + ' .' + k).join(', ') + ']' : ''));
}

if (degraded) {
  console.log('regen-registry: DEGRADED -- the typescript compiler API was not resolvable from ' + root + '.');
  console.log('regen-registry: the regex fallback ran instead. Run `npm install`, then regenerate for a full baseline.');
}
console.log('regen-registry: wrote ' + wrote + ' slice(s) to .phaneslight/registry/');
process.exit(0);
