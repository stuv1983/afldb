import 'server-only';

import { sql } from '@/db/client';
import { searchPlayers } from '@/db/queries/search';
import type { NlClubDirectoryEntry, NlVenueDirectoryEntry } from '@/search/nl/entities';
import type { NlParseContext, NlPlayerCandidate } from '@/search/nl/parser';
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

export async function buildNlParseContext(): Promise<NlParseContext> {
  const [clubs, venues] = await Promise.all([buildClubDirectory(), buildVenueDirectory()]);
  return { clubs, venues, resolvePlayer };
}
