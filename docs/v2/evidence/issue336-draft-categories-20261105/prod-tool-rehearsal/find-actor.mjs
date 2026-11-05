// Isolated clone only: which auth_users ids pass assert_viable_super_admin_actor. Rolled back; prints ids only.
import postgres from 'postgres';
const dsn = process.env.AFLDB_TEST_DATABASE_URL ?? '';
if (process.env.AFLDB_V2_ISOLATED_PG !== '1' || !/\/afldb_v2_[a-z0-9_]+_test$/.test(new URL(dsn).pathname)) throw new Error('isolated _test only');
const sql = postgres(dsn, { max: 1, onnotice: () => {} });
const ok = [];
try {
  await sql.begin(async (tx) => {
    for (const { id } of await tx`SELECT id::int AS id FROM auth_users ORDER BY id`) {
      try { await tx.savepoint((sp) => sp`SELECT public.assert_viable_super_admin_actor(${id}::int)`); ok.push(id); } catch { /* not viable */ }
    }
    throw new Error('rollback');
  }).catch((e) => { if (e.message !== 'rollback') throw e; });
} finally { await sql.end(); }
console.log(JSON.stringify({ viable: ok }));
