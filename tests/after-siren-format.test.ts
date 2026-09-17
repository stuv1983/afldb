import { describe, expect, it } from 'vitest';

import { afterSirenEventLabel } from '@/lib/after-siren-format';

describe('afterSirenEventLabel', () => {
  it('goal after the siren to win', () => {
    expect(afterSirenEventLabel({ kickScored: 'goal', kickEffect: 'won', siren: 'final' }))
      .toBe('Goal after the siren to win');
  });

  it('behind after the siren to win', () => {
    expect(afterSirenEventLabel({ kickScored: 'behind', kickEffect: 'won', siren: 'final' }))
      .toBe('Behind after the siren to win');
  });

  it('goal after the siren to draw', () => {
    expect(afterSirenEventLabel({ kickScored: 'goal', kickEffect: 'drew', siren: 'final' }))
      .toBe('Goal after the siren to draw');
  });

  it('behind after the siren to draw', () => {
    expect(afterSirenEventLabel({ kickScored: 'behind', kickEffect: 'drew', siren: 'final' }))
      .toBe('Behind after the siren to draw');
  });

  it('a miss after the ordinary final siren', () => {
    expect(afterSirenEventLabel({ kickScored: 'none', kickEffect: 'none', siren: 'final' }))
      .toBe('Missed after the siren');
  });

  it('a miss that scored a behind but changed nothing is still a miss, not a "behind" wording', () => {
    expect(afterSirenEventLabel({ kickScored: 'behind', kickEffect: 'none', siren: 'final' }))
      .toBe('Missed after the siren');
  });

  it('explicit extra-time wording for a scoring kick after the extra-time siren', () => {
    expect(afterSirenEventLabel({ kickScored: 'goal', kickEffect: 'won', siren: 'end_of_extra_time' }))
      .toBe('Goal after the siren in extra time to win');
  });

  it('explicit extra-time wording for a miss after the extra-time siren', () => {
    expect(afterSirenEventLabel({ kickScored: 'none', kickEffect: 'none', siren: 'end_of_extra_time' }))
      .toBe('Missed after the siren in extra time');
  });

  it('a miss before extra time was played reads distinctly from an ordinary miss', () => {
    expect(afterSirenEventLabel({ kickScored: 'none', kickEffect: 'none', siren: 'end_of_regulation' }))
      .toBe('Missed before extra time');
  });
});
