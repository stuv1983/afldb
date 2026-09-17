/**
 * AFLDB-ISSUE-155 — the canonical-fingerprint compare-and-set digest.
 *
 * Split out of `src/lib/brownlow/entry.ts` so that `node:crypto` never
 * enters a client bundle: `entry.ts` is imported by client components
 * (`MatchVoteEditor.tsx`) for browser-safe constants like
 * `REASON_MIN_LENGTH`, and Next.js bundles a module's entire import graph
 * for the client it is imported into. `createHash` has no browser
 * equivalent, so it must live in a module nothing client-side imports.
 *
 * `server-only` enforces that boundary at build time rather than relying on
 * import discipline alone.
 */
import 'server-only';

import { createHash } from 'node:crypto';

import type { CanonicalRoundRow } from '@/lib/brownlow/entry';

/**
 * The compare-and-set value that catches the canonical picture moving
 * between page render and submit (§27.14).
 *
 * Over POSITIVE rows only, and over the `(player_id, votes, source_id)`
 * triple. Zeros are excluded because they are the dense background —
 * including 40 unchanging rows per match would make the digest churn on
 * line-up edits that have nothing to do with votes. What this must catch
 * is a settle landing a vote, another Super Admin correcting the match,
 * or an operator repair; all three move a positive row.
 *
 * The caller supplies exactly the row set §27.14 defines: the match's
 * resolved rows PLUS the season/round rows still unattached to any match
 * whose player is a participant of this match. Those unresolved rows are
 * in scope precisely because finalisation is about to claim them.
 */
export function canonicalFingerprint(rows: readonly CanonicalRoundRow[]): string {
  const lines = rows
    .filter((row) => row.votes !== null && row.votes > 0)
    .map((row) => `${row.playerId}:${row.votes}:${row.sourceId ?? ''}`)
    .sort();
  return createHash('sha256').update(`${lines.join('\n')}\n`, 'utf8').digest('hex');
}
