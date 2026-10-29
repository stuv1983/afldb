/**
 * @afldb/testing — AFLDB V2 plan D1 module-boundary checker (review resolutions R-009, R-010).
 *
 * ESLint `no-restricted-imports` (eslint.config.mjs) matches import SPECIFIERS, so a relative
 * escape such as `../../packages/acquisition/src/x` slips past a pattern written for
 * `@afldb/acquisition`. This checker resolves every specifier to a repository path first and
 * then applies the dependency direction, so tests/v2-module-boundaries.test.ts catches both.
 *
 * Dependency direction (docs/v2/plan.md §3 D1, §7 R-010):
 *   domain      → nothing internal (and its transitive closure is pure: no DB, framework or IO)
 *   db          → domain
 *   acquisition → domain, db
 *   derived     → domain, db
 *   admin       → domain, db
 *   testing     → any package; only tests/** (and testing itself) may import @afldb/testing
 *   src/app/**, src/components/** → never @afldb/acquisition, @afldb/testing or legacy/**
 *   nothing outside legacy/** imports legacy/**
 *   `@afldb/<module>/<subpath>` is forbidden everywhere: import the package index.
 *
 * Pure apart from the lazily-loaded `typescript` parser and the caller-supplied file reader,
 * so it can be exercised on in-memory fixtures as well as on the real tree.
 */
import { createRequire } from 'node:module';
import { posix } from 'node:path';

export const PACKAGE_MODULES = ['domain', 'db', 'acquisition', 'derived', 'admin', 'testing'] as const;
export type PackageModule = (typeof PACKAGE_MODULES)[number];

export const ALLOWED_PACKAGE_DEPENDENCIES: Readonly<Record<PackageModule, readonly PackageModule[]>> = {
  domain: [],
  db: ['domain'],
  acquisition: ['domain', 'db'],
  derived: ['domain', 'db'],
  admin: ['domain', 'db'],
  testing: ['domain', 'db', 'acquisition', 'derived', 'admin'],
};

export type Layer =
  | { kind: 'package'; module: PackageModule }
  | { kind: 'web' }
  | { kind: 'tests' }
  | { kind: 'legacy' }
  | { kind: 'other' };

export type ResolvedImport =
  | { kind: 'package'; module: string; subpath: boolean }
  | { kind: 'file'; path: string }
  | { kind: 'external'; name: string };

export interface SourceFile {
  /** Repository-relative POSIX path, e.g. `packages/db/src/index.ts`. */
  path: string;
  source: string;
}

export interface BoundaryViolation {
  file: string;
  specifier: string;
  rule: string;
}

function isPackageModule(value: string): value is PackageModule {
  return (PACKAGE_MODULES as readonly string[]).includes(value);
}

/** Which architectural layer a repository-relative path belongs to. */
export function layerOf(path: string): Layer {
  const p = path.replace(/\\/g, '/');
  const pkg = /^packages\/([^/]+)\//.exec(p);
  if (pkg && isPackageModule(pkg[1])) return { kind: 'package', module: pkg[1] };
  if (p.startsWith('src/app/') || p.startsWith('src/components/')) return { kind: 'web' };
  if (p.startsWith('tests/')) return { kind: 'tests' };
  if (p.startsWith('legacy/')) return { kind: 'legacy' };
  return { kind: 'other' };
}

/** Every module specifier a TypeScript/JavaScript source imports, re-exports, requires or loads. */
export function extractImportSpecifiers(source: string): string[] {
  const require = createRequire(import.meta.url);
  const ts = require('typescript') as typeof import('typescript');
  const info = ts.preProcessFile(source, true, true);
  return info.importedFiles.map((f) => f.fileName);
}

/** Resolve a specifier written in `fromPath` to a package, a repository path, or an external name. */
export function resolveSpecifier(fromPath: string, specifier: string): ResolvedImport {
  const pkg = /^@afldb\/([^/]+)(\/.*)?$/.exec(specifier);
  if (pkg) return { kind: 'package', module: pkg[1], subpath: Boolean(pkg[2]) };
  if (specifier.startsWith('@/')) return { kind: 'file', path: posix.normalize(`src/${specifier.slice(2)}`) };
  if (specifier.startsWith('./') || specifier.startsWith('../')) {
    const from = fromPath.replace(/\\/g, '/');
    return { kind: 'file', path: posix.normalize(posix.join(posix.dirname(from), specifier)) };
  }
  return { kind: 'external', name: specifier };
}

/** The rule a single import breaks, or null when it is allowed. */
export function boundaryRuleBroken(fromPath: string, resolved: ResolvedImport): string | null {
  const from = layerOf(fromPath);

  if (resolved.kind === 'package') {
    if (!isPackageModule(resolved.module)) return `@afldb/${resolved.module} is not a declared V2 module`;
    if (resolved.subpath) return `subpath import of @afldb/${resolved.module} is forbidden; import the package index`;
    if (resolved.module === 'testing' && from.kind !== 'tests'
      && !(from.kind === 'package' && from.module === 'testing')) {
      return 'only tests/** may import @afldb/testing';
    }
    if (from.kind === 'web' && resolved.module === 'acquisition') {
      return 'src/app and src/components must not import @afldb/acquisition';
    }
    if (from.kind === 'package' && resolved.module !== from.module
      && !ALLOWED_PACKAGE_DEPENDENCIES[from.module].includes(resolved.module)) {
      return `@afldb/${from.module} may not depend on @afldb/${resolved.module}`;
    }
    return null;
  }

  if (resolved.kind === 'file') {
    const target = layerOf(resolved.path);
    if (target.kind === 'legacy' && from.kind !== 'legacy') return 'only legacy/** may import legacy/**';
    if (target.kind === 'package' && !(from.kind === 'package' && from.module === target.module)) {
      // A relative or `@/`-style path into a package bypasses its index and the alias rules.
      return `import packages/${target.module} through @afldb/${target.module}, not by path`;
    }
    if (from.kind === 'package' && (target.kind === 'web' || target.kind === 'tests')) {
      return `@afldb/${from.module} may not import ${resolved.path.split('/').slice(0, 2).join('/')}`;
    }
  }
  return null;
}

/** All boundary violations in a set of files. */
export function checkBoundaries(files: readonly SourceFile[]): BoundaryViolation[] {
  const violations: BoundaryViolation[] = [];
  for (const file of files) {
    for (const specifier of extractImportSpecifiers(file.source)) {
      const rule = boundaryRuleBroken(file.path, resolveSpecifier(file.path, specifier));
      if (rule) violations.push({ file: file.path, specifier, rule });
    }
  }
  return violations;
}

/** Modules the pure domain closure may never reach. */
export const IMPURE_EXTERNALS: readonly RegExp[] = [
  /^postgres$/, /^server-only$/, /^next(\/|$)/, /^react(-dom)?(\/|$)/,
  /^(node:)?(fs|fs\/promises|child_process|net|http|https|dgram|tls)$/,
];
const IMPURE_PATHS: readonly RegExp[] = [/^src\/db\//, /^src\/app\//, /^src\/components\//, /^tools\//, /^legacy\//];

const CANDIDATE_SUFFIXES = ['', '.ts', '.tsx', '/index.ts', '/index.tsx'];

/**
 * Walk the transitive file closure of `entry` (resolving `@/`, relative and `@afldb/*` imports)
 * and report every impure module it reaches. `readFile` returns null for a missing path.
 */
export function purityViolations(
  entry: string,
  readFile: (path: string) => string | null,
): BoundaryViolation[] {
  const violations: BoundaryViolation[] = [];
  const seen = new Set<string>();
  const queue = [entry];
  while (queue.length > 0) {
    const path = queue.shift() as string;
    if (seen.has(path)) continue;
    seen.add(path);
    const source = readFile(path);
    if (source === null) {
      violations.push({ file: path, specifier: path, rule: 'unresolvable module in the pure closure' });
      continue;
    }
    for (const specifier of extractImportSpecifiers(source)) {
      const resolved = resolveSpecifier(path, specifier);
      if (resolved.kind === 'external') {
        if (IMPURE_EXTERNALS.some((re) => re.test(resolved.name))) {
          violations.push({ file: path, specifier, rule: `the pure closure reaches ${resolved.name}` });
        }
        continue;
      }
      const base = resolved.kind === 'package' ? `packages/${resolved.module}/src/index` : resolved.path;
      if (IMPURE_PATHS.some((re) => re.test(base))) {
        violations.push({ file: path, specifier, rule: `the pure closure reaches ${base}` });
        continue;
      }
      const found = CANDIDATE_SUFFIXES.map((s) => `${base}${s}`).find((c) => readFile(c) !== null);
      if (found) queue.push(found);
      else violations.push({ file: path, specifier, rule: 'unresolvable module in the pure closure' });
    }
  }
  return violations;
}

// ---------------------------------------------------------------------------------------------
// Stage 4 (plan D10, ADR 0010, R-006): legacy quarantine and runtime-independence guards.
// Every function below is pure apart from the caller-supplied reader. NOTE: these are not yet
// re-exported from ./index (that file is owned by another workstream in this launch);
// tests/v2-module-boundaries.test.ts imports them from this module directly.
// ---------------------------------------------------------------------------------------------

/**
 * The legacy runtime modules: the Squiggle/Kali refresh and the AFL Tables ingestion/settle code
 * that the V2 plan keeps only behind named dispositions (docs/v2/legacy-disposition.md). The
 * ratchet in tests/v2-module-boundaries.test.ts pins every direct importer of these files.
 */
export const LEGACY_RUNTIME_MODULES: readonly string[] = [
  'src/lib/external-afl/current-matches.ts',
  'src/lib/external-afl/current-season-import.ts',
  'src/lib/ingest/pipeline.ts',
  'src/lib/ingest/datasets.ts',
  'src/lib/acquisition/settle-afltables.ts',
  'src/lib/acquisition/settle-trigger.ts',
];

/** Offline tool trees that no runtime source (src/**, packages/<m>/src/**) may import. */
export const OFFLINE_TOOL_PREFIXES: readonly string[] = [
  'tools/migration/', 'tools/rebuild/', 'tools/records/', 'tools/aflw/', 'tools/email_intake/', 'legacy/',
];

export interface ImportEdge {
  from: string;
  to: string;
  specifier: string;
}

/**
 * The existing repository file a specifier written in `fromPath` points at, or null for an
 * external package, a missing file or an asset. `@afldb/<module>` resolves to its package index.
 */
export function resolveImportFile(
  fromPath: string,
  specifier: string,
  readFile: (path: string) => string | null,
): string | null {
  const resolved = resolveSpecifier(fromPath, specifier);
  if (resolved.kind === 'external') return null;
  const base = resolved.kind === 'package' ? `packages/${resolved.module}/src/index` : resolved.path;
  return CANDIDATE_SUFFIXES.map((s) => `${base}${s}`).find((c) => readFile(c) !== null) ?? null;
}

/**
 * Every direct import of one of `modules` from a file that is not itself one of `modules`,
 * sorted by importer then target. Callers exclude tests/** from `files`.
 */
export function legacyRuntimeEdges(
  files: readonly SourceFile[],
  readFile: (path: string) => string | null,
  modules: readonly string[] = LEGACY_RUNTIME_MODULES,
): ImportEdge[] {
  const edges: ImportEdge[] = [];
  for (const file of files) {
    if (modules.includes(file.path)) continue;
    for (const specifier of extractImportSpecifiers(file.source)) {
      const to = resolveImportFile(file.path, specifier, readFile);
      if (to && modules.includes(to)) edges.push({ from: file.path, to, specifier });
    }
  }
  return edges.sort((a, b) => (a.from + a.to).localeCompare(b.from + b.to));
}

/** A forbidden file reached from a public runtime entry, with the import chain that reaches it. */
export interface RuntimeReach {
  entry: string;
  reached: string;
  chain: string[];
}

/**
 * Walk the transitive import closure of `entries` and report every file in it that is a legacy
 * runtime module, or lives under `tools/` or `legacy/`. One breadth-first search with a shared
 * visited set (each file is read once); `chain` is the shortest path found from an entry.
 */
export function publicRuntimeLegacyReach(
  entries: readonly string[],
  readFile: (path: string) => string | null,
  modules: readonly string[] = LEGACY_RUNTIME_MODULES,
): RuntimeReach[] {
  const parent = new Map<string, string | null>();
  const queue: string[] = [];
  for (const entry of entries) {
    parent.set(entry, null);
    queue.push(entry);
  }
  const reaches: RuntimeReach[] = [];
  const chainOf = (path: string): string[] => {
    const chain: string[] = [];
    for (let at: string | null | undefined = path; at; at = parent.get(at)) chain.unshift(at);
    return chain;
  };
  for (let i = 0; i < queue.length; i += 1) {
    const path = queue[i];
    if (modules.includes(path) || path.startsWith('tools/') || path.startsWith('legacy/')) {
      const chain = chainOf(path);
      reaches.push({ entry: chain[0], reached: path, chain });
      continue;
    }
    const source = readFile(path);
    if (source === null) continue;
    for (const specifier of extractImportSpecifiers(source)) {
      const to = resolveImportFile(path, specifier, readFile);
      if (to && !parent.has(to)) {
        parent.set(to, path);
        queue.push(to);
      }
    }
  }
  return reaches;
}

/**
 * Runtime sources (src/**, packages/<module>/src/**) that import an offline tool tree. Resolved by
 * path, so a relative escape such as `../../tools/rebuild/x` is caught like an `@/` import.
 */
export function offlineToolImports(files: readonly SourceFile[]): BoundaryViolation[] {
  const violations: BoundaryViolation[] = [];
  for (const file of files) {
    if (!/^(src\/|packages\/[^/]+\/src\/)/.test(file.path)) continue;
    for (const specifier of extractImportSpecifiers(file.source)) {
      const resolved = resolveSpecifier(file.path, specifier);
      if (resolved.kind === 'file' && OFFLINE_TOOL_PREFIXES.some((p) => resolved.path.startsWith(p))) {
        violations.push({ file: file.path, specifier, rule: `runtime code must not import the offline tree ${resolved.path}` });
      }
    }
  }
  return violations;
}

const LEGACY_PATH_REFERENCE = /(^|[^A-Za-z0-9_-])legacy\//;

/**
 * Anything scheduled or deployed that names `legacy/`: a `package.json` script, or a line of a
 * `deploy/` file (systemd unit/timer, shell, PowerShell, Caddy, supervisor). Quarantined tools
 * are run by hand only.
 */
export function scheduledLegacyReferences(
  packageJsonText: string,
  deployFiles: readonly SourceFile[],
): string[] {
  const found: string[] = [];
  const scripts = (JSON.parse(packageJsonText) as { scripts?: Record<string, string> }).scripts ?? {};
  for (const [name, command] of Object.entries(scripts)) {
    if (LEGACY_PATH_REFERENCE.test(command)) found.push(`package.json script ${name}: ${command}`);
  }
  for (const file of deployFiles) {
    file.source.split(/\r?\n/).forEach((line, index) => {
      if (LEGACY_PATH_REFERENCE.test(line)) found.push(`${file.path}:${index + 1}: ${line.trim()}`);
    });
  }
  return found;
}

export interface RetiredEntryWiring {
  /** Scripts that run the retired-entry CLI with a name that is not in the registry. */
  unregistered: string[];
  /** Scripts whose key differs from the registry name they pass to the CLI. */
  mismatched: string[];
  /** Registry entries no script runs. */
  orphans: string[];
}

const RETIRED_ENTRY_CLI = /tools\/v2\/retired-entry\.ts\s+(\S+)/;

/** Cross-check `package.json` scripts against the retirement registry, in both directions. */
export function retiredEntryWiring(
  packageJsonText: string,
  registeredNames: readonly string[],
): RetiredEntryWiring {
  const scripts = (JSON.parse(packageJsonText) as { scripts?: Record<string, string> }).scripts ?? {};
  const wired = new Set<string>();
  const wiring: RetiredEntryWiring = { unregistered: [], mismatched: [], orphans: [] };
  for (const [scriptName, command] of Object.entries(scripts)) {
    const named = RETIRED_ENTRY_CLI.exec(command)?.[1];
    if (named === undefined) continue;
    if (!registeredNames.includes(named)) wiring.unregistered.push(`${scriptName} -> ${named}`);
    else if (named !== scriptName) wiring.mismatched.push(`${scriptName} -> ${named}`);
    else wired.add(named);
  }
  wiring.orphans = registeredNames.filter((name) => !wired.has(name));
  return wiring;
}
