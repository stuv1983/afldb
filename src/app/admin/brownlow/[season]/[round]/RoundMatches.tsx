'use client';

import { useState } from 'react';

import type { BrownlowActionState } from '@/app/admin/brownlow/actions';
import type { BrownlowMatchEditorModel } from '@/db/queries/admin-brownlow';

import { MatchVoteEditor } from './MatchVoteEditor';

/**
 * AFLDB-ISSUE-155 Phase C2 — the client shell that owns every match
 * editor's last result.
 *
 * It persists across the revalidation a successful write triggers (React
 * keeps it mounted, only the RSC props under it change), so a confirmation
 * or a refusal message survives the re-render that would otherwise discard
 * it — the Phase B lesson (§26.20 deviation 2). On a success it also moves
 * focus to the next match's first vote selector, so a round can be entered
 * by keyboard alone (§27.26).
 */
export function RoundMatches({
  models,
  season,
  round,
  canFinalise,
}: {
  models: BrownlowMatchEditorModel[];
  season: number;
  round: number;
  /** The viewer holds `data.brownlow.finalise`. */
  canFinalise: boolean;
}) {
  const [results, setResults] = useState<Record<number, BrownlowActionState>>({});

  const order = models.map((model) => model.matchId);

  const setResult = (matchId: number) => (state: BrownlowActionState) => {
    setResults((previous) => ({ ...previous, [matchId]: state }));
  };

  const advanceFrom = (matchId: number) => () => {
    const index = order.indexOf(matchId);
    const nextId = order[index + 1];
    if (nextId === undefined) return;
    if (typeof document === 'undefined') return;
    const card = document.getElementById(`match-${nextId}`);
    if (!card) return;
    card.scrollIntoView({ behavior: 'smooth', block: 'start' });
    card.querySelector<HTMLSelectElement>('select')?.focus();
  };

  return (
    <>
      {models.map((model) => (
        <MatchVoteEditor
          key={model.matchId}
          model={model}
          season={season}
          round={round}
          canFinalise={canFinalise}
          result={results[model.matchId] ?? null}
          onResult={setResult(model.matchId)}
          onAdvance={advanceFrom(model.matchId)}
        />
      ))}
    </>
  );
}
