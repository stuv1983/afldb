# Remediation 2026-11-14 — approval packet 2 (supersedes `../APPROVAL-PACKET.md`)

**Nothing in this packet has been executed.** No push, merge, release, install, restart, reboot, configuration change or log deletion.
Each approval below is separate: approving one approves nothing else. Silence is not approval.

## Pins (re-read 2026-11-14; re-read again immediately before each step; any difference is a stop)

| Pin | Value | Source |
|---|---|---|
| `origin/main` | `de640826d13489c58392563e7ae1ff62403ed293` (unchanged) | `git ls-remote`, `PINS-2.txt` |
| **Final candidate** | tip of local branch `claude/remediation-20261114`: the commit that adds this packet (`git log -1 --format=%H -- docs/v2/evidence/remediation-20261114/run2/APPROVAL-PACKET-2.md`); later commits, if any, are records-only (§A) | |
| **Executable revision Q** | `f10e47adf9697d9a59a03dd627615e61e8213d30`, the last commit that changes code, tests or scripts; every commit after it touches only `docs/`, `issues.md`, `IssuesIndex.md`, `blockers.md` and `CHANGELOG.md` (§A proof) | `QUALIFICATION-2.md` |
| Production release | `current` `c1c4b22ee150-bTVyci1eHVcKvSKDVZl_x`; `previous` `0f251c2daa8d-3t0xWKI76Jgna2tB8a9oN`; serving checkout `c1c4b22ee150`, clean | read-only probe, `PINS-2.txt` |
| Production host | kernel `6.8.0-137` running, `/var/run/reboot-required` present; `afldb` active since 06:35:21 AEDT, NRestarts 0; no needrestart hold, no `52-afldb-unattended` | `PINS-2.txt` |
| Installed Caddyfile | sha256 `4f6972ec…d7af036` (no beta-host HSTS/CSP; not the repository file) | `PINS-2.txt`, `ops/README.md` §3 |
| Production database | `afldb_prod`, OID 66668, system id 7674454702926115004, ledger 118; `AFLDB_BETA_EPOCH` 1; 2027 `NOT_OPEN` | **carried** from run 1 and the ops probes of 2026-11-14; not re-read here |
| Schema change in the candidate | **none** (no file under `src/db/migrations/` changed since `de640826`) | `git diff` |
| DEV | `8b024098`, untouched; services as before (`DEV-STATE-AFTER-2.txt`) | |

## A. Publication (Git only; recommended: approve)

**What:** fast-forward `origin/main` from `de640826` to the final candidate. This publishes:
- 107 commits: the full review `5035ed96`, run 1 and run 2;
- 1,005 files changed. Excluding evidence and issue records, 186 files: +13,229 / -489 lines.

No deployment follows.

**Run-2 code delta (`e8666c17..Q`), 51 files:**
- **NL parser:** `src/search/nl/parser.ts`, `plan.ts` (`PARSER_VERSION` 69), `qualifying-matches-gate.ts`.
- **Compare:** `src/lib/concurrency-gate.ts`, `src/app/clubs/compare/{page,state,busy}`.
- **Admin:** `src/db/queries/match-sheet.ts`, `src/lib/match-sheet-dependents.ts`, `src/lib/auth/session.ts`, `src/app/admin/login/page.tsx`.
- **Caddy:** `deploy/Caddyfile`, `deploy/Caddyfile.production`. The repository changes now; the hosts change only under B7.
- **Settle pull check, transport unit and notifier comments:** files under `deploy/`.
- **Test harness:** `packages/testing/src/per-file-*`, `tests/setup.ts`, `vitest.config.mts`.
- **Lint gate in preflight and merge:ready:** `tools/dev/*`.
- **Evidence integrity:** `.gitattributes`.
- **Tests:** the test files.
- **Full list:** `git diff --name-only e8666c17 Q`.

**Qualification at Q** (`QUALIFICATION-2.md`):

| Check | Result |
|---|---|
| typecheck | rc 0 |
| lint gate | PASSED **as a ratchet**: 338 errors in 43 files remain; this is not clean lint |
| unit with every hash-verified fixture | **12,295 passed / 0 failed** |
| unit without fixtures | 7 environment failures |
| shell harnesses | 24/24 and 42/42 |
| integration, per-file databases | 46 failed / 3,448 passed; **all 52 failing ids classified**, identical to the classified tests363 run; 0 caused by run 2 |
| production build | rc 0 |
| AFLW `%27` metadata | correct on the integrated build, directly and through the candidate Caddyfile |

**Reviews:**
- REVIEW-C: 0 CRIT/HIGH, 2 MED, 7 LOW. Both MED are fixed. Of the LOWs, 3 are fixed in code or procedure and 4 are documented.
- REVIEW-D: 0 CRIT/HIGH, 2 MED, 3 LOW. All five are fixed and re-checked.

**Proof that Q is the executable revision:** run `git diff --stat Q..<final candidate>` before pushing. It must list only `docs/…`, `issues.md`, `IssuesIndex.md`, `blockers.md` and `CHANGELOG.md` (recorded at commit time in `HANDOFF.md`).

**Before:**
- `git fetch origin` and confirm `origin/main` is still `de640826`. If it moved, stop: a rebase needs a new qualification.
- Expect a merge later in the `D:\dev\afldb` worktree (branch `claude/issue-339-deploy-preflight`). It has unrelated uncommitted edits to **12 files this candidate also changes**, recomputed 2026-11-14 with `--no-optional-locks`, nothing written:
  - `CHANGELOG.md`, `IssuesIndex.md`, `blockers.md`, `issues.md`
  - `docs/v2/afl-api-2027-season-operations-successor-2026-11-02.md`
  - `src/db/queries/admin-draft.ts`, `src/lib/auth/session.ts`
  - `tests/afl-api-ingestion-safety.test.ts`, `tests/auth.test.ts`, `tests/gap029-ops.test.ts`, `tests/integration/admin-draft.test.ts`
  - `tools/v2/gap029-ops/prod-stage.sh`

  Its `src/app/admin/login/actions.ts` edit does not overlap: run 2 changed `page.tsx`.

**Command (owner):** `git push origin claude/remediation-20261114:main`. This is a fast-forward; refuse `--force`.
**Recovery:** a revert commit. Never rewrite `main`.
**Breaking changes to note:**
- `release.mjs promote` and `rollback` require `--attended` (run 1).
- Per-file test mode refuses parameterised or tunnelled DSNs; it is opt-in.
- Caddy changes, once installed (B7): a trailing slash on the protected ISR routes returns 404, match ids are capped at 99,999, and slugs must match `[a-z0-9-]`.

> **Approval A (fill in):** "I approve publishing `claude/remediation-20261114` at `<final candidate SHA>` to `origin/main` by fast-forward from `de640826`. Executable revision `f10e47ad`." — owner, date.

## B. Production operations (each separately approved, in this order; all need A first, and B2–B8 need B1)

Procedures (prerequisites, roles, validation, failure handling, recovery): `ops/procedures/01..06`, `caddy357/README.md` §10–§11.

### B1. Release Q's published revision to production (recommended: approve, in an attended window)
- **Change:** code only, no migration. Users see the run-1 and run-2 fixes (353–361 and the run-2 residual fixes).
- **Prerequisite:** `node deploy/release.mjs host-gate`. It refuses while apt is running or due within 90 minutes, and outside 05:00–07:15 AEDT.
- **Commands:** `promote --attended`, then the owner's restart in the same sitting. The window between the link switch and the restart is not closed by the tool (`--attended` is a declaration).
- **Validation:** `release.mjs status --expect <new id>`, `deploy/post-install-check.sh <new id>`, a public smoke.
- **Recovery:** `release.mjs rollback --attended` to `c1c4b22ee150-…`. There is no schema difference.
> **Approval B1:** "I approve releasing `<published SHA>` to production with `promote --attended` and my attended restart, rollback target `c1c4b22ee150-bTVyci1eHVcKvSKDVZl_x`." — owner, date.

### B2. ISSUE-350: open 2027 (D-350-1; recommended (b): after B1, by 2027-03-10)
- **Procedure:** 01, the I350 ceremony.
- **Effect:** the plan shows exactly 1 `seasons` row, `last_season` 2027 on 18 club identities and 18 organisations, and 1 audit row.
- **Approval:** typed digest.
- **Validation:** `season-opening-check.ts` exit 0 `OPEN`.
- **Recovery:** `reverse-opening.sql`, only while nothing depends on 2027.
> **Approval B2:** "I approve opening season 2027 on production per procedure 01 with plan digest `<digest>` (D-350-1)." — owner, date.

### B3. ISSUE-332: failure visibility (D-332-1 amendment; recommended option A)
- **Today:** production delivers **no** failure notification.
- **Option A:** an hourly pull check (`deploy/afldb-settle-failure-status.sh`) from an owner host, over a forced-command key, with an alarm channel the owner already watches.
  - The production change is one `authorized_keys` line (procedure 04 §4).
  - **Delivery counts only after one deliberate test alarm arrives.**
- **Blind spots:** procedure 04 §8.
- **Alternatives:** B, the transport unit (never run under systemd); E, the status quo (a manual check each round).
> **Approval B3:** "I adopt D-332-1 option A and approve the forced-command `authorized_keys` line and the owner-host job per procedure 04 §4; first delivery test due `<date>`." — owner, date.

### B4. ISSUE-351: host patching policy (D-HO-1; recommended: install both files plus the weekly owned window)
- **Procedure:** 02 §5. Two `sudo install` commands.
- **Effect:** security updates keep installing. Only the automatic restarts of `afldb` and PostgreSQL, and unattended PostgreSQL server upgrades, stop.
- **Owner responsibility:** held PostgreSQL updates and stale-library restarts, in the weekly window. Without that window this is unbounded security debt.
- **Validation:** procedure 02 §6.
- **Recovery:** `sudo rm` both files.
> **Approval B4:** "I approve installing the needrestart hold and apt blacklist per procedure 02 and commit to a weekly window on `<day/time>`." — owner, date.

### B5. ISSUE-351: the pending reboot (D-HO-6; recommended: separate attended op, after B4 and a verified off-host backup)
- **Procedure:** 03.
- **Prerequisite:** confirm DigitalOcean console access first. GRUB is hidden with timeout 0, so "pick 137 at GRUB" is not a plan.
- **Kernels:** 137 and 149 are installed.
- **Check first:** run the B3 pull check before the reboot, because a reboot clears `Result`.
> **Approval B5:** "I approve one attended reboot on `<date/time>` per procedure 03, console access confirmed." — owner, date.

### B6. ISSUE-352: scheduled backups and off-host copy (D-HO-2/3/5/7; recommended: install after B1; destination A, pull)
- **Procedure:** 05.
- **Order:** attended first runs; `scheduled-backup.sh status` exit 0; then enable the timers.
- **Off-host:** pull with `rrsync -ro`.
- **Warning:** the serving checkout's bare `backup.sh` prunes dumps, so always pass `--dir`.
- **Recovery:** disable the timers and remove the units.
> **Approval B6:** "I approve installing the backup and verify units per procedure 05, off-host destination `<host>`." — owner, date.

### B7. ISSUE-362 + ISSUE-357: the single combined Caddy install (recommended: approve, keep the beta gate on)
- **File:** `deploy/Caddyfile.production`, sha256 `f00859d5c834be09f064d516ea4fa12612da379e377128e784b3523016a6086d`.
- **It changes three things:**
  1. Token and query redaction in the URI, Referer, `Location` and `Refresh`.
  2. The beta-host HSTS/CSP headers the installed file lacks.
  3. The ISSUE-357 path-shape deny.
- **Procedure:** `caddy357/README.md` §10–§11.
  - Prerequisites: the slug charset check and `max(id)` on matches.
  - Back up to `Caddyfile.pre-combined-<stamp>`; validate as `caddy`; one `systemctl reload caddy`.
  - Every probe: legitimate pages, deny shapes, a redacted log line.
  - One rollback.
- **Residual (MED):** a well-formed unknown slug still persists about 76 KiB, about 3.4 h of disk at the measured attack rate. The beta gate is the only protection: **keep it on** until the prune job or allow-lists and a disk alert exist.
- **Operational acceptance is the owner's.**
> **Approval B7:** "I approve installing `deploy/Caddyfile.production` sha256 `f00859d5…6d` per caddy357 §10–§11 with one reload; the beta gate stays on." — owner, date.

### B8. ISSUE-362 O-1: pre-fix logs (after B7 succeeds; recommended: delete the rolled files, truncate the live ones)
- **Procedure:** 06 §3.
- **Check first:** `admin_invites` (not `auth_invites`) for unredeemed, unexpired invites.
- **Exposure:** eight rolled files hold no live token. The live logs may hold an invite token from the last 7 days, query text and IPs, in `uri` and, before B7, in `resp_headers`.
- **Irreversible:** `rm` and `truncate` are not secure erasure. The alternative is an encrypted archive.
- **Nothing was read or deleted by this run.**
> **Approval B8:** "After B7, I approve `<delete+truncate | encrypted archive to …>` of the pre-fix Caddy logs per procedure 06 §3." — owner, date.

## C. Decision table (recommended defaults and consequences)

| Decision | Recommended default | Consequence of the default | Consequence of the alternative |
|---|---|---|---|
| O-1 (357) residual | install the deny, keep the beta gate, add the prune job and a disk alert before launch | bounded today; one owner cron to add later | without a bound, about 13 GiB/h of disk exposure once the gate is off |
| D-332-1 amendment | option A pull check | needs an owner host and an alarm channel; catches a dead host | B: a production unit and network egress; E: a missed nightly can go unseen |
| G0b / G0c split | G0b = failure visibility, G0c = first clean nightly after opening | removes the double definition | ambiguity at the 2027 gate review |
| O-A05-1 (353) | leave the 1,247 line-ups (1931–1934) unprotected | no place to clear them, no invented data | (b) needs a clearing path built first |
| O-B06-1 (361) | keep 200 + noindex for "busy" | robots meta duplicated; harmless | a 503 needs a middleware or route-handler change |
| O-B06-2 (361) | 24 waiters / 10 s | rare refusals under bursts | raise `AFLDB_COMPARE_MAX_QUEUE` if refusals show |
| O-2 (364) | accept the merge-time ratchet | debt can only fall; 338 errors remain | gate in release/CI: a larger change (P2-09) |
| ISSUE-363 (3) | rebuild `afldb_test`, then re-check the early returns | snapshot-oracle failures stay classified, not passed | none possible without the rebuild |
| Prior `auth_sessions` row (362) | leave (12 h TTL) | two live rows briefly | revoke in the credential transaction (policy change) |
| "round most goals" (356) | keep it resolving to Barry Round | could also mean "which round" | drop the start-of-question cue |
| D-350-1 | open by 2027-03-10 | the first nightly applies | every nightly fails from 2027-03-17 |

## D. Remaining failures and gaps

- **Integration:** 46 failing tests plus 6 file-level, all classified (`QUALIFICATION-2.md`).
  - Snapshot-oracle (no rebuilt `afldb_test`), environment, refuses-by-design.
  - One real test defect: `settle-afl-api-state-b` order dependence, LOW, follow-up under 363.
- **Never exercised on production:** systemd units, host-policy files, ssh/rrsync paths, the transport unit. Root-only facts stay unverified.
- **Unverified:** the DEV `AFLDB_BETA_EPOCH` value; the Caddy `roll_keep_for` default; DigitalOcean console and snapshots.
- **Residual register:** `RESIDUALS.md`. No residual is accepted on the owner's behalf.
- **Incidents disclosed:**
  - Production probe scripts were copied to `/tmp`, run and deleted.
  - A mis-quoted grep attempted to execute `backup.sh` (Permission denied; nothing ran).
  - The orchestrator's stop of a superseded qualification run killed its own ssh shell and orphaned vitest children, which were then killed by PID. That was host-local to the qualification workspace.

## Status vocabulary used across the records

| Status | Meaning |
|---|---|
| **Fixed locally** | committed on the branch |
| **Qualified** | passed at Q |
| **Awaiting publication** | A |
| **Awaiting installation** | B1, B3–B7 |
| **Awaiting owner decision** | §C |
