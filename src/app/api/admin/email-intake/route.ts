import { goneRetiredAdminRoute } from '@/lib/admin/retired-admin';

export const dynamic = 'force-dynamic';

/**
 * RETIRED (AFLDB V2 Stage 5, V2-GAP-013, docs/v2/legacy-disposition.md L3): the server-to-server
 * intake for emailed CSVs, fed by tools/email_intake/fetch_and_stage.py on the
 * afldb-email-intake timer.
 *
 * It answers HTTP 410 Gone IMMEDIATELY and does nothing else: no request body is read, no shared
 * secret is compared (the secret is not read at all, so a missing or wrong one cannot change the
 * answer), no database is touched and no audit row is written. The last is deliberate. This
 * route authenticated by a shared secret and attributed a delivery to the sender's account only
 * AFTER reading the body; an unauthenticated caller therefore cannot be attributed, and auditing
 * anonymous calls would let anyone write audit rows. The pipeline, the brute-force limiters and
 * the sender lookup that made up the old route are removed with it.
 *
 * The poller treats a 4xx other than 408/429 as a permanent failure and files the message to its
 * Errors mailbox folder without deleting it (tools/email_intake/fetch_and_stage.py), so a message
 * sent before the Stage 6 cutover stops the timer is kept for a human, not lost or retried.
 */
export async function POST() {
  return goneRetiredAdminRoute('admin.email_intake');
}
