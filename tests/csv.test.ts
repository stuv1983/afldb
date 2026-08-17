/**
 * CSV writing, which is only ever used for the super-admin search-telemetry
 * export -- an export whose every `question` field is text typed by an
 * anonymous member of the public. That makes the escaping rules here a
 * correctness AND a safety concern rather than cosmetics, so both are
 * pinned by test.
 */
import { describe, expect, it } from 'vitest';

import { toCsv } from '@/lib/csv';

function lines(csv: string): string[] {
  return csv.trimEnd().split('\r\n');
}

describe('toCsv', () => {
  it('writes a header from the column list, in the given order', () => {
    const csv = toCsv(['b', 'a'] as const, [{ a: 1, b: 2 }]);
    expect(lines(csv)).toEqual(['b,a', '2,1']);
  });

  it('uses CRLF line endings, per RFC 4180', () => {
    expect(toCsv(['a'] as const, [{ a: 1 }, { a: 2 }])).toBe('a\r\n1\r\n2\r\n');
  });

  it('quotes a field containing a comma, so it cannot split into two columns', () => {
    const csv = toCsv(['q'] as const, [{ q: 'most goals, ever' }]);
    expect(lines(csv)[1]).toBe('"most goals, ever"');
  });

  it('doubles an embedded quote', () => {
    const csv = toCsv(['q'] as const, [{ q: 'who said "dusty"' }]);
    expect(lines(csv)[1]).toBe('"who said ""dusty"""');
  });

  it('quotes a field containing a newline rather than emitting a broken row', () => {
    const csv = toCsv(['q'] as const, [{ q: 'line one\nline two' }]);
    expect(csv).toBe('q\r\n"line one\nline two"\r\n');
  });

  it('renders null and undefined as empty, not as the strings "null"/"undefined"', () => {
    const csv = toCsv(['a', 'b'] as const, [{ a: null, b: undefined }]);
    expect(lines(csv)[1]).toBe(',');
  });

  it('renders a Date as ISO 8601, which sorts lexically', () => {
    const csv = toCsv(['at'] as const, [{ at: new Date('2026-08-17T10:38:40.000Z') }]);
    expect(lines(csv)[1]).toBe('2026-08-17T10:38:40.000Z');
  });

  it('serialises an object field as JSON so a plan survives the round trip', () => {
    const csv = toCsv(['plan'] as const, [{ plan: { grain: 'player_game', n: 1 } }]);
    // Contains a comma, so it must also be quoted.
    expect(lines(csv)[1]).toBe('"{""grain"":""player_game"",""n"":1}"');
  });

  it('keeps a zero, which is a real value and not an absence', () => {
    const csv = toCsv(['n'] as const, [{ n: 0 }]);
    expect(lines(csv)[1]).toBe('0');
  });

  describe('spreadsheet formula injection', () => {
    // A reader can type anything into the search box, and that text lands
    // verbatim in the export. Without this, `=1+1` in the search box is a
    // formula evaluated on the machine of whoever opens the file.
    it.each(['=1+1', '+1', '-1', '@SUM(A1)', '\tlead', '\rlead'])(
      'neutralises a leading %j with an apostrophe',
      (dangerous) => {
        const csv = toCsv(['q'] as const, [{ q: dangerous }]);
        // The apostrophe is always present; quoting may or may not also apply.
        expect(lines(csv)[1].replace(/^"|"$/g, '').startsWith("'")).toBe(true);
      },
    );

    it('leaves an ordinary question untouched', () => {
      const csv = toCsv(['q'] as const, [{ q: 'most goals in a grand final' }]);
      expect(lines(csv)[1]).toBe('most goals in a grand final');
    });

    it('does not treat a minus INSIDE a field as dangerous', () => {
      const csv = toCsv(['q'] as const, [{ q: 'richmond-carlton' }]);
      expect(lines(csv)[1]).toBe('richmond-carlton');
    });
  });

  it('writes a header-only file when there are no rows', () => {
    expect(toCsv(['a', 'b'] as const, [])).toBe('a,b\r\n');
  });
});
