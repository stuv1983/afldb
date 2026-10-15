# AFLDB-ISSUE-275: stage S-D procedure (live DEV State B decision) - PREPARED, NOT RUN, NOT APPROVED

Companion to `issues/open/AFLDB-ISSUE-275.md` (sections 42 and 44). Prepared 2026-10-16 after the S-T stage. **Nothing in this file has been run against DEV.** The only contact was read-only: the SQL below was proved to parse and return the expected shapes on `afldb_test` (a different database), and the scripts were syntax-checked. S-D needs the owner's explicit approval (proposed decision ID **D-275-STATEB-SD-1**); until it is recorded, no step may be run.

## 1. What S-D would and would not show

One real Match Sheet decision on one real DEV row, protected through two real on-demand AFL Tables settles, then released by Return to source and restored by a settle, on DEV at the ISSUE-275 revision `0cb3d20cecf2787df8bb5f8592a86768a78db646` (State B since 2026-10-03). It would show the durable protection and release behaviour through the real editor and the real settle. It would **not** show: repeatability, anything about PROD, the AFL API ownership path (DEV has no afl_api-owned 2026 match; the 17.8 case stays unrun), or ISSUE-275's refusal branch (unreachable on DEV data). It also cannot be a pure "one row" test: **each settle is a full pipeline run over the whole 2026 season** (section 4), so the stage must be approved as that, not as "one Match Sheet row".

## 2. Pack

Outside the repository, hashed (re-hash before use; any difference means stop and re-review): `D:\tmp\issue275-sd\pack\` and `PACK.sha256` beside it.

| File | Purpose | sha-256 |
|---|---|---|
| `sd-sql.mjs` | READ ONLY SQL runner through the operator's 55432 tunnel; refuses unless the endpoint is `afldb_owner@127.0.0.1` / `afldb_dev` (or `afldb_test` for proofs); every statement in `BEGIN READ ONLY`; no credential printed | `5e6b787467eb9ab9a8084e17353ec00f9bd6ae80a19448b9b554ca0ea93d7187` |
| `sd-diff.mjs` | offline comparison of two result files, statement by statement | `4fd2c63fe32c007fa888dd2fe6b9716b86c058c24d1db0f32b15a32f546e57f0` |
| `sd-q.sql` | Q00-Q15 before/after state (identity, sessions, CHECK, Q1, Q2, md5s, newest batches, audit high-water marks, finding fingerprints, whole-table counts, 2026 canonical fingerprints, derived rows of the 46 players, staging spine, sequences) | `94c26b6a662d4392831a645aa147e30389206a74fb3bbe00c77d4047875fc821` |
| `sd-q-after-settle.sql` | A00-A05: batches, ledger rows, findings, rejections/candidates and audit rows created since the baseline | `5c93b74a099163f0ba42030c75ab7a459fe466c34d53b22465709f8953bb6100` |
| `sd-host-gate.sh` | host gate, READ ONLY (window, timers, units, HEAD/tree, health, trigger prerequisites, migrations, rollback guard) | `e6f2bb925e23c3cfd487e3d65f285ce586dabcaa5d8ce5321f6c532e402ea479` |
| `sd-host-after.sh` | host read of what one settle did (unit result, complete journal, files created, identity, timers) | `8218309876b42731020b71b75668993e717f0118da52c3428ebc99e6613d8ec2` |
| reviewed runner `D:\tmp\dev-deploy-next-20261015-rev2\reused\Invoke-Remote.ps1` and `remote\smoke-journal.sh` | transport and web-journal check, reused unchanged | `18c8adbb3097aecea09a4e23bdb16f56054eb1ccc8a3086371ff322ae14c193d` (runner) |

Full hashes are in `PACK.sha256`. Variables (PowerShell 5.1 on the workstation):

```powershell
$SD  = 'D:\tmp\issue275-sd\pack'
$IR  = 'D:\tmp\dev-deploy-next-20261015-rev2\reused\Invoke-Remote.ps1'
$PKG = 'D:\tmp\dev-deploy-next-20261015-rev2'
$RUN = 'D:\tmp\issue275-sd\run-' + (Get-Date -Format 'yyyyMMdd-HHmm')   # new, must not exist
New-Item -ItemType Directory -Path "$RUN\sql","$RUN\host","$RUN\shots" | Out-Null
$HEAD40 = '0cb3d20cecf2787df8bb5f8592a86768a78db646'                   # re-read; a later recorded TARGET replaces it
```

Host commands go through `$IR` (the reviewed transport; the DEV host needs the operator's interactive credentials, so these are operator-run). SQL runs on the workstation through the operator's open tunnel; **no DSN is ever on a command line**.

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

Every step: write the wall-clock start, run, save outputs under `$RUN`, compare, then continue only if the expectation (4.5) holds. **Stop at the first unmet expectation; no improvised repair; no hand SQL write, ever.**

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
& powershell -NoProfile -ExecutionPolicy Bypass -File $IR -Script "$PKG\remote\smoke-journal.sh" -ScriptArgs $T1 -Log "$RUN\host\d5-web-journal.txt"
```

**D6 later (read-only):** the next nightly AFL Tables and AFL API counters, recorded as an observation.

## 7. Failure handling (stop at the first unmet expectation)

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

## 8. Approval the owner would record

D-275-STATEB-SD-1: stage S-D on DEV only; one Match Sheet save (match 17275 / player 345 / `marks` 0 -> 1); one Return to source; two on-demand AFL Tables settles with the effects of section 4 (including host files, third-party fetch, spine overwrites, possible unrelated canonical writes and the D4 season-wide recompute); read-only SQL as `afldb_owner` through the tunnel; the stated window and 25-minute cap. **Not authorised:** deployment, restart, settings or hook change, any migration, manual SQL writes, deleting 237 or any row, rebuilds, the AFL API settle units, the `--dry-run` preview, PROD, widening the case. Afterwards: a records commit under the exact-18 exception.
