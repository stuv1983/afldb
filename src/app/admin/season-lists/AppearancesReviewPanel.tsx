'use client';

import { useState } from 'react';

import { addSeasonListMemberAction, addSeasonListMembersAction } from '@/app/admin/season-lists/actions';
import { useSeasonListActionSubmit } from '@/app/admin/season-lists/submit-helper';

type Candidate = {
  playerId: number;
  playerSlug: string;
  displayName: string;
  games: number;
  goals: number;
  fromClubSlug: string;
  fromClubName: string;
  candidateSource: string;
};

/**
 * "Not a list — review and add" (AFLDB-ISSUE-161 §23, D-2). A read-only
 * projection of who played for this organisation in the previous season and
 * is not already on this season's list. It is shown ONLY while the previous
 * season has no authoritative list of its own (the caller decides that —
 * this component renders unconditionally once given candidates).
 *
 * Nothing here is written until a Super Admin picks a row: a per-row "Add"
 * calls the singular action with that row's own `candidate_source`
 * (`appearances:<season-1>`, already computed server-side); the optional
 * multi-select "Add selected" is still one explicit reviewed submission
 * (§18's whole-selection transaction), never an automatic seed.
 */
export function AppearancesReviewPanel({
  season, clubSlug, candidates,
}: {
  season: number;
  clubSlug: string;
  candidates: Candidate[];
}) {
  const single = useSeasonListActionSubmit(addSeasonListMemberAction, {});
  const batch = useSeasonListActionSubmit(addSeasonListMembersAction, {});
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const isPending = single.isPending || batch.isPending;

  const toggle = (playerId: number) => setSelected((current) => {
    const next = new Set(current);
    if (next.has(playerId)) next.delete(playerId); else next.add(playerId);
    return next;
  });

  const handleAddOne = (event: React.MouseEvent<HTMLButtonElement>, candidate: Candidate) => {
    const formData = new FormData();
    formData.set('season', String(season));
    formData.set('clubSlug', clubSlug);
    formData.set('playerId', String(candidate.playerId));
    formData.set('candidateSource', candidate.candidateSource);
    single.submit(formData, event.currentTarget);
  };

  const handleAddSelected = (event: React.MouseEvent<HTMLButtonElement>) => {
    if (selected.size === 0) return;
    const formData = new FormData();
    formData.set('season', String(season));
    formData.set('clubSlug', clubSlug);
    for (const playerId of selected) formData.append('playerIds', String(playerId));
    formData.set('candidateSource', `appearances:${season - 1}`);
    batch.submit(formData, event.currentTarget);
  };

  return (
    <section className="section">
      <h2>{season - 1} appearances — not a list, review and add</h2>
      <p className="muted" style={{ fontSize: '0.85rem' }}>
        Players who played for this club in {season - 1} and are not yet on the {season} list.
        This is participation evidence, never a list: nothing below is added to {season} until you
        choose a player explicitly. {season - 1} appearances are never written as membership.
      </p>
      {single.state.error && <p className="notice" role="alert">{single.state.error}</p>}
      {batch.state.error && <p className="notice" role="alert">{batch.state.error}</p>}
      {single.state.ok && single.state.message && <p className="notice" role="status">{single.state.message}</p>}
      {batch.state.ok && batch.state.message && <p className="notice" role="status">{batch.state.message}</p>}
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th scope="col"><span className="visually-hidden">Select</span></th>
              <th scope="col">Player</th>
              <th scope="col" className="num">{season - 1} games</th>
              <th scope="col"></th>
            </tr>
          </thead>
          <tbody>
            {candidates.map((candidate) => (
              <tr key={candidate.playerId}>
                <td>
                  <input
                    type="checkbox"
                    checked={selected.has(candidate.playerId)}
                    onChange={() => toggle(candidate.playerId)}
                    aria-label={`Select ${candidate.displayName}`}
                    disabled={isPending}
                  />
                </td>
                <td>{candidate.displayName}</td>
                <td className="num">{candidate.games}</td>
                <td>
                  <button
                    type="button"
                    className="btn btn-secondary"
                    disabled={isPending}
                    onClick={(event) => handleAddOne(event, candidate)}
                  >
                    Add
                  </button>
                </td>
              </tr>
            ))}
            {candidates.length === 0 && (
              <tr><td colSpan={4} className="muted">No {season - 1} appearances remain unreviewed.</td></tr>
            )}
          </tbody>
        </table>
      </div>
      {candidates.length > 0 && (
        <div style={{ marginTop: '0.6rem' }}>
          <button
            type="button"
            className="btn btn-primary"
            disabled={isPending || selected.size === 0}
            onClick={handleAddSelected}
          >
            {batch.isPending ? 'Adding…' : `Add ${selected.size} selected`}
          </button>
        </div>
      )}
    </section>
  );
}
