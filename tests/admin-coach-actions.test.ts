import { describe, expect, it } from 'vitest';

import { isAllowedRevalidatePath } from '@/app/admin/coaches/revalidate-paths';
import { optionalText, parseAssignments, parsePositiveInt } from '@/app/admin/coaches/validation';
import { assignmentOverrideEntityKey, coachOverrideEntityKey } from '@/db/queries/admin-coaches';

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
