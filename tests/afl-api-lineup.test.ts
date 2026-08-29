/**
 * AFLDB-ISSUE-100 L2 — the `afl_api.lineup` acquisition and observation bundle.
 *
 * Behavioural tests against the real transformation functions with fixed local
 * fixtures shaped from the P3/P3b measurements. The acquisition contract and
 * adapter get source-contract coverage in the style of
 * `tests/fitzroy-acquisition.test.ts`; everything else drives the emitter.
 *
 * DB-free by construction: nothing here imports a driver, opens a connection or
 * reads a DSN, and the module under test cannot.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

import {
  getSourceFamily,
  parseSourceFamilyRegistry,
  type SourceFamilyContract,
} from '../src/lib/acquisition/source-families';
import {
  LINEUP_FAMILY,
  LINEUP_INCOMPLETE_REASON,
  LINEUP_SOURCE_KEY,
  LineupBundleError,
  buildLineupBundle,
  lineupExternalRecordId,
  lineupPayload,
  lineupAcquisitionInput,
  lineupScopeKey,
  serialiseLineupBundle,
  type LineupAcquisitionRef,
  type LineupSourceRow,
} from '../src/lib/acquisition/lineup-bundle';

const registry = parseSourceFamilyRegistry(
  JSON.parse(readFileSync('data/reference/source-families.json', 'utf8')),
);
const lineup: SourceFamilyContract = getSourceFamily(registry, 'afl_api', 'lineup');

/** The round-20 (20-column) shape, in source order. */
const R20_COLUMNS = [
  'providerId', 'utcStartTime', 'status', 'compSeason.shortName', 'round.name',
  'round.roundNumber', 'venue.name', 'teamAbbr', 'teamName', 'teamNickname',
  'teamId', 'position', 'player.playerId', 'player.captain',
  'player.playerJumperNumber', 'player.playerName.givenName',
  'player.playerName.surname', 'teamStatus', 'teamType', 'lateChanges',
] as const;

/** The round-25 (19-column) shape: the same set without the conditional column. */
const R25_COLUMNS = R20_COLUMNS.filter((c) => c !== 'lateChanges');

const ACQUISITION: LineupAcquisitionRef = {
  snapshotLabel: 'afl-api-lineups-2026-r20',
  manifestPath: 'data/sources/afl_api/lineups/afl-api-lineups-2026-r20/manifest.json',
  manifestSha256: 'a'.repeat(64),
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

function build(rows: readonly LineupSourceRow[], columns: readonly string[] = R20_COLUMNS) {
  return buildLineupBundle({
    contract: lineup,
    season: 2026,
    roundNumber: 20,
    observedColumns: columns,
    rows,
    acquisition: ACQUISITION,
  });
}

// ---------------------------------------------------------------------------
describe('AFLDB-ISSUE-100 acquisition contract (tools/rebuild/afl_api/)', () => {
  const contract = JSON.parse(
    readFileSync('tools/rebuild/afl_api/afl-api-contract.json', 'utf8'),
  );
  const adapter = readFileSync('tools/rebuild/afl_api/acquire_lineups.R', 'utf8');

  it('is a separate source contract, not a fourth fitzRoy acquisition kind', () => {
    // The AFL Tables contract is source-scoped by its own declaration, so a
    // round-bounded AFL API fetch may not be added to it.
    const fitzroy = JSON.parse(
      readFileSync('tools/rebuild/fitzroy/fitzroy-contract.json', 'utf8'),
    );
    expect(fitzroy.source_row_corrections.applies_to_source).toBe('AFL Tables via fitzRoy');
    expect(JSON.stringify(fitzroy)).not.toContain('round_lineup_snapshot');
    expect(JSON.stringify(fitzroy)).not.toContain('fetch_lineup_afl');

    expect(contract.applies_to_source).toBe('AFL.com.au API via fitzRoy');
    expect(contract.source_key).toBe('afl_api');
    expect(contract.lineup.acquisition_kind).toBe('round_lineup_snapshot');
    expect(contract.pinned_version).toBe('1.8.0');
  });

  it('requires an explicit season AND round with no implicit fallback', () => {
    expect(contract.lineup.single_season).toBe(true);
    expect(contract.lineup.single_round).toBe(true);
    expect(contract.lineup.explicit_scope_only).toBe(true);
    expect(contract.lineup.scope_key_grammar).toBe('season=<integer>;round=<integer>');

    // The adapter refuses rather than defaulting either component.
    expect(adapter).toMatch(/--season is REQUIRED|flag, " is REQUIRED/);
    expect(adapter).toContain('require_integer_opt("--season")');
    expect(adapter).toContain('require_integer_opt("--round")');
    // No "latest"/"current" fallback of any kind.
    expect(adapter).not.toMatch(/Sys\.Date\(\).*season|current_season|latest_round/i);
  });

  it('binds the artefact by SHA-256 and never adjudicates', () => {
    expect(adapter).toContain('sha256 = sha256_file(artefact_path)');
    expect(adapter).toContain('completeness = "unvalidated"');
    expect(contract.lineup.verdict_authority).toMatch(/does not adjudicate/);
  });

  it('declares absence disabled and promotion never, in the artefact itself', () => {
    expect(contract.lineup.absence.sweepable).toBe(false);
    expect(contract.lineup.absence.enumeration_complete).toBe(false);
    expect(contract.lineup.promotion_policy).toBe('never');
    expect(adapter).toContain('absence_sweepable = FALSE');
    expect(adapter).toContain('enumeration_complete = FALSE');
  });

  it('keeps acquisition timestamps in the outer manifest only', () => {
    // They exist (repository manifest convention) but are manifest fields, and
    // the emitter never copies them into a payload.
    expect(adapter).toContain('extraction_timestamp_utc');
    expect(JSON.stringify(contract)).not.toContain('extraction_timestamp_utc');
  });

  it('writes a JSON artefact, because CSV cannot carry this family fidelity', () => {
    // NULL, false, 0 and "" must stay four distinct values. An empty CSV field
    // is ambiguous between "" and NA, so CSV would force the reader to invent
    // coercion rules. JSON is lossless for the three types this source returns.
    expect(adapter).toContain('write_json(lineups, artefact_path)');
    expect(adapter).toContain('lineups_%d_r%d.json');
    expect(adapter).not.toContain('write.csv');
  });

  it('declares exactly the five required columns and lateChanges as conditional', () => {
    expect(contract.lineup.required_columns).toEqual([
      'providerId', 'teamId', 'player.playerId', 'status', 'teamStatus',
    ]);
    expect(Object.keys(contract.lineup.conditional_columns)).toEqual(['lateChanges']);
    expect(contract.lineup.external_key).toEqual([
      'providerId', 'teamId', 'player.playerId',
    ]);
    // The encoding is documented as family-local, not as a repository default.
    expect(contract.lineup.external_record_id_encoding).toMatch(/FAMILY-LOCAL/);
  });
});

// ---------------------------------------------------------------------------
describe('external_record_id — family-local pipe encoding', () => {
  it('encodes the declared external key in declared order', () => {
    expect(lineupExternalRecordId(lineup, row()))
      .toBe('CD_M20260142007|CD_T130|CD_I1023784');
    // Declared order is the contract's, not this test's opinion.
    expect(lineup.externalKey).toEqual(['providerId', 'teamId', 'player.playerId']);
  });

  it('is stable for the same tuple and differs for every component', () => {
    expect(lineupExternalRecordId(lineup, row()))
      .toBe(lineupExternalRecordId(lineup, row()));
    for (const column of ['providerId', 'teamId', 'player.playerId']) {
      expect(lineupExternalRecordId(lineup, row({ [column]: 'CD_X999' })))
        .not.toBe(lineupExternalRecordId(lineup, row()));
    }
  });

  it('ignores player names entirely', () => {
    const renamed = row({
      'player.playerName.givenName': 'Someone',
      'player.playerName.surname': 'Different',
      'teamName': 'Not St Kilda',
      'teamNickname': 'Nope',
    });
    expect(lineupExternalRecordId(lineup, renamed))
      .toBe(lineupExternalRecordId(lineup, row()));
  });

  it('refuses a component containing the delimiter rather than escaping it', () => {
    expect(() => lineupExternalRecordId(lineup, row({ teamId: 'CD_T130|CD_T30' })))
      .toThrow(/contains the '\|' delimiter/);
    // Refusal, not repair: no escaped or substituted form is produced.
    expect(() => lineupExternalRecordId(lineup, row({ providerId: 'a|b' })))
      .toThrow(LineupBundleError);
  });

  it('refuses a missing, blank or non-string component', () => {
    const { teamId: _omitted, ...withoutTeam } = row() as Record<string, unknown>;
    expect(() => lineupExternalRecordId(lineup, withoutTeam as LineupSourceRow))
      .toThrow(/missing external-key column 'teamId'/);
    expect(() => lineupExternalRecordId(lineup, row({ teamId: '' })))
      .toThrow(/is blank/);
    expect(() => lineupExternalRecordId(lineup, row({ teamId: '   ' })))
      .toThrow(/is blank/);
    expect(() => lineupExternalRecordId(lineup, row({ teamId: null })))
      .toThrow(/must be a string, found null/);
    expect(() => lineupExternalRecordId(lineup, row({ teamId: 130 })))
      .toThrow(/must be a string, found number/);
  });
});

// ---------------------------------------------------------------------------
describe('scope_key — season + round', () => {
  it('emits the pinned grammar', () => {
    expect(lineupScopeKey(2026, 20)).toBe('season=2026;round=20');
    expect(lineupScopeKey(2026, 25)).toBe('season=2026;round=25');
    expect(lineupScopeKey(2026, 20)).not.toBe(lineupScopeKey(2026, 25));
    // Never season-only: that would overstate what one fetch enumerated.
    expect(lineupScopeKey(2026, 20)).not.toBe('season=2026');
  });

  it('refuses non-integer or out-of-domain components', () => {
    for (const bad of [2026.5, NaN, Infinity, '2026' as unknown as number]) {
      expect(() => lineupScopeKey(bad, 20)).toThrow(/must be an integer/);
    }
    expect(() => lineupScopeKey(2026, 20.5)).toThrow(/round must be an integer/);
    expect(() => lineupScopeKey(1800, 20)).toThrow(/within 1897-2200/);
    expect(() => lineupScopeKey(2026, -1)).toThrow(/must not be negative/);
  });
});

// ---------------------------------------------------------------------------
describe('shape validation through the S1 gate', () => {
  it('accepts both proven shapes', () => {
    expect(() => build([row()], R20_COLUMNS)).not.toThrow();
    const { lateChanges: _absent, ...r25row } = row() as Record<string, unknown>;
    expect(() => build([r25row as LineupSourceRow], R25_COLUMNS)).not.toThrow();
  });

  it('refuses an undeclared 21st column and a missing required field', () => {
    expect(() => build([row()], [...R20_COLUMNS, 'somethingNew']))
      .toThrow(/undeclared column\(s\): somethingNew/);
    expect(() => build([row()], R20_COLUMNS.filter((c) => c !== 'teamStatus')))
      .toThrow(/missing required column\(s\): teamStatus/);
  });

  it('refuses a duplicate external key at row grain', () => {
    expect(() => build([row(), row()]))
      .toThrow(/share external record id/);
  });
});

// ---------------------------------------------------------------------------
describe('payload fidelity', () => {
  it('preserves lateChanges verbatim on every row that carries it', () => {
    const text = 'INS: A.Caminiti OUTS: R.Marshall(Injured)';
    const rows = ['CD_I1', 'CD_I2', 'CD_I3'].map(
      (id) => row({ 'player.playerId': id }),
    );
    const bundle = build(rows);
    expect(bundle.records).toHaveLength(3);
    for (const record of bundle.records) {
      // Repeated exactly as the provider repeats it: raw observation fidelity,
      // not a normalised team-grain fact.
      expect(record.payload.lateChanges).toBe(text);
    }
  });

  it('keeps column-absent, present-null and concrete text as three states', () => {
    // 1. Present with concrete text.
    expect(build([row()]).records[0].payload).toHaveProperty('lateChanges');
    expect(build([row()]).records[0].payload.lateChanges).toBe(
      'INS: A.Caminiti OUTS: R.Marshall(Injured)',
    );

    // 2. Column present, this row's value NA -> present and null.
    const nullRow = build([row({ lateChanges: null })]).records[0];
    expect('lateChanges' in nullRow.payload).toBe(true);
    expect(nullRow.payload.lateChanges).toBeNull();

    // 3. Provider omitted the whole column -> absent from the payload. No
    //    fabricated "" and no fabricated null.
    const { lateChanges: _gone, ...r25row } = row() as Record<string, unknown>;
    const absent = build([r25row as LineupSourceRow], R25_COLUMNS).records[0];
    expect('lateChanges' in absent.payload).toBe(false);
    expect(absent.payload.lateChanges).toBeUndefined();

    // The three are genuinely distinguishable downstream.
    expect(JSON.stringify(absent.payload)).not.toContain('lateChanges');
    expect(JSON.stringify(nullRow.payload)).toContain('"lateChanges":null');
  });

  it('preserves raw player.captain FALSE without converting it to null', () => {
    const record = build([row()]).records[0];
    expect(record.payload['player.captain']).toBe(false);
    expect(record.payload['player.captain']).not.toBeNull();
    // Raw evidence is preserved; the registry still declares no zero-is-missing
    // column, so nothing nulls it and nothing projects it.
    expect(lineup.zeroIsMissingColumns).toEqual([]);
  });

  it('has no captain, substitution or participation projection at all', () => {
    const bundle = build([row()]);
    // L2 resolves nothing: every record's projection is null by construction.
    for (const record of bundle.records) expect(record.projection).toBeNull();
    // Behavioural rather than a source grep: a payload key can only ever be an
    // observed source column, so no derived, parsed or resolved field of any
    // kind — captain, substitution, participation, or a resolved id — can exist
    // in the output. This holds however the module is worded.
    for (const record of bundle.records) {
      for (const key of Object.keys(record.payload)) {
        expect(R20_COLUMNS).toContain(key);
      }
    }
    // And the bundle envelope carries only its declared provenance fields.
    expect(Object.keys(bundle).sort()).toEqual([
      'acquisition_kind', 'artefact_sha256', 'bundle_contract_version', 'counts',
      'enumerations', 'fitzroy_version', 'generated_by', 'manifest_path',
      'manifest_sha256', 'records', 'round_number', 'season', 'snapshot_label',
      'source_key', 'unkeyed_rejections',
    ]);
  });

  it('keeps integers integral and never conflates null, false, 0 and ""', () => {
    const record = build([row({
      'player.playerJumperNumber': 47,
      'venue.name': '',
      'player.captain': false,
      'round.roundNumber': 0,
      'lateChanges': null,
    })]).records[0];
    expect(record.payload['player.playerJumperNumber']).toBe(47);
    expect(Number.isInteger(record.payload['player.playerJumperNumber'])).toBe(true);
    expect(record.payload['venue.name']).toBe('');
    expect(record.payload['player.captain']).toBe(false);
    expect(record.payload['round.roundNumber']).toBe(0);
    expect(record.payload.lateChanges).toBeNull();
    // Four distinct values, four distinct serialisations.
    const json = JSON.stringify(record.payload);
    expect(json).toContain('"venue.name":""');
    expect(json).toContain('"player.captain":false');
    expect(json).toContain('"round.roundNumber":0');
    expect(json).toContain('"lateChanges":null');
  });

  it('carries no source_updated_at and treats utcStartTime as payload only', () => {
    expect(lineup.sourceUpdatedAtField).toBeNull();
    const bundle = build([row()]);
    expect(JSON.stringify(bundle)).not.toContain('source_updated_at');
    expect(bundle.records[0].payload.utcStartTime)
      .toBe('2026-08-21T09:20:00.000+00:00');
  });

  it('carries only observed columns into the payload', () => {
    const record = lineupPayload(row({ notDeclared: 'x' }), R25_COLUMNS);
    expect(record).not.toHaveProperty('notDeclared');
    expect(record).not.toHaveProperty('lateChanges');
    expect(Object.keys(record).sort()).toEqual([...R25_COLUMNS].sort());
  });
});

// ---------------------------------------------------------------------------
describe('enumeration and absence', () => {
  it('always emits complete:false with the pinned reason', () => {
    const bundle = build([row()]);
    expect(bundle.enumerations).toHaveLength(1);
    const [enumeration] = bundle.enumerations;
    expect(enumeration.complete).toBe(false);
    expect(enumeration.scope_key).toBe('season=2026;round=20');
    expect(enumeration.family).toBe(LINEUP_FAMILY);
    expect(enumeration.incomplete_reason).toBe(LINEUP_INCOMPLETE_REASON);
    // The three facts the reason must retain.
    expect(enumeration.incomplete_reason).toMatch(/row-grain/);
    expect(enumeration.incomplete_reason).toMatch(/intentionally incomplete/);
    expect(enumeration.incomplete_reason).toMatch(/absence sweeping is disabled/);
  });

  it('cannot be made complete by any input, count or option', () => {
    for (const rows of [[], [row()], [row(), row({ 'player.playerId': 'CD_I2' })]]) {
      const bundle = build(rows);
      for (const enumeration of bundle.enumerations) {
        expect(enumeration.complete).toBe(false);
      }
      expect(JSON.stringify(bundle)).not.toContain('"complete":true');
    }
    // Stronger than a source grep: `complete` is typed as the literal `false`,
    // so this assignment is a COMPILE-TIME proof that no run, caller or future
    // option can widen it to boolean and emit true. If someone changes the
    // field to `boolean`, typecheck fails here rather than a regex passing.
    const pinnedFalse: false = build([row()]).enumerations[0].complete;
    expect(pinnedFalse).toBe(false);
  });

  it('emits no absence record and no sweep path', () => {
    const bundle = build([row()]);
    expect(bundle.unkeyed_rejections).toEqual([]);
    for (const record of bundle.records) expect(record.rejection).toBeNull();
    const source = readFileSync('src/lib/acquisition/lineup-bundle.ts', 'utf8');
    for (const forbidden of [
      'markMissingObservationsAbsent', 'absent_since', 'absentSince',
      'sweepAbsences', 'observation-store',
    ]) {
      expect(source).not.toContain(forbidden);
    }
  });
});

// ---------------------------------------------------------------------------
describe('determinism', () => {
  const rows = [
    row({ 'player.playerId': 'CD_I3', 'position': 'INT' }),
    row({ 'player.playerId': 'CD_I1', 'position': 'FB' }),
    row({ 'player.playerId': 'CD_I2', 'position': 'RK' }),
  ];

  it('is byte-identical for identical input', () => {
    expect(serialiseLineupBundle(build(rows)))
      .toBe(serialiseLineupBundle(build(rows)));
  });

  it('is unchanged by source row order', () => {
    const reversed = [...rows].reverse();
    const shuffled = [rows[1], rows[2], rows[0]];
    const baseline = serialiseLineupBundle(build(rows));
    expect(serialiseLineupBundle(build(reversed))).toBe(baseline);
    expect(serialiseLineupBundle(build(shuffled))).toBe(baseline);
    // The established bundle contract sorts records by
    // (family, external_record_id), so row order is not carried at all.
    expect(build(reversed).records.map((r) => r.external_record_id)).toEqual([
      'CD_M20260142007|CD_T130|CD_I1',
      'CD_M20260142007|CD_T130|CD_I2',
      'CD_M20260142007|CD_T130|CD_I3',
    ]);
  });

  it('is unchanged by source key order within a row', () => {
    const reordered = rows.map((r) => Object.fromEntries(
      Object.entries(r).reverse(),
    ) as LineupSourceRow);
    expect(serialiseLineupBundle(build(reordered)))
      .toBe(serialiseLineupBundle(build(rows)));
  });

  it('sorts enumeration ids and changes output when content changes', () => {
    expect(build(rows).enumerations[0].external_record_ids)
      .toEqual([...build(rows).enumerations[0].external_record_ids].sort());
    const changed = [...rows.slice(1), row({
      'player.playerId': 'CD_I3', 'position': 'EMERG',
    })];
    expect(serialiseLineupBundle(build(changed)))
      .not.toBe(serialiseLineupBundle(build(rows)));
  });

  it('keeps acquisition timestamps out of the semantic bundle', () => {
    const serialised = serialiseLineupBundle(build(rows));
    expect(serialised).not.toContain('extraction_timestamp_utc');
    expect(serialised).not.toContain('extraction_date');
  });
});

// ---------------------------------------------------------------------------
describe('acquisition -> emitter assembly', () => {
  const manifest = {
    source_key: 'afl_api',
    family: 'lineup',
    season: 2026,
    round_number: 20,
    scope_key: 'season=2026;round=20',
    snapshot_label: 'afl-api-lineups-2026-r20',
    working_directory: 'data/sources/afl_api/lineups/afl-api-lineups-2026-r20',
    acquisition_kind: 'round_lineup_snapshot',
    fitzroy_version_pinned: '1.8.0',
    observed_columns: [...R20_COLUMNS],
    files: [{ dataset: 'lineup', file: 'l.json', rows: 1, columns: 20, sha256: 'c'.repeat(64) }],
  };

  it('assembles emitter input without coercing anything', () => {
    const input = lineupAcquisitionInput(lineup, manifest, [row()]);
    expect(input.season).toBe(2026);
    expect(input.roundNumber).toBe(20);
    expect(input.observedColumns).toEqual([...R20_COLUMNS]);
    expect(input.acquisition.artefactSha256).toBe('c'.repeat(64));
    // Types survive the round trip untouched.
    expect(input.rows[0]['player.captain']).toBe(false);
    expect(input.rows[0]['player.playerJumperNumber']).toBe(47);
    expect(buildLineupBundle(input).records).toHaveLength(1);
  });

  it('takes observed columns from the manifest, not from row keys', () => {
    // A column present but null in every row must still be a declared observed
    // column; re-deriving from row keys would be equivalent here but would
    // silently drop it if a future artefact omitted null keys.
    const input = lineupAcquisitionInput(lineup, manifest, [row({ lateChanges: null })]);
    expect(input.observedColumns).toContain('lateChanges');
    const record = buildLineupBundle(input).records[0];
    expect('lateChanges' in record.payload).toBe(true);
    expect(record.payload.lateChanges).toBeNull();
  });

  it('refuses a manifest for another source, family or shape', () => {
    expect(() => lineupAcquisitionInput(lineup, { ...manifest, source_key: 'afltables' }, []))
      .toThrow(/not afl_api\/lineup/);
    expect(() => lineupAcquisitionInput(lineup, { ...manifest, family: 'roster' }, []))
      .toThrow(/not afl_api\/lineup/);
    expect(() => lineupAcquisitionInput(lineup, { ...manifest, season: '2026' }, []))
      .toThrow(/numeric season and round_number/);
    expect(() => lineupAcquisitionInput(lineup, { ...manifest, files: [] }, []))
      .toThrow(/exactly one artefact file/);
    expect(() => lineupAcquisitionInput(lineup, manifest, { not: 'an array' }))
      .toThrow(/must be an array of source rows/);
  });
});

// ---------------------------------------------------------------------------
describe('boundaries', () => {
  it('is a staging-only path with no database or persistence', () => {
    const source = readFileSync('src/lib/acquisition/lineup-bundle.ts', 'utf8');
    for (const forbidden of [
      'postgres', 'DATABASE_URL', 'AFLDB_', 'INSERT', 'UPDATE ', 'DELETE',
      'TRUNCATE', 'promotion_candidates', 'data_issues', 'staging.',
    ]) {
      expect(source).not.toContain(forbidden);
    }
    expect(lineup.promotionPolicy).toBe('never');
  });

  it('builds this family only', () => {
    const roster = getSourceFamily(registry, 'afl_api', 'roster');
    expect(() => buildLineupBundle({
      contract: roster,
      season: 2026,
      roundNumber: 20,
      observedColumns: R20_COLUMNS,
      rows: [row()],
      acquisition: ACQUISITION,
    })).toThrow(/builds afl_api\/lineup bundles only/);
  });

  it('names the source and family on every record', () => {
    const bundle = build([row()]);
    expect(bundle.source_key).toBe(LINEUP_SOURCE_KEY);
    expect(bundle.season).toBe(2026);
    expect(bundle.round_number).toBe(20);
    expect(bundle.artefact_sha256).toBe('b'.repeat(64));
    for (const record of bundle.records) {
      expect(record.family).toBe(LINEUP_FAMILY);
      expect(record.scope_key).toBe('season=2026;round=20');
    }
  });
});
