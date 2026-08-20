import fs from 'node:fs';
import postgres from 'postgres';

// Read .env manually
const envFile = fs.readFileSync('.env', 'utf-8');
const env = {};
for (const line of envFile.split('\n')) {
  const match = line.match(/^([^#=]+)=(.*)$/);
  if (match) {
    env[match[1].trim()] = match[2].trim().replace(/^["']|["']$/g, '');
  }
}

const url = env.AFLDB_IMPORT_DATABASE_URL || env.DATABASE_URL;
const sql = postgres(url);

async function main() {
  const matches = await sql`
    SELECT id, season, round_code, round_number, round_type, match_date, home_club_id, away_club_id, home_score, away_score
    FROM matches
    ORDER BY id DESC
    LIMIT 10
  `;
  console.log('Recent matches:', matches);

  const r24 = await sql`
    SELECT id, season, round_code, round_number, round_type, match_date, home_club_id, away_club_id, home_score, away_score
    FROM matches
    WHERE round_number = 24 OR round_code = 'R24'
    ORDER BY id DESC
    LIMIT 10
  `;
  console.log('R24 matches:', r24);

  const edits = await sql`
    SELECT * FROM data_edits ORDER BY id DESC LIMIT 5
  `;
  console.log('Recent edits:', edits);

  await sql.end();
}

main().catch(console.error);
