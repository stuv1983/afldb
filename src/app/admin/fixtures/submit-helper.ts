'use client';

import { type AdminActionState, useAdminActionSubmit } from '@/components/admin/action-submit';

/**
 * The one submit helper every fixture admin panel dispatches through
 * (AFLDB-ISSUE-162 Stage 2), a thin wrapper over the shared
 * `useAdminActionSubmit` (ISSUE-160 D-9) -- see `src/app/admin/draft/
 * submit-helper.ts` for the full rationale this mirrors.
 *
 * `AdminActionState` is enough for every single-fixture edit: cancel,
 * reinstate and void each confirm client-side before submitting, and CAS
 * (`expectedUpdatedAt`) staleness is reported back as a plain refusal. The
 * round batch is the one exception -- see `RoundBatchActionState` below,
 * mirroring `CopyForwardActionState`.
 */
export type FixtureActionState = AdminActionState;

export type FixtureBatchRowOutcome = {
  index: number;
  ok: boolean;
  reason?: string;
  error?: string;
  fixtureKey?: string;
};

export type RoundBatchActionState = AdminActionState & {
  dryRun?: boolean;
  fingerprint?: string;
  batchId?: string;
  rows?: FixtureBatchRowOutcome[];
  created?: number;
};

/**
 * AFLDB-ISSUE-162 §22/D-7 (binding): no public consumer of a fixture exists
 * yet, so every fixture Server Action returns `revalidatePaths: []` and no
 * `/admin/fixtures/revalidate` route is created in this issue.
 * `useAdminActionSubmit`'s `postRevalidate()` returns before it ever fetches
 * when `paths.length === 0`, so this endpoint is NEVER requested -- named as
 * the route a future public consumer would add, not left as an empty
 * string, so that addition has an unambiguous, already-agreed home.
 */
const REVALIDATE_ENDPOINT = '/admin/fixtures/revalidate';

export function useFixtureActionSubmit<State extends AdminActionState>(
  action: (previous: State, formData: FormData) => Promise<State>,
  initialState: State,
): { state: State; isPending: boolean; submit: (formData: FormData, origin: HTMLElement | null) => void } {
  return useAdminActionSubmit(action, { revalidateEndpoint: REVALIDATE_ENDPOINT, initialState });
}
