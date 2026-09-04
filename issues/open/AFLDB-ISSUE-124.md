# AFLDB-ISSUE-124 — `afldb.service` start-limit directives are in the wrong section

**Branch:** `claude/issue-124` **Worktree:** `D:\dev\afldb-issue-124`
**Severity:** Low **Area:** Deployment / Operations
**Opened:** 2026-09-03 (routed out of the `AFLDB-ISSUE-122` S8 closeout)
**Runbook written:** 2026-09-04

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

The change is one unit file and no process is restarted.

```bash
cd ~/projects/afldb && git checkout -- deploy/afldb.service   # or: git checkout <prev> -- deploy/afldb.service
sudo cp deploy/afldb.service /etc/systemd/system/afldb.service
sudo systemctl daemon-reload
```

`systemctl show` returns to `StartLimitIntervalUSec=10s`. Nothing else moves.

## 6. Production boundary — OPERATOR CHECKPOINT

**Do not touch production until §5.1 D1–D4 are green on dev.** Production is
never written from this issue without an explicit operator go-ahead at this
checkpoint. When it is given:

- **File installed:** `deploy/afldb.service` → `/etc/systemd/system/afldb.service`
  (mode 644). This one file, nothing else.
- **Reload requirement:** `sudo systemctl daemon-reload`. Required.
- **Restart requirement:** **none.** See §4 — the values are unit properties and
  a reload applies them. Do not restart `afldb` for this change. (If a restart
  happens for an unrelated reason, it is harmless, not required.)
- **Pre-check first:** run §5 step 2 on production too. Production's installed
  unit was written by `tools/maintenance/01_setup_service.sh`, which rewrites
  `ExecStart=` to the host's nvm node path; if production's node path differs
  from the tracked one, a plain `cp` is wrong and the installer's `sed` form
  must be used instead.
- **Validation:** §5 step 4, same four criteria, plus
  `curl -s https://beta.afldb.com/api/health` from outside.
- **Rollback:** §5.3, run on production. No data, schema, timer or credential is
  involved, so there is nothing else to reverse.
- **Not authorised by this issue:** any migration, any database write, any timer
  change, any `.env` change, any polkit change, and anything at all touching
  `AFLDB-ISSUE-137`.

## 7. Evidence

### 7.1 Repository

- `deploy/afldb.service` — the two directives moved to `[Unit]`, values unchanged
  at `120`/`5`; comments updated in both sections. No other line altered.
- `deploy/` swept for the same misplacement: none found (§3.1).
- No test change: no suite reads unit files (`tests/` has zero hits for
  `afldb.service` or `StartLimit`).
- No migration. No schema change. No `privileges.sql` change. `086` remains the
  next free migration number.

### 7.2 Dev host

*Filled in from the operator's §5 output.*

### 7.3 Production

*Filled in only if and when §6 is authorised and executed.*

## 8. Status

- [x] Repository change made
- [ ] Dev validation D1–D4 green
- [ ] Production checkpoint reached / decided
- [ ] Closed out (ledger, index, CHANGELOG, commit)
