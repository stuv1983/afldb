/**
 * AFLDB-ISSUE-239/240/241 — a STATEFUL in-memory stand-in for the AFL API identity slice of a
 * database, for the DB-free tests of `import_afl_api_player_bridge.ts` and
 * `recover_afl_api_adjudications.ts`.
 *
 * It answers exactly the statements those tools (and the shared ISSUE-235/237 helpers they call)
 * issue, from state, at the moment each runs: an INSERT really appends, a unique violation really
 * throws, `ON CONFLICT ... DO NOTHING` really consults the open-key index, a READ ONLY transaction
 * really refuses a write, and a thrown transaction really restores the snapshot. Any statement it
 * does not recognise throws, so a code path that reaches an unexpected query fails loudly instead
 * of silently answering `[]`. It is not PostgreSQL: the code_test_db rehearsal
 * (tools/db/afl-api-identity-bulk-rehearsal.ts) is the SQL-level proof.
 */
import type { TransactionSql } from 'postgres';

export type FakeIdentity = {
  id: number;
  sourceKey: string;
  externalId: string;
  playerId: number | null;
  status: string;
  matchMethod: string | null;
  candidateCount: number;
  externalUrl: string | null;
  externalName: string | null;
  notes: string | null;
};

export type FakeLedgerRow = {
  id: number;
  sourceKey: string;
  externalId: string;
  action: 'linked' | 'revoked';
  playerId: number;
  playerIdentity: string;
  previousState: string | null;
  evidence: string;
  evidenceSha256: string;
  surnameDisagreementAcknowledged: boolean;
  supersedesId: number | null;
  adminUserId: number;
  note: string;
  createdAt: string;
};

export type FakeDataIssue = {
  id: number; entityType: string; entityId: number | null; issueType: string; issueKey: string | null;
  description: string; details: unknown; resolvedAt: string | null;
};

export type FakeWorld = {
  database: string;
  role: string;
  sources: Record<string, number>;
  identities: FakeIdentity[];
  ledger: FakeLedgerRow[];
  ledgerTablePresent: boolean;
  authUsers: { id: number; email: string; role: string }[];
  sequence: { lastValue: number; isCalled: boolean };
  dataIssues: FakeDataIssue[];
  importBatches: Record<string, unknown>[];
  importRejections: Record<string, unknown>[];
  /** `COMMENT ON DATABASE` — where a pending db:test:rebuild marker lives. */
  databaseComment: string | null;
};

export function emptyWorld(database: string, role = 'afldb_owner'): FakeWorld {
  return {
    database, role, databaseComment: null,
    sources: { afl_api: 1, afltables: 2, manual_admin_edit: 3 },
    identities: [], ledger: [], ledgerTablePresent: true, authUsers: [],
    sequence: { lastValue: 1, isCalled: false },
    dataIssues: [], importBatches: [], importRejections: [],
  };
}

/**
 * The seeding helpers refuse a state PostgreSQL refuses: `external_identities_uq UNIQUE
 * (source_id, external_id)` (migration 002). The first real code_test_db rehearsal died on a
 * fixture that seeded one path twice under `afltables`, which this fake had tolerated.
 */
export function seedIdentity(world: FakeWorld, row: FakeIdentity): FakeIdentity {
  if (world.identities.some((r) => r.sourceKey === row.sourceKey && r.externalId === row.externalId)) {
    throw new FakeDbError('duplicate key value violates unique constraint "external_identities_uq"', '23505');
  }
  world.identities.push(row);
  return row;
}

/** An accepted AFL Tables identity row for `playerId` (what both identity lookups read). */
export function afltablesIdentity(world: FakeWorld, playerId: number, path: string): void {
  seedIdentity(world, {
    id: nextId(world.identities), sourceKey: 'afltables', externalId: path, playerId, status: 'unique',
    matchMethod: 'afltables_profile_url', candidateCount: 1, externalUrl: null, externalName: null, notes: null,
  });
}

/**
 * An accepted `manual_admin_edit` identity row. With `afltablesIdentity` on the same value for
 * another player this is the ONLY reverse-identity ambiguity the schema can hold: the lookup
 * unions the two lineages, and `external_identities_uq` allows one row per source.
 */
export function manualAdminIdentity(world: FakeWorld, playerId: number, identity: string): void {
  seedIdentity(world, {
    id: nextId(world.identities), sourceKey: 'manual_admin_edit', externalId: identity, playerId, status: 'resolved',
    matchMethod: 'manual_admin_edit', candidateCount: 0, externalUrl: null, externalName: null, notes: null,
  });
}

export function aflApiRow(world: FakeWorld, row: Partial<FakeIdentity> & { externalId: string; playerId: number | null }): FakeIdentity {
  return seedIdentity(world, {
    id: nextId(world.identities), sourceKey: 'afl_api', status: 'unique', matchMethod: 'afl_api_stat_vector_bootstrap',
    candidateCount: 1, externalUrl: null, externalName: null, notes: null, ...row,
  });
}

function nextId(rows: readonly { id: number }[]): number {
  return rows.reduce((max, r) => Math.max(max, r.id), 0) + 1;
}

const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;

/**
 * `value::jsonb::text` as PostgreSQL renders it: keys deduplicated (the last wins) and ordered
 * shorter-first, then bytewise; `", "` and `": "` separators. The second real code_test_db
 * rehearsal (2026-09-26) died on a hand-built recovery source whose evidence text had another key
 * order, which this fake had stored and returned verbatim. Numbers are rendered by JavaScript
 * (PostgreSQL keeps `numeric`'s own text, e.g. `1.0`); the fixtures use integers only.
 */
export function pgJsonbText(text: string): string {
  const byteOrder = (a: string, b: string) =>
    Buffer.byteLength(a) - Buffer.byteLength(b) || Buffer.compare(Buffer.from(a), Buffer.from(b));
  const render = (value: unknown): string => {
    if (Array.isArray(value)) return `[${value.map(render).join(', ')}]`;
    if (value !== null && typeof value === 'object') {
      const entries = Object.entries(value).sort(([a], [b]) => byteOrder(a, b));
      return `{${entries.map(([k, v]) => `${JSON.stringify(k)}: ${render(v)}`).join(', ')}}`;
    }
    return JSON.stringify(value);
  };
  return render(JSON.parse(text));
}

export class FakeDbError extends Error {
  constructor(message: string, readonly code: string) { super(message); }
}

export type FakeStatement = { text: string; params: unknown[]; options: string };

/**
 * A connection over `world`: `begin(options, fn)` snapshots the world, runs `fn` with a fake
 * `TransactionSql`, and restores the snapshot if `fn` throws. `statements` records every
 * statement with the transaction options it ran under.
 */
export function fakeConnection(world: FakeWorld) {
  const statements: FakeStatement[] = [];
  const begin = async <T>(options: string, fn: (tx: TransactionSql) => Promise<T>): Promise<T> => {
    const snapshot = clone(world);
    const readOnly = /read only/.test(options);
    const call = (strings: unknown, ...params: unknown[]): unknown => {
      if (!(Array.isArray(strings) && 'raw' in strings)) return { identifier: strings };
      const text = (strings as string[]).reduce((acc, s, i) => `${acc}${i ? `$${i}` : ''}${s}`, '')
        .replace(/\s+/g, ' ').trim();
      statements.push({ text, params, options });
      return Promise.resolve().then(() => answer(world, text, params, readOnly));
    };
    const tx = Object.assign(call, {
      array: (value: unknown[]) => value,
      json: (value: unknown) => value,
      savepoint: async (cb: (sp: unknown) => unknown) => cb(tx),
    });
    try {
      return await fn(tx as unknown as TransactionSql);
    } catch (error) {
      // `setval` is non-transactional in PostgreSQL: a raised sequence outlives the rollback.
      const { sequence } = world;
      Object.assign(world, snapshot, { sequence });
      throw error;
    }
  };
  return { connection: { begin }, statements };
}

const WRITE_RE = /^(INSERT|UPDATE|DELETE|SELECT setval)/;

function identityRowsFor(world: FakeWorld) {
  return world.identities.filter((r) => r.sourceKey === 'afl_api');
}

function acceptedIdentityRows(world: FakeWorld) {
  return world.identities.filter((r) => ((r.sourceKey === 'afltables' && r.matchMethod === 'afltables_profile_url')
    || (r.sourceKey === 'manual_admin_edit' && r.matchMethod === 'manual_admin_edit'))
    && (r.status === 'unique' || r.status === 'resolved'));
}

function answer(world: FakeWorld, text: string, params: unknown[], readOnly: boolean): unknown[] {
  if (readOnly && WRITE_RE.test(text)) {
    throw new FakeDbError(`cannot execute ${text.split(' ')[0]} in a read-only transaction`, '25006');
  }
  const has = (...needles: string[]) => needles.every((n) => text.includes(n));

  // --- session ---------------------------------------------------------------------------
  if (has('current_database() AS database', 'current_user AS role')) {
    return [{ database: world.database, role: world.role, readOnly: readOnly ? 'on' : 'off' }];
  }
  if (has('current_database() AS database', "current_setting('transaction_read_only')")) {
    return [{ database: world.database, readOnly: readOnly ? 'on' : 'off' }];
  }
  if (has("SELECT shobj_description(oid, 'pg_database') AS comment FROM pg_database")) {
    return [{ comment: world.databaseComment }];
  }
  if (text === "SELECT id FROM sources WHERE key = 'afl_api'") {
    return world.sources.afl_api === undefined ? [] : [{ id: world.sources.afl_api }];
  }

  // --- external_identities reads ---------------------------------------------------------
  if (has('SELECT id, external_id AS "externalId", status::text AS status', 'FROM external_identities WHERE source_id')) {
    return identityRowsFor(world).map((r) => ({
      id: r.id, externalId: r.externalId, status: r.status, matchMethod: r.matchMethod, playerId: r.playerId,
    }));
  }
  if (has('SELECT external_id AS "externalId", status::text AS status, match_method AS "matchMethod"', '"candidateCount"')) {
    return identityRowsFor(world).map((r) => ({
      externalId: r.externalId, status: r.status, matchMethod: r.matchMethod, playerId: r.playerId,
      candidateCount: r.candidateCount, externalUrl: r.externalUrl,
    }));
  }
  if (has('SELECT external_id AS "externalId", status::text AS status', "status = 'resolved'")) {
    return identityRowsFor(world).filter((r) => r.status === 'resolved')
      .map((r) => ({ externalId: r.externalId, status: r.status, matchMethod: r.matchMethod }));
  }
  if (has('SELECT DISTINCT ei.external_id AS "externalId", ei.player_id AS "playerId"', '= ANY')) {
    const paths = new Set(params[0] as string[]);
    const seen = new Set<string>();
    return acceptedIdentityRows(world).filter((r) => paths.has(r.externalId))
      .filter((r) => { const k = `${r.externalId}|${r.playerId}`; if (seen.has(k)) return false; seen.add(k); return true; })
      .map((r) => ({ externalId: r.externalId, playerId: r.playerId }));
  }
  if (has('SELECT DISTINCT ei.player_id AS "playerId"', 'ei.external_id = $1')) {
    return [...new Set(acceptedIdentityRows(world).filter((r) => r.externalId === params[0]).map((r) => r.playerId))]
      .map((playerId) => ({ playerId }));
  }
  if (has('SELECT ei.player_id AS "playerId", ei.external_id AS "externalId", s.key AS "sourceKey"')) {
    const ids = new Set(params[0] as number[]);
    return acceptedIdentityRows(world).filter((r) => r.playerId !== null && ids.has(r.playerId))
      .map((r) => ({ playerId: r.playerId, externalId: r.externalId, sourceKey: r.sourceKey }));
  }

  // --- external_identities writes --------------------------------------------------------
  if (has('INSERT INTO external_identities')) {
    const isHuman = text.includes("'resolved'");
    const [sourceId, externalId] = params as [number, string];
    const sourceKey = Object.entries(world.sources).find(([, id]) => id === sourceId)?.[0] ?? '?';
    const row: FakeIdentity = isHuman
      ? { id: nextId(world.identities), sourceKey, externalId, playerId: params[2] as number, status: 'resolved',
        matchMethod: params[3] as string, candidateCount: 0, externalUrl: null, externalName: null, notes: 'human' }
      : { id: nextId(world.identities), sourceKey, externalId, externalName: params[2] as string | null,
        playerId: params[3] as number, status: 'unique', candidateCount: 1, matchMethod: params[4] as string,
        notes: params[5] as string | null, externalUrl: null };
    if (world.identities.some((r) => r.sourceKey === row.sourceKey && r.externalId === row.externalId)) {
      throw new FakeDbError('duplicate key value violates unique constraint "external_identities_uq"', '23505');
    }
    if (row.sourceKey === 'afl_api' && world.identities.some((r) => r.sourceKey === 'afl_api' && r.playerId === row.playerId)) {
      throw new FakeDbError('duplicate key value violates unique constraint "uq_external_identities_afl_api_player"', '23505');
    }
    world.identities.push(row);
    return text.includes('RETURNING id') ? [{ id: row.id }] : [];
  }
  if (/^(UPDATE|DELETE)/.test(text) && text.includes('external_identities')) {
    throw new Error(`fake db: an UPDATE/DELETE of external_identities was issued: ${text}`);
  }

  // --- data_issues / import batches ------------------------------------------------------
  if (has('SELECT issue_key AS "issueKey" FROM data_issues')) {
    const keys = new Set(params[1] as string[]);
    return world.dataIssues.filter((d) => d.issueType === params[0] && d.resolvedAt === null && d.issueKey !== null && keys.has(d.issueKey))
      .map((d) => ({ issueKey: d.issueKey }));
  }
  if (has('INSERT INTO data_issues', 'ON CONFLICT (issue_type, issue_key)', 'DO NOTHING')) {
    const [entityId, issueType, issueKey, description, details] = params as [number, string, string, string, unknown];
    if (world.dataIssues.some((d) => d.issueType === issueType && d.issueKey === issueKey && d.resolvedAt === null)) return [];
    const id = nextId(world.dataIssues);
    world.dataIssues.push({ id, entityType: 'external_identities', entityId, issueType, issueKey, description, details, resolvedAt: null });
    return [{ id: String(id) }];
  }
  if (has('INSERT INTO import_batches', 'RETURNING id::text AS id')) {
    const id = nextId(world.importBatches as { id: number }[]);
    world.importBatches.push({ id, text, params, status: text.includes("'completed'") ? 'completed' : 'running' });
    return [{ id: String(id) }];
  }
  if (has('INSERT INTO import_rejections')) {
    world.importRejections.push({ batchId: params[0], sourceRecordId: params[1], reason: params[2], payload: params[3] });
    return [];
  }
  if (has('UPDATE import_batches')) {
    const batch = world.importBatches.find((b) => String(b.id) === String(params[params.length - 1]));
    if (!batch) throw new Error('fake db: UPDATE of an unknown import batch');
    batch.status = 'completed';
    batch.recordsInserted = params[1];
    batch.validation = params[3];
    return [];
  }

  // --- the adjudication ledger -----------------------------------------------------------
  if (has("to_regclass('public.afl_api_identity_adjudications') IS NOT NULL AS present")) {
    return [{ present: world.ledgerTablePresent }];
  }
  if (has('FROM afl_api_identity_adjudications a', 'JOIN auth_users u')) {
    return world.ledger.map((r) => {
      const actor = world.authUsers.find((u) => u.id === r.adminUserId);
      return {
        id: String(r.id), sourceKey: r.sourceKey, externalId: r.externalId, action: r.action, playerId: r.playerId,
        playerIdentity: r.playerIdentity, previousState: r.previousState === null ? null : pgJsonbText(r.previousState),
        evidence: pgJsonbText(r.evidence),
        evidenceSha256: r.evidenceSha256, surnameDisagreementAcknowledged: r.surnameDisagreementAcknowledged,
        supersedesId: r.supersedesId === null ? null : String(r.supersedesId), adminUserId: r.adminUserId,
        adminEmail: actor?.email, adminRole: actor?.role, note: r.note, createdAt: r.createdAt,
      };
    }).filter((r) => r.adminEmail !== undefined).sort((a, b) => Number(a.id) - Number(b.id));
  }
  if (has('SELECT count(*)::int AS total FROM afl_api_identity_adjudications')) return [{ total: world.ledger.length }];
  if (has('SELECT id, external_id AS "externalId", action, player_id AS "playerId"', 'FROM afl_api_identity_adjudications')) {
    return [...world.ledger].sort((a, b) => a.id - b.id).map((r) => ({
      id: r.id, externalId: r.externalId, action: r.action, playerId: r.playerId,
      playerIdentity: r.playerIdentity, supersedesId: r.supersedesId,
    }));
  }
  if (has('INSERT INTO afl_api_identity_adjudications', 'OVERRIDING SYSTEM VALUE')) {
    const [id, sourceKey, externalId, action, playerId, playerIdentity, previousState, evidence, evidenceSha256,
      surnameDisagreementAcknowledged, supersedesId, adminUserId, note, createdAt] = params as [
      number, string, string, 'linked' | 'revoked', number, string, string | null, string, string, boolean,
      number | null, number, string, string];
    if (world.ledger.some((r) => r.id === id)) throw new FakeDbError('duplicate key value violates unique constraint (ledger pkey)', '23505');
    if (!world.authUsers.some((u) => u.id === adminUserId)) throw new FakeDbError('ledger admin_user_id FK violation', '23503');
    // `${text}::text::jsonb`: stored as jsonb, so the text form is PostgreSQL's, not the caller's.
    world.ledger.push({ id, sourceKey, externalId, action, playerId, playerIdentity,
      previousState: previousState === null ? null : pgJsonbText(previousState), evidence: pgJsonbText(evidence),
      evidenceSha256, surnameDisagreementAcknowledged, supersedesId, adminUserId, note, createdAt });
    return [];
  }
  if (has("pg_get_serial_sequence('afl_api_identity_adjudications', 'id')")) {
    return [{ name: 'public.afl_api_identity_adjudications_id_seq' }];
  }
  if (has('SELECT last_value::text AS "lastValue", is_called AS "isCalled" FROM')) {
    return [{ lastValue: String(world.sequence.lastValue), isCalled: world.sequence.isCalled }];
  }
  if (has('SELECT setval(')) {
    world.sequence = { lastValue: Number(params[1]), isCalled: true };
    return [{ setval: params[1] }];
  }

  // --- auth_users ------------------------------------------------------------------------
  if (has('SELECT id, email, role FROM auth_users WHERE lower(email) = ANY')) {
    const emails = new Set(params[0] as string[]);
    return world.authUsers.filter((u) => emails.has(u.email.toLowerCase()));
  }
  if (has('INSERT INTO auth_users (email, role, password_hash, totp_secret, disabled_at)')) {
    const id = nextId(world.authUsers);
    world.authUsers.push({ id, email: params[0] as string, role: params[1] as string });
    return [{ id }];
  }

  throw new Error(`fake db: no rule for statement: ${text}`);
}
