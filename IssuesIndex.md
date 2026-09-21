# AFLDB Current Issues Index

> Lightweight session index of open issues only.
>
> `issues.md` is the authoritative detailed ledger.
>
> Runbooks live under `issues/`, not at the repository root: `issues/open/<ISSUE-ID>.md` while
> the issue is open, `issues/closed/<ISSUE-ID>.md` once it is resolved, together with any
> `-HANDOFF.md` companions and evidence artefacts. Historical entries below name a runbook by
> filename only; resolved ones are in `issues/closed/`.

**Open issues:** 5

### AFLDB-ISSUE-228 — AFL.com.au official JSON APIs as the current-season match, stats and Brownlow source
- **Severity:** Medium. **Area:** data acquisition / import architecture — `afl_api` source,
  migration 074 spine, ISSUE-122 automatic path, `external_identities`, Brownlow round votes.
- **State:** Open (2026-09-19; status updated 2026-09-21). **Merged to main and deployed to DEV**
  (commit `bbf87566`; migration 103 applied; DEV health/smoke PASS; no AFL API timer enabled;
  Brownlow flag not enabled; PROD untouched). During DEV acceptance the operator found a missing
  operational capability — no super-admin UI control to enable/disable AFL API current-season or
  Brownlow ingestion — and **paused S9 before any real-feed write** pending that control. This is
  being added now (see `issues.md` "operational-control gap found during DEV acceptance" paragraph
  for the full architecture: two new fail-closed `site_settings` switches, enforced inside every
  acquire/settle CLI itself, admin panel on `/admin/current-season`); **not yet enabled, S9 still
  not resumed.** Plan approved (Q1/Q2/Q7 decided).
  **S1–S6 COMPLETE. Historical Brownlow §9.10 CLOSED/PASS for 2022–2025. S8 (operations)
  operator-validated COMPLETE 2026-09-21** (`tsc --noEmit` PASS; `tests/admin-current-season-settle.test.ts`
  38/38 PASS; both `.sh` unit scripts PASS `sh -n`; systemd safety inspection PASS; the
  live-runbook write-target guard defect found in inspection is now fixed and re-verified via
  `SELECT current_database() = 'afldb_test'`; no DEV/PROD deployment). **S7 remains OPEN** — the
  sole remaining acceptance item is the real 2026 Brownlow live-count capture/replay evidence.
  **S9 NOT STARTED** (needs a later DEV dry-run/apply, AFL Tables corroboration and Brownlow
  replay after S7/S8). **Assertion 9 (§9.9) remains SKIPPED/open**, explicitly separate from the
  Brownlow live-count replay — see the S8/§9.10 paragraphs below for full evidence.
  **S9 update, 2026-09-21 (same day):** first real 2026 acquisition PASS on DEV (snapshot
  `afl-api-2026-2026-09-21-011148`, 217 CONCLUDED matches); `--validate-only` BLOCKED by one
  measured schema-contract drift (`playerStats.stats.extendedStats` null on exactly one of 9,983
  player-match rows, undeclared as its own parent path). Root cause confirmed; minimal fix applied
  to `data/reference/source-families.json` (known-but-not-required) plus four regression tests in
  `tests/afl-api-match.test.ts` — see `issues.md` "S9 real-feed schema drift" paragraph. Fix was
  UNVALIDATED/UNDEPLOYED at the time; now **LOCALLY VALIDATED 2026-09-21** (see "S9 — LOCAL
  VALIDATION COMPLETE" below); still UNDEPLOYED; no DB/Git/deployment command run; S9 has not
  resumed past `--validate-only`.
  **Documentation pass, 2026-09-21 (documentation-only; no code/test/migration/DB/Git command
  run):** `docs/acquisition/AFLDB-2026-API-ACQUISITION.md` §14 is now the canonical
  architecture/operator entry point for the complete AFL.com.au direct-API integration
  (provider access, the acquire→settle pipeline, ownership/corroboration/attendance, the
  migration-103 database model, identity resolution, admin controls, systemd operation, verified
  manual commands, the Brownlow pipeline, safety, source-to-source reconciliation, acceptance
  criteria and known limitations), linking to
  `docs/acquisition/AFLDB-2026-BROWNLOW-LIVE-COUNT-RUNBOOK.md` for the live-count procedure. Two
  stale/incorrect claims were corrected in the process: the R1–R28 ownership-count evidence is
  canonical-ownership partitioning, not source-to-source reconciliation; and the earlier
  "AFL API enriches AFL-Tables-owned attendance" direction is backwards — `afl_api` never
  proposes/enriches attendance on any path, and the one real enrichment direction is `afltables`
  attendance into an `afl_api`-owned match (see `issues.md`'s "operational-control gap" paragraph
  for the original audit these corrections are sourced from). No ISSUE-228 stage status changed
  by this pass.
  **Settle-CLI gate follow-up, 2026-09-21 (test-only; no runtime defect, no
  migration/DB/Git/deployment command run):** a final follow-up review found a BLOCKER — no test
  drove the fail-closed ingestion gate at the three settle CLI wrappers themselves
  (`runAflApiSettleCli`, `runAflApiFixturesSettleCli`, `runAflApiBrownlowSettleCli`), only the
  gate primitives and lower-level settle functions. New `tests/afl-api-settle-cli-gate.test.ts`
  (DB-free/network-free, via injected `ingestionControls` and a stub that throws the instant the
  settle DB path is touched) now covers all three wrappers' write-capable-mode refusals,
  validate-only/report exemptions, the Brownlow two-key combinations, and one real fail-closed
  `readAflApiIngestionControls({})` result reaching a wrapper. No runtime code changed. **S9
  remains paused, S7 remains open, Assertion 9 remains separately open, PROD remains untouched.**
  **S9 regression-test correction, 2026-09-21 (test-only; no production code, migration, DB, Git or
  deployment command run):** operator rerun of the S9 schema-drift fix found `tsc --noEmit` PASS,
  `tests/reference-data.test.ts` 51/51 PASS, and `tests/afl-api-match.test.ts` 120/121 PASS with one
  new regression assertion wrong, not a contract failure — the first new S9 test asserted the
  aggregate `observedColumns` set must exclude `playerStats.stats.extendedStats.effectiveKicks`,
  but that set is formed across both home and away player stats and the unmutated away-side fixture
  legitimately still contributes that path (already proved non-redundant by the block's third test).
  Fixed by removing only that incorrect negative assertion; the bare-parent-path positive assertion
  is kept. No production code or `source-families.json` changed. **S9 remains stopped before any DB
  dry-run.** Correction was UNVALIDATED pending operator rerun at the time; now **LOCALLY VALIDATED
  2026-09-21**. Full detail: `issues.md` "S9 regression-test correction" and "S9 — LOCAL VALIDATION
  COMPLETE" paragraphs.
  **S9 — LOCAL VALIDATION COMPLETE, 2026-09-21 (operator-run; no test/tsc/DB/Git/network/deployment
  command run by the assistant):** combined focused validation of the schema-drift fix and the
  regression-test correction now PASSES in full — `npx tsc --noEmit` PASS; `tests/afl-api-
  match.test.ts` 121/121 PASS; `tests/reference-data.test.ts` 51/51 PASS; combined 172/172 PASS;
  `git diff --check` PASS; worktree contains exactly the four expected modified files, no
  unexpected untracked files. The earlier 120/121 rerun (one incorrect regression-test assertion)
  is preserved as evidence, not overwritten. **No DB dry-run has occurred; no deployment of this
  fix has occurred yet; S9 remains OPEN and stopped before any DB dry-run.** Next sequence: commit/
  push → exact-SHA DEV deploy → reuse the SAME immutable snapshot
  `afl-api-2026-2026-09-21-011148` → `--validate-only` must give 217 match units / 0 build
  failures → only then a DB dry-run is considered. Brownlow/S7 untouched; Assertion 9 remains
  separately open; PROD untouched. Full detail: `issues.md` "S9 — LOCAL VALIDATION COMPLETE"
  paragraph.
  **DEV acceptance defect found and fixed, 2026-09-21 (code fix + tests only; no DB/migration/
  Git/deployment command run):** enabling AFL API current-season ingestion on DEV showed
  "enabled" immediately but reverted to "Disabled" on a hard refresh. Root cause:
  `readAflApiIngestionAdminView()` (`src/app/admin/current-season/actions.ts`) compared the raw
  `site_settings.value` row with a bare `=== true`; jsonb arrives as raw TEXT on this project's
  postgres.js client, so a stored `true` reads back as the string `'true'`, which never matches —
  the write (`writeIngestionSwitch`) and the enforcement read
  (`readAflApiIngestionControls`, which already used `parseSiteSettings()`) were both correct the
  whole time; only this one admin-view read was broken, matching the exact "saving changes
  nothing" hazard `fromStore()` documents. Fixed by routing the read through
  `parseSiteSettings()`, the same established pattern `getSiteSettingsForAdmin()` uses. New
  regression coverage in `tests/admin-current-season-settle.test.ts` simulates the raw-text jsonb
  round trip so a reintroduced bare `=== true` fails the same way again. **S9 remains paused, S7
  remains open, Assertion 9 remains separately open, Brownlow untouched, PROD untouched.**
  See `issues.md` for full detail. All work is
  uncommitted, branch `sonnet/issue-228`. Implementation history (Sonnet 5, same worktree) —
  **Stages S1, S2, S3 done, all uncommitted** —
  S1: round-table shape + `co_source_groups` added to `source-families.ts`/`.json`,
  `afl-api-rounds.ts` (`translateAflRound()`, five typed refusals), `afl-api-identities.json`
  (18 clubs, 5 seasons, 2 venues), DB-free tests. S2: `afl-api-client.ts` (request planning for
  WMCTok/season-matches/playerStats/matchRoster, three independently configurable base URLs
  with the CFS one redirectable to a future Brownlow simulator, retry+backoff, reissue-token-
  once-on-401/403) and `acquire-afl-api.ts` (manifest-LAST CLI, `cleanup_partial` pattern ported
  from `afldb-settle-afltables.sh`), DB-free tests with a stubbed fetch. WMCTok's `{ token:
  string }` shape and the `x-media-mis-token` header were operator-verified live 2026-09-19
  (no real token stored); the repo just lacks a sanitised fixture for it yet. S3:
  `afl-api-bundle.ts` (parse->resolve->project->bundle emitters for all five families — match,
  match_roster (deliberately narrowed/incomplete — two further payload widgets measured but out
  of scope), player_match_stats (documented duplicate-JSON-key quirk), brownlow_match_votes
  (§10 vote-set validation), brownlow_leaderboard), the DB-free backtest CLI
  (`tools/current-season/emit-afl-api-bundle.ts`, backtest manifest **not yet generated — needs
  an operator run**), hand-trimmed fixtures under `tests/fixtures/afl_api/`, new tests. The five
  `afl_api` families are now declared in `source-families.json`, anchored to real parsed output
  and cross-validated 2022-vs-2026/2025 by hand; `match_roster` stays `known_columns_status:
  'incomplete'`, the other four are `'complete'`. No DB/Git/network command run.
  S4: migration `103_afl_api_match_projections.sql` (three typed projections —
  `staging.afl_api_match`, `staging.afl_api_player_match`, `staging.afl_api_brownlow_vote` — plus the
  `afl_api` source description update and grants, following 076/077 conventions column-for-column)
  with its DB-free shape-gate test `tests/afl-api-match-migration.test.ts`. **Operator-executed and
  validated 2026-09-19**: DB-free suite 146/146 green, S3 corpus backtest green (12/12 round mapping,
  14/14 arithmetic/cumulative/idempotency, Brownlow 4/4), migration 103 applied clean to
  `afldb_test`. Production untouched, all still uncommitted.
  **S5 (player provider bootstrap bridge, §6.3) implemented 2026-09-20, OPERATOR-EXECUTED AND
  VALIDATED on `afldb_test` only.** `tools/migration/build_afl_api_player_bridge.py` (offline
  builder — reads the 14 tracked AFL API sample matches + `afldb_test` read-only, joins on
  club+jumper+exact core-stat-vector equality, accepts a `CD_I -> player_id` link only under
  §6.3(a)-(d)) produced `data/reference/afl-api-player-bridge-2026-09-20.json`: 14 sample matches,
  12 resolved, 400 providers observed, **398 linked (99.5% coverage), 2 unresolved
  (`CD_I1002231`/Patrick Naish, `CD_I999724`/Declan Mountford — deliberately withheld, not
  contradictions), 0 contradictory**; 2 sample matches (`CD_M20260142801`, `CD_M20260142802`)
  skipped `no_canonical_match`, contributing no evidence. `tools/migration/import_afl_api_player_bridge.py`
  (`--validate-only`/`--dry-run`/`--apply`, the only writer of `external_identities` for `afl_api`)
  ran validate-only, dry-run, apply and a post-apply dry-run against `afldb_test` (via the
  established SSH tunnel, 127.0.0.1:55432): the post-apply dry-run reproduced
  `linked 0 / already_linked 398 / contradictions_withheld 0` unchanged, proving idempotency. DB-free
  contract test `tests/python/afl_api_bridge_contract.py` (all checks) plus the builder/importer runs
  are the full S5 validation sequence; S5 is now complete per its own gate. Production/DEV untouched.
  **S6 (2026-09-20) — read-only plan, writer, CLI and a closure/hardening pass, all
  implemented, NOT operator-validated (CLAUDE.md §9: assistant ran no test/tsc/DB/Git command).**
  `settle-afl-api.ts` (`runSettleAflApi()`) composes identity/resolution/corroboration
  (`afl-api-settle-plan.ts`) into `applyCanonicalUnit()`, drafts `promotion_candidates` directly,
  writes the migration-103 typed projections, runs the §7.5(Q2) attendance-enrichment sweep;
  `tools/current-season/settle-afl-api.ts` mirrors `settle-afltables.ts`'s CLI contract.
  Closure pass fixed three real bugs: (1) §19.1(e) — every shared canonical UPDATE
  (`canonical-apply.ts`) was setting `source_id` in its `SET` list (never to a different value,
  since E3 already blocks a foreign-owned UPDATE, but the acceptance test is a literal source
  scan) — added `provenanceForUpdate()`, used on all four UPDATE writers; (2) the afl_api CLI's
  `--report` and post-apply report were querying **AFL Tables'** batches/candidates by default
  (no `sourceKey`/`tool` override) and could never show afl_api's own corroboration
  disagreements (hardcoded AFL-Tables issue_type/owner) — `buildSettleExceptionReport()` gained
  override params, the afl_api CLI now passes its own, and the report header no longer says "AFL
  Tables" for every source; (3) a write-failure (e.g. a unit-local constraint collision) was
  correctly isolated to its own savepoint but never surfaced as a finding — `applyUnitOutcome()`
  now writes the same `canonical_apply_failed` finding `settle-afltables.ts` does. Two gaps left
  deliberately OPEN (neither is a literal §19 item): the ISSUE-131 rekey SEARCH stays disabled
  for `afl_api` (unsafe to enable without test capability to verify `rekey_would_merge`/
  `rekey_ambiguous` fail-closed for its identity shape); the `match`-family absence sweep has no
  implementation (needs a season-enumeration-completeness concept the AFL API bundle does not
  yet carry). Full detail: `issues.md` "S6 closure pass" paragraph. **S6 core path
  OPERATOR-VALIDATED 2026-09-20** (per operator evidence: `tsc --noEmit` clean;
  `tests/integration/settle-afl-api.test.ts` 5/5; `tests/current-season-import.test.ts` 258
  passed/4 skipped; `tests/integration/settle-afltables.test.ts` 64 passed/1 expected skip,
  unregressed by the shared canonical-apply §19.1(e) fix); the two S6 gaps above remain open by
  design and do not block S7.
  **S7 (Brownlow, §10) implemented 2026-09-20, UNEXECUTED — no test/tsc/DB/Git command run by the
  assistant (CLAUDE.md §9).** New `src/lib/acquisition/afl-api-brownlow.ts`: match resolution off
  the already-settled `staging.afl_api_match` row (never a fresh bundle — the bfawards feed
  carries no home/away/date), `translateAflApiBrownlowRound()` (new export in
  `afl-api-rounds.ts`, defensive non-H&A refusal), per-player resolution via the S5 bridge, and
  `applyAflApiBrownlowVoteSet()` — one match's 3 votes applied inside ONE extra `tx.savepoint()`
  layer, all-or-none (§10), reusing `applyCanonicalUnit()`/`brownlow_round_votes` unchanged.
  Independently enable/disableable (`AFLDB_AFL_API_BROWNLOW_ENABLED`, default OFF) with a
  `--observe-only` mode, matching §10's operational-enablement decision. New CLIs
  `acquire-afl-api-brownlow.ts` / `settle-afl-api-brownlow.ts`
  (`npm run acquire:afl-api-brownlow` / `settle:afl-api-brownlow`). Registry
  `brownlow_match_votes.promotion_policy` flipped `not_yet_declared` -> `reviewed`. DB-free tests
  in `tests/afl-api-brownlow.test.ts` (round translation, enable-flag, leaderboard reconciliation
  advisory/blocking). Deliberately deferred, documented not silent: no
  `staging.afl_api_brownlow_vote` projection write, no `brownlow_leaderboard` spine persistence,
  no promotion_candidates queue for Brownlow, and the ISSUE-113 season-artefact builder
  (`build_brownlow_season_artefact_from_afl_api.py`) is not built this pass — none of the four are
  needed to write correct canonical votes or to reconcile against the leaderboard. Full detail:
  `issues.md` "S7" paragraph.
  **S7 pre-count contract bug fixed 2026-09-20** (operator's first acceptance run against the
  simulator): an empty `matchVotes: []`/`leaderboard: []` pre-count publication was wrongly
  refused as "missing required column(s)" — `flattenObservedColumns()` contributes no path for an
  empty array, but the shared `assertProjectableColumns()` gate assumed a family's required
  columns are always observable. Fixed with an opt-in `requireColumns` flag on
  `assertProjectableColumns()`/`projectFamily()`, defaulted `true` (every other family/caller
  unaffected), set `false` only when the Brownlow collection itself is empty; per-record
  strictness for an actual published vote/leaderboard entry is unchanged. Full detail: `issues.md`
  "S7 pre-count contract bug fixed" paragraph.
  **S7 one-match acceptance run finding (2026-09-20):** `unknown_match` on the operator's simulator
  run was root-caused as a real sequencing gap, not a resolver defect — `resolveAflApiBrownlowMatch()`
  needs the match family's own `staging.afl_api_match` row, which only exists once
  `settle-afl-api.ts --apply` has run for that match's season. Full match/roster/stats acquisition
  is unavailable for ~204 of the 207 real 2025 Brownlow matches (simulator evidence audit), so a
  **fixture-only identity prerequisite** was added the same day: `acquire-afl-api.ts
  --fixtures-only` (season fixture feed only, no CFS token, no playerStats/matchRoster, writes to
  a separate `data/sources/afl_api/fixtures/<label>/` tree so the full settle CLI structurally
  cannot mistake it for a complete snapshot); `src/lib/acquisition/afl-api-fixture-identity.ts`
  (new) persists ONLY the `match` family's own spine observation (never
  `staging.afl_api_match` — its `match_date` needs a `match_roster` capture this mode never
  acquires) and read-only-resolves a provider match id to an EXISTING canonical `matches` row by
  `(season, translated round, home club, away club)` — 0 hits `unknown_match`, >1
  `fixture_identity_ambiguous`, never a guess; new CLI `settle-afl-api-fixtures.ts`
  (`npm run settle:afl-api-fixtures`); `resolveAflApiBrownlowMatch()` gained an OPTIONAL
  `fixtureIdentityFallback` parameter (undefined by default — every existing caller's behaviour is
  byte-identical), activated operationally via `settle-afl-api-brownlow.ts --use-fixture-identity`.
  No migration; no change to the normal full-acquisition/settle contract; the writer has no code
  path that can create/re-own a canonical match. UNEXECUTED — no test/tsc/DB/Git command run by
  the assistant. New tests: DB-free in `tests/afl-api-match.test.ts` (acquisition never requests
  WMCTok/playerStats/matchRoster with the flag; `buildAflApiFixtureRecords()`), new
  `tests/integration/settle-afl-api-fixtures.test.ts` (spine-only persistence and I1 idempotency,
  resolve/unknown/ambiguous/no-write outcomes, the Brownlow fallback on and off, end-to-end via
  `runSettleAflApiBrownlow`, ownership never transferred, no duplicate canonical match). Full
  detail: `issues.md` "S7 fixture-only identity prerequisite" paragraph.
  **Two test-harness defects fixed 2026-09-20 (operator validation run, same day):** a `tsc` error
  (a `let` counters variable reassigned inside the `sql.begin()` closure, fixed by mutating a
  pre-existing `const` in place — matching `runSettleAflApi()`'s own working pattern) and a broken
  integration-suite cleanup (`canonical_applications` has no `target_id` column; the failing delete
  left synthetic canonical matches behind across tests, causing the reported
  `unknown_match`/`fixture_identity_ambiguous` cascade). **No production resolver defect** — neither
  `afl-api-fixture-identity.ts` nor `afl-api-brownlow.ts` was changed. Full detail: `issues.md`
  "two test-harness defects fixed" paragraph.
  **Real-feed follow-up 2026-09-20 (216-fixture 2025 acquisition, batch 1680, 204 built/11
  failures):** the 11 failures were two genuine, previously-undeclared, OPTIONAL `afl_api.match`
  metadata fields (`prematch_label`, `sold_out` — measured string `'true'`) now declared in
  `known_columns` only (never required, never projected); reapplying the same immutable snapshot
  is proven safe by inspection (hash depends only on `hash_exclusions`, never `known_columns` — the
  204 already-persisted observations head-refresh unchanged, the 11 newly-accepted ones persist as
  new records, no canonical/candidate writes either way). The 216→215 selection gap is
  `CD_M20250140807` (Sydney v GWS, R8 2025) — confirmed via tracked historical samples to be a REAL,
  concluded, Brownlow-voted match that the SIMULATOR misreports as `SCHEDULED`; the selection
  contract is correct and unweakened (never overrides a provider-reported status), with a
  no-code-change workaround (`--match CD_M20250140807`) and a simulator-gap report recommended to
  Codex. Full detail: `issues.md` "real-simulator-feed follow-up" paragraph.
  **2026-09-20 (second pass):** fixed a stale `tests/reference-data.test.ts` expected-promotable-
  list assertion (missing `afl_api/brownlow_match_votes`, which S7 already correctly flipped to
  `reviewed`; the registry itself was not touched). Documented, not fixed: 4/215 fixture-only
  fixtures (2025 Round 25 "FW1" qualifying/elimination finals) refuse `finals_label_required`
  because 2025's finals-naming field is `metadata.prematch_label`, not the
  `metadata.finals_match_label` round translation currently reads — out of scope (Brownlow
  structurally excludes finals) and does not block the other 211 fixture-only observations
  (per-record build-failure isolation, unchanged). Full detail: `issues.md` "stale registry-
  promotion test fixed" paragraph.
  **S5b (2026-09-20, operator's 2025 Brownlow identity census follow-up) — designed, implemented
  AND OPERATOR-EXECUTED/VALIDATED on `afldb_test`.** The operator's complete 2025 Brownlow census
  (188 distinct provider players) found `trusted_resolved: 127`, `no_external_identity: 61`, 0
  ambiguous/contradiction/other. Root-caused by inspection (no DB query needed): S5's stat-vector
  bridge only ever observes a provider id appearing in the 14 tracked sample matches under
  `data/sources/AFLWebsite/AFLGamesSamples/`, of which only 3 are 2025 matches; the 61 missing
  providers (cross-referenced from the tracked, immutable `01-brownlow-season.raw.json`/
  `05-leaderboard.csv` capture against the 400-provider S5 artefact, Josh Kelly `CD_I296347`
  confirmed absent by direct inspection) simply never appear in any of the 14 sample matches — not
  a resolver or writer defect, matching the operator's own conclusion.
  `tools/migration/build_afl_api_brownlow_name_bridge.py` (offline, read-only) proposes candidates
  for the still-unresolved population (recomputed live against `external_identities` every run,
  never a hardcoded list) using a deliberately WEAKER, separately-labelled evidence class — unique
  normalised (given_name, surname) match within the canonical season-2025 club roster of the
  provider's Brownlow-vote team — under its own `match_method =
  'afl_api_name_team_season_bootstrap'`, never conflated with S5's exact
  `afl_api_stat_vector_bootstrap`. `tools/migration/import_afl_api_player_bridge.py` generalised
  (smallest change: `ALLOWED_MATCH_METHODS` in place of one hardcoded constant; writes each
  artefact's own declared `match_method`, not a fixed one) to accept either class through the same
  fail-closed validate-only/dry-run/apply path, unchanged otherwise. `tests/python/
  afl_api_bridge_contract.py` extended with DB-free checks for both.
  **Operator-executed 2026-09-20 (evidence recorded here, superseding the paragraph above's
  "nothing has been run" status): the DB-free contract test passed; the builder
  (`build_afl_api_brownlow_name_bridge.py --validate-only` then `--write`) produced
  `data/reference/afl-api-brownlow-name-bridge-2026-09-20.json` — 61/61 linked, 0 unresolved, 0
  ambiguous, 0 contradictory; the importer (`import_afl_api_player_bridge.py --validate-only` /
  `--dry-run` / `--apply`) applied all 61 links to `afldb_test` as durable `external_identities`
  rows (`match_method = 'afl_api_name_team_season_bootstrap'`), the existing S5 links untouched.
  The follow-up 2025 Brownlow identity census then showed 188/188 provider players
  identity-resolvable and 207/207 vote sets identity-resolvable (up from 127/188 and the
  105-refusal state the S5 artefact alone left), and the full 2025 canonical-equality audit
  subsequently passed: 621 source positive rows, 621 canonical positive rows, 0 identity
  failures, 0 match failures, 0 vote mismatches, 0 round drift.** No production, DEV or Git
  command was run by the assistant at any point in S5b (CLAUDE.md §9); every DB-touching step was
  operator-executed against `afldb_test` only. **Consequence for the S7 season-artefact builder**
  (`build_brownlow_season_artefact_from_afl_api.py`): a `--validate-only` run against the S5
  artefact alone (398/400 providers) necessarily under-resolves any 2025 vote set naming one of
  the 61 S5b-only providers; the builder now accepts a repeatable `--bridge` flag so both trusted
  artefacts can be supplied together (`load_bridges()`, fail-closed union, provenance-tracked) —
  see `issues.md` "AFL API Brownlow season-artefact builder identity-union fix" for that change.
  **S7 completed-season Brownlow backtest authority (2026-09-20) — implemented, UNEXECUTED
  (CLAUDE.md §9: assistant ran no test/tsc/DB/Git command).** Operator's proven 2025 one-match
  Brownlow simulator capture (207 vote sets, 621 rows, 188 voters all trusted-resolved) plans but
  is correctly refused `season_not_in_progress` by E2 because `seasons.json` declares only 2026
  in progress. Added a narrow, `afldb_test`-only bypass of E2 alone, for the
  `brownlow_round_votes` write of one Brownlow settle run: `requireAflApiBrownlowBacktestDatabase()`
  proves the LIVE connection's `current_database()` is exactly `afldb_test` (never the DSN string
  or a hostname guess — the `tools/db/promotion-check.ts` `gateIdentity` convention) and returns
  an `AflApiBrownlowCompletedSeasonBacktestAuthority`; `runSettleAflApiBrownlow()` accepts it as
  `completedSeasonBacktestAuthority` and widens `inProgressSeasons` by the run's own resolved
  season ONLY inside the one `applyAflApiBrownlowVoteSet()` call site — `canonical-apply.ts`
  itself is untouched, `seasons.json` is untouched, no other target/gate is affected. New CLI flag
  `--allow-completed-season-backtest` on `tools/current-season/settle-afl-api-brownlow.ts`, refused
  without both the flag and the live `afldb_test` proof, harmless without `--apply`/`--auto-apply`.
  Full detail, exact operator commands and expected counts: `issues.md` "S7 completed-season
  Brownlow backtest authority" paragraph.
  **S7 canonical round-selection correction (2026-09-20, operator's corrected 2025 Round-24
  diagnosis) — implemented, UNEXECUTED (CLAUDE.md §9: assistant ran no test/tsc/DB/Git command).**
  Root cause: `planAflApiBrownlowMatchSet()` wrote `brownlow_round_votes.round_number` from
  `translateAflApiBrownlowRound()`'s TRANSLATED PROVIDER ROUND, never from the already-resolved
  canonical match's own `round_number` — wrong for a rescheduled/postponed fixture, where AFLDB's
  `matches.round_number` preserves the ORIGINAL assigned round (`admin-fixtures.ts`'s
  `rescheduleFixture()` only ever moves date/time; a round change is the separate, audited
  `changeFixtureRound()`) while the Brownlow feed groups a postponed match's votes under whichever
  week it was actually played. Two real 2025 matches expose it (Gold Coast v Essendon's rescheduled
  Opening Round fixture and Brisbane v Geelong's), and one player (Matt Rowell) legitimately holds
  two different round-24-labelled votes in two different matches that the old
  `(player_id, translated round)` keying collapsed into one, silently overwriting one vote. Fix:
  `AflApiBrownlowMatchResolution` now carries the resolved match's own `roundNumber` (read fresh
  from `matches`, S7's `resolveAflApiBrownlowMatch()`/`readMatchRoundNumber()`); the plan's
  `canonicalRoundNumber` (the write target) is now that value, never the translated round, which is
  retained as `providerTranslatedRound` for validation (home-and-away/finals refusal, unchanged) and
  observability only. A new `rescheduled`/`voteSetsRescheduledRound` flag/counter makes every such
  disagreement observable, never hidden — never a date-based heuristic: the distinguishing evidence
  is the already-independently-proven canonical match identity (provider id / match_key / retired
  identity, unchanged gates) that `resolveAflApiBrownlowMatch()` already required before this fix
  existed. `match_id` (nullable since migration 094, not yet written by this family) was NOT
  promoted into this pass — round_number alone already disambiguates per AFLDB's own fixture
  invariants (a club plays each declared round exactly once per season), and populating `match_id`
  touches shared `canonical-apply.ts`; reported to the operator as a low-risk, recommended follow-up
  rather than auto-applied (out of scope for "smallest safe correction"). The read-only 2025
  canonical-equality audit (`audit-afl-api-brownlow-canonical-equality.ts`) was corrected the same
  way: it now keys by `(player_id, canonical match_id)`, resolved via the same
  `resolveAflApiBrownlowMatch()`, never by round number, with new "legitimate reschedule" and
  "round_number drift" report sections. New/changed tests: `tests/afl-api-brownlow.test.ts`
  (`voteSetsRescheduledRound` counter shape); `tests/integration/settle-afl-api-brownlow.test.ts`
  (new case: a match staged under Opening Round whose Brownlow vote is deliberately submitted under
  a mismatched provider round — proves the write target is the match's own round, and that the same
  player voting under the same provider round in two different matches yields two distinct targets).
  Full detail: `issues.md` "S7 canonical round-selection correction" paragraph.
  **S7 snapshot-label collision fix (2026-09-20), implemented, UNEXECUTED — no test/tsc/DB/Git
  command run by the assistant (CLAUDE.md §9).** End-to-end Brownlow testing found two
  acquisitions inside the same live-count minute (`bad-vote-values` then `incomplete-vote-set`,
  both `afl-api-brownlow-2025-2026-09-20-1008`) generated the IDENTICAL label/directory: root
  cause was minute-only timestamp granularity in `buildAflApiBrownlowLabel()`/`buildAflApiLabel()`
  combined with `mkdirSync(dir, { recursive: true })`, which silently no-ops on an existing
  directory instead of refusing — so the second acquisition's raw files/manifest would silently
  overwrite the first's, destroying evidence (this DID reproduce for the reported pair; not yet
  operator-confirmed against a live run). Fix: both label builders now render seconds
  (`YYYY-MM-DD-HHMMSS`); new shared `claimSnapshotDir()` (`src/lib/acquisition/snapshot-dir.ts`)
  makes the collision impossible to miss — `mkdirSync(dir)` without `recursive` throws `EEXIST` on
  an existing directory before any file is written, and a deterministic `-2`, `-3`, ... suffix is
  appended and retried (fails closed after 1000 attempts) rather than reusing or overwriting an
  existing snapshot. `acquire-afl-api.ts` and `acquire-afl-api-brownlow.ts` both now claim via this
  primitive (the same code path covers `--fixtures-only`); `main()` in both tools now targets
  partial-failure cleanup at the exact directory an `onSnapshotDirClaimed` callback reports, rather
  than recomputing the label a second time (which could mismatch a collision-suffixed label).
  Neither tool's `manifest.json`/settle side ever parsed a season or timestamp out of the label
  string — it is an opaque directory name throughout, and no `--label` CLI contract changed. Tests
  added: `tests/afl-api-brownlow-acquire.test.ts` (new — distinct labels/paths at an identical
  mocked second, pre-existing-directory refusal, manifest/payload correspondence, unsuffixed
  single-acquisition label, cleanup targets only the run's own claimed directory); collision/
  pre-existing-directory/`--fixtures-only` cases added to `tests/afl-api-match.test.ts`; its
  `buildAflApiLabel` literal updated for the new `HHMMSS` format (not a weakening — same
  contract, wider granularity). Full detail: `issues.md` "S7 snapshot-label collision fix"
  paragraph.
  **S7 completed-season Brownlow season-artefact builder (2026-09-20) — implemented, UNEXECUTED
  — no test/DB/Git command run by the assistant (CLAUDE.md §9).** The frozen S7 deliverable row
  (§16) named `tools/migration/build_brownlow_season_artefact_from_afl_api.py`; it did not yet
  exist. New offline, DB-write-free builder: verifies an AFL API Brownlow snapshot's manifest
  hashes, re-parses/re-validates `matchVotes`/`leaderboard` (3-2-1 vote-set integrity, no
  duplicate player/match, integral counts) independently in Python (cannot import the TS
  emitters), refuses unless BOTH feeds report `status = 'CONCLUDED'`, reconciles reconstructed
  per-player totals against the leaderboard (blocking on any mismatch), resolves every voting
  player through the Stage S5 bridge's `linked` rows only (a single unresolved/ambiguous identity
  refuses its WHOLE match's 3-row set, mirroring §10 all-or-none; any refusal anywhere refuses the
  WHOLE BUILD, mirroring `import_brownlow_season.py`'s own "zero rejections or no write"), then
  reads `afldb_test` READ-ONLY (default `AFLDB_TEST_DATABASE_URL`, hard-pinned database name,
  same pattern as `build_afl_api_player_bridge.py`) for exactly two facts no tracked file carries:
  each resolved player's `afltables_profile_url` (`external_identities`) and their home-and-away
  games that season (`player_season_stats`, `SUM(games) - SUM(finals)`, the same table/formula
  `writeSeasonRows()` in `src/db/queries/admin-brownlow.ts` already uses for the manual
  publication path). Season-row derivation (`vote_rank`/`eligible_rank`/`is_winner`/
  `three_vote_games` etc.) is a faithful Python port of `competitionRanks()`/`deriveSeasonRows()`
  in `src/lib/brownlow/entry.ts` — the measured (ISSUE-155 preflight P13), already-in-production
  convention — rather than the AFL API leaderboard's own `totalVotes`/`winner` fields, which are
  used only as the advisory/blocking reconciliation witness. **Deliberate scope/format decision,
  reported for operator confirmation, not a guess:** the season artefact carries no round column
  at all (`brownlow_season_votes` has none), so no match/round resolution happens here and the
  ISSUE-228 round-reschedule correction cannot regress this artefact by construction. Output is
  row-for-row byte-compatible with `import_brownlow_season.py`'s pinned `HEADER` and
  `load_artefact()` ordering (proved by a round-trip self-check inside `build()`), written to
  its OWN season-scoped path — `data/brownlow/season-votes-afl_api-<season>.csv` +
  `...manifest.json` — never the tracked ISSUE-113 master `data/brownlow/season-votes.csv`;
  merging a season-scoped artefact into the master file is left to the ISSUE-101/F rollover step,
  deliberately out of scope here. The manifest is this builder's OWN schema (real snapshot/
  bridge/DB provenance), not `import_brownlow_season.py`'s legacy-recovery-export manifest shape
  (whose identity-adjudication file exists to gap-fill LEGACY rows with no AFL Tables profile
  path at all — inapplicable here, since every emitted row already carries a DB-verified URL).
  Existing-destination safety follows `build_afl_api_player_bridge.py`'s established convention:
  content-equality is a no-op, any real difference is a hard refusal, nothing is ever silently
  overwritten or deleted. `bootstrap_player_id` (review-only, never matched on by the loader)
  carries the resolved canonical `players.id` rather than a fabricated legacy id, documented
  inline. New DB-free contract test `tests/python/afl_api_brownlow_season_artefact_contract.py`
  (parse/vote-set-integrity refusals, the CONCLUDED gate, leaderboard reconciliation, bridge
  loading and its S5 rule-(b) re-check, per-match all-or-none identity refusal, ineligible-player
  handling, `competitionRanks()` ties, full derive->row->CSV pipeline shape/provenance/ordering,
  determinism across reordered input, and the never-silently-overwrite write path) — not yet run
  by the assistant. The `staging.afl_api_brownlow_vote` typed-projection gap remains open and out
  of scope for this pass, as before; S7 is NOT marked complete. Full detail: `issues.md` "S7
  completed-season Brownlow season-artefact builder" paragraph.
  **Season-artefact builder now OPERATOR-VALIDATED (per operator acceptance evidence supplied
  2026-09-20):** real 2025 source (207 voting matches, 621 vote rows, 188 leaderboard players);
  clean full-count settle (`voteSetsSeen`/`voteSetsPlanned`: 207, `voteSetsRefused: {}`,
  `voteSetsRescheduledRound`: 2, `leaderboardPlayersCompared`: 188, `leaderboardMismatches`: 0);
  the completed-season artefact builder's real 2025 `--validate-only` was clean and its real
  `--write` produced 188 season rows and 1 winner deterministically, with an identical second
  write a content-equality no-op (hashes unchanged). S5b remains complete/applied (188/188), not
  pending (unchanged from the paragraph above). None of this operator evidence was independently
  re-verified by the assistant (CLAUDE.md §9); it is recorded here as operator-supplied.
  **S7 typed-projection closure (this pass, fresh session, Sonnet 5, same worktree) — implemented,
  UNEXECUTED (CLAUDE.md §9: no test/tsc/DB/Git command run by the assistant).** Closes the
  previously-open `staging.afl_api_brownlow_vote` (migration 103) population gap:
  `projectAflApiBrownlowVoteSet()` (new, `afl-api-brownlow.ts`) upserts one row per vote for every
  fully-resolved (`planned`) set — mirroring `settle-afl-api.ts`'s
  `projectAflApiMatch()`/`projectAflApiPlayerMatch()` exactly (written whenever the set resolves,
  independent of `--auto-apply`, skipped only under `--observe-only`, whose own established
  contract limits every write to the spine observation). `AflApiBrownlowVoteUnit` gained
  `providerTeamId`/`eligible` (from the already-parsed raw vote, additive); the `planned` plan
  variant gained `matchId` (the already-resolved canonical match id, not previously threaded
  through). The canonical write's proposed vote value is now read back from the just-written
  projection row in the SAME transaction (`unitInputFor()`'s new `projectedVotes` parameter) rather
  than re-read from the in-memory payload a second time — a real, narrow dependency —
  `applyAflApiBrownlowVoteSet()` refuses the whole set if a projection entry is missing for any
  unit, rather than silently falling back. Match/round/player resolution, the all-or-none refusal,
  ownership/correction gates and leaderboard reconciliation are UNCHANGED — this pass does not
  redesign or weaken any of them, matching `settle-afl-api.ts`'s own documented choice not to
  re-read its sibling typed projections back into canonical planning either (`club_id` stays NULL
  throughout: no provider-team-to-club resolution exists in this settle engine, and §10's Option B
  explicitly allows it). No new migration; no promotion_candidates queue added (the project-wide
  "human accept path stays unimplemented" state is unchanged, and §10 does not require one); no
  `brownlow_leaderboard` spine persistence added (its `promotion_policy` stays `'never'`, no typed
  projection exists or is required); `brownlow_round_votes.match_id` still NOT populated (unchanged
  follow-up, not required by any located §10/§19 acceptance text — reported, not silently expanded).
  Tests extended (not a new parallel suite): `tests/integration/settle-afl-api-brownlow.test.ts`'s
  existing apply/replay case gained projection-row assertions (resolved identity, `club_id NULL`,
  no duplication on replay) and a new correction step (two of three votes change value; projection
  and canonical rows both update in place, atomically); cleanup in that file and in
  `tests/integration/settle-afl-api-brownlow-reschedule.test.ts` /
  `tests/integration/settle-afl-api-brownlow-backtest.test.ts` now also deletes this suite's
  `staging.afl_api_brownlow_vote` rows (ordered before their `matches` DELETE, which the new
  `match_id` FK would otherwise block). S7 remains NOT complete until this closure is operator-run.
  Full detail: `issues.md` "S7 typed-projection closure" paragraph.
  **§9.10 — 2022 season prerequisite + audit-accounting corrective (2026-09-21), implemented,
  UNEXECUTED (CLAUDE.md §9: no test/tsc/DB/Git command run by the assistant).** Operator evidence:
  the 2022 fixture-identity prerequisite is solved (207 acquired, 203 persisted, 4 expected
  `finals_label_required` failures, Brownlow match resolution 198/198); the remaining 2022 gap is
  player identity — 594 parsed vote rows, 510 resolved, `identityFailures.length` 42 vs. 84
  unresolved physical rows, exposing two defects, both fixed: (1) `build_afl_api_brownlow_name_bridge.py`'s
  `classify()` called `season_club_roster()` against the hardcoded module `SEASON = 2025` constant
  regardless of `--season`; now takes an explicit `season` parameter threaded from `args.season`
  (CLI default unchanged, still 2025). (2) The audit's `playerIdCache` cached a resolution
  `number | null` keyed by provider id but only reported the FIRST physical row for a
  repeatedly-failing id to `identityFailures`, undercounting failed physical rows (42 distinct ids
  vs. 84 rows); new exported `resolvePlayerCached()` caches the resolver CALL only, returning the
  full discriminated outcome to every caller so every physical row is reported while the resolver
  still runs once per distinct id. Neither change touches the S5b evidence model, the accepted 2025
  artefact, or any settle/canonical write path. New DB-free tests: S5b season-threading checks in
  `tests/python/afl_api_bridge_contract.py`; new `tests/audit-afl-api-brownlow-canonical-equality.test.ts`
  for `resolvePlayerCached()`. §9.10 and S7 remain NOT complete. Full detail: `issues.md` "§9.10 —
  2022 season, prerequisite + audit-accounting corrective" paragraph.
  **§9.10 — CD_I293854 manual identity adjudication + census diagnostic cleanup (2026-09-21),
  implemented, UNEXECUTED (CLAUDE.md §9: no test/tsc/DB/Git/network command run by the
  assistant).** Per operator evidence: 2022 census 207 providers, 165 trusted, 42 outstanding; S5b
  historical build over that 42 resolves 41 automatic / 0 ambiguous / 0 contradictory (unchanged,
  not re-run by this pass), leaving `CD_I293854` ("Matt Taberner", Fremantle) — a nickname
  mismatch neither bootstrap classifier links, deliberately. Routed to a new third
  `match_method`, `afl_api_manual_adjudication`, added to `import_afl_api_player_bridge.py`'s
  `ALLOWED_MATCH_METHODS` (S5b generalisation pattern extended), plus a manual-only pre-write
  check (`manual_adjudication_identity_problem()`): candidate `player_id` must exist and, if
  declared, `canonical_afltables_profile_url` must already resolve to it via a trusted
  `afltables_profile_url` `external_identities` row. New immutable artefact
  `data/reference/afl-api-player-adjudication-2022-CD_I293854.json` links `CD_I293854 ->
  player_id 9321` ("Matthew Taberner"), evidenced independently by `data/awards/player-identity.csv`
  row 1508 and the accepted ISSUE-222 DraftGuru person bridge — **canonical `brownlow_round_votes`
  was NOT inspected or used as identity evidence**. Census fixed (no classification-logic change):
  the hard-coded 188-provider heading is now the measured `rows.length` (207 for 2022); the
  2025-only `FIRST_MATCH_CHECK_IDS` block is now gated to `season === 2025`. Both extracted as
  exported pure functions, tested DB-free in new `tests/census-afl-api-brownlow-identities.test.ts`;
  manual-adjudication contract checks added to `tests/python/afl_api_bridge_contract.py`. §9.10 and
  S7 remain NOT complete; the manual adjudication is pending operator validation/import. Full
  detail: `issues.md` "§9.10 — CD_I293854 manual identity adjudication + census diagnostic
  cleanup" paragraph.
  **§9.10 — HISTORICAL CLOSEOUT (2022–2025), 2026-09-21, operator-proven COMPLETE.** Per
  operator-supplied evidence (no test/tsc/DB/Git/network/deployment command run by the
  assistant): all four historical seasons now PASS exact canonical equality with every
  mismatch/failure counter at 0 — 2022 (198 vote sets, 594/594 rows, 207/207 identities trusted),
  2023 (207 vote sets, 621/621 rows, 201/201), 2024 (207 vote sets, 621/621 rows, 196/196), 2025
  (207 vote sets, 621/621 rows, 188/188). Historical fixture-observation prerequisite: 2022
  207 feed / 203 persisted, 2023 216/212, 2024 216/212, each with 4 expected
  `finals_label_required` build failures outside the H&A population and zero Brownlow
  match-resolution failures. The stale `players.id 12205` reference for the 2022 CD_I293854
  adjudication (this file, and the corresponding `issues.md` §9.10 paragraph) is corrected to the
  artefact's actual `9321` — 12205 is a legacy bootstrap id (currently Taylor Walker), was never
  written to the artefact or the database, and canonical Brownlow votes were not used as identity
  evidence for the correction. **§9.10 historical Brownlow evidence: CLOSED / PASS for 2022–2025.
  S7 itself remains OPEN** (the separate real live-count capture/replay has not occurred; 2026
  count is imminent). Assertion 9 (§9.9 semantic-hash evidence) is unaffected by this closeout —
  it remains SKIPPED (one formal monitor-capture pair on disk; §9's design permits a
  missing-fixture SKIP rather than a silent PASS) and is a separate, still-open closeout item for
  ISSUE-228 as a whole, not tonight's Brownlow blocker. Full detail: `issues.md` "§9.10 —
  HISTORICAL CLOSEOUT" paragraph.
  **S9 full-2026 player-identity evidence emitter, 2026-09-21 — implemented, UNEXECUTED
  (CLAUDE.md §9: the assistant ran no test/tsc/DB/network/Git/deployment command, and touched
  nothing under `data/sources/`).** Operator-supplied state this pass was built on: main clean at
  `27d7e5aa`, DEV deployed at that exact commit; immutable DEV-only snapshot
  `afl-api-2026-2026-09-21-011148` (manifest sha256 `dcbd0626…`) = **217 matches / 9,983 AFL API
  player-match rows / 669 distinct provider players / 0 missing provider ids**; **first real S9
  settle dry-run** = `unresolvedIdentityMatch 0`, **`unresolvedIdentityPlayer 9983`**,
  `corroboratedForeignOwned 215`, `sourceDisagreement 0`, `canonicalApplyFailures 0`, Source
  completeness **INCOMPLETE**, whole transaction **rolled back, no apply**; **DEV holds 0
  `external_identities` rows for source `afl_api`** (the direct cause — the runtime resolver is
  trusted-external-identity-only); existing tracked artefact union covers **396/669 providers and
  6,824/9,983 rows** (273 / 3,159 uncovered, 0 contradictions); new read-only DEV census =
  canonical 2026 matches **216**, `player_match_stats` **9,063 rows / 215 matches / 577 distinct
  players**, null jumper 0, nonstandard jumper 0, duplicate jumper keys 0, incomplete core vector
  0, **all-zero core vector 6**. Because canonical evidence exists for only 215 of 217 snapshot
  matches and there are 920 fewer canonical rows than AFL API rows, **100% resolution is not
  promised**. **Architecture decision:** no second Python builder and no generalisation of
  `build_afl_api_player_bridge.py` — full-season evidence is emitted by a thin TypeScript CLI that
  REUSES the validated S3/S6 snapshot/bundle/match-identity stack (manifest verification, unit
  discovery, `buildAflApiSettleBundle()`, timezone/local-match-date proof, team identity,
  `buildAflApiMatchIdentity()`, `resolveAflApiMatch()`), so no second timezone implementation
  exists; `resolveAflApiPlayer()` is untouched; no name fallback, fuzzy matching or nickname
  inference anywhere; the ISSUE-131 retired-identity/rekey lookup is **deliberately inert** here
  (`resolveAflApiMatch()` is called with `NO_MATCH_REKEY_SCOPE`, the settle path's own `afl_api`
  argument), so a match reachable only by a rekey is reported `no_canonical_match` rather than
  resolved by a route the settle engine refuses to use. New
  `src/lib/acquisition/afl-api-snapshot.ts` (a **behaviour-preserving extraction** of the settle
  CLI's private `verifyManifest()`/`unitSourcesFrom()`, with the refusal messages pinned by test —
  no byte-identity claimed — plus a manifest-sha256 helper); new pure
  `src/lib/acquisition/afl-api-player-evidence.ts` (faithful S5 §6.3 (a)–(d) port, same 13 core
  columns, same ≥2-matches / ≥10-agreeing-stats constants, same rule order, plus three hardenings:
  **A** a duplicate canonical `(match, club, jumper)` key refuses that whole match's evidence path,
  never last-wins; **B** explicit jumper normalisation with an unparseable value reported under its
  own reason/counter, never a silent "no matching player"; **C** an all-zero core vector cannot
  qualify a provider on single-match evidence alone, multi-match handling deliberately unchanged);
  new CLI `tools/current-season/emit-afl-api-player-bridge.ts` (read-only `afldb_dev` via
  **`AFLDB_DEV_DATABASE_URL`** only — never the importer's write role or the migration owner —
  DSN never accepted on argv, `/afldb_dev` path checked before connecting, live
  `current_database()`/`transaction_read_only`/`default_transaction_read_only` proven before any
  statement, SELECT-only, no PROD target/path/env anywhere, `--validate-only` XOR explicit `--out`,
  never writes under `data/sources/`, never silently overwrites); new DB-free
  `tests/afl-api-player-evidence.test.ts`. Artefact carries its OWN `match_method =
  'afl_api_stat_vector_season'` (never conflated with S5's `afl_api_stat_vector_bootstrap` or
  S5b's `afl_api_name_team_season_bootstrap`), `built_from_database` from the live proof,
  `read_only`, `season`, `snapshot_label`, `snapshot_manifest_sha256`, and
  `existing_claim_comparison = unproved_cross_database_id_parity` — **numeric `players.id` parity
  between `afldb_test` and `afldb_dev` has not been proven, so the old artefacts' candidate ids are
  never compared numerically and the old artefacts are neither modified nor imported by this pass.**
  **All 669 providers are classified**, not only the 273 uncovered. **Two measured findings
  reported, not fixed (out of scope):** (1) the S5 rule-(c) single-match "≥10 agreeing statistics"
  clause is **structurally non-binding** — a core-vector hit always carries ≥13 — so hardening C is
  the only effective single-match gate (rule retained unweakened, proved in the suite); (2)
  `import_afl_api_player_bridge.py` will refuse this artefact (its `ALLOWED_MATCH_METHODS` lacks the
  new method) **and** its `default_artefact_path()` glob would, once that is fixed, select the
  DEV-built artefact while hard-pinned to `afldb_test` — always pass `--artefact` explicitly, and
  give the importer a database-provenance gate before adding the method. **S9 remains STOPPED
  before apply; the emitter has NOT been run against DEV; `import_afl_api_player_bridge.py` is
  unchanged; no `--target dev` added; the existing 396 identities were NOT imported; PROD
  untouched; Brownlow/S7 untouched; Assertion 9 (§9.9) remains separately open.** `CHANGELOG.md`
  deliberately not updated (no retained behaviour change yet). Full detail, exact operator
  validation commands and the later DEV `--validate-only` command: `issues.md` "S9 — full-2026
  player-identity evidence emitter" section.
  **S9 pre-commit correction pass after independent review, 2026-09-21 (UNEXECUTED; the assistant
  again ran no test/tsc/DB/network/Git/deployment command and touched nothing under
  `data/sources/`).** Operator validation of the pass above was green first (`tsc` PASS, 41/41,
  193/193, Python contract PASS, `git diff --check` PASS); no historical/operator evidence counter
  was altered. **Two blockers fixed:** (1) rule (d) could fail OPEN — `normaliseSurname(null)` is
  `''`, so two ABSENT surnames compared equal and linked a pair rule (d) never validated; it is now
  fail-closed (empty normalisation on either side, or both, is a disagreement; only two equal
  non-empty normalised surnames pass), with discovery untouched and surname still validation-only;
  (2) the emitter deferred on `matchDeferral` alone while the settle path defers every
  `player_match_stats` record on `matchDeferral ?? rosterDeferral` (§7.3 (T3) row 2), so a
  CONCLUDED fixture with a non-CONCLUDED roster would have contributed identity evidence from rows
  the settle path will not promote — the emitter now uses the same rule. **New DB-free
  `tests/afl-api-player-bridge-cli.test.ts`** covering the argument contract (mode XOR, unknown
  flag, all-or-nothing `--expect-*`), the `data/sources/` output guard, the never-silently-overwrite
  artefact write, `candidate_player_id` serialising as a JSON **number** not a string (the
  postgres.js `int8`-as-text hazard), and BOTH deferral shapes contributing zero identity hits (with
  a `sql` handle that throws on any access, so a regression cannot quietly connect). **Windows-safe
  output guard:** `assertNotUnderDataSources()` now case-folds resolved paths where the filesystem
  does (win32/darwin), so `data/Sources/foo.json` is refused on the workstation while Linux keeps
  case-sensitive semantics and `data/source-output/` / `data/reference/` stay allowed. **N5 taken:**
  a duplicated canonical `(club, jumper)` key is now DELETED from `byClubJumper`, so it cannot be
  looked up at all (still reported, caller still refuses the match). Wording corrected for the
  fail-closed surname behaviour, the deliberately-inert rekey lookup, the "verbatim/byte-identical"
  extraction claim and `normaliseJumperNumber()`'s whitespace handling. Non-blockers N2/N3/N7/N8/N9
  deliberately left; `import_afl_api_player_bridge.py` and `resolveAflApiPlayer()` untouched.
  **S9 still STOPPED before apply, emitter still unexecuted on DEV, no identity import, PROD
  untouched, S7 separate, Assertion 9 separate/open.** Operator validation: `npx tsc --noEmit`;
  `npx vitest run tests/afl-api-player-evidence.test.ts tests/afl-api-player-bridge-cli.test.ts`;
  `npx vitest run tests/afl-api-match.test.ts tests/afl-api-settle-cli-gate.test.ts
  tests/reference-data.test.ts`; `git diff --check`.
- **Runbook:** `issues/open/AFLDB-ISSUE-228.md`.
- **Key files:** `data/reference/source-families.json`, `src/lib/acquisition/source-families.ts`,
  `src/lib/acquisition/afl-api-rounds.ts` (new), `src/lib/acquisition/afl-api-client.ts` (new),
  `data/reference/afl-api-identities.json` (new), `tools/current-season/acquire-afl-api.ts` (new),
  `tests/afl-api-rounds.test.ts` (new), `tests/afl-api-match.test.ts` (new),
  `src/db/migrations/103_afl_api_match_projections.sql` (new),
  `tests/afl-api-match-migration.test.ts` (new),
  `tools/migration/build_afl_api_player_bridge.py` (new, S5),
  `tools/migration/import_afl_api_player_bridge.py` (S5; generalised S5b),
  `tools/migration/build_afl_api_brownlow_name_bridge.py` (new, S5b),
  `tests/python/afl_api_bridge_contract.py` (S5; extended S5b),
  `src/lib/acquisition/afl-api-fixture-identity.ts` (new, S7 follow-up),
  `tools/current-season/settle-afl-api-fixtures.ts` (new, S7 follow-up),
  `tests/integration/settle-afl-api-fixtures.test.ts` (new, S7 follow-up),
  `src/lib/acquisition/afl-api-brownlow.ts` (M, backtest authority; M again, round-selection fix),
  `tools/current-season/settle-afl-api-brownlow.ts` (M, `--allow-completed-season-backtest`;
  M again, `voteSetsRescheduledRound` counter line),
  `tools/current-season/audit-afl-api-brownlow-canonical-equality.ts` (M, keyed by match_id),
  `tests/afl-api-brownlow.test.ts` (M, DB-free guard tests; M again, counter shape),
  `tests/integration/settle-afl-api-brownlow.test.ts` (M, reschedule regression case),
  `tests/integration/settle-afl-api-brownlow-backtest.test.ts` (new, DB-backed backtest tests),
  `tests/reference-data.test.ts`, migrations 074/076/077/083/097,
  `tools/rebuild/afl_api/`, local samples `data/sources/AFLWebsite/` (untracked),
  `src/lib/acquisition/snapshot-dir.ts` (new, S7 snapshot-label collision fix),
  `tools/current-season/acquire-afl-api.ts` (M, collision-safe claim),
  `tools/current-season/acquire-afl-api-brownlow.ts` (M, collision-safe claim),
  `tests/afl-api-brownlow-acquire.test.ts` (new, S7 snapshot-label collision fix),
  `tests/afl-api-match.test.ts` (M, collision-safety tests + `HHMMSS` label literal),
  `tools/migration/build_brownlow_season_artefact_from_afl_api.py` (new, S7 season-artefact
  builder), `tests/python/afl_api_brownlow_season_artefact_contract.py` (new, S7 season-artefact
  builder),
  `src/lib/acquisition/afl-api-brownlow.ts` (M again, S7 typed-projection closure —
  `projectAflApiBrownlowVoteSet()`), `tests/integration/settle-afl-api-brownlow.test.ts` (M again,
  projection/correction assertions + cleanup), `tests/integration/settle-afl-api-brownlow-reschedule.test.ts`
  (M, cleanup), `tests/integration/settle-afl-api-brownlow-backtest.test.ts` (M again, cleanup),
  `tools/migration/build_afl_api_brownlow_name_bridge.py` (M again, §9.10 season threading),
  `tools/current-season/audit-afl-api-brownlow-canonical-equality.ts` (M again, §9.10 cached-failure
  accounting + `invokedDirectly` guard), `tests/python/afl_api_bridge_contract.py` (M again, §9.10
  season-threading checks), `tests/audit-afl-api-brownlow-canonical-equality.test.ts` (new, §9.10),
  `tools/migration/import_afl_api_player_bridge.py` (M again, §9.10 `afl_api_manual_adjudication`
  method + identity pre-check), `data/reference/afl-api-player-adjudication-2022-CD_I293854.json`
  (new, §9.10 manual adjudication artefact),
  `tools/current-season/census-afl-api-brownlow-identities.ts` (M, §9.10 diagnostic cleanup),
  `tests/python/afl_api_bridge_contract.py` (M again, §9.10 manual-adjudication checks),
  `tests/census-afl-api-brownlow-identities.test.ts` (new, §9.10),
  `deploy/afldb-settle-afl-api.sh`/`.service`/`.timer` (new, S8), `deploy/afldb-settle-afl-api-brownlow.sh`/`.service`/`.timer`
  (new, S8), `src/lib/acquisition/settle-trigger.ts` (M, S8 unit table), `src/lib/acquisition/settle-status.ts`
  (M, S8), `src/db/queries/settle-runs.ts` (M, S8), `docs/acquisition/AFLDB-2026-BROWNLOW-LIVE-COUNT-RUNBOOK.md`
  (new, S8), `tests/admin-current-season-settle.test.ts` (M, S8),
  `src/lib/acquisition/afl-api-snapshot.ts` (new, S9 — the settle CLI's snapshot helpers, moved
  verbatim), `tools/current-season/settle-afl-api.ts` (M, S9 — imports them instead of defining
  them; no settle behaviour changed), `src/lib/acquisition/afl-api-player-evidence.ts` (new, S9 —
  the pure evidence engine), `tools/current-season/emit-afl-api-player-bridge.ts` (new, S9 — the
  read-only `afldb_dev` CLI), `tests/afl-api-player-evidence.test.ts` (new, S9),
  `tests/afl-api-player-bridge-cli.test.ts` (new, S9 correction pass),
  `package.json` (M, S9 — `emit:afl-api-player-bridge` script).
- **Amended 2026-09-19:** Q1 co-source corroboration, Q2 field-scoped attendance enrichment
  and Q7 rollover corroborates-never-re-owns are **approved**; the player bridge is
  bootstrap-only with durable `afl_api` identities; hashing starts with empty exclusions
  (evidence-gated); POSTGAME becomes a deferred record (bundle v2), not a rejection; round
  translation is one per-season table in `afl-api-rounds.ts` with typed HALTs. Acceptance
  criteria: runbook §19.
- **Next action:** Operator validation of the S9 pre-commit correction pass — `npx tsc --noEmit`;
  `npx vitest run tests/afl-api-player-evidence.test.ts tests/afl-api-player-bridge-cli.test.ts`;
  `npx vitest run tests/afl-api-match.test.ts tests/afl-api-settle-cli-gate.test.ts
  tests/reference-data.test.ts`; `git diff --check`. Then operator validation of the S7
  snapshot-label collision fix —
  `tsc --noEmit`; `npx vitest run tests/afl-api-brownlow-acquire.test.ts tests/afl-api-match.test.ts`
  — before the S7 end-to-end run below picks back up (that run is what surfaced the collision).
  Then operator validation of S7 (including the 2026-09-20 fixture-only identity
  follow-up) against the local Brownlow simulator (`http://127.0.0.1:22880`,
  `AFLDB_AFL_API_CFS_BASE_URL`) end to end in `--observe-only` then `--apply --auto-apply` mode,
  then against `afldb_test`, before any production deploy. Also pending: the completed-season
  backtest authority above — `tsc --noEmit`; `npx vitest run tests/afl-api-brownlow.test.ts
  tests/integration/settle-afl-api-brownlow.test.ts
  tests/integration/settle-afl-api-brownlow-backtest.test.ts`; then the real
  `afl-api-brownlow-2025-2026-09-20-0330` snapshot with `--use-fixture-identity --auto-apply
  --apply --allow-completed-season-backtest` against `afldb_test`, and an identical replay. None
  of this has been run by the assistant. **S8 implemented 2026-09-21 (uncommitted, UNEXECUTED):**
  `package.json` `acquire:afl-api`/`emit:afl-api` aliases (`bridge:afl-api` deliberately not
  added — no Python script has an npm alias anywhere in this repo); `deploy/afldb-settle-afl-api*`
  and `-brownlow*` `.sh`/`.service`/`.timer` (new, NOT installed/enabled); `settle-trigger.ts`/
  `settle-status.ts`/`settle-runs.ts` gained a read-only three-unit status table (on-demand admin
  "start now" wiring deliberately not extended — an admin-authorization-surface change, out of
  scope); `docs/acquisition/AFLDB-2026-API-ACQUISITION.md` §5/§0 rollover wording corrected off
  "supersede in-season provenance" to the Q7 corroborate/enrich doctrine; `.env.example`/
  `docs/deployment.md` document the four `AFLDB_AFL_API_*` variables; new
  `docs/acquisition/AFLDB-2026-BROWNLOW-LIVE-COUNT-RUNBOOK.md` operator runbook with a corrected
  PowerShell preflight (`[Environment]::GetEnvironmentVariable()`, never `$env:$name`) and an
  `afldb_test`-only fail-safe DB-target check reusing the `s74-rollback-exercise.ps1` pattern. One
  new DB-free test in `tests/admin-current-season-settle.test.ts`. Full detail: `issues.md` "S8
  operations implementation" paragraph.
  **S8 operator-validated, 2026-09-21 (later same day) — COMPLETE.** `sh -n` on both new `.sh`
  files PASS; `npx tsc --noEmit` PASS; `tests/admin-current-season-settle.test.ts` 38/38 PASS;
  systemd safety inspection PASS (no `afldb_test`/`afldb_dev`/prod DB, local tunnel, or simulator
  URL hard-coded in any new unit/timer). The live-runbook safety inspection originally found the
  write-target guard checked the wrong variables; now fixed: `AFLDB_IMPORT_DATABASE_URL` is bound
  process-locally from `AFLDB_TEST_IMPORT_DATABASE_URL` and independently re-verified by `SELECT
  current_database() = 'afldb_test'`; real-feed/simulator overrides are explicitly cleared and
  positively checked; the 2026 `staging.afl_api_match` prerequisite is explicitly documented. No
  DEV or PROD deployment has occurred. Full detail: `issues.md` "S8 operator-validated" paragraph.
  **S9 NOT STARTED** — requires a later DEV dry-run/apply, AFL Tables corroboration and Brownlow
  replay, gated on the S7/S8 prerequisites above. S10 also not started.
  S5b is now complete and operator-validated (61/61 linked, applied to `afldb_test`, 188/188
  census — see the S5b paragraph above); no further S5b action is pending.
  Separately, the season-artefact builder: fixed 2026-09-20 (a `Path.read_text(newline=...)` test
  failure, and 105/207 identity refusals caused by validating against the S5 artefact alone — see
  `issues.md` "AFL API Brownlow season-artefact builder identity-union fix"), and now
  OPERATOR-VALIDATED (see the "Season-artefact builder now OPERATOR-VALIDATED" paragraph above) —
  no further action pending on the builder itself.
  **S7 typed-projection closure (this pass) — operator validation pending:**
  `npx tsc --noEmit`; `npx vitest run tests/afl-api-brownlow.test.ts
  tests/integration/settle-afl-api-brownlow.test.ts
  tests/integration/settle-afl-api-brownlow-reschedule.test.ts
  tests/integration/settle-afl-api-brownlow-backtest.test.ts`. None of this has been run by the
  assistant. This closes the previously-open `staging.afl_api_brownlow_vote` population gap, but
  S7 is still not marked complete until the operator runs it (and the still-open items above:
  simulator/`afldb_test` end-to-end S7 validation, S8+).
  **§9.10 manual adjudication (this pass) — operator validation/import pending:**
  `npx tsc --noEmit`; `npx vitest run tests/python/afl_api_bridge_contract.py
  tests/census-afl-api-brownlow-identities.test.ts`; `python tests/python/afl_api_bridge_contract.py`.
  Then, against `afldb_test`: validate/dry-run/apply BOTH the (unchanged, still-to-be-written)
  automatic 2022 S5b bridge and the new manual artefact
  (`data/reference/afl-api-player-adjudication-2022-CD_I293854.json`) via two separate
  `import_afl_api_player_bridge.py` invocations, then re-run the 2022 census and equality audit.
  Full command sequence: `issues.md` "§9.10 — CD_I293854 manual identity adjudication + census
  diagnostic cleanup" paragraph. None of this has been run by the assistant.

### AFLDB-ISSUE-226 — Stale `docs/architecture.md` §5/§6: documented application structure names `src/services/`, `src/db/schema/` (Drizzle) and `src/types/`, none of which exist
- **Severity:** Low. **Area:** documentation — `docs/architecture.md` §5 "Application structure",
  §6 "Shared statistical definitions".
- **State:** Open (2026-09-19). Found during the closure review of PhanesLight bootstrap commit
  `a59917a4`. Verified three ways against the tracked tree: `git ls-files src` returns exactly
  `app`, `components`, `db`, `lib`, `search`, `styles`, `middleware.ts` (no `services`, no
  `types`); `git ls-files src/db` returns exactly `authClient.ts`, `client.ts`, `migrations`,
  `queries` (no `schema/`); `package.json` carries no Drizzle dependency — PostgreSQL is accessed
  through `postgres` 3.4.9 (postgres.js) directly, and nothing imports `@/services` or `@/types`.
  Documentation only: no application, query, data or deployment behaviour affected, and
  `CLAUDE.md` §6's repository map (what agent routing actually reads) is correct and unaffected.
  Deliberately not corrected under the bootstrap — out of its scope.
- **Key files:** `docs/architecture.md` §5, §6.
- **Next action:** correct §5's directory tree and drop the Drizzle reference. Then **establish
  where the §6 shared statistical definitions actually live** before rewriting that claim — this
  issue asserts only that they are not in `src/services/`, and does not assert where they are.

### AFLDB-ISSUE-220 — Web service credential boundary contradicts the application's `afldb_import` requirement; owner-role code-test DSN and a complete `.env` copy reach the internet-facing process
- **Severity:** High. **Area:** deployment / runtime security.
- **State:** Open (2026-09-17). Implemented in worktree `afldb-issue-220` (Sonnet 5, uncommitted),
  pending operator DEV/PROD verification. §4b established: `writeStandaloneDirectory` in the
  installed Next 16.3.1's own `next/dist/build/index.js` copies `.env`/`.env.production` into
  `.next/standalone/` unconditionally, in a hardcoded loop with no `next.config.ts` knob to
  suppress it — `next.config.ts` correctly left untouched. `deploy/afldb.service` now unsets
  `AFLDB_OWNER_DATABASE_URL AFLDB_TEST_DATABASE_URL AFLDB_TEST_IMPORT_DATABASE_URL
  AFLDB_TEST_AUTH_DATABASE_URL AFLDB_CODE_TEST_DATABASE_URL AFLDB_CODE_TEST_IMPORT_DATABASE_URL
  AFLDB_BACKUP_DATABASE_URL AFLDB_PROD_DATABASE_URL` and keeps exactly `DATABASE_URL`,
  `AFLDB_AUTH_DATABASE_URL`, `AFLDB_IMPORT_DATABASE_URL`; `tools/build/prepare-standalone.mjs`
  now deletes any `.env*` under the standalone tree and fails the build if one survives; new
  `tests/deploy-web-unit.test.ts` derives the full DSN name set from `.env.example` (found
  `docs/deployment.md`'s §9 table was itself missing 5 real DSN names — completed it rather than
  deriving from the incomplete table, see `issues.md` Implementation section). PROD still not
  inspected.
- **Runbook:** `issues/open/AFLDB-ISSUE-220.md` (relocated from the repository root 2026-09-19;
  the `afldb-issue-220` worktree still holds its uncommitted copy at the old root path).
- **Key files:** `deploy/afldb.service`, `docs/deployment.md` §9, `tools/build/prepare-standalone.mjs`,
  `tools/build/env-in-standalone.mjs` (new), `tests/deploy-web-unit.test.ts` (new).
- **Local validation (2026-09-17):** `vitest run tests/deploy-web-unit.test.ts` **15/15 passed**;
  `tsc --noEmit` **clean**. DEV/PROD not yet run.
- **Next action:** operator runs the Git/DEV rollout (commit → `merge:ready` → push/merge → `sync-dev.ps1`
  build → manual unit reinstall + restart → names-only checks + Admin Centre write/revert), then PROD
  read-only checks. Resolve only once DEV steps 1–5 and PROD steps 2–3/6 (runbook §8/§9) pass.

### AFLDB-ISSUE-225 — Gridley corpus: 37 pre-existing `incorrect known answer` cells on non-draft criteria, present on `afldb_test` before AFLDB-ISSUE-222 and untouched by it
- **Severity:** Medium. **Area:** Grid Solver / canonical data — `captaincies`,
  `player_club_season_stats`, club lineage; `tests/integration/gridley-corpus.test.ts`.
- **State:** Open (2026-09-19, ISSUE-222 decision D3). 37 cells, all "Gridley lists, AFLDB
  omits", identical in the 2026-09-17 pre-import run and the 2026-09-19 run (report
  `7f14ff2c…`): `captain` 20 (Cameron Bruce 2489 ×11, Steven May 12093 ×9), `teammates-150` 14
  (ten players, board #1024), `teammates-100` 1 (Angus Brayshaw 669), `games250sameclub` 1
  (David Swallow 3581), `games100clubs2` 1 (Dylan Shiel 4006). ISSUE-118 closed at 0; the cells
  arrived with the 2026-09-13 `afldb_test` baseline. Root cause not investigated; not a draft
  matter.
- **Key files:** `src/db/queries/grid-solver.ts` (`club_captain_any`, `career_teammates_min`,
  `games_at_*_incl_merged`), `captaincies`, `player_club_season_stats`, the corpus suite.
- **Next action:** targeted read-only queries on `afldb_test` (captaincies rows for 2489/12093;
  teammate recounts for the board-1024/993 players; lineage for 3581/4006), then classify each
  cell from canonical evidence — never by a blanket exception.

### AFLDB-ISSUE-224 — DraftGuru persons whose AFL Tables identity is not registered on the target (`target_not_registered`): post-baseline debutants and numbering/spelling cases cannot link until the identity is registered
- **Severity:** Medium. **Area:** player registration / import — `external_identities`
  (`afltables`, `afltables_profile_url`), fitzRoy core acquisition, current-season settle;
  `tools/rebuild/draftguru/export_person_bridge.py --resolve-against`.
- **State:** Open (2026-09-18, deferred from AFLDB-ISSUE-222 Phase F). 94 bridge-admissible v2
  parent persons are withheld `target_not_registered` in the `afldb_test` child (16 of them in the
  Phase F sample, all operator-verdict `agree`, terminally withheld; none may be added by the
  ISSUE-222 import). Measured (handoff §10.3): 0 of the withheld paths appear in the accepted
  fitzRoy `full-history-20260902` 13,275-URL set, i.e. no appearance in seasons 1897–2025;
  15 of the 16 sampled are 2021–2025 draftees (10 from 2025), 1 is a 1992 spelling case
  (Matthew Capuano). Strong example: Hussien El Achkar (`hussien_el%20achkar/1`, 2025 National
  pick 53, Essendon) — DraftGuru and AFL Tables agree on name, DOB 02 Apr 2007, club, 9 games,
  10 goals; AFLDB search returns no player; he remains withheld. Cause of the registration gap
  (how a post-baseline debutant acquires an `afltables_profile_url` registration) NOT
  investigated here. Confirmed shape (ISSUE-222 D4, read-only query 2026-09-19): `afldb_test`
  holds 2026 matches (max season 2026) while its player register ends at 2025 (max debut 2025);
  Jagga Smith and Willem Duursma have no player row and no AFL Tables identity; no NBSP names.
- **Key files:** `tools/migration/import_fitzroy_core.py` (registration), `deploy/afldb-settle-afltables.sh`
  / current-season import, `data/reference/draftguru-person-bridge-20260918-v2.json` (the 94 identities),
  `docs/rebuild-manifests/draftguru/bridge-validation-verdicts-20260918-v2.csv` (`target_unregistered` rows).
- **Next action:** after ISSUE-222's `afldb_test` import is verified, establish how the 2026
  debutants (and the numbering/spelling cases) become registered identities on each target; then
  re-resolve a new deployment child against that registration (`--resolve-against`, new hash,
  §4.5) — never by editing the child or the importer's HALT.

**AFLDB-ISSUE-221 resolved 2026-09-18** (implemented 2026-09-17 by Fable 5.1; committed, merged
and DEV-verified 2026-09-18 by Sonnet 5) — Grid Solver draft-criteria review: honest "No data"
squares for an axis matching nobody, `draft_type_is` reads `draft_kind`, trade/free-agency rows
excluded from the three "drafted" builders, Gridley `fatherson` remapped to
`father_son_selection`, bounded numeric parameters with a per-square "Invalid value", the form
keyed by the board token so Reset resets, two stale `is_final` test oracles corrected. Committed
`f1a8daca`, merged to `main` at `159518ec`, deployed to DEV (`sync-dev.ps1 -RemoteRef main`,
revision `159518e`; found and corrected the DEV host's Git checkout sitting on a stale `dev`
branch, fast-forwarded 62 commits including AFLDB-ISSUE-220 and the NL-search chain
AFLDB-ISSUE-204–219 that had not reached DEV via this path before). All four required DEV browser
checks plus a valid non-draft answer check passed in a real authenticated `super_admin` session
via Playwright MCP (the operator signed in directly; the audience gate was not bypassed). The
reported symptom's root cause (draft-pick linkage, 5 of 6,810) is unfixed by design and now
tracked as **AFLDB-ISSUE-222** (draft runbook, awaiting operator approval). See `issues.md` for
the full record.

**AFLDB-ISSUE-222 resolved 2026-09-19** (executed across 2026-09-18/19 by Sonnet 5/Opus 5/Fable
5.1, operator-run on `afldb_test`/`afldb_dev`; deployed at commit `19eb40c0`) — the DraftGuru
person-page bridge is complete on both `afldb_test` (3,470 linked persons, 5,115/6,810 picks,
75.11%, Gridley-proven: `incorrect known answer` 99 → 37, zero draft-criterion cells) and
`afldb_dev` (real fail-closed `--link-only` import, committed and twice independently verified,
`summary_sha256 6a89a1ba…`, identical figures). Build `uKIChkbyo_-A3PMi40aFi` (1,516 static pages,
102/102 migrations); DEV health `status=ok, database=ok, latencyMs=16`. Browser-verified: the
AFLDB-ISSUE-221 Grid Solver draft-axis regression is resolved on DEV, `/admin/draft` renders all
6,810 selections, and both linked and unlinked draft selections render correctly. An operational
environment-truncation incident during DEV diagnosis (an unsafe inline PowerShell/SSH command
truncated `.env` to 17 bytes) was recorded transparently, fully recovered from live process state
plus freshly rotated credentials, and followed by a fresh independently verified DEV backup
(parity 9/9). The 1,587 remaining unmatched persons (AFLDB-ISSUE-224) and manual link-approval/
pick-creation mutation checks (out of scope) are **not** claimed resolved by this closure.
AFLDB-ISSUE-223/224/225 remain open, untouched. Full record: `AFLDB-ISSUE-222.md` §11.19.22,
`issues.md`'s *Resolution (2026-09-19)*.

**Fable code review outside NL search — 2026-09-17 (Fable 5.1, review and planning only).**
Reviewed with native inspection: authentication/session/middleware/capabilities and every auth
Server Action (no defect); the admin `*-actions.ts` files the 2026-09-15 mutation audit's glob did
not match, content publish/upload, settle trigger, and the public writers (no defect); all seven
route handlers and every `sql.unsafe` sink traced to a module allowlist (no defect); the tracked
deploy units, cluster entry point, both Caddyfiles, settle chain, build wrapper, DB clients
(**AFLDB-ISSUE-220** opened). Not reviewed: `deploy/sync-dev.ps1` body, `tools/maintenance/*`,
migrations, the admin action modules already covered by the 2026-09-15 audit,
`tools/email_intake/`, page components beyond their query allowlists, `src/db/queries/admin-users.ts`.
Residual, no new ID: `/api/admin/email-intake` still admits `contributor` senders — deferred under
resolved AFLDB-ISSUE-186 Phase B. No project-wide PASS is claimed.

**Fable NL code review — FINAL: PASS (2026-09-17, Fable 5.1, operator-validated on streamanator).**
Lineage: Stage 1 found eight defects (F1–F8) → Stage 2 confirmed them as AFLDB-ISSUE-187..192,
hardening added 193..196, the corpus audit's 40 genuine fail-open rows became 197 (all resolved
2026-09-15/16) → the 168 stale `AMBIGUITY_NOT_DETECTED` expectations (112 team-streak + 56
coach-record, plus 5 Ablett = 173) were corrected under AFLDB-ISSUE-199, then V3/V4/V5 under
201/204/205 → 198..219 hardened further to parser v66. This acceptance pass re-verified every
187..197 fix in the current tree (not from issue status), confirmed the AFLDB-ISSUE-197 family
contract (complete candidates via `resolvePlayerFamily`, 2–12 ranks, >12 declines and is
reachable, direct resolution distinct), and reran the frozen V5 corpus parse+execute on v66:
11997/0/3. The three failures (`verified_finals_without_premiership`, rows 41–43) were adjudicated
`STALE/INVALID EXPECTATION` from current canonical data (Dane Rampe and Nick Dal Santo genuinely
tied at 24 finals, 0 premierships, nobody else at 24) and corrected V5 → V6 by the new fail-closed
script `tools/nl/fix-stale-finals-without-premiership-tie.ts` (3/3 targets, 0 non-targets).
**Final V6: 12000/12000 clean / 0 soft / 0 failed / 0 errors.** V6 is now the stable baseline. No
new issue opened; no production code changed. Volatility note: Rampe is active mid-2026-finals, so
another final would re-stale rows 41–43 honestly (see the script header / `issues.md` ISSUE-219).

**AFLDB-ISSUE-219 resolved 2026-09-17** (Sonnet 5, operator-validated on streamanator) —
cross-family NL defect: a plural club/venue alias already ending in "s" takes a bare trailing
apostrophe for its possessive ("Bombers'", "Dogs'", "Lions'", the AFLDB-ISSUE-214 §10c residual's
"Suns'"/"Pies'"/"Bulldogs'"), which `canonicalise()`'s existing `'s\b` strip
(`src/search/nl/vocab.ts`) never matched (it requires a literal "s" after the apostrophe).
Club/venue matching itself already resolved these aliases correctly via word-boundary regexes;
only the final leftover-token comparison in `parseNlQuestion` (`src/search/nl/parser.ts`) ever
disagreed, because `meaningfulTokens`' whitespace split kept the apostrophe attached to the word
while the matched/consumed span did not. Confirmed a shared `canonicalise()` defect, not a
per-builder one, by tracing `tools/nl/generate-exploratory-corpus-v2.mjs`'s `possessive()` helper
(line 178) across five families: `team_match_result`, `team_checkpoint_collision`,
`q3_comeback_near_miss`, `club_season_rank` (the ISSUE-214 residual) and `team_streak`. Fixed with
one new generic trailing-apostrophe strip in `canonicalise()`, mirroring the existing `'s` rule
rather than special-casing any club — no apostrophe made globally ignorable (only a trailing one
immediately before whitespace/end-of-string; a mid-word apostrophe like `o'brien` is untouched).
`PARSER_VERSION` 65 → 66 (baseline corrected during reconciliation with `AFLDB-ISSUE-218`, which
already holds 64 → 65 on `dev`). `AFLDB-ISSUE-218` (below) **independently found and deliberately
deferred the identical defect** for its own `team_match_result/0` cluster (56 rows,
"Bombers'"/"Dogs'"/"Brisbane Lions'"), naming this exact cross-family issue as its recorded
follow-up candidate — confirming this issue's root-cause finding a second, independent way,
alongside AFLDB-ISSUE-214 §10c. Local: `tests/nl-parser.test.ts` **605/605**, broader gates
**402/402**, `typecheck` clean. **Host validation (streamanator):** no established mechanism
existed to transport uncommitted code to a host, so a temporary, isolated `git worktree`
(`/home/arm/nl-issue219-validation`, off `origin/dev` at `a98c3e42`) was created and a `git diff`
patch applied — a clean `git apply --check` itself served as the identity proof;
`/home/arm/projects/afldb` and the retained git stash were never touched, and the temp worktree
was removed after validation. Host suites reconfirmed 605/605 + 402/402 + clean typecheck.
Exploratory V2 (29,030 rows, the AFLDB-ISSUE-218-corrected corpus) moved **20512 → 20876 clean**
(+364 / -364 soft / 0 failed), reconciling exactly across five families (`club_season_rank` 210,
`team_streak` 75, `team_match_result` 56, `team_checkpoint_collision` 16,
`q3_comeback_near_miss` 7) — every one of the 364 improved rows confirmed to carry a
trailing-apostrophe alias, zero that don't. The frozen V1/"V5" corpus's three failing rows (a
stale `verified_finals_without_premiership` fact check, Nick Dal Santo → Dane Rampe tie count)
were proven via a decisive v65-vs-v66 control against the same current database to be pre-existing
data drift, **not** a regression — flagged as a stale-corpus-expectation candidate, not opened as
its own issue in this closeout. See `issues.md` and `AFLDB-ISSUE-219.md` §14 for the full record.

**AFLDB-ISSUE-218 resolved 2026-09-17** (Sonnet 5, operator-validated on
streamanator across two host-validation rounds) — `team_match_result/1` (522
rows, "at V, find the widest X win/loss to Y...") and `/2` (569 rows, "by how
much did X lose to Y in their most lopsided meeting...") shared one
wrapper-vocabulary-only mechanism (both already extracted clubs/direction
correctly); fixed with additive vocabulary only (`widest` in `AGG_WORDS`, a
leading scope-clause request-verb strip widened to `at` as well as `for`,
verb forms `lose`/`lost`/`beat` in `TEAM_METRIC_WORDS`, two narrowly-gated
wrapper consumers for "how much"/"lopsided meeting"), no grain-election or
club-role logic touched, `PARSER_VERSION` 64 → 65. Round-1 host validation
(commit `5bcc957`) found V5 green and `/1` fully cleared (522→0), but exposed
`/2` moving from an honest soft decline into a 569-row HARD FAILURE — worse
than the pre-fix state — so the issue was reopened rather than closed.
Re-investigation traced production SQL (`src/db/queries/nl/team-match.ts`'s
clubFor-relative `win_margin`/`loss_margin`) and the parser's pre-existing,
uniformly-applied `clubFor`=subject convention against every pre-issue
directional test, then found and confirmed (empirically, 0 mismatches across
every affected row) a genuine, isolated **exploratory V2 generator/oracle
defect**: `team_match_result`'s templates 0/1/3 all keep club `c` as the
sentence's grammatical subject, but template 2 alone renders `o` as subject
and `c` as object without a corresponding fix to its expected `club`/
`opponent`/`metric` triple. Parser v65 was confirmed correct and untouched;
only the generator's template-2 expectation construction was corrected
(commit `6ed227d`), `PARSER_VERSION` staying at 65 (corpus-only correction).
Round-2 host validation confirmed **0 failed**: frozen V5 stayed
12000/12000/0/0; exploratory V2 moved v64 baseline (19421 clean/8109
soft/0 failed) → v65-corrected (20512 clean/7018 soft/0 failed), net
**+1091 clean/-1091 soft/0 failed**, reconciling exactly to `522 + 569 =
1091`; a determinism/isolation diff confirmed 0 question-text/row-id changes
anywhere in the 29,030-row corpus, with all 569 changed rows confined to
`team_match_result/2`'s own expectation columns. `team_match_result/0` (56
rows, "Bombers'"/"Dogs'"/"Brisbane Lions'" possessive aliases) remains
unchanged at 56 honest declines throughout both rounds — a distinct,
already-known trailing-apostrophe plural possessive-alias defect (the same
mechanism AFLDB-ISSUE-214 already found and left unfixed for
`club_season_rank`), deliberately deferred as a future cross-family issue
candidate, not opened as its own tracked issue in this closeout.
Implementation commits `5bcc957` (parser) and `6ed227d` (exploratory oracle
correction) on `sonnet/issue-218-team-match-result-phrasing`, unmerged.
Local: `tests/nl-parser.test.ts` 595/595, broader gates (`nl-regression-corpus`
163/163, `nl-semantic-mapping` 174/174, `nl-stress-corpus` 65/65 = 402/402),
`typecheck` clean. See `issues.md` and `AFLDB-ISSUE-218.md` for the full
record.

**AFLDB-ISSUE-217 resolved 2026-09-17** (Sonnet 5, operator-validated on streamanator) —
`player_game_single`'s three large exploratory clusters (`/0` 423 rows "biggest `<metric>` haul in one
match", `/4` 422 rows "peak single-game `<metric>`", `/3` 409 rows "which match saw `<player>` collect
the most `<metric>`", combined 1254 rows) share ONE root mechanism, not three, and it is NOT grain/mode
misrouting — a named player's per-game stat already defaults correctly to `grain='player_game',
mode='single'`. The defect was in `candidatePlayerSpan` (`src/search/nl/parser.ts`): it greedily takes
the first four remaining non-stopword alpha tokens with no notion of "stop at a non-name word", so
unconsumed wrapper vocabulary ("haul", "peak"/"single-game", "match"/"saw"/"collect" — none had any
vocabulary entry) got swept into the player-name candidate alongside the real name (e.g. "dustin martin
haul"), which then failed player resolution outright — the polluted span is exactly the reported
`unsupported_term`. The adjacent `player_game_scope_collision/3` (555 rows, "single-match `<metric>`
record for...") was inspected and confirmed to share the identical mechanism (bare "single-match" always
sat immediately before the player name) and was included. Fixed with one generic `IN_ONE_GAME` extension
(bare "single-game"/"single-match" adjective, not only "in ... game/match") plus three new gated
wrapper-word consumers (`WHICH_MATCH_SAW_RE`, `PLAYER_GAME_SINGLE_HAUL_RE`, `PLAYER_GAME_SINGLE_PEAK_RE`)
— no player, club, venue, or metric special-cased. `PARSER_VERSION` 63 → 64. Implementation commit
`879b0e1` ("Fix player game single match phrasing"),
`sonnet/issue-217-player-game-single-phrasing`, unmerged. Local: `tests/nl-parser.test.ts` 575/575 (554 +
21 new), broader gates (`nl-regression-corpus` 163/163, `nl-semantic-mapping` 174/174, `nl-stress-corpus`
65/65 = 402/402), `typecheck` clean. Host validation (streamanator, commit `879b0e1`): frozen V5 stayed
**12000/12000/0/0**; exploratory V2 moved **17612 → 19421 clean (+1809)**, **9918 → 8109 soft (-1809)**,
0 failed throughout. All four target clusters fully cleared: `player_game_single/0` 423 → 0, `/4` 422 →
0, `/3` 409 → 0, `player_game_scope_collision/3` 555 → 0. A direct 29,030-row plan-level comparison (v63
vs. v64) found exactly **1809 changed plans, 0 missing rows**, reconciling exactly to the four target
clusters, zero unrelated movement. A separate, pre-existing `WRONG_PLAYER` scorer-identity artifact (the
already-tracked Gary Ablett Jnr/Snr display-name mismatch from AFLDB-ISSUE-206/210) remains present
across several rows in the affected template families, confirmed independent of this fix and left
untouched. See `issues.md` and `AFLDB-ISSUE-217.md` for the full record.

**AFLDB-ISSUE-216 resolved 2026-09-17** (Sonnet 5, operator-validated on streamanator) —
`player_season_leaderboard`'s two exploratory clusters (`/0` 576 rows "posted the highest season tally
of `<stat>` for `<club>` `<time>`", `/3` 559 rows "the best seasonal `<stat>` total `<time>`") do NOT
share one root mechanism: both left "posted"/"season"/"tally"/"seasonal" unconsumed as leftover wrapper
vocabulary (shared gap), but `/3` additionally carried an independent grain-election defect — its own
"total" collided with the generic `AGGREGATE_TOTAL_WORDS` scoped-running-total cue and silently
misrouted the unnamed-player question to `player_game`/`sum` instead of `player_season`. Fixed with
three new gated vocabulary entries (`PLAYER_SEASON_LEADERBOARD_TALLY_RE`,
`PLAYER_SEASON_LEADERBOARD_SEASONAL_RE`, `PLAYER_SEASON_LEADERBOARD_POSTED_RE`, all gated on an actual
player-stat `METRIC_WORDS` match) plus a narrow `playerSeasonLeaderboardCue` override on the
`aggregateTotal` grain-election guard — no club, player, or metric special-cased. `PARSER_VERSION` 62 →
63. Implementation commit `8de4a96` ("Fix player season leaderboard phrasing"),
`sonnet/issue-216-player-season-leaderboard-phrasing`, unmerged. Local: `tests/nl-parser.test.ts`
554/554 (541 + 13 new), broader gates (`nl-regression-corpus` 163/163, `nl-semantic-mapping` 174/174,
`nl-stress-corpus` 65/65 = 402/402), `typecheck` clean. Host validation (streamanator, commit `8de4a96`):
frozen V5 stayed **12000/12000/0/0**; exploratory V2 moved **16477 → 17612 clean (+1135)**, **11053 →
9918 soft (-1135)**, 0 failed throughout. Both target clusters fully cleared: `/0` 576 → 0, `/3` 559 → 0.
A direct 29,030-row plan-level comparison (v62 vs. v63) found exactly **1135 changed plans, 0 missing
rows**, all in the target family, zero unrelated movement. See `issues.md` and `AFLDB-ISSUE-216.md` for
the full record.

**AFLDB-ISSUE-215 resolved 2026-09-17** (Sonnet 5, operator-validated on streamanator, two
host-validation rounds) — `career_numeric_binding`'s two exploratory clusters (`/3` 700 rows "for CLUB,
find players with A plus B", `/2` 552 rows "who has the most career S among players with A and B") do
NOT share one root mechanism — `/3` is a pure wrapper-vocabulary gap ("find" behind a leading "for"
clause, "plus" as an unrecognised conjunction); `/2` shares that gap ("among") plus an independent,
genuine predicate-loss defect (a stat word's earliest occurrence was the only one ever tried, silently
dropping a same-column condition stated after the ranking mention). Both fixed; `PARSER_VERSION` 61 →
62. Round-1 host validation (commit `5eca839`): frozen V5 stayed 12000/12000/0/0; `/2` fully fixed
(552 → 0); `/3` split into 491 `coverage_unavailable` and 209 `unsupported_term: plus`. The 491 were
investigated and classified a **legitimate, currently-real coverage limitation, not a parser/guard
defect** — `conditionSql` (`src/db/queries/nl/player-career.ts`) has no per-club SQL path for any
career condition column except `games`, and `validatePlan`'s club-scoped-career-condition guard
(`src/search/nl/plan.ts`) correctly fails closed rather than silently answer with a whole-career total
— guard NOT weakened, no corpus/scorer file touched, recorded as a future SQL-compiler capability
candidate (see `AFLDB-ISSUE-215.md` §11, §15). The 209 were a second, residual "plus" ownership gap in
`extractCareerConditions` — a 20-character clause-boundary lookback too short for a long comparator
phrase like "no more than " (widened to 40, proven safe by a new three-clause regression control), and
the "no X" negative-condition loop never checking for a neighbouring "plus" — fixed the same session
under the same `PARSER_VERSION` 62 (a correction, not a new semantic feature). Round-2 host validation
(commit `6a341fd`) confirmed the fix: frozen V5 stayed 12000/12000/0/0 again; `career_numeric_binding/3`
final triage is 700 `coverage_unavailable` / 0 `unsupported_term` — **all 700 `/3` rows now produce
structurally valid plans**; a direct round-1-vs-round-2 plan comparison found exactly 209 changed
plans, 0 missing, zero unrelated movement. Implementation commits `5eca839` and `6a341fd` on
`sonnet/issue-215-career-numeric-binding-phrasing`, unmerged. Local: `tests/nl-parser.test.ts`
540/540, broader gates (`nl-regression-corpus` 163/163, `nl-semantic-mapping` 174/174,
`nl-stress-corpus` 65/65 = 402/402), `typecheck` clean. See `issues.md` and `AFLDB-ISSUE-215.md` for
the full record.

**AFLDB-ISSUE-214 resolved 2026-09-17** (Sonnet 5, operator-validated on streamanator) — `club_season_rank`'s "what season had the highest/lowest `<metric>`" and "`<club>`'s highest/lowest seasonal `<metric>`" phrasings declined with `unsupported_term: season`/`seasonal`: neither word was ever consumed by any extractor, so it survived as a leftover token even when the surrounding club-season construction was otherwise fully understood. Confirmed both failing clusters (`club_season_rank/1`, `club_season_rank/3`) are two English phrasings of one already-supported semantic construction, not two mechanisms. Fixed with two new gated vocabulary entries (`CLUB_SEASON_RANK_SEASON_CUE_RE`, `CLUB_SEASON_SEASONAL_ADJECTIVE_RE`) folded into the existing `clubSeasonCuePresent`/single-season-guard logic — no club name, corpus ID, or exact sample string special-cased. `PARSER_VERSION` 60 → 61. Implementation commit `731edd8` on `sonnet/issue-214-club-season-rank-phrasing`, unmerged. Local: `tests/nl-parser.test.ts` 519/519, broader gates (`nl-regression-corpus` 163/163, `nl-semantic-mapping` 174/174, `nl-stress-corpus` 65/65 = 402/402), `typecheck` clean. Operator-validated on streamanator: frozen V5 stayed **12000/12000/0/0**; exploratory V2 moved **14879 → 15925 clean (+1046)**, **12651 → 11605 soft (-1046)**, 0 failed throughout. The full `club_season_rank/3` cluster (642 rows) cleared; 404 of 614 `club_season_rank/1` rows cleared, 210 remaining on a separate, pre-existing possessive-club-alias defect (`Suns'`/`Pies'`/`Bulldogs'`) deliberately **not folded into this issue and not opened as its own tracked issue** — recorded as a follow-up candidate only. A direct 29,030-row plan-level comparison (v60 vs. v61) found exactly **1046 changed plans, 0 missing rows**, all in the target family, zero unrelated movement. See `issues.md` and `AFLDB-ISSUE-214.md` for the full record.

**AFLDB-ISSUE-213 resolved 2026-09-17** (Sonnet 5, operator-validated on streamanator) — a pre-existing
`extractClubs` defect (`src/search/nl/parser.ts`) exposed by, not caused by, ISSUE-212's corrected
exploratory V2 oracle. `phrasePosition`/`phraseEnd` re-found a matched club's position with a bare
first-match `\b<name>\b` search of the whole original question, so a shorter club's name embedded,
word-bounded, inside a longer club's own name ("Melbourne" inside "North Melbourne") silently rebound
onto the longer club's own span instead of the real, later standalone mention — the computed gap
between the two clubs came out empty, the `versus`/`vs`/`v` separator was never recognised, and
`scope.matchup` never formed for wording like "North Melbourne versus Melbourne" (confirmed row
`#20609919`), falling back to directional `clubFor`/`clubAgainst` instead. Fixed with a new
`firstUnclaimedOccurrence` helper that excludes spans an earlier club match in the same call has
already claimed, generic across any overlapping-name pair — no club special-cased. `PARSER_VERSION`
59 → 60. `Port Adelaide`/`Adelaide` and `Greater Western Sydney`/`Sydney` confirmed to reproduce the
identical mechanism, first by source trace and then empirically by the host plan diff (see below). One
pre-existing negative-control test needed a fixture-only swap (`sydney derby` → `western derby`) after
this issue's new `Sydney`/`Melbourne`/`North Melbourne` fixtures invalidated its "absent club"
assumption — not a parser regression, no production code touched for that correction. Implementation
commit `4f0be951` on `sonnet/issue-213-overlapping-club-matchup`, unmerged. Local: `tests/nl-parser.test.ts`
509/509, broader gates (`nl-regression-corpus` 163/163, `nl-semantic-mapping` 174/174, `nl-stress-corpus`
65/65 = 402/402), `typecheck` clean. Operator-validated on streamanator: frozen V5 stayed
**12000/12000/0/0**; exploratory V2 moved **1 → 0** hard failures (row `#20609919` confirmed clean); a
direct 29,030-row plan-level reconciliation (v59 vs. v60) found **exactly 1 changed plan**, the known
row, with **zero unrelated changes** elsewhere in the corpus. See `issues.md` and
`AFLDB-ISSUE-213.md` for the full record.

**AFLDB-ISSUE-212 resolved 2026-09-17** (Sonnet 5, operator-validated on streamanator) — follow-on item
(4) of `AFLDB-ISSUE-206.md`'s six proposals: corrected the exploratory NL corpus/scorer's three
confirmed V1 oracle defects (496-row symmetric "versus" matchup, 283-row achievement-summary
aggregation, 351-row Gary Ablett Jnr/Snr identity, all at parser v54) in a new versioned
`tools/nl/generate-exploratory-corpus-v2.mjs` + `tools/nl/corpus.ts` scorer contract. Not a
parser-feature issue: `PARSER_VERSION` unchanged at 59, no `src/search/nl/{parser,vocab,
semantic-intents}.ts` file touched. Operator-validated on streamanator: V2 (29,030 rows, seed
`2060542026`, SHA256 `bb75e4b5067942117c60f8eab6cfd01de4d8fc1e0c4fee07e10650fae97edb4a`, deterministic
replay confirmed, V5 exact/normalized overlap 0/0, 1,500 audit-required) scored against parser v59:
**27530 scored / 14878 clean / 12651 soft / 1 failed**; the frozen V1 12,000-row corpus stayed
**12000/12000/0/0** under the updated scorer, no regression. A same-corpus, same-parser (v59)
reconciliation of the pre- vs. post-ISSUE-212 oracle found **1308 old false hard failures removed**
(545 `team_match_result` matchup + 320 `achievement_summary` aggregation + 443 player-identity, split
225 Gary Ablett Snr / 218 Jnr) **and 1 newly exposed genuine hard failure** — net failed count change
-1307, not "1307 fixed". The v54→v59 counts (496→545, 283→320, 351→443) grew because
AFLDB-ISSUE-207..211 landed in between and let more previously-declined rows reach a scored plan for
the first time, exposing more instances of the same three pre-existing defects — none of those five
fixes touched matchup detection, achievement aggregation, or player-identity resolution themselves.
The one newly exposed hard failure (row #20609919, "... margin for North Melbourne versus Melbourne at
Adelaide Oval ...") is a genuine, distinct, pre-existing `extractClubs` defect (`phrasePosition`/
`phraseEnd` re-finding a club's position via a bare word-boundary search of the whole original text can
find a shorter club's name embedded inside a longer club's own name, here "Melbourne" inside "North
Melbourne", instead of the real second mention, silently preventing the unordered matchup from
forming) — confirmed identical parser plan in V1 and V2, not a corpus/scorer defect and not introduced
by this issue, deliberately left unfixed and **not opened as its own tracked issue in this closeout**.
Two structurally similar pairs (`Port Adelaide`/`Adelaide`, `Greater Western Sydney`/`Sydney`) are
**unreproduced hypotheses only** — the actual host run found exactly one failure total, so neither is
confirmed to have been drawn by this seed or to reproduce the mechanism. See `issues.md` and
`AFLDB-ISSUE-212.md` (§6a, §8) for the full record.

**AFLDB-ISSUE-211 resolved 2026-09-17** (Sonnet 5, operator-validated on streamanator) — follow-on item
(5) of `AFLDB-ISSUE-206.md`'s six proposals, the largest single unimplemented soft-decline vocabulary
family it found: `extractSeasons` (`src/search/nl/parser.ts`, `src/search/nl/vocab.ts` new `AFTER_RE`)
had no form for `after YEAR` as an exclusive lower season bound (`scope.seasonMin = YEAR + 1`,
deliberately distinct from inclusive `since YEAR`). Fix extends the existing single season extractor
with one new anchored regex and one new `else` branch alongside the existing `since` check — no second
parser, no vocabulary/stage reordering, `after the siren`/`AFTER_THE_ACHIEVEMENT` unaffected because
neither ever puts a literal year immediately after the word. `PARSER_VERSION` 58 → 59. Implementation
commit `c113e6a`, unmerged on `sonnet/issue-211-after-year-season-bound`. Operator-validated on
streamanator: frozen V5 stable-corpus rerun stayed **12000/12000/0/0**, and a direct structured-plan diff
of the retained ISSUE-206 29,030-row exploratory corpus (pre-fix v58 vs post-fix v59) found exactly
**1406 changed plans**, all genuine `after <4-digit year>` wording, 0 unrelated — reconciled in full:
**1262 `soft_fail→clean`** (the genuine usability gain), **136 `soft_fail→soft_fail`** (95
`career_boundary` / 23 `head_to_head` / 18 `unsupported_composition`, correctly declined under the
existing compiler/coverage contract once the temporal clause parses), **8 `audit→audit`**
(`malformed_input` rows, intentionally still manual-audit by corpus design), and **0 `soft_fail→fail`**.
118 changed rows compose `after the siren` with a separate genuine `after YEAR` clause; both meanings
coexist correctly in every one. See `issues.md` and `AFLDB-ISSUE-211.md` for the full record.

**AFLDB-ISSUE-210 resolved 2026-09-17** (Sonnet 5, operator-validated on streamanator) — follow-on item
(6) of `AFLDB-ISSUE-206.md`'s six proposals: a leading imperative/request-wrapper verb ("find", bare
"show", "list", "give me" — "show me"/"tell me" already worked) survived `canonicalise()`
(`src/search/nl/vocab.ts`) as an unmatched leftover token and tripped the generic decline gate even when
the rest of the question was otherwise fully supported — the dominant soft-decline mechanism ISSUE-206
found (~10,000+ of 15,275 soft-decline exploratory rows). Fix: one new anchored
`LEADING_REQUEST_PREFIX_RE`, consumed at most once at the very start of the string; `find` carries a
negative lookahead protecting the pre-existing "find the (big) sticks" goals idiom, the one real
vocabulary collision found. `PARSER_VERSION` 57→58. Implementation commit `8324d2a`, unmerged on
`sonnet/issue-210-imperative-nl-phrasing`. Operator-validated on streamanator: frozen V5 stable-corpus
rerun stayed **12000/12000/0/0**, and a direct structured-plan diff of the retained ISSUE-206 29,030-row
exploratory corpus (pre-fix v57 vs post-fix v58) found exactly **1408 changed plans**
(`663 find / 378 list / 367 show / 0 other`, zero unrelated wording family), reconciled in full: **1288
`soft_fail→clean`** (the genuine usability gain), **48 `soft_fail→fail`** (all `show`-prefixed
`player_game_single` rows, all the pre-existing Gary Ablett Jnr/Snr canonical-display-name scorer
artifact from `AFLDB-ISSUE-206.md`, exposed by new reachability rather than caused by this fix), and
**72 audit-required `decline→success`** ("List sons of X with Y" `relationship_conditions` rows, now
valid typed `player_career` plans but still intentionally manual-audit by corpus design). See
`issues.md` and `AFLDB-ISSUE-210.md` for the full record.

**AFLDB-ISSUE-209 resolved 2026-09-17** (Sonnet 5, operator-validated on streamanator) — follow-on item
(3) of `AFLDB-ISSUE-206.md`'s six proposals: `extractHeadToHeadCue`'s `compare_wins` family
(`src/search/nl/semantic-intents.ts`) recognized only past-tense "won more", so present-tense "has/have
more wins ... head to head" fell through to the generic `head to head` → `record` cue and answered with
a full record instead of naming the leader. Fix added a dedicated "has/have (more|the most) wins head to
head" pattern plus a trailing-"head to head" extension to the existing "won more" pattern, both checked
before the generic record families; `PARSER_VERSION` 56→57. Operator-validated on streamanator (commit
`f2e067f`): frozen V5 stable-corpus rerun stayed **12000/12000/0/0**, and a direct structured-plan diff
of the retained ISSUE-206 29,030-row exploratory corpus (pre-fix v56 vs post-fix v57) found exactly
**199 changed plans**, all `headToHead.kind: record→compare_wins` in the same wording family — 173
matching ISSUE-206's direct estimate, plus 26 that also carried a mechanically-linked `between YEAR and
YEAR` season/havingClause correction (the same atomic "wins" consumption fix incidentally resolved a
misread grouped-threshold on those 26 rows) — zero collateral movement elsewhere, so **the validated
affected surface is 199 rows, not 173**. Implementation commit `f2e067f`, unmerged on
`sonnet/issue-209-head-to-head-more-wins`. Two adjacent wordings ("has more wins between A/B", "has more
wins against the other") investigated and deliberately not fixed — claimed earlier by
`extractClubSeasonMetric`'s "most wins" club_season ranking cue, a different mechanism. See `issues.md`
and `AFLDB-ISSUE-209.md` for the full record.

**AFLDB-ISSUE-208 resolved 2026-09-17** (Sonnet 5, operator-validated on streamanator) — follow-on item
(2) of `AFLDB-ISSUE-206.md`'s six proposals: `extractClubs`'s club-role lookback (`src/search/nl/parser.ts`)
tested "does an against-like token exist anywhere in a fixed 20-character window", not "what is the
nearest preposition governing this club" — losing the subject club on 134 after-siren rows ("to win FOR
Club" mis-read the earlier, unrelated "to" as governing) and 117 leading-opponent/checkpoint rows
("Against Opponent, ... Subject's ..." let the opponent's own stripped-out "against" leak into the
subject's shrunken window). One shared mechanism, fixed by a `nearestGoverningPreposition` helper
anchored to the immediately-preceding token, checked against the pre-mutation text — no vocabulary
added, no stage reordered, `scope.matchup` unchanged; `PARSER_VERSION` 55→56. Operator-validated on
streamanator (commit `70b72df`): frozen V5 stable-corpus rerun stayed **12000/12000/0/0**, and a direct
structured-plan diff of the retained ISSUE-206 29,030-row exploratory corpus (pre-fix v55 vs post-fix
v56) found exactly **251 changed plans** (134 `after_siren` + 117 `team_checkpoint_collision`), zero
collateral movement elsewhere, clearing all 251 confirmed parser-defect hard failures (aggregate hard
failures 1381→1130, clean +251, soft unchanged). Implementation commit `70b72df`, unmerged on
`sonnet/issue-208-club-role-ownership`. One structurally similar, undisturbed finding in
`assignCrossDomainClubs` (its own fixed-window `AGAINST_PREPOSITION.test` for the played/coached
opponent refusal) documented but not fixed and not yet opened as its own issue. See `issues.md` and
`AFLDB-ISSUE-208.md` for the full record.

**AFLDB-ISSUE-207 resolved 2026-09-16** (Sonnet 5, operator-validated on streamanator) — follow-on item
(1) of `AFLDB-ISSUE-206.md`'s six proposals, the highest-severity finding (281 silently-wrong-answer
corpus rows). Root cause: `extractHavingClause`'s operator search used an unbounded `±20`-character
window that could reach past a grouped wins/losses/draws/games threshold's own count into an adjacent
margin clause's operator word, and separately let `COMPARE_OP_WORDS`' fixed vocabulary order outrank the
clause's own, correctly-positioned operator word. Both effects silently swapped the two clauses'
comparators while still passing `validatePlan`. Fix bounded the operator search to
`window.slice(0, countEnd)` — no vocabulary added, no stage reordered, no default changed;
`PARSER_VERSION` 54→55. Operator-validated on streamanator: frozen V5 stable-corpus rerun stayed
**12000/12000/0/0**, and a direct structured-plan diff of the retained ISSUE-206 29,030-row exploratory
corpus (pre-fix v54 vs post-fix v55) found exactly **281 changed plans**, all
`havingClause.op: gt->gte` paired with `matchFilter.op: gte->gt` (the intended pairing), zero collateral
movement elsewhere in the corpus. Implementation commit `4ecdd77a`, unmerged on
`sonnet/issue-207-numeric-operator-ownership`. One pre-existing, out-of-scope gap documented but not
fixed: `extractMatchFilter` has no form for trailing "by 50 or more/fewer points". See `issues.md` and
`AFLDB-ISSUE-207.md` for the full record.

**AFLDB-ISSUE-206 resolved 2026-09-16** (Sonnet 5) — final triage of the 29,030-row independent V1
exploratory corpus, re-verified against current branch source rather than taken on the first-pass
(Codex) scorer labels. All 1,381 hard failures reconcile exactly to five root causes: 496
(`team_match_result` symmetric "versus", confirmed corpus-oracle defect — parser already emits a correct
`matchup` scope, template wrongly asserts directional clubs), 283 (`achievement_summary` aggregation,
confirmed corpus/scorer defect — the grain's executor never reads `plan.agg`), 351 (Gary Ablett Jnr/Snr,
confirmed scorer defect — player ID resolves correctly, only display-name string comparison is wrong),
and **251 genuine parser defects** (`after_siren`/`team_checkpoint_collision` clubFor loss, one shared
root mechanism: `AGAINST_PREPOSITION`'s 20-character lookback window in `extractClubs` is not anchored to
the nearest preposition). Two further clusters are silent wrong answers scored `clean`, outside the
1,381: 281 rows (numeric operator ownership crossing between `extractHavingClause`/`extractMatchFilter`,
confirmed parser defect, highest severity) and 173 rows (head-to-head "has more wins" phrasing gap).
Soft declines (15,275) trace mainly to one mechanism (imperative/structural phrasing vocabulary gap,
~10,000+ rows) plus `after YEAR` (unimplemented, ~1,200+ rows) and a deliberate `career_boundary`
compiler restriction (907 rows, fails closed by design). Six follow-on proposals recorded in priority
order in `AFLDB-ISSUE-206.md`, no ISSUE-207+ IDs assigned yet. No parser behaviour, `PARSER_VERSION`, V5
row or production data changed. See `issues.md` and `AFLDB-ISSUE-206.md` for the full record.

**AFLDB-ISSUE-205 resolved 2026-09-16** (Sonnet 5, operator-validated) — AFLDB-ISSUE-200's
`TAXONOMY_DRIFT` disposition for the remaining 70 `WRONG_FAILURE_REASON` rows was incomplete: two
unrelated families, not one benign label mismatch. **Family A (42 rows,** "biggest three quarter time
comeback" **):** genuine parser-ordering defect — `extractScoreCheckpoint` consumed "three quarter time"
before `extractTeamMetric` could match the already-implemented `q3_deficit_overcome` team_match metric.
Fix required two rounds (a `'3QT'`-entry guard, then a `'QT'`-entry follow-up after the operator's first
run found the first guard incomplete — a second, independent fall-through matching the same nested
substring); `PARSER_VERSION` 53→54. **Family B (28 rows,** "comeback from quarter time" **):** genuine
Q1/quarter-time feature gap (no `q1_deficit_overcome` metric exists, and none was added — deliberate
scope decision); stays declined, `expected_failure_reason` corrected `unsupported_topic`→
`unsupported_term`. Two correction-tool validation defects found and fixed along the way (both
test/tooling-only, no parser/runtime defect): an over-broad candidacy design gated on old-state
(`decline`+`unsupported_topic`) before question-text identity, wrongly flagging an unrelated live
fantasy-score row; and a DB-free test fixture that leaked a filler-row default
(`expected_grain='player_game'`) into synthetic decline rows. Operator-validated end-to-end: 446/446
parser tests, 35/35 integration tests (incl. new `q3_deficit_overcome` SQL coverage), clean
`tsc --noEmit`, 15/15 correction-tool tests, real V4→V5 correction (70/70 targets, 0 non-targets
touched, independently re-verified), parser-v54 rerun against V5 = **12000 scored / 12000 clean / 0 soft
/ 0 failed**. V5 is now the stable regression-corpus baseline, superseding V4. Stage 2 remains closed,
not reopened. See `issues.md` and `AFLDB-ISSUE-205.md` §11 for the full record.

**AFLDB-ISSUE-204 resolved 2026-09-16** (Sonnet 5, operator-validated) — guarded V3→V4 corpus
correction for the 180-row `coverage_unavailable|fgf` stale pre-1965/1987 finals-stat coverage
expectations (disposals/marks/tackles, finals/Grand Finals, seasons 1897-1926). Three fail-closed
correction-tool defects were found and fixed across three operator runs before the fourth completed
end-to-end: (1) an over-broad category+template-only selector matched 996 rows, not 180, retargeted to
the row's full structural signature; (2) a singular-only `/\bfinal\b/i` question-text check rejected
real plural "finals" wording, widened to `/\bfinals?\b/i`; (3) a season-shape gate wrongly required
`expected_season_from === expected_season_to` for every row, fixed by branching on
`expected_match_type` (Grand Final rows carry a blank `expected_season_to`). All three were
correction-tool-only; no parser/runtime defect was found. Final run: 180/180 targets corrected, 0
non-targets touched, parser-v53 rerun against V4 = 12000 scored / 11930 clean / 70 soft / 0 failed
(down from 250 soft), the 180 `UNEXPECTED_DECLINE` rows removed with zero new soft rows and zero
semantic changes among the rest; `PARSER_VERSION` unchanged at 53. See `issues.md` and
`AFLDB-ISSUE-204.md` §11 for the full record. AFLDB-ISSUE-187..204 all now resolved. **Stage 2 (the
AFLDB-ISSUE-200 corpus audit and its four follow-ons) is now closed**; the remaining 70
`WRONG_FAILURE_REASON` taxonomy-drift rows are a separate, not-yet-opened cleanup/audit task (see
Stage 2 next task below).

AFLDB-ISSUE-202 (GWS club identity leaks into unsupported-term detection) resolved 2026-09-16
(Sonnet 5, operator-validated) -- see `issues.md` for the full record, including the additional 72
grain-equivalent GWS player-season rows normalized as a byproduct of the same fix.

AFLDB-ISSUE-203 (numeric word "zero" not bound as equality in `player_career` conditions) resolved
2026-09-16 (Sonnet 5, operator-validated) -- root cause was two cooperating gaps in
`extractCareerConditions` (missing `zero` vocabulary entry, and a comparator default wrong for a
bound zero); `PARSER_VERSION` 52→53; 15 zero-word soft findings cleared, 0 new soft rows, 0
semantic changes among the 250 remaining soft rows -- see `issues.md` for the full record.

AFLDB-ISSUE-187..192 were opened 2026-09-15 from the Fable NL Search Stage 1 review (Fable 5.1,
medium effort), re-verified by Stage 2 on main `8a0c4cb`. Subsystem: natural-language search
(`src/search/nl/`, `src/db/queries/nl/`). AFLDB-ISSUE-190 resolved 2026-09-15 (Sonnet 5);
AFLDB-ISSUE-188 resolved 2026-09-15 (Sonnet 5); AFLDB-ISSUE-187 resolved 2026-09-15 (Sonnet 5);
AFLDB-ISSUE-189 resolved 2026-09-15 (Sonnet 5, from the approved runbook, operator-validated);
AFLDB-ISSUE-191 resolved 2026-09-15 (Sonnet 5, operator-validated); see `issues.md`.
AFLDB-ISSUE-193 (opened 2026-09-15 during ISSUE-189 planning) resolved 2026-09-15 (Sonnet 5,
operator-validated); see `issues.md`.
AFLDB-ISSUE-192 resolved 2026-09-15 (Sonnet 5, operator-validated: 31/31 integration tests,
5/5 ISSUE-192 regression tests, clean `tsc --noEmit`); see `issues.md`.
AFLDB-ISSUE-187..193 all remain resolved; the Stage 2 closeout audit (2026-09-16, Sonnet 5 High)
found three neighbouring, unrelated defects while verifying the resolved fixes and opened
AFLDB-ISSUE-194..196. AFLDB-ISSUE-196 resolved 2026-09-16 (Sonnet 5 High, from the approved
runbook — one runbook correction to the `across` regression contract mid-implementation, see
`issues.md` — operator-validated: 389/389 `nl-parser.test.ts`, 167/167 `nl-semantic-mapping.test.ts`,
clean `tsc --noEmit`). AFLDB-ISSUE-195 resolved 2026-09-16 (Sonnet 5 High, from the approved runbook
`AFLDB-ISSUE-195.md`, Option B — subject-gated "won the/a premiership" vocabulary plus a narrow
club-season ownership guard, no runbook correction needed — operator-validated: 398/398
`nl-parser.test.ts`, 167/167 `nl-semantic-mapping.test.ts`, clean `tsc --noEmit`); see `issues.md`.
AFLDB-ISSUE-194 resolved 2026-09-16 (Sonnet 5 Medium, `sonnet/issue-194-team-match-symmetric-matchup`,
unmerged — operator-validated: 34/34 `tests/integration/nl-answers-team-club.test.ts`, clean
`tsc --noEmit`); see `issues.md`. AFLDB-ISSUE-187..196 all now resolved. The Stage 2 corpus triage
of the 208 `AMBIGUITY_NOT_DETECTED` rows (2026-09-16) classified 40 as `GENUINE_FAIL_OPEN`, 168 as
`STALE_CORPUS_EXPECTATION`, and opened AFLDB-ISSUE-197 for the 40 (one root cause).
**AFLDB-ISSUE-197 resolved 2026-09-16** (Sonnet 5, from the approved runbook `AFLDB-ISSUE-197.md` —
Option C, a dedicated `resolvePlayerFamily` resolver mirroring the parser's whole-word-prefix
predicate in SQL; `PARSER_VERSION` 48 → 49; operator-validated: 25/25
`tests/integration/nl-semantic-mapping.test.ts`, 951/951 across the full focused NL suite set,
clean `tsc --noEmit` — see `issues.md` for the full Implementation/Validation/Resolution record,
including one mid-session fixture correction and one integration-path control-flow investigation
that concluded fixture defect, not production defect). AFLDB-ISSUE-187..197 all now resolved.

Stage 2 status: **blocked again, narrowly.** ISSUE-197 resolving its one genuine fail-open root
cause cleared six of the seven generic-surname families (Johnson, Brown, Smith, Williams, Wilson,
Anderson). The v49 regression rerun (2026-09-16) found the seventh, Jones (rows 11626-11630,
5 rows), still hard-failing for a distinct-but-related reason: the parser's own defence-in-depth
`candidateNameWords` re-check does not tokenise hyphenated surnames (`Darcy Byrne-Jones`,
`David Rhys-Jones`) the same way SQL's `afldb_normalise_name` does, undercounting the real 13-member
Jones family to 11 and ranking a wrong answer instead of declining. **AFLDB-ISSUE-198 opened
2026-09-16, resolved 2026-09-16** (Sonnet 5, from the approved runbook `AFLDB-ISSUE-198.md` — one
implementation-time deviation from its §5 Option C code sketch, found empirically: `candidatePlayerSpan`
widens its acceptance test via the new shared `splitNameWords` helper but keeps the original
punctuation-bearing token, rather than exploding it, to stay aligned with the confidence/leftover-token
accounting elsewhere in the parser — see `issues.md`'s Implementation section). `PARSER_VERSION` 49 →
50. Operator-validated 2026-09-16: `tests/integration/nl-semantic-mapping.test.ts` 29/29 (DB-backed,
`afldb_test`), combined focused suite 964/964 across 6 files (`nl-parser.test.ts` 413/413,
`nl-semantic-mapping.test.ts` 167/167, `nl-regression-corpus.test.ts` 163/163,
`nl-audit-acceptance.test.ts` 10/10, `nl-plan.test.ts` 182/182, plus the integration file above),
clean `tsc --noEmit`. AFLDB-ISSUE-187..198 all now resolved.

The unchanged V1 12k-row corpus re-run on parser v50 (post-merge Stage 2 step) has now been run: hard
failures 178 -> 173, confirmed to be exactly the five Jones rows (11626-11630) clearing with zero
collateral movement. **AFLDB-ISSUE-199 resolved 2026-09-16** (Sonnet 5, from the approved runbook
`AFLDB-ISSUE-199.md`, revised mid-implementation after two real-DEV validation failures — see
`issues.md`'s Implementation/Final-patch-revision sections — a self-verifying correction script,
`tools/nl/fix-issue-199-stale-expectations.ts`, corrected exactly the 173 stale-decline rows; operator-
validated: correction-tool summary 173/173 targets modified, 0 non-target rows touched, plus a parser-v50
`nl:stress` re-run showing `AMBIGUITY_NOT_DETECTED`/hard-fail 173 -> 0 with the three soft classes
unchanged at 72/921/70; DB-free unit suite 28/28; `PARSER_VERSION` unchanged at 50). AFLDB-ISSUE-187..199
all now resolved. Stage 2 is **not** closed by this: the three soft classes remain open and unaudited
(item 4 below), and the rest of the Stage 2 closeout sequence remains outstanding.

**AFLDB-ISSUE-200 opened 2026-09-16, resolved 2026-09-16** (all Sonnet 5) for item 4's soft-class
audit. Runbook `AFLDB-ISSUE-200.md` written (planning); `tools/nl/audit-issue-200-extract.ts` and
`tools/nl/audit-issue-200-cluster.ts` (plus a shared constants module) written with DB-free unit
tests (implementation); the operator ran both scripts against the real
`/home/arm/nl-stress-v50-cleaned/` artifacts and found exactly six auto-clusters covering all 1,063
rows, and evidence-backed dispositions for all six were recorded in a checked-in mapping
(`tools/nl/issue-200-dispositions.csv`); **operator-validated resolution:** the final
`audit-issue-200-cluster.ts --apply-dispositions` run against the real
`/home/arm/issue-200-soft-audit.csv` reconciled exactly -- 1063 rows in, 1063 classified, 0
unmapped, 0 stale, `PLANNER_VALIDATOR_BUG` 598 / `STALE_CORPUS_EXPECTATION` 180 / `PARSER_BUG` 143 /
`GRAIN_EQUIVALENT_LEGITIMATE` 72 / `TAXONOMY_DRIFT` 70; local `tsc --noEmit` clean,
37/37 DB-free tests passed. No parser/planner/scorer code changed; neither external corpus file
modified. The three candidate defect follow-ons and the one guarded corpus-correction task (named in
`issues.md`) are recorded but not opened as tracked issues in this closeout.

**AFLDB-ISSUE-201 opened 2026-09-16, resolved 2026-09-16** (all Sonnet 5) for the first of those
follow-ons: the `PLANNER_VALIDATOR_BUG` `coverage_unavailable|boundary` cluster (598 rows).
`validatePlan` now exempts a `raw.boundary` plan from the career season-range rejection;
`player-career.ts` compiles the range against `c.debut_season`/`c.final_season`; `PARSER_VERSION`
50 → 51. Operator-validated: 774/774 focused unit tests, 33/33
`tests/integration/nl-answers.test.ts`, clean `tsc --noEmit`; stable-corpus rerun cleared 596 of the
598 rows, and the remaining 2 (id 9907, id 10294 — both "... Grand Final before 1897", `seasonMax`
genuinely one season before `NL_LIMITS.minSeason`) were confirmed stale corpus expectations, not
implementation defects, and corrected by a new guarded, self-verifying script,
`tools/nl/fix-issue-201-stale-boundary-expectations.ts` (17/17 unit tests passed). Final stable-corpus
result: 12,000 scored / 11,535 clean / 465 soft / 0 failed, with an independent diff confirming zero
collateral movement anywhere else in the corpus. See `issues.md` and `AFLDB-ISSUE-201.md` for the full
record. AFLDB-ISSUE-187..201 all now resolved.

Full entries, evidence, root causes and acceptance criteria are in `issues.md`.

## Stage 2 next task

1. **Done** (2026-09-16) — V1 regression corpus re-run against parser v49 (parse-only): hard
   failures 208 -> 178.
2. **Done** (2026-09-16) — fresh run's semantic rows compared against the retained v48 baseline:
   1271 -> 1241 non-clean rows, 30 rows became clean, 0 new non-clean rows, 0
   changed-but-still-non-clean rows. This comparison is what surfaced the Jones rows (§ above,
   AFLDB-ISSUE-198) as still-hard rather than clean.
3. **Done, resolved 2026-09-16** — the V1 12k corpus was re-run on parser v50: hard failures 178 ->
   173 (only the five Jones rows, 11626-11630, moved; confirmed clean via full semantic diff, zero
   collateral movement). The remaining 173 hard failures (5 Ablett + 112 team-streak + 56 coach-record)
   were all stale expected-decline rows predating shipped features. **AFLDB-ISSUE-199 resolved
   2026-09-16** — corrected via a checked-in, self-verifying script
   (`tools/nl/fix-issue-199-stale-expectations.ts`), operator-run against the real canonical CSV
   (`~/nl-stress-corpus.csv` on the dev host, which has no in-repo generator); `AMBIGUITY_NOT_DETECTED`
   173 -> 0, the three soft classes unchanged. See `issues.md` for full evidence.
4. **Done, resolved 2026-09-16 — AFLDB-ISSUE-200.** All 1,063 soft rows (`GRAIN_EQUIVALENT` 72,
   `UNEXPECTED_DECLINE` 921, `WRONG_FAILURE_REASON` 70) are classified into exactly six real
   clusters, operator-confirmed via the tool's own final `--apply-dispositions` run:
   `PLANNER_VALIDATOR_BUG` 598, `STALE_CORPUS_EXPECTATION` 180, `PARSER_BUG` 143,
   `GRAIN_EQUIVALENT_LEGITIMATE` 72, `TAXONOMY_DRIFT` 70 — no
   `intentional_conservative_decline`/`scorer_harness_artifact`/`duplicate_manifestation` clusters
   turned up in the real data. See `issues.md` for full evidence. Runbook: `AFLDB-ISSUE-200.md`.
5. **(a) done, resolved 2026-09-16 — AFLDB-ISSUE-201.** **(b) done, resolved 2026-09-16 —
   AFLDB-ISSUE-202**: a `PARSER_BUG` fix for "GWS"/"GWS Giants" leaking into unsupported-term
   detection on `team_match` margin questions (128 manifestations). Root cause was a missing
   combined alias (see `issues.md`/`AFLDB-ISSUE-202.md`); fix applied was the one-line
   `CLUB_NICKNAMES` addition, operator-validated against the retained V3 corpus (465 → 265 soft).
   The same fix also normalized all 72 `GRAIN_EQUIVALENT_LEGITIMATE` rows (GWS Giants player-season
   leading-goalkicker questions) to exact expected semantics as a byproduct, so that class is now 0.
   Stage 2 was **not yet** closed after (c): **(c) opened 2026-09-16 as AFLDB-ISSUE-203, resolved
   2026-09-16** (`PARSER_BUG` fix for the word "zero" not binding as numeric-zero in career conditions,
   15 manifestations, operator-validated, `PARSER_VERSION` 52→53); **(d) opened 2026-09-16 as
   AFLDB-ISSUE-204, resolved 2026-09-16** (guarded corpus correction for the 180
   `coverage_unavailable|fgf` disposals/marks/tackles finals/Grand Final rows that asserted a stale
   `expected_status=success` — two coverage floors, not one: disposals/marks before 1965, tackles
   before 1987 — retargeted after the first operator run failed closed on an over-broad 996-row
   selector, then two further fail-closed correction-tool bugs found and fixed; operator-validated:
   180/180 targets corrected, 0 non-targets touched, parser-v53 rerun 250→70 soft with the 180
   `UNEXPECTED_DECLINE` rows removed and zero new soft rows, `PARSER_VERSION` unchanged at 53).
   **Stage 2 is now closed** — (a)-(d) all resolved. The fresh exploratory Codex corpus sweep is now in
   scope, per the original Stage 2 boundary, as a separate not-yet-opened task.
6. **Opened 2026-09-16 as AFLDB-ISSUE-205, resolved 2026-09-16.** The 70 `TAXONOMY_DRIFT` rows were
   **not** accepted diagnostic drift after all — the audit found a real parser-ordering defect silencing
   an already-implemented team_match metric (42 rows, fixed, `PARSER_VERSION` 53→54) plus a genuine
   Q1-comeback feature gap (28 rows, stays declined with a corrected failure-reason label). Corrects, but
   does not reopen, Stage 2 itself. V5 corpus: 12000/12000 clean, 0 soft, 0 failed. See
   `AFLDB-ISSUE-205.md`.

Completed issue runbooks and supporting evidence are archived under `issues/closed/`.
