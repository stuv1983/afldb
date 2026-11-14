// scope: admin-rem-20261114 (ISSUE-353/354 worker). Disposable *_test copy ONLY: removes the snapshot's one
// player_match_stats authority row so the pre-existing replay suites (which require none) can run.
import postgres from 'postgres';
const url = process.env.AFLDB_TEST_DATABASE_URL ?? '';
if (!/_test(\?|$)/.test(url.split('/').pop() ?? '')) throw new Error('refusing: not a *_test database');
const sql = postgres(url, { max: 1, onnotice: () => {} });
const del = await sql`DELETE FROM data_overrides WHERE entity_type = 'player_match_stats' RETURNING 1`;
console.log(JSON.stringify({ deleted_player_match_stats_overrides: del.length }));
await sql.end({ timeout: 2 });
