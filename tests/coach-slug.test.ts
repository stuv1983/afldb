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

  // AFLDB-ISSUE-159 Stage 2: coachSlug is purely a function of display_name
  // and knows nothing of manual vs. AFL Tables identity (§1.1) -- an
  // admin-typed manual coach's display name slugs exactly as a sourced
  // one's does, and a display_name correction slugs to a new value, which
  // is what makes the [slug]-<id> canonical-redirect at
  // src/app/coaches/[slug]/page.tsx:93-97 fire for a renamed coach.
  it('slugs an admin-typed manual coach display name the same way', () => {
    expect(coachSlug('Pat O\'Brien-Smith')).toBe('pat-o-brien-smith');
  });

  it('produces a new slug after a display_name correction, so the old one 404s and the id-authoritative URL redirects', () => {
    expect(coachSlug('Chris Fagan')).not.toBe(coachSlug('Christopher Fagan'));
  });
});
