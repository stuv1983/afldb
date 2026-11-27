# R6 r7: sealed backup production (MED-3) and an owner verifier independent of arm (MED-2): interface contract (28 November 2026)

**Status: PROPOSED. Nothing installed. Production is not contacted. R6 stays NO-GO; PR 5 stays draft.**
This file is the contract that the backup implementer, the verifier implementer, the coordinator and the independent reviewer are
held to. Where an implementation must differ, its README states the difference and why, and the coordinator records it here.
It supersedes the r6 DESIGN.md (`review-fixes-r6-20261128/DESIGN.md`) for origin and verdict; r6's PID 1 facts and refusal rules
(job ActivationDetails, restart/hand-start refusal, uniqueness, trusted path) carry over unless changed below.

## 0. Owner decisions this implements (Stu, 28 Nov 2026)

1. **Both guarantees are required for PR 5:** (G1) the identified timer invocation produced the exact accepted dump; (G2) Stu receives
   an authentic G0 and whole-A-2 verdict through a path independent of arm's login.
2. **Timer-dispatch rule:** keep the written in-window rule (the dispatch lies in the gate date's 02:20–02:31 window). An attended
   re-arm counts **if systemd genuinely dispatched the run in-window** (the start job's `trigger_unit=afldb-backup.timer` at the
   timer's `LastTriggerUSec`). A start by hand never counts. **Catch-up must be identified explicitly in the evidence** (§3.4).
3. If either guarantee is unmet at the end, its finding stays OPEN in the trackers and the PR description.

## 1. Threat model

* **Adversary:** any process running as uid `arm` on production, without root: it owns `/home/arm` (checkout, `~/.nvm`, `.env`,
  `~/.bashrc`/`~/.profile`, the old backup directory, its own journal lines), can read the system bus and signal its own processes.
* **Trusted:** root, PID 1, sshd, journald trusted fields, files owned by root in root-only-writable directories, the two new
  service accounts (they have no login, no key, no sudo; all their code and configuration is root-owned), and Stu's workstation.
* **Out of scope (residuals, stated):** root/sudo; the PostgreSQL server and its data (arm holds the owner DSN and can change the
  data, which is a different property from the dump's provenance); streamanator's own arm for the off-host copy (§5.4).

## 2. Accounts and paths (prospective production layout; created only by the owner's install, never by Claude)

| Item | Value |
|---|---|
| Backup account | system user `afldb-backup`, group `afldb-backup`, shell `/usr/sbin/nologin`, home `/nonexistent`, no supplementary groups. arm is not in `afldb-backup`. |
| Reader group | `afldb-backup-read`: members `arm` (off-host pull, weekly restore, status) and `afldb-verify`. Read only. |
| Verifier account | system user `afldb-verify`, group `afldb-verify`, shell `/bin/sh` (dash: reads no startup file for `-c`), home `/var/lib/afldb-verify` root:root 0755 with no files; supplementary groups: `afldb-backup-read`, and only what §5 proves necessary (each one justified in the verifier README). |
| Backup code | `/usr/local/lib/afldb-backup/` root:root 0755; `tools/maintenance/backup.sh` (byte-identical copy of the repo's `tools/maintenance/backup.sh`, so `cd "$(dirname "$0")/../.."` lands in a root-owned directory with no `.env`), `afldb-backup-run` (ExecStart wrapper), `afldb-backup-seal` (root sealer/publisher), `SHA256SUMS`. All 0755/0644 root:root. |
| Data root | `/var/lib/afldb-backup` root:root 0755 |
| Staging | `/var/lib/afldb-backup/staging` afldb-backup:afldb-backup 0700 (the ONLY path the backup account can write) |
| Seals | `/var/lib/afldb-backup/seals` root:root 0755; `<invocation>.seal` root:root 0644, written `.tmp` then renamed, never overwritten |
| Published | `/var/lib/afldb-backup/published` root:afldb-backup-read 0750; `afldb_prod-YYYYMMDD-HHMMSS.dump` and `.dump.sha256` root:afldb-backup-read 0440, link count 1 |
| State | `/var/lib/afldb-backup/state` root:afldb-backup-read 0750; `last-backup.json` (same JSON shape as today's) root 0440; failure marker per the backup README |
| DB credential | **peer authentication, no secret**: unit `Environment=AFLDB_BACKUP_DATABASE_URL=postgresql:///afldb_prod?host=/var/run/postgresql`; `pg_ident.conf` map `afldbbackup afldb-backup afldb_backup`; `pg_hba.conf` line `local afldb_prod afldb_backup peer map=afldbbackup` placed before any broader `local` line. Role `afldb_backup` is the existing read-only backup role (no new grant). arm cannot authenticate as the OS user `afldb-backup`. |
| Verifier DB access (A-2 only) | peer-mapped role with the minimum the A-2 queries need (defined in the verifier README; prospective DDL, owner-applied) |

**Unit (prospective):** a root-owned drop-in (or replacement unit, implementer's choice, justified) for `afldb-backup.service` giving
`User=afldb-backup`, `Group=afldb-backup`, `WorkingDirectory=/`, `UMask=0077`, the DSN above, `ExecStart=/usr/bin/bash --noprofile --norc
/usr/local/lib/afldb-backup/afldb-backup-run`, exactly one `ExecStartPost=+/usr/bin/env -i PATH=/usr/sbin:/usr/bin /usr/bin/bash
--noprofile --norc /usr/local/lib/afldb-backup/afldb-backup-seal` (**no `-`**: a seal or publish failure fails the unit and fires
`OnFailure=`), `ProtectHome=yes`, `ProtectSystem=strict`, `ReadWritePaths=/var/lib/afldb-backup/staging` only, `NoNewPrivileges=yes`,
`PrivateTmp=yes`, no `EnvironmentFile=`. The timer is unchanged (`OnCalendar=*-*-* 02:20`, `RandomizedDelaySec=10min`, `Persistent=true`).
The weekly `afldb-backup-verify.service` is unchanged (User=arm, fresh dump in `/home/arm/backups/afldb-scheduled`, restore-test):
its dumps are never gate-eligible because gates read only seals and `published/`.

## 3. Backup production (G1, MED-3)

### 3.1 Flow
1. `afldb-backup-run` (as `afldb-backup`): removes everything left in staging by an earlier run; runs the installed `backup.sh --dir
   /var/lib/afldb-backup/staging --keep 1` with peer auth (pg_dump to `.partial`, `pg_restore --list` check, rename); writes the staging
   sidecar; logs `backup ok: <name> <bytes> bytes sha256 <16 hex> offhost=skipped` (continuity only: **no gate reads it**). Non-zero
   on any failure.
2. `afldb-backup-seal` (root, ExecStartPost, while the run's start job is live): reads PID 1's facts exactly as r6's writer did; requires
   staging to hold exactly one regular, non-empty, link-count-1, `afldb-backup`-owned `afldb_prod-<8d>-<6d>.dump` modified at or after
   the main start, plus its sidecar; **copies it into a root-only temporary in `published/` (`.<invocation>.tmp`, root 0400), hashes
   that root-owned copy**, requires the hash to equal the staging sidecar; writes the seal (§3.2) **before** publication; then sets
   root:afldb-backup-read 0440 and renames the copy to its final name; writes the root sidecar `<sha256>  <name>` the same way;
   updates `state/last-backup.json`; applies retention (§3.3); removes the staging copy. Any failure: no rename, temporaries removed,
   exit non-zero (the unit fails, OnFailure fires).
3. **No partial artefact is eligible:** gates accept only a final-named, root-owned 0440, link-count-1 published file whose re-hash
   equals a valid seal's `dump_sha256`; staging, temporaries and seal-without-file are refused.

### 3.2 Seal format (`afldb-backup-seal/3`; exact key order, one `key=value` per line, LF, no other lines)
```
afldb-backup-seal/3
sealer_sha256=<64 hex: the sealer file, read at write time>
unit=afldb-backup.service
invocation=<32 hex>
job=<digits>
job_type=<busctl JobType>
active_state=<ActiveState>
sub_state=<SubState>
exec_main_code=<digits>
exec_main_status=<digits>
service_user=afldb-backup
inactive_enter_mono=<digits>
inactive_exit_mono=<digits>
exec_main_start_mono=<digits>
trigger_unit=<job ActivationDetails trigger_unit or none>
trigger_timer_realtime_usec=<digits or none>
timer_last_trigger_usec=<digits>
timer_last_trigger_mono=<digits>
timer_active_enter_mono=<digits>
dispatch_kind=<scheduled|catch-up>
dump=<afldb_prod-YYYYMMDD-HHMMSS.dump or none>
dump_sha256=<64 hex of the ROOT copy that is published, or none>
dump_bytes=<digits or none>
boot_id=<32 hex>
sealed_realtime_usec=<digits>
```
The sealer records raw facts for every successful ExecStart, a hand start included (`trigger_unit=none`); gates decide.

### 3.3 Retention and restore (preserved)
Published keeps the newest `AFLDB_BACKUP_KEEP` (14) dumps by name; sidecars follow their dump; seals are kept. `restore-test.sh` and the
weekly verify are unchanged. `scheduled-backup.sh status` must keep reporting nightly-backup freshness and failure (reading the sealed
state through an explicit, absolute-path setting; no default changes for other callers). The off-host pull source becomes
`<prod>:/var/lib/afldb-backup/published/` (streamanator configuration, an installation prerequisite); `offhost-pull.sh` is unchanged.

### 3.4 Dispatch kind (catch-up identification)
`dispatch_kind=catch-up` when the dispatch came within 5 s of the timer unit's (re)activation (`timer_last_trigger_mono -
timer_active_enter_mono < 5000000`: a `Persistent=` catch-up at boot or after an attended re-arm), otherwise `scheduled`. Both are
accepted when every other rule holds and the dispatch is in-window; every gate prints `DISPATCH <kind> <delay> s after timer
activation` and the verdict line carries `dispatch=<kind>`.

### 3.5 Gate rule for origin + dump (`sealed_origin`, one function, byte-identical wherever used)
r6 §4 items 1–5 with these changes: trusted paths add `/usr/local/lib/afldb-backup` (every file), `/var/lib/afldb-backup` and its
four subdirectories, the seal, the published dump and sidecar; pinned digests for `afldb-backup-run`, `afldb-backup-seal`, the
installed `backup.sh` and the drop-in; effective unit: `User=afldb-backup`, the exact ExecStart argv, exactly one ExecStartPostEx = the
sealer argv with flags `privileged` (no `ignore-failure`), no EnvironmentFiles, `ProtectHome=yes`, `ReadWritePaths` exactly staging;
seal exact format, `service_user=afldb-backup`; the published dump is root:afldb-backup-read 0440, nlink 1, regular, and its FULL
re-hash equals `dump_sha256`; its root sidecar is exactly `<dump_sha256>  <dump>`; dispatch in the gate date's window; uniqueness of
the dispatch across seals. **No journal line, no arm-owned path and no arm-owned binary is read or executed for origin or the dump.**
Output: `OFFHOST-COMPARE <dump> <full sha256>` only when every item holds; otherwise `scheduled origin unproven: <reason>`.

## 4. Permission proof obligations (G1 acceptance)

As arm (uid of arm, its real groups including `afldb-backup-read`), at **creation** (ExecStart running), **sealing** (ExecStartPost
running) and **after publication**: no write, create, rename, link, unlink, chmod or replace on staging, the seal directory, any seal,
`published/`, any published file, `state/`, the code directory, the drop-in or unit files; no signal to any `afldb-backup` process
(`kill -STOP` → EPERM); no read of staging; no peer login as `afldb_backup` (`psql` as arm with the peer DSN fails); the review-2
SIGSTOP substitution attack re-run on real systemd is refused. Parent directories are checked for every path. Each check logs the
effective uid/gid/groups, the syscall result and `stat` of the target and every parent.

## 5. Owner verifier (G2, MED-2)

### 5.1 Entry point and authentication
* sshd drop-in (prospective) `Match User afldb-verify`: `AuthorizedKeysFile /etc/ssh/afldb-verify/authorized_keys` (root:root 0644, in
  root-only directories), `ForceCommand /usr/local/lib/afldb-verify/afldb-verify-entry`, `PermitTTY no`, `AllowTcpForwarding no`,
  `AllowAgentForwarding no`, `X11Forwarding no`, `PermitTunnel no`, `PermitUserEnvironment no`; the key line also carries `restrict`.
  The key is a NEW keypair held only on Stu's workstation (`~/.ssh/afldb_verify`), never arm's key.
* Bundle `/usr/local/lib/afldb-verify/` root:root 0755, everything root-owned, pinned by `SHA256SUMS`; the entry's first act is
  `exec /usr/bin/env -i PATH=/usr/sbin:/usr/bin LC_ALL=C <only SSH_ORIGINAL_COMMAND> /usr/bin/bash --noprofile --norc <dispatcher>`.
* Grammar of `SSH_ORIGINAL_COMMAND` (strict, anything else = usage refusal, exit 2):
  `g0 <YYYY-MM-DD> <nonce>` (production), `a2 <the seven A-2 arguments> <nonce>` (production), `g0b <YYYY-MM-DD> <dump> <sha256> <nonce>`
  (streamanator, prospective install there), `version <nonce>`; nonce = 32 lower-case hex.
* The verifier **never executes, sources or loads anything arm owns** (no `~/.nvm` node, no checkout script, no `.env`, no `git`
  binary on arm's repository: read refs as files), uses absolute root-owned helpers only, and treats arm-owned files as untrusted data.
  Every dependency it executes is root-owned and pinned (including any node binary or `release.mjs` copy, if the A-2 port needs one).

### 5.2 Result delivery and freshness
Gate output verbatim, then exactly one final line, and the ssh exit status = the gate's exit status:
`AFLDB-VERIFY RESULT <G0|A2|G0B|VERSION> <PASS|STOP> nonce=<nonce> host=<hostname> boot=<boot_id> bundle=<sha256 of the installed
SHA256SUMS> at=<UTC> exit=<n> <mode fields>`; G0 fields: `date= invocation= dump= sha256= dispatch=`; A2: `current= tue= inv=
window= backup-origin=<attributed|refused>` (A-2's backup attribution is reported separately from the whole A-2 status);
G0B: `date= dump= sha256=`.
Workstation wrapper (`afldb-verify-call.sh`, run by Stu in Git Bash): generates the nonce; ssh with the verify key only
(`IdentitiesOnly=yes`, `BatchMode=yes`, `StrictHostKeyChecking=yes`); requires exactly one RESULT line, last, with its nonce, mode,
arguments and the pinned bundle digest, and `PASS` ⇔ exit 0; prints `OWNER VERDICT <mode> PASS|STOP …`. `g0` runs G0a then G0b,
passing G0b the dump and sha256 **taken only from the authenticated G0a RESULT line**. NG-PRE consumes only `OWNER VERDICT A2 PASS`.
A rehearsal transport (ProxyCommand via `docker exec`) is allowed only behind an explicit `--rehearsal` flag that is printed in
the verdict.

### 5.3 Whole A-2 under the verifier
The verifier runs a port of `r6-pre-verify.sh` with every check intact, under §5.1's rules. Where an A-2 check today executes arm's code
(`node deploy/release.mjs status`, `deploy/afldb-settle-failure-status.sh`, `scheduled-backup.sh status`, `.env`, `~/.nvm` node), the
port uses a pinned root-owned equivalent or reads root-controlled facts; each substitution is listed with what it trusts. Checks whose
**evidence itself** is produced by arm (for example the weekly restore verification, which runs as arm by design) are labelled as such:
they are remaining dependencies on arm, reported, never silently counted as independent.

### 5.4 Remaining dependencies to report (not closed by this contract)
streamanator: the pull and G0b run under streamanator's arm unless the prospective `afldb-verify` install is made there too; the bytes
G0b checks must hash to the sha256 from the authenticated G0a line, so streamanator's arm can only claim a copy it really holds.

## 6. Rehearsal rules (all agents)

* Never contact production. Never `lxc`/`lxd` on streamanator (it installs the lxd snap). No host `sudo`, no host package install, no
  host account creation. Disposable docker containers on streamanator as arm only (`ssh -o BatchMode=yes -i ~/.ssh/afldb_dev
  arm@10.0.40.100`), never `--privileged`; root inside a container is fine. Remove every container, image and workspace you create.
* Real systemd as PID 1 in the container, r6 style (`review-fixes-r6-20261128/real-systemd-callers.sh`: pinned base image
  `sha256:d71c0b28…`, `--network none`, fixed-offset Melbourne zone so the real 02:20 dispatch lands on today). Image packages may add
  `postgresql-16 openssh-server openssh-client rsync netcat-openbsd` (network in the build step only). Use a real PostgreSQL fixture
  database `afldb_prod` so the dump is a real `pg_dump` archive.
* **Date limit:** the packet gates accept Melbourne dates 2026-11-24..29 only; every gate run must finish by 2026-11-29 23:59 AEDT.
* Label every input REAL-SYSTEMD / REAL / FIXTURE / HARNESS; log the tested git revision, effective identities (`id`) and exits.

## 7. Implementation deviations (coordinator record, 28 Nov 2026)

The coordinator checked both deliveries against this contract.
* The bundle's `sealed-origin.sh` is byte-identical to `backup/sealed-origin.sh` (`48827fb1…`).
* The pins inside `sealed-origin.sh` equal the files: run `2c62ff91…`, sealer `33ab0cc3…`, the repository `backup.sh` `df609046…`,
  drop-in `f8a18580…`.
* `verify-backup-install.sh` pins the library `48827fb1…`.
* `backup/SHA256SUMS` (`aada42cb…`) matches its seven files.
* `verify/bundle/SHA256SUMS` (`5333d215…`) matches its files and equals the wrapper's `BUNDLE_SHA`.
* `verify/SHA256SUMS` (`ee4963bd…`) matches, and `build-sums.sh --check` gives PASS.
* `a2-core.sh`'s host-policy pins equal `deploy/host-policy/*`, and the bundled `afldb-settle-failure-status.sh` equals the `17822b29` blob
  (`d80838cb…`).
* The install order fits. `install-backup.sh` creates `afldb-backup-read` and adds arm to it. `install-verify.sh --role prod` refuses
  without that group, so the backup installs first. The sealer writes `state/last-backup.json` and the published files
  root:afldb-backup-read 0440, which the verifier reads through that group.

Each implementation deviation, and its disposition:

| # | Deviation (source) | Disposition |
|---|---|---|
| B1 | The DSN names the role (`postgresql://afldb_backup@/afldb_prod?host=/var/run/postgresql`) and is a constant in the pinned `afldb-backup-run`, which runs `backup.sh` under `env -i`; the drop-in resets `Environment=` (backup README §4.1) | **Accepted.** §2's DSN would have asked for role `afldb-backup` and failed the peer map. Same peer rule, no secret, nothing from the unit environment reaches `backup.sh`. |
| B2 | Drop-in `70-afldb-backup-sealed.conf`, not a replacement unit; every list setting reset first (§4.2) | **Accepted** (§2 left the choice). It keeps `OnFailure=`, `Requires=postgresql.service` and the timeouts, and rollback is one file. |
| B3 | Gate details §3.5 left implicit (§4.3): candidate = the one timer seal in the window; any other seal from window start to window end + 15 min 6 s is ambiguous; `LastTriggerUSec` now must equal the sealed dispatch; `Group`, `SupplementaryGroups`, `NoNewPrivileges` checked; seal name = invocation; the zone file in the trusted set | **Accepted** (stricter). Consequence: G0 must run before the next day's 02:20 trigger (the 10:30 sitting does). |
| B4 | `dispatch_kind` is §3.4's formula literally; a timer restarted after its own dispatch (negative delay) is labelled `catch-up` (§4.4) | **Accepted** (conservative; printed with its delay). |
| B5 | A seal with `dump=none` when PID 1's facts are valid but the staging dump fails a check; the unit fails (§4.5) | **Accepted** (the gate refuses `none`). |
| B6 | No new root failure marker: failure = PID 1's `Result=`; the `OnFailure=` marker in arm's `.state` stays arm-writable information (§4.6) | **Accepted.** G0 and A-2 require `Result=success` from PID 1. |
| B7 | `sealed-origin.sh` is also installed in `/usr/local/lib/afldb-backup`; the verifier sources its own byte-identical copy (§4.7) | **Accepted** (identity verified above). |
| B8 | `scheduled-backup.sh` status opt-in `AFLDB_BACKUP_SEALED_STATE_DIR` (absolute, no default); checkout bytes `234fca6a…` → `7e2b470a…` (§4.8) | **Accepted** (§3.3 asked for it). Production's checkout keeps `234fca6a…`; the verifier ports `status` itself (S9), so no gate executes either copy. Test case in `tests/deploy-web-unit.test.ts`. |
| B9 | Harness image adds `strace`; the container gets `--cap-add SYS_PTRACE` for the harness's own sealing-stage hold (§4.9) | **Accepted** (harness only; never `--privileged`; arm in the container holds no capability). |
| B10 | `pg_dump`/`pg_restore` are reached through PATH `/usr/sbin:/usr/bin`; Ubuntu's `/usr/bin/pg_dump` is a symlink to the root-owned `pg_wrapper`, so it is outside the trusted-path set (§9) | **Flagged residual** (root-owned, arm cannot change it; not digest-pinned). |
| V1 | **Root facts reader** `afldb-verify-rootfacts`: a socket-activated **root** service (`afldb-verify-rootfacts@.service`, `User=root`, `CapabilityBoundingSet=CAP_DAC_READ_SEARCH CAP_SYS_PTRACE`, `ProtectSystem=strict`, `ProtectHome=read-only`, `PrivateNetwork=yes`, `NoNewPrivileges=yes`; socket `/run/afldb-verify-rootfacts.sock` root:afldb-verify 0660, `Accept=yes`) that answers fixed requests for `afldb-verify` (verify README §11.1) | **FLAGGED FOR THE INDEPENDENT REVIEWER.** It is a **new privileged component**: a python3.12 program running as uid 0 with DAC-bypass read and ptrace capabilities that **opens and parses arm-owned paths**. Those paths are `/home/arm` (checkout refs, `.env` key counts, release directories, `release.json`, `events.log`), arm's 0700 backup `.state`, the crontab spool, the 0700 off-host copy and `/proc/<afldb MainPID>/cwd`. Every value it returns from those paths is arm-produced data. Its safety rests on the following, and the reviewer should judge each: O_NOFOLLOW walks from `/`, regular-file and owner checks, size caps, output sanitising, a fixed grammar, and the claim that it executes only `/usr/bin/systemctl show`. It also rests on the socket's group having no member but `afldb-verify` (install-verify checks this). §5 did not foresee this component. The alternative, adding `afldb-verify` to group arm, would break §2. |
| V2 | `/usr/bin/python3.12 -I -S` (the real file, not the `python3` link) replaces arm's node for journal JSON and loopback HTTP (§11.2) | **Accepted with a note.** The bundle files are digest-pinned. System helpers (python, bash, systemctl, journalctl, psql…) are trusted by path and ownership only, not by digest, which reads §5.1's "root-owned and pinned" as pinned for the bundle and root-owned for distro binaries. This is the same model as r6's helpers. |
| V3 | Group `systemd-journal` for `afldb-verify` (§11.3) | **Accepted** (justified per §2: journald's trusted fields without root). |
| V4 | G0B strengthened: a cron dispatch counts only with journald's kernel-attested `_UID=0`, `_TRANSPORT=syslog`, `SYSLOG_IDENTIFIER=CRON`, `SYSLOG_PID=_PID`; `_COMM`/`_EXE` deliberately not required (§11.4) | **Accepted** (stricter than r6; the rehearsal showed `_EXE` breaks genuine dispatches). |
| V5 | `CRON_LOG_FILE` and `R6_DRYRUN` dropped (§11.5) | **Accepted** (the verifier takes no environment). |
| V6 | Host-policy `cmp` against arm's checkout replaced by digests pinned in `a2-core.sh` (§11.6) | **Accepted** (stronger; pins verified above). |
| V7 | `BACKUP-EVIDENCE r7 …` line format (§11.7) | **Accepted** (no consumer parses the r6 form). |
| V8 | The sealed run's failure record is PID 1's `Result=` (§11.8) | **Accepted** (consistent with B6). |
| V9 | `bundle/sealed-origin.sh` is a copy of `backup/sealed-origin.sh` (§11.9) | **Accepted** (byte identity verified; any later change must be copied and followed by `build-sums.sh`). |
| V10 | Harness image adds `python3`, `cron`, `tzdata` (§11.10) | **Accepted** (harness only). |
| V11 | A2 PASS additionally requires `backup-origin=attributed`, and the verdict carries `outcome= r3= r4= day=` beyond §5.2's fields (verify README §3, §5) | **Accepted** (section 5 is part of the whole A-2; the attribution is still printed as its own field). |
| V12 | `version` mode answers for both hosts in one call | **Accepted** (an installation check; no GO meaning). |
