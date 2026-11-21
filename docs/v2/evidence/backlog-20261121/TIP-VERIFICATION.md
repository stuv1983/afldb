# Backlog follow-up: combined-tip verification and ISSUE-363 / ISSUE-372 follow-up evidence (21 November 2026)

**Task A verdict: PASS.** The combined tip `2efb81dc` (`40fb1c68` + owner packet + ISSUE-371 fix `36510bd9` + ISSUE-363 test
change `76b1b236`/`df25d0d0` + records) passes:
- every check the combined changes could affect;
- every remaining failure is the 7R3 baseline's, same name and same `file:line`.

No failure is new. Independently re-derived by `afldb-closure` (§D).

## Setup

- **Host.** streamanator, as `arm`, with no sudo. Workstation has no Node.
- **Checkout.** `/mnt/ssd/afldb-followup-20261121/cand` is a `git clone` of a bundle of branch `claude/backlog-followup-20261121`.
  - Task A ran at `HEAD` = `2efb81dccffca299907e8ac43707d53e3733dbfe`, 0 porcelain lines, no `.env`.
- **Database.** The ISSUE-363 isolated cluster was reused (root `/mnt/ssd/afldb-i363-20261121/pg`, `127.0.0.1:61490`). Its
  templates were never dropped or altered:
  - `rb` = `afldb_v2_i363_rbtpl_test`, the accepted source-only rebuild `afldb_v2_rb_rem3-6d5388ea.dump`. This is the same
    dump as the 7R3 template.
  - `sn` = `afldb_v2_i363_sntpl_test`, the 4 Nov snapshot copy.
  - Every suite ran on a FRESH `--template` copy named `afldb_v2_fu_*_test` (two rehearsal suites keep the 7R3 names),
    dropped afterwards.
- **Not touched.** Production, DEV's `afldb.service` and database, and the shared `afldb_test`. No `fuser`, no `wsl`.
- **Runner.** `/mnt/ssd/afldb-followup-20261121/scripts/fu.sh`, adapted from `issue363-20261121/host-scripts/i363.sh` and
  `run7r3/dev/r7r3-qual.sh`. Evidence is in `/mnt/ssd/afldb-followup-20261121/ev/` on the host. Summaries are DSN-free and
  ANSI-stripped.

## A. Combined tip `2efb81dc`

| Check | Result | Against the 7R3 baseline (`run7r3/DEV-QUALIFICATION.md`) |
|---|---|---|
| `npm ci` | rc 0 | |
| `npm run typecheck` | rc 0 | |
| `npm run lint:gate` | PASS (ratchet), 338 in 43 files = baseline | unchanged existing debt |
| Focused unit: `admin-brownlow-actions`, `settle-season-revalidation` | **124/124** | ISSUE-371 README §5: 124/124 |
| Full unit (`vitest run --exclude 'tests/integration/**'`, venv Python) | 12,335 passed, **7 failed**, 31 skipped (12,373). 214 files passed, 2 failed, 1 skipped | 7R3: 12,329 passed, 7 failed (12,367). The **same 7** fail at the same `file:line`: `draftguru-acquisition` `:1757:92`, `:1764:31`, `:3441:65`; `fitzroy-core-import` `:1854:17`, `:1878:18`, `:1886:20`, `:2089:18`. Already classified there as environment/fixture-bound and identical on BASE. The +6 tests are attributed to ISSUE-371's new unit cases from the counts alone (12,367 → 12,373) |
| `awards-reload-links`, shared, fresh `rb` copy | **109/109**; whole-database fingerprint vs template: **0 tables differ** | ISSUE-363 T-2 green reproduced at the combined tip |
| `brownlow-season-attachment` | 5/5 | 5/5 |
| `admin-brownlow` | 47/47 | 47/47 |
| `brownlow-pending-coverage` / `-projection` / `-populated` | 8/8, 8/8, 4/4 | same |
| `b1a-successor` | 14/14 | same |
| `v2-brownlow-eligibility` | 47/47 | same |
| `settle-afl-api-brownlow`, `-backtest`, `-reschedule` | 21/21, 6/6, 3/3 | same |
| `database -t Brownlow`, `-t AFLDB-ISSUE-36[79]` | 10/10, 3/3 | same |
| `v2-brownlow-eligibility-2025-rehearsal` | 3 failed | **same 3 by name**: needs the dedicated pre-ruling 2025 archive clone |
| `v2-brownlow-production-correction` | 5 failed, 3 passed | **same 5 by name**: needs the dedicated `policy_final` archive clone |
| `npm run build` (fresh `rb` copy, `AFLDB_ENV=production`) | rc 0, `BUILD_ID YWAGdf4rP3tz-h5nhSYB5`, 1,518/1,518 static pages | |

**Classification.** Nothing new fails. The 7 unit and 8 integration failures are exactly the 7R3 baseline's, which 7R3
showed identical on BASE `a3c8c67c`. No HIGH.

## B. ISSUE-363 LOW shared-mode residues

Method: as for ISSUE-363.
- One fresh template copy per run.
- After the run, the copy is compared with its untouched template by the whole-database fingerprint
  (`issue363-20261121/host-scripts/fp.sql`).
- For the special-record tables, also a row/column diff: `pa.sql`, aggregated by `rowdiff.awk`. Counts only leave the host.

### B1. `player_achievements` residue

**Characterisation, at `2efb81dc`, shared mode, one file per fresh copy:**

| File | `rb` | `sn` |
|---|---|---|
| `special-records-lifecycle` | 15 passed, 1 skipped; **0 tables differ** | same; **0** |
| `special-records-public-suppression` | 23/23; **1 table differs**: `player_achievements` 334 → 334, **1 row, 1 column: `imported_at`** | same: 1 row, `imported_at` |

**The earlier attribution to both files was over-broad.** The lifecycle file leaves nothing. The suppression file leaves
exactly one value: the provenance witness's `imported_at`, cut from microseconds to milliseconds.
- `rb`: `2026-11-14T10:26:25.727528+00` → `…25.727+00`.
- `sn`: `2026-09-27T21:00:25.05467+00` → `…25.054+00`.

**Mechanism.** `special-records-public-suppression.test.ts`, "reads the provenance instant from active rows only", restored
the saved text through `${saved}::timestamptz`. postgres.js types a parameter cast to `timestamptz` as `timestamptz` and
serialises it through a JS `Date`, which keeps milliseconds only.

**Fix** (test-only):
1. The restore casts from text on the server: `${saved}::text::timestamptz`.
2. Following `awards-reload-links.test.ts`, a new file-level `beforeAll` captures `id, status, status_reason,
   imported_at` of every row of both special-record tables, plus whole-table fingerprints of those two tables and of
   `sources`. The file writes exactly these columns, and creates and deletes its own fixture source and row.
3. At teardown, after the void check and the fixture removal, the captured values are put back set-based in SQL
   (`jsonb_to_recordset`, no client conversion), and the fingerprints are compared. The file throws "did not restore
   the pre-existing state; still different: …" on any remaining difference.

| Run (shared unless stated, fresh copy each) | Result | Whole-db diff vs template |
|---|---|---|
| RED: `2efb81dc` file, `rb` / `sn` | 23/23 each | 1 table: `player_achievements` `imported_at`, 1 row, on both bases |
| GREEN: fixed file, `rb` | 23/23 | **0** |
| GREEN: fixed file, `sn` | 23/23 | **0** |
| GREEN: lifecycle + suppression together, `rb` | 38 passed, 1 skipped | **0** |
| GREEN: per-file mode (`AFLDB_TEST_PER_FILE_DB=all`), both files, `rb` | 38 passed, 1 skipped; 0 per-file databases left | n/a |
| M1: root-cause line reverted, restore kept, `rb` | 23/23 | **0**: the file-level restore heals it |
| M2: M1 plus the restore UPDATE disabled, `rb` | **file FAILS** in `afterAll`: "special-records-public-suppression did not restore the pre-existing state; still different: player_achievements (334 row(s) at start, 334 after restore)" | 1 table, `imported_at` 1 row: the residual check fires |

### B2. `admin-brownlow` partial `beforeAll`

**Mechanism.** `tests/integration/brownlow-fixture.ts` already swept a registry of seeds (§27.30): it quiesces in-flight
seeds and removes them. But the sweep only covered seeds that had registered when it took its snapshot.
- A `beforeAll` that times out keeps running. If it is between seeds, or inside the next seed's guard queries, it
  registers and seeds after the sweep, while the rest of `afterAll` runs, until the worker is torn down.
- That is the `ctl_sn` residue: `seasons` +1 and `players` +69. A season seeds 4 × 18 = 72 players; the seed was cut
  off at 69, before any match.

**Fix** (test-only):
1. `cleanupSeededBrownlowSeasons()` closes the registry and snapshots it in one synchronous step.
2. `seedBrownlowSeason()` refuses once closed. It checks at entry, and again synchronously with its registration, so a
   sweep that began during its guard queries wins. Nothing has been written at either point.
3. The remover also finds players by the fixture's owned slug prefix `issue155-<season>-`, not only by the ids the
   seed saw returned.
4. `admin-brownlow`'s file-level `afterAll` gets an explicit 300 s timeout instead of the 30 s default.

Vitest isolates modules per file (`vitest.config.mts` sets no `isolate: false`), so the closed registry is per file.

**Forced-failure proof.** Two scratch files on the host only, never committed:
- `zz-partial-late`: a `beforeAll` with a 1 s timeout that starts the 2085 seed at 1.5 s, after the sweep.
- `zz-partial-mid`: times out at 400 ms in the middle of the registered 2089 seed.

In both, `afterAll` = sweep, then a 6 s wait standing in for the rest of the teardown, then `sql.end()`. Both were run
with the `2efb81dc` fixture (RED) and the fixed fixture (GREEN), each on a fresh `rb` copy:

| Run | Vitest | Whole-db diff vs template |
|---|---|---|
| RED late (old fixture) | hook timed out | **10 tables differ**: `seasons` 131→132, `players` 13,365→13,437 (+72), `matches` +2, `player_match_stats` +64, `player_career_stats` +72, `player_season_stats` +64, `player_club_season_stats` +64, `player_clubs` +64, `club_seasons` +4, `stat_availability` +1 |
| GREEN late (new fixture) | hook timed out | **0** |
| RED mid (old fixture, 400 ms) | hook timed out | 0: the existing quiesce path |
| GREEN mid (new fixture, 400 ms) | hook timed out | **0**: the existing path is preserved |
| GREEN `admin-brownlow`, shared, `rb` | 47/47 | **0** |
| GREEN `brownlow-pending-coverage` + `brownlow-season-attachment` (the other fixture users), shared, `rb` | 13/13 | **0** |
| GREEN `admin-brownlow`, per-file mode, `rb` | 47/47; 0 per-file databases left | n/a |

## C. ISSUE-372 guard

The guard is in `tests/settle-season-revalidation.test.ts`. Analysis and options are in
`docs/v2/evidence/issue372-20261121/README.md`.

| Run | Result |
|---|---|
| Whole file, branch tip | **90/90** (86 existing + 4 new) |
| Guard only (`-t "every revalidatePath call"`), branch tip | 4/4. The scan parses all **59** `revalidatePath(` calls in `src/`, 25 of them typed |
| RED: guard only, with `src/app/admin/brownlow/actions.ts` from `40fb1c68` overlaid, then restored | **1 failed, 3 passed**. It names the **8** concrete-path-with-type calls ISSUE-371 fixed, among them `` `/brownlow/${season}`, 'page' `` and `` `/seasons/${parsed.season}`, 'page' `` |

typecheck (`tsc --noEmit`) rc 0, and eslint on the four changed test files rc 0.

**At the exact committed tip `38e154f6`** (clean checkout from the bundle, 0 porcelain lines):
- `special-records-public-suppression`, shared: 23/23 on `rb` and 23/23 on `sn`, **0 tables differ** on each.
- `settle-season-revalidation` + `admin-brownlow-actions`: 128/128.

The other three changed test files were byte-identical to the tip when their runs above were made (`git diff` against the
tip was empty for them).

## D. Independent closure

`afldb-closure` used its own host checkout `/mnt/ssd/afldb-followup-20261121/closure` (at `38e154f6`, porcelain 0), its own
databases (`afldb_v2_fuc_*`, all dropped) and its own evidence (`/mnt/ssd/afldb-followup-20261121/evc/`). **Every re-derived
value matches. There are no CRIT, HIGH or MED findings.** Re-derived at `38e154f6`:

- **Static checks.** `npm ci`, typecheck and lint:gate are as in §A. eslint on the four changed test files is rc 0.
- **Focused unit.** 128/128.
- **Full unit.** 12,339 passed, 7 failed, 31 skipped (12,377). That is +4 over `2efb81dc`, the new guard, and the same 7
  `file:line`.
- **Guard red check.** It is red on `40fb1c68` `actions.ts`: 1 failed, naming the 8 calls.
- **Shared integration, fresh copies, 0 tables differing in every case:**
  - suppression: 23/23 on `rb` and on `sn`
  - `admin-brownlow`: 47/47
  - `awards-reload-links`: 109/109
  - the two other Brownlow-fixture users together: 13/13
- **Build.** rc 0, 1,518/1,518, `BUILD_ID hnoMOsD2T8asSK__XPbL2`.
- **Diff reconciliation.** `git diff 2efb81dc 38e154f6` is exactly the 5 intended files. No `src/`, `deploy/`, `tools/` or
  tracking file is in it, and no commit carries an AI attribution trailer.

Closure findings, all LOW or INFO, with the disposition of each:
- **F-001 LOW (drift).** A one-line wording edit to the ISSUE-372 README (the `/players/[slug]` row) was uncommitted. It
  is disclosed and committed with this file.
- **F-002 INFO.** "+6 = ISSUE-371's new cases" in §A is derived from the counts only.
- **F-003 INFO.** The first `awards-reload-links` attempt was refused for an upper-case database name. Its folder
  `ev/A_arl` is not evidence; the cited run is `ev/arl`.
- **F-004 INFO.** The orchestrator's own tsc/eslint logs carry no rc. Closure re-ran both: rc 0.
- **F-005 INFO.** The forced-failure scratch runs and M1/M2 were read from the evidence, not re-run. The committed files
  were re-run at the tip, green.
- **F-006 INFO.** No `fuc_` or `pf_` databases are left. The ISSUE-363 templates are untouched.
- **F-007 INFO.** The unit log carries synthetic DSN-shaped fixture strings only.

Closure did not run the registry regeneration or API diff, because the change is test and documentation only.
