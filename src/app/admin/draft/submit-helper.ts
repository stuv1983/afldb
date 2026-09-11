'use client';

import { type AdminActionState, useAdminActionSubmit } from '@/components/admin/action-submit';

/**
 * The one submit helper every draft admin panel dispatches through
 * (AFLDB-ISSUE-160 §18 interaction contract), a thin wrapper over the shared
 * `useAdminActionSubmit` (D-9) -- see `src/app/admin/coaches/submit-helper.ts`
 * for the full rationale this mirrors.
 *
 * `candidates`/`confirm` are declared here rather than imported from
 * `src/db/queries/admin-draft.ts`: that module carries `import 'server-only'`
 * and must never be reachable from a `'use client'` bundle, even for a
 * type-only import. The shapes are kept in sync with `DraftCandidate` /
 * `DraftConfirmReason` there by `tests/admin-draft-actions.test.ts`.
 */
export type DraftCandidate = { kind: 'player' | 'pick'; id: number; label: string; reason: string };
export type DraftConfirmReason = 'null_pick_number' | 'distinct_namesakes' | 'unlinked_source_selection';

/**
 * The AFLDB-ISSUE-161 §14 handoff: present only when the target season
 * (`draftYear + 1`) is within the season-list administrable range (§9.1).
 * A link only, never a mutation — the season-list Add panel still requires
 * an explicit Super Admin confirmation (D-5).
 */
export type SeasonListHandoff = { season: number; clubSlug: string; playerId: number } | null;

export type DraftActionState = AdminActionState & {
  needsConfirmation?: boolean;
  confirm?: DraftConfirmReason;
  candidates?: DraftCandidate[];
  seasonListHandoff?: SeasonListHandoff;
};

export function useDraftActionSubmit(
  action: (previous: DraftActionState, formData: FormData) => Promise<DraftActionState>,
): { state: DraftActionState; isPending: boolean; submit: (formData: FormData, origin: HTMLElement | null) => void } {
  return useAdminActionSubmit(action, { revalidateEndpoint: '/admin/draft/revalidate', initialState: {} });
}
