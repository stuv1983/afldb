'use client';

import { useState } from 'react';

import { clearCoachAssignmentAction, setCoachAssignmentAction } from '@/app/admin/coaches/actions';
import { useCoachActionSubmit } from '@/app/admin/coaches/submit-helper';
import type { ClubSeasonMatchRow } from '@/db/queries/admin-coaches';

/**
 * Panel 4 of `/admin/coaches/[id]` (§9.4): bounded by construction. A club
 * and a season are chosen through a plain GET form (server-rendered, like
 * every other filter in this admin area), which is what keeps this a finite
 * list rather than a free grid over 33,676 team-matches. "Apply to every
 * listed match" expands into `setCoachAssignmentAction`'s plural
 * `assignments` field, one transaction for the whole selection (§9.4).
 */
export function AssignmentPanel({
  coachId,
  clubOptions,
  selectedClubId,
  selectedSeason,
  rows,
}: {
  coachId: number;
  clubOptions: { id: number; slug: string; name: string }[];
  selectedClubId: number | null;
  selectedSeason: number | null;
  rows: ClubSeasonMatchRow[];
}) {
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const setAssignment = useCoachActionSubmit(setCoachAssignmentAction);
  const clearAssignment = useCoachActionSubmit(clearCoachAssignmentAction);
  const isPending = setAssignment.isPending || clearAssignment.isPending;

  const toggle = (matchId: number) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(matchId)) next.delete(matchId); else next.add(matchId);
      return next;
    });
  };

  const submitSet = (event: React.MouseEvent<HTMLButtonElement>, pairs: string) => {
    const formData = new FormData();
    formData.set('coachId', String(coachId));
    formData.set('assignments', pairs);
    setAssignment.submit(formData, event.currentTarget);
  };

  const submitClear = (event: React.MouseEvent<HTMLButtonElement>, matchId: number, clubId: number) => {
    const formData = new FormData();
    formData.set('matchId', String(matchId));
    formData.set('clubId', String(clubId));
    clearAssignment.submit(formData, event.currentTarget);
  };

  const selectedPairs = rows
    .filter((r) => selected.has(r.matchId))
    .map((r) => `${r.matchId}:${selectedClubId}`)
    .join(',');

  return (
    <section className="section">
      <h2>Coaching assignments</h2>
      <form method="GET" style={{ display: 'flex', gap: '0.6rem', alignItems: 'flex-end', flexWrap: 'wrap' }}>
        <label style={{ display: 'grid', gap: '0.2rem', fontSize: '0.85rem' }}>
          Club
          <select name="assignClub" defaultValue={selectedClubId ?? ''}>
            <option value="">— choose a club —</option>
            {clubOptions.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        </label>
        <label style={{ display: 'grid', gap: '0.2rem', fontSize: '0.85rem' }}>
          Season
          <input type="number" name="assignSeason" defaultValue={selectedSeason ?? ''} min={1897} max={2200} style={{ width: '6rem' }} />
        </label>
        <button type="submit" className="button">Show matches</button>
      </form>

      {selectedClubId !== null && selectedSeason !== null && (
        rows.length === 0 ? (
          <p className="muted">No matches for that club and season.</p>
        ) : (
          <>
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th scope="col">
                      <input
                        type="checkbox"
                        aria-label="Select all listed matches"
                        checked={selected.size === rows.length && rows.length > 0}
                        onChange={(event) => setSelected(event.target.checked ? new Set(rows.map((r) => r.matchId)) : new Set())}
                      />
                    </th>
                    <th scope="col">Date</th>
                    <th scope="col">Round</th>
                    <th scope="col">Match</th>
                    <th scope="col">Current coach</th>
                    <th scope="col">Source</th>
                    <th scope="col" />
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r) => (
                    <tr key={r.matchId}>
                      <td>
                        <input
                          type="checkbox"
                          checked={selected.has(r.matchId)}
                          onChange={() => toggle(r.matchId)}
                          aria-label={`Select ${r.homeClubName} v ${r.awayClubName}`}
                        />
                      </td>
                      <td className="nowrap">{r.matchDate}</td>
                      <td className="nowrap">{r.roundCode}</td>
                      <td>{r.homeClubName} v {r.awayClubName}</td>
                      <td>{r.currentCoachName ?? '—'}</td>
                      <td>{r.currentSourceKey ?? '—'}</td>
                      <td className="nowrap">
                        <button
                          type="button"
                          className="btn btn-secondary"
                          onClick={(event) => submitSet(event, `${r.matchId}:${selectedClubId}`)}
                          disabled={isPending}
                        >
                          Set
                        </button>
                        {r.currentSourceKey === 'manual_admin_edit' && (
                          <button
                            type="button"
                            className="btn btn-secondary"
                            onClick={(event) => submitClear(event, r.matchId, selectedClubId)}
                            disabled={isPending}
                          >
                            Clear override
                          </button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <button
              type="button"
              className="btn btn-primary"
              disabled={isPending || selected.size === 0}
              onClick={(event) => submitSet(event, selectedPairs)}
            >
              {setAssignment.isPending ? 'Applying…' : `Apply to ${selected.size} selected match(es)`}
            </button>
          </>
        )
      )}
      {setAssignment.state.error && <p className="notice" role="alert">{setAssignment.state.error}</p>}
      {setAssignment.state.ok && setAssignment.state.message && <p className="notice" role="status">{setAssignment.state.message}</p>}
      {clearAssignment.state.error && <p className="notice" role="alert">{clearAssignment.state.error}</p>}
      {clearAssignment.state.ok && clearAssignment.state.message && <p className="notice" role="status">{clearAssignment.state.message}</p>}
    </section>
  );
}
