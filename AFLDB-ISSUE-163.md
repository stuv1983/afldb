# AFLDB-ISSUE-163 — Club leadership administration and current-captain display (ISSUE-156 P3e)

**Status:** **RESOLVED 2026-09-12.** Both stages (validated and committed 2026-09-12 — `8ed32b3`, `c28ea60`, `ea9f3dd`; §32.11 and §33.1 gates green) and the §34 audit fixes are in `main` at `3272434`, deployed to DEV with migration 098 applied and privileges reconciled, and accepted there in the browser on 2026-09-12 as part of the combined Admin Centre batch (160 + 161 + 162 + 163): captain, co-captain and vice-captain appointment, replace, end, reinstate, correct, void, the season overview Captain column, public club-page revalidation and the player-honours integration all passed, with responsive/design acceptance at 1440/1024/768/375 — the record is **§35**. Operator decisions D-1…D-18 (§30) **SIGNED OFF 2026-09-12 with four clarifications** and implemented as decided (§32.1); the §34 audit found no deviation and no stop condition. The five §34.4 findings are disposed in §35.3 as non-blocking follow-ups, not converted into completed work. PROD untouched; no PROD validation is claimed. Planning (§1–§31), Stage 1 (§32), Stage 2 (§33) and the audit (§34) are retained below as written.
**Severity:** Medium
**Area:** Admin / Data management / Club–season–player model / Public club page / Promotion lineage
**Created:** 2026-09-12
**Parent:** `AFLDB-ISSUE-156` (umbrella) — supplemental child **P3e**, after P3d (`AFLDB-ISSUE-162`); P4–P12 keep their labels
**Stacked on:** `AFLDB-ISSUE-162` (branch `opus/issue-163-club-leadership`, worktree `D:\dev\afldb-issue-163`, cut from `opus/issue-162-fixture-admin` @ `f80a1df`, which carries ISSUE-160 + 161 + 162 complete). Nothing merges first; all four deploy to DEV together as the Admin Centre batch (§28).
**Migration:** **one required** (§22). Highest migration on this branch was `097_fixtures.sql`; **098 was allocated by Stage 1 on 2026-09-12 as `src/db/migrations/098_club_leadership.sql`** (§32.2). It has been applied to **no** database.
**Planning model:** Fable 5.1, high. **Recommended implementation:** Stage 1 Opus 5 high (schema, mutation contract, replay, promotion, integration tests); Stage 2 Fable 5.1 high (admin section, public club page, revalidate route, unit tests).

This document is a planning deliverable. Every repository fact below was verified natively on this branch on 2026-09-12 (Read/Grep only). No shell, Git, SQL, DEV, PROD or deployment command was run. Nothing in `src/`, `tools/`, `tests/`, `data/` or `docs/` was changed.

---

## 1. Executive summary

AFLDB **already holds a captaincy table** — `captaincies` (migration 005), 1,774 Wikipedia-sourced rows for 1897–2026, loaded by `tools/migration/import_awards.py` from the tracked manifest `data/awards/captaincies.csv`, and already rendered on every public club page as a "Captains" history table and on every player page under honours (§2). It is an **honours import**, not an operational model: it is keyed by a source record id, its natural uniqueness is on the **raw player name**, its `season` column is a foreign key to the reference register (so a 2027 row cannot exist until the ISSUE-101 rollover), its role vocabulary is the single value `Captain`, its effective period is free text (`"2022 (co-captain), 2023– (sole captain)"`), it has no lifecycle, and its reload refuses the whole honours import on a natural-key collision with a row it does not own (§3). It cannot be the canonical Super-Admin-administered leadership record without breaking every one of those contracts, and the brief forbids weakening them.

ISSUE-163 therefore adds **one canonical registry table, `club_leadership`** — one row = one **appointment** (season, club identity, player, role, lifecycle status, optional start/end dates) — in the exact durability shape ISSUE-162 established for fixtures: a minted, never-edited `appointment_key`; a whole-row `data_overrides` record keyed `manual_admin_edit:<appointment_key>`, always active; `data_edits` audited against the appointment itself with an `appointment_key` lineage rule; a fail-closed `replay_admin_overrides('club_leadership')` branch that re-creates every appointment (ended and void included) on any rebuilt or promoted database; and a never-delete lifecycle `active` / `ended` / `void` (§5, §12, §19). "Current captain" is **derived from status, never from a clock** (§8). The season-list dependency is a write-time precondition — a player is appointable for club C / season S only while they hold C's authoritative S list place — enforced by locking the membership row, never by a foreign key, so history survives later list corrections (§9).

The public club page gains a compact **Leadership** block (current season's captain / co-captains / vice-captains, from canonical rows only, omitted when nothing is active) and its existing Captains history table is extended with canonical captain appointments from 2027 onward so the page never contradicts itself (§20). A successful mutation revalidates exactly the affected club's public path(s) through a new capability-gated `/admin/season-lists/revalidate` route — the first Admin Centre batch item with public output (§21). Admin management lives as a **Leadership section on `/admin/season-lists/[season]/[club]`** under the existing `data.seasonLists.*` capabilities; no new nav item and no new capability (§16, §18).

Two stages. No historical backfill: the canonical table starts at 2027 alongside the season lists; `captaincies` remains the historical honours source; a controlled Wikipedia→canonical conversion is a recorded follow-up the schema already supports (§23).

---

## 2. Current-state evidence (Planning Questions 1–7)

### 2.1 A captaincy model already exists — proven

| Fact | Where |
|---|---|
| `captaincies` table: `id`, `season smallint NOT NULL REFERENCES seasons(year)`, `club_id NOT NULL`, `player_id` nullable, `player_name_raw NOT NULL`, `link_status_value link_status NOT NULL`, `role text NOT NULL DEFAULT 'Captain'`, `period text`, `notes`, `source_id`, `source_record_id`, `import_batch_id` | `src/db/migrations/005_brownlow_awards.sql:177-194` |
| `captaincies_source_uq UNIQUE NULLS NOT DISTINCT (source_id, source_record_id)`; `captaincies_natural_uq UNIQUE (season, club_id, player_name_raw, role)` — "Co-captains differ by player_name_raw" | `042_awards_natural_keys.sql:55-74` |
| Partial index `ix_captaincies_player (player_id) WHERE player_id IS NOT NULL` | `044_schema_integrity.sql:201-203` |
| Loader: `import_captaincies()` — source `wikipedia`, rows from `load_captaincies()` (the tracked CSV), season must be in `seasons` ("unknown season" reject), club via season-aware `ClubResolver`, player via `PlayerResolver`, then `reload_keyed(... scope_column="source_id", scope_values=[wikipedia])` — deletes vanished keys **inside its own source scope only** | `tools/migration/import_awards.py:2373-2429`; `common.py:410-450` |
| `_refuse_captaincy_natural_key_collisions()` — refuses the **whole** reload (`ReloadOwnershipCollision`) when an incoming `(season, club_id, player_name_raw, role)` is already held by a row with a different `source_id` | `import_awards.py:2322-2370` |
| Manifest contract: `EXPECTED_TOTAL = 1774`, `MIN_SEASON 1897`, `MAX_SEASON 2026`, 130 seasons, 24 club identities, `ROLES = {"Captain"}` ("Vice-captain or a co-captain role would be a new vocabulary entry, i.e. a deliberate change"), `SOURCE_CITATIONS = {"wikipedia"}`, `source_key` = 24-hex digest carried verbatim | `tools/migration/captaincies.py:61-106` |
| Manifest content sampled: every 2026 row is `Captain` with a free-text `period` such as `2020–`, `2026–`, `2022–present`; 30 rows carry a `co-captain` annotation in `period` or `note` (e.g. Richmond 2022–2023 Nankervis/Grimes `Co-captains`; GWS 2022 Coniglio/Greene/Kelly); **0** rows mention vice, acting, interim, deputy or stand-in; Brisbane 2026 holds three `Captain` rows (Dunkley, Andrews, McCluggage); St Kilda 2026 two (Wilkie, Sinclair); Hawthorn 2026 two (Newcombe, Sicily); West Coast 2026 two (Duggan, Baker) | `data/awards/captaincies.csv` (grep, 2026-09-12) |
| Rebuild gate pins the count: `captaincies: 1774` in `EXPECTED` and a `captaincies_rows` check | `tools/db/rebuild-test.ts:833-888` |
| Public consumer 1: club page "Captains" section — `getClubCaptains(club.id)` (organisation-scoped, `ORDER BY season DESC, role`), rendered as a sortable Season / Captain / Played-as table with `UnmatchedPlayer targetTable="captaincies"` for unlinked rows; omitted when empty; metadata description promises "best-and-fairest winners and captains" | `src/db/queries/awards.ts:615-635`; `src/app/clubs/[slug]/page.tsx:21, 86, 128, 361-411` |
| Public consumer 2: player page honours — `getPlayerHonours()` reads `captaincies` for linked rows; page groups "Captain, <club>" by club ("Barry Round captained South Melbourne and then Sydney") | `awards.ts:431-537`; `src/app/players/[slug]/page.tsx:183-188, 457-460` |
| Admin consumer: `player_link_resolutions.target_table` admits `captaincies`; the player-links queue reads unlinked captaincy rows | `056_player_link_review.sql:30,58`; `067:65-69`; `src/db/queries/player-links.ts:42, 139-143` |
| Promotion: `captaincies` is one of seven `player_link_resolutions.target_id` targets with identity **`'none'`** ("NO stable identity exists for an honours row") | `tools/db/promotion-inventory.ts:464-479` |
| `award_winners.is_captain` / `is_vice_captain` are **representative-team** flags (All-Australian, 22 Under 22 captain "(c)"), not club leadership | `005:95-96`; `players/[slug]/page.tsx:412`; `issues.md:2369` |
| No `vice`/`co_captain`/`leadership` column, table, capability, route, query or test exists anywhere in `src/`, `tools/`, `tests/` outside the rows above | grep `captain` (37 `src/` files, all accounted for above or NL vocabulary / grid-solver spec strings) |
| `AFLDB-ISSUE-163` is unallocated: no match in `*.md`, `src/**`, `tools/**`, `tests/**`, `docs/**` | grep 2026-09-12 |

**Answer.** Yes, a captaincy model exists, and it is a **historical honours import** with name-keyed uniqueness, a register-bound season FK, free-text periods, a one-value role vocabulary and no lifecycle. It is already public on club and player pages. It is *not* the canonical, administered, role-aware, history-preserving leadership record the brief asks for (§3).

### 2.2 Season lists, capabilities, durability — what ISSUE-163 builds on

| Fact | Where |
|---|---|
| `season_list_members` (096): `UNIQUE (season, player_id)`; no FK to `seasons`; removal is an audited `DELETE` + inactive-override **tombstone**; `FIRST_LIST_SEASON = 2027` is a server rule; membership is **administrative intent**, never participation | `096_season_list_members.sql:66-132`; `admin-season-lists.ts:100-107` |
| `afldb_season_list_clubs(season)` — the ONE eligibility rule (forward extension by `is_current_afl_club` at/after the register's last season); reused unchanged by fixtures | `096:166-185`; `097:83-84` |
| Season window rule `FIRST_LIST_SEASON <= S <= max(seasons.year)+1` with a `NODE_ENV=test`-only ceiling override for two-season tests | `admin-season-lists.ts:152-210` |
| Membership row shape read by the club page: `readClubSeasonList()` — one query, every badge a column | `admin-season-lists.ts:1138-1170` |
| `resolvePlayerIdentity(tx, playerId)` — AFL Tables path first, then manual token; `ambiguous_identity` on >1 path; `identity: null` for a legacy identity-less player (season lists refuse; never mint) | `src/db/queries/player-identity.ts:81-107` |
| Mutation shape: one `AFLDB_IMPORT_DATABASE_URL` transaction; every precondition before the first write; `RollbackRefusal` thrown for any post-write refusal; `recordDataEdit(tx, …)` in the same transaction; `FOR UPDATE` + `updated_at` compare-and-swap | `admin-season-lists.ts:255-297, 365-385, 464-533, 766-794` |
| Fixture lifecycle precedent: `status IN ('scheduled','cancelled','void')`, `status_reason` mandatory outside the live state, **no DELETE path**, `fixture_key` minted once and never edited, `is_active` always true, replay re-creates void rows so `data_edits` stays resolvable | `097_fixtures.sql:100-234, 249-273`; `common.py:1828-1870`; `admin-fixtures.ts:106, 740, 1352, 1760-1818` |
| Fixture audit shape: `data_edits.table_name` widened to `'fixtures'` **obliges** a lineage target (`{ kind:'fixtures', entity:'fixtures', identity:'fixture_key' }`) and an identity SQL pair (`byId` / `byIdentity`) | `097:290-326`; `promotion-inventory.ts:357-367, 1553-1574`; `audit-log.ts:22-70`; `src/lib/audit-view.ts:61-72` |
| Settle-authority proof enumerates the CHECK literals: `OVERRIDE_ENTITY_TYPES = ['coaches','draft_picks','fixtures','matches','match_coaches','players','season_list_members']`; widening with a non-settle entity is order-independent | `src/lib/acquisition/manual-authority.ts:83-95` |
| Replay call sites and binding order: `players` → `season_list_members` (after players), `matches` → `fixtures`; promotion §8 loop `('players','matches','draft_picks','season_list_members','coaches','match_coaches','fixtures')` | `import_fitzroy_core.py:3526-3548`; `docs/production-promotion.md:641-694` |
| Capabilities: `data.seasonLists.read` ADMIN_AND_UP, `.edit` SUPER_ADMIN_ONLY; nav Data group order `data-editor, brownlow, player-links, coaches, draft, season-lists, fixtures`; `tests/auth.test.ts` walks every `page.tsx` / `route.ts` / `'use server'` module under `src/app/admin`, requires `requireCapability()` first, and pins the nav href lists | `capabilities.ts:101-118`; `nav-model.ts:84-92`; `tests/auth.test.ts:641, 673, 1123-1150` |
| Revalidation contract (S-6, D-9): a Server Action **never** calls `revalidatePath`; it returns `revalidatePaths`; the browser POSTs them to the domain's own capability-gated, allowlisted revalidate route after the action resolves; `router.refresh()` covers the `force-dynamic` admin page | `src/components/admin/action-submit.ts:22-53, 68-75`; `src/lib/admin/revalidate-route.ts`; `src/app/admin/coaches/revalidate/route.ts`; `src/app/admin/draft/revalidate-paths.ts` |
| Season lists reserved the endpoint: `REVALIDATE_ENDPOINT = '/admin/season-lists/revalidate'` "named as the route a future public consumer would add" — **never requested** today because every action returns `[]` | `src/app/admin/season-lists/submit-helper.ts:35-52` |
| Public club page: `export const revalidate = 86400`, `generateStaticParams()` prerenders all clubs, sections pushed into `ReorderableSections` (localStorage order keyed by pathname; unknown ids appended at the end, never dropped); a compact stat strip and notices render **above** the reorderable sections; `club.isCurrent`, `isContinuing = club.currentIdentityId === club.id` | `src/app/clubs/[slug]/page.tsx:56-62, 112-149, 643-670`; `src/components/ReorderableSections.tsx:66-75` |
| Existing precedent for revalidating club pages from admin: Brownlow finalisation calls `revalidatePath('/clubs/[slug]', 'page')` inside its action (pre-S-6 code); player-links likewise | `src/app/admin/brownlow/actions.ts:136, 292`; `player-links/actions.ts:32` |
| "Current season" facts available: `seasons.status` (`in_progress`/`complete`, 015), `seasons.data_through_date`, `max(seasons.year)` (2026), `in_progress_seasons [2026]` in `seasons.json`; **no** query anywhere answers "the current season for a club" | `015:48-61`; `clubs.ts:267-297`; `AFLDB-ISSUE-161.md` §2 |

---

## 3. Options for the canonical table (Planning Question D-1)

| Option | Semantics | Season 2027 | Identity | Roles / history | Reload safety | Promotion | Verdict |
|---|---|---|---|---|---|---|---|
| **A. Extend `captaincies`** (add `vice_captain` role, status, dates, manual rows) | conflates a curated honours import with operational admin truth | ✗ `season REFERENCES seasons(year)` — a 2027 row is impossible until the ISSUE-101 rollover; dropping the FK rewrites an honours contract | ✗ natural UNIQUE on `player_name_raw`; `player_id` nullable with link status — names decide identity | role text with `DEFAULT 'Captain'`; `period` free text; no lifecycle | ✗ a manual 2027 row + a later curated CSV row for the same person → `_refuse_captaincy_natural_key_collisions` bricks the **entire** awards reload; `MAX_SEASON`/`EXPECTED_TOTAL` gates and `rebuild-test.ts:854` would all need changing | `player_link_resolutions` identity `'none'`; no lineage rule; `captaincies.id` renumbered by every reload | **rejected** |
| B. Overrides-only (no table) | rows only in jsonb payloads; not readable by `afldb_app` (`data_overrides` is import-role SELECT only, 073) | — | — | — | — | — | rejected (the 161 §3 option E reasoning applies verbatim) |
| C. Flag on `season_list_members` (`leadership_role` column) | one row per player-season cannot hold an ended captaincy AND a current vice-captaincy, or two appointments in one season; removal is a `DELETE` + tombstone, which would delete leadership history with the membership | ✓ | ✓ | ✗ no history | ✓ | ✓ | rejected: violates "historical preservation of the outgoing appointment" |
| D. `players.is_captain` | permanent attribute; explicitly forbidden by the brief | — | — | — | — | — | rejected |
| **E. New canonical registry `club_leadership`** — one row per appointment, minted `appointment_key`, never deleted, whole-row override, replay branch, lineage rule | exact: "player P held role R at club C in season S, from … to …, as recorded by source" | ✓ no FK to `seasons` (096/097 precedent) | ✓ `player_id NOT NULL`; durable identity string in the payload; names never decide | ✓ constrained vocabulary; `active/ended/void`; optional dates | ✓ manual rows under `manual_admin_edit`; `captaincies` untouched | ✓ registry classification + `appointment_key` lineage rule | **chosen** |

**Coexistence rule (binding).** `captaincies` stays exactly as it is: the historical honours source for seasons **before** `FIRST_LEADERSHIP_SEASON` (2027). `club_leadership` is authoritative from 2027. The public projection unions the two by season boundary (§20.3), so no season is ever answered by both. `captaincies.py`'s `MAX_SEASON` (2026) must remain `< FIRST_LEADERSHIP_SEASON`; a source-contract test pins it (§24). Converting `captaincies` into canonical rows is a follow-up (§23, §27).

---

## 4. Semantic definition

> **A `club_leadership` row asserts: player *P* was appointed to leadership role *R* at club identity *C* for season *S*; it is currently held (`active`), was held and has ceased (`ended`), or was recorded in error and never valid (`void`).**

- It is **administrative fact about an office**, not participation and not a match-level "captained this game" record (out of scope, §27).
- Season is the AFL season the appointment belongs to. A pre-season appointment for 2027 announced in December 2026 is a 2027 row.
- Club is the historical identity (`clubs.id`) eligible in S under `afldb_season_list_clubs(S)`, never typed. Organisation views derive from `clubs.organization_id`.
- Player is `players.id`, chosen from the club's authoritative S list (§9); the durable record names the player by identity string only.
- Role is one of a closed vocabulary (§6). **Co-captaincy is two or more concurrent `active` `captain` rows**, not a role.
- Dates are **evidence, never identity and never the source of "current"** (§7).

---

## 5. Chosen canonical data model (D-1)

```sql
CREATE TABLE club_leadership (
  id               bigint      PRIMARY KEY GENERATED ALWAYS AS IDENTITY,

  -- THE durable appointment identity: randomUUID() minted once by
  -- src/db/queries/admin-club-leadership.ts and never edited (fixture_key shape).
  appointment_key  text        NOT NULL UNIQUE,

  -- No FK to seasons(year) (096/097 reasoning); same CHECK range.
  season           smallint    NOT NULL CHECK (season BETWEEN 1897 AND 2100),
  club_id          integer     NOT NULL REFERENCES clubs(id),
  player_id        integer     NOT NULL REFERENCES players(id),   -- plain FK, no CASCADE

  role             text        NOT NULL CHECK (role IN ('captain', 'vice_captain')),

  -- Lifecycle (D-7). active = currently holds the office; ended = held it and
  -- ceased; void = entered in error, never valid. No DELETE path exists.
  status           text        NOT NULL DEFAULT 'active'
                               CHECK (status IN ('active', 'ended', 'void')),
  status_reason    text,

  -- Evidence dates (D-3). NULL = genuinely unknown / not announced. There is
  -- no sentinel, no season-start fabrication, no round column, no timestamptz.
  started_on       date,
  ended_on         date,

  note             text,

  -- manual_admin_edit for every ISSUE-163 row; source_record_id = appointment_key.
  -- A future importer (e.g. a controlled captaincies conversion) writes under
  -- its OWN source_id and never over a manual row.
  source_id        smallint    NOT NULL REFERENCES sources(id),
  source_record_id text        NOT NULL,
  import_batch_id  bigint      REFERENCES import_batches(id),

  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT club_leadership_dates_ck
    CHECK (started_on IS NULL OR ended_on IS NULL OR ended_on >= started_on),
  CONSTRAINT club_leadership_active_open_ck
    CHECK (status <> 'active' OR ended_on IS NULL),
  CONSTRAINT club_leadership_void_reason_ck
    CHECK (status <> 'void' OR status_reason IS NOT NULL),
  CONSTRAINT club_leadership_source_record_uq UNIQUE (source_id, source_record_id)
);

-- I-2: one ACTIVE appointment per player per season — at most one role, at
-- most one club. Co-captains and multiple vice-captains are different players,
-- so they are unaffected. Ended and void rows are outside the index, so a
-- player may be re-appointed later in the same season as a NEW appointment.
CREATE UNIQUE INDEX ux_club_leadership_active_player
  ON club_leadership (season, player_id) WHERE status = 'active';

CREATE INDEX ix_club_leadership_club_season ON club_leadership (club_id, season DESC);
CREATE INDEX ix_club_leadership_player      ON club_leadership (player_id, season DESC);
CREATE INDEX ix_club_leadership_source      ON club_leadership (source_id);
CREATE INDEX ix_club_leadership_batch       ON club_leadership (import_batch_id) WHERE import_batch_id IS NOT NULL;
SELECT afldb_meta.grant_app_read('club_leadership');
SELECT afldb_meta.grant_import_write('club_leadership');
```

Every FK column has a leading-column index (`fk-indexes` contract). `season` has no FK (a 2027 appointment is intent about a season the register has not reached). **No FK to `season_list_members`**: 161's removal is a `DELETE`, and a FK would either block it (weakening 161's contract) or cascade it (destroying leadership history); the list precondition is enforced at write time instead (§9).

**Durable record** — one `data_overrides` row per appointment (fixture shape, §19):

| Column | Value |
|---|---|
| `entity_type` | `'club_leadership'` (CHECK widened by migration 098) |
| `entity_key` | `manual_admin_edit:<appointment_key>` |
| `field_group` | `'appointment'` |
| `override_values` | `{ appointment_key, club_slug, season, player_identity, role, status, started_on?, ended_on?, status_reason?, note?, replaces_appointment_key?, replaced_by_appointment_key? }` — club by **slug**, player by **identity string**, never ids; keys written only when supplied |
| `is_active` | **always `true`** — the lifecycle lives in `status`; a void or ended appointment must be re-created by the replay, never suppressed (its `data_edits` rows must stay resolvable) |
| `admin_user_id` | the acting Super Admin |

**Why a minted key and not a natural one (D-8).** Every candidate natural key changes or recurs: `(club, season, player, role)` recurs when a player is re-appointed later in the same season (a second row with the same tuple); adding `started_on` makes the key change on a date correction, which the brief forbids; ISSUE-161's natural key works only because a membership has no history. The token is minted once and never edited; a corrected date, an end, a reason or a note never moves the record.

---

## 6. Role vocabulary (D-2)

**`captain`, `vice_captain`. Nothing else.**

| Candidate | Decision | Reason |
|---|---|---|
| `captain` | kept | the office |
| `co_captain` as a stored role | **rejected** | the AFL office is "captain"; "co-captains" is the *plural*. The existing data models it exactly that way — 30 `captaincies` rows are `Captain` with a co-captain annotation (Richmond 2022–23 Nankervis + Grimes both `Captain`, note `Co-captains`). A stored `co_captain` would force every reader to ask "is a lone `co_captain` a captain?" and would require rewriting rows when a co-captain becomes sole captain (GWS 2022→2023 Greene). Co-captaincy = ≥2 concurrent `active` `captain` rows at one club-season; the public page reads the count and says "Co-captains" |
| `vice_captain` | kept, multiple allowed | real-world (clubs routinely name two or three) |
| `acting` / `interim` captain | **not a role** | a stand-in for one match is match-level (out of scope); a sustained interim captain after a resignation *is* the captain for that period: an ordinary `captain` appointment whose `note` may say "interim" |
| `leadership_group`, `deputy_vice_captain`, ceremonial roles | not modelled | no existing data requires them (the brief's rule); the CHECK can be widened by a later additive migration if a real need arrives |

Stored lowercase snake_case (matching `origin` in 096 and `status` in 097); rendered labels live in the UI.

---

## 7. Effective-period representation (D-3)

**Binding: an appointment-history model with a lifecycle `status` and two optional evidence dates. "Current" is `status = 'active'`, never a date comparison.**

Options evaluated:

| Option | Fails on |
|---|---|
| `effective_from`/`effective_to` **required** dates, current = `now() BETWEEN` | pre-season appointments have no announced date → fabricated season-start dates; "current" would depend on the server clock (untestable, flips at midnight, wrong across time zones); an end whose date is unknown cannot be recorded |
| `start_round`/`end_round` | Opening Round renumbering (round 1 from 2024), byes, finals codes; a captain who steps down in the off-season or between rounds has no round; requires a fixture to interpret; still needs a "current" rule |
| pure event log (appointed / ended events) + derived state | derived state needs its own table or view for every public read and for the partial-unique invariant; two objects to replay; no repository precedent |
| **status + optional dates** | none of the above: NULL means unknown; the current set is a plain status filter; the partial unique index enforces the invariant directly; matches the fixture lifecycle shape the operator has already accepted |

Rules:

- `started_on` NULL = date not announced / not known (typical for a pre-season appointment). Never defaulted.
- `ended_on` NULL on an `active` row = still holds (enforced by CHECK); NULL on an `ended` row = ended on a date not known.
- `ended_on >= started_on` when both are present (CHECK). Dates are validated as real calendar dates server-side (the ISSUE-162 §37.8 lesson: `Date.parse` normalises `2027-02-30`; reuse the fixture calendar validator).
- A mid-season change = one transaction: the outgoing row → `ended` (optionally `ended_on = D`), the incoming row inserted `active` (optionally `started_on = D`). Both rows are preserved (§12).
- Ordering for display inside a season: `started_on NULLS FIRST, created_at, id` — a pre-season appointment sorts before a mid-season replacement without any date being invented.
- A round may be recorded in `note` ("stepped down after round 12"); it is text, never a key.

---

## 8. Current leadership definition (D-4)

All reads are **organisation-scoped** (`clubs.organization_id`), so a rename inside a lineage never splits the answer, and the club page for the continuing identity is the one that shows it.

| Question | Binding answer |
|---|---|
| Which season is "current" for a club's public page? | `leadership_season(org) = max(season)` over the organisation's `club_leadership` rows with `status <> 'void'`. **Data-derived, no clock, no register lookup, no configuration.** The upper bound is guaranteed by the write-time window (§10), so the read needs none |
| How is the active set selected? | rows in that season with `status = 'active'`, grouped by role |
| Before the season starts? | 2027 appointments entered in the 2026 off-season make 2027 the leadership season immediately — which is the real-world truth ("Richmond's captain for 2027 is …"). The block is labelled with the season, so it is never mistaken for a 2026 statement |
| After the season ends, before the next is entered? | the last entered season still shows, labelled ("2027 leadership"); honest, never invented; the admin overview shows the next season's clubs at zero |
| No captain recorded? | if the organisation has no non-void row at all → the block is **omitted** (the club page's existing convention for empty captains/coaches/B&F). If the season has rows but none `active` (captain resigned, no replacement yet, vice-captains ended too) → omitted as well: "vacant" and "unknown" are indistinguishable and neither is stored |
| Captain ended, vice-captains still active? | the block renders with no captain line and the vice-captains — a true statement |
| Two active captains? | heading **"Co-captains"**, both listed; three or more the same. Alphabetical by display name — the office has no precedence |
| Vice-captains? | separate line "Vice-captain" / "Vice-captains", alphabetical, never mixed into the captain line |
| Historical era page (e.g. Footscray)? | no Leadership block — the continuing identity's page carries it; the era page still shows the Captains history table it shows today |
| Link to player pages? | always — every canonical row has `player_id NOT NULL` and a resolved identity, so `playerPath(slug, id)` is always available |

The same derivation (`readClubSeasonLeadership` / `getClubCurrentLeadership`, §17) serves the admin section and the public page, so the two can never disagree.

---

## 9. Season-list membership invariant (D-5)

**Binding rule: a player may be appointed (or reinstated) to any role for club C / season S only while they hold C's authoritative S list place.**

- Enforced in the appoint/replace/reinstate transaction: `SELECT id FROM season_list_members WHERE season = S AND club_id = C AND player_id = P FOR KEY SHARE` — the lock blocks a concurrent 161 `DELETE` of that row until the appointment commits; zero rows → refuse `not_listed` naming the club the player *is* listed at (if any) with a link to that club's list page. `FIRST_LEADERSHIP_SEASON` is `FIRST_LIST_SEASON` **by import**, one constant, so leadership can never precede the lists.
- **Not** a foreign key and **not** re-checked on replay (§19): the invariant governs *current mutation eligibility*; an appointment row is *historical validity* and survives any later list correction, transfer or removal. This is the distinction the brief asks for and it is what keeps 161's DELETE-plus-tombstone contract untouched.
- **Warn, don't block (161 unchanged):** removing or transferring a member who holds an `active` appointment is still allowed by 161's actions. Two additive read-only pieces surface it: (a) `readClubSeasonList()` gains an `activeLeadershipRole` column (NULL / `captain` / `vice_captain`) so the member table shows a "Captain" / "Vice-captain" badge and `MemberActions` puts one warning sentence in its Remove/Transfer confirm ("X is the active 2027 captain; the appointment stays recorded until you end it"); (b) the Leadership section lists every active appointment whose player is **no longer listed at this club** as a diagnostic ("leader not on list — end or void the appointment"). No mutation is triggered by either.
- Bootstrap: 2027 is the first season with authoritative lists (D-2 of 161), so 2027 is the first administrable leadership season. No earlier season is appointable, which is also why `captaincies` remains the historical source (§23).

---

## 10. Season and club eligibility

Identical to 161/162, reused not copied: administrable window `FIRST_LEADERSHIP_SEASON <= S <= max(seasons.year) + 1` via `listSeasonBounds()` / `readListSeasonBounds()` (exported or shared from `admin-season-lists.ts`; the `NODE_ENV=test` ceiling applies unchanged); eligible clubs via `afldb_season_list_clubs(S)` through `resolveClub()`; no `seasons`, `clubs` or `club_seasons` row is ever written. A future season without a `seasons` row is therefore administrable exactly as its list is (W-3 of 161 carried forward).

---

## 11. Uniqueness and overlap invariants (D-6)

| ID | Invariant | Enforcement |
|---|---|---|
| L-1 | role vocabulary closed | CHECK; writer validates before the transaction |
| L-2 | one active appointment per player per season (one role, one club) | `ux_club_leadership_active_player` partial UNIQUE + writer pre-check naming the existing role/club (`duplicate_active`) |
| L-3 | co-captains allowed | no cap; ≥2 active `captain` rows at one club-season is a permitted state. **Server-enforced confirmation:** appointing a `captain` while another `captain` is active at the club-season requires `confirmCoCaptaincy = '1'` in the form, otherwise refusal `co_captaincy_unconfirmed` that names the sitting captain(s) and offers **Replace** — so a replacement can never accidentally become a co-captaincy |
| L-4 | multiple vice-captains allowed | no cap, no confirmation |
| L-5 | valid interval | `club_leadership_dates_ck`; real-calendar validation in the writer |
| L-6 | an active row has no end date | `club_leadership_active_open_ck` |
| L-7 | a void row carries a reason | `club_leadership_void_reason_ck` |
| L-8 | player listed at the club for the season | write-time precondition with `FOR KEY SHARE` (§9); never a FK |
| L-9 | club eligible in the season | `resolveClub()` via `afldb_season_list_clubs` |
| L-10 | season in window | server rule (§10) |
| L-11 | identity never name-derived | `resolvePlayerIdentity`; ambiguous → refuse; identity-less → refuse ("attach/adopt first"), never mint |
| L-12 | every mutation durable and audited | override upsert + `recordDataEdit` in the same transaction; replay pre-check refuses unresolvable payloads |
| L-13 | history preserved | no DELETE anywhere; `ended`/`void` keep the row; `appointment_key` never edited |
| L-14 | status transitions | `active→ended`, `ended→active` (reinstate), `active→void`, `ended→void`; `void` terminal; enforced by the writer under `FOR UPDATE` + CAS, refusal `invalid_transition` |

SQL holds what SQL can state without a clock or a join (L-1, L-2, L-5, L-6, L-7, L-13); the transaction holds the rest.

---

## 12. Mutation contract — end, replace, correct, void (D-7)

All in `src/db/queries/admin-club-leadership.ts`, the ONE writer of `club_leadership` (source-contract test, §24). Every mutation: `requireCapability('data.seasonLists.edit')` in the action; one import-role transaction; preconditions before the first write; `RollbackRefusal` after; `data_edits` row(s); override upsert; returns `revalidatePaths` (§21).

| Operation | Meaning | Row effect | Preconditions | Audit `field_group` |
|---|---|---|---|---|
| `appointLeader({season, clubSlug, playerId, role, startedOn?, note?, confirmCoCaptaincy?})` | a new appointment | INSERT `active`; mint `appointment_key` | window; club eligible; player exists + identity; **listed (L-8)**; no active row for the player this season (L-2); L-3 confirmation for a second captain | `leadership_appointed` |
| `replaceLeader({appointmentKey, expectedUpdatedAt, newPlayerId, effectiveOn?, note?})` | the captain (or a vice-captain) changes | lock K `FOR UPDATE`, CAS; K → `ended`, `ended_on = effectiveOn`; INSERT new `active` same role/club/season, `started_on = effectiveOn`; payloads cross-reference `replaced_by_appointment_key` / `replaces_appointment_key` | K is `active`; new player listed; L-2 for the new player | `leadership_ended` on K + `leadership_appointed` on the new row, sharing `replacement_id` in `new_values` |
| `endAppointment({appointmentKey, expectedUpdatedAt, endedOn?, reason?, note?})` | the office ceased without (or before) a replacement | `active → ended` | CAS; L-5 | `leadership_ended` |
| `reinstateAppointment({appointmentKey, expectedUpdatedAt})` | an end was entered in error | `ended → active`, `ended_on` cleared | CAS; re-runs listed + L-2 (+ L-3 confirmation) | `leadership_reinstated` |
| `correctAppointment({appointmentKey, expectedUpdatedAt, startedOn?, endedOn?, note?})` | a data-entry correction to **evidence** | UPDATE dates/note only | CAS; L-5/L-6; not void | `leadership_corrected` (old/new values) |
| `voidAppointment({appointmentKey, expectedUpdatedAt, reason})` | the record should never have existed | `→ void`, `status_reason` | CAS; not already void; reason mandatory | `leadership_voided` |
| hard delete | — | **never** | — | — |

**Boundaries that are deliberately not edits.** Role, player, club and season are **not correctable**: a wrong one is `void` + a new appointment (two honest records), exactly as a fixture's identity fields are. Void is presented as more severe than End, with distinct wording ("this record should never have existed" vs "this appointment ceased"), never a sibling button (ISSUE-162 §39.2 G).

**Why not 161's DELETE + tombstone.** Leadership rows are the audit subject (§15) and must stay resolvable at a promotion lineage remap; a deleted row's `data_edits` would dangle (the 097:290-309 reasoning). And the brief's four cases (end / replace / correct / void) are all history-preserving; none is "this row never mattered".

---

## 13. Concurrency and transaction contract

| Mutation | Locks | Refused before any write | Post-write refusal |
|---|---|---|---|
| appoint | membership row `FOR KEY SHARE`; partial unique backstop | window, eligibility, identity, listed, L-2, L-3 | partial-unique violation on INSERT → throw → `duplicate_active` |
| replace | K `FOR UPDATE`; new player's membership `FOR KEY SHARE` | CAS, K active, new player listed, L-2 | unique violation → throw |
| end / reinstate / correct / void | K `FOR UPDATE` | CAS, transition, dates | none possible after the lock; any error throws |

No advisory lock is needed: every conflict is either on one locked row or on the partial unique index. `updated_at` is bumped by the writer, not a trigger. Audit or override failure rolls everything back (proved with the 159/160/161 sentinel-trigger strategy, §24).

---

## 14. Refusal vocabulary

`validation` · `not_found` · `stale` · `not_listed` · `duplicate_active` · `co_captaincy_unconfirmed` · `invalid_transition` · `invalid_dates` · `forbidden` · `ambiguous_identity` · `conflict` (identity-less player) · `failed`. Refusals worth auditing (`stale`, `not_listed`, `duplicate_active`, `invalid_transition`, `forbidden`, `ambiguous_identity`) go to `auth_audit_log` as `admin.club_leadership_refused` (best effort, the 160/161 pattern); the action switches on the enum, never on the sentence.

---

## 15. Audit contract

`data_edits.table_name` is widened to **`'club_leadership'`** (migration 098) and the audited row is the appointment itself — the ISSUE-162 shape, because the row is never deleted and it is not a property of any allowlisted parent (an appointment is not a property of the player: it is about a club, a season and an office). Consequences, all mandatory: `DataEditTableName` and `DATA_EDIT_TABLE_NAMES` (`audit-log.ts`), `DATA_EDIT_TABLE_LABELS.club_leadership = 'Club leadership'` (`audit-view.ts`), the `appointment_key` lineage rule and `data_edits` target in `promotion-inventory.ts` (§19), and the audit-viewer link `/admin/audit/entity/club_leadership/<id>` from the admin section. `old_values`/`new_values` carry the full row before/after; `new_values` also carries `entity_key`, and `replacement_id` for the two halves of a replace.

---

## 16. Capabilities (D-10)

**Binding: reuse `data.seasonLists.read` (Admin, Super Admin) and `data.seasonLists.edit` (Super Admin only). No new capability.**

| Consideration | Finding |
|---|---|
| Would a separate `data.clubLeadership.read/.edit` ever admit a different role set? | No. Every `data.<domain>.read` in the table is ADMIN_AND_UP and every `.edit` SUPER_ADMIN_ONLY; there is no fourth role and no per-user delegation except `people.admins.manage`. Two names for one policy is exactly the drift ISSUE-158's source contract exists to prevent |
| Is leadership semantically season-list administration? | Yes: it is a per-club-per-season statement about players on that season's list, administered on the same page, and its precondition *is* the list (§9) |
| Does reuse weaken anything? | No: `.edit` is already "a public fact the moment a consumer ships" (capabilities.ts:101-108) — this issue is that consumer |
| Cost of reuse | zero new entries in `capabilities.ts`, `nav-model.ts`, `EQUIVALENT_ROLE_GUARD`, the nav-order tests, or ISSUE-156 §2; the ISSUE-158 scanner covers the new actions and route automatically |

Public read is the public client (`afldb_app`, `grant_app_read`) and needs no capability. The new revalidate route's `POST` calls `await requireCapability('data.seasonLists.edit')` first (scanner contract). If a later operator decision wants a distinct leadership role set, adding a capability is additive.

---

## 17. Backend query / action API

**`src/db/queries/admin-club-leadership.ts`** (server-only; the one writer):

- constants `LEADERSHIP_ROLES = ['captain','vice_captain'] as const`, `LEADERSHIP_STATUSES = ['active','ended','void'] as const`, `LEADERSHIP_ENTITY_TYPE = 'club_leadership'`, `LEADERSHIP_FIELD_GROUP = 'appointment'`, `FIRST_LEADERSHIP_SEASON = FIRST_LIST_SEASON` (import);
- `leadershipEntityKey(appointmentKey)` (= `manualEntityKey`), result/refusal types (§14), `RollbackRefusal`, `withImportConnection` (the 159 D-2 helper — extract to `src/db/queries/import-connection.ts` only if a fourth copy is unacceptable to the implementer; otherwise the 161/162 local copy);
- mutations of §12;
- reads on the public client: `readClubSeasonLeadership(season, clubSlug)` → every appointment for the club-season (active, ended, void) with `playerSlug`, `displayName`, `listed` (membership exists now), `updatedAt`, ordered `status, started_on NULLS FIRST, created_at`; `readLeadershipOverview(season)` → per eligible club: active captain names, active vice-captain count, `unlistedActive` count; `readLeadershipDiagnostics(season, clubSlug)` (active but not listed; more than one season open for the org);
- `clubPublicPaths(tx, clubId)` → `/clubs/<slug>` for every identity of the organisation (§21);
- import-role read `readLeadershipOverrides(appointmentKey)`.

**`src/db/queries/club-leadership.ts`** (public reads; `server-only`; public client):

- `getClubCurrentLeadership(clubId)` → `{ season, captains: ClubLeader[], viceCaptains: ClubLeader[] } | null` per §8, `ClubLeader = { playerId, playerSlug, displayName, startedOn }`;
- `getClubCaptains()` in `awards.ts` extended with the season-boundary union (§20.3); it keeps its row shape.

**`src/app/admin/season-lists/leadership-actions.ts`** (`'use server'`): `appointLeaderAction`, `replaceLeaderAction`, `endAppointmentAction`, `reinstateAppointmentAction`, `correctAppointmentAction`, `voidAppointmentAction` — capability first, shape-only parsing (`validation.ts` helpers reused), one query call, refusal audit, success audit (`club_leadership.appointed` etc.), `revalidatePaths` from the query result.

**`src/app/admin/season-lists/revalidate/route.ts`**: `POST` → `requireCapability('data.seasonLists.edit')` then `applyRevalidateRequest(request, isAllowedLeadershipRevalidatePath)`; allowlist in `revalidate-paths.ts` (§21).

---

## 18. Admin UI (D-11)

**Binding: a Leadership section on `/admin/season-lists/[season]/[club]`, plus one column on `/admin/season-lists/[season]`. No new route family, no new nav item.**

`/admin/season-lists/[season]/[club]` (existing page; additive):

- member table: `activeLeadershipRole` badge ("Captain" / "Vice-captain") next to the existing Draftee / Awaiting-identity badges; the `MemberActions` confirm text gains the §9 warning line when set;
- **Leadership** section (new `LeadershipPanel.tsx`, server-rendered list + `LeadershipActions.tsx` client controls per row), placed after the member table and before the diagnostics panels: a "Current" list (active rows, grouped Captain(s) / Vice-captain(s), with `started_on` when known and a "not on list" badge when `listed = false`), a collapsed "History" list (ended rows with dates; void rows under a "show voided" toggle with their reason), per-row controls for Super Admin: **Replace…** (captain/vice-captain: choose the incoming player from the list members, optional effective date, note), **End…** (optional date, reason), **Reinstate** (ended rows), **Correct dates/note…**, **Void…** (separate destructive block, mandatory reason, never a sibling of End); Admin sees everything read-only. Audit link per row to `/admin/audit/entity/club_leadership/<id>`;
- **Appoint** panel (`AppointLeaderPanel.tsx`, Super Admin): role radio (Captain / Vice-captain), **player `<select>` over the club's list members only** (the rows the page already loaded — never the global player picker, never free text), optional start date, note; when a captain is already active and role = Captain the panel shows the sitting captain(s) and requires ticking "Appoint as co-captain alongside …" (which sets `confirmCoCaptaincy`) or offers the Replace control instead;
- every submit goes through `useSeasonListActionSubmit` (existing helper) — its reserved endpoint `/admin/season-lists/revalidate` now exists and is actually requested when `revalidatePaths` is non-empty; `focus-restore` semantics come with it.

`/admin/season-lists/[season]` (existing overview; additive): a **Captain** column per club card (active captain name(s), "co-captains" when >1, "—" when none, a warning glyph when an active leader is unlisted) from `readLeadershipOverview(season)`; the subtitle gains "N of M clubs have a {season} captain recorded".

No `/admin/season-lists/[season]/[club]/leadership` route (2–6 rows per club do not justify a page); no cross-club "all captains" admin page beyond the overview column. Responsive/accessibility rules from ISSUE-156 §8 apply (44 px targets, labelled controls, `role="alert"`/`role="status"`, `minWidth: 0` on two-column grids); rendered acceptance is the DEV batch.

---

## 19. Replay / rebuild / promotion contract (D-9, D-15)

**Registry table, rebuilt, replayed — the ISSUE-162 shape.**

`replay_admin_overrides(conn, 'club_leadership')` in `tools/migration/common.py`:

1. **Fail-closed pre-check over every override** with `entity_type = 'club_leadership'` and `field_group = 'appointment'` (all are active): key is `manual_admin_edit:<token>`; token claimed by exactly one override; payload `appointment_key` equals the token; `season` is a 4-digit integer in 1897–2100; `club_slug` resolves to a club whose organisation has an eligible identity in `season` under `afldb_season_list_clubs(season)` (LATERAL, the 096/097 pattern — a rename between dump and replay resolves to the era-correct identity); `player_identity` resolves to **exactly one** player through `external_identities` (`unique`/`resolved`; `afltables:` path or `manual_admin_edit:` token — so the `players` replay must run first); `role` ∈ vocabulary; `status` ∈ vocabulary; dates parse and satisfy L-5/L-6; a void payload carries `status_reason`. Any failure → `RuntimeError` naming the keys, nothing written, batch marked failed. **Membership is not checked** (historical validity, §9).
2. `INSERT … SELECT … WHERE NOT EXISTS (SELECT 1 FROM club_leadership WHERE appointment_key = token)` for every override — **ended and void included**; `source_id = manual_admin_edit`, `source_record_id = appointment_key`. A partial-unique violation (two active payloads for one player-season) surfaces as the error it is — never `ON CONFLICT`.
3. `UPDATE` the carried fields (`role`, `status`, `status_reason`, `started_on`, `ended_on`, `note`, `club_id`, `player_id`, `season`) for existing keys from the payload, `updated_at = now()`.
4. Idempotent: a second run inserts nothing and changes nothing.

**Call sites and order.** `import_fitzroy_core.py` immediately after `replay_admin_overrides(pg, "season_list_members")` (`:3532`); promotion §8 loop becomes `('players', 'matches', 'draft_picks', 'season_list_members', 'club_leadership', 'coaches', 'match_coaches', 'fixtures')` with the ordering note: **binding after `players`** (identity), independent of every other branch (grouped after `season_list_members` for reading order only). `docs/production-promotion.md` §8 text and the promotion-inventory acceptance checklist are extended.

**Promotion inventory (`tools/db/promotion-inventory.ts`).** No `PROMOTION_CONTRACT` entry (registry via `grant_import_write`, else `{kind:'both'}` refuses every phase — R-3, W-8); not a `DERIVED_FOOTBALL_TABLE`; new identity rule `appointment_key: { entity: 'club_leadership', byId, byIdentity }` (the `fixture_key` pair verbatim over `club_leadership`); new `data_edits` lineage target `{ kind: 'club_leadership', entity: 'club_leadership', identity: 'appointment_key' }` with the remediation text extended; every row resolves because no row is ever deleted and the replay re-creates void/ended rows before the remap. `manual-authority.ts` `OVERRIDE_ENTITY_TYPES` += `'club_leadership'` (order-independent proof unchanged: not a settle target).

**Nightly settle** never touches the table (not derived, not a settle target; `rebuild_derived.py` and `settle-afltables.ts` name it nowhere — an exact source contract, §24). **Reference loader**: the table enters the FK-graph `TRUNCATE … CASCADE` closure exactly as 096/097 did and refuses while it holds rows unless `--allow-cascade`; correct, because the replay re-creates every appointment.

**Promotion window**: between the swap and the replay the public club page's Leadership block is absent and the Captains table shows pre-2027 rows only; the promotion record states it, and the post-replay club-page revalidation (all `/clubs/<slug>`) is a listed step (§21).

---

## 20. Public club page (D-12)

### 20.1 Placement

A compact **`ClubLeadership`** block (`src/components/ClubLeadership.tsx`) rendered **directly after the stat strip and before `ReorderableSections`**, only when `isContinuing && club.isCurrent` and `getClubCurrentLeadership(club.id)` returns a non-null result with at least one active row. It is a current fact, not a table: it must be visible without scrolling through reorderable tables, it is not something a reader reorders, and it must not be subject to the localStorage order. Empty → omitted (existing convention; no "unknown" copy, nothing invented).

### 20.2 Rendering

```text
2027 leadership
Captain: Player A                        ← one active captain
Co-captains: Player A · Player B         ← two or more
Vice-captains: Player C · Player D       ← zero, one or more (singular/plural label)
```

Every name is a `Link` to `playerPath(slug, id)`. No dates on the public block (they are admin evidence); no "since round 12". Markup: a `section.section` with an `h2`, a `dl` (role → names) — theme-neutral, no new CSS class beyond what `globals.css` has; JSON-LD unchanged (no schema.org property for captain is worth inventing here).

### 20.3 The existing Captains history table

`getClubCaptains(clubId)` returns the union, one authority per season:

- `captaincies` rows for `season < FIRST_LEADERSHIP_SEASON` (unchanged shape, unlinked rows keep `UnmatchedPlayer`);
- `club_leadership` rows with `role = 'captain'` and `status <> 'void'` for `season >= FIRST_LEADERSHIP_SEASON`, one row per appointment (co-captains → two rows; a replaced captain and the replacement → two rows, the replaced one shown with "to <ended_on>" in the existing free-text `period` slot when a date is known, else blank), `linkStatus = 'unique'`, `id` namespaced so React keys and `UnmatchedPlayer` never collide (`UnmatchedPlayer` is not rendered for canonical rows).

Without this union the page would show a 2027 captain in the Leadership block and a Captains table ending in 2026 — a visible self-contradiction. With it, "historical ended captain is not shown as current" holds (the block reads `active` only) while the history stays complete. The player page's honours list continues to read `captaincies` only — recorded follow-up (§27), not this issue.

### 20.4 Not depending on admin

Both reads use the public client and `grant_app_read`; nothing on the public page imports from `admin-*` modules or touches `data_overrides`.

---

## 21. Cache / revalidation contract (D-13)

| Item | Binding |
|---|---|
| Mechanism | **path-based** `revalidatePath('/clubs/<slug>')` — the repository uses paths everywhere and has no tag scheme; nothing here justifies introducing one |
| Paths | computed **server-side** in the mutation from the affected club's organisation: `/clubs/<slug>` for **every identity** of that organisation (the continuing identity carries the Leadership block; each era page carries the Captains history table, which the union changes). Typically 1–3 paths |
| Where | never inside the Server Action (S-6). The action returns `revalidatePaths`; `useSeasonListActionSubmit` POSTs them to `/admin/season-lists/revalidate` after the action resolves; the route requires `data.seasonLists.edit` and admits only `^/clubs/[a-z0-9-]+$` (`revalidate-paths.ts`, unit-tested) |
| Admin surface | `router.refresh()` (all admin pages `force-dynamic`) — already in the shared helper |
| Not revalidated | `/`, layouts, `/clubs` (index shows no captain), `/players/[slug]` (reads `captaincies` only — unchanged), `/sitemap.xml`, `/seasons/[year]`, any other club's page. No broad revalidation |
| Post-promotion | the §8 runbook gains "after the replay, revalidate `/clubs/<slug>` for every current identity" (or accept the 24 h ISR window, stated in the promotion record) |
| Known limit (recorded, not solved) | on a multi-worker host `revalidatePath` reaches the worker that served the POST; the repository already accepts this for Brownlow/player-links; the DEV acceptance proves the single-worker case, and the memory note `prod-landing-pages-isr-per-worker` describes how to prove it read-only on PROD |

The DEV acceptance for revalidation must use a minted beta cookie for the ISR probe and a control club (the `dev-beta-gate-breaks-isr-measurement` lesson).

---

## 22. Migration plan (D-16)

**One additive migration, expected `098_club_leadership.sql`** (allocated at Stage 1 preflight after the all-refs check):

1. `CREATE TABLE club_leadership` + indexes exactly as §5, with table/column comments stating the semantic definition (§4), "never deleted", "never hand-edited outside `admin-club-leadership.ts`", and the `captaincies` coexistence rule (§3).
2. `data_overrides.entity_type` CHECK → `(… 'season_list_members', 'fixtures', 'club_leadership')`, every literal retained verbatim; the three settle targets still absent; the 095/096/097 comment.
3. `data_edits.table_name` CHECK → `(… 'coaches', 'fixtures', 'club_leadership')`, every literal retained.
4. `SELECT afldb_meta.grant_app_read('club_leadership'); SELECT afldb_meta.grant_import_write('club_leadership');`.
5. No backfill, no trigger, no `privileges.sql` edit, no change to `captaincies`, `season_list_members`, `afldb_season_list_clubs()` or `afldb_identity_for_season()`.

Deploy order (binding, DEV batch): migrations 096 → 097 → **098** → `npm run db:privileges` → code. App read is fail-closed until privileges reconcile (ISSUE-027/039). Rollback = disable the section/actions/route; table, overrides and audits stay (forward-only).

---

## 23. Historical data and backfill policy (D-14)

| Class | What exists | Decision |
|---|---|---|
| **A. Authoritative data already in AFLDB** | none for the canonical model. `captaincies` is a curated **external** import (source `wikipedia`, name-keyed, `Captain` only, free-text periods, no vice-captains, 30 co-captain annotations, one 1952 Hawthorn captain with no identity recorded outside the manifest) | keep as the historical honours source for seasons < 2027; do not convert in this issue |
| **B. External sources** (AFL Tables, Wikipedia, club sites) | reconciliation aids only | never a live dependency; no scraping; may feed a future controlled import under its own `source_id` |
| **C. Operational data through Admin** | begins with the 2027 appointments | the canonical feature starts forward from `FIRST_LEADERSHIP_SEASON = 2027` |

Rules:

- No migration backfill; no bulk "seed 2027 captains from 2026 captaincies" action (the 2026 rows are `Captain`-only Wikipedia facts about 2026, not 2027 appointments).
- The admin Appoint panel may show a read-only hint "2026 captain(s) per the honours record: …" from `captaincies` (organisation-scoped) as **candidate information only**, labelled non-authoritative; every appointment is an explicit decision. (Optional in Stage 2; harmless because it writes nothing.)
- `captaincies.py` `MAX_SEASON` must stay `< FIRST_LEADERSHIP_SEASON`; source-contract test (§24). Curating 2027+ rows into the CSV would create two authorities for one season and is refused by that test until the follow-up conversion decides the direction.
- Follow-up (separate issue): controlled conversion of `captaincies` into `club_leadership` rows under `source_id = wikipedia`, `source_record_id = <source_key>`, `status = 'ended'`, dates NULL, with identity resolution through `external_identities`; then retire the union and the `captaincies` readers. The schema needs no change for it (source columns, no season FK, `import_batch_id`).

---

## 24. Test matrix (D-17)

No existing suite is a semantic home for leadership mutations; following the 160/161/162 precedent, two new files plus extensions.

| Area | Home | Proves |
|---|---|---|
| Pure / contract | **new** `tests/admin-club-leadership-actions.test.ts` | role/status enumerations; key shape `manual_admin_edit:<uuid>`; date validation (real calendar, `2027-02-30` refused, interval rule); transition table (L-14); refusal shapes; `revalidatePaths` computed server-side and never client-supplied; the revalidate allowlist admits `/clubs/richmond` and refuses `/clubs/../x`, `/players/…`, `/`, query strings; the capability guard is the first statement of every action and of the route (also covered generically by `tests/auth.test.ts`) |
| Schema / invariants (`afldb_test`) | **new** `tests/integration/admin-club-leadership.test.ts` (marker `AFLDB-ISSUE-163-TEST`, seasons `maxYear+1`/`+2` via the existing test ceiling, memberships created through the 161 API, cleanup in `afterAll`, `AFLDB_IMPORT_DATABASE_URL` redirected as the 161 suite does) | valid appointment; player not listed → `not_listed`; listed at the wrong club → `not_listed` naming the right club; invalid role → CHECK/validation; invalid interval → refused and CHECK; duplicate active (same player, second role / second club) → `duplicate_active` and the partial unique holds under a forced race; co-captain overlap allowed with confirmation, refused without; multiple vice-captains allowed; captain + vice-captain for one player refused; `void` requires a reason; `active` with `ended_on` impossible |
| Admin auth | `tests/auth.test.ts` (generic scanner + `EQUIVALENT_ROLE_GUARD` unchanged) | every new action/route guard-first; Admin read-only, Admin action → redirect; Super Admin edit; Contributor and unauthenticated denied; nav lists unchanged |
| Appoint | integration | captain; second captain with confirmation (co-captains); vice-captain; `started_on` NULL stored as NULL |
| Mid-season change | integration | replace: old row `ended` with `ended_on`, new row `active` with `started_on`, both preserved, audits share `replacement_id`; `readClubSeasonLeadership` and `getClubCurrentLeadership` show the replacement only; the union shows both in history |
| Correction / void | integration | correct dates/note only (role/player immutable); void keeps the row, needs a reason, is excluded from current, from the union and from the partial unique; void is terminal; reinstate `ended → active` re-runs listed + L-2 |
| Durability | integration, spawning the **real** `replay_admin_overrides(pg, 'club_leadership')` (the 161 python pattern) | after deleting the canonical rows the replay re-creates active, ended **and void** rows with the same keys; second run is a no-op; ambiguous player identity fails the whole batch closed and writes nothing; missing player fails closed; unresolvable club fails closed; membership absence does **not** fail replay (historical validity) |
| Promotion | `tests/db-promotion-check.test.ts` extend (`:1069, 1105-1109, 1305, 1312` shape) | table classified registry, no `PROMOTION_CONTRACT` entry, `assertContractCoherent()` holds; `data_edits` target `club_leadership → appointment_key` present; identity rule `byId`/`byIdentity` present; checklist mentions the table |
| Settle authority / entity lists | `tests/current-season-import.test.ts` (`:3664-3723`), manual-authority suite | CHECK literal list and `OVERRIDE_ENTITY_TYPES` both include `club_leadership`; `overrideScopeProvenFrom()` unchanged in both deploy orders |
| Source contracts | `tests/data-overrides-source-contract.test.ts` extend | exactly one `INSERT INTO club_leadership` in `src/` and it is `admin-club-leadership.ts`; the replay branch has the fail-closed pre-check strings and `NOT EXISTS`, no `ON CONFLICT`; `rebuild_derived.py` / `settle-afltables.ts` / `DERIVED_FOOTBALL_TABLES` never name the table; **`captaincies.py` `MAX_SEASON < FIRST_LEADERSHIP_SEASON`** |
| Reference / FK | `tests/reference-data.test.ts` (derived), `tests/integration/fk-indexes.test.ts` (automatic) | new table registered; every FK indexed |
| Public | integration suite | `getClubCurrentLeadership`: one captain / co-captains / vice-captains separately / null when nothing active / ended captain absent / historical era identity gets the same org answer; `getClubCaptains` union: pre-2027 rows unchanged, 2027 canonical captain rows present, void absent, vice-captains absent; player links resolvable (`playerSlug`, `playerId` non-null) |
| Revalidation | pure + integration | `revalidatePaths` for a Richmond appointment = `['/clubs/richmond']`; for an organisation with three identities = the three era slugs; another club's slug never present; route ignores disallowed paths and returns `revalidated: []` |
| Regression | `admin-season-list-actions`, `integration/admin-season-lists` (the additive `activeLeadershipRole` column must not change any existing assertion), `admin-fixture-actions`, `integration/admin-fixtures`, `admin-draft-actions`, `integration/admin-draft`, `auth`, `integration/club-comparison-route`, `edit-spec`, `player-link-mutations` | ISSUE-160/161/162, capability model, club page queries, coaches/premierships/records untouched, promotion/replay contracts |
| UI (deferred to the DEV batch) | Playwright, three roles × 320/768/1000/1280/1920 | Leadership section, confirm flows, focus restore, badges not hover-only, the public block on `/clubs/richmond` with a minted beta cookie before and after an appointment (ISR proof with a control club), no overflow, console/network clean |

Gates: `npx tsc --noEmit`, ESLint over every changed file, `git diff --check`, and the suites above. No full-suite run is requested while iterating.

---

## 25. Performance

≤ ~6 rows per club-season, ~100 per season, a few thousand over a decade. The public block is one indexed query (`ix_club_leadership_club_season` by organisation identities); the union adds one indexed branch to `getClubCaptains`. Admin pages: one query for the section, one for the overview column. No caching beyond the page's own ISR.

---

## 26. Staged implementation plan

**Stage 1 — data model, mutation contract, replay, promotion, integration tests (Opus 5, high).** Preflight (`npm run preflight -- --mode implementation --issue 163`; `git log --all -- 'src/db/migrations/098*'` empty → allocate 098); migration 098 (§22); `src/db/queries/admin-club-leadership.ts` (§12–§14, §17) and `src/db/queries/club-leadership.ts` + the `getClubCaptains` union (§20.3); additive `activeLeadershipRole` column in `readClubSeasonList`; `common.py` replay branch + `LEADERSHIP_ROLES`/`LEADERSHIP_STATUSES` frozen enumerations + `import_fitzroy_core.py` call site; `promotion-inventory.ts` (identity rule, `data_edits` target, checklist); `audit-log.ts`, `audit-view.ts`, `manual-authority.ts`; `docs/production-promotion.md` §8; `tests/integration/admin-club-leadership.test.ts` and the contract-suite extensions; `npx tsc --noEmit`. Ends when every Stage 1 row of §24 is green on `afldb_test`. **Stop conditions:** W-2 (replay not exact), W-8 (classification refusal), any need to write `seasons`/`clubs`/`club_seasons`, any change to a 161 invariant, any FK to `season_list_members`.

**Stage 2 — admin section, public club page, revalidate route, unit tests (Fable 5.1, high).** `leadership-actions.ts`, `revalidate/route.ts` + `revalidate-paths.ts`, `LeadershipPanel.tsx`, `LeadershipActions.tsx`, `AppointLeaderPanel.tsx`, the club-page badge + `MemberActions` warning, the overview Captain column; `src/components/ClubLeadership.tsx` and the `/clubs/[slug]` placement; `tests/admin-club-leadership-actions.test.ts`; `tests/auth.test.ts` runs unchanged (generic scanner); `CHANGELOG.md`; issue/index updates; Playwright deferred to the DEV batch.

No Stage 3.

---

## 27. Explicit out-of-scope (follow-ups, each its own issue if pursued)

- Player-page leadership history from canonical rows (the honours list keeps reading `captaincies`).
- A public all-time captains encyclopedia page; per-season "all captains" public page.
- Converting `captaincies` into `club_leadership` (§23) and retiring the union / the `captaincies` readers / the player-links target.
- Any external scraping or import pipeline for leadership; reconciliation views.
- Match-level "captain for this game" (would join the lineup domain, ISSUE-100 territory).
- Brownlow / awards changes; `award_winners.is_captain` (representative teams).
- Fixture administration (ISSUE-162), coach administration (ISSUE-159), season-list contract changes (ISSUE-161 D-1…D-8 stand).
- Leadership groups, acting-captain roles, ceremonial roles.
- NL search ("who is Richmond's captain"), Grid Solver axes, `/clubs/compare`, club index page.
- Tag-based revalidation or any change to ISR windows.
- DEV update, PROD, deployment, merges.

---

## 28. Dependencies on ISSUE-160 / 161 / 162 (D-18)

| Dependency | Nature |
|---|---|
| ISSUE-161 | **hard**: `season_list_members` (precondition L-8), `afldb_season_list_clubs()`, `FIRST_LIST_SEASON`, `listSeasonBounds`, `resolveClub`, the `/admin/season-lists/**` pages and `submit-helper.ts` (the reserved endpoint), `data.seasonLists.*`; one additive column in `readClubSeasonList` and one warning line in `MemberActions` |
| ISSUE-160 | `resolvePlayerIdentity` / `player-identity.ts`, the `players` replay ordering, the D-9 shared `action-submit.ts` / `revalidate-route.ts` |
| ISSUE-162 | the lifecycle / minted-key / whole-row / never-delete precedent and the `data_edits` lineage-target shape; the calendar-date validator; no code dependency on `fixtures` |
| Batch | ISSUE-163 ships **in the same Admin Centre DEV batch** (160 + 161 + 162 + 163); it is the first item with public output, so the combined acceptance gains: the public club page before/after an appointment, the Captains history union, and the revalidation proof (§21). Migrations 096 → 097 → 098 → `db:privileges` → code. Nothing merges first; PROD follows the ISSUE-151/155 contract separately, with the §19 replay-order and post-replay revalidation notes |

---

## 29. Risks and mitigations

| ID | Risk (from the brief) | Disposition |
|---|---|---|
| R-1 | effective dates when only a season/round is known | dates optional, NULL = unknown; round in `note`; "current" never reads a date (§7) |
| R-2 | co-captain overlap | permitted by design; server-enforced confirmation prevents an accidental co-captaincy when a replacement was meant (L-3) |
| R-3 | player transferred mid-season (161 transfer) | appointment stays (historical validity); "leader not on list" diagnostic + confirm warning; admin ends it explicitly (§9) |
| R-4 | player removed from the list after leadership exists | same as R-3; no FK, no cascade, no silent mutation |
| R-5 | block/warn list removal? | **warn, never block** — 161's contract untouched |
| R-6 | club identity changes | rows carry the identity eligible in S; reads are organisation-scoped; replay resolves slug → era-correct identity via `afldb_season_list_clubs` (same tail risk as 162 §37.5 once the register passes S — recorded) |
| R-7 | season-list replay order vs leadership replay | leadership replay depends only on `players`; membership is not re-checked; documented binding order `players → club_leadership` |
| R-8 | future seasons without a `seasons` row | no FK; window `max(year)+1`; identical to 161/162 |
| R-9 | club-page current-season determination | data-derived `max(non-void season)` per organisation, season shown in the label (§8) |
| R-10 | cache invalidation after a change | per-organisation club paths, capability-gated route, unit + integration + DEV proof (§21); per-worker limit recorded |
| R-11 | public club queries assuming played seasons only | `getClubCurrentLeadership` reads no `club_seasons`/`matches`; the union reads none; 2027 renders with zero matches |
| R-12 | display-name changes | rows carry `player_id`; names are joined at read time; the override carries the identity string, never the name |
| R-13 | promotion ordering across 096/097/098 | additive, independent migrations in number order; 098's CHECK widenings retain every literal; `db:privileges` after all three |
| R-14 | `captaincies` reload collision / double authority | new table, no shared key; `MAX_SEASON < 2027` pinned by test; union by season boundary (§3, §20.3) |
| R-15 | the same person appointed at two clubs in one season | L-2 partial unique + `not_listed` (161's `UNIQUE (season, player_id)` already makes it impossible to be listed at two) |
| R-16 | `revalidatePath` from an action (S-6 hang) | none: route + browser follow-up only (§21) |
| R-17 | `ReorderableSections` order breaking with a new section | not touched: the Leadership block sits outside it; the Captains section id is unchanged |
| R-18 | identity-less legacy player captain | refused with the attach/adopt remedy (161 W-12) |
| R-19 | `data_edits` target obligation missed | pinned by `db-promotion-check` (the 160 D-3 defect class) |
| R-20 | unclassified table refuses promotion (R-3 of 151) | registry via the migration; classification test at Stage 1; **stop** if `{kind:'both'}` or unclassified |

---

## 30. Operator decisions — RECOMMENDED 2026-09-12, pending sign-off

| ID | Decision | Recommendation |
|---|---|---|
| **D-1** | Canonical schema/table | new registry table `club_leadership` (§5); `captaincies` untouched and retained as the pre-2027 historical source; no `players` flag; no flag on `season_list_members` |
| **D-2** | Role vocabulary | `captain`, `vice_captain`; co-captaincy = concurrent `captain` rows; no `co_captain`, no `acting`/`interim`, no ceremonial roles (§6) |
| **D-3** | Effective period | lifecycle `status` (`active`/`ended`/`void`) + optional `started_on`/`ended_on` dates, NULL = unknown; no rounds; "current" = status, never a clock (§7) |
| **D-4** | Current leadership | organisation-scoped `max(non-void season)`; active rows of that season; omitted when none active; "Co-captains" when >1 captain; vice-captains listed separately; no block on era pages (§8) |
| **D-5** | Season-list invariant | appoint/replace/reinstate require the player's current membership at that club-season (locked `FOR KEY SHARE`); no FK; not re-checked on replay; list removal/transfer **warns**, never blocks; first season 2027 (§9) |
| **D-6** | Overlap constraints | partial UNIQUE `(season, player_id) WHERE status='active'`; co-captains and multiple vice-captains unconstrained in count; server-enforced co-captain confirmation (§11) |
| **D-7** | End / correction / void | `end` (→ended), `replace` (end + appoint, one transaction), `correct` (dates/note only), `reinstate` (ended→active), `void` (terminal, reason mandatory); **no hard delete, no tombstones** (§12) |
| **D-8** | Durable key | minted `appointment_key` UUID; override key `manual_admin_edit:<appointment_key>`; whole-row payload with club slug + player identity; `is_active` always true (§5) |
| **D-9** | Replay rules | fail-closed pre-check, `NOT EXISTS` insert of every row incl. ended/void, field UPDATE, idempotent; after `players`; membership not re-checked (§19) |
| **D-10** | Capability | reuse `data.seasonLists.read` / `.edit`; no new capability; revalidate route guarded by `.edit` (§16) |
| **D-11** | Admin location | Leadership section + Appoint panel on `/admin/season-lists/[season]/[club]`; Captain column on `/admin/season-lists/[season]`; no new route family or nav item (§18) |
| **D-12** | Public placement | compact `ClubLeadership` block after the stat strip, outside `ReorderableSections`, continuing current identity only; Captains history table extended by the season-boundary union (§20) |
| **D-13** | Revalidation | path-based, `/clubs/<slug>` for every identity of the affected organisation, computed server-side, POSTed to the capability-gated allowlisted `/admin/season-lists/revalidate` after the action; nothing else (§21) |
| **D-14** | Historical backfill | none; forward from 2027; `captaincies` frozen at `MAX_SEASON` 2026 by test; Wikipedia→canonical conversion is a separate follow-up (§23) |
| **D-15** | Promotion/rebuild | registry classification (no contract entry), `appointment_key` lineage rule + `data_edits` target, `OVERRIDE_ENTITY_TYPES`, §8 loop + post-replay club revalidation note (§19) |
| **D-16** | Migration number | **098**, allocated at Stage 1 preflight after the all-refs check (§22) |
| **D-17** | Testing gates | §24: two new suites, contract extensions incl. `captaincies.py MAX_SEASON` pin, real Python replay, revalidation allowlist, public query proofs; Playwright in the DEV batch |
| **D-18** | Rollout dependency | stacked on 162; ships in the combined 160+161+162+163 DEV batch; migrations 096→097→098→`db:privileges`→code; the batch acceptance gains the public club-page and revalidation checks (§28) |

Technical questions resolved from evidence and **not** put to the operator: table name and columns beyond D-1's shape, refusal vocabulary (§14), audit subject and field groups (§15), the additive 161 column/warning (§9), the Appoint panel's list-only player select (§18), display ordering (§7), the JSON-LD non-change (§20.2), the two-stage split (§26).

---

## 31. Final report

1. **Current state:** AFLDB already holds `captaincies` — 1,774 Wikipedia rows (1897–2026), `Captain` only, name-keyed natural uniqueness, `season` FK to the register, free-text periods, no vice-captains, no lifecycle — rendered today on club pages (history table) and player pages (honours) and targeted by player-links and the promotion inventory with identity `'none'`. No vice-captain, co-captain, leadership, current-captain or admin surface exists. Season lists (161), the identity module (160) and the fixture lifecycle/durability shape (162) are all in place on this branch.
2. **Captaincy model exists?** Yes, as a historical honours import; **not** as canonical operational truth. Extending it fails on the season FK, the name-keyed uniqueness, the reload-collision refusal, the frozen row-count gates and the missing lifecycle (§3).
3. **Schema:** new registry `club_leadership` (§5), one migration (098), no changes to `captaincies` or `season_list_members`.
4. **Public club page:** compact current-leadership block for the continuing identity + the Captains history union from 2027; player links always available; omitted when nothing is active (§20).
5. **Admin:** Leadership section and Appoint panel on the existing season-list club page; Captain column on the season overview; player selection restricted to the club's list members (§18).
6. **Durability/replay:** minted `appointment_key`, whole-row always-active override, fail-closed replay re-creating ended and void rows, `data_edits` on the appointment with an `appointment_key` lineage rule, registry classification (§19).
7. **Historical data:** no backfill; forward from 2027; `captaincies` frozen below 2027 by a source-contract test; conversion is a follow-up (§23).
8. **Architecture:** §1; **D-1…D-18** binding recommendations in §30.
9. **Migration:** §22. **API:** §17. **Admin UI:** §18. **Public UI:** §20. **Revalidation:** §21. **Auth:** §16. **Replay/promotion:** §19. **Tests:** §24. **Stages:** §26. **Risks:** §29. **Out of scope:** §27. **Dependencies:** §28.
10. **Worktree/branch:** `D:\dev\afldb-issue-163`, `opus/issue-163-club-leadership` (already cut from `f80a1df`).
11. **Commit checkpoints:** (1) `Plan AFLDB-ISSUE-163 club leadership administration` — this runbook + ledger/index (operator commits); (2) `Implement AFLDB-ISSUE-163 Stage 1 leadership backend` — migration 098, queries, replay, promotion, integration tests; (3) `Implement AFLDB-ISSUE-163 Stage 2 leadership admin and club page` — section, panels, route, public block, unit tests, CHANGELOG; (4) `Finalize AFLDB-ISSUE-163 club leadership` — local audit fixes and tracking, mirroring 161/162.
12. **Ready for implementation?** **Yes, once the operator signs off D-1…D-18** (no decision in §30 is blocked on evidence; none requires a DEV/PROD probe). Opening prompt for Stage 1: `Execute AFLDB-ISSUE-163 Stage 1 according to AFLDB-ISSUE-163.md` from `D:\dev\afldb-issue-163` on `opus/issue-163-club-leadership`; first actions are the preflight and the migration-098 all-refs check. No DEV, no PROD, no merge, no deploy.

---

## 32. Stage 1 implementation record — 2026-09-12 (Opus 5 high)

Built from this runbook after the operator signed off D-1…D-18. **Nothing was run**: no shell,
Git, SQL, test, lint, typecheck, DEV or PROD command was executed (CLAUDE.md §9/§12), so every
claim below is about what the repository now *contains*, never about what passed.

### 32.1 Operator clarifications, and what each one changed

| # | Clarification | Effect on the build |
|---|---|---|
| 1 | D-10 capability reuse approved; no leadership-specific capability | Nothing in Stage 1 declares a capability. Stage 2 guards its actions and route with `data.seasonLists.edit` as planned |
| 2 | D-12 approved with a **hard** source boundary: legacy ≤ 2026, canonical ≥ 2027, never both, no duplicate/conflicting truth across the transition | The boundary is a `WHERE` clause on **each branch** of each union, and the constant is declared **once** (`FIRST_LEADERSHIP_SEASON` in `club-leadership.ts`, derived from `FIRST_LIST_SEASON`). Nothing de-duplicates by name anywhere |
| 3 | Lifecycle/date consistency must be explicit; NULL means unknown, never a fake boundary | `club_leadership_active_open_ck` puts "an active row carries no end date" in **SQL**; the writer refuses the same contradiction with `invalid_dates`; the replay refuses it as `'an active appointment cannot carry an end date'`. `club_leadership_dates_ck` and the writer's real-calendar validator hold the interval. No date is ever defaulted |
| 4 | Player honours must not develop a 2027+ hole | **Implemented in Stage 1**, not deferred — see §32.7. This is the one deliberate departure from the runbook's §27, which had listed player-page leadership as a follow-up |

### 32.2 Migration 098

Allocated as `src/db/migrations/098_club_leadership.sql`. The all-refs check was done with native
repository search over the working tree: there is no `src/db/migrations/098*` file, and every
textual "098" match is this runbook, planning prose, or the unrelated issue id `AFLDB-ISSUE-098`.
**The `git log --all -- 'src/db/migrations/098*'` half of §26's preflight is an operator command
and was not run** — it is listed in §32.11 so the operator closes that half before committing.

Contents exactly as §22: the canonical table with its CHECKs and indexes and full table/column
comments; `data_overrides.entity_type` and `data_edits.table_name` widened with every existing
literal retained verbatim and the three settle targets still absent; `grant_app_read` +
`grant_import_write`. No backfill, no trigger, no `privileges.sql` edit, and no change to
`captaincies`, `season_list_members`, `afldb_season_list_clubs()` or `afldb_identity_for_season()`.

### 32.3 Schema and invariants as built

`club_leadership` is §5 verbatim. The three CHECKs are `club_leadership_dates_ck` (end ≥ start),
`club_leadership_active_open_ck` (clarification 3) and `club_leadership_void_reason_ck`, plus
`club_leadership_source_record_uq`. The partial `UNIQUE (season, player_id) WHERE status='active'`
carries three decisions at once and the migration says so: co-captains are unaffected (they are
different players, and there is deliberately **no** index on `(season, club_id, role)` that would
make co-captaincy unrepresentable); ended and void rows leave the index, so a re-appointment later
in the same season is a new record and a mid-season replacement keeps both rows; and one player
cannot hold two active appointments in any combination of role and club.

### 32.4 The writer

`src/db/queries/admin-club-leadership.ts` — the ONE writer, pinned by a source-contract test.
`appointLeader`, `replaceLeader`, `endAppointment`, `reinstateAppointment`, `correctAppointment`,
`voidAppointment`. Each is one `AFLDB_IMPORT_DATABASE_URL` transaction; every precondition runs
before the first write and returns a refusal; every refusal discovered after a write throws a
`RollbackRefusal`. `FOR UPDATE` + `updated_at` compare-and-swap on the appointment; `FOR KEY SHARE`
on the season-list membership, which is what stops a concurrent ISSUE-161 removal committing in the
gap between the check and the write. Role, player, club and season are **not** correctable: a wrong
one is `void` plus a new appointment. The refusal vocabulary is §14 as written.

### 32.5 Season, club and future-season handling

The administrable window is `readListSeasonBounds()` — ISSUE-161's own function, now exported and
**shared, not copied**, so leadership can never precede the lists and the two can never drift.
Club eligibility is `afldb_season_list_clubs()`, the one rule 161 introduced and 162 reused; no
second future-club rule exists. No `seasons`, `clubs` or `club_seasons` row is read as a
requirement or written at any point, so a 2027 appointment works exactly as a 2027 list does.

### 32.6 Public read model

`src/db/queries/club-leadership.ts` (public client, no admin imports, no `data_overrides`) owns the
single boundary constant and `getClubCurrentLeadership(clubId)`: organisation-scoped
`max(non-void season)`, then that season's `active` rows, captains and vice-captains separate, all
co-captains returned, `null` when nothing is active. `getClubCaptains()` in `awards.ts` is now the
season-boundary union; canonical ids are **negated** so they can never collide with a
`captaincies.id`; void rows never appear, ended rows do (with `to <date>` in the existing free-text
period slot when the date is known), vice-captains never do.

### 32.7 Player honours — clarification 4, implemented

`getPlayerHonours()`'s captaincy query is the same union under the same boundary: `captaincies`
rows below 2027, canonical `role='captain'`, `status <> 'void'` rows from 2027, DISTINCT by
(season, club), rendered with the identical `'Captain'` literal the legacy table stores. The player
page groups `honours.captaincies` by club slug and never reads `role`, so **2027+ captaincies
render with no Stage 2 change at all**. No `captaincies` row is written, no name is matched, and
nothing is duplicated at the boundary. Vice-captaincies are excluded — a vice-captain who was never
captain must not appear as one. The canonical half is a branch of the same query rather than a
second function, because one query owning both halves is the only way the boundary cannot drift.
§27's "player-page leadership history from canonical rows" is therefore **delivered** for
captaincies; what remains a follow-up is a richer per-player leadership history (vice-captaincies
as their own honour).

### 32.8 Durability, replay and audit

Whole-row `data_overrides` keyed `manual_admin_edit:<appointment_key>`, `field_group='appointment'`,
`is_active` **always true**, payload naming the club by SLUG and the player by IDENTITY STRING and
carrying `replaces_appointment_key` / `replaced_by_appointment_key` across a replace.
`replay_admin_overrides('club_leadership')` in `common.py` fails closed over every override before
anything is written (key shape, single claimant, payload/token agreement, season range, role,
status, void reason, both date formats, interval order, active-with-end-date, club slug resolved to
the era-correct identity through `afldb_season_list_clubs`, identity resolved to exactly one
player), then `NOT EXISTS` inserts active, ended **and** void rows and applies an unconditional
whole-row UPDATE. It never deletes, never `ON CONFLICT`s, never moves `appointment_key`, and
**never reads `season_list_members`** — the §9 distinction, implemented exactly, which is also what
leaves no ordering cycle with 161. Call site: `import_fitzroy_core.py` after `players` (binding) and
after `season_list_members` (reading order only). `data_edits` is written against the appointment
itself with the five field groups of §15.

### 32.9 Promotion

`appointment_key` added to `LineageIdentityRule`, `LINEAGE_IDENTITY_SQL` and the module header; the
`{kind:'club_leadership', entity:'club_leadership', identity:'appointment_key'}` target added to
`data_edits`'s `lineageRefs` with the remediation text extended; the acceptance-checklist replay
line and `docs/production-promotion.md` §8 both name the table, its ordering, its no-membership-
recheck rule and the post-replay club-page revalidation note. Registry classification only: no
`PROMOTION_CONTRACT` entry (which would be `{kind:'both'}` and refuse every phase), not a
`DERIVED_FOOTBALL_TABLE`, `OVERRIDE_ENTITY_TYPES` and `PINNED_FOOTBALL_TABLES` widened.

### 32.10 ISSUE-161 relation

One additive read-only column, `activeLeadershipRole`, in `readClubSeasonList()`. No 161 invariant,
action, refusal or contract changed; removal and transfer remain permitted and are not blocked.
`readLeadershipDiagnostics()` and `readLeadershipOverview().unlistedActive` surface an active leader
who is no longer listed, as a diagnostic that triggers no mutation.

### 32.11 Operator validation — the exact commands, in order

```bash
# 1. Close the migration-number check this session could not run
git log --all -- 'src/db/migrations/098*'          # expect: no output

# 2. afldb_test ONLY. Nothing here may point at afldb_dev or afldb_prod.
npm run db:migrate -- --database afldb_test        # applies 098
npm run db:privileges -- --database afldb_test     # app read is fail-closed until this runs

# 3. Types, then the contract suites (no database needed)
npx tsc --noEmit
npx vitest run tests/data-overrides-source-contract.test.ts tests/db-promotion-check.test.ts \
               tests/current-season-import.test.ts

# 4. Integration, against afldb_test (AFLDB_TEST_DATABASE_URL), incl. the real Python replay
npx vitest run tests/integration/admin-club-leadership.test.ts

# 5. The stacked regressions this Stage 1 touched
npx vitest run tests/integration/admin-season-lists.test.ts tests/integration/admin-fixtures.test.ts \
               tests/admin-season-list-actions.test.ts tests/auth.test.ts

# 6. Lint the changed files, and check whitespace
npx eslint src/db/queries/admin-club-leadership.ts src/db/queries/club-leadership.ts \
           src/db/queries/admin-season-lists.ts src/db/queries/awards.ts \
           src/db/queries/audit-log.ts src/lib/audit-view.ts \
           src/lib/acquisition/manual-authority.ts tools/db/promotion-inventory.ts \
           tests/integration/admin-club-leadership.test.ts
git diff --check
```

Run the migration commands with the DSN convention this repository already uses for `afldb_test`;
the integration suite redirects `AFLDB_IMPORT_DATABASE_URL` to `AFLDB_TEST_DATABASE_URL` itself.

### 32.12 Known limitations carried into Stage 2

1. **`getClubCaptains` React keys.** The club page keys its captains rows on
   `${season}-${playerName}`. Two canonical appointments for the SAME player in the same season
   (ended, then re-appointed) would collide. Stage 2 should key on the row `id`, which is already
   unique and already negated for canonical rows. No data problem; a rendering one.
2. **Replay club-identity tail risk.** The replay resolves a club slug through
   `afldb_season_list_clubs(season)`, so once the register passes the appointment's season the
   historical arm applies — the same recorded tail risk as ISSUE-162 §37.5, unchanged.
3. **`readClubSeasonList` now reads `club_leadership`.** The season-list club page therefore needs
   migration 098 applied before it renders. That is the binding deploy order already (096 → 097 →
   098 → `db:privileges` → code), but it does mean the ISSUE-161 integration suite will not pass on
   a database without 098.
4. **Per-worker `revalidatePath`.** Unchanged and recorded in §21; Stage 2's route inherits it.
5. **Stage 2 is untouched.** No action, route, panel or public component exists yet, so nothing is
   user-visible and no capability scanner surface changed.

### 32.13 Stop conditions

None fired. 098 did not collide; no change to `captaincies` was needed; player honours support the
hard boundary with no architectural change; no FK to `seasons` was required; co-captains are
representable with the role model unchanged; the replay order has no cycle with
`season_list_members`; durability needs no display-name identity; public revalidation stayed
per-organisation; ISSUE-161 was not weakened; no new capability; nothing writes `matches` or
statistics; no external source dependency.

---

## 33. Stage 2 implementation record — 2026-09-12 (Sonnet 5 high)

### 33.0 Stage 2 — interrupted checkpoint (session lockout, 2026-09-12)

**The session approached its usage limit during final self-verification, after the implementation
work below was written.** This subsection is the accurate save-point; the rest of §33 documents what
was actually built and, by the author's own line-by-line re-reading, is internally coherent — but it
has **not been confirmed by any tool run** (no `tsc`, no test, no lint), which was always deferred to
the operator under CLAUDE.md §9, and the very last file in the change set
(`tests/admin-club-leadership-actions.test.ts`) had one re-read pass rather than two. Treat every
claim in §33 as "written and self-reviewed," not "gated."

- **Implemented (by inspection, all six files/panels present and internally consistent):** the six
  Server Actions in `leadership-actions.ts`; the revalidate route + allowlist; `LeadershipPanel.tsx`,
  `LeadershipActions.tsx`, `AppointLeaderPanel.tsx`, `leadership-labels.ts`; the `[season]/[club]`
  page integration (badge, section placement, candidate list); the `[season]` overview Captain
  column; the public `ClubLeadership.tsx` block and its `clubs/[slug]/page.tsx` wiring; the
  Captains-table React-key fix; the `MemberActions.tsx` §9 warning line; the `submit-helper.ts`
  `LeadershipActionState` addition; the new pure test file; the CHANGELOG/issues.md/IssuesIndex.md/
  `AFLDB-ISSUE-156.md` tracking updates.
- **Partially implemented:** nothing is mid-edit or half-written. The one thing this session did
  **not** finish is verification: no command was run against any of it, and the final read-through
  pass (re-reading every touched file after all edits, to catch cross-edit mistakes a single
  edit-time review misses) covered `submit-helper.ts`, `MemberActions.tsx`, both `season-lists`
  pages, `clubs/[slug]/page.tsx`, `LeadershipPanel.tsx`, `LeadershipActions.tsx`,
  `AppointLeaderPanel.tsx` and the new test file, but did **not** re-read `leadership-actions.ts`,
  `leadership-labels.ts`, `revalidate-paths.ts` or `revalidate/route.ts` a second time after their
  initial write (no edits were made to them after creation, so they are expected to match what is
  quoted earlier in this document, but that expectation is unconfirmed by a fresh read).
- **Not started:** DEV/PROD deploy, migration apply, any Git operation, Playwright/browser
  acceptance, the operator's local completion audit pass (the kind ISSUE-161/162 each had before
  being called code-complete).
- **Known defects/TODOs:** none identified. Two real defects were found and fixed *during* this
  session's own writing (not left open): the Correct form originally did not pre-fill the row's
  existing `endedOn`/`note`, which would have silently blanked them on save (fixed — see §33's
  "Replace, End, Void, Correct" paragraph); a redundant filter expression in `LeadershipActions.tsx`
  (`c.activeLeadershipRole === null || true`) was simplified. Nothing is known to be wrong; nothing
  has been proven right by a tool, either.
- **Tests not yet run:** `tests/admin-club-leadership-actions.test.ts` (new, pure layer),
  `tests/auth.test.ts` (unmodified, but its scanner now walks the new boundary), `npx tsc --noEmit`,
  ESLint over every Stage 2 file. Stage 1's own gates (§32.11) are also still outstanding and are a
  precondition.
- **Next implementation step for the next session:** read this §33.0 checkpoint, then run the
  §33's own "Operator validation" command block below (after Stage 1's §32.11 gates pass first).
  Fix whatever `tsc`/the new test file/ESLint find — expect small issues, not architectural ones,
  since nothing here touched schema, replay, promotion or capability shape. Do not re-plan or
  re-architect anything absent a real failure.
- **DEV/PROD:** both untouched. No migration applied anywhere. No command executed.

---

Built against the committed Stage 1 backend contract (§17, §12, §20.3, §32) after reading this
runbook, `AFLDB-ISSUE-161.md`, `AFLDB-ISSUE-162.md`, `CHANGELOG.md`, `IssuesIndex.md` and `issues.md`.
**Nothing was run**: no shell, Git, SQL, test, lint, typecheck, DEV or PROD command was executed
(CLAUDE.md §9/§12), so every claim below is about what the repository now *contains*, never about
what passed. No stop condition (§26 Stage 1 list; the ten conditions in the Stage 2 execution brief)
fired: the Leadership section fit the existing club-season page cleanly, no new capability was
needed, revalidation never widened past the affected organisation's own club paths, the public
current-leadership block and the Captains history union both came from Stage 1's existing queries
unchanged, player honours needed no further change (§32.7 already delivered it), the season overview
needed no duplicated captain truth (`readLeadershipOverview` is the one source), every Server Action
is a thin wrapper over the Stage 1 mutation contract with no direct SQL, and nothing about mobile
usability required a wider Admin redesign.

**Files added:** `src/app/admin/season-lists/leadership-actions.ts` (the six Server Actions —
`appointLeaderAction`, `replaceLeaderAction`, `endAppointmentAction`, `reinstateAppointmentAction`,
`correctAppointmentAction`, `voidAppointmentAction`, each `requireCapability('data.seasonLists.edit')`
first); `src/app/admin/season-lists/revalidate/route.ts` + `revalidate-paths.ts` (the reserved
endpoint, now actually requested — admits only `^/clubs/[a-z0-9-]+$`); `LeadershipPanel.tsx` (Current/
History/void-toggle, per-row audit links, the Appoint panel); `LeadershipActions.tsx` (Replace/End/
Correct/Void/Reinstate per appointment); `AppointLeaderPanel.tsx` (role radio, list-only player
`<select>`, the co-captaincy confirm step); `leadership-labels.ts` (role/status display strings);
`src/components/ClubLeadership.tsx` (the public block); `tests/admin-club-leadership-actions.test.ts`
(pure layer — see below for what it does and does not cover).

**Files changed:** `src/app/admin/season-lists/[season]/[club]/page.tsx` (leadership badge in the
member table, `LeadershipPanel` placed after the member table and before the "Played but not listed"/
"Departed" diagnostics, per §18); `MemberActions.tsx` (the §9 warning sentence on Remove/Transfer when
the member holds an active appointment); `[season]/page.tsx` (the Captain column, reading
`readLeadershipOverview` directly, with an "unlisted active leader" marker); `submit-helper.ts`
(`LeadershipActionState` adds an optional `reason` field carrying the backend's refusal enum, so a
panel can special-case `co_captaincy_unconfirmed` without parsing the sentence; the reserved-endpoint
comment updated now that it is requested); `src/app/clubs/[slug]/page.tsx` (`ClubLeadership` rendered
after the stat strip and before `ReorderableSections`, gated on `isContinuing && club.isCurrent`, and
the Captains table's React key changed from `${season}-${playerName}` to the row's own `id` — the
§32.12 known limitation, now fixed).

**Candidate selection (§18).** Both the Appoint panel and each row's Replace control take their
candidate list from `readClubSeasonList()`'s own rows — the exact page load, never a second query and
never the global player picker — with each candidate's current `activeLeadershipRole` annotated so an
operator sees a collision coming before submitting.

**Co-captaincy confirmation (§11, L-3).** Appoint and Reinstate submit with no `confirmCoCaptaincy`
field the first time. A `co_captaincy_unconfirmed` refusal — which already names the sitting
captain(s) — is rendered as a distinct follow-up action ("Appoint as co-captain alongside them" /
"Confirm co-captaincy and reinstate anyway" / "…and replace anyway") that resubmits with
`confirmCoCaptaincy` set to the literal string `'1'`. There is no checkbox that defaults to checked
and no path that sets the field without the operator having seen the refusal first.

**Replace, End, Void, Correct (§12).** Replace previews the consequence in a sentence before
submitting and never edits `playerId` on the existing row. End and Void are visibly separate: Void
lives in its own destructive block with mandatory reason text distinguishing "ceased" from "should
never have existed" (mirroring `LifecyclePanel.tsx`'s fixture wording exactly), and is not offered on
a void row at all — `LeadershipActions` returns `null` for `status === 'void'`. Correct exposes only
dates and note, pre-filled from the row's own current values (a defect caught and fixed while writing
this: an unfilled End-date field on Correct would otherwise have silently cleared an already-recorded
end date on save).

**CAS/stale handling (§13).** Every mutation sends the row's `updatedAt` as `expectedUpdatedAt`; a
`stale` refusal surfaces as a plain message with no silent retry and no automatic reload.

**Audit links.** Every appointment row links to `/admin/audit/entity/club_leadership/<id>` — the
generic viewer's existing route/id convention (`coaches/[id]`, `fixtures/[fixtureKey]`), no new page.

**Revalidation (§21).** `leadership-actions.ts` returns the mutation's own server-computed
`revalidatePaths` (never assembled here); `useSeasonListActionSubmit` posts them to
`/admin/season-lists/revalidate` exactly as the generic `useAdminActionSubmit` helper already does for
every other domain. Every other season-list action (add/remove/transfer/copy-forward) still returns
`revalidatePaths: []` and therefore never calls the route at all.

**Auth/capabilities.** No new capability. `data.seasonLists.read` renders the whole Leadership section
and the Captain column read-only; `data.seasonLists.edit` additionally renders every control. The
generic `tests/auth.test.ts` scanner (unmodified) covers the new route and all six actions because
each begins with an awaited `requireCapability()` call, matching every other domain's shape exactly.

**Responsive/accessibility.** No wide table for the Leadership section's mutation controls — each
appointment is a stacked block of inline controls that wrap at narrow widths; the History list is a
plain `<ul>`/`<details>`, not a table. Every `<select>`/date input/text input carries a wrapping
`<label>` or an explicit `aria-label`; success/refusal messages use `role="status"`/`role="alert"`.
Rendered proof at 1440×900/375×812 is deferred to the combined DEV Playwright pass, per the execution
brief and §18/§24 — source inspection is not browser proof and is not claimed as one.

**Tests.** `tests/admin-club-leadership-actions.test.ts` is new and covers the pure layer only: the
`appointment_key` shape and its parser, the closed role/status vocabularies, `normaliseLeadershipDates`
(real-calendar rejection, the interval rule, never a fabricated default), and the Stage 2
`revalidate-paths.ts` allowlist (admits `/clubs/<slug>` only; refuses a traversal attempt, another
domain's public page, a query string, and a scheme-qualified URL). It deliberately does **not** re-prove
that a mutation refuses before any write for `not_listed`/`duplicate_active`/`co_captaincy_unconfirmed`,
or that `revalidatePaths` is computed server-side rather than trusted from the caller — both require
driving `admin-club-leadership.ts` through `resolvePlayerIdentity()` (a second module with its own SQL
shape), and both are already exercised end-to-end against a real database by Stage 1's
`tests/integration/admin-club-leadership.test.ts`; a shallow mock here would be a weaker second copy of
that proof, not an additional one. `tests/auth.test.ts` needs no change to cover the new boundary (its
generic capability scanner walks `src/app/admin` itself). No Stage 1 test file was touched.

**Known limitations carried forward.** §32.12 item 1 (React keys) is now fixed. Items 2 (replay
club-identity tail risk) and 4 (per-worker `revalidatePath`) are unchanged and belong to Stage 1/§21.
The one new Stage 2 observation: the season overview's Captain column and the club-season page's own
Leadership section both call `readLeadershipOverview` / `readClubSeasonLeadership` independently on
every request (no shared cache) — acceptable at the documented scale (§25, ≤6 rows/club-season) and
not a correctness issue.

**Deviations from §30.** None. Every D-1…D-18 decision was implemented as decided; the Stage 2 scope
boundary from the execution brief (no migration/schema change, no replay/promotion change, no new
capability, no historical backfill, no player-page redesign, no match-level captaincy, no DEV/PROD
deploy) was kept exactly.

**Stop conditions encountered.** None (see the paragraph opening this section for each of the ten by
name).

**DEV/PROD status.** Both untouched throughout. No migration applied anywhere; no command executed.

**Operator validation — the exact commands, in order.** Stage 1's own validation (§32.11) is a
precondition and has not been run; do that sequence first. Then, for Stage 2 specifically:

```bash
npx tsc --noEmit
npx vitest run tests/admin-club-leadership-actions.test.ts
npx vitest run tests/auth.test.ts
npx eslint src/app/admin/season-lists/leadership-actions.ts src/app/admin/season-lists/revalidate/route.ts \
           src/app/admin/season-lists/revalidate-paths.ts src/app/admin/season-lists/LeadershipPanel.tsx \
           src/app/admin/season-lists/LeadershipActions.tsx src/app/admin/season-lists/AppointLeaderPanel.tsx \
           src/app/admin/season-lists/leadership-labels.ts src/app/admin/season-lists/MemberActions.tsx \
           src/app/admin/season-lists/submit-helper.ts \
           "src/app/admin/season-lists/[season]/[club]/page.tsx" "src/app/admin/season-lists/[season]/page.tsx" \
           src/components/ClubLeadership.tsx "src/app/clubs/[slug]/page.tsx"
git diff --check
```

Ready for operator validation once Stage 1's own gates (§32.11) are green. **ISSUE-163 remains OPEN**:
neither stage has been run, gated, committed or merged, and the combined 160+161+162+163 DEV
deployment and rendered Playwright acceptance are still ahead (§28).

---

### 33.1 Stage 2 — second-session re-verification (2026-09-12, Sonnet 5 high, resumed after §33.0)

**Closes the §33.0 interrupted checkpoint.** This session made no code change. Its task was to
re-read every Stage 2 file a second time (including the four §33.0 flagged as not yet re-read —
`leadership-actions.ts`, `leadership-labels.ts`, `revalidate-paths.ts`, `revalidate/route.ts` — plus
the panels, both season-list pages, the public club page, `ClubLeadership.tsx` and the test file) and
compare every behaviour against §30 D-1…D-18 and the Stage 1 contract, per CLAUDE.md §9 with **no
shell, Git, SQL, test, lint, typecheck, DEV or PROD command executed**.

**Result: no defect found.** By inspection, every claim in §33 holds against the current file
contents: the six Server Actions each `requireCapability('data.seasonLists.edit')` first; the
revalidate route additionally enforces the same capability on itself (not just the preceding action)
before calling `applyRevalidateRequest`, and its allowlist (`revalidate-paths.ts`) is anchored
(`^/clubs/[a-z0-9-]+$`) and server-computed inside `admin-club-leadership.ts`'s `clubPublicPaths()`,
never client-supplied; the Correct-form pre-fill fix from §33.0 is real (`LeadershipActions.tsx`
initialises `correctStartedOn`/`correctEndedOn`/`correctNote` from the row's own current values, so
an untouched field resubmits unchanged rather than clearing); co-captaincy is never confirmed
silently for Appoint or Reinstate (`appointLeader`/`reinstateAppointment` both gate on
`role === 'captain' && !confirmCoCaptaincy` via `sittingCaptains()`); Void is reason-required,
confirmation-required and rendered as `null` for an already-void row; the season overview Captain
column reads `readLeadershipOverview()` directly and never includes vice-captains; the public
`ClubLeadership` block is gated on `isContinuing && club.isCurrent` and omits itself when both arrays
are empty; the Captains history union (`getClubCaptains` in `awards.ts`) keys on the row's own id
(negated for canonical rows), excludes void, and the 2027+ half of `getPlayerHonours` independently
excludes vice-captains and void the same way; `tests/admin-club-leadership-actions.test.ts` genuinely
covers the key shape, vocab, date validation and the revalidate allowlist, including refusing a
traversal attempt, a query string and a scheme-qualified URL.

**One observation, not a defect: dead code in `LeadershipActions.tsx`'s Replace flow.**
`replaceLeader()`'s contract (`ReplaceLeaderInput`) has no `confirmCoCaptaincy` field and its
implementation never calls `sittingCaptains()` — only `appointLeader` and `reinstateAppointment` do.
This is architecturally correct: Replace ends the outgoing row and inserts the incoming one for the
same role/club in one transaction, so the active headcount for that role never increases and a
genuinely new co-captaincy can never result from it (only `duplicate_active`, if the incoming player
already holds an active appointment elsewhere, can refuse it). But the Replace panel still renders a
`replace.state.reason === 'co_captaincy_unconfirmed'` branch (a "Confirm co-captaincy and replace
anyway" button) that can never be reached, because the backend never returns that reason for Replace.
It causes no wrong behaviour — the branch is simply unreachable — so this was left as an observation
rather than an edit: touching it was not required to close verification, and CLAUDE.md's scope
discipline (§13) counsels against incidental cleanup during a verification-only pass. Worth removing
whenever Replace is next touched for another reason.

**Not run, still operator-reserved (CLAUDE.md §9):** `npx tsc --noEmit`, both listed `vitest run`
targets, the listed `eslint` invocation, `git diff --check`, and Stage 1's own §32.11 gates (still the
precondition). The exact commands are unchanged from the block above this subsection.

**DEV/PROD:** both untouched. No migration applied anywhere. No command executed this session either.

**ISSUE-163 remains OPEN.** Stage 2 is implementation-complete and internally re-verified twice by
inspection (§33 first pass, §33.1 second pass); it has not been confirmed by any tool. Next action is
the operator validation command block above, Stage 1's gates first.

---

## 34. Final local audit — 2026-09-12 (Opus 5 high)

Run after the operator's own Stage 1 and Stage 2 validation passed (§32.11 and §33's block: migration
098 applied to `afldb_test`, `db:privileges:test`, `tsc` green, 390/4-skipped contract suites, 37/37
`tests/integration/admin-club-leadership.test.ts` including the real Python replay, 367/367 stacked
regressions, 254/4-skipped current-season, 150/150 `admin-club-leadership-actions` + `auth`, ESLint,
`git diff --check`). The audit itself executed **no** shell, Git, SQL, test, lint, typecheck, DEV or
PROD command (CLAUDE.md §9/§12): it is a source audit of migration 098, the writer, the public reads,
the replay, the promotion classification, all six Server Actions, the revalidate boundary, both admin
pages, the four panels, the public block and both test layers against §30 D-1…D-18.

### 34.1 Verdicts

Backend integrity, lifecycle/CAS, co-captaincy, replacement, the season-list invariant,
replay/durability, the public source boundary, player honours, Server Action/auth, revalidation
security, Admin UI and public UI **all hold as specified**. Specifically confirmed by reading the
code, not the record: the three CHECKs and the partial unique index match every writer assumption;
`editAppointment()` locks, compare-and-swaps, runs every precondition before the first write and
throws (never returns) afterwards; `appointLeader`/`reinstateAppointment` are the only two paths that
consult `sittingCaptains()`, and both gate on `role === 'captain' && !confirmCoCaptaincy`;
`replaceLeader()` ends and inserts in one transaction with `FOR UPDATE` on the outgoing row and
`FOR KEY SHARE` on the incoming player's membership; `resolvePlayerIdentity()` writes nothing, so no
pre-write refusal can commit a partial mutation through `postgres.js`'s resolve-to-commit rule; the
replay reads `season_list_members` nowhere and re-creates ended and void rows; `getClubCaptains()`,
`getPlayerHonours()` and `getClubCurrentLeadership()` filter by `FIRST_LEADERSHIP_SEASON` on each
branch and exclude `void`, and only the captain branches reach a captain history; every action calls
`requireCapability('data.seasonLists.edit')` as its first statement and every confirmation is parsed
as the literal `'1'`; `revalidatePaths` is only ever the mutation's own server-computed value and is
posted only when `result.ok`; the audit link's `club_leadership.id` is the row id `recordDataEdit()`
wrote.

### 34.2 Defects found and fixed (Stage 2 only — no backend, schema or replay change)

| # | Severity | Defect | Fix |
|---|---|---|---|
| 1 | Medium | `AppointLeaderPanel` replaced its whole form with a receipt on success, so appointing a captain and then two vice-captains — the normal case — cost a page reload each time. It followed `MemberActions`' terminal-message shape, which is right only because a removed member's row disappears | Follow the `AddPlayerPanel` precedent instead: render the success notice inline and leave the form standing |
| 2 | Medium | After a `co_captaincy_unconfirmed` refusal, the panel's ONLY submit control was "Appoint as co-captain alongside them", which resubmits with `confirmCoCaptaincy='1'` — so changing the player or role and pressing it spent a confirmation that had been asked about a different appointment | The confirm step is now bound to the exact `(role, playerId)` that was refused; changing either withdraws it and the plain Appoint button returns |
| 3 | Low | `LeadershipActions`' Replace flow rendered a `co_captaincy_unconfirmed` branch the backend can never produce (`ReplaceLeaderInput` has no such field and `replaceLeader()` never calls `sittingCaptains()`), offering an operator a consequence the server cannot deliver — the §33.1 observation | Branch removed, `submitReplace` reduced to one argument, and the module header now states WHY Replace has no confirm step, so it is not re-added |

Backend replacement semantics were **not** altered to make defect 3 reachable, as the brief required.

### 34.3 Tests added

Three narrow cases in the existing `tests/admin-club-leadership-actions.test.ts` (no new file, no
whole-file regex assertion): `parsePositiveInt` never turns a blank, zero or junk field into a
number (the `Number('')` hazard, on the parser all three leadership id/season fields use);
`optionalText`/`requiredText` read an omitted optional field as absent, which is what lets a blank
date mean "unknown" rather than a default; and `club_leadership` is an accepted `data_edits` entity
with a label, so the `/admin/audit/entity/club_leadership/<id>` link every leadership row renders can
never silently become a 404 if the allowlist is narrowed.

### 34.4 Findings recorded, NOT fixed

1. **`insertAppointment()`'s audit `new_values` omits `entity_key`.** The edit path adds it through
   `auditIdentity()`; the appoint/replace-insert path writes the payload plus `auditExtra` only. §15
   says `new_values` "also carries `entity_key`", so this is a real inconsistency — but the value is
   `'manual_admin_edit:' + new_values.appointment_key`, which every row already carries, and the fix
   is in Stage 1 code whose expensive integration gate has just passed. Recommended as a one-line
   change the next time `admin-club-leadership.ts` is opened, re-gated with §32.11's integration run.
2. **The public Captains table never renders the `period` column.** `getClubCaptains()` computes
   `'to <ended_on>'` for an ended canonical row exactly as §20.3 describes, but the club page's
   `SortableTable` has only Season / Captain / Played as — and always has, so the 1,774 legacy
   free-text periods are not rendered either. Consequence: co-captains and a mid-season replacement
   appear as two undifferentiated rows for one season. Not a regression and not a data problem;
   adding a Period column is a public-table design change, so it is a follow-up, not an audit fix.
3. **The replay validates date SHAPE, not the calendar.** The pre-check regex admits `2027-02-30`,
   which would then fail at `::date` as a cast error naming no key rather than as a listed refusal.
   Unreachable through the writer (`isRealCalendarDate()` refuses it before an override is ever
   written) and still fails closed — the batch aborts and nothing is committed — so this is a
   diagnostic-quality limitation, recorded rather than fixed, because closing it means editing the
   replay and re-running Stage 1's integration gate.
4. **A successful per-row mutation leaves `LeadershipActions` showing a terminal message** until the
   page is reloaded, so a second action on the SAME appointment needs a reload. Deliberately left:
   the panel's Correct form pre-fills from props captured at mount, so re-offering the controls after
   a `router.refresh()` would re-introduce exactly the silently-cleared-end-date defect §33.0
   records fixing. The reload is the safe behaviour, and rows other than the mutated one are
   unaffected.
5. `readLeadershipDiagnostics()` is exported and integration-tested but no page calls it — the club
   page surfaces the same fact through `readClubSeasonLeadership()`'s per-row `listed` flag and the
   overview's `unlistedActive` count. Harmless; left in place as the §9 diagnostic API.

### 34.5 Deviations from §30, stop conditions, DEV/PROD

**Deviations from D-1…D-18: none.** No stop condition fired: no migration redesign, no inconsistency
between D-1…D-18, no public-boundary change, no backend replacement redesign, no new capability, no
weakening of the ISSUE-161 contract, no second migration, no player-honours schema change, and
nothing required a DEV deployment to decide correctness. **DEV and PROD both untouched; no migration
applied anywhere; no command executed.**

### 34.6 Operator re-validation — Stage 2 only

Only `src/app/admin/season-lists/AppointLeaderPanel.tsx`,
`src/app/admin/season-lists/LeadershipActions.tsx` and
`tests/admin-club-leadership-actions.test.ts` changed (plus tracking). No schema, query, replay,
promotion or capability file was touched, so **Stage 1's expensive suites do not need re-running**:

```bash
npx tsc --noEmit
npx vitest run tests/admin-club-leadership-actions.test.ts
npx vitest run tests/auth.test.ts
npx eslint src/app/admin/season-lists/AppointLeaderPanel.tsx \
           src/app/admin/season-lists/LeadershipActions.tsx \
           tests/admin-club-leadership-actions.test.ts
git diff --check
```

**ISSUE-163 stays OPEN**: the combined 160+161+162+163 DEV deployment, the rendered Playwright/browser
acceptance (§24's UI row) and PROD promotion are all still ahead (§28).

*Superseded 2026-09-12 by §35.*

---

## 35. Resolution — 2026-09-12 (combined Admin Centre DEV acceptance)

**Status:** Resolved. Closed on the operator's DEV acceptance of the combined Admin Centre batch
(ISSUE-160 + 161 + 162 + 163). PROD untouched; no PROD validation is claimed. This closeout changed
tracking only: none of the §34.4 findings was implemented here.

### 35.1 What reached DEV

- `main` at `3272434`: Stage 1 and Stage 2 (`8ed32b3`, `c28ea60`, `ea9f3dd`; §32.11 and §33.1
  gates green), the §34.2 audit fixes and the batch-wide responsive commits `e638d61`, `9727ad5`,
  `ae3c4e0`, `aeb41f3`.
- DEV database: migration 098 applied in the binding order 096 → 097 → 098 →
  `npm run db:privileges` → code. Production build PASS, 1533/1533 static pages; `afldb.service`
  healthy; `/api/health` `status=ok`, `database=ok`.

### 35.2 §24's deferred UI row — closed

- Functional acceptance PASS for: captain; co-captain (the server-enforced confirmation);
  vice-captain; replace; end; reinstate; correct; void; the season-overview Captain column; public
  club-page revalidation through `/admin/season-lists/revalidate`; and the player-honours
  integration (a 2027+ captaincy as an honour).
- Architecture as deployed: legacy `captaincies` answers seasons before 2027 and `club_leadership`
  is canonical from 2027; roles `captain` / `vice_captain`; co-captains as concurrent captain rows;
  the `active` / `ended` / `void` lifecycle; season-list membership as the write-time
  precondition; Admin read / Super Admin edit through `data.seasonLists.*`; the public source
  boundary maintained.
- Responsive/design acceptance PASS at 1440 / 1024 / 768 / 375 (the Leadership section's stacked
  controls at 375), global navigation PASS, accessibility/focus spot checks PASS, no blocking
  console/runtime errors. Widths ran under the operator's device-priority decision of 2026-09-12
  (laptop/desktop primary, iPad/tablet first-class, phone functional fallback) rather than the
  320 / 768 / 1000 / 1280 / 1920 set §24 named; the operator directed that the batch is not held
  open for phone-only cosmetic polishing.

### 35.3 §34.4 findings — disposition (none is a closure blocker; none was implemented)

| # | Finding | Disposition |
|---|---|---|
| 1 | `insertAppointment()`'s audit `new_values` omits the derivable `entity_key` (§15 says it carries it) | **Follow-up (backlog).** A one-line change in `admin-club-leadership.ts` the next time it is opened, re-gated with §32.11's integration run. Every row already carries the key and the edit path already audits it. |
| 2 | The public Captains table renders no `period` column, so co-captains and a mid-season replacement read as two undifferentiated rows for one season | **Follow-up (public-table design; §27's "its own issue if pursued").** Pre-existing for the 1,774 legacy rows; not a regression, not a data problem. |
| 3 | The replay validates date shape, not the calendar (`2027-02-30` fails at `::date` rather than as a listed refusal) | **Follow-up (diagnostic quality).** Unreachable through the writer, still fails closed; fix together with item 1. |
| 4 | A successful per-row mutation leaves `LeadershipActions` showing a terminal message until reload | **Deliberate** (§34.4 item 4 — protects the Correct form's pre-filled dates); closed. |
| 5 | `readLeadershipDiagnostics()` is exported and integration-tested but no page calls it | **Deliberate** (§9 diagnostic API; the pages surface the same fact through `listed` / `unlistedActive`); closed. |
| 6 | The revalidation allowlist is shape-based (`/clubs/<slug>`-shaped paths, computed server-side) | **Designed contract** (§21, §24); recorded, closed. |

Items 1–3 are listed on the `AFLDB-ISSUE-156` umbrella's follow-up list; no issue ID is allocated
until one is pursued.

### 35.4 Carried forward (not closure conditions)

- PROD promotion under the ISSUE-151 contract (§19; `club_leadership` replayed after `players`;
  the `appointment_key` lineage rule), recorded on the `AFLDB-ISSUE-156` umbrella's promotion
  checklist.
- §27 out-of-scope items unchanged: the Wikipedia → canonical conversion of `captaincies`,
  player-page leadership history from canonical rows, a public captains encyclopedia, external
  leadership imports, match-level captaincy, NL / Grid Solver exposure.

---

<!-- afldb-merge-readiness
{"status": "ready", "hardBlockers": [], "expectedFiles": ["src/db/migrations/098_club_leadership.sql", "src/db/queries/admin-club-leadership.ts", "src/db/queries/club-leadership.ts", "src/db/queries/admin-season-lists.ts", "src/db/queries/awards.ts", "src/db/queries/audit-log.ts", "src/lib/audit-view.ts", "src/lib/acquisition/manual-authority.ts", "tools/migration/common.py", "tools/migration/import_fitzroy_core.py", "tools/db/promotion-inventory.ts", "docs/production-promotion.md", "tests/integration/admin-club-leadership.test.ts", "tests/data-overrides-source-contract.test.ts", "tests/db-promotion-check.test.ts", "tests/current-season-import.test.ts", "src/app/admin/season-lists/leadership-actions.ts", "src/app/admin/season-lists/leadership-labels.ts", "src/app/admin/season-lists/revalidate-paths.ts", "src/app/admin/season-lists/revalidate/route.ts", "src/app/admin/season-lists/LeadershipPanel.tsx", "src/app/admin/season-lists/LeadershipActions.tsx", "src/app/admin/season-lists/AppointLeaderPanel.tsx", "src/app/admin/season-lists/MemberActions.tsx", "src/app/admin/season-lists/submit-helper.ts", "src/app/admin/season-lists/[season]/[club]/page.tsx", "src/app/admin/season-lists/[season]/page.tsx", "src/components/ClubLeadership.tsx", "src/app/clubs/[slug]/page.tsx", "tests/admin-club-leadership-actions.test.ts", "AFLDB-ISSUE-163.md", "AFLDB-ISSUE-156.md", "issues.md", "IssuesIndex.md", "CHANGELOG.md"], "validation": ["Stage 1 built 2026-09-12 (Opus 5 high) with NO command run: no shell, Git, SQL, test, lint, typecheck, DEV or PROD execution. Migration 098 has been applied to no database.", "Stage 2 built 2026-09-12 (Sonnet 5 high) with NO command run: no shell, Git, SQL, test, lint, typecheck, DEV or PROD execution.", "Operator validation 2026-09-12, both stages GREEN (§34 preamble): migration 098 applied to afldb_test + db:privileges:test; tsc; 390 passed / 4 skipped contract suites; 37/37 tests/integration/admin-club-leadership.test.ts incl. the real Python replay; 367/367 stacked regressions; 254 / 4 skipped current-season; 150/150 admin-club-leadership-actions + auth; ESLint; git diff --check", "DEV acceptance 2026-09-12 (combined Admin Centre batch, main 3272434): 096 -> 097 -> 098 -> db:privileges -> code; production build PASS, 1533/1533 static pages; afldb.service healthy; /api/health status=ok database=ok", "Rendered acceptance 2026-09-12: captain / co-captain / vice-captain / replace / end / reinstate / correct / void / overview Captain column / public club-page revalidation / player honours PASS; responsive 1440/1024/768/375 PASS", "RESOLVED 2026-09-12 (AFLDB-ISSUE-163.md §35); §34.4 items 1-3 carried as follow-ups"]}
-->
