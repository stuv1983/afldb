# AFLDB Issues

## AFLDB-ISSUE-001 — Match mutations overwrite authoritative Brownlow totals

- **Status:** Investigating
- **Severity:** High
- **Area:** Admin
- **Found:** 2026-08-20
- **Resolved:** N/A
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
Not yet fixed.

### Validation
Static source/schema trace completed. Database integration validation is not yet available because `AFLDB_TEST_DATABASE_URL` is not configured.

### Follow-up
Add a regression guard that prevents match mutation modules from writing `brownlow_season_votes`.

## AFLDB-ISSUE-002 — Match deletion is blocked by derived `player_clubs` foreign keys

- **Status:** Investigating
- **Severity:** High
- **Area:** Admin
- **Found:** 2026-08-20
- **Resolved:** N/A
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
Not yet fixed.

### Validation
Static foreign-key trace completed. Database integration validation not run because no guarded test database is configured.

### Follow-up
Search all match foreign keys and cover deletion of a career-first/career-last match in integration tests.

## AFLDB-ISSUE-003 — Match deletion queries a nonexistent Brownlow table

- **Status:** Investigating
- **Severity:** High
- **Area:** Admin
- **Found:** 2026-08-20
- **Resolved:** N/A
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
Not yet fixed.

### Validation
Static schema trace completed. Database integration validation not run because no guarded test database is configured.

### Follow-up
Centralise targeted derived-stat recomputation so save and delete cannot drift into separate definitions.

## AFLDB-ISSUE-004 — Match mutations leave related derived summaries stale

- **Status:** Investigating
- **Severity:** High
- **Area:** Database
- **Found:** 2026-08-20
- **Resolved:** N/A
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
Not yet fixed.

### Validation
Static input-to-output trace completed. Database integration validation not run because no guarded test database is configured.

### Follow-up
Add targeted integration coverage for club changes and first/last-match removal.

## AFLDB-ISSUE-005 — Blank lineup statistics can reset a match to a 0–0 draw

- **Status:** Investigating
- **Severity:** High
- **Area:** Admin
- **Found:** 2026-08-20
- **Resolved:** N/A
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
Not yet fixed.

### Validation
Static UI-to-SQL trace completed.

### Follow-up
Cover legitimate zero scores separately from absent scoring data.

## AFLDB-ISSUE-006 — Match-sheet payload is not validated on the server

- **Status:** Investigating
- **Severity:** Medium
- **Area:** Admin
- **Found:** 2026-08-20
- **Resolved:** N/A
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
Not yet fixed.

### Validation
Static action/query/schema trace completed.

### Follow-up
Keep lower-level validation as well as action-level validation so non-UI callers fail closed.

## AFLDB-ISSUE-007 — Statistical mutation connections fall back to the read URL

- **Status:** Investigating
- **Severity:** Medium
- **Area:** Database
- **Found:** 2026-08-20
- **Resolved:** N/A
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
Not yet fixed.

### Validation
Repository-wide search confirmed seven instances across the four new mutation modules.

### Follow-up
Add a source-level or unit guard preventing future mutation helpers from introducing this fallback.

## AFLDB-ISSUE-008 — Partial draft details invent the current year

- **Status:** Investigating
- **Severity:** Medium
- **Area:** Admin
- **Found:** 2026-08-20
- **Resolved:** N/A
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
Not yet fixed.

### Validation
Static action-to-query trace completed.

### Follow-up
Confirm whether manually created draft rows should also create a `draft_persons` identity row; the current changelog says they do, but the implementation does not.

## AFLDB-ISSUE-009 — Match save and delete use unsupported prepared multi-statements

- **Status:** Investigating
- **Severity:** High
- **Area:** Admin
- **Found:** 2026-08-20
- **Resolved:** N/A
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
Not yet fixed.

### Validation
Static query/API contract trace completed. Database integration validation not run because no guarded test database is configured.

### Follow-up
Split every mutation statement and retain the surrounding database transaction; do not use unparameterised `.simple()` as a workaround.

## AFLDB-ISSUE-010 — Manual award winners collide on a single null source key

- **Status:** Investigating
- **Severity:** High
- **Area:** Admin
- **Found:** 2026-08-20
- **Resolved:** N/A
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
Not yet fixed.

### Validation
Static insert/constraint trace completed. Database integration validation not run because no guarded test database is configured.

### Follow-up
Use the existing `manual_admin_edit` source and a collision-resistant per-record identifier.

## AFLDB-ISSUE-011 — New editor entities cannot write their promised audit snapshots

- **Status:** Investigating
- **Severity:** High
- **Area:** Admin
- **Found:** 2026-08-20
- **Resolved:** N/A
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
Not yet fixed.

### Validation
Static insert/constraint trace completed. Database integration validation not run because no guarded test database is configured.

### Follow-up
Add an ordered migration and privilege-safe integration assertions for every registered entity.

## AFLDB-ISSUE-012 — Draft resolution links unrelated same-name people

- **Status:** Investigating
- **Severity:** High
- **Area:** Import
- **Found:** 2026-08-20
- **Resolved:** N/A
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
Not yet fixed.

### Validation
Static identity-model/query trace completed.

### Follow-up
Cover same-name people and propagation across multiple picks for one `draft_person_id`.

## AFLDB-ISSUE-013 — Create-and-link can leave an orphan player after a stale submission

- **Status:** Investigating
- **Severity:** Medium
- **Area:** Admin
- **Found:** 2026-08-20
- **Resolved:** N/A
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
Not yet fixed.

### Validation
Static transaction-boundary trace completed. Database integration validation not run because no guarded test database is configured.

### Follow-up
Keep auth audit recording visible if the statistical transaction succeeds but the separate auth-role audit write fails.

## AFLDB-ISSUE-014 — Zero attendance cannot be created without provenance

- **Status:** Investigating
- **Severity:** Medium
- **Area:** Admin
- **Found:** 2026-08-20
- **Resolved:** N/A
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
Implementation added; final combined validation and status update pending.

### Validation
Static source/schema regression coverage added. Database integration is unavailable without `AFLDB_TEST_DATABASE_URL`.

### Follow-up
Exercise the zero-attendance insert in the guarded integration suite when a test database is available.

## AFLDB-ISSUE-015 — Match creation and deletion leave season summaries and ladders stale

- **Status:** Investigating
- **Severity:** High
- **Area:** Database
- **Found:** 2026-08-20
- **Resolved:** N/A
- **Files:** `src/db/queries/match-admin.ts`, `src/db/queries/player-derived.ts`, `src/db/queries/seasons.ts`

### Symptom
After creating or deleting a match, season dates/counts and stored club-season ladder rows can disagree with the authoritative `matches` table.

### Reproduction
Create the first match in a new season, or delete an existing-season match, then read the season index and ladder.

### Expected
Match-derived season metadata and ladder materialisations are refreshed before commit.

### Actual
The original mutation paths inserted/deleted match facts without rebuilding either summary family.

### Evidence
Public season queries read stored `seasons` metadata and `club_seasons`; the original helpers touched neither after changing `matches`.

### Root cause
The new point mutations were not connected to the canonical season-level rebuild pipeline.

### Fix
Season metadata recomputation is implemented. `club_seasons` remains open because historical ladder/premiership rules require the canonical policy rather than an improvised local aggregate.

### Validation
Static regression coverage confirms both create and delete invoke season metadata recomputation. Ladder correctness is not yet repaired.

### Follow-up
Extract a targeted `club_seasons` rebuild from the canonical migration logic, including season-specific points and finals policy, then add database-backed fixtures.

## AFLDB-ISSUE-016 — Duplicate match retries create duplicate fixtures

- **Status:** Investigating
- **Severity:** High
- **Area:** Admin
- **Found:** 2026-08-20
- **Resolved:** N/A
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
Implementation added; final combined validation and status update pending.

### Validation
Static regression coverage asserts the time-based suffix is absent and duplicate detection fails closed.

### Follow-up
Add a concurrent database integration test for two identical submissions.

## AFLDB-ISSUE-017 — “Previous lineup” can come from the current or a future match

- **Status:** Investigating
- **Severity:** Medium
- **Area:** Admin
- **Found:** 2026-08-20
- **Resolved:** N/A
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
Implementation added; final combined validation and status update pending.

### Validation
Static query regression coverage requires a strict `(match_date, id)` predecessor bound.

### Follow-up
Cover same-day double-headers in a database-backed test.

## AFLDB-ISSUE-018 — Zero-game players display unrecorded era statistics as zero

- **Status:** Investigating
- **Severity:** Medium
- **Area:** Statistics
- **Found:** 2026-08-20
- **Resolved:** N/A
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
Implementation added; final combined validation and status update pending.

### Validation
Focused player-link tests and static match-mutation coverage assert nullable era totals are seeded as `NULL`.

### Follow-up
Run a database integration assertion covering create and delete-last-match paths.

## AFLDB-ISSUE-019 — Admin forms accept historically inactive club identities

- **Status:** Investigating
- **Severity:** High
- **Area:** Identity
- **Found:** 2026-08-20
- **Resolved:** N/A
- **Files:** `src/db/queries/match-admin.ts`, `src/db/queries/awards-admin.ts`, `src/db/migrations/017_club_organizations.sql`

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
Match creation now validates the season-active identity. Award-path repair is still being consolidated.

### Validation
Static regression coverage confirms the match helper invokes the season-aware identity function.

### Follow-up
Keep the validation at the query boundary for every season-scoped club fact.

## AFLDB-ISSUE-020 — Partial disposal components manufacture a total

- **Status:** Investigating
- **Severity:** Medium
- **Area:** Statistics
- **Found:** 2026-08-20
- **Resolved:** N/A
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
Implementation added; final combined validation and status update pending.

### Validation
Focused unit tests cover both complete and partial component combinations.

### Follow-up
None beyond database-backed mutation coverage.

## AFLDB-ISSUE-021 — Match mutations leave career game numbers stale

- **Status:** Investigating
- **Severity:** Medium
- **Area:** Statistics
- **Found:** 2026-08-20
- **Resolved:** N/A
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
Implementation added; final combined validation and status update pending.

### Validation
Static regression coverage asserts the shared helper performs a windowed renumber.

### Follow-up
Add an integration fixture for a mid-career deletion.

## AFLDB-ISSUE-022 — Score synchronization leaves the final period total stale

- **Status:** Investigating
- **Severity:** Medium
- **Area:** Statistics
- **Found:** 2026-08-20
- **Resolved:** N/A
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
Implementation added; final combined validation and status update pending.

### Validation
Static regression coverage asserts a final-period upsert occurs with the match update.

### Follow-up
Confirm overtime-period policy with a database fixture; the implementation updates the greatest existing period, defaulting to period four.

## AFLDB-ISSUE-023 — Generic awards editor bypasses authoritative Brownlow storage

- **Status:** Investigating
- **Severity:** High
- **Area:** Statistics
- **Found:** 2026-08-20
- **Resolved:** N/A
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
Not yet fixed.

### Validation
Static UI/query trace completed.

### Follow-up
Fail closed in both the action and lower-level helper unless a provenance-aware Brownlow editor is implemented.

## AFLDB-ISSUE-024 — Club best-and-fairest winners can use the wrong or no club

- **Status:** Investigating
- **Severity:** High
- **Area:** Identity
- **Found:** 2026-08-20
- **Resolved:** N/A
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
Not yet fixed.

### Validation
Static definition/form/query trace completed.

### Follow-up
Pin club-scoped winners to the award definition and validate the historical identity at the query boundary.

## AFLDB-ISSUE-025 — Honour-team upsert can overwrite a distinct same-name player

- **Status:** Investigating
- **Severity:** High
- **Area:** Identity
- **Found:** 2026-08-20
- **Resolved:** N/A
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
Not yet fixed.

### Validation
Static schema/query trace completed.

### Follow-up
Use separate partial uniqueness for linked player IDs and unlinked names, and make creation fail rather than overwrite.

## AFLDB-ISSUE-026 — Submission rejection can overwrite a concurrent workflow transition

- **Status:** Investigating
- **Severity:** Medium
- **Area:** Admin
- **Found:** 2026-08-20
- **Resolved:** N/A
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
Not yet fixed.

### Validation
Static workflow trace completed.

### Follow-up
Add a concurrency-oriented query contract test.

## AFLDB-ISSUE-027 — Statistical mutations and required audits commit separately

- **Status:** Open
- **Severity:** High
- **Area:** Architecture
- **Found:** 2026-08-20
- **Resolved:** N/A
- **Files:** `src/db/queries/match-sheet.ts`, `src/db/queries/match-admin.ts`, `src/db/queries/awards-admin.ts`, `src/db/queries/data-edits.ts`

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
Not fixed. Suppressed award-audit failures were made visible, but that does not make the two commits atomic.

### Validation
Static transaction-boundary trace completed.

### Follow-up
Choose and implement a database-owned audit function callable within the import transaction, or a durable transactional outbox with idempotent delivery.

## AFLDB-ISSUE-028 — Mutation cache invalidation omits dynamic public pages

- **Status:** Investigating
- **Severity:** Medium
- **Area:** Web
- **Found:** 2026-08-20
- **Resolved:** N/A
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
Match-sheet and match-delete actions now invalidate the affected dynamic route patterns. Other mutation families remain under review.

### Validation
Type checking accepts the route-pattern calls; source-level coverage is present for match mutations.

### Follow-up
Audit award, player creation, and link-resolution route dependencies and add action-level tests where practical.
