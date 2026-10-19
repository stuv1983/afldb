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
import { spawnSync } from 'node:child_process';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

import { ESLint } from 'eslint';
import { describe, expect, it } from 'vitest';

import {
  LEGACY_RETIRED_CODE,
  RETIRED_ADMIN_SURFACES,
  RETIRED_ENTRIES,
  findRetiredAdminSurface,
  findRetiredEntry,
  renderRetiredAdminRefusal,
  renderRetiredEntryRefusal,
  renderUnknownRetiredEntry,
  retiredAdminRefusal,
} from '@afldb/domain';
import {
  LEGACY_RUNTIME_MODULES,
  PACKAGE_MODULES,
  boundaryRuleBroken,
  checkBoundaries,
  extractImportSpecifiers,
  legacyRuntimeEdges,
  offlineToolImports,
  publicRuntimeLegacyReach,
  purityViolations,
  resolveImportFile,
  resolveSpecifier,
  retiredEntryWiring,
  scheduledLegacyReferences,
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
    // Stage 4 (plan D6/D7): the Coleman derivation and the Brownlow reconciliation.
    const derived = await import('@afldb/derived');
    expect(typeof derived.deriveColeman).toBe('function');
    expect(typeof derived.reconcileBrownlowSeason).toBe('function');
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

// ---------------------------------------------------------------------------------------------
// Stage 4 (plan D10, ADR 0010, R-006): legacy quarantine and runtime independence.
// ---------------------------------------------------------------------------------------------

const QUARANTINED_TOOL = 'legacy/offline/tools/current-season/update-current-season.ts';

function walkAll(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    if (name === 'node_modules' || name.startsWith('.')) continue;
    const full = join(dir, name);
    if (statSync(full).isDirectory()) walkAll(full, out);
    else if (!/\.(png|jpe?g|gif|webp|ico|woff2?|zip)$/i.test(name)) out.push(full);
  }
  return out;
}

function sourceFiles(dirs: readonly string[]): SourceFile[] {
  return dirs
    .flatMap((d) => walk(join(ROOT, d)))
    .map((full) => ({ path: rel(full), source: readFileSync(full, 'utf8') }));
}

function edgeKey(edge: { from: string; to: string }): string {
  return `${edge.from} -> ${edge.to}`;
}

/** Unexpected and stale ratchet entries: both directions must be empty. */
function ratchetDiff(
  actual: readonly { from: string; to: string }[],
  known: readonly { from: string; to: string }[],
): { unexpected: string[]; stale: string[] } {
  const actualKeys = new Set(actual.map(edgeKey));
  const knownKeys = new Set(known.map(edgeKey));
  return {
    unexpected: [...actualKeys].filter((k) => !knownKeys.has(k)).sort(),
    stale: [...knownKeys].filter((k) => !actualKeys.has(k)).sort(),
  };
}

/**
 * The exact set of direct importers of LEGACY_RUNTIME_MODULES outside those modules (tests/**
 * excluded). Every one has a named disposition; the ratchet fails on a new edge and on a listed
 * edge that no longer exists, so the list can only shrink deliberately.
 *
 * Stage 5 (V2-GAP-013) deliberately retired seven edges, all admin entry points that refuse now:
 *   src/app/admin/current-season/actions.ts -> settle-trigger.ts and -> current-season-import.ts
 *   src/app/admin/current-season/page.tsx -> current-season-import.ts
 *   src/app/admin/submissions/[id]/actions.ts -> pipeline.ts
 *   src/app/admin/upload/page.tsx -> datasets.ts
 *   src/app/admin/upload/stage/route.ts -> pipeline.ts
 *   src/app/api/admin/email-intake/route.ts -> pipeline.ts
 * Two admin edges remain, both reads of the AFL API settle unit table (a type and SETTLE_UNITS),
 * never the AFL Tables trigger; the Stage 5 guards below pin that `startSettleRun` is not imported.
 */
const KNOWN_LEGACY_RUNTIME_EDGES: readonly { from: string; to: string; disposition: string }[] = [
  { from: QUARANTINED_TOOL, to: 'src/lib/external-afl/current-season-import.ts', disposition: 'legacy/offline quarantine' },
  { from: 'src/app/admin/current-season/AflApiSettleUnitsPanel.tsx', to: 'src/lib/acquisition/settle-trigger.ts', disposition: 'retained: AFL API settle units panel reads SETTLE_UNITS and the unit-key type, never startSettleRun' },
  { from: 'src/app/admin/current-season/page.tsx', to: 'src/lib/acquisition/settle-trigger.ts', disposition: 'retained: type-only read of the unit-key type for the AFL API settle units panel' },
  { from: 'src/lib/acquisition/settle-afl-api.ts', to: 'src/lib/acquisition/settle-afltables.ts', disposition: 'ISSUE-316 C4b cutover: AFL API settle shares the AFL Tables settle helpers' },
  { from: 'src/lib/acquisition/settle-report.ts', to: 'src/lib/acquisition/settle-afltables.ts', disposition: 'ISSUE-316 C4b cutover: settle report reads the AFL Tables settle types' },
  { from: 'src/lib/acquisition/settle-status.ts', to: 'src/lib/acquisition/settle-trigger.ts', disposition: 'ISSUE-316 C4b cutover: settle status reads the trigger contract' },
  { from: 'tools/current-season/settle-afltables.ts', to: 'src/lib/acquisition/settle-afltables.ts', disposition: 'ISSUE-316 C4b cutover: AFL Tables settle CLI (retired through ISSUE-316: D-316-1 at C2, the timer by C5 under D-316-4; plan R-042)' },
  { from: 'tools/db/afl-api-identity-correction-rehearsal.ts', to: 'src/lib/acquisition/settle-afltables.ts', disposition: 'offline rehearsal tooling (tools/db)' },
  { from: 'tools/db/prepare-promotion-source.ts', to: 'src/lib/acquisition/settle-afltables.ts', disposition: 'offline promotion tooling (tools/db)' },
  { from: 'tools/db/promotion-source-dependency-rehearsal.ts', to: 'src/lib/acquisition/settle-afltables.ts', disposition: 'offline rehearsal tooling (tools/db)' },
  { from: 'tools/records/import-first-kick-goal.ts', to: 'src/lib/ingest/datasets.ts', disposition: 'offline records import (tools/records)' },
];

describe('legacy quarantine: nothing scheduled or deployed runs legacy/ (plan D10)', () => {
  const packageJsonText = readFileSync(join(ROOT, 'package.json'), 'utf8');
  const deployFiles = (): SourceFile[] => walkAll(join(ROOT, 'deploy'))
    .map((full) => ({ path: rel(full), source: readFileSync(full, 'utf8') }));

  it('no package.json script and no file under deploy/ references legacy/', () => {
    const files = deployFiles();
    // Not vacuous: the scan really covered the deploy units, timers and scripts.
    expect(files.length).toBeGreaterThan(15);
    expect(files.some((f) => f.path === 'deploy/afldb-settle-afltables.timer')).toBe(true);
    expect(files.some((f) => f.path === 'deploy/afldb.service')).toBe(true);
    expect(JSON.parse(packageJsonText).scripts['current-season:update']).toBeTruthy();
    expect(scheduledLegacyReferences(packageJsonText, files)).toEqual([]);
  });

  it('negative control: a script or a deploy line naming legacy/ is reported', () => {
    const bad = JSON.stringify({ scripts: { ok: 'tsx tools/a.ts', bad: 'tsx legacy/offline/x.ts' } });
    const found = scheduledLegacyReferences(bad, [
      { path: 'deploy/x.service', source: '[Service]\nExecStart=/usr/bin/npx tsx legacy/offline/x.ts\n' },
      { path: 'deploy/y.sh', source: 'echo "not a legacy-looking path legacy-tools"\n' },
    ]);
    expect(found).toEqual([
      'package.json script bad: tsx legacy/offline/x.ts',
      'deploy/x.service:2: ExecStart=/usr/bin/npx tsx legacy/offline/x.ts',
    ]);
    expect(scheduledLegacyReferences(JSON.stringify({ scripts: { ok: 'tsx tools/a.ts' } }), [])).toEqual([]);
  });
});

describe('legacy quarantine: only legacy/** imports legacy/** (real target exists)', () => {
  it('the quarantined tool exists and the whole tree has no violation', () => {
    expect(diskReader(QUARANTINED_TOOL)).not.toBeNull();
    expect(diskReader('tools/current-season/update-current-season.ts')).toBeNull();
    const files = sourceFiles(['src', 'tools', 'packages', 'deploy', 'legacy']);
    expect(files.some((f) => f.path === QUARANTINED_TOOL)).toBe(true);
    expect(checkBoundaries(files)).toEqual([]);
    // The quarantined tool is allowed to import src/** (and only that direction is allowed).
    expect(checkBoundaries(files.filter((f) => f.path === QUARANTINED_TOOL))).toEqual([]);
  });

  it('negative control: an admin page importing legacy/offline is refused', () => {
    expect(violationsFor('src/app/admin/x.tsx', "import { run } from '../../../legacy/offline/tools/current-season/update-current-season';"))
      .toEqual(['only legacy/** may import legacy/**']);
    expect(violationsFor('src/lib/x.ts', "const m = await import('../../legacy/offline/y');"))
      .toEqual(['only legacy/** may import legacy/**']);
  });
});

describe('legacy runtime ratchet: the importers of the legacy runtime modules are exactly the known list', () => {
  it('declares real, existing modules', () => {
    expect(LEGACY_RUNTIME_MODULES.length).toBeGreaterThanOrEqual(6);
    for (const legacyModule of LEGACY_RUNTIME_MODULES) expect(diskReader(legacyModule), legacyModule).not.toBeNull();
  });

  it('every real edge is known and every known edge is real (tests/** excluded)', () => {
    const files = sourceFiles(['src', 'packages', 'tools', 'deploy', 'legacy']);
    const diff = ratchetDiff(legacyRuntimeEdges(files, diskReader), KNOWN_LEGACY_RUNTIME_EDGES);
    expect(diff).toEqual({ unexpected: [], stale: [] });
    for (const edge of KNOWN_LEGACY_RUNTIME_EDGES) {
      expect(LEGACY_RUNTIME_MODULES, edge.to).toContain(edge.to);
      expect(edge.disposition.length, edgeKey(edge)).toBeGreaterThan(8);
    }
    expect(new Set(KNOWN_LEGACY_RUNTIME_EDGES.map(edgeKey)).size).toBe(KNOWN_LEGACY_RUNTIME_EDGES.length);
  });

  it('negative control: a new importer is unexpected and a vanished one is stale', () => {
    const memory: Record<string, string> = {
      'src/lib/ingest/pipeline.ts': 'export const p = 1;',
      'src/lib/a.ts': "import { p } from './ingest/pipeline';\nexport const a = p;",
      'src/lib/ingest/pipeline-helper.ts': "import { p } from './pipeline';\nexport const h = p;",
    };
    const files: SourceFile[] = Object.entries(memory).map(([path, source]) => ({ path, source }));
    const edges = legacyRuntimeEdges(files, (p) => memory[p] ?? null);
    expect(edges.map(edgeKey)).toEqual([
      'src/lib/a.ts -> src/lib/ingest/pipeline.ts',
      'src/lib/ingest/pipeline-helper.ts -> src/lib/ingest/pipeline.ts',
    ]);
    expect(ratchetDiff(edges, [{ from: 'src/lib/a.ts', to: 'src/lib/ingest/pipeline.ts' }]))
      .toEqual({ unexpected: ['src/lib/ingest/pipeline-helper.ts -> src/lib/ingest/pipeline.ts'], stale: [] });
    expect(ratchetDiff([], [{ from: 'src/lib/a.ts', to: 'src/lib/ingest/pipeline.ts' }]))
      .toEqual({ unexpected: [], stale: ['src/lib/a.ts -> src/lib/ingest/pipeline.ts'] });
    // A module importing another legacy module is not an external edge.
    const both: Record<string, string> = {
      'src/lib/ingest/pipeline.ts': "import './datasets';",
      'src/lib/ingest/datasets.ts': 'export const d = 1;',
    };
    expect(legacyRuntimeEdges(
      Object.entries(both).map(([path, source]) => ({ path, source })),
      (p) => both[p] ?? null,
    )).toEqual([]);
  });
});

describe('public runtime independence: the public web layer reaches no legacy runtime or offline tool', () => {
  const isPublicEntry = (path: string): boolean => (
    (path.startsWith('src/app/') && !path.startsWith('src/app/admin/') && !path.startsWith('src/app/api/admin/'))
    || path.startsWith('src/components/')
  );

  it('the transitive closure of every public src/app and src/components file is clean', () => {
    const entries = sourceFiles(['src']).map((f) => f.path).filter(isPublicEntry);
    // Not vacuous: the public web layer is large, and includes pages, route handlers and components.
    expect(entries.length).toBeGreaterThan(100);
    expect(entries.some((p) => /^src\/app\/.*page\.tsx$/.test(p))).toBe(true);
    expect(entries.some((p) => p.startsWith('src/components/'))).toBe(true);
    expect(entries.some((p) => p.startsWith('src/app/admin/'))).toBe(false);
    const reach = publicRuntimeLegacyReach(entries, diskReader);
    expect(reach.map((r) => r.chain.join(' > '))).toEqual([]);
  });

  it('the walker follows the real tree: an admin entry does reach a legacy runtime module', () => {
    // Stage 5: the current-season page reaches only settle-trigger (the AFL API unit table's
    // constants and type); the Squiggle/Kali importer it used to reach is gone from its closure.
    const reach = publicRuntimeLegacyReach(['src/app/admin/current-season/page.tsx'], diskReader);
    expect(reach.map((r) => r.reached)).toContain('src/lib/acquisition/settle-trigger.ts');
    expect(reach.map((r) => r.reached)).not.toContain('src/lib/external-afl/current-season-import.ts');
    // The upload and submission pages used to reach the ingest pipeline; neither does now.
    const retired = publicRuntimeLegacyReach([
      'src/app/admin/upload/page.tsx', 'src/app/admin/upload/stage/route.ts',
      'src/app/admin/submissions/[id]/page.tsx', 'src/app/admin/submissions/[id]/actions.ts',
      'src/app/api/admin/email-intake/route.ts',
    ], diskReader);
    expect(retired.map((r) => r.chain.join(' > '))).toEqual([]);
  });

  it('negative control: an import chain into a legacy module, tools/ or legacy/ is reported', () => {
    const memory: Record<string, string> = {
      'src/app/page.tsx': "import { x } from '@/lib/x';",
      'src/lib/x.ts': "export { run } from '../../tools/current-season/settle-afltables';",
      'tools/current-season/settle-afltables.ts': 'export const run = 1;',
      'src/components/C.tsx': "import { p } from '@/lib/ingest/pipeline';",
      'src/lib/ingest/pipeline.ts': 'export const p = 1;',
    };
    const reach = publicRuntimeLegacyReach(['src/app/page.tsx', 'src/components/C.tsx'], (p) => memory[p] ?? null);
    expect(reach.map((r) => r.chain.join(' > '))).toEqual([
      'src/components/C.tsx > src/lib/ingest/pipeline.ts',
      'src/app/page.tsx > src/lib/x.ts > tools/current-season/settle-afltables.ts',
    ]);
    expect(publicRuntimeLegacyReach(['src/app/page.tsx'], (p) => (
      { ...memory, 'src/lib/x.ts': 'export const run = 1;' }[p] ?? null
    ))).toEqual([]);
  });
});

describe('offline tools are never imported by runtime code', () => {
  it('no file under src/ or packages/*/src/ imports tools/{migration,rebuild,records,aflw,email_intake}/ or legacy/', () => {
    const files = sourceFiles(['src', 'packages']);
    expect(files.length).toBeGreaterThan(300);
    // packages/testing is not excluded: it needs no offline tool, so the guard covers it too.
    expect(files.some((f) => f.path.startsWith('packages/testing/src/'))).toBe(true);
    expect(offlineToolImports(files)).toEqual([]);
  });

  it('negative control: every offline tree is refused, tools/db and tests are not in scope', () => {
    const prefixes = ['tools/migration/a', 'tools/rebuild/a', 'tools/records/a', 'tools/aflw/a', 'tools/email_intake/a', 'legacy/offline/a'];
    for (const target of prefixes) {
      const violations = offlineToolImports([
        { path: 'src/lib/x.ts', source: `import { a } from '../../${target}';` },
        { path: 'packages/db/src/x.ts', source: `import { a } from '../../../${target}';` },
      ]);
      expect(violations.map((v) => v.file), target).toEqual(['src/lib/x.ts', 'packages/db/src/x.ts']);
    }
    expect(offlineToolImports([{ path: 'src/lib/x.ts', source: "import { a } from '../../tools/db/a';" }])).toEqual([]);
    expect(offlineToolImports([{ path: 'tools/db/x.ts', source: "import { a } from '../migration/a';" }])).toEqual([]);
  });
});

describe('retired entry points are registered and wired in both directions', () => {
  const packageJsonText = readFileSync(join(ROOT, 'package.json'), 'utf8');
  const names = RETIRED_ENTRIES.map((e) => e.name);

  it('every retired-entry script names a registry entry and every entry is wired', () => {
    expect(names).toContain('current-season:update');
    expect(retiredEntryWiring(packageJsonText, names)).toEqual({ unregistered: [], mismatched: [], orphans: [] });
    expect(JSON.parse(packageJsonText).scripts['current-season:update'])
      .toBe('tsx tools/v2/retired-entry.ts current-season:update');
  });

  it('every entry points at a real offline tool and real governing documents', () => {
    for (const entry of RETIRED_ENTRIES) {
      expect(diskReader(entry.offlineLocation), entry.name).not.toBeNull();
      expect(entry.offlineLocation.startsWith('legacy/offline/')).toBe(true);
      expect(entry.governedBy).toContain('docs/v2/legacy-disposition.md');
      expect(diskReader('docs/v2/adr/0010-legacy-disposition.md')).not.toBeNull();
    }
  });

  it('negative control: an unregistered script, a mismatched key and an orphan entry are reported', () => {
    const bad = JSON.stringify({ scripts: {
      'old:thing': 'tsx tools/v2/retired-entry.ts old:thing',
      'renamed': 'tsx tools/v2/retired-entry.ts current-season:update',
      'plain': 'tsx tools/a.ts',
    } });
    expect(retiredEntryWiring(bad, names)).toEqual({
      unregistered: ['old:thing -> old:thing'],
      mismatched: ['renamed -> current-season:update'],
      orphans: ['current-season:update'],
    });
  });

  it('the refusal names what, why, where and which document; unknown names also refuse', () => {
    const entry = findRetiredEntry('current-season:update');
    expect(entry).not.toBeNull();
    const text = renderRetiredEntryRefusal(entry as NonNullable<typeof entry>);
    expect(text).toContain('RETIRED: "current-season:update"');
    expect(text).toContain('Squiggle and Kali are retired sources');
    expect(text).toContain(QUARANTINED_TOOL);
    expect(text).toContain('docs/v2/legacy-disposition.md');
    expect(findRetiredEntry('nope')).toBeNull();
    expect(renderUnknownRetiredEntry('nope')).toContain('not a registered retired entry point');
  });

  it('the CLI exits 1 with the refusal for a retired entry and for an unknown name', () => {
    const tsx = join(ROOT, 'node_modules', 'tsx', 'dist', 'cli.mjs');
    const run = (name: string) => spawnSync(process.execPath, [tsx, 'tools/v2/retired-entry.ts', name], {
      cwd: ROOT, encoding: 'utf8', timeout: 20_000,
    });
    const retired = run('current-season:update');
    expect(retired.status).toBe(1);
    expect(retired.stderr).toContain('RETIRED: "current-season:update"');
    expect(retired.stderr).toContain(QUARANTINED_TOOL);
    const unknown = run('no-such-script');
    expect(unknown.status).toBe(1);
    expect(unknown.stderr).toContain('not a registered retired entry point');
    // No scheduler-style silent success: with no argument it also refuses.
    expect(run('').status).toBe(1);
  }, 60_000);
});

// ---------------------------------------------------------------------------------------------
// Stage 5 (plan D9/D10, ADR 0009/0010, V2-GAP-013): the retired admin controls.
// ---------------------------------------------------------------------------------------------

/**
 * Libraries no admin page, route handler or Server Action may import after Stage 5. They stay on
 * disk for the offline tools (`tools/records/import-first-kick-goal.ts` uses `datasets.ts`; the
 * quarantined CLI uses the external-afl pair) but no admin entry point may reach them again.
 */
const ADMIN_BANNED_LEGACY_MODULES: readonly string[] = [
  'src/lib/ingest/pipeline.ts',
  'src/lib/ingest/datasets.ts',
  'src/lib/external-afl/current-season-import.ts',
  'src/lib/external-afl/current-matches.ts',
];
const SETTLE_TRIGGER = 'src/lib/acquisition/settle-trigger.ts';

const isAdminPath = (path: string): boolean => (
  path.startsWith('src/app/admin/') || path.startsWith('src/app/api/admin/')
);

/** Source with block and line comments removed, so prose in a comment cannot satisfy or trip a guard. */
function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/[^\n]*/g, '$1');
}

/**
 * The names a plain `import [type] { a, b as c } from '<specifier>'` brings in, or null when the
 * specifier is imported in any other shape (namespace, default, side-effect, dynamic, re-export,
 * or alongside a named import), so a banned name cannot hide behind a shape the guard cannot read.
 */
function namedImportsOf(source: string, specifier: string): string[] | null {
  const code = stripComments(source);
  const escaped = specifier.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&');
  const named = [...code.matchAll(new RegExp(`import\\s+(?:type\\s+)?\\{([^}]*)\\}\\s*from\\s*['"]${escaped}['"]`, 'g'))];
  const mentions = [...code.matchAll(new RegExp(`['"]${escaped}['"]`, 'g'))];
  if (named.length === 0 || named.length !== mentions.length) return null;
  return named.flatMap((m) => m[1].split(',')
    .map((part) => part.trim().replace(/^type\s+/, '').split(/\s+as\s+/)[0].trim())
    .filter((name) => name.length > 0));
}

/** Every admin import Stage 5 forbids, as `file -> target[: detail]`, sorted. */
function adminLegacyImports(
  files: readonly SourceFile[],
  readFile: (path: string) => string | null,
): string[] {
  const admin = files.filter((f) => isAdminPath(f.path));
  const found = legacyRuntimeEdges(admin, readFile, ADMIN_BANNED_LEGACY_MODULES).map((e) => `${e.from} -> ${e.to}`);
  for (const file of admin) {
    for (const specifier of extractImportSpecifiers(file.source)) {
      if (resolveImportFile(file.path, specifier, readFile) !== SETTLE_TRIGGER) continue;
      const names = namedImportsOf(file.source, specifier);
      if (names === null) {
        found.push(`${file.path} -> ${SETTLE_TRIGGER}: not a plain named import, so startSettleRun cannot be ruled out`);
      } else if (names.includes('startSettleRun')) {
        found.push(`${file.path} -> ${SETTLE_TRIGGER}: startSettleRun`);
      }
    }
  }
  return [...new Set(found)].sort();
}

const REMOVED_CONTROLS = /\b(SettleRunPanel|CurrentSeasonControls|CurrentSeasonReportTable|UploadForm|ReviewControls)\b/;

/** Admin/components files (comments stripped) that mention a removed control, as `file: name`. */
function removedControlMentions(files: readonly SourceFile[]): string[] {
  return files
    .filter((f) => /\.tsx?$/.test(f.path) && (isAdminPath(f.path) || f.path.startsWith('src/components/')))
    .flatMap((f) => {
      const hit = REMOVED_CONTROLS.exec(stripComments(f.source));
      return hit ? [`${f.path}: ${hit[1]}`] : [];
    })
    .sort();
}

/**
 * Why a retired surface no longer proves it refuses: a missing file, a missing export, or an
 * export whose body does not reach the refusal helper for its own surface id. Comments are
 * stripped first, so a comment naming the helper does not count.
 */
function retiredSurfaceViolations(
  readFile: (path: string) => string | null,
  surfaces: readonly { id: string; kind: string; paths: readonly string[]; exports: readonly string[] }[] = RETIRED_ADMIN_SURFACES,
): string[] {
  const violations: string[] = [];
  for (const surface of surfaces) {
    const helper = surface.kind === 'route_handler'
      ? new RegExp(`(?:refuseRetiredAdminRoute|goneRetiredAdminRoute)\\(\\s*'${surface.id}'`)
      : new RegExp(`refuseRetiredAdminAction\\(\\s*'${surface.id}'`);
    for (const path of surface.paths) {
      const source = readFile(path);
      if (source === null) {
        violations.push(`${surface.id}: ${path} is missing`);
        continue;
      }
      const code = stripComments(source);
      if (!code.includes("'@/lib/admin/retired-admin'")) violations.push(`${surface.id}: ${path} does not import the refusal helper`);
      for (const name of surface.exports) {
        const declaration = new RegExp(`export\\s+async\\s+function\\s+${name}\\s*\\(`).exec(code);
        if (!declaration) {
          violations.push(`${surface.id}: ${path} no longer exports ${name}`);
          continue;
        }
        const rest = code.slice(declaration.index);
        const close = rest.search(/\n\}[ \t]*(?:\n|$)/);
        const body = close === -1 ? rest : rest.slice(0, close);
        if (!helper.test(body)) violations.push(`${surface.id}: ${name} does not reach the refusal helper`);
      }
    }
  }
  return violations;
}

describe('retired admin controls (Stage 5): the pure registry', () => {
  it('lists every retired surface once, with real paths and governing documents', () => {
    expect(RETIRED_ADMIN_SURFACES.map((s) => s.id).sort()).toEqual([
      'admin.afltables_settle_trigger', 'admin.csv_upload', 'admin.email_intake',
      'admin.squiggle_kali_refresh', 'admin.submission_review',
    ]);
    expect(new Set(RETIRED_ADMIN_SURFACES.map((s) => s.id)).size).toBe(RETIRED_ADMIN_SURFACES.length);
    for (const surface of RETIRED_ADMIN_SURFACES) {
      expect(['server_action', 'route_handler', 'page'], surface.id).toContain(surface.kind);
      expect(surface.exports.length, surface.id).toBeGreaterThan(0);
      for (const path of surface.paths) expect(diskReader(path), `${surface.id}: ${path}`).not.toBeNull();
      for (const doc of surface.governedBy) expect(diskReader(doc), `${surface.id}: ${doc}`).not.toBeNull();
      expect(surface.governedBy).toContain('docs/v2/legacy-disposition.md');
      expect(surface.was.length, surface.id).toBeGreaterThan(10);
      expect(surface.why.length, surface.id).toBeGreaterThan(10);
      expect(surface.replacedBy.length, surface.id).toBeGreaterThan(10);
    }
  });

  it('looks surfaces up by id and answers null for an unknown one', () => {
    expect(findRetiredAdminSurface('admin.csv_upload')?.paths).toEqual(['src/app/admin/upload/stage/route.ts']);
    expect(findRetiredAdminSurface('admin.submission_review')?.exports).toEqual(['runValidation', 'decideSubmission', 'runPromotion']);
    expect(findRetiredAdminSurface('admin.nope')).toBeNull();
    expect(findRetiredAdminSurface('')).toBeNull();
  });

  it('renders one operator-facing text from the registry: what, why, what replaces it; no path, secret or stack', () => {
    for (const surface of RETIRED_ADMIN_SURFACES) {
      const text = renderRetiredAdminRefusal(surface);
      expect(text, surface.id).toContain('retired');
      expect(text, surface.id).toContain(surface.replacedBy);
      expect(text, surface.id).not.toMatch(/\bsrc\/|\btools\/|\.tsx?\b|postgres:\/\/|DATABASE_URL|SECRET|\bat \w+ \(/);
    }
  });

  it('builds the typed refusal: refused, a stable code, the surface id and the same text as `error`', () => {
    const surface = findRetiredAdminSurface('admin.email_intake')!;
    const refusal = retiredAdminRefusal(surface);
    expect(refusal).toEqual({
      refused: true,
      code: 'legacy_retired',
      surface: 'admin.email_intake',
      error: renderRetiredAdminRefusal(surface),
    });
    expect(LEGACY_RETIRED_CODE).toBe('legacy_retired');
    expect(Object.keys(refusal).sort()).toEqual(['code', 'error', 'refused', 'surface']);
  });
});

describe('retired admin controls (Stage 5): no admin file reaches the legacy ingestion libraries', () => {
  const files = sourceFiles(['src']);

  it('no file under src/app/admin or src/app/api/admin imports the pipeline, datasets, the Squiggle/Kali libraries or startSettleRun', () => {
    // Not vacuous: the admin tree is large, and the retained AFL API panel is a real, analysed
    // importer of settle-trigger (SETTLE_UNITS and a type), which the guard admits by name.
    expect(files.filter((f) => isAdminPath(f.path)).length).toBeGreaterThan(80);
    const panel = files.find((f) => f.path === 'src/app/admin/current-season/AflApiSettleUnitsPanel.tsx')!;
    expect(namedImportsOf(panel.source, '@/lib/acquisition/settle-trigger')).toEqual(['SETTLE_UNITS', 'SettleUnitKey']);
    expect(adminLegacyImports(files, diskReader)).toEqual([]);
  });

  it('the libraries themselves still exist for the offline tools', () => {
    for (const path of ADMIN_BANNED_LEGACY_MODULES) expect(diskReader(path), path).not.toBeNull();
  });

  it('negative control: every banned shape is reported; a plain named import of the unit table is not', () => {
    const memory: Record<string, string> = {
      'src/lib/ingest/pipeline.ts': 'export const p = 1;',
      'src/lib/ingest/datasets.ts': 'export const d = 1;',
      'src/lib/external-afl/current-season-import.ts': 'export const c = 1;',
      'src/lib/external-afl/current-matches.ts': 'export const m = 1;',
      [SETTLE_TRIGGER]: 'export const startSettleRun = 1; export const SETTLE_UNITS = 1; export type SettleUnitKey = string;',
      'src/app/admin/a/actions.ts': "import { p } from '@/lib/ingest/pipeline';",
      'src/app/admin/b/page.tsx': "import { d } from '@/lib/ingest/datasets';",
      'src/app/api/admin/c/route.ts': "import { c } from '../../../../lib/external-afl/current-season-import';",
      'src/app/admin/d/page.tsx': "import { m } from '@/lib/external-afl/current-matches';",
      'src/app/admin/e/actions.ts': "import { startSettleRun, SETTLE_UNITS } from '@/lib/acquisition/settle-trigger';",
      'src/app/admin/f/actions.ts': "import { startSettleRun as go } from '@/lib/acquisition/settle-trigger';",
      'src/app/admin/g/actions.ts': "import * as trigger from '@/lib/acquisition/settle-trigger';",
      'src/app/admin/h/actions.ts': "import type { SettleUnitKey } from '@/lib/acquisition/settle-trigger';\nconst t = await import('@/lib/acquisition/settle-trigger');",
      'src/app/admin/ok/page.tsx': "import type { SettleUnitKey } from '@/lib/acquisition/settle-trigger';\nimport { SETTLE_UNITS } from '@/lib/acquisition/settle-trigger';",
      'src/app/admin/ok2/page.tsx': "import { SETTLE_UNITS, type SettleUnitKey } from '@/lib/acquisition/settle-trigger';",
      // Outside the admin tree the same imports are not this guard's business (the ratchet owns them).
      'src/lib/other.ts': "import { p } from './ingest/pipeline';",
      'tools/records/x.ts': "import { d } from '../../src/lib/ingest/datasets';",
    };
    const memFiles: SourceFile[] = Object.entries(memory).map(([path, source]) => ({ path, source }));
    expect(adminLegacyImports(memFiles, (p) => memory[p] ?? null)).toEqual([
      'src/app/admin/a/actions.ts -> src/lib/ingest/pipeline.ts',
      'src/app/admin/b/page.tsx -> src/lib/ingest/datasets.ts',
      'src/app/admin/d/page.tsx -> src/lib/external-afl/current-matches.ts',
      `src/app/admin/e/actions.ts -> ${SETTLE_TRIGGER}: startSettleRun`,
      `src/app/admin/f/actions.ts -> ${SETTLE_TRIGGER}: startSettleRun`,
      `src/app/admin/g/actions.ts -> ${SETTLE_TRIGGER}: not a plain named import, so startSettleRun cannot be ruled out`,
      `src/app/admin/h/actions.ts -> ${SETTLE_TRIGGER}: not a plain named import, so startSettleRun cannot be ruled out`,
      'src/app/api/admin/c/route.ts -> src/lib/external-afl/current-season-import.ts',
    ]);
  });

  it('negative control: names inside a comment are not imports', () => {
    expect(namedImportsOf("// import { startSettleRun } from '@/lib/acquisition/settle-trigger';\nconst a = 1;", '@/lib/acquisition/settle-trigger')).toBeNull();
    expect(stripComments("const a = 1; // hello\n/* block */ const b = 2;")).not.toMatch(/hello|block/);
  });
});

describe('retired admin controls (Stage 5): the removed controls stay removed and the refusals stay refusals', () => {
  const files = sourceFiles(['src']);

  it('no admin page or shared component renders or imports SettleRunPanel, CurrentSeasonControls, UploadForm or ReviewControls', () => {
    expect(removedControlMentions(files)).toEqual([]);
    for (const gone of [
      'src/app/admin/current-season/SettleRunPanel.tsx',
      'src/app/admin/current-season/CurrentSeasonControls.tsx',
      'src/app/admin/upload/UploadForm.tsx',
      'src/app/admin/submissions/[id]/ReviewControls.tsx',
    ]) expect(diskReader(gone), gone).toBeNull();
  });

  it('negative control: a page that renders a removed control is reported; a comment about one is not', () => {
    const memory: SourceFile[] = [
      { path: 'src/app/admin/x/page.tsx', source: "import { UploadForm } from './UploadForm';\nexport default () => <UploadForm />;" },
      { path: 'src/components/Y.tsx', source: 'export const Y = () => <ReviewControls id={1} />;' },
      { path: 'src/app/admin/z/page.tsx', source: '/* the SettleRunPanel was retired */ export default () => null; // CurrentSeasonControls' },
      { path: 'src/lib/w.ts', source: 'export const SettleRunPanel = 1;' },
    ];
    expect(removedControlMentions(memory)).toEqual([
      'src/app/admin/x/page.tsx: UploadForm',
      'src/components/Y.tsx: ReviewControls',
    ]);
  });

  it('every retired export still exists and its body reaches the refusal helper for its own surface', () => {
    expect(retiredSurfaceViolations(diskReader)).toEqual([]);
    // Not vacuous: seven exports across five surfaces are checked.
    expect(RETIRED_ADMIN_SURFACES.flatMap((s) => s.exports.map((e) => `${s.id}:${e}`))).toHaveLength(7);
  });

  it('negative control: a refusal that regained behaviour, lost its export or names the wrong surface is reported', () => {
    const surfaces = [
      { id: 'admin.csv_upload', kind: 'route_handler', paths: ['r.ts'], exports: ['POST'] },
      { id: 'admin.submission_review', kind: 'server_action', paths: ['a.ts'], exports: ['runValidation', 'decideSubmission'] },
    ];
    const helperImport = "import { refuseRetiredAdminAction, refuseRetiredAdminRoute } from '@/lib/admin/retired-admin';\n";
    const good: Record<string, string> = {
      'r.ts': `${helperImport}export async function POST(request: Request) {\n  const admin = await requireCapability('x');\n  return refuseRetiredAdminRoute('admin.csv_upload', admin, 'POST');\n}\n`,
      'a.ts': `${helperImport}export async function runValidation() {\n  const admin = await requireAdmin();\n  return refuseRetiredAdminAction('admin.submission_review', admin, 'runValidation');\n}\nexport async function decideSubmission() {\n  const admin = await requireAdmin();\n  return refuseRetiredAdminAction('admin.submission_review', admin, 'decideSubmission');\n}\n`,
    };
    expect(retiredSurfaceViolations((p) => good[p] ?? null, surfaces)).toEqual([]);

    const regained: Record<string, string> = {
      ...good,
      'a.ts': good['a.ts'].replace(
        "  return refuseRetiredAdminAction('admin.submission_review', admin, 'runValidation');",
        '  return promoteSubmission(1);',
      ),
    };
    expect(retiredSurfaceViolations((p) => regained[p] ?? null, surfaces))
      .toEqual(['admin.submission_review: runValidation does not reach the refusal helper']);

    const lostExport: Record<string, string> = { ...good, 'a.ts': good['a.ts'].replace('export async function decideSubmission', 'async function decideSubmission') };
    expect(retiredSurfaceViolations((p) => lostExport[p] ?? null, surfaces))
      .toEqual(['admin.submission_review: a.ts no longer exports decideSubmission']);

    const wrongSurface: Record<string, string> = { ...good, 'r.ts': good['r.ts'].replace("'admin.csv_upload'", "'admin.email_intake'") };
    expect(retiredSurfaceViolations((p) => wrongSurface[p] ?? null, surfaces))
      .toEqual(['admin.csv_upload: POST does not reach the refusal helper']);

    const commentOnly: Record<string, string> = {
      ...good,
      'r.ts': `${helperImport}export async function POST() {\n  // refuseRetiredAdminRoute('admin.csv_upload', admin, 'POST')\n  return new Response('ok');\n}\n`,
    };
    expect(retiredSurfaceViolations((p) => commentOnly[p] ?? null, surfaces))
      .toEqual(['admin.csv_upload: POST does not reach the refusal helper']);

    expect(retiredSurfaceViolations(() => null, surfaces)).toEqual([
      'admin.csv_upload: r.ts is missing', 'admin.submission_review: a.ts is missing',
    ]);
  });
});
