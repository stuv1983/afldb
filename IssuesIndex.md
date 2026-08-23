# AFLDB Current Issues Index

> Lightweight session index of **open issues only**.
>
> `issues.md` is the authoritative detailed ledger. If this file and
> `issues.md` disagree, trust `issues.md` and immediately synchronize this file
> and the Open Issues table at the top of `issues.md`.

**Last updated:** 2026-08-23
**Open issues:** 16

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
| `AFLDB-ISSUE-081` | Low | Tests | Honours reload suite mutates rows the release gates count, with no lock between the files. Latent. |
| `AFLDB-ISSUE-082` | Medium | Admin | `confirmUnlinked` takes no lock and never re-reads its target, so a stale form can contradict an applied link. |
| `AFLDB-ISSUE-077` | Medium | UI/Settings | The saved super-admin frontend theme can change between pages during the same browsing session. |
| `AFLDB-ISSUE-083` | Medium | Tests / Database privileges | Importers are tested as `afldb_owner` but run as `afldb_import`, so missing-grant defects pass CI and fail in production. |
| `AFLDB-ISSUE-084` | High | Deployment / Data integrity | Production (migration 057) lacks the ISSUE-044/078 player-link protections; all seven link-target families are still served by destructive loaders, so a reload can create new dangling resolutions. |
| `AFLDB-ISSUE-085` | Low | Data integrity / Import | `import_captaincies` reconciles its whole table with no ownership predicate — the ISSUE-080 defect class, latent because the importer is today the only writer. |
| `AFLDB-ISSUE-086` | Needs triage | Admin / Data integrity | Data-editor edits to source-owned rows can be silently reverted by the owning source's next reload; severity awaits the four-question triage recorded in the entry. |

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

## AFLDB-ISSUE-081 — Honours reload suite races the release gates over shared rows

- **Severity:** Low
- **Area:** Tests
- **Key files:** `tests/integration/awards-reload-links.test.ts`,
  `tests/integration/release-gates.test.ts`, `tests/integration/draft-lock.ts`
- **Current state:** Latent, not yet observed failing. Vitest runs test files in
  parallel; the honours suite links real rows to fixture players while the
  release gate counts them. The identical race in the draft suite DID fail
  during `AFLDB-ISSUE-078` (3,461 linked instead of 3,459) and was fixed with an
  advisory lock. **Widened 2026-08-23:** resolved `AFLDB-ISSUE-080` added
  honours/award fixtures to `awards-reload-links.test.ts` that the gate counts;
  its combined run with `release-gates.test.ts` is deferred to this issue
  (ISSUE-080 was validated with the suite isolated).
- **Next action:** Either apply the same `tests/integration/draft-lock.ts`
  treatment to the honours pair, or establish and record why the gate's honours
  assertions cannot overlap that suite's fixtures. Do not serialise the whole
  test run. Once the lock lands, run `awards-reload-links.test.ts` together with
  `release-gates.test.ts` (the run ISSUE-080 deferred).

## AFLDB-ISSUE-082 — `confirmUnlinked` can record a decision contradicting an applied link

- **Severity:** Medium
- **Area:** Admin
- **Key files:** `src/db/queries/player-links.ts:489`
- **First wrong layer:** Admin mutation path.
- **Current state:** `confirmUnlinked` takes no lock, does not re-read its
  target and runs on `authSql` rather than the import transaction, taking
  `previousStatus` straight from the form. A stale form can therefore vet a row
  whose draft person was linked moments earlier. `resolveLink` locks and
  re-checks; this does not. The `AFLDB-ISSUE-078` draft reload now aborts on the
  resulting contradiction, which is a backstop, not a fix.
- **Next action:** Lock and re-check the target the way `lockUnresolvedTarget`
  does, reject a confirmation whose target (or draft person) is already
  resolved, and extend `tests/player-link-mutations.test.ts`.
  **Forward constraint (`AFLDB-ISSUE-080`, 2026-08-23):** if the fix ever makes
  `confirmUnlinked` write `player_id = NULL` back to `honour_team_members`, that
  writer must join ISSUE-080's §4.3 identity matrix and its `(717275, 1)`
  transaction-scoped advisory lock — see the ledger entry.

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

## AFLDB-ISSUE-084 — Deploy the ISSUE-044/078 player-link protections to production

- **Severity:** High
- **Area:** Deployment / Data integrity
- **Key files:** `src/db/migrations/058`–`070`,
  `tools/maintenance/privileges.sql`, `tools/migration/import_awards.py`,
  `tools/migration/import_draft.py`, `tools/records/import-first-kick-goal.ts`
- **Current state:** Deployment work, not historical remediation. The
  `AFLDB-ISSUE-079` production audit (2026-08-23, migration 057) found **no
  historical dangling targets**, but the deployed production checkout
  (`a32a0a1`) still carries destructive reload behaviour across all seven
  `LINK_TARGET_TABLES` families — the ISSUE-044/078 repairs, migrations 058–070
  and the production `--rekey` are all undeployed. Production remains
  prospectively exposed until this issue is completed.
- **Next action:** **Only on explicit instruction:** apply migrations 058–070
  with `npm run db:privileges` at the points ISSUE-044/078 require (068 +
  privileges before the honours importer, 069 before `import_draft.py`, 070 +
  privileges before the first-kick-goal importer); deploy the three corrected
  loaders — `import_awards.py` **must** be the resolved `AFLDB-ISSUE-080`
  version with its matching `common.py`/`awards-admin.ts` (no extra migration
  or privilege step); run the regenerated **Profile-B ISSUE-080 audit** with
  Plane B re-derived and compared against the recorded fingerprints **before
  the first awards/honours reload**; run the one-time production `--rekey` per
  the ISSUE-078 Follow-up; then regenerate and re-run the ISSUE-079 audit — the
  migration-057-pinned SQL (S16/S17) will correctly refuse after migration and
  must not be rerun as-is.

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
