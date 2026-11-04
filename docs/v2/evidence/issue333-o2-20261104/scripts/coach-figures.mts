// AFLDB-ISSUE-333 rehearsal probe: read the public coaching figures THROUGH THE APPLICATION QUERIES (src/db/queries/coaches.ts), not through
// ad-hoc SQL, so the before/after numbers are what /coaches, /coaches/[slug] and the club pages compute. Read-only (SELECTs only, app role).
// Usage (inside the guarded runner, from the candidate checkout, as .coach-figures.mts):
//   node --import tsx --conditions=react-server .coach-figures.mts <out.json>
import { writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { getCoachCareer, getClubCoachRecords, listCoaches } from '@/db/queries/coaches';
import { sql } from '@/db/client';

const CARR = 243;   // coaches/Josh_Carr.html (production id, measured 2026-11-04)
const FRASER = 293; // coaches/Josh_Fraser.html
const out = process.argv[2];
if (!out) throw new Error('usage: coach-figures.mts <out.json>');

const [ident] = await sql`SELECT current_database() AS db, current_user AS "user", current_setting('transaction_read_only') AS ro`;
const careers: Record<string, unknown> = {};
const clubs = new Set<number>();
for (const id of [CARR, FRASER]) {
  const c = await getCoachCareer(id);
  careers[id] = c ? { totals: c.totals, clubs: c.clubs.map((s) => ({ clubId: s.clubId, clubName: s.clubName, firstSeason: s.firstSeason, lastSeason: s.lastSeason,
    games: s.games, wins: s.wins, draws: s.draws, losses: s.losses, finals: s.finals, grandFinals: s.grandFinals, premierships: s.premierships })) } : null;
  for (const s of c?.clubs ?? []) clubs.add(s.clubId);
}
const clubRecords: Record<string, unknown> = {};
for (const clubId of [...clubs].sort((a, b) => a - b)) {
  const rows = await getClubCoachRecords(clubId);
  clubRecords[clubId] = { coaches: rows.length, rows: rows.filter((r) => r.coachId === CARR || r.coachId === FRASER || r.lastSeason === 2026) };
}
const index = await listCoaches();
const indexDigest = createHash('sha256').update(JSON.stringify(index)).digest('hex');
const result = { ident, careers, clubRecords, listCoaches: { rows: index.length, digest: indexDigest, gamesTotal: index.reduce((a, r) => a + r.games, 0),
  byId: Object.fromEntries(index.map((r) => [r.id, r.games])) } };
writeFileSync(out, JSON.stringify(result, null, 1) + '\n', { flag: 'wx', mode: 0o600 });
for (const id of [CARR, FRASER]) {
  const c = careers[id] as { totals: { games: number; wins: number; draws: number; losses: number } } | null;
  console.log(`coach ${id}: ${c ? `games ${c.totals.games} W ${c.totals.wins} D ${c.totals.draws} L ${c.totals.losses}` : 'no career'}`);
}
console.log(`listCoaches rows ${index.length} games total ${result.listCoaches.gamesTotal} digest ${indexDigest.slice(0, 16)} (db ${ident.db}, user ${ident.user})`);
await sql.end({ timeout: 5 });
