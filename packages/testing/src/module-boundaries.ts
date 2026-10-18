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
