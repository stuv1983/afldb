import { permanentRedirect } from 'next/navigation';

import { FIELD_KEYS, SORTS } from '@/search/advanced-spec';

export const dynamic = 'force-dynamic';

/**
 * Advanced Player Search merged into the player index.
 *
 * The two pages had grown into the same page twice: `playerFilterFields`
 * already declared the identical field set (it says so in its own comment),
 * against the identical career columns, and /players added the name search,
 * the sort row and paging on top. Keeping both meant two answers to "where do
 * I search for a player" in one navigation bar.
 *
 * Every parameter carries across unchanged — both pages read `<field>_min` /
 * `<field>_max`, `club`, `sort` and `page` — so a bookmarked or published
 * search still resolves to the same result set. The one narrowing is `club`:
 * this page accepted a comma-separated list of up to five slugs and the index
 * offers a single-club select, so a multi-club link keeps its first slug
 * rather than silently returning everybody.
 */
export default async function AdvancedSearchRedirect({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const first = (name: string): string | undefined => {
    const raw = params[name];
    return (Array.isArray(raw) ? raw[0] : raw)?.trim() || undefined;
  };

  const query = new URLSearchParams();
  for (const key of FIELD_KEYS) {
    for (const bound of ['min', 'max'] as const) {
      const value = first(`${key}_${bound}`);
      if (value !== undefined) query.set(`${key}_${bound}`, value);
    }
  }

  const club = first('club')?.split(',')[0]?.trim();
  if (club) query.set('club', club);

  // Sort keys are shared between the two pages, but only the ones the index
  // knows are worth forwarding; an unknown key would be dropped there anyway.
  const sort = first('sort');
  if (sort && Object.hasOwn(SORTS, sort)) query.set('sort', sort);

  const page = first('page');
  if (page && /^\d{1,3}$/.test(page)) query.set('page', page);

  const suffix = query.toString();
  permanentRedirect(suffix ? `/players?${suffix}` : '/players');
}
