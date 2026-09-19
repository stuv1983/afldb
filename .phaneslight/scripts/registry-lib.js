// phaneslight-generated v3.7.2 registry-lib
// Shared extraction library for regen-registry and api-diff.
//
// Both scripts must run the SAME extractors, but over different sources: regen-registry
// reads the working tree, api-diff reads a git ref. Duplicating the extractors would mean
// a diff computed by one implementation against a baseline computed by another, and every
// divergence between the two would surface as phantom API drift. So the extractors live
// here once and take an injectable source: {listFiles(), readFile(rel)}.
//
// Not a dispatcher subcommand. It has no .ps1/.sh sibling and is never invoked directly.

'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { execFileSync } = require('child_process');

// ---------------------------------------------------------------- root + config

function findRoot(start) {
  let d = start || process.cwd();
  for (;;) {
    if (fs.existsSync(path.join(d, '.phaneslight', 'config.json'))) return d;
    const p = path.dirname(d);
    if (!p || p === d) return null;
    d = p;
  }
}

function loadConfig(root) {
  return JSON.parse(fs.readFileSync(path.join(root, '.phaneslight', 'config.json'), 'utf8'));
}

// Resolved from the PROJECT's node_modules, never installed by these scripts. Absence is
// a documented degrade, not a failure; callers record which extractor produced a slice so
// a degraded result can never be mistaken for a full one.
function loadTypeScript(root) {
  try {
    return require(require.resolve('typescript', { paths: [root] }));
  } catch (_) {
    return null;
  }
}

// ---------------------------------------------------------------- sources

function workingTreeSource(root, modulePaths) {
  let files;
  try {
    files = execFileSync('git', ['ls-files'], { cwd: root, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 })
      .split('\n').map(s => s.trim()).filter(Boolean);
  } catch (_) {
    // No git, or not a repository. Walk the configured module paths instead: slower, and
    // it cannot honour .gitignore, but a baseline from a walk beats no baseline at all.
    const acc = [];
    const walk = (rel) => {
      const abs = path.join(root, rel);
      let st;
      try { st = fs.statSync(abs); } catch (_) { return; }
      if (st.isDirectory()) {
        if (/(^|\/)(node_modules|\.next|\.git)$/.test(rel)) return;
        for (const e of fs.readdirSync(abs)) walk(rel.replace(/\\/g, '/') + '/' + e);
      } else acc.push(rel.replace(/\\/g, '/'));
    };
    for (const paths of Object.values(modulePaths || {})) for (const p of paths) walk(p);
    files = acc;
  }
  return {
    label: 'working tree',
    listFiles: () => files,
    readFile: (rel) => {
      try { return fs.readFileSync(path.join(root, rel), 'utf8'); } catch (_) { return null; }
    }
  };
}

function gitRefSource(root, ref) {
  let files;
  try {
    files = execFileSync('git', ['ls-tree', '-r', '--name-only', ref], {
      cwd: root, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024
    }).split('\n').map(s => s.trim()).filter(Boolean);
  } catch (e) {
    const err = new Error("api-diff: cannot list files at ref '" + ref + "'. Is it a valid git ref?");
    err.cause = e;
    throw err;
  }
  const cache = new Map();
  return {
    label: ref,
    listFiles: () => files,
    readFile: (rel) => {
      if (cache.has(rel)) return cache.get(rel);
      let text = null;
      try {
        text = execFileSync('git', ['show', ref + ':' + rel], {
          cwd: root, encoding: 'utf8', maxBuffer: 32 * 1024 * 1024
        });
      } catch (_) { text = null; }
      cache.set(rel, text);
      return text;
    }
  };
}

// ---------------------------------------------------------------- helpers

const sha = s => crypto.createHash('sha256').update(s).digest('hex').slice(0, 12);
const squash = s => s.replace(/\s+/g, ' ').trim();
const cap = (s, n) => (s.length > n ? s.slice(0, n - 1) + '…' : s);

const isTs = f => /\.(ts|tsx)$/.test(f);
const isSql = f => /\.sql$/.test(f);
// A test file is not API surface. Excluding them keeps the baseline about the contract
// the project publishes rather than about how it is checked.
const isTest = f => /\.(test|spec)\.(ts|tsx)$/.test(f) || /(^|\/)tests?\//.test(f);

const VERBS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS'];

// ---------------------------------------------------------------- extractor

function makeExtractor(ts) {
  function hasMod(node, kind) {
    return !!(node.modifiers || []).some(m => m.kind === kind);
  }

  // Strips a function/class BODY out of the declaration text. Drift detection cares about
  // the shape of the contract, not its implementation: a refactor that rewrites a body
  // without touching the signature must NOT read as an API change, or every refactor
  // becomes a false drift flag and the signal stops being worth reading.
  function signatureOf(node, src) {
    const text = node.getText(src);
    const brace = text.indexOf('{');
    const arrow = text.indexOf('=>');
    let cut = text.length;
    if (node.body && brace !== -1 && (arrow === -1 || brace < arrow)) cut = brace;
    return cap(squash(text.slice(0, cut)), 220);
  }

  function memberDigest(src, members) {
    const names = (members || [])
      .map(m => (m.name && m.name.getText ? m.name.getText(src) : null))
      .filter(Boolean);
    return cap(squash(names.join(', ')), 220);
  }

  // Fallback only. Declared-export forms are regular enough to catch with line anchors;
  // multiline signatures and the word 'export' inside a string or comment are its known
  // blind spots, which is why any slice built this way is marked degraded.
  function extractRegex(rel, text) {
    const out = [];
    const re = /^\s*export\s+(?:default\s+)?(?:declare\s+)?(?:async\s+)?(function|class|interface|type|enum|const|let|var)\s+([A-Za-z0-9_$]+)/;
    text.split('\n').forEach((line, i) => {
      const m = re.exec(line);
      if (!m) return;
      const k = (m[1] === 'let' || m[1] === 'var') ? 'const' : m[1];
      out.push({ n: m[2], k, f: rel, l: i + 1, s: cap(squash(line), 220), h: sha(squash(line)) });
    });
    return out;
  }

  function extractTs(rel, text) {
    if (text == null) return { exports: [] };
    if (!ts) return { exports: extractRegex(rel, text), degraded: true };

    let src;
    try {
      src = ts.createSourceFile(rel, text, ts.ScriptTarget.Latest, true,
        rel.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
    } catch (_) {
      return { exports: extractRegex(rel, text), degraded: true };
    }

    const K = ts.SyntaxKind;
    const out = [];
    const lineOf = n => src.getLineAndCharacterOfPosition(n.getStart(src)).line + 1;
    const push = (name, kind, node, signature) =>
      out.push({ n: name, k: kind, f: rel, l: lineOf(node), s: signature, h: sha(squash(node.getText(src))) });

    for (const st of src.statements) {
      const exported = hasMod(st, K.ExportKeyword);
      const dflt = hasMod(st, K.DefaultKeyword);

      if (st.kind === K.FunctionDeclaration && exported) {
        push(dflt ? 'default' : (st.name ? st.name.getText(src) : 'default'), 'function', st, signatureOf(st, src));
      } else if (st.kind === K.ClassDeclaration && exported) {
        push(dflt ? 'default' : (st.name ? st.name.getText(src) : 'default'), 'class', st, memberDigest(src, st.members));
      } else if (st.kind === K.InterfaceDeclaration && exported) {
        push(st.name.getText(src), 'interface', st, memberDigest(src, st.members));
      } else if (st.kind === K.TypeAliasDeclaration && exported) {
        push(st.name.getText(src), 'type', st, cap(squash(st.type.getText(src)), 220));
      } else if (st.kind === K.EnumDeclaration && exported) {
        push(st.name.getText(src), 'enum', st, memberDigest(src, st.members));
      } else if (st.kind === K.VariableStatement && exported) {
        for (const d of st.declarationList.declarations) {
          const name = d.name.getText(src);
          const typed = d.type ? ': ' + squash(d.type.getText(src)) : '';
          const init = d.initializer ? signatureOf(d.initializer, src) : '';
          push(name, 'const', d, cap(squash(name + typed + (init ? ' = ' + init : '')), 220));
        }
      } else if (st.kind === K.ExportDeclaration && st.exportClause && st.exportClause.elements) {
        // `export { a, b as c }` names a contract this file publishes even though it
        // declares none of it, so it belongs in the baseline.
        for (const el of st.exportClause.elements) push(el.name.getText(src), 're-export', el, squash(el.getText(src)));
      } else if (st.kind === K.ExportDeclaration && !st.exportClause && st.moduleSpecifier) {
        push('*', 'star-re-export', st, squash(st.getText(src)));
      } else if (st.kind === K.ExportAssignment) {
        push('default', 'default', st, cap(squash(st.expression.getText(src)), 220));
      }
    }
    return { exports: out };
  }

  // Migrations are ordered and append-only. The contract that must not drift is not the
  // DDL but the SET: a migration renamed, reordered, removed, or EDITED AFTER BEING
  // APPLIED is the failure this catches. Content is hashed, never parsed -- migrate.ts
  // already refuses an edited applied migration, and this makes the same drift visible at
  // close time rather than at the next migration run.
  function extractSql(rel, text) {
    if (text == null) return null;
    return {
      n: path.posix.basename(rel),
      k: 'migration',
      f: rel,
      l: 1,
      s: 'lines: ' + text.split('\n').length,
      h: sha(text.replace(/\r\n/g, '\n'))
    };
  }

  function routePathOf(rel) {
    // src/app/api/coaches/[id]/opponent-record/route.ts -> /api/coaches/[id]/opponent-record
    let p = rel.replace(/^src\/app/, '').replace(/\/route\.tsx?$/, '');
    p = p.replace(/\/\([^/]+\)/g, ''); // route groups are not part of the URL
    return p || '/';
  }

  function extractRoutes(rel, text) {
    if (text == null) return [];
    const isRoute = /\/route\.tsx?$/.test(rel);
    const isAction = /^\s*['"]use server['"]/m.test(text);
    if (!isRoute && !isAction) return [];
    const out = [];
    for (const e of extractTs(rel, text).exports) {
      if (isRoute && VERBS.includes(e.n)) {
        out.push({ n: e.n + ' ' + routePathOf(rel), k: 'http-route', f: rel, l: e.l, s: e.s, h: e.h });
      } else if (isAction && (e.k === 'function' || e.k === 'const')) {
        out.push({ n: e.n, k: 'server-action', f: rel, l: e.l, s: e.s, h: e.h });
      }
    }
    return out;
  }

  return { extractTs, extractSql, extractRoutes };
}

// ---------------------------------------------------------------- slice building

function filesForModule(allFiles, modulePaths, mod) {
  const prefixes = (modulePaths[mod] || []).map(p => p.replace(/\\/g, '/').replace(/\/+$/, ''));
  if (!prefixes.length) return [];
  return allFiles.filter(f => prefixes.some(p => f === p || f.startsWith(p + '/')));
}

// Builds every slice for one source. Returns {slices: Map<name, entries[]>, degraded, stats}.
function buildSlices(source, config, ts) {
  const ex = makeExtractor(ts);
  const modules = Array.isArray(config.modules) ? config.modules : [];
  const modulePaths = config.modulePaths || {};
  const all = source.listFiles();
  const slices = new Map();
  const stats = new Map();
  let degraded = !ts;

  for (const mod of modules) {
    const files = filesForModule(all, modulePaths, mod);
    const entries = [];
    const unextracted = {};
    let parsed = 0;
    for (const f of files) {
      if (isTs(f) && !isTest(f)) {
        const r = ex.extractTs(f, source.readFile(f));
        if (r.degraded) degraded = true;
        entries.push(...r.exports);
        parsed++;
      } else if (isSql(f)) {
        const e = ex.extractSql(f, source.readFile(f));
        if (e) { entries.push(e); parsed++; }
      } else {
        // Counted, never silently dropped. A slice reading "0 entries from 0 files" is
        // otherwise indistinguishable from "this module has no API surface", and this
        // project has whole modules of Python and shell (tools/migration is 33 .py files)
        // that these extractors do not cover. An unverified negative stated as a fact is
        // exactly the failure the bootstrap-snapshot rule warns about, so the slice
        // records WHAT it did not look at rather than implying there was nothing to see.
        const ext = (f.match(/\.([A-Za-z0-9]+)$/) || [null, 'none'])[1].toLowerCase();
        unextracted[ext] = (unextracted[ext] || 0) + 1;
      }
    }
    entries.sort((a, b) => (a.f === b.f ? a.n.localeCompare(b.n) : a.f.localeCompare(b.f)));
    slices.set(mod, entries);
    stats.set(mod, { fileCount: files.length, parsedCount: parsed, unextracted });
  }

  // The network-facing contract is a slice of its own: for a project that exposes an API,
  // the PUBLIC contract is what must not drift silently, and internal exported symbols are
  // a different surface. A removed verb or a changed action signature shows up here even
  // when the symbol extraction above looks unchanged.
  const routes = [];
  for (const f of all) {
    if (!isTs(f) || isTest(f) || !/^src\/app\//.test(f)) continue;
    routes.push(...ex.extractRoutes(f, source.readFile(f)));
  }
  routes.sort((a, b) => (a.n === b.n ? a.f.localeCompare(b.f) : a.n.localeCompare(b.n)));
  slices.set('api-contract', routes);
  stats.set('api-contract', { fileCount: routes.length, parsedCount: routes.length });

  return { slices, stats, degraded };
}

module.exports = {
  findRoot, loadConfig, loadTypeScript,
  workingTreeSource, gitRefSource,
  makeExtractor, buildSlices, filesForModule,
  isTs, isSql, isTest, sha, squash, cap
};
