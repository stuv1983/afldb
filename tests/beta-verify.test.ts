/**
 * The beta magic-link landing (AFLDB-ISSUE-280).
 *
 * A mail provider that pre-fetches links for safety scanning (Outlook
 * SafeLinks, corporate URL rewriters) issues a GET before the reader clicks.
 * The single-use token must survive that GET and be spent only by the
 * confirmation form's POST (`confirmMagicLink`).
 *
 * Everything here is DB-free: `authSql` is a recording fake whose
 * `beta_login_tokens` UPDATE behaves like the real predicate (unused, unexpired,
 * matching hash, burn once), so the prefetch-then-click scenario is exercised
 * as a sequence rather than as two unrelated assertions. Whether PostgreSQL
 * evaluates the predicate that way is the existing statement's business and is
 * unchanged; what the real mail gateway does is the DEV acceptance check, which
 * this file does not stand in for.
 */
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

import dns from 'node:dns';
import net from 'node:net';
import tls from 'node:tls';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { redeemAccessCode, requestJoin, requestMagicLink } from '@/app/beta/actions';
import { confirmMagicLink } from '@/app/beta/verify/actions';
import BetaVerifyPage from '@/app/beta/verify/page';
import { VerifyForm } from '@/app/beta/verify/VerifyForm';
import { sha256Hex } from '@/lib/auth/crypto';
import { audit, grantBetaAccess } from '@/lib/auth/session';

const state = vi.hoisted(() => ({
  statements: [] as { sql: string; values: unknown[] }[],
  /** token_hash -> unused? Only a hash present AND true is redeemable. */
  tokens: new Map<string, { email: string; unused: boolean }>(),
  allowlisted: true,
  /** null models an unresolvable caller (requestIp returns null). */
  ip: '203.0.113.1' as string | null,
  /** The row `UPDATE beta_access_codes ... RETURNING` yields; null = no live code. */
  codeRow: null as { id: number; label: string } | null,
}));

vi.mock('next/navigation', () => ({
  redirect: (to: string) => {
    throw new (class extends Error {
      readonly to = to;
      constructor() {
        super(`NEXT_REDIRECT:${to}`);
      }
    })();
  },
}));

vi.mock('@/db/authClient', () => ({
  authSql: (strings: TemplateStringsArray, ...values: unknown[]) => {
    const sql = strings.join(' ? ');
    state.statements.push({ sql, values });
    if (/UPDATE\s+beta_login_tokens/.test(sql)) {
      const hash = String(values[0]);
      const row = state.tokens.get(hash);
      if (!row || !row.unused) return Promise.resolve([]);
      row.unused = false;
      return Promise.resolve([{ email: row.email }]);
    }
    if (/FROM\s+beta_allowed_emails/.test(sql)) {
      return Promise.resolve(state.allowlisted ? [{ id: 1 }] : []);
    }
    if (/UPDATE\s+beta_access_codes/.test(sql)) {
      return Promise.resolve(state.codeRow ? [state.codeRow] : []);
    }
    return Promise.resolve([]);
  },
}));

vi.mock('@/lib/auth/session', () => ({
  audit: vi.fn(async () => undefined),
  grantBetaAccess: vi.fn(async () => undefined),
  requestIp: vi.fn(async () => state.ip),
}));

// AFLDB-ISSUE-363 S-1: the REAL @/lib/email/send runs, but its transport is a stub. `nodemailer` is replaced, so
// no SMTP client exists in this file; a further guard (below) fails any test that opens a socket, TLS session or
// DNS lookup. No real email is ever sent and no relay (Brevo or otherwise) is contacted.
const mail = vi.hoisted(() => ({
  sendMail: vi.fn(async (_message: Record<string, string>) => ({ messageId: 'stub' })),
  createTransport: vi.fn(),
}));
vi.mock('nodemailer', () => {
  mail.createTransport.mockImplementation(() => ({ sendMail: mail.sendMail }));
  return { default: { createTransport: mail.createTransport } };
});

const TOKEN = 'a'.repeat(43);
const EMAIL = 'reader@example.com';

function form(token: string): FormData {
  const data = new FormData();
  data.set('token', token);
  return data;
}

async function redirectOf(run: () => Promise<unknown>): Promise<string | null> {
  try {
    await run();
  } catch (error) {
    if (error instanceof Error && error.message.startsWith('NEXT_REDIRECT:')) {
      return (error as unknown as { to: string }).to;
    }
    throw error;
  }
  return null;
}

const page = (token?: string | string[]) =>
  BetaVerifyPage({ searchParams: Promise.resolve(token === undefined ? {} : { token }) });

const tokenWrites = () => state.statements.filter((s) => /UPDATE\s+beta_login_tokens/.test(s.sql));

let ipCounter = 0;

/** S-1: records any outbound network attempt (passes through; the stub transport means there should be none). */
const outbound = (() => {
  let spies: { name: string; spy: ReturnType<typeof vi.spyOn> }[] = [];
  return {
    install() {
      spies = [
        { name: 'net.Socket.connect', spy: vi.spyOn(net.Socket.prototype, 'connect') },
        { name: 'tls.connect', spy: vi.spyOn(tls, 'connect') },
        { name: 'dns.lookup', spy: vi.spyOn(dns, 'lookup') },
      ];
    },
    attempts: () => spies.filter(({ spy }) => spy.mock.calls.length > 0).map(({ name }) => name),
    uninstall() {
      for (const { spy } of spies) spy.mockRestore();
      spies = [];
    },
  };
})();

/** A relay configuration whose host can never resolve (RFC 2606); the nodemailer stub is what actually answers. */
function configureStubRelay(): void {
  vi.stubEnv('AFLDB_SMTP_HOST', 'smtp.invalid');
  vi.stubEnv('AFLDB_SMTP_USER', 'stub-user');
  vi.stubEnv('AFLDB_SMTP_PASSWORD', 'stub-password');
  vi.stubEnv('AFLDB_SMTP_FROM', 'AFLDB <no-reply@smtp.invalid>');
}

beforeEach(() => {
  state.statements.length = 0;
  state.tokens.clear();
  state.tokens.set(sha256Hex(TOKEN), { email: EMAIL, unused: true });
  state.allowlisted = true;
  state.codeRow = null;
  // The limiter is module state: a fresh caller per test keeps cases independent.
  ipCounter += 1;
  state.ip = `203.0.113.${ipCounter}`;
  vi.mocked(audit).mockClear();
  vi.mocked(grantBetaAccess).mockClear();
  mail.sendMail.mockReset();
  mail.sendMail.mockResolvedValue({ messageId: 'stub' });
  outbound.install();
});

afterEach(() => {
  // Any socket, TLS session or DNS lookup in this file is an outbound attempt and fails the test that made it.
  const attempts = outbound.attempts();
  outbound.uninstall();
  expect(attempts, 'no outbound network connection may be attempted').toEqual([]);
});

describe('GET /beta/verify renders a confirmation and spends nothing', () => {
  it('runs no statement at all, and hands the token to the form', async () => {
    const tree = (await page(TOKEN)) as { props: { children: unknown } };

    expect(state.statements).toEqual([]);
    expect(grantBetaAccess).not.toHaveBeenCalled();
    expect(audit).not.toHaveBeenCalled();
    expect(JSON.stringify(tree, (_k, v) => (typeof v === 'function' ? v.name : v))).toContain(TOKEN);
    expect(findElements(tree, VerifyForm).map((el) => el.props.token)).toEqual([TOKEN]);
  });

  it('sends a missing, short or oversized token to the gate without touching the database', async () => {
    expect(await redirectOf(() => page())).toBe('/beta');
    expect(await redirectOf(() => page('x'.repeat(19)))).toBe('/beta');
    expect(await redirectOf(() => page('x'.repeat(101)))).toBe('/beta');
    expect(state.statements).toEqual([]);
  });
});

describe('POST (confirmMagicLink) spends the token', () => {
  it('burns the hashed token, audits, grants beta access and lands on /', async () => {
    const to = await redirectOf(() => confirmMagicLink({}, form(TOKEN)));

    expect(to).toBe('/');
    expect(tokenWrites()).toHaveLength(1);
    expect(tokenWrites()[0].values).toEqual([sha256Hex(TOKEN)]);
    // The fake burns whatever matches the table name, so pin the predicate that
    // makes the statement single-use, unexpired and keyed on the hash.
    const sql = tokenWrites()[0].sql.replace(/\s+/g, ' ');
    expect(sql).toContain('SET used_at = now()');
    expect(sql).toContain('token_hash = ?');
    expect(sql).toContain('used_at IS NULL');
    expect(sql).toContain('expires_at > now()');
    expect(audit).toHaveBeenCalledWith('beta.magic_link_verified', { email: EMAIL }, { label: EMAIL });
    expect(grantBetaAccess).toHaveBeenCalledWith(`email:${EMAIL}`);
  });

  it('survives any number of scanner GETs, then signs the reader in exactly once', async () => {
    await page(TOKEN);
    await page(TOKEN);
    await page(TOKEN);
    expect(tokenWrites()).toHaveLength(0);

    expect(await redirectOf(() => confirmMagicLink({}, form(TOKEN)))).toBe('/');
    expect(grantBetaAccess).toHaveBeenCalledTimes(1);

    // Replay or a forwarded link: the token is already spent.
    expect(await redirectOf(() => confirmMagicLink({}, form(TOKEN)))).toBe('/beta');
    expect(grantBetaAccess).toHaveBeenCalledTimes(1);
  });

  it('keeps the allowlist re-check: a revoked address is audited and admitted nowhere', async () => {
    state.allowlisted = false;

    expect(await redirectOf(() => confirmMagicLink({}, form(TOKEN)))).toBe('/beta');
    expect(audit).toHaveBeenCalledWith(
      'beta.magic_link_revoked_email', { email: EMAIL }, { label: EMAIL },
    );
    expect(grantBetaAccess).not.toHaveBeenCalled();
  });

  it('sends an unknown or expired token to the gate and grants nothing', async () => {
    const other = 'b'.repeat(43);
    expect(await redirectOf(() => confirmMagicLink({}, form(other)))).toBe('/beta');
    expect(grantBetaAccess).not.toHaveBeenCalled();
    expect(audit).not.toHaveBeenCalled();
  });

  it('rejects a token of the wrong length before any statement', async () => {
    expect(await redirectOf(() => confirmMagicLink({}, form('short')))).toBe('/beta');
    expect(await redirectOf(() => confirmMagicLink({}, form('y'.repeat(101))))).toBe('/beta');
    expect(await redirectOf(() => confirmMagicLink({}, new FormData()))).toBe('/beta');
    expect(state.statements).toEqual([]);
  });

  it('keeps the per-caller rate limit on the POST: the 21st attempt runs no statement', async () => {
    for (let i = 0; i < 20; i += 1) {
      await redirectOf(() => confirmMagicLink({}, form(`${i}`.padStart(30, 'z'))));
    }
    const writesBefore = tokenWrites().length;

    const result = await confirmMagicLink({}, form(TOKEN));

    expect(result.error).toMatch(/Too many requests/);
    expect(tokenWrites()).toHaveLength(writesBefore);
    expect(grantBetaAccess).not.toHaveBeenCalled();
  });
});

/* ------------------------------------------------------------------ *
 * AFLDB-ISSUE-363 TST-7: the public beta-gate entry actions
 * (src/app/beta/actions.ts). The beta gate is ON in production, so these
 * three actions are the site's front door; none had a test. Same recording
 * fake as above: whether PostgreSQL evaluates a predicate is the statement's
 * business, so the tests pin the predicate text and the values bound to it.
 * ------------------------------------------------------------------ */

const GENERIC_FAILURE =
  'That code or email was not accepted. Check it and try again, or contact the person who invited you.';
const TOO_MANY = 'Too many attempts. Wait a few minutes and try again.';
const CODE = 'afldb-0123456789';

function codeForm(fields: Record<string, string | File>): FormData {
  const data = new FormData();
  for (const [key, value] of Object.entries(fields)) data.set(key, value);
  return data;
}

const codeWrites = () => state.statements.filter((s) => /UPDATE\s+beta_access_codes/.test(s.sql));
const inserts = (table: string) => state.statements.filter((s) => new RegExp(`INSERT\\s+INTO\\s+${table}`).test(s.sql));

describe('redeemAccessCode (the code door)', () => {
  it('spends a live code once, audits it, grants code:<id> access and lands on the requested internal path', async () => {
    state.codeRow = { id: 7, label: 'friends-of-the-club' };

    const to = await redirectOf(() => redeemAccessCode({}, codeForm({ code: `  ${CODE}  `, from: '/players/12-some-player?tab=career' })));

    expect(to).toBe('/players/12-some-player?tab=career');
    expect(codeWrites()).toHaveLength(1);
    // The code is trimmed, then HASHED: the plaintext never reaches the statement.
    expect(codeWrites()[0].values).toEqual([sha256Hex(CODE)]);
    expect(JSON.stringify(state.statements)).not.toContain(CODE);
    // The predicate that makes the redemption atomic and honest about NULL = unlimited.
    const sql = codeWrites()[0].sql.replace(/\s+/g, ' ');
    expect(sql).toContain('SET use_count = use_count + 1');
    expect(sql).toContain('code_hash = ?');
    expect(sql).toContain('revoked_at IS NULL');
    expect(sql).toContain('(expires_at IS NULL OR expires_at > now())');
    expect(sql).toContain('(max_uses IS NULL OR use_count < max_uses)');
    expect(audit).toHaveBeenCalledWith(
      'beta.code_redeemed', { codeId: 7, label: 'friends-of-the-club' }, { label: 'friends-of-the-club' },
    );
    expect(grantBetaAccess).toHaveBeenCalledWith('code:7');
  });

  it.each([
    ['a protocol-relative URL', '//evil.example/steal'],
    ['a backslash folded to //', '/\\evil.example'],
    ['a leading backslash', '\\/evil.example'],
    ['an absolute URL', 'https://evil.example/'],
    ['a scheme-relative host without a slash', 'evil.example/path'],
    ['a javascript: URL', 'javascript:alert(1)'],
    ['a path carrying a CR/LF (header splitting)', '/ok\r\nSet-Cookie: x=1'],
    ['a path carrying a tab', '/ok\tmore'],
    ['a path carrying DEL', '/ok\x7fmore'],
    ['an empty string', ''],
  ])('admits the visitor but refuses %s as a destination: lands on /', async (_label, from) => {
    state.codeRow = { id: 9, label: 'open-redirect-probe' };

    const to = await redirectOf(() => redeemAccessCode({}, codeForm({ code: CODE, from })));

    expect(to).toBe('/');
    // The code itself was valid, so the refusal is of the destination only.
    expect(grantBetaAccess).toHaveBeenCalledWith('code:9');
  });

  it('lands on / when no destination, or a non-string destination (a file part), is supplied', async () => {
    state.codeRow = { id: 9, label: 'open-redirect-probe' };

    expect(await redirectOf(() => redeemAccessCode({}, codeForm({ code: CODE })))).toBe('/');
    expect(
      await redirectOf(() => redeemAccessCode({}, codeForm({ code: CODE, from: new File(['/ok'], 'from.txt') }))),
    ).toBe('/');
  });

  it('keeps a legitimate nested path with a query and fragment intact', async () => {
    state.codeRow = { id: 9, label: 'x' };

    expect(await redirectOf(() => redeemAccessCode({}, codeForm({ code: CODE, from: '/search?q=most+goals&p=2#top' }))))
      .toBe('/search?q=most+goals&p=2#top');
  });

  it('answers a wrong, revoked, expired or exhausted code with the one generic message, audits, and grants nothing', async () => {
    state.codeRow = null; // the UPDATE matched no live row

    const result = await redeemAccessCode({}, codeForm({ code: CODE, from: '/players' }));

    expect(result).toEqual({ error: GENERIC_FAILURE });
    expect(codeWrites()).toHaveLength(1);
    expect(audit).toHaveBeenCalledWith('beta.code_rejected', null, { label: 'anonymous' });
    expect(grantBetaAccess).not.toHaveBeenCalled();
  });

  it('refuses a missing, short or oversized code before any statement, with the same generic message', async () => {
    for (const code of ['', 'short', 'x'.repeat(7), 'x'.repeat(101)]) {
      expect(await redeemAccessCode({}, codeForm({ code }))).toEqual({ error: GENERIC_FAILURE });
    }
    expect(await redeemAccessCode({}, new FormData())).toEqual({ error: GENERIC_FAILURE });
    expect(state.statements).toEqual([]);
    expect(audit).not.toHaveBeenCalled();
    expect(grantBetaAccess).not.toHaveBeenCalled();
  });

  it('rate-limits per caller: attempt 11 runs no statement, a different caller is unaffected', async () => {
    const limitedIp = state.ip;
    for (let i = 0; i < 10; i += 1) {
      expect(await redeemAccessCode({}, codeForm({ code: `afldb-guess-${i}` }))).toEqual({ error: GENERIC_FAILURE });
    }
    expect(codeWrites()).toHaveLength(10);

    // Even a CORRECT code is refused once the caller is over the limit, and nothing is spent.
    state.codeRow = { id: 3, label: 'valid' };
    expect(await redeemAccessCode({}, codeForm({ code: CODE }))).toEqual({ error: TOO_MANY });
    expect(codeWrites()).toHaveLength(10);
    expect(grantBetaAccess).not.toHaveBeenCalled();

    // Keyed on the caller, never on the content they supply.
    state.ip = `${limitedIp}-other`;
    expect(await redirectOf(() => redeemAccessCode({}, codeForm({ code: CODE })))).toBe('/');
    expect(grantBetaAccess).toHaveBeenCalledWith('code:3');
  });

  it('does not exempt a caller whose address cannot be resolved: they share one bucket', async () => {
    state.ip = null;
    for (let i = 0; i < 10; i += 1) await redeemAccessCode({}, codeForm({ code: `afldb-unknown-${i}` }));

    expect(await redeemAccessCode({}, codeForm({ code: CODE }))).toEqual({ error: TOO_MANY });
    expect(codeWrites()).toHaveLength(10);
  });
});

describe('requestMagicLink (the allowlisted-email door)', () => {
  const token = () => {
    const message = mail.sendMail.mock.calls[0][0];
    const match = /\/beta\/verify\?token=([A-Za-z0-9_-]+)/.exec(message.text);
    expect(match, 'the email carries a /beta/verify?token= link').not.toBeNull();
    return match![1];
  };

  const consoleSpies: { mockRestore(): void }[] = [];
  const spyConsole = (method: 'warn' | 'info') => {
    const spy = vi.spyOn(console, method).mockImplementation(() => undefined);
    consoleSpies.push(spy);
    return spy;
  };

  beforeEach(configureStubRelay);
  afterEach(() => {
    vi.unstubAllEnvs();
    for (const spy of consoleSpies.splice(0)) spy.mockRestore();
  });

  it('for an allowlisted address stores only the HASH of the token, mails the link, audits delivery, and says "sent"', async () => {
    vi.stubEnv('AFLDB_BASE_URL', 'https://beta.example.test');

    const result = await requestMagicLink({}, codeForm({ email: '  Reader@Example.COM ' }));

    expect(result).toEqual({ sent: true });
    expect(inserts('beta_login_tokens')).toHaveLength(1);
    const [storedEmail, storedHash] = inserts('beta_login_tokens')[0].values;
    expect(storedEmail).toBe('reader@example.com');
    // The real sendEmail ran against the stub transport, configured for the unresolvable host.
    expect(mail.createTransport).toHaveBeenCalledWith(expect.objectContaining({ host: 'smtp.invalid' }));
    expect(mail.sendMail).toHaveBeenCalledTimes(1);
    expect(mail.sendMail.mock.calls[0][0].to).toBe('reader@example.com');
    expect(mail.sendMail.mock.calls[0][0].text).toContain(
      `https://beta.example.test/beta/verify?token=${token()}`,
    );
    expect(storedHash).toBe(sha256Hex(token()));
    // The credential itself is not stored anywhere in the statements.
    expect(JSON.stringify(state.statements)).not.toContain(token());
    expect(inserts('beta_login_tokens')[0].sql).toContain("now() + interval '30 minutes'");
    expect(audit).toHaveBeenCalledWith(
      'beta.magic_link_issued', { email: 'reader@example.com', delivered: true }, { label: 'reader@example.com' },
    );
  });

  it('for an address that is not on the list sends nothing and stores nothing, yet returns the identical response', async () => {
    const accepted = await requestMagicLink({}, codeForm({ email: 'reader@example.com' }));
    state.ip = '203.0.113.200'; // fresh caller for the second call
    state.allowlisted = false;

    const refused = await requestMagicLink({}, codeForm({ email: 'stranger@example.com' }));

    expect(refused).toEqual(accepted); // an attacker cannot enumerate the list from this form
    expect(inserts('beta_login_tokens')).toHaveLength(1); // only the accepted call's
    expect(mail.sendMail).toHaveBeenCalledTimes(1);
    expect(audit).toHaveBeenLastCalledWith(
      'beta.magic_link_refused', { email: 'stranger@example.com' }, { label: 'stranger@example.com' },
    );
  });

  it('refuses malformed or oversized addresses with the generic message before any statement', async () => {
    for (const email of ['', 'no-at-sign', 'a@b', 'two@@example.com', 'sp ace@example.com', `${'x'.repeat(195)}@e.com`]) {
      expect(await requestMagicLink({}, codeForm({ email }))).toEqual({ error: GENERIC_FAILURE });
    }
    expect(await requestMagicLink({}, new FormData())).toEqual({ error: GENERIC_FAILURE });
    expect(state.statements).toEqual([]);
    expect(mail.sendMail).not.toHaveBeenCalled();
  });

  it('withholds the live link from the production log when the relay refuses, but reports the failure', async () => {
    vi.stubEnv('AFLDB_ENV', 'production');
    mail.sendMail.mockRejectedValue(new Error('relay refused'));
    const warn = spyConsole('warn');
    const info = spyConsole('info');

    expect(await requestMagicLink({}, codeForm({ email: 'reader@example.com' }))).toEqual({ sent: true });

    const logged = JSON.stringify([...warn.mock.calls, ...info.mock.calls]);
    expect(logged).toContain('could not be sent (failed)');
    expect(logged).not.toContain(token());
    expect(logged).not.toContain('/beta/verify');
    expect(audit).toHaveBeenCalledWith(
      'beta.magic_link_issued', { email: 'reader@example.com', delivered: false }, { label: 'reader@example.com' },
    );
  });

  it('withholds the link from the production log, and tries no transport, when no relay is configured', async () => {
    vi.stubEnv('AFLDB_ENV', 'production');
    vi.stubEnv('AFLDB_SMTP_HOST', '');
    const warn = spyConsole('warn');
    const info = spyConsole('info');

    expect(await requestMagicLink({}, codeForm({ email: 'reader@example.com' }))).toEqual({ sent: true });

    expect(mail.sendMail).not.toHaveBeenCalled();
    const logged = JSON.stringify([...warn.mock.calls, ...info.mock.calls]);
    expect(logged).toContain('could not be sent (not-configured)');
    expect(logged).not.toContain('/beta/verify');
    expect(inserts('beta_login_tokens')).toHaveLength(1); // the token row is still issued
  });

  it('prints the link to the dev log when nothing is configured outside production (the operator hands it on)', async () => {
    vi.stubEnv('AFLDB_ENV', 'development');
    vi.stubEnv('AFLDB_SMTP_HOST', '');
    const info = spyConsole('info');

    await requestMagicLink({}, codeForm({ email: 'reader@example.com' }));

    expect(mail.sendMail).not.toHaveBeenCalled();
    const [line] = info.mock.calls.map((call) => String(call[0]));
    const [, devToken] = /\/beta\/verify\?token=([A-Za-z0-9_-]+)/.exec(line) ?? [];
    expect(devToken, 'the dev log carries the link').toBeTruthy();
    expect(inserts('beta_login_tokens')[0].values[1]).toBe(sha256Hex(devToken));
  });

  it('rate-limits per caller: request 6 runs no statement and mails nothing', async () => {
    for (let i = 0; i < 5; i += 1) await requestMagicLink({}, codeForm({ email: `reader${i}@example.com` }));
    expect(inserts('beta_login_tokens')).toHaveLength(5);
    expect(mail.sendMail).toHaveBeenCalledTimes(5);

    expect(await requestMagicLink({}, codeForm({ email: 'reader@example.com' }))).toEqual({ error: TOO_MANY });
    expect(inserts('beta_login_tokens')).toHaveLength(5);
    expect(mail.sendMail).toHaveBeenCalledTimes(5);
  });
});

describe('requestJoin (the ask-to-join door)', () => {
  it('queues a pending row with trimmed, length-capped fields and the caller address, audits it, and never admits anyone', async () => {
    const result = await requestJoin({}, codeForm({
      email: ' Fan@Example.com ',
      name: `  ${'n'.repeat(250)}  `,
      message: `  ${'m'.repeat(1500)}  `,
    }));

    expect(result).toEqual({ requested: true });
    expect(inserts('beta_join_requests')).toHaveLength(1);
    const [email, name, message, ip] = inserts('beta_join_requests')[0].values;
    expect(email).toBe('fan@example.com');
    expect(name).toBe('n'.repeat(200));
    expect(message).toBe('m'.repeat(1000));
    expect(ip).toBe(state.ip);
    expect(inserts('beta_join_requests')[0].sql.replace(/\s+/g, ' ')).toContain(
      "ON CONFLICT (email) WHERE status = 'pending' DO NOTHING",
    );
    expect(audit).toHaveBeenCalledWith('beta.join_requested', { email: 'fan@example.com' }, { label: 'fan@example.com' });
    expect(grantBetaAccess).not.toHaveBeenCalled();
    expect(mail.sendMail).not.toHaveBeenCalled();
  });

  it('stores NULL, not an empty string, for an omitted name or message', async () => {
    await requestJoin({}, codeForm({ email: 'fan@example.com', name: '   ', message: '' }));

    const [, name, message] = inserts('beta_join_requests')[0].values;
    expect(name).toBeNull();
    expect(message).toBeNull();
  });

  it('refuses a malformed or oversized address with its own message and writes nothing', async () => {
    for (const email of ['', 'nope', 'a@b', 'x y@example.com', `${'x'.repeat(195)}@e.com`]) {
      expect(await requestJoin({}, codeForm({ email }))).toEqual({ error: 'That is not an email address.' });
    }
    expect(state.statements).toEqual([]);
    expect(audit).not.toHaveBeenCalled();
  });

  it('rate-limits per caller: request 6 writes nothing', async () => {
    for (let i = 0; i < 5; i += 1) await requestJoin({}, codeForm({ email: `fan${i}@example.com` }));
    expect(inserts('beta_join_requests')).toHaveLength(5);

    expect(await requestJoin({}, codeForm({ email: 'fan@example.com' }))).toEqual({ error: TOO_MANY });
    expect(inserts('beta_join_requests')).toHaveLength(5);
  });
});

describe('source contract', () => {
  const root = join(__dirname, '..', 'src', 'app', 'beta', 'verify');
  const read = (name: string) => readFileSync(join(root, name), 'utf8');

  it('has no GET route handler that could burn the token', () => {
    expect(existsSync(join(root, 'route.ts'))).toBe(false);
  });

  it('the page reads no database and the form posts the server action', () => {
    const pageSource = read('page.tsx');
    expect(pageSource).not.toMatch(/authSql|@\/db\//);
    expect(read('VerifyForm.tsx')).toMatch(/useActionState<[^>]*>\(\s*confirmMagicLink,/);
    expect(read('VerifyForm.tsx')).toMatch(/<form action=\{action\}/);
    expect(read('VerifyForm.tsx')).toMatch(/type="hidden" name="token"/);
  });

  it('only the action file touches beta_login_tokens', () => {
    expect(read('actions.ts')).toMatch(/UPDATE\s+beta_login_tokens/);
    expect(read('page.tsx')).not.toMatch(/beta_login_tokens/);
    expect(read('VerifyForm.tsx')).not.toMatch(/beta_login_tokens/);
  });

  it('the emailed link still points at /beta/verify, which the gate lets through', () => {
    const actions = readFileSync(join(root, '..', 'actions.ts'), 'utf8');
    expect(actions).toContain('/beta/verify?token=');
    expect(readFileSync(join(root, '..', '..', '..', 'middleware.ts'), 'utf8')).toMatch(/'\/beta',/);
  });
});

function findElements(
  node: unknown,
  type: unknown,
): { props: Record<string, unknown> }[] {
  const found: { props: Record<string, unknown> }[] = [];
  const walk = (value: unknown) => {
    if (Array.isArray(value)) {
      value.forEach(walk);
      return;
    }
    if (value && typeof value === 'object') {
      const element = value as { type?: unknown; props?: Record<string, unknown> };
      if (element.type === type && element.props) found.push({ props: element.props });
      if (element.props) walk(element.props.children);
    }
  };
  walk(node);
  return found;
}
