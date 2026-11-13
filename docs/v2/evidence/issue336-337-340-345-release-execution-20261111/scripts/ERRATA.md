# Errata: `prod-accept-headed.cjs` beta-gate predicate (ISSUE-363 TST-8, 2026-11-14)

`prod-accept-headed.cjs` is preserved unchanged. This file records a defect in one of its checks and gives the
corrected predicate for any future runner. It does not alter the recorded run.

## The defective check

Line 50:

```js
check('anonymous /draft is redirected to /beta (gate on)', a.status() >= 300 && a.status() < 400 && /\/beta/.test(a.headers().location || ''), ...);
```

`/\/beta/` is tested against the whole `Location` header, and the gate answers with an **absolute** URL
(`redirectTo` in `src/lib/redirect.ts`). The production host is `https://beta.afldb.com`, so the pattern matches the
**host** (`https://beta.afldb.com/...` contains `//beta`) as well as the path. Any 3xx from that host, for example a
canonical-host or gate-off redirect to `https://beta.afldb.com/draft`, would also have passed "gate on". The check could
not distinguish the gate from any other redirect.

This is the same class as the ISSUE-336 Step G runner defect (`page.url().includes('/beta')`, see
`../../issue336-d3362-stepg-20261113/browser/ERRATA.md`).

## What the recorded run shows

The recorded run is not misreported. `browser-20261111/validate-1.json` (and the `-attempt1` and `browser-20261112`
siblings) records the actual redirect target in the check's `detail`: `307 https://beta.afldb.com/beta?from=%2Fdraft`.
The path is `/beta` and the origin is the one under test, so the gate was on and the check's verdict was right. The
defect is that the predicate was capable of passing without that being true. Nothing recorded here needs retraction.

## Corrected predicate (pathname-based, origin-checked)

```js
// True only when `location` resolves to the beta gate page (path exactly /beta) on the same origin as `base`.
function isBetaGateRedirect(location, base) {
  try {
    const target = new URL(location, base);
    return target.origin === new URL(base).origin && target.pathname === '/beta';
  } catch {
    return false;
  }
}
// usage: a.status() >= 300 && a.status() < 400 && isBetaGateRedirect(a.headers().location || '', BASE)
```

Proven against these cases (`remediation-20261114/tests/tst8-predicate-proof.txt`): the recorded production and DEV
details and a relative `/beta?from=...` accept; `https://beta.afldb.com/draft`, `https://beta.afldb.com/beta/verify`,
`https://evil.example/beta`, `https://beta.afldb.com.evil.example/beta`, an empty header and garbage reject. The old
pattern wrongly accepts the first four of those rejected cases. The origin check assumes `BASE` is the same origin the
site is configured to redirect to (`AFLDB_BASE_URL`, which `src/lib/redirect.ts` uses); both recorded runs satisfy that.

For an authenticated page check, test the **pathname** of the final URL (`new URL(page.url()).pathname !== '/beta'`),
never `page.url().includes('/beta')`.

## Reuse

No current procedure or tool takes this runner as a template (searched `tools/`, `deploy/`, `tests/`, `docs/` for
`accept-headed`: only the two preserved records below reference it). `deploy/release.mjs:687` already anchors its own
`/beta` check on the path. A future runner should copy the function above rather than this file's line 50.
