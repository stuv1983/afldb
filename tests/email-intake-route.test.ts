/**
 * POST /api/admin/email-intake after AFLDB V2 Stage 5 retired it (V2-GAP-013,
 * docs/v2/legacy-disposition.md L3), DB-free.
 *
 * The route used to authenticate the mailbox poller by a shared secret, resolve the claimed
 * sender against `auth_users`, stage the attached CSV and validate it (AFLDB-ISSUE-273 and
 * AFLDB-ISSUE-304 hardened that path: reviewer races, the declared-size bound). All of it fed the
 * retired CSV review and promotion path, so the route now answers HTTP 410 Gone IMMEDIATELY with
 * the typed refusal: no body is read, no secret is compared, no database is touched and no audit
 * row is written (an unauthenticated caller cannot be attributed, and auditing anonymous calls
 * would let anyone write audit rows).
 *
 * Every dependency the old route had is a mock here and is asserted uncalled. The staging and
 * validation LIBRARY (`src/lib/ingest/pipeline.ts`) is retained for the offline tools and keeps
 * its own tests (tests/submission-review-actions.test.ts, tests/integration/submission-
 * promotion.test.ts); the reviewer races of ISSUE-273 reached the library only through this
 * route and the retired review actions, so they have no remaining runtime entry point.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({
  audit: vi.fn<(...args: unknown[]) => Promise<void>>(),
  authSql: vi.fn(() => { throw new Error('the retired email-intake route must not touch the database'); }),
  stageSubmission: vi.fn(),
  validateSubmission: vi.fn(),
}));

vi.mock('@/db/authClient', () => ({ authSql: h.authSql }));
vi.mock('@/lib/auth/session', () => ({ audit: h.audit, lastForwardedIp: () => '203.0.113.9' }));
vi.mock('@/lib/ingest/pipeline', () => ({
  INTAKE_VALIDATION_START_STATUSES: ['staged', 'validated'],
  MAX_UPLOAD_BYTES: 5 * 1024 * 1024,
  stageSubmission: h.stageSubmission,
  validateSubmission: h.validateSubmission,
}));

const { POST } = await import('@/app/api/admin/email-intake/route');

/** The route takes no parameter; a stub request lets the cases prove nothing on it is read. */
const deliver = POST as unknown as (request: Request) => Promise<Response>;

const ROOT = process.cwd();
const read = (relative: string) => readFileSync(join(ROOT, relative), 'utf8').replace(/\r\n/g, '\n');

function trackedRequest(headers: Record<string, string> = {}) {
  const calls: string[] = [];
  const touch = (name: string) => () => { calls.push(name); throw new Error(`the request ${name} must not be read`); };
  const request = {
    headers: new Proxy(new Headers(headers), {
      get(target, prop) {
        if (typeof prop === 'string' && ['get', 'has', 'entries', 'forEach'].includes(prop)) {
          return () => { calls.push(`headers.${prop}`); return null; };
        }
        return Reflect.get(target, prop, target);
      },
    }),
    json: touch('json'),
    text: touch('text'),
    formData: touch('formData'),
    arrayBuffer: touch('arrayBuffer'),
  } as unknown as Request;
  return { request, calls };
}

beforeAll(() => { vi.stubEnv('AFLDB_EMAIL_INTAKE_SECRET', 'unit-secret'); });
afterAll(() => { vi.unstubAllEnvs(); });
beforeEach(() => {
  vi.clearAllMocks();
  h.audit.mockResolvedValue(undefined);
});

describe('email intake: retired, HTTP 410 with the typed refusal', () => {
  it('answers 410 Gone with the retirement refusal for a delivery the old route would have accepted', async () => {
    const res = await deliver(new Request('http://localhost/api/admin/email-intake', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-intake-secret': 'unit-secret' },
      body: JSON.stringify({
        senderEmail: 'admin@example.com',
        dataset: 'player_bio',
        contentBase64: Buffer.from('player_id,dob\n1,2000-01-01\n').toString('base64'),
      }),
    }));

    expect(res.status).toBe(410);
    const body = await res.json() as { refused: boolean; code: string; surface: string; error: string };
    expect(body).toMatchObject({ refused: true, code: 'legacy_retired', surface: 'admin.email_intake' });
    expect(body.error).toMatch(/retired/i);
    expect(h.stageSubmission).not.toHaveBeenCalled();
    expect(h.validateSubmission).not.toHaveBeenCalled();
  });

  it('answers the same for a wrong secret, no secret header and an unconfigured server', async () => {
    const answers: unknown[] = [];
    for (const secret of ['not-the-secret', undefined]) {
      const res = await deliver(new Request('http://localhost/api/admin/email-intake', {
        method: 'POST',
        headers: secret === undefined ? {} : { 'x-intake-secret': secret },
        body: '{}',
      }));
      expect(res.status).toBe(410);
      answers.push(await res.json());
    }
    vi.stubEnv('AFLDB_EMAIL_INTAKE_SECRET', '');
    const unconfigured = await deliver(new Request('http://localhost/api/admin/email-intake', { method: 'POST', body: '{}' }));
    expect(unconfigured.status).toBe(410);
    answers.push(await unconfigured.json());
    vi.stubEnv('AFLDB_EMAIL_INTAKE_SECRET', 'unit-secret');

    // Never 401 or 503: nothing about the caller or the configuration can change the answer.
    expect(new Set(answers.map((a) => JSON.stringify(a))).size).toBe(1);
  });

  it('reads nothing from the request: no body, no header, no secret comparison', async () => {
    const { request, calls } = trackedRequest({ 'x-intake-secret': 'unit-secret', 'content-length': '999999999' });

    const res = await deliver(request);

    expect(res.status).toBe(410);
    expect(calls).toEqual([]);
  });

  it('touches no database and writes no audit row, even for an unattributable caller', async () => {
    await deliver(new Request('http://localhost/api/admin/email-intake', {
      method: 'POST',
      headers: { 'x-intake-secret': 'unit-secret' },
      body: JSON.stringify({ senderEmail: 'someone@example.com', dataset: 'player_bio', contentBase64: 'AAAA' }),
    }));

    expect(h.authSql).not.toHaveBeenCalled();
    expect(h.audit).not.toHaveBeenCalled();
  });

  it('ignores a body that would have been oversized, malformed or from an unknown sender', async () => {
    for (const body of ['not json', JSON.stringify({ senderEmail: 'nobody@example.com' }), 'x'.repeat(100_000)]) {
      const res = await deliver(new Request('http://localhost/api/admin/email-intake', {
        method: 'POST', headers: { 'x-intake-secret': 'unit-secret' }, body,
      }));
      expect(res.status).toBe(410);
    }
    expect(h.authSql).not.toHaveBeenCalled();
    expect(h.audit).not.toHaveBeenCalled();
  });
});

describe('email intake: what is pinned statically', () => {
  const route = read('src/app/api/admin/email-intake/route.ts');
  const code = route.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/[^\n]*/g, '$1');

  it('the route imports no pipeline, database, session, secret or rate limiter', () => {
    expect(code).not.toMatch(/ingest\/pipeline|ingest\/datasets|authClient|auth\/session|rate-limit/);
    expect(code).not.toMatch(/AFLDB_EMAIL_INTAKE_SECRET|timingSafeEqual|x-intake-secret|request\.json|authSql/);
    expect(code).toContain("goneRetiredAdminRoute('admin.email_intake')");
  });

  it('the poller files a 4xx answer other than 408/429 to its Errors folder, so a 410 loses no message', () => {
    // tools/email_intake/fetch_and_stage.py: post_to_intake raises PermanentFailure for 4xx other
    // than 408/429, and main() files that message to the error folder (copy + \Seen, never deleted).
    // This test pins the Python source text only; the poller is not executable in V2.
    const poller = read('tools/email_intake/fetch_and_stage.py');
    expect(poller).toContain('if 400 <= exc.code < 500 and exc.code not in (408, 429):');
    expect(poller).toMatch(/raise PermanentFailure\(f"HTTP \{exc\.code\}: \{detail\}"\) from exc/);
    expect(poller).toMatch(/except PermanentFailure as exc:\n\s+print\(f" {4}REJECTED: \{exc\}"\)\n\s+file_message\(conn, msg_id, error_folder\)/);
    expect(poller).not.toMatch(/\\Deleted|expunge/);
  });
});
