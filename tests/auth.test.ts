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
vi.mock('next/headers', () => ({
  headers: async () => {
    // What next/headers actually does outside a request scope, which is
    // the case requestIp() exists to absorb.
    if (requestHeaders.outsideRequestScope) throw new Error('called outside a request scope');
    return { get: (name: string) => (name === 'x-forwarded-for' ? requestHeaders.forwardedFor : null) };
  },
  cookies: async () => ({ get: () => undefined, delete: () => undefined }),
}));

import type postgres from 'postgres';

import { audit, auditInTransaction } from '@/lib/auth/session';
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
