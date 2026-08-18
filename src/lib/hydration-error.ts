/**
 * React's hydration-mismatch errors, minified (#418-425) or not.
 *
 * Used by the UI stress-test harness (tools/nl/ui-corpus.ts) -- the
 * 2026-08-18 hydration investigation's per-worker/per-run comparisons
 * all depend on this one definition. The production client-side
 * reporter (src/lib/health-init-script.ts) necessarily carries its OWN
 * duplicate of this same regex rather than importing it: it has to be a
 * standalone inline `<script>` string with no bundler and no imports.
 * Keep the two in sync by hand if either changes.
 */
export function isHydrationErrorMessage(message: string): boolean {
  const lower = message.toLowerCase();
  return lower.includes('hydration')
    || lower.includes('did not match')
    || /minified react error #(418|419|420|421|422|423|424|425)\b/.test(lower);
}
