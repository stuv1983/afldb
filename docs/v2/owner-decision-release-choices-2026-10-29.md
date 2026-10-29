# V2 remaining release choices — 2026-10-29

**Production: NO-GO.** This record lists every release choice that remains open after gate 5. It authorises
nothing. Each choice needs its own explicit approval, worded for that choice alone.

Prepared in the Claude Code session of 2026-10-29 on `v2/rebuild`, immediately after
D-V2-CURRENT-ACCEPTANCE-RUN-1 ([record §10](owner-decision-current-rehearsal-2026-10-29.md)). Production was
not accessed and nothing was written on any host. Sources:
- the [release decision package](release-decision-package-2026-10-28.md) gate table, which stays the gate
  ledger;
- the [ordered release plan](production-release-plan-2026-10-21.md) steps 1–11;
- the [release requirements checklist](release-requirements-checklist-2026-10-20.md);
- [go/no-go](go-no-go.md) and [known gaps](known-gaps.md).

Identifiers already used in those records are kept: A-AFLT, A-BACKUP, A-REL, A-ROLLBACK, A-GO, D-316-*,
X-GRIDS-1 and C-CRED-1. The four new identifiers are marked *(new)*.

## 1. Where the release stands

| Done | Evidence |
|---|---|
| Gate 1: integrated V2 code verified on Linux | 14,888 passed / 3 failed (V2-GAP-029) / 63 skipped; rendered gate 1,844/1,844 ([Linux record](linux-verification-2026-10-28.md)) |
| Gate 4: current-production shadow | Archive `a4641ca0…`, only the expected 116/117 deltas ([report](current-production-shadow-2026-10-29.md), [follow-up](current-production-shadow-followup-2026-10-29.md)) |
| Gate 5: archive-bound acceptance, **measured** | D-V2-CURRENT-REHEARSAL-1, CURRENT-SCHEMA-1 and BROWNLOW-ALT-3 approved. The measured run gave evidence integrity, migration compatibility (`reasons: []`), backend functional and backend acceptance PASS, exit 0 ([report](evidence/current-rehearsal-acceptance-2026-10-29.json)) |

**Still open across every choice below.** None of these is waived:
- strict preservation and parity stay FAIL, and the staged Brownlow comparator stays INCOMPLETE;
- privileges integration is **42/43**, because the staging default privileges are absent. It must reach
  43/43 against the released state once A-REL executes them;
- production effective permissions, role attributes and object ownership have not been compared;
- V2-GAP-029 (149 strict / 99 approved / 50 unapproved) stays open as data-quality debt.

## 2. The choices, in release order

The order follows the plan: artifact lock (step 1), host and source prerequisites (steps 2–5), then the
window (steps 3–8). A choice may be approved early, but it cannot be **executed** before its prerequisites.

### Stage A pre-window: decisions with no production access

| # | Choice | Prerequisites | An approval would authorise | It would not authorise |
|---|---|---|---|---|
| 1 | **D-V2-RESIDUALS-1** *(new)*: accept the known residuals at artifact lock (gate 2, plan step 1). **APPROVED and recorded 2026-10-29** ([record](release-residuals-2026-10-29.md)): lint re-measured 508 / 136 | None for the decision. Before recording, the lint debt is re-measured at the candidate commit: the last count is 234 errors / 131 warnings, from 2026-10-20, and is stale | Recording these as **known and open** for the release artifact: the 3 strict Gridley failures (V2-GAP-029); the re-measured lint debt; `external-grids-import` NOT RUN because the archive is unavailable. Also the local lint measurement itself | Any waiver, skip, restatement or test change. GAP-029 stays open. A residual is not a pass |
| 1a | **X-GRIDS-1** (optional; [package §3.3](release-decision-package-2026-10-28.md)): a separately versioned fixture for the later Gridley snapshot `a56fef4e…` | Choice 1 is not blocked by it. Only needed if that coverage is wanted | A new opt-in test case pinned to that file by hash, with an independent, reviewed SQLite oracle. The owner also states whether its one board gap is accepted | Any change to the original 1,123-board case, which stays NOT RUN until the rescued archive is supplied |
| 2 | **D-V2-VISUAL-1** *(new)*: owner visual acceptance (V2-GAP-022, gate 3) | The owner reviews `docs/v2/evidence/launchF-visual/` against [admin-operations §6](admin-operations.md), screen by screen | Recording the owner's per-screen verdicts and closing or narrowing V2-GAP-022 accordingly. A rejected screen becomes a tracked defect | Any visual claim not made by the owner. Prose approval is not evidence |
| 3 | **D-V2-PUSH-1** *(new)*: push and merge `v2/rebuild` and lock the execution commit (gate 3) | Choices 1 and 2. The commit is named in the approval | Pushing `v2/rebuild` to `origin`; merging it into `main` by the stated method; recording the exact execution commit; one production-configured build of that commit to record its build hash | Deployment, DEV sync, any host or production action, or a rebuild of data. Any later code change re-opens this lock and its affected checks |
| 4 | **C-CRED-1** ([package §4.3](release-decision-package-2026-10-28.md)): credential containment | None. Hygiene only, independent of the release order | The options chosen from §4.3: keep both stopped distros unused; optionally unregister the copy distro; optionally mark the original's disk read-only; offline rotation in a fresh copy only if the template is needed again | Any change to the frozen original's contents. Deleting transcripts stays the owner's own act |
| 5 | **D-V2-EVIDENCE-RETENTION-1** *(new)*: retention of local working copies | None | Deleting `C:\Users\stuar\backups\afldb\current-acceptance-20261029\` (a duplicate of the restricted archive set plus copies of host evidence). Optionally, the streamanator roots listed as U15 in the [ISSUE-316 readiness decision](issue316-production-readiness-decision-2026-10-24.md) | Deleting the original archive set `current-shadow-20261028T192336Z`, the host evidence roots, or anything the accepted shadow (gate 6) is compared against |

### Production prerequisites: each needs its own access or write authority

| # | Choice | Prerequisites | An approval would authorise | It would not authorise |
|---|---|---|---|---|
| 6 | **Host prerequisites** (gate 9, plan step 2) | No package is prepared yet. The first approval can only be for its preparation: a read-only inspection of the production host's Caddy, systemd, TLS and backup routing | That read-only inspection, then a proposed change list with a recovery route. The changes themselves need a second approval | Any host change in the first approval |
| 7 | **A-AFLT** (gate 8, plan step 5): retire the AFL Tables timer and its exact polkit rule | The RISK-27 off-season choice; the C2 / D-316-1 position stated in the approval (plan step 5 puts retirement after C2's verified final acquisition). Ordered **before** schema and code; the cutover preflight refuses release until it is done | Disabling `afldb-settle-afltables.timer` and retiring the exact discovered polkit rule with the existing cutover procedure, read-back of timer, process and enabled state, and `legacy-writers` PASS from the reviewed artifact | Starting any new writer, or restarting retired acquisition later without a new decision |

### The window (stages A and B): one coordinated authority, approved as separately worded records

| # | Choice | Prerequisites | An approval would authorise | It would not authorise |
|---|---|---|---|---|
| 8 | **Window and A-BACKUP** (gate 6, plan steps 2, 3 and 5) | Choices 1–3 and 6–7; a named window; an approved writer and admin-edit freeze | The fresh read-only preflight; the temporary writer pause (`systemctl stop` of the timer only); a frozen, non-pruning full backup with an off-host copy and a proven restore on an isolated host; comparison of its baseline with the accepted `a4641ca0…` shadow. **Any drift stops the release** and needs a fresh rehearsal and archive-bound acceptance | Schema, privilege or code changes |
| 9 | **A-ROLLBACK** | Choice 8's verified backup is named in it | The named recovery route for each failure point, within the [plan's step 11 limits](production-release-plan-2026-10-21.md): prefer artifact revert with forward schema kept; no destructive 116 rollback; no NOT NULL on 117 without proven zero NULLs; any reversal of populated 111–114 needs row and sequence exports | Host restore without the frozen verified archive, full auth and audit recovery and a writer freeze |
| 10 | **A-REL** with the target- and revision-bound **116/117 schema approval** (gate 7, plan steps 6–7) | Choices 8 and 9; production identity re-verified; ledger exactly 110 with zero drift | Running exactly the pending 111–117 with the reviewed runner, each one verified; `privileges.sql`; the two staging default declarations D-V2-STAGING-IMPORT-DEFAULT-1 and APP-DEFAULT-1; ACL, default-ACL, membership and role-attribute read-back; the first comparison of production effective permissions and ownership. **The privileges integration must then reach 43/43** against the released state | Any production test write, ledger edit, checksum edit or replay of an assumed baseline |
| 11 | **A-GO**: install the exact artifact (plan step 8) | Choice 10 passed with privileges 43/43; the choice 3 artifact identity re-confirmed | Installing the locked artifact, restarting and switching traffic, and read-only verification of revision, health, sessions and key pages, with every new canonical writer and provider integration disabled | Enabling any writer (choices 12–14) |

### After installation: separate, later decisions

| # | Choice | Prerequisites | An approval would authorise |
|---|---|---|---|
| 12 | **C3 / D-316-2**: install the AFL API units inert (gate 10) | Choice 11. Independent of 2027 data | Installing both units disabled and inactive |
| 13 | **C4 / C4b / C5** (D-316-3, D-316-13, D-316-4), and **ISSUE-229 B2** (gates 11–12) | Authentic 2027 rounds, venues and the first pre-match feed. **Blocked until published** | Each step individually, in order. C5 activates only the match writer |
| 14 | **Brownlow operations**: observe, backfill, adopt, eligibility, resolve (gate 13; V2-GAP-030/031) | Choice 11; fresh post-schema baselines; authentic API vote, identity and leaderboard reconciliation | Each operation separately, with its own plan digest. There is no shared batch approval, and 2026 stays excluded |

## 3. The next concrete decision

> **Update 2026-10-29:** choice 1 is approved and recorded ([record](release-residuals-2026-10-29.md)). The
> remaining owner actions, a dependency review, the visual checklist and the read-only host-inspection
> approval are consolidated in the [owner action sheet](owner-action-sheet-2026-10-29.md). The text below is
> kept as prepared.

**D-V2-RESIDUALS-1 (choice 1).** It is the first item of plan step 1, needs no production access and has no
unmet prerequisite. Choice 2 (visual acceptance) can be given in the same message; choice 3 needs both.

Approval prompt, if accepted. Edit nothing in it except to strike an item you withhold:

```text
D-V2-RESIDUALS-1 — APPROVED as prepared in docs/v2/owner-decision-release-choices-2026-10-29.md §2, choice 1.

Measure the repository lint debt locally at the current v2/rebuild HEAD with the installed tools (no
package download), record it, and record as KNOWN AND OPEN for the release artifact:
  - the 3 strict Gridley failures (V2-GAP-029: 149 strict / 99 approved / 50 unapproved);
  - the lint debt exactly as measured;
  - external-grids-import NOT RUN (rescued 1,123-board archive unavailable).
Nothing is waived, skipped, restated or edited to pass; GAP-029 stays open. Update the directly affected
records and commit locally. No push, host, production or database action.
```

## 4. Not covered here

This record makes no production, host, push, deployment, schema, grant, Brownlow or deletion change, and it
re-opens no completed test, capture, rehearsal or review. Source ISSUE-327 stays parked. EXEC, frozen P/H and
the retained evidence are unchanged.
