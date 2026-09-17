/**
 * Slugs for entities whose natural key is a display string.
 *
 * Honour teams are stored by name — "AFL/VFL Team of the Century" — because
 * that is what the source records and there is no id to reference. The URL
 * needs a stable, readable form of that name, and the page needs to get the
 * name back to query with, so the transform has to round-trip through a
 * lookup rather than be reversed by string surgery.
 */

export function honourTeamSlug(teamName: string): string {
  return teamName
    .toLowerCase()
    .replace(/[/\\]/g, ' ')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

/** Find the team whose slug matches, or null. */
export function matchHonourTeam(slug: string, teamNames: string[]): string | null {
  return teamNames.find((name) => honourTeamSlug(name) === slug) ?? null;
}

/**
 * A coach's URL slug, derived from `coaches.display_name` at read time.
 *
 * `coaches` (migration 087) carries no stored slug column -- unlike
 * `players`, whose slug is assigned once at import and kept stable even
 * through a display-name correction. A coach's display name is expected to
 * be stable (it is the AFL Tables coach page's own name), so deriving it on
 * every read is safe; the id after it in the URL is still the authoritative
 * identifier, exactly as `players.slug` is.
 */
export function coachSlug(displayName: string): string {
  return displayName
    .toLowerCase()
    .replace(/[/\\]/g, ' ')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}
