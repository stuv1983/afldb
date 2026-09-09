import { beforeEach, describe, expect, it, vi } from 'vitest';

// The audit suite at the foot of this file exercises the real
// src/lib/auth/session.ts, which binds the auth pool and reads request
// headers. Both are replaced here so the writer can be observed without
// a database and without a Next.js request scope; nothing else in this
// file touches either module.
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
vi.mock('@/db/authClient', () => {
  const sql = (strings: TemplateStringsArray, ...values: unknown[]) => {
    poolQueries.push({ strings: [...strings], values });
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
import { audit, auditInTransaction, getAdminUser } from '@/lib/auth/session';
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
    'people.admins.lifecycle',
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
    // A plain admin holds no capability in Data, Site or Operations today.
    expect(idsFor({ role: 'admin', canManageAdmins: false })).toEqual([
      'overview', 'acquisition', 'people', 'account',
    ]);
  });

  it('gives a super admin every group, in the runbook\'s section order', () => {
    expect(idsFor({ role: 'super_admin', canManageAdmins: false })).toEqual([
      'overview', 'data', 'acquisition', 'people', 'site', 'operations', 'account',
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
