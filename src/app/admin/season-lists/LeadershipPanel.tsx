'use client';

import Link from 'next/link';
import { useState } from 'react';

import { AppointLeaderPanel } from '@/app/admin/season-lists/AppointLeaderPanel';
import { LeadershipActions } from '@/app/admin/season-lists/LeadershipActions';
import { LEADERSHIP_ROLE_LABELS } from '@/app/admin/season-lists/leadership-labels';
import type { ClubSeasonLeadershipRow, LeadershipRole } from '@/db/queries/admin-club-leadership';
import { playerPath } from '@/lib/format';

type Candidate = { playerId: number; displayName: string; activeLeadershipRole: LeadershipRole | null };

/**
 * The club-season Leadership section (AFLDB-ISSUE-163 §18, D-11): a
 * "Current" list of active appointments, a collapsed "History" list of
 * ended appointments with void appointments nested under their own "show
 * voided" toggle, and the Appoint panel. Admin sees this whole section
 * read-only; Super Admin additionally sees every lifecycle control
 * (`LeadershipActions`) and the Appoint panel.
 *
 * `rows` is `readClubSeasonLeadership()` verbatim — every appointment for
 * this club-season, active, ended and void, already ordered current-first
 * (§17). Nothing here re-derives "current"; it only groups what the query
 * already decided.
 */
export function LeadershipPanel({
  season, clubSlug, canEdit, rows, members,
}: {
  season: number;
  clubSlug: string;
  canEdit: boolean;
  rows: ClubSeasonLeadershipRow[];
  members: Candidate[];
}) {
  const [showVoided, setShowVoided] = useState(false);

  const active = rows.filter((r) => r.status === 'active');
  const ended = rows.filter((r) => r.status === 'ended');
  const voided = rows.filter((r) => r.status === 'void');
  const activeCaptains = active.filter((r) => r.role === 'captain');
  const activeViceCaptains = active.filter((r) => r.role === 'vice_captain');

  const candidatesExcluding = (playerId: number): Candidate[] =>
    members.filter((m) => m.playerId !== playerId);

  const renderRow = (row: ClubSeasonLeadershipRow, options: { showDates: boolean }) => (
    <li key={row.id} style={{ display: 'grid', gap: '0.2rem', padding: '0.4rem 0', borderTop: '1px solid var(--border, #ddd)' }}>
      <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'baseline', flexWrap: 'wrap' }}>
        <Link href={playerPath(row.playerSlug, row.playerId)}>{row.displayName}</Link>
        <span className="muted" style={{ fontSize: '0.8rem' }}>{LEADERSHIP_ROLE_LABELS[row.role]}</span>
        {!row.listed && <span className="badge badge-warn">Not on the {season} list</span>}
        {row.status === 'void' && <span className="badge badge-danger">Void</span>}
        <Link href={`/admin/audit/entity/club_leadership/${row.id}`} style={{ fontSize: '0.8rem' }}>
          Audit trail
        </Link>
      </div>
      {options.showDates && (
        <p className="muted" style={{ fontSize: '0.8rem', margin: 0 }}>
          {row.startedOn ? `From ${row.startedOn}` : 'Start date not recorded'}
          {row.status !== 'active' && (row.endedOn ? ` to ${row.endedOn}` : ' — end date not recorded')}
          {row.statusReason && ` — ${row.statusReason}`}
          {row.note && ` · ${row.note}`}
        </p>
      )}
      {canEdit && (
        <LeadershipActions
          appointmentKey={row.appointmentKey}
          role={row.role}
          status={row.status}
          expectedUpdatedAt={row.updatedAt}
          startedOn={row.startedOn}
          endedOn={row.endedOn}
          note={row.note}
          candidates={candidatesExcluding(row.playerId)}
        />
      )}
    </li>
  );

  return (
    <>
      <section className="section">
        <h2>Leadership</h2>
        {rows.length === 0 ? (
          <p className="muted">No leadership recorded for {season} yet.</p>
        ) : (
          <>
            <h3 style={{ fontSize: '0.95rem' }}>Current</h3>
            {active.length === 0 ? (
              <p className="muted" style={{ fontSize: '0.85rem' }}>No active appointment recorded.</p>
            ) : (
              <>
                {activeCaptains.length > 0 && (
                  <div>
                    <p className="section-note" style={{ margin: '0.3rem 0' }}>
                      {activeCaptains.length > 1 ? 'Co-captains' : 'Captain'}
                    </p>
                    <ul style={{ listStyle: 'none', margin: 0, padding: 0 }}>
                      {activeCaptains.map((row) => renderRow(row, { showDates: true }))}
                    </ul>
                  </div>
                )}
                {activeViceCaptains.length > 0 && (
                  <div>
                    <p className="section-note" style={{ margin: '0.3rem 0' }}>
                      {activeViceCaptains.length > 1 ? 'Vice-captains' : 'Vice-captain'}
                    </p>
                    <ul style={{ listStyle: 'none', margin: 0, padding: 0 }}>
                      {activeViceCaptains.map((row) => renderRow(row, { showDates: true }))}
                    </ul>
                  </div>
                )}
              </>
            )}

            {(ended.length > 0 || voided.length > 0) && (
              <details style={{ marginTop: '0.6rem' }}>
                <summary style={{ cursor: 'pointer', fontSize: '0.9rem' }}>
                  History ({ended.length + voided.length})
                </summary>
                {ended.length > 0 && (
                  <ul style={{ listStyle: 'none', margin: '0.4rem 0 0', padding: 0 }}>
                    {ended.map((row) => renderRow(row, { showDates: true }))}
                  </ul>
                )}
                {voided.length > 0 && (
                  <div style={{ marginTop: '0.5rem' }}>
                    <button
                      type="button"
                      className="btn btn-secondary"
                      onClick={() => setShowVoided((value) => !value)}
                      aria-expanded={showVoided}
                    >
                      {showVoided ? 'Hide voided appointments' : `Show voided appointments (${voided.length})`}
                    </button>
                    {showVoided && (
                      <ul style={{ listStyle: 'none', margin: '0.4rem 0 0', padding: 0 }}>
                        {voided.map((row) => renderRow(row, { showDates: true }))}
                      </ul>
                    )}
                  </div>
                )}
              </details>
            )}
          </>
        )}
      </section>

      {canEdit && <AppointLeaderPanel season={season} clubSlug={clubSlug} candidates={members} />}
    </>
  );
}
