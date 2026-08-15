import { timingSafeEqual } from 'node:crypto';

import { NextResponse } from 'next/server';

import { authSql } from '@/db/authClient';
import { RateLimiter } from '@/lib/auth/rate-limit';
import { audit, lastForwardedIp } from '@/lib/auth/session';
import { MAX_UPLOAD_BYTES, stageSubmission, validateSubmission } from '@/lib/ingest/pipeline';

export const dynamic = 'force-dynamic';

/**
 * Server-to-server intake for emailed CSVs.
 *
 * The counterpart to /admin/upload's form, reached instead by
 * tools/email_intake/fetch_and_stage.py, a poller that watches a
 * mailbox and forwards each CSV attachment here. This route trusts
 * nothing about the caller except a shared secret (never a browser
 * session — the poller runs unattended on the server) and independently
 * re-resolves the claimed sender against auth_users itself, exactly as
 * every other write path in this codebase re-checks its own
 * authorisation rather than trusting what a caller asserts.
 *
 * From here it is the SAME pipeline the web form uses --
 * stageSubmission then validateSubmission, nothing more. It never
 * approves or promotes: an emailed file reaches staged/validated only,
 * same as a web upload, so a human still reviews it at
 * /admin/submissions/<id> before anything reaches the statistical
 * tables. "Processed by a script" means validated, not auto-applied.
 */

const INTAKE_LIMIT = new RateLimiter(20, 15 * 60 * 1000);

function timingSafeStringEqual(a: string, b: string): boolean {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  // Compare a buffer to itself when lengths differ so a length
  // mismatch takes the same time as a same-length mismatch, the same
  // shape as verifyPassword's dummy-hash comparison on an unknown user.
  if (bufA.length !== bufB.length) {
    timingSafeEqual(bufA, bufA);
    return false;
  }
  return timingSafeEqual(bufA, bufB);
}

type IntakeBody = {
  senderEmail?: string;
  dataset?: string;
  filename?: string;
  contentBase64?: string;
};

export async function POST(request: Request) {
  const configuredSecret = process.env.AFLDB_EMAIL_INTAKE_SECRET;
  if (!configuredSecret) {
    return NextResponse.json({ error: 'Email intake is not configured on this server.' }, { status: 503 });
  }

  const ip = lastForwardedIp(request.headers.get('x-forwarded-for'));
  if (INTAKE_LIMIT.check(`ip:${ip ?? 'unknown'}`)) {
    return NextResponse.json({ error: 'Too many requests.' }, { status: 429 });
  }

  const providedSecret = request.headers.get('x-intake-secret') ?? '';
  if (!timingSafeStringEqual(providedSecret, configuredSecret)) {
    return NextResponse.json({ error: 'Unauthorized.' }, { status: 401 });
  }

  let body: IntakeBody;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body.' }, { status: 400 });
  }

  const senderEmail = String(body.senderEmail ?? '').trim().toLowerCase();
  const dataset = String(body.dataset ?? '').trim();
  const filename = String(body.filename ?? 'email-upload.csv').slice(0, 200);
  const contentBase64 = String(body.contentBase64 ?? '');
  if (!senderEmail || !dataset || !contentBase64) {
    return NextResponse.json(
      { error: 'senderEmail, dataset and contentBase64 are all required.' }, { status: 400 },
    );
  }

  // The secret proves the CALLER is the trusted poller; it says nothing
  // about who SENT the email. The sender still has to be a real,
  // enabled admin -- resolved here, not trusted from the request body.
  const [admin] = await authSql<{ id: number; email: string }[]>`
    SELECT id, email FROM auth_users
     WHERE email = ${senderEmail} AND role IN ('admin', 'super_admin') AND disabled_at IS NULL
  `;
  if (!admin) {
    await audit('email_intake.rejected', { senderEmail, dataset, filename }, { label: senderEmail });
    return NextResponse.json({ error: 'Sender is not a known, enabled admin.' }, { status: 403 });
  }

  let content: Buffer;
  try {
    content = Buffer.from(contentBase64, 'base64');
  } catch {
    return NextResponse.json({ error: 'contentBase64 is not valid base64.' }, { status: 400 });
  }
  if (content.length === 0) {
    return NextResponse.json({ error: 'Empty attachment.' }, { status: 400 });
  }
  if (content.length > MAX_UPLOAD_BYTES) {
    return NextResponse.json({ error: 'The attachment exceeds the 5 MB limit.' }, { status: 400 });
  }

  const staged = await stageSubmission(dataset, filename, content, admin.id);
  if (!staged.ok) {
    await audit('email_intake.stage_failed', { senderEmail, dataset, filename, error: staged.error },
      { userId: admin.id, label: admin.email });
    return NextResponse.json({ error: staged.error }, { status: 400 });
  }
  await audit('email_intake.staged',
    { dataset, filename, submissionId: staged.submissionId, rows: staged.rowCount },
    { userId: admin.id, label: admin.email });

  const report = await validateSubmission(staged.submissionId);
  await audit('email_intake.validated', { submissionId: staged.submissionId, report },
    { userId: admin.id, label: admin.email });

  return NextResponse.json({
    ok: true,
    submissionId: staged.submissionId,
    rowCount: staged.rowCount,
    report,
    reviewUrl: `/admin/submissions/${staged.submissionId}`,
  });
}
