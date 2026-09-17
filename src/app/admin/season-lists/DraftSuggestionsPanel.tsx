'use client';

import { addSeasonListMemberAction } from '@/app/admin/season-lists/actions';
import { useSeasonListActionSubmit } from '@/app/admin/season-lists/submit-helper';

type Candidate = {
  playerId: number;
  playerSlug: string;
  displayName: string;
  draftPickId: number;
  draftYear: number;
  draftKind: string | null;
  pickNumber: number | null;
};

/**
 * The draftee suggestion panel (AFLDB-ISSUE-161 §14): draft selections by
 * this club in the previous or current season whose player is not yet on
 * this season's list. Each "Add" is a single explicit decision carrying
 * `candidate_source = 'draft:<pick id>'` as evidence, never a bulk seed —
 * exactly the same `addSeasonListMember` primitive the search-based Add
 * panel and the ISSUE-160 handoff use.
 */
export function DraftSuggestionsPanel({
  season, clubSlug, candidates,
}: {
  season: number;
  clubSlug: string;
  candidates: Candidate[];
}) {
  const add = useSeasonListActionSubmit(addSeasonListMemberAction, {});

  const handleAdd = (event: React.MouseEvent<HTMLButtonElement>, candidate: Candidate) => {
    const formData = new FormData();
    formData.set('season', String(season));
    formData.set('clubSlug', clubSlug);
    formData.set('playerId', String(candidate.playerId));
    formData.set('candidateSource', `draft:${candidate.draftPickId}`);
    add.submit(formData, event.currentTarget);
  };

  return (
    <section className="section">
      <h2>Draft selections not yet listed</h2>
      <p className="muted" style={{ fontSize: '0.85rem' }}>
        Selections by this club in {season - 1} or {season} whose player is not on the {season}
        list. Adding here is the same explicit, audited decision as anywhere else on this page.
      </p>
      {add.state.error && <p className="notice" role="alert">{add.state.error}</p>}
      {add.state.ok && add.state.message && <p className="notice" role="status">{add.state.message}</p>}
      <ul style={{ margin: '0.4rem 0 0', paddingLeft: '1.2rem' }}>
        {candidates.map((candidate) => (
          <li key={candidate.draftPickId} style={{ margin: '0.3rem 0' }}>
            {candidate.displayName} — {candidate.draftYear} {candidate.draftKind ?? '—'}
            {candidate.pickNumber !== null ? ` (pick ${candidate.pickNumber})` : ''}{' '}
            <button
              type="button"
              className="btn btn-secondary"
              disabled={add.isPending}
              onClick={(event) => handleAdd(event, candidate)}
            >
              Add
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}
