# Owner instruction — AFLDB V2 rebuild (2026-10-19, verbatim)

This is the owner's instruction that authorised the V2 rebuild, preserved verbatim so every stage
works from the exact text. `docs/v2/plan.md` records the decisions taken under it.

---

You are the lead engineer responsible for completing the AFLDB V2 backend rebuild in one continuous execution.

Do not return for routine clarification, approval, architectural choices, naming decisions, or implementation details. Inspect the repository, make conservative decisions consistent with this prompt, implement them, test them, and document them.

Only stop early if continuing would require:

- Accessing or changing production.
- Running a destructive or irreversible database operation.
- Deploying, pushing, publishing, or changing a live host.
- Obtaining credentials or secrets that are unavailable.
- Overwriting an existing unrelated repository.
- Making a product decision that would materially contradict this specification.

If one workstream is blocked, record the blocker and continue every other safe workstream. Return only after all locally executable work has been completed and verified.

# Mission

Build `afldbV2` as a clean, maintainable replacement for the existing AFLDB backend.

This is a controlled fork and backend strangler rebuild—not a blank-slate rewrite.

Preserve:

- The existing PostgreSQL database and valuable historical data.
- Existing public database identifiers and relationships wherever practical.
- The existing frontend and its user-visible behaviour.
- Working authentication, permissions, auditing and operational safeguards.
- Valuable data inspection, reconciliation and administration tools.
- The mature AFL API snapshot, staging, resolution, promotion and settlement logic.
- Historical data that cannot be reacquired reliably.

Replace or retire:

- Runtime CSV imports.
- Runtime AFL Tables ingestion.
- Squiggle, Kali and similar overlapping runtime data sources.
- Fragile multi-source reconciliation where AFL API data is authoritative.
- Broad or confusing admin-centre workflows.
- Direct Wikipedia-to-production automation.
- Backend code that silently creates incomplete entities or partially promotes data.

The target backend should use:

- AFL API for supported fixtures, results, match statistics, player statistics and Brownlow data.
- PostgreSQL-derived calculations for the Coleman Medal and other reliably derivable statistics.
- Annual curated proposals for Wikipedia-sourced or manually maintained awards.
- Human review and audited promotion for non-authoritative external data.

# Starting state

The verified source worktree is:

`D:\dev\afldb-afl-api-cutover`

The target repository is:

`D:\dev\afldbV2`

If `D:\dev\afldbV2` does not exist, create it as a sibling repository seeded from the verified source.

If it already exists:

1. Inspect it before making changes.
2. Reuse it only if it is clearly the intended AFLDB V2 repository.
3. Never overwrite or delete unrelated content.
4. If its identity is ambiguous, leave it untouched and use a clearly named sibling such as `D:\dev\afldbV2-rebuild`, documenting the choice.

The source worktree currently contains verified but uncommitted changes. Preserve them. Do not reset, discard, clean or overwrite the source worktree.

Known changed files include:

- `tools/rebuild/afltables/acquire_coaches.py`
- `deploy/afldb-settle-afltables.sh`
- `tools/rebuild/fitzroy/acquire_core.R`
- `tools/rebuild/afltables/acquire_club_lists.R`
- `tools/current-season/afl-api-c4b-rehearsal.ts`
- `tests/afl-api-cutover.test.ts`
- `issues/open/AFLDB-ISSUE-316.md`
- `issues.md`
- `IssuesIndex.md`
- `CHANGELOG.md`
- `issues/closed/AFLDB-ISSUE-232.md`
- `docs/deployment.md`

The last verification reported:

- AFL API cutover suite: 419 passed, 2 skipped, 421 total.
- Seven-suite set: 829 passed, 2 skipped, 831 total.
- TypeScript type checking passed.
- ESLint passed on the eight relevant TypeScript files.
- No production database or host was contacted.
- No mutation controls or C4b production operation were run.
- Nothing was staged or committed.

Read the repository's nearest `AGENTS.md`, issue instructions, `IssuesIndex.md`, ISSUE-316 runbook, deployment documentation and package scripts before acting. Use the repository knowledge graph when available, then verify material findings against source.

# Authority granted

You are authorized to:

- Read and modify files in the source worktree only where necessary to capture or verify its current state.
- Create and modify the new local V2 repository.
- Run local formatting, linting, type checking, unit tests and isolated integration tests.
- Use an isolated local test database if one is already provided by the project and cannot contact production.
- Create additive migrations, fixtures and migration tooling.
- Create local Git branches and commits in the V2 repository.
- Make multiple well-scoped local commits.
- Refactor, reorganise and remove code inside V2 after preserving required functionality and history.
- Produce architecture, migration, risk, operational and cutover documentation.

You are not authorized to:

- Contact, query or mutate production.
- Run C4b against a live PostgreSQL database.
- Install or activate services on a real host.
- Deploy the application.
- Push branches, tags or commits.
- Open pull requests.
- Rotate or expose secrets.
- Execute destructive database migrations.
- Delete or reset the source worktree.
- Treat this rebuild approval as approval for ISSUE-316 production gates.
- Grant or use D-316-13.
- Execute D-316-2 host installation or activation.
- Fabricate live API responses, historical results or missing player mappings.

All production decisions remain gated after the local rebuild.

# Safety before implementation

Before altering the target:

1. Record the source branch, commit, working-tree status and relevant file hashes.
2. Preserve the source's uncommitted changes in a recoverable local patch or equivalent read-only snapshot outside the source checkout.
3. Confirm that no command will contact production.
4. Identify how database connections are selected and add fail-closed safeguards where a test could otherwise reach a non-local database.
5. Verify that secrets will not be copied into the V2 repository.
6. Establish the V2 repository's baseline commit and document its source revision.

Do not clean or "tidy" the original worktree.

# Target architecture

Use the repository's existing language and framework where sensible. Do not introduce a new platform merely for architectural neatness.

Aim for this separation, adapting names to the existing stack:

- `apps/web`: existing frontend and public/backend HTTP surface.
- `apps/worker`: acquisition, settlement, reconciliation and scheduled jobs.
- `packages/domain`: domain types, rules, validation and identifiers.
- `packages/db`: database access, transactions, repositories and migrations.
- `packages/acquisition`: AFL API clients, snapshots, staging and promotion.
- `packages/derived`: Coleman and other database-derived results.
- `packages/admin`: restricted administration services and audited commands.
- `packages/testing`: fixtures, contract tests and isolated test helpers.
- `docs`: architecture, migration, operations, risk and cutover material.
- `legacy/offline` or equivalent: quarantined historical acquisition tools that must be retained but cannot run as part of normal V2 operations.

The exact folder names may differ if the existing repository makes another arrangement materially safer, but maintain clear boundaries.

Dependencies must flow toward the domain and database contracts. The frontend must not contain acquisition logic. API clients must not write directly to final tables. Admin UI actions must call explicit audited backend operations.

# Database strategy

The existing PostgreSQL data is an asset and must be preserved.

Use these rules:

- Prefer the existing schema where it is sound.
- Make schema changes additive and reversible.
- Preserve stable IDs and foreign-key relationships.
- Use compatibility views or adapters where the frontend depends on legacy shapes.
- Do not perform a destructive schema reset.
- Do not silently rewrite historical records.
- Introduce source/provenance metadata where missing.
- Record acquisition run, snapshot, settlement and promotion identities.
- Make promotion transactional and idempotent.
- Fail closed on unresolved player, club, competition, season or fixture identity.
- Never create placeholder players merely to complete a promotion.
- Make reruns safe.
- Ensure partial failures cannot leave partially promoted seasons.
- Keep historical baseline data sealed unless an explicit correction workflow is used.
- Produce backup, rollback and reconciliation instructions, but do not run them against production.

Create a database compatibility and ownership matrix showing which V2 component owns each relevant table or view.

# Data acquisition

Implement one canonical pipeline:

`AFL API → immutable snapshot → validated staging → identity resolution → reconciliation → transactional promotion → derived calculations`

Requirements:

- Save immutable source snapshots with timestamps and checksums.
- Validate response shape before staging.
- Separate acquisition from promotion.
- Resolve clubs, players, competitions, seasons and fixtures explicitly.
- Reject ambiguous or unresolved mappings.
- Produce machine-readable reconciliation reports.
- Preserve previous promoted data when validation fails.
- Support safe replay from stored snapshots.
- Record API endpoint, parameters and acquisition metadata.
- Add rate limiting, retries with limits, timeouts and actionable failure messages.
- Do not assume every historical season has identical AFL API coverage.

Treat API coverage honestly:

- The known season registry covers approximately 2012–2026.
- Detailed verified match contracts may only be reliable for approximately 2022–2026.
- Full AFLDB history extends much further and therefore requires a sealed historical baseline.
- Do not delete historical records because the API cannot reproduce them.
- Do not label an unverified season as API-rebuildable.

Build an explicit coverage registry with statuses such as:

- `api_verified`
- `api_partial`
- `historical_baseline`
- `manual_curated`
- `unsupported`

Coverage claims must be backed by tests, stored fixtures or documented evidence.

# Fixtures and player identity

Fixture ingestion and player resolution are critical gates.

Implement or finish:

- Stable fixture identity rules.
- Duplicate and rescheduled-match handling.
- Round and finals mapping.
- Cancelled, postponed and abandoned match handling.
- Home/away and venue reconciliation.
- Player resolution using stable AFL identifiers when available.
- Auditable aliases and manual resolution queues.
- Fail-closed behaviour when a player cannot be resolved.
- Admin tools for reviewing—not bypassing—unresolved identities.

If ISSUE-229 or equivalent fixture work remains genuinely unresolved, do not invent the answer. Implement all safe surrounding contracts, tests, refusal paths and documentation, and mark the exact remaining condition as a cutover blocker.

# Brownlow

Use AFL API Brownlow data as the authoritative supported source.

Implement:

- Snapshot and schema validation.
- Player, match, round and club reconciliation.
- Duplicate-vote prevention.
- Vote totals and leaderboard reconciliation.
- Handling of tied totals without inventing a winner rule.
- Clear separation between raw votes and award-result presentation.
- Idempotent promotion.
- Tests for valid seasons, incomplete seasons, duplicate votes, unresolved players and replay.

Preserve the strengthened timer and settlement conditions already implemented in the verified source.

# Coleman Medal

Do not ingest Coleman winners as a primary external dataset where they can be derived.

Derive Coleman results from promoted player goal statistics:

- Use the project's agreed competition scope.
- Use home-and-away matches only unless the domain definition explicitly states otherwise.
- Require a complete and settled season.
- Support tied leaders.
- Preserve the underlying leaderboard and derivation inputs.
- Record the derivation version and timestamp.
- Recompute safely after an authorised correction.
- Refuse to publish an official result for an incomplete season.

Add tests covering outright winners, ties, incomplete rounds, finals exclusion, corrected statistics and idempotent recomputation.

# Other awards

Club awards, league awards and historical honours that cannot be reliably derived should use a curated workflow.

Implement:

1. Import or manual entry creates a proposal.
2. The proposal records value, season, source URL or citation, acquisition date and notes.
3. Validation checks identity, duplicates and required evidence.
4. An authorised administrator reviews the proposal.
5. Approval promotes it transactionally.
6. Rejection retains an audit record.
7. Corrections create new revisions rather than erasing history.

Wikipedia may be used to prepare annual proposals, but never as an unattended direct-to-production source.

Support manual entry through the admin data editor using the same validation and audit pathway.

# Admin centre

Replace the current broad admin centre with a small operations-focused interface.

Primary areas:

- Data health overview.
- Acquisition runs.
- Reconciliation failures.
- Unresolved identities.
- Curated award proposals.
- Derived-result status.
- Audit log.
- Explicit maintenance operations.
- Read-only database inspection where already valuable.

Each action must show:

- What it will change.
- The affected season or records.
- Validation state.
- Whether it is reversible.
- The acting user.
- The resulting audit entry.

Remove or quarantine:

- Duplicate import screens.
- Direct CSV-to-final-table actions.
- AFL Tables runtime controls.
- Hidden settlement side effects.
- Generic "run everything" buttons.
- Actions that bypass validation or audit.
- Production mutation controls from ordinary admin roles.

Preserve valuable inspection and correction tools by putting them behind explicit permissions and audited service methods.

# Legacy handling

Classify every old ingestion path as one of:

- Removed from V2.
- Retained as offline historical evidence.
- Retained temporarily behind a disabled compatibility boundary.
- Replaced by AFL API.
- Replaced by a derived calculation.
- Replaced by curated admin entry.

Normal V2 runtime must not depend on CSV, AFL Tables, Squiggle or Kali.

If historical rebuild scripts must remain, place them in an offline legacy area with:

- No scheduler registration.
- No runtime imports.
- No admin execution button.
- Clear warnings.
- Tests proving normal applications do not depend on them.

Do not delete the only recoverable source of historical knowledge.

# Migration stages to implement

Complete as many stages as can be safely executed locally.

## Stage 0 — Evidence and baseline

- Preserve the verified cutover work.
- Record source revision and file hashes.
- Run or validate the existing cutover suite.
- Produce an inventory of backend, frontend, database and admin dependencies.
- Record all legacy ingestion entry points.

## Stage 1 — V2 foundation

- Create the V2 repository.
- Establish module boundaries.
- Carry forward the frontend and database contracts.
- Configure safe local environments.
- Add architectural decision records.
- Establish tests, linting and type checking.
- Commit the baseline.

## Stage 2 — Historical baseline

- Define the sealed historical baseline.
- Add provenance and verification tooling.
- Add safe export/import or validation tooling where appropriate.
- Do not copy production data into the repository.
- Document restoration and reconciliation.

## Stage 3 — AFL API pipeline

- Port the verified API acquisition and settlement logic.
- Implement snapshot, staging, resolution, reconciliation and promotion boundaries.
- Close safe fixture and identity gaps.
- Add replay and failure tests.

## Stage 4 — Derived and curated data

- Implement Coleman derivation.
- Finish Brownlow reconciliation.
- Implement curated awards proposals and audited promotion.
- Quarantine legacy imports.

## Stage 5 — Admin simplification

- Build the smaller operational admin centre.
- Preserve useful inspection and correction tools.
- Remove or disable legacy runtime controls.
- Add role and audit tests.

## Stage 6 — Shadow-ready state

- Add compatibility and comparison reports.
- Provide commands for a future isolated shadow run.
- Define measurable parity thresholds.
- Produce rollback and cutover runbooks.
- Do not execute production shadowing or cutover.

# Testing

Run the strongest safe local verification available.

At minimum:

- Existing relevant regression suites.
- AFL API contract tests.
- Snapshot and replay tests.
- Fixture identity tests.
- Player-resolution refusal tests.
- Promotion transaction and rollback tests.
- Brownlow reconciliation tests.
- Coleman derivation tests.
- Curated-award workflow tests.
- Admin permission and audit tests.
- Frontend integration or contract tests.
- Type checking.
- Linting.
- Production-connection refusal tests.
- Tests proving runtime independence from CSV and AFL Tables.
- Tests proving no scheduler or admin path invokes offline legacy tools.

Do not weaken tests to obtain a pass. Do not silently skip failing tests. Explain environmental skips precisely.

Use stored, sanitised fixtures rather than live production calls.

# Required documentation

Create or update:

- `README` with local setup and repository purpose.
- Architecture overview.
- Architecture decision records.
- Database compatibility and ownership matrix.
- AFL API coverage matrix.
- Data provenance model.
- Legacy ingestion disposition matrix.
- Admin-centre operating guide.
- Historical baseline policy.
- Migration plan.
- Risk register.
- Backup and rollback plan.
- Shadow comparison plan.
- Production cutover runbook.
- Explicit go/no-go checklist.
- Known gaps and deferred work.
- Changelog.

Documentation must describe the implemented state, not an aspirational state.

# Go/no-go criteria

The local rebuild may be labelled `shadow-ready` only when:

- The existing frontend builds and its critical contracts are preserved.
- Existing PostgreSQL data can be retained without destructive migration.
- Stable identifiers and relationships are preserved or explicitly mapped.
- AFL API ingestion is snapshot-based, validated, replayable and idempotent.
- Promotion is transactional and fails closed.
- Fixtures and players cannot be silently fabricated.
- Brownlow reconciliation passes.
- Coleman derivation passes for winners, ties and incomplete seasons.
- Curated awards require review and retain citations and audit history.
- Runtime code has no dependency on CSV, AFL Tables, Squiggle or Kali.
- Valuable historical tools are safely quarantined.
- Admin operations are narrow, permissioned and audited.
- Tests, type checking and linting pass.
- Production access is not needed to run the test suite.
- Migration, comparison, rollback and cutover instructions are complete.
- No secrets are committed.
- No production action has occurred.

The rebuild is a no-go for production cutover if any of these remain:

- Fixture identity can duplicate or misassign matches.
- Player resolution creates placeholders or silently guesses.
- API coverage is assumed rather than verified.
- Historical data would be deleted or rewritten destructively.
- Brownlow or Coleman results cannot be reconciled.
- The frontend requires unplanned breaking schema changes.
- Admin actions can bypass validation, permissions or auditing.
- Runtime still depends on legacy ingestion.
- Shadow comparison thresholds are undefined.
- Rollback is untested or unclear.
- ISSUE-316 production gates remain unsatisfied.
- D-316-13 has not been separately approved after the required C4 result.

# Git and commit rules

Local commits in the V2 repository are explicitly authorized.

Create clear commits at meaningful milestones, for example:

1. Baseline controlled fork and safety controls.
2. Architecture and database boundaries.
3. AFL API acquisition pipeline.
4. Brownlow and Coleman processing.
5. Curated awards workflow.
6. Admin-centre simplification.
7. Legacy quarantine.
8. Tests and operational documentation.

Before each commit:

- Review the diff.
- Run relevant tests.
- Ensure no secrets, generated caches, reports or temporary artifacts are included.
- Preserve attribution and license material.

Do not push, tag a release, deploy or open a pull request.

# Final response

Return once, after exhausting all safe local work.

Lead with the outcome and include:

- Whether V2 is implemented, partially implemented or blocked.
- The exact V2 repository path.
- Source revision and preservation method.
- Architecture actually created.
- Database compatibility result.
- Functional areas completed.
- Legacy paths removed or quarantined.
- Tests run, with exact pass/fail/skip counts.
- Type-check and lint results.
- Local commit hashes and summaries.
- Any unresolved technical gaps.
- Risk assessment ranked by severity.
- Current go/no-go result for:
  - continuing local development,
  - running an isolated shadow rehearsal,
  - production cutover.
- Exact production approvals still required.
- Confirmation that no production system was contacted or changed.
- Confirmation that nothing was pushed or deployed.

Do not claim the production migration is complete merely because the code is shadow-ready.

Proceed now and complete the rebuild in one continuous pass.
