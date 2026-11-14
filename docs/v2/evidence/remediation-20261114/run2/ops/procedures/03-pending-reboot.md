# Procedure 03: the pending production reboot (ISSUE-351, decision D-HO-6)

Status: **procedure, not executed; a separate attended owner operation, never part of any unattended path.**
Author: scope `ops`, remediation run 2. Canonical source: `hostops/README.md` §6a, amended below by facts read on 2026-11-14.

## 1. Facts (read-only probe 2026-11-14 16:07 AEDT; `raw/prod-ro-ops-procedures.txt`)

- Running kernel `6.8.0-137-generic`; boot time 2026-08-16 12:14:44 (about 90 days uptime). `/var/run/reboot-required` present.
  `reboot-required.pkgs` names `linux-image-6.8.0-138/139/142/146/147/149-generic`, `linux-base`, `libc6`.
- **Amendment to the hostops README ("installed 138-149").** `dpkg -l` shows only `-137` and `-149` installed (`ii`); `-138`,
  `-139`, `-142`, `-146`, `-147` are `rc` (removed, configuration remains); `/boot` holds `vmlinuz`/`initrd` for 137 and 149 only.
  So the reboot moves production from 137 to **149**, and 137 stays installed as the only fallback kernel.
- **GRUB is configured with a hidden menu and no timeout**: `/etc/default/grub` `GRUB_TIMEOUT_STYLE=hidden`, `GRUB_TIMEOUT=0`,
  `GRUB_RECORDFAIL_TIMEOUT=0`, `GRUB_DEFAULT=0` (first entry = newest kernel, 149); a cloud-init drop-in also sets `GRUB_TIMEOUT=0`.
  The kernel command line already carries `console=tty1 console=ttyS0`, and `serial-getty@ttyS0` and `getty@tty1` are active.
  **Consequence: selecting kernel 137 at boot means interrupting a zero-second hidden GRUB at the cloud console (Shift or Esc at
  power-on), which is unreliable.** The hostops fallback ("select the previous kernel from GRUB") was written without this fact.
- `afldb`, `postgresql@16-main`, `caddy` are active; `afldb` is `enabled` (starts at boot and after PostgreSQL;
  `docs/deployment.md` §4). `afldb-settle-afl-api.timer` is active with `Persistent=yes`: a missed 05:00 run fires on the next boot.
- `arm` is in group `sudo` (needs the owner's password); `sshd` allows user `arm` only, key authentication only; two keys.
- `droplet-agent` and `do-agent` are active (DigitalOcean browser console and metrics agents). Whether the DigitalOcean control
  panel Console, Recovery Console, snapshots or backups are available to the owner is **unverified** (not visible from the host).

## 2. Purpose

Install the patched kernel (and the libc already on disk for processes started after boot) in one planned, attended outage
instead of leaving ninety-plus days of kernel patches unapplied.

## 3. Prerequisites (all must hold)

1. **Console access verified first**, before the day: log in to the DigitalOcean control panel, open the droplet Console, and
   confirm it shows a login prompt (this proves `console=tty1` works for you). Record the date. Without it, do not reboot.
2. **A fallback for a kernel that does not boot**, chosen before the reboot (the hidden GRUB means "pick 137 at the menu" is not
   a plan). Options: (a) a DigitalOcean snapshot taken minutes before (needs panel access; takes the droplet to a consistent
   disk image; cost: snapshot time and storage; availability **unverified**); (b) make the GRUB menu visible for this one boot:
   `printf '%s\n' 'GRUB_TIMEOUT_STYLE=menu' 'GRUB_TIMEOUT=10' | sudo tee /etc/default/grub.d/99-afldb-reboot.cfg && sudo update-grub`
   (a drop-in sorts after cloud-init's `50-`; **never tried on this host**; remove the file and `sudo update-grub` afterwards);
   (c) accept the risk: the same-series Ubuntu kernel 149 is a routine security update and the console remains available
   for a rescue. **Recommendation: (a) if available, plus the console check; (b) only if (a) is not.**
3. **A fresh verified backup copied off the droplet.** Do **not** run `backup.sh` bare: the serving checkout's copy (HEAD
   `c1c4b22e`) prunes every `afldb_prod-*.dump` in `~/backups/afldb` down to 7 (`backup.sh:41`, `:123-124`), which would delete
   the per-operation dumps release packets bind by hash. Use an explicit directory:
   `bash tools/maintenance/backup.sh --dir /home/arm/backups/afldb-prereboot-<date> --keep 3` then copy it off-host and check
   its sha256 on the other host. (After ISSUE-352 is installed, `scheduled-backup.sh status` exit 0 and a verified off-host copy
   replace this.) The off-host copy is the owner's: see procedure 05.
4. The patching policy (procedure 02) installed, so that nothing unattended restarts the stack between the reboot and the
   window; not a hard dependency, a strong preference.
5. No release in flight: `node deploy/release.mjs status` shows `current` running (no "restart pending"); no promote without its restart.
6. A time **outside 05:00-07:15 AEDT** (settle 05:00-05:15 plus its runtime; apt-daily-upgrade 06:00-07:00 plus up to 60 min of
   randomised delay) and outside the owner-chosen maintenance habits. Expected outage: roughly 1-3 minutes of site unavailability
   plus boot time (not measured on this droplet).

## 4. Commands (owner, root via `sudo`)

```
node deploy/release.mjs host-gate                              # as arm; reports the pending reboot; refuses only if apt is running or due
sudo systemctl stop afldb-settle-afl-api.timer                 # no run can start while we go down
systemctl is-active afldb-settle-afl-api.service               # must be inactive (wait if it is running)
sudo systemctl reboot
# --- after boot, from the console or ssh as arm ---
uname -r                                                        # expect 6.8.0-149-generic
systemctl is-active postgresql@16-main afldb caddy              # all active
sudo systemctl start afldb-settle-afl-api.timer                 # the timer is enabled and starts itself at boot; this is a no-op check
systemctl list-timers 'afldb*' --no-pager
node deploy/release.mjs status --expect <current id>
bash deploy/post-install-check.sh <current id>
sudo journalctl -b -p warning --no-pager | tail -50             # the journal is owner-readable only
```

`status --expect` will report a restart (InvocationID changed) as a **note**, not a failure: a reboot does not coincide with an
apt run. That is correct here; record that the reboot was yours.

## 5. Validation

Kernel 149 running; `postgresql@16-main`, `afldb`, `caddy` active; `status --expect` PASS; `post-install-check.sh` PASS; the
public site answers (`/api/health` 200 through Caddy); `/var/run/reboot-required` gone; the next 05:00 settle runs
(`systemctl show afldb-settle-afl-api.service -p Result,ExecMainStatus` the next morning, or the procedure-04 status check).

## 6. Failure handling and recovery

| Symptom | Action |
|---|---|
| The droplet does not answer after 10 minutes | Console: if a login prompt, `journalctl -b`; if no console output, use the fallback chosen in §3.2 (restore the snapshot, or interrupt GRUB and select 137) |
| Boots on 149 but a service is down | `systemctl status <unit>`; `journalctl -u <unit> -b`; `afldb` failing with a release problem: `release.mjs rollback --attended` and `systemctl restart afldb` |
| PostgreSQL does not start | `journalctl -u postgresql@16-main -b`; do **not** restore over production as a first step; `docs/backup-restore.md` §6 only after diagnosis |
| The new kernel misbehaves but the host is up | Boot 137 once (needs a visible GRUB per §3.2 (b)), then `sudo apt-mark hold linux-image-6.8.0-149-generic` is **not** recommended without an owner decision (security debt); open an issue with the evidence |

Recovery of the host state is the pre-reboot backup and, if taken, the snapshot. The reboot changes no database, release or
configuration state.

## 7. Cadence going forward

Recurring: after the policy is installed, `host-gate` prints "reboot pending" until it is done. A suggested rule: reboot within
30 days of the first pending kernel unless the owner records why not (not set by the repository; the 90-day gap that exists
today shows an unowned default).

## 8. Unverified

DigitalOcean console, Recovery Console, snapshot and backup availability; the GRUB menu behaviour under (b); the boot time and
outage length of this droplet; whether the settle timer's `Persistent` catch-up fires immediately after boot and its interaction
with a pending libc update; the contents of `grub.cfg` (root-only, `-rw------- root`).
