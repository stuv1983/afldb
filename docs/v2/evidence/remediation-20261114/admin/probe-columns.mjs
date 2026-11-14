// Read-only: list required (NOT NULL, no default, not identity) columns and triggers of tables named on argv.
import postgres from 'postgres';
const sql = postgres(process.env.AFLDB_TEST_DATABASE_URL, { max: 1, onnotice: () => {} });
for (const t of process.argv.slice(2)) {
  const cols = await sql`
    SELECT column_name, data_type, is_nullable, column_default, is_identity
      FROM information_schema.columns WHERE table_schema = 'public' AND table_name = ${t}
       AND is_nullable = 'NO' AND column_default IS NULL AND is_identity = 'NO' ORDER BY ordinal_position`;
  console.log(t, 'required:', cols.map((c) => `${c.column_name}:${c.data_type}`).join(', '));
  const trg = await sql`SELECT tgname FROM pg_trigger WHERE tgrelid = ${'public.' + t}::regclass AND NOT tgisinternal`;
  console.log(t, 'triggers:', trg.map((r) => r.tgname).join(', ') || '(none)');
  const ck = await sql`SELECT conname, pg_get_constraintdef(oid) AS def FROM pg_constraint WHERE conrelid = ${'public.' + t}::regclass AND contype IN ('c')`;
  for (const c of ck) console.log(t, 'check', c.conname, c.def.slice(0, 240));
}
await sql.end({ timeout: 2 });
