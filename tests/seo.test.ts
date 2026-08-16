/**
 * SEO regression tests.
 *
 * These pin behaviours that are invisible in the rendered page and that
 * nothing else in the suite would catch: a canonical that quietly points at
 * localhost, a page that re-enables indexing on a deployment the gate has
 * turned off, a filtered list that becomes indexable again, or structured
 * data that asserts a fact the database does not hold.
 *
 * Every test here is a unit test. `@/db/client` is mocked rather than
 * connected to, so the suite runs in CI without a database — the indexing
 * gate and the metadata contract are decisions made before any query.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/db/client', () => ({ sql: Object.assign(() => [], { unsafe: () => [] }) }));

const KEYS = ['AFLDB_BASE_URL', 'AFLDB_INDEXING', 'AFLDB_BETA_GATE', 'AFLDB_ENV'] as const;
let saved: Partial<Record<(typeof KEYS)[number], string | undefined>> = {};

beforeEach(() => {
  saved = Object.fromEntries(KEYS.map((key) => [key, process.env[key]]));
  for (const key of KEYS) delete process.env[key];
  process.env.AFLDB_BASE_URL = 'https://afldb.com';
});

afterEach(() => {
  for (const key of KEYS) {
    const value = saved[key];
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
});

describe('siteUrlProblem', () => {
  it('accepts a bare https origin', async () => {
    const { siteUrlProblem } = await import('@/lib/seo');
    expect(siteUrlProblem('https://afldb.com')).toBeNull();
    expect(siteUrlProblem('https://afldb.com/')).toBeNull();
  });

  /**
   * The failure this exists for is silent and total: with AFLDB_BASE_URL
   * unset, `metadataBase` falls back to localhost and EVERY page on the site
   * tells Google its preferred URL is one no crawler can reach.
   */
  it('rejects everything that would produce an unreachable canonical', async () => {
    const { siteUrlProblem } = await import('@/lib/seo');

    // The default argument reads the environment, so the unset case is the
    // no-argument call rather than an explicit undefined.
    delete process.env.AFLDB_BASE_URL;
    expect(siteUrlProblem()).toBeTypeOf('string');

    for (const value of [
      '',
      '   ',
      'afldb.com',
      'http://afldb.com',
      'http://localhost:3100',
      'https://localhost:3100',
      'https://afldb.com?utm_source=x',
    ]) {
      expect(siteUrlProblem(value), `AFLDB_BASE_URL=${JSON.stringify(value)}`)
        .toBeTypeOf('string');
    }
  });
});

/**
 * The launch gate.
 *
 * Unlike the tests around it this one reads the REAL environment, restored
 * by the afterEach above. It is inert everywhere except a deployment that
 * has actually turned indexing on — and on that deployment it is the check
 * that stops the whole site canonicalising to an address no crawler can
 * resolve. Run `npm test` on the production host after setting
 * AFLDB_INDEXING=on and before announcing the site.
 */
describe('gate: an indexed deployment can publish its own canonical', () => {
  it('has a usable AFLDB_BASE_URL wherever indexing is enabled', async () => {
    for (const key of KEYS) {
      const value = saved[key];
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }

    const { indexingEnabled } = await import('@/lib/indexing');
    const { siteUrlProblem } = await import('@/lib/seo');
    if (!indexingEnabled()) return;

    expect(siteUrlProblem()).toBeNull();
  });
});

describe('pageMetadata', () => {
  it('gives every page a canonical and an og:url on the same path', async () => {
    const { pageMetadata } = await import('@/lib/seo');
    const meta = pageMetadata({
      title: 'Patrick Cripps — AFL Stats',
      description: 'Career statistics.',
      path: '/players/patrick-cripps-123',
    });

    expect(meta.alternates?.canonical).toBe('/players/patrick-cripps-123');
    expect(meta.openGraph?.url).toBe('/players/patrick-cripps-123');
  });

  /**
   * Next REPLACES `openGraph` between segments rather than merging it, so a
   * page that sets its own silently loses whatever the root layout declared.
   * That is how the player profile lost `siteName` and `locale`, and it is
   * the kind of regression that only shows up in a shared link.
   */
  it('restates the site-level Open Graph fields the layout would lose', async () => {
    const { pageMetadata } = await import('@/lib/seo');
    const og = pageMetadata({ title: 'T', description: 'D', path: '/x' }).openGraph;

    expect(og).toMatchObject({ siteName: 'AFLDB', locale: 'en_AU', type: 'website' });
  });

  /**
   * The root layout's "%s | AFLDB" template applies to og:title as well, so
   * a spelled-out suffix has to be marked absolute or it lands twice.
   */
  it('marks the og:title absolute so the title template cannot double-apply', async () => {
    const { pageMetadata } = await import('@/lib/seo');
    const og = pageMetadata({ title: 'Carlton', description: 'D', path: '/clubs/carlton' })
      .openGraph;

    expect(og?.title).toEqual({ absolute: 'Carlton | AFLDB' });
  });

  /**
   * The one directive a page must never issue. `index: true` would override
   * the root layout's gate (src/lib/indexing.ts) and publish a beta or
   * development deployment one page at a time — the exact accident the
   * separate AFLDB_INDEXING flag exists to prevent.
   */
  it('never sets a positive robots directive', async () => {
    const { pageMetadata } = await import('@/lib/seo');

    expect(pageMetadata({ title: 'T', description: 'D', path: '/x' }).robots)
      .toBeUndefined();
    expect(pageMetadata({ title: 'T', description: 'D', path: '/x', noindex: true }).robots)
      .toEqual({ index: false, follow: true });
  });

  /** A view that is not indexed must still be followed, or its links die. */
  it('keeps a noindexed view crawlable', async () => {
    const { pageMetadata } = await import('@/lib/seo');
    const robots = pageMetadata({ title: 'T', description: 'D', path: '/players', noindex: true })
      .robots as { follow: boolean };

    expect(robots.follow).toBe(true);
  });
});

describe('isFilteredView', () => {
  it('treats an untouched list page as indexable', async () => {
    const { isFilteredView } = await import('@/lib/seo');
    expect(isFilteredView({})).toBe(false);
    // A parameter present but empty is what an unsubmitted GET form sends.
    expect(isFilteredView({ club: '', games_min: '', sort: undefined })).toBe(false);
  });

  it('catches every shape of view state, including filters added later', async () => {
    const { isFilteredView } = await import('@/lib/seo');
    for (const params of [
      { page: '2' },
      { sort: 'goals' },
      { club: 'carlton' },
      { q: 'ablett' },
      { games_min: '200' },
      { brownlow_votes_max: '0' },
      // A range filter that does not exist yet still matches on its suffix,
      // so a new filter cannot silently become indexable.
      { spoils_min: '10' },
      { club: ['carlton', 'geelong'] },
    ]) {
      expect(isFilteredView(params), JSON.stringify(params)).toBe(true);
    }
  });
});

describe('robots.txt', () => {
  it('disallows everything on a deployment that must not be indexed', async () => {
    const { default: robots } = await import('@/app/robots');
    expect(robots().rules).toEqual([{ userAgent: '*', disallow: '/' }]);
  });

  it('keeps the private and unbounded surfaces out once indexing is on', async () => {
    process.env.AFLDB_INDEXING = 'on';
    vi.resetModules();
    const { default: robots } = await import('@/app/robots');
    const result = robots();
    const rule = Array.isArray(result.rules) ? result.rules[0] : result.rules;

    expect(rule.allow).toBe('/');
    expect(rule.disallow).toEqual(
      expect.arrayContaining(['/api/', '/admin', '/beta', '/search']),
    );
    expect(result.sitemap).toBe('https://afldb.com/sitemap.xml');
  });

  /** robots.txt and the page metadata read the same predicate, so they
      cannot disagree the way they once did. */
  it('agrees with the page-level gate on the beta host', async () => {
    process.env.AFLDB_INDEXING = 'on';
    process.env.AFLDB_BETA_GATE = 'on';
    vi.resetModules();
    const [{ default: robots }, { indexingEnabled }] = await Promise.all([
      import('@/app/robots'),
      import('@/lib/indexing'),
    ]);

    expect(indexingEnabled()).toBe(false);
    expect(robots().rules).toEqual([{ userAgent: '*', disallow: '/' }]);
  });
});

describe('sitemap', () => {
  it('publishes no map of a deployment that must not be indexed', async () => {
    vi.resetModules();
    const { generateSitemaps, default: sitemap } = await import('@/app/sitemap');

    expect(await generateSitemaps()).toEqual([]);
    expect(await sitemap({ id: 0 })).toEqual([]);
  });
});

describe('structured data', () => {
  it('ends a breadcrumb trail on the current page, which carries no item', async () => {
    const { breadcrumbSchema } = await import('@/lib/structured-data');
    const schema = breadcrumbSchema([
      { label: 'AFLDB', href: '/' },
      { label: 'Players', href: '/players' },
      { label: 'Patrick Cripps' },
    ]) as { itemListElement: Record<string, unknown>[] };

    expect(schema.itemListElement).toHaveLength(3);
    expect(schema.itemListElement[1].item).toBe('https://afldb.com/players');
    expect(schema.itemListElement[2]).not.toHaveProperty('item');
    expect(schema.itemListElement[2].position).toBe(3);
  });

  /**
   * The NULL-versus-zero rule, applied to markup. A date of birth AFLDB does
   * not hold, or holds two conflicting versions of, must not be published as
   * a fact — the page shows the conflict and JSON-LD has no way to.
   */
  it('omits a date of birth that is absent or disputed', async () => {
    const { playerSchema } = await import('@/lib/structured-data');
    const base = {
      name: 'A Player',
      path: '/players/a-player-1',
      debutSeason: 1900,
      finalSeason: 1910,
      clubs: [],
      description: 'D',
    };

    expect(playerSchema({ ...base, dob: null, dobDisputed: false }))
      .not.toHaveProperty('birthDate');
    expect(playerSchema({ ...base, dob: '1880-04-01', dobDisputed: true }))
      .not.toHaveProperty('birthDate');
    expect(playerSchema({ ...base, dob: '1880-04-01', dobDisputed: false }))
      .toMatchObject({ birthDate: '1880-04-01' });
  });

  it('does not dissolve a club that still competes', async () => {
    const { clubSchema } = await import('@/lib/structured-data');
    const base = {
      name: 'Carlton', path: '/clubs/carlton', description: 'D',
      foundedSeason: 1897, alternateNames: [],
    };

    expect(clubSchema({ ...base, dissolvedSeason: null }))
      .not.toHaveProperty('dissolutionDate');
    expect(clubSchema({ ...base, name: 'Fitzroy', dissolvedSeason: 1996 }))
      .toMatchObject({ dissolutionDate: '1996' });
  });

  it('carries a historical identity’s other names without renaming it', async () => {
    const { clubSchema } = await import('@/lib/structured-data');
    const schema = clubSchema({
      name: 'Footscray',
      path: '/clubs/footscray',
      description: 'D',
      foundedSeason: 1925,
      dissolvedSeason: 1996,
      alternateNames: ['Western Bulldogs'],
    }) as Record<string, unknown>;

    // The page is Footscray's and says so; the modern name is an alternate,
    // not a replacement.
    expect(schema.name).toBe('Footscray');
    expect(schema.alternateName).toEqual(['Western Bulldogs']);
  });

  it('omits a start date it cannot state precisely', async () => {
    const { matchSchema } = await import('@/lib/structured-data');
    const base = {
      path: '/matches/1',
      name: 'A v B',
      description: 'D',
      home: { name: 'A', slug: 'a', score: 100 },
      away: { name: 'B', slug: 'b', score: 90 },
      venueName: 'MCG',
    };

    expect(matchSchema({ ...base, date: null })).not.toHaveProperty('startDate');
    expect(matchSchema({ ...base, date: 'not a date' })).not.toHaveProperty('startDate');
    expect(matchSchema({ ...base, date: '1970-05-02' }))
      .toMatchObject({ startDate: '1970-05-02' });
  });

  it('builds every schema against the production origin', async () => {
    const { websiteSchema } = await import('@/lib/structured-data');
    const schema = websiteSchema('D') as Record<string, unknown>;

    expect(schema.url).toBe('https://afldb.com/');
    expect(schema['@context']).toBe('https://schema.org');
  });
});

describe('jsonLdHtml', () => {
  /**
   * The escape is the reason this is a function rather than an inline
   * `JSON.stringify`. Every payload carries database strings, and one
   * containing `</script>` would close the element early and hand the rest
   * of the JSON to the HTML parser as markup.
   */
  it('escapes a payload that would otherwise close its own script element', async () => {
    const { jsonLdHtml } = await import('@/lib/structured-data');
    const value = { name: 'x</script><script>alert(1)</script>' };
    const html = jsonLdHtml(value);

    expect(html).not.toContain('</script>');
    expect(html).not.toContain('<script');
    // Still valid JSON, and still the same value: < parses back to '<'.
    expect(JSON.parse(html)).toEqual(value);
  });

  it('emits parseable JSON-LD for a real player payload', async () => {
    const { jsonLdHtml, playerSchema } = await import('@/lib/structured-data');
    const parsed = JSON.parse(jsonLdHtml(playerSchema({
      name: 'Gary Ablett Jr',
      path: '/players/gary-ablett-jr-1',
      dob: '1984-05-14',
      dobDisputed: false,
      debutSeason: 2002,
      finalSeason: 2020,
      clubs: [{ name: 'Geelong', slug: 'geelong' }, { name: 'Gold Coast', slug: 'gold-coast' }],
      description: 'D',
    })));

    expect(parsed['@type']).toBe('Person');
    expect(parsed.memberOf).toHaveLength(2);
    expect(parsed.memberOf[0].url).toBe('https://afldb.com/clubs/geelong');
  });
});
