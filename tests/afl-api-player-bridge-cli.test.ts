/**
 * AFLDB-ISSUE-228 S9 — DB-free safety tests for the full-season AFL API
 * player-identity evidence CLI (`tools/current-season/emit-afl-api-player-bridge.ts`).
 *
 * Scope is deliberately narrow: the argument contract, the `data/sources/`
 * output guard, the never-silently-overwrite artefact write, the settle
 * deferral contract, and the artefact's numeric-id serialisation. Nothing here
 * opens a database connection, makes a network request, or reads an acquired
 * snapshot from `data/sources/` — the one test that exercises the deferral
 * path passes a `sql` handle that THROWS on any property access, so a
 * regression that reached the database would fail rather than quietly connect.
 */
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, sep } from 'node:path';

import { afterAll, describe, expect, it } from 'vitest';

import type { AflApiDeferral } from '@/lib/acquisition/afl-api-bundle';
import {
  buildAflApiPlayerEvidence,
  type AflApiMatchEvidenceInput,
} from '@/lib/acquisition/afl-api-player-evidence';
import type { AflApiSettleBundle } from '@/lib/acquisition/settle-afl-api';
import {
  PATH_COMPARISON_IS_CASE_INSENSITIVE,
  assertNotUnderDataSources,
  buildEvidenceArtefact,
  matchEvidenceInputFor,
  parseEmitAflApiPlayerBridgeArgs,
  sortKeysDeep,
  writeArtefact,
  type LoadedSnapshot,
} from '../tools/current-season/emit-afl-api-player-bridge';

const tempRoots: string[] = [];

function tempRoot(prefix: string): string {
  const root = mkdtempSync(join(tmpdir(), prefix));
  tempRoots.push(root);
  return root;
}

afterAll(() => {
  for (const root of tempRoots) rmSync(root, { recursive: true, force: true });
});

/* ------------------------------------------------------------------ *
 * 1. Argument contract
 * ------------------------------------------------------------------ */

describe('S9 CLI arguments', () => {
  it('accepts --validate-only by itself', () => {
    const args = parseEmitAflApiPlayerBridgeArgs(['--label', 'afl-api-2026-x', '--validate-only']);
    expect(args.validateOnly).toBe(true);
    expect(args.out).toBeNull();
    expect(args.expectedCensus).toBeNull();
    expect(args.compareArtefacts).toEqual([]);
  });

  it('accepts --out <path> by itself', () => {
    const args = parseEmitAflApiPlayerBridgeArgs(['--label', 'afl-api-2026-x', '--out', 'evidence.json']);
    expect(args.validateOnly).toBe(false);
    expect(args.out).toBe('evidence.json');
  });

  it('refuses --validate-only together with --out', () => {
    expect(() => parseEmitAflApiPlayerBridgeArgs(
      ['--label', 'afl-api-2026-x', '--validate-only', '--out', 'evidence.json'],
    )).toThrow(/mutually exclusive/);
  });

  it('refuses neither mode: there is no implicit output path', () => {
    expect(() => parseEmitAflApiPlayerBridgeArgs(['--label', 'afl-api-2026-x']))
      .toThrow(/Pass either --validate-only or --out <path>\. There is no implicit output path\./);
  });

  it('refuses a partial --expect-* acceptance gate', () => {
    const base = ['--label', 'afl-api-2026-x', '--validate-only'];
    expect(() => parseEmitAflApiPlayerBridgeArgs([...base, '--expect-matches', '217']))
      .toThrow(/all-or-nothing/);
    expect(() => parseEmitAflApiPlayerBridgeArgs([...base, '--expect-matches', '217', '--expect-rows', '9983']))
      .toThrow(/all-or-nothing/);
    expect(() => parseEmitAflApiPlayerBridgeArgs([...base, '--expect-rows', '9983', '--expect-providers', '669']))
      .toThrow(/all-or-nothing/);
  });

  it('accepts all three --expect-* figures together', () => {
    const args = parseEmitAflApiPlayerBridgeArgs([
      '--label', 'afl-api-2026-x', '--validate-only',
      '--expect-matches', '217', '--expect-rows', '9983', '--expect-providers', '669',
    ]);
    expect(args.expectedCensus)
      .toEqual({ matches: 217, playerMatchRows: 9983, distinctProviderPlayers: 669 });
  });

  it('refuses an unknown flag outright', () => {
    expect(() => parseEmitAflApiPlayerBridgeArgs(
      ['--label', 'afl-api-2026-x', '--validate-only', '--dsn', 'postgresql://x/y'],
    )).toThrow("Unknown flag '--dsn'.");
    expect(() => parseEmitAflApiPlayerBridgeArgs(['--label', 'afl-api-2026-x', '--apply']))
      .toThrow("Unknown flag '--apply'.");
  });
});

/* ------------------------------------------------------------------ *
 * 2. The data/sources/ output guard (including its Windows behaviour)
 * ------------------------------------------------------------------ */

describe('S9 CLI output-path guard', () => {
  it('refuses an --out under data/sources/', () => {
    const projectRoot = tempRoot('afldb-issue-228-s9-out-');
    for (const outPath of [
      join(projectRoot, 'data', 'sources', 'foo.json'),
      join(projectRoot, 'data', 'sources'),
      join(projectRoot, 'data', 'sources', 'afl_api', 'matches', 'label', 'manifest.json'),
    ]) {
      expect(() => assertNotUnderDataSources(projectRoot, outPath))
        .toThrow(/REFUSED: .* is under data\/sources\//);
    }
  });

  it('refuses a relative --out that resolves under data/sources/', () => {
    // Resolved paths, not string prefixes: the operator runs this from the
    // repository root, so a bare relative path must be refused too.
    for (const outPath of [join('data', 'sources', 'foo.json'), './data/sources/foo.json']) {
      expect(() => assertNotUnderDataSources(process.cwd(), outPath)).toThrow(/REFUSED/);
    }
    if (sep === '\\') {
      expect(() => assertNotUnderDataSources(process.cwd(), '.\\data\\sources\\foo.json'))
        .toThrow(/REFUSED/);
    }
  });

  it('refuses case-variant data/sources/ paths where the filesystem folds case', () => {
    const projectRoot = tempRoot('afldb-issue-228-s9-case-');
    const variants = [
      join(projectRoot, 'data', 'Sources', 'foo.json'),
      join(projectRoot, 'DATA', 'SOURCES', 'foo.json'),
      join(projectRoot, 'Data', 'SoUrCeS', 'foo.json'),
    ];
    for (const outPath of variants) {
      if (PATH_COMPARISON_IS_CASE_INSENSITIVE) {
        // Windows/macOS: this IS the immutable evidence directory.
        expect(() => assertNotUnderDataSources(projectRoot, outPath)).toThrow(/REFUSED/);
      } else {
        // Linux (the supported runtime): a genuinely different directory,
        // which this guard must not refuse.
        expect(() => assertNotUnderDataSources(projectRoot, outPath)).not.toThrow();
      }
    }
  });

  it('does not refuse a legitimate sibling directory', () => {
    const projectRoot = tempRoot('afldb-issue-228-s9-sibling-');
    for (const outPath of [
      join(projectRoot, 'data', 'source-output', 'foo.json'),
      join(projectRoot, 'data', 'reference', 'foo.json'),
      join(projectRoot, 'data', 'sources-archive', 'foo.json'),
      join(projectRoot, 'data', 'foo.json'),
      join(projectRoot, 'evidence.json'),
    ]) {
      expect(() => assertNotUnderDataSources(projectRoot, outPath)).not.toThrow();
    }
  });
});

/* ------------------------------------------------------------------ *
 * 3. Artefact write safety
 * ------------------------------------------------------------------ */

type ArtefactInput = Parameters<typeof buildEvidenceArtefact>[0];

function artefactFixture(generatedUtc: string, overrides: Partial<ArtefactInput> = {}) {
  return buildEvidenceArtefact({
    season: 2026,
    snapshotLabel: 'afl-api-2026-x',
    snapshotManifestSha256: 'a'.repeat(64),
    builtFromDatabase: 'afldb_dev',
    snapshotCensus: { matches: 1, playerMatchRows: 1, distinctProviderPlayers: 1 },
    expectedCensus: null,
    buildFailures: [],
    inputs: [{ file: 'data/reference/source-families.json', sha256: 'b'.repeat(64) }],
    result: linkedResult(),
    existingArtefactOverlap: null,
    generatedUtc,
    ...overrides,
  });
}

function linkedResult() {
  const providerRow = (providerMatchId: string) => ({
    providerMatchId,
    providerPlayerId: 'CD_I1',
    clubId: 10,
    jumperNumber: 7,
    observedGivenName: 'Test',
    observedSurname: 'Player',
    stats: { kicks: 12, handballs: 9, marks: 4, tackles: 3, goals: 2, behinds: 1, hitouts: 0,
      frees_for: 2, frees_against: 1, inside_50s: 5, clearances: 3, rebounds: 2, goal_assists: 1 },
  });
  const canonicalRow = { playerId: 100, clubId: 10, jumperNumberRaw: '7', surname: 'Player',
    stats: providerRow('CD_M1').stats };
  const matches: AflApiMatchEvidenceInput[] = [
    { providerMatchId: 'CD_M1', canonicalMatchId: 1, unresolvedReason: null,
      providerRows: [providerRow('CD_M1')], canonicalRows: [canonicalRow] },
    { providerMatchId: 'CD_M2', canonicalMatchId: 2, unresolvedReason: null,
      providerRows: [providerRow('CD_M2')], canonicalRows: [canonicalRow] },
  ];
  return buildAflApiPlayerEvidence(matches);
}

describe('S9 CLI artefact write safety', () => {
  it('is a no-op when the existing artefact differs only by generated_utc', () => {
    const root = tempRoot('afldb-issue-228-s9-write-');
    const outPath = join(root, 'evidence.json');
    const first = artefactFixture('2026-09-21T00:00:00.000Z');
    writeFileSync(outPath, `${JSON.stringify(sortKeysDeep(first), null, 2)}\n`, 'utf8');
    const before = readFileSync(outPath, 'utf8');

    const lines: string[] = [];
    expect(() => writeArtefact(
      outPath, artefactFixture('2026-09-22T11:22:33.000Z'), (line) => lines.push(line),
    )).not.toThrow();

    expect(lines.join('\n')).toContain('already exists and is identical (except generated_utc)');
    // Not rewritten: the ORIGINAL timestamp is still on disk.
    expect(readFileSync(outPath, 'utf8')).toBe(before);
    expect(readFileSync(outPath, 'utf8')).toContain('2026-09-21T00:00:00.000Z');
  });

  it('refuses outright when the existing artefact differs materially, and writes nothing', () => {
    const root = tempRoot('afldb-issue-228-s9-refuse-');
    const outPath = join(root, 'evidence.json');
    const stale = artefactFixture('2026-09-21T00:00:00.000Z', { season: 2025 });
    writeFileSync(outPath, `${JSON.stringify(sortKeysDeep(stale), null, 2)}\n`, 'utf8');
    const before = readFileSync(outPath, 'utf8');

    expect(() => writeArtefact(
      outPath, artefactFixture('2026-09-21T00:00:00.000Z'), () => {},
    )).toThrow(/REFUSED: .* already exists with DIFFERENT content/);
    expect(readFileSync(outPath, 'utf8')).toBe(before);
  });

  it('writes a new artefact with deterministic, recursively sorted keys', () => {
    const root = tempRoot('afldb-issue-228-s9-new-');
    const outPath = join(root, 'evidence.json');
    writeArtefact(outPath, artefactFixture('2026-09-21T00:00:00.000Z'), () => {});
    const written = readFileSync(outPath, 'utf8');
    expect(written.endsWith('\n')).toBe(true);
    const keys = Object.keys(JSON.parse(written) as Record<string, unknown>);
    expect(keys).toEqual([...keys].sort());
  });

  it('serialises a linked candidate_player_id as a JSON number, never a string', () => {
    // The postgres.js hazard this guards: an `int8`/text-typed id would arrive
    // as a STRING and be written into the artefact as one, which the Python
    // importer's own typed load would then reject or mis-key.
    const serialised = `${JSON.stringify(sortKeysDeep(artefactFixture('2026-09-21T00:00:00.000Z')), null, 2)}\n`;
    expect(serialised).toContain('"candidate_player_id": 100');
    expect(serialised).not.toContain('"candidate_player_id": "100"');

    const parsed = JSON.parse(serialised) as {
      providers: Record<string, { disposition: string; candidate_player_id: unknown }>;
    };
    expect(parsed.providers.CD_I1.disposition).toBe('linked');
    expect(typeof parsed.providers.CD_I1.candidate_player_id).toBe('number');
    expect(parsed.providers.CD_I1.candidate_player_id).toBe(100);
  });
});

/* ------------------------------------------------------------------ *
 * 4. The settle deferral contract (B2)
 * ------------------------------------------------------------------ */

/**
 * A `sql` handle that throws on ANY property access. The deferral branch must
 * return before the database is touched, so reaching it at all is a failure —
 * this never connects to anything.
 */
function forbiddenSql(): Parameters<typeof matchEvidenceInputFor>[0] {
  return new Proxy({}, {
    get(_target, property) {
      throw new Error(`the deferral path must not touch the database (accessed '${String(property)}')`);
    },
    apply() { throw new Error('the deferral path must not touch the database'); },
  }) as unknown as Parameters<typeof matchEvidenceInputFor>[0];
}

/**
 * The minimum a deferred unit needs: only the fields `matchEvidenceInputFor()`
 * reads before its deferral check — the provider match id, the two team
 * provider ids, the player-stat rows and the two deferral fields.
 */
function deferredUnit(deferrals: {
  matchDeferral: AflApiDeferral | null; rosterDeferral: AflApiDeferral | null;
}): AflApiSettleBundle['units'][number] {
  return {
    bundle: {
      match: {
        sourceRecordId: 'CD_M1',
        homeTeamProviderId: 'CD_T10',
        awayTeamProviderId: 'CD_T20',
      },
      playerStats: [
        { providerPlayerId: 'CD_I1', providerTeamId: 'CD_T10', jumperNumber: 7 },
        { providerPlayerId: 'CD_I2', providerTeamId: 'CD_T20', jumperNumber: 8 },
      ],
      ...deferrals,
    },
    settleRecords: [],
  } as unknown as AflApiSettleBundle['units'][number];
}

const emptySnapshot = { observedNamesByMatch: new Map() } as unknown as LoadedSnapshot;

describe('S9 CLI deferral contract: a deferred unit contributes no identity evidence', () => {
  it('contributes nothing from a unit deferred by matchDeferral', async () => {
    const input = await matchEvidenceInputFor(forbiddenSql(), 1, emptySnapshot, deferredUnit({
      matchDeferral: { reason: 'status_not_concluded', detail: 'POSTGAME' },
      rosterDeferral: null,
    }));

    expect(input.canonicalMatchId).toBeNull();
    expect(input.unresolvedReason).toBe('deferred(status_not_concluded)');
    expect(input.canonicalRows).toEqual([]);

    const result = buildAflApiPlayerEvidence([input]);
    expect(result.counters.canonicalMatchesResolved).toBe(0);
    expect(result.counters.canonicalMatchesUnresolved).toBe(1);
    for (const provider of result.providers) {
      expect(provider.matchedEvidenceCount).toBe(0);
      expect(provider.disposition).toBe('unresolved');
      expect(provider.candidatePlayerId).toBeNull();
      expect(provider.unmatched[0].reason).toBe('match_unresolved(deferred(status_not_concluded))');
    }
    // The rows still count towards the snapshot census — deferred, not dropped.
    expect(result.counters.snapshotPlayerMatchRows).toBe(2);
    expect(result.counters.playerMatchRowsUncovered).toBe(2);
  });

  it('contributes nothing from a unit deferred by rosterDeferral alone', async () => {
    // §7.3 (T3) table row 2: the fixture IS `CONCLUDED`, so `matchDeferral` is
    // null, but the roster is not — `buildAflApiSettleRecords()` defers every
    // `player_match_stats` record of this unit, so the stat vectors are not
    // promotable and must not become identity evidence either.
    const input = await matchEvidenceInputFor(forbiddenSql(), 1, emptySnapshot, deferredUnit({
      matchDeferral: null,
      rosterDeferral: { reason: 'roster_not_concluded', detail: 'LIVE' },
    }));

    expect(input.canonicalMatchId).toBeNull();
    expect(input.unresolvedReason).toBe('deferred(roster_not_concluded)');
    expect(input.canonicalRows).toEqual([]);

    const result = buildAflApiPlayerEvidence([input]);
    expect(result.counters.canonicalMatchesResolved).toBe(0);
    expect(result.counters.canonicalMatchesUnresolved).toBe(1);
    for (const provider of result.providers) {
      expect(provider.matchedEvidenceCount).toBe(0);
      expect(provider.disposition).toBe('unresolved');
      expect(provider.candidatePlayerId).toBeNull();
      expect(provider.unmatched[0].reason).toBe('match_unresolved(deferred(roster_not_concluded))');
    }
    expect(result.counters.providersLinked).toBe(0);
    expect(result.counters.playerMatchRowsCoveredByLinkedProviders).toBe(0);
  });
});
