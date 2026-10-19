# AFLDB V2 — legacy ingestion disposition matrix (plan D10, ADR 0010)

Status: implemented state at the close of Stage 6 (Launch E, 2026-10-19: wording corrections to L3
and L4 only, plan §7 R-042; first written at the close of Stage 4, Launch C, revised in Stage 5). Every legacy ingestion
path from `docs/v2/inventory.md` (invoker matrix L1-L13) and the owner's list is classified below,
with its current callers re-derived from the code. What Stage 4 changed is stated per row; what
it did not change is labelled with the stage, issue or owner decision that owns it. Nothing here
was executed against a database, a scheduler or a network.

## 1. Vocabulary

- **Disposition** (the launch brief's terms): `retain` (runtime, kept as is); `retain-offline`
  (kept in place as offline tooling, never scheduled or imported by runtime); `quarantine`
  (moved under `legacy/offline/`); `remove-from-runtime` (its runtime entry points must refuse or
  disappear; the stage that does it is named).
- **D10 class** (the owner's terms): removed from V2 · retained as offline historical evidence ·
  retained temporarily behind a disabled compatibility boundary · replaced by AFL API · replaced
  by a derived calculation · replaced by curated admin entry.

## 2. How the classification is enforced (Stages 4-5)

`tests/v2-module-boundaries.test.ts`, over pure checkers in `packages/testing/src/module-boundaries.ts`:

| Guard | What it proves on the real tree | Negative control |
|---|---|---|
| a. scheduled references | no `package.json` script and no file under `deploy/` references `legacy/` | in-memory fake script |
| b. legacy import rule | nothing outside `legacy/**` imports `legacy/**` (src, tools, packages, deploy); the rule is not vacuous (the quarantined CLI exists) | fixture `src/app/admin/x.tsx` importing `legacy/offline/...` |
| c. legacy-runtime ratchet | the direct importers of `LEGACY_RUNTIME_MODULES` (§4) equal `KNOWN_LEGACY_RUNTIME_EDGES` exactly; a new edge or a vanished edge fails | in-memory importer adds an edge (unexpected) and a vanished one (stale) |
| d. public runtime independence | the transitive import closure of the public web (`src/app/**` except `src/app/admin/**` and `src/app/api/admin/**`, plus `src/components/**`; 132 entry files) reaches no legacy runtime module and nothing under `tools/` or `legacy/` | probe chain `src/components/__Probe.tsx > src/lib/__probe_edge.ts > src/lib/ingest/pipeline.ts` |
| e. offline tools | nothing under `src/**` or `packages/*/src/**` imports `tools/{migration,rebuild,records,aflw,email_intake}/` or `legacy/` | probe files |
| f. retired entries | every `package.json` script that runs `tools/v2/retired-entry.ts <name>` names an entry of `RETIRED_ENTRIES` (`packages/domain/src/legacy-retirement.ts`), every entry is wired, and the CLI exits 1 with the refusal | spawned CLI; unknown name |
| g. retired admin registry (Stage 5) | `RETIRED_ADMIN_SURFACES` lists 5 surfaces and 7 exports once each, with real paths and governing documents; the typed refusal carries `refused`, `code: 'legacy_retired'`, the surface id and the same text as `error` | pure unit tests |
| h. admin legacy import ban (Stage 5) | no file under `src/app/admin/**` or `src/app/api/admin/**` imports `pipeline.ts`, `datasets.ts`, the Squiggle/Kali libraries or `startSettleRun` | in-memory admin file with each forbidden import |
| i. removed stays removed (Stage 5) | no admin page or component renders or imports `SettleRunPanel`, `CurrentSeasonControls`, `UploadForm` or `ReviewControls`; every retired export still exists and its body reaches the refusal helper for its own surface | a refusal that regained behaviour, lost its export or names the wrong surface is reported |

Plus `tests/current-season-import.test.ts` (F-001 assertions on the quarantined CLI).

## 3. The matrix

| # | Path(s) | Current callers (file:line) | Disposition | D10 class | Reason | Replaced by / Stage 4 change |
|---|---|---|---|---|---|---|
| L1 | CSV upload: `src/app/admin/upload/page.tsx`, `src/app/admin/upload/stage/route.ts` (formerly -> `src/lib/ingest/pipeline.ts` `stageSubmission`) | Stage 4: the page imported `ingest/datasets.ts`, the route `pipeline.ts`. After Stage 5: neither imports them | removed from runtime (**Stage 5, done**) | replaced by curated admin entry | runtime must not depend on CSV; duplicate import screen | curated award proposals (D8, `/admin/operations/awards`) and the audited data editor. Stage 5: `UploadForm.tsx` deleted; the page is a retirement notice; `POST` keeps its same-origin check (403) and `acquisition.legacyIntake`, then answers 410 with one `admin.legacy_retired_refused` row (surface `admin.csv_upload`) |
| L2 | CSV submission review and promotion: `src/app/admin/submissions/[id]/actions.ts` (`runValidation`, `decideSubmission`, `runPromotion`; formerly -> `pipeline.ts` `promoteSubmission` (:483) -> `src/lib/ingest/datasets.ts` promoters) | After Stage 5 no runtime importer; offline `tools/records/import-first-kick-goal.ts:78` imports `ingest/datasets.ts` | removed from runtime (**Stage 5, done**: the server actions refuse) | replaced by curated admin entry | direct CSV-to-final-table: writes `award_nominations` (datasets.ts:441), `award_winners` (:564), `matches` (:1275, :1937), `player_match_stats` (:1665), `players` (:1774) | curated proposals (awards) and the audited data editor (facts). The offline first-kick-goal import keeps using `datasets.ts` (retain-offline). Stage 5: `runValidation` (`requireAdmin`), `decideSubmission` and `runPromotion` (`requireSuperAdmin`) keep their guards and refuse (surface `admin.submission_review`); `ReviewControls.tsx` deleted; `/admin/submissions/[id]` is read-only history |
| L3 | Email CSV intake: `deploy/afldb-email-intake.timer` (`OnUnitActiveSec=5min` :6) -> `.service:17` -> `tools/email_intake/fetch_and_stage.py` -> `POST src/app/api/admin/email-intake/route.ts` (:127; imports `pipeline.ts` at :8 and :12) | scheduler (timer); shared-secret route | route: removed from runtime (**Stage 5, done**: 410); timer: disabled by `docs/v2/cutover-runbook.md` step 4 (**Stage 6: written, not executed**) | removed from V2 | runtime must not depend on CSV; staging feeds the L2 promotion | nothing (corrections go through the audited editors). Stage 5: `POST` answers 410 without reading the request, comparing the secret, touching the database or auditing (surface `admin.email_intake`); the poller files each message to its Errors folder, kept (`fetch_and_stage.py:606-607`, `:742-744`). The timer still runs: V2-GAP-013 |
| L4 | AFL Tables nightly settle: `deploy/afldb-settle-afltables.timer` (04:30, :13) -> `.service:35` -> `deploy/afldb-settle-afltables.sh` -> `tools/rebuild/fitzroy/acquire_core.R` -> `tools/migration/import_fitzroy_core.py` -> `tools/current-season/settle-afltables.ts` (:58 imports the library) -> `src/lib/acquisition/settle-afltables.ts`; `npm run settle:afltables` (`package.json:43`) | scheduler; package script; admin trigger (L5) | retain behind the ISSUE-316 boundary, then remove-from-runtime through the ISSUE-316 sequence (D-316-1 at C2, the timer disabled by C5 under D-316-4) | retained temporarily behind a disabled compatibility boundary; then replaced by AFL API | the AFL Tables network register (`data/reference/afltables-network.json`, gates in `src/lib/acquisition/afltables-network.ts:36-62`) already makes every network path refuse once retired; retiring it is the owner's ISSUE-316 sequence (D-316-1, then D-316-4 at C5; corrected in Stage 6, plan §7 R-042: D-316-2 is the inert AFL API unit install), which V2 may not execute | AFL API pipeline (Stage 3). The shell script, trigger and register are frozen ISSUE-316 files (`D:\tmp\afldbV2-source-snapshot-20261019\changed-files.txt`). Stage 4: unchanged. **V2-GAP-011 (cutover blocker)** |
| L5 | AFL Tables settle admin trigger: `src/app/admin/current-season/actions.ts` `startSettleRunAction` (:167) -> `src/lib/acquisition/settle-trigger.ts` (frozen) | After Stage 5 the action imports no trigger; `page.tsx:7` (type only), `AflApiSettleUnitsPanel.tsx:18` and `settle-status.ts:33` read the unit contract | admin trigger removed from runtime (**Stage 5, done**); `settle-trigger.ts` retained (frozen) for status | retained temporarily behind a disabled compatibility boundary | the trigger already returns `unavailable` without calling systemctl when the register is retired | Stage 5: `startSettleRunAction` keeps `acquisition.currentSeason` and refuses (surface `admin.afltables_settle_trigger`); `SettleRunPanel.tsx` deleted; the operations centre shows the unit's status only. The nightly settle (L4) is unchanged (V2-GAP-011) |
| L6 | Squiggle / Kali refresh: `src/lib/external-afl/current-matches.ts` (HTTP), `src/lib/external-afl/current-season-import.ts` (`runCurrentSeasonRefresh`); CLI now `legacy/offline/tools/current-season/update-current-season.ts` | after Stage 5 only the quarantined CLI (:37); `current-matches.ts` has no importer outside `current-season-import.ts` | CLI: **quarantine** (done); package script: **remove-from-runtime** (done: `current-season:update` runs `tools/v2/retired-entry.ts` and exits 1); admin control: removed from runtime (**Stage 5, done**); library: kept for the quarantined CLI, unreachable from runtime | removed from V2 (the CLI kept as offline diagnostic evidence) | Squiggle and Kali are retired: AFLDB-ISSUE-122/128 made them staging and diagnostic only (writes `staging.external_current_matches` and the observation spine, never canonical rows) | AFL API (Stage 3). **F-001 fixed**: the CLI no longer defaults `--source` to `squiggle`; a refresh without `--source` refuses; `--report` still works. Stage 5: `runCurrentSeasonAdminAction` keeps `acquisition.currentSeason` and refuses (surface `admin.squiggle_kali_refresh`); `CurrentSeasonControls.tsx` deleted |
| L7 | AFL Tables network register and rollover: `tools/db/rollover-season.ts` (frozen) writes `data/reference/afltables-network.json`; `src/lib/rollover/afltables-network-retirement.ts` | manual CLI | retain | — (it is the retirement mechanism for L4) | the register is how AFL Tables is switched off | Stage 4: unchanged |
| L8 | Offline rebuild families `tools/rebuild/{afltables,fitzroy,draftguru,afl_api}/**` | `tools/db/rebuild-test.ts` (the sealed historical rebuild; e.g. `import_draftguru.py`, `acquire_club_lists.R`, `acquire_coaches.py`, `validate_ladder_witness.py`); `acquire_core.R` also via L4 | retain-offline (in place) | retained as offline historical evidence | moving them would break the sealed historical rebuild (plan D10); three are frozen ISSUE-316 files (`afltables/acquire_club_lists.R`, `afltables/acquire_coaches.py`, `fitzroy/acquire_core.R`) | guard e proves no runtime import; no scheduler other than L4 |
| L9 | `tools/migration/*` importers (51 files) | `tools/db/rebuild-test.ts` invokes 21 of them (e.g. `import_fitzroy_core.py`, `import_awards.py`, `load_reference_data.py`, `rebuild_derived.py`); package scripts for the AFL API identity tools | retain-offline (in place) | retained as offline historical evidence | the historical rebuild depends on them; `import_legacy_afl.py` (legacy SQLite) is not used by the rebuild but is the only loader of that source, so it is kept | physical quarantine of Python/R tools deferred: V2 cannot execute Python/R to prove a moved script still runs (**V2-GAP-014**) |
| L10 | Wikipedia-derived enrichment ("direct Wikipedia-to-production automation"): `tools/migration/{after_siren,all_australian,captaincies,enrich_heights_wikipedia,family_siblings,father_son,hall_of_fame,honour_teams,named_medals}.py`, `import_awards.py`; `tools/records/import-first-kick-goal.ts` | `tools/db/rebuild-test.ts` (each referenced 1-20 times); `npm run records:first-kick-goal` (`package.json:52`); no timer, no admin button (guard a, guard e) | retain-offline (in place) for sealed historical seasons; **removed** as a path for new data | historical: retained as offline historical evidence; new seasons: replaced by curated admin entry | they reload sealed history and are never scheduled; for any new season Wikipedia may only feed a proposal | curated proposals (D8): `parseAwardProposalFile` (whole-file refusal) creates proposals only; approval is a separate, audited, transactional review |
| L11 | Derived rebuild `tools/migration/rebuild_derived.py` | manual; operator instructed at `src/app/admin/db-health/page.tsx:75` (the submissions page's instruction went with its review controls in Stage 5) | retain-offline | retained as offline historical evidence | recomputes derived tables for the sealed rebuild | Coleman: replaced by a derived calculation (`@afldb/derived` `deriveColeman`, ADR 0006); the db-health prose is unchanged in Stage 5 and still mentions "a recent upload" (wording only) |
| L12 | AFLW staging `tools/aflw/load_staging.py` | manual | retain-offline | outside V2 scope | AFLW has its own model (V2-GAP-005) | unchanged |
| L13 | Audited admin editors (awards, Brownlow, coaches, draft, fixtures, season lists, leadership, special records, data editor, player links) | admin pages behind capabilities | retain (Stage 5 regroups them behind explicit capabilities) | — | they are the audited correction workflows (`docs/v2/historical-baseline.md` §2) | the curated award workflow (D8) reuses the award-winner create path inside its approval transaction |

### Cross-cutting items from the owner's list

| Item | Where | Disposition | Reason / evidence |
|---|---|---|---|
| Fragile multi-source reconciliation | (a) Squiggle vs Kali independence-group comparison, `src/lib/external-afl/current-season-import.ts:145`; (b) AFL API vs stored AFL Tables-owned rows, `src/lib/acquisition/afl-api-settle-plan.ts` over `src/lib/acquisition/reconciliation.ts`; (c) the AFL Tables settle's use of the same verbs (`settle-afltables.ts:86`) | (a) removed with L6 (admin path retired in Stage 5); (b) retain; (c) retained behind ISSUE-316 (L4) | (b) is fail-closed with no consensus shortcut (`reconciliation.ts:19-22`: unresolved identity, foreign or indeterminate ownership and an independent-source conflict all refuse); it protects historical rows owned by `afltables` and stays after cutover |
| Direct Wikipedia-to-production automation | L10 | see L10 | no scheduler or runtime caller exists (guards a and e); new data only via proposals |
| Silent partial promotion | CSV promotion (L2): whole-submission savepoint (`pipeline.ts:483-600`), but a row whose statement matches nothing is counted rather than failed (`pipeline.ts:574`, AFLDB-ISSUE-307) | removed with L2 (Stage 5, done) | the only partial-in-effect promotion found; it is recorded in counters, not silent in the log, but it can leave a submission "promoted" with rows that changed nothing |
| | AFL API settle `--auto-apply`: per-unit savepoints (`settle-afl-api.ts:1128-1129`), refusals recorded in `canonical_applications`/`data_issues` and counters; `--require-complete-source` rolls the whole run back (`settle-afl-api.ts:1935`, :2070) | retain | partial by design and recorded, never silent |
| | V2 additions: curated award approval (migration 111, `@afldb/admin`) and Coleman derivation | — | both all-or-nothing: approval runs in one transaction, the derivation refuses the whole season |
| Broad admin-centre controls | CSV upload (L1), submissions (L2), current-season page: Squiggle/Kali refresh (L6), AFL Tables settle trigger (L5), AFL API ingestion switches (`current-season/actions.ts` :270-323), db-health rebuild prose (L11) | L1, L2, L5 and L6 retired in **Stage 5**; the AFL API ingestion switches stay on `/admin/current-season`; the db-health prose (L11) unchanged | Stage 5 adds the small read-only operations centre with separate audited mutation pages (`docs/v2/admin-operations.md`, ADR 0009) |

## 4. Legacy runtime modules and their known importers (guard c)

`LEGACY_RUNTIME_MODULES` = `src/lib/external-afl/current-matches.ts`,
`src/lib/external-afl/current-season-import.ts`, `src/lib/ingest/pipeline.ts`,
`src/lib/ingest/datasets.ts`, `src/lib/acquisition/settle-afltables.ts`,
`src/lib/acquisition/settle-trigger.ts`. Their direct importers outside those modules after Stage 5 (11 unique pairs, down from 18 at the
close of Stage 4; `KNOWN_LEGACY_RUNTIME_EDGES` in `tests/v2-module-boundaries.test.ts`). No importer
lies under `src/app/admin/**` except the two that read the settle-unit contract for the AFL API
units panel:

| Importer | Target | Owner of the edge |
|---|---|---|
| `legacy/offline/tools/current-season/update-current-season.ts:37` | `current-season-import.ts` | legacy/offline quarantine |
| `src/app/admin/current-season/AflApiSettleUnitsPanel.tsx:18` | `settle-trigger.ts` | retained: reads `SETTLE_UNITS` and the unit-key type, never `startSettleRun` |
| `src/app/admin/current-season/page.tsx:7` | `settle-trigger.ts` | retained: type-only import of the unit-key type |
| `src/lib/acquisition/settle-afl-api.ts:140` | `settle-afltables.ts` | V2-GAP-012 (shared settle helpers) |
| `src/lib/acquisition/settle-report.ts:53` | `settle-afltables.ts` | V2-GAP-012 |
| `src/lib/acquisition/settle-status.ts:33` | `settle-trigger.ts` | ISSUE-316 (status reads; read by the operations centre) |
| `tools/current-season/settle-afltables.ts:58` | `settle-afltables.ts` | ISSUE-316 (L4) |
| `tools/db/afl-api-identity-correction-rehearsal.ts:101` | `settle-afltables.ts` | offline rehearsal tooling |
| `tools/db/prepare-promotion-source.ts:66` | `settle-afltables.ts` | offline promotion tooling |
| `tools/db/promotion-source-dependency-rehearsal.ts:106` | `settle-afltables.ts` | offline rehearsal tooling |
| `tools/records/import-first-kick-goal.ts:78` | `datasets.ts` | offline records import (L10) |

The AFL API settle (`settle-afl-api.ts:134-140`) imports shared helpers and constants
(`automaticProposalUnderAuthority`, `scopeProposalToAuthority`, `PLAYER_MATCH_STAT_COLUMNS`,
`CANONICAL_APPLY_ISSUE_OWNER`, `CANONICAL_APPLY_ISSUE_TYPE`) from `settle-afltables.ts`, and
`settle-report.ts:46-53` imports the settle issue keys, `MATCH_TARGET_TABLES` and
`SETTLE_SOURCE_KEY` from it. That is a code dependency on the module, not a data dependency on AFL
Tables; it prevents quarantining `settle-afltables.ts` until the helpers move to a source-neutral
module (V2-GAP-012).

## 5. Tables written by legacy runtime paths after the disposition

From the Stage 4 writer census (`.phaneslight/returns/launchC-20261019/03-mechanic-M2-table-writers.md`
§3, spot-checked by the orchestrator). The legacy runtime paths still present in V2 write:

- **AFL Tables settle (L4/L5, behind ISSUE-316):** `staging.afltables_match`,
  `staging.afltables_player_match`, `promotion_candidates`, `import_rejections`, `import_batches`;
  through the shared `canonical-apply.ts`/`settle-core.ts`/`observation-store.ts`: `matches`,
  `match_period_scores`, `player_match_stats`, `canonical_applications`, `data_issues`, the
  observation spine; through the derived recompute: `seasons`, `club_seasons`, `players`,
  `player_career_stats`, `player_club_season_stats`, `player_clubs`.
- **Squiggle/Kali admin refresh (L6):** wrote `staging.external_current_matches`,
  `import_batches` and the observation spine. **Ended in Stage 5**: the action refuses.
- **CSV upload/submission/email intake (L1-L3):** wrote `data_submissions`,
  `data_submission_rows`, `import_batches`; on promotion `matches`, `player_match_stats`,
  `players`, `award_winners`, `award_nominations`. **Ended in Stage 5**: the route and actions
  refuse; the email-intake timer still posts to a route that answers 410 (V2-GAP-013).

So the answer to the ownership matrix's open question "no table is written by a legacy runtime
path after the disposition" is still **not yet**, now only because of the AFL Tables settle (L4),
which ends when the ISSUE-316 cutover retires it. Until then it is listed, guarded by the ratchet,
and the production go/no-go stays no-go (V2-GAP-011, and V2-GAP-013 until the timer is off).
