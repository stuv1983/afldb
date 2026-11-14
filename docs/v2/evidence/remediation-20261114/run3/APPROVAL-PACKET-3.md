# Remediation 2026-11-14 — approval packet 3 (supersedes `../run2/APPROVAL-PACKET-2.md` and `../APPROVAL-PACKET.md`)

**Nothing in this packet has been executed.** No push, merge, release, install, restart, reboot, configuration change or log deletion.
Each approval below is separate: approving one approves nothing else. Silence is not approval. No owner decision and no residual
has been accepted on the owner's behalf.

## Pins (re-read immediately before each step; any difference is a stop)

| Pin | Value | Source |
|---|---|---|
| `origin/main` | `de640826d13489c58392563e7ae1ff62403ed293` (unchanged; `git fetch` 2026-11-15) | read-only fetch |
| **Publication candidate** | **`b9a43343272c8ee982a89d9f50f65fee53466313`** (`records(run3): ISSUE-363 partially resolved, new ISSUE-365, …`) | `git log` |
| **Executable revision Q′** | **`692b1902cbcc321cea76a30857a03e15f02db6b7`**, the last commit that changes code, tests or scripts | `QUALIFICATION-3.md` |
| Run 2's Q (superseded) | `f10e47ad`; since Q only five integration test files and the run-3 qualification scripts changed | §A |
| Production release, host, Caddyfile, database | **carried from run 2, not re-read** (run 3 had no production access): `current` `c1c4b22ee150-bTVyci1eHVcKvSKDVZl_x`, `previous` `0f251c2daa8d-3t0xWKI76Jgna2tB8a9oN`; kernel 137 running with reboot required; installed Caddyfile sha256 `4f6972ec…d7af036`; `afldb_prod` OID 66668, sysid 7674454702926115004, ledger 118, `AFLDB_BETA_EPOCH` 1, 2027 `NOT_OPEN` | `../run2/PINS-2.txt` |
| Schema change in the candidate | **none** (no file under `src/db/migrations/` changed since `de640826`) | `git diff` |
| DEV | `8b024098`, untouched (`DEV-STATE-BEFORE-3.txt` / `DEV-STATE-AFTER-3.txt`) | read-only |

## A. Publication (Git only; recommended: approve)

**What:** fast-forward `origin/main` from `de640826` to `b9a43343`:
- **129 commits** (`git rev-list --count de640826..b9a43343`): the full review `5035ed96`, run 1, run 2 and run 3.
- **1,632 files** changed. Excluding `docs/v2/evidence/` and `issues/`: **190 files, +13,633 / −512**.
- **Executable delta since run 2's Q `f10e47ad`:** `tests/integration/{settle-afl-api-state-b,settle-afl-api,settle-afl-api-brownlow,settle-afl-api-issue276,database}.test.ts`
  (+264 / −23) and the qualification scripts `run3/qualification-3/{setup,qual,fixtures}.sh`. **No application code, tool, migration, deploy file,
  package file or reference dataset changed in run 3.** The run-1 and run-2 code delta is unchanged (packet 2 §A).
- **Proof that Q′ is the executable revision:** `git diff --stat 692b1902 b9a43343` lists only `docs/…`, `issues.md`, `IssuesIndex.md`, `blockers.md`,
  `CHANGELOG.md` (0 other paths, recorded 2026-11-15). Every script that produced Q′ evidence is committed at or before Q′.
- **Lint stays a ratchet:** 338 errors in 43 files remain; the gate fails only when a count rises. This is not clean lint.

**Qualification at Q′** (`QUALIFICATION-3.md`): typecheck rc 0; lint ratchet 338/43; unit **12,295 passed / 0 failed** with every hash-verified fixture
(7 and 2 environment failures without them); shell harnesses 24/24 and 42/42; integration per-file **42 failed / 3,457 passed**, every failing id classified,
**6 gone and 0 new against run 2**; production build rc 0. The isolated accepted-baseline rebuild passed (91 checks) and the 53 integration ids were
classified on it (14 pass under intended conditions, 2 defects fixed, 31 stale assertions of which 4 corrected, 5 limitations, 1 proved separately).

**Before:** `git fetch origin` and confirm `origin/main` is still `de640826` (if it moved: stop, a rebase needs a new qualification). Expect a later
merge in `D:\dev\afldb` (branch `claude/issue-339-deploy-preflight`), which holds unrelated uncommitted edits to 12 files this candidate also changes
(packet 2 §A lists them).
**Command (owner):** `git push origin b9a43343272c8ee982a89d9f50f65fee53466313:main` (fast-forward; refuse `--force`).
The branch tip is a records-only commit after `b9a43343` that adds this packet and the run-3 HANDOFF record. Pushing the branch tip instead is covered by
this approval only if `git diff --name-only b9a43343 claude/remediation-20261114` lists files under `docs/v2/evidence/remediation-20261114/` only.
**Recovery:** a revert commit; never rewrite `main`.
**Breaking changes to note (unchanged from packet 2):** `release.mjs promote`/`rollback` require `--attended`; per-file test mode refuses parameterised or
tunnelled DSNs (opt-in); the Caddy changes, once installed (B7), 404 a trailing slash on protected ISR routes, cap match ids at 99,999 and require
slugs `[a-z0-9-]`.

> **Approval A:** "I approve publishing `claude/remediation-20261114` at `b9a43343272c8ee982a89d9f50f65fee53466313` to `origin/main` by fast-forward from `de640826d13489c58392563e7ae1ff62403ed293`. Executable revision `692b1902cbcc321cea76a30857a03e15f02db6b7`. Lint is a 338-error ratchet, not clean." — owner, date ________.

## B. Production operations (each separately approved; all need A; B2–B8 need B1)

Procedures (prerequisites, roles, validation, failure handling, recovery): `../run2/ops/procedures/01..06`, `../run2/caddy357/README.md` §10–§11.
Every production pin above was carried from run 2 and **must be re-read** before any of these. **Blanks marked `________` must be filled by the owner;
nothing below is valid with a blank.**

### B0. Read-only production probe before B1 (new in run 3; recommended: approve)
- **What:** re-read the run-2 pins (release ids, serving checkout, kernel, Caddyfile hash, database identity, ledger) and the 2026 Brownlow
  `stat_availability` rows (ISSUE-365) with the read-only probe pattern of `../AGENT-PROTOCOL.md` §6. No write.
> **Approval B0:** "I approve one read-only production probe of the pins and the 2026 Brownlow coverage rows on ________ (date/time AEDT), run by ________." — owner, date ________.

### B1. Release the published revision to production (recommended: approve, attended)
- **Change:** code only, no migration; the application code equals run 2's Q (run 3 changed tests only). Users see the run-1 and run-2 fixes.
- **Prerequisite:** B0 done; `node deploy/release.mjs host-gate` (refuses while apt runs or is due within 90 minutes, and outside 05:00–07:15 AEDT).
- **Commands:** `promote --attended`, then the owner's restart in the same sitting. **Validation:** `release.mjs status --expect <new id>`,
  `deploy/post-install-check.sh <new id>`, a public smoke. **Recovery:** `release.mjs rollback --attended` to `c1c4b22ee150-bTVyci1eHVcKvSKDVZl_x` (re-read in B0).
> **Approval B1:** "I approve releasing `b9a43343…` (published) to production with `promote --attended` and my attended restart in the window ________ (date, 05:00–07:15 AEDT), rollback target `________` (as re-read in B0)." — owner, date ________.

### B2. ISSUE-350: open 2027 (D-350-1; recommended (b): after B1, **by 2027-03-10**; every nightly fails from 2027-03-17 otherwise)
- Procedure 01 (the I350 ceremony); 1 `seasons` row, `last_season` 2027 on 18 club identities and 18 organisations, 1 audit row; typed digest;
  validation `season-opening-check.ts` exit 0 `OPEN`; recovery `reverse-opening.sql` while nothing depends on 2027.
> **Approval B2:** "I approve opening season 2027 on production per procedure 01 with plan digest `________` on ________ (date) (D-350-1)." — owner, date ________.

### B3. ISSUE-332: failure visibility (D-332-1 amendment; recommended option A)
- Today production delivers **no** failure notification. Option A: hourly pull check (`deploy/afldb-settle-failure-status.sh`) from an owner host
  over a forced-command key; one `authorized_keys` line on production (procedure 04 §4). Delivery counts only after one deliberate test alarm **arrives**.
> **Approval B3:** "I adopt D-332-1 option A: owner host ________, alarm channel ________ (one I already watch), forced-command `authorized_keys` line per procedure 04 §4; first delivery test on ________ (date)." — owner, date ________.

### B4. ISSUE-351: host patching policy (D-HO-1; recommended: install both files plus the weekly owned window)
- Procedure 02 §5, two `sudo install` commands. Security updates keep installing; automatic restarts of `afldb`/PostgreSQL and unattended PostgreSQL
  server upgrades stop. Without the weekly window this is unbounded security debt. Validation 02 §6; recovery `sudo rm` both files.
> **Approval B4:** "I approve installing the needrestart hold and apt blacklist per procedure 02 and commit to a weekly maintenance window on ________ (day/time AEDT)." — owner, date ________.

### B5. ISSUE-351: the pending reboot (D-HO-6; recommended: separate attended op, after B4 and a verified off-host backup)
- Procedure 03. Confirm DigitalOcean console access first (GRUB hidden, timeout 0). Run the B3 pull check before the reboot (a reboot clears `Result`).
> **Approval B5:** "I approve one attended reboot on ________ (date/time AEDT) per procedure 03; console access confirmed on ________ (date) by ________." — owner, date ________.

### B6. ISSUE-352: scheduled backups and off-host copy (D-HO-2/3/5/7; recommended: after B1, destination A, pull)
- Procedure 05: attended first runs, `scheduled-backup.sh status` exit 0, then the timers; off-host pull with `rrsync -ro`. Always pass `--dir`
  (the serving checkout's bare `backup.sh` prunes dumps). Recovery: disable the timers, remove the units.
> **Approval B6:** "I approve the backup and verify units per procedure 05; off-host destination ________ (host:path), local retention ________ (dumps/days), off-host retention ________." — owner, date ________.

### B7. ISSUE-362 + ISSUE-357: the single combined Caddy install (recommended: approve, keep the beta gate on)
- File `deploy/Caddyfile.production`, sha256 `f00859d5c834be09f064d516ea4fa12612da379e377128e784b3523016a6086d` (unchanged in run 3): redaction, beta-host
  HSTS/CSP, the ISSUE-357 path-shape deny. caddy357 §10–§11: slug charset and `max(id)` prerequisites, backup to `Caddyfile.pre-combined-<stamp>`,
  validate as `caddy`, one `systemctl reload caddy`, probes, one rollback. Residual MED: unknown well-formed slugs persist about 76 KiB each; keep the gate on.
> **Approval B7:** "I approve installing `deploy/Caddyfile.production` sha256 `f00859d5…6d` per caddy357 §10–§11 with one reload in the window ________ (date/time); the beta gate stays on." — owner, date ________.

### B8. ISSUE-362 O-1: pre-fix logs (after B7; recommended: delete the rolled files, truncate the live ones)
- Procedure 06 §3; check `admin_invites` for unredeemed, unexpired invites first. `rm`/`truncate` are not secure erasure.
> **Approval B8:** "After B7, I approve ________ (`delete+truncate` | `encrypted archive to ________ with retention ________`) of the pre-fix Caddy logs per procedure 06 §3." — owner, date ________.

## C. Decisions that need the owner

### C1. New in run 3

| Decision | Recommended | Consequence of the recommendation | Consequence of the alternative |
|---|---|---|---|
| **D-365-1** Brownlow coverage of a completed season with no loaded medal (ISSUE-365, Medium) | (a) keep it `pending` unless a declared no-medal season; fix with a regression | changes a modelling rule and the admin lock semantics; needs a reviewed code change and qualification | (b)/(c): the first Brownlow settle or admin finalisation of such a season marks it "no medal" and locks Brownlow admin for it |
| **363-W** 27 stale club-comparison / release-gates witnesses (plus 2 surrogate-id lookups) | club-comparison bounded to seasons ≤ 2025 with stable keys; release-gates counts re-pinned to the accepted baseline | the suites pass on the accepted rebuild and stop going stale each season | re-pin to 2026 values: stale again when 2027 loads; accept: 29 ids stay classified failures |
| **363-G** three "2026 is provisional" gates | re-point to the current in-progress season | gates keep their meaning as seasons roll | keep: they fail on every accepted-baseline database |
| **363-C** Coleman contract `expected_rows` 46 | re-pin and derive the legacy-transition expectation | `awards-reload-links` runs on completed-2026 bases | keep: the suite only runs on a base with 2026 in progress, which the register no longer produces |
| **363-B** birth-date pins (13,255 vs rebuild 13,347) | pins follow the accepted rebuild | 3 release-gates ids pass on the rebuild; then fail on the 4 Nov snapshot until production is re-enriched | follow production: the rebuild path stays red |
| **363-3** treat the isolated accepted-baseline rebuild as decision (3)'s evidence | accept (the shared `afldb_test` stays as it is) | no change to the shared test database | rebuild the shared `afldb_test` (a separate, authorised operation) |
| **RB-1** retain the rebuild inputs | keep `/mnt/ssd/afldb/workspaces/afldb-i316-rb-I-20261023T0905Z` (or copy the three verified inputs to ________) | the standard rebuild stays reproducible | losing it blocks the accepted-baseline rebuild |

### C2. Carried unchanged from packet 2 (still open)

| Decision | Recommended |
|---|---|
| D-350-1 open 2027 | by 2027-03-10 (B2) |
| D-332-1 amendment; G0b/G0c split | option A pull check (B3); G0b = failure visibility, G0c = first clean nightly after opening |
| ISSUE-357 O-1 residual | install the deny, keep the beta gate, add the prune job and a disk alert before launch |
| ISSUE-364 O-2 | accept the merge-time ratchet |
| O-A05-1 (353) | leave the 1,247 line-ups unprotected |
| O-B06-1 / O-B06-2 (361) | keep 200 + noindex; 24 waiters / 10 s |
| Prior `auth_sessions` row (362) | leave (12 h TTL) |
| "round most goals" (356) | keep resolving to Barry Round |
| D-HO-1..7 | B4–B6 |

## D. Remaining failures and gaps (bounded)

- **Integration at Q′ (snapshot base, per-file):** 46 failing ids, all classified: club-comparison 24, release-gates 8, draft-linkage 2, admin-brownlow 1,
  gridley 1 (snapshot-oracle; on the accepted rebuild 14 of the 53 ids pass and the rest are 363-W/G/C/B or N7); data-editor 5 (snapshot precondition;
  pass on the rebuild); awards-reload-links (363-C); OD-5 (refuses per-file names; passes on a rebuild-named clone); three file-level refusals by design
  (pass under their documented conditions).
- **Shared (default) integration mode** still has T363-2/T363-3 cross-file effects; per-file mode is the qualified mode. ISSUE-363 is **partially resolved**.
- **ISSUE-365** reproduced on isolated databases only; production not read.
- **Verifier false positive:** 1 COMMITTED-MISMATCH, proved harmless (`RESIDUALS-3.md` §2.5).
- **Not verified in run 3:** every production pin (carried), DEV `AFLDB_BETA_EPOCH`, Caddy `roll_keep_for`, DigitalOcean console and snapshots; no
  systemd unit, host-policy file or ssh/rrsync path has run on production.
- **Residual register:** `RESIDUALS-3.md` (with `../run2/RESIDUALS.md` for unchanged rows). Nothing accepted on the owner's behalf.
- **Incidents disclosed:** none outside authority. Two scope agents ran single-file test groups without the shared heavy lock (not restores, rebuilds,
  full suites or builds); one `pkill -f` matched its own ssh shell and killed only its own lock waiter; one kill-and-relaunch command was refused by the
  permission classifier and did not run; directory names were listed (no file read, no write) under `D:\dev\afldbV2\data` and `D:\dev\afldb\data\sources`
  early in the rebuild input search.

## Status vocabulary

| Status | Meaning |
|---|---|
| **Fixed locally** | committed on the branch |
| **Qualified** | passed at Q′ |
| **Awaiting publication** | A |
| **Awaiting installation** | B1, B3–B7 |
| **Awaiting owner decision** | §C |
