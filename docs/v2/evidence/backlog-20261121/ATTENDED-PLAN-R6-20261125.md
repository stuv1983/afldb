# Attended runbook: R6, the production reboot into kernel 149, Wednesday 25 November 2026 (APPROVED; prepared 22 Nov, run e; NOT EXECUTED)

> **CURRENT OPERATOR INSTRUCTIONS:** use the dated amendment at the end of this runbook. Earlier pins and pre-Sunday assumptions are historical; Monday installation is required before 03:10 AEDT.
>
> **24 Nov 2026: the r3 amendment (last section) is the only valid archive and A-2 procedure for every Tuesday outcome.** §0's archive, the 23 Nov CURRENT_ID amendment's archive and the r2 archive are superseded. R6 is NO-GO without Astra's PASS on r3.

**Authority.** Owner decision 2 of 2026-11-22, round 4 (`DECISIONS-20261122e.md` §2): R6 APPROVED for **Wed 25 Nov 2026 10:00-11:00
AEDT, fallback 14:00-15:00 the same day**, on run d's verdict (`r6-kernel-check-20261122/README.md` §4) and with the owner's rule:
**"IF BOOT RECOVERY IS STILL UNCERTAIN, PAUSE BEFORE REBOOTING."** This runbook is therefore **NO-GO by default**: it turns GO only
when every named item of §7 holds on the day. Every `sudo` step is the owner's, one block at a time, in his own SSH session; Claude
runs the read-only scripts of `r6-20261125/` and records. The ISSUE-348 load, R5 disposal, R7 and anything else are NOT in scope.

**Prepared without production contact** (run e's only production session was the ISSUE-348 privilege check). Production facts come
from run d's read-only check (`r6-kernel-check-20261122/raw-output.txt`, 22 Nov 07:15 AEDT), `R0-SITTING-20261122.md`, procedure 03
(`../remediation-20261114/run2/ops/procedures/03-pending-reboot.md`) and `OWNER-PACKET.md` R6. The advisories behind the decision were
re-verified from public sources in run e: `r6-20261125/ADVISORY-VERIFICATION.md` (all sources agree with run d; no correction).

**Not rehearsed on a like host (reviewer F-017).** No GRUB option, Recovery Console login, power cycle or snapshot restore has been
exercised on this or any DigitalOcean droplet. The streamanator dry runs (`r6-20261125/dry-run-20261122e.log`) prove that the scripts
parse, run to their end, refuse the wrong host and write nothing; they prove nothing about production's boot path.

## 0. Scripts and pins

> **SUPERSEDED (24 Nov 2026) for every Tuesday outcome by the r3 amendment's archive and blocks.** Kept as the historical Sunday
> contract; do not stage this archive for Wednesday.

Use the immutable helper revision `b48a2c5e1925e0a1dfa148b14203577df120b0a4` below. Stage the same archive on the workstation, production and streamanator. On the workstation, from the repository in Git Bash:

```bash
CODE=b48a2c5e1925e0a1dfa148b14203577df120b0a4
B=docs/v2/evidence/backlog-20261121
git archive --format=tar --output=/tmp/afldb-r6-20261125.tar "$CODE" \
  "$B/r6-20261125/r6-pre-verify.sh" \
  "$B/r6-20261125/r6-offhost-verify.sh" \
  "$B/r6-20261125/r6-post-verify.sh" \
  "$B/r6-20261125/r6-public-smoke.sh" \
  "$B/r6-20261125/r6-revalidate-accept.sh" \
  "$B/a1a2-20261124/a1-s9-public-smoke.sh" \
  "$B/a1a2-20261124/a1-rawhead.sh" \
  "$B/a1a2-20261124/a2-cron-observe.sh" \
  "$B/a1a2-20261124/a2-helper-install.sh" \
  "$B/kits/afldb-offhost-pull-daily.sh" \
  "$B/kits/scheduled-pull-evidence.sh" \
  "tools/maintenance/offhost-pull.sh" \
  "tools/maintenance/revalidate-season.ts" \
  "src/lib/acquisition/season-revalidation.ts"
```

Transfer the archive to `/tmp/afldb-r6-20261125.tar` on each named host. On each host, keep the printed staging path for the later commands. STOP if extraction or any hash check fails.

```bash
B=docs/v2/evidence/backlog-20261121
STAGE=$(mktemp -d /tmp/afldb-r6-20261125.XXXXXX) &&
  tar -xf /tmp/afldb-r6-20261125.tar -C "$STAGE" &&
  (cd "$STAGE" && sha256sum -c <<'R6_PINS'
1d61b08618a6f2b762a46047f94c68550b9179d6c73e2c58cacb8a2d551cb0a8  docs/v2/evidence/backlog-20261121/r6-20261125/r6-pre-verify.sh
429eec29acf254179c3b7ae7d6489a6c695981fd90996c5c2ce1301314bcc18c  docs/v2/evidence/backlog-20261121/r6-20261125/r6-offhost-verify.sh
26070c9e12458f488ebaee6eabb84ea7d8003135d96d83f1bfb3576eb070b44e  docs/v2/evidence/backlog-20261121/r6-20261125/r6-post-verify.sh
de84f1205b4ab4cfec182b1fb7b0770ca916c8570f10a14539daa9a4e450bd9e  docs/v2/evidence/backlog-20261121/r6-20261125/r6-public-smoke.sh
5e5ce991a5e4bf0875c49e01cc0f90db7da720a0f1c022507cec869d3cc067f0  docs/v2/evidence/backlog-20261121/r6-20261125/r6-revalidate-accept.sh
babb660f7e7555a55281f2a0a07cb6d1147f39ebfa5ff9c119a677a1e2776a71  docs/v2/evidence/backlog-20261121/a1a2-20261124/a1-s9-public-smoke.sh
cab4a43af09e4b1729d913162c0f27faccd19315c56eb4ad1141c8bf748d81c0  docs/v2/evidence/backlog-20261121/a1a2-20261124/a1-rawhead.sh
2ac943b113af2247ab3acb3863e97201c8794ff830520338faa8b299268eeee5  docs/v2/evidence/backlog-20261121/a1a2-20261124/a2-cron-observe.sh
6c1b57e57c7dc57a6094f44354ba9cec91a1dec310e57b9fae371670be388e47  docs/v2/evidence/backlog-20261121/a1a2-20261124/a2-helper-install.sh
2ebac1c09b07e6b3bc1e060d7645efdbb1c2c7f169b5cfafd4e7f77508716e24  docs/v2/evidence/backlog-20261121/kits/afldb-offhost-pull-daily.sh
d7574254997ba28dd1f750b7bcdc6f90c0a421b88ba6bb02aa104bd671b8572e  docs/v2/evidence/backlog-20261121/kits/scheduled-pull-evidence.sh
a3775aea879b1d9ce05d0e96482e66d24c69deb62cf38e8fc0407c0d2653dc2b  tools/maintenance/offhost-pull.sh
20ee3b452da9cb025a938a75c3200f44101fb094c1ad4662e70673df3d96b14e  tools/maintenance/revalidate-season.ts
bd88c915c2643fc1bc8ec005c5c6825d43af0742b33ca83f0461e9348414dbc9  src/lib/acquisition/season-revalidation.ts
R6_PINS
  ) && printf 'Verified staging root %s\n' "$STAGE"
```

In later sessions, set `STAGE` to the verified absolute path on that host and `B` to the value above. Run the production steps as arm, one connection per step, avoiding :16–:18. Use the application checkout when a step names its deployed release tooling. On streamanator, verify the live helper pair and core against the pins with `bash "$STAGE/$B/a1a2-20261124/a2-helper-install.sh" check` before A-1 and A-4.

For F-4b, put the release's Node tools on PATH before running the staged helper:

```bash
export PATH=/home/arm/.nvm/versions/node/v22.23.2/bin:$PATH
```

**Writes in this runbook, all named:** the owner's GRUB drop-in and `grubenv` changes (§3, undone in F5), the copy
`/root/grub.cfg.pre-r6-20261125`, the timer stops (§4), the reboot itself, and acceptance step A3 (one `status-pass` line in
`/home/arm/afldb-releases/events.log` and one POST to the retired email-intake route, which answers 410; `deploy/post-install-check.sh`
header). The snapshot lives in the owner's DigitalOcean account (§2).

## 1. Fill-in table (from the Tue 24 Nov sitting record; reviewer F-004) and outcome matrix

| Field | Source in the Tuesday record | Value on the day |
|---|---|---|
| A1 outcome | `accepted` / `stopped` (before promotion) / `rolledback` (with rollback verify PASS) | ________ |
| CURRENT_ID | accepted: `7d92042fd110-<BUILD_ID>`; otherwise `c8d4202a4cb3-aATnIlFOIQjq2z5oDdoHC` | ________ |
| BUILD_ID (accepted only) | P3b | ________ |
| r3 | `yes` = R3 steps 1-11 done and both `afldb-backup*.timer` enabled (§4.3 step 9) | ________ |
| r4 | `yes` = R4 accepted (installed Caddyfile `f00859d5…`) | ________ |
| R1 installed | §4.1 accepted | ________ |
| cron r2 / r3 installed (Melbourne time) | `a2-cron-install.sh` output | ________ / ________ |
| R5 block run | §4.5a | ________ |

| Tuesday outcome | Effect on R6 |
|---|---|
| A1 accepted, stopped, or rolled back **with** the rollback verify PASS | R6 may proceed (pass the matching arguments) |
| A1 rolled back without a PASS verify, or state unknown | **NO-GO** (NG-PRE): the release state must be known before a reboot |
| R1 not installed | **NO-GO** (NG-PRE fails it; run d prerequisite 4); owner may re-plan |
| `r3:no` (R3 moved to another slot) | **NO-GO.** Wednesday requires its own overnight backup, attributable off-host copy and attributable restore. |
| `r3:yes` but the 02:20 backup, 03:30 verify or 03:10 off-host pull is not PASS | **NO-GO** (NG-PRE / NG-OFFHOST). Record the completed snapshot for recovery. |
| `r4:no` | no effect on R6 (the scripts then expect Caddyfile `4f6972ec…`) |

## 2. (a) Pre-reboot verification (read-only), and (b) DigitalOcean console and snapshot

### 2.1 (a) What is verified before the reboot, with STOP lines

| # | Step | Expected (PASS) | STOP if |
|---|---|---|---|
| A-1 | streamanator after A-2: `bash "$STAGE/$B/a1a2-20261124/a2-cron-observe.sh" all 2026-11-25 "$D" "$S"` | Wednesday 03:10 `RESULT SCHEDULED-COPY-VERIFIED` | any `rc` other than 0 |
| A-2 | production, after the r3 re-check in the same shell: `bash "$STAGE/$B/r6-20261125/r6-pre-verify.sh" accepted "$CURRENT_ID" r3:yes "$R4" "$WINDOW" "$TUESDAY" "$ATTESTED"` (r3 amendment: `CURRENT_ID`, `TUESDAY` and `ATTESTED` come only from `r6-tuesday-handoff.sh` on the Tuesday sitting record) | `R6 PRE RESULT PASS`. Section 4 also: the live InvocationID equals the owner-attested one. Section 1: running 137, **installed images exactly {137, 149}** (a third kernel from the Mon-Wed 06:30 unattended run = STOP, owner decision), 137/149 boot files and modules present, `reboot-required` present. Section 3: `apt-daily*` services inactive, no apt/dpkg process, no writer timer (`afldb*`, `apt-daily*`) running or due in [window − 15 min, window + 90 min]. Section 4: `postgresql@16-main`, `afldb`, `caddy` active; 2 workers; `current` = CURRENT_ID; env counts 1/1 if accepted; Caddyfile per r4; R1 files equal the repo. Section 5 (r3:yes): `afldb-backup.service` started today 02:20-02:31, `success`/0; `afldb-backup-verify.service` 03:30-03:41, `success`/0; the 02:2x dump re-hashes to its exact named sidecar; the timer dispatch, verification-service journal invocation, completion, restored dump and `last-verify.json` agree; no `FAILED-*` marker; `scheduled-backup.sh status` rc 0; ledger 118; `afldb_restore_test` comment `afldb.restore_test.v1 sha256=<last-verify sha>`, `numbackends` 0. Section 6: ≥ 6,144 MB free | any FAIL line (= `R6 PRE RESULT STOP`) |
| A-3 | record the lines it prints: `BOOT_ID`, `INVOCATION_ID`, `GRUB-BASELINE`, `OFFHOST-COMPARE`, `RESTORE-EVIDENCE`, `RESTORE-SHA`; and the firmware (BIOS/UEFI), `/` and `/boot` file-system kind, `kernel.panic`, the `GRUB_*` lines, the grubenv variables | recorded | — |
| A-4 | streamanator after A-2: `bash "$STAGE/$B/r6-20261125/r6-offhost-verify.sh" 2026-11-25 "$D" "$S"` with the `OFFHOST-COMPARE` values | `R6 OFFHOST RESULT PASS`; its `OFFHOST-COMPARE` line **identical** to production's | any FAIL, or the two lines differ |
| A-5 | `deploy/afldb-settle-failure-status.sh` output | printed inside A-2 (packet R6 prerequisite 5: recorded before a reboot erases `Result`) | — |

### 2.2 (b) DigitalOcean: what the console and the snapshot are (sources fetched 2026-11-21 21:03Z; raw pages kept outside the repository)

| Page | URL | HTTP | sha256 of the body |
|---|---|---|---|
| Connect with the Droplet/Recovery Console | https://docs.digitalocean.com/products/droplets/how-to/connect-with-console/ | 200 | `503be77be0d8ba25a0896b529b4d47e4c027690d19bc9e7afeea613000c7d1ac` |
| Recovery ISO | https://docs.digitalocean.com/products/droplets/how-to/recovery/recovery-iso/ | 200 | `d6f63dd6bbfde72f97223097949bbaf9a375c89b3e736df78f7cba79b2f54b77` |
| Snapshot a Droplet | https://docs.digitalocean.com/products/snapshots/how-to/snapshot-droplets/ | 200 | `6b0c620e098efe6f35ebddaf9fa8f89fac02be21f991ccfcb51821162ae5d0ca` |
| Restore from a snapshot | https://docs.digitalocean.com/products/snapshots/how-to/restore-snapshot/ | **404** | `80768b6f8508bf5f865df7f07cd72652539b091a102544c7f99d2a3d9990d89c` (error page) |
| Power cycle (doctl reference) | https://docs.digitalocean.com/products/droplets/how-to/power-cycle/ | 200 | `0341d427abb088b1a30e58b82b07e726997b31a54f95d701b37aaca713e25b6f` |

**What the documentation says (quoted), and what it means here:**
- Two different consoles. The **Droplet Console** "connects to Droplets using" the in-guest agent and needs the booted system and its
  network; **it is not a recovery path**. The **Recovery Console** "is an older, browser-based connection option based on VNC. Using
  it is like plugging a keyboard and monitor directly into the Droplet. The Recovery Console is available even if a Droplet has lost
  network access or the sshd process has failed", and "it requires password authentication on the Droplet and doesn't fully support
  features like copying and pasting". So **NG-CONSOLE** means: the owner opened the **Recovery Console**, logged in as `arm` by typing
  the password (not pasting), ran `uname -r` and saw `6.8.0-137-generic`, then `exit`. A login prompt alone proves nothing (reviewer
  F-003). Limits stated honestly: the kernel command line ends `console=ttyS0`, so systemd's emergency-mode output goes to the serial
  line, not to the VNC screen (tty1 shows kernel messages and the login prompt); root is locked on the cloud image, so emergency mode
  offers no shell. **A 149 that reaches emergency mode is recoverable only by the GRUB fallback of §3, a snapshot restore or the
  recovery ISO.**
- **Power cycle** "is similar to pushing the reset button on a physical machine" (doctl reference). It is the action §3's option B
  relies on; the panel label was not verified by Claude (the owner finds it under the droplet's power controls during B-1).
- **Recovery ISO:** "First, power off the Droplet …", boot from the recovery ISO, connect "with the Recovery Console, not the Droplet
  Console", then mount the disk, `fsck` or `chroot`. The page itself recommends "taking a snapshot of your Droplet first". Last resort.
- **Snapshot:** "you may want to power off the Droplet before taking a snapshot … many databases don't guarantee data consistency on
  disk unless the database service is stopped or the entire Droplet is powered off first"; a live snapshot is taken "without
  powering off"; "A progress bar shows the progress of snapshot creation. Once complete, the snapshot is listed along with any other
  previous snapshots." **Restore** steps could not be fetched (404): the owner locates the restore action for the new snapshot in the
  panel during B-2 **without executing it**. Cost: not verified in run e (pricing page not fetched); the panel states it.

| # | Owner step (panel) | Pass |
|---|---|---|
| B-1 | Before 09:55: open the **Recovery Console**; log in as `arm` (typed password); `uname -r` → `6.8.0-137-generic`; `exit`. Note where the panel's power-cycle and power-off actions are (do not use them) | NG-CONSOLE met; record time |
| B-2 | **From 08:30** (after the 03:30 verification; a live snapshot runs while the site serves): Backups & Snapshots → Take Live Snapshot, name `afldb-prod-pre-r6-20261125`. Wait for the progress bar to finish and the snapshot to be **listed**. Locate (do not run) its restore action | snapshot listed as complete before 10:00; record name, time, size shown |

**What the snapshot is (reviewer F-013).** A full copy of the droplet disk: `.env` with every production secret, the database files,
SSH host keys and `authorized_keys`, `~/env-before-revalidate-*.bak` if still present, and the R5 retained pre-fix logs (which may
carry tokens live until about 1 Dec, `R5-RETENTION-PROPOSAL.md`). It is **crash-consistent only** (live snapshot): PostgreSQL recovers
from it as from a power loss, which is why the 02:20 dump verified off-host stays the data fallback of record. Duration depends on the
disk's used size and is unmeasured here, hence the 08:30 start. **Restoring it returns the whole disk to snapshot time:** every write
after it (settle runs, admin edits, backups, logs) is lost. It persists in the owner's account until deleted: **disposal REVIEW date
Thu 7 Jan 2027** (with R5's), in `OPEN-ITEMS-AFTER-SITTINGS.md`. Alternative the owner may choose instead: a power-off snapshot (the
documented recommendation) taken as part of the outage (power off, snapshot, power on = the reboot); consistent, but the outage then
lasts as long as the snapshot, which is unknown. Not recommended for this window.

## 3. (c) GRUB: owner read steps, choosing the kernel behind the hidden menu, recovery path

**Facts.** `GRUB_DEFAULT=0`, `GRUB_TIMEOUT_STYLE=hidden`, `GRUB_TIMEOUT=0`; `50-cloudimg-settings.cfg` sets `GRUB_TIMEOUT=0` and
`GRUB_RECORDFAIL_TIMEOUT=0` (`raw-output.txt:60-69`). An unattended boot goes straight to entry 0 = the newest kernel (149) with no
menu. `grub.cfg` is root-only and unread. Ubuntu puts older kernels in the **`Advanced options for Ubuntu` submenu**: a bare title such
as `"Ubuntu, with Linux 6.8.0-137-generic"` matches no top-level entry and **GRUB falls back to entry 0 (149)** (reviewer F-001). Every
entry below is therefore named by its **submenu path with `>`, using the ids copied from the owner's own C-1 output**, never typed
from memory. Firmware (BIOS or UEFI, printed by A-2) does not change any command here: Ubuntu reads `/boot/grub/grub.cfg` and
`/boot/grub/grubenv` in both cases; on UEFI `/boot/efi` must be mounted for `update-grub` (A-2 prints the mounts).

### 3.1 C-1 owner read steps (sudo, read-only apart from the saved copy), 09:40-09:55

```bash
S=20261125; sudo cp -p /boot/grub/grub.cfg /root/grub.cfg.pre-r6-$S && sudo sha256sum /boot/grub/grub.cfg /root/grub.cfg.pre-r6-$S   # record (the two equal)
sudo grep -n -A7 'if \[ "\${next_entry}" \]' /boot/grub/grub.cfg
sudo grub-editenv /boot/grub/grubenv list; ls -l /boot/grub/grubenv
sudo grep -nE '^submenu|^[[:space:]]*menuentry' /boot/grub/grub.cfg | cut -c1-230   # the owner sees the real ids; records write <uuid>
sudo grep -c 'set default="0"' /boot/grub/grub.cfg
grep -hE '^GRUB_(TERMINAL|SAVEDEFAULT|DISABLE_SUBMENU|DEFAULT)' /etc/default/grub /etc/default/grub.d/*.cfg
findmnt -no SOURCE,FSTYPE /boot || findmnt -no SOURCE,FSTYPE /
```

**Expected shapes (NG-GRUBREAD):**
1. The `next_entry` block reads `set default="${next_entry}"`, `set next_entry=`, **`save_env next_entry`**, `set boot_once=true`, `else`,
   `set default="0"`. Absent, or without `save_env next_entry`: option B is unavailable → **NO-GO**.
2. `grubenv list` prints nothing (or only `recordfail`/`initrdfail` lines the owner records; no `next_entry`, no `saved_entry`).
3. A `submenu 'Advanced options for Ubuntu' … 'gnulinux-advanced-<UUID>'` line, and inside it `menuentry 'Ubuntu, with Linux
   6.8.0-149-generic' … 'gnulinux-6.8.0-149-generic-advanced-<UUID>'` and the same for `137`. The owner writes down the two **paths**:
   `P149 = gnulinux-advanced-<UUID>>gnulinux-6.8.0-149-generic-advanced-<UUID>` and
   `P137 = gnulinux-advanced-<UUID>>gnulinux-6.8.0-137-generic-advanced-<UUID>` (the UUID is the root file system's; it is not a
   secret, but records keep `<uuid>`).
4. `set default="0"` count **1**.
5. `GRUB_TERMINAL` unset or `console` (a `serial`-only terminal would make any menu invisible on the VNC console; it does not affect
   option B, which needs no menu). `GRUB_DISABLE_SUBMENU` unset (if `y`, the 137 entry is top-level: use its id without the `>` prefix).
6. `/boot` (or `/`) is a **plain partition** (for example `/dev/vda1 ext4`), not LVM, MD-RAID or LUKS: GRUB cannot write `grubenv` on
   those, `next_entry` would then never be cleared and option B would boot 149 on every power cycle → **NO-GO** for option B.

### 3.2 The options (one chosen; the others are record only)

| Option | What it recovers from | Files it changes | Default afterwards | Restore + its verification |
|---|---|---|---|---|
| **B (CHOSEN): saved default 137 + one-shot 149.** Drop-in `99-afldb-r6.cfg` with `GRUB_DEFAULT=saved`; `update-grub`; `grub-set-default P137`; `grub-reboot P149` | **149 does not boot** (panic, hang, emergency mode): the owner power-cycles in the panel and GRUB boots `saved_entry` = 137, **no keystroke at the console**. **149 boots but misbehaves**: a plain `sudo systemctl reboot` boots 137 | `/etc/default/grub.d/99-afldb-r6.cfg`, `/boot/grub/grub.cfg` (regenerated), `/boot/grub/grubenv` (`saved_entry`, `next_entry`) | **137** until F5 restores it: if F5 is skipped or half-done, the next unplanned reboot regresses to 137 silently, with `reboot-required` absent | F5 below; verified by `r6-post-verify.sh grub` PASS (GRUB inputs = `GRUB-BASELINE`, no `next_entry`/`saved_entry`) **and** the owner's `sha256sum /boot/grub/grub.cfg` = the C-1 value and `set default="0"` count 1 |
| A: visible menu for one boot. Drop-in `99-afldb-r6.cfg`: `GRUB_TIMEOUT_STYLE=menu`, `GRUB_TIMEOUT=10`, `GRUB_RECORDFAIL_TIMEOUT=10` (10-30, **never -1**, the name must sort after `50-`), `update-grub` | 149 does not boot, **only if** the owner watches the Recovery Console at boot and selects `Advanced options` → 137 within 10 s with a browser VNC keyboard | drop-in, `grub.cfg` | 149 (menu visible for 10 s on every boot until restored) | remove the drop-in, `update-grub`, same checks |
| C: no change; `grub-reboot P137` only for a rollback after 149 boots | 149 boots but misbehaves; **not** a 149 that does not boot (then snapshot or recovery ISO only) | `grubenv` (`next_entry`) at rollback | 149 | — |
| D: Shift/Esc at power-on | **not relied on** (0-second hidden menu through a browser VNC console; procedure 03 §1) | — | — | — |

**Why B.** It is the only option that turns "149 does not boot" into a panel power cycle that lands on the running, known-good kernel,
without depending on reaching a 10-second menu through a browser keyboard; a "149 misbehaves" rollback is a plain reboot. Its cost is
the temporary change of the persistent default, which F5 undoes and two independent checks (arm script + owner sha) verify; a rollback
deliberately keeps it (§6). Its residual uncertainty: it has **never been exercised on this droplet** (F-017). The owner may reduce
that before the day by restoring the B-2 snapshot (or any recent one) to a **temporary droplet** and rehearsing C-2 there (cost and
time are his; not required by this runbook).

### 3.3 C-2 owner: apply option B (10:00-10:15; one block; only if NG-GRUBREAD holds)

```bash
printf '%s\n' '# AFLDB R6 2026-11-25: temporary; removed in step F5 of ATTENDED-PLAN-R6-20261125.md' 'GRUB_DEFAULT=saved' \
  | sudo tee /etc/default/grub.d/99-afldb-r6.cfg >/dev/null && sudo chmod 0644 /etc/default/grub.d/99-afldb-r6.cfg
sudo update-grub 2>&1 | grep -E 'Found linux image|done'      # exit 0; BOTH "Found linux image: /boot/vmlinuz-6.8.0-149-generic" and "…-137-generic"
sudo grub-script-check /boot/grub/grub.cfg && echo script-ok
sudo grep -n 'set default=' /boot/grub/grub.cfg                  # now: set default="${next_entry}" and set default="${saved_entry}"
sudo grub-set-default 'P137'                                      # the exact path from C-1, quoted
sudo grub-reboot 'P149'
sudo grub-editenv /boot/grub/grubenv list                         # exactly: saved_entry=P137 and next_entry=P149
sudo grep -c "gnulinux-6.8.0-137-generic-advanced-" /boot/grub/grub.cfg; sudo grep -c "gnulinux-6.8.0-149-generic-advanced-" /boot/grub/grub.cfg   # each >= 1
```
**Pass (NG-FALLBACK, boot part):** every line as commented. **Any difference:** undo now (`sudo rm /etc/default/grub.d/99-afldb-r6.cfg
&& sudo update-grub && sudo grub-editenv /boot/grub/grubenv unset saved_entry next_entry`, then `sudo sha256sum /boot/grub/grub.cfg`
= the C-1 value; if not, `sudo cp -p /root/grub.cfg.pre-r6-20261125 /boot/grub/grub.cfg`) and **NO-GO**.

## 4. (d) Writer timers: stopped (settle first) before, active again after

Production's enabled afldb timer on 22 Nov is `afldb-settle-afl-api.timer` only (run d `raw-output.txt:118-125`, R0 `:72-78`); after
A2 also `afldb-backup.timer` and `afldb-backup-verify.timer`. A-2 lists **every** timer live (`list-timers --all`, `list-unit-files
'afldb*'`); the rule covers whatever it shows.

| # | Owner, at or after **10:18** (after the 10:17 r2 check; 14:18 in the fallback) | Pass |
|---|---|---|
| D-1 | `sudo systemctl stop afldb-settle-afl-api.timer` **first**, then every other `afldb*` timer A-2 showed `active` (settle-afltables, settle-afl-api-brownlow, email-intake if present) **except** `afldb-backup.timer` and `afldb-backup-verify.timer` | — |
| D-2 | `systemctl is-active afldb-settle-afl-api.service afldb-settle-afltables.service afldb-settle-afl-api-brownlow.service afldb-email-intake.service afldb-backup.service afldb-backup-verify.service` | all `inactive` (a unit not installed also prints `inactive`); a running one: wait for it, never kill it |
| D-3 | apt gate, **immediately before E-1**: the block below | `inactive` twice, and the three other commands print nothing (NG-APT) |

```bash
systemctl is-active apt-daily.service apt-daily-upgrade.service
sudo fuser -v /var/lib/dpkg/lock-frontend /var/lib/dpkg/lock
pgrep -a -x 'dpkg|apt|apt-get'
pgrep -af '^/usr/bin/python3 /usr/bin/unattended-upgrade( |$)'
```
(`unattended-upgrades.service` itself is normally active: it only waits for shutdown; the `pgrep` line looks for an actual run.)

**Why the backup timers stay:** they are not due (next Thu 02:20 and Wed 2 Dec 03:30), and `Persistent=true` fires at boot only for
a run missed while down, which A-2 proved did not happen. **After the boot:** enabled timers re-arm by themselves at boot; D-4 (in F6)
checks each timer stopped in D-1 is `active` with a next elapse, and starts any that is not (`sudo systemctl start <timer>`). They
must all be active **before 11:17** (15:17), when the r2 check next reads `afldb-settle-failure-status.sh` (a stopped settle timer is
FAILED there). If that cannot be met, **expect exactly one R2 alarm email per hour until it is**, and say so in the record.

## 5. (e) The reboot, and (f) post-reboot verification

| # | Step | Who | Pass / next |
|---|---|---|---|
| E-1 | GO (§7) confirmed aloud; the owner keeps the Recovery Console open; `sudo systemctl reboot` **no later than 10:25** (14:25). Record T0 | Owner | — |
| E-2 | Workstation: `bash "$STAGE/$B/r6-20261125/r6-public-smoke.sh"` from T0+2 min, at most once a minute (HTTPS, not SSH) | Claude | `R6 PUBLIC RESULT PASS`; a Cloudflare error page while down is expected |
| E-3 | SSH only after E-2 passes, or on the fixed schedule **T0+3, T0+6, T0+10** (one attempt each; the first SSH is F-2 itself), never a loop. HTTPS answering while SSH times out = the home IPS, not the host: wait for the next slot | Claude | — |
| E-4 | No HTTPS and no SSH at T0+10: the owner reads the Recovery Console (kernel messages, login prompt; logs in as `arm`, `uname -r`, `systemctl --failed`) → §6 | Owner | — |
| F-1 | `bash "$STAGE/$B/r6-20261125/r6-public-smoke.sh"`; if A1 was accepted also `bash "$STAGE/$B/a1a2-20261124/a1-s9-public-smoke.sh" "$BUILD_ID"` | Claude | both PASS |
| F-2 | `bash "$STAGE/$B/r6-20261125/r6-post-verify.sh" full 6.8.0-149-generic "$CURRENT_ID" "$PRE_BOOT_ID" "$PRE_INVOCATION_ID" "$RESTORE_SHA" "$R4" "$GRUB_BASELINE"` | Claude | `R6 POST RESULT PASS (6.8.0-149-generic)` with one `NOTE GRUB inputs … differ` (option B still applied): new boot_id, uptime < 2 h, `reboot-required` absent, units active, `pg_isready`, new InvocationID, NRestarts 0, 2 workers, equal revalidation-name counts, `current` unchanged, Caddyfile unchanged, loopback health 200, timers sane, no failed unit, ledger 118, `afldb_restore_test` unchanged |
| F-3 | Owner: block F-3 below (counts and unit names only) | Owner | nothing from `postgresql`, `afldb` or `caddy`; anything else is recorded and judged |
| F-4 | **Acceptance step A3 (writes, named in §0):** the owner attests that InvocationID `<from F-2>` is the R6 boot's; then `node deploy/release.mjs status --expect <CURRENT_ID> --confirm-restart-invocation <INV>` and `bash deploy/post-install-check.sh --confirm-restart-invocation <INV> <CURRENT_ID>`; if the A1 raw-head baseline exists, the r3 re-check of the staging root and then, in the same shell, the guarded entry point `bash "$STAGE/$B/r6-20261125/r6-rawhead-check.sh"` (r3 amendment; it runs Sunday's pinned `a1-rawhead.sh` in check mode only as arm on afldb-prod; never run `a1-rawhead.sh` directly) | Claude (one connection) | `status` PASS, `POST-INSTALL CHECK PASS`, `RAWHEAD RESULT check PASS`; exit 2 from the entry point (`STOP not arm@afldb-prod …` or a helper-pin STOP) is a FAIL |
| F-4b | **Functional revalidation 2/2 (ISSUE-351; owner write scope: none to files or the database, no restart).** Claude, one connection, from `/home/arm/projects/afldb` as arm, AFTER F-2 and F-4 PASS and with fresh output from THIS boot (Sunday's 2/2 is not evidence): `bash "$STAGE/$B/r6-20261125/r6-revalidate-accept.sh" 2026 2` (runs the pinned CLI with the application checkout as its working directory and reads the checkout configuration). It posts the existing fan-out until every worker has answered; the URL and secret come from `.env` and are never printed or passed in argv | Claude | `R6 REVALIDATE RESULT PASS season 2026 workers …`, i.e. exit 0 and the line `REVALIDATED season 2026: 2/2 worker(s) reached (…)` naming **exactly workers 1 and 2**. `exit=1`, `INCOMPLETE`, `1/2`, a repeated ordinal or no output is **STOP: acceptance is not recorded**; never restart as a fallback (the process-level F-2 environment counts do not substitute for this step) |
| F-5 | **GRUB restore (owner, only after F-1..F-4b PASS):** block F-5 below; then Claude: `bash "$STAGE/$B/r6-20261125/r6-post-verify.sh" grub "$GRUB_BASELINE"` | Owner, Claude | as commented; `R6 GRUB RESULT PASS` |
| F-6 | D-4 timers; `systemctl list-timers --all 'afldb*' --no-pager` | Owner | every timer of D-1 active with a next elapse, before 11:17 |
| F-7 | Record (§9). `/root/grub.cfg.pre-r6-20261125` may stay (root-only) until 7 Jan | Claude | — |

**F-3 (owner):**
```bash
sudo journalctl -b -p err --no-pager | wc -l
sudo journalctl -b -p err --no-pager -o cat --output-fields=SYSLOG_IDENTIFIER | sort | uniq -c | sort -rn | head -n 15   # count per source, no message text
```
**F-5 (owner, one block):**
```bash
sudo rm /etc/default/grub.d/99-afldb-r6.cfg
sudo update-grub 2>&1 | grep -E 'Found linux image|done'        # both images listed
sudo grub-editenv /boot/grub/grubenv unset saved_entry next_entry
sudo grub-editenv /boot/grub/grubenv list                        # as at C-1 (normally nothing)
sudo sha256sum /boot/grub/grub.cfg                               # = the C-1 value
sudo grep -c 'set default="0"' /boot/grub/grub.cfg               # 1
```
If the `grub.cfg` hash differs: `sudo diff /root/grub.cfg.pre-r6-20261125 /boot/grub/grub.cfg`, explain every line; if any line is
unexplained, `sudo cp -p /root/grub.cfg.pre-r6-20261125 /boot/grub/grub.cfg` and re-check the hash.

**Deferred acceptance (reviewer F-016).** Packet R6's "the next 05:00 settle succeeds; R2 reads OK the next morning" falls on Thu 26 Nov,
inside the owner's leave. The observer is the R2 hourly check: **silence means OK**, an email means it is not. The record is completed
on the owner's return (7 Jan 2027) from `a2-cron-observe.sh r2` and the settle evidence.

## 6. (g) Rollback to 137, and its acceptance

**Kernel rollback, not application rollback.** Use it when F-2 fails in sections 1-2 (boot, PostgreSQL, the application or Caddy
not healthy), F-3 shows kernel or driver errors, or the host does not come up (E-4). While option B is still applied this is cheap and
reversible, so it is preferred to diagnosis inside the window. A release-only fault on a healthy 149 (wrong `current`, a page error
with all units healthy) is the A1 application rollback (`A1-A2` runbook §3.2), not this.

| Case | Owner action | Then |
|---|---|---|
| G-1: 149 is up but fails F-2/F-3 | D-1..D-3 again, then `sudo systemctl reboot` (no GRUB command: `next_entry` was consumed by the 149 boot, so GRUB boots `saved_entry` = 137) | E-2..E-4, then the acceptance below |
| G-2: 149 never comes up (E-4: panic, hang, emergency mode, no login) | panel **power cycle**, Recovery Console open | GRUB boots 137 (`saved_entry`); acceptance below |
| G-3: 137 does not come up either | Recovery Console → recovery ISO (§2.2), or **restore the B-2 snapshot** (all writes since 08:30 lost; the 02:20 dump off-host is the data complement); host loss: `docs/backup-restore.md` §6 procedure B | owner decisions, recorded; nothing else is attempted in the window |

**Rollback acceptance (137):** `bash "$STAGE/$B/r6-20261125/r6-post-verify.sh" full 6.8.0-137-generic "$CURRENT_ID" "$PRE_BOOT_ID" "$PRE_INVOCATION_ID" "$RESTORE_SHA" "$R4" "$GRUB_BASELINE"` PASS (`reboot-required` present is expected; GRUB
`NOTE` expected), `r6-public-smoke.sh` PASS, F-3, F-4 (A3) and D-4. **GRUB after a rollback: keep option B in place for the leave**
(`99-afldb-r6.cfg` stays; `saved_entry=P137`, no `next_entry`, verified by the owner's `sudo grub-editenv /boot/grub/grubenv list`):
an unplanned reboot during the leave then boots the known-good 137, not the 149 that just failed. An unattended kernel install runs
`update-grub` but keeps `GRUB_DEFAULT=saved`, so 137 stays the default while its id exists (137 cannot be autoremoved while it
runs). Record it in `OPEN-ITEMS-AFTER-SITTINGS.md` as a known deviation from the GRUB baseline; ISSUE-351 stays open; **no second 149
attempt on Wed 25 Nov** unless the owner decides otherwise.

## 7. GO/NO-GO checklist (all must read GO; default NO-GO)

| Item | GO when | Evidence |
|---|---|---|
| **NG-OWNER** | owner present with `sudo` from 09:40 to the end of the window, Recovery Console and panel open | owner |
| **NG-PRE** | A-2 `R6 PRE RESULT PASS` with the §1 arguments | A-2 output |
| **NG-OFFHOST** | (r3:yes) A-4 PASS and the two `OFFHOST-COMPARE` lines identical; A-1 r3 `rc=0` | A-1, A-4 |
| **NG-CONSOLE** | B-1 done today: Recovery Console, `arm` login by typed password, `uname -r` = `6.8.0-137-generic` | owner statement + time |
| **NG-DATA** | NG-PRE section 5 and NG-OFFHOST PASS for Wednesday. Record the B-2 snapshot status and the owner's recovery decision. | panel, A-2 |
| **NG-GRUBREAD** | C-1 shapes 1-6 as expected | owner output (UUIDs redacted) |
| **NG-FALLBACK** | C-2 applied and every check as commented | owner output |
| **NG-TIMERS** | D-1, D-2 done at or after 10:18 | owner output |
| **NG-APT** | D-3 idle, run immediately before E-1 | owner output |
| **NG-TIME** | E-1 can be issued by **10:25** (14:25) | clock |

**If any item is NO-GO at 10:25:** do not reboot. Undo C-2 if it was applied (§3.3 "any difference"), restart the D-1 timers, and
go to §8's fallback rule. **The owner's rule applies literally:** if any item about boot recovery (NG-CONSOLE, NG-GRUBREAD,
NG-FALLBACK, NG-DATA) is uncertain, pause; nothing in this runbook overrides that.

## 8. (h) Timing and the fallback-window rule

| AEDT | Step | Notes |
|---|---|---|
| 08:30 | B-2 live snapshot starts | after the 03:30 verify; must be listed complete before 10:00 |
| 09:25 | A-2 (production, one connection) | capture the exact Wednesday D/S for A-1 and A-4 |
| 09:35 | A-1, A-4 (streamanator) | use the Wednesday D/S from A-2 |
| 09:40-09:55 | B-1 (Recovery Console), C-1 (GRUB read) | owner |
| 10:00 | GO/NO-GO, all items except NG-TIMERS/NG-APT | — |
| 10:00-10:15 | C-2 option B | owner |
| 10:18-10:22 | D-1, D-2, D-3; final GO | after the 10:17 r2 check |
| **≤ 10:25** | **E-1 reboot (latest)** | leaves room for a G-1/G-2 second boot and its acceptance inside the window |
| 10:27-10:40 | E-2..F-4 | outage expected 1-3 min plus boot (unmeasured here) |
| 10:40-10:55 | F-5, F-6, F-7 | timers active well before 11:17 |
| 11:00 | window ends | a rollback started by about 10:40 still completes by about 11:00 |

**Fallback 14:00-15:00, same offsets** (A-2 re-run at 13:35 with argument `14:00`; C-1 at 13:40; C-2 14:00; D-1 at or after 14:18;
latest reboot 14:25; timers active before 15:17). **Rule:** the fallback window is used only when the 10:00 window was NO-GO for a
reason resolved with evidence by 13:55 (snapshot not yet complete, a Recovery Console login problem fixed, a timer or apt job that
was due, the owner delayed). It is **not** used after: an A-2/A-4 STOP on the backup chain or the kernel set, an unexpected C-1
shape, or a rollback to 137 in the morning; those go to the owner as a decision (run d §4.2 lists what an alternate operator would
need during the leave). The morning snapshot stays valid for the fallback (a restore would then lose writes since 08:30).

## 9. (i) What to report (sitting record, excerpts only, never a secret)

The fill-in table of §1; A-1/A-2/A-4 result lines and the printed `BOOT_ID`, `INVOCATION_ID`, `GRUB-BASELINE`, `OFFHOST-COMPARE`,
`RESTORE-SHA`; B-1 time and result; B-2 snapshot name, completion time and size shown; C-1 outputs with `<uuid>` (shapes 1-6) and the
pre-R6 `grub.cfg` sha256; C-2 outputs; D-1..D-3; T0 and the time HTTPS and SSH returned (the measured outage); F-1..F-7 result lines,
the new InvocationID and the owner's attestation; the F-3 counts; F-5 hashes; whether any rollback happened and why; whether any R2
alarm email was expected or received; the statement that **nothing in this procedure was rehearsed on a DigitalOcean droplet** and
which steps were therefore first exercised on production; tracker updates (ISSUE-351 in `issues.md`, `IssuesIndex.md`,
`OPEN-ITEMS-AFTER-SITTINGS.md`: kernel, the snapshot and its disposal review date, GRUB state, deferred Thu 26 Nov acceptance).

## Amendment — 22 November 2026, Astra Sunday review repairs (CURRENT)

This amendment supersedes earlier script pins, the r3 observation commands and the Tuesday
fill-in assumptions. It does not alter the historical Sunday PREP contract:
`ae51cd8d913a7523dd89fb638279e7f910054b79`. Sunday A1/A2 ran and were accepted as recorded in
`SITTING-A1-A2-20261122.md`; P6's four original NOT OK ticks and the owner's narrow waiver
remain historical facts. ISSUE-371 and ISSUE-372 remain resolved.

**Historical preparation and pins.** The following Monday preparation block and raw pins describe the earlier sitting. Wednesday uses §0.

### Before Monday 23 Nov 03:10 AEDT — owner action required

> **SUPERSEDED 23 Nov 2026 (ISSUE-352).** Do not use this install block, its two separate `install -m` commands, the pin table
> below for the two helpers and `a2-cron-install.sh`/`a2-cron-observe.sh`/`r6-offhost-verify.sh`, or the "wrapper/observer pass"
> claims in it. Review found the verifier rejects a genuine cron dispatch. The corrected pair, its single-step installer, the new
> three-outcome contract and the current pins are in `fix-20261123/ISSUE-352-HANDOFF.md` and `fix-20261123/BLOB-PINS.md`.
> The text below records the earlier preparation. The owner subsequently approved installation of the independently reviewed pair.

Install the new wrapper and new verifier on streamanator before that dispatch, preserving
`state/offhost-pull.log`, existing holds, destination, keys, alarm settings and crontab.
The core pull stays at `a3775aea879b1d9ce05d0e96482e66d24c69deb62cf38e8fc0407c0d2653dc2b`.
The wrapper now records BEGIN/run ID/nearest CRON ancestor PID, framed output, per-dump
full checksums (including unchanged verified copies), and END/completion time/rc. Runs
are serialized with flock. The cron CMD journal supplies the independent
streamanator dispatch record (it is streamanator's cron, not production's backup unit).

Prepare an archive of the exact code revision on the workstation (Git Bash):

```bash
CODE=bc3fef3de375259d49001e7a9a478624832703a8
B=docs/v2/evidence/backlog-20261121
git archive --format=tar --output=/tmp/afldb-r6-amended.tar "$CODE" "$B/r6-20261125" "$B/a1a2-20261124" "$B/kits" tools/maintenance/offhost-pull.sh
```

Transfer that archive to a new owner-chosen staging directory on streamanator; extract it
there. From the extracted root, the owner installs only these two files (no cron install):

```bash
B=docs/v2/evidence/backlog-20261121
install -m 0700 "$B/kits/afldb-offhost-pull-daily.sh" /home/arm/afldb-ops/afldb-offhost-pull-daily.sh
install -m 0700 "$B/kits/scheduled-pull-evidence.sh" /home/arm/afldb-ops/scheduled-pull-evidence.sh
sha256sum /home/arm/afldb-ops/afldb-offhost-pull-daily.sh /home/arm/afldb-ops/scheduled-pull-evidence.sh /home/arm/afldb-ops/offhost-pull.sh
bash "$B/a1a2-20261124/a2-cron-install.sh" check r3
```

All three SHA lines must equal the full pins below. Installer `check` returns 0 even on
failed preconditions: require its printed **wrapper pins PASS**, **PRECONDITIONS PASS**
and **INSTALLED**. Do not reinstall or replace the existing crontab. Verify arm can read
`journalctl -t CRON -o short-iso --no-pager -n 5`; if not, the owner must retain a readable
export for the specific 03:10 minute after it occurs, then pass its absolute path as
`CRON_LOG_FILE`. The checker fails if dispatch evidence is unavailable. New prerequisites
on streamanator: ps, flock and the ordinary GNU tools used in these scripts. P6 uses
Python 3's standard HTMLParser on the production host if that observation is run again.
None of these install actions were performed in the repair session.

Old logs remain useful for individual pull/verification messages and aggregate rc values.
They cannot retroactively prove which cron invocation completed successfully under the
new correlation contract. If the new wrapper misses Monday, record that evidence gap;
a later manual success is not a substitute for the scheduled pull.

### Wednesday evidence

Set `OUTCOME`, `CURRENT_ID`, `R4` (including the `r4:` prefix) and `WINDOW` (10:00 or 14:00) from §1 and the selected window. Run A-2 first. Record `PRE_BOOT_ID`, `PRE_INVOCATION_ID`, `GRUB_BASELINE` and `RESTORE_SHA` from its output for F-2.

On streamanator, set `D` and `S` to the exact Wednesday overnight filename and full digest from A-2’s `OFFHOST-COMPARE`. Run A-1 and A-4 with those values. Require the same pair from both hosts and a verified 03:10 invocation. Monday was “copy verified, scheduled origin unproven”. Tuesday’s dispatch is a separate observation.

Keep A-2’s `RESTORE-EVIDENCE` separately. It records the verification-service invocation ID, journal completion epoch, verification dump filename and full digest. The timer dispatch and service execution bound the matching journal record. A later manual restore that overwrites the state or changes the database comment causes STOP. A backup or restore from another day cannot clear the Wednesday gate.

After the reboot, require the pinned F-2 process check, F-4b functional revalidation with workers 1 and 2, and every attended check in §7.

### Historical Git blob SHA-256 pins for the previous sitting

Historical revision `bc3fef3de375259d49001e7a9a478624832703a8`. Use §0 for Wednesday.

| Git blob path at code commit | Full SHA-256 |
|---|---|
| `docs/v2/evidence/backlog-20261121/r6-20261125/r6-pre-verify.sh` | `53ab32a1bad408104c5534898482486735b3648d761006d28be79388ba72012c` |
| `docs/v2/evidence/backlog-20261121/r6-20261125/r6-post-verify.sh` | `26070c9e12458f488ebaee6eabb84ea7d8003135d96d83f1bfb3576eb070b44e` |
| `docs/v2/evidence/backlog-20261121/r6-20261125/r6-offhost-verify.sh` | `848a3371b81eb4ee328c161e0b8590d12ebd3a7fe9d27211ccc1f429460a5e2c` |
| `docs/v2/evidence/backlog-20261121/r6-20261125/r6-public-smoke.sh` | `de84f1205b4ab4cfec182b1fb7b0770ca916c8570f10a14539daa9a4e450bd9e` |
| `docs/v2/evidence/backlog-20261121/a1a2-20261124/a1-rawhead.sh` | `cab4a43af09e4b1729d913162c0f27faccd19315c56eb4ad1141c8bf748d81c0` |
| `docs/v2/evidence/backlog-20261121/a1a2-20261124/a1-s9-public-smoke.sh` | `babb660f7e7555a55281f2a0a07cb6d1147f39ebfa5ff9c119a677a1e2776a71` |
| `docs/v2/evidence/backlog-20261121/a1a2-20261124/a1-p6-observe.sh` | `c7416ba4975dd37a04537ef9f4ed6aef14625757037439ee929d258b3d97d6d3` |
| `docs/v2/evidence/backlog-20261121/a1a2-20261124/a2-cron-observe.sh` | `36a078651485561ddfc562c082816877e98c9106df6c22d0b75968c3251db4de` |
| `docs/v2/evidence/backlog-20261121/a1a2-20261124/a2-cron-install.sh` | `d34693cd61237d662b940f944fadfbfe0d18ab47515a313d36825235c79fbd87` |
| `docs/v2/evidence/backlog-20261121/kits/afldb-offhost-pull-daily.sh` | `6403871ecb1073c2f1a4086bf41fea002c2de7c0178dd8862098ea54d2265da3` |
| `docs/v2/evidence/backlog-20261121/kits/scheduled-pull-evidence.sh` | `2e42d307de1b63dda8f8e34322effc8747e4bc3c177245f0cc891f18777b0999` |
| `tools/maintenance/offhost-pull.sh` | `a3775aea879b1d9ce05d0e96482e66d24c69deb62cf38e8fc0407c0d2653dc2b` |
| `docs/v2/evidence/backlog-20261121/a1a2-20261124/dry-tests-20261122g/t-offhost-stamp.sh` | `a390a8df083a45af5a9590c0d985673b20f9bf21db6c5a2cb3a827be6f8e371c` |
| `docs/v2/evidence/backlog-20261121/a1a2-20261124/dry-tests-20261122g/t-sunday-review.sh` | `b8f06d5486ad8cd995d59b9634382f615f0535371121846f3a282cb0fb0446e0` |

Validation and first-copy evidence: [Sunday review record](sunday-review-20261122/README.md). Wednesday verification and the attended reboot decision remain pending.

## Amendment — 23 November 2026, Tuesday's application release of 17822b29 (PROPOSED; independent review required before the reboot)

> **SUPERSEDED 23 Nov 2026 (late) by the r2 amendment below.** Its CURRENT_ID change is kept unchanged in the r2 archive
> (`r6-post-verify.sh` `478f85cd…`; `r6-pre-verify.sh` carries the same line). Its archive (`58e35ce8`) and the original §0
> archive (`b48a2c5e`) are **no longer valid for any Tuesday outcome**. Both lack the A-2 serving-release gate and the F-4 host
> guard that the independent R6 review required.

**Why.** Tuesday 24 Nov may release `17822b29e6de2b6248cd7ada4221800fd81e0003` ([release runbook](../release-17822b29-20261124/RUNBOOK.md)). The pinned scripts admit only these CURRENT_ID values:

* `r6-pre-verify.sh:81`, outcome `accepted`: `7d92042fd110-*` only;
* `r6-post-verify.sh:81`: `7d92042fd110-*` or `c8d4202a4cb3-aATnIlFOIQjq2z5oDdoHC`.

So after a successful Tuesday release, A-2 and F-2 would STOP with usage exit 2. Nothing else in R6 pins Sunday's build. There is no BUILD_ID pin. Process, worker, revalidation and raw-head checks are written against `releases/$CUR` and Sunday's raw-head titles and robots, which the 17822b29 release keeps (its raw-head check prints `R6-NOTE`).

**Change.** Two lines only, in script revision `58e35ce8805e9f559d3dd1008606f90efb84fbab`:

```diff
-case $OUTC in accepted) [[ $CUR =~ ^7d92042fd110-[A-Za-z0-9_-]{1,64}$ ]];; *) [ "$CUR" = c8d4202a4cb3-aATnIlFOIQjq2z5oDdoHC ];; esac \
+case $OUTC in accepted) [[ $CUR =~ ^(7d92042fd110|17822b29e6de)-[A-Za-z0-9_-]{1,64}$ ]];; *) [ "$CUR" = c8d4202a4cb3-aATnIlFOIQjq2z5oDdoHC ];; esac \
-  [[ $K =~ ^6\.8\.0-(149|137)-generic$ ]] && [[ $CUR =~ ^(7d92042fd110-[A-Za-z0-9_-]{1,64}|c8d4202a4cb3-aATnIlFOIQjq2z5oDdoHC)$ ]] \
+  [[ $K =~ ^6\.8\.0-(149|137)-generic$ ]] && [[ $CUR =~ ^((7d92042fd110|17822b29e6de)-[A-Za-z0-9_-]{1,64}|c8d4202a4cb3-aATnIlFOIQjq2z5oDdoHC)$ ]] \
```

**Amended archive.** Use §0's command and the same 14 paths, with `CODE=58e35ce8805e9f559d3dd1008606f90efb84fbab`.

* Two pins change:
  * `r6-pre-verify.sh` `1d61b086…` → `fa8d34f0bae6f4d3250260dd44419d7f6b4020a7cfc4eda9626adb027d1043e5`;
  * `r6-post-verify.sh` `26070c9e…` → `478f85cd8930199796c046ea43cdbaab7882921d286a3c9f6015c4a70cd5c66c`.
* The other twelve §0 pins are byte-identical at `58e35ce8` and at `17822b29`. I checked each against `b48a2c5e`.
* The rehearsal ran the exact amended and original gate lines. The amended scripts admit `17822b29e6de-*` and `7d92042fd110-XWruOm…`, and post-verify still admits `c8d4202a…`. Pre-verify refuses `accepted` with `c8d4202a…` and a foreign id. The originals refuse `17822b29e6de-*` ([REHEARSAL.md §3 K](../release-17822b29-20261124/rehearsal/REHEARSAL.md)).

**Which archive on Wednesday.** Find Tuesday's outcome in the [release runbook §8](../release-17822b29-20261124/RUNBOOK.md); the arguments come from its sitting record.

| Tuesday | Wednesday arguments | Archive |
|---|---|---|
| 17822b29 released and accepted | outcome `accepted`, CURRENT_ID `17822b29e6de-<BUILD_ID from P3b>` | **amended archive, and only after an independent review of this amendment records PASS; without it R6 is NO-GO** |
| rolled back with the rollback verify PASS | outcome `accepted`, CURRENT_ID `7d92042fd110-XWruOm_9nLCSMY8nGPqYU` | §0 (original) or amended |
| deferred (nothing promoted) | outcome `accepted`, CURRENT_ID `7d92042fd110-XWruOm_9nLCSMY8nGPqYU` | §0 (original) or amended |
| promoted but not restarted, rollback verify failed, or unknown | — | **NO-GO** |

The `stopped` and `rolledback` outcome values in §1 describe Sunday's A1 relative to `c8d4202a`. **Do not use them for Tuesday's outcomes.**

**Unchanged gates.** Wednesday still requires all of the following. Tuesday's G0 replaces none of them:

* its own 02:20 scheduled backup;
* an attributable 03:10 off-host copy (A-1 and A-4 exit 0);
* the 03:30 verification-service restore, matched to its journal, state and database comment;
* the GRUB reads and recovery path;
* writer timers stopped before and active again after;
* F-2 process identity, F-4 status and post-install checks, F-4b functional revalidation with workers 1 and 2;
* the §7 GO/NO-GO checklist.

If Tuesday ran P2, Wednesday's backup and verification are the first production runs of the 17822b29 `backup.sh` and `scheduled-backup.sh`. The checkout units run them. A failure there fails these gates, and the reboot is NO-GO.

## Amendment — 23 November 2026 (r2), independent R6 review fixes (SUPERSEDED by r3, 24 Nov 2026)

> **SUPERSEDED 24 Nov 2026 by the r3 amendment below**, after Astra's re-review of `cc3369a5` failed. Its archive (`7af24a74`,
> manifest `53b8cb10…`), its staging and re-check blocks (a file count, no type or path check) and its five-argument A-2 are not
> valid for any Tuesday outcome. Kept as the record of what Astra reviewed.

This amendment supersedes §0 and the 23 Nov CURRENT_ID amendment's archive. It applies to **every** Tuesday outcome. Without a
recorded PASS from Astra's re-review of this amendment at its review commit, R6 is NO-GO. Everything else in this runbook stands.

**What changed (helper revision `7af24a74b15af39b0bdebeec9be0b089c8adc8a1`).**

1. **A-2 stops when the serving-release check fails.** Previously, `r6-pre-verify.sh` printed `release.mjs status`'s exit code as
   INFO only. A service still running the previous release behind a matching `current` symlink and two workers therefore passed
   A-2. The rehearsal reproduced this with the 58e35ce8 script. `release.mjs status --expect` is **not** read-only: a live PASS
   appends one `status-pass` line to `/home/arm/afldb-releases/events.log` (`deploy/release.mjs:1539-1545`, the same bytes at
   7d92042f and 17822b29). The owner therefore chose the read-only form. A-2 runs `node deploy/release.mjs status` (no `--expect`)
   once, captures that one invocation's output and exit code, and passes only when all of these hold:
   * the exit code is 0;
   * there is exactly one result line (`release: STATUS PASS|FAIL …`), and it is exactly `release: STATUS PASS <CURRENT_ID>`;
   * there is no `restarted since the last attested PASS` note.

   Anything else is a FAIL line, so the result is `R6 PRE RESULT STOP` with a nonzero exit. `CURRENT_ID` is the **full** release ID
   from Tuesday's sitting record, exactly as below. A truncated or mistyped ID STOPs. A-2 writes nothing: the rehearsal compared
   `events.log` byte for byte in every case.
2. **F-4's raw-head check goes through a guarded entry point.** Sunday's `a1-rawhead.sh` has no host or user guard: on any host it
   reads `/home/arm/projects/afldb/.env`, creates a temporary probe file and makes requests. F-4 now runs
   `bash "$STAGE/$B/r6-20261125/r6-rawhead-check.sh"`. It runs only `hostname` and `id -un` until it has confirmed user `arm` on
   host `afldb-prod`. Otherwise it exits 2 and nothing is read, written or requested. It then confirms that the staged
   `a1-rawhead.sh` is Sunday's pinned `cab4a43a…` and runs it unchanged in `check` mode against Sunday's
   `/home/arm/a1-rawhead-baseline.json`. Sunday's helper, its pin and its baseline are not changed. F-4's row (§5) now reads:
   `… and bash deploy/post-install-check.sh --confirm-restart-invocation <INV> <CURRENT_ID>; if the A1 raw-head baseline exists,
   bash "$STAGE/$B/r6-20261125/r6-rawhead-check.sh"`. Expected output: `RAWHEAD RESULT check PASS`. Exit 2 (`STOP not
   arm@afldb-prod …`, or a helper-pin STOP) is a FAIL.
3. **One copy-ready archive and checksum procedure**, below. It replaces §0's command and the earlier "use §0 with two changed
   pins" instruction. It has 15 files: §0's 14 plus `r6-rawhead-check.sh`. Three pins differ from §0: `r6-pre-verify.sh`,
   `r6-post-verify.sh` (the CURRENT_ID line, unchanged since `58e35ce8`) and the new `r6-rawhead-check.sh`. The other twelve are
   byte-identical to §0's `b48a2c5e` pins.

**Wednesday arguments (unchanged release-ID mapping).** Take them from Tuesday's sitting record:

| Tuesday | A-2 `OUTCOME` | A-2 `CURRENT_ID` (full, exactly) | Archive |
|---|---|---|---|
| 17822b29 released and accepted | `accepted` | `17822b29e6de-<BUILD_ID from P3b>` | this r2 archive |
| rolled back with the rollback verify PASS | `accepted` | `7d92042fd110-XWruOm_9nLCSMY8nGPqYU` | this r2 archive |
| deferred (nothing promoted) | `accepted` | `7d92042fd110-XWruOm_9nLCSMY8nGPqYU` | this r2 archive |
| promoted but not restarted, rollback verify failed, or unknown | — | — | **NO-GO** |

The `stopped` and `rolledback` outcome values in §1 describe Sunday's A1. **Do not use them for Tuesday's outcomes.** The last
attested `status-pass` line that A-2's restart rule compares against is:

* accepted: Tuesday's P5 `status --expect … --confirm-restart-invocation`;
* rolled back: the rollback verification;
* deferred: Sunday's A1 acceptance.

Any service restart after that line that nobody attested makes A-2 STOP.

### R6 archive r2: workstation (Git Bash), before 09:25

```bash
CODE=7af24a74b15af39b0bdebeec9be0b089c8adc8a1
B=docs/v2/evidence/backlog-20261121
git -C /d/dev/afldb archive --format=tar --output=/tmp/afldb-r6-20261125-r2.tar "$CODE" \
  "$B/r6-20261125/r6-pre-verify.sh" \
  "$B/r6-20261125/r6-offhost-verify.sh" \
  "$B/r6-20261125/r6-post-verify.sh" \
  "$B/r6-20261125/r6-public-smoke.sh" \
  "$B/r6-20261125/r6-revalidate-accept.sh" \
  "$B/r6-20261125/r6-rawhead-check.sh" \
  "$B/a1a2-20261124/a1-s9-public-smoke.sh" \
  "$B/a1a2-20261124/a1-rawhead.sh" \
  "$B/a1a2-20261124/a2-cron-observe.sh" \
  "$B/a1a2-20261124/a2-helper-install.sh" \
  "$B/kits/afldb-offhost-pull-daily.sh" \
  "$B/kits/scheduled-pull-evidence.sh" \
  "tools/maintenance/offhost-pull.sh" \
  "tools/maintenance/revalidate-season.ts" \
  "src/lib/acquisition/season-revalidation.ts" &&
  sha256sum /tmp/afldb-r6-20261125-r2.tar
```

### R6 archive r2: transfer (workstation Git Bash; one line per host; never at minute :16–:18)

```bash
C:/Windows/System32/OpenSSH/ssh.exe -o BatchMode=yes -i C:/Users/stuar/.ssh/afldb_dev arm@10.0.40.100 'cat > /tmp/afldb-r6-20261125-r2.tar' < /tmp/afldb-r6-20261125-r2.tar
```

```bash
C:/Windows/System32/OpenSSH/ssh.exe -o BatchMode=yes afldb 'cat > /tmp/afldb-r6-20261125-r2.tar' < /tmp/afldb-r6-20261125-r2.tar
```

### R6 archive r2: staging and verification (run once on each host: workstation, production, streamanator)

Paste the block into a shell on that host, or pipe it there with `tr -d '\r' < block | ssh.exe … bash -s`. Record the printed
staging root. STOP unless the block prints 15 `: OK` lines and `R6 STAGE VERIFIED <path> (15 files)`. The block also STOPs on
an extra or missing file and on a manifest that differs from the one printed here (digest
`53b8cb1031c1d0204c7bf0a413efa5cb2ea1e5c37b2025f111ed1bc1de78b0fc`).

```bash
B=docs/v2/evidence/backlog-20261121
STAGE=$(mktemp -d /tmp/afldb-r6-20261125-r2.XXXXXX) &&
  tar -xf /tmp/afldb-r6-20261125-r2.tar -C "$STAGE" &&
  cat > "$STAGE/R6-SHA256SUMS" <<'R6_PINS' &&
0d9e97a5d5882203703ca36083a84284f30158c0475f6a1b1926359854bd6ad9  docs/v2/evidence/backlog-20261121/r6-20261125/r6-pre-verify.sh
429eec29acf254179c3b7ae7d6489a6c695981fd90996c5c2ce1301314bcc18c  docs/v2/evidence/backlog-20261121/r6-20261125/r6-offhost-verify.sh
478f85cd8930199796c046ea43cdbaab7882921d286a3c9f6015c4a70cd5c66c  docs/v2/evidence/backlog-20261121/r6-20261125/r6-post-verify.sh
de84f1205b4ab4cfec182b1fb7b0770ca916c8570f10a14539daa9a4e450bd9e  docs/v2/evidence/backlog-20261121/r6-20261125/r6-public-smoke.sh
5e5ce991a5e4bf0875c49e01cc0f90db7da720a0f1c022507cec869d3cc067f0  docs/v2/evidence/backlog-20261121/r6-20261125/r6-revalidate-accept.sh
cc8854f0bbce305e1071e3eea30100e18d742ae15cddbd1f9a19b908ad100b50  docs/v2/evidence/backlog-20261121/r6-20261125/r6-rawhead-check.sh
babb660f7e7555a55281f2a0a07cb6d1147f39ebfa5ff9c119a677a1e2776a71  docs/v2/evidence/backlog-20261121/a1a2-20261124/a1-s9-public-smoke.sh
cab4a43af09e4b1729d913162c0f27faccd19315c56eb4ad1141c8bf748d81c0  docs/v2/evidence/backlog-20261121/a1a2-20261124/a1-rawhead.sh
2ac943b113af2247ab3acb3863e97201c8794ff830520338faa8b299268eeee5  docs/v2/evidence/backlog-20261121/a1a2-20261124/a2-cron-observe.sh
6c1b57e57c7dc57a6094f44354ba9cec91a1dec310e57b9fae371670be388e47  docs/v2/evidence/backlog-20261121/a1a2-20261124/a2-helper-install.sh
2ebac1c09b07e6b3bc1e060d7645efdbb1c2c7f169b5cfafd4e7f77508716e24  docs/v2/evidence/backlog-20261121/kits/afldb-offhost-pull-daily.sh
d7574254997ba28dd1f750b7bcdc6f90c0a421b88ba6bb02aa104bd671b8572e  docs/v2/evidence/backlog-20261121/kits/scheduled-pull-evidence.sh
a3775aea879b1d9ce05d0e96482e66d24c69deb62cf38e8fc0407c0d2653dc2b  tools/maintenance/offhost-pull.sh
20ee3b452da9cb025a938a75c3200f44101fb094c1ad4662e70673df3d96b14e  tools/maintenance/revalidate-season.ts
bd88c915c2643fc1bc8ec005c5c6825d43af0742b33ca83f0461e9348414dbc9  src/lib/acquisition/season-revalidation.ts
R6_PINS
  (cd "$STAGE" && sha256sum -c R6-SHA256SUMS &&
    [ "$(find . -type f ! -name R6-SHA256SUMS | wc -l)" -eq 15 ] &&
    [ "$(sha256sum < R6-SHA256SUMS | cut -c1-64)" = 53b8cb1031c1d0204c7bf0a413efa5cb2ea1e5c37b2025f111ed1bc1de78b0fc ]) &&
  printf 'R6 STAGE VERIFIED %s (15 files)\n' "$STAGE" ||
  { echo 'R6 STAGE STOP: do not use this staging root'; false; }
```

### R6 archive r2: re-check before each use (later sessions; set `STAGE` to the recorded root first)

```bash
(cd "$STAGE" && sha256sum -c --quiet R6-SHA256SUMS &&
  [ "$(find . -type f ! -name R6-SHA256SUMS | wc -l)" -eq 15 ] &&
  [ "$(sha256sum < R6-SHA256SUMS | cut -c1-64)" = 53b8cb1031c1d0204c7bf0a413efa5cb2ea1e5c37b2025f111ed1bc1de78b0fc ]) &&
  echo "R6 STAGE OK $STAGE" || { echo "R6 STAGE STOP $STAGE"; false; }
```

Then set `B=docs/v2/evidence/backlog-20261121` and use only the staged copies, as §0's last paragraph describes (A-1 and A-4 on
streamanator after `a2-helper-install.sh check`; the F-4b PATH line is unchanged).

**Rehearsal (streamanator, disposable, production not contacted):**
[review-fixes-20261123/README.md](r6-20261125/review-fixes-20261123/README.md). It covers the printed blocks run verbatim from a
clean export, the file count, the stops on a changed staged file, and the A-2 and F-4 cases in disposable containers.

## Amendment — 24 November 2026 (r3), fixes for Astra's failed R6 re-review (CURRENT; PROPOSED; Astra re-review required before the reboot)

This amendment supersedes §0, the 23 Nov CURRENT_ID amendment's archive and the **whole r2 amendment's archive, staging and
re-check procedure**, for every Tuesday outcome: released and accepted, rollback verified, and deferred before promotion. Without
a recorded PASS from Astra's independent re-review at this amendment's review commit, R6 is NO-GO. Wednesday is also NO-GO until
its own 02:20 backup, attributable 03:10 off-host pull, attributable 03:30 verification restore, console and recovery checks pass
(§7). Everything else in this runbook stands.

**Tuesday's release runbook §8 is superseded for Wednesday** ([RUNBOOK.md §8](../release-17822b29-20261124/RUNBOOK.md)): its
"Wednesday archive" column (`b48a2c5e` original, `58e35ce8` amended) no longer applies to any outcome; every outcome uses the r3
archive below. Its InvocationID column is now enforced by A-2 from the sitting record. Tuesday's own pinned packet (scripts
`58e35ce8`, `SHA256SUMS` `b4e9e584…`) and Sunday's `a1-rawhead.sh` (`cab4a43a…`) are unchanged and are not modified by this
amendment. The r2 archive (`7af24a74`, manifest `53b8cb10…`) is superseded.

**What changed (helper revision `9a9a01c195602e430d0d514e5fbe550eb77d0a9f`).**

1. **A-2 verifies the owner-attested service InvocationID.** `r6-pre-verify.sh` keeps the single plain `release.mjs status` call
   (no `--expect`), its merged output and its actual exit code, the exact `release: STATUS PASS <CURRENT_ID>` rule and the
   restart-note rejection. Plain `status` cannot see a restart after the attested PASS when `events.log` is unreadable, malformed,
   or superseded by a later unconfirmed `status-pass`: it then prints PASS with no note (reproduced, below). So A-2 now takes two
   more arguments and makes a **separate** read-only comparison, `systemctl show afldb -p InvocationID --value`, against the
   owner-attested ID. A failed read, an empty or malformed value (anything but one 32-hex ID), or a mismatch is a FAIL line, so
   `R6 PRE RESULT STOP`, exit 1. The expected ID comes only from the sitting record, through `r6-tuesday-handoff.sh`; neither
   the live service nor `events.log` can supply it. All seven arguments are required; a missing, extra or ambiguous Tuesday
   outcome, a malformed ID, or an outcome/ID combination outside the table below is a usage STOP, exit 2, before any check.
   A carriage return anywhere in the status output, or any line containing `STATUS PASS`/`STATUS FAIL` beyond the one exact
   line, now STOPs too: a CRLF `release: STATUS FAIL` beside an LF `release: STATUS PASS <id>` passed r2.
2. **Exact archive contents in both printed blocks.** The staging block and the re-check block run the **same** verification
   lines: the staging root is a real directory owned by the running user; the manifest matches its independent digest pin
   below; nothing in the root is group- or world-writable or a hard-linked file; the root holds **exactly** the manifest
   `R6-SHA256SUMS`, the 16 pinned regular files and their parent directories (each path with its object type, compared as one
   sorted listing); and every file matches its pin. An extra file, a nested `docs/R6-SHA256SUMS`, an extra symlink, an empty
   directory, or an expected file (or the manifest) replaced by a symlink to identical bytes is a STOP. A file count is no
   longer used. Extraction and the manifest write happen under `umask 077`; an archive that carries its own root
   `R6-SHA256SUMS` STOPs before anything is written through it.
3. **Wednesday operator instructions.** §5's F-4 row now names the guarded entry point (changed in place above). The A-2 row of
   §2.1 names the seven-argument form. `r6-rawhead-check.sh` now hashes Sunday's helper from **one read into memory and executes
   those same bytes**, so the helper's path is not reopened between the pin check and execution. Its wrong-host and wrong-user
   paths still stop (exit 2) before `.env` is opened, a temporary file is created or a request is made (rehearsed below).
4. **New helper `r6-tuesday-handoff.sh`** (workstation, read-only, no network): reads the Tuesday sitting record and prints A-2's
   Tuesday arguments, or STOPs.

**A-2's read-only behaviour, precisely.** A-2 itself creates, changes or removes no file, unit, timer, database row or
`events.log` line, and runs no sudo, restart or apt. What the services it queries may record is theirs: `release.mjs status`
makes loopback GETs (`/api/health`, which queries the database, and the current and previous `_buildManifest.js`), so the
application may write its ordinary request and health log lines to the `afldb` journal; PostgreSQL may log the one read-only
backup-role session if connection logging is on; sshd and PAM record the login. The rehearsal compared `events.log` byte for
byte around every A-2 run.

**Wednesday arguments (from Tuesday's sitting record only).**

| Tuesday | handoff `tuesday-outcome` | A-2 `CURRENT_ID` (full, exactly) | A-2 attested InvocationID | Archive |
|---|---|---|---|---|
| 17822b29 released and accepted | `released` | `17822b29e6de-<BUILD_ID from P3b>` | the owner-attested Tuesday restart (bound by P5) | r3 |
| rolled back with the rollback verify PASS | `rolledback` | `7d92042fd110-XWruOm_9nLCSMY8nGPqYU` | the owner-attested rollback restart (bound by `ROLLBACK RESULT VERIFIED`) | r3 |
| deferred before promotion | `deferred` | `7d92042fd110-XWruOm_9nLCSMY8nGPqYU` | Sunday's `342040625f6d4012a35d598dfbf9afe6` | r3; **a Tuesday sitting record confirming the deferral is required** |
| promoted but not restarted, rollback verify failed, no Tuesday record, or unknown | — | — | — | **NO-GO** |

A-2's `OUTCOME` is always `accepted`; `stopped` and `rolledback` describe Sunday's A1 and are refused.

**The handoff block in the Tuesday sitting record.** The record (Tuesday runbook §7:
`docs/v2/evidence/release-17822b29-20261124/SITTING-20261124.md`) must contain exactly these three lines, unindented, and no other
line containing `R6-HANDOFF`:

```text
R6-HANDOFF tuesday-outcome <released|rolledback|deferred>
R6-HANDOFF current-id <the full release id>
R6-HANDOFF attested-invocation <the 32-hex InvocationID>
```

Tuesday's session writes them at its end, or Wednesday's session adds them before 09:25 with the owner confirming each value.
Every value is copied from the record's own lines (P3b's `NEW_ID`, the owner's restart report, the P5 or rollback-verify
result); never from the live service or `events.log`. `r6-tuesday-handoff.sh` STOPs unless the outcome is unambiguous:
`released` needs `P3b RESULT BUILD PASS <id>` and `P5 RESULT ACCEPT PASS` and no `ROLLBACK RESULT`; `rolledback` needs
`ROLLBACK RESULT VERIFIED`; for both, the attested ID is not Sunday's and also appears in the record's own restart report;
`deferred` needs Sunday's ID and no `P4 RESULT PROMOTED` or `ROLLBACK RESULT`. Fixture records and fixture IDs exist only inside
the rehearsal's disposable containers and must never be written into the real record.

### R6 archive r3: workstation (Git Bash), before 09:25

```bash
CODE=9a9a01c195602e430d0d514e5fbe550eb77d0a9f
B=docs/v2/evidence/backlog-20261121
git -C /d/dev/afldb archive --format=tar --output=/tmp/afldb-r6-20261125-r3.tar "$CODE" \
  "$B/r6-20261125/r6-pre-verify.sh" \
  "$B/r6-20261125/r6-offhost-verify.sh" \
  "$B/r6-20261125/r6-post-verify.sh" \
  "$B/r6-20261125/r6-public-smoke.sh" \
  "$B/r6-20261125/r6-revalidate-accept.sh" \
  "$B/r6-20261125/r6-rawhead-check.sh" \
  "$B/r6-20261125/r6-tuesday-handoff.sh" \
  "$B/a1a2-20261124/a1-s9-public-smoke.sh" \
  "$B/a1a2-20261124/a1-rawhead.sh" \
  "$B/a1a2-20261124/a2-cron-observe.sh" \
  "$B/a1a2-20261124/a2-helper-install.sh" \
  "$B/kits/afldb-offhost-pull-daily.sh" \
  "$B/kits/scheduled-pull-evidence.sh" \
  "tools/maintenance/offhost-pull.sh" \
  "tools/maintenance/revalidate-season.ts" \
  "src/lib/acquisition/season-revalidation.ts" &&
  sha256sum /tmp/afldb-r6-20261125-r3.tar
```

### R6 archive r3: transfer (workstation Git Bash; one line per host; never at minute :16–:18)

The remote side writes with `noclobber`: if anything already exists at that path (a stale copy, or a file or link someone else
put there) the transfer fails instead of writing into it. Investigate before removing anything.

```bash
C:/Windows/System32/OpenSSH/ssh.exe -o BatchMode=yes -i C:/Users/stuar/.ssh/afldb_dev arm@10.0.40.100 'set -C; cat > /tmp/afldb-r6-20261125-r3.tar' < /tmp/afldb-r6-20261125-r3.tar
```

```bash
C:/Windows/System32/OpenSSH/ssh.exe -o BatchMode=yes afldb 'set -C; cat > /tmp/afldb-r6-20261125-r3.tar' < /tmp/afldb-r6-20261125-r3.tar
```

### R6 archive r3: staging and verification (run once on each host: workstation, production, streamanator)

Paste the block into a shell on that host, or pipe it there with `tr -d '\r' < block | ssh.exe … bash -s`. Record the printed
staging root. STOP unless the block prints 16 `: OK` lines and `R6 STAGE VERIFIED <path> (16 files)`. Manifest digest
`2c7ee8e2e1758f1002a36c4b75239d4ff4dea6958e7b2410a1f0253a38978007`. Every pin is the SHA-256 of the Git blob at the tested
revision (`git cat-file blob 9a9a01c195602e430d0d514e5fbe550eb77d0a9f:<path> | sha256sum`). Three differ from r2: `r6-pre-verify.sh`
(`0d9e97a5…` → `48185fca…`), `r6-rawhead-check.sh` (`cc8854f0…` → `7c3d0fc2…`) and the new `r6-tuesday-handoff.sh`. The other
thirteen are byte-identical to r2's, and Sunday's `a1-rawhead.sh` is still `cab4a43a…`.

```bash
B=docs/v2/evidence/backlog-20261121
STAGE=$(umask 077 && mktemp -d /tmp/afldb-r6-20261125-r3.XXXXXX) &&
  (umask 077 && cd "$STAGE" && tar -xf /tmp/afldb-r6-20261125-r3.tar &&
    [ ! -e R6-SHA256SUMS ] && [ ! -L R6-SHA256SUMS ] && cat > R6-SHA256SUMS) <<'R6_PINS' &&
48185fcaec83eff1cb26f1612febb32ba7d223f953cd4f6941fcc38c5eebebfb  docs/v2/evidence/backlog-20261121/r6-20261125/r6-pre-verify.sh
429eec29acf254179c3b7ae7d6489a6c695981fd90996c5c2ce1301314bcc18c  docs/v2/evidence/backlog-20261121/r6-20261125/r6-offhost-verify.sh
478f85cd8930199796c046ea43cdbaab7882921d286a3c9f6015c4a70cd5c66c  docs/v2/evidence/backlog-20261121/r6-20261125/r6-post-verify.sh
de84f1205b4ab4cfec182b1fb7b0770ca916c8570f10a14539daa9a4e450bd9e  docs/v2/evidence/backlog-20261121/r6-20261125/r6-public-smoke.sh
5e5ce991a5e4bf0875c49e01cc0f90db7da720a0f1c022507cec869d3cc067f0  docs/v2/evidence/backlog-20261121/r6-20261125/r6-revalidate-accept.sh
7c3d0fc295512a2f990bdbed24ae9ddb97a49f5f13e9bf01019ea3fa7e1f0543  docs/v2/evidence/backlog-20261121/r6-20261125/r6-rawhead-check.sh
92c1809b61473ab8d326b5a65bc1a30bb1eaf16e272ad0adf90a030ec039f9d8  docs/v2/evidence/backlog-20261121/r6-20261125/r6-tuesday-handoff.sh
babb660f7e7555a55281f2a0a07cb6d1147f39ebfa5ff9c119a677a1e2776a71  docs/v2/evidence/backlog-20261121/a1a2-20261124/a1-s9-public-smoke.sh
cab4a43af09e4b1729d913162c0f27faccd19315c56eb4ad1141c8bf748d81c0  docs/v2/evidence/backlog-20261121/a1a2-20261124/a1-rawhead.sh
2ac943b113af2247ab3acb3863e97201c8794ff830520338faa8b299268eeee5  docs/v2/evidence/backlog-20261121/a1a2-20261124/a2-cron-observe.sh
6c1b57e57c7dc57a6094f44354ba9cec91a1dec310e57b9fae371670be388e47  docs/v2/evidence/backlog-20261121/a1a2-20261124/a2-helper-install.sh
2ebac1c09b07e6b3bc1e060d7645efdbb1c2c7f169b5cfafd4e7f77508716e24  docs/v2/evidence/backlog-20261121/kits/afldb-offhost-pull-daily.sh
d7574254997ba28dd1f750b7bcdc6f90c0a421b88ba6bb02aa104bd671b8572e  docs/v2/evidence/backlog-20261121/kits/scheduled-pull-evidence.sh
a3775aea879b1d9ce05d0e96482e66d24c69deb62cf38e8fc0407c0d2653dc2b  tools/maintenance/offhost-pull.sh
20ee3b452da9cb025a938a75c3200f44101fb094c1ad4662e70673df3d96b14e  tools/maintenance/revalidate-season.ts
bd88c915c2643fc1bc8ec005c5c6825d43af0742b33ca83f0461e9348414dbc9  src/lib/acquisition/season-revalidation.ts
R6_PINS
  ([ -d "$STAGE" ] && [ ! -L "$STAGE" ] && cd "$STAGE" &&
    [ "$(sha256sum < R6-SHA256SUMS | cut -c1-64)" = 2c7ee8e2e1758f1002a36c4b75239d4ff4dea6958e7b2410a1f0253a38978007 ] &&
    [ -z "$(find . \( ! -uid "$(id -u)" -o -perm /022 -o \( -type f -links +1 \) \) -print)" ] &&
    [ "$(find . -mindepth 1 -printf '%y %p\n' | LC_ALL=C sort)" = "$(awk '{p = "./" $2; print "f " p; while (sub(/\/[^\/]+$/, "", p) && p != ".") print "d " p} END {print "f ./R6-SHA256SUMS"}' R6-SHA256SUMS | LC_ALL=C sort -u)" ] &&
    sha256sum -c R6-SHA256SUMS) &&
  printf 'R6 STAGE VERIFIED %s (16 files)\n' "$STAGE" ||
  { echo 'R6 STAGE STOP: do not use this staging root'; false; }
```

### R6 archive r3: re-check, immediately before each use (set `STAGE` to the recorded root first)

The verification lines are the staging block's own, unchanged. Run this block, and then the step, in the **same** shell on that
host, and run the step only after `R6 STAGE OK`.

```bash
([ -d "$STAGE" ] && [ ! -L "$STAGE" ] && cd "$STAGE" &&
    [ "$(sha256sum < R6-SHA256SUMS | cut -c1-64)" = 2c7ee8e2e1758f1002a36c4b75239d4ff4dea6958e7b2410a1f0253a38978007 ] &&
    [ -z "$(find . \( ! -uid "$(id -u)" -o -perm /022 -o \( -type f -links +1 \) \) -print)" ] &&
    [ "$(find . -mindepth 1 -printf '%y %p\n' | LC_ALL=C sort)" = "$(awk '{p = "./" $2; print "f " p; while (sub(/\/[^\/]+$/, "", p) && p != ".") print "d " p} END {print "f ./R6-SHA256SUMS"}' R6-SHA256SUMS | LC_ALL=C sort -u)" ] &&
    sha256sum -c R6-SHA256SUMS) &&
  echo "R6 STAGE OK $STAGE" || { echo "R6 STAGE STOP $STAGE"; false; }
```

### Wednesday A-2 with the attested InvocationID

On the workstation, after the re-check of the workstation's staging root, with `TUESDAY_RECORD` set to the committed Tuesday
sitting record:

```bash
bash "$STAGE/$B/r6-20261125/r6-tuesday-handoff.sh" "$TUESDAY_RECORD"
```

It must print `R6 HANDOFF RESULT PASS` and three values. Copy them exactly into `TUESDAY` (`tue:…`), `CURRENT_ID` and `ATTESTED`
(`inv:…`). Then on production, after the re-check of production's staging root in the same shell (`R4` with its `r4:` prefix;
`WINDOW` 10:00 or 14:00). When a step is sent from Git Bash with `ssh.exe`, pass the whole remote command as **one** quoted
string (as every line here does) or set `MSYS_NO_PATHCONV=1`: Git Bash rewrites a separate argument that starts with `/` (such
as a `/tmp/…` staging path) into a Windows path before `ssh.exe` sees it.

```bash
bash "$STAGE/$B/r6-20261125/r6-pre-verify.sh" accepted "$CURRENT_ID" r3:yes "$R4" "$WINDOW" "$TUESDAY" "$ATTESTED"
```

Expected: `PASS live InvocationID = the owner-attested …`, `PASS release.mjs status (read-only) …` and `R6 PRE RESULT PASS`,
exit 0. Anything else is STOP. Then set `B=docs/v2/evidence/backlog-20261121` and use only the staged copies, as §0's last
paragraph describes (A-1 and A-4 on streamanator after `a2-helper-install.sh check`; the F-4b PATH line is unchanged).

### What the private staging directory protects, and what remains

* **Protected.** `STAGE` is made by `mktemp -d` under `umask 077` (mode 0700 on Linux, owner arm on production) inside sticky
  `/tmp`. No other unprivileged user can rename, replace or remove it, or create, replace or modify anything in it. Both blocks
  check that it is a real directory owned by the running user, that nothing in it is group- or world-writable or hard-linked,
  that its entries and object types are exactly the pinned set, and that every byte matches the pins. The `/tmp` archive is never
  trusted: only the extracted, checked tree is. GNU tar strips a leading `/` and refuses `..` member names; the tree check then
  rejects any unexpected entry, including links. The transfer refuses an existing destination (`noclobber`).
* **Closed inside F-4.** `r6-rawhead-check.sh` executes the bytes it hashed, read once into memory.
* **Remains.** For every other step the operator runs `bash "$STAGE/…/script"`, so bash opens the path again after the re-check,
  and bash reads a script incrementally while it runs. A process running **as arm or as root** on that host could change a staged
  file between the re-check and execution, or during it. Those two principals already control the service, its `.env`, the
  release tree and `events.log`, so this adds no new principal; the runbook narrows the window to one shell by running the
  re-check immediately before each step. The scripts that locate their siblings through their own path (`r6-rawhead-check.sh`,
  `r6-revalidate-accept.sh`) cannot run from memory without changing that behaviour, so the remaining gap is documented, not
  closed. On the workstation (Git Bash on NTFS) mode bits are emulated (`mktemp -d` shows 0755): the owner, type, link and hash
  checks still apply; the workstation is single-user.
* **Pins.** The manifest's authority is its digest printed here at the review commit. The pins were taken from Git blobs at
  the tested revision; the review record lists the command.

**Rehearsal (streamanator and workstation, disposable, production not contacted):**
[review-fixes-r3-20261124/README.md](r6-20261125/review-fixes-r3-20261124/README.md).
