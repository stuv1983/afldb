# AFLDB-ISSUE-165 — Awards & Honours Administration: correction, voiding and replacement lifecycle

**Status:** Open / **Stages 1–3 implemented and GREEN on `afldb_test` (24/24, twice in
succession); uncommitted, undeployed.** Stages 4–9 (the `/admin/awards` surface, capabilities,
nav, `data-editor` disposition, public status filters, browser acceptance) not started. DEV and
PROD untouched.
**Severity:** Medium
**Area:** Admin / Data management
**Created:** 2026-09-13
**Parent:** `AFLDB-ISSUE-156` (umbrella), consuming **P5 — Awards/honours correction lifecycle**
and absorbing the awards-domain residue of **P8 — Data-editor decomposition**.
**Migration:** **`src/db/migrations/101_awards_honours_lifecycle.sql` — applied to `afldb_test`
only** (operator, 2026-09-13: `101_awards_honours_lifecycle.sql ... ok`). DEV and PROD unapplied.
B-2 resolved at the implementation preflight (2026-09-13): a repository-wide
inspection of `src/db/migrations/` confirmed `100_nl_search_log_family_grain.sql` as the highest
number and no `101_*` file, so 101 was free and is now allocated.

Sections 1–16 are the planning deliverable, written before implementation and left standing as
the record of what was decided and why. **§17 is the implementation record**, and it CORRECTS
several load-bearing claims below — §3.1's grain table, §3.4's rebuild evidence, §3.7's
"one module" consumer claim, §8's index and verification items, and §12's placement of the test
gates. Where §17 and an earlier section disagree, §17 is authoritative: it was verified against
the code as built, not against the code as read.

---

## 1. Executive summary

`/admin/data-editor` can **create** an award winner, a Hall of Fame inductee and a
representative/honour-team member (`src/db/queries/awards-admin.ts`), but nothing in the
repository can **edit, void, replace or restore** any of the three once created. There is no
domain-specific capability (`data.dataEditor` gates everything on the page), no read surface
other than the public site, and — the load-bearing finding — **no reload-survival mechanism at
all** for a correction to a source-owned row: `tools/migration/import_awards.py` reloads every
award group with `reload_keyed()`, an upsert-by-natural-key helper that overwrites every column
in its own column list from the freshly parsed source on every run, with no
`data_overrides` consultation. A hypothetical correction made today, if a mutation existed to
make one, would be silently reverted the next time that award group's importer ran.

The recommended lifecycle model (§6) follows the `AFLDB-ISSUE-163` (club leadership) precedent —
void/end never deletes, a wrong identity is void + a new row rather than an in-place edit, and
the durable record lives in `data_overrides` — but **cannot copy it verbatim**, because
`club_leadership` has no importer at all and these three tables do. The plan adds:

- an additive **`status`** column (`active`/`void`) directly on each of the three tables, which
  needs **no** `data_overrides` entry to survive an ordinary scoped reload (proven in §6.1,
  because `reload_keyed()`'s `UPDATE` only touches the columns in its own explicit list), but
  **does** need one to survive a full rebuild, because all three tables carry a foreign key to
  `players` and a full rebuild's `TRUNCATE … CASCADE` on `players` empties them too (proven in
  §6.2, direct evidence in `import_awards.py:2674-2679`);
- a `data_overrides` widening (`entity_type` += the three table names) carrying the durable
  void/replace/correction decision, replayed by a new `replay_admin_overrides()` branch per
  table, called by `import_awards.py` immediately after each group's own `reload_keyed()` call —
  the same position the existing coach/season-list/fixture/leadership branches occupy;
  the CHECK on `data_edits.table_name` already admits all three tables (migration 058) and needs
  **no** change;
- capabilities `data.awards.read` (Admin and up) / `data.awards.edit` (Super Admin only), matching
  the established `data.<domain>.read`/`.edit` convention exactly (`src/lib/auth/capabilities.ts`);
- a dedicated `/admin/awards` surface (D-3), with the three existing `data-editor` create forms
  either removed or reduced to a compatibility link (§10);
- **one additive migration**, not zero and not blocked (§8).

Domains do **not** need identical lifecycle operations (§5): `hall_of_fame` already has a
schema-level `removed_year` concept that must not be confused with "voided for data-entry error";
`honour_team_members` already has admin-created-row duplicate detection that `award_winners` and
`hall_of_fame` conspicuously lack.

---

## 2. Relationship to AFLDB-ISSUE-156

Per the umbrella's dependency graph (`AFLDB-ISSUE-156.md` §9), P5 depends only on P1 (audit
viewer — done, `AFLDB-ISSUE-157`) and P2 (capability enforcement — done, `AFLDB-ISSUE-158`), both
resolved and merged. P5 has no dependency on P3/P3b–P3e. It reuses their architecture (data
ownership table §3, audit contract §4, migration/allowlist mechanics §6, cache/revalidation
rules §7, responsive/focus component conventions §8) by reference, not by re-derivation.

**Operator decisions carried in from the umbrella brief, fixed and binding on this issue:**

- **D1 — correction model.** Void/end + replacement, never silent destructive overwrite.
  Historical award/honour facts retain their audit/provenance trail. §6 is the elaboration —
  it reuses `AFLDB-ISSUE-163`'s architectural lessons (minted-vs-natural key choice, "identity
  fields are void+replace only, everything else is correctable in place", `is_active` semantics)
  but does not copy its schema, because these three tables have an active importer and
  `club_leadership` does not (§6.2).
- **D2 — Rising Star / All-Australian ingestion.** Unchanged. `rising_star` and `all_australian`
  stay registered ingestion datasets (`award_definitions.py`, `all_australian.py`); ISSUE-165 adds
  a correction/void lifecycle **on top of** whatever `award_winners`/`award_nominations` rows those
  importers produce, exactly as it does for every other award group. No CSV/import acquisition
  change. Any future ingestion-path transition is explicitly deferred to `AFLDB-ISSUE-156` P11
  (Phase H, dataset-by-dataset CSV transition) and is **not** opened as a follow-up issue here.
- **D3 — dedicated admin route.** `/admin/awards` (§9). Not implemented this session.

**P8 absorption.** `AFLDB-ISSUE-156.md` §1 names P8 as "domain routes replacing
`/admin/data-editor/*`… decomposition, not rewrite." The awards/HOF/honour-team block of
`data-editor` (`AwardWinnerForm.tsx`, `HallOfFameForm.tsx`, `HonourTeamForm.tsx` and their three
Server Actions in `src/app/admin/data-editor/actions.ts`) is exactly the kind of domain slice P8
describes moving. ISSUE-165 takes ownership of that one slice; P8's remaining scope (players,
matches, match-sheet) is unaffected and stays a P8 placeholder.

**P11 non-goal, restated.** `rising_star` and `all_australian` CSV acquisition ownership is
untouched. This is a non-goal (§4), not a follow-up to raise separately.

---

## 3. Current-state evidence

### 3.1 Canonical tables and grain

All three live in `src/db/migrations/005_brownlow_awards.sql`, refined by `042`, `059`, `061`.

| Table | Grain / identity key | Identity-bearing columns | Notes |
|---|---|---|---|
| `award_winners` | **source record**, not (award, season, player): `UNIQUE NULLS NOT DISTINCT (source_id, source_record_id)` (042) | `award_id`, `season`, `player_id`/`player_name_raw` | A person can legitimately have two rows in one award-season (1984 All-Australian: 24 club-selection rows + 24 state-selection rows for the same players, `042` comment) — a `(award,season,player)` uniqueness rule would be **wrong**, not merely stricter |
| `hall_of_fame` | `UNIQUE NULLS NOT DISTINCT (name, inducted_year)` (042) — no `source_record_id` column exists on this table at all | `name`, `inducted_year` | Already carries `removed_year smallint` (005) — a genuine historical fact ("inducted, later removed") distinct from "this row was a data-entry error" (§5.2) |
| `honour_team_members` | linked: `UNIQUE (team_name, player_id) WHERE player_id IS NOT NULL`; unlinked: `UNIQUE (team_name, player_name_raw) WHERE player_id IS NULL` (059, two partial indexes, no plain `source_record_id` column) | `team_name`, `player_id`/`player_name_raw` | 059 already fixed the ISSUE-025 defect where a same-name different player could overwrite another; `createHonourTeamMember` already runs a duplicate-collision check (§5.3) that the other two domains lack |

`award_nominations` (Rising Star) and `captaincies` (Wikipedia captaincy import,
pre-`club_leadership`) share the same migration family but are **out of scope** — not named in
the umbrella's P5 domain list, and `captaincies` already has its own successor
(`club_leadership`, `AFLDB-ISSUE-163`) for the post-2027 authoritative record.

### 3.2 Current admin behaviour — create only, single capability

`src/db/queries/awards-admin.ts` exports exactly three functions:
`createAwardWinner`, `createHallOfFameInductee`, `createHonourTeamMember`. There is **no**
`updateAwardWinner`, no `voidX`, no `deleteX`, anywhere in the repository (confirmed by symbol
search across `src/`). `src/app/admin/data-editor/actions.ts` wires each to one Server Action
(`createAwardWinnerAction`, `createHallOfFameAction`, `createHonourTeamMemberAction`), and all
three — like every other action on that page — gate on the single capability
`data.dataEditor`, `SUPER_ADMIN_ONLY` (`src/lib/auth/capabilities.ts:76`). None of the three
mutations goes through `EDITABLE_ENTITIES` / `saveEdit()` (`src/lib/edit/spec.ts`); the generic
editor's entity list carries only `players`, `matches`, `draft_picks` — awards were deliberately
never registered there (they have their own dedicated create forms instead).

Each `create*` function already runs inside one `AFLDB_IMPORT_DATABASE_URL` transaction and
writes a required `data_edits` row via `recordDataEdit()` in the same transaction
(`AFLDB-ISSUE-027` pattern) — the audit-atomicity contract this issue must also honour for
edit/void/replace is already proven correct for create.

**Duplicate prevention is inconsistent across the three today**, and this is real evidence for
§5, not an assumption:
- `createHonourTeamMember` runs an explicit pre-insert collision check (`awards-admin.ts:382-417`)
  under a transaction-scoped advisory lock (`AFLDB-ISSUE-080` §5.3), refusing a second row for the
  same linked player or an ambiguous same-name entry.
- `createAwardWinner` and `createHallOfFameInductee` run **no** such check. An admin can create
  two `award_winners` rows for the same award/season/player, or two `hall_of_fame` rows for the
  same name/year with different `player_id`s, with nothing refusing it. (The database-level
  unique constraints do not catch this: `award_winners`' key is the *source record id*, which a
  manually-minted `award_winner:<uuid>` never collides on by construction, and `hall_of_fame`'s
  `(name, inducted_year)` key only catches an exact re-entry, not a distinct-`player_id` conflict
  under the same name/year.)

### 3.3 Audit and override infrastructure

- `data_edits.table_name` CHECK (`src/db/migrations/058_data_edits_editor_entities.sql`) already
  admits `'award_winners'`, `'hall_of_fame'`, `'honour_team_members'`. **No widening needed** for
  the append-only audit log, for create *or* for any new edit/void/replace mutation.
- `data_overrides.entity_type` CHECK (currently, after migration 098:
  `'players', 'matches', 'draft_picks', 'coaches', 'match_coaches', 'season_list_members',
  'fixtures', 'club_leadership'`) does **not** admit any of the three award tables. Widening is
  required if the durable record uses `data_overrides` (§6 concludes it must, for the rebuild
  case).
- `player_link_resolutions.target_table` already lists `award_winners`, `award_nominations`,
  `hall_of_fame`, `honour_team_members` as targets with **no stable identity across a lineage
  remap** (`tools/db/promotion-inventory.ts:484-499`: "no stable identity exists for an honours
  row… `target_id` is deliberately not a foreign key"). This is direct proof that any new
  lifecycle mechanism must key off a **natural/source identity**, never a surrogate `id`, for
  exactly the same reason every other umbrella phase does.

### 3.4 Reload / import ownership — the central finding

`tools/migration/import_awards.py` reloads every award group through
`reload_keyed()` (`tools/migration/common.py:410-693`), **not** truncate-and-reload — migrations
042/059 exist specifically to make that upsert safe (042's own comment: "the earlier
truncate-and-reload discarded every manual identity decision… `AFLDB-ISSUE-044`"). Reading
`reload_keyed()`'s body settles two separate questions with certainty rather than inference:

1. **The `UPDATE` only sets the columns the caller explicitly lists**
   (`common.py:646-668`: `assignments = [f"{c} = i.{c}" for c in plain]`, run against exactly the
   caller-supplied `columns`). A column added by a future migration and **not** added to
   `import_awards.py`'s column list for that call is never touched by a reload — this is the
   existing, already-shipped precedent for `award_winners.sort_order` (migration 061), which the
   importer's column list never includes. An additive `status` column follows the same free
   protection **as long as it is a column outside the importer's own field list**, and needs no
   override or replay branch to survive an *ordinary, scoped* reload of that award group.
2. **`import_awards.py` never consults `data_overrides` for any of the three tables.**
   `replay_admin_overrides()` (`common.py:981` onward) has branches only for `players` and
   (per the umbrella §3) `coaches`/`match_coaches`/`season_list_members`/`fixtures`/
   `club_leadership`. Nothing calls it for `award_winners`, `hall_of_fame` or
   `honour_team_members`. Manual **creation** already survives a reload today, but only because
   `reload_keyed()`'s scope parameters (`scope_column="source_id"`, `scope_values=[<group's own
   source_id>]`) exclude every `manual_admin_edit`-sourced row from that call's delete-missing
   sweep (`AFLDB-ISSUE-080`, e.g. `import_awards.py:688-692`) — it is never inspected, corrected or
   voided by the reload, simply left alone. **A correction or void of a source-owned row has no
   equivalent protection**: the next reload of that award group's own `source_id` will silently
   overwrite any field in the importer's column list back to the freshly-parsed source value,
   because the `UPDATE … SET c = i.c` runs unconditionally for every matched key.

**Why this cannot be closed with a bare additive column alone (the full-rebuild case).** All
three tables carry `player_id integer REFERENCES players(id)`. `import_awards.py` itself defends
against exactly this hazard for tables it *does* own scope declarations for
(`common.py`'s `set_reload_scope`, called from `import_awards.py:2676-2679`: "Declare what this
run rebuilds so `TRUNCATE … CASCADE` cannot silently empty a table no group here repopulates.")
— direct evidence that some caller in the full-rebuild pipeline runs `TRUNCATE … CASCADE` on a
foundational table. `TRUNCATE … CASCADE` on `players` empties **every** table with a foreign key
to `players`, including all three award tables, regardless of column list or scope. An additive
`status`/`status_reason` column populated only on the canonical row does **not** survive that —
the row itself, and every column on it, is gone, then reinserted fresh by the next
`reload_keyed()` run with a new `id` and the column's `DEFAULT`. This is exactly the reasoning
`AFLDB-ISSUE-160` already established for `players` itself (a full rebuild wipes it; a
`data_overrides` record plus a `replay_admin_overrides('players')` branch is what re-creates a
manual decision afterward).

**Conclusion (proves D1's `data_overrides` question, per the umbrella's explicit instruction to
prove it from current reload logic):** the *durable* record of a void, replace or a correction to
a source-owned row's identity-adjacent facts must live in `data_overrides`, replayed by a new
branch in `replay_admin_overrides()` for each of the three tables. A same-shaped `status` column
directly on the canonical row is safe and useful as a **cheap read-path cache** of that decision
(public queries filter on it without a join), but it must be treated as reconstructible from the
override, not as the source of truth, and the replay branch must re-populate it after every full
rebuild — exactly as `club_leadership`'s replay re-creates `ended`/`void` rows, except here the
canonical row survives an *ordinary* reload on its own and only the full-rebuild path needs the
replay to run.

**Open verification for implementation preflight** (not resolved here, per CLAUDE.md's rule
against overclaiming): confirm which script actually issues the `TRUNCATE … CASCADE` referenced
by `import_awards.py:2674`, and whether `afldb_test`/`afldb_dev`'s regular rebuild path invokes
it before every `import_awards.py` run or only for a full clean rebuild. This does not change the
architecture decision above (a full rebuild is a real, named path either way), only its
frequency.

> **RESOLVED at the implementation preflight — and the frequency is worse than assumed.**
> See §17.2. Two different scripts truncate, they reach different subsets of the three tables,
> and one of them runs on **every canonical rebuild**, not only an exotic full one.

### 3.5 Capability naming convention

`src/lib/auth/capabilities.ts` establishes an exact, mechanical pattern for every domain added
since `AFLDB-ISSUE-159`: `data.<domain>.read` (`ADMIN_AND_UP`) / `data.<domain>.edit`
(`SUPER_ADMIN_ONLY`), each with a one-paragraph comment stating why read widens no boundary an
Admin does not already have (reading is public data plus `operations.audit.read`'s existing full
edit trail) and why edit stays Super Admin-only (the mutation becomes a public fact immediately,
no draft stage). `data.coaches.*`, `data.draft.*`, `data.seasonLists.*`, `data.fixtures.*` all
follow it letter-for-letter. The umbrella's own §2 table used the working name
`data.honours.correct` before this domain had a real preflight; it is superseded here by
**`data.awards.read` / `data.awards.edit`**, matching the convention exactly.

### 3.6 Nav model

`src/app/admin/nav-model.ts:85-91` lists the Data group's admin links, each `{ href, label,
capability }`, appended conditionally to `dataLinks` and only rendered if `dataLinks.length > 0`.
Adding `{ href: '/admin/awards', label: 'Awards & Honours', capability: 'data.awards.read' }`
follows the exact shape already used for `/admin/coaches`, `/admin/draft`, `/admin/season-lists`,
`/admin/fixtures`.

### 3.7 Public consumers

> **CORRECTED at the implementation preflight. The "one module" claim below is WRONG — there
> are four, and the two it misses are the two whose breakage would be least visible.** A symbol
> search for `FROM`/`JOIN` against the three tables across `src/` finds
> `src/db/queries/awards.ts` (19 references), **`src/db/queries/grid-solver.ts` (17)**,
> **`src/db/queries/nl/player-career.ts` (2)** and **`src/app/sitemap.ts` (2)**, plus the two
> ADMIN queue modules `src/db/queries/player-links.ts` and
> `src/db/queries/player-match-candidates.ts`. Grid Solver answers award-based clues directly
> off `award_winners`, natural-language search counts award wins per player, and the sitemap
> enumerates award seasons and honour-team names from these tables — none of which the table
> below names. **Every one of them needs the status filter in Stage 4+, and §12.6's invariance
> gate must be written against all four, not against `awards.ts` alone.** The two admin queue
> modules are already done: D-10's exclusion shipped in this session (§17.5).

Every public read for all three tables goes through **one module**,
`src/db/queries/awards.ts` — there is no separate admin-read module. Consumers, all confirmed by
import:

| Route | Reads |
|---|---|
| `src/app/awards/page.tsx` | `listAwards` |
| `src/app/awards/[slug]/page.tsx` | `getAward`, `getAwardWinners`, `getAwardSeasons`, `getAwardLeaders` |
| `src/app/awards/[slug]/[season]/page.tsx` | `getAward`, `getAwardSeason` |
| `src/app/hall-of-fame/page.tsx` | `listHallOfFame`, `getHallOfFameCategories` |
| `src/app/honour-teams/[slug]/page.tsx` | `listHonourTeams`, `getHonourTeam` |
| `src/app/players/[slug]/page.tsx` | `getPlayerHonours` (awards, nominations, All-Australian, Hall of Fame, honour teams, first-kick goal — one combined block) |
| club pages | `getClubAwards`, `getClubBestAndFairest`, `getClubHonours` (captains/leadership are `captaincies`/`club_leadership`, unaffected) |
| season pages | `getHallOfFameInductees`, `getSeasonBestAndFairest` |
| `src/db/queries/awards.ts` internal | `getAwardLeaders` (win counts), `getClubAwards`/`getClubHonours` (aggregate counts) |

**None of these queries filters on any active/voided state today**, because no such state
exists. Every one of them must gain a `WHERE status <> 'void'` (or equivalent) once the column
exists, with the explicit constraint (per the umbrella brief) that an **unaffected** row's public
output must not change — proven by a query-level before/after row-count-and-content check in the
integration suite (§12), not by inspection alone.

---

## 4. Explicit non-goals

Restated from the umbrella brief and confirmed against current code, so a later phase does not
reopen them by drift:

- Brownlow administration and Brownlow authority — untouched. `createAwardWinner` already
  refuses the Brownlow slug outright (`awards-admin.ts:131-135`); this refusal is retained
  unchanged.
- No new award types or definitions (`awards` table rows) — this issue administers **winners**,
  not the award catalogue.
- No award acquisition/CSV redesign; `rising_star`/`all_australian` import ownership unchanged
  (D2).
- No player merge, no match rekey (both `AFLDB-ISSUE-156` P9/P10, unrelated high-blast-radius
  phases).
- No redesign of the public Awards/Hall of Fame/honour-team pages beyond the minimum status
  filter every read query needs (§3.7, §11).
- No destructive rewrite of historical source data — every correction/void is additive and
  reversible per D1.

---

## 5. Domain-by-domain lifecycle needs

The umbrella brief explicitly forbids assuming all three domains need identical operations. They
do not:

### 5.1 `award_winners`

| Need | Required? | Why |
|---|---|---|
| Create | already shipped | — |
| Edit safe metadata in place | **yes** | `votes`, `position`, `note`, `isCaptain`/`isViceCaptain`, `sort_order`, and (for a manual row only — see below) `clubId`/`clubNameRaw` have no correction path at all today, manual or source-owned |
| Void | **yes** | a wrongly-recorded winner (duplicate row, wrong award/season entirely) needs removal-that-preserves-audit |
| Replace | **yes** | "wrong player recorded as winner" — `award_id`, `season` and the recipient identity (`player_id`/`player_name_raw`) are identity-bearing (§3.1) and must be void + new row, never corrected in place, for the same reason `club_leadership` forbids correcting role/player/club/season |
| Restore/reactivate | **yes**, narrow | a void entered in error needs a reversal path (`void → active`), matching `club_leadership`'s `reinstateAppointment`; there is no "ended" state here (an award result does not "cease", unlike an ongoing appointment) |
| Duplicate prevention | **yes — currently absent (§3.2)** | add the same collision check `honour_team_members` already has, before or alongside the lifecycle work |
| Source/provenance visibility | **yes** | `/admin/awards` must show `source_id`/`source_record_id` so an admin can tell a DraftGuru/Wikipedia row from a `manual_admin_edit` one before deciding whether a correction needs an override (source-owned) or can just be an ordinary `UPDATE` (manual-owned, no reload risk) |
| Player-link handling | unchanged | `player_id`/`link_status_value` stay governed by `/admin/player-links`, not this issue |
| Audit history | **yes** | every mutation writes `data_edits` (table already admitted) |

### 5.2 `hall_of_fame`

Same shape as `award_winners` for create/edit/void/replace/restore/duplicate-prevention/audit,
with one domain-specific distinction the umbrella brief asks this issue to surface:
**`removed_year` already exists in the schema and already means something** — a real person was
inducted and later formally removed (a genuine, rare historical event in the actual AFL Hall of
Fame, not a data-entry mistake). This is **not** the same concept as D1's "void" (the *admin
record* was entered in error and should never have existed). The plan must keep them visibly
distinct:

- `removed_year` stays a plain correctable field (like `category`, `state`, `playing_career`),
  edited through the ordinary correction path, never through void/replace.
- The new `status`/`status_reason` pair is exclusively about the row's own validity as a record,
  independent of whether the underlying person was later removed from the Hall of Fame.

Identity-bearing (void+replace only, per §3.1's key): `name`, `inducted_year`. Safely
correctable in place: `category`, `is_legend`, `legend_year`, `club_name_raw`, `state`,
`playing_career`, `notes`, `removed_year`, `player_id` link (subject to the existing
player-links boundary).

### 5.3 `honour_team_members`

Same shape again, with the opposite asymmetry from Hall of Fame: this table **already has**
duplicate prevention (`AFLDB-ISSUE-025`/`080`, §3.2) and an already-correct identity model
(migration 059: linked rows key on `player_id`, unlinked on `player_name_raw`) — so this domain
needs the least new invariant-design work of the three; it mainly needs the edit/void/replace
mutation surface itself, reusing its existing collision check for the "replace" path (a
replacement's proposed player must pass the same check a create would).

Identity-bearing (void+replace only): `team_name`, `player_id`/`player_name_raw`. Safely
correctable in place: `position`, `role`, `club_name_raw`, `sort_order`, `note`.

---

## 6. Chosen lifecycle model (D1 elaboration)

### 6.1 Status vocabulary

`status IN ('active', 'void')` — two states, not three. There is no `club_leadership`-style
`ended`, because an award/HOF/honour-team fact does not have a natural "this stopped being true"
transition the way an ongoing office does; a wrong fact is `void` and a right one is `active`,
full stop. `status_reason` is `NOT NULL` whenever `status = 'void'`, mirroring
`club_leadership_void_reason_ck` exactly (`098_club_leadership.sql:146-147`).

Replacement is represented the same way `AFLDB-ISSUE-163` represents it — **not** as a table
self-reference by surrogate `id` (which is not stable across a lineage remap, §3.3), but as a
pair of natural-key strings carried in the `data_overrides` payload
(`replaces_key`/`replaced_by_key`), analogous to `replaces_appointment_key`/
`replaced_by_appointment_key`. A "replace" action is two writes in one transaction: void the old
row (with a reason referencing the new one) and create the new row (carrying a reference back).

### 6.2 Two-tier durability (the reasoning proven in §3.4)

| Layer | What it is | Survives an ordinary reload? | Survives a full rebuild (`TRUNCATE … CASCADE` on `players`)? |
|---|---|---|---|
| `status`/`status_reason` columns on the canonical table | cheap read-path cache | **yes**, for free — not in the importer's column list (§3.4.1) | **no** — the row itself is gone |
| `data_overrides` row (`entity_type` = the table name, `entity_key` = the row's own natural key, `field_group` = `'lifecycle'` or `'correction'`) | the durable decision | irrelevant — canonical row is untouched | **yes** — same guarantee every other domain in this umbrella relies on |
| new `replay_admin_overrides()` branch per table, called by `import_awards.py` immediately after that group's `reload_keyed()` | what re-asserts the columns after a rebuild | n/a | required — re-populates `status`/`status_reason` (and any corrected editable field) on the freshly-reloaded row by natural key, or re-creates the row if the group never reinserted it |

A field-level **correction** to a source-owned row's editable metadata (e.g. `votes` typo) needs
the same `data_overrides` + replay mechanism, because it touches a column that **is** in the
importer's list and so **is** overwritten by an ordinary reload, not only a full rebuild — the
`status` column is the one thing safe from an ordinary reload; a corrected `votes` value is not.
A correction to a **manual** (`manual_admin_edit`-sourced) row's editable metadata needs no
override at all: nothing ever reloads that row's fields (§3.4), so a plain `UPDATE` inside the
audited transaction suffices, exactly like today's `create*` functions.

### 6.3 Mutation contract (per table, shape identical across all three; `X` = the table)

| Action | Precondition | Effect | Override write | Audit |
|---|---|---|---|---|
| `correctX({rowId, expectedUpdatedAt, <editable fields>})` | row `active`; fields are the safely-correctable set (§5) | `UPDATE` canonical row | source-owned row only: `data_overrides` set/replace (field_group `correction`) | `data_edits`, old/new values |
| `voidX({rowId, expectedUpdatedAt, reason})` | row `active` | `status → void`, `status_reason` set | `data_overrides` set (field_group `lifecycle`) | `data_edits` |
| `reinstateX({rowId, expectedUpdatedAt})` | row `void` | `status → active`, `status_reason` cleared | `data_overrides` update | `data_edits` |
| `replaceX({rowId, expectedUpdatedAt, reason, <new row fields>})` | row `active` | void old + create new, one transaction, cross-linked | two `data_overrides` writes (or one covering both, TBD at implementation) | two `data_edits` rows |
| `createX` | — | unchanged from today | manual row: none beyond the existing create-time provenance; source-owned rows are never admin-created | unchanged |

Optimistic concurrency (`expectedUpdatedAt` / a CAS column) and row-level locking
(`SELECT … FOR UPDATE`) follow the `club_leadership` precedent (§13 of `AFLDB-ISSUE-163.md`);
these tables have no current `updated_at` column, so adding one is part of the migration (§8).

### 6.4 Why not simply widen `EDITABLE_ENTITIES`/`saveEdit()`

The generic editor's field-group model (`src/lib/edit/spec.ts`) has no concept of
"identity-bearing fields are void+replace only" or "this table has an active importer that must
be told to re-apply the correction" — every other domain that needed lifecycle semantics
(`coaches`, `season_list_members`, `fixtures`, `club_leadership`) built a **dedicated** query
module and action set rather than extending the generic editor, precisely because the generic
editor is for stateless field corrections on rows nothing ever reloads out from under it.
Following that precedent, this issue adds `src/db/queries/admin-awards.ts` (new) rather than
widening `EDITABLE_ENTITIES`.

---

## 7. Capability design

| Capability | Contributor | Admin | Super Admin | Enforcing guard |
|---|---|---|---|---|
| `data.awards.read` | – | ✓ | ✓ | `requireCapability('data.awards.read')` at `/admin/awards` and every read action |
| `data.awards.edit` | – | – | ✓ | `requireCapability('data.awards.edit')` at every correct/void/reinstate/replace/create Server Action |

Rationale, matching the existing comment convention in `capabilities.ts`: reading award
provenance and lifecycle state widens no boundary an Admin does not already have (the underlying
facts are public, and `operations.audit.read` already gives an Admin the full `data_edits`
trail); every mutation becomes a public fact immediately with no draft stage, so only a Super
Admin may write — identical reasoning to `data.coaches.edit`/`data.seasonLists.edit`/
`data.fixtures.edit`.

**Migration for `createAwardWinnerAction`/`createHallOfFameAction`/`createHonourTeamMemberAction`**:
these move from `data.dataEditor` to `data.awards.edit` when they relocate to
`/admin/awards` (§10) — this is a capability **narrowing in surface, not in population** (both
are `SUPER_ADMIN_ONLY`), so it is not a regression under §R-1 of the umbrella's stop conditions,
but the source-contract test (`tests/auth.test.ts`, `AFLDB-ISSUE-158`) must be re-run to confirm
`data.awards.edit` is referenced by a `requireCapability()` call at every one of these actions
before `data.dataEditor` stops guarding them.

Direct URL / direct action bypass must fail closed for Contributor and Admin on every `.edit`
call, and for every role but Admin/Super Admin on `.read` — proven by the same three-role
Playwright matrix every prior umbrella phase ran (§12).

---

## 8. Migration decision

**Additive migration required.** Not "none" (there is no lifecycle representation today) and not
"blocked" (nothing in the current schema prevents it). Contents, next free number **101** at this
snapshot (re-verify at implementation preflight):

1. On each of `award_winners`, `hall_of_fame`, `honour_team_members`:
   - `status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'void'))`
   - `status_reason text`
   - `CHECK (status <> 'void' OR status_reason IS NOT NULL)` (named per-table, mirroring
     `club_leadership_void_reason_ck`)
   - `updated_at timestamptz NOT NULL DEFAULT now()` (for the CAS/optimistic-concurrency contract,
     §6.3) — none of the three tables currently has one
   - ~~a partial index `WHERE status = 'active'` on each, to keep the public queries' filtered scan
     cheap (mirroring `honour_team_linked_player_uq`'s partial-index style)~~ **WITHDRAWN under
     D-8** (operator decision, 2026-09-13: no speculative performance indexes). Every existing row
     is `'active'`, so such an index would today cover the whole table and buy nothing the
     existing access-path indexes do not already give. An index is added when a measured plan asks
     for one. Migration 101 creates none, and a source-contract test pins that.
   - **ADDED, and not in the original plan: ACTIVE-ROW-ONLY uniqueness.** `hall_of_fame`'s global
     `hall_of_fame_name_uq (name, inducted_year)` is replaced by a partial unique INDEX with the
     same columns and the same `NULLS NOT DISTINCT`, plus `WHERE status <> 'void'`; both of
     migration 059's `honour_team_members` partial indexes are rebuilt with the same predicate
     added. Without this, "replace" is unexpressible for two of the three domains: the
     replacement necessarily re-uses the identity its voided predecessor still holds, and the
     global constraint refuses it. `award_winners` is untouched — its key is the SOURCE RECORD,
     which a void does not free and which a minted `award_winner:<uuid>` can never collide with.
2. `data_overrides.entity_type` CHECK widened: add `'award_winners'`, `'hall_of_fame'`,
   `'honour_team_members'` to the existing list (098's list, verbatim plus these three) — the
   same order-independence proof `AFLDB-ISSUE-159` §3.1/D-1 established applies here unchanged,
   because none of the three is a nightly-settle target
   (`src/lib/acquisition/manual-authority.ts`'s exact-set proof names only
   `match_period_scores`/`player_match_stats`/`brownlow_round_votes`).
3. `data_edits.table_name` — **no change to the CHECK**, already admits all three (058). **But
   that admission has obliged a promotion LINEAGE TARGET since migration 058 and never had one —
   a live defect this issue found and fixed, not a task it invented. See §17.4.**
4. `tools/db/promotion-inventory.ts` — a classification entry for each of the three tables is
   very likely **not required as a new registration**, because they are pre-existing
   `grant_import_write`-registered tables from before `AFLDB-ISSUE-151`'s promotion-inventory
   contract existed (§3.3's `target_table` evidence already treats them as import-writable with
   no stable id). This must be **re-verified at implementation preflight** (grep
   `promotion-inventory.ts` for `award_winners`/`hall_of_fame`/`honour_team_members` as a
   classified source table, not merely as a `player_link_resolutions` target) rather than assumed
   — the umbrella's own §6 requires every phase to re-check this fresh, and this session did not
   exhaustively trace the full classification list to avoid a repository-wide scan outside this
   issue's scope.
5. Privilege check: `award_winners` already carries an `afldb_auth` `SELECT` grant
   (`privileges.sql:485`, unrelated to this issue — player-link validation reads it) and all
   three are read by `afldb_app` today (the public pages already work) and written by
   `afldb_import` today (the importer already writes them). Adding two plain columns and one
   partial index to an already-granted table needs **no** `privileges.sql` change under the
   existing grant shape; **re-verify** that `award_winners`/`hall_of_fame`/`honour_team_members`
   are registered in `afldb_meta.import_writable_tables` (the table-driven grant registry,
   `privileges.sql:29`) at implementation preflight rather than assuming it from their age.

   > **VERIFIED, and the answer to items 4 and 5 is "nothing to add" — for a reason, not by
   > assumption.** All three are migration-005 tables, so they predate migrations 039 and 045,
   > whose registry seeds are derived FROM THE CATALOGUE (`SELECT c.relname FROM pg_class …`
   > with an explicit exclusion list that names none of them) rather than typed out. Both
   > registries therefore already carry all three, `privileges.sql` already reconciles them, and
   > the grants are TABLE-level — so three added columns and three rebuilt indexes need no
   > privilege change at all. Migration 101 contains no `GRANT`, no `grant_app_read()` and no
   > `grant_import_write()`, and a test pins that. Item 4 likewise: none of the three carries a
   > `PROMOTION_CONTRACT` classification entry today and none is added; the only
   > `promotion-inventory.ts` change is the lineage targets of §17.4.
6. Backfill: `status` defaults to `'active'` for every existing row — no backfill logic needed
   beyond the column default.
7. Rollback: forward-only in production per the umbrella's standing rule; disabling new
   routes/actions is the rollback path, not a down-migration that would drop `status_reason`
   audit trail.

---

## 9. `/admin/awards` information architecture (D-3)

Route family: `/admin/awards` (list/filter), `/admin/awards/[table]/[id]` (detail/correction),
`/admin/awards/new` (create, replacing the three `data-editor` forms).

At minimum:

- **Domain/type filter**: Award winners / Hall of Fame / Honour teams (three tabs or a type
  selector), each further filterable by award/team, season, and text search on
  player/name — reusing the `player-links` pager pattern per the umbrella's extraction rule
  (`AFLDB-ISSUE-156.md` §8: extract only where two or more routes already duplicate it; the
  pager is already an established reusable component).
- **Active/voided state filter**, defaulting to active-only, with an explicit toggle to include
  voided rows (an admin reviewing "what did we void and why" needs this).
- **Provenance/source column**: `source_id`/`source_record_id` (or "Manual" for
  `manual_admin_edit`), visible directly in the list, not only on drill-in — an admin must be able
  to tell at a glance whether a row is safely `UPDATE`-able or needs the override-aware correction
  path (§6.2).
- **Row detail**: full field set, current status, status reason if voided, replacement linkage
  (which row replaced/was replaced by this one, if any), and a `data_edits` history panel for
  this row (reusing the `AFLDB-ISSUE-157` audit-viewer per-entity pattern rather than building a
  second one).
- **Create**: the three existing forms, relocated, capability changed to `data.awards.edit`.
- **Correct / Void / Reinstate / Replace**: one action set per table, each asserting
  `data.awards.edit` first, following the disabled-focus-restore convention
  (`src/app/admin/brownlow/focus-restore.ts`, binding per the umbrella §8) so a refusal does not
  dump keyboard focus to `document.body`.

---

## 10. `/admin/data-editor` disposition

Following the exact precedent set for coaches/draft/season-lists/fixtures ("this page does not
edit X any more, see the new surface"): the "Awards, Hall of Fame & Representative Teams" block
(`src/app/admin/data-editor/page.tsx:104-111`, `AwardWinnerForm`/`HallOfFameForm`/
`HonourTeamForm`) is **removed** from `data-editor` and replaced with the same one-line
compatibility pointer the page already uses for draft picks (`page.tsx:138-145`): a short
paragraph plus a `<Link href="/admin/awards">`. `createAwardWinnerAction`,
`createHallOfFameAction`, `createHonourTeamMemberAction` and the three form components move to
`src/app/admin/awards/`; `data-editor/actions.ts` loses them. This is a move, not a rewrite, per
the umbrella's P8 rule.

---

## 11. Public behaviour and revalidation

Every function in `src/db/queries/awards.ts` (§3.7's table) gains a `status <> 'void'`
(equivalently `status = 'active'`, using the new partial index) predicate on its base table scan.
Because `status` defaults to `'active'` for every existing row and no existing row's other
columns change, **every currently-public row's output is byte-identical before and after this
change** — the acceptance gate (§12) proves this by a before/after row-count-and-content diff
against `afldb_test`, not by inspection.

Revalidation follows the established shape: the mutation computes the affected public paths
server-side (the award's `/awards/[slug]` and `/awards/[slug]/[season]`, the affected player's
`/players/[slug]`, and the affected club's page when `club_id` is set) and POSTs them to a
capability-gated, allowlisted revalidate route **after** the action resolves — never
`revalidatePath` inside the Server Action itself (`AFLDB-ISSUE-156` §7's standing R-7 hazard, the
Next 15.5 client-hang fix already applied to player-links).

---

## 12. Test / acceptance gates

Reuse `tests/awards-admin.test.ts` (existing home for awards mutation contracts) rather than
creating a new file by default; add an integration suite
(`tests/integration/admin-awards.test.ts`) only if no existing admin integration suite fits, per
the standing rule.

Staged gates, escalating only as required:

1. **DB-free unit**: status/reason CHECK shape, identity-field immutability (correct* rejects a
   change to an identity-bearing field), refusal vocabulary, CAS shape.
2. **Capability policy**: `data.awards.read`/`.edit` present in the `Capability` union and
   referenced by `requireCapability()` at every route/action (the `tests/auth.test.ts`
   source-contract, extended, not a new file).
3. **Direct-route/action authorisation**: Contributor refused everywhere; Admin reads, cannot
   mutate; Super Admin does both — for `/admin/awards` and every Server Action, including a
   direct POST bypassing the UI.
4. **Integration against `afldb_test`**: create → correct → void → reinstate → replace, for each
   of the three tables; duplicate-prevention added to `award_winners`/`hall_of_fame`
   (closing §3.2's gap) proven with two colliding attempts.
5. **Reload survival — the load-bearing proof**: run the real `import_awards.py` (the actual
   Python importer, not a mock) for the affected award group after a correction/void, and prove
   (a) an ordinary scoped reload leaves `status`/`status_reason` untouched (§6.1) and (b) a
   simulated full rebuild (delete the row via cascade, or truncate `players` in the test fixture)
   followed by the new `replay_admin_overrides()` branch re-creates the correct `status` and
   corrected fields. This is the direct test of §3.4/§6's central finding and must not be
   skipped or weakened.
6. **Public read-model invariance**: before/after row-count-and-content diff over every function
   in §3.7's table against `afldb_test`, proving an untouched row's output is unchanged.
7. **Corrected/voided-row public behaviour**: a voided row disappears from every consumer listed
   in §3.7; a replaced row's new identity appears and the old one does not (except explicitly in
   an admin void/history view).
8. **Audit atomicity**: a failed insert/update inside the transaction rolls back its `data_edits`
   row too (the existing `AFLDB-ISSUE-027` pattern, re-proven for the new mutations).
9. **Responsive/browser acceptance**: 1440×900 and 375×812, matching the umbrella's device
   priority precedent (desktop > tablet > phone, `AFLDB-ISSUE-161`/`162`/`163` closeout).
10. **Typecheck** (`tsc --noEmit`) and **release-gate/privilege impact** (`db:privileges`
    reconcile dry-run or equivalent, confirming no unintended revoke from the subtractive
    `afldb_auth` spec).

All database tests target `afldb_test`, never `afldb_dev`/`afldb_prod`.

---

## 13. Risks and stop conditions

| ID | Risk | Stop condition |
|---|---|---|
| R-1 | A field is treated as safely-correctable when it is actually identity-bearing (e.g. an admin "corrects" `award_winners.player_id` instead of void+replace), silently rewriting who a source says won an award | `correctX` must hard-refuse a request to change any of §5's identity-bearing fields; a unit test proves the refusal for every one, per table |
| R-2 | The new `replay_admin_overrides()` branches run in the wrong order relative to `reload_keyed()` for the same group, so the replay's `UPDATE`/`INSERT` targets a row the reload has not written yet (or a stale one it is about to overwrite) | Each branch must run **immediately after** its own group's `reload_keyed()` call, never batched at the end of the whole importer run — proven by the reload-survival integration test (§12.5) |
| R-3 | Public queries gain the status filter inconsistently (one query missed), so a voided row still surfaces somewhere | §3.7's table is the exhaustive consumer list; the invariance test (§12.6) is written against every row in it, not a sample |
| R-4 | `data_overrides.entity_type` widened before the replay branches ship (the umbrella's standing R-4 pattern) | Ship the reader/replay first, widen the CHECK in the same migration only once the Python branches exist on the same branch — the umbrella's deploy-order rule, restated |
| R-5 | Duplicate-prevention added to `award_winners`/`hall_of_fame` changes behaviour for an existing legitimate multiple-row case (the 1984 All-Australian club+state pairs, §3.1) | The new check must be scoped to `(award_id, season, player_id)` **and** exclude rows already distinguished by an existing legitimate source pattern; the 1984 case is a regression test, not an assumption |
| R-6 | A void/replace transaction and a concurrent `import_awards.py` run race on the same row | `SELECT … FOR UPDATE` inside the admin transaction (matching `club_leadership`'s concurrency contract, §6.3) |

---

## 14. Open questions for operator sign-off (D-4 onward)

Not blocking this planning document, but needed before implementation starts, following the
`AFLDB-ISSUE-163` D-1…D-18 sign-off pattern:

- **D-4.** Is a single `data_overrides` write per replace action acceptable (one row carrying
  both `replaces_key`/`replaced_by_key` halves written twice, once per side) or does the team
  prefer two independent override rows? (§6.1, §6.3)
- **D-5.** Should `/admin/awards` present all three domains as one merged list with a type
  filter (as drafted in §9) or as three fully separate sub-routes
  (`/admin/awards/winners`, `/admin/awards/hall-of-fame`, `/admin/awards/honour-teams`)? Both are
  compatible with the capability/migration plan above; this is a pure UI-architecture choice.
- **D-6.** Confirm the exact partial-index / `updated_at` column names before migration 101 is
  written (naming convention only, no architectural stake).
- **D-7 (verification, not a decision).** Confirm at implementation preflight: (a) which script
  issues the `TRUNCATE … CASCADE` referenced by `import_awards.py:2674` and whether it runs
  before every `afldb_test`/`afldb_dev` rebuild or only a full clean rebuild (§3.4); (b) whether
  `award_winners`/`hall_of_fame`/`honour_team_members` already carry a
  `tools/db/promotion-inventory.ts` source-table classification or need a new entry (§8 item 4);
  (c) their exact `afldb_meta.import_writable_tables` registration state (§8 item 5).

---

## 15. Dependencies and phase ordering

No dependency on `AFLDB-ISSUE-159`/`160`/`161`/`162`/`163` (all already resolved and merged, but
P5 never needed them — §2). No dependency on `AFLDB-ISSUE-164` (player-link confidence work is
orthogonal; `player_id` linkage on these three tables is read-only from this issue's
perspective). This issue does not block any other unallocated umbrella placeholder (P4, P6, P7,
P9, P10, P11, P12).

---

## 16. Summary and next action (as planned)

Repository preflight complete; no code, migration, privilege or deployment change made. Next
action is operator review of §14's open questions, followed by an implementation-session
preflight that re-verifies §8 items 4–5 and §14 D-7 before migration 101 (or whatever number is
free at that time) is written. Implementation is two natural stages, matching every prior sibling
in this umbrella: **Stage 1** (migration, `src/db/queries/admin-awards.ts`, the three
`replay_admin_overrides()` branches and their `import_awards.py` call sites, promotion/privilege
verification, unit + `afldb_test` integration including the reload-survival proof) and **Stage 2**
(the `/admin/awards` surface, capabilities, nav, `data-editor` disposition, browser acceptance).

---

## 17. Implementation record — Stages 1–3 (2026-09-13)

Written at the end of the implementation session, against the code as built. Where this section
and §§1–16 disagree, **this section is authoritative**; §§1–16 are left standing as the record of
what was planned and why, with inline correction notes where a claim turned out to be wrong.

Scope of the session: **Stages 1–3 only** (schema/promotion lineage, the DB query/service layer,
importer/rebuild replay). Stages 4–9 were not begun. Nothing was committed, staged, pushed or
deployed; no database was migrated; PROD was untouched.

### 17.1 Operator decisions, as implemented

| ID | Decision | Where it landed |
|---|---|---|
| **B-1** | `award_winners` source identity is total on `afldb_test`: `source_record_id IS NULL` = 0, `source_id IS NULL` = 0, total 3,712. A defensive refusal is still required for any future row without a durable key. | `lockAwardWinner()` returns `no_durable_key` when either half is absent, and the `award_winners` replay branch carries the matching refusal. Both are pinned by tests, and the 0/0 counts are re-measured by the integration suite rather than trusted. |
| **B-2** | Migration 101 is free. | `src/db/migrations/101_awards_honours_lifecycle.sql` allocated. |
| **D-8** | No speculative performance indexes. | Migration 101 creates no `CREATE INDEX`; the planned per-table `WHERE status = 'active'` index is withdrawn (§8 item 1). The three UNIQUE indexes it does create are identity constraints, not performance work. |
| **D-9** | Replay with a missing source row: correction → fail closed; record → fail closed; lifecycle → **warn and retain**. | Each of the three replay branches refuses over the whole active set before writing anything, and reports a missing lifecycle target through `_warn_retained_lifecycle()` without deleting the override. Proven both ways in the integration suite. |
| **D-10** | Voided rows leave the admin player-link and candidate queues. | `status <> 'void'` added to the `award_winners` / `hall_of_fame` / `honour_team_members` arms of `listUnresolvedLinks()` and `loadSourceEvidence()`, and to the honour-team slot-occupancy check in `player-match-candidates.ts`. |
| **D-11** | `awards.first_season` / `last_season` recomputed from ACTIVE rows only, in the same transaction; the importer's own update likewise. | `recomputeAwardSpan()` runs inside every `award_winners` void, reinstate, replace and create transaction; `import_awards.py`'s All-Australian span update gained `AND status = 'active'` on both halves. A test pins that the two use the identical predicate. |
| **D-12** | `src/lib/ingest/datasets.ts` refuses an upsert over a row carrying an active lifecycle/correction override, and learns no override semantics. | A pre-upsert `EXISTS` check in `allAustralian.promoteRow()` that throws a sentence naming the field group and the entity key. A `record` override is deliberately not a blocker: those name `manual_admin_edit` rows this pipeline's own source key can never address. |

### 17.2 Rebuild evidence — §3.4 / D-7(a) answered, and the frequency corrected

Two scripts truncate, and they reach **different subsets** of the three tables. The planning
document treated "a full rebuild" as one exotic path; it is two paths with different blast radii.

- **`tools/migration/load_reference_data.py`** truncates `seasons` and `clubs` (plus
  `club_aliases`, `stat_definitions`, `stat_availability`) with `CASCADE`. `award_winners` has
  foreign keys to both `seasons(year)` and `clubs(id)`, so **`award_winners` is inside that
  cascade closure**. `hall_of_fame` and `honour_team_members` are **not**: neither references
  `seasons` or `clubs` (migration 005 gives them only `players`, `sources` and `import_batches`).
  **This script is stage `reference` of the canonical rebuild** (`tools/db/rebuild-test.ts`),
  which runs it before `fitzroy` and before `awards-honours` on **every** rebuild — so
  `award_winners` needs its replay routinely, not exceptionally.
- **`tools/migration/import_legacy_afl.py:455`** is the only script that truncates `players`, and
  it is the retired legacy bootstrap loader — **not** a stage of the canonical rebuild. A
  `players` truncate is what reaches `hall_of_fame` and `honour_team_members`; so does a
  promotion, which rebuilds the candidate from empty.

The §6.2 conclusion is unchanged and now better evidenced. The `status`/`status_reason` columns
survive an ordinary scoped reload for free (proven in the integration suite by running the real
`reload_keyed()`); the `data_overrides` record plus the replay is what survives a truncate, and
for `award_winners` that is every rebuild.

### 17.3 Grain and key shapes, as built

| Table | Canonical identity | `data_overrides.entity_key` | Promotion lineage identity |
|---|---|---|---|
| `award_winners` | `(source_id, source_record_id)` — migration 042, **unchanged** | `<sources.key>:<source_record_id>` | `<sources.key>` + `\|` + `<source_record_id>` |
| `hall_of_fame` | `(name, inducted_year)` — migration 042, now **active-row-only** | `<sources.key>:<name>` + `\|` + `<inducted_year>` (LAST separator splits; empty year half = NULL) | `<name>` + `\|` + `<inducted_year>` |
| `honour_team_members` | linked `(team_name, player_id)`, unlinked `(team_name, player_name_raw)` — migration 059, both now **active-row-only** | `<sources.key>:<team_name>` + `\|` + `<player identity>` (FIRST separator splits) | `<team_name>` + `\|` + `<player identity>` |

`<player identity>` is the shared durable identity string `resolvePlayerIdentity()` produces
(`afltables:<path>`, else `manual_admin_edit:<token>`) for a linked row, and
`name:<player_name_raw>` for an unlinked one. No payload anywhere carries a row id, a club id or a
player id, and no replay branch reads a display name.

**A known limit of the fixed key shapes, recorded rather than worked around.** Because the
`hall_of_fame` and `honour_team_members` keys are NATURAL and include the source, two rows of the
SAME source cannot both hold a durable record for one natural key. The ordinary replacement — a
source-owned row voided and re-entered as a `manual_admin_edit` one — is unaffected, because the
two keys differ in their source half; that is the case §12.4's gate exercises and it works. But
voiding a MANUAL row and re-creating it under the same name/year (or the same team and raw name)
is refused with `reason: 'conflict'` by `refuseClaimedKey()`, because the second record would
silently overwrite the first. The refusal is deliberate and states the reason; an operator who
needs that shape reinstates the existing row instead.

### 17.4 The `data_edits` lineage defect — found, not invented

Migration 058 admitted `award_winners`, `hall_of_fame` and `honour_team_members` into
`data_edits_table_name_check`. **None of the three has ever had a lineage target in
`tools/db/promotion-inventory.ts`**, and `/admin/data-editor` has been creating rows in all three
since `AFLDB-ISSUE-080`. All three are import-writable tables that a promotion rebuilds, so an
honours audit row was reinstated with its `row_id` integer unchanged, counted by nothing and
remapped by nothing — after a lineage-changing promotion that integer names a different award, a
different inductee or a different selection. This is the `AFLDB-ISSUE-142 (B)` misattribution the
gate exists to prevent, and precisely the defect `AFLDB-ISSUE-160` D-3 found for `draft_picks` in
migration 057. It is the **fourth** instance of the same pattern.

Fixed here: three new `LineageIdentityRule` values (`award_winner_key`, `hall_of_fame_key`,
`honour_team_key`), their `LINEAGE_IDENTITY_SQL` `byId`/`byIdentity` pairs, and three new targets
on `data_edits.lineageRefs[row_id]`. A row with no resolvable identity is reported **unresolved**
and never remapped by name — in particular, an honour-team row that IS linked but whose player
carries no durable identity is excluded from the identity SQL entirely rather than falling back to
its display name, which would re-create the `AFLDB-ISSUE-025` defect migration 059 exists to
prevent.

**The standing contract now exists.** `tests/db-promotion-check.test.ts` reads the
`data_edits_table_name_check` allowlist out of the migrations (last definition wins) and requires
every admitted name either to carry a lineage target or to appear in an exemption register WITH A
REASON. Adding a table to the CHECK now forces the decision at review time rather than on the
night of a promotion.

**One recorded gap that register surfaces, and it is not this issue's.**
`brownlow_vote_entry_state` is admitted by migration 094 and has no target. Its primary key IS
`match_id`, so a `data_edits` `row_id` for it is a match id and a lineage change **does** renumber
it; the table's own `lineageRefs` remap its columns, but its audit rows are not covered. It needs
a `matches` / `match_key` target. That belongs to the Brownlow admin domain
(`AFLDB-ISSUE-155`), not here, and is recorded in the exemption register so it cannot be silently
inherited. `brownlow_season_authority` is a genuine exemption: its `row_id` is a season year, a
permanent natural identity nothing renumbers.

### 17.5 What Stages 1–3 changed

**Stage 1 — schema and promotion lineage.** Migration 101 (three columns and two CHECKs per table;
active-row-only `hall_of_fame` and `honour_team_members` identity indexes; `data_overrides`
widened by the three names; no `created_at`, no `CREATE INDEX`, no `GRANT`, no data written).
`promotion-inventory.ts` lineage targets and identity SQL. The frozen Python lifecycle enum
`HONOUR_LIFECYCLE_STATUSES` plus `HONOUR_FIELD_GROUPS`, pinned against the migration and against
the TypeScript writer. `OVERRIDE_ENTITY_TYPES` inventory widened (documentation only — the
settle-authority proof still consults the live CHECK, and the order-independence chain is extended
to the post-101 constraint).

**Stage 2 — `src/db/queries/admin-awards.ts`** (new). Readers and the five mutation primitives for
each of the three domains: create, correct-safe-metadata, void, reinstate, replace. `SELECT …
FOR UPDATE` plus an `updated_at` compare-and-swap on every mutation; the `AFLDB-ISSUE-080` §5.3
advisory lock reused unchanged for every honour-team identity writer; `data_edits` written in the
same transaction as every canonical write and every override write; a post-write refusal always
THROWS (`RollbackRefusal`) so `postgres.js` rolls back rather than committing a half-done
mutation. Identity-bearing fields are refused with one shared sentence per domain.
`award_winners` duplicate detection surfaces a same-`(award, season, player)` row for
CONFIRMATION rather than refusing it, so the 1984 All-Australian club and state pairs stay
recordable (R-5).

**Stage 3 — replay.** Three new `replay_admin_overrides()` branches in `tools/migration/common.py`,
each shaped on the established precedents: `coaches` for the source-owned correction delta
(`jsonb_exists`, absent key leaves the source value, explicit null clears it), `club_leadership`
for record re-creation and unconditional status payloads. Called from `import_awards.py`
immediately after each of the **seven** `award_winners` reload groups, the Hall of Fame reload and
the honour-team reload — inside each group's own transaction, before its commit, so reload and
replay land together (R-2). Two further importer changes the lifecycle made necessary:
`reload_keyed()`'s out-of-scope key preflight takes a new `lifecycle_column` so a VOIDED
out-of-scope row no longer refuses the whole awards import (it no longer holds the key), and
`_refuse_honour_team_identity_collisions()` ignores voided rows for the same reason. Without these
two, an ordinary and correct administrative decision would brick the importer.

### 17.6 Corrections to §12's test plan

Gate 5 (reload survival) is implemented as two proofs rather than one, and by spawning the REAL
`reload_keyed()` and `replay_admin_overrides()` out of `common.py` rather than the whole
`import_awards.py` — running the full importer needs every tracked manifest and would reload real
honours rows, which a test must not do. Gate 6 (public read-model invariance) and gate 7
(voided-row public behaviour) are **Stage 4+ work**, because the public status filter itself is:
§3.7's corrected four-module list is what they must be written against. Gates 2, 3 and 9
(capability policy, direct-route authorisation, browser acceptance) are Stage 4+ by definition.

### 17.7 Known-open risks carried into Stage 4+

1. **The public read path is unfiltered.** No query in `awards.ts`, `grid-solver.ts`,
   `nl/player-career.ts` or `sitemap.ts` filters on `status` yet, so a voided row would still be
   public. Nothing can void a row today — there is no route, no Server Action and no capability —
   so there is no live exposure; but Stage 4 must land the filters before any mutation surface is
   reachable, and the two orders are not interchangeable.
2. **Two creators exist.** `src/db/queries/awards-admin.ts`'s three `create*` functions are still
   what `/admin/data-editor` calls, and they write NO durable record — a row created through them
   does not survive a rebuild. The new module's creators do. Stage 4's `data-editor` disposition
   (§10) is what closes this, by repointing the three Server Actions and retiring the old module.
3. ~~**Migration 101 is unapplied.**~~ **Applied to `afldb_test` by the operator, 2026-09-13**
   (`101_awards_honours_lifecycle.sql ... ok`). Still unapplied on DEV and PROD. Deploy order
   remains binding and is the standing umbrella rule: migration first, then
   `npm run db:privileges` (a no-op here, but the reconciler is what proves it), then the code.
   App read has been fail-closed since migration 039.

### 17.8 The first DB-backed run, and the five failures it found (2026-09-13)

The operator applied migration 101 to `afldb_test` and ran the suite: **18 passed / 5 failed**.
All five are recorded here with their real cause, because three of them were the suite's own
fault and saying so is the only way the next session can trust the other two.

| # | Failure | Cause | Verdict |
|---|---|---|---|
| 1 | `applies cleanly` expected 6 CHECK constraints, found 3 | The assertion counted `conname LIKE '%status%'`, which can only ever find 3 — `<table>_void_reason_ck` does not contain the word "status" | **Test defect.** The schema is correct and was NOT renamed to suit a broken query; the assertion now names all six constraints explicitly and checks each definition |
| 2 | award span stayed `2026` after a void, expected NULL | The award still had eight ACTIVE winners left by earlier tests in the same file. `recomputeAwardSpan()` was right: NULL is only correct when the voided row was the last active winner | **Fixture-isolation defect.** The recomputation was NOT weakened; the test now owns an award with exactly one winner |
| 3 | the duplicate test's FIRST create was already refused | Earlier tests had recorded that player on that award in that season, so the `(award, season, player)` duplicate check fired — working exactly as designed | **Fixture-isolation defect** |
| 4 | Hall of Fame replacement key was `…:AFLDB-ISSUE-165-TEST Linked\|1999`, expected `…:AFLDB-ISSUE-165-TEST Source Inductee\|1999` | `insertHallOfFame()` overwrote the administrator's supplied name with `players.display_name` whenever a player was linked — inherited from the legacy `awards-admin.ts` creator | **IMPLEMENTATION defect.** See below |
| 5 | destructive-rebuild test's create refused | Same as 3 | **Fixture-isolation defect** |

**Failure 4 is the one that mattered, and it is a real bug this issue introduced by copying the
legacy creator.** `hall_of_fame.name` is not a display fact: migration 042 keys the table on
`(name, inducted_year)` and §17.3's durable key is `<source key>:<name>|<inducted_year>`. Deriving
the name from the linked player therefore filed the induction under a DIFFERENT key from the one
the administrator asked for — a silent identity move, on the one table whose name IS its identity,
which is precisely what R-1 forbids. It also made the required case unexpressible: re-entering a
voided inductee under the SAME name and year while linking the person it should have been is
exactly how a mis-identified Hall of Fame row is corrected, and deriving the name from the new
player defeats it. **Fixed:** the supplied name is canonical, and the player's display name is
used only when no name was supplied at all. `award_winners` and `honour_team_members` keep the
legacy behaviour deliberately — on those two the display name sits beside a separate identity (a
minted source record id; the player id itself) and moves nothing that decides which row it is. A
source-contract test now pins the asymmetry so it reads as a decision rather than an oversight.

**Isolation and repeatability.** One rule: every test that writes owns its own identity. An award
is a single INSERT, so each test makes its own (`afldb-issue-165-test-<tag>`); Hall of Fame and
honour-team names carry the test's tag. Cleanup (`purgeFixtures()`) runs in `beforeAll` AND
`afterAll` and keys on two STABLE prefixes — never a per-run nonce — so it also clears debris a
crashed run left behind.

**One cross-run leak the first run proved.** A manual award winner's durable record is keyed
`manual_admin_edit:award_winner:<uuid>`, which carries neither prefix, so the original cleanup
missed it: exactly one such `record` override survived on `afldb_test`, naming an award that had
been deleted. Left alone it would have failed the next run's replay closed with "award_slug does
not resolve to an award". The sweep now matches the override PAYLOAD as well as the key, and the
leaked row was removed by the repaired `beforeAll`.

**A gap the run also exposed, now closed.** `tests/integration/awards-reload-links.test.ts` — the
suite that would exercise the real honours reloads — skips entirely on this machine, because it
requires `AFLDB_TEST_IMPORT_DATABASE_URL` and no worktree defines it. That left `reload_keyed()`'s
new `lifecycle_column` argument with no test at all, so the ISSUE-165 suite now proves it
directly under the owner role: an ACTIVE out-of-scope Hall of Fame row still refuses the reload
(AFLDB-ISSUE-080 unchanged), and the same row once VOIDED does not — the whole point of the
argument. `delete_missing=False` throughout, so the real 343-row Hall of Fame is untouched.

**Result: 24 passed / 0 failed, twice in succession**, and the database is left exactly as found —
`award_winners` 3,712, `hall_of_fame` 343, `honour_team_members` 113, zero fixture awards, zero
fixture players, zero overrides and zero audit rows for the three entity types.
