export const DEFAULT_NL_UI_OPERATION_TIMEOUT_MS = 15_000;

export function positiveTimeout(
  name: string,
  raw: string | undefined,
  fallback: number,
): number {
  const value = raw === undefined ? fallback : Number(raw);
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new Error(`${name} must be a positive integer number of milliseconds; received ${raw ?? fallback}.`);
  }
  return value;
}

export const NL_UI_OPERATION_TIMEOUT_MS = positiveTimeout(
  'NL_UI_TIMEOUT_MS',
  process.env.NL_UI_TIMEOUT_MS,
  DEFAULT_NL_UI_OPERATION_TIMEOUT_MS,
);

/**
 * Bounds protocol/body promises that Playwright's action timeout does not own.
 * The label is deliberately part of the error so a stress observation says
 * what stalled rather than reporting an anonymous timer expiry.
 */
export async function withDeadline<T>(
  label: string,
  promise: Promise<T>,
  timeoutMs = NL_UI_OPERATION_TIMEOUT_MS,
): Promise<T> {
  const boundedTimeout = positiveTimeout('deadline timeout', String(timeoutMs), timeoutMs);
  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      reject(new Error(`${label} did not complete within ${boundedTimeout} ms.`));
    }, boundedTimeout);
  });

  try {
    return await Promise.race([promise, deadline]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}
