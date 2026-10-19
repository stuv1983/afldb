# AFLDB V2 — legacy ingestion disposition matrix (plan D10, ADR 0010)

Status: implemented state at the close of Stage 4 (Launch C, 2026-10-19). Every legacy ingestion
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

## 2. How the classification is enforced (Stage 4)

`tests/v2-module-boundaries.test.ts`, over pure checkers in `packages/testing/src/module-boundaries.ts`:

| Guard | What it proves on the real tree | Negative control |
|---|---|---|
| a. scheduled references | no `package.json` script and no file under `deploy/` references `legacy/` | in-memory fake script |
| b. legacy import rule | nothing outside `legacy/**` imports `legacy/**` (src, tools, packages, deploy); the rule is not vacuous (the quarantined CLI exists) | fixture `src/app/admin/x.tsx` importing `legacy/offline/...` |
| c. legacy-runtime ratchet | the direct importers of `LEGACY_RUNTIME_MODULES` (§4) equal `KNOWN_LEGACY_RUNTIME_EDGES` exactly; a new edge or a vanished edge fails | probe importer adds an edge (19 -> 20 raw edges) |
| d. public runtime independence | the transitive import closure of the public web (`src/app/**` except `src/app/admin/**` and `src/app/api/admin/**`, plus `src/components/**`; 132 entry files) reaches no legacy runtime module and nothing under `tools/` or `legacy/` | probe chain `src/components/__Probe.tsx > src/lib/__probe_edge.ts > src/lib/ingest/pipeline.ts` |
| e. offline tools | nothing under `src/**` or `packages/*/src/**` imports `tools/{migration,rebuild,records,aflw,email_intake}/` or `legacy/` | probe files |
| f. retired entries | every `package.json` script that runs `tools/v2/retired-entry.ts <name>` names an entry of `RETIRED_ENTRIES` (`packages/domain/src/legacy-retirement.ts`), every entry is wired, and the CLI exits 1 with the refusal | spawned CLI; unknown name |

Plus `tests/current-season-import.test.ts` (F-001 assertions on the quarantined CLI).

## 3. The matrix

| # | Path(s) | Current callers (file:line) | Disposition | D10 class | Reason | Replaced by / Stage 4 change |
|---|---|---|---|---|---|---|
| L1 | CSV upload: `src/app/admin/upload/page.tsx`, `src/app/admin/upload/stage/route.ts` -> `src/lib/ingest/pipeline.ts` `stageSubmission` (:37) | admin page `upload/page.tsx:5` (imports `ingest/datasets.ts`); route `upload/stage/route.ts:4` (imports `pipeline.ts`), `POST` :40 behind `requireCapability('acquisition.legacyIntake')` :44 | remove-from-runtime (**Stage 5**) | replaced by curated admin entry | runtime must not depend on CSV; duplicate import screen | curated award proposals (D8, migration 111) and the audited data editor. Stage 4: classified, ratchet-listed; unchanged |
| L2 | CSV submission review and promotion: `src/app/admin/submissions/[id]/actions.ts` (`runValidation` :11, `decideSubmission` :38, `runPromotion` :94) -> `pipeline.ts` `promoteSubmission` (:483) -> `src/lib/ingest/datasets.ts` promoters | `submissions/[id]/actions.ts:7`; offline `tools/records/import-first-kick-goal.ts:78` imports `ingest/datasets.ts` | remove-from-runtime (**Stage 5**: the server actions refuse) | replaced by curated admin entry | direct CSV-to-final-table: writes `award_nominations` (datasets.ts:441), `award_winners` (:564), `matches` (:1275, :1937), `player_match_stats` (:1665), `players` (:1774) | curated proposals (awards) and the audited data editor (facts). The offline first-kick-goal import keeps using `datasets.ts` (retain-offline). Stage 4: unchanged |
| L3 | Email CSV intake: `deploy/afldb-email-intake.timer` (`OnUnitActiveSec=5min` :6) -> `.service:17` -> `tools/email_intake/fetch_and_stage.py` -> `POST src/app/api/admin/email-intake/route.ts` (:127; imports `pipeline.ts` at :8 and :12) | scheduler (timer); shared-secret route | remove-from-runtime (**Stage 5** route refusal; the timer is disabled by the cutover runbook, **Stage 6**) | removed from V2 | runtime must not depend on CSV; staging feeds the L2 promotion | nothing (corrections go through the audited editors). Stage 4: unchanged, because the fetcher is Python (not executable in V2) and disabling a timer is a deployment act. V2-GAP-013 |
| L4 | AFL Tables nightly settle: `deploy/afldb-settle-afltables.timer` (04:30, :13) -> `.service:35` -> `deploy/afldb-settle-afltables.sh` -> `tools/rebuild/fitzroy/acquire_core.R` -> `tools/migration/import_fitzroy_core.py` -> `tools/current-season/settle-afltables.ts` (:58 imports the library) -> `src/lib/acquisition/settle-afltables.ts`; `npm run settle:afltables` (`package.json:43`) | scheduler; package script; admin trigger (L5) | retain behind the ISSUE-316 boundary, then remove-from-runtime at the C4b cutover | retained temporarily behind a disabled compatibility boundary; then replaced by AFL API | the AFL Tables network register (`data/reference/afltables-network.json`, gates in `src/lib/acquisition/afltables-network.ts:36-62`) already makes every network path refuse once retired; retiring it is the owner's ISSUE-316 decision D-316-2, which V2 may not execute | AFL API pipeline (Stage 3). The shell script, trigger and register are frozen ISSUE-316 files (`D:\tmp\afldbV2-source-snapshot-20261019\changed-files.txt`). Stage 4: unchanged. **V2-GAP-011 (cutover blocker)** |
| L5 | AFL Tables settle admin trigger: `src/app/admin/current-season/actions.ts` `startSettleRunAction` (:167) -> `src/lib/acquisition/settle-trigger.ts` (frozen) | `current-season/actions.ts:20`, `page.tsx:9`, `AflApiSettleUnitsPanel.tsx:17`; `settle-status.ts:33` | remove-from-runtime (**Stage 5**) | retained temporarily behind a disabled compatibility boundary | the trigger already returns `unavailable` without calling systemctl when the register is retired | Stage 4: classified, ratchet-listed; unchanged |
| L6 | Squiggle / Kali refresh: `src/lib/external-afl/current-matches.ts` (HTTP), `src/lib/external-afl/current-season-import.ts` (`runCurrentSeasonRefresh`); CLI now `legacy/offline/tools/current-season/update-current-season.ts` | admin `current-season/actions.ts:12` (`runCurrentSeasonAdminAction` :51, `requireCapability('acquisition.currentSeason')` :55) and `page.tsx:11`; the quarantined CLI (:37); `current-matches.ts` has no importer outside `current-season-import.ts` | CLI: **quarantine** (done); package script: **remove-from-runtime** (done: `current-season:update` runs `tools/v2/retired-entry.ts` and exits 1); admin control and library: remove-from-runtime (**Stage 5**) | removed from V2 (the CLI kept as offline diagnostic evidence) | Squiggle and Kali are retired: AFLDB-ISSUE-122/128 made them staging and diagnostic only (writes `staging.external_current_matches` and the observation spine, never canonical rows) | AFL API (Stage 3). **F-001 fixed**: the CLI no longer defaults `--source` to `squiggle`; a refresh without `--source` refuses; `--report` still works |
| L7 | AFL Tables network register and rollover: `tools/db/rollover-season.ts` (frozen) writes `data/reference/afltables-network.json`; `src/lib/rollover/afltables-network-retirement.ts` | manual CLI | retain | — (it is the retirement mechanism for L4) | the register is how AFL Tables is switched off | Stage 4: unchanged |
| L8 | Offline rebuild families `tools/rebuild/{afltables,fitzroy,draftguru,afl_api}/**` | `tools/db/rebuild-test.ts` (the sealed historical rebuild; e.g. `import_draftguru.py`, `acquire_club_lists.R`, `acquire_coaches.py`, `validate_ladder_witness.py`); `acquire_core.R` also via L4 | retain-offline (in place) | retained as offline historical evidence | moving them would break the sealed historical rebuild (plan D10); three are frozen ISSUE-316 files (`afltables/acquire_club_lists.R`, `afltables/acquire_coaches.py`, `fitzroy/acquire_core.R`) | guard e proves no runtime import; no scheduler other than L4 |
| L9 | `tools/migration/*` importers (51 files) | `tools/db/rebuild-test.ts` invokes 21 of them (e.g. `import_fitzroy_core.py`, `import_awards.py`, `load_reference_data.py`, `rebuild_derived.py`); package scripts for the AFL API identity tools | retain-offline (in place) | retained as offline historical evidence | the historical rebuild depends on them; `import_legacy_afl.py` (legacy SQLite) is not used by the rebuild but is the only loader of that source, so it is kept | physical quarantine of Python/R tools deferred: V2 cannot execute Python/R to prove a moved script still runs (**V2-GAP-014**) |
| L10 | Wikipedia-derived enrichment ("direct Wikipedia-to-production automation"): `tools/migration/{after_siren,all_australian,captaincies,enrich_heights_wikipedia,family_siblings,father_son,hall_of_fame,honour_teams,named_medals}.py`, `import_awards.py`; `tools/records/import-first-kick-goal.ts` | `tools/db/rebuild-test.ts` (each referenced 1-20 times); `npm run records:first-kick-goal` (`package.json:52`); no timer, no admin button (guard a, guard e) | retain-offline (in place) for sealed historical seasons; **removed** as a path for new data | historical: retained as offline historical evidence; new seasons: replaced by curated admin entry | they reload sealed history and are never scheduled; for any new season Wikipedia may only feed a proposal | curated proposals (D8): `parseAwardProposalFile` (whole-file refusal) creates proposals only; approval is a separate, audited, transactional review |
| L11 | Derived rebuild `tools/migration/rebuild_derived.py` | manual; operator instructed at `src/app/admin/db-health/page.tsx:75` and `src/app/admin/submissions/[id]/page.tsx:140` | retain-offline | retained as offline historical evidence | recomputes derived tables for the sealed rebuild | Coleman: replaced by a derived calculation (`@afldb/derived` `deriveColeman`, ADR 0006); the admin prose pointing at the script is Stage 5's |
| L12 | AFLW staging `tools/aflw/load_staging.py` | manual | retain-offline | outside V2 scope | AFLW has its own model (V2-GAP-005) | unchanged |
| L13 | Audited admin editors (awards, Brownlow, coaches, draft, fixtures, season lists, leadership, special records, data editor, player links) | admin pages behind capabilities | retain (Stage 5 regroups them behind explicit capabilities) | — | they are the audited correction workflows (`docs/v2/historical-baseline.md` §2) | the curated award workflow (D8) reuses the award-winner create path inside its approval transaction |

### Cross-cutting items from the owner's list

| Item | Where | Disposition | Reason / evidence |
|---|---|---|---|
| Fragile multi-source reconciliation | (a) Squiggle vs Kali independence-group comparison, `src/lib/external-afl/current-season-import.ts:145`; (b) AFL API vs stored AFL Tables-owned rows, `src/lib/acquisition/afl-api-settle-plan.ts` over `src/lib/acquisition/reconciliation.ts`; (c) the AFL Tables settle's use of the same verbs (`settle-afltables.ts:86`) | (a) removed with L6 (Stage 5 for the admin path); (b) retain; (c) retained behind ISSUE-316 (L4) | (b) is fail-closed with no consensus shortcut (`reconciliation.ts:19-22`: unresolved identity, foreign or indeterminate ownership and an independent-source conflict all refuse); it protects historical rows owned by `afltables` and stays after cutover |
| Direct Wikipedia-to-production automation | L10 | see L10 | no scheduler or runtime caller exists (guards a and e); new data only via proposals |
| Silent partial promotion | CSV promotion (L2): whole-submission savepoint (`pipeline.ts:483-600`), but a row whose statement matches nothing is counted rather than failed (`pipeline.ts:574`, AFLDB-ISSUE-307) | removed with L2 (Stage 5) | the only partial-in-effect promotion found; it is recorded in counters, not silent in the log, but it can leave a submission "promoted" with rows that changed nothing |
| | AFL API settle `--auto-apply`: per-unit savepoints (`settle-afl-api.ts:1128-1129`), refusals recorded in `canonical_applications`/`data_issues` and counters; `--require-complete-source` rolls the whole run back (`settle-afl-api.ts:1935`, :2070) | retain | partial by design and recorded, never silent |
| | V2 additions: curated award approval (migration 111, `@afldb/admin`) and Coleman derivation | — | both all-or-nothing: approval runs in one transaction, the derivation refuses the whole season |
| Broad admin-centre controls | CSV upload (L1), submissions (L2), current-season page: Squiggle/Kali refresh (L6), AFL Tables settle trigger (L5), AFL API ingestion switches (`current-season/actions.ts` :270-323), db-health rebuild prose (L11) | disposition recorded here; the controls are **Stage 5**'s (plan D9) | Stage 4 builds no UI and changes no admin action |

## 4. Legacy runtime modules and their known importers (guard c)

`LEGACY_RUNTIME_MODULES` = `src/lib/external-afl/current-matches.ts`,
`src/lib/external-afl/current-season-import.ts`, `src/lib/ingest/pipeline.ts`,
`src/lib/ingest/datasets.ts`, `src/lib/acquisition/settle-afltables.ts`,
`src/lib/acquisition/settle-trigger.ts`. Their direct importers outside those modules (18 unique
pairs, 19 raw edges; `KNOWN_LEGACY_RUNTIME_EDGES` in `tests/v2-module-boundaries.test.ts`):

| Importer | Target | Owner of the edge |
|---|---|---|
| `legacy/offline/tools/current-season/update-current-season.ts:37` | `current-season-import.ts` | legacy/offline quarantine |
| `src/app/admin/current-season/AflApiSettleUnitsPanel.tsx:17` | `settle-trigger.ts` | Stage 5 |
| `src/app/admin/current-season/actions.ts:12` | `current-season-import.ts` | Stage 5 |
| `src/app/admin/current-season/actions.ts:20` | `settle-trigger.ts` | Stage 5 |
| `src/app/admin/current-season/page.tsx:9` | `settle-trigger.ts` | Stage 5 |
| `src/app/admin/current-season/page.tsx:11` | `current-season-import.ts` | Stage 5 |
| `src/app/admin/submissions/[id]/actions.ts:7` | `pipeline.ts` | Stage 5 |
| `src/app/admin/upload/page.tsx:5` | `datasets.ts` | Stage 5 |
| `src/app/admin/upload/stage/route.ts:4` | `pipeline.ts` | Stage 5 |
| `src/app/api/admin/email-intake/route.ts:8`, `:12` | `pipeline.ts` | Stage 5 |
| `src/lib/acquisition/settle-afl-api.ts:140` | `settle-afltables.ts` | V2-GAP-012 (shared settle helpers) |
| `src/lib/acquisition/settle-report.ts:53` | `settle-afltables.ts` | V2-GAP-012 |
| `src/lib/acquisition/settle-status.ts:33` | `settle-trigger.ts` | ISSUE-316 / Stage 5 |
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
- **Squiggle/Kali admin refresh (L6, Stage 5):** `staging.external_current_matches`,
  `import_batches`, the observation spine.
- **CSV upload/submission/email intake (L1-L3, Stage 5):** `data_submissions`,
  `data_submission_rows`, `import_batches`; on promotion `matches`, `player_match_stats`,
  `players`, `award_winners`, `award_nominations`.

So the answer to the ownership matrix's open question "no table is written by a legacy runtime
path after the disposition" is **not yet**: these writes end when Stage 5 removes the admin paths
and the ISSUE-316 cutover retires L4. Until then they are listed, guarded by the ratchet, and the
production go/no-go stays no-go (V2-GAP-011).
