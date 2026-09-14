'use client';

import { type AdminActionState, useAdminActionSubmit } from '@/components/admin/action-submit';

/**
 * The one submit helper every special-records admin panel dispatches through
 * (AFLDB-ISSUE-167 Stage 6), a thin wrapper over the shared
 * `useAdminActionSubmit` -- see `src/app/admin/coaches/submit-helper.ts` for
 * the full rationale this mirrors.
 *
 * Two things it buys beyond the shared hook:
 *
 *   - every panel posts its revalidation to `/admin/records/revalidate`, the
 *     one capability-gated allowlisted route for this domain, and never calls
 *     `revalidatePath` from inside a Server Action (R-7);
 *   - every action control hands its own element to the focus-restore hook
 *     before dispatch, because disabling the control that has focus drops focus
 *     to `document.body` and strands a keyboard operator on a refusal
 *     (AFLDB-ISSUE-155 §27.27 H-1, which §10.3 requires this surface to verify
 *     rather than assume fixed).
 */
export type SpecialRecordsActionState = AdminActionState & {
  /** A created or replacement row to navigate to once the panel succeeds. */
  createdId?: number;
  /**
   * The mutation SUCCEEDED but something best-effort beside it did not.
   *
   * Only ever the `auth_audit_log` activity entry: the required `data_edits`
   * audit is written inside the mutation's own transaction (the AFLDB-ISSUE-027
   * contract), so "committed but unaudited" cannot happen for that one. This
   * warning exists so an operator who sees it does NOT resubmit -- the change
   * is already made, and submitting again would make a second one.
   */
  warning?: string;
};

export function useSpecialRecordsActionSubmit(
  action: (previous: SpecialRecordsActionState, formData: FormData)
  => Promise<SpecialRecordsActionState>,
): {
  state: SpecialRecordsActionState;
  isPending: boolean;
  submit: (formData: FormData, origin: HTMLElement | null) => void;
} {
  return useAdminActionSubmit(action, {
    revalidateEndpoint: '/admin/records/revalidate',
    initialState: {},
  });
}
