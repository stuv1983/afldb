import postgres from 'postgres';

const DATABASE_URL = 'postgresql://postgres:postgres@10.0.40.100:5432/afldb';
const sql = postgres(DATABASE_URL);

async function main() {
  const matches = await sql`
    SELECT id, season, round_code, round_number, round_type, match_date, home_club_id, away_club_id, home_score, away_score
    FROM matches
    ORDER BY id DESC
    LIMIT 10
  `;
  console.log('Recent matches:', matches);

  const edits = await sql`
    SELECT * FROM data_edits ORDER BY id DESC LIMIT 10
  `;
  console.log('Recent edits:', edits);

  await sql.end();
}

main().catch(console.error);
