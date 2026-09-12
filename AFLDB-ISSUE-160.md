# AFLDB-ISSUE-160 — Draft administration and new-player intake through the draft (ISSUE-156 P3b)

**Status:** **RESOLVED 2026-09-12.** Both stages (`91935b9`, `a947e52`), the 2026-09-11 audit fixes and §18 list-contract closure, and the §20 `/admin/draft/[id]` revision-read fix (`e6c4e8c`) are in `main` at `3272434`, deployed to DEV and accepted there in the browser on 2026-09-12 as part of the combined Admin Centre batch (160 + 161 + 162 + 163): production build PASS, `/api/health` ok, capability-scoped list/detail access, Super Admin editing, source-owned and linked/unlinked selections rendered, notes-override Save, stale two-tab compare-and-swap refusal, active-override/audit behaviour, and responsive acceptance at 1440/1024/768/375 — the gate 15/16 record is **§21**. Carried forward to the PROD promotion stage (owned by the `AFLDB-ISSUE-156` umbrella, not closure conditions): the gate-2 PROD probes (d)/(e)/(g)/(h), operator decision **S-1** (§11.1) and gate 9's real-importer half. Not observed in the browser and not claimed: a manual-provenance `/admin/draft/[id]` row (none existed on DEV during acceptance) — §21.3. Operator decisions D-1…D-9 decided 2026-09-11 (§12) and implemented as decided; **D-8 resolved to the J-3 HARD-REFUSAL branch** from gate-2 probe (a). PROD untouched throughout; no PROD validation is claimed. The pre-closeout history below (§0–§20 and the former *Next action*) is retained as written.
**Severity:** Medium
**Area:** Admin / Data management / Acquisition (DraftGuru, AFL Tables) / Promotion lineage
**Created:** 2026-09-11
**Parent:** `AFLDB-ISSUE-156` (umbrella) — supplemental child **P3b**, inserted after P3 (`AFLDB-ISSUE-159`); P4–P12 keep their labels
**Branch:** `opus/issue-160-draft-admin` · worktree `D:\dev\afldb-issue-160` (cut from `main` @ `af6379e`, which already contains the merged ISSUE-159)
**Migration:** **none required** (§10). Next free number on this branch is **096** (highest is `095_coach_admin_overrides.sql`); it is *not* allocated here.
**Planning model:** Fable 5.1, high. **Implementation:** Opus 5 high for Stage 1 (§17).

This document was a planning deliverable and is now the executed Stage 1 contract. Everything
below is the plan as approved; where implementation deviated from it, the deviation is recorded
in `issues.md` rather than edited into the plan, so the two can be compared. The three
deviations are: capabilities (D-6) deferred to Stage 2, because `tests/auth.test.ts` fails on a
capability declared but enforced nowhere and Stage 1 ships no route; §15's `/admin/data-editor`
page changes split, with only the backend refusals and the dead `CreatePlayerForm` block done
in Stage 1; and J-16's tracked-rule source, which §7 names as
`data/reference/afltables-contract.json` — that file does not exist, and the tracked player
profile-continuity rules live in `tools/rebuild/fitzroy/fitzroy-contract.json`
(`profile_url_continuity.rules[]`), which is what the rule is implemented against. One probe
correction: §16 gate 2 probe (g) names `data_edits.edited_at`; the column is `created_at`.

---

## 0. Preflight verification

### 0.1 Verified natively on this branch (2026-09-11)

| Fact | Where |
|---|---|
| ISSUE-160 is unallocated: no `AFLDB-ISSUE-160` in `issues.md`, `IssuesIndex.md`, any `AFLDB-ISSUE-*.md`, `issues/open/**`, `issues/closed/**`, `CHANGELOG.md`; `git log --all` matches only commit hash `0160d66`; no branch/worktree other than this one | searched 2026-09-11 |
| Highest migration is `095_coach_admin_overrides.sql` (ISSUE-159, merged in `af6379e`); `git log --all -- 'src/db/migrations/096*'` is empty | `src/db/migrations/` |
| `draft_picks` DDL and constraints | migrations 006, 019, 069 |
| `draft_picks` reload key = `(source_id, player_url, draft_year, draft_kind)` UNIQUE, **partial `WHERE source_id IS NOT NULL`, `NULLS NOT DISTINCT`**; admin-created picks are deliberately outside it | `069_draft_source_identity.sql:56-59` |
| `draft_picks_link_ck`: `player_id` set ⇔ `link_status_value IN ('unique','resolved')` | `019:109-113` |
| `players` has **no** `source_id`, **no** UNIQUE on `slug` (index only; URLs are `/players/<slug>-<id>`, id-authoritative) | `002_core_entities.sql`, `src/lib/format.ts:187` |
| `external_identities (source_id, external_id)` UNIQUE; `status link_status`; `match_method text` | `002_core_entities.sql` |
| `sources.key = 'manual_admin_edit'` exists (kind `manual`) | `057_data_edits.sql:36-42` |
| `data_overrides.entity_type` CHECK admits `players, matches, draft_picks, coaches, match_coaches`; `data_edits.table_name` CHECK admits `players, matches, draft_picks, award_winners, hall_of_fame, honour_team_members, brownlow_vote_entry_state, brownlow_season_authority, coaches` | `095:75-83`, `095:105-117` |
| `createPlayerInTransaction()` already creates a player **and an optional `draft_picks` row with `source_id`, `source_record_id`, `player_url`, `draft_person_id` all NULL** and `link_status_value='resolved'`; callers: `createPlayer()` (data editor) and `createPlayerAndResolveLink()` (player-links) | `src/db/queries/players.ts:291-415,428-457`; `player-links.ts:527` |
| `saveEdit()` for `draft_picks` builds the override key as `` `${source_id}|${player_url}|${draft_year}|${draft_kind}` `` — for an admin-created row that is the literal string `null|null|<year>|null` | `src/db/queries/data-edits.ts:149-157` (**latent defect DEF-1**, §13) |
| `replay_admin_overrides(conn, 'draft_picks')` only UPDATEs source-owned rows keyed on `source_id::text || '|' || player_url || …` (NULL for admin rows → never matches); it never INSERTs | `tools/migration/common.py:1019-1033` |
| `replay_admin_overrides(conn, 'players')` joins `sources` **by the key prefix of `entity_key`** and `external_identities` by `external_id` + `status IN ('unique','resolved')` — already generic over any source key | `common.py:903-951` |
| `replay_admin_overrides(conn, 'coaches')` has the manual-row re-create branch (`manual_admin_edit:<token>` → `INSERT … ON CONFLICT DO NOTHING`), fail-closed pre-check first | `common.py:1050-1175` |
| DraftGuru importer: identity authority = tracked ledger → live `player_link_resolutions` → optional bridge → unmatched; **names are never identity**; only ledger `draftguru`-target decisions seed a player (`seed_player`); write scope is `source_id = draftguru` so admin rows are untouched | `tools/rebuild/draftguru/import_draftguru.py:27-33,494-577,579-684,768-895` |
| AFL Tables importer resolves an existing player **through `external_identities` (`afltables`, `afltables_profile_url`, `unique/resolved`) before inserting**; the identity upsert refuses a path already mapped to a different player | `tools/migration/import_fitzroy_core.py:2456-2490,2638-2688` |
| The nightly settle **never creates a player**: a debutant whose profile url is not registered is `unresolvedIdentityPlayer`, held, not invented | `src/lib/acquisition/settle-afltables.ts:1684-1692`; `deploy/afldb-settle-afltables.sh:146-166` (settle = `tools/current-season/settle-afltables.ts`) |
| Players are created only by `import_fitzroy_core.py` (operator-run, `players` group), `import_draftguru.py` (`seed_player`, ledger only) and `players.ts` | grep `INSERT INTO players` |
| Promotion: `draft_picks`, `draft_persons`, `players`, `external_identities`, `player_career_stats` are registry (import-writable) tables → **rebuilt**; `data_overrides` and `data_edits` are `reinstate`; `data_edits.row_id` lineage targets are `players` (`afltables_profile_url`), `matches`, `coaches` only — **`draft_picks` audit rows have no target and are reinstated unremapped and unflagged** | `tools/db/promotion-inventory.ts:325-380,1420-1470,1530-1576` |
| `docs/production-promotion.md` §8 replay loop names `players, matches, coaches, match_coaches` — **omits `draft_picks`** although the inventory note (`:2832`) says every admitted entity type (**DEF-3**) | `docs/production-promotion.md:641-651` |
| Privileges: `afldb_import` has full DML on the registry tables (`players`, `draft_picks`, `external_identities`), `INSERT` on `data_edits`, narrow `INSERT/UPDATE` on `data_overrides`; `afldb_auth` has `SELECT` on `players` only and nothing on `draft_picks`/`data_overrides` | `tools/maintenance/privileges.sql:285-330,435-500` |
| Capabilities after 158/159: 20 in the union; `data.dataEditor`, `data.playerLinks`, `data.coaches.edit` SUPER_ADMIN_ONLY; `data.coaches.read`, `operations.audit.read` ADMIN_AND_UP; `tests/auth.test.ts` fails on any declared-but-unenforced capability | `src/lib/auth/capabilities.ts`, `tests/auth.test.ts:1003-1031` |
| ISSUE-159 admin patterns available for reuse: import-role transaction shape (`src/db/queries/admin-coaches.ts:362-464`), refusal audit, `revalidatePaths` returned from the action and POSTed to `/admin/coaches/revalidate` **after** the action (`submit-helper.ts`, `revalidate/route.ts`, `revalidate-paths.ts`), `useActionFocusRestore`, provenance filter UI (`coaches/page.tsx`), forced `data_edits` failure trigger (`tests/integration/admin-coaches.test.ts:150-196`) | those files |
| Public draft surfaces: `/draft` and `/draft/[year]` are `force-dynamic`; `/players/[slug]` is ISR `revalidate = 3600`; `/players` is `force-dynamic`; `/sitemap.xml` is `revalidate = 86400` and enumerates players; club pages do not render draft data | `src/app/draft/**`, `src/app/players/**`, `src/app/sitemap.ts` |
| Frozen draft event kinds (10 + the 1981/82/87 absent-column case): `national`, `rookie`, `trade`, `preseason`, `pre_draft`, `midseason`, `post_draft`, `free_agency`, `mini_draft`, `training_squad_selection`; **`draft_kind` is an enumeration, never derived from `draft_type`**; `pick_number` is NULL for trades, free agency and signings | `data/reference/draftguru-event-kinds.json`; `069:22-23` |

### 0.2 Operator-executed at implementation start (not run during planning)

1. `npm run preflight -- --mode implementation --issue 160` from this worktree — resolve every `FAIL`.
2. Re-confirm ISSUE-160 free and 096 unallocated (same searches as §0.1 row 1–2; also `git branch -a --contains main`).
3. The historical data-shape probes in §16 gate 2 (read-only SQL against `afldb_test` after `db:test:rebuild`, or DEV read-only; probes (d), (g) and (h) also on PROD read-only) — their outcomes select the pre-authorised branch of §7 rule J-3 (D-8: no further operator decision), size §12 D-7, and enumerate the DEF-1 residue (§13). The probe results are recorded verbatim in the implementation evidence.

---

## 1. Problem statement

Draft data can only enter or change in AFLDB through the DraftGuru importer, the generic
`/admin/data-editor` draft slice (seven text/measurement fields, no year/pick/club/player
change, no creation), or `CreatePlayerForm`'s optional draft block. None of these gives an
Admin/Super Admin a supported way to: add a missing selection; correct pick number or club;
enter a genuinely new draftee as a first-class player; or see provenance and override state.

Worse, the two admin write paths that do exist are unsafe across reloads and promotions:

- an admin-created pick has **no provenance and no identity** (`source_id`, `player_url`,
  `source_record_id` all NULL) — it is outside the reload key by design (069), survives a
  DraftGuru reload only by being ignored, and **does not exist in a promoted database** because
  `draft_picks` is rebuilt and no replay re-creates it;
- an admin-created player likewise has **no promotion identity**: nothing in
  `external_identities` names it, so the `players` replay cannot patch it, no replay re-creates
  it, and its `data_edits` rows (`player_creation`) are unresolvable by `afltables_profile_url`,
  which **stops a PROD promotion** (`promotion-inventory.ts` remediation: “A row that does not
  resolve is NOT dropped … the promotion stops”);
- editing an admin-created pick in the data editor writes a `data_overrides` row keyed
  `null|null|<year>|null` — shared by every admin pick of that year (UNIQUE
  `(entity_type, entity_key, field_group)` makes the second edit overwrite the first's
  override) and never matched by replay (DEF-1).

ISSUE-160 gives draft administration one authoritative, audited, replayable, promotable
mutation contract and adds the missing case: onboarding a new person into AFLDB through their
draft selection, with search-before-create and future source-identity attachment that enriches
that same player rather than minting a second one.

## 2. Target behaviour (summary)

| Capability | Contributor | Admin | Super Admin |
|---|---|---|---|
| View / search / filter selections, see provenance, override and conflict state (`/admin/draft`, `/admin/draft/[id]`) | ✗ | ✓ | ✓ |
| Correct fields of a source-owned selection (durable override) | ✗ | ✗ | ✓ |
| Add a missing selection for an **existing** player | ✗ | ✗ | ✓ |
| Add a selection **and create a new player** (search-first, duplicate-checked, atomic) | ✗ | ✗ | ✓ |
| Edit / relink / retire a manual selection | ✗ | ✗ | ✓ |
| Attach a later AFL Tables profile identity to a manual player | ✗ | ✗ | ✓ |
| Link an unresolved **source-owned** selection to a player | — existing `/admin/player-links` (`data.playerLinks`), deep-linked, not re-implemented | | |
| Relink/unlink an already-linked source-owned selection; merge two existing players | **refused, P9** | | |

---

## 3. Canonical identity model

### 3.1 One draft selection

| Property | Source-owned row (DraftGuru) | Manual row (ISSUE-160 contract) | Legacy admin row (pre-160, `createPlayerInTransaction`) |
|---|---|---|---|
| Primary key | `draft_picks.id` (rebuilt on promotion; never identity) | same | same |
| Durable identity | `(sources.key='draftguru', player_url, draft_year, draft_kind)` — migration 069 | **`(sources.key='manual_admin_edit', player_url = 'manual:<token>')`**, token = `randomUUID()` minted once at creation, never edited, never name-derived | none (`source_id` NULL) — outside every identity; **not promotable** |
| `source_id` | draftguru | manual_admin_edit | NULL |
| `source_record_id` | `<source_url>#<row_index>` (per-load) | `<token>` | NULL |
| `player_url` | DraftGuru person page (contract regex `^https://www\.draftguru\.com\.au/players/[^/]+/[1-9][0-9]*$`) | `manual:<token>` — cannot collide with the DraftGuru regex | NULL |
| `draft_person_id`, `dg_person_id` | set | NULL | NULL |
| `draft_year`, `draft_kind` | **identity-bearing** (year page is the source url; kind separates a person's two events on one board) | correctable facts (the token is the identity) | — |
| `draft_type` | derived from the frozen event mapping | chosen from the same frozen `(draft_type, draft_kind)` pairs | — |
| `pick_number` | correctable fact (NULL for trades/free agency/signings) | correctable fact, nullable | — |
| `club_id` | resolved by slug from the frozen contract; correctable | **required**, must be the identity active in `draft_year` (`afldb_identity_for_season`) | — |
| `player_id` / `link_status_value` | person-grained via `draft_persons`; changed only through `/admin/player-links` | **always set**, `'resolved'`; changed only by the manual-relink action | set, `'resolved'` |
| `player_name_raw` | verbatim source text; overrideable | the player's `display_name` at creation; editable text | display name |
| `data_overrides` key | `<source_id>|<player_url>|<year>|<kind>` (existing, unchanged; R-7) | **`manual_admin_edit:<token>`**, `field_group = 'selection'`, whole-row payload | garbage `null|null|…` (DEF-1) — inert; **left as frozen historical residue** (§13); the writer is removed by D-5 |
| `data_edits` target | `('draft_picks', id)` (existing) | **`('players', player_id, 'draft_selection')`** with the token in `new_values` (§9.2) | — |
| Promotion identity | new rule `draft_pick_key` (§11, D-3) | re-created by the `draft_picks` manual replay branch (§8.2); audit resolves through the player | vanishes; adopt action (§6.4b, D-7) — which also mints the linked player's identity when it has none |

**Uniqueness claims and their proof status.** Proven by construction: one source person cannot
have two rows in the same `(year, kind)` (the reload key; `build_picks` refuses a duplicate key).
Proven by 069: 23 people appear twice in one year under different kinds, so *same player, same
year, different kind* is legitimate. **Unproven** (gate 2 probes): whether `(draft_year,
draft_kind, pick_number)` is unique for non-NULL picks across all kinds and years, and how many
NULL-pick rows each kind carries. Rule J-3 is written with both outcomes.

### 3.2 One player

| Property | Source-owned player (AFL Tables / DraftGuru seed) | Manual player (ISSUE-160 contract) |
|---|---|---|
| Primary key | `players.id` (rebuilt on promotion) | same |
| Durable identity | `external_identities (source afltables, external_id = 'players/<L>/<Name>.html', match_method 'afltables_profile_url', status unique/resolved)`; DraftGuru seeds carry `(draftguru, player_url)` | **`external_identities (source manual_admin_edit, external_id = <token>, match_method 'manual_admin_edit', status 'resolved', external_name = display_name)`**, minted once in `createPlayerInTransaction()` |
| Durable record | source | **`data_overrides ('players', 'manual_admin_edit:<token>', 'identity', payload)`** — the replay re-creates the row from it (§8.1) |
| `data_edits` | `('players', id, …)` | `('players', id, 'player_creation')` + later groups; resolvable through the widened identity rule (§11) |
| `display_name`, `given_name`, `surname`, `sort_name` | importer | required display name; given/surname supplied or split as today (`players.ts:302-312`); **`search_name`, `slug`, `sort_name` derived in SQL exactly as the importer and the replay do** (`afldb_normalise_name`, `regexp_replace(…,'\s+','-')`) so a replayed twin is byte-identical |
| `dob`, `dob_confidence`, `birth_year*` | importer / evidence | optional; when supplied `dob_confidence` defaults `sourced`, `birth_year` = year of dob (as today) |
| `player_career_stats` | derived rebuild | zero row seeded (as today) — the derived rebuild regenerates it |
| Later AFL Tables identity | n/a | attached by the admin action (§6.5) **or** refused by the importer guard (§8.4, D-2) — never auto-linked by name |
| Later DraftGuru identity | n/a | the DraftGuru row arrives unlinked; linked through `/admin/player-links` (existing, person-grained); made durable in the tracked ledger by a `manual_admin_edit` target (§8.3) |

A manual player is distinguished from an imported one solely by carrying a
`manual_admin_edit` identity and no other; provenance shown in the UI is derived from
`external_identities`, never from a name pattern.

---

## 4. Existing-player selection contract

1. Search uses the existing `searchPlayers()` (`src/db/queries/search.ts:84`) through the
   existing `/api/search/autocomplete?scope=players` route and `PlayerPicker` — ranking only.
2. The chosen `player_id` is submitted; **the server re-reads the player inside the mutation
   transaction** and resolves its identity string (`afltables:<path>` if registered, else
   `manual_admin_edit:<token>`) for the override payload. Nothing identity-shaped is trusted
   from the browser.
3. A player with no DraftGuru identity may be selected (that is the normal case).
4. Duplicate rules J-1, J-2, J-3 (§7) run in the same transaction before the INSERT.

Definitions used by §5 and §7:

| Term | Meaning |
|---|---|
| **Definite existing match** | the admin selected a player from search results (an id) |
| **Likely duplicate** | an existing player whose `afldb_normalise_name(display_name)` equals the typed name's normalised form, and whose `dob` is NULL, equals the typed dob, or — when both dobs are NULL — whose `birth_year` is NULL or equals the typed birth year |
| **Distinct namesake** | same normalised name, both dobs known and different (or both birth years known and different with dobs unknown) |
| **Ambiguous identity** | a likely duplicate exists and the admin supplied no dob — **hard refusal**, never a guess |

No fuzzy score decides identity anywhere; `similarity()` ranks search results only.

---

## 5. New-player-through-draft contract

**Path.** `createPlayerInTransaction(tx, input)` in `src/db/queries/players.ts` stays the one
player-creation primitive and is **extended** (all three callers benefit):

- mint `token = randomUUID()`; INSERT `players` deriving `search_name`, `slug`, `sort_name` in
  SQL (§3.2); seed `player_career_stats` (as today);
- INSERT `external_identities (manual_admin_edit, token, external_name, player_id, 'resolved', 0, 'manual_admin_edit', notes)`;
- INSERT `data_overrides ('players', 'manual_admin_edit:'||token, 'identity', payload, admin_user_id, true)` where payload =
  `{display_name, given_name, surname, dob, dob_confidence, birth_year, height_cm, weight_kg, notes}` (absent-vs-explicit-null preserved: keys are written only for supplied fields, `display_name` always);
- **remove** the `draftInfo` / `DraftPickInput` branch and its `INSERT INTO draft_picks`; the
  only `draft_picks` INSERT in `src/` becomes `src/db/queries/admin-draft.ts` (§6). The
  `createPlayerAction` form loses its draft block (§9 / D-5); `createPlayerAndResolveLink`
  never passed draft info and is unaffected apart from gaining identity;
- `createPlayerInTransaction` therefore needs `adminUserId` (the override row requires it):
  signature becomes `(tx, input, actor: { adminUserId })`; both callers already hold it.

**Minimum fields.** `display_name` (≤100). Everything else optional. The create step **requires
a dob whenever a likely duplicate exists** (§4 definitions), which is how the admin proves the
person is new; otherwise the action refuses with the candidate list.

**Combined workflow** (`createPlayerAndDraftPick` in `admin-draft.ts`) is **one import-role
transaction**: duplicate checks → `createPlayerInTransaction` → manual `draft_picks` INSERT →
`data_overrides ('draft_picks', 'manual_admin_edit:<pick token>', 'selection', payload)` →
`recordDataEdit('players', player_id, 'draft_selection', …)` (§9). Both entities get their own
token. Any failure rolls back player, identity, both overrides and both audits (§9.3 proofs).

**After success** the action returns the new `player_id`, slug, pick id and
`revalidatePaths` (`/players/<slug>-<id>`, `/sitemap.xml`); the UI links to
`/admin/draft/[id]` and `/players/<slug>-<id>` and states “External identity: none yet
(manual). AFL Tables identity attaches after debut (§6.5); DraftGuru links through Player
links when the source publishes this person.”

---

## 6. Mutation families (all in `src/db/queries/admin-draft.ts`, import-role transaction each)

| # | Function | Canonical write | `data_overrides` | `data_edits` |
|---|---|---|---|---|
| 6.1 | `saveSourcePickFields(pickId, groupKey, raw)` — groups `player_info`, `measurements`, `notes` (existing spec) **+ new `selection_facts` = {`pick_number`, `club_slug`}** | `UPDATE draft_picks` (club resolved slug→id in tx, must be active in `draft_year`) | upsert `('draft_picks', <069 key>, group, delta)` — the existing `saveEdit` logic moved here | `('draft_picks', id, group)` |
| 6.2 | `retireSourcePickOverride(pickId, groupKey)` | re-read source values? **No** — canonical stays as last written; the override is set `is_active=false` so the next reload restores source (159 precedent) | `is_active=false` | `('draft_picks', id, group)` with `note='override retired'` |
| 6.3 | `createManualPick(input)` (existing player) | INSERT manual row (§3.1) | INSERT `('draft_picks','manual_admin_edit:<token>','selection', full payload)` | `('players', player_id, 'draft_selection')`, `new_values` = payload + `pick_token` |
| 6.3b | `createPlayerAndDraftPick(input)` | §5 | player `identity` + pick `selection` | `player_creation` + `draft_selection` |
| 6.4 | `saveManualPick(pickId, payload)` — year/type+kind/pick/club/player/name/original_club/age/height/weight/note/detail | `UPDATE draft_picks` whole row | rewrite the single `selection` override (whole payload) | `('players', player_id, 'draft_selection')` — on **relink**, two rows: one against the old player (`draft_selection_unlinked`), one against the new |
| 6.4b | `adoptLegacyPick(pickId)` — `source_id IS NULL` rows only (**D-7**, full contract in §6.8) | set `source_id`, `player_url='manual:<token>'`, `source_record_id`; **and, when the linked player has no durable identity, mint that player's token + `external_identities` row in the same transaction** | INSERT pick `selection`; INSERT player `identity` (whole row) only when minted | `('players', player_id, 'draft_selection')`; plus `('players', player_id, 'identity_adopted')` only when minted |
| 6.5 | `attachAflTablesIdentity(playerId, path)` — manual players only | INSERT `external_identities (afltables, path, 'https://afltables.com/afl/stats/'+path, player_id, 'resolved', 0, 'afltables_profile_url', note)` | `UPDATE` the player's `identity` override: `afltables_profile_path = path` | `('players', id, 'source_identity')` |
| 6.6 | `retireManualPick(pickId)` | **`DELETE FROM draft_picks`** (D-4) | `is_active=false` | `('players', player_id, 'draft_selection_retired')`, `old_values` = full row |
| 6.7 | `supersedeManualPickBySourceRow(manualPickId, sourcePickId)` — optional compound: `resolveLockedLink()` from `player-links.ts` (exported, `:436`) for the source row + 6.6 in the **same** tx | as 6.6 + the link | as 6.6 | as 6.6 + `player_link_resolutions` (the link's own audit) |

### 6.8 `adoptLegacyPick` — the D-7 adoption contract (decided 2026-09-11)

One import-role transaction, Super Admin only (`data.draft.edit`), never a migration:

1. Re-read the pick inside the transaction. Refuse unless `source_id IS NULL` **and**
   `player_id IS NOT NULL` (a legacy row is by construction `'resolved'` to a player; an
   unlinked NULL-source row is a data defect and is reported, not adopted).
2. Resolve the linked player's **durable identity**, in this order, reading
   `external_identities` with `status IN ('unique','resolved')`:
   - an `afltables` / `afltables_profile_url` identity → `player_identity = 'afltables:<path>'`
     (more than one distinct path → refuse `ambiguous_identity`; nothing is chosen);
   - else a `manual_admin_edit` identity → `player_identity = 'manual_admin_edit:<token>'`;
   - else **mint**: `token = randomUUID()`; INSERT
     `external_identities (manual_admin_edit, token, external_name = display_name, player_id, 'resolved', 0, 'manual_admin_edit', note)`;
     INSERT `data_overrides ('players', 'manual_admin_edit:'||token, 'identity', payload, admin_user_id, true)`
     where payload is the **whole current row** (`display_name, given_name, surname, dob,
     dob_confidence, birth_year, height_cm, weight_kg, notes`, non-NULL keys only,
     `display_name` always); `recordDataEdit('players', player_id, 'identity_adopted', …)`
     with the token in `new_values`. A second player identity is **never** minted when a
     valid durable identity already exists.
3. Mint the **pick** token; `UPDATE draft_picks SET source_id = <manual_admin_edit>,
   player_url = 'manual:'||token, source_record_id = token WHERE id = $1 AND source_id IS NULL`
   (0 rows updated → refuse `stale`); INSERT `data_overrides ('draft_picks',
   'manual_admin_edit:'||token, 'selection', payload)` with the resolved `player_identity`,
   `club_slug`, `draft_year`, `draft_kind`, `draft_type`, `pick_number` and the text fields;
   `recordDataEdit('players', player_id, 'draft_selection', …)` with `pick_token` and
   `adopted_from_pick_id` in `new_values`.
4. `draft_kind` is required by the `selection` payload and a legacy row may carry only
   `draft_type`: the action derives nothing — the admin selects the `(draft_type, draft_kind)`
   pair from the frozen enumeration in the adopt form, and J-1/J-3/J-5/J-6/J-8/J-9 run before
   the UPDATE exactly as for `createManualPick`.

Post-condition (gate 12 proves it): both the player and the pick are replayable by §8.1/§8.2
and promotable by §11 — the pick now carries a `draft_pick_key`, so any pre-existing
`data_edits` row with `table_name='draft_picks'` pointing at it resolves under D-3 instead of
stopping the promotion; the player's `player_creation` audit rows resolve through the widened
`players` rule. Adoption is per row, attributed to the acting admin; no bulk backfill exists
because an override row requires an explicit `admin_user_id` (§10).

**Read helpers** (`listDraftPicksForAdmin`, `getDraftPickAdminDetail`, `readDraftOverrides`,
`listManualPlayersAwaitingIdentity`): canonical reads on the public client;
**override reads on the narrow server-side SELECT-only import-role helper** (ISSUE-159 D-2
precedent, `admin-coaches.ts:71-116`). No `privileges.sql` change (§10).

**Refusal audit** (`auth_audit_log`, best effort, `admin.draft_refused`) for refusals that
carry information: duplicate, conflict, stale, forbidden — not for empty-field validation.

---

## 7. Duplicate / conflict contract

| ID | Situation | Behaviour |
|---|---|---|
| J-1 | Manual pick for a player who already has **any** `draft_picks` row (source or manual) with the same `draft_year` **and** `draft_kind` | **hard refuse** (proven 0 in source data by the reload key) |
| J-2 | Same player, same year, **different** kind | allowed (23 legitimate cases in source) |
| J-3 | Another player already holds the same `(draft_year, draft_kind, pick_number)`, pick non-NULL | **gate-2 dependent, both branches pre-authorised (D-8, no further decision)**: probe (a) returns **0** valid historical collisions at that grain → implement **hard refuse**; probe (a) returns ≥1 → implement **explicit confirmation** that names and displays the colliding selection(s) (year, kind, pick, club, player). The implementer records the probe output in the evidence and follows the matching branch automatically; the branch not taken is not implemented. No `// J-3` marker: the probe runs before `admin-draft.ts` is written (§17 deliverable order) |
| J-4 | Same club + same non-NULL pick in the same year/kind, different player | covered by J-3 (a pick number belongs to one club per draft) |
| J-5 | Pick number NULL | allowed for kinds whose source rows are NULL-numbered (probe: `trade`, `free_agency`, and any kind with NULL rows); for `national`/`rookie`/`preseason`/`midseason`/`pre_draft`/`post_draft`/`mini_draft` a NULL pick requires **explicit confirmation** with a `pick_note` |
| J-6 | Unknown club, or club not the identity active in `draft_year` | hard refuse (`afldb_identity_for_season`, as `players.ts:337-347` today) |
| J-7 | Historically renamed/merged club | the admin must pick the era-correct identity; the form lists only identities active in the year |
| J-8 | `draft_year` outside 1981..(current season + 1), or a year with no draft held (1983–1985 per contract `known_coverage_gaps`) | hard refuse; 1983–85 refuse with the contract reason |
| J-9 | `draft_kind` not in the frozen enumeration | hard refuse (the enumeration is the only representation) |
| J-10 | New player: **likely duplicate** exists and no dob typed | **hard refuse** — “select the existing player, or enter a date of birth that distinguishes them” |
| J-11 | New player: likely duplicate exists and dob typed equals theirs (or their dob NULL and birth years agree) | **hard refuse** |
| J-12 | New player: only distinct namesakes exist | **explicit confirmation** listing them with clubs/span/games |
| J-13 | New player: an **unlinked source-owned selection** in the same year+kind has the same normalised name (a `draft_persons`/`draft_picks` unmatched row) | **explicit confirmation**: “DraftGuru already lists this selection unlinked — link it in Player links instead?” (name assists the warning; never decides) |
| J-14 | Manual pick whose player already has a source-owned row for the same year+kind | J-1 refuses creation; for **existing** manual rows the list shows the **`duplicate` conflict state** and offers 6.6/6.7 |
| J-15 | `attachAflTablesIdentity`: path registered to another player | hard refuse — that is a merge (P9) |
| J-16 | `attachAflTablesIdentity`: player already has an AFL Tables identity, or path is named by a tracked `profile_url_continuity` / `profile_link_corrections` rule in `data/reference/afltables-contract.json` | hard refuse — a tracked, evidence-bound rule is never overridden from a browser (159 §4.3 precedent) |
| J-17 | Any change to `player_id` of a **source-owned** row, or unlink | **refused, P9** (source linkage is person-grained through `draft_persons` + `player_link_resolutions`; `/admin/player-links` handles only unresolved targets by design) |
| J-18 | Stale form (row changed since render) | compare-and-swap on a row revision (`updated_at` of the override or the audit `id` last seen) → refuse `stale` |

---

## 8. Source replay / durability / reconciliation contract

### 8.1 `replay_admin_overrides(conn, 'players')` — new manual branch, before the existing patch UPDATE

1. Fail-closed pre-check over active `players` overrides whose key prefix is
   `manual_admin_edit`: `display_name` present; if `afltables_profile_path` present, it must
   resolve to **0 or 1** players via `external_identities (afltables)`.
2. For each such override with **no** `external_identities (manual_admin_edit, token)` row:
   - if `afltables_profile_path` resolves to exactly one player → **bind**: INSERT the
     `manual_admin_edit` identity row pointing at that player (no `players` INSERT). This is
     what makes a promotion after the player's debut produce one row, not two;
   - else INSERT `players` from the payload (SQL-derived `search_name`/`slug`/`sort_name`),
     seed `player_career_stats`, INSERT the token identity row.
3. The existing patch UPDATE then applies (it already joins by source key).

Guard by `NOT EXISTS`, not `ON CONFLICT`: `players` has no natural unique key.

### 8.2 `replay_admin_overrides(conn, 'draft_picks')` — new manual branch

1. Fail-closed pre-check: `player_identity` resolves to exactly one player (`afltables:` via
   afltables identities; `manual_admin_edit:` via the token row — **so 8.1 runs first**);
   `club_slug` resolves; `draft_year`, `draft_kind`, `draft_type` present and `draft_kind` in
   the enumeration.
2. INSERT the manual row where `NOT EXISTS (source manual_admin_edit AND player_url = 'manual:'||token)`.
3. UPDATE every manual row from its payload (year/type/kind/pick/club/player/fields) — so a
   corrected year replays.
4. The existing source-owned patch UPDATE, extended with `pick_number` and `club_id` (from
   `club_slug`) under `jsonb_exists` semantics.

**Ordering** (binding): `players` → `draft_picks` → `coaches` → `match_coaches`
(`matches` anywhere). `docs/production-promotion.md` §8 loop gains `'draft_picks'` (DEF-3).
`import_draftguru.py:879` already calls the `draft_picks` replay after its reload; manual rows
are outside its scope and simply persist — the branch is exercised there for idempotency.

### 8.3 DraftGuru identity for a manual player (future)

- The importer never links by name, so when DraftGuru later publishes the person its row
  arrives **unlinked** (`draft_persons.link_status='unmatched'`), never as a second player.
- The admin links it through `/admin/player-links` (existing, person-grained). `read_live_decisions`
  honours that on every later reload of the same database.
- Cross-database durability: `tools/rebuild/draftguru/export_link_decisions.py` must emit a
  target `{source: 'manual_admin_edit', external_id: <token>}` when the linked player has no
  AFL Tables path but has a manual token; `apply_authority` gains the matching branch
  (resolve the token via `external_identities`, exactly one, else `ImportFailure`). Verify the
  exporter's current target derivation at implementation; if it already prefers an AFL Tables
  path this is an additive `elif`.
- Once the same selection exists as a source-owned row linked to the player, the manual row is
  a **duplicate selection** (J-14) and is retired (6.6) or superseded (6.7).

### 8.4 AFL Tables identity for a manual player (future) — the debut case

Facts: the settle never creates players (§0.1); it resolves a debutant only through a
registered `afltables_profile_url` identity; `import_fitzroy_core.py` (operator-run) resolves
existing players through the same registry before inserting. Therefore:

- **Attach-first is sufficient and immediate**: after 6.5 the very next settle applies the
  debutant's stats to the manual player, and the next operator fitzRoy import UPDATEs that
  player instead of inserting (`:2477-2497`), then upserts the identity to `'unique'` for the
  same `player_id` (`:2674-2683`).
- **Without attach-first, the operator-run fitzRoy import would insert a second player.** The
  existing architecture cannot prevent that on its own. This is stop condition **W-3**, resolved
  by operator decision **D-2 (approved with modification, 2026-09-11)**: a fail-closed guard in
  `import_players()` (`tools/migration/import_fitzroy_core.py:2521-2530`, the `else` branch that
  INSERTs a player whose profile path resolves to no registered identity).

  **Guard contract (binding):**

  | Property | Rule |
  |---|---|
  | Where it runs | **only** in the new-player INSERT branch. The UPDATE branch for a registered path is untouched; the nightly settle (`tools/current-season/settle-afltables.ts`) is untouched |
  | Candidate set | players that hold a `manual_admin_edit` identity (`external_identities`, `status IN ('unique','resolved')`) **and no** `afltables` identity — i.e. manual players still awaiting AFL Tables identity. Attached players (6.5) leave the set |
  | Match predicate | `afldb_normalise_name(<fact display_name>)` equals the candidate's `search_name` (SQL, same function both sides). Names are compared to **refuse**, never to link |
  | DOB rule (**symmetric**) | let `M` = the candidate's `players.dob`, `F` = the set of dobs in the fact (`PlayerFact.dobs`). **Either side unknown** (`M IS NULL` or `F` empty) → **REFUSE**. Both known and **any** `F` equals `M` → **REFUSE**. Both known and every `F` differs from `M` → **allow** the INSERT as a distinct namesake |
  | Outputs | exactly two: *safe to insert* (the INSERT proceeds unchanged) or **fail closed** (`RuntimeError`). No third path |
  | What it never does | never writes `external_identities`; never attaches a source identity to any player; never sets `player_id` anywhere; never decides which player a profile is. **Name/DOB can refuse an unsafe insert but can NEVER silently link a player** (invariant §3.2) |
  | Failure semantics | the `RuntimeError` names the manual player id(s), their display name(s) and the AFL Tables profile path; `import_batch` (`common.py:263-275`) catches it, **rolls back the entire fitzRoy players batch** (every UPDATE and INSERT of that run, not only the refused player), marks the `import_batches` row `failed` with the error text recorded, and re-raises, so the operator's terminal shows it |
  | Operator correction | attach the identity in `/admin/draft` (6.5) **or** record a distinguishing `dob` on the manual player, **then rerun** `import_fitzroy_core.py` for the `players` group. A legitimate new source player who merely shares a name with an undated manual player is therefore held, not lost |
  | Test surface | the guard's predicate is factored into a testable function (gate 10): unit cases for all four DOB shapes (`M` NULL; `F` empty; equal; different) plus the attached-player exclusion, and one `afldb_test` integration case that inserts a manual player and runs the real guard query |

  This is a **name-based refusal, never a name-based link**, and it lives only in the
  operator-run importer.
- D-2 is approved, so W-3 is cleared (§14) and new-player creation ships.

### 8.5 The durability scenario (gate 9, real importer)

Extend `tests/integration/draftguru-import.test.ts` (it already spawns the real
`import_draftguru.py` as the import role, `:113-116`, and already proves an admin-owned row
sharing a natural key is untouched, `:576`, and a durable override replays, `:779`):

1. pick a DraftGuru-owned row; apply `saveSourcePickFields(…, 'selection_facts', {pick_number: 999, club_slug})` through the **real** function;
2. assert canonical row, `data_overrides` (delta only, `pick_number` present, absent keys absent), `data_edits`;
3. run the importer (`runImporter()`); 4. assert the correction survives; 5. set an explicit
   JSON `null` on `original_club_raw` and prove it clears while an absent key leaves the source
   value; 6. assert an unrelated source field (e.g. `player_name_raw`) still equals the source
   after the reload; 7. assert row count unchanged and no duplicate `(source, url, year, kind)`;
   8. assert `player_id`/`link_status_value` unchanged.

Manual path in the same suite: create a manual player + pick via `createPlayerAndDraftPick`;
run the importer; assert the manual row and player persist (outside scope), then call
`replay_admin_overrides(pg,'players')` and `(pg,'draft_picks')` on a copy where the rows were
deleted (simulating a promoted candidate) and assert one player and one pick re-appear with the
same tokens and no second `players` row.

---

## 9. Audit / transaction contract

### 9.1 Rules

- Every mutation in §6 is **one `AFLDB_IMPORT_DATABASE_URL` transaction**: canonical write(s) +
  override(s) + `recordDataEdit()` — all or nothing. No post-commit audit. Every `data_edits`
  row uses `recordDataEdit(tx, …)` (`audit-log.ts`), which has no try/catch by design.
- One transaction is feasible for **every** family, including new-player-through-draft: all
  writes are import-role writes (`players`, `external_identities`, `draft_picks`,
  `data_overrides`, `data_edits`) on one connection. No compensating mechanism is needed.
- `data_edits.table_name` and `field_group` per family are in §6. Rationale for auditing manual
  selections against the **player**: a manual row may be retired by DELETE (6.6); under the
  `draft_pick_key` lineage target (D-3) an audit row pointing at a deleted `draft_picks.id`
  would be unresolvable and would **stop a PROD promotion** — the exact DEV misattribution case
  `promotion-inventory.ts:358-372` records. The player is the stable subject (095 audits
  `match_coaches` changes against `matches` for the same reason). Source-owned rows are never
  deleted by admin, so their audits stay on `draft_picks`.

### 9.2 Field groups (new)

`players`: `player_creation` (existing), `draft_selection`, `draft_selection_unlinked`,
`draft_selection_retired`, `source_identity`, `identity_adopted` (6.8, written only when the
adopt action mints a legacy player's identity). `draft_picks`: `player_info`, `measurements`,
`notes` (existing), `selection_facts` (new).

### 9.3 Forced-failure proofs (gate 8) — reuse the 159 trigger strategy

A suite-scoped trigger on `data_edits` that raises when `note = 'AFLDB-ISSUE-160-GATE8-FORCE-FAIL'`
(`tests/integration/admin-coaches.test.ts:150-196` pattern; every §6 function takes `note`).
Prove rollback of:

| Family | Assert nothing persisted of |
|---|---|
| 6.3b new player + pick | `players`, `external_identities`, both `data_overrides`, `draft_picks`, `player_career_stats` |
| 6.3 manual pick | `draft_picks`, `data_overrides` |
| 6.1 source field edit | canonical UPDATE, `data_overrides` upsert |
| 6.4 relink | both rows, override rewrite |
| 6.5 attach | `external_identities`, override update |
| 6.6 retire | the DELETE and the `is_active=false` |
| 6.8 adopt (legacy pick + identity-less player) | pick UPDATE, pick `selection` override, player `external_identities`, player `identity` override, both audits |

Plus the inverse ordering proof for 6.3b: force the **draft** INSERT to fail (e.g. J-6 club
mismatch raised after the player INSERT) and assert **no player, identity or override row
persists** (“player succeeds, draft write fails”). Plus “override failure rolls back both”:
a suite-scoped trigger on `data_overrides` with the same sentinel.

---

## 10. Migration / privilege assessment

**No migration is required.** Every column the contract uses exists and every CHECK admits
the values written: `data_overrides.entity_type ∈ {players, draft_picks}`;
`data_edits.table_name ∈ {players, draft_picks}`; `external_identities` accepts any `sources`
row; `draft_picks_link_ck` holds (`player_id` set + `'resolved'`); the partial unique index
accepts `(manual, 'manual:<uuid>', year, kind)` with `NULLS NOT DISTINCT` irrelevant because
every column is non-NULL; `sources.kind='manual'` already exists.

Optional hardening (**D-1 — DECLINED 2026-09-11, zero migration stands**): migration 096 adding
`CHECK (player_url IS NULL OR player_url LIKE 'https://www.draftguru.com.au/players/%' OR player_url LIKE 'manual:%')`
on `draft_picks` is **not** added. A per-database `sources.id` cannot be referenced by a CHECK,
so it cannot bind the manual namespace to the manual source the way 095 bound `name_key` to
the path; the importer contract regex already excludes `manual:` and the value is minted
server-side only. 096 stays unallocated.

**No privilege change.** `afldb_import` already holds everything §6 writes; override reads use
the narrow server-side import-role helper (159 D-2); `afldb_auth` gains nothing; the browser
never reaches `afldb_import` except through named actions with no table/operation argument
(159 S-7). `manual-authority.ts` is untouched: the `OVERRIDE_ENTITY_TYPES` set does not change.

Legacy rows with `source_id IS NULL` are **not** backfilled by migration: an override row needs
an `admin_user_id`, which a migration cannot attribute. They are adopted by action 6.4b under
the acting admin (D-7), after the gate-2 count.

---

## 11. Promotion / rebuild lineage

| Change in `tools/db/promotion-inventory.ts` | Why |
|---|---|
| `LINEAGE_IDENTITY_SQL.afltables_profile_url` widened: `byId`/`byIdentity` select `DISTINCT ON (player_id)` over `external_identities` where `(s.key='afltables' AND match_method='afltables_profile_url') OR (s.key='manual_admin_edit' AND match_method='manual_admin_edit')`, status `unique/resolved`, **ordering the AFL Tables path first** so a player with both resolves by path on both sides; description updated | a manual player's `data_edits` and `player_link_resolutions.player_id` rows must resolve; a player known by token on the replaced side and by path in the candidate resolves because §8.1 step 2 binds the token onto the candidate's path-player **before** the remap (same ordering rule as coaches) |
| **D-3**: new rule `draft_pick_key` = `s.key || '|' || player_url || '|' || draft_year || '|' || draft_kind` for `source_id IS NOT NULL`, and `data_edits` lineage target `{ kind: 'draft_picks', entity: 'draft_picks', identity: 'draft_pick_key' }` | today `draft_picks` audit rows are reinstated unremapped and unflagged (silent misattribution); with the target they are remapped or the promotion stops honestly. Uses the source **key**, not the per-database `sources.id` |
| `assertContractCoherent()` / DEV `historicalOnly` | verify the new target is accepted against the DEV `historicalOnly: { columns: ['row_id'] }` declaration (159 S-4); if it refuses, **stop** |
| `docs/production-promotion.md` §1 table and §8 | replay list gains `draft_picks`; note that the `players` replay can now carry **entire rows** (manual players) and must run before `draft_picks` and before the `data_edits` remap |
| `tests/db-promotion-check.test.ts` | pins at `:1115-1134` updated for the widened SQL and the new rule; contract coherence test extended |

No `PROMOTION_CONTRACT` entry is added (both tables are registry-rebuilt; an entry would be a
`{kind:'both'}` refusal, as 159 found). ISSUE-151's contract is honoured: no new table, no NOT
NULL football FK.

Consequence to state in the promotion record: between the swap and the `players`/`draft_picks`
replay, a manual player and their manual selections **do not exist** in the promoted database
(the same window 159 documented for coaches); ids change across it.

### 11.1 D-3 rollout conditions (approved with conditions, 2026-09-11)

What changes on PROD: today a `data_edits` row with `table_name = 'draft_picks'` is reinstated
by `pg_restore` with its `row_id` integer unchanged and is never counted, listed or remapped,
because the lineage gate enumerates only the declared targets (`promotion-inventory.ts:328-337`)
and filters rows by `table_name`. On a lineage-changing promotion that integer then names a
different selection — silent misattribution. With D-3 the row is remapped through
`draft_pick_key` or the gate reports `FAIL` and the promotion stops before the swap. On a
shared lineage the gate passes unchanged, as today.

**Before the new gate is allowed to govern a PROD lineage-changing promotion**, all four must be
done and recorded in the promotion record, read-only:

1. probe (g) on PROD: enumerate every `data_edits` row with `table_name = 'draft_picks'`
   (`id, row_id, field_group, edited_at`);
2. probe (h) on PROD: for each such `row_id`, read the pick's stable key
   `s.key || '|' || player_url || '|' || draft_year || '|' || draft_kind` — a row whose pick has
   `source_id IS NULL`, or whose pick no longer exists, has **no** source-backed key and is
   unresolved (adopt via 6.8 first, or decide it explicitly);
3. probe (h) on the candidate: each key from step 2 must match **exactly one** candidate
   `draft_picks` row (0 → `identity_absent_in_candidate`, typically a DraftGuru person page
   renumbered between snapshots; >1 is impossible under `draft_picks_source_uq`);
4. every unresolved row is **reported before cutover** with its reason; none is dropped, nulled
   or carried by integer. The `--phase pre-cutover` transcript is the evidence.

**Sequencing with the paused ISSUE-151 PROD promotion `20260907-234124`** (it resumes through
`--phase restored` with `--lineage-remap-out`, i.e. it is a lineage-changing promotion):

- this change must **not silently alter that promotion's resume contract**;
- **pre-deploy operator decision S-1** (recorded in the ISSUE-151 promotion record *and* in
  the ISSUE-160 evidence before `merge:ready` for ISSUE-160): **either** (a) the paused
  promotion completes under the **current** lineage contract — ISSUE-160's
  `promotion-inventory.ts` change is not deployed to the tooling host until that promotion is
  closed, and the `draft_pick_key` gate governs the *next* promotion; **or** (b) the paused
  promotion resumes under the **new** gate — the plan is regenerated and `--phase restored` is
  re-run with the new checker only after steps 1–4 above report zero unresolved rows or an
  explicit decision for each;
- S-1 is operator-visible and made **before** deployment, never inferred during it. The
  ISSUE-160 merge-readiness record cites S-1 verbatim.

---

## 12. Operator decisions — DECIDED 2026-09-11 (binding for Stage 1 and Stage 2)

All nine are decided. **No operator decision remains open before Stage 1.** The only later
operator-visible decision is the pre-deploy sequencing decision S-1 (§11.1), which gates
rollout, not implementation.

| ID | Decision | Outcome (2026-09-11) | Binding wording |
|---|---|---|---|
| **D-1** | Zero migration vs optional 096 namespace CHECK on `draft_picks.player_url` | **APPROVED — zero migration** | No migration 096; the optional `player_url` namespace CHECK is **not** added (§10). 096 stays unallocated |
| **D-2** | Fail-closed **name+dob refusal** in `import_fitzroy_core.import_players()` for a new profile matching a manual player awaiting identity (§8.4) | **APPROVED WITH MODIFICATION** | The DOB rule is **symmetric**: for an unregistered AFL Tables profile whose normalised name matches a `manual_admin_edit` player with no AFL Tables identity — either side's DOB unknown → **REFUSE**; both known and equal → **REFUSE**; both known and different → allow the insert as a distinct namesake. The guard runs only in the new-player INSERT branch, never writes `external_identities`, never attaches a source identity, never decides player identity, and may only return "safe to insert" or fail closed. Name/DOB can refuse an unsafe insert but can **never** silently link a player. A refusal **throws, rolls back the entire fitzRoy players batch, records the batch failure and error**, and requires operator correction (attach in `/admin/draft` or record a distinguishing DOB) followed by a rerun. Full contract table in §8.4 |
| **D-3** | `draft_pick_key` lineage rule + `data_edits` target for `draft_picks` + remap-or-stop (§11) | **APPROVED WITH CONDITIONS** | Implemented in Stage 1. Before it governs a PROD lineage-changing promotion: (1) read-only PROD probe of existing `data_edits` rows with `table_name='draft_picks'`; (2) verify each resolvable row has a source-backed stable draft key; (3) verify the candidate holds exactly one matching key; (4) report every unresolved row before cutover. The paused ISSUE-151 PROD promotion is sequenced by **operator decision S-1** (complete under the current contract, or resume under the new gate) — recorded before deployment, never inferred during it (§11.1) |
| **D-4** | Retiring a manual selection | **APPROVED** | Audited **DELETE** of the canonical manual `draft_picks` row; the associated `selection` override set `is_active=false`; audit written against the stable player identity (`('players', player_id, 'draft_selection_retired')`, `old_values` = full row); **no tombstone column, no migration** (§6.6) |
| **D-5** | Data-editor transition (§15) | **APPROVED** | Remove the draft mutation slice and `CreatePlayerForm`'s draft block from `/admin/data-editor`; `saveDataEdit`/`getEditableRow` **refuse** `draft_picks` and point at `/admin/draft`; keep `EDITABLE_ENTITIES.draft_picks` only as the field spec the new surface validates with. Exactly **one** authoritative draft mutation path (`admin-draft.ts`) |
| **D-6** | Capabilities | **APPROVED** | `data.draft.read` = Admin and Super Admin; `data.draft.edit` = Super Admin only. New-player-through-draft creation and AFL Tables identity attachment are covered by `data.draft.edit`. **No third capability** |
| **D-7** | Legacy `source_id IS NULL` picks | **APPROVED WITH MODIFICATION** | Adopted through the explicit Super Admin action 6.8, never a migration. Adoption mints the selection's manual identity/provenance and its override + audit, **and**, if the linked player has no durable identity usable by promotion/rebuild, mints that player's `manual_admin_edit` token, `external_identities` row, whole-row `identity` override and `identity_adopted` audit **in the same transaction**. A second player identity is never minted when a valid durable identity exists. The action leaves both player and pick promotable and replayable. No bulk backfill: `admin_user_id` attribution stays explicit |
| **D-8** | J-3 hardening | **APPROVED WITH MODIFICATION — both outcomes pre-authorised** | No further operator decision after gate 2. Probe (a) finds **zero** valid pick-number collisions at the `(draft_year, draft_kind, pick_number)` grain → implement **hard refusal**; valid historical collisions exist → implement **explicit confirmation** that names/displays the colliding selection(s). The implementer records the probe result in the evidence and follows the matching branch automatically (§7 J-3) |
| **D-9** | Shared revalidate route + submit helper extraction | **APPROVED — Stage 2 only** | Extract/share the ISSUE-159 revalidation route and submit helper into `src/lib/admin/revalidate-route.ts` and `src/components/admin/action-submit.ts` **only during Stage 2**; keep domain-specific bounded allowlists; coaches switched behaviour-preserving. **Not mixed into Stage 1** backend/identity work (§17) |

---

## 13. Latent defects found (fixed inside this issue, not separately tracked)

| ID | Defect | Fixed by |
|---|---|---|
| DEF-1 | `getEntityNaturalKey('draft_picks')` yields `null|null|<year>|null` for admin rows → shared, never-replayed override keys | §15 (draft branch removed from `saveEdit`; manual rows keyed by token). **Existing rows: frozen residue, see below** |
| DEF-2 | `createPlayerAction` and `saveDataEdit` call `revalidatePath('/', 'layout')` **inside** the Server Action (known Next 15.5 hang path) | the replaced draft/creation actions follow 159 S-6; the remaining data-editor actions are P8 scope and are **not** touched |
| DEF-3 | `docs/production-promotion.md` §8 omits `draft_picks` from the replay loop | §8.2 / §11 |
| DEF-4a | Admin-created **players** carry no promotion identity (`createPlayerInTransaction` writes `players` + `player_career_stats` only; `players` has no natural key; the only players lineage rule is the AFL Tables path) → the player is absent from a rebuilt candidate and its `player_creation` audit rows are `no_identity_in_replaced`, which stops a PROD promotion | §3.2, §5, §8.1, §11. **Prevents new occurrences** (every new player is minted with a token). **Per-row repair, not a backfill:** a legacy identity-less player is repaired **only** through the D-7 adoption action 6.8 when a legacy draft pick references them. No blanket backfill is claimed; identity-less players with no legacy pick are outside ISSUE-160 (probe (f) enumerates them; DEV's 7 measured rows are of this class) |
| DEF-4b | Admin-created **picks** carry no promotion identity (`source_id`, `player_url`, `source_record_id` NULL; outside the 069 partial reload key; the replay's key expression is SQL NULL; no INSERT branch) → absent from a rebuilt candidate | §3.1, §6, §8.2. **Prevents new occurrences** (the `draft_picks` INSERT in `players.ts` is removed; every manual row carries a token) and **supports explicit per-row adoption** (6.8). **No automatic migration backfill** |

**DEF-1 residue — decided handling (2026-09-11).** ISSUE-160 prevents any new bad key by
removing the generic data-editor draft writer and refusing `draft_picks` in `saveEdit` (D-5).
The existing `null|null|<year>|null` override rows are **inert**: `replay_admin_overrides`
never matches them (its key expression is NULL for the rows they were written for), the new
`readDraftOverrides` reads only token keys and 069 keys, and the canonical UPDATE they
recorded was already applied at edit time. They **cannot be safely attributed automatically**:
one key is shared by every admin pick of that year and group, so no row can say which pick a
payload belonged to. Therefore:

- gate 2 probe (e) **enumerates the residual set** (`id, entity_key, field_group, admin_user_id,
  updated_at`) on afldb_test, DEV and PROD, recorded verbatim in the implementation evidence;
- they are **left as frozen historical residue** — not deleted, not deactivated, not rewritten
  by ISSUE-160. Repository evidence favours this over a cleanup step: `data_overrides` is a
  `reinstate` table whose rows are human-authority evidence, the rows are functionally inert
  in every code path that survives D-5, and deactivating or deleting them would change
  nothing except erase who made an edit and when;
- an explicit operator-reviewed retirement (`is_active=false`, never DELETE, one row at a time
  with the operator naming the pick each row was about) is **not** part of ISSUE-160; if the
  operator wants it after reading probe (e), it is a separate ledger note, never a silent step.

---

## 14. Risk register and stop conditions

| ID | Stop condition | Disposition |
|---|---|---|
| W-1 | Manual player has no stable promotion identity | **Cleared** by §3.2 + §8.1 + §11; verify at gate 12 |
| W-2 | Manual draft row has no stable promotion identity | **Cleared** by §3.1 + §8.2; verify at gate 12 |
| W-3 | Future AFL Tables identity would create a duplicate player | **Fires on the existing architecture. Cleared by D-2 (approved with the symmetric DOB rule, §8.4).** `createPlayerAndDraftPick` ships. Verify at gate 10 |
| W-18 | ISSUE-160's lineage change silently alters the paused ISSUE-151 PROD promotion's resume contract | **stop** unless operator decision S-1 (§11.1) is recorded before deployment |
| W-4 | Future DraftGuru row would create a duplicate player | cleared: the importer never seeds without a ledger decision (§0.1) |
| W-5 | Future DraftGuru row creates a duplicate **selection** | accepted as a visible `duplicate` conflict state with 6.6/6.7; not silent |
| W-6 | Existing-player reconciliation ambiguous | J-10 hard refusal; no guess |
| W-7 | Proposed uniqueness rule fails historically | J-3 has both branches (gate 2) |
| W-8 | A tracked source correction would be silently overridden | J-16 refusal; without it **stop** |
| W-9 | Player creation would require fuzzy-name mutation | none: names rank and refuse only |
| W-10 | Two admin write paths differ semantically | §15 removes the second path; `tests/edit-spec.test.ts` + a source-contract test assert `saveEdit` refuses `draft_picks` |
| W-11 | Browser needs direct `afldb_import` powers | none (159 S-7) |
| W-12 | Audit cannot share the mutation transaction | none: all writes are import-role |
| W-13 | Draft and player cannot be created atomically | none: one transaction (§9.1) |
| W-14 | Implementation drifts into merging two existing players (J-15, J-17, supersede of a **source** row) | **stop, P9** |
| W-15 | Safe creation needs broad P9 lifecycle work | no: only duplicate prevention + attach + retire |
| W-16 | `assertContractCoherent()` refuses the new lineage target against DEV `historicalOnly` | **stop and report** (159 S-4) |
| W-17 | `revalidatePath` inside a Server Action | **stop** (159 S-6) |
| R-7 | Existing source-owned override key embeds the per-database `sources.id`; deterministic today because migrations seed `sources` identically on every database | recorded; not changed (changing it would orphan existing overrides); the manual key and the lineage rule use the source **key** |

---

## 15. `/admin/data-editor` transition (D-5)

- `src/app/admin/data-editor/page.tsx`: remove the “Draft picks” section and the draft search
  results; `entity=draft_picks` requests render a notice linking to `/admin/draft/[id]`.
- `actions.ts` `saveDataEdit`: refuse `entity === 'draft_picks'` (`{error: 'Draft selections are edited in /admin/draft.'}`);
  `createPlayerAction`: draft form fields removed from `CreatePlayerForm.tsx`; the action
  rejects any draft field with the same message; `createPlayer()` keeps creating players
  (now with identity) for the historical-player use case.
- `src/db/queries/data-edits.ts`: remove the `draft_picks` branches from `getEditableRow`,
  `getEntityNaturalKey`, `saveEdit` (`applyDraftPickEdit` moves to `admin-draft.ts` as
  6.1's canonical write). `EDITABLE_ENTITIES.draft_picks` **stays** as the validation spec
  (`validateFieldValue`, groups) and gains the `selection_facts` group; `manual-authority.ts`
  `editorExposesNoUnrepresentableEntity()` is unaffected.
- Result: exactly one draft mutation contract (`admin-draft.ts`), one player-creation
  primitive (`createPlayerInTransaction`), one revalidation shape.

---

## 16. Acceptance gates (exact, in order)

**Now, on `afldb_test` (no DEV):**

| # | Gate | Proof |
|---|---|---|
| 1 | Preflight | §0.2; `npm run preflight -- --mode implementation --issue 160` READY; ISSUE-160/096 free |
| 2 | Historical data-shape probes (operator, read-only, after `npm run db:test:rebuild` or on DEV) | (a) `SELECT draft_year, draft_kind, pick_number, count(*) FROM draft_picks WHERE source_id IS NOT NULL AND pick_number IS NOT NULL GROUP BY 1,2,3 HAVING count(*)>1 LIMIT 20;` (b) `SELECT draft_kind, count(*) FILTER (WHERE pick_number IS NULL), count(*) FROM draft_picks WHERE source_id IS NOT NULL GROUP BY 1 ORDER BY 1;` (c) `SELECT count(*) FROM (SELECT player_id, draft_year, draft_kind FROM draft_picks WHERE player_id IS NOT NULL GROUP BY 1,2,3 HAVING count(*)>1) x;` (expect 0) (d) `SELECT count(*) FROM draft_picks WHERE source_id IS NULL;` on afldb_test **and** DEV **and** PROD (e) `SELECT id, entity_key, field_group, admin_user_id, updated_at FROM data_overrides WHERE entity_type='draft_picks' AND entity_key LIKE 'null|%' ORDER BY id;` on afldb_test **and** DEV **and** PROD (enumerates the DEF-1 residue, §13) (f) `SELECT count(*) FROM players p WHERE NOT EXISTS (SELECT 1 FROM external_identities e WHERE e.player_id=p.id);` (g) `SELECT id, row_id, field_group, edited_at FROM data_edits WHERE table_name='draft_picks' ORDER BY id;` on afldb_test **and** DEV **and** PROD (h) on PROD: `SELECT de.id, de.row_id, dp.id IS NOT NULL AS pick_exists, dp.source_id, s.key || '|' || dp.player_url || '|' || dp.draft_year || '|' || dp.draft_kind AS draft_pick_key FROM data_edits de LEFT JOIN draft_picks dp ON dp.id = de.row_id LEFT JOIN sources s ON s.id = dp.source_id WHERE de.table_name='draft_picks' ORDER BY de.id;` then on the candidate, for each non-NULL key: `SELECT count(*) FROM draft_picks dp JOIN sources s ON s.id=dp.source_id WHERE s.key || '|' || dp.player_url || '|' || dp.draft_year || '|' || dp.draft_kind = ANY($1::text[]) GROUP BY …` (D-3 condition, §11.1) → (a) selects the pre-authorised J-3 branch (D-8), (d) sizes D-7, (e) freezes the DEF-1 residue, (g)/(h) are the D-3 rollout evidence |
| 3 | Player-creation contract (unit, `tests/player-link-mutations.test.ts` extend) | `createPlayerInTransaction` mints token + identity + override in the same tx; SQL-derived slug/search_name; no `draft_picks` INSERT; `draftInfo` removed |
| 4 | Capability matrix (`tests/auth.test.ts` extend) | two new capabilities enforced; nav entry; direct action/route rejection for Contributor (→ `/admin/upload`) and Admin (→ `/admin` for edit) |
| 5 | Duplicate/conflict unit contracts (**new** `tests/admin-draft-actions.test.ts`; no existing home covers draft admin mutations) | J-1…J-13, J-15, J-16 as pure/mocked contracts; form parsing; `revalidatePaths` shape; allowlist |
| 6 | Existing-player draft creation (**new** `tests/integration/admin-draft.test.ts`) | 6.3 writes row + override + audit; J-1/J-3/J-6 refused live; **6.8 adopt**: a legacy `source_id IS NULL` pick whose player has (i) an AFL Tables identity → pick token only, `player_identity = 'afltables:<path>'`, no player identity minted; (ii) a manual identity → reused, none minted; (iii) no identity → player token + `external_identities` + `identity` override + `identity_adopted` audit minted in the same transaction; a second adopt of the same row refuses `stale` |
| 7 | New-player-through-draft integration | 6.3b: one player, one identity, two overrides, two audits, correct linkage, zero orphans |
| 8 | Atomicity | §9.3 table, both triggers |
| 9 | Source-owned correction replay | §8.5 in `tests/integration/draftguru-import.test.ts` |
| 10 | New-player future identity | 6.5 then `runImporter`-equivalent for fitzRoy is out of reach (no snapshot fixture) → prove with the **real** `import_players` guard logic factored into a testable function, plus a live settle-shaped assertion: after 6.5, `settle-afltables.ts`'s identity map resolves the path to the manual player (unit over the SQL). D-2 guard (symmetric rule, §8.4): unit cases for manual DOB NULL → refuse, fact DOB absent → refuse, both known and equal → refuse, both known and different → allow, attached player excluded; plus one integration case inserting a manual player then running the real guard query, asserting the batch is marked `failed` with the error recorded and no `players` row was inserted |
| 11 | Manual draft reload/reconciliation | §8.5 manual path; a later source row → J-14 state → 6.7 supersede leaves one selection, one player |
| 12 | Promotion lineage (`tests/db-promotion-check.test.ts` extend) | widened rule resolves a token-only player and a path+token player; `draft_pick_key` resolves source and manual rows and reports a NULL-source pick as `no_identity_in_replaced`; an adopted legacy pick (6.8) and its player both resolve; contract coherence passes (W-16) |
| 13 | Data-editor transition | `tests/edit-spec.test.ts` extend: spec keeps `draft_picks` with `selection_facts`; `saveEdit('draft_picks')` refuses; no `INSERT INTO draft_picks` outside `admin-draft.ts` (source-contract grep test in `tests/data-overrides-source-contract.test.ts`, which already reads source) |
| 14 | `npx tsc --noEmit` + affected suites | list in §18 |

**Deferred until the operator updates DEV (Admin Centre batch):**

| # | Gate |
|---|---|
| 15 | DEV deploy/build; `db:privileges` unnecessary (no change); replay `players` + `draft_picks` overrides on DEV is a no-op today |
| 16 | Playwright: three roles × direct URLs and actions; widths 320/768/1000/1280/1920 on `/admin/draft`, `/admin/draft/[id]`, `/admin/draft/new` (existing-player flow, new-player flow with J-12 confirmation, J-10 refusal), refused duplicate keeps focus on the initiating control (`useActionFocusRestore`), no horizontal overflow, 44 px targets, provenance/conflict badges not hover-only, console/network clean |

Immediate DEV deployment is **not** a prerequisite for the Stage 1 or Stage 2 commit.

---

## 17. Phasing and model

**Stage 1 — contracts, primitives, replay, lineage, tests (Opus 5, high).** §3, §5, §6 (all
functions in `admin-draft.ts`, including 6.8), §8.1–8.4, §9, §11, §15 backend half, gates 1–14
except UI. Deliverable order: probes (the J-3 branch is fixed by probe (a) before any code) →
`createPlayerInTransaction` → `admin-draft.ts` → replay branches → importer guard (D-2 symmetric
rule) + ledger target → promotion inventory (D-3) → docs → tests. **Stage 1 does not touch
`src/app/admin/coaches/*` or create the shared revalidate/submit modules (D-9 is Stage 2 only).**

**Stage 2 — Admin surface (Sonnet 5 high for UI wiring; Opus for the create-player wizard
action, the permission matrix and the shared revalidate extraction; Fable for review/polish).**
§18 routes, capabilities + nav, D-9 extraction, data-editor UI removal, gate 16 when DEV is
available. Stage 2 starts when gates 1–14 are green; **no DEV settle gate** (no migration, no
`data_overrides` widening, settle untouched).

Do not force both into one session; the §8/§11 work is the risky half.

---

## 18. Routes, UI, files

**Routes** (Data group, after Coaches): `/admin/draft` (list), `/admin/draft/new` (add
selection: existing-player or create-new-player wizard), `/admin/draft/[id]` (detail/edit,
player panel with provenance and 6.5), `/admin/draft/revalidate` (POST, allowlist:
`/players/<slug>-<id>`, `/sitemap.xml`). No `/admin/draft/[year]`: the list's year filter
covers it and `/draft/[year]` is the public surface.

**List filters:** year, kind, club, player/name search (`q`), provenance
(`draftguru` | `manual` | `legacy`), link state (`linked` | `unresolved`), state
(`override` | `duplicate` | `awaiting-identity`). Unresolved source rows deep-link to
`/admin/player-links`.

**Create-new-player step:** search-first (results with clubs/span/games), explicit “Create new
player” control, fields display name / given / surname / dob (+confidence) / height / weight /
notes, then pick fields, preview (player + year/kind/pick/club), confirm; J-10–J-13 outcomes
rendered inline with focus retained on the submit control.

**Interaction:** `useActionState` inside `startTransition` through the shared submit helper;
`revalidatePaths` returned by the action and POSTed after it resolves; `router.refresh()` for the
admin surface; refusals reuse `focus-restore.ts`. No merge/reconciliation controls anywhere.

**Expected files.** New: `src/db/queries/admin-draft.ts`, `src/app/admin/draft/{page.tsx,
new/page.tsx,[id]/page.tsx,actions.ts,validation.ts,revalidate-paths.ts,revalidate/route.ts,
*Panel.tsx}`, `tests/admin-draft-actions.test.ts`, `tests/integration/admin-draft.test.ts`,
shared `src/lib/admin/revalidate-route.ts`, `src/components/admin/action-submit.ts` (D-9).
Changed: `src/db/queries/players.ts`, `src/db/queries/data-edits.ts`, `src/lib/edit/spec.ts`,
`src/app/admin/data-editor/{page.tsx,actions.ts,CreatePlayerForm.tsx}`,
`src/lib/auth/capabilities.ts`, `src/app/admin/nav-model.ts`, `src/app/admin/coaches/*` (D-9),
`tools/migration/common.py`, `tools/migration/import_fitzroy_core.py` (D-2),
`tools/rebuild/draftguru/{import_draftguru.py,export_link_decisions.py}` (§8.3),
`tools/db/promotion-inventory.ts`, `docs/production-promotion.md`, `docs/admin-and-beta.md`,
tests: `player-link-mutations`, `edit-spec`, `auth`, `data-overrides-source-contract`,
`db-promotion-check`, `integration/draftguru-import`, `CHANGELOG.md` (at implementation),
`issues.md`, `IssuesIndex.md`, `AFLDB-ISSUE-156.md`.

**Affected suites for gate 14:** the ten above plus `tests/coach-reconciliation.test.ts`,
`tests/admin-coach-actions.test.ts`, `tests/integration/admin-coaches.test.ts` (D-9 regression),
`tests/current-season-import.test.ts` (override-scope proof unchanged).

---

## 19. Explicit non-goals

Merging two existing players (P9); relinking/unlinking a source-owned selection (P9);
broad player lifecycle; historical draft cleanup beyond the adopt action; public `/draft`
redesign; DraftGuru scraper redesign; match identity; honours; content; refresh jobs; data-editor
decomposition beyond the draft slice (P8); the remaining in-action `revalidatePath` calls in the
data editor (P8); PROD deploy; DEV update/rebuild.

## Deferred DEV acceptance note

The operator is deliberately holding DEV until the Admin Centre batch is complete. Gates 15–16
run only then. Stage 1 and Stage 2 are committed on `afldb_test` + typecheck evidence alone.

## 20. DEV acceptance defect: `/admin/draft/[id]` read the audit log as the wrong role (2026-09-12, Opus 5 high 1M) — UNCOMMITTED (superseded 2026-09-12 by §21: committed as `e6c4e8c`, deployed and DEV-accepted)

### 20.1 What DEV acceptance found

Combined ISSUE-160/161/162/163 DEV browser acceptance, build `01f94a1`, migrations 001–098 applied,
0 pending, privileges reconciled, `afldb.service` healthy, `/api/health` 200.

| Fact | Value |
|---|---|
| Route | `/admin/draft/[id]` |
| Ids tried | 1, 6669, 6670, 6793 — **all** failed |
| Roles | Admin **and** Super Admin — both failed; Contributor correctly refused before the page |
| Viewport | 1440×900 |
| Symptom | site error boundary, reference `4230168678`; console `Minified React error #441` + `[render] page failed 4230168678` |
| Unaffected | `/admin/draft` and `/admin/draft/new` rendered correctly |

`#441` is React's production stand-in for "an error occurred in the Server Components render", and
`4230168678` is that render's Next digest, so the failure was a **server-side throw**, not a
serialization, invalid-child, `params`-contract or Client-Component-boundary problem. That it failed
for every id and both roles located it **above** every provenance and capability branch.

### 20.2 Root cause

J-18's concurrency revision is `max(data_edits.id)` for the selection under either audit subject
(the `draft_picks` row, or the `players` row for a `draft_selection%` field group). It was read in
two places, on two roles, **neither of which may SELECT `data_edits`**:

| Caller | Pool / role | Grant it holds on `data_edits` |
|---|---|---|
| `currentRevision()` in `src/app/admin/draft/[id]/page.tsx` | `@/db/client` → **afldb_app** | none — 039 inverted the schema-wide default, so afldb_app reads only what `afldb_meta.app_readable_tables` registers, and `data_edits` is deliberately not registered |
| `draftPickRevision(tx, pick)` in `src/db/queries/admin-draft.ts` | the mutation's own transaction → **afldb_import** | `INSERT` only (066), so a mutation's required audit can commit atomically with it |
| `audit-reader.ts` (the working precedent) | `@/db/authClient` → **afldb_auth** | `SELECT, INSERT` (057) |

So the page threw `permission denied for table data_edits` on every request, before rendering
anything. `tests/integration/privileges.test.ts` already pins both halves of this (afldb_app "reads
exactly the tables the registry allows"; afldb_auth holds `data_edits` `SELECT, INSERT`), and
`tools/maintenance/privileges.sql` reconciles the same shape — **the grants were correct; the code
asked the wrong role.**

Nothing local could have caught it: the integration suite connects as the owner, and no test passed
`expectedRevision`, so the compare-and-swap read had never executed against PostgreSQL at all. The
detail page was its only producer, so the second call site would have failed on the first Save the
moment the page rendered — one defect, two call sites.

### 20.3 Fix

One exported `readDraftPickRevision(pickId, playerId)` in `src/db/queries/admin-draft.ts`, reading
on `authSql`, used by the page and by all three compare-and-swap call sites
(`saveSourcePickFields`, `saveManualPick`, `retireManualPick`).

Reading outside the mutation transaction does not weaken J-18: every audited draft mutation takes
`lockPick()`'s `FOR UPDATE` on the selection row **first**, so a competing edit has either already
committed — and its `data_edits` row is visible to this read — or is still blocked on that lock and
cannot yet have written one.

**No migration. No grant or privilege change. No schema change. No capability change
(`data.draft.read` Admin+, `data.draft.edit` Super Admin only, unchanged, Admin still read-only).
No change to the draft authority model, source-owned/manual ownership, durable manual identity,
attach-rather-than-duplicate, override correction, retire/supersede semantics or replay/promotion
lineage.** No stop condition fired.

### 20.4 Regressions added

- `tests/admin-draft-actions.test.ts` — the revision read runs on the **auth** pool and never on
  the page pool, carries `FROM data_edits` and both parameterised audit subjects, and returns `'0'`
  for a selection nothing has been audited about (and for an empty result). This pins the root
  cause itself, not a token.
- `tests/integration/admin-draft.test.ts` — a real-PostgreSQL J-18 round trip in
  *source-owned corrections (6.1, 6.2)*: read the revision, save with it (accepted), re-read (it
  moved), replay the stale value (refused `stale`, canonical value unchanged), save with the current
  value (accepted). The suite also now redirects `AFLDB_AUTH_DATABASE_URL` to
  `AFLDB_TEST_DATABASE_URL`, the same protection it already applied to the import DSN.

### 20.5 Validation and what remains

Nothing was run: no `tsc`, no vitest, no ESLint, no `npm run build`, no commit, no deploy. Operator
commands are listed under *Next action*. A local production build is **not** final acceptance for a
rendered-route crash — DEV must be redeployed and `/admin/draft/[id]` re-tested in the browser.
**ISSUE-160 stays OPEN.**

*Superseded 2026-09-12 (§21): the fix was committed as `e6c4e8c`, reached DEV in `main` `3272434`,
and `/admin/draft/[id]` was re-tested in the browser — list/detail accessible according to
capability, Super Admin editing working, a notes-override Save proving the compare-and-swap
completes, and a stale two-tab Save refused.*

## 21. Resolution — 2026-09-12 (combined Admin Centre DEV acceptance)

**Status:** Resolved. Closed on the operator's DEV acceptance of the combined Admin Centre batch
(ISSUE-160 + 161 + 162 + 163). PROD was not touched and no PROD validation is claimed. This
closeout changed tracking only: no feature, application logic, test, schema, migration, DEV data
or deployment.

### 21.1 What reached DEV

- `main` at `3272434`, containing Stage 1 `91935b9`, Stage 2 `a947e52`, the 2026-09-11 audit fixes
  and §18 list-contract closure, the §20 revision-read fix (`e6c4e8c`, "Fix draft detail revision
  access") and the batch-wide responsive commits `e638d61`, `9727ad5`, `ae3c4e0`, `aeb41f3`.
- DEV: production build PASS, 1533/1533 static pages generated, `afldb.service` healthy,
  `/api/health` `status=ok`, `database=ok`. No migration (none required, §10) and no privilege
  change for this issue.

### 21.2 Deferred gates 15–16 — closed

| # | Gate | Result |
|---|---|---|
| 15 | DEV deploy/build | **PASS** — build and health as above |
| 16 | Rendered acceptance | **PASS, scope as recorded in §21.3** — list/detail accessible according to capability; Super Admin editing works; source-owned and linked/unlinked selections rendered correctly; the §20 crash fixed (exact root cause: the revision read on the wrong database role; one shared auth-role revision reader; compare-and-swap on the correct authority); notes-override Save PASS; stale two-tab form / compare-and-swap rejection PASS; active-override and audit behaviour PASS; responsive 1440 / 1024 / 768 / 375 PASS; global navigation PASS; accessibility/focus spot checks PASS; no blocking console/runtime errors |

### 21.3 Scope of the rendered acceptance (recorded, not claimed)

1. **Widths.** Acceptance ran at 1440 / 1024 / 768 / 375 under the operator's device-priority
   decision of 2026-09-12 (laptop/desktop = primary admin workspace; iPad/tablet = first-class
   admin workspace; phone = functional fallback), not the 320 / 768 / 1000 / 1280 / 1920 set gate
   16 named. The operator directed that the batch is not held open for phone-only cosmetic
   polishing.
2. **Manual-provenance detail page.** No manual-provenance selection existed in the DEV dataset
   during rendered acceptance, so the `/admin/draft/[id]` manual-row variant (whole-row edit,
   relink, identity attach, supersede and retire panels) was not observed in the browser. Not a
   closure blocker: gate 16 does not name that variant; the §20 crash failed above every
   provenance branch, so its fix is proven by any row; and the manual-row contracts are covered
   by `tests/admin-draft-actions.test.ts` and `tests/integration/admin-draft.test.ts` (gates 5–8
   and 11).
3. **Sub-cases not itemised in the operator's evidence.** The `/admin/draft/new` new-player flow
   in the browser (the J-12 confirmation and J-10 refusal), focus restore on a refused duplicate,
   44 px targets and non-hover badges are not separately evidenced in this record; they rest on
   the automated gates 5 and 7 and on the operator's overall functional and design sign-off of
   2026-09-12.

### 21.4 Carried forward to the PROD promotion stage (not closure conditions)

Recorded on the `AFLDB-ISSUE-156` umbrella's promotion checklist:

- the gate-2 PROD read-only probes (d) `source_id IS NULL` count, (e) the DEF-1 `null|%` residue,
  (g)/(h) `data_edits` draft rows and their stable keys — the §11.1 D-3 rollout evidence;
- operator decision **S-1** (§11.1): whether the paused ISSUE-151 PROD promotion
  `20260907-234124` completes under the current lineage contract or resumes under the new
  `draft_pick_key` gate — decided before the promotion-tooling change governs a PROD promotion,
  and recorded in the ISSUE-151 promotion record;
- gate 9's real-importer half (`tests/integration/draftguru-import.test.ts`), which runs only on a
  host with `.venv`, the accepted DraftGuru Stage A snapshot and
  `AFLDB_TEST_IMPORT_DATABASE_URL`.

## Next action (as it stood before the closeout — superseded by §21; ISSUE-160 is RESOLVED)

**FIRST, validate the 2026-09-12 `/admin/draft/[id]` crash fix (§20):**

```text
npx tsc --noEmit
npx vitest run tests/admin-draft-actions.test.ts
npx vitest run tests/integration/admin-draft.test.ts     # needs AFLDB_TEST_DATABASE_URL
npx eslint src/db/queries/admin-draft.ts "src/app/admin/draft/[id]/page.tsx" src/app/admin/fixtures/SingleFixtureForm.tsx tests/admin-draft-actions.test.ts tests/integration/admin-draft.test.ts
npm run build
```

Then commit, redeploy DEV, and re-run the focused browser acceptance of `/admin/draft/[id]` for
both Admin and Super Admin over a DraftGuru row, a manual row and an unlinked row, including one
Save to prove the compare-and-swap now completes.

**Stage 1 and Stage 2 are implemented and committed** (`91935b9`, `a947e52`, 2026-09-11) **and
audited locally** (2026-09-11). The audit's two narrow fixes and this tracking update are
uncommitted and await operator review; nothing is pushed, merged or deployed.

Two runbook §18 list-contract items were found NOT delivered by the audit and, on the
operator's direction (2026-09-11), **both are now implemented**: the list `state` filter
(`override` = an active durable correction, `duplicate` = J-14 exactly, `awaiting-identity` =
a `manual_admin_edit` identity with no `afltables` one), each derived in SQL from rows the
database already holds; and the deep link from an unresolved source-owned selection to
`/admin/player-links?table=draft_picks&q=<player_name_raw>`, using only parameters that page
already supports. No migration, no persisted workflow state and no new mutation path. Full
record: `issues.md` → *§18 list-contract closure*.

The implementation record for both stages — preflight results, the gate-2 probe table, the D-8
branch selection and why, the real defects found (and, for Stage 2, the one self-caught test-file
overwrite corrected before commit), the deviations above, the gate-by-gate result and the local
completion audit — is in `issues.md` under AFLDB-ISSUE-160. Nothing is pushed, merged or
deployed, and neither DEV nor PROD was touched.

Stage 2 delivered `/admin/draft`, `/admin/draft/new`, `/admin/draft/[id]` and the create-player
wizard; `data.draft.read` and `data.draft.edit` plus the nav entry (gate 4); the D-9 shared
revalidate/submit extraction (also applied to coaches, behaviour-preserving); and the remaining
`/admin/data-editor` page removal. Gate 16 (Playwright, three roles × 320/768/1000/1280/1920)
remains deferred until the operator updates DEV for the Admin Centre batch — this is a release
-batching decision, not a blocker found during implementation.

Operator decision **S-1** (§11.1, ISSUE-151 sequencing) is required before **deployment** of
the promotion-tooling change, not before this commit.
