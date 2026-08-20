# AFLDB Issues

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
