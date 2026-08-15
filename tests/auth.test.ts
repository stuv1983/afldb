import { describe, expect, it } from 'vitest';

import {
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
