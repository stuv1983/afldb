# V2-GAP-006 editor protections: release package (owner-attended)

Status: **PREPARED, NOT EXECUTED.** Nothing in this package has been pushed, deployed or run against production.
It deploys the **editor protections only** (Option E1). Database-level enforcement and every other writer stay
separate V2-GAP-006 requirements, so **V2-GAP-006 stays open**. ISSUE-331 stays open (below). It uses the installed
non-destructive release route (`deploy/release.mjs`, AFLDB-ISSUE-329; `docs/deployment.md` §3a) exactly as AFLDB-ISSUE-330
did (`issues/closed/AFLDB-ISSUE-330.md` §4). There is **no calendar window** here: the sequence is relative to `T0`, the
moment the owner starts.

**Revision 2 (2026-11-01, documentation and read-only helper scripts only; the build revision `C` and its validation
are unchanged).** Revision 1 sent a refused promotion to a rollback that took the route's default target, `previous`,
which before a promotion is `61a95f73…` and not the release that is serving. Revision 2: (1) pins `OLD_ID` and makes
recovery **state-aware**, with explicit-target `rollback --to` and a read-only probe that distinguishes "promotion
refused, `OLD_ID` still serving: preserve and stop" from "`NEW_ID` selected and the restart or acceptance failed:
restore `OLD_ID`" from "uncertain: inspect first" (section 7); (2) moves the static no-migration, dependency, deploy,
data and config delta check to the workstation **before D0** and repeats it on production after the fetch, binds the
fetched remote to the exact approved `R`, and fast-forwards to that pinned `R` (sections 4 and 6); (3) turns every
"expected value" comment into an enforced assertion; (4) separates Claude's permitted work from the owner's
sudo, restart, push and sign-in steps (section 4.1).

**Revision 3 (2026-11-01, P6 corrected; documentation and a SQL block only; `C` and its validation unchanged).** At T0
of revision 2 the owner ran P6 on production: `afldb_import` held `SELECT`, `INSERT` and sequence `USAGE` with no
`UPDATE`/`DELETE`/`TRUNCATE`, `afldb_app` held nothing, the ledger was 117, and the assertion exited 3. Production was
correct and the assertion was wrong: revision 2 required `SELECT`+`INSERT` for `afldb_app`, but a trace of `C` shows no
`data_edits` path uses `afldb_app` (every audit INSERT is on `afldb_import`, every audit read on `afldb_auth`; section
4.6). P6 now asserts exactly the per-role needs, reports `afldb_app` separately and never gates on it. Nothing was granted
or changed on production; the run stopped at P-B. Revision 2's W0, P-A and J1 results are superseded and are repeated for
revision 3.

## 1. Candidate and outgoing state

| | |
|---|---|
| **Candidate (build revision) `C`** | `fd48ace0c2cb70296d723603aa397b5bd7a21a0d`, tree `01b3e6855516d22238013f58114e9f19d7ec75d7` |
| Package commit `R` | the documentation-only **descendant** of `C` that carries this file and its two scripts (a commit cannot contain its own hash, so `R` is stated in the owner's approval, section 10, and equals `git rev-parse HEAD` on the workstation). `static-delta-check.sh` enforces that `git diff --name-only C R` lists only `docs/`, `CHANGELOG.md`, `IssuesIndex.md`, `issues.md` |
| **Outgoing (running) release** | `ad245d602f6f-m0M8pf121326vNSo2B759` (revision `ad245d602f6f0776c1fd86b66fef4f177fe63276`, `BUILD_ID` `m0M8pf121326vNSo2B759`), per `issues/closed/AFLDB-ISSUE-330.md` §5, 2026-10-31. **Re-verify at P2; any difference is a STOP** |
| Outgoing checkout | `/home/arm/projects/afldb` at `65c02ecc29f93cec8410e01c91f4fc293002b774`, clean |
| Last known `origin/main` | `63c945ae4b492ec59dfd29c960783341fab96933` (a documentation child of `65c02ecc`); enforced by W0 with `git ls-remote origin refs/heads/main` |
| `current` / `previous` today | `current` = `OLD_ID`; `previous` = `OLD_PREV` = `61a95f7397da-JYIBkYn8ynPgYMn1e5nK-` (enforced by P-A) |
| **Rollback target (pinned)** | **`OLD_ID` = `ad245d602f6f-m0M8pf121326vNSo2B759`, always named explicitly (`rollback --to`).** It becomes `previous` at promotion. Deeper retained releases `OLD_PREV` and `9ed9c9dd3e84-QNEHXAtU53TzUjj0Mb7mv` are not rollback targets of this package; choosing one is an owner decision |

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

## 4. Preflight (all read-only; nothing has changed before D0)

Every check below is **enforced**: each block runs in a subshell with `set -euo pipefail`, so the first failed
assertion stops the block with a non-zero status and prints no PASS line. A pasted block never closes your shell. Any
failure is a STOP (section 7.1); do not adjust an expected value.

### 4.1 Who does what

| Step | Who | Authority needed |
|---|---|---|
| W0 workstation static checks | **Claude** | local read-only Git, plus `git ls-remote origin` (read-only) |
| P-A production read-only checks | **Claude** over SSH as `arm`, or the owner | no sudo; `status` and `verify` only read |
| P-B production database checks (P6, P7), machine **afldb-prod** | **Owner only** | `sudo -u postgres psql`, read-only transaction |
| D0 push | **Owner only** | push to `origin/main` |
| D1 fetch + fast-forward, D2 build, D3a promote, D3c checks | **Claude** over SSH as `arm`, or the owner | no sudo |
| D3b / recovery restart | **Owner only** | `sudo systemctl restart afldb` |
| D4 visual acceptance | **Owner only** | signs in as Super Admin |
| Recovery `rollback --to` and its checks | **Claude** over SSH as `arm`, or the owner | no sudo |

Claude never uses `sudo`, never restarts the unit, never signs in, never pushes, and never grants a privilege.
Use **one SSH session per phase**, not one per command (bursts of SSH connections have tripped the network's intrusion
prevention before).

### 4.2 Variables

`R` is the approved package commit. **A commit cannot contain its own hash**, so this file cannot print `R`; it is
stated in the owner's approval (section 10) and is also `git rev-parse HEAD` on the workstation. Every block refuses
anything that is not 40 lowercase hex, so the unresolved placeholder fails safe. `NEW_ID` exists only after the build; D2
writes it to a file and the later blocks read it back and re-validate it.

```bash
# workstation (Git Bash) -- paste at the start of the workstation session
R=REPLACE_WITH_40_HEX_R                                # from the owner approval; anything else fails safe
C=fd48ace0c2cb70296d723603aa397b5bd7a21a0d
PKG=docs/v2/evidence/gap006-release-package-20261101
ORIGIN_MAIN=63c945ae4b492ec59dfd29c960783341fab96933
```

```bash
# production, as arm -- paste at the start of EVERY production session or SSH call
R=REPLACE_WITH_40_HEX_R                                # from the owner approval; anything else fails safe
C=fd48ace0c2cb70296d723603aa397b5bd7a21a0d
PKG=docs/v2/evidence/gap006-release-package-20261101
OLD_ID=ad245d602f6f-m0M8pf121326vNSo2B759          # running release, PINNED: the only rollback target
OLD_PREV=61a95f7397da-JYIBkYn8ynPgYMn1e5nK-        # `previous` today; NOT a rollback target for this package
OLD_DEEP=9ed9c9dd3e84-QNEHXAtU53TzUjj0Mb7mv
PROD_HEAD=65c02ecc29f93cec8410e01c91f4fc293002b774
ROOT=/home/arm/afldb-releases
CHK=/home/arm/projects/afldb
N=/home/arm/.nvm/versions/node/v22.23.2/bin/node
NEWFILE=/home/arm/gap006-new-id.txt                # written by D2; read by D3 and by recovery
```

### 4.3 W0: workstation static checks (Claude; before D0, where both commits exist)

```bash
( set -euo pipefail; [[ $R =~ ^[0-9a-f]{40}$ ]]
  cd /d/dev/afldb
  [ "$(git rev-parse HEAD)" = "$R" ]                                          # the working tree is R
  [ -z "$(git status --porcelain | grep -v '^?? \.codex/$' || true)" ]        # clean, apart from untracked .codex/
  bash "$PKG/static-delta-check.sh" "$R"                                      # section 4.4; prints PASS or exits 1
  bash "$PKG/state-probe.sh" --self-test                                      # the recovery classifier, offline
  [ "$(git ls-remote origin refs/heads/main | cut -f1)" = "$ORIGIN_MAIN" ]    # nobody pushed since
  echo "W0 PASS"
)
```

### 4.4 What the static delta check enforces

`static-delta-check.sh` (read-only, no network) fails unless **all** hold, and fails rather than passing on a missing
object: `R`, `C`, the outgoing revision, the production HEAD and `63c945ae` exist; `C`'s tree is
`01b3e6855516d22238013f58114e9f19d7ec75d7`; `C` is an ancestor of `R`; production HEAD `65c02ecc…` and `63c945ae…` are
ancestors of `R` (so the push and the production fast-forward are both fast-forwards); `git diff C R` outside
`docs/`, `CHANGELOG.md`, `IssuesIndex.md`, `issues.md` is **empty**; the **running release's revision `ad245d60…` to `C`**
and **production HEAD `65c02ecc…` to `R`** are both empty on `src/db/migrations`, `package.json`,
`package-lock.json`, `deploy`, `data`, `next.config.ts`, `tsconfig.json`, `tools/maintenance`; and the trees `src`,
`packages`, `tools`, `deploy`, `data`, `package.json`, `package-lock.json`, `next.config.ts`, `tsconfig.json` are
byte-identical in `C` and `R`. It is run **again on production** at D1, from the pinned bytes of `R` itself
(`git show "$R:$PKG/static-delta-check.sh" | bash -s -- "$R"`), after the fetch and before the fast-forward.

### 4.5 P-A: production read-only checks (Claude over SSH as `arm`, or the owner; no sudo)

```bash
( set -euo pipefail; [[ $R =~ ^[0-9a-f]{40}$ ]]; cd "$CHK"
  [ "$(git rev-parse HEAD)" = "$PROD_HEAD" ]                                  # P2: checkout still at 65c02ecc
  [ -z "$(git status --porcelain)" ]                                          # clean
  [ -z "$(ls "$ROOT"/*.lock 2>/dev/null || true)" ]                           # no build or links lock
  [ "$(readlink "$ROOT/current")"  = "releases/$OLD_ID" ]                     # P2: OLD_ID is what is selected
  [ "$(readlink "$ROOT/previous")" = "releases/$OLD_PREV" ]
  for id in "$OLD_ID" "$OLD_PREV" "$OLD_DEEP"; do [ -d "$ROOT/releases/$id" ]; done      # P3
  "$N" deploy/release.mjs status                                              # P2: exit 0 only on STATUS PASS (writes nothing)
  "$N" deploy/release.mjs verify "$OLD_ID"                                    # the pinned rollback target still matches its manifest
  avail=$(awk '/^MemAvailable:/ {print int($2/1024)}' /proc/meminfo); echo "MemAvailable ${avail} MB"
  [ "$avail" -ge 2100 ]                                                       # P5 (the tool re-checks at the build)
  free_kb=$(df --output=avail -k /home/arm | tail -n 1 | tr -d ' '); echo "free ${free_kb} KB"
  [ "$free_kb" -ge 6291456 ]                                                  # P5: 6 GB
  [ -z "$(pgrep -f '[p]g_dump|[r]sync|[r]estore' || true)" ]                  # P5: no backup, copy or restore running
  now=$(date +%s); limit=$((now + 100 * 60))                                  # P5: no afldb systemd timer inside the 90-minute window plus margin
  for t in $(systemctl list-timers --all --no-legend | awk '{for (i = 1; i <= NF; i++) if ($i ~ /^afldb.*\.timer$/) print $i}' | sort -u); do
    n=$(systemctl show -p NextElapseUSecRealtime --value "$t"); echo "timer $t next: ${n:-none}"
    [ -z "$n" ] || [ "$(date -d "$n" +%s)" -gt "$limit" ]
  done
  [ "$(grep -c '^AFLDB_IMPORT_DATABASE_URL=' "$CHK/.env")" = 1 ]              # P8: count only, the value is never printed
  systemctl show -p MemoryCurrent afldb                                       # informational
  echo "P-A PASS (and read the one judgement item below)"
)
crontab -l 2>/dev/null | grep -i afldb || echo "no afldb cron entries"       # J1: JUDGEMENT, not enforced
```

**J1 is the only judgement item.** Cron entries cannot be compared with the window mechanically: read them, and none may
fire within 100 minutes of `T0`. The nightly watcher and the AFL Tables settle have fixed early-morning times.

### 4.6 P-B: database checks P6 and P7 (owner only; machine: **afldb-prod**; read-only; fail closed)

**Machine: `afldb-prod`**, the production droplet (SSH alias `afldb`, 209.38.87.252), logged in as the owner's user with
`sudo`. The production database is `afldb_prod` (`docs/production-cutover.md`). A connection error means the name is
wrong or the access is missing: that is a STOP, never a prompt to guess another name.

**Which role does what (traced in the final candidate `C`, `git show C:<file>`).** Every `INSERT INTO data_edits` is
`recordDataEdit` (`src/db/queries/audit-log.ts`), which takes a postgres.js transaction and ends `RETURNING id`. Every
caller opens that transaction on **`AFLDB_IMPORT_DATABASE_URL`, role `afldb_import`**: the `withImportConnection` helpers
in the awards, club-leadership, coaches, draft, fixtures, season-list and special-record editors, and the direct
`postgres(importUrl)` in match-admin, match-sheet, players, awards-admin, data-edits and admin-brownlow; the Brownlow
eligibility and Coleman publications reach `recordDataEdit` through the import-role executors
(`withAwardProposalExecutor`, and `admin-brownlow`'s import connection). **Every audit read** uses
**`authSql`, role `afldb_auth`**: `audit-reader.ts` (the audit page, the per-entity history, `RecordHistory`) and
`readDraftPickRevision` (the draft editor's compare-and-swap). **No `data_edits` path uses `afldb_app`.** Its source
comments say so: `afldb_auth` is "the only application role granted SELECT" on `data_edits`, and `afldb_app` is not
registered in `afldb_meta.app_readable_tables`. Only the audit INSERT with `RETURNING` is new in `C` (the
running release inserted without it), which is what newly needs `SELECT` for `afldb_import`; the readers are unchanged.

| Role | Needs on `public.data_edits` | Asserted by P6 |
|---|---|---|
| `afldb_import` | `SELECT` (for `RETURNING id`) and `INSERT`; `USAGE` on `data_edits_id_seq`; **no** `UPDATE`, `DELETE`, `TRUNCATE` (append-only) | **yes, all** |
| `afldb_auth` | `SELECT` (audit reads); **no** `UPDATE`, `DELETE`, `TRUNCATE`. `INSERT` is not used through this role and is not asserted | **yes** |
| `afldb_app` | nothing: no editor, audit-write or audit-read path uses it | **no. Reported separately, never gated, never to be granted to satisfy this package** |

Revision 1 asserted `SELECT` and `INSERT` for `afldb_app` as well. That was wrong: it asked for a grant no code path uses,
and on production `afldb_app` correctly holds none, so the assertion failed (exit 3) on a healthy system.

```bash
# MACHINE: afldb-prod   (the production droplet; run as your sudo user)
sudo -u postgres psql -X -v ON_ERROR_STOP=1 -d afldb_prod <<'SQL'
BEGIN READ ONLY;
SELECT v.role,
       r.rolname IS NOT NULL AS present,
       CASE WHEN r.rolname IS NULL THEN NULL ELSE has_table_privilege(r.rolname, 'public.data_edits', 'SELECT')   END AS sel,
       CASE WHEN r.rolname IS NULL THEN NULL ELSE has_table_privilege(r.rolname, 'public.data_edits', 'INSERT')   END AS ins,
       CASE WHEN r.rolname IS NULL THEN NULL ELSE has_table_privilege(r.rolname, 'public.data_edits', 'UPDATE')   END AS upd,
       CASE WHEN r.rolname IS NULL THEN NULL ELSE has_table_privilege(r.rolname, 'public.data_edits', 'DELETE')   END AS del,
       CASE WHEN r.rolname IS NULL THEN NULL ELSE has_table_privilege(r.rolname, 'public.data_edits', 'TRUNCATE') END AS trunc,
       CASE WHEN r.rolname IS NULL THEN NULL ELSE has_sequence_privilege(r.rolname, 'public.data_edits_id_seq', 'USAGE') END AS seq,
       v.note
  FROM (VALUES ('afldb_import', 'ASSERTED: audit INSERT ... RETURNING in every editor transaction'),
               ('afldb_auth',   'ASSERTED: every audit read (audit pages, entity history, draft revision)'),
               ('afldb_app',    'REPORTED ONLY: no data_edits path uses it')) AS v(role, note)
  LEFT JOIN pg_roles r ON r.rolname = v.role
 ORDER BY v.role;
SELECT count(*) AS migrations, max(name) AS latest FROM afldb_meta.schema_migrations;
DO $$
DECLARE
  imp CONSTANT text := 'afldb_import';
  aut CONSTANT text := 'afldb_auth';
  app CONSTANT text := 'afldb_app';
  tbl CONSTANT text := 'public.data_edits';
  seq CONSTANT text := 'public.data_edits_id_seq';
BEGIN
  IF to_regclass(tbl) IS NULL THEN
    RAISE EXCEPTION 'P6 FAIL: public.data_edits does not exist';
  END IF;
  -- afldb_import: writes the audit row and reads it back (RETURNING), append-only.
  IF to_regrole(imp) IS NULL THEN RAISE EXCEPTION 'P6 FAIL: role afldb_import does not exist'; END IF;
  IF NOT has_table_privilege(imp, tbl, 'SELECT') THEN RAISE EXCEPTION 'P6 FAIL: afldb_import lacks SELECT on data_edits'; END IF;
  IF NOT has_table_privilege(imp, tbl, 'INSERT') THEN RAISE EXCEPTION 'P6 FAIL: afldb_import lacks INSERT on data_edits'; END IF;
  IF NOT has_sequence_privilege(imp, seq, 'USAGE') THEN RAISE EXCEPTION 'P6 FAIL: afldb_import lacks USAGE on data_edits_id_seq'; END IF;
  IF has_table_privilege(imp, tbl, 'UPDATE') OR has_table_privilege(imp, tbl, 'DELETE') OR has_table_privilege(imp, tbl, 'TRUNCATE') THEN
    RAISE EXCEPTION 'P6 FAIL: afldb_import holds UPDATE, DELETE or TRUNCATE on data_edits (it must stay append-only)';
  END IF;
  -- afldb_auth: reads the audit trail, append-only.
  IF to_regrole(aut) IS NULL THEN RAISE EXCEPTION 'P6 FAIL: role afldb_auth does not exist'; END IF;
  IF NOT has_table_privilege(aut, tbl, 'SELECT') THEN RAISE EXCEPTION 'P6 FAIL: afldb_auth lacks SELECT on data_edits'; END IF;
  IF has_table_privilege(aut, tbl, 'UPDATE') OR has_table_privilege(aut, tbl, 'DELETE') OR has_table_privilege(aut, tbl, 'TRUNCATE') THEN
    RAISE EXCEPTION 'P6 FAIL: afldb_auth holds UPDATE, DELETE or TRUNCATE on data_edits (it must stay append-only)';
  END IF;
  -- P7: the migration ledger.
  IF (SELECT count(*) FROM afldb_meta.schema_migrations) <> 117
     OR (SELECT max(name) FROM afldb_meta.schema_migrations) <> '117_brownlow_provider_eligibility_unknown.sql' THEN
    RAISE EXCEPTION 'P7 FAIL: the migration ledger is not 117 rows ending 117_brownlow_provider_eligibility_unknown.sql';
  END IF;
  -- afldb_app is reported, never asserted.
  IF to_regrole(app) IS NULL THEN
    RAISE NOTICE 'afldb_app (informational, not asserted): role absent';
  ELSE
    RAISE NOTICE 'afldb_app (informational, not asserted): select=% insert=% update=% delete=% truncate=%',
      has_table_privilege(app, tbl, 'SELECT'), has_table_privilege(app, tbl, 'INSERT'),
      has_table_privilege(app, tbl, 'UPDATE'), has_table_privilege(app, tbl, 'DELETE'), has_table_privilege(app, tbl, 'TRUNCATE');
  END IF;
  RAISE NOTICE 'P6 PASS, P7 PASS';
END $$;
ROLLBACK;
SQL
echo "P6/P7 psql exit status: $?"
```

**Expected on production** (the state you reported):
- three role rows: `afldb_import` `present=t sel=t ins=t upd=f del=f trunc=f seq=t`; `afldb_auth` `present=t sel=t upd=f del=f trunc=f`
  (`ins` is whatever it is and is not asserted); `afldb_app` `present=t sel=f ins=f upd=f del=f trunc=f` (reported only);
- one ledger row: `migrations 117` and `latest 117_brownlow_provider_eligibility_unknown.sql`;
- `NOTICE:  afldb_app (informational, not asserted): select=f insert=f update=f delete=f truncate=f`;
- `NOTICE:  P6 PASS, P7 PASS`, and `P6/P7 psql exit status: 0`.

Any `ERROR: P6 FAIL…` or `P7 FAIL…`, or a non-zero exit, is a STOP. **No grant is authorised.** If `afldb_auth` is the
role that fails, the audit pages and the draft editor were already broken under the running release; that is a finding to
report, not something this package repairs.

This SQL cannot change anything (`BEGIN READ ONLY … ROLLBACK`). It was verified on a throwaway PostgreSQL 16 cluster
(`docs/v2/evidence/gap006-release-package-20261101/p6-p7-verification.txt`); it has still not been run on production.

**Why P6 is a hard gate.** Every audited editor mutation runs as one transaction on the **import** connection. The new
code writes the audit row with `INSERT ... RETURNING id`, and PostgreSQL requires `SELECT` on the returned column.
Migration 066 gave `afldb_import` `INSERT` only; migration 108 and `tools/maintenance/privileges.sql` add `SELECT`. If the
grant were absent on production, **every editor write would fail closed** ("permission denied for table data_edits").
Production is at ledger 117 so 108 should be applied, but privileges can be reset by a privileges run, so the live
grant is verified rather than the ledger.

**If any P6 or P7 assertion fails, this is a STOP at the go/no-go. No grant is authorised by this package.** Closing a
missing privilege would be a database change needing its own owner-approved package; do not improvise one.

### 4.7 Go/no-go (`T0+15`)

W0 PASS, P-A PASS with J1 read, P-B PASS. Then D0.

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
condition for that step (section 7), not as a reason to continue. Variables are those of section 4.2. **Before any block
that follows a failure or a surprise, run the state probe (section 7.2) and act only on its STATE.**

**`T0+0` to `T0+15` W0, P-A, P-B.** Go/no-go at `T0+15`. No change has been made.

**`T0+15` D0. Push (owner, workstation).** Fast-forward only, no force. The block re-checks that the tree is `R` and that
`origin/main` is still `63c945ae…`, pushes exactly `R`, and re-reads the remote:

```bash
( set -euo pipefail; [[ $R =~ ^[0-9a-f]{40}$ ]]; cd /d/dev/afldb
  [ "$(git rev-parse HEAD)" = "$R" ]
  [ "$(git ls-remote origin refs/heads/main | cut -f1)" = "$ORIGIN_MAIN" ]
  git push origin "$R:refs/heads/main"                                        # no --force: a non-fast-forward is rejected
  [ "$(git ls-remote origin refs/heads/main | cut -f1)" = "$R" ]
  echo "D0 PASS"
)
```

**`T0+20` D1. Production checkout fast-forward (Claude over SSH as `arm`, or the owner).** The only change before the
build; it does not touch the running site or the in-place bundle. The fetched remote must equal `R` **before** anything
moves, the static delta check runs again from `R`'s own pinned bytes, and the fast-forward is to the pinned `R`, never to
whatever `origin/main` happens to be:

```bash
( set -euo pipefail; [[ $R =~ ^[0-9a-f]{40}$ ]]; cd "$CHK"
  [ "$(git rev-parse HEAD)" = "$PROD_HEAD" ]
  git fetch origin
  [ "$(git rev-parse refs/remotes/origin/main)" = "$R" ]                      # fetched remote == the approved R
  git cat-file -e "$R^{commit}"; git cat-file -e "$C^{commit}"
  git show "$R:$PKG/static-delta-check.sh" | bash -s -- "$R"                  # P4 on production, enforced
  git merge --ff-only "$R"                                                    # 65c02ecc -> R, pinned
  [ "$(git rev-parse HEAD)" = "$R" ]; [ -z "$(git status --porcelain)" ]
  "$N" deploy/release.mjs status                                              # still STATUS PASS
  bash "$PKG/state-probe.sh" "$OLD_ID" - --expect OLD_SERVING
  echo "D1 PASS"
)
```

**`T0+25` D2. Build (`arm`, inside `tmux`; budget 20 min).** Run once. The build is of `C`, not `R`. It refuses to start if
`NEWFILE` already exists, so a stale ID can never be promoted:

```bash
( set -euo pipefail; [[ $R =~ ^[0-9a-f]{40}$ ]]; cd "$CHK"
  [ ! -e "$NEWFILE" ]
  [ "$(git rev-parse HEAD)" = "$R" ]; [ -z "$(git status --porcelain)" ]
  bash "$PKG/state-probe.sh" "$OLD_ID" - --expect OLD_SERVING
  "$N" deploy/release.mjs build --checkout "$CHK" --revision "$C" \
    --afldb-env production --typecheck off-host --smoke-paths /players,/clubs,/seasons \
    --typecheck-evidence "npm run typecheck exit 0 (next typegen && tsc --noEmit) on Linux (streamanator, Ubuntu 24.04.5, node v22.23.2) for git archive of fd48ace0 (tree 01b3e685); 2026-11-01; docs/v2/evidence/gap006-linux-qualification-20261101/evidence/typecheck.log" \
    2>&1 | tee /home/arm/gap006-d2-build.log
  NEW_ID=$(sed -n 's/^release: RELEASE READY \([^ ]*\) .*$/\1/p' /home/arm/gap006-d2-build.log | tail -n 1)
  [[ $NEW_ID =~ ^fd48ace0c2cb-[A-Za-z0-9_-]+$ ]]                              # RELEASE READY fd48ace0c2cb-<BUILD_ID>
  "$N" deploy/release.mjs verify "$NEW_ID"
  [ "$(readlink "$ROOT/current")"  = "releases/$OLD_ID" ]                     # a build never moves a link
  [ "$(readlink "$ROOT/previous")" = "releases/$OLD_PREV" ]
  bash "$PKG/state-probe.sh" "$OLD_ID" "$NEW_ID" --expect OLD_SERVING
  echo "$NEW_ID" > "$NEWFILE"; echo "D2 PASS NEW_ID=$NEW_ID"
)
```

Any `REFUSED`, guard abort or failure is a STOP with `current` and `previous` untouched (the release route's own
guarantee, `docs/deployment.md` §3a) and `NEWFILE` unwritten. Nothing is promoted, so there is nothing to recover.

**`T0+45` D3. Promote, restart, check.** Three parts, in order.

*D3a. Promote (Claude over SSH as `arm`, or the owner).* Every refusal inside `promote` happens **before** a link moves
(section 7.3), and the block checks the state before and after:

```bash
( set -euo pipefail; [[ $R =~ ^[0-9a-f]{40}$ ]]; cd "$CHK"
  NEW_ID=$(cat "$NEWFILE"); [[ $NEW_ID =~ ^fd48ace0c2cb-[A-Za-z0-9_-]+$ ]]
  bash "$PKG/state-probe.sh" "$OLD_ID" "$NEW_ID" --expect OLD_SERVING
  "$N" deploy/release.mjs promote "$NEW_ID"          # previous becomes OLD_ID; the running service is unchanged until it restarts
  bash "$PKG/state-probe.sh" "$OLD_ID" "$NEW_ID" --expect NEW_SELECTED_OLD_RUNNING
  [ "$(readlink "$ROOT/previous")" = "releases/$OLD_ID" ]
  echo "D3a PASS"
)
```

If this block stops anywhere, **do not roll back or restart by reflex**: go to section 7.2.

*D3b. Restart (owner only):* `sudo systemctl restart afldb`, at least 30 s after the last start. This is the only
downtime (about 15-30 s).

*D3c. Check (Claude over SSH as `arm`, or the owner).* `post-install-check.sh` waits up to 60 s for health itself:

```bash
( set -euo pipefail; [[ $R =~ ^[0-9a-f]{40}$ ]]; cd "$CHK"
  NEW_ID=$(cat "$NEWFILE"); [[ $NEW_ID =~ ^fd48ace0c2cb-[A-Za-z0-9_-]+$ ]]
  bash deploy/post-install-check.sh "$NEW_ID"        # status --expect, origin/public assets, the previous BUILD_ID absent; prints PASS or FAIL
  bash "$PKG/state-probe.sh" "$OLD_ID" "$NEW_ID" --expect NEW_SERVING
  journalctl -u afldb --since '10 minutes ago' --no-pager | grep -F 'serving build' | tail -n 1 | grep -q "release $NEW_ID revision fd48ace0"
  echo "D3c PASS"
)
```

`post-install-check.sh` ends `POST-INSTALL CHECK PASS` or `FAIL` and exits non-zero on FAIL, which stops the block. A
`CACHE` line for `m0M8pf121326vNSo2B759` is an old Cloudflare copy and does not fail the check; every `FAIL` does. If
`arm` cannot read the journal, the owner runs that last line.

**`T0+55` D4. Authenticated visual acceptance (owner signs in; section 8).** Budget 20 min.

**`T0+75` decision.** Accept (D3c PASS and every D4 gate) or recover (section 7.2, row NEW_SERVING). **`T0+90` hard
end:** if D4 is not complete and passing by then, recover.

## 7. Stop and recovery

### 7.1 Stop conditions (before anything is promoted nothing needs recovering)

| Condition | Action |
|---|---|
| W0, P-A or P-B fails (including `afldb_import` lacking `SELECT`/`INSERT`/sequence `USAGE`, or holding `UPDATE`/`DELETE`/`TRUNCATE`, on `data_edits`, or `afldb_auth` lacking `SELECT` there, a different running release, a dirty checkout, a lock, a timer, backup or resource shortfall, or J1 not clear) | **STOP before D0.** Nothing changed. Re-plan; do not adjust the expected values. **No grant is authorised** |
| `git push` rejected, or `origin/main` is not `63c945ae…` before it | STOP; do not force |
| D1: fetched remote is not `R`, non-fast-forward, `C` absent, or the production static check fails | STOP; the checkout is untouched (the fast-forward is the last step and only follows a pass) |
| Build `REFUSED`, guard abort, admission shortfall, or over budget | STOP; `current`/`previous` untouched; no swap, no service stop, no lowered threshold |
| Anything in D3a-D4, or `T0+90` reached | **Do not act yet. Run the state probe (7.2) and act only on its STATE** |
| Anything unexpected | Stop, run nothing further, keep every log, and report |

### 7.2 State-aware recovery

**The rule.** The pinned outgoing release is `OLD_ID` = `ad245d602f6f-m0M8pf121326vNSo2B759`. Recovery always names it:
`rollback --to "$OLD_ID"`. **An unqualified `rollback` is forbidden in this package**: it selects `previous`, and before
a promotion `previous` is `61a95f73…`, not the release that is serving. Never roll back, and never restart, a release
that the probe shows as unchanged and healthy.

Probe (read-only, changes nothing; `NEW_ID` is `-` before the build exists):

```bash
( set -u; cd "$CHK"; NEW_ID=$(cat "$NEWFILE" 2>/dev/null || echo -); bash "$PKG/state-probe.sh" "$OLD_ID" "$NEW_ID" )
```

It prints the links, the unit, the service process's release directory, health and locks, then one `STATE`:

| STATE | Meaning | Action |
|---|---|---|
| `OLD_SERVING` | `OLD_ID` is selected, running and healthy: the promotion was refused or never happened, or recovery is finished | **Preserve it and stop.** No rollback (it would be refused as "already current", or, unqualified, would select `61a95f73…`), no restart. Report the refusal text. `previous` may be `61a95f73…` (never promoted) or `NEW_ID` (after a rollback); both are fine |
| `NEW_SELECTED_OLD_RUNNING` | promoted, restart not yet done (or never reached), and the old process still serves | To abandon: **R2** (links only, **no restart**: the process already runs `OLD_ID`). To continue: D3b |
| `NEW_SERVING` | restarted and healthy on `NEW_ID` | Proceed with D3c and D4. If any gate then fails, or `T0+90` passes: **R3** |
| `NEW_SELECTED_FAILED` | `NEW_ID` selected and the unit is down or unhealthy (probe again after 60 s first) | **R3** |
| `OLD_SELECTED_NEW_RUNNING` | links are back at `OLD_ID` but the process still runs `NEW_ID` (recovery interrupted before the restart) | **R4** |
| `TRANSIENT` | unit is `activating` | change nothing; probe again in 15 s |
| `UNCERTAIN` | anything else (a third release, `OLD_ID` selected but down or unhealthy, an unreadable process) | **R5: act on nothing** |

**R2. Abandon after promotion, before the restart (links only; Claude over SSH as `arm`, or the owner).**

```bash
( set -euo pipefail; [[ $R =~ ^[0-9a-f]{40}$ ]]; cd "$CHK"
  NEW_ID=$(cat "$NEWFILE"); [[ $NEW_ID =~ ^fd48ace0c2cb-[A-Za-z0-9_-]+$ ]]
  bash "$PKG/state-probe.sh" "$OLD_ID" "$NEW_ID" --expect NEW_SELECTED_OLD_RUNNING
  "$N" deploy/release.mjs rollback --to "$OLD_ID"    # current -> OLD_ID, previous -> NEW_ID; no service action
  bash "$PKG/state-probe.sh" "$OLD_ID" "$NEW_ID" --expect OLD_SERVING
  bash deploy/post-install-check.sh "$OLD_ID"
  echo "R2 PASS: OLD_ID selected, the unchanged process left running"
)
```

**R3. Failure after the restart (including acceptance failure): restore the pinned `OLD_ID`.** First capture the
evidence for the record: `systemctl status afldb --no-pager`; `journalctl -u afldb --since '15 minutes ago' --no-pager`.

```bash
( set -euo pipefail; [[ $R =~ ^[0-9a-f]{40}$ ]]; cd "$CHK"                    # Claude over SSH as arm, or the owner
  NEW_ID=$(cat "$NEWFILE"); [[ $NEW_ID =~ ^fd48ace0c2cb-[A-Za-z0-9_-]+$ ]]
  [ "$(readlink "$ROOT/current")" = "releases/$NEW_ID" ]    # roll back only when NEW_ID is the selected release
  "$N" deploy/release.mjs rollback --to "$OLD_ID"           # current -> OLD_ID, previous -> NEW_ID (retained, not deleted)
  [ "$(readlink "$ROOT/current")"  = "releases/$OLD_ID" ]
  [ "$(readlink "$ROOT/previous")" = "releases/$NEW_ID" ]
  echo "R3 links restored; the restart below is owed"
)
```

Then **the owner** runs `sudo systemctl restart afldb` (at least 30 s after the last start; if the unit reports
`start-limit-hit`, `sudo systemctl reset-failed afldb && sudo systemctl start afldb`). Then:

```bash
( set -euo pipefail; [[ $R =~ ^[0-9a-f]{40}$ ]]; cd "$CHK"                    # Claude over SSH as arm, or the owner
  NEW_ID=$(cat "$NEWFILE"); [[ $NEW_ID =~ ^fd48ace0c2cb-[A-Za-z0-9_-]+$ ]]
  bash deploy/post-install-check.sh "$OLD_ID"
  bash "$PKG/state-probe.sh" "$OLD_ID" "$NEW_ID" --expect OLD_SERVING
  echo "R3 PASS: OLD_ID serving"
)
```

**R4. Links already at `OLD_ID`, process still `NEW_ID`.** The owner restarts, then the second R3 block above verifies.

**R5. `UNCERTAIN`: run nothing that changes state.** Collect read-only: the probe output; `ls -l "$ROOT"`;
`"$N" deploy/release.mjs status` (its failures are information); `systemctl status afldb --no-pager`;
`journalctl -u afldb --since '30 minutes ago' --no-pager`; `ls "$ROOT"/*.lock`. Keep every log and report. If
`rollback --to "$OLD_ID"` itself refuses because `OLD_ID` fails its manifest check, that is also R5: choosing the
deeper `OLD_PREV` is an owner decision, not a step of this package.

**No database action is ever part of a rollback.** There is no migration; rows the new code wrote (audit rows in
`data_edits`, notes) are valid under the old code because the schema is unchanged.

### 7.3 Walk-through against the installed route (`deploy/release.mjs`)

The route's real semantics, from the code, and what each scenario therefore does:

| Command | What it does to links and service |
|---|---|
| `promote <id>` (`cmdPromote`, line 1029) | Under the links lock: `verifyRelease(id)` (refuses on manifest drift) → refuses if `id` is already `current` → refuses unless the service's MainPID working directory is the current release → **only then** `previous := current`, then `current := id` (two renames). The service is not touched |
| `rollback --to <id>` (`cmdRollback`, line 1068) | Target is `--to`, **else `previous`**. Refuses if the target is already `current`; `verifyRelease(target)` (refuses on drift); warns if the target has no recorded status PASS; then `current := target` first, `previous := old current`. It does **not** read or restart the service and runs no build, `npm` or Git |
| `status [--expect id]` | Fails unless `current` is `id`, the MainPID directory is that release, health is ok/ok, `id`'s BUILD_ID manifest answers 200 and the previous release's answers 404. A PASS with `--expect` appends a `status-pass` line to `events.log` |

**Scenario 1. Promotion refused (before promotion).** Whatever refuses (lock held, manifest drift, "already current", "the
service is not running current") happens before the first rename. Result: `current` = `OLD_ID`, `previous` =
`61a95f73…`, service untouched: **`OLD_SERVING`**. The correct act is to preserve it and stop. Revision 1 of this package
sent this case to an unqualified `rollback`, which would have selected `61a95f73…` and pointed the next restart at an
older release than the one serving. Now: `rollback --to "$OLD_ID"` would be refused as "already current" (harmless), and
the package never issues it in this state. One narrow exception: a process killed between the two renames leaves
`previous` = `current` = `OLD_ID` (the probe prints `ANOMALY`); the site still serves `OLD_ID`; stop and report, and do
not re-promote without an owner decision.

**Scenario 2. Failure after promotion.** `current` = `NEW_ID`, `previous` = `OLD_ID`. (2a) Before the restart the
service still runs `OLD_ID` (`NEW_SELECTED_OLD_RUNNING`): `rollback --to "$OLD_ID"` restores the link and the already
healthy process needs **no restart** (R2). (2b) After the restart the unit is down or unhealthy (`NEW_SELECTED_FAILED`):
`rollback --to "$OLD_ID"` restores the link, then the owner restarts, and `post-install-check.sh "$OLD_ID"` proves it
(R3). `--to` is pinned although `previous` equals `OLD_ID` here, so the same command is right if a second promote or
build ever intervenes.

**Scenario 3. Acceptance failure.** The unit is healthy on `NEW_ID` (`NEW_SERVING`) but a D3c or D4 gate fails or
`T0+90` passes. Same as 2b (R3): the link is the only thing that changes, so the owner's restart is what actually
returns the site. `NEW_ID` stays retained as `previous` for diagnosis; nothing is deleted.

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

## 10. Owner approval and exact remaining actions

Execution begins only when the owner sends an approval in this shape, with `<R>` filled in (the workstation prints it:
`git rev-parse HEAD`). Nothing runs on production before then, and `T0` is whenever the owner says go; this package
fixes no calendar window.

```text
I approve execution of the GAP-006 editor-protections release package, revision 3, at R=<R>
(docs/v2/gap006-editor-protections-release-package.md), building revision
C=fd48ace0c2cb70296d723603aa397b5bd7a21a0d, outgoing release
OLD_ID=ad245d602f6f-m0M8pf121326vNSo2B759. T0 starts when I send this approval.

Claude may: run W0 on the workstation; run, as arm over SSH without sudo, P-A, D1, D2, D3a and D3c exactly as
written; run the read-only state probe; run the applicable R2/R3/R5 recovery blocks exactly as packaged; launch the
packaged read-only headed browser acceptance runner (I enter credentials and inspect the screenshots). Proceed
automatically between authorised steps; pause only for my required actions or a failed gate; label each owner
command with its machine and expected result.
I will do: P6/P7 on machine afldb-prod (sudo -u postgres, read-only), the D0 fast-forward push of exactly R from the
workstation, every production service restart, and the Super Admin sign-in and visual acceptance.

Claude must not: use sudo, restart the unit, push, grant any privilege (afldb_app included), change a schema, run an
unqualified rollback, roll back or restart a release the probe shows as OLD_SERVING, build anything other than C,
delete any retained material, or continue past a failed check. A failed P6/P7 is a STOP; no grant is authorised.
V2-GAP-006 and ISSUE-331 stay open with their limitations. Commit scoped outcome records locally; no push beyond R.
```

Remaining owner actions, in order:

1. Read this package and `docs/v2/gap006-release-readiness-2026-11-01.md`; decide whether to proceed and when `T0` is.
2. Send the approval above. At `T0`: W0, P-A and J1 run (Claude); **you** run P-B (P6/P7, machine afldb-prod).
3. D0: the push block (owner).
4. D1, D2, D3a (Claude, or you), then **you** run `sudo systemctl restart afldb` (D3b), then D3c.
5. D4: sign in as Super Admin and run the acceptance script; look at the screenshots.
6. Accept, or recover by the probe's STATE (section 7.2). Then record the outcome (a closing note in this file and in
   `CHANGELOG.md`/`issues.md` as the owner directs).

Not authorised and not done by this package: any grant or database change, a build other than `C`, deleting a retained
release, backup or frozen store, writer activation, provider acquisition, or any real Brownlow recording, backfill,
adoption or publication.

## 11. Execution record

### 11.1 Revision 2 attempt, 2026-11-01 (stopped at P-B; nothing deployed, nothing granted)

| Step | Result |
|---|---|
| T0 | the owner's approval of revision 2 at `R=41a9787c0cc9fb0e0bcef65f5cd5dc4b759cf2f7`, about 2026-10-31T22:42Z (09:42 AEDT 2026-11-01) |
| W0 (workstation) | **PASS**: HEAD `R`; clean apart from untracked `.codex/`; static delta check PASS; classifier self-test PASS; `origin/main` `63c945ae…` |
| P-A (production, `arm`, read-only) | **PASS**: checkout `65c02ecc…` clean; no locks; `current` `ad245d602f6f-m0M8pf121326vNSo2B759`, `previous` `61a95f7397da-JYIBkYn8ynPgYMn1e5nK-`; `status` PASS (process 3190377 in `OLD_ID`, health ok/ok); `verify OLD_ID` PASS (12,995 files); MemAvailable 2,970 MB; free disk about 56 GB; `.env` import-URL count 1. The one write: a transient `/home/arm/gap006-pa.sh`, copied and removed |
| J1 | **resolved**: `arm` has no crontab; nothing in `/etc/cron.*` or `/var/spool/cron` mentions afldb, settle or watcher (some paths unreadable); the 18 systemd timers are OS housekeeping, none afldb |
| P6/P7 (owner, `afldb-prod`) | **P6 FAILED, exit 3.** `afldb_import`: `SELECT`, `INSERT`, sequence `USAGE`, no `UPDATE`/`DELETE`/`TRUNCATE`. `afldb_app`: none of these. Ledger: 117 migrations as expected |
| Outcome | **STOP before D0.** No push, no fetch, no build, no promotion, no restart; `current` still `OLD_ID`, serving. No grant, no schema change |

### 11.2 Cause and correction (revision 3)

The assertion was wrong, not production. The role trace in section 4.6 shows every `recordDataEdit` INSERT (with the
new `RETURNING id`) on `afldb_import` and every audit read on `afldb_auth`; no path uses `afldb_app`, which is
deliberately not registered as a reader of `data_edits`. Revision 2's reading of the failing production state was
therefore correct and safe: `afldb_import` has what `C` needs and stays append-only. Revision 3 asserts exactly that
(plus `afldb_auth` `SELECT` and append-only), reports `afldb_app` separately and never gates on it. Verification:
`p6-p7-verify.sh` and `p6-p7-verification.txt` in `docs/v2/evidence/gap006-release-package-20261101/` (19 scenarios on a
throwaway PostgreSQL 16.15 cluster, including the production-observed state, which passes, and revision 2's block against
it, which reproduces the exit 3). `C` and its validation are unchanged.

### 11.3 Revision 3 attempt, 2026-11-01 (executed; D4 accepted on evidence)

Owner approval of revision 3 at `R=9b9c6b2acda28e4d222c04a951275bdf654da74f`. Times are UTC; AEDT is +11 h.

| Step | Result |
|---|---|
| W0, P-A, J1 (about 10:21 AEDT) | **Reported PASS** in the revision 3 session; recorded here from the owner's close-out message (2026-11-01), which restored the provenance after the session's context was cleared. The raw logs are not part of this record and were **not** re-run or independently re-verified afterwards. P-A reported the expected outgoing checkout and release, `verify` PASS, 2,887 MB MemAvailable and about 56 GB free disk. J1's wider cron inspection was **best-effort**: some paths were unreadable (as in revision 2), so absence of an afldb cron entry there is not proven |
| P6/P7 (owner, `afldb-prod`) | **PASS, exit 0**, shown by the **owner-supplied production output** (pasted into the session; the raw output is not stored in this repository). Not run or independently seen by Claude; no grant made |
| D0 push (owner) | **PASS**, shown by the **owner-supplied workstation output** (remote `main` at `R`). Claude's own read-only checks agree: `git ls-remote origin refs/heads/main` returned `R` before D1, and D1 re-read the fetched remote as `R` |
| D1 (2026-10-31T23:29Z) | **PASS.** Production static delta check PASS; checkout `65c02ecc` fast-forwarded to `R`, clean; `status` PASS; probe `OLD_SERVING` |
| D2 (23:30-23:34Z) | **PASS.** `NEW_ID=fd48ace0c2cb-pqAQwRIJWLjSYzR8LiTuy` (12,995 files, manifest `2f011e790d79…`), build 225 s, build min MemAvailable 1,391 MB, peak RSS 1,720 MB, V1-V5 and boot smoke passed; `verify` PASS; links untouched; probe `OLD_SERVING`. Logs: `gap006-live-acceptance-20261101/d2-build.prod.log`, `d2-run.prod.out` |
| D3a (23:35Z) | **PASS.** `previous` = `OLD_ID`, `current` = `NEW_ID`; probe `NEW_SELECTED_OLD_RUNNING` (PID 3190377 still on `OLD_ID`) |
| D3b (owner, 23:50:30Z) | `sudo systemctl restart afldb`: active |
| D3c (23:51Z) | **PASS.** `POST-INSTALL CHECK PASS`; probe `NEW_SERVING` (PID 3218527, health ok/ok); journal line `serving build pqAQwRIJWLjSYzR8LiTuy release fd48ace0c2cb-pqAQwRIJWLjSYzR8LiTuy revision fd48ace0…`; 0 error lines; `NRestarts 0`; origin 404 for the previous build; one old Cloudflare cache HIT for `m0M8pf121326vNSo2B759` (informational, as the package states) |
| D4 (23:57Z) | **PASS 25/25** by the packaged runner, Super Admin, `https://beta.afldb.com`. The runner continues only once the browser is on `/admin/operations`; after signing in the owner had to open that URL by hand. Screenshots inspected by Claude, not only the runner's verdict: the correction-note control (label, textarea, rule text, 2000 cap) renders on all three pages at both widths with no overflow. In the mobile full-page captures the fixed bottom navigation repeats mid-image; that is a capture artefact, not a layout defect |

Evidence: `docs/v2/evidence/gap006-live-acceptance-20261101/` (8 screenshots, `results.json`, `d4-console.log`, the two D2 logs).

**Not live-verified.** `/admin/season-lists` and `/admin/player-links` (information pages, not gates) showed 0 correction-note controls on their list views; the controls on those editors sit in per-record panels that the read-only runner does not open. The refusal behaviour itself was not exercised against production (no production write was made); it rests on the PostgreSQL integration suites and the synthetic-registry visual journeys.

**Owner acceptance (2026-11-01).** The owner accepted the deployment on the packaged checks and the 25/25 Super Admin acceptance, with the verification limits stated above (production refusal behaviour not exercised; season-list and player-link panels not live-checked; W0/P-A/J1, P6/P7 and D0 evidence is owner-supplied or reported, not re-run).

**State left.** `current` = `fd48ace0c2cb-pqAQwRIJWLjSYzR8LiTuy` serving; `previous` = `ad245d602f6f-m0M8pf121326vNSo2B759` (retained, rollback target `rollback --to`); nothing deleted; no grant, schema or database change; Claude used no `sudo`, restarted nothing and pushed nothing. Only transient files on production were `/home/arm/gap006-{d1,d2,d2-launch,d3a,d3c}.sh` (removed) and the retained `gap006-new-id.txt`, `gap006-d2-build.log`, `gap006-d2.out`. **V2-GAP-006 stays open** (database-level enforcement, the other writers, owner decision pending); **ISSUE-331 stays open**. Tracking was updated in the close-out commit that follows `3c4df20a` (`CHANGELOG.md`, `known-gaps.md`, the readiness record, `issues.md` and `IssuesIndex.md` for ISSUE-331, and the records that said "not deployed").
