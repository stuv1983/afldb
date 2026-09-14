import type { Metadata } from 'next';
import Link from 'next/link';

import {
  EDITABLE_NOTICE, FAMILY_BLURBS, FAMILY_LABELS, FAMILY_PUBLIC_PATHS, READ_ONLY_NOTICE,
  RECORD_FAMILY_SLUGS,
  familyListPath, listHref, type RecordFamilySlug,
} from '@/app/admin/records/labels';
import { specialRecordLifecycleCounts } from '@/db/queries/admin-special-records';
import { hasCapability } from '@/lib/auth/capabilities';
import { requireCapability } from '@/lib/auth/session';
import { formatNumber } from '@/lib/format';

import type { SpecialRecordTable } from '@/lib/special-records/identity';

export const metadata: Metadata = {
  title: 'Special records administration',
  robots: { index: false, follow: false },
};
export const dynamic = 'force-dynamic';

const FAMILY_TABLES: Record<RecordFamilySlug, SpecialRecordTable> = {
  'first-kick-goal': 'player_achievements',
  'after-the-siren': 'after_siren_kicks',
};

/**
 * `/admin/records` — the way in to the two curated special-record families
 * (AFLDB-ISSUE-167 §10.1).
 *
 * TWO CARDS UNDER ONE NAV ENTRY. The Data group already holds eight items for
 * two domains of a few hundred rows each; two more top-level entries would
 * make ten. The families keep separate routes below this page because a
 * first-kick goal and a kick after the siren are different kinds of fact with
 * different football context — a merged list would have to call both "record".
 *
 * The counts are the number this surface exists to report: how many records
 * the lifecycle has taken out of the public site, and how many stand. Two
 * grouped counts, no join and no scan of anything else.
 *
 * Family and father-son records are NOT here and are not coming here through
 * this issue: D-1 (2026-09-13) put that domain outside AFLDB-ISSUE-167
 * entirely rather than deferring it.
 */
export default async function SpecialRecordsAdminPage() {
  const admin = await requireCapability('data.specialRecords.read');
  // Furniture only: every action asserts `data.specialRecords.edit` for itself.
  const canEdit = hasCapability(admin, 'data.specialRecords.edit');
  const counts = await specialRecordLifecycleCounts();

  return (
    <>
      <div className="page-header">
        <h1>Special records</h1>
        <p className="subtitle">
          The two curated record families AFLDB cannot recompute from its own match data —
          first-kick goals and kicks after the siren — with their provenance, their lifecycle
          state and every manual edit recorded against them.
        </p>
        <p className="muted">{canEdit ? EDITABLE_NOTICE : READ_ONLY_NOTICE}</p>
      </div>

      <section className="section">
        <ul className="awards-admin-cards">
          {RECORD_FAMILY_SLUGS.map((family) => {
            const count = counts[FAMILY_TABLES[family]];
            return (
              <li className="awards-admin-card" key={family}>
                <div className="awards-admin-card-title">
                  <Link href={familyListPath(family)}>{FAMILY_LABELS[family]}</Link>
                </div>
                <p className="muted" style={{ fontSize: '0.85rem' }}>{FAMILY_BLURBS[family]}</p>
                <dl className="awards-admin-card-fields">
                  <div>
                    <dt>Active</dt>
                    <dd>
                      <Link href={listHref(family, { status: 'active' })}>
                        {formatNumber(count.active)}
                      </Link>
                    </dd>
                  </div>
                  <div>
                    <dt>Voided</dt>
                    <dd>
                      {count.void === 0
                        ? '0'
                        : (
                          <Link href={listHref(family, { status: 'void' })}>
                            {formatNumber(count.void)}
                          </Link>
                        )}
                    </dd>
                  </div>
                </dl>
                <div className="awards-admin-card-action">
                  <Link href={familyListPath(family)} className="btn btn-secondary">Browse</Link>
                  <Link href={FAMILY_PUBLIC_PATHS[family]} className="btn btn-secondary">
                    Public page
                  </Link>
                </div>
              </li>
            );
          })}
        </ul>
      </section>

      <section className="section">
        <h2>What the two states mean</h2>
        <p>
          <strong>Active</strong> is a record the site repeats as a football fact: it appears on
          the public records page and the player page, answers Grid Solver clues and is counted
          by natural-language search.
        </p>
        <p>
          <strong>Void</strong> is an administrator saying this record should never have existed —
          a duplicate, the wrong player, an event that did not happen as recorded. The row is
          kept, with its reason and its full audit trail, so that the edits recorded against it
          stay resolvable; nothing on this surface deletes anything.
        </p>
        <p className="muted">
          A kick recorded as <em>uncited</em> is <strong>not</strong> a voided record. It means the
          source carried no reference for a kick that really happened — an evidence gap kept
          rather than dropped. Uncited kicks are active, are shown on the public site, and are
          never filtered as though they had been retracted.
        </p>
      </section>
    </>
  );
}
