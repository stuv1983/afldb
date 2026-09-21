# AFLDB-ISSUE-228 — AFL.com.au official JSON APIs as the current-season match, stats and Brownlow source

**Status:** Open — PLAN, amended 2026-09-19 with operator decisions Q1/Q2/Q7 and four
tightening points (§0.1, §19). This document is the frozen implementation contract for S0–S10;
**current per-stage execution status is tracked in `issues.md` (AFLDB-ISSUE-228), not here.**
As of 2026-09-20: S1–S5 implemented and operator-validated; S6's core operational settle path is
implemented and operator-validated (per operator evidence: `tsc --noEmit` clean,
`settle-afl-api.test.ts` 5/5, `current-season-import.test.ts` 258/4-skipped,
`settle-afltables.test.ts` unregressed at 64/1-expected-skip); two S6 gaps remain deliberately
open (the ISSUE-131 rekey search for `afl_api`; the `match`-family absence sweep). S7 (Brownlow,
§10) is implemented but UNEXECUTED — no test/tsc/DB/Git/deployment command has been run by the
assistant for S7 (CLAUDE.md §9); pending operator validation against the local Brownlow simulator
first, then `afldb_test`. As of 2026-09-20 (later same day), the §16 S7 deliverable row's
completed-season artefact builder (`tools/migration/build_brownlow_season_artefact_from_afl_api.py`)
is also implemented, likewise UNEXECUTED — see `issues.md` "S7 completed-season Brownlow
season-artefact builder" for detail. The `staging.afl_api_brownlow_vote` typed-projection gap
remains open and out of scope for that pass. As of 2026-09-21: **§9.10 historical Brownlow
equality (2022–2025) is operator-proven CLOSED / PASS** (see `issues.md` "§9.10 — HISTORICAL
CLOSEOUT" paragraph) — every season's vote sets, positive vote rows, provider identities and
exact canonical equality now reconcile with every mismatch/failure counter at 0; the historical
fixture-observation prerequisite is likewise satisfied for 2022–2024. **S7 itself remains
OPEN** — the separate real live-count capture/replay requirement has not occurred; the 2026 count
is imminent. Assertion 9 (§9.9) remains SKIPPED (documented, not a silent pass) and is a distinct,
still-open ISSUE-228 closeout item. **S7 is still not complete.** As of 2026-09-21: **S8
(operations) is implemented, UNEXECUTED and NOT installed/enabled** — package scripts, the
`deploy/afldb-settle-afl-api*`/`-brownlow*` unit/timer/script files, a read-only `settle-status.ts`/
`settle-trigger.ts` three-unit table, the `AFLDB-2026-API-ACQUISITION.md` §5/§0 rollover-doctrine
correction (Q7), `.env.example`/`docs/deployment.md` variable documentation, and a new manual
Brownlow live-count operator runbook — see `issues.md` "S8 operations implementation" for the full
record, including the disclosed discrepancies against the original §17 sketch (`emit:afl-api`'s
real scope, `bridge:afl-api` deliberately not added, no admin on-demand trigger for the two new
units). S9–S10 not started. S5 (§6.3, this document) was operator-executed and
validated on `afldb_test` only (contract test, builder `--validate-only`/`--write`, importer
`--validate-only`/`--dry-run`/`--apply`, post-apply idempotency dry-run) — see `issues.md` for the
full evidence record. No database, Git, network or deployment command has been run by the
assistant in any pass (CLAUDE.md §9); every DB-touching step recorded as "validated" above was
executed by the operator.

**As of 2026-09-21 (later same day): S8 (operations) is operator-validated COMPLETE.** Per
operator-supplied evidence (no test/tsc/DB/Git/network/deployment command run by the assistant,
CLAUDE.md §9): `npx tsc --noEmit` PASS; `tests/admin-current-season-settle.test.ts` 38/38 PASS;
`sh -n deploy/afldb-settle-afl-api.sh` and `sh -n deploy/afldb-settle-afl-api-brownlow.sh` both
PASS; a systemd safety inspection of the new units found no `afldb_test`/`afldb_dev`/prod
database, local-tunnel or simulator URL hard-coded. The same inspection of the manual Brownlow
live-count operator runbook originally found its write-target guard checked the wrong
environment variables; that blocker is now fixed — `AFLDB_IMPORT_DATABASE_URL` is bound
process-locally from `AFLDB_TEST_IMPORT_DATABASE_URL` and independently re-verified by
`SELECT current_database() = 'afldb_test'` before any write; real-feed/simulator overrides are
explicitly cleared and positively checked; the 2026 `staging.afl_api_match` prerequisite is
explicitly documented in the runbook. **No DEV or PROD deployment has occurred.** **S1–S6 are
COMPLETE. S7 remains OPEN** — the sole remaining acceptance item is the real 2026 live-count
capture/replay evidence (do not mark S7 complete before that event evidence exists). **S9 is
NOT STARTED**, requiring a later DEV dry-run/apply, AFL Tables corroboration and Brownlow replay
after the S7/S8 prerequisites. **Assertion 9 (§9.9) stays explicitly separate from the Brownlow
live-count replay and remains SKIPPED/open** — only one formal monitor-capture pair
(`CD_M20260142801`) exists; it is not PASS and is not closed by tonight's Brownlow snapshots; it
must be explicitly dispositioned before final ISSUE-228 closeout (see `issues.md` "§9.10 —
HISTORICAL CLOSEOUT" for the full Assertion 9 disposition options). Full evidence and file list:
`issues.md` "S8 operator-validated" paragraph.

**As of 2026-09-21 (later same day): merged to main and deployed to DEV** (commit `bbf87566`).
During DEV acceptance the operator found no super-admin UI control existed to enable/disable AFL
API current-season or Brownlow ingestion, and **paused S9 before any real-feed acquisition**
pending one. Super-admin-controlled, fail-closed, server-side-enforced ingestion switches were
added this pass — see `issues.md` "operational-control gap found during DEV acceptance" paragraph
for the full architecture and file list. **This does not change S7 (still OPEN), S9 (still NOT
STARTED — the control exists but neither switch was enabled and S9 has not resumed) or Assertion 9
(still SKIPPED/open).**

## 0.1 Operator decisions recorded 2026-09-19 (binding on every stage below)

| Decision | Ruling | Where applied |
|---|---|---|
| **Q1 ownership** | **APPROVED: co-source corroboration.** Existing 2026 canonical rows stay `afltables`-owned; `afl_api` corroborates them. A row first promoted from `afl_api` is naturally `afl_api`-owned. No row is ever re-owned merely because another source now corroborates it. | §7.5, S6, §19.1 |
| **Q2 attendance** | **APPROVED: AFL Tables as optional, field-scoped attendance enrichment** on `afl_api`-owned matches. Missing attendance never blocks match promotion. Reviewed/manual Super Admin attendance is never overwritten by automated enrichment. **Clarified:** the gate keys on `matches.attendance_source_id IS NULL` (an unsourced field), never on match completion; a CONCLUDED, fully settled match stays eligible. | §7.5, §8 gate 12, §19.2 |
| **Q7 rollover** | **APPROVED: rollover re-acquisition corroborates, never re-owns.** The completed-season fitzRoy/AFL Tables full-history re-acquisition corroborates independently sourced canonical data; any ownership transfer requires an explicit rule or operator decision, never "the rollover ran later". | §14 R7, S10, §19.3 |
| **T1 player bridge** | Stat-vector bridge is a **bootstrap/backfill mechanism only**; it must yield durable trusted `afl_api` `external_identities`; normal ingestion must resolve bridged players **without AFL Tables present**; unresolved/new players are never guessed and stay unresolved/HALT, with debutant gaps continuing through ISSUE-224. | §6.3, S5, §19.4 |
| **T2 semantic hashing** | raw immutable payload → parse → canonical JSON → semantic hash. **No exclusion list on assumption**; every exclusion needs repeated evidence, documentation and a fixture/regression test. | §4.5, §5.2, §9.9, §19.5 |
| **T3 POSTGAME** | POSTGAME is valid source data that is not yet eligible for completed-match promotion: represent it as **observed/deferred**, not rejected, and never report a normal POSTGAME → CONCLUDED lifecycle as a failed run followed by success. | §7.3, S6, §19.6 |
| **T4 round mapping** | One centralised, per-season, tested translation contract; no scattered `roundNumber + 1`; explicit HALT for uncovered season/round combinations. | §2.1, §5.2, §6.4, §19.7 |

---

## 0. Summary of the recommendation

1. AFL.com.au is **not a new source**. It is the existing `afl_api` source (registered by
   migration 077, independence group `afl_api`, shared `CD_` identity namespace already proven
   by ISSUE-100 P3/P4). ISSUE-228 adds **five new families** to that source and a direct-HTTP
   adapter beside the existing fitzRoy-based `lineup` / `roster` adapters.
2. The pipeline is the existing ISSUE-096/099/122 one, **generalised over the source**, not a
   parallel importer: acquisition snapshot + hash-bound manifest → offline bundle emitter →
   `staging.source_*` spine (074) → typed projection (new migration) → `reconcile()` →
   `promotion_candidates` → `applyCanonicalUnit()` under gates E1–E6 → `canonical_applications`.
   The only existing canonical writer is the automatic path (`canonical-apply.ts`); the
   reviewed human accept path is still `canonical_write_unimplemented`
   (`promotion-review.ts:719`). The plan does not change that fact.
3. **Provider IDs are identity everywhere**: `CD_M…` is `external_record_id` for the match
   family *and* `matches.source_record_id` (migration 064 column, currently unused by any
   writer) *and*, later, `fixtures.source_record_id` (migration 097 already reserves that
   column for "a FUTURE fixture importer … with the provider's id"). Players resolve through a
   new `external_identities` bridge (`afl_api` / `CD_I…`), never by name.
4. **POSTGAME is observed, never promoted.** Only a `CONCLUDED` fixture status with a
   `CONCLUDED` roster status reaches projection and promotion. Corrections after CONCLUDED
   flow as ordinary `corrected` versions (I2 history is kept by the spine).
5. **Attendance is not sourced** by AFL.com.au. The match proposal carries
   `attendance = NULL` with the non-complete status; AFL Tables (or Super Admin) may enrich
   it later through a narrow, explicitly declared **field-group enrichment** on the
   `attendance` group only, which is already per-field-owned via `matches.attendance_source_id`
   (migration 020).
6. **Brownlow** reuses the same spine and provenance but is a separate stage with separate
   families, its own validator and its own promotion component; it targets
   `brownlow_round_votes` (an existing settle target) and produces an artefact for the
   ISSUE-113 `brownlow_season_votes` loader at rollover. It never rides on the match/stat
   promotion.
7. **Fixture ingestion** is a **successor issue** (recommended `AFLDB-ISSUE-229`), but four
   decisions are taken **now** so it needs no redesign (§13).

The hard dependency that gates any live promotion: **the player-identity bridge (§6)**.
Without it every `player_match_stats` proposal is `unresolved_identity` and the match family
would settle alone. The bridge is deterministic, backtestable and reviewed; it is Stage S5.

---

## 1. Repository findings (exact locations)

### 1.1 Issue tracking
- No `AFLDB-ISSUE-228` existed anywhere in the repository before this pass (`issues.md`,
  `IssuesIndex.md`, `issues/`, Git history). `issues.md` line 37574 records 226 as the last
  allocated ID and 227 as unallocated; 228 is allocated by this document, leaving 227 free.
- Conventions: `issues.md` (authoritative), Open Issues table at its head, `IssuesIndex.md`
  (open only), runbooks in `issues/open/<ID>.md` (CLAUDE.md §5).

### 1.2 The current-season architecture (ISSUE-096 → 099 → 100 → 122 → 128 → 131)
| Component | Location | Role |
|---|---|---|
| Source-family registry | `data/reference/source-families.json` + `src/lib/acquisition/source-families.ts` | Declares per `(source_key, family)`: external key, required/known columns, hash exclusions, `source_updated_at_field`, round vocabulary, independence group, `promotion_policy`. Validator refuses promotion for an unregistered source. |
| Observation spine | `src/db/migrations/074_source_observation_spine.sql`; `src/lib/acquisition/observations.ts`, `observation-store.ts` | `staging.source_payloads` (content-addressed, immutable), `staging.source_record_versions` (ordered A→B→A history, `version_seq`), `staging.source_records` (head + `absent_since`). `persistSourceObservation()`, `markMissingObservationsAbsent()`, `hashPayload()`/`canonicalJson()`. |
| Typed projections | `076_afltables_settle_projections.sql` (`staging.afltables_match`, `staging.afltables_player_match`); `077_afl_api_lineups.sql` (`staging.afl_api_lineup`) | ISSUE-096 Decision B: "the jsonb spine never feeds a promotion; a family with no typed projection cannot be promoted." |
| Reconciliation | `src/lib/acquisition/reconciliation.ts` | Verbs `new / corrected / rescheduled / absent / unresolved_identity / source_disagreement / foreign_owned_collision / manual_authority_conflict / stale_review`; `classifyCorroboration()`, `diffFields()`, `evaluateTargetOwnership()`. |
| Promotion ledger | 074 `promotion_candidates` (CHECK: only `new/corrected/rescheduled` may be accepted), `promotion_decisions` (append-only) | Human review record. |
| Automatic canonical path | `083_canonical_auto_apply.sql` (`canonical_applications`, provenance quartet on `match_period_scores`/`brownlow_round_votes`, `player_match_stats.source_record_id`); `src/lib/acquisition/canonical-apply.ts` (`applyCanonicalUnit`, `autoApplyOwnership`, gates E1–E6 re-read inside a savepoint) | The **only** canonical writer. `canonical_applications_target_table_ck` admits exactly `matches, match_period_scores, player_match_stats, brownlow_round_votes`. Takes `sourceKey` as a parameter — source-neutral by construction. |
| Settle orchestration | `src/lib/acquisition/settle-afltables.ts` (3,450 lines) | Bundle validation (`validateSettleBundle`), `loadRefs()` (clubs by `legacy_club_hist`, venues by `legacy_name`, players by `external_identities` where `match_method = 'afltables_profile_url'`, matches by `match_key`), `resolveTarget()` (match_key lookup + ISSUE-131 rekey), `settleFamily()`, disagreement `data_issues` lifecycle, derived recompute. **Hard-bound to AFL Tables** at: `SETTLE_SOURCE_KEY = 'afltables'` (:108), `BUNDLE_FAMILIES` (:121), `SETTLE_ACQUISITION_KIND = 'in_season_partial'` (:113), the `import_batches.tool` literal `'settle-afltables.ts'` (:1892), `fitzroy_version` in the bundle (:862), and the projection writers (`writeMatchProjection`, `writePlayerMatchProjection` → the two 076 tables). |
| Manual authority | `src/lib/acquisition/manual-authority.ts`, `073_data_overrides.sql`, `src/lib/edit/spec.ts` (`matches` groups: `attendance`, `score`) | `data_overrides` is the only authority record; settle targets other than `matches`/`fixtures` are proven unrepresentable there. Source-neutral. |
| Completeness / status / trigger | `source-completeness.ts` (ISSUE-128), `settle-status.ts` + `settle-trigger.ts` (ISSUE-127, one hard-coded unit `afldb-settle-afltables.service`), `season-revalidation.ts` (ISSUE-134 ISR publish) | Status surfaces are single-unit today. |
| CLI + chain | `tools/current-season/settle-afltables.ts` (`--label --dry-run/--apply --auto-apply --report --require-complete-source`), `deploy/afldb-settle-afltables.sh` (acquire R → `import_fitzroy_core.py --emit-observations` → settle), `.service`/`.timer` (04:30 nightly, `Persistent=true`) | Snapshot under `data/sources/afltables/fitzroy_core/<label>/`, manifest under `docs/rebuild-manifests/afltables_fitzroy_core/<label>.json`, manifest written LAST, re-hashed before any DB contact. |
| Bundle contract | `settle-afltables.ts:585-631` (`SettleBundle`), Python emitter `tools/migration/import_fitzroy_core.py` (§ "observation-bundle emission", `match_key_of()` :1880), `tests/python/settle_emit_contract.py` | `bundle_contract_version 1`; records `{family, scope_key, external_record_id, payload, observed_columns, projection|null, rejection|null}`; `enumerations[{family, scope_key, complete, external_record_ids}]`; `unkeyed_rejections`; `counts`. |
| Existing `afl_api` adapters | `tools/rebuild/afl_api/afl-api-contract.json`, `acquire_lineups.R` (fitzRoy `fetch_lineup_afl`), `emit_lineup_bundle.ts` → `src/lib/acquisition/lineup-bundle.ts`, `persist_lineups.ts` → `lineup-store.ts`; `acquire_rosters.R` + `tools/migration/enrich_heights_afl_api.py` (rosters 2012–2026, manifest `docs/rebuild-manifests/afl_api/rosters-20260905.json`) | Staging-only lineups (promotion `never`); rosters are height corroboration only. **No direct-HTTP AFL API code, no `WMCTok`/`x-media-mis-token`, no CFS/SAPI URL exists anywhere in the repository.** |
| Retired current-season path | `src/lib/external-afl/current-matches.ts` (Squiggle/Kali), `063_external_current_match_sources.sql`, `tools/current-season/update-current-season.ts` | `--update-matches` / `--insert-missing-matches` hard-refused since ISSUE-122; staging/diagnostic only. |

### 1.3 Canonical schemas that matter
- `matches` (003 + 020 + 064 + 084/085): `match_key = season|round_code|match_date|home hist|away hist` UNIQUE; `round_type` enum incl. `wildcard_final`; `round_number` NULL for finals; scores/result/margin NOT NULL; `attendance` NULL = not recorded, `attendance_status coverage_status NOT NULL`, `attendance_source_id`; `scheduled_at timestamptz` (no reader or writer since 003); provenance quartet `source_id, source_record_id, import_batch_id, imported_at` (064).
- `match_period_scores` (003): **cumulative-to-date** per club per period; provenance quartet (083).
- `player_match_stats` (004 + 083): 21 nullable stat columns + `career_game_no`, `jumper_number text`, `brownlow_votes`; `UNIQUE (player_id, match_id)`; `source_id`, `import_batch_id`, `source_record_id`.
- `external_identities` (002): `UNIQUE (source_id, external_id)`, `status link_status`, `match_method`. Today only `afltables` / `afltables_profile_url` links exist (`settle-afltables.ts:1685-1692`); migration 077 comment: "No afl_api identity exists in external_identities and no approved deterministic bridge populates one."
- `brownlow_round_votes` (005 + 083): `UNIQUE (season, player_id, round_number)`, `played`, `votes 0–3`; canonical `round_number` is AFL Tables numbering (Opening Round = 1 from 2024).
- `brownlow_season_votes` (005): authoritative totals; sole writer `tools/migration/import_brownlow_season.py` from the tracked artefact `data/brownlow/season-votes.csv`; refuses `in_progress` seasons; `stat-availability.json` marks all three Brownlow grains `pending` for 2026.
- `fixtures` (097, ISSUE-162): scheduled-match registry, `fixture_key` UUID identity, `UNIQUE (source_id, source_record_id)`, status `scheduled|cancelled|void`, no score columns, read-time "played" resolution via `(season, round_code, home, away)`, `isFixtureEditAllowed()` locks played fixtures. Written today only by `src/db/queries/admin-fixtures.ts` under `manual_admin_edit`.
- Not stored anywhere: umpires, weather, milestones, club debuts, time-on-ground, metres gained, extended Champion Data statistics. `player_achievements` (053) holds only `first_kick_goal`.
- Manual paths: `src/db/queries/match-admin.ts` `createMatch()` (writes no provenance; renders `round_code` decimal/EF..GF), `match-sheet.ts` (no provenance columns written), CSV/email `matchResults.promoteRow()` (stamps provenance since ISSUE-185).

### 1.4 `data/sources` tracking
`.gitignore:120-135`: everything under `data/sources/` is ignored except
`data/sources/afltables/coaches/*/parsed/`. The sample tree `data/sources/AFLWebsite/…` is
therefore **untracked local evidence**, as intended. The repository convention for raw
acquisitions is: bytes untracked, **manifest tracked** under `docs/rebuild-manifests/<source>/`
and hash-bound (`fitzroy-accepted-baselines.json`, `afl-api-contract.json` `accepted_snapshot`).

### 1.5 Code that assumes AFL Tables is the only current-season source
- `settle-afltables.ts` (constants listed in §1.2), `deploy/afldb-settle-afltables.sh`,
  `settle-status.ts`/`settle-trigger.ts` (one unit), `source-completeness.ts` counters named
  for the settle bundle.
- `docs/acquisition/AFLDB-2026-API-ACQUISITION.md` §5 rollover row: "re-acquire the completed
  season through the standard full-history fitzRoy path … supersede in-season provenance" —
  incompatible with `afl_api`-owned rows unless amended (§14 R7).
- `tools/db/rebuild-test.ts:1255` `matches_after_accepted_last_season = 0` — unaffected
  (in-season rows are never in the historical core).
- `import_brownlow_season.py` `SOURCE_KEY` fixed to `afltables` (operator decision 2026-09-04).

---

## 2. What the captured payloads actually say

All raw files are single-line JSON; findings below were extracted with anchored searches.

### 2.1 Season matches feed (`aflapi.afl.com.au/afl/v2/matches?competitionId=1&compSeasonId=<id>&pageSize=1000`)
- Envelope `{meta, pagination{numEntries}, matches[]}`; 2026 = 218 entries, 2025/2024/2023 = 216, 2022 = 207.
- Match object: `id`, **`providerId` (`CD_M…`)**, `compSeason{id, providerId CD_S…}`,
  `round{id, providerId CD_R…, abbreviation, name, roundNumber, byes[], utcStartTime, utcEndTime}`,
  `home/away{team{id, providerId CD_T…, name, abbreviation, nickname, club{providerId CD_O…}}, score{goals, behinds, totalScore, superGoals}}`,
  `venue{providerId CD_V…, name, timezone, state, landOwner}`, `utcStartTime`, **`status`**,
  `metadata{finals_match_label, ticket_link}`.
- **Round vocabulary (2026):** `OR`/"Opening Round" = **0**, "Round N" = N (1..24), `WF`
  "Wildcard Finals" = 25, `QE` "Qualifying & Elimination Finals" = 26, `SF` = 27, `PF` = 28,
  `GF` = 29. AFL Tables (and therefore AFLDB `round_number`) numbers the Opening Round **1**,
  so **canonical H&A round = AFL `roundNumber` + 1 for seasons that have an Opening Round**
  (2024, 2025, 2026 feeds contain one; 2022, 2023 do not → offset 0). `QE` cannot be split
  into `QF`/`EF` from the round object; **`metadata.finals_match_label`** ("First Qualifying
  Final", "Second Elimination Final", …) does it for 2026 and 2024 was checked and carries **no**
  label — a backtest limitation (§9.4). **Translation is never an inline `+ 1`**: it is the
  declared per-season contract in §6.4, and only that.
- Observed `status` values: `CONCLUDED` only (feed captured after the season's last H&A round),
  plus `POSTGAME` reported by the operator's monitor. Pre-match values (`SCHEDULED`, `LIVE`, …)
  are **unobserved** and must be measured, never assumed (§15 Q4).
- Team identities (18): `CD_T10` Adelaide Crows, `CD_T20` Brisbane Lions, `CD_T30` Carlton,
  `CD_T40` Collingwood, `CD_T50` Essendon, `CD_T60` Fremantle, `CD_T70` Geelong Cats, `CD_T80`
  Hawthorn, `CD_T90` Melbourne, `CD_T100` North Melbourne, `CD_T110` Port Adelaide, `CD_T120`
  Richmond, `CD_T130` St Kilda, `CD_T140` Western Bulldogs, `CD_T150` West Coast Eagles,
  `CD_T160` Sydney Swans, `CD_T1000` Gold Coast SUNS, `CD_T1010` GWS GIANTS. Six names differ
  from `clubs.legacy_club_hist` — names are never the key.
- Venues carry `CD_V` ids with AFL commercial names (`Marvel Stadium`, `People First Stadium`,
  `ENGIE Stadium`, `Optus Stadium`, `Barossa Park`, …); AFLDB `venues.legacy_name` uses AFL
  Tables spellings (`M.C.G.`, `S.C.G.` …) — a tracked map is required.

### 2.2 Player stats (`api.afl.com.au/cfs/afl/playerStats/match/<CD_M>`)
- `homeTeamPlayerStats[]` / `awayTeamPlayerStats[]`, 23 rows each, 46 per match (verified for
  all 14 samples: every file carries exactly one `homeTeamPlayerStats` key and the CSV summaries
  show 46 rows). Row: `player{player{position, player{playerId CD_I…, playerName{givenName,
  surname}, captain, playerJumperNumber}, jumperNumber, photoURL}}`, `teamId`,
  `playerStats{stats{…}, extendedStats{…}, lastUpdated}`, `gamesPlayed` (**null in every
  sampled row, 2022–2026**), `timeOnGroundPercentage`.
- `stats` keys: goals, behinds, superGoals, kicks, handballs, disposals, marks, bounces,
  tackles, contestedPossessions, uncontestedPossessions, totalPossessions, inside50s,
  marksInside50, contestedMarks, hitouts, onePercenters, disposalEfficiency, clangers, freesFor,
  freesAgainst, dreamTeamPoints, clearances{centreClearances, stoppageClearances,
  totalClearances}, rebound50s, goalAssists, goalAccuracy, ratingPoints, ranking, lastUpdated,
  turnovers, intercepts, tacklesInside50, shotsAtGoal, goalEfficiency, shotEfficiency,
  interchangeCounts, scoreInvolvements, metresGained. `extendedStats`: effectiveKicks,
  kickEfficiency, kickToHandballRatio, effectiveDisposals, marksOnLead, interceptMarks,
  contestedPossessionRate, hitoutsToAdvantage, hitoutWinPercentage, hitoutToAdvantageRate,
  groundBallGets, f50GroundBallGets, scoreLaunches, pressureActs, defHalfPressureActs, spoils,
  ruckContests, contestDefOneOnOnes, contestDefLosses, contestDefLossPercentage,
  contestOffOneOnOnes, contestOffWins, contestOffWinsPercentage, centreBounceAttendances,
  kickins, kickinsPlayon.
- **Schema stability:** the first 130 keys of the 2022 R8 sample and the 2026 PF sample are
  identical in name and order. All counts are floats (`9.0`); integrality must be enforced.
- `position` in stats rows includes `INT`; `EMERG` appears only in the roster.

### 2.3 Match roster (`api.afl.com.au/cfs/afl/matchRoster/full/<CD_M>`)
- `match{status, matchId, venue CD_V, utcStartTime, homeTeamId, awayTeamId, homeTeam/awayTeam{name, teamId, abbr, nickname, badge/flag asset URLs}, round, venueLocalStartTime ("2026-09-19T17:15:00"), venue{…, timeZone, capacity, …}}`
- `matchRoster{status, lastUpdated, matchId, competitionId CD_S…, roundNumber, weather{description, tempInCelsius, weatherType}, umpires[{umpireName, umpireId CD_U…, umpireType FIELD/…, umpireNumber}], homeTeam/awayTeam{teamName, ins[], outs[], milestones[{player, milestoneEvent "150th game"}], clubDebuts[], positions[{position, player}], lateChanges}, recentMatches[], teamPlayers[]}`
- Score block: `homeTeamScore/awayTeamScore{matchScore{totalScore, goals, behinds}, periodScore[{periodNumber, score{totalScore, goals, behinds}}], rushedBehinds, minutesInFront}`, `matchClock{periods[]}`, `scoreWorm{scoringEvents[]}`.
- **Period scores are per-period increments, not cumulative** (HAW 31/36/10/45 = 122). AFLDB
  `match_period_scores` is cumulative-to-date → convert and prove `Σ == final`.
- **Rushed behinds** are explicit: team behinds = Σ player behinds + `rushedBehinds`.
- No attendance/crowd field in any of the three feeds (confirmed by key search).

### 2.4 Post-conclusion churn (monitor snapshot 21:41 vs capture 10:29, `CD_M20260142801`)
The monitor recorded all three endpoint hashes as changed. Against the first nine stat rows
compared, **every statistic value and every `playerStats.lastUpdated`
(`2026-09-19T10:22:58.857+0000`) is byte-identical** in both captures, and the roster
`lastUpdated` (`10:14:39.970+0000`) is identical too. The monitor hashes raw bytes; the
sample-folder copies were re-serialised by the capture script (pretty-printed), so a
formatting difference is the likeliest cause. **Conclusion (T2):** the monitor's byte hashes
prove nothing about source state. AFLDB hashes the parsed, canonicalised payload (§4.5). This
capture pair is **not** evidence for any exclusion; it is the first fixture pair of the §9.9
evidence process, and the expected outcome there is `unchanged` with **no** exclusion at all.

### 2.5 Brownlow feeds
- `bfawards/season/<CD_S>`: `{seasonId, status, matchVotes[{matchId CD_M…, roundNumber, votes[{player{photoURL, givenName, surname, playerId CD_I…, jumper}, team{teamId, teamAbbr, teamName, teamNickname}, votes, eligible}]}], players[], teams[]}`. `roundNumber` uses **AFL API numbering** (2025 shows `0` for Opening Round and `24` for the last H&A round).
- `bfawards/leaderboard/season/<CD_S>`: `{seasonId, status, teamFilter, leaderboard[{player, team, eligible, winner, leader, roundByRoundVotes[{matchId, roundNumber, votes}], roundByRoundTotalVotes[{roundNumber, votes}], totalVotes}]}`.
- 2022–2025 validation JSONs: 0 bad vote sets, 0 duplicate matches, 0 duplicate players, 0
  unresolved match ids, 0 leaderboard mismatches; 198/207/207/207 match-vote records;
  `eligible:false` occurs (ineligible players still receive votes — carried, not dropped).
- The 2026 feed exists with `status: null`, empty arrays, `Cache-Control: max-age=3`, ETag
  present, `If-None-Match` not honoured.

---

## 3. Current architecture summary (one paragraph)

Every 2026+ source is observed into an immutable, content-addressed spine with ordered version
history and absence-as-state; a family may only be promoted through a typed projection that
carries the exact observation version; `reconcile()` names a verb; a candidate is queued; and
the one canonical writer (`applyCanonicalUnit`) re-derives ownership, manual authority,
baseline hash, season, completion and identity inside a savepoint, writing an append-only
`canonical_applications` row with the canonical row or neither. AFL Tables is the only source
that owns 2026 canonical rows today; Squiggle/Kali are retired witnesses; `afl_api` exists as
a source with two staging-only families. The AFL.com.au work therefore has a complete
substrate and needs (a) new families, (b) an adapter, (c) a typed projection migration,
(d) a source-parametrised settle, (e) a player bridge and (f) a co-source ownership policy.

---

## 4. Gap analysis — samples vs canonical requirements

### 4.1 Provided and mappable (authoritative candidates)
match/provider id, season (`compSeason.providerId`), round (with declared mapping), home/away
team (with tracked `CD_T` map), venue (`CD_V` map, else `venue_raw`), local date and time
(`venueLocalStartTime`), final score (goals/behinds/total), period scores (after cumulative
conversion), rushed behinds (validation only), player participation (stats rows), jumper
number, 21 of AFLDB's 21 statistics except `brownlow_votes` and `career_game_no` (below),
Brownlow 3-2-1 per match, season leaderboard totals, eligibility.

### 4.2 Provided but AFLDB does not store (retain in raw payload; **not projected**)
`timeOnGroundPercentage`, `metresGained`, `scoreInvolvements`, `turnovers`, `intercepts`,
`tacklesInside50`, `shotsAtGoal`, efficiency percentages, `dreamTeamPoints`, `ratingPoints`,
every `extendedStats` field, `superGoals`, umpires, weather, milestones, club debuts,
`ins/outs/lateChanges`, `minutesInFront`, `matchClock`, `scoreWorm`, `recentMatches`,
`matchChains` (play-by-play). ISSUE-096 explicitly excludes creating a Champion Data licensing
issue and a `player_match_period_stats` issue; this plan does not propose storing any of these.
A successor issue may add a narrow extended-stats table if a product requirement appears.

### 4.3 Required by AFLDB, not provided by AFL.com.au
| Field | Handling |
|---|---|
| `matches.attendance` | **Optional enrichment.** Propose `NULL` + non-complete `attendance_status` + `attendance_source_id NULL`. Enrichable later by AFL Tables settle (field-group exception, §7.5) or Super Admin (`data_overrides` group `attendance`). Never blocks promotion. |
| `player_match_stats.career_game_no` | `gamesPlayed` is null in every sample. Propose `NULL`; it is derivable and AFL Tables may enrich under the same field-group rule if approved (default: leave NULL, recompute-owned candidate). |
| `player_match_stats.brownlow_votes` | Not in the stats feed; comes from the Brownlow family after the count. Propose `NULL` (NA), exactly as the AFL Tables path does in season. |
| `matches.match_time` vocabulary | AFL Tables supplies free text (`Local.start.time`); AFL supplies ISO local time. Render `HH:MM` (the `fixtures` writer convention) — **operator to confirm** against an `afldb_test` sample so the two sources do not diff forever (§15 Q5). |
| Player identity | No `external_identities` rows for `afl_api`. **Stage S5 bridge** (§6). |
| `QF` vs `EF` for seasons without `finals_match_label` | Fail closed (`round_unresolvable`) — affects historical backtest only. |

### 4.4 Type and nullability differences
- All AFL counts are JSON floats; project as integers only when `Number.isInteger(x)`; a
  non-integral count refuses the record (`non_integral_statistic`).
- `superGoals` is null/0 noise; excluded from the projection, kept in the payload.
- `jumperNumber` integer → `text` (AFLDB convention, 077 rationale).
- `gamesPlayed` null → `career_game_no NULL` (not 0).
- Zero-as-missing: none observed in the stat feed (a 0 is a real 0). `zero_is_missing_columns`
  stays empty for every new family.

**S3 status (2026-09-19):** the non-integral refusal is a binding S3 requirement (§18 test plan
item 1 lists "integrality" under the DB-free parser/adapter tests) — it lives in the emitter's
`numOrNull()` (`afl-api-bundle.ts`), shared by `emitAflApiPlayerMatchStats()`'s stat counts and
`emitAflApiMatchRoster()`'s `playerJumperNumber`, not deferred to the S4 migration. Implemented:
`numOrNull()` now throws `non_integral_statistic` when `!Number.isInteger(value)`; a measured `9.0`
still parses to the integer `9` and passes. Covered by
`tests/afl-api-match.test.ts` (`emitAflApiPlayerMatchStats` and `emitAflApiMatchRoster` describe
blocks): one accept case (integral float) and one refusal case per call site.

### 4.5 Semantic hashing contract (T2)
```
raw bytes (immutable file in the snapshot, SHA-256 in the manifest)
  → JSON.parse (formatting, whitespace and `9.0` vs `9` vanish here: both parse to number 9)
  → declared-column selection (the family's known_columns; an undeclared key REFUSES the
    record at the S1 gate — it is never silently dropped from the hash)
  → canonicalJson() (sorted keys, stable number/boolean/null rendering, observations.ts:128)
  → sha256 = payload_hash, with hash_recipe = algorithm + the family's exclusion list
```
Rules:
1. `raw_payload` in `staging.source_payloads` is the parsed, declared-column object; the raw
   bytes stay in the snapshot file and are bound by the manifest. Nothing is hashed on bytes.
2. **`hash_exclusions` starts EMPTY for every ISSUE-228 family.** The lists sketched in the
   first draft of §5.2 are withdrawn; they were hypotheses.
3. A field may enter a family's `hash_exclusions` only when **all** of the following hold:
   (a) at least three independent observation pairs (distinct matches, or distinct polls of one
   match at least an hour apart) show the field changing while every other declared field is
   identical; (b) each pair is recorded in the registry entry's `evidence[]` with snapshot
   labels and the field path; (c) a fixture pair is added under `tests/fixtures/afl_api/hash/`
   and a regression test asserts `unchanged` with the exclusion and a new version without it;
   (d) the registry validator refuses an exclusion whose evidence entry is missing.
4. Migration 074's `hash_recipe` makes a later exclusion a reference-data edit with no backfill
   and no spurious version, so nothing is lost by starting empty.
5. `source_updated_at_field` may name a genuine upstream mutation timestamp
   (`matchRoster.lastUpdated`, `playerStats.lastUpdated`) **and that field stays inside the
   hash** unless rule 3 admits it — exactly the Squiggle `updated` precedent.

---

## 5. Proposed source contract

### 5.1 Source row
Keep `sources.key = 'afl_api'` (077). Amend the prose `description` by a data-only statement
in the new migration (077 refuses only on `kind`/`url`, which are unchanged): "Official
AFL.com.au JSON APIs (aflapi.afl.com.au v2, api.afl.com.au CFS with a public `WMCTok` media
token, sapi.afl.com.au). Reached directly for ISSUE-228 families and through fitzRoy for the
ISSUE-100/118 families. No operator credential." Independence group `afl_api` unchanged.

### 5.2 New families in `data/reference/source-families.json` (all `source_key: afl_api`)
| family | endpoint | external_key → `external_record_id` | scope_key | hash_exclusions | `source_updated_at_field` | promotion_policy |
|---|---|---|---|---|---|---|
| `match` | season matches feed, one record per `matches[]` element | `providerId` → `CD_M…` | `season=<year>` (feed enumerates the whole season → absence sweepable **for the match family only**) | **`[]`** (T2; §4.5 rule 3 governs any later addition) | none (feed publishes no mutation timestamp) | `reviewed` (auto-apply by CLI switch, as `afltables.match`) |
| `match_roster` | `matchRoster/full/<CD_M>` | `match.matchId` → `CD_M…` | `season=<year>;match=<CD_M>` (one record per fetch; **not sweepable**) | **`[]`** | `matchRoster.lastUpdated` (inside the hash) | `reviewed` (targets `match_period_scores` only; match-level facts come from `match`) |
| `player_match_stats` | `playerStats/match/<CD_M>` | `matchId|teamId|player.playerId` → `CD_M…|CD_T…|CD_I…` (the 077 lineup encoding) | `season=<year>;match=<CD_M>` (complete per match: 46 rows, sweepable within the match) | **`[]`** (`extendedStats.*` and `photoURL` are declared known columns, inside the hash, retained in the payload, never projected) | `playerStats.lastUpdated` (inside the hash) | `reviewed` |
| `brownlow_match_votes` | `bfawards/season/<CD_S>` split per `matchVotes[]` | `matchId` → `CD_M…` | `season=<year>` (sweepable only when `status = CONCLUDED`) | **`[]`** | none | `reviewed` (target `brownlow_round_votes`) |
| `brownlow_leaderboard` | `bfawards/leaderboard/season/<CD_S>` per `leaderboard[]` | `player.playerId` → `CD_I…` | `season=<year>` | **`[]`** | none | `never` in ISSUE-228 (artefact input for the ISSUE-113 loader at rollover; witness for round-vote totals) |

Expected consequence of empty exclusions, stated so it is not mistaken for a defect: every
poll that changes `photoURL` query strings, ticket links or `lastUpdated` without a fact change
will append a spine version and reconcile as `history_only` (no projected field moved, no
candidate). That is the designed behaviour of ISSUE-096 and is exactly the evidence stream §4.5
rule 3 needs. If it proves noisy, the fix is an evidenced exclusion, not a shortcut.

`match_plays` is **not declared** (optional, out of scope). `known_columns_status` is
`complete` only after the backtest enumerates every key across 2022–2026 samples; until then
the registry validator will refuse an undeclared key, which is the intended fail-closed shape.

Round vocabulary: replace the `anchors_only` `afl_api_2026` entry with the per-season
**explicit round table** defined in §6.4 (`mapping_status: declared`, evidence = the season
feed's round list). No offset arithmetic appears in the registry or in any adapter.

### 5.3 New tracked reference data
- `data/reference/afl-api-identities.json`: `teams: { "CD_T10": { hist: "Adelaide", first_season, last_season|null } … }` (18 rows, filled from the feeds and verified against `clubs.json`), `venues: { "CD_V40": { legacy_name: "M.C.G." } … }` (unmapped venue → `venue_id NULL`, `venue_raw` = AFL name; no venue row is ever created), `seasons: { "2026": { compSeasonId: 85, providerId: "CD_S2026014" } … }`.
- `data/reference/afl-api-player-bridge-<date>.json` (S5 output, reviewed, hash-bound).

### 5.4 Snapshot layout and manifest
`data/sources/afl_api/matches/<label>/` with `00-season-matches.json`, per match
`<CD_M>/fixture.json`, `<CD_M>/player-stats.json`, `<CD_M>/match-roster.json`, `token.meta.json`
(token issue time only, never the token), and `manifest.json` written **last**; manifest copied
to `docs/rebuild-manifests/afl_api/<label>.json` (tracked). Label grammar
`afl-api-<season>-<YYYY-MM-DD-HHMM>`. Brownlow: `data/sources/afl_api/brownlow/<label>/`.
The existing `AFLWebsite` sample folders are **not** the contract; they are backtest inputs (§9).

---

## 6. Player, match and provider-ID resolution rules

### 6.1 Match
1. **Provider id first.** Look up `matches WHERE source_id = afl_api AND source_record_id = <CD_M>`.
   A hit is the canonical row regardless of its current `match_key` (this makes an upstream
   date/round/venue correction an exact rekey, no ISSUE-131 search needed).
2. **Then `match_key`.** Render `season|round_code|match_date|home hist|away hist` exactly as
   `import_fitzroy_core.py::match_key_of()` does (ClubResolver names). A hit is an
   AFL-Tables-owned or manually created row for the same real-world match → ownership rules (§7).
3. **Then the ISSUE-131 retired-identity search** (`findRetiredMatchIdentities`) — only for
   `afl_api`-owned rows; never merges two populated graphs.
4. Otherwise `new_target`.
Contradiction: provider-id hit whose (season, home, away) differ from the payload → `HALT`
for the run (`provider_identity_contradiction`, §14). Two canonical rows matching (1) and (2)
with different ids → `rekey_would_merge` refusal (existing).

### 6.2 Team and venue
`CD_T` → `clubs.legacy_club_hist` through `afl-api-identities.json` only; validate
`abbreviation`/`name` against the map's recorded raw strings and refuse on drift
(`team_identity_drift`), never resolve by name. `CD_V` → `venues.legacy_name`; unmapped is a
warning + `venue_id NULL`.

### 6.3 Player — the `afl_api` provider bridge (Stage S5) — **bootstrap only (T1)**
- **Normal ingestion resolves players from one place only:** `external_identities WHERE
  source_id = afl_api AND external_id = <CD_I> AND status IN ('unique','resolved') AND
  player_id IS NOT NULL`, loaded into `refs.playerIdsByProviderId` exactly as
  `playerIdsByUrl` is today. The settle never reads AFL Tables snapshots, `afltables`
  projections or `afltables`-owned `player_match_stats` to resolve a player. Acceptance test
  §19.4(c) runs a settle with no AFL Tables snapshot on disk and no `afltables` rows for the
  match and requires 100% resolution of previously bridged players.
- **The bridge is a bootstrap/backfill tool, not an ingestion step.** It is run on demand by the
  operator (`bridge:afl-api --build/--validate-only/--dry-run/--apply`), reads AFL Tables-owned
  canonical rows as *evidence*, and writes **durable** `external_identities` rows:
  `source_id = afl_api`, `external_id = CD_I…`, `external_name` (as the AFL spells it),
  `status = 'unique'`, `match_method = 'afl_api_stat_vector_bootstrap'`, `notes` = the evidence
  summary (matches, agreeing statistics). Once written, a link is trusted by ingestion forever
  and is independent of AFL Tables' continued availability.
- **Append-only and non-guessing:** a re-run never modifies or deletes an existing link; a
  re-run that finds a contradiction for an existing link withholds the new evidence, opens a
  `data_issues` row (`afl_api_identity_contradiction`, keyed by `CD_I`) and leaves the link for a
  human. `status = 'resolved'` is reserved for a human decision; the bootstrap writes only
  `unique`.
- **Unresolved is unresolved.** A `CD_I` the bridge cannot prove stays absent from
  `external_identities`; ingestion records `unresolved_identity` for that player unit (existing
  refusal verb, `import_rejections` row, refusal candidate) and applies the match unit anyway.
  A debutant with no `players` row (ISSUE-224) is exactly this case and is resolved only through
  ISSUE-224 or the identity workflow that issue produces — never by this bridge and never by the
  settle.
- **Bridge construction (offline builder + fail-closed loader, DraftGuru-bridge pattern):**
  for every AFL.com.au CONCLUDED match that resolves (§6.1 step 2) to an `afltables`-owned
  canonical match with `player_match_stats` rows, join each AFL stat row to the canonical rows
  of the same `match_id` and resolved `club_id` on `jumper_number` **and exact equality of the
  core stat vector** (kicks, handballs, marks, tackles, goals, behinds, hitouts, frees_for,
  frees_against, inside_50s, clearances, rebounds, goal_assists — every column both sides carry
  non-NULL). Accept `CD_I → player_id` only when: (a) every observed match of that `CD_I` maps
  to the same `player_id`; (b) that `player_id` maps to no other `CD_I`; (c) ≥ 2 matched
  matches, or 1 match with ≥ 10 non-NULL agreeing statistics; (d) normalised surname equality
  holds — **as validation**: a failure withholds the pair (`surname_disagrees`), it never
  resolves anything. Roster snapshots (`rosters-20260905`, 2012–2026) are a second witness
  (`CD_I` + club-season listing must be consistent) but not an identity source.
- **Fallback checks:** none automatic. A `CD_I` with zero core-stat matches (debutant, or a
  player whose AFL Tables row has not settled) is `unresolved_identity` → `import_rejections`
  row + refusal candidate for a human, and the *match* family still settles.
- **Contradiction:** a `CD_I` whose stat vector matches two different players across matches,
  or two `CD_I` matching one player → both withheld, listed in the bridge report; never picked.
- **Unresolved handling:** the ISSUE-224 gap (2026 debutants with no `players` row at all, e.g.
  Jagga Smith, Willem Duursma) is **not** closed here; the bridge can only link existing
  players. Registering a debutant remains a human decision (existing `admin/player-links`
  surface; an `afl_api` adjudication path there is a successor item).
- **No unsafe auto-linking:** names, jumper alone, or club+season alone never create a link;
  `status` is always `unique` (deterministic) or nothing; `resolved` is reserved for a human.

### 6.4 Round translation — the one contract (T4)
- **Location:** `src/lib/acquisition/afl-api-rounds.ts`, `translateAflRound(vocabulary,
  observed)` — the **only** code path that turns an AFL round into AFLDB `(round_code,
  round_number, round_type, is_final)`. The emitter, the Brownlow emitter and the fixture
  successor all call it; a code search for `roundNumber + 1` outside this module fails the
  contract test (§19.7(f)).
- **Vocabulary shape** (`data/reference/source-families.json` →
  `round_vocabularies.afl_api_<year>`), fully explicit, one row per AFL round:
  ```
  { "mapping_status": "declared", "season": 2026,
    "evidence": ["00-season-matches.raw.json compSeasonId 85, 2026-09-19"],
    "rounds": [
      { "api_round_number": 0,  "api_abbreviation": "OR", "api_name": "Opening Round",
        "round_type": "home_and_away", "canonical_round_number": 1 },
      { "api_round_number": 1,  "api_abbreviation": "1",  "api_name": "Round 1",
        "round_type": "home_and_away", "canonical_round_number": 2 },
      … one row each through api_round_number 24 → canonical 25 …,
      { "api_round_number": 25, "api_abbreviation": "WF", "api_name": "Wildcard Finals",
        "round_type": "wildcard_final" },
      { "api_round_number": 26, "api_abbreviation": "QE",
        "api_name": "Qualifying & Elimination Finals", "round_type": "mixed_finals",
        "finals_label_rules": [ { "contains": "Qualifying",  "round_type": "qualifying_final" },
                                { "contains": "Elimination", "round_type": "elimination_final" } ] },
      { "api_round_number": 27, "api_abbreviation": "SF", "round_type": "semi_final" },
      { "api_round_number": 28, "api_abbreviation": "PF", "round_type": "preliminary_final" },
      { "api_round_number": 29, "api_abbreviation": "GF", "round_type": "grand_final" } ] }
  ```
  `round_code` is derived by the module from `round_type` exactly as `createMatch()` and
  `admin-fixtures.ts renderRound()` do (decimal string for home-and-away; `WF/EF/QF/SF/PF/GF`),
  so the three writers cannot disagree. The registry validator refuses a vocabulary whose
  canonical H&A numbers are not a contiguous 1..N, whose `mixed_finals` row lacks label rules,
  or whose `api_round_number`s are not unique.
- **Representable cases:** Opening Round (a row with `canonical_round_number: 1`), ordinary
  H&A rounds, a season with no Opening Round (2022/2023: `api_round_number 1 → canonical 1`),
  the Wildcard round, single-type finals rounds, and the mixed QE round via
  `finals_label_rules` over `metadata.finals_match_label`.
- **Refusals (typed, tested):**
  | Condition | Outcome |
  |---|---|
  | no `afl_api_<year>` vocabulary for the bundle's season | **run-level HALT** before any DB connection (`round_vocabulary_missing`) |
  | `api_round_number` not in the table | **record rejection** `round_unmapped` (presence kept; enumeration `complete` stays as measured; the record counts toward `rejected_records`, so `--require-complete-source` turns the run red — the ISSUE-128 Wildcard precedent, deliberately) |
  | observed `api_abbreviation`/`api_name` differ from the declared row | record rejection `round_vocabulary_drift` (a renamed round is a contract change, not a guess) |
  | `mixed_finals` row and `finals_match_label` absent or matching no rule | record rejection `finals_label_required` (this is the 2022–2024 historical case; the backtest asserts it) |
  | label matches a rule but the fixture's `round.abbreviation` is not the mixed row | record rejection `round_inconsistent` |
  | Brownlow `roundNumber` maps to a non-H&A round | record rejection `brownlow_round_not_home_and_away` |
- **Cross-check gate (§8 gate 2):** when the match resolves to an existing canonical row, the
  translated `(round_code, round_type)` must equal the canonical row's; a mismatch is a
  `corrected` candidate on a historically significant field (§13.5), never an auto-apply.

---

## 7. Lifecycle: acquire → observe → validate → promote

### 7.1 Acquire (network, files only)
1. `POST api.afl.com.au/cfs/afl/WMCTok` → token (memory only; never written).
2. `GET` season matches feed (full season, `pageSize=1000`); select matches by `--status`
   (default `CONCLUDED`), `--since`, `--match <CD_M>…`.
3. Per selected match: `GET playerStats`, `GET matchRoster`. Retry 3× exponential backoff;
   401/403 → re-issue token once; any remaining failure → no manifest, partial dir removed
   (the `cleanup_partial` pattern in `afldb-settle-afltables.sh`).
4. Write raw bytes verbatim, then the manifest last with SHA-256 per file and per-endpoint HTTP
   status, ETag, `Cache-Control`, retrieval time.
Nothing here adjudicates.

### 7.2 Observe (offline emitter + DB persistence)
- Emitter (`src/lib/acquisition/afl-api-bundle.ts`, pure): parse → validate shape against the
  registry → render `external_record_id`, `scope_key`, payload (observed columns) →
  **projection or rejection** per record → bundle v1 (`acquisition_kind: 'afl_api_match_snapshot'`,
  `season`, `source_key: 'afl_api'`).
- Persistence reuses `persistSourceObservation()` unchanged: identical canonical payload →
  `head_refreshed`, changed → new `version_seq`; **every status is observed** (SCHEDULED, LIVE,
  POSTGAME, CONCLUDED), so the spine holds the full transition history.

### 7.3 POSTGAME vs CONCLUDED (Decision, amended per T3)

**What the existing state model can and cannot say.** A bundle record today has exactly three
shapes: projected (`projection` set, `rejection` null), rejected (`rejection` set) or
unprojected-without-rejection (`projection` null, `rejection` null). Reading
`settleFamily()` (`settle-afltables.ts:2031-2150`) and `assessSourceCompleteness()`
(`source-completeness.ts:96-160`):
- a **rejected** record is observed (spine), writes no projection, and for every target the
  source "establishes" (`matches`, `player_match_stats`) it is reconciled with
  `identity: unresolved` → an `unresolved_identity` refusal candidate plus an
  `import_rejections` row, and it counts toward `snapshotRejections` → completeness verdict
  `incomplete` → a red unit under `--require-complete-source`;
- an **unprojected, unrejected** record fares no better: `resolveTarget` is skipped, but the
  targets are still reconciled as `unresolved('the record produced no typed projection')` with
  the same candidate and rejection row.
So **the current model cannot express "observed, valid, not yet promotable"**: both available
shapes would report every POSTGAME match as a failed ingestion that later "succeeded". That is
precisely the operational reporting T3 forbids. The limitation is documented here and **a
minimal distinction is warranted and included in Stage S6**:

- **Bundle contract v2** (afl_api spec only; the AFL Tables emitter keeps v1 and its validator
  keeps pinning v1): a record gains an optional `deferral: { reason, detail } | null`, mutually
  exclusive with `rejection`. A deferred record has `projection: null`.
- **Settle core semantics for a deferred record:** observed into the spine exactly like any
  other record (I1/I2 apply: an unchanged POSTGAME re-poll is a head touch, the POSTGAME →
  CONCLUDED payload change is a new version); **no projection, no target pass, no reconcile,
  no candidate, no `import_rejections` row**. `targetEstablishedBySource()` answers false for
  every target of a deferred record — the source has not yet published a completed match, so
  no completed-match fact exists to propose, which is the same reasoning the function already
  applies to an unpublished Brownlow vote.
- **Counters and reporting:** new `recordsDeferred` (by reason) in `SettleCounters`; deferred
  records are **excluded** from `snapshotRejections` and from every `SourceCompletenessReason`;
  the completeness headline gains an informational line ("N match(es) observed but not yet
  concluded; nothing proposed") that does not change the verdict. A run whose only non-applied
  records are deferred reports `complete` and exits 0. The `--report` view lists deferred
  records under their own heading, never under exceptions.
- **Enumeration and absence:** a deferred record is present in its enumeration; a `complete`
  season enumeration may still sweep. A match that leaves the feed entirely is `absent` (review
  signal), unchanged.

| State | Observation | Projection | Candidate | Auto-apply | Reported as |
|---|---|---|---|---|---|
| fixture `status ∉ {CONCLUDED}` (`POSTGAME`, `LIVE`, pre-match) | yes | **no** — record **deferred** `{reason: 'status_not_concluded', detail: '<status>'}` | no | no | deferred (informational) |
| fixture `CONCLUDED`, roster absent or `status ≠ CONCLUDED` | yes | match family: yes; roster/stat families: **deferred** `roster_not_concluded` | match only | match only (all-or-none per family still holds) | applied + deferred |
| both `CONCLUDED`, gates pass | yes | yes | yes | yes | applied |
| both `CONCLUDED`, a gate fails (arithmetic, mapping, identity) | yes | rejection / refusal as today | refusal candidate | no | exception (correct: this IS a failure) |
| later re-observation, payload unchanged | head touch | unchanged | none (`unchanged`) | none | no-op |
| later re-observation, values changed | new version | replaced in place (O1: never deleted) | `corrected` | yes if `afl_api` owns the row and no override; else candidate/refusal | correction |

Rationale: the operator's monitor shows POSTGAME → CONCLUDED with identical scores, but
POSTGAME is by definition pre-verification; AFLDB gains nothing by promoting minutes earlier
and risks writing a number Champion Data then corrects. Idempotency and replay are the spine's
I1/I2 properties; the settle run over an identical snapshot is a total no-op (proven for the
AFL Tables path by `settle-afltables.test.ts:2766`). Deferral is a record state inside a
successful run, not a verdict on the run.

### 7.4 Validate (§8) then promote through `applyCanonicalUnit()` with `sourceKey = 'afl_api'`.

### 7.5 Ownership between `afltables` and `afl_api` — **DECIDED (Q1, Q2)**
`autoApplyOwnership()` refuses any row owned by another source; that gate is not weakened.
- **Co-sources (Q1).** `afltables` and `afl_api` are declared co-sources for the four canonical
  targets in the registry (`co_source_groups: [["afltables", "afl_api"]]`). A co-source-owned
  row is *corroborated*: `classifyCorroboration()` records agreement/disagreement, a
  disagreement opens the deduplicated `source_disagreement` `data_issues` row (advisory), and
  the encounter is counted as `corroboratedForeignOwned`, **not** as a refusal or exception.
  The row keeps its first owner. Existing 2026 rows stay `afltables`-owned; a match first
  promoted by `afl_api` is `afl_api`-owned. **Nothing re-owns a row because another source now
  corroborates it**; an ownership transfer, if ever wanted, is an explicit operator-run script
  with its own `canonical_applications` rows, never a side effect of a settle.
- **Attendance enrichment (Q2)** — the one field-group exception, declared in code as
  `CO_SOURCE_ENRICHMENT = { matches: { attendance: ['attendance', 'attendance_status',
  'attendance_source_id'] } }` and nothing else.

  **Terminology, so this cannot be misimplemented.** Wherever this section says "status" it
  means **`matches.attendance_status`**, the per-field `coverage_status` enum from migration
  020 (`complete | partial | not_collected | not_applicable | pending`), whose CHECK
  `matches_attendance_status_ck` ties it to the `attendance` column (`complete` ⇔ non-NULL).
  It **never** means the AFL `CONCLUDED` state, `is_final`, "match played", or any notion of
  canonical match completion. A completed, CONCLUDED, fully settled `afl_api`-owned match
  **remains eligible** for attendance-only enrichment for as long as its attendance is
  unsourced. Completion protects the already-sourced match, result, period and statistic
  fields (they move only through `corrected` candidates under the ordinary ownership and
  authority gates); it does not freeze an unsourced optional enrichment field.

  **The gate, evaluated inside the applier's savepoint against re-read state, all conditions
  required:**
  1. **the canonical `matches` row already exists** (identity `resolved`, never `new_target`
     — enrichment never inserts a match);
  2. **the enriching source is a declared co-source for the `attendance` field group** on a row
     owned by another co-source (registry `co_source_groups`; today that means `afltables`
     enriching an `afl_api`-owned row; the reverse can never fire because an `afl_api`
     proposal carries no attendance);
  3. **`matches.attendance_source_id IS NULL`** — the field is unsourced. Because of the 020
     CHECK this implies `attendance IS NULL` and `attendance_status <> 'complete'`; a value that
     already cites a source (including `manual_admin_edit`, the existing
     `settle-afltables.test.ts:1923` refusal) is never touched automatically, whatever its
     value;
  4. **no active manual/admin override**: no active `data_overrides` row for
     `(matches, <match_key>, 'attendance')` (E4, re-read inside the savepoint);
  5. **the incoming attendance is valid**: an integer ≥ 0 from the enriching source's own
     typed projection (`staging.afltables_match.attendance`), with its `attendance_status =
     'complete'` and, for a 0 crowd, a non-NULL `attendance_source_id` (the 020 zero-crowd rule);
  6. **only the attendance field group is written**: `attendance`, `attendance_status`,
     `attendance_source_id` and nothing else; `matches.source_id` (row ownership) is not
     changed; no other target of the unit is offered;
  7. **the write goes through `applyCanonicalUnit()`** and produces a `canonical_applications`
     row (`target_table = 'matches'`, `verb = 'update'`, `new_values` = exactly the three
     fields, `previous_values` = their prior NULL/non-complete/NULL state, bound to the
     enriching source's `source_version_seq`); `attendance_source_id` becomes the enriching
     source.

  Consequences stated plainly: a NULL attendance on an `afl_api`-owned row blocks nothing —
  the match, its period scores and its player rows promote with `attendance_status` at the
  non-complete value 020 assigns (`not_collected`; `pending` if the operator prefers "expected,
  not yet published" for in-season rows — decide at S4 and pin it in the projection CHECK) —
  and the enrichment may land days or weeks later, after the match is long CONCLUDED. A
  correction to an already-sourced attendance from a co-source is a `corrected` candidate for
  review, never an automatic write. A Super Admin `data_overrides` attendance edit wins over
  both.

---

## 8. Validation gates and invariants (promotion checks)

Per match unit (all must pass or the unit is refused with a named reason):
1. **Status**: fixture `CONCLUDED`; roster `CONCLUDED` for period/stat targets.
2. **Season/round agreement**: `compSeason.providerId` ↔ declared season; round mapping
   declared for the season; `round.roundNumber` consistent with `matchRoster.roundNumber`;
   finals label parses; `is_final = (round_type <> 'home_and_away')`.
3. **Team resolution**: both `CD_T` mapped, different, raw name/abbr match the map.
4. **Match resolution** (§6.1); provider-identity contradiction → HALT.
5. **Score arithmetic**: `total = 6*goals + behinds` both sides; `margin = |diff|`; `result`;
   fixture score == roster `matchScore` == cumulative Q4.
6. **Period scores**: 4 periods each side, cumulative conversion, non-negative, `Σ` equals
   final; more than 4 periods → refuse (`extra_time_unsupported`, mirrors AFL Tables path).
7. **Player counts**: 23 rows per team, 46 per match (declared per season; refuse otherwise),
   `Σ` roster `positions` minus `EMERG` == stat-row `playerId` set; no duplicate `CD_I` in a
   match; no `CD_I` on both teams.
8. **Goal/behind reconciliation**: `Σ player goals == team goals`; `Σ player behinds +
   rushedBehinds == team behinds`.
9. **Integrality**: every projected count is an integer ≥ 0.
10. **Provider-ID consistency**: every `teamId` on stat rows ∈ {home, away}; `matchId` on
    roster/stat payloads equals the fixture `providerId`; `competitionId` equals the season.
11. **Identity**: player `CD_I` resolved (else that player unit is `unresolved_identity`; the
    match unit still applies).
12. **Canonical conflict detection** (existing gates): E3 ownership, E4 manual authority
    (`data_overrides`), E5 baseline hash, E2 in-progress season, E6 completion; `match_key`
    collision with a differently-owned row → candidate, never auto-apply.
13. **Duplicate protection**: `pms_player_match_uq`, `matches_match_key` UNIQUE,
    `(source_id, source_record_id)` uniqueness on `matches` enforced by the resolver.

Brownlow (§10) has its own list.

---

## 9. Historical replay / backtest design

Inputs: the 12 historical samples (2022–2025, 3 per season, all `CONCLUDED`) + the 2 2026
preliminary finals + the monitor snapshot; the 2022–2025 Brownlow season/leaderboard feeds.
Bytes stay untracked; a tracked manifest `docs/rebuild-manifests/afl_api/backtest-20260919.json`
hash-binds them, and the backtest **skips with an explicit "fixture absent" outcome** (never a
silent pass) when a file is missing. Small hand-trimmed tracked fixtures (one match, one
Brownlow round) live under `tests/fixtures/afl_api/` for the DB-free contract tests.

Backtest assertions (DB-free unless stated):
1. **Schema stability**: the key set and types of every payload are identical across 2022–2026
   for the declared columns; any new key is reported (not fatal) and any missing required key
   is fatal.
2. **Round mapping**: each sample's mapped `(round_code, round_type, round_number)` equals the
   folder's `R<n>` label + 1 where an Opening Round exists (2024–2026) and + 0 otherwise.
3. **Counts and arithmetic**: gates 5–10 pass on all 14 matches.
4. **Cumulative conversion**: derived `match_period_scores` reproduce the final score.
5. **`match_key` resolution on `afldb_test`** (integration, read-only): all 12 historical
   samples resolve to an existing `afltables`-owned match and the canonical scores/period
   scores agree exactly — the proof that the mapping is right.
6. **Stat parity on `afldb_test`** (integration, read-only): for every resolved player (via the
   S5 bridge), the 19 stat columns both sources carry agree; disagreements are listed by column
   (expected: exact for the AFL Tables era of these columns; `bounces`, `one_percenters`,
   `clangers` are the ones to watch).
7. **Bridge coverage**: fraction of the 644 sample `CD_I` values the bridge resolves; the
   unresolved list must be explainable (debutants / unsettled).
8. **Idempotency**: emitting the same snapshot twice yields byte-identical bundles; persisting
   twice on `afldb_test` (dry-run) yields `head_refreshed` only.
9. **Semantic hash evidence (T2)**: the 10:29 and 21:41 captures of `CD_M20260142801` are
   parsed, canonicalised and hashed **with an empty exclusion list**; the expected result is
   `unchanged`. If they differ, the differing paths are printed and recorded as **evidence
   pair 1 of 3** in the registry `evidence[]` for the affected family — not added to
   `hash_exclusions`. The same comparison runs for every pair of polls the monitor captured;
   an exclusion is proposed only when §4.5 rule 3 is met, and lands only with its fixture pair
   and regression test.
10. **Brownlow**: 2022–2025 feeds reproduce the sample validation JSONs (0 defects) and every
    `matchId` resolves to a canonical H&A match on `afldb_test`; reconstructed totals equal
    `totalVotes`.
Known limitation: 2022/2023 (and 2024) finals cannot be split `QF`/`EF` from the feed; the
backtest asserts `round_unresolvable` for them rather than guessing.

---

## 10. Brownlow integration

- **Same infrastructure**: `afl_api.brownlow_match_votes` records per `CD_M` into the 074 spine
  (idempotent under polling: an unchanged match record is a head touch; new matches appear as
  new records during the live count; a correction is a new version), typed projection
  `staging.afl_api_brownlow_vote` (one row per vote: `provider_match_id, provider_player_id,
  provider_team_id, season, api_round_number, canonical_round_number, votes, eligible,
  match_id NULL, player_id NULL, club_id NULL`), target `brownlow_round_votes` (already an
  admitted canonical target with provenance since 083).
- **Logically separate**: its own emitter, validator, CLI (`settle:afl-api-brownlow`), unit
  and status line; it never touches `matches`/`player_match_stats`; the match path never
  writes votes. `player_match_stats.brownlow_votes` is **not** written by this stage (the
  round-vote grain is canonical; the per-game column stays NA in season exactly as today).
- **Season totals**: `brownlow_season_votes` is not an automatic target and its loader refuses
  `in_progress` seasons. ISSUE-228 delivers an **artefact builder** that renders the
  leaderboard feed into the ISSUE-113 artefact row shape keyed by AFL Tables profile path via
  the bridge → `external_identities(afltables)`; loading it is a rollover step (ISSUE-101/F),
  gated on `stat-availability.json` moving 2026 from `pending` to `complete`.
- **Validation (per §H of the brief):** exactly one vote set per `CD_M` (3 rows); votes are
  exactly {3,2,1}; total 6; no duplicate player within a match; `CD_M` resolves to a canonical
  match (provider id first, then `match_key`); `CD_I` resolves through the bridge (else
  `unresolved_identity` for that vote — the other two votes of the match still apply? **No**:
  a match's vote set is one unit, all-or-none, mirroring the match family); finals are excluded
  naturally (no finals records in the feed) **and** defensively (a vote record whose match is
  `is_final` refuses, as `afltables_player_match_brownlow_row_ck` already makes unrepresentable);
  reconstructed per-player totals == leaderboard `totalVotes` when the leaderboard `status` is
  `CONCLUDED` (advisory during the live count, blocking at the end); repeated observation during
  the count is idempotent; `eligible=false` is carried to the season artefact as `is_ineligible`.
- **Round numbering**: `canonical_round_number = api_round_number + offset` from the season's
  declared vocabulary; the backtest checks 2025 `roundNumber 0` votes land on canonical round 1
  (**operator to confirm on `afldb_test`** that 2024/2025 `brownlow_round_votes` follow the
  AFL Tables numbering, §15 Q8).
- **Timing**: the 2026 count is imminent (Grand Final week). ISSUE-228 cannot land before it;
  the operator's standalone monitor should **capture the raw season and leaderboard feeds
  every few minutes during the live count** into immutable timestamped files. Those captures
  become the replay input for the idempotency test (§11.5) — a live-count observation that costs
  nothing now and is otherwise unrepeatable.
- **Operational enablement (DECIDED 2026-09-19, operator, carried forward to S7/S8):** the
  Brownlow ingestion job is **independently enable/disableable** from the match-family settle job
  (its own unit/flag, never bundled behind the match timer) and **defaults to disabled outside the
  live count period** — it is not safe-by-default to poll `bfawards` year-round. It must support an
  **observe-only mode** (fetch, parse, validate, log — no promotion write) distinct from its normal
  apply mode, and a **simulator mode** pointed at `AFLDB_AFL_API_CFS_BASE_URL=http://127.0.0.1:22880`
  (§ "Brownlow simulator compatibility" above). The S7/S8 implementation must be **exercised
  end-to-end against the local simulator in both observe-only and apply mode before it is ever
  pointed at the live AFL endpoint**. S3 does not implement this job; its emitter/validator
  (`afl-api-brownlow.ts` family functions) must simply avoid baking in any live-only or
  always-on assumption, so S7/S8 can add the enable flag, the default-disabled guard and the
  observe-only switch around them without reshaping the emitter contract.

---

## 11. Field mapping matrix

### 11.1 `matches`
| Canonical | AFL source | Class | Notes |
|---|---|---|---|
| `source_record_id` | `providerId` | authoritative | identity |
| `season` | declared from `compSeason.providerId` | authoritative | |
| `round_code`, `round_number`, `round_type`, `is_final` | `round.abbreviation/roundNumber` + `metadata.finals_match_label` via `afl_api_<year>` mapping | authoritative | offset rule §2.1 |
| `match_date`, `match_time` | roster `match.venueLocalStartTime` (cross-checked with fixture `utcStartTime` in `venue.timezone`) | authoritative | `HH:MM` rendering to confirm |
| `venue_id`, `venue_raw` | `venue.providerId` via map; `venue.name` | authoritative / raw | unmapped → NULL id |
| `home_club_id`, `away_club_id`, `winner_club_id` | `CD_T` via map | authoritative | |
| `home/away goals, behinds, score`, `result`, `margin` | fixture `score` (== roster `matchScore`) | authoritative | |
| `attendance`, `attendance_status`, `attendance_source_id` | — | **optional enrichment** | NULL / non-complete |
| `scheduled_at` | `utcStartTime` | optional | column has no reader; **not** written in v1 (avoid inventing a convention, per 097 rationale) |
| `match_event`, `notes` | — | not sourced | |

### 11.2 `match_period_scores` — roster `periodScore[]` per side, cumulative-converted; authoritative.

### 11.3 `player_match_stats`
| Canonical | AFL `stats` key | Class |
|---|---|---|
| `player_id` | `player.playerId` via bridge | identity |
| `club_id` | `teamId` via map | identity |
| `jumper_number` | `jumperNumber` (text) | authoritative |
| `career_game_no` | `gamesPlayed` (null) | not sourced → NULL |
| `kicks` `handballs` `disposals` `marks` `goals` `behinds` `hitouts` `tackles` `bounces` `clangers` `goal_assists` | same names | authoritative |
| `rebounds` | `rebound50s` | authoritative |
| `inside_50s` | `inside50s` | authoritative |
| `clearances` | `clearances.totalClearances` | authoritative |
| `frees_for` / `frees_against` | `freesFor` / `freesAgainst` | authoritative |
| `contested` / `uncontested` | `contestedPossessions` / `uncontestedPossessions` | authoritative |
| `contested_marks` | `contestedMarks` | authoritative |
| `marks_inside_50` | `marksInside50` | authoritative |
| `one_percenters` | `onePercenters` | authoritative |
| `brownlow_votes` | — | not sourced here (NA) |
| `source_record_id` | `CD_M|CD_T|CD_I` | provenance |

### 11.4 `brownlow_round_votes` — `season`, `player_id` (bridge), `round_number` (mapped), `played = true`, `votes`; provenance quartet.

### 11.5 Not stored (see §4.2). Umpires, weather, milestones, debuts: **not currently sourced into canonical**; retained in raw payloads; possible successor families.

---

## 12. Migration / schema changes (genuinely required)

**Migration 103 (one file, additive, no canonical column changes):**
1. `staging.afl_api_match` — column-for-column the `staging.afltables_match` shape (076) plus
   `provider_match_id text NOT NULL`, `provider_season_id text NOT NULL`, `provider_status text
   NOT NULL`, `provider_home_team_id`, `provider_away_team_id`, `provider_venue_id`; family
   CHECK `family = 'match'`; same score/period/attendance CHECKs (attendance will always be NULL
   + non-complete here, and the CHECK proves it).
2. `staging.afl_api_player_match` — the `staging.afltables_player_match` shape plus
   `provider_match_id`, `provider_team_id`, `provider_player_id`, `match_key`, no `afltables_id`,
   no `brownlow_*` columns (votes are a separate family); grain UNIQUE `(source_id,
   provider_player_id, match_key)`.
3. `staging.afl_api_brownlow_vote` (§10).
4. `UPDATE sources SET description = … WHERE key = 'afl_api'` (prose only).
5. Grants exactly as 076/077 (`afldb_import` DML, `afldb_app` SELECT).
Explicitly **not** changed: `matches`, `player_match_stats`, `brownlow_round_votes`,
`canonical_applications` CHECK (the four targets are exactly what ISSUE-228 writes),
`data_overrides` CHECK, `external_identities` (rows are data, `match_method` is free text).
The fixture successor will need the `canonical_applications_target_table_ck` widened to admit
`fixtures` (§13.2, decided now, executed later).

---

## 13. Fixture ingestion — placement and the decisions taken now

### 13.1 Placement
**Successor issue** (`AFLDB-ISSUE-229` recommended), not an ISSUE-228 stage: it needs a
`canonical_applications` CHECK widening, a second writer for `fixtures` beside
`admin-fixtures.ts`, a status-driven target switch, and the SCHEDULED/LIVE status vocabulary
that no sample has yet observed. None of that is needed to reduce the AFL Tables dependency
for completed matches. ISSUE-228 stops at "observe every status; promote CONCLUDED".

### 13.2 Decisions ISSUE-228 makes now so fixtures need no redesign
1. **One family, one identity, status-selected targets.** `afl_api.match` is the season-feed
   match object keyed by `CD_M…`; it is the *same* external record whether the match is
   SCHEDULED, LIVE, POSTGAME or CONCLUDED. The spine records the transition history. The
   emitter's projection carries `provider_status`; the settle proposes **`fixtures`** targets
   while `status ∉ {CONCLUDED}` (successor) and **`matches`** targets when `CONCLUDED`
   (ISSUE-228). `ux_promotion_candidates_pending` is already per `target_table`.
2. **`providerMatchId` threads every table**: `staging.source_records.external_record_id`,
   `staging.afl_api_match.provider_match_id`, `matches.source_record_id` (written by ISSUE-228),
   `fixtures.source_record_id` (successor; `UNIQUE (source_id, source_record_id)` already
   exists), `canonical_applications.external_record_id`. No name, date or `match_key` is ever
   used as the primary key for the same real-world match once a provider id has been seen.
3. **Resolver order is provider id → `match_key` → retired-identity search** (§6.1) for
   every `afl_api` target, and it is written source-parametrised in Stage S6 so the successor
   adds a `fixtures` lookup by `(source_id, source_record_id)` without touching the order.
4. **`fixture_key` is minted once** (`randomUUID()`, the 097 rule) on first creation by the
   importer and thereafter found only through `(source_id = afl_api, source_record_id = CD_M)`;
   it is never derived from any field. The `data_overrides` entity key for an imported fixture
   remains `manual_admin_edit:<token>` only for human edits; an importer-owned fixture carries
   no override row unless a human edits it (ISSUE-162 §7 precedence: a manual row is never
   overwritten by the importer).
5. **Round vocabulary is per-season and declared** (`afl_api_<year>`), so a new season is a
   registry addition, never a code change; the successor's season discovery writes proposals
   into the same file.
6. **Hash exclusions and `source_updated_at` are declared per family**, so pre-match churn
   (ticket links, byes, asset URLs) is excluded from the change oracle from day one.

### 13.3 Fixture upserts by `providerMatchId` (successor behaviour)
- First observation with a pre-match status and no `fixtures` row for `(afl_api, CD_M)` →
  `new` → INSERT `fixtures` (status `scheduled`, `source_id = afl_api`, `source_record_id =
  CD_M`, `import_batch_id`, `fixture_key = randomUUID()`), ledger row target `fixtures`.
- Re-observation, unchanged → head touch, no candidate.
- Re-observation with changed date/time/venue/round/clubs while still pre-match →
  `rescheduled` (round/date/time/venue) or `corrected` (clubs) → auto-apply onto the **same
  row** located by provider id, subject to E3 (row owned by `afl_api`), E4 (no active
  `data_overrides` `fixtures` row — a human edit wins, the candidate is queued), E5 baseline.
- Provider says the match no longer exists in the season enumeration → `absent` (review
  signal only; a human may cancel/void through `admin-fixtures.ts`). Never a DELETE.
- Transition to `CONCLUDED` → the match family inserts the `matches` row with the same
  `source_record_id`; the read-time played resolution (097 §18) then reports the fixture
  played; `isFixtureEditAllowed()` locks it. No `fixtures` row is ever mutated by the
  match family and no `match_id` is stored on `fixtures` (ISSUE-162 D-6 preserved).
- Duplicate protection: `fixtures_source_record_uq` + the provider-id-first resolver; a
  manually created fixture for the same real-world match (different `source_id`) is detected
  by `(season, round_code, home, away)` equality and reported as `foreign_owned_collision`
  (candidate for a human to void one), never merged.

### 13.4 Season / fixture discovery (successor behaviour)
`GET aflapi.afl.com.au/afl/v2/competitions/1/compseasons?pageSize=100` (the sample
`00-compseasons.raw.json` exists in both sample sets) → a `discover-seasons` command that
**proposes** additions to `afl-api-identities.json.seasons` (new `{year, compSeasonId,
providerId}`) as a diff for the operator; it never writes `seasons.json` or advances
`in_progress_seasons` (that is the ISSUE-101 rollover's decision). The fixtures administrable
window (`max(seasons.year) ≤ S ≤ max+1`, `admin-fixtures.ts:179-184`) already admits the next
season, so a newly discovered season's SCHEDULED matches can be imported as soon as the
registry entry is approved.

### 13.5 Validation, idempotency and HALT rules for fixture updates (successor behaviour)
- Pre-match (`fixtures` target): the §8 gates 2–4, 10, 12 apply; a change is applied when the
  row is `afl_api`-owned and unlocked; contradictions (two provider ids for one
  `(season, round, home, away)`; a provider id whose clubs change) → candidate + `data_issues`,
  no write.
- **After the match has started** (`status ∈ {LIVE, POSTGAME, CONCLUDED}` observed at least
  once, or a `matches` row exists for the provider id): any change to the historically
  significant fields — `season`, `round_code`/`round_type`, `match_date`, `home_club_id`,
  `away_club_id`, `venue_id` — on the `matches` target is **never auto-applied**; it becomes a
  `corrected` candidate with `agreeing_groups = ['afl_api']` for Super Admin review (this is
  where a rekey of an `afl_api`-owned row happens, deliberately). Scores and period scores may
  still auto-apply as ordinary corrections. Time-of-day corrections on a concluded match are
  treated as historically significant too (they change nothing derived, but silently rewriting
  them is the behaviour the brief forbids).
- Idempotency: unchanged payload → no version, no candidate; the same snapshot replayed → no
  write, no ledger row (existing property).
- HALT (run-level, §14): provider-identity contradiction; season enumeration shrinking by more
  than a declared tolerance (a partial feed must not sweep half a season absent —
  `--require-complete-source` semantics, ISSUE-128).

---

## 14. Risks and HALT conditions

| # | Risk | Mitigation / HALT |
|---|---|---|
| R1 | Identity bridge coverage too low (debutants, unsettled rows) → most stat rows unresolved | Bridge is measured on `afldb_test` before any DEV apply; publish coverage %; the match family settles regardless; ISSUE-224 remains open for registration. |
| R2 | Two owners for one fact (afltables vs afl_api) → nightly exception noise or, worse, a policy that lets one overwrite the other | §7.5 co-source policy, decided by the operator before S6; E3 never weakened; only the attendance field group crosses owners. |
| R3 | Off-by-one round mapping (Opening Round) | Declared per-season vocabulary + backtest assertion 2 + gate 2 comparing the resolved canonical match's `round_number`. |
| R4 | Team/venue name drift or a new venue id | Map-only resolution; drift refuses; unmapped venue is a warning. |
| R5 | Post-conclusion Champion Data corrections | Spine history + `corrected` candidates; auto-apply only for the owner; exclusion list measured (§9.9). |
| R6 | API change / token mechanism change / rate limiting | Adapter fails closed (no manifest); `known_columns` contract refuses drift; token is public but unofficial — same risk class 077 records. |
| R7 | Rollover doctrine ("fitzRoy full-history supersedes in-season provenance") would collide with `afl_api`-owned 2026 rows | **DECIDED (Q7):** amend `AFLDB-2026-API-ACQUISITION.md` §5 and ISSUE-101/F **before** the 2026 rollover: the completed-season re-acquisition corroborates independently sourced canonical rows (agreement recorded, disagreement → `data_issues`), enriches only through the §7.5 field-group rule, and never re-owns. Any ownership transfer is an explicit rule or operator decision with its own ledger rows. The Stage-9 gate `matches_after_accepted_last_season = 0` is unaffected (in-season rows are never in the historical core). Doc amendment is Stage S8; ISSUE-101/F's own runbook must be updated by that issue, not silently by this one. |
| R8 | `match_time` vocabulary mismatch creates perpetual `corrected` diffs between sources | Exclude `match_time` from cross-source comparison (`CORROBORATED_MATCH_FIELDS` already excludes it); confirm rendering (Q5). |
| R9 | Brownlow live-count polling creates version churn | Match-grain records; leaderboard family not promoted; `max-age=3` respected with a ≥ 60 s poll floor. |
| R10 | Fixture successor rekeys a concluded match silently | §13.5 rule: historically significant fields on a started match are review-only. |

**HALT conditions (stop the run, write nothing canonical, exit non-zero, marker
`AFLDB_SETTLE_FAILURE`):** manifest hash mismatch; registry refusal (undeclared column /
season without a round vocabulary → `round_vocabulary_missing`, §6.4); provider-identity
contradiction (§6.1); season enumeration
smaller than the last complete enumeration by > declared tolerance; two canonical rows for one
provider id; bridge file hash mismatch; `data_overrides` CHECK unreadable (existing E4 rule).

---

## 15. Questions the repository and samples cannot answer

1. ~~Ownership policy~~ — **DECIDED 2026-09-19 (Q1): co-source corroboration; no re-ownership.**
2. ~~Attendance enrichment~~ — **DECIDED 2026-09-19 (Q2): approved, field-scoped, never over
   a cited or reviewed value.**
3. Should `career_game_no` be enriched by AFL Tables under a second field-group rule, or left
   to the derived recompute? (Default in this plan: NULL, derived. Q2 approved attendance only;
   adding a group is a new decision.)
4. The exact pre-match `status` strings (`SCHEDULED`? `UPCOMING`? `LIVE`?) — unobserved; must be
   measured live before the fixture successor and recorded as measurements, not enums.
5. `matches.match_time` rendering on `afldb_test` for a 2026 AFL Tables row (e.g. `7:20 PM` vs
   `19:20`) — one read-only query settles the vocabulary.
6. Confirm the AFL Tables numbering of 2024/2025 `brownlow_round_votes.round_number` on
   `afldb_test` (Opening Round votes under round 1?).
7. ~~Rollover doctrine amendment~~ — **DECIDED 2026-09-19 (Q7): corroborate, never re-own;
   transfers only by explicit rule/decision.**
8. Is any AFL.com.au terms-of-use constraint on storing Champion Data extended statistics a
   concern? Out of scope by ISSUE-096 exclusion; this plan stores none, but the raw payloads
   in `staging.source_payloads` do retain them.
9. Polling cadence and hosting for the acquisition timer (DEV first; production timer is a
   separate authorisation, as ISSUE-122 S8 was).
10. Whether the standalone monitor can be pointed at the 2026 Brownlow feeds during the count
    (§10, timing).

---

## 16. Implementation stages (dependency order)

| Stage | Deliverable | Depends on | Files (new **N** / modified **M**) | Gate |
|---|---|---|---|---|
| **S0** | This plan approved. Q1/Q2/Q7 **decided 2026-09-19** (§0.1); T1–T4 tightening incorporated | — | `issues/open/AFLDB-ISSUE-228.md` | operator |
| **S1** | Registry (families with **empty** `hash_exclusions`, `co_source_groups`), reference identity maps, per-season explicit round tables, and the **round translation module** `afl-api-rounds.ts` with its refusal table; DB-free contract tests | S0 | **M** `data/reference/source-families.json`; **N** `data/reference/afl-api-identities.json`; **M** `src/lib/acquisition/source-families.ts` (round-table shape + validator rules §6.4); **N** `src/lib/acquisition/afl-api-rounds.ts`; **N** `tests/afl-api-rounds.test.ts`; **M** `tests/reference-data.test.ts` | vitest; §19.7 |
| **S2** | Direct-HTTP acquisition adapter with manifest-last, retry, token handling; DB-free tests with a stubbed fetch | S1 | **N** `tools/current-season/acquire-afl-api.ts`; **N** `src/lib/acquisition/afl-api-client.ts` (pure request planning + response validation, fetch injected); **N** `tests/afl-api-match.test.ts` | vitest |
| **S3** | Bundle emitter (parse → resolve → project → bundle) + backtest harness over the hash-bound samples | S1 | **N** `src/lib/acquisition/afl-api-bundle.ts`; **N** `tools/current-season/emit-afl-api-bundle.ts`; **N** `docs/rebuild-manifests/afl_api/backtest-20260919.json`; **N** `tests/fixtures/afl_api/*` (trimmed); **M** `tests/afl-api-match.test.ts` | backtest §9.1–9.4, 9.8, 9.9 green |
| **S4** | Migration 103 typed projections; source description | S3 | **N** `src/db/migrations/103_afl_api_match_projections.sql`; **M** `tests/afl-api-lineup-migration.test.ts` pattern → **N** `tests/afl-api-match-migration.test.ts` | migrate on `afldb_test` (operator) |
| **S5** | Player provider **bootstrap** bridge (T1): offline builder, validate-only/dry-run/apply loader writing durable `external_identities` (`afl_api_stat_vector_bootstrap`, `unique`, append-only), contradiction `data_issues`, coverage report | S3, S4 | **N** `tools/migration/build_afl_api_player_bridge.py`, **N** `tools/migration/import_afl_api_player_bridge.py` (DraftGuru-bridge pattern, `common.Reporter`); **N** `data/reference/afl-api-player-bridge-<date>.json`; **N** `tests/python/afl_api_bridge_contract.py` | backtest §9.5–9.7 on `afldb_test`; §19.4 |
| **S6** | Source-parametrised settle: `SettleSourceSpec` (source key, families, projection writers, tool name, bundle acquisition kind, **supported bundle contract version**), **record deferral** (bundle v2 `deferral`, no target pass, `recordsDeferred` counters, completeness/report wording — T3), provider-id-first resolver, **co-source corroboration** (Q1: `corroboratedForeignOwned`, never an exception), **attendance field-group enrichment** in `canonical-apply.ts` (Q2 gate §7.5 conditions 1–7, keyed on `attendance_source_id IS NULL`, never on match completion), player resolution from `external_identities` only (T1); CLI `settle-afl-api.ts`; integration tests | S4, S5 | **M** `src/lib/acquisition/settle-afltables.ts` (extract `settle-core.ts`; the AFL Tables spec keeps byte-identical behaviour, proven by the existing suite), **M** `canonical-apply.ts`, **M** `source-completeness.ts`, **M** `settle-report.ts`; **N** `tools/current-season/settle-afl-api.ts`; **M** `package.json` scripts; **N** `tests/integration/settle-afl-api.test.ts` (fixture seasons reserved per the 2073/2084–2099 convention) | existing `settle-afltables.test.ts` unchanged and green; new suite green on `afldb_test`; §19.1–19.6 |
| **S7** | Brownlow families, validator, projection, `settle:afl-api-brownlow`, season artefact builder | S4, S5, S6 | **N** `src/lib/acquisition/afl-api-brownlow.ts`; **N** `tools/current-season/settle-afl-api-brownlow.ts`; **N** `tools/migration/build_brownlow_season_artefact_from_afl_api.py`; tests | backtest §9.10; replay of live-count captures |
| **S8** | Operations: chain script, systemd unit + timer (DEV), admin status second unit, docs (`docs/acquisition/…` §4/§5 amendments **including the Q7 rollover wording**, `docs/deployment.md`), `.env.example` (base URLs only) | S6 | **N** `deploy/afldb-settle-afl-api.sh/.service/.timer`; **M** `settle-status.ts`, `settle-trigger.ts` (unit table, not a second copy); **M** docs | `sh -n`, DEV dry-run |
| **S9** | DEV validation: dry-run → apply on the remaining 2026 matches (Grand Final if timing allows), corroboration of R1–R28 against AFL Tables rows, Brownlow replay | S8 | evidence in this runbook | operator |
| **S10** | Successors: fixture ingestion (§13, ISSUE-229), season discovery, `admin/player-links` `afl_api` adjudication, optional extended stats / umpires / play-by-play families, rollover doctrine amendment (ISSUE-101/F) | S9 | separate issues | — |

Documentation weight: T3 (multi-module, migration) under CLAUDE.md §15; plan review by
`afldb-reviewer` is the first act of any planned launch.

---

## 17. Operational / runbook plan

- **Commands** (`package.json`): `acquire:afl-api -- --season 2026 [--status CONCLUDED] [--since YYYY-MM-DD] [--match CD_M…]`; `emit:afl-api -- --label <label>`; `settle:afl-api -- --label <label> (--dry-run | --apply) [--auto-apply] [--report] [--require-complete-source] [--validate-only]`; `acquire:afl-api-brownlow`, `settle:afl-api-brownlow`; `bridge:afl-api -- --build | --validate-only | --dry-run | --apply`.
- **Dry-run / validate-only**: `--validate-only` = manifest re-hash + registry + bundle
  contract, no connection; `--dry-run` = the full write path rolled back (the §22 pattern);
  `--apply` without `--auto-apply` = observations + projections + candidates only.
- **Retention**: raw snapshots immutable and gitignored; manifests tracked; no pruning in v1
  (~1 MB per match); a pruning policy is a later operator decision.
- **Retry / token**: 3× backoff per request; token re-issued once on 401/403 and at most once
  per run otherwise; token never persisted or logged.
- **Logging**: the existing `[monitor]` block and `AFLDB_SETTLE_SUCCESS/FAILURE` markers;
  counters in `import_batches.validation_result` (ISSUE-128 shape) with source-specific names.
- **Health / status**: `settle-status.ts` gains a unit table `{afltables, afl_api,
  afl_api_brownlow}`; the admin current-season panel shows each unit's last run, completeness
  verdict and the number of pending candidates / unresolved identities.
- **Manual review path**: `promotion_candidates` (pending) + `import_rejections` per batch +
  `data_issues` (`source_disagreement`, `canonical_apply_failed`) — the existing surfaces; the
  human accept path stays unimplemented (a separate issue if wanted).
- **Safe failure**: no manifest → no bundle; contract refusal → no connection; any gate → unit
  refusal in its own savepoint; HALT → whole run rolled back including the batch row.

---

## 18. Test plan (staged)

1. **DB-free parser/adapter** (`tests/afl-api-match.test.ts`): request planning, token flow with
   a stubbed fetch, manifest-last, canonicalisation and exclusions, round mapping, cumulative
   conversion, integrality, external-record encoding, gates 1–10 on trimmed fixtures.
2. **Fixture contract / backtest** (same file, `describe('backtest')`): §9.1–9.4, 9.8, 9.9 over
   the hash-bound local samples, skipping explicitly when absent.
3. **Registry** (`tests/reference-data.test.ts`): new families validate; undeclared column
   refuses; per-season vocabulary required.
4. **Migration** (`tests/afl-api-match-migration.test.ts`): 103 shape, CHECKs, grants.
5. **Test DB integration** (`tests/integration/settle-afl-api.test.ts`): observe → project →
   candidate → auto-apply for a new match; identical rerun no-op; A→B→A three versions;
   POSTGAME withheld then CONCLUDED applied; unresolved debutant leaves the match applied;
   co-source-owned row corroborated not refused; attendance enrichment (if approved); HALT on
   provider contradiction; `--dry-run` leaves every relation byte-identical.
6. **Bridge** (`tests/python/afl_api_bridge_contract.py` + `afldb_test` read-only coverage run).
7. **Brownlow** (`tests/afl-api-brownlow.test.ts` + integration): §10 validation list; replay of
   the live-count captures for idempotency.
8. **DEV**: S9 as above; `sync-dev.ps1`, migration 103 applied, bridge applied, dry-run then
   apply; smoke via `/seasons/2026` after `season-revalidation`.
9. **Live 2026 Grand Final**: useful only if S8 reaches DEV in time; otherwise the GF is
   captured by the monitor and replayed.
10. **Live 2026 Brownlow**: capture-only during the count (§10); replay later.

---

## 19. Acceptance criteria added by the 2026-09-19 amendments

Each criterion names the suite that proves it. A stage is not complete while any of its
criteria is unproven.

### 19.1 Co-source ownership (Q1) — `tests/integration/settle-afl-api.test.ts`, `tests/current-season-import.test.ts`
- (a) An `afltables`-owned 2026 match observed by `afl_api` with equal scores: no canonical
  write, no exception, `corroboratedForeignOwned = 1`, `agreeing_groups` includes `afl_api`,
  `matches.source_id` unchanged.
- (b) Same, with a differing score: no write, one open `source_disagreement` `data_issues` row
  keyed by the settle issue key; a later agreeing poll resolves it (existing lifecycle).
- (c) A match first promoted by `afl_api` is `afl_api`-owned; a subsequent AFL Tables settle
  over the same match performs no ownership change and no write except §19.2.
- (d) DB-free: `autoApplyOwnership()` still returns `refused/foreign_source_owner`; the
  co-source classification is applied by the settle core *after* that verdict and only for
  declared co-source pairs (a non-co-source owner is still an exception).
- (e) No code path can set `matches.source_id` on an existing row inside a settle; a source
  scan of `canonical-apply.ts` for `SET source_id` on `UPDATE` asserts it.

### 19.2 Attendance enrichment (Q2) — `tests/integration/settle-afl-api.test.ts`
- (a) `afl_api` promotes a match with `attendance NULL` and the non-complete
  `attendance_status`; promotion succeeds; the player rows land.
- (b) AFL Tables settle then supplies attendance for that match: exactly one
  `canonical_applications` row (`target_table = matches`, `verb = update`, `new_values` =
  the three attendance fields only), `attendance_source_id = afltables`,
  `matches.source_id` still `afl_api`.
- (b2) **Completion does not freeze the field:** the same as (b) but the AFL Tables
  observation arrives after the match has been CONCLUDED, fully settled (period scores and
  all 46 player rows applied) and corroborated on an earlier run, and after a `corrected`
  score candidate for the same row has been refused as foreign-owned — the attendance
  enrichment still lands, and the refused score candidate is unchanged.
- (b3) **Enrichment never inserts:** an AFL Tables attendance observation for a match with no
  canonical row proposes nothing under the enrichment rule (it is an ordinary `new` match
  proposal under the ordinary path).
- (c) Rerun: no-op.
- (d) With an active `data_overrides` `(matches, key, attendance)` row: refused
  `manual_authority_conflict`, candidate queued, no write.
- (e) With `attendance_source_id` non-NULL (`manual_admin_edit`, `afltables` or any source):
  no automatic write, whatever the value; a differing value is a `corrected` candidate.
- (e2) A 0-crowd enrichment without a citing `attendance_source_id` in the enriching
  projection is refused (`invalid_attendance`); a negative or non-integer value is refused.
- (f) An `afl_api` proposal never carries a non-NULL attendance (projection CHECK in
  `staging.afl_api_match` and a DB-free assertion on `proposedMatchValues`).
- (g) No other field group is enrichable: a DB-free test enumerates `CO_SOURCE_ENRICHMENT`
  and asserts it equals `{ matches: { attendance: [...] } }`; a DB-free test asserts the gate
  function reads `attendance_source_id` and `data_overrides` and **does not** read match
  status, `is_final`, `CONCLUDED`, or any player/period row count.

### 19.3 Rollover corroboration (Q7) — `docs/acquisition/AFLDB-2026-API-ACQUISITION.md` §5 (S8) + a DB-free assertion
- (a) The rollover row in §5 no longer says "supersede in-season provenance"; it says
  corroborate/enrich per §7.5 and names the explicit-transfer rule.
- (b) `tests/reference-data.test.ts` asserts the registry declares `afltables` and `afl_api`
  as one co-source group and that neither family carries a `supersedes` relation.
- (c) ISSUE-101/F is cross-referenced as the owner of the rollover runbook change (not
  implemented here).

### 19.4 Player bridge is bootstrap-only (T1) — `tests/python/afl_api_bridge_contract.py`, `tests/integration/settle-afl-api.test.ts`
- (a) The loader writes `external_identities` rows with `status = 'unique'`,
  `match_method = 'afl_api_stat_vector_bootstrap'`, and never updates or deletes an existing
  row; a second run over identical evidence is a no-op; a contradicting run withholds and opens
  a `data_issues` row.
- (b) The builder refuses any pair failing §6.3 (a)–(d); names never create a link (fixture:
  same surname, different stat vectors → withheld).
- (c) **AFL Tables absent:** with no AFL Tables snapshot on disk, no `afltables` staging rows
  and no `afltables`-owned `player_match_stats` for the match, a settle over a new
  `afl_api` match resolves every previously bridged `CD_I` and applies their rows.
- (d) An unbridged `CD_I` yields `unresolved_identity` for that player unit only; the match
  unit applies; no `players` row and no `external_identities` row is created.
- (e) A source scan asserts the settle core imports nothing from `import_fitzroy_core`,
  reads no `afltables` projection table, and resolves players solely through
  `refs.playerIdsByProviderId`.

### 19.5 Semantic hashing (T2) — `tests/afl-api-match.test.ts`, `tests/reference-data.test.ts`
- (a) Every ISSUE-228 family ships with `hash_exclusions: []`.
- (b) Two byte-different serialisations of the same parsed object (pretty vs compact; `9.0`
  vs `9`) produce one `payload_hash`.
- (c) The Hawthorn 10:29 / 21:41 pair produces `unchanged` with no exclusions (or the test
  prints the differing paths and fails until they are recorded as evidence — never until an
  exclusion is added).
- (d) Registry validator: an `afl_api` family exclusion without a matching `evidence[]` entry
  citing ≥ 3 pairs and a fixture path refuses; a fixture path that does not exist refuses.
- (e) For each exclusion that is ever added: a regression test asserts `unchanged` with it and
  `version_inserted` without it, using the recorded fixture pair.

### 19.6 POSTGAME deferral (T3) — `tests/afl-api-match.test.ts`, `tests/integration/settle-afl-api.test.ts`
- (a) A `POSTGAME` fixture record emits `deferral: {reason: 'status_not_concluded'}`,
  `projection: null`, `rejection: null`; the bundle validates under contract v2; contract v1
  (AFL Tables) refuses a `deferral` key.
- (b) Settle: the record is persisted to the spine, no projection row, no `promotion_candidates`
  row, no `import_rejections` row, `recordsDeferred.status_not_concluded = 1`,
  `snapshotRejections` unchanged, completeness `complete`, exit 0.
- (c) The same match re-observed as `CONCLUDED`: one new spine version, projection written,
  applied; the earlier deferral leaves no exception history.
- (d) Re-poll of an unchanged `POSTGAME` payload: `head_refreshed`, no version.
- (e) `--report` lists deferred records under "Not yet concluded", not under exceptions;
  `settle-status.ts` shows the count as informational.
- (f) A `CONCLUDED` match with a real gate failure is still a rejection/refusal and still turns
  `--require-complete-source` red (the distinction must not swallow genuine failures).

### 19.7 Round translation (T4) — `tests/afl-api-rounds.test.ts`, `tests/reference-data.test.ts`
- (a) 2026 table: `OR/0 → ('1', 1, home_and_away)`; `Round 24/24 → ('25', 25)`;
  `WF/25 → ('WF', NULL, wildcard_final)`; `QE/26` + "First Qualifying Final" → `QF`,
  + "Second Elimination Final" → `EF`; `SF/27`, `PF/28`, `GF/29`.
- (b) 2022 table: `Round 1/1 → ('1', 1)` (no Opening Round); finals week 1 without a label →
  `finals_label_required`.
- (c) Season with no vocabulary → the emitter HALTs before writing a bundle
  (`round_vocabulary_missing`); no DB connection is opened.
- (d) `api_round_number` outside the table → `round_unmapped` record rejection; the record is
  present in the enumeration; completeness reports `rejected_records`.
- (e) Declared name/abbreviation drift → `round_vocabulary_drift`.
- (f) Source scan: no file other than `afl-api-rounds.ts` contains `roundNumber + 1`,
  `roundNumber+1` or an equivalent offset applied to an AFL round; the Brownlow emitter and
  the match emitter both import `translateAflRound`.
- (g) Registry validator refuses a vocabulary with non-contiguous canonical H&A numbers,
  duplicate `api_round_number`, or a `mixed_finals` row without `finals_label_rules`.
- (h) Backtest: all 14 sample matches translate to the folder's canonical round (with the
  documented 2022–2024 finals-label limitation asserted as a refusal, not a guess).
