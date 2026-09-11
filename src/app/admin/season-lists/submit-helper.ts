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
 * AFLDB-ISSUE-161 §10/§20 (binding): no public consumer of a season list
 * exists yet, so every season-list Server Action returns
 * `revalidatePaths: []` and no `/admin/season-lists/revalidate` route is
 * created in this issue. `useAdminActionSubmit`'s `postRevalidate()` returns
 * before it ever fetches when `paths.length === 0`, so this endpoint is
 * NEVER requested -- it is named as the route a future public consumer
 * would add, not left as an empty string, so that addition has an
 * unambiguous, already-agreed home.
 */
const REVALIDATE_ENDPOINT = '/admin/season-lists/revalidate';

export function useSeasonListActionSubmit<State extends AdminActionState>(
  action: (previous: State, formData: FormData) => Promise<State>,
  initialState: State,
): { state: State; isPending: boolean; submit: (formData: FormData, origin: HTMLElement | null) => void } {
  return useAdminActionSubmit(action, { revalidateEndpoint: REVALIDATE_ENDPOINT, initialState });
}
