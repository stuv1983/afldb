# AFLDB Current Issues Index

> Lightweight session index of **open issues only**.
>
> `issues.md` is the authoritative detailed ledger. If this file and
> `issues.md` disagree, trust `issues.md` and immediately synchronize this file
> and the Open Issues table at the top of `issues.md`.

**Last updated:** 2026-08-22  
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
| `AFLDB-ISSUE-040` | Low | Tooling | Lint cannot run deterministically/non-interactively because ESLint is not configured. |
| `AFLDB-ISSUE-054` | Low | Tests | Four Under-22 importer contract tests fail on Windows only: `between()` matches a three-newline marker against a CRLF checkout. Linux is green. |
| `AFLDB-ISSUE-059` | Low | Search | Grouped qualifying-match counts are plain text because current Match Search cannot replay every grouped predicate. |
| `AFLDB-ISSUE-068` | Medium | UI/Hydration | React #418 remains intermittent under production-style NL search hydration; narrow H7 diagnostic is awaiting authoritative live-build validation. |
| `AFLDB-ISSUE-071` | Low | Audit | V2 residual failures require generator/oracle re-baselining before any remaining parser defect is promoted. |
| `AFLDB-ISSUE-072` | Low | Tests | `tests/site-settings.test.ts` default-shape expectation is stale after the `frontendTheme` settings landed. |
| `AFLDB-ISSUE-073` | Medium | Database | Four migration-056/057 foreign keys lack supporting indexes; `fk-indexes.test.ts` fails. |
| `AFLDB-ISSUE-074` | Low | Tests | email-intake integration test picks a real dev admin instead of its fixture and leaves a staged row behind. |
| `AFLDB-ISSUE-076` | Medium | Performance | `won_final_at_venue` Grid Solver combinations can exceed the 5-second PostgreSQL statement timeout and crash the rendered page. |
| `AFLDB-ISSUE-078` | High | Import | Draft and first-kick-goal reloads still destroy manual player links the way the honours loaders did before ISSUE-044. |
| `AFLDB-ISSUE-079` | High | Data integrity | Pre-ISSUE-044 reloads may have left dangling `player_link_resolutions.target_id` values. Dev audited clean; production not yet audited. |
| `AFLDB-ISSUE-077` | Medium | UI/Settings | The saved super-admin frontend theme can change between pages during the same browsing session. |

---

## AFLDB-ISSUE-040 — Lint script is not configured for non-interactive validation

- **Severity:** Low
- **Area:** Tooling
- **Key files:** `package.json`
- **Current state:** `npm run lint` still maps to deprecated `next lint`; ESLint is not installed/configured, so the command becomes interactive instead of providing deterministic validation.
- **Next action:** Add a reviewed ESLint flat configuration and compatible Next/ESLint dependencies through the normal dependency process, then replace `next lint` with the ESLint CLI.

## AFLDB-ISSUE-054 — Under-22 importer contract tests cannot find their source boundaries

- **Severity:** Low
- **Area:** Tests
- **Key files:** `tests/under-22-importer.test.ts`
- **Current state:** Root cause confirmed 2026-08-22: a line-ending mismatch, not
  marker drift. The markers begin with three newlines; a Windows checkout holds
  `import_awards.py` with CRLF, so `indexOf` returns -1. An untouched `HEAD`
  tree is 7/7 green on the Linux dev host and 4/7 red on Windows.
- **Next action:** Normalise CRLF to LF where the source-contract tests read
  a file (`between()` and its `readFileSync` callers). Do not edit the importer,
  and do not weaken the behavioural assertions.

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
- **Current state:** React #418 remains intermittent under production-style standalone load. Navigation prefetch reduction helped but did not eliminate it. The server-owned feedback-form change also did not fully resolve it. The current narrow H7 experiment removes only `useFormStatus`/pending-derived button disabling from `NlAnswerFeedbackControls`; typecheck/build passed. The ledger's last handover says the service had just been restarted but port 3100 initially refused connections, so the diagnostic build was not yet proven live.
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

## AFLDB-ISSUE-072 — site-settings default-shape test is stale after frontendTheme

- **Severity:** Low
- **Area:** Tests
- **Key files:** `tests/site-settings.test.ts`, `src/db/queries/site-settings.ts`
- **Current state:** `supplies every default from an empty table` fails because commit `d5243ba` added `frontendTheme` (and sibling defaults) without extending the test's expected object. Observed during AFLDB-ISSUE-027 work; unrelated to that change.
- **Next action:** Extend the expected defaults object to the current `parseSiteSettings` output and re-run `tests/site-settings.test.ts`.

## AFLDB-ISSUE-073 — Four audit/link foreign keys have no supporting index

- **Severity:** Medium
- **Area:** Database
- **Key files:** `src/db/migrations/056_player_link_review.sql`, `src/db/migrations/057_data_edits.sql`, `tests/integration/fk-indexes.test.ts`
- **Current state:** `fk-indexes.test.ts` fails on `data_edits(admin_user_id)`, `player_link_resolutions(admin_user_id)`, `player_link_resolutions(player_id)`, `player_link_suggestions(resolved_by)`. Reproduced on the untouched `d5243ba` checkout — pre-existing, surfaced once `afldb_test` caught up past migration 056.
- **Next action:** Add the four partial indexes in a new migration (migration-041 shape); `DELETE_FREE_PARENTS` is unlikely to be justifiable for `auth_users`/`players`.

## AFLDB-ISSUE-074 — email-intake integration test assumes a fixture admin ordering

- **Severity:** Low
- **Area:** Tests
- **Key files:** `tests/integration/email-intake.test.ts`
- **Current state:** The end-to-end CSV test picks an admin by query ordering and fails on the dev host where real admins sort first; it also leaves a staged `data_submissions` row behind (one artifact row left in `afldb_dev` on 2026-08-22).
- **Next action:** Provision or deterministically select a dedicated fixture admin inside the test and clean up the staged row.

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

## AFLDB-ISSUE-078 — Draft and first-kick-goal reloads still discard manual player links

- **Severity:** High
- **Area:** Import
- **Key files:** `tools/migration/import_draft.py:241`, `tools/records/import-first-kick-goal.ts:480`
- **First wrong layer:** Import/ETL.
- **Current state:** Found by inspection during `AFLDB-ISSUE-044` and kept out of
  its scope. Both loaders destroy and recreate `LINK_TARGET_TABLES` targets
  (`truncate(pg, "draft_picks", "draft_persons")`; `DELETE FROM
  player_achievements WHERE achievement_type = 'first_kick_goal'`), so a manual
  resolution is lost and its audit row is left dangling. `draft_picks` is the
  worse case because one decision propagates to every pick of a `draft_person`.
  Not yet reproduced against a database.
- **Next action:** Reproduce both against `afldb_test`, then apply the
  `reload_keyed()` pattern from `tools/migration/common.py` (and its equivalent
  in TypeScript for the first-kick-goal loader), keyed on the durable source
  identity each already carries.

## AFLDB-ISSUE-079 — Audit historical `player_link_resolutions` rows for dangling targets

- **Severity:** High
- **Area:** Data integrity
- **Key files:** `src/db/queries/player-links.ts` (`LINK_TARGET_TABLES`); the audit SQL is recorded in full in `issues.md`
- **First wrong layer:** Data integrity / operational history — no current honours code path creates new orphans.
- **Current state:** Diagnosis only. Destructive reloads run before
  `AFLDB-ISSUE-044` regenerated target row ids, so a decision's
  `player_link_resolutions.target_id` can point at an id that no longer exists
  (ids are never reused, so it dangles rather than naming another row). First
  read-only audit on `afldb_dev`, 2026-08-22, found **75 resolutions and 0
  dangling** across `award_winners`, `draft_picks`, `hall_of_fame` and
  `honour_team_members`. **Production has not been audited.**
- **Next action:** Run the two documented read-only queries against production
  as `AFLDB_OWNER_DATABASE_URL` (no application role can read both sides of the
  join), keep the full output as an artifact, and record the counts. Relink or
  delete nothing: remediation must be designed as a separate issue and reviewed
  explicitly. If production is clean, close this with the recorded counts.
