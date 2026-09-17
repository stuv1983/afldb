import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';

import { RoundBatchForm } from '@/app/admin/fixtures/RoundBatchForm';
import { SingleFixtureForm } from '@/app/admin/fixtures/SingleFixtureForm';
import {
  administrableFixtureSeasons,
  eligibleFixtureClubs,
  isAdministrableFixtureSeason,
} from '@/db/queries/admin-fixtures';
import { listVenues } from '@/db/queries/venues';
import { requireCapability } from '@/lib/auth/session';
import { firstValue } from '@/lib/params';

export const dynamic = 'force-dynamic';

export async function generateMetadata(
  { params }: { params: Promise<{ season: string }> },
): Promise<Metadata> {
  await requireCapability('data.fixtures.edit');
  const { season } = await params;
  return { title: `Add a fixture — ${season}`, robots: { index: false, follow: false } };
}

/**
 * `/admin/fixtures/[season]/new` — two tabs on one page (AFLDB-ISSUE-162
 * §28): a single-fixture form (round-at-a-time with one row) and the
 * round-batch entry flow. Super Admin only.
 */
export default async function NewFixturePage(
  { params, searchParams }: {
    params: Promise<{ season: string }>;
    searchParams: Promise<Record<string, string | string[] | undefined>>;
  },
) {
  await requireCapability('data.fixtures.edit');
  const { season: seasonParam } = await params;
  const search = await searchParams;
  const season = Number(seasonParam);
  if (!Number.isInteger(season)) notFound();

  const bounds = await administrableFixtureSeasons();
  if (!isAdministrableFixtureSeason(season, bounds)) notFound();

  const [clubs, venues] = await Promise.all([eligibleFixtureClubs(season), listVenues()]);
  const tab = firstValue(search.tab) === 'batch' ? 'batch' : 'single';

  return (
    <>
      <div className="page-header">
        <p className="eyebrow"><Link href={`/admin/fixtures/${season}`}>← {season} fixtures</Link></p>
        <h1>Add a fixture — {season}</h1>
        <p className="subtitle">
          Clubs and venues are chosen from lists; identities and eligibility are decided
          server-side (§12). Nothing here can create a fixture for a match AFLDB already holds as
          a result.
        </p>
      </div>

      <section className="section" style={{ display: 'flex', gap: '0.6rem' }}>
        <Link href={`/admin/fixtures/${season}/new`} className={tab === 'single' ? 'btn btn-primary' : 'btn btn-secondary'}>
          Single fixture
        </Link>
        <Link href={`/admin/fixtures/${season}/new?tab=batch`} className={tab === 'batch' ? 'btn btn-primary' : 'btn btn-secondary'}>
          Round batch
        </Link>
      </section>

      {tab === 'single'
        ? <SingleFixtureForm season={season} clubs={clubs.map((c) => ({ id: c.id, name: c.name }))} venues={venues.map((v) => ({ id: v.id, canonicalName: v.canonicalName }))} />
        : <RoundBatchForm season={season} clubs={clubs.map((c) => ({ id: c.id, name: c.name }))} venues={venues.map((v) => ({ id: v.id, canonicalName: v.canonicalName }))} />}
    </>
  );
}
