import { timingSafeEqual } from 'node:crypto';

import { NextResponse } from 'next/server';

import { authSql } from '@/db/authClient';
import { RateLimiter } from '@/lib/auth/rate-limit';
import { audit, lastForwardedIp } from '@/lib/auth/session';
import type { StageResult, ValidationSummary } from '@/lib/ingest/pipeline';
import {
  INTAKE_VALIDATION_START_STATUSES, MAX_UPLOAD_BYTES, stageSubmission, SubmissionChangedError,
  SubmissionNotValidatableError, validateSubmission,
} from '@/lib/ingest/pipeline';

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

/**
 * Two limiters, because two different things are being bounded.
 *
 * AUTH_FAILURES bounds guessing at the secret, and counts ONLY failed
 * attempts -- a single limiter charging every request would let a
 * legitimate batch of emailed CSVs exhaust the brute-force budget and
 * lock the poller out of its own route.
 *
 * INTAKE_WORK bounds the staging itself, generously: a morning's worth
 * of forwarded mail is normal, a thousand POSTs is a runaway loop. The
 * poller treats 429 as retryable, so tripping this delays a message
 * rather than losing it.
 */
const AUTH_FAILURES = new RateLimiter(10, 15 * 60 * 1000);
const INTAKE_WORK = new RateLimiter(200, 15 * 60 * 1000);

/**
 * Base64 that Buffer.from would silently accept.
 *
 * `Buffer.from(s, 'base64')` never throws -- it skips characters it
 * does not recognise -- so a truncated or corrupted attachment decodes
 * to plausible-looking garbage and surfaces as a confusing CSV parse
 * error rather than "the transfer was damaged".
 */
const BASE64_RE = /^[A-Za-z0-9+/]*={0,2}$/;

/** 4 base64 characters per 3 bytes, plus room for padding. */
const MAX_BASE64_LENGTH = Math.ceil(MAX_UPLOAD_BYTES / 3) * 4 + 4;

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

/**
 * AFLDB-ISSUE-273 (D-273-1): the statuses that mean a reviewer has ruled on
 * the file. Each is reached only through a review action -- approve, reject,
 * or a promotion of an approved file ('failed' is a promotion that raised,
 * and stays re-promotable) -- and stageSubmission will not resolve a resend
 * to any of them, so a retry after one would stage the file a second time.
 */
const DECIDED_STATUSES = new Set(['approved', 'rejected', 'promoted', 'failed']);

/**
 * The status a reviewer left a refused validation's submission in, or null.
 *
 * Refused at its first read (the intake's start policy): that read's own
 * status, which is already confirmed. Refused at the write
 * (SubmissionChangedError): a fresh re-read. Anything else -- any other error,
 * the row gone, the re-read failing, 'staged' or 'validated', a status this
 * list does not know -- is null, and the caller keeps the retryable 500.
 */
async function decidedStatus(error: unknown, submissionId: number): Promise<string | null> {
  if (error instanceof SubmissionNotValidatableError) {
    return DECIDED_STATUSES.has(error.status) ? error.status : null;
  }
  if (!(error instanceof SubmissionChangedError)) return null;
  try {
    const [row] = await authSql<{ status: string }[]>`
      SELECT status::text FROM data_submissions WHERE id = ${submissionId}
    `;
    return row && DECIDED_STATUSES.has(row.status) ? row.status : null;
  } catch (error) {
    console.error('[email-intake] could not re-read a changed submission', error);
    return null;
  }
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

  const key = `ip:${lastForwardedIp(request.headers.get('x-forwarded-for')) ?? 'unknown'}`;
  if (AUTH_FAILURES.peek(key)) {
    return NextResponse.json({ error: 'Too many failed attempts.' }, { status: 429 });
  }

  const providedSecret = request.headers.get('x-intake-secret') ?? '';
  if (!timingSafeStringEqual(providedSecret, configuredSecret)) {
    AUTH_FAILURES.check(key);
    return NextResponse.json({ error: 'Unauthorized.' }, { status: 401 });
  }

  if (INTAKE_WORK.check(key)) {
    return NextResponse.json({ error: 'Too many requests.' }, { status: 429 });
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
  // about who SENT the email. The sender still has to be a real, enabled
  // account -- resolved here, not trusted from the request body.
  //
  // Contributors count: this is the email counterpart of /admin/upload,
  // which admits them via requireUploader, and submitting data is the whole
  // reason that role exists. It reaches no further than the form does --
  // staged and validated only, with an admin still reviewing before promotion.
  const [admin] = await authSql<{ id: number; email: string }[]>`
    SELECT id, email FROM auth_users
     WHERE email = ${senderEmail}
       AND role IN ('admin', 'super_admin', 'contributor')
       AND disabled_at IS NULL
  `;
  if (!admin) {
    await audit('email_intake.rejected', { senderEmail, dataset, filename }, { label: senderEmail });
    return NextResponse.json({ error: 'Sender is not a known, enabled account.' }, { status: 403 });
  }

  // Size-check the encoding before decoding it: a 5 MB cap on the file
  // means anything much past 6.7 MB of base64 is already over, and
  // rejecting it here avoids allocating the buffer to find that out.
  const encoded = contentBase64.replace(/\s+/g, '');
  if (encoded.length > MAX_BASE64_LENGTH) {
    return NextResponse.json({ error: 'The attachment exceeds the 5 MB limit.' }, { status: 400 });
  }
  if (encoded.length % 4 !== 0 || !BASE64_RE.test(encoded)) {
    return NextResponse.json({ error: 'contentBase64 is not valid base64.' }, { status: 400 });
  }

  const content = Buffer.from(encoded, 'base64');
  if (content.length === 0) {
    return NextResponse.json({ error: 'Empty attachment.' }, { status: 400 });
  }
  if (content.length > MAX_UPLOAD_BYTES) {
    return NextResponse.json({ error: 'The attachment exceeds the 5 MB limit.' }, { status: 400 });
  }

  // Staging and validation both talk to the database and both can
  // throw -- a CSV that trips a parser bug, a validator query that
  // times out, the pool exhausted. Unhandled, those become a bare 500
  // with a stack trace in the body; the poller cannot tell them apart
  // from "your file was bad" and files the message under Errors
  // forever. A deliberate 500 with a stable shape says "try again",
  // which is what the caller should actually do.
  let staged: StageResult;
  try {
    staged = await stageSubmission(dataset, filename, content, admin.id);
  } catch (error) {
    console.error('[email-intake] staging failed', error);
    await audit('email_intake.stage_error', { senderEmail, dataset, filename },
      { userId: admin.id, label: admin.email }).catch(() => {});
    return NextResponse.json({ error: 'Staging failed on the server.' }, { status: 500 });
  }

  if (!staged.ok) {
    await audit('email_intake.stage_failed', { senderEmail, dataset, filename, error: staged.error },
      { userId: admin.id, label: admin.email });
    return NextResponse.json({ error: staged.error }, { status: 400 });
  }
  await audit(staged.duplicate ? 'email_intake.duplicate' : 'email_intake.staged',
    { dataset, filename, submissionId: staged.submissionId, rows: staged.rowCount },
    { userId: admin.id, label: admin.email });

  // Re-validating a duplicate is deliberate: the retry that produced it
  // may be exactly because validation did not finish the first time.
  // A duplicate is only ever 'staged' or 'validated' (stageSubmission
  // will not reopen a submission a human has ruled on), and
  // validateSubmission rewrites the verdicts for both, so this is
  // idempotent rather than a second, conflicting report.
  //
  // AFLDB-ISSUE-273: and only those two. A reviewer can still rule between
  // staging and validation's first read; the intake's start policy refuses
  // the run at that read rather than reopening a rejection.
  let report: ValidationSummary;
  try {
    report = await validateSubmission(staged.submissionId,
      { startStatuses: INTAKE_VALIDATION_START_STATUSES });
    await audit('email_intake.validated', { submissionId: staged.submissionId, report },
      { userId: admin.id, label: admin.email });
  } catch (error) {
    // AFLDB-ISSUE-273 (D-273-1): a reviewer approved, rejected or promoted
    // the file before this validation attempt's first read or while it ran,
    // so the attempt wrote no verdicts or resolved payloads (this delivery
    // may still have staged the file). That decision is the outcome; a 5xx
    // would make the poller resend, and the resend would stage a second copy.
    // `validated: false` describes this attempt only: a promoted file was
    // validated before it was approved. A run that lost to another
    // validation still falls through to the 500, and its retry resolves to
    // the same submission.
    const status = await decidedStatus(error, staged.submissionId);
    if (status) {
      // Best effort, unlike the success audits: a throw here would become a
      // 500 and bring back exactly the resend this branch exists to stop.
      await audit('email_intake.validation_superseded',
        { submissionId: staged.submissionId, dataset, filename, status },
        { userId: admin.id, label: admin.email })
        .catch((auditError) => console.error('[email-intake] audit failed', auditError));
      return NextResponse.json({
        ok: true,
        submissionId: staged.submissionId,
        duplicate: staged.duplicate,
        rowCount: staged.rowCount,
        validated: false,
        status,
        message: `A reviewer has ruled on this file (it is now ${status}); `
          + 'this validation attempt wrote no verdicts or resolved payloads.',
        reviewUrl: `/admin/submissions/${staged.submissionId}`,
      });
    }

    console.error('[email-intake] validation failed', error);
    await audit('email_intake.validate_error',
      { submissionId: staged.submissionId, dataset, filename },
      { userId: admin.id, label: admin.email }).catch(() => {});
    // The file IS staged; only the verdicts are missing. Say so, so a
    // retry is understood as resuming rather than resubmitting, and
    // point at the submission a human can re-validate by hand.
    return NextResponse.json({
      error: 'The file was staged but validation failed; it can be re-validated from the review page.',
      submissionId: staged.submissionId,
      reviewUrl: `/admin/submissions/${staged.submissionId}`,
    }, { status: 500 });
  }

  return NextResponse.json({
    ok: true,
    submissionId: staged.submissionId,
    duplicate: staged.duplicate,
    rowCount: staged.rowCount,
    report,
    reviewUrl: `/admin/submissions/${staged.submissionId}`,
  });
}
