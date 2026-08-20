---
name: afldb-regression-gate
description: Review and validate an AFLDB bug fix before it is considered complete. Use after a code change, for regression checks, release readiness, blast-radius analysis, or when deciding which Vitest, integration, Playwright, NL stress, typecheck, build, or database-backed tests must run.
---

# AFLDB Regression and Release Gate

Prove the change fixes the reported contract without breaking adjacent behaviour.

## Guardrails

- Do not modify code merely to make the gate green unless a failing test reveals a genuine defect.
- Do not run Git commands unless explicitly requested.
- Do not point integration tests at production.
- Do not weaken assertions, remove tests, skip tests, or suppress errors without a demonstrated reason.
- A Windows-only pass is not authoritative for Linux/database-backed release gates.

## Build the test matrix from blast radius

Classify changed files and select tests accordingly.

### TypeScript / React

Run targeted tests and `npm run typecheck`.

### Database query

Run targeted unit/integration coverage with `AFLDB_TEST_DATABASE_URL`.

### NL search

Run targeted parser/compiler tests and the relevant corpus slice. Use broader `npm run nl:stress` when grammar/compiler reach is wide. Use `npm run nl:ui` for browser-only search faults.

### Browser/UI

Run the specific Playwright journey at the relevant viewport. Include console/page-error assertions when the defect involved browser errors or hydration.

### Admin mutation

Verify database mutation, action completion, pending clearance, and live UI update.

### Deployment-sensitive change

Validate Linux/deployment-specific behaviour in an appropriate environment; do not infer it from the Windows editing copy.

## Protect AFLDB invariants

Regression coverage must preserve, when relevant:

- all tied record holders;
- `NULL` distinct from zero;
- authoritative Brownlow season/career totals;
- historical club identity semantics;
- stable numeric player identity;
- untrusted honours links remain unguessed;
- AFLW remains correctly scoped to its read model;
- query inputs remain parameterised;
- role/MFA/beta gates remain enforced server-side.

## Interpret failures

For every new failure decide whether it is:

- caused by the patch;
- an existing unrelated failure;
- flaky/intermittent;
- environment/configuration;
- test expectation now proven wrong.

Provide evidence for the classification.

## Completion report

A fix can be called validated only when the original reproduction now passes and appropriate neighbouring regression checks pass.

Report:

- original failing case: PASS/FAIL;
- targeted regression: PASS/FAIL;
- typecheck: PASS/FAIL/not required;
- integration: PASS/FAIL/not run;
- browser: PASS/FAIL/not run;
- broader suite: PASS/FAIL/not run;
- remaining uncertainty.
