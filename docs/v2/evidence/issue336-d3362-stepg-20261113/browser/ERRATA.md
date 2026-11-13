# Errata: `stepg.cjs` beta-gate predicate (ISSUE-363 TST-8, 2026-11-14)

`stepg.cjs` is preserved unchanged. This file adds the same note as the two acceptance-runner errata, for the third
file in the repository that uses the host-matching pattern.

Line 31 tests an authenticated page with `!page.url().includes('/beta')`. On production the host is
`https://beta.afldb.com`, so `page.url()` always contains `//beta` and the check can never pass. That is the six-failure
URL-check defect already recorded for ISSUE-336 Step G (automated FAIL 77/83 with a documented assessment). This file
changes none of that record: the automated verdict stays FAIL and the documented assessment stays an assessment.

Corrected form for future runners: compare the **pathname**,

```js
new URL(page.url()).pathname !== '/beta'
```

and, for an anonymous redirect check, use `isBetaGateRedirect(location, base)` from
`../../issue336-337-340-345-release-execution-20261111/scripts/ERRATA.md` (proof cases in
`remediation-20261114/tests/tst8-predicate-proof.txt`).
