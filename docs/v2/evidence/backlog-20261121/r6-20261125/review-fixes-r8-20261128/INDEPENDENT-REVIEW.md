# R6 r8 — independent review: admin-path routing (F1), owner procedure, read-only checks, dependency review (28 November 2026)

Reviewer: independent; wrote none of r8. Judged from git objects (`git show <rev>:<path>`), not the authors' summaries, and
reproduced on DEV where practical. **Revision judged:** `89bd271e0741bc0b390137547db4077d6075e070`, against its parent
`7e2ef51aa1682f6fded60158242b58ac07e2047b` (r7 round-2 state = origin). Line numbers are of the blobs at `89bd271e`.
Abbreviations as the brief: `R6`, `R7`, `R8`.

## Verdict in one paragraph

r8 does what the owner's decision asked and does it carefully. It adds a self-contained admin-path procedure
(`OWNER-PROCEDURE.md`) that reaches root without arm's login (provider console as root, or a separate `afldb-admin` account with
its own key and password), a 368-line read-only owner-checks script that is genuinely read-only and secret-free, an installer
guard that refuses a root session descended from arm **before any change**, a `--as-arm` acceptance path that drops to arm
through `setpriv` without arm's login, and a dependency review that classifies every input and closes the two repository-scope
false-PASS paths that still existed (the wrapper `version` exit and the `install-verify.sh` staging-`lib.sh` ordering). The gate
mechanics that carry G1/G2 — the sealer, run wrapper, drop-in, `sealed-origin.sh`, and the whole verify bundle except two
label-only files — are **byte-identical** to r7, so F2–F5, seal `/4`, `.done`, the dispatch-kind rule and every refusal survive
unchanged. **Q1 (can arm write/replace the accepted bytes before sealing?) NO; Q2 (can arm change the verdict Stu receives?)
NO — both still conditional on F1**, which r8 correctly leaves as an owner action and no longer mislabels as closed. I found no
new repository defect that produces a false PASS of G0, G0B, `backup-origin=attributed`, or a forged/stale/replayed verdict. The
remaining open items are the stated owner prerequisites (execute Phases 0–4; the superuser check; streamanator's root path) and
one pin-commit step (`<R8-PIN:tested-rev>` is still a placeholder at this revision, by design). Findings are all INFO/LOW (twelve): advisory checks that can pass narrowly (R8-F-1, -6, -9), one unpinned G1 input that needs a
past root act to abuse (R8-F-7), a by-eye key step (R8-F-8), an evidence-harness defect (R8-F-5) and wording.

## Method

* Read every r8-touched artifact at `89bd271e`: `OWNER-PROCEDURE.md`, `owner-checks/afldb-owner-checks.sh`, `DEPENDENCIES.md`,
  the four `procedure-harness/` scripts, and the full `git diff 7e2ef51a 89bd271e` over `R7/backup/`, `R7/verify/`, both R7
  harnesses, the R7 READMEs, `ATTENDED-PLAN-R6-20261125.md` and `release-17822b29-20261124/RUNBOOK.md`. Re-read the unchanged
  gate code (`afldb-backup-seal`, `afldb-backup-run`, `sealed-origin.sh`, the verify bundle) to anchor the regression check.
* Reproduced on DEV (streamanator, as arm, docker only, `--network none`, never `--privileged`), at the judged revision
  `89bd271e`, by running the packet's own harnesses with `--verify-rev 89bd271e --log-dir R8/review-logs/<name> rvw8…`:
  * **Procedure harness** `r8p-run.sh --verify-rev 89bd271e rvw8p`: **`R8 PROCEDURE HARNESS RESULT PASS`**, 25 scenarios PASS,
    pre-send verification confirmed every sent file equals its blob at `89bd271e`; residue afterwards 0 containers / 0 images /
    0 workspaces; secret scan 0 (`review-logs/procedure/`).
  * **Verify harness** `r7v-run.sh --verify-rev 89bd271e rvw8v`: **8 of 10 scenarios PASS** (a g0-success, b g0-refusal,
    c a2-whole, d hostile-arm, e stale-replay, f keys, g forged-comment, h installer-guard). Scenarios **i (staging-libsh)**
    and **j (version-exit)** report **FAIL** — but only in their *contrast* sub-case, and for a harness-tooling reason, not a
    deliverable defect (finding R8-F-5): the real r8 sub-cases all pass (i: home-arm/group-writable/tampered each refused
    before sourcing, marker absent, verifier state digest unchanged; j: control both-PASS→exit 0, off-host-STOP→exit 1). The
    authors' own recorded run (`dev-logs/verify-final/`) shows i and j PASS because it ran from a pre-commit HEAD whose
    contrast blob was the vulnerable r7 code (`7ab4ba61`); at the committed r8 revision the contrast blob is the fixed r8 code,
    so the old bug cannot be re-demonstrated. (`review-logs/verify/`.)
  * **Backup harness** `r7b-run.sh --verify-rev 89bd271e rvw8b`: **`R7 BACKUP HARNESS RESULT PASS`**, 14 scenarios PASS (attributed: genuine, perm, review2, rearm-in, genuine-rd, rearm-in-rd; refused: hand-start, timer-then-hand, restart, rearm-out, pgdump-fails, seal-interrupted, post-pub-fail; arm-sudo: installer refused three arm-descended root sessions with state unchanged); residue 0 containers / 0 images (`review-logs/backup/`).
* Verified every pin and digest from git objects (below). Did not contact production; nothing here proves production's real
  sshd, sudoers, PostgreSQL roles, host key or DigitalOcean console — where a finding turns on a production fact I cite the
  repository text that states it is UNKNOWN. I abandoned one bespoke offensive reproduction (crafted keys / `COPY TO PROGRAM` /
  process-kill races) and instead reason those cases by reading with the packet's own harness scenarios as corroboration.

## Pins and digests verified from git objects at `89bd271e`

| Item | Value at `89bd271e` | Check |
|---|---|---|
| `R7/backup/SHA256SUMS` | `d1c11c25…` | matches the 7 staged files (`sha256sum -c` from `git archive`): OK |
| `R7/verify/SHA256SUMS` | `3de9911c…` | matches; `build-sums.sh --check` → PASS |
| `R8/owner-checks/SHA256SUMS` | `d81525b6…` | matches `afldb-owner-checks.sh`: OK |
| `R7/verify/bundle/SHA256SUMS` | `28a23c64…` | matches; = wrapper `BUNDLE_SHA`; `build-sums.sh --check` consistent |
| `bundle/sealed-origin.sh` vs `backup/sealed-origin.sh` | `1153df78…` | byte-identical (`cmp`) |
| sealer / run / drop-in / backup.sh pins in `sealed-origin.sh` | `793e94be` / `2c62ff91` / `f8a18580` / `df609046` | equal the installed files |
| settle polkit rule pinned in owner-checks C2 | `3164e0d9…c50b64` | = `deploy/afldb-settle-afltables-trigger.rules` |

All four `<R8-PIN:…>` digest placeholders in `OWNER-PROCEDURE.md` are filled with these correct values. The **revision**
placeholder `<R8-PIN:tested-rev>` is still literal in `OWNER-PROCEDURE.md`, `RUNBOOK.md` and the plan — intentional per the brief
(a later pin commit fills it; the procedure states "filled when the coordinator commits").

## Q1 — can arm write or replace the accepted bytes before sealing?

**NO**, for a uid-arm process without root. **Conditional on F1.** r8 changed nothing in the provenance chain: the drop-in
(`User=afldb-backup`, `ProtectSystem=strict`, `ReadWritePaths=` staging only, `NoNewPrivileges`), `afldb-backup-run`
(`env -i`, fixed PATH, `cd /`), the root sealer (copy-into-root-0400-then-hash, seal before publish, `.done` last), and
`sealed_origin` (trusted paths, pinned digests, effective-unit, dispatch uniqueness) are **byte-identical** to r7
(`afldb-backup-seal` `793e94be…`, `sealed-origin.sh` `1153df78…`, both SAME). Round-2's Q1=NO therefore carries over; my backup
harness re-run at `89bd271e` exercised it again (see the harness row). The two r8 additions on the production side are a
**tripwire** (installer guard) and a **check** (`--as-arm`), neither of which weakens the chain; both fail closed.

## Q2 — can arm change the verdict Stu receives?

**NO** for the machine verdict (`AFLDB-VERIFY RESULT`, `OWNER VERDICT`, wrapper exit) and, since r7 round 2, for what the
terminal shows. **Conditional on F1.** The wrapper's authentication is unchanged at the core (`afldb-verify-call.sh:73-96`:
fresh 16-byte nonce, exactly one last `RESULT` line, mode/nonce/pinned-bundle/host match, `at=` within 300 s, `exit=` = ssh
status, PASS⇔exit 0) and the dispatcher/`lib.sh`/entry/sshd-conf/root-facts bundle files are **byte-identical** to r7. r8's two
wrapper edits both **strengthen** Q2: `version` now exits 1 unless *both* hosts answer an authenticated PASS (r7 fell through
the `case` at exit 0), and `A2 SCOPE:`/`G0 SCOPE:` lines plus `[ARM-PRODUCED]` labels make the class-I inputs legible without
touching any gate decision (only `echo`/`ok` string text changed in `a2-core.sh` and `g0b-core.sh`; no condition changed).

## Q3 — are the owner checks read-only, narrowly scoped, secret-free and correct?

**Read-only:** yes. The script writes only stdout; its one DB path is `runuser -u postgres -- … psql -X` running `SELECT`s
(`afldb-owner-checks.sh:221`); it starts nothing and changes no account. `as_arm` is `setpriv --reuid=arm --regid=arm
--init-groups --reset-env … < /dev/null` (`:48`) — arm's rights without arm's login, PAM session, startup files or
environment; reproduced clean (hostile `~/.bashrc`/`~/.profile`/`.pam_environment` planted, 0 startup markers). **Secret-free:**
yes — `san()` maps non-printable to `?` and truncates (`:39`); only fingerprints (never key bytes), role **names** and
variable **names** are printed; D4 parses each DSN but keeps the value in-shell and prints only `var=>role`, then `unset
envtxt` (`:241-256`); `passwd -S` prints only L/P/NP. **Correctness per check:** A (session-independence ancestry walk incl.
`SUDO_USER`/`SUDO_UID`/loginuid), B (arm sudo, groups, sudoers-naming, include trust, passwords), C (docker/lxd/… groups, polkit
hash-pinned to the settle rule, root-run units under `/home`, root cron, root startup files, root authorized_keys vs arm's,
ptrace_scope, sshd, ld.so.preload), D (superuser, server-program/file role membership, arm's DSN roles, pg_hba trust / pg_ident
maps), E (arm-writability of the protected set, root-side ownership/mode/ACL/symlink, filesystem sweep with `--accept`), F (the
admin account, groups, full-password sudo, usable password, key provenance, forced-command-free sshd) — each detects what it
claims, and the "expected / what stays blocked" column in `OWNER-PROCEDURE.md §2.3` is accurate (B1/B2 FAIL before Phase 4,
PASS after; installs alone leave BLOCKED). See F-INFO-1/2 for two cases where an arm-side check's PASS can be *suppressed* while
its root-side companion still fails closed, so no property PASSes while failing.

## Q4 — installer guard and `--as-arm`

**Guard** (`install-backup.sh:36-59`, `install-verify.sh:27-51`, identical logic): refuses before any change when an ancestor
(walk `$$`→PID 1 via `/proc/<pid>/status`) has arm's real/effective uid, or `SUDO_USER`/`SUDO_UID`=arm, or `loginuid`=arm;
prints `REFUSED: root session descends from arm: <test>` and changes nothing. It runs after `[ "$(id -u)" = 0 ]` and before the
staging/account work — correct ordering. No bypass for the intended case (sudo-in-arm-session): reproduced three ways (SUDO_USER
present; SUDO_* stripped → ancestor-bash fires; exec-replaced shell → ancestor-sudo fires), each REFUSED with state digest
unchanged (procedure harness `arm-sudo`). It is honestly a **tripwire, not proof**: root arm already holds can launch the
installer detached (`systemd-run`/`at`/cron) with a clean environment and unset loginuid — stated at `install-backup.sh:34-35`
and DEPENDENCIES C16. No false refusal of the legitimate admin path (admin uid ≠ arm, no arm ancestor). **`--as-arm`**
(`verify-backup-install.sh:38-58`): root re-executes the script's own bytes as arm via `setsid -w setpriv … --reset-env bash
--noprofile --norc -c "$BODY"`, stdin `/dev/null`, new session (no controlling tty), output sanitised + `[as arm]`-prefixed,
verdict = child exit status **and** dropped `id`==root's `id arm`; it first checks the file is a root-owned, non-group/other-
writable regular file, and prints both the file sha256 and the passed-bytes sha256 (must be equal). It genuinely avoids arm's
login and startup files (reproduced: 0 startup markers; INFO-only when actually run in an arm session). The residual that another
arm process can write into the child's pipe (same uid) is display-only and cannot change the exit status (DEPENDENCIES C19).

## Q5 — DEPENDENCIES.md classification and remaining false-PASS paths

The P/V/I/S/D classification is **correct**. Spot-checks: C7 (seven A-2 args → I, residual, now `A2 SCOPE` + label — the args
come from the arm-printed Tuesday record and nothing checks them: accurate); C9 (streamanator root → V/I, owner action — arm in
`docker`/`lxd`/`sudo` there is root-equivalent: accurate); C14 (wrapper `version` exit → fixed r8) and C15 (`install-verify.sh`
sourced staging `lib.sh` before trusting staging → fixed r8) are the only two repository-scope false-PASS paths, and both are
genuinely closed (C14: `afldb-verify-call.sh:131-139`; C15: `install-verify.sh:57-96`, inline `pre_trusted_path`, `/home`
refusal, lib.sh digest before `.`, and `verify-verify-install.sh` trusted+hashed before any change). I found **no remaining
repository-scope path** to a false PASS of G0, G0B, `backup-origin=attributed`, or a forged/stale/replayed authenticated
verdict: the authentication invariants are unchanged and byte-identical, and everything else is an owner action (F1=item 9,
superuser=item 17, streamanator=C9) or a labelled class-I input. The §2d counts (43 rows; no P/V arm-reachable without root
except the owner-session and fixed items) are consistent with the table. Operator wording about the trusted inputs — the seven
A-2 arguments' origin, and streamanator's root for G0B — is precise in the wrapper SCOPE lines and both READMEs.

## Q6 — regressions

Intact. The sealer, run wrapper, drop-in and `sealed-origin.sh` (G1), and the entire verify bundle **except** `a2-core.sh` and
`g0b-core.sh` (G2), are byte-identical r7→r8 (confirmed by per-file sha256). `a2-core.sh`/`g0b-core.sh` differ only in `ok`/`echo`
message strings (the `[ARM-PRODUCED]`/SCOPE labels), no condition changed, and the bundle digest + wrapper pin + packet SHA256SUMS
were re-derived consistently (`build-sums.sh --check` PASS). Seal `/4`, `.done`, the dispatch-kind rule, the dispatch-kind
recompute, and every refusal are therefore unchanged. Historical date gates intact at `89bd271e`: A-2 dated `2026-11-25`
(`a2-core.sh:174`, `r6-pre-verify.sh:452`), g0 Melbourne `2026-11-24..29` (`g0-core.sh:18`, `r1-g0-dump.sh:343`), P4 cutoff
`2026-11-24 11:30` (`r1-p4-gate-promote.sh:27`). Tuesday artefacts untouched: `sha256sum -c SHA256SUMS-SITTING` → OK;
`release-17822b29-20261124` diff is RUNBOOK.md prose only (session-rule notes), scripts and SHA256SUMS-SITTING unchanged. The
**fenced code blocks** of `ATTENDED-PLAN-R6-20261125.md` and `RUNBOOK.md` are byte-identical between `7e2ef51a` and `89bd271e`
(extracted-fences hash equal, fence count equal) — the r8 edits are prose outside the fences, so the coordinator's reuse of r7's
driver proof holds.

## Findings

| ID | Grade | One line | file:line | Basis |
|---|---|---|---|---|
| R8-F-1 | LOW | `E1` (arm cannot write the protected set) is judged by the arm-side probe's **output**; a co-operating arm process (same uid) can kill the probe so `w` is empty and E1 prints PASS — but the root-side `E2` checks ownership/mode/ACL/symlink of the same paths and fails closed, so the BLOCKED result still stands | `afldb-owner-checks.sh:299-308` | by reading |
| R8-F-2 | INFO | Same shape for `C6`/`F5` (arm's key set read as arm): suppressing arm's key listing hides an overlap test, but adding arm's key to root/admin `authorized_keys` requires writing a path E1/E2 protect, so suppression enables no attack | `afldb-owner-checks.sh:206-210, :354-358` | by reading |
| R8-F-3 | INFO | `C2` (polkit) emits a line only when a `.rules` file mentions arm; if the settle rule is absent no `C2` line is printed at all (silent, not FAIL) — correct (no arm polkit route) but asymmetric with the other checks | `afldb-owner-checks.sh:140-148` | by reading |
| R8-F-4 | INFO | `<R8-PIN:tested-rev>` is an unfilled placeholder in `OWNER-PROCEDURE.md`, `RUNBOOK.md` and the plan at `89bd271e`; the four digest pins are filled and correct, so a wrong fill would be caught by `sha256sum -c`, but the revision pin must be set by the coordinator's pin commit before the procedure is runnable | `OWNER-PROCEDURE.md:63-70` | by reading |
| R8-F-5 | LOW | The verify harness reads its scenario i/j **contrast** blobs from a hardcoded `HEAD:` (`git show HEAD:…install-verify.sh`/`…afldb-verify-call.sh`), not from a pinned pre-r8 revision; so `r7v-run.sh --verify-rev 89bd271e` — the documented command, run at the revision under test — reports i and j **FAIL** once the fix is committed, because the contrast blob is now the fixed r8 code. The real r8 sub-cases pass and the authors' pre-commit run was green, so this is an evidence-reproducibility defect, not a security defect. Fix: pin the contrast blobs to the pre-r8 revision (e.g. the parent of the fix) | `r7v-run.sh:81-82` | reproduced (rvw8v i/j FAIL; real sub-cases pass; authors' `dev-logs/verify-final/` green) |
| R8-F-6 | LOW | `D1`/`D4` can PASS while arm's DSN role can become a PostgreSQL superuser: `D1` flags only **login** roles that are themselves `rolsuper`, and `D4` tests the role's own `rolsuper` plus direct/inherited membership of the two server-program/file roles; a non-superuser login role that is a member of a NOLOGIN superuser role can `SET ROLE` to it and then run server programs as OS `postgres`. Impact is bounded (OS `postgres` cannot write the root-owned seal/published/code paths; `DEPENDENCIES.md:125` already treats a role takeover as gaining nothing over the seal or verdict). Fix: also FAIL when `pg_has_role(r.oid, g.oid, 'MEMBER')` holds for any `g.rolsuper` | `afldb-owner-checks.sh:227-232, :259-266` | by reading; not run against a PostgreSQL fixture |
| R8-F-7 | LOW | `sealed_origin_install` trusts the base `afldb-backup.service`/`.timer` fragments and **any additional drop-in** by root ownership only; it pins the digest of `70-afldb-backup-sealed.conf` and compares a fixed property list that does not include `Environment`, `BindPaths`/`BindReadOnlyPaths` or the exact `DropInPaths` set. A root-owned drop-in sorting after `70-` (the base unit and its neighbours were historically installed from arm's checkout through arm's sudo, `docs/backup-restore.md:126`) could set e.g. an environment the unpinned-environment `ExecStart` bash inherits. This needs a root act in the past, which `OWNER-PROCEDURE.md:80-82` declares as an accepted residual, and the code is byte-identical to r7 (not an r8 regression); but `DEPENDENCIES.md` has no row for the unit fragments' content and the stage tar (`OWNER-PROCEDURE.md:155`) does not carry them. Fix: require `DropInPaths` to be exactly the pinned drop-in, require `Environment` empty, and pin or stage-compare the base unit/timer digests | `R7/backup/sealed-origin.sh:113-170`; `R8/DEPENDENCIES.md:62` | by reading; not reproduced |
| R8-F-8 | LOW | Step 1.5 has the owner judge the carried admin public key by eye from raw output (`awk '{print $1}'`, `ssh-keygen -lf`, a line count), and 1.9 installs the whole file as `authorized_keys`; owner-checks `F5`/`F6` compare fingerprints only and do not reject an options prefix. An options-prefixed line does make `$1` differ from `ssh-ed25519`, so the written check catches it if read carefully, but the harness (`r8p-container.sh` phase 1) applies a stricter exact comparison than the step the owner is given. Fix: make 1.5 a machine test (exactly one line, exactly `ssh-ed25519 <blob>` plus optional comment, printable ASCII) and install only the type and blob fields; have `F5` FAIL on any option prefix | `OWNER-PROCEDURE.md:115, :119`; `afldb-owner-checks.sh:354-358` | by reading |
| R8-F-9 | LOW | `C3` judges only `Exec*`/`EnvironmentFiles` values containing `/home/`; a root unit with `Environment=PATH=/home/…`, an indirection through a root-owned symlink or wrapper, or a socket/timer/path unit activating one is not judged. `C6` reads only `/root/.ssh/authorized_keys` (not sshd's effective `AuthorizedKeysFile`/`AuthorizedKeysCommand` for root, which `C8` only reports). Both are narrow by design; the table should say so | `afldb-owner-checks.sh` C3 block, `:206-210` | by reading |
| R8-F-10 | INFO | Text/script mismatches in the procedure's check table: `B3` is described as covering arm's groups and include targets but the script greps `%?arm` in `/etc/sudoers` and `/etc/sudoers.d/*`; `A0`, `B5` and `C2` have no PASS line; the `C5` row lists `/etc/profile*`, which the script covers under `E`. The procedure also never tells the owner to define `R7=`/`R8=` in the [ADM-ROOT] shell, and `$BK`/`$VF` from 3.1/3.8 are unset in the fresh session of step 4.5 (fails closed, costs time on the day) | `OWNER-PROCEDURE.md:74-75, :200-230, :256, :263` | by reading |
| R8-F-11 | INFO | `verify/README.md` section 10 points at an R8 `README.md` pin table that does not exist at `89bd271e` (an untracked `R8/README.md` is in the working tree, outside the judged revision). `verify/README.md` is itself listed in `verify/SHA256SUMS`, so the pin commit must add the R8 README without touching it. The plan also keeps superseded "log in as `arm`" wording and the r7 digests `d0023d10…`/`221b254a…` beside the r8 override in the NG-CONSOLE/B-1/E-4 rows: correct when read top-down, easy to misread on the day | `R7/verify/README.md` section 10; `ATTENDED-PLAN-R6-20261125.md` (r8 override block and the three rows) | by reading |
| R8-F-12 | INFO | The `--as-arm` and `as_arm` probes run as uid arm, so another arm process can signal or (if `kernel.yama.ptrace_scope=0`, which `C7` only reports) trace them. "arm cannot change the exit status" therefore holds for arm's files and startup code, not for a concurrently hostile arm process; every such probe has a root-side companion or fails towards BLOCKED except as noted in R8-F-1/2. State the condition next to the claim | `R7/backup/verify-backup-install.sh` (`--as-arm` block); `afldb-owner-checks.sh` `as_arm` | by reading |

No CRIT/HIGH/MED finding. R8-F-6 to R8-F-12 are by reading only; R8-F-7 is the one I would fix first, because it is the only one that touches a G1 input rather than an advisory check. F1 remains HIGH **open** as an owner action, correctly carried forward and no longer mislabelled.
R8-F-5 is a defect in the evidence harness (`r7v-run.sh`), not in the installed/owner-run artifacts, and does not affect G1/G2.

## Overall — Q1/Q2 and merge-readiness

**Q1 NO, Q2 NO**, both conditional on F1 (root reached independently of arm's login on production, and of streamanator's arm for
G0b). With F1 as it stands on production today, arm can obtain root and both become YES — r8 states this plainly and supplies the
procedure to close it. The repository is in a state where **only operational prerequisites (owner actions) remain**, plus one
in-repo pin-commit step:
* Owner prerequisites (not repository defects): execute `OWNER-PROCEDURE.md` Phases 0–2 (console-as-root or `afldb-admin`;
  owner checks PASS), then Phases 3–4; check/revoke any superuser arm PostgreSQL role (item 17); decide streamanator's
  independent root path or label G0B arm-attested (C9).
* In-repo, before the procedure runs: a pin commit must set `<R8-PIN:tested-rev>` to the approved revision (F-4).

* In-repo defect, non-blocking: the verify harness's scenario i/j contrast resolution (R8-F-5, LOW) — fix so the committed
  evidence re-runs green at `--verify-rev 89bd271e`; the fixes it validates are independently proven by the real sub-cases.

No repository defect blocks merge of the owner-run/installed artifacts. The twelve findings are LOW/INFO robustness, wording and
evidence-tooling items; none opens a false PASS of G0, G0B, `backup-origin=attributed`, or an authenticated verdict.

## What I reproduced vs read

* **Reproduced on DEV at `89bd271e`:** the procedure harness (`R8 PROCEDURE HARNESS RESULT PASS`, 25/25, residue 0, secrets 0);
  the verify harness (8/10 scenarios PASS; i and j's *real* sub-cases PASS, their *contrast* sub-cases FAIL = R8-F-5, a harness
  defect); the backup harness (row above); the installer guard refusing arm-descended root sessions (procedure `arm-sudo`, verify
  `h`); `--as-arm` dropping to arm without startup files (procedure, backup); the F2 neutralisation still holding (verify `g`);
  stale/replay/exit-lie refusals (verify `e`); the pin/digest/`build-sums`/`sealed-origin` identity and the Tuesday `sha256sum -c`
  from git objects; the fenced-block identity of the plan and runbook.
* **By reading:** every finding except R8-F-5; the detailed per-check correctness of `afldb-owner-checks.sh`; the wrapper authentication
  invariants; the DEPENDENCIES classification. **Not verified (production facts, stated UNKNOWN by the authors):** production's
  real sshd/sudoers/PostgreSQL roles/host key, the DigitalOcean recovery console's root login, and whether arm's production
  PostgreSQL role is a superuser.

## Reproduction logs

`R8/review-logs/procedure/` (rvw8p-*), `R8/review-logs/verify/` (rvw8v-*), `R8/review-logs/backup/` (rvw8b-*), and the three
`console-*.log` drivers. Residue check after all three runs: `review-logs/residue-check.log` (2026-11-28T04:23:50Z: 0 containers, 0 images, 0 workspaces,
0 volumes or networks matching `rvw8`; the logged `ssh exit 1` is the final `grep -c` returning 1 on a zero count).

Working-tree note: at 04:12Z, after my verify run, `R7/verify-harness/r7v-run.sh` and `r7v-container.sh` were modified in the
worktree (uncommitted, not by me) to pin the contrast blobs to `7e2ef51a`, which is the fix direction of R8-F-5. That change is
outside the judged revision and I have not re-run the harness against it. `HEAD` was still `89bd271e` when I finished.

---

## Round 2 (f8a63bb3)

**Revision judged:** `f8a63bb3f8f5e035829f17cb38fce84f2292186f`, as `git diff 89bd271e f8a63bb3` (one commit). Line numbers are of
the blobs at `f8a63bb3`. Round 1 above is unchanged. Basis: the diff read in full for every code and procedure file; pins and
digests recomputed from git objects (`review-logs/round2/pins-f8a63bb3.log`); the committed development evidence
(`dev-logs/backup-f7/`, `procedure-harness/logs/dev-a3b-*`) read. I ran **no** harness in this round: the coordinator's three
final runs at `f8a63bb3` (`runs-f8a63bb3/`) were still in progress when I wrote this and I did not duplicate them. My view below
is therefore conditional on those three runs ending PASS.

### Verdict

The fixes are correct and I found no bypass, no regression and no new CRIT/HIGH/MED defect. R8-F-7, the only round-1 finding that
touched a G1 input, is closed: the service unit is now pinned whole. **Q1 NO, Q2 NO**, on the same conditions as round 1 (F1
closed by the owner on production, and streamanator's root path for G0b). Only operational prerequisites and the pin commit
remain; the four new items are LOW/INFO.

### 1. R8-F-7: `sealed_origin_install`

* The change is additive and confined to `sealed_origin_install` and the header comment (`R7/backup/sealed-origin.sh:27-41`,
  `:118`, `:126-165`, `:205-208`). `sealed_origin` (rules 4 to 6) has no changed line. The two copies are byte-identical
  (`a733e67b…`), and `verify-backup-install.sh:28` pins that digest.
* With `DropInPaths` required to equal the pinned drop-in (`:144`) and the fragment required to hash to `FRAG_SHA` (`:207-208`,
  `edf00291…` = `deploy/afldb-backup.service` at this revision, verified), every byte of unit text PID 1 can have loaded from
  disk is pinned. A drop-in in `/run`, in `system.control` (from `set-property`), in a type-level `service.d` or under a
  truncated-prefix name all appear in `DropInPaths`, so each is refused by name. The property checks (`:145-150`) and the
  manager-environment check (`:153-160`) are then defence in depth. I found no bypass by reading.
* False refusal of a genuine install: none in the committed evidence (`dev-logs/backup-f7/r7b-summary.log`: genuine, genuine-rd,
  rearm-in attributed; `r7b-extra-dropin.log:281-296`: four extras refused by name, restored state attributed, r7 library
  attributes with the `Environment=` drop-in in place). On production two things can now refuse a genuine install, both fail
  closed and both reported at install time by `verify-backup-install.sh`: an installed base unit that is not byte-identical to
  the repository file, and any other drop-in on the service. Whether either exists on production is unknown to me.
* **Timer not pinned (DEPENDENCIES C21): accepted.** The timer cannot change what runs, only when. Rule 4 requires the start
  job to come from the timer with its dispatch inside the window, requires exactly one seal in the window, and recomputes the
  dispatch kind. A root-edited timer yields another moment in the window or a STOP. Pinning it would also break the harness's
  `RandomizedDelaySec=0` fixture for no gain.

### 2. Owner checks

* `arm_probe` (`afldb-owner-checks.sh:52-67`): PASS needs exit 0 and the nonce sentinel as the last line. A killed probe gives
  FAIL. A stopped probe hangs the script (no timeout), which is never a PASS (R8-F-15). Injected output can only add lines, and
  added lines move E1, C6, D4 and E0 towards FAIL, not PASS. Forging a completed probe needs control of its exit status, which
  needs ptrace and therefore `ptrace_scope=0`; the script and DEPENDENCIES C19 say so and name the root-side companion of each
  probe. I accept that.
* C2 now always prints a line. C3 judges every root-run service. C6 uses sshd's effective `AuthorizedKeysFile` for root and
  returns UNKNOWN on an `AuthorizedKeysCommand`. D1/D2/D4 use `pg_has_role(…, 'MEMBER')` against every superuser role, which is
  the right closure in PostgreSQL 16, and a failed query yields FAIL or UNKNOWN, not PASS. F5 requires exactly one bare key
  line; F6 rejects an `AuthorizedKeysCommand`.
* Still read-only and secret-free by reading: no write outside stdout, SELECT only, fingerprints and role names only. The one
  side effect is unchanged from round 1: E0's `sudo -n true` as arm leaves an auth-log entry.

### 3. Procedure and plan

* Steps 1.4 to 1.9 (`OWNER-PROCEDURE.md:114-120`) are now a machine test: one line, `ssh-ed25519` plus 68 base64 characters plus
  an optional printable comment, only the type and key fields kept and installed, fingerprint compared to the typed paper value.
  This closes R8-F-8. See R8-F-13 for one false-STOP case.
* Session variables are set at the start of every admin root session, and 4.5 says so. Closes that part of R8-F-10.
* Plan strike-throughs are prose only. I recomputed the fenced-block hashes of the plan and the RUNBOOK against `7e2ef51a`:
  identical (`0bbf23e2…`, `c92bac1c…`).

### 4. Harnesses

* `r7v-run.sh:82-84` pins the contrast blobs to `7e2ef51a`. At that revision `install-verify.sh` is `7ab4ba61…` (the blob the
  authors' green pre-commit run used) and both files differ from the r8 blobs, so the contrast is meaningful again.
* New scenarios read: backup `extra-dropin`; procedure `pubkey-optprefix`, `pg-nologin-super`, `admin-key-option`,
  `admin-extra-key`. Each mutates one thing, expects a refusal that names it, and restores. `dev-a3b` reports 29 scenarios PASS.
  Not exercised anywhere: a base unit that differs from `FRAG_SHA`, the property checks reached without an extra drop-in, and a
  killed or injected probe (the procedure says so itself).

### 5. Pins (all verified from git objects)

| Pin | Value at `f8a63bb3` | Result |
|---|---|---|
| `R7/backup/SHA256SUMS` | `e3a68821…72e7d` | matches; `sha256sum -c` OK |
| wrapper `BUNDLE_SHA` = `R7/verify/bundle/SHA256SUMS` | `58fceba6…506c8` | matches; `sha256sum -c` OK |
| `R7/verify/SHA256SUMS` | `49e0fa7c…13901` | matches; `sha256sum -c` OK |
| `R8/owner-checks/SHA256SUMS` | `2568c25f…740ae` | matches; `sha256sum -c` OK |
| `build-sums.sh --check` | | PASS |

Unchanged since `89bd271e`: sealer, run wrapper, drop-in, `install-backup.sh`, `install-verify.sh`, the verify bundle other than
`sealed-origin.sh`, `deploy/`, `tools/`, `src/`. `<R8-PIN:tested-rev>` is still a placeholder (R8-F-4).

### Status of round-1 findings

| ID | Status | Note |
|---|---|---|
| R8-F-1 | closed | fail-closed probe; E2 companion |
| R8-F-2 | closed | same, C6/F5 |
| R8-F-3 | closed | C2 prints PASS when no rule mentions arm |
| R8-F-4 | open, by design | pin commit fills the revision |
| R8-F-5 | closed by reading | contrast pinned to `7e2ef51a`; confirm with the coordinator's verify run |
| R8-F-6 | closed | membership closure in D1/D2/D4; rehearsed `fc-pg-nologin-super` |
| R8-F-7 | closed | service unit pinned whole; timer reasoning accepted |
| R8-F-8 | closed | machine test, fields-only install, F5 strict |
| R8-F-9 | closed | C3 widened, C6 uses sshd's path; see R8-F-14 |
| R8-F-10 | closed | table text matches the script; session variables stated |
| R8-F-11 | open in part | plan wording struck through; the R8 `README.md` that `verify/README.md` points at is still untracked |
| R8-F-12 | closed as documented residual | DEPENDENCIES C19 |

### New findings

| ID | Grade | One line | file:line | Basis |
|---|---|---|---|---|
| R8-F-13 | LOW | Step 1.5a refuses a public key file with CRLF line ends, and the STOP text blames arm. Windows OpenSSH `ssh-keygen` writes CRLF (reproduced on the workstation: 84 bytes, CR present); Git Bash's writes LF, and the procedure says Git Bash, so this bites only if the key is made elsewhere. Fail-safe. Fix: strip CR in 1.4, or name the cause in the STOP column | `OWNER-PROCEDURE.md:114-116` | reproduced (key generation only) |
| R8-F-14 | LOW | C3 now fails on any root-run service whose executable, file argument or `EnvironmentFile` has a group-writable or ACL-bearing path component, and there is no acceptance list as E3 has. On Ubuntu `/var/log` is `root:syslog 775`, so a root service with an existing file argument under it would block Phase 2 for an unrelated reason. Fail-safe, but it can stop the procedure on the day. Fix: an `--accept`-style list for C3, or limit the group-writable test to groups arm is in | `afldb-owner-checks.sh` C3 block (`:176-236`, `trust_res` at `:182`) | by reading; not run on a stock production-like host |
| R8-F-15 | INFO | `arm_probe` has no timeout: an arm process that stops the probe hangs the owner checks. Never a PASS. Fix: `timeout` around `as_arm` | `afldb-owner-checks.sh:52-67` | by reading |
| R8-F-16 | INFO | The manager-environment check is a denylist, and PID 1's loaded state is checked only for the listed properties, so a unit reloaded from different text and then restored on disk is caught only for those. Both need root. Sturdier: an allowlist of manager variables, and `NeedDaemonReload=no`. Also `sealed-origin.sh:40` cites row C20 for the timer, which is C21; the file is pinned, so leave it until the next change | `R7/backup/sealed-origin.sh:40`, `:153-160` | by reading |

### Merge-readiness for `f8a63bb3`

Ready from the repository side, subject to the coordinator's three final harness runs at `f8a63bb3` ending PASS. No finding
blocks. Remaining before the procedure can run: the pin commit (fill `<R8-PIN:tested-rev>`, add the R8 `README.md` without
touching `verify/README.md`), then the owner's Phases 0 to 4. Not verified: any production fact, including whether the installed
base unit equals `edf00291…` and whether the service has other drop-ins; the fragment-mismatch refusal; a killed or injected
probe.

---

## Round 3 (12e46305)

**Revision judged:** `12e46305bf6b3ab063ffd7a2e8daf481eedfb8f3`, as `git diff f8a63bb3 12e46305` (one commit). Line numbers are
of the blobs at `12e46305`. Rounds 1 and 2 above are unchanged. Changed code and procedure files: `afldb-owner-checks.sh`
(`5f2f9d8b…`), its `SHA256SUMS` (`70d05b10…`, verified from the git object, as is the entry inside it), `OWNER-PROCEDURE.md`,
`r8p-run.sh`, `r8p-container.sh`. Nothing under `R7/`, `deploy/`, `tools/` or `src/` changed, so every round-2 statement about
the gate code, the bundles and their pins stands. I ran no harness; the coordinator's procedure run at `12e46305` was in progress
when I wrote this, and my view is conditional on it ending PASS.

### Verdict

The three fixes are correct. No change lets a check PASS while arm can modify a root-run path, or while the key or probe
property fails. The script is still read-only and secret-free. No new CRIT/HIGH/MED finding; two INFO notes. **Q1 NO, Q2 NO**,
on the same conditions as before.

### R8-F-13 (CRLF key): closed

* Step 1.3 strips CR on the workstation; step 1.5a strips one trailing CR per line, then applies the unchanged shape test, and
  only the type and key fields are installed (`OWNER-PROCEDURE.md:113-116`). The STOP text no longer blames arm.
* Reproduced in a Linux container on DEV with synthetic key lines (`review-logs/round3/shape-linux-12e46305.log`): LF and CRLF
  accepted, and the kept line from the CRLF file is byte-identical to the LF one; two trailing CRs, a CR inside the comment, an
  options prefix, two lines, a trailing empty line and another key type are all refused.
* The strip widens nothing: the installed bytes are the two validated fields, and 1.5b still compares their fingerprint.
* My first local attempt in Git Bash (`key-shape-12e46305.log`) is not valid evidence for the CR cases and is marked so in the
  log: Git Bash's `grep` and `sed` treat CR differently.

### R8-F-14 (C3): closed

* `am_one`/`am_walk`/`arm_mod` (`afldb-owner-checks.sh:192-254`) walk every component from `/`, follow every link and walk its
  target in full, and FAIL when arm owns the component or link, when it is group-writable by a group arm is in, world-writable
  (sticky directory excepted), carries an ACL entry granting write to arm or one of arm's groups, or is absent below a directory
  arm can write. Anything not evaluable is UNKNOWN (`:315-317`), never PASS.
* I looked for a PASS with an arm-modifiable component and found none by reading:
  * ACL permissions are read before the effective-rights comment, so a mask does not hide a grant (conservative).
  * `default:` ACL entries are reported, not failed. That is right: they grant nothing on the component itself.
  * After a link, the parent-writable flag is the target's, so an absent leaf below an arm-writable link target still fails.
  * A sticky world-writable directory passes only for an existing entry arm does not own; an absent entry in it fails.
* Bare command names are judged through systemd's search path, every slot up to the first that exists (`:256-270`). This is a
  real gap closed, not only a false-UNKNOWN fix.
* False BLOCKED on a normal Ubuntu 24.04 host: none that I can foresee. A FAIL now needs a component arm can write, and UNKNOWN
  needs a failed `stat`/`getfacl`/`readlink`, a relative path or a link loop. The development run judged 112 to 113 root-run
  units and about 185 paths in an Ubuntu 24.04 systemd container with PASS. Production's own units remain unknown to me, and a
  root-run unit there that really does execute something arm can write is a true FAIL.

### R8-F-15 (probe timeout): closed

* `arm_probe` runs under root's `/usr/bin/timeout --kill-after=5 60`, outside `setpriv` (`:63-72`). arm cannot signal the
  timer. A stopped or hung probe ends with a non-zero status, so `PROBE_OK` stays 0 and the caller reports FAIL. A missing
  `timeout` also fails closed. PASS still needs exit 0 and the nonce sentinel as the last line.
* Not exercised by any scenario (the procedure says so): a killed, stopped, injected or timed-out probe. By reading only.

### Read-only and secret-free

Unchanged. C3 adds `stat`, `getfacl`, `readlink` and `realpath` reads and prints paths with owner, group and mode. No file
content, DSN, key material or environment value is printed.

### R8-F-16

I agree with the coordinator's decision to leave it as recorded INFO. The only repository change it asks for inside the pinned
library is a comment (C20 for C21), and re-pinning both bundles for a comment would cost a full re-test for no security gain. The
allowlist and `NeedDaemonReload` ideas are hardening against a root act and can wait for the next real change to that file.

### Status of findings

| ID | Status at `12e46305` |
|---|---|
| R8-F-1, -2, -3, -5, -6, -7, -8, -9, -10 | closed (round 2) |
| R8-F-4 | open by design: the pin commit fills `<R8-PIN:tested-rev>` |
| R8-F-11 | open in part: the R8 `README.md` that `verify/README.md` points at is still untracked |
| R8-F-12 | closed as a documented residual |
| R8-F-13 | closed; reproduced |
| R8-F-14 | closed by reading; scenarios `fc-c3-gw-other`, `fc-c3-gw-arm` in the coordinator's run |
| R8-F-15 | closed by reading; not exercised |
| R8-F-16 | INFO, recorded, deliberately not fixed; agreed |

### New notes

| ID | Grade | One line | file:line | Basis |
|---|---|---|---|---|
| R8-F-17 | INFO | In the template branch (unit templates with no loaded instance) only absolute executable paths are judged; a bare command name there is skipped, while loaded units get the search-path treatment. Loaded instances are judged through `systemctl show`, so the gap is an uninstantiated template only | `afldb-owner-checks.sh:283` | by reading |
| R8-F-18 | INFO | C3 reports group-writable and ACL-bearing components but says nothing about a component owned by another non-root user. That is correct for "can arm modify it", and D1/D2 cover arm becoming `postgres`; listing such owners in the report would let the owner see them | `afldb-owner-checks.sh:192-223` | by reading |

### Merge-readiness for `12e46305`

Ready from the repository side, subject to the coordinator's procedure harness run at `12e46305` ending PASS (the backup and
verify bundles are byte-identical to `f8a63bb3`, whose final runs are recorded). No finding blocks. Remaining: the pin commit
(fill `<R8-PIN:tested-rev>`; add the R8 `README.md` without touching `verify/README.md`), then the owner's Phases 0 to 4. Not
verified: any production fact; the probe failure paths; C3 against production's real unit set.
