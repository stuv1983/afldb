import type { Metadata } from 'next';

import { ClubComparisonView } from '@/components/ClubComparisonView';
import { pageMetadata } from '@/lib/seo';

import { resolveClubComparisonMetadata, resolveClubComparisonState } from './state';

/**
 * /clubs/compare (AFLDB-ISSUE-144).
 *
 * A Server Component that resolves route state and loads data; every
 * rule about what a parameter means lives in `./state`, and every rule
 * about what a URL means lives in `@/lib/club-comparison-url`.
 *
 * No caching: the whole surface is defined as "what the canonical rows
 * say right now", so a season completing or Brownlow coverage landing
 * must change the answer without a release.
 */
export const dynamic = 'force-dynamic';

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

export async function generateMetadata(
  { searchParams }: { searchParams: SearchParams },
): Promise<Metadata> {
  const meta = await resolveClubComparisonMetadata(await searchParams);
  return pageMetadata({
    title: meta.title,
    description: meta.description,
    // The pair only, alphabetically ordered: season, match filter and
    // page are view state, not separate documents.
    path: meta.canonicalPath,
    noindex: meta.noindex,
  });
}

export default async function ClubComparePage(
  { searchParams }: { searchParams: SearchParams },
) {
  const state = await resolveClubComparisonState(await searchParams);
  return <ClubComparisonView state={state} />;
}
