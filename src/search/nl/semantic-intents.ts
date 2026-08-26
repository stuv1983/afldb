import { stripMatch } from '@/search/nl/entities';
import type { NlHeadToHeadKind } from '@/search/nl/plan';

export type HeadToHeadCue = { kind: NlHeadToHeadKind; matchedText: string };
export type HeadToHeadExtraction = { text: string; cue?: HeadToHeadCue; consumed: string[] };

/** DB-free extraction of relationship-level two-club language. */
export function extractHeadToHeadCue(text: string): HeadToHeadExtraction {
  const families: readonly [RegExp, NlHeadToHeadKind][] = [
    [/\b(?:when was the )?(?:last|most recent) draw\s+between\b/, 'last_draw'],
    [/\bhow many drawn games\s+between\b/, 'draw_count'],
    [/\b(?:how many|number of) draws?\s+between\b/, 'draw_count'],
    [/\bhow many times have\b(?=.*\bdrawn\b)/, 'draw_count'],
    [/\bdraws?\s+(?:against|versus)\b/, 'draw_count'],
    [/\b(?:who has|who'?s|who|which team has) won more\b/, 'compare_wins'],
    [/\bhead[- ]to[- ]head(?:\s+(?:record|between))?\b/, 'record'],
    [/\brecord\s+(?:against|versus)\b/, 'record'],
  ];

  for (const [pattern, kind] of families) {
    const match = pattern.exec(text);
    if (!match) continue;
    return {
      text: stripMatch(text, match[0]),
      cue: { kind, matchedText: match[0] },
      consumed: [match[0]],
    };
  }
  return { text, consumed: [] };
}
