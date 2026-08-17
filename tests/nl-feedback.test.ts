/**
 * Reader feedback and analytics consent.
 *
 * Both are small surfaces where a quiet mistake is expensive: feedback
 * accepts unvetted text from anonymous browsers, and the consent gate
 * decides whether a cookie is written at all. The rules are pinned here
 * rather than trusted to the shape of the code.
 */
import { describe, expect, it } from 'vitest';

import { analyticsAllowed, isConsentChoice } from '@/lib/consent';
import {
  isNlFeedbackVerdict, NL_FEEDBACK_MAX_LENGTH, NL_FEEDBACK_VERDICTS,
} from '@/search/nl/feedback-spec';
import { isUuid, isValidNlSessionId } from '@/lib/nl-session';

describe('analytics consent fails closed', () => {
  // Everything that is not an explicit acceptance must read as "no".
  // Silence is not consent, and a bug in this predicate would become a
  // tracking cookie set on people who never answered.
  it.each([
    undefined,
    null,
    '',
    'declined',
    'true',
    'yes',
    'ACCEPTED',
    'accepted ',
    'maybe',
  ])('%p does not allow analytics storage', (value) => {
    expect(analyticsAllowed(value)).toBe(false);
  });

  it('only the exact string "accepted" allows it', () => {
    expect(analyticsAllowed('accepted')).toBe(true);
  });

  it('recognises exactly the two choices a visitor can make', () => {
    expect(isConsentChoice('accepted')).toBe(true);
    expect(isConsentChoice('declined')).toBe(true);
    expect(isConsentChoice('dismissed')).toBe(false);
    expect(isConsentChoice(undefined)).toBe(false);
  });
});

describe('feedback verdicts are a closed set', () => {
  it('accepts only the two verdicts', () => {
    expect(NL_FEEDBACK_VERDICTS).toEqual(['correct', 'incorrect']);
    expect(isNlFeedbackVerdict('correct')).toBe(true);
    expect(isNlFeedbackVerdict('incorrect')).toBe(true);
  });

  it.each(['', 'CORRECT', 'true', 'yes', 'wrong', 'drop table'])(
    '%p is not a verdict',
    (value) => {
      expect(isNlFeedbackVerdict(value)).toBe(false);
    },
  );

  // The bound is repeated in three places -- this constant, the textarea's
  // maxLength, and migration 049's CHECK. If it changes here without the
  // migration, the database rejects what the form accepts.
  it('matches the length the database will accept', () => {
    expect(NL_FEEDBACK_MAX_LENGTH).toBe(2000);
  });
});

describe('client_ref validation', () => {
  // client_ref arrives from the browser and reaches a ::uuid cast, so it
  // is checked like any other untrusted field.
  it('accepts a v4 uuid', () => {
    expect(isUuid('3f2504e0-4f89-41d3-9a0c-0305e82c3301')).toBe(true);
  });

  it.each([
    '',
    'not-a-uuid',
    '3f2504e0-4f89-41d3-9a0c',
    "3f2504e0-4f89-41d3-9a0c-0305e82c3301'; DROP TABLE nl_search_feedback; --",
    '../../etc/passwd',
  ])('rejects %p', (value) => {
    expect(isUuid(value)).toBe(false);
  });

  it('the session-id check is the same rule, so neither can drift', () => {
    const uuid = '3f2504e0-4f89-41d3-9a0c-0305e82c3301';
    expect(isValidNlSessionId(uuid)).toBe(isUuid(uuid));
    expect(isValidNlSessionId('nope')).toBe(isUuid('nope'));
  });
});
