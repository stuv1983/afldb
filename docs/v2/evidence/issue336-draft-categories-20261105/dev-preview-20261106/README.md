# AFLDB-ISSUE-336 — isolated DEV-data preview and DEV reconciliation assessment (2026-11-06)

Owner instruction 2026-11-06: preserve DEV and continue ISSUE-336 through an isolated preview; do not reset or merge DEV `main`,
run `sync-dev.ps1` or migrate the live DEV database. **Nothing on DEV was changed.** The only DEV contacts were read-only:
`git` inspection, one `pg_dump` as `afldb_backup`, ledger `SELECT`s and health probes.

Three separate statuses, kept apart:

| | State |
|---|---|
| ISSUE-336 implementation | On `origin/main` `ea9bddf81284f68a8913fc258629fba3238b742a` (pushed 2026-11-06). |
| Preview verification (this record) | PASS on DEV's own data at that revision, with every failure accounted for below. |
| Deployment | **Not deployed** to DEV or production. Primary DEV still serves `242fa276` (`BUILD_ID 8sFpWkolwF1yKuKbFkOir`). |

## 1. DEV-only history: what is unique and where it is preserved

DEV `~/projects/afldb` local `main` = `242fa276`, 18 commits ahead of its last-fetched `origin/main` `ff100dc2` (ISSUE-271 F4/F5,
ISSUE-272 venue preservation, ISSUE-326 test fix, ISSUE-327 R1/R2 and its DEV apply record; 26 Oct). `ff100dc2` is an ancestor of
`ea9bddf8`, so origin's history is continuous; the two lines diverge only by those 18 commits.

* **Already preserved:** all 18 commits are ancestors of the archived source repository's `main` `6ffb893b`
  (`D:\dev\afldb-legacy-20261031-202057\source`, archived 31 Oct, nothing merged or discarded) and of the verified
  `legacy-all-refs.bundle` (`C:\Users\stuar\backups\afldb\workspace-migration-20261031-202057\`, sha256 matches its record,
  `git bundle verify` OK today). All eleven DEV-local branches are on `origin`.
* **Unique to DEV, now preserved off-host** in `C:\Users\stuar\backups\afldb\dev-preserve-20261106\` (README there): the two
  stashes (`82ad75a9` tsconfig drift, 20 Aug; `b519548c` pre-main-switch snapshot, 15 Aug, with untracked part) in a full bundle that
  also carries `242fa276`, and the nine untracked settle manifests (tar). Verified by checksum, clone and per-file hash.
* **Secret check:** the stashes hold only placeholder credentials. Not copied: `.env.bak-issue272-u1b-20261010-191158`, a credential
  backup (hash recorded); it remains on DEV. No preservation branch was published.
* **Status in V2:** ISSUE-271 and ISSUE-272 are resolved in `issues.md` as superseded by a retired V2 runtime path (V2 refuses
  `match_results` promotion); ISSUE-327 is the source repository's, parked there (owner amendment 5). Its 17-row DEV venue-span data
  change lives in the DEV database and is untouched by migrations 111–118.

## 2. Migrations 111–118 against DEV

DEV's ledger (`afldb_meta.schema_migrations`, read as owner) holds 110 rows ending `110_…`, last applied 2026-10-03. Migrations
001–110 at `ea9bddf8` are **byte-identical** to DEV's checkout (git blob comparison), so the drift guard cannot trip.

| Migration | Effect on DEV | Data rewritten | Rollback (from the file header) |
|---|---|---|---|
| 111 | new `award_proposals`, `award_proposal_decisions`; grants to `afldb_import`/`afldb_auth` | none | drop both tables (empty on DEV) |
| 112 | new `derived_award_results` | none | drop table |
| 113 | new `brownlow_eligibility_decisions` | none | drop table |
| 114 | new `derived_award_projections`; widens three CHECKs on 111's (empty) tables | none | reverse CHECKs, drop table |
| 115 | partial index on `afl_api_identity_adjudications(supersedes_id)` (table from 104) | none | drop index |
| 116 | new `brownlow_correction_receipts` + append-only trigger; revokes from app roles | none | drop table/function |
| 117 | `staging.afl_api_brownlow_vote.eligible` DROP NOT NULL (table from 103) | none | only while no NULL rows exist |
| 118 | `fixtures`: `confirmation` (default `confirmed`), two placeholder columns, club ids nullable with CHECKs | none (DEV has 3 fixtures, all valid) | only while no unconfirmed rows exist |

All additive. 117/118 take brief `ACCESS EXCLUSIVE` locks on a staging table and `fixtures`; the 5-minute Brownlow settle timer writes
that staging table, so a live migration should not overlap a settle run. Code at `242fa276` runs on the 118 schema (nothing it writes or
reads changes meaning until V2 code writes NULL eligibility or unconfirmed fixtures), and its migrator treats the extra ledger rows as
nothing to do. The 111–114 headers require `npm run db:privileges` after migrating; `deploy/sync-dev.ps1` does not run it.

**`deploy/sync-dev.ps1` against today's DEV:** classifier blocks on the unknown untracked `.env.bak-…` file (the nine manifests are
"known operational"); `git pull --ff-only` on local `main` fails (diverged); it then runs `npm ci`, `db:migrate`, an in-place `npm run
build` and a restart, with **no backup step, no privileges step and no timer pause**. The service and both timer units run straight
from `~/projects/afldb` with its `.env` (unit files unchanged by V2; `deploy/afldb-settle-afl-api*.sh` are byte-identical at `ea9bddf8`).

## 3. Isolated preview (streamanator, outside DEV)

* **Workspace:** `/mnt/ssd/afldb/workspaces/i336-preview-20261106` (mode 700); clean clone of the published repository, detached at
  `ea9bddf8` (tree `40fcdc63…`), no `.env`. Own loopback cluster on **port 55499**, database `afldb_v2_i336prev_test`.
* **Backup:** one read-only `pg_dump -Fc` of `afldb_dev` as `afldb_backup`, 2026-11-05T14:23:35Z, 39,024,135 bytes, sha256
  `71311444537e9ae66b03e5e7a51ff4f646e85e93e72b551b2252da446da3f36e`; kept in `private/` on the host only.
* **Restore:** `pg_restore` exit 0, 0 stderr lines, 7 s. Before: ledger 110, none of the 111–118 objects.
* **Migrations:** 111–118 applied in 2–66 ms each (`migrate.txt`); after: ledger 118, every object present, `eligible` nullable, three
  new `fixtures` columns, 3 fixtures all confirmed; `privileges.ts --target test` rc 0; re-run "Nothing to apply".
* **Focused unit tests** (draft, signing vocabulary, GAP-029 ops, seal inventory): 358 passed, 2 failed — the two Stage A snapshot
  tests that need an untracked local sample absent from any clean clone (same as every earlier run).
* **Focused integration tests** (`admin-draft`, `draft-linkage`, `draftguru-import`, `grid-solver`) on disposable copies: 262 passed,
  6 failed. **Identical 6 at base `eec192f2`** on a fresh restore of the same dump (`base-vs-candidate.txt`): DEV's draft data was never
  bridged to players (0 bridged persons, 5 of 6,810 picks linked), which those tests assert. Not an ISSUE-336 effect.
* **Build** PASS (`BUILD_ID 2Vcy0lbG9Qy2zQseRaORl`). **App:** `next start` on **`127.0.0.1:33361`**, beta gate off, throwaway session
  secret, no `AFLDB_SMTP_*` (email disabled by design: `emailConfig()` returns null), no provider identity, no systemd unit or timer;
  `/draft` 200, `/api/health` 200.
* **Browser** (desktop 1280×900, mobile 390×844, `screens/`): **66/68**. The two failures are one check on both viewports: the Rookie
  search `q=Jake Long` finds nothing because DEV stores the raw name with U+00A0 (`Jake\u00a0Long`) and the pick is unlinked; `q=Jake`
  and `q=Long` find it, and the 2014 Father–Son view shows it as "Rookie — Pick 47 — Father–Son". Pre-existing search limitation,
  registered as AFLDB-ISSUE-337. Fred Rodriguez (2025 Rookie #1 West Coast), Willem Duursma (2025 National #1 West Coast) and Nick
  Daicos (2021 National #4, Father–Son) pass; 2021 All = 140 rows (DEV has no GAP-029 manual rows and none of the 35 Pre-Draft rows).
* **DEV health** before and after (`dev-health-*.txt`): service active, same MainPID 1677, `/api/health` 200, HEAD `242fa276`,
  10 untracked, 2 stashes, same `BUILD_ID`, both timers active.

**Open the preview:** `ssh -N -L 33361:127.0.0.1:33361 arm@10.0.40.100`, then `http://127.0.0.1:33361/draft`. It holds a copy of DEV
data (including auth tables): keep it on loopback. To stop it later: `kill $(cat /mnt/ssd/afldb/workspaces/i336-preview-20261106/app.pid)`
and `isolated-pg.ts stop` with `AFLDB_V2_PG_ROOT=…/pg-root AFLDB_V2_PG_PORT=55499` (not done; no cleanup was authorised).

## 4. Recommendation for primary DEV (requires separate owner approval)

**Move DEV onto a new local branch that tracks `origin/main`, leaving local `main` at `242fa276`; migrate in a timer-paused window
after a restore-verified backup; then privileges, build, restart, smoke.** No reset, no merge, no force: the 18 commits stay on local
`main` (and in the archive), the stashes and manifests stay where they are.

1. **Pause writers (owner, sudo):** `sudo systemctl stop afldb-settle-afl-api-brownlow.timer afldb-settle-afl-api.timer`; wait until
   `systemctl is-active afldb-settle-afl-api-brownlow.service afldb-settle-afl-api.service` reports `inactive` for both.
2. **Backup:** the read-only `pg_dump` of `scripts/dump-dev.cjs` into a new mode-700 directory, then restore it on the isolated cluster
   exactly as this preview did (proves it restorable). Record sha256.
3. **Move, don't delete, the credential backup** that blocks the deploy classifier:
   `install -d -m 700 ~/afldb-retained/dev-20261106 && mv ~/projects/afldb/.env.bak-issue272-u1b-20261010-191158 ~/afldb-retained/dev-20261106/`
4. **Switch branch:** `cd ~/projects/afldb && git fetch --prune origin && git switch --create dev/v2-main --track origin/main`
   (no tracked local changes exist; no untracked DEV path is tracked at `ea9bddf8`).
5. **Deploy from the workstation:** `powershell -ExecutionPolicy Bypass -File .\deploy\sync-dev.ps1` — fast-forward no-op, `npm ci`,
   `db:migrate` (111–118), build, no-sudo restart, health.
6. **Privileges:** on DEV, `cd ~/projects/afldb && npm run db:privileges` (the 111–114 follow-up; until then the new tables only fail closed).
7. **Smoke:** `/api/health`, `/draft`, `/draft/2025?view=rookie`, `/draft/2021?view=father-son`, a player page; compare with the preview.
8. **Resume writers (owner, sudo):** `sudo systemctl start afldb-settle-afl-api.timer afldb-settle-afl-api-brownlow.timer`; read the next
   Brownlow run's journal and the next nightly run before calling DEV accepted.

**Residual risks:** DEV's runtime and timers move to V2 code (DEV-only ISSUE-271/272/327 code stops running; see §1); DEV's `.env` was
not used by the preview, so a V2-required variable missing from it would surface only at steps 5–8.

**Recovery:**
* Before step 5 finishes: `git switch main` restores the previous code; the database is unchanged.
* Code only, after step 5: `git switch main && npm ci && npm run build`, then the no-sudo restart
  (`kill $(systemctl show afldb -p MainPID --value)`, wait for `/api/health`). `242fa276` runs on the 118 schema; do not delete ledger rows.
* Schema, only if required: the per-migration ROLLBACK statements in reverse order 118→111 (safe while the new tables are empty and no
  unconfirmed fixture or NULL eligibility row exists), as the owner role, then remove the eight ledger rows.
* Whole database: `pg_restore --clean` of the step-2 backup into `afldb_dev` with the service and timers stopped. This discards every
  DEV write after the backup and is a separate owner decision.
