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
import { createHash } from 'node:crypto';
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, sep } from 'node:path';

import { afterAll, describe, expect, it } from 'vitest';

import type { AflApiDeferral } from '@/lib/acquisition/afl-api-bundle';
import {
  buildAflApiPlayerEvidence,
  type AflApiMatchEvidenceInput,
} from '@/lib/acquisition/afl-api-player-evidence';
import { aflApiSnapshotRoot } from '@/lib/acquisition/afl-api-snapshot';
import type { AflApiSettleBundle } from '@/lib/acquisition/settle-afl-api';
import {
  DEV_EMITTER_TARGET,
  PATH_COMPARISON_IS_CASE_INSENSITIVE,
  TOOL,
  assertNotUnderDataSources,
  buildEvidenceArtefact,
  matchEvidenceInputFor,
  parseEmitAflApiPlayerBridgeArgs,
  runEmitAflApiPlayerBridgeCli,
  sortKeysDeep,
  writeArtefact,
  type LoadedSnapshot,
} from '../tools/current-season/emit-afl-api-player-bridge';
import {
  TEST_EMITTER_TARGET,
  TEST_TOOL,
  runEmitAflApiPlayerBridgeTestCli,
} from '../tools/current-season/emit-afl-api-player-bridge-test';

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
    identityByPlayerId: new Map([[100, { ok: true, identity: 'players/T/Test_Player.html', via: 'afltables' }]]),
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

  it('AFLDB-ISSUE-241: declares the stable-identity contract and binds each linked row to its identity', () => {
    const artefact = artefactFixture('2026-09-21T00:00:00.000Z');
    expect(artefact.player_identity_contract).toBe('afldb.afl_api_bridge.stable_identity.v1');
    expect(artefact.player_identity_binding).toEqual({ bound: 1, unbound: 0 });
    const row = (artefact.providers as Record<string, Record<string, unknown>>).CD_I1;
    expect(row.candidate_player_identity).toBe('players/T/Test_Player.html');
    // The id is still written, as a hint only; the loader never chooses a player by it.
    expect(row.candidate_player_id).toBe(100);
    expect(row).not.toHaveProperty('candidate_player_identity_refusal');
  });

  it('AFLDB-ISSUE-241: a linked candidate with no accepted identity is written unbound, with the reason', () => {
    for (const [identityByPlayerId, reason] of [
      [new Map(), 'the candidate player was not found in the evidence database'],
      [new Map([[100, { ok: false, reason: 'no_identity' }]]), 'the candidate player has no accepted stable identity'],
      [new Map([[100, { ok: false, reason: 'ambiguous' }]]), 'the candidate player holds more than one accepted stable identity'],
    ] as const) {
      const artefact = artefactFixture('2026-09-21T00:00:00.000Z', {
        identityByPlayerId: identityByPlayerId as ArtefactInput['identityByPlayerId'],
      });
      const row = (artefact.providers as Record<string, Record<string, unknown>>).CD_I1;
      expect(row.candidate_player_identity).toBeNull();
      expect(row.candidate_player_identity_refusal).toBe(reason);
      expect(artefact.player_identity_binding).toEqual({ bound: 0, unbound: 1 });
    }
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

/* ------------------------------------------------------------------ *
 * 5. S9 tooling gap (2026-09-23): the afldb_test-native entry point
 * ------------------------------------------------------------------ */

/**
 * A minimal, hash-valid acquired snapshot under a temp project root, plus
 * copies of the two tracked reference inputs the emitter pins. Nothing under
 * the real `data/sources/` is read.
 */
function snapshotProject(label: string): string {
  const projectRoot = tempRoot('afldb-issue-228-s9-target-');
  mkdirSync(join(projectRoot, 'data', 'reference'), { recursive: true });
  for (const file of ['source-families.json', 'afl-api-identities.json']) {
    copyFileSync(join(process.cwd(), 'data', 'reference', file), join(projectRoot, 'data', 'reference', file));
  }
  const snapshotDir = join(aflApiSnapshotRoot(projectRoot), label);
  mkdirSync(join(snapshotDir, 'CD_M20260100001'), { recursive: true });
  const payloads: Record<string, unknown> = {
    'CD_M20260100001/fixture.json': { providerId: 'CD_M20260100001' },
    'CD_M20260100001/match-roster.json': { match: { venueLocalStartTime: '2026-03-12T19:40:00' } },
    'CD_M20260100001/player-stats.json': { homeTeamPlayerStats: [], awayTeamPlayerStats: [] },
  };
  const files: { file: string; sha256: string }[] = [];
  for (const [rel, body] of Object.entries(payloads)) {
    const text = `${JSON.stringify(body)}\n`;
    writeFileSync(join(snapshotDir, ...rel.split('/')), text, 'utf8');
    files.push({ file: rel, sha256: createHash('sha256').update(text).digest('hex') });
  }
  writeFileSync(join(snapshotDir, 'manifest.json'),
    JSON.stringify({ source_key: 'afl_api', season: 2026, files }, null, 2), 'utf8');
  return projectRoot;
}

/**
 * A fake read-only session that reports `currentDatabase` for the identity
 * proof, answers the `afl_api` source lookup, and records every statement.
 */
function fakeSession(currentDatabase: string) {
  const statements: string[] = [];
  const sql = ((strings: TemplateStringsArray) => {
    const text = strings.join('?');
    statements.push(text);
    if (text.includes('current_database()')) {
      return Promise.resolve([{
        currentDatabase, currentRole: 'afldb_reader',
        transactionReadOnly: 'on', defaultTransactionReadOnly: 'on',
      }]);
    }
    if (text.includes('FROM sources')) return Promise.resolve([{ id: 7 }]);
    return Promise.reject(new Error(`unexpected statement: ${text}`));
  }) as unknown as NonNullable<Parameters<typeof runEmitAflApiPlayerBridgeCli>[1]>['sql'];
  return { sql, statements };
}

describe('S9 tooling gap: each entry point is pinned to its own database in code', () => {
  it('pins DEV to afldb_dev and TEST to afldb_test, with distinct tool paths', () => {
    expect(DEV_EMITTER_TARGET.evidence).toEqual({ database: 'afldb_dev', dsnEnv: 'AFLDB_DEV_DATABASE_URL' });
    expect(TEST_EMITTER_TARGET.evidence).toEqual({ database: 'afldb_test', dsnEnv: 'AFLDB_TEST_DATABASE_URL' });
    expect(DEV_EMITTER_TARGET.tool).toBe(TOOL);
    expect(TEST_EMITTER_TARGET.tool).toBe(TEST_TOOL);
    expect(TEST_TOOL).not.toBe(TOOL);
  });

  it('neither entry point accepts a target, database or DSN on argv', () => {
    for (const flag of ['--target', '--database', '--dsn']) {
      expect(() => parseEmitAflApiPlayerBridgeArgs(['--label', 'x', '--validate-only', flag, 'afldb_dev']))
        .toThrow(`Unknown flag '${flag}'.`);
    }
  });

  it('the DEV emitter still refuses a live afldb_test session before any evidence statement', async () => {
    const label = 'afl-api-2026-target-dev';
    const { sql, statements } = fakeSession('afldb_test');
    await expect(runEmitAflApiPlayerBridgeCli(['--label', label, '--validate-only'], {
      projectRoot: snapshotProject(label), sql, log: () => {},
    })).rejects.toThrow(/connected database is 'afldb_test', not 'afldb_dev'/);
    expect(statements).toHaveLength(1);
  });

  it('the TEST emitter refuses every live database except afldb_test', async () => {
    for (const db of ['afldb_dev', 'afldb', 'afldb_prod']) {
      const label = `afl-api-2026-target-${db}`;
      const { sql, statements } = fakeSession(db);
      await expect(runEmitAflApiPlayerBridgeTestCli(['--label', label, '--validate-only'], {
        projectRoot: snapshotProject(label), sql, log: () => {},
      })).rejects.toThrow(new RegExp(`connected database is '${db}', not 'afldb_test'`));
      expect(statements).toHaveLength(1);
    }
  });

  it('the TEST emitter refuses a missing or foreign DSN before connecting', async () => {
    const label = 'afl-api-2026-target-dsn';
    const projectRoot = snapshotProject(label);
    const saved = process.env.AFLDB_TEST_DATABASE_URL;
    try {
      delete process.env.AFLDB_TEST_DATABASE_URL;
      await expect(runEmitAflApiPlayerBridgeTestCli(['--label', label, '--validate-only'], {
        projectRoot, log: () => {},
      })).rejects.toThrow(/AFLDB_TEST_DATABASE_URL is not set/);
      process.env.AFLDB_TEST_DATABASE_URL = 'postgresql://u:p@127.0.0.1:1/afldb_dev';
      await expect(runEmitAflApiPlayerBridgeTestCli(['--label', label, '--validate-only'], {
        projectRoot, log: () => {},
      })).rejects.toThrow(/does not target \/afldb_test/);
    } finally {
      if (saved === undefined) delete process.env.AFLDB_TEST_DATABASE_URL;
      else process.env.AFLDB_TEST_DATABASE_URL = saved;
    }
  });

  it('a live afldb_test session yields an artefact that declares itself afldb_test-native', async () => {
    const label = 'afl-api-2026-target-ok';
    const { sql } = fakeSession('afldb_test');
    const outcome = await runEmitAflApiPlayerBridgeTestCli(['--label', label, '--validate-only'], {
      projectRoot: snapshotProject(label), sql, log: () => {},
    });
    expect(outcome.artefact.built_from_database).toBe('afldb_test');
    expect(outcome.artefact.tool).toBe(TEST_TOOL);
    expect(outcome.artefact.read_only).toBe(true);
    expect(outcome.artefact.match_method).toBe('afl_api_stat_vector_season');
    expect(outcome.artefact.snapshot_label).toBe(label);
    expect(outcome.artefact.snapshot_manifest_sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(outcome.artefact.existing_claim_comparison).toBe('unproved_cross_database_id_parity');
  });

  it('never copies candidate ids from a --compare-artefact (provider-id sets only)', async () => {
    const label = 'afl-api-2026-target-compare';
    const projectRoot = snapshotProject(label);
    const devArtefact = join(projectRoot, 'dev-bridge.json');
    writeFileSync(devArtefact, JSON.stringify({
      built_from_database: 'afldb_dev',
      providers: { CD_I424242: { disposition: 'linked', candidate_player_id: 987654 } },
    }), 'utf8');
    const { sql } = fakeSession('afldb_test');
    const outcome = await runEmitAflApiPlayerBridgeTestCli(
      ['--label', label, '--validate-only', '--compare-artefact', devArtefact],
      { projectRoot, sql, log: () => {} },
    );
    expect(outcome.artefact.providers).not.toHaveProperty('CD_I424242');
    expect(JSON.stringify(outcome.artefact)).not.toContain('987654');
  });
});

describe('S9 tooling gap: candidate ids come from the selected database\'s own rows', () => {
  it('the same provider evidence links to whichever canonical id the queried database holds', () => {
    const providerRow = (providerMatchId: string) => ({
      providerMatchId, providerPlayerId: 'CD_I1', clubId: 10, jumperNumber: 7,
      observedGivenName: 'Test', observedSurname: 'Player',
      stats: { kicks: 12, handballs: 9, marks: 4, tackles: 3, goals: 2, behinds: 1, hitouts: 0,
        frees_for: 2, frees_against: 1, inside_50s: 5, clearances: 3, rebounds: 2, goal_assists: 1 },
    });
    const evidenceFrom = (canonicalPlayerId: number) => buildAflApiPlayerEvidence(['CD_M1', 'CD_M2'].map(
      (id, i): AflApiMatchEvidenceInput => ({
        providerMatchId: id, canonicalMatchId: i + 1, unresolvedReason: null,
        providerRows: [providerRow(id)],
        canonicalRows: [{ playerId: canonicalPlayerId, clubId: 10, jumperNumberRaw: '7', surname: 'Player',
          stats: providerRow(id).stats }],
      }),
    ));
    expect(evidenceFrom(100).providers[0].candidatePlayerId).toBe(100);
    expect(evidenceFrom(555).providers[0].candidatePlayerId).toBe(555);
  });

  it('is not bounded by a fixed match corpus: every supplied match is classified', () => {
    const inputs: AflApiMatchEvidenceInput[] = Array.from({ length: 217 }, (_, i) => ({
      providerMatchId: `CD_M2026${String(i).padStart(5, '0')}`, canonicalMatchId: null,
      unresolvedReason: 'no_canonical_match', providerRows: [], canonicalRows: [],
    }));
    const result = buildAflApiPlayerEvidence(inputs);
    expect(result.matches).toHaveLength(217);
    expect(result.counters.canonicalMatchesUnresolved).toBe(217);
  });
});
