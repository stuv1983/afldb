# R6 r7 sealed nightly backup (MED-3): bundle, installation and rehearsal (28 November 2026)

**Status: PREPARED, NOT INSTALLED. Production was not contacted. R6 stays NO-GO; PR 5 stays draft.** Contract: [../DESIGN.md](../DESIGN.md)
sections 1-4 and 6 (section 5 is the owner verifier's). Rehearsal harness: [../backup-harness/](../backup-harness/).

## 1. What this closes

Review round 2 (MED-3) showed that an arm process outside `afldb-backup.service` could SIGSTOP the arm-owned workload after `backup.sh`
finished, rename other bytes over the dump and SIGCONT it, so the r6 root record bound bytes arm chose. Here the dump is produced by the
system user `afldb-backup` (no login, no key, no sudo, root-owned code, peer authentication with no secret) into
`/var/lib/afldb-backup/staging` (afldb-backup 0700, the only path it can write), and a root `ExecStartPost` copies it into a root-only
temporary, hashes **that** copy, seals the run's PID 1 facts and the copy's sha256, and only then publishes the copy root:afldb-backup-read
0440. arm cannot signal any process of the run (different uid: EPERM), cannot read or write staging, and cannot write, rename, link,
chmod or replace anything in `seals/`, `published/`, `state/`, the code or the unit (the harness's `perm` and `review2` logs record each attempt and its errno).
The gate rule `sealed_origin` reads only root-controlled facts: PID 1, root-owned files, the seal and the published copy. No journal line,
no arm-owned path and no arm-owned binary is read or executed for origin or the dump.

r8 (R8 `DEPENDENCIES.md`): no provenance (P) dependency is reachable by uid arm without root; the remaining ones need root (F1, an owner
action) or a superuser arm database role escalating to root (R7 README §4 item 17). The installer now refuses a root session that
descends from arm (section 4 item 10), and arm's checks of the install run through `--as-arm` (item 11).

## 2. Files and pinned digests

| File (this directory) | Installed as (root:root unless stated) | sha256 |
|---|---|---|
| `afldb-backup-run` | `/usr/local/lib/afldb-backup/afldb-backup-run` 0755 (ExecStart, as afldb-backup) | `2c62ff91…` |
| `afldb-backup-seal` | `/usr/local/lib/afldb-backup/afldb-backup-seal` 0755 (ExecStartPost, root) | `793e94be…` |
| `70-afldb-backup-sealed.conf` | `/etc/systemd/system/afldb-backup.service.d/70-afldb-backup-sealed.conf` 0644 | `f8a18580…` |
| `sealed-origin.sh` | `/usr/local/lib/afldb-backup/sealed-origin.sh` 0644 (gate library; the verifier sources its own byte-identical copy) | `1153df78…` |
| `install-backup.sh` | not installed (owner runs it from the staging directory; r8: refuses a root session descending from arm) | `21c33fa4…` (r7: `f433b81a…`) |
| `verify-backup-install.sh` | not installed (read-only check, run as root, then as root with `--as-arm`) | `f1dcc7db…` (r7: `f286ea7b…`) |
| repository `tools/maintenance/backup.sh` (staged as `backup.sh`) | `/usr/local/lib/afldb-backup/tools/maintenance/backup.sh` 0755, byte-identical | `df609046…` |
| `SHA256SUMS` (the seven staged files) | not installed; `install-backup.sh` writes `/usr/local/lib/afldb-backup/SHA256SUMS` for the four installed code files | `d1c11c25…` (r7: `d0023d10…`) |

Full digests: `SHA256SUMS`. `sealed-origin.sh` pins the run, the sealer, `backup.sh` and the drop-in; `verify-backup-install.sh` pins
`sealed-origin.sh`. If any of those bytes change, re-pin in that order (library, then verify script, then `SHA256SUMS`).

## 3. `sealed_origin` interface (as built; DESIGN 3.5)

`. sealed-origin.sh; sealed_origin <YYYY-MM-DD>` returns 0 only when every rule holds; sets `SO_REASON` (empty on success),
`SO_INVOCATION`, `SO_DUMP`, `SO_SHA` (64 hex), `SO_BYTES`, `SO_DISPATCH_KIND` (`scheduled|catch-up`), `SO_DISPATCH_DELAY_S` (one decimal,
may be negative), `SO_TIMER_USEC`, `SO_SEAL`; stdout only `  sealed-origin: ` lines (one, on success). It also defines
`sealed_origin_install` (rules 1-3 only: trusted paths, pinned digests, effective unit) and helpers `so__tp`, `so__parse`; it defines no
other global. It writes nothing, reads no environment variable and executes only `/usr/bin/{systemctl,busctl,stat,sha256sum,date}`. The
caller needs root or membership of `afldb-backup-read` (published/ is 0750). The caller prints `DISPATCH <kind> <delay> s after timer
activation`, `OFFHOST-COMPARE $SO_DUMP $SO_SHA` on success, and `scheduled origin unproven: $SO_REASON` otherwise.

## 4. Deviations from DESIGN.md, and choices it left open

1. **DSN.** DESIGN's `postgresql:///afldb_prod?host=/var/run/postgresql` names no user, so libpq would ask for role `afldb-backup` and
   the `afldbbackup` map (system user afldb-backup -> role afldb_backup) would refuse it. Built: `postgresql://afldb_backup@/afldb_prod?
   host=/var/run/postgresql`. It is a **constant in the root-owned, pinned `afldb-backup-run`**, which runs `backup.sh` under `env -i` with
   constants only; the drop-in resets `Environment=` (nothing from the unit's environment reaches `backup.sh`). Same peer rule, no secret.
2. **Drop-in, not a replacement unit.** Additive (rollback = delete one file + daemon-reload), keeps the base unit's `OnFailure=`,
   `Requires=postgresql.service`, `TimeoutStartSec`, `Nice`, `IOSchedulingClass`; every list setting the base sets is reset first
   (`ExecStart=`, `ExecStartPost=`, `ExecStartPre=`, `ReadWritePaths=`, `Environment=`, `EnvironmentFile=`, `SuccessExitStatus=`,
   `SupplementaryGroups=`). The gate checks the effective unit as PID 1 loaded it, and the base fragment and every drop-in by trusted path
   (a fragment symlinked into the checkout is refused by the install and by the gate).
3. **Gate rule details DESIGN left implicit:** the candidate is the ONE seal whose start job was created by `afldb-backup.timer` with its
   dispatch in the window; any other seal written from the window start to window end + 15 min 6 s (a start by hand, a second run) makes
   it ambiguous and refuses (the seal analogue of r4's "no other invocation in the window journal"); the timer's `LastTriggerUSec` now must
   equal the sealed dispatch (r6 item 4); `Group`, `SupplementaryGroups` and `NoNewPrivileges` are checked too; the seal's file name must be
   its invocation. Helpers in the trusted-path set: everything the run, the sealer and the rule execute, plus the zone file
   `/usr/share/zoneinfo/Australia/Melbourne` (must be a root-owned regular file: check on production; the install checks it).
4. **`dispatch_kind`** is DESIGN 3.4's formula literally. Review round 1 (F3): catch-up when the timer's realtime activation
   (`timer_active_enter_usec`, sealed) is at or after 02:20:00 Melbourne of the dispatch's date, or when
   `timer_last_trigger_mono - timer_active_enter_mono < 5000000`; the gate recomputes it and refuses a differing label. A timer
   restarted AFTER its own dispatch (negative delay) is therefore labelled catch-up: conservative, printed with its (negative) delay.
   A start by hand (timer never active: activation 0) can only be labelled by the 5 s rule; it is refused anyway (no timer job).
5. **Seal with `dump=none`.** When PID 1's facts are valid but the staging dump fails a check, the sealer writes the raw facts with
   `dump=none` and fails the unit (DESIGN: "raw facts for every successful ExecStart"; the gate refuses `none`).
6. **Failure marker.** No new root marker: a failure is PID 1's `Result=` of the unit (root fact) plus the unchanged `OnFailure=`
   unit's `FAILED-unit` marker in arm's `.state` (arm-writable, informational, as before). `state/last-backup.json` is written only on success.
7. **`sealed-origin.sh` is also installed** in `/usr/local/lib/afldb-backup` (the install's self-check and `verify-backup-install.sh`
   source it); the verifier may source its own copy, which must be byte-identical (`1153df78…`).
8. **`scheduled-backup.sh`:** one explicit opt-in, `AFLDB_BACKUP_SEALED_STATE_DIR=<absolute path>` (status mode only, no default): the
   "backup" check and the off-host-failed check read `<dir>/last-backup.json`; verification, markers and every other mode are unchanged.
   This changes the checkout bytes (`234fca6a…` -> `7e2b470a…`); a probe that needs the nightly's freshness from arm's checkout needs a
   release carrying it, otherwise the verifier's pinned root-owned copy. Test: `tests/deploy-web-unit.test.ts` (new case in the ISSUE-352
   block; Linux only, not run here: no Node on the workstation).
9. **Harness image** adds `strace` (DESIGN 6 lists postgresql-16, openssh, rsync, netcat) and the container gets `--cap-add SYS_PTRACE`:
   only for the harness's own FIXTURE hold of the sealer (section 6). Production has no tracer.
10. **r8 installer guard.** `install-backup.sh` refuses, before any change, a root session that descends from arm: an ancestor
    (walked from `$$` to PID 1 through `/proc/<pid>/status`) with arm's real or effective uid, `SUDO_USER=arm` or `SUDO_UID` = arm's
    uid, or `/proc/$$/loginuid` = arm's uid (unset, 4294967295, is allowed). It prints `REFUSED: root session descends from arm:
    <each test that fired>` and `BACKUP INSTALL RESULT FAIL (nothing was changed)`. A tripwire for `sudo` in an arm session (F1), not
    a proof: root that arm already holds can start the installer outside its own process tree with an unset loginuid.
11. **r8 `verify-backup-install.sh --as-arm`.** arm's checks are acceptance evidence only when root runs
    `verify-backup-install.sh --as-arm`: root re-executes the script's bytes as arm with
    `setsid -w setpriv --reuid=arm --regid=arm --init-groups --reset-env /usr/bin/bash --noprofile --norc -c <bytes>`, stdin `/dev/null`,
    no controlling terminal, output sanitised and prefixed `[as arm] `, and judges by the arm process's exit status and the dropped
    `id` (which must equal root's `id arm`). The bytes, not the path, are passed because the staging directory may be root-only; the
    file's sha256 and the bytes' sha256 are both printed. A run in an arm session ends `BACKUP INSTALL RESULT INFO-ONLY ...` (arm's
    login chooses that process). r8 also fixed r7's `seals: bad array subscript` message when no seal exists yet (INFO line only).
12. **Harness image (r8)** adds `sudo`, used only inside the `arm-sudo` scenario's container.

## 5. Installation (owner; can be done BEFORE the qualifying backup; the production checkout is never written)

Prerequisites: the base `afldb-backup.service` and `.timer` installed as root-owned copies (not links into the checkout); PostgreSQL with
the existing read-only role `afldb_backup`; the r6 attest drop-in NOT installed; outside 02:15-02:50; and **root reached by a path that
does not pass through arm's login** (independent review round 1, **F1**, HIGH, not fixable in code). That means the provider console
logged in **as root**, or the admin root session of `../../review-fixes-r8-20261128/OWNER-PROCEDURE.md` (r8): the separate account
`afldb-admin` with its own key and password, then `sudo -k; sudo /usr/bin/bash --noprofile --norc`. On production root is today
reached by the owner's `sudo` inside an arm SSH session. A hostile arm login environment can capture or reuse that root, and then G1
does not hold, because whoever holds root can write seals and published dumps. None of these qualifies: `sudo` in an arm session,
`ssh afldb … sudo`, or a console login as arm. Creating the admin path is a host-account change needing owner approval
(OWNER-PROCEDURE Phases 0–1), and production `sudoers` is unchecked. Every step below and every rollback step runs in that admin root
session (or at the console as root), and arm's session is never used for any of them. `install-backup.sh` refuses a root session that
descends from arm (r8): an ancestor with real or effective uid arm, `SUDO_USER`/`SUDO_UID` = arm, or loginuid = arm. It prints
`REFUSED: root session descends from arm` and changes nothing. That refusal is a tripwire, not proof; OWNER-PROCEDURE Phase 2 is the
proof.

1. Stage the bundle in a new root-owned directory outside `/home` (e.g. `install -d -m 0755 /root/afldb-r7-backup`): the seven files of
   `SHA256SUMS`, with `backup.sh` = the repository's `tools/maintenance/backup.sh`. Check `sha256sum SHA256SUMS` = `d0023d10…` (this README)
   and `sha256sum -c SHA256SUMS`. r8 sets the source of these bytes and the pin:
   * The only source is a `git archive` of `<R8-PIN:tested-rev>` made in the owner's **workstation** clone and hashed there. It
     travels over the admin path, and the admin root session re-verifies it against the workstation value (OWNER-PROCEDURE 2.1,
     3.1–3.2).
   * Never copy from arm's checkout `/home/arm/projects/afldb`, never run git as root there, and never read the expected digest from
     a file on production.
   * The pin becomes `d1c11c25a35ba16aed0729617ea514078ece390e85b1b73a4eebe85cb2ad1682`, since r8 changes `install-backup.sh` and `verify-backup-install.sh`.
2. `bash /root/afldb-r7-backup/install-backup.sh /root/afldb-r7-backup` as root in the admin root session. It refuses a session that
   descends from arm (r8, above), staging under `/home`, group/other-writable
   staging, any mismatch with `SHA256SUMS`, a library/bundle pin mismatch, a missing helper, an unloaded or untrusted base unit, the r6
   attest drop-in, and a running backup. It creates group `afldb-backup-read`, system user `afldb-backup` (`--system --user-group`,
   home `/nonexistent`, shell `/usr/sbin/nologin`, no supplementary group), adds arm to `afldb-backup-read`, creates the directories of
   DESIGN 2, installs the code and the drop-in, runs `systemctl daemon-reload`, and self-checks with `sealed_origin_install`.
3. PostgreSQL (the install prints these; it does not edit them): `pg_ident.conf` += `afldbbackup afldb-backup afldb_backup`;
   `pg_hba.conf` += `local afldb_prod afldb_backup peer map=afldbbackup` **before any broader `local` line**; then
   `sudo -u postgres psql -c 'SELECT pg_reload_conf()'` (a reload, not a restart). The edits and the reload run in the admin root
   session; there `runuser -u postgres -- psql -X -c 'SELECT pg_reload_conf()'` is the same command without a second sudo.
4. From the admin root session, run `bash verify-backup-install.sh` (root's checks), then `bash verify-backup-install.sh --as-arm`
   (r8). With `--as-arm`, root drops to arm itself: `setpriv --reuid=arm --regid=arm --init-groups --reset-env`,
   `/usr/bin/bash --noprofile --norc`, stdin `/dev/null`. The fresh process carries the new group without arm's login or startup
   files; this replaces r7's "as arm in a new login". Both must print `BACKUP INSTALL RESULT PASS`. For root, that means peer login
   works as afldb_backup. For arm, it means arm cannot list staging, cannot write any directory, can list published, and cannot
   authenticate as afldb_backup.
5. streamanator: the off-host pull source becomes `<prod>:/var/lib/afldb-backup/published/` (`offhost-pull.sh` unchanged; arm reads
   through `afldb-backup-read`). Status probes add `AFLDB_BACKUP_SEALED_STATE_DIR=/var/lib/afldb-backup/state`. This is an
   unprivileged change to arm's own files (the forced `rrsync -ro` path in production arm's `authorized_keys`, and streamanator's pull
   configuration), with no root step. The pull's authenticity is not relied on: G0B checks the copy. G0B itself is only as
   independent as streamanator's root path (OWNER-PROCEDURE §8). streamanator's arm is in `docker`, `lxd` and `sudo`.
6. Leave the timer alone. The next 02:20 run writes `/var/lib/afldb-backup/seals/<invocation>.seal` and publishes the dump; until then
   every gate STOPs (`0 seals … in the window`), by design.

## 6. Rollback

Every rollback command runs in the admin root session (or at the console as root), never in an arm session. That covers the
`rm`, `daemon-reload`, `gpasswd`, the pg line edits and the reload (`runuser -u postgres -- psql -X -c 'SELECT pg_reload_conf()'`).
`rm /etc/systemd/system/afldb-backup.service.d/70-afldb-backup-sealed.conf && systemctl daemon-reload`: the unit runs as before (User=arm,
`scheduled-backup.sh backup` in the checkout, `/home/arm/backups/afldb-scheduled`). Optional, afterwards: `gpasswd -d arm afldb-backup-read`,
remove the pg_hba/pg_ident lines and reload. Keep `/var/lib/afldb-backup` (published dumps and seals are backups and evidence) until the
owner decides; nothing else was changed.

## 7. Preserved

Retention 14 in `published/` by name (sidecars follow, seals kept); `backup.sh` byte-identical; `restore-test.sh`, `offhost-pull.sh` and
the weekly `afldb-backup-verify.service` (arm, fresh dump in `/home/arm/backups/afldb-scheduled`, restore test) unchanged; its dumps are
never gate-eligible (gates read only seals and `published/`); `scheduled-backup.sh status` reports the nightly through the opt-in.

## 8. Rehearsal on real systemd (`../backup-harness/`, run `final1`, 28 Nov 2026, worktree bytes on `2d772fe4`)

> Coordinator note: the `final1` logs below ran on uncommitted worktree bytes. They are kept in `../backup-harness/logs/dev-final1/`
> as development history and are not evidence for any committed revision. The run at the tested revision is recorded in
> [../README.md](../README.md), and its logs are in `../backup-harness/logs/`.

Run: `bash docs/v2/evidence/backlog-20261121/r6-20261125/review-fixes-r7-20261128/backup-harness/r7b-run.sh [--verify-rev <rev>] <RID>
[scenario …]` (workstation Git Bash; streamanator as arm; builds `r7b-sysd-<RID>:1` from the pinned base, one `--network none`
container per scenario, removes everything). Logs: `../backup-harness/logs/r7b-<scenario>.log`, `r7b-summary.log`,
`r7b-transport-final1.log`. Real systemd 255.4-1ubuntu8.19 as PID 1, real PostgreSQL 16 `afldb_prod` with peer auth for afldb-backup,
the real timer at the fake-zone 02:20, the real `backup.sh`, the bundle installed by its own `install-backup.sh`, the gate judged by
the installed `sealed_origin` run as `r7reader` (not arm, not root, in `afldb-backup-read`). **`R7 BACKUP HARNESS RESULT PASS`**, 10/10:

| Scenario | Result |
|---|---|
| genuine | attributed: invocation, `afldb_prod-20261128-022000.dump`, full sha256 = root's capture of the staging file at rename; scheduled; nonce in dump; retention 15+1 -> 14; arm `pg_restore --list` and REAL `offhost-pull.sh` from `published/` OK; arm peer login refused; status opt-in sees it; 3 install refusals (under /home, g+w, tampered) |
| perm | attributed (sha = root's hash during the hold); arm suite creation 79 / sealing 94 / published 100 attempts, 0 allowed (EACCES, EPERM incl. every SIGSTOP, D-Bus denied, PG auth failed), stat of every parent logged |
| review2 | attributed genuine bytes; arm watcher outside the unit: every SIGSTOP EPERM (or ESRCH: already exited), staging and published replacement refused |
| hand-start / timer-then-hand / restart | refused: 0 timer seals in window / another run sealed in window / inactive_enter after the dispatch |
| rearm-in / rearm-out | attributed `dispatch=catch-up` 0.0 s / refused (catch-up at 02:32) |
| pgdump-fails / seal-interrupted | refused; unit failed; no seal (pgdump) or seal without a published file (SIGKILL between seal and rename); OnFailure fired |

Review round 1 added three scenarios (results at the tested revision: [../README.md](../README.md), "review round 1 fixes"):
`genuine-rd` (no timing drop-in: the real deploy timer's `RandomizedDelaySec=10min`, `AccuracySec=1min`; attributed, scheduled),
`rearm-in-rd` (the same production timing, re-armed at 02:20:15: attributed, catch-up, F3) and `post-pub-fail` (a root directory at
`state/last-backup.json` makes the sealer fail after publication; `systemctl reset-failed` clears `Result=`; refused for the missing
completion record, F4). Every attributed scenario also checks the completion record.

FIXTURE differences from production: fixed-offset zone (whole minutes); timer `RandomizedDelaySec=0`, `AccuracySec=1s` (except the two
`-rd` scenarios, which use production timing); fixture database
and role grant; owner pg edit applied by the harness; the two HOLDS (a root psql lock that keeps pg_dump waiting: creation stage; a root
`strace` delaying the sealer's first chown by 25 s: sealing stage) - neither exists in production and neither changes any pinned byte.

## 9. Residuals and what is not proven

* Root/sudo, the PostgreSQL server and its data (arm holds the owner DSN and can change the data: a different property from provenance),
  and streamanator's arm (DESIGN 5.4) are out of scope. **F1:** root is reached through arm's login on production today, so this
  exclusion holds only once the owner uses a root path that does not pass through arm's login (section 5).
* Production facts unverified: unit install form (copy vs link), `/usr/local/lib` and `/var/lib` modes, the zone file type, the
  PostgreSQL major/cluster path (`/etc/postgresql/*/main`), the socket `/var/run/postgresql`, systemd 255.4's job ActivationDetails there.
  `install-backup.sh` and `verify-backup-install.sh` check each of these on the host.
* `pg_dump`/`pg_restore` are reached through PATH `/usr/sbin:/usr/bin` (Ubuntu's `/usr/bin/pg_dump` is a symlink to the root-owned
  pg_wrapper, so it is not in the trusted-path set; it is root-owned and arm cannot change it).
* A `Persistent=` catch-up whose PostgreSQL dependency takes more than 5 s is a false STOP (unchanged from r6); two seals in the window
  (a start by hand after the timer's run) STOP as ambiguous.
* Disk: the published copy and the staging copy coexist during sealing (2x one dump).
* r8: the installer guard (section 4 item 10) is a tripwire, not a proof of an independent root path; the `loginuid` test is not
  exercised by the harness (a container cannot set loginuid without `CAP_AUDIT_CONTROL`). Under `--as-arm`, another arm process can
  write text into the arm child's output pipe (same uid); it appears only as `[as arm]` data and cannot change the exit status that
  decides the result.
