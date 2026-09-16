import 'server-only';

import { sql } from '@/db/client';
import { searchPlayers } from '@/db/queries/search';
import { coachSlug } from '@/lib/slugs';
import type { NlClubDirectoryEntry, NlCoachDirectoryEntry, NlVenueDirectoryEntry } from '@/search/nl/entities';
import type { NlParseContext, NlPlayerCandidate } from '@/search/nl/parser';
import { NL_LIMITS } from '@/search/nl/plan';
import { CLUB_NICKNAMES, VENUE_NICKNAMES } from '@/search/nl/vocab';

/**
 * Builds the natural-language parser's context from the database: club
 * and venue directories (every historical identity's name plus every
 * alias, merged with the seed nickname dictionaries), and the async
 * player-resolution function.
 *
 * Small tables (24 club identities, 52 venues), so this is a handful of
 * cheap queries per search request -- the same cost globalSearch already
 * pays calling getClubOptions() every time.
 */

/** Every name/alias string a club identity is known by, grouped by organization. Nicknames merge in afterward, database wins on conflict since it is the maintained record. */
async function fetchClubNames(): Promise<Map<number, Set<string>>> {
  const rows = await sql<{ organizationId: number; name: string }[]>`
    SELECT cl.organization_id AS "organizationId", lower(cl.name) AS name FROM clubs cl
    UNION
    SELECT cl.organization_id, lower(cl.short_name) FROM clubs cl WHERE cl.short_name IS NOT NULL
    UNION
    SELECT cl.organization_id, lower(cl.abbreviation) FROM clubs cl WHERE cl.abbreviation IS NOT NULL
    UNION
    SELECT cl.organization_id, lower(ca.alias) FROM club_aliases ca JOIN clubs cl ON cl.id = ca.club_id
  `;
  const byOrg = new Map<number, Set<string>>();
  for (const row of rows) {
    if (!byOrg.has(row.organizationId)) byOrg.set(row.organizationId, new Set());
    byOrg.get(row.organizationId)!.add(row.name);
  }
  return byOrg;
}

async function fetchVenueNames(): Promise<Map<number, Set<string>>> {
  const rows = await sql<{ venueId: number; name: string }[]>`
    SELECT v.id AS "venueId", lower(v.canonical_name) AS name FROM venues v
    UNION
    SELECT v.id, lower(v.legacy_name) FROM venues v WHERE v.legacy_name IS NOT NULL
    UNION
    SELECT va.venue_id, lower(va.alias) FROM venue_aliases va
  `;
  const byVenue = new Map<number, Set<string>>();
  for (const row of rows) {
    if (!byVenue.has(row.venueId)) byVenue.set(row.venueId, new Set());
    byVenue.get(row.venueId)!.add(row.name);
  }
  return byVenue;
}

export async function buildClubDirectory(): Promise<NlClubDirectoryEntry[]> {
  const [orgs, names] = await Promise.all([
    sql<{ id: number; name: string; slug: string }[]>`
      SELECT id, name, slug FROM club_organizations ORDER BY name
    `,
    fetchClubNames(),
  ]);

  // Seed nicknames merged in per organization by matching against the
  // canonical name -- e.g. "richmond" (a CLUB_NICKNAMES value) matches
  // the org whose own name-set already contains "richmond".
  const nicknamesByCanonical = new Map<string, string[]>();
  for (const [nickname, canonical] of Object.entries(CLUB_NICKNAMES)) {
    if (!nicknamesByCanonical.has(canonical)) nicknamesByCanonical.set(canonical, []);
    nicknamesByCanonical.get(canonical)!.push(nickname);
  }

  return orgs.map((org) => {
    const dbNames = names.get(org.id) ?? new Set([org.name.toLowerCase()]);
    const allNames = new Set(dbNames);
    for (const dbName of dbNames) {
      for (const nickname of nicknamesByCanonical.get(dbName) ?? []) allNames.add(nickname);
    }
    return { organizationId: org.id, slug: org.slug, name: org.name, names: [...allNames] };
  });
}

export async function buildVenueDirectory(): Promise<NlVenueDirectoryEntry[]> {
  const [venues, names] = await Promise.all([
    sql<{ id: number; slug: string; canonicalName: string }[]>`
      SELECT id, slug, canonical_name AS "canonicalName" FROM venues ORDER BY canonical_name
    `,
    fetchVenueNames(),
  ]);

  const nicknamesByCanonical = new Map<string, string[]>();
  for (const [nickname, canonical] of Object.entries(VENUE_NICKNAMES)) {
    if (!nicknamesByCanonical.has(canonical)) nicknamesByCanonical.set(canonical, []);
    nicknamesByCanonical.get(canonical)!.push(nickname);
  }

  return venues.map((venue) => {
    const dbNames = names.get(venue.id) ?? new Set([venue.canonicalName.toLowerCase()]);
    const allNames = new Set(dbNames);
    for (const dbName of dbNames) {
      for (const nickname of nicknamesByCanonical.get(dbName) ?? []) allNames.add(nickname);
    }
    return { id: venue.id, slug: venue.slug, name: venue.canonicalName, names: [...allNames] };
  });
}

/**
 * Every coach, for the parser's coach directory: 386 rows, the same shape
 * and the same cost as the club and venue directories above. Modelled on
 * listCoaches (db/queries/coaches.ts) but without the per-coach season
 * aggregate, which resolution does not need.
 *
 * A bare surname becomes an alias ONLY when it is unique among coaches AND
 * is not already a club or venue name -- see NlCoachDirectoryEntry. The
 * measured collisions are real: Albert Pannam (160) and Charlie Pannam
 * (266) both coached Richmond, and Len Smith (88) and Norm Smith (10) both
 * coached. Neither surname reaches the directory, so both decline.
 */
export async function buildCoachDirectory(
  clubs: readonly NlClubDirectoryEntry[],
  venues: readonly NlVenueDirectoryEntry[],
): Promise<NlCoachDirectoryEntry[]> {
  const rows = await sql<{ id: number; displayName: string; surname: string | null; playerId: number | null; playerSlug: string | null }[]>`
    SELECT c.id, c.display_name AS "displayName", c.surname,
           c.player_id AS "playerId", p.slug AS "playerSlug"
      FROM coaches c
      LEFT JOIN players p ON p.id = c.player_id
     ORDER BY c.display_name
  `;

  const surnameCounts = new Map<string, number>();
  for (const row of rows) {
    const surname = row.surname?.trim().toLowerCase();
    if (!surname) continue;
    surnameCounts.set(surname, (surnameCounts.get(surname) ?? 0) + 1);
  }
  const takenNames = new Set<string>();
  for (const club of clubs) for (const name of club.names) takenNames.add(name);
  for (const venue of venues) for (const name of venue.names) takenNames.add(name);

  return rows.map((row) => {
    const names = new Set([row.displayName.toLowerCase()]);
    const surname = row.surname?.trim().toLowerCase();
    if (surname && surnameCounts.get(surname) === 1 && !takenNames.has(surname)) names.add(surname);
    return {
      id: row.id,
      slug: coachSlug(row.displayName),
      name: row.displayName,
      playerId: row.playerId,
      playerSlug: row.playerSlug,
      names: [...names],
    };
  });
}

/**
 * Player-name resolution: delegates to searchPlayers, whose ranking
 * (exact/prefix/substring plus trigram similarity plus career-games
 * prominence, across primary names and player_name_aliases) already does
 * exactly what a nickname-resolved candidate name needs. PLAYER_NICKNAMES
 * substitution ("dusty" -> "dustin martin") happens in the parser itself,
 * before this is called, since it is a fixed text rewrite rather than a
 * database lookup.
 *
 * `ref` keeps the canonical player identity and display name. The form
 * that actually matched travels separately as `matchedName` so the parser
 * can justify the reader's exact wording (a maiden name, a Jnr/Snr suffix,
 * an alternate spelling) without the canonical name ever being replaced.
 */
export async function resolvePlayer(name: string): Promise<NlPlayerCandidate[]> {
  const results = await searchPlayers(name, 5);
  return results.map((r) => ({
    ref: { id: r.id, slug: r.slug, name: r.title },
    score: r.rank,
    matchedName: r.matchedName ?? r.title,
  }));
}

/**
 * AFLDB-ISSUE-197: the parser's surname/family ambiguity branch needs the
 * *complete* set of plausible identities for a bare-surname mention, up to
 * `NL_LIMITS.maxPlayerCandidates + 1` -- resolvePlayer's 5-row cap (tuned
 * for confident single-player lookup) hid two real Abletts and, for a
 * generic surname (Brown, Smith, ...), silently truncated a >12-plausible
 * family down to 5, making the parser's own ">12, decline" rule
 * unreachable. This is a second, purpose-built candidate source: it
 * implements the parser's whole-word-prefix plausibility predicate
 * (`candidateNameWords` in parser.ts) directly in SQL, rather than
 * approximating it with searchPlayers's looser substring/trigram ranking,
 * which can let an unrelated substring match ("Wilcox" for "cox") crowd a
 * true family member out of the bounded result window.
 *
 * Matching runs against both `players.search_name` and every
 * `player_name_aliases.search_alias` (both already normalised), each row
 * pre-filtered cheaply on raw substring containment (reuses the existing
 * gin_trgm_ops indexes), then kept only when every mention token is a
 * whole-word prefix of some whitespace-split word of that row's own
 * matched text -- the exact rule `candidateNameWords` applies in
 * TypeScript, not a looser approximation of it. A player matching through
 * more than one row (canonical name and an alias, or two aliases) is
 * deduplicated by `DISTINCT ON (player_id)` before the cap is applied --
 * mirroring searchPlayers's own per-player `best`-form pattern -- so one
 * player can never consume more than one slot in the bounded window.
 *
 * `candidatePlayerSpan` only ever hands this function tokens matching
 * `^[a-z]+$` (parser.ts:1795-1800), so no LIKE-metacharacter neutralising
 * is needed here the way `searchPlayers`'s free-text query needs `likeSafe`.
 */
export async function resolvePlayerFamily(tokens: string[]): Promise<NlPlayerCandidate[]> {
  if (tokens.length === 0) return [];
  const rows = await sql<{ id: number; slug: string; title: string; matchedName: string; games: number }[]>`
    WITH q AS (
      SELECT array_agg(afldb_normalise_name(t)) AS terms
        FROM unnest(${tokens}::text[]) AS t
    ),
    matched AS (
      SELECT p.id AS player_id, p.display_name AS matched_name, true AS is_primary,
             regexp_split_to_array(p.search_name, '\\s+') AS words
        FROM players p, q
       WHERE NOT EXISTS (
               SELECT 1 FROM unnest(q.terms) AS term
                WHERE p.search_name NOT LIKE '%' || term || '%'
             )
      UNION ALL
      SELECT a.player_id, a.alias, false,
             regexp_split_to_array(a.search_alias, '\\s+')
        FROM player_name_aliases a, q
       WHERE NOT EXISTS (
               SELECT 1 FROM unnest(q.terms) AS term
                WHERE a.search_alias NOT LIKE '%' || term || '%'
             )
    ),
    plausible AS (
      SELECT m.player_id, m.matched_name, m.is_primary
        FROM matched m, q
       WHERE NOT EXISTS (
               SELECT 1 FROM unnest(q.terms) AS term
                WHERE NOT EXISTS (
                  SELECT 1 FROM unnest(m.words) AS w WHERE w LIKE term || '%'
                )
             )
    ),
    best AS (
      SELECT DISTINCT ON (player_id) player_id, matched_name, is_primary
        FROM plausible
       ORDER BY player_id, is_primary DESC, matched_name
    )
    SELECT p.id, p.slug, p.display_name AS title, b.matched_name AS "matchedName",
           COALESCE(c.games, 0) AS games
      FROM best b
      JOIN players p ON p.id = b.player_id
      LEFT JOIN player_career_stats c ON c.player_id = p.id
     ORDER BY COALESCE(c.games, 0) DESC, p.id
     LIMIT ${NL_LIMITS.maxPlayerCandidates + 1}
  `;
  return rows.map((r) => ({
    ref: { id: r.id, slug: r.slug, name: r.title },
    score: r.games,
    matchedName: r.matchedName ?? r.title,
  }));
}

export async function buildNlParseContext(): Promise<NlParseContext> {
  const [clubs, venues] = await Promise.all([buildClubDirectory(), buildVenueDirectory()]);
  // Sequenced after the other two deliberately: a coach surname is only
  // admitted as an alias when no club or venue already answers to it.
  const coaches = await buildCoachDirectory(clubs, venues);
  return { clubs, venues, coaches, resolvePlayer, resolvePlayerFamily };
}
