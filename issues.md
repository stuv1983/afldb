# AFLDB Issues

## Open Issues

This table is the quick index of currently open issues. The detailed entries
below remain authoritative. `IssuesIndex.md` mirrors these open items in a
session-friendly format and must be kept synchronized whenever an issue is
created, reopened, resolved, or materially reclassified.

**Open issues:** 8

| Issue | Severity | Area | Summary | Current next action |
|---|---|---|---|---|
| `AFLDB-ISSUE-015` | High | Database | Match mutations leave source-derived `club_seasons` ladder rows stale. | Extract the canonical season-aware `club_seasons` rebuild, including season-specific points/finals policy, then add database-backed fixtures. |
| `AFLDB-ISSUE-027` | High | Architecture | Statistical mutations and required audit writes still commit through separate role-scoped transactions. | Choose and implement either a database-owned audit function inside the import transaction or a durable transactional outbox with idempotent delivery. |
| `AFLDB-ISSUE-040` | Low | Tooling | The lint script invokes deprecated `next lint` without a checked-in ESLint setup and becomes interactive. | Add a reviewed ESLint flat configuration and compatible dependencies, then replace `next lint` with the ESLint CLI. |
| `AFLDB-ISSUE-044` | High | Import | Legacy full awards reloads can discard manual player-link resolutions outside the protected Under-22 path. | Preserve durable manual resolutions across legacy honours reloads and add manual-resolve → full-reload → preserved-link integration coverage. |
| `AFLDB-ISSUE-054` | Medium | Tests | Under-22 importer contract tests fail because literal source-boundary markers drifted from `import_awards.py`. | Repair the importer/test boundary contract without weakening the behavioural assertions. |
| `AFLDB-ISSUE-059` | Low | Search | Grouped `Qualifying matches` counts have no safe drill-down to the exact matching fixtures. | Extend Match Search or add a dedicated NL drill-down route that can faithfully replay the grouped row predicates. |
| `AFLDB-ISSUE-068` | Medium | UI/Hydration | Intermittent React #418 hydration failures remain isolated to the UI/runtime path under production-style NL search load. | First verify the restarted service and diagnostic build; if healthy and build IDs match, run only the unchanged 118-row feedback discriminator for the narrow H7 experiment. |
| `AFLDB-ISSUE-071` | Low | Audit | Parser-v25 V2 residual failures still mix corpus/oracle debt with possible smaller parser follow-up. | Re-baseline V2 generator/oracles first; promote a product defect only after the oracle layer is reconciled. |

---

## AFLDB-ISSUE-001 — Match mutations overwrite authoritative Brownlow totals

- **Status:** Resolved
- **Severity:** High
- **Area:** Admin
- **Found:** 2026-08-20
- **Resolved:** 2026-08-20
- **Files:** `src/db/queries/match-sheet.ts`, `src/db/queries/match-admin.ts`, `tools/migration/rebuild_derived.py`

### Symptom
Saving a match sheet or deleting a match can change or delete official season and career Brownlow totals for every affected player, even when the edit only concerns a lineup or a non-Brownlow statistic.

### Reproduction
Inspect the affected-player blocks in `saveMatchSheet` and `deleteMatch`. Both rebuild `brownlow_season_votes` from `player_match_stats.brownlow_votes` and delete an official season row when no positive per-match row remains. For a player edited in a season outside the per-match coverage windows (for example 1950), the delete branch necessarily removes the authoritative season row.

### Expected
`brownlow_season_votes` remains the authoritative, independently imported season-level source. Match-sheet edits may update per-match detail, but must never derive or delete an official season total from incomplete per-match rows.

### Actual
Both mutation paths upsert and delete rows in `brownlow_season_votes` using per-match votes.

### Evidence
`src/db/migrations/004_player_match_stats.sql` states that per-match votes exist only for 1931–1934 and 1984–2025. `tools/migration/rebuild_derived.py` explicitly says career totals must never be summed from them. The new mutation SQL nevertheless writes `brownlow_season_votes` from `player_match_stats`.

### Root cause
The real-time derived-stat implementation duplicated the rebuild logic but treated incomplete match-grain Brownlow detail as the season-grain source of truth.

### Fix
Removed every match-mutation write to `brownlow_season_votes`. Targeted player-season and career rebuilds now read the authoritative table without deriving or deleting it.

### Validation
The Brownlow source-contract regression test passed and type checking passed. Database integration was not run because `AFLDB_TEST_DATABASE_URL` is not configured.

### Follow-up
Add a regression guard that prevents match mutation modules from writing `brownlow_season_votes`.

## AFLDB-ISSUE-002 — Match deletion is blocked by derived `player_clubs` foreign keys

- **Status:** Resolved
- **Severity:** High
- **Area:** Admin
- **Found:** 2026-08-20
- **Resolved:** 2026-08-20
- **Files:** `src/db/queries/match-admin.ts`, `src/db/migrations/007_derived_stats.sql`

### Symptom
Deleting a match fails when that match is recorded as an affected player's first or last match.

### Reproduction
Call `deleteMatch` for a match referenced by `player_clubs.first_match_id` or `player_clubs.last_match_id`.

### Expected
The deletion transaction removes or refreshes derived rows in an order that permits the authoritative match to be deleted, then rebuilds those rows from the remaining facts.

### Actual
`deleteMatch` deletes the `matches` row before touching `player_clubs`. Both match-id columns have non-cascading foreign keys to `matches(id)`, so PostgreSQL rejects the deletion.

### Evidence
`src/db/queries/match-admin.ts` deletes `player_match_stats`, period scores, then `matches`. `src/db/migrations/007_derived_stats.sql` defines both `player_clubs` match references without `ON DELETE CASCADE`.

### Root cause
The new deletion workflow omitted a match-referencing derived table from its dependency order.

### Fix
The deletion transaction now clears affected derived `player_clubs` rows before deleting the referenced match and rebuilds them before commit.

### Validation
The match-mutation regression test asserts the dependency ordering and passed. Database integration was not run because no guarded test database is configured.

### Follow-up
Search all match foreign keys and cover deletion of a career-first/career-last match in integration tests.

## AFLDB-ISSUE-003 — Match deletion queries a nonexistent Brownlow table

- **Status:** Resolved
- **Severity:** High
- **Area:** Admin
- **Found:** 2026-08-20
- **Resolved:** 2026-08-20
- **Files:** `src/db/queries/match-admin.ts`, `src/db/migrations/015_brownlow_grain_and_coverage.sql`

### Symptom
Deleting any match with affected players reaches a season-summary query that fails before the transaction can commit.

### Reproduction
Trace the `deleteMatch` player-season rebuild after dependent rows are deleted.

### Expected
Brownlow coverage is derived from `seasons.status` and the existence of authoritative `brownlow_season_votes`, matching the canonical rebuild.

### Actual
The query reads `brownlow_seasons`, a relation that is not created anywhere in the repository, and can produce `not_awarded`, which is not a `coverage_status` enum value.

### Evidence
Repository search finds `brownlow_seasons` and `not_awarded` only in `src/db/queries/match-admin.ts`. Migration 015 defines the valid coverage values as `complete`, `partial`, `not_collected`, `not_applicable`, and `pending`.

### Root cause
The deletion-specific summary SQL diverged from the canonical `tools/migration/rebuild_derived.py` definition.

### Fix
Deleted the divergent deletion-only SQL and routed save/delete through the shared canonical targeted rebuild helper. No `brownlow_seasons` or invalid coverage value remains.

### Validation
Source-contract tests for schema names, coverage logic, and single-command tagged queries passed; database integration was unavailable.

### Follow-up
Centralise targeted derived-stat recomputation so save and delete cannot drift into separate definitions.

## AFLDB-ISSUE-004 — Match mutations leave related derived summaries stale

- **Status:** Resolved
- **Severity:** High
- **Area:** Database
- **Found:** 2026-08-20
- **Resolved:** 2026-08-20
- **Files:** `src/db/queries/match-sheet.ts`, `src/db/queries/match-admin.ts`, `tools/migration/rebuild_derived.py`

### Symptom
After adding, changing, removing, or deleting a player's match row, career and player-season figures may change while club-season history, club stints, and stored player career spans still show the old facts.

### Reproduction
Use the match-sheet editor to move a player between the two clubs, add the player's first match for a club, or remove the player's earliest/latest match. Alternatively delete such a match.

### Expected
Every derived table affected by the authoritative fact mutation is refreshed from the same statistical definitions before the transaction commits.

### Actual
The new paths rebuild only `player_career_stats` and `player_season_stats`. They omit `player_club_season_stats` and `player_clubs`; deletion also omits `players.debut_season`/`final_season`, while the save path cannot clear a span for a player left with no games.

### Evidence
The canonical rebuild lists `player_clubs`, `player_club_season_stats`, `player_season_stats`, and `player_career_stats` as separate derived targets. Neither mutation path maintains all of them.

### Root cause
Hand-copied partial rebuild SQL was added independently to two mutation functions rather than sharing the complete canonical definition.

### Fix
Added one shared targeted rebuild for `player_clubs`, `player_club_season_stats`, `player_season_stats`, `player_career_stats`, player career spans, career game numbers, and search rank.

### Validation
Focused source-contract and NULL-semantics tests passed with type checking. Database-backed first/last-match fixtures remain unrun.

### Follow-up
Add targeted integration coverage for club changes and first/last-match removal.

## AFLDB-ISSUE-005 — Blank lineup statistics can reset a match to a 0–0 draw

- **Status:** Resolved
- **Severity:** High
- **Area:** Admin
- **Found:** 2026-08-20
- **Resolved:** 2026-08-20
- **Files:** `src/app/admin/data-editor/MatchSheetEditor.tsx`, `src/db/queries/match-sheet.ts`

### Symptom
Saving a lineup before entering player goals and behinds can overwrite an existing match score, result, winner, and margin with a 0–0 draw.

### Reproduction
Open a match sheet with blank player scoring fields, leave the default “Synchronize final match score” option enabled, and save.

### Expected
Unknown scoring data remains unknown and cannot be converted to recorded zeros. Score synchronization requires complete scoring components for both teams.

### Actual
The UI enables synchronization by default. The SQL uses `COALESCE(sum(goals), 0)` and `COALESCE(sum(behinds), 0)`, so an all-NULL lineup becomes zero goals and zero behinds.

### Evidence
The component initialises `syncMatchScores` to `true`; the aggregate in `saveMatchSheet` explicitly converts missing values to zero.

### Root cause
The score-sync path has no completeness gate and conflates “not entered” with a recorded zero.

### Fix
Removed player-stat-to-team-score synchronization. The UI posts `false`, explains rushed/unattributed behinds, and the lower helper rejects a forged opt-in before opening a database connection.

### Validation
Focused match-sheet and source-contract tests passed; the query contains no match or period score write.

### Follow-up
Cover legitimate zero scores separately from absent scoring data.

## AFLDB-ISSUE-006 — Match-sheet payload is not validated on the server

- **Status:** Resolved
- **Severity:** Medium
- **Area:** Admin
- **Found:** 2026-08-20
- **Resolved:** 2026-08-20
- **Files:** `src/app/admin/data-editor/actions.ts`, `src/db/queries/match-sheet.ts`

### Symptom
A malformed or hand-posted match-sheet payload can store negative player statistics or assign a player to a club that did not play in the match, corrupting derived outcomes and club history.

### Reproduction
Submit the server action with a valid match ID and JSON containing a player with `clubId` belonging to neither match club or a negative statistic such as `goals: -1`.

### Expected
The server accepts only a structurally valid payload, home/away club IDs, distinct positive player IDs, non-negative bounded statistics, and Brownlow votes from 0 to 3.

### Actual
The action only parses JSON. The query skips falsy IDs but otherwise binds all supplied values. The schema constrains Brownlow votes, but most player statistics have no non-negative constraint and an unrelated valid club ID satisfies the foreign key.

### Evidence
`saveMatchSheetAction` uses `payload.players || []` with no shape or value checks. `player_match_stats` defines only the Brownlow range check among these editable statistics.

### Root cause
HTML input limits were treated as validation even though the server action consumes a client-controlled hidden JSON field.

### Fix
Added a shared pure validator at both the server action and query boundary for shape, bounded row counts, positive distinct IDs, jumper format, non-negative bounded integers, disposal consistency, and Brownlow allocation.

### Validation
`tests/match-sheet.test.ts` passed its valid, malformed, NULL-semantics, and allocation cases; type checking passed.

### Follow-up
Keep lower-level validation as well as action-level validation so non-UI callers fail closed.

## AFLDB-ISSUE-007 — Statistical mutation connections fall back to the read URL

- **Status:** Resolved
- **Severity:** Medium
- **Area:** Database
- **Found:** 2026-08-20
- **Resolved:** 2026-08-20
- **Files:** `src/db/queries/match-sheet.ts`, `src/db/queries/match-admin.ts`, `src/db/queries/awards-admin.ts`, `src/db/queries/players.ts`

### Symptom
If `AFLDB_IMPORT_DATABASE_URL` is absent but `DATABASE_URL` is present and over-privileged, super-admin mutations run through the wrong database role instead of failing closed.

### Reproduction
Start the application without `AFLDB_IMPORT_DATABASE_URL` and with a writable `DATABASE_URL`, then invoke any new player, award, match, or match-sheet mutation.

### Expected
Every statistical write requires the dedicated import connection. Missing import credentials cause a clear refusal.

### Actual
All four new mutation modules use `process.env.AFLDB_IMPORT_DATABASE_URL || process.env.DATABASE_URL`.

### Evidence
The modules' own error messages say the import URL is required, while their connection selection silently accepts the application URL. Project architecture requires the public application connection to remain read-only and statistical writes to use the import role.

### Root cause
A development convenience fallback bypassed the fail-closed role boundary.

### Fix
Removed every `DATABASE_URL` fallback from the affected match, player, player-link, and awards mutation helpers. Missing import credentials now fail closed.

### Validation
Focused tests assert fail-closed behavior and repository search finds no fallback in the repaired mutation modules.

### Follow-up
Add a source-level or unit guard preventing future mutation helpers from introducing this fallback.

## AFLDB-ISSUE-008 — Partial draft details invent the current year

- **Status:** Resolved
- **Severity:** Medium
- **Area:** Admin
- **Found:** 2026-08-20
- **Resolved:** 2026-08-20
- **Files:** `src/app/admin/data-editor/actions.ts`, `src/db/queries/players.ts`

### Symptom
Creating a player with recruitment details but no draft year silently creates a draft record for the server's current calendar year.

### Reproduction
Create a player and fill only “Recruited from” (or another draft detail that makes `draftInfo` non-null) while leaving draft year empty.

### Expected
The server either requires an explicit draft year before creating a draft record or stores no draft record. It must not manufacture a historical fact.

### Actual
`createPlayer` uses `d.draftYear || (birthYear ? birthYear + 18 : new Date().getFullYear())`.

### Evidence
The action constructs `draftInfo` when recruitment origin alone is present. The query then guesses a year from DOB or the wall clock despite `draft_picks.draft_year` being presented as factual history.

### Root cause
An optional form section was forced into a non-null schema row using a guessed default rather than explicit validation.

### Fix
Both action and query boundaries now require an explicit draft year from 1981 to 2100 whenever any draft detail is supplied.

### Validation
Focused tests cover partial rejection and preservation of the supplied year; all passed.

### Follow-up
Confirm whether manually created draft rows should also create a `draft_persons` identity row; the current changelog says they do, but the implementation does not.

## AFLDB-ISSUE-009 — Match save and delete use unsupported prepared multi-statements

- **Status:** Resolved
- **Severity:** High
- **Area:** Admin
- **Found:** 2026-08-20
- **Resolved:** 2026-08-20
- **Files:** `src/db/queries/match-sheet.ts`, `src/db/queries/match-admin.ts`

### Symptom
Saving a match sheet or deleting a match with at least one affected player fails and rolls the transaction back.

### Reproduction
Save a sheet containing one player, or delete a match containing one `player_match_stats` row.

### Expected
Each parameterised postgres.js tagged query contains one SQL statement, and the mutation completes atomically.

### Actual
The affected-player blocks pass semicolon-separated `INSERT`/`DELETE` statement pairs through ordinary tagged queries.

### Evidence
The local postgres.js documentation states that extended/prepared queries support only one statement and that multi-statement execution requires `.simple()`, which cannot safely carry these dynamic parameters. Multiple blocks in both mutation files contain two statements in one tagged call.

### Root cause
Canonical rebuild script fragments were copied into parameterised application queries without adapting them to postgres.js's single-statement protocol.

### Fix
Replaced copied multi-command blocks with a shared helper whose parameterized tagged queries each contain exactly one SQL command inside the surrounding transaction.

### Validation
The single-command source-contract test and type check passed. Database execution remains unrun without the guarded test URL.

### Follow-up
Split every mutation statement and retain the surrounding database transaction; do not use unparameterised `.simple()` as a workaround.

## AFLDB-ISSUE-010 — Manual award winners collide on a single null source key

- **Status:** Resolved
- **Severity:** High
- **Area:** Admin
- **Found:** 2026-08-20
- **Resolved:** 2026-08-20
- **Files:** `src/db/queries/awards-admin.ts`, `src/db/migrations/042_awards_natural_keys.sql`

### Symptom
After one manually created award winner exists, creating a second unrelated winner fails with a unique-key violation.

### Reproduction
Call `createAwardWinner` twice for different awards or seasons on a database with migration 042 applied.

### Expected
Each manual record has explicit manual provenance and its own stable source record key.

### Actual
The helper omits both `source_id` and `source_record_id`; migration 042 deliberately defines `UNIQUE NULLS NOT DISTINCT (source_id, source_record_id)`, so every source-less manual row shares the key `(NULL, NULL)`.

### Evidence
The insert column list in `createAwardWinner` contains neither provenance field. Migration 042 documents and enforces nulls as non-distinct.

### Root cause
The GUI insertion path was added after the natural-key constraint but did not mint provenance for manual facts.

### Fix
Manual winners now require the `manual_admin_edit` source and receive a collision-resistant `award_winner:<UUID>` source record ID before insertion.

### Validation
Focused award mutation tests cover distinct keys and missing-source refusal; database constraint execution remains unrun.

### Follow-up
Use the existing `manual_admin_edit` source and a collision-resistant per-record identifier.

## AFLDB-ISSUE-011 — New editor entities cannot write their promised audit snapshots

- **Status:** Resolved
- **Severity:** High
- **Area:** Admin
- **Found:** 2026-08-20
- **Resolved:** 2026-08-20
- **Files:** `src/db/migrations/057_data_edits.sql`, `src/db/queries/awards-admin.ts`, `src/db/queries/data-edits.ts`

### Symptom
Manual award, Hall of Fame, and honour-team creations report success without a `data_edits` snapshot; draft-pick edits apply the statistical change and then return an audit failure.

### Reproduction
Create any of the three new honours entities, or save an edit whose entity is `draft_picks`, with migration 057 applied.

### Expected
Every newly registered editor entity is accepted by the append-only `data_edits.table_name` constraint and receives its promised audit row.

### Actual
Migration 057 permits only `players` and `matches`. Awards helpers catch and suppress the resulting constraint error; `saveEdit` surfaces it only after the statistical transaction has already committed.

### Evidence
The migration CHECK is `table_name IN ('players', 'matches')`, while the new code writes `award_winners`, `hall_of_fame`, `honour_team_members`, and `draft_picks`.

### Root cause
New editable entities were added without the required follow-up migration widening the allowlisted audit vocabulary.

### Fix
Migration 058 widens the existing `data_edits.table_name` CHECK only to the registered player, match, draft, award, Hall of Fame, and honour-team entities. Audit failures are surfaced as do-not-retry warnings.

### Validation
Focused awards and edit-spec tests passed. Migration 058 was reviewed but not applied because no guarded test database is configured.

### Follow-up
Add an ordered migration and privilege-safe integration assertions for every registered entity.

## AFLDB-ISSUE-012 — Draft resolution links unrelated same-name people

- **Status:** Resolved
- **Severity:** High
- **Area:** Import
- **Found:** 2026-08-20
- **Resolved:** 2026-08-20
- **Files:** `src/db/queries/player-links.ts`, `src/db/migrations/019_draft_persons.sql`

### Symptom
Resolving one unresolved draft pick can link multiple distinct draft people with the same displayed name to one AFLDB player.

### Reproduction
Create or locate two unresolved `draft_persons` rows with the same `display_name_raw`, then resolve a pick belonging to one of them.

### Expected
Resolution follows the target pick's `draft_person_id` and durable external identity only, then propagates consistently to picks for that exact person.

### Actual
`resolveLink` updates a draft person by target ID **or** every currently unlinked person whose raw display name equals the target pick's raw name.

### Evidence
Migration 019 explicitly states that names vary and identity is keyed by `(source_id, dg_person_id)`. The query's raw-name fallback ignores that model.

### Root cause
A convenience fallback treated a display name as an identity key in a subsystem created specifically to avoid name-keyed identity.

### Fix
Resolution now requires the target's numeric `draft_person_id`, updates that exact person, and propagates only to picks carrying the same durable ID. All raw-name fanout was removed.

### Validation
Focused tests cover same-name safety, exact propagation, missing identity, and parameterized audit values; all passed.

### Follow-up
Cover same-name people and propagation across multiple picks for one `draft_person_id`.

## AFLDB-ISSUE-013 — Create-and-link can leave an orphan player after a stale submission

- **Status:** Resolved
- **Severity:** Medium
- **Area:** Admin
- **Found:** 2026-08-20
- **Resolved:** 2026-08-20
- **Files:** `src/app/admin/player-links/actions.ts`, `src/db/queries/players.ts`, `src/db/queries/player-links.ts`

### Symptom
The “Create & link new” action can create a player profile and then fail to link it, leaving an unintended zero-game player in the public database.

### Reproduction
Open an unresolved-row drawer, resolve the target in another session, then submit the stale create-and-link form.

### Expected
The target is locked and confirmed unresolved before player creation; creating the player and linking the target commit or roll back together.

### Actual
The action commits `createPlayer` first, then starts a separate transaction in `resolveLink`. A stale or otherwise unresolvable target causes only the second step to fail.

### Evidence
`createAndLinkPlayer` awaits the two exported helpers sequentially, and each helper opens and commits its own import-role transaction.

### Root cause
A compound user operation was composed at the action layer instead of inside one database transaction.

### Fix
Create-and-link now locks and rechecks the unresolved target first, then creates the player and applies the link in one import-role transaction using a shared transaction-scoped player helper.

### Validation
Focused mocked-transaction tests prove lock-before-insert, stale refusal without insert, and a single transaction. Database concurrency execution remains unrun.

### Follow-up
Keep auth audit recording visible if the statistical transaction succeeds but the separate auth-role audit write fails.

## AFLDB-ISSUE-014 — Zero attendance cannot be created without provenance

- **Status:** Resolved
- **Severity:** Medium
- **Area:** Admin
- **Found:** 2026-08-20
- **Resolved:** 2026-08-20
- **Files:** `src/db/queries/match-admin.ts`, `src/db/migrations/020_attendance_provenance.sql`

### Symptom
Creating a match with a recorded attendance of zero fails its database constraint even though the admin form explicitly permits zero.

### Reproduction
Submit the new-match form with attendance `0` against a schema with migration 020 applied.

### Expected
A recorded zero has explicit source provenance and is distinguishable from an unknown attendance.

### Actual
The create path marks attendance complete but omits `attendance_source_id`, violating `matches_zero_attendance_ck`.

### Evidence
Migration 020 requires a source whenever attendance is zero; the original insert populated neither source field nor a manual source lookup.

### Root cause
The match-creation path implemented attendance coverage without implementing the schema's provenance contract.

### Fix
Match creation now resolves the existing `manual_admin_edit` source whenever attendance is recorded, including zero, and stores its ID with complete coverage.

### Validation
The source/schema regression test passed. Database constraint execution remains unavailable without `AFLDB_TEST_DATABASE_URL`.

### Follow-up
Exercise the zero-attendance insert in the guarded integration suite when a test database is available.

## AFLDB-ISSUE-015 — Match mutations leave source-derived club-season ladders stale

- **Status:** Open
- **Severity:** High
- **Area:** Database
- **Found:** 2026-08-20
- **Resolved:** N/A
- **Files:** `src/db/queries/match-admin.ts`, `src/db/queries/data-edits.ts`, `src/db/queries/player-derived.ts`, `src/db/queries/seasons.ts`

### Symptom
After creating, deleting, or correcting the score of a match, stored `club_seasons` ladder rows can disagree with the authoritative match facts.

### Reproduction
Create or delete a match, or correct an existing match score, then read the affected season's ladder.

### Expected
The canonical, season-aware `club_seasons` materialisation is refreshed before commit.

### Actual
Season metadata is now refreshed, but the mutation paths still leave `club_seasons` unchanged.

### Evidence
Public ladder queries read stored `club_seasons`; the repaired mutation helpers update match facts, season metadata, and player summaries but do not rebuild those rows.

### Root cause
The new point mutations were not connected to the canonical season-level rebuild pipeline.

### Fix
Season metadata recomputation is implemented. `club_seasons` remains open because historical ladder/premiership rules require the canonical policy rather than an improvised local aggregate.

### Validation
Static regression coverage confirms both create and delete invoke season metadata recomputation. Ladder correctness is not yet repaired.

Current review on 2026-08-21 confirmed this remains a genuine product defect, not a stale ledger entry: public season/ladders still read stored `club_seasons`, and point-mutation paths still do not call a targeted `club_seasons` rebuild. No code change was made during the NL audit because this requires extracting the canonical season-aware ladder policy rather than improvising a local aggregate.

### Follow-up
Extract a targeted `club_seasons` rebuild from the canonical migration logic, including season-specific points and finals policy, then add database-backed fixtures.

## AFLDB-ISSUE-016 — Duplicate match retries create duplicate fixtures

- **Status:** Resolved
- **Severity:** High
- **Area:** Admin
- **Found:** 2026-08-20
- **Resolved:** 2026-08-20
- **Files:** `src/db/queries/match-admin.ts`, `src/db/migrations/003_matches.sql`

### Symptom
Submitting the same fixture twice creates two match rows.

### Reproduction
Call `createMatch` twice with the same season, round, date, home club, and away club.

### Expected
The stable natural key makes the operation fail clearly or return the existing fixture.

### Actual
The original helper detected the collision and appended `Date.now()` to the key before inserting a duplicate.

### Evidence
Migration 003 defines `match_key` as the unique season/round/date/home/away identity, while the helper deliberately replaced it after a collision.

### Root cause
A uniqueness violation was treated as a key-generation problem rather than duplicate-fact detection.

### Fix
Removed the time-based key suffix. An existing stable match key now returns a clear duplicate error, while the database unique constraint remains the concurrent backstop.

### Validation
The duplicate-key source regression passed; a concurrent database test remains unrun.

### Follow-up
Add a concurrent database integration test for two identical submissions.

## AFLDB-ISSUE-017 — “Previous lineup” can come from the current or a future match

- **Status:** Resolved
- **Severity:** Medium
- **Area:** Admin
- **Found:** 2026-08-20
- **Resolved:** 2026-08-20
- **Files:** `src/db/queries/matches.ts`, `src/app/admin/data-editor/page.tsx`

### Symptom
Prefilling a match sheet can copy the same match's lineup or a later round's players.

### Reproduction
Edit the latest populated match, or edit an earlier match after later fixtures have lineups, and choose the recent-lineup prefill.

### Expected
The lookup returns only the latest club lineup strictly before the edited match in match chronology.

### Actual
The original query accepted only club and season, searched every match at or before the season, and chose the global latest row.

### Evidence
The page did not pass the target match ID and the query had no strict date/ID bound relative to it.

### Root cause
The prefill lookup used a season ceiling instead of the edited match as its temporal anchor.

### Fix
The page now passes the edited match ID and the query selects the latest lineup under a strict `(match_date, id)` predecessor bound.

### Validation
The strict-predecessor source regression passed.

### Follow-up
Cover same-day double-headers in a database-backed test.

## AFLDB-ISSUE-018 — Zero-game players display unrecorded era statistics as zero

- **Status:** Resolved
- **Severity:** Medium
- **Area:** Statistics
- **Found:** 2026-08-20
- **Resolved:** 2026-08-20
- **Files:** `src/db/queries/players.ts`, `src/db/queries/player-derived.ts`, `src/db/migrations/007_derived_stats.sql`

### Symptom
A newly created player, or a player whose last erroneous match is deleted, displays zero for statistics that were never recorded.

### Reproduction
Create a player with no matches and inspect era-limited career fields such as disposals.

### Expected
Totals with zero recorded games remain `NULL`, which the public profile renders as not recorded.

### Actual
The original seed and deletion rebuild wrote literal zero to every career total.

### Evidence
Migration 007 documents `NULL` for never-recorded disposals; the UI directly renders the stored semantic distinction.

### Root cause
The zero-game seed conflated an additive identity with absence of measurement.

### Fix
Both player creation and last-match deletion seed additive always-recorded totals at zero while keeping era-limited totals `NULL` with recorded-game counts at zero. Player reads preserve those nullable values.

### Validation
Focused player creation and match-mutation tests passed; a database-backed profile fixture remains unrun.

### Follow-up
Run a database integration assertion covering create and delete-last-match paths.

## AFLDB-ISSUE-019 — Admin forms accept historically inactive club identities

- **Status:** Resolved
- **Severity:** High
- **Area:** Identity
- **Found:** 2026-08-20
- **Resolved:** 2026-08-20
- **Files:** `src/db/queries/match-admin.ts`, `src/db/queries/awards-admin.ts`, `src/db/queries/players.ts`, `src/db/migrations/017_club_organizations.sql`

### Symptom
An administrator can attach a modern club identity to a historical match or club-scoped award, rewriting how that history is labelled publicly.

### Reproduction
Select the Western Bulldogs identity for a 1980 fact rather than the Footscray identity.

### Expected
Stored club IDs match `afldb_identity_for_season(organization_id, season)`.

### Actual
The forms list every identity and the original mutation helpers checked only for positive numeric IDs.

### Evidence
Migration 017 provides the season-aware identity function, but the original match and award write paths did not call it.

### Root cause
UI dropdown membership was mistaken for historical-identity validation.

### Fix
Match creation, draft selection creation, club best-and-fairest inference, and every optional award club context now validate `afldb_identity_for_season` at the query boundary.

### Validation
Focused match, draft, and award identity tests passed.

### Follow-up
Keep the validation at the query boundary for every season-scoped club fact.

## AFLDB-ISSUE-020 — Partial disposal components manufacture a total

- **Status:** Resolved
- **Severity:** Medium
- **Area:** Statistics
- **Found:** 2026-08-20
- **Resolved:** 2026-08-20
- **Files:** `src/db/queries/match-sheet.ts`, `src/lib/match-sheet.ts`

### Symptom
Entering only kicks or only handballs can store that component as the player's total disposals.

### Reproduction
Save a player row with kicks recorded, handballs and disposals blank.

### Expected
Disposals are derived only when both components are known; otherwise the total remains unknown.

### Actual
The original expression treated the missing component as zero.

### Evidence
The write path used null-coalescing for each component before addition, violating the project's NULL-versus-zero rule.

### Root cause
Arithmetic convenience erased measurement coverage.

### Fix
Disposals are derived only when both kicks and handballs are recorded; an explicit disposal total is preserved and a partial component pair stays `NULL`.

### Validation
Focused unit tests for complete, partial, and explicit totals passed.

### Follow-up
None beyond database-backed mutation coverage.

## AFLDB-ISSUE-021 — Match mutations leave career game numbers stale

- **Status:** Resolved
- **Severity:** Medium
- **Area:** Statistics
- **Found:** 2026-08-20
- **Resolved:** 2026-08-20
- **Files:** `src/db/queries/player-derived.ts`, `src/db/queries/match-sheet.ts`, `src/db/queries/match-admin.ts`

### Symptom
Adding or deleting a historical appearance leaves `player_match_stats.career_game_no` missing, duplicated, or out of sequence for later games.

### Reproduction
Insert or delete a match in the middle of a player's career and inspect game-number consumers.

### Expected
Affected players are renumbered deterministically by match date and ID inside the mutation transaction.

### Actual
The original point-mutation rebuilds never touched `career_game_no`.

### Evidence
Public match grids and natural-language features consume this stored field, while only the offline rebuild previously populated it.

### Root cause
The point-mutation derived-stat subset omitted an ordering-dependent column.

### Fix
The shared targeted rebuild renumbers every affected player's appearances deterministically by match date and match ID in the same transaction.

### Validation
The source-contract regression for the windowed renumber passed; a database mid-career deletion fixture remains unrun.

### Follow-up
Add an integration fixture for a mid-career deletion.

## AFLDB-ISSUE-022 — Score synchronization leaves the final period total stale

- **Status:** Resolved
- **Severity:** Medium
- **Area:** Statistics
- **Found:** 2026-08-20
- **Resolved:** 2026-08-20
- **Files:** `src/db/queries/match-sheet.ts`, `src/db/migrations/003_matches.sql`

### Symptom
Synchronizing final scores from player totals updates `matches` but leaves the final `match_period_scores` row showing the old score.

### Reproduction
Change complete player goals/behinds, enable synchronization, then compare the match total with its last period row.

### Expected
Both representations of the final score agree in the same transaction.

### Actual
The original synchronization path updated only `matches`.

### Evidence
Public match rendering reads both match and period score data; the mutation contained no period-score write.

### Root cause
The denormalized final-period representation was omitted from synchronization.

### Fix
Unsafe player-stat score synchronization was removed. Official Match Details score edits now upsert the explicit cumulative final period, using period four unless existing extra-time rows establish a later period.

### Validation
Source-contract tests cover both synchronization refusal and the explicit-score period upsert; type checking passed.

### Follow-up
Confirm overtime-period policy with a database fixture; the implementation updates the greatest existing period, defaulting to period four.

## AFLDB-ISSUE-023 — Generic awards editor bypasses authoritative Brownlow storage

- **Status:** Resolved
- **Severity:** High
- **Area:** Statistics
- **Found:** 2026-08-20
- **Resolved:** 2026-08-20
- **Files:** `src/db/queries/awards-admin.ts`, `src/app/admin/data-editor/AwardWinnerForm.tsx`, `src/db/queries/awards.ts`

### Symptom
The editor can report a successful Brownlow winner insertion that does not appear in authoritative Brownlow season or career totals.

### Reproduction
Choose the Brownlow award in the generic award form and create a winner.

### Expected
Brownlow facts are edited only through the authoritative `brownlow_season_votes` workflow, or the generic form clearly refuses them.

### Actual
The form inserts `award_winners`, while Brownlow pages and career totals read `brownlow_season_votes`.

### Evidence
The two query families use different source tables and no synchronization joins them.

### Root cause
All award definitions were exposed to one generic mutation despite Brownlow's separate authoritative grain.

### Fix
The generic form omits Brownlow and explains the authoritative workflow; the lower helper rejects the Brownlow slug before provenance lookup or insertion.

### Validation
Focused UI/source and mocked-query tests passed.

### Follow-up
Fail closed in both the action and lower-level helper unless a provenance-aware Brownlow editor is implemented.

## AFLDB-ISSUE-024 — Club best-and-fairest winners can use the wrong or no club

- **Status:** Resolved
- **Severity:** High
- **Area:** Identity
- **Found:** 2026-08-20
- **Resolved:** 2026-08-20
- **Files:** `src/db/queries/awards-admin.ts`, `src/app/admin/data-editor/AwardWinnerForm.tsx`, `src/db/queries/awards.ts`

### Symptom
A club best-and-fairest winner can be saved without the defining club, or against an unrelated identity, and disappear from club-scoped public queries.

### Reproduction
Create a club best-and-fairest award row with the club blank or different from the award definition.

### Expected
The award definition determines the required organization and the stored identity is valid for that season.

### Actual
The original helper accepts the optional form `clubId` unchanged.

### Evidence
Public club award queries filter the winner's club context; no query-boundary consistency check existed.

### Root cause
Definition metadata and winner context were independently user-selectable.

### Fix
The award definition's organization now determines the historical club identity for the winner's season. Missing definitions, missing active identities, and mismatched submitted clubs fail closed.

### Validation
Focused award tests cover inferred, missing, and wrong-era club contexts; all passed.

### Follow-up
Pin club-scoped winners to the award definition and validate the historical identity at the query boundary.

## AFLDB-ISSUE-025 — Honour-team upsert can overwrite a distinct same-name player

- **Status:** Resolved
- **Severity:** High
- **Area:** Identity
- **Found:** 2026-08-20
- **Resolved:** 2026-08-20
- **Files:** `src/db/queries/awards-admin.ts`, `src/db/migrations/042_awards_natural_keys.sql`

### Symptom
Adding a linked honour-team member can rewrite an existing member with the same raw display name to a different player ID.

### Reproduction
Add two distinct linked people with the same name to one honour team.

### Expected
Linked identity is keyed by player ID; an unlinked raw-name collision never silently overwrites a linked person.

### Actual
The unique key and `ON CONFLICT` target are `(team_name, player_name_raw)`, and the update replaces `player_id`.

### Evidence
The mutation's conflict branch explicitly assigns the new linked identity to the old name-keyed row.

### Root cause
A presentation name was used as the durable identity key.

### Fix
Migration 059 replaces name-only uniqueness with partial keys for linked `(team_name, player_id)` and unlinked `(team_name, player_name_raw)` rows. Upserts target the matching identity-aware index.

### Validation
Focused source/query tests passed. Migration 059 was not applied; it deliberately fails closed if existing linked duplicates require review.

### Follow-up
Use separate partial uniqueness for linked player IDs and unlinked names, and make creation fail rather than overwrite.

## AFLDB-ISSUE-026 — Submission rejection can overwrite a concurrent workflow transition

- **Status:** Resolved
- **Severity:** Medium
- **Area:** Admin
- **Found:** 2026-08-20
- **Resolved:** 2026-08-20
- **Files:** `src/db/queries/submissions.ts`, `src/app/admin/submissions/actions.ts`

### Symptom
A stale reject action can mark a submission rejected after another administrator has already advanced it.

### Reproduction
Open the same submission in two sessions, advance it in one, then reject from the stale session.

### Expected
The update includes the permitted prior state and reports a conflict when no row transitions.

### Actual
The rejection update originally selected only by ID and did not verify the affected row count.

### Evidence
Other workflow transitions use explicit state checks; rejection lacked the equivalent guard.

### Root cause
One terminal action bypassed the submission state machine's compare-and-set pattern.

### Fix
Rejection is now one conditional `UPDATE ... WHERE status IN (...) RETURNING id`. A zero-row result reports a stale/invalid transition and skips success audit and revalidation.

### Validation
The regression reproduced as two failures before the fix and passed 2/2 afterward; type checking passed.

### Follow-up
Add a concurrency-oriented query contract test.

## AFLDB-ISSUE-027 — Statistical mutations and required audits commit separately

- **Status:** Open
- **Severity:** High
- **Area:** Architecture
- **Found:** 2026-08-20
- **Resolved:** N/A
- **Files:** `src/db/queries/match-sheet.ts`, `src/db/queries/match-admin.ts`, `src/db/queries/awards-admin.ts`, `src/db/queries/data-edits.ts`, `src/db/queries/player-links.ts`, `src/app/admin/data-editor/actions.ts`

### Symptom
A statistical mutation can commit without its promised audit snapshot, or can commit and then return an error that encourages a duplicate retry.

### Reproduction
Make the import-role write succeed and the separate auth-role `data_edits` insert fail.

### Expected
The mutation and its durable audit evidence have one atomic outcome, or a transactional outbox makes delayed audit delivery explicit and retry-safe.

### Actual
The writes use different pools/transactions. Some paths swallow the audit failure; others surface it only after the fact has committed.

### Evidence
The helpers close the import transaction before calling `authSql`; no cross-connection transaction coordinates them.

### Root cause
Audit storage and statistical storage use role-separated connections without an atomic delivery design.

### Fix
Not fixed architecturally. Repaired admin paths now return an explicit success-with-warning result on post-commit audit failure, render “do not retry,” and avoid automatic redirects/refreshes that would hide it. Player creation also writes a `data_edits` snapshot. The two role-separated commits are still not atomic.

### Validation
Focused warning-path tests passed for awards and player links; source review covers match, player, and generic-edit warnings. No cross-role failure integration fixture was available.

Current review on 2026-08-21 confirmed this remains a genuine architecture gap: statistical writes and audit writes still use separate role-scoped connections, so the warning UI mitigates duplicate retries but does not provide atomic audit durability. No code change was made during the NL audit.

### Follow-up
Choose and implement a database-owned audit function callable within the import transaction, or a durable transactional outbox with idempotent delivery.

## AFLDB-ISSUE-028 — Mutation cache invalidation omits dynamic public pages

- **Status:** Resolved
- **Severity:** Medium
- **Area:** Web
- **Found:** 2026-08-20
- **Resolved:** 2026-08-20
- **Files:** `src/app/admin/data-editor/actions.ts`, `src/app/admin/player-links/actions.ts`

### Symptom
After an admin mutation, a public detail page can keep showing the old player, club, season, match, or award data until unrelated cache expiry.

### Reproduction
Save or delete a populated match sheet, then revisit affected dynamic player/club/season pages without a deployment or broad cache flush.

### Expected
Each mutation invalidates every dynamic route family that reads its changed facts.

### Actual
The original actions invalidated a small set of literal paths such as `/players` or `/matches/[id]`, which does not cover concrete dynamic pages.

### Evidence
The changed facts feed multiple dynamic page queries and Next.js requires a route-pattern invalidation type for dynamic patterns.

### Root cause
Cache invalidation was scoped to form redirects rather than the query dependency graph.

### Fix
Match, match-sheet, generic edit, player, draft-link, award, Hall of Fame, and honour-team actions now invalidate the dynamic route families that consume their changed facts.

### Validation
Type checking passed and source review confirmed dynamic route-pattern calls use the required `page` type.

### Follow-up
Audit award, player creation, and link-resolution route dependencies and add action-level tests where practical.

## AFLDB-ISSUE-029 — New-match numeric fields trust browser-only constraints

- **Status:** Resolved
- **Severity:** High
- **Area:** Admin
- **Found:** 2026-08-20
- **Resolved:** 2026-08-20
- **Files:** `src/app/admin/data-editor/CreateMatchForm.tsx`, `src/app/admin/data-editor/actions.ts`, `src/db/queries/match-admin.ts`

### Symptom
A hand-posted new-match request can store negative or fractional scores, and partially entered score components can be converted into a total by treating the missing component as zero.

### Reproduction
Submit `homeGoals=-1`, a fractional score, or `homeGoals=3` with both home behinds and total score absent.

### Expected
The action and lower-level write boundary require bounded non-negative integers, preserve partial component uncertainty, and require an explicit score representation for both clubs.

### Actual
The original action accepted any JavaScript number and the query performed arithmetic with `?? 0`; the match schema has no non-negative score constraints.

### Evidence
HTML `min` attributes are bypassable. `parseScoreNum` accepted negative, fractional, and infinite values, while the query defaulted missing components and totals to zero.

### Root cause
Presentation-layer input constraints were treated as the statistical validation boundary.

### Fix
Added one shared pure numeric validator at action and query boundaries. It requires bounded finite integers, consistent component totals, and an explicit score representation for both clubs; the form no longer derives a total from one partial component.

### Validation
`tests/admin-match-input.test.ts` passed all valid, negative, fractional, infinite, partial, mismatch, attendance, and quarter-score cases.

### Follow-up
Add a shared pure validator used by both the server action and the database helper, with focused boundary tests.

## AFLDB-ISSUE-030 — Match mutations overwrite independently sourced Brownlow round votes

- **Status:** Resolved
- **Severity:** High
- **Area:** Statistics
- **Found:** 2026-08-20
- **Resolved:** 2026-08-20
- **Files:** `src/db/queries/match-sheet.ts`, `src/db/queries/match-admin.ts`, `src/db/migrations/005_brownlow_awards.sql`

### Symptom
Saving or deleting a match can delete an official Brownlow round row, including one belonging to an unrelated match in the same round.

### Reproduction
Seed a round-vote row for a player outside the target match, pass that ID in `removedPlayerIds`, and save the target match.

### Expected
Independently imported `brownlow_round_votes` change only through an explicit provenance-aware round-vote workflow.

### Actual
The match helpers delete affected season/round/player rows and rebuild them from per-match detail.

### Evidence
Migration 005 and the public round query describe round detail as independently sourced; affected IDs include caller-supplied removals not proven to belong to the target match.

### Root cause
The same grain-collapse mistake as ISSUE-001 was retained for round totals after season-total writes were removed.

### Fix
Removed every match-save/delete write to `brownlow_round_votes`; per-match detail remains in `player_match_stats` and independent round facts require their own workflow.

### Validation
The Brownlow source-contract test asserts no round or season authority mutation and passed.

### Follow-up
Remove all round-table writes from match mutations and add a source-level regression guard.

## AFLDB-ISSUE-031 — Player-stat score sync loses rushed behinds

- **Status:** Resolved
- **Severity:** High
- **Area:** Statistics
- **Found:** 2026-08-20
- **Resolved:** 2026-08-20
- **Files:** `src/db/queries/match-sheet.ts`, `src/app/admin/data-editor/MatchSheetEditor.tsx`

### Symptom
Synchronizing a legitimate match score from player statistics can reduce the team behind total and change the result.

### Reproduction
Use a match with team score 10.5 and player-attributed totals of 10.4 because one behind was rushed, then enable synchronization.

### Expected
Unattributed scoring is preserved explicitly; a player-only aggregate never claims to be the team total.

### Actual
The helper replaces team behinds with the sum of player behinds after checking only that player fields are non-null.

### Evidence
The AFL/AFLW profiling code explicitly models team behinds as potentially greater than attributed player behinds.

### Root cause
The feature assumed every team scoring event belongs to a player row.

### Fix
Removed the unsafe synchronization control, hard-coded the UI submission to false, explained the attribution limitation, and reject a forged true value before database access.

### Validation
Focused source-contract and match-sheet tests passed; no player-stat path writes team or period scores.

### Follow-up
Disable this synchronization path until unattributed/rushed scoring has an explicit write model.

## AFLDB-ISSUE-032 — Season-status changes leave player Brownlow coverage stale

- **Status:** Resolved
- **Severity:** High
- **Area:** Statistics
- **Found:** 2026-08-20
- **Resolved:** 2026-08-20
- **Files:** `src/db/queries/player-derived.ts`, `src/db/queries/match-admin.ts`, `tools/migration/rebuild_derived.py`

### Symptom
Completing or reopening a season can leave player-season Brownlow status at the prior `pending` or final value.

### Reproduction
Create or delete the decisive Grand Final in the latest season and inspect players who were not in that match.

### Expected
Season metadata changes first, then Brownlow coverage is refreshed for every player-season row in that season.

### Actual
The original repair recomputed affected players before season metadata and never refreshed uninvolved players.

### Evidence
The canonical rebuild explicitly orders season metadata before player-season stats because coverage reads `seasons.status`.

### Root cause
A match-participant scope was incorrectly applied to a season-wide state transition.

### Fix
Added a season-wide Brownlow coverage update and ordered metadata before participant recomputation for create, delete, and official score correction paths.

### Validation
The dependency-order source regression passed, and the follow-up SQL review found the single-command CTE update valid. Database execution remains unrun.

### Follow-up
Add a season-wide targeted coverage refresh and enforce call ordering in regression tests.

## AFLDB-ISSUE-033 — Deleting an auto-created season's only match marks it complete

- **Status:** Resolved
- **Severity:** Medium
- **Area:** Database
- **Found:** 2026-08-20
- **Resolved:** 2026-08-20
- **Files:** `src/db/queries/player-derived.ts`, `src/db/queries/match-admin.ts`

### Symptom
Deleting the sole match from a newly created latest season leaves a zero-match season labelled complete.

### Reproduction
Create the first match for a future season, then delete it.

### Expected
An empty retained season stays in progress, or is removed only when it is proven safe and unreferenced.

### Actual
The metadata CASE falls through to `complete` because the season is no longer the maximum season in `matches`.

### Evidence
The canonical rebuild updates only seasons present in its loaded-match CTE; it never turns an empty season complete.

### Root cause
The targeted summary omitted an explicit zero-match branch.

### Fix
The targeted metadata aggregate has an explicit zero-match branch that retains the season as `in_progress` with zero count and null dates.

### Validation
Source regression and follow-up SQL review passed; a database delete-only-match fixture remains unrun.

### Follow-up
Preserve the empty season as `in_progress` and cover it in database-backed tests.

## AFLDB-ISSUE-034 — Match mutations leave player search rank stale

- **Status:** Resolved
- **Severity:** Medium
- **Area:** Search
- **Found:** 2026-08-20
- **Resolved:** 2026-08-20
- **Files:** `src/db/queries/player-derived.ts`, `src/db/migrations/008_search.sql`, `src/db/queries/search.ts`

### Symptom
Adding or deleting games changes career totals but not the player's search ordering weight.

### Reproduction
Mutate an affected player's match count and compare `players.search_rank` with `player_career_stats.games`.

### Expected
Search rank is refreshed from the recomputed career game count in the same transaction.

### Actual
The targeted helper updates only debut/final seasons on `players`.

### Evidence
Migration 008 and the canonical rebuild define rank from career games, and public search orders by it.

### Root cause
The denormalized search field was omitted from the point-rebuild dependency list.

### Fix
The shared player rebuild now updates `players.search_rank` from the rebuilt career games for every affected player, including zero-game rows.

### Validation
The search-rank source regression and follow-up SQL review passed.

### Follow-up
Update rank after career insertion and add a source-level regression guard.

## AFLDB-ISSUE-035 — Score sync can overwrite a sparse early-period row as the final score

- **Status:** Resolved
- **Severity:** Medium
- **Area:** Statistics
- **Found:** 2026-08-20
- **Resolved:** 2026-08-20
- **Files:** `src/db/queries/match-sheet.ts`, `src/db/migrations/003_matches.sql`

### Symptom
If only Q1 or Q2 is recorded, score synchronization overwrites that period with the final match total.

### Reproduction
Create a match with only a Q1 period row and synchronize the score from a complete lineup.

### Expected
Sparse cumulative period observations remain at their actual period; final-period identity is never inferred from `max(period)`.

### Actual
The repair selected the greatest existing period and treated it as final.

### Evidence
The schema permits sparse period rows and the create form inserts any subset of Q1–Q4.

### Root cause
Row availability was mistaken for period semantics.

### Fix
Player-stat score sync was removed. Explicit Match Details corrections select at least period four and use a later period only when existing extra-time rows establish one.

### Validation
Source-contract tests assert both the absence of match-sheet period writes and the sparse-safe explicit-score policy.

### Follow-up
Remove the unsafe synchronization write pending an explicit final-period policy.

## AFLDB-ISSUE-036 — Brownlow vote allocation lacks cross-player validation

- **Status:** Resolved
- **Severity:** High
- **Area:** Statistics
- **Found:** 2026-08-20
- **Resolved:** 2026-08-20
- **Files:** `src/lib/match-sheet.ts`, `src/db/queries/match-sheet.ts`

### Symptom
A match sheet can award three votes to multiple players, omit a placing, or publish any other invalid distribution.

### Reproduction
Submit two player rows with `brownlowVotes: 3` in an eligible home-and-away match.

### Expected
A recorded allocation has exactly one 3, one 2, and one 1; an unpublished allocation is entirely blank.

### Actual
Validation checks each value independently only for the range 0–3.

### Evidence
No cross-row count or six-vote distribution check exists before the upserts.

### Root cause
Row validation did not encode the match-level invariant.

### Fix
Any non-null published allocation must contain exactly one 3, one 2, and one 1; zeroes may accompany it, while an entirely blank pending allocation remains valid.

### Validation
Focused tests cover valid, blank, duplicate-three, partial, and all-zero distributions; all passed.

### Follow-up
Add duplicate, partial, valid, and all-blank allocation tests.

## AFLDB-ISSUE-037 — Honours numeric facts rely on browser validation

- **Status:** Resolved
- **Severity:** Medium
- **Area:** Admin
- **Found:** 2026-08-20
- **Resolved:** 2026-08-20
- **Files:** `src/app/admin/data-editor/actions.ts`, `src/db/queries/awards-admin.ts`

### Symptom
Hand-posted honours forms can silently replace an invalid induction year with the current year, accept an invalid category, or store out-of-range votes and lineup order values.

### Reproduction
Submit a blank/non-numeric `inductedYear`, negative award votes, or a negative/fractional honour-team sort order.

### Expected
Factual numbers and vocabularies are validated at both action and query boundaries; missing history is never inferred from the wall clock.

### Actual
The original action defaulted an invalid induction year to `new Date().getFullYear()` and other fields relied on form attributes or permissive coercion.

### Evidence
The lower-level helpers accepted their typed inputs without runtime bounds, while server actions receive client-controlled `FormData`.

### Root cause
HTML controls and TypeScript types were treated as runtime data validation.

### Fix
Action and query boundaries now validate award season/votes, Hall of Fame category/induction/Legend years, and honour-team order. Invalid induction years are rejected rather than replaced by the current year.

### Validation
Focused lower-boundary tests passed, including proof that invalid values fail before a write connection opens; type checking passed.

### Follow-up
Add action and lower-boundary tests for years, categories, votes, and sort order.

## AFLDB-ISSUE-038 — Match Details score edits leave dependent facts stale

- **Status:** Resolved
- **Severity:** High
- **Area:** Statistics
- **Found:** 2026-08-20
- **Resolved:** 2026-08-20
- **Files:** `src/db/queries/data-edits.ts`, `src/lib/edit/spec.ts`, `src/db/queries/player-derived.ts`

### Symptom
Correcting an official team score changes the match result but leaves the displayed final period and participant win/loss, premiership, season, career, and season-status summaries at their old values.

### Reproduction
Use Match Details to change a winner or Grand Final result, then inspect period scoring and affected player summaries.

### Expected
The score, final cumulative period, result-dependent player summaries, season metadata, and season-wide Brownlow coverage update in one import transaction.

### Actual
The generic score group originally issued one `UPDATE matches` and returned without invoking any recomputation.

### Evidence
Public match queries read `match_period_scores`; player derived tables encode outcomes; the score edit path touched none of them.

### Root cause
The generic editor declared derived targets for display but did not connect the mutation to their rebuild functions.

### Fix
The score edit now updates the match and explicit final cumulative period, then recomputes season metadata, affected player summaries, season-wide Brownlow coverage, career game numbers, spans, and search rank inside the same import transaction.

### Validation
The dependency/order source regression passed and type checking passed. Database execution remains unrun; `club_seasons` is still explicitly reported for source reconciliation under ISSUE-015.

### Follow-up
Repair period and player/season dependencies transactionally. `club_seasons` remains the separate policy-bound limitation recorded in ISSUE-015.

## AFLDB-ISSUE-039 — Vitest configuration is loaded through a deprecated module mismatch

- **Status:** Resolved
- **Severity:** Low
- **Area:** Tooling
- **Found:** 2026-08-20
- **Resolved:** 2026-08-20
- **Files:** `vitest.config.ts`, `package.json`

### Symptom
Every test run warns that ESM syntax is being loaded as CommonJS and will be unsupported by Vite's planned native config-loader default.

### Reproduction
Run any `npm.cmd test -- ...` command.

### Expected
The configuration extension declares its ESM module format and tests start without compatibility warnings.

### Actual
`vitest.config.ts` uses ESM imports and `import.meta.url` in a package without `"type": "module"`.

### Evidence
Vitest emits the module-mismatch warning before every run and recommends an `.mjs`-family extension or package module declaration.

### Root cause
The config's filename does not communicate its existing ESM semantics to the loader.

### Fix
Renamed the unchanged ESM TypeScript configuration to `vitest.config.mts`, making its module semantics explicit without changing the package-wide module type.

### Validation
A post-rename focused Vitest run passed without the prior config-loader warning.

### Follow-up
None.

## AFLDB-ISSUE-040 — Lint script is not configured for non-interactive validation

- **Status:** Open
- **Severity:** Low
- **Area:** Tooling
- **Found:** 2026-08-20
- **Resolved:** N/A
- **Files:** `package.json`

### Symptom
`npm.cmd run lint` opens Next.js's first-time ESLint configuration prompt instead of linting the repository.

### Reproduction
Run the package lint script in a clean non-interactive shell.

### Expected
The checked-in lint configuration and dependencies let CI and local agents run a deterministic lint command.

### Actual
No ESLint dependency or configuration is installed, and the script calls the deprecated `next lint` command.

### Evidence
The final validation run reached the interactive Strict/Base/Cancel prompt; `npm.cmd ls eslint --depth=0` reported an empty dependency tree.

### Root cause
The package script was added without completing or checking in the lint-tool setup, and Next.js 15 now warns that its wrapper will be removed in Next.js 16.

### Fix
Not fixed because adding the required lint packages would modify dependencies and require registry access outside this local-only repair.

### Validation
Type checking and all 951 runnable non-integration assertions pass independently; lint is explicitly not run.

Current review on 2026-08-21 reproduced the dependency side of this issue: `npm.cmd ls eslint --depth=0` reports an empty dependency tree while `package.json` still maps `lint` to `next lint`. No dependency or lint-config change was made during this audit.

### Follow-up
Choose a checked-in ESLint flat configuration, add compatible ESLint/Next plugins through the normal dependency-review process, and replace `next lint` with the ESLint CLI.

## AFLDB-ISSUE-041 — Previous-lineup substitutions lack a team-scoped replacement control

- **Status:** Resolved
- **Severity:** High
- **Area:** UI
- **Found:** 2026-08-20
- **Resolved:** 2026-08-20
- **Files:** `src/app/admin/data-editor/MatchSheetEditor.tsx`, `src/lib/match-lineup-editor.ts`, `tests/match-lineup-editor.test.ts`, `tests/admin-match-mutations.test.ts`

### Symptom
After loading the previous match's lineup and removing one or two players with the row-level X button, the vacated team has no nearby replacement control. The administrator must return to the generic player search above both teams and separately choose the correct club; its Home default can also assign an Away replacement to the wrong side.

### Reproduction
Open a new match sheet, load either club's previous lineup, remove a player with X, and inspect the affected team section.

### Expected
Removing a player opens a clearly labelled `+ Add replacement` workflow for that same club. Multiple removals can be filled consecutively without repeatedly selecting the team.

### Actual
The player row disappears. The only add workflow is the shared `+ Add individual player to match lineup` picker and a sticky Home/Away selector above the tables.

### Evidence
The original `handleRemovePlayer` retained only the removed player ID, so it could not expose a club-specific vacancy. The original `handleAddPlayer` always assigned the shared `addTeamChoice`, which initialized to Home independently of the active team tab, and `renderPlayerTable` rendered no team-level replacement action.

### Root cause
The editor models the current player rows but not the lineup vacancies created by removals. Addition was implemented as a separate global workflow rather than the second half of a substitution.

### Fix
Added a pure lineup-state transition model that retains each vacancy's club, display order, removed player ID, and name. X now replaces the player row in place with a `+ Add replacement` search locked to that club; two removals create two independently fillable slots. Successful replacements keep the original row order, duplicate or wrong-team selections cannot consume a slot, and re-adding the same player cancels deletion bookkeeping. General additions also moved into explicit per-team controls, removing the sticky shared team selector.

### Validation
`npm.cmd run typecheck` passed. The focused substitution/match-sheet suites passed 25 assertions across three files, including Home/Away isolation, two-player substitutions, duplicate/wrong-team protection, restoration, and previous-lineup reload. The full safe non-integration suite passed 957 tests across 35 files.

### Follow-up
An authenticated browser fixture is not available locally, so visual interaction should also be exercised on the development deployment after review.

## AFLDB-ISSUE-042 — AFLPA 22 Under 22 teams are absent from Awards

- **Status:** Resolved
- **Severity:** Medium
- **Area:** Import
- **Found:** 2026-08-20
- **Resolved:** 2026-08-20
- **Files:** `data/awards/22-under-22.csv`, `tools/migration/under_22.py`, `tools/migration/import_awards.py`, `src/db/migrations/060_wikipedia_22_under_22_source.sql`, `src/db/migrations/061_award_winner_sort_order.sql`, `src/db/queries/awards.ts`

### Symptom
The Awards page has no 22 Under 22 representative team, even though annual Wikipedia extracts were supplied for every season from 2012 through 2026.

### Reproduction
Open `/awards` or look up the `22-under-22` award slug after the existing awards import.

### Expected
The Awards index lists 22 Under 22 as a representative team, with 22 selections per season plus positions, clubs, captain and vice-captain details for each supplied year.

### Actual
No award definition or winner rows exist for the series, so it cannot appear on the Awards page.

### Evidence
The 15 annual CSVs contain exactly 330 parseable selections (22 per season). The separate summary file is not authoritative: it omits three players with three selections and contains a malformed Harry Sheezel season list.

### Root cause
The legacy awards importer knows only its existing award tables and All-Australian sources; it has no canonical 22 Under 22 source or import group.

### Fix
Normalized the annual extracts into one committed, fail-closed source manifest and added a dedicated provenance record plus a scoped `under_22` awards import group. The loader creates the seasonal honour-team definition consumed by the existing Awards UI, resolves exact name/alias candidates only when source club and season match player-game evidence, preserves uncertain raw names as unlinked, retains deliberate manual resolutions and row IDs, and is included whenever the destructive full awards loader runs. Source order 1–22 now keeps each season page in formation order.

### Validation
The canonical checker reports 330 rows across 15 seasons, exactly 22 per year, 15 captains and 14 vice-captains (the supplied 2012 table names none). An independent tuple comparison against all 15 supplied annual CSVs found 330 expected, 330 actual and zero differences. Four focused source/importer/Awards files passed 43 tests, the full non-integration suite passed 976 tests, TypeScript passed, and Python AST parsing passed. Production build compilation and type validation succeeded but page-data collection could not run because this checkout has no `DATABASE_URL`. No database-backed import was run because no `_test` database is configured.

### Follow-up
After review, run the database migrations (including 060 and 061) and then run `tools/migration/import_awards.py --groups under_22` against development. Build/restart and verify 330 source rows plus `/awards/22-under-22`. Review any unlinked names reported by that database-specific resolution pass before considering a production load.

## AFLDB-ISSUE-043 — Migration planning documents read as current status

- **Status:** Resolved
- **Severity:** Low
- **Area:** Other
- **Found:** 2026-08-20
- **Resolved:** 2026-08-20
- **Files:** `docs/migration-inventory.md`, `docs/migration-report.md`

### Symptom
The migration inventory labels every core and awards dataset `PLANNED`, while the migration report says awards and draft are not migrated, contradicting the active pages and import tooling.

### Reproduction
Read the status table in `docs/migration-inventory.md` or section 7 of `docs/migration-report.md` as current operational guidance.

### Expected
Dated planning and run-result documents clearly state their time scope and point operators to the current import documentation.

### Actual
The old status language was unqualified, so it appeared to describe the current codebase.

### Evidence
The documents are dated 12–15 August 2026, while `tools/migration/import_awards.py`, `tools/migration/import_draft.py` and the public Awards/Draft pages are now active.

### Root cause
Historical planning and first-run notes were retained after Phase 3b without being labelled as snapshots.

### Fix
Labelled the inventory as a historical planning snapshot, time-scoped the report's outstanding section to its 15 August run, and linked both to the current importer documentation. Added the 22 Under 22 source to the inventory.

### Validation
Direct documentation review confirms the old statements are now explicitly dated and the current loader paths are named.

### Follow-up
Do not rewrite the historical measured counts; add a new dated migration report after the next full server-side refresh.

## AFLDB-ISSUE-044 — Full awards reload discards existing manual player resolutions

- **Status:** Open
- **Severity:** High
- **Area:** Import
- **Found:** 2026-08-20
- **Resolved:** N/A
- **Files:** `tools/migration/import_awards.py`, `src/db/queries/player-links.ts`

### Symptom
Running the legacy full awards group can turn manually resolved award, Hall of Fame, honour-team or captaincy links back into their legacy automated link state.

### Reproduction
Resolve an untrusted historical honours row through `/admin/player-links`, then run the destructive full `tools/migration/import_awards.py` reload and inspect the reconstructed row.

### Expected
Append-only human identity decisions remain authoritative across repeatable source reloads unless the source fact itself changed and needs review.

### Actual
The importer truncates and recreates the honours tables from legacy source link fields, so later manual decisions are not generally replayed.

### Evidence
`import_awards.py` rebuilds the shared legacy awards/honours targets, while manual link decisions are stored separately in `player_link_resolutions`. The new 22 Under 22 award and winner rows are explicitly excluded from those deletes, but the older loaders do not yet preserve their durable target IDs.

### Root cause
The bulk loader predates the append-only manual-resolution workflow and treats reconstructed source rows as the whole identity state.

### Fix
Not fixed globally. The new `under_22` group preserves its award/winner rows, durable IDs and deliberate `resolved` links on both targeted and destructive full reloads, without changing the older loaders in this scoped feature.

### Validation
Source-contract tests confirm 22 Under 22 is excluded from the legacy awards deletes, preflights preserved names before destructive work and reapplies links only when the source player name is unchanged. No database-backed full-reload reproduction was run locally.

Current review on 2026-08-21 confirmed this remains a genuine import/design gap for legacy honours reloads outside the scoped Under-22 path. No destructive full reload was run during the NL audit.

### Follow-up
Replace destructive honours reloads with source-scoped upserts that preserve target row IDs, or redesign resolution audit targets around durable `(source_id, source_record_id)` keys before migrating existing audit history. Add a database integration test spanning manual resolve → full reload → preserved link and audit target.

## AFLDB-ISSUE-045 — Seasonal honour teams lose their supplied formation order

- **Status:** Resolved
- **Severity:** Low
- **Area:** UI
- **Found:** 2026-08-20
- **Resolved:** 2026-08-20
- **Files:** `src/db/migrations/061_award_winner_sort_order.sql`, `src/db/queries/awards.ts`, `tools/migration/under_22.py`, `tools/migration/import_awards.py`

### Symptom
A 22 Under 22 season page would list positions lexically and pull the captain to the first row instead of showing the supplied B, HB, C, HF, F, R, I/C formation.

### Reproduction
Import a season with only position labels and call `getAwardSeason`; its original order is captain first, then textual position and player name.

### Expected
When a representative-team source supplies an order, the season page preserves it; existing award sources without one keep their current fallback ordering.

### Actual
`award_winners` had no source-order field, so the source's 22 formation slots were discarded.

### Evidence
The annual files encode an ordered seven-line formation, while `getAwardSeason` originally ordered `is_captain DESC, position, playerName`.

### Root cause
The seasonal honour-team model stored position labels but not their display order.

### Fix
Added nullable, bounded `award_winners.sort_order`; the 22 Under 22 importer derives 1–22 from its validated source slots, and the season query uses it before the existing fallback sort. Other awards remain `NULL` and retain their prior behavior.

### Validation
The source checker proves every season covers sort orders 1–22 exactly, a focused test verifies the 2012 formation sequence, importer contracts cover persistence/upsert, and the Awards query contract covers source-first ordering.

### Follow-up
Populate `sort_order` for other seasonal team sources only when their source data supplies a defensible order.

## AFLDB-ISSUE-046 — 22Under22 selections lack a dedicated Grid Solver criterion

- **Status:** Resolved
- **Severity:** Medium
- **Area:** Search
- **Found:** 2026-08-20
- **Resolved:** 2026-08-20
- **Files:** `src/search/grid-solver-spec.ts`, `src/db/queries/grid-solver.ts`, `src/app/admin/player-links/page.tsx`, `tests/grid-solver-under22.test.ts`, `tests/grid-solver-spec.test.ts`, `tests/player-link-mutations.test.ts`, `tests/integration/grid-solver.test.ts`

### Symptom
The Grid Solver cannot directly ask for players selected in the AFLPA 22Under22 team, and the super-admin player-link queue has no one-click view of unresolved rows from that source.

### Reproduction
Open `/grid-solver` and inspect Awards & honours: the only applicable choice is the parameterised “Won an award…” builder. Open `/admin/player-links`: unresolved 22Under22 rows are present under the generic Award winners table but require manually entering the award name in search.

### Expected
Grid Solver offers “Selected in AFLPA 22Under22 team” as a fixed criterion. Any untrusted selections remain linkable through the existing super-admin player-links workflow and are easy to isolate there.

### Actual
There is no dedicated builder or queue shortcut. Treating a representative-team selection as “winning” an award is also misleading wording.

### Evidence
`GRID_BUILDERS` contains All-Australian-specific builders and generic award-winner builders but no fixed `22-under-22` selection builder. The player-link query already includes every unresolved `award_winners` row with award name, season and club context, and its mutation path already accepts `award_winners`.

### Root cause
The source was added after the Grid Solver catalogue and player-link queue navigation were designed.

### Fix
Added a no-parameter `under_22_selection` builder labelled “Selected in AFLPA 22Under22 team”. Its fixed, parameterised-query-safe SQL reads only `award_winners` rows for slug `22-under-22` with a trusted numeric player link (`unique` or `resolved`). Added a **22Under22** preset to the super-admin queue, which applies the existing Award winners table and searchable award-context filters. The normal locked numeric-ID mutation and audit path remains the only way to establish a manual link.

### Validation
Baseline TypeScript passed and the relevant suites passed 32 tests before the change. After the fix, four focused files passed 37 tests, TypeScript passed, and the complete non-integration suite passed 981 tests across 38 files. The production build compiled and completed its lint/type phase, then stopped at database-backed page collection because `DATABASE_URL` is unset. A database integration assertion compares the builder with a hand-written count, but it was not run locally because `AFLDB_TEST_DATABASE_URL` is not configured.

### Follow-up
Run `tests/integration/grid-solver.test.ts` against the development `_test` database after importing the Under22 source, then smoke-test the queue preset and a two-axis Grid Solver cell on dev.

## AFLDB-ISSUE-047 — Numbered-round NL plans silently ignore the round

- **Status:** Resolved
- **Severity:** High
- **Area:** Search
- **Found:** 2026-08-20
- **Resolved:** 2026-08-20
- **Files:** `src/search/nl/parser.ts`, `src/search/nl/plan.ts`, `tests/nl-audit-acceptance.test.ts`, `tests/integration/nl-answers-game-season.test.ts`

### Symptom
Questions such as `most hit out Richmond v Essendon Round 5 1984` confidently rank a scoped total while ignoring Round 5, instead of ranking the players in that exact match.

### Reproduction
Parse the exact question and inspect the plan. Before the fix it had `mode: sum` and a top-level `roundNumber: 5`; every compiler reads `scope.roundNumber`, so the round predicate never reached SQL.

### Expected
The plan is `player_game`, `mode: single`, with both clubs, 1984, `scope.roundNumber = 5`, and `scope.matchType = home_and_away`.

### Actual
The parser selected sum mode and stored the round in a property that validation and compilers ignored.

### Evidence
The pre-fix acceptance probe printed the misplaced top-level field. Source search found no compiler reading `plan.roundNumber`; all three match compilers read only `scope.roundNumber`.

### Root cause
Round extraction was added after the scope object was assembled and spread directly onto the plan. Round scope also was not treated as a one-match grain cue.

### Fix
Round numbers now live in `scope`, default to the numbered home-and-away match type unless another type was explicit, and elect single-game player ranking. Parser version increased from 16 to 17.

### Validation
The 38-question parser acceptance corpus and focused parser/plan suites pass. On the development Linux host, the database-backed regression also passed against `afldb_test`, comparing the compiler result with an independent season/round SQL maximum.

### Follow-up
Run the new integration assertion and the exact question through `/search` on the development Linux environment; verify Mark Lee, 29 hitouts against `afldb_dev`.

## AFLDB-ISSUE-048 — Team quarter and half scores sum cumulative checkpoints

- **Status:** Resolved
- **Severity:** High
- **Area:** Search
- **Found:** 2026-08-20
- **Resolved:** 2026-08-20
- **Files:** `src/db/queries/nl/team-match.ts`, `tests/integration/nl-answers-team-club.test.ts`

### Symptom
`highest H2 score by the Magpies` can display an impossible single-team score such as `357 team score`.

### Reproduction
The compiler's period CTE selects periods 3 and 4 and runs `SUM(points)`, although `match_period_scores.points` is cumulative-to-date.

### Expected
Q1 = Q1 checkpoint; Q2 = half-time minus Q1; Q3 = three-quarter-time minus half-time; Q4 = Q4 minus Q3; H1 = half-time; H2 = final score minus half-time. Missing checkpoints remain NULL.

### Actual
Quarter checkpoints were treated as independent period scores. H2 added the cumulative three-quarter and final scores, explaining the malformed 357 result.

### Evidence
Migration 003 explicitly documents the table as cumulative. The original SQL used `SUM(points)` and `COALESCE(..., 0)`.

### Root cause
The new period compiler assumed a per-period representation without inspecting the schema contract.

### Fix
The compiler now pivots cumulative Q1-Q4 checkpoints and subtracts the required boundaries. H2 uses final minus half-time, and no missing score is converted to zero.

### Validation
Focused TypeScript/unit suites pass. On the development Linux host, the database-backed H2 and Q3 regressions passed against `afldb_test`; both independently calculate the period value and assert `payload.value === clubScore`.

### Follow-up
Run the H2/Q3 integration cases, `EXPLAIN (ANALYZE, BUFFERS)`, and the exact Magpies query through development `/search`.

## AFLDB-ISSUE-049 — Grouped HAVING questions collapse into one arbitrary match

- **Status:** Resolved
- **Severity:** High
- **Area:** Search
- **Found:** 2026-08-20
- **Resolved:** 2026-08-20
- **Files:** `src/search/nl/plan.ts`, `src/search/nl/parser.ts`, `src/search/nl/answer-types.ts`, `src/db/queries/nl/team-match.ts`, `src/search/nl/describe.ts`, `src/components/NlAnswerSection.tsx`, `tests/nl-audit-acceptance.test.ts`, `tests/nl-plan.test.ts`, `tests/nl-describe.test.ts`, `tests/integration/nl-answers-team-club.test.ts`

### Symptom
`teams with more than 3 wins against the Lions` and `teams with at least 10 wins at the SCG` render one high-scoring match, including malformed `Highest .` prose, instead of club rows and qualifying counts.

### Reproduction
Parse either question and execute the original team compiler. Its HAVING CTE retained qualifying club IDs, then the main path used `metricValueExpr(plan.metric || 'team_score')` and ranked matches by an incidental score.

### Expected
Filter qualifying matches, group by club organization, apply the requested strict/inclusive count threshold, and return each organization's qualifying match count.

### Actual
The grouped count was discarded after filtering and the response shape collapsed back to `NlTeamMatchRow`.

### Evidence
The known St Kilda v Brisbane 2005 (186) and Sydney v Essendon 1987 (236) symptoms match the two required grouped questions and the exact fallback path in source.

### Root cause
`havingClause` was modelled as a filter feeding a match-ranker rather than as a distinct organization-grained result payload.

### Fix
Added `team_aggregate` rows and a dedicated compiler/UI/description path. It groups by `club_organizations`, returns the count as `value`, and never invokes a match metric fallback. Added a validated per-match margin filter so `lose 5 times by more than 100 points` filters `loss_margin > 100` before `HAVING count(*) >= 5`.

### Validation
Parser, plan, description, TypeScript and acceptance tests pass. On the development Linux host, the independent database tests for scoped wins and 100-point-loss counts passed against `afldb_test`.

### Follow-up
Run both grouped integration truths and verify the three originating queries in `/search` on development.

## AFLDB-ISSUE-050 — Validation accepts advanced fields that selected compilers ignore

- **Status:** Resolved
- **Severity:** High
- **Area:** Search
- **Found:** 2026-08-20
- **Resolved:** 2026-08-20
- **Files:** `src/search/nl/plan.ts`, `src/search/nl/parser.ts`, `tests/nl-plan.test.ts`, `tests/nl-audit-acceptance.test.ts`

### Symptom
A plan may carry `periodSplit`, `havingClause`, `matchFilter`, `streakDefinition`, or debut scope on a grain that cannot execute it. `most disposals in the fourth quarter in 2023` elected `player_season`, whose compiler ignored the quarter and ranked full-season totals.

### Reproduction
Construct cross-grain plans with those optional fields and call the original `validatePlan`; they were accepted. The player-period compilers also reference migration 062's table, but no importer or populated coverage source exists in this workspace.

### Expected
Validation accepts only combinations fully consumed by the selected compiler. Unavailable player-quarter coverage declines explicitly.

### Actual
Optional fields had little or no grain/shape validation, allowing confident partial answers or runtime empty results.

### Evidence
Source tracing showed `player-season.ts` never reads `periodSplit`; `havingClause` was only read by team-match; and the repository contains no load path for `player_match_period_stats`.

### Root cause
Plan fields were added incrementally without a complete compiler-capability matrix in validation.

### Fix
Validation now closes each field to its executable grain and shape, checks grouped operators/metrics/thresholds, rejects meaningless period metrics, and explicitly declines non-full player period rankings. Parser period cues now elect the correct single-game semantic shape before that honest coverage decline.

### Validation
Focused validation and all 38 acceptance classifications pass; the two player-quarter samples are asserted as explicit correct declines.

### Follow-up
Only remove the decline after an authoritative quarter-player source is imported, coverage is registered, and compiler/database/UI tests prove the populated era.

## AFLDB-ISSUE-051 — NL descriptions use player nouns for team answers and omit streak headlines

- **Status:** Resolved
- **Severity:** Medium
- **Area:** Search
- **Found:** 2026-08-20
- **Resolved:** 2026-08-20
- **Files:** `src/search/nl/plan.ts`, `src/search/nl/describe.ts`, `tests/nl-plan.test.ts`, `tests/nl-describe.test.ts`

### Symptom
Team answers say `Ties: every player sharing the value is included`; grouped answers can show `Highest .`; team streak payloads fall through to the generic `Results` headline.

### Reproduction
Call `describePlan` for a `team_match` plan, or `describeAnswer` with team-streak/grouped payloads.

### Expected
Explanations name the actual entity grain, grouped lists explain count filtering without tie prose, every ranked headline has a metric, and streaks name their club, length and type.

### Actual
One shared sentence hard-coded `player`, the team formatter interpolated a nullable metric, and `team_streak` had no description branch.

### Evidence
Direct source inspection found the hard-coded sentence and the missing switch branch. Unit construction reproduced the blank/group-incompatible formatting without a database.

### Root cause
Description helpers were expanded around player grains first and were not made exhaustive when team/grouped/streak shapes were introduced.

### Fix
Tie nouns are grain-specific, grouped plans have dedicated count prose and no tie line, streaks have a typed formatter, and payload/plan incompatibility now throws instead of rendering a plausible but false sentence.

### Validation
Description and plan tests assert no blank `Highest .`, no team `every player`, correct grouped wording, tied streak headlines, and fail-closed payload compatibility.

### Follow-up
Exercise the same text through the real answer panel on development `/search`.

## AFLDB-ISSUE-052 — Required streak, margin, blowout and debut phrases decline

- **Status:** Resolved
- **Severity:** Medium
- **Area:** Search
- **Found:** 2026-08-20
- **Resolved:** 2026-08-20
- **Files:** `src/search/nl/vocab.ts`, `src/search/nl/parser.ts`, `src/search/nl/plan.ts`, `src/db/queries/nl/player-game.ts`, `tests/nl-audit-acceptance.test.ts`

### Symptom
`richmond's longest winning strea`, `Dons biggest blowout win at Optus Stadium`, `Suns biggest margin at the Gabba`, and `most goals on debut` decline despite having unambiguous deterministic meanings.

### Reproduction
The pre-fix parser classified the first and bare-margin query as unrecognised and the other two as ambiguous, with the remaining meaningful token treated as a failed player name.

### Expected
The typo is accepted only under the explicit `winning` cue; blowout consumes the full phrase; bare superlative margin means winning margin; debut restricts `career_game_no = 1`.

### Actual
Vocabulary consumed only part or none of each phrase, leaving unsupported tokens.

### Evidence
The parser acceptance probe recorded the exact decline classifications and leftovers (`winning strea`, `win`, `margin`, `debut`).

### Root cause
Exact deterministic vocabulary lacked these narrow variants and there was no first-career-game field for a player-match ranking.

### Fix
Added narrow phrase rules, explicit debut scope and its compiler predicate. Parser versions 20-21 record the vocabulary and debut changes separately. Negative coverage proves `winning street` is not fuzzily accepted and debut-season wording does not become debut-game scope.

### Validation
All required samples and neighbouring parser variants pass; TypeScript passes. On the development Linux host, the database truth test for debut goals passed against `afldb_test`.

### Follow-up
Verify the debut leader and venue-scoped margin answers directly in `afldb_dev` and through `/search`.

## AFLDB-ISSUE-053 — Team streaks split one organization at historical renames

- **Status:** Resolved
- **Severity:** Medium
- **Area:** Search
- **Found:** 2026-08-20
- **Resolved:** 2026-08-20
- **Files:** `src/db/queries/nl/team-streak.ts`, `src/search/nl/describe.ts`, `tests/integration/nl-answers-team-club.test.ts`

### Symptom
A lineage query such as `Swans longest losing streak at the SCG` partitions streak islands by historical `club_id`, even though entity resolution scopes Sydney/South Melbourne by organization.

### Reproduction
Inspect the original streak SQL: scope accepts every club identity under the organization, but both window partitions and grouping use `club_id`.

### Expected
Organization-level names and nicknames continue chronology across renames while separate merger organizations remain separate.

### Actual
The filter widened to the lineage and then the streak computation split it back into historical identities.

### Evidence
The mismatch is visible directly between `scopeClauses` and the `PARTITION BY f.club_id` / `GROUP BY club_id` clauses.

### Root cause
The streak compiler reused match-side identity IDs as the output identity instead of joining the already-modelled organization.

### Fix
Streak windows, groups and output now use `club_organizations`; match ordering also adds match ID as a deterministic same-date tiebreaker.

### Validation
TypeScript and description tests pass. On the development Linux host, the database-backed test independently computed a selected organization's chronological win streak in TypeScript and matched the compiler result against `afldb_test`.

### Follow-up
Run the lineage test and all six required streak queries through development `/search`.

## AFLDB-ISSUE-054 — Under-22 importer contract tests cannot find their source boundaries

- **Status:** Open
- **Severity:** Medium
- **Area:** Tests
- **Found:** 2026-08-20
- **Resolved:** N/A
- **Files:** `tests/under-22-importer.test.ts`, `tools/migration/import_awards.py`

### Symptom
Four Under-22 importer contract tests fail before making their intended assertions because the helper cannot find the configured end marker in `import_awards.py`.

### Reproduction
Run `npm.cmd test -- --run`. The failures are `makes every destructive awards reload restore the independent team data`, `uses names only to find candidates...`, `upserts only its own facts...`, and `creates the existing seasonal honour-team shape...`.

### Expected
The test helper isolates the intended importer sections and asserts their contracts.

### Actual
`between()` receives `source.indexOf(end) === -1` in all four cases and fails its boundary assertion.

### Evidence
The full-suite run reported 4 failed and 986 passed assertions before excluding this file; none of the NL-search files modified in this audit are involved.

### Root cause
Not yet confirmed. The source section labels or function boundaries appear to have drifted from the test's literal markers.

### Fix
Not yet fixed; this is outside the NL-search audit scope and may overlap unrelated in-progress importer work.

### Validation
With integration suites and this known failing file excluded, all 983 remaining safe non-integration assertions pass.

Current review on 2026-08-21 reproduced the issue unchanged: `npm.cmd test -- tests\under-22-importer.test.ts` failed 4 of 7 tests, all at `between()` because the expected end marker was not found. This remains a test/tooling defect outside the NL search path.

### Follow-up
Review the importer/test marker contract with the owner of the Under-22 work and update the implementation or test boundaries without weakening the behavioural assertions.

## AFLDB-ISSUE-055 — Exact `A v B` player-match queries filter to the first club

- **Status:** Resolved
- **Severity:** High
- **Area:** Search
- **Found:** 2026-08-20
- **Resolved:** 2026-08-20
- **Files:** `src/search/nl/plan.ts`, `src/search/nl/parser.ts`, `src/db/queries/nl/player-game.ts`, `src/db/queries/nl/team-match.ts`, `tests/nl-audit-acceptance.test.ts`, `tests/integration/nl-answers-game-season.test.ts`

### Symptom
`most hitout Fitzroy v Richmond round 3 1984` answered Glenn Coleman with 20 hitouts, but the match leader is Mark Lee with 33.

### Reproduction
Ask the query above after the previous NL audit deployment.

### Expected
`Fitzroy v Richmond` selects the exact match between both clubs and ranks every player in that match. `most hitouts v Richmond round 3 1984` remains opponent-scoped and ranks only players opposed to Richmond.

### Actual
The clean `A v B` pair was represented as `clubFor=A` and `clubAgainst=B`, so the player-game compiler filtered `player_match_stats.club_id` to Fitzroy and excluded Richmond players.

### Evidence
Read-only `afldb_dev` SQL verified match `9087`, Fitzroy v Richmond, Round 3 1984. The top hitouts rows are Mark Lee, Richmond, 33 and Glenn Coleman, Fitzroy, 20. Applying only the `v Richmond` opponent filter correctly returns Glenn Coleman, 20.

### Root cause
The parser had no separate representation for a clean two-club matchup. It reused subject/opponent role fields that mean “the player's side” and “the player's opponent”.

### Fix
Added `scope.matchup` for clean `A v B` pairs, restricted it to match-level plans, and taught player/team match compilers to use it as a match-participant predicate without filtering the ranked side.

### Validation
`npm.cmd test -- tests/query-intent.test.ts tests/nl-audit-acceptance.test.ts` passed. The broader focused NL unit layer passed: `npm.cmd test -- tests/nl-parser.test.ts tests/nl-plan.test.ts tests/nl-describe.test.ts tests/query-intent.test.ts tests/nl-audit-acceptance.test.ts`. Integration regression coverage was added but could not run locally because `AFLDB_TEST_DATABASE_URL` is not set.

### Follow-up
Run the new integration tests against `afldb_test` on the Linux dev host after these local changes are promoted.

## AFLDB-ISSUE-056 — Checkpoint lead/margin wording is not represented

- **Status:** Resolved
- **Severity:** Medium
- **Area:** Search
- **Found:** 2026-08-20
- **Resolved:** 2026-08-20
- **Files:** `src/search/nl/plan.ts`, `src/search/nl/parser.ts`, `src/search/nl/vocab.ts`, `src/db/queries/nl/team-match.ts`, `tests/nl-audit-acceptance.test.ts`, `tests/integration/nl-answers-team-club.test.ts`

### Symptom
`biggest margin at half time`, `biggest margin at half time but won`, `biggest margin at quarter time but won`, `biggest margin at three quarter time but won`, and `biggest lead at half time` declined or collided with unrelated grouped win parsing.

### Reproduction
Ask the checkpoint phrases above.

### Expected
Checkpoint wording uses cumulative quarter-time, half-time, or three-quarter-time scores. `but won` filters the final result after computing the checkpoint leader.

### Actual
The only existing period representation was period scoring (`Q3` means points scored during Q3), not checkpoint state. `lead` was also not a team metric word.

### Evidence
Read-only `afldb_dev` SQL verified the largest half-time lead and largest half-time lead by a final winner are Brisbane Bears v Sydney, Round 8 1993, 120 points.

### Root cause
The plan model lacked `scoreCheckpoint` and final-result filter fields, so the parser either declined the phrase or tried to read `won` through the grouped-result vocabulary.

### Fix
Added `scoreCheckpoint` (`QT`, `HT`, `3QT`) and `resultFilter: 'won'`, validation, parser extraction including `quatre time`, `lead` as a win-margin synonym, and a checkpoint SQL CTE that keeps checkpoint leader separate from final winner.

### Validation
Focused NL parser/plan/description/query-intent tests passed. TypeScript passed. Integration regression coverage was added for half-time margin and half-time margin-but-won but could not run locally because `AFLDB_TEST_DATABASE_URL` is not set.

### Follow-up
Run the new integration tests and `/search` UI checks on the Linux dev host after deployment.

## AFLDB-ISSUE-057 — Single player-match answers hide the game link

- **Status:** Resolved
- **Severity:** Low
- **Area:** Search
- **Found:** 2026-08-20
- **Resolved:** 2026-08-20
- **Files:** `src/components/NlAnswerSection.tsx`

### Symptom
Player-match answers such as `most hitouts v Richmond round 3 1984` identify a player and value but do not link to the match when there is only one result row.

### Reproduction
Ask a single-result player-match query.

### Expected
The answer links to the match where the performance happened.

### Actual
The match link existed only in `PlayerGameTable`, and that table intentionally returns `null` for one-row answers because the headline already names the answer.

### Evidence
Source inspection showed `PlayerGameTable` links `matchPath(r.matchId)` only when `rows.length > 1`.

### Root cause
The lead/headline path had no companion link for the single-row player-match case.

### Fix
Added a lead match link under the answer interpretation when the payload is a single player-game row with a match ID.

### Validation
TypeScript passed.

### Follow-up
Verify the rendered link through `/search` after deployment.

## AFLDB-ISSUE-058 — Plain `A v B season` search has no match result path

- **Status:** Resolved
- **Severity:** Medium
- **Area:** Search
- **Found:** 2026-08-20
- **Resolved:** 2026-08-20
- **Files:** `src/search/query-intent.ts`, `src/search/constants.ts`, `src/db/queries/search.ts`, `src/app/search/page.tsx`, `tests/query-intent.test.ts`

### Symptom
Plain search text such as `Richmond v Essendon 1984` or `Richmond v Essendon round 5 1984` should show games between those clubs in that season, but global search had no match-result type.

### Reproduction
Search for the phrases above in `/search`.

### Expected
Season-only matchup searches offer the corresponding Match Search filter, and exact-round wording surfaces direct match hits.

### Actual
Global search only returned players, clubs, venues, seasons, rounds, awards, records and AFLW results.

### Evidence
Source inspection of `globalSearch` and `SearchResultType` showed no `match` branch.

### Root cause
The global search intent layer had no DB-free parser for clean matchup text and no server query returning matching `matches` rows.

### Fix
Added `extractMatchupQuery`, a Match Search href builder, a `match` search result type, a server `searchMatches` query, and rendering in the existing “Go to” results section.

### Validation
`tests/query-intent.test.ts` covers both `1984 round 5` and `round 5 1984` orderings plus the negative `Richmond biggest win vs Essendon` collision. Focused tests passed.

### Follow-up
Run `/search` UI checks after deployment.

## AFLDB-ISSUE-059 — Grouped qualifying counts have no drill-down link

- **Status:** Open
- **Severity:** Low
- **Area:** Search
- **Found:** 2026-08-20
- **Resolved:** N/A
- **Files:** `src/components/NlAnswerSection.tsx`, `src/search/match-spec.ts`, `src/db/queries/nl/team-match.ts`

### Symptom
Grouped answers with a `Qualifying matches` count should let a reader click the count and see the matches that make up that count.

### Reproduction
Ask `teams with at least 10 wins at the SCG` or `teams with more than 3 wins against the Lions`, then try to open the qualifying count for one row.

### Expected
The count opens the exact set of qualifying matches for that row.

### Actual
The count is plain text.

### Evidence
`TeamAggregateTable` renders `{formatNumber(r.value)}` without a link.

### Root cause
Current `match-search` URL filters do not yet express the full grouped-result predicate set: team perspective, opponent, venue, season range, win/loss/draw result, and optional per-match margin filter.

### Fix
Not yet fixed.

### Validation
Not yet run.

Current review on 2026-08-21 confirmed this remains an intentionally open product gap: `TeamAggregateTable` still renders `Qualifying matches` as plain numeric text, and existing Match Search filters still do not encode every grouped predicate needed to link a row safely.

### Follow-up
Extend Match Search or add a dedicated NL drill-down route that can faithfully replay a `team_aggregate` row's predicates before linking counts.

## AFLDB-ISSUE-060 - Current-season results depend on a stale manual snapshot

- **Status:** Resolved
- **Severity:** Medium
- **Area:** Import
- **Found:** 2026-08-20
- **Resolved:** 2026-08-20
- **Files:** `src/db/migrations/063_external_current_match_sources.sql`, `src/db/migrations/064_matches_external_provenance.sql`, `src/lib/external-afl/current-matches.ts`, `tools/current-season/update-current-season.ts`, `tests/current-season-import.test.ts`, `.env.example`, `package.json`

### Symptom
The database snapshot is loaded through 9 August 2026, so current-season results can drift behind available external public/current sources until a full legacy refresh or manual upload occurs.

### Reproduction
Read `README.md`: the current data snapshot covers 1897-2026 but is loaded only through 9 August 2026 and the 2026 season is provisional. No dedicated current-season API refresh tool exists in `package.json`.

### Expected
External current-season sources can be fetched safely, snapshotted with provenance, and used to fill current result gaps only when the local match identity is unambiguous.

### Actual
The only available update paths are the manual CSV/admin import flows or full migration refreshes; no Squiggle/Kali source integration exists.

### Evidence
Squiggle documents current fixture/score access and an identifying User-Agent requirement. Kali documents key-authenticated AFL v1 endpoints for matches, standings and player stats from 2000 onward. The repository had no `squiggle`, `kali`, or `current-season:update` command before this change.

### Root cause
External API sources had not yet been modelled in AFLDB's provenance/staging/import architecture.

### Fix
Added `squiggle_api` and `kali_afl_stats` source records, a staging snapshot table, match-row provenance columns, external API clients, and a dry-run-first current-season refresh command. The command writes through `AFLDB_IMPORT_DATABASE_URL`, keeps Kali credentials in `KALI_AFL_API_KEY`, stages raw payloads first, parses Kali human-readable match dates, maps known current-source club names such as `Brisbane` to AFLDB's active club identity, handles Squiggle's 2024+ Opening Round numbering, exposes `--report`, inserts missing completed matches only with `--apply --insert-missing-matches`, and requires `--apply --update-matches` before existing final score updates are attempted.

### Validation
`npm.cmd test -- tests/current-season-import.test.ts` passed 12 focused tests, including Squiggle team-id normalisation, Opening Round resolver coverage, external club-name normalisation, explicit missing-match insertion, match provenance migration coverage, and Kali completion inference. `npm.cmd run typecheck` passed. On the development host, migrations 063 and 064 applied, `npm run typecheck` passed, `npm test -- tests/current-season-import.test.ts` passed 12 tests, Squiggle staging imported 218 rows, and `--insert-missing-matches` inserted 10 completed missing 2026 matches. Kali dry-run fetched 197 rows and inferred all 197 as complete after human-date parsing; Kali staging then wrote 197 rows with 197 resolved and 0 unresolved teams after the Brisbane alias correction. The combined dev report shows `kali_afl_stats: staged 197, resolved 197, complete 197, with scores 197, unresolved teams 0` and `squiggle_api: staged 218, resolved 199, complete 199, with scores 218, unresolved teams 11`. `npm run build` passed on the development host and prepared the standalone bundle.

### Follow-up
Restart the development service with `sudo systemctl restart afldb` so the rebuilt standalone bundle is served. Add `--update-matches` only when deliberately reconciling existing match scores.

## AFLDB-ISSUE-061 - Current-season API refresh requires shell access

- **Status:** Resolved
- **Severity:** Medium
- **Area:** Admin
- **Found:** 2026-08-21
- **Resolved:** 2026-08-21
- **Files:** `src/lib/external-afl/current-season-import.ts`, `tools/current-season/update-current-season.ts`, `src/app/admin/current-season/page.tsx`, `src/app/admin/current-season/actions.ts`, `src/app/admin/current-season/CurrentSeasonControls.tsx`, `src/app/admin/nav-model.ts`, `tests/current-season-import.test.ts`, `CHANGELOG.md`, `issues.md`

### Symptom
A super admin can log into AFLDB, but current-season API refreshes still require SSH access and the `npm run current-season:update` CLI.

### Reproduction
Log in as a super admin and inspect the admin data tools. There is no current-season API refresh page or action; the only working path is the shell command.

### Expected
A logged-in super admin can trigger a server-side current-season refresh from the admin UI. Provider keys stay in server environment variables, external payloads are staged first, and risky match-score overwrites remain opt-in.

### Actual
The importer exists only as a CLI script, so operational access to the host is required.

### Evidence
`src/app/admin/nav-model.ts` had no current-season admin destination, and no admin page or server action called the current-season importer.

### Root cause
The current-season import transaction was implemented inside the CLI wrapper rather than as a reusable server-only module.

### Fix
Extracted the import/report transaction into `src/lib/external-afl/current-season-import.ts`, kept the CLI as a thin wrapper, and added `/admin/current-season` guarded by `requireSuperAdmin()`. The primary admin action automatically uses Kali, applies staging rows, and inserts unambiguously resolved completed matches while leaving existing final-score overwrites off unless a manual option is deliberately selected. The action audits refresh/report events and revalidates public match/season/club/record paths when match facts change.

### Validation
`npm.cmd test -- tests/current-season-import.test.ts` passed 14 focused tests, including the super-admin action/page guardrails. `npm.cmd run typecheck` passed. On the development Linux host, `npm run typecheck` passed, `npm test -- tests/current-season-import.test.ts` passed 14 tests, the refactored `npm run current-season:update -- --year 2026 --report` CLI path passed, and `npm run build` passed with `/admin/current-season` compiled as a dynamic route in the standalone bundle.

### Follow-up
Deploy to the development host and restart the service so the new admin route is served.

## AFLDB-ISSUE-062 - Record/leader NL phrasing drops finals scope

- **Status:** Resolved
- **Severity:** Medium
- **Area:** NL Search
- **Found:** 2026-08-21
- **Resolved:** 2026-08-21
- **Queries:** `Grand Final record for goals`, `please Grand Final record for goals thanks`, `career goal leader against Collingwood`
- **Files:** `src/search/nl/parser.ts`, `src/search/nl/plan.ts`, `src/search/nl/vocab.ts`, `tests/nl-parser.test.ts`

### Symptom
Clear record-style questions declined even though equivalent superlative phrasing, such as `most goals in a Grand Final` or `most goals against Collingwood`, was supported.

### Reproduction
Run the full NL stress corpora and inspect verified-answer declines for `Grand Final record for goals` and `career goal leader against Collingwood` variants.

### Expected
Record/leader wording should parse to the same deterministic player-game or scoped career plans as equivalent `most` phrasing, while `most finals played` remains a career-finals total.

### Actual
Bare `Grand Final` was not consumed as match scope without an `in a`-style governor, and `leader` was not an aggregation word.

### Evidence
V1 reported soft failures for `Grand Final record for goals` and `career goal leader against Collingwood`; V2 reported 344 `grand final` record declines and 395 `leader` declines in verified-answer rows.

### First wrong layer
Slot extraction

### Root cause
The match-type gate protected career-finals questions by requiring a governing preposition for bare finals words, but had no narrow exception for record/leader phrasings that also name a player metric. Separately, aggregation vocabulary covered `leading` and `led` but not the noun `leader`.

### Fix
Added `leader`/`leaders` to aggregation vocabulary, allowed bare finals match-type words only when a record/leader cue and a player metric are both present, and bumped `PARSER_VERSION` to 23.

### Validation
`npm.cmd test -- tests/nl-parser.test.ts tests/nl-audit-acceptance.test.ts tests/nl-plan.test.ts tests/nl-describe.test.ts` passed with 211 assertions, including positive coverage for Grand Final record/leader phrasing and negative coverage that `most finals played` remains a career metric. Independent `afldb_dev` truth verified Richmond v Essendon Round 5 1984 hitouts as Mark Lee, 29. Full V2 rerun at `/tmp/afldb-nl-full-v2-v23-20260821/report.md` scored 20,000/20,000 verified football answers correct, 6,788/6,788 metamorphic groups consistent, and cleared all 739 v22 hard verified-answer declines without any clean-to-hard regression.

### Follow-up
After development service restart, verify parser version 23 is live through `/search` and replay the record/leader browser questions.

## AFLDB-ISSUE-063 - Valid no-result NL plans render no explanation

- **Status:** Resolved
- **Severity:** Low
- **Area:** UI
- **Found:** 2026-08-21
- **Resolved:** 2026-08-21
- **Queries:** `Dustin Martin most handballs against Richmond`, `Dustin Martin total handballs against Richmond`, `Dustin Martin highest handballs game against Richmond`
- **Files:** `src/db/queries/nl/answer.ts`, `tests/integration/nl-answer-boundary.test.ts`

### Symptom
The rendered `/search` experience showed no NL answer panel for valid questions whose parsed plan matched zero rows.

### Reproduction
Run the 60-query NL UI smoke. Rows `ui_00055`-`ui_00057` expected an NL plan for Dustin Martin handball questions against Richmond, but the page rendered no NL panel.

### Expected
A valid parsed question with no matching rows should explain that no matching performance was found rather than disappearing into ordinary global search.

### Actual
`answerNlQuestion` logged `no_results` and returned `null`, so the UI had no NL panel.

### Evidence
A direct parser/execute diagnostic on `afldb_dev` showed all three Dustin Martin-v-Richmond queries parsed as `player_game` handball plans with `clubAgainst: Richmond`, validated successfully, and returned `player_game` payloads with `total: 0`. A neighbouring control, `Dustin Martin most handballs against Carlton`, returned one result.

### First wrong layer
UI/runtime

### Root cause
The answer layer treated recognised-but-empty NL plans the same as unrecognised low-confidence questions, even though `describeAnswer` already has grain-specific empty-result text.

### Fix
`answerNlQuestion` now still logs `no_results` but returns the normal described answer for zero-row payloads. A focused integration regression covers the boundary between a supported zero-row plan, a neighbouring supported non-empty answer, an unsupported metric decline, and a historical coverage-unavailable answer.

### Validation
`npm.cmd test -- tests/nl-describe.test.ts tests/nl-parser.test.ts tests/nl-audit-acceptance.test.ts tests/nl-plan.test.ts` passed with 211 assertions. `npm.cmd run typecheck` passed. Remote guard confirmed `test_database=afldb_test`, then `PATH=/home/arm/.nvm/versions/node/v22.23.2/bin:$PATH npm test -- tests/integration/nl-answer-boundary.test.ts tests/integration/nl-answers.test.ts tests/integration/nl-answers-game-season.test.ts tests/integration/nl-answers-team-club.test.ts tests/integration/nl-vocab.test.ts` passed with 67 assertions. The new boundary test proves supported zero rows return an `NlAnswer` and log `no_results`, supported non-empty controls remain answered, unsupported metrics still decline, and coverage-unavailable eras stay explicit coverage answers. Local `npm.cmd test -- tests/integration/nl-answer-boundary.test.ts` is blocked on Windows because `AFLDB_TEST_DATABASE_URL` is intentionally absent there. After the development service was restarted through systemd, `tmp-nl-ui-v23-targeted.csv` passed 10/10 browser rows against `/search`: all three Dustin Martin-v-Richmond cases rendered `No matching performance found`; the Carlton control rendered Dustin Martin's 16-handball answer; the unsupported metric row remained absent; and the 1960 tackles row rendered `AFLDB can't answer this`. A read-only `nl_search_log` check using the auth role showed parser version 23 for every targeted row, with the three Dustin/Richmond rows logged as `no_results|empty_result`, unsupported as `unrecognised|unsupported_term`, and coverage as `unanswerable|coverage_unavailable`.

### Follow-up
Continue expanded and full UI corpus sweeps now that the restarted development service is serving parser version 23.

## AFLDB-ISSUE-064 - Record-holder NL phrasing leaves `holder` unsupported

- **Status:** Resolved
- **Severity:** Low
- **Area:** NL Search
- **Found:** 2026-08-21
- **Resolved:** 2026-08-21
- **Queries:** `record holder for goals against Collingwood`, `Grand Final goal record holder`
- **Files:** `src/search/nl/vocab.ts`, `src/search/nl/parser.ts`, `src/search/nl/plan.ts`, `tests/nl-parser.test.ts`

### Symptom
Expanded browser corpus rows using `record holder` rendered no NL panel even though neighbouring `leader` phrasing was supported.

### Reproduction
Run the expanded UI corpus `tmp-nl-ui-expanded-v23.csv`. The row `record holder for goals against Collingwood` was expected to answer but rendered `absent`.

### Expected
`record holder for goals against Collingwood` should parse like `career goal leader against Collingwood`: a player-game sum-mode max plan scoped to Collingwood as opponent.

### Actual
The parser consumed `record` as the aggregation cue but left `holder` as an unsupported leftover token, causing a safe decline/no panel.

### Evidence
A direct remote parser diagnostic on `afldb_dev` showed `record holder for goals against Collingwood` as `status=none`, `reason=ambiguous`, `unsupported=holder`, while `career goal leader against Collingwood` parsed to `player_game`, `mode=sum`, `metric=goals`, `agg=max`, and answered Tony Lockett/Doug Wade with 97 goals.

### First wrong layer
Slot extraction

### Root cause
Version 23 added `record` and `leader` coverage but did not treat `holder`/`holders` as record-cue vocabulary or as a redundant role noun after `record` was consumed.

### Fix
Added `holder`/`holders` to the max aggregation vocabulary, bare record-cue gate, and consumed redundant role-word set. Bumped `PARSER_VERSION` to 24 and added focused parser coverage.

### Validation
`npm.cmd test -- tests/nl-parser.test.ts tests/nl-audit-acceptance.test.ts tests/nl-plan.test.ts tests/nl-describe.test.ts` passed with 212 assertions. `npm.cmd run typecheck` passed. On the development host, `npm run typecheck` passed, and `npm test -- tests/nl-parser.test.ts tests/nl-audit-acceptance.test.ts tests/nl-plan.test.ts tests/nl-describe.test.ts tests/integration/nl-answer-boundary.test.ts tests/integration/nl-answers.test.ts tests/integration/nl-answers-game-season.test.ts tests/integration/nl-answers-team-club.test.ts tests/integration/nl-vocab.test.ts` passed with 279 assertions. `npm run build` passed and prepared the standalone bundle with parser version 24. After the documented development-service restart, the `nl-audit-v24-proof-20260821` Playwright proof answered 3/3 rows against `/search`: `record holder for goals against Collingwood` rendered `Tony Lockett and Doug Wade - 97 goals (tied)`, `career goal leader against Collingwood` rendered the same control answer, and `Grand Final goal record holder` rendered `Gordon Coventry and Gary Ablett Snr - 9 goals (tied)`. A read-only `nl_search_log` check with the auth role showed `parser_version=24` for all three proof rows.

### Follow-up
Resolved in the live development service. Include the record-holder rows in the remaining expanded and full UI sweeps.

## AFLDB-ISSUE-065 - Live-only player-season metric leaderboards can time out

- **Status:** Resolved
- **Severity:** Medium
- **Area:** Performance
- **Found:** 2026-08-21
- **Resolved:** 2026-08-21
- **Queries:** `most inside 50s in a season`, `most clearances in a season`, `most contested possessions in a season`
- **Files:** `src/db/queries/nl/player-season.ts`

### Symptom
Expanded browser corpus rows for live-only player-season metrics rendered no NL panel instead of a visible answer or explicit timeout/error state.

### Reproduction
Run the expanded UI corpus `tmp-nl-ui-expanded-v23.csv`; live-only season rows such as `most inside 50s in a season` were `absent`. A direct remote diagnostic against `afldb_dev` parsed `most inside 50s in a season` to a valid player-season plan, then the compiler query failed with SQLSTATE `57014` statement timeout.

### Expected
Supported player-season metric leaderboards should answer within the configured statement timeout, or the UI should expose a safe explicit failure rather than disappearing.

### Actual
The parser accepts the plan, but `answerPlayerSeason` computes live-only season values through a correlated SUM over `player_match_stats`; broad all-season leaderboards can exceed the statement timeout and `answerNlQuestion` returns `null`.

### Evidence
The expanded UI run reported eight `advanced_metric` failures for live-only `in a season` rows. The representative remote diagnostic showed `PostgresError: canceling statement due to statement timeout` from `src/db/queries/nl/player-season.ts`.

The corrected v24 expanded Playwright rerun still reports the same eight `advanced_metric` failures with `outcome=absent` and HTTP 200: `most inside 50s in a season`, `most I50s in a season`, `most rebound 50s in a season`, `most R50s in a season`, `most clearances in a season`, `most clangers in a season`, `most contested possessions in a season`, and `most uncontested possessions in a season`.

### First wrong layer
Compiler

### Root cause
The live-only player-season metric expression recomputes per-player/per-season totals via a correlated subquery inside a broad ranked scan. That is too slow for unscoped all-season leaderboards.

### Fix
Rewrote the live-only `player_season` compiler branch so it pre-aggregates `player_match_stats` once by `(player_id, season)` in a `metric_totals` CTE, then joins that compact result to `player_season_stats` for ranking, display fields, club eligibility and season/player scopes. Precomputed season metrics still use the existing `player_season_stats` column path.

### Validation
Reproduced before the fix on `afldb_dev`: all four canonical plans were valid `player_season` plans and all timed out at about 5,003-5,010 ms with SQLSTATE `57014`.

Independent read-only truth queries against `afldb_dev` verified:

- `most inside 50s in a season`: Patrick Dangerfield, 194 inside 50s, 2016, Geelong.
- `most rebound 50s in a season`: Dustin Fletcher, 206 rebound 50s, 2004, Essendon.
- `most clearances in a season`: Brett Ratten, 265 clearances, 1999, Carlton.
- `most contested possessions in a season`: Clayton Oliver, 434 contested possessions, 2021, Melbourne.

`EXPLAIN (BUFFERS)` on the old correlated shape estimated cost around 26,300,533 and repeated the same subplan for filtering and ranking. `EXPLAIN (ANALYZE, BUFFERS)` on the pre-aggregate shape completed in 634.044 ms on `afldb_dev`.

After the fix, direct compiler probes on `afldb_dev` answered the four sample queries in 479 ms, 470 ms, 479 ms and 485 ms respectively with the independently verified leaders above.

Local validation: `npm.cmd run typecheck` passed, and `npm.cmd test -- tests\nl-parser.test.ts tests\nl-plan.test.ts tests\nl-describe.test.ts tests\nl-regression-corpus.test.ts` passed 373 assertions.

Remote guarded `_test` validation: with `AFLDB_TEST_DATABASE_URL` confirmed as `afldb_test`, `npx vitest run tests/integration/nl-answers-game-season.test.ts` passed 15 tests, including the new broad live-only leaderboard regression in 687 ms. Remote `npm run typecheck` passed.

Remote `npm run build` passed and prepared the standalone bundle. After the legitimate development service restart, live `/search` browser verification on build `sGc7mkDlFHLMEWu3wk522` returned HTTP 200, rendered the expected verified headline, and recorded no console/page errors for all four samples:

- `most inside 50s in a season`: `Patrick Dangerfield — 194 inside 50s (2016)`, 1,562 ms.
- `most rebound 50s in a season`: `Dustin Fletcher — 206 rebounds (2004)`, 1,378 ms.
- `most clearances in a season`: `Brett Ratten — 265 clearances (1999)`, 1,385 ms.
- `most contested possessions in a season`: `Clayton Oliver — 434 contested (2021)`, 1,133 ms.

### Follow-up
None for the compiler defect. The broader `/search` hydration failures that still occur under varied parallel UI load are tracked separately under `AFLDB-ISSUE-068`.

## AFLDB-ISSUE-066 - Malformed `most N games` conditions answer instead of declining

- **Status:** Resolved
- **Severity:** Medium
- **Area:** Parser
- **Found:** 2026-08-21
- **Resolved:** 2026-08-21
- **Queries:** `players with most 10 games`, `players with most 200 games`
- **Files:** `src/search/nl/parser.ts`, `src/search/nl/plan.ts`, `tests/nl-regression-corpus.test.ts`

### Symptom
Expanded browser corpus rows intended to exercise `at most` versus bare `most` collisions rendered confident career-condition answers.

### Reproduction
Run the expanded UI corpus `tmp-nl-ui-expanded-v23.csv`. Rows `players with most 1 games`, `players with most 2 games`, `players with most 3 games`, `players with most 4 games`, `players with most 5 games`, `players with most 10 games`, `players with most 20 games`, `players with most 50 games`, `players with most 100 games`, and `players with most 200 games` all rendered answered panels.

### Expected
`at most 10 games` is a supported `lte` career condition. Bare `most 10 games` is malformed and should decline rather than being treated as a threshold or as a superlative ranking.

### Actual
The parser produced answered career-condition results, for example `players with most 10 games` rendered `8,573 players match`.

### Evidence
The expanded browser corpus reported ten `collision` failures with `expected_status=decline` and `outcome=answered`. This is distinct from the already-fixed `at most` guard because there is no `at` token to anchor the comparison phrase.

The corrected v24 expanded Playwright rerun still reports the same ten `collision` failures for `players with most 1 games`, `2`, `3`, `4`, `5`, `10`, `20`, `50`, `100`, and `200` games; each is answered despite `expected_status=decline`.

### First wrong layer
Slot extraction

### Root cause
The parser consumed bare `most` as a valid `max` aggregation before career-condition extraction. The remaining `N <career stat>` span then looked like an ordinary threshold with the default `gte` operator, so malformed `players with most N games` reached execution as though the reader had typed a supported condition.

### Fix
Added a narrow pre-extraction guard for `players with most N <career stat>` so it declines as malformed. Parser version 25 records the outcome change. Positive controls preserve `players with at most N games`, `players with most games`, and `most goals by players with at most 3 clubs`.

### Validation
Local:

- `npm.cmd test -- tests/nl-regression-corpus.test.ts tests/nl-audit-acceptance.test.ts tests/nl-parser.test.ts tests/nl-plan.test.ts` passed: 352 assertions.
- `npm.cmd test -- tests/nl-audit-acceptance.test.ts tests/nl-parser.test.ts tests/nl-plan.test.ts tests/nl-describe.test.ts tests/nl-regression-corpus.test.ts tests/nl-stress-corpus.test.ts tests/nl-stress-v2.test.ts tests/nl-ui-corpus.test.ts tests/nl-expanded-ui-corpus-generator.test.ts` passed: 513 assertions.

Remote development host, staged source:

- `npm test -- tests/nl-regression-corpus.test.ts tests/nl-audit-acceptance.test.ts tests/nl-parser.test.ts tests/nl-plan.test.ts` passed: 352 assertions.
- `npm run typecheck` passed.
- `npm run nl:stress -- --corpus ~/nl-killer-250k.csv --out ~/nl-stress-out-codex-v25-v2 --concurrency 6` completed with parser version 25 and 100% safe declines for adversarial/unanswerable rows; unsafe answers to expected-decline rows: 0.

Rendered `/search` verification for parser version 25 is blocked because the development build completed but `sudo -n systemctl restart afldb` failed with `sudo: a password is required`; the public dev service on `:8090` was therefore not restarted onto the staged v25 build during this audit.

### Follow-up
Restart the development `afldb` service and rerun the expanded UI corpus so the ten `players with most N games` browser rows can be verified against the rendered parser-v25 deployment.

## AFLDB-ISSUE-067 - Expanded UI corpus generator double-pluralizes metric labels

- **Status:** Resolved
- **Severity:** Low
- **Area:** Test Tooling
- **Found:** 2026-08-21
- **Resolved:** 2026-08-21
- **Queries:** `most goalss by a Carlton player against Geelong`, `most markss in 1999`, `most handballss in 2003`
- **Files:** `tmp-generate-expanded-ui-corpus.mjs`, `tests/nl-expanded-ui-corpus-generator.test.ts`, `tmp-nl-ui-expanded-v23.csv`

### Symptom
The expanded UI corpus contained malformed audit rows with doubled plural metric words such as `goalss`, `markss`, and `handballss`.

### Reproduction
Run `node tmp-generate-expanded-ui-corpus.mjs` before the fix and inspect generated questions matching `goalss|markss|handballss`.

### Expected
Generated audit questions should preserve existing plural metric labels, so `goals`, `marks`, and `handballs` remain valid words. Malformed generator rows must be classified separately from NL semantic correctness.

### Actual
The generator appended `s` to metric labels that were already plural. The first expanded browser run therefore included invalid rows that looked like NL/parser failures but were really generated-corpus defects.

### Evidence
Hydration-capture metadata from the first expanded run included `most goalss by a Carlton player against Geelong`, `most markss in 1999`, and `most handballss in 2003`.

### First wrong layer
Audit tooling

### Root cause
The temporary expanded-corpus generator interpolated `${metric}s` for metric labels without checking whether the sampled metric was already plural.

### Fix
Added `pluralMetric`, exported the generator for regression coverage, replaced the affected interpolations, and regenerated the 501-row expanded UI corpus.

### Validation
`npm.cmd test -- tests/nl-expanded-ui-corpus-generator.test.ts` passed. `node tmp-generate-expanded-ui-corpus.mjs` regenerated 501 rows and a scan for `goalss|markss|kickss|handballss|disposalss` returned zero matches.

### Follow-up
Keep this issue out of NL semantic defect counts. The regenerated expanded corpus is the input for the v24 browser rerun.

## AFLDB-ISSUE-068 - Intermittent React hydration errors during NL UI sweeps

- **Status:** Open
- **Severity:** Medium
- **Area:** UI/Hydration
- **Found:** 2026-08-21
- **Resolved:** N/A
- **Queries:** `Grand Final handballs leader`, `lowest H2 score by West Coast`, `Patrick Dangerfield total goals against Essendon`, `Gary Ablett Snr total goals against Richmond`, `players with at most 5 games`, `most goalss by a Carlton player against Geelong`, `most markss in 1999`, `most handballss in 2003`
- **Files:** `tests/nl-ui/nl-stress.spec.ts`, `artifacts/hydration/exp_0022`, `artifacts/hydration/exp_0112`, `artifacts/hydration/exp_0183`, `artifacts/hydration/exp_0193`, `artifacts/hydration/exp_0255`, `artifacts/hydration/exp_0459`, `artifacts/hydration/exp_0481`, `artifacts/hydration/exp_0485`

### Symptom
The expanded Playwright corpus captured eight client-side React hydration errors on `/search` loads. Search outcomes were often semantically correct, but the browser still emitted `pageerror: Minified React error #418`.

### Reproduction
The first expanded UI sweep captured incidents under `artifacts/hydration/exp_*`. Each incident includes the exact query, failing server HTML, post-hydration DOM, screenshot, console log, and a same-question clean control.

### Expected
`/search` should hydrate without client-side React errors regardless of the NL query outcome.

### Actual
The initial expanded run intermittently emitted React #418 hydration errors. A serial v24 replay of all eight exact rows passed 8/8 with `clientErrors=0` and `hydration.totalHydrationErrors=0`, so the failure is not a deterministic per-query semantic defect.

### Evidence
Original captures:

- `artifacts/hydration/exp_0022`: `Grand Final handballs leader`, answered, React #418, clean control succeeded.
- `artifacts/hydration/exp_0112`: `lowest H2 score by West Coast`, answered, React #418, clean control succeeded.
- `artifacts/hydration/exp_0183`: `Patrick Dangerfield total goals against Essendon`, answered, React #418, clean control succeeded.
- `artifacts/hydration/exp_0193`: `Gary Ablett Snr total goals against Richmond`, answered, React #418, clean control succeeded.
- `artifacts/hydration/exp_0255`: `players with at most 5 games`, answered, React #418, clean control succeeded.
- `artifacts/hydration/exp_0459`: `most goalss by a Carlton player against Geelong`, absent, React #418, clean control succeeded.
- `artifacts/hydration/exp_0481`: `most markss in 1999`, absent, React #418, clean control succeeded.
- `artifacts/hydration/exp_0485`: `most handballss in 2003`, absent, React #418, clean control succeeded.

The v24 serial replay report is archived at `artifacts/nl-ui/nl-audit-v24-hydration-replay-serial-20260821/summary.json`.

The corrected v24 expanded 501-row rerun reproduced the issue under parallel browser load: `clientErrors=20`, `hydration.totalHydrationErrors=20`, HTTP failures 0, page errors 0, and report archived at `artifacts/nl-ui/nl-audit-v24-expanded-501-rerun-20260821/summary.json`.

The live v24 12,000-question UI corpus also reproduced it: `clientErrors=235`, `hydration.totalHydrationErrors=235`, HTTP failures 0, page errors 0, and report archived at `artifacts/nl-ui/nl-audit-v24-ui-12000-20260821/summary.json`.

The parser-v25 audit reran the 501-row expanded browser corpus before the dev restart was blocked. It reproduced the same runtime class with `clientErrors=12`, `hydration.totalHydrationErrors=9`, HTTP failures 0, page errors 0, and report at `nl-ui-out/summary.json`. Captured React #418 examples included `Grand Final marks leader`, `finals record for disposals`, `fewest points scored at Adelaide Oval`, `Scott Pendlebury most handballs against Carlton`, `Patrick Dangerfield total goals against Richmond`, `Patrick Dangerfield total goals against Essendon`, `players with at most 1 games`, `players with most 2 games`, and `Ablett most games`. Three additional client errors were RSC payload fallback messages rather than hydration errors.

### First wrong layer
UI/runtime

### Root cause
Not yet confirmed. Earlier parser-v25 captures pointed to eager App Router RSC prefetch from the persistent site navigation as a contributor: each React #418 capture had identical failing and clean server HTML for the same query, a clean same-question control, and a burst of successful `?_rsc=` fetches for visible nav links within the first few dozen milliseconds of the document load. Post-fix evidence below shows that disabling the persistent nav prefetch reduced but did not eliminate the defect, and the remaining dominant cluster can fire before any observed `_rsc` request starts. This keeps the first wrong layer in UI/runtime, not the NL parser or answer SQL, but no final root cause is proven.

### Fix
Disabled automatic Next.js prefetch on `PrimaryNav` and `TabBar` links in `src/components/SiteNav.tsx`. The links still navigate normally when clicked, but `/search` hydration no longer starts by prefetching the full visible nav route set across cluster workers.

### Validation
`npm.cmd run typecheck` passed locally. Full runtime validation is still required against a restarted deployed/dev standalone service containing the `SiteNav` change: rerun the varied 501-row expanded browser corpus first, then the 12,000-row UI corpus. The earlier serial replay only proves the exact rows are not deterministic query-level reproducers.

Current verification attempt on 2026-08-21 found the live dev checkout still lacked `prefetch={false}` in `src/components/SiteNav.tsx`, so the running service could not validate the fix. The existing local `SiteNav` change was staged and diffed on the dev host; the diff was exactly the two intended `prefetch={false}` props. `npm run build` completed and prepared the standalone bundle. After the later ISSUE-065 compiler change, `npm run build` completed again with both fixes included. The legitimate restart remains blocked: `sudo -n systemctl restart afldb` fails with `sudo: a password is required`. No varied 501-row or full 12,000-row post-fix browser corpus was run because the intended build is not live.

Post-restart validation on 2026-08-21 proved the intended build is live: `/search` responses carry `x-afldb-build: sGc7mkDlFHLMEWu3wk522`, matching `.next/standalone/.next/BUILD_ID`; source has both `SiteNav` `prefetch={false}` props; `PARSER_VERSION = 25`; and the live ISSUE-065 browser probes used that same build.

The comparable varied expanded corpus was rerun locally against the restarted dev service with the same 501 questions, JavaScript enabled, saved beta auth state, normal `/search` navigation, `NL_UI_TIMEOUT_MS=20000`, and four Playwright workers. Batch size was changed from 100 to 25 only so Playwright would actually schedule four workers; earlier local attempts with six 100-row batches reported only three workers and were discarded. Remote Linux Playwright could not be used because Chromium failed to launch with missing `libasound.so.2`.

Expanded post-fix result archived at `artifacts/nl-ui/nl-audit-v25-postfix-expanded-501-20260821/summary.json`:

- Observed: 501 / 501.
- Semantic pass/fail/unscored: 501 / 0 / 0.
- Outcomes: answered 472, unanswerable 16, absent 13, HTTP errors 0, page errors 0.
- Client-side errors: 8.
- Hydration errors: 8 (1.60%).
- Worker rates: worker 1 = 3/76, worker 2 = 0/143, worker 3 = 2/211, worker 4 = 3/71.
- Worker agreement: same-worker 0/4, different-worker 8/497.

All eight client errors were still React #418 hydration failures with successful same-query clean controls: `exp_0173`, `exp_0175`, `exp_0221`, `exp_0242`, `exp_0253`, `exp_0335`, `exp_0341`, and `exp_0422`. No HTTP failures, page failures, timeouts, semantic failures, or RSC payload fallback errors were recorded. The persistent nav prefetch burst is gone, so `SiteNav` prefetch was a contributor, not the complete root cause. Remaining failures still correlate with early RSC fetches for home/about and/or viewport-visible answer/result links, often served by workers different from the document worker.

The NL UI stress harness was then instrumented to record exact current/previous queries, DOM-derived current/previous answer shapes, structured client-event timestamps, every `_rsc` request start/finish/response order, path, request kind, traced worker/PID/request/build headers, response build identifiers, and same-query clean-control RSC/shape evidence. The instrumented 501-row run used the same first 501 UI corpus rows, JavaScript enabled, saved beta auth state, normal `/search` navigation, `NL_UI_BATCH=25`, and four Playwright workers against live build `sGc7mkDlFHLMEWu3wk522`.

Instrumented result in `nl-ui-out/summary.json`:

- Observed: 501 / 501.
- Semantic pass/fail/unscored: 501 / 0 / 0.
- Outcomes: answered 501, unanswerable 0, absent 0, HTTP errors 0, page errors 0.
- Client-side errors: 7.
- Hydration errors: 7 (1.40%).
- Worker rates: worker 1 = 2/151, worker 2 = 1/122, worker 3 = 4/167, worker 4 = 0/61.
- Worker agreement: same-worker 0/2, different-worker 7/499.
- RSC clusters before the hydration-error timestamp: home/about RSC 1/176, answer/result-link RSC 0/148, cross-worker RSC 1/46, same-worker RSC 0/2, and no RSC before cutoff 6/319.

The seven React #418 examples were `ui_00039`, `ui_00146`, `ui_00228`, `ui_00265`, `ui_00454`, `ui_00473`, and `ui_00495`; every same-query clean control succeeded. Six failures recorded no `_rsc` request before the hydration error timestamp, and the only pre-error RSC case was `/about?_rsc=unnn1` on a worker different from the document worker. Several failures did start home/about or answer/result RSC prefetches later in the same load, but after the captured React #418 timestamp. This weakens the remaining prefetch hypothesis and does not justify disabling footer/about, brand/home, or answer/result Link prefetch yet.

Nearby clean controls from the same run support the same classification. `ui_00145`, `ui_00453`, and `ui_00496` were adjacent clean rows with home/about plus answer/result RSC prefetches before the observation cutoff and no client error. `ui_00455` was an adjacent clean row with home/about RSC prefetch only and no client error. The adjacent failure `ui_00473` had pre-error `/about?_rsc=unnn1`, but the broader local neighborhood shows that this link class is not sufficient by itself to trigger React #418 under the same worker/concurrency conditions.

Link inspection after the instrumented run:

- `src/components/SiteNav.tsx`: persistent primary and tab navigation already uses `prefetch={false}`.
- `src/app/layout.tsx`: brand Home and footer About links still use default Next.js prefetch.
- `src/components/NlAnswerSection.tsx`: lead match, player, club, season, record/achievement and table links still use default Next.js prefetch.

Additional capture note: in five of the seven failing DOM snapshots, React recovery regenerated the `SearchBox` `useId()`-derived input/list ids from the server form id `_R_15fiutb_...` to client-only `_r_0_...`; matching clean controls retained the server ids. Two failing snapshots retained the server id, so this is a recovery symptom and possible component-boundary clue rather than a proven sole cause.

Follow-up instrumentation added a document-start Playwright probe using `page.addInitScript`, plus a 125-row fast transition corpus at `artifacts/nl-ui/issue-068-fast-transition-corpus.csv`. A broader 180-row reduced corpus at `artifacts/nl-ui/issue-068-reduced-transition-corpus.csv` was abandoned as a quick diagnostic after roughly eight minutes because several broad/edge batches did not complete promptly; the fast corpus uses known failures, adjacent controls, and spacer rows from the fast first-501 region. It is not a full acceptance corpus.

The fast corpus reproduced React #418 under the preserving workload shape:

- Corpus: `artifacts/nl-ui/issue-068-fast-transition-corpus.csv`.
- Rows: 125.
- Playwright workers: 4, with `NL_UI_BATCH=12` so all four workers were active.
- Result: 125 observed, semantic pass/fail/unscored 125 / 0 / 0, HTTP errors 0, page errors 0, timeouts 0.
- Hydration/client errors: 7 React #418.
- RSC before hydration-error cutoff: home/about 2/60, answer/result-link 3/52, cross-worker RSC 2/10, same-worker RSC 1/2, no RSC before cutoff 4/63.
- Report: `nl-ui-out/summary.json`.

Representative document-start probe evidence from the 125-row run:

- `ui_00042`, `ui_00266`, `ui_00267`, `ui_00287`, `ui_00011`, `ui_00012`, and `ui_00013` all had zero recorded DOM mutations between the document-start probe and React #418. No `data-theme` mutation was recorded, and the test browser had no stored theme value.
- Hydration-error snapshots consistently showed React recovery had replaced the server-hydrated `SearchBox` id family (`_R_15fiutb_...`) with client-rendered ids (`_r_0_...`) and reduced the feedback form to the client-rendered shape with only `clientRef`; clean same-query controls retained the server id family and the Server Action hidden fields (`$ACTION_REF_1`, `$ACTION_1:0`, `$ACTION_1:1`, `$ACTION_KEY`, `clientRef`).
- Server HTML comparison for `ui_00039` and `ui_00146` showed identical Server Action metadata between failing and clean same-query responses: action id `603332301bd4c4781a4f31f78f6ad5b9ba71e32a1f` and `$ACTION_KEY` `k0e63af938132d65b5064ded1df47fc02`. Only `clientRef` differs, as expected for per-search feedback correlation.

Current hypothesis log:

- H1 pre-paint DOM mutation. Prediction: the theme/health inline scripts or another pre-hydration script mutates React-owned markup before hydration. Test: document-start probe records html/body/search/form mutations plus `data-theme` and SearchBox/form snapshots. Evidence: 7/7 fast-corpus failures recorded zero mutations and no `data-theme`; the only pre-paint script with a DOM write, `THEME_INIT_SCRIPT`, had no stored value to apply in the test browser. Result: weakened for current captures, not globally ruled out for browsers with a stored theme.
- H2 useId/component-tree ordering. Prediction: server/client tree order differs before `SearchBox`, causing `useId` ids to diverge. Evidence: failing recovered DOM has `_r_0_...`, clean DOM has `_R_15fiutb_...`; however the hydration-error snapshot is already after React recovery, and no pre-error DOM mutation or conditional tree change before `SearchBox` is proven. Result: supported as a recovery symptom and next inspection target, not yet proven as the first wrong boundary.
- H3 Server Action form/action metadata. Prediction: standalone workers emit different Server Action ids/keys for the same feedback form, causing hydration to fail. Evidence: failing and clean server HTML for same-query captures have identical action id and action key; clean controls retain the hidden fields after hydration, while failing pages lose them only after React client recovery. Result: weakened as a root cause.
- H4 answer-shape conditional tree. Prediction: failures cluster on a previous/current answer-shape transition. Evidence: fast-corpus failures mostly cluster on `answered -> answered`, with one `Every matching performance11 total -> answered`; the latest 501 also had mostly `answered -> answered`. Result: weakened as a specific answer-shape transition, but still compatible with general repeated `/search` client-tree hydration under load.
- H5 cross-worker build/action identity mismatch. Prediction: failures require different build/action identity across workers. Evidence: all captured responses report build `sGc7mkDlFHLMEWu3wk522`; Server Action metadata matches between failing and clean server HTML; four fast-corpus failures occur with no pre-error RSC. Result: weakened for build/action identity mismatch.

Further 125-row instrumentation on 2026-08-21 added stable structural fingerprints for the `/search` subtree, `SearchBox`, and `NlAnswerFeedback`, plus a drained `MutationObserver.takeRecords()` path so the probe records the first queued DOM mutation even when React recovery and the page error happen in the same turn. `npm.cmd run typecheck` passed after the harness changes.

The exact fast corpus was then repeated without changing row order, worker count, batch size, browser project, or deployment:

- Corpus: `artifacts/nl-ui/issue-068-fast-transition-corpus.csv`.
- Workers: 4.
- Batch: `NL_UI_BATCH=12`.
- First post-fingerprint run before the observer drain: 125 observed, semantic pass/fail/unscored 125 / 0 / 0, HTTP errors 0, page errors 0, timeouts 0, hydration/client errors 1 React #418. The failure was `ui_00001`, with answer/result RSC requests already started before the error; `firstMutation` was still unavailable because pending mutation records were not being drained.
- Repeat after the observer drain: 125 observed, semantic pass/fail/unscored 125 / 0 / 0, HTTP errors 0, page errors 0, timeouts 0, hydration/client errors 0.
- Second repeat after the observer drain: 125 observed, semantic pass/fail/unscored 125 / 0 / 0, HTTP errors 0, page errors 0, timeouts 0, hydration/client errors 1 React #418.

Representative latest failure from the second drained-observer repeat:

- Row: `ui_00229`.
- Query: `Lance Franklin most handballs against Richmond`.
- Previous query: `Lance Franklin highest handballs game against Adelaide`.
- Current shape: answered headline `Lance Franklin — 7 handballs`, no table rows, one match link (`/matches/13782`).
- Previous shape: answered headline `Lance Franklin — 11 handballs`, no table rows, one match link (`/matches/13668`).
- Timing: DOMContentLoaded at ~11 ms, first visible result at ~194 ms, React #418 at ~206 ms, first `_rsc` request at ~210 ms, load at ~47 ms.
- RSC before hydration-error cutoff: 0; no home/about RSC, no answer/result-link RSC, no cross-worker RSC before the error.
- Probe mutations: 0; first observed mutation: none.
- Server DOM at DOMContentLoaded: `SearchBox` ids used the server `useId` family (`_R_15fiutb_...`), and the feedback form contained `$ACTION_REF_1`, `$ACTION_1:0`, `$ACTION_1:1`, `$ACTION_KEY`, and `clientRef`.
- Hydration-error/final DOM: React recovery had regenerated the `SearchBox` ids to the client-only `_r_0_...` family and reduced the feedback form to the client-rendered shape with only `clientRef`; no pre-error DOM mutation was captured before that recovery state.

This latest failure makes the remaining answer/result/home/about prefetch hypothesis weaker again: React #418 occurred before any observed RSC/navigation activity. It also strengthens the conclusion that the `_r_...` ids and missing Server Action hidden fields are recovery symptoms rather than proven causes. The first externally observable wrong event in this capture is still the React #418 page error itself.

`SearchBox` first-render inspection: the component is a Client Component with one unconditional `useId()` before rendering, followed by stable `useState(initialQuery)`, suggestion/open/active/focus state, and placeholder state. The first-render input is controlled by `query` from `initialQuery`, while autocomplete, click-outside handling, and placeholder animation are effect-driven after hydration. No conditional hook path or browser-only first-render branch was found in `SearchBox`.

`NlAnswerFeedback` first-render inspection: the component is a Client Component with unconditional `useActionState(submitNlFeedback, INITIAL)`, `choice = none`, and `dismissed = false`. The initial client render should be the form, not the thanks/error/dismissed branches. The server action id and `$ACTION_KEY` were already shown stable in failing and clean same-query server HTML, and the current latest failure again shows action hidden fields disappearing only after React recovery.

125-row presence classification from the latest drained-observer run: `SearchBox` was present in 125/125 rows and `NlAnswerFeedback` was present in 125/125 rows, so this corpus cannot discriminate feedback-present from feedback-absent loads. The one failure was in an answered, one-link, zero-table-row result. Rows with zero result links were 0/44, one link 1/54, two to three links 0/13, and four or more links 0/14. The link-count evidence is too sparse to justify a link prefetch change.

Development React diagnostic status: a separate `next dev` sidecar was started on the dev host at `http://10.0.40.100:3101` using the same remote source checkout and private `.env`, without replacing or restarting the existing standalone service on port 8090. The sidecar health endpoint returned `status=ok` and `database=ok`. The same 125-row fast corpus was run against it three times with `NL_UI_BATCH=12`, four Playwright workers, JavaScript enabled, and the same saved beta/session state. All three development-mode runs were clean:

- Run 1: 125 observed, semantic pass/fail/unscored 125 / 0 / 0, client-side errors 0.
- Run 2: 125 observed, semantic pass/fail/unscored 125 / 0 / 0, client-side errors 0.
- Run 3: 125 observed, semantic pass/fail/unscored 125 / 0 / 0, client-side errors 0.

No unminified React hydration diagnostic was captured because the dev-mode runtime did not reproduce React #418 in 375 comparable diagnostic loads. This weakens the usefulness of `next dev` as a reproducer but does not clear the issue: the production-style standalone 125-row corpus still reproduced 1/125 on the latest comparable repeat.

The dev-mode sidecar was stopped after the diagnostic run. Running `next dev` in the same remote checkout disturbed the shared `.next` artifacts used by the standalone service's static file path: a subsequent production-style feedback-cohort attempt saw `_next/static` CSS/JS chunk requests return `400 text/html`, causing broad MIME-type console errors across both cohorts. That cohort was stopped and is invalid for hydration or feedback-form conclusions. A remote `npm run build` completed successfully and `prepare-standalone` recopied `.next/static`; direct chunk checks then returned `200 application/javascript` again. However, the running standalone service still reports the old live build header `sGc7mkDlFHLMEWu3wk522`, while the rebuilt standalone artifact has a new build id. Do not run further authoritative browser diagnostics until the development service has been legitimately restarted and the intended build/static pair is live.

Feedback-presence discriminator status: a generated artifact `artifacts/nl-ui/issue-068-feedback-discriminator-corpus.csv` contains 60 real NL-answer rows expected to render `SearchBox + NlAnswerFeedback` and 60 ordinary `/search` keyword rows expected to render `SearchBox` without the NL feedback form, all marked `expected_status=unknown`. The first attempted run was invalidated by the static-asset/build-artifact disturbance above, so no feedback-present versus feedback-absent hydration rate is recorded yet.

After the development standalone runtime was legitimately restarted, the build/static pair was confirmed consistent by the operator: built `BUILD_ID` and running `x-afldb-build` both reported `PXHGYcAVxXxgGrfPSViE-`.

The exact production-style 125-row fast transition corpus was rerun unchanged against that build:

- Corpus: `artifacts/nl-ui/issue-068-fast-transition-corpus.csv`.
- Rows: 125 attempted, 125 observed.
- Workers: 4 active Playwright workers.
- Batch: `NL_UI_BATCH=12`.
- Semantic pass/fail/unscored: 125 / 0 / 0.
- Outcomes: answered 125, unanswerable 0, absent 0, HTTP errors 0, page errors 0.
- Hydration/client errors: 3 React #418.
- Timeouts: 0.
- Report: `nl-ui-out/summary.json`.

Failing rows:

- `ui_00010`: previous `Dustin Martin highest goals game against Brisbane Lions` (`Every matching performance2 total`) -> current `Dustin Martin most goals against Western Bulldogs` (single answered match link). React #418 at ~265 ms; no `_rsc` request before the error; 0 probe mutations; first mutation null.
- `ui_00225`: previous `Dustin Martin total clangers against Carlton` (single answered total, no links) -> current `Lance Franklin highest handballs game against Port Adelaide` (single answered match link). React #418 at ~268 ms; first `_rsc` at ~272 ms; 0 probe mutations; first mutation null.
- `ui_00472`: previous `Tony Lockett highest clangers game against Melbourne` (`Every matching performance2 total`) -> current `Tony Lockett most clangers against Brisbane Lions` (`Every matching performance4 total`). React #418 at ~355 ms; first `_rsc` at ~359 ms; 0 probe mutations; first mutation null.

All three failures reported build `PXHGYcAVxXxgGrfPSViE-`. In every failure the DOMContentLoaded snapshot still had the server `SearchBox` id family (`_R_15fiutb_...`) and Server Action hidden fields (`$ACTION_REF_1`, `$ACTION_1:0`, `$ACTION_1:1`, `$ACTION_KEY`, `clientRef`). The hydration-error/final snapshots showed the recovered client shape (`_r_0_...` ids and feedback form reduced to `clientRef`), again with no captured mutation before the React #418 signal. This further supports the ordering: React reports/enters hydration recovery before any observable React-owned DOM mutation is recorded by the document-start probe.

Transition correlation for this 125-row run remained suggestive but sparse:

- `answered -> answered`: 1/75 (1.33%).
- `Every matching performance2 total -> answered`: 1/6 (16.67%).
- `Every matching performance2 total -> Every matching performance4 total`: 1/2 (50%).

No transition family has enough sample size to promote as the root cause. The common feature across the 125-row corpus remains that every row renders an NL answer and therefore renders `NlAnswerFeedback`.

The feedback-present/absent discriminator was then rerun. The original 120-row cohort again hung on the `fb_050` / `nf_050` pair (`Dustin Martin most goals against Brisbane Lions` / `coach`). A diagnostic 12-row slice showed the other ten missing rows complete quickly, narrowing the hang to that two-row pair. A 118-row discriminator excluding only that independently hanging pair completed with the same 4-worker, `NL_UI_BATCH=12`, production-style standalone setup:

- Corpus: `artifacts/nl-ui/issue-068-feedback-discriminator-nohang.csv`.
- Rows: 118 attempted, 118 observed.
- Workers: 4.
- Batch: `NL_UI_BATCH=12`.
- Semantic pass/fail/unscored: 0 / 0 / 118 (`expected_status=unknown` by design).
- Outcomes: answered 68, absent 50, HTTP errors 0, page errors 0.
- Hydration/client errors: 3 React #418.
- Report: `nl-ui-out/summary.json`.

Rendered-DOM cohort rates from the 118-row discriminator:

- Feedback absent (`SearchBox` present, no `NlAnswerFeedback`): 0/50 (0.00%).
- Feedback present, single answered: 3/57 (5.26%).
- Feedback present, grouped answered: 0/11 (0.00%).
- Overall rows with feedback present: 3/68 (4.41%).
- Overall rows without feedback present: 0/50 (0.00%).

The three discriminator failures were:

- `fb_015`: `Lance Franklin highest handballs game against Port Adelaide`, previous `MCG`; feedback present; React #418 at ~380 ms. This row had pre-error RSC activity, so it is not useful for ruling RSC out by itself.
- `fb_026`: `Lance Franklin total tackles against West Coast`, previous `Hawthorn`; feedback present; React #418 at ~10 ms, first `_rsc` at ~12 ms, 0 probe mutations.
- `nf_060`: label cohort was `feedback_absent_search_results`, but the query `tackles` legitimately rendered an NL answer (`Scott Pendlebury — 2,022 tackles`) and therefore rendered `NlAnswerFeedback`; React #418 at ~30 ms, first `_rsc` at ~32 ms, 0 probe mutations.

This discriminator materially weakens the "SearchBox alone" hypothesis and strengthens H3/H6 around the `NlAnswerFeedback` / Server Action form hydration boundary. It still does not prove that Server Action metadata values differ: the stable action id and `$ACTION_KEY` evidence remains. The narrower supported statement is that React #418 has now concentrated on real rendered NL feedback-form states while true feedback-absent `/search` states stayed clean under the same worker/batch/navigation shape.

Updated hypothesis status:

- H1 pre-paint DOM mutation: weakened further; latest 125-row failures and feedback-cohort failures still recorded 0 pre-error probe mutations.
- H2 useId/component-tree ordering: visible recovery symptom; weakened as a SearchBox-only explanation because 50 true SearchBox-without-feedback rows had 0 hydration errors in the discriminator.
- H3 Server Action metadata/form hydration: strengthened as a boundary hypothesis, despite stable action id/key values, because all discriminator failures occurred when the feedback form was truly rendered.
- H4 answer-shape transition: still weakened as a single trigger; latest 125-row transitions are sparse and mixed.
- H5 cross-worker build/action mismatch: weakened further; current build/static pair is proven consistent and failures report the same build.
- H6 first client-render state/input divergence: strengthened and now focused on the first client render of the feedback/Server Action form boundary rather than on `SearchBox` alone.

Feedback boundary source inspection before patching:

- `NlAnswerSection` is a Server Component that renders the answer section and conditionally includes `NlAnswerFeedback` for answered and unanswerable NL panels.
- Before the patch, `NlAnswerFeedback` was a Client Component that imported `submitNlFeedback` and bound it through `useActionState(submitNlFeedback, INITIAL)`.
- The first client render had unconditional local state (`choice = none`, `dismissed = false`) and no `useId`, `useEffect`, browser-state branch, nested form, nested button, or parent form.
- Server HTML/browser-parser checks on captured failing rows found no nested `<form>`, no button-inside-button, no form-inside-`p`, and no repaired ancestor path for the feedback form. The browser-parsed form remained a direct child of `section.section`.
- The concrete mismatch candidate is therefore not invalid HTML; it is the Client Component `useActionState` form boundary hydrating a server-emitted Server Action form. Every relevant failure recovered that boundary from server action hidden fields to the client fallback action shape while true feedback-absent rows stayed clean.

Narrow source patch:

- Added `submitNlFeedbackForm(formData)` as a plain Server Action form entrypoint that reuses the existing feedback validation/rate-limit/recording logic.
- Changed `src/components/NlAnswerFeedback.tsx` back into a Server Component that renders the `<form action={submitNlFeedbackForm}>` and hidden `clientRef`.
- Added `src/components/NlAnswerFeedbackControls.tsx` as the small Client Component child for `useFormStatus`, reveal-on-first-`No`, dismiss, and the local thanks acknowledgement.
- Removed `useActionState` from the feedback form boundary. SearchBox, answer rendering, Link prefetch, parser/search semantics, and the Server Component answer architecture were not changed.
- Prediction: feedback-present rows should stop producing React #418 if the root cause is the hydrated `useActionState` Server Action form boundary; feedback submission should still insert through the same server-side recording path.

Local verification after the patch:

- `npm.cmd run typecheck`: passed.
- `npm.cmd test -- tests/nl-answer-feedback-boundary.test.ts`: passed 2 tests. The regression asserts the form remains server-owned, uses the plain Server Action entrypoint, keeps the expected controls in a client child, does not reintroduce `useActionState`, and the plain form entrypoint calls `recordNlFeedback`.
- `npm.cmd test -- tests/nl-feedback.test.ts`: passed 31 tests.

Post-patch live discriminator gate:

- Live build check: `.next/standalone/.next/BUILD_ID` and `/search` response header `x-afldb-build` both reported `DOoGeJqYceleN9QLcG2kI`.
- Health check: `/api/health` returned `status=ok`, `database=ok`, `latencyMs=19`.
- Corpus: `artifacts/nl-ui/issue-068-feedback-discriminator-nohang.csv`.
- Command shape: `AFLDB_E2E_BASE_URL=http://10.0.40.100:8090`, `NL_UI_BATCH=12`, `NL_UI_WORKERS=4`, Playwright project `nl-stress`, `--workers=4 --no-deps`.
- Rows: 118 attempted, 118 observed.
- Semantic pass/fail/unscored: 0 / 0 / 118 (`expected_status=unknown` by design).
- Outcomes: answered 68, absent 50, HTTP errors 0, page errors 0, timeouts 0.
- Client-side error loads: 3.
- Hydration errors: 2 React #418.
- Report: `nl-ui-out/summary.json`.

Rendered-DOM cohort rates from the post-patch 118-row discriminator:

- Feedback absent (`SearchBox` present, no `NlAnswerFeedback`): 0/50 React #418 (0.00%).
- Feedback present, single answered: 1/57 React #418 (1.75%).
- Feedback present, grouped answered: 1/11 React #418 (9.09%).
- Overall rows with feedback present: 2/68 React #418 (2.94%).
- Overall rows without feedback present: 0/50 React #418 (0.00%).

Runtime failures captured in the post-patch discriminator:

- `fb_015`: `Lance Franklin highest handballs game against Port Adelaide`, previous `nf_014` / `MCG`; feedback present; answered single result; client error was `net::ERR_NO_BUFFER_SPACE`, not React #418; first `_rsc` at ~24 ms, 5 RSC requests before observation cutoff, 0 probe mutations.
- `fb_029`: `Tony Lockett most clearances against Hawthorn`, previous `nf_028` / `Gold Coast`; feedback present; grouped answer (`Every matching performance3 total`, 3 rows); React #418 at ~10 ms, first `_rsc` at ~22 ms, 0 RSC requests before hydration-error cutoff, 0 probe mutations.
- `nf_054`: label cohort was `feedback_absent_search_results`, but the rendered DOM legitimately contained `NlAnswerFeedback` for `draw` (`Jack Riewoldt - 8 draws`); previous `fb_054` / `Dustin Martin total disposals against Port Adelaide`; feedback present; single answer; React #418 at ~553 ms by page timing and ~63 ms in the document-start probe, no `_rsc` before hydration-error cutoff, 0 probe mutations.

Decision from the post-patch discriminator:

- The patch prediction is not satisfied. Feedback-present rows still produced unexplained React #418 after the server-owned form patch, while true feedback-absent rows remained clean.
- The old Client Component `useActionState` Server Action form boundary remains a plausible contributor or adjacent risk, but this result does not support treating it as the complete root cause.
- The 125-row, 501-row, and 12,000-row gates were not run. Preserve the `nl-ui-out` artifacts and reassess the remaining feedback-present first-client-render boundary before broadening any source patch.

Post-patch artifact inspection and H7 diagnostic setup:

- `src/components/NlAnswerFeedbackControls.tsx` still had deterministic local first-render state (`choice = none`, `dismissed = false`, `submitted = false`) and no browser/environment-derived initializer. The only first-render value derived from form context was `useFormStatus().pending`, used only to add/remove `disabled` on the Yes/No submit buttons.
- Current probe fingerprints do not include the `disabled` attribute, button `value`, button `aria-label`, or client component boundary marker details, so the saved 118-row artifacts cannot prove or disprove an initial `pending` divergence.
- Saved hydration artifacts exist for both post-patch React #418 rows: `artifacts/hydration/fb_029` and `artifacts/hydration/nf_054`.
- The saved same-query server HTML for each failing row matched its clean-control server HTML byte-for-byte in size and captured form shape. The browser-parsed DOM at `DOMContentLoaded` contained the expected server action hidden input followed by `clientRef`, the prompt span, Yes/No/Dismiss buttons, and `noscript`; no parser repair, nested form, or nested button evidence was found.
- `fb_029` captured the React #418 too early for a hydration-error snapshot, but its `DOMContentLoaded` and final feedback fingerprints remained the server-action form shape.
- `nf_054` captured recovery clearly: `DOMContentLoaded` had the server-action form shape (`method=POST`, `$ACTION_ID_409fff3fb3d737400a62ea78bf000886dd81308d7b`, `clientRef`), while the hydration-error/final snapshots had React's client fallback form action and only `clientRef`. With 0 mutations captured before the error, this remains classified as recovery evidence rather than proof of the first mismatch.

H7 `useFormStatus` initial pending-state hypothesis:

- Prediction: if `useFormStatus().pending` sometimes differs between the server-rendered controls and first client render under parallel production hydration, removing that hook while preserving the server form and button names/values should make the 118-row discriminator hydration-clean.
- Diagnostic experiment prepared locally and synced to the dev host: temporarily remove `useFormStatus` from `NlAnswerFeedbackControls` and remove only the pending-derived `disabled={pending}` attributes. The server-owned form, `submitNlFeedbackForm`, `clientRef`, verdict button names/values, textarea reveal path, dismiss control, and optimistic submitted acknowledgement were otherwise preserved.
- Local `npm.cmd run typecheck`: passed after the diagnostic change.
- Remote dev-host `npm run typecheck`: passed.
- Remote dev-host `npm run build`: passed, and `prepare-standalone` completed.
- Built diagnostic `BUILD_ID`: `0aYQumjOtVYcrJKPCj0_a`.
- Service restart was blocked because `sudo systemctl restart afldb` required a TTY/password.
- Running `/search` still reports `x-afldb-build: DOoGeJqYceleN9QLcG2kI`; health remains OK. Browser evidence cannot be run or interpreted until the legitimate service restart makes `0aYQumjOtVYcrJKPCj0_a` live.

### Follow-up
End-of-day status for 2026-08-21:

Current diagnostic experiment:

- The current narrow H7 experiment removes only `useFormStatus` from `NlAnswerFeedbackControls` and pending-derived `disabled={pending}` from the Yes/No buttons.
- Everything else remains preserved: the server-owned feedback form, `submitNlFeedbackForm`, `clientRef`, verdict field names/values, incorrect textarea path, dismiss behaviour, and submission behaviour.
- Local `npm.cmd run typecheck`: passed.
- Remote `npm run typecheck`: passed.
- Remote `npm run build`: passed.
- Built diagnostic `BUILD_ID`: `0aYQumjOtVYcrJKPCj0_a`.

Current live-service state:

- A legitimate restart was attempted with `sudo systemctl restart afldb`.
- `systemctl is-active afldb` returned `active`.
- Immediately after restart, `curl -sS http://127.0.0.1:3100/api/health` and `curl -sSI http://127.0.0.1:3100/search` both failed with connection refused on port 3100.
- The freshly built standalone artifact still reports `0aYQumjOtVYcrJKPCj0_a`.
- The live `x-afldb-build` could not yet be verified because the application was not accepting connections immediately after restart.
- Do not classify this as a failed build or failed service yet; it may simply have been checked before the Node/Next process had finished binding to port 3100.
- No Playwright run was started because the intended diagnostic build was not yet proven live.

Last known valid runtime before this restart:

- Previous running build: `DOoGeJqYceleN9QLcG2kI`.
- Previous service/database health was good before the diagnostic restart.

Current ISSUE-068 evidence:

- The previous post-patch 118-row discriminator still showed 118/118 observed, feedback absent 0/50 React #418, feedback present 2/68 React #418, feedback-present single answers 1/57, feedback-present grouped answers 1/11, HTTP failures 0, page errors 0, and timeouts 0.
- Hydration failures remained feedback-present and occurred before observed RSC/navigation activity with 0 captured pre-error DOM mutations.
- The server-owned feedback form patch therefore did not fully resolve ISSUE-068.
- Current leading hypothesis H7: `useFormStatus().pending` inside `NlAnswerFeedbackControls` may occasionally cause the first hydrated client render to differ from the server-rendered feedback controls.
- H7 is not proven. The current diagnostic build removes only that variable.

Exact next step for the next session:

- First, do not rebuild.
- Check whether the restarted service has now finished starting:
  - `systemctl is-active afldb`
  - `curl -sS http://127.0.0.1:3100/api/health`
  - `curl -sSI http://127.0.0.1:3100/search | grep -i x-afldb-build`
- Expected diagnostic build: `0aYQumjOtVYcrJKPCj0_a`.
- If port 3100 still refuses connections, collect:
  - `systemctl status afldb --no-pager -l`
  - `systemctl show afldb -p ActiveState -p SubState -p MainPID -p ExecMainStatus -p Result`
  - `ss -ltnp | grep ':3100' || echo "Nothing listening on 3100"`
  - `journalctl -u afldb -n 100 --no-pager`
- Do not rebuild or modify source until the service state is understood.
- If the service is healthy and built `BUILD_ID` equals live `x-afldb-build` equals `0aYQumjOtVYcrJKPCj0_a`, then rerun only the unchanged 118-row feedback discriminator:
  - `$env:AFLDB_E2E_BASE_URL='http://10.0.40.100:8090'`
  - `$env:NL_UI_CORPUS='artifacts\nl-ui\issue-068-feedback-discriminator-nohang.csv'`
  - `$env:NL_UI_BATCH='12'`
  - `$env:NL_UI_WORKERS='4'`
  - `.\node_modules\.bin\playwright.cmd test --config=playwright.nl-stress.config.ts --project=nl-stress --workers=4 --no-deps`

H7 prediction:

- If `useFormStatus().pending` is causal, the exact 118-row discriminator should produce 0 React #418 in feedback-present rows, feedback-absent rows should remain clean, and HTTP/page/timeouts should remain 0.
- Historical comparison immediately before the H7 experiment: feedback absent 0/50, feedback present 2/68.
- If any feedback-present React #418 remains, H7 is falsified or materially weakened. Stop, preserve artifacts, do not run 125/501/12k, and do not broaden the patch.
- If the discriminator is 0/118, repeat the exact 118-row run before accepting H7. Do not immediately mark ISSUE-068 resolved.

Project status:

- AFLDB-ISSUE-068 remains open.
- Do not mark it resolved.
- Do not update `CHANGELOG.md` for this end-of-day status entry.

## AFLDB-ISSUE-069 - Expanded UI corpus expects unsupported debut-season leaderboards to answer

- **Status:** Resolved
- **Severity:** Low
- **Area:** Test Tooling
- **Found:** 2026-08-21
- **Resolved:** 2026-08-21
- **Queries:** `most goals in debut season`, `most marks in debut season`, `most disposals in debut season`
- **Files:** `tmp-generate-expanded-ui-corpus.mjs`, `tests/nl-expanded-ui-corpus-generator.test.ts`, `tmp-nl-ui-expanded-v23.csv`

### Symptom
The expanded UI corpus marked debut-season player-stat leaderboards as expected `plan` rows, producing three browser expectation failures.

### Reproduction
Run the regenerated expanded corpus before the oracle fix; `most goals in debut season`, `most marks in debut season`, and `most disposals in debut season` all render no NL panel while the corpus expects an answer.

### Expected
Current NL policy deliberately supports `on debut` as a debut-game boundary and does not treat `debut season` as a synonym. Until a separate player-debut-season compiler path exists, these generated rows should be expected declines.

### Actual
The corpus expected the unsupported `debut season` wording to answer, creating stale-oracle failures.

### Evidence
The v24 expanded 501-row sweep reported three `debut_boundary` failures, all expected `plan` and observed `absent`. Existing parser acceptance coverage explicitly prevents debut-season wording from being collapsed into debut-game scope.

### First wrong layer
Audit tooling

### Root cause
The expanded-corpus generator added deliberate debut-vs-debut-season contrast rows but assigned `expected_status=plan` to both sides.

### Fix
Changed generated `debut season` rows to `expected_status=decline` with `unsupported` tags and added generator regression coverage.

### Validation
`npm.cmd test -- tests/nl-expanded-ui-corpus-generator.test.ts` passed with two generator assertions. `node tmp-generate-expanded-ui-corpus.mjs` regenerated 501 rows; all three `debut season` rows now have `expected_status=decline`.

### Follow-up
If AFLDB later adds true debut-season ranking support, promote these rows back to expected `plan` alongside parser/compiler/answer tests for the new semantics.

## AFLDB-ISSUE-070 - Parser-v24 full 12k UI corpus failure classification

- **Status:** Resolved
- **Severity:** Low
- **Area:** Audit
- **Found:** 2026-08-21
- **Resolved:** 2026-08-21
- **Queries:** `Gary Ablett most goals against North Melbourne`, `most disposals in 1898`, `longest winning streak`, `Ablett most goals`
- **Files:** `artifacts/nl-ui/nl-audit-v24-ui-12000-20260821/summary.json`

### Symptom
The full 12,000-question UI corpus completed with 502 scored expectation failures and 235 client-side hydration errors.

### Reproduction
Run the full UI corpus against live parser version 24 with `NL_UI_CORPUS=C:\temp\stressTest\afldb_ui_nl_12000.csv`, `NL_UI_RUN_TAG=nl-audit-v24-ui-12000-20260821`, `NL_UI_BATCH=100`, `NL_UI_WORKERS=4`, and `NL_UI_TIMEOUT_MS=20000`.

### Expected
The audit must classify every failure cluster rather than stopping at aggregate counts.

### Actual
The harness observed all 12,000 rows and wrote a complete report. Scored failures were not new parser/compiler/answer defects. They split into data-coverage limitations and stale corpus policy/oracles. React hydration errors are tracked separately in `AFLDB-ISSUE-068`.

### Evidence
Run totals:

- Attempted/observed: 12,000/12,000.
- Passed: 11,442.
- Scored expectation failures: 502.
- Unscored: 56.
- Outcomes: `answered=11403`, `unanswerable=342`, `absent=255`, `http_error=0`, `page_error=0`.
- HTTP failures: 0.
- Page errors: 0.
- Console/client errors: 235.
- Hydration errors: 235.
- Timeouts: 0.
- Malformed answer detections: 0.
- Filler/metamorphic disagreements: 0.
- Report: `artifacts/nl-ui/nl-audit-v24-ui-12000-20260821/summary.json`.

Failure classification:

- **Stale corpus oracle/policy, 200:** bare `Gary Ablett ...` full-name rows expect an answer but the parser safely declines ambiguous first+surname identity (`Gary Ablett Snr` vs `Gary Ablett Jnr`). Examples: `Gary Ablett most goals against North Melbourne`, `quick one Gary Ablett most clangers against Essendon in 1998`.
- **Stale corpus oracle/policy, 8:** `longest winning streak` variants are expected declines in the corpus but now answer correctly, e.g. `Geelong - 23-match win streak`.
- **Stale corpus oracle/policy, 8:** `Ablett most goals` variants are expected declines in the corpus but now answer a surname/career leaderboard, e.g. `Gary Ablett Snr - 1,031 goals`.
- **Data coverage limitation, 99:** early-season all-club stat leaderboards visibly decline with `AFLDB can't answer this`, e.g. `most disposals in 1898`.
- **Data coverage limitation, 99:** early-season club stat leaderboards visibly decline, e.g. `Essendon leading disposals in 1898`.
- **Data coverage limitation, 45:** decade stat leaderboards visibly decline where requested metrics are outside coverage, e.g. `most disposals in the 1900s` and `most goal assists in the 1890s`.
- **Data coverage limitation, 16:** season-range stat leaderboards visibly decline where the range predates metric coverage, e.g. `most clearances between 1965 and 1975`.
- **Data coverage limitation, 14:** venue-season goal-assist rows visibly decline for 1998/1999 coverage, e.g. `most goal assists at the Docklands in 1999`.
- **Data coverage limitation, 13:** club/opponent goal-assist rows visibly decline for 1998/1999 coverage, including impossible/self-opponent variants that currently hit coverage unavailability first.
- **UI/hydration defect, 235:** React #418 client errors are counted separately under `AFLDB-ISSUE-068`.

### First wrong layer
Audit corpus/oracle and data coverage

### Root cause
The 12k corpus contains stale expected-status rows for behaviours that are now supported or intentionally ambiguous, and it marks historical metric rows as expected plans even when AFLDB correctly exposes coverage unavailability.

### Fix
No application fix was made for this issue. This ledger entry records the classification of the completed 12k run. `AFLDB-ISSUE-068` remains open for hydration, `AFLDB-ISSUE-065` was resolved later by the live-only player-season compiler rewrite, and `AFLDB-ISSUE-066` was resolved later by parser version 25.

### Validation
The Playwright harness completed all 120 batches in 20.9 minutes with all 12,000 questions observed. `nl-ui-out` was archived to `artifacts/nl-ui/nl-audit-v24-ui-12000-20260821`.

### Follow-up
Regenerate or re-baseline the 12k corpus oracles separately from NL semantic fixes. Keep ambiguous identity and historical metric coverage policy explicit in the generated expected statuses.

## AFLDB-ISSUE-071 - Parser-v25 V2 stress residual failure classification

- **Status:** Open
- **Severity:** Low
- **Area:** Audit
- **Found:** 2026-08-21
- **Resolved:** N/A
- **Queries:** `record tackles since 2010`, `most bounces in the 1960s`, `players with 3+ goals and exactly 3 clubs`
- **Files:** `tools/nl/v2-runner.ts`, `/home/arm/nl-stress-out-codex-v25-v2/report.md`

### Symptom
The full 250,000-row V2 qualification corpus completed against parser version 25 with residual hard and soft findings even though verified football-answer rows and expected-decline safety rows passed.

### Reproduction
Run `npm run nl:stress -- --corpus ~/nl-killer-250k.csv --out ~/nl-stress-out-codex-v25-v2 --concurrency 6` on the development host with `DATABASE_URL` guarded to `afldb_dev`.

### Expected
The audit report should classify residual failures as product defects, data coverage, or corpus/oracle debt rather than treating the blended failure count as one parser bug.

### Actual
The run scored 245,464 rows: 233,021 clean, 5,263 soft, 7,180 hard, 0 unsafe answers, and 0 of 6,788 metamorphic groups divergent. All 20,000 verified football-result rows passed and all 24,393 adversarial/unanswerable expected-decline rows declined safely. The runner also quarantined 4,536 self-contradicting corpus-oracle rows before scoring.

### Evidence
Headline V2 report:

- Semantic correctness: 191,722 / 201,071 (95.35%).
- Answer correctness: 20,000 / 20,000 (100%).
- Safe declines: 24,393 / 24,393 (100%).
- Metamorphic consistency: 6,788 / 6,788 groups (100%).
- Hard classes: `WRONG_GRAIN`/`WRONG_MODE` season-range sum expectations (6,643 rows), numeric-condition `DROPPED_FILTER`/`EXTRA_FILTER` clusters (537 rows).
- Soft classes: expected-plan historical coverage declines (2,169 rows) and wrong decline reason classifications (3,094 rows).

### First wrong layer
Generated corpus/oracle classification, with possible parser follow-up for the remaining numeric-condition clusters.

### Root cause
Not yet fully classified. The largest clusters match known oracle/policy tension: generated range rows expect `player_game` sum semantics where AFLDB intentionally routes named season/range leaderboards to `player_season`, and historical stat rows expect answerable plans where coverage correctly declines. The smaller numeric-condition clusters need separate generator/oracle review because the report shows expectations such as `3+ goals and exactly 3 clubs` disagreeing with the actual English operators.

### Fix
No application fix made for this classification entry. Parser version 25 was separately fixed under `AFLDB-ISSUE-066`.

### Validation
The full V2 run completed in 5m10s against `afldb_dev`, parser version 25, concurrency 6. Report path: `/home/arm/nl-stress-out-codex-v25-v2/report.md`.

### Follow-up
Review and re-baseline the V2 generator/oracles for season-range sum expectations, historical coverage policy, wrong-decline-reason expectations, and numeric-condition operator contradictions. Only promote any remaining product defect after the oracle layer is reconciled.
