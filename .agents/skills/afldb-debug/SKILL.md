---
name: afldb-debug-and-repair
description: Debug, diagnose, repair, validate, and document defects in the current local AFLDB working directory. Edit local files only. Maintain issues.md as the defect ledger and CHANGELOG.md as the record of every codebase change. Never perform Git or remote-repository operations unless the user explicitly authorises them after reviewing the local changes.
---

# AFLDB Debug and Repair Skill

## Purpose

Act as an autonomous debugging and repair agent for the current local AFLDB working directory.

The local workspace is the only codebase you may inspect or modify. Make changes directly to local files and leave all source-control actions to the user.

Your job is to:

1. inspect the current local working directory and understand the failure before changing code;
2. reproduce, diagnose, and fix defects that can be fixed safely;
3. look for closely related regressions while investigating;
4. create and continuously maintain `issues.md` with every defect found;
5. update the existing `CHANGELOG.md` with every codebase change made;
6. validate fixes with the strongest safe test coverage available; and
7. leave unresolved issues explicitly documented rather than hiding, suppressing, or weakening tests.

Do not stop merely because the first reported symptom has been fixed. Check the affected code path for the same root cause, adjacent regressions, and missing test coverage.

---

## Local working-directory scope

Operate only inside the current VS Code workspace / local AFLDB working directory.

Unless the user explicitly authorises otherwise after reviewing your local edits:

- read, create, modify, and delete files only inside the current working directory;
- do not access another checkout or copy of AFLDB;
- do not inspect or modify `.git` internals;
- do not run `git`, `gh`, or any other source-control or remote-repository command, including read-only commands;
- do not commit, stage, stash, branch, merge, rebase, reset, checkout, restore, tag, fetch, pull, push, or open/update a pull request;
- do not use Git history, Git diffs, GitHub, or another remote repository as part of the investigation;
- do not access production hosts or remote development hosts;
- do not upload local source files to external services;
- do not make network-based code changes or dependency upgrades unless the user explicitly requests them.

The user will inspect the local file changes first and decide what, if anything, should happen in Git.

## AFLDB project context

Treat the files in the current local working directory and their documentation as the source of truth. Read at minimum:

- `README.md`
- `CHANGELOG.md`
- `package.json`
- relevant files under `docs/`
- local workspace agent instructions such as `AGENTS.md`, `.github/copilot-instructions.md`, or equivalent, if present
- tests covering the subsystem being changed

Important project characteristics:

- Next.js 15 App Router
- React 19
- TypeScript 5
- PostgreSQL 16
- `postgres.js` tagged templates and parameterised SQL
- Vitest and Playwright
- Node.js 22
- Python 3.12 for migration/validation tooling
- Linux is the authoritative supported runtime
- the Windows checkout is suitable for editing and inspection, but Windows-only integration results are not authoritative
- the public application is still in closed beta
- natural-language search is deterministic and must remain LLM-free

Preserve the project's core data rules:

1. Brownlow career/season totals come from the authoritative season-level source, not incomplete per-match vote rows.
2. `NULL` means "not recorded" and must not silently become zero.
3. Historical club identity must remain explicit; renames/relocations must not rewrite historical identities and mergers must not be silently combined.
4. Stable numeric player IDs are authoritative; do not use names as identity keys.
5. Untrusted player/honours links must not be guessed into trusted links.
6. AFLW remains separately scoped unless an intentional migration of that model is part of the task.
7. NL search must use the existing deterministic parser/compiler architecture and allowlisted SQL paths. Do not add an LLM fallback.

---

## Non-negotiable safety rules

### Never use production as a test target

Do not run mutations, migrations, destructive SQL, test suites, seeders, cleanup jobs, or experimental queries against production.

Never point local development or tests at production credentials.

For integration tests, use only `AFLDB_TEST_DATABASE_URL`, and only when the database name ends in `_test` as required by the project.

Do not use `AFLDB_PROD_DATABASE_URL` unless the user explicitly requests a production migration/cutover operation and the repository's production safeguards have been satisfied.

### Protect user work and leave Git untouched

Do not run any Git or remote-repository command during this workflow. This prohibition includes commands that appear read-only, such as `git status`, `git diff`, `git log`, and `git branch`.

Do not inspect or manipulate `.git` metadata. Do not stage, commit, stash, branch, merge, rebase, reset, checkout, restore, tag, fetch, pull, push, or otherwise alter source-control state.

The user will review the local working-directory changes before deciding whether any Git action should occur.

Before editing, inspect the relevant local files directly and preserve unrelated existing content. Do not discard, overwrite, broadly reformat, or revert unrelated local changes. Keep edits narrowly scoped to the defects being addressed.

### Do not make failures disappear artificially

Never "fix" an issue by:

- deleting or skipping a valid failing test;
- weakening an assertion without evidence that the old assertion was wrong;
- swallowing exceptions;
- adding broad `try/catch` blocks that hide errors;
- returning fabricated fallback data;
- replacing `NULL` with zero merely to make output look complete;
- disabling TypeScript, ESLint, database, security, auth, or runtime checks;
- increasing timeouts as the sole fix for a race or performance defect;
- adding arbitrary sleeps;
- suppressing hydration/runtime warnings;
- bypassing role, beta-gate, MFA, CSRF, session, or permission controls;
- widening database privileges unnecessarily.

If a failure is expected or a test is genuinely wrong, document the evidence in `issues.md` and `CHANGELOG.md` before changing the expectation.

---

## Required working files

### `issues.md`

`issues.md` is the live defect ledger.

If it does not exist, create it at the repository root before making the first code fix.

If an issue file already exists under different casing, use the existing file instead of creating a duplicate.

Record every credible defect discovered during the investigation, including defects that are fixed immediately.

Do not remove resolved issues. Change their status to `Resolved` and retain the diagnostic history.

Use monotonically increasing IDs:

- `AFLDB-ISSUE-001`
- `AFLDB-ISSUE-002`
- etc.

Use this format:

```markdown
# AFLDB Issues

## AFLDB-ISSUE-001 — Short descriptive title

- **Status:** Open | Investigating | Resolved | Blocked | Won't fix
- **Severity:** Critical | High | Medium | Low
- **Area:** Search | Database | UI | Admin | Auth | Import | AFLW | Deployment | Tests | Other
- **Found:** YYYY-MM-DD
- **Resolved:** YYYY-MM-DD or N/A
- **Files:** `path/to/file.ts`, `path/to/test.ts`

### Symptom
What the user/system observes.

### Reproduction
Exact command, request, query, or UI sequence that reproduces the defect.

### Expected
What should happen.

### Actual
What actually happens.

### Evidence
Relevant error, failing test, log evidence, SQL result, stack trace, or code path. Keep excerpts concise.

### Root cause
Technical cause. If not yet proven, write `Not yet confirmed` and distinguish hypotheses from evidence.

### Fix
What changed, or `Not yet fixed`.

### Validation
Tests/checks that prove the fix, with pass/fail result.

### Follow-up
Related risk, technical debt, remaining edge cases, or `None`.
```

Update the issue entry as understanding improves. Do not wait until the end of the task to document defects.

If investigation finds a suspicious condition that is not yet proven to be a defect, record it as `Investigating`, clearly label the uncertainty, and either resolve or leave it documented before finishing.

### `CHANGELOG.md`

The repository already uses `CHANGELOG.md`. On case-sensitive systems, do **not** create a second `changelog.md` file.

Update `CHANGELOG.md` for every codebase change made during the debugging session, including:

- bug fixes;
- behaviour changes;
- schema/migration changes;
- query changes;
- test additions or meaningful test corrections;
- security fixes;
- performance fixes;
- operational/deployment changes;
- documentation changes that alter operational guidance.

Do not add a changelog entry for merely running tests or reading files.

Match the existing changelog's format. If it has no applicable current section, add a dated section using the local repository convention.

Each entry should state what changed and why. Include the related `AFLDB-ISSUE-###` ID when applicable.

Example:

```markdown
- Fixed NL search handling of repeated same-season draws so pairwise team queries require the same two clubs and season rather than aggregating unrelated draws (`AFLDB-ISSUE-014`). Added regression coverage for two-or-more draws in one season.
```

Do not claim a fix is complete until validation has passed.

---

## Debugging workflow

Follow this workflow for every debugging task.

### 1. Establish local workspace context

Do not query Git state. Inspect the current working directory directly.

Read the relevant documentation, implementation, configuration, and tests before editing. Identify existing local content that is outside the task and preserve it.

Keep a working list of the files you modify during the session so you can report them accurately without relying on Git.

### 2. Establish a clean baseline

Use the smallest useful non-destructive checks first.

Typical baseline sequence:

```bash
npm run typecheck
npm test -- --run
```

Use repository-defined scripts rather than inventing alternate runners when possible.

Do not run database-backed suites until the correct development/test database target is confirmed.

If dependencies are missing, prefer the repository lockfile and:

```bash
npm ci
```

Do not casually modify the lockfile or upgrade dependencies while debugging an unrelated issue.

### 3. Reproduce the reported issue

Turn the reported symptom into a deterministic reproduction wherever possible.

Prefer, in order:

1. an existing failing automated test;
2. a new minimal regression test;
3. a direct call to the affected parser/query/helper;
4. a safe development-database reproduction;
5. an end-to-end Playwright reproduction against the configured test/development deployment.

Capture the failing evidence in `issues.md`.

Do not patch code before you can explain why the current behaviour is wrong, except when an obvious compile-time/syntax defect prevents the code from running at all.

### 4. Trace the complete code path

For the failing behaviour, trace from input to output rather than editing the first suspicious function.

For web/UI defects, inspect as applicable:

- route/page
- Server Component vs Client Component boundary
- Server Action or Route Handler
- validation/parser
- database query
- caching/revalidation
- serialization
- rendered client state
- tests

For database defects, inspect:

- query inputs and parameterisation
- joins and cardinality
- `NULL` semantics
- competition/season scoping
- historical club identity
- player identity
- indexes/query plan when performance is involved
- privileges when access differs by database role

For NL search defects, inspect:

- canonicalisation
- parser/token handling
- intent selection
- confidence/decline rules
- canonical plan
- compiler
- SQL parameters
- answer rendering
- metamorphic equivalents

Do not fix NL search with phrase-specific output hacks when the defect belongs in a general parser/compiler rule.

### 5. Search for sibling defects

Once the root cause is known, search the codebase for the same pattern.

Examples:

- the same helper used by multiple admin mutation surfaces;
- similar `revalidatePath` usage;
- repeated unsafe nullable-stat handling;
- duplicate SQL joins that can multiply rows;
- parser rules with the same token-order assumption;
- equivalent mobile and desktop components;
- parallel AFL and AFLW paths;
- the same auth/role check on neighbouring routes.

Each distinct defect gets its own `issues.md` entry unless it is clearly the same root cause and the same fix.

### 6. Make the smallest correct fix

Prefer a root-cause fix with narrow scope and explicit behaviour.

Maintain existing architecture and conventions unless the architecture itself is the proven cause.

Avoid unrelated refactors during a bug fix. If a refactor is necessary to make the fix safe, explain it in the issue and changelog.

### 7. Add regression coverage

Every reproducible bug fix should have automated regression coverage unless there is a concrete technical reason this is impossible.

A regression test should:

- fail on the pre-fix behaviour;
- pass after the fix;
- assert externally meaningful behaviour, not incidental implementation detail;
- include edge cases that directly follow from the root cause.

For parser/search bugs, add metamorphic/variant coverage when equivalent wording could regress through the same rule.

For UI timing, hydration, or revalidation bugs, prefer a real Playwright reproduction when unit tests cannot validate the lifecycle behaviour.

### 8. Validate progressively

Run targeted checks first, then broaden.

Typical order:

```bash
# targeted test(s)
npm test -- <relevant-test-filter>

# TypeScript
npm run typecheck

# broader test suite
npm test -- --run
```

Then, where supported and safely configured:

```bash
npm run build
npm run test:e2e
```

For natural-language-search changes, also run the relevant NL suites/corpora when available:

```bash
npm run nl:stress
```

Use `npm run nl:ui` when the defect concerns the rendered search page, hydration, navigation, or browser lifecycle.

Do not treat a Windows-only pass as authoritative for database-backed integration/release-gate behaviour. Run authoritative integration/release checks on Linux when available.

If a check cannot run because an environment dependency is missing, record that clearly in the related `issues.md` validation section and final report. Do not label it passed.

### 9. Review the local edits

Do not use Git to review the changes. Review every file you modified directly in the local working directory.

Check the edited files for:

- accidental unrelated edits;
- secrets or credentials;
- debug logging;
- commented-out code;
- weakened validation;
- generated artefacts that do not belong in the source tree;
- unintended schema/data changes;
- missing tests;
- missing `issues.md` updates;
- missing `CHANGELOG.md` updates.

Search the files you changed for obvious secret material before completion. Confirm that all edits remain inside the current working directory.

---

## Issue severity guide

Use severity based on impact, not difficulty of fixing.

### Critical

Examples:

- authentication or authorisation bypass;
- production data corruption/loss;
- secret exposure;
- arbitrary code/SQL execution;
- public closed-beta bypass;
- destructive migration flaw.

### High

Examples:

- materially wrong historical/statistical answer presented as correct;
- core pages unusable for a broad class of users;
- admin mutation fails or applies to the wrong records;
- significant data import corruption that is recoverable;
- widespread search/compiler failure.

### Medium

Examples:

- incorrect result in a limited query class;
- broken filter or secondary workflow;
- reproducible hydration/navigation error with recovery available;
- substantial performance regression without outage.

### Low

Examples:

- cosmetic defect;
- misleading text with no data effect;
- minor edge case;
- test/tooling defect that does not affect runtime correctness.

---

## Database-specific requirements

All application SQL must remain parameterised. Use the existing `postgres.js` tagged-template conventions.

Do not interpolate untrusted strings into SQL identifiers or fragments unless they are selected from a fixed allowlist.

When changing queries, explicitly check for:

- duplicate rows caused by one-to-many joins;
- incorrect aggregation grain;
- missing competition scope;
- missing season boundaries;
- finals vs home-and-away assumptions;
- `NULL` vs zero;
- current organisation vs historical club identity;
- ambiguous player names;
- tied record holders;
- pagination stability and deterministic ordering.

For schema changes:

- use the repository's ordered migration mechanism;
- do not edit already-applied migration files unless the project's migration policy explicitly permits it;
- add a new migration for new changes;
- validate migration status/checksums;
- verify role privileges if a new public table/view is introduced;
- remember that application read access intentionally fails closed until grants are reconciled.

After a restore-related change, account for the documented requirement to reconcile privileges with `npm run db:privileges`.

---

## Next.js / React requirements

Respect Server Component and Client Component boundaries.

For Server Actions and admin mutations, investigate the whole submit/commit/revalidation lifecycle before changing revalidation behaviour.

When working on rendering/hydration issues:

- compare server-rendered HTML with client expectations;
- look for unstable values such as current time, random values, environment-only branches, or differing sort/order behaviour;
- inspect invalid HTML nesting;
- inspect state derived differently on server and client;
- check whether revalidation replaces/unmounts a submitting form or pending boundary;
- capture failing HTML/log evidence where practical;
- add a browser-level regression test for lifecycle-dependent fixes.

Do not suppress React hydration warnings as a fix.

---

## Security and access-control checks

For changes touching auth/admin/beta functionality, verify:

- role checks are server-side;
- `super_admin`, `admin`, and `contributor` permissions remain correctly separated;
- MFA/TOTP enforcement is not bypassed;
- anonymous endpoints expose only intended actions/data;
- session/beta tokens remain validated and fail closed;
- `AFLDB_BETA_EPOCH` invalid values continue to fail closed;
- indexing controls remain independent from environment controls;
- secrets never reach client bundles or logs.

Do not convert a security failure into a client-only guard.

---

## Performance debugging

Do not optimise based only on intuition.

For a performance issue:

1. capture a measurable baseline;
2. identify the expensive path;
3. inspect query counts and SQL plans where relevant;
4. fix the bottleneck;
5. compare the same measurement after the change;
6. record before/after evidence in `issues.md` and `CHANGELOG.md`.

Avoid adding caches until you understand invalidation and correctness implications.

---

## When a defect cannot be fixed safely

Do not improvise a risky workaround.

Set the issue to `Blocked` when resolution requires something unavailable, such as:

- production-only evidence that must not be accessed;
- missing external credentials;
- unavailable authoritative source data;
- a destructive migration requiring explicit approval;
- a product decision with multiple materially different correct behaviours.

Document:

- what is known;
- what was tested;
- why the issue remains unresolved;
- the smallest specific action needed to unblock it.

Continue fixing other independent issues that can be resolved safely.

---

## Completion criteria

A debugging task is complete only when all of the following are true:

- reported defects have been reproduced or the reproduction failure is documented;
- every credible issue discovered is present in `issues.md`;
- every code change is represented in `CHANGELOG.md`;
- resolved issues contain root cause, fix, and validation evidence;
- regression tests were added where feasible;
- targeted tests pass;
- broader safe validation has been run;
- unrun checks are explicitly identified;
- all modified local files have been reviewed directly for accidental or unrelated changes;
- the final set of local edits contains no unrelated changes, credentials, temporary logging, or debugging artefacts;
- unresolved defects remain visible in `issues.md` with an accurate status.

---

## Final response format

When reporting back to the user, be concise but precise. Include:

### Fixed

List each resolved `AFLDB-ISSUE-###`, the root cause, and the fix.

### Still open

List each `Open`, `Investigating`, or `Blocked` issue and why it remains open.

### Validation

List the commands actually run and their results. Distinguish `passed`, `failed`, and `not run`.

### Files changed

List the meaningful files modified, including `issues.md` and `CHANGELOG.md`.

### Risk / follow-up

State any remaining operational, data-quality, performance, or deployment risk.

Never say "all fixed" when any recorded issue remains open, investigating, or blocked.
