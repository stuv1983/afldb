// D-V2-CURRENT-SHADOW-FOLLOWUP-1 item 4b: actual-role mutation probe of the 116 receipt table. Runs ONLY on a NEW
// disposable clone (name must end `_fuprobe_test`), never on a retained evidence database. Every attempt runs in
// its own transaction that is always rolled back; the owner's synthetic insert is rolled back and the count re-read.
// Run from the source root under `isolated-pg run <clone>`:
//   node --input-type=module - <expectedDb> <out> < receipt-mutation.mjs
import postgres from 'postgres';
import { writeFileSync } from 'node:fs';

const [expectedDb, out] = process.argv.slice(2);
if (!/^afldb_v2_[a-z0-9_]*_fuprobe_test$/.test(expectedDb ?? '') || !out) throw new Error('usage: <afldb_v2_*_fuprobe_test> <out>');
const T = 'public.brownlow_correction_receipts';
const SYNTHETIC = `INSERT INTO ${T} (plan_digest, operation, code_revision, approval_reference, before_digest, after_digest, result)
  VALUES (repeat('a', 64), 'observe', 'c478c31b2ad84719907e0372d1b94230d3a4c508',
          'SYNTHETIC D-V2-CURRENT-SHADOW-FOLLOWUP-1 probe; always rolled back', 'synthetic', 'synthetic', '{"synthetic": true}'::jsonb)`;
const OPS = { INSERT: SYNTHETIC, UPDATE: `UPDATE ${T} SET result = result`, DELETE: `DELETE FROM ${T}`, TRUNCATE: `TRUNCATE ${T}` };
const CONN = { afldb_app: 'DATABASE_URL', afldb_import: 'AFLDB_IMPORT_DATABASE_URL', afldb_auth: 'AFLDB_AUTH_DATABASE_URL', afldb_owner: 'AFLDB_OWNER_DATABASE_URL' };
const ROLLBACK = new Error('rollback (sentinel)');
const connect = (role) => postgres(process.env[CONN[role]], { max: 1, onnotice: () => {}, prepare: false,
  connection: { application_name: 'afldb-v2-followup-receipt-mutation' } });

const attempts = [];
let ownerSynthetic = null;
const counts = {};
for (const role of Object.keys(CONN)) {
  const sql = connect(role);
  try {
    const [who] = await sql`SELECT current_database() AS db, current_user AS usr, (SELECT rolsuper FROM pg_roles WHERE rolname = current_user) AS su`;
    if (who.db !== expectedDb || who.usr !== role || who.su !== false) throw new Error(`identity refused: ${JSON.stringify(who)}`);
    for (const [op, stmt] of Object.entries(OPS)) {
      if (role === 'afldb_owner' && op === 'INSERT') continue; // the owner's insert is the synthetic round trip below
      let code = null, message = null, rowCount = null;
      try {
        await sql.begin(async (tx) => { const r = await tx.unsafe(stmt); rowCount = r.count ?? null; throw ROLLBACK; });
      } catch (error) {
        if (error !== ROLLBACK) { code = error.code ?? null; message = String(error.message).split('\n')[0]; }
      }
      attempts.push({ role, op, refused: code !== null, sqlstate: code, message, rowCountIfAllowed: code === null ? rowCount : null });
    }
    if (role === 'afldb_owner') {
      counts.before = (await sql`SELECT count(*)::int AS n FROM public.brownlow_correction_receipts`)[0].n;
      try {
        await sql.begin(async (tx) => {
          await tx.unsafe(SYNTHETIC);
          const inside = (await tx`SELECT count(*)::int AS n FROM public.brownlow_correction_receipts`)[0].n;
          let refusalWithRow = null;
          try { await tx.savepoint(async (sp) => { await sp.unsafe(OPS.UPDATE); }); } catch (e) { refusalWithRow = { sqlstate: e.code, message: String(e.message).split('\n')[0] }; }
          ownerSynthetic = { insertedAndVisibleInside: inside, updateWithRowPresent: refusalWithRow };
          throw ROLLBACK;
        });
      } catch (error) { if (error !== ROLLBACK) ownerSynthetic = { error: error.code ?? null, message: String(error.message).split('\n')[0] }; }
      counts.after = (await sql`SELECT count(*)::int AS n FROM public.brownlow_correction_receipts`)[0].n;
    }
  } finally {
    await sql.end({ timeout: 5 });
  }
}

const checks = [];
const check = (id, ok, detail) => checks.push({ id, ok: !!ok, detail });
for (const a of attempts.filter((x) => x.role !== 'afldb_owner')) check(`deny.${a.role}.${a.op}`, a.sqlstate === '42501', `${a.sqlstate} ${a.message}`);
for (const a of attempts.filter((x) => x.role === 'afldb_owner')) {
  check(`owner-refused.${a.op}`, a.sqlstate === 'P0001' && a.message === 'Brownlow correction receipts are append-only', `${a.sqlstate} ${a.message}`);
}
check('owner.synthetic-insert-visible-inside', ownerSynthetic?.insertedAndVisibleInside === counts.before + 1, JSON.stringify(ownerSynthetic));
check('owner.update-refused-with-row-present', ownerSynthetic?.updateWithRowPresent?.sqlstate === 'P0001', JSON.stringify(ownerSynthetic?.updateWithRowPresent));
check('owner.rolled-back-count-unchanged', counts.before === 0 && counts.after === 0, JSON.stringify(counts));
const record = { decision: 'D-V2-CURRENT-SHADOW-FOLLOWUP-1', item: '4b receipt actual-role mutation probe (disposable clone)',
  database: expectedDb, attempts, ownerSynthetic, counts, checks, denials: checks.filter((c) => c.id.startsWith('deny.') && c.ok).length,
  ownerRefusals: checks.filter((c) => c.id.startsWith('owner-refused.') && c.ok).length,
  allChecksOk: checks.every((c) => c.ok), failed: checks.filter((c) => !c.ok) };
writeFileSync(out, `${JSON.stringify(record, null, 2)}\n`, { flag: 'wx', mode: 0o600 });
console.log(JSON.stringify({ denials: record.denials, ownerRefusals: record.ownerRefusals, counts, failed: record.failed }));
process.exitCode = record.allChecksOk ? 0 : 1;
