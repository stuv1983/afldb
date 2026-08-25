# AFLDB-ISSUE-093 — Phase 3 handoff: club-list DOB enrichment wiring + ISSUE-092 fail-closed gate

For a fresh bounded implementation session. Read `CLAUDE.md`, this file,
`AFLDB-ISSUE-093.md` (§4, §9, §13.4, §16), `AFLDB-ISSUE-092.md` §4, and the ISSUE-092/093
entries in `IssuesIndex.md`/`issues.md`. Do not re-derive Phase 1/2 history from chat.

## CURRENT STATE

- `AFLDB-ISSUE-093` is **Open**. Phase 1 **COMPLETE** (2026-08-25, `tests/reference-data.test.ts`
  12/12). Phase 2 **COMPLETE** (2026-08-25, `tests/fitzroy-acquisition.test.ts` 13/13 +
  real probe + real trial acquisition). §13.3 collapsed to a no-op — no structural
  source gap found.
- There is still **no database named `afldb_test`**; the preserved
  `afldb_test_pre_rebuild_20260825` stays `ALLOW_CONNECTIONS=false`, reference-only.
- The new rebuild path has, and must keep, **zero `AFLDB_LEGACY_SQLITE` dependency**.

## PHASE-2 OUTPUTS (contracts Phase 3 can rely on)

- **fitzRoy pinned at 1.8.0** (CRAN stable, verified 2026-08-25) in
  `tools/rebuild/fitzroy/fitzroy-contract.json`; `tools/rebuild/fitzroy/acquire_core.R`
  fails closed on version mismatch (`--allow-version-mismatch` to override) and must
  keep `library(fitzRoy)` attached (namespace-only calls break `dictionary_afltables`).
- Canonical snapshots: raw CSVs in gitignored
  `data/sources/afltables/fitzroy_core/<label>/`; tracked manifests in
  `docs/rebuild-manifests/afltables_fitzroy_core/<label>.json` (row counts, plain 64-hex
  SHA-256, columns, versions, range). `trial-2024` is a proven end-to-end example
  (9,936 / 16,731 / 216 rows). Manifests are immutable; raw files without a manifest are
  an incomplete acquisition.
- **Verified fields (real 2024 probe + acquisition):** `fetch_player_stats_afltables()`
  supplies stable `ID`, `First.name`/`Surname`/`Player`, `DOB`, `url` (AFL Tables
  profile), all 21 stat columns (`Time.on.Ground`, not `Time.on.Ground..`; extra
  `Disposals`), `Brownlow.Votes` (correct per-player-per-match grain; NA ≠ 0),
  `Attendance` (match value repeated per player row — dedupe by match), match linkage +
  quarter TEAM scores. `fetch_results_afltables()`: match/scores/venue (NO attendance).
  `fetch_player_details_afltables()`: supplemental debut/career only (no DOB/ID/URL).
- Known limitations: DOB format + historical coverage of DOB/stats/Brownlow/attendance
  are unmeasured (single-2024 evidence); `player_match_period_stats` MISSING (later
  investigation, §13.7); `data/reference/stat-availability.json` is the coverage
  authority; absent values stay NULL, never 0.
- `.gitignore` now explicitly tracks `data/reference/*.json` (Phase-1 datasets were
  silently ignored — fixed and verified 2026-08-25).

## PHASE-3 OBJECTIVE (runbook §13.4)

1. Wire the five-club-list CSV DOB enrichment to the canonical source directory
   (`data/sources/afltables/club_lists/`, exact filenames in `AFLDB-ISSUE-093.md` §4 —
   must match `enrich_birth_dates_from_club_lists.py`'s `FILE_ORGS`) end-to-end as the
   separate evidence-source layer.
2. Implement the **ISSUE-092 §4 fail-closed gate** in whichever importer owns
   `external_identities` reconciliation: population-sanity check for any caller,
   explicit `--acknowledge-population-drop` override, `--source-key` test containment.
   This is mandatory before that importer is ever run against any `afldb_test` (§9),
   and blocks `AFLDB-ISSUE-090`/`092` validation resumption.

Check `AFLDB-ISSUE-092.md` approval state before implementing; its runbook is the
authority for the gate's exact semantics.

## DO NOT REDO / OUT OF SCOPE

- Do not re-verify fitzRoy schema/version or re-run probes (done, §16).
- Do not touch Phase-1 reference datasets/loader except for a concrete defect.
- No PostgreSQL core import, no `db:test:rebuild` orchestrator, no migrations, no
  DraftGuru/awards/Wikipedia adapters, no period-stats research, no release-gate
  re-baselining, no full historical acquisition (that belongs with the accepted-baseline
  run in later phases).
- User executes all shell/R/Python/SQL/Git commands.

## RECOMMENDED FIRST VALIDATION GATE

The existing focused suites stay green after the wiring:
`npx vitest run tests/fitzroy-acquisition.test.ts tests/reference-data.test.ts`, then the
ISSUE-092-gate-specific tests defined by that runbook (fixture-contained, per its §4/§5 —
no destructive run against real data).
