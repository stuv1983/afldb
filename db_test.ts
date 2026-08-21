import postgres from 'postgres';

async function testConnection(url: string) {
  try {
    const sql = postgres(url, { max: 1, idle_timeout: 1 });
    const [{ current_user }] = await sql`SELECT current_user`;
    console.log(`✅ Success with ${url} (Connected as: ${current_user})`);
    await sql.end();
  } catch (err: any) {
    console.log(`❌ Failed with ${url}: ${err.message}`);
  }
}

async function run() {
  await testConnection('postgresql://postgres@127.0.0.1:5432/postgres');
  await testConnection('postgresql://postgres:postgres@127.0.0.1:5432/postgres');
  await testConnection('postgresql://stuar@127.0.0.1:5432/postgres');
  await testConnection('postgresql://afldb_owner:CHANGE_ME@127.0.0.1:5432/afldb_test');
  await testConnection('postgresql://afldb_app:CHANGE_ME@127.0.0.1:5432/afldb_test');
  await testConnection('postgresql://127.0.0.1:5432/postgres');
}

run();
