# AFLDB Current Issues Index

> Lightweight session index of **open issues only**.
>
> `issues.md` is the authoritative detailed ledger. If this file and
> `issues.md` disagree, trust `issues.md` and immediately synchronize this file
> and the Open Issues table at the top of `issues.md`.

**Last updated:** 2026-08-25
**Open issues:** 13

## How Claude should use this file

- Read this file once near the start of technical AFLDB work.
- Use it to identify overlap with a known open issue.
- If an issue is relevant, read only that exact detailed entry from `issues.md`.
- Do not read all of `issues.md` just to understand current project problems.
- When an issue is created, reopened, resolved, materially reclassified, or
  given a materially different next action, update this file in the same task.
- Keep this file synchronized with the Open Issues table at the top of
  `issues.md`.

## Open issues at a glance

| Issue | Severity | Area | Current state |
|---|---|---|---|
| `AFLDB-ISSUE-040` | Low | Tooling | Lint cannot run deterministically/non-interactively because ESLint is not configured. |
| `AFLDB-ISSUE-059` | Low | Search | Grouped qualifying-match counts are plain text because current Match Search cannot replay every grouped predicate. |
| `AFLDB-ISSUE-068` | Medium | UI/Hydration | React #418 remains intermittent under production-style NL search hydration; narrow H7 diagnostic is awaiting authoritative live-build validation. |
| `AFLDB-ISSUE-071` | Low | Audit | V2 residual failures require generator/oracle re-baselining before any remaining parser defect is promoted. |
| `AFLDB-ISSUE-076` | Medium | Performance | `won_final_at_venue` Grid Solver combinations can exceed the 5-second PostgreSQL statement timeout and crash the rendered page. |
| `AFLDB-ISSUE-077` | Medium | UI/Settings | The saved super-admin frontend theme can change between pages during the same browsing session. |
| `AFLDB-ISSUE-083` | Medium | Tests / Database privileges | Importers are tested as `afldb_owner` but run as `afldb_import`, so missing-grant defects pass CI and fail in production. |
| `AFLDB-ISSUE-085` | Low | Data integrity / Import | `import_captaincies` reconciles its whole table with no ownership predicate — the ISSUE-080 defect class, latent because the importer is today the only writer. |
| `AFLDB-ISSUE-086` | Needs triage | Admin / Data integrity | Data-editor edits to source-owned rows can be silently reverted by the owning source's next reload; severity awaits the four-question triage recorded in the entry. |
| `AFLDB-ISSUE-088` | Low | Tests / Tooling | NL-UI stress harness has no `actionTimeout`/`globalTimeout` policy and retains latent unbounded auto-wait sites; hardening deliberately deferred until the D4 timing evidence can set values. |
| `AFLDB-ISSUE-090` | Medium | Data integrity / Import | Confirmed release blocker: club-list DOB enrichment stacks duplicate unresolved `dob_conflict` rows on rerun, and the register pass deletes conflicts it does not own. Migration 072 APPLIED to `afldb_test`; dob-enrichment suite GREEN 23/23; release-gates validation HALTED, blocked by `AFLDB-ISSUE-092`. |
| `AFLDB-ISSUE-092` | Medium | Data integrity / Tooling safety | §4 fail-closed gate + §5 `--source-key` containment IMPLEMENTED (2026-08-25, ISSUE-093 Phase 3; reusable `check_population_drop()` in `common.py`). Database validation (§11 tests 24–27) pending a live test DB — there is no `afldb_test` yet. §6 recovery obsolete for the rebuild path. Blocks `AFLDB-ISSUE-090`. |
| `AFLDB-ISSUE-093` | Medium | Tooling / Data integrity / Import architecture | Rebuild-from-upstream architecture approved in `AFLDB-ISSUE-093.md`. Phases 1–3 COMPLETE/implemented (12/12 + 13/13 + club-list/ISSUE-092 gate, static 33/33). Phase 4a IMPLEMENTED (2026-08-25, §18): `tools/migration/import_fitzroy_core.py` — canonical fitzRoy snapshot → core PostgreSQL tables, ISSUE-092 gate reused, zero `AFLDB_LEGACY_SQLITE` dependency; `tests/fitzroy-core-import.test.ts` new. Next: user-run non-DB gate `npx vitest run tests/fitzroy-core-import.test.ts`, then `--validate-only` against `trial-2024`; DraftGuru (§13.5) follows. |

---

## AFLDB-ISSUE-040 — Lint script is not configured for non-interactive validation

- **Severity:** Low
- **Area:** Tooling
- **Key files:** `package.json`
- **Current state:** `npm run lint` still maps to deprecated `next lint`; ESLint is not installed/configured, so the command becomes interactive instead of providing deterministic validation.
- **Next action:** Add a reviewed ESLint flat configuration and compatible Next/ESLint dependencies through the normal dependency process, then replace `next lint` with the ESLint CLI.

## AFLDB-ISSUE-059 — Grouped qualifying counts have no drill-down link

- **Severity:** Low
- **Area:** Search
- **Key files:** `src/components/NlAnswerSection.tsx`, `src/search/match-spec.ts`, `src/db/queries/nl/team-match.ts`
- **Current state:** `TeamAggregateTable` still renders `Qualifying matches` as plain numeric text. Existing Match Search filters cannot faithfully encode the full grouped predicate set.
- **Next action:** Extend Match Search or add a dedicated NL drill-down route capable of replaying team perspective, opponent, venue, season range, result and optional per-match margin predicates before linking the count.

## AFLDB-ISSUE-068 — Intermittent React hydration errors during NL UI sweeps

- **Severity:** Medium
- **Area:** UI/Hydration
- **Key files:** `tests/nl-ui/nl-stress.spec.ts` plus the current feedback/search hydration implementation and captured `artifacts/hydration/*` / `artifacts/nl-ui/*` evidence.
- **First wrong layer:** UI/runtime.
- **Current state:** React #418 remains intermittent under production-style standalone load. Navigation prefetch reduction helped but did not eliminate it. The server-owned feedback-form change also did not fully resolve it. The current narrow H7 experiment removes only `useFormStatus`/pending-derived button disabling from `NlAnswerFeedbackControls`; typecheck/build passed. The ledger's last handover says the service had just been restarted but port 3100 initially refused connections, so the diagnostic build was not yet proven live. Latest measurement (2026-08-24, ISSUE-087 successor-4 D4, 1,440 questions): authoritative `totalHydrationErrors = 8` (0.56%) — release-gate PASS, H7 still unvalidated.
- **Expected diagnostic build:** `0aYQumjOtVYcrJKPCj0_a`
- **Exact next action:**
  1. **Do not rebuild first.**
  2. Check `systemctl is-active afldb`.
  3. Check `http://127.0.0.1:3100/api/health`.
  4. Check live `x-afldb-build`.
  5. If the service is unhealthy, inspect service status, listener and journal before touching source.
  6. If healthy and built/live IDs both equal `0aYQumjOtVYcrJKPCj0_a`, run only the unchanged 118-row feedback discriminator with four workers and `NL_UI_BATCH=12`.
  7. If any feedback-present React #418 remains, preserve artifacts and stop; H7 is falsified/materially weakened. Do not broaden the patch or run 125/501/12k.
  8. If the run is 0/118, repeat the exact 118-row discriminator before accepting H7.
- **Do not mark resolved yet.**
- **Do not add a changelog entry merely for the end-of-day diagnostic status.**

## AFLDB-ISSUE-071 — Parser-v25 V2 stress residual failure classification

- **Severity:** Low
- **Area:** Audit
- **Key files:** `tools/nl/v2-runner.ts`; report `/home/arm/nl-stress-out-codex-v25-v2/report.md`
- **Current state:** The 250k V2 run had 20,000/20,000 verified football answers correct, 24,393/24,393 expected declines safe, zero unsafe answers, and 6,788/6,788 metamorphic groups consistent. Residual hard/soft findings are dominated by known corpus/oracle-policy tension, with smaller numeric-condition clusters requiring review.
- **Next action:** Re-baseline the V2 generator/oracles for season-range sum expectations, historical coverage policy, wrong-decline-reason expectations, and numeric-condition operator contradictions. Promote a product defect only after the oracle layer is reconciled.

## AFLDB-ISSUE-076 — Grid Solver `won_final_at_venue` queries can hit statement timeout

- **Severity:** Medium
- **Area:** Performance
- **Key files:** `src/db/queries/grid-solver.ts`, `src/search/grid-solver-spec.ts`, `tests/integration/grid-solver.test.ts`
- **First wrong layer:** Database query/compiler performance.
- **Current state:** Reproducible on build `NQrtI3zQGWx62e6zbI5bR`. PostgreSQL cancels the exact Grid Solver query at ~5.05–5.14 seconds with SQLSTATE `57014` and Next.js digest `1511510695`. The failing grid combines `games_at_multiple_clubs_min(50,2)`, `teammate_of(12603)`, `single_game_stat_min(kicks,20)`, clubs 103/108 and `won_final_at_venue(234)`. Changing only `won_final_at_venue(234)` to `played_at_venue(234)` makes the otherwise identical grid complete in ~360–397 ms. Do not raise the normal statement timeout as the fix.
- **Next action:** Capture the exact generated SQL/bind parameters for the failing and successful variants, compare `EXPLAIN (ANALYZE, BUFFERS)` plans, then optimise the `won_final_at_venue` query shape (and add an index only if the plan demonstrates one is appropriate). Add a regression for this exact grid and require correct results comfortably below the 5-second guard, preferably below 1 second on dev.

## AFLDB-ISSUE-077 — Frontend theme changes unpredictably during a user session

- **Severity:** Medium
- **Area:** UI/Settings
- **Key files:** `src/db/queries/site-settings.ts`, `src/app/layout.tsx`, theme/layout components, and any client-side theme initialisation/storage code.
- **First wrong layer:** UI/settings state propagation or cache consistency.
- **Current state:** A theme selected by a super admin is not stable during ordinary browsing. One public page can render with the configured theme and the next internal navigation can render a different theme without any settings change. This is separate from ISSUE-072, which only covers the stale `frontendTheme` default-shape test.
- **Next action:** Trace every `frontendTheme` authority and cache boundary (database, admin mutation/revalidation, SSR layout, cookie/local storage, hydration), reduce them to one authoritative resolved theme, then add browser coverage that navigates across multiple routes and proves the theme remains unchanged until a super admin deliberately changes it.



## AFLDB-ISSUE-083 — Importers are tested as `afldb_owner`, so missing-grant defects are invisible

- **Severity:** Medium
- **Area:** Tests / Database privileges
- **Key files:** `tests/integration/first-kick-goal-reload-links.test.ts`,
  `draft-reload-links.test.ts`, `awards-reload-links.test.ts`,
  `data-editor.test.ts`, `privileges.test.ts`, `tests/setup.ts`, `.env.example`,
  `tools/maintenance/privileges.sql`
- **Current state:** Investigation complete, nothing implemented. Every
  database-backed importer test assigns the owner test DSN to
  `AFLDB_IMPORT_DATABASE_URL`, so no test ever connects as the role the
  importers actually run as. `privileges.test.ts` asserts confinement (the roles
  hold no more than intended) and cannot assert sufficiency. `AFLDB-ISSUE-078`
  shipped a real instance: 13 green tests over an importer whose retirement
  preflight read two tables `afldb_import` had no privilege on.
- **Next action:** Add a restricted test DSN (skipped, not failed, when absent)
  and a shared helper that runs the importer as a child process under it while
  fixture setup stays on the owner `sql` handle; prove it on the first-kick-goal
  loader, whose exact requirements are already known. Do not re-run the existing
  integration suite as `afldb_import`.

## AFLDB-ISSUE-085 — `import_captaincies` reconciles an unscoped population with no ownership predicate

- **Severity:** Low (latent — no second writer exists today)
- **Area:** Data integrity / Import
- **Key files:** `tools/migration/import_awards.py` (`import_captaincies`),
  `tools/migration/common.py` (`reload_keyed`)
- **Current state:** Structural finding from the `AFLDB-ISSUE-080` runbook
  (G6), deliberately excluded from that fix because the importer is provably
  the table's only writer (absent from the `data_edits` allowlist, the ingest
  datasets and the admin mutations). The day a second writer exists, its rows
  are deleted by the next reload. `captaincies_natural_uq` is fact-grained and
  source-blind, so scoping also needs a collision policy.
- **Next action:** Scope the loader to `source_id = ANY([wikipedia])` with the
  `require_source` guard (the `reload_keyed` conjunction machinery from
  ISSUE-080 already exists), settle the `captaincies_natural_uq` collision
  policy, and cover it in `tests/integration/awards-reload-links.test.ts`.

## AFLDB-ISSUE-086 — Data-editor edits to source-owned rows can be reverted by the next source reload

- **Severity:** Needs triage (deliberately not pre-classified — runbook G5)
- **Area:** Admin / Data integrity
- **Key files:** `src/lib/edit/spec.ts` (`EDITABLE_ENTITIES`),
  `src/db/queries/data-edits.ts`, the importers for implicated entities
- **Current state:** Structural finding from the `AFLDB-ISSUE-080` runbook
  (G5): a data-editor UPDATE to a source-owned row is silently rewritten by
  that source's next reload — durability/overwrite, not the ISSUE-080
  ownership-deletion class. Present surface is narrow: only `players`,
  `matches` and `draft_picks` are editable entities, so the honours tables have
  no reversion path today. Not reproduced live.
- **Next action:** Answer the entry's four triage questions (UI promise,
  affected fields/entities, intended durability, silence of reversion) against
  the three live editable entities, then set severity on that evidence.

## AFLDB-ISSUE-088 — NL-UI stress harness has no timeout policy and retains latent unbounded waits

- **Severity:** Low
- **Area:** Tests / Tooling
- **Key files:** `tests/nl-ui/nl-stress.spec.ts`,
  `playwright.nl-stress.config.ts`
- **Current state:** No `actionTimeout`/`globalTimeout` (Playwright default 0 ⇒
  unbounded auto-waits, capped only by the 30-minute per-batch timeout). The
  `:835` instance that parked successor-3's D4 was repaired in `0da44f9`;
  latent unbounded sites remain at `:554`, `:577`, `:580`, `:945`. Hardening
  was deliberately deferred out of the ISSUE-087 release gate.
- **Next action:** After ISSUE-087 closes, derive timeout values from the
  successor-4 D4 `elapsedMs`/`timingSummary` distribution, add them to the
  config, and guard the latent sites with the count()-guarded idiom.

## AFLDB-ISSUE-090 — DOB enrichment conflict writes are not pass-scoped or idempotent

- **Severity:** Medium
- **Area:** Data integrity / Import
- **Key files:** `tools/migration/enrich_birth_dates_from_club_lists.py` (`:412-432`),
  `tools/migration/enrich_birth_dates.py` (`:407-412`),
  `src/db/migrations/072_dob_conflict_ownership.sql` (new),
  `tests/integration/dob-enrichment-issues.test.ts` (new)
- **Runbook:** `AFLDB-ISSUE-090.md` — durable source of truth. Planning
  COMPLETE/APPROVED, implementation IN PROGRESS. Migration 072 APPLIED to `afldb_test`
  (`db:status` 72/72, 0 pending). `dob-enrichment-issues.test.ts` post-migration rerun
  GREEN 23/23 (fixed a test-harness bigint/string assertion defect on the way, not a
  migration defect). `AFLDB-ISSUE-091`'s migration-checksum blocker is Resolved.
- **Current state:** `release-gates.test.ts` validation HALTED. The intended
  duplicate-`dob_conflict` gate is now GREEN (the fix ISSUE-090 set out to make). But two
  unrelated `external_identities` gates flipped green→red (expected 12,472
  `afltables_profile_url`/`unique` rows, found 0) — root-caused to a pre-existing importer
  defect in `enrich_birth_dates.py` exposed by this issue's own new regression suite,
  **not** to migration 072 (conclusively ruled out — see `AFLDB-ISSUE-090.md`). Tracked and
  blocked on **`AFLDB-ISSUE-092`**.
- **Approved decisions:** D1 identical resolved recurrence suppressed (assertion-specific);
  D1a no `recurrence_of`; D2 targeted partial unique index; D3 equivalent
  `dob_internal_conflict` invariant; D4 `external_identity_conflict` is follow-up;
  D5 recompute `players.dob_disputed`.
- **Exact next action:** Blocked. Cannot resume `release-gates.test.ts`/`privileges.test.ts`
  validation until `AFLDB-ISSUE-092` is implemented and `afldb_test.external_identities` is
  recovered per that runbook's §6. Do not re-pin any release-gate expected value. Do not
  restore any backup or rerun the importer outside `AFLDB-ISSUE-092`'s approved sequence.

## AFLDB-ISSUE-092 — `external_identities` reconciliation trusts an unproven-complete source population

- **Severity:** Medium
- **Area:** Data integrity / Tooling safety
- **Key files:** `tools/migration/enrich_birth_dates.py` (`:500-539`),
  `tests/integration/dob-enrichment-issues.test.ts` (test 5, `:216-224`, `:529-556`)
- **Runbook:** `AFLDB-ISSUE-092.md` — durable source of truth. Planning complete, not yet
  approved/implemented.
- **Current state:** `afldb_test.external_identities` is completely empty. Root cause:
  `enrich_birth_dates.py`'s external-identity DELETE assumes its caller always supplies the
  complete register population, with no fail-closed check; `dob-enrichment-issues.test.ts`
  test 5 invokes the real importer against shared `afldb_test` with a tiny synthetic
  register, which caused the DELETE to remove the entire real 12,472-row population. Proven
  to predate migration 072 (independent pre-072 backup already shows the table empty).
  Confirmed the table's sole writer today, so no other feature's data was lost.
- **Implemented (2026-08-25, ISSUE-093 Phase-3 session):** (A) §4 fail-closed gate — reusable
  `check_population_drop()`/`PopulationDropRefused`/`POPULATION_DROP_THRESHOLD=0.10` in
  `tools/migration/common.py`, wired into `enrich_birth_dates.py` before the DELETE; check 1
  (empty asserted population) not bypassable, check 2 (>10% drop) bypassable only via
  per-invocation `--acknowledge-population-drop` (logged); (B) §5 containment —
  `--source-key` flag, fixture source `afltables_issue090_fixture`, cleanup extension, new
  tests 24–27 in `dob-enrichment-issues.test.ts`. No schema/migration change.
- **Exact next action:** Run the §11 database tests (`dob-enrichment-issues.test.ts`) once a
  live test database exists — there is currently no `afldb_test` (ISSUE-093 rebuild). §6
  recovery of the old database is obsolete for the rebuild path; `AFLDB-ISSUE-090`'s
  release-gate validation resumes against the rebuilt database.

## AFLDB-ISSUE-093 — Deterministic afldb_test rebuild from authoritative sources

- **Severity:** Medium
- **Area:** Tooling / Data integrity / Import architecture
- **Key files:** `AFLDB-ISSUE-093.md` (durable source of truth, §15 = Phase-1 record,
  §16 = Phase-2 record); `AFLDB-ISSUE-093-PHASE-3-HANDOFF.md`; `data/reference/*.json`;
  `tools/migration/load_reference_data.py`; `tests/reference-data.test.ts`;
  `tools/rebuild/fitzroy/` (contract + `acquire_core.R`);
  `tests/fitzroy-acquisition.test.ts`;
  `docs/rebuild-manifests/afltables_fitzroy_core/trial-2024.json`.
- **Current state:** Architecture approved; **Phase 1 COMPLETE (2026-08-25)** —
  static/reference domains ported to tracked JSON datasets + standalone loader,
  validated 12/12; old test DB preserved as `afldb_test_pre_rebuild_20260825`
  (`ALLOW_CONNECTIONS=false`, reference-only). **Phase 2 COMPLETE (2026-08-25)** —
  fitzRoy pinned at 1.8.0 (fail-closed version gate), canonical AFL Tables acquisition
  (`fetch_player_stats_afltables` + details + results) verified by real probes and a
  real `trial-2024` acquisition with a tracked SHA-256 manifest; stable ID/name/URL and
  match identity/scores/venue SUPPORTED; DOB/match stats/Brownlow votes (correct
  per-player-per-match grain)/attendance SUPPORTED WITH COVERAGE LIMITATION;
  `player_match_period_stats` MISSING (deferred). 13/13 static tests; zero
  `AFLDB_LEGACY_SQLITE`/PostgreSQL dependency. There is still no database named
  `afldb_test`; no load has been executed anywhere yet.
- **Depends on:** `AFLDB-ISSUE-092` §4 (the fail-closed `external_identities`
  population-sanity gate) must land in whatever importer owns that reconciliation before it
  is ever run against `afldb_test`, rebuilt path or not — this is now part of Phase 3.
- **Phase 3 IMPLEMENTED (2026-08-25, §17):** club-list DOB enrichment wired to canonical
  `data/sources/afltables/club_lists/` (complete-or-refuse in canonical mode, fail-closed
  header/file validation before any DB access, `--require-complete`;
  `tests/club-list-sources.test.ts` new) + ISSUE-092 §4 gate/§5 containment implemented
  (see that issue). Static gate PASS 33/33 (user-run 2026-08-25). DB-side validation of
  the gate tests awaits a test database.
- **Phase 4a IMPLEMENTED (2026-08-25, §18):** `tools/migration/import_fitzroy_core.py` —
  canonical snapshot+manifest → venues, players (+DOB evidence under the distinct
  fitzRoy source, external identities under the ISSUE-092 gate), matches/period
  scores/attendance, player_match_stats (explicit STAT_MAP, NULL ≠ 0), derived
  brownlow_round_votes (coverage-gated, NA ≠ 0). Fail-closed manifest/SHA-256/column
  validation before any DB access; `--validate-only` needs no psycopg.
  `tests/fitzroy-core-import.test.ts` new.
- **Next action:** Phase 4a non-DB boundary COMPLETE (2026-08-26; suite 19/19, real
  `trial-2024` `--validate-only` green, counts reconcile exactly). Fresh `afldb_test`
  bootstrap COMPLETE (2026-08-26): migrations 001–071 + privileges reconciled, 60
  public tables, schema/privileges only — no fitzRoy PostgreSQL import has occurred.
  Next (fresh Fable/Low/Manual session): `AFLDB-ISSUE-093-CORE-IMPORT-DB-HANDOFF.md` —
  load Phase-1 reference data (`tools/migration/load_reference_data.py`), then run the
  core importer against `afldb_test` in dependency order. Preserved
  `afldb_test_pre_rebuild_20260825` stays locked, never an input. DraftGuru (§13.5)
  follows the validated core importer. ISSUE-092 §11 tests 24–27 still pending.
