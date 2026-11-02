# ISSUE-316 C3 outcome: four AFL API units installed inert on afldb-prod (2026-11-02)

**Status: C3 INSTALLED AND ACCEPTED. No later step was taken.** Under the owner's approval of C3 (package [block-c-c3-owner-commands-2026-11-02.md](block-c-c3-owner-commands-2026-11-02.md) and the pinned [Block C package](block-c-execution-package-2026-11-02.md)), at revision `ea98a35f20610e75c18e698bc0d9fe084c3c783d`, the four unit files were installed on `afldb-prod` by the owner's `sudo` block. Nothing was enabled, started, restarted or removed; no setting, `.env` or provider was touched; C4b and C5 remain unapproved.

Evidence: [`evidence/block-c-c3-20261102/`](evidence/block-c-c3-20261102/) (the two read-only scripts Claude ran over SSH as `arm`, and the three outputs).

## 1. Sequence and times (UTC, 2026-11-02)

| Time | Step | Who | Result |
|---|---|---|---|
| 05:06 | Staging from `git archive` of R (directory `/home/arm/blockc-pkg-ea98a35f2061`, mode 700, did not exist, created) | Claude, SSH as `arm` | `c-prod.sh` and `c-selftest.sh` byte-identical to R's git objects |
| 05:06 | Six deploy files: `git show R:deploy/<f>` hash vs the checkout file vs the `c-prod.sh` pins | Claude | all six equal the pins |
| 05:06 | `c3-pre` | Claude | **`C3-PRE PASS`**: checkout exactly R and clean; identity `afldb_prod` OID 66668; switch `false`; all four units `not-found`/inactive; AFL Tables timer disabled/inactive; `sh -n` ok |
| 05:06 | Before-state | Claude | `afldb.service` MainPID **3268373**, NRestarts **0**, active since 2026-11-02 13:18:50 AEDT; 0 unit files listed; 0 files under `/etc/systemd/system`; 0 `timers.target.wants`; 0 in `list-timers`; `AFLDB_SETTLE_TRIGGER` lines in `.env`: 0 |
| (owner's window) | `sudo install -m 0644 -o root -g root` of the four files; `daemon-reload`; byte, ownership and `systemd-analyze verify` checks | **Owner, sudo** (Claude used none) | 4/4 pinned-hash OK before and after install; `644 root:root`; `systemd-analyze verify` printed nothing; services `loaded`/`inactive`; timers `loaded`/`disabled`/`inactive` |
| 05:19-05:21 | `c3-accept` (two passes a minute apart) plus independent read-backs | Claude | **`C3-ACCEPT PASS`**; see section 2 |

The owner's terminal paste echoed the typed commands out of order (a terminal rendering effect); only the result lines were taken as evidence, and every gate was re-derived independently afterwards.

## 2. Acceptance gates (all met)

| Required | Observed (05:19-05:21Z) |
|---|---|
| Installed files byte-identical to the pinned files | `cmp` against the checkout OK for all four, and each installed file's hash equals the sha256 of `git show R:deploy/<f>`; `c-prod.sh` also compared installed vs checkout twice |
| Both services loaded and inactive | `load=loaded active=inactive sub=dead` for both |
| Both timers disabled and inactive, no scheduled elapse, no enable symlink | `enabled=disabled active=inactive`, `NextElapseUSecRealtime=[]`, `NextElapseUSecMonotonic=infinity`; 0 matches in `list-timers --all`; 0 in `timers.target.wants`; 0 symlinks named `afldb-settle-afl-api*` anywhere under `/etc/systemd/system` |
| Acquisition still off, trigger variable absent | setting `false` on both passes; `AFLDB_SETTLE_TRIGGER` lines: 0 |
| Application PID and restart count unchanged | MainPID **3268373** and NRestarts **0**, before and after; same `ActiveEnterTimestamp`; `ActiveState=active` |
| Checkout still clean | HEAD `ea98a35f…`, `git status --porcelain` empty |
| Also | AFL Tables timer `disabled`/`inactive`; failed `afldb-settle-afl-api*` units: 0 |

## 3. What this did not change

No provider contact; no `site_settings` or `auth_audit_log` write (so production's Brownlow baseline stays `43300297…821d`); no `.env` edit; no restart; no unit started or enabled; no DEV (streamanator) action; no push or cleanup. Backups, retained releases, quarantined stores, frozen P/H/EXEC, `.codex/`, archived source work and parked ISSUE-327 were left alone.

## 4. Residue on the host (for later cleanup, not removed)

| Path | Nature |
|---|---|
| `/home/arm/blockc-pkg-ea98a35f2061/` | the staged package (mode 700); verified against R, kept |
| `/home/arm/c3-stage-pre-20261102.sh`, `/home/arm/c3-accept-readback-20261102.sh` | the two read-only helper scripts (copies are in the evidence directory) |

## 5. Reversal (inert files only; owner sudo), unchanged

```bash
sudo rm /etc/systemd/system/afldb-settle-afl-api{,-brownlow}.{service,timer}
sudo systemctl daemon-reload
```

## 6. Open and next

* **Public rendering check of the Brownlow publication** on `beta.afldb.com`: unverified, owner-led, not a C3 dependency. No login windows are being opened until the owner says they are ready.
* **Next:** the D-316-13 / C4b approval, prepared in [block-c-c4b-approval-2026-11-02.md](block-c-c4b-approval-2026-11-02.md). It is **not granted** and nothing in it has been run.
