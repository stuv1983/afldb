# Procedure 05: scheduled backups, restore verification and the off-host copy (ISSUE-352; D-HO-2, D-HO-3, D-HO-5, D-HO-7)

Status: **procedure; everything is PREPARED, NOT INSTALLED** (probe 2026-11-14: `afldb-backup.timer` and `afldb-backup-verify.timer`
`LoadState=not-found`; `/home/arm/backups/afldb-scheduled` does not exist). Author: scope `ops`, remediation run 2.
Canonical: `docs/backup-restore.md` §3 (install), §4 (off-host), §6 (DR). This file adds roles, sequence, the pull-key setup, failure
handling, and what the probe established.

## 1. Facts read on 2026-11-14 (`raw/prod-ro-ops-procedures.txt`, `raw/prod-ro-ops-rsync.txt`)

- Production has no scheduled backup and no `arm` crontab. `~/backups/afldb` holds 880 MB in 90 files (per-operation dumps and
  sidecars; newest 2026-11-12); `/` has 45 GB free of 77 GB.
- The serving checkout is `c1c4b22e`: its `backup.sh` (2026-08-16) and `restore-test.sh` (2026-09-26) **predate** the ISSUE-341/342
  contract and it has no `scheduled-backup.sh` or `afldb-backup*` unit files. A published release and a checkout update come first.
- `.env` holds `AFLDB_BACKUP_DATABASE_URL`, `AFLDB_OWNER_DATABASE_URL` and a key named `AFLDB_BACKUP_DIR` (values unread). The wrapper is
  not affected by that key: it passes `--dir` (`scheduled-backup.sh:109`, `backup.sh:47`) and refuses a dump outside its directory (`:114`).
- `rsync` 3.2.7, `rrsync`, `pg_dump`, `pg_restore`, `gpg` and `curl` are installed on production. `sshd` allows user `arm` only, key
  authentication only; `authorized_keys` holds two keys, no forced-command options.
- No outbound alert channel exists: a failed backup unit writes a marker and an error-priority journal line the owner alone can read.
  **`status` has no pusher**; see procedure 04 (the same pull pattern serves the backup probe).

## 2. Purpose and the proposed numbers

A nightly dump (02:20 + up to 10 min) in a dedicated directory with a sha256 sidecar; a weekly (Wednesday 03:30) fresh dump restored by
the real `restore-test.sh` into `afldb_restore_test` with nine parity checks; an off-host copy that production cannot delete.
Proposed **RPO 24 h** (worst case about 29 h) for non-derivable data; **RTO 1 h** for the database with the host intact (rehearsed on
an isolated host: fresh dump 9 s, restore-test 17 s; not measured on production); host-loss RTO unrehearsed. Retention 14 local, 30
off-host. These are proposals for the owner to accept or change; no one has accepted them.

## 3. Prerequisites

1. A published revision with ISSUE-352 and release B1 (so the checkout can be updated); the serving checkout updated to it and its files
   verified (`sha256sum` against `git show <R>:...`) including `restore-test.sh` at or after ISSUE-342.
2. An owner host that stays up, with `pg_restore` and `rsync`, for option A; its own disk-encryption and backup posture decided (the dumps
   contain authentication data and audit history; the destination is mode 700).
3. `afldb_restore_test` exists on production (probed 2026-11-14, about 0.4 GB, an older `afldb.restore_test.v1` marker); the weekly
   verification overwrites that marker (the sidecar and `last-verify.json` carry the new proof).
4. Console access and the owner's `sudo` password for the unit install.

## 4. Roles

- **`arm`**: create the directory, run `scheduled-backup.sh status`, run the pull key's script, update the checkout. Cannot install units,
  enable timers, or read the journal.
- **Owner with `sudo`**: `install` the units into `/etc/systemd/system`, `daemon-reload`, `systemctl start`/`enable --now`.
- **Owner host**: runs `offhost-pull.sh` and holds the second site.

## 5. Install (owner; `docs/backup-restore.md` §3 is the exact block; sequence and checks)

```
# as arm, at the published revision in the serving checkout
install -d -m 700 /home/arm/backups/afldb-scheduled
bash -n tools/maintenance/scheduled-backup.sh && sha256sum tools/maintenance/scheduled-backup.sh tools/maintenance/restore-test.sh
# owner, sudo: the five unit files, verify, reload (§3 of backup-restore.md), then the ATTENDED first runs:
sudo systemctl start afldb-backup.service            # watch: journalctl -u afldb-backup -f (owner reads the journal)
sudo systemctl start afldb-backup-verify.service     # proves restore-test.sh end to end on THIS host
env AFLDB_BACKUP_DIR=/home/arm/backups/afldb-scheduled bash tools/maintenance/scheduled-backup.sh status   # as arm: expect exit 0
sudo systemctl enable --now afldb-backup.timer afldb-backup-verify.timer
systemctl list-timers 'afldb-backup*'
```

Units: `SuccessExitStatus=75` on both services (lock held is not a failure; review A-04, verified at `deploy/afldb-backup.service:29`
and `deploy/afldb-backup-verify.service:27`); `OnFailure=afldb-backup-failed.service` writes `FAILED-unit` and an error line.
**A lock-lost verification is silent by design** (exit 75, no marker): `status` turns red when the last verification is older than
9 days, so a skipped week is noticed within two days of the next missed Wednesday, not the same day.

Do not take a manual backup with the **bare** `backup.sh` in `~/backups/afldb`: it prunes every `afldb_prod-*.dump` there to 7 (old copy)
or to `--keep` (new copy), which would delete the dumps release packets bind by hash. Always `--dir <a new directory>`.

## 6. Off-host, option A (recommended): pull from the owner host

On production, as `arm`, one more `authorized_keys` line for a key generated on the owner host; `rrsync -ro` confines it to a read-only
rsync of that one directory (present: `/usr/bin/rrsync`):

```
command="/usr/bin/rrsync -ro /home/arm/backups/afldb-scheduled",restrict ssh-ed25519 AAAA... afldb-backup-pull
```

On the owner host (cron or a user timer, daily after 02:40, for example 03:10): 
`bash tools/maintenance/offhost-pull.sh arm@<production host>:/ /abs/path/to/offhost-dir/ --keep 30` (the `rrsync` root is the confined directory,
so the source path is `/`; **this exact invocation was not run**: the rehearsal used a local stand-in directory, not ssh). The destination
directory must already exist (a missing mount must fail). Exit codes: 0 verified; 1 a copy failed verification (quarantined) or the rsync failed;
the script prunes nothing in a run that verified more than 3 new dumps. A non-zero exit or an absent run is an alarm on the owner host
(procedure 04 pattern). Disk encryption of the destination is the owner's; for object storage use `gpg` before upload (option B) and keep the
passphrase separately.

Option C (a mounted volume via `AFLDB_OFFHOST_DEST`, `AFLDB_OFFHOST_REQUIRE_MOUNT=1`) is a convenience copy only: a volume attached to the same droplet
does not survive droplet loss unless it is detached and re-attachable elsewhere.

## 7. Validation

- `scheduled-backup.sh status` exit 0 after the first runs; `last-verify.json` names a verified dump and a parity pass; the verification
  recorded the dump sha256 as the `afldb_restore_test` database comment.
- A dump exists in the off-host directory, `.verified-<name>` present, `sha256sum -c` on the owner host passes, and one **restore** of an
  off-host copy into a scratch database on the owner host has been done once (the pull proves bytes and archive table of contents, not a restore).
- Within 25 hours the next nightly dump appears; within 8 days the next Wednesday verification replaces `last-verify.json`.

## 8. Failure handling

| Symptom | Action |
|---|---|
| `status` exit 1 | read which condition it names (age of newest backup > 30 h, verification older than 9 days, a `FAILED-backup` or `FAILED-verify` marker, off-host failure); a `FAILED-<mode>` marker is cleared only by a success of the same mode; the next timer firing is the retry (there is no retry loop) |
| Verify fails (parity or restore) | the dump or the restore is suspect: do **not** assume the nightly dumps are good; run `restore-test.sh` by hand; investigate before the next Wednesday |
| `exit 75` in the journal | benign lock contention (a catch-up boot); nothing to do |
| Off-host pull quarantines a dump | read `<dest>/quarantine`; a future-stamped or foreign-named dump is the A-03 signal: treat the source as suspect |
| Disk fills | `~/backups/afldb-scheduled` keeps 14; per-operation dumps in `~/backups/afldb` are never pruned automatically |

## 9. Recovery and removal

`sudo systemctl disable --now afldb-backup.timer afldb-backup-verify.timer; sudo rm /etc/systemd/system/afldb-backup*; sudo systemctl daemon-reload`;
remove the `authorized_keys` line. Database recovery is `docs/backup-restore.md` §6 (procedure A: restore into a new candidate database,
reconcile privileges, swap; never `pg_restore --clean` over the live name).

## 10. Decisions and what remains unverified

- D-HO-2 install (recommended after the checkout update); D-HO-3 destination A (recommended); D-HO-5 a dump after each settle (recommended
  not yet: up to about 29 h of re-derivable nightly writes); D-HO-7 the stale `afldb_prod_*` databases seen read-only (a separate owner choice).
- Unverified: the units under systemd (never started anywhere; `systemd-analyze verify` only); the ssh/`rrsync` transport; host-loss RTO;
  production RTO; root crontab, sudoers, `.env` values, `afldb_restore_test` ownership; DigitalOcean snapshot/backup availability (which would be
  a complement, not a substitute: they are not application-consistent dumps).
