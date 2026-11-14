# Procedure 02: production host patching policy (ISSUE-351, decision D-HO-1)

Status: **procedure, not executed; both policy files are PREPARED, NOT INSTALLED** (read-only probe 2026-11-14 16:07 AEDT:
`/etc/needrestart/conf.d/` holds only `README.needrestart`; `/etc/apt/apt.conf.d/52-afldb-unattended` does not exist;
`raw/prod-ro-ops-procedures.txt`). Author: scope `ops`, remediation run 2.
Canonical sources: `deploy/host-policy/needrestart-afldb-hold.conf`, `deploy/host-policy/apt-52-afldb-unattended.conf`,
`docs/deployment.md` §3a "Patching and restarts", `docs/v2/evidence/remediation-20261114/hostops/README.md` §1, §3, §6b.

## 1. Purpose

Remove the two things that turn a routine security update into an unannounced outage, and give them to the owner:

1. **needrestart** restarting `afldb` and PostgreSQL. Observed 2026-11-14 06:35:16-06:35:21 AEDT after a libc6 upgrade:
   `afldb.service` and `postgresql@16-main.service` restarted within seconds (`afldb` has `Requires=postgresql.service`).
   The "automatic" mode is inferred from configuration and code, not observed by running needrestart.
2. **PostgreSQL server package upgrades**, whose postinst restarts the cluster regardless of needrestart.

Security updates **keep installing** on the same schedule (`unattended-upgrades` is untouched: release pocket, `-security`,
ESM apps and infra security; no `Automatic-Reboot`). Kernels therefore wait for an owner reboot (procedure 03).

## 2. The policy, in one paragraph

Unattended: every security update except PostgreSQL server packages. Held for the owner: restarts of `afldb` and
PostgreSQL (needrestart `override_rc`), and PostgreSQL server upgrades (`Package-Blacklist`). The cost is that the running
processes keep old libraries mapped until the owner restarts them, so a **weekly owned maintenance window** is part of the
policy: without it the hold is an unbounded security debt, not a policy.

## 3. Who is responsible for PostgreSQL minor updates once held

**The owner, in the weekly window.** Nothing else installs them: the four blacklisted names (`postgresql-16`,
`postgresql-client-16`, `postgresql-common`, `postgresql-client-common`) are skipped by `unattended-upgrades`, and no
repository tool or timer applies them. A PostgreSQL security update is therefore **pending until the owner runs it**; the
weekly window's first action is to list what is owed (§6). Recommended cadence: weekly; at the latest within the severity
SLA the owner accepts for a PostgreSQL CVE (not set by this repository). An unattended `apt upgrade` run by hand by anyone
will ignore the blacklist (it only governs `unattended-upgrade`), and will restart PostgreSQL: do not run one outside the window.

## 4. Prerequisites

- Console or SSH access as `arm` with the **sudo password** (arm is in group `sudo`, `/etc/group`; the password is the owner's;
  the `sudo` prompt is why no unattended agent can do this).
- The serving checkout holds the candidate's `deploy/host-policy/` files and `deploy/release.mjs` with `host-gate`
  (the checkout at 2026-11-14 is `c1c4b22e`, which has neither: release B1 first, or copy the two files from the published
  revision and verify their sha256 against `git show <R>:deploy/host-policy/...`).
- A time outside 05:00-07:15 AEDT and no release in flight (`node deploy/release.mjs status` clean).
- Nothing else is needed: no restart is part of the install; the files take effect for the **next** apt run.

## 5. Install (owner, root; recovery: remove the files)

```
cd /home/arm/projects/afldb        # at the published revision
sha256sum deploy/host-policy/needrestart-afldb-hold.conf deploy/host-policy/apt-52-afldb-unattended.conf   # compare with git
sudo install -m 0644 -o root -g root deploy/host-policy/needrestart-afldb-hold.conf /etc/needrestart/conf.d/50-afldb-hold.conf
sudo install -m 0644 -o root -g root deploy/host-policy/apt-52-afldb-unattended.conf /etc/apt/apt.conf.d/52-afldb-unattended
```

Recovery: `sudo rm /etc/needrestart/conf.d/50-afldb-hold.conf /etc/apt/apt.conf.d/52-afldb-unattended`. No service or timer is
touched by either command or by the removal.

## 6. Validation (the files were never exercised by the real tools)

The repository proves syntax and the two regexes only (`hostops/host-evidence/needrestart-conf-check.txt`). **Everything below
is verified after installation, by the owner, and recorded:**

```
sudo needrestart -r l                                        # list only: afldb/PostgreSQL appear as owed and nothing restarts
apt-config dump | grep -i 'Package-Blacklist'                # the four names appear (readable by arm)
sudo unattended-upgrade --dry-run --debug 2>&1 | grep -iE 'blacklist|postgres'   # dry run: PostgreSQL skipped (was never run)
node deploy/release.mjs host-gate --strict                   # as arm: needrestart hold recognised (reads conf.d, world-readable)
```

If `needrestart -r l` shows `afldb.service` or `postgresql@16-main.service` as *to be restarted automatically*, the hold did not
take: remove the file and treat the policy as not installed.

## 7. The weekly owned window (30 minutes; suggested after the apt run, outside 05:00-05:45; the owner picks the day)

```
sudo needrestart -r l                                        # what is owed (processes on stale libraries)
apt list --upgradable 2>/dev/null | grep -E '^(postgresql|libpq)'      # held PostgreSQL updates, readable by arm
sudo apt-get install --only-upgrade postgresql-16 postgresql-client-16 postgresql-common postgresql-client-common   # only if listed
sudo systemctl restart postgresql@16-main afldb              # PostgreSQL then the app; ~5 s outage
node deploy/release.mjs status --expect <current id> --confirm-attended-restart   # as arm; this restart was yours
bash deploy/post-install-check.sh <current id>
```

`--confirm-attended-restart` is required here: the owner's own `apt-get` and restart in this window coincide with an apt run,
which `status --expect` otherwise fails as a possible unattended-upgrade restart (`deploy/release.mjs` restart audit; review
REVIEW-C LOW-3). Use it only for a restart you made yourself in this window.

A PostgreSQL package upgrade restarts the cluster from its own postinst: the explicit restart that follows is then a no-op
for PostgreSQL and the app restart is the one that matters. Do not start the window within 90 minutes of
`apt-daily-upgrade` (`host-gate` refuses a `promote` there; the window itself is not gated). The settle timer fires 05:00-05:15:
do not restart during it.

Failure: `journalctl -u afldb -u postgresql@16-main` (owner `sudo`; arm cannot read the journal); the release is unchanged by a
failed restart; `rollback --attended` only if the release itself is implicated. The data is untouched by a package upgrade of
the same major version; a major version change is not part of this policy.

## 8. What the policy does not cover

- ssh, cron, journald, networkd, resolved, timesyncd, udev, polkit, rsyslog and multipathd also restarted on 2026-11-14 and still
  will: the hold names `afldb` and PostgreSQL only. **Caddy did not restart** on 2026-11-14, but is not held: a Caddy package
  or library upgrade could restart it (`caddy.service`, `ExecReload` in the unit; an unheld restart is a seconds-long public
  outage, not data loss).
- A **pending reboot**: kernel packages install and wait. Procedure 03. `release.mjs host-gate` reports it.
- A crash or reboot activating an already-switched release: `docs/deployment.md` §3a "What `--attended` protects".
- Caddy 2.11.4 runs while a newer release exists: not an origin of this policy.

## 9. Unverified

- That `needrestart` honours the hold on this host (never run); that `unattended-upgrade --dry-run` skips PostgreSQL (never run).
- That a held PostgreSQL package does not also block a dependent upgrade (unattended-upgrades skips an upgrade it cannot
  complete without a blacklisted package: effect on e.g. `libpq5` not observed).
- sudoers, the root crontab, `/var/log/unattended-upgrades/` (root-only).
