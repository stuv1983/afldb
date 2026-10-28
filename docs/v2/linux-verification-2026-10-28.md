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
