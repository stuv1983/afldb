/** Full-row preservation capture on one read-only repeatable-read transaction. No row values retained. */
import { readFileSync } from 'node:fs';

import { DEFAULT_ROW_COUNT_SCHEMAS, ROW_COUNTS_LOCAL_SETTINGS, ROW_COUNTS_STATE_SQL,
  rowCountCatalogSql, schemaExistsSql, type RowCountsQuery } from '@afldb/db';

import { digest, REQUIRED_PUBLIC_QUERIES, REQUIRED_PRESERVED_TABLES, validSnapshot, type PreservationSnapshot } from './migration-preservation';

const ident = (s: string): string => {
  if (!/^[a-z_][a-z0-9_]*$/.test(s)) throw new Error('Unsafe catalog identifier');
  return `"${s}"`;
};

export async function capturePreservation(query: RowCountsQuery, database: string,
  contractPath: string, backupSha256: string, seal: number): Promise<PreservationSnapshot> {
  const text = readFileSync(contractPath, 'utf8');
  const contract = JSON.parse(text) as Record<string, string>;
  if (!/^[a-f0-9]{64}$/.test(backupSha256) || !Number.isInteger(seal)
    || !REQUIRED_PUBLIC_QUERIES.every(q => typeof contract[q] === 'string' && /^SELECT\s/i.test(contract[q])
      && !/[;]|--|\/\*/.test(contract[q]))) throw new Error('Invalid archive hash, seal or public query contract');
  await query('SET default_transaction_read_only = on');
  await query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
  try {
    for (const setting of ROW_COUNTS_LOCAL_SETTINGS) await query(setting);
    await query("SET LOCAL timezone = 'UTC'");
    await query("SET LOCAL datestyle = 'ISO, YMD'");
    const [state] = await query(ROW_COUNTS_STATE_SQL);
    if (state?.database_name !== database || state?.transaction_read_only !== 'on'
      || state?.transaction_isolation !== 'repeatable read') throw new Error('Snapshot target or isolation refused');
    const schemas = DEFAULT_ROW_COUNT_SCHEMAS;
    const present = await query(schemaExistsSql(schemas));
    if (!schemas.every(s => present.some(r => r.schema_name === s))) throw new Error('Incomplete schema visibility');
    const tables: PreservationSnapshot['tables'] = {};
    const catalog = await query(rowCountCatalogSql(schemas));
    for (const table of catalog) {
      if (table.row_security !== false || !['r', 'p'].includes(String(table.kind))) throw new Error('RLS or unknown table kind refused');
      const schema = String(table.schema_name), name = String(table.table_name);
      if (!schemas.includes(schema)) throw new Error('Unexpected schema');
      const qualified = `${ident(schema)}.${ident(name)}`;
      // Catalog identifiers validated before interpolation; include validation state and every FK.
      const columns = await query(`SELECT a.attname, format_type(a.atttypid,a.atttypmod) AS type, a.attnotnull,
        pg_get_expr(d.adbin,d.adrelid) AS default_value FROM pg_catalog.pg_attribute a
        LEFT JOIN pg_catalog.pg_attrdef d ON d.adrelid=a.attrelid AND d.adnum=a.attnum
        WHERE a.attrelid='${qualified}'::regclass AND a.attnum>0 AND NOT a.attisdropped ORDER BY a.attnum`);
      const constraints = await query(`SELECT conname, contype, convalidated, pg_get_constraintdef(oid) AS definition
        FROM pg_catalog.pg_constraint WHERE conrelid='${qualified}'::regclass ORDER BY conname`);
      const rows = await query(`SELECT to_jsonb(t)::text AS content FROM ${table.kind === 'p' ? '' : 'ONLY '}${qualified} t`);
      tables[`${schema}.${name}`] = { definition: digest(JSON.stringify({ columns, constraints })),
        rows: rows.map(r => {
          if (typeof r.content !== 'string') throw new Error('Invalid row content');
          return digest(r.content);
        }).sort() };
    }
    const queries: Record<string, string> = {};
    for (const name of REQUIRED_PUBLIC_QUERIES) {
      const rows = await query(`SELECT to_jsonb(q)::text AS content FROM (${contract[name]}) q`);
      queries[name] = digest(JSON.stringify(rows.map(r => {
        if (typeof r.content !== 'string') throw new Error('Invalid query output');
        return digest(r.content);
      }).sort()));
    }
    const snapshot: PreservationSnapshot = { format: 'afldb.v2.preservation.1',
      scope: { backupSha256, queryContractSha256: digest(text), seal, phase: 'migration' }, tables, queries };
    if (!validSnapshot(snapshot) || !REQUIRED_PRESERVED_TABLES.every(t => Object.hasOwn(tables, t))) throw new Error('Incomplete preservation snapshot');
    return snapshot;
  } finally { await query('ROLLBACK'); }
}
