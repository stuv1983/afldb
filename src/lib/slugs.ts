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
