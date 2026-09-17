import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';

import { HallOfFameCorrectionPanel } from '@/app/admin/awards/HallOfFameCorrectionPanel';
import { AWARDS_ROOT, domainListPath } from '@/app/admin/awards/labels';
import { LifecyclePanel } from '@/app/admin/awards/LifecyclePanel';
import { AwardsCrumb, RecordFacts } from '@/app/admin/awards/RecordFacts';
import { RecordHistory } from '@/app/admin/awards/RecordHistory';
import { ReplacePanel } from '@/app/admin/awards/ReplacePanel';
import {
  hallOfFameEntityKey, provenanceOf, readHallOfFameInductee, readHonourOverrides,
} from '@/db/queries/admin-awards';
import { hasCapability } from '@/lib/auth/capabilities';
import { requireCapability } from '@/lib/auth/session';
import { playerPath } from '@/lib/format';

export const metadata: Metadata = { title: 'Hall of Fame entry', robots: { index: false, follow: false } };
export const dynamic = 'force-dynamic';

/**
 * `/admin/awards/hall-of-fame/[id]` — one induction (AFLDB-ISSUE-165 §6.4,
 * §6.6).
 *
 * The name and the induction year appear under "What this record asserts" and
 * nowhere else: together they ARE the entry's identity, both in the database
 * (migration 042's `(name, inducted_year)` key, now active-row-only) and in
 * the durable record that survives a rebuild. A wrong one is a void plus a
 * replacement — and the replacement may legitimately re-use the same name and
 * year, which is precisely why the identity index excludes voided rows.
 *
 * The removal year sits in the correction panel, beside the category and the
 * club, because that is what it is. It is never presented as a lifecycle
 * control and the lifecycle panel never mentions it.
 */
export default async function HallOfFameDetailPage(
  { params }: { params: Promise<{ id: string }> },
) {
  const admin = await requireCapability('data.awards.read');
  const { id: idParam } = await params;
  const id = Number(idParam);
  if (!Number.isInteger(id) || id <= 0) notFound();

  const row = await readHallOfFameInductee(id);
  if (!row) notFound();

  const entityKey = row.sourceKey
    ? hallOfFameEntityKey(row.sourceKey, row.name, row.inductedYear)
    : null;
  const canEdit = hasCapability(admin, 'data.awards.edit');
  const overrides = entityKey ? await readHonourOverrides('hall_of_fame', entityKey) : [];

  const summary = `${row.name}${row.inductedYear === null ? '' : ` (inducted ${row.inductedYear})`}`;

  return (
    <>
      <div className="page-header">
        <AwardsCrumb href={domainListPath('hall-of-fame')} label="Hall of Fame" />
        <h1>{row.name}</h1>
        <p className="subtitle">
          {row.inductedYear !== null && <>Inducted {row.inductedYear}</>}
          {row.category && <> · {row.category}</>}
          {row.isLegend && <> · Legend{row.legendYear ? ` (${row.legendYear})` : ''}</>}
          {row.playerId !== null && row.playerSlug && (
            <> · <a href={playerPath(row.playerSlug, row.playerId)}>View public page</a></>
          )}
          {' · '}<Link href={AWARDS_ROOT}>All honours domains</Link>
        </p>
      </div>

      {row.removedYear !== null && (
        <section className="section">
          <p className="notice" role="note">
            Removed from the Hall of Fame in {row.removedYear}. This is a historical fact about a
            genuine induction: the entry is active, is shown on the public site, and carries its
            removal there. It is not the same thing as voiding the record.
          </p>
        </section>
      )}

      <RecordFacts
        domain="hall-of-fame"
        rowId={row.id}
        entityKey={entityKey}
        provenance={provenanceOf(row.sourceKey)}
        sourceKey={row.sourceKey}
        status={row.status}
        statusReason={row.statusReason}
        updatedAt={row.updatedAt}
        identity={[
          { label: 'Name as recorded', value: row.name },
          { label: 'Inducted year', value: row.inductedYear ?? '—' },
          {
            label: 'Linked player',
            value: row.playerId !== null
              ? <>player #{row.playerId}</>
              : <span className="muted">not linked — many inductees are coaches, umpires or state-league figures</span>,
          },
          { label: 'Player link status', value: row.linkStatus },
        ]}
        overrides={overrides}
      />

      {canEdit ? (
        <>
          {row.status === 'active' && <HallOfFameCorrectionPanel row={row} />}
          <LifecyclePanel
            domain="hall-of-fame"
            rowId={row.id}
            expectedUpdatedAt={row.updatedAt}
            status={row.status}
            statusReason={row.statusReason}
          />
          {row.status === 'active' && (
            <ReplacePanel
              domain="hall-of-fame"
              rowId={row.id}
              expectedUpdatedAt={row.updatedAt}
              currentSummary={summary}
            />
          )}
        </>
      ) : (
        <section className="section">
          <h2>Recorded detail</h2>
          <div className="table-wrap">
            <table>
              <tbody>
                <tr>
                  <th scope="row">Category</th><td>{row.category ?? '—'}</td>
                  <th scope="row">Legend</th>
                  <td>{row.isLegend ? `Yes${row.legendYear ? ` (${row.legendYear})` : ''}` : 'No'}</td>
                </tr>
                <tr>
                  <th scope="row">Club(s)</th><td>{row.clubNameRaw ?? '—'}</td>
                  <th scope="row">Home state</th><td>{row.state ?? '—'}</td>
                </tr>
                <tr>
                  <th scope="row">Career</th><td>{row.playingCareer ?? '—'}</td>
                  <th scope="row">Removed in</th><td>{row.removedYear ?? '—'}</td>
                </tr>
                <tr>
                  <th scope="row">Notes</th><td colSpan={3}>{row.notes ?? '—'}</td>
                </tr>
              </tbody>
            </table>
          </div>
          <p className="muted">
            Correcting, voiding, reinstating and replacing a Hall of Fame entry are Super Admin
            actions.
          </p>
        </section>
      )}

      <RecordHistory table="hall_of_fame" rowId={row.id} />
    </>
  );
}
