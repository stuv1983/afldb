/**
 * Reader feedback and analytics consent.
 *
 * Both are small surfaces where a quiet mistake is expensive: feedback
 * accepts unvetted text from anonymous browsers, and the consent gate
 * decides whether a cookie is written at all. The rules are pinned here
 * rather than trusted to the shape of the code.
 */
import { describe, expect, it } from 'vitest';

import { analyticsAllowed, CONSENT_COOKIE, isConsentChoice, readConsentCookie } from '@/lib/consent';
import { secureCookies } from '@/lib/cookie-security';
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

describe('the browser-side read of the consent cookie', () => {
  // The banner decides whether to show itself from document.cookie, so
  // that the root layout does not have to read a cookie and make every
  // prerendered page in the site dynamic. That puts a cookie PARSER on
  // the path, and a parser that matches too loosely reads consent out of
  // a cookie nobody set.
  function withCookie<T>(cookie: string, run: () => T): T {
    const original = (globalThis as { document?: unknown }).document;
    (globalThis as { document?: unknown }).document = { cookie };
    try {
      return run();
    } finally {
      if (original === undefined) delete (globalThis as { document?: unknown }).document;
      else (globalThis as { document?: unknown }).document = original;
    }
  }

  it('finds the choice wherever it sits in the jar', () => {
    expect(withCookie(`${CONSENT_COOKIE}=accepted`, readConsentCookie)).toBe('accepted');
    expect(withCookie(`nl_sid=x; ${CONSENT_COOKIE}=declined`, readConsentCookie)).toBe('declined');
    expect(withCookie(`${CONSENT_COOKIE}=accepted; nl_sid=x`, readConsentCookie)).toBe('accepted');
  });

  it('is undefined when nothing has been answered', () => {
    expect(withCookie('', readConsentCookie)).toBeUndefined();
    expect(withCookie('nl_sid=x; afldb_admin=y', readConsentCookie)).toBeUndefined();
  });

  it('does not match a cookie that merely ends with the name', () => {
    // The bug this pins: a substring search would read consent out of
    // `not_afldb_consent`, and the banner would never appear again.
    expect(withCookie(`not_${CONSENT_COOKIE}=accepted`, readConsentCookie)).toBeUndefined();
    expect(withCookie(`${CONSENT_COOKIE}_backup=accepted`, readConsentCookie)).toBeUndefined();
  });

  it('feeds a value the fail-closed predicates still judge', () => {
    // Reading is not deciding: whatever comes back out of the jar is
    // client-supplied text, and it goes through the same two predicates.
    expect(isConsentChoice(withCookie(`${CONSENT_COOKIE}=maybe`, readConsentCookie))).toBe(false);
    expect(analyticsAllowed(withCookie(`${CONSENT_COOKIE}=maybe`, readConsentCookie))).toBe(false);
  });
});

describe('cookie transport security', () => {
  // One predicate for every cookie the site sets. It lives in its own
  // module because it used to live inside lib/auth/session.ts, where the
  // consent cookie and nl_sid could not reach it -- which is exactly why
  // both of them shipped without `secure`.
  it('is on in production and off on the plain-HTTP dev server', () => {
    const original = process.env.AFLDB_ENV;
    try {
      process.env.AFLDB_ENV = 'production';
      expect(secureCookies()).toBe(true);
      process.env.AFLDB_ENV = 'development';
      expect(secureCookies()).toBe(false);
      delete process.env.AFLDB_ENV;
      expect(secureCookies()).toBe(false);
    } finally {
      if (original === undefined) delete process.env.AFLDB_ENV;
      else process.env.AFLDB_ENV = original;
    }
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
