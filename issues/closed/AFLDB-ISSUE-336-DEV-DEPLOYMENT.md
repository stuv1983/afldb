# AFLDB-ISSUE-336: DEV deployment recommendation (consolidated, pinned)

> **RESOLVED 2026-11-13 (ISSUE-336); moved from `issues/open/AFLDB-ISSUE-336-DEV-DEPLOYMENT.md`.** Executed on DEV 2026-11-07 and accepted; the §7.2 nightly was observed as predicted on 2026-11-08 and 2026-11-09. Ledger: `issues.md` → AFLDB-ISSUE-336.

Prepared 2026-11-06; **revised 2026-11-06 (r2)**.

**Executed 2026-11-07; immediate acceptance (§7.1) PASS; §7.2 overnight observation PENDING (Sun 2026-11-08 05:08:36 AEDT).**
* A1 published on 2026-11-06. A2–A4 were re-approved for 2026-11-07 after the first window passed unused.
* **One owner-approved deviation:** step 3 stopped because DEV's local branch `dev` makes `refs/heads/dev/v2-main` impossible. The
  branch is **`dev-v2-main`**, and both sync-dev runs used `-RemoteRef dev-v2-main`. Read `dev/v2-main` below as `dev-v2-main` for this
  DEV.
* Authenticated acceptance used the owner's headed sign-in (DEV's normal address, beta gate on), not a `BETA_COOKIE` tunnel.
* R1 was not needed.
* Record: `docs/v2/evidence/issue336-draft-categories-20261105/dev-deploy-20261106/README.md`.

The text below is the r2 procedure as approved. The track table's "not pushed" and "Not done" describe the state before execution.

This is the single procedure for moving DEV (`streamanator`, `~/projects/afldb`, `afldb_dev`) from its DEV-only `242fa276` onto the
published V2 line at an exact commit. It supersedes the earlier outline in
`docs/v2/evidence/issue336-draft-categories-20261105/dev-preview-20261106/README.md` §4.

Evidence:
* `docs/v2/evidence/issue336-draft-categories-20261105/dev-preview2-20261106/README.md` (preview, backup and rollback qualification);
* `docs/v2/evidence/issue336-draft-categories-20261105/dev-procedure-corrections-20261106/README.md` (r2: restart, artifact, nightly).

Ledger: `issues.md` → AFLDB-ISSUE-336, -337, -338.

**r2 corrections.** The first version is in commit `e153d82f`. r2 changes four things:
1. **Restart:** step 6 now uses the sudo-free `-RestartMethod respawn`, with measured downtime.
2. **Nightly:** the claim that the 2027 fixture "has not appeared" is withdrawn. Fixture acquisition and concluded-match ingestion are
   separated, and A3 states what the next firing will execute. The production Brownlow comparison is corrected: production's Brownlow
   timer is disabled.
3. **Recovery:** the current artifact is preserved before the build, and restored without rebuilding. The schema stays at 118, and
   destructive database steps are separate owner decisions.
4. **Acceptance:** immediate checks are split from overnight observation.

Three things are kept distinct:

| Track | State |
|---|---|
| ISSUE-336 implementation (draft categories) | On `origin/main` `ea9bddf8`. |
| ISSUE-337 fix (NBSP name search), pinned `sync-dev`, `-RestartMethod respawn` | Local commits `8b024098` (application pin) and `b82dfcea` (workstation deploy tooling), **not pushed**. Verified in isolation. |
| DEV deployment | **Not done.** Needs the approvals in §0. Production release and the I336 production insert need their own, separate approvals (`AFLDB-ISSUE-336.md`). |

## 0. Owner approvals required

| # | Approval | Recommendation |
|---|---|---|
| A1 | **Publish:** fast-forward `origin/main` from `ea9bddf8` to the head of `claude/issue-336-draft-categories`. The head contains `8b024098` (app pin), `b82dfcea` (tooling) and records-only commits. | Approve. The pinned deploy refuses a commit that is not on `origin/main` (exit 34). |
| A2 | **Acknowledge the DEV-only behaviour that stops running** (§4): ISSUE-271 F4/F5 and ISSUE-272 lapsed with their retired paths under D-V2-SCOPE-20261027; ISSUE-326 is a test-only change with no recorded decision; ISSUE-327 is parked (amendment 5), and its 17-venue span widening **stays in DEV's data**. | Acknowledge as recorded. Nothing in this procedure restores DEV-only behaviour. |
| A3 | **Timers: enablement unchanged, executed code changes.** Both timers stay enabled, with no unit, `daemon-reload` or `.env` change. Their *next firings* nevertheless run the pin's scripts, because both execute from `~/projects/afldb`. See the box below. | Keep. This matches production's accepted 2027 nightly ("do not pause the timer"). |
| A4 | **The DEV deployment**, steps 0–8 of §6, inside one bounded window (§6), including the code-only recovery R1 (§8) if a stop condition is hit. | Approve after A1–A3. |

> **A3: what changes at the next firing (from the moment step 4 switches the checkout).**
>
> * **`afldb-settle-afl-api.timer`** (daily 05:00 AEDT + up to 15 min). If the deployment completes on day D, the next firing is
>   05:00–05:15 AEDT on D+1.
>   * **Today** (`242fa276`), each night acquires the **2026** season and re-settles it: 10,464 records read, 0 inserted or updated,
>     64 refused (`foreign_source_owner`). See DEV's journal for 2026-11-06 05:08.
>   * **After the switch**, the same timer runs the pin's wrapper and `seasons.json` (in progress: [2027]):
>     * it makes two requests to AFL.com.au: a token, then the 2027 season feed;
>     * it writes one snapshot directory, `data/sources/afl_api/matches/afl-api-2027-<stamp>/` (3 files, about 270 KB);
>     * it records one `import_batches` row with 0 records read and no canonical write;
>     * until the first 2027 match concludes, every night repeats this;
>     * **DEV's 2026 data is no longer re-settled**: the pin treats 2026 as sealed and refuses it before opening any client. A later
>       provider correction to a 2026 match no longer reaches DEV automatically.
> * **`afldb-settle-afl-api-brownlow.timer`** (every 5 minutes): keeps firing. At both revisions the wrapper exits before Node because
>   `AFLDB_AFL_API_BROWNLOW_ENABLED` is absent. There is no provider or database contact.
>   * Production's Brownlow timer is **disabled**. DEV's is enabled but inert: same effect, different state. Disabling DEV's needs
>     sudo and is not proposed.

## 1. The revisions

* **Application pin:** `8b024098a6771fc5e5be2f8bf006c9c3ca8ab55a` (tree `5242abe13560c1f7c12536aacfab8595278f0931`). This is the
  exact revision built, served and tested in the preview, and the only revision DEV's checkout is moved to.
* **Deploy tooling:** `b82dfcea015c40579f4efc60d68c57480d398487`. It adds `deploy/sync-dev.ps1 -RestartMethod respawn`.
  * `sync-dev.ps1` runs **on the workstation** and generates the remote script, so steps 4 and 6 must run from a workstation checkout
    at `b82dfcea` or later.
  * An older `sync-dev.ps1` rejects the unknown `-RestartMethod` parameter before doing anything.
  * `b82dfcea` changes no application file, so the pin is unchanged.
* **Pinning mechanism:** `-ExpectedRevision <40-hex>` (from `8b024098`). After `git checkout <RemoteRef>` it runs
  `afldb_checkout_pinned_revision` instead of `git pull --ff-only`. It refuses **before** `npm ci`, migration or build on:
  * a malformed id (exit 30);
  * a detached HEAD (31);
  * a missing object (32);
  * no upstream (33);
  * a pin not on the upstream (34);
  * a diverged branch (35);
  * a failed fast-forward (36);
  * HEAD not exactly the pin afterwards (37).

  It never resets, cleans, forces or pulls.
* **Coverage:**
  * 8 cases in `tests/sync-dev-remote.test.sh` (26/26 locally and on Linux);
  * 27 assertions in `tests/sync-dev-static.test.ps1`, including the respawn variant;
  * the step-6 payload with respawn is 20,548 base64 characters against the 24,000 limit.

## 2. Verified in isolation (streamanator; DEV untouched, health identical before and after every part)

| Check | Result |
|---|---|
| Typecheck, ESLint (pin) | rc 0; one pre-existing ESLint warning (`draft.ts` `_total`). |
| ISSUE-337 unit tests | Fail against `ea9bddf8`'s `draft.ts`, pass with the fix. Parity with migration 099's 18 separators is asserted. |
| ISSUE-337 integration (DEV-data copy) | 263 passed, against 262 before. The six data-dependent failures are unchanged. |
| ISSUE-337 HTTP on the DEV-data preview | `q=Jake Long`: 0 rows at `ea9bddf8` → 2 at the pin. The NBSP form gives 2 on both. |
| Browser, desktop 1280×900 and mobile 390×844 | **76/76 at the pin.** `ea9bddf8` scores 72/76; the four failures are exactly the ordinary-space and lower-case Jake Long checks. |
| HTTP smoke, about 40 routes | First preview and pin are identical in status and error markers. |
| Migrations 111–118 on a restore of DEV | Clean; ledger 110 → 118; `privileges.ts` rc 0; a re-run applies nothing. |
| Rollback build: `242fa276` on the 118 schema over DEV data | Old migrator: "Nothing to apply". Old build served; all 36 smoke routes match the pin's statuses, with 0 error markers. |
| Backup procedure rehearsed as written | `BACKUP-VERIFIED` (dump 12 s; restore exit 0; 18/18 counts and ledger equal; 111–118 plus privileges clean on the copy). |
| **r2 R: generated `-RestartMethod respawn` restart, gate and readiness, executed** | rc 0. New MainPID; gate saw `AFLDB_WORKERS=4`, `AFLDB_POOL_MAX=10`; live BUILD_ID equals the built one; 4 workers before and after. **About 10.3 s from SIGTERM to steady service, about 7 s of it refusing.** |
| **r2 P: DEV's current artifact preserved and served without npm ci or build** | Read-only `tar` in 9 s: 907 MB, 0 `.env` entries, BUILD_ID `8sFpWkolwF1yKuKbFkOir`. Served by `242fa276`'s `server-cluster.mjs` alone (no root `node_modules`): 4 workers, that BUILD_ID; 36 routes with 0 differences from the `242fa276` build. |
| **r2 N: the pin's nightly on the authentic 2027 feed, two nights, over today's DEV backup** | rc 0 each night; one `completed` batch per night with 0 read, inserted, updated or rejected; `matches`, `player_match_stats`, `fixtures`, `data_issues`, staging unchanged. |
| **r2 O: `242fa276`'s nightly on the 118 schema, with DEV's own 2026 label** | rc 0, 10,464 read, 0 written, 64 refused: identical to DEV's real 2026-11-06 run. |
| `draft-linkage` on production data with production's bridge child (v3) | 11/11 (§9). |

## 3. Configuration compatibility (DEV `.env`, names only)

* **Present on DEV:** `AFLDB_AUTH_DATABASE_URL`, `AFLDB_BACKUP_DATABASE_URL`, `AFLDB_BASE_URL`, `AFLDB_BETA_GATE`=on,
  `AFLDB_EMAIL_INTAKE_SECRET`, `AFLDB_ENV`, `AFLDB_IMPORT_DATABASE_URL`, `AFLDB_LEGACY_SQLITE`, `AFLDB_MAX_FILTERS`,
  `AFLDB_MAX_PAGE_SIZE`, `AFLDB_OWNER_DATABASE_URL`, `AFLDB_POOL_MAX`=10, `AFLDB_SESSION_SECRET`, `AFLDB_STATEMENT_TIMEOUT_MS`,
  `AFLDB_TEST_DATABASE_URL`, `AFLDB_TRACE_REQUESTS`=on, `AFLDB_WORKERS`=4, `DATABASE_URL`, `PORT`=3100.
* **The pin requires nothing new:**
  * `AFLDB_BETA_EPOCH` absent → 1;
  * `AFLDB_EXTERNAL_API_USER_AGENT` absent → the built-in default;
  * `AFLDB_REVALIDATE_*` optional;
  * `AFLDB_AFL_API_BROWNLOW_ENABLED` stays absent (A3);
  * `AFLDB_SETTLE_TRIGGER` (on production) only enables the admin on-demand refresh, and the timers do not need it.
* **`-Issue107Gate` preconditions already hold:** `AFLDB_TRACE_REQUESTS=on`, `AFLDB_WORKERS=4`, `AFLDB_POOL_MAX=10`.
* **Units:** `afldb.service`, both settle services and timers, and `deploy/afldb-settle-afl-api*.sh` are byte-identical between DEV's
  base `ff100dc2` and the pin. The installed units match `deploy/`, and `afldb.service` has no drop-ins.
  * So: **no unit copy, no `daemon-reload`, no sudo.**
  * The unit has `Restart=always`, `RestartSec=5`, `KillMode=mixed`.
  * `deploy/release-route.conf` is production-only and must not be installed on DEV.
* **Working tree:** 10 untracked files: one `.env.bak-issue272-u1b-20261010-191158` and nine settle manifests.
  * All 10 are on `sync-dev`'s known-operational allowlist, and none is tracked at the pin.
  * **Leave all 10 in place.**
  * Nightly snapshot directories live under the ignored `data/`.

## 4. DEV-only behaviour that stops (from the legacy archive, `ff100dc2..242fa276`)

| Item | What DEV runs today | After the switch | Basis |
|---|---|---|---|
| ISSUE-271 F4 | `deleteMatch` refuses a match with an active `data_overrides` row of `entity_type='matches'` | Not present. V2 keeps the D-257-5 and ISSUE-335 guards. DEV has **0** active match overrides (production 64). | D-V2-SCOPE-20261027: lapses with the retired path |
| ISSUE-271 F5 | Reader timeouts in the retired `pipeline.ts` | Path retired | Same |
| ISSUE-272 | Venue preservation in the retired settle path | Path retired | Same |
| ISSUE-326 | Test-only fix | No runtime effect | No owner decision recorded |
| ISSUE-327 | R1 resolver (retired path), R2 offline tool | Code not present | Parked (amendment 5) |
| ISSUE-327 data | R2 apply widened 17 venues' `last_season` 2025 → 2026 | **Stays in `afldb_dev`**; DEV differs from production in those 17 spans | Parked; no revert decided |
| 2026 nightly re-settle | Nightly acquires and re-settles 2026 | Stops; the nightly moves to 2027 (A3) | Pin's `seasons.json`, as on production |

**DEV-only commits are not lost.** They stay on local `main` (left at `242fa276`), in the off-host-verified bundle
`dev-main-and-stashes-20261106.bundle` (sha256 `7e286772…6349`), and in the legacy archive.

## 5. The nightly at the pin: what it does and does not do

**Withdrawn (r1 claim).** r1 said the nightly writes empty batches "until the 2027 fixture appears (production expects 2027-03-16)".
That is wrong:
* the authentic 2027 season feed `CD_S2027014` was captured on 2026-11-01 (label `afl-api-2027-2026-11-01-012026`, sha256
  `21fd12e7…c84d`) and accepted;
* it lists 218 matches: SCHEDULED 135, PLACEHOLDER 83;
* production's first 2027 night (2026-11-03, batch 78) read exactly that feed.

Two different things must be kept apart:

| | Status | Who writes it |
|---|---|---|
| **Fixture acquisition** (the season's schedule) | Done: the feed is published and was acquired. | Production's 218 `fixtures` rows came from the separate ISSUE-229 fixture writer (Block M-b). **The nightly never writes `fixtures`.** DEV holds 3 fixture rows (all 2027), and neither this deployment nor the nightly changes that. |
| **Concluded-match ingestion** (results and player statistics) | Not yet possible: the nightly selects only CONCLUDED matches, and none exist. The first scheduled match is 2027-03-17 08:30 UTC (19:30 AEDT), so the first nightly that can ingest one is about 05:00 AEDT 2027-03-18, if the provider has concluded it by then. | The nightly settle (`matches`, `player_match_stats`, etc.). |

**Expected behaviour of each night until then.** Established offline, with no provider contact, over a copy of today's DEV backup and
the retained authentic feed (evidence r2 §3):
* the wrapper's settle step exits rc 0, with one `completed` `import_batches` row;
* that row has 0 records read, inserted, updated and rejected, and its validation records `seasonFeedMatches` 218 and
  `snapshotMatches` 0;
* the log reports "Source completeness: COMPLETE … supplied no rows" and "0 refused at the write", and ends with
  `AFLDB_SETTLE_SUCCESS label=afl-api-2027-<stamp>`;
* no canonical, fixture, issue or staging row changes, and the second night is identical;
* the exceptions report lists DEV's existing open `data_issues` and adds none.

The only parts not exercised in isolation (by instruction) are the two live provider requests. If the provider fails, the wrapper
stops at acquisition with `AFLDB_SETTLE_FAILURE` and nothing is written to the database. If the feed has changed by then, the counts
in the log change, but with no CONCLUDED match the batch stays empty.

**States to preserve:**
* both timers enabled and active;
* unit files untouched, and no `daemon-reload`;
* `.env` byte-identical (step 1 sha256);
* `AFLDB_AFL_API_BROWNLOW_ENABLED` absent;
* local `main` at `242fa276`;
* 2 stashes;
* the 10 untracked files;
* the off-host bundle;
* the step-2 dump and the step-2b artifact archive.

**Alternative to A3, if the owner prefers no nightly 2027 fetches on DEV:** `sudo systemctl disable --now afldb-settle-afl-api.timer`
(owner, sudo), recorded as a DEV deviation. Not recommended: it diverges DEV from production, where the 2027 nightly runs.

## 6. Procedure (after A1–A4)

**Window.** One owner-chosen date, starting between 08:00 and 20:00 AEDT. Steps 0–7a must finish within **2 hours** of starting step
2, and never inside 04:45–05:45 AEDT.
* If the window expires before step 4 starts, stop; nothing has changed.
* If it expires after step 4, finish to a stop condition or acceptance, or run R1 (§8).

The workstation runs Windows PowerShell from a checkout at `b82dfcea` or later; DEV is reached as `streamanator`.

**Step 0. Quiescence.** On DEV:

```
systemctl is-active afldb-settle-afl-api.service afldb-settle-afl-api-brownlow.service
```

Both must be `inactive`. A Brownlow run lasts about a second; re-check if one is `activating`.

**Step 1. Record the before state (read-only).** On DEV:

```
cd ~/projects/afldb
git rev-parse HEAD; git branch --show-current; git stash list | wc -l; git status --porcelain | wc -l
sha256sum .env; cat .next/BUILD_ID .next/standalone/.next/BUILD_ID
systemctl show afldb -p MainPID --value
systemctl is-enabled afldb-settle-afl-api.timer afldb-settle-afl-api-brownlow.timer
systemctl list-timers afldb-settle-afl-api.timer --no-pager
```

Expect:
* `242fa276…`, `main`, `2`, `10`;
* `8sFpWkolwF1yKuKbFkOir` twice;
* both timers `enabled`.

Record the MainPID and the next nightly time.

**Stop** on any difference.

**Step 2. Database backup with restore verification.** Copy
`docs/v2/evidence/issue336-draft-categories-20261105/dev-preview2-20261106/scripts/` to DEV.

* **Dump (read-only):**

  ```
  bash scripts/dev-backup-verify.sh dump /mnt/ssd/afldb/backups/dev-pre-v2-<UTC stamp>
  ```

  Expect `BACKUP-DUMPED` and ledger `110 110_…`.
* **Verify (isolated cluster only):**

  ```
  AFLDB_V2_PG_ROOT=… AFLDB_V2_PG_BIN=/usr/lib/postgresql/16/bin AFLDB_V2_PG_PORT=… \
    bash scripts/dev-backup-verify.sh verify <dir> <a clean checkout at the pin>
  ```

  Expect `BACKUP-VERIFIED`.
  * The isolated cluster can be `/mnt/ssd/afldb/workspaces/i336-preview-20261106/pg-root` (port 55499).
  * The pin checkout can be `/mnt/ssd/afldb/workspaces/i336-preview2-20261106/checkout`.
* **Off-host:** copy the directory to the workstation and check it with `sha256sum -c SHA256SUMS`.

**Stop** without `BACKUP-VERIFIED`.

**Step 2b. Preserve the current application artifact (read-only, before anything replaces build output).** On DEV, with `D` set to
the step-2 directory:

```
cd ~/projects/afldb
tar -cf "$D/dev-app-8sFpWkolwF1yKuKbFkOir.tar" .next/BUILD_ID .next/standalone
cd "$D" && sha256sum dev-app-8sFpWkolwF1yKuKbFkOir.tar > SHA256SUMS-app && sha256sum -c SHA256SUMS-app
tar -xOf dev-app-8sFpWkolwF1yKuKbFkOir.tar .next/BUILD_ID; echo
tar -xOf dev-app-8sFpWkolwF1yKuKbFkOir.tar .next/standalone/.next/BUILD_ID; echo
tar -tf dev-app-8sFpWkolwF1yKuKbFkOir.tar | grep -c '/\.env'
```

Expect `OK`, `8sFpWkolwF1yKuKbFkOir` twice, and `0`. The rehearsal took about 9 s and gave about 907 MB and 20,638 entries.

This archive is what R1 restores. It has been proven to serve without `npm ci` or a build (r2 P).

**Stop** on any difference.

**Step 3. Create the deployment branch (ref-only).** On DEV:

```
cd ~/projects/afldb && git fetch --prune origin
git merge-base --is-ancestor 8b024098a6771fc5e5be2f8bf006c9c3ca8ab55a origin/main && echo published
git branch dev/v2-main 8b024098a6771fc5e5be2f8bf006c9c3ca8ab55a
git branch --set-upstream-to=origin/main dev/v2-main
```

**Stop** without `published`.

**Step 4. Code and schema, while the old code still serves.** From the workstation:

```
powershell -ExecutionPolicy Bypass -File .\deploy\sync-dev.ps1 -SshTarget streamanator `
  -RemoteRef dev/v2-main -ExpectedRevision 8b024098a6771fc5e5be2f8bf006c9c3ca8ab55a -SkipBuild -SkipRestart -SkipHealth
```

* It classifies the tree, fetches, checks out `dev/v2-main`, applies the pin (a no-op), runs `npm ci`, then `npm run db:migrate`
  (111–118, as `AFLDB_OWNER_DATABASE_URL`).
* The running service keeps serving `242fa276`'s standalone build, which is verified on the 118 schema.
* From here on, the timers run the pin's scripts (A3).

**Stop** on a non-zero exit:
* if migrate did not run: `git switch main`, then `npm ci`;
* if it did: R1 (§8). The schema stays at 118.

**Step 5. Privileges.** On DEV:

```
cd ~/projects/afldb && npm run db:privileges
```

Require rc 0. This is the 111–114 follow-up, run before new code serves.

**Stop** on non-zero, before step 6. The old code is still serving. Diagnose, then re-run (the command is idempotent) or take R1.

**Step 6. Build, sudo-free respawn and gate.** From the workstation:

```
powershell -ExecutionPolicy Bypass -File .\deploy\sync-dev.ps1 -SshTarget streamanator `
  -RemoteRef dev/v2-main -ExpectedRevision 8b024098a6771fc5e5be2f8bf006c9c3ca8ab55a -Issue107Gate -RestartMethod respawn
```

* **Sequence:** pin check (no-op), `npm ci`, migrate ("Nothing to apply"), then `npm run build`.
  * **The build rewrites `.next` in place, under the still-running old processes.** A page that the old workers have not yet loaded
    may fail until the respawn. This is how every earlier `sync-dev` deploy behaved, and is why step 2b preserves the artifact first.
* **Restart** (`-RestartMethod respawn`):
  * **No `sudo` is attempted.**
  * The script sends `kill` (SIGTERM) to the unit's MainPID. The cluster master stops its workers and exits about 5 s later.
    systemd (`Restart=always`, `RestartSec=5`) starts a new master, which forks 4 workers over the new standalone build.
  * The script requires a new MainPID within 60 s; otherwise it fails (exit 23 if the unit is not `Restart=always`).
  * **Downtime:** about 10 s from SIGTERM to steady service, with about 7 s of refused connections (measured in r2 R). DEV's earlier
    respawns took about 10 s.
* **Gate:** the ISSUE-107 gate reads the new process's `AFLDB_WORKERS=4` and `AFLDB_POOL_MAX=10`. Readiness then requires
  `/api/health` 200 and `x-afldb-build` equal to the BUILD_ID just built.

**Stop and run R1** on:
* a build failure (the old processes are then running over a partly rewritten `.next`);
* a respawn failure;
* a gate or readiness failure.

**Step 7a. Immediate acceptance (§7.1).** Any failure → R1.

**Step 8. Records.** Update ISSUE-336 and ISSUE-337 with the deploy evidence. ISSUE-337 can be resolved on 7a. Record §7.2 as
**pending**.

## 7. Acceptance

### 7.1 Immediate: inside the window, all required

1. **Identity:**
   * `git rev-parse HEAD` = `8b024098…`;
   * branch `dev/v2-main`;
   * `git rev-parse main` = `242fa276…`;
   * stashes 2, untracked 10;
   * `sha256sum .env` unchanged;
   * `.next/BUILD_ID` = `.next/standalone/.next/BUILD_ID` = the live `x-afldb-build` header, and ≠ `8sFpWkolwF1yKuKbFkOir`.
2. **Schema:**
   * ledger 118, last `118_fixtures_unconfirmed_participants.sql`;
   * `npm run db:migrate` reports "Nothing to apply";
   * `db:privileges` rc 0.
3. **Health:** `afldb` active, with a MainPID different from step 1's. `/api/health` returns 200 with `"database":"ok"`.
4. **Four-worker runtime:**
   * `pgrep -P "$(systemctl show afldb -p MainPID --value)" | wc -l` = 4;
   * the gate saw `AFLDB_WORKERS=4` and `AFLDB_POOL_MAX=10`;
   * 40 requests to `/api/health` show `x-afldb-worker` values 1–4.
5. **Authenticated browser:** `scripts/shots-acceptance.cjs` through a tunnel to `127.0.0.1:3100` gives **76/76**.
   * Run it with `BASE=http://127.0.0.1:3100`, `EXPECT_ALL_2021=140` and `BETA_COOKIE=<the owner's beta cookie value>`; DEV keeps
     its beta gate on.
   * Jake Long is found with an ordinary space, NBSP, and lower case.
6. **HTTP smoke:** `BETA_COOKIE=<value> bash scripts/smoke.sh 3100` on DEV. The cookie goes into a mode-600 jar, never into argv.
   Statuses and Jake Long rows must match `host/smoke-33362.txt`.
7. **Timers:**
   * `systemctl is-enabled` and `is-active` are unchanged for both timers;
   * `list-timers` shows the next nightly at 05:00–05:15 AEDT on the following day;
   * the first Brownlow firing after step 6 (within 5 minutes) logs "Nothing to do" with rc 0.

### 7.2 Overnight observation: OBSERVED 2026-11-09, as predicted (see the record below the table)

The next nightly firing (05:00–05:15 AEDT, D+1) is **recorded as pending observation**. It is **not triggered manually**, and its
success is **not claimed in advance**.

After it has run, read-only on DEV:

```
journalctl -u afldb-settle-afl-api.service --since "<D+1> 04:55" --no-pager -o cat \
  | grep -E 'Season feed CD_|Applied as import batch|Source completeness|AFLDB_SETTLE_(SUCCESS|FAILURE)'
ls -d ~/projects/afldb/data/sources/afl_api/matches/afl-api-2027-* | tail -1
```

| Observed | Meaning | Action |
|---|---|---|
| `Season feed CD_S2027014: <n> match(es)`; "Applied as import batch …: 0 canonical row(s) inserted, 0 updated … 0 refused"; `AFLDB_SETTLE_SUCCESS label=afl-api-2027-…` | As predicted by r2 N | Record as observed; close the observation |
| `AFLDB_SETTLE_FAILURE` during acquisition (provider or network) | Nothing reached the database | Record. Not a recovery trigger; the next night retries. Report to the owner if it repeats. |
| Any canonical insert or update, any 2026 label, or a settle refusal | Not predicted | Report to the owner. No automatic action. |

**OBSERVED 2026-11-09 (read-only journal read, owner-authorised): as predicted (row 1); the observation is closed.**

| Firing | Feed | Batch | Write result | Marker |
|---|---|---|---|---|
| 2026-11-08 (finished 05:15:03 AEDT) | `CD_S2027014`, 218 matches (PLACEHOLDER 83, SCHEDULED 135), COMPLETE | 147 | 0 inserted, 0 updated, 0 ledger rows, 0 refused at the write, 0 rolled back | `AFLDB_SETTLE_SUCCESS label=afl-api-2027-2026-11-07-181502` |
| 2026-11-09 (finished 05:09:08 AEDT) | same | 148 (0 records read, 0 rejection rows) | same | `AFLDB_SETTLE_SUCCESS label=afl-api-2027-2026-11-08-180907` |

- **Refusal lines:** the journal's 20 "refused (foreign_source_owner)" lines are the exceptions report's listing of open canonical-apply failures, first detected 2026-10-01 (11) and 2026-10-03 (9). They are not settle refusals, and the runbook grep above does not select them. The report truncates at 20.
- **2026 labels:** none since the deploy. The newest 2026 source directories are `…-2026-11-05-…` and `…-2026-11-06-…`.
- **Brownlow and timers:** the Brownlow unit reports disabled ("Nothing to do"). Both timers are active.
- Evidence: `docs/v2/evidence/open-issues-closure-20261108/i336-nightly/`.

## 8. Recovery

**R1: code-only recovery without rebuilding (part of A4; automatic on a stop condition at step 4 after migrate, step 6, or 7a).** On
DEV, with `D` set to the step-2 directory:

```
cd ~/projects/afldb
git switch main                                           # 242fa276; dev/v2-main is kept
mv .next ".next.v2-failed-$(date -u +%Y%m%dT%H%M%SZ)"     # keep the new build for diagnosis; delete only on owner instruction
(cd "$D" && sha256sum -c SHA256SUMS-app) && tar -xf "$D/dev-app-8sFpWkolwF1yKuKbFkOir.tar"
cat .next/BUILD_ID .next/standalone/.next/BUILD_ID        # 8sFpWkolwF1yKuKbFkOir twice
kill "$(systemctl show afldb -p MainPID --value)"         # the same sudo-free respawn: about 10 s
```

Then verify:
* `/api/health` 200;
* `x-afldb-build: 8sFpWkolwF1yKuKbFkOir`;
* 4 children of the new MainPID.

Then, **before the next 05:00 AEDT nightly**, run `npm ci` (at `242fa276`).
* The restored server needs no root `node_modules`: r2 P served this exact archive without them.
* The timers' `tsx` does need them. At `242fa276` the nightly re-settles 2026 again, and is proven on the 118 schema (r2 O).
* `npm ci` does not touch the running server.

**The schema stays at 118.** That is the supported state for the old code:
* the old migrator applies nothing;
* the old app serves (r2 P);
* the old nightly settles normally (r2 O).

**Separate owner decisions: never part of R1 or any automatic recovery.** Each needs its own explicit approval.
* **Migration reversal** 118 → 111: the per-migration ROLLBACK statements, as the owner role. This is safe only while the 111–114
  tables are empty, no fixture is unconfirmed and no `eligible` value is NULL.
* **Ledger row removal** for 111–118 (only together with a reversal).
* **Whole-database restoration**: `pg_restore --clean` of the step-2 dump. It needs sudo to stop the service and both timers, and it
  discards every write after the dump, including any nightly batch.
* **Deleting** `dev/v2-main`, the `.next.v2-failed-*` directory, the dump or the artifact archive.
* **Disabling or altering either timer.**

## 9. Remaining coverage limits (not deployment blockers)

* **DEV-data integration:** six focused integration failures persist on a DEV copy, identically at base and at the pin, in
  `draft-linkage` and `grid-solver`.
  * DEV's draft data was never bridged: 0 bridged persons, 5 of 6,810 picks linked.
  * On production data, 4 of the 6 pass with the default child. The other 2 pass 11/11 with
    `AFLDB_DRAFTGURU_BRIDGE=…-v3.json`, production's child.
* **Frozen DraftGuru samples:** two Stage A tests need the untracked `annual-html-20260826`/`person-html-20260826` snapshots, so they
  remain environment-dependent.
* **AFLDB-ISSUE-338 (Low):** the operator-review rerun check (11a/11c) fails when two `finalize()` calls straddle a second boundary
  (`tools/rebuild/draftguru/review_bridge_operator.py:1424`). It is not a runtime defect.
* **Not verified before deployment, by design:**
  * DEV's real `.env` under the pin (every variable checked by name; none is new);
  * the live provider requests and the live 05:00 nightly at the pin (§7.2 pending observation; offline evidence in r2 N);
  * the beta-gated browser run on DEV itself (§7.1 item 5);
  * the old-process behaviour *during* step 6's build. Isolated runs did not rebuild under a serving process; R1 covers a failure.
