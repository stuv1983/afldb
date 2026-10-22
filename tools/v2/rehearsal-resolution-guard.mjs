/** ISSUE-316: trusted preload, not an application sandbox. Bound by package inventory.
 * Both Node hook contexts enforce file membership and raw bytes, including tsx itself.
 * Reviewed code must not deliberately unregister hooks or execute arbitrary bytes via vm.
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { register, registerHooks, isBuiltin, createRequire } from 'node:module';
import { isMainThread } from 'node:worker_threads';

const digest = (bytes) => createHash('sha256').update(bytes).digest('hex');
const refuse = () => { throw new Error('Rehearsal resolution refused'); };
let policy;
function checked(url) {
  if (isBuiltin(url)) return;
  if (!url.startsWith('file:')) refuse();
  const p = fileURLToPath(url);
  const expected = policy.files[p];
  const st = fs.lstatSync(p);
  // Only an explicitly declared, fully enumerated runtime hard-link group (policy version 2) may exceed 1.
  if (!expected || !st.isFile() || st.nlink !== (policy.hardlink_counts?.[p] ?? 1) || fs.realpathSync(p) !== p
      || digest(fs.readFileSync(p)) !== expected) refuse();
}
function bare(s) { return !s.startsWith('.') && !s.startsWith('/') && !/^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(s) && !s.startsWith('#'); }
function contexts(s, context) {
  // Normal resolution still handles inventoried workspace exports/tsx aliases. An
  // otherwise resolvable ambient module is refused, never silently replaced.
  return [context, ...(bare(s) ? policy.node_search_roots.map((p) => ({ ...context,
    parentURL: pathToFileURL(path.join(p, '__rehearsal_resolve__.mjs')).href })) : [])];
}
function syncResolve(s, c, next) {
  let result;
  try { result = next(s, c); } catch (e) { if (e.code !== 'ERR_MODULE_NOT_FOUND' && e.code !== 'MODULE_NOT_FOUND') throw e; }
  if (result) { checked(result.url); return result; }
  // Node 22's CJS default resolver ignores an overridden context.parentURL.
  // A createRequire at the explicit bound anchor supplies the actual CJS parent.
  if (bare(s) && !policy.node_search_roots.some((p) => c.parentURL === pathToFileURL(path.join(p, '__rehearsal_resolve__.mjs')).href)) {
    for (const p of policy.node_search_roots) {
      try {
        const found = createRequire(path.join(p, '__rehearsal_resolve__.mjs')).resolve(s);
        const url = isBuiltin(found) ? `node:${found}` : pathToFileURL(found).href;
        checked(url); return { url, shortCircuit: true };
      } catch (e) { if (e.code !== 'MODULE_NOT_FOUND') throw e; }
    }
  }
  const error = new Error('Rehearsal resolution refused');
  if (policy.node_search_roots.some((p) => c.parentURL === pathToFileURL(path.join(p, '__rehearsal_resolve__.mjs')).href)) error.code = 'MODULE_NOT_FOUND';
  throw error;
}
export function initialize(data) { policy = data; }
export async function resolve(s, c, next) {
  for (const context of contexts(s, c)) {
    let result;
    try { result = await next(s, context); } catch (e) { if (e.code === 'ERR_MODULE_NOT_FOUND' || e.code === 'MODULE_NOT_FOUND') continue; throw e; }
    checked(result.url); return result;
  }
  refuse();
}
export async function load(url, c, next) { checked(url); return next(url, c); }
export async function installResolutionGuard(data) {
  if (typeof registerHooks !== 'function') refuse(); // No version-only/probe fallback.
  policy = data;
  checked(pathToFileURL(data.esbuild_binary).href);
  process.env.ESBUILD_BINARY_PATH = data.esbuild_binary;
  process.env.TSX_DISABLE_CACHE = '1';
  registerHooks({ resolve: syncResolve });
  // Node's async loader worker has a separate module graph and hook chain.
  register(import.meta.url, { parentURL: import.meta.url, data });
  await import(pathToFileURL(data.tsx_loader).href);
  // tsx installs hooks of its own. Keep an outer guard on the final resolved URL
  // as well as the inner guard protecting the loader's dependencies.
  registerHooks({ resolve: syncResolve });
  register(import.meta.url, { parentURL: import.meta.url, data });
  Object.defineProperty(globalThis, Symbol.for('afldb.rehearsal.resolution'), { value: digest(Buffer.from(JSON.stringify(data))) });
}
if (isMainThread && process.execArgv.some((v) => v === fileURLToPath(import.meta.url) || v === import.meta.url)) {
  const bytes = fs.readFileSync(process.env.AFLDB_RESOLUTION_POLICY);
  if (digest(bytes) !== process.env.AFLDB_RESOLUTION_POLICY_SHA256) refuse();
  await installResolutionGuard(JSON.parse(bytes));
}
