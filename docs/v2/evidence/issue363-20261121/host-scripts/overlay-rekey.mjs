// ISSUE-363 G-1 PROTOTYPE ONLY (2026-11-21), evidence tooling, not part of any rebuild, runbook or test contract.
// Rekeys the tracked GAP-029 evidence file (production match ids) to the ids of the database named by AFLDB_TEST_DATABASE_URL,
// matching each entry by its natural key: season, date, round, home club, away club, home score, away score. An entry is kept
// only when exactly ONE match carries that key; anything else is reported and dropped (never guessed). The applier then runs
// unchanged on the rekeyed file and re-validates every entry before its first write.
// Run only via: node --import tsx tools/v2/isolated-pg.ts run <db> -- node overlay-rekey.mjs <evidence.json> <out.json>
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';

if (process.env.AFLDB_V2_ISOLATED_PG !== '1') throw new Error('Isolated launcher required');
const url = new URL(process.env.AFLDB_TEST_DATABASE_URL);
if (!/^afldb_v2_.+_test$/.test(decodeURIComponent(url.pathname.slice(1))) || url.hostname !== '127.0.0.1') throw new Error('isolated target required');
const require = createRequire('/mnt/ssd/afldb-i363-20261121/cand/package.json');
const postgres = require('postgres');
const [src, out] = process.argv.slice(2);
const raw = readFileSync(src);
const ev = JSON.parse(raw.toString('utf8'));
const sql = postgres(process.env.AFLDB_TEST_DATABASE_URL, { max: 1, onnotice: () => {} });
try {
  const kept = []; const dropped = []; let moved = 0;
  for (const e of ev.entries) {
    const x = e.expect;
    const rows = await sql`
      SELECT m.id FROM matches m JOIN clubs hc ON hc.id = m.home_club_id JOIN clubs ac ON ac.id = m.away_club_id
       WHERE m.season = ${x.season} AND m.match_date = ${x.matchDate}::date AND m.round_code = ${x.roundCode}
         AND hc.name = ${x.homeClub} AND ac.name = ${x.awayClub} AND m.home_score = ${x.homeScore} AND m.away_score = ${x.awayScore}`;
    if (rows.length !== 1) { dropped.push({ year: e.year, family: e.family, candidates: rows.length }); continue; }
    if (rows[0].id !== e.matchId) moved++;
    kept.push({ ...e, matchId: rows[0].id, sourceMatchId: e.matchId });
  }
  const counts = {};
  for (const e of kept) counts[e.label] = (counts[e.label] ?? 0) + 1;
  writeFileSync(out, JSON.stringify({
    ...ev, entries: kept, counts,
    rekeyed: { prototype: 'ISSUE-363 G-1 tier-P prototype; NOT an accepted evidence revision', from: src,
      fromSha256: createHash('sha256').update(raw).digest('hex'), key: 'season,date,round,homeClub,awayClub,homeScore,awayScore',
      kept: kept.length, idChanged: moved, dropped },
  }, null, 1) + '\n', { flag: 'wx' });
  console.log(`rekey: source entries=${ev.entries.length} kept=${kept.length} id_changed=${moved} dropped=${dropped.length} ${JSON.stringify(dropped)}`);
} finally { await sql.end(); }
