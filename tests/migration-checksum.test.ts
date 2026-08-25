/**
 * Unit tests for tools/db/migration-checksum.ts. No database, no filesystem —
 * synthetic migration-like content only. See AFLDB-ISSUE-091.md §5 for the
 * requirement -> test mapping and §4.2 for the full compatibility matrix.
 */
import { createHash } from 'node:crypto';

import { describe, expect, it } from 'vitest';

import {
  computeChecksumRepresentations,
  matchesStoredChecksum,
} from '../tools/db/migration-checksum';

function sha256(content: string): string {
  return createHash('sha256').update(content).digest('hex');
}

const LF = 'CREATE TABLE x (\n  id integer PRIMARY KEY\n);\n';
const CRLF = LF.replace(/\n/g, '\r\n');

describe('computeChecksumRepresentations', () => {
  it('produces the same canonicalLf for equivalent LF and CRLF content (req 1)', () => {
    expect(computeChecksumRepresentations(LF).canonicalLf)
      .toBe(computeChecksumRepresentations(CRLF).canonicalLf);
  });

  it('produces the same canonicalLf for a new migration applied from either platform (req 11)', () => {
    expect(computeChecksumRepresentations(LF).canonicalLf)
      .toBe(computeChecksumRepresentations(CRLF).canonicalLf);
  });

  it('is deterministic and side-effect-free (req 10 support)', () => {
    const first = computeChecksumRepresentations(LF);
    const second = computeChecksumRepresentations(LF);
    expect(first).toEqual(second);
  });
});

describe('matchesStoredChecksum', () => {
  it('accepts an LF-derived stored checksum against a CRLF worktree (req 2, matrix row 2)', () => {
    const stored = sha256(LF);
    expect(matchesStoredChecksum(stored, computeChecksumRepresentations(CRLF))).toBe(true);
  });

  it('accepts a CRLF-derived stored checksum against an LF worktree (req 3, matrix row 3)', () => {
    const stored = sha256(CRLF);
    expect(matchesStoredChecksum(stored, computeChecksumRepresentations(LF))).toBe(true);
  });

  it('accepts a same-platform LF stored checksum against an LF worktree (req 4, matrix row 1)', () => {
    const stored = sha256(LF);
    expect(matchesStoredChecksum(stored, computeChecksumRepresentations(LF))).toBe(true);
  });

  it('accepts a same-platform CRLF stored checksum against a CRLF worktree (req 4, matrix row 4)', () => {
    const stored = sha256(CRLF);
    expect(matchesStoredChecksum(stored, computeChecksumRepresentations(CRLF))).toBe(true);
  });

  it('rejects a genuine SQL/content edit (req 5, matrix row 5)', () => {
    const stored = sha256(LF);
    const mutated = LF.replace('TABLE x', 'TABLE y');
    expect(matchesStoredChecksum(stored, computeChecksumRepresentations(mutated))).toBe(false);
  });

  it('rejects a non-EOL whitespace edit (req 6, matrix row 6)', () => {
    const stored = sha256(LF);
    const withTrailingSpace = LF.replace('PRIMARY KEY', 'PRIMARY KEY ');
    expect(matchesStoredChecksum(stored, computeChecksumRepresentations(withTrailingSpace))).toBe(false);
  });

  it('defines mixed line-ending behaviour: reduces/expands like the pure forms (req 7, matrix row 8)', () => {
    const mixed = 'CREATE TABLE x (\r\n  id integer PRIMARY KEY\n);\n';
    const mixedReps = computeChecksumRepresentations(mixed);
    expect(mixedReps.canonicalLf).toBe(computeChecksumRepresentations(LF).canonicalLf);
    expect(mixedReps.canonicalCrlf).toBe(computeChecksumRepresentations(CRLF).canonicalCrlf);
  });

  it('does not normalize a final-newline difference, in any representation (req 8, matrix row 7)', () => {
    const withoutTrailingNewline = computeChecksumRepresentations(LF);
    const withTrailingNewline = computeChecksumRepresentations(`${LF}\n`);
    expect(withTrailingNewline.raw).not.toBe(withoutTrailingNewline.raw);
    expect(withTrailingNewline.canonicalLf).not.toBe(withoutTrailingNewline.canonicalLf);
    expect(withTrailingNewline.canonicalCrlf).not.toBe(withoutTrailingNewline.canonicalCrlf);
  });

  it('does not treat a lone CR as EOL-equivalent (req 9, matrix row 9)', () => {
    const withLoneCr = 'CREATE TABLE x (\n  id integer PRIMARY KEY\r);\n';
    const withoutLoneCr = withLoneCr.replace('\r', '');
    const stored = sha256(withoutLoneCr);
    expect(matchesStoredChecksum(stored, computeChecksumRepresentations(withLoneCr))).toBe(false);
  });
});
