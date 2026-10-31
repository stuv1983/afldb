# V2-GAP-006 editor protections: release package (owner-attended)

Status: **PREPARED, NOT EXECUTED.** Nothing in this package has been pushed, deployed or run against production.
It deploys the **editor protections only** (Option E1). Database-level enforcement and every other writer stay
separate V2-GAP-006 requirements, so **V2-GAP-006 stays open**. ISSUE-331 stays open (below). It uses the installed
non-destructive release route (`deploy/release.mjs`, AFLDB-ISSUE-329; `docs/deployment.md` §3a) exactly as AFLDB-ISSUE-330
did (`issues/closed/AFLDB-ISSUE-330.md` §4). There is **no calendar window** here: the sequence is relative to `T0`, the
moment the owner starts.

## 1. Candidate and outgoing state

| | |
|---|---|
| **Candidate (build revision) `C`** | `fd48ace0c2cb70296d723603aa397b5bd7a21a0d`, tree `01b3e6855516d22238013f58114e9f19d7ec75d7` |
| Package commit `R` | the documentation-only child of `C` that adds this file; get it with `git rev-parse HEAD` on the workstation. `git diff --name-only C R` must list only `docs/`, `CHANGELOG.md`, `IssuesIndex.md`, `issues.md` |
| **Outgoing (running) release** | `ad245d602f6f-m0M8pf121326vNSo2B759` (revision `ad245d602f6f0776c1fd86b66fef4f177fe63276`, `BUILD_ID` `m0M8pf121326vNSo2B759`), per `issues/closed/AFLDB-ISSUE-330.md` §5, 2026-10-31. **Re-verify at P2; any difference is a STOP** |
| Outgoing checkout | `/home/arm/projects/afldb` at `65c02ecc29f93cec8410e01c91f4fc293002b774`, clean |
| Last known `origin/main` | `63c945ae4b492ec59dfd29c960783341fab96933` (a documentation child of `65c02ecc`); verify with `git ls-remote origin refs/heads/main` at P1 |
| Rollback target (retained) | `ad245d602f6f-m0M8pf121326vNSo2B759` becomes `previous` at promotion. Deeper retained releases: `61a95f7397da-JYIBkYn8ynPgYMn1e5nK-`, `9ed9c9dd3e84-QNEHXAtU53TzUjj0Mb7mv` |

Chain from production: `65c02ecc` → `63c945ae` (ISSUE-330 record) → 12 further commits to `dd2c0e79` → `C` (one test-only
commit). The editor work is `f2563e01` (seal on the audited editors), `fc9e07c4` (note-length bypass, form keep),
`c02e6d4f` (correction text kept out of record notes; F-001 proved on PostgreSQL) and documentation/evidence commits.

**What the code delta is** (`git diff ad245d60 C`, the running release against the candidate):

| Scope | Result |
|---|---|
| Bundle content (`src/`, `packages/`) | 62 files, +997 / −168 |
| Whole runtime-relevant delta (`src packages tools deploy data package.json package-lock.json next.config.ts`) | 65 files, +1,663 / −168 |
| **Migrations, dependencies, lockfile, `deploy/`, `data/`, `next.config.ts`, `tsconfig.json`, `tools/maintenance`** | **none** (the diff is empty) |
| Tests changed | 18 files |

No schema change, no new dependency, no change to the release route, units or environment. The database is not touched
by this release, so there is **no database rollback**.

## 2. What it changes, and what it does not

**Changes.** Every audited admin editor mutation that touches a sealed or unknown season is refused unless it carries a
human-written correction note of 20-2000 characters; the refusal rolls the whole transaction back. Open seasons are
unchanged. On the real registry every season up to **2026 is sealed** and only **2027 is open**
(`data/reference/seasons.json`), so from the moment of release an admin edit of any record in 1897-2026 needs a note.
The note is the private audit note (`data_edits.note`); a list entry's or appointment's own text is separate. The forms
gain a shared "Correction note" control with its rule text and a 2000-character cap, and keep typed values after a refusal.

**Does not change.** No database-level enforcement (a writer that bypasses the editors is not stopped). Direct library
calls, legacy loaders (V2-GAP-011, V2-GAP-013), the AFL Tables settle, ISSUE-316 tooling and ad hoc SQL bypass the editors.
No writer is activated, no provider is contacted, no Brownlow is recorded, backfilled, adopted or published.

## 3. Validation (actual results)

### 3.1 Workstation (reused, not repeated)

All on fresh disposable clones of the approved baseline on the recovered guarded cluster
(`docs/v2/gap006-release-readiness-2026-11-01.md`): unit 94/94 for the three editor-action suites; integration 6 files /
210 passed (final); F-001 on real PostgreSQL (Brownlow season and eligibility publication refuse an absent or short human
note on a sealed season, with negative controls); negative controls for the F-003 tests (9 failed on the pre-fix query
files); `tsc --noEmit` clean; eslint on changed lines clean; headed Chromium journeys 15/15 at 1280x800 and 390x844 with 0
page errors and no overflow (sealed halves labelled `SYNTHETIC-REGISTRY`); the authentic Brownlow production-correction
suite **8/8** on the retained artefacts (`docs/v2/evidence/gap006-brownlow-cases-20261101/`). Independent reviews reused:
one of the original mutation coverage and one of the final corrective diff (no HIGH or MED production defect; MED and
LOW findings fixed).

### 3.2 Linux qualification on streamanator (this milestone)

Evidence: `docs/v2/evidence/gap006-linux-qualification-20261101/` (scripts and `evidence/`). Host `streamanator`
(10.0.40.100), Ubuntu 24.04.5, kernel 6.8.0-147-generic, 24 cores, Node v22.23.2, PostgreSQL 16.15. New workspace
`/home/arm/afldb-v2-gap006-linux-20261101`; the host's own listeners (5432, 3000, 3100) and services were observed and
never used or changed.

| Check | Result |
|---|---|
| Candidate bytes | `git archive` of `dd2c0e79` streamed (sha256 `df644283…17c3`): **3,746/3,746 blobs equal `git ls-tree`**, 0 bad, 0 missing, 0 extra, 0 mode differences. `C` adds one test file; re-verified blob for blob against `C`'s tree: 3,746/3,746, 0 bad (the only extras are workspace-generated `__pycache__` files, `next-env.d.ts` and the hash-verified retained inputs) |
| Dependencies | private copy of the host's installed `node_modules`; `package-lock.json` sha256 `984b4422…` (the previously lock-checked file); lock check **427 ok, 125 optional-other-platform absent, 0 bad**; nothing installed, nothing upgraded |
| Resources before start | MemAvailable about 27.9 GB of 32 GB; disk **98% used, 7.1 GB free** (a constraint, see 3.3); load 0.3 |
| Cluster | new `afldb_v2_isolated` on **127.0.0.1:55481** (free beforehand), private root; listener executable, data directory and loopback binding proven before any write; five roles, none superuser; every database carries the isolation marker; every run through `tools/v2/isolated-pg.ts run`, which strips inherited `PG*`/DSN variables |
| Baseline | approved dump `659e471b…` (1,642 TOC entries, 4 extension entries excluded), ledger 115, 16,838 matches 1897-2025, 13,273 players; migrations 116 and 117 applied through the runner (ledger 117); privileges applied |
| Core editor + publication integration (21 files) | **653 passed, 0 failed, 5 skipped** on `dd2c0e79` (with the importer venv and retained inputs; see 3.3 for the first pass). `C` changes only the test file in the coupled group, which core does not import |
| Import/settle-coupled integration (9 files) | **315 passed, 0 failed, 0 skipped** on `C`. The first rerun on `dd2c0e79` had 314 passed and 1 failed (finding 3 below); after the one-file fix on `C` the whole group was rerun: 315/315 |
| Coleman publication, own schema-only target | **28/28** |
| Unit suites (207 files outside `tests/integration`, `tests/nl-ui` and the route suite) | **11,528 passed, 0 failed, 1 skipped** |
| Release-route suite `tests/deploy-release.test.ts` | **33/33** |
| `npm run typecheck` (`next typegen && tsc --noEmit`) | **exit 0** on `C`. Cold run on `dd2c0e79`: 2 min 0 s, peak RSS 2.69 GB. Then on `C`: 13 s, exit 0; `tsconfig` is `incremental`, so only the one changed test file was re-checked against the cold run's build info. `C` differs from `dd2c0e79` by that one test file |
| eslint (82 changed TypeScript/JS files since production) | 43 problems, **all inherited** (37 errors, 6 warnings on lines this work did not touch; `tools/v2/lint-changes.mjs` against `65c02ecc` reports `newFindings: 0`) |
| Isolated production-mode build (`AFLDB_ENV=production`, `AFLDB_BUILD_TYPECHECK=off-host`, 1 worker, 3072 MB heap) | exit 0 in **3 min 16 s**, peak process RSS **1.59 GB**, `.next` 2.0 GB, BUILD_ID rSVb1o9pLmyr_Js4jKCXN; `prepare-standalone` verified the bundle holds no `.env*` |
| Boot smoke of that bundle on loopback 3197 against a disposable DB | `/api/health` ok/ok; own `_buildManifest.js` 200; `/`, `/players`, `/clubs`, `/seasons` 200; 0 error lines in the server log; the port was freed afterwards |

Not run on Linux, with reasons: the **Brownlow production-correction suite** (done 8/8 on the workstation on the
retained authentic artefacts; the instruction was not to repeat artefact recovery); `isolated-populated-lifecycle`
(imports the changed modules but is a populated-rebuild lifecycle suite needing its own reference-data target);
`brownlow-pending-populated` (skips unless a populated rebuild is armed); the NL corpora and browser sweeps (unrelated);
a build through `release.mjs build` itself (it runs `npm ci`, which would download; the production run is the first use of
the exact route on this revision, with its own V1-V6 gates).

### 3.3 Failures and corrections during the Linux pass (disclosed in full)

1. **First pass, environmental.** Coleman (4 of 28) and 94 unit tests failed, and the core/coupled groups showed 172 and 1
   skips, because the first pass ran **without the host's Python venv** (`psycopg` missing) and **without the Git-ignored
   data inputs** two suites need. The venv (`/home/arm/projects/afldb/.venv`, used read-only with
   `PYTHONDONTWRITEBYTECODE=1`) and the retained `inputs.tar` (sha256 `42822c75…`, 785/785 files hash-verified, unsafe
   paths 0, extracted only into this workspace) were then supplied and everything affected was rerun: Coleman 28/28, unit
   11,528/0, core 653/0, coupled as above. The first-pass reports are kept (`lx-*`).
2. **Disk admission.** `tests/deploy-release.test.ts` refused at 5.0 GB free (the route requires 6 GB). The host's disk is
   98% full; no retained evidence was deleted. The suite builds under the OS temp directory, so it was rerun with
   `TMPDIR` on the host's RAM-backed `/dev/shm` (nothing else changed): 33/33. `deploy/` and the test are identical to
   the running release's.
3. **A real finding, fixed in `C`.** `tests/integration/draftguru-import.test.ts` ("leaves an administrator-created player
   and selection standing through a reload") creates an admin draft selection in the next unseen year. On this baseline
   that year is **2026, a sealed season**, so the seal correctly refused the note-less write. The test is about reload
   survival, not the seal, so `C` gives it a synthetic 20+ character note (3 lines, test only; the runtime is unchanged).
   This suite was not in the earlier workstation file set, which is why it first failed here. It is a fixture
   correction, not a weakened assertion, and not a production defect.
4. **Correction to the readiness record.** `gap006-release-readiness-2026-11-01.md` said Coleman publication was not
   re-run because its code was unchanged. `src/db/queries/coleman-award-winners.ts` does change (it now names its
   workflow to the seal). Coleman was therefore run here: 28/28.

## 4. Production preflight (all read-only except the checkout fast-forward in D1)

Do these before `D0`. Any failed item is a STOP (section 7); nothing has been changed yet at that point.

| # | Where | Check | Expected |
|---|---|---|---|
| P1 | workstation | `git rev-parse HEAD`; `git status --short`; `git diff --name-only fd48ace0c2cb70296d723603aa397b5bd7a21a0d HEAD -- . ':!docs' ':!CHANGELOG.md' ':!IssuesIndex.md' ':!issues.md'`; `git ls-remote origin refs/heads/main` | `R`; clean (apart from untracked `.codex/`); **empty**; `63c945ae4b492ec59dfd29c960783341fab96933` |
| P2 | production, `arm` | `cd /home/arm/projects/afldb; git rev-parse HEAD; git status --porcelain`; `N=/home/arm/.nvm/versions/node/v22.23.2/bin/node; $N deploy/release.mjs status`; `ls /home/arm/afldb-releases/*.lock` | `65c02ecc29f93cec8410e01c91f4fc293002b774`; empty; `current ad245d602f6f-m0M8pf121326vNSo2B759`, `previous 61a95f7397da-JYIBkYn8ynPgYMn1e5nK-`, **STATUS PASS**; no lock |
| P3 | production | `ls /home/arm/afldb-releases/releases/` | contains `ad245d602f6f-m0M8pf121326vNSo2B759`, `61a95f7397da-JYIBkYn8ynPgYMn1e5nK-` and `9ed9c9dd3e84-QNEHXAtU53TzUjj0Mb7mv` |
| P4 | production | `git fetch origin` is **not** done yet. After D0: `git diff --name-only 65c02ecc29f93cec8410e01c91f4fc293002b774 fd48ace0c2cb70296d723603aa397b5bd7a21a0d -- src/db/migrations package.json package-lock.json deploy data next.config.ts` | **empty** (no migration, no dependency, no route change). Any entry is a STOP |
| P5 | production | `free -m`; `df -h /home/arm`; `systemctl show -p MemoryCurrent afldb`; `systemctl list-timers --all \| grep -i afldb`; `pgrep -a -f 'pg_dump\|rsync\|restore'` | **MemAvailable at least 2,100 MB** (the tool re-checks; floor 384), **free disk at least 6 GB**, no afldb timer due and no backup, restore or maintenance job running inside the window |
| P6 | production, owner (`sudo -u postgres psql -X -d <production database>`, read-only) | the privilege query below | `afldb_import` and `afldb_app` each hold `SELECT` and `INSERT` on `public.data_edits`, `afldb_import` holds `USAGE` on `data_edits_id_seq`, and **neither holds UPDATE, DELETE or TRUNCATE** |
| P7 | production, owner (same session) | `SELECT count(*), max(name) FROM afldb_meta.schema_migrations;` | 117 rows, `117_brownlow_provider_eligibility_unknown.sql` (nothing to migrate) |
| P8 | production | `grep -c '^AFLDB_IMPORT_DATABASE_URL=' /home/arm/projects/afldb/.env` (count only, never print the value) | `1` |

**Why P6 is a hard gate.** Every audited editor mutation runs as one transaction on the **import** connection
(`AFLDB_IMPORT_DATABASE_URL`, role `afldb_import`). The new code writes the audit row with `INSERT ... RETURNING id`, and
PostgreSQL requires `SELECT` on the returned column. Migration 066 gave `afldb_import` `INSERT` only; migration 108 and
`tools/maintenance/privileges.sql` add `SELECT`. If the grant were absent on production, **every editor write would fail
closed** ("permission denied for table data_edits"). Production is at ledger 117 so 108 should be applied, but privileges
can be reset by a privileges run, so verify the live grant rather than the ledger.

```sql
-- P6 (read-only). Run inside: BEGIN READ ONLY; ... ROLLBACK;
SELECT r.rolname,
       has_table_privilege(r.rolname, 'public.data_edits', 'SELECT')   AS sel,
       has_table_privilege(r.rolname, 'public.data_edits', 'INSERT')   AS ins,
       has_table_privilege(r.rolname, 'public.data_edits', 'UPDATE')   AS upd,
       has_table_privilege(r.rolname, 'public.data_edits', 'DELETE')   AS del,
       has_table_privilege(r.rolname, 'public.data_edits', 'TRUNCATE') AS trunc,
       has_sequence_privilege(r.rolname, 'public.data_edits_id_seq', 'USAGE') AS seq
  FROM pg_roles r WHERE r.rolname IN ('afldb_app', 'afldb_import') ORDER BY 1;
-- expected: both roles sel=t ins=t upd=f del=f trunc=f; afldb_import seq=t
```

If `afldb_import` lacks `SELECT`, **do not deploy**. Apply the grant through the normal privileges route as its own
owner-approved step (it is SELECT only, the migration-108 shape, `GRANT SELECT ON TABLE public.data_edits TO afldb_import`),
then repeat P6. That is a database change and outside this package's authority.

## 5. Build and resource requirements

- **Build revision:** `C`, built by `release.mjs build` from `git archive` of `C` in the production checkout (`C` must
  exist there, which D1 ensures). Output `RELEASE READY fd48ace0c2cb-<BUILD_ID>`; call it `NEW_ID`.
- **Off-host type-check evidence (required by `--typecheck off-host`):** the exact-candidate type-check is
  `docs/v2/evidence/gap006-linux-qualification-20261101/evidence/typecheck.log` (exit 0 for `typegen` and `tsc --noEmit` on `C`; the cold-run log for `dd2c0e79`, whose non-test tree is identical, is `typecheck.dd2c0e79.log`). The in-build type-check is the
  memory peak that caused the 2026-10-31 OOM, so it stays off-host. The Linux type-check alone peaked at 2.69 GB RSS,
  which production cannot spare.
- **Admission (tool re-checks, refuses below):** `MemAvailable` at least **2,100 MB** with `--typecheck off-host`, free
  disk at least **6 GB**; guard floor 384 MB (the build's process group is killed below it, `oom_score_adj` 1000). Production
  has **no swap**, 3,915 MB total, idle MemAvailable 2,783-3,038 MB.
- **Expected cost:** ISSUE-330's comparable build took 227 s with a minimum MemAvailable of 1,274 MB. This candidate adds
  62 bundle files and no dependency; the Linux dev-host build (24 cores, plentiful memory) took 3 min 16 s with a 1.59 GB
  peak process RSS. Expect a few minutes and a similar memory floor; treat a floor under about 900 MB as a signal to stop
  and look, not to retry blindly.
- **Disk after:** a release is about 0.8 GB. Nothing is deleted.
- **Run `build` inside `tmux`** (a dropped SSH session sends `SIGHUP`, which safely stops the build but wastes it).

## 6. Execution sequence (relative; owner-attended start)

`T0` is when the owner says go. Times are budgets, not a schedule. If a step overruns its budget, treat it as a STOP
condition for that step (section 7), not as a reason to continue.

**`T0+0` to `T0+15` P1-P8.** Go/no-go at `T0+15`. No change has been made.

**`T0+15` D0. Push (owner, workstation).** Fast-forward only, no force; `origin/main` must still be `63c945ae…`:

```bash
git push origin <R>:main
git ls-remote origin refs/heads/main      # must print R
```

**`T0+20` D1. Production checkout fast-forward (`arm`).** This is the only change before the build, and it does not
touch the running site or the in-place bundle:

```bash
cd /home/arm/projects/afldb
N=/home/arm/.nvm/versions/node/v22.23.2/bin/node
git fetch origin && git merge --ff-only origin/main      # 65c02ecc -> R
git rev-parse HEAD; git status --porcelain               # R; empty
git cat-file -e fd48ace0c2cb70296d723603aa397b5bd7a21a0d^{commit} && echo "C present"
git diff --name-only 65c02ecc29f93cec8410e01c91f4fc293002b774 fd48ace0c2cb70296d723603aa397b5bd7a21a0d -- src/db/migrations package.json package-lock.json deploy data next.config.ts   # P4: empty
$N deploy/release.mjs status                              # still ad245d602f6f-m0M8pf121326vNSo2B759, STATUS PASS
```

**`T0+25` D2. Build (`arm`, inside `tmux`; budget 20 min).**

```bash
$N deploy/release.mjs build --checkout /home/arm/projects/afldb --revision fd48ace0c2cb70296d723603aa397b5bd7a21a0d \
  --afldb-env production --typecheck off-host --smoke-paths /players,/clubs,/seasons \
  --typecheck-evidence "npm run typecheck exit 0 (next typegen && tsc --noEmit) on Linux (streamanator, Ubuntu 24.04.5, node v22.23.2) for git archive of fd48ace0 (tree 01b3e685); 2026-11-01; docs/v2/evidence/gap006-linux-qualification-20261101/evidence/typecheck.log"
```

Expect `RELEASE READY fd48ace0c2cb-<BUILD_ID>`. Any `REFUSED`, guard abort or failure is a STOP with `current` and
`previous` untouched (the release route's own guarantee).

**`T0+45` D3. Promote, restart, check.**

```bash
$N deploy/release.mjs promote NEW_ID          # previous becomes ad245d602f6f-m0M8pf121326vNSo2B759
sudo systemctl restart afldb                  # owner; at least 30 s after the last start; the only downtime (about 15-30 s)
$N deploy/release.mjs status --expect NEW_ID
bash deploy/post-install-check.sh NEW_ID      # proves m0M8pf121326vNSo2B759 is absent at the origin
journalctl -u afldb --since '5 minutes ago' | grep 'serving build'
```

The journal must log `serving build <BUILD_ID> release NEW_ID revision fd48ace0…`. A `CACHE` line for
`m0M8pf121326vNSo2B759` is an old Cloudflare copy and does not fail the check; every `FAIL` does.

**`T0+55` D4. Authenticated visual acceptance (owner signs in; section 8).** Budget 20 min.

**`T0+75` decision.** Accept (all gates passed) or roll back (D5). **`T0+90` hard end:** if D4 is not complete and
passing by then, roll back.

**D5. Rollback on any failed gate** (no build, `npm` or Git; budget 5 min):

```bash
$N deploy/release.mjs rollback                # current -> ad245d602f6f-m0M8pf121326vNSo2B759; previous -> NEW_ID
sudo systemctl restart afldb                  # owner; at least 30 s after the last start
$N deploy/release.mjs status --expect ad245d602f6f-m0M8pf121326vNSo2B759
bash deploy/post-install-check.sh ad245d602f6f-m0M8pf121326vNSo2B759
```

Rolling back needs **no database action**: there is no migration, and rows the new code wrote (audit rows in
`data_edits`, notes) are valid under the old code because the schema is unchanged. If the restart itself fails (the unit
does not become active), read `systemctl status afldb` and `journalctl -u afldb`; the first recovery is the rollback above.

## 7. Stop and recovery conditions

| Condition | Action |
|---|---|
| P1-P8 not exactly as expected (including `afldb_import` lacking `SELECT` on `data_edits`, a different running release, a dirty checkout, a lock, or a timer or backup in the window) | **STOP before D0.** Nothing changed. Re-plan; do not adjust the expected values |
| `git push` rejected, or `origin/main` is not `63c945ae…` | STOP; do not force |
| D1: non-fast-forward, `C` absent, or any migration/dependency/deploy/data/config entry in the P4 diff | STOP; production checkout may be left at its fast-forward (harmless) |
| MemAvailable under 2,100 MB or free disk under 6 GB (admission), or the build is `REFUSED`, aborted by the guard or exceeds its budget | STOP; `current`/`previous` untouched; no swap, no service stop, no lowered threshold |
| `promote` refuses, or the restart does not leave the unit active within about 60 s | Run D5 |
| `status --expect NEW_ID` fails, or `post-install-check.sh` prints any `FAIL`, or the journal shows an error loop or a build/release other than `NEW_ID` | Run D5 |
| D4 fails any gate (section 8), a page errors, or the role is not Super Admin after sign-in | Run D5 and record the failure |
| An editor write fails with "permission denied" in the journal | Run D5; this is the P6 condition appearing late |
| D4 not complete and passing by `T0+90` | Run D5 |
| Anything unexpected | Stop, run nothing further, keep every log, and report |

## 8. Authenticated visual acceptance (D4)

The owner signs in; the script only **navigates**. It never fills, clicks, submits or posts, never reads cookies,
storage or form input, and discards the browser context. The real refusal behaviour is **not** exercised live because that
would need a write against production data; it is proved on real PostgreSQL by the integration suites and by the visual
journeys, and this step proves the deployed UI carries the control that states the rule.

```bash
# on the workstation, repository root; <dir> must not exist
node docs/v2/evidence/gap006-release-package-20261101/live-accept-gap006.mjs <new-empty-evidence-dir> [--match-id <existing match id>]
```

Passing means, at 1440x900 and 390x844, for `/admin/awards/winners/new`, `/admin/draft/new` and
`/admin/records/first-kick-goal/new` (and the data editor for `--match-id` when given): status 200; the shared
`Correction note` control is present with the exact rule text ("Required when this changes a sealed (completed) season:
20-2000 characters ..."), a 2000-character cap and a label bound to the textarea; no horizontal overflow; no bad static
asset; no console error. The visible role must be Super Admin. `/admin/season-lists` and `/admin/player-links` are
captured for the owner's eye and are not gates. Inspect the screenshots; **prose approval is not evidence**, and a missing
capture is recorded as `VISUAL: UNVERIFIED`.

Optional negative control: run the same script **before D0** against the still-running old release. It must report
`FAIL` on the `correction-note-control` checks only, which proves the check discriminates; it is not a gate.

## 9. Retention and what remains open

- Nothing is deleted. Both earlier releases (`61a95f73…`, `9ed9c9dd…`), the running release (`ad245d60…`), the checkout's
  in-place bundle, manifests, backups and build logs stay. Backup retention review: no earlier than 2026-11-30.
- **V2-GAP-006 stays open:** database-level enforcement (not implemented; owner decision pending), the other writers
  above, and this deployment until D4 passes.
- **ISSUE-331 stays open.** Recovering the isolated environment does not explain the disappearance of the cluster
  root's files or the drift of the frozen rehearsal store. No cause is attributed. The frozen stores and the
  credentials-exposed WSL stores were not used for any of this.
- **Artefact limitation preserved.** The authentic Brownlow artefacts were verified against the host's own `SHA256SUMS` and
  by recomputation, but the earlier local records kept only hash prefixes: this is consistency with the record, not a
  proven historical full-hash match. The 8/8 Brownlow result is isolated-test evidence only.

## 10. Exact remaining owner actions

1. Read this package and `docs/v2/gap006-release-readiness-2026-11-01.md`; decide whether to proceed and when `T0` is.
2. At `T0`, run P1 (workstation) and P2-P8 (production; P6/P7 need the owner's `sudo -u postgres`).
3. D0: `git push origin <R>:main` (fast-forward only).
4. D1-D3: as written; **the owner runs `sudo systemctl restart afldb`**.
5. D4: sign in as Super Admin and run the acceptance script; look at the screenshots.
6. Accept, or run D5. Then record the outcome (a closing note in this file and in `CHANGELOG.md`/`issues.md`
   as the owner directs).

Not authorised and not done by this package: pushing, any production-host access, deployment, writer activation, provider
acquisition, or any real Brownlow recording, backfill, adoption or publication.
