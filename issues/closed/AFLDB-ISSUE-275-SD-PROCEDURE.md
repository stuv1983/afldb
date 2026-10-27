# AFLDB-ISSUE-275: stage S-D procedure (live DEV State B decision) - REVISION 2, PREPARED FOR REVIEW, NOT RUN, NOT APPROVED

Companion to `issues/open/AFLDB-ISSUE-275.md` (sections 42 and 44-50). Revision 1 was prepared 2026-10-16 after the S-T stage; **revision 2** (this file) adds the recovery sections (7), the owner decisions (10), the evidence index (11) and a review package, and fixes two script defects found on re-review (section 2). Revision 1 (`D:\tmp\issue275-sd\pack\`) is preserved unchanged. **Nothing in this file has been run against DEV.** The only contact was read-only: the SQL below was proved to parse and return the expected shapes on `afldb_test` (a different database), and the scripts were syntax-checked. S-D needs the owner's explicit approval (proposed decision ID **D-275-STATEB-SD-1**); until it is recorded, no step may be run.

## 1. What S-D would and would not show

One real Match Sheet decision on one real DEV row, protected through two real on-demand AFL Tables settles, then released by Return to source and restored by a settle, on DEV at the ISSUE-275 revision `0cb3d20cecf2787df8bb5f8592a86768a78db646` (State B since 2026-10-03). It would show the durable protection and release behaviour through the real editor and the real settle. It would **not** show: repeatability, anything about PROD, the AFL API ownership path (DEV has no afl_api-owned 2026 match; the 17.8 case stays unrun), or ISSUE-275's refusal branch (unreachable on DEV data). It also cannot be a pure "one row" test: **each settle is a full pipeline run over the whole 2026 season** (section 4), so the stage must be approved as that, not as "one Match Sheet row".

## 2. Package

This package is a ZIP (`MANIFEST.sha256` lists every file with its sha-256; `verify.mjs` re-checks them). Extract it to a **new, empty** directory; call that directory `$PK`. **Re-hash before use; any difference means stop and re-review.** Nothing in it has been run against DEV.

| File | Purpose | Status |
|---|---|---|
| `pack/sd-sql.mjs` | READ ONLY SQL runner through the operator's 55432 tunnel; refuses unless the endpoint is `afldb_owner@127.0.0.1` / `afldb_dev` (or `afldb_test` for proofs); every statement in `BEGIN READ ONLY`; no credential printed | unchanged from rev1 (sha-256 `5e6b787467eb9ab9a8084e17353ec00f9bd6ae80a19448b9b554ca0ea93d7187`) |
| `pack/sd-diff.mjs` | offline comparison of two result files, statement by statement | unchanged from rev1 (sha-256 `4fd2c63fe32c007fa888dd2fe6b9716b86c058c24d1db0f32b15a32f546e57f0`) |
| `pack/sd-q.sql` | Q00-Q15 before/after state (identity, sessions, CHECK, Q1, Q2, md5s, newest batches, audit high-water marks, finding fingerprints, whole-table counts, 2026 canonical fingerprints, derived rows of the 46 players, staging spine, sequences) | unchanged from rev1 (sha-256 `94c26b6a662d4392831a645aa147e30389206a74fb3bbe00c77d4047875fc821`) |
| `pack/sd-q-after-settle.sql` | A00-A05: batches, ledger rows, findings, rejections/candidates and audit rows created since the baseline | unchanged from rev1 (sha-256 `5c93b74a099163f0ba42030c75ab7a459fe466c34d53b22465709f8953bb6100`) |
| `pack/sd-state.sql` | S00 state classifier (S0, S1, S2, S3, S-X) for recovery decisions | **new in rev2** (sha-256 `ee4c298d272006d82a09e18f2611851d5e998dd2ace592d710e59d9e7386bac1`) |
| `pack/sd-host-gate.sh` | host gate, READ ONLY (window, timers, units, HEAD/tree, health, trigger prerequisites, migrations, rollback guard) | **changed in rev2**: the health check tolerates JSON spacing, as the reviewed health-check.sh does (sha-256 `1d644d87dcd9bca45b9885b875e1bf1006b789e43d66a7253fcf17516701e934`) |
| `pack/sd-host-after.sh` | host read of what one settle did (unit result, complete journal, files created, identity, timers) | **changed in rev2**: the pre-existing findings' `REFUSED` lines are counted separately and no longer turn the exit code to 1 (sha-256 `2322280253cf4199899746d7623a3b0c493e339b191a48b4ef4213ed7acc59fc`) |
| `reused/Invoke-Remote.ps1` | the reviewed SSH runner (copied unchanged from `D:\tmp\dev-deploy-next-20261015-rev2\reused\`) | copy; hash equals the original (sha-256 `18c8adbb3097aecea09a4e23bdb16f56054eb1ccc8a3086371ff322ae14c193d`) |
| `reused/smoke-journal.sh` | the reviewed web-journal check (copied unchanged from `...\remote\`) | copy; hash equals the original (sha-256 `f0099801c2fd6a36c97d91b03313de89f1238871c38211051d06dc6546e94ab6`) |
| `validate/readonly-proof.sql` | a write that the runner must refuse | evidence input (sha-256 `b458416ad52abb0c8f927fa08e434af9716a16742956098c1480117ac7aa3dae`) |
| `validate/state-truth-table.mjs` | runs the REAL `sd-state.sql` classifier over 9 constant scenarios (read-only on `afldb_test`) | evidence tool (sha-256 `87c7bd3e2a8864691be72f5d2e055a2559d38f9b2f9bd2d5a2846efc2d60af87`) |

The evidence (section 11) is in `evidence/`. Variables (PowerShell 5.1 on the workstation):

```powershell
$PK  = '<the extraction directory>'
$SD  = "$PK\pack"
$IR  = "$PK\reused\Invoke-Remote.ps1"
$RUN = 'D:\tmp\issue275-sd\run-' + (Get-Date -Format 'yyyyMMdd-HHmm')   # new, must not exist
New-Item -ItemType Directory -Path "$RUN\sql","$RUN\host","$RUN\shots" | Out-Null
$HEAD40 = '0cb3d20cecf2787df8bb5f8592a86768a78db646'                   # re-read; a later recorded TARGET replaces it
```

Host commands go through `$IR` (operator-run: the DEV host needs the operator's credentials). SQL runs on the workstation through the operator's open tunnel; **no DSN is ever on a command line**. The journal check is `$PK\reused\smoke-journal.sh` (replace `$PKG\remote\smoke-journal.sh` in section 6).

## 3. Fixed identities (re-read in G3; any mismatch stops the stage)

Match **M = 17275** (2026 Grand Final, 2026-09-26, Fremantle v Brisbane Lions; 46 `player_match_stats` rows, all `afltables`-owned); player **P = 345** (Alex Pearce, one AFL Tables path `players/A/Alex_Pearce.html`); row **705529**, field `marks`, source value **0**, edit **0 -> 1**; authority key `2026|GF|2026-09-26|Fremantle|Brisbane Lions|afltables:players/A/Alex_Pearce.html`; the only `player_match_stats` record is `data_overrides` id **237**, inactive since 2026-10-03 20:46:25 (Return to source). Source of these facts: ISSUE-257 DEV record (steps 8-13, batches 100/101) and ISSUE-274 section 31; they are not re-read from DEV for this document.

## 4. Full effects (this is the approval scope)

### 4.1 Common to BOTH on-demand settles (D2 and D4). Unit `afldb-settle-afltables.service` = the nightly chain, run now.

The wrapper `deploy/afldb-settle-afltables.sh` runs three steps, failing closed: (1) `acquire_core.R --acquire --in-season` fetches the **2026 season from AFL Tables via fitzRoy (third-party network traffic)** into a new immutable snapshot; (2) `import_fitzroy_core.py --require-in-season --on-record-error reject --emit-observations` adjudicates it offline; (3) `settle-afltables.ts --apply --auto-apply --require-complete-source` opens PostgreSQL as `afldb_import` and settles. Label `settle-2026-YYYY-MM-DD-HHMM`. Routine no-change run about 51 s; a run with upstream changes can take minutes.

| Where | What changes | In a run where nothing upstream moved | Reversible |
|---|---|---|---|
| Host filesystem | new directory `data/sources/afltables/fitzroy_core/<label>/` (raw CSVs, `observations.json`) and new untracked file `docs/rebuild-manifests/afltables_fitzroy_core/<label>.json`, per settle (two settles: two of each) | yes, always | No (snapshots are immutable by design; the manifests are the "known operational artefacts" the gates already tolerate; host untracked manifest count rises by 2) |
| Network | requests to AFL Tables | yes | n/a |
| `import_batches` | +1 row per settle with `validation_result` counters; sequence advances | yes | No (history) |
| `staging.source_records` | **every observed record is UPDATEd** (`last_seen_at`, `last_batch_id`, `absent_since` cleared): about 20,000 rows per settle (19,986 on 2026-10-03). The previous `last_seen_*` values are overwritten, not appended | yes | No (the earlier last-seen history is lost) |
| `staging.source_payloads`, `source_record_versions`, `afltables_match`, `afltables_player_match` | INSERT only for records whose payload changed | no rows | No |
| `promotion_candidates`, `import_rejections` | rows for records that are not auto-applied or are rejected | none expected | No |
| Canonical `matches`, `match_period_scores`, `player_match_stats`, `brownlow_round_votes` and the ledger `canonical_applications` | only where the automatic proposal differs from the canonical row and gates E1-E6 pass | none (batches 99/100 wrote 0), **but see 4.4** | A canonical change is not reverted by this procedure |
| Derived recompute | only when a canonical row was inserted or updated (`canonicalRowsInserted + canonicalRowsUpdated > 0`): `seasons` 2026 UPDATE; **`club_seasons` 2026 DELETE and re-INSERT (new surrogate ids)**; for the touched players DELETE and re-INSERT of `player_clubs`, `player_club_season_stats`, `player_season_stats`, `player_career_stats`, UPDATE of `player_match_stats.career_game_no` across those players' careers and of `players` debut/final/search_rank; **season-wide UPDATE of `player_season_stats` Brownlow columns for 2026** | not run | values are recomputed from canonical, ids and tuple versions are not restored |
| `data_issues` | disagreement lifecycle and apply-failure findings are opened, refreshed (same row, `detected_at` kept) or resolved; the journal also reports the pre-existing open AFL API `foreign_source_owner` findings | possible refresh of existing rows | No |
| Running site | after the settle commits the tool POSTs the settled season to the site's loopback invalidation route, so `/seasons/2026` is re-rendered on its next request (if the revalidate secret is configured) | possible | self-healing |
| `auth_audit_log` | +1 row `current_season.settle_triggered` per click of the admin button (none if the unit is started with `systemctl`) | yes | No |
| Match Sheet writes | **refused while a settle runs** (the settle takes the match row; `MATCH_SHEET_SETTLE_RUNNING_REFUSAL`). No concurrent editor work | n/a | n/a |
| Journal | `afldb-settle-afltables` lines | yes | No |

### 4.2 D1, the Match Sheet save (the editor submits all 46 rows)

`data_overrides` id 237 **re-activated by upsert** (`override_values` `{"marks": 1}`, `admin_user_id`, `updated_at`; no new row); `player_match_stats` rows of M written through the Match Sheet writer (only P.`marks` differs; the other 45 rows must stay byte-identical); one `data_edits` row for `matches`/17275 with `authorityKeys [{action: mint, ...}]`; derived recompute for **every player in the locked or submitted set (up to the 46 players of M)**: `player_clubs`, `player_club_season_stats`, `player_season_stats`, `player_career_stats` DELETE and re-INSERT (same values expected, tuple versions new), `player_match_stats.career_game_no` UPDATE over those players' careers (same values, new tuple versions across several thousand rows), `players` UPDATE. No `club_seasons` or `seasons` write from the save. The rollback guard changes from active 0 to active 1.

### 4.3 D3, Return to source

`data_overrides` 237 -> `is_active = false` (retained); one `data_edits` row with `withdrawnKeys`; **P's row stays at marks 1**; derived recompute for P only if the writer deletes the row (it does not here: `rowDeleted` false). A second click or a stale tab shows the S4 "no durable authority" message and writes nothing.

### 4.4 Possible UNRELATED canonical changes (the part a one-row description hides)

Each settle re-offers ("retry") any canonical target whose automatic proposal differs from the canonical row and is not protected, and applies any genuine upstream correction. Therefore D2 and D4 can write **canonical rows for other matches, players or Brownlow votes**, with derived recompute for them (and, for any such write, the season-wide recompute in 4.1). Likelihood: low on 2026-09/10 data (batch 99 and 100 wrote 0; batch 91 had once applied 47 corrected observations and 55 inserted rows from upstream), and not zero between the nightly and the click. The pack cannot predict it offline (a `--dry-run --auto-apply` preview needs an existing snapshot label and a rolled-back DEV transaction, and would not see AFL Tables' state at the time of the click; it is **not** part of this procedure and would need its own approval). **Detection:** `A01` counters (`canonicalRowsInserted`, `canonicalRowsUpdated`, `canonicalApplicationsLogged`, `canonicalRetryApplied`, `derivedRecompute*`), `A02` (the ledger rows, one per canonical write, with previous and new values), the `Q12` fingerprints before and after, and `A03` (findings). **Rule:** a ledger row whose target is M or P other than the single expected D4 row (4.5) is a stop-and-report finding. A ledger row for any other target is recorded verbatim as *upstream-driven, not ISSUE-275*, is **never hand-reverted**, and the end-state claim then reads "equal to the start in every business column except the listed rows". The owner is told at once.

### 4.5 What each step must change, exactly (expected)

| Step | Expected state changes (everything else: no change) |
|---|---|
| D1 | Q03: `marks` 0 -> 1, other columns of the row equal (`p_minus_marks_md5` unchanged); Q04: id 237 active, `{"marks": 1}`, same id, no new row; Q05 `m45_md5` unchanged; Q09 +1 `data_edits` row for 17275 with a `mint` authority key; Q12 unchanged; Q13 equal (values); guard exit 2 REFUSED, active 1 |
| D2 | batch +1; A02 empty; Q03 `marks` 1; Q04 identical (same `updated_at`); Q05 unchanged from post-D1; counters equal the previous AFL Tables batch's classes; no new finding; `canonicalApplyFailures` 0; `manualAuthorityRefusals` as baseline; no `canonical_apply_failed` for `match_period_scores`; `canonicalApplyRefusals` as baseline; Q14 `max_last_batch` = the new batch |
| D3 | Q04 id 237 inactive, `updated_at` moved, `override_values` retained; Q03 `marks` still 1; Q09 +1 row with `withdrawnKeys`; guard REFUSED, active 0 |
| D4 | batch +1; A02 exactly one row: `update`, `player_match_stats`, target `{match_id 17275, player_id 345}`, previous `{marks: 1}`, new `{marks: 0}` (plus nothing for M or P otherwise); `canonicalRetryApplied` 1, `canonicalRowsUpdated` 1, `derivedRecomputeRuns` 1, `derivedRecomputePlayers` 1; Q03 `marks` 0, `p_minus_marks_batch_md5` equals the pre-D1 value (only `import_batch_id` is restamped); Q04 id 237 still inactive; the season-wide recompute rewrites `club_seasons` 2026 (new ids; `club_seasons_2026_without_id` equal) and the 2026 `player_season_stats` Brownlow columns (values equal) |

### 4.6 Retained history (never removed by this procedure)

`data_overrides` 237 (inactive, with changed `updated_at` and `admin_user_id`); 2 `data_edits` rows; 2 `import_batches` rows and their `validation_result`; the D4 `canonical_applications` row (and any 4.4 rows); 0-2 `auth_audit_log` rows; 2 host snapshot directories and 2 untracked manifests; journal lines; sequence advances (`import_batches`, `data_edits`, `canonical_applications`, `auth_audit_log`, `club_seasons`, and others); overwritten `staging.source_records` last-seen values; dead tuples from the recomputes. DEV remains roll-forward only (D-257-7).

## 5. Guards (all read-only; every one must pass; stop on the first that does not)

**G0 approval and independence.** D-275-STATEB-SD-1 recorded by the owner with this scope, the window, and who clicks. Pack hashes re-verified: `Get-FileHash` of each file equals `PACK.sha256`. Playwright MCP profile is the signed-in Super Admin (re-checked on the page, not assumed). No other operator is using the editor.

**G1 window.** Not inside 02:00-03:15 or 04:00-05:40 (the nightly AFL Tables timer fires 04:30 plus up to 15 minutes; the AFL API timer 05:01; reboot window 02:45-03:15). Both settle timers at least **60 minutes** away at D1 and at least 30 at D4. The independent 5-minute Brownlow timer cannot be avoided; it writes Brownlow only when the feed has votes, and its status is recorded.

**G2 host gate** (before D1):

```powershell
& powershell -NoProfile -ExecutionPolicy Bypass -File $IR -Script "$SD\sd-host-gate.sh" -ScriptArgs $HEAD40,60 -Log "$RUN\host\g2-gate.txt"; "g2 exit $LASTEXITCODE"
```

Must exit 0: HEAD equals the expected revision, tracked tree clean (only known operational artefacts untracked), service and health ok/ok, no settle unit active, migrations 0 pending, **guard exit 2 REFUSED with active 0**.

**G3 baseline SQL** (re-read the identities and take the before-image):

```powershell
node "$SD\sd-sql.mjs" dev "$SD\sd-q.sql" d0-before --out "$RUN\sql"; "g3 exit $LASTEXITCODE"
```

Must show: Q00 `afldb_dev`/`afldb_owner`; Q01 no unexpected foreign session; Q02 `admits_pms` true, 110 last; **Q03 row 705529: `marks` 0, `owner` `afltables`**; **Q04 exactly one row, id 237, inactive**; Q05 `m_rows` 46 and `p_paths` the one path, `match_key` as in section 3; Q06 the newest AFL Tables batch read as the counter baseline (its `canonicalRetryApplied` and `canonicalRowsUpdated` are noted: nonzero values raise the 4.4 risk and are put to the owner); Q07 `recent_not_finished` 0. Record `BATCH_MAX`, `CA_MAX`, `DI_MAX`, `DE_MAX`, `AL_MAX` from Q07/Q08:

```powershell
$b = Get-Content "$RUN\sql\d0-before.json" -Raw | ConvertFrom-Json
$q7 = ($b | Where-Object q -eq 'Q07').rows[0]; $q8 = ($b | Where-Object q -eq 'Q08').rows[0]
$set = @('--set',"BATCH_MAX=$($q7.max_batch)",'--set',"CA_MAX=$($q8.ca_max)",'--set',"DI_MAX=$($q8.di_max)",'--set',"DE_MAX=$($q8.de_max)",'--set',"AL_MAX=$($q8.al_max)")
```

**G4 owner acknowledgement of 4.4** (unrelated canonical writes possible; they will be listed, not reverted).

## 6. Steps

Every step: write the wall-clock start, run, save outputs under `$RUN`, **read the state classifier** (`node "$SD\sd-sql.mjs" dev "$SD\sd-state.sql" <step>-state --out "$RUN\sql"`; its `state` column must be the state the step is meant to leave), compare, then continue only if the expectation (4.5) holds. **Stop at the first unmet expectation; no improvised repair; no hand SQL write, ever.**

**D1 Match Sheet save** (Playwright MCP, signed-in Super Admin, 1440x900). Navigate to `/admin/data-editor?mode=match-sheet&id=17275` from a fresh page load. Verify in the page that P's `marks` input is 0 and nothing else is edited. Change **only** that input to 1, note `ISSUE-275 State B DEV acceptance`, save. Expect "Match sheet saved successfully (46 players)". Then:

```powershell
node "$SD\sd-sql.mjs" dev "$SD\sd-q.sql" d1-after --out "$RUN\sql"; node "$SD\sd-diff.mjs" "$RUN\sql\d0-before.json" "$RUN\sql\d1-after.json" --ignore Q00,Q01
& powershell -NoProfile -ExecutionPolicy Bypass -File $IR -Script "$SD\sd-host-gate.sh" -ScriptArgs $HEAD40,30 -Log "$RUN\host\d1-gate.txt"   # guard must now read active 1
```

Record the time of the save as T1. **Cap: the decision may stay active for at most 25 minutes (T1 to D3 complete).** If the cap would be exceeded, do D3 immediately.

**D2 settle #1** (re-run the host gate with MIN 30 immediately before; the other timer check is part of it). In `/admin/current-season`, click **Fetch current AFL data now once** (the Super Admin only; if the panel says already running, do nothing). Record the click time as `S2` (`YYYYMMDDTHHMMSS`). Refresh the status panel only (read-only) until the unit is idle; do not click again. Then:

```powershell
& powershell -NoProfile -ExecutionPolicy Bypass -File $IR -Script "$SD\sd-host-after.sh" -ScriptArgs $S2 -Log "$RUN\host\d2-after.txt"; "d2 host exit $LASTEXITCODE"
node "$SD\sd-sql.mjs" dev "$SD\sd-q.sql" d2-after --out "$RUN\sql"
node "$SD\sd-sql.mjs" dev "$SD\sd-q-after-settle.sql" d2-settle --out "$RUN\sql" @set
node "$SD\sd-diff.mjs" "$RUN\sql\d1-after.json" "$RUN\sql\d2-after.json" --ignore Q00,Q01
```

Compare to 4.5. Read the batch's `validation_result` against the Q06 baseline counter by counter.

**D3 Return to source** (same page, "Durable Match Sheet decisions", P). Accept the confirm dialog once. Expect the "Returned to source" message. Optional S4 check (a second tab loaded before D3, then clicked after): expect "There is no durable Match Sheet authority" and no write. Then `sd-q.sql` as `d3-after` and the diff against `d2-after`; guard REFUSED active 0. **P's `marks` is still 1 here, by design.**

**D4 settle #2** (host gate MIN 30 first; timers must still be at least 30 minutes away, else wait for the nightly: the nightly restores the row itself). Same click as D2, `S4` recorded. Then `sd-host-after.sh $S4`, `sd-q.sql` as `d4-after`, `sd-q-after-settle.sql` as `d4-settle` with the **same** baseline variables (so A02 lists both settles' ledger rows), and the diff `d3-after` to `d4-after`.

**D5 close** (read-only): `sd-q.sql` as `d5-final`; diff `d0-before` to `d5-final` must show differences only in the retained-history items of 4.6, in the D4 restamp of `import_batch_id`, in `Q06`/`Q07`/`Q08`/`Q11` counts, `Q14` and `Q15`, and in any 4.4 rows listed verbatim; `Q03` `marks` 0; `Q04` id 237 inactive; `p_minus_marks_batch_md5` equal to d0; `m45_md5` equal; `Q12` `matches_2026`, `match_period_scores_2026`, `pms_2026_not_M`, `brownlow_round_votes_2026`, `seasons_2026`, `club_seasons_2026_without_id` equal to d0 (unless 4.4). Host gate with `-ScriptArgs $HEAD40,0` for identity, health and guard only (its window lines are informational at this point); journal check for the whole window:

```powershell
& powershell -NoProfile -ExecutionPolicy Bypass -File $IR -Script "$PK\reused\smoke-journal.sh" -ScriptArgs $T1 -Log "$RUN\host\d5-web-journal.txt"
```

**D6 later (read-only):** the next nightly AFL Tables and AFL API counters, recorded as an observation.

## 7. Recovery after every mutation

**7.0 Rules that apply to every recovery.** (1) After any interruption, error, timeout or doubt, run `sd-state.sql` **first** and decide from its `state`, never from the UI message or from memory. (2) Never repeat a mutation blindly: a second Match Sheet save of the same value plans nothing; a second click while the unit runs does nothing; a second Return to source writes nothing (S4). (3) **No hand SQL write, ever**, and **never re-save the Match Sheet to "undo" a value**: a save mints or re-activates a durable decision (record 237) at whatever value it carries and would start a new, longer exposure. (4) Do not stop, kill or restart a settle unit or the service (the web service has no right to, and the pack does not grant one); a running settle is waited for. (5) A recovery is only ever the step that was already approved (D3, a settle, or waiting for the nightly).

**7.1 State map.** `sd-state.sql` (validated by a 9-scenario truth table, `evidence/state-truth-table-check.txt`) returns exactly one of:

| State | Meaning | Where it arises | Recovery |
|---|---|---|---|
| S0 | marks 0, record 237 inactive | the start, and the end after D4 | none; compare with the baseline |
| S1 | decision active, marks 1 | after D1 until D3 | **D3** (Return to source), once no settle is running |
| S2 | RELEASED, NOT RESTORED: marks 1, record 237 inactive | after D3 until the restoring settle | **7.3** |
| S3 | marks 0 while the decision is active | D2 or the nightly reverted a protected value | stop and report: a HIGH finding on the applier or the authority scoping; do D3 only with the owner's go-ahead |
| S-X | anything else (row missing, another owner, authority records other than exactly {237}, another value) | unexpected | stop and report; change nothing |

**7.2 Per mutation: what can go wrong and the recovery.** "Undo class": **R** = undone by a procedure step; **N** = undone by the nightly settle; **H** = history, kept; **X** = cannot be restored.

| Mutation | Possible outcomes (how to tell) | Recovery | Undo class of what remains |
|---|---|---|---|
| **D1 Match Sheet save** | (a) refused or failed: state S0, no `data_edits` row (atomic); (b) committed: S1; (c) UI hung or message lost (as happened with other actions): trust `sd-state`, never retry blind | (a) read the refusal text; stop; the cause is the finding. (b) continue to D2 inside the window, or go to D3. (c) as (a) or (b) from `sd-state` | the recompute of the 46 players' derived rows and the `data_edits` row are **H/X** (values equal; new tuple versions) |
| **D2 settle \#1** | (a) success, no canonical change; (b) success with unrelated canonical changes (A02 lists them); (c) failed and rolled back (nothing canonical; batch row and host snapshot remain); (d) unit red after commit (`--require-complete-source` is judged after commit): read A01/A02; (e) S3 (value reverted); (f) still running (`sd-host-after.sh` exit 2) | (a) go to D3. (b) record verbatim, tell the owner, then D3; **never revert**. (c)/(d) do **D3 next** (the decision must not stay active across a failure) and wait for the nightly or an approved D4. (e) stop and report. (f) wait; D3 only after the unit is idle | host snapshot, manifest, batch row, spine updates are **H/X**; unrelated canonical writes are **H** (a later source correction may change them, this procedure never does) |
| **D3 Return to source** | (a) success: S2, 237 inactive; (b) refused because a settle is running (retryable): still S1; (c) stale-tab S4 message: nothing written; (d) failed: S1 | (a) go to D4 or 7.3. (b) wait until idle, retry once. (d) stop; 237 stays active; the owner decides (the 25-minute rule in 7.2a keeps running) | `data_overrides` 237 retained inactive and a `data_edits` row are **H** |
| **D4 settle \#2** | (a) success: S0 (marks 0) and the single expected ledger row; (b) success but marks still 1: S2; (c) failed or red; (d) not run | (a) D5. (b)/(c)/(d) 7.3 | the D4 ledger row, the season-wide recompute (`club_seasons` 2026 re-inserted with new ids) are **H/X** |

**7.2a The approval window and its expiry (proposed terms for the owner to adopt or change; see section 10).** The decision may stay **active for at most 25 minutes** (from the D1 save time T1 to the end of D3). Because an approval that lapses must never strand the system in a worse state, the proposed terms are:
1. **Before T1 + 25 minutes:** the steps run as written.
2. **At expiry with no settle running (state S1):** no new settle may start; the only permitted action is **D3** immediately. D3 is a recovery action and is covered by the approval even after the window (the window limits how long the decision stays active and when D1/D2 may start, not whether the operator may release it).
3. **At expiry with D2 running:** the unit cannot and must not be stopped. Wait for it to finish (it is bounded by the unit's own 60-minute `TimeoutStartSec`), then **D3 immediately**. The expiry is then exceeded by the unit's remaining run time; this is recorded, not hidden. If the unit is still running at T1 + 60 minutes, stop and tell the owner (the decision stays active until the unit ends or the owner decides).
4. **D3 refused because the unit is running:** retry D3 once the unit is idle; the deadline in item 3 applies.
5. **After D3 (state S2) at or after expiry:** D4 may start only if it can start within **30 minutes after D3** and both settle timers are still at least 30 minutes away. Otherwise do **not** start it: wait for the nightly (7.3). D4 is then not a recovery action; it needs the owner's approval to extend if the window has expired.
6. **If the approval is withdrawn or lapses while the state is S1 or S2:** only D3 (from S1) is done; from S2 nothing is done (the nightly restores).
7. **Nothing in these terms permits** starting D1 or D2 after expiry, a second attempt of D1, or any other mutation.

**7.3 Return to source succeeded, but the restoring settle cannot run (state S2).**
- **What is true in S2:** DEV's canonical `player_match_stats` row 705529 holds `marks` **1**, the AFL Tables source says **0**, the decision (record 237) is **inactive** and protects nothing, and the derived rows for player 345 reflect 1. Public pages for the 2026 Grand Final show the edited value (if no cache hides it) until the restore. The guard reads REFUSED with active 0 (history exists).
- **Why it is self-correcting:** the AFL Tables settle re-offers ("retry") any canonical value that differs from the source and is no longer protected; batch 101 on 3 October restored exactly this value that way (`canonicalRetryApplied` 1, one ledger row `marks 1 -> 0`). The **next scheduled AFL Tables run (nightly at 04:30 plus up to 15 minutes) therefore restores it with no action**, provided that run can complete.
- **Default recovery:** do nothing except record S2, then read the next nightly (`sd-state.sql` should return S0; `A01`/`A02` should show the single `update` row).
- **If the cause of the failed or skipped D4 is a transient problem** (AFL Tables unreachable, the unit red, a timer within 30 minutes): once it is cleared, an **on-demand settle** (the D4 step) may be run with the owner's approval for that run; it needs its own gate (`sd-host-gate.sh`).
- **If the nightly also fails to restore** (still S2 after a successful nightly): open a defect; the value stays 1; **no hand repair** and **no Match Sheet re-save** (7.0).
- **If the nightly cannot run for days** (AFL Tables outage): S2 persists; the exposure is a single wrong statistic in one match; tell the owner, who decides whether to accept it for now.
- **What would make S2 worse:** a Match Sheet save on match 17275 (it would re-activate record 237 at a new value); a rebuild or promotion (DEV is roll-forward only; out of scope).

## 8. Failure handling summary (stop at the first unmet expectation; 7 is the detail)

| Event | Action |
|---|---|
| Save refused or failed (D1) | atomic: expect no change; re-read Q03/Q04/Q09; stop; the message is the finding |
| D2 shows `marks` back at 0 | HIGH finding on the applier or the authority scoping; stop; id 237 stays **active** and protects the next nightly; do D3 and D4 only with the owner's go-ahead |
| A settle fails or the unit is red | the settle is one transaction: expect no canonical change; `--require-complete-source` is evaluated after commit, so a red unit can follow committed data: read A01/A02. Do not start another unit. At D2 failure: do D3, then wait for the nightly (or D4 only if the owner agrees) |
| Unexpected ledger row for M or P, or a new refusal, rejection, failure or finding | stop and report; **no revert** |
| Unrelated canonical rows (4.4) | record verbatim, tell the owner, continue only if the owner agrees; never hand-revert |
| D3 fails or the panel shows an unexpected state | stop; id 237 stays active; the owner decides |
| D4 does not restore `marks` 0 | wait for the next AFL Tables nightly (the retry reverts it); if still 1 afterwards open a defect; no hand repair |
| A timer fires inside the window, the 25-minute cap is reached, or the service or health changes | abort at a documented state: before D1, or after D4; never leave the decision active across a nightly without an owner decision |
| `sd-host-after.sh` exits 4 (journal unreadable) or 2 (still running) | UNKNOWN is not PASS: fix access or wait; do not start another settle |
| Never | deploy, restart, change settings, run a migration or reversal (DEV is roll-forward only), delete 237 or any row, rebuild, start the AFL API units, touch PROD, edit any file under the repository on the host |

## 9. Retained and non-restorable changes (deliberate; none is undone by this procedure)

| Item | Why it stays | Restorable? |
|---|---|---|
| `data_overrides` id 237 (inactive, with a newer `updated_at`/`admin_user_id`) | D-257-7 history; the reversal of migration 110 is blocked once any such record exists | no (history) |
| 2 `data_edits` rows (mint, withdraw), the `old_values`/`new_values` they carry | required audit | no |
| 2 `import_batches` rows with `validation_result` | each settle's record | no |
| the D4 `canonical_applications` row (and any 4.4 rows) | the ledger | no |
| `staging.source_records` `last_seen_at`/`last_batch_id`/`absent_since` for about 20,000 rows, twice | the spine records the latest sighting; the prior values are overwritten | **no (X)** |
| `club_seasons` 2026 rows: deleted and re-inserted with **new surrogate ids** (D4, season-wide recompute); equal values | the recompute is delete-and-insert | ids **no (X)**; values equal |
| derived rows of the 46 players (D1) and of player 345 (D4): delete-and-insert / update with equal values; `player_match_stats.career_game_no` rewritten with equal values | recompute | tuple versions **no (X)**; values equal |
| 2 host snapshot directories and 2 untracked manifests | immutable by design; the gates tolerate the manifests | no (not deleted by this procedure) |
| 0-2 `auth_audit_log` rows (button) | audit | no |
| journal lines; AFL Tables request logs (third party); ISR re-render of `/seasons/2026` | external or transient | no |
| sequence advances | sequences never roll back | no |
| dead tuples / bloat from the recomputes | autovacuum | n/a |

## 10. Owner decisions needed before any run (none is taken here)

- **O-1 Scope.** Approve or decline stage S-D as the full effects in section 4 (not "one Match Sheet row").
- **O-2 Whether S-D is required at all.** The runbook's wording of the State B requirement does not say "on DEV" (runbook section 47). The owner decides whether the completed test-database evidence (S-T plus the fixture-season 17.8 case) satisfies it, or whether a live DEV exercise is wanted in addition.
- **O-3 The window terms in 7.2a** (25-minute cap, D3 as a recovery covered after expiry, the 30-minute D4 start limit, the 60-minute stop-and-tell).
- **O-4 4.4 acknowledgement.** Unrelated canonical writes by either settle are possible, will be listed and not reverted.
- **O-5 Trigger.** The admin button (writes an `auth_audit_log` row) or `systemctl start --no-block afldb-settle-afltables.service` (no audit row).
- **O-6 Who clicks and when**, and the date/time window (outside 02:00-03:15 and 04:00-05:40; both timers at least 60 minutes away at D1).
- **O-7 The optional `--dry-run --auto-apply` preview** (not part of this procedure; a rolled-back DEV transaction, needs its own approval).

## 11. Evidence in this package (all generated before packaging; re-generated from a fresh extraction when the ZIP was verified)

| Evidence | What it shows |
|---|---|
| `evidence/syntax-checks.txt` | `bash -n` on the three shell scripts and `node --check` on the two Node scripts, all exit 0 |
| `evidence/parse-sd-q.json` | all 16 statements of `sd-q.sql` parse and run (read-only) on `afldb_test` and return the expected row shapes (the match 17275 rows are absent there; this is a shape proof, not a DEV proof) |
| `evidence/parse-sd-q-after-settle.json` | the six statements of `sd-q-after-settle.sql` with numeric placeholders |
| `evidence/parse-sd-state.json` | `sd-state.sql` runs |
| `evidence/state-truth-table.sql`, `state-truth-table-result.json`, `state-truth-table-check.txt` | the real classifier over 9 constant scenarios: all 9 labels as expected |
| `evidence/parse-readonly-proof.json` | a write statement is refused by the runner: `cannot execute UPDATE in a read-only transaction` |
| `MANIFEST.sha256`, `verify.mjs` | the complete contents manifest and its re-check |

**Limits.** Parse evidence proves the SQL is well-formed and reads only; it does not prove the DEV values. The host scripts were syntax-checked only; they have never run on the host (the reviewed runner they use has). Nothing here establishes how the real DEV data will answer.

## 12. Approval the owner would record

D-275-STATEB-SD-1: stage S-D on DEV only; one Match Sheet save (match 17275 / player 345 / `marks` 0 -> 1); one Return to source; two on-demand AFL Tables settles with the effects of section 4 (including host files, third-party fetch, spine overwrites, possible unrelated canonical writes and the D4 season-wide recompute); read-only SQL as `afldb_owner` through the tunnel; the window and the terms in 7.2a (as the owner adopts them in section 10). **Not authorised:** deployment, restart, settings or hook change, any migration, manual SQL writes, deleting 237 or any row, rebuilds, the AFL API settle units, the `--dry-run` preview, PROD, widening the case. Afterwards: a records commit under the exact-18 exception.
