/**
 * AFLDB-ISSUE-100 L3B2 — the lineup persistence contract, DB-free.
 *
 * The pure half: typed projection derivation, the fail-closed read boundary,
 * and the source assertions that keep the three executable invariants (source
 * ownership, no absence, no delete/truncate) hard to break by accident.
 *
 * The PostgreSQL half — spine linkage, idempotence, revision replay, canonical
 * safety — is `tests/integration/afl-api-lineup-store.test.ts`.
 */
import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import {
  buildLineupBundle,
  type LineupAcquisitionRef,
  type LineupSourceRow,
} from '../src/lib/acquisition/lineup-bundle';
import {
  LineupStoreError,
  assertPersistableLineupBundle,
  projectLineupRecord,
} from '../src/lib/acquisition/lineup-store';
import { resolveSourceId } from '../src/lib/acquisition/observations';
import {
  getSourceFamily,
  parseSourceFamilyRegistry,
} from '../src/lib/acquisition/source-families';

const registry = parseSourceFamilyRegistry(
  JSON.parse(readFileSync('data/reference/source-families.json', 'utf8')),
);
const lineup = getSourceFamily(registry, 'afl_api', 'lineup');
const roster = getSourceFamily(registry, 'afl_api', 'roster');

const R20_COLUMNS = [
  'providerId', 'utcStartTime', 'status', 'compSeason.shortName', 'round.name',
  'round.roundNumber', 'venue.name', 'teamAbbr', 'teamName', 'teamNickname',
  'teamId', 'position', 'player.playerId', 'player.captain',
  'player.playerJumperNumber', 'player.playerName.givenName',
  'player.playerName.surname', 'teamStatus', 'teamType', 'lateChanges',
] as const;

const ACQUISITION: LineupAcquisitionRef = {
  snapshotLabel: 'afl-api-lineups-2026-r20',
  manifestPath: 'data/sources/afl_api/lineups/afl-api-lineups-2026-r20',
  manifestSha256: '',
  artefactSha256: 'b'.repeat(64),
  acquisitionKind: 'round_lineup_snapshot',
  fitzroyVersion: '1.8.0',
};

function row(overrides: Partial<Record<string, unknown>> = {}): LineupSourceRow {
  return {
    'providerId': 'CD_M20260142007',
    'utcStartTime': '2026-08-21T09:20:00.000+00:00',
    'status': 'CONCLUDED',
    'compSeason.shortName': 'Premiership',
    'round.name': 'Round 20',
    'round.roundNumber': 20,
    'venue.name': 'Marvel Stadium',
    'teamAbbr': 'STK',
    'teamName': 'St Kilda',
    'teamNickname': 'Saints',
    'teamId': 'CD_T130',
    'position': 'RK',
    'player.playerId': 'CD_I1023784',
    'player.captain': false,
    'player.playerJumperNumber': 47,
    'player.playerName.givenName': 'Alix',
    'player.playerName.surname': 'Caminiti',
    'teamStatus': 'FINAL_TEAM',
    'teamType': 'away',
    'lateChanges': 'INS: A.Caminiti OUTS: R.Marshall(Injured)',
    ...overrides,
  } as LineupSourceRow;
}

function bundleOf(rows: readonly LineupSourceRow[], columns: readonly string[] = R20_COLUMNS) {
  return buildLineupBundle({
    contract: lineup,
    season: 2026,
    roundNumber: 20,
    observedColumns: columns,
    rows,
    acquisition: ACQUISITION,
  });
}

describe('typed projection', () => {
  it('projects provider identity, scope and announcement state', () => {
    const p = projectLineupRecord(bundleOf([row()]).records[0]);
    expect(p.providerMatchId).toBe('CD_M20260142007');
    expect(p.providerTeamId).toBe('CD_T130');
    expect(p.providerPlayerId).toBe('CD_I1023784');
    expect(p.externalRecordId).toBe('CD_M20260142007|CD_T130|CD_I1023784');
    expect(p.scopeKey).toBe('season=2026;round=20');
    expect(p.status).toBe('CONCLUDED');
    expect(p.teamStatus).toBe('FINAL_TEAM');
    expect(p.teamType).toBe('away');
    expect(p.position).toBe('RK');
    expect(p.roundName).toBe('Round 20');
    expect(p.teamNameRaw).toBe('St Kilda');
    expect(p.teamAbbrRaw).toBe('STK');
    expect(p.teamNicknameRaw).toBe('Saints');
  });

  it('represents the integer jumper number losslessly as text', () => {
    // Migration 077's column is text by AFLDB convention; this is the obvious
    // representation of the source integer and nothing more.
    expect(projectLineupRecord(bundleOf([row()]).records[0]).jumperNumber).toBe('47');
    expect(typeof projectLineupRecord(bundleOf([row()]).records[0]).jumperNumber)
      .toBe('string');
    expect(projectLineupRecord(bundleOf([row({
      'player.playerJumperNumber': 1,
    })]).records[0]).jumperNumber).toBe('1');
    // Absent or NA supplies nothing, so the column is NULL.
    expect(projectLineupRecord(bundleOf([row({
      'player.playerJumperNumber': null,
    })]).records[0]).jumperNumber).toBeNull();
  });

  it('refuses an out-of-domain jumper number rather than nulling a real value', () => {
    for (const bad of [0, -3]) {
      expect(() => projectLineupRecord(bundleOf([row({
        'player.playerJumperNumber': bad,
      })]).records[0])).toThrow(/outside the afl_api_lineup_jumper_ck domain/);
    }
    expect(() => projectLineupRecord(bundleOf([row({
      'player.playerJumperNumber': 4.5,
    })]).records[0])).toThrow(/non-integer jumper number/);
  });

  it('projects no captain and no lateChanges field at all', () => {
    const p = projectLineupRecord(bundleOf([row()]).records[0]);
    expect(Object.keys(p).sort()).toEqual([
      'externalRecordId', 'jumperNumber', 'position', 'providerMatchId',
      'providerPlayerId', 'providerTeamId', 'roundName', 'scopeKey', 'status',
      'teamAbbrRaw', 'teamNameRaw', 'teamNicknameRaw', 'teamStatus', 'teamType',
    ]);
    expect(JSON.stringify(p)).not.toMatch(/captain/i);
    expect(JSON.stringify(p)).not.toMatch(/Caminiti|Marshall|INS:|OUTS:/);
  });

  it('leaves both raw values untouched in the observation payload', () => {
    // The projection is narrower than the payload; the payload keeps everything.
    const record = bundleOf([row()]).records[0];
    expect(record.payload['player.captain']).toBe(false);
    expect(record.payload.lateChanges).toBe('INS: A.Caminiti OUTS: R.Marshall(Injured)');
    // Column absent from the source table stays absent, never a fabricated null.
    const r25 = bundleOf(
      [Object.fromEntries(
        Object.entries(row()).filter(([k]) => k !== 'lateChanges'),
      ) as LineupSourceRow],
      R20_COLUMNS.filter((c) => c !== 'lateChanges'),
    ).records[0];
    expect('lateChanges' in r25.payload).toBe(false);
    // Present-and-NA stays present and null.
    const nulled = bundleOf([row({ lateChanges: null })]).records[0];
    expect(nulled.payload.lateChanges).toBeNull();
  });

  it('refuses a record whose required typed fields are missing', () => {
    for (const column of ['providerId', 'teamId', 'player.playerId', 'status', 'teamStatus']) {
      const record = bundleOf([row()]).records[0];
      const payload = { ...record.payload };
      delete payload[column];
      expect(() => projectLineupRecord({ ...record, payload }))
        .toThrow(LineupStoreError);
    }
  });
});

describe('fail-closed read boundary', () => {
  it('accepts the emitter\'s own bundle', () => {
    expect(() => assertPersistableLineupBundle(bundleOf([row()]), lineup)).not.toThrow();
  });

  it('refuses another source, another family and another contract', () => {
    const bundle = bundleOf([row()]);
    expect(() => assertPersistableLineupBundle(
      { ...bundle, source_key: 'afltables' }, lineup,
    )).toThrow(/never projected into staging\.afl_api_lineup/);
    expect(() => assertPersistableLineupBundle({
      ...bundle,
      records: bundle.records.map((r) => ({ ...r, family: 'roster' })),
    }, lineup)).toThrow(/only lineup records reach staging\.afl_api_lineup/);
    expect(() => assertPersistableLineupBundle(bundle, roster))
      .toThrow(/persists afl_api\/lineup only/);
  });

  it('refuses an undeclared column at the persistence boundary too', () => {
    const bundle = bundleOf([row()]);
    expect(() => assertPersistableLineupBundle({
      ...bundle,
      records: bundle.records.map((r) => ({
        ...r, observed_columns: [...r.observed_columns, 'surpriseColumn'],
      })),
    }, lineup)).toThrow(/undeclared column/);
  });

  it('refuses a bundle claiming a complete enumeration', () => {
    const bundle = bundleOf([row()]);
    expect(() => assertPersistableLineupBundle({
      ...bundle,
      enumerations: bundle.enumerations.map((e) => ({ ...e, complete: true as unknown as false })),
    }, lineup)).toThrow(/absence sweeping is disabled for this family/);
  });
});

describe('source ownership (invariant 1)', () => {
  it('refuses when the afl_api source key cannot be resolved', () => {
    // This is the exact mechanism persistLineupBundle uses inside its
    // transaction; a database with no afl_api row therefore fails closed.
    expect(() => resolveSourceId(new Map([['afltables', 1]]), 'afl_api'))
      .toThrow(/Source 'afl_api' has no sources row/);
    expect(resolveSourceId(new Map([['afl_api', 7]]), 'afl_api')).toBe(7);
  });

  it('exposes no caller-supplied source id on its entry point', () => {
    const source = readFileSync('src/lib/acquisition/lineup-store.ts', 'utf8');
    // The id is resolved internally from the literal key, inside the
    // transaction, by the shared fail-closed helper.
    expect(source).toMatch(/resolveSourceId\(\s*new Map\(sources\.map[\s\S]{0,80}LINEUP_SOURCE_KEY/);
    // The public entry point's own parameter list cannot carry one. Internal
    // helpers legitimately RECEIVE the resolved id; the invariant is that a
    // CALLER cannot supply it.
    const signature = /export async function persistLineupBundle\(([\s\S]*?)\): Promise/
      .exec(source)?.[1];
    expect(signature).toBeDefined();
    expect(signature).not.toMatch(/sourceId/i);
    // ...and nothing reads one off the bundle or the options object.
    expect(source).not.toMatch(/options\.sourceId|bundle\.source_id/);
    const optionsType = /export type LineupPersistOptions = \{([\s\S]*?)\};/
      .exec(source)?.[1];
    expect(optionsType).toBeDefined();
    expect(optionsType).not.toMatch(/sourceId/i);
  });
});

describe('executable invariants (source assertions)', () => {
  /**
   * Executable TypeScript, with comments removed.
   *
   * Both modules DOCUMENT the things they must not do — the header of
   * `lineup-store.ts` names TRUNCATE, `markMissingObservationsAbsent` and
   * `player_match_stats` precisely to state that it never uses them. Asserting
   * over the raw text would match those explanations instead of the code, the
   * same false positive that has already cost this issue three red runs. So
   * every assertion below reads code only.
   */
  function executableTs(source: string): string {
    return source
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/(^|[^:])\/\/[^\n]*/g, '$1');
  }
  const store = executableTs(readFileSync('src/lib/acquisition/lineup-store.ts', 'utf8'));
  const cli = executableTs(readFileSync('tools/rebuild/afl_api/persist_lineups.ts', 'utf8'));

  it('issues no DELETE or TRUNCATE against the typed staging table', () => {
    // afldb_import holds both privileges schema-wide from privileges.sql, so
    // this is the guarantee that actually constrains the behaviour.
    for (const text of [store, cli]) {
      expect(text).not.toMatch(/DELETE\s+FROM/i);
      expect(text).not.toMatch(/\bTRUNCATE\b/i);
    }
    // The projection is maintained by keyed upsert alone.
    expect(store).toContain('ON CONFLICT (source_id, family, external_record_id) DO UPDATE SET');
  });

  it('runs no absence sweep and never writes absent_since', () => {
    for (const text of [store, cli]) {
      expect(text).not.toContain('markMissingObservationsAbsent');
      expect(text).not.toContain('sweepAbsences');
      expect(text).not.toMatch(/absent_since/);
    }
  });

  it('writes no canonical table and creates no promotion candidate', () => {
    for (const canonical of [
      'player_match_stats', 'INSERT INTO players', 'INSERT INTO matches',
      'INSERT INTO clubs', 'promotion_candidates', 'promotion_decisions',
      'data_issues', 'external_identities',
    ]) {
      expect(store).not.toContain(canonical);
      expect(cli).not.toContain(canonical);
    }
    // The only tables this pass writes.
    const written = [...store.matchAll(/INSERT INTO ([\w.]+)/g)].map((m) => m[1]);
    expect([...new Set(written)].sort()).toEqual([
      'import_batches', 'staging.afl_api_lineup',
    ]);
    // `(?!SET)` so the upsert's own `DO UPDATE SET` is not read as a table.
    const updated = [...store.matchAll(/\bUPDATE\s+(?!SET\b)([\w.]+)/g)].map((m) => m[1]);
    expect([...new Set(updated)].sort()).toEqual(['import_batches']);
  });

  it('reaches the spine only through the shared observation store', () => {
    // No second observation/version system: the spine tables are written by
    // observation-store.ts, never by SQL in this module.
    expect(store).toContain('persistSourceObservation');
    expect(store).not.toMatch(/INSERT INTO staging\.source_/);
    expect(store).not.toMatch(/UPDATE staging\.source_/);
  });
});
