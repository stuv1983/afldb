import { NextResponse } from 'next/server';

import { insertEarlyAccessRequest } from '@/db/queries/early-access';
import { getSiteSettings } from '@/db/queries/site-settings';
import { RateLimiter } from '@/lib/auth/rate-limit';
import { audit, lastForwardedIp } from '@/lib/auth/session';
import { sendEmail } from '@/lib/email/send';
import { EARLY_ACCESS_LIMITS, isEmailish, type EarlyAccessQuestion } from '@/lib/site-settings';

export const dynamic = 'force-dynamic';

/**
 * The public early-access request form, as data.
 *
 * This route exists because the coming-soon page at the apex is a STATIC file
 * served by Caddy, not by this app (deploy/Caddyfile.production explains why:
 * the marketing page is the SEO asset and must not go down with the app or
 * the database). It still has to ask whatever questions a super admin has
 * configured, so the page fetches them from here and posts answers back.
 * Same origin both ways — Caddy proxies exactly this path to the app.
 *
 * GET  the form definition: whether it is open, the intro, the questions.
 * POST an answer set, which only ever queues a pending row for a human at
 *      /admin/access. Nothing here admits anybody.
 *
 * Unauthenticated by design, so it is rate-limited by IP and every field is
 * validated against the CURRENT question list rather than trusted.
 */

const SUBMIT_LIMIT = new RateLimiter(5, 15 * 60 * 1000);
const READ_LIMIT = new RateLimiter(120, 15 * 60 * 1000);

/** Never say more than "we took it" — see the generic-failure note in beta/actions.ts. */
const ACCEPTED = { ok: true } as const;

export async function GET(request: Request) {
  const ip = lastForwardedIp(request.headers.get('x-forwarded-for'));
  if (READ_LIMIT.check(`ip:${ip ?? 'unknown'}`)) {
    return NextResponse.json({ error: 'Too many requests.' }, { status: 429 });
  }

  const settings = await getSiteSettings();

  return NextResponse.json(
    {
      open: settings.earlyAccessOpen,
      intro: settings.earlyAccessIntro,
      // Closed means closed: the questions are not published either, so a
      // form that is switched off cannot be reconstructed and posted to.
      questions: settings.earlyAccessOpen ? settings.earlyAccessQuestions : [],
    },
    {
      headers: {
        // Short enough that switching the form off takes effect promptly,
        // long enough that the apex page is not a per-visitor database read.
        'Cache-Control': 'public, max-age=60, s-maxage=60',
      },
    },
  );
}

type SubmitBody = {
  email?: unknown;
  name?: unknown;
  answers?: unknown;
  /** Honeypot: a real browser leaves it empty because it is hidden. */
  website?: unknown;
};

/**
 * Validate one answer against its question.
 * Returns the value to store, or null to store nothing for it.
 */
function answerFor(
  question: EarlyAccessQuestion,
  submitted: Record<string, unknown>,
): { ok: true; value: string | null } | { ok: false } {
  const raw = submitted[question.id];
  const value = typeof raw === 'string'
    ? raw.trim().slice(0, EARLY_ACCESS_LIMITS.answerChars)
    : '';

  if (!value) return question.required ? { ok: false } : { ok: true, value: null };

  // A select must answer with one of ITS OWN options. Anything else is a
  // hand-posted value, and storing it would put unreviewed text in front of
  // an admin as though it were a choice they had defined.
  if (question.type === 'select' && !(question.options ?? []).includes(value)) {
    return { ok: false };
  }

  return { ok: true, value };
}

export async function POST(request: Request) {
  const ip = lastForwardedIp(request.headers.get('x-forwarded-for'));

  if (SUBMIT_LIMIT.check(`ip:${ip ?? 'unknown'}`)) {
    return NextResponse.json(
      { error: 'Too many attempts. Wait a few minutes and try again.' },
      { status: 429 },
    );
  }

  let body: SubmitBody;
  try {
    body = await request.json() as SubmitBody;
  } catch {
    return NextResponse.json({ error: 'Malformed request.' }, { status: 400 });
  }

  // Silently accept and discard: a bot that filled the hidden field learns
  // nothing from a success response, whereas an error tells it what to fix.
  if (typeof body.website === 'string' && body.website.trim() !== '') {
    return NextResponse.json(ACCEPTED);
  }

  const settings = await getSiteSettings();
  if (!settings.earlyAccessOpen) {
    return NextResponse.json(
      { error: 'Early access requests are closed at the moment.' },
      { status: 403 },
    );
  }

  const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : '';
  if (!isEmailish(email)) {
    return NextResponse.json({ error: 'That is not an email address.' }, { status: 400 });
  }

  const name = typeof body.name === 'string' && body.name.trim()
    ? body.name.trim().slice(0, 200)
    : null;

  const submitted = body.answers && typeof body.answers === 'object' && !Array.isArray(body.answers)
    ? body.answers as Record<string, unknown>
    : {};

  // Only the configured questions are read, so extra keys are dropped rather
  // than stored — the stored object can never contain a field no admin asked
  // for.
  const answers: Record<string, string> = {};
  for (const question of settings.earlyAccessQuestions) {
    const result = answerFor(question, submitted);
    if (!result.ok) {
      return NextResponse.json(
        { error: `Please answer: ${question.label}` },
        { status: 400 },
      );
    }
    if (result.value !== null) answers[question.id] = result.value;
  }

  await insertEarlyAccessRequest({ email, name, answers, ip });
  await audit('beta.join_requested', { email, via: 'early-access' }, { label: email });

  // The row is committed before this point, so a dead relay costs a
  // notification, never the request itself.
  if (settings.earlyAccessNotify) {
    const lines = [
      `Email: ${email}`,
      name ? `Name:  ${name}` : null,
      '',
      ...settings.earlyAccessQuestions.map((question) => {
        const value = answers[question.id];
        return `${question.label}\n  ${value ?? '(not answered)'}`;
      }),
      '',
      'Review: /admin/access',
    ].filter((line) => line !== null);

    await sendEmail({
      to: settings.earlyAccessNotifyTo,
      subject: `AFLDB early access request — ${email}`,
      text: lines.join('\n'),
      replyTo: email,
    });
  }

  return NextResponse.json(ACCEPTED);
}
