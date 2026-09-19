<!-- PINNED DIRECTIVES, DO NOT MOVE FROM TOP, DO NOT DELETE WITHOUT USER CONSENT -->
> **PINNED PROJECT DIRECTIVES, ALWAYS READ, BINDING.**
> This block stays at the top of this file. Do NOT delete or relocate any entry
> without explicit user consent; always ask before removal. It contains binding
> operating rules from PhanesLight and companion tools. Each tool owns its own
> namespaced entries and is that namespace's single writer.

<!-- pinned:phaneslight (GENERATED, single-writer PhanesLight, regenerated every run) -->
> **Per-agent model and effort.** Model is fixed by role, not by judgment: `afldb-orchestrator` runs Opus 5, `afldb-reviewer` runs Fable 5, `afldb-worker` and `afldb-closure` run Sonnet 5, all at `high` effort; `afldb-mechanic` runs Haiku 4.5 with no effort dial. Launch with `--effort high`. Where a pinned model is UNREACHABLE (quota, rate limit, outage), retry three times with exponential backoff, then substitute down the documented ladder and record it in the step session summary, the persisted return, and `pinned:project` if it outlives the step. "Fixed by role" governs the choice, not the availability.
> **Agent lineup and escalation.** Five agents; see §15 of this file for the full lineup, write rights, spawn grants and severity ladder. In summary: only `afldb-orchestrator` and `afldb-reviewer` may spawn; no agent is ever forked; `afldb-mechanic` NEVER writes code; `afldb-reviewer` never writes code but does write plan files; findings graded MED and above travel up to the spawner (LOW and above from a mechanic). On a planned launch, the orchestrator's FIRST act is a `afldb-reviewer` plan review before any execution step.
> **Procedure precedence.** Current phaneslight.md/skill and `.claude/workflows/` YAML outrank session-summary narrative on any operating-procedure conflict. Summaries record what happened; they do not define procedure. Re-read the skill, never recall procedure from a summary.
> **Authorized deviations from the directives above are recorded in `pinned:project` below and OVERRIDE them.** This namespace is regenerated on every run and cannot carry one.
<!-- /pinned:phaneslight -->
<!-- pinned:project (OWNER-OWNED, NEVER generated, NEVER regenerated, NEVER deleted by any run) -->
> **Authorized deviations.** Owner-authorized departures from a generated directive live here, one line each, and OVERRIDE the generated line they name. Empty is the normal state; delete an entry only when the deviation ends.
>
> DEVIATION (2026-09-19, owner-authorized): **AFLDB's own §1–§14 below GOVERN wherever they conflict with any PhanesLight-generated directive in this file, in `.claude/workflows/`, or in any generated agent definition.** PhanesLight was installed additively onto an existing, curated operating contract; it did not replace one.
>   Reason: the operator chose additive installation with AFLDB precedence at bootstrap. See: `documentation/session-summaries/SS00001_phaneslight-bootstrap_2026-09-19.md`.
>
> DEVIATION (2026-09-19, owner-authorized): **§1's "Default: zero subagents" still binds the primary session.** PhanesLight's tiered dispatch is available, not automatic: engage `afldb-orchestrator` per §15's threshold, and otherwise work directly. Do NOT read §15 as licence to spawn agents for ordinary focused work.
>   Reason: AFLDB sessions are deliberately narrow and context-disciplined. See: `CLAUDE.md` §1.
>
> DEVIATION (2026-09-19, owner-authorized): **§9 and §12 (user-executed command boundary, Git policy) bind every PhanesLight agent exactly as they bind the primary.** A generated agent's operating protocol lists `phaneslight` scripts it *may* invoke; that is not standing authorisation to execute shell, Git, SQL, SSH, deployment or test commands. Authorisation is per task, from the user.
>   Reason: §9 is a hard boundary in this repository and PhanesLight installation does not relax it. See: `CLAUDE.md` §9, §12.
>
> DEVIATION (2026-09-19, owner-authorized): **Issue and change tracking stays in `issues.md`, `IssuesIndex.md` and `CHANGELOG.md` per §5.** `documentation/` is PhanesLight working memory (session summaries, plans, architecture snapshots, registry annotations); it is NOT an issue ledger and does not supersede §5. `docs/` remains the authoritative human documentation tree.
>   Reason: AFLDB has an established, authoritative tracking system that predates this install. See: `CLAUDE.md` §5, `documentation/architecture/2026-09-19_initial/overview.md` §0.
<!-- /pinned:project -->
<!-- /PINNED DIRECTIVES -->

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

## Standard issue lifecycle commands

Keep the routine path memorable and use the hardened entry points instead of rebuilding the
Git/deploy checks by hand:

```text
update clean main
-> npm run worktree:bootstrap -- --issue NNN --branch <agent>/issue-NNN
-> enter the new worktree
-> npm run preflight -- --mode implementation --issue NNN
-> implement and validate
-> operator commits the reviewed local change
-> npm run merge:ready -- --issue NNN
-> operator pushes/merges
-> deploy/sync-dev.ps1 (DEV) and smoke
-> close the issue
```

Use `preflight -- --mode merge` for operator work on main and `--mode read-only` for inspection
on main. Before a long scheduled settle, follow the monitoring block printed by
`deploy/afldb-settle-afltables.sh`. Details and the optional merge-readiness runbook block live in
`docs/development/WORKFLOW.md`.

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

`docs/archive/README.old.md` is historical reference only.

Do not bulk-read `docs/` or `issues.md`.

`docs/development/WORKFLOW.md` is the human/session operating guide. **Do not load it automatically.** Read it only when:

- the user asks about workflow/model/session strategy;
- preparing or reviewing a cross-session handoff;
- the user explicitly asks to read it.

Do not add `@docs/development/WORKFLOW.md` or another automatic import from this file.

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

Do not copy stale `docs/archive/README.old.md` information without verification.

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

---

# 15. PhanesLight Agent Team

> **Precedence.** §1–§14 above govern wherever they conflict with anything in this section
> (see the `pinned:project` deviations at the top of this file). This section describes a
> capability that is **available**, not one that is automatic.

## Engagement: when this section applies at all

**Default remains §1: zero subagents.** Work directly. Engage the team only when one of these holds:

- You are launching a **plan** whose effective scope is **5 or more steps**
  (`orchestratorStepThreshold` in `.phaneslight/config.json`) and the user has not narrowed it.
  Then spawn `afldb-orchestrator` and stay slim: read the plan's step list once for structure,
  build the todolist, handle the spawn and the close, and let it own the steps.
- The work genuinely spans independent subsystems and parallel investigation materially reduces
  work (§1's existing "at most one" test, now able to resolve to a tier rather than an ad-hoc agent).

Explicit user narrowing ("only step 1"), a plan of 4 or fewer steps, or any non-plan task: work
directly. **Ambiguity defaults to NOT engaging**, which is the opposite of the PhanesLight default
and is deliberate here (§1).

## The lineup

| Agent | Model | Spawned by | Writes to the repository | May spawn |
|---|---|---|---|---|
| `afldb-orchestrator` | `opus` | The main session only, at launch | **Yes, unrestricted.** Main executor as well as orchestrator | reviewer, worker, mechanic, closure |
| `afldb-reviewer` | `fable` | The orchestrator only | **No code.** Plans fixes; **does** write plan files and review artifacts | worker, mechanic |
| `afldb-worker` | `sonnet` | Orchestrator or reviewer | **Yes, within dispatched scope**; MUST disclose every edit | Nothing |
| `afldb-mechanic` | `haiku` | Orchestrator or reviewer | **NEVER code.** Mechanical non-code writes only; MUST disclose every edit | Nothing |
| `afldb-closure` | `sonnet` | The orchestrator only | **No code.** Sole writer of `.phaneslight/registry/` and `documentation/archive/projects/` | Nothing |

**No agent is ever forked** — every spawn carries a self-contained brief. Nesting is at most three
levels below the main session, which holds by construction since only two roles have a spawn grant.
**No agent may invoke `afldb-orchestrator`**; only the main session spawns it.

**The write column is PROSE-enforced, not harness-enforced.** `tools:` cannot scope `Write`/`Edit`
to a path, so the mechanic (which must write docs) holds the worker's write toolset despite "NEVER
code". Nothing mechanically stops it editing `src/`; what catches it is disclosure plus closure's
applied-versus-intended reconciliation — which is why an undisclosed edit is drift, not an
oversight. Spawn grants and models **are** mechanical: only orchestrator and reviewer list `Agent`.

Domain expertise is **not** baked into these five files. The orchestrator composes it per task from
this file, the relevant `documentation/` slice (index-first) and the affected modules' registry
files, and injects it into each spawn prompt.

## Escalation (by severity, never by review pass)

Findings are graded **CRIT / HIGH / MED / LOW / INFO**. LOW and INFO create no work anywhere.

- **Worker** escalates **MED and above to its own spawner**, immediately, and stops.
- **Mechanic** escalates **LOW and above to its own spawner** — one grade lower, because it may not
  write code and so cannot absorb even a trivial fix.
- **Orchestrator** holding HIGH or CRIT runs the decision matrix: **defer** (recorded in that step's
  session summary with grade, `file:line` and a one-line justification, carried into the handover) or
  **dispatch `afldb-reviewer`**. MED it handles itself; MED never reaches the reviewer.
- **Reviewer** returns a **plan**, not a fix, and stops. The orchestrator executes it.

**Plan review at launch:** on a planned launch the orchestrator's first act, before any execution
step, is a `afldb-reviewer` review of the plan it was handed. CRIT or HIGH there stops the run and
goes to the user. No plan, no plan review.

## Tier triage (first action on every task)

| Tier | Trigger | Loaded context | Agents | Documentation weight |
|---|---|---|---|---|
| **T1** | Single-file change, isolated fix. Must not touch exported API surface, and must not need live external state verified against a running service or DB — either promotes it to T2. (No DB capability is granted to any agent; verifying live DB state is a user-executed command under §9.) | Architecture overview only | Orchestrator alone, or one mechanic — **never two agents**, including on UI tasks | One line in the current session summary |
| **T2** | Feature or refactor within one module | Overview + that module's deep-dive + its registry file + latest session summary; API queried on demand, never preloaded | Orchestrator + worker(s) + closure at step close | Standalone report + summary entry |
| **T3** | Multi-module, API change, migration — anything touching ≥2 modules | Overview + all touched module deep-dives + their registry files + active plan | Orchestrator + worker(s), closure between phases | Plan in `documentation/plans/` + reports + summary entry |

**Promotion rule:** any agent realising mid-task that scope exceeds its tier's loaded context MUST
halt and request promotion rather than improvise outside loaded context.

**Disclosure is universal; only documentation weight scales.** A T1 mechanical edit is still named
in its report. An undisclosed edit is reported as drift by `afldb-closure`.

T2/T3 work ends with `afldb-closure`, which independently re-derives the API baseline, re-runs the
build/typecheck/test itself rather than trusting a producer's claim, and reconciles what was applied
against what was intended. **Its output is a flag, never a fix.**

## UI changes (Visual Evidence Mandate)

Any change altering rendered UI carries a visual evidence obligation at **every** tier. The proposal
declares target viewport(s), affected screens/states, and the reference design where one exists,
**before** apply; a proposal missing that declaration is refused. After apply, `afldb-closure`
captures and runs the pass/fail checklist. **Prose approval ("looks good", "should render
correctly") is FORBIDDEN as approval grounds.** Only captured images or an explicit
`VISUAL: UNVERIFIED` flag exist.

Capture uses **this repository's own Playwright install** (`playwright.config.ts`,
`playwright.nl-stress.config.ts`, `playwright.admin-nav.config.ts`) via `npx` — no browser MCP is
granted. Where capture is unavailable or returns empty frames, diagnose why, record it in
`.phaneslight/config.json` `capabilities.failures[]` and the session summary with a user-eyeball
request, and proceed marked `VISUAL: UNVERIFIED`. Chains never block on missing tooling; they never
silently pass visuals either.

## Documentation Navigation

**Documentation Navigation:** NEVER bulk-read or glob-scan `documentation/`. Every folder in it
carries a GENERATED `_index.md`, read the index first, pick the entry, recurse, and load only
the target file(s). This binds every agent, the mechanic tier included. Indexes are generated by
`phaneslight doc-index` and hand-editing them is FORBIDDEN, regenerate to update.
Audit documentation hygiene with `phaneslight doc-check`.

**This governs `documentation/` only.** `docs/`, `issues.md` and `IssuesIndex.md` keep their own
§3–§5 read discipline, which is unchanged.

## Scripts (procedure belongs in scripts, not in prompts)

Invoke as **`node .phaneslight/scripts/cli.js <cmd>`** — never a bare `phaneslight`, which is on no
shell's PATH. Subject to §9: listing a script here is not standing authorisation to run it.

`new-file <module> <path> "<desc>"` (the **only** sanctioned file creation; ≥5-word description),
`loc-check`, `doc-check`, `doc-index`, `register-check`, `module-list`, `list-apis <module>`,
`regen-registry [module]`, `api-diff <ref> [module]`, `repo-manifest`, `batch-apply`, `ledger`.

The API baseline at `.phaneslight/registry/` is closure's diff substrate and `list-apis`' data
source — **not** agent reading material, and not documentation. It covers `.ts`/`.tsx`/`.sql` only;
every slice records what it did **not** examine, so a zero entry count never means "no surface".

## Installed Capability Register

**(GENERATED, regenerated by every `/phaneslight:run` run; hand-editing FORBIDDEN.)**

- `context7` (MCP) → `afldb-orchestrator`, `afldb-worker`: live library documentation lookup; matched: Next.js 16.3.1 + React 19 (Phase 1), whose APIs postdate training data and which this file already warns about; fallback: targeted reads of `node_modules/next/dist/docs/`.
- `semble` (MCP) → `afldb-orchestrator`, `afldb-worker`, `afldb-reviewer`: indexed hybrid code search before any repo-wide sweep; matched: 1,442-file TypeScript codebase (Phase 1); fallback: Grep/Glob, which costs tokens but never correctness. The reviewer holds it for blast-radius enumeration in plan review; it holds **no** `context7` — a finding turning on external library behaviour goes to the orchestrator in the plan, never guessed.
- `frontend-design` (skill) → any agent on UI work; matched: Next.js App Router UI in `src/app` + `src/components` (Phase 1); fallback: none needed — a skill costs nothing until invoked.

Deliberately **not** granted: `serena`, `deepwiki`, the `playwright` MCP, `codebase-memory-mcp`.
Rationale is recorded in `SS00001`; do not re-grant without a new operator decision.

## Workflows

Task sequences for this project are codified in `.claude/workflows/`. Choose the workflow matching
the task and follow it. **§15's lineup and ladder above govern routing, write rights and spawn
grants; a workflow file that disagrees is the defect.** Workflow YAML never redefines routing.

<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
