/**
 * React's hydration-mismatch errors, minified (#418-425) or not.
 *
 * Shared between the production client-side health reporter
 * (src/components/HealthReporter.tsx) and the UI stress-test harness
 * (tools/nl/ui-corpus.ts), so the two classifications cannot drift apart
 * -- the 2026-08-18 hydration investigation's per-worker/per-run
 * comparisons all depend on this one definition staying identical
 * everywhere it's used.
 */
export function isHydrationErrorMessage(message: string): boolean {
  const lower = message.toLowerCase();
  return lower.includes('hydration')
    || lower.includes('did not match')
    || /minified react error #(418|419|420|421|422|423|424|425)\b/.test(lower);
}
