/**
 * Browser half of the ISSUE-308 revalidation: a plain follow-up request, after
 * the approval action has returned, never inside it. Best-effort — the link
 * already committed, and a missed call leaves public pages stale until their
 * ISR window expires, never an inconsistent write.
 */
export async function postPublicRevalidate(): Promise<void> {
  try {
    await fetch('/admin/player-links/revalidate', { method: 'POST' });
  } catch {
    // Best-effort, see above.
  }
}
