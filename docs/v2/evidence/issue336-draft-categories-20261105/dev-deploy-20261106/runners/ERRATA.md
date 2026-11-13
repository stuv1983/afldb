# Errata: `dev-accept-headed.cjs` beta-gate predicate (ISSUE-363 TST-8, 2026-11-14)

`dev-accept-headed.cjs` is preserved unchanged. This file records a defect in one of its checks and gives the
corrected predicate. It does not alter the recorded run.

## The defective check

Line 43:

```js
check('anonymous /draft is redirected to /beta (gate on)', a.status() >= 300 && a.status() < 400 && /\/beta/.test(a.headers().location || ''), ...);
```

`/\/beta/` is tested against the whole `Location` header, which the gate sets to an **absolute** URL. Against a host whose
name begins `beta.` (production, `https://beta.afldb.com`) the pattern matches the host as well as the path, so any 3xx
from that host would pass. This runner was written for DEV (`http://10.0.40.100:8090`), where the host does not contain
`/beta`, so on DEV the pattern happened to match only the path. The production variant,
`../../../issue336-337-340-345-release-execution-20261111/scripts/prod-accept-headed.cjs`, copied the line unchanged;
see its `ERRATA.md`, which carries the full explanation and the corrected function.

## What the recorded run shows

`browser-3/validate-1.json` records `307 http://10.0.40.100:8090/beta?from=%2Fdraft`: the path is `/beta` on the origin
under test. The recorded run is correct and is not misreported.

## Corrected predicate

```js
function isBetaGateRedirect(location, base) {
  try {
    const target = new URL(location, base);
    return target.origin === new URL(base).origin && target.pathname === '/beta';
  } catch {
    return false;
  }
}
```

Proof cases: `remediation-20261114/tests/tst8-predicate-proof.txt`.
