/**
 * AFLDB-ISSUE-239 — `recover_afl_api_adjudications.ts`: recovering AFL API human adjudications
 * outside D15, DB-free.
 *
 * The scenario D15 does not cover: a live database has lost `afl_api_identity_adjudications`
 * (restored from an older backup, truncated, or rebuilt from a dump taken before the decisions),
 * possibly on a renumbered lineage, while a hash-bound record of the ledger survives (a recovery
 * export, or an archived `db:test:rebuild` combined capture). The recovery must restore the
 * decisions verbatim through stable identity, let the D15 replay produce the outcome, and refuse
 * anything else. It runs against `afl-api-identity-fake-db.ts`; the code_test_db rehearsal is
 * the SQL-level proof.
 */
import { createHash } from 'node:crypto';

import { describe, expect, it } from 'vitest';

import {
  ADJUDICATION_RECOVERY_FORMAT,
  AdjudicationRecoveryRefused,
  assertExportSourceDatabase,
  buildAdjudicationRecoveryExport,
  exportAdjudicationLedger,
  parseAdjudicationRecoverySource,
  parseRecoveryArgs,
  planLedgerRecovery,
  recoverAflApiAdjudications,
  resolveRecoveryDsn,
  type AdjudicationRecoverySource,
} from '../tools/migration/recover_afl_api_adjudications';
import { buildCombinedCapture, sameLedgerRow, type CapturedLedgerRow } from '../tools/migration/rebuild_afl_api_adjudications';
import { recoveryFixtureLedgerRows } from '../tools/db/afl-api-identity-bulk-rehearsal';
import {
  afltablesIdentity, aflApiRow, emptyWorld, fakeConnection, manualAdminIdentity, pgJsonbText, type FakeLedgerRow, type FakeWorld,
} from './afl-api-identity-fake-db';

const ADMIN = { email: 'Admin.One@afldb.example', role: 'super_admin' };
const sha = (s: string) => createHash('sha256').update(s).digest('hex');

function ledgerRow(id: number, externalId: string, action: 'linked' | 'revoked', playerId: number, playerIdentity: string,
  supersedesId: number | null = null, adminUserId = 1): FakeLedgerRow {
  return {
    id, sourceKey: 'afl_api', externalId, action, playerId, playerIdentity,
    previousState: action === 'revoked' ? '{"status": "resolved"}' : null,
    // Stored ledger text is PostgreSQL's jsonb rendering (`pgJsonbText`): shorter keys first.
    evidence: `{"row": ${id}, "provider": "${externalId}"}`, evidenceSha256: sha(`evidence-${id}`),
    surnameDisagreementAcknowledged: false, supersedesId, adminUserId,
    note: `A human decision recorded for ${externalId} (row ${id}).`,
    createdAt: `2026-09-2${id}T01:02:03.456789Z`,
  };
}

/**
 * The world the decisions were made in: players A=10, B=20, C=30; CD_I1 linked to A (live);
 * CD_I2 linked to B then revoked; so the one live outcome is CD_I1 -> A.
 */
function originalWorld(): FakeWorld {
  const world = emptyWorld('afldb_dev');
  afltablesIdentity(world, 10, 'players/A/A.html');
  afltablesIdentity(world, 20, 'players/B/B.html');
  afltablesIdentity(world, 30, 'players/C/C.html');
  world.authUsers.push({ id: 1, ...ADMIN });
  world.ledger.push(
    ledgerRow(1, 'CD_I1', 'linked', 10, 'players/A/A.html'),
    ledgerRow(2, 'CD_I2', 'linked', 20, 'players/B/B.html'),
    ledgerRow(3, 'CD_I2', 'revoked', 20, 'players/B/B.html', 2),
  );
  world.identities.push({ id: 100, sourceKey: 'afl_api', externalId: 'CD_I1', playerId: 10, status: 'resolved',
    matchMethod: 'afl_api_admin_adjudication', candidateCount: 0, externalUrl: null, externalName: null, notes: 'human' });
  world.sequence = { lastValue: 3, isCalled: true };
  return world;
}

/** The same deployment after the loss: players renumbered (A=110, B=120, C=130), no ledger,
 * no human outcome, no actor account, the sequence restarted. */
function lostWorld(): FakeWorld {
  const world = emptyWorld('afldb_dev');
  afltablesIdentity(world, 110, 'players/A/A.html');
  afltablesIdentity(world, 120, 'players/B/B.html');
  afltablesIdentity(world, 130, 'players/C/C.html');
  return world;
}

async function exportOf(world: FakeWorld, ledgerOf: 'afldb_dev' | 'afldb_test' | 'code_test_db' = 'afldb_dev') {
  return fakeConnection(world).connection.begin('isolation level repeatable read read only',
    (tx) => exportAdjudicationLedger(tx, { ledgerOf, capturedAt: '2026-09-26T00:00:00.000Z' }));
}

async function sourceOf(world: FakeWorld): Promise<AdjudicationRecoverySource> {
  const exported = await exportOf(world);
  return parseAdjudicationRecoverySource(JSON.stringify(exported), exported.payloadSha256);
}

describe('AFLDB-ISSUE-239: the recovery source', () => {
  it('export reads the ledger read-only, verbatim, with each actor by e-mail and role', async () => {
    const exported = await exportOf(originalWorld());
    expect(exported.format).toBe(ADJUDICATION_RECOVERY_FORMAT);
    expect(exported.ledgerDatabase).toBe('afldb_dev');
    expect(exported.sourceDatabase).toBe('afldb_dev');
    expect(exported.ledgerRows.map((r) => [r.id, r.externalId, r.action, r.playerIdentity, r.supersedesId, r.adminEmail, r.adminRole]))
      .toEqual([
        [1, 'CD_I1', 'linked', 'players/A/A.html', null, ADMIN.email, 'super_admin'],
        [2, 'CD_I2', 'linked', 'players/B/B.html', null, ADMIN.email, 'super_admin'],
        [3, 'CD_I2', 'revoked', 'players/B/B.html', 2, ADMIN.email, 'super_admin'],
      ]);
    expect(exported.payloadSha256).toMatch(/^[0-9a-f]{64}$/);
    // Deterministic: the same ledger exports to the same payload hash.
    expect((await exportOf(originalWorld())).payloadSha256).toBe(exported.payloadSha256);
  });

  it('export refuses a writable transaction, PROD, and a live database exported as another', async () => {
    await expect(fakeConnection(originalWorld()).connection.begin('isolation level read committed',
      (tx) => exportAdjudicationLedger(tx, { ledgerOf: 'afldb_dev', capturedAt: 'x' }))).rejects.toThrow(/read-only transaction/);
    expect(() => assertExportSourceDatabase('afldb_prod', 'afldb_dev')).toThrow(/PROD is never contacted/);
    expect(() => assertExportSourceDatabase('afldb', 'afldb_dev')).toThrow(/PROD is never contacted/);
    expect(() => assertExportSourceDatabase('afldb_test', 'afldb_dev')).toThrow(/exported only as itself/);
    expect(() => assertExportSourceDatabase('afldb_dev_restore_20260926', 'afldb_dev')).not.toThrow();
    expect(() => assertExportSourceDatabase('afldb_dev', 'afldb_dev')).not.toThrow();
  });

  it('parse proves the payload hash, the operator-named hash and the format', async () => {
    const exported = await exportOf(originalWorld());
    const text = JSON.stringify(exported);
    const source = parseAdjudicationRecoverySource(text, exported.payloadSha256.toUpperCase());
    expect(source.kind).toBe('recovery_export');
    expect(source.fileSha256).toBe(sha(text));
    expect(() => parseAdjudicationRecoverySource(text, 'a'.repeat(64))).toThrow(/not the expected/);
    expect(() => parseAdjudicationRecoverySource(text, 'nothex')).toThrow(/64 hex/);
    const tampered = { ...exported, ledgerRows: [{ ...exported.ledgerRows[0], playerIdentity: 'players/C/C.html' }, ...exported.ledgerRows.slice(1)] };
    expect(() => parseAdjudicationRecoverySource(JSON.stringify(tampered), exported.payloadSha256)).toThrow(/altered after export/);
    expect(() => parseAdjudicationRecoverySource(JSON.stringify({ ...exported, ledgerDatabase: 'afldb_prod' }), exported.payloadSha256))
      .toThrow(/unsupported ledger database/);
    expect(() => parseAdjudicationRecoverySource(JSON.stringify({ ...exported, format: 'x' }), exported.payloadSha256)).toThrow(/neither/);
    expect(() => parseAdjudicationRecoverySource('[]', exported.payloadSha256)).toThrow(/not a JSON object/);
  });

  it('accepts an archived v2 rebuild capture, reading only its ledger section; refuses the superseded formats', async () => {
    const testWorld = originalWorld();
    testWorld.database = 'afldb_test';
    const exported = await exportOf(testWorld, 'afldb_test');
    const capture = buildCombinedCapture({
      database: 'afldb_test', capturedAt: '2026-09-25T00:00:00.000000Z', ledgerTablePresent: true,
      ledgerRows: exported.ledgerRows, importerRows: [], registrations: [],
    });
    const source = parseAdjudicationRecoverySource(JSON.stringify(capture), capture.payloadSha256);
    expect(source).toEqual(expect.objectContaining({ kind: 'rebuild_capture', ledgerDatabase: 'afldb_test' }));
    expect(source.ledgerRows).toHaveLength(3);
    expect(() => parseAdjudicationRecoverySource(JSON.stringify({ ...capture, version: 1 }), capture.payloadSha256))
      .toThrow(/pre-AFLDB-ISSUE-245 combined format/);
    const noLedger = buildCombinedCapture({ database: 'afldb_test', capturedAt: '2026-09-25T00:00:00.000000Z',
      ledgerTablePresent: false, ledgerRows: [], importerRows: [], registrations: [] });
    expect(() => parseAdjudicationRecoverySource(JSON.stringify(noLedger), noLedger.payloadSha256)).toThrow(/predates migration 104/);
  });
});

describe('the fake renders jsonb text as PostgreSQL does', () => {
  it('orders keys shorter-first then bytewise, keeps the last duplicate, and spaces separators', () => {
    expect(pgJsonbText('{"rehearsal": "AFLDB-ISSUE-239", "row": 1}')).toBe('{"row": 1, "rehearsal": "AFLDB-ISSUE-239"}');
    expect(pgJsonbText('{"b":1,"a":2,"aa":{"z":[1,2],"y":null}}')).toBe('{"a": 2, "b": 1, "aa": {"y": null, "z": [1, 2]}}');
    expect(pgJsonbText('{"a":1,"a":2}')).toBe('{"a": 2}');
    expect([pgJsonbText('{}'), pgJsonbText('[]'), pgJsonbText('{"status": "resolved"}')]).toEqual(['{}', '[]', '{"status": "resolved"}']);
  });
});

describe('AFLDB-ISSUE-239: planLedgerRecovery (pure)', () => {
  it('adds only what the target lacks, and stops on a differing row or a target-only row', async () => {
    const rows = (await exportOf(originalWorld())).ledgerRows;
    expect(planLedgerRecovery({ source: rows, target: [] })).toEqual({ toInsert: rows, identicalIds: [], stops: [] });
    expect(planLedgerRecovery({ source: rows, target: [rows[0]] }).identicalIds).toEqual([1]);
    // The surrogates may differ; the e-mail is compared case-insensitively.
    const renumbered: CapturedLedgerRow = { ...rows[0], playerId: 999, adminUserId: 77, adminEmail: rows[0].adminEmail.toUpperCase() };
    expect(planLedgerRecovery({ source: rows, target: [renumbered] }).identicalIds).toEqual([1]);
    expect(planLedgerRecovery({ source: rows, target: [{ ...rows[0], note: 'a different note entirely, twenty chars' }] }).stops[0])
      .toMatch(/target ledger row 1 \(CD_I1\) differs/);
    const later: CapturedLedgerRow = { ...rows[0], id: 9, externalId: 'CD_I9' };
    expect(planLedgerRecovery({ source: rows, target: [later] }).stops[0]).toMatch(/row 9 \(CD_I9, linked\) is not in the recovery source/);
  });
});

describe('AFLDB-ISSUE-239: recoverAflApiAdjudications (stateful fake)', () => {
  it('validate-only is read-only and reports the exact recovery', async () => {
    const source = await sourceOf(originalWorld());
    const world = lostWorld();
    const before = JSON.stringify(world);
    const { connection, statements } = fakeConnection(world);
    const report = await recoverAflApiAdjudications({ mode: 'validate-only', connection, targetDatabase: 'afldb_dev', source });
    expect(report).toEqual(expect.objectContaining({
      outcome: 'READ_ONLY', ledgerRowsReinstated: [1, 2, 3], ledgerRowsIdentical: 0, actorsToCreate: 1,
      outcomeInserts: ['CD_I1'], outcomeNoops: 0, importBatchId: null,
    }));
    expect(JSON.stringify(world)).toBe(before);
    expect(statements.every((s) => /read only/.test(s.options))).toBe(true);
  });

  it('dry-run runs the whole recovery and rolls it back; only the non-transactional sequence raise survives', async () => {
    const source = await sourceOf(originalWorld());
    const world = lostWorld();
    const before = JSON.stringify({ ...world, sequence: null });
    const report = await recoverAflApiAdjudications({ mode: 'dry-run', connection: fakeConnection(world).connection, targetDatabase: 'afldb_dev', source });
    expect(report.outcome).toBe('ROLLED_BACK');
    expect(report.ledgerRowsReinstated).toEqual([1, 2, 3]);
    expect(JSON.stringify({ ...world, sequence: null })).toBe(before);
    // setval ran before the rollback and, as in PostgreSQL, is not undone by it. Only raised,
    // only to the source's highest id: a later apply finds it already there and needs no raise.
    expect(world.sequence).toEqual({ lastValue: 3, isCalled: true });
    const apply = await recoverAflApiAdjudications({ mode: 'apply', connection: fakeConnection(world).connection, targetDatabase: 'afldb_dev', source });
    expect(apply.outcome).toBe('COMMITTED');
    expect(world.sequence).toEqual({ lastValue: 3, isCalled: true });
    expect(JSON.stringify(world.importBatches[0].params)).toContain('"ledger_sequence_raised_to":null');
  });

  it('a hand-built source whose jsonb text is not PostgreSQL\'s rendering is refused at the readback (rehearsal attempt 2)', async () => {
    // What the 2026-09-26 code_test_db attempt 2 did: evidence written `{"provider": ..., "row": N}`,
    // which no export or capture can carry (both read `evidence::text`). Every other field is exact.
    const rows = (await exportOf(originalWorld())).ledgerRows.map((r) => ({
      ...r, evidence: `{"provider": "${r.externalId}", "row": ${r.id}}` }));
    const exported = buildAdjudicationRecoveryExport({ ledgerDatabase: 'afldb_dev', sourceDatabase: 'afldb_dev',
      capturedAt: '2026-09-26T00:00:00.000Z', ledgerRows: rows });
    const source = parseAdjudicationRecoverySource(JSON.stringify(exported), exported.payloadSha256);
    // The source's row differs from what jsonb stores in the evidence text ALONE.
    for (const r of rows) {
      expect(sameLedgerRow(r, { ...r, playerId: 999, adminUserId: 77, evidence: pgJsonbText(r.evidence) })).toBe(false);
      expect(sameLedgerRow({ ...r, evidence: pgJsonbText(r.evidence) }, { ...r, playerId: 999, adminUserId: 77, evidence: pgJsonbText(r.evidence) })).toBe(true);
    }
    const world = lostWorld();
    const before = JSON.stringify({ ...world, sequence: null });
    // validate-only cannot see it: it plans from reads alone and writes nothing to read back.
    expect((await recoverAflApiAdjudications({ mode: 'validate-only', connection: fakeConnection(world).connection,
      targetDatabase: 'afldb_dev', source })).outcome).toBe('READ_ONLY');
    for (const mode of ['dry-run', 'apply'] as const) {
      await expect(recoverAflApiAdjudications({ mode, connection: fakeConnection(world).connection, targetDatabase: 'afldb_dev', source }))
        .rejects.toThrow(/The recovered ledger does not equal its source \(rows 1, 2, 3 differ; 3 row\(s\) present for 3 in the source\)/);
      expect(JSON.stringify({ ...world, sequence: null }), mode).toBe(before);
    }
    // The refusal comes AFTER setval, which the rollback does not undo.
    expect(world.sequence).toEqual({ lastValue: 3, isCalled: true });
  });

  it('the code_test_db rehearsal\'s ISSUE-239 fixture is PostgreSQL-rendered and recovers cleanly', async () => {
    const players = [{ playerId: 601, path: 'players/Z/Zz239_A.html' }, { playerId: 602, path: 'players/Z/Zz239_B.html' }] as const;
    const rows = recoveryFixtureLedgerRows(players);
    for (const r of rows) {
      expect(pgJsonbText(r.evidence)).toBe(r.evidence);
      if (r.previousState !== null) expect(pgJsonbText(r.previousState)).toBe(r.previousState);
      expect(r.createdAt).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{6}Z$/);
    }
    const exported = buildAdjudicationRecoveryExport({ ledgerDatabase: 'code_test_db', sourceDatabase: 'code_test_db',
      capturedAt: '2026-09-26T00:00:00.000Z', ledgerRows: rows });
    const source = parseAdjudicationRecoverySource(JSON.stringify(exported), exported.payloadSha256);
    const world = emptyWorld('code_test_db');
    for (const p of players) afltablesIdentity(world, p.playerId, p.path);
    const dry = await recoverAflApiAdjudications({ mode: 'dry-run', connection: fakeConnection(world).connection, targetDatabase: 'code_test_db', source });
    expect(dry.outcome).toBe('ROLLED_BACK');
    const apply = await recoverAflApiAdjudications({ mode: 'apply', connection: fakeConnection(world).connection, targetDatabase: 'code_test_db', source });
    expect(apply).toEqual(expect.objectContaining({ outcome: 'COMMITTED', ledgerRowsReinstated: [9239001, 9239002, 9239003] }));
    expect(world.ledger.map((r) => [r.evidence, r.previousState, r.createdAt]))
      .toEqual(rows.map((r) => [r.evidence, r.previousState, r.createdAt]));
  });

  it('apply restores the decisions verbatim on a renumbered lineage, replays the outcome, audits, and is idempotent', async () => {
    const original = originalWorld();
    const source = await sourceOf(original);
    const world = lostWorld();
    const report = await recoverAflApiAdjudications({ mode: 'apply', connection: fakeConnection(world).connection, targetDatabase: 'afldb_dev', source });
    expect(report.outcome).toBe('COMMITTED');

    // Ids, actions, supersedes, evidence, notes and times kept; player_id remapped by identity.
    expect(world.ledger.map((r) => [r.id, r.externalId, r.action, r.playerId, r.supersedesId])).toEqual([
      [1, 'CD_I1', 'linked', 110, null], [2, 'CD_I2', 'linked', 120, null], [3, 'CD_I2', 'revoked', 120, 2]]);
    for (const r of world.ledger) {
      const o = original.ledger.find((x) => x.id === r.id)!;
      expect([r.evidence, r.evidenceSha256, r.note, r.createdAt, r.previousState]).toEqual([o.evidence, o.evidenceSha256, o.note, o.createdAt, o.previousState]);
    }
    // The actor is recreated attribution-only (same e-mail and role), never invented.
    expect(world.authUsers).toEqual([{ id: 1, email: ADMIN.email, role: 'super_admin' }]);
    // The D15 replay produced exactly the one live outcome, at the NEW player id.
    expect(world.identities.filter((r) => r.sourceKey === 'afl_api')).toEqual([expect.objectContaining({
      externalId: 'CD_I1', playerId: 110, status: 'resolved', matchMethod: 'afl_api_admin_adjudication' })]);
    expect(world.sequence.lastValue).toBeGreaterThanOrEqual(3);
    expect(world.importBatches).toHaveLength(1);

    const again = await recoverAflApiAdjudications({ mode: 'apply', connection: fakeConnection(world).connection, targetDatabase: 'afldb_dev', source });
    expect(again).toEqual(expect.objectContaining({
      outcome: 'ALREADY_RECOVERED', ledgerRowsReinstated: [], ledgerRowsIdentical: 3, actorsToCreate: 0, importBatchId: null,
    }));
    expect(world.importBatches).toHaveLength(1);
  });

  it('ledger lost but the outcome survived: the ledger is reinstated and the outcome is a no-op', async () => {
    const source = await sourceOf(originalWorld());
    const world = lostWorld();
    world.authUsers.push({ id: 5, email: ADMIN.email.toLowerCase(), role: 'admin' }); // reused as it is
    world.identities.push({ id: 900, sourceKey: 'afl_api', externalId: 'CD_I1', playerId: 110, status: 'resolved',
      matchMethod: 'afl_api_admin_adjudication', candidateCount: 0, externalUrl: null, externalName: null, notes: 'human' });
    const report = await recoverAflApiAdjudications({ mode: 'apply', connection: fakeConnection(world).connection, targetDatabase: 'afldb_dev', source });
    expect(report).toEqual(expect.objectContaining({ outcome: 'COMMITTED', actorsToCreate: 0, outcomeInserts: [], outcomeNoops: 1 }));
    expect(world.authUsers).toEqual([{ id: 5, email: ADMIN.email.toLowerCase(), role: 'admin' }]);
    expect(world.ledger.every((r) => r.adminUserId === 5)).toBe(true);
  });

  it('refuses, writing nothing, on every conflict with current state', async () => {
    const source = await sourceOf(originalWorld());
    const cases: [string, (w: FakeWorld) => void, RegExp][] = [
      ['an importer row now holds the provider', (w) => { aflApiRow(w, { externalId: 'CD_I1', playerId: 110 }); },
        /D15 replay would stop .*CD_I1 \(an agreeing importer row exists/],
      ['an importer row links the provider elsewhere', (w) => { aflApiRow(w, { externalId: 'CD_I1', playerId: 130 }); },
        /CD_I1 \(a conflicting external_identities row already exists/],
      ['the player holds another provider', (w) => { aflApiRow(w, { externalId: 'CD_I7', playerId: 110 }); },
        /player 110 already holds a different afl_api provider \(CD_I7\)/],
      ['an identity no longer resolves', (w) => { w.identities = w.identities.filter((r) => r.externalId !== 'players/B/B.html'); },
        /player_identity 'players\/B\/B.html' names no rebuilt player/],
      ['an identity is ambiguous', (w) => { manualAdminIdentity(w, 140, 'players/A/A.html'); },
        /player_identity 'players\/A\/A.html' names more than one rebuilt player/],
      ['the target has a later decision', (w) => {
        w.authUsers.push({ id: 1, ...ADMIN });
        w.ledger.push(ledgerRow(4, 'CD_I4', 'linked', 130, 'players/C/C.html'));
      }, /row 4 \(CD_I4, linked\) is not in the recovery source/],
      ['the ledger table is missing', (w) => { w.ledgerTablePresent = false; }, /migration 104 has not run/],
    ];
    for (const [label, mutate, message] of cases) {
      const world = lostWorld();
      mutate(world);
      const before = JSON.stringify(world);
      for (const mode of ['validate-only', 'apply'] as const) {
        await expect(recoverAflApiAdjudications({ mode, connection: fakeConnection(world).connection, targetDatabase: 'afldb_dev', source }), label)
          .rejects.toThrow(message);
      }
      expect(JSON.stringify(world), label).toBe(before);
    }
  });

  it('never recovers one deployment\'s decisions into another, nor into a target off the closed list', async () => {
    const source = await sourceOf(originalWorld());
    const world = lostWorld();
    world.database = 'afldb_test';
    await expect(recoverAflApiAdjudications({ mode: 'validate-only', connection: fakeConnection(world).connection, targetDatabase: 'afldb_test', source }))
      .rejects.toThrow(/recovered only into afldb_dev, never into afldb_test/);
    await expect(recoverAflApiAdjudications({ mode: 'validate-only', connection: fakeConnection(world).connection, targetDatabase: 'afldb_prod', source }))
      .rejects.toThrow(/not a recovery target/);
    // Connected to the wrong database for the named target.
    await expect(recoverAflApiAdjudications({ mode: 'apply', connection: fakeConnection(world).connection, targetDatabase: 'afldb_dev', source }))
      .rejects.toThrow(/Connected to 'afldb_test', not the recovery target 'afldb_dev'/);
  });

  it('refuses while a db:test:rebuild capture is pending on the target (D11b marker)', async () => {
    const source = await sourceOf(originalWorld());
    const world = lostWorld();
    world.databaseComment = JSON.stringify({ format: 'afldb.afl_api_identities.rebuild_capture', version: 2 });
    const before = JSON.stringify(world);
    await expect(recoverAflApiAdjudications({ mode: 'apply', connection: fakeConnection(world).connection, targetDatabase: 'afldb_dev', source }))
      .rejects.toThrow(/capture is pending on the target/);
    expect(JSON.stringify(world)).toBe(before);
  });

  it('a surviving ledger with a sequence left behind by a restore: nothing to reinstate, the sequence is raised', async () => {
    const original = originalWorld();
    const source = await sourceOf(original);
    const world = lostWorld();
    world.authUsers.push({ id: 1, ...ADMIN });
    world.ledger.push(
      ledgerRow(1, 'CD_I1', 'linked', 110, 'players/A/A.html'),
      ledgerRow(2, 'CD_I2', 'linked', 120, 'players/B/B.html'),
      ledgerRow(3, 'CD_I2', 'revoked', 120, 'players/B/B.html', 2),
    );
    world.identities.push({ id: 900, sourceKey: 'afl_api', externalId: 'CD_I1', playerId: 110, status: 'resolved',
      matchMethod: 'afl_api_admin_adjudication', candidateCount: 0, externalUrl: null, externalName: null, notes: 'human' });
    world.sequence = { lastValue: 1, isCalled: true }; // next id 2 would collide
    const report = await recoverAflApiAdjudications({ mode: 'apply', connection: fakeConnection(world).connection, targetDatabase: 'afldb_dev', source });
    expect(report).toEqual(expect.objectContaining({ outcome: 'COMMITTED', ledgerRowsReinstated: [], ledgerRowsIdentical: 3 }));
    expect(world.sequence).toEqual({ lastValue: 3, isCalled: true });
    expect((world.importBatches[0].params as unknown[]).some((p) => JSON.stringify(p ?? '').includes('"ledger_sequence_raised_to":3'))).toBe(true);
    const again = await recoverAflApiAdjudications({ mode: 'apply', connection: fakeConnection(world).connection, targetDatabase: 'afldb_dev', source });
    expect(again.outcome).toBe('ALREADY_RECOVERED');
  });

  it('refuses a target ledger row whose player_id is not its identity\'s player', async () => {
    const source = await sourceOf(originalWorld());
    const world = lostWorld();
    world.authUsers.push({ id: 1, ...ADMIN });
    world.ledger.push(ledgerRow(1, 'CD_I1', 'linked', 130, 'players/A/A.html')); // identity says 110
    await expect(recoverAflApiAdjudications({ mode: 'validate-only', connection: fakeConnection(world).connection, targetDatabase: 'afldb_dev', source }))
      .rejects.toThrow(/row 1 \(CD_I1\) holds player_id 130, but its identity 'players\/A\/A.html' names player 110/);
  });
});

describe('AFLDB-ISSUE-239: CLI arguments and DSNs', () => {
  it('parses export and recover, and refuses everything else', () => {
    expect(parseRecoveryArgs(['export', '--ledger-of', 'afldb_dev', '--output', 'D:\\x.json']))
      .toEqual({ command: 'export', ledgerOf: 'afldb_dev', output: 'D:\\x.json' });
    expect(parseRecoveryArgs(['recover', '--source', 's.json', '--expected-payload-sha256', 'a'.repeat(64), '--target', 'code_test_db', '--dry-run']))
      .toEqual({ command: 'recover', mode: 'dry-run', source: 's.json', expectedPayloadSha256: 'a'.repeat(64), target: 'code_test_db' });
    expect(() => parseRecoveryArgs(['recover', '--source', 's', '--expected-payload-sha256', 'a', '--target', 'afldb_prod', '--apply'])).toThrow(/no PROD entry/);
    expect(() => parseRecoveryArgs(['recover', '--source', 's', '--expected-payload-sha256', 'a', '--target', 'afldb_dev'])).toThrow(/exactly one of/);
    expect(() => parseRecoveryArgs(['export', '--ledger-of', 'afldb_dev', '--output', 'x', '--apply'])).toThrow(/only --ledger-of and --output/);
    expect(() => parseRecoveryArgs(['recover', '--source', 's', '--source', 't'])).toThrow(/given twice/);
    expect(() => parseRecoveryArgs(['replay'])).toThrow(/'export' or 'recover'/);
    expect(() => parseRecoveryArgs(['recover', '--force'])).toThrow(/Unknown argument/);
  });

  it('a DSN must name the target, never PROD, and is never echoed', () => {
    expect(() => resolveRecoveryDsn({}, 'R_DSN', 'afldb_dev')).toThrow(/R_DSN is not set/);
    let message = '';
    try { resolveRecoveryDsn({ R_DSN: 'postgresql://u:topsecret@h/afldb_test' }, 'R_DSN', 'afldb_dev'); } catch (e) { message = (e as Error).message; }
    expect(message).toMatch(/names 'afldb_test', not 'afldb_dev'/);
    expect(message).not.toContain('topsecret');
    expect(() => resolveRecoveryDsn({ R_DSN: 'postgresql://u:p@h/afldb_prod' }, 'R_DSN', null)).toThrow(/PROD is never contacted/);
    expect(resolveRecoveryDsn({ R_DSN: 'postgresql://u:p@h/afldb_dev_restore' }, 'R_DSN', null)).toMatch(/afldb_dev_restore$/);
  });

  it('buildAdjudicationRecoveryExport refuses a structurally broken ledger', async () => {
    const rows = (await exportOf(originalWorld())).ledgerRows;
    expect(() => buildAdjudicationRecoveryExport({ ledgerDatabase: 'afldb_dev', sourceDatabase: 'afldb_dev', capturedAt: 'x',
      ledgerRows: [rows[2]] })).toThrow(AdjudicationRecoveryRefused);
  });
});
