// Deliberately leave the SUITE'S OWN fixture rows (its synthetic player + its own afl_api identity row), exactly the
// statements settle-afl-api-state-b.test.ts beforeAll issues. Aggregates printed only.
import { createRequire } from 'node:module';
const require = createRequire('/mnt/ssd/afldb-rem3-stateb-20261114/cand/package.json');
const postgres = require('postgres');
const sql = postgres(new URL(process.env.AFLDB_TEST_DATABASE_URL).toString(), { max: 1, onnotice: () => {}, connect_timeout: 10 });
try {
  const [afl] = await sql`SELECT id FROM sources WHERE key = 'afl_api'`;
  const [p] = await sql`
    INSERT INTO players (legacy_player_id, display_name, sort_name, search_name, slug, given_name, surname)
    VALUES (-275000001, 'Karl Amon (ISSUE-275 state-b fixture)', 'Amon (ISSUE-275 state-b fixture), Karl',
            'karl amon issue275 state b fixture', 'karl-amon-issue275-state-b-fixture', 'Karl', 'Amon-Issue275StateB')
    RETURNING id::int AS id`;
  await sql`INSERT INTO external_identities (source_id, external_id, status, candidate_count, match_method, player_id)
            VALUES (${afl.id}, 'CD_I2071275001', 'unique', 1, 'afl_api_stat_vector_bootstrap', ${p.id})`;
  const [c] = await sql`SELECT (SELECT count(*) FROM players WHERE legacy_player_id = -275000001)::int AS players,
    (SELECT count(*) FROM external_identities WHERE external_id = 'CD_I2071275001')::int AS ownIdRows`;
  console.log('LEFTOVER-SEEDED', JSON.stringify(c));
} finally { await sql.end({ timeout: 2 }); }
