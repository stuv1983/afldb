# AFLDB-ISSUE-336 follow-up preparation — candidate `8b024098` (2026-11-06)

Isolated verification on streamanator for the pinned DEV deployment recommendation
(`issues/open/AFLDB-ISSUE-336-DEV-DEPLOYMENT.md`). **Nothing was changed on DEV.**

> **Partly superseded (2026-11-06, r2).** The evidence below stands unchanged. Its **interpretation** in §4 is superseded by
> `../dev-procedure-corrections-20261106/README.md` §5, in three places:
> * the nightly "empty batches until the fixture appears" (the 2027 feed was already captured and accepted);
> * the production Brownlow comparison (production's Brownlow timer is disabled);
> * the restart and recovery description.

DEV contact was limited to:
* read-only inspection (`runners/devcfg.sh`);
* health probes before and after each part;
* one read-only `pg_dump` as `afldb_backup`, taken in the backup rehearsal (§6).

Every part's before and after DEV health is identical:
* service active, MainPID 1677, `/api/health` 200;
* HEAD `242fa276`, 10 untracked files, `BUILD_ID 8sFpWkolwF1yKuKbFkOir`;
* both timers active.

The host files are `host/dev-health-*.txt`, plus the `rehearsal.out` header.

**Layout:**
* `host/`: small outputs copied from the host workspace `/mnt/ssd/afldb/workspaces/i336-preview2-20261106/evidence/`. The large logs stay there.
* `screens/`: browser checks.
* `backup-rehearsal/`: the rehearsal outputs.
* `scripts/`: the deployment's ready-to-run helpers.
* `runners/`: the exact rehearsal runners.

## 1. Candidate

* **Checkout:** `8b024098a6771fc5e5be2f8bf006c9c3ca8ab55a` (tree `5242abe1…`). It is a clean clone from a verified bundle with no `.env`;
  see `host/checkout.txt`.
* **Diff from `ea9bddf8`:** 9 files.
  * `src/lib/like.ts`, `src/db/queries/draft.ts`: ISSUE-337.
  * `deploy/sync-dev.ps1`, `deploy/sync-dev-remote.sh`: `-ExpectedRevision`.
  * 5 test files.
* **DraftGuru snapshots:** the frozen `annual-html-20260826` and `person-html-20260826` were supplied from the workstation; see
  `host/snapshots.txt`.

## 2. ISSUE-337 (NBSP name search)

* **Cause:** DraftGuru `player_name_raw` uses U+00A0 between words. DEV holds 6,810 such picks, 6,805 of them unlinked
  (`host/facts-devdata.json`). The search compared the raw text, so an ordinary space never matched an unlinked pick.
* **Fix:** both sides of the comparison canonicalise migration 099's 18 Unicode space separators.
  * Database side: `translate()` on the raw and display name.
  * Search term: `canonicalSpaces()`.
  * Zero-width characters are untouched, as in 099.
* **RED/GREEN:** the new unit test fails against `ea9bddf8`'s `draft.ts` (`host/red-unit.txt`) and passes at the candidate.
* **Integration (DEV-data copy):** the new `admin-draft` case passes (`host/int-devdata-337.txt`).
* **HTTP:** `q=Jake+Long` gives 0 rows at `ea9bddf8` (`:33361`) and 2 at the candidate (`:33362`); see `host/smoke-compare.txt`.
* **Browser** (`scripts/shots-acceptance.cjs`, desktop 1280×900 and mobile 390×844):
  * **76/76** at the candidate (`browser-candidate.txt`, `screens/`).
  * 72/76 at `ea9bddf8`: exactly the ordinary-space and lower-case Jake Long checks on both viewports
    (`browser-first-preview-ea9bddf8.txt`).
  * The NBSP-typed form passes on both, as expected.
  * The first run of the new script failed the Fred Rodriguez player-page check on both viewports. It read the draft page because
    the click had not yet navigated; the script now waits for the navigation.

## 3. Focused suites at the candidate

* **Typecheck:** rc 0 (`host/typecheck.log`).
* **ESLint:** rc 0, with one pre-existing warning (`draft.ts:183 _total`); see `host/eslint.log`.
* **`tests/sync-dev-remote.test.sh` on Linux:** 26 passed, including the 8 new pin cases (`host/sync-dev-remote.log`).
* **`tests/sync-dev-static.test.ps1`:** passes on the workstation with 20 assertions. The 20th was added after `8b024098`: the largest
  real variant, pinned plus `-Issue107Gate`, has a payload of 20,760 base64 characters against a 24,000 limit. Step 4's variant is 17,696.
* **Focused unit tests:** 370 passed, 1 failed, 2 skipped.
  * With the frozen snapshots supplied, the two Stage A sample tests that failed in every earlier clean-clone run now pass.
  * The one failure is the DraftGuru operator-review contract check 11a/11c: a rerun of `finalize()` must give byte-identical
    JSON/Markdown. `build_final_document` stamps `review_completed_utc` with `utc_now()`
    (`tools/rebuild/draftguru/review_bridge_operator.py:1424`), so two calls that straddle a second boundary differ.
  * In five further runs it passed every time (`host/operator-review-reruns.txt`). Registered as **AFLDB-ISSUE-338**.
* **Integration on a fresh DEV-data restore:** 263 passed, 6 failed.
  * These are the **same 6 as the first preview** (`host/int-devdata-vs-first.txt`, `host/int-devdata.fails`): five in
    `draft-linkage`, plus `grid-solver` `drafted_by_club_never_played`.
  * Cause: DEV's draft data was never bridged to players (5 of 6,810 picks linked).
* **Integration on a restore of the 2026-11-04 production dump** (sha256 `e77c307d…`, `host/proddump.txt`): 267 passed, 2 failed
  (`host/int-proddata.fails`).
  * 4 of the 6 DEV-data failures pass (`host/int-proddata-six.txt`).
  * The remaining 2 (`draft-linkage` partition and withheld) come from the test's default bridge child, the `afldb_test` derivative
    with 3,468 bridges. Production carries the universal child with 3,562 bridges.
  * With `AFLDB_DRAFTGURU_BRIDGE=data/reference/draftguru-person-bridge-20260918-v3.json`, `draft-linkage` passes **11/11**.
  * With `v2.json`, one check fails (Dean Laidley; v3 supersedes v2).
  * See `host/int-proddata-children.txt`.
* **Original failures preserved:** the first preview's evidence (`../dev-preview-20261106/`) is unchanged, apart from the corrected
  classifier sentence and a superseded note on its §4.

## 4. Timers at the candidate (offline, `host/timers-offline.txt`)

* At the pin: `seasons.json` `last_season` 2027, `in_progress` [2027]; sealed range 1897–2026.
* **Brownlow wrapper** with DEV's gate state (`AFLDB_AFL_API_BROWNLOW_ENABLED` absent): "Nothing to do", rc 0, before Node.
* **Nightly settle tool** on a read-only copy of DEV's latest acquired label `afl-api-2026-2026-11-05-180838`, with no DSN and no `.env`:
  * `--validate-only`: 218 units, rc 0, no connection opened.
  * `--dry-run`: "Refused: season 2026 is sealed historical data", rc 1, before any database client.

## 5. Rollback compatibility (`host/rollback-*.txt`, `host/smoke-candidate-vs-rollback.txt`)

* **Source:** `242fa276`, fetched from the self-contained preservation bundle (`host/rollback-source.txt`, sha256 `7e286772…`). The
  bundle was used rather than `preserve.git`, whose alternates borrow DEV's object store.
* **Database:** a fresh DEV-data restore migrated to 118, with V2 privileges rc 0.
* **Old migrator:** "110 migration file(s), 118 already applied … Nothing to apply" (rc 0).
* **Old build:** rc 0 (`BUILD_ID XOH-3WD6BtN4ue-_cKIH5`), served on `127.0.0.1:33363`.
* **Smoke:** all 36 routes have the same status and 0 error markers, as at the candidate (36/36).
* The process was stopped and the database dropped after the check.
* Two harness faults happened before this run, neither of them a rollback finding:
  * `git clone` of a bundle carrying only `refs/preserve/*` fetched nothing (`runners/prev3.sh`).
  * Running the V2 launcher from the old checkout resolved modules through the old `tsx` (`runners/prev3b.sh`).

  `runners/prev3c.sh` is the corrected run.

## 6. Backup procedure rehearsal (`backup-rehearsal/`, `runners/bkrehearse.sh`)

`scripts/dev-backup-verify.sh` was run exactly as the procedure's step 2 states.

**`dump`:**
* One read-only `pg_dump -Fc` of `afldb_dev` as `afldb_backup`: 12 s, exit 0, 0 stderr lines.
* Live counts and the ledger read in a READ ONLY transaction (ledger 110).
* Recorded in `SHA256SUMS`.

**`verify`:**
* Restore into `afldb_v2_devbk20261105191426_test`: exit 0, 0 stderr lines.
* Every one of the 18 counted tables and the ledger equal the live read. For example: players 13,365; matches 17,056;
  `player_match_stats` 695,499; `draft_picks` 6,810; `data_overrides` 120.
* Migrations 111–118 applied, `privileges.ts` rc 0, re-run "Nothing to apply", ledger 118.
* Result: `BACKUP-VERIFIED`.

**Left on the host:**
* The rehearsal dump, in the mode-700 directory `/mnt/ssd/afldb/workspaces/i336-backup-rehearsal-20261106/out/`.
* The verify database. No cleanup was authorised.

The cookie-capable `scripts/smoke.sh` gives output identical to the original on `:33362`.

## 7. Configuration and procedure facts (read-only, `runners/devcfg.sh`)

* **DEV `.env`:** variable names only; the list is in the deployment recommendation §3. No variable required by the candidate is missing.
* **Installed units:** they match `deploy/` at DEV's base. The units and settle wrappers are byte-identical between `ff100dc2` and
  the pin.
* **Untracked paths:** DEV's 10 untracked paths are all on `sync-dev`'s known-operational allowlist (`deploy/sync-dev-remote.sh:13-14`),
  and none is tracked at the pin.
* **Correction to the first preview's README §2:** it said the `.env.bak-…` file blocks the classifier. It does not.
* **Generated remote steps:**
  * Step 4: classify → `git fetch --prune` → `git checkout dev/v2-main` → `afldb_checkout_pinned_revision <pin>` → `npm ci` →
    `npm run db:migrate`.
  * Step 6 adds build, restart, the runtime check of `AFLDB_WORKERS`/`AFLDB_POOL_MAX`, and readiness against the built `BUILD_ID`.

## 8. Still running (not stopped; no cleanup authorised)

* **First preview:** `ea9bddf8` on `127.0.0.1:33361`.
* **Candidate:** `8b024098` on `127.0.0.1:33362`, pid 3989752.
* **Shared database:** both use `afldb_v2_i336prev_test` on the isolated cluster, port 55499.

Open the candidate with `ssh -N -L 33362:127.0.0.1:33362 streamanator`. It holds a copy of DEV data, including auth tables, so keep it
on loopback.
