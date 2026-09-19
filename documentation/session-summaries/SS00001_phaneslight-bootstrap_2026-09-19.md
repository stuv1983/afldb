<!-- DOC | Bootstrap run that installed the PhanesLight agent team and project memory infrastructure -->
<!-- DOC DISCIPLINE | Soft ceiling: 500 lines. One topic per file; structure under ## headings.
     The DOC line above feeds `phaneslight doc-index`, keep it accurate; it is this file's line in _index.md.
     If this file exceeds the ceiling: split it into a same-named folder of focused topic files;
     carry both header lines into every part; update every inbound reference in the same change set;
     finish by running `phaneslight doc-index`.
     Consumers: NEVER bulk-read documentation folders, read _index.md first, load only what you need.
     Audit: `phaneslight doc-check`. -->

# SS00001 — PhanesLight bootstrap

**Date:** 2026-09-19 · **Run type:** initial setup · **PhanesLight:** v3.7.2 · **Slug:** `afldb`
**Worktree:** `D:\dev\afldb-phaneslight` · **Branch:** `opus/phaneslight-bootstrap`
**Previous summary:** none — this is the first.

## What was done

**Phase 0 — pre-flight.** Version reconciled (skill v3.7.2 == template manifest v3.7.2). No
`.claude/.phaneslight` marker, no `.phaneslight/`, no `documentation/`, no legacy `.phanes/`
markers, no pre-existing `.claude/agents/` → clean initial setup, no anomaly. Marker created (`0`,
later `1`). Run-progress ledger opened.

**Phase 1 — comprehension.** AFLDB: public historical AFL/VFL statistics database. Next.js 16.3.1
App Router + React 19 + TypeScript over PostgreSQL via postgres.js. 1,442 tracked files
(563 `.ts`, 254 `.tsx`, 179 `.md`, 122 `.sql`, 88 `.py`). UI surface: yes. API surface: yes
(route handlers; **no OpenAPI or GraphQL SDL exists**). Module boundaries taken from `CLAUDE.md`
§6's own repository map rather than rediscovered.

**Phase 2 — CLAUDE.md.** Pinned Directives block added at the top, carrying `pinned:phaneslight`
(generated) and `pinned:project` (owner-owned). `CLAUDE.md` §15 "PhanesLight Agent Team" added
before the auto-regenerated Next.js block. `CLAUDE.local.md` register created (gitignored).

**Phase 2.5 — infrastructure.** Template library installed (27 files, all stamp-verified, both
smoke tests passed). Documentation and test trees scaffolded merge-never-overwrite (14 created,
5 existing test folders left untouched). `regen-registry` and `api-diff` authored (they are
`generatedNotFetched` — language-specific, so no template exists), sharing a `registry-lib.js` so
the baseline and the diff can never be computed by two divergent implementations. API baseline
populated: 17 slices, `tsc-api` extractor. 16 registry annotation files created, deliberately empty.
Architecture snapshot written.

**Phase 3 — workflows.** Nine workflows in `.claude/workflows/`: four change-type
(`nl-search-defect`, `db-schema-change`, `admin-mutation`, `import-migration`), one mandatory
`ui-change` (UI surface detected), one wrapper (`issue-lifecycle`), and three recurring-maintenance
(`backlog-triage`, `audit`, `snapshot-refresh`).

**Phase 4 — roster.** The fixed five generated and contract-verified: `name` == filename stem,
models match §IV exactly, every description under the 50-word cap (37–44 words).

## Decisions taken

1. **Command execution authorised for this run** (operator), including the commit. `CLAUDE.md`
   §9/§12 resume immediately afterwards, and every generated agent carries that boundary explicitly.
2. **Additive installation, AFLDB precedence.** PhanesLight did not replace the existing operating
   contract. Four owner-authorised deviations are recorded in the **`pinned:project`** namespace,
   which no future run may rewrite: AFLDB §1–§14 govern on conflict; §1's zero-subagent default
   still binds the primary; §9/§12 bind every agent; issue tracking stays in `issues.md` /
   `IssuesIndex.md` / `CHANGELOG.md` and `documentation/` is working memory, not a ledger.
3. **MCP: partial consent.** Installed `context7` (matched: Next.js 16.3.1 / React 19 APIs postdate
   training data) and `semble` (matched: 1,442-file TS codebase; two tools of schema). **Declined**
   `serena` — despite TypeScript being a covered language, semble already holds the code-discovery
   slot — and `deepwiki`, the dependency set being small and well-known. Recorded in
   `mcpConsent`; **do not re-offer without a new operator decision.**
4. **No browser MCP.** The `playwright` MCP was available and was **not** granted: the repository's
   own Playwright install is the leaner path and is already proven by `tests/nl-ui/` and
   `tests/admin-nav/`. `codebase-memory-mcp` was not granted either — it overlaps semble and its
   ~17 tools fail the proportionality test against semble's 2.
5. **`frontend-design` plugin installed** (user scope). Zero context cost until invoked.
6. **`.gitignore` amended.** `.claude/` was ignored wholesale, which would have left the entire
   generated roster untracked and made the requested commit a no-op. Changed to `.claude/*` plus
   negations (`agents/`, `workflows/`, `template/`, `.phaneslight` marker) — a trailing-slash
   pattern stops git descending, so no negation beneath it can fire. `settings.local.json` stays
   ignored. Also ignored: `.phaneslight/` run state (`run-progress`, `returns/`, `registry/`,
   `inventory/`) and `CLAUDE.local.md`.
7. **16 modules**, derived from `CLAUDE.md` §6/§7 rather than invented. `tools-ops` is a deliberate
   grab-bag of eight small operational directories; split it if any one grows.
8. **`node_modules` junctioned** from `D:\dev\afldb-issue-219` after verifying `package.json` **and**
   `package-lock.json` are byte-identical (typescript 5.9.3). Without it the baseline ran on the
   regex fallback and was measurably worse (e.g. `db` 1160 → 1181 entries, `tools-db` 298 → 311).
   This is this repo's documented worktree practice, and it is reversible — delete the junction.

## Findings

**F-001 · MED · `docs/architecture.md` §5 (and §6) have drifted from the tracked tree.**
§5 describes `src/services/`, `src/db/schema/` ("Drizzle schema") and `src/types/`. **None exist**,
and there is **no drizzle dependency** — the project uses postgres.js directly. Verified three ways:
`git ls-files src` (top level is exactly `app`, `components`, `db`, `lib`, `search`, `styles`,
`middleware.ts`), `git ls-files src/db` (exactly `authClient.ts`, `client.ts`, `migrations/`,
`queries/`), and an import search finding no reference to `@/services` or `@/types`. §6's "defined
once in `src/services`" rests on the same premise.
**No change was made to `docs/architecture.md`** — correcting it is outside a bootstrap's scope and
is the operator's to route. Recorded in the snapshot at
`documentation/architecture/2026-09-19_initial/overview.md` §5.

**F-002 · INFO · `CLAUDE.md` is at 33,852 / 35,000 chars.** Under the soft limit, but roughly 1,150
chars of headroom. The Pinned Directives block (4,534 chars) is crop-exempt. Future runs regenerate
`pinned:phaneslight` in place rather than appending, so this should stay stable — but it is close
enough to warrant watching. No action taken; trimming would have cost binding text.

**F-003 · INFO · 343 files exceed the 500-line soft LOC ceiling.** Pre-existing across a mature
codebase. The ceiling is **soft and advisory** (`loc-check` exits 0 by design). This is a baseline
observation, **not a work order** — lazy digestion applies: a file is split when its single writer
next legitimately touches it, never in a bulk pass.

## Open TODOs

- [ ] **Restart the Claude Code session** to arm the hooks (see sign-off).
- [ ] Route **F-001** (`docs/architecture.md` §5/§6 drift) through the operator's issue process.
- [ ] Decide whether Python (88 files: `tools/migration` 33, `tools/rebuild` 28, `tools/aflw` 3,
      `tools/email_intake` 2) warrants a baseline extractor, or is deliberately out of drift scope.
      Today those slices read `0 entries` with an explicit `coverageNote` saying why.
- [ ] Replace the bootstrap architecture snapshot at the next milestone — run `snapshot-refresh`.
      It is scaffolding and says so in its own first paragraph.
- [ ] `documentation/registry/*.md` are intentionally empty. They grow only from confirmed
      annotations; pre-filling them with guesses would poison the strongest anti-hallucination
      signal in the system.
- [ ] `node_modules` is a junction to a sibling worktree. If `afldb-issue-219` is removed or
      rebuilt, re-junction or `npm install` before running anything.
- [ ] Optional git pre-commit `loc-check` hook was **not** installed (declined by default given 343
      pre-existing offenders). Install later if wanted.

## Unmatched capability inventory

Detected and deliberately **not** wired — recorded here, never in `CLAUDE.md`, because every
register line is permanent context. None could complete the sentence "granted because this project
has ___" from Phase 1 findings:

`claude.ai Claude Docs`, `claude.ai Google Drive`, `cowork-plugin-management`, `customer-support`
(plugin), and six customer-support MCP servers (`slack`, `intercom`, `hubspot`, `guru`,
`atlassian`, `notion`) — all of which were additionally **unreachable** (needs-auth or failed
connection), and an unreachable capability can never be mandated.

**Foreign assets — never overwritten, regenerated or rostered:** `.agents/skills/` (22
AFLDB-authored skills) and `AGENTS.md`. These are the user's.

## Fan-out ledger

| Phase | Agents spawned | Peak in flight |
|---|---|---|
| 0–5 (all) | **0** | **0** |

The bootstrap ran as one continuous task in the primary session. `CLAUDE.md` §1 sets zero subagents
as the default and nothing here met the bar for an exception.

## References

- `.phaneslight/config.json` — module list, extractors, capability selection, MCP consent
- `.phaneslight/manifest.json` — every installed artifact with sha256 provenance
- `documentation/architecture/2026-09-19_initial/` — snapshot (overview + 16 module stubs)
- `.claude/agents/` — the five generated agents
- `.claude/workflows/` — seven workflows
- `CLAUDE.md` — Pinned Directives (top) and §15; `CLAUDE.local.md` — the register
