import type { Metadata } from 'next';
import Link from 'next/link';

import { listClubs } from '@/db/queries/clubs';
import { getSiteSettings } from '@/db/queries/site-settings';
import { clubPath, formatSpan } from '@/lib/format';
import { pageMetadata } from '@/lib/seo';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = pageMetadata({
  title: 'AFL & VFL Clubs — Every Club, Current and Historical',
  description:
    'Every VFL/AFL club, current and historical, including Fitzroy, South Melbourne, '
    + 'Footscray, University and the Brisbane Bears.',
  path: '/clubs',
});

export default async function ClubsPage() {
  const settings = await getSiteSettings();
  const clubs = await listClubs();

  return (
    <>
      <div className="page-header">
        <h1>Clubs</h1>
        {settings.pageIntros.clubs && (
          <p className="subtitle" style={{ whiteSpace: 'pre-wrap' }}>
            {settings.pageIntros.clubs}
          </p>
        )}
        {/* The comparison surface takes ORGANISATION slugs, so it is seeded
            from here without a club: choosing the pair is the first thing
            that page asks for. AFLDB-ISSUE-144. */}
        <p className="section-note">
          <Link href="/clubs/compare">Compare clubs →</Link>
        </p>
      </div>

      <section className="section">
        <h2>Clubs</h2>
        {clubs.length === 0 ? (
          <div className="empty">
            <h3>No clubs found</h3>
          </div>
        ) : (
          <div className="grid">
            {clubs.map((club) => (
              <Link key={club.id} href={clubPath(club.slug)} className="card">
                <h3>{club.name}</h3>
                <div className="meta">
                  {club.homeState} · {club.lastSeason ? formatSpan(club.firstSeason, club.lastSeason) : `from ${club.firstSeason}`}
                </div>
              </Link>
            ))}
          </div>
        )}
      </section>
    </>
  );
}
