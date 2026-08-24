# CLAUDE.md — AFLDB Repository Instructions

## Purpose

Work accurately while keeping repository exploration, context growth, tool output, testing, and subagent use as small as practical.

The user's request and the active AFLDB issue/runbook are the scope boundary.

Default workflow:

1. Identify the task and relevant issue.
2. Route directly to the affected subsystem.
3. Search before reading large files.
4. Read only the relevant ranges/files.
5. Make the smallest correct change.
6. Give the user the smallest exact verification command required.
7. Analyse the returned evidence.
8. Update issue/index/changelog tracking when required.
9. Report changed files, validation, blockers, and next action.
10. Stop.

Do not turn a focused task into a repository-wide investigation.

---

# 1. Session and Context Discipline

## One task per session

Keep a session focused on one issue or tightly related task.

Do not begin unrelated work after the current task reaches a natural milestone.

If the next task is materially different, recommend a fresh session.

## No in-session model switching

Do not recommend changing model inside an established session.

If another model is materially better for the next phase:

1. finish at a safe milestone;
2. record durable findings/runbook;
3. recommend a fresh session;
4. state the recommended model, effort level, mode, and carry-over file/prompt.

Do not use model switching as a substitute for a clean handoff.

## Context ceiling

Treat approximately **150k tokens of session context** as the point where a fresh-session handoff should normally occur.

When approaching that level:

- do not broaden scope;
- avoid large reads unless required for correctness;
- finish the current safe milestone;
- preserve durable state in the issue/runbook;
- start a fresh session for continued work.

For an atomic or production-safety sequence, do not interrupt at an unsafe point merely to satisfy the context ceiling. Reach the next safe checkpoint, then hand off.

## Subagents

Default: **zero subagents**.

Use at most one when:

- the task genuinely spans independent subsystems;
- parallel investigation materially reduces work;
- specialised independent review is explicitly requested;
- focused direct inspection failed.

Do not:

- use Explore merely to map the repository;
- use Plan for small/well-defined changes;
- launch overlapping agents;
- allow recursive agent spawning unless essential;
- automatically run review/security agents after edits.

---

# 2. Repository Boundary and Native Inspection

Treat the current AFLDB repository root as the working boundary.

Work only inside the repository unless explicitly instructed otherwise.

Claude should use native repository tools such as **Read, Grep, Glob/file search and editing tools itself**.

Do not ask the user to run shell `grep`, `find`, `cat`, `type`, directory listings, or similar commands for information Claude can obtain with native repository tools.

Do not scan parent directories, sibling projects, home directories, or drives.

Prefer exact filenames, symbols/functions, routes, tables/columns, SQL fragments, issue IDs, and error strings.

Do not inspect unrelated directories "for completeness".

Avoid generated/high-volume content unless it is the subject of the task:

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

---

# 3. Read Discipline

Native file reads are a major source of context growth. Search first and read narrowly.

Default:

1. Grep/search for the relevant symbol, heading, route, error, SQL, or issue ID.
2. Read only the surrounding range needed to understand it.
3. Follow direct callers/dependencies only when evidence requires it.

Do not read an entire large file merely because it is relevant.

Especially avoid whole-file reads of:

- `issues.md`;
- generated SQL/output;
- large migrations;
- large source files;
- logs;
- corpora/fixtures;
- historical artefacts.

A full-file read is allowed when correctness requires complete review, for example a specifically requested full review or a safety-critical SQL/runbook review whose contract requires every statement to be inspected.

Correctness and safety override token efficiency.

Do not reread unchanged material without a reason.

---

# 4. Documentation and Project Memory

Use documentation selectively:

1. `CLAUDE.md` — operating rules.
2. `IssuesIndex.md` — current open work when relevant.
3. Relevant subsystem code.
4. Exact issue entry in `issues.md`.
5. `README.md` or relevant `docs/*.md` only when deeper/current context is needed.

`README.old.md` is historical reference only.

Do not bulk-read `docs/` or `issues.md`.

`WORKFLOW.md` is the human/session operating guide. **Do not load it automatically.** Read it only when:

- the user asks about workflow/model/session strategy;
- preparing or reviewing a cross-session handoff;
- the user explicitly asks to read it.

Do not add `@WORKFLOW.md` or another automatic import from this file.

---

# 5. Issue and Change Tracking

AFLDB uses:

- `IssuesIndex.md` — lightweight index of currently open issues only;
- `issues.md` — authoritative detailed issue ledger;
- `CHANGELOG.md` — meaningful retained project changes;
- `<ISSUE-ID>.md` — approved plan/runbook when a complex issue needs a cross-session execution handoff.

## Start of technical work

For code, data, search, UI, admin, database, import, deployment, or tooling work:

1. Read `IssuesIndex.md` once.
2. Determine whether the task overlaps an open issue.
3. If relevant, search for and read only that exact issue entry in `issues.md`.
4. Do not read the full ledger.

Skip this for simple wording/document-only work that cannot affect a technical issue.

If `IssuesIndex.md` and `issues.md` disagree, `issues.md` is authoritative. Synchronise the index/Open Issues table.

## Existing issue

If the user names `AFLDB-ISSUE-XXX`:

- read only that issue;
- start from established evidence/current state;
- verify current code where necessary;
- update the same issue rather than creating a duplicate;
- do not repeat established investigation without contradictory evidence.

If an approved `<ISSUE-ID>.md` runbook exists and the user asks to execute it:

- treat the approved runbook as the implementation contract;
- verify current code/evidence where the runbook requires it;
- do not redesign or broaden it during execution;
- if material evidence contradicts the runbook, stop and report the contradiction.

## New issue

For a newly reported defect without an ID:

1. Read `IssuesIndex.md`.
2. Search `issues.md` narrowly for a match.
3. Update an existing match.
4. Otherwise determine the next ID using a targeted heading/ID search.
5. Add it to `issues.md`, the Open Issues table, and `IssuesIndex.md`.

Create a tracked issue only for a meaningful reproducible defect, data-integrity/security problem, architectural limitation, unresolved regression, product limitation requiring future work, or repeatable tooling/test problem.

Do not create issues for routine implementation steps, temporary diagnostics, unsupported speculation, unrelated cosmetic cleanup, or already-tracked problems.

Never invent evidence, root cause, validation, or resolution.

## Resolution

Resolve an issue only when implementation plus appropriate verification supports it.

On resolution:

1. set status/resolved date;
2. record actual root cause, fix, and validation;
3. preserve useful history;
4. record genuine follow-up separately;
5. remove it from `IssuesIndex.md` and the Open Issues table;
6. update `CHANGELOG.md` when behaviour materially changed.

If only part is fixed, keep it open.

## `IssuesIndex.md`

Keep each open issue concise:

- ID/title;
- severity;
- area;
- current state;
- key files/subsystem;
- exact next action when known.

Update it when an issue is created, reopened, resolved, materially reclassified, or materially changes state/next action.

## `CHANGELOG.md`

Use `Unreleased`.

Update it for meaningful retained changes to application behaviour, search/parser behaviour, data/schema behaviour, admin/security behaviour, deployment/operations behaviour, or important retained validation/audit state.

Do not add entries for investigation-only updates, temporary diagnostics, failed approaches, raw command output, or status notes with no retained project change.

---

# 6. Repository Map

Use this map instead of rediscovering the architecture.

| Path | Purpose |
|---|---|
| `src/app/` | Next.js pages, layouts, server components, route handlers |
| `src/components/` | Shared React UI components |
| `src/db/queries/` | Parameterised PostgreSQL application queries |
| `src/db/migrations/` | Ordered PostgreSQL migrations |
| `src/lib/` | Auth, settings, email, SEO, ingest, shared helpers |
| `src/search/` | Typed search, query builder, Grid Solver, NL search |
| `tools/db/` | Database migration runner |
| `tools/migration/` | Repeatable import/enrichment/derived-data jobs |
| `tools/aflw/` | AFLW parse/staging load |
| `tools/validation/` | Migration parity/data validation |
| `tools/nl/` | NL corpora, stress/UI runners, comparisons |
| `tools/maintenance/` | Host setup, privileges, backup/restore, load testing |
| `tools/email_intake/` | IMAP fetch/staging |
| `deploy/` | systemd, Caddy, cluster supervisor, deployment |
| `tests/` | Unit, integration, release-gate, E2E tests |
| `docs/` | Architecture, data, search, deployment, operations docs |

Expand beyond the mapped subsystem only when evidence shows a boundary crossing.

---

# 7. Task Routing

| Task | Start with |
|---|---|
| NL search | exact failing query → relevant `src/search/` stage → focused test → broader NL tooling only if justified |
| Grid Solver | relevant solver code → UI route/component if applicable → focused tests |
| Frontend/UI | exact route → directly imported components → shared component/theme only if implicated |
| Admin | relevant admin route → imported component → relevant helper/query |
| DB query/result bug | caller → relevant query → exact tables/columns → targeted SQL evidence |
| DB schema change | current usage → migration → affected queries → targeted validation |
| Import/migration | exact job → relevant importer → validation → source/target tables |
| AFLW | relevant AFLW app/query code → `tools/aflw/` → `docs/aflw.md` if modelling rules needed |
| Deployment/service | relevant `deploy/` file → deployment docs if needed → exact service evidence |
| Backup/restore | backup/restore docs → relevant maintenance script/config |
| Email intake | `tools/email_intake/` → relevant helper → route/query only if needed |

---

# 8. Natural-Language Search

AFLDB NL search is deterministic:

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

Find the first wrong stage before expanding scope.

Preferred sequence:

1. reproduce exact query;
2. inspect minimal parse/plan/result evidence;
3. identify responsible stage;
4. inspect that implementation;
5. extend the closest regression test;
6. make the smallest correct fix;
7. ask the user to run the focused verification;
8. broaden corpus/testing only after targeted checks pass.

Do not run or request the full corpus for every parser/planner change.

---

# 9. User-Executed Command Boundary

The user executes shell and command-line verification by default.

Claude may:

- inspect/search/edit repository files with native tools;
- reason about source/config/data;
- provide exact commands;
- analyse command output returned by the user.

Claude must not execute shell commands by default, including:

- tests;
- builds/typechecks;
- Git;
- SQL/psql;
- SSH;
- `journalctl`/service commands;
- scripts/maintenance commands;
- package-manager commands;
- deployment commands;
- shell-based filesystem/search commands.

This applies even to read-only commands.

Exception: only when the user explicitly authorises Claude to execute commands for the current task.

Do not interpret "fix", "investigate", "review", or "verify" as command-execution permission.

## Verification loop

1. Make the safe repository edit when appropriate.
2. Give the user the smallest exact command that proves the next required fact.
3. Wait for output.
4. Analyse relevant evidence.
5. Give another command only if it materially advances verification.

Do not ask the user to run commands for facts native repository tools can obtain.

When the user returns large output, extract the relevant evidence and do not echo the whole output back.

---

# 10. Testing

Use the smallest test that proves the change.

Escalate only as required:

1. exact reproduction;
2. focused unit test;
3. focused integration test;
4. affected route/API test;
5. affected browser/E2E test;
6. typecheck/build;
7. broad/full suite.

Do not repeatedly request full-suite/build runs while iterating on a focused defect.

Important boundaries:

- integration tests use `AFLDB_TEST_DATABASE_URL`;
- integration databases must end in `_test`;
- NL stress uses the configured application database;
- migration/privilege commands can modify database state.

Do not request state-changing database commands unless required and the target is understood.

## Reuse existing tests

Do not create a new test file by default.

Search existing test homes first and extend the closest semantic suite.

| Area | Existing suites |
|---|---|
| NL parser | `tests/nl-parser.test.ts` |
| NL planner | `tests/nl-plan.test.ts` |
| NL descriptions | `tests/nl-describe.test.ts` |
| Query intent | `tests/query-intent.test.ts` |
| NL acceptance | `tests/nl-audit-acceptance.test.ts` |
| NL PostgreSQL | `tests/integration/nl-*.test.ts` |
| NL browser/runtime | `tests/nl-ui/nl-stress.spec.ts` |
| Grid Solver | `tests/grid-solver*.test.ts`, `tests/integration/grid-solver.test.ts` |
| Match/admin | `tests/match-sheet.test.ts`, `tests/admin-match-mutations.test.ts`, `tests/match-lineup-editor.test.ts` |
| Player links | `tests/player-link-*.test.ts` |
| Under-22 import | `tests/under-22-importer.test.ts` |
| Current season | `tests/current-season-import.test.ts` |
| Integration/E2E | closest existing subsystem/journey |

Create a new test file only when no existing suite is a sensible semantic home.

Do not delete, skip, disable, or weaken useful regression coverage merely to make tests pass.

For issue-linked work, inspect the issue's `Validation`/`Follow-up` before designing verification so completed work is not repeated unnecessarily.

---

# 11. Build, Database, and Environment Safety

## Build

Do not request `npm run build` after every change.

Use it when build/framework behaviour is affected, targeted checks are insufficient, pre-deployment validation requires it, or the user requests it.

## PostgreSQL/data

For proposed SQL investigation:

- query only required tables/columns;
- filter by known IDs/seasons/clubs/matches/players/keys;
- use `LIMIT` while exploring;
- prefer counts/aggregates before row detail;
- preserve `NULL` versus zero semantics.

Important modelling rules:

- missing historical statistics may mean "not recorded", not zero;
- historical club identity is explicit;
- Brownlow totals use their authoritative source;
- player identity uses stable IDs rather than names alone.

Read current relevant documentation before changing a modelling rule.

## Environment

Linux is the supported runtime.

Windows editing/inspection does not prove Linux integration/release behaviour.

Never expose secrets, passwords, tokens, private DSNs, or production credentials.

---

# 12. Git Policy

Git is user-operated.

Claude must not execute Git commands by default.

The user performs status/diff/log inspection, commit/push/pull, merge/rebase, checkout/switch, reset/stash, tagging/branch operations, and cleanup.

Claude may provide an exact Git command when requested, but must not execute it without explicit authorisation.

Never direct the user to discard unrelated changes simply to make the working tree clean.

Before finishing, report every repository file Claude changed.

---

# 13. Scope, Review, Security, Documentation

## Scope

Do not automatically refactor adjacent code, fix unrelated warnings, update dependencies, redesign neighbouring functionality, perform repository-wide cleanup, update unrelated docs, investigate every issue discovered, or perform general code/security review.

Record a separate issue only when it meets the issue criteria, then return to scope.

## Review

When explicitly asked to review:

- inspect requested scope only;
- prioritise correctness, regressions, security, data integrity, operational risk;
- cite exact files/locations;
- do not edit unless fixes are requested.

## Security

For scoped security work, identify trust boundaries, trace user input to sensitive sinks, inspect relevant auth/authz, check secrets/privilege boundaries, verify SQL parameterisation, and prioritise exploitable findings.

Do not broaden into a whole-repository audit without evidence.

## Documentation

Use current code/current docs as sources.

Keep `README.md` concise/current; place detailed subsystem/operations material under `docs/`.

Do not copy stale `README.old.md` information without verification.

---

# 14. Completion Standard

Before declaring a behaviour/code/data-changing task complete:

1. requested scope is addressed;
2. user-supplied targeted verification passed, or the blocker/required command is identified;
3. relevant issue evidence/state is current;
4. genuinely new tracked issues are recorded;
5. `IssuesIndex.md` and the Open Issues table are synchronised when required;
6. `CHANGELOG.md` is updated for meaningful retained changes;
7. unrelated files were not unnecessarily changed;
8. no unauthorised shell/Git/database/deployment command was executed;
9. report files changed, issue IDs, index/changelog status, validation, blockers/follow-up.

Then stop.

Do not automatically begin another investigation.
