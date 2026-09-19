<!-- DOC | Archived digest of the PhanesLight bootstrap project closed 2026-09-19 -->
<!-- DOC DISCIPLINE | Soft ceiling: 500 lines. One topic per file; structure under ## headings.
     The DOC line above feeds `phaneslight doc-index`, keep it accurate; it is this file's line in _index.md.
     If this file exceeds the ceiling: split it into a same-named folder of focused topic files;
     carry both header lines into every part; update every inbound reference in the same change set;
     finish by running `phaneslight doc-index`.
     Consumers: NEVER bulk-read documentation folders, read _index.md first, load only what you need.
     Audit: `phaneslight doc-check`. -->

# PhanesLight bootstrap, archived 2026-09-19
- Outcome: Installed v3.7.2 additively onto AFLDB's existing operating contract; five-agent roster, nine workflows, script library, API baseline and documentation tree in place. AFLDB CLAUDE.md §1–§14 retain precedence.
- Active: 2026-09-19, 2026-09-19
- Plan: none (the `/phaneslight:run` skill was the contract)
- SS range: SS00001, SS00001
- Durable decisions: additive install with AFLDB precedence, recorded as four owner-authorised deviations in the `pinned:project` namespace which no future run may rewrite; MCP partial consent (context7 + semble installed, serena + deepwiki declined, do not re-offer); no browser MCP, visual capture uses the repo's own Playwright; 16 modules derived from CLAUDE.md §6/§7; `.gitignore` amended so the generated roster under `.claude/` is tracked while run state and CLAUDE.local.md are not.
- Discharged blockers: `.claude/` was gitignored wholesale, which would have made the requested commit a no-op (fixed with `.claude/*` plus negations); the worktree had no node_modules, so the baseline ran degraded on the regex fallback (fixed by junctioning a sibling worktree after verifying package-lock parity).
- Gotchas for future work: a trailing-slash gitignore pattern stops git descending, so no `!` negation beneath it can ever fire; the API baseline covers .ts/.tsx/.sql only and a zero entry count means "not extracted", never "no surface" (88 Python files are genuinely uncovered); CLAUDE.md sits at 33,852 of 35,000 chars with ~1,150 headroom; docs/architecture.md §5/§6 describe src/services, src/db/schema (Drizzle) and src/types, none of which exist (now tracked as AFLDB-ISSUE-226).
- Closure corrections (2026-09-19, commit follows a59917a4): two claims in the original digest were wrong and are withdrawn. (1) The node_modules junction to afldb-issue-219 was removed and replaced with an independent `npm ci` install, so nothing in this worktree now depends on a sibling. (2) The digest claimed plugin-registered hooks are live in the current session rather than deferred to the next. That inference was unsound: the operator restarted Claude Code after installing the plugin and before running /phaneslight:run, so hook-stamp-guard firing during the bootstrap proves only that it was loaded at THAT session's start. It is not evidence that hooks activate without a restart. The specification's restart notice stands. Corroborating evidence found during closure: the newly generated `afldb-closure` agent was NOT invocable in the generating session ("Agent type not found"), because agent definitions are snapshotted at session start exactly as hooks are. Newly generated project state — hooks, agents, and hook-ledger-status in particular — requires a restart before it is live.
