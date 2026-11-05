# AFLDB-ISSUE-336 — DEV deployment recommendation (consolidated, pinned)

Prepared 2026-11-06. **Nothing here has been run against DEV.** This is the single procedure for moving DEV (`streamanator`,
`~/projects/afldb`, `afldb_dev`) from its DEV-only `242fa276` onto the published V2 line at an exact commit. It supersedes the earlier
outline in `docs/v2/evidence/issue336-draft-categories-20261105/dev-preview-20261106/README.md` §4. Evidence for every claim:
`docs/v2/evidence/issue336-draft-categories-20261105/dev-preview2-20261106/README.md`. Ledger: `issues.md` → AFLDB-ISSUE-336, -337, -338.

Three things are kept distinct:

| Track | State |
|---|---|
| ISSUE-336 implementation (draft categories) | On `origin/main` `ea9bddf8`. |
| ISSUE-337 fix (NBSP name search) and pinned `sync-dev` | Local commit `8b024098`, **not pushed**. Verified in the isolated preview. |
| DEV deployment | **Not done.** Needs the approvals in §0. Production release and the I336 production insert need their own, separate approvals (`AFLDB-ISSUE-336.md`). |

## 0. Owner approvals required (each separate)

| # | Approval | Recommendation |
|---|---|---|
| A1 | **Publish:** fast-forward `origin/main` from `ea9bddf8` to the branch head `claude/issue-336-draft-categories`, which contains `8b024098` and later records-only commits. | Approve. The pinned deploy refuses a commit that is not on `origin/main` (exit 34). |
| A2 | **Acknowledge the DEV-only behaviour that stops running** (§4): ISSUE-271 F4/F5 and ISSUE-272 lapsed with their retired paths under D-V2-SCOPE-20261027; ISSUE-326 is a test-only change with no recorded decision; ISSUE-327 is parked (amendment 5), and its 17-venue span widening **stays in DEV's data**. | Acknowledge as recorded. Nothing in this procedure restores DEV-only behaviour. |
| A3 | **Timer disposition:** keep both settle timers enabled and unchanged (§5). | Keep. This mirrors production's accepted "do not pause the timer". |
| A4 | **The DEV deployment itself**, steps 1–8 of §6, in a window outside 04:45–05:45 AEDT (17:45–18:45 UTC). | Approve after A1–A3. |

## 1. The pin

* **Revision:** `8b024098a6771fc5e5be2f8bf006c9c3ca8ab55a` (tree `5242abe13560c1f7c12536aacfab8595278f0931`). This is the exact revision
  built, served and tested in the preview. Records-only commits published after it in A1 do not change the pin.
* **Mechanism:** `deploy/sync-dev.ps1 -ExpectedRevision <40-hex>` (new in `8b024098`). After `git checkout <RemoteRef>` it runs
  `afldb_checkout_pinned_revision` instead of `git pull --ff-only`, and refuses **before** `npm ci`, migration or build when:
  * the id is malformed (exit 30);
  * HEAD is detached (31);
  * the object is missing (32);
  * the branch has no upstream (33);
  * the pin is not on the upstream (34);
  * the branch has diverged from the pin (35);
  * the fast-forward fails (36);
  * HEAD is not exactly the pin afterwards (37).

  It never resets, cleans, forces or pulls. Coverage:
  * 8 new cases in `tests/sync-dev-remote.test.sh`: 26/26 pass locally and on Linux.
  * 20 static assertions in `tests/sync-dev-static.test.ps1`. The 20th was added after `8b024098` (test-only): the largest real
    variant, step 6, has a payload of 20,760 base64 characters against the 24,000 limit.
* **Why the pin is needed:** without it, `sync-dev` pulls to whatever `origin/main` is at deploy time.

## 2. Verified in isolation (streamanator; DEV untouched, health identical before and after every part)

| Check | Result |
|---|---|
| Typecheck, ESLint (pin) | rc 0; ESLint has one pre-existing warning (`draft.ts` `_total`). |
| ISSUE-337 unit tests | Fail against `ea9bddf8`'s `draft.ts`, pass with the fix. Parity with migration 099's 18 separators is asserted. |
| ISSUE-337 integration (DEV-data copy) | 263 passed, against 262 before. The six data-dependent failures are unchanged. |
| ISSUE-337 HTTP on the DEV-data preview | `q=Jake Long`: 0 rows at `ea9bddf8` → 2 at the pin. The NBSP form gives 2 on both. |
| Browser, desktop 1280×900 and mobile 390×844 | **76/76 at the pin.** The same script against `ea9bddf8` scores 72/76: the four failures are exactly the ordinary-space and lower-case Jake Long checks. |
| HTTP smoke, about 40 routes | First preview and pin are identical in status and error markers. |
| Migrations 111–118 on a restore of DEV | Clean; ledger 110 → 118; `privileges.ts` rc 0; a re-run applies nothing. |
| **Rollback:** `242fa276` (from the off-host-verified preservation bundle) on the 118 schema over DEV data | Old migrator: "110 file(s), 118 already applied … Nothing to apply" (rc 0). Old build rc 0; served on `:33363`. All 36 smoke routes give the same status as the pin, with 0 error markers. |
| **Backup procedure, rehearsed as written** (`scripts/dev-backup-verify.sh`) | Read-only dump in 12 s. Restore exit 0 with 0 stderr lines. 18/18 table counts and the ledger equal the live read. 111–118 plus privileges clean on the copy. `BACKUP-VERIFIED`. |
| Timers at the pin, offline against DEV's own labels | See §5. |
| `draft-linkage` on production data with production's bridge child (v3) | 11/11 (§8). |

## 3. Configuration compatibility (DEV `.env`, names only)

* **Present on DEV:** `AFLDB_AUTH_DATABASE_URL`, `AFLDB_BACKUP_DATABASE_URL`, `AFLDB_BASE_URL`, `AFLDB_BETA_GATE`=on,
  `AFLDB_EMAIL_INTAKE_SECRET`, `AFLDB_ENV`, `AFLDB_IMPORT_DATABASE_URL`, `AFLDB_LEGACY_SQLITE`, `AFLDB_MAX_FILTERS`,
  `AFLDB_MAX_PAGE_SIZE`, `AFLDB_OWNER_DATABASE_URL`, `AFLDB_POOL_MAX`=10, `AFLDB_SESSION_SECRET`, `AFLDB_STATEMENT_TIMEOUT_MS`,
  `AFLDB_TEST_DATABASE_URL`, `AFLDB_TRACE_REQUESTS`=on, `AFLDB_WORKERS`=4, `DATABASE_URL`, `PORT`=3100.
* **The pin requires nothing new.**
  * `AFLDB_BETA_EPOCH` absent → 1.
  * `AFLDB_EXTERNAL_API_USER_AGENT` absent → the built-in default.
  * `AFLDB_REVALIDATE_*` are optional.
  * `AFLDB_AFL_API_BROWNLOW_ENABLED` stays absent (§5).
* **`-Issue107Gate` preconditions are met as they stand:** `AFLDB_TRACE_REQUESTS=on`, `AFLDB_WORKERS=4`, `AFLDB_POOL_MAX=10`.
* **Units:** `afldb.service`, both settle services and timers, and `deploy/afldb-settle-afl-api*.sh` are byte-identical between DEV's
  base `ff100dc2` and the pin. The installed units match `deploy/` and `afldb.service` has no drop-ins.
  * So: **no unit copy, no `daemon-reload`, no sudo.**
  * `deploy/release-route.conf` is production-only and must not be installed on DEV.
* **Working tree:** DEV has 10 untracked files: one `.env.bak-issue272-u1b-20261010-191158` and nine settle manifests.
  * All 10 are on `sync-dev`'s known-operational allowlist (`sync-dev-remote.sh`), so the classifier proceeds.
  * None is tracked at the pin, so `git checkout` cannot collide.
  * **Leave all 10 in place.** The earlier README's claim that the `.env.bak` file blocks the classifier was wrong and is corrected there.

## 4. DEV-only behaviour that stops (from the legacy archive, `ff100dc2..242fa276`)

| Item | What DEV runs today | After the switch | Basis |
|---|---|---|---|
| ISSUE-271 F4 | `deleteMatch` refuses a match with an active `data_overrides` row of `entity_type='matches'` | Not present. V2 keeps the D-257-5 and ISSUE-335 guards. DEV has **0** active match overrides today (production 64), so nothing would be orphaned now. | D-V2-SCOPE-20261027: lapses with the retired path |
| ISSUE-271 F5 | Reader timeouts in the retired `pipeline.ts` | Path retired | Same |
| ISSUE-272 | Venue preservation in the retired settle path | Path retired | Same |
| ISSUE-326 | Test-only fix | No runtime effect | No owner decision recorded |
| ISSUE-327 | R1 resolver (retired path), R2 offline tool | Code not present | Parked (amendment 5) |
| ISSUE-327 data | R2 apply widened 17 venues' `last_season` 2025 → 2026 | **Stays in `afldb_dev`.** The switch does not revert data, so DEV differs from production in those 17 spans. | Parked; no revert decided |

**DEV-only commits are not lost.** They stay on local `main` (left at `242fa276`), in the off-host-verified preservation bundle
`dev-main-and-stashes-20261106.bundle` (sha256 `7e286772…6349`), and in the legacy archive.

## 5. Timers after the switch, and states to preserve

Both timers run scripts and `.env` straight from `~/projects/afldb`, so they pick up the pin on their next firing. No restart of
either timer is needed or recommended.

* **`afldb-settle-afl-api-brownlow.timer` (every 5 minutes):** the wrapper exits before Node because
  `AFLDB_AFL_API_BROWNLOW_ENABLED` is absent.
  * Verified at the pin: "Nothing to do", rc 0.
  * DEV logged 576 such runs in two days. No database contact, same as production, where the gate is also absent.
  * Note: `site_settings` `acquisition.afl_api_brownlow_enabled` is `"true"` on DEV, but the shell gate is what decides.
* **`afldb-settle-afl-api.timer` (daily 05:00 AEDT + up to 15 min, `Persistent=true`):**
  * At the pin, `seasons.json` gives `last_season` 2027, `in_progress` [2027], and sealed seasons 1897–2026.
  * Verified against DEV's own 2026 label: `--validate-only` gives 218 units, rc 0, no connection. `--dry-run` refuses with
    "season 2026 is sealed", rc 1, before any database client.
  * So the next nightly acquires **2027** from AFL.com.au and, until the 2027 fixture appears (production expects 2027-03-16), writes
    an empty batch. DEV's 2026 data is never rewritten again.
  * This is production's accepted state.
  * `Persistent=true` means a run missed during the window fires once at the next timer start. No timer is stopped in this
    procedure, so this does not arise.
* **States to preserve:**
  * both timers enabled and active;
  * unit files untouched, and no `daemon-reload`;
  * `.env` byte-identical (sha256 recorded in step 1);
  * `AFLDB_AFL_API_BROWNLOW_ENABLED` absent;
  * local `main` at `242fa276`;
  * 2 stashes;
  * the 10 untracked files;
  * the off-host bundle.
* **Alternative to A3, if the owner prefers no nightly 2027 fetches on DEV:** `sudo systemctl disable --now afldb-settle-afl-api.timer`
  (owner, sudo), recorded as a DEV deviation. Not recommended; it diverges DEV from production.

## 6. Procedure (after A1–A4)

Run from the workstation in Windows PowerShell; DEV is reached as `streamanator`. Total DEV downtime is one service respawn.

**Step 0. Window and quiescence.** Outside 04:45–05:45 AEDT. On DEV:

```
systemctl is-active afldb-settle-afl-api.service afldb-settle-afl-api-brownlow.service
```

Both must be `inactive`; a Brownlow run lasts about a second, so re-check if one is `activating`.

**Step 1. Record the before state (read-only).** On DEV:

```
cd ~/projects/afldb
git rev-parse HEAD
git branch --show-current
git stash list | wc -l
git status --porcelain | wc -l
sha256sum .env
cat .next/BUILD_ID
systemctl show afldb -p MainPID --value
systemctl is-enabled afldb-settle-afl-api.timer afldb-settle-afl-api-brownlow.timer
```

Expect `242fa276…`, `main`, `2`, `10`, `8sFpWkolwF1yKuKbFkOir`, and both timers `enabled`.

**Step 2. Backup with restore verification.** Copy
`docs/v2/evidence/issue336-draft-categories-20261105/dev-preview2-20261106/scripts/` to DEV, then:

* **Dump (read-only):**

  ```
  bash scripts/dev-backup-verify.sh dump /mnt/ssd/afldb/backups/dev-pre-v2-<UTC stamp>
  ```

  This takes one `pg_dump -Fc` of `afldb_dev` as `afldb_backup`, plus live row counts and the ledger in a READ ONLY transaction, and a
  `SHA256SUMS`. The directory is mode 700. Expect `BACKUP-DUMPED` and ledger `110 110_…`.
* **Verify (isolated cluster only):**

  ```
  AFLDB_V2_PG_ROOT=… AFLDB_V2_PG_BIN=/usr/lib/postgresql/16/bin AFLDB_V2_PG_PORT=… \
    bash scripts/dev-backup-verify.sh verify <dir> <a clean checkout at the pin>
  ```

  This restores into a fresh marked `afldb_v2_*_test` database and requires all of: `pg_restore` exit 0 with no stderr, every count and
  the ledger equal to the live read, and migrations 111–118 plus privileges clean on that copy. Expect `BACKUP-VERIFIED`.
* **Copy off-host:** copy the directory to the workstation and compare `sha256sum -c SHA256SUMS`.

**Do not continue without `BACKUP-VERIFIED`.** The script was rehearsed end to end on 2026-11-06; see the evidence README §6.

* The isolated cluster can be the preview's own (`/mnt/ssd/afldb/workspaces/i336-preview-20261106/pg-root`, port 55499).
* The pin checkout can be `/mnt/ssd/afldb/workspaces/i336-preview2-20261106/checkout`.

**Step 3. Create the deployment branch (ref-only, no working-tree change).** On DEV:

```
cd ~/projects/afldb && git fetch --prune origin
git merge-base --is-ancestor 8b024098a6771fc5e5be2f8bf006c9c3ca8ab55a origin/main && echo published
git branch dev/v2-main 8b024098a6771fc5e5be2f8bf006c9c3ca8ab55a
git branch --set-upstream-to=origin/main dev/v2-main
```

**Step 4. Code and schema, old code still serving.** From a workstation checkout at the pin or later:

```
powershell -ExecutionPolicy Bypass -File .\deploy\sync-dev.ps1 -SshTarget streamanator `
  -RemoteRef dev/v2-main -ExpectedRevision 8b024098a6771fc5e5be2f8bf006c9c3ca8ab55a -SkipBuild -SkipRestart -SkipHealth
```

* It classifies the tree, fetches, checks out `dev/v2-main`, applies the pin (a no-op), runs `npm ci`, then `npm run db:migrate`
  (111–118, as `AFLDB_OWNER_DATABASE_URL`).
* The running service keeps serving `242fa276`'s standalone build, verified on the 118 schema in §2.
  * Workers import `.next/standalone/server.js`, which carries its own traced `node_modules`, so `npm ci` does not touch the running
    code.
  * A worker that respawns before step 6 loads the pin's `deploy/server-cluster.mjs`. The only difference is one startup log line.
* `sync-dev`'s "capture standalone build identity" step still runs. It reads DEV's existing `.next/standalone/.next/BUILD_ID`.

**Step 5. Privileges.** On DEV:

```
cd ~/projects/afldb && npm run db:privileges
```

It runs as `AFLDB_OWNER_DATABASE_URL` (`--target dev`) and must give rc 0. This is the 111–114 follow-up, and `sync-dev` does not run it.
Run it before new code serves, so the new tables are never read without grants.

**Step 6. Build, restart and gate.** From the workstation:

```
powershell -ExecutionPolicy Bypass -File .\deploy\sync-dev.ps1 -SshTarget streamanator `
  -RemoteRef dev/v2-main -ExpectedRevision 8b024098a6771fc5e5be2f8bf006c9c3ca8ab55a -Issue107Gate
```

* It repeats the pin check (no-op), then `npm ci`, then migrate ("Nothing to apply"), then build.
* It restarts: `sudo -n` if passwordless, otherwise it kills the MainPID and systemd respawns the service (`Restart=always`).
* The ISSUE-107 gate checks the live process's `AFLDB_WORKERS=4` and `AFLDB_POOL_MAX=10`.
* It then waits for readiness and requires the served build to be the one just built.

**Step 7. Acceptance (§7).**

**Step 8. Records.** Update ISSUE-336/337 with the deploy evidence; ISSUE-337 can be resolved once DEV acceptance passes.

## 7. Acceptance (all required)

1. **Git state:**
   * `git rev-parse HEAD` = `8b024098…`;
   * `git branch --show-current` = `dev/v2-main`;
   * `git rev-parse main` = `242fa276…`;
   * stashes 2, untracked 10;
   * `sha256sum .env` unchanged.
2. **Schema:** ledger 118, last `118_fixtures_unconfirmed_participants.sql`; `npm run db:migrate` reports "Nothing to apply";
   `db:privileges` rc 0.
3. **Service:** `afldb` active with a new MainPID; `/api/health` 200; the gate's `BUILD_ID` equals `.next/standalone/.next/BUILD_ID`.
4. **Browser:** `scripts/shots-acceptance.cjs` through a tunnel to `127.0.0.1:3100` must give **76/76**:
   * run with `BASE=http://127.0.0.1:3100`, `EXPECT_ALL_2021=140` and `BETA_COOKIE=<the owner's beta cookie value>` (DEV keeps its beta
     gate on);
   * Jake Long must be found for all of: an ordinary space, NBSP, and lower case.
5. **HTTP smoke:** run `BETA_COOKIE=<value> bash scripts/smoke.sh 3100` on DEV. The cookie goes into a mode-600 jar and is never put in
   argv. Compare statuses and Jake Long rows with `host/smoke-33362.txt`. Byte counts will differ because DEV keeps its beta gate on.
6. **Timers:**
   * the next Brownlow journal says "Nothing to do";
   * the next nightly journal names **season 2027** and ends `AFLDB_SETTLE_SUCCESS` or an empty batch, with no write to 2026;
   * `systemctl is-enabled` is unchanged for both timers.

## 8. Recovery

* **Before step 4 completes:**

  ```
  git switch main
  ```

  Code is back at `242fa276`. The database is unchanged unless migrate ran; if it did, see "Schema".
* **Code only, after step 6:**

  ```
  git switch main && npm ci && npm run build
  ```

  Then restart without sudo: `kill $(systemctl show afldb -p MainPID --value)`, and wait for `/api/health` 200.
  * Or run `sync-dev.ps1 -RemoteRef main -SkipMigrate`, but **not** with `-ExpectedRevision`: local `main` has no published upstream
    for `242fa276`.
  * `242fa276` builds and serves on the 118 schema (§2); its migrator applies nothing.
  * Do not delete ledger rows.
* **Schema, only if required:** the per-migration ROLLBACK statements in reverse order 118 → 111, as the owner role, then remove those
  eight ledger rows.
  * This is safe only while the 111–114 tables are empty, no fixture is unconfirmed, and no `eligible` value is NULL; check each first.
* **Whole database:** `pg_restore --clean` of the step-2 dump into `afldb_dev`.
  * Stop the service and both timers first (owner, sudo).
  * It discards every write after the dump.
  * It is a separate owner decision.
* **Branch:** `git branch -D dev/v2-main` only after switching back, and only on owner instruction.

## 9. Remaining coverage limits (not deployment blockers)

* **DEV-data integration:** six focused integration failures persist on a DEV copy, identically at base and at the pin. They are
  in `draft-linkage` and `grid-solver`.
  * DEV's draft data was never bridged: 0 bridged persons, 5 of 6,810 picks linked.
  * On production data, 4 of the 6 pass with the default child.
  * The other 2 (`draft-linkage` partition and withheld) pass 11/11 with `AFLDB_DRAFTGURU_BRIDGE=…-v3.json`, which is the child production
    carries.
  * With `v2.json`, one check fails (Dean Laidley); v3 supersedes v2.
  * The default `afldb_test` child (3,468 bridges) is not production's (3,562).
  * Limit: these suites prove production shape only with that override. DEV cannot exercise them until DEV is bridged, which is not
    proposed.
* **Frozen DraftGuru samples:** the two Stage A tests pass when the untracked `annual-html-20260826`/`person-html-20260826` snapshots are
  supplied. A clean clone lacks them by design, so those two tests remain environment-dependent.
* **AFLDB-ISSUE-338 (new, Low):** the operator-review contract's byte-identical rerun check (11a/11c) fails when two `finalize()` calls
  straddle a second boundary.
  * Cause: `build_final_document` stamps `utc_now()` (`tools/rebuild/draftguru/review_bridge_operator.py:1424`).
  * Observed once; 0 of 5 reruns failed.
  * Not a runtime defect. It is not fixed here.
* **Not verified:**
  * DEV's real `.env` under the pin. Every variable was checked by name, and none is new.
  * A live 05:00 nightly at the pin. The offline `--validate-only`/`--dry-run` evidence stands in for it.
  * The beta-gated browser run on DEV itself (acceptance item 4).
  * The DEV runtime shape. The previews ran `next start` on a single process; DEV runs `deploy/server-cluster.mjs` with four workers
    over `.next/standalone/server.js`. The pin's build produced and checked the standalone bundle. Step 6's ISSUE-107 gate and readiness
    are what prove it on DEV.
