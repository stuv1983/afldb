import { stripMatch } from '@/search/nl/entities';
import type { NlHeadToHeadKind } from '@/search/nl/plan';
import { NUMBER_WORDS } from '@/search/nl/vocab';

export type HeadToHeadCue = { kind: NlHeadToHeadKind; matchedText: string };
export type HeadToHeadExtraction = { text: string; cue?: HeadToHeadCue; consumed: string[] };

/**
 * A count, comparator, or superlative directly governing "wins"/"losses"
 * means the phrase is NOT the bare relationship question: "teams with more
 * than 3 wins against Lions" is a grouped threshold (extractHavingClause's
 * business), "most wins against Richmond" is a ranking, and "how many wins
 * against ..." is a count. Only the ungoverned plural relationship form
 * ("Eagles wins against Hawks") reads as the head-to-head record.
 */
// Number words come from the parser's own counting vocabulary rather than
// a second hand-typed list -- "exactly three wins against Carlton" is
// governed exactly the way "exactly 3 wins against Carlton" is.
const RESULT_COUNT_GOVERNS = new RegExp(
  `(?:\\d|\\b(?:most|fewest|many|least|than|exactly|more|less|fewer|no|with|biggest|largest|highest|lowest|top|${Object.keys(NUMBER_WORDS).join('|')})\\b)\\s*$`,
);

/** DB-free extraction of relationship-level two-club language. */
export function extractHeadToHeadCue(text: string): HeadToHeadExtraction {
  const families: readonly [RegExp, NlHeadToHeadKind, RegExp?][] = [
    [/\b(?:when was the )?(?:last|most recent) draw\s+between\b/, 'last_draw'],
    [/\bhow many drawn games\s+between\b/, 'draw_count'],
    [/\b(?:how many|number of) draws?\s+between\b/, 'draw_count'],
    [/\bhow many times have\b(?=.*\bdrawn\b)/, 'draw_count'],
    [/\bdraws?\s+(?:against|versus)\b/, 'draw_count'],
    [/\b(?:who has|who'?s|who|which team has) won more\b/, 'compare_wins'],
    [/\bhead[- ]to[- ]head(?:\s+(?:record|between))?\b/, 'record'],
    [/\brecord\s+(?:against|versus)\b/, 'record'],
    // Bare two-club "wins against" / "losses against" is the same
    // relationship question as "record against": the record answer
    // already carries both clubs' wins, draws and total meetings.
    // Deliberately PLURAL-only, so single-match extrema ("biggest win
    // against Carlton", "biggest loss against Carlton") keep their
    // team_match margin reading, and guarded (RESULT_COUNT_GOVERNS) so
    // grouped thresholds and rankings are never stolen. One-club wording
    // is handled structurally by the caller: the cue commits only when
    // two distinct clubs resolve.
    [/\bwins\s+(?:against|versus|vs\.?|v\.?)\b/, 'record', RESULT_COUNT_GOVERNS],
    [/\blosses\s+(?:against|versus|vs\.?|v\.?)\b/, 'record', RESULT_COUNT_GOVERNS],
  ];

  for (const [pattern, kind, notGovernedBy] of families) {
    const match = pattern.exec(text);
    if (!match) continue;
    if (notGovernedBy) {
      const before = text.slice(Math.max(0, match.index - 18), match.index);
      if (notGovernedBy.test(before)) continue;
    }
    return {
      text: stripMatch(text, match[0]),
      cue: { kind, matchedText: match[0] },
      consumed: [match[0]],
    };
  }
  return { text, consumed: [] };
}
