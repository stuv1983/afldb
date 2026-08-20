import { describe, expect, it } from 'vitest';

import { validateAdminMatchNumbers } from '@/lib/admin-match';

describe('new match numeric validation', () => {
  it('accepts complete components or an explicit total', () => {
    expect(validateAdminMatchNumbers({
      homeGoals: 12,
      homeBehinds: 8,
      homeScore: 80,
      awayScore: 65,
      attendance: 0,
    })).toBeNull();
  });

  it.each([
    [{ homeScore: -1, awayScore: 1 }, 'Home total score'],
    [{ homeScore: 1.5, awayScore: 1 }, 'Home total score'],
    [{ homeScore: Number.POSITIVE_INFINITY, awayScore: 1 }, 'Home total score'],
    [{ homeGoals: 3, awayScore: 1 }, 'Home score requires'],
    [{ homeGoals: 3, homeBehinds: 2, homeScore: 19, awayScore: 1 }, 'must equal'],
    [{ homeScore: 1, awayScore: 1, attendance: -1 }, 'Attendance'],
    [{ homeScore: 1, awayScore: 1, homeQuarters: { 1: { goals: -1 } } }, 'Home Q1 goals'],
    [{
      homeScore: 1,
      awayScore: 1,
      awayQuarters: { 4: { goals: 10, behinds: 5, points: 64 } },
    }, 'Away Q4 points must equal'],
  ])('rejects unsafe or semantically inconsistent numbers', (input, message) => {
    expect(validateAdminMatchNumbers(input)).toContain(message);
  });
});
