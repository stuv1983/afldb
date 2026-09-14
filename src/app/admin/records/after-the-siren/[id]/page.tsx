import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';

import { RecordHistory } from '@/app/admin/awards/RecordHistory';
import {
  FAMILY_PUBLIC_PATHS, RECORDS_ROOT, durableIdentityOf, familyListPath,
} from '@/app/admin/records/labels';
import { AfterSirenCorrectionPanel } from '@/app/admin/records/AfterSirenCorrectionPanel';
import { RecordsCrumb, SpecialRecordFacts } from '@/app/admin/records/SpecialRecordFacts';
import { SpecialRecordLifecyclePanel } from '@/app/admin/records/SpecialRecordLifecyclePanel';
import { SpecialRecordReplacePanel } from '@/app/admin/records/SpecialRecordReplacePanel';
import { provenanceOf, readAfterSirenKick } from '@/db/queries/admin-special-records';
import { hasCapability } from '@/lib/auth/capabilities';
import { requireCapability } from '@/lib/auth/session';
import { clubPath, matchPath, seasonPath } from '@/lib/format';

export const metadata: Metadata = {
  title: 'After-the-siren record',
  robots: { index: false, follow: false },
};
export const dynamic = 'force-dynamic';

const EFFECT_SENTENCES: Record<string, string> = {
  won: 'won the match',
  drew: 'drew the match',
  none: 'changed nothing',
};

/**
 * `/admin/records/after-the-siren/[id]` — one kick after the siren
 * (AFLDB-ISSUE-167 §10.2).
 *
 * FIVE FIELDS THAT CANNOT MOVE INDEPENDENTLY, shown together for that reason:
 * `kick_scored`, `kick_effect`, `kicker_result`, `siren` and the margin
 * arithmetic over `kicker_points` / `opponent_points` are coupled by migration
 * 089's `_effect_ck`, `_regulation_ck` and `_points_ck`. Stage 6's correction
 * panel edits them as one group and validates the whole combination -- in the
 * panel, again in the action, and finally in the CHECK constraints themselves
 * -- from one pure rule module, so a refused combination reads as a sentence
 * about football rather than a constraint name (§10.3).
 *
 * `cited` IS NOT LIFECYCLE (gate G-3). It says the SOURCE carried no reference
 * for a kick that happened, which is an evidence gap kept rather than dropped.
 * It appears in the recorded detail beside the score, never beside the status,
 * and the two must never share a control.
 *
 * `club_id` is DERIVED (§3.4.1): the kicker's club is resolved from the source
 * spelling, so it sits in the recorded detail rather than among the identity
 * facts, which carry the source's own words.
 */
export default async function AfterTheSirenDetailPage(
  { params }: { params: Promise<{ id: string }> },
) {
  const admin = await requireCapability('data.specialRecords.read');
  const { id: idParam } = await params;
  const id = Number(idParam);
  if (!Number.isInteger(id) || id <= 0) notFound();

  const row = await readAfterSirenKick(id);
  if (!row) notFound();

  const entityKey = durableIdentityOf(row.sourceKey, row.sourceRecordId);
  const margin = row.kickerPoints - row.opponentPoints;
  // Furniture, not a gate -- the boundary is requireCapability() inside every
  // action in `src/app/admin/records/actions.ts`, which a direct POST reaches.
  const canEdit = hasCapability(admin, 'data.specialRecords.edit');
  const summary = `${row.playerDisplayName ?? row.playerNameRaw} -- after the siren, `
    + `${row.season} ${row.roundRaw} v ${row.opponentNameRaw} `
    + `(${row.sourceRecordId ?? `#${row.id}`})`;

  return (
    <>
      <div className="page-header">
        <RecordsCrumb href={familyListPath('after-the-siren')} label="After the siren" />
        <h1>{row.playerDisplayName ?? row.playerNameRaw}</h1>
        <p className="subtitle">
          {row.kickScored === 'none' ? 'Missed' : `Kicked a ${row.kickScored}`} after the{' '}
          {row.siren === 'final' ? 'siren' : row.siren.replace(/_/g, ' ')} and{' '}
          {EFFECT_SENTENCES[row.kickEffect] ?? row.kickEffect} · {row.season} · {row.roundRaw}
          {' · '}<Link href={RECORDS_ROOT}>All special records</Link>
          {' · '}<Link href={FAMILY_PUBLIC_PATHS['after-the-siren']}>Public page</Link>
        </p>
      </div>

      {!row.cited && (
        <section className="section">
          <p className="notice" role="note">
            The source carried no reference for this kick. That is an evidence gap recorded
            rather than dropped — the kick is treated as having happened, the record is active,
            and it appears on the public site exactly as every other does. It is not, and must
            never be read as, a voided record.
          </p>
        </section>
      )}

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
          { label: 'Kicker as the source wrote it', value: row.playerNameRaw },
          { label: 'Club as the source wrote it', value: row.clubNameRaw },
          { label: 'Opponent as the source wrote it', value: row.opponentNameRaw },
          {
            label: 'Season',
            value: <Link href={seasonPath(row.season)}>{row.season}</Link>,
          },
          { label: 'Round', value: row.roundRaw },
          { label: 'Competition', value: row.competition },
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
        <h2>The kick</h2>
        <div className="table-wrap">
          <table>
            <tbody>
              <tr>
                <th scope="row">What it registered</th>
                <td>{row.kickScored}{row.shotDetail ? ` (${row.shotDetail})` : ''}</td>
                <th scope="row">What it did to the result</th>
                <td>{EFFECT_SENTENCES[row.kickEffect] ?? row.kickEffect}</td>
              </tr>
              <tr>
                <th scope="row">Which siren</th>
                <td>{row.siren.replace(/_/g, ' ')}</td>
                <th scope="row">Result from the kicker&rsquo;s side</th>
                <td>{row.kickerResult}</td>
              </tr>
              <tr>
                <th scope="row">Final score as the source states it</th>
                <td>{row.kickerScoreRaw} to {row.opponentScoreRaw}</td>
                <th scope="row">Points, and the margin</th>
                <td>
                  {row.kickerPoints}–{row.opponentPoints}
                  {' '}<span className="muted" style={{ fontSize: '0.8rem' }}>
                    ({margin === 0 ? 'level' : `${margin > 0 ? '+' : ''}${margin}`})
                  </span>
                </td>
              </tr>
              <tr>
                <th scope="row">Supergoal scoring</th>
                <td>{row.supergoalScoring ? 'Yes' : 'No'}</td>
                <th scope="row">Cited by the source</th>
                <td>{row.cited ? 'Yes' : 'No reference carried'}</td>
              </tr>
            </tbody>
          </table>
        </div>
        <p className="muted" style={{ fontSize: '0.85rem' }}>
          These five facts are coupled by the constraints migration 089 wrote: a kick that won
          the match was a win by at most a goal, a kick that drew it left the scores level, and a
          kick before extra time could not have decided anything. They cannot be corrected
          independently of one another.
        </p>
      </section>

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
                <th scope="row">Resolved opponent</th>
                <td>
                  {row.opponentClubId !== null && row.opponentSlug
                    ? <Link href={clubPath(row.opponentSlug)}>{row.opponentName}</Link>
                    : <span className="muted">not resolved</span>}
                </td>
              </tr>
              <tr>
                <th scope="row">Premiership season</th>
                <td>{row.premiershipSeason ? 'Yes' : `No — ${row.competition}`}</td>
                <th scope="row">Resolved match</th>
                <td>
                  {row.matchId !== null
                    ? <Link href={matchPath(row.matchId)}>{row.matchDate ?? `match #${row.matchId}`}</Link>
                    : (
                      <span className="muted">
                        {row.premiershipSeason ? 'not resolved' : 'none — this competition has no match rows'}
                      </span>
                    )}
                </td>
              </tr>
              <tr>
                <th scope="row">Source annotation</th>
                <td colSpan={3}>{row.sourceAnnotation ?? '—'}</td>
              </tr>
              <tr>
                <th scope="row">Notes</th>
                <td colSpan={3}>{row.notes ?? '—'}</td>
              </tr>
            </tbody>
          </table>
        </div>
        <p className="muted" style={{ fontSize: '0.85rem' }}>
          Only premiership-season rows can carry a match: pre-season and night-series kicks keep
          their competition name and resolve to no match by design, so an empty match there is
          the model working rather than a gap.
        </p>
      </section>

      {canEdit ? (
        <>
          <AfterSirenCorrectionPanel row={row} />
          <SpecialRecordLifecyclePanel
            family="after-the-siren"
            rowId={row.id}
            expectedUpdatedAt={row.updatedAt}
            status={row.status}
            statusReason={row.statusReason}
          />
          {row.status === 'active' && (
            <SpecialRecordReplacePanel
              family="after-the-siren"
              rowId={row.id}
              expectedUpdatedAt={row.updatedAt}
              currentSummary={summary}
            />
          )}
        </>
      ) : (
        <p className="muted">
          Correcting, suppressing, reinstating, replacing and creating a special record are Super
          Admin actions.
        </p>
      )}

      <RecordHistory table="after_siren_kicks" rowId={row.id} />
    </>
  );
}
