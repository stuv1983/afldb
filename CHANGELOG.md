# Changelog

All notable changes to AFLDB.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/). The
project is pre-1.0 and has not cut a numbered release, so entries are grouped by
date. Versioned releases begin at the public launch of `afldb.com`.

Git history starts on 15 August 2026, part-way through the build. Entries dated
earlier than that are reconstructed from the development record and are marked
accordingly — they describe work that is in the tree but predates its first
commit.

---

## [Unreleased]

### Admin Mutation Integrity, Identity, and Audit Repair — 20 August 2026

- **Match and player-stat correctness (AFLDB-ISSUE-001–009, 014–022, 029–036, 038)**:
  - Added `src/lib/match-sheet.ts` and `src/lib/admin-match.ts` as shared server-boundary validators for match-sheet JSON, bounded statistics, exact Brownlow 3-2-1 allocations, new-match scores, attendance, and period totals.
  - Added `src/db/queries/player-derived.ts` as the single targeted rebuild path for career game numbers, club stints, club-season/player-season/career totals, nullable era statistics, career spans, search rank, season metadata, and season-wide Brownlow coverage.
  - Refactored match-sheet save and match deletion into supported one-command postgres.js queries, corrected match-FK deletion ordering, removed nonexistent coverage relations, and stopped all writes to authoritative `brownlow_season_votes` and independently sourced `brownlow_round_votes`.
  - Removed player-stat-to-team-score synchronization because rushed behinds are not attributable to players. Match Details remains the explicit official-score editor and now transactionally refreshes the final cumulative period, match outcome, season metadata, and affected player summaries.
  - Made score synchronization fail closed at the query boundary, made it permanently off in the UI, and documented the attribution limitation beside the match sheet.
  - Match creation now rejects duplicate natural keys, validates season-active club identities, requires finite consistent score inputs, cites `manual_admin_edit` for recorded attendance (including zero), and refreshes season metadata and coverage.
  - Match deletion now safely handles first/last-match foreign keys, zero-game players, empty latest seasons, and all affected derived player surfaces.
  - Previous-lineup prefill is now strictly relative to the edited match, and replacing a prefilled team correctly records dropped players for removal.
  - Official Match Details score edits now use a sparse-safe final-period policy (period four unless explicit extra time exists). `club_seasons` remains explicitly flagged for source reconciliation because the canonical ladder is source-derived and season-rule dependent.

- **Player, draft, and link identity integrity (AFLDB-ISSUE-007–008, 012–013, 018–020, 027–028)**:
  - Player creation and link resolution require `AFLDB_IMPORT_DATABASE_URL`; the application read URL is no longer a write fallback.
  - Optional draft history now requires an explicit 1981–2100 year and a club identity active in that season; no DOB or wall-clock year is invented.
  - Zero-game profiles preserve `NULL` for never-recorded era statistics while keeping recorded-game counts and always-recorded totals at zero.
  - Draft resolution follows only the durable numeric `draft_person_id`, propagates to picks for that exact identity, and no longer fans out by raw name.
  - “Create & link” now locks/rechecks the unresolved target and creates the player plus link in one import transaction, preventing stale-form orphan players.
  - Player-link audit failures now return visible success-with-warning results that explicitly say not to retry, and dynamic public link consumers are revalidated.

- **Awards and honours integrity (AFLDB-ISSUE-010–011, 019, 023–025, 027–028, 037)**:
  - Manual award winners now use the `manual_admin_edit` source with unique UUID-backed source record IDs.
  - Brownlow is excluded from the generic awards form and rejected in the lower helper because `brownlow_season_votes` is authoritative.
  - Club best-and-fairest winners derive their required historical club identity from the award definition; all optional award club contexts are season validated.
  - Added migration `058_data_edits_editor_entities.sql` to allow audit snapshots for every registered editor entity.
  - Added migration `059_honour_team_member_identity.sql` to replace name-only honour-team uniqueness with separate linked-player and unlinked-name partial unique indexes.
  - Hall of Fame categories/years, Legend years, award vote/stat values, and honour-team ordering now have action- and query-boundary validation rather than browser-only constraints.
  - Award, Hall of Fame, and honour-team audit failures are shown as committed-with-warning states and their forms invalidate affected dynamic public pages.

- **Workflow, cache, and audit safety (AFLDB-ISSUE-026–028)**:
  - Submission rejection is now a conditional compare-and-set transition with `RETURNING`; stale or missing rows cannot be reported or audited as successfully rejected.
  - Added dynamic path invalidation for player, match, season, club, record, award, Hall of Fame, honour-team, and draft consumers after their corresponding mutations.
  - Statistical writes that still require a separate-role audit now preserve the successful result and display a do-not-retry warning on audit failure. The remaining cross-role atomicity limitation is documented as open in `issues.md`.

- **Validation and maintenance (AFLDB-ISSUE-039)**:
  - Added focused regression suites for match input, match mutations, match-sheet semantics, awards/honours, draft/player links, and submission rejection.
  - Renamed `vitest.config.ts` to `vitest.config.mts` so its existing ESM syntax loads without Vite's CommonJS compatibility warning.
  - Created and maintained `issues.md` as the defect ledger: 37 repaired defects are marked resolved and three policy/architecture/tooling limitations remain open.

### Interactive Match Browser with Season & Club Filters — 20 August 2026

- **Comprehensive Match Browser in Data Editor (`/admin/data-editor`)**:
  - `src/db/queries/match-admin.ts`: Created `searchAdminMatches` with parameterized filtering across seasons, clubs, round numbers, and text queries, returning match details alongside player lineup counts (`playerCount`).
  - `src/app/admin/data-editor/MatchBrowser.tsx`: Built an interactive match browser component featuring:
    - Default view displaying recent matches with scores, venues, and lineup statuses.
    - Quick season jump chips (`2026`, `2025`, `2024`, `2023`).
    - Filter controls for Season (dropdown), Club (dropdown), Round # (number input), and Team/Venue Search.
    - Direct action buttons on each match row: **`📋 Match sheet`** (instant player stats editor), **`Edit details`** (scores/venue editor), and public match link.
  - `src/app/admin/data-editor/page.tsx`: Embedded `MatchBrowser` replacing the plain numeric season input.

### Quick Lineup Pre-Fill & Player Stats Entry Workflow — 20 August 2026

- **1-Click Roster Pre-Fill & Live Match Sheet Stats**:
  - `src/db/queries/matches.ts`: Added `getRecentClubLineup` to fetch the previous match lineup (players, names, and jumper numbers) for any club in the competition.
  - `src/app/admin/data-editor/page.tsx`: Loaded previous club lineups for both home and away teams when viewing the match sheet editor.
  - `src/app/admin/data-editor/MatchSheetEditor.tsx`: Added quick lineup helper buttons to instantly pre-fill all 23 players for home and away clubs with their jumper numbers, while retaining full individual player addition/removal (`PlayerPicker`, `✕` button) and live tabular stat entry (kicks, handballs, disposals, marks, goals, behinds, tackles, hitouts, frees, and Brownlow 3-2-1 votes).

### Fix Attendance Status Coverage Constraint on Match Creation — 20 August 2026

- **Attendance Status & Score Reconciliation in Match Creation**:
  - `src/db/queries/match-admin.ts`: Added `attendance_status` (`'complete'::coverage_status` when crowd attendance is provided, `'not_collected'::coverage_status` when absent) to satisfy the non-null `matches_attendance_status_ck` constraint in PostgreSQL migration 020. Also enforced strict score component reconciliation (`homeScore = 6*G + B`) to adhere to `matches_score_components_ck`.

### Super Admin Database Editing Security Governance — 20 August 2026

- **Strict Super Admin Access Enforcement**:
  - Confirmed and verified that all direct database editing tools, forms, and server actions are restricted exclusively to `super_admin` sessions via `requireSuperAdmin()`:
    - **Data Editor & Forms**: Match creation, Match Sheet Lineup & Stats Editor, Player Creation & Bio Details, Award Winners, Hall of Fame Inductees, Honour & Representative Teams, and Data Edits (`/admin/data-editor`).
    - **Entity Link Resolutions**: Resolving and linking unlinked player identities in draft and historical records (`/admin/player-links`).
    - **Data QA Search & Query Execution**: Raw SQL QA query builder (`/admin/query-builder`).
    - **Ingest Pipeline Decisions**: Elevated `decideSubmission` (approval/rejection) and `runPromotion` (applying ingested CSV data into production database) in `src/app/admin/submissions/[id]/actions.ts` from `requireAdmin` to `requireSuperAdmin()`.
    - **Navigation Visibility**: The admin sidebar model in `src/app/admin/nav-model.ts` hides all database editing links from regular `admin` and `contributor` accounts.

### Fix Seasons Generated Column in Match Creation — 20 August 2026

- **Fix Seasons Table Insert in Match Creation**:
  - `src/db/queries/match-admin.ts`: Updated `createMatch` to insert `status = 'in_progress'::season_status` into `seasons` instead of `is_complete`, resolving PostgreSQL error `cannot insert a non-DEFAULT value into column "is_complete"` (`is_complete` is a generated stored column mirroring `status = 'complete'`).

### Safe Match Deletion & Automatic Player Statistics Rollback — 20 August 2026

- **Transactional Match Deletion & Derived Stats Recomputation**:
  - `src/db/queries/match-admin.ts`: Created `deleteMatch` query helper to safely remove a match, its lineups (`player_match_stats`), period scores (`match_period_scores`), and any match achievements (`player_achievements`) using the `afldb_import` pool.
  - `src/db/queries/match-admin.ts`: Automatically recalculates `player_career_stats` and `player_season_stats` for all affected players across all statistics (games, goals, behinds, kicks, handballs, disposals, marks, tackles, hitouts, Brownlow votes, best game records, debut/last match dates). If a player now has 0 remaining matches, a clean zero-game record is preserved so their biography remains intact.
  - `src/app/admin/data-editor/DeleteMatchButton.tsx`: Created interactive super admin button with warning dialog and reason prompt for safely deleting test or invalid matches.
  - `src/app/admin/data-editor/actions.ts`: Added `deleteMatchAction` with audit logging in `data_edits` and path revalidations.
  - `src/app/admin/data-editor/MatchSheetEditor.tsx` & `src/app/admin/data-editor/EditorForm.tsx`: Embedded `DeleteMatchButton` directly in the Match Sheet Editor and Match Detail Editor interfaces.

### Super Admin Match Creation, Grounds & Live Stats Workflow — 20 August 2026

- **Super Admin Match Creation GUI (`/admin/data-editor` → "+ Add new match")**:
  - `src/db/queries/match-admin.ts`: Created `createMatch` query layer to transactionally insert new match records and quarter scores (`match_period_scores`) into PostgreSQL using the `afldb_import` pool credentials. Automatically derives match result (`home_win`, `away_win`, `draw`), winner club, margin, is_final status, round codes, and stable natural match keys. Logs audit records to `data_edits`.
  - `src/app/admin/data-editor/CreateMatchForm.tsx`: Built interactive super admin GUI component for creating matches:
    - **Match Information**: Season, Round Type (Regular Season, Qualifying Final, Elimination Final, Semi Final, Preliminary Final, Grand Final), Round Number, Match Date, Start Time, Grounds/Venue dropdown selection (`listVenues`), Attendance (crowd), and Notes.
    - **Clubs & Scores**: Home & Away club selectors, real-time score calculation (`Goals * 6 + Behinds`).
    - **Quarter Breakdown**: Collapsible Q1, Q2, Q3, Q4 goals, behinds, and points inputs for both clubs.
    - **Seamless Workflow**: Direct submission transitions immediately into the **Match Sheet Editor** (`/admin/data-editor?mode=match-sheet&id=${id}`) to populate Home & Away 23-player lineups, in-game stats (goals, behinds, kicks, handballs, disposals, marks, tackles, hitouts, frees for/against, jumper numbers), and allocate 3-2-1 Brownlow votes.
  - `src/app/admin/data-editor/actions.ts`: Added `createMatchAction` with input validation, `data_edits` audit logging, and cache revalidations across `/matches`, `/matches/[id]`, `/seasons/[year]`, and `/admin/data-editor`.
  - `src/app/admin/data-editor/page.tsx`: Embedded `CreateMatchForm` into the Matches management section.

### Player Search & Listing Improvements for Listed / Un-debuted Players — 20 August 2026

- **Search & Listing Visibility for Listed / Un-debuted Players**:
  - `src/db/queries/search.ts`: Switched `searchPlayers` from `JOIN` to `LEFT JOIN player_career_stats` and set subtitle to `'Listed player (yet to debut)'` (or club name + `'Listed player'`) when `debut_season` is null. Enables newly created players or un-debuted draftees (e.g. Fred Rodriguez, Riley Onley) to be immediately discoverable in sitewide search, autocomplete, and `PlayerPicker`.
  - `src/db/queries/players.ts`: Switched `listPlayers` to `LEFT JOIN player_career_stats` with `COALESCE` on numeric totals to ensure players with 0 career games render properly in player directories and filter queries.
  - `src/db/queries/player-links.ts`: Updated `resolveLink` to ensure dual resolution across `draft_picks` and `draft_persons` matching by person ID or raw name.

### Draft & Recruitment Info on Player Creation, and Awards & Representative Teams Admin — 20 August 2026

- **Draft & Recruitment Selection during Player Profile Creation**:
  - `src/db/queries/players.ts`: Extended `CreatePlayerInput` and `createPlayer` to accept `draftInfo` (`recruitedFrom`, `draftYear`, `draftType`, `pickNumber`, `clubId`, `draftAge`, `pickNote`, `detail`). Automatically creates a linked `draft_picks` record with status `resolved` and associated `draft_persons` entry inside the creation transaction.
  - `src/app/admin/data-editor/CreatePlayerForm.tsx`: Added collapsible "Draft & recruitment details" section to the player creation form with inputs for junior/origin club, draft year, draft type (National, Rookie, Pre-Season, Mid-Season, Father-Son, Category B Rookie), pick number, drafted club selector, draft age, and pick note.
  - `src/app/admin/data-editor/actions.ts`: Updated `createPlayerAction` to parse and validate draft & recruitment fields and trigger path revalidations for `/draft`.
- **Super Admin Awards, Hall of Fame & Representative Teams Management**:
  - `src/db/queries/awards-admin.ts`: Created admin mutation layer with `createAwardWinner`, `createHallOfFameInductee`, and `createHonourTeamMember` running with `afldb_import` pool credentials and logging audit snapshots to `data_edits`.
  - `src/app/admin/data-editor/AwardWinnerForm.tsx`: Created GUI component allowing super admins to record award winners (Brownlow, Coleman, Rising Star, Norm Smith, All-Australian, Club Best & Fairest, AFLCA/AFLPA) with player lookup via `PlayerPicker`, season, club, votes/stats, position, captaincy, and citations.
  - `src/app/admin/data-editor/HallOfFameForm.tsx`: Created GUI component allowing super admins to record Australian Football Hall of Fame inductees with player links, categories (Player, Coach, Umpire, Media, Admin, Pioneer), induction year, Legend elevation status, state, and career summary.
  - `src/app/admin/data-editor/HonourTeamForm.tsx`: Created GUI component allowing super admins to add members to representative and honour teams (Teams of the Century, State of Origin, Indigenous / Multicultural teams) with player links, positions, roles (Captain, Coach), and lineup sort order.
  - `src/app/admin/data-editor/actions.ts`: Added `createAwardWinnerAction`, `createHallOfFameAction`, and `createHonourTeamMemberAction` with validation and revalidations across public awards, Hall of Fame, honour teams, and player profiles.
  - `src/app/admin/data-editor/page.tsx`: Embedded the new Awards & Honour Teams management section directly in the Data Editor GUI.

### Super Admin Match Sheet Editor & Live In-Game Player Stats Management — 20 August 2026

- **Interactive Super Admin Match Sheet & Lineup Editor**:
  - `src/db/queries/match-sheet.ts`: Created `saveMatchSheet` to perform transactional upserts of `player_match_stats` for all players in a match using `afldb_import` pool credentials. Supports player additions, deletions, jumper numbers, goals, behinds, kicks, handballs, disposals, marks, tackles, hitouts, frees for/against, and Brownlow votes.
  - `src/db/queries/match-sheet.ts`: Added automated real-time recomputation of derived `player_career_stats` (games, goals, behinds, kicks, handballs, disposals, marks, tackles, hitouts, best game records, debut/last match dates) and `player_season_stats` for all affected players directly in SQL upon saving.
  - `src/db/queries/match-sheet.ts`: Added optional automated synchronization of match final scores, result, winner club, and margin on `matches` derived from player goals and behinds.
  - `src/app/admin/data-editor/MatchSheetEditor.tsx`: Created a full-featured client editor with team-by-team rosters (Home & Away), live team aggregate totals (score, disposals, marks, tackles), player removal, "+ Add player to lineup" search with `PlayerPicker`, and score synchronization toggle.
  - `src/app/admin/data-editor/actions.ts`: Added `saveMatchSheetAction` with payload validation, `data_edits` audit recording, and path revalidations across `/matches/[id]`, `/players/[slug]`, and `/admin/data-editor`.
  - `src/app/admin/data-editor/page.tsx`: Embedded Match Sheet Editor direct ID lookup, "Open match sheet" action buttons on season match lists, and direct launch from Match Details editor.
  - `src/app/admin/data-editor/EditorForm.tsx`: Added an "Open Match Sheet Editor →" action button on match detail edit forms.
  - `src/db/queries/matches.ts`: Expanded `MatchPlayerRow` and `getMatchPlayers` to query `jumper_number`, `frees_for`, and `frees_against`.

### Super Admin Player Creation, Bio Editing & Draft Pick Management — 20 August 2026

- **Super Admin Player Creation & Bio Information Management**:
  - `src/db/queries/players.ts`: Added `createPlayer` helper supporting creation of player profiles with display name, auto-split given/surname, canonical slug, search name normalisation (`afldb_normalise_name`), sort name, date of birth, DOB confidence, height (cm), weight (kg), and biographical notes. Executes via `AFLDB_IMPORT_DATABASE_URL` (`afldb_import` role) to strictly comply with PostgreSQL least-privilege write grants on statistical tables. Initialised empty zero-statistic record in `player_career_stats`.
  - `src/db/queries/players.ts`: Updated `fetchPlayer` to `LEFT JOIN` `player_career_stats` and `COALESCE` all career statistics to `0`, ensuring newly created or listed players who have yet to make their senior match debut load cleanly on `/players/[slug]`. Expanded `PlayerProfile` to include `heightCm`, `weightKg`, `givenName`, `surname`, and `notes`.
  - `src/app/admin/data-editor/CreatePlayerForm.tsx`: Created a new super admin component allowing administrators to create player profiles directly from the Data Editor GUI (`/admin/data-editor`).
  - `src/app/admin/data-editor/actions.ts`: Added `createPlayerAction` with full field validation, audit logging to `data_edits`, and path revalidations.
- **One-Click "Create & Link Player" in Player Links Queue**:
  - `src/app/admin/player-links/ResolveControls.tsx`: Added a dedicated "Create & link new" tab in the resolve drawer. Pre-fills player name from the raw source name and enables administrators to enter DOB, height, weight, and bio notes to create a player profile and link the unlinked record (e.g. rookie draft pick, honours entry) in a single action.
  - `src/app/admin/player-links/ResolvePanel.tsx`: Passed `playerName` and `context` attributes to `ResolveControls`.
  - `src/app/admin/player-links/actions.ts`: Added `createAndLinkPlayer` action linking created players to `draft_picks` (and corresponding `draft_persons` records) or honours records with audit logging.
  - `src/db/queries/player-links.ts`: Updated `resolveLink` to synchronize `draft_persons` when resolving `draft_picks` selections.
- **Draft Picks Management & Search in Data Editor**:
  - `src/lib/edit/spec.ts`: Added `draft_picks` to `EDITABLE_ENTITIES` allowing editing of `player_name_raw`, `original_club_raw`, `height_cm`, `weight_kg`, `draft_age`, `pick_note`, and `detail`.
  - `src/db/queries/data-edits.ts`: Added `draft_picks` row reader in `getEditableRow` and `applyDraftPickEdit` in `applyEdit`.
  - `src/app/admin/data-editor/page.tsx`: Added draft pick ID direct lookup and draft search by player name / year with inline edit links.
  - `tests/edit-spec.test.ts`: Added validation unit test coverage for `draft_picks` fields and integrity checks.
- **Player Profile Display for Listed & Drafted Players**:
  - `src/db/queries/draft.ts`: Added `getPlayerDraftHistory` query fetching all recorded draft selections for a player.
  - `src/app/players/[slug]/page.tsx`: Added height, weight, and bio notes to the Career & Biography table. Added a dedicated "Draft & recruitment" table section displaying draft year, pick, type, drafted club, recruited origin, and draft age. Handled 0-game draftees gracefully with an informative listing banner and refined metadata description sentence.

### Dynamic Search Box Placeholders, Fillout Animations & Coming-Soon Polish — 20 August 2026

- **Dynamic Rotating Search Placeholders & Animations for AFL & AFLW**:
  - `src/lib/site-settings.ts`: Added setting keys `searchPlaceholdersAfl`, `searchPlaceholdersAflw`, `searchPlaceholderInterval`, and `searchPlaceholderAnimation`. Added default sample queries for AFL and AFLW, interval parser (2–60s), and animation type parser (`typewriter` | `fade` | `slide` | `none`).
  - `src/components/SearchBox.tsx`: Added dynamic placeholder rotator supporting configurable placeholder lists, rotation intervals, and four animation fillout modes (`typewriter` typing/backspacing, `fade`, `slide`, `none`). Pauses animation cleanly on input focus and user entry.
  - `src/app/page.tsx`, `src/app/aflw/page.tsx`, `src/app/search/page.tsx`: Integrated dynamic search placeholders and animation settings across AFL home, AFLW home, and global search pages.
- **Super Admin Search Box Settings & Interactive Live Preview**:
  - `src/app/admin/settings/SearchPlaceholderSettings.tsx`: Created dedicated admin settings component allowing super administrators to configure AFL sample queries, AFLW sample queries, rotation interval (seconds), and placeholder animation styles. Included an interactive live animation preview box simulating AFL and AFLW placeholder cycling in real time.
  - `src/app/admin/settings/SettingsForm.tsx`: Embedded `SearchPlaceholderSettings` into the main settings form.
  - `src/app/admin/settings/actions.ts`: Added atomic saving of search placeholder settings with audit logging and page revalidations (`/`, `/aflw`, `/search`, `/admin/settings`).
  - `tests/site-settings.test.ts`: Added unit tests for search placeholder parsing, interval clamping, and animation mode validation.
- **Coming Soon Page Text & Media Polish**:
  - `deploy/coming-soon/index.html`: Refreshed feature texts, descriptions, and image alt captions for players, seasons/ladders, search, and honours/Brownlow medal history.
  - `src/lib/site-content.ts`: Updated `DEFAULT_APEX_CONTENT` to mirror the refined copy and alt text descriptions for the apex coming-soon page.
  - `deploy/coming-soon/style.css`: Added smooth image hover elevation transitions (`transform`, `box-shadow`, `border-color`) and subtle card polish.

### Non-AFL Club Unmatched Filtering & Admin Player Links Search — 20 August 2026

- **Non-AFL Club Unmatched Badge Filtering on Public UI**:
  - `src/lib/format.ts`: Added `isNonAflClub` and `shouldShowUnmatched` helpers recognizing state-league, regional, and non-VFL/AFL clubs (such as West Perth, West Adelaide, North Adelaide, Norwood, Sturt, East Brunswick Scorpions (VWFL), St Albans Spurs (VWFL), TFL, NTFL, etc.).
  - `src/app/hall-of-fame/page.tsx`, `src/app/honour-teams/[slug]/page.tsx`, `src/app/awards/[slug]/page.tsx`, `src/app/awards/[slug]/[season]/page.tsx`, `src/app/seasons/[year]/page.tsx`: Suppressed `<UnmatchedPlayer>` reader suggestion badges across all public frontend tables for footballers who played exclusively for non-VFL/AFL clubs, as AFLDB contains complete historical VFL/AFL/AFLW player records and these players will not have AFLDB player profiles.
- **Super Admin Name and Context Search in Player Links**:
  - `src/app/admin/player-links/page.tsx`: Added search input form and server-side filtering on `q` allowing super administrators to search unresolved records by player name or context across any table or across all tables. Maintained pagination, table filters, clear action, and empty query state.
  - Retained all unresolved non-AFL records in `/admin/player-links` so super administrators retain full review and resolution capabilities.

### AFLW Players in Hall of Fame & Non-Player Categories — 20 August 2026

- **AFLW player linking and club labeling**:
  - `src/db/queries/awards.ts`: Updated `HallOfFameRow`, `listHallOfFame`, and `getHallOfFameInductees` to left-join `aflw.players` and expose `aflwPlayerSlug` for AFLW inductees (e.g. Daisy Pearce, Erin Phillips).
  - `src/lib/format.ts`: Added `formatHallOfFameClub` to automatically append `(AFLW)` to the club column for AFLW inductees (e.g. `Melbourne (AFLW)`, `Adelaide, Port Adelaide (AFLW)`), while formatting non-player categories cleanly as `—`.
  - `src/app/hall-of-fame/page.tsx`: Linked AFLW inductees directly to their AFLW player profiles (`/aflw/players/[slug]`) across Legends and All Inductees tables, updated the stats strip to include AFLW players in "With an AFLDB record", and formatted club names with `(AFLW)`.
  - `src/app/seasons/[year]/page.tsx`: Linked AFLW inductees to their AFLW player pages in season Hall of Fame overviews and suppressed `<UnmatchedPlayer>` tags.
  - `src/db/queries/player-links.ts`: Excluded AFLW-matched Hall of Fame inductees from the unresolved men's player linking queue.
- **Hall of Fame non-player category presentation**:
  - `src/lib/format.ts`: Added `NON_PLAYER_HOF_CATEGORIES` and `isNonPlayerHallOfFameCategory` helper recognizing Media, Umpire, Administrator, and Pioneer categories.
  - `src/app/hall-of-fame/page.tsx`: For inductees in non-player categories, removed the `<UnmatchedPlayer>` tag and misleading "no playing record" tooltip. Displayed `—` (dash) for their Club column.
  - `src/app/seasons/[year]/page.tsx`: Suppressed `<UnmatchedPlayer>` tags for Hall of Fame inductees in non-player categories.
  - `src/db/queries/player-links.ts`: Filtered out non-player categories from the unresolved player links queue in `listUnresolvedLinks`.

### Security & Architecture Audit Remediation — 20 August 2026

Detailed remediation of findings identified during the full-stack architecture and security code review:

- **Runtime enforcement of `AFLDB_MAX_PAGE_SIZE` and `AFLDB_MAX_FILTERS`**:
  - `src/search/constants.ts`: Updated `MAX_PAGE_SIZE` to dynamically read `process.env.AFLDB_MAX_PAGE_SIZE` if set and positive, with a safe fallback to 100.
  - `src/search/advanced-spec.ts`: Updated `LIMITS.maxFilters` to dynamically read `process.env.AFLDB_MAX_FILTERS` if set and positive, with a safe fallback to 20; linked `LIMITS.maxPageSize` to `MAX_PAGE_SIZE`.
  - `src/lib/params.ts`: Updated documentation and parameter clamping to ensure URL parsing strictly honors configured limits.
- **Production Reverse Proxy & CSP Hardening**:
  - `deploy/Caddyfile.production`: Added `Strict-Transport-Security` (`max-age=31536000; includeSubDomains`) and `Content-Security-Policy` to the `beta.afldb.com` reverse proxy block so that edge responses and proxy-generated error pages (such as 502/504 during restarts) enforce strict transport security and script boundaries.
  - `next.config.ts`: Documented build-time header evaluation requirements for `AFLDB_ENV=production`.
- **Standalone Build Environment Verification**:
  - `tools/build/prepare-standalone.mjs`: Added build-time verification logging `AFLDB_ENV` status so operators are notified whether standalone headers are being compiled for production or development.
- **SQL Query Parameterization Hardening**:
  - `src/db/queries/player-links.ts`: Replaced `sql.unsafe` array string concatenation in `listUnresolvedLinks` with native postgres.js array parameterization (`= ANY(${statusValues})`).
- **Dependency Version Pinning**:
  - `package.json`: Locked core runtime and dev dependencies to exact versions (removing `^` semver ranges) to guarantee reproducible, audit-locked builds.

### Fixed — 19 August 2026
- **Player links now appear on public pages immediately.** Linking a
  player in `/admin/player-links` (or vetting a row as genuinely
  unlinked) only revalidated the admin queue; the public pages that
  render those names — awards, clubs, honour teams, seasons — are
  statically generated with up to a 24-hour window, so a freshly linked
  Team of the Century member (Ted Whitten, Ron Barassi) vanished from
  the queue but kept showing as unmatched on the honour-team page for up
  to a day. Both actions now revalidate the whole public family.

### Birth-date enrichment from all-time club lists — 19 August 2026

DOB coverage rose from 12,472 to 13,356 of 13,361 players (100.0%) on the
dev database. The five clubs missing from the legacy club register —
Fitzroy (759 gaps), University (82), Brisbane Bears (44), Sydney/South
Melbourne (3) and North Melbourne (1) — had their AFL Tables all-time
player list pages captured as CSVs; a new pass
(`tools/migration/enrich_birth_dates_from_club_lists.py`) matches them by
name within each club's roster, corroborated by games/goals/seasons, and
fills only missing dates. 3,944 rows agreed with existing data, one
conflict (a 2-day discrepancy on an 1868 date) was flagged as a
data_issue rather than overwritten, and the 5 players still without a
date are blank in the source as well. Same-name pairs (two Fitzroy Tom
Meehans, two Sydney John Fogartys) disambiguate on exact games-at-club
with goals and span as non-blocking vetoes. Not yet run against prod.

### Grid solver: rivalries, marquee matches and more — 19 August 2026

Seven new builders (the catalogue is now 107 across 11 categories),
widening what a board can ask based on data already in the schema.

#### Added
- **Rivalries & marquee matches**, a new category. `match_event_played` /
  `match_event_min` read `matches.match_event`, whose complete tagged
  vocabulary is Anzac Day, Dreamtime at the 'G and King's Birthday.
  `matchup_played_min` ("X+ matches between two clubs") takes the two
  organizations as parameters, so any derby — Showdown, Western Derby,
  QClash — is expressible without a derby definition existing in the
  schema. Good Friday and Easter Monday fixtures are not tagged in the
  source data and are reachable only as a matchup.
- **`never_played_in_draw`** — the negation sibling of
  `drawn_matches_min`, following the `never_played_finals` pattern.
- **`debuted_in_decade`** — one-parameter convenience over
  `debuted_between`, matching `played_in_decade`'s shape.
- **`venue_stat_total_min`** ("X+ of a stat at venue, career") — the
  aggregated sibling of `venue_game_stat_min`, so "100+ goals at the MCG"
  is now askable.
- **`venue_goals_max`** ("X or fewer goals at venue, having played
  there") — goals only, because it is the one statistic recorded for
  every player-game; a career max over an era-limited stat would silently
  count unrecorded games as zero.
- **Natural-language wiring (parser v15).** "played on anzac day" /
  "3+ anzac day games", "played in 3 showdowns" (also western derby,
  qclash, sydney derby — organizations resolved through the club
  directory at parse time), and "debuted in the 1990s" / "debuted
  between 2000 and 2009" all compile to the new builders as
  `careerPredicates`. Guard rails: a superlative governing the phrase
  ("most anzac day games") declines rather than misreading as a 1+
  list; a marquee/rivalry predicate alongside a season range declines
  rather than silently dropping the seasons; and a max/min aggregation
  with no metric over structure-only content now normalises to a list,
  so "players WHO PLAYED on anzac day" (whose "who played" reads as the
  "who played the most…" idiom) returns the full list instead of a
  25-row truncation. `DECADE_RE` also accepts "during the 1990s".

### Schema and privilege review — 17 August 2026

A design review of the 43 migrations and the privilege reconciler. Nothing here
was a live defect; every item is a rule that existed only in prose, in a
comment, or in the habits of the one program that writes a table. Two
migrations: `044_schema_integrity.sql` and `045_import_write_is_fail_closed.sql`.

#### Fixed
- **Write privileges fail closed too.** Migration 039 inverted the schema-wide
  default privilege for `afldb_app` and left the identical mechanism running for
  `afldb_import`, so each new operational table was fully writable and
  `TRUNCATE`-able by the ETL role until someone ran the reconciler. Its scope is
  now `afldb_meta.import_writable_tables`, opted into with
  `afldb_meta.grant_import_write()` — the mirror of `grant_app_read()`. Both
  install scripts now revoke the defaults instead of re-granting them on every
  re-run.
- **`afldb_import` could reset the auth sequences.** 039 revoked the operational
  tables and not their identity sequences, and migration 011 had granted
  `UPDATE` on every sequence in `public` — which is what `setval()` needs. The
  ETL role could reset `auth_users_id_seq` and break every later insert on a
  duplicate key without touching the table itself.
- **`afldb_import` could truncate `site_settings`.** The reconciler inferred
  "operational" as the complement of what `afldb_app` may read, and
  `site_settings` is deliberately app-readable, so the ETL role held `DELETE`
  and `TRUNCATE` on the site's runtime configuration. Two registries, no
  inference.
- **The reconciler now reconciles `afldb_auth`.** It re-granted an enumerated
  spec and never revoked, so any grant added by hand or left behind by an
  abandoned migration survived every run. Anything outside the spec is now
  revoked, and its sequence grants are narrowed from the whole schema to the
  tables it writes.
- **Stale registry rows are cleared.** A registry entry outlived its dropped
  table, so a later table reusing the name would have been granted on the next
  reconcile with nothing deciding that afresh.
- **Source keys scoped by source.** `player_relationships` and
  `father_son_selections` keyed `source_record_id` on its own, which forbade a
  second source and — being a plain `UNIQUE` — exempted null-keyed rows
  entirely. Both now match migration 042's
  `UNIQUE NULLS NOT DISTINCT (source_id, source_record_id)`.
- **Case-insensitive email uniqueness** on `auth_users`, `beta_allowed_emails`
  and pending `beta_join_requests`. Seven application write paths lowercase
  before storing; the database knew about none of them.
- **Foreign-key indexes the integrity check can use.** Four `player_id` indexes
  were partial on link status, which a `DELETE` from `players` cannot imply, so
  each of those tables was scanned instead. Re-predicated on
  `player_id IS NOT NULL`, the shape migration 041 established.

#### Added
- `CHECK` constraints for `data_submission_rows.verdict` (the only status column
  with no vocabulary behind it, and it gates approval) and for
  `site_media.byte_size = octet_length(bytes)`.
- `afldb_meta.revoke_app_read()` and `revoke_import_write()`, so un-registering
  a table is not a hand-written `DELETE` plus `REVOKE`.
- `afldb_meta.owned_sequences()`, which finds a table's identity sequences
  through the catalogue dependency rather than by guessing at a name.

#### Changed
- Comments recording three decisions that were previously unstated or wrong: the
  provenance foreign keys are unindexed deliberately (append-only parents), the
  awards tables keep both unique indexes because the two keys are not
  interchangeable, and `clubs_org_span_ck` checks a season span rather than the
  organization rule the comment above it in migration 017 describes.

### Housekeeping — 16 August 2026

#### Changed
- Trimmed the longest source docblocks to the constraint they exist to record,
  moving the incident narrative behind them into this changelog. Section
  dividers in the query and library modules compressed from three-line ASCII
  rules to one line.

#### Removed
- `tsconfig.tsbuildinfo` is no longer tracked. It is a host-specific
  incremental build cache, so a committed copy only ever reached the next host
  stale. Now ignored, along with `.claude/`.

---

## 16 August 2026 — Production infrastructure and the public apex

The day the project acquired real infrastructure: a dedicated host, a
production database, TLS, and a public front door.

### Added
- **Production droplet.** DigitalOcean `s-2vcpu-2gb` (2 vCPU, 2 GB, 60 GB) with
  PostgreSQL self-managed on the same host. A managed database cluster was
  costed and rejected: at roughly AUD 50/month more it bought failover and PITR
  for a workload whose writes all happen on dev before release, and which is
  backed up independently.
- **Host hardening.** SSH restricted to key auth for a single non-root user
  (`PermitRootLogin no`, `PasswordAuthentication no`, `AllowUsers arm`); `ufw`
  limited to 22/80/443; PostgreSQL bound to localhost only.
- **Production PostgreSQL bootstrap** (`tools/maintenance/00_install_postgres_prod.sh`)
  creating `afldb_prod`, the five roles, and `pg_trgm`/`unaccent`, writing
  credentials to a mode-600 `.env`.
- **`beta.afldb.com` live** behind Caddy with a Let's Encrypt certificate,
  served by `afldb.service` as a four-worker Next.js standalone cluster under
  systemd.
- **Coming-soon page at the apex** (`afldb.com`), static and indexable, served
  from disk by Caddy while the application itself stays `noindex` behind the
  beta gate. Carries an early-access request form.
- **`/admin/content`** — a super-admin editor for the coming-soon page and the
  site-wide footer: copy, images, cards, and search metadata, with media
  upload. The published apex page is rendered from the database; the files in
  `deploy/coming-soon/` are the reference copy it started from.
- **Runtime site settings** — home-page layout, record of the week, AFLW
  leaders panel, and grid-solver audience, all editable without a deploy.
- **Structured data and SEO** — JSON-LD, canonical URLs, and a segmented
  sitemap with a published index.
- **Admin password reset.** A super admin can issue a single-use temporary
  password that carries `must_change_password` and leaves the TOTP secret
  alone. Previously the only repair for a forgotten password was re-issuing an
  invite, which re-enrolled both factors.
- **Collapsible admin navigation.**
- **Email intake** for CSV submissions, polled by a systemd timer.

### Fixed
- **`AFLDB_INDEXING` split from `AFLDB_ENV`.** One flag had been deciding both
  search indexing and transport security. Holding the beta host out of search
  therefore also stripped `Secure` from its admin cookies on a live HTTPS site.
  Indexing is now its own flag and fails closed.
- **Read privileges fail closed.** `afldb_app` no longer inherits `SELECT` on
  new tables; a new public table must be granted explicitly via
  `afldb_meta.grant_app_read()`. `tools/maintenance/privileges.sql` reconciles
  the whole set and is mandatory after a restore.
- **Import privilege check** now uses `has_table_privilege` for `DELETE` and
  `TRUNCATE` rather than inferring them.
- **`.gitignore` was excluding `tools/build/prepare-standalone.mjs`.** An
  unanchored `build/` pattern matches at any depth, so the script `npm run
  build` invokes as its final step was never committed — and a fresh clone
  failed only there. Anchored to `/build/`.
- **`site_settings` jsonb read.** `postgres.js` returns jsonb as text, so the
  settings read had to parse rather than assume an object.
- Apex `ReadWritePaths` in the systemd unit now tolerates a host without that
  directory.
- Worker and pool sizing moved out of the unit file into per-host `.env`.

### Known issues
- Outbound SMTP on ports 25/465/587 is blocked by DigitalOcean. Titan can
  receive mail but cannot relay, so transactional mail goes through Brevo on
  port 2525.

---

## 15 August 2026 — Features, roles, and AFLW

### Added
- **AFLW as a separate competition.** Parsed and staged from the source scrape
  first so the real data could be inspected before committing to a schema, then
  exposed through a read-only `aflw` view schema (migration 026). AFLW is
  deliberately outside the normalised model: it played two seasons in calendar
  2022, and the core model keys a season by year. Seasons are identified by
  `season_key` and ordered by `ordinal`, never by year.
- **Grid Solver** — a 3x3 board of named questions, 93 builders across 10
  categories, modelled on the sports_data_lab original and checked against its
  generated criteria document. Family relationships, physical attributes, derby
  definitions and win-streaks are absent because the data does not exist.
- **Query builder** — a hidden super-admin tool for ad-hoc data QA. Table and
  column identifiers come from a curated allowlist rather than
  `information_schema` discovery, operators from a fixed vocabulary, and values
  are always bound as parameters.
- **Player comparison** with played-with and played-against drill-down.
- **Database Health** page for super admins.
- **Roles and delegation.** `super_admin` added above `admin`, plus a
  `contributor` role limited to CSV upload. Admin management is delegable via
  `can_manage_admins`. All roles require MFA.
- **Self-service admin invites** with QR-code TOTP enrolment, so a new admin
  scans rather than transcribes a secret.
- **CSV upload** for current and historical match results and player-match
  statistics, with sample files per dataset, plus an email-in channel as a
  second route.
- **Search-intent routing.** A query naming a club or season alongside a
  record, award or draft class now lands on that filtered view — "brownlow
  winner richmond" opens winners by season rather than career vote leaders.
- **AFLW-scoped global search and navigation.** Selecting AFLW switches the
  whole nav and the home-page search to that competition.
- **Collapsible tables and per-table filters** across the site, with applied
  filters carried in the URL.
- **Reorderable home-page sections**, dragged rather than stepped with arrows.
- **Brownlow Medal** queries, filters, and season/career views.
- **Draft origin filter** — filter the draft by drafting club and by
  feeder/state-league club.
- **Vitest** configuration and the first executable test suite; release-gate
  assertions separated into immutable and rolling-snapshot groups.

### Fixed
- `super_admin` could not actually log in.
- `afldb_app` had inherited read access to operational and auth tables;
  revoked, including `site_media`.
- Draft feeder club read from the raw query rather than the AFL club list, so
  state-league clubs resolve.
- `career_teammates_min` and the player-compare pair-discovery query were
  timing out against real data.
- Gate redirects were leaking the internal origin; middleware requires an
  absolute `Location`, so redirects are built from `AFLDB_BASE_URL`.
- Filtering a table below the first no longer jumps the page back to the top.
- Staged CSV row payloads were being double-encoded as JSON.
- `matches.attendance_status` is now set when promoting `match_results` rows.
- Single-use TOTP codes: a code cannot be replayed within its window.

---

## 14 August 2026 — Migration and foundations *(pre-git)*

### Added
- **Greenfield PostgreSQL 16 model** for VFL/AFL from 1897, replacing a legacy
  SQLite database that remains the read-only source. Bootstrap script creates
  `afldb_dev` and `afldb_test`, the `afldb_owner`/`app`/`import`/`backup` roles,
  and the `pg_trgm` and `unaccent` extensions.
- **Migration pipeline** in Python 3.12 with psycopg 3 and `COPY`, recording
  provenance and import batches, and a validation suite that reached 93/93
  parity checks with no rejected rows.
- **Next.js 15 application** — App Router, React 19, Server Components by
  default, with no separate API service.
- **Light and dark themes**, from the supplied mock UI.
- **Awards and honours** — Rising Star, All-Australian, club best-and-fairests
  and other competition awards, imported from the raw footywire and draftguru
  sources.
- **Global search beyond players** — rounds, years, grounds, awards and record
  categories.
- **Admin authentication** — `afldb_auth` role, `create-admin` tool, scrypt
  password hashing, and TOTP MFA.
- **Backup and tested restore procedure.**

### Changed
- **Brownlow totals do not come from match rows.** Per-game votes exist only
  for 1931–1934 and 1984–2025, so season and career totals use the
  season-level source. The legacy database's derived career totals were
  deliberately not copied forward.
- **`NULL` is not zero.** A missing historical statistic means "not recorded",
  tracked by season, statistic and grain, and preserved as such in the UI.
- **Historical club identity is explicit.** Renames and relocations share an
  organization without rewriting the historical club identity; mergers stay
  separate organizations and are linked, not combined. Neither club's
  statistics count toward a merged club.
- Deployment standardised on a single `main` branch, pulled from GitHub with a
  deploy key, rather than copying archives to hosts.

### Fixed
- `restore-test.sh` could leave the source DSN unchanged before `pg_restore
  --clean`, and a trailing `|| true` was suppressing every restore failure
  rather than only extension-owner warnings.

---

## Notes on scope

Family relationships are present in the legacy source but have not been
migrated, and are intentionally absent from the public site.

The core dataset was assembled from AFL Tables via
[fitzRoy](https://jimmyday12.github.io/fitzRoy/), with additional source
material for Brownlow voting, birth dates, and draft records.
