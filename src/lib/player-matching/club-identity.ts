/**
 * Club identity for the matcher: lineage, and raw club text.
 *
 * Two separate problems live here, both pure so the page, the approval
 * path and the backtest cannot fork.
 *
 * The first is lineage (AFLDB-ISSUE-164 S1). `player_clubs` records the
 * identity a player actually played under -- Footscray, South
 * Melbourne, Fitzroy -- while a source row's `club_id` may name a
 * different identity of the same continuing club. Comparing raw
 * `clubs.id` therefore loses real agreement and, worse, can raise
 * `club_not_in_history` against the correct player. `organization_id`
 * (migration 017) is the continuing club, and it is the right grain for
 * "is this the same club". Mergers are deliberately NOT the same
 * organization: Fitzroy's record stays Fitzroy's, so a Fitzroy source
 * row never matches a Brisbane Lions career through lineage.
 *
 * The second is raw club text (S3/S4). `hall_of_fame.club_name_raw` and
 * `honour_team_members.club_name_raw` carry a human-written club list
 * and no `club_id` at all, which is why those two sources reach no club
 * evidence today. Resolution here is read-time (D-4), exact-only
 * (D-4/S3) and fails closed: text that does not match a canonical club
 * string exactly yields no signal, no negative evidence and no
 * contradiction. It is never trigram-resolved -- a Hall of Fame club
 * list is full of SANFL, WAFL and Tasmanian clubs that are not AFLDB
 * clubs at all, and a fuzzy resolver would happily turn "South
 * Adelaide" into South Melbourne.
 */

/** One canonical club identity as the matcher needs to see it. */
export type ClubIdentity = {
  clubId: number;
  /** clubs.organization_id -- the continuing club across renames. */
  organizationId: number | null;
};

/**
 * A club name found in raw source text and resolved to exactly one
 * continuing club. `clubIds` holds every identity of that lineage the
 * text matched, which is normally one.
 */
export type ResolvedSourceClub = {
  /** The segment of raw text this came from, for the evidence detail. */
  text: string;
  clubIds: number[];
  organizationId: number;
};

/**
 * Canonical club strings to the identities that carry them.
 *
 * Built once per query from `clubs.name`, `clubs.short_name` and
 * `club_aliases.alias`, all passed through `normaliseClubText`.
 */
export type ClubTextIndex = Map<string, ClubIdentity[]>;

/**
 * Comparison form for club text. Deliberately conservative: case,
 * Unicode whitespace and surrounding space only.
 *
 * Nothing is stripped beyond whitespace. A parenthetical is part of the
 * name here, which is the point -- "Fremantle (1882)" in a Hall of Fame
 * club list is an 1882 Victorian club and must not resolve to the AFL
 * club that shares the first word.
 */
export function normaliseClubText(raw: string): string {
  return raw
    .normalize('NFC')
    .toLowerCase()
    .replace(/\s+/gu, ' ')
    .trim();
}

/**
 * The club names a raw club field lists.
 *
 * Hall of Fame separates with a pipe ("Collingwood | Fitzroy") and
 * honour teams with a comma ("Claremont, North Melbourne, St Kilda");
 * both also use a trailing comma for a competition tag ("Carlton, VFL",
 * "Norwood, SANFL, ANFC"). Splitting on both and resolving each segment
 * exactly handles every shape without inventing one: a competition tag
 * simply fails to resolve and contributes nothing.
 */
export function splitClubText(raw: string): string[] {
  return raw
    .split(/[|,]/u)
    .map((part) => part.trim())
    .filter((part) => part.length > 0);
}

/**
 * Build the canonical text index. Later duplicates accumulate rather
 * than overwrite, because a string that names two clubs must be visible
 * as ambiguous, not silently resolved to whichever row arrived last.
 */
export function buildClubTextIndex(
  entries: readonly { text: string; clubId: number; organizationId: number | null }[],
): ClubTextIndex {
  const index: ClubTextIndex = new Map();
  for (const entry of entries) {
    const key = normaliseClubText(entry.text);
    if (!key) continue;
    const list = index.get(key) ?? [];
    if (!list.some((c) => c.clubId === entry.clubId)) {
      list.push({ clubId: entry.clubId, organizationId: entry.organizationId });
    }
    index.set(key, list);
  }
  return index;
}

/**
 * Match one segment of club text, exactly.
 *
 * The plain case is exact equality against a canonical club string. The
 * one extension is a segment that names a club and, in brackets, another
 * identity of the SAME continuing club -- "Western Bulldogs (Footscray)",
 * the form twelve Hall of Fame rows use. Both halves must resolve
 * exactly and to one organization, so it stays an exact rule that fails
 * closed: "Fremantle (1882)" resolves to nothing, because "1882" is not
 * a club, and "Glenorchy (New Town)" to nothing, because neither half is
 * an AFLDB club.
 */
function matchSegment(segment: string, index: ClubTextIndex): ClubIdentity[] {
  const direct = index.get(normaliseClubText(segment));
  if (direct && direct.length > 0) return direct;

  const bracketed = /^(.+?)\s*\(([^()]+)\)$/u.exec(segment);
  if (!bracketed) return [];
  const outer = index.get(normaliseClubText(bracketed[1]));
  const inner = index.get(normaliseClubText(bracketed[2]));
  if (!outer || !inner || outer.length === 0 || inner.length === 0) return [];

  const organizations = new Set([...outer, ...inner].map((c) => c.organizationId));
  // Two different clubs in one segment is not a club name; it is two.
  if (organizations.size !== 1) return [];
  return [...outer, ...inner];
}

/**
 * Resolve one raw club field to the continuing clubs it names.
 *
 * Fails closed in three ways, each of which yields no evidence rather
 * than a guess: text that matches nothing, text that matches identities
 * belonging to more than one continuing club (a genuinely ambiguous
 * string, e.g. a short name shared by Brisbane Bears and Brisbane
 * Lions), and text whose matched identity carries no organization.
 *
 * Multi-club fields stay multi-club. "Collingwood | Fitzroy" resolves
 * to both, because the source is asserting a two-club career and
 * flattening it to one would be a different claim.
 */
export function resolveClubText(
  raw: string | null,
  index: ClubTextIndex,
): ResolvedSourceClub[] {
  if (!raw) return [];
  const resolved: ResolvedSourceClub[] = [];
  const seenOrganizations = new Set<number>();

  for (const segment of splitClubText(raw)) {
    const matches = matchSegment(segment, index);
    if (matches.length === 0) continue;

    // Lineage unknown for any matched identity: unresolved.
    if (matches.some((m) => m.organizationId === null)) continue;
    // Ambiguous across continuing clubs: unresolved.
    const organizations = new Set(matches.map((m) => m.organizationId as number));
    if (organizations.size !== 1) continue;

    const organizationId = [...organizations][0];
    if (seenOrganizations.has(organizationId)) continue;
    seenOrganizations.add(organizationId);
    resolved.push({
      text: segment,
      clubIds: [...new Set(matches.map((m) => m.clubId))].sort((a, b) => a - b),
      organizationId,
    });
  }
  return resolved;
}
