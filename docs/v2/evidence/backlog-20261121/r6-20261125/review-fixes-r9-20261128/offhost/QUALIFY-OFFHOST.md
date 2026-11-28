# QUALIFY-OFFHOST: qualifying an independent off-host verifier endpoint (R6 r9, 28 Nov 2026)

**Status: PREPARED, NOT RUN. No machine is qualified today.** The qualification pin `QUALIFIED-ENDPOINT` does not exist in this
directory, so the workstation wrapper `review-fixes-r7-20261128/verify/afldb-verify-call.sh` treats every off-host endpoint as
unqualified:

* `g0` ends in `OWNER VERDICT G0 STOP … qualification=none … reason="no qualified off-host endpoint …"` (exit 1), even when
  streamanator answers an authenticated, fully matching `G0B PASS`;
* `version` prints its production line and `OWNER VERDICT VERSION STOP … host=none role=offhost reason="no qualified off-host
  endpoint"` (exit 1).

Release G0 therefore STOPs, and the release stops before P2. That is the intended default.

Stu runs this procedure. Claude does not qualify a machine, does not create the pin, and does not nominate any existing machine as
independent. This document names no candidate.

## 0. Why streamanator cannot be the endpoint

On 28 Nov 2026 the logged `id` of streamanator's `arm` showed the groups `sudo`, `docker` and `lxd` (R8 OWNER-PROCEDURE §8). Docker
there is not rootless. Each of the three makes `arm` root-equivalent on streamanator. Whoever controls that account, including every
automated session that uses `~/.ssh/afldb_dev`, can replace the off-host verifier, its journal and the copy, and so can forge
`G0B PASS`.

The wrapper therefore **refuses** any pin or fixture whose `host=` or `address=` is `streamanator`, `streamanator.<anything>` or
`10.0.40.100`. It also refuses one whose host key equals a key the owner's `known_hosts` records for `10.0.40.100` or `streamanator`.
The reason printed is "its arm is in sudo, docker and lxd, so it is root-equivalent there (recorded 28 Nov 2026)". Qualifying
streamanator later would need a reviewed change of `DENY_RE` in the wrapper, not just a pin.

## 1. What "qualified" means

An endpoint **M** is qualified only when all of the following hold. The owner writes the evidence for each into one qualification
record (§4).

| # | Requirement | How to establish it | Record |
|---|---|---|---|
| Q1 | M is **not a VM or container on streamanator**, and does not run on a hypervisor that streamanator or its `arm` administers | M is a physical machine, or a VM on a hypervisor whose admin accounts and API credentials streamanator never held. On M's own console: `systemd-detect-virt`, `cat /sys/class/dmi/id/sys_vendor /sys/class/dmi/id/product_name`, `hostnamectl`. On the hypervisor (if any), from its own admin login: the VM list and the list of admin accounts and API tokens | output, and a sentence naming who administers the hypervisor |
| Q2 | M's **storage** is not storage streamanator mounts, exports or administers | On M: `findmnt -o SOURCE,TARGET,FSTYPE,OPTIONS` and `lsblk -o NAME,TYPE,SIZE,MODEL,SERIAL` show only local devices (no NFS, SMB, iSCSI, Ceph or other network block or file storage). The copy directory `/mnt/ssd/afldb-offhost-prod` is on one of those local devices | output |
| Q3 | M's **administration** uses credentials streamanator's `arm` never held | Every key in every `authorized_keys` on M (root, the admin account, the pull account, `afldb-verify`) was generated on the owner's workstation or on M itself. Every password was typed at M's console or set over the admin path, never stored on streamanator. M's root and admin keys appear nowhere under streamanator's `/home/arm`. On M as root: `for f in /root/.ssh/authorized_keys /home/*/.ssh/authorized_keys /etc/ssh/afldb-verify/authorized_keys; do ssh-keygen -lf "$f"; done` | each fingerprint with its origin |
| Q4 | streamanator has **no administrative route into M** | M's sshd accepts no key whose private half is on streamanator. If M's firewall can restrict SSH sources, it allows the workstation only. streamanator holds no account on M | M's `sshd -T` key lines and firewall rules |
| Q5 | M's **local pull account is not root-equivalent** | The pull account is a local account named `arm` (§3 says why), with its own password and keys. Run the R8 owner checks on M **as root from M's console or admin path**, with that local `arm` in the role of production's `arm` (R8 OWNER-PROCEDURE Phase 2, the same script, the same `env -i` command line, `--admin <M's admin account> --admin-fp <its fingerprint>`). Expected: every check PASS except group D (PostgreSQL), which reports UNKNOWN (D0 and D4 at least) because M runs no PostgreSQL and its `arm` has no `.env`. The owner records each group-D id as not applicable in writing. Any other FAIL or UNKNOWN, in particular B1/B2/B3 (sudo) or C1 (`docker`, `lxd`, `incus`, `libvirt`, `disk`, `shadow`), blocks qualification | the full output and the `OWNER CHECKS RESULT` line |
| Q6 | The verifier role on M was **installed through M's independent admin path** | §2 | the install and check output |
| Q7 | A **scheduled 03:10 pull** has run on M and produced the evidence the wrapper requires | §3, after at least one night | the `g0` output for that night |

Q1 to Q5 are what makes M independent of streamanator's `arm`. The wrapper cannot check them. It checks only that the pin exists,
is well formed, is not streamanator, carries a host key the owner's `known_hosts` holds, and points at a record whose sha256 it
re-computes. **The record is what establishes independence**, so it needs a second reader (§4.4).

## 2. Install the off-host verifier role through M's admin path

Use R8 OWNER-PROCEDURE Phases 0 and 1 on M, with M in place of production:

1. **Console.** Get a root login on M's own console: the physical console, IPMI or the hypervisor console. Do not use `sudo` in a
   pull-account session. Record `ssh-keygen -lf /etc/ssh/ssh_host_ed25519_key.pub` **on paper**. This is the pin's `hostkey=`.
2. **Admin account.** Create M's admin account (Phase 1, steps 1.1–1.13): its own key from the workstation, its own password typed
   at the console, `sudo` with a password. Check twice from the workstation that it reaches root.
3. **Pull account.** Create the local account `arm` on M (`useradd -m -s /bin/bash arm`). Give it a password nobody else knows.
   Do not add it to `sudo`, `admin`, `wheel`, `docker`, `lxd`, `incus`, `libvirt`, `disk` or `shadow`.
4. **Prerequisites** (as for streamanator in verify README §10): `/usr/bin/python3.12`, the group `systemd-journal`, sshd with
   `Include /etc/ssh/sshd_config.d/*.conf` as the first directive of `sshd_config`, Debian or Ubuntu `cron` (it logs
   `CRON[<pid>]: (arm) CMD (…)` to journald via syslog), and the time zone `Australia/Melbourne` (`timedatectl set-timezone
   Australia/Melbourne`).
5. **Bytes.** On the workstation, make a `git archive` of the **reviewed revision** that carries this r9 wrapper and bundle:
   `$R7/verify` plus `$R9/offhost`. Write down `sha256sum` of the tar and of `$R7/verify/bundle/SHA256SUMS`, which must equal the
   wrapper's `BUNDLE_SHA`. Carry the tar over M's admin path (Phase 2.1.4 shape: `ADM 'umask 077; set -C; cat > ~/stage.tar' <
   stage.tar`). Re-hash it in M's admin root session. Extract it to a root-owned directory outside `/home` (Phase 2.1.6).
6. **Install**, in M's admin root session:
   `bash <staging>/install-verify.sh --role offhost --key <staging>/afldb_verify.pub`, then
   `bash <staging>/verify-verify-install.sh --role offhost`. Both must PASS. `install-verify.sh` refuses a root session that
   descends from `arm`. `afldb_verify.pub` is the workstation's verify public key, carried over the admin path, with its
   `ssh-keygen -lf` fingerprint compared with the workstation's.
7. **Owner checks** (Q5): run them now, and again after §3.

## 3. The scheduled 03:10 pull, arranged so that the evidence exists

The off-host core (`bundle/g0b-core.sh`) and the root facts reader fix these paths and names. M must match them exactly, which is why
the pull account is called `arm`:

| Item | Required value on M |
|---|---|
| copy directory | `/mnt/ssd/afldb-offhost-prod`, owner `arm`, mode 0700, on M's local storage (Q2) |
| wrapper script | `/home/arm/afldb-ops/afldb-offhost-pull-daily.sh` = `docs/v2/evidence/backlog-20261121/kits/afldb-offhost-pull-daily.sh` at the reviewed revision |
| pull script | `/home/arm/afldb-ops/offhost-pull.sh` at the pin in `a2-cron-install.sh` (unchanged), with source `<prod>:/var/lib/afldb-backup/published/` (R8 OWNER-PROCEDURE §8, Phase 3) |
| alarm hook | `/home/arm/afldb-ops/alarm-email.sh` |
| crontab of `arm` | exactly the r3 pair, the marker line directly above the job: `# AFLDB-A2-r3: …` then `10 3 * * * AFLDB_ALARM_CMD=/home/arm/afldb-ops/alarm-email.sh /bin/sh /home/arm/afldb-ops/afldb-offhost-pull-daily.sh` |
| pull log | `/home/arm/afldb-ops/state/offhost-pull.log` (written by the wrapper script: BEGIN with lineage, OUTPUT, VERIFIED, END) |
| pull key | `~arm/.ssh/afldb_backup_pull`, generated **on M**. Its public key is added on production under the forced `rrsync -ro /var/lib/afldb-backup/published` command, by the owner over production's admin path. M's key is not streamanator's key |
| time zone and cron | `Australia/Melbourne`, and the distribution's `cron` with journald receiving its syslog lines. Do not disable `pam_loginuid` (that was a container-only fixture) |

The wrapper accepts a G0B PASS only when the RESULT line carries all five evidence fields and they are consistent:

* `dispatch-at=`: root cron's journal record of the 03:10 dispatch (`_UID=0`, `_TRANSPORT=syslog`, `SYSLOG_IDENTIFIER=CRON`), inside
  [D 03:10, D 03:11) Melbourne time;
* `complete-at=`: the END record, with `rc=0`, of the one invocation whose lineage contains that dispatch's PID;
* `received-at=` and `received-sha256=`: that invocation's VERIFIED record of the dump, with G0a's sha256;
* `rehash-sha256=`: root's re-hash of the copy at check time, equal to G0a's sha256.

The order must be dispatch ≤ received (5 s journal-receipt tolerance) ≤ complete ≤ D 03:10 + 35 min. A copy without the dispatch or
the completion is reported as **possession only**, and G0 STOPs. So:

* the 03:10 job must actually run from `arm`'s crontab. A manual run, a retry or an `at` job never links;
* the pull must finish, and VERIFY the dump, within 35 minutes;
* the journal on M must keep the night's CRON entries until G0 runs: persistent journald (`/var/log/journal`) with enough
  retention. A vacuumed or rotated-away journal gives "possession only … dispatch-at missing" (rehearsed, harness scenario l2);
* nothing may edit the pull log between the night and the check. A missing END gives "possession only … complete-at missing"
  (scenario l1).

## 4. Create and commit the qualification pin

1. **Record.** Write `records/QUALIFICATION-<host>-<YYYY-MM-DD>.md` in this directory. Include Q1–Q7 with their outputs, the host
   key fingerprint read at M's console, the workstation `known_hosts` line added for M (after comparing it with the paper
   fingerprint), the install and check output of §2, the owner-check output of Q5 with the written acceptance of each group-D id, and the `g0`
   output of the first scheduled night. Leave out secrets: no passwords and no private keys, only fingerprints. Compute its digest
   with `sha256sum records/QUALIFICATION-….md`.
2. **Known hosts.** Add M's host key to the workstation's `~/.ssh/known_hosts` under the exact address you will pin (an IP literal
   is preferred: then no DNS answer can redirect the call). Check `ssh-keygen -F <address> -l` against the paper fingerprint.
3. **Pin.** Create `QUALIFIED-ENDPOINT` in this directory. It must be LF-only, `key=value`, each key once, and `#` comments are
   allowed:

   ```text
   # AFLDB off-host qualification pin (QUALIFY-OFFHOST.md). Created by the owner.
   format=afldb-offhost-qualification-v1
   host=<M's kernel host name: the RESULT line's host=>
   address=<the address the wrapper connects to, as in known_hosts>
   hostkey=SHA256:<M's ed25519 host key fingerprint, 43 characters>
   record-file=records/QUALIFICATION-<host>-<YYYY-MM-DD>.md
   record-sha256=<sha256 of that record>
   qualified-on=<YYYY-MM-DD>
   ```

   The wrapper refuses an unknown key, a repeated key, a carriage return, a `rehearsal-utc-offset=` key (fixtures only), a record
   that is missing or does not hash to `record-sha256`, the names or address of streamanator, streamanator's known host key, and
   production itself.
4. **Review and commit.** A second reader (the independent reviewer) checks the record against Q1–Q7, and checks the diff, which
   adds the record and the pin and nothing else. The owner commits it. The pin is a deliberate owner act: no script writes it.
5. **Check.** From the committed revision, run `bash afldb-verify-call.sh version`. Both lines must be PASS, and the off-host line
   must be `host=<M> role=offhost … qualification=pinned qual-sha256=<sha256 of the pin>`. Compare that `qual-sha256` with
   `sha256sum QUALIFIED-ENDPOINT` in the owner's clone.
6. **Release use.** The wrapper finds the pin at `../../review-fixes-r9-20261128/offhost/QUALIFIED-ENDPOINT` relative to its own
   directory. A release export must therefore keep repository paths and include both directories:
   `git archive --format=tar <rev> $R7/verify $R9/offhost`. An export of `$R7/verify` alone has no pin, and G0 STOPs with
   `qualification=none`. Every G0 and VERSION verdict prints `qualification=` and `qual-sha256=`; the release record copies both.

**Revocation.** Delete the pin (and commit) when any of Q1–Q5 stops holding: a new hypervisor or storage, a new admin, a key or
password that streamanator touched, the pull account gaining a privileged group, or a changed host key. G0 then STOPs again. To
re-qualify, follow §1–§4 again with a new record.

## 5. What a qualified G0 PASS still does not establish

* The pull log's BEGIN, VERIFIED and END lines are written by M's pull account. They are trustworthy only because Q5 shows that
  this account cannot reach M's root, and M's root is independent of streamanator (Q1–Q4). The dispatch (root cron's journal entry)
  and the check-time re-hash (root) do not depend on the pull account.
* G0a still rests on production's F1 (R8 OWNER-PROCEDURE Phases 0–4).
* The wrapper's refusal of streamanator is a name, address and `known_hosts` check. A pin that reached streamanator under another
  name and with a key that the owner's `known_hosts` does not record for streamanator would not be caught. The record and its review
  (§4.4) are the control for that.

## 6. Rehearsal evidence (development, not owner evidence)

The disposable-container harness `review-fixes-r7-20261128/verify-harness/` qualifies its off-host container only by **fixture**
(`--qualification-fixture`, `--rehearsal` transport only, `qualification=FIXTURE` on every verdict). Its scenarios k and l, and the
local wrapper test `tests/r9q-wrapper-test.sh`, are in `evidence/`. A fixture simulates independence. It is never evidence that any
machine is independent.
