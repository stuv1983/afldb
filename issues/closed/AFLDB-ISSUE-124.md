# AFLDB-ISSUE-124 — `afldb.service` start-limit directives are in the wrong section

**Branch:** `claude/issue-124` **Worktree:** `D:\dev\afldb-issue-124`
**Severity:** Low **Area:** Deployment / Operations
**Opened:** 2026-09-03 (routed out of the `AFLDB-ISSUE-122` S8 closeout)
**Runbook written:** 2026-09-04
**Status:** **RESOLVED 2026-09-04** — dev D1–D4 green (§7.2), production P1–P5
green (§7.3). Production `StartLimitIntervalUSec` is `2min`, `MainPID` unchanged
at `803941`, no restart.

---

## 1. Defect

`deploy/afldb.service` declared the crash-loop rate limiter in `[Service]`:

```ini
[Service]
...
Restart=always
RestartSec=5
StartLimitIntervalSec=120
StartLimitBurst=5
```

systemd parses `StartLimitIntervalSec=` and `StartLimitBurst=` from **`[Unit]`
only**. In `[Service]` they are unknown keys, so systemd drops them and says so:

```
/etc/systemd/system/afldb.service:65: Unknown key name 'StartLimitIntervalSec' in section 'Service', ignoring.
```

The limiter the unit's own comment describes — and that `docs/deployment.md` §4
tells the operator is in force — therefore never engaged. `afldb.service` ran on
systemd's defaults (`DefaultStartLimitIntervalSec=10s`, `DefaultStartLimitBurst=5`)
instead of the intended 5-in-120s.

Pre-existing and unrelated to ISSUE-122; observed during its production
verification only.

## 2. Scope boundary

In scope: moving the two directives, and only those two, in `deploy/afldb.service`.

Explicitly NOT in scope, and not touched: directive **values** (120 and 5 are
carried across unchanged), any other directive in the unit, any timer, the settle
unit, the polkit rule, environment variables, migrations, the database,
`AFLDB-ISSUE-137`, and any other systemd cleanup.

## 3. Repository change

One file: `deploy/afldb.service`.

- `[Unit]` gains `StartLimitIntervalSec=120` and `StartLimitBurst=5` after
  `Requires=postgresql.service`, with the original "give up only after repeated
  rapid failures" rationale plus a note recording why the keys live in `[Unit]`.
- `[Service]` loses those two lines; the comment left behind at `Restart=`/
  `RestartSec=` points at `[Unit]` so the pair is not "tidied" back down later.

Nothing else in the file changed.

### 3.1 The other units under `deploy/` — checked, no second occurrence

`deploy/` holds three `.service` units and two `.timer` units. A repository-wide
search for `StartLimit` returns exactly one unit-file hit, `deploy/afldb.service`
(the remaining hits are prose: `CHANGELOG.md`, `issues.md`, `IssuesIndex.md`,
`docs/deployment.md` §4, `deploy/server-cluster.mjs` line 56 and three closed
issue records).

| Unit | Has the misplacement? | Why not |
|---|---|---|
| `deploy/afldb.service` | **yes — fixed here** | `Type=simple`, `Restart=always` |
| `deploy/afldb-settle-afltables.service` | no | `Type=oneshot`, no `Restart=`, no `StartLimit*` |
| `deploy/afldb-email-intake.service` | no | `Type=oneshot`, no `Restart=`, no `StartLimit*` |
| `deploy/afldb-email-intake.timer` | no | no `StartLimit*` |
| `deploy/afldb-settle-afltables.timer` | no | no `StartLimit*` |

Neither oneshot unit is restarted by systemd at all, so neither wants a start
limiter; no directive was added to either.

### 3.2 What is actually observable after the fix

Honest note, so the evidence is read correctly: `StartLimitBurst=5` is *also*
systemd's built-in default, so that property reads `5` both before and after.
**The interval is the discriminator.** `systemctl show` must move from the
default `10s` to `2min`:

| Property | Before (directives ignored) | After |
|---|---|---|
| `StartLimitIntervalUSec` | `10s` | **`2min`** |
| `StartLimitBurst` | `5` (default, coincidental) | `5` (declared) |

That change, plus the disappearance of the `Unknown key name` line from
`systemd-analyze verify`, is the proof the limiter is now configured.

## 4. Why no application restart is required

`StartLimitIntervalSec`/`StartLimitBurst` are properties of the **unit object**,
not of the running process. `systemctl daemon-reload` re-parses the unit and
`systemctl show` reports the new values immediately. The service's PID, workers,
pools and ISR cache are untouched.

So the deployment step for this change is `cp` + `daemon-reload`. A restart is
**not** needed on either host and must not be presented as if it were.

## 5. DEV validation — `streamanator`

Run from `~/projects/afldb` on the development host, after `git pull` has brought
`claude/issue-124`'s `deploy/afldb.service` onto the host. `sudo` needs a
password on dev, so steps 3 and 4 are interactive.

**Step 1 — record the pre-state (read-only).**

```bash
systemd-analyze verify /etc/systemd/system/afldb.service
systemctl show afldb.service -p StartLimitIntervalUSec -p StartLimitBurst
systemctl is-active afldb.service
```

Expected: the `Unknown key name 'StartLimitIntervalSec' in section 'Service'`
line is present; `StartLimitIntervalUSec=10s`; `StartLimitBurst=5`;
`active`.

**Step 2 — verify the repository unit before installing it (read-only, touches
nothing under `/etc`).**

```bash
systemd-analyze verify deploy/afldb.service
diff /etc/systemd/system/afldb.service deploy/afldb.service
```

Expected: **no** `Unknown key name` line for either start-limit key, and the
`diff` shows only the moved pair and their comments. If `diff` also reports an
`ExecStart=` difference, STOP and use the installer's `sed` form instead
(`tools/maintenance/01_setup_service.sh` lines 62–63), because a plain copy
would overwrite the host's pinned nvm node path.

**Step 3 — install and reload.**

```bash
sudo cp deploy/afldb.service /etc/systemd/system/afldb.service
sudo chmod 644 /etc/systemd/system/afldb.service
sudo systemctl daemon-reload
```

**Step 4 — prove the post-state.**

```bash
systemd-analyze verify /etc/systemd/system/afldb.service
systemctl show afldb.service -p StartLimitIntervalUSec -p StartLimitBurst
systemctl is-active afldb.service
curl -s http://127.0.0.1:3100/api/health
```

### 5.1 Acceptance criteria (all four must hold)

| # | Criterion |
|---|---|
| D1 | `systemd-analyze verify` on the installed unit emits **no** `Unknown key name 'StartLimitIntervalSec'` and no `'StartLimitBurst'` line |
| D2 | `systemctl show` reports `StartLimitIntervalUSec=2min` (was `10s`) |
| D3 | `systemctl show` reports `StartLimitBurst=5` |
| D4 | `afldb.service` is still `active` and `/api/health` returns `{"status":"ok","database":"ok",...}` |

D2 is the load-bearing one; see §3.2.

### 5.2 Crash-loop induction is deliberately NOT performed

Proving the limiter by killing the service five times in 120 s would take the
development site down and leave the unit `failed` until someone runs
`systemctl reset-failed`. The effective configuration is fully observable from
`systemctl show` (§3.2), no repository acceptance contract requires induced
failures, and this issue's own "Next action" asks only that the limiter be
configured and the warning be gone. D1–D4 are therefore sufficient. If a future
issue wants the *behaviour* exercised, do it on a throwaway unit, not on
`afldb.service`.

### 5.3 Rollback (dev)

The change is one unit file and no process is restarted. Because the installed
unit was edited in place rather than copied (§5.4), rollback is the reverse edit
— move the two directives back to `[Service]`, or restore the backup taken
before the edit — followed by:

```bash
sudo systemctl daemon-reload
```

`systemctl show` returns to `StartLimitIntervalUSec=10s`. Nothing else moves.
A `cp` of the tracked `deploy/afldb.service` is **not** a rollback here: it would
also install the unrelated tracked directives that were deliberately withheld.

### 5.4 DEVIATION from §5 step 3 — minimal in-place relocation, not a file copy

**What §5 step 3 said to do:** `cp deploy/afldb.service` over the installed unit.

**What was actually done on dev (2026-09-04):** only the ISSUE-124 relocation was
applied, edited **in place** into the unit already installed at
`/etc/systemd/system/afldb.service` — the two directives removed from
`[Service]` and added to `[Unit]`, values unchanged at `120`/`5`.

**Why:** the tracked `deploy/afldb.service` on `claude/issue-124` also carries
unrelated later changes that are not part of this issue and were not authorised
by it. A plain `cp` would have deployed those directives to the dev host under
cover of a Low-severity systemd cleanup. §5 step 2's `diff` gate anticipated
exactly one such drift (`ExecStart=`); the real drift is wider, so the same
reasoning was applied to the whole file rather than to `ExecStart=` alone.

**Consequence to carry forward:**

1. The dev host's installed unit is now *functionally* what this issue
   specifies, but is **not byte-identical** to the tracked file. That gap is
   the unrelated later changes, not this fix — the fix itself is in both.
2. The next deployment that legitimately installs the whole tracked unit will
   pick those changes up, and must be authorised on their own merits, not on
   this issue's.
3. **Production must follow the same deviation.** §6 is written accordingly:
   in-place relocation, never `cp`.

No unrelated service directive was deployed. No restart was performed.

### 5.4.1 The withheld differences, recorded exactly — **DEV only**

> **CORRECTION, 2026-09-04 (production execution).** As originally written this
> section said production "must therefore not receive either". That was wrong
> about production, and only about production. W1–W3 are the gap between the
> **dev** host's installed unit and the tracked file. **On production all three
> were already installed and live *before* ISSUE-124** — verified read-only on
> the droplet on 2026-09-04, see §5.4.2. Production was never withholding them;
> it was already ahead of dev. That is why production could safely take the
> tracked unit as a file under a diff gate (§6, Option B) while dev could not.

Captured from the **dev** host's installed unit against the tracked
`deploy/afldb.service` on `claude/issue-124`, 2026-09-04. These are the whole of
the gap described in §5.4 consequence 1 — everything the tracked file carries
that the **dev** host does **not**. Each is a real change on its own merits;
none is authorised by this issue, and none was deployed **to dev** by it.

**W1 — `Environment=AFLDB_WORKERS=4` removed from `[Service]`.**
The tracked file no longer hard-codes the worker count. Worker and pool sizing
moves to each host's own `.env`:

```
development   AFLDB_WORKERS=4  AFLDB_POOL_MAX=10
production    AFLDB_WORKERS=2  AFLDB_POOL_MAX=10
```

The installed units still carry the hard-coded `Environment=AFLDB_WORKERS=4`.
Because systemd applies `Environment=` *after* `EnvironmentFile=`, that line
overrides `.env` wherever it is present — so on production it would pin 4
workers onto a 2 vCPU / 4 GB droplet regardless of what `.env` says. Deploying
W1 to production is a throughput/memory change, not a cleanup: it requires
`AFLDB_WORKERS=2` and `AFLDB_POOL_MAX=10` to be present in the production `.env`
**before** the line is removed, and it changes the process topology, so unlike
this issue it does require a restart.

**W2 — the worker/pool sizing commentary** that accompanies W1 in the tracked
file (tracked `deploy/afldb.service` lines 48–68): why the two directives are
deliberately absent from the unit, the per-host values above, and the connection
budget `workers x (AFLDB_POOL_MAX + 3)`, the `+3` being each worker's separate
auth pool from `src/db/authClient.ts`. Comments only — no effective
configuration — but they are the documentation *of* W1 and travel with it.

**W3 — `ReadWritePaths=-/var/www/afldb-soon` added under `[Service]`
hardening**, with its explanatory comment (tracked lines 91–108). This grants
the web-facing service a writable path outside its own directory so
`/admin/content` can publish the apex coming-soon page under
`ProtectSystem=strict`. The leading `-` makes it tolerate the directory being
absent. It also depends on host state this issue does not touch
(`chown -R arm:caddy /var/www/afldb-soon`, `chmod 750`) and on `AFLDB_APEX_DIR`
being set. A new writable path for an internet-facing service is a security
decision and must be authorised as one.

Not withheld, for the avoidance of doubt: the two `StartLimit*` directives and
their comments in `[Unit]` — those *are* this issue, and the directives (not the
comments) are installed on dev.

**Carry-forward — dev only.** W1–W3 remain undeployed **on `streamanator`**.
Whoever next installs the tracked unit as a file *there* gets all three at once:
W1 needs the dev `.env` to carry `AFLDB_WORKERS`/`AFLDB_POOL_MAX` before the
hard-coded line is removed, and a restart; W3 needs the directory prepared and a
security decision. Track them separately before that deployment; do not let them
ride in on a `cp` **onto dev**. This carry-forward does **not** apply to
production — see §5.4.2.

### 5.4.2 Production was already ahead of dev — W1–W3 verified live pre-ISSUE-124

Measured read-only on the production droplet (`afldb`, 209.38.87.252) on
2026-09-04, **before** anything was installed, against
`/etc/systemd/system/afldb.service` as it then stood (115 lines, md5
`40d62b1fc3b0f1e9e9063841ceede285`, mtime 2026-08-16 17:07:01 +1000 — i.e.
untouched since the original deployment):

| | Withheld on dev | State on production **before** ISSUE-124 |
|---|---|---|
| **W1** `Environment=AFLDB_WORKERS=4` removed | not deployed — dev still hard-codes it | **already applied.** `grep 'AFLDB_WORKERS\|AFLDB_POOL_MAX'` on the installed unit returns **only comment lines** (38, 52, 53, 56); there is no `Environment=AFLDB_WORKERS=` directive. Sizing comes from the host `.env`, which carries `AFLDB_WORKERS=2` and `AFLDB_POOL_MAX=10` (`.env:47-48`) — the correct droplet values |
| **W2** worker/pool sizing commentary | not deployed | **already present** — the block at installed lines 38–56, including the `workers x (AFLDB_POOL_MAX + 3)` budget |
| **W3** `ReadWritePaths=-/var/www/afldb-soon` | not deployed | **already present** — installed line 99, with its full explanatory comment at 88–95 |

So on production W1–W3 were **not** pending changes this issue could smuggle in:
they were the running configuration, and had been since before the defect was
recorded. The only difference between production's installed unit and the
tracked file was ISSUE-124's own relocation. §6's proof of that is the diff gate,
not this table — but this table is why the gate could come back clean.

**Consequence for §5.4 consequence 2.** "The next deployment that legitimately
installs the whole tracked unit will pick those changes up" is now true of **dev
only**. Production has taken the whole tracked unit (§6) and picked up nothing
but ISSUE-124.

## 6. Production — AUTHORISED AND EXECUTED 2026-09-04

**Status: operator go-ahead given; executed; acceptance P1–P5 GREEN (§7.3).**

§5.1 D1–D4 went green on dev (§7.2), reaching this checkpoint. The operator then
authorised **Option B** — installation of the tracked unit as a file, gated on a
host-side diff — in place of the §6.3/§6.4 in-place `sed`. Executed 2026-09-04.

### 6.0.1 Option B — what was authorised, and why it was safe here

The §5.4 deviation (never `cp`) existed because the tracked file carried W1–W3
that dev had not received. **That reason does not hold on production**: W1–W3
were already installed and live there before this issue existed (§5.4.2). So the
tracked file and production's installed unit differed by ISSUE-124's relocation
**and nothing else**, and installing the whole file smuggled nothing in.

That was not assumed — it was **proved on the host before installing**, as a
hard gate:

1. The tracked `deploy/afldb.service` was LF-normalised (the worktree is
   `autocrlf=true`, so the checkout carries CRLF) and staged to the droplet as
   `~/afldb.service.staged-issue-124` — 124 lines, LF, md5
   `552ab533c473ae372f060681cb354650`, transfer checksum-verified.
2. `diff -u /etc/systemd/system/afldb.service ~/afldb.service.staged-issue-124`
   was run **read-only, before any sudo**. It returned exactly two hunks and
   nothing else: the comment block plus `StartLimitIntervalSec=120` and
   `StartLimitBurst=5` **added** to `[Unit]` after `Requires=postgresql.service`,
   and the same two directives plus their old two-line comment **removed** from
   `[Service]`, replaced by the three-line pointer comment. Net +9 lines
   (115 → 124), all of it this issue's relocation and its commentary. No W1, no
   W2, no W3, no third directive, no reordering.
3. The gate was re-asserted at install time against the **backup** of the
   installed unit, with both md5s pinned to the exact bytes diffed in step 2, so
   the install could only proceed on the file that had actually been inspected.

**Standing rule, unchanged for dev.** Option B is authorised for production
*because of §5.4.2*, not in general. `cp` onto `streamanator` is still wrong —
it would deploy W1–W3 there.

### 6.0.2 Status of §6.3/§6.4

**Superseded on production** by Option B above: the installed unit was replaced
as a file under the diff gate, not edited in place by `sed`. §6.1 (pre-state),
§6.2 (backup), §6.5 (reload + validate), the acceptance table and §6.6
(rollback) were executed **as written**. §6.3/§6.4 are retained unrun, as the
procedure that would apply on a host where W1–W3 are not already live.

### 6.0 What this deploys, and what it deliberately does not

- **Deployed:** two directives, relocated inside the unit already installed at
  `/etc/systemd/system/afldb.service`. Values unchanged at `120`/`5`.
- **NOT deployed (as planned; superseded — see §6.0.1):** the tracked
  `deploy/afldb.service` as a file. Per §5.4 the
  tracked unit carries unrelated later changes — enumerated as W1–W3 in §5.4.1:
  removal of the hard-coded `Environment=AFLDB_WORKERS=4` in favour of per-host
  `.env` worker/pool settings (W1), its sizing documentation (W2), and
  `ReadWritePaths=-/var/www/afldb-soon` (W3). W1 would pin 4 workers onto the
  2 vCPU droplet and needs a restart; W3 grants a web-facing service a new
  writable path. Production gets the same minimal in-place relocation dev got,
  so this Low-severity systemd fix cannot smuggle any of them onto the droplet.
  **Do not `cp`.**
  **— SUPERSEDED 2026-09-04 (§5.4.2, §6.0.1).** W1–W3 were already live on
  production before this issue, so there was nothing to smuggle; the operator
  authorised Option B and the tracked file *was* installed, under a host-side
  diff gate that proved the only difference was this issue's relocation. The
  bullet stands as written **for dev**.
- **Not installed either:** the tracked file's explanatory comments. Accepted —
  they arrive whenever the whole unit is next legitimately deployed. The
  effective configuration is identical without them.
  **— On production they WERE installed** (§6.0.1): Option B installed the whole
  tracked file, so the droplet now carries the `[Unit]` rationale comment and the
  `[Service]` pointer comment as well as the directives. Still true of dev.
- **Restart requirement: none.** §4. The values are unit-object properties; a
  reload applies them. `MainPID` is checked before and after precisely to prove
  nothing restarted.
- **Not authorised by this issue:** any migration, any database write, any timer
  change, any `.env` change, any polkit change, any other directive in the unit,
  and anything at all touching `AFLDB-ISSUE-137`.

Production `sudo` requires a password, so P2, P3 and P5 are interactive. Run
everything from `~/projects/afldb` on the production host.

### 6.1 P1 — pre-state, read-only

```bash
systemd-analyze verify /etc/systemd/system/afldb.service
systemctl show afldb.service -p StartLimitIntervalUSec -p StartLimitBurst -p MainPID
systemctl is-active afldb.service
grep -n '^\[Unit\]\|^\[Service\]\|^Requires=postgresql\.service$\|StartLimit' /etc/systemd/system/afldb.service
```

Expected: the `:65: Unknown key name 'StartLimitIntervalSec' in section
'Service', ignoring.` line; `StartLimitIntervalUSec=10s`; `StartLimitBurst=5`;
`active`. **Record `MainPID`.** The `grep` must show exactly one
`Requires=postgresql.service` in `[Unit]`, and both `StartLimit*` lines *below*
`[Service]`.

**STOP conditions.** If the two `StartLimit*` lines are already in `[Unit]`, or
`Requires=postgresql.service` does not appear exactly once, or
`StartLimitIntervalUSec` is already `2min`, the host is not in the state this
runbook was written against: stop and report, do not adapt the commands.

### 6.2 P2 — back up the installed unit

```bash
sudo cp -a /etc/systemd/system/afldb.service ~/afldb.service.pre-issue-124
```

This backup is the rollback (§6.6). Keep it until P6 is green.

### 6.3 P3 — apply the relocation in place

```bash
sudo sed -i \
  -e '/^Requires=postgresql\.service$/a StartLimitIntervalSec=120' \
  -e '/^Requires=postgresql\.service$/a StartLimitBurst=5' \
  -e '/^StartLimitIntervalSec=120$/d' \
  -e '/^StartLimitBurst=5$/d' \
  /etc/systemd/system/afldb.service
```

Both `a` commands attach to the same address and emit in order, so the pair
lands under `Requires=postgresql.service` in `[Unit]`. GNU `sed` appends that
text after the cycle rather than feeding it back through the script, so the two
`d` expressions delete only the original `[Service]` lines, not the ones just
inserted. P4 verifies that claim instead of trusting it.

The file keeps its ownership and mode (`sed -i` on a root-owned file run under
`sudo`); confirm with `stat -c '%U %G %a' /etc/systemd/system/afldb.service` →
`root root 644` if there is any doubt.

### 6.4 P4 — prove the edit is exactly the relocation, before any reload

```bash
diff ~/afldb.service.pre-issue-124 /etc/systemd/system/afldb.service
```

Expected, and nothing else: two lines **added** after
`Requires=postgresql.service`, and the same two lines **removed** from the
`[Service]` block. Net line count unchanged.

**If `diff` shows anything else — any third line, any reordering — STOP,
restore the backup (§6.6) and report.** Do not reload a unit whose diff was not
understood.

### 6.5 P5/P6 — reload and validate

```bash
sudo systemctl daemon-reload
systemd-analyze verify /etc/systemd/system/afldb.service
systemctl show afldb.service -p StartLimitIntervalUSec -p StartLimitBurst -p MainPID
systemctl is-active afldb.service
curl -s http://127.0.0.1:3100/api/health
curl -s https://beta.afldb.com/api/health
```

#### Acceptance criteria (all five must hold)

| # | Criterion |
|---|---|
| P1 | `systemd-analyze verify` emits **no** `Unknown key name 'StartLimitIntervalSec'` and no `'StartLimitBurst'` line |
| P2 | `StartLimitIntervalUSec=2min` (was `10s`) — the load-bearing one, §3.2 |
| P3 | `StartLimitBurst=5` (declared now, not coincidental default) |
| P4 | `MainPID` is **unchanged** from §6.1, and `afldb.service` is `active` — proof the reload restarted nothing |
| P5 | Both health endpoints return `{"status":"ok","database":"ok",...}` — loopback and public |

Crash-loop induction is **not** performed on production, for the §5.2 reasons
and more so here.

### 6.6 Rollback (production)

```bash
sudo cp -a ~/afldb.service.pre-issue-124 /etc/systemd/system/afldb.service
sudo systemctl daemon-reload
```

`StartLimitIntervalUSec` returns to `10s`; the process is not touched. No data,
schema, timer, credential or database state is involved, so there is nothing
else to reverse.

## 7. Evidence

### 7.1 Repository

- `deploy/afldb.service` — the two directives moved to `[Unit]`, values unchanged
  at `120`/`5`; comments updated in both sections. No other line altered.
- `deploy/` swept for the same misplacement: none found (§3.1).
- No test change: no suite reads unit files (`tests/` has zero hits for
  `afldb.service` or `StartLimit`).
- No migration. No schema change. No `privileges.sql` change. `086` remains the
  next free migration number.

### 7.2 Dev host — `streamanator`, 2026-09-04, D1–D4 GREEN

Installed by the minimal in-place relocation of §5.4, not by a file copy.

| # | Criterion | Observed |
|---|---|---|
| D1 | no `Unknown key name` for either key | `systemd-analyze verify /etc/systemd/system/afldb.service` — clean, no unknown-key warning |
| D2 | `StartLimitIntervalUSec=2min` | `StartLimitIntervalUSec=2min` (was `10s`) |
| D3 | `StartLimitBurst=5` | `StartLimitBurst=5` |
| D4 | service healthy | `systemctl is-active afldb.service` → `active`; `/api/health` → `{"status":"ok","database":"ok","latencyMs":21}` |

No service restart was performed, as §4 requires. No unrelated service directive
was deployed (§5.4). The dev host's installed unit is therefore functionally
correct for this issue and intentionally not byte-identical to the tracked file;
the difference is exactly W1–W3 of §5.4.1, and nothing else.

### 7.3 Production — `afldb` droplet (209.38.87.252), 2026-09-04, P1–P5 GREEN

Authorised by the operator as **Option B** (§6.0.1): the tracked unit installed
as a file under a host-side diff gate, not the §6.3 in-place `sed`. Privileged
steps were run by the operator — production `sudo` requires a password, so no
`sudo` command was executed by Claude.

**Pre-state (§6.1, read-only, before any change).** Matched the runbook's
expectation exactly; **no STOP condition was met**:

| Check | Observed |
|---|---|
| `systemd-analyze verify` | `/etc/systemd/system/afldb.service:65: Unknown key name 'StartLimitIntervalSec' in section 'Service', ignoring.` |
| `StartLimitIntervalUSec` | `10s` — the defect: the declared `120` was never read |
| `StartLimitBurst` | `5` (the systemd default, coincidental — not the declaration) |
| `MainPID` | **`803941`** — recorded for the no-restart proof |
| `is-active` | `active` |
| ownership / mode | `root root 644` |
| section layout | `[Unit]` line 1, `Requires=postgresql.service` line 6 (exactly once), `[Service]` line 8, both `StartLimit*` at lines **65/66 — below `[Service]`** |
| installed unit | 115 lines, md5 `40d62b1fc3b0f1e9e9063841ceede285`, mtime 2026-08-16 17:07:01 +1000 |

**Diff gate (§6.0.1).** Staged unit 124 lines LF, md5
`552ab533c473ae372f060681cb354650`, transfer verified. `diff -u` installed vs
staged returned **only** the ISSUE-124 relocation and its comment move — the
`[Unit]` block added after `Requires=postgresql.service`, the two directives and
their old comment removed from `[Service]` and replaced by the pointer comment.
Net +9 lines. **No W1/W2/W3 and no other directive appeared**, consistent with
§5.4.2. Re-asserted at install time against the backup with both md5s pinned.

**Acceptance — all five hold:**

| # | Criterion | Observed |
|---|---|---|
| P1 | no `Unknown key name` for either key | `systemd-analyze verify` **clean** |
| P2 | `StartLimitIntervalUSec=2min` (was `10s`) | `2min` — the load-bearing result (§3.2): the limiter is now in effect on production |
| P3 | `StartLimitBurst=5` declared, not defaulted | `5` |
| P4 | `MainPID` unchanged and service `active` | `MainPID=803941` — **unchanged**; `active`. **No service restart.** |
| P5 | both health endpoints ok | loopback `{"status":"ok","database":"ok","latencyMs":1}`; `https://beta.afldb.com/api/health` `{"status":"ok","database":"ok","latencyMs":1}` |

Ownership and mode preserved after install: **`root root 644`**. Backup retained
at `~/afldb.service.pre-issue-124` (rollback per §6.6, not needed). Crash-loop
induction deliberately **not** performed (§5.2). No migration, schema,
`privileges.sql`, `.env`, timer, polkit or database change; nothing touching
`AFLDB-ISSUE-137`.

**Production is now byte-identical to the tracked `deploy/afldb.service`** —
unlike dev, which remains functionally correct but not byte-identical (§5.4,
§5.4.1).

## 8. Status

- [x] Repository change made
- [x] Dev validation D1–D4 green (2026-09-04, §7.2) — installed by in-place
      relocation, deviating from §5 step 3 for the reason recorded in §5.4
- [x] Production authorised (Option B), executed and P1–P5 green
      (2026-09-04, §7.3) — tracked unit installed as a file under a host-side
      diff gate; `MainPID` unchanged, no restart
- [x] §5.4.1 corrected to distinguish dev from production; §5.4.2 added with the
      measured evidence that W1–W3 were already live on production
- [x] Closed out (ledger, index, CHANGELOG, commit) — **RESOLVED 2026-09-04**
