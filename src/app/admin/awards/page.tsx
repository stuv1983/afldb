import type { Metadata } from 'next';
import Link from 'next/link';

import {
  DOMAIN_BLURBS, DOMAIN_LABELS, domainListPath, domainNewPath, listHref,
} from '@/app/admin/awards/labels';
import { honourLifecycleCounts, type HonourTable } from '@/db/queries/admin-awards';
import { hasCapability } from '@/lib/auth/capabilities';
import { requireCapability } from '@/lib/auth/session';
import { formatNumber } from '@/lib/format';

import type { HonourDomain } from '@/app/admin/awards/labels';

export const metadata: Metadata = {
  title: 'Awards & honours administration',
  robots: { index: false, follow: false },
};
export const dynamic = 'force-dynamic';

const DOMAIN_TABLES: Record<HonourDomain, HonourTable> = {
  winners: 'award_winners',
  'hall-of-fame': 'hall_of_fame',
  'honour-teams': 'honour_team_members',
};

const DOMAINS: HonourDomain[] = ['winners', 'hall-of-fame', 'honour-teams'];

/**
 * `/admin/awards` — the way in to the three honours domains
 * (AFLDB-ISSUE-165 §6.1).
 *
 * Three cards, not one merged list. An award winner, a Hall of Fame induction
 * and an honour-team selection are three different kinds of fact with three
 * different identity keys and three different sets of correctable fields; a
 * single polymorphic table would have to call all three "record" and would
 * hide exactly the distinctions an administrator needs before deciding what to
 * do (§6, D-5).
 *
 * The counts are the one number this surface exists to report: how many
 * records the lifecycle has taken out of the public site, and how many are
 * standing. They are three grouped counts, no join and no scan of anything
 * else.
 */
export default async function AwardsAdminPage() {
  const admin = await requireCapability('data.awards.read');
  const counts = await honourLifecycleCounts();
  const canEdit = hasCapability(admin, 'data.awards.edit');

  return (
    <>
      <div className="page-header">
        <h1>Awards &amp; honours</h1>
        <p className="subtitle">
          Award winners, Hall of Fame inductions and representative-team selections — their
          provenance, their lifecycle state, and the correction, void and replacement history of
          each. A voided record stays here and disappears from the public site; nothing on this
          surface deletes anything.
        </p>
        {!canEdit && (
          <p className="muted">
            You can read every record and its history. Correcting, voiding, reinstating, replacing
            and creating are Super Admin actions.
          </p>
        )}
      </div>

      <section className="section">
        <ul className="admin-cards">
          {DOMAINS.map((domain) => {
            const count = counts[DOMAIN_TABLES[domain]];
            return (
              <li className="admin-card" key={domain}>
                <div className="admin-card-title">
                  <Link href={domainListPath(domain)}>{DOMAIN_LABELS[domain]}</Link>
                </div>
                <p className="muted" style={{ fontSize: '0.85rem' }}>{DOMAIN_BLURBS[domain]}</p>
                <dl className="admin-card-fields">
                  <div>
                    <dt>Active</dt>
                    <dd>{formatNumber(count.active)}</dd>
                  </div>
                  <div>
                    <dt>Voided</dt>
                    <dd>
                      {count.void === 0
                        ? '0'
                        : (
                          <Link href={listHref(domain, { status: 'void' })}>
                            {formatNumber(count.void)}
                          </Link>
                        )}
                    </dd>
                  </div>
                </dl>
                <div className="admin-card-action" style={{ display: 'flex', gap: '0.6rem', flexWrap: 'wrap' }}>
                  <Link href={domainListPath(domain)} className="btn btn-secondary">Browse</Link>
                  {canEdit && (
                    <Link href={domainNewPath(domain)} className="btn btn-secondary">Record a new one</Link>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      </section>

      <section className="section">
        <h2>What the two states mean</h2>
        <p>
          <strong>Active</strong> is a record the site repeats as a football fact: it appears on the
          award, player, club and season pages, answers Grid Solver clues, is counted by
          natural-language search and is listed in the sitemap.
        </p>
        <p>
          <strong>Void</strong> is an administrator saying this record should never have existed —
          a duplicate, the wrong season, the wrong person. The row is kept, with its reason and its
          full audit trail, and every one of those surfaces stops repeating it. It can be reinstated.
        </p>
        <p className="muted">
          A Hall of Fame inductee later formally removed from the Hall is <em>not</em> a voided
          record. That is a real historical event: the entry keeps a removal year, stays active and
          stays public.
        </p>
      </section>
    </>
  );
}
