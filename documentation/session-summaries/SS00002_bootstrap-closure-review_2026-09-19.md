<!-- DOC | Pre-merge closure review of the PhanesLight bootstrap commit and its corrections -->
<!-- DOC DISCIPLINE | Soft ceiling: 500 lines. One topic per file; structure under ## headings.
     The DOC line above feeds `phaneslight doc-index`, keep it accurate; it is this file's line in _index.md.
     If this file exceeds the ceiling: split it into a same-named folder of focused topic files;
     carry both header lines into every part; update every inbound reference in the same change set;
     finish by running `phaneslight doc-index`.
     Consumers: NEVER bulk-read documentation folders, read _index.md first, load only what you need.
     Audit: `phaneslight doc-check`. -->

# SS00002 — PhanesLight bootstrap closure review

**Date:** 2026-09-19 · **Scope:** pre-merge closure review of `a59917a4` · **Previous:** SS00001
**Authorisation:** operator-granted for this bootstrap only — safe shell/Git inspection, validation,
tests, scripts; one follow-up commit; no push, no merge, no deploy, no SSH, no database.
**`CLAUDE.md` §1–§14 resume in full after this closure.**

## 1. External dependency removed

The bootstrap left `node_modules` as a **directory junction** to `D:\dev\afldb-issue-219`, making
this worktree dependent on a sibling. Removed and replaced with an independent install.

- Confirmed junction first: `Get-Item .\node_modules` → `LinkType: Junction`,
  `Target: D:\dev\afldb-issue-219\node_modules`.
- Removed with **`cmd /c rmdir node_modules`** — deletes the reparse point only.
  `Remove-Item -Recurse` was **not** used: it follows the link and would have destroyed the sibling
  worktree's `node_modules`.
- Verified the target survived: `afldb-issue-219\node_modules\typescript` still resolvable.
- `npm ci` → 419 packages. `Get-Item .\node_modules` now reports **no `LinkType`** (real directory);
  `typescript` 5.9.3 resolves locally.
- **`package-lock.json` unchanged** — `git hash-object` identical before and after
  (`08313e05fa7f059db1381d93322f83b0fad2fcc4`); `git status` clean for `package.json` and the lock.

**Nothing in this worktree now depends on another worktree or on this machine.**

## 2. Validation re-run on the independent dependencies

Every check below was run after the junction was removed.

| Command | Result |
|---|---|
| `cli.js preflight` | `runType: update`, version 3.7.2, `rootSource: config`, `censusUnreadable: []`, no legacy markers |
| `cli.js update-preflight --spec-version 3.7.2` | **manifest: 34 checked, 0 drifted, 0 missing**; hooks: all 3 scripts present, no stale project entries; register OK/OK; modules 16; spec 3.7.2==3.7.2; `worktreeDirty: false` |
| `cli.js regen-registry` | 17 slices, extractor **`tsc-api`** (not degraded) — counts **identical** to the junctioned run, proving no degradation |
| `cli.js api-diff a59917a4` | **added 0, removed 0, changed 0** across 17 slices |
| `cli.js doc-index` ×2 | 25 index files; `git status` clean afterwards → **idempotent** |
| `cli.js doc-check` | `OK` |
| `cli.js register-check` | `CLAUDE.md` 33,852 `[OK]`; pinned block 4,534; `CLAUDE.local.md` 3,051 `[OK]` |
| `cli.js loc-check` | 343 over the 500-line soft ceiling — **pre-existing, advisory, exit 0** |
| `cli.js list-apis search` | 412 entries, `tsc-api`, `degraded: false` |
| `cli.js module-list` / `--all` | 16 modules; `--all` adds `tests`, `docs` |
| `cli.js census-diff`, `repo-manifest` | ran clean; `repo-manifest` 1,436 tracked, 0 changed, 0 stale |
| `npx tsc --noEmit` | **exit 0, no output, 23s** |
| Hook functional tests (7 payloads) | see below |

**DB-backed integration tests were deliberately NOT run** (operator instruction). Note the bootstrap
and this closure changed **zero application source** — `api-diff` reports 0 changes across all 17
slices — so no test outcome can have been altered by either commit.

**Hook smoke tests** (real JSON payloads piped to each hook):

| Case | Expected | Actual |
|---|---|---|
| New unstamped `.md` under `documentation/` | deny | **exit 2** + guidance message |
| New *stamped* `.md` under `documentation/` | allow | exit 0 |
| New file outside stamped trees (`tools/`) | allow | exit 0 |
| Edit of an existing tracked file | allow | exit 0 |
| File in an **unrelated project** (`C:\Windows\Temp`) | no-op | **exit 0** — the `Find-PhanesLightRoot` refusal holds |
| `hook-ledger-status`, ledger CLOSED | silence | exit 0, no output |
| `hook-size-check` on a hot file | advisory | exit 0 + register line |

All three hooks guard on `[Console]::IsInputRedirected`, so a manual run cannot hang.

## 3. Portability and leakage audit

Scanned all **117** files of `a59917a4`, plus the closure's own changes.

- **Secrets / DSNs / tokens / keys: none.** No `postgres://`, no `-----BEGIN`, no bearer/api-key
  assignments, no `ghp_`/`sk-` patterns.
- **Absolute paths in scripts: none.** `regen-registry.{js,ps1,sh}`, `api-diff.{js,ps1,sh}` and
  `registry-lib.js` are all root-relative. `cli.js` dispatches via `__dirname`, and project root is
  found by walking up for `.phaneslight/config.json` — verified by running `cli.js` from a foreign
  cwd, which correctly refuses rather than guessing.
- **Absolute paths in agents / workflows / config: none.**
- **Worktree references in tracked bootstrap content:** only two, both in prose records, neither a
  dependency — SS00001's header (`Worktree: D:\dev\afldb-phaneslight`, provenance of a frozen
  record) and SS00001's junction decision note. The **archive digest's** claim that `node_modules`
  is a junction was live and is now **false**, so it was corrected (§5 below).
- Pre-existing `D:\dev` references in `.agents/skills/`, `issues/closed/` and `AFLDB-ISSUE-219.md`
  are **not** bootstrap content and were left untouched.

## 4. Hook interpretation corrected

SS00001 was **already correct** ("Restart the Claude Code session to arm the hooks"). The error was
confined to the archive digest and to the closing chat report, both of which claimed the
specification's restart notice was wrong because `hook-stamp-guard` fired during the bootstrap.

**That inference was unsound.** The operator restarted Claude Code after installing the plugin and
**before** running `/phaneslight:run`, so the hook firing proves only that it was loaded at *that*
session's start. It is not evidence that hooks activate without a restart.

**Corroborating evidence found during this closure:** the newly generated `afldb-closure` agent was
**not invocable in the session that generated it** — `Agent type 'afldb-closure' not found`. Agent
definitions are snapshotted at session start exactly as hook configuration is. The restart
requirement stands for **all** newly generated project state: hooks, agents, and
`hook-ledger-status` in particular, which has never yet run.

## 5. Documentation ownership reconciled

Added **`documentation/README.md`**: a concise authority statement establishing that the tree is
PhanesLight *operational memory*, not a competing source. It carries an explicit authority table —
`issues.md`/`IssuesIndex.md` own tracked work, `docs/` owns architecture, `CHANGELOG.md` owns
product change, `CLAUDE.md` §1–§14 own agent operation — and states that on conflict the AFLDB
source wins and the file here is the defect. The one thing the tree legitimately owns is
`registry/<module>.md`, because nothing else records module contracts.

**No existing AFLDB record was copied, moved or restated into `documentation/`.**

## 6. F-001 routed as AFLDB-ISSUE-226

**The next available number was NOT the highest number mentioned.** `AFLDB-ISSUE-226` and `-227`
appear in `issues.md` **only inside a sentence recording that they do not exist** (the ISSUE-222
§7.4 status correction). A max-numeric-mention scan would have allocated 228 and left two phantom
gaps. Verified with `git grep AFLDB-ISSUE-226` → that one sentence only. **226 allocated; 227
remains free.** The new entry notes this explicitly so the older sentence does not confuse a reader.

Recorded in `issues.md` (Open Issues row + full detailed entry) and `IssuesIndex.md`, following
existing conventions. Severity **Low** on AFLDB's product-impact scale, with the mapping from
PhanesLight's MED grade explained in the entry. `docs/architecture.md` was **not** corrected.

The entry deliberately does **not** assert where the §6 shared statistical definitions now live —
only that they are not in `src/services/`, because that path does not exist.

## 7. Findings reported but NOT fixed

| ID | Grade | Finding |
|---|---|---|
| F-002 | MED | **SUPERSEDED by SS00003 — the index was NOT incomplete: AFLDB-ISSUE-222 and -223 are resolved, and their removal from the index is §5’s resolved-issue convention. The stale rows were in `issues.md`’s table, now removed; both files read 4** **`IssuesIndex.md` is incomplete.** It declared 4 open issues while holding only **3** entries, and `issues.md` authoritatively lists 6 (after 226). Missing: **AFLDB-ISSUE-222** and **AFLDB-ISSUE-223**. Not reconciled: writing index entries for two complex issues this session has not investigated risks misrepresenting them, and a wrong index entry is worse than a missing one. A visible warning note was added to the index instead, naming both, per §5's "`issues.md` is authoritative". |
| F-003 | MED | **SUPERSEDED by SS00003 — the row was stale and has been removed; the true open count is 4, not 5** **`AFLDB-ISSUE-223` is marked `Resolved 2026-09-19` in its detailed entry but still has an Open Issues table row.** Commit `a76a2088` carries its fix. If that row is simply stale, removing it brings the authoritative open count to 5. Operator's call — not resolved here. |
| F-004 | INFO | **Issue-number allocation trap** (see §6). Any future allocation must exclude numbers that appear only in existence-denying prose. |
| F-005 | INFO | `census-diff` reports `serena` and `deepwiki` as *removed* on every run, because `.phaneslight/config.json` records them in `capabilities.selection[]` as declined-and-never-installed. Harmless and arguably correct — the record of the decline is worth keeping — but expect the noise. |
| F-006 | LOW | **`.phaneslight/manifest.json` covers 34 artifacts (scripts, hooks, templates) but not the generated agents, workflows or doc scaffolds.** The specification says the manifest should list every generated file so future upgrades are mechanical. `manifest-write` as shipped scans only the script and template install paths. Upstream script behaviour, not a bootstrap defect; recorded so a future upgrade does not assume agent/workflow provenance is tracked. |
| F-007 | INFO | **SUPERSEDED by SS00003 — `CLAUDE.md` was compacted to 32,974 chars, 2,026 headroom** `CLAUDE.md` is 33,852 of 35,000 chars — **1,148 headroom** to the soft limit, 6,148 to the 40,000 crop trigger. The 4,534-char pinned block is crop-exempt. Future runs regenerate `pinned:phaneslight` in place rather than appending, so this should stay stable; worth watching. |
| F-008 | INFO | 343 files exceed the 500-line soft LOC ceiling. Pre-existing, advisory (`loc-check` exits 0 by design). Lazy digestion applies — never a bulk pass. |

## 8. Independent review

`afldb-closure` could not be invoked (see §4 — not loadable in the session that generated it). Per
the degradation posture, the substitution is recorded rather than silently made: the same closure
brief was dispatched to a `general-purpose` agent under read-only rules. Its findings are recorded
in §9.

## 9. Independent reviewer findings and dispositions

The reviewer ran read-only and re-derived its own facts. **Every claim below was independently
re-verified by this session before being acted on** — two did not survive that check.

### Confirmed and FIXED

| Ref | Grade | Finding | Disposition |
|---|---|---|---|
| H-1 | HIGH | **`issue-lifecycle.yaml`'s `governs` block omitted §9/§12** — and it is the workflow with the most command surface (worktree creation, branch naming, `preflight`, `merge:ready`, `sync-dev.ps1`). Only its `commit` step restated the boundary, which reads as "git is the special case, the rest is executable". | Verified: 4 of 9 workflows omitted §9 (`issue-lifecycle`, `audit`, `backlog-triage`, `snapshot-refresh`). **All four now carry it**; `issue-lifecycle`'s says the boundary applies to every step, not only `commit`. **9/9 verified.** |
| H-2 | HIGH | The three recurring-maintenance workflows normalise unrequested, self-triggering work — including subagent dispatch — against §14 ("Then stop. Do not automatically begin another investigation"), §1, and `pinned:project` deviation 2. | Valid tension: the PhanesLight spec *requires* maintenance workflows; AFLDB forbids self-started work. Resolved by adding an **`engagement:` block** to all three: the `trigger` names conditions under which the pass is worth **proposing**, and explicitly does not authorise starting one. Offer, never self-start. |
| M-2 | MED | **False claim:** the snapshot said "122 migrations" / "`migrations/` (122 ordered SQL)". | **Confirmed — my error.** `git ls-files src/db/migrations \| grep -c '\.sql$'` = **102**; 122 is the repo-wide `.sql` count. Both occurrences corrected; the stack line now distinguishes the two numbers explicitly. |
| M-5 | MED | `afldb-closure.md` declares "you write **exactly four things**" but its own duty 7 writes `reports/ui-evidence/` and `capabilities.failures[]` — six targets, and `reports/ui-evidence/` was **not gitignored**, so captures would land as untracked noise on every UI task. | Confirmed both. Table extended to **six** with each extra justified; `/reports/ui-evidence/` added to `.gitignore` as reproducible output (same reasoning as `/artifacts/`). |
| M-6 | MED | `ui-change.yaml` routes `design`/`apply` to the worker and `capture` to closure at **every** tier including T1, but §15's T1 row allows "Orchestrator alone, or one mechanic". A T1 tweak would spawn two subagents. | Confirmed. Added a **`tier_note:`**: the `agent:` labels name the owning role, not a mandatory dispatch; at T1 the orchestrator does all three itself and spawns nothing. Dispatch begins at T2. §15's T1 row now also says "never two agents". |
| M-4 | MED | Models, spawn grants and escalation thresholds conform exactly, but **`tools:` cannot encode the write restriction** — the mechanic holds the worker's write toolset despite "NEVER code". Nothing mechanically stops a haiku-tier agent editing `src/`. | Confirmed and **unfixable at the harness level** (no path-scoped tool grant exists). Recorded explicitly in §15 so no operator assumes mechanical enforcement: write rights are prose-enforced, caught by disclosure + closure reconciliation; spawn grants and models *are* mechanical. |
| L-1 | LOW | `SS00001:150` still read "seven workflows" while the same file's body and the commit message said nine. | Confirmed — I corrected one occurrence pre-commit and missed the References line. Now nine, with the correction noted inline. |
| L-3 | LOW | `admin-mutation.yaml` hardcoded "all **123** server actions" into a procedure followed precisely when that count changes. | Confirmed. Now instructs reading the live count from `list-apis api-contract`. |
| L-7 | LOW | `.phaneslight/config.json` `capabilities.granted` was `[]` while §15's register named three grants and `selection[]` marked exactly three `selected: true`. | Confirmed. Populated with all three, each carrying its `matched:` justification, agents, purpose and fallback. |
| L-6 | LOW | §15's T1 row referenced "a DB MCP query", but no DB capability exists in the register, in `config.json`, or in any agent's `tools:`. | Confirmed — inherited spec phrasing implying a capability that does not exist here. Reworded: no DB capability is granted, and verifying live DB state is a user-executed command under §9. |
| — | MED | **Found by this session, not the reviewer:** §15's register listed `semble` for orchestrator+worker, but `afldb-reviewer.md`'s frontmatter also grants it. | Register corrected to name the reviewer, with its rationale (blast-radius enumeration) and the deliberate absence of `context7`. |

### Confirmed, reported, NOT fixed

| Ref | Grade | Finding | Why not fixed |
|---|---|---|---|
| M-1 | MED | The archive digest is in `a59917a4` but no SS00001 intent covers it (`grep archive SS00001` → 0 hits), and §15 makes `afldb-closure` its sole writer while SS00001 records 0 agents spawned. | The write itself is **sanctioned**: `CLAUDE.local.md`'s close-out mandate says "where the run is small enough that closure has not been engaged, condense it yourself with the same template". The real defect is the **documentation gap** — SS00001 never mentioned Phase 5 or the digest. Recorded here rather than by editing a committed summary's narrative. |
| L-4, L-5 | LOW | `snapshot-refresh` and `import-migration` carry `run:` steps; `import-migration`'s dry run opens a real DB connection. | §9 now present in both `governs` blocks, which covers it. Listed for completeness. |
| I-1 | INFO | `.phaneslight/scripts/preflight.ps1` collides by **name** with AFLDB's own `npm run preflight` (`tools/dev/preflight.ts`) — unrelated tools. Nine shipped scripts appear in no enumerated list in §15. | Upstream naming, not a bootstrap choice. Renaming a shipped template script would break the manifest's sha256 provenance. Worth knowing; not worth breaking provenance over. |

### Rejected after verification

| Ref | Reviewer's claim | Why rejected |
|---|---|---|
| L-2 | "`CLAUDE.md` is 33,242 bytes LF / 33,977 on disk — neither is the stated 33,852, so the headroom is wrong." | **The reviewer compared BYTES to a budget defined in CHARACTERS.** `register-check`'s limits are explicitly character counts. `node -e 'readFileSync(...,"utf8").length'` → **33,852**, matching `register-check` exactly; 33,977 is the byte count inflated by CRLF line endings on a repo that is `autocrlf=true`. The original figure was correct. |
| H-3 | "The archive digest is unreachable: no `_index.md` exists under `documentation/archive/`, and glob-scanning to find it is forbidden." | **The exemption is by design, not an oversight.** `doc-index.ps1:99` contains `if ($name -eq 'archive') { return }` — archive is deliberately excluded from indexing as frozen history, and `doc-check` reports `OK`, so the commit message's "doc-check clean" is accurate. The reachability concern was nonetheless *real*, and is now answered: `documentation/README.md` (added this pass) names `archive/projects/` explicitly, giving a documented pointer that requires no glob scan. Downgraded to INFO, addressed. |

## 10. Verdict

**The bootstrap is portable and ready to merge**, after this pass's corrections.

- No tracked file depends on this worktree, another worktree, or this machine.
- No secrets, DSNs, tokens or absolute paths in any of the 117 bootstrap files.
- `npx tsc --noEmit` exit 0; API baseline non-degraded; `api-diff` 0 changes; `doc-check` OK;
  manifest 0 drifted, 0 missing; all 3 hooks behave correctly including the foreign-project no-op.
- Zero application source was changed by either commit.

**Standing risks the operator should carry forward:** `CLAUDE.md` at **34,714 / 35,000** leaves only
286 chars of headroom (F-007); `IssuesIndex.md` remains incomplete (F-002) and `AFLDB-ISSUE-223`'s
open/resolved state is unreconciled (F-003); write rights are prose-enforced only (M-4); and
**nothing generated by the bootstrap is live until Claude Code is restarted** — hooks, the five
agents, and `hook-ledger-status` in particular, which has never yet run.

> **Superseded in part by SS00003 (2026-09-19).** The restart happened: the `SessionStart` hooks
> ran successfully, `hook-ledger-status` correctly printed nothing against a `CLOSED` ledger, and
> all five agents are live. F-002 and F-003 were wrong in direction and are corrected there;
> F-007 is closed by the §15 compaction. The remaining standing risks stand.

