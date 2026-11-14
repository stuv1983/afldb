# Remediation run 2 — residual register

Every residual known at the end of run 2. Each row gives the consequence, the protection that exists now, the operator
action, the alternatives and the recommendation. **"Accepted" appears nowhere here.** A LOW grade or an agent's
"accepted LOW" is a grade, not the owner's acceptance; each row below waits for the owner (packet `APPROVAL-PACKET-2.md` §D).

Status words: **fixed locally** (committed on `claude/remediation-20261114`, unpublished); **qualified** (passed at the
executable revision named in `QUALIFICATION-2.md`); **awaiting publication / installation / owner decision**.

## 1. Fixed in run 2 (no residual beyond publication)

| Item | Where | State |
|---|---|---|
| Five CR-bearing evidence blobs | `evidence/README.md` §1 | fixed locally; 0 COMMITTED-MISMATCH |
| B-03 surname "Round" (with MED-1 follow-up) | `public/README.md` | fixed locally |
| B-04 crafted int4 range | `src/search/.../qualifying-matches-gate.ts` | fixed locally |
| B-06 unbounded compare queue | `createConcurrencyGate` maxQueue/maxWaitMs | fixed locally |
| B-08 singular rivalry rewrite | `SINGLE_GAME_LEAD_RE` | fixed locally |
| A-05 NULL-`match_id` positive votes (621 rows) | `match-sheet.ts` | fixed locally |
| A-06 season-open LOCK order | `tools/v2/issue350-season-open-production.ts:239-243` | verified already fixed |
| A-04 `SuccessExitStatus=75` | backup units | verified already fixed |
| A-08 season-opening-check role | `season-rollover.test.ts` pin | verified, no change |
| B-05 forced admin reauthentication | `adminClaimBelowBetaEpoch()` and the sign-in notice | fixed locally |
| ISSUE-364 lint gate | preflight/merge:ready | wired as a **ratchet** (see §2.1) |
| ISSUE-357 path-shape deny | both Caddyfiles | fixed locally, **awaiting installation** |
| ISSUE-362 invite redaction in any spelling (LOW-7) | `deploy/Caddyfile.production` | fixed locally, awaiting installation |
| ISSUE-363 per-file disposable DBs | `packages/testing/`, `tests/setup.ts` | fixed locally (opt-in); residuals §2.9 |

## 2. Residuals

### 2.1 Lint gate is a ratchet, not clean lint (ISSUE-364)
- **Consequence:** 338 errors in 43 files remain. The gate fails a pair only when its count rises. Errors paid down can be re-spent until the baseline is tightened, and `--update` can move debt between pairs while totals stay under the ceiling (REVIEW-C LOW-8).
- **Protection:** WARN on a stale baseline in preflight and merge:ready, plus the ceiling test (338/43).
- **Operator action:** tighten in reviewed commits that only lower counts. Refuse any baseline diff that raises a pair.
- **Alternatives:** fail on a stale baseline (rejected, it blocks unrelated merges); clean lint (a separate project).
- **Not covered:** release, sync-dev and CI do not run the gate (P2-09). A-09 depends on a stdout verdict line until `release.mjs` has a dedicated drift exit code.
- **Recommendation:** keep; optionally add the exit code later.

### 2.2 Caddy residual growth (ISSUE-357 F-001, MED)
- **Consequence:** an unknown but well-formed player, club, venue or honour-team path persists about 76 KiB in 7 files. That is about 13,700 paths per GiB, or about 13 GiB/h at 51 paths/s, so 45 GB of free space lasts about 3.4 h under sustained attack.
- **Protection:** the beta gate (0 files persisted with the gate on). Exposure becomes real when the gate is removed.
- **Operator action:** keep the gate on until a bound and a disk alert exist.
- **Alternatives:** `caddy357/scripts/prune-not-found.sh` (prepared, tested, not installed); enumerated allow-lists for clubs, venues and honour teams; a disk alert.
- **Recommendation (O-1):** (A) install the deny and keep the gate. Add the prune job and a disk alert before public launch.

### 2.3 Caddy deny behaviour changes
A trailing slash becomes 404. Match ids are capped at 99,999. Slugs must match `[a-z0-9-]` (no bad slug on the 4 Nov copy). Installing the candidate also adds the beta-host HSTS/CSP headers that the installed file lacks: the ops README §3, finding 1. The single combined install is `caddy357/README.md` §10.
- **Operator action:** run the prerequisite slug and max-id checks on production before installing (caddy357 §5).

### 2.4 Failure notification (ISSUE-332 A-07)
- **Consequence:** production delivers **no** failure notification today. There is no MTA and no monitor, `arm` cannot read the journal, and the notifier is not installed. A marker or journal line on the host is not delivery.
- **Prepared:** a read-only pull check (run against production: OK) and an optional transport unit. Neither has been installed.
- **Blind spots:** a reboot erases `Result`; `AMBIGUOUS:0` reads OK; persistence after a reboot depends on the installed timer setting; the transport unit has never run (procedure 04 §8).
- **Recommendation:** option A, a pull check from an owner host with an alarm channel. Delivery counts only after a test alarm has **arrived**.

### 2.5 `--attended` is a declaration (ISSUE-351)
- **Consequence:** the window between promote's link switch and the owner's restart stays open. A crash or reboot in that window activates the switched release.
- **Protection:** the documented attended procedure, plus the restart audit (which flags only apt-coincident restarts).
- **Operator action:** promote and restart in one sitting. Use `--confirm-attended-restart` only for your own restart (procedure 02 §7).
- **Recommendation:** keep; closing the window needs a release-tool change, which is a separate issue.

### 2.6 Host patching, PostgreSQL holds and reboot (ISSUE-351)
- **Consequence once installed:** held PostgreSQL updates and held restarts accumulate as security debt unless the **owner** runs the weekly window. Nothing else installs them.
- **Not held:** Caddy and the other system services (procedure 02 §8).
- **Reboot:** GRUB is hidden with timeout 0, and the only installed kernels are 137 and 149, so the console fallback is unverified (procedure 03).
- **State:** awaiting installation and owner decision D-HO-1 and D-HO-6.

### 2.7 Backups and off-host copies (ISSUE-352)
- **Hazard:** the serving checkout's bare `backup.sh` prunes per-operation dumps to 7, so always pass `--dir`.
- **Verify timing:** a verify that loses the lock race exits 75 silently; `status` turns red only after 9 days.
- **State:** units verified statically only, never run under systemd. Off-host pull prepared, awaiting installation.

### 2.8 Sensitive logs (ISSUE-362 O-3)
- **Exposure:** live Caddy logs may hold an unexpired invite token (7-day lifetime) and hold query text and client IPs. The eight rolled files are older than 12 days, so they hold no live token.
- **Not done:** nothing was read or deleted.
- **Proposal:** install the filter first, then check `admin_invites` (not `auth_invites`) for live invites, then delete the rolled files and truncate the live ones (owner, sudo). Choose an encrypted archive instead if forensic history matters.
- **Unverified:** the `roll_keep_for` default (procedure 06).

### 2.9 Test harness (ISSUE-363)
Per-file disposable databases (`AFLDB_TEST_PER_FILE_DB=all|1`) are opt-in. Shared mode, the default, is unchanged. REVIEW-D MED-1, MED-2 and LOW-5 are fixed (`ade11cc6`): multi-host and parameterised DSNs are refused, the admin server's port and database are verified before every create, drop, reap or sweep, and orphans with a NULL comment are sweepable. Residuals, from `tests363/README.md` "Residuals" 1-8:
- **Databases of fully-skipped files** live until the run ends (about 407 MB each). After a SIGKILL or reboot, prefix-named databases remain until `sweep-per-file-dbs.sh` runs, with a 60-minute floor. **Never sweep during a run.**
- **Superuser password file.** Per-file mode needs the cluster superuser's password file. The test role is NOCREATEDB by contract. The password is never in env or argv, but the file path is in the environment and the file is readable by the same uid.
- **Speed and registry.** Per-file mode is about 16 % slower. `=1` depends on a maintained registry; use `=all`.
- **Refused DSN forms.** Per-file mode refuses any DSN query parameter (e.g. `?sslmode=`) and any port-mapped or tunnelled cluster. The `isolated-pg run` wrapper is unaffected.
- **Suites with known problems, not fixed in this scope:**
  - `settle-afl-api-state-b` has a hidden order dependence (F-1).
  - `admin-fixtures` deletes all 218 fixtures in shared mode (F-2).
  - `after-siren` contaminates other files in shared mode (F-3).
  - Two name-pinned suites skip in both modes (F-4).
- **Owner decision (3)**, the snapshot-oracle suites, still needs a rebuilt `afldb_test`.
- **Recommendation:** use `MODE=all` for integration runs, and file `settle-afl-api-state-b` as a follow-up.

### 2.10 Admin
- **Prior `auth_sessions` row (LOW):** stays live for up to 12 h after a fresh sign-in.
  - Protection: the 12 h TTL; a password change or deactivation revokes all sessions.
  - Alternative: revoke the prior row in the credential transaction, which is a policy change.
  - Recommendation: leave.
- **O-A05-1:** 1,247 line-ups (1931–1934) with a positive mirror and no round row remain unprotected.
  - Recommendation: (a) leave. There is no place to clear such a row, and inventing round rows is not acceptable.
  - Alternative: (b) add a clearing path first, then refuse.
- **Legacy unattributable votes:** rows without a round attribution are left as they are. Nothing is synthesised.
- **DEV `AFLDB_BETA_EPOCH`:** UNVERIFIED (not read). Production reads 1, so B-05 has no effect at deploy.
- **Known failures:** `data-editor` has 5 known snapshot-authority failures (precondition). `admin-brownlow` has the P2 snapshot oracle 9522.

### 2.11 Public
- **O-B06-1:** the busy state is HTTP 200 with noindex on a canonical pair URL, and the robots meta is duplicated.
  - Recommendation: (a) keep. A real 503 needs a middleware or route-handler change.
  - The busy.tsx comment is corrected (LOW-4).
- **O-B06-2:** limits default to 24 waiters and 10 s.
- **O-B08:** "the showdown" is still declined. Recommendation: keep.
- **R-B03:** the cue set is deliberately narrow. REVIEW-C MED-1 is fixed (`a563320a`): a leading "round" followed by a preposition, relative, conjunction, article or auxiliary is a period noun, so "round with most goals" no longer answers Barry Round. Residual: "round most goals" still answers Barry Round. That is a tested positive, but it could also mean "which round had most goals". The owner can drop the start-of-question cue entirely. The V5 corpus has no row containing "round", so its 0/12,000 change count proves nothing here; the unit and executing tests are the proof.
- **ISSUE-360 tie display:** no defect. The largest tie is 64 against a window of 200, and a larger tie prints "at least N more".

### 2.12 Qualification gaps (carried, not closed)
- **Retired fixtures:** the fitzRoy core import cases read the retired `full-history-20260902` (fixtures F-003, LOW). Run 2 found that snapshot and `sample.json` in authorised locations with matching hashes. Results are reported with and without them in `QUALIFICATION-2.md`.
- **No rebuilt `afldb_test`:** the snapshot-oracle failures rest on "same at baseline". That shows the remediation did not cause them; it does not show their cause.
- **Unclassified failure:** `database` "Brownlow correctness separates the war years".
- **Not re-run with clones:** the dedicated-clone Brownlow suites.
- **Never exercised:** systemd units, host-policy files and the ssh/rrsync paths have not run on production.
- **Root-only facts:** sudoers, the root crontab, the journal and `/var/log/unattended-upgrades` stay **unverified**.

### 2.13 Governance
- **ISSUE-332 gates:** G1–G7 and the 2026-11-04 decisions are adopted. G0, D-332-1, D-350-1/2 and D-HO-1..7 are **proposed only**. The proposed G0b/G0c split is not adopted.
- **ISSUE-331:** restrictions unchanged.

## 3. Incidents disclosed (production, read-only probing by the ops scope)

1. Probe scripts were copied by `scp` to `/tmp/afldb-rem2-ops-probe*.sh` on production, run and deleted. That departs from stdin-only probing; none remain.
2. A mis-quoted `grep` made the remote shell try to execute `backup.sh`. It failed with `Permission denied` (not executable), nothing ran and no state changed.

## 4. Review D (after REVIEW-C)

`REVIEW-D.md`: 0 CRIT/HIGH, 2 MED, 3 LOW, 5 INFO. Disposition:
- **MED-1, MED-2, LOW-5:** fixed (`ade11cc6`).
- **LOW-3:** fixed (`88e14e6a`). Residual, by choice: a surname question that puts a refused word directly after "aux round" (e.g. "has round in his career kicked …") now declines.
- **LOW-4:** fixed (`cdf2bce5`). The measurement showed the redirect's `Refresh` header also carried the token, and that the `/beta/verify/?token=` magic-link token leaked via `Location` too.
- **INFO F-006, F-007, F-009:** documented in the tests363 README.
- **INFO F-008, F-010:** no action.
- **Re-check of the fixes:** `REVIEW-D.md` § Re-check.

Pre-fix production logs may hold tokens in `resp_headers` as well as `uri`. This does not change the O-1 log recommendation (§2.8).
