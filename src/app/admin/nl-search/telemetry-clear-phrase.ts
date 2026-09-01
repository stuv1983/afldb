/**
 * The exact phrase an operator must type to arm the "clear search
 * telemetry" control (AFLDB-ISSUE-119 §10).
 *
 * Pure and free of `server-only` on purpose, the same way `nav-model.ts`
 * and `review-spec.ts` are: `ClearTelemetryForm` (a Client Component) uses
 * it as a misclick guard, and `clearTelemetry()` in `actions.ts` re-checks
 * it independently on the server (§6). It lives here rather than in
 * `actions.ts` because a `'use server'` module may only export async
 * functions -- a shared string constant has to sit outside it.
 */
export const NL_TELEMETRY_CLEAR_PHRASE = 'CLEAR SEARCH TELEMETRY';
