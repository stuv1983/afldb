# R6 r6: protected backup-origin attestation (design contract, 28 November 2026)

**Status: PROPOSED. Not installed. Production was not contacted.** This file is the interface contract that the attestation
mechanism, the real-systemd caller harness and the integrated review are held to. Where an implementation differs, the
implementation record (README.md) states the difference and why.

## 1. Problem

At `624bf721` (r5) both gates (release G0 `r1-g0-dump.sh`, R6 A-2 section 5 `r6-pre-verify.sh`) take the backup's origin from a
`trigger:` line that `tools/maintenance/scheduled-backup.sh` logs. That script is in arm's checkout and runs as arm, so arm can
edit it to print a matching line and pass both gates with a start by hand (challenger MED, r5 section 4).

## 2. Threat model

* **Adversary:** any process running as uid `arm` without root: it can edit everything arm owns (the checkout, `~/.nvm`, the
  backup directory, its own journal lines), start nothing as root, and read the system bus.
* **Trusted:** root, PID 1 (systemd), journald's trusted fields, files owned by root in directories only root can write.
* **Out of scope, stated as residuals:** root itself; a sudo start by the owner (an owner action, not an arm process); the
  gate process itself, which runs as arm (a compromised arm login environment, such as `~/.bashrc`, controls what any arm
  process prints, gates included); what the attested run's own (arm) code does inside the attested invocation.

## 3. Mechanism (smallest protected writer)

A root-owned writer runs as a full-privilege `ExecStartPost` of `afldb-backup.service`, after `ExecStart` succeeded, **while the
run's start job is still live**. It reads only PID 1's state (systemctl / busctl over the system bus), and writes one record
into a root-only directory. The backup workload (`ExecStart`, `User=arm`) is unchanged; `scheduled-backup.sh` returns to the
production bytes `234fca6a…` (the `17822b29` blob), so the r5 `log_trigger` change is withdrawn and nothing needs installing in
the checkout (P1/P2 clean-tree checks unaffected).

| Item | Value |
|---|---|
| Writer | `/usr/local/libexec/afldb/afldb-backup-attest`, root:root 0755, every parent root-owned and not group/other-writable |
| Drop-in | `/etc/systemd/system/afldb-backup.service.d/60-afldb-backup-attest.conf`, root:root 0644 |
| Drop-in body | `[Service]` / `ExecStartPost=-+/usr/bin/env -i PATH=/usr/sbin:/usr/bin /usr/bin/bash --noprofile --norc /usr/local/libexec/afldb/afldb-backup-attest` |
| Record directory | `/var/lib/afldb-backup-attest`, root:root 0755 (created by the install procedure) |
| Record | `/var/lib/afldb-backup-attest/<invocation>.attest`, root:root 0644, written as `.<invocation>.tmp` then renamed; never overwritten |

* `+` = full privileges (root, no sandbox) for this command only; `ExecStart` keeps `User=arm` and every sandbox setting.
* `-` = a writer failure does not fail the backup (the backup's own semantics, markers and OnFailure are unchanged); a missing
  record makes both gates refuse.
* `env -i` gives the writer an empty environment (no `BASH_ENV`, `INVOCATION_ID` or anything from the unit); `bash --noprofile
  --norc` reads no startup file; the writer does `cd /` first, uses absolute paths only, and never reads, sources or executes
  anything under `/home`. The unit has no `EnvironmentFile=` (the gates check this), so the unit environment is root-controlled.
* Helpers: `/usr/bin/systemctl`, `/usr/bin/busctl`, `/usr/bin/sha256sum`, `/usr/bin/timeout` (with `-k`), `/usr/bin/mv`; bash
  builtins otherwise (`$EPOCHREALTIME`, `read`, `printf`).

### Record format (exact key order, one `key=value` per line, LF, no other lines)

```
afldb-backup-attest/1
writer_sha256=<64 hex: sha256 of the writer file, read by the writer at write time>
unit=afldb-backup.service
invocation=<32 hex: the unit's InvocationID at write time>
job=<digits: the unit's Job at write time>
job_type=<JobType of that job, from busctl>
active_state=<ActiveState>
sub_state=<SubState>
exec_main_code=<digits>
exec_main_status=<digits>
inactive_enter_mono=<digits: InactiveEnterTimestampMonotonic>
inactive_exit_mono=<digits: InactiveExitTimestampMonotonic>
exec_main_start_mono=<digits: ExecMainStartTimestampMonotonic>
trigger_unit=<the start job's ActivationDetails trigger_unit, or none>
trigger_timer_realtime_usec=<the start job's trigger_timer_realtime_usec, or none>
timer_last_trigger_usec=<afldb-backup.timer LastTriggerUSec, microseconds, busctl>
timer_last_trigger_mono=<afldb-backup.timer LastTriggerUSecMonotonic>
timer_active_enter_mono=<afldb-backup.timer ActiveEnterTimestampMonotonic>
boot_id=<32 hex, /proc/sys/kernel/random/boot_id without dashes>
written_realtime_usec=<digits>
```

The writer records raw facts for every successful run, a start by hand included (`trigger_unit=none`); the gates decide.
If a fact cannot be read or fails its own pattern, the writer writes no record and exits nonzero (ignored by `-`).

## 4. Gate rule (one shared function, byte-identical in G0 and A-2)

`attested_origin <invocation> <timer-usec-at-gate-time>` returns 0 only when **every** item holds; otherwise sets a reason that
the callers print as `scheduled origin unproven: <reason>`, examine no dump and print no `OFFHOST-COMPARE`. All paths and digests
are constants in the gate text, never taken from the environment or arguments.

1. **Trusted path** (each of: the writer; `/usr/bin/env`, `/usr/bin/bash` and the helpers; the drop-in; the service's
   `FragmentPath` and every `DropInPaths` entry; the timer's `FragmentPath` and every `DropInPaths` entry; the record directory;
   the record): no component from `/` to the leaf is a symlink, every component is owned by uid 0, no component is group- or
   other-writable; the leaf has the expected type; the record also has link count 1.
2. **Writer identity at gate time:** sha256 of the writer = the pinned digest; sha256 of the drop-in = the pinned digest.
3. **Effective unit:** `EnvironmentFiles` is empty; `DropInPaths` contains the drop-in; `ExecStartPostEx` has exactly one entry;
   its argv is exactly the drop-in's command line and its flags include `full-privileges`.
4. **Record:** exactly the format above; `writer_sha256` = the pinned digest; `invocation` = the service's InvocationID that the
   r4 links attributed (the invocation whose single `backup ok` line names the dump); `job_type=start`;
   `active_state=activating`; `sub_state=start-post`; `exec_main_code=1` and `exec_main_status=0`;
   `trigger_unit=afldb-backup.timer`; `trigger_timer_realtime_usec` = `timer_last_trigger_usec` = the gate-time
   `LastTriggerUSec` (microseconds);
   `inactive_enter_mono < timer_last_trigger_mono`, `timer_last_trigger_mono <= inactive_exit_mono`,
   `timer_last_trigger_mono <= exec_main_start_mono`, and both `inactive_exit_mono` and `exec_main_start_mono` within 5000000 µs
   after `timer_last_trigger_mono` (the unit did not stop or fail between the dispatch and this invocation: a restart or a failed
   first run inside the same job is refused). **No order is required between `inactive_exit_mono` and `exec_main_start_mono`**
   (correction, 28 Nov, from the harness on real systemd 255.4: with no ExecStartPre, PID 1 stamps ExecMainStartTimestamp at the
   fork and InactiveExitTimestamp about 0.2 ms later; with an ExecStartPre the order reverses).
5. **Uniqueness:** no other `*.attest` in the directory carries the same `trigger_timer_realtime_usec`.
6. **Information only (not a criterion; Stu's policy):** the callers print how long after the timer unit's last (re)activation
   the dispatch came (`timer_last_trigger_mono - timer_active_enter_mono`), so a manual re-arm or a boot catch-up is visible.

The r5 `trigger:` journal line is no longer read for origin by either gate. A line from arm's code proves nothing.

## 5. What the record proves, and what it does not

* Proves (against any arm process): a successful invocation `<id>` of `afldb-backup.service` ran inside a start job that
  `afldb-backup.timer` created at `<usec>`, with no stop or failure of the unit between that dispatch and the invocation, as PID 1
  reported it to a root process while the job was live.
* The invocation-to-dump link stays the r4 link: journald stamps the invocation's single `backup ok` line with the trusted
  `_SYSTEMD_INVOCATION_ID`; that line's name and 16 hex must match the unique 02:2x dump and its sidecar. The text of that line
  is written by the workload (arm's code), so it proves what the attested run reported, at the workload's trust level.
* A manual re-arm of the timer (`systemctl restart`/`start afldb-backup.timer`, `Persistent=` catch-up) is a genuine timer
  dispatch: it proves the timer unit dispatched the run, not that the calendar elapsed unattended. Whether to refuse it is
  Stu's decision; the callers print the facts.

## 6. Installation (prospective, owner, outside the checkout)

`attest/install-attest.sh`, run as root from a root-owned staging directory holding the reviewed bundle (`attest/SHA256SUMS`),
never from the checkout: verify the bundle digests; `install -d -o root -g root -m 0755 /usr/local/libexec/afldb
/var/lib/afldb-backup-attest /etc/systemd/system/afldb-backup.service.d`; `install -o root -g root -m 0755` the writer and `-m 0644`
the drop-in; `systemctl daemon-reload`; then run `attest/verify-attest-install.sh` (read-only) as root and as arm. The production
checkout is not written, so the P1/P2 clean-tree checks are unchanged.
