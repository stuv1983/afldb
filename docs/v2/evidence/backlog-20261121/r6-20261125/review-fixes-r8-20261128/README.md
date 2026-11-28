# R6 r8: an independent admin path for privileged work (F1), the owner procedure, and the dependency review (28 November 2026)

**Status: PROPOSED. Nothing installed. Production was not contacted. R6 stays NO-GO. PR 5 stays draft. MED-2 and MED-3 stay OPEN:
closing F1 is an owner action (Phases 0–4 of [OWNER-PROCEDURE.md](OWNER-PROCEDURE.md)), and both bundles still need installing.
The owner's "before P4" ruling stays unresolved.**

The owner's decision (28 Nov 2026): privileged installation, maintenance and recovery use an independently authenticated admin
path (an existing independent console if available, otherwise a separate admin account with its own key). The dedicated backup
producer (`afldb-backup`) and owner verifier (`afldb-verify`) stay. The guarantees are unchanged: G1, the identified timer
invocation produced the accepted dump; G2, the owner receives an authentic gate verdict. A labelled in-window catch-up is accepted.

## Pins

| Item | Value |
|---|---|
| Base (r7 round 2, = origin before r8) | `7e2ef51aa1682f6fded60158242b58ac07e2047b` |
| r8 commits | `89bd271e` (first delivery, reviewed in round 1) → `f8a63bb3` (round-1 fixes) → **`12e46305bf6b3ab063ffd7a2e8daf481eedfb8f3`** (round-2 fixes to the owner checks only) |
| **Tested revision** | **`12e46305bf6b3ab063ffd7a2e8daf481eedfb8f3`**. The procedure harness ran at it. The backup and verify harnesses ran at `f8a63bb3`, and `git diff f8a63bb3 12e46305` over `R7/backup`, `R7/verify` and both R7 harnesses is empty, so those runs are runs of the tested bytes |
| Delivered head | the pin commit (this record, the tested-revision placeholders filled with `12e46305`, trackers) on top of `12e46305`; no script differs from the tested revision |
| Sealed-backup bundle `R7/backup/SHA256SUMS` | `d0023d10…` → **`e3a68821c6f97ec7a5775cbf845b4018198556f44d29e89ceb6ff0c4e2672e7d`**: `sealed-origin.sh` `1153df78…` → `a733e67b898879d03e76b7d446d0f8bfbe0dd13923a586c19b42cdffd828887e` (both copies), `install-backup.sh` `f433b81a…` → `21c33fa4…`, `verify-backup-install.sh` `f286ea7b…` → `66b5be10…`; run `2c62ff91…`, sealer `793e94be…`, drop-in `f8a18580…`, `backup.sh` `df609046…` unchanged; base unit pinned at `edf00291…` (= `deploy/afldb-backup.service`) |
| Owner verifier `bundle/SHA256SUMS` = wrapper `BUNDLE_SHA` | `df3457cc…` → **`58fceba650dcd25ede0e55b25bfcb8a8236c3a4fe6ae6ebd94535832bbd506c8`** (`a2-core.sh`, `g0b-core.sh` labels; `sealed-origin.sh`) |
| Owner verifier packet `R7/verify/SHA256SUMS` | `221b254a…` → **`49e0fa7c84a549ba5153cec9d94c2fa2ca91d89aff34458dd9dc2fa9a4f13901`** (`build-sums.sh --check` PASS) |
| Owner checks `owner-checks/SHA256SUMS` (new) | **`70d05b10b4b1898e978550e113c9fefa06dd873c585e7d3445bf73b0fb8b648f`** (`afldb-owner-checks.sh` `5f2f9d8b…`) |
| R6 manifest / release `scripts/SHA256SUMS` | **unchanged** (`426c07ff…` / `52900a0e…`): no R6 script, release script, `tools/`, `deploy/` or `src/` file changed |
| Fenced blocks of the ATTENDED-PLAN and the release RUNBOOK | **byte-identical** to `7e2ef51a` (sha256 of the extracted blocks: plan `fb8c413b…`, runbook `b66fa4e8…`; recomputed by the reviewer), so r7's printed-block driver proof (c) and release rehearsal (d) still apply and were not re-run |
| Sitting artefacts | `sha256sum -c SHA256SUMS-SITTING`: 4 OK (unchanged) |

## What r8 changed

1. **F1 routing (prose only).** Every privileged install, maintenance, rollback and owner step in the ATTENDED-PLAN, the release
   RUNBOOK and the R7 READMEs now names its session: the provider console logged in **as root**, or the admin account
   `afldb-admin`'s own SSH session with its own key. `sudo` in an arm session, `ssh afldb … sudo`, and a console login *as arm* do not
   qualify: each runs arm's login shell, `~/.bashrc` (Debian's bash sources it even for `ssh host cmd`), `~/.ssh/rc` or
   `authorized_keys` options. Bundle bytes and expected digests come only from a `git archive` in the owner's **workstation** clone,
   carried over the admin path and re-verified as root against the workstation's values: never from arm's checkout, never `git` run
   as root in arm's repository, never a digest read from a file on production. The arm SSH connection carries only the unprivileged
   pinned scripts. Superseded r7 wording and pins in the plan are struck through (review R8-F-11).
2. **[OWNER-PROCEDURE.md](OWNER-PROCEDURE.md).** Phase 0 establishes a root console login. Whether the DigitalOcean Recovery Console
   can log in as root is UNKNOWN; if it cannot, the procedure STOPs, because there is no clean bootstrap through arm's account.
   Phase 1 creates `afldb-admin` from that console with a new workstation key. The key is installed only after a machine test (one
   line, key fields only, CR normalised, fingerprint equal to the workstation's), and verified in a new connection while the console
   stays open. Phase 2 runs the read-only checks. Phase 3 installs backup, then verifier, through the admin path, then STOPs. Phase 4
   (separate owner approval) removes arm from sudo only after two verified admin logins, with the console open and a back-out. §8 is
   the streamanator variant; §10 the consolidated checklist.
3. **Read-only checks** `owner-checks/afldb-owner-checks.sh` (A0–F6; each check's expected result and what stays blocked are in
   OWNER-PROCEDURE §2.3). They cover:
   * the session itself (does it descend from arm? loginuid, `SUDO_USER`);
   * arm's effective sudo and sudoers;
   * other arm→root routes: docker, lxd, disk, shadow, polkit, root-run units and cron (every path, symlinks followed, bare names
     resolved, FAIL only when arm can modify a component), root's startup files and authorized keys, ptrace scope, sshd;
   * PostgreSQL role privileges as OS user `postgres` by peer, with membership closure (NOLOGIN superusers, server-program and file
     roles), including the roles in arm's `.env` DSNs by user part only;
   * arm's ability to modify every protected path.

   Arm-side probes fail closed (completion sentinel, exit 0, 60 s timeout outside the dropped identity). No secret is printed.
4. **Installer guard.** `install-backup.sh` and `install-verify.sh` refuse, before any change, a root session that descends from arm:
   an ancestor with real or effective uid arm, `SUDO_USER`/`SUDO_UID` = arm, or loginuid = arm. The message is `REFUSED: root session
   descends from arm: <test>`. It is a tripwire for the procedural mistake, not a defence against an arm that already has root.
5. **`verify-backup-install.sh --as-arm`.** Root drops to arm with `setpriv --reuid=arm --regid=arm --init-groups --reset-env` and
   `bash --noprofile --norc`, with stdin `/dev/null`. arm's view is checked without arm's login or startup files. A run in arm's own
   session is INFO only, so r7's "as arm in a new login" is withdrawn as acceptance evidence. The probe does not stop a concurrently
   hostile arm process, which can signal it (a failure) or, only under `ptrace_scope=0`, trace it. Root's own checks and every gate
   do not depend on it (R8-F-12).
6. **`sealed_origin_install` pins the whole service (R8-F-7, the one review finding on a G1 input).** `DropInPaths` must be exactly
   the pinned drop-in, so any other drop-in in `/etc`, `/run` or `system.control` is refused by name. `Environment`,
   `PassEnvironment`, the bind, mount and image settings must be empty. The manager environment must set no shell- or
   loader-affecting variable. The base unit's content must equal `deploy/afldb-backup.service`. On production a different base unit
   or an extra drop-in (e.g. a `systemctl edit` override) is a fail-closed STOP, reported at install. The timer is deliberately not
   pinned: it moves only *when* the run happens, which rule 4 bounds (DEPENDENCIES C21; the reviewer accepts this).
7. **Other fixes.** `install-verify.sh` checks `lib.sh` and `verify-verify-install.sh` against the packet sums before sourcing or
   running them, and refuses staging under `/home`. r7 sourced a staged `lib.sh` as root before checking it (verify scenario `i`).
   The wrapper's `version` mode exits 1 unless both hosts give an authenticated PASS; r7 exited 0 with a STOP line (scenario `j`).
8. **[DEPENDENCIES.md](DEPENDENCIES.md).** 45 dependencies are classified: R7 README §4 items 1–18, DESIGN §4 obligations B1–B6,
   and trusted inputs C1–C21. The classes are P (backup provenance), V (verdict authenticity), I (an A-2 input that can be wrong
   while A-2 passes), S (STOP only) and D (display); counts P 16, V 13, I 18, S 9, D 5. Corrections:
   * The weekly restore's journal **content** is arm-authored. Only journald's trusted fields and PID 1's timer and start facts are
     trusted.
   * What a superuser arm role could and could not do.

   The verifier labels each arm-produced line `[ARM-PRODUCED …]` and prints `G0 SCOPE:` and `A2 SCOPE:` lines. An
   `OWNER VERDICT A2 PASS` says the live host matched the seven arguments. The arguments come from the Tuesday record, which arm-run
   scripts printed.

## Runs (DEV, streamanator as arm; disposable containers, never `--privileged`; no production contact; no lxc; no host sudo)

Every run used `--verify-rev`: each sent file equals its blob at the named revision, or, for the procedure harness, the stage tar is
`git archive <rev>` of the bundle paths. Logs: `runs-f8a63bb3/`, `runs-12e46305/` and `procedure-harness/logs/t12e46305-*`.

| Run | Revision, RID | Exit | Decisive lines |
|---|---|---|---|
| (a) sealed backup, real systemd, 15 scenarios | `f8a63bb3`, `tf8a63bb3` | 0 | `R7 BACKUP HARNESS RESULT PASS`; `containers left: 0 images left: 0` |
| (b) owner verifier end to end, real systemd, real sshd, Windows OpenSSH, 10 scenarios | `f8a63bb3`, `tf8a63bb3` | 0 | `R7 VERIFY HARNESS RESULT PASS`; `removed 2 container(s); left: containers 0, images 0, workspace removed` |
| (p) owner procedure, real systemd, real sshd | `12e46305`, `t12e46305` | 0 | `R8 PROCEDURE HARNESS RESULT PASS` (32 scenarios); `removed 1 container(s); left: containers 0, images 0, workspace removed, other r8p workspaces: 0` |

**(a) backup.**
* Attributed: the genuine run (`dispatch=scheduled delay=135.3s`).
* Under the production timer's `RandomizedDelaySec=10min`: `genuine-rd` is `scheduled` at 299.2 s and the in-window re-arm
  `rearm-in-rd` is `catch-up` at 267.6 s. The fixture re-arm `rearm-in` is `catch-up` at 0.0 s.
* Refused as before: hand-start, timer-then-hand, restart, rearm-out, pgdump-fails, seal-interrupted, post-pub-fail.
* `arm-sudo`: the installer refused three arm-descended root sessions (`SUDO_USER`; ancestor bash; ancestor sudo), state
  unchanged; the owner install passed the session check; `--as-arm` passed as arm with `afldb-backup-read`.
* `extra-dropin`: four injections refused by name (`Environment=`, `BindReadOnlyPaths=`, a `BindPaths=` drop-in sorting before `70-`,
  `systemctl set-environment BASH_ENV`). Removed: attributed again. CONTRAST: the r7 library attributes the run with the
  `Environment=` drop-in in place.

**(b) verifier.**
* a `g0-success`: `OWNER VERDICT G0 PASS … dispatch=scheduled …`, the G0 SCOPE line, 3 ARM-PRODUCED labels. G0b received the dump and
  sha256 only from the authenticated G0a line.
* b `g0-refusal`: a one-byte-longer published dump STOPs G0 at G0a; G0b is not called.
* c `a2-whole`: see the next section.
* d: hostile arm login files, shims, node, checkout and `.env` leave owner-path verdicts and exits unchanged, while the old arm path
  forges PASS.
* e: replay, stale, wrong-bundle, exit-lie and two-RESULT answers are refused.
* f: keys.
* g: the forged catalogue comment reaches the wrapper only as neutralised data.
* h: `install-verify.sh` through arm's sudo over a real arm ssh login is REFUSED, plain and with `SUDO_*` stripped.
* i: hostile `lib.sh` (in `/home/arm`, group-writable, tampered) is refused before sourcing; CONTRAST r7 (`7e2ef51a`) runs it as root.
* j: `version` exits 1 on an off-host STOP; CONTRAST r7 exits 0.

**(p) procedure.** arm with sudo, as on production today → `docker exec` as root standing in for the console (HARNESS; loginuid unset) → a `.pub` substituted by arm, and the real key behind an options prefix, refused; a CRLF key accepted after one CR is stripped → `afldb-admin` created with the workstation key; arm's key refused for it → stage from the workstation `git archive 12e46305` tar, digests equal → checks BLOCKED (B1, B2, B3: arm can sudo) → checks through arm's sudo BLOCKED with A2 (session not independent) → installer through arm's sudo `REFUSED: root session descends from arm`, nothing installed → both installs through the admin path, `verify-backup-install` as root and `--as-arm`, `verify-verify-install` PASS → checks still BLOCKED (installs alone do not close F1) → wrapper `OWNER VERDICT VERSION PASS` for the prod container → Phase 4: arm not allowed to run sudo, a second admin login with sudo → re-verify PASS → checks **PASS**. Fail-closed cases, each BLOCKED naming its check: a superuser role in arm's DSN (D1, D4), a NOLOGIN superuser granted to it (D1, D4), a group-writable verifier directory (E2), no admin account or key (F1, F5), an options prefix or a second line on the admin key (F5), a root-run unit path group-writable by arm's group (C3); a root:<other group> 0775 directory is reported, not failed; the control after revert PASS; no secret in any log.

**Void and superseded runs.**
* At `89bd271e` (runs `t89bd271e`), backup and procedure passed. The verify run failed scenarios i and j, only in their r7
  *contrast* sub-cases: the harness read its "r7" blobs from `HEAD`, which was r8 itself (R8-F-5; fixed by pinning `7e2ef51a`).
* The procedure run at `f8a63bb3` is **void**: it aborted with exit 2 at a syntax error because its driver script was being edited
  in the worktree during the run (bash reads a script as it runs). The run at `12e46305` replaces it.

**Not exercised:**
* the provider console itself;
* production's sshd, sudoers, host key, firewall and kernel;
* the loginuid branch of the guard (containers lack `CAP_AUDIT_CONTROL`);
* interactive `passwd`/`sudo` prompts;
* a base unit that differs from the pin;
* an arm process killing, stopping or injecting into a probe, and the 60 s timeout;
* a whole A-2 PASS (dated 2026-11-25).

## A-2 and G0, reported separately (verify scenario c, at `f8a63bb3`)

* **A-2 backup attribution:** `backup-origin=attributed`. The sealed timer run of the gate date, through `sealed_origin`, from root
  facts only.
* **Whole A-2:** `OWNER VERDICT A2 STOP`, **wrapper exit 1**, with 13 FAIL / 25 PASS lines. The FAILs are the historical date gate
  ("today is not the scheduled Wednesday (2026-11-25)", kept intact) and container limits: kernels, `/boot`, caddy, the apt timer, the
  weekly restore service. The A2 SCOPE line and 9 ARM-PRODUCED PASS lines are printed. A whole A-2 PASS has never been observed.
* **G0:** `OWNER VERDICT G0 PASS`, wrapper exit 0 (scenario a), G0a then G0b.

## Independent review

Reviewer: an independent Claude agent (model Fable) that wrote none of r8. It judged from git objects and reproduced on DEV. Record:
[INDEPENDENT-REVIEW.md](INDEPENDENT-REVIEW.md), logs `review-logs/`. **Astra was not reachable from this session; Astra's verdict
on the final revision is pending.**

* **Round 1, `89bd271e`:** no CRIT/HIGH/MED.
  * Twelve LOW/INFO findings (R8-F-1..F-12).
  * Q1 NO, Q2 NO, conditional on F1 on production and on streamanator's root path for G0b.
  * Reproduced: procedure 25/25 and backup 14/14 PASS. Verify 8/10: the R8-F-5 harness defect.
* **Round 2, `f8a63bb3` (changed bytes):** all round-1 findings closed.
  * Open: R8-F-4, the tested-revision pin, filled by the delivered head. Open in part: R8-F-11, this record not yet tracked.
  * New: R8-F-13 (LOW, CRLF key), R8-F-14 (LOW, C3 false BLOCKED), R8-F-15 (INFO, probe timeout), R8-F-16 (INFO). R8-F-16 is a wrong
    row number in a `sealed-origin.sh` comment, a denylisted manager environment and `NeedDaemonReload` unchecked, the last two
    root-only.
  * R8-F-7's fix and the timer reasoning accepted.
  * Q1 NO, Q2 NO (same conditions).
* **Round 3, `12e46305` (changed bytes):** R8-F-13, F-14, F-15 closed (F-13 reproduced in a Linux container); R8-F-16 left as INFO, agreed; new R8-F-17 (INFO: in templates with no loaded instance only absolute executable paths are judged) and R8-F-18 (INFO: C3 does not list components owned by another non-root user); "ready from the repository side", conditional on the procedure run at `12e46305` (it passed); Q1 NO, Q2 NO (same conditions).
* **R8-F-16 is not fixed (coordinator decision).** A comment-only change in the pinned G1 library would re-pin both bundles and
  re-run both harnesses. The two other parts need root to exploit. It is recorded here as INFO.

## Remaining (owner actions and stated residuals)

* **F1 (HIGH), production:** owner Phases 0–4. G1 and G2 do not hold on production until all of these hold, whatever the rehearsals
  show:
  * the root console login works;
  * the admin account works;
  * the Phase 2 checks pass;
  * arm's sudo is removed, or never authenticated in an arm session.
* **streamanator's arm is root-equivalent there.** This is REAL, from logged `id`: groups `sudo`, `lxd`, `docker`, and docker is not
  rootless.
  * Whoever controls streamanator's arm, these automated DEV sessions included, can forge `G0B PASS`, and so the off-host part of an
    owner `G0 PASS`.
  * It cannot forge the dump bytes, whose sha256 comes from the authenticated G0a line.
  * OWNER-PROCEDURE §8 makes it an owner decision: remove arm from those groups and reach root there by its own console, or accept
    G0B as not independent.
* **Unknown production facts**, recorded as UNKNOWN in OWNER-PROCEDURE:
  * whether the Recovery Console logs in as root;
  * sudoers and `timestamp_type`;
  * `ptrace_scope`;
  * sshd settings and the `Include` position;
  * whether any role arm can use is, or can become, a superuser;
  * python3.12;
  * whether the installed base unit equals the repository file and has no other drop-in.
* **Out-of-scope operator text** still prints `sudo …` hints meant for an arm session (`deploy/release.mjs:1197`,
  `deploy/post-install-check.sh:76,137-138`), and `docs/deployment.md` has root steps that install from arm's checkout. Neither is
  an R6 packet step. They are recorded for ISSUE-351 follow-up, not changed here.
* **Unchanged:**
  * the dated gates: A-2 requires Wednesday 2026-11-25; `g0` accepts Melbourne 2026-11-24..29; the P4 cutoff is 24 Nov 11:30;
  * the owner's unresolved "before P4" ruling;
  * the r7 residuals: B10 `pg_wrapper` by path; V1 root facts reader; V2 system helpers by path and ownership.

## Development history (not evidence for the tested revision)

Agent development runs at worktree bytes:
* `dev-logs/`: backup `r8bf` and `r8f7`, verify `r8vf`, and the smoke runs.
* `procedure-harness/logs/dev-a1-*`: FAIL. The bundle was mid-edit, and check F6 misread sshd's `forcecommand none`.
* `dev-a2-*`, `dev-a3b-*`, `dev-a4b-*`: PASS.
* `dev-a3-*`: FAIL, on a wrapper/bundle pin mismatch in the harness.
* `dev-a4-*`: FAIL. C3 marked bare command names UNKNOWN, which led to the bare-name resolution fix.
