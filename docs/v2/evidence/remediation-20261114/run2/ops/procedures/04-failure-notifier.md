# Procedure 04: how a failed nightly settle reaches a human (ISSUE-332, review A-07, decision D-332-1)

Status: **procedure; everything it installs is PREPARED, NOT INSTALLED.** Author: scope `ops`, remediation run 2.
Evidence: `raw/prod-ro-ops-notify-logs.txt` (read-only probe 2026-11-14 15:55 AEDT), `raw/prod-status-check.txt` (the pull check run
read-only against production), `ops/README.md` §2.3.

## 1. The record: how a failure signal reaches a human TODAY

**No notification is delivered. Marker and journal only, and today not even those exist.** Read-only facts on production:

| Question | Answer (2026-11-14) |
|---|---|
| Local MTA, `sendmail`, `mail`, `mailx`, `msmtp`, `ssmtp`, `exim4`, `postfix`, `opensmtpd` | **none installed** (`command -v` absent, `/usr/sbin/sendmail`, `/etc/aliases`, `/etc/mailname` absent, `/var/mail` empty) |
| Mail spool consumers, cron `MAILTO`, arm crontab | none (`no crontab for arm`; no `MAILTO` in `/etc/crontab` or `/etc/cron.d`) |
| Monitoring or alerting agent | only DigitalOcean's `do-agent` (metrics to the DO control panel) and `droplet-agent` (console/ssh helper). No Prometheus/node-exporter/Datadog/Zabbix/monit/healthcheck unit. What alert policies exist in the DO panel is **unverified** (not visible from the host); host metrics alerts cannot see a failed systemd unit |
| Journal forwarding | none. `ForwardToSyslog=yes` is the Ubuntu default and goes to **local** `/var/log/syslog` (`syslog:adm 0640`, 4 weekly rotations); `/etc/rsyslog.d/` has no remote action; no `journald.conf` override |
| Who can read the journal | `arm` cannot (groups: `arm sudo users`; not `adm`, not `systemd-journal`); only the owner via `sudo` |
| Settle unit failure hook | `OnFailure=` is **empty** on `afldb-settle-afl-api.service`, the Brownlow service and `afldb.service`; `afldb-settle-failure@` is not installed (`LoadState=not-found`), `/var/lib/afldb-settle-failure` does not exist |
| Outbound capability | `curl` and `wget` exist; no connection was opened by the probe. SMTP keys exist in the application `.env` (`AFLDB_SMTP_*`, names only read); the settle units drop them by design (ISSUE-232) |

So a failed nightly leaves exactly: the unit in `failed` state / `Result=exit-code` (visible to anyone who runs
`systemctl show`), and journal lines only the owner can read. **Nobody is told.** With the prepared notifier installed as
filed (D-332-1: four `sudo` commands), the position is: a marker file `arm` can read, one journal line, and still no
delivery: the template has `PrivateNetwork=true` and `RestrictAddressFamilies=AF_UNIX`, so any mail relay or webhook set as
`AFLDB_FAILURE_TRANSPORT` inside it would log "transport exited non-zero" and deliver nothing (review A-07, confirmed).
The nightly's own `AFLDB_SETTLE_FAILURE` echo goes to the same unreadable journal.

## 2. Options (owner choice; the notifier's sandbox is not weakened by any of them)

| | Option | What the owner does | Detects | Residual |
|---|---|---|---|---|
| **A (recommended)** | **Pull check from an owner host**: `deploy/afldb-settle-failure-status.sh` over an SSH key restricted to that one command | one `authorized_keys` line on production; one script in the serving checkout; an hourly job on the owner host that alerts on non-zero or on ssh failure | a failed run (unit `Result`), a stopped or silent nightly timer (no trigger within 36 h), an unreadable unit, **and a dead host** (the pull itself fails). Needs no change to any production unit | latency up to the polling period; the owner host and its job are a single point (add a second channel); the key is one more credential on production (read-only effect) |
| B | Optional push unit `afldb-settle-failure-transport@.service` (sealed notifier unchanged; this unit may open a network connection and nothing else) | install the template, an owner-written transport executable, a drop-in naming it, and the `OnSuccess=` drop-in on the notifier (§6) | a failed run, at the time it fails | not exercised under systemd; transport needs outbound egress (production's egress policy unread); a host that is down sends nothing; a credential for the channel must live on production (`LoadCredential=`, root-owned 0600) |
| C | Dead-man ping to a hosted check (for example a health-check service) from the success path | needs a change to the settle wrapper (`deploy/afldb-settle-afl-api.sh` is another scope's file) and a third party | silence, including a dead host | a vendor; a change to the nightly path; not prepared |
| D | DigitalOcean control-panel alerting | owner configuration in the panel | host metrics only (CPU, disk, memory, droplet down) if the panel offers it | cannot see a failed unit; availability unverified |
| E | Manual check each round (operating record §3: the owner looks) | none | nothing unless someone looks | human-dependent; this is the current state |
| F | Use the application's SMTP relay | give a sender credential to a unit | a failed run | adds a mail credential to the nightly path or a unit beside it; contradicts ISSUE-232's design; not recommended |

**Recommendation.** Amend D-332-1 to: (1) adopt **A** (no unit change on production, effective immediately, catches a dead
host and a stalled timer, which no push notifier can); (2) install the notifier template and drop-in **only if** the owner
also wants the local marker and the `systemctl --failed`-style record (it helps diagnosis; it is not needed for detection);
(3) adopt **B** only if the owner wants push in addition. This replaces "install the notifier, then choose a transport" as the
default: that order delivers nothing until a transport exists, and the transport cannot live inside the notifier.

## 3. Prerequisites

- The serving checkout holds `deploy/afldb-settle-failure-status.sh` (and for B/notifier the other files). The checkout on
  2026-11-14 is `c1c4b22e` and holds **none** of them (`raw/prod-ro-ops-procedures.txt`): release B1, then update the checkout
  as the release procedure does, or place the single script and verify its sha256 against `git show <R>:deploy/...`.
- An owner host that stays up and has an outbound channel of its own (mail, chat webhook, push service); this repository does not
  choose it. The existing owner host in these runs is `streamanator`, but it is a DEV host with its own maintenance: choose
  deliberately.
- **Roles.** Installing the status script and the restricted key needs only `arm` (the file is arm-owned; `authorized_keys` is
  `arm`'s own). Installing the notifier or transport units needs the owner with `sudo`. `arm` alone **cannot** install a
  unit, read the journal, or read root-only files.

## 4. Option A: install and run

On the **owner host** (once): `ssh-keygen -t ed25519 -f ~/.ssh/afldb_settle_status -C afldb-settle-status -N ''` (the key is
not secret-equivalent to the full-shell key: it can run one read-only script; protect it as a credential anyway).

On **production** as `arm`, append one line to `~/.ssh/authorized_keys` (the script is not executable in the checkout, so the
command runs it through `sh`; `restrict` disables forwarding, pty and rc files; `sshd` already allows user `arm` only):

```
command="/bin/sh /home/arm/projects/afldb/deploy/afldb-settle-failure-status.sh",restrict ssh-ed25519 AAAA... afldb-settle-status
```

On the owner host, run hourly (cron or a user timer) a wrapper that treats any non-zero exit **and any ssh failure** as an alarm:

```
#!/bin/sh
out=$(timeout 60 ssh -o BatchMode=yes -o ConnectTimeout=20 -i ~/.ssh/afldb_settle_status arm@<production host> 2>&1); rc=$?
[ "$rc" -eq 0 ] && exit 0
printf '%s\n' "AFLDB settle check failed rc=$rc" "$out" | <the owner's channel>
```

Exit codes: 0 `OK`; 1 `FAILED` (latest run did not succeed, timer inactive, or no trigger within `AFLDB_SETTLE_MAX_TRIGGER_AGE_H`,
default 36 h); 2 `UNKNOWN` (a unit or property unreadable: an alarm, never OK); ssh exit 255 = host or key unreachable.
The Brownlow timer is disabled by design until its window opens (June 2027), so only its service `Result` is checked. A
similar second key can run the backup probe once ISSUE-352 is installed:
`command="env AFLDB_BACKUP_DIR=/home/arm/backups/afldb-scheduled /bin/bash /home/arm/projects/afldb/tools/maintenance/scheduled-backup.sh status",restrict ssh-ed25519 ...` (exit 1 = act).

**Validation.** Run the script by hand on production as `arm` (it reads `systemctl show` only): `raw/prod-status-check.txt` is
that run on 2026-11-14 (`AFLDB_SETTLE_STATUS OK`, exit 0, timer last fired 10 h before). Then force one known-bad condition on
the owner host side only: point the wrapper at a wrong host name and confirm the alarm arrives (this proves the channel, not the
script; the script's FAILED/UNKNOWN branches are pinned by tests in `tests/afl-api-ingestion-safety.test.ts`).
**Failure handling.** FAILED: follow the operator runbook in `rollover/README.md` §9 (marker, unit state, reason with the owner's
`sudo journalctl`, database view with `c7-observe.ts`; `HALT: season_row_missing` means the season is not open: procedure 01;
never start a manual settle). UNKNOWN: a unit disappeared or systemd answered nothing: investigate before trusting any green.
**Recovery.** Delete the `authorized_keys` line; the script is read-only and stateless.

## 5. Notifier template and drop-in (marker, optional)

```
sudo install -m 644 -o root -g root deploy/afldb-settle-failure@.service /etc/systemd/system/afldb-settle-failure@.service
sudo install -d -m 755 /etc/systemd/system/afldb-settle-afl-api.service.d
sudo install -m 644 -o root -g root deploy/afldb-settle-afl-api.service.d/on-failure.conf /etc/systemd/system/afldb-settle-afl-api.service.d/on-failure.conf
sudo systemctl daemon-reload
```

Order matters (template first). Changes no schedule, enables nothing, runs nothing until a failure. Validate: `systemd-analyze verify`
on both files (done on systemd 255 in the rollover evidence); then, attended, `sudo systemctl start
'afldb-settle-failure@afldb-settle-afl-api.service.service'` writes a marker (its `result=` line reflects the unit's current
state, so it will say `success`: this is a **test marker**; delete it with `sudo rm /var/lib/afldb-settle-failure/afldb-settle-afl-api.failed`
and note that option A ignores markers by design). Recovery: remove the drop-in and `daemon-reload`.

## 6. Option B: the optional transport unit

Files (all prepared): `deploy/afldb-settle-failure-transport@.service`, `deploy/afldb-settle-failure-transport.sh`,
`deploy/afldb-settle-failure@.service.d/transport.conf.example`. The exact owner steps are the header of `transport.conf.example`.
The unit hides `/home` except the read-only `deploy/` directory, sees the marker directory read-only, holds no credential of its
own, and differs from the notifier only by allowing `AF_INET`/`AF_INET6`. A secret for the channel (for example a ping URL) is
a root-owned `0600` file handed over with `LoadCredential=` in the owner's drop-in and read by the transport from
`$CREDENTIALS_DIRECTORY`; it never enters the repository. `OnSuccess=` on the notifier starts it only after the marker is written.
Validation: `systemd-analyze verify` is clean (`raw/verify-units.txt`); the scripts' behaviour is pinned by tests; **the unit was not
run under systemd, the network path was not exercised, and production's egress policy was not read.** If name resolution fails
inside the sandbox, add `AF_NETLINK` to `RestrictAddressFamilies` in the owner's drop-in (glibc may query netlink); `MemoryDenyWriteExecute=true`
suits `curl` and `sh`, not a Node transport.

## 7. Unverified

- That systemd honours `OnSuccess=` from the drop-in on the instance with the `%i` it expands to (the verify step accepts it; no run).
- Production egress, DNS inside the sandbox, any DigitalOcean panel alert policy, sudoers, the journal contents.
- That an `OnFailure=` unit starts when this particular oneshot fails by non-zero exit (standard systemd behaviour; not rehearsed under
  systemd here; the rollover evidence verified the units statically only).

## 8. What the pull check cannot see (review REVIEW-C LOW-5, LOW-9; added by the orchestrator)

- **A reboot erases the failure.** `Result` is systemd runtime state: a failed nightly followed by a reboot (procedure 03) reads
  `success` again and the check answers OK. Run the check, and act on a FAILED, **before** any reboot, and record its output.
- **"Nothing was settled" reads OK.** The settle wrapper exits 0 on `AMBIGUOUS:0` (no in-progress season in `seasons.json`,
  `deploy/afldb-settle-afl-api.sh`), so outside a season, and before 2027 is opened, every night is OK. Season opening and the
  first clean nightly are proved by procedure 01 (gate G0 / proposed G0c), not by this check. The `season_row_missing` HALT is
  visible: it exits 1, the unit fails, the check answers FAILED.
- **After a reboot, last-trigger age.** The nightly timer is `Persistent=true` in the repository (`deploy/afldb-settle-afl-api.timer:21`), so
  its last-trigger stamp survives a reboot. The installed timer's setting was not compared here; if it is not persistent, the check
  answers UNKNOWN (exit 2) until the next firing. UNKNOWN means look, not failed.
- **Transport unit (option B), first use:** `ProtectHome=tmpfs` hides a transport placed under `/home` outside `deploy/` (the example
  uses `/usr/local/sbin`). `RestrictAddressFamilies` omits `AF_NETLINK`, which some resolvers and HTTP clients open. Both fail visibly:
  exit 4, or the unit appears in `systemctl --failed`. On first use, run one deliberate test delivery and confirm it **arrived**. A log
  line on the host does not count as delivery.
