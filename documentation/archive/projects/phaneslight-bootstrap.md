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
- Gotchas for future work: a trailing-slash gitignore pattern stops git descending, so no `!` negation beneath it can ever fire; the API baseline covers .ts/.tsx/.sql only and a zero entry count means "not extracted", never "no surface" (88 Python files are genuinely uncovered); `node_modules` is a junction to afldb-issue-219 and breaks if that worktree is removed; CLAUDE.md sits at 33,852 of 35,000 chars with ~1,150 headroom; docs/architecture.md §5/§6 describe src/services, src/db/schema (Drizzle) and src/types, none of which exist (F-001, unrouted); plugin-registered hooks are live in the CURRENT session, not deferred to the next one.
