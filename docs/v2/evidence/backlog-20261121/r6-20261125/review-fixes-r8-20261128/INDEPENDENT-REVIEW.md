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
