# R6: production kernel, live patching and advisories, and whether to reboot before the owner's leave (22 Nov 2026, run d)

**Authority.** Owner decision 4 of 2026-11-22 (round 3): one read-only production check of kernel, livepatch and advisory state; the
owner is on leave **Thu 26 Nov 2026 - Wed 6 Jan 2027 inclusive** and available from **Thu 7 Jan 2027**. If a reboot is warranted,
propose a window after A2 and before 26 Nov; otherwise give the triggers and the alternate-operator prerequisites (no person named).
**The decision to reboot is the owner's.**

## 1. What ran

| | |
|---|---|
| Script | [`check.sh`](check.sh), sha256 (LF) `8dc8171ba4b0197621e7b8d905dded47a318fa2878a07ad6c552c2fe6f2858a0`; read-only by construction: no `sudo`, no apt update or install, no writes (not even `/tmp`), every probe under `timeout 20`, stdin closed |
| Rehearsal | streamanator, `/mnt/ssd/afldb-backlog-20261122d-r6/` (rc 0, about 2 s, including a forced `R6_RUN=6.8.0-137` run) before production (reviewer F-006) |
| Production session | **exactly one**: `ssh.exe -o BatchMode=yes afldb bash -s` with the LF script redirected through `cmd`, **2026-11-21 20:15:05-20:15:09Z = Sun 22 Nov 07:15:05-07:15:09 AEDT** (outside 02:10-02:40 and 04:50-07:15), as `arm`, rc 0, no retry |
| Output | [`raw-output.txt`](raw-output.txt) (168 lines; sha256 `15250caf65bd0813f0089d15154f4df4861ac5687171ecaa8c86302082995ede`); the only redaction is the root file-system UUID in the kernel command line (raw capture before redaction `882e0e2d…463b`, not kept). It holds no secret, IP address or log content |
| Public sources (workstation, public data only) | CISA Known Exploited Vulnerabilities catalogue, version 2026.11.20 (1,790 entries); Ubuntu CVE tracker entries for the two hits |

## 2. Confirmed (from production, 22 Nov 07:15 AEDT)

| Fact | Value | Line |
|---|---|---|
| Running kernel | `6.8.0-137-generic` (built 17 Jul 2026), **up 97 days 18 h** since 2026-08-16 12:14 AEDT | `raw-output.txt:8-15` |
| Installed kernels | 137 and **149** (`linux-image-virtual` 6.8.0-149.149); 138, 139, 142, 146, 147 were installed and later removed (dpkg log) | `:26-33`, `:127-141` |
| Reboot pending | `/var/run/reboot-required` since **2026-11-14 06:35**; packages: kernels 138-149, `linux-base`, **`libc6`** | `:41-58` |
| Live patching | **`canonical-livepatch` not installed**; no livepatch snap | `:72-74` |
| Ubuntu Pro | **not attached** (`attached: False`, cached `status.json` of 2026-08-16; livepatch "available", not enabled) | `:76-94` |
| Pending security updates | **none** in production's cached lists (`noble-security` list of 21 Nov 02:31): the 49 upgradable packages are non-security `noble-updates`; no newer kernel than 149 is offered | `:96-109` |
| Automatic reboot | none: no `Automatic-Reboot` key; unattended-upgrades allows security origins only | `:111-116` |
| GRUB | `GRUB_DEFAULT=0`, `GRUB_TIMEOUT_STYLE=hidden`, `GRUB_TIMEOUT=0`, `GRUB_RECORDFAIL_TIMEOUT=0`: an unplanned boot goes straight to the newest kernel (149) with no visible menu | `:60-69` |
| Timers | settle `afldb-settle-afl-api` daily about 05:00-05:10; `apt-daily-upgrade` about 06:30-06:45; `apt-daily` (downloads only) at a random time | `:118-125` |
| Kernel integrity | taint 0; lockdown `[none]` | `:156-158` |
| Host | DigitalOcean droplet (KVM, `configdrive`), Ubuntu 24.04.4 LTS | `:3-6`, `:20-24` |

**Fixes waiting in 149 (from production's own changelog).** `/usr/share/doc/linux-modules-6.8.0-149-generic/changelog.Debian.gz`, entries
newer than 137: 149, 148, 147, 146, 139 (the 138 and 142 respins have no entry of their own): **2,148 distinct CVE identifiers**
(`raw-output.txt` between `CVE-LIST-BEGIN/END`). Most kernel CVEs are low-impact or need hardware/configuration this host lacks; the
count is an upper bound on relevance, not a risk measure.

**Actively exploited issues among them (CISA KEV, intersected on the workstation with that list):**

| CVE | What (public) | KEV added | Ubuntu priority | Fixed in (noble `linux`) |
|---|---|---|---|---|
| **CVE-2026-53266** | ebtables SNAT target out-of-bounds write (local privilege escalation class) | 2026-09-18 | high | 6.8.0-146.146 |
| **CVE-2026-53362** | IPv6 `__ip6_append_data` (local privilege escalation) | 2026-08-27 | high | 6.8.0-147.147 |

Both are fixed in the installed 149 and **neither is fixed in the running 137**, and no live patch covers them (no Livepatch). Other
recent KEV kernel entries checked are already fixed at or before 137 (CVE-2026-46300 in 124, CVE-2026-31431 in 117, CVE-2025-39964 in
90, CVE-2025-39682 in 86) or not applicable (CVE-2022-0995).

**Exposure context (read-only, `raw-output.txt:160-166`).** `kernel.apparmor_restrict_unprivileged_userns = 1` (Ubuntu's restriction on
unprivileged user namespaces, which is the usual way an unprivileged process reaches netfilter/ebtables code); no ebtables or bridge
module loaded; IPv6 enabled. Both CVEs need **local code execution first** (for example a compromise of the Node application or Caddy);
they turn that into root. They are not remote entry points by themselves.

## 3. Unknown (not established by this check)

- Whether either KEV CVE is actually reachable here: the AppArmor restriction and the unloaded module reduce the ebtables path, but
  module autoloading and bypasses were not tested (and must not be on production). The IPv6 path has no such mitigation visible.
- The exact GRUB menu titles: `/boot/grub/grub.cfg` is root-only (`Permission denied` as `arm`). **Owner step (sudo):**
  `sudo grep -E "^(menuentry|submenu)|^\s+menuentry" /boot/grub/grub.cfg | cut -c1-120` before the reboot, to write the exact
  `grub-reboot` title for the rollback.
- Live `pro status` (only the cached file was read; attaching is not proposed here).
- DigitalOcean console access (login prompt seen) and the droplet's backup/snapshot settings: provider panel, owner only.
- Whether 149 boots cleanly on this droplet: same series and flavour as 137, so likely, but unproven until it boots.

## 4. Verdict: a reboot before the leave is warranted (the owner decides)

Reasons, in order: (1) two **actively exploited** local-privilege-escalation kernel bugs are fixed in an installed kernel that is not
running, with no live patching; (2) the leave is six weeks, so without a reboot the host runs 137 until at least Thu 7 Jan 2027 (about
145 days of uptime), and `libc6` stays unrefreshed in long-running processes (PostgreSQL in particular once R1 holds its restarts);
(3) an **unplanned** reboot during the leave (provider maintenance, crash) would boot 149 anyway, unattended, with no visible GRUB menu,
no verified console and no owner; an attended reboot now converts that risk into a checked one; (4) procedure 03 §7's "reboot within 30
days of the first pending kernel" is already exceeded (pending since before 14 Nov; 138 was installed on 19 Aug). Against: an attended
reboot is a short outage (about 1-3 minutes) and the last production operation before the leave; that is why it needs its own slot
and the prerequisites below, and why nothing else should share it (the ISSUE-348 load is recommended for January,
`issue348-acquisition/LOAD-WINDOW-PROPOSAL.md` §3).

### 4.1 Proposed window: **Wed 25 Nov 2026, 10:00-11:00 AEDT** (reboot about 10:20; fallback the same day 14:00-15:00)

Chosen after the night's first scheduled operations have proven themselves (02:20 backup, 03:10 off-host pull, 03:30 verification) and
clear of the settle (about 05:00-05:10) and `apt-daily-upgrade` (05:45-07:15 including its random delay). Not on Tue 24 Nov: A1 + A2
already fill 09:20-12:00 and the new release and R1 deserve one quiet night first. Not on Thu 26 Nov: the owner is away.

**Prerequisites (each a STOP if missing):**
1. **Owner present** for the whole window, with `sudo`.
2. **Provider console verified** beforehand: the DigitalOcean Droplet Console opened and a login prompt seen (owner, panel).
3. **Snapshot or verified backup:** either a DigitalOcean snapshot taken that morning (owner, panel; optional cost) **or** the Wed 25
   Nov 02:20 scheduled backup verified at 03:30 **and** pulled off-host at 03:10 with its sidecar verified (`a2-cron-observe.sh all` on
   streamanator, read-only). Without one of the two, do not reboot.
4. **R1 installed** (A2 §4.1) and its checks passed; A1 accepted (or rolled back cleanly) so the release state is known.
5. No `apt`/`dpkg` activity: `systemctl is-active apt-daily.service apt-daily-upgrade.service unattended-upgrades.service` shows no
   running job and `sudo fuser /var/lib/dpkg/lock-frontend` is empty.
6. The exact GRUB titles recorded (§3 owner step), for the rollback.

**Steps (owner, `sudo`; Claude reads and records):**
1. Record before: `uname -r`; `systemctl is-active postgresql afldb caddy`; `release.mjs status` exactly as A1 P5 runs it;
   `systemctl list-timers afldb-settle-afl-api.timer`.
2. **Stop the settle timer first:** `sudo systemctl stop afldb-settle-afl-api.timer` (it is enabled, so it re-arms at boot; step 5
   checks that it is listed again rather than relying on the stop persisting).
3. `sudo systemctl reboot`. Wait; reconnect with the usual single SSH session (the production firewall blocks bursts: one attempt per
   minute at most). If the host is not back in **10 minutes**, open the console (prerequisite 2).
4. **Acceptance probes:** `uname -r` = `6.8.0-149-generic`; `/var/run/reboot-required` absent; `systemctl is-active postgresql afldb
   caddy` all `active`; `systemctl --failed` empty; `release.mjs status` clean and the same `current` id as before; the public smoke
   (`a1a2-20261124/a1-s9-public-smoke.sh` from the workstation) PASS; the R2 hourly check's next run reports OK.
5. **Restart the settle timer:** `sudo systemctl start afldb-settle-afl-api.timer` (if it is not already active after boot) and
   `systemctl list-timers afldb-settle-afl-api.timer` shows Thu 26 Nov about 05:00 as next.
6. Record the result in `issues.md` (ISSUE-351) and `OPEN-ITEMS-AFTER-SITTINGS.md`.

**Rollback to 137** (only if 149 misbehaves after booting): `sudo grub-reboot "<the exact 137 title from prerequisite 6>"` then
`sudo systemctl reboot` (one boot only; the default stays 149), and record it; the issue stays open for a later attempt. If 149 does
not boot at all: the console (GRUB is hidden with timeout 0, so selecting 137 there needs the menu forced from the console, or the
provider's recovery boot), then restore from the snapshot as the last resort. Data is not touched by a reboot; restore of the
database is not part of this rollback.

### 4.2 If the owner decides not to reboot before the leave

**Triggers for an earlier reboot by an alternate operator** (the owner pre-authorises or not): a new CISA KEV kernel entry fixed in 149
(or a later installed kernel); evidence of local compromise of the host or of the application; an unplanned reboot that left the host
in a bad state; the provider announcing maintenance that forces a reboot anyway.

**Alternate-operator prerequisites** (no person named; the owner decides whether anyone holds these): DigitalOcean panel access to the
droplet (console, and snapshot rights); `arm`'s SSH key (sshd admits `arm` only, key authentication only) and `arm`'s `sudo` password;
this README, procedure 03 §3-§6 and kits R1/R6; the prerequisites of §4.1 checked and recorded; authority to run
`release.mjs rollback --attended` and to restore from a snapshot; a way to reach the owner if the host does not return in 10 minutes.

## 5. R7 (unchanged in substance; date-relative)

The five stale databases (`afldb_prod_auth_recovery`, `afldb_prod_candidate_20260926-213225`, `afldb_prod_candidate_20260927-142540`,
`afldb_prod_pre_rebuild_20260907-234124`, `afldb_prod_pre_rebuild_20260928-101642`) **stay**, pending a separate disposal decision. Earliest:
**an attended owner sitting on or after Thu 7 Jan 2027**, with prerequisites: the owner's written disposal decision; R3's scheduled
backups running with at least one verified off-host copy after A2; a per-database record before any drop (size, owner, last
activity, no connections); and the R7 kit steps (`kits/KITS-20261122.md` §R7) unchanged. Nothing about R7 changes before then.
