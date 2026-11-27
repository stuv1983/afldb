# R6 r6 and release G0: root-protected backup origin, real-systemd callers, parser boundary (28 November 2026)

**Status: PROPOSED. Not approved, not installed, not run on production. R6 stays NO-GO. PR 5 stays draft. Astra has not re-reviewed this.**
Production was not contacted. Everything ran on the workstation (Git Bash) and on the DEV host streamanator as `arm`, in private
`mktemp` directories and disposable `--network none` containers (never `--privileged`), without host sudo, `lxc` or host packages.

| Item | Value |
|---|---|
| Reviewed head (Astra's remaining findings) | `624bf721b37f134ab4259eb889c22d43713e36bc` |
| **Tested revision** | `937c7d437b1fbe96a5102fa3db0011c7d751a48d` |
| **Delivered head** (re-pins, runbook notes and this record on top; no script differs from the tested revision) | see the PR; review revision `69d2a72811c7bea98aaca4cf7dd1671e80bedf6d` |
| R6 manifest (16 files) | `57c8aa502e51ac3e9efb93ca2fa5762d7a8b02299c3d5b7b50f0d2d9dd2659e8` (r5 `182efbb6…`) |
| Release `scripts/SHA256SUMS` (12 files) | `9c4b6ca63facc2556e6098a6329d53e7015dd2e6eb60bf5f59bddeb57700bcaa` (r5 `14f0f89f…`) |
| Changed pins | `r1-g0-dump.sh` `32d7315a…` → `6a0a0e58…`; `r6-pre-verify.sh` `64cc5166…` → `eac16cec…`; `r6-tuesday-handoff.sh` `820f5d53…` → `b5fb980b…` |
| `tools/maintenance/scheduled-backup.sh` | back to the production bytes `234fca6a…` (the `17822b29` blob); the r5 `log_trigger` (`bab61796…`) is withdrawn |
| Prospective root bundle, NOT installed (`attest/SHA256SUMS` `8f0c49b8…`) | writer `afldb-backup-attest` `799e6691…`, drop-in `60-afldb-backup-attest.conf` `2a3a067e…`, `install-attest.sh` `13e6ba4f…`, `verify-attest-install.sh` `337c8a37…` |

`orig-624bf721/` holds the reviewed bytes of the four changed scripts. Intermediate tested revisions `297175f9` (first integration) and
`bda102aa` (driver fixture export + release manifest moved into the tested tree) were superseded after the independent review (section 5).
The 24 Nov sitting artefacts are byte-identical (`sha256sum -c SHA256SUMS-SITTING`: 4 OK). The r2–r5 records and logs are unchanged.
Contract: [DESIGN.md](DESIGN.md). Independent review: [INDEPENDENT-REVIEW.md](INDEPENDENT-REVIEW.md).

## 1. Backup origin independent of arm (finding: arm could forge the r5 `trigger:` line)

**Mechanism (DESIGN §3).** A root-owned writer `/usr/local/libexec/afldb/afldb-backup-attest` runs as
`ExecStartPost=-+/usr/bin/env -i PATH=/usr/sbin:/usr/bin /usr/bin/bash --noprofile --norc <writer>` (drop-in
`/etc/systemd/system/afldb-backup.service.d/60-afldb-backup-attest.conf`): after `ExecStart` (still `User=arm`, every sandbox setting kept)
exits 0, **while the run's start job is live**. It reads only PID 1's state (one `systemctl show`, `busctl` on the live job and the timer) and
writes `/var/lib/afldb-backup-attest/<invocation>.attest` (root:root 0644, format `afldb-backup-attest/2`, never overwritten): invocation,
job, JobType, unit state, ExecMain code/status, the job's own `ActivationDetails` (`trigger_unit`, `trigger_timer_realtime_usec`), the
timer's `LastTriggerUSec` (+ monotonic), the unit's inactive-enter/exit and main-start monotonic stamps, the timer's activation stamp, and
**the run's single in-run dump name and full sha256, found and hashed as uid arm** (`setpriv --reuid=arm … --no-new-privs`, root's
`timeout` outside), so root never reads an arm-controlled path. It never reads, sources or executes anything under `/home`.

**Gate rule (DESIGN §4; one shared `attested_origin`, byte-identical in G0 and A-2).** Constants only, nothing from the environment:
trusted path for the writer, `env`, `bash`, every helper, the drop-in, both unit fragments and every drop-in, the record directory and the
record (no symlink in any component, owner uid 0, no group/other write, record link count 1); writer and drop-in digests; the loaded unit
(`EnvironmentFiles` empty, exactly one `ExecStartPostEx` = the writer's argv with flags `ignore-failure privileged`); the record's exact
format; same invocation; `job_type=start`; `activating/start-post`; exited 0; `trigger_unit=afldb-backup.timer`; dispatch usec = the
timer's `LastTriggerUSec` now and when written; `inactive_enter < dispatch <= inactive_exit, main_start`, both within 5 s; one record per
dispatch; the record's dump and 16 hex = the run's `backup ok` dump; and in each caller's `main`, the picked dump's **full** sha256
(re-hash = sidecar) = the record's before `OFFHOST-COMPARE`. The `trigger:` line is not read by either gate.

**Correction found on real systemd 255.4** (harness): with no ExecStartPre, PID 1 stamps `ExecMainStartTimestamp` ~0.2 ms *before*
`InactiveExitTimestamp`, so DESIGN's first `inactive_exit <= exec_main_start` would have refused every genuine run; no order is required
between the two. Also measured: `ExecStartPostEx` flags print `ignore-failure privileged`; job `ActivationDetails` has three pairs.

**Installation (prospective; owner; outside the production checkout).** `attest/install-attest.sh <root-owned staging dir>` as root (refuses
staging under `/home`, group/other-writable staging, a bundle not matching `attest/SHA256SUMS`, a unit with `EnvironmentFile=` or an
untrusted fragment), installs the writer, the drop-in and `/var/lib/afldb-backup-attest`, `daemon-reload`, then
`attest/verify-attest-install.sh` (read-only) as root and as arm. The checkout is not written, so P1/P2's clean-tree checks are unchanged.
Owner steps: (1) stage the bundle in a root-owned directory and check `attest/SHA256SUMS` `8f0c49b8…`; (2) run the install as root from a
trusted root session; (3) `verify-attest-install.sh` as root and as arm must print `ATTEST INSTALL RESULT PASS`; (4) after the next 02:20
run, `/var/lib/afldb-backup-attest/<that invocation>.attest` must exist with `trigger_unit=afldb-backup.timer` and the dump. Until then
every G0 and A-2 STOPs with `scheduled origin unproven`, by design.

## 2. The actual callers against real systemd (replaces the r5 extracted-function A-2 rehearsal)

`real-systemd-callers.sh` (host driver) / `real-systemd-callers-container.sh` / `r6h-run.sh` (workstation transport, `--verify-rev`):
one disposable container per scenario, real systemd 255.4-1ubuntu8.19 as PID 1, the real `deploy/` unit files as root-owned copies, the
bundle installed by its own `install-attest.sh`, and **both complete pinned callers run unmodified as arm** (uid 1000, no groups, `env -i`):
`bash r1-g0-dump.sh 2026-11-28` and `bash r6-pre-verify.sh accepted 7d92042fd110-XWruOm_9nLCSMY8nGPqYU r3:yes r4:no 10:00 tue:deferred
inv:342040625f6d4012a35d598dfbf9afe6`, stdout/stderr/exit captured verbatim. The harness generates no `OFFHOST-COMPARE`. Inputs are
labelled REAL-SYSTEMD (timer, live job, invocation, journal, record) or FIXTURE (stub `backup.sh`, stub postgresql, fixed-offset
Melbourne zone, timer drop-in `RandomizedDelaySec=0`, the restart case's `ExecStartPre=/bin/sleep 4`, root-planted damage, the attack's
arm-owned node). Final pass `final2` at `937c7d43`: every sent file equal to its blob (`[TRANSPORT]` block); **every scenario as expected**;
0 containers or images left.

**A-2 never passes as a whole in a container, and is never reported as such:** whole caller exit 1, `R6 PRE RESULT STOP (23–25 FAIL
line(s))`: the historical date gate (`today is not the scheduled Wednesday (2026-11-25)`) and 17–18 other host facts outside section 5
(kernel, grub, services, release, Caddy, host policy), and 5 inside section 5 unrelated to origin (restore, ledger, status: no database).
Section 5's backup-origin result is reported separately below.

| Scenario | G0 (whole caller) | G0's own OFFHOST-COMPARE | A-2 section 5 origin | Origin reason (refusals) |
|---|---|---|---|---|
| genuine-attested (timer, writer installed) | **exit 0 PASS** | dump + full sha = real file and sidecar; record bound-correct | **attributed**; its own BACKUP-EVIDENCE and OFFHOST-COMPARE correct | — |
| astra-manual-after-hidden-failure (timer run fails out of arm's sight, root start +3 s, later off-host copy) | exit 1 | none | refused | record: start job trigger unit `none` |
| old-install-r5-trigger (no writer; r5 script logs a valid-looking `trigger:` line) | exit 1 | none | refused | 0 ExecStartPost commands (writer not installed) |
| forged-trigger-manual (arm-edited script forges the line; root manual start) | exit 1 | none | refused | record: trigger unit `none` (contrast: the 624bf721 G0 PASSes) |
| record-missing / record-ambiguous / record-groupwritable | exit 1 | none | refused | no root record / 2 records name the dispatch / record mode 664 |
| restart-hidden-first (invocation #1 hidden from arm, restarted in its ExecStartPre) | exit 1 | none | refused | `inactive_enter` after the dispatch |
| arm-node-swap (independent review's MED-1 attack) | exit 1 | none | refused | record binds the real dump; the line read through node names the planted one |
| timer-rearm (root re-arms the stopped timer inside the window; `Persistent=` catch-up) | exit 0 PASS | correct | attributed | recorded only; INFO: dispatch 0.0 s after the timer's (re)activation (genuine: ~93 s) |

**Restart.** Real systemd keeps the timer's job across `systemctl restart`: same job id, `JobType=start`, the timer's `ActivationDetails`
for invocation #2. The only distinguishing field is `inactive_enter_mono` later than the dispatch, and both callers refuse on it. A start by
hand that joins the timer's still-queued job is one job and one invocation and remains indistinguishable (unchanged r4 limit).
**Manual timer re-arm.** Starting or restarting the timer dispatches the service only when `Persistent=` finds a missed elapse (or the
calendar elapses while it is active). Such a dispatch is a genuine dispatch by the timer unit and both gates accept it inside the window;
it does not prove that the calendar elapsed unattended. The callers print the delay after the timer's (re)activation. **Whether to refuse it
is Stu's decision.**

Mechanism probe (`attest-probe.sh`, `logs/attest-probe-p4.log`, PASS): install refusals; `+` command uid 0 while ExecStart is uid 1000
with NoNewPrivs; genuine record and gate PASS; start by hand, Astra, restart, `EnvironmentFile=`, a second ExecStartPost and a writer
failure all refused; dump hashed as uid 1000 (CapEff 0); an unreadable-to-arm dump and a symlink to `/etc/shadow` give `dump=none`.
arm-cannot-replace (genuine-attested): 54 write, rename, link, drop-in, `systemctl edit/set-property/daemon-reload` and bus attempts as arm,
all refused, 0 findings.

## 3. Parser: one rollback-token boundary

`r6-tuesday-handoff.sh`: `TOKL='(^|[^A-Za-z])'`, `TOKR='([^A-Za-z0-9_]|$)'`, `tooltrace()` used by both `released` (`ROLLED BACK`) and
`deferred` (`PROMOTED|ROLLED BACK`); the wrapper header uses the same right boundary. A backtick, any punctuation or end of line after the
token is a trace; a word continuation (`ROLLED BACKUP`, `PROMOTEDX`) is not. f1 112 → 202 cases (36 boundary STOPs, 39 `f1-orig6-*`
contrasts where 624bf721 wrongly certifies, header and word-continuation controls), PASS on the workstation and streamanator. The 24 Nov
record still gives `tue:deferred`, `7d92042fd110-XWruOm_9nLCSMY8nGPqYU`, `inv:342040625f6d…`, both R6-NOTEs, output identical to 624bf721's
except the timestamp. The owner's "before P4" ruling stays unresolved. Before/after: `logs/f1-boundary-before-after-*.log`
(`cases/f1-boundary-before-after.sh`).

## 4. Verification

| Run | Result |
|---|---|
| Driver proof (`prove-driver-fixes.sh … r4`, printed blocks verbatim at the review revision) | `R6 r4 DRIVER PROOF PASS`, exit 0: run 1 658 OK, 0 UNEXPECTED (f1 202, f2 308, f3 32, f4 12, f5 21, f6 21, f7 29, in-container, `release-scripts-manifest` OK at `9c4b6ca6…`); run 2 sabotage correctly UNEXPECTED (`logs/proof-driver-937c7d43-review-69d2a728.log`) |
| Release rehearsal (streamanator, clean `git archive` of the tested revision, bundle branch = `17822b29`) | `REHEARSAL RESULT PASS: 92 passed, 0 failed` (`logs/release-rehearsal-937c7d43.log`; export `6dc3ecdf…`, bundle `b39a111c…`) |
| f2 / f3 / in-container (streamanator, pinned image) | f2 308, f3 32, prod 144/0, wronghost 2/0 (`logs/attest-suite-*.log`) |
| Real-systemd callers | section 2 (`logs/real-systemd-callers-*.log`) |
| Application code | `git diff 5553ecaf 937c7d43 -- deploy src tests tools` touches only `scheduled-backup.sh`, now equal to `17822b29`'s; vitest not rerun |

## 5. Independent review

An independent reviewer who wrote none of r6 judged the delivered bytes and logs in two rounds ([INDEPENDENT-REVIEW.md](INDEPENDENT-REVIEW.md), `logs/review-*.log`, `logs/review2-*.log`).

**Round 1 (head `4a88f68d`).** Q1 YES: the record held, but MED-1 (the gates execute arm's `~/.nvm` node; arm deleted the real dump, planted another and swapped node, and G0 PASSed with `OFFHOST-COMPARE` on the planted dump) and MED-2 (the gates run in arm's login; `~/.bashrc` can forge the printed verdict). LOW-1 (this record missing), LOW-2 (re-arm wording). Q2 YES for all nine scenarios.

**Fixes.** MED-1: the record binds the dump name and full sha256 (format /2) and each caller requires its re-hash to equal it (tested `937c7d43`; arm-node-swap added to the harness; f2 308). LOW-1, LOW-2 fixed. MED-2 recorded as an owner decision.

**Round 2 (delivered head `69d2a728`, tested `937c7d43`).** Pins, manifests and byte identity verified.
* **Q1: YES.** (a) Post-run evidence: **MED-1 closed**, the node-swap attack re-run on real systemd is refused by both gates. (b) In-run substitution: **MED-3 open** (section 6). (c) Gate execution environment: **MED-2 open**, owner decision.
* **Q2: YES for section 5 in all ten final2 scenarios.** The unchanged A-2 exited 1 (`R6 PRE RESULT STOP`) everywhere, as expected without a database; section 5 attributed `genuine-attested` and `timer-rearm`, each with exactly one `OFFHOST-COMPARE` in the caller's own output, and refused the other eight; no harness-generated `OFFHOST-COMPARE`.
* Writer regression check: none (setpriv, candidate rule, symlink/FIFO/large files, root never reads an arm path). INFO: the child's stdout capture is unbounded, DoS only.

## 6. What remains open

* **MED-2 (owner decision): the gates run as arm.** G0 (`ssh … bash -s` as arm) and A-2 execute in arm's login, so a hostile `~/.bashrc`
  (or anything arm controls that the gate executes: `~/.nvm` node, `release.mjs`, checkout scripts, `.env`) can make the gate *print* a PASS
  without any evidence. This is not evidence production, and it affects every check in every gate, not only backup origin; the reviewer
  reproduced it. Closing it needs a verdict produced outside arm's control. Options for Stu:
  (a) the writer also signs each record with a root-only key and the off-host verifier on streamanator checks the signature, the date
  window and that the pulled copy's sha256 equals the record's;
  (b) a dedicated non-arm verifier account with a root-owned forced command;
  (c) accept "gates run as arm" as a documented residual for all gates.
* **Production unknowns:** the writer is not installed; the production units' install form (copy vs link), `/usr/local`, `/var/lib` and
  helper permissions, its systemd build and job `ActivationDetails`, and arm's groups are unverified there (the install's verify step checks
  them).
* **MED-3 (independent review round 2; owner decision): in-run substitution is deterministic, not a race.** An arm process started outside the unit's cgroup can SIGSTOP the arm-owned `scheduled-backup.sh` once `backup.sh` has finished, rename other bytes over the dump, and SIGCONT it; the workload then writes the sidecar and `backup ok` line for those bytes, the writer binds them, and both gates PASS with `OFFHOST-COMPARE` on them (reproduced on real systemd: `logs/review2-real-systemd-review-race.log`, `FINDING-REVIEW2-RACE`). Substitution after the sidecar is caught. A gate PASS therefore proves only that the timer dispatched the run and that this is the file arm's uid let stand when the workload wrote its sidecar; it does not prove the bytes are tonight's `pg_dump` output (an older genuine dump would pass). Closing it needs the dump written and sealed by a user other than arm, which changes the workload's privilege level and is Stu's decision. The gate comments `r1-g0-dump.sh:131-132` and `r6-pre-verify.sh:213-214` still call this "an arm process racing the run"; that wording understates it and is superseded by this text (left unedited so the tested, pinned gate bytes stay those run on real systemd).
* **Residuals:** root and sudo are out of scope; the owner's install must use a trusted root session; the record proves which dump the
  attested run left, not that arm's workload wrote honest bytes; two dumps stamped in the same second as the main start give a false STOP; a
  Persistent catch-up whose postgresql dependency takes over 5 s is a false STOP; records are never pruned.
* **Unchanged:** findings 3–8 stay closed (f3–f7 pass unchanged in number); the "before P4" ruling; a future sitting still needs a new date,
  re-dated and re-pinned packets, Astra's PASS at that commit, a new owner approval and that day's evidence, now including the installed
  writer's record.
