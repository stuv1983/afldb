# AFLDB-ISSUE-161 — Season list administration: authoritative club playing lists per season (ISSUE-156 P3c)

**Status:** **RESOLVED 2026-09-12.** Stage 1 (`97af605`), Stage 2 (`1441a5b`), the §33.5 audit fix and the batch-wide responsive fixes (`e638d61`, `9727ad5`, `ae3c4e0`, `aeb41f3` — the last one this issue's own Season Lists mobile overflow) are in `main` at `3272434`, deployed to DEV with migration 096 applied and privileges reconciled, and accepted there in the browser on 2026-09-12 as part of the combined Admin Centre batch (160 + 161 + 162 + 163): functional add/remove/transfer/copy-forward workflows, usable 2027 club lists, Admin (read) / Super Admin (edit) permissions, desktop and tablet layout, and the final mobile acceptance at 375px — the record is **§34**. The D-3 evidence gate passed (§32); **operator decisions D-1…D-8 DECIDED 2026-09-11 (§30)** and implemented as decided; the fixtures boundary (§9.4, §27) held throughout (2027 had no fixture and every mutation worked). PROD untouched; no PROD validation is claimed. The pre-closeout history below (§1–§33.5) is retained as written.
**Severity:** Medium
**Area:** Admin / Data management / Player–club–season model / Promotion lineage
**Created:** 2026-09-11
**Parent:** `AFLDB-ISSUE-156` (umbrella) — supplemental child **P3c**, inserted after P3b (`AFLDB-ISSUE-160`); P4–P12 keep their labels
**Stacked on:** `AFLDB-ISSUE-160` (branch `opus/issue-161-season-lists` cut from `opus/issue-160-draft-admin` at `1295d3d`, which contains both ISSUE-160 stages and the Stage 2 closure). ISSUE-160 is **not** merged first; both are deployed to DEV together as the Admin Centre batch (§26).
**Migration:** **one required** (§22). Highest migration on this branch is `095_coach_admin_overrides.sql`; the next free number is **096** on 2026-09-11. It is *not* allocated here — Stage 1 allocates it at its implementation preflight after re-running `git log --all -- 'src/db/migrations/096*'`.
**Planning model:** Fable 5.1, high. **Recommended implementation:** Stage 1 Opus 5 high (schema, replay, promotion, transactions); Stage 2 Fable 5.1 high (UI, capabilities, tests).

This document is a planning deliverable. Every repository fact below was verified natively on this branch on 2026-09-11 and must be re-verified at each stage's preflight. No shell, Git, SQL or deployment command was run while producing it.

---

## 1. Executive summary

AFLDB has **no concept of a club's playing list**. Every player–club relationship it holds is
derived from matches actually played: `player_clubs`, `player_club_season_stats`,
`player_season_stats`, `player_career_stats` and `club_seasons` are all `TRUNCATE`-and-rebuilt by
`tools/migration/rebuild_derived.py` from `player_match_stats` and `matches` (§2). A player who is
listed but has not played has no club anywhere in the model, and "current player" is not a
question any query answers today.

ISSUE-161 adds **one canonical, admin-authored table — `season_list_members`** (one row = *this
player is on this club's list for this season*) — with the same durability shape ISSUE-159 and
ISSUE-160 established: the canonical row is an ordinary registry-table row; the durable record is a
`data_overrides` row keyed by a **natural, rebuild-stable key** (`<club_slug>|<season>|<player
identity>`); every mutation is one import-role transaction that also writes `data_edits`; a
fail-closed `replay_admin_overrides('season_list_members')` branch re-creates the rows on any
rebuilt or promoted database. Removal is an audited `DELETE` whose inactive override is a
**tombstone** that no importer or replay may resurrect. "Retired" is never stored: it is the absence
of a membership in the current list season (§8).

The season boundary problem ISSUE-160 hit (a club identity is not "active" in `max(seasons.year)+1`
because `clubs.last_season` is loaded from `data/reference/seasons.json`) is solved **without touching
the reference register**: for a season at or beyond the register's last season, the eligible clubs
are exactly the identities with `is_current_afl_club = true` (§9, D-6). ISSUE-161 does **not**
create `seasons`, `clubs` or `club_seasons` rows — all three are owned by other machinery and two of
them are derived or rebuilt (§9.2).

Two stages: Stage 1 = migration + query contract + replay + promotion classification + integration
tests; Stage 2 = `/admin/season-lists/**`, capabilities `data.seasonLists.read`/`.edit`, nav, the
ISSUE-160 handoff link, browser acceptance deferred to the Admin Centre DEV batch. No public
consumer changes are required for correctness; they are enumerated as follow-ups (§10).

---

## 2. Current-state evidence (Planning Question 1)

| Fact | Where |
|---|---|
| `player_clubs` is **DERIVED**: `TRUNCATE player_clubs; INSERT … SELECT player_id, club_id, count(*), sum(goals), min(season), max(season) … FROM pg_ctx GROUP BY player_id, club_id` — one row per (player, club identity) with ≥1 match played. Comment: `'DERIVED. Historical club identities represented by each player.'` | `src/db/migrations/007_derived_stats.sql:126-141`; `tools/migration/rebuild_derived.py:90-107` |
| ISSUE-152 measured **0** zero-game `player_clubs` memberships (F-D4) — the table cannot represent a listed-but-never-played player | `issues/open/AFLDB-ISSUE-152.md:5574-5581, 5798` |
| `player_club_season_stats` is **DERIVED**, one row per player × season × club with games ≥ 1; "a mid-season transfer produces two rows" | `015_brownlow_grain_and_coverage.sql:83-94`; `rebuild_derived.py:148-165` |
| `player_season_stats` is **DERIVED**, player × season grain, `primary_club_id` = club of most games, "display convenience only" | `015:99-150` |
| `player_career_stats`, `players.debut_season/final_season`, `clubs_played` are derived from matches | `007:63-124`; `002:142-145`; `rebuild_derived.py:256-289`; `src/db/queries/player-derived.ts:270-341` |
| `club_seasons` is **DERIVED from `matches`** (ISSUE-095 D7), rebuilt by `rebuild_derived.py` (`ORDER` includes `club_seasons`), cross-checked by set equality against the tracked ladder witness at rebuild stage 8.5, and gated by `CLUB_SEASONS_EXPECTED.rows` (a reviewed constant the rollover planner rewrites). `played/wins/draws/losses/points_for/points_against` are `NOT NULL` — an unplayed season is structurally unstorable | `006:55-80`; `rebuild_derived.py:519`; `tools/db/rebuild-test.ts:801-808, 1401-1450`; `src/lib/rollover/season-rollover.ts:29-31, 948-994` |
| `DERIVED_FOOTBALL_TABLES = ['player_clubs','player_club_season_stats','player_season_stats','player_career_stats','club_seasons']` — the promotion inventory names all five as recomputed, never reinstated | `tools/db/promotion-inventory.ts:816-819` |
| `seasons` rows are **reference-loaded** from `data/reference/seasons.json` (`first_season 1897`, `last_season 2026`, `in_progress_seasons [2026]`) by `load_reference_data.py` with `reload_truncate(pg, "seasons")` (`TRUNCATE … CASCADE`, fail-closed cascade guard) | `data/reference/seasons.json`; `tools/migration/load_reference_data.py:65-68, 220-241`; `common.py:732-842` |
| `clubs.first_season/last_season/is_current_afl_club/succession` are reference-loaded from `clubs.json`; a current identity's `last_season: null` is **replaced by `seasons.json.last_season` (2026)** at load; `club_organizations.is_active = max(last_season) = max(seasons.year)`; the loader asserts `is_current_afl_club == (succession == 'current')` | `load_reference_data.py:246-319, 153` |
| `afldb_identity_for_season(org, season)` requires `season <= COALESCE(c.last_season, season)` — for 2027 every identity fails and the function returns NULL. This is the ISSUE-160 J-6 constraint: "a selection for a draft one season ahead of the club table is refused by J-6 … the club table [must be] advanced first" | `017_club_organizations.sql:141-153`; `src/db/queries/admin-draft.ts:350-368`; `issues.md:22977-22981` |
| The end-of-season rollover (`tools/db/rollover-season.ts` / `src/lib/rollover/season-rollover.ts`, ISSUE-101) advances `seasons.json`, the fitzRoy contract, the acceptance register and stat availability **as tracked files only** — it opens no database connection, and `assertCoherent()` **refuses** unless `contract.full_history.season_range.last_season === seasons.json.last_season - 1`. Advancing `seasons.json` to 2027 ahead of a 2026 rollover would therefore break the planner's coherence check and the importer's accepted-baseline gate | `season-rollover.ts:14-40, 674-760`; `rollover-season.ts:50-57` |
| The nightly settle owns only `in_progress_seasons`; it never writes `seasons`, `clubs` or `club_seasons` rows and never creates players | `src/lib/acquisition/settle-afltables.ts:734, 791, 1615`; `AFLDB-ISSUE-160.md` §0.1 |
| **No "current player / retired / current club" derivation exists anywhere in `src/`.** `retired` appears only as NL vocabulary for "last game" (`after he retired` → career last match); `is_current_afl_club` and `club_organizations.is_active` are club-level facts used for search subtitles, club ordering and comparison pickers; the player page shows `player_clubs` stints and the career span; the club page shows `player_clubs` leaders | `src/search/nl/vocab.ts:373-375`; `src/search/nl/parser.ts:1179`; `src/db/queries/search.ts:202-204`; `clubs.ts:74-88, 314-333`; `advanced-search.ts:91-107`; `club-comparison.ts:173-208`; `players.ts:494-504`; `src/app/players/[slug]/page.tsx:164-166, 474-503` |
| The only "club list" concept in the repository is the AFL Tables *all-time* club player list CSVs used once to recover birth dates (`club-list:<org>:cap<n>` identities); it is historical, name-matched, and not a season list | `tools/migration/enrich_birth_dates_from_club_lists.py`; `tests/club-list-sources.test.ts` |
| AFL API lineups (ISSUE-100) are **staging-only match-level announcements**, explicitly "never canonical participation"; not a list source | `077_afl_api_lineups.sql:1-36` |
| ISSUE-160 delivered: `createPlayerInTransaction(tx, input, {adminUserId})` minting a `manual_admin_edit` identity + whole-row `identity` override; `resolvePlayerIdentity(tx, playerId)` (AFL Tables path first, then manual token, `ambiguous_identity` on >1 path); `withImportConnection()`; `DraftMutationResult` refusal/confirmation shape; `rolledBackRefusal` for post-write refusals; the D-9 shared `action-submit.ts` (skips the revalidate POST when `revalidatePaths` is empty) and `revalidate-route.ts` | `src/db/queries/players.ts:309-339`; `admin-draft.ts:196-243, 271-276, 375-404`; `src/components/admin/action-submit.ts:37-43, 71` |
| Durable-authority allowlists: `data_overrides.entity_type ∈ {players, matches, draft_picks, coaches, match_coaches}`; `data_edits.table_name ∈ {players, matches, draft_picks, award_winners, hall_of_fame, honour_team_members, brownlow_vote_entry_state, brownlow_season_authority, coaches}`; `data_overrides_uq UNIQUE (entity_type, entity_key, field_group)`; `admin_user_id NOT NULL` | `095:75-117`; `073:11-22`; `src/db/queries/audit-log.ts:22-59` |
| `manual-authority.ts` proves settle override scope **order-independently**: widening the CHECK with an entity that is not a settle target (`match_period_scores`, `player_match_stats`, `brownlow_round_votes`) changes nothing in either deploy order | `src/lib/acquisition/manual-authority.ts:78-89, 222-255`; `095:66-74` |
| Replay entry points: `replay_admin_overrides(conn, table)` dispatches on table name; called after each importer group (`players` at `import_fitzroy_core.py:3526`, `draft_picks` at `import_draftguru.py:931`, `coaches`/`match_coaches` in `import_match_coaches.py`); the promotion §8 loop is a documented operator snippet listing `('players','matches','draft_picks','coaches','match_coaches')` in **binding order** | `common.py:915-1582`; `docs/production-promotion.md:637-672` |
| Promotion: registry (import-writable) tables are rebuilt; `data_overrides`/`data_edits` are `reinstate`; `data_edits.row_id` lineage targets are `players` (widened by ISSUE-160 to AFL Tables path **or** manual token, path first), `matches`, `coaches`, `draft_picks`; `seasons.year` is a permanent natural identity needing no remap; an unclassified table refuses every promotion phase (R-3) | `promotion-inventory.ts:325-368, 696-700, 816-819`; `AFLDB-ISSUE-156.md` §9 |
| New-table registration precedent: `SELECT afldb_meta.grant_app_read('coaches'); SELECT afldb_meta.grant_import_write('coaches');` inside the migration; `privileges.sql` reconciles from those registries; `afldb_auth` needs nothing for a table read on the app pool and written on the import role | `087_coaches.sql:110-115`; `tools/maintenance/privileges.sql:420-434` |
| Test contracts that must be extended for a new table: `tests/reference-data.test.ts` "tables after 045" list; `tests/integration/fk-indexes.test.ts` (every FK column indexed); `tests/data-overrides-source-contract.test.ts` (single-writer source contract); `tests/auth.test.ts` (capability ↔ guard ↔ nav contract, `:1126-1129` role map); `tests/db-promotion-check.test.ts` (classification) | those files |
| Capability naming: `data.coaches.read/.edit`, `data.draft.read/.edit`, camelCase compounds `data.playerLinks`, `data.dataEditor`; read = `ADMIN_AND_UP`, edit = `SUPER_ADMIN_ONLY` when an edit "becomes a public statistical fact immediately" | `src/lib/auth/capabilities.ts:36-126` |
| ISSUE-161 is unallocated: no `AFLDB-ISSUE-161` anywhere in `*.md`, `issues/**`, `src/**`, `tools/**`, `tests/**`, `docs/**` | searched 2026-09-11 |

**Answer to Q1.** AFLDB has **no** "registered/listed player for this season" concept. Everything
it calls a player–club or player–season relationship is inferred from match appearances, and
every such table is derived, truncated and rebuilt. Nothing public, NL, Grid Solver or admin
answers "current player" or "current club"; the nearest facts are club-level (`is_current_afl_club`,
`club_organizations.is_active`) and the derived career span.

---

## 3. Existing schema / data-flow analysis (Planning Questions 2, 3)

### 3.1 Can a listed player exist without playing? (Q2)

Not in any existing table. Every candidate carries `games NOT NULL` semantics rebuilt from
`player_match_stats`; inserting a zero-game row would be erased at the next `rebuild_derived.py`
run (which the nightly settle executes, `deploy/afldb-settle-afltables.sh` → §13 of the settle) and
would corrupt the "played for" meaning ISSUE-152 and the club/player pages rely on. Forcing list
membership into a statistics table would conflate *listed* with *played* — exactly what the brief
forbids. **The minimum change is a new canonical table.**

### 3.2 Options evaluated (Q3)

| Option | Semantics | Historical compat. | Provenance | Replay / rebuild | `manual_admin_edit` fit | Ingestion fit | Perf. | Migration | Query impact | Listed-never-played | Copy-forward | Verdict |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| **A. reuse `player_clubs`** | wrong: "played for" per identity, no season grain, `games NOT NULL` | breaks 0-game invariant ISSUE-152 measured | none (derived) | erased by every derived rebuild | impossible | n/a | — | none | every consumer redefined | ✗ | ✗ | **rejected** |
| **B. reuse/extend `player_club_season_stats`** | wrong: statistics grain; a 0-game row would be a fabricated stat row | breaks "one row per club actually played" | none | erased by rebuild | impossible | n/a | — | column add | leaderboards, records, NL season answers all read it | ✗ (would be a lie) | ✗ | **rejected** |
| **C. `club_seasons` + a relationship** | `club_seasons` cannot hold an unplayed season (NOT NULL ladder columns), is derived, witness-checked and row-count-gated | breaks stage 8.5 / stage 9 | none | erased | impossible | n/a | — | schema change to a derived table | ladder queries | ✗ | ✗ | **rejected** |
| **D. dedicated canonical `season_list_members`** | exact: one row = listed by club C in season S | orthogonal to history; historical seasons untouched unless deliberately backfilled | `source_id` + origin per row; durable record in `data_overrides` | registry table rebuilt on promotion and re-created by a replay branch (159/160 shape) | natural | future importers write only their own `source_id`, honour tombstones | trivial (~45 × 18 rows/season) | one additive migration | none existing | ✓ | ✓ (natural) | **chosen** |
| E. `data_overrides`-only (no canonical table) | the "row" would only exist in an override payload; every read would parse jsonb; no FK integrity, no UNIQUE, not readable by `afldb_app` (import-role only, `privileges.sql:318-327`) | — | ✓ | ✓ | ✓ | ✗ | poor | none | admin-only reads through the import role | ✓ | awkward | rejected: violates the "canonical + override" separation every other domain uses |
| E′. `external_identities`/`player_link_resolutions` as list carrier | identity tables, not membership | — | — | — | — | — | — | — | — | — | — | rejected: semantic abuse |

**Answer to Q3.** Option D. The name `player_clubs` sounds suitable and is the wrong table: it is
derived, aggregate, historical, match-based membership, and it must keep meaning "played for".

---

## 4. Semantic definition of season list membership

> **A `season_list_members` row asserts: player *P* was a member of club *C*'s playing list for
> season *S*, as recorded by *source*, from the moment the row was created until it was removed.**

- It is **administrative intent**, not participation. It says nothing about games played.
  `player_club_season_stats` continues to mean "played for". The two are cross-referenced only for
  diagnostics (§15.1).
- "Listed" ⇒ present. "Not listed" ⇒ absent. There is no `status`, `active`, `retired`,
  `delisted` or `tombstoned` column on the canonical table (§7, §12).
- Season is the AFL season year the list applies to. The list for 2027 is built during the 2026
  off-season (trade period, drafts, pre-season) and administered through 2027.
- Club is the **historical identity** (`clubs.id`) trading in that season, resolved by rule (§9.1),
  never typed. Lineage/organisation views derive from `clubs.organization_id` as everywhere else.
- Player is `players.id`, chosen from search and re-read server-side; the durable record names the
  player by **identity** (AFL Tables profile path or `manual_admin_edit` token), never by id or
  name (§7).
- One player is a member of **at most one** club's list per season (§21, D-3).

---

## 5. Chosen canonical data model

```sql
CREATE TABLE season_list_members (
  id               bigint    PRIMARY KEY GENERATED ALWAYS AS IDENTITY,  -- surrogate; never identity
  season           smallint  NOT NULL CHECK (season BETWEEN 1897 AND 2100),  -- deliberately NO FK to seasons(year): §9.2
  club_id          integer   NOT NULL REFERENCES clubs(id),
  player_id        integer   NOT NULL REFERENCES players(id),           -- plain FK, no CASCADE: an admin fact must not vanish silently
  source_id        smallint  NOT NULL REFERENCES sources(id),           -- manual_admin_edit for every ISSUE-161 row
  origin           text      NOT NULL CHECK (origin IN
                     ('added','copied_list','transferred','imported')),   -- no appearance-derived origin (D-2)
  copied_from_season smallint CHECK (copied_from_season IS NULL OR copied_from_season < season),
  note             text,
  import_batch_id  bigint    REFERENCES import_batches(id),             -- importer rows only
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT season_list_members_one_club_ck UNIQUE (season, player_id)      -- §21 I-1
);
CREATE INDEX ix_slm_season_club ON season_list_members (season, club_id);
CREATE INDEX ix_slm_club        ON season_list_members (club_id, season);
CREATE INDEX ix_slm_player      ON season_list_members (player_id, season DESC);
CREATE INDEX ix_slm_source      ON season_list_members (source_id);
CREATE INDEX ix_slm_batch       ON season_list_members (import_batch_id) WHERE import_batch_id IS NOT NULL;
SELECT afldb_meta.grant_app_read('season_list_members');
SELECT afldb_meta.grant_import_write('season_list_members');
```

`UNIQUE (season, player_id)` implies uniqueness of `(season, club_id, player_id)`; no second
constraint is needed. Every FK column carries a leading-column index (`fk-indexes` contract).

**Registry classification.** `grant_import_write` makes it an import-writable *registry* table:
rebuilt on promotion, carried by the dump on a rebuild, and **not** entered in `PROMOTION_CONTRACT`
(a `{kind:'both'}` refusal, as ISSUE-159/160 found). It is listed in the inventory report only
through the registry; it is **not** added to `DERIVED_FOOTBALL_TABLES` (it is never recomputed).

**Durable record.** `data_overrides` row per membership:

| Column | Value |
|---|---|
| `entity_type` | `'season_list_members'` (CHECK widened by migration 096) |
| `entity_key` | `<club_slug>|<season>|<player_identity>` — e.g. `richmond|2027|afltables:players/D/Dustin_Martin0.html` or `gold-coast|2027|manual_admin_edit:2f6c…` |
| `field_group` | `'membership'` |
| `override_values` | `{ club_slug, season, player_identity, origin, copied_from_season, candidate_source, note }` (keys written only when supplied; `club_slug`, `season`, `player_identity`, `origin` always; `candidate_source = 'appearances:<season>'` records only that the admin picked the player from the non-authoritative appearances review panel, §23) |
| `is_active` | `true` = listed; `false` = **tombstone: intentionally removed** (§12) |
| `admin_user_id` | the acting Super Admin (a bulk copy attributes every row to the operator who ran it) |

The key is **natural and rebuild-stable**: club slugs are tracked reference data; the player
identity is exactly the string the ISSUE-160 `players` lineage rule and replay resolve. No token is
minted per membership, so re-adding a removed player reactivates the same record instead of
creating a second one, and copy-forward is idempotent by construction. No equivalent of
`null|null|<year>|null` can arise: every key component is `NOT NULL` at write time and the writer
refuses (`ambiguous_identity`) when the player's identity cannot be resolved to exactly one string.

---

## 6. Rejected alternatives and why

| Alternative | Why rejected |
|---|---|
| A permanent `players.retired` / `is_active` flag | Stores a lifecycle boolean that season membership already implies; a returning player would need it undone; it has no season context; nothing in the repository requires it. Rejected per the brief's core principle and by the evidence in §2 that no consumer needs it. |
| A `club_season_lists` container table with workflow status (`draft`/`published`) | No public consumer exists yet, so "published" would gate nothing (§10). "List exists but is empty" is not a real AFL state. A container adds a second table to classify, replay and audit for no present decision. Deferred: if public consumption arrives, a per-(club, season) publication marker is an additive migration then (D-7). |
| Tombstone/`removed_at` column on the canonical table | Every reader would need `WHERE removed_at IS NULL`; the UNIQUE would become partial; public consumers could leak removed rows. ISSUE-160 D-4 chose audited DELETE + inactive override for the same reasons. |
| Minted `manual:<token>` identity per membership (159/160 shape) | A membership *has* a natural key; a token would let the same player be recorded twice under two tokens and would make copy-forward non-idempotent. Tokens are right for entities without natural keys (coaches, manual picks); a membership is not one. |
| Storing `organization_id` instead of `club_id` | Every football table attaches to the identity (`clubs.id`); draft picks, coaches and matches do the same. Identity is derivable from organisation only through the season rule, so storing the identity keeps reads simple and matches the era pages. |
| FK `season REFERENCES seasons(year)` | Couples the admin domain to the tracked season register: a 2027 row cannot exist until `seasons.json` advances, which the rollover planner refuses until the 2026 full-history acquisition is accepted; on a rebuild the loader's `TRUNCATE seasons CASCADE` would empty the table. `seasons.year` is a natural key that needs no remap, so the FK buys no lineage safety (§9.2). |
| Auditing against a new `data_edits.table_name = 'season_list_members'` | Rows are deletable, so an audit row's `row_id` would dangle and need its own lineage rule; ISSUE-160 §9.1 solved the identical case by auditing against the stable subject (the player). Same answer here (§17). |
| Deriving "current club" for public pages in this issue | No consumer today claims it; changing public meaning is a separate, gated change (§10). |

---

## 7. Source / provenance model (Planning Question 4)

**Precedence (highest first):**

1. **Tombstone** — an inactive `season_list_members` override for a key means *no row may exist for
   that key from any source*. Importers must skip it; the replay deletes any matching row it finds
   (from a source that ignored the rule); the admin reverses it only by an explicit re-add (§12).
2. **Manual membership** (`source_id = manual_admin_edit`, active override) — written only by
   `src/db/queries/admin-season-lists.ts`; never touched by any importer (write scope by
   `source_id`, the DraftGuru/AFL Tables precedent).
3. **Source-owned membership** (future importers: their own `source_id`, own reload key
   `(source_id, season, club_id, player_id)`) — may be created, updated and deleted only within that
   source's scope, and never for a key that is tombstoned or already held manually.
4. **Appearance-derived data is never membership** (D-2). `player_club_season_stats` may be
   *displayed* as a non-authoritative review panel from which a Super Admin adds players one by
   one (or multi-selects, still one explicit decision per player); no row is ever written *from*
   appearances (§23).

`data_overrides` is the right mechanism: the membership itself is the human decision, and the
override carries the whole row (the coaches/draft "manual row" shape), not a field patch. A later
import cannot resurrect a removed player (rule 1) or remove an added one (rule 2).

**ISSUE-161 ships no importer.** External sources remain break-glass/reconciliation inputs (§15);
the admin workflow is complete with none of them available.

---

## 8. Current / retired derivation (Planning Question 9)

- **Listed in S**: `EXISTS (SELECT 1 FROM season_list_members WHERE player_id = P AND season = S)`.
- **Current list season**: `max(season)` over `season_list_members` — the latest season anyone is
  listed for. It is data-derived, never a clock or a config value.
- **Current club of P**: the club of P's membership in the current list season; `NULL` if none.
- **Not current ("retired/delisted/never listed")**: P has no membership in the current list season.
  A player who returns is simply listed again in a later season; nothing is undone.
- **Unknown, not retired**: if the current list season has fewer than the eligible clubs populated
  (e.g. only Richmond's 2027 list exists), the derivation is *incomplete* — consumers (§10) must
  treat "no membership" as **unknown** until every eligible club has a list. Stage 2 exposes this as
  a per-season completeness indicator; no public surface reads lists in this issue, so the
  incompleteness has no blast radius.
- A player created through the draft before the next season's lists exist has no membership. That
  is a normal state: nothing is deleted, hidden or blocked; the admin adds them when the list is
  built (§14).

---

## 9. Season boundaries, club eligibility and league changes (Planning Questions 15, 16)

### 9.1 Eligible clubs for a list season S (rule)

```text
maxYear := (SELECT max(year) FROM seasons)          -- the reference register's last season
S must satisfy  FIRST_LIST_SEASON <= S <= maxYear + 1   (FIRST_LIST_SEASON = 2027, D-2)
if S >= maxYear:  eligible identities = clubs WHERE is_current_afl_club          -- forward-extension
else:             eligible identities = clubs c WHERE afldb_identity_for_season(c.organization_id, S) = c.id
                                        AND EXISTS (SELECT 1 FROM club_seasons cs WHERE cs.club_id = c.id AND cs.season = S)
```

Implemented as one SQL helper (`afldb_season_list_clubs(p_season smallint) RETURNS SETOF clubs`,
in migration 096) so the list page, the copy-forward and the add/transfer writers cannot disagree.
`afldb_identity_for_season()` itself is **not** modified — ladder rows, season pages and ISSUE-160
J-6 keep their exact current behaviour (the J-6 next-year constraint is noted as a candidate reuse
of this helper, out of scope here).

Rationale: the reference register (`seasons.json`, `clubs.json`) describes **played history and
the in-progress season**; a list for the next season is **administrative intent about the future**.
For a season the register has not reached, the identities that will compete are the ones currently
competing — the only fact the repository holds about the future — until the rollover updates the
register, after which the two rules coincide. This is defensive against club-set changes: a new
club or a rename enters through `clubs.json` (reference load) and is picked up by the rule with no
code change; nothing hard-codes 18.

### 9.2 What ISSUE-161 must **not** create (answer to Q15)

| Structure | Owner | Why not here |
|---|---|---|
| `seasons` row for S+1 | `data/reference/seasons.json` via `load_reference_data.py` (`TRUNCATE`-and-copy); advanced only by the ISSUE-101 rollover after the completed season's full-history acquisition is accepted | an admin INSERT would be reverted by the next reference reload; advancing `seasons.json` early makes `assertCoherent()` and the importer's accepted-baseline gate refuse |
| `clubs.last_season`, `club_organizations.last_season/is_active` | same loader; a current identity's `last_season` is the register's last season by construction | same revert hazard; the forward-extension rule makes the advance unnecessary |
| `club_seasons` row for S+1 | derived from `matches` (ISSUE-095 D7), witness-checked, row-count-gated | structurally impossible (NOT NULL ladder columns) and a rebuild failure if it were possible |

**Finding for the operator:** "opening a season" is therefore *not* a database initialisation
step at all. It is the first membership written for that season under the eligibility rule. There
is no season initialisation logic to reuse, and building one would have tripped the stop
condition "season initialization has an unclear production side effect". The runbook records this
so that no later phase is tempted to advance the register from a browser.

### 9.4 Fixtures are not a dependency (operator boundary, 2026-09-11)

ISSUE-161 does not own fixture creation or scheduling; a likely `AFLDB-ISSUE-162` will. Nothing
in this issue requires a `matches` row, a fixture, a `club_seasons` row or a settle to have run for
season S: the season bound, the eligibility helper, copy-forward, add, remove and transfer read
only `seasons` (for `max(year)`), `clubs`, `players`, `external_identities`, `draft_picks` and
`season_list_members`. The §15.1 diagnostics that read `player_club_season_stats` are informational
and render "no matches recorded for S" when S has none. Stage 1 tests run the whole mutation set
against a season with zero matches.

### 9.3 Club changes (Q16)

- **Rename** in a future season (e.g. a new identity row appears in `clubs.json` with
  `first_season = S`): copy-forward resolves the target club **by organisation** (`clubs.organization_id`
  of the S-1 club → eligible identity of the same organisation in S), so memberships follow the
  rename. An existing S membership pointing at the pre-rename identity is surfaced by the list page
  as "identity not active in S" and corrected by transfer (§13).
- **New club**: appears in the eligible set with an empty list; copy-forward has nothing to copy for
  it; the admin adds players.
- **Club leaving**: not in the eligible set for S; copy-forward from S-1 **refuses** for that club
  (names it) rather than silently dropping its players; the players are then added elsewhere or left
  unlisted.
- **Merger**: organisations do not combine statistics (`017`); a merger is two "leaving" clubs and one
  "new/continuing" club under the rules above.

---

## 10. Public site impact (Planning Question 10)

**Required for correctness: none.** No public page, NL plan, Grid Solver axis, API or admin
surface today asserts list membership or current status (§2). Nothing is redefined; "played for"
stays "played for".

**Optional follow-up consumers** (each its own issue, gated on §8's completeness indicator):

| Surface | Candidate change |
|---|---|
| `/clubs/[slug]` | a "<S> list" section (listed players, games in S, draftee/new/departed badges) |
| `/players/[slug]` | "Listed: <club> (<S>)" line; "not currently listed" only when the season is complete |
| `/players`, advanced search, club comparison | "currently listed" filter |
| NL search | `current players`, `on <club>'s list`, `retired` (would need PARSER_VERSION bump + corpus) |
| Grid Solver | a "listed at <club> in <S>" axis distinct from "played for" |
| `/draft`, `/draft/[year]` | "now listed at" per selection |
| Current-season admin (`/admin/current-season`) | debutant resolution hints from the list |

Because no public path changes in Stage 2, Server Actions return `revalidatePaths: []` and the
shared submit helper sends no revalidate POST (`action-submit.ts:41`). No `/admin/season-lists/revalidate`
route is created until a consumer exists (§20).

---

## 11. New-season creation workflow (Planning Question 5)

No workflow states. "Creating the 2027 season" = choosing 2027 in the season selector (offered
because `2027 <= maxYear + 1`) and populating clubs. The season page shows every eligible club
(§9.1) with `member count`, `changes vs S-1` (+added / −departed, computed by organisation), and
`no list yet` for count 0. Operator flow:

1. select S (2027);
2. **Copy forward** (§11a) for all clubs with no S list, or per club — previewed first; for
   2027, the first authoritative season (D-2), there is no 2026 list to copy, so the season page
   points at each club's **appearances review panel** (§23) instead;
3. per club: remove retirees/delistings, add draftees (suggested from `draft_picks`, §14), add
   recruits, transfer arrivals, correct mistakes;
4. read the diagnostics (§15.1) and the completeness indicator;
5. nothing to "publish" in this issue (D-7).

### 11a Copy-forward contract

`copySeasonListsForward({ season: S, clubs: 'all' | clubSlug[], dryRun })`, Super Admin only:

| Rule | Behaviour |
|---|---|
| Source | the S-1 **list** (`season_list_members WHERE season = S-1`) — never appearances; if S-1 has no list the action refuses and points at the appearances review panel (§23), from which every add is explicit |
| Target set | the requested clubs ∩ eligible clubs for S; a requested club not eligible in S → **refuse, naming it** |
| Mapping | each S-1 row's club → the S identity of the same `organization_id`; no eligible identity → refuse naming the club (§9.3) |
| Collision | any target club already holding ≥1 row in S → **refuse before any write, naming every populated club** (the request is narrowed by the operator; the preview shows this) |
| Player conflict | a player listed at two clubs in S-1 (impossible under I-1 for admin-built lists) → refuse naming the player |
| Atomicity | **one import-role transaction for the whole request**: every row of every selected club, its override and its `data_edits` row, or nothing |
| Idempotency | a second run over the same clubs refuses on the collision rule; a partial retry = re-run selecting only the clubs still at 0 (the season page shows which) |
| Provenance | `origin = 'copied_list'`, `copied_from_season = S-1`; override payload records both; `data_edits.new_values` carries `batch_id` (uuid minted per run) so the audit viewer can group one copy |
| Preview | `dryRun: true` runs the same code path to the point before the first write and returns per-club counts, the refusal list and the row plan; the UI shows it before the confirm control |
| Audit | one `data_edits ('players', player_id, 'season_list_added')` per row (§17) |

---

## 12. Add / remove workflows (Planning Questions 6, 7)

### 12.1 Add (`addSeasonListMember({ season, clubSlug, playerId, note })`)

1. `requireCapability('data.seasonLists.edit')` in the action; the query function is guarded by
   the action only (159 S-7: the browser never reaches `afldb_import` except through a named action).
2. In one import-role transaction: resolve the club by §9.1 (refuse if not eligible); re-read the
   player; resolve identity via the ISSUE-160 `resolvePlayerIdentity` (moved to a shared module
   `src/db/queries/player-identity.ts` and imported by both `admin-draft.ts` and
   `admin-season-lists.ts`; behaviour unchanged) — `ambiguous_identity` refuses; a player with **no**
   identity (legacy identity-less player, DEV probe (f) class) refuses with "adopt/attach identity
   first" (never mint here: minting belongs to the draft/adopt actions);
3. `INSERT … ON CONFLICT (season, player_id) DO NOTHING` → 0 rows = **refuse `duplicate`**, naming
   the club the player is already listed at and offering transfer;
4. upsert the override (`is_active = true`, payload) — reactivates a tombstone;
5. `recordDataEdit('players', playerId, 'season_list_added', {}, {season, club_slug, origin, entity_key, note})`.

Supported subjects: any existing player (search), a player just created by ISSUE-160 (it has a
token identity), a historical player (any identity). **No creation from season-list admin** (D-5):
the Add panel links to `/admin/draft/new` ("Create a new player through their draft selection")
and, for the rare undrafted signing, the existing `/admin/data-editor` create path. One
player-creation primitive (`createPlayerInTransaction`) remains. Names never decide identity; the
picker ranks only.

### 12.2 Remove (`removeSeasonListMember({ membershipId, expectedUpdatedAt, note })`)

Meaning: *P is not a member of C's list for S.* Not "retire".

1. Lock the row (`SELECT … FOR UPDATE`); refuse `not_found`; refuse `stale` if `updated_at` differs
   from the value the form rendered (per-row compare-and-swap);
2. `DELETE FROM season_list_members WHERE id = $1`;
3. override for the row's key → `is_active = false` (**tombstone**; created if it does not exist,
   which is the case for a future importer-owned row);
4. `recordDataEdit('players', player_id, 'season_list_removed', old_values = full row, new_values = {season, club_slug, entity_key, note})`;
5. no other table changes. Removing from 2027 leaves 2026 intact; no player-level state moves.

A mistaken removal is reversed by adding again (same key → tombstone lifted). History is in
`data_edits` (both rows) and the override's `updated_at`.

---

## 13. Transfer workflow (Planning Question 8)

Two cases:

- **Between seasons** (leaves Richmond after 2026, joins Gold Coast for 2027): this is simply
  *add to Gold Coast 2027*. The 2026 Richmond row is history and is never touched. The season page's
  "departed since S-1" panel shows him under Richmond until he is added somewhere, which is the
  correct reading.
- **Within a season** (a mistaken club, or a rule-permitted mid-season move): one atomic primitive
  `transferSeasonListMember({ membershipId, toClubSlug, expectedUpdatedAt, note })`:
  lock the row → resolve target club by §9.1 → `DELETE` the old row → `INSERT` the new row
  (`origin = 'transferred'`) → old key's override `is_active = false` → new key's override active →
  two `data_edits` rows (`season_list_removed`, `season_list_added`) sharing a `transfer_id` in
  `new_values`. All in one transaction; the UNIQUE holds at commit. Separate remove + add would leave
  the player unlisted if the second action failed, which is why the primitive is atomic.

---

## 14. ISSUE-160 integration (Planning Question 20)

| Question | Answer |
|---|---|
| Does a draft selection automatically add the player to next season's list? | **No** (D-5). A draft row is a *selection fact*; a list row is *administrative intent*. Auto-adding would be a hidden cross-domain side effect, would fire before the target list exists, and would be wrong for trades/free agency/`training_squad_selection` kinds. |
| What does ISSUE-160 offer? | A **handoff link** on `/admin/draft/[id]` and on the new-selection success panel: "Add to <club> <draft_year+1> list" → `/admin/season-lists/<year+1>/<club-slug>?add=<playerId>` (pre-fills the Add panel; the add is still an explicit audited action). One small edit to ISSUE-160's Stage 2 files, allowed because both issues ship in the same batch. |
| What does ISSUE-161 offer? | A **draftee suggestion panel** on the club list page: `draft_picks` rows for this club with `draft_year ∈ {S-1, S}`, `player_id IS NOT NULL`, not yet listed in S — each with an "Add" control (per-player audited add; optional multi-select runs one transaction with one audit row per player). Names never decide anything: only linked (`unique/resolved`) selections are offered; unresolved ones deep-link to Player links as ISSUE-160 already does. |
| Draft before the target club season exists? | Nothing to do: lists need no season row (§9.2). The handoff works as soon as S+1 ≤ maxYear+1, which the draft year always satisfies (J-8 admits ≤ max(season)+1, so draft_year+1 ≤ maxYear+2 — the handoff hides itself when the target season exceeds the list bound, with the reason). |
| Player traded after the draft? | Lists are independent: the admin adds them to the new club; the draft row is unchanged; §15.1 shows "drafted by X, listed at Y" as information. |
| Draft selection corrected / retired / relinked? | No list mutation. If a manual selection is retired after its player was listed, the membership stands (it was an explicit decision). A relink (6.4) changes the selection's player; the list row was about the previously linked person and is shown by §15.1 as "listed player has no selection at this club" for the admin to judge. |
| Manual player later attached to AFL Tables (6.5)? | The membership row's `player_id` is unchanged; its override key carries the **token** identity; the replay resolves either string (§19), and the ISSUE-160 `players` replay binds the token onto the path-player first, so a promotion produces one player and one membership. |

Recommendation: **C + B** — handoff from ISSUE-160, explicit add in ISSUE-161, no automatic
membership.

---

## 15. External-source / break-glass reconciliation (Planning Question 14)

### 15.1 Repository-native diagnostics — Stage 2, read-only

Derived from rows the database already holds; nothing stored:

| Indicator | Source |
|---|---|
| listed in S, **no** games for this club in S | `player_club_season_stats` anti-join (only meaningful once S has matches) |
| **played** for this club in S but **not listed** (a definite list error once lists are complete) | `player_club_season_stats` ⟂ `season_list_members` |
| listed at C but drafted/selected by another club in S-1/S | `draft_picks` |
| listed player carries a `manual_admin_edit` identity and no AFL Tables identity (awaiting identity) | `external_identities` (the ISSUE-160 `awaiting-identity` derivation) |
| new since S-1 / departed since S-1 | organisation-level set difference against S-1 |
| club identity not active in S | §9.1 helper |

### 15.2 External reconciliation view — deferred (D-8)

No club-list importer exists; AFL Tables season pages list *players who played* (already
represented by derived tables), and AFL API lineups are match announcements (ISSUE-100). A four-way
view (in both / AFLDB only / source only / identity unresolved) needs a source contract, an
acquisition path and identity resolution through `external_identities` — a separate issue under
ISSUE-156 (working label P3d) when a source is chosen. Rule carried forward: **no automatic mutation
from a discrepancy**, and the admin workflow is complete without any source.

---

## 16. Permissions / capabilities (Planning Question 11)

| Capability | Contributor | Admin | Super Admin | Guard | Covers |
|---|---|---|---|---|---|
| `data.seasonLists.read` | ✗ | ✓ | ✓ | `requireCapability` on every `/admin/season-lists/**` page | season overview, club lists, diagnostics, previous-season comparison, copy preview (dry run is a read) |
| `data.seasonLists.edit` | ✗ | ✗ | ✓ | `requireCapability` first line of every Server Action | copy-forward, add (search / draftee / appearances-review panels, single or multi-select), remove, transfer |

Naming follows `data.draft.read/.edit` with the camelCase compound of `data.playerLinks`. Read is
`ADMIN_AND_UP` for the same reason as coaches/draft: list rows are (future) public facts and
`operations.audit.read` already shows an Admin every edit. **No Admin mutation**: a list change
becomes a public fact the moment a consumer ships, there is no draft stage, and copy-forward is a
bulk write — matching `data.coaches.edit` / `data.draft.edit`. Nav: Data group, after "Draft
administration", label "Season lists", gated by `data.seasonLists.read`. `tests/auth.test.ts`'s
capability↔guard map gains both entries (`requireAdmin` / `requireSuperAdmin` equivalents at
`:1126-1129`).

---

## 17. Audit contract (Planning Question 12)

Every mutation writes `data_edits` **in the same transaction** through `recordDataEdit(tx, …)`
(no try/catch by design). Subject = the **player** (`table_name = 'players'`, `row_id = player_id`),
the stable, lineage-remappable subject (ISSUE-160 §9.1 rationale: membership rows are deletable
and renumbered on promotion). New field groups on `players`:

| Operation | `field_group` | `old_values` | `new_values` |
|---|---|---|---|
| add (search, draftee panel, appearances review panel) | `season_list_added` | `{}` | `{season, club_slug, entity_key, origin:'added', candidate_source?, batch_id?, note}` — `candidate_source` = `'draft:<pick_id>'` or `'appearances:<season>'` when the admin picked from a panel; `batch_id` when several explicit selections were submitted together |
| copy-forward (per row) | `season_list_added` | `{}` | `{…, origin:'copied_list', copied_from_season, batch_id}` |
| remove | `season_list_removed` | full row `{season, club_slug, origin, copied_from_season, note, created_at}` | `{season, club_slug, entity_key, note}` |
| transfer | `season_list_removed` + `season_list_added` | as above | `{…, origin:'transferred', transfer_id}` |

Provenance is in the override row (`admin_user_id`, `updated_at`, `is_active`) and the canonical
row (`source_id`, `origin`). Actor, operation, player, club, season, before and after are therefore
all recoverable from `data_edits` alone; the audit viewer's per-entity page
(`/admin/audit/entity/players/<id>`) shows a player's whole list history with no change.
`data_edits.table_name` CHECK is **not** widened. Refusals that carry information (`duplicate`,
`conflict`, `stale`, `forbidden`, `ambiguous_identity`) go to `auth_audit_log` as
`admin.season_list_refused` (best effort, ISSUE-160 pattern); validation misses do not.

---

## 18. Transaction contract (Planning Question 18)

| Mutation | Boundary | Refused before any write | Must succeed together | Post-write refusal |
|---|---|---|---|---|
| add | one `AFLDB_IMPORT_DATABASE_URL` transaction (`withImportConnection` → `sql.begin`) | capability; season bound; club eligibility; player exists; identity resolves to exactly one string | INSERT + override upsert + audit | `ON CONFLICT DO NOTHING` returning 0 rows → **throw** (rolls back) → action maps to `duplicate` (ISSUE-160 `rolledBackRefusal` shape); never a success-shaped return after a write |
| remove | same | capability; row lock; `stale` CAS | DELETE + tombstone + audit | none possible after the lock; any error throws |
| transfer | same | capability; row lock; CAS; target eligibility | DELETE + INSERT + two overrides + two audits | UNIQUE violation on INSERT → throw → `duplicate` |
| copy-forward | same, **whole request** | capability; eligibility of every requested club; collision on every club; two-club players | N × (INSERT + override + audit) | any single failure throws and rolls back every club |
| multi-select add (draftee / appearances panels) | same, whole selection | capability; eligibility; identity of every selected player | N × (INSERT + override + audit) | any `duplicate` throws and rolls back the whole selection, naming the player |
| dry run | read-only; runs the same checks, returns the plan, opens no write | — | — | — |

Audit failure (a raising trigger on `data_edits`) and override failure (trigger on `data_overrides`)
roll everything back — proven per §24 with the ISSUE-159/160 sentinel-note trigger strategy.
`updated_at` is bumped by the writer, not a trigger (no new trigger objects). No `revalidatePath`
inside any action (R-7/S-6).

---

## 19. Replay / rebuild / promotion contract (Planning Question 13)

**Registry table, rebuilt, replayed** — the ISSUE-159/160 shape.

- `replay_admin_overrides(conn, 'season_list_members')` in `tools/migration/common.py`:
  1. **fail-closed pre-check** over every override with `entity_type = 'season_list_members'`
     (active *and* inactive): key has three parts; `club_slug` resolves to a club; `season` is an
     integer in range; `player_identity` resolves to **exactly one** player (`afltables:` via
     `external_identities (afltables, afltables_profile_url, unique/resolved)`; `manual_admin_edit:`
     via the token row — so the `players` replay must run first); any failure → `RuntimeError`,
     nothing written, batch marked failed;
  2. for each **active** override with no canonical row for `(season, club_id, player_id)` →
     `INSERT` with `source_id = manual_admin_edit`, `origin`, `copied_from_season`, `note` from the
     payload (`NOT EXISTS`, never `ON CONFLICT`, so a UNIQUE violation surfaces as the error it is);
  3. for each active override with a row → `UPDATE` `origin/copied_from_season/note` from the payload;
  4. for each **inactive** override → `DELETE` any row for that key (tombstone authority, §7);
  5. the club is resolved by slug → the identity eligible in `season` under §9.1 (so a rename
     between dump and replay resolves to the era-correct identity).
- **Call sites**: `import_fitzroy_core.py` after `replay_admin_overrides(pg, "players")`
  (`:3526`), because a membership needs players and clubs and nothing else; the promotion §8 loop in
  `docs/production-promotion.md:654` becomes
  `('players', 'matches', 'draft_picks', 'season_list_members', 'coaches', 'match_coaches')` with the
  ordering note extended (**binding**: after `players`, independent of `draft_picks`, `coaches`).
  `npm run db:test:rebuild` starts from an empty database and has no overrides to replay; the branch
  is exercised there only for idempotency (no-op).
- **Nightly settle**: writes `matches`/`player_match_stats`/scores and runs `rebuild_derived.py`;
  it never touches `season_list_members` (not derived, not a settle target) — verified by the
  `manual-authority.ts` proof: `'season_list_members'` is not in `UNREPRESENTABLE_OVERRIDE_ENTITIES`,
  so condition 2 still holds; the editor exposes it nowhere, so condition 4 holds; widening is safe
  in either deploy order (R-4 as amended by ISSUE-159 D-1).
- **Promotion inventory (`tools/db/promotion-inventory.ts`)**: no `PROMOTION_CONTRACT` entry
  (registry); no new lineage target (`data_edits` rows are on `players`, resolved by the widened
  `afltables_profile_url` rule, path first then token); no new identity SQL. `data_overrides` is
  reinstated as today; every `entity_key` component is a rebuild-stable string. The implementer
  runs `assertContractCoherent()`/registry classification tests to prove the table is classified
  (unclassified → every phase refuses, R-3 — **stop** if it does).
- **Promotion window**: between the swap and the replay a listed player's membership does not exist
  in the promoted database (the same window 159/160 documented). No public consumer reads lists
  yet, so the window is admin-visible only; the promotion record states it.
- **Disaster recovery / restore**: `data_overrides` is in every backup; a restore followed by the
  §8 loop re-creates every list. `privileges.sql` must be reconciled after a restore (fail-closed
  read registry, ISSUE-027/039 precedent).
- **No `null|null|<year>|null` class of key is possible** (§5).

---

## 20. Routes and UI (Planning Question 19)

Route family (inspected conventions: `/admin/draft`, `/admin/draft/[id]`, `/admin/coaches/[id]`,
`/admin/brownlow/[season]`, `force-dynamic`, `robots: noindex`, `AdminPager`):

| Route | Purpose | Guard |
|---|---|---|
| `/admin/season-lists` | season selector (seasons with any membership + `maxYear+1`); redirects to the current list season when one exists | `data.seasonLists.read` |
| `/admin/season-lists/[season]` | eligible-club cards: count, +added/−departed vs S-1 (or vs S-1 appearances, labelled non-authoritative, when S-1 has no list), "no list yet", completeness indicator; Super Admin control: **Copy forward** (preview → confirm; all clubs at 0 or a chosen subset). No bulk seed control (D-2) | read; actions `.edit` |
| `/admin/season-lists/[season]/[club]` | the list: players (link to `/players/<slug>-<id>`), provenance badge (AFL Tables / manual identity, never hover-only), origin (copied/added/transferred), draftee badge, games in S ("no matches recorded" when S has none, §9.4), diagnostics flags (§15.1); filters `all | new | departed(S-1 panel) | draftees | unresolved | no-games | played-not-listed`; **Add player** panel (existing `PlayerPicker` via `/api/search/autocomplete?scope=players`); **Draftees** panel (§14); **S-1 appearances review** panel (§23: players who played for this organisation in S-1 and are not listed in S, clearly labelled *not a list — review and add*, per-row Add and multi-select Add, each an explicit audited decision); per-row **Remove** (confirmation, `stale` CAS) and **Transfer** (club select from the eligible set, confirmation); links to `/admin/draft/new`, `/admin/player-links`, `/admin/audit/entity/players/<id>` | read; actions `.edit` |

No `/admin/season-lists/[season]/[club]/[player]` detail page (a membership has nothing to edit but
`note`, done inline). No revalidate route in this issue (§10). Interaction: `useActionState` inside
`startTransition` through the shared `action-submit.ts`; `focus-restore.ts` after every refusal;
`AdminPager` only if a list ever exceeds one page (lists are ~45 rows — no paging by default, filters
instead). Responsive: card rows below 768, table from 1000, sticky action bar at 320; 44 px targets;
no horizontal overflow at 320/768/1000/1280/1920. Planning only — no rendered acceptance is claimed.

---

## 21. Validation and invariants (Planning Question 17)

| ID | Invariant | Enforcement |
|---|---|---|
| I-1 | One player, one club per season | `UNIQUE (season, player_id)` + `ON CONFLICT DO NOTHING` refusal. **D-3 evidence gate (Stage 1, before the migration is written; operator-run, read-only, on rebuilt `afldb_test` or DEV):** (a) `SELECT (season/10)*10 AS decade, count(*) FROM (SELECT player_id, season FROM player_club_season_stats GROUP BY 1,2 HAVING count(*) > 1) x GROUP BY 1 ORDER BY 1;` (b) `SELECT player_id, season, array_agg(club_id ORDER BY club_id) FROM player_club_season_stats WHERE season >= 2000 GROUP BY 1,2 HAVING count(*) > 1 ORDER BY 2 DESC LIMIT 50;` — expectation: (a) non-zero only in eras that allowed mid-season clearances, (b) **zero**. Any row in (b), or any repository/source evidence that a player may legitimately hold two AFL list places in one season under current rules, is **contrary evidence → STOP** and report; the constraint is then re-designed (per-club uniqueness plus an explicit transfer history) before Stage 1 continues. Pre-2000 rows alone are recorded in the evidence as historical clearances outside the list domain (first season 2027) and do not stop |
| I-2 | No duplicate membership | implied by I-1 |
| I-3 | Player and club exist | FKs; club eligibility rule refuses an identity not active in S |
| I-4 | Season valid | CHECK range + server rule `FIRST_LIST_SEASON <= S <= maxYear + 1` |
| I-5 | Future-season work cannot delete historical memberships | every writer binds `season` from the form and the locked row; copy-forward touches only S; removal touches one locked row |
| I-6 | Copy-forward cannot duplicate | collision refusal before any write; UNIQUE backstop |
| I-7 | Importers cannot overwrite manual intent | write scope by `source_id`; tombstone rule (§7); source-contract test greps the writer set |
| I-8 | Current club derivation deterministic | at most one row per (season, player) ⇒ the derivation in §8 is a function |
| I-9 | Every membership durable | writer refuses unless the override upsert succeeds in the same transaction; replay pre-check refuses unresolvable payloads |
| I-10 | Identity never name-derived | only `resolvePlayerIdentity` produces the identity string; search ranks only |

---

## 22. Migration plan (Planning Question 22)

**One migration required** (number allocated at Stage 1 preflight; expected 096):

1. `CREATE TABLE season_list_members` + indexes exactly as §5; `COMMENT ON TABLE` stating the
   semantic definition (§4) and "NEVER derived; never hand-edited outside `admin-season-lists.ts`".
2. `CREATE FUNCTION afldb_season_list_clubs(p_season smallint) RETURNS SETOF clubs` implementing
   §9.1 (`STABLE`, `PARALLEL SAFE`); `GRANT EXECUTE` follows the 017 pattern (public functions are
   readable by `afldb_app`; verify the current default at implementation).
3. `ALTER TABLE data_overrides DROP CONSTRAINT data_overrides_entity_type_check, ADD CONSTRAINT …
   CHECK (entity_type IN ('players','matches','draft_picks','coaches','match_coaches','season_list_members'))`
   — every existing literal retained verbatim; the three settle targets still absent (095 pattern
   and comment).
4. `SELECT afldb_meta.grant_app_read('season_list_members'); SELECT afldb_meta.grant_import_write('season_list_members');`.
5. **No backfill.** No `data_edits` CHECK change. No `privileges.sql` edit (registries drive it;
   `afldb_auth` gets nothing). No trigger.

Deploy order (DEV batch, §26): migration → `npm run db:privileges` → code. The CHECK widening is
order-independent for the settle (§19); the table grants must precede the code or the admin page
fails closed on read (ISSUE-027 precedent).

Rollback = disable the routes/actions; the table, overrides and audits stay (forward-only policy).

---

## 23. Historical / backfill policy (Planning Question 21)

- **No historical conversion.** Historical lists are not derivable from match participation
  (listed ≠ played) and no source in the repository holds them. `player_clubs` and friends keep
  their meaning.
- **D-2 (decided 2026-09-11, with modification): `FIRST_LIST_SEASON = 2027`.** 2027 is the first
  authoritative Admin-managed list season. **2026 match appearances are never promoted into
  authoritative list membership**: no 2026 rows are created by any action, and no bulk "seed from
  appearances" action exists. The server rule refuses any season below 2027 (I-4).
- **Non-authoritative bootstrap/review seed (permitted use).** The 2027 club page carries an
  **appearances review panel**: a read-only projection of `player_club_season_stats` for the same
  organisation in 2026 (players who played, minus anyone already listed in 2027), labelled *not a
  list — review and add*. From it a Super Admin adds players by explicit selection (per row or
  multi-select), each producing an ordinary `origin = 'added'` membership with
  `candidate_source = 'appearances:2026'` in the override payload and the audit row. The
  appearances themselves are never written anywhere; the 2027 rows exist only because a person
  chose each player. The panel is shown only while S-1 has no list; once 2027 exists, 2028 uses
  copy-forward (§11a).
- The same 2026 appearances projection may seed **test fixtures** (`afldb_test`, marker-tagged,
  removed in `afterAll`) and the operator's own review; it is never a migration backfill.
- "Changes since last season" on the 2027 season page compares against 2026 **appearances**,
  labelled non-authoritative; from 2028 it compares list to list.

---

## 24. Testing strategy (Planning Question 23)

No existing suite is a sensible home for season-list mutations; two new files, plus extensions:

| Suite | Home | Proves |
|---|---|---|
| Pure/contract | **new** `tests/admin-season-list-actions.test.ts` | key shape `<slug>|<season>|<identity>` and its parser; §9.1 bound arithmetic; form parsing; refusal/confirmation shapes; `revalidatePaths` is `[]`; origin enumeration; the capability guard is the first statement of every action (source read) |
| Schema / domain (afldb_test) | **new** `tests/integration/admin-season-lists.test.ts` (fixture marker `AFLDB-ISSUE-161-TEST`, seasons `maxYear+1` and `maxYear+2` only via a test-scoped bound override — never a real season below 2027 — cleanup in `afterAll`) | create membership; duplicate refusal (same club, other club); add; remove (+ tombstone, + re-add lifts it); transfer (atomic, UNIQUE holds, two audits share `transfer_id`); listed-but-never-played (no pcss row, membership persists through a real `rebuild_derived.py` run of the derived targets); **season with zero matches** (§9.4: every mutation works, diagnostics render "no matches recorded"); draftee before debut (manual player from `createPlayerInTransaction` + membership); return after absence (S row, no S+1 row, S+2 row; derivation in §8 yields the expected clubs per season); copy-forward (preview then write, counts, provenance, `batch_id`); target populated → refusal names the club; ineligible club → refusal; **season below 2027 refused** (I-4); appearances review panel: projection excludes already-listed players, a multi-select add writes one `origin='added'` row per player with `candidate_source`, and **no** row is ever written without an explicit selection |
| Identity | same integration suite | existing AFL Tables player → `afltables:` key; manual player → token key; a two-path player → `ambiguous_identity`; an identity-less player → refused with the adopt/attach message; ISSUE-160 attach (6.5) after listing → replay still resolves the token key to one player |
| Authorisation | `tests/auth.test.ts` extend | both capabilities declared and enforced; nav entry; Contributor → `/admin/upload`; Admin read OK, Admin action → `/admin`; direct action invocation guarded; the capability↔guard map |
| Transactions | integration suite, ISSUE-159/160 sentinel triggers on `data_edits` and `data_overrides` (`note = 'AFLDB-ISSUE-161-GATE-FORCE-FAIL'`) | audit failure rolls back add/remove/transfer/copy; override failure rolls back the same; post-write refusal (`duplicate` via `ON CONFLICT` 0 rows, UNIQUE on transfer) leaves nothing persisted and returns the refusal shape |
| Replay / promotion | integration suite spawns the real `replay_admin_overrides(pg, 'season_list_members')` (the `admin-draft.test.ts` python pattern); `tests/db-promotion-check.test.ts` extend | manual memberships re-appear with the same keys after deletion; a tombstone is not resurrected and deletes a planted foreign-source row; an unresolvable payload fails the whole batch closed and writes nothing; the table is classified registry and the contract stays coherent; a `players` audit row for a listed manual player resolves under the widened rule |
| Source contract | `tests/data-overrides-source-contract.test.ts` extend | exactly one `INSERT INTO season_list_members` in `src/` and it is `admin-season-lists.ts`; `common.py` carries the replay branch with the `NOT EXISTS` guard |
| Reference / FK contracts | `tests/reference-data.test.ts` (tables list), `tests/integration/fk-indexes.test.ts` (automatic) | new table listed; every FK indexed |
| Manual authority | the settle authority tests (`src/lib/acquisition/manual-authority.ts` suite) extend | `overrideScopeProvenFrom()` stays `true` with `'season_list_members'` admitted, in both orders |
| UI (deferred to DEV batch) | Playwright, three roles × 320/768/1000/1280/1920 | filters, confirmation dialogs, focus restore after a refusal, links, no overflow, badges not hover-only, console/network clean |

Typecheck (`npx tsc --noEmit`) and the affected suites (`auth`, `data-overrides-source-contract`,
`reference-data`, `db-promotion-check`, `admin-draft-actions`, `integration/admin-draft` for the
shared identity module move) are the Stage 1/2 gates.

---

## 25. Performance (Planning Question 24)

~45 rows × 18 clubs ≈ 800 rows per season; a decade of lists is under 10 000 rows. Indexes in §5
serve every access path (season+club list, club history, player history, source scope). The club
list page is **one** query: memberships ⋈ players ⋈ clubs, `LEFT JOIN` `player_club_season_stats`
(games in S), `LEFT JOIN LATERAL` the single-row identity summary, `LEFT JOIN` `draft_picks` for the
draftee badge — no per-row lookups. Copy-forward is one `INSERT … SELECT` per request plus a bulk
override upsert and a bulk `data_edits` insert (multi-row `VALUES`), not a per-row round trip. The
eligible-club helper is a set-returning SQL function over 24 rows. No caching.

---

## 26. DEV / PROD rollout (Planning Question 25)

**Recorded constraint.** ISSUE-161 is developed locally on top of ISSUE-160. **No Admin/Super Admin
change is deployed to DEV until ISSUE-161 is complete and the operator confirms there is no further
Admin Centre addition to batch.** Deferred DEV acceptance during implementation is not a failure.

Then, in order: merge/integrate the Admin Centre stack (ISSUE-160 + ISSUE-161 branches onto `main`
via `merge:ready` per issue) → update DEV (`deploy/sync-dev.ps1`: migration 096, `db:privileges`,
code) → replay is a no-op on DEV (no season-list overrides yet) → combined ISSUE-160 + ISSUE-161
DEV acceptance → role-based Playwright (ISSUE-160 gate 16 + ISSUE-161 UI row of §24) → fix defects →
close both when green. PROD follows the ISSUE-155/151 promotion contract separately; the §8 replay
loop change and the `docs/production-promotion.md` edit ship with Stage 1 and are subject to the same
ISSUE-160 S-1 sequencing note (no new promotion-tooling code is added by ISSUE-161).

---

## 27. Explicit out-of-scope

Public consumers of lists (§10); external-source reconciliation view and any club-list importer
(§15.2); any list season before 2027 and any promotion of 2026 appearances into membership (D-2);
**fixture creation / scheduling for a new season** (owned by a likely `AFLDB-ISSUE-162`; ISSUE-161
never depends on a fixture, §9.4); player merge / relink (P9); changing
`afldb_identity_for_season()` or ISSUE-160 J-6; `seasons`/`clubs`/`club_seasons` creation or the
rollover; a `players.retired` flag; workflow/publication states; Grid Solver, NL parser or search
changes; data-editor decomposition (P8); DEV update, PROD, deployment; ISSUE-160 changes beyond the
handoff link and the shared identity-module extraction.

---

## 28. Risks and stop conditions

| ID | Risk / stop condition | Disposition |
|---|---|---|
| W-1 | `player_clubs` semantics conflict with the list concept | **Confirmed conflict, resolved by not reusing it** (§3); `player_clubs` is untouched |
| W-2 | Existing rebuilds destroy manual list state | cleared by design: registry table + fail-closed replay + tombstones; **stop** at Stage 1 gate if the replay/promotion test cannot re-create a planted set exactly |
| W-3 | Season initialisation has an unclear production side effect | **avoided**: no register/club/club_seasons writes (§9.2). **Stop** if any implementation step finds it must write `seasons`, `clubs` or `club_seasons` |
| W-4 | Migration/backfill risks historical meaning | no backfill; derived tables unchanged; no season below 2027; appearances are only ever displayed for review, never written as membership (§23, D-2) |
| W-5 | Current/active semantics used inconsistently across public features | none exist today (§2); any consumer is a separate gated change |
| W-6 | ISSUE-160 requires a breaking redesign | no: one link + one module move; **stop** if the shared identity extraction changes `admin-draft.test.ts` results |
| W-7 | I-1 conflicts with legitimate same-season multi-club membership | **D-3 gate** (§21): probes (a)/(b) run before the migration is written; any modern-era row or rule evidence → **STOP and report**; pre-2000 clearances alone are recorded and do not stop |
| W-14 | An implementation step needs a fixture, a `matches` row or a settle for the new season | **stop** — that is ISSUE-162 territory (§9.4); ISSUE-161 must work on a season with zero matches |
| W-8 | Unclassified table refuses promotion (R-3) | migration registers it; classification test at Stage 1; **stop** if `db-promotion-check` reports it unclassified or `{kind:'both'}` |
| W-9 | Subtractive `afldb_auth` spec / fail-closed app read (R-2) | `grant_app_read` in the migration; `db:privileges` before code |
| W-10 | `data_overrides` widening degrades the settle (R-4) | order-independent proof holds (§19); unit case added |
| W-11 | `revalidatePath` inside an action (R-7) | none; `revalidatePaths: []` |
| W-12 | Identity-less legacy players cannot be listed | refused with the adopt/attach remedy; not minted here (W-1/W-2 of ISSUE-160 stay owned there) |
| W-13 | Forward-extension rule lists a club that will not compete | only `is_current_afl_club` identities, corrected by reference data; the copy-forward preview names every club before writing |

---

## 29. Staged implementation plan

**Stage 1 — data model, mutation, replay, promotion (Opus 5, high).** Preflight
(`npm run preflight -- --mode implementation --issue 161`, re-confirm ISSUE-161/096 free, re-read
`capabilities.ts`/`nav-model.ts`/`admin-draft.ts` since `1295d3d`); **D-3 evidence gate first**
(§21 probes (a)/(b), operator-run read-only; stop on contrary evidence; results recorded verbatim in
`issues.md`); migration 096 (§22); extract `resolvePlayerIdentity`/`readManualPlayerToken` into
`src/db/queries/player-identity.ts` (behaviour-preserving; `admin-draft.ts` re-exports); new
`src/db/queries/admin-season-lists.ts` (§11a, §12, §13, multi-select add, the §23 appearances
projection read helper, §15.1 diagnostics queries, CAS, `FIRST_LIST_SEASON = 2027`);
`common.py` replay branch + `import_fitzroy_core.py` call site;
`docs/production-promotion.md` §8; `tests/admin-season-list-actions.test.ts`,
`tests/integration/admin-season-lists.test.ts`, extensions to `data-overrides-source-contract`,
`reference-data`, `db-promotion-check`, manual-authority; `npx tsc --noEmit`. Ends when every
Stage 1 row of §24 is green on `afldb_test`.

**Stage 2 — Admin surface (Fable 5.1, high).** Capabilities + nav +
`tests/auth.test.ts`; `/admin/season-lists`, `/[season]`, `/[season]/[club]`, `actions.ts`,
`validation.ts`, panels (Copy preview/confirm, Add, Draftees, Appearances review, Remove, Transfer); ISSUE-160
handoff link (`/admin/draft/[id]` player panel and the new-selection success panel);
`docs/admin-and-beta.md`; `CHANGELOG.md`; issue/index updates. DEV Playwright deferred to the batch.

No Stage 3: public consumers and external reconciliation are separate issues (§10, §15.2).

---

## 30. Operator decisions — DECIDED 2026-09-11 (binding for Stage 1 and Stage 2)

| ID | Decision | Outcome | Binding wording |
|---|---|---|---|
| **D-1** | Canonical table + migration 096 (§5, §22) | **APPROVED** | New `season_list_members` registry table, one additive migration, `data_overrides.entity_type` widened, read/write registries; no overrides-only design |
| **D-2** | First list season and bootstrap (§23) | **APPROVED WITH MODIFICATION** | **2027 is the first authoritative Admin-managed list season** (`FIRST_LIST_SEASON = 2027`; seasons below refused). **2026 match appearances are never promoted into authoritative list membership**: no bulk seed action, no 2026 rows, no `seeded_appearances` origin. Appearance-derived 2026 data may be used **only** as an explicitly non-authoritative bootstrap/test/review seed: the read-only appearances review panel from which each add is an explicit per-player decision (`origin='added'`, `candidate_source='appearances:2026'`), and marker-tagged `afldb_test` fixtures |
| **D-3** | One club per season (`UNIQUE (season, player_id)`, I-1) | **APPROVED, SUBJECT TO STAGE 1 EVIDENCE** | Strict UNIQUE stands **only if** the §21 D-3 evidence gate finds no legitimate same-season multi-club membership under current rules (probe (b) = 0 and no rule evidence). **Contrary evidence → STOP** and report before the migration is written; the constraint is re-designed, not weakened silently |
| **D-4** | Removal = audited `DELETE` + inactive-override tombstone (§12.2) | **APPROVED** | No status column; absence is the semantic; reversal = re-add; the tombstone binds importers and replay |
| **D-5** | ISSUE-160 integration (§14) | **APPROVED — Option C** | Explicit ISSUE-160 → ISSUE-161 handoff (link from `/admin/draft/[id]` and the new-selection success panel) plus the draftee suggestion panel; **no automatic membership** from any draft mutation |
| **D-6** | Future-season club eligibility and no register/club/`club_seasons` writes (§9.1, §9.2) | **APPROVED** | Forward-extension by `is_current_afl_club` for `S >= max(seasons.year)`, list season ≤ `max(year)+1`, no FK to `seasons`; `seasons`, `clubs`, `club_seasons`, `afldb_identity_for_season()` untouched |
| **D-7** | Publication / workflow state | **APPROVED — none** | No container table, no `draft/published` state; additive later if a public consumer needs it |
| **D-8** | External-source reconciliation | **APPROVED — deferred** | Separate ISSUE-156 child when a source is chosen; Stage 2 ships the repository-native diagnostics only (§15.1); no automatic mutation from any discrepancy |
| **Boundary** | Fixtures | **operator boundary, 2026-09-11** | ISSUE-161 does not own fixture creation/scheduling (likely `AFLDB-ISSUE-162`) and **must not depend on a fixture existing** (§9.4, W-14) |

Technical questions resolved from evidence and **not** put to the operator: table choice (§3),
key shape (§5), audit subject (§17), atomic transfer (§13), capability roles (§16), routes (§20),
no revalidate route (§10), stage split (§29).

---

## 31. Final report

1. **Proposed title:** AFLDB-ISSUE-161 — Season list administration: authoritative club playing lists per season (ISSUE-156 P3c).
2. **Canonical model:** new registry table `season_list_members` (season, club identity, player, source, origin), `UNIQUE (season, player_id)`; durable record = `data_overrides ('season_list_members', '<club_slug>|<season>|<player identity>', 'membership')`; no lifecycle flag anywhere.
3. **Migration required:** **yes**, one (next free 096, allocated at Stage 1): table + indexes + eligibility helper + `data_overrides.entity_type` widening + read/write registries. No backfill, no `data_edits` CHECK change, no privileges.sql edit.
4. **"Retired" derivation:** absence of a membership in the current list season (`max(season)` over memberships); "unknown" while that season's eligible clubs are not all populated; nothing stored, nothing undone on return.
5. **New season lists:** no initialisation step; a season S ≤ `max(seasons.year)+1` is administrable as soon as it is selected; eligible clubs = `is_current_afl_club` identities for S ≥ register max, era identities with a `club_seasons` row otherwise. `seasons`, `clubs`, `club_seasons` are never written.
6. **Copy-forward:** from the S-1 **list** only, by organisation, previewed, one transaction for the whole request, refused before any write if any target club already has rows or is ineligible, `origin = copied_list` + `copied_from_season`, per-row audit with a `batch_id`. For 2027 (first authoritative season, D-2) there is nothing to copy: the club page shows a non-authoritative 2026 appearances review panel and every add from it is an explicit per-player decision; appearances are never written as membership.
7. **Draftees / new players:** created only through ISSUE-160's primitive (or the existing data-editor path); listed by an explicit add — from search, from the draftee suggestion panel, or via the ISSUE-160 handoff link; never automatically; identity resolved server-side, ambiguous or absent identity refused.
8. **Transfers:** between seasons = add to the new club (history untouched); within a season = one atomic remove+add primitive with two audit rows sharing a `transfer_id`.
9. **Imports vs manual truth:** importers write only their own `source_id`, never a manual row, never a tombstoned key; an inactive membership override is an authoritative "intentionally removed" tombstone; no importer exists in this issue.
10. **Rebuild / replay:** fail-closed `replay_admin_overrides('season_list_members')` after the `players` replay re-creates active memberships, updates existing ones and deletes tombstoned ones on every rebuilt or promoted database; audits ride the existing `players` lineage rule; the table is registry-classified with no new contract entry or lineage target.
11. **ISSUE-160 integration:** option C — handoff link and draftee suggestions, explicit add, no automatic membership; one shared `player-identity.ts` module extracted behaviour-preservingly.
12. **Permissions:** `data.seasonLists.read` (Admin, Super Admin), `data.seasonLists.edit` (Super Admin only); Contributor nothing; no Admin mutation.
13. **Routes:** `/admin/season-lists`, `/admin/season-lists/[season]`, `/admin/season-lists/[season]/[club]`; Data-group nav entry "Season lists"; no revalidate route until a public consumer exists.
14. **Stages:** Stage 1 backend/replay/promotion/tests (Opus 5 high); Stage 2 admin surface + capabilities + ISSUE-160 handoff (Fable 5.1 high); no Stage 3.
15. **Tests:** two new suites (`tests/admin-season-list-actions.test.ts`, `tests/integration/admin-season-lists.test.ts`) plus extensions to `auth`, `data-overrides-source-contract`, `reference-data`, `db-promotion-check`, manual-authority; forced-failure triggers; real-replay proof; Playwright deferred to the DEV batch.
16. **Operator decisions:** D-1…D-8 **decided 2026-09-11** (§30): D-2 with modification (2027 first authoritative season; 2026 appearances never promoted into membership; non-authoritative review seed only), D-3 subject to the Stage 1 evidence gate, the rest as recommended; plus the fixtures boundary (ISSUE-162 owns fixtures; 161 never depends on one).
17. **Blockers / stop conditions:** none fired during planning. Stage 1 hard stops: D-3 contrary evidence (§21), W-2 replay exactness, W-8 promotion classification, W-14 any dependency on a fixture.
18. **Ready to begin:** **yes — Stage 1 is authorised.** A fresh Opus 5 high session with the opening prompt `Execute AFLDB-ISSUE-161 Stage 1 according to AFLDB-ISSUE-161.md` from this worktree, on the ISSUE-160 branch state; first actions are the preflight, the ISSUE-161/096 re-check and the D-3 evidence probes (operator-run, read-only).

---

## 32. Stage 1 execution record — 2026-09-11 (Opus 5, high)

Implemented on `opus/issue-161-season-lists` from `436d0c9`. **Not committed, not pushed, not
merged, not deployed. DEV and PROD were not touched; every database write went to `afldb_test`.**

### 32.1 Gates

| Gate | Outcome |
|---|---|
| Preflight (`--mode implementation --issue 161`) | **READY** — 0 blockers, 3 warnings: `.env` absent in the worktree (created locally, untracked, DSNs pointed at the `55432` tunnel), `psql`/`pg_restore` unavailable (not required for this mode) |
| Migration number | `git log --all -- 'src/db/migrations/096*'` empty and no `096*` file — **096 allocated** |
| **D-3 evidence gate (§21)** | **PASSED**, read-only on rebuilt `afldb_test` (59,002 `player_club_season_stats` rows, 1897–2026). Probe (a) by decade: 1890s 2, 1900s 1, 1910s 30, 1920s 21, 1930s 53, 1940s 30, 1950s 25, 1960s 10, 1970s 34, 1980s 39, 1990s 4 — **total 249, latest 1992**. Probe (b) `season >= 2000`: **0 rows**. No rule evidence of a legitimate second same-season list place. `UNIQUE (season, player_id)` implemented as designed, with the measurement recorded beside the constraint |
| W-8 promotion classification | cleared — registry-classified, no `PROMOTION_CONTRACT` entry, `assertContractCoherent()` does not throw |
| W-10 settle authority | cleared — `overrideScopeProvenFrom()` returns the same answer for the pre-096 and post-096 CHECK |
| W-6 ISSUE-160 redesign | cleared — `tests/integration/admin-draft.test.ts` 45/45 after the identity extraction |
| W-14 fixture dependency | cleared — 2027 holds 0 `matches` and 0 `club_seasons` rows and every mutation works |
| W-3 register writes | cleared — no `seasons`, `clubs` or `club_seasons` row is written by code **or by a test fixture** |

### 32.2 Delivered

`src/db/migrations/096_season_list_members.sql` — the table exactly as §5 (surrogate `id`, no FK to
`seasons`, `UNIQUE (season, player_id)`, five indexes, four origins, table/column comments);
`afldb_season_list_clubs(smallint)` implementing §9.1 as the one rule (measured on `afldb_test`: 18
clubs for 2027 and 2026 by forward extension, 14 for 1990 and 8 for 1900 through the era arm);
`data_overrides.entity_type` widened retaining every literal; both role registries.

`src/db/queries/player-identity.ts` — `MANUAL_SOURCE_KEY`, `manualEntityKey`,
`readManualPlayerToken`, `resolvePlayerIdentity`, moved verbatim from `admin-draft.ts` and
`players.ts`, which both re-export them, so no caller or test changed.

`src/db/queries/admin-season-lists.ts` — `FIRST_LIST_SEASON = 2027`, the key shape and its parser,
the bound rule, `addSeasonListMember`, `addSeasonListMembers`, `removeSeasonListMember`,
`transferSeasonListMember`, `copySeasonListsForward` (preview and write), the §23 appearances
review projection, the §15.1 diagnostics, the club/season reads and the §8 derivations. Every
mutation is one import-role transaction; every precondition refuses before the first write; every
post-write refusal throws `RollbackRefusal`.

`tools/migration/common.py` — the fail-closed `season_list_members` replay branch (`SEASON_LIST_ORIGINS`
frozen copy, pre-check over active **and** inactive overrides, tombstone `DELETE` first, `NOT EXISTS`
insert, payload `UPDATE`); `import_fitzroy_core.py` call site immediately after `players`;
`docs/production-promotion.md` §8 loop and the promotion-inventory acceptance checklist;
`manual-authority.ts` inventory.

Tests: `tests/admin-season-list-actions.test.ts` (new, 25) and
`tests/integration/admin-season-lists.test.ts` (new, 40, including the real Python replay), plus
extensions to `data-overrides-source-contract`, `db-promotion-check` and `current-season-import`.
`tests/reference-data.test.ts` needed no edit: its post-045 contract is derived from the migrations
and the table registers `grant_import_write`.

### 32.3 Deviations from this runbook

1. The replay executes the tombstone `DELETE` **first** rather than fourth (§19): a stale row for
   the same `(season, player)` would otherwise collide with the UNIQUE and abort a reload that was
   about to become correct. Tombstone-first is what §7's precedence already says.
2. "Membership persists through a real `rebuild_derived.py` run" (§24) is proved as an exact source
   contract — `rebuild_derived.py` names the table nowhere, `DERIVED_FOOTBALL_TABLES` is pinned to
   its five members, `settle-afltables.ts` names it nowhere — rather than by running a full derived
   rebuild of the only rebuilt test database.
3. The §24 "test-scoped bound override" is an env var honoured only when `NODE_ENV === 'test'`
   (proved inert under `NODE_ENV=production`), not a throwaway `seasons` row. It raises the ceiling
   only and can never lower `FIRST_LIST_SEASON`.

### 32.4 Outstanding (superseded by §33 — Stage 2 is now implemented)

Stage 2 in full (§29): capabilities, nav, the three routes, actions/validation/panels, the
ISSUE-160 handoff link, `docs/admin-and-beta.md`, `tests/auth.test.ts`. Then commit, the Admin
Centre DEV batch (**migration 096 → `npm run db:privileges` → code**; the app read is fail-closed
until the privileges run, which the workstation cannot do — no `psql`), combined ISSUE-160 +
ISSUE-161 DEV acceptance and role-based Playwright. PROD follows the ISSUE-155/151 contract
separately.

---

## 33. Stage 2 execution record — 2026-09-11 (Sonnet 5, high)

Implemented on `opus/issue-161-season-lists` on top of the uncommitted Stage 1 tree, same
worktree. **Not committed, not pushed, not merged, not deployed. DEV and PROD were not touched.**
No shell, Git, database, or deployment command was executed by Claude while implementing Stage 2
(CLAUDE.md §9 user-executed command boundary): the Stage 1 checkpoint `97af605` and a clean tree
were already visible in the session's own git-status context, so `npm run preflight` was not
re-run by Claude. The full record, including the exact operator validation commands, is in
`issues.md` → AFLDB-ISSUE-161 → *Stage 2 execution*.

### 33.1 Delivered

**Capabilities (§16).** `data.seasonLists.read` (Admin, Super Admin), `data.seasonLists.edit`
(Super Admin only) — `src/lib/auth/capabilities.ts`. Nav: Data group, after "Draft
administration", "Season lists", gated on `.read` — `src/app/admin/nav-model.ts`.
`tests/auth.test.ts`'s `EQUIVALENT_ROLE_GUARD` map extended; the file's existing generic
boundary-scanner (every page/route/action guard-first, capability↔nav↔declaration cross-checks)
covers the new surface without hand-written duplicate test cases.

**Routes, exactly the runbook shape (§20).** `/admin/season-lists` (season selector),
`/admin/season-lists/[season]` (eligible-club overview, copy-forward),
`/admin/season-lists/[season]/[club]` (the operational surface: members, filters, Add, Remove,
Transfer, draftee suggestions, appearances review, §15.1 diagnostics). No player-level fourth
route segment and no `/admin/season-lists/revalidate` route (§10, §20 — `revalidatePaths: []`
always).

**Files added:** `src/app/admin/season-lists/{page.tsx, [season]/page.tsx,
[season]/[club]/page.tsx, actions.ts, validation.ts, submit-helper.ts, AddPlayerPanel.tsx,
AppearancesReviewPanel.tsx, DraftSuggestionsPanel.tsx, MemberActions.tsx, CopyForwardPanel.tsx}`.

**One additive Stage 2 backend read**, `readDraftSuggestions(season, clubSlug)` in
`admin-season-lists.ts`: Stage 1 shipped every mutation and the appearances projection but no read
for "this club's draft selections not yet listed" (§14 needs one). Plain `SELECT`, no migration,
no invariant touched.

**ISSUE-160 handoff (§14, option C).** `SeasonListHandoff` added to `DraftActionState`
(`src/app/admin/draft/submit-helper.ts`); computed by `seasonListHandoffFor()` in
`src/app/admin/draft/actions.ts` and attached to the success result of `createManualPickAction`
and `createPlayerAndDraftPickAction`; rendered as a link in `NewPickWizard.tsx`'s two success
panels and in `/admin/draft/[id]/page.tsx`'s header line, deep-linking to
`/admin/season-lists/<draftYear+1>/<clubSlug>?add=<playerId>` and hiding itself when that season
is outside the administrable range. Never writes `season_list_members`.

**Files changed:** `src/lib/auth/capabilities.ts`, `src/app/admin/nav-model.ts`,
`src/db/queries/admin-season-lists.ts` (`readDraftSuggestions` only), `src/app/admin/draft/
submit-helper.ts`, `src/app/admin/draft/actions.ts`, `src/app/admin/draft/NewPickWizard.tsx`,
`src/app/admin/draft/[id]/page.tsx`, `tests/auth.test.ts`.

### 33.2 Deviations from this runbook

1. The draftee suggestion panel offers only a per-row "Add" (exact `candidate_source =
   'draft:<pick id>'`), not a multi-select batch: the Stage 1 batch primitive accepts one shared
   `candidateSource` for the whole selection, which would blur per-pick evidence a per-row call
   keeps exact. The appearances review panel (where `candidate_source` is genuinely uniform per
   batch) keeps both the per-row and the multi-select path, as the runbook allows.

The club-page filter set (`all | draftees | unresolved | no-games`) still does not carry a fifth
`departed` filter VALUE — a departed player is by definition absent from the MEMBER table those
filters narrow, so it cannot be filtered into it. This is not a deviation: §33.4's repair pass
added the actual `"departed since S-1"` and `"+added/-departed vs S-1"` content the runbook
requires (§11, §13, §15.1, §20), as panels/columns rather than as a table filter value.

### 33.3 Outstanding

Operator review and commit of both stages together; `npx tsc --noEmit`, the affected unit/
integration suites, `eslint` and `git diff --check` (exact commands in `issues.md`); then the
Admin Centre DEV batch (**migration 096 → `npm run db:privileges` → code**), combined ISSUE-160 +
ISSUE-161 DEV acceptance and role-based Playwright (runbook §24's deferred UI row). PROD follows
the ISSUE-155/151 contract separately. Neither ISSUE-160 nor ISSUE-161 is resolved.

*Superseded 2026-09-12 by §34 — both stages committed, deployed to DEV in the Admin Centre batch
and accepted; ISSUE-161 is RESOLVED.*

### 33.4 Validation repair pass — 2026-09-11 (Sonnet 5, high)

The operator ran the Stage 2 validation and returned real results: `npx tsc --noEmit` PASS;
`tests/integration/admin-season-lists.test.ts` 40/40 and `tests/integration/admin-draft.test.ts`
45/45 PASS; `git diff --check` PASS; the auth/unit batch **3 failed** of 201; eslint **1 new
error**. Three concrete defects were fixed, plus one genuine contract gap the failures led back
to on inspection (not itself a reported failure):

1. **Stale nav expectations** (`tests/auth.test.ts`) — two tests still asserted the Data group's
   href list from before `/admin/season-lists` existed. Both updated to include it, in the correct
   position (after `/admin/draft`); the section-order test's description text updated to match. No
   capability test was weakened; `/admin/season-lists` was not removed from anywhere.
2. **`generateMetadata` guard-first defect (real).** `src/app/admin/season-lists/[season]/page.tsx`
   and `.../[season]/[club]/page.tsx` both derived their dynamic titles from `params` with no
   capability check at all — an oversight, not a deliberate omission: no other admin page in this
   repository uses `generateMetadata` (every other one, including this repo's own `/admin/draft/
   [id]`, uses a static `export const metadata`), so there was no existing pattern to follow, and
   `requireCapability('data.seasonLists.read')` simply hadn't been added. Fixed by adding it as the
   literal first statement of `generateMetadata` in both files, before `await params` — matching
   the exact contract every other admin boundary (including each page's own default export) already
   meets. Not special-cased in the test; the existing generic scanner now passes both functions on
   its own terms.
3. **`AddPlayerPanel.tsx` lint error (real).** One internal admin link (`/admin/draft/new`) used a
   plain `<a>` instead of `next/link`'s `Link`, forcing a full page reload. Replaced with `Link`.
   (The file's two OTHER `<a>` tags, to public `/players/<slug>-<id>` pages, are unaffected and
   correct — they match the exact pattern the repo's own `/admin/draft/[id]` and `/admin/draft`
   pages already use for the same "view public page" links, which is why only one of the three
   `<a>` tags in this pass's files was flagged.)
4. **Departed-since-S-1 / `+added/-departed vs S-1` (a genuine missed MANDATORY contract item, not
   an optional nicety — confirmed by re-reading §11 and §20 of this runbook, which name
   `"changes vs S-1 (+added / -departed, computed by organisation)"` as explicit content for the
   season overview's club cards, and §15.1/§13 which reference a `"departed since S-1"` panel).**
   This was NOT one of the reported test/lint failures — it surfaced only because the operator's
   instruction to re-inspect the earlier "deviation" record before declaring Stage 2 complete led
   back to the runbook text, which does not hedge it as optional. Fixed: two additive, read-only
   Stage 2 query functions (`readSeasonListChanges(season)`, `readDepartedSincePreviousList(season,
   clubSlug)`, both in `admin-season-lists.ts`, no migration, no invariant touched) computed
   PER CLUB with the S-1 side scoped by organisation (so a rename never double-counts a continuing
   player); the season overview's club cards now show the `+X / −Y` delta instead of a raw prior
   count, correctly labelled non-authoritative appearances for 2027 and list-to-list from 2028; the
   club page gained a "Departed since S-1" panel for `season > FIRST_LIST_SEASON` (for 2027 itself
   the existing appearances review panel already shows the identical set, clearly labelled, so a
   second copy of it was not built).

**Files changed by the repair pass:** `tests/auth.test.ts` (2 stale expectations),
`src/app/admin/season-lists/[season]/page.tsx` (guard fix + the change-delta column, replacing the
raw comparison column), `src/app/admin/season-lists/[season]/[club]/page.tsx` (guard fix + the
Departed panel), `src/app/admin/season-lists/AddPlayerPanel.tsx` (Link fix),
`src/db/queries/admin-season-lists.ts` (`readSeasonListChanges`, `readDepartedSincePreviousList`
added).

No backend semantics were touched: migration 096, `season_list_members` invariants, the
add/remove/transfer/copy mutation functions, the replay branch, `FIRST_LIST_SEASON`, and the
ISSUE-160 no-auto-membership rule are all unchanged. The two new functions are plain, read-only
`SELECT`s.

### 33.5 Local completion audit — 2026-09-11 (Opus 5, high)

The §33.4 repair pass had never been re-validated. It now has been, together with a full local
audit of Stage 1 + Stage 2 as one feature. The operator explicitly authorised command execution
for this task (CLAUDE.md §9 exception); nothing was committed, pushed, merged or deployed, DEV and
PROD were untouched, and no ISSUE-162 work was started.

Tree clean at audit start (HEAD `1441a5b`). Preflight `--mode implementation --issue 161`:
**READY, 0 blockers, 3 expected warnings** (096 branch-local; `psql`/`pg_restore` unavailable and
not required in this mode).

| Gate | Result |
|---|---|
| `npx tsc --noEmit` | PASS |
| `auth` + `admin-season-list-actions` + `admin-draft-actions` | **204 passed** (201 + this audit's 3 new tests) |
| `integration/admin-season-lists` + `integration/admin-draft` | **85 passed** (40 + 45) |
| `data-overrides-source-contract` + `db-promotion-check` + `current-season-import` + `reference-data` | **420 passed, 4 skipped** |
| `integration/fk-indexes` | **2 passed** |
| `eslint` over every ISSUE-161-authored file | **0 problems** |
| `git diff --check` | PASS |

The 4 skips are the ISSUE-130 R-runtime "alternate checkout" cases, which do not run on the
Windows workstation. Two lint findings elsewhere (`no-assign-module-variable` in
`tests/current-season-import.test.ts`, two `_total` unused-var warnings in `players.ts`) were
proved pre-existing at `436d0c9` rather than assumed so.

**One concrete defect, fixed narrowly.** `CopyForwardPanel.tsx` left the club checkboxes live
after a dry run returned while replacing the Preview control with Confirm, so changing the
selection afterwards offered only Confirm — which builds its form from the live selection and
would have written a club set the displayed plan did not describe, with no route back to a
preview. Copy-forward is this feature's only bulk write and §11a/§20 make preview-before-confirm
its safety control. The confirm branch is now gated on the preview still describing the live
selection (`previewedKey`); a changed selection retires the preview, says so in a `role="status"`
notice, and offers Preview again. Client-only — no action, query, transaction, invariant or
migration changed. Three regression cases added to `tests/admin-season-list-actions.test.ts`.

Everything else audited clean: canonical semantics, no retired/lifecycle state, I-1 and the D-3
evidence, fixture independence, the eligibility rule, add/remove/transfer/copy-forward contracts,
the appearances review surface, the ISSUE-160 handoff (navigation only), the departed/changes
content §33.4 added, guard-first permissions on every page/`generateMetadata`/action, nav, the
behaviour-preserving `player-identity.ts` extraction, the stable key, the `data_overrides`
contract, the fail-closed replay and its binding order, single-writer source authority, promotion
classification and deploy order, transaction atomicity, UI freshness, and the static responsive/
keyboard review. No unrecorded deviation was found. **No rendered acceptance is claimed.**

**Files changed by the audit (uncommitted):** `src/app/admin/season-lists/CopyForwardPanel.tsx`,
`tests/admin-season-list-actions.test.ts`, plus this section, `issues.md` and `IssuesIndex.md`.

Remaining gates are all external/batch-deployment: DEV migration 096, DEV `npm run db:privileges`,
DEV rebuild/deploy, live three-role Playwright, rendered responsive/focus acceptance, later PROD
promotion/probes, and the release-time S-1 decision inherited from ISSUE-160. ISSUE-161 stays
**OPEN** and code-complete pending the combined Admin Centre DEV acceptance.

*Superseded 2026-09-12 by §34.*

---

## 34. Resolution — 2026-09-12 (combined Admin Centre DEV acceptance)

**Status:** Resolved. Closed on the operator's DEV acceptance of the combined Admin Centre batch
(ISSUE-160 + 161 + 162 + 163). PROD untouched; no PROD validation is claimed. This closeout changed
tracking only.

### 34.1 What reached DEV

- `main` at `3272434`: Stage 1 `97af605`, Stage 2 `1441a5b`, the §33.5 `CopyForwardPanel` fix, and
  the batch-wide responsive commits `e638d61` ("Improve admin responsive layout"), `9727ad5`
  ("Improve admin mobile responsive layout"), `ae3c4e0` ("Fix admin table header positioning") and
  `aeb41f3` ("Fix season list mobile overflow").
- DEV database: migration 096 applied and privileges reconciled before the code, the binding order
  §26 / §33.3 required. Production build PASS, 1533/1533 static pages, `afldb.service` healthy,
  `/api/health` `status=ok`, `database=ok`.

### 34.2 §24's deferred UI row — closed

- Functional workflows PASS; the 2027 club lists are usable (first authoritative season, D-2);
  Admin (read) / Super Admin (edit) permissions accepted; desktop 1440 and 1024 PASS; tablet 768
  PASS; global navigation PASS; accessibility/focus spot checks PASS; no blocking console/runtime
  errors.
- Mobile (375) final acceptance PASS after `aeb41f3`: the "First authoritative season" and season
  badges wrap without overlapping adjacent cells; no page-level horizontal overflow; the
  visually-hidden Actions header remains accessible; Remove / Transfer remain reachable through
  contained table scrolling. Measured document width 360 against the 375 viewport on
  `/admin/season-lists`, `/admin/season-lists/2027` and `/admin/season-lists/2027/adelaide`.
- Widths ran at 1440 / 1024 / 768 / 375 under the operator's device-priority decision of
  2026-09-12 (laptop/desktop primary, iPad/tablet first-class, phone functional fallback) rather
  than the 320 / 768 / 1000 / 1280 / 1920 set §24 named; the operator directed that the batch is
  not held open for phone-only cosmetic polishing.

### 34.3 Carried forward (not closure conditions)

- PROD promotion follows the ISSUE-151 contract separately (§19, §26): migration 096 →
  `npm run db:privileges` → code, `season_list_members` replayed after `players`. Recorded on the
  `AFLDB-ISSUE-156` umbrella's promotion checklist.
- D-8 external-source reconciliation stays a separate ISSUE-156 child when a source is chosen
  (§15.2); no ID allocated.

---

<!-- afldb-merge-readiness
{"status": "ready", "hardBlockers": [], "expectedFiles": ["AFLDB-ISSUE-161.md", "issues.md", "IssuesIndex.md", "AFLDB-ISSUE-156.md", "CHANGELOG.md", "src/db/migrations/096_season_list_members.sql", "src/db/queries/admin-season-lists.ts", "src/db/queries/player-identity.ts", "src/db/queries/admin-draft.ts", "src/db/queries/players.ts", "src/lib/acquisition/manual-authority.ts", "tools/migration/common.py", "tools/migration/import_fitzroy_core.py", "tools/db/promotion-inventory.ts", "docs/production-promotion.md", "tests/admin-season-list-actions.test.ts", "tests/integration/admin-season-lists.test.ts", "tests/data-overrides-source-contract.test.ts", "tests/db-promotion-check.test.ts", "tests/current-season-import.test.ts", "src/lib/auth/capabilities.ts", "src/app/admin/nav-model.ts", "src/app/admin/season-lists/page.tsx", "src/app/admin/season-lists/[season]/page.tsx", "src/app/admin/season-lists/[season]/[club]/page.tsx", "src/app/admin/season-lists/actions.ts", "src/app/admin/season-lists/validation.ts", "src/app/admin/season-lists/submit-helper.ts", "src/app/admin/season-lists/AddPlayerPanel.tsx", "src/app/admin/season-lists/AppearancesReviewPanel.tsx", "src/app/admin/season-lists/DraftSuggestionsPanel.tsx", "src/app/admin/season-lists/MemberActions.tsx", "src/app/admin/season-lists/CopyForwardPanel.tsx", "src/app/admin/draft/submit-helper.ts", "src/app/admin/draft/actions.ts", "src/app/admin/draft/NewPickWizard.tsx", "src/app/admin/draft/[id]/page.tsx", "tests/auth.test.ts"], "validation": ["Stage 1: npx tsc --noEmit: clean", "Stage 1: tests/admin-season-list-actions.test.ts: 25 passed", "Stage 1: tests/integration/admin-season-lists.test.ts: 40 passed (twice, idempotent teardown)", "Stage 1: tests/integration/admin-draft.test.ts (ISSUE-160 regression): 45 passed", "Stage 1: data-overrides-source-contract + db-promotion-check + current-season-import: 382 passed", "Stage 1: fk-indexes + auth: 132 passed", "Stage 1: all tests/*.test.ts: 4227 passed, 14 skipped, 1 pre-existing Windows-CRLF-only failure (finals-semantics-contract, untouched file)", "Stage 1: eslint on every changed file: clean", "Stage 1: git diff --check: clean", "D-3 probes: (a) 249 multi-club player-seasons, latest 1992; (b) season >= 2000 = 0 rows", "Stage 2 (first operator run): npx tsc --noEmit PASS; tests/integration/admin-season-lists.test.ts 40/40 PASS; tests/integration/admin-draft.test.ts 45/45 PASS; git diff --check PASS; auth/unit batch 198 passed, 3 failed (2 stale nav expectations + 1 real generateMetadata guard defect x2 files); eslint 1 new error (AddPlayerPanel.tsx internal <a>)", "Stage 2 repair pass applied 2026-09-11: all four findings fixed, plus a genuine missed mandatory contract item (+added/-departed vs S-1, departed-since-S-1 panel) found on re-inspection and implemented -- operator re-run of the AFTER FIXES commands NOT YET reported back", "Local completion audit 2026-09-11 (Opus 5 high, operator-authorised commands): preflight READY (0 blockers, 3 expected warnings); npx tsc --noEmit PASS; auth + admin-season-list-actions + admin-draft-actions 204 passed; integration/admin-season-lists + integration/admin-draft 85 passed; data-overrides-source-contract + db-promotion-check + current-season-import + reference-data 420 passed / 4 skipped (ISSUE-130 R-runtime, platform-gated); integration/fk-indexes 2 passed; eslint clean over every ISSUE-161-authored file (the no-assign-module-variable error and two _total warnings are pre-existing at 436d0c9); git diff --check PASS. The Stage 2 repair pass is re-validated.", "Local completion audit found and fixed ONE concrete defect: CopyForwardPanel could confirm a copy-forward the operator never previewed (checkboxes stayed live after a dry run while only Confirm was offered). Confirm is now gated on the preview still describing the live selection; 3 regression cases added to tests/admin-season-list-actions.test.ts. Client-only -- no action, query, transaction, invariant or migration changed.", "DEV acceptance 2026-09-12 (combined Admin Centre batch, main 3272434): migration 096 applied and privileges reconciled before the code; production build PASS, 1533/1533 static pages; afldb.service healthy; /api/health status=ok database=ok", "Rendered acceptance 2026-09-12: functional workflows PASS; 2027 club lists usable; Admin/Super Admin permissions accepted; 1440/1024/768 PASS; 375 mobile PASS after aeb41f3 (badges wrap, no page-level horizontal overflow, visually-hidden Actions header accessible, Remove/Transfer reachable through contained table scrolling; document width 360 vs viewport 375 on /admin/season-lists, /2027 and /2027/adelaide)", "RESOLVED 2026-09-12 (AFLDB-ISSUE-161.md §34)"]}
-->
