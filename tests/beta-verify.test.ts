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

import { beforeEach, describe, expect, it, vi } from 'vitest';

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
  ip: '203.0.113.1',
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
    return Promise.resolve([]);
  },
}));

vi.mock('@/lib/auth/session', () => ({
  audit: vi.fn(async () => undefined),
  grantBetaAccess: vi.fn(async () => undefined),
  requestIp: vi.fn(async () => state.ip),
}));

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

beforeEach(() => {
  state.statements.length = 0;
  state.tokens.clear();
  state.tokens.set(sha256Hex(TOKEN), { email: EMAIL, unused: true });
  state.allowlisted = true;
  // The limiter is module state: a fresh caller per test keeps cases independent.
  ipCounter += 1;
  state.ip = `203.0.113.${ipCounter}`;
  vi.mocked(audit).mockClear();
  vi.mocked(grantBetaAccess).mockClear();
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
