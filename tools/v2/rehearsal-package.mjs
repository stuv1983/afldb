/** ISSUE-316: external, built-in-only rehearsal trust boundary. No package imports. */
import * as fs from 'node:fs';
import * as path from 'node:path';
import { createHash, randomBytes } from 'node:crypto';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { spawnSync } from 'node:child_process';

const PURPOSE = 'issue316-c2-rehearsal-only';
const HEX = /^[a-f0-9]{64}$/;
const refuse = (reason) => { throw new Error(`Rehearsal package refused: ${reason}`); };
const hash = (bytes) => createHash('sha256').update(bytes).digest('hex');
export function freezeBinding(value) {
  if (value && typeof value === 'object') {
    Object.values(value).forEach(freezeBinding);
    Object.freeze(value);
  }
  return value;
}
function equal(a, b) {
  if (a === null || b === null || typeof a !== 'object' || typeof b !== 'object') return a === b;
  const keys = Object.keys(a).sort();
  return JSON.stringify(keys) === JSON.stringify(Object.keys(b).sort()) && keys.every((k) => equal(a[k], b[k]));
}
function fields(obj, names, where) {
  if (!obj || Array.isArray(obj) || typeof obj !== 'object'
      || !equal(Object.keys(obj).sort(), names.split(' ').sort())) refuse(`invalid ${where} fields`);
}
// JSON.parse alone silently accepts duplicate keys. Token-walk first, including escaped keys.
export function strictJson(bytes) {
  if (bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) refuse('JSON BOM');
  const source = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  if (source.charCodeAt(0) === 0xfeff) refuse('JSON BOM');
  const tokens = source.match(/"(?:[^"\\\x00-\x1f]|\\(?:["\\/bfnrt]|u[0-9a-fA-F]{4}))*"|[{}\[\]:,]|-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?|true|false|null|\S/g) ?? [];
  let i = 0;
  function value() {
    const t = tokens[i++];
    if (t === '{') {
      const seen = new Set();
      if (tokens[i] === '}') { i++; return; }
      for (;;) {
        const key = JSON.parse(tokens[i++]);
        if (typeof key !== 'string' || seen.has(key)) refuse('duplicate/invalid JSON key');
        seen.add(key);
        if (tokens[i++] !== ':') refuse('invalid JSON');
        value();
        const end = tokens[i++];
        if (end === '}') break;
        if (end !== ',') refuse('invalid JSON');
      }
    } else if (t === '[') {
      if (tokens[i] === ']') { i++; return; }
      for (;;) {
        value();
        const end = tokens[i++];
        if (end === ']') break;
        if (end !== ',') refuse('invalid JSON');
      }
    } else { JSON.parse(t); }
  }
  value();
  if (i !== tokens.length) refuse('invalid JSON');
  return JSON.parse(source);
}
export function inventoryEntries(bytes, runtime = false) {
  const text = bytes.toString('utf8');
  if (!text.endsWith('\n') || text.includes('\r') || text.includes('\ufeff')) refuse('noncanonical sums encoding');
  const seen = new Set();
  let previous = '';
  return text.slice(0, -1).split('\n').map((line) => {
    const m = (runtime ? /^([a-f0-9]{64})  ([a-zA-Z0-9_@+./-]+)$/ : /^([a-f0-9]{64})  ([a-zA-Z0-9_./-]+)$/).exec(line);
    if (!m) refuse('malformed sums');
    const [, digest, name] = m;
    if (name.split('/').some((p) => !p || p === '.' || p === '..') || name.startsWith('/')
        || name === 'SHA256SUMS.txt' || seen.has(name.toLowerCase()) || name <= previous) refuse('unsafe/duplicate/unsorted inventory path');
    seen.add(name.toLowerCase()); previous = name;
    return { path: name, sha256: digest };
  });
}
const PAIR_FIELDS = 'profile core_snapshot_label core_manifest_sha256 core_artefact_set_sha256 witness_snapshot_label witness_manifest_sha256 first_season last_season expected_rows';
const TARGET_FIELDS = 'database host port cluster_name database_marker';
const RUNTIME_FIELDS_V1 = 'schema_version roots node tsx_loader node_search_roots esbuild_binary python python_stdlib python_dependencies pg_bin listener_tool lockfile_sha256';
// Version 2 adds file-bound executables, absent startup landmarks, and per-root inert-link and
// hard-link evidence. Each new field exists only in version 2; version 1 stays strictly as it was.
const RUNTIME_FIELDS_V2 = `${RUNTIME_FIELDS_V1} executables python_absent_landmarks`;
// Version 3 (AFLDB-ISSUE-320) adds the enforced native closure: every executable and shared object any
// guarded process may map or exec, bound by canonical path and content, plus the rtld-audit module that
// enforces it in every guarded process (tools/v2/native-audit/afldb-native-audit.c).
const RUNTIME_FIELDS_V3 = `${RUNTIME_FIELDS_V2} native_closure`;
// Printable ASCII, no leading/trailing blank; the auditor's own path also may not hold the LD_AUDIT separators.
const NATIVE_PATH = /^[\x21-\x7e](?:[\x20-\x7e]*[\x21-\x7e])?$/, AUDITOR_PATH = /^[\x21-\x39\x3b-\x7e]+$/;
/** The exact policy text the auditor reads; derived only from a verified version 3 record. */
export function nativePolicyText(closure) {
  return `afldb-native-closure-policy 1\nauditor ${closure.auditor.sha256} ${closure.auditor.path}\n`
    + closure.objects.map((o) => `object ${o.sha256} ${o.path}\n`).join('');
}
const RUNTIME_ALPHABET = /^[a-zA-Z0-9_@+./-]+$/;
const overlaps = (a, b) => { const r = path.relative(a, b); return r === '' || (!r.startsWith('..' + path.sep) && r !== '..' && !path.isAbsolute(r)); };
/** The exact files whose presence would change which prefix, venv or build layout CPython selects at
 * start-up for this interpreter (getpath: pyvenv.cfg beside or above the executable, pybuilddir.txt,
 * the `Modules/Setup.local` build landmark searched upward from the executable directory, and a
 * `._pth` file named for the executable). Version 2 records prove every one absent; each is a reviewed,
 * exact path, never a pattern. Throws on anything but a canonical absolute path. */
export function pythonStartupLandmarks(python) {
  if (typeof python !== 'string' || !path.isAbsolute(python) || path.resolve(python) !== python) refuse('Python startup landmarks need a canonical interpreter path');
  const dir = path.dirname(python), base = path.basename(python), dot = base.lastIndexOf('.');
  const out = [path.join(dir, 'pyvenv.cfg'), path.join(path.dirname(dir), 'pyvenv.cfg'), path.join(dir, 'pybuilddir.txt'),
    path.join(dir, `${base}._pth`), path.join(dir, `${dot > 0 ? base.slice(0, dot) : base}._pth`)];
  for (let d = dir; ; d = path.dirname(d)) { out.push(path.join(d, 'Modules', 'Setup.local')); if (path.dirname(d) === d) break; }
  return [...new Set(out)];
}
export function verifyRehearsalPackage(request, io = fs) {
  // Only request.specSha256 (from the reviewed launch instruction) establishes initial trust.
  if (!HEX.test(request.specSha256 ?? '')) refuse('missing external specification pin');
  const checkedPaths = new Set(); // One complete traversal per call, never across checkpoints.
  // Runtime-only: absolute path -> exact link count of a declared hard-link group member.
  // The package/source tree never registers here, so it keeps the exact nlink === 1 rule.
  const hardlinkCounts = new Map();
  function canonical(p, missing = false) {
    if (typeof p !== 'string' || !path.isAbsolute(p) || path.resolve(p) !== p || /[\x00-\x1f]/.test(p)) refuse('noncanonical absolute location');
    if (checkedPaths.has(p)) return p;
    const parent = path.dirname(p);
    if (parent !== p) canonical(parent, missing);
    if (!io.existsSync(p)) {
      if (missing) return p;
      refuse('missing required location');
    }
    const st = io.lstatSync(p);
    if (st.isSymbolicLink() || (!st.isFile() && !st.isDirectory()) || (st.isFile() && st.nlink !== (hardlinkCounts.get(p) ?? 1))
        || io.realpathSync(p) !== p) refuse('linked, redirected or special location');
    checkedPaths.add(p);
    return p;
  }
  function pinned(p, digest) {
    if (!HEX.test(digest ?? '')) refuse('invalid digest');
    canonical(p);
    const bytes = io.readFileSync(p);
    if (hash(bytes) !== digest) refuse('pinned bytes changed');
    return bytes;
  }
  // ---- runtime record version 2 evidence (never reachable for the package/source tree) ----
  // Inert links: path + literal readlink only. A link is accounted for, never followed or trusted.
  function linkLedger(root) {
    if (!Array.isArray(root.links)) refuse('runtime link ledger');
    if (!root.links.length) return [];
    const text = root.links.map((l) => {
      fields(l, 'path readlink', 'runtime link');
      if (typeof l.path !== 'string' || !RUNTIME_ALPHABET.test(l.path)
          || typeof l.readlink !== 'string' || l.readlink.length > 4096 || !/^[\x20-\x7e]+$/.test(l.readlink)) refuse('runtime link entry');
      return `${'0'.repeat(64)}  ${l.path}\n`;
    }).join('');
    inventoryEntries(Buffer.from(text), true); // alphabet, components, case folding, sorted and unique
    return root.links;
  }
  // Hard-link groups: complete membership inside one root. Evidence is checked after hashing.
  function hardlinkGroups(root, listed) {
    if (!Array.isArray(root.hardlinks)) refuse('runtime hard-link groups');
    const members = new Set(listed.map((e) => e.path)), claimed = new Set();
    let previous = '';
    return root.hardlinks.map((g) => {
      fields(g, 'paths nlink', 'runtime hard-link group');
      if (!Array.isArray(g.paths) || g.paths.length < 2 || g.nlink !== g.paths.length
          || g.paths.some((p) => typeof p !== 'string' || !RUNTIME_ALPHABET.test(p))) refuse('runtime hard-link group');
      inventoryEntries(Buffer.from(g.paths.map((p) => `${'0'.repeat(64)}  ${p}\n`).join('')), true);
      if (g.paths[0] <= previous) refuse('runtime hard-link groups unsorted');
      previous = g.paths[0];
      for (const p of g.paths) {
        if (!members.has(p) || claimed.has(p)) refuse('hard-link group member not an unclaimed listed file of this root');
        claimed.add(p);
      }
      return g;
    });
  }
  function verifyGroups(root, groups, listed) {
    const digests = new Map(listed.map((e) => [e.path, e.sha256])), inodes = new Set();
    for (const g of groups) {
      const stats = g.paths.map((p) => io.lstatSync(path.join(root.path, p)));
      const key = `${stats[0].dev}:${stats[0].ino}`;
      if (stats.some((st) => !st.isFile() || st.nlink !== g.nlink || `${st.dev}:${st.ino}` !== key
            || (typeof st.ino !== 'number' && typeof st.ino !== 'bigint'))
          || new Set(g.paths.map((p) => digests.get(p))).size !== 1 || inodes.has(key)) refuse('hard-link group evidence');
      inodes.add(key);
    }
  }
  // Interpreters and the listener tool are bound as files. Their parent directories are not
  // enumerated, trusted or searched, so exactly these three are accepted.
  function verifyExecutables() {
    const list = runtime.executables;
    if (!Array.isArray(list)) refuse('runtime executables');
    for (const e of list) fields(e, 'path sha256', 'runtime executable');
    const declared = [runtime.node, runtime.python, runtime.listener_tool];
    if (new Set(declared).size !== declared.length || list.length !== declared.length
        || !equal(list.map((e) => e.path).sort(), [...declared].sort())) refuse('runtime executables');
    for (const e of list) {
      pinned(e.path, e.sha256); // non-link ancestors, realpath identity, regular file, nlink 1, exact bytes
      const st = io.lstatSync(e.path);
      if (!st.isFile() || (Number(st.mode) & 0o6000)) refuse('executable mode');
      if (runtime.roots.some((r) => overlaps(r.path, e.path)) || path.dirname(e.path) === runtime.pg_bin) refuse('executable parent is trusted or searched');
    }
  }
  const spec = strictJson(pinned(request.specPath, request.specSha256));
  fields(spec, 'schema_version purpose implementation_basis pair target package_root source_root inventory_relative_path expected_inventory_sha256 runtime_record runtime_record_sha256 capture_root output_root temp_root cluster_root runner_options launcher_path launcher_sha256 required_files', 'launch specification');
  if (spec.schema_version !== 1 || spec.purpose !== PURPOSE || !/^[a-f0-9]{40}$/.test(spec.implementation_basis)
      || spec.implementation_basis === 'b8ea28550a291b766bf7ad9f3b63621e9f9efa81') refuse('implementation/purpose');
  fields(spec.pair, PAIR_FIELDS, 'pair'); fields(spec.target, TARGET_FIELDS, 'target');
  if (spec.pair.profile !== 'c2-2026-rehearsal-only' || spec.pair.first_season !== 1897 || spec.pair.last_season !== 2026
      || spec.pair.expected_rows !== 1640 || spec.pair.core_snapshot_label !== 'c2-2026-final-core-v1'
      || spec.pair.core_manifest_sha256 !== '02bbcf932ef71d411c5d5077ae85000ebdbc0896323cf3f57c0e9fa417cf9988'
      || spec.pair.core_artefact_set_sha256 !== '817d594e5c0529b6524c8b211a209b9ef25a500c5c463daad8e3bb7b1eee7b7e'
      || spec.pair.witness_snapshot_label !== 'c2-2026-final-ladder-v1'
      || spec.pair.witness_manifest_sha256 !== '65c299072afb35f1b0ddce50c9c72728e03bcd1580d676ca63eaaafb86047c34') refuse('unsupported pair');
  const target = spec.target;
  if (!/^afldb_v2_rb_[a-z0-9_]+_test$/.test(target.database) && target.database !== 'afldb_v2_hist_test') refuse('nonisolated target');
  if (target.host !== '127.0.0.1' || !Number.isInteger(target.port) || target.port < 1024 || target.port > 65535 || target.port === 5432
      || target.cluster_name !== 'afldb_v2_isolated' || target.database_marker !== 'afldb-v2-isolated-test') refuse('target identity');
  canonical(spec.package_root); canonical(spec.source_root);
  if (spec.source_root !== path.join(spec.package_root, 'source') || spec.inventory_relative_path !== 'SHA256SUMS.txt') refuse('source/inventory identity');
  const sums = pinned(path.join(spec.package_root, 'SHA256SUMS.txt'), spec.expected_inventory_sha256);
  const entries = inventoryEntries(sums);
  // `links` is supplied only for a version 2 runtime tree root. A symbolic link there is recorded
  // (its own lstat and literal readlink only) and is never followed, descended into or listed;
  // everywhere else, including the package tree, a link reaches canonical() and refuses.
  function enumerate(root, packageTree = false, links = null) {
    const found = [];
    function walk(dir, prefix) {
      canonical(dir);
      for (const name of io.readdirSync(dir).sort()) {
        if (packageTree && /^(?:\.env(?:\..*)?|\.git|\.codex|node_modules|__pycache__|\.next|site-packages)$/.test(name)) refuse('excluded package member');
        if (!(packageTree ? /^[a-zA-Z0-9_.-]+$/ : /^[a-zA-Z0-9_@+.-]+$/).test(name) || name === '.' || name === '..') refuse('unsupported file name');
        const rel = prefix + name, abs = path.join(dir, name);
        if (links && io.lstatSync(abs).isSymbolicLink()) { links.push({ path: rel, readlink: io.readlinkSync(abs) }); continue; }
        canonical(abs);
        if (io.lstatSync(abs).isDirectory()) walk(abs, rel + '/'); else found.push(rel);
      }
    }
    walk(root, ''); return found.sort();
  }
  if (!equal(enumerate(spec.package_root, true).filter((n) => n !== 'SHA256SUMS.txt'), entries.map((e) => e.path))) refuse('package membership');
  const required = ['REHEARSAL_BINDINGS.json', 'source/tools/v2/rehearsal-package.mjs', 'source/tools/v2/rehearsal-package.d.mts',
    'source/tools/v2/rehearsal-resolution-guard.mjs', 'source/tools/v2/isolated-pg.ts', 'source/tools/db/rebuild-test.ts', 'source/tools/db/afl-api-ownership-census.ts',
    'source/src/lib/rollover/afl-api-ownership-census.ts', 'source/tools/db/ladder-successor.ts', 'source/src/lib/rollover/ladder-successor.ts', 'source/package.json', 'source/package-lock.json', 'source/tsconfig.json',
    'source/tools/rebuild/fitzroy/fitzroy-contract.json', 'source/data/reference/fitzroy-accepted-baselines.json', 'source/data/reference/seasons.json'];
  if (!Array.isArray(spec.required_files) || required.some((p) => !spec.required_files.includes(p))
      || spec.required_files.some((p) => !entries.some((e) => e.path === p))) refuse('required closure membership');
  for (const e of entries) {
    if (e.path.split('/').some((n) => /^(?:\.env(?:\..*)?|\.git|\.codex|node_modules|__pycache__|\.next|site-packages)$/.test(n))) refuse('excluded package member');
    pinned(path.join(spec.package_root, e.path), e.sha256);
  }
  const binding = strictJson(io.readFileSync(path.join(spec.package_root, 'REHEARSAL_BINDINGS.json')));
  fields(binding, 'schema_version purpose implementation_basis source_subdir pair target', 'binding');
  if (binding.schema_version !== 1 || binding.purpose !== spec.purpose || binding.implementation_basis !== spec.implementation_basis
      || binding.source_subdir !== 'source' || !equal(binding.pair, spec.pair) || !equal(binding.target, target)) refuse('binding identity');
  // Selected binding paths must be present independently of the inventory author's list.
  // Genuine domain validators still prove these manifests and every artifact's semantics.
  const sourceMember = (relative) => {
    inventoryEntries(Buffer.from(`${'0'.repeat(64)}  ${relative}\n`));
    if (!entries.some((e) => e.path === `source/${relative}`)) refuse('selected input missing from package');
    return path.join(spec.source_root, relative);
  };
  const contract = strictJson(io.readFileSync(sourceMember('tools/rebuild/fitzroy/fitzroy-contract.json')));
  const register = strictJson(io.readFileSync(sourceMember('data/reference/fitzroy-accepted-baselines.json')));
  const accepted = register.baselines?.filter((b) => b.acceptance_status === 'accepted');
  const core = accepted?.[0], witness = contract.datasets?.ladder?.accepted_witness;
  if (accepted?.length !== 1 || core.snapshot_label !== binding.pair.core_snapshot_label
      || core.acquisition?.manifest_sha256 !== binding.pair.core_manifest_sha256
      || core.raw_artefacts?.artefact_set_sha256 !== binding.pair.core_artefact_set_sha256
      || witness?.snapshot_label !== binding.pair.witness_snapshot_label
      || witness?.manifest_sha256 !== binding.pair.witness_manifest_sha256) refuse('selected core/witness binding');
  for (const relative of [core.acquisition.manifest_path, witness.manifest]) {
    const manifest = strictJson(io.readFileSync(sourceMember(relative)));
    if (!Array.isArray(manifest.files) || !manifest.files.length) refuse('selected manifest has no artifact membership');
    sourceMember(`${manifest.working_directory}/${manifest.files[0].filename}`);
    for (const file of manifest.files) sourceMember(`${manifest.working_directory}/${file.filename}`);
  }
  const runtime = strictJson(pinned(spec.runtime_record, spec.runtime_record_sha256));
  const version = runtime && typeof runtime === 'object' && !Array.isArray(runtime) ? runtime.schema_version : undefined;
  const v3 = version === 3, v2 = version === 2 || v3;
  if (version !== 1 && !v2) refuse('runtime schema');
  fields(runtime, v3 ? RUNTIME_FIELDS_V3 : v2 ? RUNTIME_FIELDS_V2 : RUNTIME_FIELDS_V1, 'runtime record');
  if (!Array.isArray(runtime.roots) || !runtime.roots.length) refuse('runtime schema');
  const runtimeFiles = new Set();
  const runtimeDigests = new Map(), elfFiles = new Set(); // version 3: ELF members of the bound roots
  const ledgered = []; // absolute paths of accounted-for, never-trusted links
  for (const root of runtime.roots) {
    fields(root, v2 ? 'path files links hardlinks' : 'path files', 'runtime root'); canonical(root.path);
    if (!Array.isArray(root.files) || !root.files.length) refuse('empty runtime content evidence');
    const encoded = root.files.map((e) => { fields(e, 'path sha256', 'runtime file'); return `${e.sha256}  ${e.path}\n`; }).join('');
    const listed = inventoryEntries(Buffer.from(encoded), true);
    const ledger = v2 ? linkLedger(root) : null, groups = v2 ? hardlinkGroups(root, listed) : [];
    for (const g of groups) for (const member of g.paths) hardlinkCounts.set(path.join(root.path, member), g.nlink);
    const discovered = v2 ? [] : null;
    if (!equal(enumerate(root.path, false, discovered), listed.map((e) => e.path))) refuse('runtime membership');
    if (v2) {
      // Listed links are accounted for in both directions, exactly, and nothing more.
      discovered.sort((x, y) => (x.path < y.path ? -1 : 1));
      if (!equal(discovered, ledger)) refuse('runtime link ledger');
      for (const l of ledger) ledgered.push(path.join(root.path, l.path));
    }
    for (const e of listed) {
      const p = path.join(root.path, e.path), bytes = pinned(p, e.sha256);
      runtimeFiles.add(p);
      if (v3) { runtimeDigests.set(p, e.sha256); if (bytes.length >= 4 && bytes.readUInt32BE(0) === 0x7f454c46) elfFiles.add(p); }
    }
    if (v2) verifyGroups(root, groups, listed);
  }
  // Explicit search locations are not authority by themselves: every existing byte
  // beneath them was enumerated and pinned above. No site initialisation is allowed.
  const landmarks = v2 ? runtime.python_absent_landmarks : [];
  if (!Array.isArray(landmarks) || new Set(landmarks).size !== landmarks.length) refuse('Python absent landmarks');
  for (const key of ['node_search_roots', 'python_stdlib', 'python_dependencies']) {
    if (!Array.isArray(runtime[key]) || (key !== 'python_dependencies' && !runtime[key].length)
        || new Set(runtime[key]).size !== runtime[key].length) refuse('runtime search locations');
    for (const p of runtime[key]) {
      if (v2 && key === 'python_stdlib' && typeof p === 'string' && p.endsWith('.zip')) {
        // The startup path always lists the zip; it must be declared and proven absent below.
        if (!landmarks.includes(p)) refuse('undeclared Python zip location');
        continue;
      }
      canonical(p, key === 'python_stdlib' && p.endsWith('.zip'));
      if (!runtime.roots.some((root) => p === root.path || p.startsWith(root.path + path.sep))) refuse('unbound runtime search location');
      // zip imports cannot be checked as individual on-disk module files.
      if (p.endsWith('.zip') && io.existsSync(p)) refuse('unsupported Python zip runtime');
    }
  }
  // existsSync() reports a dangling link as missing, so absence is proven with lstat alone.
  // Declared landmarks are exactly: each zip python_stdlib lists, plus the reviewed start-up landmarks
  // that decide which prefix/venv/build layout the interpreter selects. Nothing broader is accepted.
  const startup = v2 ? pythonStartupLandmarks(runtime.python) : [];
  const provenAbsent = (p, zip) => {
    if (zip) canonical(path.dirname(p));
    else {
      // The deepest existing ancestor must be a plain directory; below it the path cannot exist.
      let dir = path.dirname(p);
      for (;;) {
        try { io.lstatSync(dir); break; } catch (error) {
          if (error?.code !== 'ENOENT' || dir === path.dirname(dir)) refuse('Python landmark absence unprovable');
          dir = path.dirname(dir);
        }
      }
      canonical(dir);
    }
    let present = true;
    try { io.lstatSync(p); } catch (error) { if (error?.code === 'ENOENT') present = false; else refuse('Python landmark absence unprovable'); }
    if (present) refuse('Python absent landmark exists');
  };
  for (const p of landmarks) {
    if (typeof p !== 'string' || !path.isAbsolute(p) || path.resolve(p) !== p || /[\x00-\x1f]/.test(p)) refuse('Python absent landmark');
    if (p.endsWith('.zip') ? !runtime.python_stdlib.includes(p) : !startup.includes(p)) refuse('Python absent landmark');
  }
  for (const p of startup) if (!landmarks.includes(p)) refuse('undeclared Python startup landmark');
  for (const p of landmarks) provenAbsent(p, p.endsWith('.zip'));
  if (v2) verifyExecutables();
  // ---- runtime record version 3: the enforced native closure ----
  // Every object is hashed here, before any spawn, so drift refuses before protected activity; the
  // auditor then enforces the same set inside every guarded process (search candidates, dlopen, the
  // main executable, every executable mapping, and exec targets including static ones).
  function verifyNativeClosure() {
    const n = runtime.native_closure;
    fields(n, 'schema_version loader auditor objects', 'native closure');
    if (n.schema_version !== 1 || !Array.isArray(n.objects) || !n.objects.length) refuse('native closure');
    fields(n.auditor, 'path sha256', 'native auditor');
    const bound = new Map();
    let previous = '';
    for (const o of n.objects) {
      fields(o, 'path sha256', 'native object');
      if (typeof o.path !== 'string' || !NATIVE_PATH.test(o.path) || !path.isAbsolute(o.path) || path.resolve(o.path) !== o.path
          || !HEX.test(o.sha256 ?? '') || o.path <= previous) refuse('native object entry');
      previous = o.path;
      bound.set(o.path, o.sha256);
    }
    for (const [p, digest] of bound) {
      pinned(p, digest); // non-link ancestors, realpath identity, regular file, exact link count, exact bytes
      if (Number(io.lstatSync(p).mode) & 0o6000) refuse('native object mode');
      if (runtimeDigests.has(p) && runtimeDigests.get(p) !== digest) refuse('native object differs from its runtime root binding');
    }
    const member = (p, digest) => bound.get(p) === digest;
    if (typeof n.loader !== 'string' || !bound.has(n.loader) || !member(n.auditor.path, n.auditor.sha256)
        || (process.platform !== 'win32' && !AUDITOR_PATH.test(n.auditor.path))) refuse('native loader/auditor unbound');
    for (const e of runtime.executables) if (!member(e.path, e.sha256)) refuse('bound executable outside the native closure');
    // Every ELF member of a bound root (esbuild, the cluster client tools, compiled extensions).
    for (const p of elfFiles) if (!member(p, runtimeDigests.get(p))) refuse('runtime ELF file outside the native closure');
    const text = nativePolicyText(n);
    return { native_auditor: n.auditor.path, native_auditor_sha256: n.auditor.sha256, native_policy_sha256: hash(Buffer.from(text)) };
  }
  const native = v3 ? verifyNativeClosure() : null;
  const bound = v2 ? [runtime.tsx_loader, runtime.esbuild_binary]
    : [runtime.node, runtime.tsx_loader, runtime.esbuild_binary, runtime.python, runtime.listener_tool];
  if (!bound.every((p) => runtimeFiles.has(p))
      || !['psql', 'pg_dump', 'pg_restore'].every((n) => runtimeFiles.has(path.join(runtime.pg_bin, process.platform === 'win32' ? `${n}.exe` : n)))
      || hash(io.readFileSync(path.join(spec.source_root, 'package-lock.json'))) !== runtime.lockfile_sha256) refuse('unbound executable/loader/lockfile');
  const listenerName = process.platform === 'win32' ? 'powershell.exe' : 'ss';
  if (path.basename(runtime.listener_tool) !== listenerName) refuse('unbound live-isolation listener tool');
  const systemRoot = process.platform === 'win32' ? path.resolve(runtime.listener_tool, '..', '..', '..', '..') : undefined;
  if (systemRoot && path.join(systemRoot, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe') !== runtime.listener_tool) refuse('listener tool resolution');
  if (v2) {
    // No runtime path may be, or lie beneath, a link that was merely accounted for.
    const used = [runtime.node, runtime.tsx_loader, runtime.esbuild_binary, runtime.python, runtime.listener_tool, runtime.pg_bin,
      ...runtime.node_search_roots, ...runtime.python_stdlib, ...runtime.python_dependencies];
    if (ledgered.some((l) => used.some((p) => overlaps(l, p)))) refuse('runtime path through an inert link');
  }
  const executables = v2 ? runtime.executables : [];
  const protectedRoots = [spec.package_root, request.specPath, spec.launcher_path, spec.runtime_record, ...runtime.roots.map((r) => r.path),
    ...executables.map((e) => e.path), ...(v3 ? runtime.native_closure.objects.map((o) => o.path) : [])];
  const writes = [spec.capture_root, spec.output_root, spec.temp_root, spec.cluster_root];
  for (const p of writes) canonical(p, true);
  for (const a of writes) for (const b of [...protectedRoots, ...writes.filter((p) => p !== a)]) {
    if (overlaps(a, b) || overlaps(b, a)) refuse('writable root overlap');
  }
  if (new Set(writes).size !== writes.length) refuse('writable root overlap');
  for (const p of [request.specPath, spec.launcher_path, spec.runtime_record, ...runtime.roots.map((r) => r.path), ...executables.map((e) => e.path)]) {
    if (overlaps(spec.package_root, p) || overlaps(p, spec.package_root)) refuse('external trust material overlaps package');
  }
  pinned(spec.launcher_path, spec.launcher_sha256);
  if (!io.readFileSync(spec.launcher_path).equals(io.readFileSync(path.join(spec.source_root, 'tools/v2/rehearsal-package.mjs')))) refuse('external launcher differs');
  if (request.launcherPath && request.launcherPath !== spec.launcher_path) refuse('launcher location');
  if (request.sourceRoot && (request.sourceRoot !== spec.source_root || request.cwd !== spec.source_root
      || request.modulePath !== path.join(spec.source_root, 'tools/db/rebuild-test.ts'))) refuse('runner location');
  if (request.pair && !equal(request.pair, binding.pair)) refuse('resolved pair drift');
  if (request.target) {
    const t = request.target;
    if (t.database !== target.database || t.isolated?.port !== target.port || t.importIsOwnerSubstitution) refuse('resolved target drift');
    for (const dsn of [t.adminDsn, t.importDsn]) {
      let u; try { u = new URL(dsn); } catch { refuse('invalid target connection'); }
      if (!['postgres:', 'postgresql:'].includes(u.protocol) || u.hostname !== target.host || Number(u.port) !== target.port
          || decodeURIComponent(u.pathname.slice(1)) !== target.database || u.search || u.hash) refuse('target connection mismatch');
    }
  }
  const expectedOptions = ['--target', 'isolated', '--acknowledge-destroy', target.database];
  if (!equal(spec.runner_options, expectedOptions)) refuse('fixed full-runner options');
  const resolution = { files: Object.fromEntries([
    ...entries.map((e) => [path.join(spec.package_root, e.path), e.sha256]),
    ...runtime.roots.flatMap((root) => root.files.map((e) => [path.join(root.path, e.path), e.sha256])),
  ]), node_search_roots: runtime.node_search_roots, tsx_loader: runtime.tsx_loader, esbuild_binary: runtime.esbuild_binary,
  python_stdlib: runtime.python_stdlib, python_dependencies: runtime.python_dependencies, source_root: spec.source_root,
  // Version 2 only, so a version 1 policy (and its digest) is exactly what it was.
  ...(v2 ? { executables: Object.fromEntries(executables.map((e) => [e.path, e.sha256])), hardlink_counts: Object.fromEntries(hardlinkCounts) } : {}),
  // Version 3 only: which auditor every guarded process must have mapped, and the pinned policy it enforces.
  ...(native ?? {}) };
  return freezeBinding({ ...binding, spec, runtime, resolution });
}

// Python starts in isolated/no-site mode. Only its reviewed stdlib can run the
// bootstrap; that exact startup sys.path is checked before importing bootstrap helpers.
// Parent verification binds all stdlib bytes before interpreter startup. As with
// the package checkpoints, this assumes no malicious concurrent filesystem writer.
const PYTHON_GUARD = String.raw`
import sys
# A zip on the startup path would be consulted before any other import below runs. Python lists
# its zip whether or not it exists, so only a present entry refuses. Nothing path-based may run
# first: the file-system module is the interpreter's own built-in (never searched for on sys.path),
# and lstat sees a dangling link as present. Only ENOENT is absence; any other error refuses.
# Limit: interpreter start-up imports (encodings, the frozen os) precede every line here, so the
# parent's pre-launch proof of absence stays the defence for the start-up path itself.
_fs = __import__('nt' if 'nt' in sys.builtin_module_names else 'posix')
for _location in sys.path:
    if not _location.endswith('.zip'): continue
    try: _fs.lstat(_location)
    except FileNotFoundError: continue
    raise RuntimeError('Rehearsal Python resolution refused')
if sys.path != __STDLIB__: raise RuntimeError('Rehearsal Python startup path refused')
import json, os, hashlib, importlib.machinery, runpy
policy_path, pin, script = sys.argv[1:4]
with open(policy_path, 'rb') as f: raw = f.read()
if hashlib.sha256(raw).hexdigest() != pin: raise RuntimeError('Rehearsal Python policy refused')
p = json.loads(raw)
# Version 3: refuse to run unless the bound native-closure auditor is enforcing in this process.
if 'native_auditor' in p:
    _a = p['native_auditor']
    if os.environ.get('LD_AUDIT') != _a or os.environ.get('AFLDB_NATIVE_POLICY_SHA256') != p['native_policy_sha256']:
        raise RuntimeError('Rehearsal native closure refused')
    with open(_a, 'rb') as f:
        if hashlib.sha256(f.read()).hexdigest() != p['native_auditor_sha256']: raise RuntimeError('Rehearsal native closure refused')
    _ino = os.stat(_a).st_ino
    with open('/proc/self/maps') as f: _maps = [l.split(None, 5) for l in f.read().splitlines()]
    if not any(len(m) == 6 and m[5] == _a and int(m[4]) == _ino for m in _maps): raise RuntimeError('Rehearsal native closure refused')
def check(spec):
    if spec is None: return
    origin = spec.origin
    if origin in ('built-in', 'frozen'): return
    if origin is None and spec.submodule_search_locations is not None:
        for location in spec.submodule_search_locations:
            if not any(name.startswith(os.path.realpath(location) + os.sep) for name in p['files']):
                raise ImportError('Rehearsal Python namespace refused')
        return
    name = os.path.abspath(origin or '')
    if name not in p['files'] or os.path.realpath(name) != name or os.stat(name).st_nlink != 1:
        raise ImportError('Rehearsal Python resolution refused')
    with open(name, 'rb') as f: actual = hashlib.sha256(f.read()).hexdigest()
    if actual != p['files'][name]: raise ImportError('Rehearsal Python bytes refused')
# Refuse bytecode: SourceFileLoader otherwise executes an adjacent unreviewed pyc
# even when its source file was checked. -B alone only prevents writes.
def source_code(self, fullname):
    check(importlib.machinery.ModuleSpec(fullname, self, origin=self.path))
    return self.source_to_code(self.get_data(self.path), self.path)
importlib.machinery.SourceFileLoader.get_code = source_code
finders = tuple(sys.meta_path)
class Guard:
    def find_spec(self, fullname, path=None, target=None):
        for finder in finders:
            spec = finder.find_spec(fullname, path, target)
            if spec is not None:
                if isinstance(spec.loader, importlib.machinery.SourcelessFileLoader):
                    raise ImportError('Rehearsal Python bytecode refused')
                check(spec)
                return spec
sys.meta_path[:] = [Guard()]
for module in tuple(sys.modules.values()):
    spec = getattr(module, '__spec__', None)
    if spec is not None: check(spec)
sys.path[:] = p['python_stdlib'] + [p['source_root'], os.path.dirname(os.path.abspath(script))] + p['python_dependencies']
check(importlib.machinery.ModuleSpec('__main__', None, origin=os.path.abspath(script)))
sys.argv = [script] + sys.argv[4:]
runpy.run_path(script, run_name='__main__')
`;

/** Make the same startup boundary for the launcher and every runner child.
 * The external temp policy is derived from verified bytes, pinned before use and
 * retained (no cleanup/recovery). It carries paths/hashes, never credentials.
 */
export function resolutionLaunch(verified, io = fs) {
  const { spec: s, resolution: policy } = verified;
  io.mkdirSync(s.temp_root, { recursive: true });
  if (io.realpathSync(s.temp_root) !== s.temp_root || io.lstatSync(s.temp_root).isSymbolicLink()) refuse('resolution temp redirection');
  const bytes = Buffer.from(JSON.stringify(policy));
  const pin = hash(bytes);
  const location = path.join(s.temp_root, `resolution-${process.pid}-${cryptoNonce()}.json`);
  io.writeFileSync(location, bytes, { flag: 'wx', mode: 0o600 });
  const guard = path.join(s.source_root, 'tools/v2/rehearsal-resolution-guard.mjs');
  // Version 3: the auditor's policy, from the verified record only, pinned by the digest verification derived.
  let native = {};
  if (policy.native_auditor !== undefined) {
    const text = Buffer.from(nativePolicyText(verified.runtime.native_closure));
    if (hash(text) !== policy.native_policy_sha256) refuse('native policy derivation');
    const nativeLocation = path.join(s.temp_root, `native-policy-${process.pid}-${cryptoNonce()}.txt`);
    io.writeFileSync(nativeLocation, text, { flag: 'wx', mode: 0o400 });
    native = { LD_AUDIT: policy.native_auditor, AFLDB_NATIVE_POLICY: nativeLocation, AFLDB_NATIVE_POLICY_SHA256: policy.native_policy_sha256 };
  }
  return {
    nodeArgs: ['--import', pathToFileURL(guard).href],
    pythonArgs: ['-I', '-S', '-B', '-c', PYTHON_GUARD.replace('__STDLIB__', JSON.stringify(policy.python_stdlib)), location, pin],
    env: { AFLDB_RESOLUTION_POLICY: location, AFLDB_RESOLUTION_POLICY_SHA256: pin, TSX_DISABLE_CACHE: '1', ...native },
  };
}
function cryptoNonce() { return randomBytes(12).toString('hex'); }
export function assertRehearsalResolution(verified) {
  if (globalThis[Symbol.for('afldb.rehearsal.resolution')] !== hash(Buffer.from(JSON.stringify(verified.resolution)))
      || !process.execArgv.includes(pathToFileURL(path.join(verified.spec.source_root, 'tools/v2/rehearsal-resolution-guard.mjs')).href)) {
    refuse('resolution preload missing or policy mismatch');
  }
}

const LISTENER_ENV = ['AFLDB_RESOLUTION_POLICY', 'AFLDB_REHEARSAL_LISTENER_TOOL', 'AFLDB_REHEARSAL_LAUNCH_SPEC', 'AFLDB_REHEARSAL_LAUNCH_SPEC_SHA256'];
/** The live-isolation listener tool for a process that runs under the rehearsal resolution guard.
 * Returns undefined only for an ordinary process (no guard preload, no rehearsal environment), where
 * the caller keeps its existing behaviour. In a guarded process the answer is never a bare name and
 * never an environment value alone: the launch specification is verified again, in full, against the
 * original reviewed pin; that verification must reproduce the exact policy the preload installed; and
 * the environment path must be the listener its runtime record binds by content.
 * `context` and `verify` are API test seams, not a CLI or environment switch.
 */
export function guardedListenerTool(env = process.env, io = fs, verify = verifyRehearsalPackage,
  context = { anchor: globalThis[Symbol.for('afldb.rehearsal.resolution')], execArgv: process.execArgv }) {
  const guarded = context.anchor !== undefined || LISTENER_ENV.some((key) => env[key] !== undefined)
    || context.execArgv.some((arg) => /rehearsal-resolution-guard\.mjs$/.test(arg));
  if (!guarded) return undefined;
  const { AFLDB_REHEARSAL_LISTENER_TOOL: tool, AFLDB_REHEARSAL_LAUNCH_SPEC: specPath, AFLDB_REHEARSAL_LAUNCH_SPEC_SHA256: specSha256 } = env;
  if (typeof tool !== 'string' || typeof specPath !== 'string' || !HEX.test(specSha256 ?? '')) refuse('listener provenance missing');
  if (typeof context.anchor !== 'string' || !HEX.test(context.anchor)) refuse('resolution preload missing');
  const verified = verify({ specPath, specSha256, checkpoint: 'listener-tool' }, io);
  if (hash(Buffer.from(JSON.stringify(verified.resolution))) !== context.anchor) refuse('resolution policy mismatch');
  const listener = verified.runtime.listener_tool;
  if (tool !== listener || !HEX.test(verified.resolution.executables?.[listener] ?? verified.resolution.files[listener] ?? '')) refuse('unbound listener tool');
  return listener;
}

/** Runtime record version 3: the verifying process itself. It starts every guarded child, so the auditor
 * cannot already be in it. Before any spawn it must carry no loader override (no LD_* variable at all) and,
 * on Linux, every file-backed executable mapping in /proc/self/maps must be a bound closure object mapped
 * from the inode verification hashed. Anonymous and vDSO mappings are not files (the auditor's boundary).
 * Version 1/2 records are unchanged. `env`, `io` and `platform` are test seams. */
export function assertLauncherNativeImage(verified, env = process.env, io = fs, platform = process.platform) {
  const n = verified.runtime.native_closure;
  if (n === undefined) return;
  if (Object.keys(env).some((key) => key.startsWith('LD_'))) refuse('loader override in the verifying process');
  if (platform !== 'linux') return;
  const bound = new Set(n.objects.map((o) => o.path));
  for (const line of String(io.readFileSync('/proc/self/maps', 'utf8')).split('\n')) {
    const m = line.trim().split(/\s+/);
    if (m.length < 6 || !m[1].includes('x')) continue;
    const file = m.slice(5).join(' ');
    if (!file.startsWith('/')) continue;
    if (!bound.has(file) || Number(io.lstatSync(file).ino) !== Number(m[4])) refuse('verifying process maps native code outside the closure');
  }
}

/** Fixed launcher; injection is an API test seam, never a CLI bypass. */
export function launchRehearsal(request, spawn = spawnSync, io = fs, launcherEnv = process.env) {
  request = freezeBinding(structuredClone(request)); // Keep the original reviewed pins through terminal readback.
  const verified = verifyRehearsalPackage(request, io);
  const { spec: s, runtime: r } = verified;
  if (r.node !== process.execPath) refuse('bootstrap interpreter is not the reviewed Node executable');
  assertLauncherNativeImage(verified, launcherEnv, io);
  const options = [...s.runner_options, '--rehearsal-launch-spec', request.specPath, '--rehearsal-launch-spec-sha256', request.specSha256];
  const enforcement = resolutionLaunch(verified, io);
  const args = [...enforcement.nodeArgs, path.join(s.source_root, 'tools/v2/isolated-pg.ts'), 'run', s.target.database, '--',
    r.node, ...enforcement.nodeArgs, path.join(s.source_root, 'tools/db/rebuild-test.ts'), ...options];
  // No ambient module/loader/Python/R search paths, executable shims, or inherited overrides.
  // PATH is the cluster client directory only: the listener tool and both interpreters are invoked by
  // their bound absolute paths, so neither /usr/bin nor any executable's parent directory is searched.
  const env = {
    ...enforcement.env,
    PATH: r.pg_bin, AFLDB_PYTHON: r.python,
    AFLDB_REHEARSAL_LISTENER_TOOL: r.listener_tool, AFLDB_REHEARSAL_LAUNCH_SPEC: request.specPath, AFLDB_REHEARSAL_LAUNCH_SPEC_SHA256: request.specSha256,
    AFLDB_V2_PG_ROOT: s.cluster_root, AFLDB_V2_PG_BIN: r.pg_bin, AFLDB_V2_PG_PORT: String(s.target.port),
    AFLDB_REBUILD_CAPTURE_ROOT: s.capture_root, PYTHONDONTWRITEBYTECODE: '1', PYTHONNOUSERSITE: '1',
    TMP: s.temp_root, TEMP: s.temp_root, TMPDIR: s.temp_root, XDG_CACHE_HOME: s.temp_root,
    ...(process.platform === 'win32' ? { SystemRoot: path.resolve(r.listener_tool, '..', '..', '..', '..') } : {}),
  };
  let result, failure;
  try { result = spawn(r.node, args, { cwd: s.source_root, env, shell: false, stdio: 'inherit' }); }
  catch (error) { failure = error; }
  let terminal;
  try { verifyRehearsalPackage(request, io); } catch (error) { terminal = error; }
  if (failure) throw failure;
  if (result.status !== 0) { if (terminal) process.stderr.write('Rehearsal terminal provenance refused after child failure\n'); return result.status ?? 1; }
  if (terminal) throw terminal;
  return 0;
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    if (process.execArgv.length || process.env.NODE_OPTIONS || process.env.NODE_PATH) refuse('unbound bootstrap options');
    const a = process.argv.slice(2);
    if (a.length !== 4 || a[0] !== '--launch-spec' || a[2] !== '--launch-spec-sha256') refuse('usage: --launch-spec <absolute-file> --launch-spec-sha256 <reviewed-digest>');
    process.exitCode = launchRehearsal({ specPath: a[1], specSha256: a[3], checkpoint: 'external-launch', launcherPath: fileURLToPath(import.meta.url) });
  } catch { process.stderr.write('Rehearsal launcher refused; no successful provenance result\n'); process.exitCode = 2; }
}
