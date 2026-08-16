/**
 * `award_nominations.stat_line` is jsonb, and postgres.js hands jsonb back
 * as raw TEXT on this project's client. The Rising Star season page read the
 * column straight into a `Record<string, number>` annotation and indexed it
 * by stat key, which on a string is always undefined -- so the page dropped
 * the whole statistics block and looked, from the outside, like a competition
 * that had simply never recorded any.
 *
 * These cover the decode the same way early-access-questions.test.ts covers
 * `parseAnswers`, which is the same trap on a different column.
 */
import { describe, expect, it } from 'vitest';

import { parseStatLine } from '@/lib/jsonb';

describe('parseStatLine', () => {
  it('decodes the raw jsonb text the driver actually returns', () => {
    expect(parseStatLine('{"disposals":31,"goals":2}'))
      .toEqual({ disposals: 31, goals: 2 });
  });

  it('accepts an already-decoded object, for a client that parses jsonb itself', () => {
    expect(parseStatLine({ disposals: 31 })).toEqual({ disposals: 31 });
  });

  it('coerces numeric strings, which is how a hand-edited row reads', () => {
    expect(parseStatLine('{"disposals":"31"}')).toEqual({ disposals: 31 });
  });

  it('drops values that are not numbers rather than rendering NaN', () => {
    expect(parseStatLine('{"disposals":31,"note":"best on ground"}'))
      .toEqual({ disposals: 31 });
  });

  it('skips nulls and empty strings', () => {
    expect(parseStatLine('{"disposals":31,"goals":null,"marks":""}'))
      .toEqual({ disposals: 31 });
  });

  it('keeps a genuine zero, which is a real statistic', () => {
    expect(parseStatLine('{"goals":0}')).toEqual({ goals: 0 });
  });

  it('returns null for anything unusable', () => {
    expect(parseStatLine(null)).toBeNull();
    expect(parseStatLine(undefined)).toBeNull();
    expect(parseStatLine('not json')).toBeNull();
    expect(parseStatLine('[]')).toBeNull();
    expect(parseStatLine('{}')).toBeNull();
    expect(parseStatLine('{"note":"no numbers here"}')).toBeNull();
  });
});
