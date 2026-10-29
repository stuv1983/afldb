# V2 release — coordinated decision package (2026-10-29)

**Production: NO-GO. This package authorises nothing.** It puts the release choices that are already prepared into
one ordered view, so the owner can decide them together. It adds no procedure. Each step keeps the approval wording,
stop conditions and recovery routes of its source:
[release choices](owner-decision-release-choices-2026-10-29.md) (choice numbers below),
[owner action sheet](owner-action-sheet-2026-10-29.md),
[host findings and change list](host-prerequisites-findings-2026-10-29.md) (HC-1 to HC-5),
[ordered release plan](production-release-plan-2026-10-21.md) (steps 1–11),
[cutover runbook](cutover-runbook.md), [rollback runbook](rollback-runbook.md) and the
[gate ledger](release-decision-package-2026-10-28.md).

Unchanged by this package: privileges integration **42/43**, not waived, until A-REL; strict preservation and parity
FAIL and the staged Brownlow comparator INCOMPLETE, recorded and not waived; V2-GAP-029 and V2-GAP-022 open; authentic
provider reconciliation separate from the synthetic UI evidence (V2-GAP-023, choice 14); EXEC and frozen P/H
unchanged; source ISSUE-327 parked.

## 1. Exact candidate

| Item | Value |
|---|---|
| Application tree | `7670441b` on `v2/rebuild` (fixes V2-GAP-036/037/038 and the raw-totals label). Every later commit up to the one that adds this package changes only `docs/`, `tools/v2/` and tracking files: `git diff --name-only 7670441b <commit>` shows no application path |
| Execution commit | The `v2/rebuild` commit that adds this package, reported with it. D-V2-PUSH-1 locks it. **Any later application change re-opens the lock** and its affected checks |
| Verification build | `XtSgl4BOQZXC2G8qIWJdV` (local, `next build --webpack` + `prepare-standalone`, 1516/1516 pages). It is the build every corrected-candidate image was taken from. It is not the release artifact: D-V2-PUSH-1 makes one production-configured build of the locked commit and records its hash |
| Production baseline | Migration ledger exactly **110**, identity matched, no release drift (host inspection, 2026-10-29). Accepted shadow archive `a4641ca0…` (gate 4); archive-bound acceptance PASS (gate 5) |
| Pending schema | Migrations **111–117**, run only by the reviewed runner under A-REL |
| Residuals at lock | D-V2-RESIDUALS-1, recorded: 3 strict Gridley failures (V2-GAP-029), lint 508 / 136, `external-grids-import` NOT RUN |
| Visual evidence | [Owner review sheet](owner-visual-review-candidate-2026-10-29.md): every linked image is the corrected candidate or a component proven unchanged (its §0a) |

## 2. Proposed hostname

**`beta.afldb.com`**, proxied by the existing Caddy route to `127.0.0.1:3100`, routing unchanged (P1 as recommended
in host findings §5). A-GO is then an artifact install and service restart, with no proxy change in the window and no
tracked-file change in the lock. The apex launch (`deploy/Caddyfile.production` "AT LAUNCH", `.env` indexing and base
URL, HSTS ramp, Cloudflare client addresses F-3) is a **later, separate decision**.

## 3. Ordering

| # | Step | Choice / change | Depends on | Production access |
|---|---|---|---|---|
| 1 | Owner visual verdict | D-V2-VISUAL-1 (V2-GAP-022) | — | none |
| 2 | Hostname and ISSUE-316 route | P1, RISK-27 | — | none |
| 3 | Push, merge, lock, production-configured build | 3 D-V2-PUSH-1 | 1, 2 (a REJECT becomes a code fix first) | none |
| 4 | Install the repository Caddyfile (optional) | 6b HC-1 | its own approval; any time before step 8 | host |
| 5 | Retire the AFL Tables writer | 7 A-AFLT with HC-2 | 2 | host |
| 6 | Window opens: fresh read-only preflight, writer and admin-edit freeze, timer pause | 8 | 3, 5, a named window | host |
| 7 | Frozen backup, off-host copy, proven restore, shadow comparison | 8 A-BACKUP with HC-3, HC-4, HC-5 | 6; P3 | host |
| 8 | Recovery routes named against that backup | 9 A-ROLLBACK | 7 | none |
| 9 | Schema and privileges | 10 A-REL | 8; identity re-verified; ledger 110, zero drift | production database |
| 10 | Install and switch | 11 A-GO | 9 with privileges **43/43**; artifact identity re-confirmed | host |
| 11 | Later, one approval each | 12 C3 inert units; 13 C4/C4b/C5 and B2 (blocked until authentic 2027 data); 14 Brownlow operations (2026 excluded) | 10 | each its own |

No stage A or B step waits for 2027 data (gate ledger §1; host findings §6).

## 4. Backup and recovery (choices 8 and 9)

- **A-BACKUP, non-pruning (HC-3):** `backup.sh --dir ~/backups/afldb/release-v2-<STAMP> --keep 999`, so the existing
  11-file series is outside the prune glob. Verify: series count unchanged, `pg_restore --list` passes, SHA-256
  recorded.
- **Off-host copy (HC-4):** pull to the workstation over the existing `afldb` ssh identity with the
  `current-production-shadow/transfer.ps1` pattern, SHA-256 equal on both ends. No host change.
- **Proven restore (HC-5):** `restore-test.sh` into the disposable `afldb_restore_test`, PASS on the frozen dump.
- **Shadow comparison:** the frozen baseline against `a4641ca0…`. **Any drift stops the release** and needs a fresh
  rehearsal and archive-bound acceptance.
- **A-ROLLBACK (plan step 11 limits):** prefer an artifact revert with the forward schema kept; no destructive 116
  rollback; no NOT NULL on 117 without proven zero NULLs; any reversal of populated 111–114 needs row and sequence
  exports; a host restore only from the frozen verified archive, with full auth and audit recovery and a writer
  freeze ([rollback runbook](rollback-runbook.md)).

## 5. Legacy-writer retirement (choice 7)

A-AFLT disables `afldb-settle-afltables.timer` and retires its exact polkit rule with the cutover procedure. HC-2 reads
the rule (name, SHA-256, compared with `deploy/afldb-settle-afltables-trigger.rules`, `3164e0d9…`) and keeps a
root-owned copy before removal; recovery restores that copy and re-verifies the hash. Read-back of timer, process and
enabled state, then `legacy-writers` PASS from the reviewed artifact. The cutover preflight refuses release until this
is done. The D-316-1 final acquisition was completed on 2026-10-21 and the rollover is in the candidate, so the
RISK-27 route "A-AFLT with the 2026 final acquisition done first" is available now.

## 6. Migrations and default privileges (choice 10)

A-REL, bound to the target and to revision: re-verify production identity; ledger exactly 110 with zero drift; run
exactly 111–117 with the reviewed runner, verifying each; apply `privileges.sql`; execute the two staging default
declarations **D-V2-STAGING-IMPORT-DEFAULT-1** and **D-V2-STAGING-APP-DEFAULT-1**; read back ACLs, default ACLs,
memberships and role attributes; make the first comparison of production effective permissions and object ownership.
The privileges integration must then reach **43/43** against the released state; otherwise the release stops before
A-GO. Not authorised there: any production test write, ledger or checksum edit, or replay of an assumed baseline.

## 7. Installation (choice 11)

A-GO installs the locked artifact, restarts the service behind the unchanged beta route, and verifies read-only:
revision, health (`/api/health` through Caddy and directly), sessions and key pages. Every new canonical writer and
provider integration stays disabled; enabling any of them is choices 12–14.

## 8. Genuinely unresolved owner choices

> **Update (D-V2-LOCK-1, approved 2026-10-29):** O-1 accepted in full (V2-GAP-022 closed), O-2 `beta.afldb.com`
> with Caddy unchanged, O-3 "release after C5" withdrawn with A-AFLT still required before schema/code
> installation, O-4 a normal `--no-ff` merge. See [the lock record](owner-decision-lock-2026-10-29.md), which also
> carries the merge, the locked commit, the build and the remaining production approval package. O-5 to O-7 stay
> open. The table below is kept as prepared.

| # | Choice | Prepared position | Needed before |
|---|---|---|---|
| O-1 | D-V2-VISUAL-1 verdict | Return §6 of the [review sheet](owner-visual-review-candidate-2026-10-29.md). A REJECT becomes a tracked defect and re-opens the candidate | the lock |
| O-2 | P1 hostname | `beta.afldb.com`, Caddy unchanged; apex later (§2) | the lock |
| O-3 | RISK-27 route | Withdraw "release after C5"; A-AFLT with the completed D-316-1 acquisition (§5) | the lock (A-AFLT order) |
| O-4 | Merge method into `main` | Owner's choice, named in the approval | the lock |
| O-5 | P3 off-host destination and retention | HC-4 workstation pull as the copy; retention period and any second destination are open | the window |
| O-6 | HC-1 take or decline | Optional. Accepting it installs the repository Caddyfile; a revert cannot withdraw HSTS already sent for beta. Declining records F-1 as a known residual | A-GO |
| O-7 | The window | Date and time, freeze scope (writers and admin edits) | the window |

Optional, not release blockers: X-GRIDS-1, C-CRED-1, D-V2-EVIDENCE-RETENTION-1.

## 9. The approval needed next

One message settles everything that the lock depends on. Strike or edit only the bracketed items:

```text
D-V2-LOCK-1 — owner decisions and lock, as prepared in docs/v2/release-decision-package-final-2026-10-29.md.

1. D-V2-VISUAL-1: my verdict block from docs/v2/owner-visual-review-candidate-2026-10-29.md §6 is attached.
   [If any row is REJECTED: stop here; the rejected rows become tracked defects and the lock waits.]
2. P1: V2 serves at beta.afldb.com through the existing Caddy route to 127.0.0.1:3100, Caddy unchanged.
   The apex launch is a later, separate decision.
3. RISK-27: "release after C5" is withdrawn; A-AFLT follows the completed D-316-1 final acquisition.
4. D-V2-PUSH-1: push v2/rebuild to origin, merge it into main by [merge method], record the execution commit
   <commit>, make one production-configured build of it and record its build hash.

Not approved: deployment, DEV sync, any host or production access, HC-1 to HC-5, A-AFLT, the window,
A-BACKUP, A-ROLLBACK, A-REL, A-GO, any writer, any Brownlow operation. Privileges stay 42/43 until A-REL.
```

After it, the next approvals are A-AFLT (choice 7) and the window (choice 8, with P3 and the named date), each in its
own message as worded in the release choices.
