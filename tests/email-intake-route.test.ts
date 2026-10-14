/**
 * AFLDB-ISSUE-273 (D-273-1): how POST /api/admin/email-intake answers a
 * validation refused because a reviewer ruled on the file -- at its first
 * read (SubmissionNotValidatableError, the intake's start policy) or at its
 * write (SubmissionChangedError) -- DB-free.
 *
 * The races themselves are driven for real in
 * tests/integration/email-intake.test.ts. This file pins the branches a real
 * database cannot easily produce: the re-read failing, a status the route
 * does not know, 'failed', and an audit failure on the acknowledged path.
 */
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => {
  class SubmissionChangedError extends Error {
    constructor(message: string) {
      super(message);
      this.name = 'SubmissionChangedError';
    }
  }
  class SubmissionNotValidatableError extends Error {
    readonly submissionId: number;
    readonly status: string;

    constructor(submissionId: number, status: string) {
      super(`submission is ${status}; only staged files can be validated`);
      this.name = 'SubmissionNotValidatableError';
      this.submissionId = submissionId;
      this.status = status;
    }
  }
  return {
    SubmissionChangedError,
    SubmissionNotValidatableError,
    INTAKE_VALIDATION_START_STATUSES: ['staged', 'validated'],
    reread: vi.fn<() => Promise<{ status: string }[]>>(),
    validate: vi.fn(),
    audit: vi.fn<(...args: unknown[]) => Promise<void>>(),
  };
});

vi.mock('@/db/authClient', () => ({
  authSql: (strings: TemplateStringsArray) => {
    const text = strings.join('$');
    if (text.includes('FROM auth_users')) return Promise.resolve([{ id: 7, email: 'admin@example.com' }]);
    if (text.includes('FROM data_submissions')) return h.reread();
    throw new Error(`unexpected query: ${text}`);
  },
}));
vi.mock('@/lib/auth/session', () => ({ audit: h.audit, lastForwardedIp: () => '203.0.113.9' }));
vi.mock('@/lib/ingest/pipeline', () => ({
  INTAKE_VALIDATION_START_STATUSES: h.INTAKE_VALIDATION_START_STATUSES,
  MAX_UPLOAD_BYTES: 5 * 1024 * 1024,
  SubmissionChangedError: h.SubmissionChangedError,
  SubmissionNotValidatableError: h.SubmissionNotValidatableError,
  stageSubmission: vi.fn(async () => ({ ok: true, submissionId: 41, rowCount: 1, duplicate: true })),
  validateSubmission: h.validate,
}));

const { POST } = await import('@/app/api/admin/email-intake/route');

const RETRY_500 = {
  error: 'The file was staged but validation failed; it can be re-validated from the review page.',
  submissionId: 41,
  reviewUrl: '/admin/submissions/41',
};

function deliver() {
  return POST(new Request('http://localhost/api/admin/email-intake', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-intake-secret': 'unit-secret' },
    body: JSON.stringify({
      senderEmail: 'admin@example.com',
      dataset: 'player_bio',
      contentBase64: Buffer.from('player_id,dob\n1,2000-01-01\n').toString('base64'),
    }),
  }));
}

const actions = () => h.audit.mock.calls.map((call) => call[0]);

const acknowledged = (status: string) => ({
  ok: true,
  submissionId: 41,
  duplicate: true,
  rowCount: 1,
  validated: false,
  status,
  message: `A reviewer has ruled on this file (it is now ${status}); `
    + 'this validation attempt wrote no verdicts or resolved payloads.',
  reviewUrl: '/admin/submissions/41',
});

beforeAll(() => { vi.stubEnv('AFLDB_EMAIL_INTAKE_SECRET', 'unit-secret'); });
afterAll(() => { vi.unstubAllEnvs(); });
beforeEach(() => {
  h.reread.mockReset();
  h.validate.mockReset();
  h.audit.mockReset();
  h.audit.mockImplementation(async () => {});
  h.validate.mockRejectedValue(new h.SubmissionChangedError('changed'));
});
afterEach(() => { vi.restoreAllMocks(); });

describe('email intake: a validation refused because the submission changed', () => {
  it.each(['approved', 'rejected', 'promoted', 'failed'])('acknowledges a file a reviewer left %s', async (status) => {
    h.reread.mockResolvedValue([{ status }]);

    const res = await deliver();

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual(acknowledged(status));
    expect(actions()).toEqual(['email_intake.duplicate', 'email_intake.validation_superseded']);
    expect(h.audit.mock.calls[1][1]).toMatchObject({ submissionId: 41, status });
  });

  it.each([
    ['still staged', () => h.reread.mockResolvedValue([{ status: 'staged' }])],
    ['still validated (lost to another validation)', () => h.reread.mockResolvedValue([{ status: 'validated' }])],
    ['missing', () => h.reread.mockResolvedValue([])],
    ['an unknown status', () => h.reread.mockResolvedValue([{ status: 'archived' }])],
    ['unreadable', () => h.reread.mockRejectedValue(new Error('connection reset'))],
  ])('keeps the retryable 500 when the submission is %s', async (_label, arrange) => {
    arrange();
    vi.spyOn(console, 'error').mockImplementation(() => {});

    const res = await deliver();

    expect(res.status).toBe(500);
    expect(await res.json()).toEqual(RETRY_500);
    expect(h.reread).toHaveBeenCalledTimes(1);
    expect(actions()).toEqual(['email_intake.duplicate', 'email_intake.validate_error']);
  });

  it('keeps the existing 500 for an ordinary validation failure, without re-reading', async () => {
    h.validate.mockRejectedValue(new Error('validator query timed out'));
    vi.spyOn(console, 'error').mockImplementation(() => {});

    const res = await deliver();

    expect(res.status).toBe(500);
    expect(await res.json()).toEqual(RETRY_500);
    expect(h.reread).not.toHaveBeenCalled();
    expect(actions()).toEqual(['email_intake.duplicate', 'email_intake.validate_error']);
  });

  it('validates under the intake start policy, which excludes rejected', async () => {
    h.validate.mockResolvedValue({ ok: 1, warnings: 0, errors: 0, duplicates: 0 });

    const res = await deliver();

    expect(res.status).toBe(200);
    expect(h.validate).toHaveBeenCalledWith(41, { startStatuses: ['staged', 'validated'] });
    expect(actions()).toEqual(['email_intake.duplicate', 'email_intake.validated']);
  });

  it('still acknowledges a superseded delivery when its audit write fails', async () => {
    h.reread.mockResolvedValue([{ status: 'promoted' }]);
    h.audit.mockImplementation(async (action) => {
      if (action === 'email_intake.validation_superseded') throw new Error('audit insert failed');
    });
    const logged = vi.spyOn(console, 'error').mockImplementation(() => {});

    const res = await deliver();

    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ ok: true, validated: false, status: 'promoted' });
    expect(logged).toHaveBeenCalledWith('[email-intake] audit failed', expect.any(Error));
  });
});

describe('email intake: a validation refused at its first read by the intake start policy', () => {
  it.each(['approved', 'rejected', 'promoted', 'failed'])(
    'acknowledges a file a reviewer left %s, from that read and without a re-read',
    async (status) => {
      h.validate.mockRejectedValue(new h.SubmissionNotValidatableError(41, status));

      const res = await deliver();

      expect(res.status).toBe(200);
      expect(await res.json()).toEqual(acknowledged(status));
      expect(h.reread).not.toHaveBeenCalled();
      expect(actions()).toEqual(['email_intake.duplicate', 'email_intake.validation_superseded']);
      expect(h.audit.mock.calls[1][1]).toMatchObject({ submissionId: 41, status });
    },
  );

  it('keeps the retryable 500 for a status it does not know', async () => {
    h.validate.mockRejectedValue(new h.SubmissionNotValidatableError(41, 'archived'));
    vi.spyOn(console, 'error').mockImplementation(() => {});

    const res = await deliver();

    expect(res.status).toBe(500);
    expect(await res.json()).toEqual(RETRY_500);
    expect(h.reread).not.toHaveBeenCalled();
    expect(actions()).toEqual(['email_intake.duplicate', 'email_intake.validate_error']);
  });

  it('keeps the retryable 500 for a missing submission (a plain error, not a refusal)', async () => {
    h.validate.mockRejectedValue(new Error('submission 41 not found'));
    vi.spyOn(console, 'error').mockImplementation(() => {});

    const res = await deliver();

    expect(res.status).toBe(500);
    expect(await res.json()).toEqual(RETRY_500);
    expect(h.reread).not.toHaveBeenCalled();
    expect(actions()).toEqual(['email_intake.duplicate', 'email_intake.validate_error']);
  });
});

describe('email intake: the declared body size is bounded before the body is parsed (AFLDB-ISSUE-304)', () => {
  // Mirrors the route: 4 base64 characters per 3 bytes of the 5 MB ceiling, plus padding, plus the
  // JSON envelope's slack. Computed here, not imported: the route exports only its handlers.
  const MAX_BASE64 = Math.ceil((5 * 1024 * 1024) / 3) * 4 + 4;
  const MAX_BODY = MAX_BASE64 + 16 * 1024;

  function requestDeclaring(contentLength: string | null, secret = 'unit-secret') {
    const headers = new Headers({ 'x-intake-secret': secret });
    if (contentLength !== null) headers.set('content-length', contentLength);
    const json = vi.fn(async () => ({
      senderEmail: 'admin@example.com',
      dataset: 'player_bio',
      contentBase64: Buffer.from('player_id,dob\n1,2000-01-01\n').toString('base64'),
    }));
    return { request: { headers, json } as unknown as Request, json };
  }

  it('answers 400 for a declared body over the limit, and never parses it', async () => {
    const { request, json } = requestDeclaring(String(MAX_BODY + 1));
    const res = await POST(request);
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: 'The attachment exceeds the 5 MB limit.' });
    expect(json).not.toHaveBeenCalled();
    expect(h.audit).not.toHaveBeenCalled();
  });

  it('parses a body declared exactly at the limit', async () => {
    h.reread.mockResolvedValue([{ status: 'approved' }]);
    const { request, json } = requestDeclaring(String(MAX_BODY));
    const res = await POST(request);
    expect(json).toHaveBeenCalledTimes(1);
    expect(res.status).toBe(200);
  });

  it('parses a body that declares no length, which cannot be bounded here', async () => {
    h.reread.mockResolvedValue([{ status: 'approved' }]);
    const { request, json } = requestDeclaring(null);
    const res = await POST(request);
    expect(json).toHaveBeenCalledTimes(1);
    expect(res.status).toBe(200);
  });

  it('treats a length it cannot read as undeclared rather than as oversize', async () => {
    h.reread.mockResolvedValue([{ status: 'approved' }]);
    const { request, json } = requestDeclaring('not-a-number');
    const res = await POST(request);
    expect(json).toHaveBeenCalledTimes(1);
    expect(res.status).toBe(200);
  });

  it('still answers a wrong secret 401 before it looks at the size', async () => {
    const { request, json } = requestDeclaring(String(MAX_BODY * 10), 'not-the-secret');
    const res = await POST(request);
    expect(res.status).toBe(401);
    expect(json).not.toHaveBeenCalled();
  });
});
