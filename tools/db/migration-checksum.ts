/**
 * Pure checksum/normalization logic for migration drift detection.
 *
 * A stored ledger checksum may have been computed from a raw checkout that
 * happened to be LF or CRLF at the time a migration was applied. Validating
 * from a different-line-ending checkout later must not report false drift.
 * See AFLDB-ISSUE-091.md for the full compatibility matrix and rationale.
 */
import { createHash } from 'node:crypto';

function sha256(content: string): string {
  return createHash('sha256').update(content).digest('hex');
}

/**
 * Collapse every CRLF sequence to LF. Only the two-byte \r\n sequence is
 * touched. A bare \r with no following \n, a trailing-newline difference,
 * or any other byte is untouched and remains a real, detected difference.
 */
function toCanonicalLf(content: string): string {
  return content.replace(/\r\n/g, '\n');
}

/**
 * Expand every LF to CRLF, starting from the canonical-LF form (not from
 * the raw input) so a file that is already CRLF, already LF, or a mix of
 * both collapses through the same LF intermediate before re-expanding.
 * This is what makes the derived CRLF form independent of which style the
 * CURRENT checkout happens to have materialized. A bare \r with no
 * following \n is still untouched here, for the same reason as above.
 */
function toCanonicalCrlf(content: string): string {
  return toCanonicalLf(content).replace(/\n/g, '\r\n');
}

export type MigrationChecksumRepresentations = {
  /** Exact bytes as read from disk by the current checkout. */
  raw: string;
  /** The same logical content, canonically normalized to LF-only line endings. */
  canonicalLf: string;
  /** The same logical content, canonically normalized to CRLF-only line endings. */
  canonicalCrlf: string;
};

export function computeChecksumRepresentations(
  rawSql: string,
): MigrationChecksumRepresentations {
  return {
    raw: sha256(rawSql),
    canonicalLf: sha256(toCanonicalLf(rawSql)),
    canonicalCrlf: sha256(toCanonicalCrlf(rawSql)),
  };
}

/**
 * A stored ledger checksum is accepted if it equals ANY of the three bounded
 * representations of the current content. It is never accepted merely
 * because it differs by non-line-ending bytes — see the compatibility
 * matrix in AFLDB-ISSUE-091.md §4.
 */
export function matchesStoredChecksum(
  stored: string,
  reps: MigrationChecksumRepresentations,
): boolean {
  return stored === reps.raw || stored === reps.canonicalLf || stored === reps.canonicalCrlf;
}
