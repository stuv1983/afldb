import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';

import { RecordHistory } from '@/app/admin/awards/RecordHistory';
import {
  FAMILY_PUBLIC_PATHS, RECORDS_ROOT, durableIdentityOf, familyListPath,
} from '@/app/admin/records/labels';
import { RecordsCrumb, SpecialRecordFacts } from '@/app/admin/records/SpecialRecordFacts';
import { provenanceOf, readFirstKickGoal } from '@/db/queries/admin-special-records';
import { requireCapability } from '@/lib/auth/session';
import { clubPath, matchPath, seasonPath } from '@/lib/format';

export const metadata: Metadata = {
  title: 'First-kick-goal record',
  robots: { index: false, follow: false },
};
export const dynamic = 'force-dynamic';

/**
 * `/admin/records/first-kick-goal/[id]` — one first-kick-goal record
 * (AFLDB-ISSUE-167 §10.2).
 *
 * The player, the club, the season and the round appear under "What this
 * record asserts" because together they are what the record claims; the source
 * record id beside them is its durable identity. None of it is editable here,
 * and after Stage 6 none of it will be editable at all: a wrong identity is a
 * void plus a manual replacement, never a rekey (that is P10's).
 *
 * `match_id` is DERIVED (§3.4.1) and is shown in the recorded detail rather
 * than beside the identity: it is resolved from the season, the round and the
 * clubs, and `kickless_matches_before_first_kick` is the input that moves it.
 * Presenting it as a fact of its own would invite an administrator to think it
 * could be set.
 */
export default async function FirstKickGoalDetailPage(
  { params }: { params: Promise<{ id: string }> },
) {
  await requireCapability('data.specialRecords.read');
  const { id: idParam } = await params;
  const id = Number(idParam);
  if (!Number.isInteger(id) || id <= 0) notFound();

  const row = await readFirstKickGoal(id);
  if (!row) notFound();

  const entityKey = durableIdentityOf(row.sourceKey, row.sourceRecordId);

  return (
    <>
      <div className="page-header">
        <RecordsCrumb href={familyListPath('first-kick-goal')} label="First-kick goal" />
        <h1>{row.playerDisplayName ?? row.playerNameRaw}</h1>
        <p className="subtitle">
          First-kick goal · {row.season} · {row.roundRaw}
          {' · '}<Link href={RECORDS_ROOT}>All special records</Link>
          {' · '}<Link href={FAMILY_PUBLIC_PATHS['first-kick-goal']}>Public page</Link>
        </p>
      </div>

      <SpecialRecordFacts
        rowId={row.id}
        entityKey={entityKey}
        provenance={provenanceOf(row.sourceKey)}
        sourceKey={row.sourceKey}
        sourceRecordId={row.sourceRecordId}
        importBatchId={row.importBatchId}
        importedAt={row.importedAt}
        status={row.status}
        statusReason={row.statusReason}
        updatedAt={row.updatedAt}
        identity={[
          { label: 'Player as the source wrote it', value: row.playerNameRaw },
          { label: 'Club as the source wrote it', value: row.clubNameRaw },
          {
            label: 'Season',
            value: <Link href={seasonPath(row.season)}>{row.season}</Link>,
          },
          { label: 'Round', value: row.roundRaw },
          { label: 'Achievement', value: row.achievementType },
        ]}
        link={{
          status: row.linkStatus,
          candidateCount: row.candidateCount,
          playerId: row.playerId,
          playerSlug: row.playerSlug,
          playerDisplayName: row.playerDisplayName,
          playerNameRaw: row.playerNameRaw,
        }}
      />

      <section className="section">
        <h2>Recorded detail</h2>
        <div className="table-wrap">
          <table>
            <tbody>
              <tr>
                <th scope="row">Resolved club</th>
                <td>
                  {row.clubId !== null && row.clubSlug
                    ? <Link href={clubPath(row.clubSlug)}>{row.clubName}</Link>
                    : <span className="muted">not resolved — the source spelling stands</span>}
                </td>
                <th scope="row">Resolved match</th>
                <td>
                  {row.matchId !== null
                    ? <Link href={matchPath(row.matchId)}>{row.matchDate ?? `match #${row.matchId}`}</Link>
                    : <span className="muted">not resolved</span>}
                </td>
              </tr>
              <tr>
                <th scope="row">Consecutive goal kicks</th>
                <td>{row.consecutiveGoalKicks}</td>
                <th scope="row">Kickless matches before the first kick</th>
                <td>{row.kicklessMatchesBeforeFirstKick}</td>
              </tr>
              <tr>
                <th scope="row">No further career goals</th>
                <td>{row.noFurtherCareerGoals ? 'Yes' : 'No'}</td>
                <th scope="row">No further career kicks</th>
                <td>{row.noFurtherCareerKicks ? 'Yes' : 'No'}</td>
              </tr>
              <tr>
                <th scope="row">Season footnote</th>
                <td>{row.seasonFootnoteRaw ?? '—'}</td>
                <th scope="row">Source annotation</th>
                <td>{row.sourceAnnotation ?? '—'}</td>
              </tr>
              <tr>
                <th scope="row">Notes</th>
                <td colSpan={3}>{row.notes ?? '—'}</td>
              </tr>
            </tbody>
          </table>
        </div>
        <p className="muted" style={{ fontSize: '0.85rem' }}>
          The resolved match is derived from the season, the round and the clubs, with the
          kickless-match count as its input — it is not a field of this record. The source
          annotation is the marker the source itself carried, kept beside the value decoded from
          it so the evidence and the decision stay separately visible.
        </p>
      </section>

      <RecordHistory table="player_achievements" rowId={row.id} />
    </>
  );
}
