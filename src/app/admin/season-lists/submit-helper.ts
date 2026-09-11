'use client';

import { type AdminActionState, useAdminActionSubmit } from '@/components/admin/action-submit';

/**
 * The one submit helper every season-list admin panel dispatches through
 * (AFLDB-ISSUE-161 §29 Stage 2), a thin wrapper over the shared
 * `useAdminActionSubmit` (ISSUE-160 D-9) -- see `src/app/admin/draft/
 * submit-helper.ts` for the full rationale this mirrors.
 *
 * Unlike draft admin, no season-list mutation needs a server-issued
 * "needsConfirmation" round trip (J-3-shaped confirmation flows): every
 * destructive or ambiguous choice here -- remove, transfer, copy-forward --
 * is confirmed client-side with an explicit second step before the action
 * even submits, so the plain `AdminActionState` shape is enough. Copy-forward
 * is the one exception; it gets its own richer state below because a dry
 * run has to return the plan.
 */
export type SeasonListActionState = AdminActionState;

/**
 * Club leadership action state (AFLDB-ISSUE-163 Stage 2). Adds `reason` —
 * the backend's `LeadershipRefusalReason` enum value, not the refusal
 * sentence — so a panel can distinguish `co_captaincy_unconfirmed` (offer a
 * deliberate "confirm co-captaincy" step) from every other refusal (show the
 * message and stop), without parsing prose.
 */
export type LeadershipActionState = SeasonListActionState & { reason?: string };

export type CopyForwardClubPlan = {
  clubSlug: string;
  clubName: string;
  fromClubSlug: string;
  players: number;
};

export type CopyForwardActionState = AdminActionState & {
  dryRun?: boolean;
  fromSeason?: number;
  plan?: CopyForwardClubPlan[];
  copied?: number;
};

/**
 * AFLDB-ISSUE-161 §10/§20 reserved this endpoint while no public consumer of
 * a season list existed, so every ISSUE-161 action returned
 * `revalidatePaths: []` and the route itself did not exist yet.
 * AFLDB-ISSUE-163 Stage 2 is that public consumer: `/admin/season-lists/
 * revalidate/route.ts` now exists, and the club leadership actions
 * (`leadership-actions.ts`) are the first to return a non-empty
 * `revalidatePaths`. Every other season-list action still returns `[]`, and
 * `useAdminActionSubmit`'s `postRevalidate()` returns before it ever fetches
 * when `paths.length === 0`, so this endpoint is requested only after a
 * leadership mutation actually changes a public club page.
 */
const REVALIDATE_ENDPOINT = '/admin/season-lists/revalidate';

export function useSeasonListActionSubmit<State extends AdminActionState>(
  action: (previous: State, formData: FormData) => Promise<State>,
  initialState: State,
): { state: State; isPending: boolean; submit: (formData: FormData, origin: HTMLElement | null) => void } {
  return useAdminActionSubmit(action, { revalidateEndpoint: REVALIDATE_ENDPOINT, initialState });
}
