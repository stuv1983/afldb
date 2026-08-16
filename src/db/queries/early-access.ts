import 'server-only';

import { authSql } from '@/db/authClient';
import type { EarlyAccessQuestion } from '@/lib/site-settings';

/**
 * Reads and writes for the public early-access request form.
 *
 * Everything here runs on the auth pool: `beta_join_requests` is an
 * operational table (migration 024) that the read-only public role has no
 * grants on at all.
 */

export type EarlyAccessRequestRow = {
  id: number;
  email: string;
  name: string | null;
  message: string | null;
  answers: Record<string, string> | null;
  status: 'pending' | 'approved' | 'denied';
  requestedAt: Date;
  ip: string | null;
};

/**
 * Insert a request, or do nothing if one is already pending for that email.
 *
 * The `ON CONFLICT ... DO NOTHING` matches the partial unique index migration
 * 024 defines, so resubmitting while pending is a no-op rather than an error
 * or a duplicate row. The caller cannot distinguish the two cases and should
 * not: telling a visitor "you already asked" leaks that the address is known.
 */
export async function insertEarlyAccessRequest(input: {
  email: string;
  name: string | null;
  answers: Record<string, string>;
  ip: string | null;
}): Promise<void> {
  // An empty object is stored as NULL rather than `{}`: "this form had no
  // questions" and "these questions were all skipped" are the same fact, and
  // one representation of it keeps the review UI's check simple.
  const answers = Object.keys(input.answers).length > 0
    ? JSON.stringify(input.answers)
    : null;

  await authSql`
    INSERT INTO beta_join_requests (email, name, answers, ip)
    VALUES (${input.email}, ${input.name}, ${answers}::jsonb, ${input.ip})
    ON CONFLICT (email) WHERE status = 'pending' DO NOTHING
  `;
}

/**
 * postgres.js hands jsonb back as raw TEXT on this project's client, so a
 * stored object arrives as its serialisation rather than as an object. Both
 * shapes are accepted for the same reason `fromStore` in site-settings.ts
 * does: a client later configured to parse jsonb itself must not silently
 * start reading every answer set as null.
 *
 * Values are coerced to strings because that is all the form can submit; a
 * hand-edited row holding a number or an object is rendered as text rather
 * than crashing the review page.
 */
export function parseAnswers(value: unknown): Record<string, string> | null {
  let decoded = value;
  if (typeof decoded === 'string') {
    try {
      decoded = JSON.parse(decoded);
    } catch {
      return null;
    }
  }
  if (!decoded || typeof decoded !== 'object' || Array.isArray(decoded)) return null;

  const answers: Record<string, string> = {};
  for (const [key, raw] of Object.entries(decoded as Record<string, unknown>)) {
    if (raw === null || raw === undefined || raw === '') continue;
    answers[key] = typeof raw === 'string' ? raw : JSON.stringify(raw);
  }
  return Object.keys(answers).length > 0 ? answers : null;
}

/**
 * Pair stored answers with the questions as they are configured NOW.
 *
 * A question that has since been renamed shows its current label against the
 * old answer, which is the point of keying on a stable id. An answer whose
 * question has been DELETED is still returned — under its bare id — because
 * dropping it would silently hide something a person wrote.
 */
export function labelAnswers(
  answers: Record<string, string> | null,
  questions: readonly EarlyAccessQuestion[],
): { label: string; value: string; orphaned: boolean }[] {
  if (!answers) return [];
  const byId = new Map(questions.map((question) => [question.id, question.label]));

  const ordered: { label: string; value: string; orphaned: boolean }[] = [];
  for (const question of questions) {
    const value = answers[question.id];
    if (value) ordered.push({ label: question.label, value, orphaned: false });
  }
  for (const [id, value] of Object.entries(answers)) {
    if (!byId.has(id)) ordered.push({ label: id, value, orphaned: true });
  }
  return ordered;
}
