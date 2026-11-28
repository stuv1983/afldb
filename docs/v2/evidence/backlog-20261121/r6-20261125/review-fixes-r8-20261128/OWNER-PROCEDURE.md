# OWNER-PROCEDURE: an independent root path for production (R6 r8, 28 Nov 2026)

**Status: PREPARED, NOT RUN.** Claude never contacted production (209.38.87.252, alias `afldb`) and did not change any account on
streamanator. The procedure was rehearsed only in a disposable container on streamanator (`procedure-harness/`, §9). It closes
independent review round 1 **F1** (HIGH) only when the owner has carried out Phases 0 to 4 and Phase 2 prints
`OWNER CHECKS RESULT PASS` after Phase 4. Until then F1 stays OPEN, and G1 and G2 do not hold against a hostile arm.

The owner's design decision, which this procedure implements:

* Privileged installation, maintenance and recovery use an independently authenticated admin path. An existing independent console
  is preferred. Otherwise there is a separate admin account with its own key.
* The dedicated backup producer (`afldb-backup`) and the owner verifier (`afldb-verify`) stay as designed in r7.
* The guarantees are unchanged:
  * **G1**: the identified timer invocation produced the accepted dump.
  * **G2**: the owner receives an authentic gate verdict.
* An in-window timer catch-up is acceptable when it is labelled.

This procedure **supersedes every instruction that reaches root through arm**. That covers:

* `sudo` in an arm SSH session, and `ssh afldb … sudo`;
* a console login as arm, or `su` / `sudo` typed in it;
* "as arm in a new login";
* staging from, running from, or reading digests from `/home/arm`.

These instructions appear in r7 README §5, backup README §5/§6, verify README §8/§10, the R6 plan's r7 note and plan steps, and
release RUNBOOK §4.1a/§4.2. Each now points here.

## 0. Rules for every step

**Where a command runs.** Every command below carries one of these labels:

| Label | Session | How it is reached | What it may do |
|---|---|---|---|
| **[WS]** | The owner's workstation, Git Bash, in the owner's own clone | local | Compute and read every expected digest and fingerprint; build the bundle bytes with `git archive` |
| **[CON]** | The provider console, logged in **as root at the `login:` prompt** | DigitalOcean Recovery Console (Phase 0) | Phase 0 and Phase 1; the Phase 4 back-out |
| **[ADM]** | The admin account's own SSH session | `ADM` (defined in Phase 1), admin key only | Receive bytes; start the root shell below |
| **[ADM-ROOT]** | The admin root session: `sudo -k; sudo /usr/bin/bash --noprofile --norc` typed in [ADM], with the admin's password | from [ADM] | Every privileged step: staging, installs, `runuser -u postgres`, pg_hba/pg_ident edits and reloads, systemd, grub, journal reads, rollback |
| **[ARM]** | arm's SSH session (`ssh afldb`) | arm's key | **Only** unprivileged, pinned scripts and data transfer. Never `sudo`, `su` or `pkexec`, and never type any password. Never treat its output as evidence about root |

A console login **as arm** does not qualify as [CON], whether or not `sudo` or `su` is typed after it. arm's `.bashrc` or `.profile`
can define `sudo`, `su`, `id` or `uname` as functions, so anything typed into a shell that arm's startup files prepared can be
captured or faked. Debian bash also reads `.bashrc` for `ssh host cmd`. The only safe first input is the `login:` prompt of `getty`,
which arm cannot replace without root.

**Never in any session:**

* run, source, install from or read a digest from `/home/arm` (in particular the checkout `/home/arm/projects/afldb` and its `.env`);
* run `git` as root in arm's repository;
* read an expected digest from a file on production.

Expected values are computed on [WS] and compared **by eye** with what [ADM-ROOT] prints.

**Secrets.** Type the admin's password only at a `passwd` or `sudo` prompt in [CON] or [ADM]. Never put it on a command line, in a
file, in a log or in evidence.

**Connections.** The owner's home firewall IPS blocks bursts of SSH connections, so keep connections few:

* reuse one interactive [ADM] session for a whole phase;
* wait at least a minute between new connections;
* if a connection is refused or times out, wait 10 minutes and do not retry in a loop.

**Pins** that agent B's r8 edits change. They are filled when the coordinator commits:

| Placeholder | What it pins | Expected `[WS]` command |
|---|---|---|
| `<R8-PIN:tested-rev>` | the revision whose bytes are installed | `git rev-parse <R8-PIN:tested-rev>^{commit}` |
| `d1c11c25a35ba16aed0729617ea514078ece390e85b1b73a4eebe85cb2ad1682` | `$R7/backup/SHA256SUMS` | `git show <R8-PIN:tested-rev>:$R7/backup/SHA256SUMS \| sha256sum` |
| `3de9911cd8a71efb88e06ea3fbf2d471aee16cf9fa275106740efe24677ab6cd` | `$R7/verify/SHA256SUMS` | `git show <R8-PIN:tested-rev>:$R7/verify/SHA256SUMS \| sha256sum` |
| `d81525b6a7037e4a6ad59de010f4e12589f07aad44e63fd55ad5bcddb5032ef7` | `$R8/owner-checks/SHA256SUMS` | `git show <R8-PIN:tested-rev>:$R8/owner-checks/SHA256SUMS \| sha256sum` |
| `28a23c64033d8cefc1b393d3edca5f797d374280c8832aba3a51d1ac202ccc0e` | the wrapper's pinned `BUNDLE_SHA` (verify README §1) | `grep '^BUNDLE_SHA=' $R7/verify/afldb-verify-call.sh` at the tested revision |

Paths used below:

* `R7=docs/v2/evidence/backlog-20261121/r6-20261125/review-fixes-r7-20261128`
* `R8=docs/v2/evidence/backlog-20261121/r6-20261125/review-fixes-r8-20261128`

**Historical gates are unchanged.** A-2 is dated 2026-11-25, g0 accepts 2026-11-24..29, and the P4 cutoff was 24 Nov 11:30. The
owner's "before P4" ruling remains unresolved.

**What this cannot prove.** arm's sudo password has historically been typed in arm sessions. If any of those sessions was hostile,
arm may already have had root, and root can leave persistence that no read-only check finds. The checks close every route they know
of; they do not prove the host was never compromised. Only a rebuild from known-good media would. The owner accepts this residual
explicitly at Phase 4.

## Phase 0. An independent console (provider console, as root)

| # | Where | Command | Proves | Stop condition |
|---|---|---|---|---|
| 0.1 | DigitalOcean control panel | Droplet → Access → Launch Recovery Console | a provider path that does not pass through arm's account | none |
| 0.2 | [CON] | at `login:` type `root`, then root's password | a root login no arm file prepared | root is locked or has no password, which is **likely**: the plan records "root is locked on the cloud image". If no root login is possible: **STOP. F1 stays OPEN**, and Phases 1–4 do not start |
| 0.3 | [CON] | `id; cat /proc/self/loginuid; tty` | `uid=0(root)`, loginuid `0`, a console tty (`tty1`/`ttyS0`) | anything else: STOP |
| 0.4 | [CON] | `ssh-keygen -lf /etc/ssh/ssh_host_ed25519_key.pub` | production's host key fingerprint, read independently of every SSH session; write it down | none |

Whether the Recovery Console can log in as root is **UNKNOWN**. If it cannot, the provider-side options below are owner decisions.
Claude has not verified any of them. Each needs a window and, for the first two, a reboot or outage (the Wednesday reboot is NO-GO
today):

* **(i) "Reset root password"** (Access tab). This power-cycles the droplet and delivers a new root password out of band. Change it
  at once in [CON] with `passwd`.
* **(ii) The Recovery ISO.** Boot it, mount the disk, `chroot`, and set root's password. This is a full outage.
* **(iii) The Droplet Console** (agent-based web console). It qualifies only if it logs in as **root** directly; whether it can
  depends on the droplet agent and sshd's `PermitRootLogin`, both **UNKNOWN**.

The console is slow to type into and has no paste, so the long values below (keys, digests) never have to be typed into it. They
travel as data, and the console only compares fingerprints.

## Phase 1. The separate admin account `afldb-admin` (from the console)

| # | Where | Command | Proves | Stop condition |
|---|---|---|---|---|
| 1.1 | [WS] | `ssh-keygen -t ed25519 -f ~/.ssh/afldb_admin -C afldb-admin` (set a passphrase) | a new key used for nothing else: not arm's key, not `~/.ssh/afldb_verify` | none |
| 1.2 | [WS] | `ssh-keygen -lf ~/.ssh/afldb_admin.pub` | the fingerprint `SHA256:…`; write it on paper | none |
| 1.3 | [WS]→[ARM] | `ssh afldb 'umask 077; cat > ~/afldb_admin.pub' < ~/.ssh/afldb_admin.pub` | arm carries the **public** key as data only, which is safe because it is checked in 1.5 | none |
| 1.4 | [CON] | `install -d -m 0700 /root/afldb-r8-keyin` then `setpriv --reuid=arm --regid=arm --init-groups --reset-env /usr/bin/cat /home/arm/afldb_admin.pub < /dev/null > /root/afldb-r8-keyin/afldb_admin.pub` | root takes a copy with arm's rights; it does not follow anything arm could link | none |
| 1.5 | [CON] | `ssh-keygen -lf /root/afldb-r8-keyin/afldb_admin.pub; grep -c . /root/afldb-r8-keyin/afldb_admin.pub; awk '{print $1}' /root/afldb-r8-keyin/afldb_admin.pub` | exactly `1` line, type `ssh-ed25519` with no options prefix, `(ED25519)`, and **the same fingerprint as the paper** | any difference: **STOP**. arm substituted a key (rehearsed: scenario `pubkey-swap`). Create nothing |
| 1.6 | [CON] | `useradd -m -U -s /bin/bash afldb-admin` | an account with its own primary group | `useradd` error: STOP |
| 1.7 | [CON] | `passwd afldb-admin` | the admin's own sudo password, typed twice at the prompt and nowhere else | none |
| 1.8 | [CON] | `usermod -a -G sudo afldb-admin; chmod 0750 /home/afldb-admin` | full sudo **with that password**; arm cannot enter the home | none |
| 1.9 | [CON] | `install -d -o afldb-admin -g afldb-admin -m 0700 /home/afldb-admin/.ssh` then `install -o afldb-admin -g afldb-admin -m 0600 /root/afldb-r8-keyin/afldb_admin.pub /home/afldb-admin/.ssh/authorized_keys` | the admin key alone authorises the account | none |
| 1.10 | [CON] | `id afldb-admin; stat -c '%U:%G %a %n' /home/afldb-admin /home/afldb-admin/.ssh /home/afldb-admin/.ssh/authorized_keys; ssh-keygen -lf /home/afldb-admin/.ssh/authorized_keys; sshd -T -C user=afldb-admin,host=x,addr=127.0.0.1 \| grep -E '^(allowusers\|allowgroups\|denyusers\|denygroups\|pubkeyauthentication\|forcecommand)'` | the expected values are listed below the table | arm in any of the admin's groups, or `AllowUsers` excluding afldb-admin: fix it in [CON] before 1.11 |
| 1.11 | [WS] | define `ADM` (below), then `ADM` (a **new** connection; **keep the console open**) | the admin path works with the admin key alone, against the pinned host key | host key prompt or mismatch: STOP. Permission denied: fix in [CON] |
| 1.12 | [ADM] | `id; sudo -k; sudo -v; sudo -l` | `id` shows afldb-admin and `sudo`; `sudo -v` takes **the admin's** password; `sudo -l` shows `(ALL : ALL) ALL` | any difference: fix in [CON] |
| 1.13 | [ADM] | `exit`; wait; repeat 1.11–1.12 in a second new connection | Phase 1 has been verified **twice**, which Phase 4 needs | none |

Expected values for 1.10:

* `id afldb-admin` shows uid ≥1000 and groups `afldb-admin` and `sudo` only;
* the home is `afldb-admin:afldb-admin 750`, `.ssh` is `700` and `authorized_keys` is `600`;
* `authorized_keys` carries the paper fingerprint;
* `sshd -T` prints `pubkeyauthentication yes` and `forcecommand none`, and no `allowusers` / `allowgroups` line excludes afldb-admin.

`ADM`, defined on [WS] in Git Bash. `HostKeyAlias` is the name under which `~/.ssh/known_hosts` already holds production's key: run
`ssh-keygen -F 209.38.87.252` and `ssh-keygen -F afldb`, and use whichever is found. Its `ssh-keygen -lF <name>` fingerprint must
equal the one read in 0.4. If it does not, STOP.

```
ADM() { C:/Windows/System32/OpenSSH/ssh.exe -F none -o IdentitiesOnly=yes -o IdentityAgent=none -o IdentityFile=~/.ssh/afldb_admin \
  -o StrictHostKeyChecking=yes -o HostKeyAlias=<name> -o PasswordAuthentication=no -o KbdInteractiveAuthentication=no \
  afldb-admin@209.38.87.252 "$@"; }
```

**The admin root session [ADM-ROOT].** In [ADM], run `sudo -k; sudo /usr/bin/bash --noprofile --norc` and type the admin's
password. Then run `export PATH=/usr/sbin:/usr/bin LC_ALL=C; umask 022; cd /`. Every [ADM-ROOT] step below runs in such a session.

What Phase 1 proves: a root session exists whose ancestry contains no arm process and no arm login. Check A2 confirms this in
Phase 2. Its authentication uses a key and a password arm never held.

## Phase 2. Read-only owner checks (before any change; repeated after Phase 3 and Phase 4)

### 2.1 Bytes: from the workstation clone only

| # | Where | Command | Proves | Stop condition |
|---|---|---|---|---|
| 2.1.1 | [WS] | `git fetch; git rev-parse <R8-PIN:tested-rev>^{commit}` | the pinned revision is present in the owner's own clone | unknown revision: STOP |
| 2.1.2 | [WS] | `git archive --format=tar -o ~/afldb-r8-stage.tar <R8-PIN:tested-rev> $R7/backup $R7/verify $R8/owner-checks tools/maintenance/backup.sh` | the only acceptable source of bundle bytes | none |
| 2.1.3 | [WS] | `sha256sum ~/afldb-r8-stage.tar`, plus the three `git show … \| sha256sum` commands of §0 | the TAR value is written down; the three SHA256SUMS values equal the pins | any pin differs: STOP |
| 2.1.4 | [WS]→[ADM] | `ADM 'umask 077; set -C; cat > ~/afldb-r8-stage.tar' < ~/afldb-r8-stage.tar` | the bytes travel over the admin path, never through arm | `set -C` refusal (a file already there): remove it in [ADM-ROOT] and resend |
| 2.1.5 | [ADM-ROOT] | `T=/home/afldb-admin/afldb-r8-stage.tar; stat -c '%U %a %s' $T; sha256sum $T` | owner `afldb-admin 600`, and **the TAR value of 2.1.3** (compared by eye) | different: STOP |
| 2.1.6 | [ADM-ROOT] | `X=/root/afldb-r8-extract; rm -rf $X; install -d -m 0700 $X; tar -x --no-same-owner --no-same-permissions -f $T -C $X; chown -R root:root $X; chmod -R go-w $X` | root-owned extracted bytes, outside `/home` | tar error: STOP |
| 2.1.7 | [ADM-ROOT] | `OC=/root/afldb-r8-owner-checks; install -d -m 0755 $OC; install -m 0644 $X/$R8/owner-checks/afldb-owner-checks.sh $X/$R8/owner-checks/SHA256SUMS $OC/; sha256sum $OC/SHA256SUMS; (cd $OC && sha256sum -c --strict SHA256SUMS)` | `d81525b6a7037e4a6ad59de010f4e12589f07aad44e63fd55ad5bcddb5032ef7` and `OK` | different: STOP |

### 2.2 Run

[ADM-ROOT], or [CON] as root:

```
env -i PATH=/usr/sbin:/usr/bin LC_ALL=C /usr/bin/bash --noprofile --norc /root/afldb-r8-owner-checks/afldb-owner-checks.sh \
  --admin afldb-admin --admin-fp SHA256:<the paper fingerprint> [--accept /root/afldb-r8-accept.txt]
```

The script is read-only. It writes nothing but stdout, starts nothing, changes no account, and only SELECTs, as OS user `postgres`
by peer. It prints one line per check, `CHECK <id> PASS|FAIL|UNKNOWN <fact>`, then `OWNER CHECKS RESULT PASS` (exit 0) or
`OWNER CHECKS RESULT BLOCKED fail=… unknown=…` (exit 1). It never prints a secret: no DSN, password, hash or key material, and from
`.env` only variable and role names. Facts it reads "as arm" are read through
`setpriv --reuid=arm --regid=arm --init-groups --reset-env /usr/bin/bash --noprofile --norc`, with stdin `/dev/null`. That gives
arm's rights, without arm's login, startup files or environment.

**Expected results:**

* **Before Phase 4:** `BLOCKED`, with at least B1 and B2 failing (arm can sudo). That is the state rehearsed as `checks-pre` and
  `checks-post-install`.
* **After Phase 4:** `PASS`.
* **Any other FAIL or UNKNOWN** has to be resolved, or accepted by the owner in writing, before Phase 4. An UNKNOWN is never read as
  PASS. E3 entries can be accepted only through `--accept`: a root-owned file listing one absolute path per line, each a path the
  owner reviewed and accepts as never executed, sourced or installed by root.

### 2.3 Every check: command, expected result, what stays blocked

All checks run from the single command in 2.2. "Blocks" says what stays blocked while the check is not PASS:

* **G1/G2**: the guarantee cannot be claimed against a hostile arm;
* **install**: Phase 3 must not start;
* **sudo removal**: Phase 4 must not start.

| Id | What it establishes (and how) | Expected | Blocks if not PASS |
|---|---|---|---|
| A1 | the checks run as root (`id -u`) | PASS | everything |
| A0 | an account `arm` exists (`getent passwd arm`) | PASS | everything (the checks are written for production's arm) |
| A2 | **(a)** no ancestor of this process has real or effective uid arm, loginuid arm, or `SUDO_USER`/`SUDO_UID` = arm (`/proc/<pid>/status`, `loginuid`, `environ` walked to PID 1) | PASS | **everything**. The session descends from arm, so no result is independent and the result line adds "(session not independent …)". Go back to [CON] or [ADM-ROOT]. Rehearsed: `arm-sudo-checks` |
| A3 | `SUDO_USER` of this process is not arm | PASS | everything |
| B1 | **(b)** arm's effective sudo, `sudo -n -l -U arm` as root | before Phase 4 **FAIL** (arm may run commands); after **PASS** ("not allowed") | G1/G2 until Phase 4 |
| B2 | arm is in group `sudo`, `admin` or `wheel` (`id -nG arm`) | before FAIL, after PASS | G1/G2 until Phase 4 |
| B3 | no sudoers file or include target names arm, `%arm` or a group of arm (`/etc/sudoers`, `/etc/sudoers.d/*`, `@include`/`#includedir` targets) | PASS | G1/G2 and sudo removal. Production sudoers is **UNKNOWN**: a rule naming arm directly survives `gpasswd` |
| B4 | report: sudo's `timestamp_type` and timeout (`sudo -V`) | report | nothing. Production's value is **UNKNOWN** and recorded |
| B5 | every sudoers file and include target is root-owned, not group/other-writable, and no symlink | PASS | G1/G2, sudo removal |
| B6 | `passwd -S` of root, arm and the admin; none is `NP` (no password) | PASS (report L/P) | G1/G2 if arm or root is `NP` |
| C1 | **(c)** arm is not in `docker`, `lxd`, `incus`, `libvirt`, `disk` or `shadow` (root-equivalent or secret-reading groups); `adm` and `systemd-journal` are reported (read only) | PASS | G1/G2, and sudo removal is not sufficient on its own |
| C1s | report: the docker/lxd/containerd sockets and their owners and modes | report | nothing |
| C2 | the only polkit rule mentioning arm is the known settle rule: `50-afldb-settle-afltables.rules`, sha256 `3164e0d9…c50b64` = `deploy/afldb-settle-afltables-trigger.rules` (start of `afldb-settle-afltables.service` only) | PASS | G1/G2 |
| C2b | no `.pkla` (legacy polkit) entry names arm | PASS | G1/G2 |
| C3 | no unit that root runs (`User=` root or unset, or any `+`/`!` Exec prefix) executes, sources or reads an `EnvironmentFile=` from an arm-writable path; checked with `systemctl show` `Exec*`/`User`/`EnvironmentFiles`. User=arm units are reported, not failed | PASS | G1/G2 |
| C4 | no root cron entry (`/etc/crontab`, `/etc/cron.d`, root's spool, `cron.{hourly,daily,weekly,monthly}`) references an arm-writable path | PASS | G1/G2 |
| C5 | root's startup files (`/root/.bashrc`, `.profile`, `.bash_profile`, `.ssh/rc`, `/etc/profile*`, `/etc/bash.bashrc`) are trusted paths | PASS | G1/G2 (they run in every [ADM-ROOT] `sudo -i`; this procedure avoids `-i`, but they also run in [CON]) |
| C6 | report: fingerprints only of `/root/.ssh/authorized_keys`; FAIL if one equals one of arm's keys | PASS | G1/G2 |
| C7 | report: `kernel.yama.ptrace_scope` | report (production **UNKNOWN**) | nothing. At 0 arm can ptrace arm's own processes, which is one more reason never to type anything in [ARM] |
| C8 | report: sshd's effective `permitrootlogin`, `passwordauthentication`, `pubkeyauthentication`, `permituserrc`, `permituserenvironment`, and the first directive of `sshd_config` | report | **install** of the verifier needs `Include /etc/ssh/sshd_config.d/*.conf` as the first directive (production **UNKNOWN**) |
| C9 | `/etc/ld.so.preload` absent | PASS | G1/G2 |
| D0 | **(d)** PostgreSQL reachable as OS user `postgres` by peer (`runuser -u postgres -- psql -X`, no DSN) | PASS | D1–D5 cannot be established, so G1/G2 stay blocked |
| D1 | no login role other than `postgres` has `rolsuper`; `rolcreaterole`, `rolreplication` and `rolbypassrls` are reported per role | PASS | **G1/G2 and install**. A superuser can `COPY … TO PROGRAM` as OS user postgres, which owns the pg conf files. Production: **UNKNOWN** (r7 §4 item 17). Rehearsed: `fc-pg-superuser` |
| D2 | no login role is a member of `pg_execute_server_program` or `pg_write_server_files`; `pg_read_server_files` members are reported | PASS | G1/G2, install |
| D3 | report: the owner of `afldb_prod` | report | nothing |
| D4 | the role named by each DSN in arm's `.env`, **read as arm**, with only the user part extracted (variable and role names printed; `TEST` DSNs skipped) is not superuser and is not in a server-program/file role | PASS | G1/G2, install. UNKNOWN if the file is absent or unreadable by arm (then establish arm's role another way) |
| D5 | `pg_hba` has no `trust` line, and `pg_ident` maps neither arm nor a regex to `postgres`, `all`, `afldb_backup` or `afldb_verify`; include directives are reported as UNKNOWN | PASS | G1 (`afldb_backup`), G2 (`afldb_verify`) |
| E0 | **(e)** a fresh arm process cannot run `sudo -n true` | PASS | G1/G2 |
| E1 | as arm (`setpriv … -c '[ -w … ]'`), no component of any protected path is writable. The protected paths are the staging copies; `/usr/local/lib/afldb-backup`, `/usr/local/lib/afldb-verify` and their contents; `/var/lib/afldb-backup/*`; `/etc/systemd/system/afldb-backup.service.d`; `/etc/ssh/sshd_config.d`; `/etc/ssh/afldb-verify`; `/etc/postgresql/16/main/pg_{hba,ident}.conf`; `/etc/sudoers{,.d}`; polkit; `/etc/passwd`, `/etc/shadow`, pam, profile; `/root`; the bash, sudo and sshd binaries; the admin's home, `.ssh`, `authorized_keys` and startup files | PASS (absent paths are reported, not failed, so the check works before installation) | G1/G2, install |
| E2 | as root, every component of those paths from `/` is not arm-owned, not group/other-writable, has no named ACL entry (`getfacl`) and is no symlink | PASS | G1/G2, install. Rehearsed: `fc-group-writable` |
| E3 | outside `/home`, `/tmp`, `/var/tmp`, `/proc`, `/sys`, `/dev`, `/run/user`: no arm-owned, arm-group-writable or world-writable file, and no non-sticky world-writable directory, except known entries (arm's cron spool, mail) and `--accept` entries | PASS; otherwise UNKNOWN with the first 25 paths | G1/G2 until each path is reviewed and accepted or fixed |
| E3a | the `--accept` file itself is a trusted root-owned file | PASS (only when `--accept` is given) | G1/G2 |
| F1 | the admin account exists | PASS | **install, sudo removal**. Rehearsed: `fc-no-admin` |
| F2 | arm is not in the admin's primary group | PASS | install, sudo removal |
| F3 | the admin has `(ALL) ALL` **without** `NOPASSWD` | PASS | install, sudo removal |
| F4 | the admin has a usable password (`passwd -S` = `P`) | PASS | install, sudo removal |
| F5 | the admin's `AuthorizedKeysFile` (`sshd -T -C user=…`) keys are in trusted files owned by the admin or root, the home and startup files are trusted, no key is one of arm's, and the key set equals `--admin-fp` | PASS | install, sudo removal |
| F6 | sshd allows the admin public-key login with no forced command | PASS | install, sudo removal |

Production facts that are **UNKNOWN** today and are only recorded by these checks:

* the sudoers content and `timestamp_type` (B3, B4);
* `ptrace_scope` (C7);
* whether root can log in at the console (Phase 0);
* whether arm's PostgreSQL roles are superusers (D1, D4);
* the position of the sshd `Include` (C8);
* `python3.12`, `systemd-journal` and `/usr/lib/postgresql/16/bin/psql` (checked by `install-verify.sh` itself);
* `AllowUsers` / `AllowGroups` (F6).

## Phase 3. Installs through the admin path (backup first, then verifier); then STOP

All steps are [ADM-ROOT] unless marked. The bytes are the extracted tar of 2.1.6, already verified against the workstation. The
installers refuse a root session that descends from arm: an ancestor with real or effective uid arm, `SUDO_USER`/`SUDO_UID` = arm,
or `/proc/self/loginuid` = arm's uid. They then print a line beginning `REFUSED: root session descends from arm` and change nothing.
The guard is agent B's (r8). It is a tripwire for the mistake of installing from arm's session, not proof of F1. The checks of
Phase 2 are that proof.

| # | Where | Command | Proves | Stop condition |
|---|---|---|---|---|
| 3.1 | [ADM-ROOT] | `BK=/root/afldb-r8-backup; rm -rf $BK; install -d -m 0755 $BK; for f in afldb-backup-run afldb-backup-seal 70-afldb-backup-sealed.conf sealed-origin.sh install-backup.sh verify-backup-install.sh SHA256SUMS; do install -m 0644 $X/$R7/backup/$f $BK/; done; install -m 0644 $X/tools/maintenance/backup.sh $BK/backup.sh` | the flat root-owned staging outside `/home` that `install-backup.sh` requires | none |
| 3.2 | [ADM-ROOT] | `sha256sum $BK/SHA256SUMS; (cd $BK && sha256sum -c --strict SHA256SUMS)` | `d1c11c25a35ba16aed0729617ea514078ece390e85b1b73a4eebe85cb2ad1682` and 7× `OK` | different: STOP |
| 3.3 | [ADM-ROOT] | backup README §5 prerequisites, then `bash $BK/install-backup.sh $BK` | the installer completes without `BACKUP INSTALL RESULT FAIL` (backup README §5 step 2) | `REFUSED: root session descends from arm`: you are not in [ADM-ROOT]. Any other failure: STOP, rollback per backup README §6 |
| 3.4 | [ADM-ROOT] | edit `/etc/postgresql/16/main/pg_ident.conf` (+ `afldbbackup afldb-backup afldb_backup`) and `pg_hba.conf` (+ `local afldb_prod afldb_backup peer map=afldbbackup` **before any broader `local` line**) with root's editor; then `runuser -u postgres -- psql -X -c 'SELECT pg_reload_conf()'` | the dedicated producer can log in by peer | reload not `t`: STOP |
| 3.5 | [ADM-ROOT] | `bash $BK/verify-backup-install.sh` | `BACKUP INSTALL RESULT PASS` (root checks) | FAIL: STOP |
| 3.6 | [ADM-ROOT] | `bash $BK/verify-backup-install.sh --as-arm` | `BACKUP INSTALL RESULT PASS` for arm's checks. Root drops to arm with `setpriv --reuid=arm --regid=arm --init-groups --reset-env`, `/usr/bin/bash --noprofile --norc` and stdin `/dev/null`, so the fresh process carries `afldb-backup-read` without any arm login | FAIL: STOP. (This replaces "as arm in a new login".) |
| 3.7 | [WS]→[ADM] | `ADM 'umask 077; set -C; cat > ~/afldb_verify.pub' < ~/.ssh/afldb_verify.pub`; on [WS] `ssh-keygen -lf ~/.ssh/afldb_verify.pub` (paper) | the verify public key travels over the admin path | none |
| 3.8 | [ADM-ROOT] | `VF=/root/afldb-r8-verify; rm -rf $VF; cp -r $X/$R7/verify $VF; install -m 0644 /home/afldb-admin/afldb_verify.pub $VF/afldb_verify.pub; chown -R root:root $VF; chmod -R go-w $VF; ssh-keygen -lf $VF/afldb_verify.pub; sha256sum $VF/SHA256SUMS; (cd $VF && sha256sum -c --strict --quiet SHA256SUMS)` | the paper fingerprint (one ed25519 line), `3de9911cd8a71efb88e06ea3fbf2d471aee16cf9fa275106740efe24677ab6cd`, no mismatch | different: STOP |
| 3.9 | [ADM-ROOT] | verify README §10 prerequisites, then `bash $VF/install-verify.sh --role prod --key $VF/afldb_verify.pub` | `INSTALL-VERIFY RESULT PASS`: the verifier account, forced command, facts socket and units are installed | `REFUSED …`: not [ADM-ROOT]. Other failure: STOP |
| 3.10 | [ADM-ROOT] | `runuser -u postgres -- psql -X -v ON_ERROR_STOP=1 -d afldb_prod < $VF/verifier-db.sql`; add the `pg-auth-lines.txt` lines (ident map; the hba line directly after the `afldb_backup` line, both before any broader `local`); `runuser -u postgres -- psql -X -c 'SELECT pg_reload_conf()'` | the verifier's read-only DB role and peer map | error: STOP |
| 3.11 | [ADM-ROOT] | `bash $VF/verify-verify-install.sh --role prod` | `VERIFY-INSTALL RESULT PASS` | FAIL: STOP |
| 3.12 | [ADM-ROOT] | the Phase 2 command again | still `BLOCKED` on B1/B2 (arm can sudo): the installs alone do not close F1 (rehearsed: `checks-post-install`) | any **new** FAIL: STOP |
| 3.13 | [WS] | in the owner's clone at `<R8-PIN:tested-rev>`: `grep '^BUNDLE_SHA=' $R7/verify/afldb-verify-call.sh` (= `28a23c64033d8cefc1b393d3edca5f797d374280c8832aba3a51d1ac202ccc0e`), then `bash $R7/verify/afldb-verify-call.sh version` | `OWNER VERDICT VERSION PASS` for production; the off-host line follows the streamanator variant (§8) | a production VERSION STOP: STOP |

**STOP.** The owner decides separately on Phase 4. Installs made while arm still has sudo are re-verified after Phase 4 (step 4.6).

## Phase 4 (proposed; owner approval required; not part of the install). Change existing access

Preconditions:

* Phase 1 verified twice (1.13).
* The [CON] root session open throughout.
* Every Phase 2 FAIL other than B1/B2 resolved, and every UNKNOWN resolved or accepted.
* The owner has accepted the residual of §0.
* Every routine that used `sudo` from arm has an [ADM-ROOT] replacement. In the repository, `deploy/release.mjs` and
  `deploy/post-install-check.sh` print `sudo systemctl restart afldb` and `sudo journalctl …` hints, and the RUNBOOK P6 restart and
  journal reads, the R6 plan's grub/systemd steps and `docs/deployment.md` all use `sudo`. They move to [ADM-ROOT]. The settle
  trigger uses polkit, not sudo, and is unaffected.

| # | Where | Command | Proves | Stop condition |
|---|---|---|---|---|
| 4.1 | [ADM-ROOT] | `gpasswd -d arm sudo` (and remove any sudoers rule naming arm that B3 reported, with `visudo -f`) | arm loses sudo | error: STOP |
| 4.2 | [ADM-ROOT] | `id arm; sudo -l -U arm` | no `sudo` group; "User arm is not allowed to run sudo" | otherwise: back to 4.1 |
| 4.3 | [ADM] | `exit` the admin session; from [WS] open a **new** `ADM`, run `sudo -k; sudo -v`, then enter [ADM-ROOT] | the admin path still reaches root after the change (rehearsed: `admin-login-2`) | fails: **back-out** (below) |
| 4.4 | [ADM-ROOT] | Phase 2 command | `OWNER CHECKS RESULT PASS` (rehearsed: `checks-post-access`) | BLOCKED: resolve; F1 stays open until PASS |
| 4.5 | [ADM-ROOT] | `bash $BK/verify-backup-install.sh; bash $BK/verify-backup-install.sh --as-arm; bash $VF/verify-verify-install.sh --role prod` | the installs made while arm still had sudo are intact (rehearsed: `reverify`) | FAIL: STOP; treat the install as untrusted and reinstall from 3.1 |
| 4.6 | [WS] | `bash $R7/verify/afldb-verify-call.sh version` | an authentic verdict path after the change | STOP: investigate in [ADM-ROOT] |
| 4.7 | [CON] | `exit` | the console is closed only after 4.3–4.6 | none |

**Back-out** (if 4.3 fails, the admin path is broken). In the still-open [CON] root session, run `gpasswd -a arm sudo`, which
restores the previous state exactly. Then repair the admin account in [CON] (Phase 1 steps 1.9–1.12) before trying Phase 4 again.
Never repair the admin account through arm's sudo, which would type a password into an arm session. If [CON] has been closed and the
admin path fails, the recovery is Phase 0 again.

After Phase 4 PASS, G1 and G2 hold against a hostile arm, subject to the §0 residual: arm can no longer reach root by any route the
checks know, and every root action uses [ADM-ROOT]. F1 can be closed on that evidence: the 4.4 and 4.5 output, saved on [WS].

## 8. streamanator variant (G0b handoff: off-host verifier install, pull-source change)

**Facts recorded during the rehearsal (REAL, 28 Nov 2026 03:0x UTC, `id` of streamanator's arm):** `uid=1000(arm) … groups=…
4(adm) … 27(sudo) … 101(lxd) 111(docker)`. Docker 29.1.3 is not rootless (security options `apparmor seccomp cgroupns`).
Membership of `docker` and `lxd` is root-equivalent, independent of sudo. **How the owner reaches root on streamanator is UNKNOWN**
(physical console, IPMI or another account).

Consequences:

* Whoever controls streamanator's arm controls streamanator's root, and so can forge `G0B PASS`, and with it the owner's G0
  statement that an authentic off-host copy exists. That includes every automated session that uses `~/.ssh/afldb_dev`, Claude's
  rehearsals among them.
* It cannot forge the dump bytes or production's verdict. G0B compares the copy's sha256 with the value production's g0 reports,
  and production's role is installed and judged independently (Phases 0–4 above).
* A compromise of **production's** arm does not reach streamanator: the pull runs from streamanator to production with
  streamanator's key `~/.ssh/afldb_backup_pull`, under a forced `rrsync -ro` on production.

| Phase | streamanator | What stays unproven |
|---|---|---|
| 0 | a root login at streamanator's own console (physical/IPMI) at the `login:` prompt; not `sudo` in an arm session | **UNKNOWN** whether available |
| 1 | the same as production: `afldb-admin` with its own key and password, created from that console | none, if done |
| 2 | the same command; expected **BLOCKED** on B1/B2 (sudo) **and C1 (`docker`, `lxd`)** | while C1 fails, G0B is not independent of streamanator's arm |
| 3 | [ADM-ROOT] on streamanator: stage `$R7/verify` from the same workstation tar; `install-verify.sh --role offhost --key …`; `verify-verify-install.sh --role offhost`. The pull-source change is an **unprivileged** edit of arm's own files with no root step: on production, arm's `authorized_keys` forced command `rrsync -ro /home/arm/backups/afldb-scheduled` becomes `rrsync -ro /var/lib/afldb-backup/published`; on streamanator, the pull source is `<prod>:/var/lib/afldb-backup/published/`. Status probes add `AFLDB_BACKUP_SEALED_STATE_DIR=/var/lib/afldb-backup/state` | G0B gives no assurance about the pull itself; that is by design, because G0B checks the copy |
| 4 | removing streamanator's arm from `sudo`, `docker` and `lxd` | **an owner decision with a cost**: it ends the DEV rehearsals that run as arm with docker, these harnesses included. Without it, `G0B PASS` is "attested by a host arm controls" and the owner's G0 must say so |

**What stays unproven until the owner decides:** the authenticity of `G0B PASS` against a hostile streamanator arm. The
alternatives are a separate off-host verifier host or account that has neither docker nor sudo, or accepting and labelling
G0B as arm-attested.

## 9. Rehearsal (`procedure-harness/`, development evidence)

`procedure-harness/r8p-run.sh` runs on the workstation and drives one disposable container on streamanator. The container's PID 1 is
the real systemd 255, from the pinned image `sha256:d71c0b28…` (Ubuntu 24.04), with PostgreSQL 16 `afldb_prod` as a fixture,
`--network none`, never `--privileged`, and no bind mount. The run:

* starts from production's shape today, arm with sudo [FIXTURE], and uses `docker exec` as root as the console stand-in [HARNESS];
* reaches the container's real sshd from the workstation's real Windows OpenSSH through a ProxyCommand [HARNESS transport];
* refuses a key arm substituted (Phase 1);
* creates the admin account, then checks two admin logins and that arm's key is refused for the admin;
* verifies the stage tar over the admin path against workstation digests;
* runs Phase 2 before the change (BLOCKED), and through arm's sudo (BLOCKED on A2);
* runs the installer through arm's sudo (REFUSED, nothing installed);
* runs both installs and both install checks (root and `--as-arm`), then the wrapper's `version` call;
* runs Phase 4, a second admin login, the reverify, and Phase 2 (PASS);
* runs three fail-closed cases (arm's PostgreSQL role made superuser, a group-writable protected directory, a missing admin path)
  and a control;
* scans every log for the fixture password, the admin and arm passwords, and private key blocks.

Results and residue: `procedure-harness/logs/<RID>-summary.log` (git-ignored by `logs/`; force-add to keep). Development runs at worktree bytes, 28 Nov 2026:

* `dev-a2` is `R8 PROCEDURE HARNESS RESULT PASS`: 25 scenarios PASS, with agent B's r8 guard and `--as-arm` present (backup `SHA256SUMS` `d1c11c25…`, verify `bf0e050e…`, owner checks `d81525b6…`). Residue afterwards: 0 containers, 0 images, 0 workspaces.
* `dev-a1` FAILED. B's bundle was mid-edit (`SHA256SUMS` mismatch, and the stage STOPped as designed), and check F6 misread sshd's `forcecommand none`. F6 is fixed. It is kept as history only.

Neither run is evidence for a committed revision. Re-run with `--verify-rev <R8-PIN:tested-rev>` after the commit.

The rehearsal does **not** exercise:

* the DigitalOcean console;
* production's sshd configuration, sudoers, host key or firewall;
* interactive `passwd` and `sudo` prompts (the harness feeds the admin password to `chpasswd` and `sudo -S` on stdin);
* the off-host verifier role (the wrapper's off-host line STOPs, as expected);
* a real nightly timer run.

## 10. Consolidated owner checklist

| Step | Exact command | Where | Proves | Stop condition |
|---|---|---|---|---|
| 0.1–0.3 | Recovery Console; `login: root`; `id; cat /proc/self/loginuid; tty` | [CON] | an independent root session | no root login: **STOP, F1 open** |
| 0.4 | `ssh-keygen -lf /etc/ssh/ssh_host_ed25519_key.pub` | [CON] | production host key, independently | none |
| 1.1–1.2 | `ssh-keygen -t ed25519 -f ~/.ssh/afldb_admin -C afldb-admin`; `ssh-keygen -lf ~/.ssh/afldb_admin.pub` | [WS] | a new admin key; its fingerprint on paper | none |
| 1.3 | `ssh afldb 'umask 077; cat > ~/afldb_admin.pub' < ~/.ssh/afldb_admin.pub` | [WS]→[ARM] | data only | none |
| 1.4–1.5 | `setpriv --reuid=arm --regid=arm --init-groups --reset-env /usr/bin/cat /home/arm/afldb_admin.pub < /dev/null > /root/afldb-r8-keyin/afldb_admin.pub`; `ssh-keygen -lf …` | [CON] | the carried key is the workstation's | fingerprint differs: **STOP** |
| 1.6–1.10 | `useradd -m -U -s /bin/bash afldb-admin`; `passwd afldb-admin`; `usermod -a -G sudo afldb-admin`; `chmod 0750 /home/afldb-admin`; `install …authorized_keys`; checks | [CON] | the admin account with its own key and password | any unexpected value |
| 1.11–1.13 | `ADM`; `id; sudo -k; sudo -v; sudo -l`; twice, in new connections | [WS], [ADM] | the admin path reaches root, twice | host key mismatch or failure |
| 2.1.1–2.1.3 | `git rev-parse <R8-PIN:tested-rev>^{commit}`; `git archive … -o ~/afldb-r8-stage.tar`; `sha256sum` | [WS] | workstation bytes and expected digests | a pin differs |
| 2.1.4 | `ADM 'umask 077; set -C; cat > ~/afldb-r8-stage.tar' < ~/afldb-r8-stage.tar` | [WS]→[ADM] | bytes over the admin path | none |
| 2.1.5–2.1.7 | `sha256sum $T`; extract; stage owner checks; `sha256sum -c` | [ADM-ROOT] | the same bytes on production | TAR or pin differs |
| 2.2 | `env -i … afldb-owner-checks.sh --admin afldb-admin --admin-fp SHA256:…` | [ADM-ROOT] | the Phase 2 facts | expected BLOCKED (B1, B2) only; any other FAIL/UNKNOWN: resolve |
| 3.1–3.6 | stage `$BK`; `sha256sum -c`; `install-backup.sh $BK`; pg lines; reload; `verify-backup-install.sh`; `verify-backup-install.sh --as-arm` | [ADM-ROOT] | sealed backup installed and checked | FAIL or `REFUSED` |
| 3.7–3.11 | verify key over [ADM]; stage `$VF`; `install-verify.sh --role prod --key …`; `verifier-db.sql`; pg lines; `verify-verify-install.sh --role prod` | [ADM-ROOT] | verifier installed and checked | FAIL or `REFUSED` |
| 3.12 | Phase 2 again | [ADM-ROOT] | installs do not close F1 | any new FAIL |
| 3.13 | `bash $R7/verify/afldb-verify-call.sh version` | [WS] | an authentic production verdict | not PASS: **STOP** |
| 4.1–4.2 | `gpasswd -d arm sudo`; `id arm; sudo -l -U arm` | [ADM-ROOT], console open | arm has no sudo | — |
| 4.3 | new `ADM`; `sudo -k; sudo -v` | [WS], [ADM] | admin path survives | fails: back-out `gpasswd -a arm sudo` in [CON] |
| 4.4–4.6 | Phase 2; both install checks; wrapper `version` | [ADM-ROOT], [WS] | `OWNER CHECKS RESULT PASS`; installs intact | BLOCKED or FAIL: F1 stays open |
| 4.7 | close [CON] | [CON] | — | only after 4.3–4.6 |
| S | streamanator Phases 0–3 (§8); decision on arm's `docker`/`lxd`/`sudo` | streamanator console / [ADM-ROOT] | G0B independence | while C1 fails: G0B is arm-attested |
