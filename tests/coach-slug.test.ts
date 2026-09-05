import { describe, expect, it } from 'vitest';

import { coachSlug } from '@/lib/slugs';

describe('coachSlug', () => {
  it('lowercases and hyphenates a plain name', () => {
    expect(coachSlug('Chris Fagan')).toBe('chris-fagan');
  });

  it('strips punctuation rather than encoding it', () => {
    expect(coachSlug("Ron Barassi, Jr.")).toBe('ron-barassi-jr');
  });

  it('collapses a slash to a space before hyphenating, like honourTeamSlug', () => {
    expect(coachSlug('A/B Coach')).toBe('a-b-coach');
  });

  it('has no leading or trailing hyphen', () => {
    expect(coachSlug('  Neil Craig  ')).toBe('neil-craig');
  });
});
