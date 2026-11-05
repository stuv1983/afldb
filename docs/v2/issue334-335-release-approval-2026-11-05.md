# ISSUE-334 and ISSUE-335: application release package and approval (2026-11-05)

**Status: PREPARED. NOT GRANTED. NOT EXECUTED.** Nothing was pushed, deployed, built on production, promoted, restarted or changed, and no production host was contacted while preparing this. **Production is not fixed** until this release is separately approved, deployed and verified (sections 7 and 8). The route is the installed release route (`deploy/release.mjs`, `docs/deployment.md` section 3a), with the same mechanics as the executed D-316-12 release ([d31612-ui-release-approval-2026-11-02.md](d31612-ui-release-approval-2026-11-02.md) sections 5 to 9). The commands are restated here rather than pointed at.

## 1. Candidate and state (full hashes)

| Item | Value |
|---|---|
| **R** (qualified revision, the one built) | `0f251c2daa8d7c6c38eacd559376dde41e010fd9` (local `main`, **not pushed**) |
| **H** (head the owner pushes) | `R`, or a later descendant that `static-delta-check.sh` proves documentation-only. It is written into the approval, because a commit cannot print its own hash |
| Serving release `OLD_ID` (pinned rollback target) | `a0b1080f5b98-B8kdpO6PO1tUCHus0j1za` (revision `a0b1080f5b98aee7191894c138be27bb524c7b1b`). **Last recorded 2026-11-04** (`post-release-closeout-2026-11-04.md` V5); P-A re-observes it |
| `previous` `OLD_PREV` | `ea98a35f2061--vY0EFS0DdR-TiPkxTZz6` (recorded at the D-316-12 promotion, 2026-11-03). **Only `OLD_ID` is a rollback target** |
| Production operator checkout `PROD_HEAD` | `d00e07e37566e92b35a34e62a1ff03e173715e87`, **last recorded 2026-11-04**; P-A re-observes it |
| `origin/main` `ORIGIN_HEAD` | `87b6b2160a7c7e627f10646957aeeb754d04393e` (published 2026-11-04); an ancestor of `R`, so the push is a fast-forward |
| Expected new release `NEW_ID` | `0f251c2daa8d-<BUILD_ID>` (the build prints it) |
| Deployment presence of the defects | **Unverified by observation.** Both defective files are unchanged between `a0b1080f` and the base `87b6b216`, so the serving release is expected to contain both defects; no production host was read for this package |

## 2. What changes, and what does not

The release moves production from `a0b1080f` to `R`. Application source changes, enforced by `static-delta-check.sh`:

| File | Change | Origin |
|---|---|---|
| `src/app/admin/content/media/route.ts` | `POST` calls `sameOriginRefusal(request.headers)` first and answers 403 before any session lookup, body read, write or audit | **ISSUE-334** (`06459e99`) |
| `src/db/queries/admin-coaches.ts` | new `matchDeletionCoachOverrideRefusal()`: read-only, decodes `match_coaches` override keys exactly as `replay_admin_overrides` does | **ISSUE-335** (`06459e99`) |
| `src/db/queries/match-admin.ts` | `deleteMatch` calls it under the existing match lock, right after the Match Sheet authority refusal | **ISSUE-335** (`06459e99`) |
| `src/db/queries/admin-draft.ts` | behaviour-preserving refactor: `createManualPick` delegates to the new `createManualPickInTransaction` | **already on `main` before this work** (V2-GAP-029, `603bbe38`, `c16d7fad`, `5a7ed19e`); it ships with this release because production has never built it; re-qualified on Linux here (section 3) |

Also moving with the checkout, none of them read by the running application: six `data/` files (GAP-029 sibling and Gridley inputs, read only by import tooling and tests), `tools/`, `tests/`, `AGENTS.md`, `CLAUDE.md`, documentation. The exact list is `evidence/issue334-335-release-20261105/prod-checkout-to-r-nondoc-files.txt` (63 files), and the check fails on any difference.

**Does not change:** any migration or schema, grant, dependency (`package.json`, `package-lock.json`), `deploy/`, `public/`, build configuration, `.env`, systemd unit, timer, `site_settings`, the Brownlow switch or gate, the session cookie, the shared origin policy (`src/lib/ingest/upload-request.ts`), any permission or capability, any upload limit. No database step is part of this release, before, during or after.

## 3. Validation: actual results

**Workstation (Windows), on the working tree before each commit.** Media-route tests against the unfixed route: **8 failed, 4 passed**. A request with no `Origin` answered **200 and the image was stored**; the refused-body case answered 400 after parsing. After the fix: `tests/admin-upload-route.test.ts` with `tests/auth.test.ts` **239/239**. `next typegen && tsc --noEmit`: exit 0 once `9a8b17cf` fixed the pre-existing TS5097 error. That error came from `tests/issue333-coach-row-selector.test.ts`, added in `2131428a`, which imported a `.mts` path, so the type check failed at base `87b6b216`. A default (in-build type-check) release build would be expected to fail on it, because `tsconfig.json` includes the tests; that was not exercised. The `--typecheck off-host` route requires recorded `tsc` evidence, which base could not provide.

**Linux qualification (the production-checkout gate), DONE on `R`.** The run followed `master-execution-sequence-2026-11-01.md` section 8.2: streamanator as `arm`, no sudo, Node v22.23.2, PostgreSQL 16.15 binaries.
- **Workspace:** fresh, `/mnt/ssd/afldb-i335-qual-20261104T235919Z`, retained, 4.1 GB.
- **Candidate:** a shallow clone of `R` (depth 4, so the base `87b6b216` is present), tar sha256 `37bb38c2…e636a`, checked on both ends. HEAD equals `R`, 4,731 tracked files, tree clean before and after `npm ci`. The `package-lock.json` prefix `984b44221f8f7256` was unchanged.
- **Database:** a new guarded loopback cluster `afldb_v2_isolated` on 127.0.0.1:55497, whose single listener was proven to be our postmaster. The template `afldb_v2_i335tmpl_test` was restored from the verified production dump (sha256 `3f5b5339…4730`, pg_restore exit 0) and migrated 117 to 118 (ledger `118_fixtures_unconfirmed_participants.sql`, 17,056 matches). Each test database was a fresh `afldb_v2_*_test` copy.

| Check | Result |
|---|---|
| `next typegen` + `tsc --noEmit -p .` | exit 0; tree still clean |
| Unit suites: `admin-upload-route`, `auth`, `admin-coach-actions`, `issue333-coach-row-selector` | **276 / 276** |
| **RED** (tests at `R`, the three fixed files restored from base `87b6b216`): ISSUE-334 cases | **8 failed, 4 passed**, as predicted. Seven foreign, sibling, missing, opaque or unparseable origins got `expected 200 to be 403` (accepted and stored); the refused-body case got `expected 400 to be 403` (body parsed); the four same-origin controls passed |
| **RED** database (`afldb_v2_i335red2_test`): ISSUE-335 cases | **1 failed, 3 passed**, as predicted. Only the blocked case failed, with `expected true to be false`: the unfixed `deleteMatch` deleted the match. The inactive-override, source-only and near-miss controls passed. The tree was restored and proven clean |
| **GREEN** at `R` (`afldb_v2_i335_test`): `integration/data-editor` (56), `match-admin-delete` (7), `admin-coaches` (15) | **65 passed, 13 skipped, 0 failed**; the four ISSUE-335 cases all passed. All 13 skips are Python-replay cases (ISSUE-257 F-S9-03, ISSUE-267/269, ISSUE-277) that need `psycopg`, which the host's system Python lacks; none touches the changed code |
| Release delta (GAP-029 `admin-draft.ts` refactor, `afldb_v2_i335draft_test`): `admin-draft-actions` + `v2-season-seal` unit; `integration/admin-draft` + `sealed-editor-guard` | unit **122 / 122**; integration **62 passed, 5 skipped, 0 failed** |
| Isolation | DEV `afldb.service` MainPID 1677 and `postgresql@16-main` MainPID 1536 were active before and after. The cluster is stopped, nothing listens on 55497, and nothing outside the workspace was touched or deleted |

**Disclosed process events (no production code involved):**
1. A first Linux run (workspace `…-20261104T235053Z`, candidate `06459e99`, retained) failed all four new database cases in both directions. The fixture was at fault: the coach path violated `coaches_path_namespace_ck` (migration 095), and `deleteMatch` refuses to empty a season (`recomputeClubSeasons`). Fixed in `0f251c2d`; this is the qualified `R`.
2. In the qualifying workspace the red phase was first marked FAIL by my checker, not by the tests. `grep -q` under `pipefail` reported SIGPIPE although the evidence matched every expected pattern. Script revision 2 (`qual-host-r2.sh`, sha256 `14d80cfb…4b74`) changed only the checker and reran red on the fresh database `afldb_v2_i335red2_test`: **PASS**, with identical counts. Both runs' lines stay in `SUMMARY.txt` and `run.log`.

**Not done:** a production-mode build of `R` on Linux. Its build inputs (dependencies, build configuration, `deploy/`, `public/`) are byte-identical to the serving revision's, and `tsc --noEmit` passes, so the route's own build in D2 (with V1 to V5 and its boot smoke) is the build proof. The Python replay cases were not run. Nothing was exercised on DEV or production.

Evidence: `evidence/issue334-335-release-20261105/` (`linux-qualification/` with `SHA256SUMS`, `host-scripts/`, `static-delta-check.sh`, `prod-checkout-to-r-nondoc-files.txt`).

## 4. Who does what

| Step | Who | Authority |
|---|---|---|
| W0 workstation static check | Claude | local read-only Git, `git ls-remote origin` (read-only) |
| P-A production read-only checks | Claude over SSH as `arm`, or the owner | no sudo |
| D0 push | **Owner only** | push to `origin/main` |
| D1 fast-forward, D2 build, D3a promote, D3c checks | Claude over SSH as `arm`, or the owner | no sudo |
| D3b restart, any recovery restart | **Owner only** | `sudo systemctl restart afldb` |
| D4 acceptance | Claude as `arm` (read-only); the optional upload smoke is the **owner's** signed-in action | section 7 |
| Recovery `rollback --to` and checks | Claude over SSH as `arm`, or the owner | no sudo |

Claude never uses `sudo`, restarts the unit, signs in, pushes or grants. One SSH session per phase (bursts have tripped the production network's intrusion prevention).

**Window rule.** The AFL API match timer fires daily 05:00 to 05:15 AEDT, so the P-A timer check (no `afldb` timer within 100 minutes) holds only from about 05:20 AEDT until about 03:20 AEDT the next day. Choose a daytime window. Nothing in this release depends on the season calendar.

## 5. Variables (paste at the start of every session)

```bash
# workstation (Git Bash)
R=0f251c2daa8d7c6c38eacd559376dde41e010fd9
H=REPLACE_WITH_40_HEX_H          # from the owner approval; anything else fails safe
PKGD=docs/v2/evidence/issue334-335-release-20261105
ORIGIN_HEAD=87b6b2160a7c7e627f10646957aeeb754d04393e
```

```bash
# production, as arm
R=0f251c2daa8d7c6c38eacd559376dde41e010fd9
H=REPLACE_WITH_40_HEX_H          # from the owner approval; anything else fails safe
PKGD=docs/v2/evidence/issue334-335-release-20261105
PKGG=docs/v2/evidence/gap006-release-package-20261101    # state-probe.sh (generic: OLD_ID and NEW_ID are arguments)
OLD_ID=a0b1080f5b98-B8kdpO6PO1tUCHus0j1za                # serving; the ONLY rollback target
OLD_PREV=ea98a35f2061--vY0EFS0DdR-TiPkxTZz6              # `previous` today; NOT a rollback target
PROD_HEAD=d00e07e37566e92b35a34e62a1ff03e173715e87
ROOT=/home/arm/afldb-releases
CHK=/home/arm/projects/afldb
N=/home/arm/.nvm/versions/node/v22.23.2/bin/node
NEWFILE=/home/arm/i334-335-new-id.txt                     # written by D2; read by D3 and by recovery
```

If P-A reads a different serving release, `previous`, checkout head or `origin/main` than recorded above, **stop**: the package is re-derived from the observed state, never edited in place to fit it.

## 6. Preflight (all read-only; nothing has changed before D0)

Each block runs in a subshell with `set -euo pipefail`; the first failed assertion stops it and prints no PASS line. Any failure is a STOP: do not adjust an expected value.

**W0 (Claude, workstation).**

```bash
( set -euo pipefail; [[ $R =~ ^[0-9a-f]{40}$ ]]; [[ $H =~ ^[0-9a-f]{40}$ ]]; cd /d/dev/afldb
  [ "$(git rev-parse HEAD)" = "$H" ]                                          # the working tree is H
  [ -z "$(git status --porcelain | grep -v '^?? \.codex/$' || true)" ]        # clean, apart from untracked .codex/
  bash "$PKGD/static-delta-check.sh" "$H"                                     # prints STATIC DELTA CHECK PASS or exits 1
  [ "$(git ls-remote origin refs/heads/main | cut -f1)" = "$ORIGIN_HEAD" ]    # nobody pushed since
  echo "W0 PASS"
)
```

**P-A (production, as `arm`; no sudo).**

```bash
( set -euo pipefail; [[ $R =~ ^[0-9a-f]{40}$ ]]; cd "$CHK"
  [ "$(git rev-parse HEAD)" = "$PROD_HEAD" ]; [ -z "$(git status --porcelain)" ]
  [ -z "$(ls "$ROOT"/*.lock 2>/dev/null || true)" ]
  [ "$(readlink "$ROOT/current")"  = "releases/$OLD_ID" ]; [ "$(readlink "$ROOT/previous")" = "releases/$OLD_PREV" ]
  for id in "$OLD_ID" "$OLD_PREV"; do [ -d "$ROOT/releases/$id" ]; done
  "$N" deploy/release.mjs status                                              # exit 0 only on STATUS PASS (writes nothing)
  "$N" deploy/release.mjs verify "$OLD_ID"                                    # the pinned rollback target still matches its manifest
  bash "$PKGG/state-probe.sh" "$OLD_ID" - --expect OLD_SERVING
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

**Go/no-go:** W0 PASS and P-A PASS with J1 read. Then D0.

## 7. Execution (owner-attended; budgets, not a schedule; an overrun is a STOP)

**D0 push (owner, workstation).** Fast-forward only, no force. Review `git log --oneline 87b6b216..H` first: it is the typecheck test fix `9a8b17cf`, the fix `06459e99`, the fixture correction `0f251c2d` and the documentation commits after it.

```bash
( set -euo pipefail; [[ $H =~ ^[0-9a-f]{40}$ ]]; cd /d/dev/afldb
  [ "$(git rev-parse HEAD)" = "$H" ]
  [ "$(git ls-remote origin refs/heads/main | cut -f1)" = "$ORIGIN_HEAD" ]
  git push origin "$H:refs/heads/main"                                        # no --force: a non-fast-forward is rejected
  [ "$(git ls-remote origin refs/heads/main | cut -f1)" = "$H" ]
  echo "D0 PASS"
)
```

**D1 fast-forward the production checkout (Claude as `arm`, or the owner).** The only change before the build; it does not touch the running site. The static check runs again on production, from `H`'s own bytes:

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

**D2 build (`arm`, inside `tmux`; budget 20 min).** Run once. The build is of `R`, not `H`. It refuses to start if `NEWFILE` exists. The route's own guards apply unchanged (admission `MemAvailable` at least 2,100 MB with the off-host switch, free disk at least 6 GB, guard floor 384 MB).

```bash
( set -euo pipefail; [[ $R =~ ^[0-9a-f]{40}$ ]]; cd "$CHK"
  [ ! -e "$NEWFILE" ]
  [ "$(git rev-parse HEAD)" = "$H" ]; [ -z "$(git status --porcelain)" ]
  bash "$PKGG/state-probe.sh" "$OLD_ID" - --expect OLD_SERVING
  "$N" deploy/release.mjs build --checkout "$CHK" --revision "$R" \
    --afldb-env production --typecheck off-host --smoke-paths /players,/clubs,/seasons \
    --typecheck-evidence "next typegen && tsc --noEmit exit 0 on Linux (streamanator, node v22.23.2) for a verified shallow clone of 0f251c2daa8d; 2026-11-05; docs/v2/issue334-335-release-approval-2026-11-05.md section 3" \
    2>&1 | tee /home/arm/i334-335-d2-build.log
  NEW_ID=$(sed -n 's/^release: RELEASE READY \([^ ]*\) .*$/\1/p' /home/arm/i334-335-d2-build.log | tail -n 1)
  [[ $NEW_ID =~ ^0f251c2daa8d-[A-Za-z0-9_-]+$ ]]
  "$N" deploy/release.mjs verify "$NEW_ID"
  [ "$(readlink "$ROOT/current")"  = "releases/$OLD_ID" ]                     # a build never moves a link
  [ "$(readlink "$ROOT/previous")" = "releases/$OLD_PREV" ]
  bash "$PKGG/state-probe.sh" "$OLD_ID" "$NEW_ID" --expect OLD_SERVING
  echo "$NEW_ID" > "$NEWFILE"; echo "D2 PASS NEW_ID=$NEW_ID"
)
```

Any `REFUSED`, guard abort or failure is a STOP with `current` and `previous` untouched and `NEWFILE` unwritten; nothing is promoted, so nothing needs recovery. A MemAvailable floor under about 900 MB is a signal to stop and look, not to retry.

**D3a promote (Claude as `arm`, or the owner).**

```bash
( set -euo pipefail; [[ $R =~ ^[0-9a-f]{40}$ ]]; cd "$CHK"
  NEW_ID=$(cat "$NEWFILE"); [[ $NEW_ID =~ ^0f251c2daa8d-[A-Za-z0-9_-]+$ ]]
  bash "$PKGG/state-probe.sh" "$OLD_ID" "$NEW_ID" --expect OLD_SERVING
  "$N" deploy/release.mjs promote "$NEW_ID"          # previous becomes OLD_ID; the running service is unchanged until it restarts
  bash "$PKGG/state-probe.sh" "$OLD_ID" "$NEW_ID" --expect NEW_SELECTED_OLD_RUNNING
  [ "$(readlink "$ROOT/previous")" = "releases/$OLD_ID" ]
  echo "D3a PASS"
)
```

**D3b restart (owner only):** `sudo systemctl restart afldb`, at least 30 s after the last start (about 15 to 30 s of downtime).

**D3c check (Claude as `arm`, or the owner).**

```bash
( set -euo pipefail; [[ $R =~ ^[0-9a-f]{40}$ ]]; cd "$CHK"
  NEW_ID=$(cat "$NEWFILE"); [[ $NEW_ID =~ ^0f251c2daa8d-[A-Za-z0-9_-]+$ ]]
  bash deploy/post-install-check.sh "$NEW_ID"        # waits up to 60 s for health; prints POST-INSTALL CHECK PASS or FAIL
  bash "$PKGG/state-probe.sh" "$OLD_ID" "$NEW_ID" --expect NEW_SERVING
  journalctl -u afldb --since '10 minutes ago' --no-pager | grep -F 'serving build' | tail -n 1 | grep -q "release $NEW_ID revision 0f251c2daa8d"
  [ "$(grep -c '^AFLDB_SETTLE_TRIGGER=systemd$' .env)" = 1 ]
  bash /home/arm/c5-observe-20261102-r3.sh timer "$H"   # read-only: match timer enabled+active with a future elapse, Brownlow and AFL Tables timers off, setting still true
  echo "D3c PASS"
)
```

If `arm` cannot read the journal, the owner runs that one line. A `CACHE` line for the old build ID is an old edge copy and does not fail the check; every `FAIL` does.

**D4 acceptance (budget 20 min).** This release changes no rendered UI, so there is no visual obligation. Acceptance is that the fixes are present in the serving bundle and the site is healthy; **the two refusals themselves are not exercised on production** (a cross-origin POST needs a signed-in session's cookie, and exercising the deletion refusal needs a match deletion). Their runtime proof is the Linux qualification in section 3.

```bash
( set -euo pipefail; cd "$CHK"; NEW_ID=$(cat "$NEWFILE"); [[ $NEW_ID =~ ^0f251c2daa8d-[A-Za-z0-9_-]+$ ]]
  "$N" deploy/release.mjs verify "$NEW_ID"                                    # the serving bytes match the manifest built from R
  bash "$PKGG/state-probe.sh" "$OLD_ID" "$NEW_ID" --expect NEW_SERVING          # the running process is NEW_ID (D3c: journal names revision 0f251c2daa8d)
  grep -rlF 'active manual coach assignment' "$ROOT/releases/$NEW_ID/.next/standalone/.next/server" | grep -q .   # ISSUE-335 text: exists only from R on
  echo "D4 PASS (serving revision R, manifest-verified; refusals proven on Linux, not on production)"
)
```

ISSUE-334 has no literal unique to `R` (its refusal text is shared with the retired upload route, which the old release also serves), so its presence on production rests on provenance: the serving process runs `NEW_ID`, built from `R` and manifest-verified, and `R`'s media route carries the check (section 3).

Optional, the owner's own act while signed in: re-upload an existing image on `/admin/content` under its existing name (a same-origin upload; it replaces that image and writes one `content.media_uploaded` audit row). It must succeed. Skipping it is allowed and is recorded as "same-origin upload not exercised on production".

**Decision.** Accept (D3c PASS and D4 PASS) or recover. If D4 is not complete and passing within 60 minutes of D3b, recover.

## 8. Stop and recovery (state-aware; no database action is ever part of a rollback)

**The rule.** Recovery always names the pinned outgoing release: `rollback --to "$OLD_ID"`. **An unqualified `rollback` is forbidden**: before a promotion it would select `OLD_PREV`, not the serving release. Never roll back or restart a release the probe shows as unchanged and healthy.

```bash
( set -u; cd "$CHK"; NEW_ID=$(cat "$NEWFILE" 2>/dev/null || echo -); bash "$PKGG/state-probe.sh" "$OLD_ID" "$NEW_ID" )
```

| STATE | Meaning | Action |
|---|---|---|
| `OLD_SERVING` | `OLD_ID` selected, running, healthy | Preserve and stop; report. No rollback, no restart |
| `NEW_SELECTED_OLD_RUNNING` | promoted, not restarted | Abandon: **R2**. Continue: D3b |
| `NEW_SERVING` | restarted and healthy on `NEW_ID` | D3c, D4. If a gate fails or 60 minutes pass: **R3** |
| `NEW_SELECTED_FAILED` | `NEW_ID` selected, unit down or unhealthy (probe again after 60 s first) | **R3** |
| `OLD_SELECTED_NEW_RUNNING` | links back at `OLD_ID`, process still `NEW_ID` | **R4** |
| `TRANSIENT` | unit `activating` | change nothing; probe again in 15 s |
| `UNCERTAIN` | anything else | **R5: act on nothing** |

**R2 (links only, no restart):**

```bash
( set -euo pipefail; cd "$CHK"
  NEW_ID=$(cat "$NEWFILE"); [[ $NEW_ID =~ ^0f251c2daa8d-[A-Za-z0-9_-]+$ ]]
  bash "$PKGG/state-probe.sh" "$OLD_ID" "$NEW_ID" --expect NEW_SELECTED_OLD_RUNNING
  "$N" deploy/release.mjs rollback --to "$OLD_ID"
  bash "$PKGG/state-probe.sh" "$OLD_ID" "$NEW_ID" --expect OLD_SERVING
  bash deploy/post-install-check.sh "$OLD_ID"
  echo "R2 PASS"
)
```

**R3 (after the restart).** Keep the evidence first: `systemctl status afldb --no-pager`; `journalctl -u afldb --since '15 minutes ago' --no-pager`. Then:

```bash
( set -euo pipefail; cd "$CHK"
  NEW_ID=$(cat "$NEWFILE"); [[ $NEW_ID =~ ^0f251c2daa8d-[A-Za-z0-9_-]+$ ]]
  [ "$(readlink "$ROOT/current")" = "releases/$NEW_ID" ]    # roll back only when NEW_ID is the selected release
  "$N" deploy/release.mjs rollback --to "$OLD_ID"           # current -> OLD_ID, previous -> NEW_ID (retained)
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

**R4:** the owner restarts, then the second R3 block verifies. **R5 (`UNCERTAIN`):** run nothing that changes state; collect read-only the probe output, `ls -l "$ROOT"`, `"$N" deploy/release.mjs status`, `systemctl status afldb --no-pager`, `journalctl -u afldb --since '30 minutes ago' --no-pager`, `ls "$ROOT"/*.lock`; keep every log and report. If `rollback --to "$OLD_ID"` refuses because `OLD_ID` fails its manifest check, that is also R5.

A rollback restores the serving release only; the checkout stays at `H` (a fast-forward is not undone). There is no data to reverse: the release writes nothing to the database. Nothing is deleted: `OLD_ID`, `OLD_PREV` and `NEW_ID` all stay.

## 9. Owner approval (one complete statement; nothing is granted until the owner writes it)

```text
I, Stuart, approve the ISSUE-334/ISSUE-335 application release to afldb-prod: push head <H, 40 hex> (qualified revision 0f251c2daa8d7c6c38eacd559376dde41e010fd9), fast-forward the production checkout to it, build revision 0f251c2daa8d7c6c38eacd559376dde41e010fd9 with --typecheck off-host and the route's unchanged resource guards, promote the new release, and restart afldb, exactly as docs/v2/issue334-335-release-approval-2026-11-05.md sections 5 to 8, in the window <start> to <end> AEDT on <date>, outside 05:00 to 05:20 AEDT. The release also carries the GAP-029 admin-draft refactor already on main (section 2). The outgoing release is a0b1080f5b98-B8kdpO6PO1tUCHus0j1za and is the only rollback target. I will push and run every sudo command and the restart myself. Claude may, as arm without sudo, run the preflight, the fast-forward, the build, the promotion, the checks and any recovery that needs no sudo. No schema change, no database write, no timer, setting or .env change, no Brownlow step, no manual settle.
```

After acceptance: record the outcome in ISSUE-334 and ISSUE-335 (`issues.md`) and close each only on D3c PASS plus D4 PASS, stating what was and was not exercised on production.
