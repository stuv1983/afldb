import type { Metadata } from 'next';

import { CoachComparisonView } from '@/components/CoachComparisonView';
import { pageMetadata } from '@/lib/seo';

import { resolveCoachCompareMetadata, resolveCoachCompareState } from './state';

/**
 * /coaches/compare (AFLDB-ISSUE-170 Stage 2A).
 *
 * A Server Component that resolves route state and loads data; every rule
 * about what a parameter means lives in `./state`, and every rule about
 * what a URL means lives in `@/lib/coach-comparison-url` -- the same split
 * `/clubs/compare` uses.
 *
 * No caching: a newly ingested coach, or a coach's canonical routing
 * changing, must be reflected with no release, the same reasoning
 * `/clubs/compare` and `/coaches/[slug]` (Stage 1D) both already apply.
 */
export const dynamic = 'force-dynamic';

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

export async function generateMetadata(
  { searchParams }: { searchParams: SearchParams },
): Promise<Metadata> {
  const meta = await resolveCoachCompareMetadata(await searchParams);
  return pageMetadata({
    title: meta.title,
    description: meta.description,
    path: meta.canonicalPath,
    noindex: meta.noindex,
  });
}

export default async function CoachComparePage(
  { searchParams }: { searchParams: SearchParams },
) {
  const state = await resolveCoachCompareState(await searchParams);
  return <CoachComparisonView state={state} />;
}
