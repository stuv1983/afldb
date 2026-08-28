# AFLDB Current Issues Index

> Lightweight session index of **open issues only**.
>
> `issues.md` is the authoritative detailed ledger. If this file and
> `issues.md` disagree, trust `issues.md` and immediately synchronize this file
> and the Open Issues table at the top of `issues.md`.

**Last updated:** 2026-08-28
**Open issues:** 12

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
| `AFLDB-ISSUE-068` | Medium | UI/Hydration | React #418 remains intermittent under production-style NL search hydration; narrow H7 diagnostic is awaiting authoritative live-build validation. |
| `AFLDB-ISSUE-076` | Medium | Performance | `won_final_at_venue` Grid Solver combinations can exceed the 5-second PostgreSQL statement timeout and crash the rendered page. |
| `AFLDB-ISSUE-090` | Medium | Data integrity / Import | Confirmed release blocker: club-list DOB enrichment stacks duplicate unresolved `dob_conflict` rows on rerun, and the register pass deletes conflicts it does not own. Migration 072 APPLIED to `afldb_test`; dob-enrichment suite GREEN 23/23; release-gates validation HALTED, blocked by `AFLDB-ISSUE-092`. |
| `AFLDB-ISSUE-092` | Medium | Data integrity / Tooling safety | §4 fail-closed gate + §5 `--source-key` containment IMPLEMENTED (2026-08-25, ISSUE-093 Phase 3; reusable `check_population_drop()` in `common.py`). Database validation (§11 tests 24–27) still pending, but **no longer blocked on a database**: `afldb_test` was rebuilt and validated on 2026-08-27 by `AFLDB-ISSUE-093` (Resolved). §6 recovery obsolete for the rebuild path. Blocks `AFLDB-ISSUE-090`. |
| `AFLDB-ISSUE-095` | Medium | Data acquisition / Import architecture / Data integrity | `club_seasons` has no canonical, legacy-free acquisition path — `rebuild_derived.py` builds it only from `staging.team_seasons`, whose sole writer is `import_legacy_afl.py` under `AFLDB_LEGACY_SQLITE`. A clean canonical rebuild therefore correctly yields `club_seasons = 0`. Runbook `AFLDB-ISSUE-095.md`; decisions D1–D7 open. Stage 9 must NOT gate `club_seasons` until this lands. |
| `AFLDB-ISSUE-096` | Medium | Data acquisition / Import architecture | Parent architecture/contract issue for 2026+ API-first acquisition. **HALT LIFTED 2026-08-28** — decisions A–H and §12 approved (`AFLDB-ISSUE-096.md` §14); now foundation implementation S1–S4, still **no family-specific importer**. Evidence baseline: P3/P4/P5/P6 PASS; **P1/P2 RE-RUN 2026-08-28 with the supplied Kali key — both PASS**; P7 still BLOCKED. **P1 falsified an approved S1 declaration**: Kali `/matches` is NOT a Squiggle proxy, so Squiggle+Kali are now TWO match witnesses (`/fixture` stays a proven proxy). **S1 IMPLEMENTED + AMENDED** (GREEN 34/34); **S2 COMPLETE and GREEN 2026-08-28 — final post-hygiene run 61/61, 0 failures, 303 ms** (first run 59/61; the two red source-contract assertions were **confirmed false positives** — both `[^;]*` regexes spanned the migration's own explanatory comments — and the **tests** were repaired to inspect executable SQL statements; migration unchanged, append-only and A→B→A invariants intact). §16.4 hygiene fixed: the NUL bytes in `observations.ts:499` are now source escapes (same character, keys byte-identical — the proposed space separator was **rejected** as semantics-changing and ambiguity-permitting) and the stale "migration 073" header reads 074. Migration **074** (073 is ISSUE-086's `data_overrides`) **UNAPPLIED**; no CHANGELOG entry required at this checkpoint. **S3 COMPLETE and GREEN 2026-08-28 — `84/84`, 0 failures, 316 ms** — `src/lib/acquisition/reconciliation.ts` computes Decision C's ten verbs from a live payload against the stored open version with an exported precedence, reusing S2's ownership predicate and authority boundary; foreign **and unreadable** ownership fail closed before authority is asked, agreement never substitutes for authority, and a payload change moving no projected fact field returns the verb-less `history_only` outcome (settled, not an eleventh verb). **S4 IMPLEMENTED 2026-08-28 and AWAITING VALIDATION (§16.10)** — new pure `src/lib/acquisition/promotion-review.ts` carries the review contract: the candidate record with 074's CHECKs enforced in TypeScript, a `baselineCanonicalHash` over **exactly the proposed fields** (ordering-independent, null for a `new` target), `renderReviewItem`, `evaluateAcceptRequest`, the requeue-vs-supersede rule, and reject/requeue decision drafts; render and accept both recompute the baseline from re-read values and then delegate to **S2's `evaluateAcceptance`**, so its gate order and the `stale_review`/`stale_canonical_target` distinction are unchanged. `observations.ts` gained one additive, behaviour-preserving export (`canonicalJson`) so canonical values are never hashed under a family's *payload* exclusions. **§7's gate is intact by construction:** no `'accept'` decision is representable, a cleared evaluation still returns `write.implemented: false`, and `UNAVAILABLE_MANUAL_AUTHORITY` refuses every promotable verb including `new`. **S4 COMPLETE and GREEN 2026-08-28 — `105/105`, 0 failures, 357 ms** on the final post-hygiene run, user-run: the promotion-review contract renders the approved candidate evidence, hashes a baseline over **exactly** the proposed/touched fields (deterministic, ordering-independent; unrelated canonical changes do not stale a review, proposed-field changes do), keeps moved source evidence and a moved canonical baseline as **distinct** stale outcomes, re-runs every acceptance gate fail-closed (provider agreement never substitutes for authority; foreign and unreadable ownership refuse; authority conflict and indeterminate/unavailable refuse; season ownership enforced), rejects without mutating canonical facts or observations, and exposes no force/override/bypass/consensus path. **The canonical acceptance/write transaction is deliberately NOT implemented** — the write, provenance quartet and real `accept` decision row stay blocked behind ISSUE-086's authority contract, `PromotionDecisionDraft` cannot represent an acceptance, and a fully cleared gate still reports the write as unimplemented. NUL hygiene RESOLVED (user-performed byte repair, verified). Migration 074 UNAPPLIED; no production/`afldb_dev` work; **no approved S5 exists** — §11 stops at S4. `AFLDB-ISSUE-100` remains separate and does not block this checkpoint. **PostgreSQL validation phase HALTED AT PREFLIGHT 2026-08-28 and BLOCKED (§16.13):** `npx tsx tools/db/migrate.ts --status --target test` proved the target is `afldb_test` (73 of 74 applied) and then **refused** because applied migration `073_data_overrides.sql` (**ISSUE-086's**) fails the checksum guard. 074 was **NOT applied and NOT modified**; no database was written; S1–S4 stay green. Line-ending and algorithm causes are eliminated (ISSUE-091's three-representation tolerance; 72 rows validated in the same pass); Git shows **one committed 073 blob only** (`a8ad3079…`, in `2a068a8`/`e0d64aa`), clean worktree, no stashes — so **no committed revision matches the applied artefact** and `dev` holds **no** invalid mutation of an applied migration. **CONFIRMED by the ledger:** stored `47937827…`, committed canonical-LF `778c5bfb…`, applied `2026-08-28 01:54:41.063665+10` — **1 h 1 min 48 s before** the sole committed revision existed (`2026-08-28 02:56:29+10`), so an **uncommitted intermediate** version was migrated and then changed before commit. **Repair owned by `AFLDB-ISSUE-086`** (database-ledger coherence, not history surgery); **a later corrective migration cannot fix it alone** — the runner validates applied checksums before running anything, so the baseline must be made coherent first, and `afldb_test` must **not** be rebuilt from this worktree while pending 074 lacks its §16.14 FK indexes. **074 has NOT failed — it was never executed.** Held for resumption: 074's **three uncovered FKs** must be indexed before it is applied (§16.14), and three of eight §5.H assertions are **BLOCKED** — manual authority, the `data_issues` row (never implemented), rollover supersession (§16.15). |
| `AFLDB-ISSUE-097` | Medium | Data acquisition / Data integrity | **P1 gate CLEARED 2026-08-28.** `/v1/fixture` is a proven verbatim Squiggle proxy (one witness), but `/matches` is proven **NOT** a proxy (two witnesses) — so corroboration must be counted **per family**. Next: rewrite `sourceDisagreements` / `--source all` against ISSUE-096's independence groups. |
| `AFLDB-ISSUE-098` | Medium | Data integrity / Import | Four source-verified defects in the shipped current-season importer: fabricated `venue_raw = 'Unknown'`, half-match canonical inserts, correction-indistinguishable-from-deletion staging, incoherent counters. Independently actionable. |
| `AFLDB-ISSUE-099` | Medium | Data acquisition / Import architecture | 2026 has no player stats, period scores, attendance or Brownlow votes. Nightly in-season AFL Tables settle pass. Depends on ISSUE-096; gated on probe P5. |
| `AFLDB-ISSUE-100` | Medium | Data acquisition / Import architecture | Staging-only lineup/team-announcement domain fed by `fetch_lineup_afl`. **Never canonical participation.** Depends on ISSUE-096; gated on probe P3. |
| `AFLDB-ISSUE-101` | Medium | Data acquisition / Import architecture / Data integrity | End-of-season promotion / baseline rollover. Depends on ISSUE-099 plus coordination with ISSUE-095. **Must not redefine completed-season `club_seasons` ownership.** |
| `AFLDB-ISSUE-102` | Medium | Data acquisition / Import architecture | `import_awards.py:1408` still requires `AFLDB_LEGACY_SQLITE` — the awards sibling of the ISSUE-095 gap. **Record only; do not design the replacement.** |
<!-- RETIRED 2026-08-27 — `AFLDB-ISSUE-093` is Resolved and is NO LONGER an open issue.
     Do not read the commented-out row below: it is the pre-resolution index row, kept only
     as lineage, and its "NEXT PHASE"/"next action" text is SUPERSEDED — the first clean
     rebuild has since PASSED (nine stages, 13/13 final validation). Authoritative records:
     the `AFLDB-ISSUE-093` entry in `issues.md` and `AFLDB-ISSUE-093.md` §H15. The only
     remaining follow-up is `AFLDB-ISSUE-095`, listed above as an open issue.

| `AFLDB-ISSUE-093` | Medium | Tooling / Data integrity / Import architecture | **CHECKPOINT 2026-08-27 — CANONICAL FULL-HISTORY FITZROY SOURCE FROZEN. Read `AFLDB-ISSUE-093.md` §19 first — it is the authoritative current-state record.** Accepted baseline `full-history-20260827` (1897–2025, 131 artefacts, 719,042 rows), hash-bound via `data/reference/fitzroy-accepted-baselines.json` (`exactly_one_accepted`, no latest-label fallback) and independently revalidated offline with no PostgreSQL access. Phases 1–4a COMPLETE; DraftGuru Stage A/B1/B2-1..B2-8 COMPLETE (supported `import_draftguru.py`, tracked link ledger, legacy `import_draft.py` tombstoned); orchestrator `npm run db:test:rebuild` IMPLEMENTED (normal mode auto-selects the accepted baseline; validator runs before any destructive stage). **417/417 DB-free tests.** **RESET BLOCKER 2 CLOSED 2026-08-27 — live rollback proof PASSED (`a8a2a899…` → `a8a2a899…` exact, 950 relations, psql exit 3, 1498 ms). `afldb_test` reconstructed: migrations 001–072 + privileges, schema only, NO canonical data. NEXT PHASE: FIRST ACTUAL CLEAN REBUILD — read the FIRST CLEAN REBUILD HANDOFF (§H1–§H10) at the end of `AFLDB-ISSUE-093.md`.** Incident lineage retained in full and not rewritten: Building the proof had already found and fixed two real defects (`runSql` never sent the SQL at all — `void client.unsafe(...)`; and the `pg_` schema exclusion excluded nothing, so `DROP SCHEMA pg_toast` would have aborted the first loop). The live run then exited 0 without aborting and the reset committed: pre-proof `0229d62c…` → post-incident `f46ce34c…`. **`RESET_SQL` has therefore now RUN against live PostgreSQL and produced exactly the intended clean slate (schemas 1, relations 0, migrations absent, 3 extensions and all 56 extension-owned objects preserved) — its semantics are validated; the ROLLBACK CONTAINMENT is what failed and remains unproven.** Production and `afldb_dev` untouched; loss was schema + privileges only, no import had ever run. No clean rebuild has been executed. **SELF-COLLISION FIXED (§20.14):** the hardened proof then refused twice with "1 other client session(s) connected" — the harness's own postgres.js observer, held open across the psql run; corrected to three phases with nothing spanning the reset, gate unchanged and no session exempted. Key files: `AFLDB-ISSUE-093.md` §19–§20, `AFLDB-ISSUE-093-DRAFTGURU-B2-HANDOFF.md` PART I–XVIII, `tools/db/rebuild-test.ts`, `tools/db/prove-reset.ts`, `tools/migration/import_fitzroy_core.py`, `tools/rebuild/draftguru/import_draftguru.py`, `data/reference/*.json`. **EXECUTION-BOUNDARY AUDIT 2026-08-27 (§H11) — the first clean rebuild is NOT READY: three blockers. F1 `db:migrate:test`/`db:privileges:test` are POSIX-shell scripts and npm on Windows runs them under `cmd.exe`, so stages 3 and 4 fail *after* the destructive stage 2 wipes the database (remedy proven: `npm_config_script_shell=bash`, which also propagates to the nested `npm run` calls). F2 `AFLDB_TEST_IMPORT_DATABASE_URL` is unset on `dev` (ISSUE-083 parked at `fa035ed`), so `resolveTarget()` refuses before preflight — operator must set it or pass `--allow-owner-import-dsn`. F3 stage 9 FINAL VALIDATION is declared `run: 'internal'` and `executeRebuild()` has no `internal` branch, so it does nothing and `FINGERPRINT_QUERIES` is never called — the run cannot fail closed on validation/fingerprint mismatch as §H9 requires. F4 (no DB identity/session/psql-probe gate in the orchestrator) and F5 (no lock/statement timeout on the destructive reset) are recorded and compensated by operator-run read-only checks. `.env` loading, the psql argv, accepted-baseline selection, DraftGuru inputs and the zero-`AFLDB_LEGACY_SQLITE` boundary all audited CORRECT. **REMEDIATED 2026-08-27 (§H11.8): F1 and F3 are RESOLVED.** `db:migrate:test` is now `tsx tools/db/migrate.ts --target test` (new `--target` flag; `AFLDB_MIGRATE_TARGET` still supported, a disagreement is a refusal) and `db:privileges`/`db:privileges:test` route through new `tools/db/privileges.ts`, which resolves the DSN in Node — psql invocation otherwise unchanged, script names unchanged. Stage 9 is now a real `validate` stage with its own `deps.runValidation` separate from the destructive `runSql`: 13 gates bound to the accepted register's `measured` block plus `matches_after_accepted_last_season = 0`, `draft_persons` and `draft_picks`; an unrecognised measured key is a refusal so the gate cannot silently shrink; read-only, reports every value, fails the run on any mismatch. `FINGERPRINT_QUERIES` removed. **182/182 DB-free tests** in `tests/db-test-rebuild.test.ts`. **FIRST CLEAN REBUILD ATTEMPT 1 FAILED AT STAGE 5 — REPAIRED (§H12, 2026-08-27).** PRECHECK/RESET/MIGRATIONS 72-72/PRIVILEGES all passed; REFERENCE died on `psycopg.errors.InsufficientPrivilege: permission denied for table player_link_match_candidates` in `guard_cascade()`, which probed every transitive FK dependent of its truncate roots with `SELECT count(*)`. Root cause: `privileges.sql` grants `afldb_import` SELECT on a **base table** only via `import_writable_tables`; `app_readable_tables` is consulted only for views. Migration 045 seeded that registry from the tables existing then, so every base table created after 045 is revoked unless its migration calls `grant_import_write()` — migration 067 registers the candidate cache app-read ONLY, by design (migration 070 reasons about that exact table). The closure is 30 relations and **two** are unreadable: `player_link_match_candidates` (067) and `player_match_period_stats` (062, direct `club_id → clubs` FK) — so a one-table grant would have failed on the next relation. **Repair (no grant added, `privileges.sql` UNCHANGED):** `guard_cascade()` now classifies dependents via `has_table_privilege()` (new `common.selectable()`), counts rows only in proven-readable ones, and REFUSES on any it cannot prove empty; new `reload_truncate()` skips a TRUNCATE whose targets are already empty, since `TRUNCATE … CASCADE` needs privileges on the whole cascade set. On a clean rebuild the roots are always empty, so no closure relation is read or locked and a future migration cannot reintroduce the failure. **204/204 DB-free tests** (`reference-data` + `db-test-rebuild`), `py_compile` OK, no new tsc errors. `afldb_test` holds migrated+privileged schema and ZERO rows (the guard refuses before any write) — the post-stage-4 state. **BOUNDED STAGE-5 PROOF 1 FAILED SAFELY — REPAIRED AGAIN (§H13).** The §H12 repair was necessary but NOT sufficient and its "complete" claim is amended in place. Root cause of the second failure: **a freshly migrated database is not empty** — migrations 015 and 016 SEED `stat_definitions` and `stat_availability`, both truncate roots of the `coverage` group. `guard_cascade()` evaluated emptiness and took its cascade closure over the **union of every group's truncate targets** while `reload_truncate()` decides per group at call time, so the union short circuit could never fire and the closure of the EMPTY `clubs`/`seasons` roots (whose truncates would have been skipped) was adjudicated anyway — refusing over a cascade that was never going to happen. Hypotheses #1/#2/#3/#4 confirmed, #5 rejected. **Repair:** closure is now taken from `populated_roots` only (on a fresh DB that is `{stat_definitions, stat_availability}`, whose closure is just `stat_availability` — in the loader's own rebuild set, so `outside` is empty and neither denied relation is touched); and `guard_cascade()`/`reload_truncate()` can no longer disagree — the guard records the roots it adjudicated and the truncate refuses anything outside that set, or if the guard never ran. **New `tests/python/reference_cascade_contract.py`: 19 DB-free BEHAVIOURAL scenarios** driving the real functions against a fake connection that raises if the guard reads a denied relation — §H12's source-string tests passed against wrong control flow, which is the lesson. **206/206** TS tests, `py_compile` OK, no new tsc errors. `privileges.sql` and `src/db/migrations/` still UNCHANGED; `--allow-cascade` still unused. `afldb_test` untouched (the guard refuses before any write) and still in the post-stage-4 state. **FIRST COMPLETE CLEAN REBUILD PASSED — 2026-08-27 (§H15). STATUS: CLEAN REBUILD PROVEN — FINAL POST-REBUILD VALIDATION PENDING.** `npm run db:test:rebuild -- --acknowledge-destroy afldb_test` ran end to end: all NINE stages passed (PRECHECK, RESET, MIGRATIONS 72/72, PRIVILEGES, REFERENCE, FITZROY, DRAFTGURU, DERIVED, FINAL VALIDATION), with data stages under the **restricted `afldb_import` role** — no `--allow-owner-import-dsn`, no `AFLDB_LEGACY_SQLITE`, not production, not `afldb_dev`. Baseline `full-history-20260827` (131 artefacts, 719,042 rows, manifest `cc8aaf09…`, artefact-set `8e14ce61…`); DraftGuru `annual-html-20260826` (5,057 persons / 6,810 picks / 6 ledger decisions / 5,052 unmatched / 2 seeded). fitzRoy: venues 52, players 13,275, matches 16,838, match_period_scores 134,704, player_match_stats 685,471, brownlow_round_votes 320,861. **Stage 9: `AFLDB-FINAL-VALIDATION PASSED: 13 checks`**, including `matches_after_accepted_last_season = 0` (2026 correctly excluded). Two defects were exposed only by real execution under the restricted role and are now repaired: the REFERENCE cascade guard (§H12/§H13 — `afldb_import` correctly denied `player_link_match_candidates`/`player_match_period_stats`; migrations 015/016 SEED `stat_definitions`/`stat_availability` so the empty-root assumption was false; repair scopes cascade analysis to populated roots, **`privileges.sql` unchanged, no grant added**) and fitzRoy corrections-parameter threading (§H14 — both import phases repaired, `corrections` now required). **`club_seasons = 0` RESOLVED as SEPARATE FOLLOW-UP (§H15.5, source-proven 2026-08-27) — it does NOT invalidate the core rebuild.** The only writer of `staging.team_seasons` is `tools/migration/import_legacy_afl.py` (`:767/:776/:795`, group key `"ladders"`), which requires `AFLDB_LEGACY_SQLITE` (`:1021`). `REBUILDS["club_seasons"]` selects `FROM staging.team_seasons`, so an empty staging table correctly yields zero rows. The ladder/team-season domain therefore has **no canonical acquisition path yet** and was never in the nine-stage contract — zero is the *expected* outcome of a legacy-free rebuild, not a defect in it. Real degradation while empty: ladders, premiership/wooden-spoon flags, finals counts and club-season NL answers (`clubs.ts`, `seasons.ts`, `rounds.ts`, `grid-solver.ts`, `search.ts`, `db-health.ts`, `player-derived.ts`, `nl/club-season.ts`, NL `parser/plan/vocab`, `lib/edit/spec.ts`). fitzRoy can derive `played/wins/draws/losses/points_for/points_against/percentage` (and already derives `is_premier`/`finals_played`); `ladder_rank` and `premiership_points` need an external ladder source — both are nullable in the schema, so a partial rebuild is schema-legal but needs a provenance decision (the SQL hardcodes `source_id` = `sports_data_lab`). **Stage 9 must NOT gate `club_seasons` until the domain lands**, or every canonical rebuild would fail on a known gap. Next action: **record a follow-up issue for canonical legacy-free ladder/team-season acquisition + load stage + Stage-9 gate (determine the next unused id from `issues.md`/`IssuesIndex.md` — NOT `AFLDB-ISSUE-094`, already used by NL semantic mapping; link `AFLDB-ISSUE-015` and `AFLDB-ISSUE-093`, do not absorb ISSUE-015), then ISSUE-093 can be marked Resolved — 2026-08-27.** Do NOT start DraftGuru Stage B3; do NOT merge the parked branches. **ISSUE-059 (`4444d76`) and ISSUE-073 (`0885129`) are now UNBLOCKED** for their own focused DB-backed validation against the rebuilt database, as separate work. Do NOT start DraftGuru Stage B3 (optional, not a blocker); do NOT merge the parked branches — ISSUE-083 is complete and parked at `fa035ed`, ISSUE-059 at `4444d76`, ISSUE-073 at `0885129`.** |
-->

---

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

## AFLDB-ISSUE-096 — 2026+ API-first acquisition architecture and contract

- **Severity:** Medium
- **Area:** Data acquisition / Import architecture
- **Runbook:** `AFLDB-ISSUE-096.md` — **durable source of truth for this issue**.
  `AFLDB-2026-API-ACQUISITION.md` is the parent investigation runbook (§4, §9 row A, and §13 for
  the dated P1–P7 probe results).
- **Key files:** `data/reference/source-families.json` (new, S1),
  `src/lib/acquisition/source-families.ts` (new, S1), `tests/reference-data.test.ts` (extended);
  `src/db/migrations/074_source_observation_spine.sql` (new, S2, **unapplied**),
  `src/lib/acquisition/observations.ts` (new, S2), `src/lib/acquisition/reconciliation.ts`
  (new, S3), `tests/current-season-import.test.ts` (extended, S2+S3);
  orientation only: `src/lib/external-afl/current-season-import.ts`,
  `src/db/migrations/063_external_current_match_sources.sql`, `064_matches_external_provenance.sql`
- **Approval:** **HALT LIFTED 2026-08-28.** Decisions A–H and the §12 items approved and recorded
  verbatim in `AFLDB-ISSUE-096.md` §14: three-grain observation model; retain
  `staging.external_current_matches`; **no automatic canonical promotion in v1**; ISSUE-086
  authority boundary is interface-and-invariant only; Kali sits in the Squiggle independence group;
  **P1/P2/P7 are not retried** and no local database substitutes for P7. The issue is now
  foundation implementation S1–S4; family importers remain excluded.
- **S1 IMPLEMENTED (2026-08-28):** tracked source-family registry + pure fail-closed typed parser
  + DB-free contract tests. **Seven** families over four sources; **no family is promotable**;
  AFL API lineup columns deliberately `incomplete` so a round-20 payload refuses;
  `afltables.player_match_stats` and `kali_afl_stats.player_stats` are `identity_only`. No
  migration, no importer, no `sources.json`/`seasons.json` change.
- **P1/P2 RE-RUN 2026-08-28 (user supplied `KALI_AFL_API_KEY` and authorised the retry) — both
  PASS, and P1 AMENDED S1.** Kali `/matches` is **not** a Squiggle proxy: a genuine value
  disagreement on a completed match (Essendon v Port Adelaide 2026-08-23, Kali 95–105 vs
  Squiggle 95–104 at `complete=100`), `crowd` on 80/204 rows where Squiggle has no attendance
  field, 0 shared ids, a different venue vocabulary on 80/160 joined games, no goals/behinds.
  `kali_afl_stats.match` therefore moved to its own `kali` group and to a fully declared
  14-column shape (`sourcedAt` = `source_updated_at`, new `kali_2026` round vocabulary);
  `/fixture` stays a proven proxy in the `squiggle` group. **P2:** no player id on the Kali stat
  grain, so a new `kali_afl_stats.player_stats` family records the gap as `identity_only`.
  **Residual, flagged for review:** P1 disproves *pairwise* derivation; a *common ultimate
  upstream* is not excluded. **P7 stays BLOCKED; no local database substitutes for it.**
- **Current state:** Evidence baseline established 2026-08-28:
  **P3/P4/P5/P6 PASS**, **P5 stop condition NOT triggered** (`url` is 0 NA and 1:1 with `ID`, but
  **`ID` is 82 NA in-season — key on `url`**); **P1/P2 BLOCKED**, no `KALI_AFL_API_KEY`;
  **P7 BLOCKED**, SSH refused and **no database queried**. Contract drafted: three observation
  grains (immutable payloads / ordered versions / current-key state, so A→B→A stays three ordered
  states while repeat polling stays idempotent), reconciliation verb set, reviewed-promotion
  contract with a stale-review recheck, source containment, independence groups, season lifecycle.
- **S2 IMPLEMENTED (2026-08-28), DB-free suite GREEN, migration still unapplied:** `src/db/migrations/074_source_observation_spine.sql`
  (**unapplied**) — three observation grains + `promotion_candidates` + append-only
  `promotion_decisions`; `src/lib/acquisition/observations.ts` (pure: no DB/fs/network/clock);
  `tools/maintenance/privileges.sql` registered so the append-only grant survives a reconcile;
  28 DB-free tests. A→B→A stays three versions over two payloads because history is keyed
  by `version_seq` and **never** unique on `payload_hash`. Acceptance fails closed, and manual
  authority `indeterminate` refuses exactly as `conflict` does.
- **Validation 2026-08-28, three runs: 59/61 (FAILED) → 61/61 (PASSED) → post-hygiene 61/61,
  0 failures, 303 ms (PASSED). S2 IS COMPLETE AND GREEN.** All behavioural tests passed every
  time. The two red assertions
  (`:653` append-only grants, `:668` history uniqueness) were **confirmed false positives**:
  `[^;]*` is not a SQL statement boundary, so both regexes spanned the migration's own
  explanatory comments. Only the **tests** were repaired — a `sqlStatements()` helper strips
  `--` comments and splits on `;`, and the assertions now pin the complete set of executable
  GRANTs on `promotion_decisions` and the single `UNIQUE` statement on the versions table.
  Migration unchanged, no invariant weakened (`AFLDB-ISSUE-096.md` §16.3).
- **S2 hygiene FIXED 2026-08-28 (§16.4):** the two literal NUL bytes in `observations.ts:499`
  are now `U+0000` escapes — **same character, so `observationKey()` output is byte-identical**;
  the runbook's suggested "plain space" separator was NOT adopted, as it would change runtime
  semantics and let a value containing a space make a key ambiguous. Header corrected to
  "migration 074". `073_data_overrides.sql` (ISSUE-086) still observed, not investigated (§16.5);
  `privileges.sql:294`'s "Migration 073" is ISSUE-086's and is correct.
- **S3 COMPLETE and GREEN 2026-08-28 — user-run `npm test -- tests/current-season-import.test.ts`:
  `84/84`, 0 failures, 316 ms.** `src/lib/acquisition/reconciliation.ts` (new, pure: imports only
  `./observations` and `./source-families`) computes exactly Decision C's ten verbs from a live
  payload against the stored open version, precedence exported as `VERB_PRECEDENCE`:
  `stale_review → absent → unchanged → unresolved_identity → foreign_owned_collision →
  source_disagreement → manual_authority_conflict → new / rescheduled / corrected`. Structural
  evidence resolves before content; refusal gates run only when a canonical change is actually
  proposed; `unchanged` comes only from the family hash contract; `rescheduled` stays distinct from
  `corrected`; `absent` is observation state and never deletion; `source_disagreement` needs
  disagreeing **independence groups**, not two source rows; foreign **or unreadable** ownership
  fails closed **before** authority is asked; provider agreement never substitutes for authority;
  `conflict` and indeterminate authority both fail closed; no database/network/filesystem/clock/
  write path, and no force, override or consensus shortcut.
- **`history_only` — settled S3 outcome, not an eleventh verb.** A changed payload that advances
  history but moves **no projected canonical fact field** (Squiggle completion `90 → 100`) returns
  `history_only`: not in `RECONCILIATION_VERBS`, not a candidate verb, not a canonical change —
  history advances with no fact-level proposal. Calling it `unchanged` would erase a real
  source-state transition; calling it `corrected` would propose a candidate with no changed fields.
  Do not redesign unless S4 integration evidence contradicts it.
- **S4 IMPLEMENTED 2026-08-28, AWAITING VALIDATION (§16.10).** New pure module
  `src/lib/acquisition/promotion-review.ts`: the candidate record with migration 074's CHECK
  constraints enforced in TypeScript; `baselineCanonicalHash` over **exactly the proposed fields**
  (`sha256/v1(canonical-fields)`, sorted names, sorted keys at every depth, 64 hex chars, null for a
  `new` target, refusal on an unread field); `renderReviewItem`; `evaluateAcceptRequest`; the
  requeue/supersede rule; and reject/requeue decision drafts. Render and accept both run
  `runPromotionGates`, which recomputes the baseline from re-read values and then delegates to
  **S2's `evaluateAcceptance`** — gate order and the `stale_review` / `stale_canonical_target`
  distinction unchanged. `stale_canonical_target` ⇒ re-render in place (stays pending);
  `stale_review` ⇒ **supersede** so reconciliation can insert the replacement. One additive,
  behaviour-preserving change to `observations.ts`: the canonicaliser is hoisted and exported as
  `canonicalJson`, because a family's payload `hash_exclusions` must never be applied to canonical
  values. 20 DB-free tests added to `tests/current-season-import.test.ts`.
- **§7 gate INTACT and enforced by construction.** `PromotionDecisionDraft` has **no `'accept'`
  decision** and typed-`null` value columns, so S4 cannot represent an acceptance; a cleared
  evaluation returns `write: { implemented: false, blockedBy: 'canonical_write_unimplemented' }`
  with `canonicalChange: 'none'`. Under `UNAVAILABLE_MANUAL_AUTHORITY` every promotable verb —
  `new` included — refuses. **Blocked pending ISSUE-086:** the canonical acceptance transaction
  (write + provenance quartet + `accept` decision row) for `corrected`/`rescheduled` onto an
  existing row. No force flag, override, bypass or consensus shortcut added.
- **Checkpoint — all four approved stages complete:** S1 `34/34`, S2 `61/61`, S3 `84/84`, **S4
  complete and green `105/105`** (0 failures, 357 ms, final post-hygiene run, user-run 2026-08-28).
  The **canonical acceptance/write transaction remains deliberately unimplemented** behind
  ISSUE-086's authority gate, and the S4 type/state model must **not** be read as evidence those
  writes exist. `history_only` remains settled as an observation-layer outcome only. Migration
  **074 UNAPPLIED**, with **no production and no `afldb_dev` database work** at any point.
  `AFLDB-ISSUE-100` remains separate. **No CHANGELOG entry** — nothing has landed behaviour.
- **NUL hygiene RESOLVED (§16.11).** Both `observations.ts` and `source-families.ts` carried a raw
  `0x00` where the intended value is U+0000. The assistant located the second one (the
  `parseSourceFamilyRegistry` duplicate-declaration machine key) but **could not repair it
  natively** and stopped for evidence; **the user verified (`cat -A` showed `^@`, proving the
  separator had not become a space) and performed the byte-level repair**, after which
  `grep -naP '\x00'` returned no matches and the suite stayed green. Runtime semantics unchanged.
  PostgreSQL `text` still cannot store U+0000 — a forward concern only if a later stage proposes
  persisting one of these composite machine keys.
- **Exact next action: BLOCKED — `afldb_test` migration baseline must be repaired first
  (`AFLDB-ISSUE-086`).** The authorised PostgreSQL validation phase halted at its preflight on
  2026-08-28: applied migration `073_data_overrides.sql` fails the runner's checksum guard, so no
  migration can be applied to `afldb_test` at all. Migration 074 was **not applied and not
  modified**, and must stay unmodified — including its §16.14 three-FK-index repair — until the
  baseline is coherent. **A later corrective migration cannot repair this on its own**: applied
  checksums are validated before any migration runs, so the baseline comes first. Evidence,
  timestamps and the eliminated hypotheses: `AFLDB-ISSUE-096.md` §16.13.
- **Exact next action once unblocked: none inside ISSUE-096 as approved.** §11 decomposes to S1–S4 and stops, so
  **there is no approved S5** — a next stage is a fresh approval decision (§16.12). Unbuilt work and
  blockers: (1) the canonical acceptance/write transaction — **blocked on `AFLDB-ISSUE-086`** by
  §7's gate; (2) applying migration 074 + the §5.H PostgreSQL tests — **not** ISSUE-086-blocked but
  a separate explicitly authorised step, **`afldb_test` only**; (3) the admin review screen — an
  explicit §2 **non-goal** of this issue. Do not apply migration 074 and do not implement
  ISSUE-086 here.
- **Manual-authority boundary:** ISSUE-096 defines only the invariant and the fail-closed
  interface; the **mechanism/storage (incl. `data_overrides`) belongs to `AFLDB-ISSUE-086`** and is
  not pre-empted. Promotion of `corrected` candidates onto existing rows is gated on that contract.
- **Unblocked by this evidence:** `AFLDB-ISSUE-099` (P5) and `AFLDB-ISSUE-100` (P3) are no longer
  probe-blocked. `AFLDB-ISSUE-098` remains independently actionable.
- **Do NOT** implement any family-specific importer here (`AFLDB-ISSUE-099`, `AFLDB-ISSUE-100`
  own those). Do NOT duplicate `AFLDB-ISSUE-086` or `AFLDB-ISSUE-095`.
- **Approved policy retained:** free sources only; fetch/staging/diff automatic; canonical
  promotion reviewed by default; lineups staging-only; in-progress season only; completed
  seasons re-acquired via the full-history fitzRoy path.

## AFLDB-ISSUE-097 — Squiggle/Kali source independence

- **Severity:** Medium
- **Area:** Data acquisition / Data integrity
- **Runbook:** `AFLDB-2026-API-ACQUISITION.md` §2.1, §9 row B.
- **Key files:** `src/lib/external-afl/current-matches.ts`,
  `src/lib/external-afl/current-season-import.ts` (`sourceDisagreements`)
- **Current state:** OPEN, **both endpoints now settled by live probe (2026-08-28)**.
  `/v1/fixture` returns Squiggle's schema with Squiggle's own ids and timestamps (id `38494`,
  `updated "2026-03-05 22:16:49"`) — a verbatim proxy, so the two are **not** independent
  witnesses for fixtures and `sourceDisagreements` can report self-agreement as corroboration.
  **P1 proves `/matches` is NOT a proxy** (value disagreement on a completed match; `crowd` where
  Squiggle has none; 0 shared ids; different venue vocabulary; no goals/behinds) — full record
  in `AFLDB-2026-API-ACQUISITION.md` §13.1. So the same pair is **one** witness for fixtures
  and **two** for matches: corroboration must be counted **per family**.
- **Still UNKNOWN:** a **common ultimate upstream** is not excluded, so two groups here are
  weaker than two fully independent witnesses — a disagreement is a review signal, never an
  auto-resolution.
- **Exact next action:** P1 is done. Rewrite `sourceDisagreements` and `--source all` to count
  independence groups from `data/reference/source-families.json`, and surface the Essendon v Port
  Adelaide 95–105 / 95–104 case — invisible under the old one-group model.

## AFLDB-ISSUE-098 — Shipped current-season importer defects

- **Severity:** Medium
- **Area:** Data integrity / Import
- **Runbook:** `AFLDB-2026-API-ACQUISITION.md` §1.1, §9 row C.
- **Key files:** `src/lib/external-afl/current-season-import.ts`
  (`:619`, `:607-629`, `:420-439`, `:633`, `:657`)
- **Current state:** OPEN, source-verified. Fabricated `venue_raw = 'Unknown'`; canonical
  inserts creating half-matches with no attendance, period scores or player participation;
  staging `ON CONFLICT DO UPDATE` making a source correction indistinguishable from a
  deletion; counters that can go negative and conflate staging with canonical rows.
- **Exact next action:** Contain the four defects. Probe **P7** is recommended to size the
  live impact but is not required to start.
- **Dependencies:** none — **independently actionable, not dependent on `AFLDB-ISSUE-096` or
  `AFLDB-ISSUE-097`**.
- **Do NOT** duplicate `AFLDB-ISSUE-086`: the unrestricted canonical score overwrite at
  `:567-590` is that issue's behaviour class and is referenced here only.

## AFLDB-ISSUE-099 — In-season AFL Tables settle stage

- **Severity:** Medium
- **Area:** Data acquisition / Import architecture
- **Runbook:** `AFLDB-2026-API-ACQUISITION.md` §2.4, §5, §9 row D.
- **Key files:** `tools/rebuild/fitzroy/acquire_core.R`, `fitzroy-contract.json`,
  `tools/migration/import_fitzroy_core.py`
- **Current state:** OPEN, nothing implemented. 2026 has no player-match statistics, period
  scores, attendance or Brownlow votes. AFL Tables was confirmed by live probe to carry 2026
  through Round 25 (completed 2026-08-23) with per-match player statistics.
- **Exact next action:** Nightly in-season settle pass — partial fitzRoy acquisition
  (`--from/--to`) + SHA-256 manifest, then **reviewed** promotion of matches, period scores,
  attendance, player stats and Brownlow votes, reusing the ISSUE-093 machinery.
- **Dependencies/gates:** depends on `AFLDB-ISSUE-096`; implementation gated on probe **P5**.
  If P5 shows no stable `ID`/`url` for 2026, implementation is blocked — see the §8 stop
  conditions.

## AFLDB-ISSUE-100 — Staging-only lineup / team-announcement domain

- **Severity:** Medium
- **Area:** Data acquisition / Import architecture
- **Runbook:** `AFLDB-2026-API-ACQUISITION.md` §2.5, §9 row E.
- **Key files:** new `staging.external_lineups` (migration not yet written)
- **Current state:** OPEN, nothing implemented. `fetch_lineup_afl` (fitzRoy → AFL.com.au API,
  no key required) is the only free source found that supplies lineups at all.
- **Approved rule — retained explicitly:** **lineups are staging-only and never become
  canonical participation.** Canonical participation remains the played match sheet. No public
  surface.
- **UNKNOWN:** the returned column set and whether AFL provider ids are stable. The staging
  schema cannot be designed until P3 supplies the shape.
- **Exact next action:** depends on `AFLDB-ISSUE-096`; implementation gated on probe **P3**.

## AFLDB-ISSUE-101 — End-of-season promotion / baseline rollover

- **Severity:** Medium
- **Area:** Data acquisition / Import architecture / Data integrity
- **Runbook:** `AFLDB-2026-API-ACQUISITION.md` §5 (rollover row), §9 row F.
- **Key files:** `data/reference/fitzroy-accepted-baselines.json`,
  `data/reference/seasons.json`, `tools/db/rebuild-test.ts` (Stage 9)
- **Current state:** OPEN, nothing implemented. The approved boundary gives the API pipeline
  only the in-progress season, but nothing performs the transition when a season completes.
- **Exact next action:** Extend `fitzroy-accepted-baselines.json` to the completed season,
  supersede in-season provenance, advance `seasons.json.in_progress_seasons`, re-point the
  Stage-9 `matches_after_accepted_last_season` gate.
- **Dependencies:** `AFLDB-ISSUE-099`, plus coordination/completion of the relevant
  `AFLDB-ISSUE-095` canonical ladder/team-season path.
- **Boundary:** **must not independently redefine completed-season `club_seasons` ownership**
  — that remains with `AFLDB-ISSUE-095`. Do not add a `club_seasons` Stage-9 gate here.

## AFLDB-ISSUE-102 — Awards have no canonical legacy-free acquisition path

- **Severity:** Medium
- **Area:** Data acquisition / Import architecture
- **Runbook:** `AFLDB-2026-API-ACQUISITION.md` §2.7, §9 row G.
- **Key files:** `tools/migration/import_awards.py` (`:1408`)
- **Current state:** OPEN, **record only**. `import_awards.py:1408` still calls
  `require_env("AFLDB_LEGACY_SQLITE")`, so the awards/honours domain carries the same legacy
  dependency `AFLDB-ISSUE-095` records for `club_seasons`. No free API covers Coleman, Rising
  Star, All-Australian, AFLCA, AFLPA or club best-and-fairest; Brownlow is the exception via
  the AFL Tables path.
- **Exact next action:** none. **Do not design the replacement under this investigation** — no
  source selection, no per-award provenance decision, no importer work is authorised.
- **Links:** `AFLDB-ISSUE-095` as the direct sibling gap — linked, **not absorbed**.

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
