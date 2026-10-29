/**
 * AFLDB V2 Stage 3 (docs/v2/plan.md §3 D1) — "API clients never write final tables", proved
 * statically, plus the pipeline contract, the generated stage map and the package facade.
 *
 * What is proved (all DB-free, network-free, no clock):
 *  (a) the RUNTIME (non-type-only) import closure of the AFL API client, season discovery, season
 *      enumeration and the writer-free constants reaches no `postgres`, no src/db/**, no writer
 *      module, and holds no SQL mutation text;
 *  (b) the same for the two acquire CLIs. They are allowed to reach the database LIBRARY only
 *      through the ingestion-switch READ (afl-api-ingestion-control.ts: `SELECT key, value FROM
 *      site_settings`). Established by the walk below, not assumed: the acquire CLIs' closure
 *      reaches NO src/db/** module at all; the only module importing `postgres` is
 *      src/lib/acquisition/afl-api-ingestion-control.ts, and the other library modules reached are
 *      src/lib/site-settings.ts, src/lib/home-records.ts and src/lib/site-content.ts (type and
 *      key declarations those read from). The three constants the CLIs need live in the
 *      writer-free leaf afl-api-acquisition-constants.ts (they used to live in the settle writers,
 *      which put the whole Brownlow/fixture settle into the CLIs' closure);
 *  (c) the check has teeth: on in-memory fixtures a fake client importing canonical-apply, one
 *      importing src/db/client, and one containing `INSERT INTO matches` are all flagged, while a
 *      TYPE-ONLY import of a writer is correctly not flagged;
 *  (d) every AFL_API_PIPELINE implementation symbol is exported at its cited path;
 *  (e) docs/v2/architecture.md §9 equals the rendered stage map;
 *  (f) @afldb/acquisition imports with no DATABASE_URL and its runtime closure reaches no
 *      src/db/**, `postgres` or `server-only`.
 *
 * The walk follows `import`, `export ... from`, `import x = require()`, `import()` and `require()`
 * found by the TypeScript parser, and SKIPS `import type`, `export type` and import/export lists
 * whose every element is `type`-qualified. An `import { T }` of something that is only a type is
 * counted as a runtime import (the parser cannot know), which can only over-report, never hide.
 */
import { readFileSync, statSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join, posix } from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  ACQUISITION_STAGES,
  AFL_API_PIPELINE,
  StageMapError,
  extractStageMap,
  findExportLine,
  renderAflApiStageMap,
  spliceStageMap,
  type StageDescriptor,
} from '@afldb/acquisition';
import { extractImportSpecifiers, resolveSpecifier } from '@afldb/testing';

const ROOT = join(__dirname, '..');
const ts = createRequire(import.meta.url)('typescript') as typeof import('typescript');

function diskReader(path: string): string | null {
  try {
    const full = join(ROOT, path);
    return statSync(full).isFile() ? readFileSync(full, 'utf8') : null;
  } catch {
    return null;
  }
}

/** Specifiers that survive compilation: everything except type-only imports and exports. */
function runtimeSpecifiers(source: string, fileName: string): string[] {
  const sf = ts.createSourceFile(fileName, source, ts.ScriptTarget.Latest, true);
  const out: string[] = [];
  const visit = (node: import('typescript').Node): void => {
    if (ts.isImportDeclaration(node)) {
      const clause = node.importClause;
      const spec = (node.moduleSpecifier as import('typescript').StringLiteral).text;
      if (!clause) out.push(spec);
      else if (!clause.isTypeOnly) {
        const named = clause.namedBindings;
        const onlyTypes = !clause.name && named !== undefined && ts.isNamedImports(named)
          && named.elements.length > 0 && named.elements.every((e) => e.isTypeOnly);
        if (!onlyTypes) out.push(spec);
      }
    } else if (ts.isExportDeclaration(node) && node.moduleSpecifier) {
      const named = node.exportClause;
      const onlyTypes = node.isTypeOnly || (named !== undefined && ts.isNamedExports(named)
        && named.elements.length > 0 && named.elements.every((e) => e.isTypeOnly));
      if (!onlyTypes) out.push((node.moduleSpecifier as import('typescript').StringLiteral).text);
    } else if (ts.isImportEqualsDeclaration(node) && !node.isTypeOnly
      && ts.isExternalModuleReference(node.moduleReference) && ts.isStringLiteral(node.moduleReference.expression)) {
      out.push(node.moduleReference.expression.text);
    } else if (ts.isCallExpression(node)) {
      const first = node.arguments[0];
      const isImportCall = node.expression.kind === ts.SyntaxKind.ImportKeyword;
      const isRequire = ts.isIdentifier(node.expression) && node.expression.text === 'require';
      if (first && ts.isStringLiteral(first) && (isImportCall || isRequire)) out.push(first.text);
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return out;
}

const CANDIDATE_SUFFIXES = ['', '.ts', '.tsx', '/index.ts', '/index.tsx'];

interface Closure {
  /** Repository-relative POSIX paths of every file reached at runtime (entry included). */
  files: string[];
  /** External package name -> the files that import it. */
  externals: Map<string, string[]>;
  unresolved: string[];
}

function closureOf(entry: string, readFile: (path: string) => string | null): Closure {
  const files = new Set<string>();
  const externals = new Map<string, string[]>();
  const unresolved: string[] = [];
  const queue = [entry];
  while (queue.length > 0) {
    const path = queue.shift() as string;
    if (files.has(path)) continue;
    files.add(path);
    const source = readFile(path);
    if (source === null) {
      unresolved.push(path);
      continue;
    }
    for (const specifier of runtimeSpecifiers(source, path)) {
      const resolved = resolveSpecifier(path, specifier);
      if (resolved.kind === 'external') {
        externals.set(resolved.name, [...(externals.get(resolved.name) ?? []), path]);
        continue;
      }
      const base = resolved.kind === 'package' ? `packages/${resolved.module}/src/index` : resolved.path;
      const found = CANDIDATE_SUFFIXES.map((s) => posix.normalize(`${base}${s}`)).find((c) => readFile(c) !== null);
      if (found) queue.push(found);
      else unresolved.push(`${path} -> ${specifier}`);
    }
  }
  return { files: [...files].sort(), externals, unresolved };
}

/** Modules that write: settle*, canonical apply, the stores, authorities, review, absence, adjudication, the writer-side AFL API settles, and all of src/db. */
const WRITER_PATHS: readonly RegExp[] = [
  /^src\/lib\/acquisition\/settle-[^/]+\.ts$/,
  /^tools\/current-season\/settle-[^/]+\.ts$/,
  /^src\/lib\/acquisition\/(canonical-apply|observation-store|lineup-store|manual-authority|match-sheet-authority|promotion-review)\.ts$/,
  /^src\/lib\/acquisition\/(afl-api-match-absence|afl-api-identity-correction|afl-api-adjudication|afl-api-brownlow|afl-api-fixture-identity)\.ts$/,
  /^src\/db\//,
];
const SQL_MUTATION = /\bINSERT\s+INTO\b|\bUPDATE\s+\w+\s+SET\b|\bDELETE\s+FROM\b|\bTRUNCATE\b|\bMERGE\s+INTO\b/i;

interface Findings {
  writers: string[];
  db: string[];
  sql: string[];
  postgres: string[];
  serverOnly: string[];
  unresolved: string[];
}

function findingsFor(entry: string, readFile: (path: string) => string | null): Findings & { closure: Closure } {
  const closure = closureOf(entry, readFile);
  return {
    closure,
    writers: closure.files.filter((f) => f !== entry && WRITER_PATHS.some((re) => re.test(f))),
    db: closure.files.filter((f) => /^src\/db\//.test(f)),
    sql: closure.files.filter((f) => SQL_MUTATION.test(readFile(f) ?? '')),
    postgres: closure.externals.get('postgres') ?? [],
    serverOnly: closure.externals.get('server-only') ?? [],
    unresolved: closure.unresolved,
  };
}

const CLEAN = { writers: [], db: [], sql: [], postgres: [], serverOnly: [], unresolved: [] };
const pick = ({ writers, db, sql, postgres, serverOnly, unresolved }: Findings): Findings =>
  ({ writers, db, sql, postgres, serverOnly, unresolved });

describe('(a) API clients never write final tables — the client-side modules', () => {
  it.each([
    'src/lib/acquisition/afl-api-client.ts',
    'src/lib/acquisition/afl-api-season-discovery.ts',
    'src/lib/acquisition/afl-api-season-enumeration.ts',
    'src/lib/acquisition/afl-api-acquisition-constants.ts',
  ])('%s: no postgres, no src/db, no writer module, no SQL mutation in its runtime closure', (entry) => {
    const found = findingsFor(entry, diskReader);
    expect(found.closure.files.length).toBeGreaterThan(0);
    expect(pick(found)).toEqual(CLEAN);
  });

  it('the acquire constants leaf imports nothing, and the writer modules re-export it value for value', () => {
    expect(closureOf('src/lib/acquisition/afl-api-acquisition-constants.ts', diskReader).files)
      .toEqual(['src/lib/acquisition/afl-api-acquisition-constants.ts']);
    for (const writer of ['afl-api-brownlow.ts', 'afl-api-fixture-identity.ts']) {
      expect(diskReader(`src/lib/acquisition/${writer}`)).toMatch(/afl-api-acquisition-constants/);
    }
  });
});

describe('(b) API clients never write final tables — the acquire CLIs', () => {
  it.each([
    'tools/current-season/acquire-afl-api.ts',
    'tools/current-season/acquire-afl-api-brownlow.ts',
  ])('%s reaches no writer module, no src/db module and holds no SQL mutation text', (entry) => {
    const found = findingsFor(entry, diskReader);
    expect(found.closure.files).toContain('src/lib/acquisition/afl-api-client.ts');
    expect(found.closure.files).toContain('src/lib/acquisition/afl-api-ingestion-control.ts');
    expect(found.writers).toEqual([]);
    expect(found.db).toEqual([]);
    expect(found.sql).toEqual([]);
    expect(found.serverOnly).toEqual([]);
    expect(found.unresolved).toEqual([]);
    // The only database-LIBRARY touch is the ingestion-switch read.
    expect(found.postgres).toEqual(['src/lib/acquisition/afl-api-ingestion-control.ts']);
  });

  it('the ingestion switch the CLIs reach only SELECTs from site_settings', () => {
    const source = diskReader('src/lib/acquisition/afl-api-ingestion-control.ts') ?? '';
    expect(source).toMatch(/SELECT key, value FROM site_settings/);
    expect(SQL_MUTATION.test(source)).toBe(false);
  });
});

describe('(c) the closure check has teeth (in-memory negative controls)', () => {
  const mem = (files: Record<string, string>) => (path: string): string | null => files[path] ?? null;
  const WRITER_STUB = 'export const applyCanonicalUnit = 1;\n';
  const CLIENT = 'src/lib/acquisition/fake-client.ts';

  it('flags a fake client importing canonical-apply, even indirectly', () => {
    const direct = findingsFor(CLIENT, mem({
      [CLIENT]: "import { applyCanonicalUnit } from './canonical-apply';\nexport const x = applyCanonicalUnit;\n",
      'src/lib/acquisition/canonical-apply.ts': WRITER_STUB,
    }));
    expect(direct.writers).toEqual(['src/lib/acquisition/canonical-apply.ts']);

    const indirect = findingsFor(CLIENT, mem({
      [CLIENT]: "import { helper } from './helper';\nexport const x = helper;\n",
      'src/lib/acquisition/helper.ts': "export { applyCanonicalUnit as helper } from './canonical-apply';\n",
      'src/lib/acquisition/canonical-apply.ts': WRITER_STUB,
    }));
    expect(indirect.writers).toEqual(['src/lib/acquisition/canonical-apply.ts']);
  });

  it('flags a fake client reaching src/db and postgres', () => {
    const found = findingsFor(CLIENT, mem({
      [CLIENT]: "import { sql } from '@/db/client';\nexport const x = sql;\n",
      'src/db/client.ts': "import postgres from 'postgres';\nimport 'server-only';\nexport const sql = postgres('');\n",
    }));
    expect(found.db).toEqual(['src/db/client.ts']);
    expect(found.writers).toEqual(['src/db/client.ts']);
    expect(found.postgres).toEqual(['src/db/client.ts']);
    expect(found.serverOnly).toEqual(['src/db/client.ts']);
  });

  it('flags SQL mutation text in the closure (each verb)', () => {
    for (const statement of [
      'INSERT INTO matches (id) VALUES (1)',
      'update matches set venue_id = 1',
      'DELETE FROM matches',
      'TRUNCATE matches',
      'MERGE INTO matches USING x ON true',
    ]) {
      const found = findingsFor(CLIENT, mem({ [CLIENT]: `export const q = \`${statement}\`;\n` }));
      expect(found.sql, statement).toEqual([CLIENT]);
    }
  });

  it('does not flag a TYPE-ONLY import of a writer, nor read-only SQL, nor prose such as "truncated"', () => {
    const found = findingsFor(CLIENT, mem({
      [CLIENT]: [
        "import type { CanonicalApplyRefusal } from './canonical-apply';",
        "import { type Other } from './canonical-apply';",
        "export type { CanonicalApplyRefusal } from './canonical-apply';",
        'export const q = `SELECT key, value FROM site_settings`; // never truncated or deleted',
        '',
      ].join('\n'),
      'src/lib/acquisition/canonical-apply.ts': WRITER_STUB,
    }));
    expect(pick(found)).toEqual(CLEAN);
    expect(found.closure.files).toEqual([CLIENT]);
  });

  it('the runtime specifier set is always a subset of the parser-wide specifier set', () => {
    for (const path of ['packages/acquisition/src/index.ts', 'packages/acquisition/src/replay.ts',
      'packages/acquisition/src/reconciliation-report.ts', 'tools/current-season/acquire-afl-api.ts']) {
      const source = diskReader(path) as string;
      const all = new Set(extractImportSpecifiers(source));
      for (const specifier of runtimeSpecifiers(source, path)) expect(all.has(specifier), `${path}: ${specifier}`).toBe(true);
    }
  });
});

describe('(d) the pipeline contract names real exports', () => {
  it('has the seven stages, once each, in the owner chain order', () => {
    expect(AFL_API_PIPELINE.map((s) => s.stage)).toEqual([...ACQUISITION_STAGES]);
    expect(ACQUISITION_STAGES).toEqual(['acquire', 'snapshot', 'validate_stage', 'resolve_identity', 'reconcile', 'promote', 'derive']);
  });

  it('only promote writes canonical rows; acquire, identity and reconcile write nothing', () => {
    const writes = Object.fromEntries(AFL_API_PIPELINE.map((s) => [s.stage, s.writes]));
    expect(writes).toEqual({
      acquire: 'nothing', snapshot: 'snapshot_files', validate_stage: 'staging', resolve_identity: 'nothing',
      reconcile: 'nothing', promote: 'canonical', derive: 'derived',
    });
  });

  it('every implementation symbol is exported at its cited path (one table row each)', () => {
    const table = renderAflApiStageMap(diskReader);
    const rows = table.split('\n').slice(2);
    expect(rows).toHaveLength(AFL_API_PIPELINE.reduce((n, s) => n + s.implementations.length, 0));
    for (const stage of AFL_API_PIPELINE) {
      for (const impl of stage.implementations) {
        const line = findExportLine(diskReader(impl.path) as string, impl.symbol);
        expect(line, `${impl.path} exports ${impl.symbol}`).toBeGreaterThan(0);
        expect(table).toContain(`| ${stage.stage} | \`${impl.path}:${line}\` | \`${impl.symbol}\` | ${stage.writes} |`);
      }
    }
  });

  it('cites the V2 Stage 3 fixture contract and the season seal', () => {
    const cited = AFL_API_PIPELINE.flatMap((s) => s.implementations.map((i) => `${i.path}#${i.symbol}`));
    expect(cited).toContain('packages/acquisition/src/fixture-contract.ts#evaluateAflApiFixtureProjection');
    expect(cited).toContain('tools/current-season/settle-season-seal.ts#refuseSealedSeasonForSettle');
    expect(cited).toContain('packages/domain/src/season-seal.ts#evaluateSeasonWrite');
    expect(cited).toContain('src/lib/acquisition/observations.ts#canonicalJson');
    expect(cited).toContain('src/lib/acquisition/afl-api-snapshot.ts#aflApiSeasonFeedTextFrom');
  });

  it('refuses a missing file and a symbol that is not exported there', () => {
    const bogusSymbol: StageDescriptor[] = [{
      stage: 'acquire', summary: 'x', writes: 'nothing',
      implementations: [{ path: 'src/lib/acquisition/afl-api-client.ts', symbol: 'doesNotExist', note: 'x' }],
    }];
    expect(() => renderAflApiStageMap(diskReader, bogusSymbol)).toThrow(StageMapError);
    const bogusFile: StageDescriptor[] = [{
      stage: 'acquire', summary: 'x', writes: 'nothing',
      implementations: [{ path: 'src/lib/acquisition/nope.ts', symbol: 'x', note: 'x' }],
    }];
    expect(() => renderAflApiStageMap(diskReader, bogusFile)).toThrow(/does not exist/);
  });

  it('findExportLine handles declarations, export lists, re-exports, aliases and ignores comments', () => {
    const source = [
      '// export function inComment() {}', //                       1
      '/* export const inBlock = 1;', //                            2
      'export const stillComment = 2; */', //                       3
      'export async function load() {}', //                         4
      'export const VALUE = 1;', //                                 5
      'export type Shape = { a: 1 };', //                           6
      'export {', //                                                7
      '  one, // two',  //                                          8
      '  type Three,', //                                           9
      '  four as Five,', //                                        10
      "} from './elsewhere';", //                                  11
      'export { local };', //                                      12
      'export const $dollar = 1;', //                              13
    ].join('\n');
    expect(findExportLine(source, 'inComment')).toBeNull();
    expect(findExportLine(source, 'inBlock')).toBeNull();
    expect(findExportLine(source, 'stillComment')).toBeNull();
    expect(findExportLine(source, 'load')).toBe(4);
    expect(findExportLine(source, 'VALUE')).toBe(5);
    expect(findExportLine(source, 'Shape')).toBe(6);
    expect(findExportLine(source, 'one')).toBe(8);
    expect(findExportLine(source, 'two')).toBeNull();
    expect(findExportLine(source, 'Three')).toBe(9);
    expect(findExportLine(source, 'Five')).toBe(10);
    expect(findExportLine(source, 'four')).toBeNull();
    expect(findExportLine(source, 'local')).toBe(12);
    expect(findExportLine(source, '$dollar')).toBe(13);
    expect(findExportLine(source.replace(/\n/g, '\r\n'), 'Five')).toBe(10);
  });

  it('finds a re-export list entry in a real module (settle-afl-api.ts: export { areCoSources })', () => {
    expect(findExportLine(diskReader('src/lib/acquisition/settle-afl-api.ts') as string, 'areCoSources')).toBeGreaterThan(0);
  });
});

describe('(e) docs/v2/architecture.md §9 is the rendered stage map', () => {
  it('equals renderAflApiStageMap output', () => {
    const document = diskReader('docs/v2/architecture.md') as string;
    expect(extractStageMap(document)).toBe(renderAflApiStageMap(diskReader));
  });

  it('spliceStageMap touches only the marked region and preserves the line ending', () => {
    for (const eol of ['\n', '\r\n']) {
      const before = `# T${eol}${eol}<!-- stage-map:begin -->${eol}old${eol}<!-- stage-map:end -->${eol}tail${eol}`;
      const after = spliceStageMap(before, 'a\nb');
      expect(after).toBe(`# T${eol}${eol}<!-- stage-map:begin -->${eol}a${eol}b${eol}<!-- stage-map:end -->${eol}tail${eol}`);
      expect(spliceStageMap(after, 'a\nb')).toBe(after);
    }
    expect(() => spliceStageMap('no markers', 'x')).toThrow(StageMapError);
    expect(() => spliceStageMap('<!-- stage-map:end -->\n<!-- stage-map:begin -->', 'x')).toThrow(StageMapError);
  });
});

describe('(f) @afldb/acquisition is importable without a database and reaches none', () => {
  const saved = process.env.DATABASE_URL;
  afterEach(() => {
    if (saved === undefined) delete process.env.DATABASE_URL;
    else process.env.DATABASE_URL = saved;
    vi.resetModules();
  });

  it('imports with DATABASE_URL unset and exposes the facade', async () => {
    delete process.env.DATABASE_URL;
    vi.resetModules();
    const mod = await import('@afldb/acquisition');
    for (const name of ['AFL_API_PIPELINE', 'renderAflApiStageMap', 'replayAflApiSnapshot',
      'buildAflApiReconciliationReport', 'evaluateAflApiFixtureProjection', 'requestAflApi',
      'verifyAflApiSnapshotManifest', 'emitAflApiMatch', 'canonicalJson', 'reconcile']) {
      expect(typeof (mod as Record<string, unknown>)[name], name).not.toBe('undefined');
    }
    // Writer-side implementations are cited by path, never re-exported.
    for (const name of ['runSettleAflApi', 'runSettleAflApiBrownlow', 'buildAflApiSettleBundle',
      'applyCanonicalUnit', 'persistSourceObservation', 'recomputePlayerDerivedStats', 'loadAflApiSettleBundle']) {
      expect((mod as Record<string, unknown>)[name], name).toBeUndefined();
    }
  });

  it('the package index runtime closure reaches no src/db, postgres, server-only or writer module', () => {
    const found = findingsFor('packages/acquisition/src/index.ts', diskReader);
    expect(found.closure.files).toContain('packages/acquisition/src/replay.ts');
    expect(found.closure.files).toContain('src/lib/acquisition/afl-api-client.ts');
    expect(found.closure.files).not.toContain('src/db/client.ts');
    expect(found.closure.files).not.toContain('src/db/authClient.ts');
    expect(pick(found)).toEqual(CLEAN);
  });
});
