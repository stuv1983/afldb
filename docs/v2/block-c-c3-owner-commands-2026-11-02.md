# ISSUE-316 C3: the owner's copy-ready commands to install the four AFL API units inert (2026-11-02)

**Status: PREPARED. NOTHING WAS RUN.** No SSH session was opened for this document, no unit file was installed, no `daemon-reload`, `systemctl`, timer, `.env`, setting, restart or provider action was taken, and `c3-pre` was **not** run (the owner's instruction for this task was to prepare, not execute). This file only re-reads [the Block C package](block-c-execution-package-2026-11-02.md) section 5 against the repository and turns it into one ordered block. Where the two differ, the package and its pinned script `evidence/block-c-package-20261102/c-prod.sh` govern.

**C3, C4b and C5 stay distinct.** C3 is a file install. It starts nothing, enables nothing, contacts no provider and writes no setting. C4b (the D1 rehearsal, which does contact the provider and flips the switch for the run) and C5 (the `.env` line, restart, switch and match timer) are separate approvals and are **not** part of this block; section 6 lists what this block must leave untouched.

## 1. Pinned facts, re-derived today from the repository

| Item | Value |
|---|---|
| Revision `R` | `ea98a35f20610e75c18e698bc0d9fe084c3c783d` (production's checkout `HEAD`, clean, the release serving; it is an ancestor of `origin/main`) |
| Package is in `R` | `docs/v2/evidence/block-c-package-20261102/c-prod.sh` was added at `f123311d`, an ancestor of `R`, so the `git archive "$R"` staging command below works on the host |
| The six deploy files | the sha256 of each file **at `R`** equals the pin in `c-prod.sh` (`PINS`), and `git diff R HEAD -- deploy` is empty; values below |
| Units now | not installed on production (no `/etc/systemd/system/afldb-settle-afl-api*`); this is what `c3-pre` proves on the host. The read-only writer listing inside today's post-E backup capture (2026-11-02T03:54Z, [`capture-recon.sh`](evidence/gap016-recon-20261102/capture-recon.sh)) recorded all four as `inactive`, `enabled=not-found` (and `afldb-email-intake` likewise absent, the AFL Tables timer `disabled`/`inactive`) |
| Switch | `acquisition.afl_api_current_season_enabled` absent or `false` |
| AFL Tables | timer `disabled`; `data/reference/afltables-network.json` `retired` |

| File (under `deploy/`) | sha256 (full, from `c-prod.sh` `PINS`, equal at `R`) |
|---|---|
| `afldb-settle-afl-api.service` | `8698b6860ddf530b4954f0cbd585acddf38d12ec2a0436d1553d85ae7471b7f4` |
| `afldb-settle-afl-api.timer` | `a37114b44eab72d4bc85e15f059a6d7f837f0d503b07f4e0c9934e39bac2a2c2` |
| `afldb-settle-afl-api-brownlow.service` | `55b0a70b8aba516e48231f4fb8ad1576b7c1c1579218b03e9f9bcd6915e7b402` |
| `afldb-settle-afl-api-brownlow.timer` | `7fa27377516ce9ea86400542166788727179effbd1b2692397506b3a42903bb1` |
| `afldb-settle-afl-api.sh` | `b35e3a321a2c276ee4ff0b3f1cfed4dce4afcdfef78d1d7f41e6eb3ef142aeeb` |
| `afldb-settle-afl-api-brownlow.sh` | `05a559be858633ddbbf099ec4fcd809a5b8fbf0116c2ce83ae6477f73efff9b1` |

A records defect was found and fixed while doing this: the abbreviated hashes in the Block C package section 1 carried two typing errors (`55b0a70b…7402` is `…b402`; `7fa27375…3bb1` is `…27377…3bb1`). The script's pins, which are what the gate compares, were always correct; only the abbreviations in the document changed.

## 2. Why installing these files cannot start anything (from the unit files themselves)

* The two `.service` units are `Type=oneshot` with **no `[Install]` section**: nothing can enable them, and they run only if something starts them.
* The two `.timer` units have `[Install] WantedBy=timers.target`, which takes effect **only** on `systemctl enable`; `install` plus `daemon-reload` creates no `*.wants` symlink and arms no timer. (The nightly timer has `Persistent=true`; that matters only after C5 enables it.)
* `daemon-reload` re-reads unit files; it does not restart `afldb.service` or any running unit. The checks below record `afldb.service` `MainPID` before and after to prove it.
* The service units read `/home/arm/projects/afldb/.env` through `EnvironmentFile`. Installing them does not edit that file. `AFLDB_SETTLE_TRIGGER` is **absent** and stays absent until C5.

## 3. Step 0: stage the package from `R`'s own bytes (as `arm`; writes one new mode-700 directory)

```bash
R=ea98a35f20610e75c18e698bc0d9fe084c3c783d
PKG=docs/v2/evidence/block-c-package-20261102
PKGD=/home/arm/blockc-pkg-${R:0:12}/$PKG
CHK=/home/arm/projects/afldb
( set -euo pipefail; mkdir -m 700 "/home/arm/blockc-pkg-${R:0:12}"; git -C "$CHK" archive "$R" "$PKG" | tar -x -C "/home/arm/blockc-pkg-${R:0:12}" )
test "$(git -C "$CHK" rev-parse HEAD)" = "$R" && test -z "$(git -C "$CHK" status --porcelain)" && echo "checkout is R and clean"
```

If `mkdir` reports the directory exists, a previous session staged it: confirm `sha256sum "$PKGD/c-prod.sh"` equals `git -C "$CHK" show "$R:$PKG/c-prod.sh" | sha256sum` rather than extracting over it.

## 4. Step 1: read-only before-state (as `arm`)

```bash
bash "$PKGD/c-prod.sh" c3-pre "$R"        # must end: C3-PRE PASS
# before-state for the later comparison (all read-only):
echo "afldb.service MainPID before: $(systemctl show -p MainPID --value afldb.service)  NRestarts=$(systemctl show -p NRestarts --value afldb.service)"
systemctl list-unit-files 'afldb-settle-afl-api*' --no-pager      # expect: 0 unit files listed
ls -la /etc/systemd/system/ | grep -c 'afldb-settle-afl-api' || true   # expect: 0
echo "trigger variable lines in .env (count only): $(grep -c '^AFLDB_SETTLE_TRIGGER' "$CHK/.env" || true)"   # expect: 0
```

Stop if `c3-pre` does not print `C3-PRE PASS`, or any count above is not 0. Nothing has been changed yet.

## 5. Step 2: the install (owner, sudo; the only state-changing block)

Approval words, from package section 8 (the owner writes them): *"I approve installing the four AFL API unit files inert on `afldb-prod` at revision `ea98a35f20610e75c18e698bc0d9fe084c3c783d`: the six files in docs/v2/block-c-execution-package-2026-11-02.md section 1 with their pinned hashes; no unit started or enabled, no setting changed."*

```bash
cd /home/arm/projects/afldb
sudo install -m 0644 -o root -g root deploy/afldb-settle-afl-api.service deploy/afldb-settle-afl-api.timer deploy/afldb-settle-afl-api-brownlow.service deploy/afldb-settle-afl-api-brownlow.timer /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemd-analyze verify /etc/systemd/system/afldb-settle-afl-api.service /etc/systemd/system/afldb-settle-afl-api-brownlow.service     # no output = pass
```

Do **not** run `enable`, `start`, `restart`, `enable --now`, `systemctl edit` or anything that touches `.env` or a setting. Those belong to C5.

## 6. Step 3: proof they remain disabled and inactive (as `arm`, read-only)

```bash
bash "$PKGD/c-prod.sh" c3-accept "$R"     # two passes, a minute apart; must end: C3-ACCEPT PASS
# independent confirmation, outside the script:
for u in afldb-settle-afl-api.service afldb-settle-afl-api-brownlow.service; do printf '%s load=%s active=%s\n' "$u" "$(systemctl show -p LoadState --value $u)" "$(systemctl is-active $u)"; done        # expect: loaded / inactive
for u in afldb-settle-afl-api.timer afldb-settle-afl-api-brownlow.timer; do printf '%s enabled=%s active=%s next=[%s]\n' "$u" "$(systemctl is-enabled $u)" "$(systemctl is-active $u)" "$(systemctl show -p NextElapseUSecRealtime --value $u)"; done   # expect: disabled / inactive / next=[]
systemctl list-timers --all --no-pager | grep -c 'afldb-settle-afl-api' || true       # expect: 0 (a disabled, inactive timer is not scheduled)
ls -la /etc/systemd/system/timers.target.wants/ 2>/dev/null | grep -c 'afl-api' || true   # expect: 0 (no enable symlink)
for f in afldb-settle-afl-api.service afldb-settle-afl-api.timer afldb-settle-afl-api-brownlow.service afldb-settle-afl-api-brownlow.timer; do cmp "/etc/systemd/system/$f" "$CHK/deploy/$f" && echo "$f installed copy equals the repository file"; done
echo "afldb.service MainPID after: $(systemctl show -p MainPID --value afldb.service)  NRestarts=$(systemctl show -p NRestarts --value afldb.service)"    # expect: the same MainPID and NRestarts as before
echo "trigger variable lines in .env (count only): $(grep -c '^AFLDB_SETTLE_TRIGGER' "$CHK/.env" || true)"       # expect: 0
test -z "$(git -C "$CHK" status --porcelain)" && echo "checkout still clean"
```

**C3 passes only if** `C3-ACCEPT PASS` printed, both services are `loaded`/`inactive`, both timers are `disabled`/`inactive` with an empty next-elapse and not in `list-timers`, there is no `timers.target.wants` entry, every installed copy equals its repository file, `afldb.service` has the same `MainPID` and `NRestarts`, and the trigger count is 0. Run the `c3-accept` block again once more some minutes later if the owner wants a second observation; it is idempotent and read-only.

**Reversal (inert files only; owner sudo), unchanged from the package:**

```bash
sudo rm /etc/systemd/system/afldb-settle-afl-api{,-brownlow}.{service,timer}
sudo systemctl daemon-reload
```

An enabled or active Brownlow timer at any point is a C3 failure: stop, do not "fix" it forward; use the reversal and report.

## 7. What C3 leaves untouched (so it cannot be mistaken for C4b or C5)

| Not part of C3 | Where it lives |
|---|---|
| Provider contact, the 2027 snapshot, the dry-run with `--auto-apply`, switching `acquisition.afl_api_current_season_enabled` on and back | **C4b** (D-316-13), package section 6; needs C3 accepted and Block M-a complete (it is) |
| The `AFLDB_SETTLE_TRIGGER=systemd` line, `systemctl restart afldb`, the admin switch toggle, `systemctl enable --now afldb-settle-afl-api.timer` | **C5** (D-316-4), package section 7 |
| Any baseline taken before C4b/C5 | C4b and C5 write `site_settings` and `auth_audit_log`; **C3 writes neither**, so C3 does not move the Brownlow baseline (production's post-E baseline stays `43300297…821d` through C3) |
| DEV timers on streamanator | a separate decision, never inspected or changed by this block |

## 8. The one thing the owner must supply

The window for the `sudo` block in section 5. Steps 0, 1 and 3 are read-only (step 0 writes only its own mode-700 staging directory) and can be run by the owner or by Claude over SSH as `arm` once the owner says so; the `sudo` block is the owner's alone.
