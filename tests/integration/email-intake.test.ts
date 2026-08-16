import './guard';

import { describe, expect, it } from 'vitest';

import { authSql } from '@/db/authClient';
import { POST } from '@/app/api/admin/email-intake/route';

// authSql cleanup note: see datasets.test.ts -- no afterAll(authSql.end())
// here for the same reason (the proxy's .end() is not safe to call with
// `this` bound to the proxy rather than the real client).

function request(body: unknown, headers: Record<string, string> = {}): Request {
  return new Request('http://localhost/api/admin/email-intake', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...headers },
    body: JSON.stringify(body),
  });
}

describe('POST /api/admin/email-intake', () => {
  it('refuses to run at all when no secret is configured', async () => {
    if (process.env.AFLDB_EMAIL_INTAKE_SECRET) return; // covered by the tests below instead
    const res = await POST(request(
      { senderEmail: 'nobody@example.com', dataset: 'match_results', contentBase64: 'eA==' },
    ));
    expect(res.status).toBe(503);
  });

  it('rejects a request with the wrong secret', async () => {
    if (!process.env.AFLDB_EMAIL_INTAKE_SECRET) return; // not configured in this environment
    const res = await POST(request(
      { senderEmail: 'nobody@example.com', dataset: 'match_results', contentBase64: 'eA==' },
      { 'x-intake-secret': 'definitely-not-the-real-secret' },
    ));
    expect(res.status).toBe(401);
  });

  it('rejects a request with no secret header at all', async () => {
    if (!process.env.AFLDB_EMAIL_INTAKE_SECRET) return;
    const res = await POST(request(
      { senderEmail: 'nobody@example.com', dataset: 'match_results', contentBase64: 'eA==' },
    ));
    expect(res.status).toBe(401);
  });

  it('rejects malformed JSON', async () => {
    const secret = process.env.AFLDB_EMAIL_INTAKE_SECRET;
    if (!secret) return; // not configured in this environment; covered by the tests above
    const res = await POST(new Request('http://localhost/api/admin/email-intake', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-intake-secret': secret },
      body: 'not json',
    }));
    expect(res.status).toBe(400);
  });

  it('rejects a sender who is not a known, enabled admin', async () => {
    const secret = process.env.AFLDB_EMAIL_INTAKE_SECRET;
    if (!secret) return;
    const res = await POST(request(
      { senderEmail: 'definitely-not-an-admin@example.invalid', dataset: 'match_results', contentBase64: 'eA==' },
      { 'x-intake-secret': secret },
    ));
    expect(res.status).toBe(403);
  });

  it('stages and validates a real CSV from a real admin end to end', async () => {
    const secret = process.env.AFLDB_EMAIL_INTAKE_SECRET;
    if (!secret) return;
    const [admin] = await authSql<{ email: string }[]>`
      SELECT email FROM auth_users WHERE role = 'super_admin' AND disabled_at IS NULL LIMIT 1
    `;
    if (!admin) return; // no admin fixture in this environment

    const csv = 'player,year,club,position,captain\nA Real Sounding Name,2024,Carlton,Half Back,\n';
    const contentBase64 = Buffer.from(csv, 'utf8').toString('base64');

    const res = await POST(request(
      { senderEmail: admin.email, dataset: 'all_australian', filename: 'test.csv', contentBase64 },
      { 'x-intake-secret': secret },
    ));
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.ok).toBe(true);
    expect(body.rowCount).toBe(1);
    expect(body.report).toBeDefined();

    const [row] = await authSql<{ status: string; uploadedBy: string }[]>`
      SELECT s.status::text, u.email AS "uploadedBy"
        FROM data_submissions s JOIN auth_users u ON u.id = s.uploaded_by
       WHERE s.id = ${body.submissionId}
    `;
    expect(row.status).toBe('validated');
    expect(row.uploadedBy).toBe(admin.email);

    // No cleanup: afldb_auth has DELETE on data_submission_rows but not
    // on data_submissions itself (migration 023 grants), matching this
    // table's real purpose as a standing log every real upload adds to
    // -- a test-created row is left exactly as a real one would be,
    // rather than reaching for owner-level credentials just to tidy up.
  });

  it('resolves an identical resend to the submission it already made', async () => {
    const secret = process.env.AFLDB_EMAIL_INTAKE_SECRET;
    if (!secret) return;
    const [admin] = await authSql<{ email: string }[]>`
      SELECT email FROM auth_users WHERE role = 'super_admin' AND disabled_at IS NULL LIMIT 1
    `;
    if (!admin) return;

    // The poller re-sends anything whose outcome it could not confirm,
    // so the same bytes arriving twice is a designed-for event, not a
    // mistake: it must resolve to one submission, not two identical
    // ones for a reviewer to reconcile. Unique content per run, so a
    // previous run's rows cannot make this pass for the wrong reason.
    const csv = `player,year,club,position,captain\nResend Case ${Date.now()},2024,Carlton,Half Back,\n`;
    const contentBase64 = Buffer.from(csv, 'utf8').toString('base64');
    const body = { senderEmail: admin.email, dataset: 'all_australian', filename: 'resend.csv', contentBase64 };

    const first = await POST(request(body, { 'x-intake-secret': secret })).then((r) => r.json());
    expect(first.ok).toBe(true);
    expect(first.duplicate).toBe(false);

    const second = await POST(request(body, { 'x-intake-secret': secret })).then((r) => r.json());
    expect(second.ok).toBe(true);
    expect(second.duplicate).toBe(true);
    expect(second.submissionId).toBe(first.submissionId);

    // Staged once, and the rows staged once with it: a re-run that
    // re-inserted rows would double them under the same submission.
    const [{ count }] = await authSql<{ count: string }[]>`
      SELECT count(*) FROM data_submission_rows WHERE submission_id = ${first.submissionId}
    `;
    expect(Number(count)).toBe(1);
  });

  it('rejects base64 that Buffer.from would silently accept', async () => {
    const secret = process.env.AFLDB_EMAIL_INTAKE_SECRET;
    if (!secret) return;
    const [admin] = await authSql<{ email: string }[]>`
      SELECT email FROM auth_users WHERE role = 'super_admin' AND disabled_at IS NULL LIMIT 1
    `;
    if (!admin) return;

    // Buffer.from skips characters it does not recognise rather than
    // throwing, so a damaged transfer would otherwise decode to
    // plausible garbage and surface as a confusing CSV parse error.
    const res = await POST(request(
      { senderEmail: admin.email, dataset: 'all_australian', contentBase64: 'not!valid!base64!' },
      { 'x-intake-secret': secret },
    ));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(/base64/i);
  });

  it('rejects an oversized payload', async () => {
    const secret = process.env.AFLDB_EMAIL_INTAKE_SECRET;
    if (!secret) return;
    const [admin] = await authSql<{ email: string }[]>`
      SELECT email FROM auth_users WHERE role = 'super_admin' AND disabled_at IS NULL LIMIT 1
    `;
    if (!admin) return;

    const big = 'x'.repeat(6 * 1024 * 1024); // over the 5 MB MAX_UPLOAD_BYTES limit
    const contentBase64 = Buffer.from(big, 'utf8').toString('base64');
    const res = await POST(request(
      { senderEmail: admin.email, dataset: 'match_results', contentBase64 },
      { 'x-intake-secret': secret },
    ));
    expect(res.status).toBe(400);
  });
});
