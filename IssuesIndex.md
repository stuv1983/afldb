# AFLDB Current Issues Index

> Lightweight session index of **open issues only**.
>
> `issues.md` is the authoritative detailed ledger. If this file and
> `issues.md` disagree, trust `issues.md` and immediately synchronize this file
> and the Open Issues table at the top of `issues.md`.

**Last updated:** 2026-08-27
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
| `AFLDB-ISSUE-092` | Medium | Data integrity / Tooling safety | §4 fail-closed gate + §5 `--source-key` containment IMPLEMENTED (2026-08-25, ISSUE-093 Phase 3; reusable `check_population_drop()` in `common.py`). Database validation (§11 tests 24–27) still pending, but **no longer blocked on a database**: `afldb_test` was rebuilt and validated on 2026-08-27 by `AFLDB-ISSUE-093` (Resolved). §6 recovery obsolete for the rebuild path. Blocks `AFLDB-ISSUE-090`. |
| `AFLDB-ISSUE-095` | Medium | Data acquisition / Import architecture / Data integrity | `club_seasons` has no canonical, legacy-free acquisition path — `rebuild_derived.py` builds it only from `staging.team_seasons`, whose sole writer is `import_legacy_afl.py` under `AFLDB_LEGACY_SQLITE`. A clean canonical rebuild therefore correctly yields `club_seasons = 0`. Runbook `AFLDB-ISSUE-095.md`; decisions D1–D7 open. Stage 9 must NOT gate `club_seasons` until this lands. |
<!-- RETIRED 2026-08-27 — `AFLDB-ISSUE-093` is Resolved and is NO LONGER an open issue.
     Do not read the commented-out row below: it is the pre-resolution index row, kept only
     as lineage, and its "NEXT PHASE"/"next action" text is SUPERSEDED — the first clean
     rebuild has since PASSED (nine stages, 13/13 final validation). Authoritative records:
     the `AFLDB-ISSUE-093` entry in `issues.md` and `AFLDB-ISSUE-093.md` §H15. The only
     remaining follow-up is `AFLDB-ISSUE-095`, listed above as an open issue.

| `AFLDB-ISSUE-093` | Medium | Tooling / Data integrity / Import architecture | **CHECKPOINT 2026-08-27 — CANONICAL FULL-HISTORY FITZROY SOURCE FROZEN. Read `AFLDB-ISSUE-093.md` §19 first — it is the authoritative current-state record.** Accepted baseline `full-history-20260827` (1897–2025, 131 artefacts, 719,042 rows), hash-bound via `data/reference/fitzroy-accepted-baselines.json` (`exactly_one_accepted`, no latest-label fallback) and independently revalidated offline with no PostgreSQL access. Phases 1–4a COMPLETE; DraftGuru Stage A/B1/B2-1..B2-8 COMPLETE (supported `import_draftguru.py`, tracked link ledger, legacy `import_draft.py` tombstoned); orchestrator `npm run db:test:rebuild` IMPLEMENTED (normal mode auto-selects the accepted baseline; validator runs before any destructive stage). **417/417 DB-free tests.** **RESET BLOCKER 2 CLOSED 2026-08-27 — live rollback proof PASSED (`a8a2a899…` → `a8a2a899…` exact, 950 relations, psql exit 3, 1498 ms). `afldb_test` reconstructed: migrations 001–072 + privileges, schema only, NO canonical data. NEXT PHASE: FIRST ACTUAL CLEAN REBUILD — read the FIRST CLEAN REBUILD HANDOFF (§H1–§H10) at the end of `AFLDB-ISSUE-093.md`.** Incident lineage retained in full and not rewritten: Building the proof had already found and fixed two real defects (`runSql` never sent the SQL at all — `void client.unsafe(...)`; and the `pg_` schema exclusion excluded nothing, so `DROP SCHEMA pg_toast` would have aborted the first loop). The live run then exited 0 without aborting and the reset committed: pre-proof `0229d62c…` → post-incident `f46ce34c…`. **`RESET_SQL` has therefore now RUN against live PostgreSQL and produced exactly the intended clean slate (schemas 1, relations 0, migrations absent, 3 extensions and all 56 extension-owned objects preserved) — its semantics are validated; the ROLLBACK CONTAINMENT is what failed and remains unproven.** Production and `afldb_dev` untouched; loss was schema + privileges only, no import had ever run. No clean rebuild has been executed. **SELF-COLLISION FIXED (§20.14):** the hardened proof then refused twice with "1 other client session(s) connected" — the harness's own postgres.js observer, held open across the psql run; corrected to three phases with nothing spanning the reset, gate unchanged and no session exempted. Key files: `AFLDB-ISSUE-093.md` §19–§20, `AFLDB-ISSUE-093-DRAFTGURU-B2-HANDOFF.md` PART I–XVIII, `tools/db/rebuild-test.ts`, `tools/db/prove-reset.ts`, `tools/migration/import_fitzroy_core.py`, `tools/rebuild/draftguru/import_draftguru.py`, `data/reference/*.json`. **EXECUTION-BOUNDARY AUDIT 2026-08-27 (§H11) — the first clean rebuild is NOT READY: three blockers. F1 `db:migrate:test`/`db:privileges:test` are POSIX-shell scripts and npm on Windows runs them under `cmd.exe`, so stages 3 and 4 fail *after* the destructive stage 2 wipes the database (remedy proven: `npm_config_script_shell=bash`, which also propagates to the nested `npm run` calls). F2 `AFLDB_TEST_IMPORT_DATABASE_URL` is unset on `dev` (ISSUE-083 parked at `fa035ed`), so `resolveTarget()` refuses before preflight — operator must set it or pass `--allow-owner-import-dsn`. F3 stage 9 FINAL VALIDATION is declared `run: 'internal'` and `executeRebuild()` has no `internal` branch, so it does nothing and `FINGERPRINT_QUERIES` is never called — the run cannot fail closed on validation/fingerprint mismatch as §H9 requires. F4 (no DB identity/session/psql-probe gate in the orchestrator) and F5 (no lock/statement timeout on the destructive reset) are recorded and compensated by operator-run read-only checks. `.env` loading, the psql argv, accepted-baseline selection, DraftGuru inputs and the zero-`AFLDB_LEGACY_SQLITE` boundary all audited CORRECT. **REMEDIATED 2026-08-27 (§H11.8): F1 and F3 are RESOLVED.** `db:migrate:test` is now `tsx tools/db/migrate.ts --target test` (new `--target` flag; `AFLDB_MIGRATE_TARGET` still supported, a disagreement is a refusal) and `db:privileges`/`db:privileges:test` route through new `tools/db/privileges.ts`, which resolves the DSN in Node — psql invocation otherwise unchanged, script names unchanged. Stage 9 is now a real `validate` stage with its own `deps.runValidation` separate from the destructive `runSql`: 13 gates bound to the accepted register's `measured` block plus `matches_after_accepted_last_season = 0`, `draft_persons` and `draft_picks`; an unrecognised measured key is a refusal so the gate cannot silently shrink; read-only, reports every value, fails the run on any mismatch. `FINGERPRINT_QUERIES` removed. **182/182 DB-free tests** in `tests/db-test-rebuild.test.ts`. **FIRST CLEAN REBUILD ATTEMPT 1 FAILED AT STAGE 5 — REPAIRED (§H12, 2026-08-27).** PRECHECK/RESET/MIGRATIONS 72-72/PRIVILEGES all passed; REFERENCE died on `psycopg.errors.InsufficientPrivilege: permission denied for table player_link_match_candidates` in `guard_cascade()`, which probed every transitive FK dependent of its truncate roots with `SELECT count(*)`. Root cause: `privileges.sql` grants `afldb_import` SELECT on a **base table** only via `import_writable_tables`; `app_readable_tables` is consulted only for views. Migration 045 seeded that registry from the tables existing then, so every base table created after 045 is revoked unless its migration calls `grant_import_write()` — migration 067 registers the candidate cache app-read ONLY, by design (migration 070 reasons about that exact table). The closure is 30 relations and **two** are unreadable: `player_link_match_candidates` (067) and `player_match_period_stats` (062, direct `club_id → clubs` FK) — so a one-table grant would have failed on the next relation. **Repair (no grant added, `privileges.sql` UNCHANGED):** `guard_cascade()` now classifies dependents via `has_table_privilege()` (new `common.selectable()`), counts rows only in proven-readable ones, and REFUSES on any it cannot prove empty; new `reload_truncate()` skips a TRUNCATE whose targets are already empty, since `TRUNCATE … CASCADE` needs privileges on the whole cascade set. On a clean rebuild the roots are always empty, so no closure relation is read or locked and a future migration cannot reintroduce the failure. **204/204 DB-free tests** (`reference-data` + `db-test-rebuild`), `py_compile` OK, no new tsc errors. `afldb_test` holds migrated+privileged schema and ZERO rows (the guard refuses before any write) — the post-stage-4 state. **BOUNDED STAGE-5 PROOF 1 FAILED SAFELY — REPAIRED AGAIN (§H13).** The §H12 repair was necessary but NOT sufficient and its "complete" claim is amended in place. Root cause of the second failure: **a freshly migrated database is not empty** — migrations 015 and 016 SEED `stat_definitions` and `stat_availability`, both truncate roots of the `coverage` group. `guard_cascade()` evaluated emptiness and took its cascade closure over the **union of every group's truncate targets** while `reload_truncate()` decides per group at call time, so the union short circuit could never fire and the closure of the EMPTY `clubs`/`seasons` roots (whose truncates would have been skipped) was adjudicated anyway — refusing over a cascade that was never going to happen. Hypotheses #1/#2/#3/#4 confirmed, #5 rejected. **Repair:** closure is now taken from `populated_roots` only (on a fresh DB that is `{stat_definitions, stat_availability}`, whose closure is just `stat_availability` — in the loader's own rebuild set, so `outside` is empty and neither denied relation is touched); and `guard_cascade()`/`reload_truncate()` can no longer disagree — the guard records the roots it adjudicated and the truncate refuses anything outside that set, or if the guard never ran. **New `tests/python/reference_cascade_contract.py`: 19 DB-free BEHAVIOURAL scenarios** driving the real functions against a fake connection that raises if the guard reads a denied relation — §H12's source-string tests passed against wrong control flow, which is the lesson. **206/206** TS tests, `py_compile` OK, no new tsc errors. `privileges.sql` and `src/db/migrations/` still UNCHANGED; `--allow-cascade` still unused. `afldb_test` untouched (the guard refuses before any write) and still in the post-stage-4 state. **FIRST COMPLETE CLEAN REBUILD PASSED — 2026-08-27 (§H15). STATUS: CLEAN REBUILD PROVEN — FINAL POST-REBUILD VALIDATION PENDING.** `npm run db:test:rebuild -- --acknowledge-destroy afldb_test` ran end to end: all NINE stages passed (PRECHECK, RESET, MIGRATIONS 72/72, PRIVILEGES, REFERENCE, FITZROY, DRAFTGURU, DERIVED, FINAL VALIDATION), with data stages under the **restricted `afldb_import` role** — no `--allow-owner-import-dsn`, no `AFLDB_LEGACY_SQLITE`, not production, not `afldb_dev`. Baseline `full-history-20260827` (131 artefacts, 719,042 rows, manifest `cc8aaf09…`, artefact-set `8e14ce61…`); DraftGuru `annual-html-20260826` (5,057 persons / 6,810 picks / 6 ledger decisions / 5,052 unmatched / 2 seeded). fitzRoy: venues 52, players 13,275, matches 16,838, match_period_scores 134,704, player_match_stats 685,471, brownlow_round_votes 320,861. **Stage 9: `AFLDB-FINAL-VALIDATION PASSED: 13 checks`**, including `matches_after_accepted_last_season = 0` (2026 correctly excluded). Two defects were exposed only by real execution under the restricted role and are now repaired: the REFERENCE cascade guard (§H12/§H13 — `afldb_import` correctly denied `player_link_match_candidates`/`player_match_period_stats`; migrations 015/016 SEED `stat_definitions`/`stat_availability` so the empty-root assumption was false; repair scopes cascade analysis to populated roots, **`privileges.sql` unchanged, no grant added**) and fitzRoy corrections-parameter threading (§H14 — both import phases repaired, `corrections` now required). **`club_seasons = 0` RESOLVED as SEPARATE FOLLOW-UP (§H15.5, source-proven 2026-08-27) — it does NOT invalidate the core rebuild.** The only writer of `staging.team_seasons` is `tools/migration/import_legacy_afl.py` (`:767/:776/:795`, group key `"ladders"`), which requires `AFLDB_LEGACY_SQLITE` (`:1021`). `REBUILDS["club_seasons"]` selects `FROM staging.team_seasons`, so an empty staging table correctly yields zero rows. The ladder/team-season domain therefore has **no canonical acquisition path yet** and was never in the nine-stage contract — zero is the *expected* outcome of a legacy-free rebuild, not a defect in it. Real degradation while empty: ladders, premiership/wooden-spoon flags, finals counts and club-season NL answers (`clubs.ts`, `seasons.ts`, `rounds.ts`, `grid-solver.ts`, `search.ts`, `db-health.ts`, `player-derived.ts`, `nl/club-season.ts`, NL `parser/plan/vocab`, `lib/edit/spec.ts`). fitzRoy can derive `played/wins/draws/losses/points_for/points_against/percentage` (and already derives `is_premier`/`finals_played`); `ladder_rank` and `premiership_points` need an external ladder source — both are nullable in the schema, so a partial rebuild is schema-legal but needs a provenance decision (the SQL hardcodes `source_id` = `sports_data_lab`). **Stage 9 must NOT gate `club_seasons` until the domain lands**, or every canonical rebuild would fail on a known gap. Next action: **record a follow-up issue for canonical legacy-free ladder/team-season acquisition + load stage + Stage-9 gate (determine the next unused id from `issues.md`/`IssuesIndex.md` — NOT `AFLDB-ISSUE-094`, already used by NL semantic mapping; link `AFLDB-ISSUE-015` and `AFLDB-ISSUE-093`, do not absorb ISSUE-015), then ISSUE-093 can be marked Resolved — 2026-08-27.** Do NOT start DraftGuru Stage B3; do NOT merge the parked branches. **ISSUE-059 (`4444d76`) and ISSUE-073 (`0885129`) are now UNBLOCKED** for their own focused DB-backed validation against the rebuilt database, as separate work. Do NOT start DraftGuru Stage B3 (optional, not a blocker); do NOT merge the parked branches — ISSUE-083 is complete and parked at `fa035ed`, ISSUE-059 at `4444d76`, ISSUE-073 at `0885129`.** |
-->

---

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
  `draftguru-import.test.ts`, `awards-reload-links.test.ts`,
  `data-editor.test.ts`, `privileges.test.ts`, `tests/setup.ts`, `.env.example`,
  `tools/maintenance/privileges.sql`
  (`draft-reload-links.test.ts` was retired with the legacy draft importer by
  AFLDB-ISSUE-093 Stage B2-7; its successor `draftguru-import.test.ts` has the
  identical owner-DSN substitution and so carries the same gap.)
- **Current state:** **Being handled SEPARATELY by Codex as of 2026-08-27; that work is
  NOT yet integrated into this working tree.** Do not absorb it into ISSUE-093, which is
  Resolved (2026-08-27) and is **no longer waiting on this issue** — the clean rebuild ran its
  data stages under the restricted `afldb_import` role with `AFLDB_TEST_IMPORT_DATABASE_URL`
  set by the operator. `tools/db/rebuild-test.ts` still fails closed while that variable is
  unset rather than silently substituting owner access.
  Investigation complete, nothing implemented here. Every
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
- **Exact next action:** Run the §11 database tests (`dob-enrichment-issues.test.ts`) against
  `afldb_test`, which was rebuilt and validated on 2026-08-27 by `AFLDB-ISSUE-093` (Resolved),
  so this is no longer blocked on a database. §6 recovery of the old database is obsolete for
  the rebuild path; `AFLDB-ISSUE-090`'s release-gate validation resumes against the rebuilt
  database.

## AFLDB-ISSUE-095 — Canonical legacy-free ladder / team-season acquisition

- **Severity:** Medium
- **Area:** Data acquisition / Import architecture / Data integrity
- **Key files:** `AFLDB-ISSUE-095.md` (runbook, durable source of truth);
  `tools/migration/rebuild_derived.py` (`REBUILDS["club_seasons"]`, `:312`);
  `tools/migration/import_legacy_afl.py` (`:767`, `:776`, `:795`, `:996`, `:1021`);
  `src/db/migrations/006_draft_relationships.sql` (`:55-80`);
  `src/db/queries/player-derived.ts` (`recomputeClubSeasons`, `:402-411`);
  `tools/db/rebuild-test.ts` (Stage 9); `data/reference/sources.json`
- **Current state:** OPEN, nothing implemented. Proven during ISSUE-093's first complete
  canonical clean rebuild (`AFLDB-ISSUE-093.md` §H15.5): `club_seasons` is built **only** from
  `staging.team_seasons`, whose **only** writer is `import_legacy_afl.py` under
  `AFLDB_LEGACY_SQLITE`. The canonical rebuild deliberately has no legacy staging-load stage,
  so `club_seasons = 0` is the *expected* outcome of a legacy-free rebuild, not a defect in it.
  Degraded while empty: ladders, premiership/wooden-spoon flags, finals counts and club-season
  NL answers (`clubs.ts`, `seasons.ts`, `rounds.ts`, `grid-solver.ts`, `search.ts`,
  `db-health.ts`, `player-derived.ts`, `nl/club-season.ts`, NL `parser`/`plan`/`vocab`,
  `lib/edit/spec.ts`). Also note `recomputeClubSeasons` fails closed on an empty
  `staging.team_seasons`, so match create/delete/score-edit throws for every season on a
  canonically rebuilt database — by design, not a new defect.
- **Exact next action:** Settle decisions **D1–D7** in `AFLDB-ISSUE-095.md` §5 as an approved
  plan before writing any importer — authoritative non-legacy source; per-field
  reconstructed-vs-externally-sourced split across `played`/`wins`/`draws`/`losses`/
  `points_for`/`points_against`/`percentage`/`premiership_points`/`ladder_rank`/
  `wooden_spoon`/`is_premier`/`finals_played`; historical premiership-points rules, byes,
  forfeits and published rankings; provenance `source_id` (the SQL currently hardcodes
  `sports_data_lab`, which match-derived rows must not inherit); `afldb_identity_for_season`
  club-identity re-pointing; new rebuild stage vs existing stage; then the Stage-9 gate.
  **ZERO supported `AFLDB_LEGACY_SQLITE` dependency.**
- **Do NOT** add a `club_seasons` non-zero Stage-9 gate until this lands — it would fail every
  canonical rebuild over a known, deliberate gap.
- **Links:** `AFLDB-ISSUE-093` (Resolved 2026-08-27, this issue is its recorded follow-up) and
  `AFLDB-ISSUE-015` (Resolved 2026-08-22, per-season `recomputeClubSeasons` parity) —
  **linked, not absorbed**; ISSUE-015's status is unchanged.

<!-- RETIRED 2026-08-27 — `AFLDB-ISSUE-093` is RESOLVED (see `issues.md` and
     `AFLDB-ISSUE-093.md` §H15). The detail block below is retained as lineage only. It is NOT
     an open issue and its "next action" text is SUPERSEDED: the first clean rebuild has since
     been executed and passed all nine stages with 13/13 final validation, and the only
     remaining follow-up is `AFLDB-ISSUE-095` above.

## AFLDB-ISSUE-093 — Deterministic afldb_test rebuild from authoritative sources (RETIRED)

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
- **Checkpoint (2026-08-27) — read `AFLDB-ISSUE-093.md` §19 first; it supersedes the
  per-phase history above.** Canonical full-history fitzRoy source FROZEN
  (`full-history-20260827`, 1897–2025, accepted via
  `data/reference/fitzroy-accepted-baselines.json` under `exactly_one_accepted`); DraftGuru
  Stage A + supported importer COMPLETE; legacy `import_draft.py` tombstoned; orchestrator
  `npm run db:test:rebuild` implemented but **never executed**. Stage B3 optional, not
  started.
- **Blocker 2 — RESET_SQL proof: IMPLEMENTED, awaiting execution (2026-08-27, §20).**
  Two real defects found and fixed while inspecting it: `runSql` never sent the SQL at all
  (`void client.unsafe(...)` — postgres.js only executes on `.then`/`.execute()`), so the
  destructive stage would have reported success against an untouched database; and the
  `pg_` schema exclusion (`NOT LIKE 'pg\\_%'` through two escaping layers) excluded nothing,
  so `DROP SCHEMA pg_toast` would have aborted the first loop. New rollback-only proof
  `tools/db/prove-reset.ts` + `npm run db:test:prove-reset`; DB-free suite 417/417.
- **Execution-path parity correction (2026-08-27 review, §20.5).** The proof originally ran
  `RESET_SQL` through postgres.js while the real rebuild ran it through psql — proving the
  SQL and leaving the mechanism untested. Now both go through one shared helper
  `tools/db/psql.ts` with identical binary and argv; the proof's stream always ends in
  `RAISE EXCEPTION`, so psql cannot commit it and **exit status 0 is treated as a failure**.
  psql availability is probed through the reset's own argv and fails closed before the reset.
  Owner policy hardened to a refusal: `current_user` and `session_user` must both be exactly
  `afldb_owner`, neither a superuser (§20.5a).
- **INCIDENT 2026-08-27 — THE ROLLBACK PROOF COMMITTED THE RESET; `afldb_test` WAS WIPED
  (§20.9a, §20.12).** psql exited 0 instead of aborting, and the read-only verification then
  returned MISMATCH: pre-proof `0229d62c…` → post-incident `f46ce34c…`, i.e. schemas 1
  (`public` only), relations 0, migrations absent, extensions 3 with all 56 extension-owned
  objects intact. **That is exactly the intended clean slate, so `RESET_SQL` is now
  empirically correct; the rollback containment is what failed.** Production and `afldb_dev`
  were never targeted. Loss was schema + privileges only — no fitzRoy import had ever run.
  Leading cause: the psql argv led with the DSN, and PostgreSQL's own non-permuting
  `getopt_long` (Windows) can then swallow `--single-transaction` and `ON_ERROR_STOP=1` as
  operands, leaving psql to autocommit each statement and exit 0 regardless of errors; the
  stream itself is byte-clean (0 CR, 0 backslashes, 0 NUL, balanced dollar tags, sentinel
  correctly wrapped in a `DO` block). Fixed: DSN passed as `-d`, a probe that fails unless
  stdin is delivered AND a raising script exits non-zero, a deferred-constraint commit trap
  armed before the reset that also detects autocommit and stops the stream before the first
  destructive statement, and redacted relaying of psql's output. `db:privileges[:test]` moved
  off the same argv shape.
- **SELF-COLLISION FOUND AND FIXED 2026-08-27 (§20.14), reproduced twice.** The hardened
  proof refused with "1 other client session(s) connected" while a standalone psql check saw
  none and the phantom vanished on exit. Cause confirmed from the connection lifecycle: the
  CLI held ONE postgres.js observer open across the whole proof, so psql — a second backend —
  correctly counted it, while the Node-side gate could not see itself
  (`pid <> pg_backend_pid()`). The gate was right; the harness was the intruder. Corrected to
  three phases with nothing spanning the psql run: observation session opened and CLOSED,
  then psql only, then a FRESH session for the post-rollback fingerprint. `ProofDeps` now
  exposes `withSession` rather than a `query` handle, so no connection can be kept open, and
  **no application_name/PID/role exemption was added** — asserted by test.
- **RESET BLOCKER 2 CLOSED 2026-08-27.** `afldb_test` reconstructed after the incident
  (migrations 001–072, privileges reconciled, PostgreSQL 16.15, `afldb_owner` non-superuser)
  and the rollback-only proof re-run against a real schema: pre-reset and post-rollback
  fingerprints both `a8a2a899e431ced96afe2d80b4ec258b31533ae27c58791b5e8bf05e0bd0e1d7`
  (exact equality), health 950 relations / 3 extensions, psql exit 3 (the deliberate abort),
  1498 ms; inside the aborted transaction every rebuild-owned object class was 0 and the
  public schema, 3 extensions and 56 extension-owned objects were preserved.
- **Exact next action:** **FIRST ACTUAL CLEAN REBUILD**, fresh session, per the **FIRST CLEAN
  REBUILD HANDOFF (§H1–§H10)** at the end of `AFLDB-ISSUE-093.md`. The database holds
  migrated schema and privileges only — no canonical data has ever been loaded. The agent may
  inspect and prepare; the user runs the destructive command.
- **Superseded next action:** decide sequencing (§20.13). `afldb_test` is now an empty clean
  slate, so re-running the proof against it proves little. **Tell Codex before it touches
  `afldb_test` for ISSUE-083** — its schema and per-object grants are gone. Blocker 2 stays
  OPEN. Do **not** start the clean
  rebuild until it passes. Remaining blockers after that: ISSUE-083 restricted
  `afldb_import` parity (Codex, separate worktree, do not absorb), then the first actual
  clean rebuild. Preserved `afldb_test_pre_rebuild_20260825` stays locked, never an input.
  ISSUE-092 §11 tests 24–27 still pending.
-->
