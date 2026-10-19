'use client';

import { useRouter } from 'next/navigation';
import { startTransition, useActionState, type FormEvent } from 'react';

import { recordBrownlowEligibilityAction } from '../brownlow/actions';
import type { BrownlowEligibilityActionState } from '../brownlow/action-state';

import { DecisionWorkbenchView, type ReviewPlayerView } from './BrownlowDeterminationViews';

/**
 * The Client Component wrapper of the Brownlow eligibility decision forms (AFLDB V2 Launch F F-D).
 *
 * ONE `useActionState` serves every player's form on the page, and the component stays mounted
 * across `router.refresh()` (same tree position), so the outcome of a decision - including the
 * RECOMPUTED determination - is still on screen after the page underneath it has changed (the
 * decided player is usually no longer in the review list). Same pattern as
 * `OperationsClientForms.tsx`: the submit is intercepted and dispatched in a transition, the form is
 * NOT reset on a refusal (a rejected note is not lost), and after a success the route is refreshed.
 * There is no `revalidatePath` anywhere near a Server Action (it hangs the client here); the page
 * is `force-dynamic`, so a refresh is all it needs.
 *
 * Only erased types, the action reference and pure views are imported: no server-only module can
 * reach the browser through this file.
 */

export function BrownlowDecisionWorkbench({
  season, players, canDecide, actingEmail, sealedSeason,
}: {
  season: number;
  players: readonly ReviewPlayerView[];
  canDecide: boolean;
  actingEmail: string;
  sealedSeason: boolean | null;
}) {
  const router = useRouter();
  const wrapped = async (
    previous: BrownlowEligibilityActionState,
    formData: FormData,
  ): Promise<BrownlowEligibilityActionState> => {
    const result = await recordBrownlowEligibilityAction(previous, formData);
    if (result.ok === true) {
      try {
        const response = await fetch('/admin/operations/brownlow/revalidate', { method: 'POST' });
        if (!response.ok) return { ...result, message: `${result.message} Public cache refresh failed; reload before checking the public result.` };
      } catch {
        return { ...result, message: `${result.message} Public cache refresh failed; reload before checking the public result.` };
      }
      router.refresh();
    }
    return result;
  };
  const [state, dispatch, pending] = useActionState<BrownlowEligibilityActionState, FormData>(wrapped, {});

  const onSubmit = (event: FormEvent<HTMLFormElement>): void => {
    event.preventDefault();
    const form = event.currentTarget;
    const submitter = (event.nativeEvent as SubmitEvent).submitter;
    const data = submitter instanceof HTMLElement ? new FormData(form, submitter) : new FormData(form);
    startTransition(() => dispatch(data));
  };

  return (
    <DecisionWorkbenchView
      season={season}
      players={players}
      canDecide={canDecide}
      actingEmail={actingEmail}
      sealedSeason={sealedSeason}
      binding={{ state, pending, onSubmit }}
    />
  );
}
