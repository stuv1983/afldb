/**
 * Schema.org JSON-LD builders.
 *
 * One rule governs every function here: a property is only emitted when the
 * database actually holds the fact. Structured data is a machine-readable
 * assertion about the world, and AFLDB's whole value is that its assertions
 * are checkable — so a null birth date is an ABSENT `birthDate`, never an
 * empty string, and a statistic that was not collected in an era is simply
 * not described. This is the same NULL-versus-zero discipline the rendering
 * helpers in src/lib/format.ts keep, applied to the markup a crawler reads.
 *
 * Nothing here invents a rating, a review, an award the data does not record,
 * or an `image` that does not exist. Rich-result markup that overstates what
 * a page shows is a manual-action risk, not a ranking trick.
 */
import { absoluteUrl } from '@/lib/seo';

type Json = Record<string, unknown>;

/**
 * A JSON-LD payload, serialised for embedding in a `<script>` element.
 *
 * The `<` escape is the point. These payloads carry database strings — a
 * club nickname, a venue's legacy name, a player's display name — and a
 * value containing `</script>` would otherwise close the element early and
 * hand the rest of the JSON to the HTML parser as markup. `<` is valid
 * inside a JSON string and parses back to `<`, so the escape costs the
 * consumer nothing.
 *
 * Ampersands and quotes need no treatment: inside a `<script>` element the
 * HTML parser is in raw-text mode and reacts only to the closing tag.
 *
 * Separate from the component that renders it so the escaping can be tested
 * without a JSX transform.
 */
export function jsonLdHtml(data: object | object[]): string {
  return JSON.stringify(data).replace(/</g, '\\u003c');
}

/** Drop keys whose value is null/undefined/empty, so no property lies. */
function compact(input: Json): Json {
  return Object.fromEntries(
    Object.entries(input).filter(([, value]) => {
      if (value === null || value === undefined) return false;
      if (typeof value === 'string') return value.trim() !== '';
      if (Array.isArray(value)) return value.length > 0;
      return true;
    }),
  );
}

const PUBLISHER = () => ({
  '@type': 'Organization',
  '@id': `${absoluteUrl('/')}#organization`,
  name: 'AFLDB',
  url: absoluteUrl('/'),
});

/**
 * The site itself, emitted once from the home page.
 *
 * `potentialAction` describes the site's own search, which is a real GET
 * endpoint at /search?q= — the markup is only honest because that URL works
 * for anyone, not just for a logged-in reader.
 */
export function websiteSchema(description: string): Json {
  return {
    '@context': 'https://schema.org',
    '@type': 'WebSite',
    '@id': `${absoluteUrl('/')}#website`,
    name: 'AFLDB',
    alternateName: 'Australian Football Database',
    url: absoluteUrl('/'),
    description,
    inLanguage: 'en-AU',
    publisher: PUBLISHER(),
    potentialAction: {
      '@type': 'SearchAction',
      target: {
        '@type': 'EntryPoint',
        urlTemplate: `${absoluteUrl('/search')}?q={search_term_string}`,
      },
      'query-input': 'required name=search_term_string',
    },
  };
}

export function breadcrumbSchema(
  items: { label: string; href?: string }[],
): Json {
  return {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: items.map((item, index) => compact({
      '@type': 'ListItem',
      position: index + 1,
      name: item.label,
      // The last crumb is the current page and carries no item, which is
      // what Google's own example does.
      item: item.href ? absoluteUrl(item.href) : undefined,
    })),
  };
}

export type PlayerSchemaInput = {
  name: string;
  path: string;
  dob: Date | string | null;
  /** Suppressed when sources disagree — see the `dobDisputed` flag. */
  dobDisputed: boolean;
  debutSeason: number | null;
  finalSeason: number | null;
  clubs: { name: string; slug: string }[];
  description: string;
};

/**
 * A player as `Person`.
 *
 * `athlete` is not a Schema.org type; `Person` with `memberOf` pointing at
 * each `SportsTeam` is the accurate way to say "played for". A disputed date
 * of birth is omitted rather than published: the page shows the conflict, and
 * structured data has no way to.
 */
export function playerSchema(input: PlayerSchemaInput): Json {
  const birthDate = !input.dobDisputed && input.dob
    ? new Date(input.dob).toISOString().slice(0, 10)
    : undefined;

  return compact({
    '@context': 'https://schema.org',
    '@type': 'Person',
    '@id': `${absoluteUrl(input.path)}#player`,
    name: input.name,
    url: absoluteUrl(input.path),
    description: input.description,
    birthDate,
    jobTitle: 'Australian rules footballer',
    memberOf: input.clubs.map((club) => ({
      '@type': 'SportsTeam',
      name: club.name,
      url: absoluteUrl(`/clubs/${club.slug}`),
    })),
    subjectOf: {
      '@type': 'Dataset',
      name: `${input.name} career statistics`,
      isPartOf: { '@id': `${absoluteUrl('/')}#website` },
    },
  });
}

export type CoachSchemaInput = {
  name: string;
  path: string;
  description: string;
  dob: Date | string | null;
  clubs: { name: string; slug: string }[];
};

/**
 * A coach as `Person`, coaching-only.
 *
 * Deliberately does not reuse `playerSchema`'s `jobTitle` -- a coach-only
 * person (`coaches.player_id IS NULL`) never played, so asserting
 * "Australian rules footballer" of them would be an athlete claim the data
 * does not support. `memberOf` names the clubs the coaching record links,
 * same shape as `playerSchema`, but describing a coaching relationship
 * rather than a playing one.
 */
export function coachSchema(input: CoachSchemaInput): Json {
  const birthDate = input.dob
    ? new Date(input.dob).toISOString().slice(0, 10)
    : undefined;

  return compact({
    '@context': 'https://schema.org',
    '@type': 'Person',
    '@id': `${absoluteUrl(input.path)}#coach`,
    name: input.name,
    url: absoluteUrl(input.path),
    description: input.description,
    birthDate,
    jobTitle: 'Australian rules football coach',
    memberOf: input.clubs.map((club) => ({
      '@type': 'SportsTeam',
      name: club.name,
      url: absoluteUrl(`/clubs/${club.slug}`),
    })),
  });
}

export type ClubSchemaInput = {
  name: string;
  path: string;
  description: string;
  foundedSeason: number | null;
  /** Absent for a club that no longer competes; both ends are facts. */
  dissolvedSeason: number | null;
  alternateNames: string[];
};

/**
 * A club as `SportsTeam`.
 *
 * `alternateName` carries the club's historical identities — Footscray for
 * the Western Bulldogs, South Melbourne for Sydney — which is the one place
 * AFLDB's identity model and Schema.org agree exactly. It does NOT rewrite a
 * historical identity's page to the modern name: the page for Footscray is a
 * SportsTeam named Footscray, related to the continuing club rather than
 * replaced by it.
 */
export function clubSchema(input: ClubSchemaInput): Json {
  return compact({
    '@context': 'https://schema.org',
    '@type': 'SportsTeam',
    '@id': `${absoluteUrl(input.path)}#club`,
    name: input.name,
    alternateName: input.alternateNames,
    url: absoluteUrl(input.path),
    description: input.description,
    sport: 'Australian rules football',
    foundingDate: input.foundedSeason ? String(input.foundedSeason) : undefined,
    dissolutionDate: input.dissolvedSeason ? String(input.dissolvedSeason) : undefined,
    memberOf: {
      '@type': 'SportsOrganization',
      name: 'Australian Football League',
    },
  });
}

export type MatchSchemaInput = {
  path: string;
  name: string;
  description: string;
  date: Date | string | null;
  home: { name: string; slug: string; score: number };
  away: { name: string; slug: string; score: number };
  venueName: string | null;
};

/**
 * A match as `SportsEvent`.
 *
 * `eventStatus` is deliberately absent rather than guessed: every match here
 * has been played, and `EventScheduled` on a 1923 result would be false.
 * Attendance is emitted only when recorded — most pre-war matches have none,
 * and a zero would read as an empty ground.
 */
export function matchSchema(input: MatchSchemaInput): Json {
  const date = input.date ? new Date(input.date) : null;
  const startDate = date && !Number.isNaN(date.getTime())
    ? date.toISOString().slice(0, 10)
    : undefined;

  const competitor = (side: MatchSchemaInput['home']) => ({
    '@type': 'SportsTeam',
    name: side.name,
    url: absoluteUrl(`/clubs/${side.slug}`),
  });

  return compact({
    '@context': 'https://schema.org',
    '@type': 'SportsEvent',
    '@id': `${absoluteUrl(input.path)}#match`,
    name: input.name,
    url: absoluteUrl(input.path),
    description: input.description,
    startDate,
    sport: 'Australian rules football',
    competitor: [competitor(input.home), competitor(input.away)],
    homeTeam: competitor(input.home),
    awayTeam: competitor(input.away),
    location: input.venueName
      ? {
        '@type': 'Place',
        name: input.venueName,
        address: { '@type': 'PostalAddress', addressCountry: 'AU' },
      }
      : undefined,
    // Schema.org has no scoreline property on SportsEvent and no attendance
    // count (`maximumAttendeeCapacity` is the ground's capacity, a different
    // fact AFLDB does not hold). Both therefore ride in the description,
    // where they are prose rather than a claimed structured property.
  });
}

export type CollectionSchemaInput = {
  name: string;
  path: string;
  description: string;
  /** The ranked entities, in the order the page shows them. */
  items: { name: string; path: string }[];
};

/**
 * A leaderboard as `ItemList`.
 *
 * Used for the record boards and the Brownlow counts, where the ORDER is the
 * fact the page exists to state. Capped at the rows actually rendered: an
 * ItemList longer than the visible table would be describing a page that
 * does not exist.
 */
export function itemListSchema(input: CollectionSchemaInput): Json {
  return {
    '@context': 'https://schema.org',
    '@type': 'ItemList',
    name: input.name,
    description: input.description,
    url: absoluteUrl(input.path),
    numberOfItems: input.items.length,
    itemListOrder: 'https://schema.org/ItemListOrderDescending',
    itemListElement: input.items.map((item, index) => ({
      '@type': 'ListItem',
      position: index + 1,
      name: item.name,
      url: absoluteUrl(item.path),
    })),
  };
}
