/**
 * The indexing gate, which exists as its own flag because it used to share
 * one with transport security.
 *
 * The bug these tests pin down was not "the wrong pages got indexed". It was
 * that the only way to keep a pre-cutover host out of search results —
 * AFLDB_ENV=development — also turned off Secure session cookies, HSTS and
 * the strict CSP on a host already answering on public HTTPS. So the property
 * worth asserting is the INDEPENDENCE: that indexing can be off while
 * AFLDB_ENV says production, and that it fails closed on its own.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { indexingEnabled } from '@/lib/indexing';

const KEYS = ['AFLDB_INDEXING', 'AFLDB_BETA_GATE', 'AFLDB_ENV'] as const;

let saved: Partial<Record<(typeof KEYS)[number], string | undefined>> = {};

beforeEach(() => {
  saved = Object.fromEntries(KEYS.map((key) => [key, process.env[key]]));
  for (const key of KEYS) delete process.env[key];
});

afterEach(() => {
  for (const key of KEYS) {
    const value = saved[key];
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
});

describe('indexingEnabled', () => {
  it('fails closed when the flag is unset', () => {
    expect(indexingEnabled()).toBe(false);
  });

  it('allows indexing only for exactly "on"', () => {
    process.env.AFLDB_INDEXING = 'on';
    expect(indexingEnabled()).toBe(true);

    // Anything else is a typo or a half-made decision, and both should leave
    // the site unindexed rather than guessing at intent.
    for (const value of ['true', 'yes', '1', 'ON', 'on ', 'production', '']) {
      process.env.AFLDB_INDEXING = value;
      expect(indexingEnabled(), `AFLDB_INDEXING=${JSON.stringify(value)}`).toBe(false);
    }
  });

  it('stays off behind the beta gate, however the flag is set', () => {
    process.env.AFLDB_INDEXING = 'on';
    process.env.AFLDB_BETA_GATE = 'on';
    expect(indexingEnabled()).toBe(false);
  });

  /**
   * The regression itself. A production-posture host — Secure cookies, HSTS,
   * strict CSP — must still be able to be invisible to crawlers, because
   * needing the former no longer forces the latter.
   */
  it('is independent of AFLDB_ENV in both directions', () => {
    process.env.AFLDB_ENV = 'production';
    expect(indexingEnabled()).toBe(false);

    process.env.AFLDB_ENV = 'development';
    process.env.AFLDB_INDEXING = 'on';
    expect(indexingEnabled()).toBe(true);
  });
});
