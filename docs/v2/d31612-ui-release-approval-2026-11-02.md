# D-316-12 admin wording: UI release package and approval (2026-11-02, revision 2)

**Status: PREPARED. NOT GRANTED.** Nothing was pushed, deployed, built on production, restarted or changed. Revision 2 replaces the abbreviated-hash draft. It pins the full qualified revision, gives the exact commands for the installed release route, requires the Linux qualification before any production checkout change (done: [d31612-linux-qualification-2026-11-02.md](d31612-linux-qualification-2026-11-02.md)), pins the outgoing release and recovers by state. Mechanics follow the proven GAP-006 route ([gap006-editor-protections-release-package.md](gap006-editor-protections-release-package.md) sections 4 to 8); this document restates the commands rather than pointing at them. Context: [issue316-closeout-and-seasonal-obligations-2026-11-02.md](issue316-closeout-and-seasonal-obligations-2026-11-02.md).

## 1. Candidate and state (full hashes)

| Item | Value |
|---|---|
| **R** (qualified revision, built) | `a0b1080f5b98aee7191894c138be27bb524c7b1b` (local `main`, **not pushed**) |
| **H** (head the owner pushes) | `R`, or a later descendant that `static-delta-check.sh` proves documentation-only. Written into the approval; a commit cannot print its own hash |
| Outgoing serving release `OLD_ID` (pinned rollback target) | `ea98a35f2061--vY0EFS0DdR-TiPkxTZz6` (revision `ea98a35f20610e75c18e698bc0d9fe084c3c783d`, BUILD_ID `-vY0EFS0DdR-TiPkxTZz6`) |
| `previous` today `OLD_PREV` | `fd48ace0c2cb-pqAQwRIJWLjSYzR8LiTuy`; deeper retained: `ad245d602f6f-m0M8pf121326vNSo2B759`, `61a95f7397da-JYIBkYn8ynPgYMn1e5nK-`, `9ed9c9dd3e84-QNEHXAtU53TzUjj0Mb7mv`. **Only `OLD_ID` is a rollback target** |
| Production checkout today | `924ff273261834e4112e3f41b61ceeab55427534`, clean, branch `main`; `origin/main` is the same commit, so the push is a fast-forward |
| Expected new release `NEW_ID` | `a0b1080f5b98-<BUILD_ID>` (the build prints it) |
| Read-only production observation behind this table | 2026-11-02 22:41 AEDT: `release.mjs status` PASS, health 200 ok/ok, MemAvailable 2,946 MB, swap 0, free disk 51 GB, no lock, no `afldb` cron entries, `tmux` present, `AFLDB_SETTLE_TRIGGER=systemd` line count 1, match timer enabled (next elapse Tue 2026-11-03 05:01:47), Brownlow and AFL Tables timers disabled ([output](evidence/d31612-release-package-20261102/p-a-observation-20261102.txt)) |

## 2. What changes, and what does not

Changes (display text, plus an inert read-only tool): `src/app/admin/current-season/page.tsx` (subtitle), `AflApiSettleUnitsPanel.tsx` (intro paragraph), `settle-status.ts` and `settle-trigger.ts` (the unconfigured-host status string no longer mentions the retired polkit rule), `actions.ts` (comment), `tests/admin-current-season-settle.test.ts`; and the C7 observer (`src/lib/acquisition/afl-api-c7-observation.ts`, `tools/v2/c7-observe.ts`, two test files), which **no application route imports** and which is not run by the release.

Does **not** change: any control, server action behaviour, permission or guard (`requireCapability('acquisition.currentSeason')` untouched), ingestion behaviour or source policy, schema or migrations, dependencies, `deploy/`, `.env`, systemd units, timers, `site_settings`, the Brownlow switch or gate. `static-delta-check.sh` enforces the last list mechanically. No migration and no database step, so the GAP-006 P6/P7 database checks do not apply.

**Preserved through the release (checked, section 7 D3c):** the match timer stays enabled with a future next elapse; the AFL API Current-Season Ingestion setting stays as stored; `AFLDB_SETTLE_TRIGGER=systemd` stays in `.env` (the restart re-reads it; it is why the panel shows service states); Brownlow and AFL Tables timers stay disabled.

## 3. Validation: actual results

- Workstation (Windows) on the UI commit: focused suites 382/382 (UI wording, operations UI, module boundaries, ingestion safety) and `tsc --noEmit` exit 0; on R after adding the observer, `tsc --noEmit` exit 0 and the observer's classifier and parser tests pass.
- **Linux qualification (the production-checkout gate, DONE on R):** focused suites 420/420; C7 reader against real PostgreSQL 3/3; `tests/deploy-release.test.ts` 33/33; `next typegen` and `tsc --noEmit` exit 0; production-mode build exit 0 (1 min 34.6 s, peak RSS 1.50 GB, off-host typecheck switch, 1 worker, 3072 MB heap cap); boot smoke health 200; C5 process guard table 17/17 and the real-process test PASS. Disclosed deviations (a missing devDependency handled in a private workspace; `/dev/shm` workspace because the host disk is 98% full) are in the record. Source integrity: 4146/4146 blobs verified.
- **Owed (cannot be done before the release): the authenticated live page.** The static render of the real panel and subtitle ([capture](evidence/d31612-wording-20261102/capture/)) is not the live page, so the live page is **`VISUAL: UNVERIFIED`** until step D4. Prose approval is not evidence: only captured images count.

## 4. Who does what

| Step | Who | Authority |
|---|---|---|
| W0 workstation static check | Claude | local read-only Git, `git ls-remote origin` (read-only) |
| P-A production read-only checks | Claude over SSH as `arm`, or the owner | no sudo |
| D0 push | **Owner only** | push to `origin/main` |
| D1 fast-forward, D2 build, D3a promote, D3c checks | Claude over SSH as `arm`, or the owner | no sudo |
| D3b restart, any recovery restart | **Owner only** | `sudo systemctl restart afldb` |
| D4 visual acceptance | **Owner only signs in**; Claude may capture while the owner is signed in | owner enters every credential |
| Recovery `rollback --to` and checks | Claude over SSH as `arm`, or the owner | no sudo |

Claude never uses `sudo`, restarts the unit, signs in, pushes or grants. One SSH session per phase (bursts have tripped the network's intrusion prevention).

**Window rules.** Not before the first-night observation is recorded (a web restart must not confound it). The match timer fires daily 05:00 to 05:15 AEDT, so the P-A timer check (no `afldb` timer within 100 minutes) is satisfied only from about 05:20 AEDT (after that night's run has finished and the next elapse has moved to the following 05:00) until about 03:20 AEDT the next day. Choose a daytime window.

## 5. Variables (paste at the start of every session)

```bash
# workstation (Git Bash)
R=a0b1080f5b98aee7191894c138be27bb524c7b1b
H=REPLACE_WITH_40_HEX_H          # from the owner approval; anything else fails safe
PKGD=docs/v2/evidence/d31612-release-package-20261102
PROD_HEAD=924ff273261834e4112e3f41b61ceeab55427534
PKGG=docs/v2/evidence/gap006-release-package-20261101
```

```bash
# production, as arm
R=a0b1080f5b98aee7191894c138be27bb524c7b1b
H=REPLACE_WITH_40_HEX_H          # from the owner approval; anything else fails safe
PKGD=docs/v2/evidence/d31612-release-package-20261102
PKGG=docs/v2/evidence/gap006-release-package-20261101    # state-probe.sh (generic: takes OLD_ID and NEW_ID as arguments)
OLD_ID=ea98a35f2061--vY0EFS0DdR-TiPkxTZz6                # serving; the ONLY rollback target
OLD_PREV=fd48ace0c2cb-pqAQwRIJWLjSYzR8LiTuy              # `previous` today; NOT a rollback target
PROD_HEAD=924ff273261834e4112e3f41b61ceeab55427534
ROOT=/home/arm/afldb-releases
CHK=/home/arm/projects/afldb
N=/home/arm/.nvm/versions/node/v22.23.2/bin/node
NEWFILE=/home/arm/d31612-new-id.txt                       # written by D2; read by D3 and by recovery
```

## 6. Preflight (all read-only; nothing has changed before D0)

Each block runs in a subshell with `set -euo pipefail`; the first failed assertion stops it and prints no PASS line. Any failure is a STOP: do not adjust an expected value.

**W0 (Claude, workstation).**

```bash
( set -euo pipefail; [[ $R =~ ^[0-9a-f]{40}$ ]]; [[ $H =~ ^[0-9a-f]{40}$ ]]; cd /d/dev/afldb
  [ "$(git rev-parse HEAD)" = "$H" ]                                          # the working tree is H
  [ -z "$(git status --porcelain | grep -v '^?? \.codex/$' || true)" ]        # clean, apart from untracked .codex/
  bash "$PKGD/static-delta-check.sh" "$H"                                     # prints STATIC DELTA CHECK PASS or exits 1
  [ "$(git ls-remote origin refs/heads/main | cut -f1)" = "$PROD_HEAD" ]      # nobody pushed since
  echo "W0 PASS"
)
```

The check fails unless: `R`, the outgoing revision, the production checkout and `H` exist; the production checkout and the outgoing revision are ancestors of `R`, and `R` of `H`; `R` to `H` touches only `docs/`, `CHANGELOG.md`, `IssuesIndex.md`, `issues.md`, `blockers.md`; the trees `src`, `packages`, `tools`, `deploy`, `data`, `tests`, `package.json`, `package-lock.json`, `next.config.ts`, `tsconfig.json` are byte-identical in `R` and `H`; the outgoing revision to `R` and the production checkout to `R` are empty on migrations, dependencies, `deploy`, `data`, build configuration and `tools/maintenance`; and production to `R` changes exactly the ten expected non-documentation files.

**P-A (production, as `arm`; no sudo).**

```bash
( set -euo pipefail; [[ $R =~ ^[0-9a-f]{40}$ ]]; cd "$CHK"
  [ "$(git rev-parse HEAD)" = "$PROD_HEAD" ]; [ -z "$(git status --porcelain)" ]
  [ -z "$(ls "$ROOT"/*.lock 2>/dev/null || true)" ]
  [ "$(readlink "$ROOT/current")"  = "releases/$OLD_ID" ]; [ "$(readlink "$ROOT/previous")" = "releases/$OLD_PREV" ]
  for id in "$OLD_ID" "$OLD_PREV"; do [ -d "$ROOT/releases/$id" ]; done
  "$N" deploy/release.mjs status                                              # exit 0 only on STATUS PASS (writes nothing)
  "$N" deploy/release.mjs verify "$OLD_ID"                                    # the pinned rollback target still matches its manifest
  avail=$(awk '/^MemAvailable:/ {print int($2/1024)}' /proc/meminfo); echo "MemAvailable ${avail} MB"; [ "$avail" -ge 2100 ]
  free_kb=$(df --output=avail -k /home/arm | tail -n 1 | tr -d ' '); echo "free ${free_kb} KB"; [ "$free_kb" -ge 6291456 ]
  [ -z "$(pgrep -f '[p]g_dump|[r]sync|[r]estore' || true)" ]
  now=$(date +%s); limit=$((now + 100 * 60))                                  # no afldb timer inside the 90-minute window plus margin
  for t in $(systemctl list-timers --all --no-legend | awk '{for (i = 1; i <= NF; i++) if ($i ~ /^afldb.*\.timer$/) print $i}' | sort -u); do
    n=$(systemctl show -p NextElapseUSecRealtime --value "$t"); echo "timer $t next: ${n:-none}"
    [ -z "$n" ] || [ "$(date -d "$n" +%s)" -gt "$limit" ]
  done
  [ "$(grep -c '^AFLDB_SETTLE_TRIGGER=systemd$' .env)" = 1 ]                  # preserved input; count only, the value is never printed
  [ "$(systemctl is-enabled afldb-settle-afl-api.timer)" = enabled ]
  [ "$(systemctl is-enabled afldb-settle-afl-api-brownlow.timer 2>&1 || true)" = disabled ]
  [ "$(systemctl is-enabled afldb-settle-afltables.timer 2>&1 || true)" = disabled ]
  echo "P-A PASS (record the match timer's next-elapse time for the D3c comparison)"
)
crontab -l 2>/dev/null | grep -i afldb || echo "no afldb cron entries"       # J1: JUDGEMENT; none may fire within 100 minutes
```

**Go/no-go:** W0 PASS, P-A PASS with J1 read, the first-night observation recorded. Then D0.

## 7. Execution (owner-attended; budgets, not a schedule; an overrun is a STOP)

**D0 push (owner, workstation).** Fast-forward only, no force.

```bash
( set -euo pipefail; [[ $H =~ ^[0-9a-f]{40}$ ]]; cd /d/dev/afldb
  [ "$(git rev-parse HEAD)" = "$H" ]
  [ "$(git ls-remote origin refs/heads/main | cut -f1)" = "$PROD_HEAD" ]
  git push origin "$H:refs/heads/main"                                        # no --force: a non-fast-forward is rejected
  [ "$(git ls-remote origin refs/heads/main | cut -f1)" = "$H" ]
  echo "D0 PASS"
)
```

This pushes every local commit since `924ff273` (the C5 records, D-316-12, the C7 observer, the qualification and release documents). Review `git log --oneline 924ff273..H` first; the push is the owner's act.

**D1 fast-forward the production checkout (Claude over SSH as `arm`, or the owner).** The only change before the build; it does not touch the running site or the in-place bundle. The fetched remote must equal `H` before anything moves, and the static check runs again on production from `R`'s own pinned bytes:

```bash
( set -euo pipefail; [[ $H =~ ^[0-9a-f]{40}$ ]]; cd "$CHK"
  [ "$(git rev-parse HEAD)" = "$PROD_HEAD" ]
  git fetch origin
  [ "$(git rev-parse refs/remotes/origin/main)" = "$H" ]
  git cat-file -e "$R^{commit}"
  git show "$H:$PKGD/static-delta-check.sh" | bash -s -- "$H"                 # enforced on production
  git merge --ff-only "$H"
  [ "$(git rev-parse HEAD)" = "$H" ]; [ -z "$(git status --porcelain)" ]
  "$N" deploy/release.mjs status                                              # still STATUS PASS
  bash "$PKGG/state-probe.sh" "$OLD_ID" - --expect OLD_SERVING
  echo "D1 PASS"
)
```

**D2 build (`arm`, inside `tmux`; budget 20 min).** Run once. The build is of `R` (the qualified bytes), not `H`. It refuses to start if `NEWFILE` exists. The route's own guards apply unchanged (admission `MemAvailable` at least 2,100 MB with the off-host switch and free disk at least 6 GB; guard floor 384 MB, the build's process group is killed below it; production has no swap and 3,915 MB total):

```bash
( set -euo pipefail; [[ $R =~ ^[0-9a-f]{40}$ ]]; cd "$CHK"
  [ ! -e "$NEWFILE" ]
  [ "$(git rev-parse HEAD)" = "$H" ]; [ -z "$(git status --porcelain)" ]
  bash "$PKGG/state-probe.sh" "$OLD_ID" - --expect OLD_SERVING
  "$N" deploy/release.mjs build --checkout "$CHK" --revision "$R" \
    --afldb-env production --typecheck off-host --smoke-paths /players,/clubs,/seasons \
    --typecheck-evidence "npm run typecheck exit 0 (next typegen && tsc --noEmit) on Linux (streamanator, node v22.23.2) for git archive of a0b1080f5b98 (4146/4146 blobs verified); 2026-11-02; docs/v2/d31612-linux-qualification-2026-11-02.md" \
    2>&1 | tee /home/arm/d31612-d2-build.log
  NEW_ID=$(sed -n 's/^release: RELEASE READY \([^ ]*\) .*$/\1/p' /home/arm/d31612-d2-build.log | tail -n 1)
  [[ $NEW_ID =~ ^a0b1080f5b98-[A-Za-z0-9_-]+$ ]]
  "$N" deploy/release.mjs verify "$NEW_ID"
  [ "$(readlink "$ROOT/current")"  = "releases/$OLD_ID" ]                     # a build never moves a link
  [ "$(readlink "$ROOT/previous")" = "releases/$OLD_PREV" ]
  bash "$PKGG/state-probe.sh" "$OLD_ID" "$NEW_ID" --expect OLD_SERVING
  echo "$NEW_ID" > "$NEWFILE"; echo "D2 PASS NEW_ID=$NEW_ID"
)
```

Any `REFUSED`, guard abort or failure is a STOP with `current` and `previous` untouched and `NEWFILE` unwritten. Nothing is promoted, so there is nothing to recover. Treat a MemAvailable floor under about 900 MB as a signal to stop and look, not to retry blindly.

**D3a promote (Claude as `arm`, or the owner).** Every refusal inside `promote` happens before a link moves:

```bash
( set -euo pipefail; [[ $R =~ ^[0-9a-f]{40}$ ]]; cd "$CHK"
  NEW_ID=$(cat "$NEWFILE"); [[ $NEW_ID =~ ^a0b1080f5b98-[A-Za-z0-9_-]+$ ]]
  bash "$PKGG/state-probe.sh" "$OLD_ID" "$NEW_ID" --expect OLD_SERVING
  "$N" deploy/release.mjs promote "$NEW_ID"          # previous becomes OLD_ID; the running service is unchanged until it restarts
  bash "$PKGG/state-probe.sh" "$OLD_ID" "$NEW_ID" --expect NEW_SELECTED_OLD_RUNNING
  [ "$(readlink "$ROOT/previous")" = "releases/$OLD_ID" ]
  echo "D3a PASS"
)
```

If this stops anywhere, do not roll back or restart by reflex: run the state probe (section 8).

**D3b restart (owner only):** `sudo systemctl restart afldb`, at least 30 s after the last start (about 15 to 30 s of downtime). The restart does not touch the AFL API timer or its unit; a running settle is a separate process.

**D3c check (Claude as `arm`, or the owner).** Includes the preservation checks:

```bash
( set -euo pipefail; [[ $R =~ ^[0-9a-f]{40}$ ]]; cd "$CHK"
  NEW_ID=$(cat "$NEWFILE"); [[ $NEW_ID =~ ^a0b1080f5b98-[A-Za-z0-9_-]+$ ]]
  bash deploy/post-install-check.sh "$NEW_ID"        # waits up to 60 s for health; prints POST-INSTALL CHECK PASS or FAIL
  bash "$PKGG/state-probe.sh" "$OLD_ID" "$NEW_ID" --expect NEW_SERVING
  journalctl -u afldb --since '10 minutes ago' --no-pager | grep -F 'serving build' | tail -n 1 | grep -q "release $NEW_ID revision a0b1080f5b98"
  [ "$(grep -c '^AFLDB_SETTLE_TRIGGER=systemd$' .env)" = 1 ]
  bash /home/arm/c5-observe-20261102-r3.sh timer "$H"   # read-only: match timer enabled+active with a future elapse, Brownlow and AFL Tables timers off, no settle/acquire process, setting still true
  echo "D3c PASS"
)
```

If `arm` cannot read the journal, the owner runs that one line. A `CACHE` line for the old build ID is an old edge copy and does not fail the check; every `FAIL` does.

**D4 authenticated visual acceptance (owner signs in; budget 20 min).** `/admin/current-season` at 1280x800 and 390x844, headed browser, each recorded as a captured image or `VISUAL: UNVERIFIED`, never prose:
1. the subtitle reads as in `page.tsx` (AFL Tables retired, match ingestion from its timer while the switch is Enabled, Brownlow separately governed and off until a count window, no Start control);
2. neither "still runs on the host" nor "neither starts nor stops" appears;
3. "AFL API Current-Season Ingestion" shows its real state (Enabled);
4. "Brownlow Live Ingestion" shows Disabled and unchanged;
5. both settle rows show a service state, not "Unit status is not read on this host" (this proves the restart kept `AFLDB_SETTLE_TRIGGER=systemd`);
6. no Start control;
7. no horizontal page overflow.
The script `docs/v2/evidence/gap006-release-package-20261101/live-accept-gap006.mjs` is an example of a navigate-only capture that never fills, clicks or reads cookies; no D-316-12 capture script exists yet, and a missing capture is `VISUAL: UNVERIFIED`.

**Decision.** Accept (D3c PASS and every D4 gate) or recover. If D4 is not complete and passing within 90 minutes of D3b, recover.

## 8. Stop and recovery (state-aware; no database action is ever part of a rollback)

**The rule.** The pinned outgoing release is `OLD_ID`. Recovery always names it: `rollback --to "$OLD_ID"`. **An unqualified `rollback` is forbidden here**: it selects `previous`, which before a promotion is `fd48ace0c2cb-…`, not the release that is serving. Never roll back or restart a release the probe shows as unchanged and healthy.

Probe (read-only; `NEW_ID` is `-` before the build exists):

```bash
( set -u; cd "$CHK"; NEW_ID=$(cat "$NEWFILE" 2>/dev/null || echo -); bash "$PKGG/state-probe.sh" "$OLD_ID" "$NEW_ID" )
```

| STATE | Meaning | Action |
|---|---|---|
| `OLD_SERVING` | `OLD_ID` selected, running, healthy: promotion refused or never happened, or recovery finished | Preserve and stop; report the refusal text. No rollback, no restart |
| `NEW_SELECTED_OLD_RUNNING` | promoted, not yet restarted, old process still serves | Abandon: **R2**. Continue: D3b |
| `NEW_SERVING` | restarted and healthy on `NEW_ID` | D3c, D4. If any gate fails or the 90 minutes pass: **R3** |
| `NEW_SELECTED_FAILED` | `NEW_ID` selected, unit down or unhealthy (probe again after 60 s first) | **R3** |
| `OLD_SELECTED_NEW_RUNNING` | links back at `OLD_ID`, process still `NEW_ID` | **R4** |
| `TRANSIENT` | unit `activating` | change nothing; probe again in 15 s |
| `UNCERTAIN` | anything else | **R5: act on nothing** |

**R2 (links only, no restart):**

```bash
( set -euo pipefail; cd "$CHK"
  NEW_ID=$(cat "$NEWFILE"); [[ $NEW_ID =~ ^a0b1080f5b98-[A-Za-z0-9_-]+$ ]]
  bash "$PKGG/state-probe.sh" "$OLD_ID" "$NEW_ID" --expect NEW_SELECTED_OLD_RUNNING
  "$N" deploy/release.mjs rollback --to "$OLD_ID"
  bash "$PKGG/state-probe.sh" "$OLD_ID" "$NEW_ID" --expect OLD_SERVING
  bash deploy/post-install-check.sh "$OLD_ID"
  echo "R2 PASS"
)
```

**R3 (after the restart, including acceptance failure).** First keep the evidence: `systemctl status afldb --no-pager`; `journalctl -u afldb --since '15 minutes ago' --no-pager`. Then:

```bash
( set -euo pipefail; cd "$CHK"
  NEW_ID=$(cat "$NEWFILE"); [[ $NEW_ID =~ ^a0b1080f5b98-[A-Za-z0-9_-]+$ ]]
  [ "$(readlink "$ROOT/current")" = "releases/$NEW_ID" ]    # roll back only when NEW_ID is the selected release
  "$N" deploy/release.mjs rollback --to "$OLD_ID"           # current -> OLD_ID, previous -> NEW_ID (retained, not deleted)
  [ "$(readlink "$ROOT/current")" = "releases/$OLD_ID" ]; [ "$(readlink "$ROOT/previous")" = "releases/$NEW_ID" ]
  echo "R3 links restored; the owner's restart is owed"
)
```

The owner runs `sudo systemctl restart afldb` (at least 30 s after the last start; on `start-limit-hit`: `sudo systemctl reset-failed afldb && sudo systemctl start afldb`). Then:

```bash
( set -euo pipefail; cd "$CHK"; NEW_ID=$(cat "$NEWFILE")
  bash deploy/post-install-check.sh "$OLD_ID"
  bash "$PKGG/state-probe.sh" "$OLD_ID" "$NEW_ID" --expect OLD_SERVING
  bash /home/arm/c5-observe-20261102-r3.sh timer "$H"
  echo "R3 PASS: OLD_ID serving, timer and setting preserved"
)
```

**R4:** the owner restarts, then the second R3 block verifies. **R5 (`UNCERTAIN`):** run nothing that changes state; collect read-only: the probe output, `ls -l "$ROOT"`, `"$N" deploy/release.mjs status`, `systemctl status afldb --no-pager`, `journalctl -u afldb --since '30 minutes ago' --no-pager`, `ls "$ROOT"/*.lock`; keep every log and report. If `rollback --to "$OLD_ID"` refuses because `OLD_ID` fails its manifest check, that is also R5: choosing a deeper release is an owner decision, not a step here.

A UI text release has no data to reverse. The checkout stays at `H` after a rollback (a fast-forward is not undone); the rollback restores the serving release only. Nothing is deleted: `OLD_ID`, `OLD_PREV`, the deeper releases and `NEW_ID` all stay.

## 9. Owner approval (one complete statement; nothing is granted until the owner writes it)

```text
I, Stuart, approve the D-316-12 UI release to afldb-prod: push head <H, 40 hex> (qualified revision a0b1080f5b98aee7191894c138be27bb524c7b1b), fast-forward the production checkout to it, build revision a0b1080f5b98aee7191894c138be27bb524c7b1b with --typecheck off-host and the route's unchanged resource guards, promote the new release, and restart afldb, exactly as docs/v2/d31612-ui-release-approval-2026-11-02.md sections 5 to 8, in the window <start> to <end> AEDT on <date>. The window is after the first-night observation is recorded and outside 05:00 to 05:20 AEDT. The outgoing release is ea98a35f2061--vY0EFS0DdR-TiPkxTZz6 and is the only rollback target. I will push, run every sudo command and the restart, and sign in for the visual check myself. Claude may, as arm without sudo, run the preflight, the fast-forward, the build, the promotion and the checks (and any recovery that needs no sudo), and capture the visual evidence while I am signed in. No schema change, no timer or setting change, no .env change, no Brownlow step, no manual settle.
```
