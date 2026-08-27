/**
 * AFLDB-ISSUE-093 §20 — the read-only catalog fingerprint.
 *
 * Extracted from tools/db/prove-reset.ts so that verifying a database's state can never
 * pull in anything that could change it. This module contains SELECTs and pure functions
 * ONLY: no RESET_SQL, no psql, no DDL, no DML, no subprocess. `tools/db/fingerprint-test.ts`
 * (npm run db:test:fingerprint) and the rollback-only reset proof both use it, so the
 * digest a verification prints is the same digest the proof compares.
 *
 * Every query is search_path independent. Catalog identifiers are assembled from
 * pg_namespace.nspname and the object's own name, or from raw OIDs. Nothing uses
 * ::regclass, ::regtype, ::regprocedure, format_type() or pg_get_constraintdef(), because
 * those render schema-qualified or bare depending on search_path — which would make two
 * fingerprints of the same database incomparable for no gain.
 */

import { createHash } from 'node:crypto';

export type Row = Record<string, unknown>;
export type Query = (sql: string) => Promise<Row[]>;

/** PostgreSQL booleans reach us as `true`; tolerate the text forms rather than trust them. */
export function isTrue(value: unknown): boolean {
  return value === true || value === 't' || value === 'true' || value === 1 || value === '1';
}

const USER_SCHEMA = `n.nspname NOT IN ('pg_catalog', 'information_schema')
                     AND n.nspname !~ '^pg_'`;

export const MIGRATION_TABLE_SQL = `
SELECT (to_regclass('afldb_meta.schema_migrations') IS NOT NULL) AS present`;

/** Only ever run when MIGRATION_TABLE_SQL has already said the table exists. */
export const MIGRATION_STATE_SQL = `
SELECT format('%s|%s', count(*), coalesce(max(name), '-')) AS k
FROM afldb_meta.schema_migrations`;

export const HEALTH_SQL = `
SELECT current_database() AS database,
       (SELECT count(*)::int FROM pg_class)     AS relations,
       (SELECT count(*)::int FROM pg_extension) AS extensions`;

/**
 * Each section is an ordered list of one-line object identities. What must be provable is
 * that the SCHEMA is intact — every relation, column, index, constraint, routine, type,
 * sequence definition, extension, extension membership, ACL and owner.
 *
 * Deliberately absent: table contents (a rolled-back DROP restores the heap untouched, and
 * RESET_SQL performs no DML at all, so a content hash would cost minutes and prove less)
 * and sequence last_value (nextval is non-transactional in general; nothing here calls it,
 * and the sequence definition is fingerprinted instead).
 */
export const FINGERPRINT_SECTIONS: { id: string; sql: string }[] = [
  {
    id: 'schemas',
    sql: `SELECT format('%s|%s|%s', n.nspname, pg_get_userbyid(n.nspowner),
                        coalesce(n.nspacl::text, '')) AS k
          FROM pg_namespace n WHERE ${USER_SCHEMA} ORDER BY 1`,
  },
  {
    id: 'relations',
    sql: `SELECT format('%s.%s|%s|%s|%s|%s', n.nspname, c.relname, c.relkind,
                        c.relpersistence, pg_get_userbyid(c.relowner),
                        coalesce(c.relacl::text, '')) AS k
          FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
          WHERE ${USER_SCHEMA} AND c.relkind IN ('r', 'p', 'v', 'm', 'S', 'f')
          ORDER BY 1`,
  },
  {
    id: 'columns',
    sql: `SELECT format('%s.%s|%s|%s|%s|%s|%s|%s|%s|%s', n.nspname, c.relname, a.attnum,
                        a.attname, a.atttypid, a.atttypmod, a.attnotnull, a.atthasdef,
                        a.attidentity, a.attgenerated) AS k
          FROM pg_attribute a
          JOIN pg_class c ON c.oid = a.attrelid
          JOIN pg_namespace n ON n.oid = c.relnamespace
          WHERE ${USER_SCHEMA} AND a.attnum > 0 AND NOT a.attisdropped
            AND c.relkind IN ('r', 'p', 'v', 'm', 'f')
          ORDER BY 1`,
  },
  {
    id: 'indexes',
    sql: `SELECT format('%s.%s|%s|%s|%s|%s', n.nspname, t.relname, i.relname,
                        x.indisunique, x.indisprimary, x.indkey::text) AS k
          FROM pg_index x
          JOIN pg_class i ON i.oid = x.indexrelid
          JOIN pg_class t ON t.oid = x.indrelid
          JOIN pg_namespace n ON n.oid = t.relnamespace
          WHERE ${USER_SCHEMA} ORDER BY 1`,
  },
  {
    id: 'constraints',
    sql: `SELECT format('%s|%s|%s|%s|%s', n.nspname, co.conname, co.contype,
                        coalesce(cl.relname, '-'), coalesce(co.conkey::text, '-')) AS k
          FROM pg_constraint co
          JOIN pg_namespace n ON n.oid = co.connamespace
          LEFT JOIN pg_class cl ON cl.oid = co.conrelid
          WHERE ${USER_SCHEMA} ORDER BY 1`,
  },
  {
    id: 'routines',
    sql: `SELECT format('%s.%s|%s|%s|%s|%s', n.nspname, p.proname, p.proargtypes::text,
                        p.prokind, pg_get_userbyid(p.proowner),
                        coalesce(p.proacl::text, '')) AS k
          FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
          WHERE ${USER_SCHEMA} ORDER BY 1`,
  },
  {
    id: 'types',
    sql: `SELECT format('%s.%s|%s|%s', n.nspname, t.typname, t.typtype,
                        pg_get_userbyid(t.typowner)) AS k
          FROM pg_type t JOIN pg_namespace n ON n.oid = t.typnamespace
          WHERE ${USER_SCHEMA} ORDER BY 1`,
  },
  {
    id: 'enum_values',
    sql: `SELECT format('%s.%s|%s|%s', n.nspname, t.typname, e.enumsortorder, e.enumlabel)
                 AS k
          FROM pg_enum e
          JOIN pg_type t ON t.oid = e.enumtypid
          JOIN pg_namespace n ON n.oid = t.typnamespace
          WHERE ${USER_SCHEMA} ORDER BY 1`,
  },
  {
    id: 'sequences',
    sql: `SELECT format('%s.%s|%s|%s|%s|%s', n.nspname, c.relname, s.seqstart,
                        s.seqincrement, s.seqmin, s.seqmax) AS k
          FROM pg_sequence s
          JOIN pg_class c ON c.oid = s.seqrelid
          JOIN pg_namespace n ON n.oid = c.relnamespace
          WHERE ${USER_SCHEMA} ORDER BY 1`,
  },
  {
    id: 'extensions',
    sql: `SELECT format('%s|%s|%s|%s', e.extname, e.extversion, n.nspname,
                        pg_get_userbyid(e.extowner)) AS k
          FROM pg_extension e JOIN pg_namespace n ON n.oid = e.extnamespace ORDER BY 1`,
  },
  {
    id: 'extension_members',
    sql: `SELECT format('%s:%s:%s:%s', d.classid, d.objid, d.objsubid, d.refobjid) AS k
          FROM pg_depend d WHERE d.deptype = 'e' ORDER BY 1`,
  },
  {
    id: 'default_acls',
    sql: `SELECT format('%s|%s|%s|%s', pg_get_userbyid(d.defaclrole),
                        coalesce(n.nspname, '-'), d.defaclobjtype, d.defaclacl::text) AS k
          FROM pg_default_acl d LEFT JOIN pg_namespace n ON n.oid = d.defaclnamespace
          ORDER BY 1`,
  },
];

export type Sections = Record<string, string[]>;
export type Fingerprint = { overall: string; sections: Record<string, string> };

function sha256(text: string): string {
  return createHash('sha256').update(text, 'utf8').digest('hex');
}

/**
 * A digest per section plus one over the lot, so a mismatch names the object class that
 * moved without printing a single row of data.
 */
export function fingerprintOf(sections: Sections): Fingerprint {
  const perSection: Record<string, string> = {};
  for (const id of Object.keys(sections).sort()) {
    perSection[id] = sha256(`${id}\n${sections[id].join('\n')}`);
  }
  const overall = sha256(
    Object.keys(perSection).sort().map((id) => `${id} ${perSection[id]}`).join('\n'));
  return { overall, sections: perSection };
}

export function describeFingerprintDrift(before: Fingerprint, after: Fingerprint): string[] {
  const ids = [...new Set([...Object.keys(before.sections), ...Object.keys(after.sections)])];
  return ids.filter((id) => before.sections[id] !== after.sections[id]).sort();
}

/** Read every section, in order. The injected `q` must be a read-only query runner. */
export async function collectSections(q: Query): Promise<Sections> {
  const sections: Sections = {};
  for (const section of FINGERPRINT_SECTIONS) {
    const rows = await q(section.sql);
    sections[section.id] = rows.map((r) => String(r.k));
  }
  // Migration bookkeeping is probed in two steps: a single statement referencing
  // afldb_meta.schema_migrations fails at PARSE time when the table is absent, so a CASE
  // guard inside one query would not survive.
  const present = isTrue((await q(MIGRATION_TABLE_SQL))[0]?.present);
  sections.migrations = present
    ? [`present|${String((await q(MIGRATION_STATE_SQL))[0]?.k ?? '?')}`]
    : ['absent'];
  return sections;
}

export default { FINGERPRINT_SECTIONS, collectSections, fingerprintOf };
