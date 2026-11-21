# AFLDB-ISSUE-363, 2026-11-21: T-2 residue fixed; G-1 evidence and decision sheet

Branch `claude/issue-363-20261121` from `origin/main` `40fb1c68`. Test-only change: one file
(`tests/integration/awards-reload-links.test.ts`). **Tested commit: `ddbc5174`.** No `src/`, `tools/`, `data/`, `deploy/`, migration or
package change. G-1 is **not decided** here. Section 5 is the decision sheet for the owner.

## 1. Host, bases and what was touched

* DEV host streamanator. The workspace is `/mnt/ssd/afldb-i363-20261121`: checkout `cand/` from a bundle of this branch, `npm ci`,
  no `.env`. The isolated cluster root is `/mnt/ssd/afldb-i363-20261121/pg`, on port **61490**. Node 22.23.2, PostgreSQL 16, and
  `AFLDB_PYTHON=/home/arm/projects/afldb/.venv/bin/python` (Python 3.12.3, psycopg 3.3.4).
* Each run used a **fresh `--template` copy**, dropped afterwards. The templates were never run against.
* Nothing else was touched: no other port, cluster or workspace, the shared `afldb_test`, DEV's `afldb.service` or database, or
  production. No process was killed and no `wsl` was run.
* Files were read from other workspaces but never written there. That covers the two dumps, the two restore scripts, the
  DraftGuru bridge child, and 42 DraftGuru Stage A raw pages. The raw pages were verified against
  `docs/rebuild-manifests/draftguru/annual-html-20260826.json`, copied, and removed again after use.

| Base | Template in the cluster | Source | Facts |
|---|---|---|---|
| **A (`rb`)**: the accepted source-only rebuild | `afldb_v2_i363_rbtpl_test` (290,462,743 B) | `/mnt/ssd/afldb-rem3-base/rebuilt/afldb_v2_rb_rem3-6d5388ea.dump`, 20,662,515 B, sha256 `d8397aab92e3ce0cf2a640bb5daeac6594fb0e2c723dc410d82d8e718f165c63` (30 stages / 91 checks) | ledger 118; `data_overrides` 0; `match_event` labels 0 |
| A + bridge (`rbb`): the run-4 rebuild qualification base (run4/baseline C1/C2) | `afldb_v2_i363_rbbtpl_test` | `rb` + `import_draftguru.py --bridge` of the child `afldb_v2_rb_rem3-draftguru-bridge-child-v3-6d5388ea.json` (sha256 `1200e702…6e9d`) + `ANALYZE` | picks 6,810, persons 5,057, bridge identities 3,559, `import_batches` 27 (= run 4) |
| **B (`sn`)**: the populated 4 Nov snapshot | `afldb_v2_i363_sntpl_test` (409,771,031 B) | `/mnt/ssd/afldb/workspaces/afldb-issue333-o2-20261104/private/afldb_prod-20261104T021037Z.dump`, 30,141,895 B, sha256 `e77c307d3e0cddcb652e398a946e4c22c2063f13c70edadf96a975c92842826d` (on the host since 4 Nov; nothing fetched) | ledger 118 (`migrate --target test`: nothing to apply); `data_overrides` 165 (64 `matches/match_event`, 92 `players/identity`, 8 `draft_picks/selection`, 1 `player_match_stats/lineup`); 64 labels |

Scripts: `host-scripts/`. Successive revisions of `i363.sh` ran as `i363.sh`, `i363b.sh`, `i363c.sh` and `i363d.sh`. They differ
only in the compare output (a per-run compare was added after the first green run) and in the template names. The committed
`i363.sh` is the last revision.

`fp.sql` is a whole-database content fingerprint: count plus an order-independent row hash for every base table in `public`,
`staging` and `afldb_meta`. `rows.sql` with `rowdiff.awk` gives column-level counts for the six award tables. `refs.sql` counts
references, per foreign key, to new import batches. Only counts leave the host: no row data, no player names and no Gridley
report bodies.

## 2. T-2 residue

### 2.1 Characterisation (red)

This is the file as published (`40fb1c68`, identical to `f6af6da9` for this file). The table shows shared mode on a fresh copy,
compared with the untouched template. Both bases gave identical results. The file passed 109/109.

| Table | Change after one shared run |
|---|---|
| `award_nominations` | 766 / 766 rows changed, **`import_batch_id` only** |
| `hall_of_fame` | 343 / 343 rows, `import_batch_id` only |
| `captaincies` | 1,781 / 1,781 rows, `import_batch_id` only |
| `honour_team_members` | 112 rows, `import_batch_id` only. **Plus one row deleted and re-inserted under a new id**: id 37 → 114, a "Greek Team of the Century" member, `unmatched`, player NULL; otherwise only `import_batch_id` and `updated_at` differ |
| `import_batches` | +122 (rebuild 26 → 148, snapshot 75 → 197), from 9 targets: all_australian, captaincies, club_bf, coleman, hall_of_fame, honour_teams, named_medals, rising_star, under_22 |
| `award_winners`, award spans, `awards` | equal (the `f6af6da9` restore) |
| every other table in `public` / `staging` / `afldb_meta` | **equal** (whole-database fingerprint) |

Cause: every real importer run re-stamps each reloaded row with its new batch. One honours reload replaces an unmatched member
row instead of updating it. No link or content changes in these four tables on either base. The snapshot's 22 relinks are in
`award_winners` only, and were already restored.

### 2.2 Fix (`234254b8`, then `ddbc5174`)

`tests/integration/awards-reload-links.test.ts:150-264`:

* **What is restored:** `award_winners`, `award_nominations`, `hall_of_fame`, `honour_team_members` and `captaincies`
  (`RESTORED_TABLES`, line 171). Each is captured whole, by id, before any block runs, and restored set-based at file teardown,
  as `award_winners` was. Nothing references any of the five by foreign key, and none has a trigger.
* **Import batches:** batches above the captured maximum are then deleted, inside the same transaction. A delete blocked by a
  reference from another table fails the file. The only cascade is `import_rejections`, which holds just those batches' own rows.
* **Verification:** all five tables, the award spans and the batch count are compared after the restore. The file throws on any
  remaining difference, naming each table.
* **Timeout (`ddbc5174`):** 38 foreign keys reference `import_batches`, most of them unindexed, `player_match_stats` among them.
  Deleting 122 batches therefore took **29.3 s** on `rb` (measured in a rolled-back probe). That exceeded the 5 s client
  `statement_timeout`. At `234254b8` this rolled the whole restore back and failed the file, on both bases. The delete now runs
  under `SET LOCAL statement_timeout = '240s'`, and the file-level `afterAll` allows 300 s.

### 2.3 Green (`ddbc5174`)

| Run | Result | State after vs untouched template |
|---|---|---|
| static | `npm run typecheck` rc 0; eslint on the file rc 0 | |
| shared, rb | 109/109, file passes | **0 tables differ** (whole database); 0 new batches |
| shared, sn | 109/109, file passes | **0 tables differ**; 0 new batches |
| per-file (`AFLDB_TEST_PER_FILE_DB=all`), rb | 109/109, file passes (180 s) | 0 `afldb_v2_pf_*` databases left |
| per-file, sn | 109/109, file passes (217 s) | 0 left |
| negative control: scratch copy without the batch delete, shared, rb | file **FAILS**: `still different: import_batches (122 row(s) above the captured maximum)` | only `import_batches` differs, so the five restored tables no longer reference the new batches. The copy was removed afterwards (porcelain 0) |

Cost: the shared run took 249 s at `ddbc5174`, against 180 s at `40fb1c68`, with host load at about 11 during the run. Of that,
29 s is the measured batch delete.

**Neighbours.** These files read the same tables: `admin-awards`, `admin-club-leadership`, `player-matching`, `query-builder`,
`special-records-lifecycle`, `special-records-public-suppression`, `fk-indexes`, `privileges` and `admin-brownlow`. They ran in a
second vitest run on the **same** copy, after the file. A control ran them alone on a fresh copy.

| Base | After `awards-reload-links` | Control (neighbours alone) |
|---|---|---|
| rb | 9 files, 266 passed / 1 skipped | 266 passed / 1 skipped |
| sn | 265 passed / **1 failed** / 1 skipped: `admin-brownlow` "resolved every historical round row to exactly one match (preflight P2)" (`expected 9522 to be +0`) | **the same id fails** (run-4 ledger: class 1, snapshot-only) |

Both runs, and both controls, leave `player_achievements` content changed (334 rows, count equal). That residue belongs to the
neighbours (`special-records-*`), not to this file: see section 6. In the first, overloaded control, `admin-brownlow`'s
`beforeAll` timed out at 30 s at a load of about 11. The rerun at normal load is the row above.

## 3. G-1 measurements (no decision taken)

Suites: `gridley-corpus`, `gridley-aa-oracle`, `gridley-height-oracle`, `grid-solver`, `grid-solver-investigation` and
`release-gates`. Each file ran on its own fresh copy in shared mode, with `AFLDB_GRIDLEY_REPORT` set. Counts come from
`host-scripts/gridley-summary.mjs`. The three Gridley ids are:

* **G-a** "has no probed dataset gap, unless run in diagnostic mode";
* **G-b** "conforms to the bounded approved-deferral policy";
* **G-c** "writes the run report and has no failing cells" (the snapshot's N7).

| Base | G-a | G-b (unapproved) | G-c (failing findings) | gapped criteria | solved cells | other suites |
|---|---|---|---|---|---|---|
| `rb` source-only, no bridge | FAIL | FAIL (322 `dataset gap`) | FAIL (440 = 322 gap + 78 unsupported + 40 criterion disagreement) | 4 match-event + 6 draft | 9,887 / 10,287 | grid-solver 221/222 (`drafted_by_club_never_played…` fails: no draft links); aa 61, height 61, investigation 1, release-gates 68 |
| `rbb` = tier S as qualified in run 4 | FAIL | FAIL (65 = 42 `dataset gap` + 23 `source coverage gap`) | FAIL (183) | `anzac-playedin-1`, `anzac-won-1`, `bigfreeze-playedin-1`, `dreamtime-playedin-1` | 10,167 | all pass (grid-solver 222/222, release-gates 68/7 skipped) |
| `rbov` = `rb` + 64 labels | FAIL | FAIL (281, draft only) | FAIL (399) | 6 draft | 9,928 | grid-solver 221/222 (as `rb`) |
| `rbbov` = `rbb` + 64 labels | **pass** | FAIL (**23** `source coverage gap`) | FAIL (141) | none | 10,209 | all pass |
| **`rbbovr` = `rbb` + 64 labels + 8 reviewed Rookie selections (full tier P prototype)** | **pass** | **pass** (0) | FAIL (**118** = 78 unsupported + 40 criterion disagreement) | none | 10,209 | all pass (see `SUMMARY-gridley.txt`) |
| `sn` 4 Nov snapshot (all 165 live overrides) | pass | pass (0) | FAIL (**118** = 78 + 40, identical categories) | none | 10,209 | release-gates 63/**5 failed**/7 skipped: the run-4 ledger's 5 snapshot ids, class 1 (3 × 363-B birth-date pins, 1 Brownlow authority, 1 birth dates "honestly without"); others pass |

Measured facts behind the options:

1. **The 23 `source coverage gap` cells are exactly the 8 players of `data/players/rookie-relisting-outcomes.csv`** (8 distinct
   players, every detail citing AFLDB-ISSUE-222 §11.19.13 D2).
   * The snapshot's 8 `draft_picks/selection` overrides are 8 administrator-created Rookie picks (ids > 6,810).
   * Matched by AFL Tables profile and year, they are **8 of 8** of that CSV.
   * They are GAP-029's reviewed Rookie selections, written on production by `tools/v2/gap029-rookie-selections-production.ts`.
2. **G-c fails on every base, production-shaped data included.** The cause is the same 78 `unsupported` (§23.36 deferred
   criteria) plus 40 `criterion disagreement` (all `brother × …` sibling cells). No overlay changes it. It is the ISSUE-118
   zero-acceptance indicator, not a rebuild-versus-production gap. The run-4 ledger grouped it with G-1 (class 5), but G-1 cannot
   resolve it.
3. **Full tier P equals the snapshot on every measured Gridley count:** solved 10,209, failing 118, unapproved 0, no gapped
   criterion. The rebuild-specific findings are attributed to 64 labels, 8 Rookie selections and the bridge step. The other 93
   live overrides (92 player identity, 1 line-up) change no Gridley outcome.
4. **The labels give no wrong answers.** On `rbbov`/`rbbovr` no `incorrect known answer` appears. The 42 match-event cells move
   from `dataset gap` to solved, with no finding.

### 3.1 Tier P prototype (opt-in, evidence tooling only; nothing committed to `tools/`, the rebuild or any runbook)

* **Labels:** `overlay-rekey.mjs` rekeys the tracked `docs/v2/evidence/gap-029-match-event-correction-2026-11-01-r2.json`
  (production match ids) to the target by natural key: season, date, round, clubs and scores. It keeps an entry only on exactly
  one match.
  * Result: 64/64 kept, **3 ids changed (the 2026 entries)**, 0 dropped.
  * The existing audited applier `tools/v2/apply-gap029-match-events.ts --apply` then ran **unchanged** on the rekeyed file. It
    verified all 64, wrote 64 `data_overrides` and 64 `data_edits` rows, and gave Anzac Day 31, Dreamtime 22, King's Birthday 11.
  * Rekeyed evidence sha256 `d21a3eba…f819`. Applier report sha256 `da9dc361…f45e` (on rb).
* **Rookie selections:**
  * The tracked tool `gap029-rookie-selections-production.ts plan --rehearsal` **refuses** on a rebuild clone:
    `players/L/Lachie_Henderson.html: resolves to player 8388, the reviewed identity is 8350`. Its evidence pins production
    player ids, as the label evidence pins match ids.
  * `overlay-rookie-rekeyed.mts` therefore takes the same entries (`buildEntries` over the tracked CSV) and resolves each player by
    AFL Tables profile on the target, requiring exactly one match.
  * It writes through the same audited `createManualPickInTransaction` in one `afldb_import` transaction, after
    `assert_viable_super_admin_actor`, so any refusal rolls everything back.
  * Result: 8/8 written, **7 of 8 player ids differ from production**, `draft_picks` 6,818 (the snapshot also has 6,818),
    72 overrides in total.
  * A rebuild has no `auth_users`. So, as in the existing rehearsal tool's fixtures, one clone-local Super Admin was created on
    a non-reserved domain with placeholder credentials (`overlay-rookie-prep.mjs`), in the disposable copy only.
* **Overlay digests:** content fingerprints (`fp.sql`) are recorded rather than a dump sha, because `pg_dump` output embeds a
  timestamp. `rbov` `00c449f2…aa2f`, `rbbovr` `0ece9e8f…6493`.

## 4. Result summary

* **T-2 residue: fixed and qualified.** At `ddbc5174` a shared run of the file leaves the whole database identical to its base,
  on both bases. Per-file mode passes 109/109 on both bases. The negative control proves the verification fails on a remaining
  difference. The neighbours show no regression against their controls.
* **G-1: evidence complete, decision open.** See section 5.

## 5. Decision sheet: G-1 (owner)

**Question for the owner.** "On which database must the Gridley acceptance ids G-a and G-b pass for a rebuilt test base to count
as qualified? Should a second, opt-in tier be built from tracked curation evidence to provide it?" G-c is outside this question
(fact 2): it fails on every base, production included.

| Option | What it means | Measured effect (G-a / G-b / G-c) | Consequences |
|---|---|---|---|
| **S: source-only only** (G1-REBUILD-TIERS alternative b) | Tier S (accepted rebuild + bridge) stays the only rebuild base. G-a and G-b are recorded as declared tier-S dependencies in a tracked manifest line, so a new Gridley failure is still red | FAIL / FAIL (65) / FAIL (183) | No new step or tooling. Gridley's marquee-match and Rookie criteria then have no accepted rebuild base; only production-derived snapshots answer them, and those are being retired (T-1) |
| **S + P-labels** (G1-REBUILD-TIERS recommendation as written) | Tier P = tier S + the 64 GAP-029 labels only | pass / FAIL (23) / FAIL (141) | Half a fix: G-b still fails on the 8 reviewed Rookie players |
| **S + P-full** | Tier P = tier S + the tracked, reviewed GAP-029 curated layer: 64 labels (match-event evidence r2) + 8 Rookie selections (`rookie-relisting-outcomes.csv`). Both are applied by the existing audited writers, with evidence rekeyed to the rebuild by natural key (reviewed once), on fresh copies only (`afldb_v2_rb_*_overlay_test`) | **pass / pass (0) / FAIL (118)**, identical to the snapshot | The accepted rebuild contract (30 stages / 91 checks / digest `d8397aab…`) is unchanged; tier P records its own applier reports and content fingerprint beside it. No live administrator data enters a fixture: the 92 identity and 1 line-up overrides are excluded and change no Gridley outcome. Cost: two rebuild-keyed evidence files (or a natural-key mode in the two tools) reviewed once, the opt-in overlay step, manifest lines, and one Gridley run per qualification |
| **C: replay live overrides** (G1-REBUILD-TIERS alternative c) | Copy production's 165 `data_overrides` (and their `data_edits`) into the standard rebuild | not run (prohibited). By inference from the snapshot: pass / pass / FAIL (118), **the same as S + P-full** | Changes the accepted contract and digest. Copies 92 player-identity corrections, editor ids and audit rows into cloned, shared and committed test bases. Buys nothing over S + P-full for Gridley |

**Recommendation: S + P-full.** It is the only option that passes G-a and G-b on a rebuild from tracked evidence. It matches the
snapshot exactly, and it changes neither the accepted contract nor the fixtures' data provenance.

Separately, and not part of G-1: G-c should be recorded as ISSUE-118's open acceptance (78 deferred `unsupported` and 40 sibling
`criterion disagreement` cells). It should not be carried as a rebuild limitation.

**After G-1:** if S + P-full is chosen, one later run builds the overlay step and the two rekeyed evidence files, adds the manifest
lines for tier S, and records G-a/G-b green on tier P. If S is chosen, only the manifest lines are needed.

## 6. Residuals

| Grade | Residual |
|---|---|
| LOW | `special-records-lifecycle` / `special-records-public-suppression` leave `player_achievements` content changed (334 rows, count equal) in shared mode. This shows in the controls without `awards-reload-links`, on both bases. It is a separate shared-mode residue of those files and was not characterised here. Per-file mode is unaffected |
| LOW | `awards-reload-links` now spends about 29 s deleting its 122 import batches. That comes from the unindexed foreign keys into `import_batches`; per-file mode pays it too |
| LOW | In the first, overloaded snapshot control (`ctl_sn`), the `admin-brownlow` `beforeAll` timed out at 30 s. The file then left `players` +69 and `seasons` +1 in the shared copy, so a timed-out setup is not cleaned up. That control ran without `awards-reload-links`. The rerun at normal load (`g2_ctl_sn`) left neither. Not characterised further |
| INFO | `admin-brownlow` P2 and five `release-gates` ids fail on the 4 Nov snapshot only. These are continuing run-4 class 1 items, unchanged |
| INFO | `rb` without the bridge child fails `grid-solver` `drafted_by_club_never_played…`, and Gridley shows 6 draft gaps. Both are expected: the bridge import is a documented `RESTORE.md` step, and `rbb` passes |

## 7. Evidence files (aggregates only)

**Run summaries.** `SUMMARY-runs.txt` holds one block per run label:

| Labels | Commit | What they are |
|---|---|---|
| `red_*` | `40fb1c68` | red |
| `green_sh_*`, `green_pf_*`, `ctl_*` | `234254b8` | the intermediate commit. Its restore timed out, the file failed and everything rolled back. `ctl_*` are the first neighbour controls |
| `g2_sh_*`, `g2_pf_*`, `g2_ctl_*` | `ddbc5174` | green, with neighbours and controls |
| `mut_rb` | `ddbc5174` | the negative control |
| `ov_*` | | the overlays |
| `g0_*` | | the G-1 suites per base. Checkout `40fb1c68`/`234254b8`/`ddbc5174`: they differ only in this test file, which no G-1 suite runs |

**Other files:**

* `SUMMARY-gridley.txt`: the per-base Gridley aggregates.
* `SUMMARY-overlay.txt`: the applier output and the digests.
* `SUMMARY-setup.txt`: template provenance and static checks.
* `SUMMARY-host.txt`: what is left in the cluster, and the stop.
* `negative-control.txt`.

Row-level files and Gridley report bodies stay on the host under `/mnt/ssd/afldb-i363-20261121/ev/`, because they hold row data.

## 8. Left in place

* The workspace `/mnt/ssd/afldb-i363-20261121`: the checkout, scripts, logs and evidence (`ev/`).
* The cluster, **stopped**: `/mnt/ssd/afldb-i363-20261121/pg`, port 61490. It holds these templates and kept copies:
  * `afldb_v2_i363_rbtpl_test` (A);
  * `afldb_v2_i363_sntpl_test`, **the populated disposable copy of B**;
  * `afldb_v2_i363_rbbtpl_test`;
  * the overlay prototypes `afldb_v2_i363_rbov_test`, `afldb_v2_i363_rbbov_test` and `afldb_v2_i363_rbbovr_test`.

  Sizes are in `SUMMARY-host.txt`.
