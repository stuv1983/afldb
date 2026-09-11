'use client';

import { useRouter } from 'next/navigation';
import { startTransition, useActionState } from 'react';

import { useActionFocusRestore } from '@/app/admin/brownlow/focus-restore';

/**
 * The one submit helper every admin action panel dispatches through
 * (AFLDB-ISSUE-160 D-9), extracted from the ISSUE-159 coach precedent
 * (`src/app/admin/coaches/submit-helper.ts`, which now wraps this).
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
 * S-6 (binding): a Server Action must never call `revalidatePath` itself —
 * that hung the Next 15.5 client and is why the player-links fix moved it
 * out. Revalidation instead runs AFTER the action resolves, in the browser: a
 * successful result names the public paths it changed (`revalidatePaths`),
 * which this helper posts to the caller's own domain-specific, capability
 * -gated, allowlisted revalidate route in a plain follow-up `fetch` — a
 * second request, after the action's own response, never inside it.
 * `router.refresh()` covers the admin surface itself (every admin page here
 * is `force-dynamic`, so a fresh request is all it needs).
 */
export type AdminActionState = {
  ok?: boolean;
  message?: string;
  error?: string;
  /** Public paths this action changed, computed server-side. Never client-supplied. */
  revalidatePaths?: string[];
};

async function postRevalidate(endpoint: string, paths: string[]): Promise<void> {
  if (paths.length === 0) return;
  try {
    await fetch(endpoint, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ paths }),
    });
  } catch {
    // Best-effort: the canonical write already committed. A missed
    // invalidation leaves a public page stale until its ISR window expires,
    // never an inconsistent write.
  }
}

export function useAdminActionSubmit<State extends AdminActionState>(
  action: (previous: State, formData: FormData) => Promise<State>,
  options: { revalidateEndpoint: string; initialState: State },
): { state: State; isPending: boolean; submit: (formData: FormData, origin: HTMLElement | null) => void } {
  const router = useRouter();

  // useActionState's own generic resolves `Awaited<State>`, which does not
  // simplify back to `State` for a caller-supplied generic bound even though
  // every real `State` here is a plain, never-a-Promise object shape.
  // Instantiating against the concrete `AdminActionState` sidesteps that and
  // casting back out is safe: `action`/`options.initialState` are already
  // typed against the caller's own `State`, so the values React actually
  // carries are never anything else.
  const wrapped = async (previous: AdminActionState, formData: FormData): Promise<AdminActionState> => {
    const result = await action(previous as State, formData);
    if (result.ok) {
      await postRevalidate(options.revalidateEndpoint, result.revalidatePaths ?? []);
      router.refresh();
    }
    return result;
  };

  const [state, dispatch, isPending] = useActionState<AdminActionState, FormData>(wrapped, options.initialState);
  const captureFocusOrigin = useActionFocusRestore(isPending);

  const submit = (formData: FormData, origin: HTMLElement | null): void => {
    captureFocusOrigin(origin);
    startTransition(() => dispatch(formData));
  };

  return { state: state as State, isPending, submit };
}
