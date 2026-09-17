import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';

import { AWARDS_ROOT, domainListPath } from '@/app/admin/awards/labels';
import { LifecyclePanel } from '@/app/admin/awards/LifecyclePanel';
import { AwardsCrumb, RecordFacts } from '@/app/admin/awards/RecordFacts';
import { RecordHistory } from '@/app/admin/awards/RecordHistory';
import { ReplacePanel } from '@/app/admin/awards/ReplacePanel';
import { WinnerCorrectionPanel } from '@/app/admin/awards/WinnerCorrectionPanel';
import {
  awardWinnerEntityKey, provenanceOf, readAwardWinner, readHonourOverrides,
} from '@/db/queries/admin-awards';
import { listAwards } from '@/db/queries/awards';
import { listClubs } from '@/db/queries/clubs';
import { hasCapability } from '@/lib/auth/capabilities';
import { requireCapability } from '@/lib/auth/session';
import { playerPath } from '@/lib/format';

export const metadata: Metadata = { title: 'Award winner', robots: { index: false, follow: false } };
export const dynamic = 'force-dynamic';

/**
 * `/admin/awards/winners/[id]` — one award-winner record: what it asserts,
 * where it came from, whether it stands, what replaced it, and its history
 * (AFLDB-ISSUE-165 §6.4, §6.5).
 *
 * Admin (`data.awards.read`) sees every fact and no controls. Super Admin
 * (`data.awards.edit`) additionally sees Correct, Lifecycle and Replace. The
 * guard here is `.read`, because reading is what this page does; every control
 * below asserts `.edit` at its own Server Action, so hiding a panel is a
 * courtesy and never the boundary.
 */
export default async function AwardWinnerDetailPage(
  { params }: { params: Promise<{ id: string }> },
) {
  const admin = await requireCapability('data.awards.read');
  const { id: idParam } = await params;
  const id = Number(idParam);
  if (!Number.isInteger(id) || id <= 0) notFound();

  const row = await readAwardWinner(id);
  if (!row) notFound();

  const entityKey = row.sourceKey && row.sourceRecordId
    ? awardWinnerEntityKey(row.sourceKey, row.sourceRecordId)
    : null;
  const canEdit = hasCapability(admin, 'data.awards.edit');

  const [clubs, awards, overrides] = await Promise.all([
    listClubs(),
    canEdit ? listAwards() : Promise.resolve([]),
    entityKey ? readHonourOverrides('award_winners', entityKey) : Promise.resolve([]),
  ]);

  const summary = `${row.awardName}${row.season === null ? '' : ` ${row.season}`} — ${row.playerNameRaw}`;

  return (
    <>
      <div className="page-header">
        <AwardsCrumb href={domainListPath('winners')} label="Award winners" />
        <h1>{row.playerNameRaw}</h1>
        <p className="subtitle">
          {row.awardName}{row.season !== null && <> · {row.season}</>}
          {row.clubNameRaw && <> · {row.clubNameRaw}</>}
          {row.playerId !== null && row.playerSlug && (
            <> · <a href={playerPath(row.playerSlug, row.playerId)}>View public page</a></>
          )}
          {' · '}<Link href={`${AWARDS_ROOT}`}>All honours domains</Link>
        </p>
      </div>

      <RecordFacts
        domain="winners"
        rowId={row.id}
        entityKey={entityKey}
        provenance={provenanceOf(row.sourceKey)}
        sourceKey={row.sourceKey}
        sourceRecordId={row.sourceRecordId}
        status={row.status}
        statusReason={row.statusReason}
        updatedAt={row.updatedAt}
        identity={[
          { label: 'Award', value: row.awardName },
          { label: 'Season', value: row.season ?? '—' },
          {
            label: 'Recipient',
            value: row.playerId !== null
              ? <>{row.playerNameRaw} (player #{row.playerId})</>
              : <>{row.playerNameRaw} <span className="muted">— not linked to a player</span></>,
          },
          { label: 'Player link status', value: row.linkStatus },
        ]}
        overrides={overrides}
      />

      {canEdit ? (
        <>
          {row.status === 'active' && <WinnerCorrectionPanel row={row} clubs={clubs} />}
          <LifecyclePanel
            domain="winners"
            rowId={row.id}
            expectedUpdatedAt={row.updatedAt}
            status={row.status}
            statusReason={row.statusReason}
          />
          {row.status === 'active' && (
            <ReplacePanel
              domain="winners"
              rowId={row.id}
              expectedUpdatedAt={row.updatedAt}
              currentSummary={summary}
              awards={awards}
              clubs={clubs}
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
                  <th scope="row">Club</th><td>{row.clubNameRaw ?? '—'}</td>
                  <th scope="row">Votes / statistic</th><td>{row.votes ?? '—'}</td>
                </tr>
                <tr>
                  <th scope="row">Position</th><td>{row.position ?? '—'}</td>
                  <th scope="row">Captaincy</th>
                  <td>
                    {row.isCaptain ? 'Captain' : row.isViceCaptain ? 'Vice-captain' : '—'}
                  </td>
                </tr>
                <tr>
                  <th scope="row">Display order</th><td>{row.sortOrder ?? '—'}</td>
                  <th scope="row">Note</th><td>{row.note ?? '—'}</td>
                </tr>
              </tbody>
            </table>
          </div>
          <p className="muted">
            Correcting, voiding, reinstating and replacing an award winner are Super Admin actions.
          </p>
        </section>
      )}

      <RecordHistory table="award_winners" rowId={row.id} />
    </>
  );
}
