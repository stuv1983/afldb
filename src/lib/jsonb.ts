/**
 * Decoding jsonb columns, whichever way the driver hands them back.
 *
 * The postgres.js client this project uses returns a jsonb column as its raw
 * TEXT — an object arrives as its serialisation rather than as an object. A
 * client configured (or upgraded) to parse jsonb itself returns the decoded
 * value instead. Both have to land in the same place, or a column reads as
 * empty on one of them and nothing looks broken except that the data is gone.
 *
 * This has now been the cause of the same defect three times over
 * (`site_settings.value`, `beta_join_requests.answers`,
 * `award_nominations.stat_line`), which is why the rule lives in one
 * server-only-free module that can be unit tested rather than being
 * rediscovered per column. `fromStore` in site-settings.ts and `parseAnswers`
 * in db/queries/early-access.ts are the two older copies; they differ in what
 * they fall back to on unparseable input, so they are left as they are rather
 * than bent to fit one signature.
 */

/**
 * A jsonb column as an object, or null when it is not one.
 *
 * Arrays are rejected deliberately: every caller here keys by name, and an
 * array would silently index as numeric keys.
 */
export function decodeJsonbObject(value: unknown): Record<string, unknown> | null {
  let decoded = value;
  if (typeof decoded === 'string') {
    try {
      decoded = JSON.parse(decoded);
    } catch {
      return null;
    }
  }
  if (!decoded || typeof decoded !== 'object' || Array.isArray(decoded)) return null;
  return decoded as Record<string, unknown>;
}

/**
 * Decode `award_nominations.stat_line`.
 *
 * Without this the Rising Star season page's `statLine?.[key]` indexed a
 * string, was undefined for every key, and dropped the whole statistics block
 * rather than failing visibly.
 *
 * Values are coerced to numbers because that is what the page formats;
 * anything that is not a finite number is dropped rather than rendered as
 * NaN. A zero is kept — it is a real statistic, not an absence.
 */
export function parseStatLine(value: unknown): Record<string, number> | null {
  const decoded = decodeJsonbObject(value);
  if (!decoded) return null;

  const stats: Record<string, number> = {};
  for (const [key, raw] of Object.entries(decoded)) {
    if (raw === null || raw === undefined || raw === '') continue;
    const numeric = typeof raw === 'number' ? raw : Number(raw);
    if (Number.isFinite(numeric)) stats[key] = numeric;
  }
  return Object.keys(stats).length > 0 ? stats : null;
}
