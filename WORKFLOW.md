# WORKFLOW.md — AFLDB Claude Code Operating Workflow

## Purpose

This file defines the human operating workflow for AFLDB Claude Code sessions: model selection, planning, handoff, implementation, verification, context control, and Git ownership.

It is intentionally **not automatically imported by `CLAUDE.md`**. The core rules Claude needs every session live in `CLAUDE.md`; this file is consulted when choosing how to run work or preparing a cross-session handoff.

The workflow is based on the 2026-08-23 usage audit:

- 49 sessions in the rolling 7-day window;
- 79.51% of observed assistant turns were above 150k context;
- two pre-workflow marathon sessions accounted for 36% of weekly cache-read tokens;
- 85 model changes occurred across 24 sessions, concentrated before the workflow change;
- the latest 13 sessions showed a sharp improvement: mostly single-model, only two subagent launches, much shorter duration;
- the audited target session had zero model switches, zero subagents, no shell/test/Git/SQL/log output, and peaked at 111,316 context;
- its main remaining context spike correlated with one 57,553-character native `Read` result.

The objective is:

> Preserve correctness and safety while preventing avoidable long-context, repeated-model, subagent-heavy and high-output sessions.

---

# 1. Core Operating Model

```text
issue
→ choose model before session
→ investigate/plan only when necessary
→ approved runbook for complex work
→ fresh implementation session when model/phase changes
→ Claude inspects/edits
→ user executes commands
→ Claude evaluates evidence
→ update issue/index/changelog
→ user reviews Git
→ stop
```

Do not keep one chat alive simply because it still has context capacity.

---

# 2. Model Selection Before Starting

Choose the model, reasoning effort and mode **before** the session.

| Work | Model | Effort | Mode |
|---|---|---|---|
| Small/bounded bug fix | Fable | Medium | Normal |
| Straightforward feature/refactor with clear scope | Fable | Medium | Normal |
| Documentation/issue/index/changelog maintenance | Fable | Medium | Normal |
| Usage/config/log audit | Fable | Medium | Normal |
| Multi-file implementation with approved complex runbook | Fable | High | Normal |
| Difficult debugging with ambiguous root cause | Opus | High | Plan/investigation |
| Data-integrity or migration design with uncertain consequences | Opus | High | Plan/investigation |
| Production-safety procedure/audit design | Opus | High | Plan |
| Architecture/security design with meaningful blast radius | Opus | High | Plan |
| Independent high-risk review | Opus | High | Review/Plan as appropriate |
| Complex implementation still requiring continuous high-level judgement | Opus | High | Normal |

Use `xhigh` only as an exceptional task-specific escalation when High is demonstrably insufficient. Never use it as the global default.

## Model change rule

**A model change means a new session.**

Do not switch Opus ↔ Fable inside an established AFLDB session.

Instead:

```text
finish safe milestone
→ write/confirm durable handoff
→ end session
→ start fresh with the new model
```

---

# 3. When Opus Is Needed

Use Opus when work requires materially deeper reasoning:

- ambiguous root cause after focused inspection;
- multiple plausible fixes with different data/operational consequences;
- production read/write safety;
- schema/migration design;
- data-integrity reconstruction;
- privilege/security architecture;
- cross-subsystem architecture;
- formal runbook design;
- independent review of a high-risk plan.

If the work is well bounded and the correct implementation is clear, start with Fable.

---

# 4. Complex Issue Workflow — Opus → Fable

## Session A — Opus High

Goal: establish facts and produce the approved execution contract.

Opus should:

1. read `IssuesIndex.md`;
2. read only the exact issue entry;
3. inspect minimum relevant code/docs;
4. establish evidence/root cause where possible;
5. identify risks and stop conditions;
6. design verification;
7. produce the final approved runbook.

Save the final approved runbook as:

```text
<ISSUE-ID>.md
```

For safety-critical work, retain detail that is part of the safety contract. Do not compress away gates, hashes, outcome criteria, stop conditions, or validation requirements merely to save context.

Once approved: **stop the Opus session**.

## Session B — fresh Fable High

Execute the approved runbook precisely.

Suggested opening prompt:

```text
Execute AFLDB-ISSUE-XXX according to AFLDB-ISSUE-XXX.md.

Treat the approved runbook as authoritative.
Follow CLAUDE.md.
Do not redesign, broaden or weaken the runbook.
Use native repository tools for inspection/editing.
I will execute all shell, tests, build, SQL, SSH/service, deployment and Git commands.
If current evidence materially contradicts the approved runbook, stop and report it.
```

Do not paste the whole Opus conversation.

Prefer the issue entry, `<ISSUE-ID>.md`, and current relevant code.

---

# 5. Bounded Issue Workflow — Fable Only

For a normal bounded bug/feature, use Fable Medium:

1. read relevant issue/index context;
2. locate/reproduce the defect using native inspection;
3. identify first wrong layer/root cause;
4. extend the closest existing regression test if needed;
5. make the smallest coherent edit;
6. give the user the focused verification command;
7. evaluate returned output;
8. update issue/index/changelog;
9. report changed files;
10. stop.

Escalate to a fresh Opus session only for genuine ambiguity, architecture, data-integrity risk, production safety, or unresolved root cause.

Do not escalate merely because a test failed.

---

# 6. Command Ownership

## Claude operates

Claude directly uses native repository capabilities for:

- Read;
- Grep/search;
- Glob/file discovery;
- file editing;
- narrow code/document inspection.

Do not make the user run shell commands for repository facts Claude can obtain natively.

## User operates

The user runs:

- tests;
- typecheck/build;
- SQL/psql;
- SSH;
- `journalctl`;
- service/system commands;
- project scripts;
- deployment commands;
- package-manager commands;
- all Git commands.

Claude gives the smallest exact command needed and waits for the result.

---

# 7. Verification Loop

Use a one-command-at-a-time evidence loop when practical:

```text
Claude edits / identifies question
→ Claude gives smallest command
→ user runs it
→ user returns output
→ Claude evaluates
→ next command only if necessary
```

Prefer focused tests, targeted integration files, filtered logs, and narrow SQL over full suites or large dumps.

Broad validation belongs after focused checks pass and only when the change's blast radius justifies it.

---

# 8. Context Management

The audit identified high-context turns as the dominant remaining usage pattern.

## 150k handoff rule

At approximately **150k context**, plan to end the session at the next safe milestone.

This is an operational guardrail, not a proven exact economic optimum. The audit showed 79.51% of the week's turns occurred above it and long sessions dominated token processing.

At/near the threshold:

1. stop broadening investigation;
2. finish the current coherent edit/review step;
3. update durable issue/runbook state;
4. report exact next action;
5. start a fresh session if work remains.

## Start fresh earlier when

Start a fresh session below 150k when:

- changing model;
- moving from planning to implementation;
- moving to a materially different subsystem/issue;
- the current task reached a natural completion point;
- the old conversation contains substantial investigation history no longer needed.

For production/safety work, reach the next defined safe point before handoff.

---

# 9. Native Read Discipline

The target audit's largest remaining spike followed a **57,553-character `Read` result**.

Default:

```text
search
→ identify line/section
→ ranged Read
→ follow only necessary dependencies
```

Avoid whole-file reads when a subsection is enough, especially for `issues.md`, long source files, migrations, generated SQL, logs, large fixtures/corpora, and historical artefacts.

Full reads are valid when correctness requires them, including mandatory full SQL safety reviews or explicitly requested full-file reviews.

---

# 10. Subagent Policy

Default to no subagents.

Use one only when it creates a concrete advantage, such as genuinely independent parallel investigation or requested specialist review.

Never use subagents merely to explore the repo faster, repeat Claude's own work, review every edit automatically, or plan a small task.

If a task appears to need multiple subagents, consider splitting the work into separate issues/sessions.

---

# 11. Project-Memory Roles

## `IssuesIndex.md`

Fast map of current open work only.

## `issues.md`

Authoritative durable record of problem, evidence, investigation, root cause, fix, validation, and remaining work.

## `<ISSUE-ID>.md`

Approved complex cross-session plan/runbook. Use when a detailed handoff is genuinely needed, not for every trivial issue.

## `CHANGELOG.md`

Meaningful retained changes to AFLDB, not investigation narrative.

---

# 12. Handoff Template

When a fresh session is needed and no full runbook is necessary, carry only:

```text
Issue:
Objective:
Confirmed root cause/facts:
Files/subsystem:
Work completed:
Outstanding implementation:
Validation already completed:
Next exact action:
Constraints / stop conditions:
```

Do not copy the complete previous conversation.

If `<ISSUE-ID>.md` already contains the information, reference it instead.

---

# 13. Git Workflow

Git is performed by the user.

1. Claude lists files changed.
2. User runs desired Git inspection.
3. User returns diff/output only if Claude review is wanted.
4. User commits/pushes when satisfied.

Do not keep Claude sessions open solely for Git housekeeping.

---

# 14. When to Stop

Stop when:

- the issue/task is complete;
- an approved plan is complete;
- implementation reached a handoff point;
- verification established a blocker;
- evidence contradicts a high-risk approved runbook;
- the model needs to change;
- context is around 150k and a safe milestone is available;
- the next work is a different subsystem/issue.

A good session has an explicit end.

---

# 15. Usage Audits

Do not audit continuously.

Run an audit after a meaningful workflow/config change, after several representative sessions, or when weekly usage accelerates unexpectedly.

| Audit work | Model | Effort | Mode |
|---|---|---|---|
| JSONL/config usage audit | Fable | Medium | Fresh normal session |

Audit completed work sessions, not the audit session itself.

Measure session length, context growth/peak, model switches, subagent launches, cache read/creation, native tool-result size, and high-context turns.

---

# 16. 2026-08-23 Baseline

| Metric | Observed |
|---|---:|
| Rolling sessions | 49 |
| Turns above 150k context | 6,772 / 8,517 (79.51%) |
| Model changes | 85 across 24 sessions |
| Subagent launches | 43 across 15 sessions |
| Weekly cache reads | 2,355,944,739 |
| Weekly cache creations | 45,900,453 |
| Two marathon sessions' cache reads | ~859M (36% of weekly cache reads) |
| Target session duration | 1m 48s |
| Target model switches | 0 |
| Target subagents | 0 |
| Target peak context | 111,316 |
| Target cache read:creation | 12.2:1 |
| Largest target native Read | 57,553 characters |
| Recent post-change sessions | 13, sharply improved behaviour |

Use this as the comparison baseline for later audits.

---

# 17. Short Decision Tree

```text
Bounded task with likely straightforward root cause?
  YES → Fable Medium, fresh normal session.
  NO
    ↓
Ambiguous root cause, architecture, data integrity,
migration design, production safety or high-risk review?
  YES → Opus High, Plan/investigation.
          ↓
        Approved runbook needed?
          YES → save <ISSUE-ID>.md → stop → fresh Fable High implementation.
          NO  → finish scoped Opus work → stop.
    NO → Fable Medium/High based on implementation complexity.

During any session:
  model needs to change? → fresh session
  new unrelated issue? → fresh session
  context ~150k? → safe milestone → fresh session
  user command needed? → give exact command → wait
  unexpected high-risk evidence? → stop; do not improvise
```
