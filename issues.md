# AFLDB Issues

## Open Issues

This table is the quick index of currently open issues. The detailed entries
below remain authoritative. `IssuesIndex.md` mirrors these open items in a
session-friendly format and must be kept synchronized whenever an issue is
created, reopened, resolved, or materially reclassified.

**Open issues:** 7

| Issue | Severity | Area | Summary | Current next action |
|---|---|---|---|---|
| `AFLDB-ISSUE-068` | Medium | UI/Hydration | Intermittent React #418 hydration failures remain isolated to the UI/runtime path under production-style NL search load. | First verify the restarted service and diagnostic build; if healthy and build IDs match, run only the unchanged 118-row feedback discriminator for the narrow H7 experiment. |
| `AFLDB-ISSUE-100` | Medium | Data acquisition / Import architecture | AFLDB has no model for announced teams, jumper numbers, substitutions or late changes; canonical participation is the played match sheet, which exists only after a match. `fetch_lineup_afl` is the only free source found that supplies lineups at all. | Add a new `staging.external_lineups` table fed by `fetch_lineup_afl`, for admin visibility and reconciliation only. **Lineups are staging-only and never become canonical participation**; no public surface. Depends on `AFLDB-ISSUE-096`; implementation gated on probe **P3**, which must supply the still-UNKNOWN column set. |
| `AFLDB-ISSUE-101` | Medium | Data acquisition / Import architecture / Data integrity | The approved historical boundary gives the API pipeline only the in-progress season, but nothing performs the transition when a season completes, so in-season provenance would become permanent and the Stage-9 gate would drift. | Implement the rollover: extend `fitzroy-accepted-baselines.json` to the completed season, supersede in-season provenance, advance `seasons.json.in_progress_seasons`, re-point the Stage-9 `matches_after_accepted_last_season` gate. **Must not redefine completed-season `club_seasons` ownership — that stays with `AFLDB-ISSUE-095`.** `AFLDB-ISSUE-099` is **Resolved as of 2026-08-29, so that dependency is satisfied**; still needs coordination/completion of the relevant ISSUE-095 path. |
| `AFLDB-ISSUE-102` | Medium | Data acquisition / Import architecture | `tools/migration/import_awards.py:1408` still requires `AFLDB_LEGACY_SQLITE`, so the awards/honours domain has the same legacy dependency `AFLDB-ISSUE-095` records for `club_seasons`, previously untracked. No free API covers Coleman, Rising Star, All-Australian, AFLCA, AFLPA or club best-and-fairest; Brownlow is the exception via the AFL Tables path. | **Record only.** Do not design the replacement under this investigation — no source selection, no per-award provenance decision, no importer work is authorised by this entry. Links `AFLDB-ISSUE-095` as the direct sibling gap; not absorbed. |
| `AFLDB-ISSUE-104` | Low | Data acquisition / Import architecture / Data integrity | Migration 076's open-row unique key `(issue_type, issue_key) WHERE issue_key IS NOT NULL AND resolved_at IS NULL` carries no owner, so `writeDisagreementIssue()`'s `ON CONFLICT` upsert could refresh a foreign-owned open row on an identically shaped key. Resolution *is* ownership-scoped; the refresh path is not, because the index is not. **Unreachable today** — ISSUE-099 is the only writer that populates `issue_key`. | **Nothing to do until a second writer is proposed.** Binding precondition: before any second writer populates `data_issues.issue_key`, ownership must enter the conflict/dedup contract — a forward migration adding owner to the partial unique key, or an ownership-scoped persistence path with defined behaviour for a foreign-owned open row. **Do not edit migration 076.** |
| `AFLDB-ISSUE-105` | Low | Data acquisition / Import architecture / Type safety | postgres.js renders `import_batches.id` (`bigint`) as **text**, so an uncast `RETURNING id` is a JavaScript string at runtime while `SettleRunResult.batchId` and the ISSUE-098 current-season code declare `number`. Latent, not currently misbehaving; the ISSUE-099 integration suite hit it as a test failure. | Decide the driver-boundary convention — a branded/string-typed batch id, or an explicit documented decode — then apply it to both call sites and the shared `observation-store.ts` signatures in one change. **Do NOT cast the bigint to `int`**; that trades a typing bug for an overflow risk on an identity column. |
| `AFLDB-ISSUE-106` | Low | Data acquisition / Import architecture | `proposedPeriodScoreValues()` returns `{ period_scores: [] }` rather than `null` when a match published no quarter scores, so such a match would raise a `match_period_scores` candidate proposing an empty array — the sibling of the Brownlow defect ISSUE-099 D2 fixed. **Unreachable in the real T8 snapshot**: all 207 acquired 2026 matches carried period scores. | Decide whether a match with no published period scores establishes the target at all. If not, return `null` and extend `targetEstablishedBySource()`, then reconcile the integration suite's rejected-record expectation (a rejected match record currently refuses on **both** match targets) deliberately rather than incidentally. |

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

### Browser validation (dev, commit `a0cd23b`)

Driven through the real UI as Super Admin. Page loads in 279 ms server-side and
~1.3 s to network-idle in a browser; whole page data path 259 ms at 2,010 queue
rows, of which the seven-table queue scan is ~180 ms.

Confirmed: source type and context visible per row; suggested player with career
context; evidence chips readable without opening the drawer; the drawer's
itemised evidence sums exactly to the score (44+36+17 = 97 for Gary O'Donnell)
with no family counted twice; alternatives in plain words; band and bulk counts
reconciling exactly with the cache (54/11/32/103/44); repeated names grouped and
distinguishable; agreement summarised ("Nicky Winmar — 5 unresolved records, 5/5
independently suggest Nicky Winmar") and disagreement flagged ("Garry McIntosh —
4 unresolved records, ⚠ suggestions disagree") with 0 of those rows offered for
bulk; draft rows at `draft_person` grain showing their pick count; manual
PlayerPicker, create-player and not-a-player paths unchanged; unauthenticated
and invalid-cookie requests still 307 to `/admin/login`; no body overflow at
1280/1024/900 px; no page errors.

Three defects were found and fixed by this pass, none of which any test had
caught: the cache wrote `evidence` with `JSON.stringify` into a jsonb column, so
it read back as text and the page threw on every row; a sub-threshold candidate
was still presented under "Suggested AFLDB player"; and the queue listed every
draft pick rather than one row per `draft_person`, which also made the filter
counts disagree with the cache.

### Reversible real approval

`award_winners#9357` — "Massimo D'Ambrosio", All-Australian 40-Man Squad 2024.

Before: `player_id` NULL, status `unmatched`, no resolution rows, 75 resolutions
globally, 210 unresolved awards. Suggested #12998 Massimo DAmbrosio, 97,
`very_high`, no rival, `v1`.

Approved through the real drawer. After: `player_id` 12998, status `resolved`,
resolution #106 recording `action='linked'`, `previous_status='unmatched'`,
`admin_user_id=4`, `match_method='suggested'`, `match_score=97` (server
recomputed, never sent by the browser), `algorithm_version='v1'`; 76 resolutions,
209 unresolved awards, and exactly one resolution written in the window.

Restored in one transaction: target back to `player_id` NULL / `unmatched`, the
audit row deleted, counts back to 75/210. The audit row was removed rather than
kept because leaving it would have left the trail asserting a link that no
longer exists.

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

- **Status:** Resolved
- **Severity:** High
- **Area:** Database
- **Found:** 2026-08-20
- **Resolved:** 2026-08-22
- **Files:** `src/db/queries/match-admin.ts`, `src/db/queries/data-edits.ts`, `src/db/queries/player-derived.ts`, `src/db/queries/seasons.ts`, `tests/admin-match-mutations.test.ts`, `tests/integration/data-editor.test.ts`

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
The new point mutations were not connected to the canonical season-level rebuild pipeline. Investigation on 2026-08-22 refined the earlier premise: the canonical build (`REBUILDS["club_seasons"]` in `tools/migration/rebuild_derived.py`) contains **no season-specific points policy** — ladder tallies (`played`, `wins`, `draws`, `losses`, `points_for`, `points_against`, `premiership_points`, `percentage`, `ladder_rank`) are copied verbatim from the published source ladder in `staging.team_seasons`, re-pointed to historical club identity via `afldb_identity_for_season`. Only `is_premier` (Grand Final `winner_club_id`, drawn GFs excluded), `finals_played` (count of `matches.is_final` appearances), and completion-gated `wooden_spoon` are derived from match facts.

### Fix
Added `recomputeClubSeasons(tx, season)` to `src/db/queries/player-derived.ts` — a targeted per-season counterpart of the canonical full rebuild, kept in lockstep with `rebuild_derived.py`. It deletes and reinserts the season's `club_seasons` rows using the canonical SQL (staging-sourced tallies, match-derived flags, `sports_data_lab` source resolved by key). It **fails closed**: if `staging.team_seasons` has no rows for the season it throws before deleting anything, rolling back the surrounding mutation.

Wired into all three match-fact mutation paths, each running after `recomputeSeasonMetadata` in the same import transaction (wooden-spoon gating depends on freshly recomputed season status):

- `createMatch` (`src/db/queries/match-admin.ts`)
- `deleteMatch` (`src/db/queries/match-admin.ts`)
- `applyMatchEdit` score case (`src/db/queries/data-edits.ts`)

**Deliberate design decision:** match score corrections intentionally do **not** recalculate published ladder tallies from match facts. Those values remain sourced from `staging.team_seasons`; correcting a source ladder discrepancy requires correcting/reloading the canonical staging source. Only the match-derived `is_premier`, `finals_played`, and completion-gated `wooden_spoon` track match mutations.

### Validation
- Static source contracts extended in `tests/admin-match-mutations.test.ts` (new "rebuilds the stored season ladder" test): both mutation modules call `recomputeClubSeasons` ordered after `recomputeSeasonMetadata`; the fail-closed guard precedes the delete; tallies remain staging-sourced. Suite passed (10/10) on 2026-08-22.
- `npm run typecheck` passed.
- Database-backed integration tests added to `tests/integration/data-editor.test.ts`: (1) semantic canonical-parity — the targeted rebuild reproduces the stored rows field-by-field (season, club_id, tallies, flags, source_id, ordered by club identity) for a completed season; (2) premiership flag follows match facts (simulated drawn GF clears `is_premier`); (3) fail-closed regression — missing staging rows throw without removing or changing existing `club_seasons` rows. All three run inside deliberately rolled-back transactions.
- **Linux/PostgreSQL run, 2026-08-22 (dev host, throwaway clone of `e90b393` + working-tree patch, against `afldb_test`):** all three ISSUE-015 integration tests passed, and the four relevant `tests/integration/release-gates.test.ts` gates passed — ladder-row identity attachment, one identity per organization per season, no premier/wooden spoon for in-progress 2026, and raw staging ladder preserved. The pre-existing `propagates kicks correctly` test initially failed with `column "frees_for" of relation "player_club_season_stats" does not exist`; reproduced identically on the clean unpatched checkout, so unrelated to this issue — `afldb_test` was 8 migrations stale (57/65, the known migrate:test gap). After `npm run db:migrate:test` (058–065 applied) the full `data-editor.test.ts` suite passed 4/4. A non-fatal `data_edits_admin_user_id_fkey` audit warning surfaced during the match-sheet test; that is the known separate-transaction audit behaviour tracked as `AFLDB-ISSUE-027`.

### Follow-up
- Operational note from the fail-closed guard: creating the first match of a season whose ladder has never been loaded into `staging.team_seasons` will now fail until that season's staging ladder rows exist. Intentional (prevents silently emptying stored ladders), but worth remembering when a new season starts.

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

- **Status:** Resolved
- **Severity:** High
- **Area:** Architecture
- **Found:** 2026-08-20
- **Resolved:** 2026-08-22
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
Audit storage and statistical storage use role-separated connections without an atomic delivery design. Mechanically: `data_edits` (057) and `player_link_resolutions` (056) granted INSERT to `afldb_auth` only, so the mutation role could not write its own audit row and every helper committed the import transaction first, then inserted the audit on the separate `authSql` pool.

### Fix
Implemented and validated 2026-08-22. Database-owned same-transaction audit via a narrow direct grant, chosen over both a SECURITY DEFINER function (adds the repo's first definer surface while providing no security property the grant lacks — the app supplies all audit columns either way, and table CHECKs/FKs already enforce validity) and a transactional outbox (worker/idempotency/dead-letter machinery plus delayed audit visibility, disproportionate for a single-process app).

- Migration `066_atomic_audit_import_grants.sql`: `afldb_import` gains INSERT on `data_edits` + `player_link_resolutions` and USAGE on their sequences — nothing else. The tables deliberately stay out of `afldb_meta.import_writable_tables` (its loop grants full DML and would destroy append-only). Mirrored in `tools/maintenance/privileges.sql` after the import revoke loop (the `data_submissions` narrow-grant precedent).
- New `src/db/queries/audit-log.ts` `recordDataEdit(tx, …)`: single parameterised INSERT on the caller's import transaction handle, throws on failure so the transaction aborts.
- All eight `data_edits` writers converted to audit inside `sql.begin`: `saveEdit`, `saveMatchSheet`, `createMatch`, `deleteMatch`, `createAwardWinner`, `createHallOfFameInductee`, `createHonourTeamMember`, and `createPlayer` (which now takes a required `audit: {adminUserId, note?}` argument; the inline `authSql` insert in `createPlayerAction` is gone).
- `recordLinkedResolution` now takes the transaction and is called inside `resolveLink` / `createPlayerAndResolveLink`; a failed resolution audit rolls the link (and created player) back. `confirmUnlinked`, `recordSuggestion`, and the best-effort `auth_audit_log` activity trail stay on `authSql` by design.
- All `auditWarning` success-with-warning plumbing for required audits removed from queries and both admin action modules — the state it reported ("committed but unaudited, do not retry") is structurally unreachable; an audit failure now surfaces as a plain error with nothing committed. `ACTIVITY_AUDIT_WARNING` for the intentionally best-effort activity audit is retained.

### Validation
- `npm run typecheck` passed (2026-08-22, Windows).
- Mocked suites passed 58/58: `tests/awards-admin.test.ts` (audit rides the import tx after the statistical insert; forced audit failure rejects the create with `authSql` untouched; migration-066 + privileges.sql + actions source contracts), `tests/player-link-mutations.test.ts` (resolution audit on the tx with exact values and ordering; forced audit failure returns `ok:false`; `createPlayer` audits `data_edits` in-transaction), `tests/admin-match-mutations.test.ts` (every mutation module contains `recordDataEdit(tx` and no `authSql`/`auditWarning`; helper has no catch), `tests/match-sheet.test.ts`.
- **Linux/PostgreSQL run, 2026-08-22 (dev host `streamanator`, throwaway snapshot of the working tree at `~/tmp/afldb-027`, against `afldb_test`, deleted after):** `npm run db:migrate:test` applied `066_atomic_audit_import_grants.sql` cleanly (13 ms); `npm run db:privileges:test` reconciled without error including the new re-grant block. `tests/integration/privileges.test.ts` passed 24/24, proving from the catalogue that `afldb_import` holds INSERT-and-nothing-else on both audit tables and USAGE-and-nothing-else on their sequences, with the registry drift test intact. `tests/integration/data-editor.test.ts` passed 6/6 including the two ISSUE-027 behavioural proofs: a committed `saveMatchSheet` persists the mutation and its `data_edits` row together, and a save with an FK-violating `adminUserId` returns `ok:false` with the statistical row byte-unchanged and zero audit rows behind. The mocked suites (58/58) and `npm run typecheck` were also re-run green on Linux. The full `tests/integration` folder run showed 367/369 with 2 failures reproduced identically on the untouched `d5243ba` checkout — pre-existing, tracked as `AFLDB-ISSUE-073` (unindexed FKs) and `AFLDB-ISSUE-074` (email-intake fixture assumption), not caused by this change.
- Environment notes from the run: the `afldb_test` migration ledger checksums are LF-based; a snapshot taken from the Windows working tree carries CRLF and must be LF-normalised before `db:migrate:test` will verify the applied prefix. Inline `sed`/`perl`/`tr` escape sequences must never be sent through PowerShell→ssh (backslashes get eaten — one pass literally deleted every lowercase `r` from two SQL files); ship script files instead.

### Follow-up
- Deploy ordering: migration 066 + `npm run db:privileges` must run on an environment **before** the new code serves traffic there, or every admin mutation fails closed on the audit INSERT (safe, but an editor outage). Conversely a stale checkout's `privileges.sql` run would revoke the grants (the new privileges test catches this).
- `promoteSubmission` (`src/lib/ingest/pipeline.ts`) deliberately not absorbed: its post-commit `data_submissions` status flip is a workflow state write, not a required audit, and its failure-path write must survive the rollback. The success-path flip could move inside the import transaction using the existing column grant — separate review.
- Optional tightening: `afldb_auth` retains its now-mostly-unused INSERT on `data_edits` (kept for future admin-side correction entries; append-only unaffected).

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

- **Status:** Resolved
- **Severity:** Low
- **Area:** Tooling
- **Found:** 2026-08-20
- **Resolved:** 2026-08-26
- **Files:** `package.json`, `package-lock.json`, `eslint.config.mjs`

### Symptom
`npm.cmd run lint` opens Next.js's first-time ESLint configuration prompt instead of linting the repository.

### Reproduction
Run the package lint script in a clean non-interactive shell.

### Expected
The checked-in lint configuration and dependencies let CI and local agents run a deterministic lint command.

### Actual
No ESLint dependency or configuration is installed, and the script calls the deprecated `next lint` command.

### Root Cause
- package.json used deprecated `next lint`;
- no checked-in ESLint dependency/configuration existed;
- lint therefore entered Next.js's interactive first-run configuration path.

### Fix
- lint script changed to direct `eslint .`;
- ESLint 9 added as a devDependency;
- eslint-config-next 15.5.x added;
- @eslint/eslintrc added for FlatCompat;
- checked-in eslint.config.mjs added;
- standard generated/artifact directories ignored without excluding application/test source;
- package-lock.json regenerated by npm install.

### Validation
`npm.cmd install` completed successfully (380 packages audited, 0 vulnerabilities).

Final validation:
`npm.cmd run lint`
- deterministic direct `eslint .` execution;
- 84 errors;
- 75 warnings;
- 159 total existing lint findings;
- zero findings attributable to eslint.config.mjs;
- remaining findings are outside ISSUE-040 scope.

### Follow-up
The remaining 159 findings are pre-existing lint debt surfaced by the newly working lint configuration and are outside ISSUE-040. A separately allocated cleanup issue should be created from current dev after merge if desired.



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

- **Status:** Resolved
- **Severity:** High
- **Area:** Import
- **Found:** 2026-08-20
- **Resolved:** 2026-08-22
- **Files:** `tools/migration/common.py`, `tools/migration/import_awards.py`,
  `src/db/migrations/068_import_reads_link_resolutions.sql`,
  `tools/maintenance/privileges.sql`,
  `tests/integration/awards-reload-links.test.ts`,
  `tests/under-22-importer.test.ts`, `tests/integration/privileges.test.ts`

### Symptom
Running the legacy full awards group can turn manually resolved award, Hall of Fame, honour-team or captaincy links back into their legacy automated link state.

### Reproduction
Resolve an untrusted historical honours row through `/admin/player-links`, then run the destructive full `tools/migration/import_awards.py` reload and inspect the reconstructed row.

### Expected
Append-only human identity decisions remain authoritative across repeatable source reloads unless the source fact itself changed and needs review.

### Actual
The importer truncates and recreates the honours tables from legacy source link fields, so later manual decisions are not generally replayed.

### Evidence
`import_awards.py` rebuilt the shared legacy awards/honours targets, while manual link decisions are stored separately in `player_link_resolutions`. The new 22 Under 22 award and winner rows were explicitly excluded from those deletes, but the older loaders did not preserve their durable target IDs.

Six destructive paths were confirmed by inspection, one per loader:

| Loader | Destructive statement |
|---|---|
| `import_awards` (definitions) | `DELETE FROM awards WHERE slug <> %s` |
| `import_awards` (winners) | `DELETE FROM award_winners w USING awards a … a.slug <> %s` |
| `import_all_australian` | `DELETE FROM award_winners WHERE award_id = %s` |
| `import_rising_star` | `truncate(pg, "award_nominations")` |
| `import_hall_of_fame` | `truncate(pg, "hall_of_fame")` |
| `import_honour_teams` | `truncate(pg, "honour_team_members")` |
| `import_captaincies` | `truncate(pg, "captaincies")` |

`awards.id` churn matters on its own: `award_winners.award_id` is `ON DELETE
CASCADE`, so rebuilding the definitions is what cascaded the winners away.

**Database-backed reproduction, `afldb_test`, 2026-08-22** (the before-state the
ledger previously lacked). Awards family loaded from the legacy SQLite, then
three decisions recorded exactly as `resolveLink` / `confirmUnlinked` write
them, then the unmodified `--groups hall_of_fame honour_teams` reload:

| Decision | Before | After the reload |
|---|---|---|
| `hall_of_fame` id 1 "Alf Brown", linked to player 1 | `player_id=1`, `resolved` | row is now **id 344**, `player_id NULL`, `unmatched` |
| `honour_team_members` id 6 "Ted Whitten", linked to player 2 | `player_id=2`, `resolved` | row is now **id 119**, `player_id NULL`, `ambiguous` |
| `hall_of_fame` id 2 "Bill Deller", confirmed unlinked | audit row only | row is now **id 345**; the decision no longer suppresses it in the queue |

Table id ranges moved from `1-343` to `344-686` (`hall_of_fame`) and `1-113` to
`114-226` (`honour_team_members`). All three
`player_link_resolutions.target_id` values became **dangling**: no row exists at
that id any more.

**Audit reattribution was specifically tested for and did not occur.**
`truncate()` deliberately omits `RESTART IDENTITY` and the loaders never
`setval()` these sequences, so ids advance monotonically and are never reused.
The harm is therefore a lost link plus an unresolvable audit pointer — not a
decision silently transferred to another person's row. The earlier hypothesis
that a reload could reattribute a decision is **not supported** by this
reproduction.

### Root cause
Two faults, one mechanism. The bulk loader predates the append-only
manual-resolution workflow and treated reconstructed source rows as the whole
identity state, so (a) the human link was overwritten by legacy link state, and
(b) the surrogate row id the audit trail points at was regenerated.

The loader also had no way to tell a human link from an import-derived one: the
honours row stores only the outcome, and `LINK_STATUS` maps the legacy
`from_draft` vocabulary onto the same `'resolved'`. `afldb_import` held
INSERT-only on `player_link_resolutions` (migration 066) and so could not read
the decisions it was overwriting.

### Fix
Added `reload_keyed()` to `tools/migration/common.py` and moved all six legacy
honours loaders onto it. Each reloads by the source's own key — `(source_id,
source_record_id)` for `award_winners`/`award_nominations`/`captaincies`,
`slug` for `awards`, and migration 042/005's name-based natural keys for
`hall_of_fame` and `honour_team_members`, which carry no source record id.
Matched rows are UPDATEd in place, so `id` survives; new keys are inserted;
vanished keys are deleted. Nothing is truncated.

Migration `068` grants `afldb_import` SELECT (only) on
`player_link_resolutions`, mirrored in `tools/maintenance/privileges.sql`. The
helper reads the latest decision per target and re-applies it on top of the
refreshed source facts:

- `linked` → the admin's `player_id` and `'resolved'` are restored;
- `linked` but the source now names a **different** player → the admin wins and
  the disagreement is reported by row, name and both player ids;
- `confirmed_unlinked` → the row stays unlinked even if the source now supplies
  a link, and the disagreement is reported;
- no decision → the source wins outright, as before.

Classification completes **before** the first UPDATE/INSERT/DELETE. A decision
that cannot be carried — the source renamed the row under a name-based key, or
the key vanished — raises `LinkDecisionLoss` inside the loader's `import_batch`
transaction, which rolls back with the target table untouched. `--allow-link-loss`
downgrades the abort to a report and itemises every discarded decision with its
table, id, key, name, reason, action and player id.

The name-equality guard is also what makes the positional `award_winners` keys
(`"{slug}:{season}:{row_no}"`, `"aa:{season}:{row_no}"`) safe: if the legacy
source shifts row numbering, the name under a key changes and the run stops
rather than reattributing a link.

`under_22` is unchanged.

### Validation
All database work ran against `afldb_test` on the dev host; production and the
read-only legacy SQLite were untouched.

- Migration 068 applied to `afldb_test`; `privileges.sql` reconciled.
  `has_table_privilege('afldb_import','player_link_resolutions', …)` is
  SELECT `t`, INSERT `t`, UPDATE `f`, DELETE `f` — still append-only.
- Baseline: full awards family loaded (39→40 awards, 3,298 `award_winners`,
  766 `award_nominations`, 343 `hall_of_fame`, 113 `honour_team_members`,
  1,375 `captaincies`).
- Defect reproduced on the unmodified importer, as tabulated above.
- After the fix, a full reload left **every row count and every id fingerprint
  byte-identical** (`md5(string_agg(id))` unchanged for all six tables).
- Four decisions applied (linked HoF, confirmed-unlinked HoF, linked honour-team
  member, and an `award_winners` row where the source names someone else); the
  full reload preserved all four, kept every row id, and reported the
  disagreement: `award_winners id=79 [4 | aflpa-mvp:1982:79] 'Leigh Matthews':
  the source now links player 1949, an admin linked player 3; keeping the
  admin's decision — review it`.
- Two further consecutive full reloads: identical counts, identical id
  fingerprints, decisions still intact — idempotent.
- Renaming a decided `hall_of_fame` row aborted the reload with exit 1 and wrote
  nothing; the same for `honour_team_members`. `--allow-link-loss` then
  proceeded and itemised the discarded decision.
- `tests/integration/awards-reload-links.test.ts` — 6/6 passed on the dev host
  (67.5 s, including the full 64-second legacy `awards` group closure).
- `tests/under-22-importer.test.ts` 8/8, `tests/player-link-mutations.test.ts`,
  `tests/awards-admin.test.ts`, `tests/under-22-source.test.ts`,
  `tests/integration/privileges.test.ts` 24/24 — all pass on Linux.
- Full non-integration suite on the dev host: 1,136 passed, 2 failed, both
  pre-existing and unrelated (`AFLDB-ISSUE-072`, and the `AFLDB-ISSUE-068` H7
  diagnostic — both reproduce on an untouched checkout).
- `npx tsc --noEmit` clean. No Next.js build run: no application code changed.

### Follow-up
- **Deployment order (as for migration 066):** apply migration 068 and run
  `npm run db:privileges` *before* the new importer code runs, or the honours
  loaders fail closed on the resolution read.
- The same defect remains in `tools/migration/import_draft.py` and
  `tools/records/import-first-kick-goal.ts`, tracked separately as
  `AFLDB-ISSUE-078`. Neither was modified here.
- Decisions already made dangling by a previous destructive reload cannot be
  recovered by this change; they are invisible to the new guard because their
  `target_id` matches no row. Audited read-only under `AFLDB-ISSUE-079`:
  `afldb_dev` is clean, production not yet checked.
- **Separate defect found during review, deliberately not fixed here and tracked
  as `AFLDB-ISSUE-080`.**
  `createHallOfFameEntry` and `createHonourTeamMember`
  (`src/db/queries/awards-admin.ts:264,331`) insert `hall_of_fame` /
  `honour_team_members` rows with `source_id` left NULL. Those rows are not in
  the legacy source, so the old `truncate()` destroyed them on every reload —
  silent, pre-existing data loss this change does not repair. Under the new
  loaders they are still deleted (their key is absent from the incoming set),
  and if one carries a manual link the strict guard now aborts the whole reload
  instead. That is strictly better than silent destruction, but it means an
  admin-created honours row can block a reload until `--allow-link-loss` is
  used. The proper repair is to scope these two loaders to the rows they own
  (`source_id = <the loader's source>`) so admin-created rows are out of scope
  entirely — deferred because it changes which rows a reload deletes, and
  `hall_of_fame_name_uq` is global, so an admin row duplicating a source key
  would then surface as a constraint violation needing its own decision. See
  `AFLDB-ISSUE-080` for the full analysis; `afldb_dev` currently holds zero
  admin-created rows in either table, so the defect is latent there.

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

- **Status:** Resolved
- **Severity:** Low
- **Area:** Tests
- **Found:** 2026-08-20
- **Resolved:** 2026-08-25
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
**Confirmed 2026-08-22 (during `AFLDB-ISSUE-044`): a line-ending mismatch, not
marker drift.** Every failing marker begins `'\n\n\n'` — for example
`'\n\n\ndef import_under_22('`. `.gitattributes`/`core.autocrlf` check
`import_awards.py` out with CRLF on the Windows working copy, so the file
contains `\r\n\r\n\r\n` and `indexOf` returns `-1`. The markers themselves are
correct and have not moved.

Proof: on the Linux dev host, an untouched `HEAD` checkout runs
`tests/under-22-importer.test.ts` **7/7 green**. The same file fails 4/7 on the
Windows checkout of the same commit. The importer sections referenced by the
three markers unrelated to `AFLDB-ISSUE-044`'s change were never edited, so the
platform is the only variable.

Severity lowered from Medium to Low: this never affected Linux, which is the
supported runtime and the release-gate environment.

### Fix
Normalised CRLF to LF at the test source-read boundary in `tests/under-22-importer.test.ts`, leaving the importer and behavioural assertions unchanged.

### Validation
With integration suites and this known failing file excluded, all 983 remaining safe non-integration assertions pass.

Current review on 2026-08-21 reproduced the issue unchanged: `npm.cmd test -- tests\under-22-importer.test.ts` failed 4 of 7 tests, all at `between()` because the expected end marker was not found. This remains a test/tooling defect outside the NL search path.

2026-08-22: reproduced again on Windows (4 of 8 failing after
`AFLDB-ISSUE-044` added a test to this file) and shown green on Linux for both
the pristine `HEAD` tree (7/7) and the updated tree (8/8).

2026-08-24 (`AFLDB-ISSUE-087` validation, count note): the file runs **8**
tests, not 7 — the ISSUE-087 contract's §4 "Linux 7/7 green" expected-signature
wording predates the ISSUE-044-added test. Observed green on Linux at every
successor candidate's R4; the Windows failure signature (4 failures, CRLF
`between()` cause) is unchanged.

2026-08-25 focused Windows run: `npm run test -- tests/under-22-importer.test.ts` — 8/8 tests passed.

### Follow-up
Normalise line endings when the source-contract tests read a file — for example
`readFileSync(...).replace(/\r\n/g, '\n')` — rather than editing the importer.
Keep the behavioural assertions unchanged.

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

- **Status:** Resolved
- **Severity:** Low
- **Area:** Search
- **Found:** 2026-08-20
- **Resolved:** 2026-08-28
- **Files:** `src/app/search/qualifying-matches/page.tsx`, `src/components/NlAnswerSection.tsx`, `src/db/queries/nl/team-match.ts`, `src/search/nl/qualifying-matches-gate.ts`, `src/search/nl/qualifying-matches-href.ts`

### Root cause
Match Search could not faithfully encode the complete grouped `team_aggregate` predicate set, so linking the count through an approximate Match Search URL would have been unsafe.

### Fix
Added a dedicated `/search/qualifying-matches` drill-down backed by the NL plan token. The qualifying-match gate links only safely replayable plans; otherwise the UI retains the plain-text fallback. Integration preserved the newer `head_to_head` rendering already present on `dev`.

### Validation
Validated 2026-08-28 against the rebuilt `afldb_test`.

- The single PostgreSQL integration regression added by ISSUE-059, `drilldown preserves and executes a combined complex predicate exact set`, passed.
- The integration file was 15/18 overall; its three failures are pre-existing `club_season` tests caused by the expected `club_seasons = 0` state owned by `AFLDB-ISSUE-095`, not ISSUE-059.
- `tests/unit/qualifying-matches-gate.test.ts` plus `tests/unit/NlAnswerSection.test.ts`: 5/5 passed.
- After the merge resolution, `tests/unit/NlAnswerSection.test.ts`: 2/2 passed.
- Integrated on `dev` as `5ec6bd2` (`feat: add qualifying match drilldown`).

### Follow-up
None. The separate club-season data gap remains `AFLDB-ISSUE-095`.

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

- **Status:** Resolved
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

2026-08-22 (observed during `AFLDB-ISSUE-044`, not investigated here): the H7
diagnostic patch leaves `tests/nl-answer-feedback-boundary.test.ts >
keeps the Server Action form owned by the server component boundary` failing —
it still expects `NlAnswerFeedbackControls` to contain `useFormStatus`, which
H7 deliberately removed. Reproduces on an untouched checkout on both Windows and
the Linux dev host. Whoever concludes H7 must either restore `useFormStatus` or
update that expectation to the intended boundary; it should not be left red.

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

2026-08-24 — `AFLDB-ISSUE-087` successor-4 D4 measurement (production-style
posture-2 standalone runtime, candidate `0da44f9`, 1,440-question corpus, 4
workers): authoritative `report.hydration.totalHydrationErrors = 8` (0.56% of
1,440), with 8 error-carrying observation rows and 8 complete
`artifacts/hydration/*` incident directories (all 8 files including
`metadata.json`). This is well below the frozen 5.0% release threshold and
PASSed the release gate, but it confirms React #418 remains intermittent under
production-style load. It does **not** validate H7, which is still awaiting its
own discriminator run. Issue remains open.

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

- **Status:** Resolved
- **Severity:** Low
- **Area:** Audit
- **Found:** 2026-08-21
- **Resolved:** 2026-08-27
- **Queries:** `record tackles since 2010`, `most bounces in the 1960s`, `players with 3+ goals and exactly 3 clubs`
- **Files:** `AFLDB-ISSUE-071.md`, `tools/nl/v2.ts`, `tools/nl/v2-runner.ts`, `tools/nl/README.md`, `tests/nl-stress-v2.test.ts`, `/home/arm/nl-stress-out-codex-v25-v2/report.md`

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
Generated corpus/oracle classification. No current production parser defect is proven.

### Root cause
The residual set mixed four different contracts. The 6,643 season/range rows carry stale `player_game` sum expectations; current `NL-025` regressions and verified-answer evidence establish `player_season` unless the reader explicitly asks for a total. The 2,169 historical rows expect plans where typed coverage validation correctly declines a wholly unrecorded era. The 3,094 decline rows over-specify a reason even though the parser remains safely declining. The 537 numeric-condition findings expose a V2 oracle blind spot: `oracleDefect()` associated operators by numeric value only, so same-valued clauses such as `3+ goals and exactly 3 clubs` could swap the two operators in `expected_semantics_json` without being quarantined.

### Fix
No application parser/plan fix was made. The V2 oracle now associates explicit operators and values with the finite generated condition noun that follows them, so known same-valued clauses cannot exchange operators invisibly. Unknown nouns retain conservative checking. Focused oracle regressions cover the exact ISSUE-071 swap and a correct same-valued control. Harness documentation now states accurately that `--report-only` is V1-only. Parser version remains 25.

### Validation
Historical evidence remains the completed 5m10s V2 run against `afldb_dev`, parser version 25, concurrency 6, at `/home/arm/nl-stress-out-codex-v25-v2/report.md`. Current DB-free source/test inspection proves the four-category classification and the same-value oracle blind spot. Direct Node 22 execution of the actual `tools/nl/v2.ts` module passed 11/11 oracle-contract assertions, including the exact swapped/correct ISSUE-071 pair and `toV2Case()` quarantine attachment. Final user-run validation on 2026-08-27 passed all 3 focused files and 382/382 tests in 447 ms: `nl-stress-v2` 58/58, `nl-regression-corpus` 163/163, and `nl-parser` 161/161. No PostgreSQL or browser was involved.

### Follow-up
Resolved. The focused suite is the correctness proof for this oracle-only defect: it directly covers field-aware same-value quarantine plus the current parser/regression contracts. Re-running the external 250k corpus is optional follow-up measurement to refresh aggregate counts and enumerate stale decline-reason rows; it is not required to prove the fixed invariant. If performed, retain the established classifications: season/range rows use `player_season` unless explicitly totalled, wholly unavailable historical rows remain policy declines, stale decline reasons must never be converted into false answers, and contradictory numeric expectations remain reported in `corpus-defects.jsonl` rather than scored. No database-backed acceptance is required for this resolution.

## AFLDB-ISSUE-072 — site-settings default-shape test is stale after frontendTheme

- **Status:** Resolved
- **Severity:** Low
- **Area:** Tests
- **Found:** 2026-08-22
- **Resolved:** 2026-08-25
- **Files:** `tests/site-settings.test.ts`, `src/db/queries/site-settings.ts`

### Symptom
`tests/site-settings.test.ts` › `supplies every default from an empty table` fails: the parsed defaults now include `frontendTheme: 'classic'` (and any sibling keys added with it), which the test's expected object predates.

### Reproduction
`npx vitest run tests/site-settings.test.ts` on `dev` at `59a232e` (observed during unrelated AFLDB-ISSUE-027 work).

### Expected
The default-shape regression covers every current settings key.

### Actual
The themeable-frontend work (commit `d5243ba`) added new settings defaults without extending the test's expected object.

### Evidence
AssertionError diff shows `frontendTheme: "classic"` present in received, absent in expected.

2026-08-24 (`AFLDB-ISSUE-087` R4-isolated runs at the successor candidates):
reproduced as the accepted release signature — 31 total / 30 passed / exactly
1 failed (`supplies every default from an empty table`), with received-only
differences `frontendTheme: "classic"` **plus** the `pageIntros` defaults
(brownlow/clubs/draft/records). The expected object is therefore stale for
`pageIntros` as well, not only `frontendTheme`.

### First wrong layer
Test expectation.

### Root cause
The `d5243ba` settings additions (`frontendTheme` and `pageIntros`) were not mirrored into the default-shape test expectation.

### Fix
The stale test expectation was updated to include the current `pageIntros` and `frontendTheme` defaults using the canonical `DEFAULT_PAGE_INTROS` and `DEFAULT_SITE_THEME` exports.

### Validation
`npx vitest run tests/site-settings.test.ts` — 31/31 tests passed.

## AFLDB-ISSUE-073 — Four audit/link foreign keys have no supporting index

- **Status:** Resolved
- **Severity:** Medium
- **Area:** Database
- **Found:** 2026-08-22
- **Resolved:** 2026-08-25
- **Files:** `src/db/migrations/056_player_link_review.sql`, `src/db/migrations/057_data_edits.sql`, `src/db/migrations/071_audit_link_fk_indexes.sql`, `tests/integration/fk-indexes.test.ts`

### Symptom
`tests/integration/fk-indexes.test.ts` › `indexes every foreign key whose parent can be deleted from` fails, listing: `data_edits(admin_user_id) -> auth_users`, `player_link_resolutions(admin_user_id) -> auth_users`, `player_link_resolutions(player_id) -> players`, `player_link_suggestions(resolved_by) -> auth_users`.

### Reproduction
`npx vitest run tests/integration/fk-indexes.test.ts` on the dev host against `afldb_test` (schema at migration 066).

### Expected
Every FK whose parent can be deleted from has a usable index, or its parent is justified in `DELETE_FREE_PARENTS`.

### Actual
The four FKs above, all introduced by migrations 056/057, have no index; deleting from `auth_users` or `players` sequentially scans the child tables.

### Evidence
Reproduced identically 2026-08-22 on the untouched dev checkout at `d5243ba` (pre-dating the ISSUE-027 change, which added no FK) and on the ISSUE-027 working tree. Pre-existing; likely first surfaced now because `afldb_test` only recently caught up past migration 056 (the known migrate:test lag).

### First wrong layer
Schema (missing indexes) — migrations 056/057 declared the FKs without the migration-041-shape partial indexes.

### Root cause
Migrations 056 (`player_link_suggestions`, `player_link_resolutions`) and 057 (`data_edits`) each introduced foreign key columns but did not add the supporting indexes that migration 041 established as the convention. The FK-index integration test (`fk-indexes.test.ts`) only began catching these once `afldb_test` was migrated past 056, so the gap had been latent since those migrations were first applied.

### Fix
Added `src/db/migrations/071_audit_link_fk_indexes.sql` with four `CREATE INDEX IF NOT EXISTS` statements following the migration-041/050 convention exactly:

- `ix_data_edits_admin_user_id` — `ON data_edits (admin_user_id)` unconditional; column is `NOT NULL`.
- `ix_plr_admin_user_id` — `ON player_link_resolutions (admin_user_id)` unconditional; column is `NOT NULL`.
- `ix_plr_player_id` — `ON player_link_resolutions (player_id) WHERE player_id IS NOT NULL`; column is nullable (NULL when `action = 'confirmed_unlinked'`, per `plr_action_player_ck`).
- `ix_pls_resolved_by` — `ON player_link_suggestions (resolved_by) WHERE resolved_by IS NOT NULL`; column is nullable (NULL while suggestion is `open`).

No `DELETE_FREE_PARENTS` exemptions were added — `auth_users` is explicitly deletable (the test argues this directly) and `players` reloads via `TRUNCATE … CASCADE`. Migrations 056 and 057 were not modified retrospectively.

### Validation
**Linux/PostgreSQL run, 2026-08-25 (dev host, against `afldb_test`):**
- `npm run db:migrate:test`: 71 migration file(s), 70 already applied; applied `071_audit_link_fk_indexes.sql` cleanly (27 ms).
- `npx vitest run tests/integration/fk-indexes.test.ts`: 2/2 passed — `indexes every foreign key whose parent can be deleted from` ✓ and `keeps the exemption list free of entries that no longer apply` ✓.

### Follow-up
None. The FK-index gate is green; no related unindexed FKs were identified.


## AFLDB-ISSUE-074 — email-intake integration test assumes a fixture admin ordering

- **Status:** Resolved
- **Severity:** Low
- **Area:** Tests
- **Found:** 2026-08-22
- **Resolved:** 2026-08-25
- **Files:** `tests/integration/email-intake.test.ts`

### Symptom
`stages and validates a real CSV from a real admin end to end` fails on the dev host: `uploadedBy` is a real admin email (`streamanatordashboard@gmail.com`) while the test expected `fwab-nav-test@afldb.local`.

### Reproduction
`npx vitest run tests/integration/email-intake.test.ts` on the dev host, where `auth_users` (via `authSql` → `afldb_dev`) contains real admin rows.

### Expected
The test provisions or deterministically selects its own fixture admin.

### Actual
It picks an admin by query ordering, so whichever row sorts first on the host under test wins; on shared/dev data that is not the fixture. The test also stages a real `data_submissions` row with no cleanup (one such artifact row was left in `afldb_dev` by the 2026-08-22 run).

### Evidence
Assertion diff at `tests/integration/email-intake.test.ts:94` during the ISSUE-027 validation run; the ISSUE-027 change touches nothing in email intake.

**Widened 2026-08-24 (recorded at the `AFLDB-ISSUE-087` pre-R9 ledger sync,
from successor-1 validation):** the fragility is broader than admin ordering.
The test combines fixed payload bytes, an unordered `LIMIT 1` selection,
persistent auth-database state and global dedup, so it is history-dependent:
a host that has previously seen the payload can dedup-skip or select different
rows on rerun. A bounded, explicitly approved cleanup of 15 residue rows was
performed in `afldb_dev` during successor-1 validation.

### First wrong layer
Test fixture assumption.

### Root cause
Four independent mechanisms combined to make the test history-dependent:

1. **Wrong database:** `AFLDB_AUTH_DATABASE_URL` was not redirected to `AFLDB_TEST_DATABASE_URL` by the test. On the dev host it pointed `authSql` at `afldb_dev`, exposing persistent real/shared auth state — real admin rows were visible and staged rows were left behind in the development database rather than the test database.
2. **Arbitrary admin selection:** the test selected an admin with `WHERE role = 'super_admin' AND disabled_at IS NULL LIMIT 1` — no ordering, so the planner chose whichever row it found first. On a dev host with real admins that row was not the fixture.
3. **Fixed payload bytes:** the CSV content was a compile-time constant, so its `sha256` never changed between runs. `stageSubmission` deduplicates on `(dataset, content_sha256)` for submissions in `staged`/`validated` state. Any prior run that left such a row (because cleanup was absent) would cause subsequent runs to return the old submission ID via the duplicate branch instead of staging afresh.
4. **No cleanup:** the test had no cleanup implementation; staged `data_submissions` rows therefore persisted between runs. The repair introduced a test-local owner-level connection (`ownerSql`) that deletes only the exact submission IDs created by the current run.

### Fix
`tests/integration/email-intake.test.ts` only — no production files changed.

- **Database routing:** `process.env.AFLDB_AUTH_DATABASE_URL = process.env.AFLDB_TEST_DATABASE_URL` set unconditionally at module top-level, before any query. Safe because `authSql` is a Proxy whose `createClient()` reads the env var lazily on the first query — not at ESM import time.
- **Durable fixture admin:** `beforeAll` provisions the row `email-intake-test-fixture@afldb.test` (role `super_admin`) using `INSERT … ON CONFLICT (email) DO NOTHING` (the `email UNIQUE` constraint from migration 023 makes this concurrency-safe), then SELECTs it back with `AND role = 'super_admin' AND disabled_at IS NULL`. If the row exists but is not an enabled super-admin, `beforeAll` throws with an actionable message. The fixture is intentionally **retained** in the `_test` database between runs; deleting it in `afterAll` would race with concurrent invocations.
- **Per-run unique payloads:** `crypto.randomUUID()` is embedded in the CSV player-name field for each test that stages a submission. This guarantees a unique `content_sha256` on every run, preventing the global deduplication check from returning a prior run's submission. The resend test deliberately posts the **same** generated payload twice to keep the idempotency assertion real.
- **Exact-ID cleanup:** a module-level `runSubmissionIds: Set<number>` collects the `data_submissions.id` of every row created during the current run, registered immediately after each `POST` response and before any assertion that could throw. `afterAll` deletes only those exact IDs via a short-lived owner-level pool (`ownerSql` on `AFLDB_TEST_DATABASE_URL`), relying on the `ON DELETE CASCADE` to remove `data_submission_rows` automatically. The predicate is `id = ANY(ids::int[])` — never `uploaded_by` alone — so concurrent runs and prior-run residue are unaffected.

### Validation
Two consecutive focused runs on the Linux dev host (`streamanator`) against `afldb_test`, with no manual cleanup between runs:

**Run 1:**
```
Test Files  1 passed (1)
Tests       9 passed (9)
Skipped     0
```

**Run 2:**
```
Test Files  1 passed (1)
Tests       9 passed (9)
Skipped     0
```

Both runs exercised: unknown/disabled-admin rejection; real-admin CSV staging and validation end to end; identical resend/global deduplication behaviour; malformed, invalid-base64, and oversized-payload guards. The second consecutive clean run confirms the history-dependence defect is resolved.

Command: `npx vitest run tests/integration/email-intake.test.ts`

### Follow-up
None. No production files changed; no follow-up defect identified.

## AFLDB-ISSUE-076 — Grid Solver `won_final_at_venue` queries can hit statement timeout

- **Status:** Resolved
- **Severity:** Medium
- **Area:** Performance
- **Found:** 2026-08-22
- **Resolved:** 2026-08-28
- **Files:** `src/db/queries/grid-solver.ts`, `tests/integration/grid-solver.test.ts`, `AFLDB-ISSUE-076-CODEX-HANDOFF.md`

### Symptom
A valid `/grid-solver` grid can repeatedly crash during server rendering with Next.js digest `1511510695`.

### Reproduction
The failure was reproduced on development build `NQrtI3zQGWx62e6zbI5bR` with this grid:

Rows:

1. `games_at_multiple_clubs_min` — `games=50`, `clubs=2`
2. `teammate_of` — `player=12603`
3. `single_game_stat_min` — `stat=kicks`, `x=20`

Columns:

1. `played_for_club` — `club=103`
2. `played_for_club` — `club=108`
3. `won_final_at_venue` — `venue=234`

Order: `games_asc`.

### Expected
A supported Grid Solver criterion combination returns the matching players comfortably within the existing PostgreSQL application timeout, or fails gracefully without crashing the page.

### Actual
PostgreSQL repeatedly cancels the query at approximately the configured five-second statement timeout:

- 5,136 ms
- 5,107 ms
- 5,082 ms
- 5,057 ms

The server logs:

```text
PostgresError: canceling statement due to statement timeout
code: 57014
digest: 1511510695
```

At least one ordinary page request was traced as HTTP 500. Some RSC requests were traced as HTTP 200 despite the subsequent server-component exception, because the response had already begun streaming.

### Evidence
The same session produced repeated `/grid-solver` crash telemetry with digest `1511510695`. `journalctl -u afldb` correlated every digest occurrence with SQLSTATE `57014`.

The key discriminator is changing only the third column criterion:

- `won_final_at_venue(venue=234)` → repeated timeout/crash at ~5 seconds.
- `played_at_venue(venue=234)` → the otherwise identical grid completed successfully in approximately 360–397 ms.

This isolates the expensive path to the `won_final_at_venue` implementation or its interaction with the combined Grid Solver query shape rather than to Grid Solver generally.

### First wrong layer
Database query/compiler performance.

### Root cause
The `won_final_at_venue` compiler emitted player membership as `p.id IN (SELECT pms.player_id ...)`. Under the historical mixed Grid Solver workload, PostgreSQL underestimated the qualifying winner-player set and chose a surrounding plan that repeatedly scanned a materialised copy and discarded rows through a join filter. The equivalent `played_at_venue` control avoided that pathological shape, explaining its approximately 360–397 ms runtime.

The current plan still underestimates the winner-player set, but cardinality estimation itself was not the acceptance defect. The defect was allowing that underestimated set to determine a repeatedly scanned surrounding join shape.

### Fix
Changed only `won_final_at_venue` membership to `p.id = ANY (ARRAY(SELECT DISTINCT ...))`. PostgreSQL now builds the distinct qualifying winner-player IDs once as an InitPlan and reuses the scalar array. Exact semantics are preserved: the player participated at the requested venue, the match was a final, and `matches.winner_club_id` equals the player's `player_match_stats.club_id` for that match.

No statement-timeout increase, index, schema change or weakened predicate was used. Plan evidence did not justify an index.

### Validation
Validated through the dedicated verified SSH tunnel against authoritative `afldb_test` as `afldb_owner`, with the normal `AFLDB_STATEMENT_TIMEOUT_MS=5000` guard.

- The exact mapped historical concurrent 3x3 workload remains in `tests/integration/grid-solver.test.ts`, ordered by `games_asc` with a `< 4000 ms` safety assertion.
- Its final focused post-cleanup run passed in **380 ms** (whole run 679 ms; 1 passed / 129 skipped; no SQLSTATE `57014`).
- The regression independently reconstructs all three MCG `won_final_at_venue` cells from base relations: two qualifying 50-game organisation stints, Adam Cerra club-season teammates, and players with a 20-kick match, each intersected with actual winning-final participation at the MCG. It independently compares eligible counts and the first player under `player_career_stats.games ASC, players.sort_name` by id and display name. It does not call the Grid Solver compiler as its oracle.
- The actual captured production query for `single_game_stat_min(kicks,20)` x `won_final_at_venue(MCG venue 26)` used binds `$1=20`, `$2=26`. `EXPLAIN (ANALYZE, BUFFERS)` completed in **172.621 ms** after 1.195 ms planning, with 272,326 shared-buffer hits and 1,071 eligible rows.
- The winner-player set is `InitPlan 1`, `loops=1`: 9,629 qualifying participation rows become 3,007 distinct players through `Unique`, also at one loop. The estimate remains low (324 planned), but there is no winner-set `Materialize` node, repeated materialised scan, or massive rows-removed-by-join-filter pathology.
- Four complete Grid Solver integration-file runs kept the ISSUE-076 test green at **341 ms, 361 ms, 344 ms and 357 ms**. Each broader run passed 127/130 tests; the same three unrelated `won_a_final` / `never_won_a_final` predicates timed out at their own five-second boundary. Those separate compiler cases are untouched by this issue and were left unchanged rather than broadening ISSUE-076.

### Follow-up
None within ISSUE-076. The separately observed `won_a_final` / `never_won_a_final` timeouts are not part of this fix and must not cause the proven `won_final_at_venue` optimisation to be redesigned.


## AFLDB-ISSUE-075 — Confidence-scored suggestions for /admin/player-links

- **Status:** Resolved — calibrated, validated in the browser on dev, and one reversible real approval performed and restored
- **Severity:** Medium
- **Area:** Admin/Matching
- **Found:** 2026-08-22
- **Resolved:** 2026-08-22 (dev; not deployed to production)

### Symptom

Every unmatched source name on `/admin/player-links` had to be searched for by
hand. The queue holds 1,879 unresolved resolution entities (2,055 physical rows),
so a manual-only workflow made the backlog effectively permanent, while the page
already held enough evidence — name, season, club, draft totals — to identify
many of them deterministically.

### Files

- `src/lib/player-matching/{types,confidence,score-candidate,parse-career-span}.ts` (new)
- `src/db/queries/player-match-candidates.ts` (new)
- `src/db/migrations/067_player_link_match_candidates.sql` (new)
- `tools/matching/backtest.ts` (new)
- `src/db/queries/player-links.ts`, `src/app/admin/player-links/*`
- `tools/maintenance/privileges.sql`

### Approach

Deterministic and explainable; no LLM anywhere in the path. Candidate generation
(three index-backed lookups per source: exact normalised name, exact alias, a
bounded trigram neighbourhood) is separate from scoring, per migration 019's rule
that a name-similarity score is a candidate and never a link. Scoring is pure and
runs identically on the page, inside the approval transaction and in the offline
backtest, and pays at most one signal per evidence family.

### Evidence — what the data forced

The assumption that source rows carry a date of birth is false: **no** source
table has one, so the reachable score ceiling is name + club-in-season + era (97)
or name + draft timing + games + goals (97). Band thresholds were therefore set
from the measured score distribution rather than assumed.

The first backtest raised **617 hard conflicts, every one of them against a link
AFLDB had already confirmed**:

- `uniqueness_collision` 87/87 false — an already-linked row collided with
  itself; the row being assessed is now excluded from its own check.
- `club_not_in_history` 249/252 false — a draft pick names the club that DRAFTED
  the player, who may never have played a senior game for it. A club now
  contradicts only when the source places the player at that club in an AFLDB
  season.
- `season_outside_career` 99/108 false — all from `award_winners`: Magarey
  (SANFL), Sandover (WAFL), Liston (VFL), Morrish, U18 Championships and
  pre-1993 All-Australian carnival sides, where a player legitimately had no
  AFLDB season that year. Temporal evidence is now typed, and only
  `competitionScope: 'afldb'` seasons may contradict a career range.
- `reported_games_divergent` 200/202 false — removed entirely. Draft sources
  count their own way and migration 019 states the column is never a career
  statistic, so agreement is rewarded and disagreement is simply not evidence.

After calibration the same 9,356 rows raise **8 conflicts, none against a
correct link**.

### Validation

Backtest over 9,356 confirmed links (`npm run match:backtest`, algorithm `v1`,
commit `3f5b6e7`, read-only connection, no row mutated):

| Measure | Result |
|---|---|
| Candidate-generation recall | 9,341/9,356 (99.84%) |
| Top-1 / Top-3 / Top-5 | 99.69% / 99.83% / 99.84% |
| very_high | n=7,558, precision 99.99% |
| high | n=580, precision 100% |
| medium | n=627, precision 99.52% |
| low | n=557, precision 98.56% |
| Bulk-eligible | n=7,337, precision 99.99%, 1 false positive |

The single bulk-band false positive is `captaincies#3230`: the source names "Jobe
Watson" as Essendon's 2016 captain and AFLDB deliberately links it to Brendon
Goddard, who captained while Watson was suspended for the season. The matcher
cannot infer a human override that contradicts the name, and the class is
unreachable in production because approval only ever touches rows still in an
unresolved state.

Live-queue check (1,879 entities): 54 very_high, 11 high, 32 medium, 103 low,
1,679 none, 44 bulk-eligible. **All 44 bulk-eligible proposals were inspected by
hand and all 44 are correct** — overwhelmingly punctuation variants AFLDB stores
without the apostrophe (Gary O'Donnell → "Gary ODonnell", Massimo D'Ambrosio,
Cory Dell'Olio, Jay Kennedy-Harris), corroborated by club-in-season or by exact
draft games and goals.

Tests: 44 unit (`tests/player-matching.test.ts`), 24 mutation/contract
(`tests/player-link-mutations.test.ts`), 8 integration
(`tests/integration/player-matching.test.ts`) — 76 passing on the dev host.
Migration 067 applied to `afldb_dev` and `afldb_test`; privileges reconciled and
verified (`afldb_app` SELECT, `afldb_auth` full DML, `afldb_import` no read).

### Source-specific bulk policy

Aggregate bulk precision of 99.99% read as safe and was not: the whole of the
error sat in one source class. Measured per logical source over the same 9,356
confirmed links (draft counted at `draft_person` grain, never per pick):

| Source | n | recall | top-1 | very_high | vh prec | vh FP | bulk | bulk prec | bulk FP | conflicts |
|---|---|---|---|---|---|---|---|---|---|---|
| `award_winners` | 3,088 | 100% | 99.90% | 2,750 | 100% | 0 | 2,750 | 100% | 0 | 0 |
| `draft_person` | 3,464 | 100% | 99.94% | 2,540 | 100% | 0 | 2,319 | 100% | 0 | 0 |
| `award_nominations` | 766 | 99.61% | 99.48% | 702 | 100% | 0 | 702 | 100% | 0 | 1 |
| `player_achievements` | 334 | 99.70% | 99.70% | 253 | 100% | 0 | 253 | 100% | 0 | 0 |
| `captaincies` | 1,375 | 99.27% | 99.05% | 1,313 | 99.92% | 1 | **0** | n/a | 0 | 7 |
| `hall_of_fame` | 240 | 99.58% | 98.33% | 0 | n/a | 0 | 0 | n/a | 0 | 0 |
| `honour_team_members` | 89 | 100% | 97.75% | 0 | n/a | 0 | 0 | n/a | 0 | 0 |

`captaincies` is excluded from unattended approval, and not merely because it
held the single failure. A club's recorded captain for a season and the player
who actually led the side can legitimately differ — suspension, injury, a
mid-season handover, a co-captaincy — so the source name and the correct link
disagree **by design**. That is a class-level false-positive mechanism, not one
unlucky row, and the class also carries 7 of the 8 hard conflicts raised across
the whole backtest. Those rows still appear as `very_high` suggestions with full
evidence and may be approved individually; they may not pass unattended.

`hall_of_fame` and `honour_team_members` are excluded for the opposite reason:
carrying only name and career-span evidence they never reach the band, so they
have **no measured bulk population at all**. No failures out of no rows is not
evidence of safety.

With the gate applied: **bulk-eligible 6,024, precision 100.00%, zero false
positives**, `very_high` unchanged at 7,558/99.99%. Scoring weights and band
thresholds were NOT altered to achieve this — top-1 remains 99.69%.

### The Jobe Watson class, and why bulk survives it

`captaincies#3230` names Jobe Watson as Essendon's 2016 captain; AFLDB
deliberately links Brendon Goddard, who led the side while Watson was suspended
for the season. It scores 97 with a gap of 82, and nothing available to the
matcher separates it from a correct row. It is a human/editorial override that
contradicts the literal source identity, and an unresolved record could carry
the same class of correction. Rather than dismiss it as already-resolved, the
whole source class it belongs to is barred from bulk approval.

### Calibration lesson

> Hard-conflict rules must only compare evidence that is known to represent the
> same identity, competition and temporal semantics.

The first backtest raised **617 hard conflicts, every one against a link AFLDB
had already confirmed**; after typing the evidence by competition and context the
same population raises **8, none against a correct link**. Every one of those 617
came from comparing two things that were never the same kind of fact: a row
against itself, a drafting club against a playing history, a WAFL season against
a VFL career, an external source's own games count against AFLDB's.

The same rule later ADDED a conflict rather than removing one. A Hall of Fame
entry states a career span outright; when that span shares no season with a
career AFLDB records in full, the two are different footballers. Verified
against all 228 confirmed Hall of Fame links with a stated span before being
trusted — 0 would be contradicted — and it now contradicts 16 live queue rows,
including Bill Walker of Swan Districts (1961-1976) being offered against Bill
Walker of Fitzroy (1903-1914).

### Safety model

The cache is advice, never authority. Approving a suggestion locks the target,
confirms it is still unresolved, re-reads the source and candidate evidence and
**runs the scorer again inside the same import transaction**, requiring the fresh
result to still name that player with no contradiction. A score posted by the
browser is never read. Bulk approval re-checks eligibility per row while holding
that row's lock, and one row's failure neither aborts the batch nor affects
another row.

### Follow-up

- Not deployed to production. This work is dev-only.
- Bulk approval is available for four source classes; `captaincies` remains
  suggestion-only. Revisit only with new measured evidence, not intuition.
- 5 queue entities generate no candidate, and 15 confirmed links have their true
  player outside the candidate set: nickname variants (Robert → Bob Nash,
  William → Bill Thomas, John → Ivor Lawson). An alias-backed nickname table
  would recover them; deliberately not guessed at here.
- AFLDB stores many surnames without their apostrophe. Matching is unaffected
  because normalisation strips it from both sides, but those display names are
  wrong on public pages and deserve a separate data fix.

## AFLDB-ISSUE-077 — Frontend theme changes unpredictably during a user session

- **Status:** Resolved
- **Severity:** Medium
- **Area:** UI/Settings
- **Found:** 2026-08-22
- **Resolved:** 2026-08-26
- **Files:** `src/db/queries/site-settings.ts`, `src/app/layout.tsx`, theme/layout components and any client-side theme initialisation/storage code

### Symptom
A super admin can select one of the available frontend themes, but the chosen theme does not remain visually consistent while a user browses the site. One page can render with the selected theme, then following an ordinary internal link can cause the next page to render with a different theme.

### Reproduction
1. As a super admin, select and save a frontend theme.
2. Open the public site and confirm the selected theme is visible.
3. Navigate between normal internal pages using the site links.
4. Continue through several pages in the same browser session.
5. Observe that the active theme can change between page loads/navigation events without the super admin changing the setting.

### Expected
The saved super-admin theme is the authoritative frontend theme. Once selected, every public page and navigation in that session should render the same theme until the setting is deliberately changed by a super admin. Server-rendered HTML, hydration and client navigation must agree on the same value.

### Actual
Theme presentation is inconsistent within a single browsing session. Different pages can use different themes, making the site appear to switch templates as the user navigates.

### Evidence
Observed manually during normal navigation after enabling the themeable frontend. The existing open ISSUE-072 confirms `frontendTheme` is part of the site-settings model, but that issue is limited to a stale test expectation and does not explain this runtime switching behaviour.

### First wrong layer
UI/settings state propagation or cache consistency.

### Root cause
The frontend theme is evaluated during SSR/SSG from the global settings and embedded in the HTML `data-site-theme` attribute via `layout.tsx`. When a super-admin saved settings, only four specific paths (`/`, `/aflw`, `/search`, `/admin/settings`) were revalidated. Other statically generated pages (like `/records`) continued serving the old cached root layout and its stale theme string. On client-side navigation between a revalidated page and a stale page, the Next.js router patches the `<html>` tags with the respective layout's payload, causing the theme to flip unexpectedly without any concurrent settings changes.

### Fix
Changed the cache revalidation in `saveSiteSettings` to `revalidatePath('/', 'layout')`. This invalidates the entire static cache boundary for the root layout (the whole site) in one operation, guaranteeing that all pages resolve the same new theme on their next render. The authoritative theme value remains the persisted database setting.

### Validation
Added a unit test in `tests/admin-settings-actions.test.ts` verifying that `saveSiteSettings` issues the exact `revalidatePath('/', 'layout')` call to purge the site-wide layout cache.

Final regression validation successfully executed by the user:
- command:
  npm.cmd test -- --run tests/admin-settings-actions.test.ts
- 1 test file passed
- 1/1 test passed
- proves saveSiteSettings invalidates the root layout using:
  revalidatePath('/', 'layout')

### Follow-up
None.

## AFLDB-ISSUE-078 — Draft and first-kick-goal reloads still discard manual player links

- **Status:** Resolved
- **Severity:** High
- **Area:** Import
- **Found:** 2026-08-22
- **Resolved:** 2026-08-22
- **Files:** `tools/migration/import_draft.py`, `tools/migration/common.py`,
  `src/db/migrations/069_draft_source_identity.sql`,
  `tests/integration/draft-reload-links.test.ts`,
  `tests/integration/draft-lock.ts`, `tests/integration/release-gates.test.ts`,
  `tools/records/import-first-kick-goal.ts`,
  `data/records/first-kick-goal-ids.csv` (new, tracked), `.gitignore`,
  `src/db/migrations/070_import_reads_link_suggestions.sql`,
  `tools/maintenance/privileges.sql`,
  `tests/integration/first-kick-goal-reload-links.test.ts`,
  `src/db/queries/player-links.ts`, `src/db/queries/players.ts`,
  `src/db/migrations/019_draft_persons.sql`, `src/db/migrations/006_draft_relationships.sql`.
  Upstream source generator (outside this repository, read-only):
  `sports_data_lab/utils/afl/load_draftguru.py`, `sports_data_lab/afl/link_draft.py`.

### Symptom
Reloading the draft or the first-kick-goal record turns manually resolved
`draft_picks` / `player_achievements` links back into their import-derived
state, and leaves the matching `player_link_resolutions` rows pointing at ids
that no longer exist. The draft reload additionally deletes admin-created
`draft_picks` rows outright.

### Reproduction
Resolve an unresolved draft pick or first-kick-goal row through
`/admin/player-links`, then rerun the corresponding importer and inspect the
rebuilt row.

### Expected
Append-only human identity decisions remain authoritative across repeatable
source reloads, and their audit targets keep resolving to the row the decision
was about — the guarantee `AFLDB-ISSUE-044` established for the honours family.
A row the importer does not own is neither updated nor deleted by it.

### Actual
Both loaders destroy and recreate their targets:

- `tools/migration/import_draft.py:241` — `truncate(pg, "draft_picks", "draft_persons")`
- `tools/records/import-first-kick-goal.ts:480` — `DELETE FROM player_achievements WHERE achievement_type = 'first_kick_goal'`

`draft_picks` and `player_achievements` are both in `LINK_TARGET_TABLES`
(`src/db/queries/player-links.ts`), so both accept manual resolutions.

`draft_picks` is the more serious of the two: `applyLockedLink` resolves a draft
pick through its `draft_person_id` and propagates the link to every pick of that
person, so one lost decision can unlink several rows.

### Evidence
Found by inspection while fixing `AFLDB-ISSUE-044`; the mechanism is identical
to the one reproduced there against `afldb_test` (manual link lost, row id
regenerated, `player_link_resolutions.target_id` left dangling because the
loaders never `RESTART IDENTITY` and so never reuse an id).

**Database-backed reproduction, `afldb_test`, 2026-08-22 (draft).**
`tests/integration/draft-reload-links.test.ts` was written first and run
against the unmodified importer: **7 of 7 failed**, one per predicted defect —
the id fingerprints of both tables changed, the resolved link and its person
reverted to source state, the confirmed-unlinked decision's target no longer
existed, the source disagreement was not reported, a renamed row did not fail
closed, contradictory decisions were not detected, and the admin-created pick
came back `undefined` (deleted outright).

Repeated reloads had already advanced `draft_picks` to ids **88,532-95,341**
and `draft_persons` to **65,788-70,844** for the same 6,810 and 5,057 rows —
ids advance monotonically and are never reused, so as in `AFLDB-ISSUE-044` the
harm is a lost link plus an unresolvable audit pointer, **not** a decision
transferred to another person's row.

#### Draft source-identity investigation, 2026-08-22

Read-only investigation of the upstream generator, the legacy SQLite and both
`afldb_test` and `afldb_dev`. Nothing was written.

**The candidate six-column reload key
`(source_id, dg_person_id, draft_year, draft_type, draft_kind, pick_number)` is
REJECTED.** It is unique across all 6,810 rows on both sides, but uniqueness is
not durability:

| Column | Durable identity? | Evidence |
|---|---|---|
| `source_id` | Yes | AFLDB constant, resolved from `sources` at runtime (`import_draft.py:133`) |
| `dg_person_id` | **No — fatal** | `load_draftguru.py:355` assigns `p.index + 1` over a person frame sorted by `player_url` and de-duplicated. It is a **rank recomputed on every load**, not DraftGuru's id. Observed: ids 1, 2, 3 are `aaron_black/1`, `aaron_black/2`, `aaron_bruce/1`. The frame spans draft **plus awards plus all-Australian** rows (5,320 people vs 5,057 draft people), so a new award row renumbers draft persons |
| `draft_year` | Yes | `source_url` corresponds 1:1 with `draft_year` (42 pages, 42 years, 42 combinations): the year *is* the scraped page |
| `draft_type` | Partly | DraftGuru's own wording; 11 values and already inconsistent — `National` x2976 vs `National Draft` x113 (1981/1982/1987 only, the pages with no Draft column, where the scraper metadata label is the fallback). A re-wording is a correction, not a new selection |
| `draft_kind` | Partly | Derived — `draft_type.map(draft_kind)` from `afl/draft_kinds.py`. Insulated from wording changes (it already folds both spellings to `national`) but movable by reclassification; an unmapped wording yields NULL via pandas `.map` |
| `pick_number` | **No** | `first_int(pick)`; NULL for trades, free agency and signings, and a corrected pick number is the textbook "same selection, corrected fact" |

`import_draft.py:17` claims identity "hangs off draft_persons, keyed on
DraftGuru's own person id". **That claim is false** and the docstring must be
corrected.

**The current `source_record_id` is rejected on the same grounds.** It holds
`str(draft_rowid)`; the legacy `draft` table has no `INTEGER PRIMARY KEY` and
`load_draftguru.py:418` writes it with `to_sql(..., if_exists="replace")`, so
every rowid is reissued on every source rebuild. Upstream already treats it as
snapshot-local: `link_draft.py:289` drops and rebuilds `draft_links` (keyed
`draft_rowid INTEGER PRIMARY KEY`) on every run.

**The durable identity that does exist is `player_url`** — DraftGuru's own
person page, e.g. `https://www.draftguru.com.au/players/aaron_black/2`, whose
trailing ordinal disambiguates same-name people. It is `build_people`'s own
`person_key`, of which `dg_person_id` is merely the rank. Present on 6,810/6,810
source rows and 5,320/5,320 people, and **already stored** as
`draft_persons.player_url` (NOT NULL) and `draft_picks.player_url`, so no new
column, no re-key migration and no raw data are required.

Verified reconciliation keys (0 duplicates, 0 relevant NULLs, both databases and
the source):

- `draft_persons` — `(source_id, player_url)`, unique over 5,057 rows
- `draft_picks` — `(source_id, player_url, draft_year, draft_kind)`, unique over
  6,810 rows in PostgreSQL and 6,810 rows in the source

`(player_url, draft_year)` alone leaves **23** duplicate groups —
`Pre-Draft + Trade` x13, `National + Pre-Season` x4, `National + Rookie` x2, and
one each of `Rookie + Trade`, `Mid-Season + Trade`, `Mid-Season + Pre-Season`,
`Mid-Season + National`. Those are genuinely different selections for the same
person in the same year, so the selection-type component is load-bearing.
`draft_kind` is preferred over `draft_type` because a source re-wording is the
likelier change and `draft_kind` already absorbs the one that exists; an
incoming NULL `draft_kind` must abort the reload rather than key on NULL.

#### Ownership scope

Both draft reloads currently treat the whole table as their dataset.
`createPlayerInTransaction` (`src/db/queries/players.ts:390-411`) inserts
admin-created `draft_picks` with `source_id` NULL, no `source_record_id` and no
`draft_person_id`, so every reload destroys them silently. Because they have no
`draft_person_id`, `lockUnresolvedTarget` throws for them and they can **never**
carry a link decision — the manual-decision guard is structurally incapable of
protecting them, and only source scoping can. This is the same ownership defect
as `AFLDB-ISSUE-080` on a different table, and is fixed as part of this issue.

The importer-owned scope is `source_id = <draftguru>`; admin rows
(`source_id IS NULL`) must be outside UPDATE, INSERT and DELETE.

#### `draft_persons` lifecycle

- Exactly one foreign key points at `draft_persons.id`:
  `draft_picks.draft_person_id`, with **no `ON DELETE`** clause (NO ACTION).
  Nothing references `draft_picks.id` or `player_achievements.id` by FK.
- Durable non-FK references do exist:
  `player_link_match_candidates(resolution_entity_type = 'draft_person', id)` —
  **2,304 rows on `afldb_dev`** — and `data_issues(entity_type = 'draft_person')`.
- `draft_persons` carries the applied human link (`applyLockedLink` writes
  `player_id`, `link_status`, `is_matching_backlog`) and has no
  `source_record_id`, `import_batch_id` or `imported_at`.
- **It therefore cannot remain rebuildable.** Reconciling only `draft_picks`
  while rebuilding `draft_persons` breaks the relationship: the FK is NO ACTION,
  so the delete fails, and `TRUNCATE ... CASCADE` empties the picks with it.
- No non-DraftGuru `draft_persons` row can exist today (`source_id` NOT NULL,
  one distinct value, importer-only inserts), but the reload should be scoped by
  construction anyway.
- Delete ordering under the NO ACTION FK: reload persons **without** deletes,
  reload picks fully, then delete persons left with no pick. That last set is
  exactly the vanished persons, because a person exists only where a pick
  references them.
- The importer already concedes (lines 336-343) that it clears only *unresolved*
  `data_issues` because the reload orphans the ids, so adjudicated draft-person
  issues are dangling by design. Id preservation removes the cause.
  `afldb_dev` currently holds 100 open and 0 resolved, so this is latent.

#### Decision grain

`player_link_resolutions` records `target_table = 'draft_picks'` and
`target_id = <one pick id>`, but `applyLockedLink` writes `draft_persons` and
**every pick of that person**. The audit target is row-grained; the decision is
person-grained, and must be normalised through `draft_person_id` to `player_url`
before a reload can honour it. A `confirmed_unlinked` decision therefore has to
be replayed person-grained as well, or a sibling pick would take a source link
the admin has already rejected.

**Conflicting-decision failure mode.** `confirmUnlinked`
(`src/db/queries/player-links.ts:489`) takes no lock, does not re-read the
target and runs on `authSql` rather than the import transaction, so a stale form
can record `confirmed_unlinked` against a pick whose person was linked moments
earlier. One person can consequently hold contradictory operative decisions. A
reload must **abort before mutation** and report both rather than pick a winner
by `created_at`.

#### First-kick-goal source-identity investigation, 2026-08-22

**There is no upstream generator to trace.** `data/records/first-kick-goal.csv`
is **untracked and gitignored** (`.gitignore /data/*`) — a hand-curated extract
of a Wikipedia table with four columns (`Player,Club,Rd.,Year`) and no
identifier of any kind. "Regenerating the source" means a person re-extracting
it, so row order, the `[8]`-style citation markers, the mojibake dagger and the
legend glyphs are all volatile.

**Every content-derived key was rejected, including the one first shipped.**
An interim fix reconciled on `player_name_clean`, which is unique (334/334 on
both sides) — but the final review established that uniqueness is not
durability, and the clean name fails as identity:

- the `Setanta Ã hAilpÃ­n` mojibake row is **guaranteed** to change on any
  correctly decoded re-extract;
- `MANUAL_NAME_OVERRIDES` carries 8 spelling divergences and its own comment
  anticipates the source being corrected;
- the clean name is derived by `splitPlayerName()`, so changing the legend
  handling also moves it;
- no alternative content key is even unique: `(season, club, round)` has 5
  duplicate groups, `(season, round)` 34, `(season, club)` 48.

An undecided row would churn its surrogate id on a legitimate correction,
silently orphaning the reader suggestions, match candidates and adjudicated
`data_issues` that name it without a foreign key. The issue was therefore
**reopened** rather than documenting that as a limitation.

The old `source_record_id` (`"{season}|{round}|{playerNameRaw}"`) was rejected
on the same grounds — three mutable facts, one carrying the legend markers.

#### The tracked identity manifest

Identity is **assigned, not derived**: `data/records/first-kick-goal-ids.csv`,
committed to git via the same `.gitignore` opt-in pattern as
`data/awards/22-under-22.csv` (whose first column is likewise an explicit
stable record id feeding `source_record_id`). The raw extract stays ignored;
the manifest is the durable artifact:

```csv
Id,Player,Club,Rd.,Year,Status
fkg-001,Jack Kirby,Essendon,11,1911,active
```

`Id` is opaque and sequential — deliberately not row position, a content hash,
the cleaned name, a `player_id` or a season/round/club tuple. `Player` is the
join key to the extract's clean name; `Club`/`Rd.`/`Year` are curator context.
`Status=retired` reserves a number permanently: it counts toward
max-ever-issued and is never reissued. The invariant:

```text
new logical fact      -> next number above max-ever-issued
existing logical fact -> same number forever
retired fact          -> reserved permanently, never reissued
```

**The core allocation rule:** the extract has no identifier, so an unmatched
extract name can never be classified as new while an active manifest row is
also unmatched — that pair is more likely one spelling correction. Any
unmatched active manifest row aborts the run and `--assign-ids` alike, with
both unmatched sets printed for curator classification (rename → edit the
manifest `Player`, keep the id; removal → `Status=retired`; only then may
genuinely additional rows be allocated). This is what prevents
`rename → accidental new id` and `remove one + add one → identity
reassignment`.

#### First-kick-goal ownership

The importer owns `achievement_type = 'first_kick_goal'` **and**
`source_id = <wikipedia_first_kick_goal>`. The original
`DELETE ... WHERE achievement_type = 'first_kick_goal'` was type-scoped but not
source-scoped, and **destroying a row owned by another source was reproduced**:
a `manual_admin_edit`-sourced fixture was deleted outright by the unmodified
importer. There is no admin INSERT or UPDATE path for `player_achievements`
today (the only non-importer write is the cascade `DELETE ... WHERE match_id`
in `src/db/queries/match-admin.ts:381`), but the scope is bound by both columns
because the type is meant to grow — the assumption AFLDB-ISSUE-080 records the
honours loaders making. `player_achievement_type` has exactly one enum value,
so the regression asserts that cardinality and the second-type case is added
the day one lands.

#### First-kick-goal reproduction, `afldb_test`, 2026-08-22

The original destructive defect was reproduced before any fix: the integration
suite failed 6 of 6 against the unmodified importer, ids moved from **1-334**
to **2674-3007** over repeated reloads (monotonic, never reused — the harm is a
lost link plus an unresolvable audit pointer, not a decision transferred to
another person's row), and the foreign-source fixture was deleted.

#### Final independent review, 2026-08-22 — two bounded defects found and fixed

The implementation was reviewed against the code rather than this ledger. Every
claimed invariant held except two, both in the retirement path, both corrected
and re-validated.

**1. A grant gap the test harness structurally could not catch.** The retirement
preflight read `player_link_suggestions` and `player_link_match_candidates`.
`afldb_import` held **no privilege of any kind** on either table, so the first
retirement in production would have aborted on `permission denied` instead of
the intended report. Every test passed because the suite connects as
`afldb_owner` — the importer had never once been exercised under its own role.

Fixed two ways: `player_link_match_candidates` was dropped from the preflight
entirely (it is advisory and self-limiting — see the classification below), and
migration `070_import_reads_link_suggestions.sql` grants `afldb_import` SELECT
(only) on `player_link_suggestions`, mirrored in `tools/maintenance/privileges.sql`
whose import revoke loop would otherwise strip it. Exactly the shape migration
068 established. Proven by running the importer **as `afldb_import`** against
`afldb_test`: a referenced retirement now reports
`fkg-050 "Graham Croft" (db id 2723) still has 1 reader suggestions; rerun with
--accept-retirement fkg-050`, and the acknowledged run reports
`fkg-050 retired: row 2723 deleted; ACKNOWLEDGED durable references left behind`.
A new regression asserts the import role's grants directly, so the class cannot
recur silently.

**2. `--accept-retirement` authorised the delete but cleaned nothing.** The
refile of the importer's own `data_issues` is scoped to the *surviving* ids, so a
retired row's own unresolved issues outlived the row they described. They are now
deleted with it. Adjudicated issues are still preserved deliberately — that is
what the gate exists for.

**Every non-FK reference to `player_achievements.id`, classified.** (`data_edits`
does not apply: `player_achievements` is absent from migration 058's
`table_name` allowlist.)

| Reference | Class | On retirement |
|---|---|---|
| `player_link_resolutions` | **Durable**, append-only by grant — it cannot be cleaned by anyone | Fail closed; only `--allow-link-loss` proceeds, and the dangling audit row is the `AFLDB-ISSUE-079` class |
| `player_link_suggestions` | **Durable.** Orphans *are* surfaced: `/admin/player-links` renders every open tip unjoined, so a stranded one sits in that queue forever and can never be approved | Fail closed; `--accept-retirement <id>` proceeds and **reports what it strands** |
| `data_issues`, adjudicated | **Durable** — deliberately preserved history | Fail closed; same acknowledgement |
| `data_issues`, unresolved | **Disposable** — the importer files and refiles them each run | Deleted with the row, in the same transaction |
| `player_link_match_candidates` | **Disposable and self-limiting** — every read is keyed by the entity ids on the page, so an orphan is never fetched, and approval rescores from source data | Not read, not cleaned, and deliberately outside the import role's privileges |

Migration 056's comment calling a dead `target_id` "a harmless unsurfaced row"
is accurate for the per-row lookup it describes and **not** for the standalone
suggestions panel; that discrepancy is why the suggestion gate is fail-closed
rather than advisory.

**A stale test assertion was also found and corrected** — it still expected the
pre-review message wording, and would have passed for the wrong reason.

**Verified in the review, from code and tests rather than the ledger:**
`fkg-NNN` is persisted in the tracked manifest and never regenerated after
bootstrap; an unmatched active manifest row blocks all allocation (proven by
`--assign-ids` refusing and leaving the manifest byte-identical); retired ids
count toward max-ever-issued and are never reused (335 retired → next is 336);
`(source_id, source_record_id)` is the reconciliation key and
`player_achievements_source_uq` enforces it; `--rekey` preserves every
surrogate id, is retry-safe and fails closed on mixed/ambiguous states;
undecided spelling corrections update in place; decided renames abort until
that exact id is acknowledged, and acknowledgement preserves both row id and
decision; unknown/duplicate/irrelevant acknowledgements fail; no `::int`
narrowing remains and the bigint representation is pinned by a regression;
every abort precedes the first target mutation; and the forced late-FK failure
genuinely rolls back both the early DELETE and the `import_batches` insert.

### First wrong layer
Import/ETL — which rows the loader treats as its own, and what it treats as
durable identity.

### Root cause
Confirmed for the draft loader: it rebuilds `draft_picks` and `draft_persons`
from a source that has **no stable row identifier at all** (both the SQLite
rowid and `dg_person_id` are regenerated on every upstream load), and it treats
the reconstructed source rows as the whole identity state. The surrogate ids the
audit trail, the suggestion cache and the issue history depend on are therefore
reissued on every run, and rows the importer does not own are destroyed with
them.

Not yet confirmed for `import-first-kick-goal.ts`; presumed identical to
`AFLDB-ISSUE-044`.

### Fix
Both halves fixed, 2026-08-22.

#### First-kick-goal
`tools/records/import-first-kick-goal.ts` reconciles on
`(source_id, source_record_id)` where `source_record_id` is the manifest's
`fkg-NNN` — enforced by the existing `player_achievements_source_uq`, so no
migration and no privilege change were needed. In one transaction, in this
order: manifest/extract bijection (settled before the database is even
opened); duplicate incoming ids; legacy/mixed `source_record_id` format guard;
unknown stored ids; decisions read and classified; decided renames and at-risk
retirements checked against their acknowledgements; **then** the first target
write — delete retired ids, update matched ids in place, insert new ids,
replay human decisions, refile scoped `data_issues`.

New modes and flags, all fail-closed:

- `--assign-ids` — bootstrap the manifest (one-time positional assignment,
  acceptable only because no prior identity exists), or allocate ids for
  genuinely new rows strictly above max-ever-issued once every active row
  maps 1:1. Never rewrites an allocation, never reuses a retired number, no-op
  on unchanged inputs, aborts allocating **nothing** while any active row is
  unmatched.
- `--rekey` — the one-time database transition from the legacy
  `source_record_id` format, bridged by the current clean names. Prints the
  preflight report (active manifest rows / owned rows / exact 1:1 mappings /
  unmatched manifest / unmatched database / ambiguous — 334/334/334/0/0/0 on
  the real transition) and writes only on an exact bijection. Retry-safe:
  all-legacy → rekey in place; all-stable → verify and report "already
  rekeyed"; a mixture → abort. It writes `source_record_id` and nothing else.
- Renames: same `fkg-NNN`, changed name = the same achievement with corrected
  descriptive data. An undecided row updates in place (reported); a decided
  row aborts until the per-record `--accept-rename fkg-NNN`, which keeps the
  row, the surrogate id **and** the decision. Deliberately not
  `--allow-link-loss`: accepting a spelling fix must never cost a decision.
  Acknowledgements are validated against renames actually detected in that
  run — unknown ids, non-renaming ids and duplicate arguments all fail.
- Retirements: `Status=retired` means the source fact went away, never
  "delete regardless of application history". A retiring row still carrying
  adjudicated `data_issues`, suggestions or match candidates aborts until
  `--accept-retirement fkg-NNN`; one carrying a link decision is a decision
  loss and additionally requires `--allow-link-loss`.
- `AFLDB_FIRST_KICK_GOAL_CSV` / `AFLDB_FIRST_KICK_GOAL_MANIFEST` point a run
  at candidate copies, which is how the tests avoid touching the real files.

**Deployment order for the transition:** freeze the current extract →
bootstrap and commit the manifest → deploy importer + manifest → run
`--rekey` on each target database **before** any source correction → only
then permit ordinary re-extracts. If the source changes first, the bridge
fails closed.

**A postgres.js trap found and corrected during review:**
`player_link_resolutions.target_id` is `bigint`, and postgres.js returns int8
as a **string**. The decision lookup was number-keyed, so every decision was
read and silently dropped — the source simply won. An interim fix cast
`target_id::int`; the final review rejected that as an unguarded narrowing of
a bigint identity, and the lookup now keeps the driver's representation and
keys both sides through `String(...)`, correct whichever representation
arrives. The Python loaders are unaffected: psycopg returns an int.

#### Draft

Migration `069_draft_source_identity.sql` establishes the importer-owned
identity and fails closed on existing duplicates:

- `UNIQUE (source_id, player_url)` on `draft_persons`;
- `UNIQUE NULLS NOT DISTINCT (source_id, player_url, draft_year, draft_kind)
  WHERE source_id IS NOT NULL` on `draft_picks` — partial, so admin-created
  rows stay outside the importer's identity space and two admins can still
  create players drafted at the same year and pick;
- `draft_persons`'s existing `UNIQUE (source_id, dg_person_id)` re-declared
  `DEFERRABLE INITIALLY IMMEDIATE`. It is not dropped — dg_person_id is still
  stored and quoted — but a reload PERMUTES it once the source renumbers, and a
  bulk UPDATE fails row by row against a non-deferrable unique constraint. The
  importer defers it inside its own transaction; ordinary writes are unaffected.

`tools/migration/import_draft.py` no longer truncates. It now:

- reconciles `draft_persons` on `(source_id, player_url)` with
  `delete_missing=False`, then `draft_picks` on `(source_id, player_url,
  draft_year, draft_kind)`, then deletes the childless people the source
  dropped — the only order a NO ACTION foreign key permits, and the vanished
  set exactly, since a person exists only where a pick references them;
- scopes every statement to `source_id = draftguru`, so admin-created picks are
  outside UPDATE, INSERT and DELETE alike;
- classifies every human decision **before the first write**, normalising each
  from the pick the audit row names to its `player_url`;
- replays survivors person-grained, exactly as `applyLockedLink` writes them:
  the `draft_person` and every pick belonging to it. A `linked` decision
  restores the admin's player and `resolved`; a `confirmed_unlinked` decision
  keeps the person and all its picks unlinked even when the source now supplies
  a link. Either disagreement is reported by person, name and both player ids;
- aborts before mutation when a decision cannot be carried — the source dropped
  the person, dropped the key, or renamed the row under it — with
  `--allow-link-loss` as the deliberate escape hatch that itemises what it
  discards;
- aborts **unconditionally** when two picks of one person carry contradictory
  operative decisions. `--allow-link-loss` deliberately does not apply: there is
  no safe decision to keep, and identity is person-grained;
- refuses to run at all if the source supplies a row with no `player_url` or no
  `draft_kind` — a NULL kind means the upstream `draft_kinds.py` mapping does
  not know a new wording yet, and keying on NULL would silently merge rows;
- drops its intermediate `pg.commit()` calls, so one rollback undoes the run;
- files its `data_issues` after the decision replay, so a person an admin has
  just adjudicated is no longer reported as matching backlog.

`tools/migration/common.py` gained one parameter, `delete_missing`, for the
parent/child delete ordering. Nothing existing was weakened.

### Validation
All database work ran against `afldb_test` on the dev host; production, the
read-only legacy SQLite and the raw/curated source datasets were untouched.

#### First-kick-goal
- Original destructive defect reproduced first (6/6 failures, id churn
  1-334 → 2674-3007, foreign-source row destroyed), as recorded above.
- The rewritten `tests/integration/first-kick-goal-reload-links.test.ts` —
  **13/13 pass** on the dev host against `afldb_test`, over temp copies of
  both files (the tracked manifest and curated extract are never modified):
  1. `--rekey` in place, retry-safely — the 334/334/334/0/0/0 preflight
     report, id fingerprint byte-identical, every owned row stable-keyed,
     second run "already rekeyed" writes nothing, a seeded mixture aborts;
  2. resolved link survives with its row id; the admin beats a contradicting
     source and the disagreement is reported; audit target live;
  3. confirmed-unlinked survives with its audit target live;
  4. **a source-side spelling correction keeps the row id** (why the issue
     was reopened): the corrected extract first aborts with both unmatched
     sets printed and nothing allocated (`--assign-ids` refuses too), then
     the curator's manifest edit keeps `fkg-NNN` and the reload updates the
     same row in place;
  5. corrected club, round and season under one stable id keep the same row;
  6. a decided rename aborts listing id, both names and the decision; an
     unknown acknowledgement fails; `--accept-rename` updates the same row
     and keeps the decision;
  7. allocation: a new row is blocked until `--assign-ids`, which allocates
     `fkg-335` only, no-ops on repeat, and after retiring 335 the next
     allocation is `fkg-336` — never a reuse;
  8. a referenced retirement aborts until `--accept-retirement`; an
     un-retired fact returns as a new row under the same stable id;
  9. a decided retirement is a decision loss gated by `--allow-link-loss`;
  10. a foreign-source `first_kick_goal` row survives untouched;
  11. rollback: one safe retirement plus one new row violating
      `player_achievements_season_fkey` — the early DELETE rolls back with
      the transaction, the row survives at its original id, and **no
      `import_batches` row survives** (architecture, not a defect: the batch
      row is created inside the same transaction, unlike the Python loaders
      which commit theirs first and mark it `failed`);
  12. `target_id` is `bigint` and the driver returns it as a JavaScript
      string — the representation is pinned so the lookup mismatch cannot
      silently return;
  13. two further reloads change no row id and stack no duplicate
      `data_issues`.
- A reload against the **real** tracked manifest (no env overrides):
  `334 updated, 0 inserted, 0 deleted`, fingerprint byte-identical — the
  committed manifest matches the deterministic bootstrap exactly.

#### Draft

- Migration 069 applied to `afldb_test` in 217 ms — both unique indexes built
  over the live 6,810/5,057 rows without a duplicate, which is the fail-closed
  proof on real data. No new grants, so `privileges.sql` is unchanged.
- Defect reproduced first: 7/7 of the new suite failed against the unmodified
  importer, as tabulated under Evidence.
- After the fix a full reload reports `draft_persons: 5,057 updated, 0 inserted,
  0 deleted` and `draft_picks: 6,810 updated, 0 inserted, 0 deleted`, with the
  `md5(string_agg(id))` fingerprint of both tables **byte-identical** before and
  after, and the same 3,459 linked / 100 backlog / 1,498 never-played counts the
  release gate asserts.
- `tests/integration/draft-reload-links.test.ts` — **7/7 pass**: resolved link
  survives on every pick of the person with every row id intact;
  confirmed-unlinked survives person-grained with its audit target still live;
  the admin's link wins over a contradicting source and the disagreement is
  reported; a renamed row aborts with exit 1 and writes nothing, then
  `--allow-link-loss` proceeds and itemises; contradictory person decisions
  abort before mutation; an admin-created pick survives unchanged **with no
  decision of its own**; two further reloads change no row id and stack no
  duplicate `data_issues`.
- Regression: `tests/integration/awards-reload-links.test.ts`,
  `tests/player-link-mutations.test.ts`, `tests/under-22-importer.test.ts` and
  `tests/integration/release-gates.test.ts` all pass — 106 tests — so
  `AFLDB-ISSUE-044` is intact.
- Full `tests/integration`: 388 passed, 2 failed, both pre-existing and
  unrelated (`AFLDB-ISSUE-073` fk-indexes, `AFLDB-ISSUE-074` email-intake).
- Full non-integration suite: 1,132 passed, 2 failed, both pre-existing and
  unrelated (`AFLDB-ISSUE-072` site-settings, the `AFLDB-ISSUE-068` H7
  diagnostic).
#### Combined, after both halves
- Full `tests/integration`: **401 passed, 2 failed**, both pre-existing and
  unrelated (`AFLDB-ISSUE-073` fk-indexes, `AFLDB-ISSUE-074` email-intake).
  `tests/integration/awards-reload-links.test.ts` (6/6) and
  `tests/integration/draft-reload-links.test.ts` (7/7) both pass, so
  `AFLDB-ISSUE-044` and the draft half are intact.
- After the review corrections: `tests/integration/first-kick-goal-reload-links.test.ts`
  **14/14**, `draft-reload-links.test.ts` **7/7**,
  `awards-reload-links.test.ts` **6/6**; full `tests/integration` **402 passed,
  2 failed** (pre-existing `AFLDB-ISSUE-073`, `AFLDB-ISSUE-074`); full
  non-integration suite **1,132 passed, 2 failed** (pre-existing
  `AFLDB-ISSUE-072`, `AFLDB-ISSUE-068`). `tests/integration/privileges.test.ts`
  passes with the new grant.
- The importer was additionally run end to end **as `afldb_import`** against
  `afldb_test`, covering a baseline reload, a gated retirement and an
  acknowledged retirement — the role the tests do not use.
- `npx tsc --noEmit` clean on Windows and the dev host. No Next.js build run:
  no application code changed.
- `afldb_test` left clean: no fixture rows, resolutions, suggestions or
  admins remain, and a further reload of each importer changes no id.

**Test-harness finding, fixed here.** Vitest runs test files in parallel, and
the new suite links real draft people to fixture players for over two minutes
while `release-gates.test.ts` asserts the exact number of linked draft people.
Run concurrently the gate counted the fixtures and failed on numbers that were
correct for the instant it read them. Neither assertion was weakened: a
PostgreSQL advisory lock (`tests/integration/draft-lock.ts`) serialises the two.
The suite also runs one final reload in `afterAll`, because deleting a fixture
audit row does not undo the link it already applied.

### Follow-up
1. Reviewed independently and closed 2026-08-22. Two bounded defects were found
   and fixed during that review (see above); all other invariants held.
2. **Draft deployment order, as for migrations 066 and 068:** apply migration
   `069_draft_source_identity.sql` **before** the new `import_draft.py` runs.
   No privilege reconciliation is needed.
3. **First-kick-goal deployment order:** apply migration
   `070_import_reads_link_suggestions.sql` and run `npm run db:privileges`
   **before** the new importer code, exactly as for 066 and 068 — without the
   grant the first retirement fails closed on the read. Commit
   `data/records/first-kick-goal-ids.csv` with the importer, then run `--rekey`
   once per target database (dev, production) **before** the extract is next
   corrected or re-extracted.
4. Decisions already made dangling by a previous destructive reload cannot be
   recovered — they match no row and are invisible to the new guards. Tracked
   read-only under `AFLDB-ISSUE-079`.
5. `confirmUnlinked` remains lock-free (`AFLDB-ISSUE-082`); the honours
   suite's latent fixture race is `AFLDB-ISSUE-081`.
6. The grant gap found in the final review was invisible because this suite —
   like every database-backed importer test — connects as `afldb_owner` rather
   than `afldb_import`. The catalogue assertion added here covers this importer
   only; the general test-infrastructure gap is tracked as `AFLDB-ISSUE-083`.

## AFLDB-ISSUE-079 — Audit historical `player_link_resolutions` rows for dangling targets

- **Status:** Resolved
- **Severity:** High
- **Area:** Data integrity
- **Found:** 2026-08-22
- **Resolved:** 2026-08-23 (production audited at migration 057; ISSUE-044/078 loader repairs not yet deployed — see `AFLDB-ISSUE-084`)
- **Files:** `src/db/queries/player-links.ts` (`LINK_TARGET_TABLES`),
  `tools/migration/import_awards.py`, `tools/migration/import_draft.py`,
  `tools/records/import-first-kick-goal.ts`

### Symptom
A `player_link_resolutions` row can name a `target_id` that no longer exists in
its `target_table`. The human decision it records is then unrecoverable from the
audit trail alone, and the honours row the admin decided about is back in the
`/admin/player-links` queue as though it had never been reviewed.

### Reproduction
Historical, not reproducible forward: `AFLDB-ISSUE-044` fixed the honours
loaders and `AFLDB-ISSUE-078` tracks the two that remain. This issue exists
because reloads run *before* those fixes may already have left orphans behind.

### Expected
Every `player_link_resolutions` row resolves to a live row in its target table,
so any decision can be traced back to what it was about.

### Actual
Unknown, and that is the point of this issue. `player_link_resolutions` dates
from migration 056; any destructive honours or draft reload run after an admin
started resolving links could have orphaned rows.

### Evidence
The mechanism is confirmed, reproduced against `afldb_test` under
`AFLDB-ISSUE-044`:

1. a destructive reload regenerates the target row id;
2. the manual link is lost with the old row;
3. the existing `player_link_resolutions.target_id` becomes dangling, because
   the old id is no longer present;
4. ids are **not** reused, because the reload does not reset the identity
   sequence — so the pointer goes nowhere rather than to a different row.

**First read-only audit, `afldb_dev`, 2026-08-22 — clean:**

| target_table | resolutions | dangling | earliest | latest |
|---|---|---|---|---|
| `award_winners` | 63 | 0 | 2026-08-19 | 2026-08-21 |
| `draft_picks` | 6 | 0 | 2026-08-20 | 2026-08-21 |
| `hall_of_fame` | 5 | 0 | 2026-08-20 | 2026-08-22 |
| `honour_team_members` | 1 | 0 | 2026-08-19 | 2026-08-19 |

75 resolutions, none dangling. `award_nominations`, `captaincies` and
`player_achievements` hold no resolutions on dev at all.

**Production audit completed 2026-08-23 — clean.** Full results under
Validation below.

### First wrong layer
Data integrity / operational history. The repaired repository/dev source no
longer creates new orphans, but the deployed production checkout (`a32a0a1`,
migration 057) still carries the destructive loaders — see the prospective
protection statement under Validation and `AFLDB-ISSUE-084`.

### Root cause
Historical: the pre-`AFLDB-ISSUE-044` destructive reloads. Nothing further is
required in the current honours-loader code for the dangling-target mechanism
audited by this issue; `AFLDB-ISSUE-078` covers the draft and first-kick-goal
paths, while `AFLDB-ISSUE-080` separately tracks honours-loader ownership
scoping for admin-created rows.

### Fix
No remediation is authorised by this issue. It covers **diagnosis only**.

### Validation

Both audits were executed on 2026-08-23 under the approved AFLDB-ISSUE-079
rev. 8 runbook (`AFLDB-ISSUE-079.md`): read-only, one
`REPEATABLE READ READ ONLY` snapshot each, identity gate passed, live schema
gate passed, `psql exit status: 0`, `ssh/remote exit status: 0`, and an explicit
final `ROLLBACK` with no `COMMIT`. All seven of the runbook's mandatory
Outcome A evidence conditions were positively observed for each run.

**Production — `afldb_prod`, snapshot 2026-08-23 06:57:52+10, migration 057
(schema pins S16/S17 true; all seventeen assertions S01–S17 true).**
Artifact: `artifacts/audits/issue-079-player-link-integrity-prod-20260823.txt`.

| target_table | resolutions | dangling |
|---|---|---|
| `award_winners` | 0 | 0 |
| `award_nominations` | 0 | 0 |
| `hall_of_fame` | 0 | 0 |
| `honour_team_members` | 6 | 0 |
| `captaincies` | 0 | 0 |
| `player_achievements` | 0 | 0 |
| `draft_picks` | 0 | 0 |

`player_link_resolutions`: 6 rows, all `honour_team_members` (3 `linked`,
3 `confirmed_unlinked`), **0 dangling**. `player_link_suggestions`: 2 rows, both
`honour_team_members`, 0 dangling. Unknown target vocabulary 0; NULL/non-positive
target ids 0; dangling player references 0 of 3; dangling admin references 0 of
6; targets with repeated resolutions 0.

Supplementary query 13 (deployment/exposure context, **excluded from the closure
criterion by design**): the production player-link audit trail began when
`056_player_link_review.sql` was applied at 2026-08-19 17:42:14.800707+10 —
the full window in which a dangling row could have arisen; zero mapped
destructive loader runs are recorded in that window, and 13d contains only
unrelated `player_birth_evidence` runs. This is contextual only and **must not
be used as proof of safety**.

**Development — `afldb_dev`, snapshot 2026-08-23 07:05:11+10, migration 070
(schema pins S16dev/S17dev true; all twenty-two assertions S01dev–S22dev true).**
Artifact: `artifacts/audits/issue-079-player-link-integrity-dev-20260823.txt`.

`player_link_resolutions`: 75 rows — `award_winners` 63, `draft_picks` 6,
`hall_of_fame` 5, `honour_team_members` 1, the other three tables 0
(63 `linked`, 12 `confirmed_unlinked`), **0 dangling** — reproducing the
2026-08-22 result of 75 / 0. `player_link_suggestions`: 0 rows. Unknown target
vocabulary 0; bad target ids 0; dangling player references 0 of 63; dangling
admin references 0 of 75; repeated-resolution targets 0.

Dev supplemental diagnostics (technical run completeness only — no evidential
weight per rev. 8): `player_link_match_candidates` holds 2,798 rows with 0 stale
cache rows across the seven probed targets; `draft_person` (2,304 rows) was
deliberately not entity-probed; query 13c was intentionally omitted (Phase 0c
unclassifiable dev source drift); query 13d surfaced one
`import_awards.py` / `under_22` run whose destructive semantics are unclassified
— supplementary only.

### Closure

**Historical audit result.** At the ISSUE-079 production audit snapshot of
2026-08-23 06:57:52+10, the production database at migration 057 held 6
`player_link_resolutions` rows, of which **0** named a target id that no longer
exists across all seven `LINK_TARGET_TABLES`. No historical dangling player-link
resolution targets were found, and no remediation was required for the audited
historical rows. `player_link_resolutions` has existed in production only since
`056_player_link_review.sql` was applied at 2026-08-19 17:42:14.80+10, so that
is the full window in which a dangling row could have arisen.

**Prospective protection status — separate, and not established by this
audit.** At that same snapshot, the prospective protections implemented under
`AFLDB-ISSUE-044` and `AFLDB-ISSUE-078` were **not deployed in production**. The
deployed production checkout (`a32a0a1`) still contained destructive reload
behaviour affecting all seven current player-link target families, so a reload
run in production before those repairs are deployed can create new dangling
resolutions. ISSUE-079's clean historical result is evidence about the past, not
protection for the future — it is **not** proof that a future production reload
cannot create new dangling resolutions. That forward exposure is owned by
`AFLDB-ISSUE-084`, not by this issue.

### The audit

Read-only, no writes, safe to run against production. It must cover every table
in `LINK_TARGET_TABLES` (`src/db/queries/player-links.ts`): `award_winners`,
`award_nominations`, `hall_of_fame`, `honour_team_members`, `captaincies`,
`player_achievements`, `draft_picks`.

Run it as `AFLDB_OWNER_DATABASE_URL`. `afldb_app` cannot read
`player_link_resolutions` at all (migration 056 grants it to `afldb_auth`, and
`afldb_import` gained SELECT only in migration 068), and `afldb_auth` cannot
read every honours table, so no single application role can join both sides.

Per-table counts:

```sql
WITH live AS (
  SELECT 'award_winners'       AS target_table, id FROM award_winners
  UNION ALL SELECT 'award_nominations',   id FROM award_nominations
  UNION ALL SELECT 'hall_of_fame',        id FROM hall_of_fame
  UNION ALL SELECT 'honour_team_members', id FROM honour_team_members
  UNION ALL SELECT 'captaincies',         id FROM captaincies
  UNION ALL SELECT 'player_achievements', id FROM player_achievements
  UNION ALL SELECT 'draft_picks',         id FROM draft_picks
)
SELECT r.target_table,
       count(*)                             AS resolutions,
       count(*) FILTER (WHERE l.id IS NULL) AS dangling,
       min(r.created_at)::date              AS earliest,
       max(r.created_at)::date              AS latest
  FROM player_link_resolutions r
  LEFT JOIN live l ON l.target_table = r.target_table AND l.id = r.target_id
 GROUP BY r.target_table
 ORDER BY dangling DESC, r.target_table;
```

The affected rows in full, which is the evidence that must be preserved:

```sql
WITH live AS ( /* as above */ )
SELECT r.id, r.target_table, r.target_id, r.action, r.player_id,
       r.previous_status, r.created_at,
       r.admin_user_id, u.email AS admin_email,
       r.match_method, r.match_score, r.algorithm_version, r.note
  FROM player_link_resolutions r
  LEFT JOIN live l ON l.target_table = r.target_table AND l.id = r.target_id
  LEFT JOIN auth_users u ON u.id = r.admin_user_id
 WHERE l.id IS NULL
 ORDER BY r.target_table, r.target_id;
```

`player_link_suggestions` carries the same `(target_table, target_id)` shape and
should be counted the same way while the audit is being run.

### Follow-up
1. Done 2026-08-23: both audits ran read-only under the rev. 8 runbook, full
   output preserved as the two artifacts named under Validation, counts recorded
   here. Nothing was relinked or deleted; no writes occurred; both transactions
   ended with `ROLLBACK`.
2. Production was clean (Outcome A), so no historical-remediation issue is
   created — there are no affected historical rows to remediate.
3. The prospective exposure — migrations 058–070, `db:privileges`, the corrected
   loaders, the one-time `--rekey`, and the post-deployment audit re-run — is
   deployment work and is owned by **`AFLDB-ISSUE-084`**, not by this issue.
4. The migration-057-pinned production audit SQL
   (`artifacts/audits/issue-079-audit-prod-20260823.sql`) will correctly refuse
   (S16/S17) once production migrates past 057; it must be regenerated, not
   rerun — recorded in `AFLDB-ISSUE-084`.

## AFLDB-ISSUE-080 — Source reloads reconciled rows they do not own across five award/honours paths

- **Status:** Resolved
- **Severity:** High
- **Area:** Data integrity
- **Found:** 2026-08-22
- **Resolved:** 2026-08-23 — code implemented and dev/test validation complete.
  **Production still runs the old loaders:** rollout is owned by
  `AFLDB-ISSUE-084`, and the corrected `common.py` / `import_awards.py` /
  `awards-admin.ts` are a deployment prerequisite there.
- **Runbook:** `AFLDB-ISSUE-080.md` (revision 5) — the approved investigation and
  implementation plan; authoritative for the full evidence chain, collision
  analysis and gates summarised here.
- **Files:** `tools/migration/common.py` (`reload_keyed`, `_scope_clause`,
  `ReloadOwnershipCollision`); `tools/migration/import_awards.py`
  (`import_hall_of_fame`, `import_honour_teams`, `import_awards` legacy winners,
  `import_all_australian`, `import_rising_star`, `require_source`,
  `_refuse_honour_team_identity_collisions`); `src/db/queries/awards-admin.ts`
  (`createHallOfFameInductee`, `createHonourTeamMember`);
  `tests/awards-admin.test.ts`; `tests/integration/awards-reload-links.test.ts`

### Symptom
A row created outside a loader's own source — through a shipped admin screen,
by the ingest promotion pipeline, or with unknown provenance — was destroyed by
that loader's next reload, because five reload paths reconciled a population
defined by domain (award id) or by nothing at all (the whole table). Before
`AFLDB-ISSUE-044` this happened silently; after it, such a row carrying a manual
player-link decision aborted the entire reload instead, while one with no
decision was still deleted silently.

### Scope — the eight reload paths in `import_awards.py`
The issue was raised for the two honours loaders; the runbook investigation
proved the same defect on three further paths (its ledger-premise correction):

| Classification | Paths |
|---|---|
| Proven cross-owner loss — **fixed under this issue** | `import_hall_of_fame`, `import_honour_teams`, `import_awards` (legacy winners), `import_all_australian`, `import_rising_star` |
| Structurally unsafe, no second owner proven — **not changed** | `import_captaincies` — hardening recommended as a separate issue (runbook G6; see Follow-up) |
| Proven unaffected | `import_awards` (definitions — no `source_id` column, single writer); `import_under_22` (the positive precedent: domain AND provenance, conjoined) |

Foreign owners proven at risk: `createAwardWinner` (`manual_admin_edit` rows in
the legacy-winner domain), the ingest promotions (`sports_data_lab` rows under
the All-Australian and Rising Star awards), the two honours admin creators
(then-`source_id IS NULL` rows), and any provenance-unknown row.

### First wrong layer
Import/ETL ownership scoping — a loader reconciled rows it does not own.

### Root cause
`(source_id, source_record_id)` identifies a row; it does **not** define which
existing rows a reload owns. Ownership is established only by constraining the
reconciliation population — `reload_keyed`'s scope predicate — not by the shape
of the key: a row whose key the incoming extract can never produce is not
thereby protected, it is precisely the row the DELETE step classifies as
vanished. The two natural-key honours loaders additionally reconciled their
entire tables, conflating "row this source did not supply" with "row this
source deleted".

### Production exposure audit — gate G1, executed 2026-08-23, PASSED
Read-only Profile-A (migration 057) audit run by the operator; Claude never
connected to production. Evidence artifacts (preserved, not to be modified):

- **Plane A (production):** `scratchpad/issue-080-planea-prod-20260823.txt`,
  SHA-256 `0E2BF6BCF6B938CC1AE6FF31A26AD9785E0ECA9A0B304A7189DD9B792D456E78`.
  Production identity gate and Profile-A schema/reference-data gate passed;
  REPEATABLE READ READ ONLY transaction with explicit ROLLBACK; exit 0.
- **Plane B (normalised incoming keysets):**
  `scratchpad/issue-080-planeb-dev-20260823-v2.json`, SHA-256
  `5AA44FC08C6A381FD049C7CD911B721B6A78EBDFC2CF7F4DF3D28146AF46128E`.
  The complete Plane-B baseline, recorded here so `AFLDB-ISSUE-084` never
  depends on opening that untracked scratchpad JSON:
  - Legacy SQLite artifact SHA-256:
    `a56fef4e79f3583a5dfa773190412abd4b4a3eca347a8ec95de6d1b960eac547`.
  - Plane-B code HEAD: `9b628612cac7ac185be347314b270795a5ce1543`
    (**pre-fix** — a reproducibility/provenance pin, not an equality
    requirement; ISSUE-080 itself changes the files below), with baseline
    blobs `common.py` `579e129b20ebf1cb6ae74f7c4e938e4168aaf2f3`
    and `import_awards.py` `b19ea80af85e4b9be1724db4b579281aba1537e1`.
  - Hall of Fame: read 343, skipped 0, emitted 343, distinct 343,
    duplicate keys 0, fingerprint
    `bcb0c3d609eb9d6251d22488d63ca86fb9f0e998ddec42d076e7e713a3e6bcc7`.
  - Honour teams: read 113, skipped 0, emitted 113, distinct 113,
    duplicate keys 0, fingerprint
    `4a9710b29118f62bd8fb78178e7698513c0a44e5686016be088d04f784777110`.
- **Findings:** hall_of_fame 343 rows and honour_team_members 113 rows, all
  Wikipedia-owned; legacy-winner domain 1,810 rows, All-Australian 1,158,
  Rising Star 766 — **zero foreign-owned, zero NULL-source, zero
  foreign+linked rows anywhere**, and every stored-state collision set empty
  (HoF `(name, inducted_year)`, honour-team raw-name and `(team_name,
  player_id)`, award cross-owner `(award_id, source_record_id)`). Latest
  awards/honours import batches were 2026-08-15; none occurred after Plane B.
- **Profile-A correction:** `22-under-22` does not exist in the deployed
  production revision `a32a0a1` (its `import_awards.py` contains no
  `22-under-22` / `UNDER_22_SLUG` / `wikipedia_22under22`), so it is
  evidence-only under Profile A and not a production reference-data gate; this
  changed no implementation scope.
- Earlier failed-audit artifacts preserved:
  `…-transport-failed.txt` (SHA-256
  `FE7EF5D1517FACACA4F6907D7FA543348B4E3F06D69181714D721B437FE1FF17`) and
  `…-a15-profile-mismatch.txt` (SHA-256
  `A9FE6DD792715E33586EA44CC414FBEA1FC04E4E3232845F64ECD9B9FB1EE346`).

The audit classified as **No exposure** (§7.4), so implementation proceeded
with no production remediation required. Earlier `afldb_dev` evidence
(2026-08-22): 343 / 113 rows, 0 admin-created — latent there, not disproven.

### Interaction with AFLDB-ISSUE-044
`AFLDB-ISSUE-044` did not introduce the deletion and did not fix it; it changed
the failure mode, in both directions:

- **Better:** an admin-created row carrying a manual `player_link_resolutions`
  decision is no longer silently destroyed. `reload_keyed`'s strict analysis
  classifies it as `the source no longer carries this key`, raises
  `LinkDecisionLoss` before any write, and the loader's transaction rolls back
  with the table untouched.
- **Worse operationally:** that abort blocks the *entire* reload. One decided
  admin-created row stops every subsequent honours refresh until someone passes
  `--allow-link-loss`.
- **Unchanged and still wrong:** an admin-created row with **no** player-link
  decision is invisible to that guard — `reload_keyed` only classifies rows that
  have a resolution — so it is still deleted silently, exactly as before.

`--allow-link-loss` is **not** the long-term answer for admin-owned rows. It is
the deliberate escape hatch for a *source* row whose key genuinely changed, and
using it here does the wrong thing twice over: it discards the human decision
and it still deletes the admin-created row. Reaching for it to unblock a reload
converts a correct fail-closed stop into the silent data loss this issue exists
to end. The row must stop being in the reload's scope at all.

### Fix
Implemented 2026-08-23, per the approved runbook (`AFLDB-ISSUE-080.md` §8).
Code-only: **no migration, no backfill, no privilege change** — the no-privilege
conclusion proven rather than assumed (see Validation).

- **`reload_keyed` (`tools/migration/common.py`):** `_scope_clause` generalised
  to an AND-joined conjunction (`scopes=[(column, values, exclude), …]`) so a
  domain predicate and a provenance predicate compose instead of replacing each
  other; the single-predicate shorthand and its empty-list semantics are
  unchanged, so `import_draft.py` needed no edit. New **opt-in**
  `refuse_out_of_scope_key` preflight refuses, before any write, an incoming
  reload key already held by an out-of-scope row — compared with `_key_match`'s
  own `IS NOT DISTINCT FROM` semantics, and matched against the scope's exact
  complement `(scope) IS NOT TRUE` so NULL-provenance rows are seen (a NULL
  `source_id` makes `= ANY` evaluate NULL, not FALSE). It raises the new
  dedicated `ReloadOwnershipCollision`, naming row id, owning source and key;
  `main()` reports it like `LinkDecisionLoss` (itemised warning, exit 1,
  nothing written).
- **Loader ownership scopes (`import_awards.py`):** hall_of_fame and
  honour_teams add `source_id = ANY([wikipedia])`; legacy winners keeps its
  award-family exclusion **and** adds `source_id = ANY([draftguru])`;
  All-Australian adds `source_id = ANY([draftguru, wikipedia])`; Rising Star
  adds `source_id = ANY([footywire])`. Every newly scoped loader resolves its
  sources through the fail-closed `require_source` guard (a `sources.get` miss
  would otherwise make the scope never-true and INSERT rows with NULL
  provenance). Check 1 is enabled **only** for hall_of_fame, whose
  `(name, inducted_year)` is a total globally unique identity backed by
  `hall_of_fame_name_uq` — the runbook settled the old open question as
  fail-closed refusal, never adoption, never re-scoping the constraint.
- **Honour-team identity (§4.3/§4.4):** `import_honour_teams` instead runs a
  loader-local preflight implementing the five-case raw-name matrix — refuse
  when identity is unknown or asserted twice on either side, but **allow
  linked P / linked Q coexistence** under one display name (the
  ISSUE-025/migration-059 capability) — plus the unconditional
  `(team_name, player_id)` refusal.
- **Concurrency (§5.3):** the two mixed linked/unlinked collisions have no
  unique-index backstop after migration 059, so both honour-team identity
  writers serialise on the frozen transaction-scoped advisory lock
  **`(717275, 1)`** (`717275 = 0xAF1DB`): blocking `pg_advisory_xact_lock` in
  the importer, `pg_try_advisory_xact_lock` in the admin path with a bounded
  "An honours reload is in progress; try again shortly." failure. Identical
  literal constants in both languages, enforced by a cross-language contract
  test; no session-scoped locks; released on commit and rollback alike.
- **Admin creators (`awards-admin.ts`):** `createHallOfFameInductee` and
  `createHonourTeamMember` stamp `manual_admin_edit`, resolved and required in
  the same transaction exactly as `createAwardWinner` does.
  `createHonourTeamMember` is now create-only/fail-closed: both
  `ON CONFLICT … DO UPDATE` branches removed, both identity axes checked for
  every ownership class before insert, refusals name the existing entry (and
  point at no non-existent editor), no `data_edits` read on the mutation path —
  and the linked-P/linked-Q same-name create still succeeds. Historical
  `source_id IS NULL` rows are **not** backfilled; they keep meaning
  "provenance unknown".
- `import_captaincies`, `import_under_22`, the awards-definitions reload, the
  data editor and `applyLockedLink` are untouched (writer inventory, runbook
  §2.4b).

### Validation (2026-08-23 — all §10 gates passed)
1. `tests/awards-admin.test.ts`: **33/33** (Windows) — provenance stamping,
   missing-source failure for both creators, lock taken first with the literal
   `(717275, 1)` identity, bounded lock-contention error, create-only /
   no-`ON CONFLICT` contract, the full §4.3/§4.4 refusal matrix including the
   ISSUE-025 positive create, no audit write or `data_edits` read on the
   refusal path, and the cross-language lock-constant contract.
2. `tests/under-22-importer.test.ts`: **8/8** on the dev host under
   Node v22.23.2 — the source contracts over `import_awards.py` are intact,
   including the unchanged legacy-winner scope line.
3. `npm run db:status`: 70 applied, **0 pending** — no migration attributable
   to this work.
4. `tests/integration/awards-reload-links.test.ts` run **isolated** on the dev
   host against `afldb_test` (owner + `afldb_import` roles): **21/21, 0
   skipped** (137.3 s; the amended suite rerun 2026-08-23 after the M2
   review disposition added the real-database §4.4 axis-2 admin test — the
   original pre-amendment run was 20/20 in 139.7 s) — admin/foreign-owned
   rows survive all five reload paths (linked, decided and undecided, ids and
   provenance intact, no `LinkDecisionLoss`); the HoF out-of-scope
   incoming-key collision fails closed; the complete honour-team collision
   matrix refuses with every table untouched; `createHonourTeamMember`'s
   §4.4 axis-2 `player_id` disjunct refuses the same linked player under a
   different display name against real PostgreSQL, writing nothing;
   linked-P/linked-Q same-name coexistence succeeds through a real
   reload (proving check 1 is not enabled there); double-reload idempotency;
   and the §9.4b lock proofs — commit and rollback both release, the admin try
   form fails fast rather than hanging, and the real `afldb_import` role takes
   both lock forms and contends across roles via
   `AFLDB_TEST_IMPORT_DATABASE_URL`. All six pre-existing ISSUE-044 cases
   unchanged and green (§9.6).
5. Read-only `afldb_dev` inventory (owner role, connection-level +
   transaction-level READ ONLY, REPEATABLE READ, fail-closed database/source/
   award gates, explicit ROLLBACK): honours provenance **wikipedia-only
   (343 / 113)**, all ten ISSUE-080 domain-scoped foreign/NULL counts **0**,
   all five stored-state duplicate counts **0**.
6. `npm run typecheck`: clean (exit 0).
7. `tests/integration/privileges.test.ts`: **24/24 unchanged** — role
   confinement untouched; with the restricted-role lock proof in item 4 this
   holds §8.4's no-privilege-change conclusion and closes gate **G8** (the
   advisory lock serialises both writers on the existing schema, so the
   no-migration conclusion stands).

### Independent review dispositions (2026-08-23)
An independent read-only review of the completed implementation reported **no
blocking correctness findings** and independently verified the design
(conjunctive ownership scopes, NULL/empty-scope semantics, the `(scope) IS NOT
TRUE` complement, the five modified loaders, the §4.3/§4.4 matrix, the
advisory-lock protocol, and the create-only admin path). Four bounded
dispositions were applied: the corrected Profile-B staleness rule with the
full Plane-B baseline recorded above and in `AFLDB-ISSUE-080.md` (H1); the
load-bearing migration-059 prerequisite recorded in the `AFLDB-ISSUE-084`
handoff (M4); the runbook status header corrected to describe the resolved
implementation (L5); and one new real-database integration test in
`tests/integration/awards-reload-links.test.ts` proving `createHonourTeamMember`'s
§4.4 axis-2 `player_id` SQL disjunct against PostgreSQL, which the unit suite
only mocks (M2). The amended suite was rerun authoritatively on the dev host
(Node v22.23.2, `afldb_test`) on 2026-08-23: **21/21, 0 skipped** (137.3 s),
the new axis-2 test included — recorded in Validation item 4 above. Accepted
residual operational
risk (M3): there is no in-app remedy for an admin/source honour-team
collision; fail-closed refusal pending curator/operator resolution is the
intended behaviour.

### Deferred validation (deliberate, not skipped)
1. The combined `awards-reload-links.test.ts` + `release-gates.test.ts` run
   waits until `AFLDB-ISSUE-081` supplies the shared test advisory lock
   (runbook §9.7 / G3). The new fixtures widen that latent race; the isolated
   run above is the required §10 step-3 proof.
2. The **Profile-B production audit repeat** runs inside `AFLDB-ISSUE-084`'s
   deployment sequence: after migrations 058–070 (059 included) and the
   068 + `db:privileges` step, after the corrected loaders are deployed, and
   **before the first awards/honours reload** under the migrated schema.
   **Corrected staleness rule (2026-08-23, independent review, H1):** Plane B
   must be rerun from the **exact deployment-candidate code** and the **exact
   canonical SQLite artifact selected for the production reload**, recording
   its own code HEAD/revision, relevant code blob IDs, artifact SHA-256,
   read/skipped/emitted/distinct counts, duplicate-key result and both key
   fingerprints. The pre-fix HEAD/blob IDs recorded above are historical
   provenance only — a changed whole-file `common.py` or `import_awards.py`
   blob does **not** by itself invalidate Profile B, because ISSUE-080 itself
   necessarily changes those files. The operative comparison is (a) canonical
   legacy artifact identity and (b) the regenerated incoming natural-key
   counts/fingerprints: if the artifact SHA-256 changes, **STOP** and redo the
   Plane-A × Plane-B classification; if incoming counts or fingerprints
   change, **STOP** and redo the classification; if normalisation, skip rules
   or natural-key derivation themselves changed, the newly generated Plane-B
   keyset is authoritative and the classification is redone rather than
   waived. Do not informally approve a mismatch (runbook §7.1/§7.2 and its
   post-implementation corrections section).

### Follow-up
1. **`AFLDB-ISSUE-084` deploys this fix.** The corrected `common.py`,
   `import_awards.py` and `awards-admin.ts` are a deployment prerequisite
   there: shipping the ISSUE-044 protections without this scoping would fail
   closed on decided admin rows and still silently delete undecided ones.
   Production remains exposed to this defect until ISSUE-084 completes.
2. Raised as **`AFLDB-ISSUE-085`** (runbook G6): `import_captaincies` unscoped
   reconciliation hardening — no ownership predicate and no proven second
   writer today; scope it by construction as ISSUE-078 did for `draft_persons`
   and settle the `captaincies_natural_uq` collision policy.
3. Raised as **`AFLDB-ISSUE-086`** (runbook G5): data-editor edit durability on
   source-owned rows — overwrite-on-reload rather than ownership deletion, with
   no live reversion path in the honours tables today (`EDITABLE_ENTITIES`
   registers only `players`, `matches`, `draft_picks`). Severity deliberately
   left to triage on its own evidence.
4. Forward constraint recorded on `AFLDB-ISSUE-082`: if its fix ever makes
   `confirmUnlinked` (or any successor) write `player_id = NULL` back to
   `honour_team_members`, that path creates the migration-059 unbacked mixed
   collision and must join the §4.3 matrix and the `(717275, 1)` advisory-lock
   protocol.


### Profile-B Pre-Reload Standing Gate
**Profile-B Schema Gate: PASS** (Run Date: 2026-08-24)
- **Artifact:** `artifacts/audits/issue-080-planeb-dev-20260824-profileB.json` (SHA256: `92516054809b3ad1a9084d06d8f0b91a713c7550f7b641f893e48ba3c19432df`)
- **Plane-A Artifact:** `artifacts/audits/issue-080-planea-prod-20260824-profileB.txt` (SHA256: `1ba4d792a3e1d52c7a2436996e900dd5427f93ff480b27b3e9ee5c3a070263ee`)
- **Verification:** 343 `hall_of_fame` and 113 `honour_team_members` rows safely emitted with 0 duplicates. Fingerprints matched Production Plane-A precisely. No collisions or foreign/exposed rows found.
- **Standing Gate Requirement:** No production awards/honours reload via `import_awards.py` may be executed without rerunning and passing this Profile-B fail-closed gate using the exact deployment candidate and target dataset.

## AFLDB-ISSUE-081 — Honours reload suite races the release gates over shared rows

- **Status:** Resolved
- **Severity:** Low
- **Area:** Tests
- **Found:** 2026-08-22
- **Resolved:** 2026-08-25
- **Files:** `tests/integration/awards-reload-links.test.ts`,
  `tests/integration/release-gates.test.ts`, `tests/integration/draft-lock.ts`

### Symptom
Not yet observed failing. `awards-reload-links.test.ts` links real honours rows
to fixture players and reloads the honours family repeatedly, while
`release-gates.test.ts` asserts exact honours counts. Vitest runs test files in
parallel, so the gate can read the database mid-fixture.

### Reproduction
Not yet reproduced. Found while fixing the identical race in the draft suite
under `AFLDB-ISSUE-078`, which DID fail: the draft gate counted two fixture
links and reported 3,461 linked people instead of 3,459.

### Expected
A release gate counts a quiescent dataset, or is serialised against whatever is
mutating it.

### Actual
Nothing serialised the two files. The honours case had not bitten, most likely
because its per-test `restore` callbacks put rows back sooner than the draft
suite could, and because the gate's honours assertions overlap its fixtures less
directly.

### First wrong layer
Test harness.

### Root cause
File-level parallelism over shared database fixtures with no mutex.

### Fix
The existing advisory-lock helper in `draft-lock.ts` was extended with a separate `HONOURS_RELOAD_LOCK`. `awards-reload-links.test.ts` and `release-gates.test.ts` now serialise only over the shared honours population.

**DSN hardening:** The lock helpers were hardened to receive the exact module-captured guarded test DSN rather than consulting mutable environment state. Both integration files capture `process.env.AFLDB_TEST_DATABASE_URL` during module evaluation and pass it down, guaranteeing the lock hook respects the same configuration state that determined the file's activation.

### Validation
A paired Linux validation and standalone baseline comparison were run.
The paired run (`awards-reload-links.test.ts` + `release-gates.test.ts`) executed with 52 passed, 12 failed assertions in the release gates, and no advisory-lock timeouts or deadlocks.
The standalone run of `release-gates.test.ts` identically reproduced the 52 passed, 12 failed assertions.
Therefore, the paired run introduced **zero** additional release-gate failures. The 12 baseline failures are unrelated existing snapshot/data drift outside AFLDB-ISSUE-081, not successful assertions and not ISSUE-081 defects. No release-gate expected values were altered.

### Follow-up
Ensure any newly added shared integration fixtures consider cross-file locks if asserted by the release gates.

## AFLDB-ISSUE-082 — `confirmUnlinked` can record a decision contradicting an applied link

- **Status:** Resolved
- **Severity:** Medium
- **Area:** Admin
- **Found:** 2026-08-22
- **Resolved:** 2026-08-25
- **Files:** `src/db/queries/player-links.ts` (`confirmUnlinked`)

### Symptom
Two picks of one draft person can end up carrying contradictory operative
decisions — one `linked`, one `confirmed_unlinked` — which the draft reload now
refuses to guess between and aborts on.

### Reproduction
Open `/admin/player-links`, resolve one pick of a multi-pick draft person, then
submit a stale "confirm unlinked" form for a sibling pick of the same person.

### Expected
A confirmation is checked against the row's current state, as a link is.

### Actual
`confirmUnlinked` (`src/db/queries/player-links.ts:489`) takes no lock, does not
re-read the target, and runs on `authSql` rather than the import transaction. It
takes `previousStatus` straight from the form and inserts the audit row
unconditionally. `resolveLink` does the opposite: it locks the draft person,
then the pick, and re-checks both.

### Evidence
Established by inspection during `AFLDB-ISSUE-078`, and the reason that issue's
draft reload aborts unconditionally on a contradiction rather than taking the
latest decision by `created_at`. The importer's guard is a backstop, not a fix:
the contradictory state should not be creatable.

### First wrong layer
Admin mutation path.

### Root cause
`confirmUnlinked` records an audit-only decision and was written as though that
made a concurrency check unnecessary. It does not: the decision is
person-grained in effect for draft picks, and it can contradict a link applied
between the page render and the submit.

### Fix
* `confirmUnlinked` moved to the import-role transaction.
* `confirmUnlinked` now uses `lockUnresolvedTarget` to lock the authoritative target and derive `previous_status` from the database rather than accepting it from form input.
* Draft logical decisions are classified at the draft-person grain by mirroring the importer's effective latest-resolution-per-pick classification: `DISTINCT ON (target_id) ... ORDER BY created_at DESC, id DESC`.
* A contradiction is defined precisely: effective sibling actions differ, or linked decisions point to different players.
* A consistent existing linked or confirmed-unlinked decision is rejected safely as stale state, not described as a contradiction.
* Identical duplicate `confirmUnlinked` actions are safely rejected with a stale-form error.
* `confirmUnlinked` remains audit-only and does not participate in the ISSUE-080 honour-team advisory-lock protocol.
* No database migration was required.
* Implemented deterministic, database-backed concurrency regression using `pg_blocking_pids` covering all three interleavings (resolve-first, confirm-first, confirm-duplicate).

### Validation
* `tests/player-link-mutations.test.ts`: 34/34 passed
* `tests/integration/player-link-concurrency.test.ts`: 3/3 passed
* Targeted ISSUE-078 first-kick-goal compatibility validation: 2 passed / 12 skipped, exit 0 (used a one-off `--testTimeout=120000` because that existing importer-heavy test lacks the explicit timeout used by nearby tests)
* `npx tsc --noEmit`: passed
* `npm run build`: passed, 1499/1499 static pages

### Follow-up
None required for AFLDB-ISSUE-082. AFLDB-ISSUE-083 remains the separate test-role parity issue.


## AFLDB-ISSUE-083 — Importers are tested as `afldb_owner`, so missing-grant defects are invisible

- **Status:** Resolved
- **Severity:** Medium
- **Area:** Tests / Database privileges
- **Found:** 2026-08-22
- **Resolved:** 2026-08-27
- **Files:** `.env.example`, `tests/setup.ts`, `tests/integration/guard.ts`,
  `tests/integration/import-role-parity.ts`,
  `tests/integration/import-role-parity.test.ts`,
  `tests/import-role-parity.test.ts`,
  `tests/integration/awards-reload-links.test.ts`,
  `tests/integration/draftguru-import.test.ts`,
  `tests/integration/first-kick-goal-reload-links.test.ts`,
  `tests/integration/dob-enrichment-issues.test.ts`,
  `tests/integration/data-editor.test.ts`, `issues.md`, `IssuesIndex.md`,
  `CHANGELOG.md`

### Symptom
Every database-backed test of a production importer runs the importer as
`afldb_owner`. The importer runs as `afldb_import` in every real environment.
A privilege the importer requires but does not hold is therefore invisible to
the whole test suite: the run is green and the first production execution fails
with `permission denied`.

### Reproduction
At checkpoint `73e6a7e`, the production importer subprocesses had the following
owner substitution. The lines below are historical reproduction evidence; the
implementation now replaces only the child-process boundary.

The integration suites do not merely inherit the owner connection — they assign
it deliberately:

    process.env.AFLDB_IMPORT_DATABASE_URL = process.env.AFLDB_TEST_DATABASE_URL;

That line appears verbatim in `awards-reload-links.test.ts:35`,
`draft-reload-links.test.ts:48`, `first-kick-goal-reload-links.test.ts:46` and
`data-editor.test.ts:9`, and is repeated in the `spawnSync` env of each suite
that shells out to the real loader. `.env.example:60` sets
`AFLDB_TEST_DATABASE_URL` to an `afldb_owner` DSN, so the substitution silently
promotes the importer to owner privileges for the whole run.

### Expected
A production importer's database-backed test proves that the operations the
importer performs succeed **under `afldb_import`**, and that operations it must
never perform remain denied.

### Actual
It proves only that they succeed as the table owner, for whom no grant can ever
be missing.

### Evidence

**The defect this class already produced (`AFLDB-ISSUE-078`).** The
first-kick-goal retirement preflight reads `player_link_suggestions` and
`player_link_match_candidates` before deleting a source fact, so it can refuse
to strand a durable non-FK reference. `afldb_import` held **no privilege of any
kind** on either table. All 13 integration tests passed. Running the same
importer as `afldb_import` against `afldb_test` failed immediately on the read.
Fixed for that importer by migration `070_import_reads_link_suggestions.sql`, a
matching `tools/maintenance/privileges.sql` block, and a hand-written catalogue
assertion in the first-kick-goal suite. That assertion is a spot fix naming four
tables for one importer; it is not a mechanism, and nothing generalises it to the
others.

**The same class, one issue earlier.** `AFLDB-ISSUE-027` needed migration 066 to
give `afldb_import` INSERT on `data_edits` and `player_link_resolutions` so the
audit row could commit inside the mutation transaction. Its behavioural proof,
`tests/integration/data-editor.test.ts`, also runs as owner and would have passed
without migration 066 at all. Only the catalogue assertions in
`privileges.test.ts` caught the requirement, and only because someone thought to
write them by hand. The ledger already records the resulting operational hazard:
migration 066 plus `npm run db:privileges` must be deployed **before** the code,
or admin mutations fail closed. Migration 070 has now inherited exactly the same
deployment dependency.

**Why `privileges.test.ts` does not close this.** That suite is deliberately a
*confinement* test — it interrogates `has_table_privilege` from the owner
connection and asserts the roles hold **no more** than intended. Its own header
says so: "The integration suite connects as afldb_owner". It has no model of what
each importer **requires**. Its central import assertion, "writes exactly the
tables the registry allows, and no others", probes `INSERT` against
`afldb_meta.import_writable_tables`, so a SELECT-only requirement such as
`player_link_suggestions` is outside its reach by construction. Confinement and
sufficiency are different properties, and only confinement is currently tested.

**Excessive-grant defects are covered; missing-grant defects are not.** The
registry drift test does catch a table that became writable without being
registered. Nothing catches the inverse.

### Investigation findings by importer and test

| Production code executing as `afldb_import` | Database-backed test | Role the test actually uses |
|---|---|---|
| `tools/migration/import_awards.py` (via `common.py:82`) | `tests/integration/awards-reload-links.test.ts` | `afldb_owner`, explicit substitution |
| `tools/migration/import_draft.py` | `tests/integration/draft-reload-links.test.ts` | `afldb_owner`, explicit substitution |
| `tools/records/import-first-kick-goal.ts` | `tests/integration/first-kick-goal-reload-links.test.ts` | `afldb_owner`, explicit substitution, plus one hand-written catalogue assertion |
| `src/db/queries/player-links.ts`, `awards-admin.ts`, `match-admin.ts`, `match-sheet.ts`, `data-edits.ts`, `players.ts`, `src/lib/ingest/pipeline.ts` | `tests/integration/data-editor.test.ts` | `afldb_owner`, explicit substitution |
| `tools/migration/import_legacy_afl.py` | none | — |
| `tools/migration/enrich_birth_dates.py`, `enrich_birth_dates_from_club_lists.py` | none | — |
| `tools/migration/rebuild_derived.py` | none | — |
| `tools/aflw/load_staging.py` (`staging_aflw` grants) | none | — |
| `src/lib/external-afl/current-season-import.ts` | `tests/current-season-import.test.ts`, source-contract only | no database |
| `tools/matching/backtest.ts` | `tests/player-matching.test.ts` | no database |

The mocked admin suites (`tests/awards-admin.test.ts`,
`tests/player-link-mutations.test.ts`, `tests/admin-match-mutations.test.ts`)
stub `AFLDB_IMPORT_DATABASE_URL` with a fake DSN, so they assert that the
mutation path *reaches* for the import role without ever connecting as it.

The investigation's original broader statement that no test opened a connection
as `afldb_import` was false. `awards-reload-links.test.ts` already had narrow,
conditional `AFLDB_TEST_IMPORT_DATABASE_URL` coverage: it asserted
`current_user = afldb_import` and exercised advisory-lock behaviour. That was
useful credential precedent, but it was **not importer role parity**: the actual
awards importer subprocess still received owner-backed
`AFLDB_TEST_DATABASE_URL`. Before this repair, no production importer subprocess
executed as `afldb_import`; the narrow awards role check was isolated, the DSN
was undocumented, and neither `tests/setup.ts` nor the shared integration guard
validated its target.

### First wrong layer
Test harness role selection. The importers, the migrations and `privileges.sql`
are each internally consistent; nothing verifies that the privileges granted are
the privileges the code requires.

### Root cause
Two properties were conflated. `AFLDB_TEST_DATABASE_URL` is an owner DSN because
integration fixtures legitimately need owner privileges — TRUNCATE, sequence
resets, direct writes to tables the app role cannot touch. Rather than separate
privileged fixture setup from the execution of the process under test, each suite
assigns that same DSN to `AFLDB_IMPORT_DATABASE_URL`, so the process under test
loses the only constraint that distinguishes it from the harness around it.

### Prior exposure addressed
Any importer change that begins reading or writing a table the ETL role does not
already hold ships green and fails on first production execution. The blast
radius is not uniform:

- A **read** added to a preflight — the `AFLDB-ISSUE-078` shape — turns a
  protective check into a hard abort, so the safe path becomes the broken one.
- A **write** to a table absent from `afldb_meta.import_writable_tables` fails
  mid-reload; the transactional loaders roll back cleanly, but the run is lost
  and the cause is opaque.
- The `privileges.sql` import block **revokes** anything it does not re-grant, so
  a migration-only grant that is not mirrored there is silently stripped by the
  next reconciliation — a defect that would surface long after the test run that
  approved it.

At investigation time this was not believed to be causing a production failure:
migrations 066, 068 and 070 had been reconciled. The defect was a latent
future-regression exposure, now closed for the supported paths named below.

### Fix
Implemented and validated against the privilege-reconciled rebuilt test database.

- `.env.example` documents `AFLDB_TEST_IMPORT_DATABASE_URL` as an optional
  `afldb_import` login to the same database as owner-backed
  `AFLDB_TEST_DATABASE_URL`; there is no fallback.
- `tests/integration/import-role-parity.ts` centralises static target checks,
  live `current_database()`/`current_user` verification for both credentials,
  an always-rolled-back `DELETE FROM auth_users WHERE false` denial probe, and
  fail-closed child-process/in-process execution helpers.
- `tests/setup.ts` and `tests/integration/guard.ts` reject a configured
  restricted DSN unless it names a `_test` database on the same endpoint and
  database as the owner DSN. Missing restricted credentials remain permitted;
  affected suites skip with an explicit sentence naming the variable.
- The supported Under-22 awards, first-kick-goal, register-DOB and club-list-DOB
  production importer subprocesses now receive only the validated restricted
  DSN. Their fixtures, assertions, locks and cleanup remain owner-backed.
- During integration after AFLDB-ISSUE-093, the retired legacy Draft test remained
  deleted and the same restricted-role contract was ported to its canonical
  successor, `tests/integration/draftguru-import.test.ts`. The importer child now
  uses the shared parity harness while DraftGuru fixtures and assertions remain
  owner-backed.
- `data-editor.test.ts` keeps its owner-backed suite. A separate bounded parity
  test supplies the restricted DSN only while the real `saveMatchSheet`
  mutation runs, proving migration-066 audit writes without demoting fixtures.
- The pre-existing awards advisory-lock test now obtains its connection through
  the shared helper. Its behavioural scope was not broadened.

### Acceptance criteria
1. A restricted test DSN exists (for example `AFLDB_TEST_IMPORT_DATABASE_URL`),
   documented in `.env.example`, subject to the same `_test`-database assertion
   `tests/setup.ts` already applies, and **skipped with a clear message rather
   than failed** when absent, so a checkout without the second credential still
   runs the suite.
2. A shared helper — the natural home is alongside `tests/integration/guard.ts` —
   runs a named importer as a child process under that DSN while fixture setup and
   assertions continue on the owner `sql` handle. Supported process call sites
   preserve their ordinary environment and replace only the child import DSN.
3. The supported importer and mutation paths claimed by this repair have a
   representative run that must succeed under the restricted role. The shared
   harness separately proves an owner-only operation remains denied; this issue
   does not claim exhaustive coverage of every historical importer in the tree.
4. The denial half is real. A test that only proves success cannot distinguish a
   correct grant from a role that was quietly widened.
5. `player_link_suggestions` and the migration-066 audit-table grants are covered
   by the general mechanism, and the hand-written catalogue assertion in
   `first-kick-goal-reload-links.test.ts` is either folded into it or explicitly
   kept as that importer's requirement declaration.
6. A grant present in a migration but missing from
   `tools/maintenance/privileges.sql` is detected, since the reconciler strips it.
   Running `db:privileges:test` before the parity path is the cheapest form of
   this.
7. Privileges are reconciled before the parity paths run, and a child failure
   reports its captured stdout/stderr rather than hiding the database error.

### Explicit non-goals
- **Do not** re-run the existing integration suite as `afldb_import`. Those tests
  legitimately need owner privileges for fixtures; demoting them would break them
  for reasons unrelated to the invariant being tested.
- **Do not** convert `privileges.test.ts` into a requirements test. Confinement is
  the property it asserts well, and it should keep asserting exactly that.
- **Do not** widen any grant to make a test pass. A parity failure is evidence of
  a missing migration, not of an over-strict role.
- **Do not** rework the importers, their reconciliation keys, or the role model.
  This is test infrastructure.
- **Do not** add a second test database or a second CI job.
- Not in scope: `AFLDB-ISSUE-081`, `AFLDB-ISSUE-082`, and general importer cleanup.

### Relationship to migration grants and `privileges.sql`
Importer privileges have two authorities that must agree. Migrations (`045`,
`066`, `068`, `070`) establish grants at a point in time;
`tools/maintenance/privileges.sql` is the reconciler that re-derives the whole set
from `afldb_meta.import_writable_tables` plus a hand-written block of narrow
exceptions, and revokes everything else. A grant that exists in only one of the
two is a live defect in one direction or the other, and both directions are
deployment-order sensitive: as recorded for `AFLDB-ISSUE-027` and again for
migration 070, the migration and `npm run db:privileges` must run before the code
that depends on the grant. Role-parity tests are the missing third leg — they
check the grants against what the code actually asks for, which neither authority
can do on its own.

### Validation
Complete. The rebuilt `afldb_test` had migrations and privileges reconciled
before the focused restricted-role runs, so these successes also prove that
`tools/maintenance/privileges.sql` did not strip a privilege the covered paths
require.

- Initial agent-side DB-free Vitest/typecheck attempts did not execute:
  PowerShell blocked the `.ps1` shims, `tsc` was unavailable through `npm.cmd`,
  and no dependency installation occurred.
- The first user-run focused harness test subsequently exposed one deterministic
  failure (1 failed / 3 passed): explicitly passing `undefined` for the
  restricted DSN activated the function parameter's ambient `process.env`
  default. The harness now requires both owner and restricted DSNs as explicit
  arguments, and every integration caller passes its environment value at the
  call site. A post-fix agent rerun could not start because this worktree's
  `node_modules` resolves into the isolated `D:\dev\afldb` tree and Vite failed
  with `EPERM`; the user must rerun the same focused command.
- Typecheck then identified that the child helper declared caller additions as
  a complete `NodeJS.ProcessEnv`, despite already merging them over
  `process.env`. The option is now correctly a partial override; the merge order
  and final restricted-DSN override are unchanged. The four reported DraftGuru
  acquisition errors remain explicitly outside ISSUE-083.
- The focused first-kick-goal retirement proof then failed before spawning the
  restricted importer because `takeSourceLinked()` assumed a previous canonical
  FKG database load. Setup now performs that canonical load explicitly as owner
  and, only when sparse test data resolves no linked row, marks one unambiguous
  canonical row as the exact owner-backed fixture needed by the retirement
  test. Normal cleanup's canonical restricted reload restores its source-derived
  state; no production importer behaviour or privilege changed.
- Targeting the historical retirement test still exceeded its 120-second budget
  because that test deliberately performs three complete synchronous canonical
  reloads (`refused`, `accepted`, then `back`). `spawnSync` prevents Vitest's
  timeout callback from interrupting an in-flight child, so the nominal timeout
  was reported only after the child returned and the test could continue into
  later work. There is no parent transaction or advisory-lock self-block. A
  dedicated ISSUE-083 proof now performs one accepted retirement reload as
  `afldb_import`, exercising the durable-reader preflight and committed delete;
  the original three-run ISSUE-078 semantic test remains unchanged.
- The first focused legacy honours parity run reached `afldb_import` but failed
  before privilege validation with a foreign-key violation for missing player
  id 1774. Static tracing confirms `hall_of_fame.player_id` and
  `team_selections.player_id` are copied directly from legacy SQLite, paired
  with `import_legacy_afl.py` deliberately preserving each legacy player id as
  `players.id`. That historical migration coupling is incompatible with a
  rebuilt player graph that does not retain those surrogate ids. ISSUE-083 does
  not alter that production identity contract. Its deterministic awards proof
  instead runs the real `under_22` production group, which resolves identities
  against PostgreSQL, records a completed import batch, and reconciles all 330
  canonical rows under the restricted role without requiring legacy players.
- User-run final restricted-role results on 2026-08-27:
  - shared live credential/denial suite: **2/2 passed**;
  - DB-free harness suite: **4/4 passed**;
  - Data Editor `saveMatchSheet` plus migration-066 audit path: **passed**;
  - first-kick-goal accepted-retirement preflight/mutation: **passed, not skipped**;
  - awards canonical Under-22 import: **passed, not skipped** (1 passed / 21 filtered);
  - DOB club-list idempotent reconciliation: **passed**;
  - DOB register cross-pass reconciliation: **passed**.
- PostgreSQL-backed tests were run only by the user, not by the implementing
  agent, preserving the issue's database safety boundary.

- Integration with the canonical ISSUE-093 DraftGuru suite was validated on the rebuilt
  `afldb_test` through the local PostgreSQL tunnel. The first full run executed the
  importer under the restricted parity harness and passed **16/18** tests; the two
  failures occurred before importer execution because the rebuilt database already
  contained the ledger targets, leaving the old test-only `provisionedPlayerIds`
  fallback empty. The fixture now safely borrows an existing unlinked canonical
  player without taking ownership of or deleting it. A focused rerun of the two
  affected live-human-decision tests then passed **2/2**. No importer semantics,
  production data, schema, or privileges were changed by that integration repair.

### Follow-up
The shared mechanism is reusable, but this repair deliberately does not claim
exhaustive parity for every historical or later-added importer. The legacy
`tools/migration/import_draft.py` path and
`tests/integration/draft-reload-links.test.ts` remain retired by ISSUE-093.
Restricted-role coverage was instead carried forward to the supported canonical
DraftGuru successor, `tests/integration/draftguru-import.test.ts`. The legacy
Hall of Fame/honour-team groups are excluded because
they require legacy SQLite numeric player ids preserved by
`import_legacy_afl.py`; the supported awards proof is Under-22 against the
rebuilt PostgreSQL graph. No parity claim is made here for
`tools/migration/import_legacy_afl.py`, `tools/migration/rebuild_derived.py`,
`tools/aflw/load_staging.py`, `src/lib/external-afl/current-season-import.ts`,
`tools/migration/import_fitzroy_core.py`, or
`tools/migration/load_reference_data.py`. Future supported-path tests can reuse
the fail-closed harness without reopening this resolved defect.

## AFLDB-ISSUE-084 — Deploy the ISSUE-044/078 player-link protections to production

- **Status:** Resolved
- **Severity:** High
- **Area:** Deployment / Data integrity
- **Found:** 2026-08-23
- **Resolved:** 2026-08-24
- **Files:** `src/db/migrations/058`–`070` (production-pending),
  `tools/maintenance/privileges.sql`, `tools/migration/import_awards.py`,
  `tools/migration/import_draft.py`, `tools/records/import-first-kick-goal.ts`,
  `artifacts/audits/issue-079-audit-prod-20260823.sql` (to be regenerated
  post-migration)

### Symptom
Production (checkout `a32a0a1`, database `afldb_prod` at migration 057 as at the
2026-08-23 06:57:52+10 ISSUE-079 audit snapshot) does not carry the prospective
player-link protections implemented under `AFLDB-ISSUE-044` and
`AFLDB-ISSUE-078`. The deployed loaders still contain destructive reload
behaviour affecting **all seven** current `LINK_TARGET_TABLES` families:
`import_awards.py` truncates `award_winners`, `award_nominations`,
`hall_of_fame`, `honour_team_members` and `captaincies`; `import_draft.py`
truncates `draft_picks`/`draft_persons`; `import-first-kick-goal.ts` deletes its
`player_achievements` rows. A reload run in production before deployment can
create new dangling `player_link_resolutions` targets.

### Scope
**This is deployment work, not historical remediation.** The `AFLDB-ISSUE-079`
production audit found **no historical dangling targets** (6 resolutions, 0
dangling at the snapshot above), so there is nothing to repair in existing data.
Production remains **prospectively exposed** until this issue is completed.

This issue owns, in order:

1. Apply migrations **058–070** to production.
2. Run `npm run db:privileges` at the points `AFLDB-ISSUE-044` and
   `AFLDB-ISSUE-078` require: migration `068` plus `db:privileges` **before**
   the new honours importer code (or the honours loaders fail closed on the
   resolution read); migration `069` before the new `import_draft.py`;
   migration `070` plus `db:privileges` before the new first-kick-goal importer.
3. Deploy the corrected `import_awards.py`.
4. Deploy the corrected `import_draft.py`.
5. Deploy the corrected `import-first-kick-goal.ts`.
6. Run the one-time `--rekey` per target database as the existing
   `AFLDB-ISSUE-078` Follow-up instructions specify (dev is done; production is
   not).
7. **Regenerate and re-run the ISSUE-079 audit post-deployment.** The existing
   production audit SQL is pinned to migration 057 (assertions S16/S17) and will
   correctly refuse to run once production has migrated past 057; it must be
   regenerated against the post-migration schema, not rerun.

### Expected
Production runs the same keyed, link-preserving reload paths as the repository
and `afldb_dev`, with grants reconciled, and a fresh clean post-deployment audit
recorded.

### Actual
Not yet deployed. Migrations 058–070 unapplied in `afldb_prod`; all three
corrected loaders undeployed; production `--rekey` not run.

### Evidence
`AFLDB-ISSUE-079.md` Phase 0a/0b (production at migration 057, checkout
`a32a0a1`, 84 commits behind local; destructive loader call sites enumerated in
Phase 5) and the audit artifact
`artifacts/audits/issue-079-player-link-integrity-prod-20260823.txt`.
Deployment-order hazards are already recorded in the `AFLDB-ISSUE-044` and
`AFLDB-ISSUE-078` Follow-up sections and in `AFLDB-ISSUE-083` (migration +
`db:privileges` before code).

### Fix
Not yet performed. Deployment only on explicit instruction, following the
existing dev-before-prod convention.

### Validation
Not yet performed. Completion requires the post-deployment regenerated ISSUE-079
audit (step 7) to run clean against the migrated production schema.

### Follow-up (from `AFLDB-ISSUE-080`, resolved 2026-08-23)
The deployed `import_awards.py` in step 3 **must be the ISSUE-080-corrected
version** (with the matching `common.py` and `awards-admin.ts`): deploying the
ISSUE-044 protections without ISSUE-080's ownership scoping ships a loader that
fails closed on decided admin rows and still silently deletes undecided ones.
ISSUE-080 adds no migration and no privilege step. One gate is added inside
this issue's sequence: the **Profile-B ISSUE-080 audit** — regenerated for the
migrated schema, with Plane B rerun from the exact deployment-candidate code
and the exact canonical SQLite artifact selected for the production reload —
runs after the migrations, privileges and corrected loaders are in place and
**before the first awards/honours reload** (step 6/7 territory; full ordering
in `AFLDB-ISSUE-080.md` §7.2 and its ISSUE-084 handoff table). The comparison
against the ISSUE-080 entry's recorded Plane-B baseline uses the **corrected
staleness rule** (2026-08-23): the operative comparison is the canonical
artifact SHA-256 plus the regenerated incoming natural-key counts/fingerprints
— the pre-fix code HEAD/blob IDs are historical provenance only, since
ISSUE-080 itself changes `common.py`/`import_awards.py`. If the artifact
SHA-256, either count or either fingerprint differs, **STOP** and redo the
Plane-A × Plane-B classification; if normalisation/skip/key-derivation code
changed, the new keyset is authoritative and the classification is redone,
never waived; never informally approve a mismatch.

**Load-bearing ordering constraint (2026-08-23, M4): migration
`059_honour_team_member_identity.sql` must already be applied before the
corrected `import_honour_teams` loader runs.** The honour-team raw-input
preflight intentionally classifies using the incoming `player_id` **before**
any player-link decision replay, and replay can later change an in-scope row's
`player_id`; `honour_team_linked_player_uq` (a migration-059 object) is the
final fail-closed backstop if replay would create duplicate
`(team_name, player_id)` identity. If migration 059 is absent, **STOP** — do
not run the corrected production honour-team reload on a pre-059 schema.
Within this issue's existing sequence (migrations before loaders) the
constraint is automatically satisfied, but it must hold even if the sequence
is ever re-ordered.

### Follow-up
Design the helper first and prove it on the first-kick-goal importer, whose
requirements are already known precisely from the `AFLDB-ISSUE-078` review:
SELECT on `player_achievements`, `data_issues`, `player_link_resolutions` and
`player_link_suggestions`; INSERT-only on the two human-contributed tables; no
UPDATE or DELETE on either. Extend to the draft and awards loaders, then decide
per importer whether the untested Python jobs justify their own parity paths or a
single shared smoke path.


### Resolution / Phase 12 Evidence
- **Code Activation:** Target SHA `0da44f9dd71398d2b72fe33f42867861d7eab6e7` deployed and activated at `2026-08-24T20:41:34+10:00`.
- **Migrations:** Applied 058 through 070 (High-water: `070_import_reads_link_suggestions.sql`).
- **Backup:** Gate G1 `afldb_prod-20260824-202119.dump` (SHA256: `d09d7986b7ad35a61b3e1f76f9a86c71f1bbd458ba919d76444e7d2aefeff948`).
- **Privileges:** Phase 6 reconciliation successfully revoked extraneous relations and enforced `afldb_import` explicit grants (INSERT only on data_edits; INSERT+SELECT on player_link_resolutions; SELECT only on player_link_suggestions).
- **Integrity Validation:**
  - ISSUE-080 Profile-B Audit PASSED (no collisions or exposed rows).
  - Phase 9 first-kick-goal `--rekey` PASSED (334 rows mapped, 0 unmatched, 0 duplicates, all surrogate IDs survived unchanged).
  - Phase 10 / Gate G4 Post-070 Audit PASSED (22/22 schema assertions true, all 6 baseline resolutions and 2 baseline suggestions confirmed present, identities unchanged, and targets live).
  - Loader hashes explicitly recorded and preserved in Phase 10 artifacts.
- **Application Health:** Loopback and beta endpoints responsive (HTTP 200). CSP/HSTS headers active on beta proxy.
- **Residual Rollback Limitation:**
  - Gate G1 dump was successfully restored into the disposable dev-host `afldb_restore_test` database.
  - The nine authoritative restored values matched the production Phase-2 comparands.
  - The dump was NOT restore-rehearsed into `afldb_prod` itself because production has no disposable restore-test database.
  - The repository-supported production recovery remains the frozen §3.4 `pg_restore --clean --if-exists` procedure followed by the migration-057 checkout's privilege reconciliation/build.
  - Since Phase 11.1 reopened production writes, the G1 dump must no longer be described as a lossless rollback for activity occurring after service restart.

### Post-Deployment Topology Variance
The `afldb-email-intake.timer` and `afldb-email-intake.service` systemd units are present in the repository (`deploy/`) but were found uninstalled on the production host (neither before nor after this rollout). Nothing was installed as part of ISSUE-084. This variance has been recorded but does not reopen or block the data-integrity rollout of ISSUE-084.

## AFLDB-ISSUE-085 — `import_captaincies` reconciles an unscoped population with no ownership predicate

- **Status:** Resolved
- **Severity:** Low (latent — no second writer exists today)
- **Area:** Data integrity / Import
- **Found:** 2026-08-23 (during the `AFLDB-ISSUE-080` investigation; runbook
  `AFLDB-ISSUE-080.md` §2.2, §4.6, §6, gate G6)
- **Resolved:** 2026-08-26
- **Files:** `tools/migration/import_awards.py` (`import_captaincies`),
  `tools/migration/common.py` (`reload_keyed`),
  `src/db/migrations/042_awards_natural_keys.sql` (`captaincies_natural_uq`)

### Symptom
Latent, structural. `import_captaincies` passes no scope to `reload_keyed`, so
its reconciliation population is the **entire** `captaincies` table — the same
ownership-scoping class `AFLDB-ISSUE-080` fixed on five other paths. No loss is
currently possible, which is why ISSUE-080 deliberately did not modify it: the
issue's evidence threshold required a proven second legitimate owner, and none
exists.

### Evidence
Reconfirmed at this base: the importer is the only fact-row writer for
`captaincies` in the tree — the table remains absent from the `data_edits`
allowlist and `src/lib/ingest/datasets.ts`, with no captaincy create/import
mutation in `src/db/queries/`. Player-link review can update the link fields but
does not own a second fact population. The loader stamps every accepted staging
row with the Wikipedia source, but previously used `sources.get("wikipedia")`
and passed no reconciliation scope. The day a second fact writer exists, its
rows would therefore be classified as vanished and deleted by the next reload
— or abort it if they carry a link decision.

`captaincies_natural_uq UNIQUE (season, club_id, player_name_raw, role)` binds
the fact globally and is source-blind by design (migration 042). After source
scoping, a foreign- or NULL-provenance row occupying an incoming natural key
cannot be adopted: the incoming INSERT would collide with that constraint.

### Root cause
Captaincy reconciliation used an unscoped keyed reload. Although Wikipedia was
the only writer at the time, the reload did not constrain reconciliation to
Wikipedia-owned rows and did not fail closed when a foreign- or
NULL-provenance row occupied an incoming captaincy natural key.

### Expected
The reload is scoped by construction — domain plus `source_id`, the way
`AFLDB-ISSUE-078` scoped `draft_persons` and ISSUE-080 scoped the five affected
paths — before a second writer ever exists, rather than after one loses data.
The `reload_keyed` conjunction machinery and the fail-closed `require_source`
guard ISSUE-080 added make this a small change.

### Fix
Implemented and validated on 2026-08-26.

- `import_captaincies` now resolves `wikipedia` through the established
  fail-closed `require_source` helper and scopes `reload_keyed` to exactly that
  `source_id`, leaving every foreign- or NULL-provenance row outside its
  UPDATE/INSERT/DELETE population.
- The stable reload identity remains `(source_id, source_record_id)`, preserving
  existing row IDs and link-decision behaviour during normal reloads.
- A captaincy-local preflight applies ISSUE-080's
  `ReloadOwnershipCollision` convention to `captaincies_natural_uq`: an
  incoming fact already held outside the Wikipedia scope is named and refused
  before the keyed reload writes, rather than adopted, mutated, or exposed as
  a raw database uniqueness error.
- No schema migration and no `reload_keyed` redesign were required.

### Validation
Full-file attempt executed against `AFLDB_TEST_DATABASE_URL`: **23 total, 3
passed, 19 failed, 1 skipped**. The 19 failures were overwhelmingly unrelated
ISSUE-044/080 cases whose fixtures assume historical Hall of Fame, honour-team,
award, player and legacy-link populations already exist in `afldb_test`; that
assumption is false on the freshly rebuilt test database. The two new ISSUE-085
tests also failed at their own `afldb_test needs a wikipedia-owned captaincy`
baseline assumption. No failure from this run reached or contradicted the
captaincy ownership implementation.

The ISSUE-085 block is now deterministic and self-contained. It creates a
temporary SQLite database containing only the `captaincies` table and the empty
`person_links` table that the selected importer path eagerly reads. Its single
source row uses `player_id NULL`, a valid PostgreSQL reference season, and the
Adelaide club name resolved by the real `ClubResolver`. Test setup explicitly
creates the matching Wikipedia-owned PostgreSQL row; the survival case creates
its own manual-owned row. The block points only its importer processes at that
temporary SQLite path, cleans up only its fixture rows, and removes the
temporary directory afterward. It no longer requires the main repository's
historical `AFLDB_LEGACY_SQLITE`.

Focused ISSUE-085 integration validation passed against a guarded
`AFLDB_TEST_DATABASE_URL` ending in `_test`, with `AFLDB_PYTHON` pinned and no
`AFLDB_LEGACY_SQLITE` dependency:

`npx vitest run tests/integration/awards-reload-links.test.ts -t AFLDB-ISSUE-085`

Result: **2 passed / 0 failed; 21 unrelated tests filtered/skipped** (one test
file passed; duration 7.81 seconds). The executed regressions proved that the
Wikipedia-owned row reconciles under the same stable id, the foreign-owned row
survives unchanged without adoption, a second identical reload is idempotent,
and a foreign-owned row occupying the incoming `captaincies_natural_uq` key is
refused without mutation.

### Follow-up
None. The unrelated ISSUE-044/080 historical-fixture assumptions exposed by
the full-file diagnostic run remain outside ISSUE-085 and were not changed.

## AFLDB-ISSUE-086 — Data-editor edits to source-owned rows can be reverted by the next source reload

- **Status:** Resolved
- **Severity:** Medium
- **Area:** Admin / Data integrity
- **Found:** 2026-08-23 (during the `AFLDB-ISSUE-080` investigation; runbook
  `AFLDB-ISSUE-080.md` §6, §2.4b, gate G5)
- **Resolved:** 2026-08-28 — original durable-override resolution retained below;
  **reopened the same day for one separate schema defect** (migration 073 omitted
  the supporting `admin_user_id` FK index) and **re-resolved 2026-08-28** by
  forward-only migration 075. See "Reopened 2026-08-28" and "Resolution —
  re-resolved 2026-08-28" at the end of this entry.
- **Reopened:** 2026-08-28 (closed the same day)
- **Runbook:** `AFLDB-ISSUE-086.md`
- **Files:** `src/db/queries/data-edits.ts`,
  `src/db/migrations/073_data_overrides.sql`,
  `src/db/migrations/075_data_overrides_fk_index.sql` (reopen repair; **applied
  to `afldb_test` 2026-08-28, after 074**),
  `tools/migration/common.py`,
  `tools/migration/import_fitzroy_core.py`,
  `tools/rebuild/draftguru/import_draftguru.py`,
  `tools/maintenance/privileges.sql`,
  `tests/data-overrides-source-contract.test.ts`,
  `tests/integration/draftguru-import.test.ts`

### Symptom
A data-editor UPDATE to a **source-owned** row could edit columns that the
owning source's next reload rewrote from its extract, silently reverting the
admin correction. This was edit **durability** (overwrite-on-reload), not the
ownership **deletion** class fixed by ISSUE-080.

### Evidence
The live editable surface is `players`, `matches` and `draft_picks`. Admin
edits are intended corrections, and silently reverting them on the next source
reload violates that durability expectation. The original structural finding
was therefore confirmed as a real data-integrity defect rather than documented
as intended behaviour.

### Fix
Migration 073 introduces `data_overrides`, a durable human-authority layer
keyed by stable entity natural key plus field group. `saveEdit` persists only
the fields actually changed by the admin, preserving absent-vs-explicit-NULL
semantics and avoiding accidental freezing of sibling source fields.

`replay_admin_overrides()` reapplies active overrides inside the importer's
existing transaction after source reconciliation. Player durability uses the
stable AFL Tables external identity rather than `players.id`; DraftGuru picks
use `source_id|player_url|draft_year|draft_kind`.

The canonical fitzRoy and DraftGuru import paths replay these overrides before
their transactions complete. `afldb_import` receives SELECT-only access to
`data_overrides`; the table remains outside
`afldb_meta.import_writable_tables`, so importers cannot create, alter or
delete human override authority. `tools/maintenance/privileges.sql` preserves
that narrow grant during privilege reconciliation.

### Validation
- `tests/data-overrides-source-contract.test.ts`: **6/6 passed**.
- Migration `073_data_overrides.sql` applied successfully to `afldb_test`.
- Direct restricted-role replay proof succeeded using `afldb_import`.
- Canonical DraftGuru destructive-reload acceptance test passed cleanly after
  diagnostics were removed:
  `replays a durable admin override after a destructive DraftGuru reload`
  — **1/1 targeted test passed**.
- The acceptance run proved an admin `pick_note` override survives the real
  destructive DraftGuru source reload.

### Follow-up
None for ISSUE-086. Future editable source-owned entities must participate in
the same durable natural-key override/replay contract rather than relying on
surrogate row IDs or importer ownership.

*(The record above is the original resolution and is retained unchanged.)*

### Reopened 2026-08-28 — `data_overrides(admin_user_id)` has no covering index

#### Post-resolution validation (all passed)
- Migration checksum-baseline repair completed successfully.
- Clean rebuild through migration 073 passed final validation **13/13**.
- Migration status **73/73, 0 pending, no drift**.
- DB-free source contract: **6/6**.
- Restricted-role DraftGuru integration: **19/19**.

#### New proven defect
`tests/integration/fk-indexes.test.ts` is **1/2**. Its coverage case reports
`data_overrides(admin_user_id) -> auth_users` as having no index the referential
check can use. Migration 073 declares
`admin_user_id integer NOT NULL REFERENCES auth_users(id)` and creates only
`ix_data_overrides_entity ON data_overrides (entity_type, entity_key) WHERE is_active = true`,
which does not lead with `admin_user_id`. `auth_users` is deliberately absent
from that test's `DELETE_FREE_PARENTS` — migration 071 states this outright and
indexed `data_edits.admin_user_id` on exactly those grounds — so a parent-side
`auth_users` delete sequentially scans `data_overrides`. The suite's second
case (stale-exemption drift) is unaffected and passes.

#### Forward repair
`src/db/migrations/075_data_overrides_fk_index.sql`:

```sql
CREATE INDEX IF NOT EXISTS ix_data_overrides_admin_user_id
  ON data_overrides (admin_user_id);
```

Unconditional, non-unique, non-partial, no `CONCURRENTLY` — the shape
migrations 041 and 071 established for a NOT NULL foreign-key column.
Migration 073 is **not** edited: it is applied and checksum-baselined, so the
repair is forward-only.

#### Application order — 074 then 075, both applied 2026-08-28
Migration 075 was deliberately **held** until `AFLDB-ISSUE-096`'s migration 074
could apply first, so the two pending migrations landed in normal filename order
rather than 075 jumping a lower-numbered pending file. The ordered run then
succeeded:

```text
074_source_observation_spine.sql ... ok
075_data_overrides_fk_index.sql ... ok
Applied 2 migration(s).
```

Post-apply ledger state, `afldb_test`: **75 migration file(s), 75 already
applied, 0 pending** — **no checksum drift**. Migration 073 was **not edited
after application** at any point; the repair is forward-only, which is why it is
a new migration rather than a change to 073.

#### Validation of the repair
- `tests/data-overrides-source-contract.test.ts` extended (within the existing
  `Migration/schema contract` test) to prove migration 075 exists, creates
  `ix_data_overrides_admin_user_id`, targets `data_overrides`, indexes
  `admin_user_id` as the leading/only key, uses `IF NOT EXISTS`, and is not
  unique, not partial and not `CONCURRENTLY`.
  Command: `npm test -- tests/data-overrides-source-contract.test.ts`.
- **`tests/integration/fk-indexes.test.ts` 2/2 passed** against `afldb_test`.
  That suite reads `pg_catalog` rather than asserting index names, so both cases
  carry weight: every foreign key whose parent can be deleted from has a usable
  leading-column index, and no stale `DELETE_FREE_PARENTS` exemption remains.
  The suite was never modified to obtain the pass.
- Privilege reconciliation completed successfully.
- Post-migration fingerprint, `afldb_test`:
  `c5afad8cd3e6ff6417e429807bd7dfb4f8da096a84d691e63383691438722227`.

### Resolution — re-resolved 2026-08-28

**RESOLVED 2026-08-28.** The reopening was **solely** the missing supporting
index on `data_overrides(admin_user_id) -> auth_users(id)`, a schema-coverage
omission in migration 073. It was **never** a defect in the durable
admin-override behaviour, and that behaviour **remains validated** by the
original resolution's evidence: `tests/data-overrides-source-contract.test.ts`
**6/6** and `tests/integration/draftguru-import.test.ts` **19/19**, the latter
proving under the restricted importer role that an admin override survives a
destructive source reload.

Repaired forward-only in `src/db/migrations/075_data_overrides_fk_index.sql`
with 073 untouched after application; 075 held until 074 could apply first;
**074 then 075 applied cleanly**; ledger **75/75, 0 pending, no drift**; **FK
catalogue gate 2/2**; privileges reconciled; fingerprint
`c5afad8cd3e6ff6417e429807bd7dfb4f8da096a84d691e63383691438722227`.

All evidence is from **`afldb_test`**. **No production or `afldb_dev`
application is claimed.** Full record: `AFLDB-ISSUE-086.md`.

## AFLDB-ISSUE-087 — Validate the release candidate and promote `origin/main`

- **Status:** Resolved — successor-4 candidate `0da44f9` validated in full,
  R8 PASS, and promoted to `origin/main` at R9 (non-force fast-forward,
  2026-08-24); **no production deployment occurred in this issue**
- **Severity:** High
- **Area:** Deployment / Release management
- **Found:** 2026-08-23 (planning session; supersedes the planning handoff
  `AFLDB-ISSUE-087-PLANNING-HANDOFF.md`)
- **Resolved:** 2026-08-24
- **Runbook:** `AFLDB-ISSUE-087.md` — the authoritative execution contract
  (frozen); successor-4 execution per `AFLDB-ISSUE-087-S4.md` (approved),
  with `AFLDB-ISSUE-087-R6-HANDOFF.md` and `AFLDB-ISSUE-087-S4-RESUME.md`
  recording intermediate verified state
- **Original candidate:** `0a862557bad9ad1a6abc2522a90038a779847fed`
  (short `0a86255`, `fix(import): scope award and honours reload ownership`)
- **Current candidate (successor-4):**
  `CANDIDATE_SHA = 0da44f9dd71398d2b72fe33f42867861d7eab6e7` (short `0da44f9`,
  `test: guard nl-stress tableNote read against absent details element`, tree
  `bb12cc390547f7f2c41dd4147b6559bc9ac94a6c`)
- **Files:** `AFLDB-ISSUE-087.md`; validation touches the whole candidate tree
  and, read-only, the production Caddyfile and `afldb_prod`

### Symptom
`origin/main` (`9be7f26`, migration 061) cannot be promoted to the candidate
without validation. The deployment delta `a32a0a1..0a86255` is **87 commits**
(Range A 32 undeployed-on-main + Range B 55 promotion delta), and the candidate
is a *prefix carrying a large ride-along set*: ~24 rewritten public routes, the
NL parser moving PARSER_VERSION 13 → 25, a new admin data-editor, a new
confidence-matching subsystem, current-season ingestion with outbound network
calls, a themeable frontend, and six scratch `.ts` files sitting inside
`tsc --noEmit` scope. None of it has route-level, production-configuration or
candidate-build validation.

### Evidence
Established during the planning investigation and recorded in full in the
runbook and the planning handoff:

- complete 87-commit two-axis classification, no omissions;
- migration provenance 058–070 complete, none UNKNOWN;
- `9be7f26` and `a32a0a1` are both ancestors of the candidate;
- net `package.json` delta is two npm script entries; `package-lock.json`
  unchanged end-to-end;
- `0a86255..origin/dev` differs only in `IssuesIndex.md` and `issues.md`;
- **F1** six root scratch `.ts` files are inside `tsc` scope
  (`tsconfig.json:21-22`);
- **F2** `/grid-solver` is a public route gated by `requireAudience`, so
  ISSUE-076 exposure is a **runtime setting**, not a code property;
- **F3** `577a21b` did not introduce the anonymous suggestion write path;
- **F4** `924ad69` matches the ISSUE-068 H7 experiment on component, hook and
  behaviour, but the expected diagnostic build was **never proven live** and H7
  was **never validated**.

### Fix
Not a code fix. Execute the fifteen gates D1–D15 through phases R0–R9 in
`AFLDB-ISSUE-087.md`, then — only on explicit user approval at the R9
checkpoint — fast-forward `origin/main` to `CANDIDATE_SHA` with a normal
(never forced) push.

Contract properties that must not be weakened:

- **HALT-first failure semantics.** An unexpected failure halts, preserves
  evidence, changes no tracked source, and is classified as a candidate
  source defect, a candidate test defect, an environment problem, or
  unexplained. Only the first two force a successor candidate.
- **D6 `npm run typecheck` is the first substantive candidate-source gate**,
  after provenance, environment, DSN identity and `npm ci`.
- **ISSUE-081 isolation is by invocation:** `awards-reload-links`,
  `draft-reload-links` and `first-kick-goal-reload-links` each run in their own
  `npm test` invocation, and `release-gates` in a fourth.
- **No production mutation**, no `main` push before R9, and no deletion of
  historical `nl_search_log` telemetry.

### Successor lineage (recorded 2026-08-24 at the pre-R9 ledger sync)

Every rejection below is a **candidate tracked-test defect** classification —
no successor was forced by a candidate source/runtime defect, and validation
data was never implicated:

1. `0a86255` — original approved candidate. Superseded after a tracked-test
   defect in the NL feedback boundary suite (repaired by successor-1,
   `test: unpin useFormStatus from NL feedback boundary suite`).
2. **Successor-1** `9255196d8acb82edf3f33184489c9a1fafe087bf` — rejected
   (tracked-test defect lineage: stale release E2E coverage/home metadata,
   repaired by successor-2); superseded.
3. **Successor-2** `38ed6afb6de764f038532d336254c66ea362ceff` — **REJECTED at
   R6.3**: two stale tracked E2E locators (`Grid Solver Validation` used
   `input[type="text"]` where PlayerPicker renders `input[type="search"]`;
   `season → match` used a stale h3 Grand Final locator where the UI renders
   `details > summary > h2`). Evidence preserved at
   `/tmp/afldb-issue087-evidence-38ed6af`.
4. **Successor-3** `63eb9d2dc8fe24bfa4e54a31bc5a31ac7f541906` (tree
   `d8dece21…`, `test: repair release e2e locators`) — **NOT rejected by its
   observed D4 failure.** D4 HALTed (`D4_EXIT=143`, 840/1440 observed) and was
   adjudicated a **tracked harness defect**: `readAnswerShape`'s unguarded
   `details .muted` `textContent()` auto-waits unboundedly on the
   `unanswerable` panel shape, which renders no `<details>`. D4 was therefore
   unadjudicable at successor-3, and successor-4 exists solely to make D4
   completable. Evidence preserved at `/tmp/afldb-issue087-evidence-63eb9d2`
   (21 files, SHA-verified) and under run tag
   `issue-087-63eb9d2-20260823T130728Z` (telemetry retained — never delete).
5. **Successor-4** `0da44f9dd71398d2b72fe33f42867861d7eab6e7` — current
   candidate. Delta from successor-3: exactly
   `tests/nl-ui/nl-stress.spec.ts` (+10/−1), the count()-guarded `tableNote`
   read. Follow-ups `AFLDB-ISSUE-088` (harness timeout policy) and
   `AFLDB-ISSUE-089` (per-batch observation durability) record the deliberately
   unrepaired remainder of the harness-defect class.

### Validation
**Updated 2026-08-24 (successor-4 `0da44f9`).** The original
"none performed" planning state is historical. At successor-4, per the
S4 runbook every candidate-bound gate restarted in full:

- **S4-2 / R2** — CLOSED PASS IN FULL: provenance/ancestry exact (parent
  `63eb9d2`; `9be7f26` and `a32a0a1` proven ancestors), delta allowlist exact,
  all nine frozen sensitive/config blobs matched, 66-file `.test.ts` manifest
  byte-identical, migration series 70 files ending `070`, frozen validation
  `.env` SHA `44d19e42…a3eb`, DSN inventory exact and all four
  identity/read-only probes PASS.
- **S4-3 / R3** — `npm ci` clean (0 vulnerabilities); `db:status` both targets
  70/70, high-water 070, no drift; typecheck exit 0, zero diagnostics.
- **S4-4 / R4** — 28 files / 843 tests all green; isolated
  `tests/site-settings.test.ts` reproduced the exact accepted ISSUE-072
  signature (now including the `pageIntros` observation, recorded there).
- **S4-5 / R5 a–g** — PASS with exactly the expected ISSUE-073 four-FK
  signature and the single expected §9.4b awards skip;
  `AFLDB_TEST_IMPORT_DATABASE_URL` proven unset.
- **S4-6..S4-8** — successor-3 runtime retired; fresh build with new
  fingerprints (successor-3's are historical only); posture-1 R6.3 (92-test
  E2E shape, both repaired locators passing desktop + mobile), R6.4 nine-route
  matrix and R6.5 wiring PASS; posture-2 recreated with BUILD_ID and
  `server.js` SHA proven identical across the switch.
- **S4-9** — focused 3-row liveness probe PASS: exit 0, both known
  `unanswerable` fixtures returned promptly with `tableNote === null`; the
  answered row's shape unchanged.
- **S4-10 / D4 rerun — COMPLETE and adjudicable:** `observed === total ===
  1440`, harness exit 0, previously-parked batches 003 and 009 ran to
  completion, 1,368 telemetry rows under the unique successor-4 run tag
  (`issue-087-0da44f9-*`, preserved), literal `accept` baseline and end state
  0 rows.
- **S4-11 / authoritative hydration extraction — PASS:**
  `report.hydration.totalHydrationErrors = 8` (0.56% of 1,440), inside the
  frozen 0–71 PASS band (≥72 HALT). 8 error-carrying observation rows and 8
  complete hydration incident directories (8/8 files each, `metadata.json`
  present) cross-check. ISSUE-068/H7 remains open — a green D4 does not
  resolve it.
- **S4-12 — COMPLETE:** pre-R9 ledger sync recorded, then R8 and R9 executed
  and adjudicated PASS — see Resolution below.

### Resolution (2026-08-24)

Root cause: a release-management gap, not a code defect — `origin/main`
(`9be7f26`, migration 061) was materially behind the intended deployment
state, and the candidate prefix carried a large unvalidated ride-along set.
The retained fix is the executed contract itself: full D1–D15 / R0–R9
validation of successor-4, then promotion of exactly the validated SHA.

- **R8 topology re-proof — PASS (all six proofs):** candidate
  `0da44f9dd71398d2b72fe33f42867861d7eab6e7` unchanged (tree
  `bb12cc390547f7f2c41dd4147b6559bc9ac94a6c`); `origin/main` `9be7f26…` and
  production `a32a0a1…` both proven ancestors; post-candidate delta
  `0da44f9..origin/dev` exactly one docs-only commit (`18d2180`, ledger paths
  only, inside the allowlist).
- **R8 cleanup — PASS, without `--force`:** successor-4 harvest re-verified
  against its canonical manifest (70/70 SHA-exact) before teardown; posture-2
  runtime retired gracefully with port 3190 proven free; staged beta-secret
  file securely removed (`beta_access_codes` rows untouched — revocation was
  never approved); both validation worktrees (`/tmp/afldb-release-0da44f9`,
  `/tmp/afldb-release-63eb9d2`) removed via `git worktree remove` without
  `--force`; evidence preserved at
  `/tmp/afldb-issue087-evidence-{0da44f9,63eb9d2,38ed6af}` plus all run-tag
  telemetry; the repo `data/records/first-kick-goal.csv` source proven
  unchanged; dev 3100 untouched and healthy.
- **R0 re-confirmed immediately pre-push:** GitHub webhooks empty, zero
  workflows, no writing integrations/deploy keys, `main` rules unchanged;
  droplet timers and cron carry no pull/deploy automation.
- **R9 promotion — PASS:** on fresh explicit approval, non-force fast-forward
  `9be7f26d37579104d633e1f0af647cb635ff100e` →
  `0da44f9dd71398d2b72fe33f42867861d7eab6e7`; remote (`git ls-remote`) and
  local `origin/main` verified at the candidate; `origin/dev` remains
  `18d2180` and the docs-only dev tip was **not** promoted.
- **Post-push signals clear:** no Actions run and no integration/deployment
  activity triggered; production HEAD remained `a32a0a1` with `afldb.service`
  active — the push did not auto-deploy production.

**ISSUE-087 deployed nothing to production.** `main` now carries migration
070 and the validated feature set, so the ISSUE-084 P0.2 promotion
prerequisite is satisfied; ISSUE-084 itself remains a separate production
runbook, HALTed at P0.2, and must restart with fresh P0.1/P0.2 evidence and
its own `<TARGET_SHA>`.

### Retained validation-bootstrap notes (for any future candidate validation)

- All three role passwords (owner, auth, app) required splicing into the
  validation `.env` from the authoritative dev configuration.
- Three untracked inputs must be provisioned into a validation worktree: the
  legacy SQLite path, a psycopg-capable python, and the ignored
  first-kick-goal extract (SHA/size per the frozen runbook).
- Non-interactive SSH needs explicit NVM PATH pinning (node `v22.23.2` /
  npm `10.9.8`).
- Strip ANSI escape sequences into a temporary representation before any regex
  parsing of Vitest summaries; never gate on raw coloured output (two
  session-authored wrapper false negatives occurred: R6.4 row-8 regex, R4 ANSI
  grep).

### Ledger sequencing (resolution of the R6-handoff question)

Uncommitted `IssuesIndex.md`/`issues.md` changes are never swept into a
candidate: the candidate is frozen at `0da44f9`, ledger updates are committed
to `dev` as path-limited docs-only commits **after** the candidate, and R9
promotes `main` by fast-forwarding to exactly the candidate SHA — post-candidate
ledger commits on `dev` therefore never reach `main` through R9. The R8
topology proof adjudicates the post-candidate delta against the docs-only
allowlist.

### Dependency on AFLDB-ISSUE-084
`AFLDB-ISSUE-084` is **HALTed at P0.2** and is **not advanced by this issue**.
P0.2 failed because `origin/main` does not contain the approved schema/code
state — main carries migrations only through 061 while the frozen ISSUE-084
runbook is pinned to 070. ISSUE-087 exists to close that gap on `main`.

ISSUE-087 may **reuse** an ISSUE-084 reviewed command, SQL envelope or
transport as a safe mechanism; that is transport reuse only. It never executes
or advances an ISSUE-084 phase, and every production read-only result belongs
to ISSUE-087. `AFLDB-ISSUE-084.md` is frozen and unmodified, and no
`<TARGET_SHA>` is fixed inside it.

After a successful `main` promotion, ISSUE-084 restarts from its required
re-entry point with fresh P0.1/P0.2 evidence and establishes `<TARGET_SHA>` on
its own terms. Production deployment never occurs inside ISSUE-087.

### Follow-up
- **Suspected, non-blocking:** `src/app/admin/current-season/actions.ts`
  (~L75-80) calls `revalidatePath` inside a server action, and prior-session
  evidence reported a Next 15.5 client hang involving `revalidatePath`-in-action.
  It is **not** established that this exact action is reproducibly affected at
  `CANDIDATE_SHA`. **No separate issue is created from prior-session memory
  alone**; one may be proposed only on targeted current-candidate evidence or an
  existing authoritative issue covering this exact path.
- A `player_match`-grain regression for the `plan.ts:911-913` period-split
  decline would strengthen D11, but writing it modifies tracked source and would
  force a successor SHA. Deferred to a future candidate.
- Standing prohibitions that outlive this issue if the candidate ships: do not
  set a `frontendTheme` other than `classic` (ISSUE-077); do not widen
  `grid_solver.audience` to `public` (ISSUE-076); do not use admin bulk approve
  (ISSUE-082); do not execute the 22 Under 22 importer (out of ISSUE-084 scope).
- **Recorded 2026-08-24:** `AFLDB-ISSUE-088` (NL-UI harness timeout policy and
  latent unbounded waits) and `AFLDB-ISSUE-089` (per-batch observation
  durability) carry the deliberately deferred harness hardening — deferred so
  the release gate would not be re-proved against a larger delta and so timeout
  values can be chosen from the completed D4 timing evidence rather than
  guessed.

## AFLDB-ISSUE-088 — Playwright timeout policy and latent NL-UI waits

- **Status:** Resolved
- **Severity:** Low
- **Area:** Tests / Tooling
- **Found:** 2026-08-24 (adjudication of the `AFLDB-ISSUE-087` successor-3 D4
  HALT; recorded at the pre-R9 ledger sync per `AFLDB-ISSUE-087-S4.md` §3)
- **Resolved:** 2026-08-27
- **Files:** `playwright.config.ts`, `playwright.admin-nav.config.ts`,
  `playwright.nl-stress.config.ts`, `tests/nl-ui/nl-stress.spec.ts`,
  `tests/nl-ui/timeout-policy.ts`,
  `tests/playwright-timeout-policy.test.ts`

### Symptom
`playwright.nl-stress.config.ts` sets no `actionTimeout` or `globalTimeout`;
Playwright Test's default `actionTimeout` is `0`, so any auto-waiting locator
action in the harness is unbounded, capped only by the 30-minute per-batch
`timeout`. One reachable instance (`readAnswerShape`'s unguarded
`details .muted` `textContent()` on the `unanswerable` panel shape, `:835`)
deterministically parked successor-3's D4 batches for 30 minutes each and made
the release gate unadjudicable.

### Current state
**2026-08-27 timeout audit — classification: PARTIALLY FIXED.** The `:835`
instance was repaired in ISSUE-087 successor-4 (`0da44f9`, count()-guarded
read), but the repository still has the remainder below. No executable file
had been edited when this inventory was recorded.

| Harness before ISSUE-088 changes | Test timeout | Expect timeout | Action timeout | Navigation timeout | Global timeout | Retries / workers | Other bounds |
|---|---:|---:|---:|---:|---:|---|---|
| Ordinary deterministic E2E (`playwright.config.ts`) | 30 s | 5 s Playwright default | 0 (unbounded at action layer) | 0 (unbounded at navigation layer) | 0 (disabled) | local 0 / CI 1; default 50% logical CPUs; fully parallel; desktop + mobile | local `webServer` readiness 60 s; 46 tests/project, 92 total before skips |
| Admin navigation diagnostic (`playwright.admin-nav.config.ts`) | 15 min/test | 5 s default | 0 | 0 | 0 | 0; one worker; setup then two diagnostic tests | both custom `waitForFunction` calls explicitly 60 s; fixed 250 ms and <=3 s visual sampling sleeps |
| NL-UI stress (`playwright.nl-stress.config.ts`) | 30 min/batch | 5 s default | 0 | 0 | 0 | 0; `NL_UI_WORKERS`, default 4; fully parallel; setup dependency | each primary `page.goto` explicitly uses `NL_UI_TIMEOUT_MS`, default 15 s; default 100 questions/batch; documented 12,000-load run takes about one hour |
| Vitest (`vitest.config.mts`, not a Playwright harness) | 30 s/test | assertion-controlled | N/A | N/A | no suite policy | Vitest-managed | hook timeout 30 s |

Inventory details:

- no `test.setTimeout(...)`, `test.setTimeout(0)`, literal `timeout: 0`,
  `page.setDefaultTimeout`, or `page.setDefaultNavigationTimeout` exists;
- ordinary E2E has no custom polling/retry loop, promise race, child process or
  server-ready loop. Its locator/navigation/request waits are indirectly
  capped by the 30-second test timeout. The built-in `webServer` child and
  health polling are explicitly capped at 60 seconds;
- the admin diagnostic's loops are finite (3 rounds over 14 routes and five
  screenshot offsets). Both polling calls use a 60-second deadline;
- NL global setup is synchronous finite directory cleanup; there is no global
  teardown or custom server-ready loop. Its DOM traversal `while` stops at the
  document or depth 8; its clean-control retry loop stops after 3 attempts;
- `waitForTimeout(250)`, bounded visual offsets through 3,000 ms, and the NL
  clean-control `waitForTimeout(300)` are deliberate measurement/capture
  delays, not polling escape paths;
- the separate plan-level `npm run nl:stress`/250k tooling is not invoked by
  either Playwright script and remains outside this Playwright policy change;
- no CI wrapper invokes Playwright in this tree. `package.json` exposes only
  `test:e2e` (default config) and `nl:ui` (separate NL config); the admin
  diagnostic config is manual.

Repository-wide child-process search also found 21 synchronous `spawnSync`
calls with no child timeout across `tests/draftguru-acquisition.test.ts`,
`tests/club-list-sources.test.ts`, `tests/fitzroy-core-import.test.ts`,
`tests/reference-data.test.ts`, `tests/under-22-source.test.ts`,
`tests/under-22-importer.test.ts` and the awards/DOB/draft/first-kick-goal
integration reload suites. Vitest's 30-second timer cannot pre-empt a blocked
synchronous OS call. Two tooling provenance reads similarly use synchronous
Git children (`tools/matching/backtest.ts`, `tools/nl/v2-runner.ts`). None is
reachable from `test:e2e`, `nl:ui`, any Playwright config/global setup, or a
Playwright helper. They are therefore genuine pre-existing child-wait risks
outside ISSUE-088's executable graph; changing DraftGuru/importer/NL-plan
stress tooling would violate this task's explicit scope prohibitions, so no
such file was changed and no general test-cleanup follow-up was manufactured.
The unreferenced root `scratch-playwright.ts` is likewise outside every package
script/config/CI path: its library actions use Playwright's finite library
defaults, while its final `browser.close()` has no separate manual deadline if
someone elects to run that scratch file directly.

The waits still lacking a useful direct deadline are:

- `readAnswerShape`'s `h2.textContent()` is protected only by the application
  invariant and the 30-minute batch timeout;
- `await doc.serverHtmlPromise` and `readHydrationProbe(page)` are arbitrary
  promises, so an action timeout does not substitute for a manual deadline;
- both hydration-artifact full-page screenshots have no explicit timeout and
  suppress failures with `catch(() => null)`; the first was the historical
  `:945` site, and the same pattern also exists in the clean control.

These per-operation waits are indirectly bounded by the 30-minute test
timeout, so they are not infinite in isolation. The genuinely unbounded policy
scope is the whole Playwright run: all three configs leave `globalTimeout` at
zero, so setup/worker/teardown failure has no runner-level deadline.

### Audited repair plan (2026-08-27)

Keep each harness independent:

- ordinary E2E: 10-second actions, 30-second navigation/test timeout, and a
  30-minute global cap. Ten seconds matches the suite's slowest existing
  explicit UI readiness allowance; 30 minutes is a fail-fast ceiling for a
  normally short 92-case run, not an attempt to permit every case to exhaust
  its individual timeout;
- admin diagnostic: 60-second action/navigation limits and a 60-minute global
  cap. The per-navigation measurement already defines 60 seconds, while the
  three sequential tests can consume at most 45 minutes of test budgets;
- NL-UI stress: action/navigation and manual capture deadlines use the
  existing positive `NL_UI_TIMEOUT_MS` contract (15 seconds by default), with
  a 2-hour global cap. This preserves the separately documented approximately
  one-hour 12,000-load workload with one full-run margin without importing
  ordinary E2E limits;
- retain the 30-minute NL batch timeout: it is a batch crash backstop, not a
  substitute for action, navigation, promise or global deadlines;
- make the heading read count-guarded, manually deadline the raw response body
  and hydration probe with labelled errors, and give both forensic screenshots
  explicit deadlines plus labelled failure diagnostics.

Rejected/amended approaches:

- do not apply one timeout set to all configs: the deterministic suite, 15-route
  timing diagnostic and 12,000-load sweep have different semantics;
- do not raise the 30-minute batch timeout or add retries; either would mask
  the issue or duplicate stress observations;
- do not use only `globalTimeout`: it cannot identify the individual action or
  navigation that wedged;
- do not use only `actionTimeout`: it does not bound `response.text()` or the
  hydration-probe promise;
- amend the historical “count-guard all four sites” proposal: count-guarding is
  correct for an optional locator, but impossible for response-body/probe
  promises and inappropriate for screenshots;
- the successor-4 observation files containing the promised raw timing
  distribution are not retained in this worktree. Values therefore come from
  the live 15-second navigation contract, the diagnostic's existing 60-second
  settle contract, the documented approximately one-hour full sweep, and the
  finite suite/test counts—not invented per-action percentiles.

### Evidence
Successor-3 D4 (`D4_EXIT=143`, 840/1440 observed, batches 003/009 parked at
their first `unanswerable` question, 004/010/011/012 never started) plus the
source proof recorded in `AFLDB-ISSUE-087-S4.md` §1. The completed successor-4
D4 now provides `elapsedMs`/`timingSummary` for all 1,440 observations — the
evidence base for choosing values.

### Fix
Implemented 2026-08-27, without changing production application code:

- all three configs now state the finite action, navigation, test, expect and
  global timeout policy recorded above;
- NL's `NL_UI_TIMEOUT_MS` is parsed once as a positive safe integer and shared
  by config, primary navigation and manual capture deadlines, so `0`, negative,
  fractional, non-numeric and infinite overrides fail before a run starts;
- the optional answer heading is count-guarded;
- raw document-response reads, hydration-probe evaluation, failing/clean DOM
  snapshots and clean-page close use a labelled `Promise.race` deadline;
- failing and clean forensic screenshots pass the same explicit timeout and
  log the corpus id plus the failed capture operation instead of silently
  returning `null`;
- the NL batch timeout remains 30 minutes, retries remain zero, and the
  independent default worker count remains four.

Exact executable/test files changed:

1. `playwright.config.ts`
2. `playwright.admin-nav.config.ts`
3. `playwright.nl-stress.config.ts`
4. `tests/nl-ui/nl-stress.spec.ts`
5. `tests/nl-ui/timeout-policy.ts` (new)
6. `tests/playwright-timeout-policy.test.ts` (new)

Tracking files changed: `issues.md`, `IssuesIndex.md`, `CHANGELOG.md`.

### Validation
DB-free/static validation on Windows, 2026-08-27:

- `npx vitest run tests/playwright-timeout-policy.test.ts` did not start
  Vitest because local PowerShell policy blocked `npx.ps1`; no test result;
- `.\node_modules\.bin\vitest.cmd run tests/playwright-timeout-policy.test.ts`
  also did not start tests: Vite received `EPERM` while trying to create
  `node_modules/.vite-temp/...` through the read-only dependency junction;
- `.\node_modules\.bin\vitest.cmd run --configLoader runner tests/playwright-timeout-policy.test.ts`
  — PASS twice, 1 file / 6 tests; final post-edit rerun 479 ms. `--configLoader runner` avoids Vite trying
  to write its temporary bundled config inside the read-only `node_modules`
  junction target;
- `npm.cmd run typecheck` — FAIL with exactly four pre-existing/out-of-scope
  diagnostics in `tests/draftguru-acquisition.test.ts` at lines 299, 302, 479
  and 592 (`string | NonSharedBuffer` has no `.trim()`). No ISSUE-088 file
  produced a diagnostic. DraftGuru was not changed;
- post-change static search — PASS: no literal `timeout: 0`,
  `test.setTimeout(0)`, `page.setDefaultTimeout`, or
  `page.setDefaultNavigationTimeout` in the executable Playwright scope;
- during implementation, no DB, browser, server, network, migration or NL
  stress command ran;
- final user-run browser liveness proof — PASS: `npm.cmd run nl:ui` against
  `afldb-ui-questions-60-real-user-decline-v3-20260822.csv` with
  `NL_UI_LIMIT=2`, `NL_UI_BATCH=2`, `NL_UI_WORKERS=1` and run tag
  `issue-088-timeout-liveness-20260827` completed with exit 0: 2 passed in
  5.2 s; beta-gate setup passed with analytics declined; the
  `decline_001–decline_002` batch completed in 2.6 s; pass/fail/unscored was
  2/0/0; outcomes were 0 answered, 2 unanswerable, 0 absent, 0 HTTP errors and
  0 page errors; filler disagreements, client errors and hydration errors were
  all zero.

The generated ignored `tsconfig.tsbuildinfo` created by typecheck was removed;
it is not a retained change.

### Resolution (2026-08-27)

All ISSUE-088 gates are satisfied. The final root cause was reliance on
Playwright's zero action/navigation/global defaults, with a 30-minute NL batch
timeout acting as an excessively broad indirect backstop for optional locator
reads and arbitrary capture promises. The retained fix gives ordinary E2E,
the admin diagnostic and NL stress independent finite policies, directly
bounds the NL promises/actions that carried the latent risk, rejects invalid
zero/non-positive overrides, and preserves labelled diagnostics.

The 6/6 DB-free contract proves the configured timeout layers and manual
deadline behaviour. The 2/2 real-browser proof demonstrates that the shared
policy loads in Playwright and both known-unanswerable shapes complete promptly
without timeout, page error, browser/client error or hydration error. No
production application source changed. The unrelated synchronous
`spawnSync`/tooling waits and four DraftGuru typecheck diagnostics remain
explicitly outside ISSUE-088. No full ordinary E2E or full NL stress run is
required for resolution, and there is no remaining blocker or follow-up.

## AFLDB-ISSUE-089 — NL-UI stress harness loses a batch's observations when the batch does not complete

- **Status:** Resolved
- **Severity:** Low
- **Area:** Tests / Tooling
- **Found:** 2026-08-24 (adjudication of the `AFLDB-ISSUE-087` successor-3 D4
  HALT; recorded at the pre-R9 ledger sync per `AFLDB-ISSUE-087-S4.md` §3)
- **Resolved:** 2026-08-25
- **Files:** `tests/nl-ui/nl-stress.spec.ts` (single post-loop
  `appendFileSync`, `:1099-1103`)

### Symptom
A batch's observations are persisted by one `appendFileSync` after the batch
loop finishes, so a parked or timed-out batch loses all (~100) of its
observations even though the corresponding `nl_search_log` telemetry rows
exist.

### Evidence
Proven in the successor-3 D4 HALT: partial batches 003 (`user_0201`–`user_0242`)
and 009 (`user_0801`–`user_0803`) were invisible in `nl-ui-out`, and a
telemetry correlation (887 rows / 885 distinct questions reconciling exactly
against 840 persisted observations) was required to establish what actually
ran. Secondary defect recorded in `AFLDB-ISSUE-087-S4.md` §1.

### Fix
Moved the `appendFileSync` call into the batch loop in `tests/nl-ui/nl-stress.spec.ts`. Each completed observation is appended to the worker JSONL file immediately after `observe()` returns. The in-memory `observations.push(observation)` was preserved for downstream batch crash reporting, and the old post-loop bulk append was removed.

### Validation
- **Focused Regression:** A new source-contract regression was added to `tests/nl-ui-corpus.test.ts` to assert that incremental persistence exists and post-loop bulk append does not. The suite passed 30/30.
- **Supplemental Smoke:** A 3-question Playwright smoke was not executed past setup because `AFLDB_E2E_BETA_CODE` was absent. This is an environment prerequisite block, not a test failure of the implementation.

### Follow-up
None.

## AFLDB-ISSUE-090 — DOB enrichment conflict writes are not pass-scoped or idempotent

- **Status:** **Resolved**
- **Severity:** Medium
- **Area:** Data integrity / Import
- **Found:** 2026-08-25 (first routine post-`AFLDB-ISSUE-084` release validation; the
  frozen `release-gates.test.ts` duplicate-issue gate)
- **Resolved:** **2026-08-28**
- **Final validation (operator-run, canonically rebuilt `afldb_test`):**
  `tests/integration/dob-enrichment-issues.test.ts` **27/27** ·
  `tests/integration/release-gates.test.ts -t "matches players on the profile URL rather than
  the name"` **1/1** (63 skipped; the repaired canonical pin reads **13,275**) ·
  `tests/integration/privileges.test.ts` **24/24**, **no grant widened**.
  Resolved against the amended standard at `AFLDB-ISSUE-090.md` §27.4 — **not** against a
  wholly green `release-gates.test.ts`, which it never was and is not claimed to be.
- **Runbook:** `AFLDB-ISSUE-090.md` — the approved plan, authoritative for the full
  evidence chain, the D1-D5 decisions, the migration design and the HALT conditions.
  Planning COMPLETE/APPROVED; **implementation COMPLETE and validated (2026-08-28)** — the
  amended acceptance standard is §27.4 and the resolution record is §27.6. `AFLDB-ISSUE-091`'s
  migration-checksum blocker is Resolved. Migration 072 is APPLIED to `afldb_test`
  (2026-08-25; `db:status` 72/72, 0 pending) and the fixed `dob_conflict` reconciliation is
  validated GREEN (23/23 at the time, and the same file now passes 27/27 with
  `AFLDB-ISSUE-092`'s tests 24–27 alongside it). `release-gates.test.ts` validation **was**
  HALTED and blocked by `AFLDB-ISSUE-092`; **that halt was LIFTED on 2026-08-28** when that
  issue was Resolved — see its entry below. Both remaining gates have since been run:
  the narrow canonical external-identity assertion **1/1** and `privileges.test.ts` **24/24**.
  Production NOT TOUCHED throughout.
  *(Superseded lineage: this bullet previously read "implementation IN PROGRESS … it remains
  Open", which was true up to 2026-08-27 and is retained here only as history.)*
- **Files:** `tools/migration/enrich_birth_dates_from_club_lists.py` (`:412-432`),
  `tools/migration/enrich_birth_dates.py` (`:407-412`, `:414-446`),
  `src/db/migrations/072_dob_conflict_ownership.sql` (new),
  `tests/integration/dob-enrichment-issues.test.ts` (new),
  `tests/integration/draft-lock.ts`, `tests/integration/release-gates.test.ts`

### Symptom
Rerunning the club-list DOB enrichment pass appends another unresolved `dob_conflict`
row for a conflict it has already recorded, so repeated execution accumulates duplicate
copies of one logical source disagreement. Separately, the register pass deletes every
unresolved `dob_conflict` / `dob_internal_conflict` row regardless of which pass created
it, so run order decides which unresolved findings survive.

### Evidence
The frozen release gate `gate: draft links` → *"does not stack duplicate issues when a
pass is re-run"* returned `[{ issueType: 'dob_conflict', n: 1 }]` against `afldb_test`
where `[]` is required. A read-only query showed entity `4347` holding rows `441`, `442`
and `443` with identical `source`, `existing` (1868-02-18), `asserted` (1868-02-20) and
`external_id` (`club-list:fitzroy:cap27`) but three distinct `detected_at` values
(2026-08-19 14:53, 14:55, 18:04) — three executions of one logical conflict, not three
disagreements. Entities `12949` and `13248` hold one register-origin row each. Three
disputed players, five rows, three logical conflicts.

The re-sourced AFL Tables *Fitzroy — All Time Player List* corroborates the assertion
from the source side: Cap 27, "Cleary, Bill", DOB 1868-02-20, 21 games, 1897-1899.

The register rows are dated 2026-08-15, before all three club-list runs, which proves the
register pass has not run since and therefore did **not** cause the duplicates. Its
unscoped delete is a related, latent cross-pass hazard of the `AFLDB-ISSUE-080` class.

### Root cause
`enrich_birth_dates_from_club_lists.py:412-432` inserts `dob_conflict` rows with an
unconditional `executemany`: no delete, no `ON CONFLICT`, no ownership predicate. This
caused the duplicates. `enrich_birth_dates.py:407-412` deletes unresolved DOB issues with
no ownership or population predicate. Both passes set `SOURCE_KEY = 'afltables'`, so
`details->>'source'` cannot distinguish them and ownership is pass-grained rather than
source-grained. `data_issues` has no unique constraint
(`001_foundations.sql:91-104`), so nothing structurally prevented the accumulation.

### Risk
Duplicate unresolved rows in the internal data-quality queue, and a latent path by which
one enrichment pass silently erases the other's unresolved findings. `players.dob_disputed`
is public — it drives a marker on `players/[slug]` and suppresses `birthDate` in the
schema.org JSON-LD — so issue state and public dispute state must stay consistent. No
foreign key references `data_issues.id`, and no public-facing corruption or production
impact has been established.

### Scope
The `dob_conflict` lifecycle across both DOB enrichment passes, the `dob_internal_conflict`
handling that is inseparable from it, migration 072 (data repair plus a targeted partial
unique index), and the `players.dob_disputed` recompute contract. Explicitly excluded:
`external_identity_conflict` (follow-up), `player_birth_evidence` (already idempotent by
unique-key upsert), the other eleven release-gate failures, and importer-side locking.

### Fix
**IMPLEMENTED** (corrected 2026-08-28 — the "Not yet implemented" text below was stale and is
superseded; kept as lineage). The §10 reconciliation is live in **both** importers
(`enrich_birth_dates_from_club_lists.py:202-327`, `enrich_birth_dates.py:172-295`), the old
unscoped `DELETE` is gone, and migration `072_dob_conflict_ownership.sql` exists and is
applied to `afldb_test`. Design as approved in `AFLDB-ISSUE-090.md`: one unresolved `dob_conflict`
row per player carrying a versioned `disputed_by` map with explicit per-pass assertion
provenance; evidence-based owned populations (club-list scoped by processed source file,
register scoped to its resolved population); assertion-specific suppression of identical
previously adjudicated conflicts; migration 072 with fail-closed preconditions, lossless
merge and a partial unique index; and a deterministic regression suite with self-contained
CSV and SQLite fixtures.

### Validation
**PERFORMED** (corrected 2026-08-28 — the "Not yet performed" text was stale and is
superseded; kept as lineage). Step 0 PASSED 2026-08-25; the pre-migration subset passed;
migration 072 applied to `afldb_test`; the focused suite
`tests/integration/dob-enrichment-issues.test.ts` is **27/27** (tests 1-23 ISSUE-090, 24-27
ISSUE-092), user-run 2026-08-28 against the canonically rebuilt `afldb_test`.

**Gate 1 — `release-gates.test.ts`, 2026-08-28: 64 tests, 42 passed, 22 failed.** All 22
classified in `AFLDB-ISSUE-090-HANDOFF.md` §11.3. **ISSUE-090's own duplicate-issue
invariant (`:497-507`, deliberately global and un-fixture-scoped) is GREEN** — the
reconciliation contract holds against the real database. Six failures touched this issue:
one stale pin (repaired, below) and five `gate: birth dates` population assertions retired
by `AFLDB-ISSUE-090.md` §27.3. The other 16 are owned by `AFLDB-ISSUE-095`,
`AFLDB-ISSUE-093`/DraftGuru B3, `AFLDB-ISSUE-096`/`-098`/`-099`, rebuild-baseline drift, or
the two unowned gaps at §27.5 — **left unchanged.**

**The one repair, and the only expectation ISSUE-090 altered anywhere:**
`tests/integration/release-gates.test.ts` `gate: birth dates` → `matches players on the
profile URL rather than the name`, `12_472` → `13_275`. A **test-baseline repair caused by
the 2026-08-27 canonical rebuild, not a product-data change.** Live `afldb_test` = 13,275;
accepted baseline `full-history-20260827` `measured.players` = 13,275;
`identity_scan.distinct_urls` = 13,275 with `missing_url`/`malformed_url` = 0; Stage 9's
`players` gate PASSED. 12,472 was the retired `AFLDB_LEGACY_SQLITE` register population and
is not reproducible from the canonical source contract; it was **not** silently reinstated.
The sibling assertion `stores the profile URL it matched on, not a legacy row id` passes
unchanged. **The `player_birth_evidence` 12,472 pin was NOT re-pinned** — a different
population, live at 855.

**Why the five DOB population assertions are not repaired here** (full proof at
`AFLDB-ISSUE-090.md` §27.3): the nine-stage canonical rebuild
(`tools/db/rebuild-test.ts:370-445`) invokes neither enrichment pass; `players_with_dob: 855`
and `players_with_dob_conflict: 0` are the **accepted baseline's own contracted figures**, and
`MEASURED_NOT_DB_GATED` records that a raw DOB count is deliberately not that baseline's
claim; the register pass requires `AFLDB_LEGACY_SQLITE` **and** would resolve zero players
because nothing in the canonical rebuild writes `players.legacy_player_id`; and the
club-list pass's canonical CSV directory is gitignored and absent. No importer was run, no
legacy dependency introduced, and no source artefact fabricated.

**Gate 2 — `privileges.test.ts`, 2026-08-28: 24/24 PASS, no grant widened.** `data_issues` was
already in `afldb_meta.import_writable_tables`, so `afldb_import` already held the DML the
reconciliation needs; no migration, `privileges.sql` change or grant was made. *(Superseded
lineage: this paragraph previously read "**Outstanding:** `tests/integration/privileges.test.ts`
(Gate 2) has not yet been run in this issue's own sequence." — true until 2026-08-28.)*

### Follow-up
`enrich_birth_dates.py:347-367` writes `external_identity_conflict` by unconditional
`executemany` with no clearing step — the same defect class, latent at zero rows, with
different entity semantics and a single writer. Deliberately excluded from ISSUE-090; no ID
allocated. Decide at resolution whether it qualifies as a Low tracked issue.

Also recorded: `player_birth_evidence` cannot encode pass ownership because both passes
share `source_id = afltables`, so identical agreeing evidence collapses onto one row; and
`data_issues` has no accepted/ignored adjudication vocabulary, which is what forces D1's
all-or-nothing suppression.

**Was blocked by `AFLDB-ISSUE-092` (2026-08-25) — UNBLOCKED 2026-08-28.** `AFLDB-ISSUE-092`
is Resolved: its fail-closed population gate and `--source-key` containment were validated
27/27 (no skips) on 2026-08-28, and `afldb_test.external_identities` was repopulated to
**13,275** AFL Tables identities by the 2026-08-27 canonical rebuild, so no §6 recovery is
outstanding and none is authorised. `release-gates.test.ts` and then `privileges.test.ts` may
resume. The two external-identity gates will now read 13,275 against their pin of 12,472 — a
stale legacy-derived value that must **not** be silently reinstated; deciding that re-pin is
this issue's own scope. *(Superseded lineage: the sentence "`AFLDB-ISSUE-090` remains **Open**"
stood here until 2026-08-28; the re-pin decision was subsequently made — 12,472 → 13,275 — and
this issue is now **Resolved**. See the Resolution section below.)* Historical record of the
block follows.

**Original block record (2026-08-25):** post-migration `release-gates.test.ts`
validation surfaced two previously-green `gate: birth dates` failures
(`external_identities` `match_method='afltables_profile_url'` population, expected 12,472,
found 0). Root-caused to a pre-existing, unrelated `enrich_birth_dates.py` defect —
conclusively not migration 072 (a pre-072 `afldb_test` backup already shows the table
empty) — that this issue's own new regression suite (test 5, real register-pass
invocation) exposed by running the real importer against shared `afldb_test` with a tiny
synthetic source. Tracked and designed separately as `AFLDB-ISSUE-092`; `AFLDB-ISSUE-090`
cannot resume `release-gates.test.ts`/`privileges.test.ts` validation until that issue is
implemented and `afldb_test.external_identities` is recovered.

### Resolution (2026-08-28)

**Root cause (actual).** Ownership of a `dob_conflict` row was not expressible. Both
enrichment passes write `SOURCE_KEY = 'afltables'`, so `details->>'source'` could not
discriminate them. The club-list pass therefore appended a fresh unresolved row on every
rerun (entity 4347 held three copies of one logical conflict), and the register pass issued
an unscoped `DELETE FROM data_issues WHERE entity_type='player' AND issue_type IN
('dob_conflict','dob_internal_conflict') AND resolved_at IS NULL` — no ownership and no
population predicate — destroying conflicts the other pass owned.

**Fix (as shipped).** Ownership is carried by the pass key inside a versioned
`details.disputed_by` map (`club_list` vs `register`), one unresolved row per player
aggregating every current assertion with its own `source`, `external_id`, `asserted` and
`existing_at_detection`; keys serialised sorted so a rerun writes a byte-identical payload
and preserves `id` and `detected_at`. Each pass reconciles only the population it can prove
it owns — club-list by processed source file, register by the players it produced evidence
for — under `SELECT ... FOR UPDATE` inside the caller's transaction. Every remaining delete
is row-scoped after reconciliation found the payload empty, or population-scoped by
`entity_id = ANY(owned)`. Foreign assertions are read and re-attached verbatim, so neither
pass can remove the other's in either direction. Suppression of an identical previously
adjudicated assertion is assertion-specific, never player-wide or cross-pass. Migration
`072_dob_conflict_ownership.sql` normalises legacy shapes to v2, merges duplicate unresolved
groups losslessly (survivor `MIN(id)`), recomputes `players.dob_disputed` for affected
players only, and creates the partial unique index `uq_data_issues_open_dob_per_player` as
the structural backstop, behind fail-closed preconditions.

**Validation (operator-run, canonically rebuilt `afldb_test`).**

| Gate | Result |
|---|---|
| `tests/integration/dob-enrichment-issues.test.ts` | **27/27** |
| `release-gates.test.ts -t "matches players on the profile URL rather than the name"` | **1/1** (63 skipped), pin reads **13,275** |
| `tests/integration/privileges.test.ts` | **24/24**, no grant widened |

**Explicit close-out statements.**

- **13,275 is the canonical AFL Tables profile-identity population.** Corroborated four ways:
  live `afldb_test`; accepted baseline `full-history-20260827` `measured.players` = 13,275;
  `identity_scan.distinct_urls` = 13,275 with `missing_url`/`malformed_url` = 0; and the
  rebuild's own Stage 9 `players` gate, which PASSED. `import_fitzroy_core.py` writes exactly
  one `status='unique'` profile-URL identity per player.
- **The old 12,472 external-identity pin is RETIRED.** It was the
  `AFLDB_LEGACY_SQLITE` register population and is not reproducible from the canonical source
  contract. It was **not** silently reinstated.
- **`player_birth_evidence` was NOT re-pinned to 13,275.** A different population, live at
  855; its `12_472` expectation at `release-gates.test.ts:632` is unchanged.
- **The five historical DOB-population release assertions remain unchanged** (12,478 players
  with a DOB, 2 visible conflicts, 2 open `dob_conflict` rows, 12,472/11,533 evidence, 883
  without a date). They are **superseded snapshot assumptions outside ISSUE-090's
  reconciliation contract** — see `AFLDB-ISSUE-090.md` §27.3. The canonical rebuild invokes
  neither enrichment pass; `players_with_dob: 855` / `players_with_dob_conflict: 0` are the
  accepted baseline's own contracted figures; the register pass needs `AFLDB_LEGACY_SQLITE`
  **and** a `players.legacy_player_id` nothing canonical writes; the club-list pass's CSV
  directory is gitignored and absent.
- **No privilege widening occurred.** `data_issues` was already in
  `afldb_meta.import_writable_tables`, so `afldb_import` already held the DML the
  reconciliation needs. No migration, `privileges.sql` change or grant was made.
- **No legacy SQLite path was reintroduced.** `AFLDB_LEGACY_SQLITE` was not set, referenced
  or added anywhere.
- **No importer, rebuild, migration, `afldb_dev` or production mutation occurred during
  close-out.** The only repository change outside documentation is one test expectation.

**Gate 1 evidence, retained as history.** `release-gates.test.ts` ran **64 tests, 42 passed,
22 failed** on 2026-08-28. All 22 are classified in `AFLDB-ISSUE-090-HANDOFF.md` §11.3. Six
touched this issue — one stale pin (repaired) and the five retired population assertions. The
other 16 belong to `AFLDB-ISSUE-095` (3), `AFLDB-ISSUE-093`/DraftGuru B3 (2),
`AFLDB-ISSUE-096`/`-098`/`-099` (2), rebuild-baseline drift (4) and the two unowned
observations below (5), and were left unchanged. **The complete release-gates suite is NOT
green and this resolution does not claim it is.**

**Observations carried forward — recorded, unowned, deliberately not converted to issues in
this close-out** (also at `AFLDB-ISSUE-090.md` §27.5):

1. **`brownlow_season_votes` has no canonical legacy-free writer.** Only
   `import_legacy_afl.py:721` writes it; `import_fitzroy_core.py` writes
   `brownlow_round_votes` but not the season grain (*"its authoritative fields are not
   derivable from this snapshot"*), and `rebuild_derived.py` only reads it. Same class as
   `AFLDB-ISSUE-095` and `AFLDB-ISSUE-102`.
2. **`unlinked_player_with_games` has no writer at all.** `import_draftguru.py` sets
   `is_matching_backlog` but files no `data_issues` row; the historical writer was the
   tombstoned `import_draft.py`. Plausibly DraftGuru Stage B3 — optional and not started.

**Follow-up retained:** the §18/D4 `external_identity_conflict` observation
(`enrich_birth_dates.py:347-367`, unconditional `executemany` with no clearing step — same
defect class, latent at zero rows, single writer). Reviewed at resolution and **not** raised
as a tracked issue: it is latent, has one writer, and now sits behind ISSUE-092's fail-closed
population gate. Recorded here so it is not lost.

## AFLDB-ISSUE-092 — `external_identities` reconciliation trusts an unproven-complete source population

- **Status:** Resolved
- **Severity:** Medium
- **Area:** Data integrity / Tooling safety
- **Found:** 2026-08-25 (post-migration-072 `release-gates.test.ts` validation for
  `AFLDB-ISSUE-090`)
- **Resolved:** 2026-08-28 — database-backed acceptance validation
  `npm test -- tests/integration/dob-enrichment-issues.test.ts` **27/27 passing, 1 file,
  16.46s, no skips**, user-run against the rebuilt `afldb_test`. Tests 24–27 executed and
  green; they are no longer merely authored. An earlier skipped run was a worktree Python
  environment artefact and is explicitly **not** validation evidence.
- **Runbook:** `AFLDB-ISSUE-092.md` — authoritative for the full evidence chain, the
  safety-contract design, the test-containment design and the recovery design. §4/§5/§11
  **implemented 2026-08-25** (ISSUE-093 Phase-3 session), re-verified in-tree 2026-08-28
  (§17.1), **validated 2026-08-28** (§17.5). §6 recovery superseded by rebuild (§17.2).
- **Files:** `tools/migration/enrich_birth_dates.py` (`:500-539`),
  `tests/integration/dob-enrichment-issues.test.ts` (test 5, `:216-224`, `:529-556`)

### Symptom (as observed 2026-08-25; the emptiness is since superseded — see Validation)
`afldb_test.external_identities` is completely empty. Two `release-gates.test.ts` `gate:
birth dates` checks that were green before `AFLDB-ISSUE-090`'s migration 072 are now red:
`match_method='afltables_profile_url' AND status='unique'` expected 12,472 found 0; total
`afltables_profile_url` rows expected >0 found 0.

### Evidence
`enrich_birth_dates.py:519-525` deletes every `external_identities` row for
`(source_id, match_method='afltables_profile_url')` not present in the current run's
asserted set — correct only if the supplied register is the complete population, which the
importer never verifies. `dob-enrichment-issues.test.ts` test 5 invokes this importer for
real (`runRegister()`, no `--dry-run`) against the shared `afldb_test` database with a
one-row synthetic SQLite register, so the DELETE removed the entire real population. A
repository-wide search confirms `enrich_birth_dates.py` is `external_identities`'s sole
writer today (DraftGuru's bridge into this table is listed PLANNED, not implemented, in
`docs/migration-inventory.md`; DraftGuru identity resolution actually flows through
`draft_persons`/`award_winners` directly) and that this is the only test-suite call site of
this importer. A pre-072 `afldb_test` backup (`.deploy-backups/issue-090-afldb_test-pre-072-20260825-194528.dump`)
already shows the table empty, so the loss predates and is independent of migration 072.

### Root cause
`enrich_birth_dates.py` has no fail-closed contract proving its supplied source population
is complete before performing an authoritative deletion, and no partial-population mode
(unlike `enrich_birth_dates_from_club_lists.py`'s `--csv-dir` scoping). This is the
`AFLDB-ISSUE-080` defect class — an unscoped write trusting its input as the authoritative
full set — already fixed elsewhere in this same file for `dob_conflict`/
`dob_internal_conflict` by `AFLDB-ISSUE-090`, but never applied to this older
`external_identities` block. Independently, the test suite has no isolation preventing a
real, full-population-authoritative importer invocation from touching shared,
non-fixture-scoped data.

### Risk
Silent, total loss of a third-party identity population in any environment where this
importer runs against an incomplete/wrong/truncated `AFLDB_LEGACY_SQLITE`, including
production. Currently manifested only in `afldb_test`; production not touched.

### Scope
`enrich_birth_dates.py`'s `external_identities` reconciliation and the
`dob-enrichment-issues.test.ts` test that exercises it. Explicitly excludes migration 072
(not implicated), `player_birth_evidence` (already safe, upsert-only), and a
repository-wide sanity-gate retrofit onto other importers.

### Fix
IMPLEMENTED 2026-08-25 (ISSUE-093 Phase-3 session); re-verified in-tree and **VALIDATED
2026-08-28, 27/27** — see Validation below.
Per the approved design in `AFLDB-ISSUE-092.md`: (A) a fail-closed
population-sanity gate in the importer — refuses an authoritative deletion when the
asserted population is zero against existing rows, or when it would remove more than a
configurable threshold of the stored population, bypassable only via an explicit
`--acknowledge-population-drop` flag, applied identically to every caller; (B) a dedicated
fixture `source_id` (`--source-key` override) so the test's real register-pass invocation
is structurally scoped away from real data regardless of population size. No schema/
migration change. Implementation detail: reusable `check_population_drop()` /
`PopulationDropRefused` / `POPULATION_DROP_THRESHOLD = 0.10` in
`tools/migration/common.py` (shared with the future fitzRoy importer per ISSUE-093 §9),
wired into `enrich_birth_dates.py` before the DELETE; check 1 (empty asserted population)
is not bypassable, check 2 (>10% drop) only via per-invocation
`--acknowledge-population-drop` (logged via `Reporter.warn`). Fixture source
`afltables_issue090_fixture`; new tests 24–27 in `dob-enrichment-issues.test.ts`.

### Validation
**COMPLETE — 2026-08-28, user-run:**
`npm test -- tests/integration/dob-enrichment-issues.test.ts` → **Test Files 1 passed (1);
Tests 27 passed (27); 16.46s; no skips.** The ISSUE-092 acceptance block executed and passed
in full:

- **test 24** — a fixture-source run cannot touch the real `afltables` population;
- **test 25** — an empty asserted population is refused unconditionally, *including* with
  `--acknowledge-population-drop`, with no row deleted and the batch marked `failed`;
- **test 26** — an over-threshold drop is refused by default and permitted only with the
  explicit acknowledgement flag, which is logged;
- **test 27** — an equal-or-larger asserted population passes with no false positive
  (ordinary rerun and the rebuild-from-empty direction).

The implementation was additionally re-verified line by line against the working tree on
2026-08-28 (`AFLDB-ISSUE-092.md` §17.1) before that run. The earlier Phase-3 static gate
(33/33, user-run 2026-08-25) proved no static regression; this 27/27 database-backed run is
the authoritative acceptance result. Acceptance criteria §15.1–§15.3 and §15.6–§15.7 are met;
§15.4/§15.5 were superseded by the rebuild (below) and reassigned.

**§6 recovery is SUPERSEDED BY REBUILD, on positive evidence** (`AFLDB-ISSUE-092.md` §17.2),
not merely because a rebuild starts empty: the canonical rebuild's `import_fitzroy_core.py`
writes `external_identities` under the `afltables` source with
`match_method='afltables_profile_url'`, reusing this issue's own `check_population_drop`
gate, and the Stage 9 `players` gate — which counts exactly those rows
(`tools/db/rebuild-test.ts:521-523`) — read **13,275** in the passing 2026-08-27 rebuild
(`AFLDB-ISSUE-093.md` §H15.4). The table is populated again from an authoritative source. No
§6 run of `enrich_birth_dates.py` against `AFLDB_LEGACY_SQLITE` is to be performed. The old
emptied database is preserved read-only as `afldb_test_pre_rebuild_20260825`.

### Follow-up
Handed to `AFLDB-ISSUE-090`, which is **now UNBLOCKED and remains OPEN** for its own
remaining validation (`release-gates.test.ts`, then `privileges.test.ts`). Its two
external-identity gates are pinned at **12,472**, a stale legacy-derived value; the
authoritative canonical population is **13,275**. That 12,472 pin must **not** be silently
reinstated, and re-pinning it is an explicit ISSUE-092 non-goal — the decision belongs to
`AFLDB-ISSUE-090`. Nothing else is outstanding from this issue.

## AFLDB-ISSUE-093 — Deterministic afldb_test rebuild from authoritative sources

- **Status:** Resolved
- **Severity:** Medium
- **Area:** Tooling / Data integrity / Import architecture
- **Found:** 2026-08-25 (architecture planning session, prompted by the ISSUE-090/092
  investigation into `afldb_test`'s fragility)
- **Resolved:** 2026-08-27 — the first complete canonical clean rebuild of `afldb_test` ran
  end to end and passed all nine stages, with `AFLDB-FINAL-VALIDATION PASSED: 13 checks`.
  See **Resolution** below.
- **Current state:** **RESOLVED 2026-08-27.** `AFLDB-ISSUE-093.md` §H15 is the authoritative
  record of the passing rebuild; §19 remains the authoritative record of the frozen canonical
  source. Where §19 and earlier sections disagree, §19 wins; where §H15 and §19 disagree about
  execution state, §H15 wins.
- **Runbook:** `AFLDB-ISSUE-093.md` — the approved architecture, authoritative for the full
  source-to-schema matrix, fitzRoy/non-fitzRoy classification, canonical snapshot/archive
  policy, preflight-before-destruction rebuild order, safety contract, release-gate
  Class A/B policy, missing-source backlog and implementation phases. Planning complete and
  **approved for implementation planning**.
- **Files:** Phase 1 (2026-08-25): `data/reference/sources.json`, `seasons.json`,
  `clubs.json`, `stat-definitions.json`, `stat-availability.json`, `venue-canonical.json`
  (new tracked datasets); `tools/migration/load_reference_data.py` (new standalone
  loader); `tests/reference-data.test.ts` (new); `AFLDB-ISSUE-093.md` §15;
  `AFLDB-ISSUE-093-PHASE-2-HANDOFF.md` (new). Phase 2 (2026-08-25):
  `tools/rebuild/fitzroy/fitzroy-contract.json`, `tools/rebuild/fitzroy/acquire_core.R`,
  `tests/fitzroy-acquisition.test.ts`,
  `docs/rebuild-manifests/afltables_fitzroy_core/trial-2024.json` (all new); `.gitignore`
  (data/reference opt-in); `AFLDB-ISSUE-093.md` §16; `AFLDB-ISSUE-093-PHASE-3-HANDOFF.md`
  (new). `import_legacy_afl.py` unchanged. Phase 4a (2026-08-25):
  `tools/migration/import_fitzroy_core.py`, `tests/fitzroy-core-import.test.ts` (both
  new); `AFLDB-ISSUE-093.md` §18. Later phases: DraftGuru, awards/honours, and eventually
  a new `db:test:rebuild` orchestrator

### Problem
AFLDB's major historical/core rebuild path (`import_legacy_afl.py`, `import_draft.py`, most
of `import_awards.py`, `enrich_birth_dates.py`'s main-register pass) depends entirely on
`AFLDB_LEGACY_SQLITE`, a single-developer-owned intermediate aggregation database with no
provenance, checksum, or version tracking of its own. `AFLDB-ISSUE-090` and `AFLDB-ISSUE-092`
both surfaced defects while working against this fragile setup — `afldb_test` is not
genuinely disposable. `AFLDB_LEGACY_SQLITE` is itself an aggregation of upstream sources
(fitzRoy/AFL Tables, DraftGuru, Wikipedia, FootyWire), not a primary source — AFLDB simply
has no rebuild path that acquires from those upstream sources directly.

### Decision
Design (not yet implement) a rebuild architecture for `afldb_test` that acquires from
upstream authoritative sources directly, with zero dependency on `AFLDB_LEGACY_SQLITE`,
explicitly tracks which domains are IMPLEMENTED/DERIVED/STATIC/MISSING, and fails closed on
any required domain that is still missing rather than silently falling back to the legacy
source. Full detail (source-to-schema matrix, fitzRoy coverage split, canonical snapshot
layout, phase order, safety contract, release-gate policy, backlog) is in
`AFLDB-ISSUE-093.md`.

### Scope
Architecture and tracking only in this pass. No importer, adapter, orchestrator script, or
database/schema change is implemented. Explicitly excludes `AFLDB-ISSUE-092`'s recovery of
the *current* `afldb_test.external_identities` data (orthogonal — that issue's §6 recovers
today's database; this issue rebuilds a database from scratch).

### Fix
**CHECKPOINT 2026-08-27 — CANONICAL FULL-HISTORY FITZROY SOURCE FROZEN.** The
authoritative current-state record is **`AFLDB-ISSUE-093.md` §19**; detailed evidence is in
`AFLDB-ISSUE-093-DRAFTGURU-B2-HANDOFF.md` (PART I–XV DraftGuru Stage B2, PART XVI–XVIII
full-history fitzRoy). Summary of what this checkpoint settled:

- **Accepted canonical baseline `full-history-20260827`** — VFL/AFL men's senior
  competition, **1897–2025** inclusive (2026 excluded because current-season ingestion owns
  it; AFLW remains separate), **131 immutable artefacts, 719,042 acquired rows**. Bound by
  manifest SHA-256 `cc8aaf0946fc59003dc4e5d6803410383db975e2f5bf58e9d510c31dc781e3b6` and
  artefact-set SHA-256
  `8e14ce6198685b9fec568ab3c680cab34783e8e202ab0c7e93f45773d96f4125`.
- **Acceptance register** `data/reference/fitzroy-accepted-baselines.json`, policy
  `exactly_one_accepted`: zero accepted fails closed, more than one fails closed, and there
  is no latest-label/date/filename fallback anywhere. The register **binds; it never
  blesses** — `--require-accepted-baseline` implies `--require-full-history`, every artefact
  is re-hashed, and every gate and measured count is re-derived from the artefacts, so a
  hand-edited record cannot bless arbitrary bytes. The original acquisition manifest is
  preserved **byte-for-byte** and keeps its historically incorrect self-declared
  `full_history`/`completeness`; those acquisition verdict fields are **inert**, and
  acceptance is a separate tracked decision.
- **Accepted measurements** — matches 16838 (16838 with player rows), seasons 1897-2025,
  venues 52, attendance_known 15187, club_identities 24, players 13275,
  brownlow_round_vote_rows 320861, players_with_dob 855, players_with_dob_conflict 0,
  player_match_rows 685471. Identity scan: 685473 source rows, missing_id 83, missing_url 0,
  malformed_url 0, distinct_ids 13270, distinct_urls 13275. Independent accepted-baseline
  validation **passed with no PostgreSQL access**.
- **Settled fitzRoy semantics (CLOSED):** (1) canonical AFL Tables profile URL is the
  durable player identity and the fitzRoy ID is optional, never persisted as canonical
  identity; (2) source-era normalisation raw "Brisbane Lions" 1987–1996 → Brisbane Bears;
  (3) dataset-specific source-era normalisation, dataset `results`, raw "North Melbourne"
  1999–2007 → Kangaroos; (4) the 1909 Jim Stewart corruption drops exactly two spurious
  Cartesian-product rows under tracked fingerprints while the two genuine appearances stay
  distinct; (5) blank `Player` builds `display_name` from the already-present
  `First.name` + `Surname`, and never participates in identity matching.
- **DraftGuru** — supported importer complete; Stage A `annual-html-20260826` (42 annual
  pages, 6,810 rows, 5,057 distinct persons); explicit human decision ledger tracked at
  `data/reference/draftguru-link-decisions.json`; legacy `tools/migration/import_draft.py`
  retired/tombstoned out of the canonical rebuild architecture. **Stage B3 is optional, NOT
  started, and NOT a blocker for the clean rebuild.**
- **Orchestrator** — `npm run db:test:rebuild` implemented in `tools/db/rebuild-test.ts`,
  stage order PRECHECK → DATABASE RESET → MIGRATIONS → PRIVILEGES → REFERENCE → FITZROY →
  DRAFTGURU → DERIVED → FINAL VALIDATION/FINGERPRINTS. Normal mode selects the accepted
  full-history baseline automatically and runs the accepted/full-history validator **before
  any destructive stage**; `trial-2024` is partial/testing only under explicit opt-in.
- **New/changed tracked files at this checkpoint:**
  `data/reference/fitzroy-accepted-baselines.json` (new),
  `tools/rebuild/fitzroy/fitzroy-contract.json` (full_history, source_club_normalisation,
  source_row_corrections), `tools/migration/import_fitzroy_core.py`,
  `tools/db/rebuild-test.ts`, `tests/db-test-rebuild.test.ts`,
  `tests/fitzroy-core-import.test.ts`, plus the DraftGuru Stage B2 files recorded in the B2
  handoff.

**NOT COMPLETE.** No clean rebuild has ever been executed, and `RESET_SQL` has never run
against live PostgreSQL. Everything above is proven offline only.

**RESET_SQL PROOF IMPLEMENTED — awaiting execution (2026-08-27, `AFLDB-ISSUE-093.md` §20).**
Blocker 2 of §19.9. Inspecting `RESET_SQL` before designing the proof found **two real
defects, both now fixed**:

- **The reset was never sent to PostgreSQL.** `runSql` was `void client.unsafe(sql)`; a
  postgres.js `Query` executes only when `.then`/`.catch`/`.finally`/`.execute()`/
  `.forEach()` is called, so no bytes reached the server, the surrounding `try/catch` could
  never fail, and DATABASE RESET would have reported success against an untouched database —
  after which MIGRATIONS would have found every migration already applied and every data
  stage would have loaded on top of the old data. Now run through
  `psql -v ON_ERROR_STOP=1 --single-transaction -f -` under `spawnSync`, which is
  synchronous (the stage graph is), returns a real exit code, and makes the reset
  all-or-nothing.
- **The `pg_` internal-schema exclusion excluded nothing.** `NOT LIKE 'pg\\_%'` inside a JS
  template literal reaches the server as `'pg\\_%'`, a pattern matching only names beginning
  `pg\`. `pg_toast` exists in every database and passes the `NOT IN` list, so the first loop
  would have issued `DROP SCHEMA IF EXISTS pg_toast CASCADE` and aborted on a pinned system
  schema. Replaced with `!~ '^pg_'`, which has no escape to lose.

Also hardened: extension-membership (`pg_depend.deptype = 'e'`) guards added to the schema,
table and view loops — previously only routines and types had them — and a new loop for
standalone sequences and foreign tables.

**Execution-path parity (review correction).** The first design ran `RESET_SQL` through
postgres.js while the real rebuild ran it through psql, so a passing proof would have proven
the SQL and left the mechanism — the thing just found broken twice — untested. Corrected: a
single shared execution helper, `tools/db/psql.ts`, gives both paths the same binary and the
same argv (`psql <dsn> -v ON_ERROR_STOP=1 --single-transaction -q -f -`). The only difference
is the stream: the real reset ends normally so psql commits; the proof's stream always ends
in `RAISE EXCEPTION`, so it cannot. Two independent guarantees back that — psql does not
commit an errored stream under `ON_ERROR_STOP`, and PostgreSQL rolls back an already-aborted
transaction even if `COMMIT` were sent — so the proof treats **exit status 0 as a failure**.

The proof is `tools/db/prove-reset.ts` / `npm run db:test:prove-reset`: a separate entry
point with no stage graph. It refuses before the reset on a wrong database, a wrong role or
any other client session on `afldb_test`; probes psql through the reset's own argv so a
missing or unusable psql fails closed before anything is attempted; snapshots the extensions
and every extension-owned object into temp tables inside the transaction and requires them
member-for-member afterwards; asserts a clean slate in SQL and re-asserts it in Node; and
requires the post-rollback catalog fingerprint to equal the pre-reset one exactly.

**Owner/superuser policy settled as a refusal, not a warning:** `current_database()` must be
`afldb_test`, and `current_user` **and** `session_user` must both be exactly `afldb_owner`
with `pg_roles.rolsuper` false for each. `afldb_owner` is created `LOGIN NOSUPERUSER`
(00_install_postgres.sh:57) and no `SET ROLE` exists anywhere in the repository, so a
superuser session — direct or via `SET ROLE` — is refused rather than tolerated: it would
bypass exactly the ownership rules the real reset depends on.

It needs only the owner DSN, so ISSUE-083 does not gate it, and it loads no data, so the
fitzRoy acceptance register is irrelevant to it. DB-free suite **417/417**; `npx tsc --noEmit`
clean for every file changed.

**FIRST LIVE ATTEMPT 2026-08-27 — FAILED. Blocker 2 remains OPEN (§20.9a).** The target,
role (`current_user`/`session_user`/both `rolsuper`), exclusive-session and psql-availability
gates all passed, and the pre-proof fingerprint was
`0229d62cf768f986416e1eea222801391d793039070889d8af5294346b65cbd9`. psql then exited **0**
instead of performing the deliberate abort. Tracing the call graph proves the SQL *is* handed
to `spawnSync` as `input` and that `-f -` is present exactly once, so a discarded SQL argument
is excluded; the failure is at the psql process boundary, and the refusal discarded psql's
stdout/stderr, so the cause cannot yet be named. Two defects made it uninterpretable: the
availability probe ran `SELECT 1` and accepted exit 0 — which an undelivered stdin also gives
— and the parity test recorded the stdin payload but only asserted the two callers' payloads
*differed*, never their content.

**Database state is NOT established.** Of the four hypotheses, "no SQL sent" and "whole stream
ran but ON_ERROR_STOP was not in force" are both safe, but a **truncated** stream cut after
`RESET_SQL` would have reached EOF and been COMMITTED by `--single-transaction`. That cannot
be excluded by inspection, so the earlier "nothing was committed" claim is withdrawn pending
verification.

**Fixed since:** a **server-side commit trap** armed before the reset (a `DEFERRABLE INITIALLY
DEFERRED` unique violation in a temp table, checked at COMMIT, so no truncation can commit
whatever psql does); a delivery marker as the stream's first statement; a probe that proves
stdin delivery, `ON_ERROR_STOP` and diagnostic propagation, each with its own refusal; psql's
output always reported; and DB-free tests that assert the actual stdin bytes.

**INCIDENT CONFIRMED 2026-08-27 — THE ROLLBACK PROOF COMMITTED THE RESET (§20.12).** The
read-only verification returned **MISMATCH**: pre-proof
`0229d62cf768f986416e1eea222801391d793039070889d8af5294346b65cbd9` →
`f46ce34c5689818fe149133a812bed2ea3d28f115bd48ca19214eb7b32c01881`, with schemas 1 (`public`
only), relations 0, columns/indexes/constraints/enum_values/sequences 0, routines 35,
types 2, extensions 3, extension-owned objects 56, `afldb_meta.schema_migrations` absent.

**That is precisely the intended post-RESET clean slate, so `RESET_SQL` is now empirically
CORRECT against live PostgreSQL — extension preservation included. The rollback containment
is what failed.** Blocker 2 stays OPEN.

**Reconciliation.** The stream was not truncated by its own content: dumped and inspected,
13,908 bytes, 0 CR, 0 backslashes, 0 NUL, 0 Ctrl-Z, no psql meta-command line, balanced
dollar tags, valid UTF-8. The sentinel was **syntactically valid** — a well-formed
`DO $afldb_proof$ BEGIN RAISE EXCEPTION '…'; END $afldb_proof$;`, not a bare top-level
`RAISE` (which would be a syntax error, `RAISE` being PL/pgSQL rather than SQL). `input` is
supplied to `spawnSync` and `-f -` is present. The only hypothesis fitting every observation
is that **psql did not apply its options**: with no `--single-transaction` each statement
autocommits, so `RESET_SQL` committed as it ran, the later assertions passed trivially against
the emptied database, the sentinel raised — and without `ON_ERROR_STOP` psql still exited 0.
**Leading cause: the argv led with the DSN**, and PostgreSQL's own `src/port/getopt_long.c`
(built on Windows and anywhere the system getopt_long is absent) stops at the first
non-option argument without permuting, so the flags after it can be taken as operands, with
only a warning — to the stderr the refusal discarded. Stated as leading, not confirmed: the
decisive output was destroyed, and none of the fixes depend on it being right.

**Impact.** `afldb_test` only; production and `afldb_dev` were never contacted. Loss was
schema and privileges — no fitzRoy import had ever been performed, so no data existed to
lose, and `afldb_test` was always destined for destructive rebuild. **Loss severity low;
safety-proof severity high.** **AFLDB-ISSUE-083 is disrupted** — Codex is establishing
restricted `afldb_import` parity against `afldb_test`, whose schema and per-object grants are
gone; it must be told before it runs anything there. Every DB-backed suite is blocked until
schema exists. Restoration is neither necessary nor supported
(`afldb_test_pre_rebuild_20260825` is read-only reference, §19.10); the empty database should
be treated as the rebuild's starting state.

**Fixes.** (1) the DSN is passed as `-d`, never as a positional operand, so a non-permuting
getopt has nothing to stop at — and `db:privileges`/`db:privileges:test` were moved off the
same shape; (2) the psql probe now deliberately raises and requires the stdin token, a
**non-zero exit** and the error text, so a psql ignoring `ON_ERROR_STOP` fails before the
reset; (3) a `DEFERRABLE INITIALLY DEFERRED` commit trap armed before the reset turns any
COMMIT into a server-side error at any truncation point; (4) the trap doubles as an
**autocommit detector** — in autocommit its duplicate INSERT fails immediately, and a new
assertion stops the stream **before the first destructive statement**; (5) psql's output is
always relayed, with connection strings and passwords redacted.

**SELF-COLLISION 2026-08-27, reproduced twice (§20.14).** The hardened proof refused with
`AFLDB-PROOF sessions: 1 other client session(s) connected to afldb_test` although a
standalone `pg_stat_activity` check moments earlier returned 0 rows and the phantom session
vanished when the proof exited. Confirmed from the connection lifecycle: the CLI opened one
postgres.js client before `runResetProof` and closed it only in a `finally` afterwards, so it
was live while psql ran its own in-stream exclusivity check. The Node-side gate excludes only
itself (`pid <> pg_backend_pid()`) and so could never see it; psql, a separate backend, could.
**The gate was correct and is unchanged — the harness was the second session.** Fixed by
restructuring into three phases: (1) `withSession` for identity, exclusivity and the
pre-reset fingerprint, closed before anything else; (2) psql only, with no postgres.js client
open — both spawns are synchronous, so the probe's process has fully exited before the proof
stream is sent; (3) a fresh `withSession` for the post-rollback fingerprint and health.
`ProofDeps` now exposes a scoped `withSession` instead of a `query` handle, so no connection
can be held across phases, including on refusal paths. **No application_name, PID or role
exemption was added** — that would have hidden this class of bug; a test asserts none exists.

**RESET BLOCKER 2 CLOSED 2026-08-27 — the live rollback-only proof PASSED.** `afldb_test` was
reconstructed after the incident (migrations **001–072** applied, privileges reconciled,
PostgreSQL 16.15, `afldb_owner` non-superuser) and the proof re-run against a database with a
real schema to lose:

```
pre-reset  a8a2a899e431ced96afe2d80b4ec258b31533ae27c58791b5e8bf05e0bd0e1d7
post-roll  a8a2a899e431ced96afe2d80b4ec258b31533ae27c58791b5e8bf05e0bd0e1d7   EXACT equality
health     950 relations, 3 extensions      psql exit 3 (deliberate abort)     1498 ms
inside the aborted transaction: application schemas 0, tables 0, views 0, sequences 0,
routines 0, types 0, foreign tables 0; public schema, 3 extensions and 56 extension-owned
objects all preserved.
```

The incident lineage above is retained in full and is **not** rewritten: the runner that never
sent its query, the mis-escaped `pg_` exclusion, the committed reset that wiped `afldb_test`,
the DSN-first execution-path hypothesis (leading but never forensically confirmed, because the
refusal discarded the decisive stderr), the psql hardening, the commit/autocommit trap, and
the observer self-collision. Full chain in `AFLDB-ISSUE-093.md` §H3.

*Superseded next action, kept as history: "the FIRST ACTUAL CLEAN REBUILD, owned by a fresh
session" per the FIRST CLEAN REBUILD HANDOFF (`AFLDB-ISSUE-093.md` §H1–§H10). That rebuild has
since been executed and passed — see **Resolution** below and §H15.*

**Phase 4a IMPLEMENTED (2026-08-25, subsequently validated — `AFLDB-ISSUE-093.md`
§18, §19)** — §13.4a historical/core PostgreSQL importer:
`tools/migration/import_fitzroy_core.py` (new) consumes a canonical snapshot + manifest
(never live fitzRoy) into venues, players (+ `player_birth_evidence` under the distinct
`fitzroy_afldata`/`fitzroy_player_stats` evidence source, fill-if-missing DOB), AFL Tables
`external_identities` (ISSUE-092 §4 gate + §5 `--source-key` reused from `common.py`),
matches/period scores/attendance (results.csv canonical, player_stats supplements
deduplicated by match, conflicts fail closed, migration-020 provenance),
`player_match_stats` (explicit 22-pair STAT_MAP, NULL ≠ 0) and derived
`brownlow_round_votes` (H&A non-NA votes only, seasons gated by
`stat-availability.json`; `brownlow_season_votes` deliberately NOT written — its
authoritative fields are not derivable from this snapshot). Player identity = profile-URL
path via `external_identities` (fitzRoy `ID` in-run only; **the original 1:1 ID rule was
REMOVED on 2026-08-27** — the 1897-2025 evidence shows the fitzRoy ID is optional, so the
URL is mandatory and the ID is not canonical identity; see `AFLDB-ISSUE-093.md` §19.5);
match identity =
`match_key` in the current-season-import convention; club strings era-remapped within
one organization, fail-closed otherwise. Fail-closed manifest/SHA-256/row-count/column/
version validation runs before any DB access (`--validate-only` needs no psycopg at all).
Keyed upserts + snapshot-scoped delete-then-COPY make every group retry-safe without
touching other writers' rows. New static/spawn suite `tests/fitzroy-core-import.test.ts`.

**Phase 3 IMPLEMENTED (2026-08-25, validation partially pending — `AFLDB-ISSUE-093.md`
§17)** — §13.4: club-list DOB enrichment wired to the canonical
`data/sources/afltables/club_lists/` directory (`--csv-dir` now optional; canonical mode
is complete-or-refuse across the five expected `FILE_ORGS` files, with fail-closed header
and directory validation before any environment/database access; `--require-complete`;
ISSUE-090 partial/test semantics preserved under an explicit `--csv-dir`; club-list
evidence stays a separate layer from the fitzRoy DOB source; CSVs stay uncommitted). Plus
the ISSUE-092 §4 fail-closed `external_identities` gate and §5 `--source-key` containment
(reusable `check_population_drop()` in `tools/migration/common.py` — recorded under
`AFLDB-ISSUE-092`). New static suite `tests/club-list-sources.test.ts` (8 tests); new
integration tests 24–27 in `dob-enrichment-issues.test.ts` await a test database.

**Phase 2 COMPLETE (2026-08-25)** — fitzRoy core source acquisition. fitzRoy pinned at
1.8.0 (CRAN stable, verified) in `tools/rebuild/fitzroy/fitzroy-contract.json`;
`tools/rebuild/fitzroy/acquire_core.R` is the canonical acquisition adapter (probe +
acquire modes, fail-closed version gate, `library(fitzRoy)` attach required — namespace-only
invocation breaks `dictionary_afltables`). Two real probes + a real bounded acquisition
(`trial-2024`: 9,936 player_stats / 16,731 player_details / 216 results rows) proved the
snapshot → manifest → SHA-256 path end-to-end (tracked manifest
`docs/rebuild-manifests/afltables_fitzroy_core/trial-2024.json`; raw CSVs gitignored under
`data/sources/afltables/fitzroy_core/`). Evidence-backed matrix: stable ID, name, AFL Tables
URL, match identity/scores/venue SUPPORTED; DOB, the 21 match stats, Brownlow match votes
(correct per-player-per-match grain, NA ≠ 0), attendance (player_stats only, dedupe by
match) SUPPORTED WITH COVERAGE LIMITATION (historical coverage unmeasured);
`player_match_period_stats` MISSING (deferred §13.7). One canonical acquisition covers all
five player sub-domains (§8 confirmed). Zero PostgreSQL and zero `AFLDB_LEGACY_SQLITE`
dependency, pinned by `tests/fitzroy-acquisition.test.ts` (13/13). Also fixed during Phase
2: `.gitignore` was silently ignoring the Phase-1 `data/reference/*.json` datasets —
narrow opt-in added and user-verified.

**Phase 1 COMPLETE (2026-08-25)** — static/reference data (sources, seasons, clubs +
aliases + organizations + relations, stat definitions, stat availability) ported out of
`import_legacy_afl.py` into tracked JSON datasets under `data/reference/` plus a
standalone deterministic/idempotent loader (`tools/migration/load_reference_data.py`,
fail-closed cascade guard, zero `AFLDB_LEGACY_SQLITE` dependency). The old legacy-built
test DB was preserved as `afldb_test_pre_rebuild_20260825`; a guarded one-time read-only
extraction (verified `current_database()` + `transaction_read_only=on`) baked the
known-good baseline into the datasets (88 coverage ranges = 24 stat keys × 130 seasons =
3,120 cells; all 24 club era spans confirmed; `wikipedia_url`/`afltables_slug` captured;
AFL Tables slugs preserved verbatim; 1942–1945 Brownlow `not_applicable` war-year
semantics; `legacy_club_key` deliberately excluded; `sources.key` is the durable identity
contract, numeric `sources.id` database-local). The baseline was returned to
`ALLOW_CONNECTIONS=false` and is reference-only. Full detail: `AFLDB-ISSUE-093.md` §15.
Remaining phases (2–9) not yet implemented.

### Resolution — 2026-08-27
**RESOLVED.** The objective this issue was opened for is achieved and proven by execution, not
by inspection. Authoritative evidence: `AFLDB-ISSUE-093.md` §H15 (§H15.1–§H15.7). Basis:

1. A tracked canonical clean rebuild of `afldb_test` completed from scratch —
   `npm run db:test:rebuild -- --acknowledge-destroy afldb_test`.
2. The supported rebuild path has **zero `AFLDB_LEGACY_SQLITE` dependency**.
3. The accepted fitzRoy baseline is **hash-bound** — `full-history-20260827`, 1897–2025,
   131 artefacts, 719,042 rows, manifest SHA-256 `cc8aaf09…`, artefact-set SHA-256
   `8e14ce61…`, under `exactly_one_accepted` with no latest-label fallback.
4. The DraftGuru canonical snapshot imported successfully (`annual-html-20260826`: 5,057
   persons, 6,810 picks, 6 ledger decisions).
5. Every data stage ran under the **restricted `afldb_import` role** — no
   `--allow-owner-import-dsn`, no owner fallback, so grant sufficiency is proven rather than
   assumed.
6. **All nine rebuild stages passed**: PRECHECK, DATABASE RESET, MIGRATIONS, PRIVILEGES,
   REFERENCE DATA, FITZROY CORE, DRAFTGURU, DERIVED, FINAL VALIDATION.
7. Migrations **72/72**.
8. **`AFLDB-FINAL-VALIDATION PASSED: 13 checks`**, including
   `matches_after_accepted_last_season = 0` (2026 correctly excluded).
9. The reference-loader cascade defect that only real execution under the restricted role
   could expose was repaired and live-proven (§H12/§H13) — `tools/maintenance/privileges.sql`
   unchanged, no grant added.
10. The fitzRoy `corrections` threading defects in **both** the stats and Brownlow phases were
    repaired and live-proven (§H14).
11. `club_seasons = 0` was investigated and **proven to belong to the separately tracked
    ladder/team-season acquisition domain** (`AFLDB-ISSUE-095`) rather than invalidating the
    canonical rebuild — `staging.team_seasons` has no non-legacy writer, so zero is the
    expected outcome of a legacy-free rebuild under the current contract (§H15.5).

The full execution history above, the incident lineage, and the §H15 validation evidence are
retained unrewritten.

### Validation
Phase 1: `npx vitest run tests/reference-data.test.ts` — 12/12 PASS (user-run
2026-08-25). Phase 2: `npx vitest run tests/fitzroy-acquisition.test.ts` — 13/13 PASS +
real probe pair + real `trial-2024` acquisition with verified manifest (all user-run
2026-08-25). Phase 3: static gate
`npx vitest run tests/club-list-sources.test.ts tests/fitzroy-acquisition.test.ts
tests/reference-data.test.ts` — **33/33 PASS** (user-run 2026-08-25: 12/12 + 13/13 +
8/8); the ISSUE-092 database-side tests (24–27) await a live test database. Phase 4a:
`npx vitest run tests/fitzroy-core-import.test.ts` — PENDING (user-run; static pins +
fail-closed `--validate-only` spawn tests, no PostgreSQL/psycopg/network). No database
load has been executed anywhere yet — first real execution belongs to the later
orchestrator phase.

**Checkpoint 2026-08-27 — 321/321 DB-free tests PASS**, nothing skipped:
`npx vitest run tests/fitzroy-core-import.test.ts tests/db-test-rebuild.test.ts
tests/draftguru-import.test.ts tests/draftguru-acquisition.test.ts
tests/fitzroy-acquisition.test.ts tests/reference-data.test.ts`
(fitzroy-core-import 68, db-test-rebuild 70, draftguru-import 36, draftguru-acquisition 122,
plus fitzroy-acquisition and reference-data). Plus the accepted-baseline offline validator:
`import_fitzroy_core.py --label full-history-20260827 --validate-only
--require-accepted-baseline` — **PASSED, no PostgreSQL access**.

That is the whole of the current green evidence. **Still unproven:**
`tests/integration/draftguru-import.test.ts` (18 DB-backed proofs) needs a live test
database and is not part of the 321; the suites run importers as `afldb_owner`, so
`afldb_import` grants are not proven at runtime (ISSUE-083); `RESET_SQL` has never executed;
and no clean `afldb_test` rebuild has ever run.

### Follow-up
Tracked separately; none of these reopen this issue.

1. **`AFLDB-ISSUE-095` — canonical legacy-free ladder / team-season acquisition (OPEN).**
   `club_seasons` has no non-legacy acquisition path, so a canonical rebuild correctly yields
   zero rows. Runbook `AFLDB-ISSUE-095.md`. **Stage 9 must NOT gate `club_seasons` until that
   issue lands.** It links `AFLDB-ISSUE-015` (per-season `recomputeClubSeasons` parity) but
   does not absorb it.
2. **`AFLDB-ISSUE-083`** — restricted `afldb_import` test-role parity/closeout, handled
   separately (parked at `fa035ed`). Not absorbed here. The rebuild itself already ran its
   data stages under `afldb_import`.
3. **`AFLDB-ISSUE-092` §11 tests 24–27 — DONE 2026-08-28.** Run against the rebuilt
   `afldb_test`: 27/27, no skips. `AFLDB-ISSUE-092` is **Resolved**; `AFLDB-ISSUE-090` is
   **unblocked and still open**, and resumes its release-gate validation from there.
4. **`AFLDB-ISSUE-059` (`4444d76`) and `AFLDB-ISSUE-073` (`0885129`) are UNBLOCKED** for their
   own focused DB-backed validation against the rebuilt database, as separate work.

DraftGuru Stage B3 (the 5,057-person person-page crawl) remains **optional and NOT started**;
it was never a blocker. Do not merge the parked branches as part of this issue.

*Superseded 2026-08-27 blocker list, kept as history: (1) ISSUE-083 integration, (2)
`RESET_SQL` never proven against live PostgreSQL, (3) the first clean rebuild never executed.
Blocker 2 closed with the passing rollback proof (§20/§H2); blocker 3 closed by the passing
rebuild (§H15); ISSUE-083 stayed separate and the rebuild ran under the restricted role
regardless.*

*Superseded 2026-08-25 next-step, kept as history: "run the Phase-4a non-DB gate
(`tests/fitzroy-core-import.test.ts`), then `--validate-only` against the real `trial-2024`
snapshot" — both were done, and `trial-2024` is now partial/testing-only.*
(Phase 3 implemented 2026-08-25 per §17; §13.3 collapsed to a no-op — no structural
source gap found; Phase 4a implemented 2026-08-25 per §18.)
`AFLDB-ISSUE-092` §4 (the fail-closed `external_identities` gate) must land in whatever
importer ends up owning that reconciliation before it is ever run against `afldb_test`,
rebuilt path or not.

## AFLDB-ISSUE-091 — Migration checksum comparison is line-ending sensitive, causing false drift on a Windows checkout

- **Status:** Resolved
- **Severity:** Low
- **Area:** Tooling / Database migrations
- **Found:** 2026-08-25 (discovered while validating `AFLDB-ISSUE-090`'s migration 072
  application against `afldb_test`)
- **Resolved:** 2026-08-25
- **Files:** `tools/db/migration-checksum.ts` (new), `tools/db/migrate.ts` (`:113-116`
  checksum computation, `:142-151` drift check — now delegated to the new module),
  `tests/migration-checksum.test.ts` (new)
- **Runbook:** `AFLDB-ISSUE-091.md` — complete, implementation-ready plan drafted 2026-08-25,
  revised the same day after user review found the original raw+LF-only compatibility design
  was asymmetric (missed a stored-CRLF/current-LF false positive — the exact mirror of the
  bug this issue fixes). Revised design uses three bounded representations (raw, canonical-LF,
  canonical-CRLF) and a full 10-row compatibility matrix. Approved, implemented, and validated
  exactly as designed; see §13 of the runbook for full evidence.

### Symptom
`npm run db:status` / `npm run db:migrate` (`AFLDB_MIGRATE_TARGET=test`) report six
already-applied migrations as modified since they ran — `026_aflw_read_model.sql`,
`053_player_achievements.sql`, `058_data_edits_editor_entities.sql`,
`059_honour_team_member_identity.sql`, `060_wikipedia_22_under_22_source.sql`,
`061_award_winner_sort_order.sql` — and the runner refuses to apply **any** pending
migration while the drift exists, blocking migration application generally, not just for
the six flagged files.

### Evidence
1. `git status --porcelain`, scoped to the six files, printed nothing — no uncommitted
   Git-visible edit.
2. Raw worktree SHA-256 (Windows checkout, CRLF) differed from the HEAD blob SHA-256 for
   all six.
3. Stripping CR bytes from the worktree content made the SHA-256 match the HEAD blob
   exactly for all six.
4. A read-only query against `afldb_test`'s `afldb_meta.schema_migrations.checksum` for
   the six returned a value that exactly equals the HEAD/LF hash from step 3, for all six.

Together this is conclusive: `migrate.ts:113-116` computes `sha256(readFileSync(path,
'utf8'))` with no line-ending normalization, hashing whatever raw bytes the current
checkout materializes. The `afldb_test` ledger was populated from LF bytes (i.e. these six
migrations were originally applied from a non-CRLF checkout). A Windows checkout of the
same, unmodified, committed content can materialize CRLF line endings, producing a
different checksum for identical logical content — a false-positive drift report, not a
real content change, ledger corruption, or tamper.

### Root cause
The checksum function hashes raw file bytes as read from disk with no line-ending
normalization step, either at apply time or at drift-check time, so checksum identity is
not deterministic across platforms/checkout configurations that may legitimately produce
CRLF vs LF for the same committed blob.

### Fix
Implemented exactly per the approved, revised `AFLDB-ISSUE-091.md`: checksum logic extracted
into a new pure module `tools/db/migration-checksum.ts` computing three bounded
representations of the current file content — raw bytes, canonical all-LF, canonical
all-CRLF — and `migrate.ts`'s drift check accepts a stored ledger checksum that matches any
one of them. Only the canonical all-LF representation is ever written for a newly applied
migration. An earlier version of this plan accepted only raw-bytes-or-canonical-LF and was
found during review to be asymmetric (a migration whose ledger checksum was historically
CRLF-recorded would false-positive the next time it was validated from a genuine LF
checkout — the mirror image of the bug this issue fixes); the third representation closes
that gap. Real migration-tamper detection is preserved (an actual content edit to an applied
migration is still caught — proven by the rejected-edit/whitespace/final-newline/lone-CR
tests). Migration *execution* (`tx.unsafe(m.sql)`) is unchanged — only checksum computation
and comparison changed. No historical applied migration and no recorded `schema_migrations`
checksum was rewritten.

### Validation
All three gates green (2026-08-25), full evidence in `AFLDB-ISSUE-091.md` §13:
- `npm test -- tests/migration-checksum.test.ts` — 12/12 passed, 0 failures.
- `npm run typecheck` — PASS.
- `AFLDB_MIGRATE_TARGET=test npm run db:status` — `72 migration file(s), 71 already applied`,
  all six previously-drifted migrations now report `applied` with no `"modified since they
  ran"` error, `072_dob_conflict_ownership.sql` correctly reported as the sole pending
  migration. `--status` performs no write; no ledger row or migration file was mutated.

### Follow-up
None. `AFLDB-ISSUE-090` is unblocked with respect to this issue — migration 072 remains
CREATED, NOT APPLIED, and applying it is ISSUE-090's own next action.

## AFLDB-ISSUE-094 — Real-user NL semantic intent mapping gaps

- **Status:** Resolved
- **Severity:** Medium
- **Area:** Natural-language search / query planning / answer compilation
- **Found:** 2026-08-26
- **Resolved:** 2026-08-26
- **Files:** `src/search/nl/parser.ts`, `src/search/nl/vocab.ts`, `src/search/nl/plan.ts`,
  `src/search/nl/answer-types.ts`, `src/search/nl/describe.ts`, `src/db/queries/nl/`,
  focused NL tests and realistic NL UI corpora.

### Symptom
Realistic AFL wording is declined or cannot be represented for grouped upper-bound
queries, two-club head-to-head records/draws, club-specific career-games leaders, and
player suffix variants. Rebound-50 wording is currently accepted even though the product
does not support that statistic in NL search.

### Reproduction
Representative inputs are `teams with at most 2 wins against Richmond`, `Richmond v
Carlton head to head`, `Richmond record against Carlton`, `who has won more Richmond or
Carlton`, `how many draws between Richmond and Carlton`, `last draw between Richmond and
Carlton`, `Richmond career leader for games`, `Gary Ablett Jr career goals`, and `most
rebound 50s in 2024`. The existing realistic 1,440-question baseline answered 1,238 and
failed 202: head-to-head 80, draws 80, grouped thresholds 18, club career leaders 16, and
player career 8.

### Expected
Each supported phrase family maps atomically to explicit typed semantics, validates before
SQL, and returns database-correct organization-lineage/player results. Unsupported rebound
50 queries decline explicitly. Meaningful leftover words and unknown input continue to
fail closed.

### Actual / evidence
`extractHavingClause()` detects `at most` but removes only the result noun and numeric
count, leaving `most` as a meaningful token. `NlGrain`, `NlQueryPlan`, `NlAnswerPayload`,
compiler dispatch, and `describeAnswer()` have no head-to-head concept. The
`player_career` compiler reads `player_career_stats.games` even when `scope.clubFor` is
present, so club-specific games are not expressible. Player lookup passes suffix spelling
through unchanged. `METRIC_WORDS` and stat-game idioms map R50/rebound-50 wording to
`rebounds`.

### Root cause
Several realistic phrases are being forced through generic extraction even though they
carry relationship or operator semantics that must be consumed and represented as a
single typed cue. Two required answer families are absent from the plan/compiler contract,
and one deliberately unsupported metric remains exposed in the NL vocabulary.

The initial integration tests also incorrectly assumed the rebuilt `afldb_test` contained
specific historical Richmond career rows and both Gary Ablett junior/senior identities.
Those rows are not part of the supported baseline test-database contract; the resulting
two failures were invalid test-data assumptions, not implementation defects.

### Plan
Capture focused red parser reports; atomically consume comparison operators; add a typed
head-to-head grain/kind, validator, compiler, payload, and description; compile
club-scoped career games from match participation; normalize player suffix variants only
inside player resolution; explicitly decline rebound 50s; remove only invalid generated
`<player> most games in a game` benchmark rows; bump parser version; then run focused,
integration, database-truth, UI-realistic, and decline validations as available.

### Fix
Parser version 26 atomically consumes comparison phrases through the comparison vocabulary
and adds explicit `no more than`/`no fewer than` mappings. A DB-free semantic-intent module
maps record, compare-wins, draw-count and last-draw phrase families to a typed
`head_to_head` grain carrying exactly one matchup. Validation, PostgreSQL compilation,
answer payload/description, execution dispatch and UI rendering now share that contract.
The compiler counts physical matches once across organization lineages and returns both
clubs' wins, draws, total meetings, latest meeting and latest draw.

Club-scoped career games now route to `player_career` and count distinct match appearances
for the named organization rather than reading whole-career `c.games`; the compiler can
also total allowlisted match-stat metrics for a club without silently dropping the scope.
Player suffix variants normalize only at resolver comparison (`Jr`/`Jnr`/`Junior`,
`Sr`/`Snr`/`Senior`), keeping junior and senior identities distinct. Rebound-50 phrases
now return a deterministic unsupported-statistic response and `rebounds` is removed from
the NL metric catalogue while the Grid Solver catalogue remains untouched. Five invalid
`<player> most games in a game` rows were removed from the realistic corpus, leaving 1,435
real questions with stable original ids.

The integration tests now create deterministic isolated fixture organizations, historical
club identities, matches and distinct junior/senior players. They compare the production
answers with independent PostgreSQL truth and perform targeted idempotent cleanup.

### Validation
- Pre-change DB-free NL parser baseline: 161/161 green.
- Focused semantic corpus: 480/480 expected plan/decline classifications green; every plan
  also passed `validatePlan`.
- Cleaned realistic target-family parser check: 395/395 head-to-head, draw, grouped
  threshold, club-career and player-career rows parsed and validated.
- Permanent NL-focused unit gate: 13 files, 593 tests green. The narrower new/affected gate
  is 6 files, 280 tests green.
- `git diff --check`: green.
- `npm run typecheck`: the changed NL code is clean, but the repository gate remains red on
  four pre-existing `string | NonSharedBuffer` `.trim()` errors in
  `tests/draftguru-acquisition.test.ts` (lines 299, 302, 479, 592).
- User-run PostgreSQL gate against the guarded `AFLDB_TEST_DATABASE_URL`:
  `npm.cmd test -- --run tests/integration/nl-semantic-mapping.test.ts` — 1 test file,
  6/6 tests passed in 5.25 seconds. Record, compare-wins, draw-count, last-draw,
  organization-lineage career games, and Jr/Jnr/Junior versus Sr/Snr/Senior identity all
  passed against independent PostgreSQL truth and deterministic isolated fixtures.
- No post-change browser answerability score or database-correctness percentage beyond
  these independently checked semantic families is claimed.

### Follow-up
None for ISSUE-094. The previously observed streak-telemetry gap remains separate; this
semantic patch does not change telemetry routing. Future UI answerability benchmarking is
a product measurement, not an outstanding database-truth defect in this resolved issue.

## AFLDB-ISSUE-095 — Canonical legacy-free ladder / team-season acquisition

- **Status:** Resolved
- **Severity:** Medium
- **Area:** Data acquisition / Import architecture / Data integrity
- **Found:** 2026-08-27 (proven during `AFLDB-ISSUE-093`'s first complete canonical clean
  rebuild of `afldb_test` — see `AFLDB-ISSUE-093.md` §H15.5)
- **Resolved:** 2026-08-28
- **Runbook:** `AFLDB-ISSUE-095.md` — durable source of truth. Contains the proven source
  chain, the per-field table, the fitzRoy capability split, and decisions D1–D7.
  **D1–D7 DRAFTED 2026-08-28 in §10**, from the exhaustive 1897–2025 coverage probe. One
  design point (§10.8, `premiership_points`/`ladder_rank`) awaits operator approval. No
  importer code has been written.
- **Files (today, for orientation only — none changed yet):**
  `tools/migration/rebuild_derived.py` (`REBUILDS["club_seasons"]`, `:312`),
  `tools/migration/import_legacy_afl.py` (`:767`, `:776`, `:795`, `:996`, `:1021`),
  `src/db/migrations/006_draft_relationships.sql` (`:55-80`),
  `src/db/queries/player-derived.ts` (`recomputeClubSeasons`, `:402-411`),
  `tools/db/rebuild-test.ts` (Stage 9 FINAL VALIDATION),
  `data/reference/sources.json`
- **Related:** `AFLDB-ISSUE-093` (canonical clean rebuild, Resolved 2026-08-27) —
  this issue is its recorded follow-up. `AFLDB-ISSUE-015` (Resolved 2026-08-22) holds the
  existing per-season `recomputeClubSeasons` parity work and is **linked, not absorbed**; its
  status is unchanged by this issue.

### Problem
`club_seasons` — AFLDB's club/season ladder table — has no canonical, legacy-free acquisition
path. Proven chain (source-verified 2026-08-27, do not re-investigate):

1. `rebuild_derived.py`'s `REBUILDS["club_seasons"]` (`:312`) builds the table **only** from
   `staging.team_seasons`.
2. `staging.team_seasons` is written **only** by `import_legacy_afl.py` (`:767`, `:776`,
   `:795`; group key `"ladders"` at `:996`). The only other references are
   `rebuild_derived.py`, which reads it, and `validate_migration.py`, the legacy parity
   checker.
3. That loader requires `AFLDB_LEGACY_SQLITE` (`:1021`).
4. The ISSUE-093 canonical rebuild deliberately has **no legacy staging-load stage** — its
   data stages are reference → fitzRoy core → DraftGuru → derived-from-those, and ladder
   tallies were never in that contract.

So a clean canonical rebuild correctly produces `club_seasons = 0`. That is the **expected**
outcome of a legacy-free rebuild under the current contract, not a defect in it.

### Impact
Genuine, not cosmetic. `club_seasons` is read by `src/db/queries/clubs.ts`, `seasons.ts`,
`rounds.ts`, `grid-solver.ts`, `search.ts`, `db-health.ts`, `player-derived.ts`,
`nl/club-season.ts`, by NL search `parser.ts`/`plan.ts`/`vocab.ts`, and by
`src/lib/edit/spec.ts`. Ladders, premiership and wooden-spoon flags, finals counts and
club-season NL answers are unavailable while it is empty.

Operational consequence carried over from `AFLDB-ISSUE-015`: `recomputeClubSeasons`
(`player-derived.ts:402-411`) **fails closed** when `staging.team_seasons` has no rows for the
season, and it is wired into `createMatch`, `deleteMatch` and the `applyMatchEdit` score case.
On a canonically rebuilt database every match create/delete/score-edit therefore throws for
every season — the guard behaving as designed, not a new defect.

### Scope
Give the ladder/team-season domain a canonical, legacy-free acquisition and load path:

- replace the legacy-only `staging.team_seasons` source path;
- choose and document the authoritative non-legacy source;
- decide, per field, what is reconstructed from canonical match facts versus externally
  sourced, preserving historical semantics for `played`, `wins`, `draws`, `losses`,
  `points_for`, `points_against`, `percentage`, `premiership_points`, `ladder_rank`,
  `wooden_spoon`, `is_premier`, `finals_played`;
- handle historical premiership-points rules, byes, forfeits and *published* ladder rankings
  correctly (prefer NULL over an invented value — `premiership_points`, `percentage` and
  `ladder_rank` are nullable);
- determine authoritative provenance/`source_id` — the current SQL hardcodes
  `sports_data_lab`, which match-derived rows must not inherit;
- preserve the `afldb_identity_for_season` club-identity re-pointing;
- decide whether this becomes a new canonical rebuild stage or part of an existing one;
- once implemented, add an appropriate Stage-9 validation gate;
- **preserve ZERO supported `AFLDB_LEGACY_SQLITE` dependency**, including as a fallback.

Full decision list D1–D7 is in `AFLDB-ISSUE-095.md` §5. The source/provenance design decision
is deliberately **not** made in this entry.

### Resolution — 2026-08-28
Full record in `AFLDB-ISSUE-095.md` §14. Acceptance proven by a **clean `afldb_test`
rebuild**: every stage passed, the 1,622-row ladder witness comparison agreed on every
compared field, and FINAL VALIDATION passed **19/19** (13 existing + 6 new `club_seasons`
gates). Release gates moved **42 -> 45 of 64** with **all nine club-organization/identity
gates green**.

**Actual root cause.** Not a defect in the rebuild. `club_seasons` had no acquisition path
that did not go through `AFLDB_LEGACY_SQLITE`, so a legacy-free rebuild correctly produced
zero rows. The apparent replacement source was not a source at all: pinned fitzRoy 1.8.0's
`fetch_ladder_afltables` **computes** the ladder from results under a uniform 4/2/0 rule
rather than reading a published one — established by deparsing the pinned implementation
and corroborated by measurement over its own 1,622 rows.

**The fix as shipped.** Every `club_seasons` column is derived from AFLDB's own canonical
match set under an explicitly declared rule; provenance moved `sports_data_lab` ->
`afltables`; `ladder_rank` fails closed to NULL on an exact points-and-percentage tie (zero
such ties exist in 1897-2025, audited by exact rational comparison); `recomputeClubSeasons`
is in lockstep with its guard re-pointed to canonical matches, which also cleared the
fail-closed breakage of every match create/delete/score-edit. Historical identity is
**proved by a Stage-9 gate rather than forced** by re-pointing. A **fail-open** identity
defect was found and closed: the `North Melbourne` 1999-2007 -> Kangaroos rule was scoped
to `results`, and because North Melbourne's span contains the Kangaroos era a ladder lookup
passed the era check and resolved silently to the modern identity. The acquired ladder is
retained as a **validation witness only**, cross-checked as a tenth *validation* stage; the
four-stage data topology is unchanged.

**Validation.** Clean rebuild 19/19; witness comparison 1,622/1,622; witness validator
26/26 offline; resolver contract 40/40; DB-free suites 323 passed / 6 skipped with one
out-of-scope failure. **No migration added (75/75), no privilege widened, no `afldb_dev` or
production access.**

**The 19 remaining release-gate failures are owned elsewhere and were left untouched:**
Brownlow acquisition (6, incl. one Advanced Search case), DraftGuru Stage B3 (3),
attendance baseline (1), DOB enrichment (5), current-season 2026 (3), and the Advanced
Search id-hash case below.

### Follow-up
Tracked elsewhere; none reopens this issue.

1. **Advanced Search `debuted in the 1960s with exactly two clubs` — pre-existing, NOT
   caused by this issue.** Count is correct at 110; only the id hash differs
   (`42d5dd22f2712ffe` vs the pinned `8cebc4aa37002766`). Four independent proofs:
   `runAdvancedSearch` reads `players`/`player_career_stats` and **never `club_seasons`**;
   every hunk of this issue's `rebuild_derived.py` diff lies inside the `club_seasons`
   block; `AFLDB-ISSUE-090-HANDOFF.md` §11.3 row 7 already recorded this exact gate failing
   the same way, classified rebuild-baseline drift, before this issue had any code; and
   `players.id` is identity-generated at import, with the live table holding 13,277 rows
   numbered 1-13,277 against a retired legacy population of 12,472. Membership is intact —
   a direct query returns exactly 110 players, all with `debut_season` 1960-1969 and
   `clubs_played = 2`, mapping to 110 **distinct** AFL Tables profile URLs. The pin hashes
   a surrogate key every rebuild re-mints; the rebuild-stable equivalent over profile URLs
   is `44d77e946fc5afd8`. **Not re-pinned here** — that is `AFLDB-ISSUE-090`/`-093`
   baseline territory.
2. **`AFLDB-ISSUE-102`** — the awards sibling of the same legacy gap. Unchanged.
3. **`AFLDB-ISSUE-101`** — end-of-season rollover must re-derive the completed season
   through this path and supersede in-season provenance.
4. **`brownlow_season_votes` has no canonical legacy-free writer** — the third sibling of
   this gap, still recorded as an unowned observation rather than a tracked issue.

### Evidence and drafted decisions — 2026-08-28
Full record in `AFLDB-ISSUE-095.md` §10. Summary only; §10 is authoritative.

- **Exhaustive D1 probe, 1897–2025 (read-only, no database).** `fetch_ladder_afltables`
  returned **129/129 seasons** with zero errors, zero zero-row seasons, zero schema drift,
  zero duplicate-team seasons and zero missing ladder positions; 1,622 rows, 20 distinct
  labels, 4 rows (1916) to 18 (2012–2025). **Historical coverage is proven sufficient.**
- **The source is a local recomputation, not a published ladder.** `Percentage` equals
  `Score.For/Score.Against` exactly in all 129 seasons; `sum(Season.Points) mod 4 = 0` and
  `sum(Score.For) = sum(Score.Against)` in all 129 seasons with no bye, forfeit or deduction
  exception in 128 years; the 1,622-row population is identical to the accepted snapshot's
  1,622 results-derived `(club string, season)` pairs; `Round.Number` is a free parameter and
  no `wins`/`draws`/`losses` columns exist. **fitzRoy is therefore adopted as a VALIDATION
  artefact, not a field authority** — the tallies are derived from canonical `matches`.
  The pinned package's code was not read: a CRAN binary install stores it in a compressed
  lazy-load database with no readable source. §10.1 carries the confirming command.
- **D5 gap found and closed in the plan.** The source emits one modernised label per
  organization in both directions (`Sydney` to 1897, `Brisbane Lions` to 1987, `Footscray`
  to 2025, Kangaroos never exposed). Existing rules cover three of the four families; the
  `North Melbourne` 1999–2007 → Kangaroos rule is scoped `dataset: "results"` and would
  **fail open** for a ladder dataset, silently resolving to the modern identity. A
  `dataset: "ladder"` rule is added, and `KNOWN_DATASETS` gains `"ladder"`.
- **Scope correction.** ISSUE-095 owns **two** release-gate failures, not three.
  `gate: 2026 is provisional` → `preserves the raw ladder untouched in staging`
  (`tests/integration/release-gates.test.ts:872`) asserts a 2026 `staging.team_seasons` row
  and belongs to the current-season pipeline (`AFLDB-ISSUE-098`/`-099`, rollover
  `AFLDB-ISSUE-101`). No new issue was created; the owning issues already exist.
### Implementation — 2026-08-28
Full record in `AFLDB-ISSUE-095.md` §11. **Not resolved**; acceptance is outstanding.

- **§10.8 approved (Option B)** with a fail-closed tie refinement, after the operator
  deparsed pinned fitzRoy 1.8.0 and confirmed `fetch_ladder_afltables` computes points and
  position locally with **no tie-break beyond percentage**.
- **Tie audit:** zero exact points-and-percentage ties across all 1,622 accepted
  club-seasons, by exact rational comparison. Points-then-percentage is sufficient for
  1897–2025. The fail-closed branch ships anyway — a tie yields `ladder_rank = NULL` and no
  wooden spoon, never an order taken from club id, alphabet or row order — with a Stage-9
  gate turning any future tie into a loud failure.
- **Derivation:** every `club_seasons` column now comes from `matches` (home-and-away only;
  `NOT is_final` is CHECK-equivalent to fitzRoy's `Round.Type == "Regular"`), under a
  declared 4/2/0 rule, percentage stored ×100, provenance `afltables`. Wooden-spoon
  completion gate, drawn-Grand-Final exclusion and finals counting preserved verbatim.
- **`recomputeClubSeasons`** brought into lockstep, guard re-pointed to "no canonical
  home-and-away matches". This clears the operational consequence recorded above: match
  create/delete/score-edit no longer throws on a canonically rebuilt database.
- **Identity proved, not forced:** the derivation does not re-point through
  `afldb_identity_for_season` — matches already carry the historical identity — and a
  Stage-9 gate asserts the invariant instead, so a mis-attributed match fails the rebuild.
- **Six Stage-9 gates** added; the §8 prohibition is satisfied and superseded. **Nine-stage
  rebuild topology unchanged; no migration; state stays 75/75.**
- **Validation run:** `tests/python/ladder_identity_contract.py` **37/37**, DB-free —
  all 1,622 label-season pairs resolve to exactly one time-bounded identity, era partitions
  **101/128/101**, Fitzroy keeps its 100 seasons and never merges into Brisbane.
  **No vitest suite was run:** this worktree has no `node_modules` and `D:\dev\afldb` is
  off-limits.
- **Release-gate pins repaired** (ISSUE-095-owned only): `to: 2026` → `2025`, era totals
  102/129/102 → **101/128/101**, matching the measured source.
- **DB-free validation and repair pass (`AFLDB-ISSUE-095.md` §12).** Five suites reported
  six failures; **five repaired, one classified out of scope**, no product design changed.
  Final: **309 passed, 1 failed, 6 skipped**, plus the resolver contract 37/37.
  - **One was ISSUE-095's:** the contract test asserted a flat dataset key list, which
    conflated fact-bearing datasets with a validation witness. Repaired *semantically* —
    the three fact datasets are now identified by not carrying `role: VALIDATION_WITNESS`
    and are asserted equal to `full_history.required_datasets`, and `ladder` is separately
    asserted to be a witness, absent from that list, with no field promoted to fact.
  - **Four were pre-existing CRLF sensitivity**, reproduced against the unmodified HEAD
    blobs. `core.autocrlf=true` on this worktree, and four assertions compare source text
    using `\n`. Notably the `has zero legacy/database dependency` guard was **inert, not
    merely tripping**: it strips comments with `/#.*$/` and JavaScript's `.` does not match
    `\r`, so nothing was ever stripped on a CRLF checkout. Repaired by normalising the
    source on read in two test files; every assertion left as written. Rewording the
    adapter comment would have gone green while leaving the guard switched off.
  - **One is out of scope and untouched:** `finds the tables created after 045 that never
    registered import write` now also lists `data_overrides` (migration 073) and
    `promotion_decisions` (074) — `AFLDB-ISSUE-096`/`AFLDB-ISSUE-086` tables. ISSUE-095
    added no table, touched no migration and changed no grant. Repairing it would assert
    that those two correctly lack import write, which is ISSUE-086's manual-authority
    decision and is recorded as blocked and unbuilt. **Not repaired here.**
### Witness contract and D7 validation path — 2026-08-28
Full record in `AFLDB-ISSUE-095.md` §13. **Still not resolved**; the rebuild is outstanding.

- **Witness acquired:** `ladder-20260828`, 129 files, 1,622 rows, zero fetch failures.
  Pinned in `fitzroy-contract.json` as `datasets.ladder.accepted_witness` with the tracked
  manifest bound by sha256. The core accepted baseline was **not** touched — that register's
  `exactly_one_accepted` policy would refuse a second accepted entry.
- **New single authority:** `tools/rebuild/fitzroy/validate_ladder_witness.py`. Offline mode
  makes no database connection and no network request and proves manifest binding, per-file
  sha256, row counts, the eight-column schema, per-season structure, the 1897–2025 range,
  and resolution of all 1,622 labels through the real `ClubResolver`. **26/26.** The
  existing contract test now defers to it instead of re-implementing it, and additionally
  proves the tracked label universe equals the acquired one.
- **Durability answered by reuse, not invention:** ISSUE-093's convention already covers it
  — bytes gitignored, manifest tracked, PRECHECK re-proves hashes before destruction. The
  rebuild's preflight now refuses on a missing or altered witness. **Proven by execution:**
  exit 2 with the bytes moved aside, exit 0 restored.
- **D7 cross-check wired** as a tenth **validation** stage `ladder-witness` between
  `derived` and `fingerprints`, comparing season, resolved identity, points for/against,
  premiership points and ladder rank, with per-row diagnostics and no mutation. This amends
  §11.4's "no tenth stage": D6 concerned **data** stages, and the four-stage data topology
  is unchanged and now asserted by test. Percentage is compared by exact decimal
  reconstruction from the witness's integers (×100, ROUND_HALF_UP to match PostgreSQL),
  never float-to-float.
- **Acquirer messaging repaired narrowly:** a witness-only run reported
  `missing_seasons: [all 129]` and pointed at the core adjudicator. It now measures the
  witness's own files, records `acquisition_kind: validation_witness`, and names the right
  validator. Core gates unchanged.
- **The remaining `reference-data` failure does not block the rebuild**, checked two ways:
  `db:test:rebuild` runs no vitest, and neither `data_overrides` nor `promotion_decisions`
  reaches `clubs`/`players`/`seasons`, so neither is in the reference loader's FK cascade
  closure. Still `AFLDB-ISSUE-096`/`-086`'s.
- **Validation:** five suites **314 passed / 1 failed / 6 skipped** (the failure above);
  contract test **40/40**; witness validator **26/26**.
- **Outstanding:** the clean `afldb_test` rebuild — a separate authorisation, a full
  destructive recreate, and the only thing that can prove the D7 cross-check.

### fitzRoy capability split (established, ISSUE-093 §H15.5)
Deterministically reconstructable from the accepted match facts: `played`, `wins`, `draws`,
`losses`, `points_for`, `points_against`, `percentage` — plus `is_premier` and `finals_played`,
which the existing SQL already derives from Grand Final `winner_club_id` and `matches.is_final`.
**Not** proven by fitzRoy alone: the officially published `ladder_rank`, and
`premiership_points` semantics across changing competition rules.

### Stage-9 policy until this lands
**Do NOT add a `club_seasons` non-zero gate** to the rebuild's FINAL VALIDATION stage until
this domain has an accepted canonical source and contract. A non-zero requirement would fail
every canonical rebuild over a known, deliberate gap.

### Validation
None yet — nothing implemented.

### Follow-up
Whatever D1/D2/D4 decide, `recomputeClubSeasons` must be brought back into lockstep with the
new canonical definition as part of this issue's implementation. That does not reopen
`AFLDB-ISSUE-015`.

## AFLDB-ISSUE-096 — 2026+ API-first acquisition architecture and contract

- **Status:** Resolved
- **Severity:** Medium
- **Area:** Data acquisition / Import architecture
- **Found:** 2026-08-28 (2026+ API acquisition investigation)
- **Resolved:** 2026-08-28 — **complete within its authorised S1–S4 scope.** All four approved
  stages implemented and green, migration 074 applied to `afldb_test` and validated against the
  real catalogue, and §5.H validated to the full extent the implemented code permits. See
  **Resolution** below and `AFLDB-ISSUE-096.md` §16.16.
- **Runbook:** `AFLDB-ISSUE-096.md` — **durable source of truth for this issue** (scope,
  evidence summary, decisions A–H, schema concepts, boundaries, validation, HALT).
  `AFLDB-2026-API-ACQUISITION.md` remains the parent investigation runbook; this entry is its
  §9 row A, and its §13 holds the dated P1–P7 probe results.
- **Files changed (S1, 2026-08-28):** `data/reference/source-families.json` (new),
  `src/lib/acquisition/source-families.ts` (new), `tests/reference-data.test.ts` (extended)
- **Files changed (S2, 2026-08-28):** `src/db/migrations/074_source_observation_spine.sql`
  (new, **applied to `afldb_test` 2026-08-28 and now checksum-frozen — do not edit**),
  `src/lib/acquisition/observations.ts` (new),
  `tools/maintenance/privileges.sql` (afldb_auth spec + column-scoped UPDATE),
  `tests/current-season-import.test.ts` (extended)
- **Files changed (S3, 2026-08-28 — COMPLETE and GREEN 84/84):**
  `src/lib/acquisition/reconciliation.ts` (new), `tests/current-season-import.test.ts` (extended
  again). No migration, no schema change, no change to `observations.ts` or
  `current-season-import.ts`.
- **Files (orientation only — unchanged):**
  `src/lib/external-afl/current-season-import.ts`,
  `src/db/migrations/063_external_current_match_sources.sql`,
  `src/db/migrations/064_matches_external_provenance.sql`
- **Related:** `AFLDB-ISSUE-086` (unrestricted canonical overwrite — referenced by rules 5/6,
  **not duplicated**), `AFLDB-ISSUE-092` (`--source-key` containment pattern reused),
  `AFLDB-ISSUE-095` (ladder/team-season — coordinated, **not absorbed**),
  `AFLDB-ISSUE-078`/`080`/`085` (destructive-reload lessons)

### Problem
AFLDB has no standing contract for how a 2026-and-later season is acquired. The one shipped
path covers matches only, snapshots by overwrite, cannot distinguish a source correction from
a deletion, and can write canonical rows without an ownership predicate. Every additional data
family would otherwise repeat those choices independently.

### Scope
**Design and contract only. No family-specific importer implementation** — those belong to
`AFLDB-ISSUE-099` (settle stage) and `AFLDB-ISSUE-100` (lineups).

Agree and record:

- the immutable/generalised staging contract (append-only observation keyed
  `(source_id, external_record_id, payload_hash)`, or a superseded-row archive);
- the reconciliation/diff model;
- the reviewed-promotion queue;
- the provenance, ownership, absence and idempotence rules — the ten standing rules in
  `AFLDB-2026-API-ACQUISITION.md` §4.

### Approved standing policy carried into this issue
Free/hobby sources only; fetch/staging/diff may run automatically; canonical promotion is
reviewed by default; lineups are staging-only; only the in-progress season belongs to this
pipeline; a completed season is re-acquired through the standard full-history fitzRoy path and
supersedes the in-season provenance.

### Exclusions
Do not create a Champion Data licensing issue. Do not open a `player_match_period_stats` issue
while no free source exists. Do not duplicate `AFLDB-ISSUE-086` or `AFLDB-ISSUE-095`.

### Evidence baseline — P1–P7, run 2026-08-28
Full record in `AFLDB-2026-API-ACQUISITION.md` §13; summary in `AFLDB-ISSUE-096.md` §4.

- **P3 PASS** — AFL API lineup identity adequate (`CD_M…`/`CD_T…`/`CD_I…`); **column set differs
  between rounds (19 vs 20)**; **no substitute field**.
- **P4 PASS** — `providerId` stable and **proven** identical to the lineup player id (26/26);
  **`weightInKg` = 0 for 46/46 rows** ⇒ zero-as-missing must map to NULL.
- **P5 PASS — stop condition NOT triggered.** 9,522 × 81, 2026-03-05 → 2026-08-23. `url` **0 NA**
  and 1:1 with `ID` (663 ↔ 663), but **`ID` is 82 NA across 5 players**. **Contradicts the earlier
  "0 NA" assumption, which was measured on completed seasons: the settle path must key on `url`.**
  Round vocabularies diverge across AFL Tables / Squiggle / AFL API ⇒ a declared per-source round
  mapping is required. `Substitute` is NA for all 9,522 rows.
- **P6 PASS** — `fetch_ladder_afltables(2026)` = 18 × 8. **ISSUE-095 evidence only; no D1–D7
  decision made or altered.**
- **P1 PASS — re-run 2026-08-28** once the key was supplied (previously BLOCKED). Kali
  `/matches` is **NOT a Squiggle proxy**: a real value disagreement on a completed match
  (Essendon v Port Adelaide 2026-08-23, Kali 95–105 vs Squiggle 95–104 at `complete=100`),
  `crowd` on 80 of 204 rows where Squiggle publishes no attendance at all, disjoint id spaces
  (0 shared), a different venue vocabulary on 80 of 160 joined games, and no goals/behinds.
  **Squiggle + Kali are now TWO witnesses for matches**; `/fixture` remains a proven proxy and
  stays in the Squiggle group. Residual: pairwise derivation is disproven, a **common ultimate
  upstream is not**, so disagreement stays a review signal.
- **P2 PASS — re-run 2026-08-28** (previously BLOCKED). **No player id on the Kali stat
  grain**: `/player-stats` and `/player-stats-advanced` project `matchId`, `playerName`,
  `teamId` only. `/players` has stable `id`/`onlineId` (2,865 distinct, 0 null) and the
  `player_id` filter works on the numeric id, so Kali holds it internally and withholds it.
  Identity therefore stays **fail-closed**; name+team is a heuristic (two Alwyn Daveys, both
  `essendon`; `currentTeamId` is not the team at match time).
- **P7 BLOCKED** — `ssh arm@10.0.40.100` refused non-interactively. **Database identity was never
  proven and no database was queried.** Not required by this contract.

### Dependencies and gates
Depends on nothing. Not gated on any probe. Two consequences recorded, not new policy:
`AFLDB-ISSUE-099` and `AFLDB-ISSUE-100` are **no longer probe-blocked** (P5/P3 passed), and
promotion of `corrected`/`update` candidates onto existing canonical rows cannot be implemented
until **`AFLDB-ISSUE-086`'s** override-authority contract lands — until then every such promotion is
authority-indeterminate and must refuse.

### Manual-authority boundary
`AFLDB-ISSUE-096` defines only the **invariant** (a promotion must never overwrite an active
human/admin authority decision, and must fail closed when that state cannot be determined) and the
**fail-closed interface** it needs. The **mechanism and storage** — including the `data_overrides`
work — belong to **`AFLDB-ISSUE-086`** and are not pre-empted here. `data_edits` is audit evidence
and participates only if ISSUE-086's final contract says so. No second authority model is invented.

### Approval and implementation state — 2026-08-28
The **§13 HALT is LIFTED**. The user approved the amended decisions; the approvals are recorded
verbatim in `AFLDB-ISSUE-096.md` §14 and convert this issue from design-only to **foundation
implementation across stages S1–S4** (family importers still excluded). Approved: the three-grain
observation model; retaining `staging.external_current_matches`; **no automatic canonical
promotion in v1**; the ISSUE-086 authority boundary (interface and invariant only); Kali inside the
Squiggle independence group; and **not** retrying P1/P2/P7 — those stay BLOCKED and no local
database may substitute for P7.

**Two of those approvals were superseded the same day, by the user and by evidence.** The user
supplied `KALI_AFL_API_KEY` and explicitly authorised retrying **P1 and P2 only**; both PASSED,
and P1 **disproved** the Squiggle-derived assumption, so approval 5's own escape clause
("unless P1 later proves independence") fired and the registry was corrected. **P7 remains
BLOCKED and no local database may substitute for it.**

**S1 IMPLEMENTED, then AMENDED by the P1/P2 re-run** (`AFLDB-ISSUE-096.md` §15): the
tracked source-family registry
`data/reference/source-families.json` plus a pure, fail-closed typed parser
`src/lib/acquisition/source-families.ts` and nine DB-free contract tests extending
`tests/reference-data.test.ts`. **Seven** families over four sources; **no family is
promotable**; **Squiggle and Kali are two independence groups for `match` and one for
`fixture`**; the AFL API lineup column set is deliberately `incomplete` so a round-20 payload
refuses; `afltables.player_match_stats` and the new `kali_afl_stats.player_stats` are
`identity_only` and cannot be projected. No migration, no importer, no change to
`sources.json`, `seasons.json` or `current-season-import.ts`.

**S1 amended 2026-08-28 by P1/P2** (`AFLDB-ISSUE-096.md` §15.1–§15.2):
`kali_afl_stats.match` moved from the `squiggle` group (`assumed_derived_pending_probe`) to its
own `kali` group (`proven_independent`), and from `identity_only` to a fully declared 14-column
shape with `sourcedAt` as `source_updated_at` and a new `kali_2026` round vocabulary; a new
`kali_afl_stats.player_stats` family records the proven identity gap. The affected tests were
amended with it.
**S2 IMPLEMENTED 2026-08-28** (`AFLDB-ISSUE-096.md` §15, S2 section): migration
`074_source_observation_spine.sql` — `staging.source_payloads` (immutable, content-addressed,
storing the `hash_recipe` that produced each hash), `staging.source_record_versions` (ordered by
`version_seq`, valid-time intervals, one open version per key, and **deliberately no uniqueness on
`payload_hash`**, which is what keeps A→B→A three states), `staging.source_records`
(current head, `scope_key`, `absent_since`), plus `promotion_candidates` and the append-only
`promotion_decisions` ledger. Semantics live in `src/lib/acquisition/observations.ts`, which is
pure — no database, filesystem, network or clock. Acceptance re-reads everything and fails
closed in order: not-pending → verb-not-promotable → stale source version → stale
canonical baseline → season-not-in-progress → foreign ownership → manual authority,
where **`indeterminate` refuses exactly as `conflict` does** and the shipped provider always answers
`indeterminate` until ISSUE-086 lands. 28 DB-free tests.

**Grant defect caught and rejected before it landed:** the first draft made the decision ledger
append-only with `grant_import_write()` + `REVOKE UPDATE, DELETE`. `privileges.sql` regenerates the
whole write set from that registry, so the REVOKE would have been silently undone at the next
reconcile. Replaced by the `data_edits` (057) pattern — `afldb_auth` with `SELECT, INSERT`,
listed in the subtractive `afldb_auth` spec, plus a column-scoped workflow UPDATE on candidates.

**S2 IS COMPLETE AND GREEN — 61/61, 0 failures, 303 ms, on the final 2026-08-28 run.** Three runs
of `npm test -- tests/current-season-import.test.ts` that day. Run 1: **61 tests, 59 passed,
2 failed, test file FAILED (~308 ms)**. Every behavioural test passed —
A→B→A over two payloads, idempotence, absence/reappearance, all acceptance gates,
authority-indeterminate refusal, provider independence, witness-groups-are-reporting-only. The
two failures are **source-contract assertions that scan raw migration text** (`:653` append-only
grants, `:668` history uniqueness); both regexes use `[^;]*`, which is not a statement boundary
in SQL containing comments and `DO $$ … $$` blocks.

**Diagnosis CONFIRMED 2026-08-28 — both are false-positive tests, not defects.** `:653` matched
from the comment `-- grant_import_write() hands out UPDATE, DELETE and TRUNCATE, and` (migration
line 297, supplying a case-insensitive `GRANT` and the `UPDATE`) across eleven semicolon-free
lines of comment, `DO $$`, `BEGIN` and `IF EXISTS (…) THEN` to the legitimate
`GRANT SELECT, INSERT ON promotion_decisions` (line 308). `:668` matched from the
`-- DELIBERATELY NOT UNIQUE on (source_id, family, external_record_id,` header comment (line 61)
through `CREATE TABLE staging.source_record_versions (` (line 65) to the `payload_hash` column
(line 70) — a `CREATE TABLE` body has commas but no semicolon. The migration grants
`promotion_decisions` only `SELECT, INSERT` and holds no uniqueness rule mentioning `payload_hash`
on the history table. **Only the tests were repaired** (`tests/current-season-import.test.ts`: a
`sqlStatements()` helper strips `--` comments and splits on `;`; the ledger assertion now pins the
complete set of executable GRANTs on `promotion_decisions`, which also catches TRUNCATE/ALL, and
the history assertion pins the single `UNIQUE` statement on the versions table and proves it omits
`payload_hash`). The migration was not changed and no invariant was weakened. `AFLDB-ISSUE-096.md`
§16.3. **The user then reran the focused suite: 61/61, 1 test file PASSED, no failures.** The
repaired assertions are stricter than the ones they replaced and pass against an unchanged
migration — the outcome that separates a false-positive test from a real defect.

**Both source-file defects are now FIXED (2026-08-28), after the green rerun.**
`src/lib/acquisition/observations.ts` held **two literal NUL bytes** at line 499 in
`observationKey()`; they are now written as `U+0000` escapes. **The separator character is
unchanged, so keys are byte-identical and no runtime behaviour moved** — only the file's encoding,
which had made `file` report the source as `data` and `grep` skip it as binary. The handoff's
suggested repair to "a plain space" was assessed and **rejected**: it would change runtime
semantics and make the key ambiguous, since a space can occur inside a family or external record
id while U+0000 cannot. Live design question deferred to S3/S4, not an S2 defect: if this key is
ever persisted to a PostgreSQL `text` column the separator must change, because PostgreSQL cannot
store U+0000 in `text`; `observationKey()` currently has no caller outside its own module and the
focused suite. The stale header now reads "migration 074". `AFLDB-ISSUE-096.md` §16.4.

**Final post-hygiene run — 2026-08-28: `61/61`, 1 test file passed, 0 failures, 303 ms.** That run
covers the repaired assertions and the hygiene edits together and **closes the S2 checkpoint**. S1
remains approved and green (34/34). Migration **074 remains UNAPPLIED** *(true at this S2
checkpoint only; 074 was applied to `afldb_test` on 2026-08-28 — see **Resolution**)* — the focused suite is
DB-free and proves the semantics module plus the migration's source contract, not PostgreSQL
behaviour. **No CHANGELOG entry, correctly:** the runbook requires none at this checkpoint,
nothing user-visible has changed and no migration has run. *(At the time of writing, S3 had not
started; it has since been implemented and validated green — see the S3 record below.)*
ISSUE-100's blockers remain ISSUE-100's and are not absorbed here.

**Workflow note, recorded factually:** command execution belongs to the user (CLAUDE.md §9/§12),
but during the hygiene repair the assistant ran `sed -i`, `grep`, `wc`, `tr` and a short `node`
script over repository files to locate and remove the NUL bytes. No test, build, Git, SQL, SSH,
deployment or package-manager command was run, and every validation run stayed user-executed. One
`sed -i` edit was silently reverted when a later file-editing call wrote back a stale snapshot, so
byte counts were re-checked after each edit; `AFLDB-ISSUE-096.md` §16.7a.

**Observed, not investigated:** `src/db/migrations/073_data_overrides.sql` now exists and
`privileges.sql:294` references it as `AFLDB-ISSUE-086`'s. That is the authority mechanism
§7 depends on, so `UNAVAILABLE_MANUAL_AUTHORITY` may become replaceable — **only against
ISSUE-086's own confirmed contract**, never inferred from the migration. Not S2 work.

**S3 COMPLETE and GREEN 2026-08-28 — user-run `npm test -- tests/current-season-import.test.ts`:
1 test file passed, `84/84` tests passed, 0 failures, 316 ms.** New module
`src/lib/acquisition/reconciliation.ts` computes the reconciliation verb for one live source
record against the stored open observation. The vocabulary is exactly Decision C's ten verbs,
frozen in `RECONCILIATION_VERBS` with a runtime `assertReconciliationVerb` guard, and the decision
order is exported as `VERB_PRECEDENCE`: `stale_review` → `absent` → `unchanged` →
`unresolved_identity` → `foreign_owned_collision` → `source_disagreement` →
`manual_authority_conflict` → `new` / `rescheduled` / `corrected`. Two principles fix that order —
structural facts (stale evidence, an absent key, an unchanged payload) come before content, and a
refusal gate runs **only when a canonical write is actually proposed**, so an unchanged poll cannot
fill the review queue with refusals. `unchanged` is decided by `decideObservation` under the
family's hash contract alone; `rescheduled` requires schedule-only movement on an **unplayed**
record, so a score change can never be reported as a reschedule; `absent` reuses S2's enumerated
scope rule and returns `canonicalChange: 'none'`.

Ownership and authority are **extended, not redesigned**. `evaluateTargetOwnership` reads S2's
`evaluateOwnership` through three states and keeps a **declared** NULL owner (adoptable under
Decision E) distinct from an **unreadable** owner, which refuses as `foreign_owned_collision` with
detail `ownership_indeterminate` — a matching natural key never justifies adopting a row nobody can
attribute. Authority is asked as `{entity, opaque targetKey, changed fields}`, only where a
promotion would overwrite an existing canonical row (§7's invariant is about overwriting an active
human decision; a row that does not exist carries none), and **every non-`clear` answer refuses**,
`indeterminate` identically to `conflict`. `evaluateAcceptance` still asks unconditionally inside
the accept transaction, so a `new` candidate also cannot be written while authority is unavailable.
Corroboration counts **independence groups**, never source rows: a conflicting group blocks with
`source_disagreement`, a same-group proxy conflict is reported and can never raise the verb, and
agreement is recorded and authorises nothing. No force flag, no override, no consensus shortcut, no
write path — the module imports only `./observations` and `./source-families`.

**`history_only` — a settled S3 design outcome.** A changed source payload that advances
observation history but changes **none of the family's projected canonical fact fields** returns
`history_only`; Squiggle metadata such as completion moving `90 → 100` while no projected fact
changes is the retained example. It is **not** an eleventh reconciliation verb, is **not** permitted
in `RECONCILIATION_VERBS`, is **not** a promotion-candidate verb and is **not** a canonical change:
it is an observation-layer outcome meaning the source state changed and history must advance while
there is no fact-level proposal to review. It avoids both wrong alternatives — `unchanged` would
erase a genuine source-state transition, `corrected` would create a candidate proposing no changed
fields. The `84/84` green run validates the distinction. **Do not redesign it unless later S4
integration evidence contradicts it.**

**23 DB-free S3 tests** were added to `tests/current-season-import.test.ts` in five new describes,
against a stubbed authority provider, taking the focused suite to **84**. The user-run `84/84` pass
covers: the exact frozen verb vocabulary; runtime rejection of an unrecognised verb; `unchanged`;
`new`; `corrected`; `rescheduled`; the history-only observation; projected-field diffing;
A → B → A preserved through reconciliation; absence; the unenumerated-scope refusal; unresolved
identity; foreign **and** indeterminate ownership; ownership-before-authority ordering;
independence-group disagreement; provider agreement not substituting for authority; manual
authority conflict; unavailable/indeterminate authority; the opaque authority query shape; stale
review; no write/force/override/consensus path; no external side-effect dependencies; the mandatory
authority provider; and only candidate outcomes carrying proposals.

**Established S3 semantics, durable:** structural evidence is resolved before content
classification; refusal gates run only when a canonical change is actually proposed; `unchanged`
comes only from the family hash contract; `rescheduled` stays distinct from `corrected`; `absent` is
observation/review state only and never canonical deletion; unresolved identity guesses nothing;
`source_disagreement` requires disagreement between **independence groups**, not merely two source
rows; foreign or unreadable ownership fails closed **before** manual authority is asked; provider
agreement cannot substitute for manual authority; authority `conflict` and
indeterminate/unavailable authority both fail closed; stale review is distinct from source
correction; the module holds no database, network, filesystem, clock or write path; and no force,
override or consensus shortcut exists.

**Ownership states distinguished:** no canonical target → potentially `new`; matching source owner
→ source-owned; **declared** NULL owner per Decision E → adoptable under the approved rule; foreign
owner → `foreign_owned_collision`; owner undeterminable → fail closed as an
ownership-indeterminate collision. **A matching natural key alone never permits adoption of foreign
or indeterminate provenance.**

**S4 COMPLETE and GREEN 2026-08-28 — user-run
`npm test -- tests/current-season-import.test.ts`: 1 test file passed, `105/105`, 0 failures,
357 ms on the final post-hygiene run** (an earlier implementation run was also `105/105`). New pure
module
`src/lib/acquisition/promotion-review.ts` states the promotion-review contract: the
`promotion_candidates` record with migration 074's CHECK constraints enforced in TypeScript
(`assertCandidateShape`), the **baseline canonical hash**, the review item, the accept-time
recheck, the requeue/supersede rule and the decision drafts. It is pure — `node:crypto`,
`./observations`, `./reconciliation`, `./source-families` and nothing else.

**Baseline canonical hash — exactly the fields the promotion would write.**
`baselineCanonicalHash(fields, values)` hashes `sha256/v1(canonical-fields)` (S2's algorithm and
version, with **no** exclusion list) followed by the canonical JSON of **only the named fields**,
names sorted and object keys sorted at every depth. Field order and property order cannot change
it; a canonical column the promotion does not touch is never projected in and therefore **cannot**
stale a review; a field the promotion *would* write moving **does**; array order is content and is
not normalised; the digest is 64 hex characters, matching `baseline_canonical_hash char(64)`. It is
**null** exactly where there is no target row — the `new` case `promotion_candidates_target_ck`
describes — and a named field missing from the re-read **refuses**, because an absent key and a
NULL value are different facts.

**One additive change to `observations.ts`, behaviour-preserving:** the canonicaliser inside
`canonicalisePayload` was hoisted and re-exported as `canonicalJson(value)`; `canonicalisePayload`
now delegates to it with the family's exclusion list and produces byte-identical output. Reusing
`canonicalisePayload` directly would have been **wrong**, not merely inelegant: `hash_exclusions`
are declared against *source payload* columns, so applying them to canonical AFLDB values would
silently drop a canonical column sharing a name (`data_accessed` is the live example).

**Render and accept ask the same question.** `runPromotionGates` recomputes the baseline from
freshly re-read canonical values and then delegates to **S2's `evaluateAcceptance`**, so the review
screen can never offer an accept the transaction would refuse, and S2's gate order is unchanged and
authoritative: `not_pending` → `verb_not_promotable` → `stale_review` (source version moved) →
`stale_canonical_target` (baseline moved) → `season_not_in_progress` → `foreign_owned_collision` →
manual authority. Every gate fails closed, so ordering decides only which true reason is reported
first. Ownership runs through S3's three-state `evaluateTargetOwnership`, so an **unreadable** owner
refuses with detail `ownership_indeterminate` while S2's ordering is preserved.

**Requeue and supersede are not interchangeable.** `stale_canonical_target` means the reviewed
evidence is still the open version and only the baseline moved ⇒ **re-render in place**, candidate
stays `pending`. `stale_review` means the source moved on ⇒ **supersede**, so reconciliation can
insert the replacement — which `ux_promotion_candidates_pending` requires anyway. Authority
conflict/indeterminate ⇒ re-render in place, queued for review exactly as §7 says.

**§7's implementation gate is intact by construction.** `PromotionDecisionDraft` has **no
`'accept'` decision member** and typed-`null` value columns, so S4 cannot represent an acceptance;
a cleared evaluation returns `{ verdict: 'gates_cleared', canonicalChange: 'none', write: {
implemented: false, blockedBy: 'canonical_write_unimplemented' }, decision: null }`. Under the
shipped `UNAVAILABLE_MANUAL_AUTHORITY` that branch is unreachable — every promotable verb, `new`
included, refuses. The authority question stays `{entity, opaque targetKey, touched fields}`; the
surrogate `target_id` never appears in it and the module never names `data_overrides`. Two agreeing
independence groups authorise nothing (§15.3). **Blocked pending ISSUE-086:** the production
canonical acceptance transaction — the write, its provenance quartet and the `accept` decision row
carrying real `previous_values`/`new_values` — for `corrected`/`rescheduled` candidates onto an
existing canonical row.

**Reject semantics.** A rejection writes the decision row and nothing else: `decision: 'reject'`,
no refusal reason, both value columns null, `canonicalChange: 'none'`, and the candidate transition
`{status: 'rejected', setsResolution: true}` — `promotion_candidates`'s
`(status = 'pending') = (resolved_at IS NULL) = (resolved_decision_id IS NULL)` rule is asserted in
code rather than left to the INSERT. The draft carries no payload, version, absence or target
field, so a reject cannot drift into a source or canonical deletion. `RECORDABLE_REFUSALS` is
exactly the intersection of S2's `RefusalReason` and `promotion_decisions_reason_ck`:
`not_pending` and `verb_not_promotable` are absent by design and produce **no** ledger row rather
than one with an invented reason, and `season_not_in_progress` is recordable but does not requeue.

**20 DB-free S4 tests** were added to `tests/current-season-import.test.ts` in four new describes:
baseline coverage/determinism/ordering-independence/null-and-refusal cases; the review item's
evidence built from a real S3 outcome; unrelated-field change staying current; both stale paths and
their distinct requeue actions; not-pending, unpromotable-verb, foreign and indeterminate
ownership, authority conflict, authority unavailable, provider agreement not satisfying authority,
and season-not-owned refusals; the opaque authority query; no acceptance result under the shipped
provider; no force/override/bypass/consensus export and no external imports; rejection implying no
canonical change; the requeue/supersede transition rule; and the candidate shape against 074's
CHECK lists, read statement-aware rather than by raw-text regex.

**Not done in S4 (correctly):** no canonical write or promotion transaction; no admin route,
component or React code; no migration and no change to 074; no change to `current-season-import.ts`,
`staging.external_current_matches` or `reconciliation.ts`; no family importer; no ISSUE-086
implementation and no worktree access; no CHANGELOG entry.

**NUL-byte hygiene — RESOLVED 2026-08-28 (`AFLDB-ISSUE-096.md` §16.11).** Two source files carried
the same artefact: a raw `0x00` written where the intended runtime value is U+0000.
`src/lib/acquisition/observations.ts` was repaired earlier (§16.4). `source-families.ts` carried it
in `parseSourceFamilyRegistry`'s duplicate-declaration **machine key** — deliberately unlike the
human-readable `/` used by `label` on the line above. The assistant located it and wrote the
explanatory comment but **could not perform the byte-level repair**, because it cannot emit a raw
U+0000 reproducibly and its reader renders a NUL and a space identically; it stopped and asked for
evidence rather than guessing. **The user then verified and repaired it:** `git diff … | cat -A`
showed the separator as `^@` (a genuine raw NUL, and proof the assistant's comment edit had **not**
turned it into a space); the user replaced the single `0x00` with the six-character source escape;
`grep -naP '\x00' src/lib/acquisition/source-families.ts` afterwards returned **no matches**; and the
final suite stayed green at `105/105`. **Runtime semantics did not change** — the escape still
evaluates to U+0000, so the collision-resistant in-memory separator is byte-identical and only the
source stopped being binary to `file`, `grep` and diff tools. Both source files are now confirmed
NUL-free. **Forward concern retained, not redesigned:** PostgreSQL `text` cannot store U+0000;
neither `observationKey()` nor `identity` is persisted today, and if a later stage proposes
persisting one of these composite machine keys, that is where it must be addressed.

### Validation
Evidence validation: P1–P7 executed 2026-08-28 read-only; P1/P2 re-run the same day with the
supplied key, still read-only — no production access, no canonical write, no schema change,
no Git operation, and the key was never printed or persisted.

**Code validation, all user-run, all DB-free:**

- **S1 — `npm test -- tests/reference-data.test.ts`: GREEN.** `33/33` before the P1/P2 amendment,
  then **`34/34`** on the post-amendment run. S1 is approved and green.
- **S2 — `npm test -- tests/current-season-import.test.ts`: `61/61`, 0 failures** on the final
  post-hygiene run (first run `59/61`; the two red assertions were confirmed false positives and
  the **tests** were repaired, not the migration).
- **S3 — `npm test -- tests/current-season-import.test.ts`: `84/84`, 1 test file passed, 0
  failures, 316 ms.** S3 is complete and green.
- **S4 — `npm test -- tests/current-season-import.test.ts`: `105/105`, 1 test file passed, 0
  failures, `357 ms` on the final post-hygiene run.** **S4 is complete and green.** The 105 tests
  establish: the review item carries the approved candidate evidence; the baseline hash covers
  **exactly** the proposed/touched fields; it is deterministic and ordering-independent; an
  unrelated canonical change does **not** stale a review and a proposed-field change **does**; moved
  source evidence and a moved canonical baseline keep their **distinct** stale outcomes; every
  acceptance gate re-runs fail-closed; provider agreement never substitutes for authority; foreign
  **and unreadable** ownership refuse; authority conflict and indeterminate/unavailable authority
  refuse; season ownership is enforced; a rejection mutates no canonical fact and no observation;
  and no force/override/bypass/consensus path exists. The canonical acceptance/write transaction
  remains **deliberately unimplemented** behind ISSUE-086's authority gate.

These suites are DB-free by design: they prove the reference-data contract, the semantics modules
and the migration's **source** contract — not PostgreSQL behaviour. *(Superseded 2026-08-28. This
paragraph previously ended "**Migration 074 is UNAPPLIED**, so nothing in ISSUE-096 is
database-validated". That was true only at the S1–S4 checkpoint. Migration **074 is applied** to
`afldb_test` — 074 before 075 — and the PostgreSQL validation recorded under **Resolution** below is
**complete**. All database work was and remains `afldb_test` only, never `afldb_dev`, never
production.)*

### Follow-up
Retry **P1/P2** when a `KALI_AFL_API_KEY` is available, and **P7** when interactive SSH/database
access is available (exact commands in `AFLDB-2026-API-ACQUISITION.md` §13.7). Neither blocks the
contract.

### Resolution

**RESOLVED 2026-08-28 — complete within the authorised S1–S4 scope.** §11 decomposes this issue to
S1–S4 and stops; §14's approval authorised implementation through those four stages only. All four
are implemented and green, migration 074 is applied to `afldb_test` and validated against the real
catalogue, and §5.H is validated to the full extent the implemented code permits.

**Final validated evidence, all user-run 2026-08-28:**

| Evidence | Result |
|---|---|
| `tests/current-season-import.test.ts` (DB-free contract, S1–S4 + the 074 FK source contract) | **106/106** |
| `tests/integration/observation-spine.test.ts` (§5.H schema half) | **13/13** |
| `tests/integration/fk-indexes.test.ts` (real FK catalogue gate) | **2/2** |
| `tests/integration/privileges.test.ts` (append-only ledger grant) | **24/24** |
| Migrations | **75/75 applied, 0 pending**, **074 applied before 075** |
| Privileges | reconciled successfully |
| Fingerprint | `c5afad8cd3e6ff6417e429807bd7dfb4f8da096a84d691e63383691438722227` |
| Close-out re-validation, same four suites in one run (2026-08-28) | **4 test files passed / 4; 145 tests passed / 145**, and `npm run db:migrate:test -- --status` re-confirmed **75 files, 75 applied, 0 pending**, no checksum-drift refusal, ledger order `073 → 074 → 075` |

**Root cause addressed.** AFLDB had no standing contract for acquiring a current or future season,
so each new data family would have repeated the shipped path's choices. S1–S4 deliver that
contract: a tracked source-family registry with a fail-closed typed parser; a three-grain
observation spine that holds idempotence and correction history simultaneously; a reconciliation
verb set with an ownership predicate and a fail-closed authority interface; and a reviewed
promotion contract whose refusals are unrepresentable rather than merely discouraged.

**What remains is NOT unfinished ISSUE-096-owned S1–S4 work.** The three PARTIALLY EXECUTABLE and
three BLOCKED §5.H rows fall into exactly two categories, and neither is an outstanding acceptance
condition of this issue:

1. **Consequences that cannot be exercised without a future persistence or accept path.** The
   unproved halves of idempotence (a production import re-run), foreign ownership (the predicate's
   DB path) and the stale-review race (the render-to-accept window) have **no code to exercise**,
   because `src/lib/acquisition/` deliberately contains no persistence layer and the canonical
   acceptance/write transaction is outside S1–S4 by approval, gated on `AFLDB-ISSUE-086`. Their
   schema consequences are proven; the runtime halves await a stage that has not been approved.
2. **Separately owned downstream capabilities.** Manual authority belongs to `AFLDB-ISSUE-086`;
   the `data_issues` disagreement row was never implemented in S1–S4 and building it would absorb
   `AFLDB-ISSUE-097`/`AFLDB-ISSUE-099`; rollover supersession belongs to `AFLDB-ISSUE-101`, which
   also owns the missing observation-grain supersession model 074 deliberately does not provide.

No partial row is recorded as a full pass, no blocked row was made green, and no fabricated SQL or
stubbed provider stands in for a capability that does not exist. **Migration 074 is applied and
checksum-frozen: it must not be edited again; a further change is a new migration.**

### Validation record

**PostgreSQL validation phase RESUMED 2026-08-28 — schema/migration gate GREEN
(`AFLDB-ISSUE-096.md` §16.16).** The migration-073 baseline blocker is **closed**: `AFLDB-ISSUE-086`
rebuilt `afldb_test` cleanly through the committed `073_data_overrides.sql`, the §16.14 three-index
repair was authored into 074 **before** its first application, and both pending migrations were then
applied in normal filename order — **074 then 075**, `Applied 2 migration(s).` Post-apply status is
**75 migration file(s), 75 already applied, 0 pending, no drift**; privilege reconciliation
completed; `tests/integration/fk-indexes.test.ts` is **2/2**, which is the real-catalogue proof of
ISSUE-096's three 074 indexes and `AFLDB-ISSUE-086`'s `data_overrides.admin_user_id` index at once.
Post-migration fingerprint
**`c5afad8cd3e6ff6417e429807bd7dfb4f8da096a84d691e63383691438722227`** (`afldb_test`/`afldb_owner`;
schemas 5, relations 143, routines 44, types 210, extensions 3;
`migrations: present|75|075_data_overrides_fk_index.sql`).

**The governing constraint is unchanged: `src/lib/acquisition/` still has no persistence layer.**
Applying 074 created tables, not a writer for them, so every §5.H row whose subject is an import
re-run or the accept transaction still has no production code to exercise, and none was written.
New suite `tests/integration/observation-spine.test.ts` drives the real `decideObservation` /
`sweepAbsences` and applies each decision to `afldb_test` with the SQL a persistence layer would
issue, reading each successive head **back out of PostgreSQL**; it proves the **schema half** of
§5.H and claims nothing about a production persistence path. Refreshed classification —
**two fully executable** (correction replay A→B→A; absence ≠ deletion), **three partially
executable** (idempotence; foreign ownership; stale-review race), **three still BLOCKED**
(manual authority — ISSUE-086; `data_issues` disagreement row — never implemented; rollover
supersession — ISSUE-101, and 074 has no supersession column on any grain). Full row-by-row matrix
with what each row does and does not prove: §16.16. **No canonical acceptance/write path exists or
was added**, and no blocked row was made green by fabricated SQL.

**VALIDATION GREEN, user-run 2026-08-28: `tests/current-season-import.test.ts` 106/106,
`tests/integration/fk-indexes.test.ts` 2/2, `tests/integration/observation-spine.test.ts` 13/13.**
The FK gate is the real-catalogue validation of the §16.14 source-contract FK repair in 074 and of
`AFLDB-ISSUE-086`'s 075 index together. The first spine run exposed one **fixture** defect — the
seed wrote `seasons.is_complete`, generated from `status` since migration 015 — which aborted ten
cases in shared setup **before their bodies ran**; the seed now writes
`status = 'in_progress'::season_status`, **no behavioural assertion changed**, and the rerun passed
13/13. **13/13 proves the implemented PostgreSQL/schema half of §5.H only** — not an importer and
not a canonical accept transaction, neither of which exists. The three partial rows remain partial:
their schema consequences passing is precisely what "partial" claimed, and the unproved halves have
no code to exercise. The three blocked rows remain blocked, with no test at all.

**The last ISSUE-096-owned validation gap is CLOSED — `tests/integration/privileges.test.ts`
24/24 passed, user-run 2026-08-28.** 074's append-only-by-grant invariant on `promotion_decisions`
had no catalogue test; coverage was added to that file's **existing** append-only contract — the
table added to the positive grant list (`SELECT`, `INSERT`) and to the array asserting `afldb_auth`
holds no `UPDATE`, `DELETE` or `TRUNCATE` — with **no change to `tools/maintenance/privileges.sql`**,
which already specified `['promotion_decisions', 'SELECT, INSERT']` correctly. The invariant the
migration's own comment warns about — a reconcile silently restoring UPDATE/DELETE/TRUNCATE over
the ledger through `grant_import_write()`'s registry — is now machine-enforced.

**Retained halt record — PostgreSQL validation phase HALTED AT PREFLIGHT 2026-08-28, blocked at the
time by migration-073 checksum drift (`AFLDB-ISSUE-096.md` §16.13).** The separately authorised phase (apply 074 to `afldb_test`,
run the §5.H integration tests) stopped at its first command:
`npx tsx tools/db/migrate.ts --status --target test` proved the target is `afldb_test` with 73 of
74 migrations applied, then **refused** because applied migration `073_data_overrides.sql`
(`AFLDB-ISSUE-086`'s) no longer matches its recorded checksum. **074 was NOT applied and NOT
modified; no database was written to; S1–S4 remain green.**

First wrong layer: **ISSUE-086's change management for 073**, not the runner, not line endings and
not ISSUE-096. Line-ending drift is eliminated — `matchesStoredChecksum` accepts raw/LF/CRLF
representations (ISSUE-091) — and algorithm drift is eliminated by the 72 rows that validated in
the same pass. Git shows **exactly one committed revision of 073 has ever existed** (blob
`a8ad3079…`, identical in `2a068a8` on `dev` and `e0d64aa` on `agy/issue-086-port`, both dated
2026-08-28 02:56:29 +1000), the worktree is clean, and there are no stashes — so **no committed
revision can match what `afldb_test` recorded** and the applied artefact is an uncommitted
intermediate state. **`dev` contains no invalid mutation of an applied migration**: the blob was
never rewritten after being committed, so no history surgery is needed and the incoherence is
between the **database ledger** and the sole committed revision.

**CONFIRMED by the ledger, user-run read-only 2026-08-28.** Stored checksum for 073 in `afldb_test`
is `47937827404c5d7ae0b46b08e7a077219b55196979922ba271d1ca57bc420d93`; the committed revision's
canonical-LF sha256 is `778c5bfb7964263127c7e2a061eb2745548452bfe8bba4dd94ebbc03dca93bc9`; the
database applied 073 at **`2026-08-28 01:54:41.063665+10`**, which is **1 h 1 min 48 s BEFORE** the
sole committed revision existed (`2026-08-28 02:56:29+10`). The control row
`072_dob_conflict_ownership.sql` (applied `2026-08-27 22:02:21.991501+10`) validates cleanly under
the same algorithm. `afldb_test` was therefore migrated with an **uncommitted intermediate version**
of 073 that was changed again before the final file was committed; the applied artefact is not
recoverable from this repository.

**Repair-model correction:** a later corrective migration **cannot by itself** fix this —
`migrate.ts` validates already-applied checksums *before* running anything, so a 075 would never
execute and the run would halt on 073 first. **The baseline must be made coherent first.** Choosing
and executing the mechanism is **`AFLDB-ISSUE-086`'s**, weighing the test-data/rebuild consequences
(the avenue to investigate there is rebuilding `afldb_test` from a coherent checkpoint ending at
the committed 073). ISSUE-096 must not repair 073, must not touch `afldb_meta.schema_migrations`,
must not bypass checksum validation, must not rebuild `afldb_test` **from this worktree** (it
carries pending 074, which a rebuild would sweep in before its §16.14 FK indexes exist), must not
apply 074, must not perform the §16.14 three-index repair yet, and must not access ISSUE-086's
worktrees. **S1–S4 remain green (34/34, 61/61, 84/84, 105/105) and migration 074 has NOT failed —
it was never executed.**

**None inside ISSUE-096 as approved — all four authorised stages are complete.** §11's
decomposition is S1–S4 and stops there, and §14's approval authorised implementation "through
stages S1–S4" only, so **there is no approved S5**: any next stage is a fresh approval decision,
not a continuation (`AFLDB-ISSUE-096.md` §16.12). The three unbuilt pieces and their blockers:

1. **The canonical acceptance/write transaction** (write + provenance quartet + real `accept`
   decision row) — **BLOCKED on `AFLDB-ISSUE-086`** by §7's implementation gate. Replacing
   `UNAVAILABLE_MANUAL_AUTHORITY` is permitted only against ISSUE-086's own confirmed contract,
   never inferred from `073_data_overrides.sql`, whose worktrees stay off limits.
2. **Applying migration 074 and the §5.H PostgreSQL integration tests** — **DONE for the schema
   half.** 074 and 075 are applied to **`afldb_test` only** (never `afldb_dev`, never production),
   `75/75`, `0 pending`, privileges reconciled, FK gate `2/2`. Both held findings are settled:
   074's **three uncovered foreign keys** were indexed in 074 itself before application (§16.14)
   and the catalogue now confirms it; and the refreshed §5.H matrix (§16.16, which supersedes
   §16.15) still classifies three of the eight assertions as **BLOCKED** — manual authority (ISSUE-086), the `data_issues` disagreement
   row (never implemented in S1–S4), and rollover supersession (ISSUE-101, and with no supersession
   column in 074).
3. **The admin review screen** — an explicit §2 **non-goal** of ISSUE-096. S4 delivered the domain
   contract it would render; building the route and components is not this issue's approved work.

**Checkpoint 2026-08-28:** S1 approved and green `34/34`; S2 complete and green `61/61`; S3
complete and green `84/84`; **S4 complete and green `105/105`**; the **canonical acceptance/write
transaction remains deliberately unimplemented** behind ISSUE-086's authority gate — and the S4
type/state model must **not** be read as evidence that those writes exist, since
`PromotionDecisionDraft` cannot represent an acceptance and a fully cleared gate still reports the
canonical write as unimplemented; `history_only` remains settled as an observation-layer outcome
only; the DB-free suite now stands at **`106/106`** with the 074 source-contract FK-index assertion
added; migration **074 APPLIED to `afldb_test` only** (2026-08-28, **074 before 075**, `75/75`,
`0 pending`, privileges reconciled, FK gate `2/2`, fingerprint
`c5afad8cd3e6ff6417e429807bd7dfb4f8da096a84d691e63383691438722227`) with no production or
`afldb_dev` work at any point; the §5.H PostgreSQL spine suite
`tests/integration/observation-spine.test.ts` is **`13/13`**, proving the implemented schema half of
§5.H and nothing beyond it; the `source-families.ts` NUL hygiene item **RESOLVED**; **S5 not
started**; `AFLDB-ISSUE-100` remains separate and does **not** block it. **No CHANGELOG entry at
that checkpoint** — nothing had landed then. *(Superseded at resolution, 2026-08-28: migration 074
has since been applied and the issue is Resolved, so a single `CHANGELOG.md` entry was added under
`[Unreleased]`, following the `AFLDB-ISSUE-073` precedent for a resolved schema-migration issue with
no user-visible behaviour.)*

**S4 prerequisites/stop conditions already recorded:** §7's implementation gate — `corrected`/update
promotion onto existing rows cannot be implemented until ISSUE-086's authority contract lands, and
`UNAVAILABLE_MANUAL_AUTHORITY` enforces that by construction; §16.5 — `073_data_overrides.sql` is
ISSUE-086's, verify against its own confirmed contract and do not access its worktrees; approval 3
and §15.3 — no automatic canonical promotion, and separate independence groups are not evidence for
one; migration **074 is applied to `afldb_test` only** and any PostgreSQL validation stays
`afldb_test` only, never `afldb_dev`, never production; §16.8's invariants stand; no family importer, no ISSUE-095
`club_seasons` work, no change to `current-season-import.ts` or
`staging.external_current_matches`.

**Superseded next actions (2026-08-28, both completed):** the S2 forensics — confirm what the two
`[^;]*` regexes matched, repair the **tests** not the migration, then fix the two §16.4
`observations.ts` defects (done; post-hygiene rerun `61/61`); and the S3 validation run (done;
`84/84`).

Migration **074** is **APPLIED** to `afldb_test` (2026-08-28, **074 before 075**) and is now
**checksum-frozen — it must not be edited**; any further change to the spine is a new migration. All
database work was `afldb_test` only, never `afldb_dev`, never production. Retained follow-ups owned
elsewhere: an `afl_api` `sources` row and the 20th AFL API lineup column, both
`AFLDB-ISSUE-100`'s; **P7 remains BLOCKED**.

**Superseded next action (2026-08-28):** "HALT for user review — approve or amend decisions A–H
and the six unresolved items in §12." That approval was given; see §14 of the runbook.

## AFLDB-ISSUE-097 — Squiggle/Kali source independence: `/v1/fixture` is a verbatim Squiggle proxy

- **Status:** Resolved
- **Severity:** Medium
- **Area:** Data acquisition / Data integrity
- **Found:** 2026-08-28 (2026+ API acquisition investigation, live probe)
- **Resolved:** 2026-08-28
- **Runbook:** `AFLDB-2026-API-ACQUISITION.md` §2.1 and §9 row B.
- **Files:** `src/lib/external-afl/current-matches.ts`,
  `src/lib/external-afl/current-season-import.ts` (`sourceDisagreements`)
- **Related:** `AFLDB-ISSUE-096` (architecture rule 9, compare before promoting)

### Problem
Proven by live probe on 2026-08-28: `GET https://kaliaflstats.com/api/afl/v1/fixture` returns
Squiggle's `games` schema carrying Squiggle's own game ids and `updated` timestamps — id
`38494`, Sydney 132 v Carlton 69, Opening Round, `complete` 100,
`updated "2026-03-05 22:16:49"` — byte-for-byte the same values Squiggle's own
`?q=games&year=2026&round=0` returns. For the fixture/score family the two configured sources
are therefore **not independent witnesses**, so `sourceDisagreements` and `--source all` can
report self-agreement as corroboration.

### Established vs unknown — **updated 2026-08-28, P1 has now run**
- **Established:** the proxying, for Kali `/v1/fixture`.
- **Established (P1, re-run once `KALI_AFL_API_KEY` was supplied): `/matches` is NOT a proxy.**
  Five independent proofs, in `AFLDB-2026-API-ACQUISITION.md` §13.1 — (a) a genuine value
  disagreement on a completed match: Essendon v Port Adelaide 2026-08-23, Kali **95–105** vs
  Squiggle **95–104** with Squiggle `complete = 100`; (b) `crowd` populated on 80 of 204 rows
  where Squiggle publishes no attendance field at all; (c) disjoint id spaces, 11405–11611 vs
  38494–38729, **0 shared**; (d) a different venue vocabulary on 80 of 160 jointly observed
  games (`Marvel Stadium`/`Docklands`, `GMHBA Stadium`/`Kardinia Park`); (e) no goals/behinds,
  which Squiggle carries. Kali's `sourcedAt` is a stored per-record timestamp, measured stable
  across a repeat fetch.
- **Consequence:** the same two sources are **one** witness for fixtures and **two** for matches,
  so corroboration must be counted **per family**. `AFLDB-ISSUE-096`'s registry
  (`data/reference/source-families.json`) already encodes both, so consume it rather than
  re-deriving independence here.
- **STILL UNKNOWN — do not overstate P1:** it disproves **pairwise** derivation, not a
  **common ultimate upstream** (both could read AFL.com.au). Two groups here are weaker than two
  fully independent witnesses, so a disagreement stays a **review** signal and must never
  auto-resolve.
- **P2, same run:** Kali projects **no player id** on the stat grain (`matchId`, `playerName`,
  `teamId` only), so it cannot corroborate at player grain at all, whatever the match-grain
  result. Recorded under `AFLDB-ISSUE-096` §15.2.

### Scope
Track the proven `/fixture` proxying as a corroboration risk; **P1 has now settled the
`/matches` half — Kali IS a second match witness**; rewrite `sourceDisagreements` and
`--source all` to count **independence groups** rather than source rows.

### Root cause
`current-season-import.ts` predated ISSUE-096's source-family registry. Dry-run always returned
`sourceDisagreements: 0`; apply-mode update candidates were compared sequentially as concrete
source rows, and missing-match inserts selected `candidates[0]` without any disagreement check.
Nothing resolved each observation's `(source_key, family)` contract or collapsed observations by
`independence.group`, so endpoint aliases could manufacture apparent corroboration and the result
depended on concrete row count/processing order rather than independent evidence groups. The first
group-aware implementation still compared raw concrete observations pairwise across groups, so an
internally conflicted proxy group could also fabricate a cross-group disagreement when another
group matched one of its concrete rows.

### Fix
The current-season comparison path now parses and consumes
`data/reference/source-families.json`. It retains every concrete observation and per-source count,
but derives witness counts, agreement, cross-group disagreement and within-group proxy drift from
the registry's family contracts. Each group is first merged to one coherent score value; a group
with internal conflict exposes no value to cross-group comparison. Only coherent group values can
agree or disagree. Dry-run and apply mode use the same grouped candidate analysis;
both resolved-match updates and missing-match insert planning refuse conflicting evidence.
`--source all` reports concrete-source counts plus independence-group observation counts, while a
separate within-group conflict counter keeps proxy drift visible without calling it independent
disagreement. Canonical and staging provenance continue to use the concrete source key and
external record id.

### Dependencies and gates
Depends on nothing. **The P1 gate is CLEARED (2026-08-28).** The implementation consumes
`AFLDB-ISSUE-096`'s independence-group semantics and its registry; it does not redefine them.

### Validation
Resolved implementation validation, deterministic and DB-free, 2026-08-28:

- `npm test -- tests/current-season-import.test.ts -t "AFLDB-ISSUE-097 current-season independence-group corroboration"`
  — **PASS, 9/9** (107 intentionally filtered/skipped), including the internally conflicted
  Squiggle group plus matching coherent Kali counterexample.
- `npm test -- tests/current-season-import.test.ts` — **PASS, 116/116**. Nine focused
  ISSUE-097 cases prove fixture proxy = one group, authenticated Kali match = a second group,
  duplicates cannot manufacture corroboration or outvote another group, independent disagreement
  remains visible, source/group counters reconcile, single-source behaviour is unchanged, and
  concrete provenance survives grouping.
- `npm test -- tests/reference-data.test.ts -t "counts Squiggle and Kali as TWO match witnesses now that P1 has run"`
  — **PASS, 1/1** (33 intentionally filtered/skipped).
- Changed-file ESLint — **PASS with 0 errors**; two pre-existing unused-variable warnings remain
  in unchanged test lines.
- `git diff --check` — **PASS**; only the existing Windows LF-to-CRLF working-copy warnings were
  emitted.
- Full `npm run typecheck` is **not globally green** because of unrelated existing DraftGuru and
  observation-spine test typing errors; it reported no error in an ISSUE-097-changed file.
- The full `tests/reference-data.test.ts` run is **not globally green**: 31 passed, 2 skipped and
  one unrelated stale expected-table-list assertion failed because it omits migrations 074/075's
  `promotion_decisions` and `data_overrides`. The focused independence contract passes.

No live API call, database connection, staging write or canonical write was used for this fix.

### Exact next action
None inside ISSUE-097. Continue with `AFLDB-ISSUE-098` as a separate scope; do not absorb its
current-season staging, insertion or counter defects here.

### Follow-up
The standing evidence limit remains: two provider/pipeline groups may still share an ultimate
upstream, so agreement is reporting evidence and never automatic authority. ISSUE-096's review
gate remains unchanged. The superseded `/matches`-is-a-proxy branch stays closed.

## AFLDB-ISSUE-098 — Shipped current-season importer defects

- **Status:** Resolved
- **Severity:** Medium
- **Area:** Data integrity / Import
- **Found:** 2026-08-28 (2026+ API acquisition investigation, source-verified)
- **Resolved:** 2026-08-28
- **Runbook:** `AFLDB-2026-API-ACQUISITION.md` §1.1 and §9 row C.
- **Files:** `src/lib/external-afl/current-season-import.ts`,
  `tests/current-season-import.test.ts`, `tools/current-season/update-current-season.ts`,
  `src/app/admin/current-season/actions.ts`,
  `src/app/admin/current-season/CurrentSeasonControls.tsx`
- **Related:** `AFLDB-ISSUE-086` — the unrestricted canonical score overwrite at
  `current-season-import.ts:567-590` is **that issue's behaviour class, referenced here and
  deliberately not duplicated**. ISSUE-086 retains ownership and its severity triage.

### Problem
Four defects proven by reading the shipped importer:

1. **Fabricated venue.** `:619` inserts `venue_raw = ${match.venueRaw ?? 'Unknown'}`.
   `matches.venue_raw` is NOT NULL and `venue_id` is left NULL, so a promoted row can carry the
   literal string `Unknown` permanently.
2. **Half-matches.** The same INSERT (`:607-629`) writes `attendance = NULL,
   attendance_status = 'not_collected'` and never writes `match_period_scores` or
   `player_match_stats` — canonical matches with no quarter scores, no attendance and no player
   participation.
3. **Correction indistinguishable from deletion.** The staging write is
   `ON CONFLICT … DO UPDATE` (`:420-439`), so a retrospectively changed payload silently
   replaces the previous one. `last_seen_at` is written but never read, so a disappeared fixture
   looks identical to an unrefreshed one.
4. **Incoherent counters.** `unresolved -= candidates.length` (`:633`) has no floor and can go
   negative; `records_inserted = staged + inserted` (`:657`) sums staging rows and canonical
   rows under one name — the reporting incoherence recorded in
   `.agents/skills/afldb-api-data-debug/SKILL.md`.

Also recorded, not yet a defect: the Opening Round heuristic at `:219-225` appends
`roundNumber + 1` for `season >= 2024`, embedding a source-numbering guess in the resolver.

### Scope
Independently actionable containment of the four defects above. **Kept separate from
`AFLDB-ISSUE-096` and not folded into it.**

### Dependencies and gates
Depends on nothing — **not dependent on `AFLDB-ISSUE-096` or `AFLDB-ISSUE-097`**. Evidence
probe **P7** is recommended to size the live impact but is not required to start.

### Root cause
1. The canonical insert coerced nullable source venue evidence to the literal `Unknown` because
   `matches.venue_raw` is non-nullable, rather than refusing a canonical row the source family
   could not authoritatively complete.
2. The same insert treated the current API score/fixture projection as ownership of the complete
   canonical match family even though the registered Squiggle/Kali match families are
   non-promotable and do not supply attendance, period scores or played participation/statistics.
3. The legacy `staging.external_current_matches` current-state projection was incorrectly serving
   as observation history, so its upsert destroyed the previous payload and had no explicit
   absence state despite migration 074 already providing the required append-only spine.
4. One mutable counter represented both source observations and canonical rows; successful
   dual-source insertion subtracted observation cardinality from canonical unresolved work, and
   the batch ledger summed staging and canonical inserts.

### Fix
- Source venue absence remains `null` through normalisation, the mutable staging projection and
  canonical planning; no `Unknown` fallback or canonical match INSERT remains.
  - Missing completed matches are reported as unresolved. ISSUE-097's group-aware comparator first
    classifies incoherent evidence as `same_group_conflict` or `source_disagreement`; coherent
    evidence—including two agreeing independent match witnesses—still cannot authorize promotion
    and is deterministically rejected as `incomplete_source_family`. This does not add lineup,
    player-stat, period-score or attendance acquisition and does not touch ISSUE-086's existing-row
    score-update authority.
- Every applied observation now passes through migration 074's existing spine before the legacy
  projection is refreshed: immutable payloads are hash-deduplicated, changed content appends and
  closes ordered versions, the current head identifies the newest correction, and a complete
  non-empty season fetch marks omitted keys with `absent_since` without deleting any payload,
  version, projection or canonical row. Reappearance clears absence under the existing contract.
- Results, CLI/admin reporting and `import_batches.validation_result` now distinguish observations
  fetched/staged, observation versions inserted, observations marked absent, unique canonical
  matches resolved, canonical rows inserted/updated, unresolved observations, incomplete source
  records and rejected/conflicted work. Batch insert/update counters describe observation-spine
  operations only; canonical counters never decrement.
- No migration or privilege change was required; migration 074 already represented the required
  history and absence semantics.

### Validation
  - Focused ISSUE-098 deterministic slice after the ISSUE-097 rebase: **13/13 passed**
    (110 unrelated tests skipped), including coherent independent agreement that remains
    insufficient for canonical promotion and a separately classified same-group conflict.
  - `npm test -- tests/current-season-import.test.ts`: **123/123 passed** (one complete deterministic
    importer suite combining both ISSUE-097 and ISSUE-098 coverage).
  - Focused ISSUE-097 corroboration slice: **9/9 passed** (114 unrelated tests skipped), including
    per-family independence groups, concrete provenance/counters, coherent independent disagreement,
    proxy drift and the conflicted-group counterexample.
- Changed-file ESLint: **0 errors, 0 warnings** across the importer, test, CLI and admin callers.
- `git diff --check`: **passed** (exit 0; only the checkout's expected LF-to-CRLF notices).
- `npm run typecheck`: repository-wide check reached TypeScript and reported **9 pre-existing,
  unrelated test errors** in `tests/draftguru-acquisition.test.ts`,
  `tests/integration/draftguru-import.test.ts` and
  `tests/integration/observation-spine.test.ts`; no changed ISSUE-098 file appeared in diagnostics.
- No live API call, database write, current-season apply, canonical insert/update, migration or
  destructive SQL was used for validation.

### Follow-up
None. P7 remains optional impact sizing and is not required for this deterministic containment.

## AFLDB-ISSUE-099 — In-season AFL Tables settle stage

- **Status:** Resolved
- **Severity:** Medium
- **Area:** Data acquisition / Import architecture
- **Found:** 2026-08-28 (2026+ API acquisition investigation)
- **Resolved:** 2026-08-29
- **Runbook:** `AFLDB-ISSUE-099.md` — **durable source of truth, approved implementation
  contract and complete T1–T8 execution record.** `AFLDB-2026-API-ACQUISITION.md` §2.4, §5,
  §9 row D and §13.5 remain the parent investigation record.
- **Files changed:** `tools/rebuild/fitzroy/acquire_core.R`,
  `tools/rebuild/fitzroy/fitzroy-contract.json`, `tools/migration/import_fitzroy_core.py`,
  `data/reference/source-families.json`, `src/db/migrations/076_afltables_settle_projections.sql`
  (**new, applied, checksum-frozen — never edit**), `src/lib/acquisition/observation-store.ts`
  (new, extracted), `src/lib/acquisition/settle-afltables.ts` (new),
  `src/lib/acquisition/reconciliation.ts` (one behaviour-neutral `export`),
  `src/lib/external-afl/current-season-import.ts` (re-pointed at the extracted store),
  `tools/current-season/settle-afltables.ts` (new CLI),
  and the acquisition/import/registry/settle test suites.
  `src/db/migrations/074_source_observation_spine.sql` was **not** edited.
- **Related:** `AFLDB-ISSUE-093` (Resolved — supplies the acquisition/manifest machinery being
  reused), `AFLDB-ISSUE-096` (parent contract; ISSUE-099 owns the `data_issues` disagreement
  row it left unimplemented), `AFLDB-ISSUE-086` (authority mechanism — a prerequisite of the
  future acceptance stage, **not** a v1 gate), `AFLDB-ISSUE-101` (rollover, downstream)

### Problem
2026 has no player-match statistics, period scores, attendance or Brownlow votes at all,
because the only current-season path stages matches from Squiggle/Kali and neither source
carries them. AFL Tables — already AFLDB's frozen canonical historical source — was confirmed
by live probe on 2026-08-28 to carry the 2026 season through Round 25 (completed 2026-08-23),
including per-match player statistics, venue, attendance and a ladder. The historical source is
also a current-season source, and the existing architecture does not exploit that.

### Scope

**SUPERSEDED WORDING, retained as lineage.** The original scope paragraph read: *"A nightly
in-season settle pass: partial fitzRoy acquisition via `acquire_core.R --from/--to` producing
a snapshot plus SHA-256 manifest, then **reviewed** promotion of `matches`,
`match_period_scores`, `attendance`, `player_match_stats` and `brownlow_round_votes`. Reuses
the ISSUE-093 machinery rather than introducing a second importer. Note the existing
boundary: a narrowed range is labelled `partial` and normal rebuild mode correctly refuses
it, so an in-season consumer must opt in explicitly."* The `partial`-label sentence is
**factually superseded**: `acquire_core.R` no longer emits a `partial` label at all — it
records `acquisition_kind` (`core_snapshot` / `validation_witness`),
`completeness: "unvalidated"` and `full_history: FALSE`, and deliberately does not
adjudicate (`acquire_core.R:326-374`). See `AFLDB-ISSUE-099.md` F1.

**Current scope (approved 2026-08-28, `AFLDB-ISSUE-099.md`).** A nightly in-season settle
pass: an explicitly in-season partial fitzRoy acquisition (a third `acquisition_kind`,
`in_season_partial`, with its own offline adjudicator) producing a snapshot plus SHA-256
manifest → a deterministic Python→TypeScript observation bundle → migration-074 observation
persistence → typed family projections → reconciliation → `promotion_candidates` →
idempotent `data_issues` → dry-run/apply reporting. Two families —
`afltables.match` (targets `matches`, `match_period_scores`; attendance is a `matches`
field) and `afltables.player_match_stats` (targets `player_match_stats`,
`brownlow_round_votes`). The ISSUE-093 acquisition, manifest-validation and scan machinery
is reused; its canonical writers are **not** — they upsert without an ownership predicate
and delete by match/season, which is correct for a clean rebuild and forbidden in-season.

**v1 performs ZERO canonical INSERT/UPDATE operations and writes no `accept`
`promotion_decisions` row.** The canonical acceptance transaction is a separately approved
later stage with its own recorded prerequisites (`AFLDB-ISSUE-099.md` §16).

### Dependencies and gates

**SUPERSEDED WORDING, retained as lineage:** *"Depends on **`AFLDB-ISSUE-096`**.
Implementation is gated on evidence probe **P5**. If P5 shows AFL Tables lacks stable
`ID`/`url` for 2026, implementation is blocked and the in-season plan reverts to
Squiggle-provisional-only."*

**Current status.** **P5 ran on 2026-08-28 and PASSED. The stop condition was NOT triggered
and ISSUE-099 is no longer probe-blocked** (`AFLDB-2026-API-ACQUISITION.md` §13.5). Do not
rerun P5. The authoritative result: 9,522 × 81 rows, 2026-03-05 → 2026-08-23, 207 distinct
matches; `url` **0 NA**; populated `url` **1:1** with populated `ID` (663 ↔ 663); `ID`
itself **82 NA** across 5 urls, none of which carries an `ID` anywhere in 2026.
**Binding: the in-season player-match identity keys on the stable profile `url` and must
never require `ID`. Names are never an identity key.**

`AFLDB-ISSUE-096` is **Resolved** and its migration 074 is applied and checksum-frozen.
`AFLDB-ISSUE-086` is **Resolved** but its `data_overrides.entity_type` CHECK covers only
`players`, `matches` and `draft_picks`; that gap is a prerequisite of the future acceptance
stage, **not** a v1 gate.

### Root cause
Not a defect — a missing capability. The 2026 path stages matches from Squiggle/Kali, and
neither source carries player-match statistics, period scores, attendance or Brownlow votes.
AFL Tables carries all of them and was already the frozen canonical historical source, but
the acquisition contract admitted only whole completed seasons: `enforce_full_history()`
refused a narrowed range by design, and there was no in-season acquisition kind, no
observation bundle and no reviewed settle path.

### Implementation (T1–T8, 2026-08-28 → 2026-08-29)
A third acquisition kind, `in_season_partial`, with its own contract block and its own
offline adjudicator (`--require-in-season`); the historical fail-closed gates refuse it and
it refuses them, symmetrically. Python owns AFL Tables interpretation and emits a
deterministic, versioned, manifest-bound observation bundle (`--emit-observations`,
`--on-record-error reject`); TypeScript owns validation, the migration-074 observation spine,
two typed migration-076 staging projections, reconciliation, `promotion_candidates`,
`import_rejections` and the `data_issues` disagreement lifecycle. The boundary is JSON and
fails closed on contract drift. Identity is the stable AFL Tables profile `url`; the fitzRoy
numeric `ID` is enrichment only (82/9522 in-season rows carry none) and a name is never
identity. The operator CLI is review-first: `--dry-run` is the default and executes the real
write path against real constraints before rolling back; `--apply` must be explicit.

**v1 writes NO canonical fact row and no acceptance decision** — `canonicalRowsInserted` and
`canonicalRowsUpdated` are literally 0 and asserted as a runtime fact. Absence is observation
state only, is never swept in an incomplete scope, and never produces a candidate.

Two defects were found by T8's real-data run and repaired: **D1**, an already-absolute
`manifest_path` joined onto the project root a second time (cross-platform; Windows made it
visible), fixed by a `resolveManifestPath()` boundary; and **D2**, target existence being
decided from the identity-resolved projection, which manufactured **803**
`brownlow_round_votes / unresolved_identity` candidates from 9522 NA vote observations, fixed
by establishing target existence from the source record **before** identity is consulted.

### Validation
All user-run. Acquisition contract 23/23; source contract 77 passed / 4 skipped; Python
bundle contract 48/48; reference data 37 passed / 2 skipped; migration 076 applied,
checksum-frozen, 76/76 with 0 pending; privileges 29/29 across a reconcile; FK/index 2/2;
`tests/current-season-import.test.ts` **172/172**; `tests/integration/settle-afltables.test.ts`
**20/20 with zero skips**, including the restricted `afldb_import` role-parity case;
typecheck at exactly the 13-error/4-file unrelated baseline with zero ISSUE-099 errors;
targeted ESLint silent.

End-to-end on real 2026 data (`afldb_test`, as `afldb_import`): one bounded in-season
acquisition — 207 matches, rounds 1–25, 9522 player rows, **0 missing profile URLs**, 82
missing IDs — then a genuine first apply (batch 90: 9729 observations, 9729 versions, 8926
projections, 9936 candidates) and an idempotent rerun (batch 91: 0 payloads, 0 versions, 0
candidates, 0 `data_issues`, identical queue). **Zero canonical rows written by any
transaction**, re-proved retroactively by an `xmin` scan of all four fact tables. **All §25
stop conditions are inactive**; SC7 fired twice during T8 (D1, D2) and both are discharged.
The F11/Brownlow measurement — 9522 rows, 0 with votes, all NA — closes **U2** and confirms
**R3**: zero Brownlow candidates in-season is the correct result.

### Follow-up
Prerequisites of the future canonical acceptance stage, recorded and deliberately excluded
from v1 (`AFLDB-ISSUE-099.md` §16): provenance columns on `match_period_scores` and
`brownlow_round_votes`, `player_match_stats.source_record_id`, a representable manual
authority for the three player/period-grain targets (`AFLDB-ISSUE-086`), the acceptance
transaction itself, ownership handover for any 2026 match already stamped `squiggle`/`kali`
(a reviewed human decision, never an automated transfer), and whether acceptance triggers
`recomputeClubSeasons` for the in-progress season.

Three implementation limitations were carried out of this issue as **separately tracked
work, none of which blocks it**: `AFLDB-ISSUE-104` (the foreign-owner `data_issues` refresh
limitation), `AFLDB-ISSUE-105` (the bigint `import_batches.id` runtime typing debt) and
`AFLDB-ISSUE-106` (`proposedPeriodScoreValues()` returning an empty array rather than no
target). `AFLDB-ISSUE-101` remains the downstream end-of-season rollover.

**Nothing is scheduled by this issue** — no cron entry and no systemd timer. Scheduling the
settle pass is a separate authorisation.

## AFLDB-ISSUE-100 — Staging-only lineup / team-announcement domain

- **Status:** Open
- **Severity:** Medium
- **Area:** Data acquisition / Import architecture
- **Found:** 2026-08-28 (2026+ API acquisition investigation)
- **Resolved:** N/A
- **Runbook:** `AFLDB-2026-API-ACQUISITION.md` §2.5 and §9 row E.
- **Files (today, for orientation only — none changed yet):** new
  `staging.external_lineups` (migration not yet written)
- **Related:** `AFLDB-ISSUE-096` (parent contract)

### Problem
AFLDB has no model for announced teams, jumper numbers, substitutions or late changes.
Canonical participation is the played match sheet (`player_match_stats`), which exists only
after a match. `fetch_lineup_afl` (fitzRoy → AFL.com.au API, no key required) is the only free
source found in the investigation that supplies lineups at all; footywire and squiggle
explicitly do not.

### Approved rule — retained explicitly
**Lineups are staging-only and never become canonical participation.** Canonical participation
remains the played match sheet. No public surface.

### Scope
A new `staging.external_lineups` table fed by `fetch_lineup_afl`, for admin visibility and
reconciliation only.

### Established vs unknown
- **Established:** the source exists, requires no API key, and covers AFLM/AFLW and several
  state leagues.
- **UNKNOWN:** the returned column set, and whether AFL provider ids are exposed and stable.
  The staging schema cannot be designed until P3 supplies the shape.
- **Recorded risk:** this reads the AFL's own website API through a third-party package. Free
  and unauthenticated today, but not a published contract with AFLDB, and revocable without
  notice — which is part of why it is staging-only.

### Dependencies and gates
Depends on **`AFLDB-ISSUE-096`**. Implementation is gated on evidence probe **P3**, which must
supply the source shape.

### Validation
None yet — nothing implemented.

### Follow-up
None recorded yet.

## AFLDB-ISSUE-101 — End-of-season promotion / baseline rollover

- **Status:** Open
- **Severity:** Medium
- **Area:** Data acquisition / Import architecture / Data integrity
- **Found:** 2026-08-28 (2026+ API acquisition investigation)
- **Resolved:** N/A
- **Runbook:** `AFLDB-2026-API-ACQUISITION.md` §5 (rollover row) and §9 row F.
- **Files (today, for orientation only — none changed yet):**
  `data/reference/fitzroy-accepted-baselines.json`, `data/reference/seasons.json`,
  `tools/db/rebuild-test.ts` (Stage 9 `matches_after_accepted_last_season`)
- **Related:** `AFLDB-ISSUE-099` (settle stage — prerequisite), `AFLDB-ISSUE-093` (Resolved —
  accepted-baseline register), `AFLDB-ISSUE-095` (ladder/team-season — **coordinated, not
  absorbed, and not redefined here**)

### Problem
The approved historical boundary is that only the in-progress season belongs to the API
pipeline. Nothing currently performs the transition: when a season completes, its in-season
API-provenance rows must be superseded by a standard full-history fitzRoy re-acquisition, and
the surrounding registers must advance in step. Without this, in-season provenance would become
permanent and the Stage-9 gate would drift.

### Scope
The rollover operation: extend `data/reference/fitzroy-accepted-baselines.json` to include the
completed season, supersede the in-season provenance, advance
`seasons.json.in_progress_seasons`, and re-point the Stage-9
`matches_after_accepted_last_season` gate.

### Boundary — `club_seasons` ownership
**This issue must not independently redefine completed-season `club_seasons` ownership.** That
remains with `AFLDB-ISSUE-095`, whose D1–D7 decisions are open and are not pre-empted here. Do
not add a `club_seasons` Stage-9 gate under this issue.

### Dependencies and gates
Depends on **`AFLDB-ISSUE-099`**, and on coordination/completion of the relevant
`AFLDB-ISSUE-095` canonical ladder/team-season path. Not gated on any probe.

### Validation
None yet — nothing implemented.

### Follow-up
Schedule before the 2026 season closes.

## AFLDB-ISSUE-102 — Awards have no canonical legacy-free acquisition path

- **Status:** Open
- **Severity:** Medium
- **Area:** Data acquisition / Import architecture
- **Found:** 2026-08-28 (2026+ API acquisition investigation, source-verified)
- **Resolved:** N/A
- **Runbook:** `AFLDB-2026-API-ACQUISITION.md` §2.7 and §9 row G.
- **Files:** `tools/migration/import_awards.py` (`:1408`)
- **Related:** `AFLDB-ISSUE-095` — the direct sibling of this gap for the ladder/team-season
  domain. Linked, **not absorbed**; ISSUE-095's status and decisions are unchanged.

### Problem
`tools/migration/import_awards.py:1408` still calls `require_env("AFLDB_LEGACY_SQLITE")`. The
awards/honours domain therefore has the same legacy dependency `AFLDB-ISSUE-095` records for
`club_seasons`, and it was not tracked anywhere before this entry.

The 2026+ investigation additionally established that **no API on any investigated free source
covers Coleman, Rising Star, All-Australian, AFLCA, AFLPA or club best-and-fairest**. Brownlow
is the exception: per-match votes already arrive through the AFL Tables path
(`Brownlow.Votes`), and Coleman is derivable from `player_match_stats.goals`.

### Scope — record only
**This issue is deliberately record-only.** It records the legacy dependency and identifies it
as the legacy-free acquisition gap for the awards domain.

**Do not design the replacement under this investigation.** No source selection, no per-award
provenance decision and no importer work is authorised by this entry.

### Dependencies and gates
Depends on nothing. Not gated on any probe.

### Validation
None — record-only.

### Follow-up
A future issue may take up the design once it is scheduled deliberately. Nothing is decided
here.

## AFLDB-ISSUE-103 — Grid Solver `won_a_final` / `never_won_a_final` queries can hit statement timeout

- **Status:** Resolved
- **Severity:** Medium
- **Area:** Grid Solver / Performance
- **Found:** 2026-08-28 (final validation of resolved AFLDB-ISSUE-076)
- **Resolved:** 2026-08-29
- **Runbook:** `AFLDB-ISSUE-103.md`
- **Files:** `src/db/queries/grid-solver.ts`, `src/search/grid-solver-spec.ts`, `tests/integration/grid-solver.test.ts`
- **Related:** `AFLDB-ISSUE-076` was resolved separately by `6014b9e`; its `won_final_at_venue` repair is evidence lineage only and is not reopened or absorbed here.

### Symptom
Four complete runs of `tests/integration/grid-solver.test.ts` under the normal
`AFLDB_STATEMENT_TIMEOUT_MS=5000` repeatedly left three failures involving the untouched
`won_a_final` / `never_won_a_final` predicates. PostgreSQL statement timeout is the established
symptom; the exact three test names/cells and SQLSTATE evidence are the first reproduction task.

### Established evidence
- Broader-suite outcome was 127/130 passed, with the same three failures remaining.
- ISSUE-076's separate historical regression remained green at 341 ms, 361 ms, 344 ms and
  357 ms across those runs.
- `won_a_final` / `never_won_a_final` code was not changed by ISSUE-076.
- No timeout increase, schema change or index change was used.

### Scope
Determine from evidence whether both predicates share one pathological SQL shape, whether the
negative predicate is expensive because it negates/anti-joins the positive logic, whether there
are two distinct defects, or whether the timeout depends on the other Grid Solver axis. Do not
absorb unrelated Grid Solver performance work.

### First wrong layer
Database query/compiler performance in the generated finals-win membership predicates.

### Root cause
`won_a_final` and `never_won_a_final` compiled the same winning-final participation relation into
query shapes that PostgreSQL planned as `Nested Loop Semi Join` and `Nested Loop Anti Join`
operations over a `Materialize` node. The planner estimated about 1,737 qualifying participation
rows, while bounded analysis found 14,499 qualifying rows and 3,618 distinct players. The cheap
winner set was therefore repeatedly rescanned through pathological outer join shapes;
`never_won_a_final` inherited the same defect through its negation, and combining the predicates
duplicated it.

### Fix
Compile the distinct winning-final player set as a scalar-array InitPlan. `won_a_final` now tests
`p.id = ANY (ARRAY(...))`, while `never_won_a_final` applies its exact complement with
`NOT (p.id = ANY (ARRAY(...)))`. The base-table contract remains unchanged: a player qualifies by
participating in a finals match with `player_match_stats.club_id = matches.winner_club_id`. No
timeout, index, schema, data, or unrelated finals-predicate change was made.

### Validation
- The focused ISSUE-103 regression independently derives the winner set from `matches` and
  `player_match_stats`, exercises all three failing cells, verifies the positive set, its
  complement and their empty intersection, and enforces a one-second ceiling under
  `AFLDB_STATEMENT_TIMEOUT_MS=5000`.
- Focused regression: 1 passed / 130 skipped in 1.15 seconds; the three-cell test completed in
  840 ms.
- Post-fix production SQL completed in 57 ms, 504 ms and 105 ms. Corresponding
  `EXPLAIN (ANALYZE, BUFFERS)` execution times were 35.386 ms, 501.698 ms and 103.791 ms. The
  winner relation is evaluated once per predicate as a scalar-array InitPlan; the old
  `Nested Loop Semi Join` / `Nested Loop Anti Join` plus `Materialize` pathology is absent.
- Full `tests/integration/grid-solver.test.ts`: 131 / 131 passed in 36.97 seconds against
  `afldb_test` with the normal five-second statement timeout. Relevant tests completed in 39 ms
  (`won_a_final`), 502 ms (`never_won_a_final`), 114 ms (positive/negative disjointness), and
  802 ms (the exact three-cell independent-oracle regression). No SQLSTATE `57014` occurred.
- The resolved AFLDB-ISSUE-076 regression remained green at 380 ms.
- The temporary plan diagnostic was removed after its evidence was recorded.

### Next action
None. Retain the focused regression and normal statement-timeout boundary.

## AFLDB-ISSUE-104 — `data_issues` open-row dedup is not ownership-scoped

- **Status:** Open
- **Severity:** Low
- **Area:** Data acquisition / Import architecture / Data integrity
- **Found:** 2026-08-29 (`AFLDB-ISSUE-099` T7, carried to T8 close-out)
- **Resolved:** N/A
- **Files:** `src/db/migrations/076_afltables_settle_projections.sql` (**applied and
  checksum-frozen — a change here needs a NEW forward migration**),
  `src/lib/acquisition/settle-afltables.ts` (`writeDisagreementIssue()`)
- **Related:** `AFLDB-ISSUE-099` (Resolved — origin)

### Problem
Migration 076's partial unique index for one open finding per key is
`(issue_type, issue_key) WHERE issue_key IS NOT NULL AND resolved_at IS NULL`. It **does not
include owner**. `writeDisagreementIssue()` infers that index in `ON CONFLICT ... DO UPDATE`,
so if another writer ever held an **open** row on an identically shaped `issue_key`, a
recurrence would refresh **that** row — overwriting its `entity_id`, `severity`,
`description` and `details`, and stamping `details.owner` as `AFLDB-ISSUE-099`. Resolution
is correctly ownership-scoped (`details->>'owner'`) and is proved never to close a
foreign-owned row; **the refresh path is not, because the index is not.**

### Current reachability
**Unreachable today, verified at close-out.** `issue_key` was introduced by migration 076 and
`settle-afltables.ts` is the only writer that populates it — every other `data_issues` writer
(`tools/records/import-first-kick-goal.ts`, `tools/migration/enrich_birth_dates.py`,
`enrich_birth_dates_from_club_lists.py`, migration 020) leaves it NULL, and the index is
partial on `issue_key IS NOT NULL`. Keys are namespaced
`afltables|<family>|<record>|<target>`.

### Why it was not fixed in ISSUE-099
`AFLDB-ISSUE-099.md` §13.3 scoped ownership to **resolution** deliberately, and §26's T7
instruction specified exactly this upsert, so the writer implements the contract as written.
Narrowing it needs either a forward migration changing a frozen dedup contract, or a
pre-read of ownership before the upsert — which introduces a TOCTOU window and requires a new
undefined behaviour (fail closed? counter? skip?) that no approved contract specifies.
Improvising that at close-out was refused.

### Exact next action
**Binding precondition: before any second writer begins populating `data_issues.issue_key`,
ownership must become part of the conflict/dedup contract** — either a forward migration
adding owner to the partial unique key, or an ownership-scoped persistence path with defined
behaviour when a foreign-owned open row exists. Until such a writer is proposed there is
nothing to do. **Do not edit migration 076.**

## AFLDB-ISSUE-105 — `import_batches.id` bigint is a string at runtime, typed as number

- **Status:** Open
- **Severity:** Low
- **Area:** Data acquisition / Import architecture / Type safety
- **Found:** 2026-08-29 (`AFLDB-ISSUE-099` T6; predates it in `AFLDB-ISSUE-098` code)
- **Resolved:** N/A
- **Files:** `src/lib/external-afl/current-season-import.ts:783-789`,
  `src/lib/acquisition/settle-afltables.ts` (`SettleRunResult.batchId`),
  `src/lib/acquisition/observation-store.ts` (signatures extracted verbatim)
- **Related:** `AFLDB-ISSUE-098`, `AFLDB-ISSUE-099` (both Resolved)

### Problem
`import_batches.id` is `bigint ... GENERATED ALWAYS AS IDENTITY` (migration 001:55).
postgres.js renders `int8` as **text** rather than risk a lossy `Number`, so an uncast
`RETURNING id` yields a JavaScript **string** at runtime while the declared type is
`number | null`. Nothing misbehaves today — the value is only passed back into SQL — but the
hazard is latent: any arithmetic, strict comparison or number-keyed lookup on it fails
silently. The ISSUE-099 integration suite hit exactly that as a test failure before the type
was understood.

### Boundary
**Do NOT cast the bigint to `int`.** That trades a latent typing bug for a real overflow risk
on an identity column. The repair is a type contract that tells the truth about the driver's
output — a branded/string-typed batch id, or an explicit documented decode at the driver
boundary — applied consistently across the current-season and settle paths.

### Exact next action
Decide the boundary convention, then apply it to both call sites and the shared
`observation-store.ts` signatures in one change. Cross-issue by nature: it is not
ISSUE-098's or ISSUE-099's alone.

## AFLDB-ISSUE-106 — `match_period_scores` proposes an empty array instead of no target

- **Status:** Open
- **Severity:** Low
- **Area:** Data acquisition / Import architecture
- **Found:** 2026-08-29 (`AFLDB-ISSUE-099` T8, while fixing the Brownlow sibling defect)
- **Resolved:** N/A
- **Files:** `src/lib/acquisition/settle-afltables.ts`
  (`proposedPeriodScoreValues()`, `targetEstablishedBySource()`)
- **Related:** `AFLDB-ISSUE-099` (Resolved — origin; its D2 fixed the Brownlow sibling)

### Problem
ISSUE-099's D2 established that a target the source never published must produce no
candidate, no rejection and no projection. `brownlow_round_votes` expresses that by returning
`null`, and `targetEstablishedBySource()` now gates it before identity is consulted.
`proposedPeriodScoreValues()` does not: with no published quarter scores it returns
`{ period_scores: [] }`, so such a match would produce a `match_period_scores` candidate
proposing an **empty** array — a review item with nothing to review.

### Why it is tracked rather than fixed
**Unreachable in the real T8 snapshot** — all 207 acquired 2026 matches carried period-score
observations, so no empty proposal was produced. Fixing it means changing a different
function's declared return contract and adding `match_period_scores` to the optional-target
set, which would alter a signed-off assertion: a Python-rejected match record currently
refuses on **both** match targets, and `tests/integration/settle-afltables.test.ts` asserts
that. ISSUE-099 was not expanded at close-out to do it.

### Exact next action
Decide whether a match with no published period scores establishes the target at all. If it
does not, make `proposedPeriodScoreValues()` return `null` on an empty set and extend
`targetEstablishedBySource()`, then reconcile the integration suite's rejected-record
expectation deliberately rather than incidentally.
