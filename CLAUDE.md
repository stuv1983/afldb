# CLAUDE.md — AFLDB Repository Instructions

## Purpose

Work accurately while keeping repository exploration, context growth, tool calls, testing, and subagent use as small as practical.

Default workflow:

1. Classify the task.
2. Use the repository map below.
3. Search the relevant subsystem directly.
4. Read only the files needed.
5. Make the smallest correct change.
6. Run the smallest useful verification.
7. Report findings, changed files, tests, and blockers.
8. Stop.

Do not turn a focused task into a repository-wide investigation.

---

# 1. Working Directory Boundary

Treat the current AFLDB repository root as the complete working boundary.

- Work only inside the current repository unless explicitly instructed otherwise.
- Do not traverse parent directories or scan sibling projects.
- Do not recursively walk drives, home directories, or the filesystem to learn the environment.
- If an expected path is missing, verify that path specifically before broadening the search.
- Prefer targeted searches for known filenames, symbols, routes, functions, tables, components, SQL, or error text.

Avoid broad discovery such as:

```text
find .
find /
Get-ChildItem -Recurse
dir /s
tree /f
```

unless broad enumeration is genuinely required.

Repository discovery is not a default step.

---

# 2. Documentation Order

Use documentation selectively:

1. `CLAUDE.md` — operating rules and repository routing.
2. `README.md` — current project overview/status when relevant.
3. Relevant subsystem code.
4. Relevant `docs/*.md` file only when deeper context is needed.

`README.old.md` is historical reference material.

Do not normally read or compare `README.old.md`. Use it only when the user asks for historical comparison or current documentation is missing required information.

Do not bulk-read `docs/`.

---


# 3. Issue Knowledge and Change Tracking

AFLDB uses three complementary project-memory files:

- `IssuesIndex.md` — lightweight index of **currently open issues only**.
- `issues.md` — authoritative detailed issue ledger and investigation history.
- `CHANGELOG.md` — concise record of meaningful project changes.

The purpose of this system is to prevent repeated investigation without forcing
every session to load the full issue ledger.

## Session-start issue awareness

For code, data, search, UI, admin, database, import, deployment, or tooling work:

1. Read `IssuesIndex.md` once near the start of the task.
2. Use it only to identify whether the requested work overlaps a known open issue.
3. Do **not** read all of `issues.md`.
4. If a relevant issue exists, locate and read only that exact issue entry in
   `issues.md`.
5. If no relevant open issue exists, continue with the normal repository routing
   rules.

For simple wording/document-only tasks that clearly cannot affect an existing
technical issue, reading `IssuesIndex.md` is unnecessary.

`IssuesIndex.md` is a lightweight cache of current open work. `issues.md` is the
authoritative ledger. If they disagree, trust `issues.md`, correct
`IssuesIndex.md`, and correct the Open Issues table at the top of `issues.md`.

## When the user gives an issue ID

If the user names `AFLDB-ISSUE-XXX`:

1. Find that exact heading in `issues.md`.
2. Read only that issue entry.
3. Start from its current evidence, root cause, validation, and follow-up.
4. Verify the relevant current code before assuming every historical detail is
   still exact.
5. Update the same issue rather than creating a duplicate.

Do not re-investigate facts already established in the issue unless current code
or new evidence contradicts them.

## When the user reports a new issue

When the user gives a new defect/problem without an issue ID:

1. Read `IssuesIndex.md`.
2. Search `issues.md` narrowly for the feature, error text, affected subsystem,
   likely issue title, or relevant file.
3. If it matches an existing issue, update that issue.
4. If it is genuinely new, allocate the next available `AFLDB-ISSUE-XXX`.
5. Add the full issue entry to `issues.md`.
6. Add the new open issue to:
   - the Open Issues table at the top of `issues.md`; and
   - `IssuesIndex.md`.
7. Do this tracking update as part of the same task; do not leave the index stale.

Before allocating a new number, use a targeted heading/ID search to determine the
highest existing issue number. Do not read the entire ledger merely to find the
next ID.

## When Claude discovers a new issue

Create a new tracked issue only for a meaningful:

- reproducible defect;
- data-integrity problem;
- security problem;
- architectural limitation;
- unresolved regression;
- product limitation requiring future work;
- repeatable tooling/test problem.

Do not create an issue for:

- routine implementation steps;
- temporary debugging output;
- speculative concerns without evidence;
- cosmetic cleanup unrelated to the task;
- a problem already represented by an existing issue.

If a newly discovered issue does not block the current request, record it
concisely, update both indexes, and return to the requested scope.

## Required issue entry content

A full `issues.md` entry should contain, where applicable:

- Status
- Severity
- Area
- Found
- Resolved
- Queries / reproduction inputs
- Files
- Symptom
- Reproduction
- Expected
- Actual
- Evidence
- First wrong layer
- Root cause
- Fix
- Validation
- Follow-up

Do not invent evidence, root cause, validation, or resolution.

Use `Not yet confirmed`, `Not yet fixed`, or equivalent when the investigation
has not established those facts.

## Updating an open issue

When investigation adds durable knowledge but does not resolve the issue, update
the existing issue with the useful new information.

Examples:

- confirmed reproduction;
- ruled-out cause;
- first wrong layer;
- narrowed root cause;
- diagnostic result;
- failed attempted fix;
- blocker;
- exact next action.

Do not create a second issue simply because a new session continued the same
investigation.

After changing an open issue, update `IssuesIndex.md` if its summary, severity,
area, current state, key files, or next action changed materially.

Also keep the Open Issues table at the top of `issues.md` in sync.

## Resolving an issue

An issue is resolved only when the implementation and appropriate verification
support that conclusion.

When resolving an issue:

1. Change `Status` to `Resolved`.
2. Set the resolved date.
3. Update root cause if investigation refined it.
4. Record the actual fix.
5. Record the actual validation performed.
6. Preserve useful historical evidence.
7. Record genuine remaining follow-up separately.
8. Remove the issue from `IssuesIndex.md`.
9. Remove it from the Open Issues table at the top of `issues.md`.
10. Add or update the relevant `CHANGELOG.md` entry when the resolution represents
    a meaningful project change.

If only part of an issue is fixed, keep it open and record what remains.

## IssuesIndex.md maintenance

`IssuesIndex.md` must contain only currently open issues.

Keep it intentionally small. Each open issue should include:

- ID and title;
- severity;
- area;
- concise current state;
- key files or subsystem;
- exact next action when known.

Do not copy the full investigation history into `IssuesIndex.md`.

Whenever an issue is:

- created;
- reopened;
- resolved;
- materially reclassified;
- given a materially different next action;

update `IssuesIndex.md` in the same task.

Whenever `IssuesIndex.md` changes, keep the Open Issues table at the top of
`issues.md` synchronized.

## CHANGELOG.md maintenance

Use the existing `Unreleased` section unless the project release policy changes.

Update `CHANGELOG.md` when work materially changes:

- application behaviour;
- user-visible functionality;
- search/parser behaviour;
- data behaviour;
- database/schema behaviour;
- admin functionality;
- security behaviour;
- deployment/operations behaviour;
- important validation/audit state.

Reference the relevant `AFLDB-ISSUE-XXX` when one exists.

Do not add changelog entries for:

- investigation-only updates;
- temporary diagnostic changes that are not retained;
- command output;
- failed approaches;
- end-of-day status notes where project behaviour did not change.

Those belong in `issues.md` when they are useful ongoing knowledge.

## Changelog versus issue ledger

Use `issues.md` for:

- what is wrong;
- investigation history;
- evidence;
- root cause;
- current status;
- validation;
- remaining work.

Use `CHANGELOG.md` for:

- what materially changed in AFLDB.

A resolved issue will normally update both files.

An unresolved investigation will normally update `issues.md` and, when its
current summary/next step changed, `IssuesIndex.md`, but not `CHANGELOG.md`.

## Tracking check before completion

Before declaring a behaviour/code/data-changing task complete:

1. Check whether it corresponds to an existing issue.
2. Update that issue if its state or evidence changed.
3. Create a new issue only for a genuine new tracked problem.
4. Synchronize `IssuesIndex.md` and the Open Issues table in `issues.md`.
5. Update `CHANGELOG.md` if a meaningful retained project change occurred.
6. Report:
   - source files changed;
   - issue IDs created/updated/resolved;
   - whether `IssuesIndex.md` changed;
   - whether `CHANGELOG.md` changed;
   - validation performed.

Do not perform a broad read of the tracking files merely to satisfy this check.

---

# 4. Known Repository Map

Treat this map as the default architecture. Do not rediscover it every session.

| Path | Purpose |
|---|---|
| `src/app/` | Next.js pages, layouts, server components, route handlers |
| `src/components/` | Shared React UI components |
| `src/db/queries/` | Parameterised application PostgreSQL queries |
| `src/db/migrations/` | Ordered PostgreSQL migrations |
| `src/lib/` | Auth, settings, email, SEO, ingest, shared helpers |
| `src/search/` | Typed search, query builder, Grid Solver, NL search |
| `tools/db/` | Database migration runner |
| `tools/migration/` | Repeatable import, enrichment, derived-data jobs |
| `tools/aflw/` | AFLW parse and staging load |
| `tools/validation/` | Migration parity/data validation |
| `tools/nl/` | NL corpora, stress/UI runners, comparisons |
| `tools/maintenance/` | Host setup, privileges, backup, restore, load testing |
| `tools/email_intake/` | IMAP fetch and staging |
| `deploy/` | systemd, Caddy, cluster supervisor, apex deployment |
| `tests/` | Unit, integration, release-gate, E2E tests |
| `docs/` | Architecture, data, search, deployment and operations docs |

Do not inspect unrelated directories "for completeness".

Expand beyond the mapped subsystem only when evidence shows the implementation crosses a boundary.

---

# 5. Task Routing

## Natural-Language Search

Start with:

1. exact failing query;
2. relevant code in `src/search/`;
3. smallest relevant test;
4. `tools/nl/` only when corpus/stress validation is required.

Do not begin with a repository-wide search.

## Grid Solver

Start with:

1. Grid Solver code in `src/search/`;
2. relevant route/component if UI-facing;
3. relevant targeted tests/tooling.

Do not inspect all search code unless required.

## Frontend / UI

Start with:

1. exact route in `src/app/`;
2. components imported by that route;
3. shared component only if the problem originates there;
4. relevant theme/style implementation.

Do not inspect database/migration code unless evidence points there.

## Admin

Start with:

1. relevant admin route;
2. directly imported components;
3. relevant `src/lib/` helper;
4. relevant `src/db/queries/` query.

## Database Result / Query Bug

Start with:

1. caller;
2. relevant `src/db/queries/` file;
3. exact tables/columns;
4. targeted SQL verification.

Do not inspect migrations unless the schema appears responsible.

## Database Schema Change

Start with:

1. current schema/query usage;
2. `src/db/migrations/`;
3. affected queries;
4. targeted migration/test validation.

Do not redesign unrelated tables.

## Migration / Import

Start with:

1. exact failing job;
2. relevant `tools/migration/` file;
3. relevant validation;
4. source/target tables involved.

Do not inspect application code unless required.

## AFLW

Start with:

1. relevant AFLW application/query code;
2. `tools/aflw/` for parse/staging issues;
3. `docs/aflw.md` when model rules are required.

Do not assume the core VFL/AFL season model applies to AFLW.

## Deployment / Service

Start with:

1. current `README.md` status if needed;
2. relevant `deploy/` file;
3. `docs/deployment.md`;
4. directly relevant service/system output.

## Backup / Restore

Start with:

1. `docs/backup-restore.md`;
2. relevant `tools/maintenance/` script;
3. required database/service configuration.

## Email Intake

Start with:

1. `tools/email_intake/`;
2. relevant `src/lib/` email/ingest helper;
3. directly related route/query if required.

---

# 6. Natural-Language Search Architecture

AFLDB NL search is deterministic. The application pipeline is:

```text
canonicalise
-> parse
-> plan
-> validate
-> compile
-> PostgreSQL
-> answer
-> describe/render
```

When debugging NL search, identify the failing stage before expanding scope.

Preferred sequence:

1. Reproduce the exact failing query.
2. Inspect only enough parse/plan/result output to locate the failure.
3. Identify the responsible stage.
4. Inspect that implementation.
5. Add/update a focused regression test.
6. Make the smallest correct fix.
7. Rerun the failing query.
8. Run closely related tests.
9. Run a larger corpus only after targeted checks pass and broader validation is justified.

Do not immediately run the full NL corpus for every parser/planner change.

Do not investigate unrelated corpus failures during the same task unless they block it.

---

# 7. Context Efficiency

Keep conversational/tool context small.

- Search before opening large files.
- Read only relevant files/sections.
- Prefer exact symbols, filenames, routes, table names, IDs, SQL fragments, and error strings.
- Do not repeatedly reread unchanged files.
- Filter logs and command output to relevant lines.
- Use counts/aggregates before retrieving large row sets.
- Do not dump large datasets or corpus output into context.
- Summarise successful output rather than reproducing it.
- Do not load generated content merely because it exists.

Avoid recursively inspecting:

```text
.next/
node_modules/
generated build output
stress-test output
large CSV/JSON files
generated corpora
historical logs
cache directories
```

Inspect generated output only when diagnosing that generated artefact.

---

# 8. Subagent Policy

Subagents are not the default.

Preferred direct workflow:

1. targeted search;
2. relevant file;
3. direct caller/dependency if needed;
4. change;
5. targeted test;
6. report.

Use a subagent only when:

- the problem genuinely spans independent subsystems;
- parallel investigation materially reduces required work;
- specialised review is explicitly requested;
- focused direct inspection failed to isolate the issue.

Rules:

- Default maximum: **one subagent per task**.
- Do not launch overlapping agents.
- Do not use Explore simply to map the repository.
- Do not use Plan for small/well-defined changes.
- Do not automatically invoke code-review/security-review agents after edits.
- Do not allow recursive agent spawning unless essential.
- Prefer one narrow question over multiple broad agents.

---

# 9. Testing Policy

Use the smallest test that proves the change.

Preferred order:

1. exact reproduction;
2. focused unit test;
3. focused integration test;
4. affected route/API test;
5. affected browser/E2E test;
6. targeted typecheck/build validation;
7. broad/full suite only when necessary.

Do not repeatedly run the full suite while iterating on a small defect.

Documented project commands include:

```text
npm run dev
npm run build
npm start
npm run typecheck
npm test
npm run test:e2e
npm run nl:stress
npm run nl:ui
npm run nl:stress:compare
npm run db:status
npm run db:migrate
npm run db:migrate:test
npm run db:privileges
```

Use `package.json` as the final authority if command definitions change.

Important boundaries:

- Integration tests use `AFLDB_TEST_DATABASE_URL`.
- Integration tests must target a database ending in `_test`.
- `npm run nl:stress` uses the configured application database.
- Migration/privilege commands can change database state.

Do not execute state-changing database commands unless the task requires them and the target is understood.

---

# 10. Build Policy

Do not run `npm run build` after every change.

Use a full build when:

- build behaviour is directly affected;
- diagnosing a framework/compiler issue;
- targeted checks are insufficient;
- final pre-deployment validation requires it;
- the user explicitly requests it.

Avoid repeated full Next.js builds during small iterations.

---

# 11. PostgreSQL Investigation

For database investigation:

- query only required tables/columns;
- filter by known IDs, seasons, clubs, matches, players, or keys;
- use `LIMIT` while exploring;
- prefer `COUNT`, grouping, and aggregates before large row retrieval;
- avoid `SELECT *` against large tables;
- avoid dumping large result sets into context;
- inspect execution plans only for performance work;
- preserve `NULL` versus zero semantics.

Important AFLDB modelling rules include:

- missing historical statistics may mean "not recorded", not zero;
- historical club identity is explicit;
- Brownlow totals use their authoritative source rather than assuming match rows are complete;
- player identity uses stable IDs rather than names alone.

Read current relevant documentation before changing a modelling rule.

---

# 12. Environment Boundaries

Linux is the supported runtime.

A Windows working copy may be used for editing/inspection, but Windows-only results are not authoritative for integration or release behaviour requiring the real runtime/database.

- Do not assume Windows success proves Linux deployment success.
- Do not point development at production credentials.
- Treat deployment status/configuration as current-state information.
- Read `README.md`, environment configuration, or relevant deployment docs when current values matter.
- Never commit or expose secrets, passwords, tokens, or private connection strings.

---

# 13. Git Policy

Default to local working-tree work.

Read-only Git inspection is allowed when useful:

```text
git status
git diff
git diff --stat
git log
```

Do not perform mutating Git actions unless explicitly requested:

- commit
- push
- pull
- merge
- rebase
- checkout/switch
- reset
- stash
- tags
- branch creation/deletion
- force operations

Never discard unrelated user changes.

Do not clean the working tree simply because unrelated modifications exist.

Report modified files before finishing.

---

# 14. Scope Control

The user's request is the scope boundary.

Do not automatically:

- refactor adjacent code;
- fix unrelated warnings;
- update dependencies;
- redesign neighbouring functionality;
- perform repository-wide cleanup;
- update unrelated documentation;
- run general code review;
- run security review;
- investigate every issue discovered during testing.

If a separate issue is found and does not block the task:

1. note it briefly;
2. leave it unchanged;
3. finish the requested work.

---

# 15. Review Tasks

When explicitly asked to review:

- inspect only the requested scope;
- prioritise correctness, regressions, security, data integrity, and operational risk;
- cite exact files/locations;
- do not modify code unless fixes were requested;
- do not broaden a scoped review without evidence.

A review does not authorise Git, deployment, or database mutation.

---

# 16. Security Tasks

For a scoped security task:

- identify the trust boundary;
- trace user-controlled input to sensitive sinks;
- inspect relevant auth/authz;
- check secrets/privilege boundaries;
- verify SQL remains parameterised;
- prioritise meaningful/exploitable findings.

Do not perform a whole-repository security audit for a narrowly scoped request.

---

# 17. Documentation Tasks

When updating documentation:

- use current code/current docs as sources;
- do not copy stale information from `README.old.md` without verification;
- keep `README.md` concise/current;
- place detailed subsystem/operational material under `docs/`;
- avoid duplicating this repository map unnecessarily.

---

# 18. Session Management

Do not let one session accumulate unrelated work indefinitely.

At a natural milestone:

1. finish the current task;
2. report files changed;
3. report verification;
4. report blockers/follow-ups;
5. stop.

If the next request is a materially different subsystem and the session is already large, recommend a fresh session rather than carrying unnecessary context.

Do not create handover files unless asked.

If asked for one, keep it concise:

```text
objective
work completed
files changed
tests run
known failures
remaining blocker
exact next action
```

---

# 19. Tool Output Discipline

Do not narrate every routine command.

Report the useful result:

- relevant finding;
- exact error;
- important query result;
- changed files;
- test outcome;
- blocker.

Avoid pasting:

- huge directory listings;
- complete build logs when one error matters;
- thousands of database rows;
- complete corpus output;
- repeated successful output.

Filter and summarise.

---

# 20. Completion Standard

A task is complete when:

1. requested scope is addressed;
2. relevant targeted verification passed, or the blocker is identified;
3. relevant `issues.md` state is current;
4. `IssuesIndex.md` and the Open Issues table in `issues.md` are synchronized;
5. `CHANGELOG.md` is updated when a meaningful retained change requires it;
6. unrelated files were not unnecessarily changed;
7. no unauthorised Git/deployment/database mutation occurred;
8. modified files, issue tracking, changelog status, and verification are reported.

Then stop.

Do not automatically start another investigation.


# 21. Existing Test Reuse Policy

AFLDB already has substantial regression, integration, parser, UI, data,
migration, and audit coverage.

Do not create a new test file by default.

Before adding tests:

1. Identify the affected subsystem.
2. Search `tests/` for the relevant:
   - implementation symbol;
   - route;
   - parser/compiler;
   - query;
   - feature name;
   - existing issue ID;
   - nearby regression cases.
3. Inspect the smallest relevant existing test file.
4. Add the regression to that existing suite when it belongs there.
5. Create a new test file only when no existing suite provides a sensible
   semantic home.

Do not create a separate test file merely because the current defect is new.

Prefer extending established coverage so related behaviour remains grouped.

## Test hierarchy

For NL search, prefer existing suites in roughly this order:

- parser behaviour -> existing NL parser tests
- plan behaviour -> existing NL plan tests
- answer/description behaviour -> existing NL answer/description tests
- accepted query regressions -> existing NL audit/acceptance tests
- SQL/result correctness -> existing NL integration suites
- rendered browser behaviour -> existing NL UI/Playwright suites
- corpus-generation defects -> existing corpus-generator tests

For admin/database work:

- match-sheet behaviour -> existing match-sheet tests
- match mutations -> existing admin/match mutation tests
- lineup behaviour -> existing lineup-editor tests
- player-link behaviour -> existing player-link tests
- awards/import behaviour -> existing award/import suites
- database correctness requiring real PostgreSQL -> relevant existing
  integration suite

For Grid Solver:

- criterion/spec parsing -> existing Grid Solver spec tests
- result correctness -> existing Grid Solver integration tests

## Do Not Duplicate Existing Tests

If an existing test already proves the required behaviour:

- do not create another equivalent test;
- run the existing test;
- update it only if the expected behaviour has legitimately changed.

If a nearby existing test can cover the regression with another case/table row,
extend it rather than creating another file.

## Preserve Valuable Regression Coverage

Do not delete or weaken an existing regression merely because a new
implementation makes it inconvenient.

When behaviour intentionally changes:

1. understand why the previous expectation existed;
2. update the expectation;
3. preserve collision/negative cases where still applicable.

## Use Issue History Before Designing Tests

For a task linked to an AFLDB issue, inspect that issue's `Validation` and
`Follow-up` sections before creating tests.

They may already identify:

- tests that exist;
- tests already run;
- missing integration coverage;
- failed test approaches;
- exact reproduction queries;
- required future fixtures.

Do not repeat completed validation unless current changes can affect it or the
issue explicitly calls for rerunning it.