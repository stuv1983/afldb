import './guard';

import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import postgres from 'postgres';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { attachAflTablesIdentityInTransaction } from '@/db/queries/admin-draft';
import { linkAflApiProvider, revokeAflApiLink } from '@/db/queries/afl-api-player-links';
import { createPlayerInTransaction } from '@/db/queries/players';
import * as rb from '../../tools/db/rebuild-test';
import * as adj from '../../tools/migration/rebuild_afl_api_adjudications';
import * as reg from '../../tools/migration/rebuild_manual_registrations';
import {
  loadS6Refs, renderS6Form, routeS6ImportDsn, S6_NOTE, s6ProviderId, seedS6Actor, seedS6ImporterLink,
  seedS6PendingEvidence, seedS6Player, type S6Refs,
} from './afl-api-adjudication-fixtures';
import { verifyIsolatedIntegrationDatabase } from './guard';

/**
 * AFLDB-ISSUE-316 (closure limitation L7) — a POPULATED capture → reset → reinstatement → bijection
 * round trip through the real rebuild stage commands, and the refusals around it.
 *
 * The retained C2 rehearsal ran the lifecycle on an empty ledger. The existing real-PostgreSQL
 * suites (settle-afl-api.test.ts) prove the reinstate/replay/bijection functions on a shared
 * database inside rolled-back transactions. Neither runs the actual `capture`,
 * `registrations-reinstate`, replay, `registrations-verify`, `reinstate` and `bijection` stage
 * commands over a populated database, across the REAL `RESET_SQL`, with the players renumbered.
 * This suite does.
 *
 * ALL DATA ARE SYNTHETIC test fixtures made by the product's own writers (the ISSUE-235 S6
 * fixture players and providers through `linkAflApiProvider`/`revokeAflApiLink`, an importer-
 * created `afl_api` row, and three manual registrations through `createPlayerInTransaction` and
 * `attachAflTablesIdentityInTransaction`). The "tracked baseline" that a real rebuild re-loads is
 * stood in for by re-seeding the same stable AFL Tables identities under DIFFERENT `players.id`
 * values. The result is evidence about the mechanism, not about any real database.
 *
 * DESTRUCTIVE. It runs the real reset, so it only runs inside `tools/v2/isolated-pg.ts run`
 * against an `afldb_v2_rb_*_test` database AND with AFLDB_POPULATED_LIFECYCLE=1, with
 * AFLDB_REBUILD_CAPTURE_ROOT naming a fresh directory outside the checkout. It leaves the target
 * database marked/reset state in place for inspection, so it must be the ONLY test file in its
 * invocation (`tests/integration/guard.ts` re-checks the resting marker when a file is loaded).
 */

const OWNER_DSN = process.env.AFLDB_TEST_DATABASE_URL as string;
const DB = decodeURIComponent(new URL(OWNER_DSN).pathname.replace(/^\//, ''));
const RUN = process.env.AFLDB_V2_ISOLATED_PG === '1'
  && process.env.AFLDB_POPULATED_LIFECYCLE === '1'
  && /^afldb_v2_rb_[a-z0-9_]+_test$/.test(DB);

const TSX_CLI = join(process.cwd(), 'node_modules', 'tsx', 'dist', 'cli.mjs');
const NOTE = 'AFLDB-ISSUE-316 populated lifecycle fixture registration (synthetic)';
const KEYS = { humanA: 3161, humanRevoked: 3162, humanC: 3163, importer: 3164 } as const;
const REGISTRATIONS = [
  { name: 'Popone', path: 'players/Z/Issue316_Popone.html' },
  { name: 'Poptwo', path: null },
  { name: 'Popbind', path: 'players/Z/Issue316_Popbind.html' },
] as const;
const BIND_PATH = REGISTRATIONS[2].path;
const afltablesPath = (key: number) => `players/Z/Issue235-S6-${key}.html`;

type Result = { status: number; stdout: string; stderr: string };
const out = (r: Result) => `${r.stdout}\n${r.stderr}`;

const connectOwner = () => postgres(OWNER_DSN, { max: 2, onnotice: () => {} });
let owner = connectOwner();

const S = {
  refs: undefined as unknown as S6Refs,
  target: undefined as unknown as rb.ResolvedTarget,
  deps: rb.createCliDeps(spawnSync),
  root: '',
  dir: '',
  capturePath: '',
  restoreImportDsn: undefined as (() => void) | undefined,
  /** The authentic capture: bytes, digests and the exact marker comment it set. */
  captureBytes: Buffer.alloc(0),
  capture: undefined as unknown as adj.CombinedCapture,
  comment: '',
  /** `players.id` of each stable identity BEFORE the reset. */
  idsBefore: new Map<string, number>(),
  preLedger: [] as unknown[],
};

function stage(step: Parameters<typeof rb.aflApiAdjudicationEnv>[1], opts: { root?: string; recover?: boolean } = {}): Result {
  const argv = [process.execPath, TSX_CLI, rb.AFL_API_ADJUDICATION_TOOL, step, ...(opts.recover ? ['--recover'] : [])];
  return S.deps.runCommand(argv, { ...rb.aflApiAdjudicationEnv(S.target, step), [rb.CAPTURE_ROOT_ENV]: opts.root ?? S.root });
}

function command(argv: string[], env: Record<string, string> = {}): Result {
  return S.deps.runCommand(argv, env);
}

const comment = async (): Promise<string | null> => (await owner<{ c: string | null }[]>`
  SELECT shobj_description(oid, 'pg_database') AS c FROM pg_database WHERE datname = current_database()`)[0].c;

/** A row without the audit-only surrogates a rebuild legitimately changes. */
const withoutSurrogates = <T extends object>(row: T) =>
  Object.fromEntries(Object.entries(row).filter(([key]) => key !== 'playerId' && key !== 'adminUserId'));

/** The sections of a capture that must survive a rebuild: everything but the two audit surrogates. */
function durable(c: adj.CombinedCapture) {
  return {
    ledger: c.ledgerRows.map(withoutSurrogates),
    importer: c.importerRows.map(withoutSurrogates),
    registrations: c.registrations.map((r) => reg.registrationTuple(r)),
  };
}

async function playersByIdentity(): Promise<Map<string, number>> {
  const rows = await owner<{ path: string; id: number }[]>`
    SELECT e.external_id AS path, e.player_id AS id
      FROM external_identities e JOIN sources s ON s.id = e.source_id
     WHERE s.key = 'afltables' AND e.player_id IS NOT NULL AND e.status IN ('unique', 'resolved')`;
  return new Map(rows.map((r) => [r.path, r.id]));
}

async function holders(sourceKey: string, externalId: string): Promise<number[]> {
  const rows = await owner<{ id: number }[]>`
    SELECT e.player_id AS id FROM external_identities e JOIN sources s ON s.id = e.source_id
     WHERE s.key = ${sourceKey} AND e.external_id = ${externalId} AND e.player_id IS NOT NULL`;
  return rows.map((r) => r.id);
}

async function liveCapture() {
  return owner.begin('read only', async (tx) => ({
    ledger: await adj.readLedger(tx),
    registrations: reg.registrationsFromLive(await reg.readLiveRegistrationState(tx)),
    afl: await tx<{ externalId: string; status: string; matchMethod: string | null; playerId: number | null }[]>`
      SELECT e.external_id AS "externalId", e.status::text AS status, e.match_method AS "matchMethod", e.player_id AS "playerId"
        FROM external_identities e JOIN sources s ON s.id = e.source_id
       WHERE s.key = 'afl_api' ORDER BY e.external_id`,
  }));
}

/** A fresh capture root and database directory for a refusal case; the authentic root is never touched. */
function altRoot(name: string, capture?: string): { root: string; dir: string } {
  const root = join(S.root, `alt-${name}`);
  const dir = adj.captureDirectory(root, DB);
  mkdirSync(dir, { recursive: true });
  if (capture !== undefined) writeFileSync(join(dir, adj.PENDING_CAPTURE_FILE), capture, 'utf8');
  return { root, dir };
}

/** Everything a refused stage must leave exactly as the capture stage left it. */
async function expectAuthenticPendingState(): Promise<void> {
  expect(Buffer.compare(readFileSync(S.capturePath), S.captureBytes)).toBe(0);
  expect(await comment()).toBe(S.comment);
  const live = await liveCapture();
  expect(live.ledger.rows).toEqual([]);
  expect(live.registrations.registrations).toEqual([]);
  expect(live.afl).toEqual([]);
}

describe.skipIf(!RUN)('AFLDB-ISSUE-316 L7: populated capture → reset → reinstatement → bijection (isolated target, synthetic data)', () => {
  beforeAll(async () => {
    await verifyIsolatedIntegrationDatabase(owner);
    S.root = rb.resolveCaptureRoot(process.env, process.cwd());
    S.target = rb.resolveTarget(process.env, { target: 'isolated', acknowledgeDestroy: DB });
    S.dir = adj.captureDirectory(S.root, DB);
    S.capturePath = join(S.dir, adj.PENDING_CAPTURE_FILE);
    expect(existsSync(S.dir), 'the capture root must be fresh').toBe(false);
    const [fresh] = await owner<{ players: number; ledger: number }[]>`
      SELECT (SELECT count(*) FROM players)::int AS players,
             (SELECT count(*) FROM afl_api_identity_adjudications)::int AS ledger`;
    expect(fresh, 'the target must be a fresh migrated database').toEqual({ players: 0, ledger: 0 });
    S.restoreImportDsn = (await routeS6ImportDsn()).restore;
  }, 120_000);

  afterAll(async () => {
    S.restoreImportDsn?.();
    await owner.end({ timeout: 5 });
  });

  it('seeds a populated state through the product writers: 4 ledger rows, 1 importer row, 3 registrations', async () => {
    S.refs = await loadS6Refs(owner);
    const actorId = await seedS6Actor(owner);
    const players = new Map<number, { id: number }>();
    for (const key of Object.values(KEYS)) players.set(key, await seedS6Player(owner, S.refs, { key }));
    for (const key of [KEYS.humanA, KEYS.humanRevoked, KEYS.humanC]) {
      const providerId = s6ProviderId(key);
      await seedS6PendingEvidence(owner, S.refs, { providerId, match: key });
      const form = await renderS6Form(providerId);
      expect(await linkAflApiProvider({
        providerId, playerId: players.get(key)!.id, adminUserId: actorId, note: S6_NOTE,
        surnameAcknowledged: false, fingerprint: form.linkFingerprint!,
      })).toEqual({ ok: true });
    }
    const revokeForm = await renderS6Form(s6ProviderId(KEYS.humanRevoked));
    expect(await revokeAflApiLink({
      providerId: s6ProviderId(KEYS.humanRevoked), adminUserId: actorId, note: S6_NOTE,
      fingerprint: revokeForm.revokeFingerprint!,
    })).toEqual({ ok: true });
    await seedS6ImporterLink(owner, S.refs, s6ProviderId(KEYS.importer), players.get(KEYS.importer)!.id);

    const importer = postgres(process.env.AFLDB_TEST_IMPORT_DATABASE_URL as string, { max: 1, onnotice: () => {} });
    try {
      await importer.begin(async (tx) => {
        for (const r of REGISTRATIONS) {
          const created = await createPlayerInTransaction(tx, {
            displayName: `Issue316 ${r.name}`, givenName: 'Issue316', surname: r.name, notes: NOTE,
          }, { adminUserId: actorId });
          if (r.path !== null) {
            const attached = await attachAflTablesIdentityInTransaction(tx, {
              playerId: created.id, profilePath: r.path, adminUserId: actorId, note: NOTE,
            });
            expect(attached.ok).toBe(true);
          }
        }
      });
    } finally {
      await importer.end({ timeout: 5 });
    }

    const live = await liveCapture();
    expect(live.ledger.rows.map((r) => `${r.action}:${r.externalId}`)).toEqual([
      `linked:${s6ProviderId(KEYS.humanA)}`, `linked:${s6ProviderId(KEYS.humanRevoked)}`,
      `linked:${s6ProviderId(KEYS.humanC)}`, `revoked:${s6ProviderId(KEYS.humanRevoked)}`,
    ]);
    expect(live.registrations.problems).toEqual([]);
    expect(live.registrations.registrations).toHaveLength(3);
    expect(live.afl.map((r) => `${r.externalId}:${r.status}`)).toEqual([
      `${s6ProviderId(KEYS.humanA)}:resolved`, `${s6ProviderId(KEYS.humanC)}:resolved`,
      `${s6ProviderId(KEYS.importer)}:unique`,
    ]);
    S.idsBefore = await playersByIdentity();
    expect(S.idsBefore.size).toBeGreaterThanOrEqual(6);
  }, 180_000);

  it('the real capture stage captures all three sections and sets the rebuild marker', async () => {
    const absentBefore = adj.pendingCaptureAbsent(S.dir);
    const res = stage('capture');
    expect(res.status, out(res)).toBe(0);
    expect(res.stdout).toContain(
      'captured 4 adjudication row(s), 1 importer identity row(s) and 3 manual player registration(s)');
    S.captureBytes = readFileSync(S.capturePath);
    S.capture = adj.parseCombinedCapture(S.captureBytes.toString('utf8'), DB);
    expect(S.capture.ledgerRows).toHaveLength(4);
    expect(S.capture.importerRows.map((r) => r.externalId)).toEqual([s6ProviderId(KEYS.importer)]);
    expect(S.capture.registrations).toHaveLength(3);
    S.comment = (await comment())!;
    const marker = adj.parseRebuildMarker(S.comment);
    expect(marker.payloadSha256).toBe(S.capture.payloadSha256);
    const bound = adj.bindCompletedCapture({
      dir: S.dir, database: DB, absentBeforeCapture: absentBefore, captureStdout: res.stdout,
    });
    expect(S.deps.isolatedServerFacts).toBeDefined();
    // the ordinary check refuses a pending marker; only the capture-bound check passes
    expect(() => rb.assertIsolatedTargetLive(S.target, S.deps)).toThrow(/database_marker/);
    expect(() => rb.assertIsolatedTargetLive(S.target, { ...S.deps, log: () => {} }, bound)).not.toThrow();
    S.preLedger = durable(S.capture).ledger;
  }, 180_000);

  it('the real RESET_SQL and the real migrations/privileges/reference stages leave an empty, renumber-ready database', async () => {
    const guard = rb.rebuildIdentityGuardSql(DB, {
      AFLDB_V2_ISOLATED_PG: '1', AFLDB_V2_ISOLATED_PORT: process.env.AFLDB_V2_ISOLATED_PORT,
    });
    expect(() => S.deps.runSql(S.target.adminDsn, guard + rb.RESET_SQL)).not.toThrow();
    await owner.end({ timeout: 5 });
    owner = connectOwner();
    const python = rb.resolvePython();
    for (const [label, argv, env] of [
      ['migrations', [process.execPath, TSX_CLI, 'tools/db/migrate.ts', '--target', 'test'], { AFLDB_MIGRATE_TARGET: 'test' }],
      ['privileges', [process.execPath, TSX_CLI, 'tools/db/privileges.ts', '--target', 'test'], {}],
      ['reference data', [python, 'tools/migration/load_reference_data.py'], { AFLDB_IMPORT_DATABASE_URL: S.target.importDsn }],
    ] as [string, string[], Record<string, string>][]) {
      const res = command(argv, env);
      expect(res.status, `${label}: ${out(res)}`).toBe(0);
    }
    const [empty] = await owner<{ players: number; ledger: number; aflApi: number; manual: number }[]>`
      SELECT (SELECT count(*) FROM players)::int AS players,
             (SELECT count(*) FROM afl_api_identity_adjudications)::int AS ledger,
             (SELECT count(*) FROM external_identities e JOIN sources s ON s.id = e.source_id WHERE s.key = 'afl_api')::int AS "aflApi",
             (SELECT count(*) FROM external_identities e JOIN sources s ON s.id = e.source_id WHERE s.key = 'manual_admin_edit')::int AS manual`;
    expect(empty).toEqual({ players: 0, ledger: 0, aflApi: 0, manual: 0 });
    // the marker and the capture file survive the reset byte for byte
    expect(await comment()).toBe(S.comment);
    expect(Buffer.compare(readFileSync(S.capturePath), S.captureBytes)).toBe(0);
  }, 600_000);

  it('re-seeds the stable identities as a stand-in for the tracked baseline, under DIFFERENT players.id', async () => {
    S.refs = await loadS6Refs(owner);
    for (let key = 3170; key < 3180; key += 1) await seedS6Player(owner, S.refs, { key, stable: false });
    for (const key of Object.values(KEYS).reverse()) await seedS6Player(owner, S.refs, { key });
    // the source-owned player the third registration will BIND to (its AFL Tables path is in the baseline)
    await owner.begin(async (tx) => {
      const [p] = await tx<{ id: number }[]>`
        INSERT INTO players (legacy_player_id, display_name, sort_name, search_name, slug, given_name, surname)
        VALUES (-316100001, 'Issue316 Popbind (baseline)', 'Popbind, Issue316 (baseline)', 'issue316 popbind baseline',
                'issue316-popbind-baseline', 'Issue316', 'Popbind') RETURNING id`;
      await tx`
        INSERT INTO external_identities (source_id, external_id, player_id, status, candidate_count, match_method)
        VALUES (${S.refs.afltablesSourceId}, ${BIND_PATH}, ${p.id}, 'unique', 1, 'afltables_profile_url')`;
    });
    const now = await playersByIdentity();
    for (const key of Object.values(KEYS)) {
      expect(now.get(afltablesPath(key)), afltablesPath(key)).toBeDefined();
      expect(now.get(afltablesPath(key)), `${afltablesPath(key)} must be renumbered`).not.toBe(S.idsBefore.get(afltablesPath(key)));
    }
  }, 120_000);

  describe('wrong, changed or mismatched capture/marker state refuses and loses nothing', () => {
    it('a capture whose payload was altered after capture is refused (payload hash)', async () => {
      const tampered = JSON.parse(S.captureBytes.toString('utf8'));
      tampered.ledgerRows[0].note = `${tampered.ledgerRows[0].note} (altered)`;
      const { root } = altRoot('tampered', `${JSON.stringify(tampered, null, 2)}\n`);
      for (const step of ['reinstate', 'registrations-reinstate', 'registrations-verify'] as const) {
        const res = stage(step, { root });
        expect(res.status, step).toBe(1);
        expect(out(res)).toMatch(/does not match its own payload hash/);
      }
      await expectAuthenticPendingState();
    }, 180_000);

    it('a self-consistent capture with a DIFFERENT payload is refused against the authentic marker', async () => {
      const forged = adj.buildCombinedCapture({
        database: DB, capturedAt: S.capture.capturedAt, ledgerTablePresent: true,
        ledgerRows: S.capture.ledgerRows.slice(0, 3), importerRows: S.capture.importerRows,
        registrations: S.capture.registrations,
      });
      expect(forged.payloadSha256).not.toBe(S.capture.payloadSha256);
      const { root, dir } = altRoot('forged');
      adj.writePendingCapture(dir, forged);
      for (const step of ['reinstate', 'registrations-reinstate', 'registrations-verify'] as const) {
        const res = stage(step, { root });
        expect(res.status, step).toBe(1);
        expect(out(res)).toMatch(/rebuild marker does not match the pending capture/);
      }
      for (const recover of [false, true]) {
        const res = stage('capture', { root, recover });
        expect(res.status, `capture recover=${recover}`).toBe(1);
        expect(out(res)).toMatch(/does not match the pending capture[\s\S]*wrong or a tampered capture/);
      }
      await expectAuthenticPendingState();
    }, 240_000);

    it('a capture taken from another database is refused', async () => {
      const other = adj.buildCombinedCapture({
        database: 'afldb_v2_rb_other_test', capturedAt: S.capture.capturedAt, ledgerTablePresent: true,
        ledgerRows: S.capture.ledgerRows, importerRows: S.capture.importerRows, registrations: S.capture.registrations,
      });
      const { root, dir } = altRoot('other-db');
      adj.writePendingCapture(dir, other);
      const res = stage('reinstate', { root });
      expect(res.status).toBe(1);
      expect(out(res)).toMatch(/only ever reinstated into the database it came from/);
      await expectAuthenticPendingState();
    }, 120_000);

    it('a marker with NO pending capture file is never captured over (the lost-capture path)', async () => {
      const { root, dir } = altRoot('no-pending');
      for (const recover of [false, true]) {
        const res = stage('capture', { root, recover });
        expect(res.status, `recover=${recover}`).toBe(1);
        expect(out(res)).toMatch(/no pending capture file exists[\s\S]*Never capturing live over this/);
      }
      expect(readdirSync(dir)).toEqual([]);
      await expectAuthenticPendingState();
    }, 120_000);

    it('a plain capture over the authentic pending capture on an emptied database refuses without --recover', async () => {
      const res = stage('capture');
      expect(res.status).toBe(1);
      expect(out(res)).toMatch(/live database is empty[\s\S]*Re-run with --recover/);
      await expectAuthenticPendingState();
    }, 120_000);

    it('a CHANGED marker (another capture\'s digests) refuses every stage; the authentic marker then works again', async () => {
      const changed = JSON.stringify({
        format: adj.CAPTURE_FORMAT, version: adj.CAPTURE_VERSION, capturedAt: S.capture.capturedAt,
        payloadSha256: 'a'.repeat(64), fileSha256: 'b'.repeat(64),
      });
      await owner.unsafe(`COMMENT ON DATABASE "${DB}" IS $changed$${changed}$changed$`);
      try {
        for (const step of ['registrations-reinstate', 'reinstate'] as const) {
          const res = stage(step);
          expect(res.status, step).toBe(1);
          expect(out(res)).toMatch(/rebuild marker does not match the pending capture/);
        }
        for (const recover of [false, true]) {
          const res = stage('capture', { recover });
          expect(res.status, `capture recover=${recover}`).toBe(1);
          expect(out(res)).toMatch(/wrong or a tampered capture/);
        }
        const live = await liveCapture();
        expect(live.ledger.rows).toEqual([]);
        expect(live.registrations.registrations).toEqual([]);
      } finally {
        await owner.unsafe(`COMMENT ON DATABASE "${DB}" IS $authentic$${S.comment}$authentic$`);
      }
      await expectAuthenticPendingState();
    }, 240_000);
  });

  describe('the authentic stages', () => {
    it('registrations-reinstate: 3 creation records back, 2 to re-create and 1 to bind to the baseline player', async () => {
      const res = stage('registrations-reinstate');
      expect(res.status, out(res)).toBe(0);
      expect(res.stdout).toContain('3 creation record(s) reinstated (2 to re-create, 1 to bind to a source-owned player)');
      expect(res.stdout).toContain('marker       : kept');
      expect(await comment()).toBe(S.comment);
    }, 180_000);

    it('the production replay re-creates the players and binds the third to the source-owned one', async () => {
      const res = command([rb.resolvePython(), rb.MANUAL_REGISTRATION_REPLAY], {
        AFLDB_IMPORT_DATABASE_URL: S.target.importDsn, [rb.AFL_API_ADJUDICATION_TARGET_ENV]: DB,
      });
      expect(res.status, out(res)).toBe(0);
    }, 180_000);

    it('registrations-verify: every registration is back under its token, path and creation record', async () => {
      const res = stage('registrations-verify');
      expect(res.status, out(res)).toBe(0);
      const now = await playersByIdentity();
      for (const r of S.capture.registrations) {
        const byToken = await holders('manual_admin_edit', r.token);
        expect(byToken, r.token).toHaveLength(1);
        if (r.afltablesProfilePath !== null) {
          expect(await holders('afltables', r.afltablesProfilePath)).toEqual(byToken);
        }
      }
      const bound = S.capture.registrations.find((r) => r.afltablesProfilePath === BIND_PATH)!;
      expect(await holders('manual_admin_edit', bound.token)).toEqual([now.get(BIND_PATH!)]);
    }, 180_000);

    it('reinstate: ledger under original ids, importer row and human identities replayed, marker cleared', async () => {
      const res = stage('reinstate');
      expect(res.status, out(res)).toBe(0);
      expect(res.stdout).toContain('ledger  : reinstated 4 row(s) under their original ids');
      expect(res.stdout).toContain('marker  : cleared inside this transaction');
      expect(await comment()).toBe(rb.restingDatabaseComment(DB));
      expect(existsSync(S.capturePath)).toBe(false);
      const archived = readdirSync(S.dir).filter((f) => /\.reinstated\.json$/.test(f));
      expect(archived).toHaveLength(1);
      const archivedCapture = adj.parseCombinedCapture(readFileSync(join(S.dir, archived[0]), 'utf8'), DB);
      expect(archivedCapture.payloadSha256).toBe(S.capture.payloadSha256);
    }, 180_000);

    it('bijection: the combined importer/human identity invariant holds', () => {
      const res = stage('bijection');
      expect(res.status, out(res)).toBe(0);
      expect(res.stdout).toContain('combined importer/human identity invariant: OK');
    }, 120_000);

    it('independently of the stage output, the round trip is exact by stable identity', async () => {
      const live = await liveCapture();
      // every durable ledger field and the original ids, on the players the identities name NOW
      const now = await playersByIdentity();
      expect(live.ledger.rows.map(withoutSurrogates)).toEqual(S.preLedger);
      for (const row of live.ledger.rows) {
        expect(row.playerId, `ledger ${row.id}`).toBe(now.get(row.playerIdentity));
        expect(row.playerId).not.toBe(S.idsBefore.get(row.playerIdentity));
      }
      // afl_api identities: two human `resolved`, the revoked one absent, the importer row `unique`
      const byProvider = new Map(live.afl.map((r) => [r.externalId, r]));
      expect([...byProvider.keys()]).toEqual([
        s6ProviderId(KEYS.humanA), s6ProviderId(KEYS.humanC), s6ProviderId(KEYS.importer),
      ]);
      expect(byProvider.get(s6ProviderId(KEYS.humanA))).toMatchObject({ status: 'resolved', playerId: now.get(afltablesPath(KEYS.humanA)) });
      expect(byProvider.get(s6ProviderId(KEYS.humanC))).toMatchObject({ status: 'resolved', playerId: now.get(afltablesPath(KEYS.humanC)) });
      expect(byProvider.get(s6ProviderId(KEYS.importer))).toMatchObject({
        status: 'unique', matchMethod: 'afl_api_stat_vector_season', playerId: now.get(afltablesPath(KEYS.importer)),
      });
      // registrations: same creation records
      expect(live.registrations.problems).toEqual([]);
      expect(live.registrations.registrations.map((r) => reg.registrationTuple(r)))
        .toEqual(S.capture.registrations.map((r) => reg.registrationTuple(r)));
      // the standalone read-only bijection stage function, in the same shape the CLI uses
      await expect(owner.begin('read only', (tx) => adj.verifyBijectionStage(tx, DB))).resolves.toEqual([]);
    }, 120_000);

    it('a second reinstate has no pending capture and refuses; a fresh capture reproduces the same durable sections', async () => {
      const again = stage('reinstate');
      expect(again.status).toBe(1);
      expect(out(again)).toMatch(/No pending adjudication capture/);
      const { root, dir } = altRoot('roundtrip');
      const res = stage('capture', { root });
      expect(res.status, out(res)).toBe(0);
      const second = adj.parseCombinedCapture(readFileSync(join(dir, adj.PENDING_CAPTURE_FILE), 'utf8'), DB);
      expect(durable(second)).toEqual(durable(S.capture));
      // return the target to its resting marker; the second capture was a read-back, not a rebuild
      await owner.begin((tx) => adj.clearRebuildMarker(tx, DB));
      expect(await comment()).toBe(rb.restingDatabaseComment(DB));
    }, 240_000);
  });
});
