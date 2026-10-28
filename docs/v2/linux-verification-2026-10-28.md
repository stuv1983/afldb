# Linux verification of the integrated V2 code — 2026-10-28

**Result: the integrated V2 code runs on the supported Linux runtime with no regression outside the
recorded baseline, after three small corrections. Production: NO-GO** (release remains a separate
owner decision).

This is **fresh verification of the integrated code**, on real Linux (streamanator), against
disposable copies of an existing approved test baseline. It is **not** a database rebuild. The
accepted J2 Linux successor rebuild (2026-10-24, pinned `876dadbf`: 91 checks, 1,640 club-seasons,
evidence 167/167, inputs 264/264) remains the historical rebuild evidence and was not re-run.
Readiness, apply and activation were not reopened. No production, shared DEV database, EXEC, P/H,
authority or retained proof root was accessed or changed. No deployment, push, provider fetch,
package installation or Brownlow correction/adoption/settlement took place. `D:\dev\afldb` was not
touched; ISSUE-327 stays parked.

Machine-readable summary and hashes: [`evidence/linux-verification-2026-10-28.json`](evidence/linux-verification-2026-10-28.json).
The full retained evidence (134 files, manifest `evidence-sha256.txt` `32114d7f…`) is on the host
under `/home/arm/afldb-v2-linuxverify-20261028T0020Z/evidence/`.

## 1. Identities

| Item | Value |
|---|---|
| Tested commit | `c39d21305b7cdf3f0bf5ae5c9bd7a7dc8947c763` (tree `1510c67d…`), branch `v2/rebuild` |
| Corrected commit (final run) | `c3dea70908f7cb69f019a6e8e0af536d52e7a85a` (tree `0d479032…`) = tested commit + 3 commits, 5 files |
| Pre-GAP-032 comparison | `b91e44b3f030ae742390f64ee3bf12be5e973c36` (= `8f930dde^`, tree `be6feac8…`) |
| Source trees | `git archive` uploads verified on Linux: every blob id and mode against `git ls-tree`, 2,937/2,937, bad 0, no extras (both commits and the corrected commit) |
| Host | streamanator, Ubuntu 24.04.5 LTS, kernel 6.8.0-147-generic, 24 cores |
| Runtime | Node v22.23.2 (`/home/arm/.nvm/…/node`, sha256 `3517c2df…`); PostgreSQL 16.15 (Ubuntu 16.15-0ubuntu0.24.04.1); Python 3.12.3 + psycopg 3.3.4 (existing venv, read-only) |
| Dependencies | private copy of the host's installed `node_modules` plus `@electric-sql/pglite` 0.2.17 (per-file sha256); lock check 427 ok, 125 optional other-platform entries absent, 0 bad. Nothing downloaded or installed |
| Cluster | `afldb_v2_isolated`, private data root under the verification directory, **127.0.0.1:55461** (new port; 5432 DEV, 55432–55434 not used). Listener ownership proved (`ss`, `/proc/<pid>/exe`, cmdline) before any credential was sent |
| Roles | `afldb_owner`, `afldb_app`, `afldb_import`, `afldb_auth`, `afldb_backup`: fresh passwords, none superuser; superuser `afldb_v2_super` only for create/drop |
| Baseline | `afldb_v2_rb_final_test` (approved local test baseline; PG 16.14, ledger 115, 16,838 matches 1897–2025, 13,273 players), dumped read-only (`pg_dump -Fc`, 20,555,339 bytes, sha256 `659e471b…`) |
| Base clone | `afldb_v2_rb_lvbase_test`: restored (1,642 TOC entries, 4 extension/comment entries excluded), analysed, `migrate.ts --target test` 116 and 117 → ledger 117, privileges |

Every connection ran through `tools/v2/isolated-pg.ts run`, which strips every inherited `PG*` and
`*DATABASE_URL*` variable and sets loopback DSNs on 55461 for the named disposable database only.
Each database carried the marker `afldb-v2-isolated-test`, and every run was gated by
`isolated-pg`'s live target verification (listener owner, cluster name, marker). A read-only identity
probe (`current_database`, `current_user`, `is_superuser=off`, `127.0.0.1:55461`, `cluster_name`,
marker) was recorded on the base and before the first write on each clone that took writes. The
NL clone was read-only throughout. Disposable databases, all cloned from the base: `afldb_v2_rb_lvfull_test` (S1),
`afldb_v2_lvschema_test` (S2, schema-only), `afldb_v2_rb_lvnl_test` (NL), `afldb_v2_rb_lvui_test`
(browser), `afldb_v2_rb_lvfocus_test` (focused re-runs), `afldb_v2_rb_lvgap029_test` (rookie replay),
`afldb_v2_rb_lvfinal_test` / `afldb_v2_lvschemafinal_test` (final run).

## 2. Integration and release-gate suites (check 1)

The default Vitest workflow ran in full (`vitest run`, `fileParallelism: false`). The Coleman
publication suite ran on its own schema-only target, as in the local release review.

| Run | Tree | Files | Passed | Failed | Skipped |
|---|---|---|---|---|---|
| S1 full workflow (minus Coleman) | `c39d2130` | 303 | 14,856 | 7 | 63 |
| S2 Coleman publication | `c39d2130` | 1 | 28 | 0 | 0 |
| **S1F full workflow (minus Coleman)** | **`c3dea709`** | **303** | **14,860** | **3** | **63** |
| **S2F Coleman publication** | **`c3dea709`** | **1** | **28** | **0** | **0** |

At the corrected commit the only failures are the three V2-GAP-029 Gridley strict gates. Together,
S1F and S2F give **14,888 passed / 3 failed / 63 skipped (14,954)**. The answer-key test passed in all
four files that register it (25.6–34.3 s). The S1F tree was a fresh `git archive` of `c3dea709`,
verified 2,937/2,937 with no extras. Against the S1 tree, exactly the five corrected files differ.

Release-named suites in S1: V2-GAP-028's four files **200/200** (admin-draft 46, admin-season-lists 40,
awards-reload-links 107, match-admin-delete 7); V2-GAP-009 `settle-afl-api-state-b` 1/1 and
`settle-afl-api-brownlow-backtest` 6/6; `settle-afl-api` 74/74 (including the V2-GAP-027 case);
`release-gates` 59 passed / 7 skipped (the 7 are static `it.skip` in the file); `dsn-policy` 20/20;
the eight `nl-answers*` suites 226/226; `dob-enrichment-issues` 28/28 (V2-GAP-034).

### S1 failures, classified (first responsible layer)

| File | Failed | Layer and cause | Disposition |
|---|---|---|---|
| `tests/integration/draftguru-import.test.ts` | 1 | **Tool:** `export_person_bridge.py --resolve-against isolated` hard-coded port 55432 in its DSN guard and live identity check, so it refused the genuine guarded cluster on any other port (exit 1, no traceback) | **Fixed** `a0c87fb5`; contract 9d–9f added; 24/24 |
| `tests/integration/data-editor.test.ts` | 2 | **Test:** reads `issues/open/AFLDB-ISSUE-267-269-override-census.sql`, which `9b40e599` moved to `issues/closed/` (ENOENT) | **Fixed** `26a089a7`; 51 passed / 1 skipped |
| `tests/integration/gridley-height-oracle.test.ts` | 1 | **Test timing:** the 10,287-cell answer-key test (≈1.5M expectations) takes 27.5–35.0 s here against Vitest's 30 s default; failed alone at load 1.0 (34.9 s); all assertions pass with a diagnostic 180 s budget (33.9 s) | **Fixed** `c3dea709` (explicit `120_000`, as `gridley-corpus` already uses); no assertion changed; 59 passed / 1 skipped (opt-in report) |
| `tests/integration/gridley-corpus.test.ts` | 3 | **Known baseline residue, V2-GAP-029** (in `baseline-failures.txt`): no probed dataset gap; no failing cells; bounded approved-deferral policy | **Not a regression; stays open** (see below) |

GAP-029 reconciliation. The baseline database predates the reviewed rookie replay, which was applied
to a separate clone (`afldb_v2_gap029_test`) on 2026-10-20. On the unreplayed base, strict is 172 /
approved 99 / unapproved 73. Every one of the extra 23 is a `draft_type_is(rookie)` source-coverage
gap, and none of the accepted findings is missing. The read-only plan of
`repair-gridley-rookies.ts` lists all 8 reviewed selections as absent. On `afldb_v2_rb_lvgap029_test`
the eight were replayed through the audited `createManualPick` writer (8 created; a repeat found 8
already present). The strict finding set then equals the accepted
`gap-029-acceptance-strict.json` **key for key: 149 strict / 99 approved / 50 unapproved**, 0 extra,
0 missing. The three Gridley strict gates still fail, as recorded; nothing was waived.

### Not run (not counted as passes)

- **Brownlow dedicated-clone suites** (11 tests): `v2-brownlow-eligibility-2025-rehearsal` (needs
  `afldb_v2_brownlow_tristate_twelve_test`) and `v2-brownlow-production-correction` (needs
  `afldb_v2_brownlow_policy_final_test`). They refuse any other database by design. Building those
  clones means applying the Brownlow correction package, which this verification excluded.
- **Opt-in suites, environment-gated** (45 tests): `isolated-populated-lifecycle` (17;
  `AFLDB_POPULATED_LIFECYCLE=1`), `settle-promotion-deadlock` Phase B (11; armed Phase B),
  `db-promotion-receipts` (7; `afldb_v2_i322_base_test`), `brownlow-pending-populated` (4;
  `AFLDB_POPULATED_REHEARSAL_STATE=1`), the AA/height oracle reports (2; report paths),
  `import-role-match-lock` (1), `external-grids-import` (1; needs the legacy SQLite archive outside
  the repository), the data-editor `ctx.skip` case (1), and
  the special-records restricted-importer complement (1). No current release record names any of
  them as a Linux gate.
- **`release-gates` static skips** (7): `it.skip` in the committed file.
- **`tools/v2/release-gates.ts` production-dump report**: needs production-dump inputs, which are out
  of scope here.

## 3. PostgreSQL-backed NL verification, V2-GAP-032/033 (check 2)

Database `afldb_v2_rb_lvnl_test`, app role, read-only. The same database and corpora were run at
HEAD (parser v67) and at the pre-GAP-032 tree (parser v66).

Direct probe (`nl/probe-head.json`, `nl/probe-pre032.json`):

| Case | HEAD v67 | pre-GAP-032 v66 |
|---|---|---|
| `in 1980 to 1989`, `in 2020 to 2025`, reversed `1989 to 1980` | inclusive range 1980–1989 / 2020–2025 | **1980 alone / 2020 alone / 1989 alone** (silent wrong answer) |
| 40 real-user `user_range_leaders` rows vs their `between` rewrites | 40/40 same scope and answer | 40/40 different scope; **36/40 different answer** |
| `<club> <stat> 200 40` (three forms), `in 1980 and 1989` | decline, naming `200`/`40` (`1989`) | executed (for example "Adelaide goals 200 40" answered 680) |
| played 200 games for Richmond and also coached Richmond | refused at `validatePlan` | answered 6 players, 1 with only 11 Richmond games |
| controls: played and coached Richmond / played and coached / 200 games and coached | 27 / 365 / 107 | 27 / 365 / 107 |
| over 200 games for Richmond and also coached Richmond | decline | decline |

The `probe-pre032.log` file holds a first attempt that failed to compile (top-level await under
CJS). The results are from the `.mts` re-run, `probe-pre032.json`.

Stress corpora, HEAD vs pre-GAP-032, compared row by row (`nl/head-vs-pre032-diff.json`):

| Corpus | Scored | HEAD clean / soft / failed | Changed rows vs pre-GAP-032 |
|---|---|---|---|
| frozen V5 (12,000) | 12,000 | 12,000 / 0 / 0 | **0** |
| V6 (12,000) | 12,000 | 11,997 / 0 / 3 | **0** |
| ISSUE-206 exploratory V1 (29,030; 1,500 audit) | 27,530 | 19,761 / 6,654 / 1,115 | 151 |
| ISSUE-206 exploratory V2-corrected (29,030; 1,500 audit) | 27,530 | 20,876 / 6,654 / 0 | 151 |

- The 151 changed rows are all GAP-032/033 rows: 122 `malformed_input` rows now decline
  (`unsupported_term`; 121 had executed, 1 had returned no results), and 29 "played and also coached
  … with at least/no more than N games" rows now decline (`coverage_unavailable`; 23 had executed, 6
  had returned no results). Every `malformed_input` row (550/550) now declines; at pre-GAP-032, 122
  were accepted.
- V2-corrected equals the retained DEV v66 corrected report exactly (20,876 / 6,654 / 0). The V1
  failures are the uncorrected corpus's expectation errors: 569 result-side/club/opponent rows, the
  same 569 the DEV v66 run shows on the uncorrected V2 corpus, and `DROPPED_FILTER` findings already
  present in the DEV v54 V1 validation. They are identical at both trees.
- **V6, 3 failures (rows 41–43, "most finals without a premiership"): data scope, not a defect.**
  The V6 answer key, verified on DEV, which holds 2026, is a two-way tie at 24 (Dane Rampe, Nick
  Dal Santo). The V2 dataset ends at 2025, where Rampe has 23 finals and Dal Santo 24, so one leader
  is correct here. Identical at pre-GAP-032. The frozen key was not changed.

## 4. Browser NL regression (check 3)

A Linux production build of the tested tree ran on a disposable clone (`next build --webpack`
exit 0, which includes a typecheck; 1,516 pages; no `.env*` in the standalone bundle). The server ran
on 127.0.0.1:3961 as the app role, with the beta gate on. A disposable unlimited code was stored
hash-only in the clone; the session secret and code stayed in a private mode-700 directory. The
sweep used all 12 tracked UI corpora (1,844 questions, sha256 `e0fde997…`), Playwright 1.62.1
chromium, 1 worker, 2,200 ms pacing.

- Playwright **20/20 passed** (auth setup plus 19 batches; 1.3 h). **1,844/1,844 observed; HTTP
  errors 0, page errors 0, client-side errors 0, filler-variant disagreements 0.**
- Scored: **1,815 pass / 29 fail.** Each failure is identical through the engine at pre-GAP-032, so
  none comes from GAP-032/033:
  - 27 `user_player_career` rows ("how many career <stat> did <player> have") decline at
    `validatePlan` ("no defined total to count"). ISSUE-190 (Resolved 2026-09-15, on `main`) made
    this phrasing decline deliberately. Its optional career-total mapping was "not built", with
    "Follow-up: none opened". The real-user corpus (2026-08-22) predates that decision.
  - 2 `rel_decline_*` rows ("biggest football families", "families with three AFL players")
    answer, with "Ablett — 906 combined career games" and "43 families qualify". ISSUE-153's
    acceptance records exactly these answers as intended, but its re-pin `25beb99c` left both
    rows expecting `decline`.
  - Both are recorded as V2-GAP-035 for an owner decision. No expectation was restated from
    observed output.
- The run's own stop step missed the server, because Next.js retitles its process and the
  cmdline match failed. The server was then stopped by verified PID (listener owner, exe, cwd), and
  port 3961 is free.

## 5. R34 scorer/entity identity (check 4)

All 681 `scorer_identity_artifact` findings in the exploratory triage (11 `player_game_*` groups,
counts 77/76/70/67/66/59/58/54/53/52/49, the same at both trees) are Gary Ablett Jnr/Snr rows. In
each one the plan resolves the **correct stable id**: Jnr → 4701 (330 rows), Snr → 4700 (351 rows),
with no cross-resolution. The other 104 Ablett rows decline (`unsupported_term`). On this database,
4700 is the 1982–1996 player (248 games, born 1961, `players/G/Gary_Ablett0.html`) and 4701 is the
2002–2020 player (357 games, born 1984, `players/G/Gary_Ablett1.html`). Both carry the display name
"Gary Ablett", which is all the triage compares. **R34 is a scorer display-name artifact; no answer
is wrong.** Removing the artifact from the scorer remains the operator's optional choice.

## 6. Corrections (local commits, not pushed)

| Commit | Change |
|---|---|
| `26a089a7` | `test(data-editor)`: read the ISSUE-267/269 override census from `issues/closed/` (and the matching comment in `tools/migration/common.py`) |
| `a0c87fb5` | `fix(draftguru)`: isolated bridge resolution follows the runner's declared port (validated as `isolatedRunPort()`); DSN port, live server port, loopback, `_test` name, cluster and marker still required; contract 9d–9f |
| `c3dea709` | `test(gridley)`: explicit 120 s timeout on the 10,287-cell answer-key test; no assertion changed |

Each committed blob equals the file the focused Linux checks ran on (sha256 recorded in
`focus/patched-files.sha256`).

## 7. Cleanup

- All eight working databases were dropped through `isolated-pg drop-db --acknowledge-destroy`.
  `afldb_v2_rb_lvbase_test` is kept (marked, stopped) so a re-run needs no new dump.
- The cluster was stopped (`pg_ctl` reports no server). Ports 55461 and 3961 are free.
- The disposable UI session secret and beta code were deleted (their database was dropped).
- The host's own listeners (5432, 3000, 3100) were observed only, never connected to or changed.
  Nothing listens on 55432–55434. No verification process remains.
- Kept on the host: sources, evidence, and the stopped cluster with the base (`pg/` 667 MB,
  `evidence/` 211 MB). The cluster's superuser password stays in its mode-700 `secrets/`. Remove
  the whole root when it is no longer needed.

## 8. Remaining release gates and decisions

- **Owner decision, V2-GAP-035** (new): the 29 rendered-gate rows whose expectations conflict with
  accepted behaviour. Either restate the corpus expectations (ISSUE-190 declines; ISSUE-153 family
  answers) or build the optional ISSUE-190 career-total mapping. Until then the UI gate reports 29.
- **V2-GAP-029** stays open (149 / 99 / 50), unchanged by this run.
- Not run here, still required before release: the Brownlow dedicated-clone rehearsals, the
  production-dump `release-gates.ts` report, and the separate push and production-release decisions.
  Both remain blocked after the second pass (§9).
- Production remains **NO-GO**.

## 9. Second pass: opt-in suites and the remaining items (2026-10-28, same authority)

A second, separate verification root on streamanator ran the items that §2 left unrun, wherever they can run on
disposable targets. The first root, EXEC, P/H, authorities, retained proof roots and the WSL rehearsal store
were not touched. The first root's `xfer/` was only read, as a source of hash-verified copies.
Nothing was downloaded, installed, fetched from a provider, pushed or deployed. No source file was edited.

| Item | Value |
|---|---|
| Source | `c478c31b2ad84719907e0372d1b94230d3a4c508` (tree `476b6a17…`), upload sha256 `05b9fa90…`. Verified blob for blob 2,939/2,939, bad 0, no extras. It differs from the verified `c3dea709` only in the 9 documentation/tracking files of `c478c31b` |
| Root | `/home/arm/afldb-v2-linuxverify-20261028T0310Z` |
| Runtime | as §1: Node v22.23.2 (sha256 `3517c2df…`), PostgreSQL 16.15, Python 3.12.3. Lock check 427 ok / 125 optional absent / 0 bad. Inputs 785/785 |
| Cluster | new `afldb_v2_isolated` on **127.0.0.1:55462**, which was free beforehand. Only 5432, 3000 and 3100 (the host's own) listened, and they were observed, never used |
| Base | `afldb_v2_rb_lv2base_test`: the same approved dump (`659e471b…`, 1,642 TOC entries, 4 excluded), restored, analysed and migrated 115 → 117, then privileges. Probe: `afldb_owner`, not superuser, marker present |

Results:

| Check | Target (disposable) | Result |
|---|---|---|
| C1 `db-promotion-receipts` (ISSUE-322) | fresh migrated `afldb_v2_i322_base_test` plus `nonempty`/`live`/`cand` templates; no `_pre_test` | **7/7** |
| C2 `import-role-match-lock` (ISSUE-274 D-274-2), isolated mode, import DSN of the same clone | baseline clone `afldb_v2_rb_lv2lock_test` | **1/1** |
| C3 `isolated-populated-lifecycle` (ISSUE-316 L7), alone in its invocation, fresh capture root | fresh migrated `afldb_v2_rb_lv2liferef_test` + privileges + `load_reference_data.py` (players 0, ledger 0, sources `afl_api`/`afltables` present) | **17/17** |
| C4 `gridley-aa-oracle` + `gridley-height-oracle` with `AFLDB_AA_REPORT`/`AFLDB_HEIGHT_REPORT` | baseline clone `afldb_v2_rb_lv2oracle_test` | **120/120**, including the two report cases. Reports retained: AA `87e58acf…`, height `704969ef…` |

C3 needed two corrected attempts. **These were target-selection errors in this pass, not product failures.**
1. A baseline clone, which has 13,273 players, was refused by the suite's `beforeAll` before any write ("the target must be a
   fresh migrated database").
2. A bare migrated database failed the first case's precondition ("sources 'afl_api' and 'afltables' must both exist"). The
   remaining 14 failures cascaded from it, and 3 passed.

The correct target is the state the suite itself rebuilds after `RESET_SQL`: migrations, privileges and reference data.

Still not run, with the precise reason:

- **Brownlow dedicated-clone suites (11).** Both need clones of `afldb_v2_rb_brownlow2025_test`, which holds the authentic 2025
  provider snapshot. That template exists only in the stopped WSL rehearsal store `AFLDB-V2-Rehearsal-20261020`, which is not an
  authorised target. Rebuilding it would need a provider fetch, which is excluded. Substituting another baseline is ruled out by
  [the Brownlow verification](brownlow-isolated-verification-2026-10-20.md). Unblocking needs an owner decision either to read
  the template from that store as a dump or to authorise a re-acquisition.
- **Production-dump `release-gates.ts` report.** It needs production-dump inputs, and production access is excluded.
- **`settle-promotion-deadlock` Phase B (11).** It is armed only by its dedicated Windows `afldb_test` window runner, which lives
  outside the repository (ISSUE-265 §21–23; it passed 11/11 there on 2026-10-05). Arming it by hand on Linux would bypass that
  runner's target guard.
- **`brownlow-pending-populated` (4).** It needs a copy of a completed C2 rehearsal database. No such database is among the
  authorised targets, and the approved baseline (1897–2025) is not one.
- **`external-grids-import` (1).** It needs the legacy SQLite archive from outside the repository.
- **Not runnable by design.** The special-records "restricted importer skipped" case is the mutually exclusive complement of the
  restricted-importer case, which runs whenever the import DSN is set. The data-editor D-257-9 case is a data-conditioned
  `ctx.skip`: the approved baseline has no collision-free `profile_url_continuity` rule.

Cleanup:
- Every working database was dropped through `isolated-pg drop-db`, except `afldb_v2_rb_lv2lifefresh_test`. Its marker was
  replaced by the rebuild-pending comment when the failed second C3 attempt stopped before its reinstate stage. `drop-db`
  correctly refused it as unmarked, and the guard was not bypassed.
- The cluster is stopped and 55462 is free. Kept: the base (stopped), sources, capture roots and evidence (2.5 MB; manifest
  `evidence-sha256.txt` `55405e6d…`, 50 files). The root is 1.9 GB.
- Remove the whole root when it is no longer needed. That also removes the unmarked database.

## 10. Third pass: V2-GAP-035 restated, and the retained-input items (2026-10-28, owner retained-input authority)

The owner decided V2-GAP-035 and authorised reading the exact retained, non-production inputs that §9 named.

- Every input was copied into NEW verification storage first, and every test ran on a disposable copy.
- Original stores, dumps, frozen rehearsal/proof roots and source databases were only read. Each one's hash or manifest
  was taken again afterwards.
- Nothing was fetched from a provider. Production and the shared DEV database were not touched. Nothing was pushed or
  deployed, and no policy decision was made.

This section supersedes §8–§9 where they disagree.

| Item | Target (disposable, new root) | Result |
|---|---|---|
| V2-GAP-035 rendered gate, restated corpus (all 12 tracked UI corpora) | clone `afldb_v2_rb_lv2ui035_test`, isolated build on 127.0.0.1:3962, root of §9 | **1,844/1,844 pass, 0 fail**, 0 HTTP/page errors (before: 1,815 / 29) |
| Brownlow `v2-brownlow-eligibility-2025-rehearsal` (B2) | `afldb_v2_brownlow_tristate_twelve_test`, port 55464 | **3/3** |
| Brownlow `v2-brownlow-production-correction` (B1) | `afldb_v2_brownlow_policy_final_test`, port 55464 | **8/8** after the per-case budget correction `c249be86` (attempts 1–2 failed on budgets) |
| `brownlow-pending-populated` (`AFLDB_POPULATED_REHEARSAL_STATE=1`) | `afldb_v2_c2pop_test` in a copy of the completed C2 rehearsal, port 55465 | **4/4** |
| `settle-promotion-deadlock` Phase B, through a copy of its dedicated runner | disposable `afldb_test` in a new cluster, port 55466 | **11/11; OVERALL: PASS (Full); census CLEAN** |
| Production-shadow report on the retained archive `a583fc7d…` | `afldb_v2_shadow_baseline_test` / `_migration_test`, port 55463 | Strict **FAIL / INCOMPLETE, as expected**; no new finding (§10.5) |
| `external-grids-import`, real-archive case | read-only copy of the only available `afl.db` | **Not a pass**: that file is a later snapshot than the named archive (§10.6) |

### 10.1 V2-GAP-035 (owner decision: restate; no career-total mapping)

- **27 ISSUE-190 rows** in `afldb-ui-questions-1440-real-user-v3-20260822.csv` now expect `decline`.
  - These are `user_1122`…`user_1200`, "how many career <stat> did <player> have". Only the status field changed.
  - A new pin in `tests/nl-ui-corpus.test.ts` parses each one to a `player_career` count with a metric. It asserts that
    `validatePlan` returns the exact ISSUE-190 error.
  - The oracle is that decision's resolution (`issues.md`, ISSUE-190: "This kind of question has no defined total to
    count…"). It was not taken from observed output.
- **`rel_dec_001` and `rel_dec_002`** now expect `plan`.
  - This matches ISSUE-153 Stage 6 (§11.14): C1 "biggest football families" and C5 "families with three AFL players"
    both go to family grain.
  - A second new pin asserts both parse to grain `family` and pass `validatePlan`.
  - IDs, question text, categories, tags and every unrelated assertion are unchanged.
- **Counts.** The Phase G builder's counts and the three corpus runners' header comments were restated to match: current
  244/75, next 260/89, regression 1,408/87 scored.
- **Checks.**
  - Local: `nl-ui-corpus`, `nl-parser`, `nl-plan` and `nl-audit-acceptance`, 913/913.
  - Linux, at the restated tree: those four plus `nl-describe`, 1,002/1,002.
- **Rendered gate.**
  - Attempt 1 stopped in `next build`: the `next/font` Google loader raised a TypeError (its font-URL regex matched
    nothing). That was a transient Google Fonts response; a later fetch returned normal `.woff2` URLs. The logs are kept
    as `build.attempt1.log` and `ui035.attempt1.log`.
  - Attempt 2 re-checked every blob and the clone, then built with exit 0. The sweep (1 worker, 2,200 ms pacing, 19 batches, 1.3 h) saw 1,844 of 1,844 questions: pass 1,844, fail 0, unscored 0; answered 1,668, unanswerable 112, absent 64, HTTP 0, page errors 0, filler-variant disagreements 0. The server was stopped after its identity was verified, the clone was dropped through the guard, and the evidence manifest is `78f3dff5…` (27 files).

### 10.2 Brownlow dedicated-clone suites (authentic 2025 template)

- **Template source.** The stopped WSL store `AFLDB-V2-Rehearsal-20261020` was never started.
  - Its `ext4.vhdx` (sha256 `589597c5…`, 37,885,050,880 bytes, mtime 2026-10-25T23:15:52Z) was copied to a new distro,
    `AFLDB-V2-BrownlowExport-20261028` (`C:\afldb-v2-brownlow-export-20261028`), and the copy's hash compared.
  - The original was re-hashed after the copy and again at the end of this pass, and was unchanged both times.
  - Only the copy was booted. Inside it, the rehearsal cluster (no tablespaces) ran on 127.0.0.1:55471 with unix sockets
    disabled.
  - Template identity:
    - ledger 115;
    - `brownlow_round_votes` 330,383 (md5 `097a9f86…`);
    - season votes 16,120 (`252aa832…`);
    - staged `afl_api_brownlow_vote` 621 (2025; `48fc8ff0…`);
    - players 13,365;
    - matches 17,056 (1897–2026).
  - Exports: `pg_dump` with 1,640 TOC entries (sha256 `5be45eab…`). The fixture root and the retained acquisition
    `afl-api-brownlow-2025-2026-10-20-014218` were exported as tars (`23cc8b76…`, `3ed1b46b…`).
  - The copy's cluster was then stopped and the copy distro terminated.
- **Restore.** New root `/home/arm/afldb-v2-brownlowverify-20261028`, new cluster on 127.0.0.1:55464.
  - The restored identity equals the exported identity.
  - Each suite ran on its own fresh clone, with 116+117 applied by the normal runner and then privileges.
  - The approvals inside the suites are the suites' own SYNTHETIC ones.
- **B2**: 3/3. The twelve rulings applied through the guarded runner, and every rank is determinate.
- **B1**: 8/8 on streamanator in 2,011 s (slowest case 410 s), after one test-only correction.
  - **Attempt 1** (load ~1, alongside the rendered sweep) passed 1/8; 7 failed. Every failure sat exactly on a fixed budget (120/180/240 s).
  - **Attempt 2** (quiet host, fresh clone) also passed 1/8; 7 failed. Test 2 timed out at 180 s and left the shared clone part-changed, so later cases refused ("fresh backup restore baseline does not equal this target baseline", "expected exactly 207 sets…").
  - **Attempt 3**: the same tree and template, inside the WSL copy distro (the class of environment the accepted 2026-10-20 run used), on a NEW cluster with fresh credentials (127.0.0.1:55473) and a fresh clone. **8/8 in 756 s with the old budgets.** Test 1 took 53 s there against 142 s on streamanator.
  - **The correction.** Each case re-fingerprints 22 tables, including `player_match_stats`. Since the code and test were unchanged since that accepted run, the budgets did not fit this host. `c249be86` replaces the eight literals with one explicit 600 s per-case budget; no assertion changed (precedent `c3dea709`).
  - **Attempt 4** (streamanator, fresh clone, committed blob `0083f421`): **8/8**.
  - All attempts' artefacts are kept (`*.attempt1.*`, `*.attempt2.*`; WSL evidence copied to `D:\tmp\afldb-v2-b1wsl-20261028\evidence`, manifest `34cf4f8e…`). Host evidence manifest: `dd1841c5…` (32 files).
- **Disclosure.** While the copy was being inspected, a failed redaction printed the copy cluster's role passwords into the
  operator session output.
  - That cluster is loopback-only. The frozen original store's cluster uses the same passwords. That store is also
    loopback-only, sits in a stopped distro, and is neither DEV nor production.
  - The passwords were not written to the repository or to evidence.
  - Following the `isolated-pg` convention from the ISSUE-316 credential incident (2026-10-23), the copy's cluster now
    carries `secrets/CREDENTIALS-EXPOSED` and was not used again. Later work in the copy used a new cluster with fresh
    credentials.
  - The frozen original was not written. Marking it, or rotating its credentials offline, is an owner action. Deleting the
    copy distro removes the copy's credentials.

### 10.3 `brownlow-pending-populated` (copy of a completed C2 rehearsal)

- **Source.** The completed C2 rehearsal of ISSUE-316's final technical validation (`dedba57f`, root
  `afldb-c2-rehearsal-dedba57f-20261022T122727Z`, `afldb_v2_rb_c2cand3_test`) was stopped.
- **Copy.** Its `cluster/` (2,209 files, no tablespaces) was copied to `/home/arm/afldb-v2-c2popverify-20261028`. The
  copy's manifest equals the original's. The original manifest was taken again after the copy and at the end, and was
  unchanged both times.
- **Run.** Only the copy was started, with its port moved to 55465 (TCP loopback, no socket). Clone
  `afldb_v2_c2pop_test` (marked) is at ledger 117 with 0 pending migrations, and its 2026 Brownlow availability reads
  `pending` for match, round and season.
- **Result.** **4/4.** Evidence manifest `1b4d9d12…` (12 files).

### 10.4 `settle-promotion-deadlock` Phase B (ISSUE-265), through a copied, guard-preserving runner

- **Why it ran.** The harness is byte-identical to the one that passed 11/11 on 2026-10-05 (`20507181…`). But 20 of
  the 52 repository files in that run's provenance closure differ in the candidate, including the gate implementation
  (`settle-core.ts`, `datasets.ts`, `settle-afl-api.ts`, `settle-afltables.ts`, `canonical-apply.ts`, `pipeline.ts`).
  So the 10-05 result does not carry over.
- **Runner.**
  - The original runner, probe and tools (`D:\tmp\issue265`) were copied byte for byte to
    `D:\tmp\afldb-v2-i265b-20261028\runner`. Both hash lists are kept.
  - **No code was changed.** Only parameters differ: settings file, worktree (`git archive c478c31b`, no `.env`),
    evidence root and tunnel endpoint.
  - The original runner and its evidence were not written. The suite was armed only by the runner.
- **Target.**
  - A new isolated cluster on streamanator, 127.0.0.1:55466 (loopback, no socket).
  - The approved baseline dump (`659e471b…`) was restored into the marked seed `afldb_v2_i265b_seed_test`, migrated
    115→117, and given privileges.
  - The unchanged runner and harness accept only the database name `afldb_test`. So `afldb_test` was cloned from the
    seed **inside this cluster only**, owned by `afldb_owner` and commented as disposable.
  - Role secrets came from that cluster. Windows reached it only through `ssh -L 127.0.0.1:55476:127.0.0.1:55466`.
  - The target proof read server `127.0.0.1/32:55466`, db-oid 19883 and postmaster start `04:00:14.240404+00`. DEV in
    §23 was `:5432`, oid 45428.
- **Refusal controls (before Full).**
  - SelfTest PASS: 11 skipped, no connection attempted.
  - A wrong owner role (`afldb_app`) was REFUSED at the target proof.
  - A session the probe could not observe was REFUSED at isolation.
  - An active owner session holding an open transaction was REFUSED at isolation. One extra Preflight started early,
    while that hold was still open, and was refused the same way.
  - A positive Preflight then passed: targets, isolation, migrations 117/117 (State B), and zero residue in all 19
    namespaces.
- **Independent review** (read-only, separate agent) before launch: GO, no CRIT/HIGH.
  - MED-1: the runner's provenance closure does not follow `@afldb/*` packages. The 37 package files were hashed before
    and after Full and were unchanged. The runner was not changed.
  - LOW: the target is identified by endpoint, so the tunnel process was re-verified immediately before launch.
  - LOW: State B (111–117) is new coverage, not a repeat of the State A pass.
- **Full** (`run-20261028-150940-Full`):
  - 11/11 in 622.9 s; exit 0; 1 file passed; 0 skipped.
  - Post-run census CLEAN: historical fingerprints equal, no residue, all 14 retained admin-upload batches explained,
    0 teardown problems.
  - Provenance: 61 files unchanged. **OVERALL: PASS (Full).**
- **Afterwards.**
  - The tunnel was closed and the cluster stopped; 55466 is free.
  - Evidence: Windows `evidence-sha256.txt` `c0157ebf…` (67 files); host `2e476364…` (12 files).
  - The root keeps the disposable `afldb_test`, which isolated-pg cannot drop because of its name. Remove that root as a
    unit. The isolated-pg guard was not bypassed.

### 10.5 Production-shadow report on the retained archive (historical scope only)

- **Scope.** The retained archive `afldb_prod-20261019T233531867935Z.dump` (`a583fc7d…`, captured 2026-10-19) was
  restored on a new cluster (port 55463). This shows the archive's recorded historical state, **not current
  production**.
- **Steps.**
  - Ledger 110/110 matched. The first attempt of that check stopped on a harness module-resolution error; it is kept.
  - The archive has no authentic staged Brownlow seasons.
  - Captures were taken before migration. Then 111–117 were applied (7 pending → 0), with privileges.
  - Captures were taken after, then parity and `release-gates.ts` ran.
  - The archive hash was re-checked afterwards.
- **Parity** (`v2.parity.1`): FAIL, 3 pass / 1 fail / 1 incomplete.
  - The only failure is `UNEXPECTED_TABLE_ADDED public.brownlow_correction_receipts`.
  - Brownlow is INCOMPLETE: no reconciliation input exists.
  - The historical manifest, Coleman and coverage checks pass.
- **Release gates:** `backendFunctional` PASS; `migrationCompatibility` FAIL; preservation shows exactly the two 116/117
  deltas; D-V2-BROWNLOW-ALT-1 is NOT_APPLIED (its scope is this archive at 110→115); `productionDecision` NO-GO.
- **Reading.**
  - These are the same two schema deltas the owner accepted for the fresh archive `7fefcd9b…` (D-V2-FRESH-SCHEMA-1).
    That acceptance is archive-bound, so this archive's strict result stays FAIL. Nothing is waived.
  - Migrations 111–117 in the candidate are byte-identical (LF) to the hashes pinned by D-V2-FRESH-REHEARSAL-1. So the
    accepted fresh-archive migration evidence describes the candidate's migration files.
  - A report against *current* production needs a fresh production capture, which this authority does not cover.

### 10.6 `external-grids-import`: the named archive is not available

- **The named archive.** The case pins the rescued Gridley archive named by ISSUE-118:
  `D:\dev\sports_data_lab\data\afl\afl.db`, with 1,123 boards (#1–#1123), dated 2023-07-17 to 2026-08-12, with no gaps.
  - It is absent from the workstation.
  - On streamanator, `/home/arm/projects/sports_data_lab/data/afl/afl.db` does not exist, and no `afl.db` over 400 MB
    exists under `/home/arm`.
- **The only available file** is the data dictionary's "local audited copy", `D:\dev\afldb\data\afl.db` (537,010,176
  bytes, sha256 `a56fef4e…`, mtime 2026-08-14).
  - It was hashed and copied read-only to `/home/arm/afldb-v2-extgrids-20261028`. The original was re-hashed and was
    unchanged.
  - It is a **later snapshot**: 1,124 boards, #1–#1125 with one gap, ending 2026-08-14. The importer's DB-free dry run
    validates it with 0 rejections.
- **Result.** The suite gave 46/47; the archive case failed on `boards parsed: 1123`.
  - This is a baseline mismatch: not a pass, and not a product regression.
  - The 1,123-board oracle was not restated, and no different baseline was substituted.
  - Still needed: the rescued 2026-08-12 archive itself.

### 10.7 State after this pass

- **Clusters.** 55463, 55464, 55465 and 55466 are stopped. 55462 (the §9 root, used for the rendered gate) is stopped as well.
- **Originals unchanged.** The original rehearsal and C2 stores, the approved dump and the archives were not changed.
- **Retained for review** (remove when no longer needed):
  - on streamanator: `afldb-v2-shadowreport-20261028` (3.0 GB), `afldb-v2-brownlowverify-20261028` (3.2 GB),
    `afldb-v2-c2popverify-20261028` (2.6 GB), `afldb-v2-extgrids-20261028` (2.3 GB) and `afldb-v2-i265b-20261028`
    (2.4 GB);
  - on Windows: `D:\tmp\afldb-v2-i265b-20261028`, which includes a user-only `secrets\` holding the disposable cluster's
    settings files (delete it with the root);
  - on Windows: the copy distro `AFLDB-V2-BrownlowExport-20261028`, about 38 GB on `C:` (`wsl --unregister` removes it).
- **Still open:** V2-GAP-029; the authentic Brownlow operational items (V2-GAP-030/031); a current-production shadow
  report; the rescued Gridley archive; the push; and the production-release decisions. Production remains **NO-GO**.
