/**
 * AFLDB-ISSUE-241 / AFLDB-ISSUE-240 — the AFL API bridge loader (`import_afl_api_player_bridge.ts`),
 * its stable-identity artefact contract and its contradiction dedup, DB-free.
 *
 * Carries forward every loader contract the retired Python suite pinned
 * (`tests/python/afl_api_bridge_contract.py`: closed targets, DSN safety, the CLI, the three
 * pre-S9 classes, the S9 season provenance gate, secret-free refusals, the ISSUE-235 P1-P5
 * human-row behaviour), plus the ISSUE-241 acceptance matrix and the ISSUE-240 dedup rules. The
 * adapter runs against `afl-api-identity-fake-db.ts`, a stateful stand-in; the code_test_db
 * rehearsal is the SQL-level proof.
 */
import { mkdtempSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import type { AflApiForwardIdentityResult, AflApiPlayerRemapResult } from '@/lib/acquisition/afl-api-adjudication';
import {
  AFL_API_BRIDGE_IDENTITY_CONTRACT,
  aflApiBridgeFindingRecord,
  aflApiBridgeLinkedRows,
  aflApiContradictionIssueKey,
  aflApiExistingPlayerRef,
  planAflApiBridgeImport,
  type AflApiBridgeExistingRow,
  type AflApiBridgeLinkedRow,
  type AflApiContradictionKeyFields,
} from '@/lib/acquisition/afl-api-bridge-identity';

import {
  BRIDGE_TARGETS,
  ImportRefused,
  importAflApiBridge,
  loadBridgeArtefact,
  parseBridgeImportArgs,
  resolveBridgeDsn,
  type LoadedBridgeArtefact,
} from '../tools/migration/import_afl_api_player_bridge';
import { resolveAflApiPlayerIdentities, resolveAflApiPlayerIdentity } from '../tools/migration/replay_afl_api_adjudications';
import { ambiguousIdentityFixtureRows } from '../tools/db/afl-api-identity-bulk-rehearsal';
import { aflApiRow, afltablesIdentity, emptyWorld, fakeConnection, manualAdminIdentity, seedIdentity, type FakeWorld } from './afl-api-identity-fake-db';

const CONTRACT = { player_identity_contract: AFL_API_BRIDGE_IDENTITY_CONTRACT };
const tempDir = () => mkdtempSync(join(tmpdir(), 'afldb-issue-241-'));

function linked(identity: string | null, hint: number | null = null, extra: Record<string, unknown> = {}) {
  return {
    disposition: 'linked', candidate_player_identity: identity,
    ...(hint === null ? {} : { candidate_player_id: hint }),
    observed_name: 'Test Player', evidence_summary: 'fixture', ...extra,
  };
}

function artefactFile(payload: Record<string, unknown>, dir = tempDir(), name = 'bridge.json'): string {
  const path = join(dir, name);
  writeFileSync(path, JSON.stringify(payload), 'utf8');
  return path;
}

const row = (externalId: string, identity: string, hintPlayerId: number | null = null): AflApiBridgeLinkedRow => ({
  externalId, identity, hintPlayerId, observedName: 'Obs', evidenceSummary: 'fixture', raw: {},
});
const ok = (newPlayerId: number, remappedIdentity: string): AflApiPlayerRemapResult => ({ ok: true, newPlayerId, remappedIdentity });
const fwd = (identity: string): AflApiForwardIdentityResult => ({ ok: true, identity, via: 'afltables' });

/* ------------------------------------------------------------------ *
 * 1. The artefact contract (ISSUE-241)
 * ------------------------------------------------------------------ */

describe('AFLDB-ISSUE-241: the bridge artefact stable-identity contract', () => {
  it('refuses every tracked pre-ISSUE-241 artefact: each is lineage-unbound', () => {
    const dir = join(process.cwd(), 'data', 'reference');
    const files = readdirSync(dir).filter((f) => /^afl-api-(player-bridge|brownlow-name-bridge|player-adjudication)-.*\.json$/.test(f));
    expect(files.length).toBeGreaterThanOrEqual(12);
    for (const file of files) {
      const artefact = JSON.parse(readFileSync(join(dir, file), 'utf8')) as Record<string, unknown>;
      const { rows, problems } = aflApiBridgeLinkedRows(artefact, artefact.match_method as never);
      expect(rows, file).toEqual([]);
      expect(problems, file).toHaveLength(1);
      expect(problems[0], file).toMatch(/lineage-unbound.* refused and never upgraded \(AFLDB-ISSUE-241\)/);
    }
  });

  it('refuses a wrong contract version, a missing, null, blank, padded or prefixed identity, and a malformed hint', () => {
    const refuse = (providers: Record<string, unknown>, contract: unknown = AFL_API_BRIDGE_IDENTITY_CONTRACT) =>
      aflApiBridgeLinkedRows({ player_identity_contract: contract, providers }, 'afl_api_stat_vector_bootstrap').problems;
    expect(refuse({ CD_I1: linked('players/A/A.html') }, 'afldb.afl_api_bridge.stable_identity.v0')[0]).toMatch(/lineage-unbound/);
    expect(refuse({ CD_I1: { disposition: 'linked', candidate_player_id: 5 } })).toEqual([
      'linked provider CD_I1: carries no candidate_player_identity']);
    expect(refuse({ CD_I1: linked(null, 5, { candidate_player_identity_refusal: 'the candidate player has no accepted stable identity' }) }))
      .toEqual(['linked provider CD_I1: carries no candidate_player_identity (emitter: the candidate player has no accepted stable identity)']);
    expect(refuse({ CD_I1: linked('  ') })[0]).toMatch(/carries no candidate_player_identity/);
    expect(refuse({ CD_I1: linked(' players/A/A.html') })[0]).toMatch(/surrounding whitespace/);
    expect(refuse({ CD_I1: linked('afltables:players/A/A.html') })[0]).toMatch(/is the prefixed form/);
    expect(refuse({ CD_I1: linked('manual_admin_edit:2f6c') })[0]).toMatch(/is the prefixed form/);
    expect(refuse({ CD_I1: linked('players/A/A.html', null, { candidate_player_id: '5' }) })[0]).toMatch(/not a positive integer/);
    expect(refuse({ BAD1: linked('players/A/A.html') })[0]).toMatch(/is not a CD_I provider id/);
  });

  it('refuses two linked providers claiming one identity, and a manual row whose declared profile is not its identity', () => {
    expect(aflApiBridgeLinkedRows({ ...CONTRACT, providers: {
      CD_I1: linked('players/A/A.html'), CD_I2: linked('players/A/A.html'),
    } }, 'afl_api_stat_vector_bootstrap').problems).toEqual([
      "linked provider CD_I2: identity 'players/A/A.html' is already claimed by linked provider CD_I1 in the same artefact"]);
    expect(aflApiBridgeLinkedRows({ ...CONTRACT, providers: {
      CD_I293854: linked('players/M/Matthew_Taberner.html', 9321, { canonical_afltables_profile_url: 'players/M/Other.html' }),
    } }, 'afl_api_manual_adjudication').problems[0]).toMatch(/canonical_afltables_profile_url .* is not its candidate_player_identity/);
    // agreement is accepted
    expect(aflApiBridgeLinkedRows({ ...CONTRACT, providers: {
      CD_I293854: linked('players/M/Matthew_Taberner.html', 9321, { canonical_afltables_profile_url: 'players/M/Matthew_Taberner.html' }),
    } }, 'afl_api_manual_adjudication').problems).toEqual([]);
  });

  it('selects only linked rows, sorted, with the hint optional and never required', () => {
    const { rows, problems } = aflApiBridgeLinkedRows({ ...CONTRACT, providers: {
      CD_I4: linked('players/D/D.html', 44), CD_I2: { disposition: 'unresolved' }, CD_I3: { disposition: 'contradictory' },
      CD_I1: linked('players/A/A.html'),
    } }, 'afl_api_stat_vector_season');
    expect(problems).toEqual([]);
    expect(rows.map((r) => [r.externalId, r.identity, r.hintPlayerId])).toEqual([
      ['CD_I1', 'players/A/A.html', null], ['CD_I4', 'players/D/D.html', 44]]);
  });
});

/* ------------------------------------------------------------------ *
 * 2. The planner (ISSUE-241 acceptance matrix)
 * ------------------------------------------------------------------ */

describe('AFLDB-ISSUE-241: planAflApiBridgeImport — resolution by stable identity', () => {
  const plan = (input: {
    rows: AflApiBridgeLinkedRow[]; remap: Record<string, AflApiPlayerRemapResult>;
    existing?: AflApiBridgeExistingRow[]; forward?: Record<number, AflApiForwardIdentityResult>;
  }) => planAflApiBridgeImport({
    evidenceClass: 'afl_api_stat_vector_bootstrap', rows: input.rows, remapByIdentity: new Map(Object.entries(input.remap)),
    existingRows: input.existing ?? [], forwardIdentityByPlayerId: new Map(Object.entries(input.forward ?? {}).map(([k, v]) => [Number(k), v])),
  });

  it('same lineage: the identity resolves to the hint, and the row inserts with no mismatch', () => {
    const p = plan({ rows: [row('CD_I1', 'players/A/A.html', 10)], remap: { 'players/A/A.html': ok(10, 'players/A/A.html') } });
    expect(p.inserts).toEqual([expect.objectContaining({ externalId: 'CD_I1', playerId: 10 })]);
    expect(p.hintMismatches).toEqual([]);
    expect(p.stops).toEqual([]);
  });

  it('renumbered lineage: the same identity now names a new id; the row links THERE and the stale hint is ignored', () => {
    const p = plan({ rows: [row('CD_I1', 'players/A/A.html', 10)], remap: { 'players/A/A.html': ok(777, 'players/A/A.html') } });
    expect(p.inserts).toEqual([expect.objectContaining({ externalId: 'CD_I1', playerId: 777 })]);
    expect(p.hintMismatches).toEqual([{ externalId: 'CD_I1', hintPlayerId: 10, resolvedPlayerId: 777 }]);
  });

  it('a stale hint naming ANOTHER real player is never trusted: the identity still decides', () => {
    // id 10 now belongs to someone else, who even holds an afl_api row: the hint must not matter.
    const p = plan({
      rows: [row('CD_I1', 'players/A/A.html', 10)], remap: { 'players/A/A.html': ok(20, 'players/A/A.html') },
      existing: [{ id: 1, externalId: 'CD_I999', status: 'unique', matchMethod: 'afl_api_stat_vector_bootstrap', playerId: 10 }],
    });
    expect(p.inserts).toEqual([expect.objectContaining({ externalId: 'CD_I1', playerId: 20 })]);
    expect(p.playerCollisions).toEqual([]);
  });

  it('missing, ambiguous, continuity-contradicted or re-rendered identities STOP the whole run', () => {
    const p = plan({
      rows: [row('CD_I1', 'players/A/A.html'), row('CD_I2', 'players/B/B.html'), row('CD_I3', 'players/C/C.html'),
        row('CD_I4', 'players/D/D.html'), row('CD_I5', 'players/E/E.html')],
      remap: {
        'players/A/A.html': { ok: false, reason: 'unresolvable' },
        'players/B/B.html': { ok: false, reason: 'ambiguous' },
        'players/C/C.html': { ok: false, reason: 'continuity_contradiction', ruleId: 'R1', refusal: 'split', continuingPlayerIds: [1], renumberedPlayerIds: [2] },
        'players/D/D.html': ok(4, 'players/D/Other.html'),
        // players/E/E.html deliberately unresolved (absent from the map)
      },
    });
    expect(p.stops.map((s) => s.externalId)).toEqual(['CD_I1', 'CD_I2', 'CD_I3', 'CD_I4', 'CD_I5']);
    expect(p.stops[0].reason).toMatch(/names no player on the target/);
    expect(p.stops[1].reason).toMatch(/names more than one player on the target/);
    expect(p.stops[2].reason).toMatch(/tracked profile_url_continuity rule R1 .*resolve to different target players/);
    expect(p.stops[3].reason).toMatch(/resolved as 'players\/D\/Other.html'/);
    expect(p.stops[4].reason).toMatch(/was not resolved/);
    expect(p.inserts).toEqual([]);
  });

  it('provider collision: a row for the provider on another (or no) player is withheld, never modified', () => {
    for (const existingPlayer of [99, null]) {
      const p = plan({
        rows: [row('CD_I1', 'players/A/A.html')], remap: { 'players/A/A.html': ok(10, 'players/A/A.html') },
        existing: [{ id: 5, externalId: 'CD_I1', status: 'unique', matchMethod: 'afl_api_stat_vector_season', playerId: existingPlayer }],
        forward: { 99: fwd('players/Z/Z.html') },
      });
      expect(p.inserts).toEqual([]);
      expect(p.contradictions).toEqual([expect.objectContaining({ kind: 'provider_already_linked', externalId: 'CD_I1', entityId: 5 })]);
      expect(p.contradictions[0].existing.playerRef).toBe(existingPlayer === null ? 'null_player' : 'players/Z/Z.html');
    }
  });

  it('target-player collision: the resolved player already holds another provider -> withheld', () => {
    const p = plan({
      rows: [row('CD_I1', 'players/A/A.html')], remap: { 'players/A/A.html': ok(10, 'players/A/A.html') },
      existing: [{ id: 6, externalId: 'CD_I600000', status: 'unique', matchMethod: 'afl_api_stat_vector_bootstrap', playerId: 10 }],
      forward: { 10: fwd('players/A/A.html') },
    });
    expect(p.inserts).toEqual([]);
    expect(p.playerCollisions).toEqual([expect.objectContaining({ kind: 'player_already_linked', entityId: 6 })]);
    expect(p.playerCollisions[0].existing.externalId).toBe('CD_I600000');
  });

  it('a human resolved row is never overwritten: same player -> already linked (human); other player -> withheld', () => {
    const human = (playerId: number): AflApiBridgeExistingRow => ({
      id: 7, externalId: 'CD_I1', status: 'resolved', matchMethod: 'afl_api_admin_adjudication', playerId,
    });
    const same = plan({ rows: [row('CD_I1', 'players/A/A.html')], remap: { 'players/A/A.html': ok(10, 'players/A/A.html') }, existing: [human(10)] });
    expect(same.alreadyLinkedHuman).toEqual(['CD_I1']);
    expect(same.inserts).toEqual([]);
    const other = plan({ rows: [row('CD_I1', 'players/A/A.html')], remap: { 'players/A/A.html': ok(10, 'players/A/A.html') }, existing: [human(11)] });
    expect(other.contradictions[0].existing).toEqual(expect.objectContaining({ status: 'resolved', matchMethod: 'afl_api_admin_adjudication' }));
    expect(other.inserts).toEqual([]);
  });

  it('an importer row for the same player is an idempotent already-linked no-op', () => {
    const p = plan({ rows: [row('CD_I1', 'players/A/A.html')], remap: { 'players/A/A.html': ok(10, 'players/A/A.html') },
      existing: [{ id: 1, externalId: 'CD_I1', status: 'unique', matchMethod: 'afl_api_stat_vector_bootstrap', playerId: 10 }] });
    expect(p.alreadyLinked).toEqual(['CD_I1']);
    expect([...p.inserts, ...p.contradictions, ...p.playerCollisions]).toEqual([]);
  });

  it('a planned insert is visible to later rows: two identities resolving to one player -> the second is a collision', () => {
    const p = plan({
      rows: [row('CD_I2', 'players/B/B.html'), row('CD_I1', 'players/A/A.html')],
      remap: { 'players/A/A.html': ok(10, 'players/A/A.html'), 'players/B/B.html': ok(10, 'players/B/B.html') },
    });
    expect(p.inserts.map((i) => i.externalId)).toEqual(['CD_I1']);
    expect(p.playerCollisions.map((c) => [c.externalId, c.existing.externalId])).toEqual([['CD_I2', 'CD_I1']]);
  });
});

/* ------------------------------------------------------------------ *
 * 3. The finding key (ISSUE-240)
 * ------------------------------------------------------------------ */

describe('AFLDB-ISSUE-240: the contradiction finding key', () => {
  const base: AflApiContradictionKeyFields = {
    kind: 'provider_already_linked', externalId: 'CD_I1', evidenceClass: 'afl_api_stat_vector_bootstrap',
    proposedPlayerIdentity: 'players/A/A.html', existingExternalId: 'CD_I1', existingStatus: 'unique',
    existingMatchMethod: 'afl_api_stat_vector_season', existingPlayerRef: 'players/Z/Z.html',
  };

  it('is deterministic and versioned, and changes with every semantic field', () => {
    const key = aflApiContradictionIssueKey(base);
    expect(key).toMatch(/^afl_api_identity_contradiction:v1:[0-9a-f]{64}$/);
    expect(aflApiContradictionIssueKey({ ...base })).toBe(key);
    const variants: Partial<AflApiContradictionKeyFields>[] = [
      { kind: 'player_already_linked' }, { externalId: 'CD_I2' }, { evidenceClass: 'afl_api_stat_vector_season' },
      { proposedPlayerIdentity: 'players/B/B.html' }, { existingExternalId: 'CD_I3' }, { existingStatus: 'resolved' },
      { existingMatchMethod: 'afl_api_admin_adjudication' }, { existingMatchMethod: null }, { existingPlayerRef: 'players/Y/Y.html' },
    ];
    const keys = new Set(variants.map((v) => aflApiContradictionIssueKey({ ...base, ...v })));
    expect(keys.size).toBe(variants.length);
    expect(keys.has(key)).toBe(false);
  });

  it('names the existing player by stable identity; a surrogate only when there is none, so two unidentified players never merge', () => {
    expect(aflApiExistingPlayerRef(10, fwd('players/A/A.html'))).toBe('players/A/A.html');
    expect(aflApiExistingPlayerRef(10, { ok: false, reason: 'no_identity' })).toBe('player_id:10');
    expect(aflApiExistingPlayerRef(11, undefined)).toBe('player_id:11');
    expect(aflApiExistingPlayerRef(null, undefined)).toBe('null_player');
  });

  it('is lineage-stable: the same contradiction on a renumbered database has the same key', () => {
    const keyOn = (proposedId: number, existingId: number) => planAflApiBridgeImport({
      evidenceClass: 'afl_api_stat_vector_bootstrap', rows: [row('CD_I1', 'players/A/A.html')],
      remapByIdentity: new Map([['players/A/A.html', ok(proposedId, 'players/A/A.html')]]),
      existingRows: [{ id: existingId, externalId: 'CD_I1', status: 'unique', matchMethod: 'afl_api_stat_vector_season', playerId: existingId + 1 }],
      forwardIdentityByPlayerId: new Map([[existingId + 1, fwd('players/Z/Z.html')]]),
    }).contradictions[0].issueKey;
    expect(keyOn(10, 5)).toBe(keyOn(9010, 905));
  });

  it('the finding record keeps every legacy detail field and adds the key fields and provenance', () => {
    const f = planAflApiBridgeImport({
      evidenceClass: 'afl_api_stat_vector_bootstrap', rows: [row('CD_I700003', 'players/A/A.html', 500)],
      remapByIdentity: new Map([['players/A/A.html', ok(500, 'players/A/A.html')]]),
      existingRows: [{ id: 55, externalId: 'CD_I600000', status: 'unique', matchMethod: 'afl_api_stat_vector_bootstrap', playerId: 500 }],
      forwardIdentityByPlayerId: new Map([[500, fwd('players/A/A.html')]]),
    }).playerCollisions[0];
    const { details, description } = aflApiBridgeFindingRecord(f, { tool: 'tool.ts', artefactSha256: 'a'.repeat(64) });
    expect(details).toEqual(expect.objectContaining({
      kind: 'player_already_linked', source_key: 'afl_api', external_id: 'CD_I700003', proposed_player_id: 500,
      existing_external_id: 'CD_I600000', existing_status: 'unique', existing_match_method: 'afl_api_stat_vector_bootstrap',
      evidence_summary: 'fixture', proposed_player_identity: 'players/A/A.html',
      provenance: { tool: 'tool.ts', artefact_sha256: 'a'.repeat(64) },
    }));
    expect((details.dedup_key as { fields: unknown }).fields).toEqual(f.keyFields);
    expect(description).toMatch(/Withheld; the existing link was not modified/);
  });
});

/* ------------------------------------------------------------------ *
 * 4. The loader adapter against a stateful fake database
 * ------------------------------------------------------------------ */

function worldWithPlayers(database = 'afldb_test'): FakeWorld {
  const world = emptyWorld(database, 'afldb_import');
  afltablesIdentity(world, 10, 'players/A/A.html');
  afltablesIdentity(world, 20, 'players/B/B.html');
  afltablesIdentity(world, 30, 'players/C/C.html');
  afltablesIdentity(world, 40, 'players/D/D.html');
  return world;
}

function loadedOf(rows: AflApiBridgeLinkedRow[], evidenceClass: LoadedBridgeArtefact['evidenceClass'] = 'afl_api_stat_vector_bootstrap'): LoadedBridgeArtefact {
  return { path: 'fixture.json', fileSha256: 'f'.repeat(64), evidenceClass, rows };
}

const expected = { database: 'afldb_test', role: null };

describe('AFLDB-ISSUE-241/240: importAflApiBridge — modes, idempotency, dedup (stateful fake)', () => {
  it('validate-only runs READ ONLY, writes nothing and reports what apply would do', async () => {
    const world = worldWithPlayers();
    const { connection, statements } = fakeConnection(world);
    const before = JSON.stringify(world);
    const report = await importAflApiBridge({ mode: 'validate-only', connection, expected,
      loaded: loadedOf([row('CD_I1', 'players/A/A.html', 10), row('CD_I2', 'players/B/B.html', 99)]) });
    expect(report.outcome).toBe('READ_ONLY');
    expect(report.linked).toBe(2);
    expect(report.hintMismatches).toEqual([{ externalId: 'CD_I2', hintPlayerId: 99, resolvedPlayerId: 20 }]);
    expect(JSON.stringify(world)).toBe(before);
    expect(statements.every((s) => /read only/.test(s.options))).toBe(true);
    expect(statements.some((s) => /^(INSERT|UPDATE|DELETE)/.test(s.text))).toBe(false);
  });

  it('dry-run executes the write path and rolls it back: no identity, finding or import batch survives', async () => {
    const world = worldWithPlayers();
    aflApiRow(world, { externalId: 'CD_I3', playerId: 40 });
    const before = JSON.stringify(world);
    const { connection, statements } = fakeConnection(world);
    const report = await importAflApiBridge({ mode: 'dry-run', connection, expected,
      loaded: loadedOf([row('CD_I1', 'players/A/A.html'), row('CD_I3', 'players/C/C.html')]) });
    expect(report.outcome).toBe('ROLLED_BACK');
    expect(report.linked).toBe(1);
    expect(report.contradictionsWithheld).toEqual(['CD_I3']);
    expect(report.findingsRecorded).toBe(1);
    expect(statements.some((s) => s.text.startsWith('INSERT INTO external_identities'))).toBe(true);
    expect(statements.some((s) => s.text.startsWith('INSERT INTO import_batches'))).toBe(false);
    expect(JSON.stringify(world)).toBe(before);
  });

  it('apply links by resolved identity, records findings once, and a replay is idempotent (no new link, no duplicate finding)', async () => {
    const world = worldWithPlayers();
    aflApiRow(world, { externalId: 'CD_I3', playerId: 40 }); // provider collision for CD_I3
    aflApiRow(world, { externalId: 'CD_I600000', playerId: 20 }); // player 20 already held
    const loaded = loadedOf([row('CD_I1', 'players/A/A.html', 12345), row('CD_I2', 'players/B/B.html'), row('CD_I3', 'players/C/C.html')]);

    const first = await importAflApiBridge({ mode: 'apply', connection: fakeConnection(world).connection, expected, loaded });
    expect(first.outcome).toBe('COMMITTED');
    expect(first.linked).toBe(1);
    expect(first.playerCollisionsWithheld).toEqual(['CD_I2']);
    expect(first.contradictionsWithheld).toEqual(['CD_I3']);
    expect([first.findingsRecorded, first.findingsAlreadyOpen]).toEqual([2, 0]);
    expect(world.identities.find((r) => r.externalId === 'CD_I1')).toEqual(expect.objectContaining({
      playerId: 10, status: 'unique', candidateCount: 1, matchMethod: 'afl_api_stat_vector_bootstrap', externalUrl: null,
      externalName: 'Obs', notes: 'fixture',
    }));
    expect(world.importBatches).toHaveLength(1);
    expect(world.importBatches[0].status).toBe('completed');
    expect(world.importRejections).toHaveLength(2);
    const findingsAfterFirst = JSON.stringify(world.dataIssues);

    const second = await importAflApiBridge({ mode: 'apply', connection: fakeConnection(world).connection, expected, loaded });
    expect(second.linked).toBe(0);
    expect(second.alreadyLinked).toBe(1);
    expect([second.findingsRecorded, second.findingsAlreadyOpen]).toEqual([0, 2]);
    expect(world.identities.filter((r) => r.sourceKey === 'afl_api')).toHaveLength(3);
    // The first findings are neither duplicated nor rewritten; the replay's detections are still audited.
    expect(JSON.stringify(world.dataIssues)).toBe(findingsAfterFirst);
    expect(world.importRejections).toHaveLength(4);
    expect((world.importRejections[3].payload as { already_open: boolean }).already_open).toBe(true);
  });

  it('a materially different contradiction is recorded as a distinct finding; a resolved one may reopen', async () => {
    const world = worldWithPlayers();
    aflApiRow(world, { externalId: 'CD_I3', playerId: 40 });
    await importAflApiBridge({ mode: 'apply', connection: fakeConnection(world).connection, expected,
      loaded: loadedOf([row('CD_I3', 'players/C/C.html')]) });
    // Same provider, but a different evidence class proposing it: a distinct contradiction.
    await importAflApiBridge({ mode: 'apply', connection: fakeConnection(world).connection, expected,
      loaded: loadedOf([row('CD_I3', 'players/C/C.html')], 'afl_api_stat_vector_season') });
    // Same class, different proposed identity: distinct again.
    await importAflApiBridge({ mode: 'apply', connection: fakeConnection(world).connection, expected,
      loaded: loadedOf([row('CD_I3', 'players/A/A.html')]) });
    expect(world.dataIssues).toHaveLength(3);
    expect(new Set(world.dataIssues.map((d) => d.issueKey)).size).toBe(3);
    // Once the first is resolved, the same contradiction is open again as a NEW row (history kept).
    world.dataIssues[0].resolvedAt = '2026-09-26T00:00:00Z';
    await importAflApiBridge({ mode: 'apply', connection: fakeConnection(world).connection, expected,
      loaded: loadedOf([row('CD_I3', 'players/C/C.html')]) });
    expect(world.dataIssues).toHaveLength(4);
    expect(world.dataIssues[3].issueKey).toBe(world.dataIssues[0].issueKey);
  });

  it('a collision with a row this same run inserts names that row\'s real id (never a placeholder)', async () => {
    const world = worldWithPlayers();
    // players/B/B.html is also an accepted path of player 10, so both rows resolve to player 10.
    world.identities = world.identities.filter((r) => r.externalId !== 'players/B/B.html');
    afltablesIdentity(world, 10, 'players/B/B.html');
    const report = await importAflApiBridge({ mode: 'apply', connection: fakeConnection(world).connection, expected,
      loaded: loadedOf([row('CD_I1', 'players/A/A.html'), row('CD_I2', 'players/B/B.html')]) });
    expect(report.linked).toBe(1);
    expect(report.playerCollisionsWithheld).toEqual(['CD_I2']);
    const inserted = world.identities.find((r) => r.externalId === 'CD_I1')!;
    expect(world.dataIssues).toHaveLength(1);
    expect(world.dataIssues[0].entityId).toBe(inserted.id);
    expect(world.dataIssues[0].description).toContain(`external_identities.id=${inserted.id}`);
  });

  it('a STOP refuses the whole run in every write mode, and nothing is written', async () => {
    for (const mode of ['dry-run', 'apply'] as const) {
      const world = worldWithPlayers();
      manualAdminIdentity(world, 50, 'players/A/A.html'); // players/A/A.html is now ambiguous (across lineages)
      const before = JSON.stringify(world);
      await expect(importAflApiBridge({ mode, connection: fakeConnection(world).connection, expected,
        loaded: loadedOf([row('CD_I2', 'players/B/B.html'), row('CD_I1', 'players/A/A.html')]) }))
        .rejects.toThrow(/CD_I1 \(its identity 'players\/A\/A.html' names more than one player on the target\)/);
      expect(JSON.stringify(world)).toBe(before);
    }
  });

  it('a missing identity (the player is absent on the target) refuses, even with a hint naming a real player', async () => {
    const world = worldWithPlayers();
    await expect(importAflApiBridge({ mode: 'apply', connection: fakeConnection(world).connection, expected,
      loaded: loadedOf([row('CD_I1', 'players/Q/Absent.html', 10)]) })).rejects.toThrow(/names no player on the target/);
    expect(world.identities.some((r) => r.sourceKey === 'afl_api')).toBe(false);
  });

  it('refuses the wrong database or role before reading any identity state', async () => {
    const world = worldWithPlayers('afldb_dev');
    const { connection, statements } = fakeConnection(world);
    await expect(importAflApiBridge({ mode: 'validate-only', connection, expected,
      loaded: loadedOf([row('CD_I1', 'players/A/A.html')]) })).rejects.toThrow(/connected database is 'afldb_dev', not 'afldb_test'/);
    expect(statements).toHaveLength(1);
    const roleWorld = worldWithPlayers('afldb_dev');
    roleWorld.role = 'afldb_owner';
    const role = fakeConnection(roleWorld);
    await expect(importAflApiBridge({ mode: 'apply', connection: role.connection, expected: { database: 'afldb_dev', role: 'afldb_import' },
      loaded: loadedOf([row('CD_I1', 'players/A/A.html')]) })).rejects.toThrow(/session role is 'afldb_owner', not 'afldb_import'/);
    expect(role.statements).toHaveLength(1);
  });

  it('the loader never UPDATEs or DELETEs external_identities (static scan of the .ts source)', () => {
    const source = readFileSync(join(process.cwd(), 'tools', 'migration', 'import_afl_api_player_bridge.ts'), 'utf8');
    expect(source).not.toMatch(/UPDATE external_identities|DELETE FROM external_identities/);
  });
});

/* ------------------------------------------------------------------ *
 * 5. The batch reverse lookup is the single lookup, batched
 * ------------------------------------------------------------------ */

describe('AFLDB-ISSUE-241: resolveAflApiPlayerIdentities agrees with resolveAflApiPlayerIdentity', () => {
  it('returns the same classification for unique, missing and ambiguous identities', async () => {
    const world = worldWithPlayers();
    manualAdminIdentity(world, 60, 'players/B/B.html'); // B ambiguous (across lineages)
    world.identities.push({ id: 900, sourceKey: 'manual_admin_edit', externalId: '2f6c-token', playerId: 70, status: 'resolved',
      matchMethod: 'manual_admin_edit', candidateCount: 0, externalUrl: null, externalName: null, notes: null });
    world.identities.push({ id: 901, sourceKey: 'afltables', externalId: 'players/U/Unaccepted.html', playerId: 80, status: 'ambiguous',
      matchMethod: 'afltables_profile_url', candidateCount: 2, externalUrl: null, externalName: null, notes: null });
    const identities = ['players/A/A.html', 'players/B/B.html', 'players/Q/Missing.html', '2f6c-token', 'players/U/Unaccepted.html'];
    const { connection } = fakeConnection(world);
    await connection.begin('read only', async (tx) => {
      const batch = await resolveAflApiPlayerIdentities(tx, identities);
      for (const identity of identities) {
        expect(batch.get(identity), identity).toEqual(await resolveAflApiPlayerIdentity(tx, identity));
      }
      expect(batch.get('players/A/A.html')).toEqual(ok(10, 'players/A/A.html'));
      expect(batch.get('players/B/B.html')).toEqual({ ok: false, reason: 'ambiguous' });
      expect(batch.get('players/Q/Missing.html')).toEqual({ ok: false, reason: 'unresolvable' });
      expect(batch.get('2f6c-token')).toEqual(ok(70, '2f6c-token'));
      expect(batch.get('players/U/Unaccepted.html')).toEqual({ ok: false, reason: 'unresolvable' });
    });
  });

  it('the fake refuses the unreachable same-source ambiguity, as external_identities_uq does', () => {
    const world = worldWithPlayers();
    expect(() => afltablesIdentity(world, 60, 'players/B/B.html')).toThrow(/external_identities_uq/);
    expect(() => aflApiRow(world, { externalId: 'CD_I9', playerId: 10 })).not.toThrow();
    expect(() => aflApiRow(world, { externalId: 'CD_I9', playerId: 20 })).toThrow(/external_identities_uq/);
  });

  it('the code_test_db rehearsal\'s ambiguous fixture is schema-legal and really resolves as ambiguous', async () => {
    // The first real rehearsal died with external_identities_uq on two afltables rows for one
    // path. The fixture must hold one row per source and still make the lookup ambiguous.
    const path = 'players/Z/Zz239_Ambiguous.html';
    const rows = ambiguousIdentityFixtureRows(path, [50, 60]);
    expect(new Set(rows.map((r) => `${r.sourceKey}\u0000${r.externalId}`)).size).toBe(rows.length);
    expect(new Set(rows.map((r) => r.playerId)).size).toBe(2);
    const world = worldWithPlayers();
    for (const r of rows) {
      seedIdentity(world, { id: 1000 + world.identities.length, sourceKey: r.sourceKey, externalId: r.externalId,
        playerId: r.playerId, status: r.status, matchMethod: r.matchMethod, candidateCount: r.candidateCount,
        externalUrl: null, externalName: null, notes: null });
    }
    await fakeConnection(world).connection.begin('read only', async (tx) => {
      expect(await resolveAflApiPlayerIdentity(tx, path)).toEqual({ ok: false, reason: 'ambiguous' });
      expect((await resolveAflApiPlayerIdentities(tx, [path])).get(path)).toEqual({ ok: false, reason: 'ambiguous' });
    });
  });
});

/* ------------------------------------------------------------------ *
 * 6. CLI, targets, DSNs and artefact loading (ported from the Python contract)
 * ------------------------------------------------------------------ */

describe('import_afl_api_player_bridge.ts — CLI, targets and DSN safety (ported from the retired .py suite)', () => {
  it('keeps the closed target list, its DSN variables and role gates, with no PROD target', () => {
    expect(Object.keys(BRIDGE_TARGETS).sort()).toEqual(['afldb_test', 'dev']);
    expect(BRIDGE_TARGETS.afldb_test).toEqual({ database: 'afldb_test', readDsnEnv: 'AFLDB_TEST_DATABASE_URL',
      writeDsnEnv: 'AFLDB_TEST_IMPORT_DATABASE_URL', readRole: null, writeRole: null });
    expect(BRIDGE_TARGETS.dev).toEqual({ database: 'afldb_dev', readDsnEnv: 'DATABASE_URL',
      writeDsnEnv: 'AFLDB_IMPORT_DATABASE_URL', readRole: 'afldb_app', writeRole: 'afldb_import' });
  });

  it('requires --artefact and exactly one mode, refuses unknown flags and any other target', () => {
    expect(parseBridgeImportArgs(['--validate-only', '--artefact', 'x.json'])).toEqual({ mode: 'validate-only', target: 'afldb_test', artefact: 'x.json' });
    expect(parseBridgeImportArgs(['--apply', '--artefact', 'x.json', '--target', 'dev']).target).toBe('dev');
    expect(() => parseBridgeImportArgs(['--validate-only'])).toThrow(/--artefact is mandatory/);
    expect(() => parseBridgeImportArgs(['--artefact', 'x.json'])).toThrow(/Exactly one of/);
    expect(() => parseBridgeImportArgs(['--apply', '--dry-run', '--artefact', 'x.json'])).toThrow(/Exactly one of/);
    expect(() => parseBridgeImportArgs(['--apply', '--artefact', 'x.json', '--target', 'prod'])).toThrow(/no PROD target exists/);
    expect(() => parseBridgeImportArgs(['--apply', '--artefact', 'x.json', '--dsn', 'postgresql://x/y'])).toThrow(/Unknown argument '--dsn'/);
    expect(() => parseBridgeImportArgs(['--apply', '--artefact'])).toThrow(/--artefact needs a value/);
  });

  it('resolveBridgeDsn: unset refuses, a DSN naming another database refuses without leaking it, the right one passes', () => {
    expect(() => resolveBridgeDsn({}, 'X_DSN', 'afldb_test')).toThrow(/X_DSN is not set/);
    let message = '';
    try {
      resolveBridgeDsn({ X_DSN: 'postgresql://user:supersecretpw@localhost:5432/afldb_dev' }, 'X_DSN', 'afldb_test');
    } catch (error) { message = (error as Error).message; }
    expect(message).toMatch(/does not target \/afldb_test/);
    expect(message).not.toContain('supersecretpw');
    expect(resolveBridgeDsn({ X_DSN: 'postgresql://u:p@localhost:5432/afldb_test' }, 'X_DSN', 'afldb_test')).toMatch(/\/afldb_test$/);
    expect(() => resolveBridgeDsn({ X_DSN: 'mysql://u:p@h/afldb_test' }, 'X_DSN', 'afldb_test')).toThrow(/not a postgresql/);
  });

  it('loadBridgeArtefact: missing file, wrong source, unknown class, changed pinned input and lineage-unbound all refuse', () => {
    const dir = tempDir();
    expect(() => loadBridgeArtefact(join(dir, 'does-not-exist-anywhere.json'), 'afldb_test')).toThrow(/artefact not found: .*does-not-exist-anywhere.json/);
    const providers = { CD_I1: linked('players/A/A.html', 1) };
    expect(() => loadBridgeArtefact(artefactFile({ ...CONTRACT, source_key: 'x', match_method: 'afl_api_stat_vector_bootstrap', providers }, dir, 'a.json'), 'afldb_test'))
      .toThrow(/source_key is "x"/);
    expect(() => loadBridgeArtefact(artefactFile({ ...CONTRACT, source_key: 'afl_api', match_method: 'some_other_bootstrap', providers }, dir, 'b.json'), 'afldb_test'))
      .toThrow(/match_method is "some_other_bootstrap"/);
    writeFileSync(join(dir, 'pinned.txt'), 'v1', 'utf8');
    expect(() => loadBridgeArtefact(artefactFile({ ...CONTRACT, source_key: 'afl_api', match_method: 'afl_api_stat_vector_bootstrap',
      inputs: [{ file: 'pinned.txt', sha256: '0'.repeat(64) }], providers }, dir, 'c.json'), 'afldb_test', dir))
      .toThrow(/pinned input changed on disk since the artefact was built: pinned.txt/);
    expect(() => loadBridgeArtefact(artefactFile({ source_key: 'afl_api', match_method: 'afl_api_stat_vector_bootstrap',
      providers: { CD_I1: { disposition: 'linked', candidate_player_id: 1 } } }, dir, 'd.json'), 'afldb_test'))
      .toThrow(/refused by the stable-identity contract \(AFLDB-ISSUE-241\).*lineage-unbound/);
  });

  it('accepts an identity-bound artefact of each of the three pre-S9 classes for --target afldb_test', () => {
    const dir = tempDir();
    for (const method of ['afl_api_stat_vector_bootstrap', 'afl_api_name_team_season_bootstrap', 'afl_api_manual_adjudication']) {
      const loaded = loadBridgeArtefact(artefactFile({ ...CONTRACT, source_key: 'afl_api', match_method: method,
        providers: { CD_I1: linked('players/A/A.html', 1) } }, dir, `${method}.json`), 'afldb_test');
      expect(loaded.evidenceClass).toBe(method);
      expect(loaded.rows.map((r) => r.identity)).toEqual(['players/A/A.html']);
      expect(loaded.fileSha256).toMatch(/^[0-9a-f]{64}$/);
    }
  });

  it('keeps the S9 target-bound season provenance gate, case for case', () => {
    const dir = tempDir();
    const season = (overrides: Record<string, unknown>) => ({
      ...CONTRACT, source_key: 'afl_api', match_method: 'afl_api_stat_vector_season', built_from_database: 'afldb_dev',
      tool: 'tools/current-season/emit-afl-api-player-bridge.ts', read_only: true, season: 2026,
      snapshot_label: 'afl-api-2026-fixture-label', snapshot_manifest_sha256: '0'.repeat(64),
      existing_claim_comparison: 'unproved_cross_database_id_parity', providers: { CD_I1: linked('players/A/A.html', 1) },
      ...overrides,
    });
    const testNative = { built_from_database: 'afldb_test', tool: 'tools/current-season/emit-afl-api-player-bridge-test.ts' };
    expect(loadBridgeArtefact(artefactFile(season({}), dir, 'ok.json'), 'dev').evidenceClass).toBe('afl_api_stat_vector_season');
    expect(loadBridgeArtefact(artefactFile(season(testNative), dir, 'ok-test.json'), 'afldb_test').evidenceClass).toBe('afl_api_stat_vector_season');
    const refused: [Record<string, unknown>, 'dev' | 'afldb_test'][] = [
      [{}, 'afldb_test'], [{ built_from_database: 'afldb_test' }, 'dev'], [testNative, 'dev'],
      [{ built_from_database: 'afldb_test' }, 'afldb_test'], [{ tool: testNative.tool }, 'afldb_test'],
      [{ ...testNative, tool: null }, 'afldb_test'], [{ ...testNative, read_only: false }, 'afldb_test'],
      [{ ...testNative, snapshot_manifest_sha256: 'abc' }, 'afldb_test'], [{ tool: testNative.tool }, 'dev'],
      [{ read_only: false }, 'dev'], [{ read_only: null }, 'dev'], [{ season: '2026' }, 'dev'], [{ season: true }, 'dev'],
      [{ snapshot_label: '' }, 'dev'], [{ snapshot_label: null }, 'dev'], [{ snapshot_manifest_sha256: 'abc' }, 'dev'],
      [{ snapshot_manifest_sha256: 'A'.repeat(64) }, 'dev'], [{ existing_claim_comparison: 'proved' }, 'dev'],
      [{ existing_claim_comparison: null }, 'dev'],
    ];
    refused.forEach(([overrides, target], i) => {
      expect(() => loadBridgeArtefact(artefactFile(season(overrides), dir, `refused-${i}.json`), target), JSON.stringify(overrides))
        .toThrow(/afl_api_stat_vector_season evidence refused/);
    });
    // Provenance intact but lineage-unbound: still refused (ISSUE-241 binds the season class too).
    const unbound: Record<string, unknown> = season({});
    delete unbound.player_identity_contract;
    expect(() => loadBridgeArtefact(artefactFile(unbound, dir, 'unbound.json'), 'dev')).toThrow(/lineage-unbound/);
  });

  it('refusals are ImportRefused, the one class the CLI reports as "nothing was written"', () => {
    expect(() => parseBridgeImportArgs([])).toThrow(ImportRefused);
  });
});
