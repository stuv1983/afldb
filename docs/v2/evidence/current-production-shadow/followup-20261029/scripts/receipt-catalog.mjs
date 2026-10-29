// D-V2-CURRENT-SHADOW-FOLLOWUP-1 item 4a: READ-ONLY catalogue probe of the 116 receipt objects and the 117 column,
// for a retained evidence database. One REPEATABLE READ READ ONLY transaction on a default_transaction_read_only
// connection; the state is read back; always rolled back. Expectations are derived from the pinned migration text.
// Run from the source root (so `postgres` resolves) under `isolated-pg run <db>`:
//   node --input-type=module - <expectedDb> <migrationsDir> <out> < receipt-catalog.mjs
import postgres from 'postgres';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const [expectedDb, migDir, out] = process.argv.slice(2);
if (!out) throw new Error('usage: <expectedDb> <migrationsDir> <out>');
const m116 = readFileSync(join(migDir, '116_brownlow_correction_receipts.sql'), 'utf8');
const m117 = readFileSync(join(migDir, '117_brownlow_provider_eligibility_unknown.sql'), 'utf8');
const quoted = (text, re) => { const m = re.exec(text); if (!m) throw new Error(`pattern not in migration: ${re}`); return m[1].replace(/''/g, "'"); };
const EXPECT = {
  tableComment: quoted(m116, /COMMENT ON TABLE brownlow_correction_receipts IS\s*'((?:[^']|'')*)'/),
  eligibleComment: quoted(m117, /COMMENT ON COLUMN staging\.afl_api_brownlow_vote\.eligible IS\s*'((?:[^']|'')*)'/),
  columns: [['plan_digest', 'text'], ['operation', 'text'], ['code_revision', 'text'], ['approval_reference', 'text'],
    ['before_digest', 'text'], ['after_digest', 'text'], ['result', 'jsonb'], ['applied_at', 'timestamp with time zone']],
  revokedRoles: ['afldb_app', 'afldb_import', 'afldb_auth'],
  // BEFORE (2) | DELETE (8) | UPDATE (16) | TRUNCATE (32), FOR EACH STATEMENT (row bit 1 clear)
  triggerType: 2 + 8 + 16 + 32,
};
// The expected column list is checked against the CREATE TABLE text too, so it cannot drift from the pin.
for (const [name] of EXPECT.columns) if (!new RegExp(`\\n\\s+${name} `).test(m116)) throw new Error(`column ${name} not in 116`);

const ROLES = ['afldb_owner', 'afldb_app', 'afldb_import', 'afldb_auth', 'afldb_backup'];
const PRIVS = ['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER'];
const sql = postgres(process.env.AFLDB_OWNER_DATABASE_URL, { max: 1, onnotice: () => {}, prepare: false,
  connection: { application_name: 'afldb-v2-followup-receipt-catalog', default_transaction_read_only: true } });
let result;
try {
  await sql.begin('isolation level repeatable read read only', async (tx) => {
    const [state] = await tx`SELECT current_database() AS db, current_user AS usr, current_setting('transaction_read_only') AS ro,
      current_setting('transaction_isolation') AS iso, (SELECT count(*)::int FROM afldb_meta.schema_migrations) AS ledger`;
    if (state.db !== expectedDb || state.ro !== 'on' || state.iso !== 'repeatable read') throw new Error(`state refused: ${JSON.stringify(state)}`);
    const [t] = await tx`SELECT to_regclass('public.brownlow_correction_receipts')::oid AS oid`;
    const r = { state, receiptTable: null, eligibleColumn: null, roles: null };
    r.roles = await tx`SELECT r.rolname, r.rolsuper, r.rolinherit, r.rolbypassrls,
        coalesce((SELECT array_agg(g.rolname ORDER BY g.rolname) FROM pg_auth_members m JOIN pg_roles g ON g.oid = m.roleid WHERE m.member = r.oid), '{}') AS member_of
      FROM pg_roles r WHERE r.rolname = ANY(${ROLES}::name[]) ORDER BY r.rolname`;
    if (t.oid !== null) {
      const oid = t.oid;
      const [tab] = await tx`SELECT pg_get_userbyid(c.relowner) AS owner, c.relkind, c.relacl::text AS relacl,
          obj_description(c.oid, 'pg_class') AS comment, c.relrowsecurity, (SELECT count(*)::int FROM public.brownlow_correction_receipts) AS rows
        FROM pg_class c WHERE c.oid = ${oid}::oid`;
      const columns = await tx`SELECT a.attname, format_type(a.atttypid, a.atttypmod) AS type, a.attnotnull,
          pg_get_expr(d.adbin, d.adrelid) AS default FROM pg_attribute a LEFT JOIN pg_attrdef d ON d.adrelid = a.attrelid AND d.adnum = a.attnum
        WHERE a.attrelid = ${oid}::oid AND a.attnum > 0 AND NOT a.attisdropped ORDER BY a.attnum`;
      const constraints = await tx`SELECT conname, contype, pg_get_constraintdef(oid) AS def FROM pg_constraint WHERE conrelid = ${oid}::oid ORDER BY conname`;
      const acl = await tx`SELECT CASE WHEN e.grantee = 0 THEN 'PUBLIC' ELSE pg_get_userbyid(e.grantee) END AS grantee,
          pg_get_userbyid(e.grantor) AS grantor, e.privilege_type, e.is_grantable
        FROM pg_class c, aclexplode(c.relacl) e WHERE c.oid = ${oid}::oid ORDER BY 1, 3`;
      const matrix = {};
      for (const role of ROLES) {
        matrix[role] = {};
        for (const p of PRIVS) matrix[role][p] = (await tx`SELECT has_table_privilege(${role}, ${oid}::oid, ${p}) AS ok`)[0].ok;
      }
      const functions = await tx`SELECT p.oid::regprocedure::text AS signature, pg_get_userbyid(p.proowner) AS owner, p.prosecdef,
          p.proacl::text AS proacl, l.lanname, p.prorettype::regtype::text AS returns, p.provolatile, md5(pg_get_functiondef(p.oid)) AS def_md5,
          (SELECT jsonb_object_agg(x, has_function_privilege(x, p.oid, 'EXECUTE')) FROM unnest(${ROLES}::text[]) x) AS execute
        FROM pg_proc p JOIN pg_language l ON l.oid = p.prolang WHERE p.proname = 'refuse_brownlow_receipt_mutation'`;
      const triggers = await tx`SELECT tgname, tgenabled, tgtype, tgfoid::regproc::text AS func, tgisinternal, pg_get_triggerdef(oid) AS def
        FROM pg_trigger WHERE tgrelid = ${oid}::oid ORDER BY tgname`;
      r.receiptTable = { ...tab, columns, constraints, acl, privilegeMatrix: matrix, functions, triggers };
    }
    const [ec] = await tx`SELECT format_type(a.atttypid, a.atttypmod) AS type, a.attnotnull, pg_get_expr(d.adbin, d.adrelid) AS default,
        col_description(a.attrelid, a.attnum) AS comment,
        (SELECT count(*)::int FROM staging.afl_api_brownlow_vote) AS rows,
        (SELECT count(*)::int FROM staging.afl_api_brownlow_vote WHERE eligible IS NULL) AS null_rows
      FROM pg_attribute a LEFT JOIN pg_attrdef d ON d.adrelid = a.attrelid AND d.adnum = a.attnum
      WHERE a.attrelid = 'staging.afl_api_brownlow_vote'::regclass AND a.attname = 'eligible'`;
    r.eligibleColumn = ec;
    result = r;
    throw Object.assign(new Error('rollback'), { rollback: true });
  });
} catch (error) {
  if (!error?.rollback) throw error;
} finally {
  await sql.end({ timeout: 5 });
}

// Checks: each states what the pinned migration text requires. A failure is reported, never normalised.
const checks = [];
const check = (id, ok, detail) => checks.push({ id, ok: !!ok, detail });
const rt = result.receiptTable;
if (rt) {
  check('116.table.owner-is-afldb_owner', rt.owner === 'afldb_owner', rt.owner);
  check('116.table.empty', rt.rows === 0, `${rt.rows} rows`);
  check('116.table.columns-exact', JSON.stringify(rt.columns.map((c) => [c.attname, c.type])) === JSON.stringify(EXPECT.columns),
    rt.columns.map((c) => `${c.attname} ${c.type}${c.attnotnull ? ' NOT NULL' : ''}${c.default ? ` DEFAULT ${c.default}` : ''}`).join('; '));
  check('116.table.not-null-all', rt.columns.every((c) => c.attnotnull), 'every column NOT NULL (PK + explicit NOT NULL)');
  check('116.table.applied_at-default', rt.columns.find((c) => c.attname === 'applied_at')?.default === 'clock_timestamp()', 'applied_at DEFAULT clock_timestamp()');
  check('116.table.pk-plus-four-checks', rt.constraints.filter((c) => c.contype === 'p').length === 1 && rt.constraints.filter((c) => c.contype === 'c').length === 4
    && rt.constraints.length === 5, rt.constraints.map((c) => `${c.contype}:${c.conname}`).join(', '));
  check('116.table.comment-exact', rt.comment === EXPECT.tableComment, rt.comment);
  check('116.acl.no-public-entry', !rt.acl.some((e) => e.grantee === 'PUBLIC'), JSON.stringify(rt.acl));
  for (const role of EXPECT.revokedRoles) {
    check(`116.acl.no-entry-${role}`, !rt.acl.some((e) => e.grantee === role), 'REVOKE ALL in 116');
    check(`116.effective.no-privilege-${role}`, PRIVS.every((p) => rt.privilegeMatrix[role][p] === false), JSON.stringify(rt.privilegeMatrix[role]));
  }
  const fn = rt.functions;
  check('116.function.single', fn.length === 1, fn.map((f) => f.signature).join(', '));
  check('116.function.security-invoker', fn[0]?.prosecdef === false, `prosecdef ${fn[0]?.prosecdef}`);
  check('116.function.default-acl', fn[0]?.proacl === null, `proacl ${fn[0]?.proacl} (NULL = default PUBLIC EXECUTE; 116 grants/revokes nothing on it)`);
  check('116.function.plpgsql-returns-trigger', fn[0]?.lanname === 'plpgsql' && fn[0]?.returns === 'trigger', `${fn[0]?.lanname} ${fn[0]?.returns}`);
  const tg = rt.triggers.filter((x) => !x.tgisinternal);
  check('116.trigger.single-enabled', tg.length === 1 && tg[0].tgname === 'brownlow_receipt_immutable' && tg[0].tgenabled === 'O', JSON.stringify(tg.map((x) => [x.tgname, x.tgenabled])));
  check('116.trigger.before-statement-update-delete-truncate', tg[0]?.tgtype === EXPECT.triggerType && tg[0]?.func === 'refuse_brownlow_receipt_mutation', `tgtype ${tg[0]?.tgtype} -> ${tg[0]?.func}`);
}
const ec = result.eligibleColumn;
check('117.eligible.type-boolean', ec.type === 'boolean', ec.type);
check('117.eligible.default-none', ec.default === null, String(ec.default));
const migrated = rt !== null;
check(migrated ? '117.eligible.nullable' : '110.eligible.not-null', migrated ? ec.attnotnull === false : ec.attnotnull === true, `attnotnull ${ec.attnotnull}`);
check(migrated ? '117.eligible.comment-exact' : '110.eligible.no-117-comment', migrated ? ec.comment === EXPECT.eligibleComment : ec.comment !== EXPECT.eligibleComment, ec.comment);
check('117.eligible.no-null-rows', ec.null_rows === 0, `${ec.null_rows} of ${ec.rows} rows NULL`);

const record = { decision: 'D-V2-CURRENT-SHADOW-FOLLOWUP-1', item: '4a receipt catalogue probe (read-only)', expectedDatabase: expectedDb,
  expectationsFrom: ['116_brownlow_correction_receipts.sql', '117_brownlow_provider_eligibility_unknown.sql'], result, checks,
  allChecksOk: checks.every((c) => c.ok), failed: checks.filter((c) => !c.ok) };
writeFileSync(out, `${JSON.stringify(record, null, 2)}\n`, { flag: 'wx', mode: 0o600 });
console.log(JSON.stringify({ database: result.state.db, ledger: result.state.ledger, checks: checks.length, failed: record.failed }));
process.exitCode = record.allChecksOk ? 0 : 1;
