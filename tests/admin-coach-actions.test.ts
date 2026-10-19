import { describe, expect, it, vi } from 'vitest';

import { isAllowedRevalidatePath } from '@/app/admin/coaches/revalidate-paths';
import { optionalText, parseAssignments, parsePositiveInt } from '@/app/admin/coaches/validation';
import {
  assignmentOverrideEntityKey,
  coachDobError,
  coachOverrideEntityKey,
  createCoach,
  saveCoachMetadata,
} from '@/db/queries/admin-coaches';

// A DB-free unit file: the paths under test refuse before any query. `@/db/client` builds its pool
// at import and throws without DATABASE_URL, which the D5 test-DSN policy removes when no test
// database is configured, so the module is replaced; a test that reached the database would throw.
vi.mock('@/db/client', () => ({
  sql: () => {
    throw new Error('DB-free unit test reached the database client');
  },
}));

/**
 * Admin action unit contracts for coach administration (AFLDB-ISSUE-159
 * §10.1, §10.2 gate 7). Pure, DB-free: form-parsing validation and the
 * `entity_key` shapes every mutation and every read (§1.1, §5.2, §6.1) must
 * agree on. Duplicate-candidate and link-refusal decisions themselves query
 * the database and are exercised by the integration suite
 * (`tests/integration/admin-coaches.test.ts`), not here.
 */

describe('coachOverrideEntityKey', () => {
  it('namespaces a source-owned coach under afltables:', () => {
    expect(coachOverrideEntityKey('coaches/Chris_Fagan0.html')).toBe('afltables:coaches/Chris_Fagan0.html');
  });

  it('namespaces a manual coach under manual_admin_edit: and strips the manual: prefix', () => {
    expect(coachOverrideEntityKey('manual:2fa1c9e0-1111-4a1a-9c3b-000000000000'))
      .toBe('manual_admin_edit:2fa1c9e0-1111-4a1a-9c3b-000000000000');
  });
});

describe('assignmentOverrideEntityKey', () => {
  it('joins the match key and the club slug with a single pipe', () => {
    expect(assignmentOverrideEntityKey('1902|1|1902-05-03|Carlton|Geelong', 'carlton'))
      .toBe('1902|1|1902-05-03|Carlton|Geelong|carlton');
  });
});

describe('coachDobError (AFLDB-ISSUE-288)', () => {
  it('accepts a blank (null) date of birth', () => {
    expect(coachDobError(null)).toBeNull();
  });

  it('accepts real calendar dates, including leap days', () => {
    for (const dob of ['1980-12-31', '1900-01-01', '2024-02-29', '2000-02-29', '1896-02-29', '2025-04-30']) {
      expect(coachDobError(dob)).toBeNull();
    }
  });

  it('refuses a 29 February outside a leap year, century years included', () => {
    for (const dob of ['2023-02-29', '1900-02-29', '2100-02-29']) {
      expect(coachDobError(dob)).toBe(`Date of birth "${dob}" is not a real date. Use YYYY-MM-DD.`);
    }
  });

  it('checks years 0001-0099 as themselves, not as Date.UTC\'s 1900-1999', () => {
    // Date.UTC(50, 1, 29) is 1 March 1950, so a round trip refused these; they are real dates.
    for (const dob of ['0001-01-01', '0050-06-15', '0099-12-31', '0004-02-29', '0400-02-29', '9999-12-31']) {
      expect(coachDobError(dob)).toBeNull();
    }
    // Not leap years in their own right (Date.UTC would test 1950, 1999 and 1900 instead).
    for (const dob of ['0050-02-29', '0099-02-29', '0100-02-29', '0001-02-29']) {
      expect(coachDobError(dob)).toBe(`Date of birth "${dob}" is not a real date. Use YYYY-MM-DD.`);
    }
  });

  it('refuses year 0000, which PostgreSQL\'s date input rejects', () => {
    for (const dob of ['0000-01-01', '0000-02-29', '0000-12-31']) {
      expect(coachDobError(dob)).toBe(`Date of birth "${dob}" is not a real date. Use YYYY-MM-DD.`);
    }
  });

  it('refuses impossible month and day combinations', () => {
    for (const dob of ['2026-02-30', '2025-04-31', '2025-06-31', '2025-09-31', '2025-11-31', '2025-01-32',
      '2025-13-01', '2025-00-10', '2025-01-00']) {
      expect(coachDobError(dob)).not.toBeNull();
    }
  });

  it('refuses anything that is not strict YYYY-MM-DD', () => {
    for (const dob of ['31/12/1980', 'x', '2027-2-3', '1980-1-01', '1980-01-1', '', ' 1980-01-01', '19800101']) {
      expect(coachDobError(dob)).not.toBeNull();
    }
  });
});

describe('coach mutations refuse an impossible dob before any SQL (AFLDB-ISSUE-288)', () => {
  // Without the guard each call reaches SQL: against a placeholder DSN it
  // rejects on connection, and against afldb_test the `::date` cast rejects
  // (createCoach) or the edit fails with a different sentence (no such coach),
  // so only an up-front refusal produces exactly this result.
  const base = { displayName: 'ISSUE-288 Probe', givenName: null, surname: null, notes: null, adminUserId: 1 };

  it('createCoach returns the refusal instead of throwing', async () => {
    for (const dob of ['2026-02-30', '2023-02-29', '31/12/1980']) {
      await expect(createCoach({ ...base, dob })).resolves.toEqual({
        ok: false,
        error: `Date of birth "${dob}" is not a real date. Use YYYY-MM-DD.`,
      });
    }
  });

  it('saveCoachMetadata returns the refusal, not a PostgreSQL message', async () => {
    for (const dob of ['2026-02-30', '2025-04-31', 'x']) {
      await expect(saveCoachMetadata({ ...base, coachId: 2147483646, dob })).resolves.toEqual({
        ok: false,
        error: `Date of birth "${dob}" is not a real date. Use YYYY-MM-DD.`,
      });
    }
  });
});

describe('parsePositiveInt', () => {
  it('accepts a positive integer', () => {
    expect(parsePositiveInt('7')).toBe(7);
  });

  it('rejects zero, negative, non-integer and empty values', () => {
    expect(parsePositiveInt('0')).toBeNull();
    expect(parsePositiveInt('-3')).toBeNull();
    expect(parsePositiveInt('1.5')).toBeNull();
    expect(parsePositiveInt('')).toBeNull();
    expect(parsePositiveInt(null)).toBeNull();
    expect(parsePositiveInt('not-a-number')).toBeNull();
  });
});

describe('optionalText', () => {
  it('trims and returns non-empty text', () => {
    expect(optionalText('  hello  ', 100)).toBe('hello');
  });

  it('returns null for empty or whitespace-only text', () => {
    expect(optionalText('   ', 100)).toBeNull();
    expect(optionalText(null, 100)).toBeNull();
  });

  it('truncates to the given max length', () => {
    expect(optionalText('abcdef', 3)).toBe('abc');
  });
});

describe('isAllowedRevalidatePath', () => {
  it('accepts every shape the interaction contract (§9) names', () => {
    expect(isAllowedRevalidatePath('/coaches')).toBe(true);
    expect(isAllowedRevalidatePath('/records/coaches')).toBe(true);
    expect(isAllowedRevalidatePath('/sitemap.xml')).toBe(true);
    expect(isAllowedRevalidatePath('/coaches/chris-fagan-123')).toBe(true);
    expect(isAllowedRevalidatePath('/clubs/carlton')).toBe(true);
    expect(isAllowedRevalidatePath('/players/chris-fagan-456')).toBe(true);
    expect(isAllowedRevalidatePath('/matches/9001')).toBe(true);
  });

  it('refuses a path with no matching shape, however plausible-looking', () => {
    expect(isAllowedRevalidatePath('/admin/coaches')).toBe(false);
    expect(isAllowedRevalidatePath('/seasons/2026')).toBe(false);
    expect(isAllowedRevalidatePath('/')).toBe(false);
    expect(isAllowedRevalidatePath('')).toBe(false);
    // A coach/player path is <slug>-<id>: no trailing id is refused, not
    // silently widened to "anything under /coaches/".
    expect(isAllowedRevalidatePath('/coaches/chris-fagan')).toBe(false);
  });

  it('refuses path traversal, a scheme/host, and a query or fragment', () => {
    expect(isAllowedRevalidatePath('/coaches/../../etc/passwd')).toBe(false);
    expect(isAllowedRevalidatePath('//evil.example.com')).toBe(false);
    expect(isAllowedRevalidatePath('https://evil.example.com/coaches')).toBe(false);
    expect(isAllowedRevalidatePath('/coaches/chris-fagan-123?x=1')).toBe(false);
    expect(isAllowedRevalidatePath('/coaches/chris-fagan-123#x')).toBe(false);
    expect(isAllowedRevalidatePath('/clubs/carlton/../../admin')).toBe(false);
  });

  it('refuses a case or character mismatch rather than normalising it', () => {
    expect(isAllowedRevalidatePath('/Coaches')).toBe(false);
    expect(isAllowedRevalidatePath('/clubs/Carlton')).toBe(false);
    expect(isAllowedRevalidatePath('/clubs/carlton ')).toBe(false);
    expect(isAllowedRevalidatePath('/matches/9001a')).toBe(false);
  });
});

describe('parseAssignments', () => {
  it('parses a single match:club pair', () => {
    expect(parseAssignments('101:5')).toEqual([{ matchId: 101, clubId: 5 }]);
  });

  it('parses several pairs for the "apply to every listed match" control', () => {
    expect(parseAssignments('101:5,102:5,103:5')).toEqual([
      { matchId: 101, clubId: 5 },
      { matchId: 102, clubId: 5 },
      { matchId: 103, clubId: 5 },
    ]);
  });

  it('refuses an empty list', () => {
    expect(parseAssignments('')).toBeNull();
    expect(parseAssignments(null)).toBeNull();
  });

  it('refuses a malformed pair rather than silently dropping it', () => {
    expect(parseAssignments('101:5,not-a-pair')).toBeNull();
    expect(parseAssignments('101:0')).toBeNull();
    expect(parseAssignments('-1:5')).toBeNull();
  });
});
