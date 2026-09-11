/**
 * The pure half of club leadership administration Stage 2 (AFLDB-ISSUE-163
 * §12, §17, §18, §21, §24).
 *
 * Everything here is a decision made with no database at all: the durable key
 * shape and its parser, the closed role/status vocabularies, the real-calendar
 * date validator and its interval rule, and the Stage 2 revalidate route's own
 * path allowlist (`revalidate-paths.ts`) — proving it admits exactly
 * `/clubs/<slug>` and refuses everything else, including a traversal attempt,
 * another admin domain's public page, and a query string.
 *
 * What is deliberately NOT re-proved here: that a mutation refuses BEFORE any
 * write for `not_listed` / `duplicate_active` / `co_captaincy_unconfirmed` /
 * `invalid_transition`, that `revalidatePaths` is computed server-side from
 * the affected organisation rather than echoed from the caller, and the real
 * replay round-trip. Those all require driving `admin-club-leadership.ts`
 * through `resolvePlayerIdentity()` (a second module with its own SQL shape),
 * and are already exercised end-to-end, against a real database, by Stage 1's
 * `tests/integration/admin-club-leadership.test.ts` — a shallow mock of that
 * cross-module call here would be a second, weaker copy of that proof rather
 * than a useful one.
 */
import { describe, expect, it, vi } from 'vitest';

// `admin-club-leadership.ts` imports `@/db/client` transitively (through
// `admin-season-lists.ts`, `audit-log.ts`, `player-identity.ts` and
// `club-leadership.ts`), which opens a real connection pool at module load
// (`src/db/client.ts:47`) and throws when `DATABASE_URL` is unset -- exactly
// the reason `tests/admin-fixture-actions.test.ts` mocks both before
// importing the module under test. Nothing here exercises a query; the mock
// only lets the module load.
const mocks = vi.hoisted(() => ({ postgres: vi.fn(), sql: vi.fn() }));
vi.mock('postgres', () => ({ default: mocks.postgres }));
vi.mock('@/db/client', () => ({ sql: mocks.sql }));

import { isAllowedLeadershipRevalidatePath } from '@/app/admin/season-lists/revalidate-paths';
import {
  isLeadershipRole,
  isLeadershipStatus,
  leadershipEntityKey,
  LEADERSHIP_ROLES,
  LEADERSHIP_STATUSES,
  normaliseLeadershipDates,
  parseLeadershipEntityKey,
} from '@/db/queries/admin-club-leadership';

describe('the durable key shape (§5, D-8)', () => {
  it('is a minted token under the manual namespace, and round-trips', () => {
    const token = '3f8c2b1e-0a4d-4c9b-9f11-2b7d6e5a9d2a';
    expect(leadershipEntityKey(token)).toBe(`manual_admin_edit:${token}`);
    expect(parseLeadershipEntityKey(leadershipEntityKey(token))).toBe(token);
  });

  it('refuses every shape that is not one', () => {
    for (const bad of ['', 'manual_admin_edit', 'manual_admin_edit:', 'afltables:x', 'token']) {
      expect(parseLeadershipEntityKey(bad), bad).toBeNull();
    }
  });

  it('carries no schedule/role/date fact -- a correction never changes identity', () => {
    const key = leadershipEntityKey('a-token');
    for (const fact of ['captain', 'vice_captain', 'active', 'ended', 'void', '2027-03-18']) {
      expect(key, fact).not.toContain(fact);
    }
  });
});

describe('the role and status vocabularies (§6, §7, D-2, D-3)', () => {
  it('admits exactly captain and vice_captain -- no co_captain, no acting/interim', () => {
    expect(LEADERSHIP_ROLES).toEqual(['captain', 'vice_captain']);
    for (const good of LEADERSHIP_ROLES) expect(isLeadershipRole(good)).toBe(true);
    for (const bad of ['co_captain', 'acting_captain', 'interim', 'Captain', '', 'captains']) {
      expect(isLeadershipRole(bad), bad).toBe(false);
    }
  });

  it('admits exactly active/ended/void -- no DELETE state', () => {
    expect(LEADERSHIP_STATUSES).toEqual(['active', 'ended', 'void']);
    for (const good of LEADERSHIP_STATUSES) expect(isLeadershipStatus(good)).toBe(true);
    for (const bad of ['deleted', 'removed', 'Active', '', 'pending']) {
      expect(isLeadershipStatus(bad), bad).toBe(false);
    }
  });
});

describe('leadership date validation (§7, L-5, D-3)', () => {
  it('treats a blank start and end as genuinely unknown, never a fabricated default', () => {
    expect(normaliseLeadershipDates({})).toEqual({ startedOn: null, endedOn: null });
    expect(normaliseLeadershipDates({ startedOn: '', endedOn: '' }))
      .toEqual({ startedOn: null, endedOn: null });
    expect(normaliseLeadershipDates({ startedOn: '2027-03-18' }))
      .toEqual({ startedOn: '2027-03-18', endedOn: null });
  });

  it('refuses a date the calendar does not have, not merely a badly shaped one', () => {
    // The AFLDB-ISSUE-162 §37.8 lesson, reused: Date.parse() normalises
    // impossible days rather than rejecting them, so '2027-02-30' would read
    // as 2 March. Every string here is well-shaped YYYY-MM-DD; none names a
    // real day.
    for (const bad of [
      '2027-02-30', '2027-02-29', '2027-04-31', '2027-00-10', '2027-13-01', '2027-01-32',
    ]) {
      expect(normaliseLeadershipDates({ startedOn: bad }), bad).toHaveProperty('error');
    }
    // Real days, including a real leap day, are accepted unchanged.
    for (const good of ['2028-02-29', '2000-02-29', '2027-02-28', '2027-12-31']) {
      expect(normaliseLeadershipDates({ startedOn: good }), good)
        .toEqual({ startedOn: good, endedOn: null });
    }
  });

  it('refuses a badly shaped date outright', () => {
    for (const bad of ['18/03/2027', '2027-3-18', 'March 18', '2027/03/18']) {
      expect(normaliseLeadershipDates({ startedOn: bad }), bad).toHaveProperty('error');
    }
  });

  it('refuses an end date before the start date', () => {
    expect(normaliseLeadershipDates({ startedOn: '2027-06-01', endedOn: '2027-05-31' }))
      .toHaveProperty('error');
    expect(normaliseLeadershipDates({ startedOn: '2027-06-01', endedOn: '2027-06-01' }))
      .toEqual({ startedOn: '2027-06-01', endedOn: '2027-06-01' });
    expect(normaliseLeadershipDates({ startedOn: '2027-06-01', endedOn: '2027-06-02' }))
      .toEqual({ startedOn: '2027-06-01', endedOn: '2027-06-02' });
  });

  it('never invents a sentinel date', () => {
    expect(normaliseLeadershipDates({ startedOn: null, endedOn: null }))
      .toEqual({ startedOn: null, endedOn: null });
  });
});

describe('the /admin/season-lists/revalidate allowlist (§21, D-13)', () => {
  it('admits a plain club path', () => {
    for (const good of ['/clubs/richmond', '/clubs/west-coast', '/clubs/gws']) {
      expect(isAllowedLeadershipRevalidatePath(good), good).toBe(true);
    }
  });

  it('refuses everything that is not exactly that shape', () => {
    // computed server-side (§21) -- this allowlist is the last line of
    // defence against a forged or malformed path, never the only one.
    for (const bad of [
      '/clubs/../x', '/clubs/', '/clubs', '/players/1', '/', '/seasons/2027',
      '/clubs/richmond?x=1', '/clubs/Richmond', '/clubs/rich_mond', '//clubs/richmond',
      'clubs/richmond', '/clubs/richmond/', 'https://evil.example/clubs/richmond',
    ]) {
      expect(isAllowedLeadershipRevalidatePath(bad), bad).toBe(false);
    }
  });
});
