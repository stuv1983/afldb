import type { MetadataRoute } from 'next';

import { sql } from '@/db/client';
import { RECORD_CATEGORIES } from '@/db/queries/records';
import { indexingEnabled } from '@/lib/indexing';
import { siteUrl } from '@/lib/seo';
import { honourTeamSlug } from '@/lib/slugs';

const baseUrl = siteUrl();

/**
 * Sitemap index.
 *
 * AFLDB has 13,000+ players and 17,000+ matches, far past the 50,000-URL
 * and 50 MB limits for a single sitemap and far too slow to build per
 * request. This returns a small index of segments; each segment is
 * generated separately and cached.
 *
 * SEGMENTS
 *   0    static routes, clubs, seasons, venues
 *   1    the curated landing pages: records, awards, Brownlow, honours
 *   100+ players, 5,000 per file
 *   200+ matches, 5,000 per file
 *   300  the whole AFLW competition
 */
export const revalidate = 86400;

export async function generateSitemaps() {
  // A deployment that must not be indexed must not publish a map of itself
  // either. robots.txt already says Disallow: / here, but a sitemap is not
  // only found through robots.txt — it can be submitted by hand, or fetched
  // from a URL someone remembered — and every URL in it would name the beta
  // host, which is exactly the duplicate-content competition the separate
  // AFLDB_INDEXING flag exists to prevent.
  if (!indexingEnabled()) return [];

  const [row] = await sql<{ playerPages: number; matchPages: number }[]>`
    SELECT ceil(count(*) FILTER (WHERE kind = 'player') / 5000.0)::int AS "playerPages",
           ceil(count(*) FILTER (WHERE kind = 'match')  / 5000.0)::int AS "matchPages"
      FROM (SELECT 'player' AS kind FROM players
            UNION ALL
            SELECT 'match' FROM matches) x
  `;

  const ids = [{ id: 0 }, { id: 1 }];
  for (let i = 0; i < row.playerPages; i += 1) ids.push({ id: 100 + i });
  for (let i = 0; i < row.matchPages; i += 1) ids.push({ id: 200 + i });
  // 300 = the whole AFLW competition. It is under 2,000 URLs in total, so
  // it needs no splitting and gets one segment of its own.
  ids.push({ id: 300 });
  return ids;
}

export default async function sitemap({
  id: rawId,
}: {
  id: number | string;
}): Promise<MetadataRoute.Sitemap> {
  // Next passes the segment id back as the string from the URL, so a strict
  // comparison against 0 never matched and segment 0 rendered empty.
  const id = Number(rawId);

  if (!indexingEnabled()) return [];

  // Segment 0: static routes plus the small reference collections.
  if (id === 0) {
    const [clubs, seasons, venues] = await Promise.all([
      sql<{ slug: string }[]>`SELECT slug FROM clubs ORDER BY slug`,
      sql<{ year: number }[]>`SELECT year FROM seasons ORDER BY year`,
      sql<{ slug: string }[]>`SELECT slug FROM venues ORDER BY slug`,
    ]);

    return [
      { url: baseUrl, changeFrequency: 'daily', priority: 1 },
      { url: `${baseUrl}/players`, changeFrequency: 'weekly', priority: 0.9 },
      { url: `${baseUrl}/clubs`, changeFrequency: 'monthly', priority: 0.9 },
      { url: `${baseUrl}/seasons`, changeFrequency: 'weekly', priority: 0.9 },
      { url: `${baseUrl}/records`, changeFrequency: 'weekly', priority: 0.9 },
      { url: `${baseUrl}/brownlow`, changeFrequency: 'weekly', priority: 0.8 },
      { url: `${baseUrl}/awards`, changeFrequency: 'weekly', priority: 0.8 },
      { url: `${baseUrl}/draft`, changeFrequency: 'weekly', priority: 0.7 },
      { url: `${baseUrl}/venues`, changeFrequency: 'monthly', priority: 0.7 },
      { url: `${baseUrl}/match-search`, changeFrequency: 'monthly', priority: 0.8 },
      { url: `${baseUrl}/players/compare`, changeFrequency: 'monthly', priority: 0.5 },
      { url: `${baseUrl}/about`, changeFrequency: 'yearly', priority: 0.3 },
      ...clubs.map((c) => ({
        url: `${baseUrl}/clubs/${c.slug}`,
        changeFrequency: 'weekly' as const,
        priority: 0.7,
      })),
      ...seasons.map((s) => ({
        url: `${baseUrl}/seasons/${s.year}`,
        changeFrequency: 'monthly' as const,
        priority: 0.7,
      })),
      ...venues.map((v) => ({
        url: `${baseUrl}/venues/${v.slug}`,
        changeFrequency: 'monthly' as const,
        priority: 0.5,
      })),
    ];
  }

  // Segment 1: the curated landing pages.
  //
  // These were absent from the sitemap entirely, which is the wrong way
  // round: a record board, a Brownlow count and an award history are the
  // pages most likely to answer a search outright, and they were the ones a
  // crawler had to find by walking the site. Every URL here is a permanent,
  // parameter-free page whose content comes from a fixed query.
  if (id === 1) {
    const [brownlowYears, awards, awardSeasons, honourTeams] = await Promise.all([
      sql<{ season: number }[]>`
        SELECT DISTINCT season FROM brownlow_season_votes ORDER BY season
      `,
      sql<{ slug: string }[]>`SELECT slug FROM awards ORDER BY slug`,
      sql<{ slug: string; season: number }[]>`
        SELECT DISTINCT a.slug, w.season
          FROM award_winners w
          JOIN awards a ON a.id = w.award_id
         WHERE w.season IS NOT NULL
         ORDER BY a.slug, w.season
      `,
      sql<{ teamName: string }[]>`
        SELECT DISTINCT team_name AS "teamName" FROM honour_team_members
         ORDER BY team_name
      `,
    ]);

    return [
      { url: `${baseUrl}/hall-of-fame`, changeFrequency: 'yearly' as const, priority: 0.7 },
      ...Object.keys(RECORD_CATEGORIES).map((slug) => ({
        url: `${baseUrl}/records/${slug}`,
        changeFrequency: 'weekly' as const,
        priority: 0.8,
      })),
      ...brownlowYears.map((b) => ({
        url: `${baseUrl}/brownlow/${b.season}`,
        changeFrequency: 'yearly' as const,
        priority: 0.7,
      })),
      ...awards.map((a) => ({
        url: `${baseUrl}/awards/${a.slug}`,
        changeFrequency: 'monthly' as const,
        priority: 0.6,
      })),
      ...awardSeasons.map((a) => ({
        url: `${baseUrl}/awards/${a.slug}/${a.season}`,
        changeFrequency: 'yearly' as const,
        priority: 0.4,
      })),
      ...honourTeams.map((t) => ({
        url: `${baseUrl}/honour-teams/${honourTeamSlug(t.teamName)}`,
        changeFrequency: 'yearly' as const,
        priority: 0.5,
      })),
    ];
  }

  // Segments 100+: players, 5,000 per file.
  if (id >= 100 && id < 200) {
    const offset = (id - 100) * 5000;
    const players = await sql<{ id: number; slug: string }[]>`
      SELECT id, slug FROM players ORDER BY id LIMIT 5000 OFFSET ${offset}
    `;
    return players.map((p) => ({
      url: `${baseUrl}/players/${p.slug}-${p.id}`,
      changeFrequency: 'monthly' as const,
      priority: 0.6,
    }));
  }

  // Segment 300: AFLW. Keys are the source's own and are encoded for the
  // same reason the page links encode them.
  if (id === 300) {
    const [clubs, seasons, players, matches] = await Promise.all([
      sql<{ code: string }[]>`SELECT code FROM aflw.clubs ORDER BY code`,
      sql<{ seasonKey: string }[]>`
        SELECT season_key AS "seasonKey" FROM aflw.seasons ORDER BY ordinal
      `,
      sql<{ slug: string }[]>`SELECT slug FROM aflw.players ORDER BY slug`,
      sql<{ matchKey: string }[]>`
        SELECT match_key AS "matchKey" FROM aflw.matches ORDER BY match_date
      `,
    ]);

    return [
      { url: `${baseUrl}/aflw`, changeFrequency: 'weekly' as const, priority: 0.9 },
      { url: `${baseUrl}/aflw/players`, changeFrequency: 'weekly' as const, priority: 0.8 },
      { url: `${baseUrl}/aflw/clubs`, changeFrequency: 'monthly' as const, priority: 0.8 },
      { url: `${baseUrl}/aflw/seasons`, changeFrequency: 'weekly' as const, priority: 0.8 },
      { url: `${baseUrl}/aflw/venues`, changeFrequency: 'monthly' as const, priority: 0.5 },
      {
        url: `${baseUrl}/aflw/match-search`,
        changeFrequency: 'monthly' as const,
        priority: 0.7,
      },
      ...clubs.map((c) => ({
        url: `${baseUrl}/aflw/clubs/${encodeURIComponent(c.code)}`,
        changeFrequency: 'weekly' as const,
        priority: 0.7,
      })),
      ...seasons.map((s) => ({
        url: `${baseUrl}/aflw/seasons/${encodeURIComponent(s.seasonKey)}`,
        changeFrequency: 'monthly' as const,
        priority: 0.7,
      })),
      ...players.map((p) => ({
        url: `${baseUrl}/aflw/players/${encodeURIComponent(p.slug)}`,
        changeFrequency: 'monthly' as const,
        priority: 0.6,
      })),
      ...matches.map((m) => ({
        url: `${baseUrl}/aflw/matches/${encodeURIComponent(m.matchKey)}`,
        changeFrequency: 'yearly' as const,
        priority: 0.4,
      })),
    ];
  }

  // Segments 200+: matches, 5,000 per file.
  if (id >= 200) {
    const offset = (id - 200) * 5000;
    const matches = await sql<{ id: number }[]>`
      SELECT id FROM matches ORDER BY id LIMIT 5000 OFFSET ${offset}
    `;
    return matches.map((m) => ({
      url: `${baseUrl}/matches/${m.id}`,
      changeFrequency: 'yearly' as const,
      priority: 0.4,
    }));
  }

  return [];
}
