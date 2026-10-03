/**
 * The provenance source key an attendance figure typed by a human carries.
 *
 * Kept in this dependency-free module so client bundles can import it.
 * `src/lib/brownlow/entry.ts` is bundled into the Brownlow round editor (a client
 * component), and `manual-authority.ts` reaches Node-only modules through
 * `match-sheet-authority.ts` since AFLDB-ISSUE-257, which broke `next build`.
 */
export const MANUAL_ATTENDANCE_SOURCE_KEY = 'manual_admin_edit';
