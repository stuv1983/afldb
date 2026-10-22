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
export function verifyRehearsalPackage(request, io = fs) {
  // Only request.specSha256 (from the reviewed launch instruction) establishes initial trust.
  if (!HEX.test(request.specSha256 ?? '')) refuse('missing external specification pin');
  const checkedPaths = new Set(); // One complete traversal per call, never across checkpoints.
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
    if (st.isSymbolicLink() || (!st.isFile() && !st.isDirectory()) || (st.isFile() && st.nlink !== 1)
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
  function enumerate(root, packageTree = false) {
    const found = [];
    function walk(dir, prefix) {
      canonical(dir);
      for (const name of io.readdirSync(dir).sort()) {
        if (packageTree && /^(?:\.env(?:\..*)?|\.git|\.codex|node_modules|__pycache__|\.next|site-packages)$/.test(name)) refuse('excluded package member');
        if (!(packageTree ? /^[a-zA-Z0-9_.-]+$/ : /^[a-zA-Z0-9_@+.-]+$/).test(name) || name === '.' || name === '..') refuse('unsupported file name');
        const rel = prefix + name, abs = path.join(dir, name);
        canonical(abs);
        if (io.lstatSync(abs).isDirectory()) walk(abs, rel + '/'); else found.push(rel);
      }
    }
    walk(root, ''); return found.sort();
  }
  if (!equal(enumerate(spec.package_root, true).filter((n) => n !== 'SHA256SUMS.txt'), entries.map((e) => e.path))) refuse('package membership');
  const required = ['REHEARSAL_BINDINGS.json', 'source/tools/v2/rehearsal-package.mjs', 'source/tools/v2/rehearsal-package.d.mts',
    'source/tools/v2/rehearsal-resolution-guard.mjs', 'source/tools/v2/isolated-pg.ts', 'source/tools/db/rebuild-test.ts', 'source/tools/db/afl-api-ownership-census.ts',
    'source/src/lib/rollover/afl-api-ownership-census.ts', 'source/package.json', 'source/package-lock.json', 'source/tsconfig.json',
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
  fields(runtime, 'schema_version roots node tsx_loader node_search_roots esbuild_binary python python_stdlib python_dependencies pg_bin listener_tool lockfile_sha256', 'runtime record');
  if (runtime.schema_version !== 1 || !Array.isArray(runtime.roots) || !runtime.roots.length) refuse('runtime schema');
  const runtimeFiles = new Set();
  for (const root of runtime.roots) {
    fields(root, 'path files', 'runtime root'); canonical(root.path);
    if (!Array.isArray(root.files) || !root.files.length) refuse('empty runtime content evidence');
    const encoded = root.files.map((e) => { fields(e, 'path sha256', 'runtime file'); return `${e.sha256}  ${e.path}\n`; }).join('');
    const listed = inventoryEntries(Buffer.from(encoded), true);
    if (!equal(enumerate(root.path), listed.map((e) => e.path))) refuse('runtime membership');
    for (const e of listed) { const p = path.join(root.path, e.path); pinned(p, e.sha256); runtimeFiles.add(p); }
  }
  // Explicit search locations are not authority by themselves: every existing byte
  // beneath them was enumerated and pinned above. No site initialisation is allowed.
  for (const key of ['node_search_roots', 'python_stdlib', 'python_dependencies']) {
    if (!Array.isArray(runtime[key]) || (key !== 'python_dependencies' && !runtime[key].length)
        || new Set(runtime[key]).size !== runtime[key].length) refuse('runtime search locations');
    for (const p of runtime[key]) {
      canonical(p, key === 'python_stdlib' && p.endsWith('.zip'));
      if (!runtime.roots.some((root) => p === root.path || p.startsWith(root.path + path.sep))) refuse('unbound runtime search location');
      // zip imports cannot be checked as individual on-disk module files.
      if (p.endsWith('.zip') && io.existsSync(p)) refuse('unsupported Python zip runtime');
    }
  }
  if (![runtime.node, runtime.tsx_loader, runtime.esbuild_binary, runtime.python, runtime.listener_tool].every((p) => runtimeFiles.has(p))
      || !['psql', 'pg_dump', 'pg_restore'].every((n) => runtimeFiles.has(path.join(runtime.pg_bin, process.platform === 'win32' ? `${n}.exe` : n)))
      || hash(io.readFileSync(path.join(spec.source_root, 'package-lock.json'))) !== runtime.lockfile_sha256) refuse('unbound executable/loader/lockfile');
  const listenerName = process.platform === 'win32' ? 'powershell.exe' : 'ss';
  if (path.basename(runtime.listener_tool) !== listenerName) refuse('unbound live-isolation listener tool');
  const systemRoot = process.platform === 'win32' ? path.resolve(runtime.listener_tool, '..', '..', '..', '..') : undefined;
  if (systemRoot && path.join(systemRoot, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe') !== runtime.listener_tool) refuse('listener tool resolution');
  const protectedRoots = [spec.package_root, request.specPath, spec.launcher_path, spec.runtime_record, ...runtime.roots.map((r) => r.path)];
  const writes = [spec.capture_root, spec.output_root, spec.temp_root, spec.cluster_root];
  const overlaps = (a, b) => { const r = path.relative(a, b); return r === '' || (!r.startsWith('..' + path.sep) && r !== '..' && !path.isAbsolute(r)); };
  for (const p of writes) canonical(p, true);
  for (const a of writes) for (const b of [...protectedRoots, ...writes.filter((p) => p !== a)]) {
    if (overlaps(a, b) || overlaps(b, a)) refuse('writable root overlap');
  }
  if (new Set(writes).size !== writes.length) refuse('writable root overlap');
  for (const p of [request.specPath, spec.launcher_path, spec.runtime_record, ...runtime.roots.map((r) => r.path)]) {
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
  python_stdlib: runtime.python_stdlib, python_dependencies: runtime.python_dependencies, source_root: spec.source_root };
  return freezeBinding({ ...binding, spec, runtime, resolution });
}

// Python starts in isolated/no-site mode. Only its reviewed stdlib can run the
// bootstrap; that exact startup sys.path is checked before importing bootstrap helpers.
// Parent verification binds all stdlib bytes before interpreter startup. As with
// the package checkpoints, this assumes no malicious concurrent filesystem writer.
const PYTHON_GUARD = String.raw`
import sys
if sys.path != __STDLIB__: raise RuntimeError('Rehearsal Python startup path refused')
import json, os, hashlib, importlib.machinery, runpy
policy_path, pin, script = sys.argv[1:4]
with open(policy_path, 'rb') as f: raw = f.read()
if hashlib.sha256(raw).hexdigest() != pin: raise RuntimeError('Rehearsal Python policy refused')
p = json.loads(raw)
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
  return {
    nodeArgs: ['--import', pathToFileURL(guard).href],
    pythonArgs: ['-I', '-S', '-B', '-c', PYTHON_GUARD.replace('__STDLIB__', JSON.stringify(policy.python_stdlib)), location, pin],
    env: { AFLDB_RESOLUTION_POLICY: location, AFLDB_RESOLUTION_POLICY_SHA256: pin, TSX_DISABLE_CACHE: '1' },
  };
}
function cryptoNonce() { return randomBytes(12).toString('hex'); }
export function assertRehearsalResolution(verified) {
  if (globalThis[Symbol.for('afldb.rehearsal.resolution')] !== hash(Buffer.from(JSON.stringify(verified.resolution)))
      || !process.execArgv.includes(pathToFileURL(path.join(verified.spec.source_root, 'tools/v2/rehearsal-resolution-guard.mjs')).href)) {
    refuse('resolution preload missing or policy mismatch');
  }
}

/** Fixed launcher; injection is an API test seam, never a CLI bypass. */
export function launchRehearsal(request, spawn = spawnSync, io = fs) {
  request = freezeBinding(structuredClone(request)); // Keep the original reviewed pins through terminal readback.
  const verified = verifyRehearsalPackage(request, io);
  const { spec: s, runtime: r } = verified;
  if (r.node !== process.execPath) refuse('bootstrap interpreter is not the reviewed Node executable');
  const options = [...s.runner_options, '--rehearsal-launch-spec', request.specPath, '--rehearsal-launch-spec-sha256', request.specSha256];
  const enforcement = resolutionLaunch(verified, io);
  const args = [...enforcement.nodeArgs, path.join(s.source_root, 'tools/v2/isolated-pg.ts'), 'run', s.target.database, '--',
    r.node, ...enforcement.nodeArgs, path.join(s.source_root, 'tools/db/rebuild-test.ts'), ...options];
  // No ambient module/loader/Python/R search paths, executable shims, or inherited overrides.
  const env = {
    ...enforcement.env,
    PATH: [r.pg_bin, path.dirname(r.listener_tool)].join(path.delimiter), AFLDB_PYTHON: r.python,
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
