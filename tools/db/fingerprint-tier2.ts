/**
 * AFLDB-ISSUE-278 — Tier 2 fingerprint SUPPLEMENT for `afldb_test` (READ-ONLY).
 *
 *     npm run db:test:fingerprint-tier2 -- --out <evidence.json>
 *     npm run db:test:fingerprint-tier2 -- --compare <before.json> <after.json>
 *
 * Tier 1 (`tools/db/catalog-fingerprint.ts`) proves the SCHEMA is intact. It deliberately omits
 * table contents, sequence positions, and the bodies of routines, defaults, checks, indexes,
 * triggers, policies, comments and storage options. This supplement records those, so that a
 * rollback-only reset proof can be bracketed by a much harder-to-fool before/after comparison.
 *
 * WHAT IT RECORDS (collect mode), all inside ONE `READ ONLY` `REPEATABLE READ` transaction that
 * is rolled back, never committed:
 *
 *   - identity: database, current_user, session_user, database oid, postmaster start time,
 *     server version and port;
 *   - Tier 1 itself (the same sections and digest, taken in the same snapshot);
 *   - a row count and a deterministic whole-row digest for EVERY user table and populated
 *     materialized view. Each row is hashed (sha256 of its text form under pinned output
 *     settings) and the hashes are SUMMED as exact numerics, so the digest does not depend on
 *     row order and a duplicated row changes it (a multiset digest); the row count is recorded
 *     beside it. Only the final sha256 and the count reach the evidence file;
 *   - every sequence's last_value and is_called, plus the settings Tier 1 lacks (data type,
 *     cache, cycle, and the column that owns it);
 *   - digests of definitions Tier 1 omits: routines, column defaults, check constraints,
 *     foreign keys (target included), key constraints, indexes (predicates and expressions
 *     included), triggers, policies, rules/views, user types, inheritance, event triggers,
 *     object comments (and the database comment), relation storage options and per-column
 *     storage/ACL options.
 *
 * WHAT IT DOES NOT COVER: index and TOAST physical contents, extended statistics, publications
 * and subscriptions, foreign servers and user mappings, roles, role membership and
 * database-level settings, large objects, security labels, planner statistics, and the content
 * of foreign tables. A match is evidence about what the SELECTs below observed; it is NOT proof
 * that no sequence operation occurred (a sequence moved and put back would match).
 *
 * NO CONTENT LEAVES THE DATABASE. The evidence holds hashes, counts, object names, sequence
 * values and catalog metadata. No row content, no credential, no connection string.
 *
 * FAILS CLOSED. An unreadable object, a table the role may only partly see (row level
 * security), a section that errors, or a count that disagrees with an independent catalog
 * count aborts the whole collection: an INCOMPLETE record is written and the exit status is 2.
 * `--compare` refuses any input that is not a COMPLETE record, so two failures can never match.
 *
 * It cannot change anything, enforced rather than promised: the only SQL it can reach is in this
 * file (SELECT and SET LOCAL, plus BEGIN READ ONLY and ROLLBACK); the session is also put into
 * default_transaction_read_only before the transaction begins; it spawns nothing and never
 * references RESET_SQL or psql. A DB-free test asserts this.
 */

import { createHash } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';

import {
  FINGERPRINT_SECTIONS, collectSections, fingerprintOf, isTrue, type Query, type Row,
} from './catalog-fingerprint';
import { redact } from './psql';
import { assertDsnPinsTarget, assertRebuildTargetName, databaseOf } from './rebuild-test';

export const TIER2_SCHEMA_VERSION = 1;
export const TIER2_EXPECTED_DATABASE = 'afldb_test';
export const TIER2_EXPECTED_ROLE = 'afldb_owner';

/** Incomplete, unreadable, refused or inconsistent: never a pass. */
export class Tier2Incomplete extends Error {
  constructor(public readonly stage: string, message: string) {
    super(message);
    this.name = 'Tier2Incomplete';
  }
}

// ---------------------------------------------------------------------------
// SQL — SELECT and SET only
// ---------------------------------------------------------------------------

/** Session level, before the transaction: the SERVER rejects a write even if one were issued. */
export const READ_ONLY_SESSION_SQL = 'SET default_transaction_read_only = on';
export const BEGIN_SQL = 'BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY';
export const END_SQL = 'ROLLBACK';

/**
 * Pinned so the text form of a row, a timestamp or an identifier does not depend on the session
 * that happened to run the query. All transaction-local.
 */
export const SETUP_SQL: string[] = [
  `SET LOCAL statement_timeout = '600s'`,
  `SET LOCAL lock_timeout = '5s'`,
  `SET LOCAL idle_in_transaction_session_timeout = '300s'`,
  `SET LOCAL client_min_messages = warning`,
  `SET LOCAL search_path = pg_catalog`,
  `SET LOCAL DateStyle = 'ISO, YMD'`,
  `SET LOCAL IntervalStyle = 'postgres'`,
  `SET LOCAL TimeZone = 'UTC'`,
  `SET LOCAL extra_float_digits = 1`,
  `SET LOCAL bytea_output = 'hex'`,
  `SET LOCAL lc_monetary = 'C'`,
  `SET LOCAL xmlbinary = 'base64'`,
];

export const IDENTITY_SQL = `
SELECT current_database() AS database,
       current_user::text AS current_user_name,
       session_user::text AS session_user_name,
       (SELECT d.oid::text FROM pg_database d WHERE d.datname = current_database()) AS database_oid,
       pg_postmaster_start_time()::text AS postmaster_start,
       current_setting('server_version') AS server_version,
       coalesce(inet_server_port()::text, '-') AS server_port,
       current_setting('transaction_read_only') AS transaction_read_only,
       current_setting('transaction_isolation') AS transaction_isolation`;

const USER_SCHEMA = `n.nspname NOT IN ('pg_catalog', 'information_schema')
                     AND n.nspname !~ '^pg_'`;

/** Every user table (and populated or not materialized view), with what is needed to read it all. */
export const TABLE_INVENTORY_SQL = `
SELECT n.nspname AS schema_name, c.relname AS table_name, c.relkind::text AS kind,
       format('%I.%I', n.nspname, c.relname) AS qname,
       c.relispopulated AS populated,
       has_table_privilege(c.oid, 'SELECT') AS can_select,
       (c.relrowsecurity AND NOT me.rolsuper AND NOT me.rolbypassrls
          AND (c.relforcerowsecurity OR NOT pg_has_role(c.relowner, 'USAGE'))) AS rls_may_filter
FROM pg_class c
JOIN pg_namespace n ON n.oid = c.relnamespace
CROSS JOIN (SELECT rolsuper, rolbypassrls FROM pg_roles WHERE rolname = current_user) me
WHERE ${USER_SCHEMA} AND c.relkind IN ('r', 'm')
ORDER BY n.nspname, c.relname`;

/** An independent count, to compare with what the inventories returned. */
export const OBJECT_COUNTS_SQL = `
SELECT count(*) FILTER (WHERE c.relkind = 'r')::text AS tables,
       count(*) FILTER (WHERE c.relkind = 'm')::text AS matviews,
       count(*) FILTER (WHERE c.relkind = 'S')::text AS sequences
FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE ${USER_SCHEMA}`;

export const SEQUENCE_INVENTORY_SQL = `
SELECT n.nspname AS schema_name, c.relname AS seq_name,
       format('%I.%I', n.nspname, c.relname) AS qname,
       format('type=%s|cache=%s|cycle=%s|owned_by=%s',
              coalesce((SELECT format('%s.%s', tn.nspname, t.typname)
                        FROM pg_type t JOIN pg_namespace tn ON tn.oid = t.typnamespace
                        WHERE t.oid = s.seqtypid), '?'),
              s.seqcache, s.seqcycle,
              coalesce((SELECT format('%s:%s.%s.%s', d.deptype, on_.nspname, oc.relname, a.attname)
                        FROM pg_depend d
                        JOIN pg_class oc ON oc.oid = d.refobjid
                        JOIN pg_namespace on_ ON on_.oid = oc.relnamespace
                        JOIN pg_attribute a ON a.attrelid = d.refobjid AND a.attnum = d.refobjsubid
                        WHERE d.classid = 'pg_class'::regclass AND d.objid = c.oid
                          AND d.refclassid = 'pg_class'::regclass AND d.deptype IN ('a', 'i')
                        ORDER BY 1 LIMIT 1), '-')) AS definition,
       has_sequence_privilege(c.oid, 'SELECT') AS can_select
FROM pg_sequence s
JOIN pg_class c ON c.oid = s.seqrelid
JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE ${USER_SCHEMA}
ORDER BY n.nspname, c.relname`;

/**
 * Reading a sequence relation is a plain SELECT; it does not advance it. `qname` is built by the
 * SERVER with format('%I.%I'), so it is already a quoted, schema-qualified identifier.
 */
export function sequenceValueSql(qname: string): string {
  return `SELECT last_value::text AS last_value, is_called FROM ${qname}`;
}

/**
 * Count and a multiset digest of the whole rows of one table. Each row's text form is hashed with
 * sha256; the 256-bit hash is cut into four 64-bit limbs and each limb is SUMMED as an exact
 * numeric (no overflow, no modulus). A sum does not depend on row order, and a duplicate row adds
 * its hash again, so duplicates are preserved. `FROM ONLY` keeps a legacy-inheritance parent from
 * double counting its children.
 */
export function tableDigestSql(qname: string): string {
  const limb = (from: number): string =>
    `coalesce(sum(('x' || substr(d, ${from}, 16))::bit(64)::bigint::numeric), 0)::text`;
  return `SELECT count(*)::text AS n,
       ${limb(1)} AS s1, ${limb(17)} AS s2, ${limb(33)} AS s3, ${limb(49)} AS s4
FROM (SELECT encode(sha256(convert_to(t::text, 'UTF8')), 'hex') AS d FROM ONLY ${qname} AS t) h`;
}

const digestOf = (jsonbExpr: string): string =>
  `encode(sha256(convert_to((${jsonbExpr})::text, 'UTF8')), 'hex')`;

function definitionSection(
  id: string, identity: string, jsonbExpr: string, from: string, where?: string,
): { id: string; sql: string } {
  return {
    id,
    sql: `SELECT format('%s|%s', ${identity}, ${digestOf(jsonbExpr)}) AS k
          FROM ${from}
          WHERE ${USER_SCHEMA}${where ? ` AND ${where}` : ''} ORDER BY 1`,
  };
}

/**
 * Each section is an ordered list of `identity|sha256(definition)` lines. `to_jsonb` of a catalog
 * row captures every column that exists on the server's version, so a column added by a newer
 * PostgreSQL is covered rather than silently skipped. The lines are hashed in this process and
 * only the section digest and count are kept.
 */
export const DEFINITION_SECTIONS: { id: string; sql: string }[] = [
  definitionSection('routines',
    `n.nspname || '.' || p.proname || '(' || p.proargtypes::text || ')'`, 'to_jsonb(p)',
    'pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace'),
  definitionSection('defaults',
    `n.nspname || '.' || c.relname || '.' || d.adnum`, 'to_jsonb(d)',
    `pg_attrdef d JOIN pg_class c ON c.oid = d.adrelid
     JOIN pg_namespace n ON n.oid = c.relnamespace`),
  definitionSection('checks',
    `n.nspname || '.' || co.conname || '|' || co.contype::text || '|' || coalesce(cl.relname, '-')
       || '|' || coalesce(ty.typname, '-')`, 'to_jsonb(co)',
    `pg_constraint co JOIN pg_namespace n ON n.oid = co.connamespace
     LEFT JOIN pg_class cl ON cl.oid = co.conrelid
     LEFT JOIN pg_type ty ON ty.oid = co.contypid`,
    `co.contype IN ('c', 'n')`),
  definitionSection('foreign_keys',
    `n.nspname || '.' || cl.relname || '->' || rn.nspname || '.' || rc.relname
       || '|' || co.conname`, 'to_jsonb(co)',
    `pg_constraint co JOIN pg_namespace n ON n.oid = co.connamespace
     JOIN pg_class cl ON cl.oid = co.conrelid
     JOIN pg_class rc ON rc.oid = co.confrelid
     JOIN pg_namespace rn ON rn.oid = rc.relnamespace`,
    `co.contype = 'f'`),
  definitionSection('key_constraints',
    `n.nspname || '.' || cl.relname || '|' || co.conname || '|' || co.contype::text`, 'to_jsonb(co)',
    `pg_constraint co JOIN pg_namespace n ON n.oid = co.connamespace
     JOIN pg_class cl ON cl.oid = co.conrelid`,
    `co.contype IN ('p', 'u', 'x', 't')`),
  definitionSection('indexes',
    `n.nspname || '.' || t.relname || '|' || i.relname`, 'to_jsonb(x)',
    `pg_index x JOIN pg_class i ON i.oid = x.indexrelid
     JOIN pg_class t ON t.oid = x.indrelid
     JOIN pg_namespace n ON n.oid = t.relnamespace`),
  definitionSection('triggers',
    `n.nspname || '.' || cl.relname || '|' || tg.tgname`, 'to_jsonb(tg)',
    `pg_trigger tg JOIN pg_class cl ON cl.oid = tg.tgrelid
     JOIN pg_namespace n ON n.oid = cl.relnamespace`),
  definitionSection('policies',
    `n.nspname || '.' || cl.relname || '|' || po.polname`, 'to_jsonb(po)',
    `pg_policy po JOIN pg_class cl ON cl.oid = po.polrelid
     JOIN pg_namespace n ON n.oid = cl.relnamespace`),
  definitionSection('rules',
    `n.nspname || '.' || cl.relname || '|' || r.rulename`, 'to_jsonb(r)',
    `pg_rewrite r JOIN pg_class cl ON cl.oid = r.ev_class
     JOIN pg_namespace n ON n.oid = cl.relnamespace`),
  definitionSection('types',
    `n.nspname || '.' || t.typname`, 'to_jsonb(t)',
    'pg_type t JOIN pg_namespace n ON n.oid = t.typnamespace'),
  definitionSection('inherits',
    `n.nspname || '.' || c.relname || '<-' || p.relname || '|' || i.inhseqno`, 'to_jsonb(i)',
    `pg_inherits i JOIN pg_class c ON c.oid = i.inhrelid
     JOIN pg_class p ON p.oid = i.inhparent
     JOIN pg_namespace n ON n.oid = c.relnamespace`),
  definitionSection('relation_options',
    `n.nspname || '.' || c.relname || '|' || c.relkind::text`,
    `jsonb_build_object(
       'reloptions', c.reloptions,
       'tablespace', coalesce(ts.spcname, '-'),
       'am', coalesce(am.amname, '-'),
       'persistence', c.relpersistence,
       'replident', c.relreplident,
       'rowsecurity', c.relrowsecurity,
       'forcerowsecurity', c.relforcerowsecurity,
       'ispartition', c.relispartition,
       'partbound', c.relpartbound::text,
       'toast_reloptions', (SELECT tc.reloptions FROM pg_class tc WHERE tc.oid = c.reltoastrelid),
       'typed_of', c.reloftype::text)`,
    `pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
     LEFT JOIN pg_tablespace ts ON ts.oid = c.reltablespace
     LEFT JOIN pg_am am ON am.oid = c.relam`,
    `c.relkind IN ('r', 'p', 'v', 'm', 'S', 'f', 'i', 'I')`),
  definitionSection('column_options',
    `n.nspname || '.' || c.relname || '.' || a.attnum || '.' || a.attname`,
    `to_jsonb(a) - 'attcacheoff'`,
    `pg_attribute a JOIN pg_class c ON c.oid = a.attrelid
     JOIN pg_namespace n ON n.oid = c.relnamespace`,
    `a.attnum > 0 AND NOT a.attisdropped AND c.relkind IN ('r', 'p', 'v', 'm', 'f')`),
  {
    id: 'event_triggers',
    sql: `SELECT format('%s|%s', e.evtname, ${digestOf('to_jsonb(e)')}) AS k
          FROM pg_event_trigger e ORDER BY 1`,
  },
  {
    // All object comments, by (class, object, sub-object) oid. Static system comments are
    // included: they cost a few thousand short rows and keep the section free of a per-class
    // name resolver that would depend on search_path.
    id: 'comments',
    sql: `SELECT format('%s:%s:%s|%s', d.classoid, d.objoid, d.objsubid,
                        encode(sha256(convert_to(d.description, 'UTF8')), 'hex')) AS k
          FROM pg_description d ORDER BY 1`,
  },
  {
    id: 'database_comment',
    sql: `SELECT format('database|%s',
                        encode(sha256(convert_to(coalesce(shobj_description(d.oid, 'pg_database'), '-'),
                                                 'UTF8')), 'hex')) AS k
          FROM pg_database d WHERE d.datname = current_database()`,
  },
];

/** Every statement this module can send, for the DB-free read-only assertions. */
export function allStatements(): string[] {
  return [
    READ_ONLY_SESSION_SQL, BEGIN_SQL, END_SQL, ...SETUP_SQL, IDENTITY_SQL, TABLE_INVENTORY_SQL,
    OBJECT_COUNTS_SQL, SEQUENCE_INVENTORY_SQL,
    sequenceValueSql('"s"."q"'), tableDigestSql('"s"."t"'),
    ...FINGERPRINT_SECTIONS.map((s) => s.sql),
    ...DEFINITION_SECTIONS.map((s) => s.sql),
  ];
}

// ---------------------------------------------------------------------------
// Record
// ---------------------------------------------------------------------------

export type Tier2Identity = {
  database: string;
  currentUser: string;
  sessionUser: string;
  databaseOid: string;
  postmasterStart: string;
  serverVersion: string;
  serverPort: string;
};

export type Tier2Table = {
  schema: string;
  name: string;
  kind: string;          // 'r' table, 'm' materialized view
  populated: boolean;
  rows: string;          // bigint as text
  digest: string;        // sha256 hex, or 'unpopulated'
};

export type Tier2Sequence = {
  schema: string;
  name: string;
  definition: string;
  lastValue: string;
  isCalled: boolean;
};

export type Tier2Record = {
  schemaVersion: typeof TIER2_SCHEMA_VERSION;
  status: 'COMPLETE';
  tool: 'fingerprint-tier2';
  collectedUtc: string;
  elapsedMs: number;
  identity: Tier2Identity;
  transaction: { readOnly: 'on'; isolation: 'repeatable read'; settings: string[] };
  tier1: { overall: string; sections: Record<string, string>; counts: Record<string, number> };
  definitions: Record<string, { count: number; digest: string }>;
  tables: Tier2Table[];
  sequences: Tier2Sequence[];
  totals: { tables: number; materializedViews: number; sequences: number; rows: string };
  overall: string;
  notes: string[];
};

export type Tier2IncompleteRecord = {
  schemaVersion: typeof TIER2_SCHEMA_VERSION;
  status: 'INCOMPLETE';
  tool: 'fingerprint-tier2';
  collectedUtc: string;
  stage: string;
  error: { name: string; code?: string; message: string };
};

export const TIER2_NOTES: string[] = [
  'Evidence holds hashes, counts, object names, sequence values and catalog metadata only: no row content, credential or connection string.',
  'Table digests are multiset digests: sum over rows of the four 64-bit limbs of sha256(row text); duplicates are preserved; row order is irrelevant.',
  'A match describes unchanged observed state. It is not proof that no sequence operation occurred.',
  'Not covered: index/TOAST physical contents, extended statistics, publications, subscriptions, foreign servers, roles and memberships, database-level settings, large objects, security labels, planner statistics, foreign-table contents.',
];

const sha256 = (text: string): string => createHash('sha256').update(text, 'utf8').digest('hex');
const cmp = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);
const text = (value: unknown): string => String(value ?? '');

export function sectionDigest(id: string, items: string[]): string {
  return sha256(`${id}\n${items.join('\n')}`);
}

/** sha256 over the table identity, its row count and the four summed limbs. */
export function tableDigest(
  qname: string, count: string, limbs: [string, string, string, string],
): string {
  return sha256(['afldb-tier2-table', qname, count, ...limbs].join('\n'));
}

/** The one digest of the whole observed state. Identity is compared separately. */
export function computeOverall(
  r: Pick<Tier2Record, 'tier1' | 'definitions' | 'tables' | 'sequences'>,
): string {
  const lines: string[] = ['afldb-tier2-v1', JSON.stringify(['tier1', r.tier1.overall])];
  for (const id of Object.keys(r.definitions).sort()) {
    lines.push(JSON.stringify(['def', id, r.definitions[id].count, r.definitions[id].digest]));
  }
  for (const t of [...r.tables].sort((a, b) => cmp(`${a.schema}\u0000${a.name}`, `${b.schema}\u0000${b.name}`))) {
    lines.push(JSON.stringify(['table', t.schema, t.name, t.kind, t.populated, t.rows, t.digest]));
  }
  for (const s of [...r.sequences].sort((a, b) => cmp(`${a.schema}\u0000${a.name}`, `${b.schema}\u0000${b.name}`))) {
    lines.push(JSON.stringify(['seq', s.schema, s.name, s.definition, s.lastValue, s.isCalled]));
  }
  return sha256(lines.join('\n'));
}

// ---------------------------------------------------------------------------
// Collection
// ---------------------------------------------------------------------------

async function step<T>(stage: string, fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (error) {
    if (error instanceof Tier2Incomplete) throw error;
    throw new Tier2Incomplete(stage, `${stage} failed: ${describeError(error).message}`);
  }
}

const num = (row: Row | undefined, key: string): number => Number(text(row?.[key]));

/**
 * Collect the record. `q` must run its statements on ONE connection in order. Any failure throws
 * Tier2Incomplete; no partial record is ever returned.
 */
export async function collectTier2(q: Query, clock: () => number = Date.now): Promise<Tier2Record> {
  const started = clock();

  await step('session', async () => { await q(READ_ONLY_SESSION_SQL); });
  await step('begin', async () => { await q(BEGIN_SQL); });
  let record: Tier2Record;
  try {
    record = await collectInsideTransaction(q);
  } catch (error) {
    try { await q(END_SQL); } catch { /* the connection is going away; the original error stands */ }
    throw error;
  }
  await step('rollback', async () => { await q(END_SQL); });
  record.elapsedMs = clock() - started;
  return record;
}

async function collectInsideTransaction(q: Query): Promise<Tier2Record> {
  for (const statement of SETUP_SQL) {
    await step('setup', async () => { await q(statement); });
  }

  const idRow = (await step('identity', () => q(IDENTITY_SQL)))[0];
  if (text(idRow?.transaction_read_only) !== 'on') {
    throw new Tier2Incomplete('identity', 'The transaction is not read-only; refusing to continue.');
  }
  if (text(idRow?.transaction_isolation) !== 'repeatable read') {
    throw new Tier2Incomplete('identity', 'The transaction is not REPEATABLE READ; refusing to continue.');
  }
  const identity: Tier2Identity = {
    database: text(idRow?.database),
    currentUser: text(idRow?.current_user_name),
    sessionUser: text(idRow?.session_user_name),
    databaseOid: text(idRow?.database_oid),
    postmasterStart: text(idRow?.postmaster_start),
    serverVersion: text(idRow?.server_version),
    serverPort: text(idRow?.server_port),
  };
  for (const [field, value] of Object.entries(identity)) {
    if (!value) throw new Tier2Incomplete('identity', `Identity field ${field} came back empty.`);
  }
  if (identity.database !== TIER2_EXPECTED_DATABASE) {
    throw new Tier2Incomplete('identity',
      `Connected to '${identity.database}', not '${TIER2_EXPECTED_DATABASE}'.`);
  }
  if (identity.currentUser !== TIER2_EXPECTED_ROLE || identity.sessionUser !== TIER2_EXPECTED_ROLE) {
    throw new Tier2Incomplete('identity',
      `Connected as current_user '${identity.currentUser}' / session_user '${identity.sessionUser}', `
      + `not '${TIER2_EXPECTED_ROLE}'. An inherited AFLDB_TEST_DATABASE_URL for another role is the usual cause.`);
  }

  // Tier 1, in the same snapshot.
  const sections = await step('tier1', () => collectSections(q));
  const tier1 = fingerprintOf(sections);
  const tier1Counts: Record<string, number> = {};
  for (const [id, rows] of Object.entries(sections)) tier1Counts[id] = rows.length;

  // Definitions.
  const definitions: Tier2Record['definitions'] = {};
  for (const section of DEFINITION_SECTIONS) {
    const rows = await step(`definitions:${section.id}`, () => q(section.sql));
    if (!Array.isArray(rows)) {
      throw new Tier2Incomplete(`definitions:${section.id}`, 'The section returned no result set.');
    }
    const items = rows.map((r) => text(r.k));
    if (items.some((item) => item === '')) {
      throw new Tier2Incomplete(`definitions:${section.id}`, 'The section returned an empty line.');
    }
    definitions[section.id] = { count: items.length, digest: sectionDigest(section.id, items) };
  }

  // Independent catalog counts, in the same snapshot, to compare with what the inventories return.
  const counts = (await step('counts', () => q(OBJECT_COUNTS_SQL)))[0];

  // Tables.
  const inventory = await step('tables:inventory', () => q(TABLE_INVENTORY_SQL));
  const tables: Tier2Table[] = [];
  const unreadable: string[] = [];
  const filtered: string[] = [];
  for (const row of inventory) {
    const qname = text(row.qname);
    if (!isTrue(row.can_select)) unreadable.push(qname);
    if (isTrue(row.rls_may_filter)) filtered.push(qname);
  }
  if (unreadable.length > 0) {
    throw new Tier2Incomplete('tables:privilege',
      `${unreadable.length} table(s) cannot be read by ${identity.currentUser}: ${unreadable.slice(0, 10).join(', ')}.`);
  }
  if (filtered.length > 0) {
    throw new Tier2Incomplete('tables:rls',
      `${filtered.length} table(s) may be filtered by row level security for ${identity.currentUser}, `
      + `so a row digest would be incomplete: ${filtered.slice(0, 10).join(', ')}.`);
  }
  for (const row of inventory) {
    const qname = text(row.qname);
    const kind = text(row.kind);
    const populated = isTrue(row.populated);
    const base = { schema: text(row.schema_name), name: text(row.table_name), kind, populated };
    if (kind === 'm' && !populated) {
      tables.push({ ...base, rows: '0', digest: 'unpopulated' });
      continue;
    }
    const result = (await step(`table:${qname}`, () => q(tableDigestSql(qname))))[0];
    const n = text(result?.n);
    const limbs = [text(result?.s1), text(result?.s2), text(result?.s3), text(result?.s4)];
    if (!/^\d+$/.test(n) || limbs.some((l) => !/^-?\d+$/.test(l))) {
      throw new Tier2Incomplete(`table:${qname}`, 'The row digest query returned a malformed result.');
    }
    tables.push({ ...base, rows: n, digest: tableDigest(qname, n, limbs as [string, string, string, string]) });
  }
  const tableCount = tables.filter((t) => t.kind === 'r').length;
  const matviewCount = tables.filter((t) => t.kind === 'm').length;
  if (tableCount !== num(counts, 'tables') || matviewCount !== num(counts, 'matviews')) {
    throw new Tier2Incomplete('tables:count',
      `Digested ${tableCount} table(s) and ${matviewCount} materialized view(s); the catalog counts `
      + `${text(counts?.tables)} and ${text(counts?.matviews)}.`);
  }

  // Sequences.
  const seqInventory = await step('sequences:inventory', () => q(SEQUENCE_INVENTORY_SQL));
  const sequences: Tier2Sequence[] = [];
  for (const row of seqInventory) {
    const qname = text(row.qname);
    if (!isTrue(row.can_select)) {
      throw new Tier2Incomplete('sequences:privilege', `Sequence ${qname} cannot be read.`);
    }
    const value = (await step(`sequence:${qname}`, () => q(sequenceValueSql(qname))))[0];
    if (value === undefined || !/^-?\d+$/.test(text(value.last_value)) || typeof value.is_called !== 'boolean') {
      throw new Tier2Incomplete(`sequence:${qname}`, 'The sequence read returned a malformed result.');
    }
    sequences.push({
      schema: text(row.schema_name), name: text(row.seq_name), definition: text(row.definition),
      lastValue: text(value.last_value), isCalled: value.is_called,
    });
  }
  if (sequences.length !== num(counts, 'sequences') || sequences.length !== sections.sequences.length) {
    throw new Tier2Incomplete('sequences:count',
      `Read ${sequences.length} sequence(s); the catalog counts ${text(counts?.sequences)} and Tier 1 lists `
      + `${sections.sequences.length}.`);
  }

  let rows = 0n;
  for (const t of tables) rows += BigInt(t.rows);
  const partial = {
    tier1: { overall: tier1.overall, sections: tier1.sections, counts: tier1Counts },
    definitions, tables, sequences,
  };
  return {
    schemaVersion: TIER2_SCHEMA_VERSION,
    status: 'COMPLETE',
    tool: 'fingerprint-tier2',
    collectedUtc: new Date().toISOString(),
    elapsedMs: 0,
    identity,
    transaction: { readOnly: 'on', isolation: 'repeatable read', settings: SETUP_SQL },
    ...partial,
    totals: { tables: tableCount, materializedViews: matviewCount, sequences: sequences.length, rows: rows.toString() },
    overall: computeOverall(partial),
    notes: TIER2_NOTES,
  };
}

// ---------------------------------------------------------------------------
// Records on disk, comparison
// ---------------------------------------------------------------------------

export type ErrorDescription = { name: string; code?: string; message: string };

/** Never carries a connection string: URLs and password= are masked and the text is bounded. */
export function describeError(error: unknown): ErrorDescription {
  const e = error as { name?: unknown; code?: unknown; message?: unknown };
  const out: ErrorDescription = {
    name: typeof e?.name === 'string' ? e.name : 'Error',
    message: redact(typeof e?.message === 'string' ? e.message : String(error)).slice(0, 500),
  };
  if (typeof e?.code === 'string') out.code = e.code;
  return out;
}

export function incompleteRecord(stage: string, error: unknown): Tier2IncompleteRecord {
  return {
    schemaVersion: TIER2_SCHEMA_VERSION, status: 'INCOMPLETE', tool: 'fingerprint-tier2',
    collectedUtc: new Date().toISOString(), stage, error: describeError(error),
  };
}

const HEX64 = /^[0-9a-f]{64}$/;

/**
 * Parse an evidence file. Anything that is not a COMPLETE, self-consistent record of this schema
 * is refused, an INCOMPLETE record included, so a comparison can never be satisfied by failures.
 */
export function parseRecord(source: string, label: string): Tier2Record {
  let value: Record<string, unknown>;
  try {
    value = JSON.parse(source) as Record<string, unknown>;
  } catch {
    throw new Tier2Incomplete('parse', `${label} is not valid JSON.`);
  }
  if (value?.status !== 'COMPLETE') {
    throw new Tier2Incomplete('parse',
      `${label} is not a COMPLETE record (status ${JSON.stringify(value?.status)}); it cannot be compared.`);
  }
  if (value.schemaVersion !== TIER2_SCHEMA_VERSION || value.tool !== 'fingerprint-tier2') {
    throw new Tier2Incomplete('parse', `${label} has an unexpected schema version or tool.`);
  }
  const r = value as unknown as Tier2Record;
  const tier1 = r.tier1;
  const ok = typeof r.overall === 'string' && HEX64.test(r.overall)
    && tier1 && typeof tier1.overall === 'string' && HEX64.test(tier1.overall)
    && r.identity && typeof r.identity.database === 'string'
    && r.definitions && typeof r.definitions === 'object'
    && Array.isArray(r.tables) && Array.isArray(r.sequences);
  if (!ok) throw new Tier2Incomplete('parse', `${label} is missing required fields.`);
  if (computeOverall(r) !== r.overall) {
    throw new Tier2Incomplete('parse',
      `${label} fails its own consistency check (the overall digest does not match its contents).`);
  }
  return r;
}

export type Comparison = {
  match: boolean;
  identityDifferences: string[];
  drift: string[];
};

const IDENTITY_FIELDS: (keyof Tier2Identity)[] = [
  'database', 'currentUser', 'sessionUser', 'databaseOid', 'postmasterStart', 'serverVersion', 'serverPort',
];

export function compareRecords(before: Tier2Record, after: Tier2Record): Comparison {
  const identityDifferences = IDENTITY_FIELDS.filter((f) => before.identity[f] !== after.identity[f]);
  const drift: string[] = [];
  if (before.tier1.overall !== after.tier1.overall) {
    for (const id of new Set([...Object.keys(before.tier1.sections), ...Object.keys(after.tier1.sections)])) {
      if (before.tier1.sections[id] !== after.tier1.sections[id]) drift.push(`tier1:${id}`);
    }
  }
  for (const id of new Set([...Object.keys(before.definitions), ...Object.keys(after.definitions)])) {
    const b = before.definitions[id];
    const a = after.definitions[id];
    if (!b || !a || b.digest !== a.digest || b.count !== a.count) drift.push(`definitions:${id}`);
  }
  const key = (x: { schema: string; name: string }): string => `${x.schema}.${x.name}`;
  const tablesBefore = new Map(before.tables.map((t) => [key(t), t]));
  const tablesAfter = new Map(after.tables.map((t) => [key(t), t]));
  for (const name of [...new Set([...tablesBefore.keys(), ...tablesAfter.keys()])].sort()) {
    const b = tablesBefore.get(name);
    const a = tablesAfter.get(name);
    if (!b) drift.push(`table:${name} (added)`);
    else if (!a) drift.push(`table:${name} (removed)`);
    else if (b.digest !== a.digest || b.rows !== a.rows || b.kind !== a.kind) {
      drift.push(`table:${name} (rows ${b.rows} -> ${a.rows}${b.digest !== a.digest ? ', digest differs' : ''})`);
    }
  }
  const seqBefore = new Map(before.sequences.map((s) => [key(s), s]));
  const seqAfter = new Map(after.sequences.map((s) => [key(s), s]));
  for (const name of [...new Set([...seqBefore.keys(), ...seqAfter.keys()])].sort()) {
    const b = seqBefore.get(name);
    const a = seqAfter.get(name);
    if (!b) drift.push(`sequence:${name} (added)`);
    else if (!a) drift.push(`sequence:${name} (removed)`);
    else if (b.lastValue !== a.lastValue || b.isCalled !== a.isCalled || b.definition !== a.definition) {
      drift.push(`sequence:${name} (last_value ${b.lastValue} -> ${a.lastValue}, is_called ${b.isCalled} -> ${a.isCalled}`
        + `${b.definition !== a.definition ? ', settings differ' : ''})`);
    }
  }
  const match = identityDifferences.length === 0 && drift.length === 0
    && before.overall === after.overall;
  if (!match && drift.length === 0 && identityDifferences.length === 0) {
    drift.push('overall digest differs with no per-object difference found (inconsistent records)');
  }
  return { match, identityDifferences, drift };
}

export function renderComparison(before: Tier2Record, after: Tier2Record, c: Comparison): string[] {
  const lines = [
    `  before : ${before.overall}   (${before.collectedUtc})`,
    `  after  : ${after.overall}   (${after.collectedUtc})`,
    `  scope  : ${after.totals.tables} table(s), ${after.totals.materializedViews} materialized view(s), `
      + `${after.totals.sequences} sequence(s), ${Object.keys(after.definitions).length} definition sections, `
      + `${after.totals.rows} row(s) digested`,
  ];
  if (c.match) {
    lines.push('', 'MATCH — unchanged observed state: identity, Tier 1 schema fingerprint, every table row count and');
    lines.push('whole-row digest, every sequence last_value/is_called, and every definition digest are equal.');
    lines.push('This does not prove that no sequence operation occurred (a sequence moved and put back would match).');
    return lines;
  }
  lines.push('', 'MISMATCH — the observed state differs.');
  if (c.identityDifferences.length > 0) {
    lines.push(`Identity fields that differ (the two captures may not be of the same server run): ${c.identityDifferences.join(', ')}`);
  }
  if (c.drift.length > 0) {
    lines.push('Differences (names and counts only; no row content is ever printed):');
    for (const item of c.drift.slice(0, 200)) lines.push(`  - ${item}`);
    if (c.drift.length > 200) lines.push(`  ... and ${c.drift.length - 200} more`);
  }
  return lines;
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

export class Tier2Refused extends Error {}

export type Tier2Args =
  | { mode: 'collect'; out: string }
  | { mode: 'compare'; before: string; after: string };

export function parseArgs(argv: string[]): Tier2Args {
  let out: string | undefined;
  let compare: [string, string] | undefined;
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === '--out') {
      out = argv[++i];
      if (!out) throw new Tier2Refused('--out needs a file path.');
    } else if (argv[i] === '--compare') {
      const a = argv[++i];
      const b = argv[++i];
      if (!a || !b || a.startsWith('--') || b.startsWith('--')) {
        throw new Tier2Refused('--compare needs two evidence file paths: <before> <after>.');
      }
      compare = [a, b];
    } else {
      throw new Tier2Refused(`Unknown argument: ${argv[i]}`);
    }
  }
  if (out && compare) throw new Tier2Refused('--out and --compare are different modes; give one.');
  if (compare) return { mode: 'compare', before: compare[0], after: compare[1] };
  if (out) return { mode: 'collect', out };
  throw new Tier2Refused('Give --out <evidence.json> to collect, or --compare <before> <after>.');
}

/** Evidence is never overwritten: a second write to the same path is refused. */
export function writeEvidence(path: string, payload: unknown): void {
  writeFileSync(path, `${JSON.stringify(payload, null, 2)}\n`, { encoding: 'utf8', flag: 'wx' });
}

async function collectMain(out: string): Promise<number> {
  if (existsSync(out)) {
    throw new Tier2Refused('The --out file already exists; evidence is never overwritten.');
  }
  // The DSN comes from the environment ONLY. No .env fallback: an inherited value for another
  // role is exactly the trap this supplement is run to avoid, so it must be set explicitly.
  const dsn = process.env.AFLDB_TEST_DATABASE_URL;
  if (!dsn) throw new Tier2Refused('AFLDB_TEST_DATABASE_URL is not set.');
  let database: string;
  try {
    database = databaseOf(dsn);
  } catch {
    throw new Tier2Refused('AFLDB_TEST_DATABASE_URL is not a valid connection URL.');
  }
  assertRebuildTargetName(database);
  assertDsnPinsTarget(dsn, 'AFLDB_TEST_DATABASE_URL');

  console.log('AFLDB Tier-2 fingerprint supplement (AFLDB-ISSUE-278)');
  console.log('  mode          : READ-ONLY REPEATABLE READ transaction, rolled back — no DDL, no DML,');
  console.log('                  no reset path, no psql');

  const postgres = (await import('postgres')).default;
  const sql = postgres(dsn, {
    max: 1,
    onnotice: () => {},
    connect_timeout: 15,
    connection: { application_name: 'afldb-fingerprint-tier2' },
  });
  let record: Tier2Record;
  try {
    record = await collectTier2((statement) => sql.unsafe(statement).then((rows) => rows as unknown as Row[]));
  } finally {
    await sql.end({ timeout: 5 });
  }

  writeEvidence(out, record);
  const id = record.identity;
  console.log(`  database      : ${id.database}`);
  console.log(`  role          : current_user ${id.currentUser}, session_user ${id.sessionUser}`);
  console.log(`  server        : port ${id.serverPort}, PostgreSQL ${id.serverVersion}, database oid ${id.databaseOid}`);
  console.log(`  postmaster    : started ${id.postmasterStart}`);
  console.log(`  tier 1        : ${record.tier1.overall}`);
  console.log(`  scope         : ${record.totals.tables} table(s), ${record.totals.materializedViews} materialized view(s), `
    + `${record.totals.sequences} sequence(s), ${Object.keys(record.definitions).length} definition sections, `
    + `${record.totals.rows} row(s) digested`);
  console.log(`  elapsed       : ${record.elapsedMs} ms`);
  console.log(`\n  tier 2 overall: ${record.overall}`);
  console.log(`  evidence      : ${out}`);
  console.log('\nCOMPLETE. Hashes, counts and metadata only; no row content was written.');
  return 0;
}

/** Pure: throws Tier2Incomplete unless BOTH sources are COMPLETE records; 0 match, 1 mismatch. */
export function compareEvidence(beforeSource: string, afterSource: string): { code: number; lines: string[] } {
  const before = parseRecord(beforeSource, 'the before record');
  const after = parseRecord(afterSource, 'the after record');
  const comparison = compareRecords(before, after);
  return { code: comparison.match ? 0 : 1, lines: renderComparison(before, after, comparison) };
}

function compareMain(beforePath: string, afterPath: string): number {
  console.log('AFLDB Tier-2 fingerprint comparison (AFLDB-ISSUE-278) — no database contact');
  const { code, lines } = compareEvidence(readFileSync(beforePath, 'utf8'), readFileSync(afterPath, 'utf8'));
  for (const line of lines) console.log(line);
  return code;
}

async function main(argv: string[]): Promise<number> {
  const args = parseArgs(argv);
  if (args.mode === 'compare') return compareMain(args.before, args.after);
  try {
    return await collectMain(args.out);
  } catch (error) {
    // Leave an INCOMPLETE record where the evidence would have been, so the attempt is visible
    // and so a later --compare refuses it. Never overwrites a file that exists.
    if (!existsSync(args.out)) {
      try {
        writeEvidence(args.out, incompleteRecord(error instanceof Tier2Incomplete ? error.stage : 'run', error));
      } catch { /* the original error is what matters */ }
    }
    throw error;
  }
}

if (process.argv[1] && /fingerprint-tier2\.ts$/.test(process.argv[1])) {
  main(process.argv.slice(2))
    .then((code) => process.exit(code))
    .catch((error) => {
      const known = error instanceof Tier2Refused || error instanceof Tier2Incomplete;
      const described = describeError(error);
      console.error(known ? `${error instanceof Tier2Incomplete ? 'INCOMPLETE' : 'REFUSED'}: ${described.message}`
        : `INCOMPLETE: ${described.name}: ${described.message}`);
      console.error('Nothing was written to the database. This evidence is not a pass.');
      process.exit(2);
    });
}
