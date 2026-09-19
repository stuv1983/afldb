<!-- DOC | Rationale and worked detail behind the PhanesLight agent operating model -->
<!-- DOC DISCIPLINE | Soft ceiling: 500 lines. One topic per file; structure under ## headings.
     The DOC line above feeds `phaneslight doc-index`, keep it accurate; it is this file's line in _index.md.
     If this file exceeds the ceiling: split it into a same-named folder of focused topic files;
     carry both header lines into every part; update every inbound reference in the same change set;
     finish by running `phaneslight doc-index`.
     Consumers: NEVER bulk-read documentation folders, read _index.md first, load only what you need.
     Audit: `phaneslight doc-check`. -->

# PhanesLight Agent Operating Model — Rationale and Worked Detail

`CLAUDE.md` §15 is the **binding** statement of the agent lineup, escalation ladder, tier triage,
visual-evidence mandate, documentation navigation rule and script surface. This file carries the
**non-binding rationale** behind those rules — the "why" that was previously inlined in §15 and was
moved here on 2026-09-19 to restore working headroom in the hot file.

Nothing here creates, relaxes or overrides an obligation. Where this file and `CLAUDE.md` §15
disagree, **§15 governs**; and where §15 and AFLDB `CLAUDE.md` §1–§14 disagree, **§1–§14 govern**
(the `pinned:project` deviation block at the top of `CLAUDE.md`).

## 1. Why engagement defaults to *not* engaging

Stock PhanesLight treats tiered dispatch as the normal path. AFLDB does not: `CLAUDE.md` §1 sets
"zero subagents" as the default, and the bootstrap recorded an owner-authorised deviation
preserving that. The five-step threshold (`orchestratorStepThreshold` in
`.phaneslight/config.json`) exists so engagement is a *measured* decision rather than a judgement
call, and ambiguity resolves against spawning. AFLDB sessions are deliberately narrow and
context-disciplined; a team that engaged on ambiguity would spend the session's context budget on
coordination rather than on work.

When the orchestrator *is* engaged on a plan, the main session stays slim on purpose: it reads the
step list once for structure, builds the todolist, handles the spawn and the close, and lets the
orchestrator own the steps. Duplicating the orchestrator's reading in the main session defeats the
reason for spawning it.

## 2. Why the write column is prose-enforced, and what actually catches a violation

The agent frontmatter `tools:` field can grant or withhold a tool, but it **cannot scope `Write` or
`Edit` to a path**. `afldb-mechanic` must write documentation, so it necessarily holds the same
write toolset as `afldb-worker` despite §15's "NEVER code". Nothing mechanically stops it editing
`src/`.

What catches it is a two-part contract:

1. **Universal disclosure.** Every agent names every file it edited, at every tier. A T1 mechanical
   edit is still named in its report.
2. **Closure reconciliation.** `afldb-closure` compares what was *applied* against what was
   *intended*, re-deriving the API baseline itself rather than trusting a producer's self-report.

This is why an **undisclosed edit is drift, not an oversight**: disclosure is the only mechanism the
harness leaves. By contrast, **spawn grants and model selection *are* mechanically enforced** — only
`afldb-orchestrator` and `afldb-reviewer` list `Agent` in their tools, so the "may spawn" column
cannot be violated by a misbehaving prompt.

## 3. Why nesting cannot run away

No agent is ever forked; every spawn carries a self-contained brief. Because only two roles hold a
spawn grant, and `afldb-orchestrator` may be spawned by the main session alone, the maximum nesting
depth is three levels below the main session **by construction** rather than by a counter anyone has
to maintain:

```text
main session -> orchestrator -> reviewer -> worker | mechanic
```

The rule "no agent may invoke `afldb-orchestrator`" is what closes the cycle; without it a reviewer
could re-enter the orchestrator and the bound would not hold.

## 4. Why domain expertise is not baked into the agent files

The five generated agent definitions are deliberately free of AFLDB domain knowledge — no NL-search
pipeline stages, no club-lineage rules, no migration ordering. Baking that in would create a second,
silently-drifting copy of material that already lives in `CLAUDE.md`, `docs/`, the `documentation/`
slices and the module registry files.

Instead the orchestrator **composes** the expertise a task needs, index-first, and injects it into
each spawn prompt. A spawned agent therefore reads exactly the slice its task requires, and there is
exactly one authoritative copy of every domain fact.

## 5. Why the mechanic escalates one grade lower than the worker

The worker escalates MED and above; the mechanic escalates LOW and above. The asymmetry is not a
trust judgement — it follows from write rights. A worker holding a LOW finding inside its dispatched
scope can simply fix it, so escalating would be noise. A mechanic may never write code, so it cannot
absorb even a trivial code fix; a LOW finding it holds would otherwise be silently dropped.

MED never reaches `afldb-reviewer`. The orchestrator handles MED itself because the reviewer is the
project's most expensive reasoning tier, reserved for findings whose blast radius justifies a plan.

## 6. Tier triage — the boundary cases

Two conditions promote a nominally single-file change out of **T1**, and both are easy to miss:

- **Exported API surface.** A single-file change that alters an exported symbol is a T2 change, not
  a T1 one, because the registry baseline and its consumers are now in scope.
- **Live external state.** A change that can only be verified against a running service or a live
  database is T2 or above. Note that **no agent in this lineup holds a database capability at all**:
  verifying live DB state is a user-executed command under `CLAUDE.md` §9, and the promotion exists
  so the requirement surfaces at triage rather than mid-step.

T1 also caps at **one** agent — the orchestrator alone, or a single mechanic — including on UI
tasks, where the temptation to pair a writer with a capture agent is strongest.

## 7. Visual evidence — what capture actually runs

Capture uses **this repository's own Playwright install** via `npx`; no browser MCP is granted to
any agent. The three tracked configurations are:

| Config | Used for |
|---|---|
| `playwright.config.ts` | general UI capture |
| `playwright.nl-stress.config.ts` | NL search runtime/stress runs |
| `playwright.admin-nav.config.ts` | admin navigation journeys |

Where capture is unavailable or returns empty frames, the obligation is to **diagnose why**, record
it in `.phaneslight/config.json` `capabilities.failures[]` and in the session summary together with
an explicit user-eyeball request, and proceed marked `VISUAL: UNVERIFIED`. The design intent is that
a chain never blocks on missing tooling and never silently passes a visual either — which is why
prose approval ("looks good", "should render correctly") is forbidden as approval grounds. Only a
captured image or an explicit `VISUAL: UNVERIFIED` flag exists.

## 8. Capability grants — what was declined and why it stays declined

The **Installed Capability Register** in `CLAUDE.md` §15 is generated and regenerated by every
PhanesLight run; it is not hand-edited. It records what each grant matched and what the fallback is
when the grant is unavailable.

Two points that are easy to lose:

- `afldb-reviewer` holds `semble` (for blast-radius enumeration during plan review) but **no**
  `context7`. A finding that turns on external library behaviour therefore goes to the orchestrator
  *in the plan*, never guessed by the reviewer.
- `serena`, `deepwiki`, the `playwright` MCP and `codebase-memory-mcp` were **deliberately not
  granted**. The rationale is recorded in session summary `SS00001`; do not re-grant without a new
  operator decision.

## 9. The API baseline is not documentation

`.phaneslight/registry/` is `afldb-closure`'s diff substrate and the data source for `list-apis`. It
is **not** agent reading material and it is not part of the `documentation/` tree. It covers `.ts`,
`.tsx` and `.sql` only, and every slice records what it did **not** examine — so a zero entry count
means "nothing was scanned here", never "there is no surface here".

## 10. Workflows never redefine routing

`.claude/workflows/*.yaml` codifies task *sequences*. `CLAUDE.md` §15's lineup, write rights, spawn
grants and severity ladder govern *routing*. A workflow file that disagrees with §15 on routing is
the defect, and is corrected in the workflow, not in §15.

## 11. The script surface

`CLAUDE.md` §15 carries the two binding rules — invoke as `node .phaneslight/scripts/cli.js <cmd>`
(a bare `phaneslight` is on no shell's PATH), and `new-file` is the only sanctioned file creation.
**Listing a script anywhere is not standing authorisation to run it**; authorisation is per task,
from the user, under `CLAUDE.md` §9. The full surface, which `cli.js` with no arguments also
prints:

| Command | Purpose |
|---|---|
| `new-file <module> <path> "<desc>"` | The only sanctioned file creation. Refuses a description under five words. Header selection is by destination: any `.md` under the configured `docRoot` gets the DOC DISCIPLINE header and triggers a doc-index regeneration. |
| `loc-check` | File-length hygiene against the configured ceiling. |
| `doc-check` | Documentation hygiene audit over `documentation/`. |
| `doc-index` | Regenerates every `_index.md`. The only correct way to change one. |
| `register-check` | Measures the hot files (`CLAUDE.md`, `CLAUDE.local.md`) in characters against the budget. |
| `module-list` | The configured module list. |
| `list-apis <module>` | Reads the API baseline for one module. |
| `regen-registry [module]` | Rebuilds the `.phaneslight/registry/` baseline. |
| `api-diff <ref> [module]` | Diffs the current API surface against a Git ref — closure's substrate. |
| `repo-manifest` / `manifest-write` | Repository manifest capture. |
| `census-diff` | Compares a fresh census against the recorded manifest. |
| `batch-apply` | Applies a prepared batch of edits. |
| `ledger` | The PhanesLight run ledger. |
| `preflight` / `update-preflight` | Pre-run environment and template-version checks. |
| `install-templates` / `scaffold` | Installation-time only. |

### The API baseline is closure's substrate, not reading material

`.phaneslight/registry/` is the diff substrate for `api-diff` and the data source for `list-apis`.
It is **not** agent reading material and **not** part of the `documentation/` tree. It covers `.ts`,
`.tsx` and `.sql` only, and every slice records what it did **not** examine — so a zero entry count
means "nothing was scanned here", never "there is no surface here". `afldb-closure` is its sole
writer.
