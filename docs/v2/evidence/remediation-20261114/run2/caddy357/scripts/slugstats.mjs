// caddy357: aggregate slug/id statistics for the real-app shapes (aggregates only). Run via isolated-pg run <db> -- node
import postgres from 'postgres';
const sql = postgres(process.env.DATABASE_URL, { max: 1 });
const q = async (label, query) => { const r = await query; console.log(label, JSON.stringify(r)); };
await q('players', sql`SELECT count(*)::int n, max(length(slug))::int maxlen, count(*) FILTER (WHERE slug !~ '^[a-z0-9-]+$')::int badchars, count(*) FILTER (WHERE slug = '')::int empty, max(id)::int maxid, min(id)::int minid, max(length(slug||'-'||id::text))::int maxseg FROM players`);
await q('players-bad-sample-chars', sql`SELECT DISTINCT regexp_replace(slug, '[a-z0-9-]', '', 'g') AS extra FROM players WHERE slug !~ '^[a-z0-9-]+$' LIMIT 20`);
await q('clubs', sql`SELECT count(*)::int n, max(length(slug))::int maxlen, count(*) FILTER (WHERE slug !~ '^[a-z0-9-]{1,80}$')::int bad FROM clubs`);
await q('venues', sql`SELECT count(*)::int n, max(length(slug))::int maxlen, count(*) FILTER (WHERE slug !~ '^[a-z0-9-]{1,80}$')::int bad FROM venues`);
await q('awards', sql`SELECT count(*)::int n, max(length(slug))::int maxlen, count(*) FILTER (WHERE slug !~ '^[a-z0-9-]{1,80}$')::int bad FROM awards`);
await q('honour-teams', sql`SELECT count(DISTINCT team_name)::int n, max(length(regexp_replace(regexp_replace(lower(replace(replace(team_name,'/',' '),'\\',' ')), '[^a-z0-9]+', '-', 'g'), '^-+|-+$', '', 'g')))::int maxlen FROM honour_team_members`);
await q('seasons', sql`SELECT min(year)::int miny, max(year)::int maxy, count(*)::int n FROM seasons`);
await q('matches', sql`SELECT min(id)::int minid, max(id)::int maxid, count(*)::int n FROM matches`);
await q('aflw-players', sql`SELECT count(*)::int n, max(length(slug))::int maxlen, count(*) FILTER (WHERE slug LIKE '%\%27%')::int pct27, count(*) FILTER (WHERE slug ~ '[^A-Za-z0-9_.-]')::int unusual FROM aflw.players`);
await q('aflw-keys', sql`SELECT (SELECT max(length(match_key)) FROM aflw.matches)::int mk, (SELECT max(length(code)) FROM aflw.clubs)::int cc, (SELECT max(length(season_key)) FROM aflw.seasons)::int sk`);
await sql.end();
