import 'server-only';

import nodemailer, { type Transporter } from 'nodemailer';

/**
 * Outbound email, through an SMTP relay.
 *
 * The credentials live in the environment, never in `site_settings`. That
 * table is public-readable by design (migration 034 says so in as many
 * words), so an SMTP password in it would be readable by the same role that
 * renders the home page. What a super admin configures from /admin/settings
 * is BEHAVIOUR — the recipient address and whether notifications are sent at
 * all — while the credential stays alongside every other secret in `.env` at
 * mode 600.
 *
 * Relay, not direct delivery: the production droplet is on DigitalOcean,
 * where outbound port 25 is blocked, and mail sent straight from a droplet IP
 * is filed as spam regardless. Any submission relay works — the settings are
 * deliberately generic.
 *
 * Delivery is never allowed to fail a user-facing action. A request for early
 * access is SAVED first and mailed second; if the relay is down, the row is
 * still in the database and visible at /admin/access, which is the actual
 * system of record. Callers get a boolean, not an exception.
 */

export type EmailConfig = {
  host: string;
  port: number;
  secure: boolean;
  user: string;
  password: string;
  from: string;
};

/**
 * Read the relay settings, or null when it is not configured.
 *
 * Absent configuration is a legal state, not an error: development has no
 * relay, and a production deploy may run for a while before one is set up.
 * Callers treat null as "do not send" rather than failing.
 */
export function emailConfig(): EmailConfig | null {
  const host = process.env.AFLDB_SMTP_HOST;
  const user = process.env.AFLDB_SMTP_USER;
  const password = process.env.AFLDB_SMTP_PASSWORD;
  const from = process.env.AFLDB_SMTP_FROM;

  if (!host || !user || !password || !from) return null;

  // 465 is implicit TLS; 587 and 25 start plaintext and STARTTLS up. Getting
  // this wrong hangs the connection rather than erroring clearly, so it is
  // derived from the port unless explicitly overridden.
  const port = Number(process.env.AFLDB_SMTP_PORT ?? 587);
  if (!Number.isInteger(port) || port <= 0 || port > 65535) return null;

  const secureOverride = process.env.AFLDB_SMTP_SECURE;
  const secure = secureOverride === undefined || secureOverride === ''
    ? port === 465
    : secureOverride === 'true';

  return { host, port, secure, user, password, from };
}

/**
 * One transporter per process, built lazily.
 *
 * nodemailer pools connections, so rebuilding it per send would open a fresh
 * TCP+TLS handshake every time. Cached against the resolved config so a
 * changed environment on restart is picked up.
 */
let cached: { key: string; transporter: Transporter } | null = null;

function transporterFor(config: EmailConfig): Transporter {
  const key = `${config.host}:${config.port}:${config.secure}:${config.user}`;
  if (cached?.key === key) return cached.transporter;

  const transporter = nodemailer.createTransport({
    host: config.host,
    port: config.port,
    secure: config.secure,
    auth: { user: config.user, pass: config.password },
    pool: true,
    maxConnections: 2,
    // A relay that is not answering must not hold a request open: the caller
    // has already committed its database row and is only waiting on courtesy.
    connectionTimeout: 10_000,
    greetingTimeout: 10_000,
    socketTimeout: 20_000,
  });

  cached = { key, transporter };
  return transporter;
}

export type SendResult =
  | { ok: true }
  | { ok: false; reason: 'not-configured' | 'failed'; detail?: string };

/**
 * Send one message. Never throws.
 *
 * The failure detail is returned to the caller rather than logged here,
 * because the only caller that shows it to a human is the admin's "send a
 * test" button. Nothing on the public path surfaces it.
 */
export async function sendEmail(message: {
  to: string;
  subject: string;
  text: string;
  replyTo?: string;
}): Promise<SendResult> {
  const config = emailConfig();
  if (!config) return { ok: false, reason: 'not-configured' };

  try {
    await transporterFor(config).sendMail({
      from: config.from,
      to: message.to,
      subject: message.subject,
      text: message.text,
      // So a reply from the mailbox goes to the person who wrote in, not to
      // the no-reply sender the relay authenticates as.
      ...(message.replyTo ? { replyTo: message.replyTo } : {}),
    });
    return { ok: true };
  } catch (error) {
    return {
      ok: false,
      reason: 'failed',
      detail: error instanceof Error ? error.message : String(error),
    };
  }
}

/**
 * Whether a relay is configured at all, for the admin screen to report.
 * Deliberately does not expose the credential, only that one exists.
 */
export function emailConfigured(): boolean {
  return emailConfig() !== null;
}
