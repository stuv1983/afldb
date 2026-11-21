# Attended runbook: sittings A1 and A2, Tuesday 24 November 2026 (APPROVED SCOPE; prepared 22 Nov, run c; NOT EXECUTED)

**Supersedes** `ATTENDED-DRAFT-20261122b.md` for A1 and A2 (the draft stays as the record of the proposal). **Authority:** owner
decisions 2 and 3 of 2026-11-22 (`DECISIONS-20261122c.md` §2-§3): A1 10:00-10:30 AEDT, release of the exact DEV-verified
candidate `7d92042f`, the owner performs the production restart; A2 10:30-12:00 AEDT after A1 passes: R1, R2 (forced-command key
and the FIRST MANUAL RUN ONLY), R3 (scheduled backups and the off-host pull), R4 (combined Caddy install). Every `sudo` step is the
owner's, **one block at a time**. Nothing else is in scope: not R5 (logs retained), R6 (reboot), R7 (databases retained), R8, the
ISSUE-348 load, the R2 notifier marker, or either cron line (§4.6).

**Prepared without production contact.** Production facts come from `R0-SITTING-20261122.md` (read-only probe 2026-11-22 02:52
AEDT), `OWNER-PACKET.md` §3, `kits/KITS-20261122.md` and `RC-371-372.md` (revised 22 Nov, run c). The pre-window probe re-reads
every one of them; **any difference from an expected value is a STOP.** Scripts: `a1a2-20261124/` (this folder). Each has its
contract in its header; `bash -n` clean; the streamanator-side restore, the key-line append (against a scratch copy) and the
raw-head probe's JavaScript (`node --check`) were exercised on streamanator on 22 Nov; nothing was run against production.

## 0. Pins

| Pin | Value |
|---|---|
| `origin/main` (PREP) | `731a502540ab3a9d8795e185fbad89e02534b2b7` |
| Candidate (CAND) | `7d92042fd11010eaa20966e2f49ae7a93e286568`; release id will be `7d92042fd110-<BUILD_ID>` |
| Tested application revision | `cf158d602242a3e7bbf899b951e8423c0d3521e6`; executable tree (ls-tree minus `docs/`, `documentation/`, `issues/`, root `*.md`) sha256 `a18ccac4…e789` = CAND's |
| Serving now / rollback target | `c8d4202a4cb3-aATnIlFOIQjq2z5oDdoHC` (checkout `c8d4202a…`); previous BUILD_ID `aATnIlFOIQjq2z5oDdoHC` |
| `previous` link now | `a2e6ea9995a4-aKAYwf0qC4go6JJWiHhv5` |
| Reviewed delta `c8d4202a..CAND` | 153 paths, raw sha256 `b93a294a…91e3`; 13 non-records paths, sha256 `fe9285f6…7dee` (list in `a1-p2-ff.sh`); no migration, dependency, Next config, unit or supervisor change |
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

**Time budget: an owner choice, to be given in writing before the day (reviewer F-004).** `release.mjs build` takes about
15-25 minutes, so build, promote, env, restart and acceptance do not fit 10:00-10:30.

| | **Option T-1 (recommended)**: P2/P3 from 09:30 | **Option T-2**: everything from 10:00 |
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
| W0 | Workstation: `git ls-remote origin refs/heads/main` = PREP; `git rev-parse 7d92042f^{commit}` resolves | equal |
| W1 | `a1-p1-precheck.sh 731a5025…` | `P1 RESULT PASS`: links as §0, checkout `c8d4202a` clean, `host-gate` PASS (warnings: reboot pending, needrestart hold missing), no apt/writer, ≥ 2,100 MB available, ≥ 6 GB disk, `AFLDB_WORKERS=2`, **both revalidation names absent (counts 0)**, `.env` ends with a newline, ledger 118, 2026 Brownlow revision 3 (183 rows, 1,242 votes, 14 ineligible). Record MainPID, InvocationID and the previous BUILD_ID it prints |
| W2 | `a1-rawhead.sh baseline` | `RAWHEAD RESULT baseline PASS`; writes `/home/arm/a1-rawhead-baseline.json` (title and robots per page; controls recorded) |
| W3 | Owner present with the sudo password and a second terminal; streamanator reachable | — |

Any W-step FAIL: STOP before P2; production unchanged.

## 3. Sitting A1: release `7d92042f` (ISSUE-371, ISSUE-372)

| # | Step | Who | Pass / stop |
|---|---|---|---|
| P2 | `a1-p2-ff.sh 731a5025…` (fetch; ff to **CAND exactly**, never `origin/main`) | Claude | `P2 RESULT PASS`: every delta pin of §0, cf158d60..CAND records-only, executable tree = cf158d60. Any STOP line: production unchanged; a checkout left at CAND is harmless |
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

## 4. Sitting A2: R1, R2, R3, R4 (no outage expected)

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

### 4.2 R2 failure visibility, first manual run only (ISSUE-332; procedure 04 §4) — about 10 min

1. Claude: `a2-keyline.sh settle` → `KEYLINE RESULT PASS settle`, fingerprint `SHA256:bXNU+c3pIBNqI/hjKeWVGX0Sm3QPjphZUGDfEQ+W5bU`.
2. streamanator (Claude): `sha256sum /home/arm/afldb-ops/afldb-settle-check.sh` = `c6467ff492afe0e1f28117baf5c4fa2a38edaf8e8f13bf3cacd72ef22b224896`, then
   **once**: `sh /home/arm/afldb-ops/afldb-settle-check.sh; echo rc=$?` → `rc=0` and `rc=0 AFLDB_SETTLE_STATUS OK` in
   `/home/arm/afldb-ops/state/settle-check.log`.

**STOP:** ssh 255 (most likely production's firewall or `sshd` refusing streamanator's address; unverified prerequisite) → record,
no retry loop, leave the key line (inert without a connection) or remove it with the backup the script printed; owner decides.
**Recovery:** delete the line (`cp -p <backup> ~/.ssh/authorized_keys`). **Not in A2:** the hourly cron and the notifier marker (§4.6).
**Email delivery** through the chosen channel was proven separately on 22 Nov (owner confirmed receipt, recorded in `731a5025`);
that is not an R2 installation step and is not repeated here.

### 4.3 R3 scheduled backups and the off-host pull (ISSUE-352; packet R3, kits R3) — about 35 min

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
| 12 | streamanator: `bash a2-r3-firstcopy-restore.sh restore /mnt/ssd/afldb-offhost-prod/<dump>` (new 0700 workspace, socket-only cluster, no TCP port; reviewer F-007), record, then `… cleanup <workspace>` | Claude | `FIRSTCOPY RESULT RESTORE PASS`, `pg_restore exit=0`, counts (ledger 118, seasons max 2026, 2026 Brownlow 183 rows/1,242 votes); cleanup done |

**STOP on the first failure** (units untested under systemd until now, procedure 05 §10). **Recovery:** `sudo systemctl disable --now
afldb-backup.timer afldb-backup-verify.timer; sudo rm /etc/systemd/system/afldb-backup*; sudo systemctl daemon-reload`, then the
key line. Step 11 ssh 255 → as R2's STOP (one attempt). Safe boundaries: after 4, after 9, after 11. **Still open after A2** (no
daily pull, §4.6): "within 25 h the next nightly appears off-host".

### 4.4 R4 combined Caddy install (ISSUE-357, ISSUE-362, beta headers) — about 20 min; **last, and only after P6 PASS**

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
| 10 | workstation `bash a2-r4-probes.sh post` → `R4 PROBES RESULT post PASS`; then the owner reads ONLY the two newest access-log lines (`/admin/invite/REDACTED`, no probe string) and loads one player and one season page in a real browser (DevTools: no CSP violation) | Claude + Owner |

**Rollback (any failed probe):** `sudo cp -p "$B" /etc/caddy/Caddyfile`; validate as `caddy`; `sudo systemctl reload caddy`; re-run
the legitimate-page part (`a2-r4-probes.sh pre`); `sha256sum` equals `"$B"`. **Acceptance:** every probe; record the new installed
sha256. Behaviour changes (beta host): trailing slash on a protected route 404 instead of 308; deny body `Not Found`; match ids ≤ 99,999;
slugs `[a-z0-9-]`; HSTS and CSP; logs carry no tokens or query strings. **R5 is not run:** the pre-fix logs are retained (owner decision 5).

### 4.5 If time runs short

Stop at the last completed safe boundary, run nothing half-way, and list the outstanding steps by id. R4 is atomic (backup →
install → validate → reload → probes, or its rollback); do not start it after 11:35. R3 step 12 (streamanator only) may finish after
12:00.

### 4.6 Separate, still-unapproved owner steps (reviewer F-006: one question to the owner)

Packet R2 and R3 list the hourly status check and the daily pull as part of their Targets, but neither approval text names a cron,
the owner approved "first manual run only" for R2, and both kit lines had a blank `AFLDB_ALARM_CMD`. **Neither is installed in A2.**
For approval (arm's crontab on streamanator, `crontab -e`, keep existing lines; the alarm command form is the main session's
sender exactly as used by the 22 Nov delivery test, the executable path; NOT `/bin/sh alarm-email.sh` as `kits/KITS-20261122.md` R2 suggests: the sender is a bash script using process substitution, which `sh` (dash) cannot run):
```
17 * * * * AFLDB_ALARM_CMD=/home/arm/afldb-ops/alarm-email.sh /bin/sh /home/arm/afldb-ops/afldb-settle-check.sh
10 3 * * * AFLDB_ALARM_CMD=/home/arm/afldb-ops/alarm-email.sh /bin/sh /home/arm/afldb-ops/afldb-offhost-pull-daily.sh
```
**Consequence of not approving them:** no hourly failure visibility (G0b's ongoing part, ISSUE-332 stays open); no daily off-host
copy, so R3's "within 25 h" acceptance and ISSUE-352's closure stay open, and the R6/R7 prerequisites rest on a manual second pull.
The R2 notifier marker (packet R2 step 4) is likewise not in the A2 approval.

## 5. Records to write after the sittings

Sitting record (outputs as excerpts, never secrets), the new release id and BUILD_ID, the owner's restart InvocationID, the
installed Caddy sha, the first off-host dump name/sha, and tracker updates per `OPEN-ITEMS-AFTER-SITTINGS.md`.
