---
name: afldb-bug-triage
description: Triage and fix an AFLDB defect when the failing layer is unknown or the issue spans multiple layers. Use for vague bug reports, regressions, incorrect behaviour, "this is broken", or failures that may involve Next.js, PostgreSQL, natural-language search, browser state, admin actions, or deployment. Do not use when a narrower AFLDB specialist skill clearly matches.
---

# AFLDB Bug Triage

Act as the default diagnostic skill for AFLDB when the fault domain is not yet known.

## Safety boundaries

- Work only in the current local working copy.
- Inspect before editing.
- Do not run Git commands or change branches, commits, tags, remotes, the index, or the working-tree state unless the user explicitly asks.
- Do not touch production infrastructure or production credentials.
- Do not mutate production data.
- Do not modify `tools/migration/**` or any `*.py` file unless the user explicitly asks.
- Prefer the smallest defensible patch over a rewrite.

## Establish the failure

1. Read `README.md`, `package.json`, and the most relevant document under `docs/`.
2. Find the user-visible symptom and the code path that owns it.
3. Reproduce the problem using the cheapest authoritative method:
   - pure function/unit test first;
   - direct query/compiler test for database-backed logic;
   - browser reproduction for rendering, navigation, hydration, form, or interaction faults;
   - runtime/service evidence for deployment faults.
4. Record expected versus actual behaviour in concrete terms.
5. If the report cannot be reproduced, inspect existing tests, logs, call sites, and recent local code before changing anything.

## Localise the fault

Trace the shortest path from input to output:

`UI/input -> normalisation/parser -> server action/query -> database -> returned model -> render/client commit`

Classify the defect as one primary domain:

- Next.js / React Server Components
- PostgreSQL / query semantics
- data integrity / historical-statistics rules
- deterministic NL search
- UI / Playwright
- admin mutation / revalidation
- auth / security boundary
- performance / hydration / concurrency
- deployment / runtime
- test or release regression

Use the matching specialist skill once the owner is clear.

## Diagnose before patching

- Inspect the implementation and its nearest tests.
- Search for sibling code paths that already solve the same problem correctly.
- Identify the violated invariant.
- Test competing hypotheses; do not patch the first plausible line.
- Distinguish bad source data, bad SQL, bad parsing, bad transformation, and bad presentation.
- Do not "fix" a symptom by hiding an error, coercing `NULL` to zero, suppressing exceptions, or weakening a test.

## Implement

- Change the narrowest shared layer that correctly owns the defect.
- Preserve public behaviour outside the reported case.
- Reuse existing types, query helpers, parser primitives, validation, and components.
- Avoid new abstractions unless the bug demonstrates a repeated structural problem.
- Add a regression test that fails before the fix and passes after it whenever practical.

## Validate

Run the smallest relevant checks first, then broaden only as needed:

1. targeted test(s);
2. `npm run typecheck` for TypeScript changes;
3. relevant Vitest/integration tests;
4. relevant Playwright journey for UI defects;
5. broader suite only when the change has a wide blast radius.

Database-backed integration tests must use `AFLDB_TEST_DATABASE_URL`; never redirect them to a non-`_test` database.

## Report

Return:

- root cause;
- files changed;
- why this layer owns the fix;
- tests/reproduction run and results;
- anything not verified;
- any follow-up risk.

Do not claim "fixed" when only static inspection was performed.
