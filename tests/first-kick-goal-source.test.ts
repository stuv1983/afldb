/**
 * AFLDB-ISSUE-249 — the first-kick-goal source contract, DB-free.
 *
 * The parser and manifest rules moved out of tools/records/import-first-kick-goal.ts into
 * tools/records/first-kick-goal-source.ts unchanged; these tests pin them, the tracked pin,
 * and every refusal a rebuild relies on before it touches a database. The PostgreSQL half
 * (reconstruction, idempotence, the gate against real rows) is the code_test_db rehearsal.
 */
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  FIRST_KICK_GOAL_EXTRACT, FIRST_KICK_GOAL_MANIFEST, FIRST_KICK_GOAL_PROVENANCE, FirstKickGoalSourceRefused,
  PROJECT_ROOT, activeManifestIds, canonicalSha256, joinManifest, loadPinnedSource, parseCsv,
  parseManifestText, parseProvenance, splitPlayerName, trackedExpectedIds,
} from '../tools/records/first-kick-goal-source';
import type { Deps } from '../tools/db/rebuild-test';

const EXTRACT = [
  'Player,Club,Rd.,Year',
  'Fred Fanning,Melbourne,1,1940',
  'Samson Ryan # (3),Hawthorn,5,2014[8]',
  'Fabian Deluca ## *,Carlton,SF,1999',
  'Old Timer â,Geelong,3,1911',
].join('\n') + '\n';

const MANIFEST = [
  'Id,Player,Club,Rd.,Year,Status',
  'fkg-001,Fred Fanning,Melbourne,1,1940,active',
  'fkg-002,Samson Ryan,Hawthorn,5,2014,active',
  'fkg-003,Fabian Deluca,Carlton,SF,1999,active',
  'fkg-004,Old Timer,Geelong,3,1911,active',
  'fkg-005,Gone Player,Essendon,2,1950,retired',
].join('\n') + '\n';

function provenanceFor(extract: string, manifest: string, over: Record<string, unknown> = {}): string {
  return JSON.stringify({
    extract: 'first-kick-goal.csv',
    extract_sha256: canonicalSha256(Buffer.from(extract)),
    extract_rows: parseCsv(extract).length,
    manifest: 'first-kick-goal-ids.csv',
    manifest_sha256: canonicalSha256(Buffer.from(manifest)),
    manifest_active: activeManifestIds(parseManifestText(manifest, 'm')).length,
    ...over,
  });
}

describe('parsing (moved verbatim from the importer)', () => {
  it('decodes combined legend markers and strips the citation footnote', () => {
    const rows = parseCsv(EXTRACT);
    expect(rows.map((r) => r.playerNameClean)).toEqual(['Fred Fanning', 'Samson Ryan', 'Fabian Deluca', 'Old Timer']);
    expect(rows[1].markers).toEqual({
      consecutiveGoalKicks: 3, noFurtherCareerGoals: false, noFurtherCareerKicks: false, kicklessMatchesBeforeFirstKick: 1,
    });
    expect(rows[1].season).toBe(2014);
    expect(rows[1].seasonFootnoteRaw).toBe('[8]');
    expect(rows[2].markers.kicklessMatchesBeforeFirstKick).toBe(2);
    expect(rows[2].markers.noFurtherCareerGoals).toBe(true);
    expect(rows[3].markers.noFurtherCareerKicks).toBe(true); // the mojibake dagger
    expect(splitPlayerName('Solo').annotation).toBeNull();
  });

  it('refuses an unexpected header, a wrong field count and an unparseable year', () => {
    expect(() => parseCsv('Name,Club,Rd.,Year\n')).toThrow(/Unexpected header/);
    expect(() => parseCsv('Player,Club,Rd.,Year\nA,B,1\n')).toThrow(/expected 4 fields/);
    expect(() => parseCsv('Player,Club,Rd.,Year\nA,B,1,19x0\n')).toThrow(/unparseable year/);
  });

  it('manifest: refuses malformed, duplicate and duplicate-active-name rows; active ids exclude retired', () => {
    const m = parseManifestText(MANIFEST, 'm');
    expect(activeManifestIds(m)).toEqual(['fkg-001', 'fkg-002', 'fkg-003', 'fkg-004']);
    expect(() => parseManifestText('Id,Player\n', 'm')).toThrow(/unexpected header/);
    expect(() => parseManifestText(`${MANIFEST}fkg-01,X,C,1,1990,active\n`, 'm')).toThrow(/malformed stable id/);
    expect(() => parseManifestText(`${MANIFEST}fkg-001,X,C,1,1990,active\n`, 'm')).toThrow(/duplicate stable id/);
    expect(() => parseManifestText(`${MANIFEST}fkg-006,Fred Fanning,C,1,1990,active\n`, 'm')).toThrow(/duplicate active player name/);
  });

  it('joins by clean name to ACTIVE rows only, and reports both unmatched sides', () => {
    const joined = joinManifest(parseCsv(EXTRACT), parseManifestText(MANIFEST, 'm'));
    expect([...joined.idByName.values()]).toEqual(['fkg-001', 'fkg-002', 'fkg-003', 'fkg-004']);
    expect(joined.unmatchedActive).toEqual([]);
    expect(joined.unmatchedExtract).toEqual([]);
    const renamed = joinManifest(parseCsv(EXTRACT.replace('Fred Fanning', 'Freddie Fanning')), parseManifestText(MANIFEST, 'm'));
    expect(renamed.unmatchedActive.map((m) => m.id)).toEqual(['fkg-001']);
    expect(renamed.unmatchedExtract.map((r) => r.playerNameClean)).toEqual(['Freddie Fanning']);
  });
});

describe('canonicalSha256', () => {
  it('folds CRLF to LF at the byte level and hashes everything else as-is', () => {
    expect(canonicalSha256(Buffer.from('a\r\nb\r\n'))).toBe(canonicalSha256(Buffer.from('a\nb\n')));
    expect(canonicalSha256(Buffer.from('a\rb'))).not.toBe(canonicalSha256(Buffer.from('ab')));
    // Mojibake bytes are never re-decoded.
    expect(canonicalSha256(Buffer.from([0xc3, 0x83, 0x0a]))).not.toBe(canonicalSha256(Buffer.from('?\n')));
  });
});

describe('loadPinnedSource: every refusal happens before any database', () => {
  let dir: string;
  const write = (name: string, text: string) => writeFileSync(join(dir, name), text);
  const load = (env: Record<string, string | undefined> = {}) => loadPinnedSource('prov.json', { root: dir, env });

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'fkg-pin-'));
    write('first-kick-goal.csv', EXTRACT);
    write('first-kick-goal-ids.csv', MANIFEST);
    write('prov.json', provenanceFor(EXTRACT, MANIFEST));
  });
  afterEach(() => { rmSync(dir, { recursive: true, force: true }); });

  it('loads the pinned pair, joined exactly, with the expected id set', () => {
    const pinned = load();
    expect(pinned.rows).toHaveLength(4);
    expect(pinned.expectedIds).toEqual(['fkg-001', 'fkg-002', 'fkg-003', 'fkg-004']);
    expect(pinned.extractPath).toBe(join(dir, 'first-kick-goal.csv'));
  });

  it('accepts CRLF copies of the same bytes (autocrlf worktrees, Windows copies)', () => {
    write('first-kick-goal.csv', EXTRACT.replace(/\n/g, '\r\n'));
    write('first-kick-goal-ids.csv', MANIFEST.replace(/\n/g, '\r\n'));
    expect(load().rows).toHaveLength(4);
  });

  it('lets the environment RELOCATE the extract, never change its bytes', () => {
    const elsewhere = mkdtempSync(join(tmpdir(), 'fkg-elsewhere-'));
    try {
      writeFileSync(join(elsewhere, 'x.csv'), EXTRACT);
      rmSync(join(dir, 'first-kick-goal.csv'));
      expect(load({ AFLDB_FIRST_KICK_GOAL_CSV: join(elsewhere, 'x.csv') }).rows).toHaveLength(4);
      writeFileSync(join(elsewhere, 'x.csv'), EXTRACT.replace('1940', '1941'));
      expect(() => load({ AFLDB_FIRST_KICK_GOAL_CSV: join(elsewhere, 'x.csv') })).toThrow(/hashes to .* but prov\.json pins/);
    } finally {
      rmSync(elsewhere, { recursive: true, force: true });
    }
  });

  it('refuses a missing provenance, extract or manifest', () => {
    rmSync(join(dir, 'first-kick-goal.csv'));
    expect(() => load()).toThrow(/extract is missing[\s\S]*gitignored[\s\S]*Nothing was loaded/);
    write('first-kick-goal.csv', EXTRACT);
    rmSync(join(dir, 'first-kick-goal-ids.csv'));
    expect(() => load()).toThrow(/identity manifest is missing/);
    rmSync(join(dir, 'prov.json'));
    expect(() => load()).toThrow(/provenance prov\.json is not in this checkout/);
  });

  it('refuses a changed extract, a changed manifest, and moved counts', () => {
    write('first-kick-goal.csv', EXTRACT.replace('Melbourne', 'Richmond'));
    expect(() => load()).toThrow(FirstKickGoalSourceRefused);
    write('first-kick-goal.csv', EXTRACT);
    write('first-kick-goal-ids.csv', MANIFEST.replace('fkg-005,Gone Player,Essendon,2,1950,retired\n', ''));
    expect(() => load()).toThrow(/re-pinned deliberately/);
    write('first-kick-goal-ids.csv', MANIFEST);
    write('prov.json', provenanceFor(EXTRACT, MANIFEST, { extract_rows: 5 }));
    expect(() => load()).toThrow(/parses to 4 rows, but prov\.json pins 5/);
    write('prov.json', provenanceFor(EXTRACT, MANIFEST, { manifest_active: 3 }));
    expect(() => load()).toThrow(/carries 4 active ids, but prov\.json pins 3/);
  });

  it('refuses an inexact join even when every hash and count is consistently re-pinned', () => {
    const drifted = EXTRACT.replace('Fred Fanning', 'Freddie Fanning');
    write('first-kick-goal.csv', drifted);
    write('prov.json', provenanceFor(drifted, MANIFEST));
    expect(() => load()).toThrow(/ACTIVE manifest row\(s\) match no extract row[\s\S]*fkg-001[\s\S]*Nothing was changed/);
  });

  it('refuses a malformed provenance', () => {
    write('prov.json', '{');
    expect(() => load()).toThrow(/not valid JSON/);
    expect(() => parseProvenance(JSON.stringify({ extract: 'a' }), 'p')).toThrow(/"extract_sha256" must be/);
    expect(() => parseProvenance(provenanceFor(EXTRACT, MANIFEST, { extract_sha256: 'ABC' }), 'p')).toThrow(/not a lowercase sha256/);
    expect(() => parseProvenance(provenanceFor(EXTRACT, MANIFEST, { manifest_active: 0 }), 'p')).toThrow(/positive integer/);
  });
});

describe('the tracked pin (DB-free; needs only the committed files)', () => {
  const root = PROJECT_ROOT;

  it('binds the tracked manifest by hash and active count', () => {
    const prov = parseProvenance(readFileSync(join(root, FIRST_KICK_GOAL_PROVENANCE), 'utf8'), FIRST_KICK_GOAL_PROVENANCE);
    expect(prov.extract).toBe(FIRST_KICK_GOAL_EXTRACT);
    expect(prov.manifest).toBe(FIRST_KICK_GOAL_MANIFEST);
    expect(canonicalSha256(readFileSync(join(root, FIRST_KICK_GOAL_MANIFEST)))).toBe(prov.manifestSha256);
    expect(trackedExpectedIds()).toHaveLength(prov.manifestActive);
    // The extract and the manifest describe the same records one-to-one.
    expect(prov.extractRows).toBe(prov.manifestActive);
  });
});

describe('the code_test_db rehearsal tool refuses every other database (DB-free)', () => {
  it('needs an explicit --acknowledge code_test_db and an evidence directory', async () => {
    const { parseFkgRehearsalArgs, FirstKickGoalRehearsalRefused } = await import('../tools/records/first-kick-goal-rehearsal');
    expect(parseFkgRehearsalArgs(['run', '--acknowledge', 'code_test_db', '--out', '/tmp/e']))
      .toEqual({ step: 'run', out: '/tmp/e', allowOwnerImportDsn: false, realSource: false });
    expect(parseFkgRehearsalArgs(['run', '--real-source', '--acknowledge', 'code_test_db', '--out', '/tmp/e']))
      .toEqual({ step: 'run', out: '/tmp/e', allowOwnerImportDsn: false, realSource: true });
    expect(parseFkgRehearsalArgs(['residue'])).toEqual({ step: 'residue' });
    expect(parseFkgRehearsalArgs(['runner', '--acknowledge', 'code_test_db', '--out', '/tmp/r']))
      .toEqual({ step: 'runner', out: '/tmp/r' });
    for (const bad of [
      ['runner', '--out', '/tmp/r'],
      ['runner', '--acknowledge', 'afldb_test', '--out', '/tmp/r'],
      ['runner', '--acknowledge', 'code_test_db'],
      ['runner', '--acknowledge', 'code_test_db', '--out', '/tmp/r', '--allow-owner-import-dsn'],
      ['runner', '--acknowledge', 'code_test_db', '--out', '/tmp/r', '--real-source'],
      ['run', '--out', '/tmp/e'],
      ['run', '--acknowledge', 'afldb_test', '--out', '/tmp/e'],
      ['run', '--acknowledge', 'afldb_dev', '--out', '/tmp/e'],
      ['run', '--acknowledge', 'code_test_db'],
      ['run', '--acknowledge', 'code_test_db', '--out', '/tmp/e', '--force'],
      ['apply'],
    ]) {
      expect(() => parseFkgRehearsalArgs(bad), bad.join(' ')).toThrow(FirstKickGoalRehearsalRefused);
    }
  });

  it('refuses a DSN naming anything but code_test_db, and a server that disagrees', async () => {
    const { assertRehearsalDatabase, FirstKickGoalRehearsalRefused } = await import('../tools/records/first-kick-goal-rehearsal');
    const { resolveRehearsalDsns } = await import('../tools/migration/afl_api_identity_rebuild_rehearsal_fixture');
    const dsn = (db: string) => `postgres://u:p@127.0.0.1:55432/${db}`;
    for (const db of ['afldb_test', 'afldb_dev', 'afldb_prod', 'afldb_dev_candidate_20260926-033212', 'code_test_db_x']) {
      expect(() => resolveRehearsalDsns({ AFLDB_CODE_TEST_DATABASE_URL: dsn(db) }, { allowOwnerImportDsn: true }), db).toThrow();
    }
    expect(() => resolveRehearsalDsns({
      AFLDB_CODE_TEST_DATABASE_URL: dsn('code_test_db'), AFLDB_CODE_TEST_IMPORT_DATABASE_URL: dsn('afldb_dev'),
    }, { allowOwnerImportDsn: false })).toThrow();
    expect(resolveRehearsalDsns({ AFLDB_CODE_TEST_DATABASE_URL: dsn('code_test_db') }, { allowOwnerImportDsn: true }).database)
      .toBe('code_test_db');
    expect(() => assertRehearsalDatabase('afldb_dev')).toThrow(FirstKickGoalRehearsalRefused);
    expect(() => assertRehearsalDatabase('code_test_db')).not.toThrow();
  });

  it('builds its fixture from the given players plus one unmatched name, pinned by hash', async () => {
    const { buildFixture } = await import('../tools/records/first-kick-goal-rehearsal');
    const dir = mkdtempSync(join(tmpdir(), 'fkg-fixture-'));
    try {
      const f = buildFixture(dir, [
        { playerId: 11, displayName: 'Ann A', club: 'Carlton', season: 1950, round: '4', matchId: 101 },
        { playerId: 22, displayName: 'Bob B', club: 'Geelong', season: 1980, round: '7', matchId: 202 },
      ]);
      expect([...f.expect.entries()]).toEqual([
        ['fkg-001', { playerId: 11, matchId: 101, linkStatus: 'unique' }],
        ['fkg-002', { playerId: 22, matchId: 202, linkStatus: 'unique' }],
        ['fkg-003', { playerId: null, matchId: null, linkStatus: 'unmatched' }],
      ]);
      expect(parseCsv(f.extract)[1].markers.noFurtherCareerGoals).toBe(true);
      writeFileSync(join(dir, 'first-kick-goal.csv'), f.extract);
      writeFileSync(join(dir, 'first-kick-goal-ids.csv'), f.manifest);
      writeFileSync(join(dir, 'p.json'), f.provenance);
      expect(loadPinnedSource(join(dir, 'p.json'), { env: {} }).expectedIds).toEqual(['fkg-001', 'fkg-002', 'fkg-003']);
      expect(() => buildFixture(dir, [{ playerId: 1, displayName: 'A, B', club: 'C', season: 1, round: '1', matchId: 1 }])).toThrow();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('the rebuild-runner rehearsal gate (DB-free): the REAL plan through the REAL executeRebuild', () => {
  const setup = async (status = 0) => {
    const rb = await import('../tools/db/rebuild-test');
    const rh = await import('../tools/records/first-kick-goal-rehearsal');
    const dsn = (db: string, user: string) => `postgres://${user}:p@127.0.0.1:55432/${db}`;
    const opts = rb.parseArgs(['--target', 'code_test_db']);
    const target = rb.resolveTarget({
      AFLDB_CODE_TEST_DATABASE_URL: dsn('code_test_db', 'owner'), AFLDB_CODE_TEST_IMPORT_DATABASE_URL: dsn('code_test_db', 'import'),
    }, opts);
    const stages = rb.planStages(target, rb.resolveFitzroySource(opts), opts);
    const calls = { command: [] as { argv: string[]; env: Record<string, string> }[], sql: 0, validation: 0, logs: [] as string[] };
    const real: Deps = {
      runCommand: (argv, env) => { calls.command.push({ argv, env }); return { status, stdout: 'Reconciled', stderr: '' }; },
      runSql: () => { calls.sql += 1; },
      runValidation: () => { calls.validation += 1; },
      fileExists: () => true,
      log: (line) => { calls.logs.push(line); },
    };
    return { rb, rh, target, stages, calls, real, ids: stages.map((s) => s.id) };
  };

  it('walks the plan in order, executes ONLY first-kick-goal with its planned argv and env, never the reset, and halts before ladder-witness', async () => {
    const { rb, rh, target, stages, calls, real, ids } = await setup();
    const gated = rh.gateRunnerDeps(stages, real);
    expect(() => rb.executeRebuild(stages, target, gated.deps)).toThrow(rh.RunnerRehearsalHalt);
    const at = ids.indexOf('first-kick-goal');
    expect(ids.slice(0, at)).toEqual(expect.arrayContaining(['recreate', 'migrations', 'draftguru', 'derived', 'coleman']));
    expect(ids[at + 1]).toBe('ladder-witness');
    expect(gated.dispatched.map((d) => d.id)).toEqual(ids.slice(0, at + 1));
    expect(gated.dispatched.filter((d) => d.executed)).toEqual([{ id: 'first-kick-goal', executed: true, status: 0 }]);
    expect(calls.command).toEqual([{ argv: rb.firstKickGoalArgv(), env: { AFLDB_IMPORT_DATABASE_URL: target.importDsn } }]);
    expect([calls.sql, calls.validation]).toEqual([0, 0]);
    expect(calls.logs.filter((l) => l.includes('[EXECUTED]'))).toHaveLength(1);
    expect(calls.logs.some((l) => l.includes('LADDER WITNESS') || l.includes('FINAL VALIDATION'))).toBe(false);
    expect(gated.captured.stdout).toBe('Reconciled');
  });

  it('reports a failing stage as the runner does (no halt), and refuses a plan it cannot gate or an off-plan walk', async () => {
    const failing = await setup(1);
    const gated = failing.rh.gateRunnerDeps(failing.stages, failing.real);
    expect(failing.rb.executeRebuild(failing.stages, failing.target, gated.deps))
      .toEqual(expect.objectContaining({ ok: false, failedStage: 'first-kick-goal' }));

    const { rb, rh, target, stages, real } = await setup();
    expect(() => rh.gateRunnerDeps(stages.filter((s) => s.id !== 'first-kick-goal'), real)).toThrow(rh.FirstKickGoalRehearsalRefused);
    expect(() => rh.gateRunnerDeps([...stages, stages.find((s) => s.id === 'first-kick-goal')!], real))
      .toThrow(rh.FirstKickGoalRehearsalRefused);
    // The gate is bound to the plan it was given: a walk in a different order is refused.
    const gated2 = rh.gateRunnerDeps(stages, real);
    const reordered = [stages[1], stages[0], ...stages.slice(2)];
    expect(() => rb.executeRebuild(reordered, target, gated2.deps)).toThrow(rh.FirstKickGoalRehearsalRefused);
  });
});

describe('the importer module', () => {
  it('exports its phases and does not run its CLI on import', async () => {
    const before = process.exitCode;
    const mod = await import('../tools/records/import-first-kick-goal');
    expect(typeof mod.resolveFirstKickGoalRows).toBe('function');
    expect(typeof mod.reconcileFirstKickGoal).toBe('function');
    expect(typeof mod.reportResolution).toBe('function');
    expect(process.exitCode).toBe(before);
  });

  it('keeps one write path: the CLI --apply runs reconcileFirstKickGoal inside sql.begin', () => {
    const src = readFileSync(join(PROJECT_ROOT, 'tools', 'records', 'import-first-kick-goal.ts'), 'utf8').replace(/\r\n/g, '\n');
    const main = src.slice(src.indexOf('async function main('));
    expect(main).toMatch(/await sql\.begin\(\(tx\) => reconcileFirstKickGoal\(/);
    const connect = main.indexOf('postgres(dsn');
    const pinned = main.indexOf('loadPinnedSource(provenance)');
    const validated = main.indexOf('--validate-only: ${rows.length}');
    expect(connect).toBeGreaterThan(0);
    expect(pinned).toBeGreaterThan(0);
    expect(validated).toBeGreaterThan(0);
    // Both the pin and the --validate-only return happen before any connection is opened.
    expect(pinned).toBeLessThan(connect);
    expect(validated).toBeLessThan(connect);
    // The CLI runs only as a script.
    expect(src).toMatch(/if \(process\.argv\[1\] && \/import-first-kick-goal\\\.ts\$\/\.test\(process\.argv\[1\]\)\) \{\n\s+loadEnv\(\);\n\s+main\(\)/);
  });
});
