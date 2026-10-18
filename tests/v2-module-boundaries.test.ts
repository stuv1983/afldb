/**
 * AFLDB V2 plan D1 (review resolutions R-009, R-010) — module boundaries.
 *
 * Three independent proofs, all DB-free:
 *   1. the checker (@afldb/testing) flags each forbidden import shape on in-memory fixtures,
 *      including relative-path escapes that ESLint's specifier patterns cannot see;
 *   2. the real tree (src, tools, packages, deploy) has no violation, and the transitive closure
 *      of @afldb/domain reaches no database, framework or IO module;
 *   3. ESLint's `no-restricted-imports` rules (eslint.config.mjs) fire on forbidden imports and
 *      stay silent on allowed ones.
 * Plus: every `@afldb/<module>` alias resolves in vitest to the package index.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

import { ESLint } from 'eslint';
import { describe, expect, it } from 'vitest';

import {
  PACKAGE_MODULES,
  boundaryRuleBroken,
  checkBoundaries,
  purityViolations,
  resolveSpecifier,
  type SourceFile,
} from '@afldb/testing';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

function rel(path: string): string {
  return relative(ROOT, path).split(sep).join('/');
}

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    if (name === 'node_modules' || name === '__pycache__' || name.startsWith('.')) continue;
    const full = join(dir, name);
    const stat = statSync(full);
    if (stat.isDirectory()) walk(full, out);
    else if (/\.(ts|tsx|mts|cts|mjs|cjs|js)$/.test(name) && !name.endsWith('.d.ts')) out.push(full);
  }
  return out;
}

function diskReader(path: string): string | null {
  try {
    const full = join(ROOT, path);
    return statSync(full).isFile() ? readFileSync(full, 'utf8') : null;
  } catch {
    return null;
  }
}

function violationsFor(path: string, source: string): string[] {
  return checkBoundaries([{ path, source }]).map((v) => v.rule);
}

describe('the boundary checker flags every forbidden import shape (fixtures)', () => {
  it('web layer: no @afldb/acquisition, by alias or by relative escape', () => {
    expect(violationsFor('src/app/page.tsx', "import { x } from '@afldb/acquisition';"))
      .toEqual(['src/app and src/components must not import @afldb/acquisition']);
    expect(violationsFor('src/components/A.tsx', "import { x } from '../../packages/acquisition/src/index';"))
      .toEqual(['import packages/acquisition through @afldb/acquisition, not by path']);
    expect(violationsFor('src/app/page.tsx', "import { x } from '@afldb/domain';")).toEqual([]);
  });

  it('dependency direction between packages', () => {
    expect(violationsFor('packages/domain/src/a.ts', "export * from '@afldb/db';"))
      .toEqual(['@afldb/domain may not depend on @afldb/db']);
    expect(violationsFor('packages/db/src/a.ts', "import '@afldb/admin';"))
      .toEqual(['@afldb/db may not depend on @afldb/admin']);
    expect(violationsFor('packages/admin/src/a.ts', "const m = await import('@afldb/acquisition');"))
      .toEqual(['@afldb/admin may not depend on @afldb/acquisition']);
    expect(violationsFor('packages/derived/src/a.ts', "import { a } from '@afldb/domain';\nimport { b } from '@afldb/db';"))
      .toEqual([]);
    // A relative escape into a sibling package is caught even though it names no alias.
    expect(violationsFor('packages/db/src/a.ts', "import { x } from '../../admin/src/index';"))
      .toEqual(['import packages/admin through @afldb/admin, not by path']);
  });

  it('packages never import the web layer or tests', () => {
    expect(violationsFor('packages/admin/src/a.ts', "import { f } from '@/app/admin/actions';"))
      .toEqual(['@afldb/admin may not import src/app']);
    expect(violationsFor('packages/db/src/a.ts', "import { f } from '../../../tests/setup';"))
      .toEqual(['@afldb/db may not import tests/setup']);
  });

  it('@afldb/testing is for tests/** only', () => {
    expect(violationsFor('src/lib/a.ts', "import { x } from '@afldb/testing';"))
      .toEqual(['only tests/** may import @afldb/testing']);
    expect(violationsFor('packages/admin/src/a.ts', "import { x } from '@afldb/testing';"))
      .toEqual(['only tests/** may import @afldb/testing']);
    expect(violationsFor('tests/a.test.ts', "import { x } from '@afldb/testing';")).toEqual([]);
  });

  it('subpath imports and undeclared modules are refused', () => {
    expect(violationsFor('src/lib/a.ts', "import { x } from '@afldb/db/src/index';"))
      .toEqual(['subpath import of @afldb/db is forbidden; import the package index']);
    expect(violationsFor('src/lib/a.ts', "import { x } from '@afldb/web';"))
      .toEqual(['@afldb/web is not a declared V2 module']);
  });

  it('only legacy/** imports legacy/**', () => {
    expect(violationsFor('tools/current-season/a.ts', "import { x } from '../../legacy/offline/y';"))
      .toEqual(['only legacy/** may import legacy/**']);
    expect(violationsFor('legacy/offline/a.ts', "import { x } from './b';")).toEqual([]);
  });

  it('resolves specifiers to repository paths', () => {
    expect(resolveSpecifier('src/app/x/page.tsx', '../../lib/a')).toEqual({ kind: 'file', path: 'src/lib/a' });
    expect(resolveSpecifier('src/app/page.tsx', '@/db/client')).toEqual({ kind: 'file', path: 'src/db/client' });
    expect(resolveSpecifier('src/a.ts', 'postgres')).toEqual({ kind: 'external', name: 'postgres' });
    expect(boundaryRuleBroken('src/a.ts', { kind: 'external', name: 'postgres' })).toBeNull();
  });

  it('the purity walk follows re-exports transitively and reports an impure leaf', () => {
    const files: Record<string, string> = {
      'packages/domain/src/index.ts': "export { a } from '@/lib/a';",
      'src/lib/a.ts': "export { b } from './b';",
      'src/lib/b.ts': "import postgres from 'postgres';\nexport const b = postgres;",
    };
    const violations = purityViolations('packages/domain/src/index.ts', (p) => files[p] ?? null);
    expect(violations.map((v) => `${v.file}: ${v.rule}`)).toEqual(['src/lib/b.ts: the pure closure reaches postgres']);
    const clean = purityViolations('packages/domain/src/index.ts', (p) => (
      { ...files, 'src/lib/b.ts': 'export const b = 1;' }[p] ?? null
    ));
    expect(clean).toEqual([]);
  });
});

describe('the real tree obeys the boundaries', () => {
  it('src, tools, packages and deploy contain no boundary violation', () => {
    const files: SourceFile[] = ['src', 'tools', 'packages', 'deploy']
      .flatMap((d) => walk(join(ROOT, d)))
      .map((full) => ({ path: rel(full), source: readFileSync(full, 'utf8') }));
    // Sanity: the walk really covered the tree, not an empty directory.
    expect(files.length).toBeGreaterThan(500);
    expect(files.some((f) => f.path === 'packages/testing/src/module-boundaries.ts')).toBe(true);
    expect(checkBoundaries(files)).toEqual([]);
  });

  it('every declared package has an index, and nothing else lives directly under packages/', () => {
    expect(readdirSync(join(ROOT, 'packages')).sort()).toEqual([...PACKAGE_MODULES].sort());
    for (const name of PACKAGE_MODULES) {
      expect(diskReader(`packages/${name}/src/index.ts`), name).not.toBeNull();
    }
  });

  it('the transitive closure of @afldb/domain is pure', () => {
    expect(purityViolations('packages/domain/src/index.ts', diskReader)).toEqual([]);
  });
});

describe('@afldb/* aliases resolve to the package index', () => {
  it('each package loads and exports what its index declares', async () => {
    const domain = await import('@afldb/domain');
    expect(domain.isFixtureRoundType('home_and_away')).toBe(true);
    const db = await import('@afldb/db');
    expect(typeof db.assertTestProcessDsn).toBe('function');
    const acquisition = await import('@afldb/acquisition');
    expect(typeof acquisition.parseSourceFamilyRegistry).toBe('function');
    const admin = await import('@afldb/admin');
    expect(typeof admin.hasCapability).toBe('function');
    const testing = await import('@afldb/testing');
    expect(typeof testing.applyTestDsnPolicy).toBe('function');
    // Deliberately empty until Stage 4 (plan D6): no aspirational API.
    const derived = await import('@afldb/derived');
    expect(Object.keys(derived)).toEqual([]);
  });
});

describe('ESLint no-restricted-imports enforces the same boundaries', () => {
  const eslint = new ESLint({ cwd: ROOT });

  async function restrictedMessages(path: string, code: string): Promise<string[]> {
    const [result] = await eslint.lintText(code, { filePath: join(ROOT, path) });
    return result.messages.filter((m) => m.ruleId === 'no-restricted-imports').map((m) => m.message);
  }

  it('fires on forbidden imports', async () => {
    expect(await restrictedMessages(
      'src/app/__v2_boundary_probe__.tsx',
      "import { parseSourceFamilyRegistry } from '@afldb/acquisition';\nexport const p = parseSourceFamilyRegistry;\n",
    )).toHaveLength(1);
    expect(await restrictedMessages(
      'packages/domain/src/__v2_boundary_probe__.ts',
      "import { isTestProcess } from '@afldb/db';\nexport const p = isTestProcess;\n",
    )).toHaveLength(1);
    expect(await restrictedMessages(
      'packages/db/src/__v2_boundary_probe__.ts',
      "import { hasCapability } from '@afldb/admin';\nexport const p = hasCapability;\n",
    )).toHaveLength(1);
    expect(await restrictedMessages(
      'src/lib/__v2_boundary_probe__.ts',
      "import { applyTestDsnPolicy } from '@afldb/testing';\nexport const p = applyTestDsnPolicy;\n",
    )).toHaveLength(1);
    expect(await restrictedMessages(
      'tools/__v2_boundary_probe__.ts',
      "import { x } from '../legacy/offline/x';\nexport const p = x;\n",
    )).toHaveLength(1);
  }, 60_000);

  it('stays silent on allowed imports', async () => {
    expect(await restrictedMessages(
      'packages/db/src/__v2_boundary_probe__.ts',
      "import { isFixtureStatus } from '@afldb/domain';\nexport const p = isFixtureStatus;\n",
    )).toEqual([]);
    expect(await restrictedMessages(
      'tests/__v2_boundary_probe__.test.ts',
      "import { applyTestDsnPolicy } from '@afldb/testing';\nexport const p = applyTestDsnPolicy;\n",
    )).toEqual([]);
  }, 60_000);
});
