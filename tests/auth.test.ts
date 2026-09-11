import { readdirSync, readFileSync } from 'node:fs';
import { basename, join, relative, sep } from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// The audit suite at the foot of this file, and the requireCapability
// suite (AFLDB-ISSUE-158), exercise the real src/lib/auth/session.ts, which
// binds the auth pool, reads request headers and redirects through
// next/navigation. All three are replaced here so the writer and the guard
// can be observed without a database and without a Next.js request scope;
// nothing else in this file touches those modules.
type CapturedQuery = { strings: string[]; values: unknown[] };

/**
 * What postgres.js's own `sql.json()` returns: the raw value tagged with the
 * jsonb OID, so the driver encodes it exactly once at Bind time. Both fake
 * handles below expose it, because a jsonb column bound any other way is the
 * AFLDB-ISSUE-119 double-encoding defect.
 */
const jsonParameter = vi.hoisted(() => (
  (value: unknown) => ({ type: 3802, value }) as unknown as import('postgres').Parameter
));

const poolQueries = vi.hoisted(() => [] as CapturedQuery[]);
/**
 * The auth_sessions JOIN auth_users row getAdminUser() should find, if any.
 * Left null, every statement returns no rows, as it always did.
 */
const sessionRow = vi.hoisted(() => ({
  row: null as null | {
    id: number; email: string; role: 'contributor' | 'admin' | 'super_admin';
    canManageAdmins: boolean; mustChangePassword: boolean;
  },
}));
vi.mock('@/db/authClient', () => {
  const sql = (strings: TemplateStringsArray, ...values: unknown[]) => {
    poolQueries.push({ strings: [...strings], values });
    if (sessionRow.row && strings.join('').includes('FROM auth_sessions s')) {
      return Promise.resolve([sessionRow.row]);
    }
    return Promise.resolve([]);
  };
  sql.json = jsonParameter;
  return { authSql: sql };
});

const requestHeaders = vi.hoisted(() => ({
  forwardedFor: null as string | null,
  outsideRequestScope: false,
}));
/** The signed admin cookie a test wants getAdminUser() to read, if any. */
const requestCookie = vi.hoisted(() => ({ admin: null as string | null }));
vi.mock('next/headers', () => ({
  headers: async () => {
    // What next/headers actually does outside a request scope, which is
    // the case requestIp() exists to absorb.
    if (requestHeaders.outsideRequestScope) throw new Error('called outside a request scope');
    return { get: (name: string) => (name === 'x-forwarded-for' ? requestHeaders.forwardedFor : null) };
  },
  cookies: async () => ({
    get: () => (requestCookie.admin === null ? undefined : { value: requestCookie.admin }),
    delete: () => undefined,
  }),
}));
// What Next's redirect() does: throw. The message carries the target so a
// test can tell /admin/upload from /admin from /admin/login.
vi.mock('next/navigation', () => ({
  redirect: (to: string): never => { throw new Error(`NEXT_REDIRECT ${to}`); },
}));

import type postgres from 'postgres';

import { adminNavFor, isCurrentAdminPath, type AdminNavViewer } from '@/app/admin/nav-model';
import {
  LIFECYCLE_AUDIT_ACTION,
  canActOnLifecycle,
  isActive,
  isViableSuperAdmin,
  lifecycleEligibility,
  lifecycleMessage,
  lifecycleTransition,
  normaliseLifecycleReason,
  type LifecycleAccountState,
} from '@/lib/auth/admin-lifecycle';
import { hasCapability, type Capability, type CapabilityViewer } from '@/lib/auth/capabilities';
import { audit, auditInTransaction, getAdminUser, requireCapability } from '@/lib/auth/session';
import {
  MIN_PASSWORD_LENGTH,
  generateTemporaryPassword,
  generateTotpSecret,
  hashPassword,
  sha256Hex,
  verifyPassword,
  verifyTotp,
  verifyTotpStep,
} from '@/lib/auth/crypto';
import { BACKSPACE, DELETE, applyEditing, takeLine } from '@/lib/auth/line-input';
import { signClaim, verifyClaim, type AccessClaim } from '@/lib/auth/tokens';
import { CsvError, parseCsv, toObjects } from '@/lib/ingest/csv';

describe('password hashing', () => {
  it('round-trips and rejects a wrong password', async () => {
    const hash = await hashPassword('correct horse battery staple');
    expect(hash.startsWith('scrypt$32768$8$1$')).toBe(true);
    expect(await verifyPassword('correct horse battery staple', hash)).toBe(true);
    expect(await verifyPassword('correct horse battery stapl', hash)).toBe(false);
  });

  it('rejects malformed stored hashes rather than throwing', async () => {
    expect(await verifyPassword('x', 'not-a-hash')).toBe(false);
    expect(await verifyPassword('x', 'scrypt$bad')).toBe(false);
  });
});

describe('temporary passwords', () => {
  it('is long enough to be accepted by the form it will be typed into', () => {
    // The change-password form applies MIN_PASSWORD_LENGTH, and so does the
    // invite flow. A generated password shorter than that would be a
    // credential the application refuses to let anyone re-enter.
    const password = generateTemporaryPassword();
    expect(password.length).toBeGreaterThanOrEqual(MIN_PASSWORD_LENGTH);
    expect(password).toMatch(/^[A-Za-z0-9]{4}-[A-Za-z0-9]{4}-[A-Za-z0-9]{4}$/);
  });

  it('omits the characters nobody can tell apart when reading one out', () => {
    // These are dictated over a phone as often as they are copied, and
    // `I/l/1` or `O/0` costs a support conversation rather than security.
    const sample = Array.from({ length: 200 }, generateTemporaryPassword).join('');
    expect(sample).not.toMatch(/[IlO01o]/);
  });

  it('does not repeat itself', () => {
    const issued = new Set(Array.from({ length: 200 }, generateTemporaryPassword));
    expect(issued.size).toBe(200);
  });
});

describe('TOTP (RFC 6238 SHA-1 test vectors, truncated to 6 digits)', () => {
  const SECRET = 'GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ'; // "12345678901234567890"

  it.each([
    [59_000, '287082'],
    [1_111_111_109_000, '081804'],
    [1_234_567_890_000, '005924'],
    [2_000_000_000_000, '279037'],
  ])('at t=%dms the code is %s', (now, code) => {
    expect(verifyTotp(SECRET, code, now)).toBe(true);
  });

  it('accepts one step of clock drift and no more', () => {
    // 287082 is the code for step floor(59/30)=1 (t 30–59s).
    expect(verifyTotp(SECRET, '287082', 89_000)).toBe(true);   // next step
    expect(verifyTotp(SECRET, '287082', 121_000)).toBe(false); // two steps on
  });

  it('rejects junk', () => {
    expect(verifyTotp(SECRET, 'abcdef', 59_000)).toBe(false);
    expect(verifyTotp(SECRET, '28708', 59_000)).toBe(false);
  });

  it('reports which step a code matched, so a code can be spent once', () => {
    // The login path stores this and requires the next code to come from
    // a strictly later step (RFC 6238 §5.2). Without the step number
    // there is nothing to compare against and a captured code stays
    // valid for the whole ±1 window.
    expect(verifyTotpStep(SECRET, '287082', 59_000)).toBe(1);
    // The same code one step later is still accepted as drift — and
    // still reports step 1, so the replay check sees it is not newer.
    expect(verifyTotpStep(SECRET, '287082', 89_000)).toBe(1);
    expect(verifyTotpStep(SECRET, 'abcdef', 59_000)).toBeNull();
  });

  it('generates 32-character base32 secrets', () => {
    const secret = generateTotpSecret();
    expect(secret).toMatch(/^[A-Z2-7]{32}$/);
    expect(generateTotpSecret()).not.toBe(secret);
  });
});

describe('signed access claims', () => {
  const SECRET = 's'.repeat(48);
  const claim = (over: Partial<AccessClaim> = {}): AccessClaim => ({
    v: 1, kind: 'beta', sub: 'code:1',
    exp: Math.floor(Date.now() / 1000) + 600, epoch: 1, ...over,
  });

  it('round-trips a valid claim', async () => {
    const token = await signClaim(claim(), SECRET);
    const verified = await verifyClaim(token, SECRET, { kind: 'beta', minEpoch: 1 });
    expect(verified?.sub).toBe('code:1');
  });

  it('rejects a tampered payload', async () => {
    const token = await signClaim(claim(), SECRET);
    const [payload, mac] = token.split('.');
    const forged = Buffer.from(
      JSON.stringify({ ...claim(), sub: 'code:999' }),
    ).toString('base64url');
    expect(await verifyClaim(`${forged}.${mac}`, SECRET, { kind: 'beta' })).toBeNull();
    expect(await verifyClaim(`${payload}.AAAA`, SECRET, { kind: 'beta' })).toBeNull();
  });

  it('rejects the wrong kind, an old epoch, an expiry in the past and the wrong secret', async () => {
    expect(await verifyClaim(await signClaim(claim(), SECRET), SECRET, { kind: 'admin' })).toBeNull();
    expect(await verifyClaim(
      await signClaim(claim({ epoch: 1 }), SECRET), SECRET, { kind: 'beta', minEpoch: 2 },
    )).toBeNull();
    expect(await verifyClaim(
      await signClaim(claim({ exp: Math.floor(Date.now() / 1000) - 10 }), SECRET),
      SECRET, { kind: 'beta' },
    )).toBeNull();
    expect(await verifyClaim(await signClaim(claim(), SECRET), 'x'.repeat(48), { kind: 'beta' }))
      .toBeNull();
  });
});

describe('sha256Hex', () => {
  it('matches a known digest', () => {
    expect(sha256Hex('abc'))
      .toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
  });
});

describe('hidden-prompt line input', () => {
  it('returns null until a complete line arrives', () => {
    expect(takeLine('partial')).toBeNull();
    expect(takeLine('')).toBeNull();
  });

  it('splits one line and keeps the remainder for the next prompt', () => {
    // The bug this guards: a paste delivers the password AND its
    // confirmation in a single chunk. Dropping `rest` left the confirm
    // prompt waiting forever for input that had already arrived.
    expect(takeLine('first\nsecond\n')).toEqual({ line: 'first', rest: 'second\n' });
    expect(takeLine('second\n')).toEqual({ line: 'second', rest: '' });
  });

  it('treats CRLF as one terminator, not an empty second line', () => {
    expect(takeLine('first\r\nsecond\r\n')).toEqual({ line: 'first', rest: 'second\r\n' });
    expect(takeLine('only\r')).toEqual({ line: 'only', rest: '' });
  });

  it('applies backspace and delete, and drops stray control codes', () => {
    const bs = String.fromCharCode(BACKSPACE);
    const del = String.fromCharCode(DELETE);
    // Typed "passwrd", noticed the typo, erased "rd", typed "ord".
    expect(applyEditing(`passwrd${del}${del}ord`)).toBe('password');
    expect(applyEditing(`abc${bs}`)).toBe('ab');
    expect(applyEditing(`${bs}${bs}abc`)).toBe('abc');   // nothing to erase
    expect(applyEditing('tab\there')).toBe('tabhere');   // 0x09 dropped
  });

  it('preserves spaces and punctuation in a password', () => {
    expect(applyEditing('a long P@ss w0rd!')).toBe('a long P@ss w0rd!');
  });
});

describe('CSV parsing', () => {
  it('parses quoted fields, escaped quotes, CRLF and a BOM', () => {
    const table = parseCsv('﻿name,note\r\n"O\'\'Brien, Jack","said ""hello"""\r\nplain,\r\n');
    expect(table.header).toEqual(['name', 'note']);
    expect(table.rows).toEqual([
      ["O''Brien, Jack", 'said "hello"'],
      ['plain', ''],
    ]);
    expect(toObjects(table)).toEqual([
      { name: "O''Brien, Jack", note: 'said "hello"' },
      { name: 'plain', note: null },
    ]);
  });

  it('rejects ragged rows with the offending line number', () => {
    expect(() => parseCsv('a,b\n1,2\n1,2,3\n')).toThrowError(CsvError);
    try {
      parseCsv('a,b\n1,2\n1,2,3\n');
    } catch (error) {
      expect((error as CsvError).line).toBe(3);
    }
  });

  it('rejects an unterminated quote and an empty file', () => {
    expect(() => parseCsv('a,b\n"unclosed,2\n')).toThrowError(/unterminated/);
    expect(() => parseCsv('')).toThrowError(/empty/);
  });
});

/**
 * The Admin Centre capability policy (AFLDB-ISSUE-155 Phase A):
 * src/lib/auth/capabilities.ts, and the nav grouping in
 * src/app/admin/nav-model.ts that is built from it. Both are pure and
 * request-scope-free, like the other modules tested above.
 */
describe('capability policy', () => {
  const viewer = (role: CapabilityViewer['role'], canManageAdmins = false): CapabilityViewer => (
    { role, canManageAdmins }
  );

  const SUPER_ADMIN_ONLY: Capability[] = [
    'data.playerLinks', 'data.dataEditor', 'acquisition.currentSeason',
    'site.content', 'site.settings', 'operations.queryBuilder',
    'operations.dbHealth', 'operations.appHealth', 'operations.nlTelemetry',
    'people.admins.lifecycle', 'data.brownlow.finalise',
  ];

  it('opens legacy intake to every staff role, including a contributor', () => {
    for (const role of ['contributor', 'admin', 'super_admin'] as const) {
      expect(hasCapability(viewer(role), 'acquisition.legacyIntake')).toBe(true);
    }
  });

  it('reserves the super-admin-only capabilities from a contributor and a plain admin', () => {
    for (const capability of SUPER_ADMIN_ONLY) {
      expect(hasCapability(viewer('contributor'), capability)).toBe(false);
      expect(hasCapability(viewer('admin'), capability)).toBe(false);
      expect(hasCapability(viewer('super_admin'), capability)).toBe(true);
    }
  });

  it('opens beta access and the admin list to any admin, but not a contributor', () => {
    for (const capability of ['people.betaAccess', 'people.admins.read'] as const) {
      expect(hasCapability(viewer('contributor'), capability)).toBe(false);
      expect(hasCapability(viewer('admin'), capability)).toBe(true);
      expect(hasCapability(viewer('super_admin'), capability)).toBe(true);
    }
  });

  it('never delegates admin management to a contributor, flag or no flag (AFLDB-ISSUE-158)', () => {
    // requireAdminManager() bounced a contributor at requireAdmin() before
    // it ever read can_manage_admins. Now that the capability is the guard
    // for invites and temporary passwords it must draw the same line, or
    // the migration would have loosened it.
    expect(hasCapability(viewer('contributor', false), 'people.admins.manage')).toBe(false);
    expect(hasCapability(viewer('contributor', true), 'people.admins.manage')).toBe(false);
  });

  it('delegates admin management to a plain admin only when can_manage_admins is set', () => {
    // Mirrors hasAdminManagementAccess() in session.ts exactly: this is the
    // one capability a role list alone cannot express.
    expect(hasCapability(viewer('admin', false), 'people.admins.manage')).toBe(false);
    expect(hasCapability(viewer('admin', true), 'people.admins.manage')).toBe(true);
    expect(hasCapability(viewer('super_admin', false), 'people.admins.manage')).toBe(true);
  });

  it('does not let the admin-management delegation reach the account lifecycle', () => {
    // The whole point of the Phase B split: can_manage_admins keeps its
    // invite and password-reset reach and gains no promote, demote,
    // deactivate or reactivate power (§26.3). If this ever passes for a
    // delegated admin, the delegation has become a second super admin.
    expect(hasCapability(viewer('admin', true), 'people.admins.lifecycle')).toBe(false);
    expect(hasCapability(viewer('admin', true), 'people.admins.manage')).toBe(true);
    expect(hasCapability(viewer('super_admin', false), 'people.admins.lifecycle')).toBe(true);
  });

  it('splits Brownlow drafting from finalisation (§27.8)', () => {
    // Decision 1 of §25, adopted as Option A: an Admin may read and draft --
    // work that reaches no public query -- but only a Super Admin may
    // finalise, correct, void or publish, which is the moment a vote becomes
    // a public statistical fact.
    for (const capability of ['data.brownlow.read', 'data.brownlow.draft'] as const) {
      expect(hasCapability(viewer('contributor'), capability)).toBe(false);
      expect(hasCapability(viewer('admin'), capability)).toBe(true);
      expect(hasCapability(viewer('super_admin'), capability)).toBe(true);
    }
    expect(hasCapability(viewer('admin'), 'data.brownlow.finalise')).toBe(false);
    expect(hasCapability(viewer('super_admin'), 'data.brownlow.finalise')).toBe(true);
  });

  it('does not let the admin-management delegation reach Brownlow finalisation', () => {
    // can_manage_admins is a people delegation; it must not become a data one.
    expect(hasCapability(viewer('admin', true), 'data.brownlow.finalise')).toBe(false);
    expect(hasCapability(viewer('admin', true), 'data.brownlow.draft')).toBe(true);
  });

  it('opens the audit trail to any admin and never to a contributor (AFLDB-ISSUE-157)', () => {
    // ISSUE-156 §2: read-only inspection of auth_audit_log and data_edits is
    // Admin-and-up. A contributor reaches one route (upload) and this is not
    // it; nothing about the viewer is delegated by can_manage_admins either
    // way, because the plain role list already includes every admin.
    expect(hasCapability(viewer('contributor'), 'operations.audit.read')).toBe(false);
    expect(hasCapability(viewer('contributor', true), 'operations.audit.read')).toBe(false);
    expect(hasCapability(viewer('admin'), 'operations.audit.read')).toBe(true);
    expect(hasCapability(viewer('super_admin'), 'operations.audit.read')).toBe(true);
  });
});

/**
 * The account lifecycle policy (AFLDB-ISSUE-155 Phase B §26.5, §26.6,
 * §26.10): src/lib/auth/admin-lifecycle.ts, the one module the controls,
 * the transaction and these tests all read the rules from.
 */
describe('admin lifecycle policy', () => {
  const account = (over: Partial<LifecycleAccountState> = {}): LifecycleAccountState => ({
    id: 1,
    role: 'super_admin',
    disabledAt: null,
    hasPassword: true,
    hasTotp: true,
    canManageAdmins: false,
    ...over,
  });

  const superAdmin = account({ id: 1 });
  const otherSuperAdmin = account({ id: 2 });
  const plainAdmin = account({ id: 3, role: 'admin' });
  const contributor = account({ id: 4, role: 'contributor' });

  describe('viability', () => {
    it('counts an enabled, fully enrolled super admin, temporary password or not', () => {
      expect(isViableSuperAdmin(otherSuperAdmin)).toBe(true);
      // must_change_password is not part of the predicate on purpose: the
      // holder can sign in and replace it, so the site is not stranded.
      expect(isViableSuperAdmin(account({ id: 5 }))).toBe(true);
    });

    it('never counts a disabled, half-enrolled or lower-ranked account', () => {
      expect(isViableSuperAdmin(account({ disabledAt: new Date('2026-09-01') }))).toBe(false);
      expect(isViableSuperAdmin(account({ hasPassword: false }))).toBe(false);
      expect(isViableSuperAdmin(account({ hasTotp: false }))).toBe(false);
      expect(isViableSuperAdmin(plainAdmin)).toBe(false);
      expect(isViableSuperAdmin(contributor)).toBe(false);
    });

    it('reads disabled_at as the active flag, exactly as getAdminUser does', () => {
      expect(isActive(account())).toBe(true);
      expect(isActive(account({ disabledAt: '2026-09-01T00:00:00.000Z' }))).toBe(false);
    });
  });

  describe('who may act', () => {
    it('admits only an enabled super admin', () => {
      expect(canActOnLifecycle(superAdmin)).toBe(true);
      expect(canActOnLifecycle(plainAdmin)).toBe(false);
      expect(canActOnLifecycle(account({ role: 'admin', canManageAdmins: true }))).toBe(false);
      expect(canActOnLifecycle(contributor)).toBe(false);
      expect(canActOnLifecycle(account({ disabledAt: new Date() }))).toBe(false);
    });

    it('refuses every action to a non-super-admin actor', () => {
      const eligibility = lifecycleEligibility(plainAdmin, otherSuperAdmin, 5);
      for (const action of ['promote', 'demote', 'deactivate', 'reactivate'] as const) {
        expect(eligibility[action]).toEqual({ allowed: false, reason: 'forbidden' });
      }
    });

    it('agrees with the capability table about who holds the lifecycle', () => {
      // Two statements of one rule; a test rather than a comment, because
      // the guard is requireSuperAdmin() and the table must not drift into
      // describing something looser.
      for (const viewer of [superAdmin, plainAdmin, contributor,
        account({ id: 6, role: 'admin', canManageAdmins: true })]) {
        expect(canActOnLifecycle(viewer)).toBe(
          hasCapability(
            { role: viewer.role, canManageAdmins: viewer.canManageAdmins },
            'people.admins.lifecycle',
          ) && isActive(viewer),
        );
      }
    });
  });

  describe('promotion', () => {
    it('offers promotion for an active plain admin only', () => {
      expect(lifecycleEligibility(superAdmin, plainAdmin, 1).promote).toEqual({ allowed: true });
      expect(lifecycleEligibility(superAdmin, otherSuperAdmin, 1).promote)
        .toEqual({ allowed: false, reason: 'invalid_state' });
      expect(lifecycleEligibility(superAdmin, contributor, 1).promote)
        .toEqual({ allowed: false, reason: 'invalid_state' });
      expect(lifecycleEligibility(superAdmin, account({ id: 7, role: 'admin', disabledAt: new Date() }), 1).promote)
        .toEqual({ allowed: false, reason: 'invalid_state' });
    });

    it('leaves can_manage_admins alone and lands on super_admin', () => {
      expect(lifecycleTransition('promote', account({ role: 'admin', canManageAdmins: true })))
        .toEqual({ role: 'super_admin', active: true, canManageAdmins: true });
    });
  });

  describe('demotion', () => {
    it('needs another viable super admin to remain', () => {
      expect(lifecycleEligibility(superAdmin, otherSuperAdmin, 1).demote)
        .toEqual({ allowed: true });
      expect(lifecycleEligibility(superAdmin, otherSuperAdmin, 0).demote)
        .toEqual({ allowed: false, reason: 'last_super_admin' });
    });

    it('refuses your own account before it counts anything', () => {
      // Fail-safe (§26.6): "I demoted myself and the other super admin is
      // on leave" must not be a recovery incident, and the count cannot
      // protect against it while two super admins exist.
      expect(lifecycleEligibility(superAdmin, superAdmin, 3).demote)
        .toEqual({ allowed: false, reason: 'self' });
    });

    it('clears the admin-management delegation on the way down', () => {
      expect(lifecycleTransition('demote', account({ canManageAdmins: true })))
        .toEqual({ role: 'admin', active: true, canManageAdmins: false });
    });
  });

  describe('deactivation', () => {
    it('refuses your own account', () => {
      expect(lifecycleEligibility(superAdmin, superAdmin, 3).deactivate)
        .toEqual({ allowed: false, reason: 'self' });
    });

    it('applies the invariant to a super admin target and to no one else', () => {
      expect(lifecycleEligibility(superAdmin, otherSuperAdmin, 0).deactivate)
        .toEqual({ allowed: false, reason: 'last_super_admin' });
      expect(lifecycleEligibility(superAdmin, otherSuperAdmin, 1).deactivate)
        .toEqual({ allowed: true });
      // A plain admin or contributor is never the last super admin,
      // whatever the count says.
      expect(lifecycleEligibility(superAdmin, plainAdmin, 0).deactivate).toEqual({ allowed: true });
      expect(lifecycleEligibility(superAdmin, contributor, 0).deactivate)
        .toEqual({ allowed: true });
    });

    it('protects a super admin who has lost their own credentials too', () => {
      // The predicate asks what is LEFT, not what is being removed: a
      // half-enrolled super admin is not viable, but deactivating them
      // still cannot be the mutation that empties the set.
      const unenrolled = account({ id: 8, hasTotp: false });
      expect(lifecycleEligibility(superAdmin, unenrolled, 0).deactivate)
        .toEqual({ allowed: false, reason: 'last_super_admin' });
    });

    it('keeps the role and the flag, and only ends the account', () => {
      expect(lifecycleTransition('deactivate', account({ canManageAdmins: true })))
        .toEqual({ role: 'super_admin', active: false, canManageAdmins: true });
    });
  });

  describe('reactivation', () => {
    const disabled = account({ id: 9, role: 'admin', disabledAt: new Date('2026-09-01') });

    it('is offered for a deactivated account and refused for a live one', () => {
      expect(lifecycleEligibility(superAdmin, disabled, 1).reactivate).toEqual({ allowed: true });
      expect(lifecycleEligibility(superAdmin, plainAdmin, 1).reactivate)
        .toEqual({ allowed: false, reason: 'invalid_state' });
    });

    it('restores the account as it was, and nothing else', () => {
      expect(lifecycleTransition('reactivate', disabled))
        .toEqual({ role: 'admin', active: true, canManageAdmins: false });
    });

    it('offers no other action while the account is deactivated', () => {
      const eligibility = lifecycleEligibility(superAdmin, disabled, 1);
      expect(eligibility.promote).toEqual({ allowed: false, reason: 'invalid_state' });
      expect(eligibility.deactivate).toEqual({ allowed: false, reason: 'invalid_state' });
    });
  });

  describe('wording and input', () => {
    it('names one audit action per mutation', () => {
      expect(LIFECYCLE_AUDIT_ACTION).toEqual({
        promote: 'admin.promoted',
        demote: 'admin.demoted',
        deactivate: 'admin.deactivated',
        reactivate: 'admin.reactivated',
      });
    });

    it('says the account is the last one by name, and never leaks an id', () => {
      expect(lifecycleMessage('last_super_admin', { email: 'boss@example.test' }))
        .toContain('boss@example.test');
      expect(lifecycleMessage('stale')).toMatch(/Reload/);
      expect(lifecycleMessage('self')).toMatch(/your own account/);
    });

    it('requires a short, trimmed deactivation reason', () => {
      expect(normaliseLifecycleReason('  left the project  ')).toBe('left the project');
      expect(normaliseLifecycleReason('  a ')).toBeNull();
      expect(normaliseLifecycleReason('x'.repeat(201))).toBeNull();
      expect(normaliseLifecycleReason(undefined)).toBeNull();
    });
  });
});

/**
 * The source-contract half of "a deactivated account cannot continue"
 * (§26.15). The database half is tests/integration/admin-lifecycle.test.ts;
 * what is proven here is that the per-request lookup still carries both
 * predicates, since everything else in Phase B rests on them.
 */
describe('getAdminUser rejects a disabled account and a revoked session', () => {
  it('asks for both, on every request', async () => {
    process.env.AFLDB_SESSION_SECRET = 'x'.repeat(48);
    requestCookie.admin = await signClaim(
      { v: 1, kind: 'admin', sub: '5:opaque-token', exp: Math.floor(Date.now() / 1000) + 60, epoch: 1 },
      process.env.AFLDB_SESSION_SECRET,
    );
    poolQueries.length = 0;

    await getAdminUser();

    const statement = poolQueries.at(-1)!.strings.join('?');
    expect(statement).toContain('u.disabled_at IS NULL');
    expect(statement).toContain('s.revoked_at IS NULL');
    expect(statement).toContain('s.expires_at > now()');
    requestCookie.admin = null;
  });
});

describe('adminNavFor', () => {
  const idsFor = (v: AdminNavViewer) => adminNavFor(v).map((g) => g.id);
  const hrefsFor = (v: AdminNavViewer) => adminNavFor(v).flatMap((g) => g.links.map((l) => l.href));

  it('gives a contributor exactly the upload form and their own password, nothing else', () => {
    const groups = adminNavFor({ role: 'contributor', canManageAdmins: false });
    expect(groups.map((g) => g.links.map((l) => l.href))).toEqual([
      ['/admin/upload'],
      ['/admin/password'],
    ]);
  });

  it('never lists the grid solver: it left the admin area when audience became a setting', () => {
    for (const role of ['admin', 'super_admin'] as const) {
      const hrefs = hrefsFor({ role, canManageAdmins: false });
      expect(hrefs).not.toContain('/grid-solver');
      expect(hrefs).not.toContain('/admin/grid-solver');
    }
  });

  it('omits a group entirely for a viewer with no capability it contains, rather than showing it empty', () => {
    // A plain admin holds no capability in Site, so that group is absent. The
    // Data group holds Brownlow (AFLDB-ISSUE-155 Phase C2: an Admin may read
    // and draft Brownlow votes, §27.8), Coaches (AFLDB-ISSUE-159 Stage 2:
    // data.coaches.read is ADMIN_AND_UP, §8.1), Draft administration
    // (AFLDB-ISSUE-160 D-6: data.draft.read is ADMIN_AND_UP too) and Season
    // lists (AFLDB-ISSUE-161 §16: data.seasonLists.read is ADMIN_AND_UP too)
    // -- an Admin reaches all four but none of their mutating capabilities.
    // Operations appears from AFLDB-ISSUE-157 and holds exactly the audit
    // trail: every other Operations link is still super-admin-only. Fixtures
    // (AFLDB-ISSUE-162 §23: data.fixtures.read is ADMIN_AND_UP too) joins the
    // same four.
    const groups = adminNavFor({ role: 'admin', canManageAdmins: false });
    expect(groups.map((g) => g.id)).toEqual([
      'overview', 'data', 'acquisition', 'people', 'operations', 'account',
    ]);
    expect(groups.find((g) => g.id === 'data')?.links.map((l) => l.href)).toEqual(['/admin/brownlow', '/admin/coaches', '/admin/draft', '/admin/season-lists', '/admin/fixtures']);
    expect(groups.find((g) => g.id === 'operations')?.links.map((l) => l.href)).toEqual(['/admin/audit']);
  });

  it('lists the audit trail last in Operations for a super admin, and never for a contributor (AFLDB-ISSUE-157)', () => {
    // Gated on operations.audit.read, the capability the route's
    // requireCapability guard enforces; the link is furniture, the guard is
    // the boundary.
    const operations = adminNavFor({ role: 'super_admin', canManageAdmins: false })
      .find((g) => g.id === 'operations');
    expect(operations?.links.at(-1)).toMatchObject({ href: '/admin/audit', label: 'Audit trail' });
    expect(hrefsFor({ role: 'admin', canManageAdmins: false })).toContain('/admin/audit');
    expect(hrefsFor({ role: 'contributor', canManageAdmins: false })).not.toContain('/admin/audit');
  });

  it('gives a super admin every group, in the runbook\'s section order', () => {
    expect(idsFor({ role: 'super_admin', canManageAdmins: false })).toEqual([
      'overview', 'data', 'acquisition', 'people', 'site', 'operations', 'account',
    ]);
  });

  it('shows the Brownlow link to every staff role above contributor, and never to a contributor', () => {
    // Gated on data.brownlow.read (ADMIN_AND_UP), the same capability the
    // route's requireCapability guard enforces.
    expect(hrefsFor({ role: 'admin', canManageAdmins: false })).toContain('/admin/brownlow');
    expect(hrefsFor({ role: 'super_admin', canManageAdmins: false })).toContain('/admin/brownlow');
    expect(hrefsFor({ role: 'contributor', canManageAdmins: false })).not.toContain('/admin/brownlow');
  });

  it('keeps the Data group in section order: data editor, Brownlow, player links, coaches, draft, season lists, fixtures', () => {
    const data = adminNavFor({ role: 'super_admin', canManageAdmins: false }).find((g) => g.id === 'data');
    expect(data?.links.map((l) => l.href)).toEqual([
      '/admin/data-editor', '/admin/brownlow', '/admin/player-links', '/admin/coaches', '/admin/draft', '/admin/season-lists', '/admin/fixtures',
    ]);
  });

  it('groups current-season acquisition with legacy file intake', () => {
    const groups = adminNavFor({ role: 'super_admin', canManageAdmins: false });
    const acquisition = groups.find((g) => g.id === 'acquisition');
    expect(acquisition?.links.map((l) => l.href)).toEqual(['/admin/current-season', '/admin/upload']);
  });

  it('always keeps the account group last, for every non-contributor role', () => {
    for (const role of ['admin', 'super_admin'] as const) {
      const groups = adminNavFor({ role, canManageAdmins: false });
      expect(groups.at(-1)).toMatchObject({ id: 'account', links: [{ href: '/admin/password' }] });
    }
  });
});

describe('isCurrentAdminPath', () => {
  it('matches an exact link only at its own pathname, never a nested one', () => {
    const link = { href: '/admin', label: 'Dashboard', exact: true };
    expect(isCurrentAdminPath('/admin', link)).toBe(true);
    expect(isCurrentAdminPath('/admin/upload', link)).toBe(false);
  });

  it('matches a non-exact link at its own path and any path nested under it', () => {
    const link = { href: '/admin/player-links', label: 'Player links' };
    expect(isCurrentAdminPath('/admin/player-links', link)).toBe(true);
    expect(isCurrentAdminPath('/admin/player-links/123', link)).toBe(true);
    expect(isCurrentAdminPath('/admin/data-editor', link)).toBe(false);
  });
});

/**
 * The canonical auth_audit_log writer, in both its forms (AFLDB-ISSUE-119 §8/§9).
 *
 * `audit()` writes on the auth pool and commits on its own connection.
 * The NL telemetry clear cannot use it: §8 requires the deletion and its
 * audit row to commit together or not at all, and a pooled INSERT would
 * happily survive a rolled-back deletion — or be missing from a
 * committed one. `auditInTransaction()` is that form. These tests are
 * DB-free: the transaction handle is a fake tagged template, so what is
 * proven is which handle the row is written on and what lands in it.
 */
describe('auth_audit_log writer', () => {
  /** Stands in for an authSql.begin() handle: records each tagged-template call. */
  function fakeTx(failure?: Error): { tx: postgres.TransactionSql; queries: CapturedQuery[] } {
    const queries: CapturedQuery[] = [];
    const handle = (strings: TemplateStringsArray, ...values: unknown[]) => {
      queries.push({ strings: [...strings], values });
      return failure ? Promise.reject(failure) : Promise.resolve([]);
    };
    handle.json = jsonParameter;
    const tx = handle as unknown as postgres.TransactionSql;
    return { tx, queries };
  }

  const admin = { userId: 9, label: 'super@example.test' };

  beforeEach(() => {
    poolQueries.length = 0;
    requestHeaders.forwardedFor = null;
    requestHeaders.outsideRequestScope = false;
  });

  it('writes the row on the caller\'s transaction and never on the pool', async () => {
    const { tx, queries } = fakeTx();

    await auditInTransaction(tx, 'nl_search.telemetry_cleared', { deletedLogRows: 412 }, admin);

    // The whole point of the variant: one INSERT, on the handle it was
    // given, so it commits with the mutation or rolls back with it.
    expect(queries).toHaveLength(1);
    expect(queries[0].strings.join('?')).toContain('INSERT INTO auth_audit_log');
    expect(poolQueries).toHaveLength(0);
  });

  it('preserves actor id, email label, action, detail and request IP', async () => {
    // One trusted proxy hop: the last X-Forwarded-For entry is Caddy's own
    // observation, and the earlier entry is whatever the client claimed.
    requestHeaders.forwardedFor = '203.0.113.9, 198.51.100.7';
    const { tx, queries } = fakeTx();

    await auditInTransaction(tx, 'nl_search.telemetry_cleared', { deletedLogRows: 412 }, admin);

    expect(queries[0].values).toEqual([
      9,
      'super@example.test',
      'nl_search.telemetry_cleared',
      jsonParameter({ deletedLogRows: 412 }),
      '198.51.100.7',
    ]);
  });

  it('nulls the actor columns, the detail and an unavailable IP, as the pooled form does', async () => {
    requestHeaders.outsideRequestScope = true;
    const { tx, queries } = fakeTx();

    await auditInTransaction(tx, 'admin.logout', null, {});

    // A missing log column must not fail the action it is recording.
    expect(queries[0].values).toEqual([null, null, 'admin.logout', null, null]);
  });

  it('leaves audit() writing on the pool, unchanged', async () => {
    requestHeaders.forwardedFor = '198.51.100.7';
    const { queries } = fakeTx();

    await audit('nl_search.reviewed', { searchLogId: 5 }, admin);

    expect(poolQueries).toHaveLength(1);
    expect(poolQueries[0].values).toEqual([
      9, 'super@example.test', 'nl_search.reviewed', jsonParameter({ searchLogId: 5 }), '198.51.100.7',
    ]);
    expect(queries).toHaveLength(0);
  });

  it('emits identical SQL from both forms, because there is only one INSERT', async () => {
    const { tx, queries } = fakeTx();

    await audit('admin.login', null, admin);
    await auditInTransaction(tx, 'admin.login', null, admin);

    // If these ever diverge, the trail has two writers that disagree about
    // its shape — which is the reason the SQL is not duplicated.
    expect(queries[0].strings).toEqual(poolQueries[0].strings);
    expect(queries[0].values).toEqual(poolQueries[0].values);
  });

  it('binds detail as a jsonb OBJECT, not a jsonb string, on both forms (AFLDB-ISSUE-119)', async () => {
    // The defect this pins: `${JSON.stringify(detail)}` bound a STRING, and
    // postgres.js then applied its own jsonb serializer -- JSON.stringify --
    // to that string, so the row stored a jsonb string scalar. Live evidence
    // was auth_audit_log id 632: jsonb_typeof(detail) = 'string' and
    // detail->>'deletedLogRows' NULL, on a clear that really did delete 4953
    // rows. Migration 048 repaired the same defect in nl_search_log.
    const detail = { deletedLogRows: 4953, retainedLogRows: 0 };
    const { tx, queries } = fakeTx();

    await auditInTransaction(tx, 'nl_search.telemetry_cleared', detail, admin);
    await audit('nl_search.telemetry_cleared', detail, admin);

    for (const bound of [queries[0].values[3], poolQueries[0].values[3]]) {
      const parameter = bound as { type: number; value: unknown };

      // Not a pre-encoded string, and carrying the jsonb OID so the driver
      // encodes it once rather than a second time.
      expect(typeof bound).not.toBe('string');
      expect(parameter.type).toBe(3802);
      expect(parameter.value).toEqual(detail);

      // What actually reaches PostgreSQL is the driver's single
      // JSON.stringify of parameter.value, and that text is what the server
      // parses into the column. Parsing it here is jsonb_typeof(): an object
      // under the fix, the quoted string scalar under the defect.
      const wire = JSON.stringify(parameter.value);
      const parsed = JSON.parse(wire);
      expect(typeof parsed).toBe('object');
      expect(parsed).toEqual(detail);
      expect(parsed.deletedLogRows).toBe(4953);
    }
  });

  it('propagates a failed insert instead of swallowing it, so the caller rolls back', async () => {
    const { tx } = fakeTx(new Error('audit unavailable'));

    // No try/catch, deliberately: the database must not be able to hold
    // the deletion without its audit row.
    await expect(
      auditInTransaction(tx, 'nl_search.telemetry_cleared', { deletedLogRows: 412 }, admin),
    ).rejects.toThrow('audit unavailable');
  });
});

/*
 * ---------------------------------------------------------------------------
 * Capability enforcement source contract (AFLDB-ISSUE-158, ISSUE-156 P2).
 *
 * The capability table in src/lib/auth/capabilities.ts is only authoritative
 * while every admin boundary actually consults it. These tests read the
 * source under src/app/admin and fail on drift: a capability declared but
 * enforced nowhere, an admin page / route handler / Server Action that does
 * something before its guard or has no guard, a role guard kept somewhere
 * policy did not name, or a capability that admits a viewer the role guard
 * it replaced would have turned away.
 * ---------------------------------------------------------------------------
 */

const REPO = process.cwd();
const ADMIN_ROOT = join(REPO, 'src', 'app', 'admin');

/** A repo-relative, forward-slash path, whatever the host's separator. */
const repoPath = (file: string): string => relative(REPO, file).split(sep).join('/');

/** Sources are read as LF whatever the checkout's line endings are. */
const readSource = (file: string): string => readFileSync(file, 'utf8').replace(/\r\n/g, '\n');

function walk(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = join(dir, entry.name);
    return entry.isDirectory() ? walk(full) : [full];
  });
}

/** The `Capability` union, read from the file that declares it. */
function declaredCapabilities(): string[] {
  const source = readSource(join(REPO, 'src', 'lib', 'auth', 'capabilities.ts'));
  const union = source.match(/export type Capability =([\s\S]*?);/);
  if (!union) throw new Error('export type Capability not found in capabilities.ts');
  return [...union[1].matchAll(/'([A-Za-z]+(?:\.[A-Za-z]+)+)'/g)].map((m) => m[1]);
}

const DECLARED_CAPABILITIES = declaredCapabilities();

type BoundaryKind = 'page' | 'route' | 'action';
type Boundary = { path: string; kind: BoundaryKind; source: string };

/**
 * Every server boundary under src/app/admin: each page.tsx, each route.ts
 * and each module whose first statement is 'use server'. Components,
 * layouts, loading states and pure models are not boundaries.
 */
function adminBoundaries(): Boundary[] {
  const USE_SERVER = /^(?:\s|\/\/[^\n]*\n|\/\*[\s\S]*?\*\/)*'use server';/;
  return walk(ADMIN_ROOT).flatMap((file): Boundary[] => {
    const name = basename(file);
    if (!/\.tsx?$/.test(name)) return [];
    const source = readSource(file);
    const path = repoPath(file);
    if (name === 'page.tsx') return [{ path, kind: 'page', source }];
    if (name === 'route.ts') return [{ path, kind: 'route', source }];
    if (USE_SERVER.test(source)) return [{ path, kind: 'action', source }];
    return [];
  });
}

const BOUNDARIES = adminBoundaries();
const boundary = (path: string): Boundary | undefined => BOUNDARIES.find((b) => b.path === path);

const CAPABILITY_GUARD = 'requireCapability';
const ROLE_GUARDS = ['requireAdmin', 'requireSuperAdmin', 'requireUploader', 'requireAdminManager', 'requireSignedIn'] as const;
type RoleGuard = (typeof ROLE_GUARDS)[number];
const ROLE_GUARD_CALL = /\bawait\s+(requireAdmin|requireSuperAdmin|requireUploader|requireAdminManager|requireSignedIn)\(/g;

/**
 * Where a role guard is still the boundary, and why. Anything not listed
 * here must be guarded by requireCapability() alone; anything listed here
 * must still call exactly the guards named. Both directions are asserted,
 * so this list can neither grow nor go stale quietly.
 */
const RETAINED_ROLE_GUARDS: Record<string, { guards: RoleGuard[]; because: string }> = {
  'src/app/admin/page.tsx': {
    guards: ['requireAdmin'],
    because: 'the dashboard is every admin\'s landing page; no capability names it',
  },
  'src/app/admin/submissions/[id]/actions.ts': {
    guards: ['requireAdmin', 'requireSuperAdmin'],
    because: 'submission validation (admin) and approval/promotion (super admin) have no capability; '
      + 'acquisition.legacyIntake is ALL_STAFF and would be weaker',
  },
  'src/app/admin/admins/lifecycle-actions.ts': {
    guards: ['requireSuperAdmin'],
    because: 'ISSUE-156 §11 P2 keeps the explicit super-admin boundary and asserts '
      + 'people.admins.lifecycle beside it, not instead of it',
  },
  'src/app/admin/password/page.tsx': {
    guards: ['requireSignedIn'],
    because: 'the one page an account holding a temporary password may reach',
  },
  'src/app/admin/password/actions.ts': {
    guards: ['requireSignedIn'],
    because: 'changeOwnPassword: the action behind that page, same reason',
  },
};

/**
 * Boundaries that run before a staff session exists or that touch nothing:
 * exempt from the guard-first rule, and asserted to stay guard-free so a
 * stale entry here is noticed.
 */
const PRE_AUTH_BOUNDARIES: Record<string, string> = {
  'src/app/admin/login/page.tsx': 'the sign-in form',
  'src/app/admin/login/actions.ts': 'adminLogin creates the session every guard checks',
  'src/app/admin/invite/[token]/page.tsx': 'enrolment by invite token, before an account exists',
  'src/app/admin/invite/[token]/actions.ts': 'beginEnrolment / confirmEnrolment, token-authenticated',
  'src/app/admin/logout-action.ts': 'ends the session; reads it only to name the audit row',
  'src/app/admin/grid-solver/page.tsx': 'a permanent redirect to /grid-solver that reads nothing',
};

type TopLevelFn = { name: string; exported: boolean; chunk: string };

/**
 * Every top-level `async function` in a module, exported or not, with the
 * text from its declaration to the first line that is exactly `}` -- its
 * closing brace in formatted source (a props type closing with `}: {` or
 * `}) {` is not). An under-read chunk can only fail the test, never pass
 * it, because the guard has to be the first thing the chunk awaits.
 */
function topLevelAsyncFunctions(source: string): TopLevelFn[] {
  return [...source.matchAll(/^(export\s+)?(?:default\s+)?async\s+function\s+(\w+)/gm)].map((m) => {
    const rest = source.slice(m.index ?? 0);
    const close = rest.search(/\n\}[ \t]*(?:\n|$)/);
    return { name: m[2], exported: Boolean(m[1]), chunk: close === -1 ? rest : rest.slice(0, close) };
  });
}

/**
 * The guard a function reaches before it awaits anything else, or null.
 * Un-awaited calls to anything but a local async function (Number(),
 * formData.get(), parsers) are allowed ahead of it; awaiting Next's async
 * `params` / `searchParams` props is allowed; an un-awaited or awaited call
 * into a local async function is followed, so `return runX(...)` wrappers
 * are judged by what runX does first.
 */
function firstGuard(fn: TopLevelFn, locals: Map<string, TopLevelFn>, depth = 0): string | null {
  if (depth > 3) return null;
  const body = fn.chunk.slice(fn.chunk.indexOf('(') + 1);
  const steps = /\bawait\s+([A-Za-z_$][\w$.]*)\s*(\()?|(?<![.\w$])([A-Za-z_$][\w$]*)\s*\(/g;
  for (const step of body.matchAll(steps)) {
    if (step[1] !== undefined) {
      const target = step[1];
      const isCall = step[2] === '(';
      if (isCall && (target === CAPABILITY_GUARD || (ROLE_GUARDS as readonly string[]).includes(target))) return target;
      if (isCall && locals.has(target)) return firstGuard(locals.get(target)!, locals, depth + 1);
      if (!isCall && /^(params|searchParams|props\.\w+)$/.test(target)) continue;
      return null;
    }
    const callee = step[3];
    if (locals.has(callee) && callee !== fn.name) return firstGuard(locals.get(callee)!, locals, depth + 1);
  }
  return null;
}

/**
 * The capability literals named by every awaited requireCapability() call
 * in a source. Awaited, so a comment that mentions the call cannot stand in
 * for the code that makes it.
 */
function enforcedCapabilities(source: string): string[] {
  // A capability name is dotted (`group.name[.verb]`); the un-dotted
  // literal in a ternary's condition (`action === 'saveDraft' ? … : …`) is
  // not one.
  return [...source.matchAll(/\bawait\s+requireCapability\(\s*([\s\S]*?)\)/g)]
    .flatMap((call) => [...call[1].matchAll(/'([A-Za-z]+(?:\.[A-Za-z]+)+)'/g)].map((m) => m[1]));
}

describe('capability enforcement contract (AFLDB-ISSUE-158)', () => {
  it('finds the admin boundaries it is about to check', () => {
    // A walker that silently found nothing would make every rule below
    // vacuous, so the shape of the area is pinned first.
    expect(BOUNDARIES.length).toBeGreaterThanOrEqual(40);
    expect(BOUNDARIES.filter((b) => b.kind === 'page').length).toBeGreaterThanOrEqual(20);
    expect(BOUNDARIES.filter((b) => b.kind === 'route').length).toBeGreaterThanOrEqual(4);
    expect(BOUNDARIES.filter((b) => b.kind === 'action').length).toBeGreaterThanOrEqual(15);
    expect(DECLARED_CAPABILITIES.length).toBeGreaterThanOrEqual(18);
  });

  it('enforces every declared capability at a real page, route or action boundary', () => {
    const enforced = new Set(BOUNDARIES.flatMap((b) => enforcedCapabilities(b.source)));
    const unenforced = DECLARED_CAPABILITIES.filter((capability) => !enforced.has(capability));
    expect(unenforced, 'declared in capabilities.ts but no boundary calls requireCapability() with it').toEqual([]);
    const undeclared = [...enforced].filter((capability) => !DECLARED_CAPABILITIES.includes(capability));
    expect(undeclared, 'named by requireCapability() but absent from the Capability union').toEqual([]);
  });

  it('guards every admin page, route handler and Server Action before it awaits anything else', () => {
    const failures: string[] = [];
    for (const b of BOUNDARIES) {
      if (b.path in PRE_AUTH_BOUNDARIES) continue;
      const allowed = new Set<string>([CAPABILITY_GUARD, ...(RETAINED_ROLE_GUARDS[b.path]?.guards ?? [])]);
      const fns = topLevelAsyncFunctions(b.source);
      const locals = new Map(fns.map((fn) => [fn.name, fn]));
      const entryPoints = fns.filter((fn) => fn.exported);
      if (entryPoints.length === 0) failures.push(`${b.path}: no exported async function found`);
      for (const fn of entryPoints) {
        const guard = firstGuard(fn, locals);
        if (guard === null) failures.push(`${b.path}: ${fn.name} awaits something before any guard, or has none`);
        else if (!allowed.has(guard)) failures.push(`${b.path}: ${fn.name} is guarded by ${guard}(), which policy does not retain there`);
      }
    }
    expect(failures).toEqual([]);
  });

  it('keeps a role guard only where policy names it, and every guard policy names', () => {
    const strays: string[] = [];
    for (const b of BOUNDARIES) {
      const used = [...new Set([...b.source.matchAll(ROLE_GUARD_CALL)].map((m) => m[1]))].sort();
      const retained = RETAINED_ROLE_GUARDS[b.path];
      if (retained === undefined) {
        if (used.length > 0) strays.push(`${b.path}: ${used.join(', ')} not retained by policy`);
        continue;
      }
      const expected = [...retained.guards].sort();
      if (used.join() !== expected.join()) {
        strays.push(`${b.path}: calls [${used.join(', ')}], policy retains [${expected.join(', ')}] because ${retained.because}`);
      }
    }
    expect(strays).toEqual([]);
    for (const path of Object.keys(RETAINED_ROLE_GUARDS)) {
      expect(boundary(path), `${path} is listed as retaining a role guard but is not an admin boundary`).toBeDefined();
    }
  });

  it('lists the pre-auth surfaces exactly, and none of them has grown a guard', () => {
    for (const [path, why] of Object.entries(PRE_AUTH_BOUNDARIES)) {
      const b = boundary(path);
      expect(b, `${path} (${why}) is listed as pre-auth but is not an admin boundary`).toBeDefined();
      expect(enforcedCapabilities(b!.source), `${path} now calls requireCapability(); drop it from the pre-auth list`).toEqual([]);
      expect([...b!.source.matchAll(ROLE_GUARD_CALL)].map((m) => m[1]),
        `${path} now calls a role guard; drop it from the pre-auth list`).toEqual([]);
    }
  });

  it('asserts people.admins.lifecycle beside requireSuperAdmin(), never instead of it', () => {
    const b = boundary('src/app/admin/admins/lifecycle-actions.ts');
    expect(b).toBeDefined();
    // The role guard first, then the capability, with nothing but comments
    // between them: ISSUE-156 §11 P2's worked example.
    expect(b!.source).toMatch(
      /await requireSuperAdmin\(\);\n(?:[ \t]*\/\/[^\n]*\n)*[ \t]*await requireCapability\('people\.admins\.lifecycle'\);/,
    );
  });

  it('leaves the shared account-list actions on the door every admin may open', () => {
    // revokeSession decides who-may-revoke-whom per target; the door is the
    // list every admin may read, exactly the boundary requireAdmin() drew.
    expect(boundary('src/app/admin/admins/actions.ts')?.source).toContain("requireCapability('people.admins.read')");
  });

  it('enforces the capabilities the sidebar shows, so a hidden link is never the only gate', () => {
    // Every capability nav-model.ts gates a link on is enforced by the
    // route the link points at; the walker's coverage of every boundary is
    // what makes the sidebar furniture rather than a gate.
    const navModel = readSource(join(ADMIN_ROOT, 'nav-model.ts'));
    const linked = [...navModel.matchAll(/href: '([^']+)'[^\n]*capability: '([A-Za-z.]+)'/g)];
    expect(linked.length).toBeGreaterThanOrEqual(14);
    for (const [, href, capability] of linked) {
      const page = boundary(`src/app${href}/page.tsx`);
      expect(page, `${href} is linked in the nav but has no page.tsx`).toBeDefined();
      expect(enforcedCapabilities(page!.source), `${href} does not enforce ${capability}`).toContain(capability);
    }
  });
});

/**
 * The role guard each capability stands for. Read as: "requireCapability(X)
 * admits exactly the viewers <guard>() admitted". Typed as a Record so a new
 * capability fails the typecheck until it is placed; checked below so no
 * capability is looser OR tighter than the guard the routes used to call.
 */
const EQUIVALENT_ROLE_GUARD: Record<Capability, 'requireUploader' | 'requireAdmin' | 'requireSuperAdmin' | 'requireAdminManager'> = {
  'data.playerLinks': 'requireSuperAdmin',
  'data.dataEditor': 'requireSuperAdmin',
  'data.brownlow.read': 'requireAdmin',
  'data.brownlow.draft': 'requireAdmin',
  'data.brownlow.finalise': 'requireSuperAdmin',
  'data.coaches.read': 'requireAdmin',
  'data.coaches.edit': 'requireSuperAdmin',
  'data.draft.read': 'requireAdmin',
  'data.draft.edit': 'requireSuperAdmin',
  'data.seasonLists.read': 'requireAdmin',
  'data.seasonLists.edit': 'requireSuperAdmin',
  'data.fixtures.read': 'requireAdmin',
  'data.fixtures.edit': 'requireSuperAdmin',
  'acquisition.legacyIntake': 'requireUploader',
  'acquisition.currentSeason': 'requireSuperAdmin',
  'people.betaAccess': 'requireAdmin',
  'people.admins.read': 'requireAdmin',
  'people.admins.manage': 'requireAdminManager',
  'people.admins.lifecycle': 'requireSuperAdmin',
  'site.content': 'requireSuperAdmin',
  'site.settings': 'requireSuperAdmin',
  'operations.queryBuilder': 'requireSuperAdmin',
  'operations.dbHealth': 'requireSuperAdmin',
  'operations.appHealth': 'requireSuperAdmin',
  'operations.nlTelemetry': 'requireSuperAdmin',
  'operations.audit.read': 'requireAdmin',
};

/** What each role guard in session.ts admits, restated from its source. */
function roleGuardAdmits(guard: (typeof EQUIVALENT_ROLE_GUARD)[Capability], viewer: CapabilityViewer): boolean {
  switch (guard) {
    case 'requireUploader': return true;
    case 'requireAdmin': return viewer.role !== 'contributor';
    case 'requireSuperAdmin': return viewer.role === 'super_admin';
    case 'requireAdminManager':
      return viewer.role !== 'contributor' && (viewer.role === 'super_admin' || viewer.canManageAdmins);
  }
}

const ROLES: CapabilityViewer['role'][] = ['contributor', 'admin', 'super_admin'];
const EVERY_VIEWER: CapabilityViewer[] = ROLES.flatMap((role) => [
  { role, canManageAdmins: false },
  { role, canManageAdmins: true },
]);

describe('capabilities are exactly as strict as the role guards they replaced (AFLDB-ISSUE-158)', () => {
  it('places every declared capability', () => {
    expect(Object.keys(EQUIVALENT_ROLE_GUARD).sort()).toEqual([...DECLARED_CAPABILITIES].sort());
  });

  it.each(Object.entries(EQUIVALENT_ROLE_GUARD))('%s admits the same viewers as %s()', (capability, guard) => {
    for (const viewer of EVERY_VIEWER) {
      expect(
        hasCapability(viewer, capability as Capability),
        `${capability} for ${viewer.role}${viewer.canManageAdmins ? '+can_manage_admins' : ''}`,
      ).toBe(roleGuardAdmits(guard, viewer));
    }
  });
});

/**
 * The guard itself, end to end and without a database: the signed cookie is
 * read, the session row is looked up, the temporary-password rule runs, and
 * the capability table decides -- with the redirect targets the role guards
 * used, so no route that moved from requireAdmin() / requireSuperAdmin() /
 * requireUploader() / requireAdminManager() sends anyone somewhere new.
 */
describe('requireCapability against the real guard (AFLDB-ISSUE-158)', () => {
  const signedIn = async (
    role: CapabilityViewer['role'],
    canManageAdmins = false,
    mustChangePassword = false,
  ) => {
    process.env.AFLDB_SESSION_SECRET = 'x'.repeat(48);
    requestCookie.admin = await signClaim(
      { v: 1, kind: 'admin', sub: '5:opaque-token', exp: Math.floor(Date.now() / 1000) + 60, epoch: 1 },
      process.env.AFLDB_SESSION_SECRET,
    );
    sessionRow.row = { id: 5, email: `${role}@afldb.test`, role, canManageAdmins, mustChangePassword };
  };

  afterEach(() => {
    requestCookie.admin = null;
    sessionRow.row = null;
  });

  it.each(DECLARED_CAPABILITIES)('%s: admits the viewers the table names and bounces the rest where the role guards did', async (capability) => {
    for (const viewer of EVERY_VIEWER) {
      await signedIn(viewer.role, viewer.canManageAdmins);
      const label = `${capability} for ${viewer.role}${viewer.canManageAdmins ? '+can_manage_admins' : ''}`;
      if (hasCapability(viewer, capability as Capability)) {
        await expect(requireCapability(capability as Capability), label).resolves.toMatchObject({ id: 5, role: viewer.role });
      } else if (viewer.role === 'contributor') {
        // requireAdmin()'s bounce: the one route a contributor may reach.
        await expect(requireCapability(capability as Capability), label).rejects.toThrow(/^NEXT_REDIRECT \/admin\/upload$/);
      } else {
        // requireSuperAdmin()'s and requireAdminManager()'s bounce: the dashboard.
        await expect(requireCapability(capability as Capability), label).rejects.toThrow(/^NEXT_REDIRECT \/admin$/);
      }
    }
  });

  it('sends an anonymous caller to the login form, whatever the capability', async () => {
    requestCookie.admin = null;
    sessionRow.row = null;
    await expect(requireCapability('acquisition.legacyIntake')).rejects.toThrow(/^NEXT_REDIRECT \/admin\/login$/);
  });

  it('sends an outstanding temporary password to the change-password page before any capability is consulted', async () => {
    // The widest capability there is, held by a super admin: still bounced,
    // because requireUploader()'s rule runs first exactly as it did under
    // every role guard.
    await signedIn('super_admin', false, true);
    await expect(requireCapability('acquisition.legacyIntake')).rejects.toThrow(/^NEXT_REDIRECT \/admin\/password$/);
  });

  it('turns a delegated contributor away from admin management at the guard, not only in the table', async () => {
    await signedIn('contributor', true);
    await expect(requireCapability('people.admins.manage')).rejects.toThrow(/^NEXT_REDIRECT \/admin\/upload$/);
  });
});
