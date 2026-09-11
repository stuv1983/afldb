'use client';

import { useRouter } from 'next/navigation';
import { startTransition, useActionState } from 'react';

import { useActionFocusRestore } from '@/app/admin/brownlow/focus-restore';

/**
 * The one submit helper every coach admin panel dispatches through
 * (AFLDB-ISSUE-159 §9 interaction contract).
 *
 * `useActionState` + `startTransition`, exactly as
 * `src/app/admin/brownlow/[season]/[round]/MatchVoteEditor.tsx` establishes
 * and for the same two reasons: these are async actions invoked from a click
 * handler rather than a native form submission, so React requires the
 * transition for `isPending` to be reliable; and every action control hands
 * its own element to `useActionFocusRestore` before dispatch, because
 * disabling the control that has focus drops focus to `document.body`, and a
 * refusal leaves a keyboard operator stranded there (§27.27 H-1).
 *
 * S-6 (binding, §9): a Server Action here must never call `revalidatePath`
 * itself — that hung the Next 15.5 client and is why the player-links fix
 * moved it out. Revalidation instead runs AFTER the action resolves, in the
 * browser: a successful result names the public paths it changed
 * (`revalidatePaths`), which this helper posts to the dedicated
 * `/admin/coaches/revalidate` route in a plain follow-up `fetch` — a second
 * request, after the action's own response, never inside it. `router.refresh()`
 * covers the admin surface itself (`force-dynamic`, so a fresh request is all
 * it needs).
 */
export type CoachActionState = {
  ok?: boolean;
  message?: string;
  error?: string;
  needsConfirmation?: boolean;
  candidates?: { coachId: number; label: string; reason: string }[];
  /** Public paths this action changed, computed server-side. Never client-supplied. */
  revalidatePaths?: string[];
};

async function postRevalidate(paths: string[]): Promise<void> {
  if (paths.length === 0) return;
  try {
    await fetch('/admin/coaches/revalidate', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ paths }),
    });
  } catch {
    // Best-effort: the canonical write already committed. A missed
    // invalidation leaves a public page stale until its ISR window expires
    // (the same accepted limitation brownlow's actions.ts documents for the
    // paths it does not fan out across workers), never an inconsistent write.
  }
}

export function useCoachActionSubmit(
  action: (previous: CoachActionState, formData: FormData) => Promise<CoachActionState>,
): { state: CoachActionState; isPending: boolean; submit: (formData: FormData, origin: HTMLElement | null) => void } {
  const router = useRouter();

  const wrapped = async (previous: CoachActionState, formData: FormData): Promise<CoachActionState> => {
    const result = await action(previous, formData);
    if (result.ok) {
      await postRevalidate(result.revalidatePaths ?? []);
      router.refresh();
    }
    return result;
  };

  const [state, dispatch, isPending] = useActionState<CoachActionState, FormData>(wrapped, {});
  const captureFocusOrigin = useActionFocusRestore(isPending);

  const submit = (formData: FormData, origin: HTMLElement | null): void => {
    captureFocusOrigin(origin);
    startTransition(() => dispatch(formData));
  };

  return { state, isPending, submit };
}
