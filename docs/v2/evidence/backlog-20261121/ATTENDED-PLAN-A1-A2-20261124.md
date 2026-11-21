# Attended runbook: sittings A1 and A2, Tuesday 24 November 2026 (APPROVED SCOPE; prepared 22 Nov, run c; NOT EXECUTED)

**Supersedes** `ATTENDED-DRAFT-20261122b.md` for A1 and A2 (the draft stays as the record of the proposal). **Authority:** owner
decisions 2 and 3 of 2026-11-22 (`DECISIONS-20261122c.md` §2-§3): A1 10:00-10:30 AEDT, release of the exact DEV-verified
candidate `7d92042f`, the owner performs the production restart; A2 10:30-12:00 AEDT after A1 passes: R1, R2 (forced-command key
and the FIRST MANUAL RUN ONLY), R3 (scheduled backups and the off-host pull), R4 (combined Caddy install). Every `sudo` step is the
owner's, **one block at a time**. Nothing else is in scope: not R5 disposal (logs retained; only the access restriction of §4.5a),
R6 (reboot), R7 (databases retained), R8, the ISSUE-348 load or the R2 notifier marker.

**Revision 2026-11-22 (run d, owner decisions round 3, `DECISIONS-20261122d.md`).** (1) PREP is no longer a fixed commit: it is the
`origin/main` tip the owner confirms at the start of the session (§0). (2) The two streamanator cron jobs are APPROVED and installed in
A2 after their preconditions (§4.2 step 3, §4.3 step 13, §4.6). (3) R5: the pre-fix Caddy logs are retained with restricted access
(§4.5a, after R4). (4) A1 timing: **T-1 APPROVED** by the owner on 22 Nov (start 09:20; §1, `A1-TIMING-OPTIONS.md`); the pre-window work is approved. (5) The R4 owner log check is count-only (§4.4 step 10).

**Prepared without production contact.** Production facts come from `R0-SITTING-20261122.md` (read-only probe 2026-11-22 02:52
AEDT), `OWNER-PACKET.md` §3, `kits/KITS-20261122.md` and `RC-371-372.md` (revised 22 Nov, run c). The pre-window probe re-reads
every one of them; **any difference from an expected value is a STOP.** Scripts: `a1a2-20261124/` (this folder). Each has its
contract in its header; `bash -n` clean; the streamanator-side restore, the key-line append (against a scratch copy) and the
raw-head probe's JavaScript (`node --check`) were exercised on streamanator on 22 Nov; nothing was run against production.

## 0. Pins

| Pin | Value |
|---|---|
| `origin/main` (PREP) | **the `origin/main` tip the owner confirms at the start of the Tuesday session**: `da4cc0c459f469d3b1a798302f8fe394962a395f` on 2026-11-22 (run c pushed); if anything is pushed before A1, the owner names the final tip in the first message. Rule: PREP must descend from CAND `7d92042f` (W0 here, P2 on the host). What `7d92042f..PREP` changes is irrelevant to A1: P2 fast-forwards the checkout to CAND exactly and `release.mjs build` archives CAND by `git archive`; the session records `git diff --name-only 7d92042f PREP` (workstation) for the report. (Was `731a5025`, stale since the 22 Nov push.) |
| Candidate (CAND) | `7d92042fd11010eaa20966e2f49ae7a93e286568`; release id will be `7d92042fd110-<BUILD_ID>` |
| Tested application revision | `cf158d602242a3e7bbf899b951e8423c0d3521e6`; executable tree (ls-tree minus `docs/`, `documentation/`, `issues/`, root `*.md`) sha256 `a18ccac4…e789` = CAND's |
| Serving now / rollback target | `c8d4202a4cb3-aATnIlFOIQjq2z5oDdoHC` (checkout `c8d4202a…`); previous BUILD_ID `aATnIlFOIQjq2z5oDdoHC` |
| `previous` link now | `a2e6ea9995a4-aKAYwf0qC4go6JJWiHhv5` |
| Reviewed delta `c8d4202a..CAND` | 153 paths of `git diff --raw --no-abbrev --no-renames` (not `--name-only`, which detects renames: 144), sha256 `b93a294a…91e3`; 13 non-records paths, sha256 `fe9285f6…7dee` (list in `a1-p2-ff.sh`); no migration, dependency, Next config, unit or supervisor change |
| Ledger head | `118_fixtures_unconfirmed_participants.sql` (118 rows) |
| A2 file pins (equal at `c8d4202a` and CAND) | settle-status `d80838cb…`, host policy `183691d9…`/`4a277b8b…`, `Caddyfile.production` `f00859d5…086d`, installed Caddyfile now `4f6972ec…7af036`; full list in `a2-p0-entry.sh` |

**Transport (production).** From the workstation, one connection per step, no automatic retries, no rapid reconnects (the
home IPS blocks bursts of SSH):
`tr -d '\r' < <script> | C:/Windows/System32/OpenSSH/ssh.exe -o BatchMode=yes afldb bash -s -- <args>`.
The owner runs his `sudo` blocks in his own interactive session. **streamanator:** `ssh -o BatchMode=yes -i ~/.ssh/afldb_dev arm@10.0.40.100`.

## 1. Times (AEDT, Tue 24 Nov 2026 = Mon 23 Nov 23:00Z onward)

**Avoid:** 02:10-02:40 and Wednesday 03:20-03:45 once R3 is installed (first scheduled backup Wed 25 Nov 02:20, first
verification Wed 25 Nov 03:30); 04:50-05:45 (AFL API settle); 05:45-07:15 (`apt-daily-upgrade` plus random delay; `host-gate`
enforces its margin). The window is clear of all of these.

**Time budget: T-1 APPROVED (reviewer F-004).** **T-1 APPROVED** (owner decision of 2026-11-22, written, relayed by the main session): start **09:20 AEDT on Tue 24 Nov 2026**. The window change is approved: 09:20-09:30 read-only P1 + raw-head baseline; 09:30-09:55 P2 fast-forward of the production checkout to `7d92042f` exactly, P3 build, P3b; 10:00 promote, env, owner restart; A2 starts 10:30, R4 after P6 ends (about 10:45); the latest-restart rule stays 10:45. `release.mjs build` takes about 15-25 minutes, so build, promote,
env, restart and acceptance do not fit 10:00-10:30; the comparison is kept in `A1-TIMING-OPTIONS.md`. The T-2 column below is the
record of the rejected alternative only.

| | **Option T-1 (APPROVED 22 Nov; start 09:20)**: P2/P3 from 09:30 | Option T-2 (not chosen; record only) |
|---|---|---|
| 09:20-09:30 | P1 + raw-head baseline (read-only) | P1 + raw-head baseline (read-only) |
| 09:30-09:55 | P2 checkout ff (changes the checkout only), P3 build (loads the host, serves nothing new), P3b | — |
| 10:00-10:10 | P4 promote, E1-E3 env, **RESTART** | P2, P3 starts (to about 10:25) |
| 10:10-10:20 | P5 accept, raw-head check, S9, P6 starts (30 min, to about 10:45) | P3b, P4 promote about 10:27, E1-E3, **RESTART about 10:32** (overruns the slot) |
| A2 starts | 10:30 (R4 after P6 ends, about 10:45) | about 10:45 after P5 (R4 after P6 ends, about 11:15); R3's streamanator restore may finish after 12:00 (no production contact) |
| Decision point | 09:55: P3b not PASS → build continues; promote no later than 10:15 | 10:35: P3b not PASS → **stop before promotion** (production unchanged), reschedule A1 |

Under T-1 nothing served changes before 10:00. Under T-2 the restart falls 2-5 minutes after the slot; the owner accepts that or
stops before promotion. **Latest restart either way: 10:45**; later than that, stop before promotion and reschedule.

## 2. Pre-window, read-only (both options)

| # | Step | Pass |
|---|---|---|
| W0 | Workstation only (no production command): `git fetch origin`; `git ls-remote origin refs/heads/main` = PREP (the owner-confirmed tip); `git rev-parse 7d92042f^{commit}` resolves; `git merge-base --is-ancestor 7d92042fd11010eaa20966e2f49ae7a93e286568 PREP` exit 0; record `git diff --name-only 7d92042f PREP` (count and the non-records paths) for the report | equal; ancestor |
| W1 | `a1-p1-precheck.sh <PREP>` | `P1 RESULT PASS`: links as §0, checkout `c8d4202a` clean, `host-gate` PASS (warnings: reboot pending, needrestart hold missing), no apt/writer, ≥ 2,100 MB available, ≥ 6 GB disk, `AFLDB_WORKERS=2`, **both revalidation names absent (counts 0)**, `.env` ends with a newline, ledger 118, 2026 Brownlow revision 3 (183 rows, 1,242 votes, 14 ineligible). Record MainPID, InvocationID and the previous BUILD_ID it prints |
| W2 | `a1-rawhead.sh baseline` | `RAWHEAD RESULT baseline PASS`; writes `/home/arm/a1-rawhead-baseline.json` (title and robots per page; controls recorded) |
| W3 | Owner present with the sudo password and a second terminal; streamanator reachable | — |

Any W-step FAIL: STOP before P2; production unchanged.

## 3. Sitting A1: release `7d92042f` (ISSUE-371, ISSUE-372)

| # | Step | Who | Pass / stop |
|---|---|---|---|
| P2 | `a1-p2-ff.sh <PREP>` (fetch; ff to **CAND exactly**, never `origin/main`) | Claude | `P2 RESULT PASS`: every delta pin of §0, cf158d60..CAND records-only, executable tree = cf158d60. Any STOP line: production unchanged; a checkout left at CAND is harmless |
| P3 | `a1-p3-build.sh`, then `a1-p3b-build-check.sh <LOG>` | Claude | `P3b RESULT BUILD PASS <NEW_ID>` **only if** the id starts `7d92042fd110-` **and** `release.json` `revision` is the full CAND sha. Otherwise: **STOP before promotion** and report (owner decision 2). One retry only if the cause is understood and needs no code or data change |
| P4 | `a1-p4-gate-promote.sh <NEW_ID>` (owner present) | Claude | `P4 RESULT PROMOTED`. Gate refusal: wait, re-run; never `--skip-host-gate` |
| E1-E3, RESTART | owner blocks, §3.1 | **Owner** | each block's own check |
| P5 | `a1-p5-accept.sh <NEW_ID> <new InvocationID>` | Claude | `P5 RESULT ACCEPT PASS (1-4)` |
| P5b | `a1-rawhead.sh check` | Claude | `RAWHEAD RESULT check PASS` |
| S9 | workstation: `bash a1-s9-public-smoke.sh <NEW BUILD_ID>` | Claude | `S9 RESULT PASS` |
| P6 | `a1-p6-observe.sh <NEW_ID>` (one connection, about 31 min, background) | Claude | `P6 RESULT OBSERVATION PASS (4 ticks)`; at its end the owner runs `sudo journalctl -u afldb -p err --since "<restart time>" --no-pager` once (arm may not read the journal) and reports the line count |

### 3.1 Owner: env, then restart (secret-safe; reviewer F-002). One block at a time, as `arm` in `/home/arm/projects/afldb`

The secret is generated on the host straight into `.env`; it never appears on a command line, in a terminal or in a record.
Never `cat`, `grep` without `-c`, `set -x`, or `env` on `.env` or `/proc/*/environ`.

**E1 (backup and pre-check):**
```bash
cd /home/arm/projects/afldb
B=~/env-before-revalidate-$(date -u +%Y%m%dT%H%M%SZ).bak; cp -p .env "$B" && chmod 600 "$B" && echo "backup $B"
tail -c1 .env | wc -l                                   # must print 1 (ends with a newline)
grep -c '^AFLDB_REVALIDATE_URL=' .env; grep -c '^AFLDB_REVALIDATE_SECRET=' .env   # must print 0 and 0
wc -l < .env                                            # note N
```
Stop if any value differs. **E2 (append):**
```bash
echo "AFLDB_REVALIDATE_URL=http://127.0.0.1:3100" >> .env
echo "AFLDB_REVALIDATE_SECRET=$(openssl rand -hex 32)" >> .env
```
**E3 (check; gates the restart):**
```bash
grep -c '^AFLDB_REVALIDATE_URL=' .env; grep -c '^AFLDB_REVALIDATE_SECRET=' .env   # 1 and 1
wc -l < .env                                            # N + 2
grep -E "^PORT=" .env                                   # nothing (default 3100) or exactly PORT=3100; anything else: stop, the URL must name the app port
```
On any E3 mismatch: `cp -p "$B" .env`, **no restart**, stop (the release stays promoted on the old process until a decision;
`release.mjs status` will report the pending restart). **RESTART (its own block, only after E3 passes):**
```bash
sudo systemctl restart afldb
systemctl show afldb -p InvocationID -p ActiveState -p NRestarts --no-pager      # give Claude the InvocationID
```
The production AFL API settle units keep `UnsetEnvironment=… AFLDB_REVALIDATE_SECRET` (D-232-3); no `deploy/*` unit changes.
The backup `~/env-before-revalidate-*.bak` holds every production secret: it is listed in `OPEN-ITEMS-AFTER-SITTINGS.md` with a
disposal step (shred after A1 is accepted and the owner no longer wants the fallback).

### 3.2 Rollback (application only; never touches data)

**Triggers:** unit not active after one `reset-failed`; P5 check 1 or 2 FAIL; S9 5xx or the 503 gate message; journal errors; a
raw-head control misbehaving (an anonymous 200 where a 404 is expected, or a 5xx); a P6 tick not OK. **Not a trigger by itself:**
P5 check 3 or 4 (environment counts, the CLI's exit 1 or 2): the site serves correctly; record and take it to the owner; never
restart again to "fix" it. Sequence: `a1-rollback.sh links` → owner `sudo systemctl restart afldb` → `a1-rollback.sh verify
<InvocationID> <NEW BUILD_ID>` → `a1-rawhead.sh check` (title/robots equal the c8d4202a baseline; `/brownlow/2026` still shows the
published winner). The env lines are harmless under `c8d4202a` (`RC-371-372.md` §4); removing them is optional and needs its own
attended restart. The checkout stays at CAND (harmless).

### 3.3 A1 outcomes and the A2 entry condition (reviewer F-005)

| A1 outcome | Expected at A2 entry (`a2-p0-entry.sh <outcome> [NEW_ID]`) | A2 may start? |
|---|---|---|
| **accepted** (P5, P5b, S9 PASS; P6 running) | HEAD CAND; `current` NEW_ID; `previous` `c8d4202a…`; env counts 1/1 | yes; R4 only after P6 PASS |
| **stopped before promotion** | HEAD `c8d4202a` or CAND; `current` `c8d4202a…`; `previous` `a2e6ea99…`; env 0/0 | yes (A2 does not depend on A1), if the owner agrees; the packet's `status --expect c8d4202a…` texts apply unchanged |
| **rolled back** | HEAD CAND; `current` `c8d4202a…`; env as left | only after the rollback verify PASS and the owner's explicit go; R4 still last |

In every outcome the A2 files are byte-equal at `c8d4202a` and CAND (pins in `a2-p0-entry.sh`), so the forced-command script, host
policy and Caddyfile hashes in the packet hold. **Re-pinned packet texts:** R1's after-restart check becomes `status --expect
<whatever current is> --confirm-restart-invocation <InvocationID>`; R4's approval text binds the file sha256
`f00859d5c834be09f064d516ea4fa12612da379e377128e784b3523016a6086d`, not the commit (`c8d4202a` and CAND carry the same blob).

## 4. Sitting A2: R1, R2, R4, R5 restriction, R3 (no outage expected; order per §4.5)

**A2 P0:** `a2-p0-entry.sh <outcome> [NEW_ID]` → `P0 RESULT PASS (<outcome>)`. It also records kernel, reboot-required, GRUB, the
timers, settle status, authorized-keys counts (expect 0 and 0), Caddy sha (`4f6972ec…`), `/var/log/caddy`, slugs 0 bad,
`max(matches.id)` < 20,000, the stale databases, and `afldb_restore_test` with `numbackends` 0. Safe boundary after every R.

### 4.1 R1 host patching policy (ISSUE-351; procedure 02 §5-§6) — about 10 min

Owner, one block at a time, in `/home/arm/projects/afldb`:
1. `sha256sum deploy/host-policy/needrestart-afldb-hold.conf deploy/host-policy/apt-52-afldb-unattended.conf` → `183691d9…`, `4a277b8b…`
2. `sudo install -m 0644 -o root -g root deploy/host-policy/needrestart-afldb-hold.conf /etc/needrestart/conf.d/50-afldb-hold.conf`
3. `sudo install -m 0644 -o root -g root deploy/host-policy/apt-52-afldb-unattended.conf /etc/apt/apt.conf.d/52-afldb-unattended`
4. `sudo needrestart -r l` → lists only; `afldb`/PostgreSQL shown as owed, **nothing restarts**
5. `apt-config dump | grep -i -A5 'Package-Blacklist'` → the four postgresql names
6. `sudo unattended-upgrade --dry-run --debug 2>&1 | grep -iE 'blacklist|postgres'`
7. As arm (Claude, one connection): `node deploy/release.mjs host-gate --strict` → records "needrestart holds afldb and postgresql" (a
   reboot-pending warning is expected and is not an R1 failure)

**Acceptance:** all as stated. **STOP/recovery:** if step 4 would restart `afldb` or PostgreSQL automatically, or 5/6 do not show the
blacklist: `sudo rm /etc/needrestart/conf.d/50-afldb-hold.conf /etc/apt/apt.conf.d/52-afldb-unattended` (policy not installed).

### 4.2 R2 failure visibility: first manual run, then the hourly job (ISSUE-332; procedure 04 §4) — about 18 min

1. Claude: `a2-keyline.sh settle` → `KEYLINE RESULT PASS settle`, fingerprint `SHA256:bXNU+c3pIBNqI/hjKeWVGX0Sm3QPjphZUGDfEQ+W5bU`.
2. streamanator (Claude): `sha256sum /home/arm/afldb-ops/afldb-settle-check.sh` = `c6467ff492afe0e1f28117baf5c4fa2a38edaf8e8f13bf3cacd72ef22b224896`, then
   **once**: `sh /home/arm/afldb-ops/afldb-settle-check.sh; echo rc=$?` → `rc=0` and `rc=0 AFLDB_SETTLE_STATUS OK` in
   `/home/arm/afldb-ops/state/settle-check.log`.

3. streamanator (Claude), **only after step 2 PASSES** (owner decision 3, round 3): `bash a2-cron-install.sh check r2` then
   `bash a2-cron-install.sh install r2` (piped: `tr -d '\r' < a2-cron-install.sh | ssh … arm@10.0.40.100 bash -s -- install r2`) →
   `CRON INSTALL r2 PASS: next due <Melbourne time>`; record the next due time. It refuses unless the last `settle-check.log` line is
   step 2's `rc=0 AFLDB_SETTLE_STATUS OK` (at most 6 h old), the wrapper is `c6467ff4…` and the sender is executable; a re-run prints
   `ALREADY INSTALLED`; it keeps a 0600 pre-image `state/crontab.pre-a2-r2-install-<STAMP>`. Line installed (with its marker comment):
   `17 * * * * AFLDB_ALARM_CMD=/home/arm/afldb-ops/alarm-email.sh /bin/sh /home/arm/afldb-ops/afldb-settle-check.sh`.
4. streamanator (Claude), **cron-environment alarm test (reviewer F-005; the owner watches his inbox)**: once,
   `env -i HOME=/home/arm LOGNAME=arm SHELL=/bin/sh PATH=/usr/bin:/bin AFLDB_PROD_SSH=arm@afldb-nonexistent.invalid AFLDB_OPS_STATE=/home/arm/afldb-ops/state/a2-cronenv-test AFLDB_ALARM_CMD=/home/arm/afldb-ops/alarm-email.sh /bin/sh /home/arm/afldb-ops/afldb-settle-check.sh; echo rc=$?`
   → `rc=1` and "alarm-email: sent …" (no production contact: the host is `.invalid`); **pass = the owner confirms the email arrived**.
   `rc=4` = the sender failed under cron's environment: remove the r2 job (`… remove r2`), record, owner decides. The 22 Nov delivery
   confirmation stays separate evidence (ISSUE-332); this step proves only that cron's bare environment can run the sender.

**STOP:** ssh 255 (most likely production's firewall or `sshd` refusing streamanator's address; unverified prerequisite) → record,
no retry loop, leave the key line (inert without a connection) or remove it with the backup the script printed; owner decides; **do
not install the r2 job** (it would mail an alarm every hour). **Recovery:** delete the line (`cp -p <backup> ~/.ssh/authorized_keys`);
`bash a2-cron-install.sh remove r2`. **Not in A2:** the notifier marker (§4.6).
**Email delivery** through the chosen channel was proven separately on 22 Nov (owner confirmed receipt, recorded in `731a5025`);
that is not an R2 installation step and is not repeated here.

### 4.3 R3 scheduled backups, the off-host pull and the daily job (ISSUE-352; packet R3, kits R3) — about 40 min

| # | Step | Who | Pass |
|---|---|---|---|
| 1 | `install -d -m 700 /home/arm/backups/afldb-scheduled`; `bash -n tools/maintenance/scheduled-backup.sh` (P0 already checked the unit/script hashes) | Claude | exit 0 |
| 2 | `sudo install -m 0644 deploy/afldb-backup.service deploy/afldb-backup.timer deploy/afldb-backup-verify.service deploy/afldb-backup-verify.timer deploy/afldb-backup-failed.service /etc/systemd/system/` | Owner | — |
| 3 | `sudo systemd-analyze verify /etc/systemd/system/afldb-backup.service /etc/systemd/system/afldb-backup-verify.service` | Owner | no error |
| 4 | `sudo systemctl daemon-reload` | Owner | — (safe boundary: units present, nothing started) |
| 5 | `sudo systemctl start afldb-backup.service`; `systemctl status afldb-backup.service --no-pager`; `sudo journalctl -u afldb-backup -n 30 --no-pager` | Owner | `Result=success`, "backup ok" |
| 6 | `a2-r3-verify-target.sh` (**the production restore target, before the restore test**) | Claude | `R3 VERIFY-TARGET RESULT PASS` |
| 7 | `sudo systemctl start afldb-backup-verify.service` (restores a fresh dump into `afldb_restore_test`, idle I/O; minutes); then journal | Owner | success |
| 8 | `AFLDB_BACKUP_DIR=/home/arm/backups/afldb-scheduled bash tools/maintenance/scheduled-backup.sh status; echo rc=$?` | Claude | `rc=0` |
| 9 | `sudo systemctl enable --now afldb-backup.timer afldb-backup-verify.timer`; `systemctl list-timers 'afldb-backup*' --no-pager` | Owner | next 02:20 and Wed 03:30 |
| 10 | `a2-keyline.sh backup` | Claude | `KEYLINE RESULT PASS backup`, fingerprint `SHA256:fNuQ1pLEzjpssrxP1Vz9ttT38osax+TDtM09pxxf42M` |
| 11 | streamanator: check `afldb-offhost-pull-daily.sh` sha `1aa242f2…` and pinned `offhost-pull.sh` `ea48205a…`, then **once** `sh /home/arm/afldb-ops/afldb-offhost-pull-daily.sh; echo rc=$?`; `ls -la /mnt/ssd/afldb-offhost-prod` | Claude | `rc=0`; the dump, its `.sha256`, `.verified-<name>` (**first off-host copy verified**) |
| 12 | streamanator: copy `a2-r3-firstcopy-restore.sh` to streamanator (as run c tested it), then `D=/mnt/ssd/afldb-offhost-prod/<dump>; { echo "DUMP $D"; bash a2-r3-firstcopy-restore.sh restore "$D"; } 2>&1 \| tee /home/arm/afldb-ops/state/a2-firstcopy-restore.log` (new 0700 workspace, socket-only cluster, no TCP port; reviewer F-007), record, then `… cleanup <workspace>` (the log stays: it is the r3 cron precondition) | Claude | `FIRSTCOPY RESULT RESTORE PASS`, `pg_restore exit=0`, counts (ledger 118, seasons max 2026, 2026 Brownlow 183 rows/1,242 votes); cleanup done |
| 13 | streamanator, **only after 11 and 12 PASS** (owner decision 3, round 3): `bash a2-cron-install.sh check r3`, then `install r3` (piped as §4.2 step 3). It refuses unless the newest dump's one-line sidecar verifies, its `.verified-<dump>` marker exists and `state/a2-firstcopy-restore.log` records a PASS restore of that dump; pins `1aa242f2…`/`ea48205a…`. Line: `10 3 * * * AFLDB_ALARM_CMD=/home/arm/afldb-ops/alarm-email.sh /bin/sh /home/arm/afldb-ops/afldb-offhost-pull-daily.sh` | Claude | `CRON INSTALL r3 PASS: next due Wed 25 Nov 2026 03:10 AEDT`; record it. May run after 12:00 (streamanator only) |

**STOP on the first failure** (units untested under systemd until now, procedure 05 §10). **Recovery:** `sudo systemctl disable --now
afldb-backup.timer afldb-backup-verify.timer; sudo rm /etc/systemd/system/afldb-backup*; sudo systemctl daemon-reload`, then the
key line; `bash a2-cron-install.sh remove r3`. Step 11 ssh 255 → as R2's STOP (one attempt; no r3 job). Safe boundaries: after 4,
after 9, after 11, after 13. **Still open after A2:** "within 25 h the next nightly appears off-host" = the first scheduled pull,
Wed 25 Nov 03:10 AEDT (after the 02:20 backup), observed with `a2-cron-observe.sh r3`.

### 4.4 R4 combined Caddy install (ISSUE-357, ISSUE-362, beta headers) — about 20 min; **only after P6 PASS, never started after 11:35** (ahead of R3, §4.5)

| # | Step | Who |
|---|---|---|
| 1 | workstation `bash a2-r4-probes.sh pre` (records) | Claude |
| 2 | `sha256sum /etc/caddy/Caddyfile` → `4f6972ec119f5d33fff4c16cbbce15c50a36b883654dcffcabdb01776d7af036`; any other value: STOP, re-review | Owner |
| 3 | `sudo diff /etc/caddy/Caddyfile deploy/Caddyfile.production` → only the three change sets (filter, headers, deny) | Owner |
| 4 | `sha256sum deploy/Caddyfile.production` → `f00859d5c834be09f064d516ea4fa12612da379e377128e784b3523016a6086d` | Owner |
| 5 | `B=/etc/caddy/Caddyfile.pre-combined-$(date +%Y%m%d%H%M); sudo cp -p /etc/caddy/Caddyfile "$B"; sha256sum /etc/caddy/Caddyfile "$B"` | Owner |
| 6 | `sudo cp deploy/Caddyfile.production /etc/caddy/Caddyfile; sha256sum /etc/caddy/Caddyfile` → `f00859d5…086d` | Owner |
| 7 | `sudo -u caddy caddy validate --config /etc/caddy/Caddyfile --adapter caddyfile` → "Valid configuration"; else `sudo cp -p "$B" /etc/caddy/Caddyfile`, STOP (no reload) | Owner |
| 8 | `ls -l /var/log/caddy` → every file still `caddy:caddy 0600` | Owner |
| 9 | `sudo systemctl reload caddy; systemctl status caddy --no-pager` (graceful; **never restart**) | Owner |
| 10 | workstation `bash a2-r4-probes.sh post` → `R4 PROBES RESULT post PASS`; then the owner runs the three COUNT-ONLY greps the script prints over the newest 50 access-log lines (no line displayed): `ISSUE362-PROBE` **0**, `/admin/invite/REDACTED` **≥ 2**, `"uri":"/beta/verify"` **≥ 1** (probes cover the invite path, its double-slash spelling, a query string, the magic-link `?token=` and a token-bearing Referer; `Location`/`Refresh` redaction was proven on real Caddy in REVIEW-D and is not re-probed); and loads one player and one season page in a real browser (DevTools: no CSP violation) | Claude + Owner |

**Rollback (any failed probe):** `sudo cp -p "$B" /etc/caddy/Caddyfile`; validate as `caddy`; `sudo systemctl reload caddy`; re-run
the legitimate-page part (`a2-r4-probes.sh pre`); `sha256sum` equals `"$B"`. **Acceptance:** every probe; record the new installed
sha256. Behaviour changes (beta host): trailing slash on a protected route 404 instead of 308; deny body `Not Found`; match ids ≤ 99,999;
slugs `[a-z0-9-]`; HSTS and CSP; logs carry no tokens or query strings. **R5:** nothing is deleted; the pre-fix logs are retained with restricted access (§4.5a).

### 4.5 Time budget and if time runs short (reviewer F-009)

| Order | Block | Minutes | T-1 (A2 from 10:30) | T-2 (A2 from about 10:45) |
|---|---|---|---|---|
| 1 | R1 | 10 | 10:30-10:40 | 10:45-10:55 |
| 2 | R2 steps 1-2, cron r2 (step 3), cron-env alarm test (step 4) | 10 + 3 + 5 | 10:40-10:58 | 10:55-11:13 |
| 3 | R4 (only after P6 PASS; never started after 11:35) | 20 | 11:00-11:20 (P6 ends about 10:48) | 11:15-11:35 (P6 ends about 11:15) |
| 4 | R5 access restriction §4.5a (owner block) | 10 | 11:20-11:30 | 11:35-11:45 |
| 5 | R3 steps 1-11 | 30 | 11:30-12:00 | 11:45-12:15 (**overruns**) |
| 6 | R3 steps 12-13 (streamanator only: first-copy restore, cron r3) | 10 | after 12:00 | after 12:15 |

R4 moves ahead of R3 (run d): R4 has the hard 11:35 cut-off and R5 depends on it; R3's production part has no cut-off inside the
window and its streamanator part has no production contact. **Drop order if short** (first dropped first; each is a safe boundary):
(1) the cron-env alarm test (§4.2 step 4) moves after 12:00 (streamanator only; the owner reads email); (2) the cron installs r2/r3
move after 12:00 the same day (streamanator only; their preconditions still bind); (3) R3 steps 1-11 move to a separate attended
owner slot before Thu 26 Nov (needs the owner's sudo; without it there is no scheduled backup during the leave); (4) R4 not started
by 11:35: reschedule it, and run §4.5a anyway (the rolled pre-fix files need it whether or not R4 happens). Stop at the last
completed safe boundary, run nothing half-way, and list the outstanding steps by id. R4 is atomic (backup → install → validate →
reload → probes, or its rollback).

### 4.5a R5: retain the pre-fix Caddy logs with restricted access (owner decision 5, round 3; `R5-RETENTION-PROPOSAL.md`)

**Why in A2, not later:** Caddy rotates these logs itself (`roll_size 20MiB`, `roll_keep 5`; R4 does not change that). It already
deleted the oldest pre-fix access log between 14 and 22 Nov (`afldb-access-2026-09-04T11-02-31.065-size.log.gz` is listed on 14 Nov,
`run2/ops/raw/prod-ro-ops-notify-logs.txt:210`, and absent on 22 Nov, `R0-prod-probe-20261121T155246Z.txt:146-150`, after the 16 Nov
roll made six). The next access roll (early December at the 22 Nov growth rate) deletes `afldb-access-2026-09-07…`, during the
owner's leave. "Retain" therefore needs the rolled files moved out of Caddy's reach.

**Metadata (A2 P0 already lists it as arm: the directory is 0755, no sudo needed).** Expected (R0, 22 Nov): directory `caddy:caddy 0755`;
`afldb-access-2026-09-07T21-28-03.060-size.log.gz` 1,130,156 B, `…-09-14T12-27-36.536…` 1,121,927, `…-10-15T13-18-15.638…` 1,149,465,
`…-11-02T07-51-03.012…` 1,113,936, `…-11-16T05-48-24.848…` 1,078,750; `afldb-apex-2026-09-09T13-26-13.354-size.log.gz` 1,413,311,
`…-09-28T10-33-21.243…` 1,288,778, `…-10-21T04-04-49.343…` 1,463,479; live `afldb-access.log` (8,094,530 B on 22 Nov, growing) and
`afldb-apex.log` (19,348,347 B on 22 Nov: **it may have rolled by Tuesday**, adding a fourth apex `.gz`; expected, record it); every
file `caddy:caddy 0600`. A missing `afldb-access-2026-09-07…` means an access roll pruned it: record the loss and continue.

**Owner block (one block, only after §4.4 step 10 PASSES; `sudo`):**
```bash
R=/var/log/afldb-r5-prefix-retained-20261124
sudo install -d -m 0700 -o root -g root "$R"
sudo sh -c 'mv -n -- /var/log/caddy/afldb-access-2*.log.gz /var/log/caddy/afldb-apex-2*.log.gz '"$R"'/'   # every ROLLED file (all predate R4's filter)
S=$(date -u +%Y%m%dT%H%M%SZ)
sudo cp -p /var/log/caddy/afldb-access.log "$R/afldb-access.log.copy-at-r5-$S"   # copies of the LIVE files (pre-fix lines up to R4's reload)
sudo cp -p /var/log/caddy/afldb-apex.log   "$R/afldb-apex.log.copy-at-r5-$S"
sudo chown root:root "$R"/*; sudo chmod 0600 "$R"/*
sudo sh -c 'cd '"$R"' && sha256sum -- * > SHA256SUMS && chmod 0600 SHA256SUMS'
sudo ls -la "$R"; ls -la /var/log/caddy
```
**Check:** `$R` is `root:root 0700` and holds the eight (or nine) rolled files, the two copies and `SHA256SUMS`, all `root:root 0600`;
`/var/log/caddy` holds only the two live files, **unchanged `caddy:caddy 0600`** (their owner and mode are never touched; Caddy keeps
writing them); then the workstation sends one request (`curl -s -o /dev/null https://beta.afldb.com/`) and `ls -l /var/log/caddy/afldb-access.log`
shows the size grew (Caddy still logs). Report names, sizes and the `SHA256SUMS` line count only; never any content.
**Effect:** the rolled pre-fix files and the copies are readable by root only (before: root and the `caddy` service user), their names
are hidden from other local users, and Caddy can no longer prune them. **Residual:** the live files keep their pre-fix lines,
`caddy:caddy 0600` as today, until Caddy rolls and later prunes them; the copies preserve those lines. `mv`/`rm` are not secure
erasure; any DigitalOcean backup or snapshot of the droplet (unverified) is outside this step.
**Rollback (owner):** `sudo sh -c 'mv -n -- '"$R"'/afldb-*-2*.log.gz /var/log/caddy/' && sudo chown caddy:caddy /var/log/caddy/afldb-*-2*.log.gz && sudo chmod 0600 /var/log/caddy/afldb-*-2*.log.gz`,
then `sudo rm -- "$R"/*.copy-at-r5-* "$R/SHA256SUMS" && sudo rmdir "$R"` (removes only what this block created). After a rollback Caddy
prunes the rolled files again by its own rules. Disposal is NOT part of A2: it is the owner's later decision (`R5-RETENTION-PROPOSAL.md`).

### 4.6 The two streamanator cron jobs: APPROVED (owner decision 3, round 3, 2026-11-22)

Supersedes run c's "separate, still-unapproved owner steps". Installed in A2 by `a2-cron-install.sh` (marker comment + one line each;
idempotent; refuses duplicates and a short or unreadable crontab; keeps a 0600 pre-image; verifies the installed text byte for byte;
`remove r2|r3` is the way back), dry-tested on streamanator against a stub crontab with the real crontab untouched
(`a1a2-20261124/dry-tests-20261122d/t-cron.log`, 54/54 PASS). Baseline of arm's real crontab, read-only 2026-11-22 06:55 AEDT: 24 lines,
all comments (no job), sha256 `043d2510065bd2af43965799c5858e57743ae9a5694281b8c4f8196af003e22e`, no `afldb` line; cron active; system
timezone `Australia/Melbourne` (so `10 3` is 03:10 Melbourne time: AEDT now, AEST after 2027-04-04). The staged wrapper is already the
corrected `c6467ff4…` (`-T`); the previous `f4127845…` is kept as `state/afldb-settle-check.sh.pre-T`. The install precondition
re-verifies the pin; if it ever differs, re-stage from `kits/afldb-settle-check.sh` (`install -m 700 …`) and re-check.
```
17 * * * * AFLDB_ALARM_CMD=/home/arm/afldb-ops/alarm-email.sh /bin/sh /home/arm/afldb-ops/afldb-settle-check.sh        (r2, after §4.2 step 2)
10 3 * * * AFLDB_ALARM_CMD=/home/arm/afldb-ops/alarm-email.sh /bin/sh /home/arm/afldb-ops/afldb-offhost-pull-daily.sh  (r3, after §4.3 step 12)
```
The alarm command is the executable path (the sender is a bash script using process substitution; `sh` cannot run it).
**First scheduled runs** are observed after A2 with `a2-cron-observe.sh all` (read-only) and recorded in `OPEN-ITEMS-AFTER-SITTINGS.md`
§4: r2 at the first :17 after its install; r3 at Wed 25 Nov 03:10 AEDT. **Known limit (reviewer F-013, LOW):** the wrapper does not
de-duplicate alarms, so an unreachable production means one email per hour during the leave; the remedy is `remove r2` (or ignore it).
The R2 notifier marker (packet R2 step 7) stays unapproved and is not in A2.

## 5. Records to write after the sittings

Sitting record (outputs as excerpts, never secrets), the new release id and BUILD_ID, the owner's restart InvocationID, the
installed Caddy sha, the first off-host dump name/sha, and tracker updates per `OPEN-ITEMS-AFTER-SITTINGS.md`.
