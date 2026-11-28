# R6 r5 and release G0: Astra's two remaining merge blockers on draft PR 5 (27 November 2026)

**Status: PROPOSED. Not approved, not installed, not run on production. R6 stays NO-GO. PR 5 stays draft. Astra has not re-reviewed this.**
Production was not contacted. Everything below ran on the workstation (Git Bash) and on the DEV host streamanator as `arm`, in
private `mktemp` directories and disposable `--network none` containers, without sudo.

| Item | Value |
|---|---|
| Reviewed head (Astra's two findings) | `f92d6e2938c99a747ac90a14f14d5130b7ffffe0` |
| **Tested revision** (scripts, suites, harness) | `5553ecaf922d27a82da1d8f9a63633bb2883372d` |
| Review revision (R6 printed blocks and the release runbook correction re-pinned to the tested revision; no script differs) | `7705c18eaf9ce67f830716c2361d5906b1763f14` |
| R6 manifest (16 files) | `182efbb6b31f70833eb6bfd4be8e1a80bb887b66da0bbeca782ea86f2dc90c82` (r4 `3c671c4b…`) |
| Release `scripts/SHA256SUMS` (12 files) | `14f0f89f36bffbbabf0309adb4541973fb7a6d5854dddfa31fce66532bb87567` (r4 `744e52ca…`) |
| Changed pins | `r6-tuesday-handoff.sh` `be0fbca2…` → `820f5d53…`; `r6-pre-verify.sh` `ea4355f0…` → `64cc5166…`; `r1-g0-dump.sh` `bbc3d96f…` → `32d7315a…` |
| Prospective, NOT installed | `tools/maintenance/scheduled-backup.sh` `234fca6a…` (what `17822b29` and production carry) → `bab61796…` |

`orig-f92d6e29/` holds the reviewed bytes of the four changed scripts (each equal to its `f92d6e29` blob), so every contrast case runs
the defect on the original. The 24 Nov sitting record, approval and both parser logs are unchanged (`sha256sum -c SHA256SUMS-SITTING`:
4 OK, before and after). The r2, r3 and r4 logs are unchanged.

## 1. Finding 1: the handoff parser certified `released` after an interrupted rollback

**Defect.** In `r6-tuesday-handoff.sh` at `f92d6e29`, the `released` branch looked only at the rollback wrapper's RESULT lines. `r1-rollback.sh
links` prints `ROLLBACK RESULT LINKS SWITCHED …` only after `release.mjs rollback` has switched the links and its own checks have passed.
A wrapper interrupted after the switch leaves `release: ROLLED BACK to …` (release.mjs `cmdRollback`, `log()` prefixes `release: `) and no
RESULT line, and the parser certified `tue:released`.

**Record.** Astra's own text was not available in the repository or on the PR (there are no PR comments). [`cases/astra-released-interrupted-rollback.md`](cases/astra-released-interrupted-rollback.md)
is a reconstruction from the brief's description, built from the lines the Tuesday scripts actually print. It has valid P3b, P4 and P5 evidence (`P3b RESULT BUILD PASS`,
`P4 RESULT PROMOTED`, the P5 binding line, `P5 RESULT ACCEPT PASS (1-4)`), then the wrapper's links-mode output up to and including
`release: ROLLED BACK to 7d92042fd110-… (no rebuild); previous is now 17822b29e6de-….`, no `ROLLBACK RESULT LINKS SWITCHED`, and
R6-HANDOFF lines claiming `released`. Its header says it was reconstructed by the implementer; the description came from the owner's brief.

**Fix.** `rbtrace` is called for `released` and `deferred`. Any of these, anywhere on a line (any indentation, fence, table cell or
prefix), is a STOP:
- `release: ROLLED BACK`;
- the wrapper's `== R1 rollback links|verify` headers;
- its post-switch `PASS current -> 7d92042fd110-…, previous -> 17822b29e6de-…`;
- an events.log `"op":"rollback-start"` or `"op":"rollback"` entry.

`rolledback` keeps these traces by design. Its rules are unchanged: an interrupted rollback claiming `rolledback` already STOPs for lack
of RBL. Prose naming the rollback procedure is not a trace. A bare `PASS current -> <old id>` is not a trace either, because
`r1-p1-precheck.sh` prints it and the real 24 Nov record contains it at line 64.

| Check | Command | Exit | Decisive output |
|---|---|---|---|
| Astra record, f92d6e29 parser | `bash orig-f92d6e29/r6-tuesday-handoff.sh cases/astra-released-interrupted-rollback.md` | **0** | `R6-A2-TUESDAY tue:released` … `R6 HANDOFF RESULT PASS` (the defect) |
| Astra record, corrected parser | `bash ../r6-tuesday-handoff.sh cases/astra-released-interrupted-rollback.md` | **1** | `STOP released, but the record has 1 release.mjs 'release: ROLLED BACK ...' line(s)…`; `STOP … rollback trace line(s) (r1-rollback.sh header …)`; `R6 HANDOFF RESULT STOP (2)`; no `R6-A2-` line |
| Real 24 Nov record, corrected parser | `bash ../r6-tuesday-handoff.sh ../../../release-17822b29-20261124/SITTING-20261124.md` | 0 | `tue:deferred`, `7d92042fd110-XWruOm_9nLCSMY8nGPqYU`, `inv:342040625f6d4012a35d598dfbf9afe6`, both R6-NOTEs: the parser does not rule on "before P4", which stays the owner's open input |
| Suite f1 (existing, extended 73 → 112) | `cases/f1-handoff.sh` | 0 | `SUITE f1 RESULT PASS (112 cases)` on the workstation, on streamanator and inside the driver run at the tested revision. It covers: the Astra record and 17 released variants (bare, indented, fenced, quoted, table, truncated tool line, headers, events tail, whole links output); 6 deferred variants; an interrupted rollback claiming `rolledback`; valid released, verified-rolledback and deferred records PASS; 10 `f1-orig5-*` contrasts where the f92d6e29 parser falsely certifies `released` |

Logs: [`logs/f1-astra-before-after-20261127T111112Z.log`](logs/), `logs/f1-workstation-…log`, `logs/f1-streamanator-…log`.

## 2. Finding 2: a manual backup could pass as the scheduled one

**Defect.** Astra's case: the timer dispatches at 02:20:00, the timer's own invocation fails where arm cannot see it (PID 1 alone logs a
failed dependency or an exec failure), and a manual `systemctl start` at 02:20:03 succeeds with a valid dump, sidecar and digest. The
f92d6e29 `match_backup` checks timing (`LastTriggerUSec` in the window, start within 5 s), success, one visible invocation and its
`backup ok` line. All of that is equally true of the manual run, so both gates PASSed and printed `OFFHOST-COMPARE`.

**What the supported system exposes to arm.** Measured on real systemd 255.4-1ubuntu8.19 (Ubuntu 24.04.4, the production release), with a
real timer and service and a non-adm `arm` (`logs/real-systemd-evidence.log`, E1–E4):

| Source | Binds the dispatch to the invocation? |
|---|---|
| `TRIGGER_UNIT` / `TRIGGER_TIMER_REALTIME_USEC` in the run's environment | **No.** They keep the first timer start since the unit was loaded. A manual run after a failed timer run inherits them, equal to `LastTriggerUSec` to the microsecond (`real-systemd-astra-exec-r5.log`), and a second night's genuine run carries the first night's value (`…second-night.log`). |
| The unit's `ActivationDetails` | **No.** It is stale in the same way, and `[unprintable]` through `systemctl show`. |
| `ExecMainStartTimestamp` vs `LastTriggerUSec`, other visible invocation IDs | **No.** That is a timing coincidence; the failed timer invocation is invisible. |
| PID 1's journal lines about the unit | They would show both invocations, but arm cannot read them (E4); with volatile storage arm reads nothing at all. |
| **The run's own start job: `org.freedesktop.systemd1.Job` `ActivationDetails`** (system bus, readable by any user, only while the job exists) | **Yes.** It is fresh per job: a timer-created job carries `trigger_unit=afldb-backup.timer` and `trigger_timer_realtime_usec` equal to the timer's `LastTriggerUSec`. A job from `systemctl start` carries `a(ss) 0`. A failed or skipped dependency at the timer's dispatch leaves nothing for the later manual job (E3). |

The job exists only during the run, so after a oneshot has exited nothing arm can read binds the dispatch to the invocation. **The
current setup cannot supply the evidence.** Production's `scheduled-backup.sh` (`234fca6a…`, the `17822b29` blob) logs no origin.

**Fix (both callers, byte-identical shared functions).** `r1-g0-dump.sh` (G0) and `r6-pre-verify.sh` (A-2 section 5) now require, beyond
every r4 link, that the attributed invocation logged **exactly one** `trigger: invocation=<id> job=<n> unit=<…> realtime_usec=<…>` line, and that this line:
- names that same invocation;
- has `unit=afldb-backup.timer`;
- has a `realtime_usec` equal to `busctl get-property … Timer LastTriggerUSec` in microseconds (with a seconds cross-check).

journald stamps the line with `_SYSTEMD_UNIT` and `_SYSTEMD_INVOCATION_ID`. Any miss prints `scheduled origin unproven: …`, exits nonzero, does
not examine the dump and prints no `OFFHOST-COMPARE`. Neither gate reads the off-host copy or the pull stamp; the 03:10 pull cannot supply origin.
No path accepts a manual run; accepting one needs Stu's explicit decision. `busctl` was added to G0's command inventory.

**Prospective change, NOT installed.** `tools/maintenance/scheduled-backup.sh` gains `log_trigger`. In backup mode, after the `target:` line,
it finds its unit from `/proc/self/cgroup`, checks the unit's current InvocationID equals `$INVOCATION_ID`, reads its start job's
`ActivationDetails` with `busctl`, and logs the `trigger:` line (`unit=none` when absent, with a `trigger-note:` reason). Every read is
bounded by `timeout 5`, and nothing in it can fail the backup or change its exit code.

### Reproductions and positive controls

| Case | Path | f92d6e29 gates | Corrected gates |
|---|---|---|---|
| Astra, fixture, **today's production script** (no trigger line), manual run's journal intact (`target:`, `backup ok`) | each gate's real `main`, as arm, f23 shims | G0 **0**, A-2 **0**, `OFFHOST-COMPARE` printed | G0 **1** `G0 PROD RESULT FAIL`, A-2 **1** `R6 PRE RESULT STOP (1 FAIL line(s))`: `scheduled origin unproven: invocation c1c2… logged 0 trigger lines`; 0 `OFFHOST-COMPARE` |
| Astra, fixture, **r5 script** (the manual run logs `unit=none`) | same | G0 0, A-2 0 | G0 1, A-2 1: `scheduled origin unproven: the run's start job names trigger unit 'none'`; 0 `OFFHOST-COMPARE` |
| Astra with a later off-host copy present | f2 suite | — | same STOP; the copy's atimes are unchanged (an instrument self-test proves a read would change them) |
| Astra on **real systemd**: the timer's run fails at exec (203/EXEC, PID 1 only), root `systemctl start` 3 s later succeeds | real timer and service; G0 real `main`; A-2 section 5 functions | G0 0, A-2 0 | G0 1, A-2 1, `scheduled origin unproven`, no `OFFHOST-COMPARE` (`real-systemd-astra-exec-r5.log`) |
| Astra on real systemd, failed dependency, r5 script / today's script | same | 0 / 0 | 1 / 1 (`real-systemd-astra-dep-r5.log`, `…-dep-current.log`) |
| **Genuine timer run, r5 script** (positive control) | same | PASS | **G0 0 `G0 PROD RESULT PASS`, A-2 functions 0, `OFFHOST-COMPARE` printed**; trigger line `job=151 unit=afldb-backup.timer realtime_usec=1795779325102574` = busctl `LastTriggerUSec` `t 1795779325102574` (`real-systemd-genuine-r5.log`) |
| Genuine second night, r5 script (unit-level details stale) | same | — | PASS (`…genuine-r5-second-night.log`) |
| Genuine timer run, **today's production script** | same | — | G0 1, A-2 1, `scheduled origin unproven`: fail-closed against production as it stands (`real-systemd-genuine-current.log`) |

Real-systemd recipe (`real-systemd-attribution.sh` → `real-systemd-container.sh`), one container per scenario on streamanator:
- container flags: `--network none --cgroupns=private --tmpfs /run --tmpfs /run/lock --cap-add SYS_ADMIN --security-opt apparmor=unconfined`, **not** `--privileged`; the entry script remounts the container's cgroup2 read-write;
- a container-local fixed-offset `Australia/Melbourne` zone, so the real 02:20 dispatch falls on 2026-11-28 local, inside G0's accepted days;
- the real `deploy/` unit files plus a drop-in (`RandomizedDelaySec=0`, `AccuracySec=1s`) and a stub `postgresql.service`;
- `backup.sh` is a documented stub that writes a random-byte dump with the real naming and output line (no database).

A-2's `main` refuses any day but 2026-11-25, so its section 5 ran as its seven shared functions, extracted verbatim, with section 5's own calls.
Every container, the one image built (`r5f2-sysd-r5f2220241:1`, `bab74550504c`) and the workspace were removed. Docker's unlabelled build cache from that build was left.

## 3. Verification at the tested revision

| Run | Command | Exit | Result |
|---|---|---|---|
| Driver proof (printed blocks verbatim at the review revision, all suites in disposable containers) | `bash <(git show 5553ecaf…:…/review-fixes-r3-20261124/prove-driver-fixes.sh) 5553ecaf… 7705c18e… <out> r4` | 0 | run 1 `R6 r4 REHEARSAL RESULT PASS`: 419 `CASE-RESULT … OK`, 0 UNEXPECTED; `release-scripts-manifest OK` (digest `14f0f89f…`); f1 112, f2 159, f3 32, f4 12, f5 21, f6 21, f7 29; in-container prod 144/0, wronghost 2/0. Run 2 (`b5-symlink-identical` sabotage) exit 1, that case UNEXPECTED; `R6 r4 DRIVER PROOF PASS`; sentinels intact, no residue (`logs/proof-driver-5553ecaf-review-7705c18e.log`) |
| Release rehearsal (streamanator, clean `git archive` of `5553ecaf`, export sha256 `4fbd1df6…`) | `bash rehearsal/rehearse.sh <export> <bundle: claude/release-17822b29-prep-20261123 = 17822b29> /mnt/ssd/afldb-verify-20261108T002136Z/node_modules` | 0 | `REHEARSAL RESULT PASS: 92 passed, 0 failed` (`logs/release-rehearsal-5553ecaf.log`). An earlier attempt with a bundle whose branch tip was the prep commit `90528ed1` failed 4 origin/P2 checks (88/4), an environment fault, kept as `…-wrong-bundle-env-fail.log` |
| Unit tests (same export, node v22.23.2) | `node node_modules/vitest/vitest.mjs run tests/deploy-release.test.ts tests/deploy-web-unit.test.ts` | 0 | 2 files, 107 tests passed (`logs/vitest-deploy-release-web-unit-5553ecaf.log`) |

The implementers' earlier suite and real-systemd logs ran against the working tree before the commit. Each records the gate hashes,
which equal the tested blobs: `32d7315a`, `64cc5166`, `820f5d53` and `bab61796`.

## 4. Independent challenge (separate agent, review revision `7705c18e`, its own reproductions)

The challenger extracted both trees with `git archive` and wrote its own record generator and its own real-systemd container (`r5chal-*`,
an image built from the pinned base plus systemd, `--network none`, no `--privileged`). It ran every case as uid 1000 `arm`, outside the
adm and journal groups, and removed everything it created. **Verdicts: R1 HOLDS; R2 HOLDS against Astra's reproduction.**

* **R1.** On its own Astra record the corrected parser exits 1 with two STOPs and no `R6-A2-` line; the f92d6e29 parser exits 0 with
  `tue:released`. The corrected parser STOPs the tool line with CRLF, indentation, list, quote, table, backticks and fences; the headers
  alone; the post-switch line; and raw or pretty-printed events.log rollback entries. Valid released, verified-rolledback and deferred
  records PASS. `SITTING-20261124.md` gives `tue:deferred` / `342040625f6d…` with no "before P4" ruling (`SHA256SUMS-SITTING` 4 OK).
  No line on a genuine released path is a trace. f1 112/112.
* **R2.** On real systemd 255.4-1ubuntu8.19, the timer's job fails on `Requires=postgresql.service` (visible to PID 1 only), and root
  `systemctl start` at +3.0 s succeeds with a valid dump, sidecar and journal lines:
  - The corrected G0 and A-2 functions exit 1 with `scheduled origin unproven … trigger unit 'none'` and 0 `OFFHOST-COMPARE`. The f92d6e29
    G0 and A-2 exit 0 with `OFFHOST-COMPARE`. The same holds for a start through a dependency, and for a hand run after an earlier
    successful timer run.
  - **Genuine scheduled PASS** from real systemd output, through the real unit sandbox: G0 exits 0 with `OFFHOST-COMPARE`, and the trigger
    `realtime_usec=1795781003048076` equals busctl `LastTriggerUSec`. Today's production script STOPs.
  - Forging as arm failed: `systemd-cat`, `logger`, native-protocol datagrams with `_SYSTEMD_UNIT`/`_SYSTEMD_INVOCATION_ID`/`_PID`, and a
    user unit of the same name. journald drops caller-supplied underscore fields, and `journalctl -u afldb-backup.service` returns none of them.
  - Neither gate reads the off-host copy. Its own suite runs: f2 159, f3 32, f4 12, f5 21, f6 21, f7 22. The seven shared functions are
    byte-identical.
* **Findings 3–8:** no regression found; the r5 diff does not touch them.

**Challenger findings. All are kept as residuals; no code was changed after verification.**

| Grade | Finding | Disposition |
|---|---|---|
| MED | The `trigger:` line is written by the **arm-owned** `scheduled-backup.sh`. A one-line edit that logs `unit=afldb-backup.timer` with the current `LastTriggerUSec`, followed by a sudo hand start at +3 s, PASSes both gates. The comment in both gates ("an operator with root can still run a rewritten script") understates this: arm can edit the file, and only the start needs sudo. | Residual. The binding stops an honest manual start, not a malicious arm. The script's integrity needs a separate control, for example a root-owned copy outside the checkout, which is an owner decision. The comment is left as tested. |
| LOW | `systemctl restart afldb-backup.service` while the timer's run is active reuses the timer's job, so the second invocation logs a matching trigger line. | Stopped by the r4 rule "exactly one invocation of the unit in the window journal" (ambiguous, STOP), which is therefore load-bearing. |
| LOW | Starting or restarting **the timer** by hand (`Persistent` catch-up, re-arm) is a genuine timer dispatch, and the gates PASS. | Design limit: "scheduled" means dispatched by the timer unit inside the window. |
| LOW | Parser traces need a space or line end after the token. A prose mention such as `release: ROLLED BACK` in backticks or followed by punctuation passes `released`, as does a hand-run `release.mjs rollback` (no wrapper header) killed between the switch and its print. | Residual. Verbatim wrapper and tool output, which is the runbook path, is caught at every interruption point. A record-only parser cannot see output that was never pasted. |
| LOW | `timeout 5` has no `-k`, so a `systemctl` that ignores TERM stalled `log_trigger` for 90 s. Real binaries add at most about 5 s, and the backup always completes and exits as before. | Residual (prospective script). |
| INFO | A `deferred` record with only the `== R1 P4 promote` header passes. RUNBOOK §0's table still lists the 24 Nov packet's hashes, as the 27 Nov note above it says. | Recorded. |

## 5. What remains open (finding 2 stays open for operational readiness)

* **No genuine scheduled PASS is possible on production today.** Until the owner installs the prospective `scheduled-backup.sh`, every G0 and
  A-2 run STOPs with `scheduled origin unproven`, by design. G0 runs before P2, so the release that would carry the script cannot itself pass G0:
  the script has to be installed first, by a separate owner action, and then a real 02:20 run must log the line.
* **Unproved on production:**
  - that its systemd build exposes `Job.ActivationDetails` to arm;
  - that its journal is persistent with a per-user file arm can read (the r4 gates already depend on this);
  - that arm there cannot read PID 1's lines.
* **Trust limit (challenger MED, §4):** the `trigger:` line is written by the arm-owned script, so it proves the run's start job only
  while that file is intact. arm can edit it, and an edited script plus a sudo hand start passes both gates.
* **Unchanged r4 limits:** a journal receipt more than 5 s after the exit is a false STOP; a start by hand that joins the timer's still-queued
  job is the timer's run (one job, one invocation).

### Installing the trigger record (proposal for the owner; not run)

1. Before any sitting that needs G0 or A-2, install the reviewed `tools/maintenance/scheduled-backup.sh` (`bab61796…`) at
   `/home/arm/projects/afldb/tools/maintenance/` and compare its sha256. The unit and timer files are unchanged.
2. Probe production's systemd once with a transient timer (root, because it creates a system unit). As arm, the probe's journal must show
   `a(ss) 3 "trigger_unit" "afldb-trigger-probe.timer" "trigger_timer_realtime_usec" "<digits>" …`. The probe command form is untested on production:
   `sudo systemd-run --unit=afldb-trigger-probe --on-active=30s --uid=arm --property=Type=oneshot --collect /bin/bash -c 'j=$(systemctl show afldb-trigger-probe.service -p Job --value); busctl get-property org.freedesktop.systemd1 /org/freedesktop/systemd1/job/$j org.freedesktop.systemd1.Job ActivationDetails'`
3. After the next 02:20 run, as arm: `journalctl -u afldb-backup.service --since 02:19 --until 02:31 -o cat | grep 'trigger:'` must print exactly one
   line with `unit=afldb-backup.timer`, whose `realtime_usec` equals
   `busctl get-property org.freedesktop.systemd1 /org/freedesktop/systemd1/unit/afldb_2dbackup_2etimer org.freedesktop.systemd1.Timer LastTriggerUSec`.

## 6. Unchanged

Findings 3–8 of the r4 round remain closed: the f3–f7 suites, in-container and the release rehearsal pass unchanged in number at the tested revision.
The owner's ruling on the 24 Nov deferral ("before P4") is still open. A future sitting still needs a new date with re-dated and re-pinned packets,
Astra's PASS at that review commit, a new owner approval and that day's evidence. For backups that evidence now includes the installed trigger record.
