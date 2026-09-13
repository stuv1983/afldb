# AFLDB-ISSUE-165 — Awards & Honours Administration: correction, voiding and replacement lifecycle

**Status:** Open / **Stages 1–7 complete, deployed to DEV. Stage 8 STOPPED at 8.1 on a genuine
rendered-acceptance defect (§20); a source-only corrective fix is now written and validated but
UNCOMMITTED, UNDEPLOYED (§20.3).** DEV is on `8250abe` (`main`) and still SERVES THE DEFECT LIVE —
the fix has not been pushed or deployed. Root cause: a `.admin-cards` CSS class-name collision
with the unrelated responsive-table-card pattern used by `admin/coaches`/`admin/draft`/
`admin/fixtures` (§20.1). Fix: the awards landing page's cards renamed off the shared classes onto
dedicated `.awards-admin-*` ones with their own always-visible grid rule (§20.3) — `typecheck`/
`eslint`/`git diff --check` clean, shared responsive-table pattern proved untouched. Stage 8 is
**not** PASS and this issue is **not** Resolved: once the operator commits, pushes and redeploys,
**Stage 8 restarts from 8.1** — no role-boundary, lifecycle-fixture, direct-route/action,
responsive or focus/accessibility gate has been run yet.
**Earlier state — Stages 1–6 implemented and GREEN on `afldb_test` (30/30, twice in
succession); uncommitted, undeployed.** Stage 4 (public/read-model status filters across all four
consumers), Stage 5 (`data.awards.read`/`.edit`, nav, route and action guards) and Stage 6 (the
`/admin/awards` surface and the `/admin/data-editor` disposition) are complete — **§18 is the
implementation record.** The importer-role reload gate §17.8 could not run has now been run
(96/1/10; the one failure is a pre-existing `captaincies` manifest assertion, out of scope).
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
the record of what was decided and why. **§17 is the implementation record for Stages 1–3 and §18
for Stages 4–6**; §18 closes every item §17.7 carried forward and records two defects in the code
§17 describes (§18.4). §17 CORRECTS
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

> **ALL THREE CLOSED at Stage 4–6 (§18).** Item 1: every scan in all four modules now carries
> `status = 'active'`, landed BEFORE any mutation surface became reachable (§18.1, §18.2), and R-3
> is now held by a counting contract rather than by a list. Item 2: `/admin/data-editor` no longer
> calls the legacy creators and `/admin/awards` is the one create path; the module is retained
> without an application caller and its retirement is recorded as closeout work (§18.6, §18.10).
> Item 3 stands unchanged and is restated in §18.11.

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

> **The skip below is no longer true.** The Stage 4–6 session established a valid importer-role
> test DSN from the operator's existing configuration and ran the suite: 96 passed / 1 failed / 10
> skipped, the one failure a pre-existing out-of-scope `captaincies` manifest assertion (§18.8).
> The direct proof described below is kept — it is cheaper and it is the one that names the
> argument under test.

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

---

## 18. Implementation record — Stages 4–6 (2026-09-13)

Written at the end of the Stage 4–6 session, against the code as built. Where this section and
§§1–17 disagree, **this section is authoritative** for Stages 4–6; §17 remains authoritative for
Stages 1–3. Scope of the session: **Stages 4, 5 and 6 only.** Nothing was committed, staged,
pushed or deployed; no migration was applied; DEV and PROD were untouched. Stages 7–9 (closeout,
browser acceptance, deployment) were not begun.

### 18.1 The ordering rule was honoured

§17.7 item 1 stated the binding constraint: the public status filters must land **before** any
mutation surface becomes reachable, and the two orders are not interchangeable. They were done in
that order within the session, and the two halves are separable in review: every Stage 4 change is
a `WHERE` predicate in a read path, and no route, action or capability existed until those were
complete. There was never an interval in which a row could be voided and still be public, because
until Stage 5 nothing could void a row at all.

### 18.2 Stage 4 — the exhaustive consumer audit, and what it found

§3.7's corrected list named four public modules. A fresh symbol search across `src/` for
`FROM`/`JOIN` against the three tables confirms it and adds nothing:

| Module | Scans | Disposition |
|---|---|---|
| `src/db/queries/awards.ts` | 19 | every one filtered `status = 'active'` |
| `src/db/queries/grid-solver.ts` | 17 | every one filtered, including the nested `award_winners w2` subquery that decides which seasons count as All-Australian squad seasons |
| `src/db/queries/nl/player-career.ts` | 2 | both filtered (the `award_count` metric and the `award_count` condition) |
| `src/app/sitemap.ts` | 2 | both filtered |
| `src/search/query-builder-spec.ts` | 2 relations | filtered in the **correlation**, not in a column (§18.3) |
| `src/db/queries/admin-awards.ts` | the admin surface | must see voided rows; unfiltered by design |
| `src/db/queries/awards-admin.ts` | retired creators | no application caller (§18.6) |
| `src/db/queries/db-health.ts` | 11 operational counts | **deliberately unfiltered** (§4.7), with the reason recorded in the source |
| `src/db/queries/player-links.ts`, `src/db/queries/player-match-candidates.ts` | D-10 | already `status <> 'void'` from Stage 1–3; re-checked, unchanged |
| `src/lib/ingest/datasets.ts`, `src/lib/acquisition/manual-authority.ts` | D-12 / inventory | unchanged |

`src/components/ClubHonours.tsx`, `src/app/seasons/[year]/page.tsx`, `src/app/hall-of-fame/page.tsx`,
`src/app/honour-teams/[slug]/page.tsx`, `src/app/awards/**`, `src/app/clubs/[slug]/page.tsx`,
`src/db/queries/audit-log.ts` and `src/lib/audit-view.ts` name one of the three tables but issue no
scan of their own — they render a reader's output, or name the table as a `data_edits` allowlist
entry.

**R-3 is closed by a counting contract, not by this table.** A list in a document goes stale;
`tests/honours-lifecycle-public-contract.test.ts` asserts, per module, that the number of scans
equals the number of lifecycle predicates, with comment lines stripped so a paragraph explaining
the rule cannot stand in for the rule. Adding a query without its filter fails there.

### 18.3 Why the Query Builder's filter is in the correlation

`player.hall_of_fame` and `player.awards` carry `AND r_hof.status = 'active'` /
`AND r_aw.status = 'active'` in their `correlation`, which the compiler splices as
`WHERE <correlation> AND <cardPredicate>`. Putting it there rather than exposing a `status` column
means no future column addition can bypass it, and no operator can ask the tool a question whose
answer contradicts the public Hall of Fame page about who is in the Hall of Fame. The tool is
admin-facing, but it answers questions about the same canonical facts the site publishes; those two
disagreeing would be worse than the tool not existing.

### 18.4 Two corrections Stage 4 made to Stage 1–3 code

Both are defects in the code as built, found by Stage 4's own work, not tasks it invented.

1. **`readHonourOverrides()` read `data_overrides` on the APPLICATION pool.** Migration 073 grants
   `SELECT` on that table to `afldb_import` and to nobody else — it carries no
   `afldb_meta.grant_app_read()`, deliberately, because it is not application data — and application
   reads have been fail-closed since migration 039. The function therefore worked for a database
   OWNER (which is what the integration suite connects as, which is why 24/24 did not catch it) and
   would have failed closed for the running application, where it matters: on the first
   `/admin/awards/*/[id]` page load. Moved to `withImportConnection`, matching
   `readDraftOverrides()` in `admin-draft.ts`, which reaches the same table the same way for the
   same reason.
2. **The revalidation path set was short by three pages, and Stage 4 is what made them movable.**
   §11 named `/awards/[slug]`, `/awards/[slug]/[season]`, the player page and the club page. Stage
   4's own filters put three more cached pages in scope: `/awards` (ISR 24h, renders each award's
   winner and season COUNTS, both now excluding voided rows), `/seasons/<year>` (ISR 1h, renders
   that season's club best-and-fairest winners and its Hall of Fame inductees) and `/sitemap.xml`
   (now drops a season or a team whose every row is void). All three added to the server-computed
   path sets and to the route's allowlist. `/hall-of-fame` is `force-dynamic` and needs no
   invalidation; it is named anyway so the set reads as the complete consumer list.

### 18.5 Stage 5 — capabilities, navigation and guards

`data.awards.read` (ADMIN_AND_UP) / `data.awards.edit` (SUPER_ADMIN_ONLY), following
`src/lib/auth/capabilities.ts`'s established convention letter for letter, with the same
one-paragraph justification shape the four sibling domains carry. `/admin/awards` added to the Data
group gated on `data.awards.read`, after Fixtures.

The `AFLDB-ISSUE-158` source contract in `tests/auth.test.ts` does most of the enforcement work
mechanically, and was extended rather than duplicated: both names placed in
`EQUIVALENT_ROLE_GUARD` (a typed `Record<Capability, …>`, so a new capability fails the typecheck
until it is placed), the Data-group order assertions updated, and a nav visibility test added. That
contract already requires every declared capability to be enforced at a real boundary, every admin
page / route handler / Server Action to reach a guard before it awaits anything else, and every
nav-gated href to enforce its own capability at its own `page.tsx` — so all ten new pages, the
route handler and all fifteen Server Actions are covered by rules that already existed.

**The three `new` pages assert `data.awards.edit`, not `.read`**, following the `/admin/draft/new`
precedent: every path they reach is a mutation, and `.edit` is strictly narrower than `.read`, so
this admits nobody `.read` would not. §5.3's "every page enforces `.read`" is satisfied in
substance — no viewer without `.read` reaches any of them.

### 18.6 Stage 6 — the surface, and the `/admin/data-editor` disposition

Ten routes, three domains kept separate (D-5 answered in favour of separate sub-routes): a landing
page with three cards and the active/void counts, three filtered paged lists, three detail pages and
three create pages. Provenance is a column in every list and a row in every detail page, because
whether a record is source-owned decides whether correcting it needs a durable override to survive
the next reload — the distinction §6.2 turns on, so it is not a footnote.

Identity-bearing fields appear under "What this record asserts" and appear nowhere editable, with
the reason beside them; the mutation contract refuses them a second time regardless. Replacement is
two steps: collect and validate, then a preview naming both halves — *void this, then record that* —
and only the confirmation carries the flag the action requires. Row ids are shown labelled as what
they are ("renumbered by a rebuild; not a stable identifier"); the durable natural key is what is
presented as identity, and replacement linkage is rendered from the `data_overrides` payload's
`replaced_by_key` / `replaces_key`, never from a row id.

History reuses the `AFLDB-ISSUE-157` viewer's own reader and renderer (`listDataEditHistory`,
`ValueDiff`) inline, with a link to the full trail — the same code rendering the same rows, not a
second audit subsystem.

The three existing forms were **moved and rewired, not rewritten**: their field sets are the ones
`/admin/data-editor` asked for, lifted into `*Fields.tsx` components so the create form and the
replacement half of a replacement ask for the same facts in the same words. One deliberate change:
the Hall of Fame form no longer pre-fills the inductee name from a linked player, which is §17.8
failure 4's defect in its original form.

**`/admin/data-editor`**: the three forms deleted, their three Server Actions deleted, the block
replaced with the same one-line compatibility pointer the Draft move established. `page.tsx` no
longer reads `listAwards()` / `listHonourTeams()`.
`src/db/queries/awards-admin.ts`'s creators now have **no application caller** — one authoritative
create path, as §6.8 requires. The module itself is retained with a header stating it is retired and
that no caller may be added, because `tests/awards-admin.test.ts` and
`tests/integration/awards-reload-links.test.ts` exercise contracts through it that are worth keeping
(the Brownlow refusal, historical club-identity resolution, and the ISSUE-080 §5.3 advisory lock,
whose two frozen literals are pinned against `import_awards.py` from there). **Retiring the file
means porting those assertions first, and that is Stage 7–9 closeout work, recorded rather than done
in the same breath as the move.**

### 18.7 Validation

| Gate | Result |
|---|---|
| `npm run typecheck` | clean |
| `eslint` over every changed file | 0 errors. 6 pre-existing warnings remain, none introduced here: two unused imports in `data-editor/page.tsx` (unused at `HEAD` already) and four unused destructured parameters in `nl/player-career.ts` / `query-builder-spec.ts` |
| DB-free Vitest (123 files) | **4,571 passed / 1 failed / 14 skipped.** The one failure is `tests/finals-semantics-contract.test.ts`, the known Windows CRLF contract test that splits on a bare `\n`; it fails on this checkout and passes on Linux, and is unrelated |
| `tests/integration/admin-awards.test.ts` against `afldb_test` | **30/30, twice in immediate succession** (was 24/24; six Stage 4 tests added) |
| Residue after both runs | `award_winners` 3,712, `hall_of_fame` 343, `honour_team_members` 113, zero voided, zero fixture awards, zero fixture players, zero overrides, zero audit rows for the three entity types — the database left exactly as found |
| `tests/integration/awards-reload-links.test.ts` (importer role) | **RUN, and it no longer skips** — see §18.8 |
| Other DB-backed suites re-run | `club-honours`, `player-honours`, `query-builder`, `db-health` all pass. `grid-solver` (2), `release-gates` (4) and `data-editor` (1) carry pre-existing failures — §18.9 |

`current_database()` was proved to be `afldb_test` for both the owner role (`afldb_owner`) and the
importer role (`afldb_import`) before any DB-backed test was run.

### 18.8 The importer-role gate, which §17.8 could not run

§17.8 recorded that `tests/integration/awards-reload-links.test.ts` skipped all 107 tests for want of
`AFLDB_TEST_IMPORT_DATABASE_URL`. A valid importer-role test DSN **was** establishable from the
operator's existing configuration without exposing any credential: every DSN in `.env` shares one
endpoint (the `afldb_test` tunnel), so the existing `AFLDB_IMPORT_DATABASE_URL` credential
repointed at the database `AFLDB_TEST_DATABASE_URL` names is exactly the required DSN. It was
constructed in memory, passed to the child process's environment only, and never printed or written
to disk. A read-only probe confirmed `current_database() = afldb_test`, `current_user =
afldb_import`, and `SELECT`/`UPDATE` on `award_winners` and `SELECT` on `data_overrides`.

**Result: 96 passed / 1 failed / 10 skipped, 421 s.** The honours reload paths all pass under the
restricted importer role. The one failure is
`captaincies manifest reload … reloads the full 1,375-row manifest`, which expects
`records_read = 1375` and observes 1,774 — `data/awards/captaincies.csv` has held 1,774 data rows
since commit `d08591f` (ISSUE-118 §23.19–§23.22, "six captaincy lineages") and the assertion was
never updated. `captaincies` is explicitly **out of scope** for this issue (§3.1) and no file in
this session's diff touches it. Recorded here as a pre-existing stale assertion for whoever owns
ISSUE-112's manifest gates; **not** opened as a new issue, since it is a known-table drift with a
one-line fix rather than a defect.

The database was verified unchanged after the run: 3,712 / 343 / 113, zero voided, zero overrides.

### 18.9 Pre-existing DB-backed failures, and how each was proved pre-existing

None of these is caused by this session's diff, and none is a new issue — each is `afldb_test` data
drift against an assertion measured at an older rebuild.

| Suite | Failure | Evidence it is not ours |
|---|---|---|
| `grid-solver` | "ISSUE-076 won-final grid": solver 282, in-test oracle 283 | **Proved by direct A/B**: `src/db/queries/grid-solver.ts` was temporarily replaced with its `HEAD` version and the same test reproduced 282 vs 283 identically, then the working copy was restored. The grid's five axes are `games_at_multiple_clubs_min`, `teammate_of`, `single_game_stat_min`, `played_for_club`, `won_final_at_venue` — not one of them an award or Hall of Fame builder, and this session's grid-solver diff touches only the awards/HOF branches of the `compileAxis` switch |
| `grid-solver` | "three ISSUE-103 finals-win cells under one second" | a wall-clock gate; the `afldb_test` tunnel costs ~60 ms per statement |
| `release-gates` | 4 failures (goal/Brownlow regression count, ladder identity spans, attendance absence reasons, undated players 83 vs 18) | none reads an honours table; all are `players` / `matches` / `clubs` counts pinned to a specific rebuild |
| `data-editor` | "refuses to build a ladder for a season it has no matches for" | its precondition query finds no season without home-and-away matches; measured read-only on `afldb_test`: **0** such seasons. A data-state precondition, on tables this diff does not touch |

### 18.10 Deviations from the locked architecture

1. **D-5 answered as separate sub-routes.** §9 drafted one merged list with a type filter; §6 of the
   session brief and this implementation take the three-sub-route shape instead. Both were declared
   compatible with the capability and migration plan, and the separate shape is what keeps three
   different identity models and three different correctable-field sets legible.
2. **`awards-admin.ts` retained, not deleted** (§18.6), with no application caller. Recorded as
   closeout work rather than done here, to avoid dropping the regression coverage that currently
   reaches those contracts only through that module.
3. **The three `new` pages assert `.edit` rather than `.read`** (§18.5), following the draft
   precedent. Strictly narrower, so no boundary is widened.
4. **The activity-audit warning was kept**, not dropped to match the newer coach/draft precedent
   (which only `console.error`s). The old `/admin/data-editor` creators surfaced a
   "the record was created but its activity audit could not be written — do not submit it again"
   warning, and losing it would have been a quiet regression in a message whose entire purpose is to
   stop a double submission. `AwardsActionState` carries `warning`, every panel renders it, and the
   create/replace panels hold their redirect while one is unread.

### 18.11 Unresolved risks carried into Stages 7–9

1. **No browser acceptance yet.** §12.9's 1440×900 / 375×812 gate and the three-role direct-URL and
   direct-POST matrix are Stage 7–9 and were deliberately not run. The surface follows the
   conventions (`useAdminActionSubmit` + `useActionFocusRestore` on every control, 44 px touch
   targets on every checkbox row, the `responsive-table` table/card pair on every list), but
   following a convention is not the same as having passed the gate.
2. **Migration 101 is still `afldb_test`-only.** DEV and PROD unapplied. The deploy order is
   unchanged and binding: migration, then `npm run db:privileges` (a no-op here, but the reconciler
   is what proves it), then the code. App read has been fail-closed since migration 039 — and §18.4
   item 1 is a live example of what that costs when a table has no app grant.
3. **`awards-admin.ts` residue** (§18.6 / §18.10 item 2).
4. **The `captaincies` manifest assertion** (§18.8) will keep failing that suite until someone
   updates it; it is not this issue's to fix but it will be in the way of a clean full-suite run.
5. **`CHANGELOG.md` is deliberately untouched.** Nothing is applied beyond `afldb_test` and nothing
   is deployed; the entry belongs with the Stage 7–9 closeout that can describe behaviour actually
   reaching a reader.

---

## 19. Stage 7 record — integrated regression and security acceptance (2026-09-13)

Scope of the session: **Stages 7, 8 and 9.** Stage 7 is complete. **Stage 8 is BLOCKED** at its
second step for a structural reason recorded in §19.6, and Stages 8.2–8.10 were therefore not run.
Nothing was committed, staged, pushed or merged; PROD was not touched; no DEV mutation was made.
Where this section and §§1–18 disagree, this section is authoritative for Stage 7.

### 19.1 The §12 gate reconciliation

Read against the code as built rather than against the earlier stage reports, per the brief.

| §12 gate | Where it is proved | Result |
|---|---|---|
| 1. Unit — status/reason CHECK shape, identity-field immutability, refusal vocabulary, CAS shape | `tests/awards-admin.test.ts` (migration-101 contract); `tests/integration/admin-awards.test.ts` ("refuses to correct an identity-bearing field at all", "refuses a stale `expectedUpdatedAt` without writing anything") | **PASS.** §17.6 already corrected §12's placement: identity-immutability and CAS are DB-backed, not DB-free, because both are enforced by the same transaction they protect |
| 2. Capability policy | `tests/auth.test.ts`, extended not duplicated | **PASS** |
| 3. Direct-route/action authorisation | `tests/auth.test.ts` source contract (guard reached before any await, on all ten pages, the route handler and all fifteen actions) | **PARTIAL — source-level PASS, rendered three-role matrix NOT RUN.** §8.5–8.8 of the brief is Stage 8 and is blocked (§19.6) |
| 4. Integration create → correct → void → reinstate → replace, per table, plus duplicate prevention | `tests/integration/admin-awards.test.ts` | **PASS — 32/32** (was 30; §19.3 added two) |
| 5. Reload survival, real `import_awards.py` | `tests/integration/admin-awards.test.ts` (ordinary scoped reload + destructive rebuild + D-9's three answers); `tests/integration/awards-reload-links.test.ts` under the importer role | **PASS** |
| 6. Public read-model invariance | "changes nothing at all while nothing is voided (gate 6)" | **PASS** |
| 7. Corrected/voided-row public behaviour | gate-7 tests across all three domains, plus `removed_year` staying public and the sitemap dropping an emptied season/team | **PASS** |
| 8. Audit atomicity | "rolls the canonical write back when its audit row cannot be written" | **PASS** |
| 9. Responsive/browser 1440×900 and 375×812 | — | **NOT RUN.** Stage 8, blocked (§19.6) |
| 10. Typecheck and privilege/release-gate impact | `npm run typecheck` clean; privilege impact proved read-only in §19.4 | **PASS** |

Two gates remain unmet, both for the same reason, and neither is a defect: gate 3's rendered half
and gate 9 need a running DEV deployment of this branch, which §19.6 explains cannot be produced
from this session.

### 19.2 The automated matrix

| Suite set | Result |
|---|---|
| `awards-admin`, `data-overrides-source-contract`, `db-promotion-check`, `auth`, `honours-lifecycle-public-contract` | **343 passed**, 0 failed |
| `integration/admin-awards`, `integration/player-honours`, `integration/club-honours` | **44 passed**, 0 failed |
| `integration/query-builder`, `integration/gridley-aa-oracle`, `integration/nl-answers`, `query-builder-spec`, `grid-solver-spec`, `grid-solver-under22`, `gridley-compat` | **129 passed / 1 skipped**, 0 failed |
| Full DB-free suite (123 files) | **4,571 passed / 1 failed / 14 skipped** |
| `integration/admin-awards` re-run under the **restricted `afldb_import` role** | **32/32** — §19.4 |
| `npm run typecheck` | clean |
| ESLint over all 46 changed TypeScript files | **0 errors**, 6 warnings, all six proved pre-existing at `HEAD` (§19.5) |
| `npm run build` | **PASS — 1,533/1,533 static pages**, all eleven `/admin/awards` routes emitted (§19.7) |
| Residue after every run | `award_winners` 3,712, `hall_of_fame` 343, `honour_team_members` 113; 0 non-active rows on all three; 0 fixture awards, 0 fixture players, 0 honours `data_overrides`, 0 honours `data_edits`. The database was left exactly as found |

`current_database()` was proved to be `afldb_test` for `afldb_owner` **and** independently for
`afldb_import` before any DB-backed test ran.

**Every failure, classified.** There is exactly one in the whole matrix.

| Failure | Classification | Grounding |
|---|---|---|
| `tests/finals-semantics-contract.test.ts` — "adds the enum value in its own migration" | **Environmental — Windows CRLF.** Not an ISSUE-165 regression | The assertion diff prints two visually identical strings; the file splits on a bare `\n` so the retained `\r` is the whole difference. Passes on Linux. No file in this diff touches it |

The four other classes §18.9 recorded (`grid-solver` x2, `release-gates` x4, `data-editor` x1) and
the `captaincies` manifest assertion belong to DB-backed suites outside the ISSUE-165 set; the
`captaincies` one is re-grounded from source in §19.8. None was re-labelled on the strength of the
earlier report alone.

### 19.3 Two live-path refusals that reached no test — found and closed

§18.6 recorded that `src/db/queries/awards-admin.ts` is retained because three contracts reach a
test only through it. Reading those contracts for the §19.9 decision found something §18.6 did not
say: **two of the three were being proved against the retired module and nowhere else**, while the
module the application actually calls carried its own copy that nothing exercised.

1. **The Brownlow refusal.** `admin-awards.ts:1387` refuses a Brownlow winner in
   `award_winners` — the stop condition the ISSUE-156 P5 handoff names in as many words ("never a
   second Brownlow authority"). The only test of it called the retired creator. Added:
   *"refuses to write a Brownlow winner into `award_winners` at all"*, which calls the live
   creator against the real `brownlow-medal` award row and asserts the `forbidden` refusal, the
   `brownlow_season_votes` message, and an unchanged row count either side.
2. **Historical club identity.** `admin-awards.ts:1414-1432` resolves a club best-and-fairest
   award's club through `afldb_identity_for_season()`. Same position — tested only through the
   retired module. Added: *"stamps the HISTORICAL club identity on a club best-and-fairest
   season"*, which finds a real renamed lineage on the database (it resolved **Sydney #21 ->
   South Melbourne #19 in 1897**), creates a fixture best-and-fairest award pointed at the modern
   club, and proves the winner is stamped with the historical club id and name — then proves a
   contradicting explicit `clubId` is refused rather than silently corrected.
3. **The ISSUE-080 §5.3 frozen lock literals.** `tests/awards-admin.test.ts`'s cross-language
   contract read `import_awards.py` against `awards-admin.ts` — the moved-**from** module. The
   literal the running application contends on was unpinned: changing
   `HONOUR_TEAM_LOCK_NAMESPACE` in `admin-awards.ts` would have failed nothing. The contract now
   iterates both writers, the live one and the retired one, each labelled with its role.

### 19.4 The importer-role gap the suite could not have caught

`tests/integration/admin-awards.test.ts` redirected `AFLDB_IMPORT_DATABASE_URL` to
`AFLDB_TEST_DATABASE_URL`, which fixes the *database* and silently also fixes the *role*: every
mutation in the suite ran as `afldb_owner`, which can do anything. §18.4 item 1 is the record of
what that hides — a `data_overrides` read that passed 24/24 as owner and would have failed closed
for the running application.

**The durable-record WRITE has the same exposure and a narrower grant.** Migration 078 gives
`afldb_import` **column-level** `INSERT`/`UPDATE` on `data_overrides`, deliberately — not
table-level, and the table is deliberately outside `afldb_meta.import_writable_tables`. A
lifecycle mutation that touched one ungranted column would fail closed on DEV and pass here.
A read-only probe on `afldb_test` confirms the shape: `afldb_app` has **no** privilege on
`data_overrides` at all, and `afldb_import` holds no *table*-level `INSERT`/`UPDATE` on it either.

The repository already had the right mechanism, unused by this suite:
`createImportRoleParityHarness()` in `tests/integration/import-role-parity.ts`. The suite now
takes `AFLDB_TEST_IMPORT_DATABASE_URL` when the operator has configured one and falls back to the
owner URL when not, and `beforeAll` calls `importRole.validate()` first, which proves
`current_database()`, `current_user = afldb_import`, matching `_test` databases either side, and a
live `42501` denial probe — so a run that claims importer-role coverage cannot quietly be the
owner again.

**Result: 32/32 as `afldb_import`.** Create, correct, void, reinstate and replace across all three
domains, every `data_overrides` durable write and every `data_edits` audit row, pass under
migration 078's column grants. The §18.4-class risk on the write path is now closed *before* DEV
rather than discovered on it. The restricted DSN was derived in memory from the operator's own
`.env` (every DSN shares the `afldb_test` endpoint), passed to the child environment only, and
never printed or written to disk.

### 19.5 Lint and type

`npm run typecheck` clean. ESLint over all 46 changed TypeScript files: **0 errors, 6 warnings**,
and all six were grounded rather than assumed — each warning site was extracted from `HEAD` and
found verbatim there (`formatDate`/`formatRoundShort` already imported-and-unused in
`data-editor/page.tsx`; `_t`/`_r` in `nl/player-career.ts`; `_old` in `query-builder-spec.ts`).
No new lint or type error.

### 19.6 Why Stage 8 stops at 8.1 — and it is not a defect

**Stage 8.1 preflight was run, read-only, and passed.** DEV host `arm@10.0.40.100`,
`/home/arm/projects/afldb`:

| Check | Evidence |
|---|---|
| Checkout | `b43eb4a` on `main`, working tree clean — **not** the worktree's commit, and one behind `origin/main` (`37ac7d3`) |
| Database identity | `current_database() = afldb_dev`, `current_user = afldb_owner`; `DATABASE_URL` and `AFLDB_OWNER_DATABASE_URL` both name `afldb_dev` |
| Migration status | through `100_nl_search_log_family_grain.sql`, **0 pending** — so 101 would be the only pending migration once this branch lands, exactly the expected state |
| Service health | `afldb` active; `/api/health` HTTP 200, `{"status":"ok","database":"ok","latencyMs":17}` |

**The blocker.** The established DEV promotion mechanism is `deploy/sync-dev.ps1`, which runs
`git fetch` -> optional `git checkout <ref>` -> `git pull --ff-only` -> `npm ci` -> `npm run db:migrate`
-> `npm run build` -> restart -> health poll. Its own header states it: *"It does not push local
changes. Commit and push first, then run this."* It can deploy a branch, but only one that exists
on `origin`.

`origin/sonnet/issue-165-awards-admin` is at `9a687db` — this worktree's `HEAD`, the Stage 1–3
backend commit. **Stages 4, 5 and 6 — every public status filter, both capabilities, the nav
entry, all ten `/admin/awards` pages, the route handler and all fifteen Server Actions — are
staged and uncommitted, and therefore are not on `origin` and cannot reach DEV.** Deploying the
pushed branch as it stands would put migration 101 and the backend on DEV with no surface to
accept and no public filters, which is neither the state under test nor a useful one.

The session brief forbids staging, committing and pushing, and CLAUDE.md's own lifecycle assigns
the commit to the operator. So Stage 8.2 onward is **blocked on one operator action**, not on any
finding: commit the staged Stage 4–6 work and push the branch. §19.10 gives the exact commands.
No workaround was attempted — copying an uncommitted tree onto the DEV host would leave it dirty
and outside the runbook, which is precisely what `afldb_classify_worktree` exists to refuse.

**A deploy-order finding worth carrying into Stage 8.3.** The first `npm run build` of this
session failed — `column w.status does not exist`, `42703`, collecting page data for
`/awards/[slug]` — because `.env`'s `DATABASE_URL` names `afldb_dev`, where migration 101 is not
applied. That is the correct and expected failure, and it is direct evidence for the binding
deploy order: **migration 101 must be applied before the build runs**. `sync-dev.ps1` already
sequences `db:migrate` before `build`, so the standard path is safe; a run with `-SkipMigrate`
would fail exactly this way.

### 19.7 The build, proved against a 101-applied database

Re-run with `DATABASE_URL` pointed at `afldb_test` (which carries 101), read-only:
**exit 0, compiled successfully, TypeScript clean, 1,533/1,533 static pages, standalone bundle
ready.** All eleven `/admin/awards` routes are emitted and all are dynamic (`f`), as a
capability-gated surface must be:

```
/admin/awards, /admin/awards/winners, /admin/awards/winners/[id], /admin/awards/winners/new,
/admin/awards/hall-of-fame{,/[id],/new}, /admin/awards/honour-teams{,/[id],/new},
/admin/awards/revalidate
```

This is also the gate that catches a Client Component value-importing a `server-only` module —
the release-blocking defect class `AFLDB-ISSUE-162` hit — and it is clean.

### 19.8 The `captaincies` assertion — grounded, and left alone

Required by the brief to be proved pre-existing from history rather than inherited from §18.8.

- The assertion (`expect(Number(batch.recordsRead)).toBe(1375)`, and a companion manifest
  expectation) was introduced by **`30a471c`, 2026-09-01**, "Add ISSUE-112 captaincies manifest".
- `data/awards/captaincies.csv` was last changed by **`d08591f`, 2026-09-05** (ISSUE-118
  §23.19–§23.22), which added **exactly 399 rows** (`git show --numstat`). 1,375 + 399 = **1,774**,
  which is the tracked file's current data-row count and the number the test observes.
- **151 commits** separate `d08591f` from this branch's `HEAD`, and this issue's diff touches no
  captaincies file at all (`git diff --stat -- '*captaincies*'` is empty for both the commit and
  the staged tree).

**Disposition: left unchanged.** It fails neither of the brief's two conditions together — it is
not required for any ISSUE-165 acceptance gate (`captaincies` is out of scope by §3.1, and every
honours reload path in that suite passes), so the fact that the fix would be small does not make
it this issue's to make. Recorded as pre-existing technical debt belonging to ISSUE-112's manifest
gates.

### 19.9 `awards-admin.ts` — the closeout decision: **RETAIN**

The brief asks for removal if the only reason to keep the module is test placement *and* the
contracts can move without changing behaviour. The first condition holds; **the second does not**,
and that is the decision.

What blocks removal, specifically:

1. `tests/awards-admin.test.ts` lines 46–483 are roughly twenty mocked-unit tests built on a
   harness that intercepts the retired creators' **exact query sequence** (`FROM awards a`,
   `SELECT id FROM sources`, `INSERT INTO award_winners`, ...). `admin-awards.ts`'s creators take
   different inputs and issue a materially different sequence — `SELECT ... FOR UPDATE`, the
   `data_overrides` durable write, award-span recomputation. Repointing the harness is a
   **rewrite of the assertions**, not a move of them, and a rewrite performed at closeout is
   exactly how coverage gets quietly weakened.
2. `tests/integration/awards-reload-links.test.ts` reaches `createHonourTeamMember` at six call
   sites, including the only test anywhere that proves the advisory lock under **real contention
   with a live reload**. Repointing those requires re-running a 421-second importer-role suite to
   revalidate.

So the module stays, and §18.6's justification stands — but §19.3 shows the version of it in
§18.6 was incomplete: two of the three contracts were not merely *placed* in the retired module,
they were *only* proved there, leaving the live copies unproven. Both are now proved against the
live module as well. The retained module's non-application status is already unmistakable in its
own header ("RETIRED FROM THE APPLICATION... DO NOT ADD A CALLER"), the `tests/awards-admin.test.ts`
"leaves no awards creation path behind in `/admin/data-editor`" contract keeps the old home empty,
and the lock contract now names each module's role in its own assertion labels.

**Residue that remains, recorded not hidden:** the twenty mocked-unit assertions still describe
the retired creators rather than the live ones. Retiring the file is a self-contained follow-up
(port the harness to `admin-awards.ts`, repoint the six reload-links call sites, delete the
module) and belongs to whoever next opens this area — not to an acceptance stage.
**One cosmetic consequence, deliberately not fixed here:** `src/db/queries/admin-users.ts:40`'s
advisory-lock namespace-registry comment still cites `awards-admin.ts`. The constant genuinely is
still there, so the comment is stale rather than wrong, and editing an unrelated module during
acceptance is not worth the diff.

### 19.10 Stage 8 restart instructions

Everything below is the operator's to run; none of it was run here.

1. Stage the working tree and commit (§19.11 carries the exact commands and message).
2. `git push origin sonnet/issue-165-awards-admin`.
3. `powershell -ExecutionPolicy Bypass -File .\deploy\sync-dev.ps1 -RemoteRef sonnet/issue-165-awards-admin`
   — this runs `db:migrate` (applying **101**, the only pending migration) before `build`, which
   is the order §19.6 shows is binding.
4. `npm run db:privileges` on the DEV host afterwards — expected to be a no-op, and the
   reconciler running clean is what proves it (migration 101 adds no table, so no
   `afldb_meta.grant_app_read()` is needed; §19.4's probe shows the three tables' existing
   table-level grants already cover the new `status` column).
5. Confirm `/api/health`, then run §8.5–§8.10 of the brief: the three-role rendered matrix, the
   direct-URL/action matrix, one full create -> correct -> void -> reinstate lifecycle plus a
   replace on a clearly-marked DEV-only fixture, the public lifecycle consequences, and 1440x900
   and 375x812.
6. Clean the fixture up through the supported lifecycle and re-prove zero residue.

### 19.11 Files this session changed

Three test files, no application code, no migration, no Python:

| File | Change |
|---|---|
| `tests/awards-admin.test.ts` | the ISSUE-080 §5.3 frozen-literal contract now pins **both** honour-team identity writers, the live `admin-awards.ts` and the retired `awards-admin.ts`, each labelled (§19.3 item 3) |
| `tests/integration/admin-awards.test.ts` | the importer-role harness wired in with its `beforeAll` validation (§19.4); two live-path refusal tests added (§19.3 items 1–2) |
| `AFLDB-ISSUE-165.md`, `issues.md`, `IssuesIndex.md`, `CHANGELOG.md` | tracking |

## 20. Stage 8 restart, 2026-09-13 — genuine acceptance failure at 8.1

The operator committed and pushed Stages 4–6 and ran `sync-dev.ps1`. DEV landed on `8250abe`
(`main`, merge of `sonnet/issue-165-awards-admin`), migration 101 applied (101/101, 0 pending),
service healthy (`{"status":"ok","database":"ok"}` direct and proxied). Gate 8 deployment/schema/
service verification is genuine PASS — the §19.6 blocker is cleared.

Rendered acceptance then found a real defect in the surface itself, before role-boundary or
lifecycle testing could proceed, so this session stopped per the session brief's "stop at any
genuine acceptance failure" instruction.

### 20.1 The defect

`/admin/awards` (Super Admin, DEV, `10.0.40.100:8090`) renders its header and its "What the two
states mean" section, but the entire middle section — the three navigation cards to Award
winners / Hall of Fame / Honour teams, each with its live counts and its "Browse" / "Record a new
one" links — is invisible. Confirmed by evaluating the live DOM, not just the accessibility
snapshot: the `<ul class="admin-cards">` markup is present and correctly populated (3,712 / 343 /
113 active counts, correct hrefs) but computed `display: none`, at every viewport width tested
(default and via direct style query — not width-dependent).

**Root cause, found in source:** `src/styles/globals.css:503` defines `.admin-cards { display:
none; ... }` as the *inactive* half of a responsive-table-to-card-list toggle used elsewhere
(`admin/coaches`, `admin/draft`, `admin/fixtures/[season]`) — the class is shown only inside a
`.responsive-table` wrapper below 640px (`globals.css:506`,
`.responsive-table > .admin-cards { display: grid }`), alongside a `<table>` it replaces at narrow
widths. `src/app/admin/awards/page.tsx` (§6.1 landing page, this issue's own Stage 6 work) reuses
the bare class name `admin-cards` for an unrelated permanent card grid — no `.responsive-table`
ancestor, no sibling `<table>` — so only the base `display: none` rule ever applies, at any width.
This is a class-name collision the implementation introduced, not a regression in the shared
component: `admin-cards`/`admin-card` was already an established convention (§18.6 built the
awards page after coaches/draft already used it) and the new page picked the same name for a
different purpose without the wrapper that activates it.

**Effect:** the only in-app path from `/admin/awards` into the three domains is dark, for every
role, at every width. Direct navigation to `/admin/awards/winners`, `/admin/awards/hall-of-fame`
and `/admin/awards/honour-teams` all work correctly and are fully populated (verified for
`winners`: table, filters, pagination — 3,712 records, page 1 of 75 — all rendered and correct).
No test in §17/§18/§19 caught this because the suite is DB-backed and DOM-assertion-light; nothing
in `tests/awards-admin.test.ts` or `tests/integration/admin-awards.test.ts` renders this page or
asserts on `.admin-cards` visibility.

### 20.2 Disposition

Not fixed here — the session brief forbids redeploying, and a CSS fix is still a deploy. The
smallest correct fix is a one-word scope change in `src/app/admin/awards/page.tsx`: rename the
list's class (e.g. `awards-domain-cards`) and give it its own always-visible grid rule, rather than
reusing `admin-cards`/`admin-card`, which stay a *responsive-table* pattern everywhere else.
Ordering rule for whoever applies it: fix, rebuild, `sync-dev.ps1` again, then **restart Stage 8
from 8.1** — the three-role rendered matrix, direct route/action matrix, DEV-only lifecycle
fixture, public-lifecycle behaviour, both responsive widths, focus/accessibility and console/
network passes are all still unrun, and the fixed landing page is itself part of what 8.1 must
now re-check (the Browse/Record links, not just the counts).

Session stopped here. No role other than Super Admin was tested; no lifecycle fixture was
created; DEV and PROD otherwise untouched; no migration run beyond the read-only status already
recorded above.

### 20.3 Corrective fix, 2026-09-13 (fix pass, uncommitted)

Fix-only session, scoped to §20.1's defect. No lifecycle/backend/security logic touched, no
change to the shared `.admin-cards`/`.admin-card` responsive-table pattern.

**Change.** `src/app/admin/awards/page.tsx`'s domain-card markup renamed off the shared classes
entirely: `admin-cards`/`admin-card`/`admin-card-title`/`admin-card-fields`/`admin-card-action` →
`awards-admin-cards`/`awards-admin-card`/`awards-admin-card-title`/`awards-admin-card-fields`/
`awards-admin-card-action`. The inline `style={{ display: 'flex', gap: '0.6rem', flexWrap: 'wrap'
}}` on the action row (previously needed to out-specificity `.admin-card-action`'s `display:
grid`) is now redundant and was folded into the new `.awards-admin-card-action` class instead.

`src/styles/globals.css` gets a new, purely additive block (0 deletions from the shared rules)
defining the five `.awards-admin-*` selectors: `.awards-admin-cards` is `display: grid` with
`grid-template-columns: repeat(auto-fit, minmax(min(320px, 100%), 1fr))` — the same auto-fit/
320px template already used by `.grid-panels` for other description-carrying card grids — and, unlike
the class it replaces, is unconditional: no media query, no `.responsive-table` ancestor
requirement, visible at every width. The other four selectors (`-card`, `-card-title`,
`-card-fields`, `-card-action`) duplicate their `.admin-card*` counterparts' declarations verbatim
(border/radius/padding/grid, title type scale, the dt/dd field-row layout), so the cards look
identical to before — only the wrapper's visibility rule and the class names changed.

**Verified untouched:** `winners`, `hall-of-fame` and `honour-teams` list pages still use
`admin-cards`/`admin-card`/`admin-card-title`/`admin-card-fields`/`admin-card-action` exactly as
before, each still correctly nested in its own `.responsive-table` wrapper alongside a `<table>`
sibling; `admin/coaches`, `admin/draft` and `admin/fixtures/[season]` — the pages that pattern was
built for — were not touched at all. `git diff --stat -- src/styles/globals.css` shows
insertions-only (49 insertions, 0 deletions).

**Validation (workstation, no DB, no deploy):** `npm run typecheck` clean; `eslint` on both
changed files — 0 errors on `page.tsx` (CSS has no ESLint config, expected); `git diff --check`
clean (no whitespace errors). No existing test renders `/admin/awards` or asserts on
`.admin-cards`/`.awards-admin-cards` visibility, so there is no targeted regression test to
extend for a pure presentational class rename; this gap is why §20.1's defect reached DEV
unassisted in the first place and is left as recorded technical debt, not fixed under this
fix-only scope.

**Not done, deliberately:** no restage/commit/push, no rebuild, no `sync-dev.ps1`, no DEV or PROD
change of any kind — this pass is source-only, for operator review. Stage 8 is **not** PASS and
`AFLDB-ISSUE-165` is **not** Resolved. Once the operator commits, pushes and redeploys, **Stage 8
must restart from 8.1** exactly as §20.2 says, now including a check that the three cards render
correctly (not just that they're visible) at both 1440×900 and 375×812.
