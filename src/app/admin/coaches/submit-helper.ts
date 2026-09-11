'use client';

import { type AdminActionState, useAdminActionSubmit } from '@/components/admin/action-submit';

/**
 * The one submit helper every coach admin panel dispatches through
 * (AFLDB-ISSUE-159 §9 interaction contract).
 *
 * A thin, behaviour-preserving wrapper over the shared
 * `useAdminActionSubmit` (AFLDB-ISSUE-160 D-9): same `useActionState` +
 * `startTransition` dispatch, same focus-restore-before-dispatch contract,
 * same S-6 rule that a Server Action here must never call `revalidatePath`
 * itself, and the same follow-up POST to this domain's own
 * `/admin/coaches/revalidate` route once the action has already resolved
 * successfully.
 */
export type CoachActionState = AdminActionState & {
  needsConfirmation?: boolean;
  candidates?: { coachId: number; label: string; reason: string }[];
};

export function useCoachActionSubmit(
  action: (previous: CoachActionState, formData: FormData) => Promise<CoachActionState>,
): { state: CoachActionState; isPending: boolean; submit: (formData: FormData, origin: HTMLElement | null) => void } {
  return useAdminActionSubmit(action, { revalidateEndpoint: '/admin/coaches/revalidate', initialState: {} });
}
