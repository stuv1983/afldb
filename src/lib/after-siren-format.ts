/**
 * Plain-language wording for a canonical `after_siren_kicks` event
 * (AFLDB-ISSUE-118 §W.4). The enums themselves (`kick_scored`, `kick_effect`,
 * `siren`) are internal vocabulary -- a reader never sees `'won'` or
 * `'end_of_extra_time'` verbatim, only the sentence this maps them to.
 *
 * `end_of_regulation` can only carry `kick_effect = 'none'`
 * (`after_siren_kicks_regulation_ck`, migration 089): it is a miss before
 * extra time was played, never a scoring kick, so that combination is not a
 * case this needs to branch on separately from the general "missed" wording
 * below it.
 */
export function afterSirenEventLabel(event: {
  kickScored: 'goal' | 'behind' | 'none';
  kickEffect: 'won' | 'drew' | 'none';
  siren: 'final' | 'end_of_regulation' | 'end_of_extra_time';
}): string {
  if (event.siren === 'end_of_regulation') return 'Missed before extra time';

  const sirenPhrase = event.siren === 'end_of_extra_time'
    ? 'after the siren in extra time'
    : 'after the siren';

  if (event.kickEffect === 'none') return `Missed ${sirenPhrase}`;

  const scoreLabel = event.kickScored === 'goal' ? 'Goal' : 'Behind';
  const outcome = event.kickEffect === 'won' ? 'to win' : 'to draw';
  return `${scoreLabel} ${sirenPhrase} ${outcome}`;
}
