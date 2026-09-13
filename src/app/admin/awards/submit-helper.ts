'use client';

import { type AdminActionState, useAdminActionSubmit } from '@/components/admin/action-submit';

/**
 * The one submit helper every awards admin panel dispatches through
 * (AFLDB-ISSUE-165 §5.6 / §6.10), a thin wrapper over the shared
 * `useAdminActionSubmit` — see `src/app/admin/coaches/submit-helper.ts` for
 * the full rationale this mirrors.
 *
 * Two things it buys beyond the shared hook:
 *
 *   - every panel posts its revalidation to `/admin/awards/revalidate`, the
 *     one capability-gated allowlisted route for this domain, and never calls
 *     `revalidatePath` from inside a Server Action;
 *   - every action control hands its own element to the focus-restore hook
 *     before dispatch, because disabling the control that has focus drops
 *     focus to `document.body` and strands a keyboard operator on a refusal
 *     (ISSUE-155 §27.27 H-1).
 *
 * `needsConfirmation` carries the ONE case the award-winner creator surfaces
 * rather than refusing: a second row for the same (award, season, player).
 * That shape is legitimate — the 1984 All-Australian holds a club-selection
 * and a state-selection row for the same players — so it is confirmed, never
 * blocked and never silently allowed (R-5).
 */
export type AwardsActionState = AdminActionState & {
  needsConfirmation?: boolean;
  /** What the confirmation is about, in the administrator's words. */
  confirm?: string;
  /** A created or replacement row to navigate to once the panel succeeds. */
  createdId?: number;
  /**
   * The mutation SUCCEEDED but something best-effort beside it did not.
   *
   * Only ever the `auth_audit_log` activity entry: the required `data_edits`
   * audit is written inside the mutation's own transaction (the ISSUE-027
   * contract), so "committed but unaudited" cannot happen for that one. This
   * warning exists so an operator who sees it does NOT resubmit — the change
   * is already made, and submitting again would make a second one.
   */
  warning?: string;
};

export function useAwardsActionSubmit(
  action: (previous: AwardsActionState, formData: FormData) => Promise<AwardsActionState>,
): {
  state: AwardsActionState;
  isPending: boolean;
  submit: (formData: FormData, origin: HTMLElement | null) => void;
} {
  return useAdminActionSubmit(action, {
    revalidateEndpoint: '/admin/awards/revalidate',
    initialState: {},
  });
}
